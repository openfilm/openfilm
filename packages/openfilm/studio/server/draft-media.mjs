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
const exec = promisify(execFile);

/** @typedef {{ x: number, y: number, w: number, h: number }} Crop */
/** Scan exact alpha, never a downscaled estimate. @param {string} file @param {AbortSignal} signal @param {number} [fps] */
export async function draftAlpha(file, signal, fps = 30) {
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
    const at = time ? Math.round(Number(time[1]) * fps) : frames;
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

/** Crop only when it removes most of the work; preserve all alpha and audio. @param {string} file @param {{w:number,h:number,frames?:number,fps?:number}} size @param {AbortSignal} signal */
export async function cropDraftPng(file, size, signal) {
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
  try {
    await exec('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-threads', '2', '-i', file,
      '-map', '0:v:0', '-map', '0:a?', '-vf', `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}:exact=1,format=rgba`, '-fps_mode', 'passthrough',
      '-c:v', 'png', '-compression_level', '1', '-pred', 'sub', '-threads', '2', '-c:a', 'copy', part], { signal, windowsHide: true });
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
  const inspect = async (path, depth = 0) => {
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
  /** @type {Map<string, Promise<string>>} */ const hashes = new Map();
  const hashed = (/** @type {string} */ path) => {
    if (!hashes.has(path)) hashes.set(path, digest(path));
    return /** @type {Promise<string>} */ (hashes.get(path));
  };
  const keyOf = (/** @type {unknown} */ descriptor) => createHash('sha256').update(JSON.stringify([version, descriptor])).digest('hex');
  return {
    keyOf,
    /** @param {string} key @param {string} destination */
    async get(key, destination) {
      try {
        const entry = join(folder, key);
        const value = JSON.parse(await readFile(join(entry, 'manifest.json'), 'utf8'));
        if (value.version !== version || !Array.isArray(value.dependencies) || !value.dependencies.length || typeof value.artifact !== 'string'
          || !value.result || !Number.isInteger(value.result.durationFrames) || value.result.durationFrames <= 0) return null;
        const crop = value.result.crop;
        if (crop != null && (!['x', 'y', 'w', 'h'].every((k) => Number.isInteger(crop[k])) || crop.x < 0 || crop.y < 0 || crop.w <= 0 || crop.h <= 0)) return null;
        for (const dep of value.dependencies) {
          if (typeof dep.path !== 'string' || typeof dep.hash !== 'string' || await hashed(dep.path) !== dep.hash) return null;
        }
        if ((await stat(value.artifact)).size !== value.bytes || await digest(value.artifact) !== value.mediaHash) return null;
        await copyFile(value.artifact, destination, constants.COPYFILE_FICLONE);
        if (await digest(destination) !== value.mediaHash) { await rm(destination, { force: true }); return null; }
        return value.result;
      } catch (e) { if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ABORT_ERR') throw e; return null; }
    },
    /** No hidden media duplicate: index the completed export and clone it only when a new export asks for it.
     * @param {string} key @param {string} source @param {string[]} dependencies @param {unknown} result @param {string} [artifact] */
    async put(key, source, dependencies, result, artifact = source) {
      const entry = join(folder, key), temporary = join(entry, `manifest.${process.pid}-${randomBytes(4).toString('hex')}.json`);
      try {
        // Never retain temporary wrapper documents. The descriptor carries their stable content instead.
        const paths = [...new Set(dependencies)].filter((p) => {
          const rel = relative(root, p);
          return isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) || !rel.split(sep).includes('.film');
        });
        if (!paths.length) return;
        const deps = await Promise.all(paths.map(async (path) => ({ path, hash: await hashed(path) })));
        await mkdir(entry, { recursive: true });
        await writeFile(temporary, JSON.stringify({ version, dependencies: deps, artifact, bytes: (await stat(source)).size, mediaHash: await digest(source), result }));
        await rename(temporary, join(entry, 'manifest.json'));
      } finally { await rm(temporary, { force: true }); }
    },
  };
}
