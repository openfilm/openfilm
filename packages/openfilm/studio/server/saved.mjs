// @ts-check
/**
 * What the person saved to use again in any project: a clip as the film has it (its place, its look, the changes made
 * in its page), several clips together as they were laid out (a group: each one's track and time from the first), or a
 * file of the project, each with every file it needs. A saved thing is a copy, and so is what is taken from it:
 * changing one never changes the other, as a template is used in an editor.
 *
 *   <Saved>/<id>/saved.json   { version, name, savedAt, kind: 'clip' | 'group' | 'file', clip | clips | path,
 *                               durationMs?, w?, h?, template? }   a group's clips: { track, at, clip }, its tracks
 *                               counted from the top one it had, `at` seconds from its first clip
 *   <Saved>/<id>/files/…      the clip's file and what it loads (closure.mjs), at the places they had in its project,
 *                             so a page's own references still find what they name
 *   <Saved>/<id>/poster.jpg   its picture, when one could be drawn
 *
 * `<Saved>` is src/locations.mjs savedRoot(). Taken into a project, the files go to `saved/<id>/` in it (the places
 * they had, under that folder), once: taken again, what is there already is used.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { FILM_FILE, clipKind, filmHtml } from '../../src/film-doc.mjs';
import { savedRoot } from '../../src/locations.mjs';
import { STUDIO_STATE, filmClosure, folderView } from './closure.mjs';
import { readProjectFilm } from './film.mjs';
import { moveToTrash } from './trash.mjs';

export class SavedError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const VERSION = 1;
/** The folder a project keeps what it took from the saved things in. */
export const TAKEN_DIR = 'saved';
const ID = /^[\p{L}\p{N}][\p{L}\p{N}-]{0,63}$/u;
/** A page whose own CSS sets custom properties on :root (or html): the inspector offers them as its template's controls. */
const ROOT_VARS = /(?::root|\bhtml)\s*(?:,[^{]*)?\{[^}]*--[\w-]+\s*:/i;

/**
 * @typedef {{ id: string, name: string, kind: 'clip' | 'group' | 'file', savedAt: string, main: string, durationMs?: number,
 *   w?: number, h?: number, template?: boolean, count?: number, poster: boolean }} SavedItem
 */

/** A name for its folder: the words of its name, and a few letters that make it its own. */
export function newSavedId(/** @type {string} */ name) {
  const words = name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return `${words || 'saved'}-${randomBytes(3).toString('hex')}`;
}

const dirOf = (/** @type {string} */ id) => {
  if (typeof id !== 'string' || !ID.test(id)) throw new SavedError('no such saved item', 404);
  return join(savedRoot(), id);
};

/** @param {string} id */
async function readItem(id) {
  const dir = dirOf(id);
  const raw = await readFile(join(dir, 'saved.json'), 'utf8').catch(() => null);
  const item = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : null;
  if (!item || typeof item !== 'object' || !['clip', 'group', 'file'].includes(item.kind)) throw new SavedError('no such saved item', 404);
  if (item.kind === 'group' && !(Array.isArray(item.clips) && item.clips.length)) throw new SavedError('no such saved item', 404);
  return { dir, item };
}

/** Its files, by their place in the project it came from. @param {string} dir @returns {Promise<string[]>} */
async function filesOf(dir) {
  const base = join(dir, 'files');
  const entries = await readdir(base, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath ?? e.path, e.name).slice(base.length + 1).split('\\').join('/'));
}

/**
 * The files a clip needs in project `root`: its own and what it loads, read as the film would (closure.mjs) from a film
 * holding that clip alone. @param {string} root @param {Record<string, unknown> & { src: string }} clip
 */
async function clipFiles(root, clip) {
  const folder = folderView(root);
  const film = filmHtml({ tracks: [{ clips: [{ ...clip, id: 'saved' }] }] });
  const held = await filmClosure({
    ...folder,
    size: (path) => (path === FILM_FILE ? Promise.resolve(Buffer.byteLength(film)) : folder.size(path)),
    text: (path) => (path === FILM_FILE ? Promise.resolve(film) : folder.text(path)),
  });
  const files = [...held.keys()].filter((path) => path !== FILM_FILE && !STUDIO_STATE.includes(path));
  /* a version of a project keeps every page beside a page, in case one loads it; a saved clip needs only the pages it
     names (another clip's page beside it is not its) */
  const texts = new Map();
  for (const path of files) if (/\.(html?|css|m?js|json|svg)$/i.test(path)) texts.set(path, await folder.text(path) ?? '');
  const named = (/** @type {string} */ page) => [...texts].some(([path, text]) => path !== page && text.includes(posix.basename(page)));
  return files.filter((path) => !/\.html?$/i.test(path) || path === clip.src || named(path));
}

