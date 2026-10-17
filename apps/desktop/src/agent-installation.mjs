/**
 * Where the person's own agents are (agents.mjs AGENTS: Claude Code, Codex, Gemini CLI, …). Only real installations count: a config folder survives an
 * uninstall and is never evidence. On Windows an install by npm, pnpm or Yarn leaves a `.cmd` shim, which no program
 * can start without a shell: what it runs is used instead (cmdTarget), and one that cannot be read is started through
 * cmd.exe (agents.mjs). A program the person chose themselves (Settings → Agents → Locate) comes before any of these.
 * Reads no Electron module, so `node --test` can use it.
 */
import { execFileSync } from 'node:child_process';
import { accessSync, closeSync, constants, lstatSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';

export const AGENT_DOWNLOADS = Object.freeze({
  claude: 'https://claude.com/download',
  codex: 'https://developers.openai.com/codex',
  gemini: 'https://geminicli.com',
  copilot: 'https://github.com/features/copilot/cli',
  cursor: 'https://cursor.com/cli',
  opencode: 'https://opencode.ai/download',
  codebuddy: 'https://www.workbuddy.ai/docs/cli/installation',
  qwen: 'https://github.com/QwenLM/qwen-code',
  kimi: 'https://www.kimi.com/code',
});

/**
 * Each agent's program, by the names it installs (the first found counts), and the folders its own installer puts it
 * in beside the usual ones (HOME_BIN_CANDIDATES): those are not always on the PATH an app gets.
 */
export const AGENT_PROGRAMS = Object.freeze({
  claude: { names: ['claude'] },
  codex: { names: ['codex'] },
  gemini: { names: ['gemini'] },
  copilot: { names: ['copilot'] },
  cursor: { names: ['cursor-agent'] },
  opencode: { names: ['opencode'], dirs: (home) => [join(home, '.opencode', 'bin')] },
  codebuddy: { names: ['codebuddy', 'cbc'] },
  qwen: { names: ['qwen'] },
  /* Kimi Code's own installer keeps it in ~/.kimi-code/bin; kimi-cli (uv) puts it in ~/.local/bin */
  kimi: { names: ['kimi'], dirs: (home) => [join(home, '.kimi-code', 'bin')] },
});

export function executableFile(path) {
  try { accessSync(path, constants.X_OK); return statSync(path).isFile(); } catch { return false; }
}

/**
 * Whether a file is a Windows program for the console, by its header and without starting it: a window program (a
 * desktop app's own, as `app\Codex.exe` in the Codex Store app is) would open its window, and answers nothing.
 */
export function consoleProgram(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const head = Buffer.alloc(4096);
    const read = readSync(fd, head, 0, head.length, 0);
    if (read < 64 || head.toString('latin1', 0, 2) !== 'MZ') return false;
    const pe = head.readUInt32LE(0x3c);
    /* the subsystem sits at the same place in 32- and 64-bit headers: 3 is the console, 2 a window */
    if (pe + 0x5e > read || head.toString('latin1', pe, pe + 4) !== 'PE\0\0') return false;
    return head.readUInt16LE(pe + 0x5c) === 3;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Claude Code as the Claude app keeps it: one folder per version under Application Support, newest first, the program
 * either straight inside (`<version>/claude.app`) or one folder down (`<version>/<build>/claude.app`, newer apps).
 */
export function claudeAppCli(home = homedir()) {
  const root = join(home, 'Library/Application Support/Claude/claude-code');
  const inside = (dir) => {
    const direct = join(dir, 'claude.app/Contents/MacOS/claude');
    if (executableFile(direct)) return direct;
    let builds = [];
    try { builds = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'claude.app').map((d) => d.name); } catch { return null; }
    return builds.map((b) => join(dir, b, 'claude.app/Contents/MacOS/claude')).find(executableFile) ?? null;
  };
  try {
    return readdirSync(root).filter((v) => /^\d+(\.\d+)*$/.test(v))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((v) => inside(join(root, v))).find(Boolean) ?? null;
  } catch { return null; /* the Claude app has not downloaded Claude Code */ }
}

/**
 * Which Claude Code a program is, told from where it is installed without starting it: the Claude app's and Homebrew's
 * folders and the official installer's file are named for the version (`claude-code/2.1.295/…`,
 * `Caskroom/claude-code/2.1.295/…`, `claude/versions/2.1.295`); npm's has its package.json. Null when it can't be told.
 */
export function claudeVersion(file) {
  let real;
  try { real = realpathSync(file); } catch { return null; }
  /* npm's first: its folders can be named for Node's version (Homebrew's Cellar/node/26.0.0/lib/node_modules/…) */
  for (let dir = dirname(real), up = 0; up < 3; dir = dirname(dir), up += 1) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (pkg.name === '@anthropic-ai/claude-code' && typeof pkg.version === 'string') return pkg.version;
    } catch { /* not here */ }
  }
  return real.split(/[\\/]/).reverse().find((part) => /^\d+\.\d+\.\d+$/.test(part)) ?? null;
}

