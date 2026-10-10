import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import openai from './openai.mjs';
import { wav } from './common.mjs';

const KEY = 'sk-test-0123456789abcdef';
/** A fake OpenAI on 127.0.0.1: `reply` answers each request; `seen` keeps them. */
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
  process.env.OPENFILM_OPENAI_URL = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const ctx = (files = {}) => ({ key: KEY, root: '/project', signal: new AbortController().signal, say: () => {}, read: async (p) => files[p] });
const form = (call) => new Request('http://x', { method: 'POST', headers: { 'content-type': call.headers['content-type'] }, body: call.body }).formData();

/** The start of a PNG: its signature and header, `w` × `h`, RGBA. */
function png(w, h) {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  b[25] = 6;
  return b;
}

test('a picture: the ratio as pixels, the quality, a transparent background when asked', async () => {
  reply = () => [200, { data: [{ b64_json: png(1536, 864).toString('base64') }] }];
  const result = await openai.run('image', { out: 'hero', prompt: 'a brass key', ratio: '16:9', quality: 'high', transparent: true }, ctx());
  const call = seen.at(-1);
  assert.equal(call.url.pathname, '/v1/images/generations');
  assert.equal(call.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(call.body), { model: 'gpt-image-2.5-flare', prompt: 'a brass key', size: '1536x864', quality: 'high', output_format: 'png', background: 'transparent' });
  assert.equal(result.files[0].path, 'assets/image/hero.png');
  assert.deepEqual(result.index[0], { src: 'assets/image/hero.png', kind: 'image', w: 1536, h: 864, from: { mode: 'generate', prompt: 'a brass key', provider: 'openai', model: 'gpt-image-2.5-flare' } });
  assert.deepEqual(result.receipt.images, [{ src: 'assets/image/hero.png', width: 1536, height: 864, alpha: true }]);
});

test('voice-over: a WAV whose length is known, no word timings (Studio spreads the text)', async () => {
  reply = () => [200, wav(new Uint8Array(24000), 24000)];
  const result = await openai.run('tts', { out: 'line', text: 'Hello.', voice: 'marin' }, ctx());
  assert.deepEqual(JSON.parse(seen.at(-1).body), { model: 'gpt-4o-mini-tts', input: 'Hello.', voice: 'marin', response_format: 'wav' });
  assert.equal(result.index[0].src, 'assets/audio/vo/line.wav');
  assert.equal(result.index[0].dur, 0.5);
  assert.equal(result.index[0].words, undefined);
});

test('transcription: whisper-1 with word timestamps; too big a file is refused before it is sent', async () => {
  reply = () => [200, { text: 'Hi there', language: 'english', duration: 1.25, words: [{ word: 'Hi', start: 0, end: 0.2 }, { word: 'there', start: 0.25, end: 0.6 }] }];
  const mp3 = new Uint8Array(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(100)]));
  const result = await openai.run('asr', { src: 'assets/audio/talk.m4a' }, ctx({ 'assets/audio/talk.m4a': mp3 }));
  const sent = await form(seen.at(-1));
  assert.equal(seen.at(-1).url.pathname, '/v1/audio/transcriptions');
  assert.equal(sent.get('model'), 'whisper-1');
  assert.equal(sent.get('response_format'), 'verbose_json');
  assert.deepEqual(sent.getAll('timestamp_granularities[]'), ['word']);
  assert.equal(sent.get('file').name, 'talk.mp3');
  assert.deepEqual(result.index, [{ src: 'assets/audio/talk.m4a', dur: 1.25, text: 'Hi there', transcribed: true,
    words: [{ token: 'Hi', start: 0, end: 0.2 }, { token: 'there', start: 0.25, end: 0.6 }] }]);
  const before = seen.length;
  await assert.rejects(openai.run('asr', { src: 'big.wav' }, ctx({ 'big.wav': new Uint8Array(26 * 1024 * 1024) })), /up to 25 MB/);
  assert.equal(seen.length, before);
});

test('translation: one request with a strict JSON schema, one line back per line', async () => {
  const answer = (lines) => [200, { output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ lines }) }] }] }];
  reply = () => answer(['Hola.', 'Adiós.']);
  const result = await openai.run('translate', { lines: ['Hello.', 'Goodbye.'], language: 'es', times: [{ startSec: 0, endSec: 1 }, { startSec: 1, endSec: 2 }] }, ctx());
  const sent = JSON.parse(seen.at(-1).body);
  assert.equal(seen.at(-1).url.pathname, '/v1/responses');
  assert.equal(sent.model, 'gpt-6-luna');
  assert.equal(sent.text.format.type, 'json_schema');
  assert.equal(sent.text.format.strict, true);
  assert.deepEqual(JSON.parse(sent.input), { language: 'es', lines: ['Hello.', 'Goodbye.'] });
  assert.deepEqual(result.receipt.lines, ['Hola.', 'Adiós.']);
  reply = () => answer(['Hola.']);
  await assert.rejects(openai.run('translate', { lines: ['Hello.', 'Goodbye.'], language: 'es' }, ctx()), /1 lines for 2/);
});

test('voices: its built-in ones, the filters it cannot apply said', async () => {
  const result = await openai.run('voice', { gender: 'f', limit: 3 }, ctx());
  assert.deepEqual(result.receipt.voices.map((v) => v.voiceId), ['marin', 'cedar', 'alloy']);
  assert.match(result.receipt.notes[0], /--gender/);
});
