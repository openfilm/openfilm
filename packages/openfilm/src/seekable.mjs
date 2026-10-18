// Videos that seek fast, for a render. A render seeks each video to every frame, and a browser decodes from the key
// frame before the one asked: footage from cameras, phones and stock sites has one every 1 to 4 s, so each frame costs
// the decoding of up to a few hundred. Before rendering, such a video gets a copy with a key frame every quarter
// second, all but lossless, made once and kept in the project's cache; the render's pages are served the copy, and
// the sound is still mixed from the original.
import { execFile } from 'node:child_process';
import { existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { broken, chipDecoding, colorTagsOf, encoders, h264ColorTags, hardwareEncoder, hardwareOptions, hwaccels } from './encoders.mjs';
import { ffmpeg, hash, outDir } from './shared.mjs';

/** A key frame further apart than this is slow to seek to frame by frame. */
const SLOW_GOP_S = 0.5;
/** The copy's key frames: four a second. */
const COPY_GOP_S = 0.25;
/** A longer video is left as it is: copying it all could take longer than the render it would speed up. */
const MAX_SECONDS = 10 * 60;
/** Bigger than this is left as it is (H.264 stops at 4096 on a side in most decoders). */
const MAX_SIDE = 4096;
/** Changing how copies are made makes new ones. */
const VERSION = 2;

/** @param {string} file @returns {Promise<string>} */
const probe = (file, args) => new Promise((done, fail) => {
  execFile('ffprobe', ['-v', 'error', ...args, file], { maxBuffer: 16 << 20, windowsHide: true }, (error, stdout) => (error ? fail(error) : done(String(stdout))));
});

/**
 * What a copy of `file` would be made from: its first video stream, when it is one worth copying (8-bit 4:2:0, no
 * alpha, not too big or long, key frames far apart). Null when it is better left alone.
 * @param {string} file
 */
export async function slowSeeking(file) {
  let info;
  try {
    info = JSON.parse(await probe(file, ['-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt,avg_frame_rate:format=duration', '-of', 'json']));
  } catch { return null; }
  const stream = info.streams?.[0];
  const seconds = Number(info.format?.duration);
  if (!stream || !['yuv420p', 'yuvj420p'].includes(stream.pix_fmt)) return null;
  if (!(seconds > 0) || seconds > MAX_SECONDS || stream.width > MAX_SIDE || stream.height > MAX_SIDE) return null;
  const [n, d] = String(stream.avg_frame_rate).split('/').map(Number);
  const fps = n > 0 && d > 0 ? n / d : 30;
  /* the key frames among the packets of its first 20 s (read, not decoded) */
  let keys = 0, span = 0;
  try {
    const lines = (await probe(file, ['-select_streams', 'v:0', '-read_intervals', '%+20', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0'])).trim().split('\n');
    let first = null, last = null;
    for (const line of lines) {
      const [pts, flags] = line.split(',');
      const t = Number(pts);
      if (!Number.isFinite(t)) continue;
      first ??= t;
      last = t;
      if (flags?.startsWith('K')) keys++;
    }
    span = first == null || last == null ? 0 : last - first;
  } catch { return null; }
  if (keys === 0 || span <= 0) return null;
  return span / keys > SLOW_GOP_S ? { fps, seconds, w: Number(stream.width), h: Number(stream.height) } : null;
}

/**
 * The fast-seeking copy of each of `files` that needs one, made in `root`'s cache (or found there from before): a map
 * from a file to its copy. A file that is fine as it is, or whose copy fails, is not in it.
 * @param {string[]} files @param {string} root @param {{ signal?: AbortSignal }} [options]
 */
export async function seekableCopies(files, root, { signal } = {}) {
  const copies = new Map();
  const dir = outDir(root, 'seek');
  /* decoded by the Mac's media engine and written by the graphics chip's encoder, when they work; x264 otherwise */
  const [have, accels] = await Promise.all([encoders(), hwaccels()]);
  let chip = await hardwareEncoder('h264', have);
  /* two at a time: each one already keeps several cores busy (on the chip, it leaves them free) */
  const queue = [...new Set(files)];
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      if (signal?.aborted) return;
      let stat;
      try { stat = statSync(file); } catch { continue; }
      const out = join(dir, `${hash(Buffer.from(`${VERSION}\0${file}\0${stat.size}\0${stat.mtimeMs}`))}.mp4`);
      if (existsSync(out)) { copies.set(file, out); continue; }
      const slow = await slowSeeking(file);
      if (!slow) continue;
      const gop = Math.max(1, Math.round(slow.fps * COPY_GOP_S));
      const part = `${out}.part.mp4`;
      /* all but lossless: about 19 Mbps at 1080p and 30 fps; the chip's encoder keeps the source's color tags only
         when told them */
      const bits = Math.min(120e6, Math.max(4e6, ((slow.w * slow.h) || 1920 * 1080) * slow.fps * 0.3));
      const make = async (/** @type {string | null} */ encoder) => {
        /* the same frames at the same times (passthrough: no frame is added or dropped), the picture only */
        const run = ffmpeg([...(encoder ? chipDecoding(accels) : []), '-i', file, '-map', '0:v:0', '-an', '-sn', '-dn', '-fps_mode', 'passthrough',
          ...(encoder ? ['-pix_fmt', 'nv12', ...hardwareOptions(encoder, bits, { gop }), ...h264ColorTags(await colorTagsOf(file))]
            : ['-c:v', 'libx264', '-preset', 'superfast', '-crf', '16', '-g', String(gop), '-keyint_min', String(gop), '-pix_fmt', 'yuv420p']), part]);
        const stop = () => run.proc.kill('SIGKILL');
        signal?.addEventListener('abort', stop, { once: true });
        try { await run.done; } finally { signal?.removeEventListener('abort', stop); }
      };
      try {
        const encoder = chip;
        try {
          await make(encoder);
        } catch (e) {
          /* the chip's encoder gave up: this copy, and the rest, on the processor */
          if (!encoder || signal?.aborted) throw e;
          broken(encoder);
          chip = null;
          await make(null);
        }
        renameSync(part, out);
        copies.set(file, out);
      } catch {
        rmSync(part, { force: true });
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return copies;
}
