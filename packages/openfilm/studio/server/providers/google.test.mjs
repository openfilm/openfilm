import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import google, { polling } from './google.mjs';

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
    const [status, body] = await reply(call);
    if (Buffer.isBuffer(body)) res.writeHead(status, { 'content-type': 'video/mp4' }).end(body);
    else res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.OPENFILM_GOOGLE_URL = base;
  polling.ms = 5;
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

test('a video: started, asked after until done, downloaded with the key; the length Veo makes', async () => {
  let asks = 0;
  reply = (call) => {
    if (call.url.pathname.endsWith(':predictLongRunning')) return [200, { name: 'models/veo-3.1-generate-preview/operations/op1' }];
    if (call.url.pathname === '/v1beta/models/veo-3.1-generate-preview/operations/op1') {
      asks += 1;
      return [200, asks < 3 ? { name: 'op1', done: false } : { name: 'op1', done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `${base}/files/clip.mp4?alt=media` } }] } } }];
    }
    if (call.url.pathname === '/files/clip.mp4') return [call.headers['x-goog-api-key'] === KEY ? 200 : 403, Buffer.from('mp4 bytes')];
    return [404, {}];
  };
  const first = Buffer.alloc(33);
  first.writeUInt32BE(0x89504e47, 0);
  first.writeUInt32BE(720, 16);
  first.writeUInt32BE(1280, 20);
  const result = await google.run('video', { out: 'shot', prompt: 'a slow push in', duration: 5, 'first-frame': 'assets/image/first.png' }, ctx({ 'assets/image/first.png': new Uint8Array(first) }));
  const started = JSON.parse(seen.find((c) => c.url.pathname.endsWith(':predictLongRunning')).body);
  assert.equal(started.instances[0].prompt, 'a slow push in');
  assert.equal(started.instances[0].image.inlineData.mimeType, 'image/png');
  /* a tall first frame makes a tall clip; 5 s becomes 6, the nearest Veo makes */
  assert.deepEqual(started.parameters, { aspectRatio: '9:16', durationSeconds: 6 });
  assert.equal(asks, 3);
  assert.equal(result.files[0].path, 'assets/video/shot.mp4');
  assert.equal(Buffer.from(result.files[0].bytes).toString(), 'mp4 bytes');
  assert.deepEqual({ ...result.index[0], from: undefined }, { src: 'assets/video/shot.mp4', kind: 'video', w: 720, h: 1280, dur: 6, hasAudio: true, from: undefined });
  assert.match(result.receipt.notes[0], /4, 6 or 8 second/);
});

test('a video that fails says why; a cancelled run stops asking', async () => {
  reply = (call) => call.url.pathname.endsWith(':predictLongRunning') ? [200, { name: 'operations/op2' }] : [200, { done: true, error: { code: 3, message: 'prompt was blocked' } }];
  await assert.rejects(google.run('video', { out: 'x', prompt: 'y' }, ctx()), /Veo could not make the clip: prompt was blocked/);
  let asks = 0;
  reply = (call) => { if (!call.url.pathname.endsWith(':predictLongRunning')) asks += 1; return [200, call.url.pathname.endsWith(':predictLongRunning') ? { name: 'operations/op3' } : { done: false }]; };
  const stop = new AbortController();
  const run = google.run('video', { out: 'x', prompt: 'y' }, ctx({}, stop.signal));
  await new Promise((done) => setTimeout(done, 40));
  stop.abort();
  await assert.rejects(run);
  /* a poll sent just before the stop may still arrive; none may start after it */
  await new Promise((done) => setTimeout(done, 20));
  const after = asks;
  await new Promise((done) => setTimeout(done, 60));
  assert.equal(asks, after);
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

test('a video\'s address elsewhere is not downloaded with the key', async () => {
  const elsewhere = base.replace('127.0.0.1', 'localhost');
  let keyed = 0;
  reply = (call) => {
    if (call.headers.host.startsWith('localhost') && call.headers['x-goog-api-key']) keyed += 1;
    if (call.url.pathname.endsWith(':predictLongRunning')) return [200, { name: 'models/veo-3.1-generate-preview/operations/op2', done: true,
      response: { generateVideoResponse: { generatedSamples: [{ video: { uri: `${elsewhere}/files/clip.mp4` } }] } } }];
    return [200, Buffer.from('mp4 bytes')];
  };
  await assert.rejects(google.run('video', { out: 'x', prompt: 'y' }, ctx()), /not its own; your key was not sent there/);
  assert.equal(keyed, 0);
});
