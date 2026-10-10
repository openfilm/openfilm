import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextUsed, modelsJson, outOfBalance, stopReason, thinkingLevel, toolCall, toolContent } from './pi-config.mjs';

test('a service is one provider in Pi\'s models.json; each effort a model names is one of Pi\'s thinking levels', () => {
  const json = modelsJson({ id: 'openfilm', api: 'openai-completions', baseUrl: 'https://openfilm.test/v1/agent', apiKeyEnv: 'OPENFILM_AGENT_KEY', openrouter: true, models: [
    { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', context: 1_048_576, efforts: ['low', 'high', 'max'] },
    { id: 'xiaomi/mimo-v2.6-pro', name: 'MiMo V2.6 Pro', efforts: ['off', 'on'] },
  ] });
  const p = json.providers.openfilm;
  assert.equal(p.apiKey, '$OPENFILM_AGENT_KEY', 'the key from its variable, never written down');
  const [ds, mimo] = p.models;
  assert.equal(ds.contextWindow, 1_048_576);
  assert.equal(ds.reasoning, true);
  assert.deepEqual(Object.entries(ds.thinkingLevelMap).filter(([, v]) => v), [['low', 'low'], ['high', 'high'], ['max', 'max']]);
  assert.equal(ds.thinkingLevelMap.medium, null, 'DeepSeek has no medium');
  assert.deepEqual(ds.compat, { thinkingFormat: 'openrouter' });
  assert.deepEqual(Object.entries(mimo.thinkingLevelMap).filter(([, v]) => v), [['off', 'none'], ['medium', 'medium']], 'thinking off and on, as the service names them');
  assert.equal(mimo.contextWindow, 128_000, 'a length when the service gives none');
  assert.equal(thinkingLevel('on'), 'medium');
  assert.equal(thinkingLevel('nonsense'), null);
  const own = modelsJson({ id: 'byok', api: 'openai-completions', baseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'K', models: [{ id: 'm' }] }).providers.byok.models[0];
  assert.equal(own.reasoning, false);
  assert.equal(own.compat, undefined, 'a service of the person\'s own: Pi knows it by its address');
});

test('what Pi does reads in the chat as Codex\'s did: a command\'s kind and title, a file\'s path, the result\'s text and pictures', () => {
  assert.deepEqual(toolCall('bash', { command: 'openfilm look' }), { kind: 'execute', title: 'openfilm look', rawInput: { command: 'openfilm look' } });
  assert.deepEqual(toolCall('read', { path: 'film.html' }), { kind: 'read', title: 'Read film.html', rawInput: { path: 'film.html' } });
  assert.equal(toolCall('write', { path: 'a.html' }).kind, 'edit');
  assert.deepEqual(toolContent({ content: [{ type: 'text', text: 'ok' }, { type: 'image', data: 'AA', mimeType: 'image/png' }] }), [
    { type: 'content', content: { type: 'text', text: 'ok' } },
    { type: 'content', content: { type: 'image', data: 'AA', mimeType: 'image/png' } },
  ]);
  assert.equal(stopReason({ stopReason: 'toolUse' }), 'end_turn');
  assert.equal(stopReason({ stopReason: 'aborted' }), 'cancelled');
  assert.throws(() => stopReason({ stopReason: 'error', errorMessage: '400 bad' }), /400 bad/);
  assert.deepEqual(contextUsed({ usage: { input: 100, cacheRead: 900, cacheWrite: 0, output: 50 } }, { contextWindow: 10_000 }), { used: 1050, size: 10_000 });
});

test('no balance left, as each service says it, is one outcome with the service\'s own page; a rate limit or another error is not', () => {
  const openfilm = { id: 'openfilm', baseUrl: 'https://openfilm.test/v1/agent' };
  const own = (baseUrl) => ({ id: 'byok', baseUrl });
  const balance = (provider, message) => {
    const found = outOfBalance(provider, new Error(message))?.balance;
    if (!found) return null;
    const { kind, ...rest } = found;
    assert.equal(kind, 'balance');
    return rest;
  };
  assert.deepEqual(balance(openfilm, 'Internal error: 402 {"error":"insufficient_credits","message":"Not enough credits"}'), { provider: 'OpenFilm', url: 'https://openfilm.test/account' });
  assert.deepEqual(balance(own('https://api.openai.com/v1'), '429 You exceeded your current quota, please check your plan and billing details. (insufficient_quota)'),
    { provider: 'OpenAI', url: 'https://platform.openai.com/settings/organization/billing' });
  assert.deepEqual(balance(own('https://api.anthropic.com/v1'), '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'),
    { provider: 'Anthropic', url: 'https://console.anthropic.com/settings/billing' });
  assert.deepEqual(balance(own('https://openrouter.ai/api/v1'), '402 This request requires more credits, or fewer max_tokens.'), { provider: 'OpenRouter', url: 'https://openrouter.ai/settings/credits' });
  assert.deepEqual(balance(own('https://llm.example.com:8443/v1'), '402 Payment Required'), { provider: 'llm.example.com:8443', url: null }, 'a service not known here: named, no page');
  /* the reason can come as the error's data (ACP's internal error) */
  assert.equal(outOfBalance(openfilm, { message: 'Internal error', data: { details: '402 insufficient_credits' } })?.code, 'balance');
  assert.equal(balance(own('https://api.openai.com/v1'), '429 Rate limit reached for gpt-6 in organization org-1 on tokens per min'), null);
  assert.equal(balance(own('https://api.anthropic.com/v1'), '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'), null);
  assert.equal(balance(openfilm, 'Internal error: 401 key revoked'), null);
  assert.equal(outOfBalance(openfilm, new Error('402 insufficient_credits')).message,
    "OpenFilm doesn't have enough balance for this. Top it up there, or switch to another service, then try again.");

  /* the OpenFilm account's daily spending limit: its own outcome, with where it is changed */
  const limit = outOfBalance(openfilm, new Error('Internal error: 402 {"error":"daily_limit","message":"The OpenFilm account has reached its daily spending limit. Change it at openfilm.dev/account."}'));
  assert.equal(limit.code, 'daily-limit');
  assert.deepEqual(limit.balance, { provider: 'OpenFilm', url: 'https://openfilm.test/account#billing', kind: 'daily-limit' });
  assert.equal(limit.message, 'Your OpenFilm account has reached the daily spending limit you set. Change it in your account, or switch to another service, then try again.');
});
