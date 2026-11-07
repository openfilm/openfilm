import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRoster, keyAddress, probeRequest, readChoices } from './agent-roster.mjs';
import { LANGUAGES as STUDIO_LANGUAGES } from '../../../packages/openfilm/studio/ui/src/i18n/index.ts';
import { ownModelError } from '../../../packages/openfilm/studio/ui/src/lib/agent-row.ts';

const roster = (dataDir, fetch, extra = {}) => createRoster({
  dataDir,
  localAgents: async () => [],
  openSignIn: async () => ({ ok: true }),
  closeSessions: () => {},
  seal: (text) => Buffer.from(`sealed:${text}`),
  unseal: (data) => data.toString().replace(/^sealed:/, ''),
  onChange: () => {},
  fetch,
  ...extra,
});

test('startup publishes each result before a slow background discovery ends; only enabled agents need sign-in checks', async () => {
  const slow = Promise.withResolvers();
  let requested;
  const r = roster(mkdtempSync(join(tmpdir(), 'of-progressive-agents-')), undefined, {
    localAgents: async (options) => {
      requested = options;
      return Promise.all(options.ids.map(async (id) => {
        if (id === 'cursor') await slow.promise;
        const fact = { id, cli: { path: `/bin/${id}` }, signedIn: true };
        options.onAgent(fact);
        return fact;
      }));
    },
  });
  const pending = r.refresh();
  try {
    await new Promise((done) => setImmediate(done));
    assert.deepEqual(requested.statusIds, ['codex']);
    assert.equal(requested.ids.length, 11, 'disabled agents are still discovered automatically');
    assert.equal(requested.ids[0], 'codex', 'enabled agents are scheduled first');
    assert.equal(r.list().find((a) => a.id === 'codex').status, 'ready');
    assert.equal(r.list().find((a) => a.id === 'cursor').status, 'checking');
  } finally { slow.resolve(); await pending; }
  assert.equal(r.list().find((a) => a.id === 'cursor').status, 'off');
});

test('connecting one agent does not wait for a pending background scan or accept its stale result', async () => {
  const slow = Promise.withResolvers();
  const checked = [];
  const r = roster(mkdtempSync(join(tmpdir(), 'of-connect-priority-')), undefined, {
    localAgents: async ({ ids, onAgent }) => {
      await slow.promise;
      return ids.map((id) => { const fact = { id, cli: null, signedIn: null }; onAgent(fact); return fact; });
    },
    localAgent: async (id) => { checked.push(id); return { id, cli: { path: `/bin/${id}` }, signedIn: true }; },
  });
  const scan = r.refresh();
  let connected = false;
  const connect = r.connect('deepseek').then(() => { connected = true; });
  try {
    await new Promise((done) => setImmediate(done));
    assert.equal(connected, true);
    assert.deepEqual(checked, ['deepseek']);
  } finally { slow.resolve(); await Promise.all([scan, connect]); }
  assert.equal(r.list().find((a) => a.id === 'deepseek').status, 'ready');
});

test('explicit refresh renews configuration and clears stale model errors without signing out or closing active sessions', async () => {
  const reset = [], closed = [], scans = [];
  const dir = mkdtempSync(join(tmpdir(), 'of-settings-refresh-'));
  const r = roster(dir, undefined, {
    localAgents: async (options) => { scans.push(options); return [{ id: 'deepseek', cli: { path: '/bin/dsh' }, signedIn: null }]; },
    resetAgent: (id) => reset.push(id), closeSessions: (id) => closed.push(id),
  });
  await r.connect('deepseek');
  r.recordConnectionResult('deepseek', new Error('no API key for provider route "deepseek-official"'));
  const before = readChoices(dir);
  const closedBefore = closed.length;
  await r.recheck('deepseek');
  const agent = r.list().find((a) => a.id === 'deepseek');
  assert.equal(agent.connectionIssue, undefined, 'the error from the previous configuration is no longer current');
  assert.equal(agent.configurationRevision, 1);
  assert.equal(agent.path, '/bin/dsh');
  assert.deepEqual(scans.at(-1).ids, ['deepseek']);
  assert.deepEqual(scans.at(-1).statusIds, ['deepseek']);
  assert.equal(scans.at(-1).fresh, true);
  assert.deepEqual(reset, ['deepseek']);
  assert.equal(closed.length, closedBefore, 'refresh uses idle-session renewal, not forced session closure');
  assert.deepEqual(readChoices(dir), before);
});

test('model failures survive discovery and reconnects without changing paths, visibility or sign-in; actual success clears them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-model-issue-'));
  const r = roster(dir, undefined, {
    localAgents: async () => [{ id: 'opencode', cli: { path: 'C:\\Apps\\OpenCode\\resources\\opencode-cli.exe' }, signedIn: null }],
  });
  await r.connect('opencode');
  const before = readChoices(dir);
  const read = () => r.list().find((a) => a.id === 'opencode');
  r.recordConnectionResult('opencode', new Error('Free usage limit reached.'));
  await r.refresh();
  await r.connect('opencode');
  assert.equal(read().status, 'ready');
  assert.equal(read().connectionIssue.kind, 'quota');
  assert.equal(read().path, 'C:\\Apps\\OpenCode\\resources\\opencode-cli.exe');
  assert.deepEqual(readChoices(dir), before);
  r.recordConnectionResult('opencode', new Error('429 Too many requests'));
  assert.equal(read().connectionIssue.kind, 'quota', 'an unrelated transient error does not dismiss the known issue');
  r.recordConnectionResult('opencode', null);
  assert.equal(read().connectionIssue, undefined);
  r.recordConnectionResult('deepseek', new Error('no API key for provider route "deepseek-official"'));
  assert.equal(r.list().find((a) => a.id === 'deepseek').connectionIssue.kind, 'credentials');
});

