// @ts-check
/**
 * The person's media on this computer: the folders they keep media in, shown as they are (their own folders inside,
 * the files in each), to look through and take from, whether or not a film uses them. Projects are not in it: a
 * project's media is the project's, and what a person reuses in every film they keep in Saved (saved.mjs).
 *
 * A folder is listed straight from the disk as it is opened, so it shows at once however large the place is; what
 * takes reading every file (fingerprints, which projects use a file) is worked out for the file asked about, or
 * behind, by the index (media-index.mjs).
 *
 * Looking for a file in all the folders (`searchLibrary`) reads the index instead: every file by name, without
 * walking the disk, so it answers at once; it knows a folder as it was last read (they are read again as the library
 * is opened). An agent's search (media-library-get.mjs) takes the files kept in Saved with them.
 *
 * A file of a folder the person added is renamed or moved to the trash here, as in the file manager; a file is moved
 * between Saved and those folders (`moveFile`), as the person tidies what is theirs.
 *
 * A place is named `folder:<full path>` (one the person linked, `setMediaFolder`), `saved` (the files kept in Saved;
 * the clips and pages kept there are not files to look through) or `saved:<folder>` (a folder of Saved: Favorites, or
 * one the person made, to move a file to). Nothing outside a place is ever listed or read, and
 * nothing here writes into an added folder: what Studio works out from its files is kept in Studio's own folder
 * (`folderCache`).
 *
 * A file comes into a project only when it is used there (`takeFile`): as media the person brings in does, taking no
 * room where the disk allows, and one the project has already, under any name, is that one.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import { fingerprint } from '../../src/media-fingerprint.mjs';
import { readableLink } from '../../src/media-links.mjs';
import { setSharedPref, sharedHome } from '../../src/locations.mjs';
import { bringIn, cleanName, kindOf, readable } from './files.mjs';
import { libraryRoot as savedRoot } from './saved.mjs';
import { moveToTrash } from './trash.mjs';
import { carryMade, madeAnywhere, wordsByFingerprint } from './media-made.mjs';
import { folderRecordFile, mediaFolders, projectRecordFile, readRecord, scanProject } from './media-index.mjs';
import { TOOL_DIR, listProjects } from './projects.mjs';

const KINDS = new Set(['video', 'image', 'audio']);
/** Folders that are a tool's or a system's, not media: not shown. */
const SKIP = new Set(['node_modules', TOOL_DIR, '$RECYCLE.BIN', 'System Volume Information']);
const shown = (/** @type {string} */ name) => !name.startsWith('.') && !SKIP.has(name) && !/\.(photoslibrary|app|fcpbundle|imovielibrary)$/i.test(name);
/** Entries of one folder looked at at a time. */
const AT_ONCE = 16;

/**
 * @typedef {{ place: string, root: string, name: string, saved?: boolean, cache: string }} Place
 *   `root`: the folder listed; `cache`: where what Studio works out from its files is kept
 * @typedef {{ name: string, path: string, kind: 'video' | 'image' | 'audio', size: number, mtime: number }} LibraryFile
 *   `path`: inside the place, `/` between folders
 */

/** Where Studio keeps what it works out from the files of an added folder. */
export const folderCache = (/** @type {string} */ root) => join(sharedHome(), 'media-index', 'cache', createHash('sha1').update(resolve(root)).digest('hex').slice(0, 16));

/** Folders that hold too much to be media folders: a disk's top, the home folder itself. */
const tooWide = (/** @type {string} */ path) => path === parse(path).root || path === homedir();

/**
 * A folder added to the library, or taken out of it (its record and cache with it; the folder itself is never
 * touched). Resolves with the folders now.
 * @param {string} path @param {boolean} on
 */
export async function setMediaFolder(path, on) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw Object.assign(new Error('a folder, please'), { status: 400 });
  const folder = resolve(path);
  const now = mediaFolders();
  if (on) {
    if (tooWide(folder)) throw Object.assign(new Error('That holds far more than media: pick the folder your media is in.'), { status: 400 });
    if (!(await stat(folder).catch(() => null))?.isDirectory()) throw Object.assign(new Error('That folder is not there.'), { status: 404 });
    if (!now.includes(folder)) setSharedPref('mediaFolders', [...now, folder]);
  } else {
    setSharedPref('mediaFolders', now.filter((f) => f !== folder));
    await rm(folderRecordFile(folder), { force: true }).catch(() => {});
    await rm(folderCache(folder), { recursive: true, force: true }).catch(() => {});
  }
  return mediaFolders();
}

