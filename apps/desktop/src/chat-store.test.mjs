import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachmentsDir, chatDir, describePaths, loadChat, logsDir, openLog, readLog, refsDir, saveAttachment, saveRefImage, saveSessions, saveTurn, unsavedTurns, writeModelLog } from './chat-store.mjs';

const project = () => mkdtempSync(join(tmpdir(), 'of-chat-'));
const turn = (id, createdAt) => ({ turn: { id, createdAt, sessionId: 's1', prompt: id }, items: [{ kind: 'text', text: id }] });
/** a turn's log is written through a stream: wait until what a reader needs is on disk (a slow runner needs more than a fixed pause) */
async function until(fn, ok) {
  for (let i = 0; i < 500; i += 1) {
    const value = fn();
    if (ok(value)) return value;
    await new Promise((done) => setTimeout(done, 10));
  }
  return fn();
}
const logOnDisk = (dir, id, lines = 1) => until(() => readLog(dir, id), (read) => Boolean(read && read.events.length >= lines));

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
  await logOnDisk(dir, 't1', 3);
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
  const read = await logOnDisk(dir, 'local:abc123');
  assert.deepEqual(loadChat(dir).turns.map((t) => t.turn.id), ['local:abc123']);
  assert.ok(read.file.endsWith('local-abc123.jsonl'));
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
  assert.equal(readLog(dir, 'local:m1'), null, 'no log of its own, nothing to show');
  const events = openLog(dir, 'local:m1');
  events.write('prompt', { text: 'hi' });
  events.end();
  const read = await until(() => readLog(dir, 'local:m1'), (r) => Boolean(r && r.events.length >= 1 && r.calls.length >= 1));
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

test('a pasted file is kept in .film/attachments under its own name, cleaned, and never anywhere else', () => {
  const dir = project();
  const bytes = new Uint8Array([1, 2, 3]);
  assert.deepEqual(saveAttachment(dir, 'image.png', bytes), { path: '.film/attachments/image.png' });
  assert.deepEqual([...readFileSync(join(attachmentsDir(dir), 'image.png'))], [1, 2, 3]);
  assert.equal(saveAttachment(dir, 'image.png', bytes.buffer).path, '.film/attachments/image 2.png', 'a name already there is not written over');
  assert.equal(saveAttachment(dir, 'image.png', bytes).path, '.film/attachments/image 3.png');
  assert.equal(saveAttachment(dir, '../../etc/passwd', bytes).path, '.film/attachments/passwd');
  assert.equal(saveAttachment(dir, '..\\..\\win.ini', bytes).path, '.film/attachments/win.ini');
  assert.equal(saveAttachment(dir, '.hidden', bytes).path, '.film/attachments/hidden');
  assert.equal(saveAttachment(dir, '', bytes).path, '.film/attachments/file');
  assert.throws(() => saveAttachment(dir, 'empty.txt', new Uint8Array()), /empty/);
  assert.throws(() => saveAttachment(dir, 'x.txt', 'not bytes'), /empty/);
});

test('a path dragged in is said to be a file (with its size) or a folder, where it is; one not there is said so', () => {
  const dir = project();
  const folder = join(dir, 'Footage');
  mkdirSync(folder);
  const clip = join(folder, 'a.mp4');
  writeFileSync(clip, 'abcd');
  assert.deepEqual(describePaths([clip, folder, join(dir, 'gone.mp4'), 'relative.mp4', 7]), [
    { path: clip, folder: false, size: 4 },
    { path: folder, folder: true },
    { path: join(dir, 'gone.mp4'), error: 'That file is not there any more.' },
    { path: 'relative.mp4', error: 'That is not a file.' },
    { path: '7', error: 'That is not a file.' },
  ]);
  assert.deepEqual(describePaths('not a list'), []);
});

test('a log read again from where a read stopped gives only what was written after; nothing new, nothing read', async () => {
  const dir = project();
  const log = openLog(dir, 't2');
  log.write('prompt', { text: 'hello' });
  const first = await logOnDisk(dir, 't2', 1);
  assert.equal(first.whole, true);
  assert.deepEqual(readLog(dir, 't2', { since: first.at }), { same: true });
  log.write('update', { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } } });
  log.write('done', { ok: true });
  log.end();
  const second = await until(() => readLog(dir, 't2', { since: first.at }), (r) => Boolean(r && !r.same && r.events.length >= 2));
  assert.equal(second.whole, false);
  assert.deepEqual(second.events.map((e) => e.kind), ['update', 'done'], 'only what came after');
  /* a line being written waits for the next read, whole */
  const file = join(logsDir(dir), 't2.jsonl');
  appendFileSync(file, '{"t":9,"kind":"ex');
  const half = readLog(dir, 't2', { since: second.at });
  assert.deepEqual(half.events, []);
  assert.equal(half.at.events, second.at.events, 'the half line is not passed');
  appendFileSync(file, 'it"}\n');
  assert.deepEqual(readLog(dir, 't2', { since: half.at }).events.map((e) => e.kind), ['exit']);
});