test('focus publishes a fresh login before a slow full scan and ignores the scan\'s older signed-out result', async () => {
  const qwen = (signedIn) => ({ id: 'qwen', cli: { path: '/bin/qwen' }, signedIn });
  const scan = Promise.withResolvers();
  let signedIn = false;
  let slow = false;
  const checks = [];
  const r = roster(mkdtempSync(join(tmpdir(), 'of-fast-login-')), undefined, {
    localAgents: async () => slow ? scan.promise : [qwen(signedIn)],
    localAgent: async (id, options) => { checks.push([id, options]); return qwen(signedIn); },
    signInWait: { ms: 10_000, pollMs: 5000 },
  });
  try {
    await r.refresh();
    await r.connect('qwen');
    await new Promise((done) => setImmediate(done));
    assert.equal(checks.length, 1, 'the first login check starts immediately, before the poll delay');
    assert.equal(r.list().find((a) => a.id === 'qwen').status, 'waiting');
    signedIn = true;
    slow = true;
    const refreshing = r.refresh();
    await new Promise((done) => setImmediate(done));
    assert.equal(r.list().find((a) => a.id === 'qwen').status, 'ready', 'focus does not wait for the full scan or the next poll');
    assert.ok(checks.every(([id, options]) => id === 'qwen' && options.fresh === true));
    scan.resolve([qwen(false)]);
    await refreshing;
    assert.equal(r.list().find((a) => a.id === 'qwen').status, 'ready', 'the old full scan cannot revert a completed login');
  } finally { r.cancelSignIn('qwen'); scan.resolve([qwen(false)]); }
});

test('only the agent being signed in is asked fresh; other signed-out agents and installs keep cached answers', async () => {
  const agent = (id, signedIn, cli = { path: `/bin/${id}` }) => ({ id, cli, signedIn });
  const checks = [];
  const r = roster(mkdtempSync(join(tmpdir(), 'of-fresh-login-')), undefined, {
    localAgents: async () => [agent('codex', false), agent('qwen', false), agent('cursor', null, null)],
    // The install is there at its first check, so its wait ends at once.
    localAgent: async (id, options) => { checks.push([id, options?.fresh === true]); return id === 'cursor' ? agent('cursor', null) : agent(id, false); },
    openInstaller: async () => ({ ok: true }),
    signInWait: { ms: 10_000, pollMs: 5000 },
  });
  try {
    await r.refresh();
    await r.refresh();
    assert.deepEqual(checks, [], 'a shown, connected, signed-out agent is not asked fresh on every refresh');
    await r.connect('qwen');
    await new Promise((done) => setImmediate(done));
    await r.refresh();
    assert.ok(checks.length >= 1);
    assert.ok(checks.every(([id, fresh]) => id === 'qwen' && fresh), `only the agent being signed in is asked fresh: ${JSON.stringify(checks)}`);
    checks.length = 0;
    await r.install('cursor');
    await new Promise((done) => setImmediate(done));
    assert.deepEqual(checks, [['cursor', false]], 'an install wait uses the cached sign-in answers');
  } finally { r.cancelSignIn('qwen'); }
});

test('focus and login polling share a status check, and cancelling ignores its late answer', async () => {
  const qwen = (signedIn) => ({ id: 'qwen', cli: { path: '/bin/qwen' }, signedIn });
  const pending = Promise.withResolvers();
  let checks = 0;
  const r = roster(mkdtempSync(join(tmpdir(), 'of-fast-login-')), undefined, {
    localAgents: async () => [qwen(false)],
    localAgent: async () => { checks++; return pending.promise; },
    signInWait: { ms: 10_000, pollMs: 5000 },
  });
  try {
    await r.refresh();
    await r.connect('qwen');
    await Promise.all([r.refresh(), r.refresh(), r.refresh()]);
    assert.equal(checks, 1);
    r.cancelSignIn('qwen');
    pending.resolve(qwen(true));
    await new Promise((done) => setImmediate(done));
    assert.equal(r.list().find((a) => a.id === 'qwen').status, 'sign-in');
  } finally { r.cancelSignIn('qwen'); pending.resolve(qwen(false)); }
});

test('each API format is asked in its own shape, with a picture', () => {
  const r = probeRequest('responses', 'https://api.openai.com/v1/', 'k', 'm');
  assert.equal(r.url, 'https://api.openai.com/v1/responses');
  assert.equal(r.body.input[0].content[1].type, 'input_image');
  const c = probeRequest('chat', 'https://api.deepseek.com/v1', 'k', 'm');
  assert.equal(c.url, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(c.body.messages[0].content[1].type, 'image_url');
  const a = probeRequest('anthropic', 'https://api.anthropic.com', 'k', 'm');
  assert.equal(a.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(a.headers['x-api-key'], 'k');
  assert.equal(a.body.messages[0].content[0].type, 'image');
});

test('a model is kept only once its service took the key with a picture; one that cannot read it is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  let answer = { status: 400, body: { error: { message: 'This model does not support image input.' } } };
  const fetch = async () => new Response(JSON.stringify(answer.body), { status: answer.status });
  const r = roster(dir, fetch);
  const refused = await r.saveOwnModel({ format: 'chat', baseUrl: 'https://api.deepseek.com/v1', model: 'text-only', key: 'sk-1234' });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'no-images');
  assert.equal(readChoices(dir).byok, null, 'nothing kept');
  answer = { status: 401, body: {} };
  assert.match((await r.saveOwnModel({ format: 'chat', baseUrl: 'https://api.deepseek.com/v1', model: 'm', key: 'bad' })).error, /did not accept/);
  answer = { status: 200, body: { choices: [] } };
  const saved = await r.saveOwnModel({ format: 'chat', baseUrl: 'https://api.deepseek.com/v1/', model: 'vision', key: 'sk-good-9876' });
  assert.equal(saved.ok, true);
  assert.deepEqual(readChoices(dir).byok.models, [
    { id: saved.id, name: 'vision', format: 'chat', baseUrl: 'https://api.deepseek.com/v1', model: 'vision', levels: ['auto'], effort: 'auto', last4: '9876' },
  ], 'named for its model when given no name');
  assert.equal(readChoices(dir).shown.byok, true, 'set up: shown in the chat');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'byok-keys'), 'utf8').replace(/^sealed:/, '')), { [saved.id]: 'sk-good-9876' }, 'the key sealed, by the model');
  assert.equal(JSON.stringify(readChoices(dir)).includes('sk-good'), false, 'never in the choices file');
});

