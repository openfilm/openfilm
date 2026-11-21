// @ts-check
/**
 * Copies that take no room where the disk can make them: a clone is a file of its own that shares its bytes with the
 * original until one of the two is changed, made at once whatever its size. For what exports and the history copy:
 * footage is gigabytes, and a copy of it on the same disk need not be written again.
 */
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, rm } from 'node:fs/promises';

/**
 * A file smaller than this is copied, not cloned: on macOS a clone starts a process (`cp`), which costs more than
 * writing so few bytes again, and so few bytes take little room.
 */
export const CLONE_MIN_BYTES = 1 << 20;

/**
 * Copy `from` to `to` as a clone where the disk can (no room taken, and a later change to either never reaches the
 * other), else as a plain copy. On macOS through `cp -c` (clonefile): Node's own clone flag writes the bytes again
 * there (measured: a 650 MB file took 650 MB more and a quarter of a second; `cp -c` took none and two milliseconds),
 * and its strict one says the system cannot. `cp -c` copies by itself where the disk makes no clones (another disk, one
 * that is not APFS), and replaces a file already at `to`. A clone keeps the original's dates; a copy is dated now.
 * `size`: the file's, when the caller knows it, so that a small one is copied (CLONE_MIN_BYTES); not given, it is cloned.
 * @param {string} from @param {string} to @param {{ size?: number }} [options]
 */
export async function cloneFile(from, to, { size = Infinity } = {}) {
  if (process.platform === 'darwin' && size >= CLONE_MIN_BYTES) {
    const ok = await new Promise((done) => { execFile('/bin/cp', ['-c', from, to], { windowsHide: true }, (error) => done(!error)); });
    if (ok) return;
    await rm(to, { force: true });
  }
  await copyFile(from, to, constants.COPYFILE_FICLONE);
}

/**
 * `work` for each of `items`, `limit` at a time, in their order; the first failure stops the rest from starting and is
 * thrown once those under way have ended.
 * @template T @param {T[]} items @param {number} limit @param {(item: T, index: number) => Promise<void>} work
 */
export async function eachLimited(items, limit, work) {
  let next = 0;
  /** @type {unknown} */
  let failure;
  let failed = false;
  const run = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try { await work(items[i], i); } catch (e) { if (!failed) { failed = true; failure = e; } }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run));
  if (failed) throw failure;
}
