/**
 * Run the app from this repository: `pnpm dev:desktop` at the top (or `pnpm --filter @openfilm/desktop start`). Run it
 * again to restart with the code as it is now.
 *
 * It is the `dev` flavour (src/flavor.mjs): on macOS a renamed copy of Electron.app with its own name, bundle id and
 * data folder, so it never shares a Dock icon, a lock or a Studio with an installed OpenFilm. There is one OpenFilm Dev
 * at a time (a second one only brings the first to the front), so one already running, from this checkout or another,
 * is asked to quit first. Then the window's page (shell/) and Studio's editor (packages/openfilm studio/ui) are built
 * (`--no-build` skips both). Electron gets a clean environment: run from inside Claude Code or Codex, this
 * process carries their variables, which the app's agents would inherit (src/environment.mjs). Arguments after the
 * script go to Electron as they are (e.g. --remote-debugging-port=9333).
 *
 * `--lane <name>` runs a lane of it instead (src/flavor.mjs devIdentity): "OpenFilm Dev <name>", its own app beside
 * OpenFilm Dev and the other lanes, so several checkouts (a branch each) can be tried at once. Running it again
 * restarts that lane only.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launcherEnvironment, loginShellEnvironment } from '../src/environment.mjs';
import { devIdentity, LANE } from '../src/flavor.mjs';

process.env.OPENFILM_DESKTOP_FLAVOR = 'dev';
let args = process.argv.slice(2).filter((a) => a !== '--no-build');
const at = args.indexOf('--lane');
if (at >= 0) {
  const lane = args[at + 1] ?? '';
  if (!LANE.test(lane)) {
    console.error('--lane takes a name: lowercase letters, digits and dashes, starting with a letter (e.g. --lane sound).');
    process.exit(2);
  }
  process.env.OPENFILM_DEV_LANE = lane;
  args = args.filter((_, i) => i !== at && i !== at + 1);
} else delete process.env.OPENFILM_DEV_LANE;
const identity = devIdentity(process.env.OPENFILM_DEV_LANE);
const require = createRequire(import.meta.url);
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The OpenFilm Dev apps running now (their main process), wherever they were started from. */
function running() {
  if (process.platform !== 'darwin') return [];
  const found = spawnSync('/usr/bin/pgrep', ['-f', `${identity.productName}.app/Contents/MacOS/Electron`], { encoding: 'utf8' });
  return found.stdout.split('\n').filter(Boolean).map(Number).filter((pid) => pid !== process.pid);
}
const alive = (/** @type {number} */ pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const before = running();
if (before.length) {
  console.log(`Quitting the ${identity.productName} that is running…`);
  /* the app quits on SIGTERM as from its menu, stopping its Studio first */
  for (const pid of before) { try { process.kill(pid, 'SIGTERM'); } catch { /* gone already */ } }
  const until = Date.now() + 30_000;
  while (before.some(alive) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  if (before.some(alive)) {
    console.error(`${identity.productName} did not quit within 30 seconds. Quit it yourself, then run this again.`);
    process.exit(1);
  }
}

if (!process.argv.includes('--no-build')) {
  const vite = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
  execFileSync(process.execPath, [vite, 'build', '--config', 'shell/vite.config.ts', '--logLevel', 'warn'], { cwd: desktop, stdio: 'inherit' });
  /* the editor Studio serves (studio/ui/dist), built from the source here, with its own vite */
  const studio = resolve(desktop, '../../packages/openfilm');
  const studioVite = join(dirname(createRequire(join(studio, 'package.json')).resolve('vite/package.json')), 'bin', 'vite.js');
  execFileSync(process.execPath, [studioVite, 'build', '--config', 'studio/ui/vite.config.ts', '--logLevel', 'warn'], { cwd: studio, stdio: 'inherit' });
}

const electron = require('electron');
/** OpenFilm Dev.app (macOS) */
let bundle = '';
if (process.platform === 'darwin') {
  const version = require('electron/package.json').version;
  const productVersion = require('../package.json').version;
  /* .dev/ is git-ignored */
  const runtime = join(desktop, '.dev', 'runtime', `${version}-openfilm-dev-v2-${productVersion}${process.env.OPENFILM_DEV_LANE ? `-${process.env.OPENFILM_DEV_LANE}` : ''}`);
  bundle = join(runtime, `${identity.productName}.app`);
  const marker = join(runtime, 'ready');
  /* the executable keeps Electron's own name: Electron decides `app.isPackaged` from it. The name people see comes
     from CFBundleName and app.setName. */
  if (!existsSync(marker)) {
    mkdirSync(runtime, { recursive: true });
    const source = resolve(electron, '../../..');
    if (!existsSync(bundle)) execFileSync('/bin/cp', ['-cR', source, bundle]);
    const plist = join(bundle, 'Contents/Info.plist');
    const set = (key, value) => execFileSync('/usr/bin/plutil', ['-replace', key, '-string', value, plist]);
    set('CFBundleName', identity.productName);
    set('CFBundleDisplayName', identity.productName);
    set('CFBundleShortVersionString', productVersion);
    set('CFBundleVersion', productVersion);
    set('CFBundleIdentifier', identity.bundleId);
    set('CFBundleIconFile', 'openfilm.icns');
    copyFileSync(join(desktop, 'build/icon-dev.icns'), join(bundle, 'Contents/Resources/openfilm.icns'));
    /* a local ad-hoc signature covers the changed bundle */
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'ignore' });
    execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', bundle]);
    writeFileSync(marker, version);
  }
}

