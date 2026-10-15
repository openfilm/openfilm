/**
 * What the app's own agent (Pi, src/pi-agent.mjs) runs with, and how what it does reads in the chat (ACP).
 *
 * The person's own models, each set up on its own (agent-roster.mjs): its name, its service (an address on one of three
 * APIs, and its own key), the model asked for there and its reasoning efforts. Each is a provider of its own in Pi's
 * `models.json`, so the chat's menu switches between them (`modelOption`), one service to another.
 *
 * Reads no Electron module, so `node --test` can use it.
 */

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

/**
 * One of the person's own models as the agent runs it: `id` (the app's, never shown), `name` (the menu's), Pi's `api`,
 * the service's `baseUrl`, the variable its key is in (`keyEnv`), the `model` asked for there and its efforts.
 * @typedef {{ id: string, name: string, api: string, baseUrl: string, keyEnv: string, model: string, levels: string[], effort: string }} OwnModel
 */

/** Pi's provider for one of the person's own models: each its own service. */
export const providerOf = (/** @type {string} */ id) => `byok-${id}`;

/** The provider that thinks: the same service, its models told which levels they take. */
export const THINKING = (/** @type {string} */ id) => `${id}-thinking`;

/* what a level is called on the wire: Pi's own names, but "none" for off on OpenAI's APIs */
const wire = (/** @type {string} */ api, /** @type {string} */ level) => (level === 'off' && api !== 'anthropic-messages' ? 'none' : level);

/** A context length for a model the service does not describe. */
const CONTEXT = 128_000;

/**
 * Pi's `models.json` for the person's own models: each its own provider (its address and key), twice when it offers
 * levels: as itself, told not to reason (`auto`: no reasoning setting is sent), and as THINKING(provider) told exactly
 * which levels it takes (Pi sends the one picked; the others are not there).
 * @param {OwnModel[]} models
 */
export function modelsJson(models) {
  const entry = (/** @type {OwnModel} */ m, /** @type {string[] | null} */ levels) => ({
    id: m.model,
    name: m.name,
    input: ['text', 'image'],
    contextWindow: CONTEXT,
    maxTokens: Math.floor(CONTEXT / 4),
    reasoning: Boolean(levels),
    ...(levels ? { thinkingLevelMap: Object.fromEntries(EFFORTS.slice(1).map((l) => [l, levels.includes(l) ? wire(m.api, l) : null])) } : {}),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  });
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

/** A tool call as the chat reads it (ACP): its kind, its title, and what it was run with. */
export function toolCall(name, args) {
  const a = args && typeof args === 'object' ? args : {};
  const path = typeof a.path === 'string' ? a.path : typeof a.file_path === 'string' ? a.file_path : '';
  switch (name) {
    case 'bash': return { kind: 'execute', title: String(a.command ?? 'bash'), rawInput: { command: String(a.command ?? '') } };
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

/** How a run ended, as ACP says it, from Pi's last answer; an error is thrown (the chat shows it). */
export function stopReason(message) {
  switch (message?.stopReason) {
    case 'length': return 'max_tokens';
    case 'aborted': return 'cancelled';
    case 'error': throw new Error(String(message.errorMessage || 'The model did not answer.'));
    default: return 'end_turn';
  }
}

/** How full the context is after an answer (ACP usage_update): what the conversation takes, of the model's window. */
export function contextUsed(message, model) {
  const u = message?.usage;
  if (!u || !model?.contextWindow) return null;
  return { used: (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) + (u.output ?? 0), size: model.contextWindow };
}

/** Where each service the person's own key may be for is topped up, by its address. */
const BILLING = [
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
