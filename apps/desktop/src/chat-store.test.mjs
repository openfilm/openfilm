import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chatDir, loadChat, logsDir, openLog, readLog, refsDir, saveRefImage, saveSessions, saveTurn } from './chat-store.mjs';

const project = () => mkdtempSync(join(tmpdir(), 'of-chat-'));
const turn = (id, createdAt) => ({ turn: { id, createdAt, sessionId: 's1', prompt: id }, items: [{ kind: 'text', text: id }] });

test('a project with no chat yet has none; what is saved comes back, the turns in the order they were asked', () => {
  const dir = project();
  assert.deepEqual(loadChat(dir), { sessions: [], last: null, turns: [] });
  saveSessions(dir, { sessions: [{ id: 's1', title: 'One', createdAt: '2026-10-07T00:00:00Z' }], last: 's1' });
  saveTurn(dir, turn('t2', '2026-10-07T00:00:02Z'));
  saveTurn(dir, turn('t1', '2026-10-07T00:00:01Z'));
  const chat = loadChat(dir);
  assert.equal(chat.last, 's1');
  assert.deepEqual(chat.sessions.map((s) => s.id), ['s1']);
  assert.deepEqual(chat.turns.map((t) => t.turn.id), ['t1', 't2']);
  saveTurn(dir, { ...turn('t1', '2026-10-07T00:00:01Z'), items: [] });
  assert.deepEqual(loadChat(dir).turns.find((t) => t.turn.id === 't1').items, [], 'a turn saved again replaces itself');
});

test('a turn is written to its log as it happens and read back, a broken last line left out', async () => {
  const dir = project();
  const log = openLog(dir, 't1');
  log.write('prompt', { text: 'hello' });
  log.write('update', { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } } });
  log.write('done', { ok: true, stopReason: 'end_turn' });
  log.end();
  await new Promise((done) => setTimeout(done, 50));
  appendFileSync(join(logsDir(dir), 't1.jsonl'), '{"t":1,"kind":"upd');
  const read = readLog(dir, 't1');
  assert.deepEqual(read.events.map((e) => e.kind), ['prompt', 'update', 'done']);
  assert.ok(read.events.every((e) => typeof e.t === 'number'));
  assert.equal(read.cut, false);
});

test('a local turn\'s id (local:…) names a file any system allows', async () => {
  const dir = project();
  saveTurn(dir, turn('local:abc123', '2026-10-07T00:00:00Z'));
  const log = openLog(dir, 'local:abc123');
  log.write('prompt', {});
  log.end();
  await new Promise((done) => setTimeout(done, 50));
  assert.deepEqual(loadChat(dir).turns.map((t) => t.turn.id), ['local:abc123']);
  assert.ok(readLog(dir, 'local:abc123').file.endsWith('local-abc123.jsonl'));
});

test('ids that are not ids name no file', () => {
  const dir = project();
  assert.throws(() => saveTurn(dir, turn('../escape', 'x')));
  assert.equal(readLog(dir, '../../etc/passwd'), null);
  const log = openLog(dir, 'a/b');
  log.write('prompt', {});
  log.end();
  assert.equal(readLog(dir, 'a'), null);
});

test('sessions are written whole, never half', () => {
  const dir = project();
  saveSessions(dir, { sessions: [{ id: 's1', createdAt: 'x' }], last: null });
  const text = readFileSync(join(chatDir(dir), 'sessions.json'), 'utf8');
  assert.equal(JSON.parse(text).version, 1);
});

test('a turn\'s model requests are kept beside its log and read back with it', async () => {
  const dir = project();
  const log = openLog(dir, 'local:m1', () => {}, '.model');
  log.write('call', { startedAt: 1, ms: 2, prefix: 0, messages: [{ role: 'user', content: 'hi' }], params: { model: 'm' }, response: null, error: null });
  log.end();
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(readLog(dir, 'local:m1'), null, 'no log of its own, nothing to show');
  const events = openLog(dir, 'local:m1');
  events.write('prompt', { text: 'hi' });
  events.end();
  await new Promise((done) => setTimeout(done, 50));
  const read = readLog(dir, 'local:m1');
  assert.deepEqual(read.calls.map((c) => c.messages[0].content), ['hi']);
  assert.ok(read.file.endsWith('local-m1.jsonl'));
});

test('a reference\'s picture is kept as .film/refs/<turn>-<n>.jpg, and nothing but a JPEG under a name made here', () => {
  const dir = project();
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  assert.deepEqual(saveRefImage(dir, 'local:abc123', 2, jpeg), { path: '.film/refs/local-abc123-2.jpg' });
  assert.deepEqual([...readFileSync(join(refsDir(dir), 'local-abc123-2.jpg'))], [...jpeg]);
  assert.equal(saveRefImage(dir, 'local:abc123', 3, jpeg.buffer).path, '.film/refs/local-abc123-3.jpg');
  assert.throws(() => saveRefImage(dir, '../../etc', 1, jpeg), /not a turn/);
  assert.throws(() => saveRefImage(dir, 'local:a/b', 1, jpeg), /not a turn/);
  assert.throws(() => saveRefImage(dir, 'local:abc', 0, jpeg), /reference number/);
  assert.throws(() => saveRefImage(dir, 'local:abc', 1.5, jpeg), /reference number/);
  assert.throws(() => saveRefImage(dir, 'local:abc', 1, new Uint8Array([0x89, 0x50, 0x4e, 0x47])), /not a JPEG/);
  assert.throws(() => saveRefImage(dir, 'local:abc', 1, 'not bytes'), /not a picture/);
});
