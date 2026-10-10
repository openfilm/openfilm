import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filmCaptions, translateFilmSubtitles } from './captions.mjs';
import { readTranscript } from './transcripts.mjs';
import { SERVICES, VERBS, WEB_VERBS, WHERE_TO_CONNECT, flagHelp, runGet, subtitleTranslator } from './get.mjs';
import { changeSettings, providersFile } from './keys.mjs';
import { listProviders } from './providers/index.mjs';
import { startStudio } from './server.mjs';
import { filmHtml } from '../../src/film-doc.mjs';

/**
 * A fake OpenFilm service on 127.0.0.1: minting and raising agent keys (with the account's token), and `/v1/media/*`
 * answering what each test puts in `answers` (one per run call, in order). `calls` records every request.
 */
let service, base, scratch;
const calls = [];
let answers = [];
/** Runs answered 202: what each one's result fetch answers, by Idempotency-Key. */
const pending = new Map();
let minted = 0;

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'of-get-'));
  service = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : null;
    const call = { path: req.url, auth: req.headers.authorization, idem: req.headers['idempotency-key'], prefer: req.headers.prefer, body };
    calls.push(call);
    const send = (status, value) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    if (req.url === '/api/desktop/agent-key') {
      if (call.auth !== 'Bearer account-token') return send(401, { error: 'unauthorized' });
      minted += 1;
      return send(200, { id: `k${minted}`, token: `ask_${minted}`, label: body.label, cap: 500, expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    }
    if (req.url.startsWith('/api/desktop/agent-key/')) return send(200, { id: req.url.split('/').pop(), spent: 480, cap: 480 + body.add });
    if (req.url === '/v1/media/quote') return send(200, { quote: { command: body.command, credits: 240, basis: '5s of generated video' }, budget: null });
    if (req.url.startsWith('/v1/media/run?key=')) {
      const next = pending.get(decodeURIComponent(req.url.split('=')[1]));
      return next ? next(call, send) : send(404, { error: 'unknown_run' });
    }
    if (req.url === '/v1/media/run') {
      if (!call.idem) return send(400, { message: 'Idempotency-Key header is required' });
      const next = answers.shift();
      if (!next) return send(500, { error: 'no answer set' });
      return typeof next === 'function' ? next(call, send) : send(next.status ?? 200, next.body);
    }
    send(404, {});
  });
  await new Promise((done) => service.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${service.address().port}`;
  Object.assign(process.env, {
    OPENFILM_HOME: join(scratch, 'home'), OPENFILM_LIBRARY: join(scratch, 'library'),
    OPENFILM_ACCOUNT_URL: base, OPENFILM_POLL_MS: '20', OPENFILM_ACCOUNT_ISSUER: base, OPENFILM_ACCOUNT_CLIENT_ID: 'test-client',
  });
  for (const p of [...listProviders(), { env: 'OPENFILM_API_KEY' }, { env: 'GOOGLE_API_KEY' }]) delete process.env[p.env];
});
after(() => service.close());

/** The account connected on this machine, with a token that is good for an hour. */
function connect() {
  mkdirSync(process.env.OPENFILM_HOME, { recursive: true });
  writeFileSync(join(process.env.OPENFILM_HOME, 'account.json'), JSON.stringify({
    issuer: base, clientId: 'test-client', access_token: 'account-token', refresh_token: 'refresh', expiresAt: Date.now() + 3_600_000,
  }), { mode: 0o600 });
}
beforeEach(() => { calls.length = 0; answers = []; pending.clear(); connect(); rmSync(providersFile(), { force: true }); });

let projects = 0;
function project(film = { stage: { w: 1920, h: 1080 }, tracks: [] }) {
  const root = join(scratch, `p${++projects}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'film.html'), filmHtml(film));
  return root;
}
const runs = () => calls.filter((c) => c.path === '/v1/media/run');
const b64 = (text) => Buffer.from(text).toString('base64');

