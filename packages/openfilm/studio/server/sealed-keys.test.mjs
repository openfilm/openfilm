import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changeSettings, providersFile, readSettings, sealKeysWith, sealPlainKeys, vaultSealer } from './keys.mjs';
import { agentKeyOf } from './projects.mjs';
import { runFile, startStudio } from './server.mjs';
import { running } from '../client.mjs';

/* OpenFilm's service is asked what it offers: nowhere here (a port that refuses at once) */
process.env.OPENFILM_API_URL ??= 'http://127.0.0.1:9';

const VOICE_KEY = 'xi-sealed-voice-key-0123456789';
const SERVICE_KEY = 'own-service-key-abcdef';
const STUDIO_KEY = randomBytes(24).toString('hex');
const vault = randomBytes(32);
const service = { id: 'whisper', name: 'Whisper', url: 'http://127.0.0.1:9/v1', key: SERVICE_KEY, auth: 'Authorization: Bearer {key}', note: '' };
let studio;

/** Every file in Studio's home as another program of this user reads it: in a process of its own, as bytes. */
function readByAnotherProgram() {
  const script = `const { readdirSync, readFileSync, statSync } = require('node:fs'); const { join } = require('node:path');
    const all = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? all(p) : [readFileSync(p, 'latin1')]; });
    process.stdout.write(all(process.argv[1]).join('\\n'));`;
  const out = spawnSync(process.execPath, ['-e', script, process.env.OPENFILM_HOME], { encoding: 'latin1' });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout;
}

before(async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'of-sealed-'));
  process.env.OPENFILM_HOME = join(scratch, 'home');
  process.env.OPENFILM_LIBRARY = join(scratch, 'library');
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.OPENFILM_AGENT;
  /* what an older OpenFilm, or `npx openfilm`, left: every key plain */
  mkdirSync(process.env.OPENFILM_HOME, { recursive: true, mode: 0o700 });
  writeFileSync(providersFile(), JSON.stringify({ keys: { elevenlabs: VOICE_KEY, keenable: '' }, use: { tts: 'elevenlabs' }, custom: [service] }), { mode: 0o600 });
  studio = await startStudio({ port: 0, advertise: true, keepKey: true, key: STUDIO_KEY, sealer: vaultSealer(vault), openBrowser: () => {} });
});
after(async () => {
  await studio.close();
  sealKeysWith(null);
});

test('in the app, a program of this user reading Studio\'s files gets no service key and no key to Studio\'s say', () => {
  const read = readByAnotherProgram();
  for (const secret of [VOICE_KEY, SERVICE_KEY, STUDIO_KEY]) assert.ok(!read.includes(secret), 'nothing usable in the files');
  assert.ok(!read.includes(VOICE_KEY.slice(4, 20)), 'not even part of a key');
  const kept = JSON.parse(readFileSync(providersFile(), 'utf8'));
  assert.deepEqual(kept.keys, { keenable: '' }, 'a keyless provider stays connected for every OpenFilm, with nothing to hide');
  assert.match(kept.sealed.keys.elevenlabs, /^v1:/);
  assert.equal(kept.custom[0].key, undefined);
  assert.match(kept.sealed.custom.whisper, /^v1:/);
  assert.deepEqual(kept.use, { tts: 'elevenlabs' }, 'the rest as it was');
  /* run.json names the agents' key, which the CLI sends as it is */
  const run = JSON.parse(readFileSync(runFile(), 'utf8'));
  assert.equal(run.key, agentKeyOf(STUDIO_KEY));
  assert.equal(run.keyKind, 'agent');
});

test('Studio still has every key, after a restart too, and the API never gives one out', async () => {
  const settings = await readSettings();
  assert.equal(settings.keys.elevenlabs, VOICE_KEY);
  assert.equal(settings.custom[0].key, SERVICE_KEY);
  /* a Studio started again: the same vault from the keychain, a new process */
  sealKeysWith(null);
  assert.equal((await readSettings()).keys.elevenlabs, undefined, 'without the vault, nothing');
  sealKeysWith(vaultSealer(Buffer.from(vault)));
  assert.equal((await readSettings()).keys.elevenlabs, VOICE_KEY);
  const listed = await (await fetch(`${studio.origin}/api/providers`, { headers: { 'x-studio-key': STUDIO_KEY } })).text();
  assert.ok(listed.includes('elevenlabs'));
  assert.ok(!listed.includes(VOICE_KEY) && !listed.includes(SERVICE_KEY));
});

