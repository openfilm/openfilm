/**
 * The environments of the processes the app starts (Studio, the agents' adapters): what the person's own login shell
 * would give them, never what whoever launched the app had.
 *
 * Run from a terminal inside Claude Code or Codex, the app's own environment carries CLAUDECODE, CLAUDE_CODE_*,
 * ANTHROPIC_BASE_URL and the like, which an agent started here would wrongly inherit. Opened from the Dock, it has
 * only PATH=/usr/bin:/bin:/usr/sbin:/sbin, where neither Homebrew's ffmpeg nor the person's `claude` can be found.
 * Both get the same answer: the OS identity variables, plus the PATH (and proxies, and where the agents keep their
 * sign-in) of the person's login shell. On Windows there is no login shell, and the PATH a program inherits from
 * Explorer can be old (what an installer added since the person signed in is missing): the PATH is read where Windows
 * keeps it now, the registry (with the Windows system variables a program needs). Either is read again while the app
 * runs, so an agent installed meanwhile is found without restarting it. Reads no Electron module, so `node --test`
 * can use it.
 */
import { spawn } from 'node:child_process';
import { homedir, userInfo } from 'node:os';
import { isAbsolute, join } from 'node:path';

/* what the system gives every program the person starts, a terminal included: SSH_AUTH_SOCK (their keys' agent, for git
   over ssh) comes from it, not from the shell's files */
const OS_KEYS = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'TZ', 'SSH_AUTH_SOCK'];
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
/**
 * What a shell sets for itself and its terminal, not for the programs it starts as the person's settings: left out of
 * what the agents are given. Anything else the person's shell exports is theirs (keys, gateways, an MCP server's token,
 * certificates), and their agent has it here as it has it in their terminal.
 */
const SESSION_KEYS = new Set(['PWD', 'OLDPWD', 'SHLVL', '_', 'TERM', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'TERM_SESSION_ID',
  'COLORTERM', 'ITERM_SESSION_ID', 'ITERM_PROFILE', 'LC_TERMINAL', 'LC_TERMINAL_VERSION', 'TMUX', 'TMUX_PANE', 'STY', 'WINDOWID',
  'SECURITYSESSIONID', 'XPC_SERVICE_NAME', 'XPC_FLAGS', 'PS1', 'PS2', 'PROMPT']);
const SESSION_PREFIXES = ['__CF', 'ELECTRON_', 'VSCODE_', 'OPENFILM_'];
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