/* a lane's port is taken from its name: two names may meet, so one in use by something else is said, not fought over */
if (process.env.OPENFILM_DEV_LANE) {
  const { createServer } = await import('node:net');
  const free = (/** @type {number} */ port) => new Promise((done) => {
    const server = createServer().once('error', () => done(false)).listen(port, '127.0.0.1', () => server.close(() => done(true)));
  });
  for (const port of [identity.studioPort, identity.studioPort + 1, identity.studioPort + 2]) {
    if (!(await free(port))) {
      console.error(`Port ${port}, which ${identity.productName}'s Studio uses, is taken by another program. Pick another lane name.`);
      process.exit(1);
    }
  }
}

const { PATH } = await loginShellEnvironment();
const env = launcherEnvironment(process.env, PATH);
if (process.platform === 'darwin') {
  /* opened by LaunchServices, not as a child of this process: macOS holds a child to what its parent (the terminal,
     Claude Code, Codex) may do, so where that one was refused the microphone, recording was refused too without the
     question ever being asked. Opened, OpenFilm Dev asks macOS for itself, as an installed OpenFilm does. Its output
     comes back through two pipes; `open -W` returns once it has quit. */
  const pipes = mkdtempSync(join(tmpdir(), 'openfilm-dev-'));
  const [out, err] = [join(pipes, 'out'), join(pipes, 'err')];
  execFileSync('/usr/bin/mkfifo', [out, err]);
  const streams = [createReadStream(out), createReadStream(err)];
  streams[0].pipe(process.stdout);
  streams[1].pipe(process.stderr);
  const vars = Object.entries(env).filter(([, value]) => value != null).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
  const child = spawn('/usr/bin/open', ['-n', '-W', '-a', bundle, ...vars, '--stdout', out, '--stderr', err, '--args', desktop, ...args], { stdio: 'ignore' });
  /* Ctrl-C no longer reaches the app on its own: it is asked to quit as from its menu, stopping its Studio first */
  const quit = () => { for (const pid of running()) { try { process.kill(pid, 'SIGTERM'); } catch { /* gone already */ } } };
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
  child.on('error', (error) => { console.error(error); process.exitCode = 1; });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
    /* a pipe the app never opened would keep this process waiting */
    for (const stream of streams) stream.destroy();
    rmSync(pipes, { recursive: true, force: true });
    setTimeout(() => process.exit(), 200).unref();
  });
} else {
  const child = spawn(electron, [desktop, ...args], { stdio: 'inherit', env });
  /* Ctrl-C already reaches Electron (same foreground group); a SIGINT to this process alone is passed on later, once
     the app has had time to stop Studio on its own */
  process.on('SIGINT', () => { setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); }, 12_000).unref(); });
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  child.on('error', (error) => { console.error(error); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
