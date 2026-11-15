// @ts-check
// Lossless draft-media work. All analysis covers every stored frame, including alpha=1 shadows.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { homedir, release } from 'node:os';
import { exactRate, ffmpegRate } from '../../src/rate.mjs';
import { signature } from '../../src/render-resume.mjs';
const exec = promisify(execFile);
/** Only a target-editor build actually checked for RGB decode is allowed to use this profile.
 * @param {string | null} app @param {NodeJS.Platform} [platform] @param {string} [arch] */
export async function draftRgbProfile(app, platform = process.platform, arch = process.arch) {
  if (platform !== 'darwin' || arch !== 'arm64' || app !== 'jianying') return null;
  for (const base of ['/Applications', join(homedir(), 'Applications')]) for (const name of ['VideoFusion-macOS.app', 'JianyingPro.app', '剪映专业版.app']) {
    try {
      const { stdout } = await exec('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', join(base, name, 'Contents', 'Info.plist')]);
      if (stdout.trim() === '11.8.0') return 'jianying-macos-11.8.0-rgb-tv2';
    } catch { /* not this installation */ }
  }
  return null;
}

/** QuickTime Animation's RGBA path was separately checked by native editor readback.
 * @param {string | null} app @param {NodeJS.Platform} [platform] @param {string} [arch] */
export async function draftRleProfile(app, platform = process.platform, arch = process.arch) {
  return await draftRgbProfile(app, platform, arch) ? 'jianying-macos-11.8.0-rle-v1' : null;
}

/** Keep a single transparent material while reusing unchanged regions between frames. Never publish a larger
 * representation or one that changes a pixel, sample time, or sound stream. An unsupported encoder keeps PNG.
 * @param {string} file @param {{fps:number,signal:AbortSignal}} options */
export async function compactDraftPng(file, { fps, signal }) {
  const temporary = `${file}.rle.mov`;
  const sample = `${file}.png-sample.mov`;
  const rate = exactRate(fps), before = (await stat(file)).size;
  const probe = async (/** @type {string} */ path) => JSON.parse((await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height:packet=pts_time,duration_time', '-of', 'json', path], { signal, maxBuffer: 32 << 20, windowsHide: true })).stdout);
  const pixels = async (/** @type {string} */ path) => (await exec('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-threads', '2', '-i', path,
    '-map', '0:v:0', '-vf', `fps=${ffmpegRate(rate)},format=rgba`, '-f', 'hash', '-hash', 'sha256', '-'], { signal, windowsHide: true })).stdout.trim();
  try {
    const original = await probe(file);
    const sourceCodec = original.streams?.[0]?.codec_name;
    if (!['png', 'qtrle'].includes(sourceCodec) || original.packets?.length < 12) return null;
    let codec = 'qtrle';
    if (sourceCodec === 'qtrle') {
      // Estimate PNG on a short middle sample before spending a full second encode on photographic frames.
      // The full candidate still has to earn its bytes and pass every pixel and timestamp below.
      const n = original.packets.length, take = Math.min(12, n), from = Math.floor((n - take) / 2);
      await exec('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-threads', '2', '-i', file,
        '-an', '-vf', `trim=start_frame=${from}:end_frame=${from + take},setpts=PTS-STARTPTS,format=rgba`,
        '-frames:v', String(take), '-fps_mode', 'passthrough', '-c:v', 'png', '-compression_level', '3', '-pred', 'sub', '-threads', '2', sample], { signal, windowsHide: true });
      if ((await stat(sample)).size * n / take < before * 0.9) codec = 'png';
    }
    await exec('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-threads', '2', '-i', file,
      '-map', '0:v:0', '-map', '0:a?', '-vf', codec === 'png' ? 'format=rgba' : 'format=argb', '-fps_mode', 'passthrough', '-c:v', codec,
      ...(codec === 'png' ? ['-compression_level', '3', '-pred', 'sub'] : ['-g', String(Math.max(1, Math.round(fps * 10)))]),
      '-threads', '2', '-enc_time_base', `${rate.den}:${rate.num}`,
      '-bsf:v', `setts=duration=1/((${ffmpegRate(rate)})*TB)`, '-c:a', 'copy', temporary], { signal, windowsHide: true });
    const after = (await stat(temporary)).size;
    if (after >= before * 0.9) return null;
    const made = await probe(temporary);
    const clock = (/** @type {any} */ p) => [Number(p.pts_time), Number(p.duration_time)].map((v) => Math.round(v * 1e6));
    if (made.streams?.[0]?.width !== original.streams[0].width || made.streams?.[0]?.height !== original.streams[0].height
      || made.packets?.length !== original.packets.length
      || made.packets.some((/** @type {any} */ p, /** @type {number} */ i) => JSON.stringify(clock(p)) !== JSON.stringify(clock(original.packets[i])))
      || await pixels(file) !== await pixels(temporary)) return null;
    await replace(temporary, file, signal);
    return { codec, before, after };
  } catch (e) {
    if (signal.aborted || /ENOSPC|no space left on device/i.test(String(e))) throw e;
    return null;
  } finally { await Promise.all([temporary, sample].map((path) => rm(path, { force: true }))); }
}

