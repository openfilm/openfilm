// @ts-check
// A project's cache keeps a copy of footage for as long as it is used. The copies a render seeks in (seekable.mjs) and
// the ones the preview plays (studio/server/proxies.mjs) are often larger than the footage they were made from, and
// each new version of a file, and each change to a LUT, leaves the copy before it behind. So a copy says when it was
// last used and what it is a copy of, in a file beside it (`<copy>.used`: its time is the last use, its text the source
// as it was then), and a sweep of its folder removes the copies no one used for a month, and after a day the ones that
// can't be used again: their source has changed since. Whatever is removed is made again when it is asked for.
//
// The copy itself is never touched: a render that resumes knows the files it drew from by their size and times
// (render-resume.mjs `signature`), a graded copy among them, and a copy whose time changed would start it over.
import { closeSync, constants, lutimesSync, openSync, writeSync } from 'node:fs';
import { lstat, lutimes, open, readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

/** A copy no one used for this long is removed. */
export const UNUSED_MS = 30 * 864e5;
/** A copy that can't be used again is removed once its last use is this far back: a render that began with it has
    ended by then, and a file put back as it was a moment later still finds its copy. A part no one wrote to for this
    long was left by a maker that ended without it. */
export const STALE_MS = 864e5;
/** A use is written down this often at most: a playing video asks for its copy with every request. */
const MARK_EVERY = 3600_000;
/** A folder is swept this often at most, by whichever process comes first. */
const SWEEP_EVERY = 864e5;
/** The end of the name of the file a copy's use is written in, beside it. */
export const USED = '.used';
/** The file whose time says when its folder was last swept. */
const SWEPT = '.swept';
/** A note is a line or two: a longer file by its name is not one, and is not read. */
const NOTE_MOST = 64 * 1024;
/** Written as a file of its own name, never through a link someone put there. */
const WRITE = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0);

/**
 * What a copy is a copy of: the source's path, and the facts of it the copy's name was made from (its size and time,
 * the version of the code that made it…), which a sweep compares with the source as it is (Kept `stale`).
 * @typedef {{ file: string } & Record<string, unknown>} Note
 */

/** @type {Map<string, { at: number, noted: boolean }>} the uses this process wrote down, by copy */
const marked = new Map();

/** `text` as all there is in the file at `path`. @param {string} path @param {string} text */
function write(path, text) {
  const file = openSync(path, WRITE);
  try { writeSync(file, text); } finally { closeSync(file); }
}

/**
 * Say `copy` is used now, and what it is a copy of (`note`, or a function giving it, called only when it is written;
 * none: only its use). Written beside the copy at most once an hour, so it can be said at every use. It never fails:
 * in a folder that can't be written nothing is removed either.
 * @param {string} copy @param {Note | (() => Note | null) | null} [note] @param {number} [now]
 */
export function markUsed(copy, note = null, now = Date.now()) {
  const last = marked.get(copy);
  if (last && now >= last.at && now - last.at < MARK_EVERY && (!note || last.noted)) return;
  const marker = `${copy}${USED}`;
  const when = new Date(now);
  try {
    const facts = typeof note === 'function' ? note() : note;
    if (facts) write(marker, `${JSON.stringify(facts)}\n`);
    else try { lutimesSync(marker, when, when); } catch { write(marker, ''); }
    lutimesSync(marker, when, when);
    marked.set(copy, { at: now, noted: Boolean(facts) || last?.noted === true });
  } catch { /* said again at the next use */ }
}

/**
 * What a sweep knows of a folder: the names of its copies (`copy`), of the parts of copies being made (`part`), and
 * whether a copy can't be used again, by its note (`stale`). A file by any other name is not the sweep's to remove.
 * @typedef {{ copy: RegExp, part?: RegExp, stale?: (note: Record<string, unknown>) => boolean | Promise<boolean> }} Kept
 */

/** @type {Map<string, number>} when this process last swept each folder, or found it swept */
const swept = new Map();

/** An empty file at `path`, dated `now`. @param {string} path @param {number} now */
async function stamp(path, now) {
  await (await open(path, WRITE)).close();
  await lutimes(path, new Date(now), new Date(now));
}

/**
 * Sweep `dir`, a cache folder of copies (see the head of this file): the copies last used more than a month ago are
 * removed, and those that can't be used again (`kept.stale`) once their last use is a day back; a copy from before
 * copies said their use says it now, and is counted from today; a part no one wrote to for a day is removed, a part
 * being written never. A file that can't be removed (Windows, while a browser reads it) is left for the next sweep.
 * A folder is swept once a day, whichever process asks (`force`: now). It never fails; it returns what it removed.
 * @param {string} dir @param {Kept} kept @param {{ now?: number, force?: boolean }} [options]
 * @returns {Promise<{ files: number, bytes: number }>}
 */
export async function sweepCopies(dir, kept, { now = Date.now(), force = false } = {}) {
  const removed = { files: 0, bytes: 0 };
  try {
    if (!force) {
      const recent = (/** @type {number | undefined} */ at) => at !== undefined && now >= at && now - at < SWEEP_EVERY;
      if (recent(swept.get(dir))) return removed;
      const last = (await lstat(join(dir, SWEPT)).catch(() => null))?.mtimeMs;
      if (recent(last)) {
        swept.set(dir, /** @type {number} */ (last));
        return removed;
      }
    }
    const names = await readdir(dir);
    swept.set(dir, now);
    await stamp(join(dir, SWEPT), now);
    const gone = (/** @type {string} */ name) => unlink(join(dir, name)).then(() => true, () => false);
    for (const name of names) {
      const at = join(dir, name);
      const info = await lstat(at).catch(() => null);
      if (!info) continue;
      if (name.endsWith(USED)) {
        /* the note of a copy that is gone (removed by hand, or its note could not be removed with it) */
        const copy = name.slice(0, -USED.length);
        if (kept.copy.test(copy) && now - info.mtimeMs > STALE_MS && !(await lstat(join(dir, copy)).catch(() => null))) await gone(name);
        continue;
      }
      if (!info.isFile()) continue;
      if (kept.part?.test(name)) {
        if (now - info.mtimeMs > STALE_MS && await gone(name)) { removed.files += 1; removed.bytes += info.size; }
        continue;
      }
      if (!kept.copy.test(name)) continue;
      const marker = `${at}${USED}`;
      const mark = await lstat(marker).catch(() => null);
      if (!mark) { await stamp(marker, now); continue; }
      const idle = now - mark.mtimeMs;
      let old = idle > UNUSED_MS;
      if (!old && idle > STALE_MS && kept.stale && mark.isFile() && mark.size <= NOTE_MOST) {
        try {
          const note = JSON.parse(await readFile(marker, 'utf8'));
          old = Boolean(note) && typeof note === 'object' && !Array.isArray(note) && Boolean(await kept.stale(note));
        } catch { /* no note in it: kept by its use alone */ }
      }
      if (!old) continue;
      /* used since it was looked at (another process said so): left */
      if ((await lstat(marker).catch(() => null))?.mtimeMs !== mark.mtimeMs) continue;
      if (!(await gone(name))) continue;
      marked.delete(at);
      await gone(`${name}${USED}`);
      removed.files += 1;
      removed.bytes += info.size;
    }
  } catch { /* a folder that is not there, or can't be read or written: nothing to sweep */ }
  return removed;
}
