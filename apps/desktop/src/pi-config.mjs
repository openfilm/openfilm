/**
 * What the app's own agent (Pi, src/pi-agent.mjs) runs with, and how what it does reads in the chat (ACP).
 *
 * The service is one provider in Pi's `models.json`: the person's own key on one of three APIs, with the one model
 * they named.
 *
 * Reads no Electron module, so `node --test` can use it.
 */

/** The person's own key's API, as Pi names it. */
export const PI_APIS = Object.freeze({ chat: 'openai-completions', responses: 'openai-responses', anthropic: 'anthropic-messages' });

/** A context length for a model the service does not describe. */
const CONTEXT = 128_000;

/**
 * Pi's `models.json` for the service and its model.
 * @param {{ id: string, api: string, baseUrl: string, apiKeyEnv: string }} provider @param {string} model
 */
export function modelsJson(provider, model) {
  return {
    providers: {
      [provider.id]: {
        baseUrl: provider.baseUrl,
        api: provider.api,
        apiKey: `$${provider.apiKeyEnv}`,
        models: [{
          id: model,
          name: model,
          input: ['text', 'image'],
          contextWindow: CONTEXT,
          maxTokens: Math.floor(CONTEXT / 4),
          reasoning: false,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        }],
      },
    },
  };
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