const SAID = 'Hello there. How are you?';
const WORDS = [{ token: 'Hello', start: 0, end: 0.4 }, { token: 'there.', start: 0.45, end: 0.9 }, { token: 'How', start: 1.8, end: 2 }, { token: 'are', start: 2.05, end: 2.2 }, { token: 'you?', start: 2.25, end: 2.6 }];
const TTS = {
  receipt: { src: 'assets/audio/vo/intro.mp3', dur: 2.8, voiceId: 'v-1', costUsd: 0.01 },
  files: [{ path: 'assets/audio/vo/intro.mp3', base64: b64('mp3 bytes'), bytes: 9 }],
  index: [{ src: 'assets/audio/vo/intro.mp3', kind: 'audio', dur: 2.8, text: SAID, words: WORDS, role: 'host', voiceId: 'v-1', from: { mode: 'synth', voice: 'v-1' } }],
  credits: { quoted: 3, charged: 2, metered: 2, refunded: 1, cost: 0.01 }, budget: { spent: 2, cap: 500 }, balance: 98, idempotent_replay: false,
};

test('tts: the file lands, its timed words a WebVTT beside it, and the receipt says what landed, not what it cost', async () => {
  const root = project();
  answers.push({ body: TTS });
  const text = await runGet(root, 'tts', { out: 'intro', text: SAID, voice: 'v-1' });
  const receipt = JSON.parse(text);
  assert.deepEqual(receipt, { src: 'assets/audio/vo/intro.mp3', dur: 2.8, voiceId: 'v-1', transcript: 'assets/audio/vo/intro.vtt' });
  assert.equal(readFileSync(join(root, 'assets/audio/vo/intro.mp3'), 'utf8'), 'mp3 bytes');

  const [mint, run] = calls;
  assert.equal(mint.path, '/api/desktop/agent-key');
  assert.equal(run.auth, 'Bearer ask_1');
  assert.ok(run.idem);
  assert.deepEqual(run.body, { command: 'audio tts', args: { out: 'intro', text: SAID, voice: 'v-1' }, inputs: [], context: { contentLocale: 'en-US' }, model: 'inworld-tts-2-flash' });

  assert.match(readFileSync(join(root, 'assets/audio/vo/intro.vtt'), 'utf8'), /00:00:01\.800 --> 00:00:02\.800\nHow <00:00:02\.050>are <00:00:02\.250>you\?/);
  const transcript = await readTranscript(root, 'assets/audio/vo/intro.mp3');
  assert.deepEqual(transcript.lines.map((l) => l.text), ['Hello there.', 'How are you?']);
  assert.ok(!existsSync(join(root, 'assets/index.jsonl')), 'no ledger');

  /* a service that does not time the words: no transcript, and the receipt says how to get one */
  answers.push({ body: { ...TTS, index: [{ ...TTS.index[0], src: 'assets/audio/vo/two.mp3', words: undefined }], files: [{ ...TTS.files[0], path: 'assets/audio/vo/two.mp3' }], receipt: { ...TTS.receipt, src: 'assets/audio/vo/two.mp3' } } });
  const untimed = JSON.parse(await runGet(root, 'tts', { out: 'two', text: SAID, voice: 'v-1' }));
  assert.match(untimed.transcript, /^none: .*get asr/);
  assert.ok(!existsSync(join(root, 'assets/audio/vo/two.vtt')));

  /* the agent key is kept: the next call mints none */
  answers.push({ body: { ...TTS, index: [], files: [], receipt: { results: [] } } });
  await runGet(root, 'voice', {});
  assert.equal(calls.filter((c) => c.path === '/api/desktop/agent-key').length, 1);
  assert.deepEqual(runs().at(-1).body.args, { limit: '5' });
});

test('a file is never written through a link the project brings under assets/', { skip: process.platform === 'win32' }, async () => {
  const root = project();
  const elsewhere = mkdtempSync(join(tmpdir(), 'of-elsewhere-'));
  mkdirSync(join(root, 'assets'), { recursive: true });
  symlinkSync(elsewhere, join(root, 'assets/audio'));
  answers.push({ body: TTS });
  await runGet(root, 'tts', { out: 'intro', text: SAID, voice: 'v-1' }).catch(() => {});
  assert.ok(!existsSync(join(elsewhere, 'vo/intro.mp3')), 'nothing landed outside the project');
});

