/**
 * ffmpeg and ffprobe: Studio and `openfilm` need them for video pictures, sound and every export. The installer brings
 * its own (scripts/release.mjs puts them in the app's resources, `runtime/ffmpeg`, with their license), so the app
 * works without a download. A build without them (from source) downloads them once into its data folder when the
 * computer has none on its PATH. Static builds (GPL-3.0, as published), each checked against the sha256 pinned here:
 * on a Mac the Shaka project's (both programs as they are), on Windows gyan.dev's essentials build (a zip, the two
 * programs taken out of it; it has NVIDIA's, Intel's and AMD's encoders, which the Shaka build for Windows lacks).
 * FFmpeg 6 wrote ProRes 4444 whose alpha Apple's decoder reads as opaque (editors showed rendered pages black); 8.1
 * and later write it right. The folder is on the PATH Studio and the agents get from the start, so they find the
 * programs the moment they land, without a restart.
 *
 * Reads no Electron module, so `node --test` can use it.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const SHAKA = 'https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n8.1.2-1';
const GYAN = 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2';
/** FFmpeg's own license text, for a build that publishes none beside it. */
const GPL3 = (version) => `https://raw.githubusercontent.com/FFmpeg/FFmpeg/n${version}/COPYING.GPLv3`;

/**
 * The pinned builds: the FFmpeg version each is (as `ffmpeg -version` says), whose source goes beside it for its GPL,
 * and where each program comes from with its sha256: a file of its own, or (`zip`) an entry of one archive.
 */
