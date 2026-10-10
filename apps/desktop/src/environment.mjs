/**
 * The environments of the processes the app starts (Studio, the agents' adapters): what the person's own login shell
 * would give them, never what whoever launched the app had.
 *
 * Run from a terminal inside Claude Code or Codex, the app's own environment carries CLAUDECODE, CLAUDE_CODE_*,
 * ANTHROPIC_BASE_URL and the like, which an agent started here would wrongly inherit. Opened from the Dock, it has
 * only PATH=/usr/bin:/bin:/usr/sbin:/sbin, where neither Homebrew's ffmpeg nor the person's `claude` can be found.
 * Both get the same answer: the OS identity variables, plus the PATH (and proxies, and where the agents keep their
 * sign-in) of the person's login shell. On Windows there is no login shell: a program started from the Start menu
 * has the person's own PATH already, so that is kept (with the Windows system variables a program needs). Reads no
 * Electron module, so `node --test` can use it.
 */
import { spawn } from 'node:child_process';
import { homedir, userInfo } from 'node:os';
import { isAbsolute, join } from 'node:path';

const OS_KEYS = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'TZ'];
/** what a Windows program needs to find its system, its profile and its temporary folder */
const WIN_KEYS = ['SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'USERNAME', 'USERDOMAIN',
  'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432',
  'CommonProgramFiles', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS'];
const windows = process.platform === 'win32';
const isLocaleKey = (key) => /^LC_[A-Z_]+$/.test(key);
const BASE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const PROXY_KEYS = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy'];
/** where each agent keeps its sign-in; only meaningful when the person set it in their shell */
const AGENT_HOME_KEYS = ['CLAUDE_CONFIG_DIR', 'CODEX_HOME'];
const ENV_MARKER = '__OPENFILM_LOGIN_ENV__';

function accountShell() {
  try { return userInfo().shell || null; } catch { return null; }
}

/** Directories searched even when the login shell gives nothing usable. */
export function fallbackPathDirs(home = homedir()) {
  return [join(home, '.local', 'bin'), '/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
}

/** The login shell's PATH first, then the fallback directories it lacks; relative and repeated entries dropped. */
export function mergePath(primary, home = homedir()) {
  if (windows) {
    const dirs = [...String(primary ?? '').split(';'), join(home, '.local', 'bin'), ...(process.env.APPDATA ? [join(process.env.APPDATA, 'npm')] : [])].filter((d) => d && isAbsolute(d));
    return [...new Map(dirs.map((d) => [d.toLowerCase(), d])).values()].join(';');
  }
  const dirs = [...String(primary ?? '').split(':'), ...fallbackPathDirs(home)].filter((d) => d && isAbsolute(d));
  return [...new Set(dirs)].join(':');
}

/** The separator of PATH here. */
export const PATH_SEP = windows ? ';' : ':';

/** PATH from an environment, whatever its case (Windows calls it Path). */
export const pathOf = (env) => env.PATH ?? env.Path ?? Object.entries(env).find(([k]) => k.toLowerCase() === 'path')?.[1] ?? '';

/** The OS identity variables only (HOME, USER, LOGNAME, SHELL, TMPDIR, LANG, LC_*, TZ). */
export function osEnvironment(source = process.env, { home = homedir(), shell = accountShell() } = {}) {
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && value && (OS_KEYS.includes(key) || isLocaleKey(key) || (windows && WIN_KEYS.some((k) => k.toLowerCase() === key.toLowerCase())))) env[key] = value;
  }
  if (windows) return env;
  env.HOME ??= home;
  /* opened from the Dock there is no SHELL; the account still knows the person's login shell */
  if (!env.SHELL && shell) env.SHELL = shell;
  return env;
}

