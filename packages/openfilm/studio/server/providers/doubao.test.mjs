import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import doubao, { doubaoResult } from './doubao.mjs';
import { providerKey, changeSettings } from '../keys.mjs';
import { chooseProvider } from './index.mjs';
import { runGet } from '../get.mjs';
import { readTranscript } from '../transcripts.mjs';

/* OpenFilm's service is asked what it offers: nowhere here (a port that refuses at once) */
process.env.OPENFILM_API_URL ??= 'http://127.0.0.1:9';

const fixture = () => ({ audio_info: { duration: 2000 }, result: { text: '你好，AI native。', utterances: [{ words: [
  { text: '你', start_time: 100, end_time: 300 }, { text: '好', start_time: 300, end_time: 600 },
  { text: ' ', start_time: -1, end_time: -1 }, { text: 'AI', start_time: 800, end_time: 1000 },
  { text: 'native', start_time: 1100, end_time: 1800 },
] }] } });
let server;
let reply = (_req, res) => res.writeHead(200, { 'Content-Type': 'application/json', 'X-Api-Status-Code': '20000000' }).end(JSON.stringify(fixture()));
const seen = [];
const oldUrl = process.env.OPENFILM_DOUBAO_URL;
before(async () => {
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen.push({ url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks)) });
    reply(req, res);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  process.env.OPENFILM_DOUBAO_URL = `http://127.0.0.1:${server.address().port}/recognize/flash`;
});
after(async () => {
  await new Promise(done => server.close(done));
  if (oldUrl === undefined) delete process.env.OPENFILM_DOUBAO_URL;
  else process.env.OPENFILM_DOUBAO_URL = oldUrl;
});

test('word timings are real and numeric; whitespace-only tokens are ignored', () => {
  const result = doubaoResult(fixture(), '20000000');
  assert.deepEqual(result.words[2], { token: 'AI', start: 0.8, end: 1 });
  assert.equal(result.words.length, 4);
  assert.throws(() => doubaoResult(fixture(), '45000001'));
  for (const change of [
    b => b.result.utterances[0].words = [],
    b => b.result.utterances[0].words[0].end_time = 9000,
    b => b.result.utterances[0].words[1].start_time = 0,
    b => b.result.utterances[0].words[0].start_time = null,
    b => b.result.utterances[0].words = {},
  ]) {
    const body = fixture(); change(body);
    assert.throws(() => doubaoResult(body, '20000000'));
  }
});

test('normalized numbers and symbols may differ from spoken word tokens', () => {
  const body = { result: { text: 'AI 增长了 20%。', utterances: [{ words: [
    { text: 'AI', start_time: 0, end_time: 300 },
    { text: '增长了', start_time: 300, end_time: 800 },
    { text: '百分之二十', start_time: 800, end_time: 1600 },
  ] }] } };
  const result = doubaoResult(body, '20000000');
  assert.equal(result.text, body.result.text);
  assert.deepEqual(result.words[2], { token: '百分之二十', start: 0.8, end: 1.6 });
});

test('replays word timings from a real Doubao response for non-sensitive synthetic speech', () => {
  // Recorded 2026-10-15, volc.bigasr.auc_turbo, 4.623-second synthesized English audio.
  // No credentials, request identifiers, source paths or user recordings are included.
  const tokens = [['Hello', 210, 530], ['This', 1370, 1610], ['is', 1610, 1810],
    ['an', 1810, 2090], ['audio', 2130, 2450], ['transcription', 2610, 3290], ['test', 3450, 3730]];
  const words = tokens.flatMap(([text, start_time, end_time], i) => [
    ...(i ? [{ text: ' ', start_time: -1, end_time: -1 }] : []), { text, start_time, end_time },
  ]);
  const result = doubaoResult({ audio_info: { duration: 4623 }, result: {
    text: 'Hello. This is an audio transcription test.', utterances: [{ words }],
  } }, '20000000');
  assert.equal(result.text, 'Hello. This is an audio transcription test.');
  assert.deepEqual(result.words, tokens.map(([token, start, end]) => ({ token, start: start / 1000, end: end / 1000 })));
});

test('native key settings honor explicit keys, environment keys and disconnect', () => {
  const settings = { keys: {}, use: {}, model: {}, off: [], custom: [] };
  const env = { DOUBAO_ASR_API_KEY: 'fake-env-key' };
  assert.equal(providerKey(doubao, settings, env).source, 'env');
  assert.equal(providerKey(doubao, { ...settings, off: ['doubao'] }, env), null);
  assert.equal(providerKey(doubao, { ...settings, keys: { doubao: 'fake-explicit-key' } }, env).key, 'fake-explicit-key');
});

