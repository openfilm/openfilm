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
import { VERBS, WEB_VERBS, WHERE_TO_CONNECT, catalog, flagHelp, runGet, services, subtitleTranslator } from './get.mjs';
import { changeSettings, kindOf, providersFile } from './keys.mjs';
import { listProviders } from './providers/index.mjs';
import { startStudio } from './server.mjs';
import { filmHtml } from '../../src/film-doc.mjs';

/**
 * A fake ElevenLabs, fal.ai and OpenAI on 127.0.0.1 (each provider's OPENFILM_<NAME>_URL points here), answering as
 * each service does. `refuse`, when set, answers every request instead. `calls` records every request.
 */
let service, base, scratch;
const calls = [];
/** @type {((call: object) => [number, unknown]) | null} */
let refuse = null;

const SAID = 'Hello there. How are you?';
const WORDS = [{ token: 'Hello', start: 0, end: 0.4 }, { token: 'there.', start: 0.45, end: 0.9 }, { token: 'How', start: 1.8, end: 2 }, { token: 'are', start: 2.05, end: 2.2 }, { token: 'you?', start: 2.25, end: 2.6 }];
/** constant 128 kbps MP3, so its length is known from its size */
const mp3 = (seconds) => Buffer.alloc(Math.round(seconds * 16000), 1);
/** SAID timed per character, as ElevenLabs times it */
const ALIGNMENT = (() => {
  const characters = [], starts = [], ends = [];
  WORDS.forEach((w, i) => {
    if (i) { characters.push(' '); starts.push(WORDS[i - 1].end); ends.push(w.start); }
    for (const ch of w.token) { characters.push(ch); starts.push(w.start); ends.push(w.end); }
  });
  return { characters, character_start_times_seconds: starts, character_end_times_seconds: ends };
})();
const FRENCH = { 'Hello there.': 'Bonjour.', 'How are you?': 'Comment ça va ?' };

