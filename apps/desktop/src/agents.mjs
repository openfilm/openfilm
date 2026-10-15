/**
 * The chat's agents: the person's own Claude Code, Codex, Gemini CLI, GitHub Copilot, Cursor, OpenCode, CodeBuddy,
 * Qwen Code or Kimi, driven over the Agent Client Protocol (ACP): a child process speaking JSON-RPC over stdin/stdout.
 * The app is the client: initialize, session/new (or session/resume for a conversation from before), session/prompt;
 * session/update draws the chat, and session/request_permission asks the person in the chat.
 *
 * Claude Code and Codex speak it through their makers' official adapters (`@agentclientprotocol/claude-agent-acp`,
 * `@agentclientprotocol/codex-acp`, Apache-2.0), which the app carries; the others speak it themselves (`gemini --acp`,
 * `opencode acp`, …), as the ACP registry (agentclientprotocol.com/registry) starts them.
 *
 * Why the person's own installation, never one bundled with the app:
 *   · size: each official program is 200–330 MB; the adapters are a few MB and take its path
 *     (`CLAUDE_CODE_EXECUTABLE`, `CODEX_PATH`);
 *   · terms: Anthropic lets people use their own subscription in the unmodified Claude Code, and does not let anyone
 *     else hold or pass on their credentials. The app runs their own program, sign-in is its own (`claude auth login`,
 *     `codex login`, in Terminal, or a command window on Windows), and the app never sees a token.
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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, homedir, release, tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import * as acp from '@agentclientprotocol/sdk';
import { PATH_SEP, childEnvironment, lastPathSource, loginShellEnvironment, loginShellVariables, shellSubset } from './environment.mjs';
import { AGENT_PROGRAMS, HOME_BIN_CANDIDATES, chosenProgram, consoleProgram, detectAgentInstallation, searchReport } from './agent-installation.mjs';
import { nodeBinary } from './node-runtime.mjs';
import { outOfBalance } from './pi-config.mjs';

const require = createRequire(import.meta.url);

/**
 * Each agent: through an adapter the app carries (`adapter`, told where the person's program is by `env`), or the
 * person's program itself with `args`. Signed in? `auth` asks the program (its words say); without it, a session is
 * opened and closed (acpSignedIn). `login` is its own sign-in, run in Terminal (none: the program itself, which asks
 * for one on its first run). `authenticate`: the ACP auth method that takes up the program's own sign-in.
 * `approve`: it asks permission for what the app lets every agent do (see the chat's AGENT_FORCED_PREFS), so the app
 * answers yes itself. The others are told the app's INSTRUCTIONS in the first message of a session (`systemPrompt`:
 * how Claude Code and Codex are told them instead).
 */
export const AGENTS = Object.freeze({
  claude: {
    label: 'Claude Code',
    adapter: '@agentclientprotocol/claude-agent-acp',
    env: (path) => ({ CLAUDE_CODE_EXECUTABLE: path }),
    auth: ['auth', 'status'],
    login: ['auth', 'login'],
    /* of the shell only its PATH, proxies, config folder and locale, as 0.1.5 had it and ChatCut has it: a key or
       gateway set there (ANTHROPIC_*) would take the place of the person's Claude subscription */
    fromShell: shellSubset,
    /* signed in to the person's Claude subscription, the way its adapter offers it (ACP terminal auth), in Terminal */
    acpSignIn: 'claude-ai-login',
    systemPrompt: true,
  },
  codex: {
    label: 'Codex',
    adapter: '@agentclientprotocol/codex-acp',
    env: (path) => ({ CODEX_PATH: path }),
    auth: ['login', 'status'],
    login: ['login'],
    systemPrompt: true,
  },
  gemini: { label: 'Gemini CLI', args: ['--acp', '--approval-mode', 'yolo'], login: [], approve: true },
  copilot: { label: 'GitHub Copilot', args: ['--acp', '--allow-all'], login: ['login'], approve: true },
  cursor: { label: 'Cursor', args: ['--force', 'acp'], auth: ['status'], login: ['login'], authenticate: 'cursor_login', approve: true },
  opencode: { label: 'OpenCode', args: ['acp'], login: ['auth', 'login'], approve: true },
  codebuddy: { label: 'CodeBuddy', args: ['--acp', '--permission-mode', 'bypassPermissions'], login: [], approve: true },
  qwen: { label: 'Qwen Code', args: ['--acp', '--approval-mode', 'yolo'], login: [], approve: true },
  kimi: { label: 'Kimi', args: ['acp'], login: ['login'], approve: true },
});

