import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import openfilm, { polling } from './openfilm.mjs';

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
    const [status, body] = await reply(call);
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  process.env.OPENFILM_API_URL = `http://127.0.0.1:${server.address().port}`;
  polling.ms = 5;
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
    video: [{ id: 'openrouter/bytedance/seedance-2.0-fast', name: 'Seedance 2.0 Fast' }, { id: 7 }],
    translate: [{ id: 'x/y', name: 'not a kind of media it offers' }],
  } }] : [404, {}]);
  await openfilm.refresh();
  assert.equal(seen[0].headers.authorization, undefined, 'no key: what it offers is no secret');
  assert.deepEqual(openfilm.verbs, ['tts', 'voice', 'video']);
  /* what a model makes is what the provider it is run at says */
  assert.deepEqual(openfilm.models.video, [{ id: 'openrouter/bytedance/seedance-2.0-fast', name: 'Seedance 2.0 Fast',
    spec: { ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], seconds: [4, 15], refs: 9, frames: true, voice: true, clip: true, sizes: ['480p', '720p'] } }]);
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

test('a run: posted with the key, the files it names, async; asked after until done', async () => {
  seen.length = 0;
  let asks = 0;
  reply = (call) => {
    if (call.method === 'POST') return [202, { status: 'running', idempotency_key: call.headers['idempotency-key'] }];
    asks += 1;
    if (asks < 2) return [202, { status: 'running' }];
    return [200, { files: [{ path: 'assets/video/a.mp4', base64: Buffer.from('mp4').toString('base64'), bytes: 3 }], index: [{ src: 'assets/video/a.mp4', kind: 'video', dur: 5 }], receipt: { dur: 5 } }];
  };
  const frame = new Uint8Array([1, 2, 3]);
  const result = await openfilm.run('video', { prompt: 'a cat. on a mat', 'first-frame': 'assets/image/cat.png', out: 'cat.mp4' }, ctx({ 'assets/image/cat.png': frame }, 'openrouter/bytedance/seedance-2.0'));
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
