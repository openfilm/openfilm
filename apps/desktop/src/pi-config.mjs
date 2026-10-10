/**
 * What the app's own agent (Pi, src/pi-agent.mjs) runs with, and how what it does reads in the chat (ACP).
 *
 * The service is one provider in Pi's `models.json`: the OpenFilm agent's (openfilm.dev's Chat Completions) or the
 * person's own key on one of three APIs. A model's efforts are the service's names (a `reasoning.effort`, or thinking
 * on / off): each is one of Pi's thinking levels, and the model's `thinkingLevelMap` gives it back as the service's
 * `reasoning: { effort }` takes it (thinking off is `none`, on its default, `medium`).
 *
 * Reads no Electron module, so `node --test` can use it.
 */
import { API_ERROR_CODES, apiErrorCode, isApiErrorCode } from '@openfilm/shared/api/error-codes';

/** The person's own key's API, as Pi names it. */
export const PI_APIS = Object.freeze({ chat: 'openai-completions', responses: 'openai-responses', anthropic: 'anthropic-messages' });

/** Pi's thinking level for an effort the service names. */
const LEVELS = { off: 'off', on: 'medium', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' };
export const thinkingLevel = (effort) => (typeof effort === 'string' ? LEVELS[effort] ?? null : null);

/** An effort as `reasoning.effort` names it, where it names it otherwise. */
const OPENROUTER_EFFORT = { off: 'none', on: 'medium' };

/** A context length for a model the service does not describe (the person's own key). */
const UNKNOWN_CONTEXT = 128_000;

/**
 * Pi's `models.json` for the service.
 * @param {{ id: string, api: string, baseUrl: string, apiKeyEnv: string, models: Array<{ id: string, name?: string, context?: number, efforts?: string[] }>, openrouter?: boolean }} provider
 */
export function modelsJson(provider) {
  return {
    providers: {
      [provider.id]: {
        baseUrl: provider.baseUrl,
        api: provider.api,
        apiKey: `$${provider.apiKeyEnv}`,
        models: provider.models.map((m) => {
          const efforts = (m.efforts ?? []).filter((e) => thinkingLevel(e));
          const map = Object.fromEntries(Object.values(LEVELS).map((level) => [level, null]));
          for (const effort of efforts) map[thinkingLevel(effort)] = OPENROUTER_EFFORT[effort] ?? effort;
          const context = Number.isInteger(m.context) && m.context > 0 ? m.context : UNKNOWN_CONTEXT;
          return {
            id: m.id,
            name: m.name ?? m.id,
            input: ['text', 'image'],
            contextWindow: context,
            maxTokens: Math.min(65_536, Math.floor(context / 4)),
            reasoning: efforts.length > 0,
            ...(efforts.length ? { thinkingLevelMap: map } : {}),
            /* the OpenFilm agent's service: its thinking in the format the service takes */
            ...(provider.openrouter ? { compat: { thinkingFormat: 'openrouter' } } : {}),
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          };
        }),
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
 * API's status and its words ("402 …"). The OpenFilm agent's are told by their code (`openfilmCode`).
 */
const NO_BALANCE = /(?:^|[\s"':])402\s|payment required|insufficient_quota|insufficient[ _]balance|credit balance is too low|exhausted balance|credits are depleted/i;

/**
 * The OpenFilm API's error code (@openfilm/shared, API_ERROR_CODES) an error carries: its body's, else the first
 * code its words name, else null.
 */
function openfilmCode(data, said) {
  const code = apiErrorCode(data && typeof data === 'object' ? data : null);
  if (isApiErrorCode(code)) return code;
  return API_ERROR_CODES.find((c) => new RegExp(`\\b${c}\\b`).test(said)) ?? null;
}

/**
 * The service an answer failed on for want of balance, and where it is topped up, the same for every service: an
 * Error with `code: 'balance'` and `balance: { provider, url, kind: 'balance' }` (url null for a service not known
 * here), else null. The OpenFilm agent's 402 `daily_limit` (the daily spending limit the person set on the account
 * page) is told the same way, with `kind: 'daily-limit'` and the page where it is changed.
 * @param {{ id: string, baseUrl: string }} provider Pi's provider (`harness(id).provider`) @param {unknown} error
 */
export function outOfBalance(provider, error) {
  const e = /** @type {any} */ (error);
  const said = [e?.message, typeof e?.data === 'string' ? e.data : JSON.stringify(e?.data ?? '')].filter(Boolean).join(' ').replace(/^Internal error:\s*/i, '');
  let host = '', origin = '';
  try { ({ host, origin } = new URL(provider.baseUrl)); } catch { /* no address: named by its id */ }
  const code = openfilmCode(e?.data, said);
  if (provider.id === 'openfilm' && code === 'daily_limit') {
    const balance = { provider: 'OpenFilm', url: `${origin}/account#billing`, kind: 'daily-limit' };
    return Object.assign(new Error('Your OpenFilm account has reached the daily spending limit you set. Change it in your account, or switch to another service, then try again.'),
      { code: 'daily-limit', balance });
  }
  if (code !== 'insufficient_credits' && !NO_BALANCE.test(said)) return null;
  const known = provider.id === 'openfilm' ? { name: 'OpenFilm', url: `${origin}/account` } : BILLING.find((b) => b.host.test(host.replace(/:\d+$/, '')));
  const balance = { provider: known?.name ?? (host || provider.id), url: known?.url ?? null, kind: 'balance' };
  return Object.assign(new Error(`${balance.provider} doesn't have enough balance for this. Top it up there, or switch to another service, then try again.`), { code: 'balance', balance });
}
