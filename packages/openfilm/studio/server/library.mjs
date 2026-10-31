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
 *   library/voices.json  the voices to speak a voice-over in: the ready-made voices of the voice-over services OpenFilm
 *                        offers, each with its service's own sample (voices/<service>/<voice>.m4a); made by
 *                        scripts/library-voices.mjs from those services' own lists
 *
 * The things the person starred are kept in the shared prefs.json (`libraryFavorites`, their ids), so every OpenFilm on
 * this computer shows the same ones.
 *
 * A thing is taken into a project as a thing of Saved is (saved.mjs takeSaved), by its path `openfilm/<id>`: copied,
 * a bundle's files to `saved/openfilm/<id as one name>/` there (`effects-snow`), a file into assets/. Nothing here is
 * ever written.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setSharedPref, sharedPref } from '../../src/locations.mjs';
import { inside } from './files.mjs';

/** What a path names the library by (`openfilm/<id>`), as `saved/` names Saved. */
export const BUILT_IN = 'openfilm';

/** The library's folder. */
export const builtInRoot = () => process.env.OPENFILM_BUILT_IN_LIBRARY || fileURLToPath(new URL('../../library', import.meta.url));

/** @type {Map<string, { mtime: number, value: unknown }>} */
const kept = new Map();

/** A JSON file of the library as it is (`empty` when there is none); read again when it changes. @param {string} name @param {unknown} empty */
function read(name, empty) {
  const file = join(builtInRoot(), name);
  if (!existsSync(file)) return empty;
  const mtime = statSync(file).mtimeMs;
  const was = kept.get(file);
  if (was?.mtime === mtime) return was.value;
  const value = JSON.parse(readFileSync(file, 'utf8'));
  kept.set(file, { mtime, value });
  return value;
}

/** The library's index as library/index.json has it. */
export const libraryIndex = () => read('index.json', { version: 1, groups: {}, items: [] });

/** The voices as library/voices.json has them: the services (each with its voice-over models) and their voices. */
export const libraryVoices = () => read('voices.json', { version: 1, providers: [], voices: [] });

/** A voice's id among the starred things: `voice:<service>/<its id there>`. */
export const voiceKey = (/** @type {{ provider: string, id: string }} */ v) => `voice:${v.provider}/${v.id}`;

/** Every id a star can be on: the index's things and the voices. */
function starrable() {
  return new Set([
    ...(/** @type {{ items: { id: string }[] }} */ (libraryIndex())).items.map((item) => item.id),
    ...(/** @type {{ voices: { provider: string, id: string }[] }} */ (libraryVoices())).voices.map(voiceKey),
  ]);
}

/** A file of the library by its place there (a poster, a preview, a page, a sound), or null when there is none. */
export function libraryFile(/** @type {unknown} */ rel) {
  if (typeof rel !== 'string' || !rel) return null;
  let file;
  try { file = inside(builtInRoot(), rel); } catch { return null; }
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

/** Where the starred things are kept in the shared prefs.json. */
const FAVORITES = 'libraryFavorites';

/** The ids the person starred (a voice's is voiceKey's), in the order they were starred, those still in the library only. */
export function libraryFavorites() {
  const starred = sharedPref(FAVORITES);
  const ids = starrable();
  return Array.isArray(starred) ? [...new Set(starred.filter((id) => typeof id === 'string' && ids.has(id)))] : [];
}

/** Keep `ids` as the starred ones (those not in the library left out). Returns them as kept. */
export function setLibraryFavorites(/** @type {unknown} */ ids) {
  const known = starrable();
  const next = Array.isArray(ids) ? [...new Set(ids.filter((id) => typeof id === 'string' && known.has(id)))] : [];
  setSharedPref(FAVORITES, next);
  return next;
}

