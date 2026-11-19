// @ts-check
import { constants, lstatSync, readdirSync, realpathSync, renameSync, rmdirSync } from 'node:fs';
import { access, cp, lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { chosenFolder, libraryDefault, requireOutsideInstallation, savedRoot, savedTarget, setSharedPrefs, usableFolder } from '../../src/locations.mjs';
import { HttpError } from './http.mjs';

const within = (/** @type {string} */ root, /** @type {string} */ path) => {
  const back = relative(root, path);
  return !isAbsolute(back) && back.split(sep)[0] !== '..';
};

/** Windows directory connections are junctions. Use the catalog for their type even when the disk is offline. */
async function directoryLinks(/** @type {string} */ root) {
  const data = await readFile(join(root, '.openfilm-library.json'), 'utf8').then(JSON.parse).catch(() => null);
  return new Set(Array.isArray(data?.snapshot?.folders) ? data.snapshot.folders : []);
}

/** Copy the whole library, including its catalog, without copying the originals of linked media. */
async function copySaved(/** @type {string} */ from, /** @type {string} */ part, /** @type {string} */ to) {
  const knownDirs = process.platform === 'win32' ? await directoryLinks(from) : null;
  await cp(from, part, {
    recursive: true, force: false, errorOnExist: true, preserveTimestamps: true, mode: constants.COPYFILE_FICLONE,
    async filter(source, destination) {
      if (!(await lstat(source)).isSymbolicLink()) return true;
      const target = resolve(dirname(source), await readlink(source));
      const movedTarget = within(from, target) ? join(to, relative(from, target)) : target;
      const name = `saved/${relative(from, source).split(sep).join('/')}`;
      const directory = knownDirs && (knownDirs.has(name) || (await stat(source).catch(() => null))?.isDirectory());
      await symlink(movedTarget, destination, directory ? 'junction' : 'file');
      return false;
    },
  });
}

/**
 * Commit the new projects folder and its Saved folder together, after the complete library is on the new disk.
 * Returns the old library, which the caller can recycle after updating project references.
 * @param {string | null} projects
 */
export async function chooseStorage(projects) {
  const previousProjects = chosenFolder('projectsFolder');
  const saved = resolve(savedRoot());
  const target = resolve(savedTarget(projects));
  const projectsPath = resolve(projects ?? libraryDefault());
  const storeProjects = () => setSharedPrefs({ projectsFolder: projects });
  const source = lstatSync(saved, { throwIfNoEntry: false });
  const realSaved = source ? realpathSync.native(saved) : saved;
  if (within(saved, projectsPath) || within(realSaved, projectsPath)) throw new HttpError(400, 'Choose a projects folder outside the asset library.');
  if (projects !== null) {
    try { usableFolder(projects); } catch (e) { throw new HttpError(400, /** @type {Error} */ (e).message); }
    if (within(realSaved, realpathSync.native(projects))) throw new HttpError(400, 'Choose a projects folder outside the asset library.');
  }
  try {
    requireOutsideInstallation(projectsPath);
    if (relative(saved, target)) requireOutsideInstallation(target);
  } catch (e) { throw new HttpError(400, /** @type {Error} */ (e).message); }

  if (!relative(saved, target)) {
    storeProjects();
    return null;
  }
  if (source && !source.isDirectory()) throw new HttpError(409, `The asset library cannot be moved from ${saved}.`);
  if (!source && chosenFolder('savedFolder')) throw new HttpError(409, `The asset library is unavailable at ${saved}. Reconnect its disk and try again.`);

  let stage;
  try {
    const parent = dirname(target);
    await mkdir(parent, { recursive: true });
    const realTarget = join(realpathSync.native(parent), relative(parent, target));
    if (within(realSaved, realTarget) || within(realTarget, realSaved)) throw new HttpError(400, 'Choose a projects folder outside the asset library.');
    const existing = lstatSync(target, { throwIfNoEntry: false });
    if (existing && (!existing.isDirectory() || readdirSync(target).length > 0)) {
      throw new HttpError(409, `The asset library cannot move because ${target} is already in use. Choose another projects folder.`);
    }
    await access(parent, constants.W_OK);
    stage = await mkdtemp(join(parent, '.openfilm-moving-'));
    const part = join(stage, 'Saved');
    if (source) await copySaved(realSaved, part, realTarget);
    else await mkdir(part);

    if (previousProjects !== chosenFolder('projectsFolder') || relative(savedRoot(), saved)) {
      throw new HttpError(409, 'Storage locations changed while the asset library was being copied. Try again.');
    }
    // Publish the complete library. An empty target is safe to remove, including one made while copying.
    if (lstatSync(target, { throwIfNoEntry: false })) rmdirSync(target);
    renameSync(part, target);
    try { setSharedPrefs({ projectsFolder: projects, savedFolder: target }); }
    catch (e) { renameSync(target, part); throw e; }
    return source ? saved : null;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(409, `Could not move the asset library to ${target}. ${/** @type {Error} */ (e).message}`);
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}
