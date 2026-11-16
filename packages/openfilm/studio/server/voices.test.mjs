import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStudio } from './server.mjs';
import { agentKeyOf } from './projects.mjs';
import { voiceAssets, voiceFolder } from './voice-store.mjs';
import { libraryVoices } from './library.mjs';
import { wav } from './providers/common.mjs';

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'of-private-voices-'));
  const vars = ['OPENFILM_HOME', 'OPENFILM_SHARED_HOME', 'OPENFILM_LIBRARY', 'OPENFILM_TRASH_DIR', 'OPENFILM_API_URL',
    'OPENFILM_ELEVENLABS_URL', 'OPENFILM_DOUBAO_VOICE_URL', 'OPENFILM_DOUBAO_TTS_URL', 'ELEVENLABS_API_KEY', 'DOUBAO_SPEECH_API_KEY', 'DOUBAO_ASR_API_KEY'];
  const previous = new Map(vars.map((name) => [name, process.env[name]]));
  const calls = [];
  const control = { verification: false, failClone: false, rejectClone: false, training: false, redirect: false };
  let upstream, studio, origin;
  try {
    process.env.OPENFILM_HOME = join(dir, 'home');
    process.env.OPENFILM_SHARED_HOME = join(dir, 'shared');
    process.env.OPENFILM_LIBRARY = join(dir, 'projects');
    process.env.OPENFILM_TRASH_DIR = join(dir, 'trash');
    process.env.OPENFILM_API_URL = 'http://127.0.0.1:9';
    delete process.env.ELEVENLABS_API_KEY; delete process.env.DOUBAO_SPEECH_API_KEY; delete process.env.DOUBAO_ASR_API_KEY;
    await mkdir(process.env.OPENFILM_TRASH_DIR, { recursive: true });
    upstream = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const call = { path: req.url, headers: req.headers, method: req.method, body: Buffer.concat(chunks) }; calls.push(call);
      const respond = (body, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      if (req.url === '/v1/voices/add') {
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
      else if (req.url === '/api/v3/tts/voice_clone' || req.url === '/api/v3/tts/get_voice') respond({ status: control.training ? 1 : 2, speaker_status: [{ model_type: 5, demo_audio: `${origin}/demo` }] });
      else if (req.url === '/demo') res.writeHead(200, { 'content-type': 'audio/wav' }).end(wav(new Uint8Array(48000), 24000));
      else if (req.url === '/api/v3/tts/unidirectional') {
        res.writeHead(200, { 'content-type': 'application/json' });
        const pcm = Buffer.alloc(48000);
        const one = JSON.stringify({ code: 0, data: pcm.subarray(0, 24000).toString('base64'), sentence: { words: [{ word: '你好', startTime: 0.1, endTime: 0.8 }] } });
        const two = JSON.stringify({ code: 0, data: pcm.subarray(24000).toString('base64') });
        res.write(one.slice(0, 111)); res.end(`${one.slice(111)}\n${two}\n`);
      } else if (req.url.startsWith('/v1/text-to-speech/')) respond({ audio_base64: Buffer.alloc(16000, 1).toString('base64') });
      else respond({}, 404);
    });
    await new Promise((done) => upstream.listen(0, '127.0.0.1', done)); origin = `http://127.0.0.1:${upstream.address().port}`;
    process.env.OPENFILM_ELEVENLABS_URL = origin; process.env.OPENFILM_DOUBAO_VOICE_URL = origin; process.env.OPENFILM_DOUBAO_TTS_URL = `${origin}/api/v3/tts/unidirectional`;
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    const call = async (path, method = 'GET', body, expected = 200, key = studio.key) => {
      const res = await fetch(`${studio.origin}/api/${path}`, { method, headers: { 'x-studio-key': key, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await res.json(); assert.equal(res.status, expected, JSON.stringify(result)); return result;
    };
    await call('providers/elevenlabs/key', 'PUT', { key: 'fake-eleven-connection-A' });
    await call('providers/doubao/key', 'PUT', { key: 'fake-doubao-connection-A' });
    const audio = { data: Buffer.from(wav(new Uint8Array(6 * 48000), 24000)).toString('base64') };
    await run({ call, calls, control, audio, dir, studio });
  } finally {
    await studio?.close(); await new Promise((done) => upstream ? upstream.close(done) : done());
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(dir, { recursive: true, force: true });
  }
}

test('clone recordings become private reusable voices; consent, persistence, preview, favorites and account isolation', () => fixture(async ({ call, calls, audio, studio }) => {
  await call('voices', 'POST', { provider: 'elevenlabs', name: 'No consent', audio }, 400);
  assert.equal(calls.length, 0, 'nothing is uploaded without consent');
  await call('voices', 'POST', { provider: 'elevenlabs', name: 'Agent request', consent: true, audio }, 403, agentKeyOf(studio.key));
  const { voice } = await call('voices', 'POST', { provider: 'elevenlabs', name: 'My narrator', consent: true, language: 'en', audio });
  assert.equal(voice.status, 'ready'); assert.match(voice.id, /^my:/); assert.equal(voice.available, true);
  assert.equal(voice.provider, 'elevenlabs'); assert.ok(!JSON.stringify(voice).includes('fake-eleven'));
  const sent = calls[0]; assert.equal(sent.path, '/v1/voices/add');
  const form = await new Request('http://local', { method: 'POST', headers: { 'content-type': sent.headers['content-type'] }, body: sent.body }).formData();
  assert.equal(form.get('name'), 'My narrator'); assert.equal(form.get('files').type, 'audio/wav');
  assert.equal((await readdir(join(process.env.OPENFILM_HOME, 'voice-upload'))).length, 0, 'source recordings are removed');
  const disk = await readFile(join(voiceFolder(voice.uid), 'voice.json'), 'utf8');
  assert.ok(!disk.includes('fake-eleven')); assert.ok(!disk.includes(audio.data));
  await call(`voices/${voice.uid}`, 'PATCH', { name: 'Renamed' });
  assert.equal((await call('voices')).voices[0].name, 'Renamed');
  const key = `voice:${voice.provider}/${voice.id}`;
  assert.deepEqual((await call('library/favorites', 'PUT', { ids: [key] })).ids, [key]);
  const preview = await call(`voices/${voice.uid}/preview`, 'POST', { text: 'Hello.' });
  assert.ok(preview.voice.previewUrl);
  const sample = await fetch(`${studio.origin}${preview.voice.previewUrl}`, { headers: { 'x-studio-key': studio.key } });
  assert.equal((await sample.arrayBuffer()).byteLength, 16000);
  const { project } = await call('projects', 'POST', { name: 'Voice test' });
  const made = await call('get', 'POST', { folder: project.path, verb: 'tts', via: 'elevenlabs', args: { text: 'Hello.', voice: voice.id, out: 'hello' } });
  assert.equal(made.ok, true); assert.ok(JSON.parse(made.text).src.endsWith('.mp3'));
  await call('providers/elevenlabs/key', 'PUT', { key: 'fake-eleven-connection-B' });
  assert.equal((await call('voices')).voices[0].available, false);
  await call(`voices/${voice.uid}/preview`, 'POST', { text: 'Hello.' }, 409);
  const before = calls.length;
  const blocked = await call('get', 'POST', { folder: project.path, verb: 'tts', args: { text: 'Hello.', voice: voice.id, out: 'blocked' } });
  assert.equal(blocked.ok, false); assert.equal(calls.length, before);
}));

test('Doubao registers a custom voice without activating it; registration previews and formal TTS have separate paths', () => fixture(async ({ call, calls, audio }) => {
  const { voice } = await call('voices', 'POST', { provider: 'doubao', name: '我的旁白', language: 'zh', consent: true, audio });
  assert.equal(voice.status, 'ready'); assert.equal(voice.activationFee, true); assert.ok(voice.previewUrl);
  const sent = calls.find((c) => c.path === '/api/v3/tts/voice_clone'); const request = JSON.parse(sent.body);
  assert.equal(request.speaker_id, 'custom_speaker_id'); assert.match(request.custom_speaker_id, /^ofvoice_/);
  assert.equal(request.audio.format, 'wav'); assert.equal(request.language, 0);
  assert.ok(!calls.some((c) => c.path === '/api/v3/tts/unidirectional'));
  await call(`voices/${voice.uid}/preview`, 'POST', { text: '你好。' }, 409);
  const activated = await call(`voices/${voice.uid}/preview`, 'POST', { text: '你好。', activate: true });
  assert.equal(activated.voice.activationFee, undefined, 'a successfully activated voice stops asking for a slot fee');
  const tts = calls.find((c) => c.path === '/api/v3/tts/unidirectional');
  assert.equal(tts.headers['x-api-resource-id'], 'seed-icl-2.0');
  assert.equal(JSON.parse(tts.body).req_params.speaker, request.custom_speaker_id);
  const { project } = await call('projects', 'POST', { name: '中文旁白' });
  const made = await call('get', 'POST', { folder: project.path, verb: 'tts', args: { text: '你好', voice: voice.id, out: 'narration' } });
  assert.equal(made.ok, true); const receipt = JSON.parse(made.text); assert.equal(receipt.dur, 1);
  const vtt = await readFile(join(project.path, receipt.src.replace(/\.wav$/, '.vtt')), 'utf8'); assert.ok(vtt.includes('你好'));
}));

test('sync is idempotent and excludes stock and other users’ voices; import and verification can recover', () => fixture(async ({ call, calls, audio, control }) => {
  control.verification = true;
  const created = await call('voices', 'POST', { provider: 'elevenlabs', name: 'Mine', consent: true, audio });
  assert.equal(created.voice.status, 'verification');
  await call(`voices/${created.voice.uid}/preview`, 'POST', { text: 'Hello' }, 409);
  control.verification = false;
  assert.equal((await call(`voices/${created.voice.uid}/refresh`, 'POST')).voice.status, 'ready');
  await call('voices/sync', 'POST', { provider: 'elevenlabs' }); await call('voices/sync', 'POST', { provider: 'elevenlabs' });
  assert.equal((await call('voices')).voices.length, 1);
  const imported = await call('voices/import', 'POST', { provider: 'elevenlabs', voiceId: 'own-voice', name: 'Existing' });
  assert.equal(imported.voice.uid, created.voice.uid);
  const before = calls.length; await call(`voices/${created.voice.uid}`, 'DELETE'); assert.equal(calls.length, before, 'removal does not delete a remote voice');
  assert.equal(voiceAssets().length, 0); assert.ok((await readdir(process.env.OPENFILM_TRASH_DIR)).length);
}));

test('uncertain and redirected creation is never retried and source bytes are discarded', () => fixture(async ({ call, calls, audio, control }) => {
  control.failClone = true;
  const failed = await call('voices', 'POST', { provider: 'elevenlabs', name: 'Uncertain', consent: true, audio }, 502);
  assert.match(failed.error, /Not retried/); assert.equal(calls.length, 1);
  assert.equal((await call('voices')).voices[0].status, 'uncertain');
  control.failClone = false; control.redirect = true;
  await call('voices', 'POST', { provider: 'elevenlabs', name: 'Redirect', consent: true, audio }, 502);
  assert.equal(calls.length, 2); assert.ok(!calls.some((c) => c.path === '/never'));
  assert.deepEqual(await readdir(join(process.env.OPENFILM_HOME, 'voice-upload')), []);
}));

test('definite rejection stays failed; a creation interrupted by a restart becomes recoverable', () => fixture(async ({ call, calls, audio, control }) => {
  control.rejectClone = true;
  await call('voices', 'POST', { provider: 'elevenlabs', name: 'Rejected', consent: true, audio }, 502);
  assert.equal(calls.length, 1);
  assert.equal((await call('voices')).voices[0].status, 'failed');
  const asset = voiceAssets()[0];
  await writeFile(join(voiceFolder(asset.uid), 'voice.json'), JSON.stringify({ ...asset, status: 'creating', updated: Date.now() - 300_000 }));
  assert.equal((await call('voices')).voices[0].status, 'uncertain');
  await call(`voices/${asset.uid}`, 'DELETE');
  assert.equal(voiceAssets().length, 0);
}));

test('non-Chinese or English cloned speech omits the unsupported subtitle option', () => fixture(async ({ call, calls, audio }) => {
  const { voice } = await call('voices', 'POST', { provider: 'doubao', name: 'Japanese voice', language: 'ja', consent: true, audio });
  await call(`voices/${voice.uid}/preview`, 'POST', { text: 'こんにちは。', activate: true });
  const request = JSON.parse(calls.find((c) => c.path === '/api/v3/tts/unidirectional').body);
  assert.equal(request.req_params.audio_params.enable_subtitle, undefined);
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
