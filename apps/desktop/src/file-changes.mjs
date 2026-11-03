/**
 * What a turn changed in the project's files, as a coding agent's app shows it: each file added, removed or changed,
 * with its lines added and removed and the changed lines themselves. The folder is read as the turn starts and again
 * as it settles, so it is the same for any agent and counts whatever wrote the files meanwhile.
 *
 * Text files (by their extension, up to TEXT_MAX) are kept whole at the start and compared line by line at the end.
 * Any other file (media, a large file) is compared by its size and time only, and says no lines. Studio's own folder
 * (.film), hidden folders and node_modules are not read.
 *
 * film.html is kept whole whatever its size (up to FILM_MAX): a turn that ends with it gone (`filmLost`) can put it
 * back as it was (`restoreFilm`), since the film is the project. Any other file a turn removes (`lost`) can be put back
 * too (`restoreFiles`): a text from what was kept of it, any other file from a hard link to it made as the turn began
 * (`hold`, in Studio's folder: no space taken, and the content outlives a delete; a disk without hard links has none).
 *
 * Reads no Electron module, so `node --test` can use it.
 */
import { link, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { structuredPatch } from 'diff';

const TEXT = /\.(html?|css|[cm]?js|jsx|tsx?|json|md|txt|srt|vtt|svg|xml|ya?ml|toml|py|sh|csv)$/i;
const SKIP = new Set(['node_modules']);
/** a text file larger than this is compared as any other file */
const TEXT_MAX = 1024 * 1024;
/** past these the reading stops: what was read is still compared, and the list says it is cut */
const FILES_MAX = 5000;
const KEEP_MAX = 48 * 1024 * 1024;
const DEPTH_MAX = 8;
/** how many changed lines are kept for each file, and for the whole turn */
const LINES_MAX = 400;
const TURN_LINES_MAX = 2000;
/** a diff that takes longer than this gives up: the file says it changed, with no lines */
const DIFF_MS = 1500;
/** the project's film, at its top, and how large a one is kept whole to put back */
export const FILM = 'film.html';
const FILM_MAX = 32 * 1024 * 1024;

/** Where a turn's links to the files as it began are kept (`hold`): null for an id that names no folder. */
export const holdDir = (/** @type {string} */ root, /** @type {unknown} */ turnId) => (
  typeof turnId === 'string' && /^[\w:-]{1,120}$/.test(turnId) ? join(root, '.film', 'cache', 'turn-files', turnId.replace(/:/g, '-')) : null
);

/** Let go of a turn's links (`hold`): a file the turn removed is gone for good then. */
export const dropHold = (/** @type {string | null} */ hold) => (hold ? rm(hold, { recursive: true, force: true }).catch(() => {}) : Promise.resolve());

/**
 * @typedef {{ size: number, mtimeMs: number, text?: string, held?: true }} Seen
 * @typedef {{ files: Map<string, Seen>, cut: boolean }} Snapshot
 * @typedef {{ oldStart: number, oldLines: number, newStart: number, newLines: number, lines: string[] }} Hunk
 * @typedef {{ path: string, change: 'added' | 'removed' | 'changed', added?: number, removed?: number,
 *   hunks?: Hunk[], cut?: boolean }} FileChange
 */

/**
 * The project's files now: each one's size and time, and a text file's text. With `hold`, each other file is linked
 * there too (`held`), to be put back if it goes.
 * @param {string} root @param {{ hold?: string | null }} [opts]
 */
export async function snapshot(root, { hold = null } = {}) {
  /** @type {Map<string, Seen>} */
  const files = new Map();
  let kept = 0;
  let cut = false;
  const walk = async (dir, depth) => {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.size >= FILES_MAX) { cut = true; return; }
      if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < DEPTH_MAX) await walk(abs, depth + 1);
        else cut = true;
        continue;
      }
      if (!entry.isFile()) continue;
      let info;
      try { info = await stat(abs); } catch { continue; }
      /** @type {Seen} */
      const seen = { size: info.size, mtimeMs: info.mtimeMs };
      const path = relative(root, abs).split(sep).join('/');
      if (path === FILM ? info.size <= FILM_MAX : TEXT.test(entry.name) && info.size <= TEXT_MAX && kept + info.size <= KEEP_MAX) {
        try { seen.text = await readFile(abs, 'utf8'); kept += info.size; } catch { /* gone meanwhile */ }
      }
      if (hold && seen.text == null) {
        const to = join(hold, ...path.split('/'));
        try { await mkdir(dirname(to), { recursive: true }); await link(abs, to); seen.held = true; } catch { /* no hard links here */ }
      }
      files.set(path, seen);
    }
  };
  await walk(root, 0);
  return { files, cut };
}

