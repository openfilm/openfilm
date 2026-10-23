/**
 * The chat's agents: the person's own Claude Code, Codex, GitHub Copilot, Cursor, OpenCode, CodeBuddy, Qwen Code,
 * Kimi, MiniMax Code or DeepSeek Harness, driven over the Agent Client Protocol (ACP): a child process speaking
 * JSON-RPC over stdin/stdout.
 * The app is the client: initialize, session/new (or session/resume for a conversation from before), session/prompt;
 * session/update draws the chat, and session/request_permission asks the person in the chat.
 *
 * Claude Code and Codex speak it through their makers' official adapters (`@agentclientprotocol/claude-agent-acp`,
 * `@agentclientprotocol/codex-acp`, Apache-2.0), which the app carries; the others speak it themselves (`qwen --acp`,
 * `opencode acp`, …), as the ACP registry (agentclientprotocol.com/registry) starts them.
 *
 * Why the person's own installation, never one bundled with the app:
 *   · size: each official program is 200–330 MB; the adapters are a few MB and take its path
 *     (`CLAUDE_CODE_EXECUTABLE`, `CODEX_PATH`);
 *   · terms: Anthropic lets people use their own subscription in the unmodified Claude Code, and does not let anyone
 *     else hold or pass on their credentials. The app runs their own program, sign-in is its own (`claude auth login`
 *     in Terminal, or a command window on Windows; Codex in Codex itself), and the app never sees a token.
 *
 * Each uses the account signed in on the computer, as it is: one switched in the agent (or its maker's app) is the
 * one used once the agent is connected again here.
 *
 * The agent works the way it would in a terminal: in the project's folder, with the `openfilm` command on its PATH
 * (this app's copy, so its Studio is the one in the window) and a few lines saying where it is (INSTRUCTIONS).
 *
 * Reads no Electron module, so `node --test` can use it.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, homedir, release, tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, win32 } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as acp from '@agentclientprotocol/sdk';
import { PATH_SEP, childEnvironment, lastPathSource, loginShellEnvironment, loginShellVariables, shellSubset } from './environment.mjs';
import { AGENT_PROGRAMS, HOME_BIN_CANDIDATES, chosenProgram, codexAppCopies, codexVersion, desktopApp, detectAgentInstallation, installCommand, laterVersion, notTheAgent, searchReport } from './agent-installation.mjs';
import { logSwitches } from './agent-logs.mjs';
import { mergeConfig, sessionSkills } from './agent-skills.mjs';
import { nodeBinary } from './node-runtime.mjs';
import { outOfBalance } from './pi-config.mjs';
import { AGENT_DEFINITIONS } from './agent-definitions.mjs';

const require = createRequire(import.meta.url);

/**
 * Each agent: through an adapter the app carries (`adapter`, told where the person's program is by `env`), or the
 * person's program itself with `args`. Signed in? `auth` asks the program (its words say); without it, a session is
 * opened and closed (acpSignedIn). `login` is its own sign-in, run in Terminal (none: the program itself, which asks
 * for one on its first run; null: signed in in the program or its maker's app, never from here, so one found is
 * connected). `authenticate`: the ACP auth method that takes up the program's own sign-in.
 * `approve`: it asks permission for what the app lets every agent do (see the chat's AGENT_FORCED_PREFS), so the app
 * answers yes itself. The others are told the app's INSTRUCTIONS in the first message of a session (`systemPrompt`:
 * how Claude Code and Codex are told them instead).
 */
export const AGENTS = Object.freeze({
  claude: {
    label: AGENT_DEFINITIONS.claude.name,
    adapter: '@agentclientprotocol/claude-agent-acp',
    env: (path) => ({ CLAUDE_CODE_EXECUTABLE: path }),
    auth: ['auth', 'status'],
    login: ['auth', 'login'],
    /* of the shell only its PATH, proxies, config folder and locale, as 0.1.5 had it: a key or
       gateway set there (ANTHROPIC_*) would take the place of the person's Claude subscription */
    fromShell: shellSubset,
    /* signed in to the person's Claude subscription, the way its adapter offers it (ACP terminal auth), in Terminal */
    acpSignIn: 'claude-ai-login',
    systemPrompt: true,
  },
  codex: {
    label: AGENT_DEFINITIONS.codex.name,
    adapter: '@agentclientprotocol/codex-acp',
    env: (path) => codexLaunchEnv(path),
    /* asked only for whose account it is: Codex is signed in in Codex (its app, or `codex login`) */
    auth: ['login', 'status'],
    login: null,
    systemPrompt: true,
  },
  copilot: { label: AGENT_DEFINITIONS.copilot.name, args: ['--acp', '--allow-all'], login: ['login'], approve: true },
  cursor: { label: AGENT_DEFINITIONS.cursor.name, args: ['--force', 'acp'], auth: ['status'], login: ['login'], authenticate: 'cursor_login', approve: true },
  opencode: { label: AGENT_DEFINITIONS.opencode.name, args: ['acp'], login: ['auth', 'login'], approve: true },
  /* CodeBuddy is the China edition unless the person's shell says otherwise: the program itself defaults to the
     international site (www.codebuddy.ai) whichever site it was signed in on, out of reach from China */
  codebuddy: { label: AGENT_DEFINITIONS.codebuddy.name, args: ['--acp', '--permission-mode', 'bypassPermissions'], login: [], approve: true,
    defaults: { CODEBUDDY_INTERNET_ENVIRONMENT: 'internal' } },
  qwen: { label: AGENT_DEFINITIONS.qwen.name, args: ['--acp', '--approval-mode', 'yolo'], login: [], approve: true },
  kimi: { label: AGENT_DEFINITIONS.kimi.name, args: ['acp'], login: ['login'], approve: true },
  minimax: { label: AGENT_DEFINITIONS.minimax.name, args: ['acp'], login: ['login'], approve: true },
  /* DeepSeek Harness (`dsh`) speaks ACP as its `acp` profile. It has no sign-in command: the person signs in to their
     DeepSeek account in its desktop app, or sets DEEPSEEK_API_KEY, so one found is connected. It reports every tool
     as kind `other`, titled by its name: `toolKinds` gives each the kind it is (see withToolKind) */
  deepseek: { label: AGENT_DEFINITIONS.deepseek.name, args: ['--profile', 'acp'], login: null, approve: true,
    toolKinds: {
      bash: 'execute', pwsh: 'execute',
      read: 'read', read_image: 'read',
      write: 'edit', edit: 'edit', str_replace_editor: 'edit',
      grep: 'search', glob: 'search',
      web_search: 'fetch', web_fetch: 'fetch',
    } },
});

/**
 * A tool call with the kind its name says (`toolKinds`), for an agent that reports every tool as `other`. The chat
 * draws an `other` call as the passing "Working" status, not a step: without its kind, a turn shows no step until
 * it ends.
 */
export function withToolKind(update, toolKinds) {
  if (!toolKinds || update?.sessionUpdate !== 'tool_call' || (update.kind ?? 'other') !== 'other') return update;
  const kind = Object.hasOwn(toolKinds, update.title) ? toolKinds[update.title] : null;
  return kind ? { ...update, kind } : update;
}

export const isAgentId = (id) => typeof id === 'string' && Object.hasOwn(AGENTS, id);

/** The variables an agent is started with (`defaults`) that the person's shell does not set itself. */
export function agentDefaults(id, shell = {}) {
  return Object.fromEntries(Object.entries(AGENTS[id]?.defaults ?? {}).filter(([key]) => !Object.hasOwn(shell, key)));
}

/** The app's own agent: Pi (pi-agent.mjs), on the person's own key (agent-roster.mjs). */
export const HARNESS_AGENTS = Object.freeze(['byok']);
export const isChatAgent = (id) => isAgentId(id) || HARNESS_AGENTS.includes(id);

/** How the person points at things in Studio, and how the agent points back: told to every agent, the app's own too. */
export const STUDIO_REFERENCES = `When the person mentions something in Studio, they may name a clip, a page or a moment (as seconds); find it in
film.html and the project's files.

In your replies you can point at things in Studio for the person: [[clip:ID]] (a clip, by its id in film.html),
[[t:SECONDS]] (a moment), [[range:START-END]] (a stretch, in seconds), [[track:N]] (a track, 0 is the first) and
[[file:PATH]] (a file of the project). They show as links that open it in Studio.`;

/** What the agent is told about where it is, on top of its own instructions. */
export const INSTRUCTIONS = `You are working inside OpenFilm, a desktop app for making videos. Beside this chat the person sees OpenFilm Studio,
the video editor, showing the project in your working directory; it updates live as you save files.

The project is an OpenFilm film: pages with window.film, cut together by film.html. Before you change anything, run
\`openfilm\` with no arguments and read the manual it prints; follow it. Use the \`openfilm\` command on your PATH (this
app's own, on the Studio beside you), not \`npx openfilm\`, whatever a skill says. Studio is already open on this
project: you never need \`openfilm open\` and never open Studio in a browser. Run \`openfilm look\` after each change
to see what you made. Render the MP4 only when the person asks for it; they can also export from Studio. Reply in the
language the person writes in.

${STUDIO_REFERENCES}`;

