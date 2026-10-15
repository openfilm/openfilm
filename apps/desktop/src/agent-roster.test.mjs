import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

test('an agent not found can be pointed at: the program is tried first, kept, and used until found automatically again', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  let picked = null;
  let check = { ok: true };
  const used = [];
  const asked = [];
  const r = roster(dir, undefined, {
    localAgents: async () => [{ id: 'codex', cli: null, signedIn: null, install: 'https://developers.openai.com/codex', setupRequired: null }],
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
  assert.deepEqual(await r.locate('codex'), { ok: true });
  assert.deepEqual(readChoices(dir).paths, { codex: 'C:\\tools\\codex.exe' });
  assert.deepEqual(used.at(-1), { codex: 'C:\\tools\\codex.exe' });
  assert.equal(r.list().find((a) => a.id === 'codex').chosen, 'C:\\tools\\codex.exe');
  assert.deepEqual(await r.useAutomatic('codex'), { ok: true });
  assert.deepEqual(readChoices(dir).paths, {});
  assert.deepEqual(used.at(-1), {});
  assert.deepEqual(await r.locate('byok'), { ok: false, error: 'No agent byok' }, 'only the person\'s own programs');
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

test('Codex is connected from the start, Claude Code once the person connects it; a choice kept stays as it is', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-roster-'));
  assert.deepEqual(readChoices(dir).disconnected, ['claude']);
  writeFileSync(join(dir, 'agents.json'), JSON.stringify({ disconnected: [] }));
  assert.deepEqual(readChoices(dir).disconnected, [], 'connected before: still connected');
});
