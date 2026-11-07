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

test('pictures with GPT Image 2.6 Flare, the default, and Sunburst, and 2.5 Flare and Sunburst: what OpenFilm\'s service runs too', () => {
  assert.deepEqual(openai.models.image.map((m) => m.id), ['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']);
});

test('a picture: the ratio as pixels, the quality, a transparent background when asked', async () => {
  reply = () => [200, { data: [{ b64_json: png(1536, 864).toString('base64') }] }];
  const result = await openai.run('image', { out: 'hero', prompt: 'a brass key', ratio: '16:9', quality: 'high', transparent: true }, ctx());
  const call = seen.at(-1);
  assert.equal(call.url.pathname, '/v1/images/generations');
  assert.equal(call.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(call.body), { model: 'gpt-image-2.6-flare', prompt: 'a brass key', size: '1536x864', quality: 'high', output_format: 'png', background: 'transparent' });
  assert.equal(result.files[0].path, 'assets/image/hero.png');
  assert.deepEqual(result.index[0], { src: 'assets/image/hero.png', kind: 'image', w: 1536, h: 864, from: { mode: 'generate', prompt: 'a brass key', provider: 'openai', model: 'gpt-image-2.6-flare' } });
  assert.deepEqual(result.receipt.images, [{ src: 'assets/image/hero.png', width: 1536, height: 864, alpha: true }]);
});

test('GPT Image 2.6, the default: every quality, 2K and 4K in the shape asked, and what it cost by the tokens it was billed', async () => {
  reply = () => [200, { data: [{ b64_json: png(2720, 1536).toString('base64') }], usage: { input_tokens: 20, input_tokens_details: { text_tokens: 20, image_tokens: 0 }, output_tokens: 3122 } }];
  const result = await openai.run('image', { out: 'wide', prompt: 'a harbor', ratio: '16:9', quality: 'xhigh', size: '2k' }, ctx());
  assert.deepEqual(JSON.parse(seen.at(-1).body), { model: 'gpt-image-2.6-flare', prompt: 'a harbor', size: '2720x1536', quality: 'xhigh', output_format: 'png' });
  assert.equal(result.receipt.quality, 'xhigh');
  assert.equal(result.receipt.usd, 0.09376, '20 text tokens at $5/M and 3,122 picture tokens at $30/M');
  await openai.run('image', { out: 'big', prompt: 'a harbor', ratio: '16:9', size: '4k' }, ctx());
  assert.deepEqual(JSON.parse(seen.at(-1).body).size, '3840x2160');
  assert.equal(JSON.parse(seen.at(-1).body).quality, 'low', 'low unless asked');
  /* GPT Image 2.5 Flare, kept for cheaper drafts: the same qualities, billed the same way */
  const older = await openai.run('image', { out: 'old', prompt: 'a harbor', quality: 'max' }, { ...ctx(), model: 'gpt-image-2.5-flare' });
  assert.deepEqual([JSON.parse(seen.at(-1).body).model, JSON.parse(seen.at(-1).body).quality], ['gpt-image-2.5-flare', 'max']);
  assert.equal(older.receipt.usd, 0.09376);
  /* a model it no longer has (GPT Image 2, chosen before): its first */
  await openai.run('image', { out: 'old', prompt: 'a harbor' }, { ...ctx(), model: 'gpt-image-2' });
  assert.equal(JSON.parse(seen.at(-1).body).model, 'gpt-image-2.6-flare');
});

test('pictures given (--ref) make a new one at the edits endpoint; a mask redraws the first where it is transparent', async () => {
  reply = () => [200, { data: [{ b64_json: png(1024, 1024).toString('base64') }] }];
  const files = { 'assets/image/room.png': png(1024, 1024), 'assets/image/lamp.jpg': Buffer.from('jpeg'), 'assets/image/hole.png': png(1024, 1024) };
  await openai.run('image', { out: 'lit', prompt: 'put the lamp on the table', ratio: '1:1', ref: ['assets/image/room.png', 'assets/image/lamp.jpg'], mask: 'assets/image/hole.png' }, { ...ctx(files), model: 'gpt-image-2.6-sunburst' });
  const call = seen.at(-1);
  assert.equal(call.url.pathname, '/v1/images/edits');
  const sent = await form(call);
  assert.deepEqual([sent.get('model'), sent.get('size'), sent.get('quality')], ['gpt-image-2.6-sunburst', '1024x1024', 'low']);
  assert.deepEqual(sent.getAll('image[]').map((f) => [f.name, f.type]), [['room.png', 'image/png'], ['lamp.jpg', 'image/jpeg']]);
  assert.equal(sent.get('mask').name, 'hole.png');
  await assert.rejects(openai.run('image', { prompt: 'x', mask: 'assets/image/hole.png' }, ctx(files)), /--mask goes with the picture it redraws/);
  await assert.rejects(openai.run('image', { prompt: 'x', ref: Array.from({ length: 17 }, () => 'assets/image/room.png') }, ctx(files)), /at most 16/);
});

