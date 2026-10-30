// @ts-check
/**
 * OpenFilm's library: the transitions, effects, text, stickers, looks and sounds that come with OpenFilm (library/ in
 * this package), read-only, shown in the assets drawer beside the project's media and Saved.
 *
 *   library/index.json   what is in it: each thing's id (its place in library/), its category and group, its name in
 *                        each language, and what it is —
 *                          page   a bundle as Saved keeps one (saved.json, files/, poster.jpg, preview.mp4)
 *                          sound  a file (sounds/<name>.m4a), its waveform in sounds/waves/<name>.png
 *                          look   a CSS `filter`, written into a clip's style
 *                          fade   one of Studio's transitions (ui lib/transitions), made of fades
 *   library/<id>/…       the things themselves
 *
 * A thing is taken into a project as a thing of Saved is (saved.mjs takeSaved), by its path `openfilm/<id>`: copied,
 * a bundle's files to `saved/openfilm/<id as one name>/` there (`effects-snow`), a file into assets/. Nothing here is
 * ever written.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inside } from './files.mjs';

/** What a path names the library by (`openfilm/<id>`), as `saved/` names Saved. */
export const BUILT_IN = 'openfilm';

/** The library's folder. */
export const builtInRoot = () => process.env.OPENFILM_BUILT_IN_LIBRARY || fileURLToPath(new URL('../../library', import.meta.url));

/** @type {{ file: string, mtime: number, index: unknown } | null} */
let kept = null;

/** The library's index as library/index.json has it; read again when the file changes. */
export function libraryIndex() {
  const file = join(builtInRoot(), 'index.json');
  if (!existsSync(file)) return { version: 1, groups: {}, items: [] };
  const mtime = statSync(file).mtimeMs;
  if (kept?.file !== file || kept.mtime !== mtime) kept = { file, mtime, index: JSON.parse(readFileSync(file, 'utf8')) };
  return kept.index;
}

/** A file of the library by its place there (a poster, a preview, a page, a sound), or null when there is none. */
export function libraryFile(/** @type {unknown} */ rel) {
  if (typeof rel !== 'string' || !rel) return null;
  let file;
  try { file = inside(builtInRoot(), rel); } catch { return null; }
  return existsSync(file) && statSync(file).isFile() ? file : null;
}