/** A text's lines that changed, in hunks with three lines around each, or null when the diff gave up. */
function hunksOf(path, before, after) {
  const patch = structuredPatch(path, path, before, after, undefined, undefined, { context: 3, timeout: DIFF_MS });
  return patch ? patch.hunks.map(({ oldStart, oldLines, newStart, newLines, lines }) => ({ oldStart, oldLines, newStart, newLines, lines })) : null;
}

/** Keeps the first `max` lines of hunks, the rest dropped: → [the hunks kept, whether any were dropped]. */
function clip(hunks, max) {
  const out = [];
  let left = max;
  for (const hunk of hunks) {
    if (left <= 0) return [out, true];
    if (hunk.lines.length <= left) { out.push(hunk); left -= hunk.lines.length; continue; }
    out.push({ ...hunk, lines: hunk.lines.slice(0, left) });
    return [out, true];
  }
  return [out, false];
}

/**
 * What changed between a snapshot and the folder now: the files added, removed and changed, in path order (an
 * empty list: nothing changed). `cut`: the folder was too large to read whole. `filmLost`: film.html was there (and
 * kept whole) and is not now: removed, and not written again by the end; `restoreFilm` puts it back. `lost`: the other
 * files removed that can be put back (restoreFiles).
 *
 * @param {string} root
 * @param {Snapshot} before
 * @returns {Promise<{ files: FileChange[], cut: boolean, filmLost?: true, lost?: string[] }>}
 */
export async function changes(root, before) {
  const after = await snapshot(root);
  const paths = [...new Set([...before.files.keys(), ...after.files.keys()])].sort();
  /** @type {FileChange[]} */
  const out = [];
  let lines = TURN_LINES_MAX;
  for (const path of paths) {
    const was = before.files.get(path);
    const now = after.files.get(path);
    if (was && now && was.size === now.size && was.mtimeMs === now.mtimeMs) continue;
    if (was?.text != null && now?.text != null && was.text === now.text) continue;
    const change = !was ? 'added' : !now ? 'removed' : 'changed';
    /* lines only when both ends are text (or one end is no file at all) */
    const from = was ? was.text : '';
    const to = now ? now.text : '';
    if (from == null || to == null) { out.push({ path, change }); continue; }
    const hunks = hunksOf(path, from, to);
    if (!hunks) { out.push({ path, change }); continue; }
    let added = 0;
    let removed = 0;
    for (const hunk of hunks) for (const line of hunk.lines) { if (line[0] === '+') added += 1; else if (line[0] === '-') removed += 1; }
    if (!added && !removed && change === 'changed') continue;
    const [kept, dropped] = clip(hunks, Math.min(LINES_MAX, lines));
    lines -= kept.reduce((n, hunk) => n + hunk.lines.length, 0);
    out.push({ path, change, added, removed, hunks: kept, ...(dropped ? { cut: true } : {}) });
  }
  const filmLost = before.files.get(FILM)?.text != null && !after.files.has(FILM);
  const lost = [...before.files].filter(([path, seen]) => path !== FILM && !after.files.has(path) && (seen.text != null || seen.held)).map(([path]) => path);
  return { files: out, cut: before.cut || after.cut, ...(filmLost ? { filmLost: true } : {}), ...(lost.length ? { lost } : {}) };
}

/**
 * Put back the files a turn removed (`lost`) as its snapshot had them: a text from what was kept, any other from its
 * link in `hold`; only where there is none now, so one written meanwhile is never written over. → how many came back,
 * and how many were there already.
 * @param {string} root @param {Snapshot} before @param {string} hold @param {readonly string[]} lost
 * @returns {Promise<{ restored: number, exists: number }>}
 */
export async function restoreFiles(root, before, hold, lost) {
  let restored = 0;
  let exists = 0;
  for (const path of lost) {
    const seen = before.files.get(path);
    if (!seen || (seen.text == null && !seen.held)) continue;
    const to = join(root, ...path.split('/'));
    try {
      await mkdir(dirname(to), { recursive: true });
      if (seen.text != null) await writeFile(to, seen.text, { flag: 'wx' });
      else await link(join(hold, ...path.split('/')), to);
      restored += 1;
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
      exists += 1;
    }
  }
  return { restored, exists };
}

/**
 * Put film.html back in `root` as a snapshot had it (`text`), only where there is none now: one written meanwhile (by
 * the agent, by Studio's history) is never written over. → 'restored', or 'exists'.
 * @param {string} root @param {string} text @returns {Promise<'restored' | 'exists'>}
 */
export async function restoreFilm(root, text) {
  try { await writeFile(join(root, FILM), text, { flag: 'wx' }); }
  catch (e) { if (/** @type {NodeJS.ErrnoException} */ (e).code === 'EEXIST') return 'exists'; throw e; }
  return 'restored';
}