test('markup: a transparent PNG drawn on, the size of the first picture, says what of it to change', async () => {
  reply = () => [200, { data: [{ b64_json: png(1024, 1024).toString('base64') }] }];
  const files = { 'assets/image/room.png': png(1024, 1024), 'assets/image/circled.png': png(1024, 1024) };
  await openai.run('image', { out: 'fixed', prompt: 'make what is circled a lamp', ratio: '1:1', ref: ['assets/image/room.png'], markup: 'assets/image/circled.png' }, ctx(files));
  const sent = await form(seen.at(-1));
  assert.equal(seen.at(-1).url.pathname, '/v1/images/edits');
  assert.deepEqual([sent.get('markup').name, sent.get('mask')], ['circled.png', null]);
  await assert.rejects(openai.run('image', { prompt: 'x', markup: 'assets/image/circled.png' }, ctx(files)), /--markup goes with the picture it redraws/);
  await assert.rejects(openai.run('image', { prompt: 'x', ref: ['assets/image/room.png'], mask: 'assets/image/circled.png', markup: 'assets/image/circled.png' }, ctx(files)), /not both/);
});

/** The start of a GIF, `w` × `h`. */
const gif = (w, h) => { const b = Buffer.alloc(13); b.write('GIF89a'); b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b; };

test('a GIF: its frames and their length, the largest frame its sheet of frames allows, said how long one round lasts', async () => {
  reply = () => [200, { data: [{ b64_json: gif(1328, 752).toString('base64') }], output_format: 'gif', usage: { input_tokens: 40, input_tokens_details: { text_tokens: 40, image_tokens: 0 }, output_tokens: 555 } }];
  const result = await openai.run('image', { out: 'spin', prompt: 'a star spinning', ratio: '16:9', format: 'gif', frames: 8, 'frame-ms': 120 }, ctx());
  assert.deepEqual(JSON.parse(seen.at(-1).body), { model: 'gpt-image-2.6-flare', prompt: 'a star spinning', size: '1328x752', quality: 'low', output_format: 'gif', frame_count: 8, frame_duration_ms: 120 });
  assert.equal(result.files[0].path, 'assets/image/spin.gif');
  assert.deepEqual(result.receipt.images, [{ src: 'assets/image/spin.gif', width: 1328, height: 752, alpha: false }]);
  assert.deepEqual([result.receipt.frames, result.receipt.frameMs, result.receipt.loop], [8, 120, 0.96]);
  /* sixteen frames: four by four, each at most 720 square; nine of a 16:9 frame fill 3840 × 2160 */
  await openai.run('image', { out: 'grid', prompt: 'x', ratio: '1:1', format: 'gif', frames: 16 }, ctx());
  assert.equal(JSON.parse(seen.at(-1).body).size, '720x720');
  await openai.run('image', { out: 'nine', prompt: 'x', ratio: '16:9', format: 'gif' }, ctx());
  assert.deepEqual([JSON.parse(seen.at(-1).body).size, JSON.parse(seen.at(-1).body).frame_count, JSON.parse(seen.at(-1).body).frame_duration_ms], ['1280x720', 9, 200]);
  /* GPT Image 2.5 Flare makes PNGs: the first that makes GIFs made it, said */
  const other = await openai.run('image', { out: 'spin', prompt: 'x', format: 'gif' }, { ...ctx(), model: 'gpt-image-2.5-flare' });
  assert.equal(JSON.parse(seen.at(-1).body).model, 'gpt-image-2.6-flare');
  assert.match(other.receipt.notes.join(' '), /--format gif: GPT Image 2.5 Flare makes PNGs, so GPT Image 2.6 Flare made it/);
  await assert.rejects(openai.run('image', { prompt: 'x', format: 'gif', ref: ['a.png'], mask: 'b.png' }, ctx({ 'a.png': png(8, 8), 'b.png': png(8, 8) })), /made without a mask/);
});

test('an SVG: made from the prompt alone, written by a text model, the cost of both worked out', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path d="M0 0h10v10z"/></svg>');
  reply = () => [200, { data: [{ b64_json: svg.toString('base64') }], output_format: 'svg',
    usage: { input_tokens: 88, input_tokens_details: { text_tokens: 88, image_tokens: 0 }, output_tokens: 824 },
    svg_usage: { model: 'gpt-6-luna', input_tokens: 1560, output_tokens: 4067, reasoning_tokens: 759, total_tokens: 5627 } }];
  const result = await openai.run('image', { out: 'logo', prompt: 'a film strip as the letter O', ratio: '1:1', format: 'svg' }, ctx());
  assert.deepEqual(JSON.parse(seen.at(-1).body), { model: 'gpt-image-2.6-flare', prompt: 'a film strip as the letter O', size: '1024x1024', quality: 'low', output_format: 'svg', n: 1, svg: { model: 'gpt-6-luna', reasoning: { effort: 'low' } } });
  assert.equal(result.files[0].path, 'assets/image/logo.svg');
  assert.deepEqual(result.index[0].w, 1024);
  assert.equal(result.receipt.usd, 0.02735, 'the picture\'s tokens, and the writing\'s at GPT-6 Luna\'s rates');
  await assert.rejects(openai.run('image', { prompt: 'x', format: 'svg', ref: ['a.png'] }, ctx({ 'a.png': png(8, 8) })), /from the prompt alone/);
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