test('MP4 to fake Doubao to word-timed VTT; cache reuse, HTTP failures and uncertain requests', async () => {
  // Retain this isolated synthetic project for inspection; never use an installed Studio or real credentials.
  const root = mkdtempSync(join(tmpdir(), 'openfilm-doubao-test-'));
  mkdirSync(join(root, 'assets'));
  const oldHome = process.env.OPENFILM_HOME;
  process.env.OPENFILM_HOME = join(root, 'settings');
  try {
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'aac', join(root, 'assets', 'speech.mp4')], { windowsHide: true });
    await changeSettings(s => { s.keys.doubao = 'fake-test-key'; s.use.asr = 'doubao'; });
    assert.equal((await chooseProvider('asr')).id, 'doubao');
    await runGet(root, 'asr', { src: 'assets/speech.mp4' });
    assert.equal(seen.length, 1);
    const sent = seen[0];
    assert.equal(sent.url, '/recognize/flash');
    assert.equal(sent.headers['x-api-key'], 'fake-test-key');
    assert.equal(sent.headers['x-api-resource-id'], 'volc.bigasr.auc_turbo');
    assert.equal(sent.headers['x-api-sequence'], '-1');
    assert.ok(sent.headers['x-api-request-id']);
    assert.equal(sent.body.request.show_utterances, true);
    assert.equal(sent.body.request.enable_ddc, false);
    const audio = Buffer.from(sent.body.audio.data, 'base64');
    assert.ok(audio.toString('ascii', 0, 3) === 'ID3' || audio[0] === 255);
    const transcript = await readTranscript(root, 'assets/speech.mp4');
    assert.ok(transcript.lines.some(l => l.text.includes('AI native')));
    const vtt = readFileSync(join(root, 'assets', 'speech.vtt'), 'utf8');
    assert.ok(vtt.includes('<00:00:00.800>AI'));
    assert.equal(existsSync(join(root, 'assets', 'asr')), false, 'provider does not write response files');
    await runGet(root, 'asr', { src: 'assets/speech.mp4' });
    assert.equal(seen.length, 1);
    const force = () => runGet(root, 'asr', { src: 'assets/speech.mp4', force: true });
    for (const status of [401, 403, 429, 500]) {
      reply = (_req, res) => res.writeHead(status).end('fake-test-key');
      const count = seen.length;
      await assert.rejects(force(), e => e.message.includes(`HTTP ${status}`) && !e.message.includes('fake-test-key'));
      assert.equal(seen.length, count + 1);
    }
    reply = (_req, res) => res.writeHead(402).end();
    await assert.rejects(force(), /balance/);
    reply = (_req, res) => res.writeHead(302, { location: process.env.OPENFILM_DOUBAO_URL }).end();
    const beforeRedirect = seen.length;
    await assert.rejects(force(), /Request id: [0-9a-f-]+\. Not retried/);
    assert.equal(seen.length, beforeRedirect + 1, 'redirects do not resend credentials');
    reply = (_req, res) => res.writeHead(200, { 'X-Api-Status-Code': '45000001' }).end(JSON.stringify(fixture()));
    await assert.rejects(force(), /did not report recognition success/);
    reply = (req) => req.socket.destroy();
    const count = seen.length;
    await assert.rejects(force(), /Not retried/);
    assert.equal(seen.length, count + 1);
    assert.equal(readFileSync(join(root, 'assets', 'speech.vtt'), 'utf8'), vtt);
    assert.equal(existsSync(join(root, 'assets', 'asr')), false);
  } finally {
    if (oldHome === undefined) delete process.env.OPENFILM_HOME;
    else process.env.OPENFILM_HOME = oldHome;
  }
});

test('a real mixed-language response lands a VTT whose cues contain all timed words', async () => {
  // Sanitized response from the 2026-10-15 live run on synthetic Chinese/English speech with numbers.
  const text = '今天测试 AI native 价格是20元，增长20%，一共有三个视频。';
  const tokens = [
    ['今', 180, 420], ['天', 420, 660], ['测', 660, 900], ['试', 900, 1060],
    ['AI', 1260, 1460], ['native', 1660, 1780], ['价', 2460, 2700], ['格', 2700, 2900],
    ['是', 2900, 3220], ['20', 3220, 3580], ['元', 3580, 3860], ['增', 4220, 4540],
    ['长', 4540, 4780], ['20%', 4820, 5860], ['一', 6220, 6460], ['共', 6460, 6660],
    ['有', 6660, 6900], ['三', 6900, 7100], ['个', 7100, 7340], ['视', 7340, 7580], ['频', 7580, 7860],
  ];
  const body = { audio_info: { duration: 8676 }, result: { text, utterances: [{
    text, start_time: 180, end_time: 7860,
    words: tokens.map(([text, start_time, end_time]) => ({ text, start_time, end_time })),
  }] } };
  const root = mkdtempSync(join(tmpdir(), 'openfilm-doubao-mixed-'));
  mkdirSync(join(root, 'assets'));
  const oldHome = process.env.OPENFILM_HOME, oldReply = reply;
  process.env.OPENFILM_HOME = join(root, 'settings');
  try {
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=9', '-c:a', 'aac', join(root, 'assets', 'speech.mp4')], { windowsHide: true });
    await changeSettings(s => { s.keys.doubao = 'fake-test-key'; s.use.asr = 'doubao'; });
    reply = (_req, res) => res.writeHead(200, { 'Content-Type': 'application/json', 'X-Api-Status-Code': '20000000' }).end(JSON.stringify(body));
    await runGet(root, 'asr', { src: 'assets/speech.mp4' });
    const { lines } = await readTranscript(root, 'assets/speech.mp4');
    assert.equal(lines[0].endMs, 6220, 'the first cue lasts until the next cue, past its last word at 5860 ms');
    assert.equal(lines.flatMap(l => l.marks ?? []).length, tokens.length);
    for (const [, start, end] of tokens) {
      const line = lines.find(l => l.marks?.some(m => m.startMs === start));
      assert.ok(line && line.startMs <= start && line.endMs >= end, `word at ${start}–${end} is contained in its cue`);
    }
    for (const line of lines) assert.ok(line.marks.every(m => m.startMs < line.endMs));
    assert.deepEqual(readdirSync(join(root, 'assets')).sort(), ['speech.mp4', 'speech.vtt']);
  } finally {
    reply = oldReply;
    if (oldHome === undefined) delete process.env.OPENFILM_HOME;
    else process.env.OPENFILM_HOME = oldHome;
  }
});
