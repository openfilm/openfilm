// @ts-check
/**
 * What this computer knows of the person's media: each media file of every project, and of every folder they added,
 * by its fingerprint (src/media-fingerprint.mjs). With it a file that was moved or renamed can be found again, and
 * the same file in five projects is known to be one file.
 *
 * A project keeps its own record, `.film/media.json`: for each media file under assets/ (through its links too), its
 * fingerprint, size and time, and where it really is when a link leads to it. The record goes where the project goes,
 * so a file can still be looked for after the project moved or Studio's own files were cleared. A file that left the
 * project stays in the record for a while, marked `gone`: its film may still name it.
 *
 * A folder that is no project keeps nothing in it: its record is Studio's own (`media-index/` in the home every
 * OpenFilm on this computer shares), and says only what is in the folder now.
 *
 * Both are worked out from the disk and can be made again: a file whose size and time did not change is not read
 * again, and nothing here is the only copy of anything.
 */
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fingerprint, isFingerprint } from '../../src/media-fingerprint.mjs';
import { sharedHome, sharedPref } from '../../src/locations.mjs';
import { writeAtomic } from './atomic.mjs';
import { kindOf, listFiles, readable } from './files.mjs';
import { compoundOuter } from './parts.mjs';
import { TOOL_DIR, listProjects } from './projects.mjs';

/**
 * @typedef {'video' | 'image' | 'audio'} MediaKind
 * @typedef {{ fp: string, size: number, mtime: number, kind: MediaKind, at?: string, gone?: number }} MediaEntry
 *   `at`: where the file really is, when a link leads to it; `gone`: when it was first found missing from the project
 * @typedef {{ version: 1, files: Record<string, MediaEntry> }} MediaRecord   by project path (`assets/a.mp4`), or by
 *   the path inside an added folder
 * @typedef {{ path: string, size: number, mtime: number, kind: MediaKind, abs: string, at?: string }} Found
 */

const KINDS = new Set(['video', 'image', 'audio']);
/** How long a file that left a project stays in its record. */
const GONE_FOR = 180 * 24 * 3600 * 1000;
/** Files read at once: a few, so a slow disk is not asked for many places at a time. */
const AT_ONCE = 4;
/** An added folder is walked this deep, and no further than this many media files. */
const FOLDER_DEPTH = 12;
const FOLDER_FILES = 200_000;

/** A project's record. */
export const projectRecordFile = (/** @type {string} */ root) => join(root, TOOL_DIR, 'media.json');
/** Where Studio keeps the records of folders that are no projects. */
const indexHome = () => join(sharedHome(), 'media-index');
/** An added folder's record. */
export const folderRecordFile = (/** @type {string} */ root) => join(indexHome(), `${createHash('sha1').update(resolve(root)).digest('hex').slice(0, 16)}.json`);

/** @type {Map<string, { stamp: string, record: MediaRecord }>} */
const records = new Map();
const EMPTY = /** @type {MediaRecord} */ (Object.freeze({ version: 1, files: Object.freeze({}) }));

/** @param {unknown} e @returns {e is MediaEntry} */
const isEntry = (e) => Boolean(e) && typeof e === 'object' && isFingerprint(/** @type {any} */ (e).fp)
  && Number.isFinite(/** @type {any} */ (e).size) && Number.isFinite(/** @type {any} */ (e).mtime) && KINDS.has(/** @type {any} */ (e).kind)
  && (/** @type {any} */ (e).at === undefined || (typeof /** @type {any} */ (e).at === 'string' && isAbsolute(/** @type {any} */ (e).at)))
  && (/** @type {any} */ (e).gone === undefined || Number.isFinite(/** @type {any} */ (e).gone));

/** A record as it is on disk (none, or one that cannot be read: an empty one). @param {string} file @returns {MediaRecord} */
export function readRecord(file) {
  let stamp;
  try {
    const info = statSync(file, { bigint: true });
    stamp = `${info.ino}:${info.size}:${info.mtimeNs}`;
  } catch { records.delete(file); return EMPTY; }
  const kept = records.get(file);
  if (kept?.stamp === stamp) return kept.record;
  /** @type {Record<string, MediaEntry>} */
  const files = {};
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (raw?.version === 1 && raw.files && typeof raw.files === 'object') {
      for (const [path, entry] of Object.entries(raw.files)) if (path && !path.includes('\0') && isEntry(entry)) files[path] = entry;
    }
  } catch { /* unreadable: made again by the next scan */ }
  const record = /** @type {MediaRecord} */ ({ version: 1, files });
  if (records.size >= 256) records.delete(records.keys().next().value ?? '');
  records.set(file, { stamp, record });
  return record;
}

