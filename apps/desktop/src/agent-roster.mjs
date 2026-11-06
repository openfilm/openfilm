/**
 * The agents the chat can use, as Settings → Agents shows them, and the person's choices about them:
 *
 *   · codex, claude, copilot, cursor, opencode, codebuddy, qwen, kimi, minimax, deepseek — the person's own agents
 *     (agents.mjs): Codex, Claude Code, GitHub Copilot, Cursor, OpenCode, CodeBuddy, Qwen Code, Kimi, MiniMax Code and
 *     DeepSeek Harness. Each uses the account its own program is signed in to: connecting opens Terminal for its own
 *     sign-in command only when it is signed out (never Codex's or DeepSeek Harness's: each is signed in in its own
 *     app, so one found is connected), disconnecting only stops OpenFilm using it, and connecting again uses whichever
 *     account is signed in then. `account` says whose it is. One with a sign-out command (`signOut`) switches account
 *     here (`switchAccount`): signed out, its sessions closed, its sign-in opened and waited for. Codex and
 *     Claude Code are shown in the chat's menu from the start; the others once the person connects one or switches it
 *     on. Codex is connected from the start, Claude Code once the person connects it.
 *   · byok — the app's own agent (Pi, pi-agent.mjs) on the person's own models, each set up on its own: the name the
 *     chat's menu shows, its service (an address on a standard API in one of three formats: the OpenAI Responses API
 *     (…/v1/responses), the OpenAI Chat Completions API (…/v1/chat/completions) or the Anthropic Messages API
 *     (…/v1/messages); Pi speaks each), its own key, the model asked for there, the reasoning efforts the person
 *     says it takes and the one it starts on (`auto` alone, sending no reasoning setting, when they said nothing), and
 *     its context length, when they gave one (128K when not). The chat's menu switches between them, the first one to
 *     begin with. Each has to read pictures (the agent looks at its own frames): setting one up sends it one small
 *     request with a picture, and a model that cannot take it is refused.
 *
 * One of the person's own agents not found where it is looked for can be pointed at (`locate`): the program they choose
 * is tried (it has to answer `--version`) and used from then on, until they go back to finding it (`useAutomatic`).
 * One with an official installer can be installed (`install`): it runs in a terminal window, and the agent is looked
 * for again until it is there.
 * `diagnose` says what was searched, for them to read or send with an issue.
 *
 * Each has a switch for whether the chat's menu shows it. Kept in the app's data folder: agents.json (the choices) and
 * byok-keys (each own model's key by its id, sealed with the system's keychain by the caller's `seal`/`unseal`; byok.key,
 * the one key of a version before, is the key of the models set up then).
 *
 * State per agent: ready · off (disconnected here) · sign-in (its own sign-in is needed) · waiting (signing in, in
 * Terminal) · missing (not installed; `install` says where from, `installer` the command that installs it, `app` the
 * maker's desktop app when only that is here, `installing` while its installer runs) · key (no key set up) · checking
 * (not known yet).
 *
 * Reads no Electron module, so `node --test` can use it.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PI_APIS, contextLength, modelEffort } from './pi-config.mjs';
import { agentConnectionIssue } from './agent-connection-issue.mjs';

import { AGENT_DEFINITIONS, AGENT_IDS, OWN_AGENT_IDS, isAgentId } from './agent-definitions.mjs';
export { AGENT_IDS, OWN_AGENT_IDS } from './agent-definitions.mjs';
export const AGENT_NAMES = Object.freeze(Object.fromEntries(AGENT_IDS.map((id) => [id, AGENT_DEFINITIONS[id].name])));
const isOwn = (id) => OWN_AGENT_IDS.includes(id);

/** The API formats a key can be for, and the address each starts with. */
export const BYOK_FORMATS = Object.freeze({
  responses: { name: 'OpenAI Responses API', baseUrl: 'https://api.openai.com/v1' },
  chat: { name: 'OpenAI Chat Completions API', baseUrl: 'https://api.openai.com/v1' },
  anthropic: { name: 'Anthropic Messages API', baseUrl: 'https://api.anthropic.com' },
});