test('wrong options are refused before anything is sent (exit 2)', async () => {
  const root = project();
  writeFileSync(join(root, 'note.txt'), 'x');
  const refused = async (verb, args, pattern) => {
    await assert.rejects(runGet(root, verb, args), (e) => e.code === 2 && pattern.test(e.message));
  };
  await refused('tts', { out: 'intro', text: 'hi' }, /needs --voice <voiceId>/);
  await refused('tts', { out: 'vo/intro', text: 'hi', voice: 'v' }, /--out is a simple name/);
  await refused('tts', { out: 'intro.mp3', text: 'hi', voice: 'v' }, /--out is a simple name/);
  await refused('tts', { out: 'intro', text: 'hi', voice: 'v', speed: '2' }, /tts has no --speed/);
  await refused('sfx', { out: 'ding', prompt: 'a chime', sec: '40' }, /--sec is a number from 0.5 to 22/);
  await refused('image', { out: 'hero', prompt: 'a key', ratio: '5:4' }, /--ratio is one of/);
  await refused('asr', { src: '../elsewhere.wav' }, /not a path inside the project/);
  await refused('asr', { src: 'missing.wav' }, /not in the project/);
  await refused('asr', { src: 'note.txt' }, /wants a sound or video file/);
  await refused('video', { out: 'shot', prompt: 'p', 'last-frame': 'note.txt' }, /wants a picture/);
  await refused('dance', {}, /there is no dance/);
  assert.equal(runs().length, 0);
});

test('a long run answers at once and its result is fetched until it is there (the proxy drops a request after 100 s)', async () => {
  const root = project();
  let asked = 0;
  answers.push((call, send) => {
    assert.equal(call.prefer, 'respond-async');
    pending.set(call.idem, (_poll, reply) => (++asked < 3 ? reply(202, { status: 'running' }) : reply(200, TTS)));
    send(202, { status: 'running', idempotency_key: call.idem });
  });
  const receipt = JSON.parse(await runGet(root, 'tts', { out: 'intro', text: SAID, voice: 'v-1' }));
  assert.equal(receipt.src, 'assets/audio/vo/intro.mp3');
  assert.equal(asked, 3);
  const polls = calls.filter((c) => c.path.startsWith('/v1/media/run?key='));
  assert.deepEqual(polls.map((c) => [c.path, c.auth]), Array(3).fill([`/v1/media/run?key=${encodeURIComponent(runs()[0].idem)}`, 'Bearer ask_1']));

  /* the service restarted mid-run and forgot it: the same call again, with the same key */
  answers.push((call, send) => send(202, { status: 'running' }), { body: TTS });
  await runGet(root, 'tts', { out: 'intro', text: SAID, voice: 'v-1' });
  const [first, again] = runs().slice(-2);
  assert.equal(first.idem, again.idem);
});

test('not enough balance: the agent is told to stop and where the person tops it up, the person is told in Studio, nothing landed', async () => {
  const root = project();
  answers.push({ status: 402, body: { error: 'insufficient_credits', message: 'Not enough credits', balance: 3, needed: 12 } });
  const told = [];
  const asked = [];
  await assert.rejects(runGet(root, 'music', { out: 'bed', prompt: 'calm pad', sec: '30' }, { tell: (n) => told.push(n), ask: async (s) => { asked.push(s); return 'allow'; } }), {
    message: `This did not run: OpenFilm doesn't have enough balance. The person can top it up at ${base}/account, or switch to another service. `
      + 'Nothing was made. Stop and tell them; do not run it again until they say so.',
  });
  assert.deepEqual(told, [{ kind: 'balance', provider: 'OpenFilm', providerId: 'openfilm' }]);
  assert.deepEqual(asked, [], 'nothing to allow: only the account can be topped up');
  assert.equal(runs().length, 1, 'not tried again');
  assert.ok(!existsSync(join(root, 'assets')));
  assert.equal(runs()[0].body.args.sec, '30');
});

test('the daily spending limit the person set: its own outcome, told like an empty balance, with where to change it', async () => {
  const root = project();
  answers.push({ status: 402, body: { error: 'daily_limit', message: 'The OpenFilm account has reached its daily spending limit. Change it at openfilm.dev/account.' } });
  const told = [];
  await assert.rejects(runGet(root, 'sfx', { out: 'ding', prompt: 'a chime' }, { tell: (n) => told.push(n) }), {
    message: `This did not run: the OpenFilm account reached its daily spending limit. The person can change it at ${base}/account, or switch to another service. `
      + 'Nothing was made. Stop and tell them; do not run it again until they say so.',
  });
  assert.deepEqual(told, [{ kind: 'daily-limit', provider: 'OpenFilm', providerId: 'openfilm' }]);
  assert.equal(runs().length, 1, 'not tried again');
  assert.ok(!existsSync(join(root, 'assets')));
});

