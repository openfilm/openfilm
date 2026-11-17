// @ts-check
/** The person's private voices, OpenFilm's own service: make, preview, rename and remove a local entry.
 * A voice is its recording, kept here (`sample.wav`) and sent with each line spoken in it; the service clones it at
 * the engine chosen (Inworld by default, ElevenLabs) and keeps that clone while it has room. Removing a voice asks the
 * service to delete its clones too (asked again later when it cannot be reached). Keys and the recording never reach
 * the catalog or the page. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { HttpError, json, readJson } from './http.mjs';
import { listProjects, studioHome } from './projects.mjs';
import { readable } from './files.mjs';
import { providerKey, readSettings } from './keys.mjs';
import { listProviders } from './providers/index.mjs';
import { forgetVoices } from './providers/openfilm.mjs';
import { writeAtomic } from './atomic.mjs';
import { keepVoice, newVoice, removeVoice, voiceAssets, voiceFolder, voicesRoot, VOICE_UID } from './voice-store.mjs';

/** @typedef {import('./voice-store.mjs').VoiceAsset} VoiceAsset */
/** @typedef {import('./providers/contract.mjs').RunContext} RunContext */
const exec = promisify(execFile);
const MAX_UPLOAD = 20 << 20;
const TYPES = /** @type {Record<string, string>} */ ({ mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' });
/** The name the run sends a voice's recording under (the service never sees where it is kept). */
export const SAMPLE_INPUT = 'voice-sample.wav';
const clean = (/** @type {unknown} */ value, max = 80) => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';

/** OpenFilm's service, signed in or not. */
const service = () => {
  const provider = listProviders().find((p) => p.id === 'openfilm');
  if (!provider) throw new HttpError(503, 'OpenFilm\'s service is not available in this build.');
  return provider;
};

/** The signed-in OpenFilm connection; any OpenFilm account speaks a voice, as the voice is its recording. */
async function connection() {
  const provider = service();
  const key = providerKey(provider, await readSettings())?.key;
  if (!key) throw new HttpError(409, 'Sign in to OpenFilm in Settings → Services first: your voices are made and spoken by OpenFilm\'s service.');
  return { provider, key };
}

/**
 * The engines OpenFilm's service clones voices with, as it offers them now: its voice-over models that take a
 * recording (`clones`), by maker, Inworld first.
 */
async function engines() {
  const provider = service();
  await provider.refresh?.();
  /** @type {Map<string, { id: string, name: string, models: string[] }>} */
  const by = new Map();
  for (const m of /** @type {{ id: string, name: string, clones?: string }[]} */ (provider.models?.tts ?? [])) {
    if (!m.clones) continue;
    const id = m.id.slice(0, m.id.indexOf('/'));
    const engine = by.get(id) ?? { id, name: id === 'inworld' ? 'Inworld' : id === 'elevenlabs' ? 'ElevenLabs' : id, models: [] };
    engine.models.push(m.id); by.set(id, engine);
  }
  return [...by.values()].sort((a, b) => Number(b.id === 'inworld') - Number(a.id === 'inworld'));
}

/** @param {VoiceAsset} asset @param {boolean} signedIn */
function shown(asset, signedIn) {
  return { provider: asset.provider, id: `my:${asset.uid}`, uid: asset.uid, name: asset.name, language: asset.language,
    gender: null, age: null, accent: null, description: null, tags: [], sample: null,
    previewUrl: asset.preview ? `/api/voices/${asset.uid}/audio` : null, mine: true, available: signedIn && asset.provider === 'openfilm',
    status: asset.status, models: asset.models, created: asset.created, updated: asset.updated, kind: asset.kind, problem: asset.problem ?? null,
    ...(asset.engine ? { engine: asset.engine } : {}) };
}

/** Whether OpenFilm is signed in here. */
const signedIn = async () => !!providerKey(service(), await readSettings())?.key;

async function catalog() {
  const connected = await signedIn();
  if (connected) await forgetPending().catch(() => {});
  const offered = await engines();
  return { voices: voiceAssets().map((v) => shown(v, connected)),
    services: [{ id: 'openfilm', name: 'OpenFilm', connected, models: [], clone: offered.length > 0, sync: false, import: false,
      minSeconds: 5, maxSeconds: 180, engines: offered, consoleUrl: service().keysUrl }] };
}

/** The recordings of removed voices whose clones the service has not deleted yet: their SHA-256, asked again. */
const pendingFile = () => join(voicesRoot(), 'forget.json');
async function readPending() {
  try { const value = JSON.parse(await readFile(pendingFile(), 'utf8')); return Array.isArray(value) ? value.filter((h) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)) : []; }
  catch { return []; }
}
async function forgetPending(/** @type {string[]} */ more = []) {
  const all = [...new Set([...(await readPending()), ...more])];
  if (!all.length) return;
  let left = all;
  try {
    const { key } = await connection();
    await forgetVoices(key, all);
    left = [];
  } finally {
    await mkdir(voicesRoot(), { recursive: true, mode: 0o700 });
    await writeAtomic(pendingFile(), JSON.stringify(left), { mode: 0o600 });
  }
}

/** Convert browser recordings/uploads or an explicitly selected project segment to bounded mono PCM.
 * All temporary source bytes are removed, including when a service fails. */
async function sample(/** @type {any} */ body) {
  await mkdir(join(studioHome(), 'voice-upload'), { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(join(studioHome(), 'voice-upload', 'sample-'));
  try {
    let input;
    if (body.project) {
      const project = (await listProjects()).find((p) => p.id === body.project.id);
      if (!project) throw new HttpError(404, 'The source project was not found.');
      const path = clean(body.project.path, 1000);
      if (!/\.(wav|mp3|mp4|m4a|mov|webm|weba|ogg|flac|aac)$/i.test(path)) throw new HttpError(400, 'Choose an audio or video file in the project.');
      input = readable(project.path, path);
    } else {
      const data = body.audio?.data;
      if (typeof data !== 'string' || data.length > Math.ceil(MAX_UPLOAD * 4 / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new HttpError(400, 'Choose an audio recording smaller than 20 MB.');
      const bytes = Buffer.from(data, 'base64');
      if (!bytes.length || bytes.length > MAX_UPLOAD) throw new HttpError(413, 'The recording must be smaller than 20 MB.');
      input = join(dir, 'source');
      await writeFile(input, bytes, { mode: 0o600 });
    }
    const start = Number(body.start ?? 0);
    const end = body.end == null || body.end === '' ? null : Number(body.end);
    if (!Number.isFinite(start) || start < 0 || (end !== null && (!Number.isFinite(end) || end <= start || end - start > 180))) throw new HttpError(400, 'Choose a recording segment between 5 and 180 seconds.');
    const duration = end === null ? 181 : end - start;
    let bytes;
    try {
      const result = await exec('ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe',
        '-format_whitelist', 'wav,mp3,mov,ogg,matroska,webm,flac,aac', '-ss', String(start), '-i', input, '-t', String(duration),
        '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 9 << 20, timeout: 45_000, windowsHide: true });
      bytes = result.stdout;
    } catch { throw new HttpError(400, 'The recording could not be read. Choose a valid audio file and make sure ffmpeg is installed.'); }
    const seconds = bytes.length / 48000;
    if (seconds < 5 || seconds > 180.05) throw new HttpError(400, 'Use 5–180 seconds of clear speech, or select a shorter segment.');
    const { wav } = await import('./providers/common.mjs');
    return { bytes: wav(new Uint8Array(bytes), 24000), seconds };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** A voice is ready while its recording is here. @param {VoiceAsset} asset */
async function refresh(asset) {
  if (asset.provider !== 'openfilm') throw new HttpError(409, 'Voices are made with OpenFilm\'s service now. Make this one again from its recording.');
  asset.status = existsSync(join(voiceFolder(asset.uid), 'sample.wav')) ? 'ready' : 'failed';
  await keepVoice(asset);
  return asset;
}

/** Resolve a private alias before any provider is selected, including agent/CLI synthesis. */
export async function privateVoiceForSpeech(/** @type {string} */ alias, /** @type {import('./keys.mjs').ProviderSettings | undefined} */ settings) {
  const uid = alias.slice(3);
  const asset = voiceAssets().find((v) => v.uid === uid);
  if (!asset) throw new Error('This private voice no longer exists. Choose another voice in the library.');
  if (asset.provider !== 'openfilm') throw new Error('Voices are made with OpenFilm\'s service now. Make this one again from its recording in My voices.');
  if (!providerKey(service(), settings ?? await readSettings())?.key) throw new Error('Sign in to OpenFilm in Settings → Services to use this voice.');
  if (asset.status !== 'ready') throw new Error('This private voice is not ready. Make it again in My voices.');
  return asset;
}

/** @param {import('./http.mjs').Req} req @param {import('./http.mjs').Res} res @param {string[]} parts */
export async function voicesRoute(req, res, parts) {
  if (!parts.length && req.method === 'GET') return json(res, 200, await catalog());
  if (!parts.length && req.method === 'POST') {
    const body = await readJson(req, 29 << 20);
    if (clean(body.provider) && clean(body.provider) !== 'openfilm') throw new HttpError(400, 'Voices are cloned with OpenFilm\'s service only.');
    await connection();
    const name = clean(body.name);
    if (!name || body.consent !== true) throw new HttpError(400, 'Name the voice and confirm you have permission to create and use it.');
    const language = clean(body.language, 20) || 'zh';
    const engine = (await engines()).find((e) => e.id === (clean(body.engine) || 'inworld'));
    if (!engine) throw new HttpError(400, 'OpenFilm does not clone voices with this engine now. Choose another.');
    const audio = await sample(body);
    const asset = await newVoice({ provider: 'openfilm', voiceId: '', connection: 'openfilm', name, language, status: 'creating', models: engine.models,
      kind: 'clone', consentAt: Date.now(), engine: engine.id });
    await writeFile(join(voiceFolder(asset.uid), 'sample.wav'), audio.bytes, { mode: 0o600 });
    asset.status = 'ready';
    await keepVoice(asset);
    return json(res, 200, { voice: shown(asset, true) });
  }
  const asset = voiceAssets().find((v) => v.uid === parts[0]);
  if (!asset || !VOICE_UID.test(parts[0] ?? '')) throw new HttpError(404, 'This voice was not found.');
  if (parts.length === 2 && parts[1] === 'audio' && req.method === 'GET') {
    if (!asset.preview || !/^preview\.(wav|mp3|ogg|m4a)$/.test(asset.preview)) throw new HttpError(404, 'This voice has no preview yet.');
    const bytes = await readFile(join(voiceFolder(asset.uid), asset.preview));
    res.writeHead(200, { 'content-type': TYPES[asset.preview.split('.').pop() ?? 'mp3'], 'cache-control': 'private, no-store' });
    return res.end(bytes);
  }
  if (parts.length === 2 && parts[1] === 'refresh' && req.method === 'POST') return json(res, 200, { voice: shown(await refresh(asset), await signedIn()) });
  if (parts.length === 2 && parts[1] === 'preview' && req.method === 'POST') {
    const body = await readJson(req); const text = clean(body.text, 300);
    if (!text) throw new HttpError(400, 'Write a short preview passage.');
    const active = await connection();
    if (asset.provider !== 'openfilm' || asset.status !== 'ready') throw new HttpError(409, 'This voice is not ready to speak.');
    const result = await active.provider.run('tts', { text, voice: `my:${asset.uid}`, 'voice-sample': SAMPLE_INPUT, language: asset.language, out: 'preview' }, {
      key: active.key, root: '', model: asset.models[0], signal: AbortSignal.timeout(180_000), say: () => {},
      read: async (path) => { if (path === SAMPLE_INPUT) return readFile(join(voiceFolder(asset.uid), 'sample.wav')); throw new Error('No other audio is read here.'); } });
    try {
      const file = result.files[0];
      if (!file || !('bytes' in file) || !file.bytes.length) throw new HttpError(502, 'The service returned no preview audio.');
      const ext = file.path.endsWith('.wav') ? 'wav' : 'mp3';
      await writeFile(join(voiceFolder(asset.uid), `preview.${ext}`), file.bytes, { mode: 0o600 }); asset.preview = `preview.${ext}`;
      await result.complete?.();
    } finally { await result.cleanup?.(); }
    await keepVoice(asset);
    return json(res, 200, { voice: shown(asset, true) });
  }
  if (parts.length === 1 && req.method === 'PATCH') {
    const body = await readJson(req); const name = clean(body.name);
    if (!name) throw new HttpError(400, 'Name the voice.');
    asset.name = name; await keepVoice(asset); return json(res, 200, { voice: shown(asset, await signedIn()) });
  }
  if (parts.length === 1 && req.method === 'DELETE') {
    if (asset.status === 'creating') throw new HttpError(409, 'Wait for the service request to finish before removing this voice.');
    /* the service deletes its clones of this recording too: now, or when it can next be asked */
    const recording = await readFile(join(voiceFolder(asset.uid), 'sample.wav')).catch(() => null);
    await removeVoice(asset.uid);
    if (recording) await forgetPending([createHash('sha256').update(recording).digest('hex')]).catch(() => {});
    return json(res, 200, {});
  }
  throw new HttpError(404, 'No such voice action.');
}