test('an address that answers with a web page is said so, not shown as its HTML, and nothing is kept', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  let answer = { status: 405, type: 'text/html', body: '<!doctype html><html lang="en"><head><title>Example Domain</title></head></html>' };
  const fetch = async () => new Response(answer.body, { status: answer.status, headers: { 'content-type': answer.type } });
  const r = roster(dir, fetch);
  const save = () => r.saveOwnModel({ format: 'responses', baseUrl: 'https://example.com/v1', model: 'm', key: 'sk-1234' });
  const refused = await save();
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'https://example.com/v1/responses answers with a web page (405), not the API: check the address and the API format.');
  /* a page that answers 200 is not the model taking the picture, and one that mentions images is not a model refusing it */
  answer = { status: 200, type: 'text/html; charset=utf-8', body: '<html><head><meta property="og:image" content="card.png"></head></html>' };
  assert.match((await save()).error, /web page \(200\)/);
  /* an HTML error page sent as text */
  answer = { status: 502, type: 'text/plain', body: '<html><body>Bad gateway</body></html>' };
  assert.match((await save()).error, /web page \(502\)/);
  assert.equal(readChoices(dir).byok, null, 'nothing kept');
});

test('a key goes over https://, or over http:// only to this computer; another http:// address is refused before any request', async () => {
  for (const ok of ['https://api.example.com/v1', 'http://localhost:11434/v1', 'http://127.0.0.1:1234', 'http://[::1]:8080/v1', 'http://models.localhost/v1']) {
    assert.equal(keyAddress(ok), true, ok);
  }
  for (const no of ['http://example.com/v1', 'http://192.168.1.20:11434/v1', 'http://localhost.example.com', 'ftp://127.0.0.1', 'https://api.example.com/v 1', 'api.example.com']) {
    assert.equal(keyAddress(no), false, no);
  }
  let asked = 0;
  const r = roster(mkdtempSync(join(tmpdir(), 'of-roster-')), async () => { asked++; return new Response('{}', { status: 200 }); });
  assert.match((await r.saveOwnModel({ format: 'responses', baseUrl: 'http://example.com/v1', model: 'test', key: 'x' })).error, /https:\/\//);
  assert.equal(asked, 0, 'the key was not sent');
});

test('the app\'s own words for a model not set up come with a code and what they name, for Settings to say in the person\'s language; the service\'s own words with none', async () => {
  let answer = { status: 401, type: 'application/json', body: '{}' };
  let reached = true;
  const fetch = async () => {
    if (!reached) throw new TypeError('fetch failed');
    return new Response(answer.body, { status: answer.status, headers: { 'content-type': answer.type } });
  };
  const r = roster(mkdtempSync(join(tmpdir(), 'of-roster-')), fetch);
  const failures = [];
  /** what comes with the words: the code, and the address, status or reason they name */
  const said = async (config = {}) => {
    const failure = await r.saveOwnModel({ format: 'responses', baseUrl: 'https://api.example.com/v1', model: 'm', key: 'sk-1', ...config });
    failures.push(failure);
    const { ok, error, ...rest } = failure;
    assert.equal(ok, false);
    assert.ok(error, 'in English too');
    return rest;
  };
  assert.deepEqual(await said({ format: 'soap' }), { code: 'no-format' });
  assert.deepEqual(await said({ baseUrl: 'http://example.com/v1' }), { code: 'address' });
  assert.deepEqual(await said({ model: ' ' }), { code: 'no-model' });
  assert.deepEqual(await said({ id: 'gone' }), { code: 'model-gone' });
  assert.deepEqual(await said({ key: '' }), { code: 'no-key' });
  assert.deepEqual(await said(), { code: 'key-refused' });
  answer = { status: 502, type: 'text/html', body: '<html></html>' };
  assert.deepEqual(await said(), { code: 'web-page', url: 'https://api.example.com/v1/responses', status: 502 });
  answer = { status: 404, type: 'application/json', body: '{}' };
  assert.deepEqual(await said(), { code: 'nothing-there', url: 'https://api.example.com/v1/responses' });
  answer = { status: 500, type: 'text/plain', body: '' };
  assert.deepEqual(await said(), { code: 'answered', status: 500 });
  reached = false;
  assert.deepEqual(await said(), { code: 'unreachable', reason: 'fetch failed' });
  reached = true;
  answer = { status: 400, type: 'application/json', body: JSON.stringify({ error: { message: 'Unknown parameter: max_output_tokens' } }) };
  assert.deepEqual(await r.saveOwnModel({ format: 'responses', baseUrl: 'https://api.example.com/v1', model: 'm', key: 'sk-1' }), { ok: false, error: 'Unknown parameter: max_output_tokens' });
  /* Studio's Settings has words for each code: in English the app's own, in every other language their own */
  answer = { status: 400, type: 'application/json', body: JSON.stringify({ error: { message: 'image input is not supported' } }) };
  assert.equal((await said()).code, 'no-images');
  for (const { code, words } of STUDIO_LANGUAGES) {
    const t = (path) => path.split('.').reduce((at, part) => at?.[part], words) ?? path;
    for (const failure of failures) {
      if (code === 'en') assert.equal(ownModelError(failure, t), failure.error, failure.code);
      else assert.notEqual(ownModelError(failure, t), failure.error, `${code}: ${failure.code}`);
    }
  }
});

test('each model is its own service with its own key; a key left empty is the one of another model on that address', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  const r = roster(dir, async () => new Response('{}', { status: 200 }));
  const gpt = await r.saveOwnModel({ name: 'GPT', format: 'responses', baseUrl: '', model: 'gpt-x', key: 'sk-a', levels: ['high', 'auto', 'medium', 'turbo'], effort: 'medium' });
  const flash = await r.saveOwnModel({ name: 'DeepSeek Flash', format: 'chat', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', key: 'sk-d' });
  const pro = await r.saveOwnModel({ format: 'chat', baseUrl: 'https://api.deepseek.com/v1/', model: 'deepseek-reasoner' });
  assert.equal(pro.ok, true, 'no key: the one of the model on the same address');
  assert.equal((await r.saveOwnModel({ format: 'anthropic', model: 'claude-x' })).error, 'Paste the key.', 'a new address needs its key');

  const h = r.harness('byok');
  assert.equal(h.home, join(dir, 'agents', 'byok', 'pi'), 'its own folder, never the person\'s ~/.pi');
  assert.equal(h.model, gpt.id, 'the first one to begin with');
  assert.deepEqual(h.models, [
    { id: gpt.id, name: 'GPT', api: 'openai-responses', baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENFILM_BYOK_KEY_1', model: 'gpt-x', levels: ['auto', 'medium', 'high'], effort: 'medium' },
    { id: flash.id, name: 'DeepSeek Flash', api: 'openai-completions', baseUrl: 'https://api.deepseek.com/v1', keyEnv: 'OPENFILM_BYOK_KEY_2', model: 'deepseek-chat', levels: ['auto'], effort: 'auto' },
    { id: pro.id, name: 'deepseek-reasoner', api: 'openai-completions', baseUrl: 'https://api.deepseek.com/v1', keyEnv: 'OPENFILM_BYOK_KEY_3', model: 'deepseek-reasoner', levels: ['auto'], effort: 'auto' },
  ], 'the official address when none is given; known efforts, in order');
  assert.deepEqual(h.env, { OPENFILM_BYOK_KEY_1: 'sk-a', OPENFILM_BYOK_KEY_2: 'sk-d', OPENFILM_BYOK_KEY_3: 'sk-d' });
  assert.deepEqual(r.list().find((a) => a.id === 'byok').byok.models.map((m) => m.name), ['GPT', 'DeepSeek Flash', 'deepseek-reasoner']);
});

test('a model changed keeps its place, its id and, given none, its key; one removed takes its key with it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  const closed = [];
  const r = roster(dir, async () => new Response('{}', { status: 200 }), { closeSessions: (id) => closed.push(id) });
  const a = await r.saveOwnModel({ format: 'responses', model: 'gpt-a', key: 'sk-a' });
  const b = await r.saveOwnModel({ format: 'chat', baseUrl: 'https://api.deepseek.com/v1', model: 'ds', key: 'sk-d' });
  assert.deepEqual(await r.saveOwnModel({ id: a.id, name: 'Mine', format: 'responses', model: 'gpt-b', levels: ['low', 'max'], effort: 'max' }), { ok: true, id: a.id });
  assert.deepEqual(readChoices(dir).byok.models.map((m) => [m.id, m.name, m.model, m.effort]), [[a.id, 'Mine', 'gpt-b', 'max'], [b.id, 'ds', 'ds', 'auto']]);
  assert.equal(r.harness('byok').env.OPENFILM_BYOK_KEY_1, 'sk-a');
  assert.equal((await r.saveOwnModel({ id: 'gone', format: 'responses', model: 'x' })).ok, false);

  r.removeOwnModel(b.id);
  assert.deepEqual(r.harness('byok').models.map((m) => m.id), [a.id]);
  assert.equal(readFileSync(join(dir, 'byok-keys'), 'utf8').includes('sk-d'), false, 'its key gone');
  r.removeOwnModel(a.id);
  assert.equal(readChoices(dir).byok, null);
  assert.equal(r.harness('byok'), null);
  assert.equal(r.list().find((x) => x.id === 'byok').status, 'key');
  assert.equal(closed.filter((id) => id === 'byok').length, 5, 'its sessions closed on each change: they run on the models set up');
});

test("a model's context length is kept when it holds (32K to 10M tokens), and dropped quietly when not: 128K then", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  const r = roster(dir, async () => new Response('{}', { status: 200 }));
  const big = await r.saveOwnModel({ format: 'responses', model: 'big', key: 'sk-a', context: 1_000_000 });
  const odd = await r.saveOwnModel({ format: 'responses', model: 'odd', context: 1_000 });
  const plain = await r.saveOwnModel({ format: 'responses', model: 'plain' });
  assert.deepEqual(readChoices(dir).byok.models.map((m) => [m.model, m.context]), [['big', 1_000_000], ['odd', undefined], ['plain', undefined]]);
  assert.equal(Object.hasOwn(readChoices(dir).byok.models[1], 'context'), false, 'none kept, not a null');
  assert.deepEqual(r.harness('byok').models.map((m) => m.context), [1_000_000, undefined, undefined], 'the agent runs with it');
  assert.equal(r.list().find((a) => a.id === 'byok').byok.models[0].context, 1_000_000, 'Settings shows it');
  /* changed without one: back to none */
  await r.saveOwnModel({ id: big.id, format: 'responses', model: 'big' });
  assert.equal(readChoices(dir).byok.models[0].context, undefined);
  assert.ok(odd.ok && plain.ok);

  /* as read: a whole number in bounds is kept, anything else dropped */
  const kept = (context) => {
    writeFileSync(join(dir, 'agents.json'), JSON.stringify({ byok: { models: [{ id: 'a', format: 'chat', baseUrl: 'https://x.test/v1', model: 'm', context }] } }));
    return readChoices(dir).byok.models[0].context;
  };
  assert.equal(kept(32_000), 32_000);
  assert.equal(kept(10_000_000), 10_000_000);
  assert.equal(kept(200_000), 200_000);
  for (const bad of [31_999, 4_000, 10_000_001, 128_000.5, '200000', -1, 0, null, true, {}]) assert.equal(kept(bad), undefined, `${JSON.stringify(bad)} dropped`);
});

test('one service with several models, kept before each model was set up on its own, is those models on it, on its key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  writeFileSync(join(dir, 'agents.json'), JSON.stringify({ byok: { format: 'chat', baseUrl: 'https://api.deepseek.com/v1', model: 'a', models: ['a', 'b'],
    efforts: { b: { levels: ['auto', 'high'], effort: 'high' } }, last4: 'abcd' } }));
  writeFileSync(join(dir, 'byok.key'), 'sealed:sk-old-abcd');
  assert.deepEqual(readChoices(dir).byok.models, [
    { id: 'm1', name: 'a', format: 'chat', baseUrl: 'https://api.deepseek.com/v1', model: 'a', levels: ['auto'], effort: 'auto', last4: 'abcd' },
    { id: 'm2', name: 'b', format: 'chat', baseUrl: 'https://api.deepseek.com/v1', model: 'b', levels: ['auto', 'high'], effort: 'high', last4: 'abcd' },
  ]);
  /* the oldest, with one model and no list */
  writeFileSync(join(dir, 'agents.json'), JSON.stringify({ byok: { format: 'responses', baseUrl: 'https://api.openai.com/v1', model: 'gpt-x', last4: 'abcd' } }));
  assert.deepEqual(readChoices(dir).byok.models.map((m) => [m.id, m.model]), [['m1', 'gpt-x']]);

  writeFileSync(join(dir, 'agents.json'), JSON.stringify({ byok: { format: 'chat', baseUrl: 'https://api.deepseek.com/v1', models: ['a', 'b'], last4: 'abcd' } }));
  const r = roster(dir, async () => new Response('{}', { status: 200 }));
  await r.saveOwnModel({ format: 'responses', model: 'gpt', key: 'sk-new' });
  assert.deepEqual(Object.values(r.harness('byok').env), ['sk-old-abcd', 'sk-old-abcd', 'sk-new'], 'the ones from before on the key kept then');
});

