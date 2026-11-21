// @ts-check
/**
 * A zip of files. Most of what goes in here is PNG, JPEG or media, compressed already: stored as it is, a piece at a
 * time. What is written out in full (pages, scripts, data, subtitles, logs, fonts as TrueType) is deflated, by its
 * name: a project of web pages comes to a third less, and one with footage loses only the little its text takes.
 * Zip64 where the archive needs it (more than 65,535 entries, a file or the whole past 4 GB), so a long PNG sequence or
 * a project with its footage is still one file.
 */
import { statSync } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { promisify } from 'node:util';
import { crc32, deflateRaw } from 'node:zlib';

const deflate = promisify(deflateRaw);

const MAX16 = 0xffff;
const MAX32 = 0xffffffff;
/** How much of a file is read at a time. */
const PIECE = 4 << 20;
/**
 * The files worth deflating, by the end of their names: text, and the fonts and vectors that are written out in full
 * (a TrueType font comes to two thirds or less; WOFF2, PNG, JPEG, MP4 and the like are compressed already and gain
 * nothing for the time it takes).
 */
const DEFLATED = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.jsonl', '.map', '.svg', '.xml', '.rels', '.fcpxml',
  '.txt', '.md', '.csv', '.tsv', '.log', '.yml', '.yaml', '.toml', '.srt', '.vtt', '.ass', '.ssa', '.lrc', '.cube', '.3dl', '.edl',
  '.glsl', '.frag', '.vert', '.wgsl', '.py', '.sh', '.obj', '.gltf', '.ttf', '.otf']);
/** A larger file is stored: deflating holds the whole of it in memory. */
const DEFLATE_UP_TO = 32 << 20;
/** Deflated only when it comes to this share of its size or less: otherwise the bytes as they are, read back sooner. */
const WORTH = 0.9;
/** How much of what may be deflated is read ahead of its turn, in bytes and in files at once (zipFiles). */
const AHEAD_BYTES = 64 << 20;
const AHEAD_FILES = 8;

/**
 * `data` deflated when its name says it may gain from it and it does (DEFLATED, WORTH); null to store it as it is.
 * @param {string} name @param {Buffer} data
 */
async function deflated(name, data) {
  if (!data.length || data.length > DEFLATE_UP_TO || !DEFLATED.has(extname(name).toLowerCase())) return null;
  const packed = await deflate(data, { level: 6 });
  return packed.length <= data.length * WORTH ? packed : null;
}