/** Fingerprints read here for one file (what is known of it), by full path. */
/** @type {Map<string, { size: number, mtime: number, fp: string }>} */
const read = new Map();

/** A file's fingerprint, read now (and remembered while the file stays as it is). Null: not a file here, or its bytes are elsewhere. */
async function fpOf(/** @type {{ abs: string }} */ file) {
  const info = await stat(file.abs).catch(() => null);
  if (!info?.isFile()) return null;
  const fp = await fingerprint(file.abs, info).catch(() => null);
  if (fp) {
    if (read.size >= 5000) read.delete(read.keys().next().value ?? '');
    read.set(file.abs, { size: info.size, mtime: Math.round(info.mtimeMs), fp });
  }
  return fp;
}

/** The folders added (`missing`: not there now, a disk that is out). */
export function libraryPlaces() {
  return { folders: mediaFolders().map((path) => ({ place: `folder:${path}`, path, name: basename(path) || path, missing: !existsSync(path) })) };
}

/** The place a name stands for, or null when there is none (a folder not added). @param {unknown} place @returns {Promise<Place | null>} */
export async function placeOf(place) {
  if (typeof place !== 'string') return null;
  if (place.startsWith('folder:')) {
    const path = resolve(place.slice(7));
    return mediaFolders().includes(path) ? { place, root: path, name: basename(path) || path, cache: folderCache(path) } : null;
  }
  if (place === 'saved') { const root = await savedRoot(); return { place, root, name: 'Saved', saved: true, cache: root }; }
  /* a folder of the library (Favorites, or one the person made), to move a file to */
  if (place.startsWith('saved:')) {
    const lib = await savedRoot();
    const rel = place.slice(6);
    const root = inPlace({ place: 'saved', root: lib, name: 'Saved', saved: true, cache: lib }, rel);
    if (!root || root === lib || !(await stat(root).catch(() => null))?.isDirectory() || existsSync(join(root, 'saved.json'))) return null;
    return { place, root, name: rel.split('/').pop() ?? rel, saved: true, cache: lib };
  }
  return null;
}

/** A path inside a place as the disk has it, or null for one that leaves it. @param {Place} at @param {unknown} path '' for its top */
export function inPlace(at, path) {
  if (typeof path !== 'string' || path.includes('\0') || path.includes('\\')) return null;
  const parts = path.split('/').filter(Boolean);
  if (parts.some((p) => p === '..' || p === '.' || !shown(p))) return null;
  const abs = join(at.root, ...parts);
  return abs === at.root || abs.startsWith(`${at.root}${sep}`) ? abs : null;
}

/** Run `work` on each of `items`, a few at a time, in their order. @template T, R @param {T[]} items @param {(item: T) => Promise<R>} work @returns {Promise<R[]>} */
async function each(items, work) {
  /** @type {R[]} */
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await work(/** @type {T} */ (items[i])); }
  }));
  return out;
}

/**
 * What a folder of a place holds: its folders (each with how many folders and media files are in it) and its media
 * files, by name. A link is left out (one that leads back up would never end). Null when the folder is not there.
 * @param {Place} at @param {string} [dir] inside the place
 * @returns {Promise<{ dirs: { name: string, path: string, items: number }[], files: LibraryFile[] } | null>}
 */
