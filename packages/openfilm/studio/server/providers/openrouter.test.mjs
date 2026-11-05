import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import openrouter, { polling } from './openrouter.mjs';

const KEY = 'sk-or-v1-test0123456789';
/** A fake OpenRouter on 127.0.0.1: `reply` answers each request; `seen` keeps them. */
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
  process.env.OPENFILM_OPENROUTER_URL = base;
  polling.ms = 5;
});
after(() => server.close());

const ctx = (files = {}, model) => ({
  key: KEY, model, root: '/project', signal: new AbortController().signal, say: () => {},
  read: async (p) => { if (!(p in files)) throw new Error(`no ${p}`); return files[p]; },
});

function png(w, h) {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

/** A clip made after `ready` asks, at OpenRouter's own addresses. */
function clip(ready = 2, end = { status: 'completed', unsigned_urls: () => [`${base}/api/v1/videos/v1/content?index=0`], usage: { cost: 0.42 } }) {
  let asks = 0;
  return (call) => {
    if (call.method === 'POST' && call.url.pathname === '/api/v1/videos') return [202, { id: 'v1', polling_url: `${base}/api/v1/videos/v1`, status: 'pending' }];
    if (call.url.pathname === '/api/v1/videos/v1') {
      asks += 1;
      if (asks < ready) return [200, { id: 'v1', status: 'in_progress' }];
      return [200, { id: 'v1', ...end, ...(typeof end.unsigned_urls === 'function' ? { unsigned_urls: end.unsigned_urls() } : {}) }];
    }
    if (call.url.pathname === '/api/v1/videos/v1/content') return [200, Buffer.from('mp4'), 'video/mp4'];
    return [404, {}];
  };
}

test('a picture: the model, the prompt and the shape, with the key; landed as it came, with what it cost', async () => {
  seen.length = 0;
  reply = () => [200, { data: [{ b64_json: png(1536, 1024).toString('base64'), media_type: 'image/png' }], usage: { cost: 0.04 } }];
  const result = await openrouter.run('image', { prompt: 'a red door', ratio: '3:2', out: 'door' }, ctx({}, 'google/gemini-nano-banana-2.1'));
  assert.equal(seen[0].url.pathname, '/api/v1/images');
  assert.equal(seen[0].headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(seen[0].body), { model: 'google/gemini-nano-banana-2.1', prompt: 'a red door', aspect_ratio: '3:2', n: 1 });
  assert.equal(result.files[0].path, 'assets/image/door.png');
  assert.equal(result.index[0].w, 1536);
  assert.equal(result.receipt.usd, 0.04);
  assert.equal(result.receipt.model, 'google/gemini-nano-banana-2.1');
});

test('quality and transparency go to the model that has them, and are said to be left out by the others', async () => {
  seen.length = 0;
  reply = () => [200, { data: [{ b64_json: png(1024, 1024).toString('base64') }] }];
  await openrouter.run('image', { prompt: 'a logo', ratio: '1:1', quality: 'high', transparent: true, out: 'logo' }, ctx({}, 'openai/gpt-image-2.5-flare'));
  assert.deepEqual(JSON.parse(seen[0].body), { model: 'openai/gpt-image-2.5-flare', prompt: 'a logo', n: 1, size: '1024x1024', quality: 'high', background: 'transparent', output_format: 'png' });
  const other = await openrouter.run('image', { prompt: 'a logo', quality: 'high', transparent: true, out: 'logo' }, ctx({}, 'google/gemini-3-pro-image'));
  assert.equal(JSON.parse(seen[1].body).quality, undefined);
  assert.equal(other.receipt.notes.length, 2);
  await assert.rejects(openrouter.run('image', { prompt: 'x', ratio: '5:1', out: 'x' }, ctx()), /--ratio is one of/);
});

test('GPT Image 2.6, the default: every quality, the exact pixels of a size, reference pictures; a mask is OpenAI\'s own', async () => {
  seen.length = 0;
  reply = () => [200, { data: [{ b64_json: png(2720, 1536).toString('base64') }], usage: { cost: 0.09376 } }];
  const files = { 'assets/image/room.png': png(64, 64) };
  const result = await openrouter.run('image', { prompt: 'a harbor', ratio: '16:9', quality: 'xhigh', size: '2k', ref: ['assets/image/room.png'], out: 'harbor' }, ctx(files));
  const body = JSON.parse(seen[0].body);
  assert.deepEqual({ ...body, input_references: body.input_references.length }, { model: 'openai/gpt-image-2.6-flare', prompt: 'a harbor', n: 1, size: '2720x1536', quality: 'xhigh', input_references: 1 });
  assert.match(body.input_references[0].image_url.url, /^data:image\/png;base64,/);
  assert.deepEqual([result.receipt.quality, result.receipt.usd], ['xhigh', 0.09376]);
  /* another maker's model is asked for the size's tier */
  await openrouter.run('image', { prompt: 'a harbor', ratio: '16:9', size: '4k', out: 'h2' }, ctx({}, 'google/gemini-3-pro-image'));
  assert.deepEqual([JSON.parse(seen[1].body).aspect_ratio, JSON.parse(seen[1].body).size], ['16:9', '4K']);
  await assert.rejects(openrouter.run('image', { prompt: 'x', ref: ['assets/image/room.png'], mask: 'assets/image/room.png', out: 'x' }, ctx(files)), /--mask: redrawing part of a picture is OpenAI's own/);
});

test('a clip from a first and last frame: submitted, asked after until done, its file fetched with the key', async () => {
  seen.length = 0;
  reply = clip();
  const frame = new Uint8Array([1, 2, 3]);
  const result = await openrouter.run('video', { prompt: 'a cat walks', 'first-frame': 'assets/image/a.png', 'last-frame': 'assets/image/b.png', duration: 20, 'aspect-ratio': '16:9', out: 'cat' },
    ctx({ 'assets/image/a.png': frame, 'assets/image/b.png': frame }));
  const body = JSON.parse(seen[0].body);
  assert.equal(body.model, 'bytedance/seedance-2.0-fast');
  assert.equal(body.duration, 15, 'Seedance makes up to 15 s');
  assert.equal(body.resolution, '720p');
  assert.equal(body.aspect_ratio, '16:9');
  assert.deepEqual(body.frame_images.map((f) => [f.frame_type, f.image_url.url]), [['first_frame', 'data:image/png;base64,AQID'], ['last_frame', 'data:image/png;base64,AQID']]);
  assert.ok(seen.slice(1).every((c) => c.headers.authorization === `Bearer ${KEY}`));
  assert.equal(seen.at(-1).url.pathname, '/api/v1/videos/v1/content');
  assert.equal(Buffer.from(result.files[0].bytes).toString(), 'mp4');
  assert.equal(result.index[0].dur, 15);
  assert.equal(result.receipt.usd, 0.42);
  assert.match(result.receipt.notes[0], /4 to 15 second clips: 15 s/);
});

test('each model\'s lengths and shapes: Veo makes 4, 6 or 8 s, wide or tall; Kling takes no reference pictures', async () => {
  seen.length = 0;
  reply = clip(1);
  const veo = await openrouter.run('video', { prompt: 'rain', duration: 5, 'aspect-ratio': '1:1', out: 'rain' }, ctx({}, 'google/veo-3.1'));
  assert.equal(JSON.parse(seen[0].body).duration, 6, 'the nearest, the longer on a tie');
  assert.equal(JSON.parse(seen[0].body).aspect_ratio, '16:9');
  assert.equal(veo.index[0].dur, 6);
  seen.length = 0;
  const kling = await openrouter.run('video', { prompt: 'rain', 'input-reference': ['assets/image/a.png'], out: 'rain' }, ctx({ 'assets/image/a.png': new Uint8Array([1]) }, 'kwaivgi/kling-v3.0-pro'));
  assert.equal(JSON.parse(seen[0].body).input_references, undefined);
  assert.match(kling.receipt.notes.join(' '), /no reference pictures/);
  seen.length = 0;
  await openrouter.run('video', { prompt: 'rain', 'input-reference': ['assets/image/a.png'], out: 'rain' }, ctx({ 'assets/image/a.png': new Uint8Array([1]) }, 'bytedance/seedance-2.0'));
  assert.equal(JSON.parse(seen[0].body).input_references.length, 1);
  assert.equal(JSON.parse(seen[0].body).generate_audio, true);
  /* the size asked, when the model makes it; else its nearest, said */
  seen.length = 0;
  await openrouter.run('video', { prompt: 'rain', resolution: '1080p', out: 'rain' }, ctx({}, 'bytedance/seedance-2.0'));
  assert.equal(JSON.parse(seen[0].body).resolution, '1080p');
  seen.length = 0;
  const max = await openrouter.run('video', { prompt: 'rain', resolution: '720p', out: 'rain' }, ctx({}, 'minimax/hailuo-3-max'));
  assert.equal(JSON.parse(seen[0].body).resolution, '768p');
  assert.match(max.receipt.notes.join(' '), /makes 480p, 768p: 768p/);
  /* Hailuo 3 Max makes its sound unasked, at 768p: none is asked for */
  seen.length = 0;
  await openrouter.run('video', { prompt: 'rain', out: 'rain' }, ctx({}, 'minimax/hailuo-3-max'));
  assert.deepEqual([JSON.parse(seen[0].body).generate_audio, JSON.parse(seen[0].body).resolution], [undefined, '768p']);
});

test('a clip that failed says why; the key goes only to OpenRouter\'s own addresses', async () => {
  reply = clip(1, { status: 'failed', error: 'Content policy violation' });
  await assert.rejects(openrouter.run('video', { prompt: 'x', out: 'x' }, ctx()), /could not make it: Content policy violation/);
  reply = clip(1, { status: 'completed', unsigned_urls: () => ['https://elsewhere.example/v.mp4'] });
  await assert.rejects(openrouter.run('video', { prompt: 'x', out: 'x' }, ctx()), /not its own; your key was not sent there/);
});