function answer(call) {
  const json = () => JSON.parse(call.body.toString('utf8'));
  if (call.path.startsWith('/v1/text-to-speech/')) return [200, { audio_base64: mp3(2.8).toString('base64'), alignment: ALIGNMENT }];
  if (call.path === '/v1/sound-generation' || call.path === '/v1/music') return [200, mp3(1)];
  if (call.path === '/v2/voices') return [200, { voices: [{ voice_id: 'v-1', name: 'Ada', labels: { gender: 'female' } }] }];
  if (call.path === '/v1/speech-to-text') {
    return [200, { text: 'One two.', words: [{ type: 'word', text: 'One', start: 0.1, end: 0.4 }, { type: 'spacing', text: ' ', start: 0.4, end: 0.5 }, { type: 'word', text: 'two.', start: 0.5, end: 0.9 }] }];
  }
  if (call.path === '/v1/responses') {
    const { lines } = JSON.parse(json().input);
    return [200, { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ lines: lines.map((l) => FRENCH[l] ?? l) }) }] }] }];
  }
  /* fal's queue: a request in, asked after, its result, then the file it made */
  if (call.path === '/queue/status') return [200, { status: 'COMPLETED' }];
  if (call.path === '/queue/result') return [200, { video: { url: `${base}/files/shot.mp4` } }];
  if (call.path === '/files/shot.mp4') return [200, Buffer.from('mp4')];
  if (call.method === 'POST' && /^\/(bytedance|fal-ai)\//.test(call.path)) return [200, { status_url: `${base}/queue/status`, response_url: `${base}/queue/result` }];
  return [404, {}];
}

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'of-get-'));
  service = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const url = new URL(req.url, 'http://x');
    const call = { method: req.method, path: url.pathname, headers: req.headers, body: Buffer.concat(chunks) };
    calls.push(call);
    const [status, body] = (refuse ?? answer)(call);
    if (Buffer.isBuffer(body)) res.writeHead(status, { 'content-type': 'application/octet-stream' }).end(body);
    else res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise((done) => service.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${service.address().port}`;
  Object.assign(process.env, {
    OPENFILM_HOME: join(scratch, 'home'), OPENFILM_LIBRARY: join(scratch, 'library'),
    OPENFILM_ELEVENLABS_URL: base, OPENFILM_FAL_URL: base, OPENFILM_OPENAI_URL: base,
  });
  for (const p of [...listProviders(), { env: 'GOOGLE_API_KEY' }]) delete process.env[p.env];
});
after(() => service.close());

/** Whether any provider makes `verb`, connected or not. */
const made = (verb) => listProviders().some((p) => p.verbs.includes(verb));
/** A kind that is not connected, as the note names it: with the services that make it. */
const unconnected = (verb) => {
  const names = listProviders().filter((p) => p.verbs.includes(verb)).map((p) => p.name).sort((a, b) => a.localeCompare(b));
  return `${verb} (${names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0]})`;
};
const CONNECT_ONE = `Each works only once the person connects a service that makes it. ${WHERE_TO_CONNECT}`;
/** The kinds the fake answers, and who makes them here; every other kind goes to the first provider that makes it. */
const CHOSEN = { tts: 'elevenlabs', sfx: 'elevenlabs', music: 'elevenlabs', asr: 'elevenlabs', image: 'fal', video: 'fal', translate: 'openai' };

/** Every provider connected (a key each), and a choice for every kind something makes. */
function connectAll() {
  return changeSettings((s) => {
    for (const p of listProviders()) s.keys[p.id] = `${p.id}-test-0123456789`;
    for (const verb of [...Object.keys(VERBS), 'translate'].filter(made)) {
      const kind = kindOf(verb);
      s.use[kind] ??= CHOSEN[kind] ?? listProviders().find((p) => p.verbs.includes(kind)).id;
    }
  });
}
beforeEach(async () => { calls.length = 0; refuse = null; rmSync(providersFile(), { force: true }); await connectAll(); });

let projects = 0;
function project(film = { stage: { w: 1920, h: 1080 }, tracks: [] }) {
  const root = join(scratch, `p${++projects}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'film.html'), filmHtml(film));
  return root;
}
const b64 = (text) => Buffer.from(text).toString('base64');
/** A multipart request's form, as the fake got it. */
const formOf = (call) => new Request('http://x', { method: 'POST', headers: { 'content-type': call.headers['content-type'] }, body: call.body }).formData();

test('tts: the file lands, its timed words a WebVTT beside it, and the receipt says what landed, not what it cost', async () => {
  const root = project();
  const text = await runGet(root, 'tts', { out: 'intro', text: SAID, voice: 'v-1' });
  const receipt = JSON.parse(text);
  assert.deepEqual(receipt, { src: 'assets/audio/vo/intro.mp3', dur: 2.8, voiceId: 'v-1', transcript: 'assets/audio/vo/intro.vtt' });
  assert.equal(readFileSync(join(root, 'assets/audio/vo/intro.mp3')).length, mp3(2.8).length);

  const [run] = calls;
  assert.equal(run.path, '/v1/text-to-speech/v-1/with-timestamps');
  assert.equal(run.headers['xi-api-key'], 'elevenlabs-test-0123456789');
  assert.deepEqual(JSON.parse(run.body), { text: SAID, model_id: 'eleven_multilingual_v2' });

  assert.match(readFileSync(join(root, 'assets/audio/vo/intro.vtt'), 'utf8'), /00:00:01\.800 --> 00:00:02\.800\nHow <00:00:02\.050>are <00:00:02\.250>you\?/);
  const transcript = await readTranscript(root, 'assets/audio/vo/intro.mp3');
  assert.deepEqual(transcript.lines.map((l) => l.text), ['Hello there.', 'How are you?']);
  assert.ok(!existsSync(join(root, 'assets/index.jsonl')), 'no ledger');

  /* a voice-over without word times: no transcript, and the receipt says how to get one */
  refuse = () => [200, { audio_base64: mp3(1).toString('base64') }];
  const untimed = JSON.parse(await runGet(root, 'tts', { out: 'two', text: SAID, voice: 'v-1' }));
  assert.match(untimed.transcript, /^none: .*get asr/);
  assert.ok(!existsSync(join(root, 'assets/audio/vo/two.vtt')));
  refuse = null;

  /* voices come from the provider that speaks */
  const voices = JSON.parse(await runGet(root, 'voice', {}));
  assert.deepEqual(voices.voices.map((v) => v.voiceId), ['v-1']);
  assert.equal(calls.at(-1).path, '/v2/voices');
});

