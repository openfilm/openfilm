// @ts-check
/**
 * OpenFilm's recycle bin: what the person deletes in OpenFilm (a file or folder of a project or the library, a project,
 * a skill, a voice, a subject) is kept here until it is put back, deleted for good, or the bin is emptied. It is a
 * folder of the shared home, `recycle/`, one folder per thing deleted:
 *
 *   recycle/<id>/<its name>     the thing itself, moved here as it was (a link stays a link)
 *   recycle/<id>/item.json      { from, at, kind }: where it was (its absolute path), when, what it was
 *
 * Moving is a rename, so only what is on the same disk as the bin comes here; a thing on another disk (a project on an
 * external drive, a NAS) goes to that disk's system trash as before (trash.mjs), where the system can put it back.
 * Where a trash folder is named for deletes (OPENFILM_TRASH_DIR), everything goes there instead.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { sharedHome } from '../../src/locations.mjs';
import { HttpError } from './http.mjs';
import { moveToTrash } from './trash.mjs';

/** What a deleted thing was, as the bin shows it. */
export const RECYCLE_KINDS = /** @type {const} */ (['file', 'folder', 'project', 'skill', 'voice', 'subject']);
/** @typedef {typeof RECYCLE_KINDS[number]} RecycleKind */
/** @typedef {{ id: string, name: string, from: string, at: string, kind: RecycleKind, size: number }} Recycled */

const ITEM = 'item.json';
export const binDir = () => join(sharedHome(), 'recycle');
const ID = /^[0-9a-f-]{36}$/;

/**
 * `path` (absolute) to the bin, or to the system trash when it is on another disk or a trash folder is named.
 * @param {string} path @param {RecycleKind} [kind] what it is; a file or a folder by default
 */
export async function recycle(path, kind) {
  const own = await lstat(path);
  if (process.env.OPENFILM_TRASH_DIR) return moveToTrash(path);
  const bin = binDir();
  await mkdir(bin, { recursive: true });
  if ((await stat(dirname(path))).dev !== (await stat(bin)).dev) return moveToTrash(path);
  const id = randomUUID();
  const dir = join(bin, id);
  await mkdir(dir);
  try {
    await rename(path, join(dir, basename(path)));
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    if (/** @type {NodeJS.ErrnoException} */ (e).code === 'EXDEV') return moveToTrash(path);
    throw e;
  }
  /** @type {Omit<Recycled, 'id' | 'name' | 'size'>} */
  const item = { from: path, at: new Date().toISOString(), kind: kind ?? (own.isDirectory() ? 'folder' : 'file') };
  await writeFile(join(dir, ITEM), `${JSON.stringify(item, null, 2)}\n`);
}

/** A folder's bytes, its own files' (a link is not followed). */
async function sizeOf(/** @type {string} */ path) {
  const own = await lstat(path).catch(() => null);
  if (!own) return 0;
  if (!own.isDirectory()) return own.size;
  let sum = 0;
  for (const entry of await readdir(path).catch(() => [])) sum += await sizeOf(join(path, entry));
  return sum;
}

/** One thing in the bin, or null when its folder is not one. @param {string} id */
async function readItem(id) {
  if (!ID.test(id)) return null;
  const dir = join(binDir(), id);
  try {
    const item = JSON.parse(await readFile(join(dir, ITEM), 'utf8'));
    const name = (await readdir(dir)).find((n) => n !== ITEM);
    if (!name || typeof item?.from !== 'string') return null;
    return /** @type {Recycled} */ ({ id, name, from: item.from, at: String(item.at ?? ''), kind: RECYCLE_KINDS.includes(item.kind) ? item.kind : 'file', size: await sizeOf(join(dir, name)) });
  } catch { return null; }
}

/** What is in the bin, the last deleted first. */
export async function binList() {
  const ids = await readdir(binDir()).catch(() => /** @type {string[]} */ ([]));
  const items = (await Promise.all(ids.map(readItem))).filter((item) => item !== null);
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

/** A name free in folder `dir`: `name`, else `name 2`… with its extension kept. */
function freeName(/** @type {string} */ dir, /** @type {string} */ name) {
  const ext = extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${stem} ${n}${ext}`;
    if (!existsSync(join(dir, candidate))) return candidate;
  }
}

/**
 * Things put back where they were (their folder made again if it is gone; a name taken there gets a number).
 * → each one's path now, and what it was.
 * @param {unknown} ids
 */
export async function binRestore(ids) {
  /** @type {{ id: string, path: string, kind: RecycleKind }[]} */
  const back = [];
  for (const id of asIds(ids)) {
    const item = await readItem(id);
    if (!item) throw new HttpError(404, 'That is not in the recycle bin any more.');
    const folder = dirname(item.from);
    await mkdir(folder, { recursive: true });
    const path = join(folder, freeName(folder, basename(item.from)));
    await rename(join(binDir(), id, item.name), path);
    await rm(join(binDir(), id), { recursive: true, force: true });
    back.push({ id, path, kind: item.kind });
  }
  return back;
}

/** Things deleted for good; no ids: everything in the bin (emptied). @param {unknown} [ids] */
export async function binDelete(ids) {
  const all = ids === undefined;
  const which = all ? (await readdir(binDir()).catch(() => [])).filter((id) => ID.test(id)) : asIds(ids);
  for (const id of which) await rm(join(binDir(), id), { recursive: true, force: true });
}

function asIds(/** @type {unknown} */ ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 5000 || ids.some((id) => typeof id !== 'string' || !ID.test(id))) throw new HttpError(400, 'Things of the recycle bin, by their ids.');
  return /** @type {string[]} */ (ids);
}
