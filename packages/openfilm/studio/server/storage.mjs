// @ts-check
/**
 * The room the person's projects take on disk, and the part of it that can be given back.
 *
 * A project's folder holds its work (film.html, its pages, assets/) and, hidden in `.film/`, what Studio keeps for
 * it: versions, conversations and logs, and a cache. The cache is what can be made again from the work: frames and
 * waveforms for the timeline, lighter copies of heavy footage for the preview, copies a render seeks in, the parts of
 * a render, what `look` drew. It grows unseen (half an hour of footage can leave gigabytes of it), so Settings says
 * how much there is and clears it. Whatever is cleared is made again the next time it is needed, and nothing else is
 * touched: not the work, not the versions, not what a conversation keeps to undo a turn (`turn-files`, in the cache
 * folder too).
 *
 * Media kept elsewhere and linked (src/media-links.mjs) takes no room in the project: a link is not followed.
 */
import { lstat, readdir, rm, stat } from 'node:fs/promises';
import { basename, join, relative, isAbsolute } from 'node:path';
import { exportsRoot, libraryRoot, savedRoot, sharedHome, studioHomeDir } from '../../src/locations.mjs';
import { mySkillsDir } from '../../src/skills.mjs';
import { TOOL_DIR, listProjects } from './projects.mjs';

/** The cache's folders that hold only what can be made again. */
const CLEARABLE = new Set(['audio', 'frames', 'look', 'pageframes', 'posters', 'preview', 'probe', 'render', 'seek', 'waves', 'proxies', 'playable', 'commits', 'export']);
/** The ones a render, an export or an agent at work reads back before it is done: left alone while one may be running. */
const IN_USE = new Set(['render', 'seek', 'export', 'look']);
/** Written this recently, a render's parts are a render under way (one started from a terminal is not Studio's to know of). */
const RECENT = 15 * 60_000;

/**
 * @typedef {{ total: number, media: number, cache: number, clearable: number, history: number, talk: number }} Usage
 *   bytes: all of the folder; its assets/; its cache, and the part of it that can be cleared; its versions; its
 *   conversations and logs
 */

/** The bytes under `dir`, links not followed, given to `count` with each file's path below `dir` as its folders. */
async function walk(/** @type {string} */ dir, /** @type {string[]} */ below, /** @type {(below: string[], bytes: number) => void} */ count) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const at = join(dir, entry.name);
    if (entry.isDirectory()) await walk(at, [...below, entry.name], count);
    else {
      const info = await lstat(at).catch(() => null);
      if (info) count(below, info.size);
    }
  }
}

/** What a project takes on disk. @param {string} root @returns {Promise<Usage>} */
export async function projectUsage(root) {
  const usage = { total: 0, media: 0, cache: 0, clearable: 0, history: 0, talk: 0 };
  await walk(root, [], (below, bytes) => {
    usage.total += bytes;
    if (below[0] === 'assets') usage.media += bytes;
    if (below[0] !== TOOL_DIR) return;
    if (below[1] === 'cache') {
      usage.cache += bytes;
      if (CLEARABLE.has(below[2] ?? '')) usage.clearable += bytes;
    } else if (below[1] === 'history') usage.history += bytes;
    else if (below[1] === 'chat' || below[1] === 'logs') usage.talk += bytes;
  });
  return usage;
}

/** Whether something was written in `dir`, or in a folder of it, within {@link RECENT}. */
async function written(/** @type {string} */ dir, /** @type {number} */ now) {
  const fresh = async (/** @type {string} */ at) => { const info = await stat(at).catch(() => null); return Boolean(info && now - info.mtimeMs < RECENT); };
  if (await fresh(dir)) return true;
  for (const name of await readdir(dir).catch(() => [])) if (await fresh(join(dir, name))) return true;
  return false;
}

/**
 * Clear what a project's cache holds that can be made again. `busy`: an export of Studio's or an agent is at work in
 * it, so what a render reads back is left; it is left too when a render wrote there a moment ago. A file that
 * cannot be removed (open in a player, on Windows) stays. Returns the bytes given back.
 * @param {string} root @param {{ busy?: boolean, now?: number }} [o]
 */
export async function clearProjectCache(root, { busy = false, now = Date.now() } = {}) {
  const cache = join(root, TOOL_DIR, 'cache');
  const before = (await projectUsage(root)).clearable;
  const rendering = busy || await written(join(cache, 'render'), now) || await written(join(cache, 'export'), now);
  for (const name of await readdir(cache).catch(() => [])) {
    if (!CLEARABLE.has(name) || (rendering && IN_USE.has(name))) continue;
    await rm(join(cache, name), { recursive: true, force: true }).catch(() => {});
  }
  return Math.max(0, before - (await projectUsage(root)).clearable);
}

/** The bytes a folder takes, links not followed (0: not there). @param {string} dir */
async function folderSize(dir) {
  let bytes = 0;
  await walk(dir, [], (_, n) => { bytes += n; });
  return bytes;
}

const inside = (/** @type {string} */ root, /** @type {string} */ path) => { const r = relative(root, path); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

/**
 * Every listed project that is there, with what it takes, the biggest first (`linked`: a folder elsewhere, opened in
 * place, not in the projects' folder), and the sums; and the room OpenFilm's other folders take: the person's own media and skills, the exports, and what the app keeps
 * for itself (models, the library it downloaded, its logs).
 * @returns {Promise<{ projects: ({ id: string, name: string, path: string, linked: boolean } & Usage)[], total: number, clearable: number,
 *   places: { saved: number, skills: number, exports: number, app: number } }>}
 */
async function measure() {
  const root = libraryRoot();
  const projects = [];
  for (const p of (await listProjects()).filter((p) => !p.missing)) projects.push({ id: p.id, name: p.name || basename(p.path), path: p.path, linked: !inside(root, p.path), ...await projectUsage(p.path) });
  projects.sort((a, b) => b.total - a.total);
  const homes = [...new Set([studioHomeDir(), sharedHome()])];
  const [saved, skills, exported, ...app] = await Promise.all([folderSize(savedRoot()), folderSize(mySkillsDir()), folderSize(exportsRoot()), ...homes.map(folderSize)]);
  return {
    projects, total: projects.reduce((sum, p) => sum + p.total, 0), clearable: projects.reduce((sum, p) => sum + p.clearable, 0),
    places: { saved, skills, exports: exported, app: app.reduce((a, b) => a + b, 0) },
  };
}

/* measured once for every window that asks at the same time, and kept a little: the card opens at once when it is
   opened again, and a walk of every project's folder never runs twice side by side */
const KEEP = 30_000;
/** @type {{ at: number, value: Awaited<ReturnType<typeof measure>> } | null} */
let kept = null;
/** @type {Promise<Awaited<ReturnType<typeof measure>>> | null} */
let measuring = null;

/** What OpenFilm takes on disk (see measure). `fresh`: measured again now (after a clear). */
export async function storage({ fresh = false } = {}) {
  if (!fresh && kept && Date.now() - kept.at < KEEP) return kept.value;
  if (!measuring) measuring = measure().then((value) => { kept = { at: Date.now(), value }; return value; }).finally(() => { measuring = null; });
  return measuring;
}
