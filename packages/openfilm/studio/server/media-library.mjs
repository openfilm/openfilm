// @ts-check
/**
 * The person's media library: the folders of this computer they keep media in, shown as they are (their own folders
 * inside, the files in each), and each project's media beside them. It is where a person looks through, finds and
 * tends their media whether or not a film uses it, so it starts from their folders, not from the projects.
 *
 * A folder is listed straight from the disk as it is opened, so it shows at once however large the place is; what
 * takes reading every file (fingerprints, which projects use a file) is worked out for the file asked about, or
 * behind, by the index (media-index.mjs).
 *
 * Looking for a file anywhere in the library (`searchLibrary`) reads the index instead: every file of every place
 * by name, without walking the disk, so it answers at once; it knows a place as it was last read (the places are read
 * again as the library is opened).
 *
 * What the person says of a file is kept by its fingerprint (`marks.json` beside the index, in the home every
 * OpenFilm on this computer shares), so it stays when the file is renamed or moved: liked, or not wanted (`no`), which
 * hides it without touching it. Only a file of a folder the person added is renamed or moved to the trash here; a
 * project's files are tended in the project, where its clips follow.
 *
 * A place is named `folder:<full path>` (one the person added, `setMediaFolder`), `project:<id>` (a listed project:
 * its assets/) or `saved` (the files the person kept in Saved, saved.mjs; the clips and pages kept there are not
 * files to look through, and stay in the project drawer's Saved). Nothing outside a place is ever listed or read, and
 * nothing here writes into an added folder: what Studio works out from its files is kept in Studio's own folder
 * (`folderCache`).
 *
 * A file comes into a project only when it is used there (`takeFile`): as media the person brings in does, taking no
 * room where the disk allows, and one the project has already, under any name, is that one.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import { fingerprint, isFingerprint } from '../../src/media-fingerprint.mjs';
import { setSharedPref, sharedHome } from '../../src/locations.mjs';
import { writeAtomic } from './atomic.mjs';
import { bringIn, cleanName, inProject, kindOf, readable } from './files.mjs';
import { libraryRoot as savedRoot } from './saved.mjs';
import { moveToTrash } from './trash.mjs';
import { carryMade, madeAnywhere, readMade, wordsByFingerprint } from './media-made.mjs';
import { folderRecordFile, mediaFolders, projectRecordFile, readRecord, scanProject } from './media-index.mjs';
import { TOOL_DIR, listProjects } from './projects.mjs';

const KINDS = new Set(['video', 'image', 'audio']);
/** Folders that are a tool's or a system's, not media: not shown. */
const SKIP = new Set(['node_modules', TOOL_DIR, '$RECYCLE.BIN', 'System Volume Information']);
const shown = (/** @type {string} */ name) => !name.startsWith('.') && !SKIP.has(name) && !/\.(photoslibrary|app|fcpbundle|imovielibrary)$/i.test(name);
/** Entries of one folder looked at at a time. */
const AT_ONCE = 16;

/**
 * @typedef {{ place: string, root: string, name: string, project?: { id: string, path: string }, saved?: boolean, cache: string }} Place
 *   `root`: the folder listed; `cache`: where what Studio works out from its files is kept
 * @typedef {'like' | 'no'} Mark
 * @typedef {{ name: string, path: string, kind: 'video' | 'image' | 'audio', size: number, mtime: number, mark?: Mark }} LibraryFile
 *   `path`: inside the place, `/` between folders; `mark`: what the person said of it, when its fingerprint is known
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

const marksFile = () => join(sharedHome(), 'media-index', 'marks.json');
/** @type {{ stamp: string, marks: Record<string, Mark> } | null} */
let keptMarks = null;

/** What the person said of files, by fingerprint. @returns {Record<string, Mark>} */
export function readMarks() {
  let stamp;
  try { const info = statSync(marksFile(), { bigint: true }); stamp = `${marksFile()}:${info.ino}:${info.size}:${info.mtimeNs}`; } catch { keptMarks = null; return {}; }
  if (keptMarks?.stamp === stamp) return keptMarks.marks;
  /** @type {Record<string, Mark>} */
  const marks = {};
  try {
    for (const [fp, mark] of Object.entries(JSON.parse(readFileSync(marksFile(), 'utf8'))?.marks ?? {})) if (isFingerprint(fp) && (mark === 'like' || mark === 'no')) marks[fp] = mark;
  } catch { /* unreadable: nothing said */ }
  keptMarks = { stamp, marks };
  return marks;
}

