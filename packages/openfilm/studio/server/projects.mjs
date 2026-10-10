// @ts-check
/**
 * Projects: folders, and the list of the ones opened recently (~/.openfilm/studio.json). A project is its folder, and
 * everything about it is in the folder, so moving or copying the folder moves or copies the project:
 *
 *   film.html, its pages and code, assets/   the work
 *   .film/id, .film/subtitles.json           its id (a copy gets its own) and the subtitles' style (captions.mjs)
 *   .film/settings.json                      the editor's settings: its frame rate, its tracks' names (project-settings.mjs)
 *   .film/history/                           its versions (history.mjs)
 *   .film/chat/                              an app's conversations about it, with its agent's sessions
 *   .film/logs/                              an app's full record of every turn, for debugging
 *   .film/cache/                             what can be made again: frames, posters, waves, look and render output
 *
 * Each part is a folder of its own, so the project's export (exports.mjs, kind 'project') takes or leaves it.
 */
import { moveToTrash } from './trash.mjs';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { EMPTY_FILM } from './film.mjs';
import { FILM_FILE, filmHtml } from '../../src/film-doc.mjs';
import { writeAtomic } from './atomic.mjs';

export const TOOL_DIR = '.film';

/** What an export of the project may take besides the work, each a folder in `.film/` (see above); never the cache. */
export const PROJECT_PARTS = /** @type {const} */ (['history', 'chat', 'logs']);