/** @param {string} file @param {AbortSignal} signal */
export async function draftVideoCodec(file, signal) {
  return (await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file],
    { signal, windowsHide: true })).stdout.trim();
}

/** @typedef {{from:number,to:number,opaque:boolean,suffix:string}} DraftPart */
/** @param {string} file @param {string} suffix */
export const draftPartPath = (file, suffix) => file.replace(/\.mov$/i, `${suffix}.mov`);

/** PNG alpha runs and lossless RGB opaque runs. Every decoded RGBA pixel is verified before publication.
 * @param {string} file @param {{spans:{from:number,to:number,opaque:boolean}[]}} analysis
 * @param {{fps:number,frames:number,signal:AbortSignal}} options */
export async function splitDraftPng(file, analysis, { fps, frames, signal }) {
  /** @type {DraftPart[]} */ const parts = [];
  for (const span of analysis.spans) {
    const opaque = span.opaque && span.to - span.from >= fps;
    const last = parts.at(-1);
    if (last && last.opaque === opaque) last.to = span.to;
    else parts.push({ ...span, opaque, suffix: parts.length ? `.part-${parts.length}` : '' });
  }
  if (parts.length < 2 || parts.length > 16 || !parts.some((p) => p.opaque) || parts[0].from !== 0 || parts.at(-1)?.to !== frames) return null;
  const rate = ffmpegRate(exactRate(fps));
  const temps = parts.map((_, i) => `${file}.split-${i}.mov`);
  const graph = (/** @type {DraftPart} */ p) => `fps=${rate},trim=start_frame=${p.from}:end_frame=${p.to},setpts=PTS-STARTPTS`;
  const pixels = async (/** @type {string} */ path, /** @type {string} */ filter, /** @type {number} */ count) => (await exec('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-threads', '2', '-i', path,
    '-map', '0:v:0', '-vf', `${filter},format=rgba`, '-frames:v', String(count), '-f', 'hash', '-hash', 'sha256', '-'], { signal, windowsHide: true })).stdout.trim();
  let accepted = false;
  try {
    for (const [i, part] of parts.entries()) {
      const count = part.to - part.from;
      // This editor build contracts RGB tagged full-range a second time. Its tested TV flag retains the RGB
      // samples (verified below) and avoids that decode bug. Never apply this profile to unverified editors.
      const codec = part.opaque ? ['-vf', `${graph(part)},format=rgb24`, '-c:v', 'libx264rgb', '-preset', 'veryfast', '-crf', '0', '-colorspace', 'rgb', '-color_range', 'tv']
        : ['-vf', `${graph(part)},format=rgba`, '-c:v', 'png', '-compression_level', '3', '-pred', 'sub'];
      await exec('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-threads', '2', '-i', file, '-an', ...codec,
        '-threads', '2', '-frames:v', String(count), '-r', rate, temps[i]], { signal, windowsHide: true });
      const { stdout } = await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames', '-of', 'csv=p=0', temps[i]], { signal, windowsHide: true });
      if (Number(stdout.trim()) !== count || await pixels(file, graph(part), count) !== await pixels(temps[i], 'setpts=PTS-STARTPTS', count)) return null;
    }
    const sizes = await Promise.all(temps.map((p) => stat(p)));
    if (sizes.reduce((n, s) => n + s.size, 0) >= (await stat(file)).size * 0.9) return null;
    // Retain the full original until all parts pass. Export staging owns these names and is swept on cancellation.
    for (let i = 1; i < parts.length; i++) await replace(temps[i], draftPartPath(file, parts[i].suffix), signal);
    await replace(temps[0], file, signal);
    accepted = true;
    return parts;
  } catch (e) {
    if (signal.aborted || /ENOSPC|no space left on device/i.test(String(e))) throw e;
    return null; // Unsupported encoder, an exactness failure, or an unprofitable representation keeps the PNG.
  } finally {
    await Promise.all(temps.map((p) => rm(p, { force: true })));
    if (!accepted) await Promise.all(parts.slice(1).map((p) => rm(draftPartPath(file, p.suffix), { force: true })));
  }
}

