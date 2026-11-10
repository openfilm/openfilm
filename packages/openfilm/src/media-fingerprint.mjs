// @ts-check
/**
 * A media file's fingerprint: what says two files hold the same bytes, wherever each is kept and whatever it is named.
 * A file that was moved, renamed or copied keeps its fingerprint, so it is found again (studio/server/media-index.mjs).
 *
 * It is made of the file's size and three pieces of it (its start, its middle and its end), never the whole file:
 * footage of any size costs three short reads, also on a slow disk. Two different media files that agree in size and
 * in all three pieces have not been seen (none among 32,983 videos, checked against a hash of every byte); the size
 * alone is not enough (it mixed up 10,191 of them).
 *
 * Reads no Studio module, so the command can use it.
 */
import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';

/** The bytes read at each of the three places. */
export const PIECE = 64 * 1024;
const PIECES = 3;
/** What a fingerprint starts with: the way it was made, so another way later is never taken for this one. */
const MARK = 'f1-';

/**
 * Whether the file's bytes are on this disk. A file a cloud drive keeps elsewhere (iCloud Drive, OneDrive: only its
 * name is here) takes no room, and reading it would download it: such a file is left alone. Small files are always
 * read (some disks keep them inside their own entry, taking no room either).
 * @param {{ size: number, blocks?: number }} info
 */
export const held = (info) => !(info.size > PIECE && info.blocks === 0);

/** Whether a value is a fingerprint. @param {unknown} value @returns {value is string} */
export const isFingerprint = (value) => typeof value === 'string' && /^f1-[0-9a-f]{32}$/.test(value);

/**
 * The fingerprint of the file at `path`, or null when its bytes are not on this disk ({@link held}). `info`: its stat,
 * when the caller has it.
 * @param {string} path @param {import('node:fs').Stats} [info]
 */
export async function fingerprint(path, info) {
  const known = info ?? await stat(path);
  if (!known.isFile()) throw new Error(`${path} is not a file`);
  if (!held(known)) return null;
  const size = known.size;
  const hash = createHash('sha256').update(`${size}\0`);
  const file = await open(path, 'r');
  try {
    if (size <= PIECES * PIECE) {
      const all = Buffer.allocUnsafe(size);
      const { bytesRead } = await file.read(all, 0, size, 0);
      hash.update(all.subarray(0, bytesRead));
    } else {
      const piece = Buffer.allocUnsafe(PIECE);
      for (let i = 0; i < PIECES; i++) {
        const { bytesRead } = await file.read(piece, 0, PIECE, Math.floor(((size - PIECE) * i) / (PIECES - 1)));
        hash.update(piece.subarray(0, bytesRead));
      }
    }
  } finally {
    await file.close();
  }
  return `${MARK}${hash.digest('hex').slice(0, 32)}`;
}