export const isAgentId = (id) => typeof id === 'string' && Object.hasOwn(AGENTS, id);

/** The app's own agent: Pi (pi-agent.mjs), on the person's own key (agent-roster.mjs). */
export const HARNESS_AGENTS = Object.freeze(['byok']);
export const isChatAgent = (id) => isAgentId(id) || HARNESS_AGENTS.includes(id);

/** What the agent is told about where it is, on top of its own instructions. */
export const INSTRUCTIONS = `You are working inside OpenFilm, a desktop app for making videos. Beside this chat the person sees OpenFilm Studio,
the video editor, showing the project in your working directory; it updates live as you save files.

The project is an OpenFilm film: pages with window.film, cut together by film.html. Before you change anything, run
\`openfilm\` with no arguments and read the manual it prints; follow it. Use the \`openfilm\` command on your PATH (this
app's own, on the Studio beside you), not \`npx openfilm\`, whatever a skill says. Studio is already open on this
project: you never need \`openfilm open\` and never open Studio in a browser. Run \`openfilm look\` after each change
to see what you made. Render the MP4 only when the person asks for it; they can also export from Studio. Reply in the
language the person writes in.

When the person mentions something in Studio, they may name a clip, a page or a moment (as seconds); find it in
film.html and the project's files.

In your replies you can point at things in Studio for the person: [[clip:ID]] (a clip, by its id in film.html),
[[t:SECONDS]] (a moment), [[range:START-END]] (a stretch, in seconds), [[track:N]] (a track, 0 is the first) and
[[file:PATH]] (a file of the project). They show as links that open it in Studio.`;

/**
 * For the app's own agent, which has no web tools of its own: web search and web pages from a service the person
 * connected (Brave Search or Tavily), like any other media (`openfilm get` lists them for an agent with OPENFILM_GET_WEB=1).
 */
export const WEB_INSTRUCTIONS = `To search the web, run \`openfilm get web-search --query "…"\`; to read a page, \`openfilm get web-fetch --url …\`
(it saves the page's text in the project). Both work once the person has connected a web search service (Brave Search
or Tavily) with their own key; until then, read public pages with \`curl\`.`;

/**
 * The app's own agent's whole system prompt, in place of Pi's (a coding assistant's, with Pi's own docs): who it is
 * and how it works with the person (agent-prompt.md), where it is (INSTRUCTIONS, WEB_INSTRUCTIONS), and the manual
 * `openfilm` prints, so it starts knowing it.
 */