test("Codex and Claude Code are shown in the chat from the start, the person's other agents once connected or switched on", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  const found = (id, cli) => ({ id, cli, signedIn: true, install: 'https://example.test', setupRequired: null });
  const r = roster(dir, undefined, { localAgents: async () => [found('codex', null), found('claude', null), found('qwen', { path: '/bin/qwen' }), found('kimi', null)] });
  const list = await r.refresh();
  const of = (id) => list.find((a) => a.id === id);
  assert.equal(of('codex').shown, true, 'not installed, still shown');
  assert.equal(of('qwen').status, 'off');
  assert.equal(of('qwen').shown, false, 'installed, not chosen yet');
  assert.equal(of('kimi').status, 'missing');
  await r.connect('qwen');
  assert.equal(r.list().find((a) => a.id === 'qwen').shown, true, 'connected: chosen');
  r.setShown('kimi', true);
  assert.equal(readChoices(dir).shown.kimi, true);
});

test('an agent not found can be pointed at: the program is tried first, kept, and used until found automatically again', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  let picked = null;
  let check = { ok: true };
  const used = [];
  const asked = [];
  const r = roster(dir, undefined, {
    localAgents: async () => [{ id: 'codex', cli: null, signedIn: null, install: 'https://chatgpt.com/download/', setupRequired: null }],
    pickProgram: async (id, words) => { asked.push([id, words]); return picked; },
    checkProgram: async () => check,
    usePaths: (paths) => used.push(paths),
  });
  assert.deepEqual(used, [{}], 'told at once what was kept');
  await r.refresh();
  assert.deepEqual(await r.locate('codex', { title: 'Choose the Codex program' }), { ok: false }, 'cancelled: nothing said, nothing kept');
  assert.deepEqual(asked, [['codex', { title: 'Choose the Codex program' }]]);
  picked = 'C:\\tools\\notes.txt';
  check = { ok: false, error: '', code: 'not-a-program' };
  assert.deepEqual(await r.locate('codex'), { ok: false, error: '', code: 'not-a-program' });
  assert.deepEqual(readChoices(dir).paths, {}, 'a program that does not start is not kept');
  picked = 'C:\\tools\\codex.exe';
  check = { ok: true, version: 'codex-cli 1.0.0' };
  assert.deepEqual(await r.locate('codex'), { ok: true, version: 'codex-cli 1.0.0' });
  assert.deepEqual(readChoices(dir).paths, { codex: 'C:\\tools\\codex.exe' });
  assert.deepEqual(used.at(-1), { codex: 'C:\\tools\\codex.exe' });
  assert.equal(r.list().find((a) => a.id === 'codex').chosen, 'C:\\tools\\codex.exe');
  assert.deepEqual(await r.useAutomatic('codex'), { ok: true });
  assert.deepEqual(readChoices(dir).paths, {});
  assert.deepEqual(used.at(-1), {});
  assert.deepEqual(await r.locate('byok'), { ok: false, error: 'No agent byok' }, 'only the person\'s own programs');
});