test('the model: the person\'s choice for each kind of media, voices with voice-over\'s, --model (or an older --tier) for one run', async () => {
  const root = project();
  await changeSettings((s) => { s.model = { tts: 'cartesia-sonic-3.6', music: 'elevenlabs-music-v2' }; });
  const result = { body: { ...TTS, receipt: {}, files: [], index: [] } };
  const modelOf = async (verb, args, options) => {
    answers.push(result);
    await runGet(root, verb, args, options);
    return runs().at(-1).body.model;
  };
  assert.equal(await modelOf('tts', { out: 'intro', text: SAID, voice: 'v-1' }), 'cartesia-sonic-3.6');
  assert.equal(await modelOf('voice', {}), 'cartesia-sonic-3.6', 'voices are found with the model that speaks them');
  assert.equal(await modelOf('music', { out: 'bed', prompt: 'calm pad' }), 'elevenlabs-music-v2');
  assert.equal(await modelOf('sfx', { out: 'ding', prompt: 'a chime' }), 'library-sfx', 'the first, the cheapest');
  assert.equal(await modelOf('music', { out: 'bed', prompt: 'calm pad' }, { model: 'library-music' }), 'library-music');
  assert.equal(await modelOf('voice', {}, { tier: 'ultra' }), 'elevenlabs-v4', 'an older agent\'s tier is the model it made');
  await assert.rejects(runGet(root, 'sfx', { out: 'ding', prompt: 'a chime' }, { model: 'seedance-2.5' }), (e) => e.code === 2 && /--model is one of library-sfx, elevenlabs-sfx/.test(e.message));
  await assert.rejects(runGet(root, 'sfx', { out: 'ding', prompt: 'a chime' }, { tier: 'max' }), (e) => e.code === 2 && /--tier is one of flash, pro, ultra/.test(e.message));
});

test('a model the account cannot use: said plainly, without its plan', async () => {
  const root = project();
  answers.push({ status: 403, body: { error: 'tier_not_allowed', message: 'GPT Image 2.5 Sunburst needs a paid plan. Use GPT Image 2.5 Flare, or upgrade the plan.' } });
  await assert.rejects(runGet(root, 'image', { out: 'hero', prompt: 'a key' }, { model: 'gpt-image-2.5-sunburst' }), {
    message: `This did not run: the OpenFilm account can’t use this model. Try another (--model), or the person can manage the account at ${new URL(base).host}/account. Nothing was charged.`,
  });
  assert.equal(runs()[0].body.model, 'gpt-image-2.5-sunburst');
});

test('video: the person confirms what will be made first, without amounts; no page means ask them and run again with --yes', async () => {
  const root = project();
  writeFileSync(join(root, 'first.png'), 'png');
  const clip = { body: { ...TTS, receipt: { src: 'assets/video/shot.mp4', dur: 5 }, files: [{ path: 'assets/video/shot.mp4', base64: b64('mp4') }], index: [{ src: 'assets/video/shot.mp4', kind: 'video', dur: 5 }] } };
  const args = { out: 'shot', prompt: 'a slow push into a glowing triangle', 'first-frame': 'first.png' };

  await assert.rejects(runGet(root, 'video', args, { ask: async () => null }), (e) => e.code === 1 && /expensive.*--yes/.test(e.message) && !/credit|\d/.test(e.message.replace('--yes', '')));
  assert.equal(runs().length, 0, 'nothing made');

  const asked = [];
  answers.push(clip);
  await runGet(root, 'video', args, { ask: async (spend) => { asked.push(spend); return 'allow'; } });
  assert.deepEqual(asked, [{ kind: 'video', provider: 'OpenFilm', model: 'Seedance 2.0 Mini', seconds: 5, prompt: args.prompt }]);
  assert.deepEqual(runs()[0].body.inputs, [{ path: 'first.png', base64: b64('png') }]);
  assert.equal(runs()[0].body.args.duration, '5');

  await assert.rejects(runGet(root, 'video', args, { ask: async () => 'deny' }), /chose not to make this video clip/);
  calls.length = 0;
  answers.push(clip);
  await runGet(root, 'video', args, { yes: true });
  assert.deepEqual(calls.map((c) => c.path), ['/v1/media/run'], 'with --yes: no quote, no question');
});

