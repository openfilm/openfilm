import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentSession, INSTRUCTIONS, setChosenPaths } from './agents.mjs';
import { loggedBlocks, readLog, writeModelLog } from './chat-store.mjs';

/** An agent speaking ACP that keeps every prompt it is sent in `out`, one JSON line each. */
function fakeAgent(out) {
  const dir = mkdtempSync(join(tmpdir(), 'of-fake-agent-'));
  const file = join(dir, 'qwen.mjs');
  writeFileSync(file, `
import { appendFileSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import * as acp from ${JSON.stringify(import.meta.resolve('@agentclientprotocol/sdk'))};
const connection = new acp.AgentSideConnection(() => ({
  async initialize() { return { protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { promptCapabilities: { image: true } }, agentInfo: { name: 'fake', version: '1' }, authMethods: [] }; },
  async newSession() { return { sessionId: 'fake-session' }; },
  async prompt(params) {
    appendFileSync(${JSON.stringify(out)}, JSON.stringify({ argv: process.argv.slice(2), prompt: params.prompt }) + '\\n');
    await connection.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done.' } } });
    return { stopReason: 'end_turn' };
  },
  async cancel() {},
}), acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
await connection.closed;
`);
  return file;
}

test('the turn log has what the agent was started with and each message as it got it: the app\'s words before the first, no key\'s value', { timeout: 60_000 }, async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'of-fake-out-')), 'prompts.jsonl');
  setChosenPaths({ qwen: fakeAgent(out) });
  const sent = [];
  const session = new AgentSession({
    agent: 'qwen',
    cwd: mkdtempSync(join(tmpdir(), 'of-project-')),
    binDir: '/app/bin',
    env: { OPENFILM_HOME: '/data', SOME_API_KEY: 'sk-secret' },
    onSend: (message) => sent.push(message),
  });
  try {
    await session.start();
    const opened = session.opened;
    assert.deepEqual(opened.command.slice(-3), ['--acp', '--approval-mode', 'yolo'], 'started as the registry starts it');
    assert.equal(opened.firstMessage, INSTRUCTIONS, 'an agent with no place for them is told in its first message');
    assert.equal(opened.env.OPENFILM_HOME, '/data');
    assert.equal(opened.env.SOME_API_KEY, '(hidden)', 'a key is named, never its value');
    assert.ok(!JSON.stringify(opened).includes('sk-secret'));
    assert.equal(opened.path.first, '/app/bin');
    assert.equal(opened.session.method, 'session/new');
    assert.deepEqual(opened.session.params.mcpServers, []);
    assert.equal(opened.initialize.response.agentInfo.name, 'fake');

    await session.prompt([{ type: 'text', text: 'Make a title' }]);
    await session.prompt([{ type: 'text', text: 'Shorter' }]);
    const got = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(sent.map((m) => m.prompt), got.map((g) => g.prompt), 'logged exactly as the agent got it');
    assert.deepEqual(got[0].prompt, [{ type: 'text', text: INSTRUCTIONS }, { type: 'text', text: 'Make a title' }]);
    assert.deepEqual(got[1].prompt, [{ type: 'text', text: 'Shorter' }], 'told once');
  } finally {
    session.close();
    setChosenPaths({});
  }
});

test('in Developer mode an agent is started with its own logging switch, and the turn log says where it writes', { timeout: 60_000 }, async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'of-fake-out-')), 'prompts.jsonl');
  setChosenPaths({ qwen: fakeAgent(out) });
  const logDir = mkdtempSync(join(tmpdir(), 'of-agent-logs-'));
  const session = new AgentSession({ agent: 'qwen', cwd: mkdtempSync(join(tmpdir(), 'of-project-')), logDir });
  try {
    await session.start();
    const { log, command } = session.opened;
    assert.equal(log.agent, 'qwen');
    assert.ok(log.dir.startsWith(join(logDir, 'qwen')));
    assert.deepEqual(command.slice(-6), ['--acp', '--approval-mode', 'yolo', '--openai-logging', '--openai-logging-dir', log.dir], 'its own flags, then the switch');
    await session.prompt([{ type: 'text', text: 'hi' }]);
    const [got] = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(got.argv.slice(-3), ['--openai-logging', '--openai-logging-dir', log.dir]);
  } finally {
    session.close();
    setChosenPaths({});
  }
});

test('a message\'s pictures are kept in the logs by their content and named in its blocks; a turn\'s model log is written whole', () => {
  const project = mkdtempSync(join(tmpdir(), 'of-log-'));
  const data = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
  const blocks = loggedBlocks(project, [{ type: 'text', text: 'this one' }, { type: 'image', mimeType: 'image/jpeg', data }, { type: 'image', mimeType: 'image/jpeg', data }]);
  assert.deepEqual(blocks[0], { type: 'text', text: 'this one' });
  assert.match(blocks[1].file, /^\.film\/logs\/images\/[0-9a-f]{40}\.jpg$/);
  assert.equal(blocks[1].file, blocks[2].file, 'the same picture kept once');
  assert.equal(blocks[1].bytes, 7);
  assert.ok(!('data' in blocks[1]));
  assert.ok(existsSync(join(project, blocks[1].file)));

  const turn = 'local:t1';
  writeModelLog(project, turn, [{ startedAt: 1, ms: 2, prefix: 0, messages: [], answer: null }]);
  writeModelLog(project, turn, [{ startedAt: 3, ms: 4, prefix: 0, messages: [], answer: null }]);
  writeFileSync(join(project, '.film', 'logs', 'local-t1.jsonl'), `${JSON.stringify({ t: 0, kind: 'prompt' })}\n`);
  assert.deepEqual(readLog(project, turn).calls.map((c) => c.startedAt), [3], 'in place of the one before');
});