test('a file is never written through a link the project brings under assets/', { skip: process.platform === 'win32' }, async () => {
  const root = project();
  const elsewhere = mkdtempSync(join(tmpdir(), 'of-elsewhere-'));
  mkdirSync(join(root, 'assets'), { recursive: true });
  symlinkSync(elsewhere, join(root, 'assets/audio'));
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
  assert.equal(calls.length, 0);
});

test('not enough balance: the agent is told to stop and where the person tops it up, the person is told in Studio, nothing landed', async () => {
  const root = project();
  refuse = () => [402, { detail: { status: 'quota_exceeded', message: 'This request exceeds your quota.' } }];
  const told = [];
  const asked = [];
  await assert.rejects(runGet(root, 'music', { out: 'bed', prompt: 'calm pad', sec: '30' }, { tell: (n) => told.push(n), ask: async (s) => { asked.push(s); return 'allow'; } }), {
    message: 'This did not run: ElevenLabs doesn\'t have enough balance. The person can top it up at https://elevenlabs.io/app/subscription, or switch to another service. '
      + 'Nothing was made. Stop and tell them; do not run it again until they say so.',
  });
  assert.deepEqual(told, [{ kind: 'balance', provider: 'ElevenLabs', providerId: 'elevenlabs' }]);
  assert.deepEqual(asked, [], 'nothing to allow');
  assert.equal(calls.length, 1, 'not tried again');
  assert.ok(!existsSync(join(root, 'assets')));
  assert.equal(JSON.parse(calls[0].body).music_length_ms, 30_000);
});

test('the model: the person\'s choice for each kind of media, the provider\'s first otherwise, --model for one run', async () => {
  const root = project();
  await changeSettings((s) => { s.model = { tts: 'eleven_v4', music: 'music_v2' }; });
  const modelOf = async (verb, args, options) => {
    await runGet(root, verb, args, options);
    return JSON.parse(calls.at(-1).body).model_id;
  };
  assert.equal(await modelOf('tts', { out: 'intro', text: SAID, voice: 'v-1' }), 'eleven_v4');
  assert.equal(await modelOf('music', { out: 'bed', prompt: 'calm pad' }), 'music_v2');
  assert.equal(await modelOf('sfx', { out: 'ding', prompt: 'a chime' }), 'eleven_text_to_sound_v2', 'the first');
  assert.equal(await modelOf('music', { out: 'bed', prompt: 'calm pad' }, { model: 'music_v2_5' }), 'music_v2_5');
  await assert.rejects(runGet(root, 'sfx', { out: 'ding', prompt: 'a chime' }, { model: 'seedance-2.0' }), (e) => e.code === 2 && /--model is one of eleven_text_to_sound_v2 with ElevenLabs/.test(e.message));
});