/** Copies `files` of project `root` into a new saved item and writes what it is. @returns {Promise<SavedItem>} */
async function keep(/** @type {string} */ root, /** @type {string[]} */ files, /** @type {Record<string, unknown>} */ about, /** @type {(() => Promise<Buffer | null>) | null} */ poster) {
  const name = String(about.name || 'Saved').slice(0, 120);
  const id = newSavedId(name);
  const dir = join(savedRoot(), id);
  await mkdir(join(dir, 'files'), { recursive: true });
  let template = false;
  for (const rel of files) {
    const to = join(dir, 'files', rel);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(join(root, rel), to);
    if (!template && /\.(html?|css)$/i.test(rel)) template = ROOT_VARS.test(await readFile(to, 'utf8').catch(() => ''));
  }
  const picture = poster ? await poster().catch(() => null) : null;
  if (picture) await writeFile(join(dir, 'poster.jpg'), picture);
  const item = { version: VERSION, ...about, name, savedAt: new Date().toISOString(), ...(template ? { template: true } : {}) };
  await writeFile(join(dir, 'saved.json'), `${JSON.stringify(item, null, 2)}\n`);
  return summary(id, item, Boolean(picture));
}

/** @returns {SavedItem} */
function summary(/** @type {string} */ id, /** @type {any} */ item, /** @type {boolean} */ poster) {
  const num = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
  const durationMs = num(item.durationMs);
  const w = num(item.w);
  const h = num(item.h);
  return {
    id,
    name: typeof item.name === 'string' ? item.name : id,
    kind: item.kind,
    savedAt: typeof item.savedAt === 'string' ? item.savedAt : '',
    main: item.kind === 'clip' ? String(item.clip?.src ?? '') : item.kind === 'group' ? String(item.clips[0]?.clip?.src ?? '') : String(item.path ?? ''),
    ...(item.kind === 'group' ? { count: item.clips.length } : {}),
    ...(durationMs ? { durationMs } : {}),
    ...(w ? { w } : {}),
    ...(h ? { h } : {}),
    ...(item.template === true ? { template: true } : {}),
    poster,
  };
}

/**
 * Saves the clip `clipId` of the project at `root`: the clip as the film has it, without its place in time or its id
 * (it gets a new one where it is taken), and every file it needs.
 * @param {string} root @param {string} clipId
 * @param {{ name?: string, durationMs?: number, w?: number, h?: number, poster?: (clip: Record<string, unknown> & { src: string }) => Promise<Buffer | null> }} [o]
 */
export async function saveClip(root, clipId, o = {}) {
  const { value } = await readProjectFilm(root);
  const found = value?.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
  if (!found) throw new SavedError('That clip is not in the film any more.', 404);
  const clip = /** @type {Record<string, unknown> & { src: string, attrs?: Record<string, string> }} */ (structuredClone(found));
  delete clip.at;
  delete clip.id;
  /* a link ties clips of one film together (a video and its sound): a saved clip stands alone */
  if (clip.attrs) {
    delete clip.attrs['data-link'];
    if (!Object.keys(clip.attrs).length) delete clip.attrs;
  }
  const files = await clipFiles(root, clip);
  if (!files.includes(clip.src)) throw new SavedError('That clip’s file is not in the project.', 409);
  const name = o.name?.trim() || clip.src.split('/').pop()?.replace(/\.[^.]+$/, '') || clipId;
  return keep(root, files, { kind: 'clip', clip, name, ...sizes(o) }, o.poster ? () => /** @type {NonNullable<typeof o.poster>} */ (o.poster)(clip) : null);
}

/**
 * Saves the clips `clipIds` of the project at `root` together, as they are laid out: each one's track counted from the
 * top one among them, its time from the first of them. Links among them are kept (they are made anew where they go),
 * links to clips left out are not. The picture is the top one's that draws one.
 * @param {string} root @param {string[]} clipIds
 * @param {{ name?: string, durationMs?: number, w?: number, h?: number, poster?: (clip: Record<string, unknown> & { src: string }) => Promise<Buffer | null> }} [o]
 */
export async function saveGroup(root, clipIds, o = {}) {
  const { value } = await readProjectFilm(root);
  /** @type {{ track: number, clip: Record<string, unknown> & { src: string, at?: number, attrs?: Record<string, string> } }[]} */
  const found = [];
  value?.tracks.forEach((track, t) => track.clips.forEach((clip) => { if (clipIds.includes(clip.id)) found.push({ track: t, clip: structuredClone(clip) }); }));
  if (!found.length || found.length !== new Set(clipIds).size) throw new SavedError('Those clips are not all in the film any more.', 404);
  const tracks = [...new Set(found.map((f) => f.track))].sort((a, b) => a - b);
  const first = Math.min(...found.map((f) => f.clip.at ?? 0));
  const links = new Map();
  for (const { clip } of found) { const l = clip.attrs?.['data-link']; if (l) links.set(l, (links.get(l) ?? 0) + 1); }
  const clips = found
    .map(({ track, clip }) => {
      const at = Math.round(((clip.at ?? 0) - first) * 1000) / 1000;
      delete clip.at;
      delete clip.id;
      if (clip.attrs?.['data-link'] && (links.get(clip.attrs['data-link']) ?? 0) < 2) delete clip.attrs['data-link'];
      if (clip.attrs && !Object.keys(clip.attrs).length) delete clip.attrs;
      return { track: tracks.indexOf(track), at, clip };
    })
    .sort((a, b) => a.track - b.track || a.at - b.at);
  const files = new Set();
  for (const { clip } of clips) {
    const need = await clipFiles(root, clip);
    if (!need.includes(clip.src)) throw new SavedError('A clip’s file is not in the project.', 409);
    for (const f of need) files.add(f);
  }
  const top = clips.find(({ clip }) => clipKind(clip.src) !== 'sound' && clip.sound !== true)?.clip ?? null;
  const name = o.name?.trim() || `${clips.length} clips`;
  return keep(root, [...files], { kind: 'group', clips, name, ...sizes(o) }, top && o.poster ? () => /** @type {NonNullable<typeof o.poster>} */ (o.poster)(top) : null);
}

