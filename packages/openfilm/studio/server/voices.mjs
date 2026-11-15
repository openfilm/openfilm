// @ts-check
/** The person's private voice library: create, import, refresh, preview and remove a local entry.
 * Cloning never retries a paid/uncertain request. Keys and raw source audio never reach the catalog or the page. */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { HttpError, json, readJson } from './http.mjs';
import { listProjects, studioHome } from './projects.mjs';
import { readable } from './files.mjs';
import { providerKey, readSettings } from './keys.mjs';
import { listProviders } from './providers/index.mjs';
import { failure, serviceUrl } from './providers/common.mjs';
import { keepVoice, newVoice, removeVoice, voiceAssets, voiceConnection, voiceFolder, VOICE_UID } from './voice-store.mjs';

/** @typedef {import('./voice-store.mjs').VoiceAsset} VoiceAsset */
/** @typedef {import('./providers/contract.mjs').RunContext} RunContext */
const exec = promisify(execFile);
const MAX_UPLOAD = 20 << 20;
const TYPES = /** @type {Record<string, string>} */ ({ mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' });
const SUPPORTED = ['elevenlabs', 'doubao'];
const LANGUAGE = /** @type {Record<string, number>} */ ({ zh: 0, en: 1, ja: 2, es: 3, id: 4, pt: 5, de: 6, fr: 7, ko: 8, it: 9, th: 10, vi: 11, ru: 12, fil: 13, ms: 14, ar: 15, pl: 19, tr: 20, sv: 21 });
const clean = (/** @type {unknown} */ value, max = 80) => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';

function service(/** @type {string} */ id) {
  const provider = listProviders().find((p) => p.id === id);
  if (!provider || !SUPPORTED.includes(id)) throw new HttpError(400, 'Choose ElevenLabs or Doubao for your private voice.');
  return provider;
}

async function connection(/** @type {string} */ id) {
  const provider = service(id);
  const settings = await readSettings();
  const key = providerKey(provider, settings)?.key;
  if (!key) throw new HttpError(409, `Connect ${provider.name} in Settings → Services first.`);
  return { provider, key, scope: voiceConnection(id, key) };
}

/** @param {VoiceAsset} asset */
async function connectedAsset(asset) {
  const active = await connection(asset.provider);
  if (active.scope !== asset.connection) throw new HttpError(409, 'This voice belongs to a different service connection. Reconnect the original account or import/sync it with the current account.');
  return active;
}

/** @param {VoiceAsset} asset @param {import('./keys.mjs').ProviderSettings} [settings] */
async function shown(asset, settings) {
  const provider = listProviders().find((p) => p.id === asset.provider);
  const key = provider ? providerKey(provider, settings ?? await readSettings())?.key : null;
  const available = !!key && voiceConnection(asset.provider, key) === asset.connection;
  return { provider: asset.provider, id: `my:${asset.uid}`, uid: asset.uid, name: asset.name, language: asset.language,
    gender: null, age: null, accent: null, description: null, tags: [], sample: null,
    previewUrl: asset.preview ? `/api/voices/${asset.uid}/audio` : null, mine: true, available,
    status: asset.status, models: asset.models, created: asset.created, updated: asset.updated, kind: asset.kind, problem: asset.problem ?? null,
    ...(asset.custom && !asset.activated ? { activationFee: true } : {}) };
}

async function catalog() {
  const settings = await readSettings();
  const services = SUPPORTED.map((id) => {
    const p = service(id);
    return { id, name: p.name, connected: !!providerKey(p, settings),
      models: p.models?.tts ?? [], clone: true, sync: id === 'elevenlabs', minSeconds: 5, maxSeconds: 180,
      pricingUrl: p.pricingUrl, consoleUrl: p.keysUrl };
  });
  return { voices: await Promise.all(voiceAssets().map((v) => shown(v, settings))), services };
}

/** Only remote metadata is accepted; its preview URL is never used with an API key. */
async function request(/** @type {string} */ id, /** @type {string} */ path, /** @type {string} */ key, /** @type {RequestInit} */ init = {}) {
  const base = id === 'elevenlabs' ? serviceUrl('ELEVENLABS', 'https://api.elevenlabs.io') : serviceUrl('DOUBAO_VOICE', 'https://openspeech.bytedance.com');
  const headers = new Headers(init.headers);
  if (id === 'elevenlabs') headers.set('xi-api-key', key);
  else { headers.set('X-Api-Key', key); headers.set('X-Api-Request-Id', randomUUID()); }
  const signal = AbortSignal.timeout(180_000);
  let res;
  try { res = await fetch(`${base}${path}`, { ...init, redirect: 'error', signal, headers }); }
  catch { throw new Error('The voice service was interrupted. The request may have completed: check the service console or sync before creating again. Not retried.'); }
  if (!res.ok) throw Object.assign(await failure(service(id).name, res, /** @type {RunContext} */ ({ key, signal })), { uncertain: res.status >= 500 });
  try { return await res.json(); }
  catch { throw new Error('The voice service returned an incomplete result. Check its console or sync before creating again. Not retried.'); }
}

/** @param {string} id @param {string} path @param {string} key @param {unknown} body */
const post = (id, path, key, body) => request(id, path, key, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** Download a provider-returned preview only from known service storage (or an explicit same-origin test proxy).
 * No user-supplied URL and no credential is accepted here. */
async function savePreview(/** @type {VoiceAsset} */ asset, /** @type {unknown} */ address) {
  if (typeof address !== 'string' || !address) return;
  const url = new URL(address);
  const h = url.hostname.toLowerCase();
  const proxy = asset.provider === 'doubao' ? process.env.OPENFILM_DOUBAO_VOICE_URL : process.env.OPENFILM_ELEVENLABS_URL;
  const atProxy = proxy && new URL(proxy).origin === url.origin;
  if (!atProxy && (url.protocol !== 'https:' || !['bytespeech.com', 'volces.com', 'bytecdn.cn', 'storage.googleapis.com', 'elevenlabs.io'].some((suffix) => h === suffix || h.endsWith(`.${suffix}`)))) return;
  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!res.ok || !res.body) return;
  const chunks = []; let size = 0;
  for await (const chunk of /** @type {AsyncIterable<Uint8Array>} */ (res.body)) {
    size += chunk.length;
    if (size > MAX_UPLOAD) throw new Error('The voice preview exceeded 20 MB.');
    chunks.push(Buffer.from(chunk));
  }
  if (!size) return;
  const type = res.headers.get('content-type') ?? '';
  const ext = /wav/.test(type) ? 'wav' : /ogg/.test(type) ? 'ogg' : /mp4|m4a/.test(type) ? 'm4a' : 'mp3';
  await writeFile(join(voiceFolder(asset.uid), `preview.${ext}`), Buffer.concat(chunks), { mode: 0o600 });
  asset.preview = `preview.${ext}`;
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

/** @param {VoiceAsset} asset @param {any} result */
function applyStatus(asset, result) {
  if (asset.provider === 'doubao') {
    if (result.code !== undefined && result.code !== 0) throw new Error(`Doubao rejected the voice request (${result.code}).`);
    asset.status = result.status === 2 || result.status === 4 ? 'ready' : result.status === 1 ? 'training' : result.status === 3 ? 'failed' : 'uncertain';
    if (result.status === 4) asset.activated = true;
    if (Number.isInteger(result.language)) asset.language = Object.entries(LANGUAGE).find(([, code]) => code === result.language)?.[0] ?? asset.language;
  } else {
    const verification = result.voice_verification;
    asset.status = result.requires_verification || (verification?.requires_verification && !verification?.is_verified) ? 'verification' : 'ready';
  }
  delete asset.problem;
}

const speaker = (/** @type {VoiceAsset} */ asset) => asset.custom ? { speaker_id: 'custom_speaker_id', custom_speaker_id: asset.voiceId } : { speaker_id: asset.voiceId };

/** @param {VoiceAsset} asset */
async function refresh(asset) {
  const active = await connectedAsset(asset);
  const result = asset.provider === 'doubao'
    ? await post('doubao', '/api/v3/tts/get_voice', active.key, speaker(asset))
    : await request('elevenlabs', `/v1/voices/${encodeURIComponent(asset.voiceId)}`, active.key);
  applyStatus(asset, result);
  const demo = asset.provider === 'doubao' ? result.speaker_status?.find((/** @type {any} */ s) => s.model_type === 5)?.demo_audio : result.preview_url;
  await savePreview(asset, demo).catch(() => {});
  await keepVoice(asset);
  return asset;
}

/** Resolve a private alias before any provider is selected, including agent/CLI synthesis. */
export async function privateVoiceForSpeech(/** @type {string} */ alias, /** @type {import('./keys.mjs').ProviderSettings | undefined} */ settings) {
  const uid = alias.slice(3);
  const asset = voiceAssets().find((v) => v.uid === uid);
  if (!asset) throw new Error('This private voice no longer exists. Choose another voice in the library.');
  if (settings) {
    const key = providerKey(service(asset.provider), settings)?.key;
    if (!key || voiceConnection(asset.provider, key) !== asset.connection) throw new Error('This private voice belongs to another service connection. Reconnect or import it before using it.');
  } else await connectedAsset(asset);
  if (asset.status !== 'ready') throw new Error('This private voice is not ready. Refresh it or complete verification in My voices.');
  return asset;
}

/** @param {import('./http.mjs').Req} req @param {import('./http.mjs').Res} res @param {string[]} parts */
export async function voicesRoute(req, res, parts) {
  if (!parts.length && req.method === 'GET') return json(res, 200, await catalog());
  if (!parts.length && req.method === 'POST') {
    const body = await readJson(req, 29 << 20);
    const provider = clean(body.provider);
    const active = await connection(provider);
    const name = clean(body.name);
    if (!name || body.consent !== true) throw new HttpError(400, 'Name the voice and confirm you have permission to create and use it.');
    const audio = await sample(body);
    const language = clean(body.language, 20) || 'zh';
    if (provider === 'doubao' && LANGUAGE[language] === undefined) throw new HttpError(400, 'Choose a language supported by Doubao voice cloning.');
    const prepaid = clean(body.speakerId, 256);
    if (provider === 'doubao' && prepaid && !/^S_[A-Za-z0-9_-]+$/.test(prepaid)) throw new HttpError(400, 'Use a prepaid speaker ID from the Doubao console, or leave it blank for a new custom voice.');
    const asset = await newVoice({ provider, voiceId: provider === 'doubao' ? prepaid || `ofvoice_${randomUUID().replaceAll('-', '')}` : '',
      connection: active.scope, name, language, status: 'creating', models: provider === 'doubao' ? ['seed-icl-2.0'] : (active.provider.models?.tts ?? []).map((m) => m.id),
      kind: 'clone', consentAt: Date.now(), ...(provider === 'doubao' ? { custom: !prepaid } : {}) });
    try {
      if (provider === 'elevenlabs') {
        const form = new FormData();
        form.set('name', name); form.set('labels', JSON.stringify({ language }));
        form.append('files', new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (audio.bytes)], { type: 'audio/wav' }), 'reference.wav');
        const result = await request(provider, '/v1/voices/add', active.key, { method: 'POST', body: form });
        if (typeof result.voice_id !== 'string' || !result.voice_id) throw new Error('The service returned no voice ID. Check its console or sync before creating again.');
        asset.voiceId = result.voice_id; applyStatus(asset, result);
      } else {
        const demoText = clean(body.previewText, 300) || (language === 'zh' ? '你好，这是我的声音，很高兴和你一起讲述新的故事。' : language === 'en' ? 'Hello, this is my voice. Welcome to a new story.' : '');
        const result = await post(provider, '/api/v3/tts/voice_clone', active.key, { ...speaker(asset), language: LANGUAGE[language],
          audio: { data: Buffer.from(audio.bytes).toString('base64'), format: 'wav' },
          extra_params: demoText ? { demo_text: demoText } : {} });
        applyStatus(asset, result);
        const demo = result.speaker_status?.find((/** @type {any} */ s) => s.model_type === 5)?.demo_audio;
        await savePreview(asset, demo).catch(() => {});
      }
      await keepVoice(asset);
      return json(res, 200, { voice: await shown(asset) });
    } catch (e) {
      asset.status = asset.voiceId && provider === 'elevenlabs' && asset.status !== 'creating' ? asset.status : /** @type {{ uncertain?: boolean }} */ (e).uncertain === false ? 'failed' : 'uncertain';
      asset.problem = clean(/** @type {Error} */ (e).message, 500).split(active.key).join('•••');
      await keepVoice(asset);
      throw new HttpError(502, asset.problem, { voice: await shown(asset) });
    }
  }
  if (parts.length === 1 && parts[0] === 'import' && req.method === 'POST') {
    const body = await readJson(req);
    const id = clean(body.provider); const voiceId = clean(body.voiceId, 256);
    if (!voiceId) throw new HttpError(400, 'Enter the voice ID from the service console.');
    const active = await connection(id);
    const existing = voiceAssets().find((v) => v.provider === id && v.voiceId === voiceId && v.connection === active.scope);
    const asset = existing ?? await newVoice({ provider: id, voiceId, connection: active.scope, name: clean(body.name) || voiceId, language: null,
      models: id === 'doubao' ? ['seed-icl-2.0'] : (active.provider.models?.tts ?? []).map((m) => m.id), kind: 'import', status: 'training',
      ...(id === 'doubao' ? { custom: !voiceId.startsWith('S_') } : {}) });
    try { await refresh(asset); }
    catch (error) {
      asset.status = 'failed'; asset.problem = clean(/** @type {Error} */ (error).message, 500).split(active.key).join('•••');
      await keepVoice(asset);
      throw new HttpError(502, asset.problem);
    }
    return json(res, 200, { voice: await shown(asset) });
  }
  if (parts.length === 1 && parts[0] === 'sync' && req.method === 'POST') {
    const body = await readJson(req); const id = clean(body.provider); const active = await connection(id);
    if (id === 'doubao') {
      for (const v of voiceAssets().filter((v) => v.provider === id && v.connection === active.scope && v.voiceId)) await refresh(v);
    } else {
      let cursor = '';
      const pages = new Set();
      for (let page = 0; page < 20; page++) {
        const query = new URLSearchParams({ page_size: '100', ...(cursor ? { next_page_token: cursor } : {}) });
        const result = await request(id, `/v2/voices?${query}`, active.key);
        for (const v of result.voices ?? []) {
          if (!['cloned', 'professional', 'generated'].includes(v.category) || v.is_owner === false || !v.voice_id) continue;
          let asset = voiceAssets().find((a) => a.provider === id && a.voiceId === v.voice_id && a.connection === active.scope);
          asset ??= await newVoice({ provider: id, voiceId: v.voice_id, connection: active.scope, name: clean(v.name) || v.voice_id,
            language: clean(v.labels?.language, 20) || null, models: (active.provider.models?.tts ?? []).map((m) => m.id), kind: 'import', status: 'ready' });
          applyStatus(asset, v); await savePreview(asset, v.preview_url).catch(() => {}); await keepVoice(asset);
        }
        if (!result.has_more || !result.next_page_token || pages.has(result.next_page_token)) break;
        cursor = result.next_page_token; pages.add(cursor);
      }
    }
    return json(res, 200, await catalog());
  }
  const asset = voiceAssets().find((v) => v.uid === parts[0]);
  if (!asset || !VOICE_UID.test(parts[0] ?? '')) throw new HttpError(404, 'This voice was not found.');
  if (parts.length === 2 && parts[1] === 'audio' && req.method === 'GET') {
    if (!asset.preview || !/^preview\.(wav|mp3|ogg|m4a)$/.test(asset.preview)) throw new HttpError(404, 'This voice has no preview yet.');
    const bytes = await readFile(join(voiceFolder(asset.uid), asset.preview));
    res.writeHead(200, { 'content-type': TYPES[asset.preview.split('.').pop() ?? 'mp3'], 'cache-control': 'private, no-store' });
    return res.end(bytes);
  }
  if (parts.length === 2 && parts[1] === 'refresh' && req.method === 'POST') return json(res, 200, { voice: await shown(await refresh(asset)) });
  if (parts.length === 2 && parts[1] === 'preview' && req.method === 'POST') {
    const body = await readJson(req); const text = clean(body.text, 300);
    if (!text) throw new HttpError(400, 'Write a short preview passage.');
    const active = await connectedAsset(asset);
    if (asset.status !== 'ready') throw new HttpError(409, 'This voice is not ready to speak.');
    if (asset.custom && !asset.activated && body.activate !== true) throw new HttpError(409, 'Formal synthesis activates this custom voice and may charge a voice slot. Confirm before continuing.');
    const result = await active.provider.run('tts', { text, voice: asset.voiceId, language: asset.language, out: 'preview' }, {
      key: active.key, root: voiceFolder(asset.uid), model: asset.models[0], signal: AbortSignal.timeout(180_000), say: () => {}, read: async () => { throw new Error('No source audio is retained.'); },
    });
    const file = result.files[0];
    if (!file || !('bytes' in file) || !file.bytes.length) throw new HttpError(502, 'The service returned no preview audio.');
    const ext = file.path.endsWith('.wav') ? 'wav' : 'mp3';
    await writeFile(join(voiceFolder(asset.uid), `preview.${ext}`), file.bytes, { mode: 0o600 }); asset.preview = `preview.${ext}`;
    asset.activated = true;
    await keepVoice(asset);
    return json(res, 200, { voice: await shown(asset) });
  }
  if (parts.length === 1 && req.method === 'PATCH') {
    const body = await readJson(req); const name = clean(body.name);
    if (!name) throw new HttpError(400, 'Name the voice.');
    asset.name = name; await keepVoice(asset); return json(res, 200, { voice: await shown(asset) });
  }
  if (parts.length === 1 && req.method === 'DELETE') {
    if (asset.status === 'creating') throw new HttpError(409, 'Wait for the service request to finish before removing this voice.');
    await removeVoice(asset.uid); return json(res, 200, {});
  }
  throw new HttpError(404, 'No such voice action.');
}