/** Run `work` on each of `items`, a few at a time. @template T @param {T[]} items @param {(item: T) => Promise<void>} work */
async function each(items, work) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, items.length) }, async () => {
    while (next < items.length) await work(/** @type {T} */ (items[next++]));
  }));
}

/**
 * A record brought up to what is on disk: `found` is every media file there now. A file whose size and time are as
 * recorded keeps its fingerprint unread. `stays`: whether a recorded file that was not found is left as it is (it is
 * behind a link that leads nowhere just now); the others are marked gone when `keepGone`, else dropped.
 * @param {MediaRecord} before @param {Found[]} found @param {{ stays?: (path: string) => boolean, keepGone?: boolean, now?: number }} [o]
 */
async function refresh(before, found, { stays = () => false, keepGone = false, now = Date.now() } = {}) {
  /** @type {Record<string, MediaEntry>} */
  const files = {};
  let hashed = 0;
  await each(found, async (f) => {
    const was = before.files[f.path];
    let fp = was && was.size === f.size && was.mtime === f.mtime ? was.fp : null;
    if (!fp) {
      try { fp = await fingerprint(f.abs); } catch { fp = null; }
      if (fp) hashed++;
      /* its bytes are not on this disk just now (a cloud drive's): what was known of it stays */
      else if (was && !was.gone) { files[f.path] = was; return; }
      else return;
    }
    files[f.path] = { fp, size: f.size, mtime: f.mtime, kind: f.kind, ...(f.at ? { at: f.at } : {}) };
  });
  for (const [path, was] of Object.entries(before.files)) {
    if (files[path]) continue;
    if (stays(path)) files[path] = was;
    else if (keepGone && now - (was.gone ?? now) < GONE_FOR) files[path] = was.gone ? was : { ...was, gone: now };
  }
  const sorted = Object.fromEntries(Object.keys(files).sort().map((path) => [path, /** @type {MediaEntry} */ (files[path])]));
  const record = /** @type {MediaRecord} */ ({ version: 1, files: sorted });
  return { record, hashed, changed: JSON.stringify(record) !== JSON.stringify({ version: 1, files: before.files }) };
}

/** Write a record, and forget the one read before it. Never fails: a record is made again by the next scan. */
async function writeRecord(/** @type {string} */ file, /** @type {MediaRecord} */ record) {
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeAtomic(file, `${JSON.stringify(record, null, 1)}\n`);
  } catch { /* a folder that cannot be written (read-only, gone meanwhile) */ }
  records.delete(file);
}

const under = (/** @type {string} */ path, /** @type {string} */ folder) => path === folder || path.startsWith(`${folder}/`);

/**
 * Bring a project's record up to its media: every picture, video and sound under assets/, those reached through its
 * links too. A compound clip's film has no media of its own (it names the project's): the project it is in is scanned.
 * @param {string} root @param {{ now?: number }} [o]
 */
export async function scanProject(root, { now = Date.now() } = {}) {
  const project = compoundOuter(root);
  const listing = await listFiles(project);
  const linked = Object.keys(listing.links).filter((rel) => !listing.links[rel]?.missing);
  const missing = Object.keys(listing.links).filter((rel) => listing.links[rel]?.missing);
  /** @type {Found[]} */
  const found = [];
  for (const f of listing.files) {
    if (!KINDS.has(f.kind) || missing.some((rel) => under(f.path, rel))) continue;
    let abs;
    try { abs = readable(project, f.path); } catch { continue; }
    /** @type {string | undefined} */
    let at;
    if (linked.some((rel) => under(f.path, rel))) { try { at = realpathSync.native(abs); } catch { continue; } }
    found.push({ path: f.path, size: f.size, mtime: f.mtime, kind: /** @type {MediaKind} */ (f.kind), abs, ...(at ? { at } : {}) });
  }
  const file = projectRecordFile(project);
  const { record, hashed, changed } = await refresh(readRecord(file), found, { stays: (path) => missing.some((rel) => under(path, rel)), keepGone: true, now });
  if (changed) await writeRecord(file, record);
  return { root: project, files: found.length, hashed, changed };
}

/**
 * Bring the record of a folder that is no project up to its media, at any depth. Hidden files and folders are left
 * out, and links are not followed (a link back up would never end).
 * @param {string} root
 */
export async function scanFolder(root) {
  const base = resolve(root);
  /** @type {Found[]} */
  const found = [];
  async function walk(/** @type {string} */ dir, /** @type {number} */ depth) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (found.length >= FOLDER_FILES) return;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) { if (depth < FOLDER_DEPTH) await walk(abs, depth + 1); continue; }
      if (!entry.isFile()) continue;
      const kind = kindOf(entry.name);
      if (!KINDS.has(kind)) continue;
      const info = await stat(abs).catch(() => null);
      if (info) found.push({ path: abs.slice(base.length + 1).split(sep).join('/'), size: info.size, mtime: Math.round(info.mtimeMs), kind: /** @type {MediaKind} */ (kind), abs });
    }
  }
  await walk(base, 0);
  const file = folderRecordFile(base);
  const { record, hashed, changed } = await refresh(readRecord(file), found);
  if (changed) await writeRecord(file, record);
  return { root: base, files: found.length, hashed, changed };
}