test('choices about an agent the app no longer has are dropped quietly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  writeFileSync(join(dir, 'agents.json'), JSON.stringify({ shown: { gemini: true, kimi: true }, paths: { gemini: '/bin/gemini' }, disconnected: ['gemini', 'claude'] }));
  const choices = readChoices(dir);
  assert.equal('gemini' in choices.shown, false);
  assert.equal(choices.shown.kimi, true);
  assert.deepEqual(choices.paths, {});
  assert.deepEqual(choices.disconnected, ['claude']);
});

test('a kept path for something that is not one of the agents is dropped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  writeFileSync(join(dir, 'agents.json'), JSON.stringify({ paths: { codex: '/opt/codex', byok: '/x', nope: '/y', claude: 3 } }));
  assert.deepEqual(readChoices(dir).paths, { codex: '/opt/codex' });
});

test('disconnecting only stops OpenFilm using an agent; connecting again uses the account signed in then', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  let account = { method: 'claude.ai', email: 'a@b.test' };
  const closed = [];
  const r = roster(dir, undefined, {
    localAgents: async () => [{ id: 'claude', cli: { path: '/bin/claude' }, signedIn: true, account, install: null, setupRequired: null }],
    closeSessions: (id) => closed.push(id),
  });
  await r.refresh();
  assert.equal(r.list().find((a) => a.id === 'claude').status, 'off', 'Claude Code waits for the person to connect it');
  assert.deepEqual(await r.connect('claude'), { ok: true });
  assert.deepEqual(r.list().find((a) => a.id === 'claude').account, { method: 'claude.ai', email: 'a@b.test' });
  r.disconnect('claude');
  assert.equal(r.list().find((a) => a.id === 'claude').status, 'off');
  /* the account switched in Claude Code itself */
  account = { method: 'claude.ai', email: 'c@d.test' };
  assert.deepEqual(await r.connect('claude'), { ok: true });
  const claude = r.list().find((a) => a.id === 'claude');
  assert.equal(claude.status, 'ready');
  assert.equal(claude.account.email, 'c@d.test');
  assert.deepEqual(closed, ['claude', 'claude', 'claude'], 'its sessions closed each time: none goes on with the old account');
});

