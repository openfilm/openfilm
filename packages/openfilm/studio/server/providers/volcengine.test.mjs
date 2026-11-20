import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import volcengine, { polling, videoModelSpec } from './volcengine.mjs';

const KEY = 'ark-test-0123456789';
/** A fake Ark on 127.0.0.1: `reply` answers each request; `seen` keeps them. */
let server, base;
let reply = () => [404, {}];
const seen = [];

before(async () => {
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const call = { method: req.method, url: new URL(req.url, 'http://x'), headers: req.headers, body: Buffer.concat(chunks).toString() };
    seen.push(call);
    const [status, body, type = 'application/json'] = await reply(call);
    res.writeHead(status, { 'content-type': type }).end(Buffer.isBuffer(body) ? body : JSON.stringify(body));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.OPENFILM_ARK_URL = base;
  polling.ms = 5;
});
after(() => server.close());

const ctx = (files = {}, model, link) => ({
  key: KEY, model, root: '', signal: new AbortController().signal, say: () => {},
  read: async (p) => { if (!(p in files)) throw new Error(`no ${p}`); return files[p]; },
  ...(link ? { link } : {}),
});

/** A clip made after `ready` asks, its file at a signed address of Ark's storage. */
function task(ready = 2, end = { status: 'succeeded', usage: { completion_tokens: 40594, total_tokens: 40594 } }) {
  let asks = 0;
  return (call) => {
    if (call.method === 'POST' && call.url.pathname === '/api/v3/contents/generations/tasks') return [200, { id: 'cgt-1' }];
    if (call.url.pathname === '/api/v3/contents/generations/tasks/cgt-1') {
      asks += 1;
      if (asks < ready) return [200, { id: 'cgt-1', status: 'running' }];
      return [200, { id: 'cgt-1', ...end, content: { video_url: `${base}/files/cgt-1.mp4?X-Tos-Signature=s` } }];
    }
    if (call.url.pathname === '/files/cgt-1.mp4') return [200, Buffer.from('mp4'), 'video/mp4'];
    return [404, {}];
  };
}

test('a clip from a first and last frame: Ark\'s model, roles and sizes, asked after until done, its file fetched without the key', async () => {
  seen.length = 0;
  reply = task();
  const frame = new Uint8Array([1, 2, 3]);
  const result = await volcengine.run('video', { prompt: 'a cat walks', 'first-frame': 'a.png', 'last-frame': 'b.png', duration: 20, 'aspect-ratio': '16:9', resolution: '1080p', out: 'cat' },
    ctx({ 'a.png': frame, 'b.png': frame }));
  const body = JSON.parse(seen[0].body);
  assert.equal(body.model, 'doubao-seedance-2-0-fast-260128', 'Fast is the default');
  assert.deepEqual(body.content, [
    { type: 'text', text: 'a cat walks' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' }, role: 'first_frame' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' }, role: 'last_frame' },
  ]);
  assert.equal(body.duration, 15, 'Seedance 2.0 makes up to 15 s');
  assert.equal(body.resolution, '720p', 'Fast makes up to 720p');
  assert.equal(body.ratio, '16:9');
  assert.equal(body.generate_audio, true);
  assert.equal(body.watermark, false);
  assert.ok(seen.slice(0, -1).every((c) => c.headers.authorization === `Bearer ${KEY}`));
  assert.equal(seen.at(-1).headers.authorization, undefined, 'the signed file address gets no key');
  assert.equal(Buffer.from(result.files[0].bytes).toString(), 'mp4');
  assert.equal(result.receipt.tokens, 40594, 'the tokens Ark bills');
  assert.equal(result.receipt.videoInput, undefined);
  assert.match(result.receipt.notes.join(' '), /4 to 15 second clips: 15 s/);
  assert.match(result.receipt.notes.join(' '), /480p, 720p: 720p/);
});