/** What versions of Codex said of themselves (`codex --version`), by program and its time: each asked once. */
const codexAsked = new Map();

/** What a Codex program says its version is (`codex-cli 0.163.0`); null when it says nothing in two seconds. */
function askCodexVersion(/** @type {string} */ file) {
  /* a `.cmd` shim cannot be started without a shell; npm's says its version in its package.json anyway */
  if (/\.(cmd|bat)$/i.test(file)) return null;
  try {
    const out = execFileSync(file, ['--version'], { encoding: 'utf8', timeout: 2000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return /(\d+\.\d+\.\d+)/.exec(out)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Which Codex a program is: npm's says it in its package.json (`@openai/codex`, or the platform package its program
 * is in), Homebrew's folder is named for it (`Caskroom/codex/0.163.0/…`); a copy inside an app (Codex.app,
 * ChatGPT.app, a Store app) says it when asked (`--version`), once. Null when it can't be told.
 * @param {string} file @param {{ ask?: (file: string) => string | null }} [o]
 */
export function codexVersion(file, { ask = askCodexVersion } = {}) {
  let real;
  try { real = realpathSync(file); } catch { return null; }
  for (let dir = dirname(real), up = 0; up < 6; dir = dirname(dir), up += 1) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (typeof pkg.name === 'string' && pkg.name.startsWith('@openai/codex') && typeof pkg.version === 'string') return pkg.version.replace(/-.*$/, '');
    } catch { /* not here */ }
  }
  const named = real.split(/[\\/]/).reverse().find((part) => /^\d+\.\d+\.\d+$/.test(part));
  if (named) return named;
  let key;
  try { key = `${real}\0${statSync(real).mtimeMs}`; } catch { return null; }
  if (!codexAsked.has(key)) codexAsked.set(key, ask(real));
  return codexAsked.get(key) ?? null;
}

/** Whether version `a` is later than `b` (dotted numbers); false when either is unknown. */
export function laterVersion(a, b) {
  if (!a || !b) return false;
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

const windows = process.platform === 'win32';
const valueOf = (env, name) => Object.entries(env ?? {}).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1] || undefined;

/**
 * The folders Windows installers put programs in, which an app's PATH does not always have: the agents' own
 * installers (~/.local/bin), npm, pnpm, Volta, nvm-windows, Yarn, Bun, Scoop, Chocolatey, winget, and the commands
 * of apps from the Microsoft Store.
 */
export function windowsBinDirs(env = process.env, home = homedir()) {
  const v = (name) => valueOf(env, name);
  const appData = v('APPDATA') ?? join(home, 'AppData', 'Roaming');
  const local = v('LOCALAPPDATA') ?? join(home, 'AppData', 'Local');
  return [
    join(home, '.local', 'bin'),
    join(appData, 'npm'),
    ...(v('PNPM_HOME') ? [v('PNPM_HOME')] : []), join(local, 'pnpm'),
    ...(v('VOLTA_HOME') ? [join(v('VOLTA_HOME'), 'bin')] : []), join(local, 'Volta', 'bin'),
    ...(v('NVM_SYMLINK') ? [v('NVM_SYMLINK')] : []),
    join(local, 'Yarn', 'bin'),
    join(home, '.bun', 'bin'),
    ...(v('SCOOP') ? [join(v('SCOOP'), 'shims')] : []), join(home, 'scoop', 'shims'),
    join(v('ProgramData') ?? join(home, '..', '..', 'ProgramData'), 'chocolatey', 'bin'),
    join(local, 'Microsoft', 'WinGet', 'Links'),
    join(local, 'Microsoft', 'WindowsApps'),
  ];
}