test('switching account signs the agent out with no window, closes its sessions, and waits for its sign-in to another account', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  let state = { signedIn: true, account: { method: 'claude.ai', email: 'old@example.test', org: 'Old Org' } };
  const claude = () => ({ id: 'claude', cli: { path: '/bin/claude' }, ...state, signOut: true, install: null, setupRequired: null });
  const steps = [];
  const r = roster(dir, undefined, {
    localAgents: async () => [claude()],
    localAgent: async () => claude(),
    closeSessions: (id) => steps.push(`close ${id}`),
    signOut: async (id) => { steps.push(`sign out ${id}`); state = { signedIn: false, account: null }; return { ok: true }; },
    openSignIn: async (id) => { steps.push(`sign in ${id}`); return { ok: true }; },
    signInWait: { ms: 2000, pollMs: 10 },
  });
  await r.connect('claude');
  const before = r.list().find((a) => a.id === 'claude');
  assert.equal(before.status, 'ready');
  assert.equal(before.signOut, true, 'it can switch here');
  steps.length = 0;
  assert.deepEqual(await r.switchAccount('claude'), { ok: true });
  assert.deepEqual(steps, ['close claude', 'sign out claude', 'sign in claude'], 'no session goes on with the old account');
  const waiting = r.list().find((a) => a.id === 'claude');
  assert.equal(waiting.status, 'waiting');
  assert.equal(waiting.account, undefined, 'the old account is no longer shown');
  state = { signedIn: true, account: { method: 'claude.ai', email: 'new@example.test' } };
  await new Promise((done) => setTimeout(done, 60));
  const after = r.list().find((a) => a.id === 'claude');
  assert.equal(after.status, 'ready');
  assert.equal(after.account.email, 'new@example.test');
});

test('a sign-out that fails leaves the agent signed in as it was, with what it said; one that cannot switch here is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  const cursor = { id: 'cursor', cli: { path: '/bin/cursor-agent' }, signedIn: true, account: { method: 'other', email: 'me@example.test' }, signOut: true, install: null, setupRequired: null };
  const opened = [];
  const r = roster(dir, undefined, {
    localAgents: async () => [cursor],
    signOut: async () => ({ ok: false, error: 'Cursor did not sign out. Keychain is locked' }),
    openSignIn: async (id) => { opened.push(id); return { ok: true }; },
  });
  await r.connect('cursor');
  assert.deepEqual(await r.switchAccount('cursor'), { ok: false, error: 'Cursor did not sign out. Keychain is locked' });
  const row = r.list().find((a) => a.id === 'cursor');
  assert.equal(row.status, 'ready');
  assert.equal(row.account.email, 'me@example.test');
  assert.equal(row.error, 'Cursor did not sign out. Keychain is locked');
  assert.deepEqual(opened, [], 'no sign-in opened');
  assert.equal((await r.switchAccount('byok')).ok, false);
  /* an app without the sign-out: Settings says where to switch instead */
  const older = roster(mkdtempSync(join(tmpdir(), 'of-roster-')), undefined, { localAgents: async () => [cursor] });
  await older.connect('cursor');
  assert.equal(older.list().find((a) => a.id === 'cursor').signOut, undefined);
  assert.equal((await older.switchAccount('cursor')).ok, false);
});

