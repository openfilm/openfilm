/**
 * Run the app from this repository: `pnpm --filter @openfilm/desktop start`.
 *
 * It is the `dev` flavour (src/flavor.mjs): on macOS a renamed copy of Electron.app with its own name, bundle id and
 * data folder, so it never shares a Dock icon, a lock or a Studio with an installed OpenFilm. The window's page
 * (shell/) is built first (`--no-build` skips it). Electron gets a clean environment: run from inside Claude Code or Codex, this
 * process carries their variables, which the app's agents would inherit (src/environment.mjs). Arguments after the
 * script go to Electron as they are (e.g. --remote-debugging-port=9333).
 */
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launcherEnvironment, loginShellEnvironment } from '../src/environment.mjs';
import { FLAVORS } from '../src/flavor.mjs';

process.env.OPENFILM_DESKTOP_FLAVOR = 'dev';
const identity = FLAVORS.dev;
const require = createRequire(import.meta.url);
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((a) => a !== '--no-build');

if (!process.argv.includes('--no-build')) {
  const vite = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
  execFileSync(process.execPath, [vite, 'build', '--config', 'shell/vite.config.ts', '--logLevel', 'warn'], { cwd: desktop, stdio: 'inherit' });
}

const electron = require('electron');
let executable = electron;
if (process.platform === 'darwin') {
  const version = require('electron/package.json').version;
  const productVersion = require('../package.json').version;
  /* .dev/ is git-ignored */
  const runtime = join(desktop, '.dev', 'runtime', `${version}-openfilm-dev-v2-${productVersion}`);
  const bundle = join(runtime, `${identity.productName}.app`);
  const marker = join(runtime, 'ready');
  /* the executable keeps Electron's own name: Electron decides `app.isPackaged` from it. The name people see comes
     from CFBundleName and app.setName. */
  executable = join(bundle, 'Contents/MacOS/Electron');
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

const { PATH } = await loginShellEnvironment();
const child = spawn(executable, [desktop, ...args], { stdio: 'inherit', env: launcherEnvironment(process.env, PATH) });
/* Ctrl-C already reaches Electron (same foreground group); a SIGINT to this process alone is passed on later, once
   the app has had time to stop Studio on its own */
process.on('SIGINT', () => { setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); }, 12_000).unref(); });
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('error', (error) => { console.error(error); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
