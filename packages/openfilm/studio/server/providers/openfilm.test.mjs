import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import openfilm, { polling } from './openfilm.mjs';
import { steadily } from './common.mjs';

const KEY = 'ofk_test0123456789';
/** A fake OpenFilm service on 127.0.0.1: `reply` answers each request; `seen` keeps them. */
let server;
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
  process.env.OPENFILM_API_URL = `http://127.0.0.1:${server.address().port}`;
  polling.ms = 5;
  polling.busy = 5;
  steadily.first = 5;
  steadily.most = 10;
});
after(() => server.close());

const ctx = (files = {}, model) => ({
  key: KEY, model, root: '/project', signal: new AbortController().signal, say: () => {},
  read: async (p) => { if (!(p in files)) throw new Error(`no ${p}`); return files[p]; },
});

test('what it offers is what the service says now: the kinds it knows, voices with voice-over; kept when it cannot be reached', async (t) => {
  assert.deepEqual(openfilm.verbs, [], 'nothing before the service said');
  seen.length = 0;
  reply = (call) => (call.url.pathname === '/v1/media/models' ? [200, { models: {
    tts: [{ id: 'elevenlabs/eleven_v4', name: 'ElevenLabs Eleven v4' }],
    video: [{ id: 'openrouter/bytedance/seedance-2.0-fast', name: 'Seedance 2.0 Fast' },
      { id: 'openrouter/alibaba/wan-3.0', name: 'Wan 3.0', spec: { refs: 10, clip: 5, voice: 5, frames: true } }, { id: 7 }],
    translate: [{ id: 'x/y', name: 'not a kind of media it offers' }],
  } }] : [404, {}]);
  await openfilm.refresh();
  assert.equal(seen[0].headers.authorization, undefined, 'no key: what it offers is no secret');
  assert.deepEqual(openfilm.verbs, ['tts', 'voice', 'video']);
  /* what a model makes is what the provider it is run at says */
  assert.deepEqual(openfilm.models.video, [
    { id: 'openrouter/bytedance/seedance-2.0-fast', name: 'Seedance 2.0 Fast',
      spec: { ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21'], seconds: [4, 15], refs: 9, frames: true, voice: true, voiceNeedsVisual: true, clip: true, sizes: ['480p', '720p'] } },
    { id: 'openrouter/alibaba/wan-3.0', name: 'Wan 3.0', spec: { refs: 10, clip: 5, voice: 5, frames: true } },
  ]);
  assert.equal(openfilm.models.tts[0].spec, undefined, 'a voice has none');
  await openfilm.refresh();
  assert.equal(seen.length, 1, 'asked again only after a while');
  reply = () => [503, {}];
  await openfilm.refresh({ force: true });
  assert.deepEqual(openfilm.verbs, ['tts', 'voice', 'video'], 'kept while it cannot be reached');
  /* once it has answered, a list grown old is shown at once while it is asked again: no one waits on the service */
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 31_000 });
  let answer = () => {};
  const later = new Promise((done) => { answer = done; });
  reply = async () => { await later; return [200, { models: { tts: [{ id: 'inworld/inworld-tts-2', name: 'Inworld TTS-2' }] } }]; };
  await openfilm.refresh();
  assert.deepEqual(openfilm.verbs, ['tts', 'voice', 'video'], 'the list it had, without waiting');
  answer();
  await openfilm.refresh({ force: true });
  assert.deepEqual(openfilm.verbs, ['tts', 'voice'], 'then what it says now');
  t.mock.timers.reset();
});