test('asr: the speech alone is sent, its transcript lands beside the recording, and is not made twice', async () => {
  const root = project();
  mkdirSync(join(root, 'assets/upload'), { recursive: true });
  const wav = join(root, 'assets/upload/talk.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=48000', '-ac', '2', wav]);
  const heard = (call, send) => {
    const [input] = call.body.inputs;
    const proxy = Buffer.from(input.base64, 'base64');
    assert.equal(input.path, 'assets/upload/talk.wav');
    assert.equal(proxy.readUInt16LE(22), 1, 'mono');
    assert.equal(proxy.readUInt32LE(24), 16000, '16 kHz');
    send(200, { ...TTS, receipt: { asr: 'assets/upload/talk.wav', dur: 1, text: 'One two.' }, files: [],
      index: [{ src: 'assets/upload/talk.wav', kind: 'audio', bytes: proxy.length, dur: 1.01, text: 'One two.', transcribed: true, words: [{ token: 'One', start: 0.1, end: 0.4 }, { token: 'two.', start: 0.5, end: 0.9 }] }] });
  };
  answers.push(heard);
  const receipt = JSON.parse(await runGet(root, 'asr', { src: 'assets/upload/talk.wav' }));
  assert.deepEqual(receipt, { src: 'assets/upload/talk.wav', dur: 1, text: 'One two.', transcript: 'assets/upload/talk.vtt' });
  assert.match(readFileSync(join(root, 'assets/upload/talk.vtt'), 'utf8'), /^WEBVTT\n\n00:00:00\.100 --> .*\nOne <00:00:00\.500>two\./);

  const again = JSON.parse(await runGet(root, 'asr', { src: 'assets/upload/talk.wav' }));
  assert.equal(again.skip, true);
  assert.equal(again.text, 'One two.');
  assert.equal(runs().length, 1, 'transcribed once');
  answers.push(heard);
  await runGet(root, 'asr', { src: 'assets/upload/talk.wav', force: true });
  assert.equal(runs().length, 2, '--force transcribes again');
});

test('what lands stays in assets/: no file outside it', async () => {
  const root = project();
  answers.push({ body: { ...TTS, receipt: { images: [] }, files: [
    { path: '../escape.txt', base64: b64('x') }, { path: 'assets/../../escape2.txt', base64: b64('x') }, { path: 'film.html', base64: b64('{}') },
    { path: '/tmp/abs.txt', base64: b64('x') }, { path: 'assets/image/ok.png', base64: b64('png') },
  ], index: [{ src: '../escape.txt', kind: 'file' }] } });
  const text = await runGet(root, 'image', { out: 'ok', prompt: 'a key' });
  assert.ok(existsSync(join(root, 'assets/image/ok.png')));
  assert.ok(!existsSync(join(scratch, 'escape.txt')) && !existsSync(join(root, '..', 'escape2.txt')));
  assert.notEqual(readFileSync(join(root, 'film.html'), 'utf8'), '{}');
  assert.ok(JSON.parse(text));
});