export class ProjectError extends Error {
  /** `code`, when the editor says it in its own words ('not-found', 'no-film', 'listed'). @param {string} message @param {number} status @param {string} [code] */
  constructor(message, status = 400, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Where Studio keeps its own state (not projects): ~/.openfilm, or OPENFILM_HOME. */
export const studioHome = () => process.env.OPENFILM_HOME || join(homedir(), '.openfilm');

/**
 * The key this machine's Studio opens with (~/.openfilm/key, readable by this user only), the same at every launch: an
 * address Studio printed, and a page open on it, still work after it restarts (an update, a reboot).
 */
export function studioKey() {
  const file = join(studioHome(), 'key');
  try {
    const key = readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{48}$/.test(key)) return key;
  } catch { /* none yet */ }
  const key = randomBytes(24).toString('hex');
  mkdirSync(studioHome(), { recursive: true });
  writeFileSync(file, key, { mode: 0o600 });
  return key;
}

/** Where new projects go: ~/Movies/OpenFilm/Projects on macOS, ~/Videos/OpenFilm/Projects elsewhere. */
export const libraryRoot = () => process.env.OPENFILM_LIBRARY
  || join(homedir(), process.platform === 'darwin' ? 'Movies' : 'Videos', 'OpenFilm', 'Projects');

/**
 * @typedef {{ id: string, path: string, openedAt: number, folderId?: string }} Recent
 * @typedef {{ id: string, name: string, createdAt: number }} ProjectFolder   a folder of the Projects list (not on disk)
 * @typedef {{ recent: Recent[], folders: ProjectFolder[] }} StudioState
 */

/** The list of projects and the person's preferences, read fresh each time (another Studio command may have written). */
export async function readState() {
  try {
    const raw = JSON.parse(await readFile(join(studioHome(), 'studio.json'), 'utf8'));
    return /** @type {StudioState} */ ({
      recent: Array.isArray(raw.recent) ? raw.recent : [],
      folders: Array.isArray(raw.folders) ? raw.folders.filter((/** @type {any} */ f) => f && typeof f.id === 'string' && typeof f.name === 'string') : [],
    });
  } catch { return /** @type {StudioState} */ ({ recent: [], folders: [] }); }
}

async function writeState(/** @type {StudioState} */ state) {
  await mkdir(studioHome(), { recursive: true });
  const path = join(studioHome(), 'studio.json');
  await writeAtomic(path, `${JSON.stringify(state, null, 2)}\n`);
}

/** Folders that are never a project: the disk's root, the home folder, and Studio's own. */
function refuse(/** @type {string} */ folder) {
  const home = homedir();
  if (folder === dirname(folder)) throw new ProjectError('the root of a disk cannot be a project; make a folder for it');
  if (folder === home) throw new ProjectError('your home folder cannot be a project; make a folder for it');
  const own = resolve(studioHome());
  if (folder === own || folder.startsWith(own + sep)) throw new ProjectError('Studio keeps its own files there');
}

const newId = () => randomBytes(9).toString('base64url');

/** The folder's project id (`.film/id`), made on first open. A copied folder that brings its original's id gets a new one. */
/** Whether two paths are one folder on disk. */
function sameFolder(/** @type {string} */ a, /** @type {string} */ b) {
  try {
    const x = statSync(a);
    const y = statSync(b);
    return x.dev === y.dev && x.ino === y.ino;
  } catch { return false; }
}

async function folderId(/** @type {string} */ folder, /** @type {StudioState} */ state) {
  const file = join(folder, TOOL_DIR, 'id');
  let id = '';
  try { id = (await readFile(file, 'utf8')).trim(); } catch { /* first open */ }
  /* the same id listed at another folder: this one is a copy of it (and needs its own); the same folder by another
     spelling (case, on a disk that ignores it) is not */
  const other = id && state.recent.find((r) => r.id === id && r.path !== folder && !sameFolder(r.path, folder) && existsSync(join(r.path, TOOL_DIR, 'id')));
  if (!/^[\w-]{6,40}$/.test(id) || other) {
    id = newId();
    await mkdir(join(folder, TOOL_DIR), { recursive: true });
    await writeFile(file, `${id}\n`);
  }
  return id;
}

/**
 * Open a folder as a project: it is made when missing; an empty film.html goes in when there is none (an existing one
 * is never touched); `.film/` keeps itself out of the folder's own git. Returns the project and puts it first in the list.
 * `create` false: only a folder that is there and holds a film opens (else 'not-found' or 'no-film', and nothing is
 * written), so the editor can ask before it starts a film in a folder.
 * @param {string} path @param {{ create?: boolean }} [options]
 */
export async function openProject(path, { create = true } = {}) {
  const asked = resolve(path);
  refuse(asked);
  if (existsSync(asked) && !statSync(asked).isDirectory()) throw new ProjectError(`${asked} is a file; a project is a folder`);
  if (!create && !existsSync(asked)) throw new ProjectError('That folder does not exist.', 404, 'not-found');
  if (!create && !existsSync(join(asked, FILM_FILE))) throw new ProjectError('There is no film.html in that folder.', 409, 'no-film');
  await mkdir(join(asked, TOOL_DIR), { recursive: true });
  /* one folder is one project however it is reached (through a link; /var and /private/var on macOS) */
  const folder = realpathSync(asked);
  refuse(folder);
  await writeFile(join(folder, TOOL_DIR, '.gitignore'), '*\n');
  if (!existsSync(join(folder, FILM_FILE))) await writeFile(join(folder, FILM_FILE), filmHtml(EMPTY_FILM), { flag: 'wx' }).catch(() => {});
  const state = await readState();
  const id = await folderId(folder, state);
  /* reopened: it stays in its folder of the list */
  const listed = state.recent.find((r) => r.id === id)?.folderId;
  const entry = { id, path: folder, openedAt: Date.now(), ...(listed ? { folderId: listed } : {}) };
  state.recent = [entry, ...state.recent.filter((r) => r.id !== id && r.path !== folder)];
  await writeState(state);
  return describe(entry);
}

/** A new project in the library: "Untitled", "Untitled 2", … never an existing folder. */
export async function createProject(name = 'Untitled') {
  const clean = folderName(name);
  const root = libraryRoot();
  await mkdir(root, { recursive: true });
  let candidate = join(root, clean);
  for (let n = 2; existsSync(candidate); n++) candidate = join(root, `${clean} ${n}`);
  return openProject(candidate);
}

/**
 * A project's folder name: what a person typed, less only what a file system refuses (`/ \ : * ? " < > |` and
 * control characters; a run of them, with the spaces around it, becomes one space). Spaces stay as typed, as the media
 * pane keeps them (files.mjs cleanName). Trimmed, no leading dots, at most 120 characters.
 */
function folderName(/** @type {string} */ name) {
  const clean = String(name).replace(/\s*[/\\:*?"<>|\u0000-\u001f\u007f]+\s*/g, ' ').trim().replace(/^[.\s]+/, '').slice(0, 120).trimEnd();
  if (!clean) throw new ProjectError('a project needs a name');
  return clean;
}

/**
 * A project as the API gives it: `createdAt` is when its folder was made; `duration` (s) the film's length when Studio
 * has drawn the film since film.html last changed (its poster), else absent; `folderId` its folder in the list.
 */
const describe = (/** @type {Recent} */ r) => {
  const created = statSync(r.path, { throwIfNoEntry: false });
  const duration = filmDuration(r.path);
  return {
    /* `missing`: its folder is gone (one that only lost its film.html is still there, and still opens) */
    id: r.id, path: r.path, name: basename(r.path), openedAt: r.openedAt, missing: !created?.isDirectory(),
    createdAt: created ? Math.round(created.birthtimeMs || created.ctimeMs) : r.openedAt,
    ...(duration != null ? { duration } : {}),
    ...(r.folderId ? { folderId: r.folderId } : {}),
  };
};

/** The film's length as Studio last learnt it (pageframes.mjs FILM_DURATION), if film.html has not changed since. */
function filmDuration(/** @type {string} */ folder) {
  try {
    const film = statSync(join(folder, FILM_FILE));
    const known = JSON.parse(readFileSync(join(folder, TOOL_DIR, 'cache', 'film-duration.json'), 'utf8'));
    return known.film === `${film.mtimeMs}:${film.size}` && Number.isFinite(known.duration) ? Number(known.duration) : null;
  } catch { return null; }
}

/** The projects opened recently, most recent first; one whose folder is gone says so (`missing`). */
export async function listProjects() {
  const state = await readState();
  const folders = new Set(state.folders.map((f) => f.id));
  /* a project in a folder that was deleted is back at the top level */
  return state.recent.map((r) => describe(r.folderId && !folders.has(r.folderId) ? { ...r, folderId: undefined } : r));
}

/* ── folders of the Projects list: only a way to group the list, kept in studio.json; nothing moves on disk ── */

/** A folder's name: what a person typed, trimmed (the list shows 40 characters). */
function listFolderName(/** @type {unknown} */ name) {
  const clean = String(name ?? '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!clean) throw new ProjectError('a folder needs a name');
  return clean;
}

/** The list's folders, oldest first. */
export async function listFolders() {
  return (await readState()).folders;
}

/** A new folder in the list. */
export async function createFolder(/** @type {unknown} */ name) {
  const state = await readState();
  const folder = { id: newId(), name: listFolderName(name), createdAt: Date.now() };
  state.folders.push(folder);
  await writeState(state);
  return folder;
}

/** Rename a folder of the list. */
export async function renameFolder(/** @type {string} */ id, /** @type {unknown} */ name) {
  const state = await readState();
  const folder = state.folders.find((f) => f.id === id);
  if (!folder) throw new ProjectError('no such folder', 404);
  folder.name = listFolderName(name);
  await writeState(state);
  return folder;
}

/**
 * Take a folder off the list; its projects go back to the top level. Returns the ids of the projects that were in it
 * (deleting a folder deletes them too: the caller deletes each, see deleteProject).
 */
export async function deleteFolder(/** @type {string} */ id) {
  const state = await readState();
  if (!state.folders.some((f) => f.id === id)) throw new ProjectError('no such folder', 404);
  state.folders = state.folders.filter((f) => f.id !== id);
  const inside = state.recent.filter((r) => r.folderId === id);
  for (const r of inside) delete r.folderId;
  await writeState(state);
  return inside.map((r) => r.id);
}

/** Put a project in a folder of the list, or (null) back at the top level. */
export async function moveProjectToFolder(/** @type {string} */ id, /** @type {string | null} */ folderId) {
  const state = await readState();
  const entry = state.recent.find((r) => r.id === id);
  if (!entry) throw new ProjectError('no such project', 404);
  if (folderId != null && !state.folders.some((f) => f.id === folderId)) throw new ProjectError('no such folder', 404);
  if (folderId) entry.folderId = folderId;
  else delete entry.folderId;
  await writeState(state);
  return describe(entry);
}

/** The project with this id, or a 404. */
export async function projectById(/** @type {string} */ id) {
  const found = (await readState()).recent.find((r) => r.id === id);
  if (!found) throw new ProjectError('no such project', 404);
  return describe(found);
}

/**
 * The person opened the project in Studio (from the Projects window, or by its address): it is the one opened last, as
 * `openProject` makes a project the CLI opens, so `openfilm open` alone comes back to it.
 */
export async function markOpened(/** @type {string} */ id) {
  const state = await readState();
  const entry = state.recent.find((r) => r.id === id);
  if (!entry) throw new ProjectError('no such project', 404);
  entry.openedAt = Date.now();
  state.recent = [entry, ...state.recent.filter((r) => r !== entry)];
  await writeState(state);
  return describe(entry);
}

/**
 * A project whose folder was moved or renamed outside Studio, found again: the list points at `path` from now on,
 * with the same id, so its place in the list stays (its history is in the folder, and follows it: history.mjs). The
 * folder must hold a film, and not be another project of the list.
 * @param {string} id @param {string} path
 */
export async function locateProject(id, path) {
  const state = await readState();
  const entry = state.recent.find((r) => r.id === id);
  if (!entry) throw new ProjectError('no such project', 404);
  const asked = resolve(path);
  refuse(asked);
  if (!existsSync(asked) || !statSync(asked).isDirectory()) throw new ProjectError('That folder does not exist.', 404, 'not-found');
  const folder = realpathSync(asked);
  refuse(folder);
  if (!existsSync(join(folder, FILM_FILE))) throw new ProjectError('There is no film.html in that folder.', 409, 'no-film');
  const other = state.recent.find((r) => r.id !== id && (r.path === folder || sameFolder(r.path, folder)));
  if (other) throw new ProjectError(`That folder is already in the list, as “${basename(other.path)}”.`, 409, 'listed');
  await mkdir(join(folder, TOOL_DIR), { recursive: true });
  await writeFile(join(folder, TOOL_DIR, '.gitignore'), '*\n');
  /* the folder carries the project's id: a copy made of it later is told apart from it (folderId) */
  let had = '';
  try { had = (await readFile(join(folder, TOOL_DIR, 'id'), 'utf8')).trim(); } catch { /* none yet */ }
  if (had !== id) await writeFile(join(folder, TOOL_DIR, 'id'), `${id}\n`);
  entry.path = folder;
  await writeState(state);
  return describe(entry);
}

/** Rename a project: its folder is renamed beside itself (the project's name is its folder's name). */
export async function renameProject(/** @type {string} */ id, /** @type {string} */ name) {
  const state = await readState();
  const entry = state.recent.find((r) => r.id === id);
  if (!entry) throw new ProjectError('no such project', 404);
  const to = join(dirname(entry.path), folderName(name));
  if (to === entry.path) return describe(entry);
  /* taken: retrying can't help, so it says so; the same folder in another case (on a disk that ignores it) is not */
  if (existsSync(to) && !sameFolder(to, entry.path)) throw new ProjectError(`the name "${basename(to)}" is taken: there is already a folder by that name beside this project`, 409);
  await rename(entry.path, to);
  entry.path = to;
  await writeState(state);
  return describe(entry);
}

/**
 * Delete a project: its folder goes to the system's Trash (where the person can still take it back), and it leaves the
 * list. A folder that is already gone just leaves the list.
 */
export async function deleteProject(/** @type {string} */ id) {
  const found = (await readState()).recent.find((r) => r.id === id);
  if (!found) throw new ProjectError('no such project', 404);
  if (existsSync(found.path)) await moveToTrash(found.path);
  await forgetProject(id);
}

/** Take a project off the list. Its folder stays as it is. */
export async function forgetProject(/** @type {string} */ id) {
  const state = await readState();
  state.recent = state.recent.filter((r) => r.id !== id);
  await writeState(state);
}
