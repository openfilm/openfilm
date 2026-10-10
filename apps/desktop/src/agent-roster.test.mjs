import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRoster, probeRequest, readChoices } from './agent-roster.mjs';

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

test('a key is kept only once the service took it with a picture; a model that cannot read one is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  let answer = { status: 400, body: { error: { message: 'This model does not support image input.' } } };
  const fetch = async () => new Response(JSON.stringify(answer.body), { status: answer.status });
  const r = roster(dir, fetch);
  const refused = await r.configureByok({ format: 'chat', baseUrl: 'https://api.deepseek.com/v1', model: 'text-only', key: 'sk-1234' });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'no-images');
  assert.equal(readChoices(dir).byok, null, 'nothing kept');
  answer = { status: 401, body: {} };
  assert.match((await r.configureByok({ format: 'chat', baseUrl: 'https://api.deepseek.com/v1', model: 'm', key: 'bad' })).error, /did not accept/);
  answer = { status: 200, body: { choices: [] } };
  assert.deepEqual(await r.configureByok({ format: 'chat', baseUrl: 'https://api.deepseek.com/v1/', model: 'vision', key: 'sk-good-9876' }), { ok: true });
  assert.deepEqual(readChoices(dir).byok, { format: 'chat', baseUrl: 'https://api.deepseek.com/v1', model: 'vision', last4: '9876' });
  assert.equal(readChoices(dir).shown.byok, true, 'set up: shown in the chat');
  assert.equal(readFileSync(join(dir, 'byok.key'), 'utf8'), 'sealed:sk-good-9876', 'the key sealed');
  assert.equal(JSON.stringify(readChoices(dir)).includes('sk-good'), false, 'never in the choices file');
});

test('each format is Pi\'s provider on that API, the key in its own variable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  const ok = async () => new Response('{}', { status: 200 });
  const r = roster(dir, ok);
  await r.configureByok({ format: 'responses', baseUrl: '', model: 'gpt-x', key: 'sk-a' });
  let h = r.harness('byok');
  assert.deepEqual(h.provider, { id: 'byok', api: 'openai-responses', baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENFILM_BYOK_KEY' }, 'the official address when none is given');
  assert.equal(h.model, 'gpt-x');
  assert.deepEqual(h.env, { OPENFILM_BYOK_KEY: 'sk-a' });
  assert.equal(h.home, join(dir, 'agents', 'byok', 'pi'), 'its own folder, never the person\'s ~/.pi');

  await r.configureByok({ format: 'chat', baseUrl: 'https://api.deepseek.com/v1', model: 'ds', key: '' });
  h = r.harness('byok');
  assert.equal(h.provider.api, 'openai-completions');
  assert.equal(h.provider.baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(h.env.OPENFILM_BYOK_KEY, 'sk-a', 'an empty key keeps the one kept');

  await r.configureByok({ format: 'anthropic', baseUrl: '', model: 'claude-x', key: 'sk-ant' });
  h = r.harness('byok');
  assert.equal(h.provider.api, 'anthropic-messages');
  assert.equal(h.provider.baseUrl, 'https://api.anthropic.com');
  assert.equal(h.model, 'claude-x');
});

test("Codex and Claude Code are shown in the chat from the start, the person's other agents once connected or switched on", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  const found = (id, cli) => ({ id, cli, signedIn: true, install: 'https://example.test', setupRequired: null });
  const r = roster(dir, undefined, { localAgents: async () => [found('codex', null), found('claude', null), found('gemini', { path: '/bin/gemini' }), found('kimi', null)] });
  const list = await r.refresh();
  const of = (id) => list.find((a) => a.id === id);
  assert.equal(of('codex').shown, true, 'not installed, still shown');
  assert.equal(of('gemini').status, 'ready');
  assert.equal(of('gemini').shown, false, 'installed, not chosen yet');
  assert.equal(of('kimi').status, 'missing');
  await r.connect('gemini');
  assert.equal(r.list().find((a) => a.id === 'gemini').shown, true, 'connected: chosen');
  r.setShown('kimi', true);
  assert.equal(readChoices(dir).shown.kimi, true);
});