test('video: the person confirms what will be made first, without amounts; no page means ask them and run again with --yes', async () => {
  const root = project();
  writeFileSync(join(root, 'first.png'), 'png');
  const args = { out: 'shot', prompt: 'a slow push into a glowing triangle', 'first-frame': 'first.png' };

  await assert.rejects(runGet(root, 'video', args, { ask: async () => null }), (e) => e.code === 1 && /expensive.*--yes/.test(e.message) && !/credit|\d/.test(e.message.replace('--yes', '')));
  assert.equal(calls.length, 0, 'nothing made');

  const asked = [];
  const receipt = JSON.parse(await runGet(root, 'video', args, { ask: async (spend) => { asked.push(spend); return 'allow'; } }));
  assert.deepEqual(asked, [{ kind: 'video', provider: 'fal.ai', model: 'Seedance 2.0', seconds: 5, prompt: args.prompt }]);
  assert.equal(calls[0].path, '/bytedance/seedance-2.0/image-to-video');
  const sent = JSON.parse(calls[0].body);
  assert.deepEqual([sent.image_url, sent.duration], [`data:image/png;base64,${b64('png')}`, '5']);
  assert.equal(receipt.src, 'assets/video/shot.mp4');
  assert.equal(readFileSync(join(root, 'assets/video/shot.mp4'), 'utf8'), 'mp4');

  await assert.rejects(runGet(root, 'video', args, { ask: async () => 'deny' }), /chose not to make this video clip/);
  asked.length = 0;
  await runGet(root, 'video', args, { yes: true, ask: async (spend) => { asked.push(spend); return 'allow'; } });
  assert.deepEqual(asked, [], 'with --yes: no question');
});

test('asr: the speech alone is sent, its transcript lands beside the recording, and is not made twice', async () => {
  const root = project();
  mkdirSync(join(root, 'assets/upload'), { recursive: true });
  const wav = join(root, 'assets/upload/talk.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=48000', '-ac', '2', wav]);
  const receipt = JSON.parse(await runGet(root, 'asr', { src: 'assets/upload/talk.wav' }));
  assert.deepEqual(receipt, { src: 'assets/upload/talk.wav', text: 'One two.', transcript: 'assets/upload/talk.vtt' });
  assert.match(readFileSync(join(root, 'assets/upload/talk.vtt'), 'utf8'), /^WEBVTT\n\n00:00:00\.100 --> .*\nOne <00:00:00\.500>two\./);
  const file = (await formOf(calls[0])).get('file');
  const proxy = Buffer.from(await file.arrayBuffer());
  assert.equal(file.name, 'talk.wav');
  assert.equal(proxy.readUInt16LE(22), 1, 'mono');
  assert.equal(proxy.readUInt32LE(24), 16000, '16 kHz');

  const again = JSON.parse(await runGet(root, 'asr', { src: 'assets/upload/talk.wav' }));
  assert.equal(again.skip, true);
  assert.equal(again.text, 'One two.');
  const transcribed = () => calls.filter((c) => c.path === '/v1/speech-to-text').length;
  assert.equal(transcribed(), 1, 'transcribed once');
  await runGet(root, 'asr', { src: 'assets/upload/talk.wav', force: true });
  assert.equal(transcribed(), 2, '--force transcribes again');
});

test('what lands stays in assets/, and the receipt leaves out what it cost', async (t) => {
  const root = project();
  const fal = listProviders().find((p) => p.id === 'fal');
  t.mock.method(fal, 'run', async () => ({
    files: [
      { path: '../escape.txt', bytes: Buffer.from('x') }, { path: 'assets/../../escape2.txt', bytes: Buffer.from('x') }, { path: 'film.html', bytes: Buffer.from('{}') },
      { path: '/tmp/abs.txt', bytes: Buffer.from('x') }, { path: 'assets/image/ok.png', bytes: Buffer.from('png') },
    ],
    index: [{ src: '../escape.txt', kind: 'file' }],
    receipt: { images: [{ src: 'assets/image/ok.png' }], costUsd: 0.04, balance: 12 },
  }));
  const text = await runGet(root, 'image', { out: 'ok', prompt: 'a key' });
  assert.ok(existsSync(join(root, 'assets/image/ok.png')));
  assert.ok(!existsSync(join(scratch, 'escape.txt')) && !existsSync(join(root, '..', 'escape2.txt')));
  assert.notEqual(readFileSync(join(root, 'film.html'), 'utf8'), '{}');
  assert.deepEqual(JSON.parse(text), { images: [{ src: 'assets/image/ok.png' }] });
});

