/**
 * The app as the benchmark runs it: the `bench` flavour (src/flavor.mjs), everything in a throwaway folder, the
 * window's page built first, Electron with a DevTools port to drive and read both pages.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launcherEnvironment, loginShellEnvironment } from '../src/environment.mjs';

const require = createRequire(import.meta.url);
export const DESKTOP = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The window the runs share: the same size every time. */
export const WINDOW = { width: 1600, height: 1000, chatWidth: 420 };

/** The window's page (shell/), as the app serves it. */
export function buildShell() {
  const vite = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
  execFileSync(process.execPath, [vite, 'build', '--config', 'shell/vite.config.ts', '--logLevel', 'warn'], { cwd: DESKTOP, stdio: 'inherit' });
}

/**
 * The sample film's footage, made once with ffmpeg and kept in .dev/ (git-ignored): two clips as heavy to decode as
 * camera footage (1280×720, 60 fps, ~16 Mb/s, moving noise over a test pattern) and a strip of trip.mp4's frames.
 */
function footage() {
  const dir = join(DESKTOP, '.dev', 'bench-media');
  if (existsSync(join(dir, 'ready'))) return dir;
  mkdirSync(dir, { recursive: true });
  const ffmpeg = (...args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args]);
  const clip = (name, seconds, source) => ffmpeg('-f', 'lavfi', '-i', `${source}=size=1280x720:rate=60`, '-t', String(seconds), '-vf', 'noise=alls=24:allf=t',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-b:v', '16M', '-maxrate', '18M', '-bufsize', '32M', join(dir, name));
  clip('trip.mp4', 14.5, 'testsrc2');
  clip('broll.mp4', 6, 'mandelbrot');
  ffmpeg('-i', join(dir, 'trip.mp4'), '-vf', 'fps=2,scale=96:54,tile=29x1', '-frames:v', '1', join(dir, 'strip.jpg'));
  writeFileSync(join(dir, 'ready'), '');
  return dir;
}

/** The sample film, with its media, in `dir`. */
export function makeProject(dir) {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  cpSync(join(DESKTOP, 'bench/fixture'), dir, { recursive: true });
  const media = footage();
  for (const name of ['trip.mp4', 'broll.mp4', 'strip.jpg']) cpSync(join(media, name), join(dir, 'assets', name));
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=30', '-f', 'lavfi', '-i', 'anoisesrc=d=30:a=0.03',
    '-filter_complex', '[0][1]amix=inputs=2:duration=first', '-c:a', 'aac', '-b:a', '96k', join(dir, 'assets/bed.m4a')]);
}

/** A fresh folder for one launch: the app's data (with the window's size), its Studio home and its projects. */
export function prepare(dir) {
  for (const sub of ['data', 'home', 'projects']) mkdirSync(join(dir, sub), { recursive: true });
  writeFileSync(join(dir, 'data/window.json'), JSON.stringify({ bounds: { x: 60, y: 40, width: WINDOW.width, height: WINDOW.height }, chatWidth: WINDOW.chatWidth, chatOpen: true }));
}

/**
 * Start the app. Resolves once the process is up; `cdp` is the DevTools address.
 * @param {{ dir: string, cdpPort: number, log?: (line: string) => void }} o
 */
export async function launch({ dir, cdpPort, log = () => {} }) {
  const electron = require('electron');
  const { PATH } = await loginShellEnvironment();
  const env = { ...launcherEnvironment(process.env, PATH), OPENFILM_DESKTOP_FLAVOR: 'bench', OPENFILM_BENCH_DIR: dir };
  const child = spawn(electron, [DESKTOP, `--remote-debugging-port=${cdpPort}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => log(String(d)));
  child.stderr.on('data', (d) => log(String(d)));
  return { child, cdp: `http://127.0.0.1:${cdpPort}` };
}

/** Wait until DevTools answers. */
export async function waitForCdp(cdp, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(`${cdp}/json/version`)).ok) return; } catch { /* not yet */ }
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error('the app did not open its DevTools port');
}

/** Stop the app as a person would (it stops its Studio first), then for sure. */
export async function quit(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  const gone = new Promise((done) => child.once('exit', done));
  const late = new Promise((done) => setTimeout(done, 15_000));
  await Promise.race([gone, late]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
