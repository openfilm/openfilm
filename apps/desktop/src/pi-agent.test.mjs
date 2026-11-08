import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentSession } from './agents.mjs';
import { agentOffer } from './openfilm-agent.mjs';

/** A service on the Chat Completions API that answers "ok" and notes the model each request named (and each request, and its key). */
async function service({ broke = false, fails = null, busyOnce = false, largest = Infinity } = {}) {
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
      /* a proxy in front of the service refusing a body past its size, with its own HTML page */
      if (body.length > largest) { res.writeHead(413, { 'content-type': 'text/html' }); res.end('<html><head><title>413 Request Entity Too Large</title></head><body><center><h1>413 Request Entity Too Large</h1></center><hr><center>openresty</center></body></html>'); return; }
      if (broke) { res.writeHead(402, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Insufficient Balance' } })); return; }
      if (busyOnce && asked.length === 1) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'The service is busy.' } })); return; }
      if (fails) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: fails } })); return; }
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

test('OpenFilm runs Pi on the shared account, switches cloud models and sends OpenRouter reasoning through the relay', { timeout: 60_000 }, async () => {
  const svc = await service();
  const deepseek = 'deepseek/deepseek-v4.1-flash-1017';
  const haiku = 'anthropic/claude-haiku-5.5';
  const offer = agentOffer({ default: deepseek, data: [
    { id: deepseek, name: 'DeepSeek V4.1 Flash 1017', efforts: ['low', 'high', 'max'], default_effort: 'high', context_length: 1_048_576 },
    { id: haiku, name: 'Claude Haiku 5.5', efforts: ['off', 'low', 'medium', 'high'], default_effort: 'high', context_length: 1_000_000 },
  ] }, svc.url);
  const session = new AgentSession({ agent: 'openfilm', cwd: mkdtempSync(join(tmpdir(), 'of-built-in-')),
    harness: { home: mkdtempSync(join(tmpdir(), 'of-built-in-home-')), ...offer, env: { OPENFILM_ACCOUNT_KEY: 'ofk-test-account' } },
  });
  try {
    const info = await session.start();
    assert.equal(svc.asked.length, 0, 'listing models spends nothing');
    assert.equal(info.configOptions.find((o) => o.id === 'model').currentValue, deepseek);
    await session.prompt([{ type: 'text', text: 'hello' }]);
    await session.setConfigOption('model', haiku);
    await session.setConfigOption('effort', 'off');
    await session.prompt([{ type: 'text', text: 'hello again' }]);
    assert.deepEqual(svc.asked, [deepseek, haiku]);
    assert.deepEqual(svc.keys, ['Bearer ofk-test-account', 'Bearer ofk-test-account']);
    assert.deepEqual(svc.bodies[0].reasoning, { effort: 'high' });
    assert.deepEqual(svc.bodies[1].reasoning, { effort: 'none' });
    assert.ok(svc.bodies[0].tools.length > 0, 'the built-in agent can use its tools');
    assert.ok(svc.bodies[0].messages.some((m) => m.role === 'system'));
  } finally { session.close(); svc.close(); }
});

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

test('a turn that fails says why, as the service said it, not "Internal error"', { timeout: 60_000 }, async () => {
  const svc = await service({ fails: 'The model `big` does not exist.' });
  const session = new AgentSession({
    agent: 'byok',
    cwd: mkdtempSync(join(tmpdir(), 'of-pi-')),
    harness: { home: mkdtempSync(join(tmpdir(), 'of-pi-home-')), models: [own('a', svc.url)], model: 'a', env: { OPENFILM_BYOK_KEY_a: 'sk' } },
  });
  try {
    await session.start();
    const error = await session.prompt([{ type: 'text', text: 'hi' }]).then(() => null, (e) => e);
    assert.match(error?.message ?? '', /The model `big` does not exist\./);
    assert.equal(error.code, -32603);
  } finally {
    session.close();
    svc.close();
  }
});

test('a conversation too long for the model says so, and where its context is set', { timeout: 60_000 }, async () => {
  const svc = await service({ fails: "This model's maximum context length is 1000 tokens. However, you requested about 2000 tokens." });
  const session = new AgentSession({
    agent: 'byok',
    cwd: mkdtempSync(join(tmpdir(), 'of-pi-')),
    harness: { home: mkdtempSync(join(tmpdir(), 'of-pi-home-')), models: [own('a', svc.url)], model: 'a', env: { OPENFILM_BYOK_KEY_a: 'sk' } },
  });
  try {
    await session.start();
    const error = await session.prompt([{ type: 'text', text: 'hi' }]).then(() => null, (e) => e);
    assert.equal(error?.message, "The conversation is too long for the model. The model's context may be smaller than set in Settings: lower it there.");
    assert.match(error.data?.details ?? '', /maximum context length is 1000 tokens/, 'what the service said goes too');
  } finally {
    session.close();
    svc.close();
  }
});

