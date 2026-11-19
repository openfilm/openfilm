import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_BUDGET, THINKING, TOO_LARGE, agentTools, contextLength, contextUsed, effortOption, failureText, fitImages, modelEffort, modelOption, modelsJson, outOfBalance, providerOf, retryNotice, stopReason, toolCall, toolContent } from './pi-config.mjs';

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

test("a model's context length is its window in Pi, and a quarter of it its answers, never more than 32K", () => {
  const model = (over) => modelsJson([own('a', over)]).providers[providerOf('a')].models[0];
  assert.deepEqual([model({}).contextWindow, model({}).maxTokens], [128_000, 32_000], 'none given: 128K, as before');
  assert.deepEqual([model({ context: 64_000 }).contextWindow, model({ context: 64_000 }).maxTokens], [64_000, 16_000]);
  assert.deepEqual([model({ context: 1_000_000 }).contextWindow, model({ context: 1_000_000 }).maxTokens], [1_000_000, 32_000], 'a long one asks for no more than 32K');
  assert.equal(model({ context: 50 }).contextWindow, 128_000, 'one that does not hold: 128K');
  const thinking = modelsJson([own('a', { context: 200_000, ...modelEffort(['auto', 'high'], 'high') })]).providers[THINKING(providerOf('a'))].models[0];
  assert.deepEqual([thinking.contextWindow, thinking.maxTokens], [200_000, 32_000], 'thinking, the same length');
  assert.deepEqual(contextUsed({ usage: { input: 150_000, output: 10 } }, model({ context: 1_000_000 })), { used: 150_010, size: 1_000_000 }, 'the usage bar reads the same window');
  assert.deepEqual([32_000, 10_000_000, 31_999, 4_000, 10_000_001, 150_000.5, '200000', null].map(contextLength), [32_000, 10_000_000, null, null, null, null, null, null]);
});

test('the app\'s own agent runs its commands in PowerShell on Windows, which has no bash of its own, and in bash elsewhere', () => {
  assert.deepEqual(agentTools('win32'), ['read', 'powershell', 'edit', 'write', 'ask']);
  for (const platform of ['darwin', 'linux']) assert.deepEqual(agentTools(platform), ['read', 'bash', 'edit', 'write', 'ask']);
});

test("the chat's menu reads the person's models by their names, each picked by its id", () => {
  assert.deepEqual(modelOption([own('a'), own('b')], 'b'), {
    id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'b',
    options: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B' }],
  });
});

