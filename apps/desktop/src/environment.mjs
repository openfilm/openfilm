/**
 * The environments of the processes the app starts (Studio, the agents' adapters): what the person's own login shell
 * would give them, never what whoever launched the app had.
 *
 * Run from a terminal inside Claude Code or Codex, the app's own environment carries CLAUDECODE, CLAUDE_CODE_*,
 * ANTHROPIC_BASE_URL and the like, which an agent started here would wrongly inherit. Opened from the Dock, it has
 * only PATH=/usr/bin:/bin:/usr/sbin:/sbin, where neither Homebrew's ffmpeg nor the person's `claude` can be found.
 * Both get the same answer: the OS identity variables, plus the PATH (and proxies, and where the agents keep their
 * sign-in) of the person's login shell; with no proxy set there, the system's own (a proxy app's). On Windows there
 * is no login shell, and the PATH a program inherits from Explorer can be old (what an installer added since the
 * person signed in is missing): the PATH is read where Windows keeps it now, the registry (with the Windows system
 * variables a program needs). Either is read again while the app runs, so an agent installed meanwhile is found
 * without restarting it. Reads no Electron module, so `node --test`
 * can use it.
 */
import { execFile, spawn } from 'node:child_process';
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

/**
 * `reg query <key>` output, read: each value's name and its text, of `types` (REG_SZ and REG_EXPAND_SZ unless asked
 * for others). `expandable`, when given, gets the names of the REG_EXPAND_SZ ones: Windows expands those, never a
 * REG_SZ.
 * @param {string} text @param {Set<string>} [expandable] @param {string[]} [types]
 */
export function parseRegQuery(text, expandable, types = ['REG_SZ', 'REG_EXPAND_SZ']) {
  const values = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^\s{2,}(\S(?:.*?\S)?)\s{2,}(REG_[A-Z_]+)\s{2,}(.*)$/.exec(line);
    if (!m || !types.includes(m[2])) continue;
    values[m[1]] = m[3].trim();
    if (m[2] === 'REG_EXPAND_SZ') expandable?.add(m[1]);
  }
  return values;
}

