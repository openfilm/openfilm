/**
 * An update that is ready, as the app's next launch sees it (macOS). Quitting installs it: Squirrel.Mac's ShipIt waits
 * for the app to close, then swaps the app's files, which takes several seconds for an app this size. An app opened
 * in those seconds stops the install (ShipIt gives up while the app runs), so a launch:
 *
 *   · while ShipIt installs: steps aside. It exits at once, and a small script opens the app again when ShipIt is done,
 *     as the new version (stepAside).
 *   · after an install that did not happen: installs it now, in a small window that says so, and opens as the new
 *     version (updates.mjs `installAtLaunch`, readyToInstall).
 *
 * Which update is waiting is `update-pending.json` in the app's data folder, written when one is ready and removed
 * once the app runs that version or newer. Reads no Electron module, so `node --test` can use it.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { INSTALL_WORDS as WORDS } from './i18n/install-window.mjs';
import { isNewer } from './update-controller.mjs';

const PENDING = 'update-pending.json';
/** what the script that opens the app again passes, so that launch never steps aside a second time */
export const AFTER_INSTALL = '--after-install';
/** how long the script waits for ShipIt before it opens the app anyway */
export const HAND_OFF_SECONDS = 60;
/** how long a launch that installs waits for the update to be ready again, before it opens as it is */
export const LAUNCH_INSTALL_MS = 45_000;

/** Remember the update that is ready, for the next launch. */
export function writePendingUpdate(dir, version) {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, PENDING), `${JSON.stringify({ version })}\n`);
  } catch { /* the next launch opens as it is */ }
}

export function clearPendingUpdate(dir) {
  rmSync(join(dir, PENDING), { force: true });
}

/** The version waiting to be installed, if it is newer than this one; an older note is removed. */
export function pendingUpdate(dir, current) {
  let version = null;
  try { version = JSON.parse(readFileSync(join(dir, PENDING), 'utf8')).version; } catch { return null; }
  if (isNewer(version, current)) return version;
  try { clearPendingUpdate(dir); } catch { /* read again next time */ }
  return null;
}

/** ShipIt's process for this app, while it runs (launchd's job `<bundle id>.ShipIt`), or null. */
export function installerPid(bundleId, run = (file, args) => execFileSync(file, args, { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] })) {
  try {
    const pid = Number(/"PID" = (\d+);/.exec(run('/bin/launchctl', ['list', `${bundleId}.ShipIt`]))?.[1]);
    return pid > 0 ? pid : null;
  } catch { return null; }
}

/** The .app the running executable is in (…/OpenFilm.app/Contents/MacOS/OpenFilm). */
export const appBundle = (execPath) => resolve(dirname(execPath), '..', '..');

/* waits for ShipIt ($1) to finish, at most HAND_OFF_SECONDS, then opens the app ($2) */
export const HAND_OFF_SCRIPT = [
  'i=0',
  `while ps -p "$1" >/dev/null 2>&1 && [ "$i" -lt ${HAND_OFF_SECONDS * 2} ]; do sleep 0.5; i=$((i+1)); done`,
  `exec open "$2" --args ${AFTER_INSTALL}`,
].join('\n');

/**
 * Step aside for an install under way: true when this launch should exit now (the script it started opens the app
 * once ShipIt is done). Only a launch with an update waiting, while ShipIt runs, and not the one the script opened.
 */
export function stepAside({ dir, version, bundleId, execPath, argv, pidOf = installerPid, start = spawn }) {
  if (argv.includes(AFTER_INSTALL) || !pendingUpdate(dir, version)) return false;
  const pid = pidOf(bundleId);
  if (!pid) return false;
  try {
    start('/bin/sh', ['-c', HAND_OFF_SCRIPT, 'openfilm-update', String(pid), appBundle(execPath)], { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch { return false; }
}

/**
 * Get the waiting update ready again (a check finds it downloaded; Squirrel takes it), for a launch that installs it:
 * true once it is ready, false when the check finds nothing newer, fails, or takes longer than `ms`.
 * @param {{ controller: { check: () => Promise<any>, snapshot: () => { status: string } },
 *           subscribe: (listener: (state: { status: string }) => void) => () => void, ms?: number }} options
 */
export function readyToInstall({ controller, subscribe, ms = LAUNCH_INSTALL_MS }) {
  return new Promise((done) => {
    let stop = () => {};
    const timer = setTimeout(() => finish(false), ms);
    function finish(ready) {
      clearTimeout(timer);
      stop();
      done(ready);
    }
    const look = ({ status }) => {
      if (status === 'ready') finish(true);
      else if (status === 'current' || status === 'error') finish(false);
    };
    stop = subscribe(look);
    look(controller.snapshot());
    void controller.check().then(look, () => finish(false));
  });
}


/**
 * The install window's language: the one Studio was last shown in, else the system's as Studio picks it (its i18n
 * `languageFor`): `zh-Hans-CN` and `zh` are Simplified Chinese, `es-MX` is Spanish.
 */
export function installLanguage(saved, system = []) {
  if (saved && saved in WORDS) return saved;
  for (const tag of system) {
    const lower = String(tag).toLowerCase();
    if (lower.startsWith('zh')) {
      if (/^zh-(hant|tw|hk|mo)\b/.test(lower)) continue;
      return 'zh-CN';
    }
    const base = lower.split('-')[0];
    if (base in WORDS) return base;
  }
  return 'en';
}

export function installWords(language, { name, version }) {
  const fill = (text) => text.replaceAll('{name}', name).replaceAll('{version}', version);
  const words = WORDS[language] ?? WORDS.en;
  return { lang: language in WORDS ? language : 'en', title: fill(words.title), detail: fill(words.detail) };
}