/**
 * The app's own agent's whole system prompt, in place of Pi's (a coding assistant's, with Pi's own docs): who it is,
 * where it is and how it works with the person (agent-prompt.md: written for it, so not INSTRUCTIONS, which tell
 * another agent to go and read the manual), how the person points at Studio (STUDIO_REFERENCES), and the manual
 * `openfilm` prints, so it starts knowing it. Each thing is said once: what the manual says (`openfilm get`'s
 * services, rendering, the person's changes) and what Pi's tools say of themselves are not said again.
 */
export function ownAgentPrompt() {
  const prompt = readFileSync(new URL('./agent-prompt.md', import.meta.url), 'utf8').trim();
  const manual = readFileSync(join(dirname(require.resolve('openfilm/package.json')), 'MANUAL.md'), 'utf8').replaceAll('npx openfilm', 'openfilm').trim();
  return `${prompt}\n\n## Pointing at Studio\n\n${STUDIO_REFERENCES}\n\n<manual>\n${manual}\n</manual>`;
}

/**
 * The person's own `developer_instructions` in Codex's config.toml (top level), or null: the app's instructions go to
 * Codex in the same place, which would otherwise take the place of theirs, so theirs come first. Read for the basic
 * and literal strings TOML has, on one line or several; anything else (a profile's, a key it cannot read) is left.
 */