test('what Pi does reads in the chat as Codex\'s did: a command\'s kind and title, a file\'s path, the result\'s text and pictures', () => {
  assert.deepEqual(toolCall('bash', { command: 'openfilm look' }), { kind: 'execute', title: 'openfilm look', rawInput: { command: 'openfilm look' } });
  assert.deepEqual(toolCall('powershell', { command: 'openfilm look' }), { kind: 'execute', title: 'openfilm look', rawInput: { command: 'openfilm look' } });
  assert.deepEqual(toolCall('read', { path: 'film.html' }), { kind: 'read', title: 'Read film.html', rawInput: { path: 'film.html' } });
  assert.equal(toolCall('write', { path: 'a.html' }).kind, 'edit');
  assert.deepEqual(toolContent({ content: [{ type: 'text', text: 'ok' }, { type: 'image', data: 'AA', mimeType: 'image/png' }] }), [
    { type: 'content', content: { type: 'text', text: 'ok' } },
    { type: 'content', content: { type: 'image', data: 'AA', mimeType: 'image/png' } },
  ]);
  assert.equal(stopReason({ stopReason: 'toolUse' }), 'end_turn');
  assert.equal(stopReason({ stopReason: 'aborted' }), 'cancelled');
  assert.throws(() => stopReason({ stopReason: 'error', errorMessage: '400 bad' }), /400 bad/);
  assert.throws(() => stopReason({ stopReason: 'error', errorMessage: 'Request timed out.' }),
    (e) => e.message.startsWith('The model request timed out.') && e.details === 'Request timed out.');
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

test('why a turn failed, in plain words: a service that sent nothing in time, a conversation too long for the model; else as Pi said it', () => {
  const timedOut = 'The model request timed out. Check the connection to the service, then try again.';
  assert.equal(failureText('Request timed out.'), timedOut, "the OpenAI and Anthropic clients' own timeout");
  assert.equal(failureText('Headers Timeout Error'), timedOut);
  assert.equal(failureText('Body Timeout Error'), timedOut);
  const hint = "The model's context may be smaller than set in Settings: lower it there.";
  const pi = 'Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.';
  assert.equal(failureText(pi), `${pi} ${hint}`);
  assert.equal(failureText('Context overflow recovery failed: 400 prompt is too long'), `Context overflow recovery failed: 400 prompt is too long ${hint}`);
  assert.equal(failureText("400: This model's maximum context length is 65536 tokens. However, you requested 70000 tokens."), `The conversation is too long for the model. ${hint}`);
  assert.equal(failureText('prompt is too long: 213462 tokens > 200000 maximum'), `The conversation is too long for the model. ${hint}`);
  assert.equal(failureText('401 Incorrect API key provided'), '401 Incorrect API key provided');
  const disconnected = 'The connection to the model service was interrupted. Continue to pick up this task.';
  assert.equal(failureText('Connection error.'), disconnected);
  assert.equal(failureText('terminated'), disconnected);
  assert.equal(retryNotice({ errorMessage: 'Connection error.' })._meta.openfilm.noticeKey, 'composer.modelConnectionRetry');
});

test('a model service tried again, as a notice: one that sent nothing in time in plain words, else with what Pi said', () => {
  assert.deepEqual(retryNotice({ type: 'auto_retry_start', attempt: 1, maxAttempts: 1, delayMs: 2000, errorMessage: 'Request timed out.' }), {
    sessionUpdate: 'notice', severity: 'warning', title: 'The model request timed out; trying again (1 of 1).', description: 'Request timed out.',
  });
  assert.deepEqual(retryNotice({ type: 'auto_retry_start', attempt: 1, maxAttempts: 2, delayMs: 2000, errorMessage: '503 Service Unavailable' }), {
    sessionUpdate: 'notice', severity: 'warning', title: 'The model service failed; trying again (1 of 2).', description: '503 Service Unavailable',
  });
});

test("each of the person's models reads pictures as Pi does (2000 px, 4.5 MB at most), and a request carries 32 MB of them", () => {
  const [model] = modelsJson([own('a')]).providers[providerOf('a')].models;
  assert.equal(model.inputLimits, undefined, 'Pi\'s own picture limits');
  assert.equal(IMAGE_BUDGET, 32 * 1024 * 1024);
});

test('pictures stay unchanged within the budget; a batch is removed when it overflows, with room for more', () => {
  const pic = (n) => ({ type: 'image', mimeType: 'image/png', data: 'x'.repeat(n) });
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'look' }, pic(40)] },
    { role: 'assistant', content: [{ type: 'toolCall', id: 't1', name: 'read', arguments: { path: '.film/look/00.03.png' } }] },
    { role: 'toolResult', toolCallId: 't1', toolName: 'read', content: [{ type: 'text', text: 'Read image file [image/png]' }, pic(50)] },
    { role: 'assistant', content: [{ type: 'toolCall', id: 't2', name: 'read', arguments: { path: '.film/look/00.07.png' } }] },
    { role: 'toolResult', toolCallId: 't2', toolName: 'read', content: [pic(60)] },
  ];
  assert.deepEqual(fitImages(messages, 150), { messages, kept: 150, removed: 0, pruned: [], reason: null }, 'within it: the same messages');
  assert.equal(fitImages(messages, 150).messages, messages);
  const { messages: fitted, kept, removed } = fitImages(messages, 120);
  assert.equal(removed, 2);
  assert.equal(kept, 60);
  assert.deepEqual(fitted[4].content, [pic(60)], 'the newest kept');
  assert.equal(fitted[2].content[1].type, 'text', 'clear a batch, not just enough to fit this one request');
  assert.match(fitted[0].content[1].text, /^\[A picture was left out of this request/, 'the oldest left out');
  const tighter = fitImages(messages, 100).messages;
  assert.equal(tighter[2].content[1].text, '[A picture (.film/look/00.03.png) was left out of this request to keep it small. Read it again to see it.]');
  assert.equal(messages[2].content[1].type, 'image', 'the conversation itself is left as it was');
  assert.equal(tighter[4].content[0].type, 'image', 'keep the newest picture when it fits, even above the half-budget target');
});

test('a request refused as too large is told apart from other failures, and said in plain words', () => {
  assert.ok(TOO_LARGE.test('413 <html><head><title>413 Request Entity Too Large</title></head></html>'));
  assert.ok(TOO_LARGE.test('413 status code (no body)'));
  assert.ok(TOO_LARGE.test('Payload Too Large'));
  assert.ok(!TOO_LARGE.test('400 The prompt has 413 tokens too many'));
  assert.match(failureText('413 <html>openresty</html>'), /too large for the model service, even with older pictures left out/);
  assert.equal(retryNotice({ attempt: 1, maxAttempts: 1, errorMessage: '413 <html>openresty</html>' }).title,
    'The request was too large for the model service; trying again (1 of 1) with half of the older pictures left out.');
});