/** `printf MARKER; env -0` output, read; whatever the rc files printed before the marker is ignored. */
export function parseEnvDump(text) {
  const at = String(text ?? '').indexOf(`${ENV_MARKER}\n`);
  if (at === -1) return {};
  const env = {};
  for (const entry of text.slice(at + ENV_MARKER.length + 1).split('\0')) {
    const eq = entry.indexOf('=');
    if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return env;
}

/** The part of a login shell's environment handed on: PATH (always), proxies, the agents' config folders, locale. */
export function shellSubset(dump, home = homedir()) {
  const env = {};
  for (const [key, value] of Object.entries(dump ?? {})) {
    if (typeof value !== 'string' || !value) continue;
    if (PROXY_KEYS.includes(key) || AGENT_HOME_KEYS.includes(key) || key === 'LANG' || isLocaleKey(key)) env[key] = value;
  }
  env.PATH = mergePath(dump?.PATH, home);
  return env;
}

/** Run the login shell once, with a clean environment; null when it fails or takes too long. */
function captureLoginShell(shell, env, timeoutMs) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (value) => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
    let child;
    try {
      child = spawn(shell, ['-l', '-i', '-c', `printf '\\n${ENV_MARKER}\\n'; /usr/bin/env -0`], { env, stdio: ['ignore', 'pipe', 'ignore'], detached: true });
    } catch { resolve(null); return; }
    /* interactive shells ignore SIGTERM; the whole group goes, so jobs the rc files started go too */
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
      finish(null);
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.once('error', () => finish(null));
    child.once('close', () => finish(out));
    /* a background job an rc file started can hold stdout open: do not wait for it */
    child.once('exit', () => setTimeout(() => { child.stdout.destroy(); finish(out); }, 300).unref());
  });
}

let loginShellCache = null;
/** The login shell's subset (`shellSubset`), asked once per process. Never rejects: on failure, the fallback PATH. */
export function loginShellEnvironment({ source = process.env, timeoutMs = 5000 } = {}) {
  /* Windows has no login shell: a program started from the Start menu already has the person's PATH */
  if (windows) return Promise.resolve({ PATH: mergePath(pathOf(source), homedir()) });
  loginShellCache ??= (async () => {
    const base = osEnvironment(source);
    const dump = base.SHELL ? await captureLoginShell(base.SHELL, { ...base, PATH: BASE_PATH }, timeoutMs) : null;
    return shellSubset(parseEnvDump(dump), base.HOME);
  })().catch(() => ({ PATH: mergePath('', homedir()) }));
  return loginShellCache;
}

/** What scripts/start.mjs passes on to Electron besides the OS identity: this app's own switches. */
export const LAUNCHER_FLAGS = ['OPENFILM_DESKTOP_FLAVOR', 'OPENFILM_DESKTOP_CAPTURE', 'ELECTRON_ENABLE_LOGGING', 'ELECTRON_ENABLE_STACK_DUMPING'];

/** Electron's environment when run from source: the OS identity, the login shell's PATH, LAUNCHER_FLAGS. */
export function launcherEnvironment(source, path) {
  const env = osEnvironment(source);
  for (const key of LAUNCHER_FLAGS) if (typeof source[key] === 'string') env[key] = source[key];
  env.PATH = path || mergePath('', env.HOME ?? env.USERPROFILE);
  return env;
}

/**
 * A child's whole environment: the OS identity, the login shell's subset, and what the app sets on purpose (`extra`).
 * The locale of the app's own process wins over the shell's; PATH always comes from the shell.
 */
export function childEnvironment({ source = process.env, shell = {}, extra = {}, home, userShell } = {}) {
  const env = osEnvironment(source, { ...(home ? { home } : {}), ...(userShell !== undefined ? { shell: userShell } : {}) });
  for (const [key, value] of Object.entries(shell)) {
    if (key === 'LANG' || isLocaleKey(key)) env[key] ??= value;
    else env[key] = value;
  }
  env.PATH = shell.PATH || mergePath('', env.HOME ?? env.USERPROFILE);
  return { ...env, ...extra };
}