/** @typedef {{ x: number, y: number, w: number, h: number }} Crop */
/** Scan exact alpha, never a downscaled estimate. @param {string} file @param {AbortSignal} signal @param {number} [fps] */
export async function draftAlpha(file, signal, fps = 30) {
  const clock = exactRate(fps).fps;
  const { stdout } = await exec('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-threads', '2', '-i', file, '-map', '0:v:0',
    '-vf', 'format=rgba,alphaextract,signalstats,bbox=min_val=0,metadata=print:file=-', '-f', 'null', '-'], { signal, maxBuffer: 256 << 20, windowsHide: true });
  /** @type {{ opaque: boolean, from: number, to: number }[]} */
  const spans = [];
  let x1 = Infinity, y1 = Infinity, x2 = -1, y2 = -1, frames = 0;
  for (const block of stdout.split(/(?=frame:\d)/)) {
    if (!block.startsWith('frame:')) continue;
    const min = /lavfi.signalstats.YMIN=(\d+)/.exec(block);
    if (!min) throw new Error('draft alpha analysis missed a frame');
    const opaque = Number(min[1]) === 255;
    const time = /pts_time:([\d.e+-]+)/.exec(block);
    const at = time ? Math.round(Number(time[1]) * clock) : frames;
    const last = spans.at(-1);
    if (last) last.to = at;
    if (last?.opaque === opaque) last.to = at + 1;
    else spans.push({ opaque, from: at, to: at + 1 });
    frames++;
    const values = Object.fromEntries([...block.matchAll(/lavfi.bbox.(x1|x2|y1|y2|w|h)=(\d+)/g)].map((m) => [m[1], Number(m[2])]));
    if (values.w > 0 && values.h > 0) {
      x1 = Math.min(x1, values.x1); y1 = Math.min(y1, values.y1);
      x2 = Math.max(x2, values.x2); y2 = Math.max(y2, values.y2);
    }
  }
  if (!frames) throw new Error('draft alpha analysis returned no frames');
  return { frames, spans, crop: x2 >= x1 && y2 >= y1 ? { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 } : null };
}

/** Crop only when it removes most of the work; preserve all alpha and audio. Deduplicate the newly encoded PNG
 * before deciding whether a crop earns its bytes (the input may already use interframe compression).
 * @param {string} file @param {{w:number,h:number,frames?:number,fps?:number}} size @param {AbortSignal} signal
 * @param {(file:string,signal:AbortSignal)=>Promise<unknown>} [compact] */
export async function cropDraftPng(file, size, signal, compact) {
  const analysis = await draftAlpha(file, signal, size.fps);
  if (size.frames && analysis.frames !== size.frames) return { ...analysis, crop: null };
  let crop = analysis.crop;
  // Keep even offsets: target editors often round half-pixel placement. Grow outwards, never inwards.
  if (crop) {
    const x = Math.floor(crop.x / 2) * 2, y = Math.floor(crop.y / 2) * 2;
    const right = Math.min(size.w, Math.ceil((crop.x + crop.w) / 2) * 2);
    const bottom = Math.min(size.h, Math.ceil((crop.y + crop.h) / 2) * 2);
    crop = { x, y, w: right - x, h: bottom - y };
  }
  if (!crop || crop.w * crop.h > size.w * size.h * 0.6) return { ...analysis, crop: null };
  const part = `${file}.crop.mov`;
  const rate = exactRate(size.fps ?? 30);
  try {
    await exec('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-threads', '2', '-i', file,
      '-map', '0:v:0', '-map', '0:a?', '-vf', `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}:exact=1,format=rgba`, '-fps_mode', 'passthrough',
      '-c:v', 'png', '-compression_level', '3', '-pred', 'sub', '-threads', '2', '-enc_time_base', `${rate.den}:${rate.num}`,
      '-bsf:v', `setts=duration=1/((${ffmpegRate(rate)})*TB)`, '-c:a', 'copy', part], { signal, windowsHide: true });
    await compact?.(part, signal);
    // A crop must also earn its disk space. A very compressible transparent border can cost fewer bytes than this.
    if ((await stat(part)).size < (await stat(file)).size) await replace(part, file, signal);
    else crop = null;
  } finally { await rm(part, { force: true }); }
  return { ...analysis, crop };
}