/* the person's other agents: not shown until connected or switched on */
const DEFAULT_SHOWN = { codex: true, claude: true, byok: false };
/* Codex is used as it is signed in on the computer from the start; Claude Code only once the person connects it, which
   signs in to their Claude subscription the first time */
const DEFAULT_DISCONNECTED = Object.freeze(['claude']);
/**
 * How long a sign-in in Terminal is waited for: a person may first sign in to the maker's site, with a code sent to
 * them (five minutes, as it was, was too short for Cursor's). Once it is over, the window coming back into focus asks
 * again (Settings → Agents). A sign-in is asked about every second, so finishing it shows at once; an install, every
 * few seconds.
 */
const SIGN_IN_WAIT = { ms: 15 * 60_000, pollMs: 1000 };
const INSTALL_WAIT = { ms: 15 * 60_000, pollMs: 3000 };

/** A red 16 × 16 picture, for asking a model whether it reads pictures. */
const PROBE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGN4pqFBEmIY1TCqYfhqAACM5TYQULtblwAAAABJRU5ErkJggg==';
const PROBE_TEXT = 'What color is this picture? One word.';

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

/** The person's choices, as kept. One about an agent the app no longer has is left out. */
export function readChoices(dataDir) {
  const raw = readJson(join(dataDir, 'agents.json'), {});
  const shown = { ...DEFAULT_SHOWN };
  for (const id of AGENT_IDS) if (typeof raw.shown?.[id] === 'boolean') shown[id] = raw.shown[id];
  const models = ownModels(raw.byok);
  const byok = models.length ? { models } : null;
  const paths = {};
  for (const id of OWN_AGENT_IDS) if (typeof raw.paths?.[id] === 'string' && raw.paths[id]) paths[id] = raw.paths[id];
  return {
    shown,
    disconnected: Array.isArray(raw.disconnected) ? raw.disconnected.filter((id) => isAgentId(id)) : [...DEFAULT_DISCONNECTED],
    byok,
    paths,
  };
}

/** A model's context length, as kept: there only when the person gave one that holds. */
const ownContext = (/** @type {unknown} */ value) => {
  const context = contextLength(value);
  return context ? { context } : {};
};

/**
 * The person's own models as kept: `[{ id, name, format, baseUrl, model, levels, effort, context?, last4 }]`, the first
 * the one a conversation starts on. One without a known format, an address or a model is left out; a context length
 * that does not hold is dropped. Kept before each model was set up on its own (one service, its models by name,
 * `efforts` by name): each of those models on that service (`m1`, `m2`…), on the key kept then.
 */
export function ownModels(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const list = Array.isArray(raw.models) && raw.models.some((m) => m && typeof m === 'object')
    ? raw.models
    : Object.hasOwn(BYOK_FORMATS, raw.format)
      ? modelList(Array.isArray(raw.models) && raw.models.length ? raw.models : [raw.model]).map((model, i) => ({
        id: `m${i + 1}`, name: model, format: raw.format, baseUrl: raw.baseUrl, model, last4: raw.last4,
        levels: raw.efforts?.[model]?.levels, effort: raw.efforts?.[model]?.effort,
      }))
      : [];
  const ids = new Set();
  return list.flatMap((m) => {
    const model = String(m?.model ?? '').trim();
    const baseUrl = String(m?.baseUrl ?? '').trim();
    const id = String(m?.id ?? '');
    if (!model || !baseUrl || !Object.hasOwn(BYOK_FORMATS, m?.format) || !/^[a-z0-9]+$/.test(id) || ids.has(id)) return [];
    ids.add(id);
    return [{ id, name: String(m.name ?? '').trim() || model, format: m.format, baseUrl, model, ...modelEffort(m.levels, m.effort), ...ownContext(m.context), last4: String(m.last4 ?? '') }];
  });
}

/** Model names, from a list or text (separated by commas or new lines): trimmed, each once, in order. */
export function modelList(value) {
  const names = (Array.isArray(value) ? value : String(value ?? '').split(/[,\n]/)).map((m) => String(m ?? '').trim()).filter(Boolean);
  return [...new Set(names)];
}

function writeChoices(dataDir, choices) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'agents.json'), `${JSON.stringify(choices, null, 2)}\n`);
}

