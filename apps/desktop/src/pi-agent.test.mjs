import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentSession } from './agents.mjs';

/** A service on the Chat Completions API that answers "ok" and notes the model each request named (and each request, and its key). */
async function service({ broke = false } = {}) {
  const asked = [];
  const bodies = [];
  const keys = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const { model } = JSON.parse(body || '{}');
      asked.push(model);
      bodies.push(JSON.parse(body || '{}'));
      keys.push(String(req.headers.authorization ?? ''));
      if (broke) { res.writeHead(402, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Insufficient Balance' } })); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (choice, extra = {}) => `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 0, model, choices: [choice], ...extra })}\n\n`;
      res.end(chunk({ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null })
        + chunk({ index: 0, delta: {}, finish_reason: 'stop' }, { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
        + 'data: [DONE]\n\n');
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { asked, bodies, keys, url: `http://127.0.0.1:${server.address().port}/v1`, close: () => server.close() };
}

/** One of the person's own models, as the roster's harness gives it (pi-config.mjs OwnModel). */
const own = (id, url, over = {}) => ({ id, name: id, api: 'openai-completions', baseUrl: url, keyEnv: `OPENFILM_BYOK_KEY_${id}`, model: id, levels: ['auto'], effort: 'auto', ...over });

test("the own key's models, each on its own service and key, are the session's model option; a turn after a switch goes to the other service", { timeout: 60_000 }, async () => {
  const first = await service();
  const second = await service();
  const session = new AgentSession({
    agent: 'byok',
    cwd: mkdtempSync(join(tmpdir(), 'of-pi-')),
    harness: {
      home: mkdtempSync(join(tmpdir(), 'of-pi-home-')),
      models: [own('a', first.url, { name: 'Vision', model: 'vision' }), own('b', second.url, { name: 'Big', model: 'big' })],
      model: 'a',
      env: { OPENFILM_BYOK_KEY_a: 'sk-first', OPENFILM_BYOK_KEY_b: 'sk-second' },
    },
  });
  try {
    const info = await session.start();
    const option = info.configOptions.find((o) => o.id === 'model');
    assert.equal(option.category, 'model');
    assert.equal(option.currentValue, 'a', 'the first model to begin with');
    assert.deepEqual(option.options, [{ value: 'a', name: 'Vision' }, { value: 'b', name: 'Big' }], 'by their names');
    await session.prompt([{ type: 'text', text: 'hi' }]);
    const switched = await session.setConfigOption('model', 'b');
    assert.equal(switched.configOptions[0].currentValue, 'b');
    await session.prompt([{ type: 'text', text: 'again' }]);
    assert.deepEqual([first.asked, first.keys], [['vision'], ['Bearer sk-first']], 'the first on its own service, with its key');
    assert.deepEqual([second.asked, second.keys], [['big'], ['Bearer sk-second']], 'the other on its own, with its own');
    await assert.rejects(session.setConfigOption('model', 'other'), 'a model not set up is refused');
  } finally {
    session.close();
    first.close();
    second.close();
  }
});

test('a model\'s efforts are the session\'s effort option: Auto sends no reasoning setting, a level sends that level', { timeout: 60_000 }, async () => {
  const svc = await service();
  const session = new AgentSession({
    agent: 'byok',
    cwd: mkdtempSync(join(tmpdir(), 'of-pi-')),
    harness: {
      home: mkdtempSync(join(tmpdir(), 'of-pi-home-')),
      models: [own('thinker', svc.url, { levels: ['auto', 'off', 'low', 'high'], effort: 'low' }), own('plain', svc.url)],
      model: 'thinker',
      env: { OPENFILM_BYOK_KEY_thinker: 'sk-test', OPENFILM_BYOK_KEY_plain: 'sk-test' },
    },
  });
  const effortOf = (options) => options.find((o) => o.id === 'effort');
  try {
    const info = await session.start();
    const effort = effortOf(info.configOptions);
    assert.equal(effort.category, 'thought_level');
    assert.deepEqual(effort.options.map((o) => o.value), ['auto', 'off', 'low', 'high'], 'only the efforts it was given');
    assert.equal(effort.currentValue, 'low', 'the one it starts on');
    await session.prompt([{ type: 'text', text: 'one' }]);
    assert.equal(svc.bodies.at(-1).reasoning_effort, 'low');

    await session.setConfigOption('effort', 'high');
    await session.prompt([{ type: 'text', text: 'two' }]);
    assert.equal(svc.bodies.at(-1).reasoning_effort, 'high');

    await session.setConfigOption('effort', 'auto');
    await session.prompt([{ type: 'text', text: 'three' }]);
    assert.equal(svc.bodies.at(-1).reasoning_effort, undefined, 'Auto: nothing about reasoning');
    await assert.rejects(session.setConfigOption('effort', 'max'), 'an effort it was not given is refused');

    /* a model given no efforts offers none, and is asked with none */
    const plain = await session.setConfigOption('model', 'plain');
    assert.equal(effortOf(plain.configOptions), undefined);
    await session.prompt([{ type: 'text', text: 'four' }]);
    assert.equal(svc.bodies.at(-1).model, 'plain');
    assert.equal(svc.bodies.at(-1).reasoning_effort, undefined);
  } finally {
    session.close();
    svc.close();
  }
});

test('a service with no balance left is named for the model the turn was on, not the first one', { timeout: 60_000 }, async () => {
  const first = await service();
  const second = await service({ broke: true });
  const session = new AgentSession({
    agent: 'byok',
    cwd: mkdtempSync(join(tmpdir(), 'of-pi-')),
    harness: {
      home: mkdtempSync(join(tmpdir(), 'of-pi-home-')),
      models: [own('a', first.url), own('b', second.url)],
      model: 'a',
      env: { OPENFILM_BYOK_KEY_a: 'sk-first', OPENFILM_BYOK_KEY_b: 'sk-second' },
    },
  });
  try {
    await session.start();
    await session.setConfigOption('model', 'b');
    const error = await session.prompt([{ type: 'text', text: 'hi' }]).then(() => null, (e) => e);
    assert.equal(error?.code, 'balance');
    assert.equal(error.balance.provider, new URL(second.url).host);
  } finally {
    session.close();
    first.close();
    second.close();
  }
});