/** All a login shell's environment the person set (SESSION_KEYS left out), with PATH as shellSubset has it. */
export function shellVariables(dump, home = homedir()) {
  const env = {};
  for (const [key, value] of Object.entries(dump ?? {})) {
    if (typeof value !== 'string' || SESSION_KEYS.has(key) || SESSION_PREFIXES.some((p) => key.startsWith(p))) continue;
    env[key] = value;
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

/** `reg query <key>` output, read: each value's name and its text (REG_SZ and REG_EXPAND_SZ only). */
export function parseRegQuery(text) {
  const values = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^\s{2,}(\S(?:.*?\S)?)\s{2,}(REG_SZ|REG_EXPAND_SZ)\s{2,}(.*)$/.exec(line);
    if (m) values[m[1]] = m[3].trim();
  }
  return values;
}

/** `%NAME%` replaced by the variable's value, whatever its case; one not set is left as it is. */
export function expandWindowsVars(text, vars) {
  const lower = new Map(Object.entries(vars ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return String(text ?? '').replace(/%([^%;]+)%/g, (all, name) => (typeof lower.get(name.toLowerCase()) === 'string' ? lower.get(name.toLowerCase()) : all));
}

const valueOf = (vars, name) => Object.entries(vars ?? {}).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

/**
 * The PATH Windows gives a program started now: the system's, then the person's (as the registry has them, their
 * variables expanded), then whatever else the app's own PATH has. Each folder once, whatever its case.
 */
export function windowsFreshPath({ machine = {}, user = {}, source = process.env } = {}) {
  const vars = { ...source, ...machine, ...user };
  const dirs = [valueOf(machine, 'Path'), valueOf(user, 'Path'), pathOf(source)]
    .flatMap((p) => expandWindowsVars(p ?? '', vars).split(';'))
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
  const seen = new Map();
  for (const d of dirs) if (!seen.has(d.toLowerCase())) seen.set(d.toLowerCase(), d);
  return [...seen.values()].join(';');
}

const REG_MACHINE = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';
const REG_USER = 'HKCU\\Environment';

function regQuery(key, timeoutMs) {
  return new Promise((resolve) => {
    const reg = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe');
    execFile(reg, ['query', key], { timeout: timeoutMs, encoding: 'utf8', windowsHide: true }, (error, stdout) => resolve(error ? null : parseRegQuery(stdout)));
  });
}

/** Where the PATH last came from: 'registry' or 'process' (Windows), 'login shell' or 'fallback' (elsewhere). */
let pathSource = null;
export const lastPathSource = () => pathSource;

/**
 * An environment read again once it is older than `forMs` (or than a caller's `maxAgeMs`, when that is less), so a
 * program installed while the app runs is found without restarting it. A read already going is shared; one that
 * fails (null) keeps the last good one, or `fallback()` when there is none.
 * @param {() => Promise<Record<string, string> | null>} read
 * @param {{ forMs: number, fallback: () => Record<string, string>, now?: () => number }} o
 */
export function environmentCache(read, { forMs, fallback, now = Date.now }) {
  let at = -Infinity;
  let value = null;
  let reading = false;
  return ({ maxAgeMs = forMs, staleOk = false } = {}) => {
    if (value && (reading || now() - at <= Math.min(maxAgeMs, forMs))) return value;
    const last = value;
    at = now();
    reading = true;
    value = Promise.resolve().then(read).catch(() => null)
      .then(async (env) => env ?? (last ? await last : fallback()))
      .finally(() => { reading = false; });
    /* `staleOk`: an old one now, the new one for whoever asks next (an agent starts without waiting on the shell) */
    return staleOk && last ? last : value;
  };
}

/** The registry's environment (Windows): null when neither part of it could be read. */
async function readRegistry(source, timeoutMs) {
  const [machine, user] = await Promise.all([regQuery(REG_MACHINE, timeoutMs), regQuery(REG_USER, timeoutMs)]);
  if (!machine && !user) return null;
  pathSource = 'registry';
  /* the person's own variables as they are now, over the system's */
  return shellVariables({ ...machine, ...user, PATH: windowsFreshPath({ machine: machine ?? {}, user: user ?? {}, source }) }, homedir());
}

/** The login shell's variables (shellVariables): null when it gave no PATH (it failed, or took too long). */
async function readLoginShell(source, timeoutMs) {
  const base = osEnvironment(source);
  const parsed = parseEnvDump(base.SHELL ? await captureLoginShell(base.SHELL, { ...base, PATH: BASE_PATH }, timeoutMs) : null);
  if (!parsed.PATH) return null;
  pathSource = 'login shell';
  return shellVariables(parsed, base.HOME);
}

let shellCache = null;
/**
 * Everything the person's login shell sets (`shellVariables`); on Windows, the registry's. Read again after a minute
 * (Windows: a few seconds), or sooner for a caller that asks (`maxAgeMs`: the agents' list, which is looked at again
 * as the person comes back from installing one; `staleOk`, the last one read while a new one is read for next time).
 * Never rejects: on failure, the last one read, else the fallback PATH.
 * What the agents are given, so they run with what they have in the person's terminal.
 */
export function loginShellVariables({ source = process.env, timeoutMs = 5000, maxAgeMs, staleOk = false } = {}) {
  shellCache ??= environmentCache(() => (windows ? readRegistry(source, timeoutMs) : readLoginShell(source, timeoutMs)), {
    forMs: windows ? 5000 : 60_000,
    fallback: () => {
      pathSource = windows ? 'process' : 'fallback';
      return { PATH: mergePath(windows ? pathOf(source) : '', homedir()) };
    },
  });
  return shellCache({ ...(maxAgeMs === undefined ? {} : { maxAgeMs }), staleOk });
}

/** The part of it Studio and the app's other programs are given (`shellSubset`): PATH, proxies, locale. */
export async function loginShellEnvironment(options = {}) {
  return shellSubset(await loginShellVariables(options));
}

/** What scripts/start.mjs passes on to Electron besides the OS identity: this app's own switches. */
export const LAUNCHER_FLAGS = ['OPENFILM_DESKTOP_FLAVOR', 'OPENFILM_DESKTOP_CAPTURE', 'OPENFILM_EXAMPLES_INDEX', 'ELECTRON_ENABLE_LOGGING', 'ELECTRON_ENABLE_STACK_DUMPING'];

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
