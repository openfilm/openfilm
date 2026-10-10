import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import groq from './groq.mjs';
import { wav } from './common.mjs';

const KEY = 'gsk_test_0123456789abcdef';
/** A fake Groq on 127.0.0.1: `reply` answers each request; `seen` keeps them. */
let server;
let reply = () => [404, {}];
const seen = [];

before(async () => {
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const call = { method: req.method, url: new URL(req.url, 'http://x'), headers: req.headers, body: Buffer.concat(chunks) };
    seen.push(call);
    const [status, body] = await reply(call);
    if (body instanceof Uint8Array) res.writeHead(status, { 'content-type': 'audio/wav' }).end(body);
    else res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  process.env.OPENFILM_GROQ_URL = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const ctx = (files = {}, model) => ({ key: KEY, model, root: '/project', signal: new AbortController().signal, say: () => {}, read: async (p) => files[p] });
const form = (call) => new Request('http://x', { method: 'POST', headers: { 'content-type': call.headers['content-type'] }, body: call.body }).formData();

test('transcription: Whisper Large v3 Turbo with word timestamps, under /openai/v1', async () => {
  reply = () => [200, { text: 'Hi there', language: 'English', duration: 1.25, words: [{ word: 'Hi', start: 0, end: 0.2 }, { word: 'there', start: 0.25, end: 0.6 }] }];
  const mp3 = new Uint8Array(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(100)]));
  const result = await groq.run('asr', { src: 'assets/audio/talk.m4a' }, ctx({ 'assets/audio/talk.m4a': mp3 }));
  const call = seen.at(-1);
  const sent = await form(call);
  assert.equal(call.url.pathname, '/openai/v1/audio/transcriptions');
  assert.equal(call.headers.authorization, `Bearer ${KEY}`);
  assert.equal(sent.get('model'), 'whisper-large-v3-turbo');
  assert.equal(sent.get('response_format'), 'verbose_json');
  assert.deepEqual(sent.getAll('timestamp_granularities[]'), ['word']);
  assert.equal(sent.get('file').name, 'talk.mp3');
  assert.deepEqual(result.index, [{ src: 'assets/audio/talk.m4a', dur: 1.25, text: 'Hi there', transcribed: true,
    words: [{ token: 'Hi', start: 0, end: 0.2 }, { token: 'there', start: 0.25, end: 0.6 }] }]);
});

test('voice-over: Orpheus as WAV, its length from the file; a line too long for it is refused before it is sent', async () => {
  reply = () => [200, wav(new Uint8Array(48000), 24000)];
  const result = await groq.run('tts', { out: 'line', text: '[cheerful] Hello.', voice: 'hannah' }, ctx());
  assert.equal(seen.at(-1).url.pathname, '/openai/v1/audio/speech');
  assert.deepEqual(JSON.parse(seen.at(-1).body), { model: 'canopylabs/orpheus-v1-english', input: '[cheerful] Hello.', voice: 'hannah', response_format: 'wav' });
  assert.equal(result.files[0].path, 'assets/audio/vo/line.wav');
  assert.equal(result.index[0].dur, 1);
  const before = seen.length;
  await assert.rejects(groq.run('tts', { out: 'x', text: 'a'.repeat(201), voice: 'troy' }, ctx()), /200 characters at a time/);
  assert.equal(seen.length, before);
});

test('voices: the chosen model\'s, by gender; another language is said', async () => {
  const english = await groq.run('voice', { gender: 'm', language: 'es' }, ctx());
  assert.deepEqual(english.receipt.voices.map((v) => v.voiceId), ['austin', 'daniel', 'troy']);
  assert.equal(english.receipt.notes.length, 1);
  const arabic = await groq.run('voice', { language: 'ar', limit: 2 }, ctx({}, 'canopylabs/orpheus-arabic-saudi'));
  assert.deepEqual(arabic.receipt.voices.map((v) => [v.voiceId, v.language]), [['abdullah', 'ar'], ['fahad', 'ar']]);
  assert.equal(arabic.receipt.notes, undefined);
});
