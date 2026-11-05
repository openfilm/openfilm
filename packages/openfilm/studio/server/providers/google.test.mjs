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

test('a video: asked through the Interactions API, its file asked after until ready, downloaded with the key', async () => {
  let asks = 0;
  reply = (call) => {
    if (call.url.pathname === '/v1beta/interactions') return [200, { id: 'v1_a', status: 'completed', steps: [
      { type: 'user_input', content: [{ type: 'text', text: 'a slow push in' }] },
      { type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', uri: `${base}/v1beta/files/clip1:download?alt=media` }] },
    ] }];
    if (call.url.pathname === '/v1beta/files/clip1') { asks += 1; return [200, { name: 'files/clip1', state: asks < 3 ? 'PROCESSING' : 'ACTIVE' }]; }
    if (call.url.pathname === '/v1beta/files/clip1:download') return [call.headers['x-goog-api-key'] === KEY ? 200 : 403, Buffer.from('mp4 bytes')];
    return [404, {}];
  };
  const first = Buffer.alloc(33);
  first.writeUInt32BE(0x89504e47, 0);
  first.writeUInt32BE(720, 16);
  first.writeUInt32BE(1280, 20);
  const result = await google.run('video', { out: 'shot', prompt: 'a slow push in', duration: 5, 'first-frame': 'assets/image/first.png' }, ctx({ 'assets/image/first.png': new Uint8Array(first) }));
  const sent = JSON.parse(seen.findLast((c) => c.url.pathname === '/v1beta/interactions').body);
  assert.equal(sent.model, 'gemini-omni-1.2-flash');
  assert.deepEqual(sent.input.map((/** @type {any} */ p) => p.type), ['image', 'text']);
  assert.equal(sent.input[0].mime_type, 'image/png');
  assert.equal(sent.input[1].text, 'a slow push in');
  /* a tall first frame makes a tall clip, of the length asked; a single frame is the clip's first */
  assert.deepEqual(sent.response_format, { type: 'video', delivery: 'uri', aspect_ratio: '9:16', resolution: '720p', duration: '5s' });
  assert.deepEqual(sent.generation_config, { video_config: { task: 'image_to_video' } });
  assert.equal(asks, 3);
  assert.equal(result.files[0].path, 'assets/video/shot.mp4');
  assert.equal(Buffer.from(result.files[0].bytes).toString(), 'mp4 bytes');
  assert.deepEqual({ ...result.index[0], from: undefined }, { src: 'assets/video/shot.mp4', kind: 'video', w: 720, h: 1280, dur: 5, hasAudio: true, from: undefined });
  assert.equal(result.receipt.notes, undefined);
});

test('a video\'s lengths, sizes and pictures: 3 to 15 s, 10 between two frames; 6 reference pictures; a clip sent inline', async () => {
  reply = () => [200, { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data: Buffer.from('inline mp4').toString('base64') }] }] }];
  const png = new Uint8Array(Buffer.from('89504e470d0a1a0a', 'hex'));
  const pictures = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => [`assets/image/${n}.png`, png]));
  const long = await google.run('video', { out: 'x', prompt: 'y', duration: 20, resolution: '4K', 'aspect-ratio': '1:1' }, ctx());
  let sent = JSON.parse(seen.at(-1).body);
  assert.equal(sent.input, 'y');
  assert.deepEqual(sent.response_format, { type: 'video', delivery: 'uri', aspect_ratio: '16:9', resolution: '4k', duration: '15s' });
  assert.equal(sent.generation_config, undefined);
  assert.equal(Buffer.from(long.files[0].bytes).toString(), 'inline mp4');
  assert.deepEqual([long.index[0].w, long.index[0].h, long.index[0].dur], [3840, 2160, 15]);
  assert.match(long.receipt.notes.join('\n'), /3 to 15 second clips: 15 s/);
  assert.match(long.receipt.notes.join('\n'), /16:9 or 9:16 clips: 16:9/);

  const between = await google.run('video', { out: 'x', prompt: 'y', duration: 12, 'first-frame': 'assets/image/a.png', 'last-frame': 'assets/image/b.png', 'input-reference': ['assets/image/c.png'] }, ctx(pictures));
  sent = JSON.parse(seen.at(-1).body);
  assert.deepEqual(sent.input.map((/** @type {any} */ p) => p.type), ['image', 'image', 'text']);
  assert.equal(sent.response_format.duration, '10s');
  assert.equal(sent.generation_config, undefined, 'two frames are read as a start and an end');
  assert.match(between.receipt.notes.join('\n'), /frames were used/);
  assert.match(between.receipt.notes.join('\n'), /3 to 10 second clips between two frames/);

  const refs = await google.run('video', { out: 'x', prompt: 'y', resolution: '1080p', 'input-reference': Object.keys(pictures) }, ctx(pictures));
  sent = JSON.parse(seen.at(-1).body);
  assert.equal(sent.input.filter((/** @type {any} */ p) => p.type === 'image').length, 6);
  assert.deepEqual(sent.generation_config, { video_config: { task: 'reference_to_video' } });
  assert.equal(sent.response_format.resolution, '1080p');
  assert.deepEqual(refs.index[0].from.refs, Object.keys(pictures).slice(0, 6));
  assert.match(refs.receipt.notes[0], /6 reference pictures/);

  await assert.rejects(google.run('video', { out: 'x', prompt: 'y', 'last-frame': 'assets/image/b.png' }, ctx(pictures)), /--first-frame too/);
});

test('a video that is not made says why; a file that fails says so; a cancelled run stops asking', async () => {
  reply = () => [200, { status: 'failed', steps: [] }];
  await assert.rejects(google.run('video', { out: 'x', prompt: 'y' }, ctx()), /Gemini Omni made no clip \(failed\)/);
  reply = () => [400, { error: { message: 'prompt was blocked' } }];
  await assert.rejects(google.run('video', { out: 'x', prompt: 'y' }, ctx()), /400: prompt was blocked/);
  const made = { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'video', uri: `${base}/v1beta/files/clip2:download?alt=media` }] }] };
  reply = (call) => [200, call.url.pathname === '/v1beta/interactions' ? made : { state: 'FAILED', error: { message: 'encoding failed' } }];
  await assert.rejects(google.run('video', { out: 'x', prompt: 'y' }, ctx()), /could not finish the clip: encoding failed/);
  let asks = 0;
  reply = (call) => { if (call.url.pathname !== '/v1beta/interactions') asks += 1; return [200, call.url.pathname === '/v1beta/interactions' ? made : { state: 'PROCESSING' }]; };
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
    if (call.url.pathname === '/v1beta/interactions') return [200, { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'video', uri: `${elsewhere}/v1beta/files/clip.mp4:download` }] }] }];
    return [200, Buffer.from('mp4 bytes')];
  };
  await assert.rejects(google.run('video', { out: 'x', prompt: 'y' }, ctx()), /not its own; your key was not sent there/);
  assert.equal(keyed, 0);
});