export async function listFolder(at, dir = '') {
  const abs = inPlace(at, dir);
  if (!abs) return null;
  const entries = await readdir(abs, { withFileTypes: true }).catch(() => null);
  if (!entries) return null;
  const inside = (/** @type {string} */ name) => (dir ? `${dir}/${name}` : name);
  const seen = await each(entries.filter((e) => shown(e.name) && !e.isSymbolicLink()), async (e) => {
    const info = await stat(join(abs, e.name)).catch(() => null);
    if (!info) return null;
    if (info.isDirectory()) {
      /* in Saved, a clip, a group or a page kept there is a folder of its own making: no folder of files */
      if (at.saved && existsSync(join(abs, e.name, 'saved.json'))) return null;
      const held = await readdir(join(abs, e.name), { withFileTypes: true }).catch(() => []);
      const items = held.filter((h) => shown(h.name) && (h.isDirectory() || KINDS.has(kindOf(h.name)))).length;
      return { dir: { name: e.name, path: inside(e.name), items } };
    }
    const kind = kindOf(e.name);
    if (!info.isFile() || !KINDS.has(kind)) return null;
    return { file: /** @type {LibraryFile} */ ({ name: e.name, path: inside(e.name), kind, size: info.size, mtime: Math.round(info.mtimeMs) }) };
  });
  const byName = (/** @type {{ name: string }} */ a, /** @type {{ name: string }} */ b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  return {
    dirs: seen.flatMap((s) => (s?.dir ? [s.dir] : [])).sort(byName),
    files: seen.flatMap((s) => (s?.file ? [s.file] : [])).sort(byName),
  };
}

/**
 * A file of a place as Studio's media tools take it (derived.mjs): the folder they read it from, its path there, and
 * where they keep what they work out. Null when it is no file of the place.
 * @param {Place} at @param {unknown} path
 */
export function fileIn(at, path) {
  const abs = inPlace(at, path);
  if (!abs || abs === at.root || !KINDS.has(kindOf(basename(abs)))) return null;
  return { abs, root: at.root, rel: /** @type {string} */ (path), cache: at.cache };
}

/**
 * What is known of one file beyond what its folder says: the projects that use it (the same file, under any name,
 * by its fingerprint), those among them that link to this very file where it is kept (`linkedBy`), and how it was
 * made when a service made it. Read from the file as it is asked.
 * @param {Place} at @param {unknown} path
 */
export async function aboutFile(at, path) {
  const file = fileIn(at, path);
  if (!file) return null;
  if (!(await stat(file.abs).catch(() => null))?.isFile()) return null;
  /* its bytes may not be on this disk just now (a cloud drive's): nothing more is known of it */
  const fp = await fpOf(file);
  if (!fp) return { usedIn: [], linkedBy: [], made: null };
  const usedIn = [], linkedBy = [];
  for (const p of (await listProjects()).filter((p) => !p.missing)) {
    const has = Object.values(readRecord(projectRecordFile(p.path)).files).filter((e) => e.fp === fp && !e.gone);
    if (!has.length) continue;
    usedIn.push({ id: p.id, name: p.name || basename(p.path) });
    /* it links to this very file, where it is kept: moved away or renamed, the project has to find it again */
    if (has.some((e) => e.at === file.abs)) linkedBy.push({ id: p.id, name: p.name || basename(p.path), path: p.path });
  }
  return { usedIn, linkedBy, made: await madeAnywhere(fp) };
}

/** Where a file of a place is, to read: its place and the folders it is in (`Footage / 2026-10 beach`). @param {Place} at @param {string} path */
export function whereOf(at, path) {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? at.name : `${at.name} / ${path.slice(0, cut).split('/').join(' / ')}`;
}

/** @typedef {LibraryFile & { place: string, where: string }} Found   `where`: its place and the folders it is in, to read (`Footage / 2026-10 beach`) */

/** Folders of Saved looked into at most. */
const SAVED_DEPTH = 6;

/** @typedef {{ path: string, abs: string, kind: 'video' | 'image' | 'audio', size: number, mtime: number }} SavedFile */

/** Files of Saved looked at at most: a folder linked into it may hold a whole shoot. */
const SAVED_FILES = 5000;

/**
 * The plain files kept in Saved (not the clips, groups and pages kept there), read from the disk, through the links the
 * person made in it to media kept elsewhere (src/media-links.mjs). @returns {Promise<SavedFile[]>}
 */
export async function savedFiles() {
  const root = await savedRoot();
  /** @type {SavedFile[]} */
  const out = [];
  async function walk(/** @type {string} */ dir, /** @type {string} */ rel, /** @type {number} */ depth) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (out.length >= SAVED_FILES) return;
      if (!shown(e.name)) continue;
      const abs = join(dir, e.name);
      const path = rel ? `${rel}/${e.name}` : e.name;
      const linked = e.isSymbolicLink() ? (readableLink(root, abs) ? await stat(abs).catch(() => null) : null) : undefined;
      if (linked === null) continue;
      if (linked ? linked.isDirectory() : e.isDirectory()) { if (depth < SAVED_DEPTH && !existsSync(join(abs, 'saved.json'))) await walk(abs, path, depth + 1); continue; }
      const kind = kindOf(e.name);
      const info = (linked ? linked.isFile() : e.isFile()) && KINDS.has(kind) ? await stat(abs).catch(() => null) : null;
      if (info) out.push({ path, abs, kind: /** @type {'video' | 'image' | 'audio'} */ (kind), size: info.size, mtime: Math.round(info.mtimeMs) });
    }
  }
  await walk(root, '', 0);
  return out;
}

