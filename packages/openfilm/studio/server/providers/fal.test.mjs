import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fal, { polling } from './fal.mjs';
import { wav } from './common.mjs';

const KEY = 'fal-test-key:0123456789';
/** A fake fal queue on 127.0.0.1: `reply` answers each request; `seen` keeps them. */
let server, base;
let reply = () => [404, {}];
const seen = [];

before(async () => {
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const call = { method: req.method, url: new URL(req.url, 'http://x'), headers: req.headers, body: Buffer.concat(chunks) };
    seen.push(call);
    const [status, body, type = 'application/json'] = await reply(call);
    res.writeHead(status, { 'content-type': type }).end(Buffer.isBuffer(body) ? body : JSON.stringify(body));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.OPENFILM_FAL_URL = base;
  polling.ms = { image: 5, audio: 5, video: 5 };
});
after(() => server.close());

const ctx = (files = {}, signal = new AbortController().signal) => ({ key: KEY, root: '/project', signal, say: () => {}, read: async (p) => files[p] });

/**
 * One queued model: submitted at /<model>, done after `ready` status asks (fal's status and result addresses use the
 * app's base id, so they are taken from the submit answer, never built).
 */
function queue(model, result, ready = 2) {
  let asks = 0;
  return (call) => {
    if (call.method === 'POST' && call.url.pathname === `/${model}`) {
      return [200, { request_id: 'r1', status_url: `${base}/app/requests/r1/status`, response_url: `${base}/app/requests/r1`, cancel_url: `${base}/app/requests/r1/cancel` }];
    }
    if (call.url.pathname === '/app/requests/r1/status') { asks += 1; return [200, { status: asks < ready ? 'IN_QUEUE' : 'COMPLETED' }]; }
    if (call.url.pathname === '/app/requests/r1') return [200, result];
    if (call.url.pathname === '/files/out.png') return [200, png(1536, 864), 'image/png'];
    if (call.url.pathname === '/files/out.mp4') return [200, Buffer.from('mp4'), 'video/mp4'];
    /* two seconds of 16-bit mono WAV at 8 kHz; one second of 128 kbps MP3 */
    if (call.url.pathname === '/files/out.wav') return [200, Buffer.from(wav(new Uint8Array(32000), 8000)), 'audio/wav'];
    if (call.url.pathname === '/files/out.mp3') return [200, Buffer.alloc(16000, 1), 'audio/mpeg'];
    return [404, {}];
  };
}

