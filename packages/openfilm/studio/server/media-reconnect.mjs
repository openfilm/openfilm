// @ts-check
/**
 * Media that went missing, found again. A link whose file was renamed or moved, a disk that came back under another
 * name, a file renamed inside the project's own folder: the film still names the old place, and its clips have
 * nothing to show. What a project recorded of each file (media-index.mjs: its fingerprint, and where it was) is
 * enough to look for it, and what is found is connected again without asking.
 *
 * Looked for, nearest first:
 *   where it was      still there, though this Studio was never told it may read it (a project brought to another
 *                     computer of the person's, a Studio set up again)
 *   in the project    the same file under another name in assets/: the clips are pointed at it
 *   another disk      the path it had, on each other disk that is there (a disk renamed, a drive letter that changed)
 *   near where it was the folders around its old place, a few levels and so many files at most
 *   on record         the same file in a folder the person added, or in another project
 *   where told        a folder the person points at, all of it
 *
 * A file is taken for the missing one only when its fingerprint is the recorded one. So a project from elsewhere
 * cannot have a link of its own connected to a file here it does not already hold the bytes of. Only a folder the
 * person points at themself is also searched by name, for media that was never recorded.
 */
import { readdirSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, parse, resolve, sep } from 'node:path';
import { fingerprint } from '../../src/media-fingerprint.mjs';
import { mediaReferences } from '../../src/media-links.mjs';
import { kindOf, linkAt, listFiles, relink, repoint } from './files.mjs';
import { readProjectFilm } from './film.mjs';
import { projectRecordFile, readRecord, scanProject, whereIs } from './media-index.mjs';
import { compoundOuter } from './parts.mjs';

/**
 * @typedef {{ path: string, was: string, fp?: string, size?: number }} Wanted   a file looked for: its project path,
 *   where it was, and what was recorded of it
 * @typedef {{ path: string, name: string, folder: boolean, linked: boolean, was: string, files: Wanted[] }} Missing
 *   what is missing: a link to a file or to a folder (`linked`), or a file the film names that is not in the project;
 *   `files`: the file itself, or each recorded file of the folder
 * @typedef {{ path: string, to: string }} Found   a project path connected again, and what it leads to now
 */

const MEDIA = new Set(['video', 'image', 'audio']);
/** Folders never looked into: a system's own, and what holds programs, not footage (a photo library and an app are folders too). */
const SKIP = new Set(['node_modules', 'Library', 'Applications', 'System', 'AppData', 'Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', '$RECYCLE.BIN', 'System Volume Information']);
/** Around a file's old place, unasked: this many media files looked at, this many levels below the nearest folder still there. */
const NEAR_FILES = 20_000;
const NEAR_BELOW = 2;
/** In a folder the person pointed at. */
const TOLD_FILES = 500_000;
const TOLD_DEPTH = 16;
/** A folder link is placed by this many of its recorded files at most. */
const FOLDER_SAMPLE = 8;
const skipped = (/** @type {string} */ name) => name.startsWith('.') || SKIP.has(name) || /\.(photoslibrary|app)$/i.test(name);

const under = (/** @type {string} */ path, /** @type {string} */ folder) => path === folder || path.startsWith(`${folder}/`);
const posixTail = (/** @type {string} */ path, /** @type {string} */ folder) => path.slice(folder.length + 1);

/**
 * What a project is missing: links that lead nowhere, and files its clips name that are not in it.
 * @param {string} root @returns {Promise<Missing[]>}
 */