/**
 * Files of the added folders, from the index: those whose name or folders hold every word asked for (as do the words
 * a service was asked for it with, for media a service made), of one kind when asked. The same file twice is found
 * once. `saved`: the files kept in Saved too, first (what the person kept to use again). `sort`: the newest first, by
 * name, or the largest first. At most `limit` are returned; `total` is how many matched.
 * @param {{ q?: string, kind?: string | null, saved?: boolean, sort?: 'date' | 'name' | 'size', limit?: number }} [asked]
 * @returns {Promise<{ files: Found[], total: number }>}
 */
export async function searchLibrary({ q = '', kind = null, saved = false, sort = 'date', limit = 300 } = {}) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const asked = await wordsByFingerprint();
  const fits = (/** @type {string} */ hay) => !words.length || words.every((w) => hay.toLowerCase().includes(w));
  const whereIn = (/** @type {string} */ placeName, /** @type {string} */ path) => {
    const cut = path.lastIndexOf('/');
    return cut < 0 ? placeName : `${placeName} / ${path.slice(0, cut).split('/').join(' / ')}`;
  };
  /** @type {Found[]} */
  const first = [];
  if (saved) {
    for (const f of await savedFiles()) {
      const where = whereIn('Saved', f.path);
      if ((kind && f.kind !== kind) || !fits(`${where} / ${basename(f.path)}`)) continue;
      first.push({ place: 'saved', where, name: basename(f.path), path: f.path, kind: f.kind, size: f.size, mtime: f.mtime });
    }
  }
  /** @type {Map<string, Found>} */
  const found = new Map();
  for (const root of mediaFolders()) {
    const placeName = basename(root) || root;
    for (const [path, e] of Object.entries(readRecord(folderRecordFile(root)).files)) {
      if (e.gone || (kind && e.kind !== kind)) continue;
      /* the same file again: the one kept longest stands for them (a copy is younger than what it was made from), and
         of two as old, the one nearer its folder's top */
      const had = found.get(e.fp);
      const deep = (/** @type {string} */ at) => at.split('/').length;
      if (had && (had.mtime < e.mtime || (had.mtime === e.mtime && deep(had.path) <= deep(path)))) continue;
      const where = whereIn(placeName, path);
      const name = path.slice(path.lastIndexOf('/') + 1);
      if (!fits(`${where} / ${name}\n${asked.get(e.fp) ?? ''}`)) continue;
      found.set(e.fp, { place: `folder:${root}`, where, name, path, kind: e.kind, size: e.size, mtime: e.mtime });
    }
  }
  const order = sort === 'name'
    ? (/** @type {Found} */ a, /** @type {Found} */ b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    : sort === 'size' ? (/** @type {Found} */ a, /** @type {Found} */ b) => b.size - a.size : (/** @type {Found} */ a, /** @type {Found} */ b) => b.mtime - a.mtime || a.name.localeCompare(b.name);
  const files = [...first.sort(order), ...[...found.values()].sort(order)];
  return { files: files.slice(0, Math.max(1, Math.min(2000, limit))), total: files.length };
}

/** Why a file of the library was not renamed. */
export class LibraryError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** A file of a folder the person added (not of Saved), or the reason it is not one to change here. */
function ownFile(/** @type {Place} */ at, /** @type {unknown} */ path) {
  if (at.saved) throw new LibraryError('What is in Saved is renamed and removed in Saved.');
  const file = fileIn(at, path);
  if (!file || !existsSync(file.abs)) throw new LibraryError('That file is not there.', 404);
  return file;
}

/**
 * Rename a file of an added folder, in its folder. The name is cleaned as an imported file's is and keeps what kind
 * of media it is; one already taken is refused. A project that links to it finds it again by its fingerprint.
 * Resolves with its new path in the place.
 * @param {Place} at @param {unknown} path @param {unknown} name
 */
export async function renameFile(at, path, name) {
  const file = ownFile(at, path);
  const clean = cleanName(String(name ?? ''));
  if (!clean || clean.startsWith('.')) throw new LibraryError('A name, please.');
  if (kindOf(clean) !== kindOf(basename(file.abs)) || extname(clean).toLowerCase() !== extname(file.abs).toLowerCase()) throw new LibraryError('Keep the ending: it says what kind of file it is.');
  const to = join(dirname(file.abs), clean);
  if (to === file.abs) return { path: /** @type {string} */ (path) };
  /* another file of that name (the same file under another case of its name is not one) */
  if (existsSync(to) && to.toLowerCase() !== file.abs.toLowerCase()) throw new LibraryError('That name is taken in this folder.', 409);
  await rename(file.abs, to);
  const rel = /** @type {string} */ (path);
  return { path: rel.includes('/') ? `${rel.slice(0, rel.lastIndexOf('/'))}/${clean}` : clean };
}