export function codexDeveloperInstructions(toml) {
  const top = String(toml ?? '').split(/^\s*\[/m)[0];
  const m = /^[ \t]*developer_instructions[ \t]*=[ \t]*("""|'''|"|')/m.exec(top);
  if (!m) return null;
  const quote = m[1];
  const rest = top.slice(m.index + m[0].length);
  /* a basic string on one line ends at its first quote not escaped; the others at their closing quotes */
  const end = quote === '"' ? (/^(?:[^"\\\n]|\\.)*"/.exec(rest)?.[0].length ?? 0) - 1 : rest.indexOf(quote);
  if (end < 0) return null;
  let text = rest.slice(0, end);
  if (quote.length === 3) text = text.replace(/^\r?\n/, '');
  if (quote.startsWith('"')) {
    text = text.replace(/\\(?:u([0-9a-fA-F]{4})|(.))/g, (_, hex, c) => (hex ? String.fromCharCode(parseInt(hex, 16))
      : ({ n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' })[c] ?? c));
  }
  return text.trim() || null;
}

/** Codex's config.toml: in CODEX_HOME when the person's shell sets it, else ~/.codex. */
function codexConfigText(shell) {
  try { return readFileSync(join(shell.CODEX_HOME || join(homedir(), '.codex'), 'config.toml'), 'utf8'); } catch { return ''; }
}

/** The programs the person chose for their agents (Settings → Agents → Locate, agent-roster.mjs), by agent. */
let chosenPaths = {};
export function setChosenPaths(paths) {
  chosenPaths = Object.fromEntries(Object.entries(paths ?? {}).filter(([id, path]) => isAgentId(id) && typeof path === 'string' && path));
}

const windows = process.platform === 'win32';

/**
 * How the Codex adapter is told where Codex is. On Windows it starts it through cmd.exe, whose own messages (a program
 * not found, access refused) are in the console's code page, which the adapter reads as UTF-8: on a Chinese Windows
 * the reason came out as `������`. There Codex is started through a script that turns the console to UTF-8 first, made
 * on disk (the app's own files are in an archive cmd.exe cannot run from); Codex's own messages are UTF-8 already.
 */
export const CODEX_UTF8_CMD = '@echo off\r\nchcp 65001 >nul\r\n"%OPENFILM_CODEX%" %*\r\n';
export function codexLaunchEnv(/** @type {string} */ path, { win = windows, dir = join(tmpdir(), 'openfilm-codex') } = {}) {
  if (!win) return { CODEX_PATH: path };
  try {
    const script = join(dir, 'codex-utf8.cmd');
    if (!existsSync(script) || readFileSync(script, 'utf8') !== CODEX_UTF8_CMD) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(script, CODEX_UTF8_CMD);
    }
    return { CODEX_PATH: script, OPENFILM_CODEX: path };
  } catch {
    /* no room for the script: Codex as before, its reasons maybe unreadable */
    return { CODEX_PATH: path };
  }
}
/** what the slower search found last (Windows): npm's global folder */
let slowFound = { npmPrefix: null };
let slowCache = null;
const SLOW_FOR_MS = 10 * 60_000;

/**
 * Windows only, and only when an agent is not found the quick way: where npm puts global commands (a prefix of the
 * person's own that is not on their PATH). Asked again after ten minutes, or at once with `fresh`.
 */
function windowsSlowSearch({ fresh = false } = {}) {
  if (!windows) return Promise.resolve(slowFound);
  if (slowCache && !fresh && Date.now() - slowCache.at < SLOW_FOR_MS) return slowCache.value;
  const value = (async () => {
    const env = childEnvironment({ shell: await loginShellEnvironment() });
    const npm = await run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm prefix -g'], 15_000, { env });
    const prefix = npm.ok ? npm.stdout.trim().split(/\r?\n/).pop()?.trim() : null;
    slowFound = { npmPrefix: prefix && isAbsolute(prefix) ? prefix : null };
    return slowFound;
  })().catch(() => slowFound);
  slowCache = { at: Date.now(), value };
  return value;
}

/** Where this agent was looked for, beyond the PATH. */
const searchDirs = () => [...HOME_BIN_CANDIDATES(), ...(slowFound.npmPrefix ? [slowFound.npmPrefix] : [])];

/**
 * The person's program for this agent: the one they chose; else on their login shell's PATH (on Windows, the PATH the
 * registry has now), in the folders installers use, or inside the maker's app. `source`: chosen · path · app.
 */
export function resolveAgentCli(id, { pathDirs = [] } = {}) {
  if (!isAgentId(id)) return null;
  const found = detectAgentInstallation(id, {
    env: { PATH: pathDirs.join(PATH_SEP) },
    pathDirs: searchDirs(),
    chosen: chosenPaths[id] ?? null,
  });
  return found.cli ? { path: found.cli, source: found.source } : null;
}

function run(cmd, args, timeoutMs = 10_000, { cwd, env, options } = {}) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeoutMs, encoding: 'utf8', windowsHide: true, ...options, ...(cwd ? { cwd } : {}), ...(env ? { env } : {}) }, (error, stdout, stderr) => {
        resolve({ ok: !error, out: `${stdout ?? ''}\n${stderr ?? ''}`, stdout: stdout ?? '' });
      });
    } catch (e) {
      /* a program Windows cannot start that way (EINVAL) */
      resolve({ ok: false, out: e instanceof Error ? e.message : String(e), stdout: '' });
    }
  });
}

/* one word of a cmd.exe command line: quoted when it has to be */
const winArg = (a) => (/^[\w.:\\/=+@-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '""')}"`);

/** The app's own Node running a script, through as-node.mjs: what the script starts does not run Electron as Node. */
const AS_NODE = fileURLToPath(new URL('./as-node.mjs', import.meta.url));
/** The words before a script that start it on the app's own Node: as-node.mjs first, the script as the main module. */
const asNode = (/** @type {string} */ script) => ['--import', pathToFileURL(AS_NODE).href, script];

/**
 * How to start a program found for an agent: itself, a script with the app's own Node (an npm install on Windows), or
 * a `.cmd` shim whose target could not be told, through cmd.exe. `options` go to spawn.
 */
function starting(cliPath, args) {
  if (/\.(?:c|m)?js$/i.test(cliPath)) return { cmd: nodeBinary(), args: [...asNode(cliPath), ...args], env: { ELECTRON_RUN_AS_NODE: '1' }, options: {} };
  if (windows && /\.(?:cmd|bat)$/i.test(cliPath)) {
    return { cmd: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${[cliPath, ...args].map(winArg).join(' ')}"`], env: {}, options: { windowsVerbatimArguments: true } };
  }
  return { cmd: cliPath, args, env: {}, options: {} };
}

/** Why a program is not the agent (notTheAgent), in words. */
const NOT_THE_AGENT = Object.freeze({
  app: 'This is an editor or a desktop app, not the agent\'s command-line program.',
  'not-cursor-agent': 'This is not Cursor\'s command-line agent, which installs in a cursor-agent folder.',
});

/**
 * A program the person chose for an agent, tried: it has to start and answer `--version`. `{ ok, version }`, or why
 * not: `code` 'not-a-program' (nothing there this computer can start), 'app' or 'not-cursor-agent' (not the agent:
 * an editor or a desktop app, never started) or 'did-not-start' (with what it said).
 */
export async function checkAgentProgram(id, path) {
  const spec = AGENTS[id];
  if (!spec) return { ok: false, error: `No agent ${id}`, code: 'not-a-program' };
  const cli = chosenProgram(path, { names: AGENT_PROGRAMS[id]?.names ?? [id] });
  if (!cli) return { ok: false, error: 'That is not a program this computer can start.', code: 'not-a-program' };
  const refused = notTheAgent(id, cli, { chosen: path });
  if (refused) return { ok: false, error: NOT_THE_AGENT[refused], code: refused };
  const how = starting(cli, ['--version']);
  const r = await run(how.cmd, how.args, 20_000, { env: childEnvironment({ shell: await loginShellVariables(), extra: how.env }), options: how.options });
  if (!r.ok) return { ok: false, error: r.out.trim().slice(0, 400), code: 'did-not-start' };
  return { ok: true, path: cli, version: r.stdout.trim().split(/\r?\n/)[0] ?? '' };
}

/** Where in WSL (Linux on Windows) one of these programs is, or null: there the app cannot use it. */
async function inWsl(names) {
  const wsl = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wsl.exe');
  if (!existsSync(wsl)) return null;
  const r = await run(wsl, ['-e', 'bash', '-lic', names.map((n) => `command -v ${n}`).join(' || ')], 15_000);
  return r.stdout.replace(/\0/g, '').split(/\r?\n/).map((l) => l.trim()).find((l) => /^\/\S+$/.test(l)) ?? null;
}

/**
 * Why an agent is or is not found, for the person to read or send with an issue: the PATH and where it came from, the
 * program chosen, every folder searched, each file there with the agent's name and what it runs; on Windows, npm's
 * global folder and whether it is in WSL instead. `hint`, when it is not found: chosen-missing (the program chosen is
 * gone) · wsl (only in WSL) · unusable (files with its name, none that starts) · none.
 */
export async function diagnoseAgent(id, { appVersion = '' } = {}) {
  const spec = AGENTS[id];
  if (!spec) return null;
  const shell = await loginShellEnvironment({ maxAgeMs: 0 });
  const slow = await windowsSlowSearch({ fresh: true });
  const pathDirs = shell.PATH.split(PATH_SEP);
  const found = resolveAgentCli(id, { pathDirs });
  const names = AGENT_PROGRAMS[id]?.names ?? [id];
  const report = searchReport(id, { env: { PATH: shell.PATH }, pathDirs: searchDirs() });
  const wsl = windows && !found ? await inWsl(names) : null;
  const chosen = chosenPaths[id] ?? null;
  const hint = found ? null : chosen ? 'chosen-missing' : wsl ? 'wsl' : report.files.length ? 'unusable' : 'none';
  const lines = [
    `OpenFilm ${appVersion}`.trim(),
    `Agent: ${spec.label} (${names.join(', ')})`,
    `System: ${process.platform} ${release()} ${arch()}`,
    `PATH from: ${lastPathSource() ?? 'unknown'}`,
    `Chosen: ${chosen ?? '(none)'}`,
    `Found: ${found ? `${found.path} (${found.source})` : '(not found)'}`,
    ...(windows ? [
      `npm global folder: ${slow.npmPrefix ?? '(unknown)'}`,
      ...(id === 'codex' ? [`Codex the Codex app starts: ${codexAppCopies()[0] ?? '(none)'}`] : []),
      `In WSL: ${found ? '(not checked)' : wsl ?? '(no)'}`,
    ] : []),
    '',
    `Files named ${names.join(', ')}:`,
    ...(report.files.length ? report.files.map((f) => `  ${f.file}${f.runs && f.runs !== f.file ? ` -> ${f.runs}` : ''}${f.refused ? ` (not the agent: ${f.refused})` : f.usable ? '' : ' (cannot be started)'}`) : ['  (none)']),
    '',
    `Folders searched (${report.searched.length}):`,
    ...report.searched.map((d) => `  ${d}`),
  ];
  return { found: found?.path ?? null, program: names[0], hint, text: lines.join('\n') };
}

/**
 * Signed in? Asked of the program itself: true / false, or null when it cannot say (an older version). One that has
 * no command for it is asked by opening a session (acpSignedIn).
 */
export async function agentSignedIn(id, cliPath) {
  return (await agentStatus(id, cliPath)).signedIn;
}

/**
 * Signed in, and as whom, asked of the program: `account` is what it says of its sign-in (Claude Code: email,
 * organization, plan; Codex: how, ChatGPT or an API key), never a key or a token.
 * @returns {Promise<{ signedIn: boolean | null, account: AgentAccount | null, problem?: string }>}
 */
export async function agentStatus(id, cliPath) {
  const spec = AGENTS[id];
  if (!spec || !cliPath) return { signedIn: null, account: null };
  if (!spec.auth) return { signedIn: await acpSignedIn(id), account: null };
  const how = starting(cliPath, spec.auth);
  const r = await run(how.cmd, how.args, 10_000, { env: childEnvironment({ shell: agentShell(id, await loginShellVariables()), extra: how.env }), options: how.options });
  return readAgentStatus(id, r.stdout, r.out);
}

/**
 * @typedef {{ method: 'claude.ai' | 'console' | 'api-key' | 'chatgpt' | 'other', email?: string, org?: string, plan?: string }} AgentAccount
 * What a sign-in status says: Claude Code's JSON, Codex's words. @param {string} id @param {string} stdout @param {string} out
 * `problem`: why it could not say, when that is something the person can fix (its settings it cannot read).
 * @returns {{ signedIn: boolean | null, account: AgentAccount | null, problem?: string }}
 */
export function readAgentStatus(id, stdout, out) {
  if (id === 'claude') {
    try {
      const s = JSON.parse(stdout);
      if (typeof s.loggedIn !== 'boolean') return { signedIn: null, account: null };
      if (!s.loggedIn) return { signedIn: false, account: null };
      const method = s.authMethod === 'claude.ai' ? 'claude.ai' : /api.?key/i.test(String(s.authMethod)) ? 'api-key' : s.authMethod === 'console' ? 'console' : 'other';
      const text = (/** @type {unknown} */ v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
      return { signedIn: true, account: { method, email: text(s.email), org: text(s.orgName), plan: text(s.subscriptionType) } };
    } catch { /* not JSON: read the words */ }
  }
  /* settings it cannot read (a value only a later version knows): it can't say, nor start a session, until fixed */
  const broken = /error loading config(?:uration)?\b[:\s]*(.*)/i.exec(out);
  if (broken) return { signedIn: null, account: null, problem: broken[0].trim().slice(0, 500) };
  if (/\bnot logged in\b/i.test(out)) return { signedIn: false, account: null };
  if (/\blogged in\b/i.test(out)) {
    const method = /chatgpt/i.test(out) ? 'chatgpt' : /api key/i.test(out) ? 'api-key' : 'other';
    return { signedIn: true, account: { method } };
  }
  return { signedIn: null, account: null };
}

/**
 * What a session opened only to ask found, for a while: the roster asks again every few seconds. Signed in is kept
 * longer: each ask starts the agent (CodeBuddy leaves a stale file for each one it is stopped at once), and a sign-out
 * is learnt anyway, from a message refused for it (noteSignedOut) or when the person signs in from Settings.
 */
const asked = new Map();
const ASKED_FOR_MS = 15_000;
const SIGNED_IN_FOR_MS = 10 * 60_000;

/**
 * The folder a session opened only to ask (signed in? its options?) runs in: an empty one of the app's, the same each
 * time. Not the home folder: an agent takes the folder it runs in for a project, keeping a record of it and reading
 * its instructions files.
 */
export function probeFolder() {
  const dir = join(tmpdir(), 'openfilm-agent-probe');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Signed in, for an agent with no command that says: a session opened (in an empty folder of the app's) and closed.
 * One it refuses for its sign-in (ACP's auth_required) is signed out; one that opens, signed in; anything else, null.
 */
export function acpSignedIn(id) {
  const kept = asked.get(id);
  if (kept && Date.now() - kept.at < (kept.signedIn ? SIGNED_IN_FOR_MS : ASKED_FOR_MS)) return kept.answer;
  const answer = (async () => {
    const session = new AgentSession({ agent: id, cwd: probeFolder() });
    try {
      await Promise.race([session.start(), new Promise((_, fail) => setTimeout(() => fail(new Error('timed out')), 30_000))]);
      return true;
    } catch (e) {
      return e?.code === 'sign-in' ? false : null;
    } finally {
      session.close();
    }
  })();
  const entry = { at: Date.now(), answer, signedIn: false };
  asked.set(id, entry);
  void answer.then((yes) => { entry.signedIn = yes === true; });
  return answer;
}

/**
 * A message refused for the agent's sign-in (Kimi opens a session signed out, and says so only when it is spoken to):
 * signed out from now on, until its sign-in is opened.
 */
function noteSignedOut(id) {
  asked.set(id, { at: Infinity, answer: Promise.resolve(false) });
}

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * The AppleScript that has Terminal run one command in a new window, in `cwd` when given (SIGN_IN_DIR: not the home
 * folder a new window opens in).
 */
export function signInScript(cliPath, args, { cwd } = {}) {
  return terminalScript(`${cwd ? `cd ${shq(cwd)} && ` : ''}${[cliPath, ...args].map(shq).join(' ')}`);
}

/** The AppleScript that has Terminal run a command line, as it is, in a new window. */
export function terminalScript(command) {
  return `tell application "Terminal"\nactivate\ndo script "${command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\nend tell`;
}

/**
 * A PowerShell script that names its window and runs one program (`& 'program' 'arg'…`, each in single quotes, as
 * PowerShell quotes): Windows sign-in. With a BOM, so Windows PowerShell reads a path with Chinese in it as UTF-8.
 */
export function powerShellScript(title, cmd, args) {
  return powerShellLine(title, `& ${[cmd, ...args].map(psq).join(' ')}`);
}

/** The same for a command line as it is (an installer's). */
export function powerShellLine(title, line) {
  return `\ufeff$Host.UI.RawUI.WindowTitle = ${psq(title)}\r\n${line}\r\n`;
}
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * How a PowerShell window of its own is opened on Windows for a script file: through cmd.exe's `start`, which gives
 * it a console. Started straight from the app, `detached` makes it a DETACHED_PROCESS with no console at all, and
 * PowerShell quits at once without running the script.
 */
export function powerShellWindowLaunch(file, { comSpec = process.env.ComSpec || 'cmd.exe', systemRoot = process.env.SystemRoot ?? 'C:\\Windows' } = {}) {
  /* a Windows path wherever it is worked out (the tests run on every system) */
  const powershell = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const line = ['start', '""', ...[powershell, '-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', file].map(winArg)].join(' ');
  return { cmd: comSpec, args: ['/d', '/s', '/c', `"${line}"`], options: { windowsVerbatimArguments: true, windowsHide: true } };
}

/**
 * A PowerShell window of its own running a script (a sign-in, an installer), left open so what it says can be read
 * and answered.
 */
async function powerShellWindow(name, script, env) {
  const dir = SIGN_IN_DIR();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, script, 'utf8');
  const how = powerShellWindowLaunch(file);
  const child = spawn(how.cmd, how.args, { cwd: dir, detached: true, stdio: 'ignore', env, ...how.options });
  await new Promise((done, fail) => { child.once('spawn', done); child.once('error', fail); });
  child.unref();
}

/** The person's shell variables as this agent is given them (`fromShell`; all of them, for most). */
export function agentShell(id, shell) {
  return AGENTS[id]?.fromShell?.(shell) ?? shell;
}

/**
 * The ways an agent's adapter offers to sign in in a terminal (ACP terminal auth; Claude Code's: its subscription and
 * Anthropic Console). `[{ id, name, description?, args, env }]`, asked of the adapter as it shakes hands; none for an
 * agent signed in its own way (no `acpSignIn`) or one that cannot be started.
 */
export async function agentSignInMethods(id) {
  const spec = AGENTS[id];
  if (!spec?.acpSignIn) return [];
  const shell = agentShell(id, await loginShellVariables());
  const cli = resolveAgentCli(id, { pathDirs: shell.PATH.split(PATH_SEP) });
  if (!cli) return [];
  const launch = adapterLaunch(id, cli.path);
  const child = spawn(launch.cmd, launch.args, { env: childEnvironment({ shell, extra: launch.env }), stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  child.once('error', () => {});
  try {
    const conn = acp.client({ name: 'openfilm-desktop' }).connect(acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)));
    const init = await Promise.race([
      conn.agent.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: CLIENT_CAPABILITIES, clientInfo: CLIENT_INFO }),
      new Promise((_, fail) => setTimeout(() => fail(new Error('timed out')), 30_000)),
    ]);
    return (init.authMethods ?? []).filter((m) => m?.type === 'terminal' && m.id && m.name).map((m) => ({
      id: String(m.id), name: String(m.name), ...(m.description ? { description: String(m.description) } : {}),
      args: Array.isArray(m.args) ? m.args.map(String) : [], env: m.env && typeof m.env === 'object' ? m.env : {},
    }));
  } catch {
    return [];
  } finally {
    child.kill();
  }
}

/**
 * Where a sign-in in Terminal runs: an empty folder of the app's own. A program whose sign-in is the program itself
 * (CodeBuddy, Qwen Code) first asks whether to trust the folder it is in, and in the home folder a new Terminal window
 * opens in, warns that it may hold sensitive files; trusted once, this folder is not asked about again.
 */
const SIGN_IN_DIR = () => join(tmpdir(), 'openfilm-sign-in');

/**
 * Sign in: Terminal runs the program's own sign-in, which opens the maker's own page. The app touches nothing. One
 * signed in the way its adapter offers (`acpSignIn`, that way's id) runs the adapter with that way's arguments, as ACP
 * has a client do it.
 */
export async function openAgentSignIn(id) {
  const spec = AGENTS[id];
  const pathDirs = (await loginShellEnvironment()).PATH.split(PATH_SEP);
  const cli = spec ? resolveAgentCli(id, { pathDirs }) : null;
  if (!spec || !cli) return { ok: false, error: `${spec?.label ?? id} is not installed on this computer.` };
  if (spec.login === null) return { ok: false, error: `Sign in in ${spec.label} itself.` };
  asked.delete(id);
  let how = null;
  if (spec.acpSignIn) {
    const way = (await agentSignInMethods(id)).find((w) => w.id === spec.acpSignIn);
    if (!way) return { ok: false, error: `${spec.label} did not offer a way to sign in.` };
    const launch = adapterLaunch(id, cli.path);
    how = { cmd: launch.cmd, args: [...launch.args, ...way.args], env: { ...launch.env, ...way.env } };
  }
  /* signed in as it will be started (agentDefaults: CodeBuddy's China edition) */
  const defaults = agentDefaults(id, agentShell(id, await loginShellVariables()));
  if (!how && Object.keys(defaults).length && process.platform !== 'win32') how = { cmd: cli.path, args: spec.login, env: defaults };
  if (process.platform === 'win32') {
    /* a PowerShell window of its own running a script: no command line for cmd.exe to unquote (a path
       with a space in it), and left open so its sign-in can be read and answered (it runs a shim itself) */
    how ??= /\.(?:cmd|bat)$/i.test(cli.path) ? { cmd: cli.path, args: spec.login, env: {} } : starting(cli.path, spec.login);
    how = { ...how, env: { ...defaults, ...how.env } };
    try {
      await powerShellWindow(`${id}.ps1`, powerShellScript(`${spec.label} sign-in`, how.cmd, how.args),
        childEnvironment({ shell: agentShell(id, await loginShellVariables()), extra: how.env }));
      return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }
  const cwd = SIGN_IN_DIR();
  try { mkdirSync(cwd, { recursive: true }); } catch { /* signed in from the home folder, as before */ }
  const where = existsSync(cwd) ? { cwd } : {};
  const script = how
    ? signInScript('/usr/bin/env', [...Object.entries(how.env).map(([k, v]) => `${k}=${v}`), how.cmd, ...how.args], where)
    : signInScript(cli.path, spec.login, where);
  const r = await run('/usr/bin/osascript', ['-e', script], 15_000);
  return r.ok ? { ok: true } : { ok: false, error: r.out.trim() || 'Terminal did not open.' };
}

/**
 * Install an agent with its maker's official installer (installCommand), in a window the person sees: Terminal on a
 * Mac, PowerShell on Windows. The person agreed to that exact command in Settings → Agents first. Whether it worked is
 * learnt by looking for the agent again (agent-roster.mjs).
 */
export async function openAgentInstaller(id) {
  const spec = AGENTS[id];
  const command = spec ? installCommand(id) : null;
  if (!command) return { ok: false, error: `${spec?.label ?? id} has no installer to run here.` };
  if (windows) {
    try {
      await powerShellWindow(`${id}-install.ps1`, powerShellLine(`${spec.label} install`, command), childEnvironment({ shell: await loginShellVariables() }));
      return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }
  const r = await run('/usr/bin/osascript', ['-e', terminalScript(command)], 15_000);
  return r.ok ? { ok: true } : { ok: false, error: r.out.trim() || 'Terminal did not open.' };
}

/**
 * The agents as they are on this machine, for the chat's picker. `setupRequired: 'code-tab'`: the Claude app is
 * here but has not downloaded Claude Code yet (opening its Code tab does). One not found: `app`, the maker's desktop
 * app when it is here without the agent's program; `installer`, the official command that installs it, when it has one.
 */
export async function listAgents() {
  /* looked at as the person comes back from installing one: a PATH from a few seconds ago at most */
  const pathDirs = (await loginShellEnvironment({ maxAgeMs: 10_000 })).PATH.split(PATH_SEP);
  /* the slower search (Windows): waited for, a few seconds at most, when one is not found the quick way. What it finds
     later is there on the next look */
  if (windows) {
    const slow = windowsSlowSearch();
    if (Object.keys(AGENTS).some((id) => !resolveAgentCli(id, { pathDirs }))) {
      await Promise.race([slow, new Promise((done) => setTimeout(done, 3000).unref?.())]);
    }
  }
  return Promise.all(Object.keys(AGENTS).map((id) => agentOnComputer(id, pathDirs)));
}

/** One agent as listAgents has it, asked alone: while the person signs in to it, only it is asked again. */
export async function localAgent(id) {
  if (!isAgentId(id)) throw new Error(`No agent ${id}`);
  return agentOnComputer(id, (await loginShellEnvironment({ maxAgeMs: 10_000 })).PATH.split(PATH_SEP));
}

async function agentOnComputer(id, pathDirs) {
  const cli = resolveAgentCli(id, { pathDirs });
  const { install } = detectAgentInstallation(id);
  const app = cli ? null : desktopApp(id);
  const claudeApp = id === 'claude' && Boolean(app);
  return {
    id,
    label: AGENTS[id].label,
    cli: cli ? { path: cli.path, source: cli.source } : null,
    chosen: chosenPaths[id] ?? null,
    ...(cli ? ownSignIn(AGENTS[id], await agentStatus(id, cli.path)) : { signedIn: null, account: null }),
    install,
    setupRequired: claudeApp ? 'code-tab' : null,
    ...(cli ? {} : { app: claudeApp ? null : app, installer: installCommand(id) }),
  };
}

/** An agent signed in in its own program (`login: null`) is never signed out here: its account, if it says one. */
export function ownSignIn(spec, status) {
  return spec.login === null && status.signedIn === false ? { ...status, signedIn: null } : status;
}

/** The adapter's command line (its package's `bin`), run with Electron's own Node. */
function adapterScript(pkg) {
  const manifest = require.resolve(`${pkg}/package.json`);
  const json = JSON.parse(readFileSync(manifest, 'utf8'));
  const bin = typeof json.bin === 'string' ? json.bin : Object.values(json.bin ?? {})[0];
  return join(dirname(manifest), bin ?? json.main ?? 'index.js');
}

/** How an agent's adapter starts: the app's Node running its script (on Electron, through as-node.mjs), told where the person's program is. */
function adapterLaunch(id, cliPath) {
  const spec = AGENTS[id];
  const node = nodeRuntime();
  return {
    cmd: node.command,
    args: node.env.ELECTRON_RUN_AS_NODE ? asNode(adapterScript(spec.adapter)) : [adapterScript(spec.adapter)],
    env: { ...node.env, ...spec.env(cliPath) },
  };
}

function nodeRuntime() {
  return process.versions.electron
    ? { command: nodeBinary(), env: { ELECTRON_RUN_AS_NODE: '1' } }
    : { command: process.execPath, env: {} };
}

/* ── the agents' own questions to the person (ACP form elicitation) ──
 *
 * Claude Code's AskUserQuestion and Codex's request_user_input both arrive as a form: one field per question (a
 * choice is a `oneOf` of `{ const, title, description }`), maybe beside a field for an answer in the person's own
 * words — Claude's marked `_meta._askUserQuestionCustomAnswer.questionId`, Codex's `_meta.codex.role === 'user_note'`.
 * Read into a list of questions for the chat; the answers are put back in the fields they came from. A form that is
 * not one of these (numbers, booleans, nesting) is declined: the agent takes it as skipped and carries on. */

/** A form, as questions; null when it is not one this chat can show. */
export function formQuestions(params) {
  if (params?.mode !== undefined && params.mode !== 'form') return null;
  const properties = params?.requestedSchema?.properties;
  if (!properties || typeof properties !== 'object') return null;
  const entries = Object.entries(properties);
  const customOf = new Map();
  for (const [id, prop] of entries) {
    const target = prop?._meta?._askUserQuestionCustomAnswer?.questionId
      ?? (prop?._meta?.codex?.role === 'user_note' ? prop._meta.codex.questionId : undefined);
    if (typeof target === 'string' && properties[target]) customOf.set(target, id);
  }
  const custom = new Set(customOf.values());
  const fields = entries.filter(([id]) => !custom.has(id));
  if (fields.length === 0) return null;
  const questions = [];
  for (const [id, prop] of fields) {
    const multi = prop?.type === 'array';
    const choices = multi ? (prop.items?.anyOf ?? prop.items?.oneOf) : (prop?.oneOf ?? prop?.anyOf);
    const options = Array.isArray(choices)
      ? choices.filter((c) => typeof c?.const === 'string').map((c) => ({ label: c.const, ...(c.description ? { description: String(c.description) } : {}) }))
      : Array.isArray(prop?.enum) ? prop.enum.filter((v) => typeof v === 'string').map((label) => ({ label })) : [];
    if (prop?.type !== 'string' && !multi) return null;
    if (multi && options.length === 0) return null;
    /* Codex: the title is the question, the description its heading. Claude: with one question it is in `message`,
       with several in the description; the title is the heading. */
    const codex = Boolean(prop?._meta?.codex);
    const title = typeof prop?.title === 'string' && prop.title ? prop.title : null;
    const description = typeof prop?.description === 'string' && prop.description ? prop.description : null;
    const question = codex
      ? title ?? description ?? params.message ?? id
      : description ?? (fields.length === 1 && params.message ? params.message : title ?? params.message ?? id);
    const header = codex ? description : title;
    questions.push({ id, question: String(question), header: header && header !== question ? header : null, options, customId: customOf.get(id) ?? null, multi });
  }
  return questions;
}

/** The chat's answers, as the form's content. `answers[id]` is `{ label }` (a choice) or `{ text }` (own words). */
export function formContent(questions, answers) {
  const content = {};
  for (const q of questions) {
    const a = answers?.[q.id];
    if (!a) continue;
    if (typeof a.label === 'string' && q.options.some((o) => o.label === a.label)) {
      content[q.id] = q.multi ? [a.label] : a.label;
    } else if (typeof a.text === 'string' && a.text.trim()) {
      const text = a.text.trim();
      if (q.customId) content[q.customId] = text;
      else if (q.options.length === 0) content[q.id] = text;
    }
  }
  return content;
}

/** What the app tells each agent, as it shakes hands, that the chat can do. */
export const CLIENT_CAPABILITIES = {
  fs: { readTextFile: false, writeTextFile: false }, terminal: false, elicitation: { form: {} },
  /* the person signs in in Terminal, the way the agent offers (agentSignInMethods) */
  auth: { terminal: true },
  /* the agent's own warnings (Codex: "Falling back from WebSockets…") come as notices, not as words in its reply */
  session: { notices: {} },
  /* Claude Code's "recommended value" extension: its model and effort lists come without a "Default" row, the
     current value named for what it is */
  _meta: { jetbrains: { air: { version: 1, capabilities: ['recommendedValue'] } } },
};

const CLIENT_INFO = { name: 'openfilm-desktop', title: 'OpenFilm', version: '0.1.0' };

/** How long an agent may wait on its model with nothing coming before the turn is stopped. */
const MODEL_STALL_MS = 5 * 60_000;

/** Where an agent says it is in its turn (CodeBuddy's `codebuddy.ai/agentPhase`: model_requesting, retrying…), or null. */
export function agentPhase(update) {
  const meta = update?._meta;
  if (!meta || typeof meta !== 'object') return null;
  const phase = Object.entries(meta).find(([k]) => /(?:^|[/.])agentPhase$/.test(k))?.[1]?.phase;
  return typeof phase === 'string' ? phase : null;
}

function stallError(label, ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return Object.assign(new Error(`${label} heard nothing back from its model for ${minutes} minute${minutes === 1 ? '' : 's'}: its connection may be blocked. The turn was stopped; send your message again to retry.`), { code: 'agent-stalled' });
}

/** What an agent sends while it answers or works: a turn with none of these said nothing. */
const SPOKE = new Set(['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update', 'plan']);

/** ACP's auth_required: the agent wants its own sign-in first. */
const AUTH_REQUIRED = -32000;

/** The oldest Codex the chat was tried with: an older one may have an app server the adapter can't talk to. */
export const CODEX_TESTED = '0.132.0';

/**
 * A Codex that did not start, older than the ones tried: its reason, and that updating it is the likely fix (an old
 * one's app server goes away as the session opens, "connection got disposed", and says nothing more).
 * @param {string} agent @param {string | undefined} path @param {any} e @param {(file: string) => string | null} [versionOf]
 */
export function codexTooOld(agent, path, e, versionOf = codexVersion) {
  if (agent !== 'codex' || !path || e?.code === 'sign-in' || e?.code === 'not-installed') return e;
  const version = versionOf(path);
  if (!version || !laterVersion(CODEX_TESTED, version)) return e;
  const why = e instanceof Error ? e.message : String(e);
  return Object.assign(new Error(`Codex ${version} is older than OpenFilm needs (${CODEX_TESTED} or later): update Codex, then try again. ${why}`.trim()), { code: 'outdated' });
}

/** ACP's internal error: what an agent's own failures come as. */
const INTERNAL_ERROR = -32603;

/**
 * A session refused for the agent's sign-in, said so (`code: 'sign-in'`). One refused in ACP's sign-in terms for the
 * person's plan instead (Kimi 2.2: "Authentication required: 403 Your current subscription does not have access to Kimi
 * Code…") is the agent's own words (`code: 'agent-error'`): signing in again would not help, and the agent is not taken
 * for signed out. Any other error with its reason (errorCause).
 */
export function signInError(label, e, { own = false } = {}) {
  if (e?.code === AUTH_REQUIRED) {
    const plan = planProblem(e?.message);
    if (plan) return Object.assign(new Error(`${label}: ${plan}`), { code: 'agent-error' });
    return Object.assign(new Error(`${label} is not signed in. ${own ? `Sign in in ${label}, then try again.` : 'Sign in under Settings → Agents.'}`), { code: 'sign-in' });
  }
  return errorCause(e);
}

/**
 * An error the agent sends as just "Internal error" with its reason: the reason is in its `data`, as a string or its
 * `message` or `details` (the ACP SDK puts a thrown Error's text there; Codex its settings it cannot read). The error
 * it came as stays its `cause`.
 */
export function errorCause(e) {
  if (e?.code !== INTERNAL_ERROR || String(e.message ?? '').trim() !== 'Internal error') return e;
  const data = e.data;
  const why = typeof data === 'string' ? data : [data?.message, data?.details].find((v) => typeof v === 'string') ?? '';
  return why.trim() ? Object.assign(new Error(why.trim(), { cause: e }), { code: e.code }) : e;
}

/**
 * The model service's refusal, when that is what a reply's words are: Codex's adapter sends an error from OpenAI as
 * the reply (`{"type":"error","status":400,"error":{"message":…}}`), and the turn ends as if answered. Its message
 * and status, or null for anything else.
 * @returns {{ message: string, status: number | null } | null}
 */
export function codexServiceError(update) {
  if (update?.sessionUpdate !== 'agent_message_chunk' || update.content?.type !== 'text') return null;
  const text = String(update.content.text ?? '').trim();
  if (!text.startsWith('{"type":"error"')) return null;
  try {
    const said = JSON.parse(text);
    const message = typeof said?.error?.message === 'string' ? said.error.message.trim() : '';
    return said?.type === 'error' && message ? { message, status: Number.isInteger(said.status) ? said.status : null } : null;
  } catch {
    return null;
  }
}

/**
 * The turn's error for a refusal. A model "not supported when using Codex" is one this Codex is too old for (Codex
 * lists models it cannot use yet): updating it, or another model, is the fix.
 * @param {{ message: string }} refused @param {string | undefined} path @param {(file: string) => string | null} [versionOf]
 */
export function codexRefusal(refused, path, versionOf = codexVersion) {
  if (!/not supported when using Codex/i.test(refused.message)) return new Error(refused.message);
  const version = path ? versionOf(path) : null;
  return Object.assign(new Error(`${refused.message} Update Codex${version ? ` (this one is ${version})` : ''}, or choose another model.`), { code: 'outdated' });
}

/**
 * Codex's reconnects and retries ("Reconnecting... 2/5", "waiting for network"), and an error of a turn not running
 * now: its adapter puts them in a session_info_update's `_meta.codex.error`, which says nothing in the chat. As the
 * notice the chat shows (its words, then what it adds), or null.
 */
export function codexNotice(update) {
  const error = update?.sessionUpdate === 'session_info_update' ? update._meta?.codex?.error : null;
  const title = typeof error?.message === 'string' ? error.message.trim() : '';
  if (!title) return null;
  const details = typeof error.additionalDetails === 'string' ? error.additionalDetails.trim() : '';
  return { sessionUpdate: 'notice', severity: error.willRetry ? 'warning' : 'error', title, ...(details ? { description: details } : {}) };
}

/** where each step of a session is, in words */
const STEP_WORDS = Object.freeze({
  start: 'as it started', initialize: 'as it started', authenticate: 'while signing in',
  'session/new': 'while opening the session', 'session/prompt': 'while answering',
});

/** what an agent says when it says nothing: an error with no reason, or its process gone mid-request */
const SAYS_NOTHING = /^(?:internal error|internal server error|unknown error|(?:acp )?connection closed|pending response rejected since connection got disposed)\.?$/i;

/* stderr lines that never say why: a stack frame, a caret, a brace, a property of the error printed, Node's banner
   and its "Emitted 'error' event" */
const NOISE = /^(?:at\s|\^+$|[{}]$|[a-z]+: [-'\w]+,?$|Node\.js v|node:|throw\s|Emitted '\w+' event)/;
const REASON = /error|fail|cannot|can't|refused|denied|not found|panic|timed? ?out|unable/i;

/** What the last of an agent's stderr says: its last lines that name an error, else its last lines; at most 600 characters. */
export function stderrReason(stderr = '') {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !NOISE.test(l));
  const reasons = lines.filter((l) => REASON.test(l));
  return [...new Set((reasons.length ? reasons : lines).slice(-3))].join(' | ').slice(-600);
}

/**
 * An agent's failure as it is: what it said when it said why; else the step it stopped at, how its process ended and
 * the last it wrote to stderr; with neither, that an agent which cannot reach its service stops like this.
 * @param {any} e @param {{ label: string, step?: string | null, stderr?: string, exited?: { code: number | null } | null }} at
 */
export function explainFailure(e, { label, step = null, stderr = '', exited = null }) {
  const said = (e instanceof Error ? e.message : String(e ?? '')).trim();
  const bare = !said || SAYS_NOTHING.test(said);
  if (!bare && !exited) return e;
  const tail = stderrReason(stderr);
  const where = step && STEP_WORDS[step] ? ` ${STEP_WORDS[step]}` : '';
  const ended = exited ? ` Its process ended${exited.code == null ? '' : ` with code ${exited.code}`}.` : '';
  const message = [
    bare ? `${label} stopped${where} without saying why.` : said,
    ended.trim(),
    tail ? `It last wrote: ${tail}` : bare ? 'If it cannot reach its service, check the network or proxy, then try again.' : '',
  ].filter(Boolean).join(' ');
  return Object.assign(new Error(message, { cause: e }), { ...(e?.code !== undefined ? { code: e.code } : {}), ...(step ? { step } : {}) });
}

/** What an agent's sign-in refusal says when it is about the person's plan, not their sign-in, or null. */
export function planProblem(message) {
  const text = String(message ?? '').replace(/^\s*Authentication required[:.]?\s*/i, '').trim();
  return /\b(?:403|subscriptions?|plans?|upgrade|quota|billing|credits?|balance)\b/i.test(text) ? text.slice(0, 1000) : null;
}

/**
 * Why a turn ended, as the agent says it beside the turn's result (`_meta`, under a key ending in `errorMessage`:
 * CodeBuddy's `codebuddy.ai/errorMessage`, itself JSON with a `message`), or null.
 */
export function turnError(result) {
  const meta = result?._meta;
  if (!meta || typeof meta !== 'object') return null;
  const raw = Object.entries(meta).find(([k, v]) => /(?:^|[/.])errorMessage$/.test(k) && typeof v === 'string' && v.trim())?.[1];
  if (!raw) return null;
  let text = raw.trim();
  try { const said = JSON.parse(text); if (typeof said?.message === 'string' && said.message.trim()) text = said.message.trim(); } catch { /* plain words */ }
  return text.slice(0, 1000);
}

/** The answer that lets it go ahead (for good, where it offers that), or null when none does. */
export function allowOption(params) {
  const options = params?.options ?? [];
  return (options.find((o) => o.kind === 'allow_always') ?? options.find((o) => o.kind === 'allow_once'))?.optionId ?? null;
}

/** The older session lists (`models`, `modes`) as the config options the chat's menu reads. */
export function legacyOptions(session) {
  const out = [];
  if (session.models?.availableModels?.length) {
    out.push({ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: session.models.currentModelId,
      options: session.models.availableModels.map((m) => ({ value: m.modelId, name: m.name, ...(m.description ? { description: m.description } : {}) })) });
  }
  if (session.modes?.availableModes?.length) {
    out.push({ id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: session.modes.currentModeId,
      options: session.modes.availableModes.map((m) => ({ value: m.id, name: m.name, ...(m.description ? { description: m.description } : {}) })) });
  }
  return out;
}

/**
 * Config options with each choice once: an agent may list the same value twice (GitHub Copilot's model list has
 * "Auto" twice), which the menu would show twice, both ticked. The first of each is kept; anything else as it was.
 * Choices in groups (DeepSeek Harness groups its models by where they run: its API, the person's DeepSeek account)
 * are listed one after another, each named with its group's name.
 */
export function distinctOptions(configOptions) {
  if (!Array.isArray(configOptions)) return configOptions;
  return configOptions.map((o) => {
    if (!Array.isArray(o?.options)) return o;
    const seen = new Set();
    const choices = o.options.flatMap((c) => (Array.isArray(c?.options) && !('value' in c)
      ? c.options.map((g) => (g && typeof c.name === 'string' && c.name ? { ...g, name: `${c.name} · ${g.name}` } : g))
      : [c]));
    return { ...o, options: choices.filter((c) => !c || !('value' in c) || (!seen.has(c.value) && seen.add(c.value))) };
  });
}

/**
 * One conversation: one ACP session on one adapter process.
 *
 * `onUpdate(update)` hears each session/update as it comes; `onPermission(params)` answers an optionId, or null to
 * refuse (with no handler everything is refused: permission is never given for the person).
 */
export class AgentSession {
  /**
   * `harness` (for 'byok'): agent-roster.mjs's `harness(id)`, Pi's folder, the person's models (each its own service)
   * and the one it starts on.
   * @param {{ agent: string, cwd: string, resume?: string | null, binDir?: string | null, fallbackDir?: string | null,
   *           harness?: any,
   *           env?: Record<string, string>, logDir?: string | null,
   *           skills?: { dataDir: string, mine?: string, allowed?: string[], mcpAllowed?: string[] } | null,
   *           onUpdate?: (update: any) => void, onPermission?: (params: any) => Promise<string | null>,
   *           onQuestion?: (ask: { message: string, toolCallId: string | null, questions: any[] }) => Promise<Record<string, { label?: string, text?: string }> | null>,
   *           onExit?: (info: { code: number | null, stderr: string }) => void,
   *           onSend?: (sent: { prompt: any[], _meta?: any }) => void, stallMs?: number }} opts
   * `onSend` hears each message as it goes to the agent, whole (the app's words before the first one's, for an agent
   * told them there); `opened`, once started, says what it was started and opened with.
   * `skills`: the session has its maker's skills and MCP servers, OpenFilm's skills, and of the person's own only those
   * let in (`allowed`, `mcpAllowed`), each agent told by its own switch (agent-skills.mjs); `opened.skills` says how.
   * `stallMs`: how long the agent may wait on its model with nothing coming (MODEL_STALL_MS) before the turn is stopped.
   * `logDir` (Developer mode): an agent whose own record lacks what its model got is started with its own logging
   * switch, writing under this folder (agent-logs.mjs); `opened.log` says where.
   */
  constructor(opts) {
    if (!isChatAgent(opts.agent)) throw new Error(`Unknown agent: ${String(opts.agent)}`);
    if (HARNESS_AGENTS.includes(opts.agent) && !opts.harness) throw Object.assign(new Error('Connect this agent in Settings → Agents first.'), { code: 'not-ready' });
    this.opts = opts;
    /* the app's own agent runs Pi (pi-agent.mjs), the person's their own program through its adapter */
    this.spec = HARNESS_AGENTS.includes(opts.agent) ? { label: 'Own key', env: () => ({}) } : AGENTS[opts.agent];
    this.sessionId = null;
    this.info = null;
    this.stderr = '';
    /** while an old session is loaded its history is replayed: the chat already has it */
    this.replaying = false;
  }

  /**
   * Start the adapter, shake hands, open (or resume) the session. The agent gets all the person's login shell sets
   * (their keys, gateways, tokens; Claude Code only its PATH and the like, agentShell), as in their terminal, and the app's
   * `openfilm` first on its PATH; the app's ffmpeg (`fallbackDir`) last, for a computer that has none of its own.
   */
  async start() {
    try {
      const info = await this.open();
      this.step = null;
      return info;
    } catch (e) {
      throw await this.explain(codexTooOld(this.opts.agent, this.cli?.path, e));
    }
  }

  /**
   * An error with what the agent said, or, when it said nothing, where it stopped and what it last wrote. Its process
   * may be ending as the request fails: how it ended is waited for, a second at most.
   */
  async explain(e) {
    if (this.child && !this.exited && this.child.exitCode === null && this.child.signalCode === null) {
      await new Promise((done) => { this.child.once('exit', done); setTimeout(done, 1000).unref?.(); });
    }
    return explainFailure(e, { label: this.spec.label, step: this.step, stderr: this.stderr, exited: this.exited ?? null });
  }

  /**
   * What a failure needs said for the turn log: the step it stopped at, the program, its adapter, how its process
   * ended, all it wrote to stderr, and where the agent keeps its own logs.
   */
  failure() {
    return {
      step: this.step ?? null,
      program: this.cli?.path ?? null,
      adapter: this.spec.adapter ?? null,
      exit: this.exited ?? null,
      stderr: this.stderr.slice(-8000),
      ...(this.ownLogs ? { ownLogs: this.ownLogs } : {}),
    };
  }

  async open() {
    this.step = 'start';
    const shell = agentShell(this.opts.agent, await loginShellVariables({ staleOk: true }));
    const harness = this.opts.harness ?? null;
    const cli = harness ? null : resolveAgentCli(this.opts.agent, { pathDirs: shell.PATH.split(PATH_SEP) });
    if (!harness && !cli) throw Object.assign(new Error(`${this.spec.label} is not installed on this computer.`), { code: 'not-installed' });
    this.cli = cli;
    /* one whose ACP sign-in takes up its own (Cursor's `authenticate`) opens the maker's sign-in page in the browser and
       waits there when it is signed out: its own status says so first, and the person signs in from Settings */
    if (cli && this.spec.authenticate && this.spec.auth && (await agentStatus(this.opts.agent, cli.path)).signedIn === false) {
      throw signInError(this.spec.label, { code: AUTH_REQUIRED });
    }
    const node = nodeRuntime();
    const path = [this.opts.binDir, shell.PATH, this.opts.fallbackDir].filter(Boolean).join(PATH_SEP);
    const instructions = INSTRUCTIONS;
    /* the app's own agent: what Pi runs with (its whole system prompt is ours), and the web search of `openfilm get`
       (OPENFILM_GET_WEB lists it) */
    const own = !harness ? {} : {
      ...harness.env,
      OPENFILM_GET_WEB: '1',
    };
    /* its skills and MCP servers: its maker's, OpenFilm's skills, and the person's own only those let in (agent-skills.mjs) */
    const skills = this.opts.skills
      ? await sessionSkills(this.opts.agent, { cwd: this.opts.cwd, env: shell, ...this.opts.skills }).catch(() => null) : null;
    if (harness) own.OPENFILM_PI = JSON.stringify({ agentDir: harness.home, models: harness.models, model: harness.model, systemPrompt: ownAgentPrompt(), skills: skills?.piSkills ?? null });
    /* Developer mode: the agent's own logging switch, so the turn log has what its model got; none when the person
       set its telemetry themselves (agent-logs.mjs) */
    this.logging = this.opts.logDir && cli && !this.spec.adapter
      ? await logSwitches(this.opts.agent, { base: this.opts.logDir, shell, cwd: this.opts.cwd }).catch(() => null) : null;
    /* an agent that speaks ACP itself: its own program, started as the registry starts it */
    const native = cli && !this.spec.adapter ? starting(cli.path, [...this.spec.args, ...(this.logging?.args ?? []), ...(skills?.args ?? [])]) : null;
    const extra = { ...agentDefaults(this.opts.agent, shell), ...this.opts.env, ...(native ? native.env : node.env), ...(cli && this.spec.env ? this.spec.env(cli.path) : {}), ...own, ...skills?.env, ...this.logging?.env };
    /* OpenCode's inline configuration carries both its skills and, in Developer mode, its logging */
    if (skills?.env?.OPENCODE_CONFIG_CONTENT && this.logging?.env?.OPENCODE_CONFIG_CONTENT) {
      extra.OPENCODE_CONFIG_CONTENT = JSON.stringify(mergeConfig(JSON.parse(skills.env.OPENCODE_CONFIG_CONTENT), JSON.parse(this.logging.env.OPENCODE_CONFIG_CONTENT)));
    }
    const env = childEnvironment({ shell: { ...shell, PATH: path }, extra });
    const claude = this.spec.adapter === AGENTS.claude.adapter;
    if (this.spec.adapter === AGENTS.codex.adapter) {
      this.ownLogs = shell.CODEX_HOME || join(homedir(), '.codex');
      const theirs = codexDeveloperInstructions(codexConfigText(shell));
      env.CODEX_CONFIG = JSON.stringify(mergeConfig({ developer_instructions: theirs ? `${theirs}\n\n${instructions}` : instructions }, skills?.codexConfig ?? {}));
    }
    /* the others have no place for it: the session's first message carries it */
    this.instructions = harness || this.spec.systemPrompt ? null : instructions;

    const script = harness ? fileURLToPath(new URL('./pi-agent.mjs', import.meta.url)) : native ? null : adapterScript(this.spec.adapter);
    this.child = native
      ? spawn(native.cmd, native.args, { ...native.options, cwd: this.opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      : spawn(node.command, node.env.ELECTRON_RUN_AS_NODE ? asNode(script) : [script], { cwd: this.opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child.stderr.on('data', (d) => { this.stderr = (this.stderr + String(d)).slice(-16_000); });
    LIVE.add(this);
    this.child.once('exit', (code) => { LIVE.delete(this); this.exited = { code }; this.opts.onExit?.({ code, stderr: this.stderr }); });
    this.child.once('error', () => {});

    const stream = acp.ndJsonStream(Writable.toWeb(this.child.stdin), Readable.toWeb(this.child.stdout));
    this.conn = acp.client({ name: 'openfilm-desktop' })
      .onRequest(acp.methods.client.session.requestPermission, async (ctx) => {
        const optionId = (this.spec.approve ? allowOption(ctx.params) : null)
          ?? (this.opts.onPermission ? await this.opts.onPermission(ctx.params) : null);
        return optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } };
      })
      .onRequest(acp.methods.client.elicitation.create, async (ctx) => {
        const questions = formQuestions(ctx.params);
        if (!questions || !this.opts.onQuestion) return { action: 'decline' };
        const answers = await this.opts.onQuestion({ message: ctx.params.message ?? '', toolCallId: ctx.params.toolCallId ?? null, questions });
        return answers ? { action: 'accept', content: formContent(questions, answers) } : { action: 'decline' };
      })
      .onNotification(acp.methods.client.session.update, (ctx) => {
        const update = withToolKind(ctx.params.update, this.spec.toolKinds);
        if (SPOKE.has(update?.sessionUpdate)) this.spoke = true;
        this.heard = Date.now();
        const phase = agentPhase(update);
        if (phase) this.phase = phase;
        if (this.replaying) return;
        /* Codex's adapter sends the model service's refusal as the reply's words: kept to fail the turn with */
        const codex = this.spec.adapter === AGENTS.codex.adapter;
        const refused = codex ? codexServiceError(update) : null;
        if (refused) { this.refused = refused; return; }
        this.opts.onUpdate?.(update?.configOptions ? { ...update, configOptions: distinctOptions(update.configOptions) } : update);
        /* and its reconnects and retries, which it says where the chat does not look, as notices (once each) */
        const notice = codex ? codexNotice(update) : null;
        if (notice && notice.title !== this.lastNotice) {
          this.lastNotice = notice.title;
          this.opts.onUpdate?.(notice);
        }
      })
      .connect(stream);

    this.step = 'initialize';
    const init = await this.conn.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: CLIENT_CAPABILITIES,
      clientInfo: CLIENT_INFO,
    }).catch((e) => { throw signInError(this.spec.label, e, { own: this.spec.login === null }); });

    const params = {
      cwd: this.opts.cwd,
      mcpServers: [],
      ...(skills?.additionalDirectories ? { additionalDirectories: skills.additionalDirectories } : {}),
      ...(claude ? { _meta: { systemPrompt: { append: instructions }, ...(skills?.claude ? { claudeCode: { options: skills.claude } } : {}) } } : {}),
    };
    /* the program's own sign-in, taken up (Cursor asks for this before any session) */
    if (this.spec.authenticate && (init.authMethods ?? []).some((m) => m.id === this.spec.authenticate)) {
      this.step = 'authenticate';
      await this.conn.agent.request(acp.methods.agent.authenticate, { methodId: this.spec.authenticate }).catch((e) => { throw signInError(this.spec.label, e, { own: this.spec.login === null }); });
    }

    this.step = 'session/new';
    let session = null;
    const resume = this.opts.resume;
    const caps = init.agentCapabilities ?? {};
    if (resume && caps.sessionCapabilities?.resume) {
      session = await this.conn.agent.request(acp.methods.agent.session.resume, { ...params, sessionId: resume }).then((r) => ({ ...r, sessionId: resume }), () => null);
    } else if (resume && caps.loadSession) {
      this.replaying = true;
      session = await this.conn.agent.request(acp.methods.agent.session.load, { ...params, sessionId: resume }).then((r) => ({ ...r, sessionId: resume }), () => null);
      this.replaying = false;
    }
    const resumed = Boolean(session);
    session ??= await this.conn.agent.request(acp.methods.agent.session.new, params).catch((e) => { throw signInError(this.spec.label, e, { own: this.spec.login === null }); });
    this.sessionId = session.sessionId;
    /* an agent on the protocol's older model and mode lists: the same choices, as config options */
    this.legacy = !session.configOptions && Boolean(session.models || session.modes);
    if (resumed) this.instructions = null;
    this.info = {
      sessionId: session.sessionId,
      resumed,
      agentInfo: init.agentInfo ?? null,
      models: session.models ?? null,
      modes: session.modes ?? null,
      configOptions: distinctOptions(session.configOptions ?? (this.legacy ? legacyOptions(session) : null)),
      /* what a prompt may carry besides text (pictures, for one): the agent says so as it shakes hands */
      promptCapabilities: caps.promptCapabilities ?? null,
      /* a message sent while it works joins the turn it is in (steer), as in its own chat */
      steering: init._meta?.steering?.supported === true,
    };
    this.noteModel(this.info.configOptions);
    /* what the agent was started and opened with, for the turn log: every word the app adds to its own, and the
       variables the app set (a key's value never: it reads "(hidden)") */
    const secret = new Set(Object.keys(harness?.env ?? {}));
    this.opened = {
      program: harness ? 'pi' : cli.path,
      /* the command line the agent's process was started with: its own program, or the app's Node running its adapter (or Pi) */
      command: native ? [native.cmd, ...native.args] : [node.command, ...(node.env.ELECTRON_RUN_AS_NODE ? asNode(script) : [script])],
      adapter: this.spec.adapter ?? null,
      env: Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, secret.has(k) || /KEY|TOKEN|SECRET|PASSWORD/i.test(k) ? '(hidden)' : k === 'OPENFILM_PI' ? JSON.parse(v) : v])),
      ...(env.CODEX_CONFIG ? { codexConfig: JSON.parse(env.CODEX_CONFIG) } : {}),
      path: { first: this.opts.binDir ?? null, last: this.opts.fallbackDir ?? null },
      fromShell: this.spec.fromShell ? Object.keys(shell).sort() : 'all',
      initialize: { request: { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: CLIENT_CAPABILITIES, clientInfo: CLIENT_INFO }, response: init },
      session: { method: !resumed ? 'session/new' : caps.sessionCapabilities?.resume ? 'session/resume' : 'session/load', params: { ...params, ...(resumed ? { sessionId: resume } : {}) } },
      firstMessage: this.instructions,
      log: this.logging?.log ?? null,
      skills: skills?.log ?? null,
    };
    return this.info;
  }

  /**
   * Send a message; resolves with the stopReason when the turn ends. Everything on the way comes from onUpdate.
   * `turnId`: the app's own agent writes each request to its model in that turn's log (chat-store.mjs).
   */
  async prompt(blocks, { turnId } = {}) {
    if (!this.sessionId) throw new Error('The session has not started.');
    const meta = this.opts.harness && turnId ? { _meta: { openfilm: { turnId, cwd: this.opts.cwd } } } : {};
    const told = this.instructions ? [{ type: 'text', text: this.instructions }] : [];
    this.instructions = null;
    /* the message exactly as the agent gets it, for the turn log */
    this.opts.onSend?.({ prompt: [...told, ...blocks], ...meta });
    this.refused = null;
    this.lastNotice = null;
    this.step = 'session/prompt';
    this.spoke = false;
    this.heard = Date.now();
    this.phase = null;
    /* a model asked and never answering (CodeBuddy, its connection hung): the turn is stopped for the person */
    let stalled = false;
    const stallMs = this.opts.stallMs ?? MODEL_STALL_MS;
    let giveUp = () => {};
    const gaveUp = new Promise((_, fail) => { giveUp = fail; });
    gaveUp.catch(() => {});
    const watch = setInterval(() => {
      if (stalled || this.phase !== 'model_requesting' || Date.now() - this.heard < stallMs) return;
      stalled = true;
      void this.cancel();
      /* one that does not stop when asked is left: the chat is not kept waiting on it */
      setTimeout(() => giveUp(stallError(this.spec.label, stallMs)), 10_000).unref?.();
    }, Math.min(15_000, Math.max(50, stallMs / 4)));
    watch.unref?.();
    const asking = this.conn.agent.request(acp.methods.agent.session.prompt, { sessionId: this.sessionId, prompt: [...told, ...blocks], ...meta })
      .catch(async (e) => {
        /* the app's own agent: a service with no balance left is said the same for every service, with its page */
        const own = this.opts.harness?.models?.find((m) => m.id === this.modelNow) ?? this.opts.harness?.models?.[0];
        const broke = own ? outOfBalance({ id: own.name, baseUrl: own.baseUrl }, e) : null;
        if (broke) throw broke;
        if (!isAgentId(this.opts.agent)) throw errorCause(e);
        const said = signInError(this.spec.label, e, { own: this.spec.login === null });
        if (said.code === 'sign-in') noteSignedOut(this.opts.agent);
        throw await this.explain(said);
      });
    const r = await Promise.race([asking, gaveUp]).finally(() => clearInterval(watch));
    if (stalled && r.stopReason === 'cancelled') throw stallError(this.spec.label, stallMs);
    if (this.refused) throw codexRefusal(this.refused, this.cli?.path);
    /* a turn the agent gave up on with its reason beside it, not in its reply (CodeBuddy: a network error): said as
       the turn's error, or the chat would show an empty reply */
    const why = r.stopReason === 'refusal' ? turnError(r) : null;
    if (why) throw Object.assign(new Error(why), { code: 'agent-error' });
    /* a turn ended with nothing said or done (Kimi 0.27 so ends one its plan does not cover): said, not an empty reply */
    if (r.stopReason === 'end_turn' && !this.spoke && isAgentId(this.opts.agent)) {
      throw Object.assign(new Error(`${this.spec.label} ended its turn without replying. If it keeps doing so, try ${this.spec.label} in its own terminal: it may need an update, or a plan that covers it.`), { code: 'empty-turn' });
    }
    this.step = null;
    return r.stopReason;
  }

  /**
   * A message sent while a turn runs, into that turn (ACP's steering extension, `_session/steering`): the agent reads
   * it at its next step, as when the person types while it works in its own chat. → 'injected' when it joined the
   * turn; anything else ('startedNewTurn', 'promptRequired', 'failed') when it did not.
   */
  async steer(blocks) {
    if (!this.sessionId || !this.info?.steering) return 'failed';
    const r = await this.conn.agent.request('_session/steering', { sessionId: this.sessionId, prompt: blocks }).catch(() => null);
    return typeof r?.outcome === 'string' ? r.outcome : 'failed';
  }

  /** Stop this turn (it ends with stopReason 'cancelled'). */
  async cancel() {
    if (this.sessionId) await this.conn.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.sessionId }).catch(() => {});
  }

  /** An option the adapter reports in configOptions: the model, the reasoning effort, the mode. */
  async setConfigOption(configId, value) {
    if (this.legacy && configId === 'mode') return this.setMode(value);
    if (this.legacy && configId === 'model') return this.conn.agent.request('session/set_model', { sessionId: this.sessionId, modelId: value });
    const r = await this.conn.agent.request(acp.methods.agent.session.setConfigOption, { sessionId: this.sessionId, configId, value });
    this.noteModel(r?.configOptions);
    return r?.configOptions ? { ...r, configOptions: distinctOptions(r.configOptions) } : r;
  }

  /** The model the session is on (its `model` option's value): the app's own agent names the service a failure was on by it. */
  noteModel(configOptions) {
    const model = (configOptions ?? []).find((o) => o?.id === 'model');
    if (model) this.modelNow = model.currentValue;
  }

  async setMode(modeId) {
    return this.conn.agent.request(acp.methods.agent.session.setMode, { sessionId: this.sessionId, modeId });
  }

  close() {
    LIVE.delete(this);
    try { this.conn?.close(); } catch { /* gone already */ }
    if (this.child && this.child.exitCode === null) this.child.kill('SIGTERM');
    this.logging?.close();
  }
}

/** Every agent process this app started and has not closed: a chat's, or one opened only to ask. */
const LIVE = new Set();

/**
 * Close every agent process, a session opened only to ask included (the chat's own are closed by their owner): the
 * app is quitting, and one left would outlive it.
 */
export function closeEverySession() {
  for (const session of [...LIVE]) session.close();
}
/* and as the process ends without quitting the usual way: none outlives it */
process.once('exit', closeEverySession);