test('a run: posted with the key, the files it names, async; asked after until done (a service from before uploads: inside the run)', async () => {
  seen.length = 0;
  let asks = 0;
  reply = (call) => {
    if (call.url.pathname === '/v1/media/uploads') return [404, {}];
    if (call.method === 'POST') return [202, { status: 'running', idempotency_key: call.headers['idempotency-key'] }];
    asks += 1;
    if (asks < 2) return [202, { status: 'running' }];
    return [200, { files: [{ path: 'assets/video/a.mp4', base64: Buffer.from('mp4').toString('base64'), bytes: 3 }], index: [{ src: 'assets/video/a.mp4', kind: 'video', dur: 5 }], receipt: { dur: 5 } }];
  };
  const frame = new Uint8Array([1, 2, 3]);
  const result = await openfilm.run('video', { prompt: 'a cat. on a mat', 'first-frame': 'assets/image/cat.png', out: 'cat.mp4' }, ctx({ 'assets/image/cat.png': frame }, 'openrouter/bytedance/seedance-2.0'));
  assert.equal(seen[0].url.pathname, '/v1/media/uploads');
  seen.shift();
  const posted = seen[0];
  assert.equal(posted.url.pathname, '/v1/media/run');
  assert.equal(posted.headers.authorization, `Bearer ${KEY}`);
  assert.match(posted.headers.prefer, /respond-async/);
  const body = JSON.parse(posted.body);
  assert.equal(body.verb, 'video');
  assert.equal(body.model, 'openrouter/bytedance/seedance-2.0');
  assert.deepEqual(body.inputs, [{ path: 'assets/image/cat.png', base64: Buffer.from(frame).toString('base64') }]);
  assert.equal(seen[1].url.searchParams.get('key'), posted.headers['idempotency-key']);
  assert.equal(Buffer.from(result.files[0].bytes).toString(), 'mp4');
  assert.equal(result.index[0].dur, 5);
});

test('a Seedance run sends the clip and pictures named by its reference flags, including spaces in paths', async () => {
  seen.length = 0;
  const video = 'assets/Weixin Videos 01.mp4';
  const picture = 'assets/参考图片/角色 01.png';
  const prompt = 'assets/unused.png';
  const files = {
    [video]: Uint8Array.of(1, 2, 3),
    [picture]: Uint8Array.of(4, 5, 6),
    [prompt]: Uint8Array.of(7, 8, 9),
  };
  reply = (call) => {
    if (call.url.pathname === '/v1/media/uploads') return [404, {}];
    const { args, inputs } = JSON.parse(call.body);
    const sent = new Map(inputs.map(({ path, base64 }) => [path, base64]));
    for (const path of [args.video, ...args['input-reference']]) {
      if (!sent.has(path)) return [422, { message: `${path} was not sent with the run.` }];
    }
    assert.equal(inputs.length, 2, 'only the named reference files, once per path');
    assert.equal(sent.get(video), Buffer.from(files[video]).toString('base64'));
    assert.equal(sent.get(picture), Buffer.from(files[picture]).toString('base64'));
    return [200, { receipt: { dur: 5 } }];
  };
  const result = await openfilm.run('video', { prompt, video, 'input-reference': [picture, picture], out: 'scene' },
    ctx(files, 'openrouter/bytedance/seedance-2.0-mini'));
  assert.equal(result.receipt.dur, 5);
});

test('files go straight to the service\'s storage and come straight from where their maker keeps them', async () => {
  seen.length = 0;
  const base = process.env.OPENFILM_API_URL;
  const frame = Uint8Array.of(1, 2, 3);
  reply = (call) => {
    if (call.url.pathname === '/v1/media/uploads') {
      const { files } = JSON.parse(call.body);
      return [200, { uploads: files.map((f, i) => ({ path: f.path, id: `u${i}/cat.png`, url: `${base}/put/u${i}?X-Amz-Signature=s`, headers: { 'content-type': 'image/png' } })) }];
    }
    if (call.url.pathname.startsWith('/put/')) return [200, {}];
    if (call.url.pathname === '/files/a.mp4') return [200, Buffer.from('mp4'), 'video/mp4'];
    return [200, { files: [{ path: 'assets/video/a.mp4', url: `${base}/files/a.mp4?X-Tos-Signature=s`, type: 'video/mp4' }], index: [], receipt: { dur: 5 } }];
  };
  const result = await openfilm.run('video', { prompt: 'a cat', 'first-frame': 'assets/image/cat.png', out: 'cat.mp4' }, ctx({ 'assets/image/cat.png': frame }, 'volcengine/doubao-seedance-2-0-fast-260128'));
  const [asked, put, run, fetched] = seen;
  assert.deepEqual(JSON.parse(asked.body), { files: [{ path: 'assets/image/cat.png', bytes: 3 }] }, 'only its name and size');
  assert.equal(asked.headers.authorization, `Bearer ${KEY}`);
  assert.equal(put.method, 'PUT');
  assert.equal(put.headers.authorization, undefined, 'a signed address: no key goes with it');
  assert.equal(put.headers['content-type'], 'image/png');
  assert.deepEqual([...Buffer.from(put.body)], [1, 2, 3]);
  const body = JSON.parse(run.body);
  assert.deepEqual(body.inputs, [{ path: 'assets/image/cat.png', upload: 'u0/cat.png' }], 'the run names the upload, not the bytes');
  assert.equal(body.results, 'links');
  assert.equal(fetched.url.pathname, '/files/a.mp4');
  assert.equal(fetched.headers.authorization, undefined);
  assert.equal(Buffer.from(result.files[0].bytes).toString(), 'mp4');
});