function png(w, h) {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

test('a picture through the queue: submitted with the key, asked after, its file downloaded', async () => {
  reply = queue('fal-ai/flux-2-pro', { images: [{ url: `${base}/files/out.png`, content_type: 'image/png' }] });
  const result = await fal.run('image', { out: 'hero', prompt: 'a brass key', ratio: '16:9', quality: 'high', transparent: true }, ctx());
  const submit = seen.find((c) => c.method === 'POST');
  assert.equal(submit.headers.authorization, `Key ${KEY}`);
  assert.deepEqual(JSON.parse(submit.body), { prompt: 'a brass key', image_size: { width: 1536, height: 864 }, output_format: 'png' });
  assert.equal(seen.filter((c) => c.url.pathname.endsWith('/status')).length, 2);
  assert.equal(result.files[0].path, 'assets/image/hero.png');
  assert.deepEqual([result.index[0].w, result.index[0].h], [1536, 864]);
  assert.equal(result.receipt.notes.length, 2);
});

test('a video from a first and last frame: the image-to-video model, the pictures inline, the length within 4–15 s', async () => {
  seen.length = 0;
  reply = queue('bytedance/seedance-2.0/image-to-video', { video: { url: `${base}/files/out.mp4` } });
  const files = { 'assets/image/a.png': new Uint8Array(png(16, 9)), 'assets/image/b.png': new Uint8Array(png(16, 9)) };
  const result = await fal.run('video', { out: 'shot', prompt: 'morph', duration: 20, 'aspect-ratio': '2:3', 'first-frame': 'assets/image/a.png', 'last-frame': 'assets/image/b.png' }, ctx(files));
  const input = JSON.parse(seen.find((c) => c.method === 'POST').body);
  assert.equal(input.duration, '15');
  assert.equal(input.aspect_ratio, '9:16');
  assert.equal(input.resolution, '1080p');
  assert.match(input.image_url, /^data:image\/png;base64,/);
  assert.match(input.end_image_url, /^data:image\/png;base64,/);
  assert.equal(result.files[0].path, 'assets/video/shot.mp4');
  assert.equal(result.index[0].dur, 15);
  assert.equal(result.receipt.notes.length, 2);
});

test('the model the person chose: its own endpoints and fields (Kling: start_image_url, no resolution, no reference pictures)', async () => {
  seen.length = 0;
  reply = queue('fal-ai/kling-video/v3/pro/image-to-video', { video: { url: `${base}/files/out.mp4` } });
  const files = { 'assets/image/a.png': new Uint8Array(png(16, 9)), 'assets/image/r.png': new Uint8Array(png(16, 9)) };
  const result = await fal.run('video', { out: 'shot', prompt: 'walk', duration: 2, 'aspect-ratio': '16:9', 'first-frame': 'assets/image/a.png', 'input-reference': ['assets/image/r.png'] },
    { ...ctx(files), model: 'kling-3.0-pro' });
  const input = JSON.parse(seen.find((c) => c.method === 'POST').body);
  assert.equal(input.duration, '3');
  assert.match(input.start_image_url, /^data:image\/png;base64,/);
  assert.deepEqual(['image_url', 'image_urls', 'resolution', 'aspect_ratio'].filter((k) => k in input), []);
  assert.equal(result.receipt.model, 'fal-ai/kling-video/v3/pro/image-to-video');
  assert.equal(result.receipt.notes.length, 2);
  /* a model it does not have is its first */
  seen.length = 0;
  reply = queue('fal-ai/flux-2-pro', { images: [{ url: `${base}/files/out.png`, content_type: 'image/png' }] });
  await fal.run('image', { out: 'x', prompt: 'y' }, { ...ctx(), model: 'fal-ai/gone' });
  assert.equal(seen[0].url.pathname, '/fal-ai/flux-2-pro');
});

test('music: Stable Audio 2.5 by default, the length asked in whole seconds within what it makes, measured from the WAV', async () => {
  seen.length = 0;
  reply = queue('fal-ai/stable-audio-25/text-to-audio', { audio: { url: `${base}/files/out.wav`, content_type: 'audio/wav' }, seed: 1 });
  const result = await fal.run('music', { out: 'theme', prompt: 'warm synth pad', sec: 300 }, ctx());
  assert.deepEqual(JSON.parse(seen.find((c) => c.method === 'POST').body), { prompt: 'warm synth pad', seconds_total: 190 });
  assert.equal(result.files[0].path, 'assets/audio/music/theme.wav');
  assert.deepEqual(result.index[0], { src: 'assets/audio/music/theme.wav', kind: 'audio', dur: 2, from: { mode: 'generate', prompt: 'warm synth pad', sec: 300, provider: 'fal', model: 'fal-ai/stable-audio-25/text-to-audio' } });
  assert.match(result.receipt.notes[0], /1 to 190 s: 190 s/);
  /* no length asked: one a film can use */
  seen.length = 0;
  await fal.run('music', { out: 'theme', prompt: 'x' }, ctx());
  assert.equal(JSON.parse(seen.find((c) => c.method === 'POST').body).seconds_total, 60);
});

test('music from Lyria 2: its tracks are 30 s, said when another length was asked', async () => {
  seen.length = 0;
  reply = queue('fal-ai/lyria2', { audio: { url: `${base}/files/out.wav` } });
  const result = await fal.run('music', { out: 'bed', prompt: 'lofi', sec: 12 }, { ...ctx(), model: 'fal-ai/lyria2' });
  assert.deepEqual(JSON.parse(seen.find((c) => c.method === 'POST').body), { prompt: 'lofi' });
  assert.match(result.receipt.notes[0], /30 s tracks/);
});

test('a sound effect: ElevenLabs Sound Effects through fal as 128 kbps MP3, its length from its size', async () => {
  seen.length = 0;
  reply = queue('fal-ai/elevenlabs/sound-effects/v2', { audio: { url: `${base}/files/out.mp3`, content_type: 'audio/mpeg', file_name: 'out.mp3' } });
  const result = await fal.run('sfx', { out: 'whoosh', prompt: 'a fast whoosh', sec: 1.5 }, ctx());
  assert.deepEqual(JSON.parse(seen.find((c) => c.method === 'POST').body), { text: 'a fast whoosh', duration_seconds: 1.5, output_format: 'mp3_44100_128' });
  assert.equal(result.files[0].path, 'assets/audio/sfx/whoosh.mp3');
  assert.equal(result.index[0].dur, 1);
  /* no length asked: the model chooses */
  seen.length = 0;
  await fal.run('sfx', { out: 'whoosh', prompt: 'x' }, ctx());
  assert.equal('duration_seconds' in JSON.parse(seen.find((c) => c.method === 'POST').body), false);
});

test('a cancelled video run cancels the queued request too', async () => {
  seen.length = 0;
  reply = queue('bytedance/seedance-2.0/text-to-video', {}, Infinity);
  const stop = new AbortController();
  const run = fal.run('video', { out: 'x', prompt: 'y' }, ctx({}, stop.signal));
  await new Promise((done) => setTimeout(done, 30));
  stop.abort();
  await assert.rejects(run);
  await new Promise((done) => setTimeout(done, 30));
  assert.ok(seen.some((c) => c.method === 'PUT' && c.url.pathname === '/app/requests/r1/cancel' && c.headers.authorization === `Key ${KEY}`));
});

test('a failed request says what fal said', async () => {
  reply = (call) => call.method === 'POST' ? [422, { detail: [{ msg: 'prompt is too long' }] }] : [404, {}];
  await assert.rejects(fal.run('image', { out: 'x', prompt: 'y' }, ctx()), /fal\.ai answered 422: prompt is too long/);
});

test('the key goes only to fal\'s own queue: a status or result address elsewhere is refused, unasked', async () => {
  seen.length = 0;
  /* the same server under another name is another origin */
  const elsewhere = base.replace('127.0.0.1', 'localhost');
  reply = (call) => call.method === 'POST'
    ? [200, { request_id: 'r2', status_url: `${elsewhere}/app/requests/r2/status`, response_url: `${base}/app/requests/r2` }]
    : [200, { status: 'COMPLETED' }];
  await assert.rejects(fal.run('image', { out: 'x', prompt: 'y' }, ctx()), /not its own; your key was not sent there/);
  assert.equal(seen.filter((c) => c.headers.host.startsWith('localhost')).length, 0);
});

/** fal's storage: an upload begun, then the clip put at the address it answered; `fails`: it refuses */
function storage(next, { fails = false } = {}) {
  return (call) => {
    if (call.url.pathname === '/storage/upload/initiate') {
      return fails ? [500, { detail: 'no' }] : [200, { upload_url: `${base}/upload/clip`, file_url: 'https://v3b.fal.media/files/clip.mp4' }];
    }
    if (call.method === 'PUT' && call.url.pathname === '/upload/clip') return [200, {}];
    return next(call);
  };
}

test('a clip made from another (--video): put on fal\'s storage, each model its own way and fields', async () => {
  process.env.OPENFILM_FAL_REST_URL = base;
  const files = { 'references/shot.mp4': new Uint8Array(Buffer.from('a clip')), 'assets/image/me.png': new Uint8Array(png(16, 16)) };
  const run = async (model, args, endpoint) => {
    seen.length = 0;
    reply = storage(queue(endpoint, { video: { url: `${base}/files/out.mp4` } }));
    const result = await fal.run('video', { out: 'again', video: 'references/shot.mp4', ...args }, { ...ctx(files), model });
    return { result, input: JSON.parse(seen.find((c) => c.method === 'POST' && c.url.pathname === `/${endpoint}`).body), upload: seen.find((c) => c.method === 'PUT') };
  };
  /* edit: what the prompt names changes, the clip named @Video1, its sound kept */
  const edit = await run('kling-o3-edit', { prompt: 'the cup is a red mug', 'input-reference': ['assets/image/me.png'] }, 'fal-ai/kling-video/o3/pro/video-to-video/edit');
  assert.deepEqual({ ...edit.input, image_urls: edit.input.image_urls.length }, { prompt: '@Video1: the cup is a red mug', video_url: 'https://v3b.fal.media/files/clip.mp4', image_urls: 1, keep_audio: true });
  assert.equal(String(edit.upload.body), 'a clip');
  assert.equal(edit.result.files[0].path, 'assets/video/again.mp4');
  /* follow: a new clip with its camera and motion, as long as asked */
  const follow = await run('kling-o3-reference', { prompt: '@Video1 with a dog instead', duration: 8, 'aspect-ratio': '4:3' }, 'fal-ai/kling-video/o3/pro/video-to-video/reference');
  assert.deepEqual([follow.input.prompt, follow.input.duration, follow.input.aspect_ratio], ['@Video1 with a dog instead', '8', 'auto']);
  /* modify: Luma redraws 5 or 10 s, a picture its first frame */
  const modify = await run('luma-ray-3.2', { prompt: 'as a watercolor', duration: 7 }, 'luma/agent/ray/v3.2/video-to-video');
  assert.deepEqual([modify.input.duration, modify.input.resolution], ['10s', '720p']);
  /* recast: the people of the pictures in place of the clip's */
  const recast = await run('minimax-h3-max-recast', { 'input-reference': ['assets/image/me.png'] }, 'minimax/h3-max/recast');
  assert.deepEqual([recast.input.reference_image_urls.length, recast.input.resolution], [1, '1080P']);
  await assert.rejects(fal.run('video', { out: 'x', video: 'references/shot.mp4' }, { ...ctx(files), model: 'minimax-h3-max-recast' }), /one picture each/);
  await assert.rejects(fal.run('video', { out: 'x', prompt: 'p' }, { ...ctx(files), model: 'kling-o3-edit' }), /give it with --video/);
  /* Seedance takes it as a reference clip; Kling 3.0 makes clips from a prompt and pictures */
  const seedance = await run('seedance-2.0', { prompt: 'the same move, in a forest' }, 'bytedance/seedance-2.0/reference-to-video');
  assert.deepEqual([seedance.input.prompt, seedance.input.video_urls], ['@Video1: the same move, in a forest', ['https://v3b.fal.media/files/clip.mp4']]);
  await assert.rejects(fal.run('video', { out: 'x', prompt: 'p', video: 'references/shot.mp4' }, { ...ctx(files), model: 'kling-3.0-pro' }), /--model seedance-2\.0, kling-o3-edit/);
  /* storage refused: a small clip goes inline */
  seen.length = 0;
  reply = storage(queue('fal-ai/kling-video/o3/pro/video-to-video/edit', { video: { url: `${base}/files/out.mp4` } }), { fails: true });
  await fal.run('video', { out: 'again', video: 'references/shot.mp4', prompt: 'p' }, { ...ctx(files), model: 'kling-o3-edit' });
  assert.match(JSON.parse(seen.find((c) => c.url.pathname === '/fal-ai/kling-video/o3/pro/video-to-video/edit').body).video_url, /^data:video\/mp4;base64,/);
});

test('a person speaking a recording (--audio): from a picture or a clip, the lips following it, the clip its length; a voice for Seedance', async () => {
  process.env.OPENFILM_FAL_REST_URL = base;
  const files = { 'assets/audio/vo/line.wav': new Uint8Array(Buffer.from('speech')), 'assets/image/host.png': new Uint8Array(png(16, 16)), 'assets/video/talk.mp4': new Uint8Array(Buffer.from('clip')) };
  const run = async (model, args, endpoint) => {
    seen.length = 0;
    reply = storage(queue(endpoint, { video: { url: `${base}/files/out.mp4` } }));
    const result = await fal.run('video', { out: 'host', ...args }, { ...ctx(files), model });
    return { result, input: JSON.parse(seen.find((c) => c.method === 'POST' && c.url.pathname === `/${endpoint}`).body) };
  };
  const omni = await run('omnihuman-v2', { audio: 'assets/audio/vo/line.wav', 'first-frame': 'assets/image/host.png', prompt: 'waist up, a slow push in' }, 'bytedance/omnihuman/v2');
  assert.deepEqual({ ...omni.input, image_url: omni.input.image_url.slice(0, 22) }, { image_url: 'data:image/png;base64,', audio_url: 'https://v3b.fal.media/files/clip.mp4', prompt: 'waist up, a slow push in' });
  assert.equal(omni.result.index[0].from.audio, 'assets/audio/vo/line.wav');
  const sync = await run('sync-3', { audio: 'assets/audio/vo/line.wav', video: 'assets/video/talk.mp4' }, 'fal-ai/sync-lipsync/v3');
  assert.deepEqual(Object.keys(sync.input).sort(), ['audio_url', 'sync_mode', 'video_url']);
  await assert.rejects(fal.run('video', { out: 'x', audio: 'assets/audio/vo/line.wav' }, { ...ctx(files), model: 'kling-avatar-v2' }), /--first-frame/);
  await assert.rejects(fal.run('video', { out: 'x', prompt: 'p', audio: 'assets/audio/vo/line.wav' }, { ...ctx(files), model: 'kling-3.0-pro' }), /--model omnihuman-v2 or kling-avatar-v2/);
  /* Seedance: whose voice, as a reference beside the picture of who speaks */
  const voiced = await run('seedance-2.0', { prompt: 'He says: "此刻海上有多少艘船？"', voice: 'assets/audio/vo/line.wav', 'first-frame': 'assets/image/host.png' }, 'bytedance/seedance-2.0/reference-to-video');
  assert.deepEqual([voiced.input.audio_urls, voiced.input.image_urls.length, voiced.input.image_url], [['https://v3b.fal.media/files/clip.mp4'], 1, undefined]);
  await assert.rejects(fal.run('video', { out: 'x', prompt: 'p', voice: 'assets/audio/vo/line.wav' }, { ...ctx(files), model: 'seedance-2.0' }), /goes with a picture or a clip/);
});
