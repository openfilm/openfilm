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
 * The agent works the way it would in a terminal: in the project's folder, with the `openfilm` command on its PATH
 * (this app's copy, so its Studio is the one in the window) and a few lines saying where it is (INSTRUCTIONS).
 *
 * Reads no Electron module, so `node --test` can use it.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import * as acp from '@agentclientprotocol/sdk';
import { PATH_SEP, childEnvironment, loginShellEnvironment } from './environment.mjs';
import { detectAgentInstallation } from './agent-installation.mjs';
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
\`openfilm\` with no arguments and read the manual it prints; follow it. Studio is already open on this project: you
never need \`openfilm open\` and never open a browser. Run \`openfilm look\` after each change to see what you made.
Render the MP4 only when the person asks for it; they can also export from Studio.

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

/** The person's program for this agent, on their login shell's PATH or inside the maker's app. */
export function resolveAgentCli(id, { pathDirs = [] } = {}) {
  if (!isAgentId(id)) return null;
  const found = detectAgentInstallation(id, { env: { ...process.env, PATH: pathDirs.join(PATH_SEP) } }).cli;
  return found ? { path: found } : null;
}

function run(cmd, args, timeoutMs = 10_000, { cwd, env } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, encoding: 'utf8', ...(cwd ? { cwd } : {}), ...(env ? { env } : {}) }, (error, stdout, stderr) => {
      resolve({ ok: !error, out: `${stdout ?? ''}\n${stderr ?? ''}`, stdout: stdout ?? '' });
    });
  });
}

/** How to start a program found for an agent: itself, or a script with the app's own Node (an npm install on Windows). */
function starting(cliPath, args) {
  return /\.(?:c|m)?js$/i.test(cliPath)
    ? { cmd: nodeBinary(), args: [cliPath, ...args], env: { ELECTRON_RUN_AS_NODE: '1' } }
    : { cmd: cliPath, args, env: {} };
}

/**
 * Signed in? Asked of the program itself: true / false, or null when it cannot say (an older version). One that has
 * no command for it is asked by opening a session (acpSignedIn).
 */
export async function agentSignedIn(id, cliPath) {
  const spec = AGENTS[id];
  if (!spec || !cliPath) return null;
  if (!spec.auth) return acpSignedIn(id);
  const how = starting(cliPath, spec.auth);
  const r = await run(how.cmd, how.args, 10_000, { env: childEnvironment({ shell: await loginShellEnvironment(), extra: how.env }) });
  if (id === 'claude') {
    try {
      const status = JSON.parse(r.stdout);
      return typeof status.loggedIn === 'boolean' ? status.loggedIn : null;
    } catch { /* not JSON: read the words */ }
  }
  if (/\bnot logged in\b/i.test(r.out)) return false;
  if (/\blogged in\b/i.test(r.out)) return true;
  return null;
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

/** Sign in: Terminal runs the program's own sign-in, which opens the maker's own page. The app touches nothing. */
export async function openAgentSignIn(id) {
  const spec = AGENTS[id];
  const pathDirs = (await loginShellEnvironment()).PATH.split(PATH_SEP);
  const cli = spec ? resolveAgentCli(id, { pathDirs }) : null;
  if (!spec || !cli) return { ok: false, error: `${spec?.label ?? id} is not installed on this Mac.` };
  asked.delete(id);
  if (process.platform === 'win32') {
    /* a command window of its own, left open so its sign-in can be read and answered */
    const how = starting(cli.path, spec.login);
    try {
      spawn('cmd.exe', ['/d', '/c', 'start', `${spec.label} sign-in`, 'cmd.exe', '/k', how.cmd, ...how.args], {
        detached: true, stdio: 'ignore', windowsHide: false, env: childEnvironment({ shell: await loginShellEnvironment(), extra: how.env }),
      }).unref();
      return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }
  const r = await run('/usr/bin/osascript', ['-e', signInScript(cli.path, spec.login)], 15_000);
  return r.ok ? { ok: true } : { ok: false, error: r.out.trim() || 'Terminal did not open.' };
}

/**
 * The agents as they are on this machine, for the chat's picker. `setupRequired: 'code-tab'`: the Claude app is
 * here but has not downloaded Claude Code yet (opening its Code tab does).
 */
export async function listAgents() {
  const pathDirs = (await loginShellEnvironment()).PATH.split(PATH_SEP);
  return Promise.all(Object.entries(AGENTS).map(async ([id, spec]) => {
    const cli = resolveAgentCli(id, { pathDirs });
    const { install } = detectAgentInstallation(id);
    const claudeApp = id === 'claude' && !cli && ['/Applications', join(homedir(), 'Applications')].some((dir) => existsSync(join(dir, 'Claude.app')));
    return {
      id,
      label: spec.label,
      cli: cli ? { path: cli.path, source: 'installed' } : null,
      signedIn: cli ? await agentSignedIn(id, cli.path) : null,
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
   * `harness` (for 'byok'): agent-roster.mjs's `harness(id)`, Pi's folder, its service and its model.
   * @param {{ agent: string, cwd: string, resume?: string | null, binDir?: string | null,
   *           harness?: any,
   *           env?: Record<string, string>,
   *           onUpdate?: (update: any) => void, onPermission?: (params: any) => Promise<string | null>,
   *           onQuestion?: (ask: { message: string, toolCallId: string | null, questions: any[] }) => Promise<Record<string, { label?: string, text?: string }> | null>,
   *           onExit?: (info: { code: number | null, stderr: string }) => void }} opts
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

  /** Start the adapter, shake hands, open (or resume) the session. */
  async start() {
    const shell = await loginShellEnvironment();
    const harness = this.opts.harness ?? null;
    const cli = harness ? null : resolveAgentCli(this.opts.agent, { pathDirs: shell.PATH.split(PATH_SEP) });
    if (!harness && !cli) throw Object.assign(new Error(`${this.spec.label} is not installed on this Mac.`), { code: 'not-installed' });
    const node = nodeRuntime();
    const path = [this.opts.binDir, shell.PATH].filter(Boolean).join(PATH_SEP);
    const instructions = INSTRUCTIONS;
    /* the app's own agent: what Pi runs with (its whole system prompt is ours), and the web search of `openfilm get`
       (OPENFILM_GET_WEB lists it) */
    const own = !harness ? {} : {
      ...harness.env,
      OPENFILM_GET_WEB: '1',
      OPENFILM_PI: JSON.stringify({ agentDir: harness.home, provider: harness.provider, model: harness.model, systemPrompt: ownAgentPrompt() }),
    };
    /* an agent that speaks ACP itself: its own program, started as the registry starts it */
    const native = cli && !this.spec.adapter ? starting(cli.path, this.spec.args) : null;
    const env = childEnvironment({ shell: { ...shell, PATH: path }, extra: { ...this.opts.env, ...(native ? native.env : node.env), ...(cli && this.spec.env ? this.spec.env(cli.path) : {}), ...own } });
    const claude = this.spec.adapter === AGENTS.claude.adapter;
    if (this.spec.adapter === AGENTS.codex.adapter) env.CODEX_CONFIG = JSON.stringify({ developer_instructions: instructions });
    /* the others have no place for it: the session's first message carries it */
    this.instructions = harness || this.spec.systemPrompt ? null : instructions;

    const script = harness ? fileURLToPath(new URL('./pi-agent.mjs', import.meta.url)) : native ? null : adapterScript(this.spec.adapter);
    this.child = native
      ? spawn(native.cmd, native.args, { cwd: this.opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn(node.command, [script], { cwd: this.opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
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
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false }, terminal: false, elicitation: { form: {} },
        /* Claude Code's "recommended value" extension: its model and effort lists come without a "Default" row, the
           current value named for what it is */
        _meta: { jetbrains: { air: { version: 1, capabilities: ['recommendedValue'] } } },
      },
      clientInfo: { name: 'openfilm-desktop', title: 'OpenFilm', version: '0.1.0' },
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
    const r = await this.conn.agent.request(acp.methods.agent.session.prompt, { sessionId: this.sessionId, prompt: [...told, ...blocks], ...meta })
      .catch((e) => {
        /* the app's own agent: a service with no balance left is said the same for every service, with its page */
        const broke = this.opts.harness ? outOfBalance(this.opts.harness.provider, e) : null;
        if (broke) throw broke;
        if (!isAgentId(this.opts.agent)) throw e;
        const said = signInError(this.spec.label, e);
        if (said.code === 'sign-in') noteSignedOut(this.opts.agent);
        throw said;
      });
    return r.stopReason;
  }

  /** Stop this turn (it ends with stopReason 'cancelled'). */
  async cancel() {
    if (this.sessionId) await this.conn.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.sessionId }).catch(() => {});
  }

  /** An option the adapter reports in configOptions: the model, the reasoning effort, the mode. */
  async setConfigOption(configId, value) {
    if (this.legacy && configId === 'mode') return this.setMode(value);
    if (this.legacy && configId === 'model') return this.conn.agent.request('session/set_model', { sessionId: this.sessionId, modelId: value });
    return this.conn.agent.request(acp.methods.agent.session.setConfigOption, { sessionId: this.sessionId, configId, value });
  }

  async setMode(modeId) {
    return this.conn.agent.request(acp.methods.agent.session.setMode, { sessionId: this.sessionId, modeId });
  }

  close() {
    try { this.conn?.close(); } catch { /* gone already */ }
    if (this.child && this.child.exitCode === null) this.child.kill('SIGTERM');
  }
}