test('an unreadable reference is reported locally instead of submitting an incomplete run', async () => {
  seen.length = 0;
  const video = 'assets/Weixin Videos 01.mp4';
  await assert.rejects(openfilm.run('video', { prompt: 'Make a clip', video, out: 'scene' }, ctx()), /no assets\/Weixin Videos 01\.mp4/);
  assert.equal(seen.length, 0);
});

test('voices are listed with the voice-over model; with no model chosen, the service uses its default', async () => {
  seen.length = 0;
  reply = () => [200, { files: [], index: [], receipt: { voices: [] } }];
  await openfilm.run('voice', { language: 'en' }, ctx({}, 'elevenlabs/eleven_v4'));
  await openfilm.run('image', { prompt: 'x' }, ctx({}));
  assert.equal(JSON.parse(seen[0].body).model, 'elevenlabs/eleven_v4');
  assert.equal(JSON.parse(seen[1].body).model, undefined);
});

test('an account out of credits is out of balance, like any provider; a refused key says so', async () => {
  reply = () => [402, { error: 'insufficient_credits', message: 'Not enough credits.' }];
  await assert.rejects(openfilm.run('tts', { text: 'hi', voice: 'v' }, ctx()), (e) => e.code === 'balance');
  reply = () => [401, { message: 'Invalid key' }];
  await assert.rejects(openfilm.run('tts', { text: 'hi', voice: 'v' }, ctx()), /OpenFilm did not accept your key/);
  assert.throws(() => openfilm.checkKey('sk-123'), /ofk_/);
});

test('a release restarting the service mid-run: said again through its gateway\'s 502, posted again with the same key when it forgot the run, waited for while it counts it as running', async () => {
  seen.length = 0;
  const done = [200, { files: [{ path: 'assets/video/b.mp4', base64: Buffer.from('mp4').toString('base64'), bytes: 3 }], index: [], receipt: {} }];
  const script = [
    [202, { status: 'running' }], // POST
    [502, {}], // the gateway, while the service restarts
    [404, { error: 'unknown_run' }], // the new process does not know it
    [409, { error: 'in_progress' }], // posted again: the old one still counts as running
    [202, { status: 'running' }], // posted again: run anew
    done,
  ];
  reply = () => script.shift() ?? done;
  const result = await openfilm.run('video', { prompt: 'a cat', out: 'b.mp4' }, ctx({}, 'volcengine/doubao-seedance-2-0-mini-260615'));
  assert.equal(Buffer.from(result.files[0].bytes).toString(), 'mp4');
  assert.deepEqual(seen.map((c) => c.method), ['POST', 'GET', 'GET', 'POST', 'POST', 'GET']);
  /* every post the same run, so it is never charged twice */
  assert.equal(new Set(seen.filter((c) => c.method === 'POST').map((c) => c.headers['idempotency-key'])).size, 1);
});

test('a service that stays away is said so once its patience is spent', async () => {
  const was = polling.patience;
  polling.patience = 30;
  reply = () => [502, {}];
  try { await assert.rejects(openfilm.run('video', { prompt: 'a cat', out: 'c.mp4' }, ctx({}, 'volcengine/doubao-seedance-2-0-mini-260615')), /not answering right now \(502\)/); }
  finally { polling.patience = was; }
});