/**
 * Saves the file `rel` of the project at `root` (a page with what it loads).
 * @param {string} root @param {string} rel
 * @param {{ name?: string, durationMs?: number, w?: number, h?: number, poster?: () => Promise<Buffer | null> }} [o]
 */
export async function saveFile(root, rel, o = {}) {
  if (typeof rel !== 'string' || !rel || rel.startsWith('/') || rel.split('/').includes('..')) throw new SavedError('a file of the project, please', 400);
  const info = await stat(join(root, rel)).catch(() => null);
  if (!info?.isFile()) throw new SavedError('That file is not in the project any more.', 404);
  const files = clipKind(rel) ? await clipFiles(root, { src: rel }) : [rel];
  if (!files.includes(rel)) files.unshift(rel);
  const name = o.name?.trim() || rel.split('/').pop() || rel;
  return keep(root, files, { kind: 'file', path: rel, name, ...sizes(o) }, o.poster ?? null);
}

const sizes = (/** @type {{ durationMs?: number, w?: number, h?: number }} */ o) => Object.fromEntries(
  /** @type {const} */ (['durationMs', 'w', 'h']).flatMap((k) => (typeof o[k] === 'number' && Number.isFinite(o[k]) && /** @type {number} */ (o[k]) > 0 ? [[k, Math.round(/** @type {number} */ (o[k]))]] : [])),
);

/** Everything saved, the newest first. @returns {Promise<SavedItem[]>} */
export async function listSaved() {
  const root = savedRoot();
  const names = await readdir(root, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const e of names) {
    if (!e.isDirectory() || !ID.test(e.name)) continue;
    const found = await readItem(e.name).catch(() => null);
    if (found) out.push(summary(e.name, found.item, existsSync(join(found.dir, 'poster.jpg'))));
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** Its picture's file, or null. */
export function savedPoster(/** @type {string} */ id) {
  const file = join(dirOf(id), 'poster.jpg');
  return existsSync(file) ? file : null;
}

/** Its folder (to show it in the file manager). */
export function savedFolder(/** @type {string} */ id) {
  return dirOf(id);
}

/** A new name. @returns {Promise<SavedItem>} */
export async function renameSaved(/** @type {string} */ id, /** @type {unknown} */ name) {
  const next = typeof name === 'string' ? name.trim().slice(0, 120) : '';
  if (!next) throw new SavedError('a name, please', 400);
  const { dir, item } = await readItem(id);
  item.name = next;
  await writeFile(join(dir, 'saved.json'), `${JSON.stringify(item, null, 2)}\n`);
  return summary(id, item, existsSync(join(dir, 'poster.jpg')));
}

/** Into the system's trash, where it can be taken back from. */
export async function trashSaved(/** @type {string} */ id) {
  const { dir } = await readItem(id);
  await moveToTrash(dir);
}

/**
 * What a project needs to use a saved thing: its files copied into `saved/<id>/` of the project at `root` (a file there
 * already is kept as it is), and the clip (a group's clips) with its file's place there, or the file's place.
 * @param {string} root @param {string} id
 * @returns {Promise<{ clip: Record<string, unknown> & { src: string } } | { clips: { track: number, at: number, clip: Record<string, unknown> & { src: string } }[] } | { path: string }>}
 */
export async function takeSaved(root, id) {
  const { dir, item } = await readItem(id);
  const base = `${TAKEN_DIR}/${id}`;
  for (const rel of await filesOf(dir)) {
    const from = join(dir, 'files', rel);
    const to = join(root, base, rel);
    /* there already (taken before, maybe changed since in this project): it stays as it is */
    if ((await stat(to).catch(() => null))?.isFile()) continue;
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
  }
  if (item.kind === 'file') return { path: `${base}/${item.path}` };
  if (item.kind === 'group') return { clips: item.clips.map((/** @type {any} */ c) => ({ track: c.track, at: c.at, clip: { ...c.clip, src: `${base}/${c.clip.src}` } })) };
  return { clip: { ...item.clip, src: `${base}/${item.clip.src}` } };
}
