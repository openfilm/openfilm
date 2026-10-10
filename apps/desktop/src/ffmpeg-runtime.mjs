/**
 * ffmpeg and ffprobe for a computer that has none: Studio and `openfilm` need them for video pictures, sound and every
 * export. When they are not on the PATH, the app downloads them once into its data folder, from the ffmpeg-static
 * project's release (static builds, GPL-3.0, as published there: the app does not ship them), each checked against
 * the sha256 pinned here. The folder is on the PATH Studio and the agents get from the start, so they find the
 * programs the moment they land, without a restart.
 *
 * Reads no Electron module, so `node --test` can use it.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const RELEASE = 'b6.1.1';
const BASE = `https://github.com/eugeneware/ffmpeg-static/releases/download/${RELEASE}`;

/** The pinned builds: `<program>-<platform>-<arch>.gz` and its sha256 (as the release publishes it). */
const BUILDS = Object.freeze({
  'darwin-arm64': {
    ffmpeg: '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa',
    ffprobe: 'd986a8ec7b030899fe66a8a288ed809a3543338705a3ce178cfb85869c5d80be',
  },
  'darwin-x64': {
    ffmpeg: '929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106',
    ffprobe: 'd4da574d6e2e197bd259b47d69cf262df9e312af24ad960444f6d806d3d4c186',
  },
  'win32-x64': {
    ffmpeg: '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77',
    ffprobe: 'f309e6223ad89d2fe54bccd420a7709b66fd27540674e92309578ed491a43c8d',
  },
});

const exe = (name, platform = process.platform) => (platform === 'win32' ? `${name}.exe` : name);

/** The folder the downloaded programs go in (on the PATH of Studio and the agents, whether they are there yet or not). */
export const ffmpegDir = (dataDir) => join(dataDir, 'runtime', `ffmpeg-${RELEASE}`);

/** Whether both programs run from this PATH. */
export function ffmpegOnPath(path) {
  return ['ffmpeg', 'ffprobe'].every((bin) => {
    const r = spawnSync(bin, ['-version'], { stdio: 'ignore', env: { ...process.env, PATH: path } });
    return !r.error && r.status === 0;
  });
}

/** Whether this machine has a build to download. */
export const ffmpegDownloadable = (platform = process.platform, arch = process.arch) => Object.hasOwn(BUILDS, `${platform}-${arch}`);

let downloading = null;

/**
 * Download both programs into `ffmpegDir(dataDir)` (once; a download in progress is shared). `onProgress(0..1)`.
 * @param {string} dataDir @param {{ onProgress?: (fraction: number) => void, fetch?: typeof fetch }} [options]
 */
export function ensureFfmpeg(dataDir, { onProgress = () => {}, fetch: fetchImpl = fetch } = {}) {
  const dir = ffmpegDir(dataDir);
  if (['ffmpeg', 'ffprobe'].every((n) => existsSync(join(dir, exe(n))))) return Promise.resolve(dir);
  downloading ??= download(dir, onProgress, fetchImpl).finally(() => { downloading = null; });
  return downloading;
}

async function download(dir, onProgress, fetchImpl) {
  const key = `${process.platform}-${process.arch}`;
  const build = BUILDS[key];
  if (!build) throw new Error(`There is no ffmpeg to download for ${key}: install it from ffmpeg.org.`);
  mkdirSync(dir, { recursive: true });
  const names = /** @type {const} */ (['ffmpeg', 'ffprobe']);
  const got = { ffmpeg: 0, ffprobe: 0 };
  const total = { ffmpeg: 0, ffprobe: 0 };
  const tell = () => {
    const all = total.ffmpeg + total.ffprobe;
    if (all) onProgress(Math.min(0.99, (got.ffmpeg + got.ffprobe) / all));
  };
  await Promise.all(names.map(async (name) => {
    const target = join(dir, exe(name));
    if (existsSync(target)) return;
    const res = await fetchImpl(`${BASE}/${name}-${key}.gz`);
    if (!res.ok || !res.body) throw new Error(`Downloading ${name} failed (${res.status}).`);
    total[name] = Number(res.headers.get('content-length')) || 0;
    const chunks = [];
    for await (const chunk of res.body) {
      chunks.push(chunk);
      got[name] += chunk.length;
      tell();
    }
    const gz = Buffer.concat(chunks);
    if (createHash('sha256').update(gz).digest('hex') !== build[name]) throw new Error(`The ${name} download did not match its checksum; nothing was kept.`);
    const part = `${target}.part`;
    writeFileSync(part, gunzipSync(gz));
    chmodSync(part, 0o755);
    renameSync(part, target);
  }));
  onProgress(1);
  return dir;
}
