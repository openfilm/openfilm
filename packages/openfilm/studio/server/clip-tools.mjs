// @ts-check
/**
 * What the canvas does to a clip on this computer, with ffmpeg, free: a part of it cut out (`trim`), its sound alone
 * (`audio`, as MP3), its picture cropped to a shape (`crop`), its shots, each a still where the picture cuts (`shots`), and
 * another clip joined on after it (`join`: a clip and its continuation, as one).
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
/** shots at least this far apart, s */
const SHOT_GAP = 0.7;
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

/**
 * A free name for what a tool made of `rel`: `<clip>-<tool>.<ext>`, else `<clip>-<tool>-2.<ext>`, … in assets/, or in
 * assets/.canvas/ for what is only on the way to something (`work`: the shots the agent reads), out of the library.
 */
function freeName(/** @type {string} */ root, /** @type {string} */ rel, /** @type {string} */ tool, /** @type {string} */ ext, work = false) {
  const base = basename(rel, extname(rel));
  for (let k = 1; ; k++) {
    const name = `assets/${work ? '.canvas/' : ''}${base}-${tool}${k > 1 ? `-${k}` : ''}${ext}`;
    if (!existsSync(inside(root, name))) return name;
  }
}

const H264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
const AAC = ['-c:a', 'aac', '-b:a', '192k'];
const even = (/** @type {number} */ n) => Math.max(2, Math.floor(n / 2) * 2);

/**
 * @param {string} root the project
 * @param {{ op?: unknown, path?: unknown, from?: unknown, to?: unknown, ratio?: unknown, most?: unknown, work?: unknown, then?: unknown }} body
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
    /* how much each frame changes from the one before (scaled down: only the change counts) */
    const log = await ffmpeg(['-i', src, '-an', '-vf', "scale=320:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score", '-f', 'null', '-']);
    const scores = [...log.matchAll(/pts_time:([\d.]+)[^\n]*\n[^\n]*lavfi\.scene_score=([\d.]+)/g)].map((m) => ({ t: Number(m[1]), s: Number(m[2]) }));
    const times = shotTimes(scores, length, most);
    const dir = freeName(root, rel, 'shots', '', body.work === true);
    const abs = inside(root, dir);
    const temp = `${abs}.part`;
    await rm(temp, { recursive: true, force: true });
    await mkdir(temp, { recursive: true });
    try {
      /* each shot's still from its middle, clear of the changes into and out of it */
      for (const [i, t] of times.entries()) {
        const middle = (t + (times[i + 1] ?? length)) / 2;
        await ffmpeg(['-ss', String(Math.min(Math.max(0, length - 0.05), middle)), '-i', src, '-frames:v', '1', '-vf', `scale='min(${SHOT_WIDTH}\\,iw)':-2`, join(temp, `shot-${String(i + 1).padStart(2, '0')}.png`)]);
      }
      await mkdir(dirname(abs), { recursive: true });
      await rename(temp, abs);
      const names = (await readdir(abs)).filter((n) => n.endsWith('.png')).sort();
      return { paths: names.map((n) => `${dir}/${n}`), times: times.slice(0, names.length) };
    } catch (e) {
      await rm(temp, { recursive: true, force: true });
      throw e;
    }
  }
  if (body.op === 'join') {
    if (typeof body.then !== 'string') throw new HttpError(400, 'then: the clip to join on');
    const next = readable(root, body.then);
    const more = await probe(root, body.then);
    /* both at the first's size and rate; one with no sound gets silence, so the joined clip has sound throughout */
    const W = even(facts.width), H = even(facts.height ?? 0), fps = facts.fps || 24;
    const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`;
    const quiet = (/** @type {number} */ s) => ['-f', 'lavfi', '-t', String(s || 0.1), '-i', 'anullsrc=r=48000:cl=stereo'];
    const sound = (/** @type {boolean} */ has, /** @type {number} */ i, /** @type {number} */ q) => `[${has ? `${i}:a:0` : `${q}:a`}]aresample=48000,aformat=channel_layouts=stereo[a${i}]`;
    const out = freeName(root, rel, 'extended', '.mp4');
    await ffmpeg(['-i', src, '-i', next, ...quiet(length), ...quiet(more.duration ?? 0),
      '-filter_complex', `[0:v]${fit}[v0];[1:v]${fit}[v1];${sound(facts.audio, 0, 2)};${sound(more.audio, 1, 3)};[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`,
      '-map', '[v]', '-map', '[a]', ...H264, ...AAC, inside(root, out)]);
    return { paths: [out] };
  }
  throw new HttpError(400, 'op: trim, audio, crop, shots or join');
}

/**
 * Where a clip's shots begin, from how much each frame changes (`s`, ffmpeg's scene score at `t`): its start, then the
 * frames that change far more than the clip's own usual (a cut, or a wipe's or push's peak), the strongest first, at
 * least SHOT_GAP apart. A clip with no such change (one long shot): evenly spaced stills instead.
 * @param {{ t: number, s: number }[]} scores @param {number} length @param {number} most
 */
export function shotTimes(scores, length, most) {
  /* the clip's usual change (its median and median spread: one strong cut does not raise the bar for the others) */
  const middle = (/** @type {number[]} */ v) => { const o = [...v].sort((a, b) => a - b); return o.length ? o[Math.floor(o.length / 2)] : 0; };
  const usual = middle(scores.map((x) => x.s));
  const spread = middle(scores.map((x) => Math.abs(x.s - usual)));
  const bar = Math.max(0.05, usual + 10 * spread);
  const picked = [0];
  for (const { t } of scores.filter((x) => x.s >= bar).sort((a, b) => b.s - a.s)) {
    if (picked.length >= most) break;
    if (picked.every((p) => Math.abs(p - t) >= SHOT_GAP)) picked.push(t);
  }
  if (picked.length < 2 && length >= 4) {
    const n = Math.min(most, Math.max(3, Math.round(length / 2.5)));
    return Array.from({ length: n }, (_, i) => Math.round(((i * length) / n) * 100) / 100);
  }
  return picked.sort((a, b) => a - b).map((t) => Math.round(t * 100) / 100);
}

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {string} root @param {string} rest */
export async function clipToolsRoute(req, res, root, rest) {
  if (rest !== 'clip-tools' || req.method !== 'POST') return false;
  json(res, 200, await clipTool(root, /** @type {any} */ (await readJson(req))));
  return true;
}