export async function missingMedia(root) {
  const project = compoundOuter(root);
  const listing = await listFiles(project);
  const record = readRecord(projectRecordFile(project)).files;
  const references = mediaReferences(project);
  /** @type {Missing[]} */
  const out = [];
  for (const [rel, link] of Object.entries(listing.links)) {
    if (!link.missing) continue;
    const inside = Object.entries(record).filter(([path, e]) => !e.gone && path.startsWith(`${rel}/`));
    const one = record[rel];
    const reference = references.find((r) => r.name === rel);
    /* a link that leads nowhere does not say what it led to: a folder when files were recorded in it */
    const folder = reference ? reference.directory : inside.length > 0 || (!one && !MEDIA.has(kindOf(rel)));
    out.push({
      path: rel, name: basename(rel), folder, linked: true, was: link.to,
      files: folder
        ? inside.map(([path, e]) => ({ path, was: e.at ?? join(link.to, ...posixTail(path, rel).split('/')), fp: e.fp, size: e.size }))
        : [{ path: rel, was: one?.at ?? link.to, ...(one ? { fp: one.fp, size: one.size } : {}) }],
    });
  }
  const film = await readProjectFilm(project).catch(() => null);
  const here = new Set(listing.files.map((f) => f.path));
  /** @type {Set<string>} */
  const named = new Set();
  for (const track of film?.value?.tracks ?? []) {
    for (const clip of track.clips ?? []) {
      const src = typeof clip.src === 'string' ? clip.src.replace(/#.*$/, '') : '';
      if (src.startsWith('assets/') && MEDIA.has(kindOf(src)) && !here.has(src)) named.add(src);
    }
  }
  for (const src of named) {
    /* inside a link that leads nowhere: the link is what is missing */
    if (out.some((m) => under(src, m.path))) continue;
    const e = record[src];
    out.push({ path: src, name: basename(src), folder: false, linked: false, was: e?.at ?? join(project, ...src.split('/')), files: [{ path: src, was: e?.at ?? join(project, ...src.split('/')), ...(e ? { fp: e.fp, size: e.size } : {}) }] });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

/** Whether the file at `abs` is the wanted one: there, of its size, with its fingerprint. */
async function isIt(/** @type {string} */ abs, /** @type {Wanted} */ wanted) {
  if (!wanted.fp) return false;
  try {
    const info = await stat(abs);
    return info.isFile() && info.size === wanted.size && await fingerprint(abs, info) === wanted.fp;
  } catch { return false; }
}

/**
 * The same path on each other disk that is there: /Volumes/A/… as /Volumes/B/…, D:\… as E:\…, a disk under /media,
 * /run/media or /mnt as its neighbours. `others`: the disks beside the one at `path` (for a test).
 * @param {string} path @param {{ platform?: string, others?: (at: string) => string[] }} [o]
 */
export function onOtherDisks(path, { platform = process.platform, others } = {}) {
  const list = others ?? ((/** @type {string} */ at) => { try { return readdirSync(at, { withFileTypes: true }).filter((d) => !d.name.startsWith('.')).map((d) => d.name); } catch { return []; } });
  if (platform === 'win32') {
    const m = /^([A-Za-z]):[\\/](.+)$/.exec(path);
    if (!m) return [];
    return 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((l) => l !== /** @type {string} */ (m[1]).toUpperCase()).map((l) => `${l}:\\${m[2]}`);
  }
  for (const pattern of platform === 'darwin' ? [/^(\/Volumes)\/([^/]+)\/(.+)$/] : [/^(\/media\/[^/]+)\/([^/]+)\/(.+)$/, /^(\/run\/media\/[^/]+)\/([^/]+)\/(.+)$/, /^(\/mnt)\/([^/]+)\/(.+)$/]) {
    const m = pattern.exec(path);
    if (m) return list(/** @type {string} */ (m[1])).filter((name) => name !== m[2]).map((name) => `${m[1]}/${name}/${m[3]}`);
  }
  return [];
}

/**
 * Where to look around a file's old place: the folder above the nearest one still there (a file moved to a folder
 * beside its own is one level up and one down), and how many levels above the file's own folder that is. Kept out of
 * where a search would be too wide, or would have the system ask the person for leave they never thought of giving:
 * the system's own disk's top, the home folder and what is above it, and the place the disks are listed in. Null when
 * no folder near enough is there.
 */
async function nearestFolder(/** @type {string} */ path, platform = process.platform) {
  const home = resolve(homedir());
  const wide = (/** @type {string} */ at) => {
    const system = platform === 'win32' ? at.toLowerCase() === `${(process.env.SystemDrive || 'C:').toLowerCase()}\\` : at === parse(at).root;
    return system || at === home || home.startsWith(`${at}${sep}`) || /^\/(Volumes|mnt|media(\/[^/]+)?|run\/media(\/[^/]+)?)$/.test(at);
  };
  let at = dirname(path);
  for (let up = 0; up < 6; up++) {
    const info = await stat(at).catch(() => null);
    if (info?.isDirectory()) {
      if (wide(at)) return null;
      const above = dirname(at);
      return above !== at && !wide(above) ? { at: above, up: up + 1 } : { at, up };
    }
    if (dirname(at) === at) return null;
    at = dirname(at);
  }
  return null;
}

/**
 * Look through `start`, nearest folders first, for the wanted files: one of a wanted size is read for its
 * fingerprint. `byName`: a wanted file that was never recorded is taken by its name (a folder the person pointed at
 * only). Each wanted file found is given to `found` once. Returns when all are found, or `files` media files were
 * looked at.
 * @param {string} start @param {Wanted[]} wanted @param {(w: Wanted, abs: string) => void} found
 * @param {{ files: number, depth: number, byName?: boolean }} limits
 */
async function search(start, wanted, found, { files, depth, byName = false }) {
  /** @type {Map<number, Wanted[]>} */
  const bySize = new Map();
  /** @type {Map<string, Wanted[]>} */
  const names = new Map();
  let left = 0;
  for (const w of wanted) {
    if (w.fp && w.size != null) { bySize.set(w.size, [...(bySize.get(w.size) ?? []), w]); left++; }
    else if (byName) { const key = basename(w.path).toLowerCase(); names.set(key, [...(names.get(key) ?? []), w]); left++; }
  }
  if (!left) return;
  /** @type {Set<Wanted>} */
  const done = new Set();
  /** @type {[string, number][]} */
  const queue = [[start, 0]];
  let seen = 0;
  for (let i = 0; i < queue.length && left > 0 && seen < files; i++) {
    const [dir, level] = /** @type {[string, number]} */ (queue[i]);
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (left <= 0 || seen >= files) break;
      if (skipped(entry.name)) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) { if (level < depth) queue.push([abs, level + 1]); continue; }
      if (!entry.isFile() || !MEDIA.has(kindOf(entry.name))) continue;
      seen++;
      const info = await stat(abs).catch(() => null);
      if (!info) continue;
      const sized = (bySize.get(info.size) ?? []).filter((w) => !done.has(w));
      if (sized.length) {
        const fp = await fingerprint(abs, info).catch(() => null);
        for (const w of sized) if (fp && w.fp === fp) { done.add(w); left--; found(w, abs); }
      }
      for (const w of (names.get(entry.name.toLowerCase()) ?? []).filter((w) => !done.has(w))) { done.add(w); left--; found(w, abs); }
    }
  }
}

/**
 * Find what a project is missing and connect it again. `folders`: places the person pointed at, searched whole, and
 * by name too for media that was never recorded; without any, only what can be found unasked is looked for (a link's
 * file wherever it went; a file of the project's own folder only under another name in that folder). Returns
 * what was connected, and what is still missing.
 * @param {string} root @param {{ folders?: string[], platform?: string, others?: (at: string) => string[] }} [o]
 * @returns {Promise<{ found: Found[], missing: Missing[] }>}
 */
export async function reconnect(root, { folders = [], platform, others } = {}) {
  const project = compoundOuter(root);
  /* the record as the folder is now: a file renamed in it is on record under its new name */
  await scanProject(project).catch(() => {});
  const missing = await missingMedia(project);
  if (!missing.length) return { found: [], missing };
  const record = readRecord(projectRecordFile(project)).files;
  /** where each wanted file is now @type {Map<Wanted, string>} */
  const located = new Map();
  /** @type {Found[]} */
  const found = [];
  /* a folder is placed by a few of its files */
  const sample = (/** @type {Missing} */ m) => (m.folder ? m.files.slice(0, FOLDER_SAMPLE) : m.files);
  /* a file that left the project's own folder may have been taken out on purpose: unasked, only the same file
     under another name in the folder is taken for it; elsewhere it is looked for when the person asks */
  const asked = folders.length > 0;
  const wanted = missing.filter((m) => m.linked || asked).flatMap(sample);
  const open = () => wanted.filter((w) => !located.has(w));

  /* where it was: there, and the recorded file, though not a place this Studio was told of */
  for (const w of wanted) if (!w.was.startsWith(`${project}${sep}`) && await isIt(w.was, w)) located.set(w, w.was);
  /* in the project: the same file under another name (renamed in the folder, or where a link leads) */
  for (const m of missing) {
    if (m.linked) continue;
    const w = /** @type {Wanted} */ (m.files[0]);
    const twin = w.fp ? Object.entries(record).find(([path, e]) => path !== w.path && !e.gone && e.fp === w.fp && !missing.some((other) => under(path, other.path))) : null;
    if (twin && await repoint(project, w.path, twin[0])) { located.set(w, twin[0]); found.push({ path: w.path, to: twin[0] }); }
  }
  /* the path it had, on another disk */
  for (const w of open()) {
    for (const candidate of onOtherDisks(w.was, { platform, others })) {
      if (await isIt(candidate, w)) { located.set(w, candidate); break; }
    }
  }
  /* near where it was */
  /** @type {Map<string, { up: number, wanted: Wanted[] }>} */
  const near = new Map();
  for (const w of open()) {
    const folder = w.fp ? await nearestFolder(w.was) : null;
    if (!folder) continue;
    const group = near.get(folder.at) ?? { up: folder.up, wanted: [] };
    group.up = Math.max(group.up, folder.up);
    group.wanted.push(w);
    near.set(folder.at, group);
  }
  for (const [at, group] of near) await search(at, group.wanted, (w, abs) => located.set(w, abs), { files: NEAR_FILES, depth: group.up + NEAR_BELOW });
  /* on record: in a folder the person added, or in another project (a copy of that project's own, last). Never
     one in this project's own folder: a link is not pointed back into the project it is in */
  for (const w of open()) {
    if (!w.fp) continue;
    const at = (await whereIs(w.fp)).find((c) => !c.abs.startsWith(`${project}${sep}`));
    if (at) located.set(w, at.abs);
  }
  /* where the person pointed */
  for (const folder of folders) await search(resolve(folder), open(), (w, abs) => located.set(w, abs), { files: TOLD_FILES, depth: TOLD_DEPTH, byName: true });

  for (const m of missing) {
    if (found.some((f) => f.path === m.path)) continue;
    try {
      if (!m.folder) {
        const to = located.get(/** @type {Wanted} */ (m.files[0]));
        if (!to) continue;
        if (m.linked) await relink(project, m.path, to); else await linkAt(project, m.path, to);
        found.push({ path: m.path, to });
        continue;
      }
      /* a folder: where its files are now says where it is, when they kept their places in it */
      /** @type {Map<string, number>} */
      const votes = new Map();
      for (const w of sample(m)) {
        const to = located.get(w);
        const tail = posixTail(w.path, m.path).split('/').join(sep);
        if (to?.endsWith(`${sep}${tail}`)) { const at = to.slice(0, -tail.length - 1); votes.set(at, (votes.get(at) ?? 0) + 1); }
      }
      /* pointed at: the folder itself, or one of its name inside the place given, when nothing was recorded of its files */
      if (!votes.size && !m.files.length) {
        for (const folder of folders) {
          for (const candidate of [resolve(folder), join(resolve(folder), basename(m.was))]) {
            if (basename(candidate) === basename(m.was) && (await stat(candidate).catch(() => null))?.isDirectory()) { votes.set(candidate, 1); break; }
          }
        }
      }
      const to = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!to || !(await stat(to).catch(() => null))?.isDirectory()) continue;
      await relink(project, m.path, to);
      found.push({ path: m.path, to });
    } catch { /* could not be connected (the place refused, the link changed meanwhile): still missing */ }
  }
  if (found.length) await scanProject(project).catch(() => {});
  return { found, missing: found.length ? await missingMedia(project) : missing };
}