/** Antivirus software can retain a just-closed MOV for a moment on Windows.
 * @param {string} from @param {string} to @param {AbortSignal} signal */
async function replace(from, to, signal) {
  for (let n = 0;; n++) {
    signal?.throwIfAborted();
    try { return await rename(from, to); }
    catch (e) { if (n >= 30 || !['EBUSY', 'EPERM', 'EACCES'].includes(/** @type {NodeJS.ErrnoException} */ (e).code ?? '')) throw e; await delay(100, undefined, { signal }); }
  }
}

/** Full content hashes, including large videos; timestamp-preserving replacements must invalidate. @param {string} path */
async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** The implementation itself is part of a persistent cache key, also in source checkouts without a version bump. */
export async function draftEngineVersion() {
  const hash = createHash('sha256');
  hash.update(JSON.stringify([process.platform, process.arch, release()]));
  hash.update((await exec('ffmpeg', ['-version'], { windowsHide: true, timeout: 10_000 })).stdout);
  for (const base of [new URL('../../src/', import.meta.url), new URL('./', import.meta.url)]) {
    for (const name of (await readdir(base)).filter((n) => /\.(mjs|js)$/.test(n) && !n.endsWith('.test.mjs')).sort()) {
      hash.update(name); hash.update(await readFile(new URL(name, base)));
    }
  }
  // Bundled fonts can change without a JS or package version change.
  const fonts = new URL('../../library/text/fonts/', import.meta.url);
  try { for (const name of (await readdir(fonts)).sort()) hash.update(await readFile(new URL(name, fonts))); } catch { /* a distribution without bundled fonts */ }
  // Local font installation/replacement changes the renderer even when no project file changes.
  const localFonts = process.platform === 'darwin' ? [join(homedir(), 'Library', 'Fonts'), '/Library/Fonts', '/System/Library/Fonts']
    : process.platform === 'win32' ? [join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts'), join(process.env.LOCALAPPDATA ?? homedir(), 'Microsoft', 'Windows', 'Fonts')]
      : ['/usr/share/fonts', join(homedir(), '.local/share/fonts'), join(homedir(), '.fonts')];
  const inspect = async (/** @type {string} */ path, depth = 0) => {
    try {
      for (const name of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = join(path, name.name);
        if (name.isDirectory() && depth < 4) await inspect(file, depth + 1);
        else if (name.isFile()) { const s = await stat(file, { bigint: true }); hash.update(`${file}:${s.size}:${s.mtimeNs}:${s.ctimeNs}:${s.ino}`); }
      }
    } catch { /* a font directory that is absent or not readable */ }
  };
  for (const path of localFonts) await inspect(path);
  return `draft-png-v2:${hash.digest('hex')}`;
}

/** Successful per-clip results, not render's crash-resume chunks. @param {string} root @param {string} version */
export function draftCache(root, version) {
  const folder = join(root, '.film', 'cache', 'draft-media');
  /** @type {Map<string, {stamp:string, hash:Promise<string>}>} */ const hashes = new Map();
  const hashed = (/** @type {string} */ path) => {
    const stamp = signature(path), previous = hashes.get(path);
    if (previous?.stamp === stamp) return previous.hash;
    const hash = digest(path); hashes.set(path, { stamp, hash });
    return hash;
  };
  const keyOf = (/** @type {unknown} */ descriptor) => createHash('sha256').update(JSON.stringify([version, descriptor])).digest('hex');
  return {
    keyOf,
    /** @param {string} key @param {string} destination */
    async get(key, destination) {
      /** @type {string[]} */ const copied = [];
      let restored = false;
      try {
        const entry = join(folder, key);
        const value = JSON.parse(await readFile(join(entry, 'manifest.json'), 'utf8'));
        if (value.version !== version || !Array.isArray(value.dependencies) || !value.dependencies.length || !Array.isArray(value.media) || !value.media.length
          || !value.result || !Number.isInteger(value.result.durationFrames) || value.result.durationFrames <= 0) return null;
        const crop = value.result.crop;
        if (crop != null && (!['x', 'y', 'w', 'h'].every((k) => Number.isInteger(crop[k])) || crop.x < 0 || crop.y < 0 || crop.w <= 0 || crop.h <= 0)) return null;
        const parts = value.result.parts;
        const suffixes = parts == null ? [''] : Array.isArray(parts) && parts.length >= 2 && parts.length <= 16
          && parts.every((/** @type {DraftPart} */ p, /** @type {number} */ i) => Number.isInteger(p.from) && Number.isInteger(p.to) && p.to > p.from
            && p.from === (i ? parts[i - 1].to : 0) && p.suffix === (i ? `.part-${i}` : '') && typeof p.opaque === 'boolean')
          && parts.at(-1).to === value.result.durationFrames && !crop ? parts.map((/** @type {DraftPart} */ p) => p.suffix) : null;
        if (!suffixes || value.media.length !== suffixes.length || value.media.some((/** @type {{suffix:string}} */ m, /** @type {number} */ i) => m.suffix !== suffixes[i])) return null;
        for (const dep of value.dependencies) {
          if (typeof dep.path !== 'string' || typeof dep.hash !== 'string' || await hashed(dep.path) !== dep.hash) return null;
        }
        for (const media of value.media) {
          if (typeof media.artifact !== 'string' || !/^(?:|\.part-\d+)$/.test(media.suffix) || (await stat(media.artifact)).size !== media.bytes || await digest(media.artifact) !== media.hash) return null;
        }
        for (const media of value.media) {
          const to = draftPartPath(destination, media.suffix);
          copied.push(to);
          await copyFile(media.artifact, to, constants.COPYFILE_FICLONE);
          if (await digest(to) !== media.hash) return null;
        }
        restored = true;
        return value.result;
      } catch (e) { if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ABORT_ERR') throw e; return null; }
      finally { if (!restored) await Promise.all(copied.map((p) => rm(p, { force: true }))); }
    },
    /** No hidden media duplicate: index the completed export and clone it only when a new export asks for it.
     * @param {string} key @param {string} source @param {string[]} dependencies @param {unknown} result @param {string} [artifact] @param {string[]} [suffixes]
     * @param {ReadonlyMap<string,string>} [snapshots] */
    async put(key, source, dependencies, result, artifact = source, suffixes = [''], snapshots) {
      const entry = join(folder, key), temporary = join(entry, `manifest.${process.pid}-${randomBytes(4).toString('hex')}.json`);
      try {
        // Never retain temporary wrapper documents. The descriptor carries their stable content instead.
        const paths = [...new Set(dependencies)].filter((p) => {
          const rel = relative(root, p);
          return isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) || !rel.split(sep).includes('.film');
        });
        if (!paths.length) return;
        const unchanged = () => !snapshots || paths.every((p) => snapshots.get(p) === signature(p));
        if (!unchanged()) return;
        const deps = await Promise.all(paths.map(async (path) => ({ path, hash: await hashed(path) })));
        await mkdir(entry, { recursive: true });
        const media = await Promise.all(suffixes.map(async (suffix) => ({ suffix, artifact: draftPartPath(artifact, suffix), bytes: (await stat(draftPartPath(source, suffix))).size, hash: await digest(draftPartPath(source, suffix)) })));
        if (!unchanged()) return; // Never label pixels already drawn with the bytes of an edit made during export.
        await writeFile(temporary, JSON.stringify({ version, dependencies: deps, media, result }));
        await rename(temporary, join(entry, 'manifest.json'));
      } finally { await rm(temporary, { force: true }); }
    },
  };
}