test('a long log is read as its first line and its end; a reader far behind is given it so again', () => {
  const dir = project();
  mkdirSync(logsDir(dir), { recursive: true });
  const file = join(logsDir(dir), 'local-long.jsonl');
  const filler = 'x'.repeat(200);
  const lines = [JSON.stringify({ t: 0, kind: 'prompt', text: 'go' })];
  for (let i = 1; i <= 60_000; i += 1) lines.push(JSON.stringify({ t: i, kind: 'update', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: `${i} ${filler}` } } }));
  lines.push(JSON.stringify({ t: 60_001, kind: 'done', ok: true }));
  writeFileSync(file, `${lines.join('\n')}\n`);
  const size = statSync(file).size;
  assert.ok(size > 12 * 1024 * 1024);

  const read = readLog(dir, 'local:long');
  assert.equal(read.cut, true);
  assert.equal(read.events[0].kind, 'prompt', 'the prompt, from the first line');
  assert.equal(read.events.at(-1).kind, 'done', 'how it ended, from the end');
  assert.ok(read.events.length < 45_000, `only the end is read: ${read.events.length}`);
  const ts = read.events.slice(1).map((e) => e.t);
  assert.ok(ts.every((t, i) => i === 0 || t === ts[i - 1] + 1), 'the end, whole lines in order, none broken');
  assert.equal(read.at.events, size);

  const behind = readLog(dir, 'local:long', { since: { events: 100, calls: 0, callsFile: 0 } });
  assert.equal(behind.whole, true, 'too far behind: started over');
  assert.equal(behind.events[0].kind, 'prompt');
  assert.equal(behind.events.length, read.events.length);
});

test('a log from before pictures were kept as files is read whole: its pictures\' bytes do not crowd out its events', () => {
  const dir = project();
  mkdirSync(logsDir(dir), { recursive: true });
  const picture = Buffer.alloc(768 * 1024, 3).toString('base64');
  const lines = [JSON.stringify({ t: 0, kind: 'prompt', text: 'go' })];
  for (let i = 1; i <= 3000; i += 1) {
    lines.push(JSON.stringify(i % 100 === 0
      ? { t: i, kind: 'update', update: { sessionUpdate: 'tool_call_update', toolCallId: `c${i}`, content: [{ type: 'content', content: { type: 'image', mimeType: 'image/png', data: picture } }] } }
      : { t: i, kind: 'update', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: `${i} ` } } }));
  }
  writeFileSync(join(logsDir(dir), 'local-old.jsonl'), `${lines.join('\n')}\n`);
  assert.ok(statSync(join(logsDir(dir), 'local-old.jsonl')).size > 30 * 1024 * 1024);
  const read = readLog(dir, 'local:old');
  assert.equal(read.cut, false);
  assert.equal(read.events.length, 3001, 'every event');
  assert.deepEqual(read.events[100].update.content[0].content, { type: 'image', mimeType: 'image/png', bytes: 768 * 1024 });
});

