/** Windows' installed desktop apps, including user-selected folders outside Programs. */
import { execFile } from 'node:child_process';
import { dirname, isAbsolute, join, win32 } from 'node:path';

/** The uninstall keys' display names and folders; never run a command taken from the registry. */
export function parseWindowsApps(text, env = process.env) {
  const apps = [];
  let item = {};
  const expand = (value) => value.replace(/%([^%]+)%/g, (whole, name) => Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? whole);
  const keep = () => {
    if (!item.DisplayName) return;
    const dirs = [];
    const location = expand(item.InstallLocation ?? '').trim().replace(/^"(.*)"$/, '$1');
    if (isAbsolute(location) || win32.isAbsolute(location)) dirs.push(location);
    const icon = expand(item.DisplayIcon ?? '').trim();
    const iconFile = /^"([^"]+\.(?:exe|ico))"(?:\s*,\s*-?\d+)?$/i.exec(icon)?.[1] ?? /^(.*\.(?:exe|ico))(?:\s*,\s*-?\d+)?$/i.exec(icon)?.[1];
    if (iconFile && (isAbsolute(iconFile) || win32.isAbsolute(iconFile))) dirs.push(win32.isAbsolute(iconFile) ? win32.dirname(iconFile) : dirname(iconFile));
    if (dirs.length) apps.push({ name: item.DisplayName, directories: [...new Set(dirs)] });
  };
  for (const line of text.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line.trim())) { keep(); item = {}; continue; }
    const match = /^\s+(DisplayName|InstallLocation|DisplayIcon)\s+REG_(?:EXPAND_)?SZ\s+(.*)$/.exec(line);
    if (match) item[match[1]] = match[2].trim();
  }
  keep();
  return apps;
}

const UNINSTALL_KEYS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

/** One uninstall key with its subkeys (`reg query /s`), or null when it is missing, unreadable or too slow. */
function queryKey(key) {
  const system = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  return new Promise((resolve) => {
    // Chinese Windows uses GBK by default; read paths in UTF-8, as environment.mjs does.
    execFile(join(system, 'cmd.exe'), ['/d', '/s', '/c', `chcp 65001 >nul && "${join(system, 'reg.exe')}" query "${key}" /s`], {
      encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, windowsVerbatimArguments: true,
    }, (error, stdout) => resolve(error ? null : stdout));
  });
}

/**
 * The registrations, read in the background. Reading all three keys takes a second or more on a computer with many
 * apps, and the agents' status is looked at on the main process each time Settings or the chat's menu opens: read
 * synchronously there, it held every window (Windows called them "Not Responding"). `installed()` answers at once
 * with what was read last, and has them read again when that is older than `maxAgeMs`; `refresh()` is for a caller
 * that waits for them (the first look, a diagnosis). One reading at a time.
 */
export function windowsAppsReader({ query = queryKey, platform = process.platform, env = process.env, now = Date.now, maxAgeMs = 10_000 } = {}) {
  let read = { at: -Infinity, apps: [] };
  let reading = null;
  const refresh = ({ maxAge = maxAgeMs } = {}) => {
    if (platform !== 'win32') return Promise.resolve([]);
    if (now() - read.at < maxAge) return Promise.resolve(read.apps);
    reading ??= Promise.all(UNINSTALL_KEYS.map((key) => new Promise((done) => done(query(key))).catch(() => null)))
      .then((texts) => {
        read = { at: now(), apps: texts.flatMap((text) => (typeof text === 'string' ? parseWindowsApps(text, env) : [])) };
        return read.apps;
      })
      .finally(() => { reading = null; });
    return reading;
  };
  const installed = () => {
    if (platform !== 'win32') return [];
    void refresh();
    return read.apps;
  };
  /* the first reading, waited for however long it takes; at once after that, however old the last one is */
  const first = () => refresh({ maxAge: Infinity });
  /* off Windows there is nothing to read */
  const wasRead = () => platform !== 'win32' || read.at > -Infinity;
  return { installed, refresh, first, wasRead };
}

const reader = windowsAppsReader();
/** What was read last, at once; registration alone does not prove the folder still exists. */
export const installedWindowsApps = () => reader.installed();
/** Read again unless read within `maxAge` ms, and wait for it. */
export const refreshWindowsApps = (options) => reader.refresh(options);
/** The first reading, waited for; started at launch (main.mjs), it is often in before anything asks. */
export const firstWindowsApps = () => reader.first();

/**
 * `find()`, and once more when the first reading comes in if it found nothing before it. Until then a program known
 * only from its registration (DeepSeek Harness on D:\) is not found: a conversation reopened right after launch would
 * say it is not installed.
 * @template T @param {() => T} find @param {{ reader?: ReturnType<typeof windowsAppsReader> }} [o] @returns {Promise<T>}
 */
export async function afterFirstReading(find, { reader: apps = reader } = {}) {
  const found = find();
  if (found || apps.wasRead()) return found;
  await apps.first();
  return find();
}
