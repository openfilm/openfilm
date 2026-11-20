import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentSession } from './agents.mjs';
import { agentOffer } from './openfilm-agent.mjs';

const commandTool = process.platform === 'win32' ? 'powershell' : 'bash';
const appendProgress = (word) => commandTool === 'powershell'
  ? `Add-Content -LiteralPath progress.txt -Value '${word}' -Encoding Ascii -ErrorAction Stop`
  : `echo '${word}' >> progress.txt`;

/** A service on the Chat Completions API that answers "ok" and notes the model each request named (and each request, and its key). */
async function service({ broke = false, fails = null, busyOnce = false, hold = null, disconnectAt = [], interruptToolAt = 0, largest = Infinity, reads = 0, command = null } = {}) {
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
      if (disconnectAt.includes(asked.length)) { res.destroy(); return; }
      /* a proxy in front of the service refusing a body past its size, with its own HTML page */
      if (body.length > largest) { res.writeHead(413, { 'content-type': 'text/html' }); res.end('<html><head><title>413 Request Entity Too Large</title></head><body><center><h1>413 Request Entity Too Large</h1></center><hr><center>openresty</center></body></html>'); return; }
      if (broke) { res.writeHead(402, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Insufficient Balance' } })); return; }
      if (busyOnce && asked.length === 1) {
        const status = typeof busyOnce === 'number' ? busyOnce : 503;
        const failure = status === 524 ? { status, error_name: 'origin_response_timeout', ray_id: 'test-ray' }
          : { error: { message: 'The service is busy.' } };
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(failure));
        return;
      }
      if (fails) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: fails } })); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'fixture-model-request' });
      const chunk = (choice, extra = {}) => `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 0, model, choices: [choice], ...extra })}\n\n`;
      if (asked.length === interruptToolAt) {
        res.write(chunk({ index: 0, delta: { role: 'assistant', tool_calls: [{
          index: 0, id: 'incomplete-tool', type: 'function', function: { name: commandTool, arguments: JSON.stringify({ command: appendProgress('interrupted') }) },
        }] }, finish_reason: null }));
        setTimeout(() => res.destroy(), 50);
        return;
      }
      if (hold && asked.length === hold.at) {
        res.write(chunk({ index: 0, delta: { role: 'assistant', content: 'partial' }, finish_reason: null }));
        hold.started(() => res.destroy());
        return;
      }
      /* When given a command, the first answer runs it through that platform's tool. */
      if (command && asked.length === 1) {
        res.end(chunk({ index: 0, delta: { role: 'assistant', tool_calls: [{
          index: 0, id: 'command-1', type: 'function', function: { name: commandTool, arguments: JSON.stringify({ command }) },
        }] }, finish_reason: null })
          + chunk({ index: 0, delta: {}, finish_reason: 'tool_calls' }) + 'data: [DONE]\n\n');
        return;
      }
      if (asked.length <= reads) {
        res.end(chunk({ index: 0, delta: { role: 'assistant', tool_calls: [{
          index: 0, id: `read-${asked.length}`, type: 'function',
          function: { name: 'read', arguments: '{"path":"frame.png"}' },
        }] }, finish_reason: null })
          + chunk({ index: 0, delta: {}, finish_reason: 'tool_calls' }) + 'data: [DONE]\n\n');
        return;
      }
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