/** Fingerprints read here for one file (a mark, what is known of it), until the index has them: by full path. */
/** @type {Map<string, { size: number, mtime: number, fp: string }>} */
const read = new Map();

/** A listed file's fingerprint as the index (or a reading here) has it for the file as it is now, or null. */
function knownFp(/** @type {Place} */ at, /** @type {string} */ path, /** @type {number} */ size, /** @type {number} */ mtime) {
  const e = at.project ? readRecord(projectRecordFile(at.project.path)).files[`assets/${path}`] : readRecord(folderRecordFile(at.root)).files[path];
  if (e && !e.gone && e.size === size && e.mtime === mtime) return e.fp;
  const seen = read.get(join(at.root, ...path.split('/')));
  return seen && seen.size === size && seen.mtime === mtime ? seen.fp : null;
}

/** A file's fingerprint, read now (and remembered for the listings until the index has it). Null: not a file here, or its bytes are elsewhere. */
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

/**
 * Say of a file that it is liked, or not wanted, or (null) neither. Resolves with its mark, or null when it is no
 * file of the place.
 * @param {Place} at @param {unknown} path @param {Mark | null} mark
 */
export async function markFile(at, path, mark) {
  const file = fileIn(at, path);
  const fp = file ? await fpOf(file) : null;
  if (!fp) return null;
  const marks = { ...readMarks() };
  if (mark) marks[fp] = mark; else delete marks[fp];
  await mkdir(dirname(marksFile()), { recursive: true });
  await writeAtomic(marksFile(), `${JSON.stringify({ version: 1, marks }, null, 1)}\n`);
  keptMarks = null;
  return { mark };
}

/** The places there are: the folders added (`missing`: not there now, a disk that is out) and the listed projects. */
export async function libraryPlaces() {
  const projects = (await listProjects()).filter((p) => !p.missing);
  return {
    folders: mediaFolders().map((path) => ({ place: `folder:${path}`, path, name: basename(path) || path, missing: !existsSync(path) })),
    projects: projects.map((p) => ({ place: `project:${p.id}`, id: p.id, name: p.name || basename(p.path) })),
  };
}

