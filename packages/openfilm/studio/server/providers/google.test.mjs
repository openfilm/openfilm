import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import google from './google.mjs';

const KEY = 'AIza-test-0123456789';
/** A fake Gemini API on 127.0.0.1: `reply` answers each request; `seen` keeps them. */
let server, base;
let reply = () => [404, {}];
const seen = [];

before(async () => {
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const call = { method: req.method, url: new URL(req.url, 'http://x'), headers: req.headers, body: Buffer.concat(chunks) };
    seen.push(call);
    const [status, body, headers = {}] = await reply(call);
    if (Buffer.isBuffer(body)) res.writeHead(status, { 'content-type': 'video/mp4', ...headers }).end(body);
    else res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.OPENFILM_GOOGLE_URL = base;
});
after(() => server.close());

const ctx = (files = {}, signal = new AbortController().signal) => ({ key: KEY, root: '/project', signal, say: () => {}, read: async (p) => files[p] });
const inline = (mimeType, data) => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType, data: Buffer.from(data).toString('base64') } }] } }] });

test('voice-over: the raw PCM wrapped as a WAV, its length from the samples', async () => {
  reply = () => [200, inline('audio/L16;codec=pcm;rate=24000', Buffer.alloc(48000))];
  const result = await google.run('tts', { out: 'line', text: 'Hello.', voice: 'Kore' }, ctx());
  const call = seen.at(-1);
  assert.equal(call.url.pathname, '/v1beta/models/gemini-3.8-flash-tts:generateContent');
  assert.equal(call.headers['x-goog-api-key'], KEY);
  assert.deepEqual(JSON.parse(call.body).generationConfig, { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } });
  assert.equal(result.files[0].path, 'assets/audio/vo/line.wav');
  assert.equal(Buffer.from(result.files[0].bytes).toString('ascii', 0, 4), 'RIFF');
  assert.equal(result.index[0].dur, 1);
});

test('transcription: speech is uploaded, word timestamps returned, and the temporary file deleted', async () => {
  reply = (call) => {
    if (call.url.pathname === '/upload/v1beta/files') {
      return [200, {}, { 'x-goog-upload-url': `${base}/upload/session-1` }];
    }
    if (call.url.pathname === '/upload/session-1') {
      assert.equal(call.headers['x-goog-upload-command'], 'upload, finalize');
      assert.equal(call.headers['content-type'], 'audio/mpeg');
      return [200, { file: { name: 'files/audio-1', uri: `${base}/v1beta/files/audio-1`, mimeType: 'audio/mpeg' } }];
    }
    if (call.url.pathname === '/v1beta/interactions') {
      return [200, { status: 'completed', steps: [{ type: 'model_output', content: [{
        type: 'text', text: 'Hello world.', annotations: [
          { type: 'word_info', text: 'Hello', start_offset: '0.100s', end_offset: '0.450s' },
          { type: 'word_info', text: 'world.', start_offset: '0.500s', end_offset: '0.850s' },
        ],
      }] }] }];
    }
    if (call.method === 'DELETE' && call.url.pathname === '/v1beta/files/audio-1') return [200, {}];
    return [404, {}];
  };
  const mp3 = new Uint8Array(Buffer.from('ID3 speech bytes'));
  const result = await google.run('asr', { src: 'assets/interview.mp3' }, ctx({ 'assets/interview.mp3': mp3 }));
  const interaction = seen.findLast((call) => call.url.pathname === '/v1beta/interactions');
  const sent = JSON.parse(interaction.body);
  assert.equal(sent.model, 'gemini-3.5-transcribe');
  assert.deepEqual(sent.generation_config.transcription_config.mode, { type: 'verbatim', timestamp_granularities: ['word'] });
  assert.deepEqual(result.index, [{ src: 'assets/interview.mp3', text: 'Hello world.', words: [
    { token: 'Hello', start: 0.1, end: 0.45 }, { token: 'world.', start: 0.5, end: 0.85 },
  ], transcribed: true }]);
  assert.ok(seen.some((call) => call.method === 'DELETE' && call.url.pathname === '/v1beta/files/audio-1'));
});

test('a picture: the ratio and size asked, the extension from what came back, transparency noted', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x02, 0xd0, 0x05, 0x00, 3, 0, 0, 0, 0]);
  reply = () => [200, inline('image/jpeg', jpeg)];
  const result = await google.run('image', { out: 'hero', prompt: 'a key', ratio: '16:9', quality: 'high', transparent: true }, ctx());
  assert.deepEqual(JSON.parse(seen.at(-1).body).generationConfig, { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '2K' } });
  assert.equal(result.files[0].path, 'assets/image/hero.jpg');
  assert.equal(result.index[0].w, 1280);
  assert.match(result.receipt.notes[0], /--transparent/);
  reply = () => [200, { promptFeedback: { blockReason: 'SAFETY' } }];
  await assert.rejects(google.run('image', { out: 'x', prompt: 'y' }, ctx()), /no image \(SAFETY\)/);
});

