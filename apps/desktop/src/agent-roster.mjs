/**
 * The agents the chat can use, as Settings → Agents shows them, and the person's choices about them:
 *
 *   · codex, claude, gemini, copilot, cursor, opencode, codebuddy, qwen, kimi — the person's own agents (agents.mjs):
 *     Codex, Claude Code, Gemini CLI, GitHub Copilot, Cursor, OpenCode, CodeBuddy, Qwen Code and Kimi. Their sign-in
 *     is their own: connecting uses it as it is, and opens Terminal for their own sign-in command only when they are
 *     not signed in; disconnecting only stops OpenFilm using them (their sign-in is shared with the makers' own apps,
 *     and stays). Codex and Claude Code are shown in the chat's menu from the start; the others once the person
 *     connects one or switches it on.
 *   · byok — the app's own agent (Pi, pi-agent.mjs) on the person's own key, on a standard API in one of three formats: the OpenAI
 *     Responses API (…/v1/responses), the OpenAI Chat Completions API (…/v1/chat/completions) or the Anthropic Messages
 *     API (…/v1/messages); Pi speaks each. The model has to read pictures (the agent looks at its own frames): setting
 *     it up sends one small request with a picture, and a model that cannot take it is refused.
 *
 * Each has a switch for whether the chat's menu shows it. Kept in the app's data folder: agents.json (the choices) and
 * byok.key (the key, sealed with the system's keychain by the caller's `seal`/`unseal`).
 *
 * State per agent: ready · off (disconnected here) · sign-in (its own sign-in is needed) · waiting (signing in, in
 * Terminal) · missing (not installed; `install` says where from) · key (no key set up) · checking (not known yet).
 *
 * Reads no Electron module, so `node --test` can use it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PI_APIS } from './pi-config.mjs';

/** The person's own agents, as agents.mjs AGENTS has them. */
export const OWN_AGENT_IDS = Object.freeze(['codex', 'claude', 'gemini', 'copilot', 'cursor', 'opencode', 'codebuddy', 'qwen', 'kimi']);
export const AGENT_IDS = Object.freeze([...OWN_AGENT_IDS, 'byok']);
export const AGENT_NAMES = Object.freeze({
  codex: 'Codex', claude: 'Claude Code', gemini: 'Gemini CLI', copilot: 'GitHub Copilot', cursor: 'Cursor', opencode: 'OpenCode',
  codebuddy: 'CodeBuddy', qwen: 'Qwen Code', kimi: 'Kimi', byok: 'Own key',
});
const isOwn = (id) => OWN_AGENT_IDS.includes(id);

/** The API formats a key can be for, and the address each starts with. */
export const BYOK_FORMATS = Object.freeze({
  responses: { name: 'OpenAI Responses API', baseUrl: 'https://api.openai.com/v1' },
  chat: { name: 'OpenAI Chat Completions API', baseUrl: 'https://api.openai.com/v1' },
  anthropic: { name: 'Anthropic Messages API', baseUrl: 'https://api.anthropic.com' },
});

/* the person's other agents: not shown until connected or switched on */
const DEFAULT_SHOWN = { codex: true, claude: true, byok: false };
/** How long a sign-in in Terminal is waited for, asked about every few seconds. */
const SIGN_IN_WAIT_MS = 5 * 60_000;
const SIGN_IN_POLL_MS = 3000;

/** A red 16 × 16 picture, for asking a model whether it reads pictures. */
const PROBE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGN4pqFBEmIY1TCqYfhqAACM5TYQULtblwAAAABJRU5ErkJggg==';
const PROBE_TEXT = 'What color is this picture? One word.';

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

/** The person's choices, as kept. */
export function readChoices(dataDir) {
  const raw = readJson(join(dataDir, 'agents.json'), {});
  const shown = { ...DEFAULT_SHOWN };
  for (const id of AGENT_IDS) if (typeof raw.shown?.[id] === 'boolean') shown[id] = raw.shown[id];
  const byok = raw.byok && typeof raw.byok === 'object' && Object.hasOwn(BYOK_FORMATS, raw.byok.format)
    ? { format: raw.byok.format, baseUrl: String(raw.byok.baseUrl ?? ''), model: String(raw.byok.model ?? ''), last4: String(raw.byok.last4 ?? '') }
    : null;
  return {
    shown,
    disconnected: Array.isArray(raw.disconnected) ? raw.disconnected.filter((id) => AGENT_IDS.includes(id)) : [],
    byok,
  };
}