test('reading a sixth and seventh picture preserves the earlier request prefix', () => {
  const pic = { type: 'image', mimeType: 'image/png', data: 'x' };
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'look' }, pic] }];
  for (let n = 1; n <= 7; n++) {
    messages.push({ role: 'assistant', content: [{ type: 'toolCall', id: `t${n}`, name: 'read', arguments: { path: `f${n}.png` } }] });
    messages.push({ role: 'toolResult', toolCallId: `t${n}`, toolName: 'read', content: [{ type: 'text', text: 'Read image file [image/png]' }, pic] });
  }
  const before = fitImages(messages.slice(0, -2), Infinity);
  const fitted = fitImages(messages, Infinity);
  assert.equal(fitted.removed, 0);
  assert.equal(fitted.kept, 8);
  assert.deepEqual(fitted.messages.slice(0, before.messages.length), before.messages);
  assert.equal(fitted.messages, messages, 'no rewriting below the actual request guard');
});

const pictureHistory = (n) => Array.from({ length: n }, (_, i) => ({ role: 'toolResult', toolCallId: `read-${i}`, content: [{ type: 'image', mimeType: 'image/png', data: 'x'.repeat(20) }] }));

test('count limits clear a batch once, and subsequent screenshots leave the existing prefix untouched', () => {
  const messages = pictureHistory(7);
  const omitted = new Set();
  const first = fitImages(messages, Infinity, { omitted, maxImages: 6 });
  assert.equal(first.reason, 'count');
  assert.equal(first.pruned.length, 4);
  assert.equal(first.kept, 60);
  assert.equal(first.removed, 4);
  for (let n = 8; n <= 10; n++) {
    const next = fitImages(pictureHistory(n), Infinity, { omitted, maxImages: 6 });
    assert.deepEqual(next.messages.slice(0, first.messages.length), first.messages);
    assert.equal(next.pruned.length, 0, 'use the room cleared by the previous batch');
  }
  const nextBatch = fitImages(pictureHistory(11), Infinity, { omitted, maxImages: 6 });
  assert.equal(nextBatch.pruned.length, 4);
  assert.equal(nextBatch.removed, 8);
});

test('omissions survive JSON restoration, compaction, and a larger budget; rereading the same file is a new occurrence', () => {
  const messages = pictureHistory(7);
  const first = fitImages(messages, Infinity, { maxImages: 6 });
  const omitted = new Set(JSON.parse(JSON.stringify(first.pruned)));
  const restored = fitImages(JSON.parse(JSON.stringify(messages)), Infinity, { omitted });
  assert.deepEqual(restored.messages, first.messages);
  const compacted = fitImages([messages[2], messages[6]], Infinity, { omitted });
  assert.equal(compacted.messages[0].content[0].type, 'text', 'a retained old picture is not resurrected after compaction');
  const reread = { ...messages[2], toolCallId: 'read-again' };
  const next = fitImages([...messages, reread], Infinity, { omitted });
  assert.equal(next.messages.at(-1).content[0].type, 'image', 'a new read can show the original picture again');
  assert.equal(messages[2].content[0].type, 'image', 'the transcript still has the original');
});

test('the byte guard includes UTF-8 text, system and tools, and leaves space for provider serialization', () => {
  const messages = [{ role: 'system', content: '画面描述'.repeat(100_000), tools: [{ name: 'read', description: '文件'.repeat(1000) }] }, ...pictureHistory(4)];
  const bytes = Buffer.byteLength(JSON.stringify(messages));
  const fitted = fitImages(messages, Infinity, { maxRequestBytes: bytes + 1024 * 1024 - 10 });
  assert.equal(fitted.reason, 'bytes');
  assert.ok(fitted.pruned.length >= 2, 'text leaves room for only part of the pictures');
  assert.equal(fitted.messages[0], messages[0], 'system and tools are left intact');
  assert.equal(fitImages([{ role: 'user', content: [{ type: 'image', data: 'x'.repeat(20) }] }], 0).kept, 0, 'a picture too large by itself is omitted');
});

test('Cloudflare and model gateway timeouts show a short message while diagnostics retain the original error', () => {
  const errorMessage = '524 {"error_name":"origin_response_timeout", "ray_id":"example"}';
  const notice = retryNotice({ errorMessage });
  assert.match(notice.title, /took too long to respond/);
  assert.equal(notice.description, undefined);
  assert.equal(failureText('504 {"error":{"code":"upstream_timeout"}}'), 'The model service took too long to respond. Try again or switch models.');
  assert.throws(() => stopReason({ stopReason: 'error', errorMessage }), (e) => {
    assert.equal(e.details, errorMessage);
    return true;
  });
});
