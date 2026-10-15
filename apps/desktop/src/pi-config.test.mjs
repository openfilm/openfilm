import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THINKING, contextUsed, effortOption, modelEffort, modelOption, modelsJson, outOfBalance, providerOf, stopReason, toolCall, toolContent } from './pi-config.mjs';

/** One of the person's own models, as the roster's harness gives it. */
const own = (id, over = {}) => ({ id, name: id.toUpperCase(), api: 'openai-completions', baseUrl: `https://${id}.test/v1`, keyEnv: `K_${id}`, model: `${id}-model`, levels: ['auto'], effort: 'auto', ...over });

test("each of the person's models is a provider of its own in Pi's models.json: its address, its key's variable, its model", () => {
  const json = modelsJson([own('a'), own('b', { api: 'anthropic-messages' })]);
  assert.deepEqual(Object.keys(json.providers), [providerOf('a'), providerOf('b')], 'nobody thinks: no thinking services');
  const a = json.providers[providerOf('a')];
  assert.equal(a.apiKey, '$K_a', 'the key from its variable, never written down');
  assert.equal(a.baseUrl, 'https://a.test/v1');
  assert.equal(a.api, 'openai-completions');
  assert.equal(json.providers[providerOf('b')].api, 'anthropic-messages');
  const [model] = a.models;
  assert.equal(a.models.length, 1);
  assert.equal(model.id, 'a-model', 'the model as the service names it');
  assert.equal(model.name, 'A');
  assert.deepEqual(model.input, ['text', 'image']);
  assert.equal(model.contextWindow, 128_000, 'a length when the service gives none');
  assert.equal(model.reasoning, false);
});

test("the chat's menu reads the person's models by their names, each picked by its id", () => {
  assert.deepEqual(modelOption([own('a'), own('b')], 'b'), {
    id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'b',
    options: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B' }],
  });
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
  const own = (baseUrl) => ({ id: 'byok', baseUrl });
  const balance = (provider, message) => outOfBalance(provider, new Error(message))?.balance ?? null;
  assert.deepEqual(balance(own('https://api.openai.com/v1'), '429 You exceeded your current quota, please check your plan and billing details. (insufficient_quota)'),
    { provider: 'OpenAI', url: 'https://platform.openai.com/settings/organization/billing' });
  assert.deepEqual(balance(own('https://api.anthropic.com/v1'), '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'),
    { provider: 'Anthropic', url: 'https://console.anthropic.com/settings/billing' });
  assert.deepEqual(balance(own('https://openrouter.ai/api/v1'), '402 This request requires more credits, or fewer max_tokens.'), { provider: 'OpenRouter', url: 'https://openrouter.ai/settings/credits' });
  assert.deepEqual(balance(own('https://llm.example.com:8443/v1'), '402 Payment Required'), { provider: 'llm.example.com:8443', url: null }, 'a service not known here: named, no page');
  /* the reason can come as the error's data (ACP's internal error) */
  assert.equal(outOfBalance(own('https://api.deepseek.com/v1'), { message: 'Internal error', data: { details: '402 Insufficient Balance' } })?.code, 'balance');
  assert.equal(balance(own('https://api.openai.com/v1'), '429 Rate limit reached for gpt-6 in organization org-1 on tokens per min'), null);
  assert.equal(balance(own('https://api.anthropic.com/v1'), '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'), null);
  assert.equal(balance(own('https://api.openai.com/v1'), 'Internal error: 401 key revoked'), null);
  assert.equal(outOfBalance(own('https://api.deepseek.com/v1'), new Error('402 Payment Required')).message,
    "DeepSeek doesn't have enough balance for this. Top it up there, or switch to another service, then try again.");
});

test('a model given levels is its service twice: as itself (no reasoning setting) and thinking, told only those levels', () => {
  assert.deepEqual(modelEffort(['max', 'auto', 'off', 'turbo', 'low'], 'low'), { levels: ['auto', 'off', 'low', 'max'], effort: 'low' });
  assert.deepEqual(modelEffort([], 'high'), { levels: ['auto'], effort: 'auto' }, 'none given: Auto alone');
  assert.deepEqual(modelEffort(['low', 'high'], 'max'), { levels: ['low', 'high'], effort: 'low' }, 'one not offered: the first');
  const json = modelsJson([own('a', { api: 'openai-responses', ...modelEffort(['auto', 'off', 'low', 'max'], 'low') }), own('b')]);
  assert.equal(json.providers[providerOf('a')].models[0].reasoning, false);
  const thinking = json.providers[THINKING(providerOf('a'))].models;
  assert.deepEqual(thinking.map((m) => m.id), ['a-model']);
  assert.deepEqual(thinking[0].thinkingLevelMap, { off: 'none', minimal: null, low: 'low', medium: null, high: null, xhigh: null, max: 'max' });
  assert.equal(json.providers[THINKING(providerOf('b'))], undefined, 'only a model given levels thinks');
  /* Anthropic's API is told off as off */
  const claude = modelsJson([own('c', { api: 'anthropic-messages', ...modelEffort(['off'], 'off') })]);
  assert.equal(claude.providers[THINKING(providerOf('c'))].models[0].thinkingLevelMap.off, 'off');
});

test('the effort option: for a model offering more than one, its levels named', () => {
  assert.equal(effortOption(['auto'], 'auto'), null);
  assert.deepEqual(effortOption(['auto', 'xhigh'], 'xhigh'), { id: 'effort', name: 'Effort', category: 'thought_level', type: 'select', currentValue: 'xhigh',
    options: [{ value: 'auto', name: 'Auto' }, { value: 'xhigh', name: 'Extra high' }] });
});
