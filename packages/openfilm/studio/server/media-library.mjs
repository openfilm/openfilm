// @ts-check
/**
 * Mine, the person's own media (saved.mjs), for an agent (media-library-get.mjs): what is found there, and a file of
 * it brought into a project by its fingerprint.
 *
 * Mine is the Saved folder and the folders the person made in it, with what they linked into them from this computer
 * (a NAS, another disk), followed to where it is kept (src/media-links.mjs). It is read straight from the disk: it is
 * the person's to keep small, and a linked folder is read no further than `SAVED_FILES` files.
 *
 * Its place is named `saved`, a file of it by its path from its top (`Brand/logo.png`). Nothing outside it is read.
 */
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, sep } from 'node:path';
import { fingerprint } from '../../src/media-fingerprint.mjs';
import { readableLink } from '../../src/media-links.mjs';
import { bringIn, kindOf, readable } from './files.mjs';
import { libraryRoot as savedRoot } from './saved.mjs';
import { carryMade, wordsByFingerprint } from './media-made.mjs';
import { projectRecordFile, readRecord, scanProject } from './media-index.mjs';
import { TOOL_DIR } from './projects.mjs';

const KINDS = new Set(['video', 'image', 'audio']);
/** Folders that are a tool's or a system's, not media: not read. */
const SKIP = new Set(['node_modules', TOOL_DIR, '$RECYCLE.BIN', 'System Volume Information']);
const shown = (/** @type {string} */ name) => !name.startsWith('.') && !SKIP.has(name) && !/\.(photoslibrary|app|fcpbundle|imovielibrary)$/i.test(name);
/** Folders of Saved looked into at most. */
const SAVED_DEPTH = 6;
/** Files of Saved looked at at most: a folder linked into it may hold a whole shoot. */
const SAVED_FILES = 5000;

/**
 * @typedef {{ place: string, root: string, name: string }} Place   `root`: the folder it is
 * @typedef {{ path: string, abs: string, kind: 'video' | 'image' | 'audio', size: number, mtime: number }} SavedFile
 *   `path`: from Saved's top, `/` between folders
 * @typedef {{ place: string, where: string, name: string, path: string, kind: 'video' | 'image' | 'audio', size: number, mtime: number }} Found
 *   `where`: the folders it is in, to read (`Saved / Shoots / beach`)
 */

/** The place a name stands for, or null when there is none. @param {unknown} place @returns {Promise<Place | null>} */
export async function placeOf(place) {
  return place === 'saved' ? { place, root: await savedRoot(), name: 'Saved' } : null;
}

/** A path inside `root` as the disk has it, or null for one that leaves it. @param {string} root @param {unknown} path '' for its top */
function inPlace(root, path) {
  if (typeof path !== 'string' || path.includes('\0') || path.includes('\\')) return null;
  const parts = path.split('/').filter(Boolean);
  if (parts.some((p) => p === '..' || p === '.' || !shown(p))) return null;
  const abs = join(root, ...parts);
  return abs === root || abs.startsWith(`${root}${sep}`) ? abs : null;
}

/** A media file of a place, as it is read (through a link the person made), or null. @param {Place} at @param {unknown} path */
export function fileIn(at, path) {
  const abs = inPlace(at.root, path);
  return abs && abs !== at.root && KINDS.has(kindOf(basename(abs))) ? { abs } : null;
}

/** The plain files of Saved (not the clips, groups and pages kept there), read through the person's links. @returns {Promise<SavedFile[]>} */
export async function savedFiles() {
  const root = await savedRoot();
  /** @type {SavedFile[]} */
  const out = [];
  async function walk(/** @type {string} */ dir, /** @type {string} */ rel, /** @type {number} */ depth) {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (out.length >= SAVED_FILES) return;
      if (!shown(e.name)) continue;
      const abs = join(dir, e.name);
      const path = rel ? `${rel}/${e.name}` : e.name;
      /* a link the person made is followed to a place they linked; any other leads nowhere */
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
 * Files of Mine whose name or folders hold every word asked for (as do the words a service was asked for it with,
 * for media a service made), of one kind when asked; the newest first, by name, or the largest first. At most `limit`
 * are returned; `total` is how many matched.
 * @param {{ q?: string, kind?: string | null, sort?: 'date' | 'name' | 'size', limit?: number }} [asked]
 * @returns {Promise<{ files: Found[], total: number }>}
 */
export async function searchLibrary({ q = '', kind = null, sort = 'date', limit = 300 } = {}) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  /* the words a file was made with: read only when words are asked, by each file's fingerprint */
  const made = words.length ? await wordsByFingerprint() : new Map();
  /** @type {Found[]} */
  const found = [];
  for (const f of await savedFiles()) {
    if (kind && f.kind !== kind) continue;
    const cut = f.path.lastIndexOf('/');
    const where = cut < 0 ? 'Saved' : `Saved / ${f.path.slice(0, cut).split('/').join(' / ')}`;
    if (words.length) {
      const fp = made.size ? await fingerprint(f.abs).catch(() => null) : null;
      const hay = `${where} / ${basename(f.path)}\n${(fp && made.get(fp)) ?? ''}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
    }
    found.push({ place: 'saved', where, name: basename(f.path), path: f.path, kind: f.kind, size: f.size, mtime: f.mtime });
  }
  found.sort(sort === 'name'
    ? (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    : sort === 'size' ? (a, b) => b.size - a.size : (a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
  return { files: found.slice(0, Math.max(1, Math.min(2000, limit))), total: found.length };
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

/**
 * The file of Mine with this fingerprint, used in the project at `root`: its path there, or null when Mine has it no
 * more (the project's own, under any name, is itself).
 * @param {string} fp @param {string} root
 */
export async function takeByFingerprint(fp, root) {
  for (const f of await savedFiles()) if (await fingerprint(f.abs).catch(() => null) === fp) return takeInto(root, f.abs);
  return Object.entries(readRecord(projectRecordFile(root)).files).find(([, e]) => e.fp === fp && !e.gone)?.[0] ?? null;
}
