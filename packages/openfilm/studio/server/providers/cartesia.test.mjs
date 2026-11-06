import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import cartesia, { scriptLanguage } from './cartesia.mjs';

const KEY = 'sk_car_test_0123456789';
/** A fake Cartesia on 127.0.0.1: `reply` answers each request ([status, body, type]); `seen` keeps them. */
let server;
let reply = () => [404, {}];
const seen = [];

before(async () => {
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const call = { method: req.method, url: new URL(req.url, 'http://x'), headers: req.headers, body: Buffer.concat(chunks) };
    seen.push(call);
    const [status, body, type = 'application/json'] = await reply(call);
    res.writeHead(status, { 'content-type': type }).end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  process.env.OPENFILM_CARTESIA_URL = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const ctx = () => ({ key: KEY, root: '/project', signal: new AbortController().signal, say: () => {}, read: async () => new Uint8Array() });
const stream = (...events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
/* half a second of 16-bit PCM at 44.1 kHz, in two chunks */
const HALF = Buffer.alloc(44100, 2).toString('base64');

test('voice-over: streamed with word times, its PCM joined into a WAV', async () => {
  reply = () => [200, stream(
    { type: 'chunk', done: false, data: HALF, step_time: 10, status_code: 206 },
    { type: 'timestamps', done: false, word_timestamps: { words: ['Hello,'], start: [0.05], end: [0.4] }, status_code: 206 },
    { type: 'chunk', done: false, data: HALF, step_time: 10, status_code: 206 },
    { type: 'timestamps', done: false, word_timestamps: { words: ['world', '.'], start: [0.5, 0.9], end: [0.9, 0.95] }, status_code: 206 },
    { type: 'done', done: true, status_code: 200 },
  ), 'text/event-stream'];
  const result = await cartesia.run('tts', { out: 'intro', text: 'Hello, world.', voice: 'v-1' }, ctx());
  const call = seen.at(-1);
  assert.equal(call.url.pathname, '/tts/sse');
  assert.equal(call.headers.authorization, `Bearer ${KEY}`);
  assert.equal(call.headers['cartesia-version'], '2026-08-14');
  assert.deepEqual(JSON.parse(call.body), {
    model_id: 'sonic-3.6', transcript: 'Hello, world.', voice: { id: 'v-1' },
    output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 44100 }, add_timestamps: true,
  });
  const [file] = result.files;
  assert.equal(file.path, 'assets/audio/vo/intro.wav');
  assert.equal(Buffer.from(file.bytes).toString('ascii', 0, 4), 'RIFF');
  const [row] = result.index;
  assert.equal(row.dur, 1);
  assert.deepEqual(row.words, [{ token: 'Hello,', start: 0.05, end: 0.4 }, { token: 'world.', start: 0.5, end: 0.95 }]);
  assert.equal(result.cost.note, 'billed by Cartesia to your key');
});

test('voice-over: a Chinese, Japanese or Korean line says its language', async () => {
  reply = () => [200, stream({ type: 'chunk', data: HALF }, { type: 'done', done: true }), 'text/event-stream'];
  await cartesia.run('tts', { out: 'zh', text: '你好，世界。', voice: 'v-2' }, ctx());
  assert.equal(JSON.parse(seen.at(-1).body).language, 'zh');
  assert.equal(scriptLanguage('こんにちは、世界'), 'ja');
  assert.equal(scriptLanguage('안녕하세요'), 'ko');
  assert.equal(scriptLanguage('Hola'), null);
});

test('voice-over: an error in the stream is said; out of credits is the balance', async () => {
  reply = () => [200, stream({ type: 'error', done: true, status_code: 400, title: 'Bad voice', message: 'Voice not found' }), 'text/event-stream'];
  await assert.rejects(cartesia.run('tts', { out: 'x', text: 'Hi.', voice: 'nope' }, ctx()), /Cartesia answered 400: Voice not found/);
  reply = () => [200, stream({ type: 'error', done: true, status_code: 402, error_code: 'quota_exceeded', message: 'Out of credits' }), 'text/event-stream'];
  await assert.rejects(cartesia.run('tts', { out: 'x', text: 'Hi.', voice: 'v-1' }, ctx()), (e) => e.code === 'balance');
  reply = () => [402, { error_code: 'quota_exceeded', title: 'Quota exceeded', message: 'No credits left' }];
  await assert.rejects(cartesia.run('tts', { out: 'x', text: 'Hi.', voice: 'v-1' }, ctx()), (e) => e.code === 'balance');
});

test('voices: searched, narrowed by language and gender; nothing found by the prompt shows others', async () => {
  const all = [
    { id: 'a', name: 'Katie', description: 'Friendly American woman', language: 'en', gender: 'feminine' },
    { id: 'b', name: 'Ronald', tagline: 'Deep narrator', language: 'en', gender: 'masculine' },
  ];
  reply = (call) => [200, { data: call.url.searchParams.get('q') === 'pirate' ? [] : all, has_more: false }];
  const found = await cartesia.run('voice', { prompt: 'narrator', language: 'en', gender: 'male', limit: 1 }, ctx());
  const query = seen.at(-1).url.searchParams;
  assert.equal(query.get('q'), 'narrator');
  assert.equal(query.get('language'), 'en');
  assert.equal(query.get('gender'), 'masculine');
  assert.deepEqual(found.receipt.voices, [{ voiceId: 'a', name: 'Katie', language: 'en', gender: 'f', description: 'Friendly American woman' }]);
  const none = await cartesia.run('voice', { prompt: 'pirate' }, ctx());
  assert.equal(none.receipt.voices.length, 2);
  assert.equal(none.receipt.voices[1].description, 'Deep narrator');
  assert.match(none.receipt.notes[0], /no voice matched "pirate"/);
});