test('a paused Pi turn resumes with the selected model and retries disconnects without replaying tools', { timeout: 30_000 }, async () => {
  let firstStarted;
  const began = new Promise((resolve) => { firstStarted = resolve; });
  const svc = await service({ hold: { at: 2, started: firstStarted }, interruptToolAt: 3, disconnectAt: [4], command: appendProgress('first') });
  const cwd = mkdtempSync(join(tmpdir(), 'of-pi-pause-'));
  const home = mkdtempSync(join(tmpdir(), 'of-pi-pause-home-'));
  const progress = () => readFileSync(join(cwd, 'progress.txt'), 'utf8').replaceAll('\r\n', '\n');
  const updates = [];
  const opts = { agent: 'byok', cwd, harness: { home, models: [own('test', svc.url), own('other', svc.url)], env: { OPENFILM_BYOK_KEY_test: 'test-key', OPENFILM_BYOK_KEY_other: 'test-key' } }, onUpdate: (update) => updates.push(update) };
  let agent = new AgentSession(opts);
  try {
    const { sessionId } = await agent.start();
    const pending = agent.prompt([{ type: 'text', text: 'Original edit request' }], { turnId: 'original' });
    await began;
    assert.equal(progress(), 'first\n', 'the first command finished before pausing');
    await agent.cancel();
    assert.equal(await pending, 'cancelled');
    agent.close();
    await agent.ended();
    agent = new AgentSession({ ...opts, resume: sessionId });
    assert.equal((await agent.start()).resumed, true);
    await agent.setConfigOption('model', 'other');
    assert.equal(await agent.prompt([], { turnId: 'original', recover: true }), 'end_turn');
    assert.equal(svc.bodies.length, 5);
    assert.deepEqual(svc.asked, ['test', 'test', 'other', 'other', 'other']);
    for (const { messages } of svc.bodies.slice(2)) {
      assert.deepEqual(messages.filter((message) => message.role === 'user').flatMap((message) => message.content).map((part) => part.text ?? part), ['Original edit request']);
      assert.equal(messages.filter((message) => message.role === 'tool').length, 1);
    }
    assert.equal(updates.filter((update) => update._meta?.openfilm?.noticeKey === 'composer.modelConnectionRetry').length, 2);
    assert.equal(updates.filter((update) => update.sessionUpdate === 'tool_call').length, 1);
    assert.equal(progress(), 'first\n', 'the first command ran exactly once and the interrupted command never ran');
    await assert.rejects(agent.prompt([], { turnId: 'original', recover: true }), /already finished/);
  } finally {
    agent.close();
    svc.close();
    await agent.ended();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('a dropped model stream keeps the partial reply and surfaces the interruption without replay', { timeout: 30_000 }, async () => {
  let disconnect;
  const svc = await service({ hold: { at: 1, started: (drop) => { disconnect = drop; } } });
  const cwd = mkdtempSync(join(tmpdir(), 'of-pi-dropped-stream-'));
  const home = mkdtempSync(join(tmpdir(), 'of-pi-dropped-stream-home-'));
  let reply = '';
  const session = new AgentSession({ agent: 'byok', cwd,
    harness: { home, models: [own('test', svc.url)], env: { OPENFILM_BYOK_KEY_test: 'test-key' } },
    onUpdate: (update) => {
      if (update.sessionUpdate === 'agent_message_chunk') {
        reply += update.content.text;
        disconnect();
      }
    },
  });
  try {
    await session.start();
    await assert.rejects(session.prompt([{ type: 'text', text: 'Hello' }]), (error) => {
      assert.match(error.message, /connection to the model service was interrupted/i);
      const { modelConnection, details } = error.data;
      assert.match(details, /terminated|connection error/i);
      assert.deepEqual({ ...modelConnection, elapsedMs: Number.isFinite(modelConnection.elapsedMs) }, {
        phase: 'streaming', host: new URL(svc.url).host, elapsedMs: true, status: 200,
        requestId: 'fixture-model-request', code: 'UND_ERR_SOCKET', retries: 0, partial: true,
      });
      return true;
    });
    assert.equal(reply, 'partial');
    assert.equal(svc.asked.length, 1);
  } finally {
    session.close();
    svc.close();
    await session.ended();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('OpenFilm account model requests follow the configured HTTP proxy', { timeout: 30_000 }, async () => {
  const svc = await service();
  const tunnels = [];
  const sockets = new Set();
  const proxy = createServer();
  proxy.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  proxy.on('connect', (req, socket, head) => {
    tunnels.push(req.url);
    const upstream = connect(Number(new URL(svc.url).port), '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.once('close', () => upstream.destroy());
  });
  await new Promise((done) => proxy.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${proxy.address().port}`;
  const model = 'anthropic/claude-opus-5.5';
  const offer = agentOffer({ default: model, data: [{ id: model, name: 'Claude Opus 5.5', efforts: ['high'], default_effort: 'high' }] }, 'http://model.openfilm.invalid/v1');
  const session = new AgentSession({ agent: 'openfilm', cwd: mkdtempSync(join(tmpdir(), 'of-pi-proxy-')),
    /* the person's proxy reaches the agent in its environment (environment.mjs); its models' keys on their own pipe */
    env: { HTTP_PROXY: url, HTTPS_PROXY: url, http_proxy: url, https_proxy: url, NO_PROXY: '', no_proxy: '' },
    harness: { home: mkdtempSync(join(tmpdir(), 'of-pi-proxy-home-')), ...offer, env: { OPENFILM_ACCOUNT_KEY: 'ofk-test-account' } },
  });
  try {
    await session.start();
    assert.equal(await session.prompt([{ type: 'text', text: 'hello through the system proxy' }]), 'end_turn');
    assert.deepEqual(svc.asked, [model]);
    assert.deepEqual(svc.keys, ['Bearer ofk-test-account']);
    assert.ok(tunnels.includes('model.openfilm.invalid:80'), 'the proxy carries the model request without resolving the target locally');
  } finally {
    session.close();
    for (const socket of sockets) socket.destroy();
    proxy.close();
    svc.close();
  }
});

test('OpenFilm account requests bypass an unavailable proxy for NO_PROXY hosts', { timeout: 30_000 }, async () => {
  const svc = await service();
  const model = 'anthropic/claude-opus-5.5';
  const offer = agentOffer({ default: model, data: [{ id: model, name: 'Claude Opus 5.5' }] }, svc.url);
  const session = new AgentSession({ agent: 'openfilm', cwd: mkdtempSync(join(tmpdir(), 'of-pi-no-proxy-')),
    env: { HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1',
      http_proxy: 'http://127.0.0.1:1', https_proxy: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' },
    harness: { home: mkdtempSync(join(tmpdir(), 'of-pi-no-proxy-home-')), ...offer, env: { OPENFILM_ACCOUNT_KEY: 'ofk-test-account' } },
  });
  try {
    await session.start();
    assert.equal(await session.prompt([{ type: 'text', text: 'hello directly' }]), 'end_turn');
    assert.deepEqual(svc.asked, [model]);
  } finally { session.close(); svc.close(); }
});

test('HTTPS model requests reach the configured HTTPS proxy before connecting to the target', { timeout: 30_000 }, async () => {
  const tunnels = [];
  const proxy = createServer();
  proxy.on('connect', (req, socket) => {
    tunnels.push(req.url);
    socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  });
  await new Promise((done) => proxy.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${proxy.address().port}`;
  const session = new AgentSession({ agent: 'byok', cwd: mkdtempSync(join(tmpdir(), 'of-pi-https-proxy-')),
    env: { HTTPS_PROXY: url, https_proxy: url, HTTP_PROXY: '', http_proxy: '', NO_PROXY: '', no_proxy: '' },
    harness: { home: mkdtempSync(join(tmpdir(), 'of-pi-https-proxy-home-')), models: [own('a', 'https://model.openfilm.invalid/v1')], model: 'a',
      env: { OPENFILM_BYOK_KEY_a: 'sk-test' } },
  });
  try {
    await session.start();
    await assert.rejects(session.prompt([{ type: 'text', text: 'hello through the HTTPS proxy' }]));
    assert.ok(tunnels.length > 0);
    assert.ok(tunnels.every((target) => target === 'model.openfilm.invalid:443'));
  } finally { session.close(); proxy.close(); }
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

test("the app's own agent's key goes to its model's service, never to a command it runs: not in its environment, nor Pi's", { timeout: 60_000, skip: process.platform === 'win32' }, async () => {
  const KEY = `sk-hidden-${randomBytes(8).toString('hex')}`;
  /* what a command sees: its own environment, and Pi's as another program of this user reads it (ps; the BSD form, read on Linux too) */
  const svc = await service({ command: 'env > seen.txt; ps ewwp $PPID >> seen.txt 2>&1; echo done >> seen.txt' });
  const cwd = mkdtempSync(join(tmpdir(), 'of-pi-env-'));
  const session = new AgentSession({
    agent: 'byok', cwd,
    harness: { home: mkdtempSync(join(tmpdir(), 'of-pi-home-')), models: [own('a', svc.url)], model: 'a', env: { OPENFILM_BYOK_KEY_a: KEY } },
  });
  try {
    await session.start();
    await session.prompt([{ type: 'text', text: 'look around' }]);
    const seen = readFileSync(join(cwd, 'seen.txt'), 'utf8');
    assert.match(seen, /PATH=/);
    assert.match(seen, /done/);
    assert.match(seen, /pi-agent\.mjs .*OPENFILM_PI=/, "Pi's own environment, as ps shows it");
    assert.ok(!seen.includes(KEY), 'the key is in no environment a command can see');
    assert.deepEqual(svc.keys, [`Bearer ${KEY}`, `Bearer ${KEY}`], 'the service gets it, each request');
  } finally {
    session.close();
    svc.close();
    rmSync(cwd, { recursive: true, force: true });
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

test('a Cloudflare 524 retries once and forwards a localizable notice without proxy JSON', { timeout: 60_000 }, async () => {
  const svc = await service({ busyOnce: 524 });
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
    assert.equal(svc.asked.length, 2);
    const notices = updates.filter((update) => update.sessionUpdate === 'notice');
    assert.equal(notices.length, 1);
    assert.equal(notices[0]._meta?.openfilm?.noticeKey, 'composer.modelTimeoutRetry');
    assert.equal(notices[0].description, undefined);
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

test('38 screenshot reads keep small previews and preserve each earlier request prefix', { timeout: 60_000 }, async () => {
  const svc = await service({ reads: 38 });
  const root = mkdtempSync(join(tmpdir(), 'of-pi-previews-'));
  const updates = [];
  const session = new AgentSession({
    agent: 'byok', cwd: root, onUpdate: update => updates.push(update),
    harness: { home: join(root, 'home'), models: [own('vision_stub', svc.url)], model: 'vision_stub', env: { 'OPENFILM_BYOK_KEY_vision_stub': 'sk' } },
  });
  try {
    writeFileSync(join(root, 'frame.png'), noisePng(1100, 760));
    await session.start();
    await session.prompt([{ type: 'text', text: 'Check the film' }], { turnId: 'local-preview-test' });
    assert.equal(svc.bodies.length, 39);
    const last = JSON.stringify(svc.bodies.at(-1));
    assert.doesNotMatch(last, /was left out of this request|picture was omitted/);
    const images = [...last.matchAll(/data:image\/[^;]+;base64,([a-z0-9+/=]+)/gi)];
    assert.equal(images.length, 38, 'read previews are retained while the request is within its limits');
    assert.ok(images.every(([, data]) => data.length <= 128 * 1024));
    const stored = join(root, '.film', 'chat', 'agent');
    const transcript = readFileSync(join(stored, readdirSync(stored).find(name => name.endsWith('.jsonl'))), 'utf8');
    assert.ok(transcript.length < 6 * 1024 * 1024, 'stored transcript keeps bounded per-image previews');
    for (let i = 1; i < svc.bodies.length; i++) {
      const previous = svc.bodies[i - 1].messages;
      assert.deepEqual(svc.bodies[i].messages.slice(0, previous.length), previous, `request ${i + 1} appends without rewriting earlier screenshots`);
    }
    assert.equal(updates.filter(update => update.sessionUpdate === 'notice' && /Older pictures/.test(update.title)).length, 0);
    const logged = readFileSync(join(root, '.film', 'logs', 'local-preview-test.model.jsonl'), 'utf8');
    assert.doesNotMatch(logged, /"imageContext"/, 'no cleanup or cache rebuild was necessary');
  } finally {
    session.close();
    svc.close();
    /* Windows will not remove a folder a process still works in */
    await session.ended();
    rmSync(root, { recursive: true, force: true });
  }
});

test('batch omissions are stored outside model context and survive restarting the agent', { timeout: 60_000 }, async () => {
  const svc = await service();
  const root = mkdtempSync(join(tmpdir(), 'of-pi-image-resume-'));
  const options = { agent: 'byok', cwd: root,
    harness: { home: join(root, 'home'), models: [own('a', svc.url)], model: 'a', env: { OPENFILM_BYOK_KEY_a: 'sk' } } };
  const first = new AgentSession(options);
  let resumed;
  const picture = { type: 'image', mimeType: 'image/png', data: noisePng(1, 1).toString('base64') };
  const countPictures = (body) => (JSON.stringify(body).match(/data:image\//g) ?? []).length;
  try {
    const info = await first.start();
    await first.prompt([{ type: 'text', text: 'Compare these pictures' }, ...Array.from({ length: 101 }, () => picture)], { turnId: 'image-batch' });
    assert.equal(countPictures(svc.bodies[0]), 50, 'the count guard clears a batch with room for future pictures');
    const stored = join(root, '.film', 'chat', 'agent');
    const transcript = readFileSync(join(stored, readdirSync(stored).find(name => name.endsWith('.jsonl'))), 'utf8');
    assert.match(transcript, /"customType":"openfilm-image-context"/);
    assert.doesNotMatch(JSON.stringify(svc.bodies[0]), /openfilm-image-context/, 'extension state is not sent to the model');
    const logged = readFileSync(join(root, '.film', 'logs', 'image-batch.model.jsonl'), 'utf8');
    assert.match(logged, /"pruned":51,"reason":"count"/, 'the local model log explains the one cache rebuild');
    first.close();
    resumed = new AgentSession({ ...options, resume: info.sessionId });
    assert.equal((await resumed.start()).resumed, true);
    await resumed.prompt([{ type: 'text', text: 'One more picture' }, picture]);
    assert.equal(countPictures(svc.bodies[1]), 51, 'old pictures remain omitted and the newly attached picture is visible');
    const previous = svc.bodies[0].messages;
    assert.deepEqual(svc.bodies[1].messages.slice(0, previous.length), previous, 'restoration preserves the previously sent prefix');
  } finally {
    first.close();
    resumed?.close();
    svc.close();
    await Promise.all([first.ended(), resumed?.ended()]);
    rmSync(root, { recursive: true, force: true });
  }
});

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
    const prefix = svc.bodies.at(-1).messages;
    await session.prompt([{ type: 'text', text: 'Continue' }]);
    assert.deepEqual(svc.bodies.at(-1).messages.slice(0, prefix.length), prefix, 'the following request retains the recovered prefix');
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
