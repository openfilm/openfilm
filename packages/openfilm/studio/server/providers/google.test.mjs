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
    const [status, body, headers = {}] = await reply(call);
    if (Buffer.isBuffer(body)) res.writeHead(status, { 'content-type': 'video/mp4', ...headers }).end(body);
    else res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body));
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

/** A small MP4 that says it plays `seconds`: a file type, then the movie header. */
const mp4 = (seconds) => {
  const mvhd = Buffer.alloc(108);
  mvhd.writeUInt32BE(108, 0);
  mvhd.write('mvhd', 4, 'ascii');
  mvhd.writeUInt32BE(1000, 20);
  mvhd.writeUInt32BE(seconds * 1000, 24);
  const moov = Buffer.alloc(8);
  moov.writeUInt32BE(8 + mvhd.length, 0);
  moov.write('moov', 4, 'ascii');
  return Buffer.concat([Buffer.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), moov, mvhd]);
};
/** A finished interaction with what the model answered. */
const done = (...content) => ({ id: 'v1_clip', status: 'completed', steps: [{ type: 'user_input', content: [] }, { type: 'model_output', content }] });
const isStart = (call) => call.method === 'POST' && call.url.pathname === '/v1beta/interactions';

test('a video: pictures named in the prompt, run in the background and asked after until done, its length from the file', async () => {
  let asks = 0, deleted = 0;
  reply = (call) => {
    if (isStart(call)) return [200, { id: 'v1_clip', status: 'in_progress' }];
    if (call.url.pathname !== '/v1beta/interactions/v1_clip') return [404, {}];
    if (call.method === 'DELETE') { deleted += 1; return [200, {}]; }
    asks += 1;
    return [200, asks < 3 ? { id: 'v1_clip', status: 'in_progress' } : done({ type: 'video', mime_type: 'video/mp4', data: mp4(8).toString('base64') })];
  };
  const first = Buffer.alloc(33);
  first.writeUInt32BE(0x89504e47, 0);
  first.writeUInt32BE(720, 16);
  first.writeUInt32BE(1280, 20);
  const files = { 'assets/image/first.png': new Uint8Array(first), 'assets/image/last.jpg': new Uint8Array(4), 'assets/image/cat.webp': new Uint8Array(4) };
  const result = await google.run('video', { out: 'shot', prompt: 'a slow push in', duration: 5, 'first-frame': 'assets/image/first.png',
    'last-frame': 'assets/image/last.jpg', 'input-reference': 'assets/image/cat.webp' }, ctx(files));
  const started = JSON.parse(seen.findLast(isStart).body);
  assert.equal(started.model, 'gemini-omni-1.1-flash');
  assert.equal(started.background, true);
  /* a tall first frame makes a tall clip */
  assert.deepEqual(started.response_format, { type: 'video', aspect_ratio: '9:16', resolution: '720p' });
  assert.deepEqual(started.input.map((part) => part.mime_type ?? part.type), ['image/png', 'image/jpeg', 'image/webp', 'text']);
  assert.equal(started.input[3].text, '[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image2] [# References <IMAGE_REF_0>@Image3] a slow push in');
  assert.equal(asks, 3);
  assert.equal(deleted, 1);
  assert.equal(result.files[0].path, 'assets/video/shot.mp4');
  assert.deepEqual(Buffer.from(result.files[0].bytes), mp4(8));
  assert.deepEqual({ ...result.index[0], from: undefined }, { src: 'assets/video/shot.mp4', kind: 'video', w: 720, h: 1280, dur: 8, hasAudio: true, from: undefined });
  assert.match(result.receipt.notes[0], /length from the prompt .*this one is 8 s/);
});

test('a video with only a last frame takes it as a reference; a clip as long as asked says nothing of its length', async () => {
  reply = (call) => isStart(call) ? [200, done({ type: 'video', data: mp4(5).toString('base64') })] : [200, {}];
  const result = await google.run('video', { out: 'x', prompt: 'y', duration: 5, 'last-frame': 'assets/image/last.png' }, ctx({ 'assets/image/last.png': new Uint8Array(4) }));
  const started = JSON.parse(seen.findLast(isStart).body);
  assert.equal(started.input.at(-1).text, '[# References <IMAGE_REF_0>@Image1] y');
  assert.deepEqual(result.receipt.notes, ['--last-frame: Gemini Omni Flash ends on a picture only after a first frame: it was a reference']);
});

test('a video that fails or is blocked says why; a cancelled run stops asking and cancels the interaction', async () => {
  reply = (call) => isStart(call) ? [200, { id: 'v1_a', status: 'in_progress' }] : [200, { id: 'v1_a', status: 'failed', error: { message: 'prompt was blocked' } }];
  await assert.rejects(google.run('video', { out: 'x', prompt: 'y' }, ctx()), /could not make the clip: prompt was blocked/);
  reply = (call) => isStart(call) ? [200, done({ type: 'text', text: 'I can not make that.' })] : [200, {}];
  await assert.rejects(google.run('video', { out: 'x', prompt: 'y' }, ctx()), /made no clip: I can not make that\./);

  let asks = 0, cancelled = 0;
  reply = (call) => {
    if (isStart(call)) return [200, { id: 'v1_b', status: 'in_progress' }];
    if (call.url.pathname === '/v1beta/interactions/v1_b/cancel') { cancelled += 1; return [200, {}]; }
    asks += 1;
    return [200, { id: 'v1_b', status: 'in_progress' }];
  };
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
  assert.equal(cancelled, 1);
  assert.equal(seen.filter((c) => c.method === 'POST' && c.url.pathname.endsWith('/cancel')).at(-1).headers['x-goog-api-key'], KEY);
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

test('a video\'s address elsewhere is not downloaded with the key; its own is', async () => {
  const elsewhere = base.replace('127.0.0.1', 'localhost');
  let keyed = 0;
  reply = (call) => {
    if (call.headers.host.startsWith('localhost') && call.headers['x-goog-api-key']) keyed += 1;
    if (isStart(call)) return [200, done({ type: 'video', uri: `${elsewhere}/v1beta/files/clip:download?alt=media` })];
    return [200, mp4(4)];
  };
  await assert.rejects(google.run('video', { out: 'x', prompt: 'y' }, ctx()), /not its own; your key was not sent there/);
  assert.equal(keyed, 0);

  reply = (call) => {
    if (isStart(call)) return [200, done({ type: 'video', uri: `${base}/v1beta/files/clip:download?alt=media` })];
    if (call.url.pathname === '/v1beta/files/clip:download') return [call.headers['x-goog-api-key'] === KEY ? 200 : 403, mp4(4)];
    return [200, {}];
  };
  const result = await google.run('video', { out: 'x', prompt: 'y' }, ctx());
  assert.equal(result.index[0].dur, 4);
});