/** The folders the person added to their media, beside the projects (the shared prefs.json, `mediaFolders`). */
export function mediaFolders() {
  const value = sharedPref('mediaFolders');
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string' && isAbsolute(v)).map((v) => resolve(v)) : [];
}

/** Every place whose media is known: the listed projects that are there, and the added folders. */
export async function mediaPlaces() {
  return { projects: (await listProjects()).filter((p) => !p.missing).map((p) => p.path), folders: mediaFolders() };
}

/**
 * Every media file on record, where it really is: one line for each file in each place, a file that left its project
 * left out.
 * @returns {Promise<{ fp: string, abs: string, size: number, kind: MediaKind, place: string, path: string, project: boolean }[]>}
 */
export async function knownMedia() {
  const { projects, folders } = await mediaPlaces();
  const out = [];
  for (const [roots, project] of /** @type {const} */ ([[projects, true], [folders, false]])) {
    for (const root of roots) {
      const record = readRecord(project ? projectRecordFile(root) : folderRecordFile(root));
      for (const [path, e] of Object.entries(record.files)) {
        if (e.gone) continue;
        out.push({ fp: e.fp, abs: e.at ?? join(root, ...path.split('/')), size: e.size, kind: e.kind, place: root, path, project });
      }
    }
  }
  return out;
}

/**
 * Where the file with this fingerprint is now: every place on record that still holds it, checked on disk (it is
 * there, and its fingerprint is this one), each once.
 * @param {string} fp
 */
export async function whereIs(fp) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {{ abs: string, size: number }[]} */
  const held = [];
  for (const m of await knownMedia()) {
    if (m.fp !== fp || seen.has(m.abs)) continue;
    seen.add(m.abs);
    try {
      const info = await stat(m.abs);
      if (info.isFile() && info.size === m.size && await fingerprint(m.abs, info) === fp) held.push({ abs: m.abs, size: m.size });
    } catch { /* not there any more */ }
  }
  return held;
}

/**
 * The record in numbers: how many places and files, how many different files they are, the room they take, and the
 * room taken by further copies of a file already counted (a file that links lead to from several projects is one).
 */
export async function mediaSummary() {
  const { projects, folders } = await mediaPlaces();
  /** @type {Map<string, { fp: string, size: number }>} */
  const files = new Map();
  for (const m of await knownMedia()) if (!files.has(m.abs)) files.set(m.abs, { fp: m.fp, size: m.size });
  /** @type {Map<string, number>} */
  const different = new Map();
  let bytes = 0;
  for (const { fp, size } of files.values()) { bytes += size; different.set(fp, size); }
  let once = 0;
  for (const size of different.values()) once += size;
  return { projects: projects.length, folders: folders.length, files: files.size, different: different.size, bytes, copies: bytes - once };
}

/**
 * The scans, one at a time and out of the way: a project is scanned a moment after its files last changed
 * (`soon`), and every place once after Studio starts (`sweep`). `onError`: a scan that failed (the next one tries again).
 * @param {{ wait?: number, onError?: (root: string, error: unknown) => void }} [o]
 */
export function createMediaIndexer({ wait = 1500, onError = () => {} } = {}) {
  /** @type {Map<string, NodeJS.Timeout>} */
  const timers = new Map();
  let turn = Promise.resolve();
  let closed = false;
  let scanning = 0;
  /** @param {string} root @param {(root: string) => Promise<unknown>} scan */
  const queue = (root, scan) => {
    scanning++;
    const run = turn.then(async () => {
      try { if (!closed) await scan(root); } catch (e) { onError(root, e); } finally { scanning--; }
    });
    turn = run;
    return run;
  };
  return {
    /** Scan this project once its files have been still for a moment. @param {string} root */
    soon(root) {
      if (closed) return;
      clearTimeout(timers.get(root));
      const timer = setTimeout(() => { timers.delete(root); void queue(root, scanProject); }, wait);
      timer.unref();
      timers.set(root, timer);
    },
    /** Scan every place, one after another. */
    async sweep() {
      const { projects, folders } = await mediaPlaces();
      await Promise.all([...projects.map((root) => queue(root, scanProject)), ...folders.map((root) => queue(root, scanFolder))]);
    },
    /** Whether a scan is under way or waiting. */
    busy: () => scanning > 0 || timers.size > 0,
    /** Every scan asked for so far, done. */
    settled: () => turn,
    close() {
      closed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
