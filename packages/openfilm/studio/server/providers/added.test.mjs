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
