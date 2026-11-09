// @ts-check
import { open } from 'node:fs/promises';

/**
 * FFmpeg feeds VideoToolbox straight BGRA, but the encoder defaults to declaring associated alpha.
 * Change the alpha_channel_information SEI in the MOV's HEVC decoder configuration to match the
 * pixels. See Apple's HEVC Video with Alpha Interoperability Profile, "Sample Description".
 * @param {string} path
 */
export async function markHevcStraightAlpha(path) {
  const file = await open(path, 'r+');
  try {
    const header = Buffer.alloc(16);
    /** @param {string} type @param {number} start @param {number} end */
    const find = async (type, start, end) => {
      for (let pos = start; pos + 8 <= end;) {
        if ((await file.read(header, 0, 8, pos)).bytesRead !== 8) break;
        let size = header.readUInt32BE(0);
        let head = 8;
        if (size === 1) {
          if (pos + 16 > end || (await file.read(header, 8, 8, pos + 8)).bytesRead !== 8) break;
          size = Number(header.readBigUInt64BE(8));
          head = 16;
        } else if (size === 0) size = end - pos;
        if (size < head || size > end - pos) break;
        if (header.toString('ascii', 4, 8) === type) return { start: pos + head, end: pos + size };
        pos += size;
      }
      throw new Error(`HEVC with alpha: missing ${type} box`);
    };

    // Our muxer writes the only video track first, followed by optional audio.
    let box = { start: 0, end: (await file.stat()).size };
    for (const type of ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd']) box = await find(type, box.start, box.end);
    const entry = await find('hvc1', box.start + 8, box.end); // stsd version, flags and entry count
    const config = await find('hvcC', entry.start + 78, entry.end); // visual sample entry fields
    const data = Buffer.alloc(config.end - config.start);
    if ((await file.read(data, 0, data.length, config.start)).bytesRead === data.length && data[0] === 1) {
      let pos = 23;
      for (let i = 0; i < data[22] && pos + 3 <= data.length; i++) {
        const type = data[pos] & 63;
        const count = data.readUInt16BE(pos + 1);
        pos += 3;
        for (let j = 0; j < count && pos + 2 <= data.length; j++) {
          const length = data.readUInt16BE(pos);
          pos += 2;
          if (pos + length > data.length) break;
          // The encoder writes the base layer's 8-bit alpha SEI as a single message.
          if (type === 39 && length === 9 && data[pos] === 0x4e && data[pos + 1] === 1
              && data[pos + 2] === 165 && data[pos + 3] === 4) {
            const flags = data[pos + 4];
            if (flags === 0x10) {
              const { bytesWritten } = await file.write(Buffer.from([0]), 0, 1, config.start + pos + 4);
              if (bytesWritten !== 1) throw new Error('HEVC with alpha: could not write the straight alpha flag');
              return;
            }
            if (flags === 0) return;
          }
          pos += length;
        }
      }
    }
    throw new Error('HEVC with alpha: missing a supported alpha channel information message');
  } finally {
    await file.close();
  }
}
