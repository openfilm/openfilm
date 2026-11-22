/**
 * The Node the installer brings (scripts/release.mjs puts it in the app's resources, `runtime/node`): what the app's
 * own Node programs run on (src/node-runtime.mjs), so that Electron never has to run as Node and the release can turn
 * its RunAsNode fuse off. The same Node as the Electron the app is built on (Electron 45: Node 24.22.3), at its
 * latest release, from nodejs.org, each archive checked against the sha256 pinned here (from the release's
 * SHASUMS256.txt). Only the program and its license are kept.
 *
 * On a Mac the program comes signed by the Node.js Foundation: that signature is checked too (`nodeSignedByItsMakers`)
 * before the release signs it again as OpenFilm's, with only what Node needs (build/entitlements.node.plist).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { download, retried, unzipEntry } from '../src/ffmpeg-runtime.mjs';

export const NODE_VERSION = '24.22.3';
const DIST = `https://nodejs.org/dist/v${NODE_VERSION}`;
/** a download that brings nothing for this long has stalled */
const STALL_MS = 60_000;
/** the Node.js Foundation's team, whose Developer ID signs Node for macOS */
const NODE_TEAM = 'HX7739G8FX';

/** Each platform's archive, its sha256 and its program in it. */
const BUILDS = Object.freeze({
  'darwin-arm64': { file: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`, sha256: 'ff6e17d4874b76d272212b908cc020d6e815fba5a6c7eaaa06add725840307fd' },
  'darwin-x64': { file: `node-v${NODE_VERSION}-darwin-x64.tar.gz`, sha256: '977614af0504c81045e7fd85596dbca0e5f951b96681516dadafedcca8c447f7' },
  'win32-x64': { file: `node-v${NODE_VERSION}-win-x64.zip`, sha256: 'e612af99f626ab415ea225af6bce5c971feb448cb5cae250bb1c3fa50c5f7d9f' },
  'win32-arm64': { file: `node-v${NODE_VERSION}-win-arm64.zip`, sha256: 'b3cc74a295b39d4f273271e96f58c06dd2b35757ca12abec64c7d0598b434f14' },
});

/**
 * Put one platform's Node in `dir`: `node` (`node.exe` on Windows) and its LICENSE. Answers the program's path.
 * @param {string} dir @param {{ platform: string, arch: string, fetch?: typeof fetch }} options
 */
export async function fetchNode(dir, { platform, arch, fetch: fetchImpl = fetch }) {
  const build = BUILDS[`${platform}-${arch}`];
  if (!build) throw new Error(`There is no Node to bring for ${platform}-${arch}.`);
  /* a download that stalls is tried again (ffmpeg-runtime.mjs) */
  const archive = await retried(async () => {
    const bytes = await download(`${DIST}/${build.file}`, fetchImpl, STALL_MS);
    if (createHash('sha256').update(bytes).digest('hex') !== build.sha256) throw new Error(`${build.file} did not match its checksum; nothing was kept.`);
    return bytes;
  });
  const folder = build.file.replace(/\.(?:tar\.gz|zip)$/, '');
  const windows = platform === 'win32';
  const entry = windows
    ? (/** @type {string} */ name) => unzipEntry(archive, `${folder}/${name}`)
    : ((tar) => (/** @type {string} */ name) => untarEntry(tar, `${folder}/${name}`))(gunzipSync(archive));
  mkdirSync(dir, { recursive: true });
  const program = join(dir, windows ? 'node.exe' : 'node');
  writeFileSync(program, entry(windows ? 'node.exe' : 'bin/node'));
  chmodSync(program, 0o755);
  writeFileSync(join(dir, 'LICENSE'), entry('LICENSE'));
  return program;
}

/** Whether a Mac's Node is the one the Node.js Foundation signed (macOS's codesign checks it, whatever its chip). */
export function nodeSignedByItsMakers(program) {
  if (spawnSync('/usr/bin/codesign', ['--verify', '--strict', program]).status !== 0) return false;
  const shown = spawnSync('/usr/bin/codesign', ['--display', '--verbose=2', program], { encoding: 'utf8' });
  return `${shown.stdout}${shown.stderr}`.split('\n').includes(`TeamIdentifier=${NODE_TEAM}`);
}

/**
 * One file out of a tar in memory, by its name: ustar headers, 512-byte blocks; the long-name and pax records before
 * an entry are passed over (the names wanted here are short).
 * @param {Buffer} tar @param {string} name
 */
export function untarEntry(tar, name) {
  for (let at = 0; at + 512 <= tar.length;) {
    const header = tar.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const field = (/** @type {number} */ from, /** @type {number} */ length) => header.toString('utf8', from, from + length).replace(/\0.*$/s, '');
    const prefix = field(345, 155);
    const path = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1) || '0';
    if (path === name && type === '0') return Buffer.from(tar.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`The Node download has no ${name}.`);
}