/** `%NAME%` replaced by the variable's value, whatever its case; one not set is left as it is. */
export function expandWindowsVars(text, vars) {
  const lower = new Map(Object.entries(vars ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return String(text ?? '').replace(/%([^%;]+)%/g, (all, name) => (typeof lower.get(name.toLowerCase()) === 'string' ? lower.get(name.toLowerCase()) : all));
}

/**
 * Whether Windows expands a registry value: only a REG_EXPAND_SZ one, which `expandable` (from parseRegQuery) lists.
 * Without a list, every value is taken as one.
 * @param {Set<string> | undefined} expandable @param {string} name
 */
const expands = (expandable, name) => !expandable || expandable.has(name);

/**
 * The PATH Windows gives a program started now: the system's, then the person's (as the registry has them, their
 * variables expanded when they are REG_EXPAND_SZ), then whatever else the app's own PATH has. Each folder once,
 * whatever its case. `expand`: the REG_EXPAND_SZ names of each part (parseRegQuery).
 */
export function windowsFreshPath({ machine = {}, user = {}, source = process.env, expand = undefined } = {}) {
  const vars = { ...source, ...machine, ...user };
  const pathIn = (values, expandable) => {
    const name = Object.keys(values ?? {}).find((k) => k.toLowerCase() === 'path');
    if (name === undefined) return '';
    return expands(expandable, name) ? expandWindowsVars(values[name], vars) : values[name];
  };
  const dirs = [pathIn(machine, expand?.machine), pathIn(user, expand?.user), expandWindowsVars(pathOf(source), vars)]
    .flatMap((p) => p.split(';'))
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
  const seen = new Map();
  for (const d of dirs) if (!seen.has(d.toLowerCase())) seen.set(d.toLowerCase(), d);
  return [...seen.values()].join(';');
}

const REG_MACHINE = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';
const REG_USER = 'HKCU\\Environment';

/**
 * `reg query <key>`, read (parseRegQuery). reg writes in its console's code page, GBK on a Chinese Windows, where a
 * folder named in Chinese came out as `E:\������װ`: the console is switched to UTF-8 first.
 */
export function regQuery(key, timeoutMs, types = undefined) {
  return new Promise((resolve) => {
    const system = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
    const command = `chcp 65001 >nul && "${join(system, 'reg.exe')}" query "${key}"`;
    execFile(join(system, 'cmd.exe'), ['/d', '/s', '/c', command], { timeout: timeoutMs, encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true }, (error, stdout) => {
      if (error) return resolve(null);
      const expandable = new Set();
      resolve({ values: parseRegQuery(stdout, expandable, types), expandable });
    });
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

/**
 * The registry's variables as a program started now has them: the person's over the system's, each REG_EXPAND_SZ
 * one's `%NAME%` expanded (ComSpec is stored as %SystemRoot%\system32\cmd.exe) and a REG_SZ one as it is, and PATH
 * from windowsFreshPath in place of either Path. `expand`: the REG_EXPAND_SZ names of each part (parseRegQuery).
 */
export function registryVariables({ machine = {}, user = {}, source = process.env, expand = undefined } = {}) {
  const raw = { ...machine, ...user };
  const vars = { ...source, ...raw };
  const env = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.toLowerCase() === 'path') continue;
    const expandable = Object.hasOwn(user, key) ? expand?.user : expand?.machine;
    env[key] = expands(expandable, key) ? expandWindowsVars(expandWindowsVars(value, vars), vars) : value;
  }
  env.PATH = windowsFreshPath({ machine, user, source, expand });
  return env;
}

/** The registry's environment (Windows): null when neither part of it could be read. */
async function readRegistry(source, timeoutMs) {
  const [machine, user] = await Promise.all([regQuery(REG_MACHINE, timeoutMs), regQuery(REG_USER, timeoutMs)]);
  if (!machine && !user) return null;
  pathSource = 'registry';
  const expand = { machine: machine?.expandable ?? new Set(), user: user?.expandable ?? new Set() };
  return shellVariables(registryVariables({ machine: machine?.values ?? {}, user: user?.values ?? {}, source, expand }), homedir());
}

/** The login shell's variables (shellVariables): null when it gave no PATH (it failed, or took too long). */
async function readLoginShell(source, timeoutMs) {
  const base = osEnvironment(source);
  const parsed = parseEnvDump(base.SHELL ? await captureLoginShell(base.SHELL, { ...base, PATH: BASE_PATH }, timeoutMs) : null);
  if (!parsed.PATH) return null;
  pathSource = 'login shell';
  return shellVariables(parsed, base.HOME);
}

/* ── the system's proxy ──
   A proxy app usually turns on the system's proxy only: browsers use it, and an agent's HTTPS
   calls may too, but not every connection it makes (Codex's WebSocket to its model goes straight out, times out five
   times, then falls back to HTTPS). Unless the person set proxy variables themselves, the agents are given the
   system's proxy as HTTPS_PROXY, HTTP_PROXY and NO_PROXY, as a terminal with the proxy app's variables would have. */

const SET_PROXY_KEYS = ['https_proxy', 'http_proxy', 'all_proxy'];
const REG_INTERNET = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

/**
 * `scutil --proxy` output, read: the keys of its top dictionary (HTTPSEnable, HTTPSProxy, HTTPSPort…) and the entries
 * of its ExceptionsList; the per-interface ones under __SCOPED__ left out.
 */
export function parseScutilProxy(text) {
  const values = {};
  const exceptions = [];
  let depth = 0;
  let list = null;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^\s*([^\s:][^:]*?)\s*:\s*(.*?)\s*$/.exec(line);
    if (m && depth === 1 && !m[2].endsWith('{')) values[m[1]] = m[2];
    if (m && depth === 2 && list === 'ExceptionsList') exceptions.push(m[2]);
    if (line.trim().endsWith('{')) { depth += 1; if (depth === 2) list = m?.[1] ?? null; }
    if (line.trim() === '}') { depth -= 1; if (depth < 2) list = null; }
  }
  return { values, exceptions };
}

/** macOS's proxy (parseScutilProxy's), each kind as host:port; null when none is on. */
export function macProxy({ values = {}, exceptions = [] } = {}) {
  const at = (kind, port) => (values[`${kind}Enable`] === '1' && values[`${kind}Proxy`] ? `${values[`${kind}Proxy`]}:${values[`${kind}Port`] || port}` : null);
  const found = { http: at('HTTP', 80), https: at('HTTPS', 443), socks: at('SOCKS', 1080), bypass: exceptions };
  return found.http || found.https || found.socks ? found : null;
}

/**
 * Windows's proxy (the Internet settings' ProxyEnable, ProxyServer, ProxyOverride), each kind as host:port; null when
 * it is off. ProxyServer is one `host:port` for all, or `http=…;https=…;socks=…`.
 */
export function windowsProxy(settings = {}) {
  if (!/^(?:0x)?0*1$/i.test(String(settings.ProxyEnable ?? '').trim())) return null;
  const server = String(settings.ProxyServer ?? '').trim();
  if (!server) return null;
  const by = {};
  if (!server.includes('=')) by.http = by.https = server;
  else {
    for (const part of server.split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0 && part.slice(eq + 1).trim()) by[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
    }
  }
  const found = { http: by.http ?? null, https: by.https ?? null, socks: by.socks ?? null, bypass: String(settings.ProxyOverride ?? '').split(';') };
  return found.http || found.https || found.socks ? found : null;
}

/**
 * A proxy's exceptions as NO_PROXY has them: this computer always; `*.example.com` as `.example.com`, `10.*` and
 * `169.254/16` as address ranges; Windows's `<local>` and other wildcards, which NO_PROXY cannot say, left out.
 */
export function noProxyList(bypass = []) {
  const out = ['localhost', '127.0.0.1', '::1'];
  for (const raw of bypass) {
    const entry = String(raw ?? '').trim();
    if (!entry || entry === '<local>') continue;
    let m;
    if ((m = /^((?:\d{1,3}\.){1,3})\*$/.exec(entry))) {
      const octets = m[1].slice(0, -1).split('.');
      out.push(`${[...octets, '0', '0', '0'].slice(0, 4).join('.')}/${octets.length * 8}`);
    } else if ((m = /^(\d{1,3}(?:\.\d{1,3}){0,3})\/(\d{1,2})$/.exec(entry))) {
      out.push(`${[...m[1].split('.'), '0', '0', '0'].slice(0, 4).join('.')}/${m[2]}`);
    } else if (entry.startsWith('*.') && !entry.slice(2).includes('*')) out.push(entry.slice(1));
    else if (!entry.includes('*')) out.push(entry);
  }
  return [...new Set(out)].join(',');
}

/** A proxy (macProxy's, windowsProxy's) as the variables programs read, in both cases; none: {}. */
export function proxyVariables(found) {
  if (!found) return {};
  const env = {};
  const set = (key, value) => { env[key] = value; env[key.toLowerCase()] = value; };
  const url = (at, scheme) => (/^[a-z][a-z\d+.-]*:\/\//i.test(at) ? at : `${scheme}://${at}`);
  const https = found.https ?? found.http;
  const http = found.http ?? found.https;
  if (https) set('HTTPS_PROXY', url(https, 'http'));
  if (http) set('HTTP_PROXY', url(http, 'http'));
  if (!https && !http && found.socks) set('ALL_PROXY', url(found.socks, 'socks5h'));
  set('NO_PROXY', noProxyList(found.bypass));
  return env;
}

/**
 * The person's variables, with the system's proxy (`proxy`, proxyVariables') unless they set one themselves; a
 * NO_PROXY of theirs stays.
 */
export function withSystemProxy(env, proxy) {
  if (Object.keys(env).some((key) => SET_PROXY_KEYS.includes(key.toLowerCase()) && env[key])) return env;
  return { ...proxy, ...env };
}

/** The system's proxy as proxy variables (Windows, macOS); {} when none is on, or it could not be read. */
async function systemProxyVariables(timeoutMs) {
  if (windows) return proxyVariables(windowsProxy((await regQuery(REG_INTERNET, timeoutMs, ['REG_SZ', 'REG_DWORD']))?.values ?? {}));
  if (process.platform !== 'darwin') return {};
  const text = await new Promise((resolve) => {
    execFile('/usr/sbin/scutil', ['--proxy'], { timeout: timeoutMs, encoding: 'utf8' }, (error, stdout) => resolve(error ? '' : stdout));
  });
  return proxyVariables(macProxy(parseScutilProxy(text)));
}

/** The person's variables (the registry's, or the login shell's), with the system's proxy: null when they failed. */
async function readPersonVariables(source, timeoutMs) {
  const [env, proxy] = await Promise.all([
    windows ? readRegistry(source, timeoutMs) : readLoginShell(source, timeoutMs),
    systemProxyVariables(timeoutMs).catch(() => ({})),
  ]);
  return env && withSystemProxy(env, proxy);
}

let shellCache = null;
/**
 * Everything the person's login shell sets (`shellVariables`); on Windows, the registry's. With no proxy of their own
 * there, the system's (withSystemProxy). Read again after a minute
 * (Windows: a few seconds), or sooner for a caller that asks (`maxAgeMs`: the agents' list, which is looked at again
 * as the person comes back from installing one; `staleOk`, the last one read while a new one is read for next time).
 * Never rejects: on failure, the last one read, else the fallback PATH.
 * What the agents are given, so they run with what they have in the person's terminal.
 */
export function loginShellVariables({ source = process.env, timeoutMs = 5000, maxAgeMs, staleOk = false } = {}) {
  shellCache ??= environmentCache(() => readPersonVariables(source, timeoutMs), {
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