test('subtitles translate through the provider chosen for it: each line its own, kept beside the transcript', async () => {
  const root = project({ stage: { w: 1920, h: 1080 }, tracks: [{ clips: [{ id: 'vo', src: 'assets/audio/vo/intro.mp3' }] }] });
  await runGet(root, 'tts', { out: 'intro', text: SAID, voice: 'v-1' });
  const translate = await subtitleTranslator(root);
  const result = await translateFilmSubtitles(root, 'fr', { translate });
  assert.deepEqual(result, { language: 'fr', translated: ['assets/audio/vo/intro.mp3'], already: 0, same: 0, failed: [] });
  const sent = JSON.parse(calls.at(-1).body);
  assert.equal(calls.at(-1).headers.authorization, 'Bearer openai-test-0123456789');
  assert.deepEqual(JSON.parse(sent.input), { language: 'fr', lines: ['Hello there.', 'How are you?'] });
  const { cues, languages } = await filmCaptions(root, { duration: async () => 2.8 });
  assert.deepEqual(languages, ['fr']);
  assert.deepEqual(cues.map((c) => [c.text, c.alt?.fr]), [['Hello there.', 'Bonjour.'], ['How are you?', 'Comment ça va ?']]);
  assert.ok(existsSync(join(root, 'assets/audio/vo/intro.fr.vtt')));

  /* its key gone: nothing translates, and the route says to connect one */
  await changeSettings((s) => { delete s.keys.openai; });
  assert.equal(await subtitleTranslator(root), null);
});