test('references: pictures, clips and recordings by role; clips and recordings only by address; a clip input marks the receipt', async () => {
  seen.length = 0;
  reply = task(1);
  const files = { 'p.png': new Uint8Array([1]), 'c.mp4': new Uint8Array([2]), 'v.mp3': new Uint8Array([3]) };
  const link = async (p) => `https://relay.example/${p}`;
  const result = await volcengine.run('video', { prompt: 'p', 'first-frame': 'p.png', video: 'c.mp4', voice: 'v.mp3', out: 'r' }, ctx(files, 'doubao-seedance-2-0-260128', link));
  const body = JSON.parse(seen[0].body);
  assert.deepEqual(body.content.slice(1).map((c) => [c.type, c.role]), [['image_url', 'reference_image'], ['video_url', 'reference_video'], ['audio_url', 'reference_audio']]);
  assert.equal(body.content[2].video_url.url, 'https://relay.example/c.mp4');
  assert.equal(result.receipt.videoInput, true);
  assert.equal(result.receipt.referenceSeconds, undefined, 'a clip whose length is not known');
  await assert.rejects(volcengine.run('video', { prompt: 'p', video: 'c.mp4', out: 'r' }, ctx(files)), /only from a web address/);
  await assert.rejects(volcengine.run('video', { prompt: 'p', voice: 'v.mp3', out: 'r' }, ctx(files, 'doubao-seedance-2-0-mini-260615', link)), /needs a reference picture or clip/);
});

test('with an address to give, pictures go as addresses; handed off, the clip is its signed address, not fetched', async () => {
  seen.length = 0;
  reply = task(1, { status: 'succeeded', duration: 6, usage: { completion_tokens: 100 } });
  const link = async (p) => `https://relay.example/${p}`;
  const result = await volcengine.run('video', { prompt: 'p', 'first-frame': 'a.png', out: 'r' }, { ...ctx({}, undefined, link), handOff: true });
  assert.deepEqual(JSON.parse(seen[0].body).content[1], { type: 'image_url', image_url: { url: 'https://relay.example/a.png' }, role: 'first_frame' }, 'Ark fetches it: the run never read it');
  assert.ok(!seen.some((c) => c.url.pathname.startsWith('/files/')), 'the clip is not fetched');
  assert.deepEqual(result.files, [{ path: 'assets/video/r.mp4', url: `${base}/files/cgt-1.mp4?X-Tos-Signature=s`, type: 'video/mp4' }]);
  assert.equal(result.index[0].dur, 6, 'its length as Ark says it');
});

test('Seedance 2.5: up to 30 s; it keeps the shape of a first frame, and of a clip it may edit, whose length it chooses', async () => {
  seen.length = 0;
  reply = task(1);
  const files = { 'p.png': new Uint8Array([1]), 'c.mp4': new Uint8Array([2]) };
  await volcengine.run('video', { prompt: 'p', 'first-frame': 'p.png', duration: 30, 'aspect-ratio': '9:16', out: 'a' }, ctx(files, 'doubao-seedance-2-5-260628'));
  let body = JSON.parse(seen[0].body);
  assert.equal(body.duration, 30);
  assert.equal(body.ratio, 'adaptive');
  seen.length = 0;
  await volcengine.run('video', { prompt: 'p', video: 'c.mp4', out: 'b' }, ctx(files, 'doubao-seedance-2-5-260628', async (p) => `https://relay.example/${p}`));
  body = JSON.parse(seen[0].body);
  assert.equal(body.duration, -1);
  assert.equal(body.ratio, 'adaptive');
  assert.equal(body.omni_reference_task_type, 'auto');
});

test('a failed task says why; an account without balance is the service\'s, not the person\'s', async () => {
  reply = task(1, { status: 'failed', error: { code: 'OutputVideoSensitiveContentDetected', message: 'The output video may contain sensitive information.' } });
  await assert.rejects(volcengine.run('video', { prompt: 'p', out: 'x' }, ctx()), /could not make it: The output video may contain sensitive information/);
  reply = () => [400, { error: { code: 'AccountOverdueError', message: 'Your account has an overdue balance.' } }];
  await assert.rejects(volcengine.run('video', { prompt: 'p', out: 'x' }, ctx()), (e) => e.code === 'balance');
  reply = () => [403, { error: { code: 'AuthenticationError', message: 'The API key is invalid.' } }];
  await assert.rejects(volcengine.run('video', { prompt: 'p', out: 'x' }, ctx()), /did not accept your key/);
});

