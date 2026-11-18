import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addedProblems } from './added.mjs';
import { freshProviders, listProviders } from './index.mjs';

/* a service the person added is read beside the built-in ones, read again once changed, and one that is not a provider is left out with why */
test('a provider the person added in their shared home is one more service', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'of-added-'));
  const before = process.env.OPENFILM_SHARED_HOME;
  process.env.OPENFILM_SHARED_HOME = home;
  t.after(() => { if (before === undefined) delete process.env.OPENFILM_SHARED_HOME; else process.env.OPENFILM_SHARED_HOME = before; rmSync(home, { recursive: true, force: true }); });
  const write = (folder, body) => { mkdirSync(join(home, 'providers', folder), { recursive: true }); writeFileSync(join(home, 'providers', folder, 'provider.mjs'), body); };
  const module = (name) => `export default { id: 'acme', name: '${name}', env: 'ACME_KEY', verbs: ['image'],
    models: { image: [{ id: 'acme-1', name: 'Acme 1', spec: { ratios: ['1:1'], refs: 2 } }] },
    async run() { return { files: [], index: [], receipt: {} }; } };`;
  write('acme', module('Acme'));
  write('broken', 'export default { id: "broken" };');
  write('twin', module('Acme again'));
  write('clash', "export default { id: 'openai', name: 'Mine', env: 'X', verbs: ['image'], run() {} };");
  const builtIn = listProviders().length;
  await freshProviders();
  const acme = listProviders().find((p) => p.id === 'acme');
  assert.equal(listProviders().length, builtIn + 1);
  assert.equal(acme.name, 'Acme');
  assert.equal(acme.added, true);
  assert.deepEqual(acme.models.image[0].spec, { ratios: ['1:1'], refs: 2 });
  assert.deepEqual([...addedProblems.keys()].sort(), ['broken', 'clash', 'twin']);
  assert.match(addedProblems.get('broken'), /"name" is missing/);
  assert.match(addedProblems.get('clash'), /another service's/);
  /* changed: read again */
  write('acme', module('Acme Studio'));
  const later = new Date(Date.now() + 5000);
  utimesSync(join(home, 'providers', 'acme', 'provider.mjs'), later, later);
  await freshProviders();
  assert.equal(listProviders().find((p) => p.id === 'acme').name, 'Acme Studio');
  /* taken away: gone */
  rmSync(join(home, 'providers'), { recursive: true });
  await freshProviders();
  assert.equal(listProviders().length, builtIn);
});

/* a local service that takes no key (`ready`): Disconnect turns it off until Connect, which asks for no key */
test('a local service the person added disconnects and connects again with one click', async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'of-added-ready-'));
  const saved = Object.fromEntries(['OPENFILM_SHARED_HOME', 'OPENFILM_HOME', 'OPENFILM_LIBRARY'].map((k) => [k, process.env[k]]));
  process.env.OPENFILM_SHARED_HOME = join(scratch, 'shared');
  process.env.OPENFILM_HOME = join(scratch, 'home');
  process.env.OPENFILM_LIBRARY = join(scratch, 'library');
  mkdirSync(join(scratch, 'shared', 'providers', 'voices'), { recursive: true });
  writeFileSync(join(scratch, 'shared', 'providers', 'voices', 'provider.mjs'), `export default { id: 'voices', name: 'Voices', env: 'VOICES_KEY', verbs: ['tts'],
    models: { tts: [{ id: 'v1', name: 'V1' }] }, ready: () => true, async run() { return { files: [], index: [], receipt: {} }; } };`);
  const { startStudio } = await import('../server.mjs');
  const studio = await startStudio({ port: 0, openBrowser: () => {} });
  t.after(async () => {
    await studio.close();
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    rmSync(scratch, { recursive: true, force: true });
  });
  const call = async (path, method = 'GET', body) => (await fetch(`${studio.origin}/api/providers${path}`, {
    method, headers: { 'x-studio-key': studio.key, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  })).json();
  const voices = (state) => state.providers.find((p) => p.id === 'voices');
  const first = await call('');
  assert.equal(voices(first).source, 'file', 'connected while it can run');
  assert.equal(voices(first).noKey, true);
  assert.equal((await call('/use', 'PUT', { verb: 'tts', provider: 'voices' })).use.tts, 'voices', 'voice-over goes to it');
  const off = await call('/voices/key', 'DELETE');
  assert.equal(voices(off).source, null, 'disconnected');
  assert.equal(off.use.tts ?? null, null, 'voice-over no longer goes to it');
  assert.equal(voices(await call('')).source, null, 'and stays so');
  const on = await call('/voices/key', 'PUT', { key: '' });
  assert.equal(voices(on).source, 'file', 'connected again, no key asked for');
  assert.equal(voices(on).last4, null);
});