/**
 * Whether a key may be sent to `baseUrl`: over https://, or over http:// only to this computer (localhost, 127.x.x.x,
 * ::1), where it crosses no network in the clear.
 */
export function keyAddress(baseUrl) {
  if (/\s/.test(baseUrl)) return false;
  let url;
  try { url = new URL(baseUrl); } catch { return false; }
  if (url.protocol === 'https:') return true;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return url.protocol === 'http:' && (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host));
}

/** One request, in the format's own shape, carrying a picture. */
export function probeRequest(format, baseUrl, key, model) {
  const base = baseUrl.replace(/\/+$/, '');
  const picture = `data:image/png;base64,${PROBE_PNG}`;
  if (format === 'anthropic') {
    return {
      url: `${base}/v1/messages`,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: { model, max_tokens: 16, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PROBE_PNG } }, { type: 'text', text: PROBE_TEXT }] }] },
    };
  }
  if (format === 'chat') {
    return {
      url: `${base}/chat/completions`,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: { model, max_tokens: 16, messages: [{ role: 'user', content: [{ type: 'text', text: PROBE_TEXT }, { type: 'image_url', image_url: { url: picture } }] }] },
    };
  }
  return {
    url: `${base}/responses`,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: { model, max_output_tokens: 16, input: [{ role: 'user', content: [{ type: 'input_text', text: PROBE_TEXT }, { type: 'input_image', image_url: picture }] }] },
  };
}

/**
 * Whether a model reads pictures: one request with a picture in it, in the format's own shape. Resolves `{ ok }` or the
 * service's own words for what went wrong (a model that cannot take pictures is said so, and so is a web page where the
 * API should be). The app's own words come with a `code`, and the `url`, `status` or `reason` they name, so Studio's
 * Settings say them in the person's language (its settings.agents.ownErrors); the service's own words have none.
 * @param {{ format: string, baseUrl: string, key: string, model: string, fetch?: typeof fetch }} o
 */
export async function probeModel({ format, baseUrl, key, model, fetch: fetchImpl = fetch }) {
  const req = probeRequest(format, baseUrl, key, model);
  let res;
  try {
    res = await fetchImpl(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `The service could not be reached: ${reason}`, code: 'unreachable', reason };
  }
  /* a web page answers an address that is a site's, not an API's (or a sign-in page in front of one), whatever its status */
  const page = /text\/html/i.test(res.headers.get('content-type') ?? '');
  if (res.ok && !page) return { ok: true };
  const body = await res.text().catch(() => '');
  let message = body;
  try { message = JSON.parse(body)?.error?.message ?? body; } catch { /* not JSON */ }
  message = String(message).slice(0, 300);
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'The service did not accept this key.', code: 'key-refused' };
  if (page || /^\s*</.test(body)) return { ok: false, error: `${req.url} answers with a web page (${res.status}), not the API: check the address and the API format.`, code: 'web-page', url: req.url, status: res.status };
  if (/image|vision|multimodal|modalit/i.test(message)) return { ok: false, error: 'This model cannot read pictures, and the agent has to look at its frames: choose one that does.', code: 'no-images' };
  if (res.status === 404 && !/model/i.test(message)) return { ok: false, error: `Nothing answers at ${req.url}: check the address and the API format.`, code: 'nothing-there', url: req.url };
  if (message) return { ok: false, error: message };
  return { ok: false, error: `The service answered ${res.status}.`, code: 'answered', status: res.status };
}

