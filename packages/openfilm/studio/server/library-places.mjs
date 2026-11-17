// @ts-check
/**
 * The library is one folder (saved.mjs libraryRoot): each folder at its top is one of the person's, made here or linked
 * from elsewhere (another disk, a NAS). The library drawer's side bar lists those beside the packs of the Community
 * (OpenFilm's own among them), in the person's order: the shelf, entries `saved/<folder>` and `pack:<group>`, with the
 * packs taken out of it (`hidden`, OpenFilm's own ones: the Community's are taken out by not being added). Kept in the
 * library folder itself (SHELF_FILE), so every OpenFilm on the computer that shares the library shows the same. What is
 * saved without a folder asked for goes to the first of the person's folders in that order.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { lstat, mkdir, readdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { savedRoot } from '../../src/locations.mjs';
import { cleanName, inside } from './files.mjs';
import { LIBRARY, libraryPath, libraryRoot } from './saved.mjs';

const SHELF_FILE = '.openfilm-shelf.json';
/** The first place's name when no window has said the person's word for it yet. */
const FALLBACK = 'Library';

const beneath = (/** @type {string} */ path, /** @type {string} */ parent) => path === parent || path.startsWith(`${parent}/`);
const PACK = /^pack:[\w.@/-]{1,200}$/;
const validPath = (/** @type {unknown} */ path) => typeof path === 'string' && path.startsWith(`${LIBRARY}/`) && !path.slice(LIBRARY.length + 1).split('/').some((part) => !part || part === '.' || part === '..');
const valid = (/** @type {unknown} */ entry) => validPath(entry) || (typeof entry === 'string' && PACK.test(entry));

/** @returns {{ shelf?: unknown, hidden?: unknown } | null} */
function readFile() {
  try { return JSON.parse(readFileSync(join(savedRoot(), SHELF_FILE), 'utf8')); } catch { return null; }
}

/** The order of the side bar's folders and packs, or null when it was never made (the library is as older versions left it). */
export function readShelf() {
  const raw = readFile()?.shelf;
  return Array.isArray(raw) ? [...new Set(raw.filter(valid))] : null;
}

/** OpenFilm's own packs taken out of the library (`pack:<group>`). */
export function readHidden() {
  const raw = readFile()?.hidden;
  return Array.isArray(raw) ? [...new Set(raw.filter((e) => typeof e === 'string' && PACK.test(e)))] : [];
}

/** @param {unknown} entries @param {unknown} [hidden] kept as it is when not given */
export function writeShelf(entries, hidden) {
  const bad = (/** @type {unknown} */ list) => !Array.isArray(list) || list.length > 2000;
  if (bad(entries) || (hidden !== undefined && bad(hidden))) throw Object.assign(new Error('A list of library folders and packs, please.'), { status: 400 });
  const next = [...new Set(/** @type {unknown[]} */ (entries).filter(valid))];
  const out = hidden === undefined ? readHidden() : [...new Set(/** @type {unknown[]} */ (hidden).filter((e) => typeof e === 'string' && PACK.test(e)))];
  const root = savedRoot();
  mkdirSync(root, { recursive: true });
  const file = join(root, SHELF_FILE);
  writeFileSync(`${file}.${process.pid}.tmp`, `${JSON.stringify({ version: 1, shelf: next, hidden: out }, null, 2)}\n`);
  renameSync(`${file}.${process.pid}.tmp`, file);
  return next;
}

/** A library folder renamed or moved: the shelf follows it. */
export function shelfMoved(/** @type {string} */ from, /** @type {string} */ to) {
  const shelf = readShelf();
  if (shelf?.some((path) => beneath(path, from))) writeShelf(shelf.map((path) => (beneath(path, from) ? to + path.slice(from.length) : path)));
}

/** A library folder taken away: off the shelf. */
export function shelfRemoved(/** @type {string} */ path) {
  const shelf = readShelf();
  if (shelf?.some((p) => beneath(p, path))) writeShelf(shelf.filter((p) => !beneath(p, path)));
}

const isBundle = async (/** @type {string} */ dir) => Boolean(await stat(join(dir, 'saved.json')).catch(() => null));

/**
 * The first time: the library's top made places only. A folder `name` (the person's word for the media library) is
 * made, or the one of that name used, and what lay loose at the top (files, saved clips, links to files) moves into it;
 * folders and linked folders already there are places as they are. The shelf then holds that one place.
 * `moved(from, to)` is told of each thing moved, by library paths (so what remembers them follows).
 * @param {string} [name] @param {(from: string, to: string) => Promise<void>} [moved]
 */
export async function ensureShelf(name, moved) {
  const kept = readShelf();
  if (kept) return kept;
  const root = await libraryRoot();
  const place = cleanName(name ?? '') || FALLBACK;
  const dir = join(root, place);
  const there = await lstat(dir).catch(() => null);
  if (!there?.isDirectory() || await isBundle(dir)) {
    if (there) throw Object.assign(new Error(`${place} is already there and is not a folder.`), { status: 409 });
    await mkdir(dir);
  }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === place) continue;
    const abs = join(root, entry.name);
    const folder = entry.isSymbolicLink() ? (await stat(abs).catch(() => null))?.isDirectory() ?? true : entry.isDirectory() && !await isBundle(abs);
    if (folder) continue;
    let free = entry.name;
    for (let n = 2; await lstat(join(dir, free)).catch(() => null); n++) free = entry.name.replace(/(\.[^.]*)?$/, ` ${n}$1`);
    // eslint-disable-next-line no-await-in-loop
    await rename(abs, join(dir, free));
    // eslint-disable-next-line no-await-in-loop
    await moved?.(libraryPath(entry.name), libraryPath(`${place}/${free}`));
  }
  const shelf = readShelf();
  return shelf ?? writeShelf([libraryPath(place)]);
}

/**
 * Where a thing is saved when no place was asked for: the first shelf place that is a folder now, else the first
 * folder made at the library's top, else a new one.
 * @param {(from: string, to: string) => Promise<void>} [moved]
 */
export async function defaultPlace(moved) {
  const root = await libraryRoot();
  const shelf = await ensureShelf(undefined, moved);
  for (const path of shelf.filter(validPath)) {
    // eslint-disable-next-line no-await-in-loop
    const info = await stat(inside(root, path.slice(LIBRARY.length + 1))).catch(() => null);
    if (info?.isDirectory()) return path;
  }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    // eslint-disable-next-line no-await-in-loop
    if (!entry.name.startsWith('.') && entry.isDirectory() && !await isBundle(join(root, entry.name))) return libraryPath(entry.name);
  }
  await mkdir(join(root, FALLBACK), { recursive: true });
  return libraryPath(FALLBACK);
}