/** An MP4 that is just its movie header: `seconds` long, at 1000 ticks a second. */
function mp4(seconds) {
  const box = Buffer.alloc(108);
  box.writeUInt32BE(108, 0);
  box.write('mvhd', 4, 'ascii');
  box.writeUInt32BE(1000, 20);
  box.writeUInt32BE(seconds * 1000, 24);
  return box;
}
/** A completed interaction with one video made. */
const made = (bytes) => ({ id: 'v1_1', status: 'completed', steps: [
  { type: 'user_input', content: [{ type: 'text', text: 'ignored' }] },
  { type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data: Buffer.from(bytes).toString('base64') }] },
] });
/** A PNG header `w` × `h`. */
function png(w, h) {
  const bytes = Buffer.alloc(33);
  bytes.writeUInt32BE(0x89504e47, 0);
  bytes.writeUInt32BE(w, 16);
  bytes.writeUInt32BE(h, 20);
  return new Uint8Array(bytes);
}

test('a video: Gemini Omni asked through an interaction, its length read from the clip', async () => {
  const clip = mp4(6);
  reply = (call) => call.url.pathname === '/v1beta/interactions' ? [200, made(clip)] : [404, {}];
  const result = await google.run('video', { out: 'shot', prompt: 'a slow push in', duration: 5, 'first-frame': 'assets/image/first.png' }, ctx({ 'assets/image/first.png': png(720, 1280) }));
  const call = seen.at(-1);
  assert.equal(call.headers['x-goog-api-key'], KEY);
  const sent = JSON.parse(call.body);
  assert.equal(sent.model, 'gemini-omni-1.1-flash');
  assert.equal(sent.store, false);
  /* a tall first frame makes a tall clip */
  assert.deepEqual(sent.response_format, { type: 'video', aspect_ratio: '9:16', resolution: '720p' });
  assert.equal(sent.input.length, 2);
  assert.equal(sent.input[0].type, 'image');
  assert.equal(sent.input[0].mime_type, 'image/png');
  assert.equal(sent.input[1].text, '[# Sources <FIRST_FRAME>@Image1] a slow push in');
  assert.equal(result.files[0].path, 'assets/video/shot.mp4');
  assert.deepEqual(Buffer.from(result.files[0].bytes), clip);
  assert.deepEqual({ ...result.index[0], from: undefined }, { src: 'assets/video/shot.mp4', kind: 'video', w: 720, h: 1280, dur: 6, hasAudio: true, from: undefined });
  assert.equal(result.index[0].from.prompt, 'a slow push in');
  assert.match(result.receipt.notes[0], /--duration: Gemini Omni sets the length/);
});

test('a video\'s first and last frames and references are tagged in order; a last frame alone is left out', async () => {
  reply = () => [200, made(mp4(4))];
  const files = { 'a.png': png(1280, 720), 'b.png': png(1280, 720), 'c.jpg': png(10, 10), 'd.jpg': png(10, 10) };
  await google.run('video', { out: 'x', prompt: 'y', 'first-frame': 'a.png', 'last-frame': 'b.png', 'input-reference': ['c.jpg', 'd.jpg'], 'aspect-ratio': '4:3' }, ctx(files));
  let sent = JSON.parse(seen.at(-1).body);
  assert.equal(sent.input.length, 5);
  assert.deepEqual(sent.input.slice(0, 4).map((part) => part.mime_type), ['image/png', 'image/png', 'image/jpeg', 'image/jpeg']);
  assert.equal(sent.input[4].text, '[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image2] [# References <IMAGE_REF_0>@Image3 <IMAGE_REF_1>@Image4] y');
  assert.equal(sent.response_format.aspect_ratio, '16:9');

  const result = await google.run('video', { out: 'x', prompt: 'y', 'last-frame': 'b.png', 'input-reference': 'c.jpg' }, ctx(files));
  sent = JSON.parse(seen.at(-1).body);
  assert.equal(sent.input.length, 2);
  assert.equal(sent.input[1].text, '[# References <IMAGE_REF_0>@Image1] y');
  assert.match(result.receipt.notes[0], /--last-frame/);
  assert.equal(result.index[0].from.lastFrame, undefined);
});

test('a video that is not made says why; a cancelled run stops waiting', async () => {
  reply = () => [200, { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'I can\'t make that.' }] }] }];
  await assert.rejects(google.run('video', { out: 'x', prompt: 'y' }, ctx()), /Gemini Omni made no clip: I can't make that\./);
  reply = () => [400, { error: { code: 400, message: 'prompt was blocked' } }];
  await assert.rejects(google.run('video', { out: 'x', prompt: 'y' }, ctx()), /Google answered 400: prompt was blocked/);
  reply = () => new Promise(() => {});
  const stop = new AbortController();
  const run = google.run('video', { out: 'x', prompt: 'y' }, ctx({}, stop.signal));
  await new Promise((done) => setTimeout(done, 20));
  stop.abort();
  await assert.rejects(run, { name: 'AbortError' });
});

test('translation: JSON asked for, the lines back in order', async () => {
  reply = () => [200, { candidates: [{ content: { parts: [{ text: '{"lines": ["Bonjour.", "Au revoir."]}' }] } }] }];
  const result = await google.run('translate', { lines: ['Hello.', 'Goodbye.'], language: 'fr' }, ctx());
  const sent = JSON.parse(seen.at(-1).body);
  assert.equal(seen.at(-1).url.pathname, '/v1beta/models/gemini-3.8-flash:generateContent');
  assert.equal(sent.generationConfig.responseMimeType, 'application/json');
  assert.match(sent.systemInstruction.parts[0].text, /exactly 2 strings/);
  assert.deepEqual(result.receipt.lines, ['Bonjour.', 'Au revoir.']);
});
