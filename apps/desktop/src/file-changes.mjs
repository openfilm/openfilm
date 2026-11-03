/**
 * What a turn changed in the project's files, as a coding agent's app shows it: each file added, removed or changed,
 * with its lines added and removed and the changed lines themselves. The folder is read as the turn starts and again
 * as it settles, so it is the same for any agent and counts whatever wrote the files meanwhile.
 *
 * Text files (by their extension, up to TEXT_MAX) are kept whole at the start and compared line by line at the end.
 * Any other file (media, a large file) is compared by its size and time only, and says no lines. Studio's own folder
 * (.film), hidden folders and node_modules are not read.
 *
 * A turn can be undone (undoTurn): the folder put back as the turn found it. film.html is kept whole whatever its size
 * (up to FILM_MAX), since the film is the project; any other text from what was kept of it, any other file from a hard
 * link to it made as the turn began (`hold`, in Studio's folder: no space taken, and the content outlives a delete; a
 * disk without hard links has none).
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
 * empty list: nothing changed). `cut`: the folder was too large to read whole.
 *
 * @param {string} root
 * @param {Snapshot} before
 * @returns {Promise<{ files: FileChange[], cut: boolean }>}
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
  return { files: out, cut: before.cut || after.cut };
}

/**
 * Undo a turn: the folder as its snapshot (`before`) found it. A file added since goes to the trash (`trash`, the
 * system's); one removed or changed is written back, a text from what was kept, any other from its link in `hold`.
 * What cannot be put back is left as it is and named (`missed`): a file too large to keep, or one written over in its
 * place, which its link then holds too. → how many came back, and those missed.
 * @param {string} root @param {Snapshot} before @param {string | null} hold
 * @param {{ trash: (path: string) => Promise<void> }} o
 * @returns {Promise<{ restored: number, missed: string[] }>}
 */
export async function undoTurn(root, before, hold, { trash }) {
  const after = await snapshot(root);
  let restored = 0;
  /** @type {string[]} */
  const missed = [];
  for (const path of [...new Set([...before.files.keys(), ...after.files.keys()])].sort()) {
    const was = before.files.get(path);
    const now = after.files.get(path);
    const to = join(root, ...path.split('/'));
    if (was && now && was.size === now.size && was.mtimeMs === now.mtimeMs) continue;
    if (was?.text != null && now?.text != null && was.text === now.text) continue;
    try {
      if (!was) { await trash(to); restored += 1; continue; }
      if (was.text != null) {
        await mkdir(dirname(to), { recursive: true });
        await writeFile(to, was.text);
        restored += 1;
        continue;
      }
      const held = was.held && hold ? join(hold, ...path.split('/')) : null;
      const kept = held ? await stat(held).catch(() => null) : null;
      if (!held || !kept || kept.size !== was.size || kept.mtimeMs !== was.mtimeMs) { missed.push(path); continue; }
      await mkdir(dirname(to), { recursive: true });
      await rm(to, { force: true });
      await link(held, to);
      restored += 1;
    } catch { missed.push(path); }
  }
  return { restored, missed };
}