/**
 * The roster: the agents' state, the person's choices, and the actions Settings and the chat take on them.
 * `onChange(list)` hears every change (Settings and the chat both redraw from it).
 *
 * @param {{
 *   dataDir: string,
 *   localAgents: (options?: { ids?: string[], statusIds?: string[], fresh?: boolean, onAgent?: (agent: any) => void }) => Promise<Array<{ id: string, cli: { path: string } | null, signedIn: boolean | null, account?: object | null, problem?: string, outdated?: { version: string, tested: string, update: string | null } | null, install: string | null, setupRequired: string | null, app?: string | null, installer?: string | null }>>,
 *   localAgent?: (id: string, options?: { fresh?: boolean }) => Promise<{ id: string, cli: { path: string } | null, signedIn: boolean | null, account?: object | null, problem?: string, install: string | null, setupRequired: string | null, app?: string | null, installer?: string | null }>,
 *   openSignIn: (id: string) => Promise<{ ok: boolean, error?: string, isOpen?: () => Promise<boolean | null> }>,
 *   signOut?: (id: string) => Promise<{ ok: boolean, error?: string }>,
 *   openInstaller?: (id: string) => Promise<{ ok: boolean, error?: string }>,
 *   usePaths?: (paths: Record<string, string>) => void,
 *   pickProgram?: (id: string, words?: { title?: string, button?: string, kind?: 'file' | 'folder' }) => Promise<string | null>,
 *   checkProgram?: (id: string, path: string) => Promise<{ ok: boolean, error?: string, code?: string, path?: string, version?: string }>,
 *   diagnose?: (id: string) => Promise<{ found: string | null, hint: string | null, text: string } | null>,
 *   closeSessions: (id: string) => void,
 *   resetAgent?: (id: string) => void,
 *   seal: (text: string) => Buffer, unseal: (data: Buffer) => string,
 *   onChange: (list: any[]) => void,
 *   fetch?: typeof fetch,
 *   signInWait?: { ms: number, pollMs: number },
 * }} deps
 * `localAgent(id)`: one agent as `localAgents` has it, asked alone while its sign-in or its install is waited for
 * (`signInWait`).
 */
