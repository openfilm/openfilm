/**
 * What the app's own agent (Pi, src/pi-agent.mjs) runs with, and how what it does reads in the chat (ACP).
 *
 * The person's own models, each set up on its own (agent-roster.mjs): its name, its service (an address on one of three
 * APIs, and its own key), the model asked for there, its reasoning efforts and its context length. Each is a provider
 * of its own in Pi's `models.json`, so the chat's menu switches between them (`modelOption`), one service to another.
 *
 * Reads no Electron module, so `node --test` can use it.
 */
import { createHash } from 'node:crypto';

/** The person's own key's API, as Pi names it. */
export const PI_APIS = Object.freeze({ chat: 'openai-completions', responses: 'openai-responses', anthropic: 'anthropic-messages' });

/**
 * The reasoning efforts a model of the person's own can offer, in order: `auto` sends no reasoning setting (the
 * service decides, as it always did), the others are Pi's thinking levels. Which of them a model offers is the
 * person's to say in Settings (OpenFilm cannot know what a service's model takes); a model they said nothing of offers
 * `auto` alone.
 */
export const EFFORTS = Object.freeze(['auto', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

/** The efforts a model offers, as kept: known ones, each once, in EFFORTS' order; `auto` alone when none. */
export function effortLevels(value) {
  const asked = new Set(Array.isArray(value) ? value.map(String) : []);
  const levels = EFFORTS.filter((e) => asked.has(e));
  return levels.length ? levels : ['auto'];
}

/**
 * A model's efforts: the ones it offers (`levels`) and the one a conversation starts on (`effort`, one of them; the
 * first when the one asked is not).
 * @returns {{ levels: string[], effort: string }}
 */
export function modelEffort(/** @type {unknown} */ levels, /** @type {unknown} */ effort) {
  const offered = effortLevels(levels);
  return { levels: offered, effort: offered.includes(String(effort)) ? String(effort) : offered[0] };
}

/** A context length for a model the person gave none: 128K. */
const CONTEXT = 128_000;
/** The most a model is asked to write in one answer: a quarter of 128K, so a long context does not ask for more. */
const MAX_OUTPUT = 32_000;

/**
 * The desktop's request-size guard, including base64 pictures. Gateways may accept less than the model's own API;
 * a 413 lowers the session's picture budget. Leave room for the provider's envelope and tool serialization too.
 */
export const IMAGE_BUDGET = 32 * 1024 * 1024;
const REQUEST_HEADROOM = 1024 * 1024;
/** A model service refusing a request as too large: HTTP 413, as services and the proxies before them say it. */
export const TOO_LARGE = /^\s*413\b|request entity too large|payload too large|request_too_large|request too large/i;

/**
 * Claude Code's published strategy: leave history intact until a request exceeds a size/count limit, then remove
 * a batch of the oldest pictures with room for more. https://code.claude.com/docs/en/prompt-caching#accumulating-many-images
 * `omitted` identifies occurrences, not files: rereading the same file adds a new picture. Persist these keys in Pi's
 * custom session entries so an omitted picture stays omitted across requests, compaction and session restoration.
 * The original conversation and files remain intact. Pi owns token-based compaction.
 * @param {any[]} messages @param {number} budget
 * @param {{ omitted?: Set<string>, maxImages?: number, maxRequestBytes?: number, headroom?: number }} options
 */
export function fitImages(messages, budget, { omitted = new Set(), maxImages = 100, maxRequestBytes = IMAGE_BUDGET, headroom = 0.5 } = {}) {
  /* which file each tool call read, to name a picture left out */
  const paths = new Map();
  for (const m of messages) {
    if (m?.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const c of m.content) if (c?.type === 'toolCall' && typeof c.arguments?.path === 'string') paths.set(c.id, c.arguments.path);
  }
  const pictures = [];
  const byMessage = new Map();
  for (const m of messages) {
    if (!Array.isArray(m?.content) || !m.content.some((c) => c?.type === 'image')) continue;
    const blocks = new Map();
    byMessage.set(m, blocks);
    const identity = m.toolCallId ?? `${m.timestamp ?? 0}:${createHash('sha256').update(JSON.stringify(m.content)).digest('hex')}`;
    for (let i = 0; i < m.content.length; i++) {
      const block = m.content[i];
      if (block.type !== 'image') continue;
      const picture = { key: `${m.role}:${identity}:${i}`, size: String(block.data ?? '').length };
      pictures.push(picture);
      blocks.set(i, picture);
    }
  }
  // Count text/tools without copying every historical base64 payload, including already omitted pictures.
  const textBytes = Buffer.byteLength(JSON.stringify(messages, (_key, value) => value?.type === 'image' && typeof value.data === 'string'
    ? { ...value, data: '' } : value));
  const byteLimit = Math.max(0, Math.min(budget, maxRequestBytes - textBytes - REQUEST_HEADROOM));
  const remaining = pictures.filter((p) => !omitted.has(p.key));
  let kept = remaining.reduce((n, p) => n + p.size, 0);
  let count = remaining.length;
  const reason = kept > byteLimit ? 'bytes' : count > maxImages ? 'count' : null;
  const pruned = [];
  if (reason) {
    for (const picture of remaining) {
      if (kept <= byteLimit * headroom && count <= Math.floor(maxImages * headroom)) break;
      if (count === 1 && kept <= byteLimit && count <= maxImages) break;
      omitted.add(picture.key);
      pruned.push(picture.key);
      kept -= picture.size;
      count--;
    }
  }
  const removed = pictures.length - count;
  const out = removed ? messages.map((m) => {
    const blocks = byMessage.get(m);
    if (!blocks || ![...blocks.values()].some((p) => omitted.has(p.key))) return m;
    const path = m.role === 'toolResult' ? paths.get(m.toolCallId) : undefined;
    return { ...m, content: m.content.map((b, i) => b.type === 'image' && omitted.has(blocks.get(i).key)
      ? { type: 'text', text: `[A picture${path ? ` (${path})` : ''} was left out of this request to keep it small. Read it again to see it.]` }
      : b) };
  }) : messages;
  return { messages: out, kept, removed, pruned, reason };
}

/**
 * A model's context length as kept: a whole number of tokens from 32K to 10M, as the person gave it in Settings (the
 * service documents it; OpenFilm cannot know it). Null for none or anything else: the model gets 128K.
 */
export function contextLength(/** @type {unknown} */ value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 32_000 && value <= 10_000_000 ? value : null;
}

/**
 * One of the person's own models as the agent runs it: `id` (the app's, never shown), `name` (the menu's), Pi's `api`,
 * the service's `baseUrl`, the variable its key is in (`keyEnv`), the `model` asked for there, its efforts and its
 * `context` length in tokens (128K when none).
 * @typedef {{ id: string, name: string, api: string, baseUrl: string, keyEnv: string, model: string, levels: string[], effort: string, context?: number, compat?: Record<string, unknown> }} OwnModel
 */

/** Pi's provider for one of the person's own models: each its own service. */
export const providerOf = (/** @type {string} */ id) => `byok-${id}`;

/** The provider that thinks: the same service, its models told which levels they take. */
export const THINKING = (/** @type {string} */ id) => `${id}-thinking`;

/* what a level is called on the wire: Pi's own names, but "none" for off on OpenAI's APIs */
const wire = (/** @type {string} */ api, /** @type {string} */ level) => (level === 'off' && api !== 'anthropic-messages' ? 'none' : level);

/**
 * Pi's `models.json` for the person's own models: each its own provider (its address and key), twice when it offers
 * levels: as itself, told not to reason (`auto`: no reasoning setting is sent), and as THINKING(provider) told exactly
 * which levels it takes (Pi sends the one picked; the others are not there).
 * @param {OwnModel[]} models
 */
export function modelsJson(models) {
  const entry = (/** @type {OwnModel} */ m, /** @type {string[] | null} */ levels) => {
    const context = contextLength(m.context) ?? CONTEXT;
    return {
      id: m.model,
      name: m.name,
      input: ['text', 'image'],
      contextWindow: context,
      maxTokens: Math.min(Math.floor(context / 4), MAX_OUTPUT),
      reasoning: Boolean(levels),
      ...(m.compat ? { compat: m.compat } : {}),
      ...(levels ? { thinkingLevelMap: Object.fromEntries(EFFORTS.slice(1).map((l) => [l, levels.includes(l) ? wire(m.api, l) : null])) } : {}),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
  };
  /** @type {Record<string, any>} */
  const providers = {};
  for (const m of models) {
    const service = { baseUrl: m.baseUrl, api: m.api, apiKey: `$${m.keyEnv}` };
    const levels = m.levels.filter((l) => l !== 'auto');
    providers[providerOf(m.id)] = { ...service, models: [entry(m, null)] };
    if (levels.length) providers[THINKING(providerOf(m.id))] = { ...service, models: [entry(m, levels)] };
  }
  return { providers };
}

/** The model as a config option the chat's menu reads (ACP): the person's models by their names, and the one a session runs. */
export function modelOption(/** @type {Array<{ id: string, name: string }>} */ models, /** @type {string} */ current) {
  return { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: current, options: models.map((m) => ({ value: m.id, name: m.name })) };
}

const EFFORT_NAMES = { auto: 'Auto', off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };

/** The reasoning effort as a config option (ACP), for a model offering more than one; null otherwise. */
export function effortOption(/** @type {string[]} */ levels, /** @type {string} */ current) {
  if (levels.length < 2) return null;
  return { id: 'effort', name: 'Effort', category: 'thought_level', type: 'select', currentValue: current,
    options: levels.map((l) => ({ value: l, name: EFFORT_NAMES[/** @type {keyof typeof EFFORT_NAMES} */ (l)] ?? l })) };
}

/**
 * Pi's tools for the app's own agent. Its commands run in PowerShell on Windows: Pi's `bash` there needs Git Bash,
 * which most people do not have, and failed every command without it. PowerShell comes with Windows.
 */
export function agentTools(platform = process.platform) {
  return ['read', platform === 'win32' ? 'powershell' : 'bash', 'edit', 'write', 'ask'];
}

/** A tool call as the chat reads it (ACP): its kind, its title, and what it was run with. */
export function toolCall(name, args, connectorLabels) {
  const a = args && typeof args === 'object' ? args : {};
  /* a connector's tool (pi-connectors.mjs): its service and its own title */
  const connector = connectorLabels?.get(name);
  if (connector) return { kind: connector.readOnly ? 'fetch' : 'other', title: connector.title, rawInput: a };
  const path = typeof a.path === 'string' ? a.path : typeof a.file_path === 'string' ? a.file_path : '';
  switch (name) {
    case 'bash': case 'powershell': return { kind: 'execute', title: String(a.command ?? name), rawInput: { command: String(a.command ?? '') } };
    case 'read': return { kind: 'read', title: `Read ${path}`, rawInput: { path } };
    case 'edit': return { kind: 'edit', title: `Edit ${path}`, rawInput: { path } };
    case 'write': return { kind: 'edit', title: `Write ${path}`, rawInput: { path } };
    case 'ask': return { kind: 'other', title: String(a.questions?.[0]?.question ?? 'Ask'), rawInput: a };
    case 'grep': case 'find': case 'ls': return { kind: 'search', title: `${name} ${String(a.pattern ?? a.path ?? '')}`.trim(), rawInput: a };
    default: return { kind: 'other', title: name, rawInput: a };
  }
}

/** A tool's result as ACP content: its text, and its pictures (a frame it read). */
export function toolContent(result) {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  return blocks.flatMap((b) => (b?.type === 'text' && typeof b.text === 'string' ? [{ type: 'content', content: { type: 'text', text: b.text } }]
    : b?.type === 'image' && typeof b.data === 'string' ? [{ type: 'content', content: { type: 'image', data: b.data, mimeType: String(b.mimeType ?? 'image/png') } }]
      : []));
}

/**
 * How a run ended, as ACP says it, from Pi's last answer; an error is thrown (the chat shows it), in plain words
 * (`failureText`), with Pi's own words as its `details`.
 */
export function stopReason(message, modelConnection = null) {
  switch (message?.stopReason) {
    case 'length': return 'max_tokens';
    case 'aborted': return 'cancelled';
    case 'error': {
      const said = String(message.errorMessage || 'The model did not answer.');
      throw Object.assign(new Error(failureText(said)), { details: said, ...(modelConnection ? { modelConnection } : {}) });
    }
    default: return 'end_turn';
  }
}

/** How long Pi waits for a model service to send anything (pi-agent.mjs), before it tries once more. */
export const WAIT_MINUTES = 15;

/* what the model service's client says when no answer came in time */
const TIMED_OUT = /request timed out|headers timeout|body timeout/i;
const GATEWAY_TIMEOUT = /^\s*(?:504|524)\b|origin_response_timeout|upstream_timeout|timed out waiting for Volcengine|error 524: a timeout occurred/i;
const GATEWAY_TIMEOUT_HINT = 'The model service took too long to respond. Try again or switch models.';
const CONNECTION_LOST = /^(?:connection error|network error|fetch failed|terminated|socket hang up)\.?$|^(?:read )?ECONNRESET\b|^other side closed\b/i;
const CONNECTION_LOST_HINT = 'The connection to the model service was interrupted. Continue to pick up this task.';

export function isModelConnectionError(said) {
  return CONNECTION_LOST.test(String(said ?? '').trim());
}
/* a conversation longer than the model takes: as Pi says it, then as services commonly do */
const PI_OVERFLOW = /^context overflow recovery failed/i;
const OVERFLOW = /context (?:length|window|size)|prompt (?:is )?too long/i;
const CONTEXT_HINT = "The model's context may be smaller than set in Settings: lower it there.";

/** Why a turn failed, in plain words where Pi's own are technical; anything else as Pi said it. */
export function failureText(said) {
  const text = String(said ?? '').trim();
  if (GATEWAY_TIMEOUT.test(text)) return GATEWAY_TIMEOUT_HINT;
  if (TIMED_OUT.test(text)) return 'The model request timed out. Check the connection to the service, then try again.';
  if (isModelConnectionError(text)) return CONNECTION_LOST_HINT;
  if (PI_OVERFLOW.test(text)) return `${text} ${CONTEXT_HINT}`;
  if (OVERFLOW.test(text)) return `The conversation is too long for the model. ${CONTEXT_HINT}`;
  if (TOO_LARGE.test(text)) return 'The request is too large for the model service, even with older pictures left out. Send your message again to go on with fewer, or start a new conversation.';
  return text;
}

/**
 * Pi trying a model service again after it failed (its `auto_retry_start`), as the notice the chat shows: a service that
 * sent nothing in time in plain words, anything else with Pi's own.
 */
export function retryNotice(event) {
  const said = String(event?.errorMessage ?? '').trim();
  const again = `trying again (${event?.attempt ?? 1} of ${event?.maxAttempts ?? 1}).`;
  if (isModelConnectionError(said)) return { sessionUpdate: 'notice', severity: 'warning', title: `Connection to the model service was interrupted; ${again}`, _meta: { openfilm: { noticeKey: 'composer.modelConnectionRetry' } } };
  if (GATEWAY_TIMEOUT.test(said)) return { sessionUpdate: 'notice', severity: 'warning', title: `The model service took too long to respond; ${again}`, _meta: { openfilm: { noticeKey: 'composer.modelTimeoutRetry' } } };
  if (TOO_LARGE.test(said)) return { sessionUpdate: 'notice', severity: 'warning', title: `The request was too large for the model service; ${again.replace(/\.$/, '')} with half of the older pictures left out.` };
  if (TIMED_OUT.test(said)) return { sessionUpdate: 'notice', severity: 'warning', title: `The model request timed out; ${again}`, description: said };
  return { sessionUpdate: 'notice', severity: 'warning', title: `The model service failed; ${again}`, ...(said ? { description: said } : {}) };
}

/** How full the context is after an answer (ACP usage_update): what the conversation takes, of the model's window. */
export function contextUsed(message, model) {
  const u = message?.usage;
  if (!u || !model?.contextWindow) return null;
  return { used: (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) + (u.output ?? 0), size: model.contextWindow };
}

/** Where each service the person's own key may be for is topped up, by its address. */
const BILLING = [
  { host: /(^|\.)openfilm\.dev$/, name: 'OpenFilm', url: 'https://openfilm.dev/account' },
  { host: /(^|\.)openai\.com$/, name: 'OpenAI', url: 'https://platform.openai.com/settings/organization/billing' },
  { host: /(^|\.)anthropic\.com$/, name: 'Anthropic', url: 'https://console.anthropic.com/settings/billing' },
  { host: /(^|\.)openrouter\.ai$/, name: 'OpenRouter', url: 'https://openrouter.ai/settings/credits' },
  { host: /(^|\.)deepseek\.com$/, name: 'DeepSeek', url: 'https://platform.deepseek.com/top_up' },
  { host: /(^|\.)googleapis\.com$/, name: 'Google Gemini', url: 'https://aistudio.google.com/apikey' },
];

/**
 * When the model's service has no balance left for an answer, as each says it (not a plain rate limit): others' 402
 * (OpenRouter, DeepSeek), OpenAI's `insufficient_quota`, Anthropic's "credit balance is too low". Pi's error is the
 * API's status and its words ("402 …").
 */
const NO_BALANCE = /(?:^|[\s"':])402\s|payment required|insufficient_quota|insufficient[ _]balance|credit balance is too low|exhausted balance|credits are depleted/i;

/**
 * The service an answer failed on for want of balance, and where it is topped up, the same for every service: an
 * Error with `code: 'balance'` and `balance: { provider, url }` (url null for a service not known here), else null.
 * @param {{ id: string, baseUrl: string }} provider Pi's provider (`harness(id).provider`) @param {unknown} error
 */
export function outOfBalance(provider, error) {
  const e = /** @type {any} */ (error);
  const said = [e?.message, typeof e?.data === 'string' ? e.data : JSON.stringify(e?.data ?? '')].filter(Boolean).join(' ').replace(/^Internal error:\s*/i, '');
  if (!NO_BALANCE.test(said)) return null;
  let host = '';
  try { ({ host } = new URL(provider.baseUrl)); } catch { /* no address: named by its id */ }
  const known = BILLING.find((b) => b.host.test(host.replace(/:\d+$/, '')));
  const balance = { provider: known?.name ?? (host || provider.id), url: known?.url ?? null };
  return Object.assign(new Error(`${balance.provider} doesn't have enough balance for this. Top it up there, or switch to another service, then try again.`), { code: 'balance', balance });
}