export function ownAgentPrompt() {
  const prompt = readFileSync(new URL('./agent-prompt.md', import.meta.url), 'utf8').trim();
  const manual = readFileSync(join(dirname(require.resolve('openfilm/package.json')), 'MANUAL.md'), 'utf8').replaceAll('npx openfilm', 'openfilm').trim();
  return `${prompt}\n\n## Where you are\n\n${INSTRUCTIONS}\n\n${WEB_INSTRUCTIONS}\n\n<manual>\n${manual}\n</manual>`;
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
/** what the slower search found last (Windows): npm's global folder, Codex inside a Microsoft Store app */
let slowFound = { npmPrefix: null, storeCodex: null };
let slowCache = null;
const SLOW_FOR_MS = 10 * 60_000;
/* an OpenAI app from the Microsoft Store (ChatGPT, Codex) that carries Codex: where its codex.exe is */
const STORE_CODEX = "Get-AppxPackage -Name 'OpenAI.*' | ForEach-Object { Get-ChildItem -LiteralPath $_.InstallLocation -Recurse -Depth 5 -Filter codex.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName }";

/**
 * Windows only, and only when an agent is not found the quick way: where npm puts global commands (a prefix of the
 * person's own that is not on their PATH), and Codex inside an OpenAI app from the Microsoft Store. Asked again after
 * ten minutes, or at once with `fresh`.
 */
function windowsSlowSearch({ fresh = false } = {}) {
  if (!windows) return Promise.resolve(slowFound);
  if (slowCache && !fresh && Date.now() - slowCache.at < SLOW_FOR_MS) return slowCache.value;
  const value = (async () => {
    const env = childEnvironment({ shell: await loginShellEnvironment() });
    const [npm, store] = await Promise.all([
      run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm prefix -g'], 15_000, { env }),
      run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', STORE_CODEX], 20_000, { env }),
    ]);
    const prefix = npm.ok ? npm.stdout.trim().split(/\r?\n/).pop()?.trim() : null;
    /* the Codex app's own window program is a codex.exe too (`app\Codex.exe`, the filter ignores case): only a console
       program is the CLI */
    const exe = store.ok ? store.stdout.split(/\r?\n/).map((l) => l.trim()).find((l) => /codex\.exe$/i.test(l) && isAbsolute(l) && consoleProgram(l)) : null;
    slowFound = { npmPrefix: prefix && isAbsolute(prefix) ? prefix : null, storeCodex: exe && isAbsolute(exe) ? exe : null };
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
    others: id === 'codex' && slowFound.storeCodex ? [slowFound.storeCodex] : [],
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

/**
 * How to start a program found for an agent: itself, a script with the app's own Node (an npm install on Windows), or
 * a `.cmd` shim whose target could not be told, through cmd.exe. `options` go to spawn.
 */
function starting(cliPath, args) {
  if (/\.(?:c|m)?js$/i.test(cliPath)) return { cmd: nodeBinary(), args: [AS_NODE, cliPath, ...args], env: { ELECTRON_RUN_AS_NODE: '1' }, options: {} };
  if (windows && /\.(?:cmd|bat)$/i.test(cliPath)) {
    return { cmd: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${[cliPath, ...args].map(winArg).join(' ')}"`], env: {}, options: { windowsVerbatimArguments: true } };
  }
  return { cmd: cliPath, args, env: {}, options: {} };
}

/**
 * A program the person chose for an agent, tried: it has to start and answer `--version`. `{ ok, version }`, or why
 * not: `code` 'not-a-program' (nothing there this computer can start) or 'did-not-start' (with what it said).
 */
export async function checkAgentProgram(id, path) {
  const spec = AGENTS[id];
  if (!spec) return { ok: false, error: `No agent ${id}`, code: 'not-a-program' };
  const cli = chosenProgram(path, { names: AGENT_PROGRAMS[id]?.names ?? [id] });
  if (!cli) return { ok: false, error: 'That is not a program this computer can start.', code: 'not-a-program' };
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
      ...(id === 'codex' ? [`Codex in a Store app: ${slow.storeCodex ?? '(none)'}`] : []),
      `In WSL: ${found ? '(not checked)' : wsl ?? '(no)'}`,
    ] : []),
    '',
    `Files named ${names.join(', ')}:`,
    ...(report.files.length ? report.files.map((f) => `  ${f.file}${f.runs && f.runs !== f.file ? ` -> ${f.runs}` : ''}${f.usable ? '' : ' (cannot be started)'}`) : ['  (none)']),
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
 * @returns {Promise<{ signedIn: boolean | null, account: AgentAccount | null }>}
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
 * @returns {{ signedIn: boolean | null, account: AgentAccount | null }}
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
  if (/\bnot logged in\b/i.test(out)) return { signedIn: false, account: null };
  if (/\blogged in\b/i.test(out)) {
    const method = /chatgpt/i.test(out) ? 'chatgpt' : /api key/i.test(out) ? 'api-key' : 'other';
    return { signedIn: true, account: { method } };
  }
  return { signedIn: null, account: null };
}

/** what a session opened only to ask found, for a while: the roster asks again every few seconds */
const asked = new Map();
const ASKED_FOR_MS = 15_000;
let probeDir = null;

/**
 * Signed in, for an agent with no command that says: a session opened (in an empty folder of the app's) and closed.
 * One it refuses for its sign-in (ACP's auth_required) is signed out; one that opens, signed in; anything else, null.
 */
export function acpSignedIn(id) {
  const kept = asked.get(id);
  if (kept && Date.now() - kept.at < ASKED_FOR_MS) return kept.answer;
  const answer = (async () => {
    probeDir ??= mkdtempSync(join(tmpdir(), 'openfilm-agent-'));
    const session = new AgentSession({ agent: id, cwd: probeDir });
    try {
      await Promise.race([session.start(), new Promise((_, fail) => setTimeout(() => fail(new Error('timed out')), 30_000))]);
      return true;
    } catch (e) {
      return e?.code === 'sign-in' ? false : null;
    } finally {
      session.close();
    }
  })();
  asked.set(id, { at: Date.now(), answer });
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

/** The AppleScript that has Terminal run one command in a new window. */
export function signInScript(cliPath, args) {
  const command = [cliPath, ...args].map(shq).join(' ');
  return `tell application "Terminal"\nactivate\ndo script "${command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\nend tell`;
}

/**
 * A PowerShell script that names its window and runs one program (`& 'program' 'arg'…`, each in single quotes, as
 * PowerShell quotes): Windows sign-in. With a BOM, so Windows PowerShell reads a path with Chinese in it as UTF-8.
 */
export function powerShellScript(title, cmd, args) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  return `\ufeff$Host.UI.RawUI.WindowTitle = ${q(title)}\r\n& ${[cmd, ...args].map(q).join(' ')}\r\n`;
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
 * Sign in: Terminal runs the program's own sign-in, which opens the maker's own page. The app touches nothing. One
 * signed in the way its adapter offers (`acpSignIn`, that way's id) runs the adapter with that way's arguments, as ACP
 * has a client do it.
 */
export async function openAgentSignIn(id) {
  const spec = AGENTS[id];
  const pathDirs = (await loginShellEnvironment()).PATH.split(PATH_SEP);
  const cli = spec ? resolveAgentCli(id, { pathDirs }) : null;
  if (!spec || !cli) return { ok: false, error: `${spec?.label ?? id} is not installed on this computer.` };
  asked.delete(id);
  let how = null;
  if (spec.acpSignIn) {
    const way = (await agentSignInMethods(id)).find((w) => w.id === spec.acpSignIn);
    if (!way) return { ok: false, error: `${spec.label} did not offer a way to sign in.` };
    const launch = adapterLaunch(id, cli.path);
    how = { cmd: launch.cmd, args: [...launch.args, ...way.args], env: { ...launch.env, ...way.env } };
  }
  if (process.platform === 'win32') {
    /* a PowerShell window of its own running a script, as ChatCut does: no command line for cmd.exe to unquote (a path
       with a space in it), and left open so its sign-in can be read and answered (it runs a shim itself) */
    how ??= /\.(?:cmd|bat)$/i.test(cli.path) ? { cmd: cli.path, args: spec.login, env: {} } : starting(cli.path, spec.login);
    try {
      const dir = join(tmpdir(), 'openfilm-sign-in');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${id}.ps1`);
      writeFileSync(file, powerShellScript(`${spec.label} sign-in`, how.cmd, how.args), 'utf8');
      const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const child = spawn(powershell, ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', file], {
        detached: true, stdio: 'ignore', windowsHide: false, env: childEnvironment({ shell: agentShell(id, await loginShellVariables()), extra: how.env }),
      });
      await new Promise((done, fail) => { child.once('spawn', done); child.once('error', fail); });
      child.unref();
      return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }
  const script = how
    ? signInScript('/usr/bin/env', [...Object.entries(how.env).map(([k, v]) => `${k}=${v}`), how.cmd, ...how.args])
    : signInScript(cli.path, spec.login);
  const r = await run('/usr/bin/osascript', ['-e', script], 15_000);
  return r.ok ? { ok: true } : { ok: false, error: r.out.trim() || 'Terminal did not open.' };
}

/**
 * The agents as they are on this machine, for the chat's picker. `setupRequired: 'code-tab'`: the Claude app is
 * here but has not downloaded Claude Code yet (opening its Code tab does).
 */
export async function listAgents() {
  /* looked at as the person comes back from installing one: a PATH from a few seconds ago at most */
  const pathDirs = (await loginShellEnvironment({ maxAgeMs: 10_000 })).PATH.split(PATH_SEP);
  /* one not found the quick way: the slower search (Windows), then all of them again; waited for a few seconds at
     most, what it finds later is there on the next look */
  if (windows && Object.keys(AGENTS).some((id) => !resolveAgentCli(id, { pathDirs }))) {
    await Promise.race([windowsSlowSearch(), new Promise((done) => setTimeout(done, 3000).unref?.())]);
  }
  return Promise.all(Object.entries(AGENTS).map(async ([id, spec]) => {
    const cli = resolveAgentCli(id, { pathDirs });
    const { install } = detectAgentInstallation(id);
    const claudeApp = id === 'claude' && !cli && ['/Applications', join(homedir(), 'Applications')].some((dir) => existsSync(join(dir, 'Claude.app')));
    return {
      id,
      label: spec.label,
      cli: cli ? { path: cli.path, source: cli.source } : null,
      chosen: chosenPaths[id] ?? null,
      ...(cli ? await agentStatus(id, cli.path) : { signedIn: null, account: null }),
      install,
      setupRequired: claudeApp ? 'code-tab' : null,
    };
  }));
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
    args: [...(node.env.ELECTRON_RUN_AS_NODE ? [AS_NODE] : []), adapterScript(spec.adapter)],
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

/** ACP's auth_required: the agent wants its own sign-in first. */
const AUTH_REQUIRED = -32000;

/** A session refused for the agent's sign-in, said so (`code: 'sign-in'`); any other error as it was. */
function signInError(label, e) {
  if (e?.code !== AUTH_REQUIRED) return e;
  return Object.assign(new Error(`${label} is not signed in. Sign in under Settings → Agents.`), { code: 'sign-in' });
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
   *           env?: Record<string, string>,
   *           onUpdate?: (update: any) => void, onPermission?: (params: any) => Promise<string | null>,
   *           onQuestion?: (ask: { message: string, toolCallId: string | null, questions: any[] }) => Promise<Record<string, { label?: string, text?: string }> | null>,
   *           onExit?: (info: { code: number | null, stderr: string }) => void,
   *           onSend?: (sent: { prompt: any[], _meta?: any }) => void }} opts
   * `onSend` hears each message as it goes to the agent, whole (the app's words before the first one's, for an agent
   * told them there); `opened`, once started, says what it was started and opened with.
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
    const shell = agentShell(this.opts.agent, await loginShellVariables({ staleOk: true }));
    const harness = this.opts.harness ?? null;
    const cli = harness ? null : resolveAgentCli(this.opts.agent, { pathDirs: shell.PATH.split(PATH_SEP) });
    if (!harness && !cli) throw Object.assign(new Error(`${this.spec.label} is not installed on this computer.`), { code: 'not-installed' });
    const node = nodeRuntime();
    const path = [this.opts.binDir, shell.PATH, this.opts.fallbackDir].filter(Boolean).join(PATH_SEP);
    const instructions = INSTRUCTIONS;
    /* the app's own agent: what Pi runs with (its whole system prompt is ours), and the web search of `openfilm get`
       (OPENFILM_GET_WEB lists it) */
    const own = !harness ? {} : {
      ...harness.env,
      OPENFILM_GET_WEB: '1',
      OPENFILM_PI: JSON.stringify({ agentDir: harness.home, models: harness.models, model: harness.model, systemPrompt: ownAgentPrompt() }),
    };
    /* an agent that speaks ACP itself: its own program, started as the registry starts it */
    const native = cli && !this.spec.adapter ? starting(cli.path, this.spec.args) : null;
    const extra = { ...this.opts.env, ...(native ? native.env : node.env), ...(cli && this.spec.env ? this.spec.env(cli.path) : {}), ...own };
    const env = childEnvironment({ shell: { ...shell, PATH: path }, extra });
    const claude = this.spec.adapter === AGENTS.claude.adapter;
    if (this.spec.adapter === AGENTS.codex.adapter) {
      const theirs = codexDeveloperInstructions(codexConfigText(shell));
      env.CODEX_CONFIG = JSON.stringify({ developer_instructions: theirs ? `${theirs}\n\n${instructions}` : instructions });
    }
    /* the others have no place for it: the session's first message carries it */
    this.instructions = harness || this.spec.systemPrompt ? null : instructions;

    const script = harness ? fileURLToPath(new URL('./pi-agent.mjs', import.meta.url)) : native ? null : adapterScript(this.spec.adapter);
    this.child = native
      ? spawn(native.cmd, native.args, { ...native.options, cwd: this.opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      : spawn(node.command, [...(node.env.ELECTRON_RUN_AS_NODE ? [AS_NODE] : []), script], { cwd: this.opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child.stderr.on('data', (d) => { this.stderr = (this.stderr + String(d)).slice(-16_000); });
    this.child.once('exit', (code) => this.opts.onExit?.({ code, stderr: this.stderr }));
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
        if (!this.replaying) this.opts.onUpdate?.(ctx.params.update);
      })
      .connect(stream);

    const init = await this.conn.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: CLIENT_CAPABILITIES,
      clientInfo: CLIENT_INFO,
    });

    const params = {
      cwd: this.opts.cwd,
      mcpServers: [],
      ...(claude ? { _meta: { systemPrompt: { append: instructions } } } : {}),
    };
    /* the program's own sign-in, taken up (Cursor asks for this before any session) */
    if (this.spec.authenticate && (init.authMethods ?? []).some((m) => m.id === this.spec.authenticate)) {
      await this.conn.agent.request(acp.methods.agent.authenticate, { methodId: this.spec.authenticate }).catch((e) => { throw signInError(this.spec.label, e); });
    }

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
    session ??= await this.conn.agent.request(acp.methods.agent.session.new, params).catch((e) => { throw signInError(this.spec.label, e); });
    this.sessionId = session.sessionId;
    /* an agent on the older model and mode lists (Gemini CLI): the same choices, as config options */
    this.legacy = !session.configOptions && Boolean(session.models || session.modes);
    if (resumed) this.instructions = null;
    this.info = {
      sessionId: session.sessionId,
      resumed,
      agentInfo: init.agentInfo ?? null,
      models: session.models ?? null,
      modes: session.modes ?? null,
      configOptions: session.configOptions ?? (this.legacy ? legacyOptions(session) : null),
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
      command: native ? [native.cmd, ...native.args] : [node.command, ...(node.env.ELECTRON_RUN_AS_NODE ? [AS_NODE] : []), script],
      adapter: this.spec.adapter ?? null,
      env: Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, secret.has(k) || /KEY|TOKEN|SECRET|PASSWORD/i.test(k) ? '(hidden)' : k === 'OPENFILM_PI' ? JSON.parse(v) : v])),
      ...(env.CODEX_CONFIG ? { codexConfig: JSON.parse(env.CODEX_CONFIG) } : {}),
      path: { first: this.opts.binDir ?? null, last: this.opts.fallbackDir ?? null },
      fromShell: this.spec.fromShell ? Object.keys(shell).sort() : 'all',
      initialize: { request: { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: CLIENT_CAPABILITIES, clientInfo: CLIENT_INFO }, response: init },
      session: { method: !resumed ? 'session/new' : caps.sessionCapabilities?.resume ? 'session/resume' : 'session/load', params: { ...params, ...(resumed ? { sessionId: resume } : {}) } },
      firstMessage: this.instructions,
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
    const r = await this.conn.agent.request(acp.methods.agent.session.prompt, { sessionId: this.sessionId, prompt: [...told, ...blocks], ...meta })
      .catch((e) => {
        /* the app's own agent: a service with no balance left is said the same for every service, with its page */
        const own = this.opts.harness?.models?.find((m) => m.id === this.modelNow) ?? this.opts.harness?.models?.[0];
        const broke = own ? outOfBalance({ id: own.name, baseUrl: own.baseUrl }, e) : null;
        if (broke) throw broke;
        if (!isAgentId(this.opts.agent)) throw e;
        const said = signInError(this.spec.label, e);
        if (said.code === 'sign-in') noteSignedOut(this.opts.agent);
        throw said;
      });
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
    return r;
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
    try { this.conn?.close(); } catch { /* gone already */ }
    if (this.child && this.child.exitCode === null) this.child.kill('SIGTERM');
  }
}
