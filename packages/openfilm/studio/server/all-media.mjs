// @ts-check
/**
 * All of the person's media in one place: the media pane's "All media", beside "This project". Every media file of
 * every project and of every folder they added, as the index knows them (media-index.mjs), one line for each
 * different file (the same file in five projects is one), the newest first. Nothing is copied to make it: a file is
 * read where it is, and comes into a project only when it is used there (`takeMedia`).
 *
 * A file is named here by its fingerprint (`all/<fingerprint>.<ext>`), so the name stays while the file moves. What
 * Studio works out from it (its poster, its length) is kept with its project as the project's own files are; one of
 * an added folder has it kept by Studio (`folderCache`), never in the person's folder.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, join, parse, resolve } from 'node:path';
import { sharedHome, setSharedPref } from '../../src/locations.mjs';
import { bringIn, readable } from './files.mjs';
import { folderRecordFile, mediaFolders, projectRecordFile, readRecord, scanProject } from './media-index.mjs';
import { listProjects } from './projects.mjs';

/** The top of these paths, as the pane names them. */
export const ALL = 'all';

/**
 * @typedef {{ path: string, name: string, kind: import('./media-index.mjs').MediaKind, size: number, mtime: number,
 *   from: string, uses: number }} AllFile   `from`: the project or folder it is shown from; `uses`: how many
 *   projects have it
 * @typedef {{ fp: string, root: string, rel: string, abs: string, project: boolean, cache: string }} Where
 */

/** Where Studio keeps what it works out from the files of an added folder. */
export const folderCache = (/** @type {string} */ root) => join(sharedHome(), 'media-index', 'cache', createHash('sha1').update(resolve(root)).digest('hex').slice(0, 16));

/** Where each file listed last is, by its path here: what the pane asks for next is one of them. */
/** @type {Map<string, Where>} */
let places = new Map();

/** The path a file is named by here. */
const pathOf = (/** @type {string} */ fp, /** @type {string} */ name) => `${ALL}/${fp.slice(fp.indexOf('-') + 1)}${extname(name).toLowerCase()}`;

/** Whether a path names a file of All media. */
export const isAllPath = (/** @type {unknown} */ path) => typeof path === 'string' && /^all\/[0-9a-f]{8,64}(\.[a-z0-9]{1,8})?$/.test(path);

/**
 * Every different media file of every project that is there and of every added folder, the newest first, and the
 * added folders. A file behind a link that leads nowhere just now (a disk that is out) is left out; so is a file
 * that left its project.
 */
export async function allMedia() {
  const projects = (await listProjects()).filter((p) => !p.missing);
  const folders = mediaFolders();
  /** @type {Map<string, AllFile & { at: Where }>} */
  const byFp = new Map();
  /** @type {Map<string, Set<string>>} */
  const usedIn = new Map();
  const add = (/** @type {Where} */ at, /** @type {import('./media-index.mjs').MediaEntry} */ e, /** @type {string} */ from) => {
    if (at.project) {
      const seen = usedIn.get(e.fp) ?? new Set();
      seen.add(at.root);
      usedIn.set(e.fp, seen);
    }
    const had = byFp.get(e.fp);
    /* shown once, from where it was first made: the oldest of its copies */
    if (had && had.mtime <= e.mtime) return;
    const name = basename(at.rel);
    byFp.set(e.fp, { path: pathOf(e.fp, name), name, kind: e.kind, size: e.size, mtime: e.mtime, from, uses: 0, at });
  };
  for (const p of projects) {
    for (const [rel, e] of Object.entries(readRecord(projectRecordFile(p.path)).files)) {
      if (e.gone || (e.at && !existsSync(e.at))) continue;
      add({ fp: e.fp, root: p.path, rel, abs: e.at ?? join(p.path, ...rel.split('/')), project: true, cache: p.path }, e, p.name || basename(p.path));
    }
  }
  for (const root of folders) {
    for (const [rel, e] of Object.entries(readRecord(folderRecordFile(root)).files)) {
      add({ fp: e.fp, root, rel, abs: join(root, ...rel.split('/')), project: false, cache: folderCache(root) }, e, basename(root) || root);
    }
  }
  const files = [...byFp.values()].sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
  places = new Map(files.map((f) => [f.path, f.at]));
  return {
    files: files.map(({ at, ...f }) => ({ ...f, uses: usedIn.get(at.fp)?.size ?? 0 })),
    folders: folders.map((path) => ({ path, name: basename(path) || path, missing: !existsSync(path) })),
  };
}

/** Where a file of All media is, or null when it is not one any more. @param {unknown} path @returns {Promise<Where | null>} */
export async function whereAll(path) {
  if (!isAllPath(path)) return null;
  const known = places.get(/** @type {string} */ (path));
  if (known && existsSync(known.abs)) return known;
  await allMedia();
  return places.get(/** @type {string} */ (path)) ?? null;
}

/** The file itself, read through its place (a project's link is followed as the project follows it). @param {Where} at */
export const fileOf = (at) => (at.project ? readable(at.root, at.rel) : at.abs);

/**
 * A file of All media brought into the project at `root`, where it goes as media the person brings in does (files.mjs
 * `bringIn` `auto`: taking no room where the disk allows, big media on another disk linked where it is). One the project
 * has already, under any name, is that one. Resolves with its path in the project.
 * @param {string} root @param {string} path
 */
export async function takeMedia(root, path) {
  const at = await whereAll(path);
  if (!at) return null;
  const own = readRecord(projectRecordFile(root)).files;
  for (const [rel, e] of Object.entries(own)) {
    if (e.fp !== at.fp || e.gone) continue;
    try { if ((await stat(readable(root, rel))).size === e.size) return rel; } catch { /* not there now */ }
  }
  const [landed] = await bringIn(root, 'assets', [fileOf(at)], 'auto');
  /* on record at once: a second use of it is this file, not another copy */
  await scanProject(root).catch(() => {});
  return landed ?? null;
}

/** Folders that hold too much to be media folders: a disk's top, the home folder itself. */
function tooWide(/** @type {string} */ path) {
  return path === parse(path).root || path === homedir();
}

/**
 * A folder added to the person's media (scanned next, `onAdded`), or taken away (its record and cache with it; the
 * folder itself is never touched). Resolves with the folders now.
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