test("Codex found but unable to read its own settings says so, with what it said", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  const problem = 'Error loading configuration: config.toml:2:16: unknown variant `full`';
  const r = roster(dir, undefined, {
    localAgents: async () => [{ id: 'codex', cli: { path: '/bin/codex' }, signedIn: null, account: null, problem, install: null, setupRequired: null }],
  });
  await r.refresh();
  const codex = r.list().find((a) => a.id === 'codex');
  assert.equal(codex.status, 'ready');
  assert.equal(codex.problem, problem);
});

test('a connected Claude Code older than the chat was tried with says so, with its version and how to update it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  writeFileSync(join(dir, 'agents.json'), JSON.stringify({ disconnected: [], shown: { claude: true } }));
  const outdated = { version: '2.1.288', tested: '2.1.308', update: 'npm i -g @anthropic-ai/claude-code@latest' };
  const r = roster(dir, undefined, {
    localAgents: async () => [{ id: 'claude', cli: { path: '/bin/claude' }, signedIn: true, account: null, outdated, install: null, setupRequired: null }],
  });
  await r.refresh();
  const claude = r.list().find((a) => a.id === 'claude');
  assert.equal(claude.status, 'ready', 'an older one still works: only said');
  assert.deepEqual(claude.outdated, outdated);
});

test('Codex is connected from the start, Claude Code once the person connects it; a choice kept stays as it is', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  assert.deepEqual(readChoices(dir).disconnected, ['claude']);
  writeFileSync(join(dir, 'agents.json'), JSON.stringify({ disconnected: [] }));
  assert.deepEqual(readChoices(dir).disconnected, [], 'connected before: still connected');
});

test('a sign-in in Terminal is waited for asking only that agent, until it is signed in or the wait is over', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  const cursor = (signedIn) => ({ id: 'cursor', cli: { path: '/bin/cursor-agent' }, signedIn, install: null, setupRequired: null });
  let signedIn = false;
  let all = 0;
  const asked = [];
  const r = roster(dir, undefined, {
    localAgents: async () => { all++; return [cursor(signedIn)]; },
    localAgent: async (id) => { asked.push(id); return cursor(signedIn); },
    signInWait: { ms: 2000, pollMs: 10 },
  });
  assert.deepEqual(await r.connect('cursor'), { ok: true });
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(r.list().find((a) => a.id === 'cursor').status, 'waiting');
  const before = all;
  signedIn = true;
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(r.list().find((a) => a.id === 'cursor').status, 'ready');
  assert.ok(asked.length > 1 && asked.every((id) => id === 'cursor'));
  assert.equal(all, before, 'the other agents are not asked while it waits');

  /* a sign-in never finished: asked about until the wait is over, then it needs its sign-in again */
  const late = roster(mkdtempSync(join(tmpdir(), 'of-roster-')), undefined, {
    localAgents: async () => [cursor(false)], localAgent: async () => cursor(false), signInWait: { ms: 40, pollMs: 10 },
  });
  await late.connect('cursor');
  await new Promise((done) => setTimeout(done, 120));
  assert.equal(late.list().find((a) => a.id === 'cursor').status, 'sign-in');
});

test('Start again while a sign-in is waited for opens its sign-in again, and the wait starts over', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  const cursor = (signedIn) => ({ id: 'cursor', cli: { path: '/bin/cursor-agent' }, signedIn, install: null, setupRequired: null });
  const opened = [];
  let signedIn = false;
  const r = roster(dir, undefined, {
    localAgents: async () => [cursor(signedIn)], localAgent: async () => cursor(signedIn),
    openSignIn: async (id) => { opened.push(id); return { ok: true }; },
    signInWait: { ms: 300, pollMs: 10 },
  });
  const status = () => r.list().find((a) => a.id === 'cursor').status;
  const after = (ms) => new Promise((done) => setTimeout(done, ms));
  await r.connect('cursor');
  await after(150);
  assert.equal(status(), 'waiting');

  /* its window was closed before the sign-in was done: Start again (connect) opens it again */
  assert.deepEqual(await r.connect('cursor'), { ok: true });
  assert.deepEqual(opened, ['cursor', 'cursor']);
  await after(230);
  assert.equal(status(), 'waiting', 'the first wait is over, the second is not');
  await after(220);
  assert.equal(status(), 'sign-in', 'the second wait is over too');

  /* and a sign-in finished after Start again is seen */
  await r.connect('cursor');
  await after(30);
  await r.connect('cursor');
  signedIn = true;
  await after(60);
  assert.equal(status(), 'ready');
});