/** The place a name stands for, or null when there is none (a folder not added, a project not listed). @param {unknown} place @returns {Promise<Place | null>} */
export async function placeOf(place) {
  if (typeof place !== 'string') return null;
  if (place.startsWith('folder:')) {
    const path = resolve(place.slice(7));
    return mediaFolders().includes(path) ? { place, root: path, name: basename(path) || path, cache: folderCache(path) } : null;
  }
  if (place.startsWith('project:')) {
    const project = (await listProjects()).find((p) => p.id === place.slice(8) && !p.missing);
    return project ? { place, root: join(project.path, 'assets'), name: project.name || basename(project.path), project: { id: project.id, path: project.path }, cache: project.path } : null;
  }
  if (place === 'saved') { const root = await savedRoot(); return { place, root, name: 'Saved', saved: true, cache: root }; }
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
 * files, by name. A link is followed in a project where the project itself reads through it (media the person linked,
 * files.mjs `readable`), and left out of an added folder (one that leads back up would never end). Null when the
 * folder is not there.
 * @param {Place} at @param {string} [dir] inside the place
 * @returns {Promise<{ dirs: { name: string, path: string, items: number }[], files: LibraryFile[] } | null>}
 */
export async function listFolder(at, dir = '') {
  const abs = inPlace(at, dir);
  if (!abs) return null;
  const entries = await readdir(abs, { withFileTypes: true }).catch(() => null);
  if (!entries) return null;
  const inside = (/** @type {string} */ name) => (dir ? `${dir}/${name}` : name);
  const marks = readMarks();
  const followed = (/** @type {import('node:fs').Dirent} */ e) => !e.isSymbolicLink() || Boolean(at.project && inProject(at.project.path, `assets/${inside(e.name)}`));
  const seen = await each(entries.filter((e) => shown(e.name) && followed(e)), async (e) => {
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
    const mtime = Math.round(info.mtimeMs);
    const mark = marks[knownFp(at, inside(e.name), info.size, mtime) ?? ''];
    return { file: /** @type {LibraryFile} */ ({ name: e.name, path: inside(e.name), kind, size: info.size, mtime, ...(mark ? { mark } : {}) }) };
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
  if (!at.project) return { abs, root: at.root, rel: /** @type {string} */ (path), cache: at.cache };
  /* a project's file is read as the project reads it: through a link only to a place the person linked */
  const read = inProject(at.project.path, `assets/${path}`);
  return read ? { abs: read, root: at.project.path, rel: `assets/${path}`, cache: at.cache } : null;
}

/**
 * What is known of one file beyond what its folder says: the projects that use it (the same file, under any name,
 * by its fingerprint), those among them that link to this very file where it is kept (`linkedBy`), how it was made
 * when a service made it, and what the person said of it. Read from the file as it is asked.
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
  const mark = readMarks()[fp];
  return { usedIn, linkedBy, made: await madeAnywhere(fp), ...(mark ? { mark } : {}) };
}

/** Where a file of a place is, to read: its place and the folders it is in (`Footage / 2026-10 beach`). @param {Place} at @param {string} path */
export function whereOf(at, path) {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? at.name : `${at.name} / ${path.slice(0, cut).split('/').join(' / ')}`;
}

/**
 * @typedef {LibraryFile & { place: string, where: string, copies?: number }} Found   `where`: its place and the
 *   folders it is in, to read (`Footage / 2026-10 beach`); `copies`: how many files of the same bytes it is one of
 */

/**
 * Files of the whole library, from the index: those whose name, folders or place hold every word asked for (as do
 * the words a service was asked for it with, for media a service made), of one kind when asked, only what a service
 * made when asked. The same file in several places is found once, in a folder the person added before a project.
 * `mark`: only what the person liked, or said they do not want; what they do not want is found no other way.
 * `unused`: only files of the added folders that no project has.
 * `sort`: the newest first, by name, or the largest first. At most `limit` are returned; `total` is how many matched.
 * @param {{ q?: string, kind?: string | null, made?: boolean, mark?: Mark | null, unused?: boolean, sort?: 'date' | 'name' | 'size', limit?: number }} [asked]
 * @returns {Promise<{ files: Found[], total: number }>}
 */
export async function searchLibrary({ q = '', kind = null, made = false, mark = null, unused = false, sort = 'date', limit = 300 } = {}) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const projects = (await listProjects()).filter((p) => !p.missing);
  const asked = await wordsByFingerprint();
  /** what a service made, by fingerprint: with the words it was asked with, or with none */
  const byService = new Set(asked.keys());
  for (const p of projects) for (const fp of Object.keys(readMade(p.path))) byService.add(fp);
  const marks = readMarks();
  /** every file a project has, by fingerprint */
  const inProjects = new Set();
  if (unused) for (const p of projects) for (const e of Object.values(readRecord(projectRecordFile(p.path)).files)) if (!e.gone) inProjects.add(e.fp);
  /** @type {Map<string, Found>} */
  const found = new Map();
  const take = (/** @type {string} */ place, /** @type {string} */ placeName, /** @type {string} */ path, /** @type {import('./media-index.mjs').MediaEntry} */ e) => {
    /* the same file again: the one kept longest stands for them (a copy is younger than what it was made from), and
       of two as old, the one nearer its place's top (a copy is often put in a folder of its own) */
    const had = found.get(e.fp);
    const deep = (/** @type {string} */ at) => at.split('/').length;
    if (had && (had.place.startsWith('folder:') !== place.startsWith('folder:') || had.mtime < e.mtime || (had.mtime === e.mtime && deep(had.path) <= deep(path)))) return;
    if (e.gone || (kind && e.kind !== kind) || (made && !byService.has(e.fp))) return;
    if (mark ? marks[e.fp] !== mark : marks[e.fp] === 'no') return;
    if (unused && inProjects.has(e.fp)) return;
    const cut = path.lastIndexOf('/');
    const where = cut < 0 ? placeName : `${placeName} / ${path.slice(0, cut).split('/').join(' / ')}`;
    if (words.length) {
      const hay = `${where} / ${path.slice(cut + 1)}\n${asked.get(e.fp) ?? ''}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return;
    }
    found.set(e.fp, { place, where, name: path.slice(cut + 1), path, kind: e.kind, size: e.size, mtime: e.mtime, ...(marks[e.fp] ? { mark: marks[e.fp] } : {}) });
  };
  for (const root of mediaFolders()) {
    for (const [path, e] of Object.entries(readRecord(folderRecordFile(root)).files)) take(`folder:${root}`, basename(root) || root, path, e);
  }
  for (const p of unused ? [] : projects) {
    for (const [path, e] of Object.entries(readRecord(projectRecordFile(p.path)).files)) {
      if (path.startsWith('assets/')) take(`project:${p.id}`, p.name || basename(p.path), path.slice(7), e);
    }
  }
  const files = [...found.values()].sort(sort === 'name'
    ? (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    : sort === 'size' ? (a, b) => b.size - a.size : (a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
  return { files: files.slice(0, Math.max(1, Math.min(2000, limit))), total: files.length };
}

/**
 * Files of the added folders that are the same bytes as another, each group together (the group that would give
 * back the most room first; in a group the oldest first, and of two as old the one nearer its place's top), and the
 * room keeping one of each would give back. Two
 * names of one file (a hard link) take the room once and are no copies. A project's own copies are left out: they
 * are the project's.
 * @returns {Promise<{ files: Found[], groups: number, spare: number }>}
 */
export async function duplicates() {
  /** @type {Map<string, Found[]>} */
  const byFp = new Map();
  for (const root of mediaFolders()) {
    const name = basename(root) || root;
    for (const [path, e] of Object.entries(readRecord(folderRecordFile(root)).files)) {
      if (e.gone) continue;
      const cut = path.lastIndexOf('/');
      byFp.set(e.fp, [...(byFp.get(e.fp) ?? []), { place: `folder:${root}`, where: cut < 0 ? name : `${name} / ${path.slice(0, cut).split('/').join(' / ')}`, name: path.slice(cut + 1),
        path, kind: e.kind, size: e.size, mtime: e.mtime }]);
    }
  }
  const marks = readMarks();
  const groups = [];
  for (const [fp, files] of byFp) {
    if (files.length < 2) continue;
    /* as the disk has them now: those still there, one for each file whatever its names */
    const seen = new Set();
    const there = [];
    for (const f of files) {
      const info = await stat(join(f.place.slice(7), ...f.path.split('/'))).catch(() => null);
      if (!info?.isFile() || info.size !== f.size || seen.has(`${info.dev}:${info.ino}`)) continue;
      seen.add(`${info.dev}:${info.ino}`);
      there.push({ ...f, ...(marks[fp] ? { mark: marks[fp] } : {}) });
    }
    const deep = (/** @type {Found} */ f) => f.path.split('/').length;
    if (there.length > 1) groups.push(there.sort((a, b) => a.mtime - b.mtime || deep(a) - deep(b) || a.path.localeCompare(b.path)).map((f) => ({ ...f, copies: there.length })));
  }
  groups.sort((a, b) => b[0].size * (b.length - 1) - a[0].size * (a.length - 1));
  return { files: groups.flat(), groups: groups.length, spare: groups.reduce((sum, g) => sum + g[0].size * (g.length - 1), 0) };
}

/** Why a file of the library was not renamed. */
export class LibraryError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** A file of a folder the person added (not a project's, not of Saved), or the reason it is not one to change here. */
function ownFile(/** @type {Place} */ at, /** @type {unknown} */ path) {
  if (at.project) throw new LibraryError('A project\'s files are renamed and removed in the project, where its clips follow.');
  if (at.saved) throw new LibraryError('What is in Saved is renamed and removed in Saved.');
  const file = fileIn(at, path);
  if (!file || !existsSync(file.abs)) throw new LibraryError('That file is not there.', 404);
  return file;
}

/**
 * Rename a file of an added folder, in its folder. The name is cleaned as an imported file's is and keeps what kind
 * of media it is; one already taken is refused. What the person said of the file stays (it is kept by fingerprint),
 * and a project that links to it finds it again by its fingerprint. Resolves with its new path in the place.
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
 * The file with this fingerprint, wherever the library has it (a folder the person added before a project), used in
 * the project at `root`: its path there, or null when no place has it any more.
 * @param {string} fp @param {string} root
 */
export async function takeByFingerprint(fp, root) {
  const places = [
    ...mediaFolders().map((folder) => ({ base: folder, files: readRecord(folderRecordFile(folder)).files })),
    ...(await listProjects()).filter((p) => !p.missing && p.path !== root).map((p) => ({ base: p.path, files: readRecord(projectRecordFile(p.path)).files })),
  ];
  for (const { base, files } of places) {
    for (const [path, e] of Object.entries(files)) {
      if (e.fp !== fp || e.gone) continue;
      const abs = e.at ?? join(base, ...path.split('/'));
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