const BUILDS = Object.freeze({
  'darwin-arm64': {
    version: '8.1.2',
    by: `the Shaka project's static build n8.1.2-1 (${SHAKA}), made by its scripts at https://github.com/shaka-project/static-ffmpeg-binaries`,
    ffmpeg: { url: `${SHAKA}/ffmpeg-osx-arm64`, sha256: 'e7b9fcd97f95f333512d6e8b8ac24d9dbc08f189f36047695499bd7b57214b22' },
    ffprobe: { url: `${SHAKA}/ffprobe-osx-arm64`, sha256: 'ded4c698b8ff38d0bc1fd30fcc5e768dc46f58bc15a8dfd61f98615ba49cde5c' },
  },
  'darwin-x64': {
    version: '8.1.2',
    by: `the Shaka project's static build n8.1.2-1 (${SHAKA}), made by its scripts at https://github.com/shaka-project/static-ffmpeg-binaries`,
    ffmpeg: { url: `${SHAKA}/ffmpeg-osx-x64`, sha256: '62c87854d851f202fc4a29bdda0fe7b6ebcddd37b863482ce1bdc81151b03fe4' },
    ffprobe: { url: `${SHAKA}/ffprobe-osx-x64`, sha256: 'd530823f480a3c7eb6334f18a00197d1e9f1070e86172b9aa89c4bf4022bd879' },
  },
  'win32-x64': {
    version: '9.0.2',
    by: `gyan.dev's essentials build 9.0.2 (${GYAN})`,
    zip: { url: `${GYAN}/ffmpeg-9.0.2-essentials_build.zip`, sha256: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba', folder: 'ffmpeg-9.0.2-essentials_build' },
  },
});

/** A download that brings nothing for this long has stalled: it is stopped and tried again. */
const STALL_MS = 30_000;
const TRIES = 3;

const exe = (name, platform = process.platform) => (platform === 'win32' ? `${name}.exe` : name);

/** The folder the downloaded programs go in (on the PATH of Studio and the agents, whether they are there yet or not). */
export const ffmpegDir = (dataDir, platform = process.platform, arch = process.arch) => join(dataDir, 'runtime', `ffmpeg-${BUILDS[`${platform}-${arch}`]?.version ?? 'none'}`);

/** Whether a folder holds both programs (the installer's, or a download that finished). */
export const ffmpegIn = (dir, platform = process.platform) => ['ffmpeg', 'ffprobe'].every((n) => existsSync(join(dir, exe(n, platform))));

/** Whether both programs run from this PATH. */
export function ffmpegOnPath(path) {
  return ['ffmpeg', 'ffprobe'].every((bin) => {
    const r = spawnSync(bin, ['-version'], { stdio: 'ignore', env: { ...process.env, PATH: path }, windowsHide: true });
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
  if (ffmpegIn(dir)) return Promise.resolve(dir);
  downloading ??= fetchFfmpeg(dir, { onProgress, fetch: fetchImpl }).finally(() => { downloading = null; });
  return downloading;
}

/**
 * Download one platform's build into `dir`: both programs, and with `license`, its license, its readme when it has
 * one, and where its source is (what the installer ships beside them). A download that stalls is tried again.
 * @param {string} dir
 * @param {{ platform?: string, arch?: string, license?: boolean, onProgress?: (fraction: number) => void, fetch?: typeof fetch, stallMs?: number }} [options]
 */
export async function fetchFfmpeg(dir, { platform = process.platform, arch = process.arch, license = false, onProgress = () => {}, fetch: fetchImpl = fetch, stallMs = STALL_MS } = {}) {
  const key = `${platform}-${arch}`;
  const build = BUILDS[key];
  if (!build) throw new Error(`There is no ffmpeg to download for ${key}: install it from ffmpeg.org.`);
  mkdirSync(dir, { recursive: true });
  const names = /** @type {const} */ (['ffmpeg', 'ffprobe']);
  const missing = names.filter((name) => !existsSync(join(dir, exe(name, platform))));
  /** each download's bytes so far and in all, for one fraction across them */
  const parts = new Map();
  const tell = () => {
    const all = [...parts.values()].reduce((n, p) => n + p.total, 0);
    if (all) onProgress(Math.min(0.99, [...parts.values()].reduce((n, p) => n + p.got, 0) / all));
  };
  const pinned = (/** @type {{ url: string, sha256: string }} */ from, /** @type {string} */ what) => retried(async () => {
    const part = { got: 0, total: 0 };
    parts.set(from.url, part);
    const bytes = await download(from.url, fetchImpl, stallMs, (size) => { part.total = size; }, (n) => { part.got += n; tell(); });
    if (createHash('sha256').update(bytes).digest('hex') !== from.sha256) throw new Error(`The ${what} download did not match its checksum; nothing was kept.`);
    return bytes;
  });
  const place = (/** @type {string} */ name, /** @type {Buffer} */ bytes) => {
    const target = join(dir, exe(name, platform));
    writeFileSync(`${target}.part`, bytes);
    chmodSync(`${target}.part`, 0o755);
    renameSync(`${target}.part`, target);
  };
  /** the archive's entries, when the build is one */
  let zip = null;
  if ('zip' in build) {
    if (missing.length || license) {
      zip = await pinned(build.zip, 'ffmpeg');
      for (const name of missing) place(name, unzipEntry(zip, `${build.zip.folder}/bin/${exe(name, platform)}`));
    }
  } else {
    await Promise.all(missing.map(async (name) => place(name, await pinned(build[name], name))));
  }
  if (license) {
    if (zip) {
      writeFileSync(join(dir, 'LICENSE'), unzipEntry(zip, `${build.zip.folder}/LICENSE`));
      writeFileSync(join(dir, 'README'), unzipEntry(zip, `${build.zip.folder}/README.txt`));
    } else {
      writeFileSync(join(dir, 'LICENSE'), await retried(() => download(GPL3(build.version), fetchImpl, stallMs)));
    }
    writeFileSync(join(dir, 'SOURCE'), `FFmpeg ${build.version}, ${build.by}.\n`
      + `Its source: https://ffmpeg.org/releases/ffmpeg-${build.version}.tar.xz\n`);
  }
  onProgress(1);
  return dir;
}

/**
 * One file out of a zip in memory, by its name: found in the central directory, stored or deflated. A zip of
 * programs under 4 GB, so no Zip64.
 * @param {Buffer} zip @param {string} name
 */
export function unzipEntry(zip, name) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('The ffmpeg download is not a zip.');
  let at = zip.readUInt32LE(end + 16);
  for (let i = zip.readUInt16LE(end + 10); i > 0; i--) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const skip = nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    if (zip.toString('utf8', at + 46, at + 46 + nameLength) === name) {
      const local = zip.readUInt32LE(at + 42);
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`${name} is compressed in a way this can't read (method ${method}).`);
    }
    at += 46 + skip;
  }
  throw new Error(`The ffmpeg download has no ${name}.`);
}

/** One file's bytes; one that stops coming for `stallMs` is an error. */
export async function download(url, fetchImpl, stallMs, onSize = () => {}, onBytes = () => {}) {
  const stop = new AbortController();
  let timer = setTimeout(() => stop.abort(), stallMs);
  const alive = () => { clearTimeout(timer); timer = setTimeout(() => stop.abort(), stallMs); };
  try {
    const res = await fetchImpl(url, { signal: stop.signal });
    if (!res.ok || !res.body) throw new Error(`Downloading ${url.split('/').pop()} failed (${res.status}).`);
    onSize(Number(res.headers.get('content-length')) || 0);
    const chunks = [];
    for await (const chunk of res.body) {
      alive();
      chunks.push(chunk);
      onBytes(chunk.length);
    }
    return Buffer.concat(chunks);
  } catch (e) {
    if (stop.signal.aborted) throw new Error(`Downloading ${url.split('/').pop()} stalled.`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** An attempt, made again when it fails, TRIES times in all. */
export async function retried(attempt) {
  for (let i = 1; ; i++) {
    try { return await attempt(); } catch (e) { if (i >= TRIES) throw e; }
  }
}