test('closing the login terminal restores sign-in even while an authentication probe is stuck', async () => {
  const qwen = (signedIn) => ({ id: 'qwen', cli: { path: '/bin/qwen' }, signedIn });
  const pending = Promise.withResolvers();
  const started = Promise.withResolvers();
  let open = true;
  let probes = 0;
  const r = roster(mkdtempSync(join(tmpdir(), 'of-roster-')), undefined, {
    localAgents: async () => [qwen(false)],
    localAgent: async () => { probes++; started.resolve(); return pending.promise; },
    openSignIn: async () => ({ ok: true, isOpen: async () => open }),
    signInWait: { ms: 2000, pollMs: 5 },
  });
  const status = () => r.list().find((a) => a.id === 'qwen').status;
  try {
    await r.refresh();
    await r.connect('qwen');
    await started.promise;
    assert.equal(status(), 'waiting');
    open = false;
    for (let i = 0; i < 100 && status() === 'waiting'; i++) await new Promise((done) => setTimeout(done, 5));
    assert.equal(status(), 'sign-in', 'closing the terminal does not wait for the authentication probe or the 15 minute timeout');
    pending.resolve(qwen(true));
    await new Promise((done) => setTimeout(done, 30));
    assert.equal(status(), 'sign-in', 'a stale probe cannot overwrite the cancelled wait');
    assert.equal(probes, 1, 'polling stops after the terminal closes');
  } finally {
    r.cancelSignIn('qwen');
    pending.resolve(qwen(false));
  }
});

test('cancelling sign-in restores the login state without disconnecting or waiting for an outstanding probe', async () => {
  const qwen = (signedIn) => ({ id: 'qwen', cli: { path: '/bin/qwen' }, signedIn });
  const pending = Promise.withResolvers();
  const started = Promise.withResolvers();
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  const r = roster(dir, undefined, {
    localAgents: async () => [qwen(false)],
    localAgent: async () => { started.resolve(); return pending.promise; },
    signInWait: { ms: 2000, pollMs: 5 },
  });
  await r.refresh();
  await r.connect('qwen');
  await started.promise;
  r.cancelSignIn('qwen');
  assert.equal(r.list().find((a) => a.id === 'qwen').status, 'sign-in');
  assert.equal(readChoices(dir).disconnected.includes('qwen'), false);
  pending.resolve(qwen(true));
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(r.list().find((a) => a.id === 'qwen').status, 'sign-in');
  await r.connect('qwen');
  for (let i = 0; i < 100 && r.list().find((a) => a.id === 'qwen').status === 'waiting'; i++) await new Promise((done) => setTimeout(done, 5));
  assert.equal(r.list().find((a) => a.id === 'qwen').status, 'ready', 'sign-in can be started again and complete normally');
});

test('an old login terminal closing after Start again does not cancel the new login', async () => {
  const qwen = { id: 'qwen', cli: { path: '/bin/qwen' }, signedIn: false };
  const windows = [];
  const r = roster(mkdtempSync(join(tmpdir(), 'of-roster-')), undefined, {
    localAgents: async () => [qwen], localAgent: async () => qwen,
    openSignIn: async () => {
      const window = { open: true };
      windows.push(window);
      return { ok: true, isOpen: async () => window.open };
    },
    signInWait: { ms: 2000, pollMs: 5 },
  });
  const status = () => r.list().find((a) => a.id === 'qwen').status;
  try {
    await r.connect('qwen');
    await r.connect('qwen');
    windows[0].open = false;
    await new Promise((done) => setTimeout(done, 30));
    assert.equal(status(), 'waiting');
    windows[1].open = false;
    for (let i = 0; i < 100 && status() === 'waiting'; i++) await new Promise((done) => setTimeout(done, 5));
    assert.equal(status(), 'sign-in');
  } finally { r.cancelSignIn('qwen'); }
});

test("an agent found only as its maker's app: the app said, and its installer run in a terminal and waited for until it is there", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  const missing = { id: 'cursor', cli: null, signedIn: null, install: 'https://cursor.com/cli', setupRequired: null, app: 'Cursor', installer: 'curl https://cursor.com/install -fsS | bash' };
  let installed = false;
  const opened = [];
  const r = roster(dir, undefined, {
    localAgents: async () => [missing],
    localAgent: async () => (installed ? { ...missing, cli: { path: '/bin/cursor-agent' }, signedIn: false, app: undefined, installer: undefined } : missing),
    openInstaller: async (id) => { opened.push(id); return { ok: true }; },
    signInWait: { ms: 2000, pollMs: 10 },
  });
  await r.refresh();
  const before = r.list().find((a) => a.id === 'cursor');
  assert.equal(before.status, 'missing');
  assert.equal(before.app, 'Cursor');
  assert.equal(before.installer, 'curl https://cursor.com/install -fsS | bash');
  assert.deepEqual(await r.install('cursor'), { ok: true });
  assert.deepEqual(opened, ['cursor']);
  await new Promise((done) => setTimeout(done, 30));
  assert.equal(r.list().find((a) => a.id === 'cursor').installing, true);
  installed = true;
  await new Promise((done) => setTimeout(done, 60));
  const after = r.list().find((a) => a.id === 'cursor');
  assert.equal(after.status, 'off', 'installation is detected without enabling or signing in to a disabled agent');
  assert.equal(after.installing, undefined);
  assert.deepEqual(await r.install('byok'), { ok: false, error: 'No agent byok' });

  /* a terminal that did not open says why */
  const failed = roster(mkdtempSync(join(tmpdir(), 'of-roster-')), undefined, {
    localAgents: async () => [missing], openInstaller: async () => ({ ok: false, error: 'Terminal did not open.' }),
  });
  await failed.refresh();
  assert.deepEqual(await failed.install('cursor'), { ok: false, error: 'Terminal did not open.' });
  assert.equal(failed.list().find((a) => a.id === 'cursor').error, 'Terminal did not open.');
});