test('the CLI reaches the app\'s Studio with the agents\' key, an agent and the person alike; it opens all but the person\'s say', async () => {
  for (const agent of [undefined, 'Codex']) {
    if (agent) process.env.OPENFILM_AGENT = agent; else delete process.env.OPENFILM_AGENT;
    const run = await running();
    assert.equal(run?.key, agentKeyOf(STUDIO_KEY), 'sent as it is, not made into another');
  }
  delete process.env.OPENFILM_AGENT;
  const agentKey = agentKeyOf(STUDIO_KEY);
  const as = (path, method = 'GET', body) => fetch(`${studio.origin}${path}`, {
    method, headers: { 'x-studio-key': agentKey, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal((await as('/api/providers')).status, 200);
  assert.equal((await as('/api/providers/openai/key', 'PUT', { key: 'sk-agent-0123456789' })).status, 403);
  /* `openfilm open` gives it an address with its own key, never Studio's */
  const opened = await (await as('/api/open', 'POST', { fallback: 0 })).json();
  assert.ok(opened.url.includes(`key=${agentKey}`) && !opened.url.includes(STUDIO_KEY));
  /* a browser opened on it signs in as the agent: it reads, and is refused the person's say */
  const signedIn = await fetch(opened.url, { redirect: 'manual' });
  assert.equal(signedIn.status, 302);
  assert.ok(!String(signedIn.headers.get('location')).includes(STUDIO_KEY));
  const cookies = signedIn.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  assert.ok(!cookies.includes(STUDIO_KEY));
  const browser = (path, method = 'GET', body) => fetch(`${studio.origin}${path}`, {
    method, headers: { cookie: cookies, origin: studio.origin, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal((await browser('/api/providers')).status, 200);
  assert.equal((await browser('/api/providers/openai/key', 'PUT', { key: 'sk-agent-0123456789' })).status, 403);
  /* the person's own key still has their say */
  const person = await fetch(`${studio.origin}/api/open`, { method: 'POST', headers: { 'x-studio-key': STUDIO_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ fallback: 0 }) });
  assert.ok((await person.json()).url.includes(`key=${STUDIO_KEY}`));
});

test('an older OpenFilm sees no sealed key and keeps them; a key it pastes plain is sealed by the app next time', async () => {
  const sealer = vaultSealer(Buffer.from(vault));
  sealKeysWith(null);
  try {
    const old = await readSettings();
    assert.equal(old.keys.elevenlabs, undefined);
    assert.equal(old.custom[0].key, undefined);
    await changeSettings((s) => { s.keys.openai = 'sk-old-build-0123456789'; });
    const kept = JSON.parse(readFileSync(providersFile(), 'utf8'));
    assert.match(kept.sealed.keys.elevenlabs, /^v1:/, 'what it does not know of stays');
    assert.equal(kept.keys.openai, 'sk-old-build-0123456789');
  } finally {
    sealKeysWith(sealer);
  }
  await sealPlainKeys();
  const kept = JSON.parse(readFileSync(providersFile(), 'utf8'));
  assert.equal(kept.keys.openai, undefined);
  const settings = await readSettings();
  assert.equal(settings.keys.openai, 'sk-old-build-0123456789');
  assert.equal(settings.keys.elevenlabs, VOICE_KEY);
  assert.ok(!readByAnotherProgram().includes('sk-old-build-0123456789'));
});

test('a sealed key opens only where it was sealed for: moved to another entry, its address changed, or another vault, it is nothing', async () => {
  const kept = JSON.parse(readFileSync(providersFile(), 'utf8'));
  const forged = structuredClone(kept);
  /* the OpenFilm-style key moved to a service whose address the program chose */
  forged.custom.push({ id: 'mine', name: 'Mine', url: 'https://example.com', auth: 'Authorization: Bearer {key}', note: '' });
  forged.sealed.custom.mine = kept.sealed.keys.elevenlabs;
  forged.sealed.keys.openai = kept.sealed.keys.elevenlabs;
  forged.custom[0].url = 'https://example.com/v1';
  const file = join(process.env.OPENFILM_HOME, 'forged.json');
  writeFileSync(file, JSON.stringify(forged), { mode: 0o600 });
  const settings = await readSettings(file);
  assert.equal(settings.keys.openai, undefined);
  assert.equal(settings.custom.find((s) => s.id === 'mine')?.key, undefined);
  assert.equal(settings.custom.find((s) => s.id === 'whisper')?.key, undefined);
  assert.equal(settings.keys.elevenlabs, VOICE_KEY, 'the one left where it was still opens');
  sealKeysWith(vaultSealer(randomBytes(32)));
  try {
    assert.equal((await readSettings()).keys.elevenlabs, undefined);
  } finally {
    sealKeysWith(vaultSealer(Buffer.from(vault)));
  }
});
