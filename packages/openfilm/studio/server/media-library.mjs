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
 * A place is named `folder:<full path>` (one the person added, all-media.mjs `setMediaFolder`) or `project:<id>` (a
 * listed project: its assets/). Nothing outside a place is ever listed or read, and nothing here writes into one:
 * what Studio works out from a file of an added folder is kept in Studio's own folder (`folderCache`).
 */
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { fingerprint } from '../../src/media-fingerprint.mjs';
import { folderCache } from './all-media.mjs';
import { inProject, kindOf } from './files.mjs';
import { madeAnywhere } from './media-made.mjs';
import { mediaFolders, projectRecordFile, readRecord } from './media-index.mjs';
import { TOOL_DIR, listProjects } from './projects.mjs';

const KINDS = new Set(['video', 'image', 'audio']);
/** Folders that are a tool's or a system's, not media: not shown. */
const SKIP = new Set(['node_modules', TOOL_DIR, '$RECYCLE.BIN', 'System Volume Information']);
const shown = (/** @type {string} */ name) => !name.startsWith('.') && !SKIP.has(name) && !/\.(photoslibrary|app|fcpbundle|imovielibrary)$/i.test(name);
/** Entries of one folder looked at at a time. */
const AT_ONCE = 16;

/**
 * @typedef {{ place: string, root: string, name: string, project?: { id: string, path: string }, cache: string }} Place
 *   `root`: the folder listed; `cache`: where what Studio works out from its files is kept
 * @typedef {{ name: string, path: string, kind: 'video' | 'image' | 'audio', size: number, mtime: number }} LibraryFile
 *   `path`: inside the place, `/` between folders
 */

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
  const followed = (/** @type {import('node:fs').Dirent} */ e) => !e.isSymbolicLink() || Boolean(at.project && inProject(at.project.path, `assets/${inside(e.name)}`));
  const seen = await each(entries.filter((e) => shown(e.name) && followed(e)), async (e) => {
    const info = await stat(join(abs, e.name)).catch(() => null);
    if (!info) return null;
    if (info.isDirectory()) {
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
  if (!at.project) return { abs, root: at.root, rel: /** @type {string} */ (path), cache: at.cache };
  /* a project's file is read as the project reads it: through a link only to a place the person linked */
  const read = inProject(at.project.path, `assets/${path}`);
  return read ? { abs: read, root: at.project.path, rel: `assets/${path}`, cache: at.cache } : null;
}

/**
 * What is known of one file beyond what its folder says: the projects that use it (the same file, under any name,
 * by its fingerprint) and how it was made, when a service made it. Read from the file as it is asked.
 * @param {Place} at @param {unknown} path
 */
export async function aboutFile(at, path) {
  const file = fileIn(at, path);
  if (!file) return null;
  if (!(await stat(file.abs).catch(() => null))?.isFile()) return null;
  /* its bytes may not be on this disk just now (a cloud drive's): nothing more is known of it */
  const fp = await fingerprint(file.abs).catch(() => null);
  if (!fp) return { usedIn: [], made: null };
  const usedIn = [];
  for (const p of (await listProjects()).filter((p) => !p.missing)) {
    if (Object.values(readRecord(projectRecordFile(p.path)).files).some((e) => e.fp === fp && !e.gone)) usedIn.push({ id: p.id, name: p.name || basename(p.path) });
  }
  return { usedIn, made: await madeAnywhere(fp) };
}
