import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changeSettings, cleanKey, modelFor, providerKey, providersFile, readSettings } from './keys.mjs';
import { listProviders } from './providers/index.mjs';
import { startStudio } from './server.mjs';

const KEY = 'xi-secret-key-abcdef1234';
let studio;
const opened = [];
before(async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'of-keys-'));
  process.env.OPENFILM_HOME = join(scratch, 'home');
  process.env.OPENFILM_LIBRARY = join(scratch, 'library');
  for (const name of ['ELEVENLABS_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'FAL_KEY', 'PEXELS_API_KEY', 'PIXABAY_API_KEY', 'BRAVE_API_KEY', 'TAVILY_API_KEY', 'GROQ_API_KEY', 'AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION', 'KEENABLE_API_KEY']) delete process.env[name];
  studio = await startStudio({ port: 0, openBrowser: (url) => opened.push(url) });
});
after(() => studio.close());

const api = (path, { method = 'GET', body } = {}) => fetch(`${studio.origin}${path}`, {
  method, headers: { 'x-studio-key': studio.key, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
});
const elevenlabs = { id: 'elevenlabs', env: 'ELEVENLABS_API_KEY' };
const google = { id: 'google', env: 'GEMINI_API_KEY' };

test('keys are kept in a file only this user can read, in a folder only this user can open; loosened, it is repaired', async () => {
  await changeSettings((s) => { s.keys.elevenlabs = KEY; });
  /* Windows has no file modes: the profile's own permissions keep it */
  if (process.platform !== 'win32') assert.equal(statSync(providersFile()).mode & 0o777, 0o600);
  if (process.platform !== 'win32') assert.equal(statSync(process.env.OPENFILM_HOME).mode & 0o777, 0o700);
  chmodSync(providersFile(), 0o644);
  assert.equal((await readSettings()).keys.elevenlabs, KEY);
  /* Windows has no file modes: the profile's own permissions keep it */
  if (process.platform !== 'win32') assert.equal(statSync(providersFile()).mode & 0o777, 0o600);
  /* changes made together all land */
  await Promise.all([changeSettings((s) => { s.use.tts = 'elevenlabs'; }), changeSettings((s) => { s.use.sfx = 'elevenlabs'; })]);
  assert.deepEqual((await readSettings()).use, { tts: 'elevenlabs', sfx: 'elevenlabs' });
});

test('a key pasted in Studio wins over the environment\'s, which counts unless disconnected; Google\'s goes by either name', () => {
  const kept = { keys: { elevenlabs: 'kept-key-12345678' }, use: {}, model: {}, off: [] };
  assert.deepEqual(providerKey(elevenlabs, kept, {}), { key: 'kept-key-12345678', source: 'file', env: 'ELEVENLABS_API_KEY' });
  assert.deepEqual(providerKey(elevenlabs, kept, { ELEVENLABS_API_KEY: ' env-key-123456 ' }), { key: 'kept-key-12345678', source: 'file', env: 'ELEVENLABS_API_KEY' });
  assert.deepEqual(providerKey(google, kept, { GOOGLE_API_KEY: 'env-google-1234' }), { key: 'env-google-1234', source: 'env', env: 'GOOGLE_API_KEY' });
  assert.equal(providerKey(google, { ...kept, off: ['google'] }, { GOOGLE_API_KEY: 'env-google-1234' }), null);
  assert.equal(providerKey(google, { keys: {}, use: {}, model: {}, off: [] }, {}), null);
});

test('a keyless provider connected without a key has the key \'\'; the environment\'s still lifts its limits; others need one', () => {
  const keenable = { id: 'keenable', env: 'KEENABLE_API_KEY', keyless: true };
  const connected = { keys: { keenable: '' }, use: {}, model: {}, off: [] };
  assert.deepEqual(providerKey(keenable, connected, {}), { key: '', source: 'file', env: 'KEENABLE_API_KEY' });
  assert.deepEqual(providerKey(keenable, connected, { KEENABLE_API_KEY: 'kn-env-0123456789' }), { key: 'kn-env-0123456789', source: 'env', env: 'KEENABLE_API_KEY' });
  assert.equal(providerKey(keenable, { keys: {}, use: {}, model: {}, off: [] }, {}), null, 'not connected');
  assert.equal(providerKey(keenable, { ...connected, off: ['keenable'] }, {}), null);
  assert.equal(providerKey(elevenlabs, { keys: { elevenlabs: '' }, use: {}, model: {}, off: [] }, {}), null);
});

test('a pasted key is trimmed, and refused when it is not one key', () => {
  assert.equal(cleanKey('  sk-0123456789 \n'), 'sk-0123456789');
  for (const bad of ['', 'short', 'two keys-0123456789', 42, null]) assert.throws(() => cleanKey(bad));
});

test('the providers API: keys go in and never come back out; choices for each kind of media', async () => {
  let res = await api('/api/providers/openai/key', { method: 'PUT', body: { key: ' sk-test-ABCDEFGH9876 ' } });
  let text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(!text.includes('sk-test-ABCDEFGH9876') && !text.includes(KEY));
  let state = JSON.parse(text);
  const openai = state.providers.find((p) => p.id === 'openai');
  assert.deepEqual(openai, { id: 'openai', name: 'OpenAI', verbs: ['voice', 'tts', 'image', 'asr', 'translate'], models: listProviders().find((p) => p.id === 'openai').models, keysUrl: 'https://platform.openai.com/api-keys', env: 'OPENAI_API_KEY', envKey: false, source: 'file', last4: '9876' });
  /* a new key takes the kinds nothing serves yet, and only those it can do */
  assert.equal(state.use.image, 'openai');
  assert.equal(state.use['image-search'], null);
  assert.equal(JSON.parse(readFileSync(providersFile(), 'utf8')).keys.openai, 'sk-test-ABCDEFGH9876');

  /* a key in the environment connects its provider; disconnecting it there means it is not used, until connected again */
  process.env.FAL_KEY = 'fal-env-key-00001111';
  try {
    text = await (await api('/api/providers')).text();
    assert.ok(!text.includes('fal-env-key-00001111'));
    assert.deepEqual(JSON.parse(text).providers.find((p) => p.id === 'fal'), { id: 'fal', name: 'fal.ai', verbs: ['image', 'video', 'music', 'sfx'], models: listProviders().find((p) => p.id === 'fal').models, keysUrl: 'https://fal.ai/dashboard/keys', env: 'FAL_KEY', envKey: true, source: 'env', last4: '1111' });
    let fal = (await (await api('/api/providers/fal/key', { method: 'DELETE' })).json()).providers.find((p) => p.id === 'fal');
    assert.deepEqual([fal.source, fal.envKey], [null, true]);
    fal = (await (await api('/api/providers/fal/key', { method: 'PUT', body: { env: true } })).json()).providers.find((p) => p.id === 'fal');
    assert.equal(fal.source, 'env');
  } finally {
    delete process.env.FAL_KEY;
  }
  assert.equal((await api('/api/providers/fal/key', { method: 'PUT', body: { env: true } })).status, 400);

  assert.equal((await api('/api/providers/use', { method: 'PUT', body: { verb: 'image', provider: 'fal' } })).status, 200);
  assert.equal((await api('/api/providers/use', { method: 'PUT', body: { verb: 'video', provider: 'openai' } })).status, 400);
  assert.equal((await api('/api/providers/use', { method: 'PUT', body: { verb: 'voice', provider: 'openai' } })).status, 400);
  state = await (await api('/api/providers/use', { method: 'PUT', body: { verb: 'image', provider: 'openai' } })).json();
  assert.equal(state.use.image, 'openai');

  /* the key removed: what it served is served by nothing */
  state = await (await api('/api/providers/openai/key', { method: 'DELETE' })).json();
  assert.equal(state.providers.find((p) => p.id === 'openai').source, null);
  assert.equal(state.use.image, null);
  assert.equal(JSON.parse(readFileSync(providersFile(), 'utf8')).keys.openai, undefined);

  assert.equal((await api('/api/providers/acme/key', { method: 'PUT', body: { key: 'k-0123456789' } })).status, 404);
  assert.equal((await api('/api/providers/openai/key', { method: 'PUT', body: { key: 'no' } })).status, 400);
  assert.equal((await fetch(`${studio.origin}/api/providers`)).status, 401);
});

test('a keyless provider connects with one click, no key, and takes a key later; the others still need one', async () => {
  let state = await (await api('/api/providers/keenable/key', { method: 'PUT', body: { key: '' } })).json();
  let keenable = state.providers.find((p) => p.id === 'keenable');
  assert.deepEqual([keenable.keyless, keenable.source, keenable.last4], [true, 'file', null]);
  assert.equal(state.use['web-search'], 'keenable', 'connecting fills web search, which nothing served');
  assert.equal(JSON.parse(readFileSync(providersFile(), 'utf8')).keys.keenable, '');
  state = await (await api('/api/providers/keenable/key', { method: 'PUT', body: { key: 'kn-test-12345678' } })).json();
  keenable = state.providers.find((p) => p.id === 'keenable');
  assert.deepEqual([keenable.source, keenable.last4], ['file', '5678']);
  state = await (await api('/api/providers/keenable/key', { method: 'DELETE' })).json();
  assert.equal(state.providers.find((p) => p.id === 'keenable').source, null);
  assert.equal(state.use['web-search'], null);
  assert.equal((await api('/api/providers/tavily/key', { method: 'PUT', body: { key: '' } })).status, 400);
  assert.equal(state.providers.find((p) => p.id === 'tavily').keyless, undefined);
});

test('a provider\'s own page for its balance opens in the person\'s browser, for every provider alike', async () => {
  for (const [id, page] of [['openai', 'https://platform.openai.com/settings/organization/billing'], ['fal', 'https://fal.ai/dashboard/billing'],
    ['elevenlabs', 'https://elevenlabs.io/app/subscription']]) {
    assert.equal((await api(`/api/providers/${id}/billing`, { method: 'POST' })).status, 200);
    assert.equal(opened.at(-1), page);
  }
  assert.equal((await api('/api/providers/acme/billing', { method: 'POST' })).status, 404);
});

test('a provider that checks its pasted key refuses one that cannot work, where it is pasted', async () => {
  delete process.env.AZURE_SPEECH_REGION;
  const bare = await api('/api/providers/azure/key', { method: 'PUT', body: { key: 'azure-test-0123456789abcdef' } });
  assert.equal(bare.status, 400);
  assert.match((await bare.json()).error, /region/);
  const placed = await api('/api/providers/azure/key', { method: 'PUT', body: { key: 'eastus:azure-test-0123456789abcdef' } });
  assert.equal(placed.status, 200);
  assert.equal((await placed.json()).providers.find((p) => p.id === 'azure').last4, 'cdef');
  process.env.AZURE_SPEECH_REGION = 'westus2';
  try {
    assert.equal((await api('/api/providers/azure/key', { method: 'PUT', body: { key: 'azure-test-0123456789abcdef' } })).status, 200);
  } finally {
    delete process.env.AZURE_SPEECH_REGION;
  }
  await api('/api/providers/azure/key', { method: 'DELETE' });
});

test('a key removed: what it made goes to another key that makes it, else to nothing', async () => {
  await api('/api/providers/openai/key', { method: 'PUT', body: { key: 'sk-test-OPENAI00001' } });
  await api('/api/providers/google/key', { method: 'PUT', body: { key: 'AIza-test-GOOGLE0001' } });
  let state = await (await api('/api/providers/use', { method: 'PUT', body: { verb: 'image', provider: 'openai' } })).json();
  assert.equal(state.use.image, 'openai');
  state = await (await api('/api/providers/openai/key', { method: 'DELETE' })).json();
  assert.equal(state.use.image, 'google', 'Google makes images too');
  state = await (await api('/api/providers/google/key', { method: 'DELETE' })).json();
  assert.equal(state.use.image, null);
});

test('an own key comes with its model: the provider\'s first unless chosen, kept only when it is not; voices go with voice-over', async () => {
  const provider = listProviders().find((p) => p.id === 'elevenlabs');
  const [first, second] = provider.models.tts;
  assert.ok(second, 'ElevenLabs has more than one voice-over model');
  await changeSettings((s) => { s.keys.elevenlabs = KEY; });
  let state = await (await api('/api/providers/use', { method: 'PUT', body: { verb: 'tts', provider: 'elevenlabs' } })).json();
  assert.equal(state.model.tts, first.id);
  assert.deepEqual(state.providers.find((p) => p.id === 'elevenlabs').models.tts, provider.models.tts);
  state = await (await api('/api/providers/use', { method: 'PUT', body: { verb: 'tts', provider: 'elevenlabs', model: second.id } })).json();
  assert.equal(state.model.tts, second.id);
  assert.equal(JSON.parse(readFileSync(providersFile(), 'utf8')).model.tts, second.id);
  assert.equal(modelFor(await readSettings(), provider, 'voice'), second.id);
  assert.equal((await api('/api/providers/use', { method: 'PUT', body: { verb: 'tts', provider: 'elevenlabs', model: 'eleven_nope' } })).status, 400);
  /* back to the first, or another provider: nothing kept */
  await api('/api/providers/use', { method: 'PUT', body: { verb: 'tts', provider: 'elevenlabs', model: first.id } });
  assert.equal(JSON.parse(readFileSync(providersFile(), 'utf8')).model.tts, undefined);
  /* a model the provider no longer has is its first */
  assert.equal(modelFor({ keys: {}, use: {}, model: { tts: 'gone' } }, provider, 'tts'), first.id);
});

test('what a newer OpenFilm keeps in providers.json stays when this one writes it', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'of-keys-newer-')), 'providers.json');
  writeFileSync(file, JSON.stringify({
    keys: { elevenlabs: 'xi-kept-0123456789' }, use: {}, model: {}, off: [], spending: { ask: 'video' },
    custom: [{ id: 'whisper', name: 'Whisper', url: 'http://localhost:8000', auth: 'Authorization: Bearer {key}', note: '', askFirst: true }],
  }));
  await changeSettings((s) => { s.keys.openai = 'sk-new-0123456789'; s.custom[0].note = 'Transcribes'; }, file);
  const written = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(written.spending, { ask: 'video' });
  assert.equal(written.custom[0].askFirst, true);
  assert.equal(written.custom[0].note, 'Transcribes');
  assert.equal(written.keys.openai, 'sk-new-0123456789');
});
