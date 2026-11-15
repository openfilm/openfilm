// @ts-check
/**
 * What the canvas does to a clip on this computer, with ffmpeg, free: a part of it cut out (`trim`), its sound alone
 * (`audio`, as MP3), its picture cropped to a shape (`crop`), and its shots, each a still where the picture cuts (`shots`).
 * What it makes lands in `assets/`, named after the clip and the tool, never over a file that is there.
 *
 *   POST /api/projects/:id/clip-tools  { op, path, from?, to?, ratio?, most? }  →  { paths: [...], times?: [...] }
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { probe } from './derived.mjs';
import { inside, readable } from './files.mjs';
import { HttpError, json, readJson } from './http.mjs';

/** the most shots taken from one clip */
const SHOTS_MAX = 24;
/** how different two frames are for a cut between them (ffmpeg's scene score, 0..1) */
const CUT_SCORE = 0.3;
/** a picture of a shot at most this wide */
const SHOT_WIDTH = 1280;

/** @param {string[]} args @returns {Promise<string>} its stderr */
function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-hide_banner', '-y', ...args], { maxBuffer: 64 << 20, windowsHide: true }, (error, _stdout, stderr) => {
      if (!error) return resolve(String(stderr));
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return reject(new HttpError(501, 'ffmpeg is not installed'));
      reject(new HttpError(422, String(stderr).trim().split('\n').pop() || error.message));
    });
  });
}

/** A free name in assets/ for what a tool made of `rel`: `<clip>-<tool>.<ext>`, else `<clip>-<tool>-2.<ext>`, … */
function freeName(/** @type {string} */ root, /** @type {string} */ rel, /** @type {string} */ tool, /** @type {string} */ ext) {
  const base = basename(rel, extname(rel));
  for (let k = 1; ; k++) {
    const name = `assets/${base}-${tool}${k > 1 ? `-${k}` : ''}${ext}`;
    if (!existsSync(inside(root, name))) return name;
  }
}

const H264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
const AAC = ['-c:a', 'aac', '-b:a', '192k'];
const even = (/** @type {number} */ n) => Math.max(2, Math.floor(n / 2) * 2);

/**
 * @param {string} root the project
 * @param {{ op?: unknown, path?: unknown, from?: unknown, to?: unknown, ratio?: unknown, most?: unknown }} body
 * @returns {Promise<{ paths: string[], times?: number[] }>}
 */
export async function clipTool(root, body) {
  if (typeof body.path !== 'string') throw new HttpError(400, 'path: the clip');
  const rel = body.path;
  const src = readable(root, rel);
  const facts = await probe(root, rel);
  if (!facts.width) throw new HttpError(422, `${rel} has no picture`);
  const length = facts.duration ?? 0;
  if (body.op === 'trim') {
    const from = Math.max(0, Number(body.from) || 0);
    const to = Math.min(length || Infinity, Number(body.to) || length);
    if (!(to - from >= 0.1)) throw new HttpError(400, 'from, to: a part at least 0.1 s long');
    const out = freeName(root, rel, 'trim', '.mp4');
    await ffmpeg(['-ss', String(from), '-i', src, '-t', String(to - from), '-map', '0:v:0', '-map', '0:a:0?', ...H264, ...AAC, inside(root, out)]);
    return { paths: [out] };
  }
  if (body.op === 'audio') {
    if (!facts.audio) throw new HttpError(422, 'no-audio');
    /* MP3: what every service that takes a recording takes (Seedance refuses AAC) */
    const out = freeName(root, rel, 'audio', '.mp3');
    await ffmpeg(['-i', src, '-vn', '-map', '0:a:0', '-c:a', 'libmp3lame', '-b:a', '192k', inside(root, out)]);
    return { paths: [out] };
  }
  if (body.op === 'crop') {
    const [rw, rh] = String(body.ratio ?? '').split(':').map(Number);
    if (!(rw > 0 && rh > 0)) throw new HttpError(400, 'ratio: w:h');
    const W = facts.width, H = facts.height ?? 0;
    const wide = W / H > rw / rh;
    const w = even(wide ? (H * rw) / rh : W), h = even(wide ? H : (W * rh) / rw);
    const out = freeName(root, rel, `${rw}x${rh}`, '.mp4');
    await ffmpeg(['-i', src, '-vf', `crop=${w}:${h}`, '-map', '0:v:0', '-map', '0:a:0?', ...H264, ...AAC, inside(root, out)]);
    return { paths: [out] };
  }
  if (body.op === 'shots') {
    const most = Math.min(SHOTS_MAX, Math.max(1, Math.round(Number(body.most) || SHOTS_MAX)));
    const dir = freeName(root, rel, 'shots', '');
    const abs = inside(root, dir);
    const temp = `${abs}.part`;
    await rm(temp, { recursive: true, force: true });
    await mkdir(temp, { recursive: true });
    try {
      /* the first frame, and each where the picture changes enough to be a cut */
      const log = await ffmpeg(['-i', src, '-vf', `select='eq(n\\,0)+gt(scene\\,${CUT_SCORE})',showinfo,scale='min(${SHOT_WIDTH}\\,iw)':-2`,
        '-fps_mode', 'vfr', '-frames:v', String(most), join(temp, 'shot-%02d.png')]);
      const times = [...log.matchAll(/pts_time:([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 100) / 100);
      await mkdir(dirname(abs), { recursive: true });
      await rename(temp, abs);
      const names = (await readdir(abs)).filter((n) => n.endsWith('.png')).sort();
      return { paths: names.map((n) => `${dir}/${n}`), times: times.slice(0, names.length) };
    } catch (e) {
      await rm(temp, { recursive: true, force: true });
      throw e;
    }
  }
  throw new HttpError(400, 'op: trim, audio, crop or shots');
}

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {string} root @param {string} rest */
export async function clipToolsRoute(req, res, root, rest) {
  if (rest !== 'clip-tools' || req.method !== 'POST') return false;
  json(res, 200, await clipTool(root, /** @type {any} */ (await readJson(req))));
  return true;
}
