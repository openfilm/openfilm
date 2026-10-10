/**
 * Where the person's own agents are (agents.mjs AGENTS: Claude Code, Codex, Gemini CLI, …). Only real installations count: a config folder survives an
 * uninstall and is never evidence. On Windows an npm install leaves a `.cmd` shim, which no program can start without
 * a shell: what it runs is used instead (cmdTarget). Reads no Electron module, so `node --test` can use it.
 */
import { accessSync, constants, readFileSync, readdirSync, statSync } from 'node:fs';
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

export const HOME_BIN_CANDIDATES = (home = homedir()) => (process.platform === 'win32'
  ? [join(home, '.local', 'bin'), ...(process.env.APPDATA ? [join(process.env.APPDATA, 'npm')] : [])]
  : [join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']);

const windows = process.platform === 'win32';

export function findExecutable(name, extraDirs = [], env = process.env) {
  const path = env.PATH ?? env.Path ?? '';
  for (const dir of [...new Set([...path.split(delimiter), ...extraDirs])].filter(isAbsolute)) {
    for (const suffix of windows ? ['.exe', '.cmd', ''] : ['']) {
      const file = join(dir, name + suffix);
      if (windows ? existsFile(file) : executableFile(file)) return windows && file.toLowerCase().endsWith('.cmd') ? cmdTarget(file) ?? file : file;
    }
  }
  return null;
}

function existsFile(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

/**
 * What an npm `.cmd` shim runs (Windows): the package's script or program, which can be started without a shell (a
 * `.cmd` cannot be). Codex's script only starts its own program, so the program itself, for this machine's chip.
 */
export function cmdTarget(cmd) {
  let text = '';
  try { text = readFileSync(cmd, 'utf8'); } catch { return null; }
  const rel = /"%(?:~?dp0|_?dp0)%\\([^"]+?\.(?:js|cjs|mjs|exe))"/i.exec(text)?.[1];
  if (!rel) return null;
  const target = join(dirname(cmd), ...rel.split(/[\\/]+/));
  if (/[\\/]@openai[\\/]codex[\\/]/i.test(target) && /\.js$/i.test(target)) {
    const triple = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
    const pkg = target.replace(/[\\/]bin[\\/][^\\/]+$/, '');
    const exe = [join(pkg, 'vendor', triple, 'codex', 'codex.exe'), join(pkg, 'node_modules', '@openai', `codex-win32-${process.arch}`, 'vendor', triple, 'codex', 'codex.exe')].find(existsFile);
    if (exe) return exe;
  }
  return existsFile(target) ? target : null;
}

/**
 * The command line program, or the copy inside the maker's own desktop app (many people only ever installed the
 * app): Codex ships inside Codex.app and ChatGPT.app; the Claude app keeps Claude Code under Application Support, one
 * folder per version, the newest used.
 */
export function detectAgentInstallation(id, { home = homedir(), env = process.env, pathDirs = HOME_BIN_CANDIDATES(home),
  applicationDirs = ['/Applications', join(home, 'Applications')] } = {}) {
  const program = AGENT_PROGRAMS[id] ?? { names: [id] };
  const dirs = [...pathDirs, ...(program.dirs?.(home) ?? [])];
  let cli = null;
  for (const name of program.names) if (!cli) cli = findExecutable(name, dirs, env);
  if (!cli && id === 'codex') {
    cli = applicationDirs.flatMap((dir) => ['Codex.app', 'ChatGPT.app'].flatMap((app) => [
      join(dir, app, 'Contents/Resources/codex'), join(dir, app, 'Contents/Resources/codex-cli/bin/codex'),
    ])).find(executableFile) ?? null;
  }
  if (!cli && id === 'claude') cli = claudeAppCli(home);
  return { installed: Boolean(cli), cli, install: AGENT_DOWNLOADS[id] ?? null };
}
