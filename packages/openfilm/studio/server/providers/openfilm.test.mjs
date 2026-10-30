import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import openfilm, { polling } from './openfilm.mjs';
import elevenlabs from './elevenlabs.mjs';
import openai from './openai.mjs';
import google from './google.mjs';
import fal from './fal.mjs';
import pexels from './pexels.mjs';
import tavily from './tavily.mjs';

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

test('each model is one its provider has, for the same kind of media', () => {
  const by = Object.fromEntries([elevenlabs, openai, google, fal, pexels, tavily].map((p) => [p.id, p]));
  for (const [verb, models] of Object.entries(openfilm.models)) {
    for (const { id } of models) {
      const at = id.indexOf('/');
      const provider = by[id.slice(0, at)];
      assert.ok(provider, `${id}: no provider`);
      assert.ok(provider.models[verb]?.some((m) => m.id === id.slice(at + 1)), `${id}: ${provider.name} has no such ${verb} model`);
    }
  }
  assert.deepEqual(new Set(openfilm.verbs), new Set([...Object.keys(openfilm.models), 'voice', 'web-fetch']));
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
  const result = await openfilm.run('video', { prompt: 'a cat. on a mat', 'first-frame': 'assets/image/cat.png', out: 'cat.mp4' }, ctx({ 'assets/image/cat.png': frame }, 'fal/seedance-2.0'));
  const posted = seen[0];
  assert.equal(posted.url.pathname, '/v1/media/run');
  assert.equal(posted.headers.authorization, `Bearer ${KEY}`);
  assert.match(posted.headers.prefer, /respond-async/);
  const body = JSON.parse(posted.body);
  assert.equal(body.verb, 'video');
  assert.equal(body.model, 'fal/seedance-2.0');
  assert.deepEqual(body.inputs, [{ path: 'assets/image/cat.png', base64: Buffer.from(frame).toString('base64') }]);
  assert.equal(seen[1].url.searchParams.get('key'), posted.headers['idempotency-key']);
  assert.equal(Buffer.from(result.files[0].bytes).toString(), 'mp4');
  assert.equal(result.index[0].dur, 5);
});

test('voices are listed with the voice-over model; a model not chosen is the first', async () => {
  seen.length = 0;
  reply = () => [200, { files: [], index: [], receipt: { voices: [] } }];
  await openfilm.run('voice', { language: 'en' }, ctx({}, 'elevenlabs/eleven_v4'));
  await openfilm.run('image', { prompt: 'x' }, ctx({}));
  assert.equal(JSON.parse(seen[0].body).model, 'elevenlabs/eleven_v4');
  assert.equal(JSON.parse(seen[1].body).model, openfilm.models.image[0].id);
});

test('an account out of credits is out of balance, like any provider; a refused key says so', async () => {
  reply = () => [402, { error: 'insufficient_credits', message: 'Not enough credits.' }];
  await assert.rejects(openfilm.run('tts', { text: 'hi', voice: 'v' }, ctx()), (e) => e.code === 'balance');
  reply = () => [401, { message: 'Invalid key' }];
  await assert.rejects(openfilm.run('tts', { text: 'hi', voice: 'v' }, ctx()), /OpenFilm did not accept your key/);
  assert.throws(() => openfilm.checkKey('sk-123'), /ofk_/);
});