test('Studio: GET /api/get lists what can be got, never who makes it; a video run asks the page showing the project', async () => {
  const studio = await startStudio({ port: 0, openBrowser: () => {}, quietMs: 150 });
  try {
    const api = (path, init = {}) => fetch(`${studio.origin}${path}`, { ...init, headers: { 'x-studio-key': studio.key, 'content-type': 'application/json', ...init.headers } });
    const { verbs, note } = await (await api('/api/get')).json();
    const media = Object.entries(VERBS).filter(([verb]) => !WEB_VERBS.includes(verb) && made(verb));
    assert.deepEqual(verbs.map((v) => Object.keys(v)), media.map(([, spec]) => ['verb', 'help', ...(spec.dir ? ['dir'] : []), 'options']));
    assert.equal(note, null);
    /* web search and web pages too, for an agent without its own, when something makes them */
    assert.deepEqual((await (await api('/api/get?web=1')).json()).verbs.map((v) => v.verb), Object.keys(VERBS).filter(made));
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
    const running = api('/api/get', { method: 'POST', body: JSON.stringify({ folder: opened.path, verb: 'video', args: { out: 'shot', prompt: 'p' } }) }).then((r) => r.json());
    const { ask } = await next('ask');
    assert.deepEqual([ask.kind, ask.provider, ask.model, ask.seconds], ['video', 'fal.ai', 'Seedance 2.0', 5]);
    assert.deepEqual(await (await api(`/api/get/asks/${ask.id}`, { method: 'POST', body: JSON.stringify({ allow: true }) })).json(), { answered: true });
    assert.equal((await next('asked')).id, ask.id);
    const answer = await running;
    assert.equal(answer.ok, true);
    assert.equal(JSON.parse(answer.text).src, 'assets/video/shot.mp4');

    /* no balance: the page is told, with the provider to top up, and nothing waits for an answer */
    refuse = () => [402, { detail: { status: 'quota_exceeded' } }];
    const failed = await (await api('/api/get', { method: 'POST', body: JSON.stringify({ folder: opened.path, verb: 'sfx', args: { out: 'ding', prompt: 'a chime' } }) })).json();
    assert.deepEqual([failed.ok, failed.code], [false, 1]);
    assert.match(failed.text, /ElevenLabs doesn't have enough balance/);
    const { notice } = await next('notice');
    assert.deepEqual({ ...notice, id: typeof notice.id }, { id: 'string', kind: 'balance', provider: 'ElevenLabs', providerId: 'elevenlabs' });
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
  const media = Object.keys(VERBS).filter((verb) => !WEB_VERBS.includes(verb) && made(verb));
  try {
    /* everything connected: the verbs, and nothing else */
    const listed = get(scratch);
    assert.equal(listed.status, 0, listed.stderr);
    assert.equal(listed.stdout, `${[...listing(media), '', services()].join('\n')}\n`);
    const one = get(root, 'image', '--help');
    assert.equal(one.status, 0);
    assert.match(one.stdout, /--ratio <16:9\|9:16/);
    assert.doesNotMatch(one.stdout, /--voice/);

    /* --model: this run with another model than the person's choice */
    const modelled = await run(root, 'music', '--model', 'music_v2', '--out', 'bed', '--prompt', 'calm pad');
    assert.equal(modelled.status, 0, modelled.stdout);
    assert.equal(JSON.parse(calls.at(-1).body).model_id, 'music_v2');

    /* web search and web pages: listed for an agent without its own (OPENFILM_GET_WEB=1), when something makes them */
    const withWeb = spawnSync(process.execPath, [bin, 'get'], { cwd: scratch, env: { ...env, OPENFILM_GET_WEB: '1' }, encoding: 'utf8' });
    assert.equal(withWeb.stdout, `${[...listing(Object.keys(VERBS).filter(made)), '', services()].join('\n')}\n`);

    /* nothing connected: no verbs, what to do instead */
    rmSync(providersFile());
    const nothing = get(scratch);
    assert.equal(nothing.status, 0);
    assert.equal(nothing.stdout, 'Nothing is connected for media here: each kind works only once the person connects a service that makes it (below). '
      + 'Until then, make sound and pictures in code, or use a service the person has a key for (with its API docs), and save them under assets/. '
      + `\`openfilm get <what> --help\` shows what one kind takes (${media.join(', ')}).\n\n${services()}\n`);
    assert.match(services(), /^Media services, each used with the person's own key: Brave Search \(web search\), ElevenLabs \(voice-over, sound effects, music, transcripts\), fal\.ai \(images, video, music, sound effects\), .*, Tavily \(web search\)\. In Studio, the OpenFilm logo at the top left opens Settings/);

    /* partly: what is connected, then one line for the rest with the services that make each, then the services there
       are; never who makes what is connected */
    await changeSettings((s) => { s.keys.elevenlabs = 'xi-test-0123456789'; for (const v of ['tts', 'sfx', 'music', 'asr']) s.use[v] = 'elevenlabs'; });
    const spoken = ['voice', 'tts', 'sfx', 'music', 'asr'];
    const rest = media.filter((v) => !spoken.includes(v));
    const partly = get(scratch);
    assert.equal(partly.stdout, `${[...listing(spoken), '',
      `Not connected here: ${rest.map(unconnected).join(', ')}. ${CONNECT_ONE}`, '', services()].join('\n')}\n`);
    assert.doesNotMatch(partly.stdout.replace(services(), ''), /ElevenLabs|made by/i);
    const image = get(root, 'image', '--help');
    assert.equal(image.stdout, `${[...listing(['image']), '',
      `Not connected here: ${unconnected('image')}. ${CONNECT_ONE}`].join('\n')}\n`);
    const unavailable = get(root, 'image', '--out', 'hero', '--prompt', 'a key');
    assert.equal(unavailable.status, 1);
    assert.match(unavailable.stdout, /^Not connected here: image \(fal\.ai, Google Gemini or OpenAI\)\. .*with the person's own key/);
    assert.equal(unavailable.stdout, `Not connected here: ${unconnected('image')}. ${CONNECT_ONE} Tell the person. `
      + 'Until then, make it in code, or use a service the person has a key for (with its API docs), and save it under assets/.\n');

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

test('nothing connected: no verbs, and a note naming only what the services make', async () => {
  rmSync(providersFile());
  const { verbs, note } = await catalog();
  assert.deepEqual(verbs, []);
  assert.match(note, new RegExp(`\\(${Object.keys(VERBS).filter((v) => !WEB_VERBS.includes(v) && made(v)).join(', ')}\\)`));
  assert.doesNotMatch(note, /account/i);
  /* one kind: which services make it, and where the person connects one */
  assert.equal((await catalog('video')).note, `Not connected here: ${unconnected('video')}. ${CONNECT_ONE}`);
});