/** Today as MS-DOS time and date (what a zip entry carries). */
function dosStamp(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/**
 * Write `entries` (a name inside the zip, and the file on disk or the bytes themselves) to the zip `out`. A file is
 * read a piece at a time (footage can be gigabytes); its size is taken before, its checksum while it is copied and
 * written into its header after. One that may gain from it (`deflated`) is read whole and deflated ahead of its turn,
 * on other threads, while the files before it are copied: a font takes longer to deflate than footage many times its
 * size takes to copy, and a project has both. The entries stay in the order given. `signal` stops it between pieces.
 * @param {string} out @param {({ name: string, file: string } | { name: string, data: Buffer })[]} entries @param {AbortSignal} [signal]
 * @param {(bytes: number) => void} [onBytes] how many bytes of the entries are in so far
 */
export async function zipFiles(out, entries, signal, onBytes = () => {}) {
  const fh = await open(out, 'w');
  const { time, day } = dosStamp();
  /** @type {{ name: Buffer, crc: number, size: number, packed: number, method: number, offset: number }[]} */
  const written = [];
  let offset = 0;
  let copied = 0;
  const put = async (/** @type {Buffer} */ buf) => { await fh.write(buf, 0, buf.length, offset); offset += buf.length; };
  /** @type {Map<number, { bytes: number, made: Promise<{ whole: Buffer, packed: Buffer | null }> }>} the entries read ahead, by their place */
  const ahead = new Map();
  /* the next entry to look at; the bytes read ahead and not written yet; the files being read */
  let reach = 0, holding = 0, reading = 0;
  /** From entry `from` on: what may be deflated starts being read and deflated, while there is room to hold it. */
  const lookAhead = (/** @type {number} */ from) => {
    for (reach = Math.max(reach, from); reach < entries.length; reach++) {
      const entry = entries[reach];
      if (!DEFLATED.has(extname(entry.name).toLowerCase())) continue;
      let bytes = 0;
      if ('data' in entry) bytes = entry.data.length;
      else try { bytes = statSync(entry.file).size; } catch { continue; /* gone: said at its turn, when it is opened */ }
      if (!bytes || bytes > DEFLATE_UP_TO) continue;
      /* room for one more, or the one whose turn it is (it is waited for now, whatever is held) */
      if (reach !== from && (holding + bytes > AHEAD_BYTES || reading >= AHEAD_FILES)) return;
      holding += bytes;
      reading++;
      const made = (async () => {
        try {
          const whole = 'data' in entry ? entry.data : await readFile(entry.file);
          return { whole, packed: await deflated(entry.name, whole) };
        } finally {
          reading--;
        }
      })();
      /* one never reached (the zip failed or was cancelled before its turn) fails unheard */
      made.catch(() => {});
      ahead.set(reach, { bytes, made });
    }
  };
  try {
    for (const [index, entry] of entries.entries()) {
      if (signal?.aborted) throw new Error('cancelled');
      lookAhead(index);
      const read = ahead.get(index);
      ahead.delete(index);
      /* one worth deflating was read whole (it is small), and is written with its checksum and sizes known */
      const { whole, packed } = read ? await read.made.finally(() => { holding -= read.bytes; }) : { whole: 'data' in entry ? entry.data : null, packed: null };
      const source = whole ? null : await open(/** @type {{ file: string }} */ (entry).file, 'r');
      try {
        const size = whole ? whole.length : (await /** @type {import('node:fs/promises').FileHandle} */ (source).stat()).size;
        const big = size >= MAX32;
        const name = Buffer.from(entry.name, 'utf8');
        /* past 4 GB the sizes are in a zip64 field: the header says so with 0xffffffff */
        const extra = big ? Buffer.alloc(20) : Buffer.alloc(0);
        if (big) {
          extra.writeUInt16LE(0x0001, 0);
          extra.writeUInt16LE(16, 2);
          extra.writeBigUInt64LE(BigInt(size), 4);
          extra.writeBigUInt64LE(BigInt(size), 12);
        }
        const head = Buffer.alloc(30);
        head.writeUInt32LE(0x04034b50, 0);
        head.writeUInt16LE(big ? 45 : 20, 4); // version needed
        head.writeUInt16LE(0x0800, 6); // names are UTF-8
        head.writeUInt16LE(packed ? 8 : 0, 8); // deflated, or stored
        head.writeUInt16LE(time, 10);
        head.writeUInt16LE(day, 12);
        head.writeUInt32LE(big ? MAX32 : packed ? packed.length : size, 18);
        head.writeUInt32LE(big ? MAX32 : size, 22);
        head.writeUInt16LE(name.length, 26);
        head.writeUInt16LE(extra.length, 28);
        const at = offset;
        await put(head);
        await put(name);
        await put(extra);
        let crc = 0;
        if (whole) {
          crc = crc32(whole);
          await put(packed ?? whole);
          onBytes(copied += whole.length);
        } else if (source) {
          const piece = Buffer.alloc(Math.min(PIECE, Math.max(1, size)));
          for (let read = 0; read < size;) {
            if (signal?.aborted) throw new Error('cancelled');
            const { bytesRead } = await source.read(piece, 0, Math.min(piece.length, size - read), read);
            if (!bytesRead) throw new Error(`${entry.name}: changed while it was being zipped`);
            const chunk = piece.subarray(0, bytesRead);
            crc = crc32(chunk, crc);
            await put(chunk);
            read += bytesRead;
            onBytes(copied += bytesRead);
          }
        }
        const sum = Buffer.alloc(4);
        sum.writeUInt32LE(crc, 0);
        await fh.write(sum, 0, 4, at + 14);
        written.push({ name, crc, size, packed: packed ? packed.length : size, method: packed ? 8 : 0, offset: at });
      } finally {
        await source?.close();
      }
    }

    const cdStart = offset;
    for (const e of written) {
      const big = e.size >= MAX32;
      const far = e.offset >= MAX32;
      /* the zip64 field holds, in this order, what does not fit: the sizes, then where the entry starts */
      const fields = [...(big ? [e.size, e.packed] : []), ...(far ? [e.offset] : [])];
      const extra = Buffer.alloc(fields.length ? 4 + fields.length * 8 : 0);
      if (fields.length) {
        extra.writeUInt16LE(0x0001, 0); // zip64 extended information
        extra.writeUInt16LE(fields.length * 8, 2);
        fields.forEach((n, i) => extra.writeBigUInt64LE(BigInt(n), 4 + i * 8));
      }
      const head = Buffer.alloc(46);
      head.writeUInt32LE(0x02014b50, 0);
      head.writeUInt16LE(fields.length ? 45 : 20, 4); // made by
      head.writeUInt16LE(fields.length ? 45 : 20, 6); // needed
      head.writeUInt16LE(0x0800, 8);
      head.writeUInt16LE(e.method, 10);
      head.writeUInt16LE(time, 12);
      head.writeUInt16LE(day, 14);
      head.writeUInt32LE(e.crc, 16);
      head.writeUInt32LE(big ? MAX32 : e.packed, 20);
      head.writeUInt32LE(big ? MAX32 : e.size, 24);
      head.writeUInt16LE(e.name.length, 28);
      head.writeUInt16LE(extra.length, 30);
      // comment length, disk, internal and external attributes: 0
      head.writeUInt32LE(far ? MAX32 : e.offset, 42);
      await put(head);
      await put(e.name);
      await put(extra);
    }
    const cdSize = offset - cdStart;

    const zip64 = written.length >= MAX16 || cdStart >= MAX32 || cdSize >= MAX32;
    if (zip64) {
      const record = Buffer.alloc(56);
      record.writeUInt32LE(0x06064b50, 0);
      record.writeBigUInt64LE(44n, 4); // size of the rest of this record
      record.writeUInt16LE(45, 12);
      record.writeUInt16LE(45, 14);
      // this disk, the disk with the directory: 0
      record.writeBigUInt64LE(BigInt(written.length), 24);
      record.writeBigUInt64LE(BigInt(written.length), 32);
      record.writeBigUInt64LE(BigInt(cdSize), 40);
      record.writeBigUInt64LE(BigInt(cdStart), 48);
      const recordAt = offset;
      await put(record);
      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(0x07064b50, 0);
      locator.writeBigUInt64LE(BigInt(recordAt), 8);
      locator.writeUInt32LE(1, 16); // disks
      await put(locator);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(zip64 ? MAX16 : written.length, 8);
    end.writeUInt16LE(zip64 ? MAX16 : written.length, 10);
    end.writeUInt32LE(zip64 ? MAX32 : cdSize, 12);
    end.writeUInt32LE(zip64 ? MAX32 : cdStart, 16);
    await put(end);
  } finally {
    await fh.close();
  }
}