export function createRoster(deps) {
  const { dataDir } = deps;
  let choices = readChoices(dataDir);
  deps.usePaths?.(choices.paths);
  /** what is happening now, beyond what is kept: a sign-in or an install waited for, an error to show */
  const live = { waiting: {}, installing: {}, errors: {}, connectionIssues: {} };
  let local = null;
  const revision = new Map();
  const configurationRevision = new Map();
  const checking = new Map();
  let refreshing = null;

  /* each own model's key by its id; the one key of a version before is the key of the models set up then */
  const keysFile = join(dataDir, 'byok-keys');
  const legacyKeyFile = join(dataDir, 'byok.key');
  const byokKeys = () => {
    try { return existsSync(keysFile) ? JSON.parse(deps.unseal(readFileSync(keysFile))) : {}; } catch { return {}; }
  };
  const keyOf = (/** @type {string} */ id) => {
    const key = byokKeys()[id];
    if (typeof key === 'string' && key) return key;
    try { return existsSync(legacyKeyFile) ? deps.unseal(readFileSync(legacyKeyFile)) : null; } catch { return null; }
  };
  const writeKeys = (keys) => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(keysFile, deps.seal(JSON.stringify(keys)), { mode: 0o600 });
  };
  /** The own models that have a key: the ones the agent can use. */
  const keyed = () => (choices.byok?.models ?? []).filter((m) => keyOf(m.id));
  const enabled = (id) => Boolean(choices.shown[id]) && !choices.disconnected.includes(id);

  function stateOf(id) {
    if (isOwn(id)) {
      const found = local?.find((a) => a.id === id);
      if (!found) return { status: 'checking' };
      const where = { path: found.cli?.path ?? null, chosen: choices.paths[id] ?? null };
      if (!found.cli) {
        return { status: 'missing', install: found.install ?? null, setupRequired: found.setupRequired ?? null, app: found.app ?? null, installer: found.installer ?? null,
          ...(live.installing[id] ? { installing: true } : {}), ...where };
      }
      if (choices.disconnected.includes(id) || !choices.shown[id]) return { status: 'off', ...where };
      if (found.signedIn === false) return { status: live.waiting[id] ? 'waiting' : 'sign-in', ...where };
      return { status: 'ready', ...where, ...(found.account ? { account: { ...found.account } } : {}), ...(found.problem ? { problem: found.problem } : {}),
        ...(found.outdated ? { outdated: { ...found.outdated } } : {}),
        ...(found.signOut && deps.signOut ? { signOut: true } : {}) };
    }
    if (choices.disconnected.includes(id)) return { status: 'off' };
    if (!keyed().length) return { status: 'key' };
    return { status: 'ready' };
  }

  function list() {
    return AGENT_IDS.map((id) => ({
      id,
      name: AGENT_DEFINITIONS[id].name,
      shown: choices.shown[id] ?? false,
      ...stateOf(id),
      ...(live.errors[id] ? { error: live.errors[id] } : {}),
      ...(live.connectionIssues[id] ? { connectionIssue: { ...live.connectionIssues[id] } } : {}),
      ...(configurationRevision.has(id) ? { configurationRevision: configurationRevision.get(id) } : {}),
      ...(id === 'byok' && choices.byok ? { byok: { models: choices.byok.models.map((m) => ({ ...m, levels: [...m.levels] })) } } : {}),
    }));
  }

  const changed = () => deps.onChange(list());
  const save = (next) => { choices = next; writeChoices(dataDir, choices); changed(); };

  async function refresh({ fresh = false, only = null } = {}) {
    // Focus after signing in should not wait for every other agent to finish its own status command. Only the agent
    // being signed in is asked fresh; the others keep their cached answers in the full scan.
    if (deps.localAgent) {
      for (const id of Object.keys(live.waiting)) {
        const waiting = live.waiting[id];
        void lookAgain(id, () => !choices.disconnected.includes(id) && live.waiting[id] === waiting && !waiting.signal.aborted);
      }
    }
    if (!refreshing || fresh || only) {
      const started = new Map(revision);
      const ids = (only ?? [...OWN_AGENT_IDS]).filter(isOwn).sort((a, b) => Number(enabled(b)) - Number(enabled(a)));
      const statusIds = ids.filter((id) => enabled(id) || live.waiting[id] || live.installing[id] || Boolean(only));
      const wanted = new Set(ids);
      const accept = (agent) => {
        if (!wanted.has(agent.id) || revision.get(agent.id) !== started.get(agent.id)) return;
        local = [...(local ?? []).filter((a) => a.id !== agent.id), agent];
        changed();
      };
      const pending = (async () => {
        const found = await deps.localAgents({ ids, statusIds, fresh, onAgent: accept }).catch(() => null);
        if (found) {
          local ??= [];
          for (const agent of found) {
            // A late result cannot overwrite a newer sign-in or re-enable an agent switched off during the scan.
            if (revision.get(agent.id) !== started.get(agent.id)) continue;
            local = [...local.filter((a) => a.id !== agent.id), agent];
          }
        } else local ??= [];
        changed();
        return list();
      })().finally(() => { if (refreshing === pending) refreshing = null; });
      refreshing = pending;
    }
    return refreshing;
  }

  /** Re-read settings after an external configuration change; idle sessions and model menus are renewed. */
  async function recheck(id) {
    if (id != null && !isOwn(id)) return list();
    for (const target of id ? [id] : OWN_AGENT_IDS) {
      revision.set(target, (revision.get(target) ?? 0) + 1);
      configurationRevision.set(target, (configurationRevision.get(target) ?? 0) + 1);
      checking.delete(target);
      delete live.errors[target];
      delete live.connectionIssues[target];
      deps.resetAgent?.(target);
    }
    changed();
    return refresh({ fresh: true, only: id ? [id] : null });
  }

  /** The one agent signed in to, asked again: alone when it can be, not every agent every few seconds. */
  async function lookAgain(id, current) {
    let pending = checking.get(id);
    if (!pending) {
      pending = (deps.localAgent ? deps.localAgent(id, { fresh: Boolean(live.waiting[id]) }) : deps.localAgents()).catch(() => null);
      checking.set(id, pending);
      void pending.finally(() => { if (checking.get(id) === pending) checking.delete(id); });
    }
    const found = await pending;
    if (!found || !current()) return;
    local = deps.localAgent ? [...(local ?? []).filter((a) => a.id !== id), found] : found;
    if (deps.localAgent) revision.set(id, (revision.get(id) ?? 0) + 1);
    else for (const one of found) revision.set(one.id, (revision.get(one.id) ?? 0) + 1);
    changed();
  }

  /**
   * Looked at again every few seconds until `done` says so, or for as long as a sign-in is waited for. A wait started
   * again for the same agent (Start again) takes over: the one before stops, and leaves the new one's state alone.
   */
  async function waitFor(id, kind, done, isOpen) {
    live[kind][id]?.abort();
    const mine = new AbortController();
    live[kind][id] = mine;
    changed();
    const wait = deps.signInWait ?? (kind === 'waiting' ? SIGN_IN_WAIT : INSTALL_WAIT);
    const current = () => live[kind][id] === mine && !mine.signal.aborted;
    const stopped = new Promise((resolve) => mine.signal.addEventListener('abort', resolve, { once: true }));
    const timeout = setTimeout(() => mine.abort(), wait.ms);
    let terminalTimer;
    // Window checks run separately: an ACP sign-in probe may take 30 seconds to answer.
    const checkTerminal = async () => {
      const open = await isOpen().catch(() => null);
      if (!current()) return;
      if (open === false) mine.abort();
      else terminalTimer = setTimeout(checkTerminal, wait.pollMs);
    };
    if (isOpen) void checkTerminal();
    try {
      while (current()) {
        await Promise.race([lookAgain(id, current), stopped]);
        if (!current() || done(local?.find((a) => a.id === id))) break;
        await delay(wait.pollMs, undefined, { signal: mine.signal }).catch(() => {});
      }
    } finally {
      clearTimeout(timeout);
      clearTimeout(terminalTimer);
      mine.abort();
    }
    if (live[kind][id] !== mine) return;
    delete live[kind][id];
    changed();
  }
  const waitForSignIn = (id, isOpen) => waitFor(id, 'waiting', (a) => a?.signedIn !== false, isOpen);

  function cancelSignIn(id) {
    if (!isOwn(id)) return;
    live.waiting[id]?.abort();
    delete live.waiting[id];
    revision.set(id, (revision.get(id) ?? 0) + 1);
    changed();
  }

  return {
    list,
    refresh,
    recheck,
    cancelSignIn,

    /** An actual model request failed or succeeded. Refreshing discovery does not erase a model failure. */
    recordConnectionResult(id, error) {
      if (!isOwn(id)) return;
      if (error == null) delete live.connectionIssues[id];
      else {
        const issue = agentConnectionIssue(error);
        if (!issue) return;
        live.connectionIssues[id] = issue;
      }
      changed();
    },

    /** Connect: back on here; its own sign-in when it needs one. */
    async connect(id) {
      if (!isAgentId(id)) return { ok: false, error: `No agent ${id}` };
      delete live.errors[id];
      const wasDisconnected = choices.disconnected.includes(id);
      /* connecting one is choosing it: it is shown in the chat (and among the person's agents in Settings) */
      save({ ...choices, shown: { ...choices.shown, [id]: true }, disconnected: choices.disconnected.filter((a) => a !== id) });
      try {
        if (isOwn(id)) {
          deps.closeSessions(id);
          // A known sign-in wait can be restarted immediately, even if its previous status probe is still pending.
          if (deps.localAgent) {
            if (wasDisconnected || !local?.some((a) => a.id === id && a.signedIn === false)) await lookAgain(id, () => enabled(id));
          } else await refresh();
          const now = list().find((a) => a.id === id);
          /* signed out; or signing in already, its window closed before it was done (Start again): opened again */
          if (now?.status !== 'sign-in' && now?.status !== 'waiting') return { ok: true };
          const opened = await deps.openSignIn(id);
          if (!opened.ok) { live.errors[id] = opened.error ?? 'Terminal did not open.'; changed(); return { ok: false, error: live.errors[id] }; }
          void waitForSignIn(id, opened.isOpen);
          return { ok: true };
        }
        changed();
        return { ok: true };
      } catch (e) {
        live.errors[id] = e instanceof Error ? e.message : String(e);
        changed();
        return { ok: false, error: live.errors[id] };
      }
    },

    /**
     * Another account, for one that signs out with its own command: its sessions close (the next message starts on the
     * new account), it signs out with no window, and its sign-in opens and is waited for, as Sign in's is. A sign-out
     * that fails leaves it as it was, with what it said.
     */
    async switchAccount(id) {
      if (!isOwn(id) || !deps.signOut) return { ok: false, error: `No agent ${id}` };
      delete live.errors[id];
      cancelSignIn(id);
      deps.closeSessions(id);
      const out = await deps.signOut(id).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      if (!out.ok) { live.errors[id] = out.error || `${AGENT_NAMES[id]} did not sign out.`; changed(); return { ok: false, error: live.errors[id] }; }
      delete live.connectionIssues[id];
      /* signed out now: said at once, and kept over an older answer still on its way */
      local = (local ?? []).map((a) => (a.id === id ? { ...a, signedIn: false, account: null } : a));
      revision.set(id, (revision.get(id) ?? 0) + 1);
      changed();
      const opened = await deps.openSignIn(id);
      if (!opened.ok) { live.errors[id] = opened.error ?? 'Terminal did not open.'; changed(); return { ok: false, error: live.errors[id] }; }
      void waitForSignIn(id, opened.isOpen);
      return { ok: true };
    },

    /** Disconnect here only: its sessions close; its own sign-in stays as it is (connecting again uses it as it is then). */
    disconnect(id) {
      if (!isAgentId(id)) return;
      cancelSignIn(id);
      deps.closeSessions(id);
      save({ ...choices, disconnected: [...new Set([...choices.disconnected, id])] });
    },

    /**
     * Point at the program for one of the person's own agents: they choose it, it is tried (`--version`), and it is
     * used from then on. `words`: the dialog's title and button, in Studio's language. `{ ok: false }` without an
     * error when they cancelled.
     */
    async locate(id, words) {
      if (!isOwn(id) || !deps.pickProgram || !deps.checkProgram) return { ok: false, error: `No agent ${id}` };
      const path = await deps.pickProgram(id, words);
      if (!path) return { ok: false };
      const checked = await deps.checkProgram(id, path);
      if (!checked.ok) return { ok: false, error: checked.error ?? '', ...(checked.code ? { code: checked.code } : {}) };
      delete live.errors[id];
      delete live.connectionIssues[id];
      deps.closeSessions(id);
      choices = { ...choices, paths: { ...choices.paths, [id]: path }, shown: { ...choices.shown, [id]: true } };
      deps.usePaths?.(choices.paths);
      save(choices);
      if (deps.localAgent) await lookAgain(id, () => true);
      else await refresh();
      return { ok: true, ...(checked.path ? { path: checked.path } : {}), ...(checked.version ? { version: checked.version } : {}) };
    },

    /**
     * Install one of the person's own agents with its official installer, in a terminal window (the person agreed to
     * the command first), then look for it every few seconds until it is there.
     */
    async install(id) {
      if (!isOwn(id) || !deps.openInstaller) return { ok: false, error: `No agent ${id}` };
      delete live.errors[id];
      const opened = await deps.openInstaller(id);
      if (!opened.ok) { live.errors[id] = opened.error ?? 'Terminal did not open.'; changed(); return { ok: false, error: live.errors[id] }; }
      void waitFor(id, 'installing', (a) => Boolean(a?.cli));
      return { ok: true };
    },

    /** Back to finding the program where it is installed. */
    async useAutomatic(id) {
      if (!Object.hasOwn(choices.paths, id)) return { ok: true };
      const { [id]: _gone, ...paths } = choices.paths;
      delete live.connectionIssues[id];
      deps.closeSessions(id);
      choices = { ...choices, paths };
      deps.usePaths?.(choices.paths);
      save(choices);
      if (deps.localAgent) await lookAgain(id, () => true);
      else await refresh();
      return { ok: true };
    },

    /** What was searched for one of the person's own agents, and why it is not found (see agents.mjs diagnoseAgent). */
    async diagnose(id) {
      if (!isOwn(id) || !deps.diagnose) return null;
      const report = await deps.diagnose(id);
      if (deps.localAgent) await lookAgain(id, () => true);
      else void refresh();
      return report;
    },

    setShown(id, shown) {
      if (!isAgentId(id)) return;
      revision.set(id, (revision.get(id) ?? 0) + 1);
      save({ ...choices, shown: { ...choices.shown, [id]: shown === true } });
      if (shown && enabled(id) && deps.localAgent) void lookAgain(id, () => enabled(id));
    },

    /**
     * One of the person's own models, set up or changed (`id` names one already set up): its name (the model, when
     * none), its API format, the service's address, the model asked for there, its key, its efforts (pi-config.mjs
     * EFFORTS: the ones it takes and the one it starts on) and its context length (none: 128K). A key left empty keeps
     * the one it has, or takes the key of another model on the same address. Checked first (the key is taken, the
     * model reads pictures). What went wrong comes with a code, as probeModel's does.
     * @param {{ id?: string, name?: string, format: string, baseUrl?: string, model: string, key?: string, levels?: string[], effort?: string, context?: number }} config
     * @returns {Promise<{ ok: true, id: string } | { ok: false, error: string, code?: string, url?: string, status?: number, reason?: string }>}
     */
    async saveOwnModel(config) {
      const format = BYOK_FORMATS[config?.format];
      if (!format) return { ok: false, error: 'Choose the API format.', code: 'no-format' };
      const baseUrl = String(config.baseUrl || format.baseUrl).trim().replace(/\/+$/, '');
      if (!keyAddress(baseUrl)) return { ok: false, error: 'The address has to start with https:// (or http:// for one on this computer).', code: 'address' };
      const model = String(config.model ?? '').trim();
      if (!model) return { ok: false, error: 'Name the model.', code: 'no-model' };
      const models = choices.byok?.models ?? [];
      const before = config.id ? models.find((m) => m.id === config.id) : null;
      if (config.id && !before) return { ok: false, error: 'That model is no longer set up.', code: 'model-gone' };
      const sameService = models.find((m) => m.id !== config.id && m.baseUrl === baseUrl && keyOf(m.id));
      const key = String(config.key ?? '').trim() || (before ? keyOf(before.id) : null) || (sameService ? keyOf(sameService.id) : null);
      if (!key) return { ok: false, error: 'Paste the key.', code: 'no-key' };
      const probe = await probeModel({ format: config.format, baseUrl, key, model, fetch: deps.fetch });
      if (!probe.ok) return probe;
      let id = before?.id;
      while (!id || models.some((m) => m.id === id && m !== before)) id = randomBytes(4).toString('hex');
      const entry = { id, name: String(config.name ?? '').trim() || model, format: config.format, baseUrl, model, ...modelEffort(config.levels, config.effort), ...ownContext(config.context), last4: key.slice(-4) };
      writeKeys({ ...byokKeys(), [id]: key });
      delete live.errors.byok;
      save({
        ...choices,
        shown: { ...choices.shown, byok: true },
        disconnected: choices.disconnected.filter((a) => a !== 'byok'),
        byok: { models: before ? models.map((m) => (m.id === id ? entry : m)) : [...models, entry] },
      });
      deps.closeSessions('byok');
      return { ok: true, id };
    },

    /** One of the person's own models no longer set up, and its key gone with it. */
    removeOwnModel(id) {
      const models = choices.byok?.models ?? [];
      if (!models.some((m) => m.id === id)) return;
      const { [id]: _, ...keys } = byokKeys();
      writeKeys(keys);
      const left = models.filter((m) => m.id !== id);
      save({ ...choices, byok: left.length ? { models: left } : null });
      deps.closeSessions('byok');
    },

    /**
     * What a session of the app's own agent runs with (pi-agent.mjs): Pi's own folder, the person's models that have a
     * key (pi-config.mjs OwnModel: each its own service, its key in a variable of its own), the one it starts on, and
     * the keys themselves (`env`).
     */
    harness(id) {
      if (id !== 'byok') return null;
      const models = keyed();
      if (!models.length) return null;
      const env = {};
      const own = models.map((m, i) => {
        const keyEnv = `OPENFILM_BYOK_KEY_${i + 1}`;
        env[keyEnv] = keyOf(m.id);
        return { id: m.id, name: m.name, api: PI_APIS[m.format], baseUrl: m.baseUrl, keyEnv, model: m.model, levels: [...m.levels], effort: m.effort, ...ownContext(m.context) };
      });
      return { home: join(dataDir, 'agents', 'byok', 'pi'), models: own, model: own[0].id, env };
    },
  };
}
