// @ts-check
/**
 * A project's shots, as the stage plugin keeps them: `stage/<name>/` with `index.html` (the page) and `shot.js` (the
 * set, the figures and the camera), all standing on `stage/lib/` (three.js, stage.js, mannequin.js), copied in from
 * this plugin the first time and the project's own after that (with `viewer.html`, how the workbench draws a shot).
 * Nothing here is a format: a shot is a page of a film.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../../src/shared.mjs';
import { projectAround } from '../../src/skills-cli.mjs';

/** This plugin's folder. */
export const PLUGIN = dirname(fileURLToPath(import.meta.url));
/** What `stage/lib/` holds, from the plugin's `lib/`. */
export const LIB = ['three.module.min.js', 'three.core.min.js', 'three.LICENSE', 'stage.js', 'mannequin.js', 'viewer.html', 'viewer.js',
  'addons/loaders/GLTFLoader.js', 'addons/utils/BufferGeometryUtils.js', 'addons/utils/SkeletonUtils.js'];
/** A shot's name: what its folder is called. */
export const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** The project a command works in: the one it was run in (OPENFILM_PROJECT), else the one around `cwd`. */
export function projectHere(cwd = process.cwd()) {
  const project = process.env.OPENFILM_PROJECT || projectAround(cwd);
  if (!project) throw new UsageError(`${resolve(cwd)} is not in a project (no film.html here or above)`);
  return project;
}

/** The project's shots, by name: each folder of `stage/` with an index.html. @param {string} project */
export function listShots(project) {
  const dir = join(project, 'stage');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'lib' && existsSync(join(dir, e.name, 'index.html')))
    .map((e) => e.name).sort();
}

/**
 * The shot `what` names: its name (`s1`), its folder (`stage/s1`) or its page (`stage/s1/index.html`), from the project
 * or from `cwd`. Throws a UsageError naming the shots there are.
 * @param {string} project @param {string} what @param {string} [cwd]
 */
export function shotOf(project, what, cwd = process.cwd()) {
  const candidates = [join(project, 'stage', what), resolve(cwd, what), join(project, what)];
  for (const c of candidates) {
    const page = c.endsWith('.html') ? c : join(c, 'index.html');
    if (existsSync(page) && statSync(page).isFile() && (page.startsWith(project + sep))) {
      const dir = dirname(page);
      return { name: relative(join(project, 'stage'), dir).split(sep).join('/'), dir, page, entry: relative(project, page).split(sep).join('/') };
    }
  }
  const shots = listShots(project);
  throw new UsageError(`no shot ${what}: ${shots.length ? `the shots are ${shots.join(', ')}` : 'there are none yet (openfilm stage new <name>)'}`);
}

/** Copy into the project's `stage/lib/` what it does not have yet; the files it has are its own. Returns those copied. @param {string} project */
export function copyLib(project) {
  const dir = join(project, 'stage', 'lib');
  mkdirSync(dir, { recursive: true });
  /** @type {string[]} */
  const copied = [];
  for (const file of LIB) {
    if (existsSync(join(dir, file))) continue;
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    copyFileSync(join(PLUGIN, 'lib', file), join(dir, file));
    copied.push(`stage/lib/${file}`);
  }
  return copied;
}

/** How `openfilm` is typed here. */
export const RUN = process.env.OPENFILM_RUN || 'openfilm';

/** Run a command's body and exit as OpenFilm's commands do: 0 done, 1 it failed, 2 a wrong command or not a project. @param {() => Promise<void> | void} body @param {string} name */
export async function command(body, name) {
  try {
    await body();
  } catch (e) {
    console.error(`${RUN} stage ${name}: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = e instanceof UsageError ? 2 : 1;
  }
}
