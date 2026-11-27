import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { startStudio } from './server.mjs';
import { agentKeyOf } from './projects.mjs';
import { voiceAssets, voiceFolder } from './voice-store.mjs';
import { libraryVoices } from './library.mjs';
import { wav } from './providers/common.mjs';

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'of-private-voices-'));
  const vars = ['OPENFILM_HOME', 'OPENFILM_SHARED_HOME', 'OPENFILM_LIBRARY', 'OPENFILM_TRASH_DIR', 'OPENFILM_API_URL',
    'OPENFILM_ELEVENLABS_URL', 'OPENFILM_INWORLD_URL', 'OPENFILM_DOUBAO_TTS_URL', 'OPENFILM_DOUBAO_PODCAST_URL', 'ELEVENLABS_API_KEY', 'INWORLD_API_KEY', 'OPENFILM_API_KEY', 'DOUBAO_SPEECH_API_KEY', 'DOUBAO_ASR_API_KEY'];
  const previous = new Map(vars.map((name) => [name, process.env[name]]));
  const calls = [];
  const control = { verification: false, failClone: false, rejectClone: false, training: false, redirect: false, forgetDown: false };
  let upstream, studio, origin;
  try {
    process.env.OPENFILM_HOME = join(dir, 'home');
    process.env.OPENFILM_SHARED_HOME = join(dir, 'shared');
    process.env.OPENFILM_LIBRARY = join(dir, 'projects');
    process.env.OPENFILM_TRASH_DIR = join(dir, 'trash');
    for (const name of ['ELEVENLABS_API_KEY', 'INWORLD_API_KEY', 'OPENFILM_API_KEY', 'DOUBAO_SPEECH_API_KEY', 'DOUBAO_ASR_API_KEY']) delete process.env[name];
    await mkdir(process.env.OPENFILM_TRASH_DIR, { recursive: true });
    upstream = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const call = { path: req.url, headers: req.headers, method: req.method, body: Buffer.concat(chunks) };
      /* what OpenFilm's service offers is asked whenever the voices are listed: not a call the tests count */
      if (req.url !== '/v1/media/models') calls.push(call);
      const respond = (body, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      if (req.url === '/v1/media/models') respond({ models: { tts: [
        { id: 'elevenlabs/eleven_v4', name: 'ElevenLabs Eleven v4' },
        { id: 'elevenlabs/eleven_v4-clone', name: 'ElevenLabs Eleven v4 · cloned voice', clones: 'only' },
        { id: 'inworld/inworld-tts-2', name: 'Inworld TTS-2', clones: 'also' },
        { id: 'inworld/inworld-tts-2-flash', name: 'Inworld TTS-2 Flash', clones: 'also' },
      ] } });
      else if (req.url === '/v1/media/uploads') respond({ uploads: JSON.parse(call.body).files.map((f, i) => ({ path: f.path, id: `upload-${i}`, url: `${origin}/put/${i}` })) });
      else if (req.url.startsWith('/put/')) respond({});
      else if (req.url === '/v1/media/run') respond({ call_id: 'run-1', files: [{ path: 'assets/audio/vo/line.mp3', base64: Buffer.alloc(16000, 2).toString('base64') }], index: [], receipt: { provider: 'inworld' } });
      else if (req.url === '/v1/media/ack') respond({});
      else if (req.url === '/v1/media/voices/forget') { if (control.forgetDown) respond({ error: 'unavailable' }, 503); else respond({ deleted: JSON.parse(call.body).samples.length }); }
      else if (req.url === '/voices/v1/voices:clone') respond({ voice: { voiceId: 'ws__narrator', displayName: JSON.parse(call.body).displayName, source: 'IVC' } });
      else if (req.url.startsWith('/voices/v1/voices')) respond({ voices: [
        { voiceId: 'ws__narrator', displayName: 'Narrator', source: 'IVC' },
        { voiceId: 'ws__cache', displayName: 'openfilm-0123456789abcdef0123456789abcdef', source: 'IVC' },
        { voiceId: 'Ashley', displayName: 'Ashley', source: 'SYSTEM' },
      ] });
      else if (req.url === '/tts/v1/voice') respond({ audioContent: Buffer.alloc(16000, 3).toString('base64') });
      else if (req.url === '/v1/voices/add') {
        if (control.failClone) { req.socket.destroy(); return; }
        if (control.rejectClone) { respond({ detail: { message: 'No voice slots available.' } }, 400); return; }
        if (control.redirect) { res.writeHead(307, { location: `${origin}/never` }).end(); return; }
        respond({ voice_id: 'own-voice', requires_verification: control.verification });
      } else if (req.url.startsWith('/v1/voices/')) respond({ voice_id: 'own-voice', name: 'Voice', voice_verification: { requires_verification: control.verification, is_verified: !control.verification } });
      else if (req.url.startsWith('/v2/voices')) respond({ voices: [
        { voice_id: 'own-voice', name: 'My narrator', category: 'cloned', is_owner: true },
        { voice_id: 'public-voice', name: 'Public', category: 'premade' },
        { voice_id: 'someone-else', name: 'Library', category: 'professional', is_owner: false },
      ], has_more: false });
      else if (req.url === '/api/v3/tts/unidirectional') {
        res.writeHead(200, { 'content-type': 'application/json' });
        const pcm = Buffer.alloc(48000);
        const one = JSON.stringify({ code: 0, data: pcm.subarray(0, 24000).toString('base64'), sentence: { words: [{ word: '你好', startTime: 0.1, endTime: 0.8 }] } });
        const two = JSON.stringify({ code: 0, data: pcm.subarray(24000).toString('base64') });
        res.write(one.slice(0, 111)); res.end(`${one.slice(111)}\n${two}\n`);
      } else if (req.url === '/api/v3/podcast/sse') {
        const half = Buffer.alloc(24000).toString('base64');
        res.writeHead(200, { 'content-type': 'text/event-stream' }).end(JSON.parse(call.body).nlp_texts.map((t) => [['360', { payload: { speaker: t.speaker, text: t.text } }], ['361', { data: half }], ['362', { payload: {} }]]).flat()
          .concat([['154', { payload: { usage: { input_text_tokens: 10, output_audio_tokens: 25 } } }], ['152', { code: 20000000 }]]).map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''));
      } else if (req.url.startsWith('/v1/text-to-speech/')) respond({ audio_base64: Buffer.alloc(16000, 1).toString('base64') });
      else respond({}, 404);
    });
    await new Promise((done) => upstream.listen(0, '127.0.0.1', done)); origin = `http://127.0.0.1:${upstream.address().port}`;
    process.env.OPENFILM_ELEVENLABS_URL = origin; process.env.OPENFILM_INWORLD_URL = origin; process.env.OPENFILM_API_URL = origin;
    process.env.OPENFILM_DOUBAO_TTS_URL = `${origin}/api/v3/tts/unidirectional`;
    process.env.OPENFILM_DOUBAO_PODCAST_URL = `${origin}/api/v3/podcast/sse`;
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    const call = async (path, method = 'GET', body, expected = 200, key = studio.key) => {
      const res = await fetch(`${studio.origin}/api/${path}`, { method, headers: { 'x-studio-key': key, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await res.json(); assert.equal(res.status, expected, JSON.stringify(result)); return result;
    };
    await call('providers/elevenlabs/key', 'PUT', { key: 'fake-eleven-connection-A' });
    await call('providers/doubao/key', 'PUT', { key: 'fake-doubao-connection-A' });
    await call('providers/inworld/key', 'PUT', { key: 'fake-inworld-connection-A' });
    const audio = { data: Buffer.from(wav(new Uint8Array(6 * 48000), 24000)).toString('base64') };
    await run({ call, calls, control, audio, dir, studio });
  } finally {
    await studio?.close(); await new Promise((done) => upstream ? upstream.close(done) : done());
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(dir, { recursive: true, force: true });
  }
}

test('OpenFilm\'s service: the voice is its recording, kept here and sent with each line; Inworld first, ElevenLabs as an engine of its own', () => fixture(async ({ call, calls, audio }) => {
  await call('voices', 'POST', { provider: 'openfilm', name: 'Not signed in', consent: true, audio }, 409);
  await call('providers/openfilm/key', 'PUT', { key: 'ofk_test_service_key' });
  const { services } = await call('voices');
  assert.deepEqual(services.map((s) => s.id), ['openfilm']);
  const service = services[0];
  assert.equal(service.import, false); assert.equal(service.sync, false); assert.equal(service.pricingUrl, undefined, 'no price is shown in the app');
  assert.deepEqual(service.engines, [
    { id: 'inworld', name: 'Inworld', models: ['inworld/inworld-tts-2', 'inworld/inworld-tts-2-flash'] },
    { id: 'elevenlabs', name: 'ElevenLabs', models: ['elevenlabs/eleven_v4-clone'] },
  ]);
  const sent = calls.length;
  const { voice } = await call('voices', 'POST', { provider: 'openfilm', name: '我的旁白', language: 'zh', consent: true, audio });
  assert.equal(voice.status, 'ready'); assert.equal(voice.engine, 'inworld'); assert.equal(voice.available, true);
  assert.deepEqual(voice.models, ['inworld/inworld-tts-2', 'inworld/inworld-tts-2-flash']);
  assert.deepEqual(calls.slice(sent).map((c) => c.path), [], 'making the voice sends nothing: its recording goes with the lines spoken in it');
  const kept = await readFile(join(voiceFolder(voice.uid), 'sample.wav'));
  assert.equal(kept.length, 44 + 6 * 48000);
  assert.ok(!(await readFile(join(voiceFolder(voice.uid), 'voice.json'), 'utf8')).includes(audio.data));

  await call(`voices/${voice.uid}/preview`, 'POST', { text: '你好。' });
  const upload = calls.find((c) => c.path === '/v1/media/uploads');
  assert.deepEqual(JSON.parse(upload.body).files.map((f) => f.path), ['voice-sample.wav']);
  assert.deepEqual(calls.find((c) => c.path.startsWith('/put/')).body, kept);
  const run = JSON.parse(calls.find((c) => c.path === '/v1/media/run').body);
  assert.equal(run.model, 'inworld/inworld-tts-2');
  assert.deepEqual(run.args, { text: '你好。', voice: `my:${voice.uid}`, 'voice-sample': 'voice-sample.wav', language: 'zh', out: 'preview' });

  const { project } = await call('projects', 'POST', { name: 'Service voice' });
  const before = calls.length;
  const made = await call('get', 'POST', { folder: project.path, verb: 'tts', args: { text: '开始。', voice: voice.id, out: 'line' } });
  assert.equal(made.ok, true, made.text);
  const line = JSON.parse(calls.slice(before).find((c) => c.path === '/v1/media/run').body);
  assert.equal(line.args.voice, voice.id, 'the line keeps the voice\'s own name: made again, it is the same voice');
  assert.equal(line.args['voice-sample'], 'voice-sample.wav');
  assert.ok(!(await readdir(project.path, { recursive: true })).some((f) => f.endsWith('voice-sample.wav')), 'the recording is never copied into the project');

  const eleven = (await call('voices', 'POST', { provider: 'openfilm', engine: 'elevenlabs', name: 'Eleven', consent: true, audio })).voice;
  assert.deepEqual(eleven.models, ['elevenlabs/eleven_v4-clone']);
  await call('voices', 'POST', { provider: 'openfilm', engine: 'cartesia', name: 'Nope', consent: true, audio }, 400);
  await call('voices/import', 'POST', { provider: 'openfilm', voiceId: 'x' }, 404);
  await call('providers/openfilm/key', 'PUT', { key: 'ofk_another_computer_key' });
  assert.equal((await call('voices')).voices.find((v) => v.uid === voice.uid).available, true, 'any OpenFilm sign-in speaks it');
}));

test('voices are OpenFilm\'s own: never cloned with a person\'s own key, never made by the agent, and signed out they ask to sign in', () => fixture(async ({ call, calls, audio, studio }) => {
  await call('voices', 'POST', { provider: 'openfilm', name: 'Signed out', consent: true, audio }, 409);
  await call('providers/openfilm/key', 'PUT', { key: 'ofk_test_service_key' });
  await call('voices', 'POST', { provider: 'inworld', name: 'Own key', consent: true, audio }, 400);
  await call('voices', 'POST', { provider: 'openfilm', name: 'No consent', audio }, 400);
  await call('voices', 'POST', { provider: 'openfilm', name: 'Agent request', consent: true, audio }, 403, agentKeyOf(studio.key));
  await call('voices/import', 'POST', { provider: 'inworld', voiceId: 'ws__narrator' }, 404);
  await call('voices/sync', 'POST', { provider: 'elevenlabs' }, 404);
  assert.ok(!calls.some((c) => c.path.startsWith('/voices/') || c.path.startsWith('/v1/voices')), 'no own-key service is called');
  assert.deepEqual((await call('voices')).services.map((s) => s.id), ['openfilm']);
}));

test('removing a voice asks the service to delete its clones; when it cannot be reached it is asked again later', () => fixture(async ({ call, calls, audio, control }) => {
  await call('providers/openfilm/key', 'PUT', { key: 'ofk_test_service_key' });
  const one = (await call('voices', 'POST', { provider: 'openfilm', name: 'One', consent: true, audio })).voice;
  const sample = await readFile(join(voiceFolder(one.uid), 'sample.wav'));
  const digest = createHash('sha256').update(sample).digest('hex');
  await call(`voices/${one.uid}`, 'DELETE');
  const forgot = calls.filter((c) => c.path === '/v1/media/voices/forget');
  assert.deepEqual(JSON.parse(forgot[0].body), { samples: [digest] }, 'only the recording\'s digest is sent, never the recording');
  assert.equal(forgot[0].headers.authorization, 'Bearer ofk_test_service_key');

  control.forgetDown = true;
  const two = (await call('voices', 'POST', { provider: 'openfilm', name: 'Two', consent: true, audio: { data: Buffer.from(wav(new Uint8Array(7 * 48000).fill(3), 24000)).toString('base64') } })).voice;
  const second = createHash('sha256').update(await readFile(join(voiceFolder(two.uid), 'sample.wav'))).digest('hex');
  await call(`voices/${two.uid}`, 'DELETE');
  assert.equal(voiceAssets().length, 0, 'the voice is removed here at once');
  control.forgetDown = false;
  const before = calls.length;
  await call('voices');
  const retried = calls.slice(before).filter((c) => c.path === '/v1/media/voices/forget');
  assert.deepEqual(JSON.parse(retried[0].body), { samples: [second] });
  await call('voices');
  assert.equal(calls.slice(before).filter((c) => c.path === '/v1/media/voices/forget').length, 1, 'once deleted, it is not asked again');
}));

test('multilingual stock voices also omit unsupported subtitles when the caller supplies only a voice ID', () => fixture(async ({ call, calls }) => {
  const { project } = await call('projects', 'POST', { name: 'French narrator' });
  const voice = libraryVoices().voices.find((v) => v.provider === 'doubao' && v.language === 'fr');
  assert.ok(voice);
  const made = await call('get', 'POST', { folder: project.path, verb: 'tts', via: 'doubao', model: 'seed-tts-2.0',
    args: { text: 'Bonjour, voici ma voix.', voice: voice.id, out: 'french' } });
  assert.equal(made.ok, true);
  const request = JSON.parse(calls.find((c) => c.path === '/api/v3/tts/unidirectional').body);
  assert.equal(request.req_params.audio_params.enable_subtitle, undefined);
}));

test('two voices speak a dialogue: the same voice-over command, a turn a line, with Doubao\'s podcast model; a pair is in the library', () => fixture(async ({ call, calls }) => {
  const { project } = await call('projects', 'POST', { name: 'Dialogue' });
  const pairs = (await call('library/voices')).voices.filter((v) => v.pair);
  assert.ok(pairs.length >= 2 && pairs.every((p) => p.provider === 'doubao' && p.members.length === 2 && p.id === p.members.map((m) => m.id).join('+')));
  const made = await call('get', 'POST', { folder: project.path, verb: 'tts', via: 'doubao', model: 'seed-tts-2.0',
    args: { text: '你好。\n2: 你好呀。', voice: pairs[0].id, out: 'talk' } });
  assert.equal(made.ok, true, made.text);
  const sent = JSON.parse(calls.find((c) => c.path === '/api/v3/podcast/sse').body);
  assert.deepEqual(sent.nlp_texts.map((t) => t.speaker), pairs[0].members.map((m) => m.id));
  assert.equal(JSON.parse(made.text).src, 'assets/audio/vo/talk.wav');
  const twice = await call('get', 'POST', { folder: project.path, verb: 'tts', via: 'doubao', args: { text: '一\n二', voice: ['zh_a', 'zh_b'], out: 'twice' } });
  assert.equal(twice.ok, true, twice.text);
  const three = await call('get', 'POST', { folder: project.path, verb: 'tts', via: 'doubao', args: { text: 'x', voice: 'a+b+c', out: 'three' } });
  assert.equal(three.ok, false); assert.match(three.text, /one voice, or two for a dialogue/);
  const other = await call('get', 'POST', { folder: project.path, verb: 'tts', via: 'elevenlabs', args: { text: 'x', voice: 'a+b', out: 'other' } });
  assert.equal(other.ok, false); assert.match(other.text, /speaks no dialogue of two voices/);
}));

test('a voice-over in another service\'s voice is spoken by that service\'s model, or stops before anything is sent', () => fixture(async ({ call, calls }) => {
  const { project } = await call('projects', 'POST', { name: 'Voices of services' });
  const { voices } = libraryVoices();
  const squash = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const elevenNames = new Set(voices.filter((v) => v.provider === 'elevenlabs').map((v) => squash(v.name)));
  const inworld = voices.find((v) => v.provider === 'inworld' && !elevenNames.has(squash(v.name)) && !elevenNames.has(squash(v.id)));
  const get = (args, more = {}) => call('get', 'POST', { folder: project.path, verb: 'tts', ...more, args: { text: 'Hello.', ...args } });

  /* the person's own keys: ElevenLabs speaks voice-overs, Inworld is connected too, and an Inworld voice goes there */
  const own = await get({ voice: inworld.id, out: 'own' });
  assert.equal(own.ok, true, own.text);
  const spoken = JSON.parse(calls.filter((c) => c.path === '/tts/v1/voice').at(-1).body);
  assert.deepEqual([spoken.voiceId, spoken.modelId], [inworld.id, 'inworld-tts-2']);
  assert.match(own.text, /which ElevenLabs cannot speak: spoken by inworld-tts-2 with Inworld, connected in Settings/);

  /* through OpenFilm's service, whose first model is ElevenLabs': its Inworld model */
  await call('providers/openfilm/key', 'PUT', { key: 'ofk_test_service_key' });
  const runs = () => calls.filter((c) => c.path === '/v1/media/run').map((c) => JSON.parse(c.body));
  const service = await get({ voice: inworld.id, out: 'service' }, { via: 'openfilm' });
  assert.equal(service.ok, true, service.text);
  assert.deepEqual([runs().at(-1).model, runs().at(-1).args.voice], ['inworld/inworld-tts-2', inworld.id]);

  /* a name with its spaces left out is the ElevenLabs voice of that name */
  const named = voices.find((v) => v.provider === 'elevenlabs' && v.name.includes(' ')
    && voices.filter((w) => w.provider === 'elevenlabs' && squash(w.name) === squash(v.name)).length === 1);
  const byName = await get({ voice: named.name.replaceAll(' ', ''), out: 'named' }, { via: 'openfilm' });
  assert.equal(byName.ok, true, byName.text);
  assert.deepEqual([runs().at(-1).model, runs().at(-1).args.voice], ['elevenlabs/eleven_v4', named.id]);

  /* a Doubao voice with ElevenLabs' model named: nothing is sent */
  const before = calls.length;
  const doubao = voices.find((v) => v.provider === 'doubao' && !v.pair);
  const refused = await get({ text: '你好。', voice: doubao.id, out: 'doubao' }, { via: 'openfilm', model: 'elevenlabs/eleven_v4' });
  assert.equal(refused.ok, false);
  assert.match(refused.text, /is the Doubao voice .* speaks only ElevenLabs voices\. Speak it with a model of Doubao \(--via doubao\).*Nothing was sent\./);
  assert.deepEqual(calls.slice(before).filter((c) => c.path !== '/v1/media/models'), []);
}));
