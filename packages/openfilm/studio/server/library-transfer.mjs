// @ts-check
/** File-manager copies and links, between known library entries (including connected source folders). */
import { existsSync, realpathSync } from 'node:fs';
import { stat, symlink } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { bringIn, inside, readable } from './files.mjs';
import { HttpError } from './http.mjs';
import { registerLibraryLinks } from './asset-library.mjs';
import { libraryPath, libraryRel, libraryRoot } from './saved.mjs';

/** Resolve a destination that may not exist yet without overlooking an existing symlink ancestor. */
function destinationAt(/** @type {string} */ path) {
  let parent = path;
  /** @type {string[]} */ const tail = [];
  while (!existsSync(parent)) { tail.unshift(basename(parent)); parent = dirname(parent); }
  return join(realpathSync.native(parent), ...tail);
}

/** @param {unknown} asked */
export async function transferLibraryEntries(asked) {
  const body = /** @type {{ paths?: unknown; into?: unknown; mode?: unknown }} */ (asked ?? {});
  if (!Array.isArray(body.paths) || !body.paths.length || body.paths.length > 50_000 || body.paths.some(path => typeof path !== 'string')) throw new HttpError(400, 'Choose files or folders to copy or link.');
  if (body.mode !== 'copy' && body.mode !== 'link') throw new HttpError(400, 'Choose copy or link.');
  const root = await libraryRoot();
  const into = libraryRel(body.into ?? 'saved');
  const destination = destinationAt(into ? inside(root, into) : root);
  const paths = [...new Set(/** @type {string[]} */ (body.paths))];
  const roots = paths.filter(path => !paths.some(parent => parent !== path && path.startsWith(`${parent}/`)));
  /** Validate the entire selection before starting the first transfer. */
  const sources = await Promise.all(roots.map(async path => {
    const rel = libraryRel(path);
    if (!rel) throw new HttpError(400, 'The library itself cannot be copied or linked.');
    const source = readable(root, rel);
    const real = realpathSync.native(source);
    const info = await stat(real);
    const back = relative(real, destination);
    if (info.isDirectory() && (!back || back !== '..' && !back.startsWith(`..${sep}`) && !back.startsWith(sep) && !/^[a-z]:/i.test(back))) throw new HttpError(400, 'A folder cannot be copied or linked into itself.');
    if (body.mode === 'link' && info.isDirectory() && existsSync(join(real, 'saved.json'))) throw new HttpError(400, 'Copy saved clips and groups with their dependencies.');
    return source;
  }));
  const landed = (await bringIn(root, into, sources, body.mode, { anywhere: true, sourceName: source => basename(source), makeLink: (source, destination, kind) => symlink(source, destination, process.platform === 'win32' && kind === 'dir' ? 'junction' : kind) })).map(libraryPath);
  await registerLibraryLinks(landed);
  return { landed };
}