/**
 * What follows a project's scan (media-index.mjs createMediaIndexer `onProject`): when something is missing, it is
 * looked for unasked, and `onFound` hears how many were connected again. The same things still missing are not looked
 * for again for a while: a search that found nothing a moment ago finds nothing now.
 * @param {{ onFound: (root: string, found: Found[]) => void, again?: number, now?: () => number }} o
 */
export function createReconnector({ onFound, again = 5 * 60_000, now = Date.now }) {
  /** @type {Map<string, { missing: string, at: number }>} */
  const tried = new Map();
  /** @type {Set<string>} */
  const looked = new Set();
  /** @param {string} root @param {{ changed: boolean, missing: number }} scan */
  return async (root, scan) => {
    /* nothing moved since this project was last looked at, and no link leads nowhere */
    if (looked.has(root) && !scan.changed && !scan.missing && !tried.has(root)) return;
    looked.add(root);
    const missing = (await missingMedia(root)).map((m) => m.path).join('\n');
    if (!missing) { tried.delete(root); return; }
    const last = tried.get(root);
    if (last && last.missing === missing && now() - last.at < again) return;
    tried.set(root, { missing, at: now() });
    const { found, missing: left } = await reconnect(root);
    if (!left.length) tried.delete(root);
    else tried.set(root, { missing: left.map((m) => m.path).join('\n'), at: now() });
    if (found.length) onFound(root, found);
  };
}