test('subtitles translate through the account: each line gets the line that starts with it, kept beside the transcript', async () => {
  const root = project({ stage: { w: 1920, h: 1080 }, tracks: [{ clips: [{ id: 'vo', src: 'assets/audio/vo/intro.mp3' }] }] });
  answers.push({ body: TTS });
  await runGet(root, 'tts', { out: 'intro', text: SAID, voice: 'v-1' });
  answers.push((call, send) => {
    const input = JSON.parse(Buffer.from(call.body.inputs[0].base64, 'base64').toString('utf8'));
    assert.equal(call.body.inputs[0].path, 'assets/data/translate/audio/vo/intro.mp3.speech.json');
    assert.deepEqual(call.body.args, { src: 'assets/audio/vo/intro.mp3', to: 'fr' });
    assert.equal(input.text, SAID);
    assert.equal(input.words.length, 5);
    send(200, { ...TTS, receipt: { lines: 2 }, files: [], index: [{ src: 'assets/audio/vo/intro.mp3', translations: { fr: [
      { startSec: 0, endSec: 1.6, text: 'Bonjour.' }, { startSec: 1.8, endSec: 2.8, text: 'Comment ça va ?' },
    ] } }] });
  });
  const translate = await subtitleTranslator(root);
  const result = await translateFilmSubtitles(root, 'fr', { translate });
  assert.deepEqual(result, { language: 'fr', translated: ['assets/audio/vo/intro.mp3'], already: 0, same: 0, failed: [] });
  const { cues, languages } = await filmCaptions(root, { duration: async () => 2.8 });
  assert.deepEqual(languages, ['fr']);
  assert.deepEqual(cues.map((c) => [c.text, c.alt?.fr]), [['Hello there.', 'Bonjour.'], ['How are you?', 'Comment ça va ?']]);
  assert.ok(existsSync(join(root, 'assets/audio/vo/intro.fr.vtt')));

  /* no account and no key: nothing can translate, and the route says to connect one */
  rmSync(join(process.env.OPENFILM_HOME, 'account.json'));
  assert.equal(await subtitleTranslator(root), null);
});

test('Studio: GET /api/get lists what can be got, never who makes it; a video run asks the page showing the project', async () => {
  const studio = await startStudio({ port: 0, openBrowser: () => {}, quietMs: 150 });
  try {
    const api = (path, init = {}) => fetch(`${studio.origin}${path}`, { ...init, headers: { 'x-studio-key': studio.key, 'content-type': 'application/json', ...init.headers } });
    const { verbs, note } = await (await api('/api/get')).json();
    const media = Object.entries(VERBS).filter(([verb]) => !WEB_VERBS.includes(verb));
    assert.deepEqual(verbs.map((v) => Object.keys(v)), media.map(([, spec]) => ['verb', 'help', ...(spec.dir ? ['dir'] : []), 'options']));
    assert.equal(note, null);
    /* web search and web pages, for an agent without its own */
    assert.deepEqual((await (await api('/api/get?web=1')).json()).verbs.map((v) => v.verb), Object.keys(VERBS));
    assert.equal(verbs.find((v) => v.verb === 'tts').options.out.required, true);
    assert.equal((await api('/api/get?verb=dance')).status, 400);


    const { project: opened } = await (await api('/api/projects', { method: 'POST', body: JSON.stringify({ path: join(scratch, 'Shown') }) })).json();
    const stream = new WebSocket(`${studio.origin.replace(/^http/, 'ws')}/api/projects/${opened.id}/events`, { headers: { 'x-studio-key': studio.key } });
    const seen = [];
    const waiting = new Set();
    stream.onmessage = (e) => { seen.push(JSON.parse(String(e.data))); for (const check of [...waiting]) check(); };
    await new Promise((r) => { stream.onopen = r; });
    const next = (type) => new Promise((done) => {
      const check = () => { const found = seen.find((e) => e.type === type); if (found) { waiting.delete(check); done(found); } };
      waiting.add(check);
      check();
    });
    answers.push({ body: { ...TTS, receipt: { src: 'assets/video/shot.mp4', dur: 5 }, files: [{ path: 'assets/video/shot.mp4', base64: b64('mp4') }], index: [] } });
    const running = api('/api/get', { method: 'POST', body: JSON.stringify({ folder: opened.path, verb: 'video', args: { out: 'shot', prompt: 'p' } }) }).then((r) => r.json());
    const { ask } = await next('ask');
    assert.deepEqual([ask.kind, ask.model, 'credits' in ask], ['video', 'Seedance 2.0 Mini', false]);
    assert.deepEqual(await (await api(`/api/get/asks/${ask.id}`, { method: 'POST', body: JSON.stringify({ allow: true }) })).json(), { answered: true });
    assert.equal((await next('asked')).id, ask.id);
    const answer = await running;
    assert.equal(answer.ok, true);
    assert.equal(JSON.parse(answer.text).src, 'assets/video/shot.mp4');

    /* no balance: the page is told, with the provider to top up, and nothing waits for an answer */
    answers.push({ status: 402, body: { error: 'insufficient_credits' } });
    const failed = await (await api('/api/get', { method: 'POST', body: JSON.stringify({ folder: opened.path, verb: 'sfx', args: { out: 'ding', prompt: 'a chime' } }) })).json();
    assert.deepEqual([failed.ok, failed.code], [false, 1]);
    assert.match(failed.text, /OpenFilm doesn't have enough balance/);
    const { notice } = await next('notice');
    assert.deepEqual({ ...notice, id: typeof notice.id }, { id: 'string', kind: 'balance', provider: 'OpenFilm', providerId: 'openfilm' });
    stream.close();

    const notProject = await (await api('/api/get', { method: 'POST', body: JSON.stringify({ folder: scratch, verb: 'tts', args: {} }) })).json();
    assert.deepEqual([notProject.ok, notProject.code], [false, 2]);
    assert.equal((await api('/api/get', { headers: { 'x-studio-key': 'wrong' } })).status, 401);
  } finally {
    await studio.close();
  }
});

const freePort = () => new Promise((done) => { const probe = netServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => done(port)); }); });