export const HOME_BIN_CANDIDATES = (home = homedir()) => (windows
  ? windowsBinDirs(process.env, home)
  : [join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']);

/** What a program is called on Windows, in the order cmd.exe tries (an extensionless file there is a shell script). */
const WIN_SUFFIXES = ['.exe', '.cmd', '.bat'];
const isCmdScript = (path) => /\.(?:cmd|bat)$/i.test(path);

/**
 * A program file on Windows. A Microsoft Store app's command (WindowsApps) is a link that cannot be followed like a
 * file, yet starts like one: there, being there is enough.
 */
function presentFile(path) {
  try { return statSync(path).isFile(); } catch { /* maybe a Store app's command */ }
  try { const s = lstatSync(path); return s.isFile() || s.isSymbolicLink(); } catch { return false; }
}

/** each folder once (on Windows whatever its case), as first spelled */
function unique(dirs, win) {
  const seen = new Map();
  for (const d of dirs) if (d && isAbsolute(d) && !seen.has(win ? d.toLowerCase() : d)) seen.set(win ? d.toLowerCase() : d, d);
  return [...seen.values()];
}
/* an environment spread from Windows' own has its Path as well as the PATH set on purpose: that one wins */
const pathIn = (env) => env?.PATH ?? valueOf(env, 'PATH') ?? '';

export function findExecutable(name, extraDirs = [], env = process.env, { win = windows } = {}) {
  const path = pathIn(env);
  for (const dir of unique([...path.split(win ? ';' : delimiter), ...extraDirs], win)) {
    for (const suffix of win ? WIN_SUFFIXES : ['']) {
      const file = join(dir, name + suffix);
      if (win ? presentFile(file) : executableFile(file)) return win && isCmdScript(file) ? cmdTarget(file) ?? file : file;
    }
  }
  return null;
}

/* what a shim runs: "%dp0%\…" (npm), "%~dp0\…" (pnpm, Yarn); never the node.exe it may run it with */
const SHIM_TARGET = /"%(?:~dp0|_?dp0%)\\?([^"%]+?\.(?:js|cjs|mjs|exe|cmd|bat))"/gi;
const scriptFirst = (rel) => (/\.(?:c|m)?js$/i.test(rel) ? 0 : /\.exe$/i.test(rel) ? 1 : 2);

/**
 * What a `.cmd` shim runs (Windows): the package's script or program, which can be started without a shell (a `.cmd`
 * cannot be). Yarn's shim runs another shim, which is read in turn. Codex's script only starts its own program, so
 * the program itself, for this machine's chip; when there is none, not the script (the chat starts Codex as a shell
 * command, which a script is not): the shim it came from instead. Null when the shim says nothing that is there.
 */
export function cmdTarget(cmd, depth = 0) {
  let text = '';
  try { text = readFileSync(cmd, 'utf8'); } catch { return null; }
  const rels = [...new Set([...text.matchAll(SHIM_TARGET)].map((m) => m[1]))]
    .filter((rel) => !/(?:^|[\\/])node\.exe$/i.test(rel))
    .sort((a, b) => scriptFirst(a) - scriptFirst(b));
  for (const rel of rels) {
    const target = join(dirname(cmd), ...rel.split(/[\\/]+/));
    if (isCmdScript(target)) {
      const next = depth < 3 && existsFile(target) ? cmdTarget(target, depth + 1) : null;
      if (next) return next;
      continue;
    }
    if (/[\\/]@openai[\\/]codex[\\/]/i.test(target) && /\.js$/i.test(target)) {
      const triple = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
      const pkg = target.replace(/[\\/]bin[\\/][^\\/]+$/, '');
      /* the platform package it installs beside its script, or one folder up when that was hoisted, and the one it
         ships itself: `bin`, as the package's own script says, `codex` in older ones */
      const exe = [
        join(pkg, 'node_modules', '@openai', `codex-win32-${process.arch}`, 'vendor', triple, 'bin', 'codex.exe'),
        join(pkg, '..', `codex-win32-${process.arch}`, 'vendor', triple, 'bin', 'codex.exe'),
        join(pkg, 'vendor', triple, 'bin', 'codex.exe'),
        join(pkg, 'vendor', triple, 'codex', 'codex.exe'),
        join(pkg, 'node_modules', '@openai', `codex-win32-${process.arch}`, 'vendor', triple, 'codex', 'codex.exe'),
      ].find(existsFile);
      if (exe) return exe;
      /* a shell command cannot start the script, so the shim it came from (null here) is used instead */
      continue;
    }
    if (existsFile(target)) return target;
  }
  return null;
}

