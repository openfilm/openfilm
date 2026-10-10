import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changeSettings, readSettings } from '../keys.mjs';
import { chooseProvider, listProviders } from './index.mjs';
import openfilm from './openfilm.mjs';

before(() => {
  /* this machine's own keys and account must not decide these */
  process.env.OPENFILM_HOME = mkdtempSync(join(tmpdir(), 'of-routing-'));
  for (const name of ['ELEVENLABS_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'FAL_KEY', 'PEXELS_API_KEY', 'PIXABAY_API_KEY', 'BRAVE_API_KEY', 'TAVILY_API_KEY', 'GROQ_API_KEY', 'OPENFILM_API_KEY']) delete process.env[name];
});

const settings = (keys = {}, use = {}) => ({ keys, use, tier: {}, model: {}, seen: {} });
const id = async (promise) => (await promise)?.id ?? null;

test('the own-key providers, in the order Settings lists them', () => {
  assert.deepEqual(listProviders().map((p) => p.id), ['elevenlabs', 'openai', 'google', 'fal', 'pexels', 'pixabay', 'brave', 'tavily', 'groq']);
});

test('nothing serves a kind of media nobody chose, even with a key that could', async () => {
  const keys = { openai: 'sk-0123456789', fal: 'fal-0123456789' };
  assert.equal(await id(chooseProvider('tts', { settings: settings(keys) })), null);
  assert.equal(await id(chooseProvider('video', { settings: settings(keys, { video: 'fal' }) })), 'fal');
});

test('the person\'s choice serves while it can; a key gone or the account disconnected serves nothing', async () => {
  const keys = { elevenlabs: 'xi-0123456789', google: 'AIza-0123456789' };
  assert.equal(await id(chooseProvider('tts', { settings: settings(keys, { tts: 'google' }) })), 'google');
  assert.equal(await id(chooseProvider('voice', { settings: settings(keys, { tts: 'google' }) })), 'google');
  assert.equal(await id(chooseProvider('tts', { settings: settings({}, { tts: 'google' }) })), null);
  assert.equal(await id(chooseProvider('image', { settings: settings(keys, { image: 'openfilm' }) })), null);
  assert.equal(await id(chooseProvider('image', { settings: { ...settings(keys, { image: 'openfilm' }), seen: { openfilm: 'connected' } } })), 'openfilm');
});

test('every provider is treated alike: one connected fills only the kinds with no choice; one gone hands its kinds on', async (t) => {
  let connected = false;
  t.mock.method(openfilm, 'connected', async () => connected);
  await changeSettings((s) => { s.keys.elevenlabs = 'xi-0123456789'; for (const v of ['tts', 'sfx', 'music', 'asr']) s.use[v] = 'elevenlabs'; });
  connected = true;
  assert.equal(await id(chooseProvider('music')), 'elevenlabs', 'a choice made before the account stays');
  assert.equal(await id(chooseProvider('image-search')), 'openfilm', 'a kind with no choice goes to the account');
  await changeSettings((s) => { s.use.tts = 'openfilm'; });
  connected = false;
  assert.equal(await id(chooseProvider('tts')), 'elevenlabs', 'what the account made goes to what else makes it');
  assert.equal(await id(chooseProvider('image-search')), null);
  assert.deepEqual((await readSettings()).use, { tts: 'elevenlabs', sfx: 'elevenlabs', music: 'elevenlabs', asr: 'elevenlabs' });
});

test('voices always come from the provider that does voice-over, whatever else can list them', async (t) => {
  const keys = { elevenlabs: 'xi-0123456789', openai: 'sk-0123456789' };
  for (const use of [{ tts: 'openai' }, { tts: 'elevenlabs' }]) {
    assert.equal(await id(chooseProvider('voice', { settings: settings(keys, use) })), await id(chooseProvider('tts', { settings: settings(keys, use) })));
  }
  assert.equal(await id(chooseProvider('voice', { via: 'openai', settings: settings(keys) })), 'openai');
  assert.equal(await id(chooseProvider('voice', { settings: { ...settings(keys, { tts: 'openfilm' }), seen: { openfilm: 'connected' } } })), 'openfilm');
});

test('--via names one: it must exist, do the verb and have a key, or it says why', async () => {
  const keys = { elevenlabs: 'xi-0123456789' };
  assert.equal(await id(chooseProvider('sfx', { via: 'elevenlabs', settings: settings(keys) })), 'elevenlabs');
  assert.equal(await id(chooseProvider('sfx', { via: 'openfilm', settings: settings(keys) })), 'openfilm');
  await assert.rejects(chooseProvider('sfx', { via: 'acme', settings: settings(keys) }), /no provider "acme"/);
  await assert.rejects(chooseProvider('video', { via: 'elevenlabs', settings: settings(keys) }), /ElevenLabs does not do video/);
  await assert.rejects(chooseProvider('image', { via: 'openai', settings: settings(keys) }), /no OpenAI key.*OPENAI_API_KEY/);
});

test('a key in the environment counts as much as a kept one', async () => {
  process.env.GOOGLE_API_KEY = 'AIza-env-0123456789';
  try {
    assert.equal(await id(chooseProvider('video', { settings: settings({}, { video: 'google' }) })), 'google');
  } finally {
    delete process.env.GOOGLE_API_KEY;
  }
});