/**
 * Move a file to the top of another place (Saved, or a folder the person added), keeping its name, or the name with a
 * number when one is taken there; across disks it is copied, then taken away. Only a media file moves: what Saved
 * keeps as a folder of its own (a clip, a group, a page) stays in Saved. A project that links to it finds it again by
 * its fingerprint. Resolves with where it is now.
 * @param {Place} at @param {unknown} path @param {Place} to
 */
export async function moveFile(at, path, to) {
  const file = fileIn(at, path);
  if (!file || !(await stat(file.abs).catch(() => null))?.isFile()) throw new LibraryError('That file is not there.', 404);
  const name = basename(file.abs);
  if (dirname(file.abs) === to.root) return { place: to.place, path: name };
  await mkdir(to.root, { recursive: true });
  const { name: stem, ext } = parse(name);
  let dest = join(to.root, name);
  for (let n = 2; existsSync(dest); n++) dest = join(to.root, `${stem} ${n}${ext}`);
  try { await rename(file.abs, dest); } catch (e) {
    if (/** @type {{ code?: string }} */ (e).code !== 'EXDEV') throw e;
    await copyFile(file.abs, dest);
    await rm(file.abs);
  }
  return { place: to.place, path: basename(dest) };
}

/** Move a file of an added folder to the system's trash, where it can be taken back. @param {Place} at @param {unknown} path */
export async function trashFile(at, path) {
  const file = ownFile(at, path);
  await moveToTrash(file.abs);
}

/**
 * A file of this computer brought into the project at `root`, as media the person brings in does (files.mjs `bringIn`
 * `auto`). One the project has already, under any name, is that one. How it was made comes with it
 * (media-made.mjs). Resolves with its path in the project, or null when it could not be read.
 * @param {string} root @param {string} abs
 */
async function takeInto(root, abs) {
  const fp = await fingerprint(abs).catch(() => null);
  if (!fp) return null;
  for (const [rel, e] of Object.entries(readRecord(projectRecordFile(root)).files)) {
    if (e.fp !== fp || e.gone) continue;
    try { if ((await stat(readable(root, rel))).size === e.size) return rel; } catch { /* not there now */ }
  }
  const [landed] = await bringIn(root, 'assets', [abs], 'auto');
  if (!landed) return null;
  /* on record at once: a second use of it is this file, not another copy */
  await scanProject(root).catch(() => {});
  await carryMade(root, landed);
  return landed;
}

/** A file of a place used in the project at `root`: its path there, or null when it is no file of the place. @param {Place} at @param {unknown} path @param {string} root */
export async function takeFile(at, path, root) {
  const file = fileIn(at, path);
  return file && existsSync(file.abs) ? takeInto(root, file.abs) : null;
}

/**
 * The file with this fingerprint, in Saved or an added folder, used in the project at `root`: its path there, or null
 * when neither has it any more.
 * @param {string} fp @param {string} root
 */
export async function takeByFingerprint(fp, root) {
  for (const f of await savedFiles()) if (await fingerprint(f.abs).catch(() => null) === fp) return takeInto(root, f.abs);
  for (const folder of mediaFolders()) {
    for (const [path, e] of Object.entries(readRecord(folderRecordFile(folder)).files)) {
      if (e.fp !== fp || e.gone) continue;
      const abs = e.at ?? join(folder, ...path.split('/'));
      if (await fingerprint(abs).catch(() => null) === fp) return takeInto(root, abs);
    }
  }
  /* the project's own already */
  return Object.entries(readRecord(projectRecordFile(root)).files).find(([, e]) => e.fp === fp && !e.gone)?.[0] ?? null;
}

/**
 * A file of the library as a thing dragged, picked or pointed at names it (`lib:["<place>","<path>"]`): its place
 * and path, or null for anything else.
 * @param {unknown} ref @returns {{ place: string, path: string } | null}
 */
export function libraryRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('lib:')) return null;
  try {
    const [place, path] = JSON.parse(ref.slice(4));
    return typeof place === 'string' && typeof path === 'string' ? { place, path } : null;
  } catch { return null; }
}