function existsFile(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

/* where Codex is inside Codex.app and ChatGPT.app */
const CODEX_IN_APP = ['Contents/Resources/codex', 'Contents/Resources/codex-cli/bin/codex'];

/** The copies of Codex inside Codex.app and ChatGPT.app in these folders, Codex.app's first. */
function codexInApps(/** @type {string[]} */ applicationDirs) {
  return applicationDirs.flatMap((dir) => ['Codex.app', 'ChatGPT.app'].flatMap((app) => CODEX_IN_APP.map((p) => join(dir, app, p)))).filter(executableFile);
}

/**
 * The program the person chose for an agent, as it can be started: a `.cmd` shim's target, the `.cmd` beside a
 * PowerShell shim (`.ps1`), the program inside a folder or an app chosen instead of it. Null when it is not there.
 */
export function chosenProgram(path, { names = [], win = windows } = {}) {
  if (typeof path !== 'string' || !isAbsolute(path)) return null;
  let folder = false;
  try { folder = statSync(path).isDirectory(); } catch { /* a file, or not there */ }
  if (folder) {
    const inApp = /\.app$/i.test(path) ? [...CODEX_IN_APP, ...names.map((n) => `Contents/MacOS/${n}`)].map((p) => join(path, p)).find(executableFile) : null;
    return inApp ?? names.map((n) => findExecutable(n, [path, join(path, 'bin')], { PATH: '' }, { win })).find(Boolean) ?? null;
  }
  if (win) {
    if (/\.ps1$/i.test(path)) {
      const cmd = path.replace(/\.ps1$/i, '.cmd');
      return presentFile(cmd) ? cmdTarget(cmd) ?? cmd : null;
    }
    if (!presentFile(path)) return null;
    return isCmdScript(path) ? cmdTarget(path) ?? path : path;
  }
  return executableFile(path) || (/\.(?:c|m)?js$/i.test(path) && existsFile(path)) ? path : null;
}

/**
 * The command line program, or the copy inside the maker's own desktop app (many people only ever installed the
 * app): Codex ships inside Codex.app and ChatGPT.app; the Claude app keeps Claude Code under Application Support, one
 * folder per version, the newest used. `chosen`: the program the person chose, first. `others`: programs found some
 * other way (a Store app's own copy, agents.mjs), after the rest. `source` says which it is: chosen · path · app.
 */
export function detectAgentInstallation(id, { home = homedir(), env = process.env, pathDirs = HOME_BIN_CANDIDATES(home),
  applicationDirs = ['/Applications', join(home, 'Applications')], chosen = null, others = [], win = windows, codexVersionOf = codexVersion } = {}) {
  const program = AGENT_PROGRAMS[id] ?? { names: [id] };
  const install = AGENT_DOWNLOADS[id] ?? null;
  const picked = chosen ? chosenProgram(chosen, { names: program.names, win }) : null;
  if (picked) return { installed: true, cli: picked, source: 'chosen', install };
  const dirs = [...pathDirs, ...(program.dirs?.(home) ?? [])];
  let cli = null;
  for (const name of program.names) if (!cli) cli = findExecutable(name, dirs, env, { win });
  if (cli) {
    /* Claude Code both on the PATH (an npm install that is never updated, say) and in the Claude app, which keeps its
       own up to date: the later one, whose models are the current ones. One whose version can't be told stays. */
    const inApp = id === 'claude' ? claudeAppCli(home) : null;
    if (inApp && laterVersion(claudeVersion(inApp), claudeVersion(cli))) return { installed: true, cli: inApp, source: 'app', install };
    /* Codex the same: one installed by npm long ago beside the copy in Codex.app, ChatGPT.app or a Store app, which
       keep theirs up to date. Its models are the ones its version is offered, so the later one is used */
    if (id === 'codex') {
      const copies = [...codexInApps(applicationDirs), ...others.filter((file) => (win ? presentFile(file) : executableFile(file)))];
      const mine = copies.length ? codexVersionOf(cli) : null;
      let newest = null;
      for (const copy of copies) {
        const version = codexVersionOf(copy);
        if (laterVersion(version, newest?.version ?? mine)) newest = { copy, version };
      }
      if (newest) return { installed: true, cli: newest.copy, source: 'app', install };
    }
    return { installed: true, cli, source: 'path', install };
  }
  if (id === 'codex') cli = codexInApps(applicationDirs)[0] ?? null;
  if (!cli && id === 'claude') cli = claudeAppCli(home);
  if (!cli) cli = others.find((file) => (win ? presentFile(file) : executableFile(file))) ?? null;
  return { installed: Boolean(cli), cli, source: cli ? 'app' : null, install };
}

/**
 * For a person whose agent is not found, what was looked at: every folder searched, and each file there with one of
 * the agent's names (any suffix, a PowerShell shim too) with what it runs, if that can be told.
 */
export function searchReport(id, { home = homedir(), env = process.env, pathDirs = HOME_BIN_CANDIDATES(home), win = windows } = {}) {
  const program = AGENT_PROGRAMS[id] ?? { names: [id] };
  const searched = unique([...pathIn(env).split(win ? ';' : delimiter), ...pathDirs, ...(program.dirs?.(home) ?? [])], win);
  const files = [];
  for (const dir of searched) {
    for (const name of program.names) {
      for (const suffix of ['', '.exe', '.cmd', '.bat', '.ps1']) {
        const file = join(dir, name + suffix);
        if (!presentFile(file)) continue;
        const runs = isCmdScript(file) ? cmdTarget(file) : /\.ps1$/i.test(file) ? null : file;
        files.push({ file, runs, usable: win ? suffix !== '' && suffix !== '.ps1' : executableFile(file) });
      }
    }
  }
  return { searched, files };
}