test('what each model offers: sizes, lengths, references, with recordings and clips only where the run can link them', () => {
  assert.deepEqual(videoModelSpec('doubao-seedance-2-0-mini-260615').sizes, ['480p', '720p']);
  assert.deepEqual(videoModelSpec('doubao-seedance-2-0-260128').sizes, ['480p', '720p', '1080p', '4K']);
  assert.deepEqual(videoModelSpec('doubao-seedance-2-5-260628').seconds, [4, 30]);
  assert.equal(videoModelSpec('doubao-seedance-2-0-fast-260128').clip, undefined);
  assert.equal(videoModelSpec('doubao-seedance-2-0-fast-260128', true).clip, 3);
  assert.equal(videoModelSpec('doubao-seedance-2-5-260628', true).voiceNeedsVisual, undefined);
  assert.equal(volcengine.env, 'ARK_API_KEY');
});

test('Seedance 2.5 Flash: 480p and 720p, 4 to 30 s, from up to 10 pictures and 5 clips and recordings', () => {
  assert.deepEqual(videoModelSpec('doubao-seedance-2-5-flash-261115', true), {
    ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], seconds: [4, 30], refs: 10, frames: true, sizes: ['480p', '720p'], voice: 5, clip: 5,
  });
});

test('a Seedream picture: its size in pixels, opaque or transparent, no mark; 4K asked is 2K; a mask is refused', async () => {
  /* a 1 × 1 PNG */
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
  reply = (call) => call.url.pathname === '/api/v3/images/generations'
    ? [200, { data: [{ b64_json: png.toString('base64'), size: '2720x1536' }], usage: { input_images: 1, generated_images: 1 } }] : [404, {}];
  seen.length = 0;
  const made = await volcengine.run('image', { out: 'snow', prompt: 'the harbor in snow', ref: ['a.png'], ratio: '16:9', size: '4k', transparent: true },
    ctx({ 'a.png': new Uint8Array(png) }, 'doubao-seedream-5-5-261028'));
  const sent = JSON.parse(seen.at(-1).body);
  assert.equal(seen.at(-1).headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual({ ...sent, image: sent.image.map((u) => u.slice(0, 22)) }, {
    model: 'doubao-seedream-5-5-261028', prompt: 'the harbor in snow', size: '2720x1536', output_format: 'png', background: 'transparent',
    response_format: 'b64_json', watermark: false, image: ['data:image/png;base64,'],
  });
  assert.equal(made.files[0].path, 'assets/image/snow.png');
  assert.equal(made.receipt.size, '2k');
  assert.equal(made.receipt.refs, 1);
  assert.match(made.receipt.notes[0], /Seedream makes 1k and 2k pictures/);
  await volcengine.run('image', { out: 'a', prompt: 'a lantern' }, ctx({}, 'doubao-seedream-5-5-261028'));
  assert.deepEqual(JSON.parse(seen.at(-1).body).size, '1536x1024', '1K at 3:2 by default');
  assert.equal(JSON.parse(seen.at(-1).body).background, 'opaque');
  await assert.rejects(volcengine.run('image', { out: 'a', prompt: 'x', ref: ['a.png'], mask: 'm.png' }, ctx({}, 'doubao-seedream-5-5-261028')), /--mask: Seedream changes a picture as the prompt says/);
});

test('Seedream sends small known reference bytes inline and keeps large references linked in order', async () => {
  seen.length = 0;
  const sample = new Uint8Array([1, 2, 3]);
  reply = () => [200, { data: [{ b64_json: 'AQID' }] }];
  const link = async (path) => 'https://assets.example/' + path;
  const size = { 'small.png': sample.byteLength, 'large.png': 9 * 1024 * 1024 };
  await volcengine.run('image', { out: 'test', prompt: 'a lantern', ref: ['small.png', 'large.png'] }, {
    ...ctx({ 'small.png': sample }, 'doubao-seedream-5-5-261028', link),
    inputSize: (path) => size[path],
  });
  assert.deepEqual(JSON.parse(seen[0].body).image, ['data:image/png;base64,AQID', 'https://assets.example/large.png']);
  assert.equal(seen.length, 1);
});

test('Seedream reports signed reference download failures without exposing the link or resubmitting', async () => {
  seen.length = 0;
  reply = () => [400, { error: { message: 'Timeout while downloading url=https://assets.example/file?signature=test' } }];
  const context = ctx({}, 'doubao-seedream-5-5-261028', async () => 'https://assets.example/file?signature=test');
  await assert.rejects(volcengine.run('image', { out: 'test', prompt: 'a lantern', ref: ['large.png'] }, context),
    (error) => /timed out downloading a Seedream reference image/.test(error.message) && !error.message.includes('signature'));
  assert.equal(seen.length, 1);
});