test('openfilm get: what can be got here, connected, partly or not at all; wrong commands exit 2', { timeout: 60_000 }, async () => {
  const bin = fileURLToPath(new URL('../../bin/openfilm.mjs', import.meta.url));
  const env = { ...process.env, OPENFILM_STUDIO_PORT: String(await freePort()) };
  const get = (cwd, ...args) => spawnSync(process.execPath, [bin, 'get', ...args], { cwd, env, encoding: 'utf8' });
  const run = (cwd, ...args) => new Promise((done) => execFile(process.execPath, [bin, 'get', ...args], { cwd, env, encoding: 'utf8' }, (error, stdout) => done({ status: error?.code ?? 0, stdout })));
  const root = project();
  /* the listing as the CLI prints it: the verbs' names padded to the longest shown */
  const listing = (verbs, width = Math.max(...verbs.map((v) => v.length))) => [
    'openfilm get <what> [--option value …]   media for this project, saved under assets/',
    '  --yes              the person already agreed to what it spends',
    '',
    ...verbs.flatMap((verb) => {
      const spec = VERBS[verb];
      return [`  ${verb.padEnd(width)}  ${spec.help}${spec.dir ? ` Saved under ${spec.dir}/.` : ''}`,
        `${' '.repeat(width + 4)}${Object.entries(spec.options).map(([n, o]) => flagHelp(n, o)).join(' ')}`];
    }),
  ];
  try {
    /* everything connected: the verbs, and nothing else */
    const listed = get(scratch);
    assert.equal(listed.status, 0, listed.stderr);
    const media = Object.keys(VERBS).filter((verb) => !WEB_VERBS.includes(verb));
    assert.equal(listed.stdout, `${[...listing(media), '', SERVICES].join('\n')}\n`);
    const one = get(root, 'image', '--help');
    assert.equal(one.status, 0);
    assert.match(one.stdout, /--ratio <16:9\|9:16/);
    assert.doesNotMatch(one.stdout, /--voice/);

    /* --model: this run with another model than the person's choice; an older agent's --tier is the model it made */
    answers.push({ body: { ...TTS, receipt: { src: 'assets/audio/sfx/ding.mp3', dur: 0.9 }, files: [], index: [] } });
    const modelled = await run(root, 'sfx', '--model', 'elevenlabs-sfx', '--out', 'ding', '--prompt', 'a chime');
    assert.equal(modelled.status, 0, modelled.stdout);
    assert.equal(runs().at(-1).body.model, 'elevenlabs-sfx');

    /* web search and web pages: listed for an agent without its own (OPENFILM_GET_WEB=1), run like any other media */
    const withWeb = spawnSync(process.execPath, [bin, 'get'], { cwd: scratch, env: { ...env, OPENFILM_GET_WEB: '1' }, encoding: 'utf8' });
    assert.equal(withWeb.stdout, `${[...listing(Object.keys(VERBS)), '', SERVICES].join('\n')}\n`);
    answers.push({ body: { ...TTS, receipt: { query: 'blender', hits: [{ title: 'Blender', url: 'https://www.blender.org', excerpt: '5.2' }] }, files: [], index: [] } });
    const searched = await run(root, 'web-search', '--query', 'blender');
    assert.equal(searched.status, 0, searched.stdout);
    assert.equal(JSON.parse(searched.stdout).hits[0].url, 'https://www.blender.org');
    assert.deepEqual([runs().at(-1).body.command, runs().at(-1).body.model, runs().at(-1).body.args], ['web search', 'web-search', { query: ['blender'] }]);
    answers.push({ body: { ...TTS, receipt: { src: 'assets/fetch/blender.md', title: 'Blender' }, files: [{ path: 'assets/fetch/blender.md', base64: b64('# Blender') }], index: [] } });
    const read = await run(root, 'web-fetch', '--url', 'https://www.blender.org');
    assert.equal(read.status, 0, read.stdout);
    assert.deepEqual([runs().at(-1).body.command, runs().at(-1).body.model], ['web fetch', undefined], 'reading a page takes no model');
    assert.equal(readFileSync(join(root, 'assets/fetch/blender.md'), 'utf8'), '# Blender');

    /* nothing connected: no verbs, what to do instead */
    rmSync(join(process.env.OPENFILM_HOME, 'account.json'));
    const nothing = get(scratch);
    assert.equal(nothing.status, 0);
    assert.equal(nothing.stdout, 'Nothing is connected for media here. '
      + 'Until then, make sound and pictures in code, or use a service the person has a key for (with its API docs), and save them under assets/. '
      + `\`openfilm get <what> --help\` shows what one kind takes (voice, tts, sfx, music, asr, image-search, image, video).\n\n${SERVICES}\n`);
    assert.match(SERVICES, /: ElevenLabs \(voice-over, sound effects, music, transcripts\), fal\.ai \(images, video\), .*, the OpenFilm account \(all of these\)\. In Studio, the OpenFilm logo at the top left opens Settings/);

    /* partly: what is connected, then one line for the rest, then the services there are; never who makes what now */
    await changeSettings((s) => { s.keys.elevenlabs = 'xi-test-0123456789'; for (const v of ['tts', 'sfx', 'music', 'asr']) s.use[v] = 'elevenlabs'; });
    const partly = get(scratch);
    assert.equal(partly.stdout, `${[...listing(['voice', 'tts', 'sfx', 'music', 'asr']), '',
      `Not connected here: image-search, image, video. The person can connect them. ${WHERE_TO_CONNECT}`, '', SERVICES].join('\n')}\n`);
    assert.doesNotMatch(partly.stdout.replace(SERVICES, ''), /ElevenLabs|made by|flash|ultra/i);
    const image = get(root, 'image', '--help');
    assert.equal(image.stdout, `${[...listing(['image']), '',
      `Not connected here: image. The person can connect it. ${WHERE_TO_CONNECT}`].join('\n')}\n`);
    const unavailable = get(root, 'image', '--out', 'hero', '--prompt', 'a key');
    assert.equal(unavailable.status, 1);
    assert.equal(unavailable.stdout, `Not connected here: image. The person can connect it. ${WHERE_TO_CONNECT} `
      + 'Until then, make it in code, or use a service the person has a key for (with its API docs), and save it under assets/.\n');
    assert.equal(get(root, 'sfx', '--tier', 'max', '--out', 'x', '--prompt', 'p').status, 2);

    assert.equal(get(scratch, 'tts', '--out', 'x').status, 2, 'not in a project');
    assert.match(get(scratch, 'tts').stdout, /is not in a project; `openfilm open` makes one/);
    const wrong = get(root, 'tts', '--out', 'a/b', '--text', 'hi', '--voice', 'v');
    assert.equal(wrong.status, 2);
    assert.match(wrong.stdout, /--out is a simple name/);
    assert.equal(get(root, 'tts', 'extra', '--out', 'x').status, 2);
    assert.equal(get(root, 'tts', '--via', 'nobody', '--out', 'x', '--text', 'hi', '--voice', 'v').status, 2);
  } finally {
    const run = JSON.parse(readFileSync(join(process.env.OPENFILM_HOME, 'run.json'), 'utf8'));
    await fetch(`${run.origin}/api/quit`, { method: 'POST', headers: { 'x-studio-key': run.key } });
  }
});