function writeChoices(dataDir, choices) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'agents.json'), `${JSON.stringify(choices, null, 2)}\n`);
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
 * service's own words for what went wrong (a model that cannot take pictures is said so).
 * @param {{ format: string, baseUrl: string, key: string, model: string, fetch?: typeof fetch }} o
 */
export async function probeModel({ format, baseUrl, key, model, fetch: fetchImpl = fetch }) {
  const req = probeRequest(format, baseUrl, key, model);
  let res;
  try {
    res = await fetchImpl(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    return { ok: false, error: `The service could not be reached: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (res.ok) return { ok: true };
  const body = await res.text().catch(() => '');
  let message = body;
  try { message = JSON.parse(body)?.error?.message ?? body; } catch { /* not JSON */ }
  message = String(message).slice(0, 300);
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'The service did not accept this key.' };
  if (/image|vision|multimodal|modalit/i.test(message)) return { ok: false, error: 'This model cannot read pictures, and the agent has to look at its frames: choose one that does.', code: 'no-images' };
  if (res.status === 404 && !/model/i.test(message)) return { ok: false, error: `Nothing answers at ${req.url}: check the address and the API format.` };
  return { ok: false, error: message || `The service answered ${res.status}.` };
}

/**
 * The roster: the agents' state, the person's choices, and the actions Settings and the chat take on them.
 * `onChange(list)` hears every change (Settings and the chat both redraw from it).
 *
 * @param {{
 *   dataDir: string,
 *   localAgents: () => Promise<Array<{ id: string, cli: unknown, signedIn: boolean | null, install: string | null, setupRequired: string | null }>>,
 *   openSignIn: (id: string) => Promise<{ ok: boolean, error?: string }>,
 *   closeSessions: (id: string) => void,
 *   seal: (text: string) => Buffer, unseal: (data: Buffer) => string,
 *   onChange: (list: any[]) => void,
 *   fetch?: typeof fetch,
 * }} deps
 */
export function createRoster(deps) {
  const { dataDir } = deps;
  let choices = readChoices(dataDir);
  /** what is happening now, beyond what is kept: a sign-in waited for, an error to show */
  const live = { waiting: {}, errors: {} };
  let local = null;

  const keyFile = join(dataDir, 'byok.key');
  const byokKey = () => {
    try { return existsSync(keyFile) ? deps.unseal(readFileSync(keyFile)) : null; } catch { return null; }
  };

  function stateOf(id) {
    if (isOwn(id)) {
      const found = local?.find((a) => a.id === id);
      if (!found) return { status: 'checking' };
      if (!found.cli) return { status: 'missing', install: found.install ?? null, setupRequired: found.setupRequired ?? null };
      if (choices.disconnected.includes(id)) return { status: 'off' };
      if (found.signedIn === false) return { status: live.waiting[id] ? 'waiting' : 'sign-in' };
      return { status: 'ready' };
    }
    if (choices.disconnected.includes(id)) return { status: 'off' };
    if (!choices.byok || !byokKey()) return { status: 'key' };
    return { status: 'ready' };
  }

  function list() {
    return AGENT_IDS.map((id) => ({
      id,
      name: AGENT_NAMES[id],
      shown: choices.shown[id] ?? false,
      ...stateOf(id),
      ...(live.errors[id] ? { error: live.errors[id] } : {}),
      ...(id === 'byok' && choices.byok ? { byok: { format: choices.byok.format, baseUrl: choices.byok.baseUrl, model: choices.byok.model, last4: choices.byok.last4 } } : {}),
    }));
  }

  const changed = () => deps.onChange(list());
  const save = (next) => { choices = next; writeChoices(dataDir, choices); changed(); };

  async function refresh() {
    const found = await deps.localAgents().catch(() => null);
    local = found ?? local ?? [];
    changed();
    return list();
  }

  async function waitForSignIn(id) {
    live.waiting[id] = true;
    changed();
    const until = Date.now() + SIGN_IN_WAIT_MS;
    while (Date.now() < until && live.waiting[id]) {
      await new Promise((done) => setTimeout(done, SIGN_IN_POLL_MS));
      await refresh();
      if (local?.find((a) => a.id === id)?.signedIn !== false) break;
    }
    delete live.waiting[id];
    changed();
  }

  return {
    list,
    refresh,

    /** Connect: back on here; its own sign-in when it needs one. */
    async connect(id) {
      if (!AGENT_IDS.includes(id)) return { ok: false, error: `No agent ${id}` };
      delete live.errors[id];
      /* connecting one is choosing it: it is shown in the chat (and among the person's agents in Settings) */
      save({ ...choices, shown: { ...choices.shown, [id]: true }, disconnected: choices.disconnected.filter((a) => a !== id) });
      try {
        if (isOwn(id)) {
          deps.closeSessions(id);
          const [now] = (await refresh()).filter((a) => a.id === id);
          if (now?.status !== 'sign-in') return { ok: true };
          const opened = await deps.openSignIn(id);
          if (!opened.ok) { live.errors[id] = opened.error ?? 'Terminal did not open.'; changed(); return { ok: false, error: live.errors[id] }; }
          void waitForSignIn(id);
          return { ok: true };
        }
        await refresh();
        return { ok: true };
      } catch (e) {
        live.errors[id] = e instanceof Error ? e.message : String(e);
        changed();
        return { ok: false, error: live.errors[id] };
      }
    },

    /** Disconnect here only: its sessions close; an agent's own sign-in stays as it is. */
    disconnect(id) {
      if (!AGENT_IDS.includes(id)) return;
      delete live.waiting[id];
      deps.closeSessions(id);
      save({ ...choices, disconnected: [...new Set([...choices.disconnected, id])] });
    },

    setShown(id, shown) {
      if (!AGENT_IDS.includes(id)) return;
      save({ ...choices, shown: { ...choices.shown, [id]: shown === true } });
    },

    /**
     * The person's own key: checked (key accepted, model reads pictures) before it is kept. A key left empty keeps
     * the one kept already (the model or the address changed).
     * @param {{ format: string, baseUrl?: string, model: string, key?: string }} config
     */
    async configureByok(config) {
      const format = BYOK_FORMATS[config?.format];
      if (!format) return { ok: false, error: 'Choose the API format.' };
      const baseUrl = String(config.baseUrl || format.baseUrl).trim().replace(/\/+$/, '');
      if (!/^https?:\/\/[^\s]+$/.test(baseUrl)) return { ok: false, error: 'The address has to start with https:// (or http:// for one on this computer).' };
      const model = String(config.model ?? '').trim();
      if (!model) return { ok: false, error: 'Name the model.' };
      const key = String(config.key ?? '').trim() || byokKey();
      if (!key) return { ok: false, error: 'Paste the key.' };
      const probe = await probeModel({ format: config.format, baseUrl, key, model, fetch: deps.fetch });
      if (!probe.ok) return probe;
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(keyFile, deps.seal(key), { mode: 0o600 });
      delete live.errors.byok;
      save({
        ...choices,
        shown: { ...choices.shown, byok: true },
        disconnected: choices.disconnected.filter((a) => a !== 'byok'),
        byok: { format: config.format, baseUrl, model, last4: key.slice(-4) },
      });
      deps.closeSessions('byok');
      changed();
      return { ok: true };
    },

    /**
     * What a session of the app's own agent runs with (pi-agent.mjs): Pi's own folder, the service (Pi's provider:
     * its API, address and the variable its key is in), the model, and the key itself (`env`).
     */
    harness(id) {
      if (id !== 'byok') return null;
      const key = byokKey();
      if (!choices.byok || !key) return null;
      const { format, baseUrl, model } = choices.byok;
      const provider = { id: 'byok', api: PI_APIS[format], baseUrl, apiKeyEnv: 'OPENFILM_BYOK_KEY' };
      return { home: join(dataDir, 'agents', 'byok', 'pi'), provider, model, env: { OPENFILM_BYOK_KEY: key } };
    },
  };
}