test('a service that fails and is tried again says so in the chat as a notice, and the turn goes on', { timeout: 60_000 }, async () => {
  const svc = await service({ busyOnce: true });
  const updates = [];
  const session = new AgentSession({
    agent: 'byok',
    cwd: mkdtempSync(join(tmpdir(), 'of-pi-')),
    harness: { home: mkdtempSync(join(tmpdir(), 'of-pi-home-')), models: [own('a', svc.url)], model: 'a', env: { OPENFILM_BYOK_KEY_a: 'sk' } },
    onUpdate: (update) => updates.push(update),
  });
  try {
    await session.start();
    assert.equal(await session.prompt([{ type: 'text', text: 'hi' }]), 'end_turn');
    assert.equal(svc.asked.length, 2, 'asked twice');
    const notices = updates.filter((u) => u.sessionUpdate === 'notice');
    assert.equal(notices.length, 1, 'one notice, and none once it answers');
    assert.equal(notices[0].severity, 'warning');
    assert.equal(notices[0].title, 'The model service failed; trying again (1 of 1).');
    assert.match(notices[0].description, /The service is busy/);
  } finally {
    session.close();
    svc.close();
  }
});

/** A picture of noise, which no encoding makes smaller: `w` × `h`, RGB, as a PNG. */
function noisePng(w, h) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), randomBytes(w * 3)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}

test('a request refused as too large is tried again at once with half of its pictures, and the turn goes on', { timeout: 60_000 }, async () => {
  const svc = await service({ largest: 8 * 1024 * 1024 });
  const session = new AgentSession({
    agent: 'byok',
    cwd: mkdtempSync(join(tmpdir(), 'of-pi-')),
    harness: { home: mkdtempSync(join(tmpdir(), 'of-pi-home-')), models: [own('a', svc.url)], model: 'a', env: { OPENFILM_BYOK_KEY_a: 'sk' } },
  });
  /* fourteen pictures of about 0.95 MB each (Pi sends them as they are): 13 MB, past this service's 8 MB */
  const pictures = Array.from({ length: 14 }, () => ({ type: 'image', mimeType: 'image/png', data: noisePng(560, 420).toString('base64') }));
  try {
    await session.start();
    await session.prompt([{ type: 'text', text: 'look' }, ...pictures]);
    assert.equal(svc.bodies.length, 2, 'refused once, then tried again');
    const last = JSON.stringify(svc.bodies.at(-1));
    assert.ok(last.length < 8 * 1024 * 1024, 'the request tried again is within the service\'s size');
    assert.equal((last.match(/left out of this request to keep it small/g) ?? []).length, 7, 'half of the pictures left out, the oldest');
  } finally {
    session.close();
    svc.close();
  }
});

test('a request still too large when tried again with half of its pictures says so, and the next message goes on with fewer', { timeout: 60_000 }, async () => {
  const svc = await service({ largest: 4 * 1024 * 1024 });
  const session = new AgentSession({
    agent: 'byok',
    cwd: mkdtempSync(join(tmpdir(), 'of-pi-')),
    harness: { home: mkdtempSync(join(tmpdir(), 'of-pi-home-')), models: [own('a', svc.url)], model: 'a', env: { OPENFILM_BYOK_KEY_a: 'sk' } },
  });
  const pictures = Array.from({ length: 14 }, () => ({ type: 'image', mimeType: 'image/png', data: noisePng(560, 420).toString('base64') }));
  try {
    await session.start();
    const error = await session.prompt([{ type: 'text', text: 'look' }, ...pictures]).then(() => null, (e) => e);
    assert.match(error?.message ?? '', /too large for the model service, even with older pictures left out/);
    await session.prompt([{ type: 'text', text: 'go on' }]);
    assert.ok(JSON.stringify(svc.bodies.at(-1)).length < 4 * 1024 * 1024, 'the next message goes with fewer pictures still');
  } finally {
    session.close();
    svc.close();
  }
});

test('a request too large with no pictures in it is not tried again, and says so', { timeout: 60_000 }, async () => {
  const svc = await service({ largest: 10 });
  const session = new AgentSession({
    agent: 'byok',
    cwd: mkdtempSync(join(tmpdir(), 'of-pi-')),
    harness: { home: mkdtempSync(join(tmpdir(), 'of-pi-home-')), models: [own('a', svc.url)], model: 'a', env: { OPENFILM_BYOK_KEY_a: 'sk' } },
  });
  try {
    await session.start();
    const error = await session.prompt([{ type: 'text', text: 'hi' }]).then(() => null, (e) => e);
    assert.match(error?.message ?? '', /too large for the model service/);
    assert.equal(svc.bodies.length, 1, 'not tried again');
  } finally {
    session.close();
    svc.close();
  }
});