test('a log keeps a picture as a file and cuts a very long text; past its most it keeps no more of the agent\'s updates', async () => {
  const dir = project();
  const data = Buffer.alloc(300 * 1024, 7).toString('base64');
  const log = openLog(dir, 'local:big');
  log.write('prompt', { text: 'look' });
  log.write('update', { update: { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', content: [{ type: 'content', content: { type: 'image', mimeType: 'image/png', data } }] } });
  log.write('update', { update: { sessionUpdate: 'tool_call_update', toolCallId: 'c2', rawOutput: 'y'.repeat(2 * 1024 * 1024) } });
  /* past 32 MB: more updates are counted, not kept; the turn's own end is */
  const chunk = 'z'.repeat(900 * 1024);
  for (let i = 0; i < 40; i += 1) log.write('update', { update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: chunk } } });
  log.write('done', { ok: true });
  log.end();
  const file = join(logsDir(dir), 'local-big.jsonl');
  await until(() => readLog(dir, 'local:big'), (r) => Boolean(r?.events.some((e) => e.kind === 'done') && r.events.at(-1).kind === 'cut'));
  /* the file itself, line by line (a reader is given only its end) */
  const read = { events: readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) };

  const picture = read.events[1].update.content[0].content;
  assert.equal(picture.data, undefined, 'no bytes in the line');
  assert.equal(picture.bytes, 300 * 1024);
  assert.match(picture.file, /^\.film\/logs\/images\/[0-9a-f]{40}\.png$/);
  assert.ok(existsSync(join(dir, picture.file)));
  const long = read.events[2].update.rawOutput;
  assert.ok(long.length < 70 * 1024 && long.endsWith('more characters not kept]'), 'a 2 MB text cut');

  assert.ok(statSync(file).size <= 32 * 1024 * 1024 + 4096, `bounded: ${statSync(file).size}`);
  const kinds = read.events.map((e) => e.kind);
  assert.equal(kinds.filter((k) => k === 'cut').length, 2, 'where it stopped keeping updates, and as it ended how many');
  assert.ok(kinds.indexOf('done') > kinds.indexOf('cut'), 'the end kept after the cut');
  const thoughts = kinds.filter((k) => k === 'update').length - 2;
  assert.equal(read.events.at(-1).dropped, 40 - thoughts);
});

test('a model log is read without its pictures\' bytes, again only what is new, and whole once written again', async () => {
  const dir = project();
  const events = openLog(dir, 'local:m2');
  events.write('prompt', { text: 'hi' });
  events.end();
  /* a log from before pictures were kept as files: the bytes in the line */
  mkdirSync(logsDir(dir), { recursive: true });
  const data = Buffer.alloc(100 * 1024, 1).toString('base64');
  const call = (n, prefix) => JSON.stringify({ t: n, kind: 'call', startedAt: n, ms: 1, prefix, messages: [{ role: 'toolResult', toolName: 'read', content: [{ type: 'text', text: 'shot' }, { type: 'image', mimeType: 'image/png', data }] }], answer: null });
  writeFileSync(join(logsDir(dir), 'local-m2.model.jsonl'), `${call(1, 0)}\n`);
  const first = await until(() => readLog(dir, 'local:m2'), (r) => Boolean(r?.events.length));
  const picture = first.calls[0].messages[0].content[1];
  assert.deepEqual(picture, { type: 'image', mimeType: 'image/png', bytes: 100 * 1024 });
  assert.equal(first.callsWhole, true);

  appendFileSync(join(logsDir(dir), 'local-m2.model.jsonl'), `${call(2, 1)}\n`);
  const more = readLog(dir, 'local:m2', { since: first.at });
  assert.equal(more.callsWhole, false);
  assert.deepEqual(more.calls.map((c) => c.startedAt), [2]);
  assert.deepEqual(more.events, []);

  writeModelLog(dir, 'local:m2', [{ startedAt: 3, ms: 1, prefix: 0, messages: [{ role: 'toolResult', content: [{ type: 'image', mimeType: 'image/png', data }] }], answer: null }]);
  const again = readLog(dir, 'local:m2', { since: more.at });
  assert.equal(again.callsWhole, true, 'written again: whole');
  assert.deepEqual(again.calls.map((c) => c.startedAt), [3]);
  assert.match(again.calls[0].messages[0].content[0].file, /\.png$/, 'written with its picture as a file');
  assert.ok(statSync(join(logsDir(dir), 'local-m2.model.jsonl')).size < 2048);
});

test('a turn with a log and no saved record is found with its events; a saved one, one running, one with no meta are not', async () => {
  const dir = project();
  const write = (id, meta) => { const log = openLog(dir, id); log.write('prompt', { text: 'hi', ...(meta ? { meta } : {}) }); log.write('update', { update: { sessionUpdate: 'agent_message_chunk' } }); log.end(); };
  write('local:lost1', { turnId: 'local:lost1', sessionId: 's1' });
  write('local:kept1', { turnId: 'local:kept1', sessionId: 's1' });
  write('local:busy1', { turnId: 'local:busy1', sessionId: 's1' });
  write('local:bare1', null);
  saveTurn(dir, turn('local:kept1', '2026-10-12T00:00:00Z'));
  await Promise.all(['local:lost1', 'local:kept1', 'local:busy1', 'local:bare1'].map((id) => logOnDisk(dir, id, 2)));
  const found = unsavedTurns(dir, { except: ['local:busy1'] });
  assert.deepEqual(found.map((f) => f.turnId), ['local:lost1']);
  assert.deepEqual(found[0].events.map((e) => e.kind), ['prompt', 'update']);
});
