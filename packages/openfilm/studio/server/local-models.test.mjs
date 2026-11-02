import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

/* the model as the library publishes it: two small files, listed with their sums in the package's models.json */
const host = mkdtempSync(join(tmpdir(), 'library-host-'));
const files = { 'models/multilingual-e5-small/model_quantized.onnx': 'onnx bytes', 'models/multilingual-e5-small/vocab.bin': 'vocab bytes' };
for (const [rel, body] of Object.entries(files)) { mkdirSync(join(host, rel, '..'), { recursive: true }); writeFileSync(join(host, rel), body); }
const pkg = mkdtempSync(join(tmpdir(), 'library-package-'));
writeFileSync(join(pkg, 'models.json'), JSON.stringify({
  version: 1, model: 'multilingual-e5-small', dims: 384, onnx: Object.keys(files)[0], tokenizer: Object.keys(files)[1], runtime: '',
  files: Object.entries(files).map(([path, body]) => ({ path, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') })),
}));
const library = createServer((req, res) => {
  try { res.end(readFileSync(join(host, decodeURIComponent(req.url ?? '').replace(/^\/library\//, '')))); } catch { res.writeHead(404); res.end(); }
});

/** @type {import('node:http').Server} */
let api;
let base = '';
before(async () => {
  await new Promise((done) => library.listen(0, '127.0.0.1', () => done(undefined)));
  process.env.OPENFILM_LIBRARY_URL = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (library.address()).port}/library`;
  process.env.OPENFILM_LIBRARY_CACHE = mkdtempSync(join(tmpdir(), 'library-cache-'));
  process.env.OPENFILM_BUILT_IN_LIBRARY = pkg;
  const { localModelsRoute } = await import('./local-models.mjs');
  const { json } = await import('./http.mjs');
  api = createServer((req, res) => {
    const parts = (req.url ?? '').split('/').filter(Boolean).slice(2);
    localModelsRoute(req, res, parts).catch((/** @type {any} */ e) => json(res, e.status ?? 500, { error: e.message }));
  });
  await new Promise((done) => api.listen(0, '127.0.0.1', () => done(undefined)));
  base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (api.address()).port}/api/local-models`;
});
after(() => { library.close(); api.close(); });

const call = async (/** @type {string} */ path, method = 'GET', body = undefined) => {
  const res = await fetch(`${base}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, models: /** @type {{ models?: any[] }} */ (await res.json()).models };
};

test('a local model is installed, turned off and on, and uninstalled, and a search never fetches it once it is off', async () => {
  const { semanticState } = await import('../../src/library-semantic.mjs');
  let { models } = await call('');
  assert.deepEqual(models?.map((m) => [m.id, m.kind, m.by, m.installed, m.on, m.builtIn]), [['multilingual-e5-small', 'search', 'Microsoft', false, false, false]]);
  assert.equal(models?.[0].bytes, 21, 'its files\' size');

  assert.equal((await call('/multilingual-e5-small', 'PUT', { on: true })).status, 409, 'not before it is installed');
  ({ models } = await call('/multilingual-e5-small/install', 'POST'));
  for (let i = 0; i < 100 && !models?.[0].installed; i++) {
    await new Promise((done) => setTimeout(done, 100));
    ({ models } = await call(''));
  }
  assert.equal(models?.[0].installed, true, 'fetched and checked, in a process of its own');
  assert.equal(models?.[0].on, true);
  assert.equal(semanticState(), 'ready');

  ({ models } = await call('/multilingual-e5-small', 'PUT', { on: false }));
  assert.deepEqual([models?.[0].installed, models?.[0].on], [true, false], 'kept, not used');
  assert.equal(semanticState(), 'off', 'searches use keywords');
  ({ models } = await call('/multilingual-e5-small', 'PUT', { on: true }));
  assert.equal(models?.[0].on, true);

  ({ models } = await call('/multilingual-e5-small', 'DELETE'));
  assert.deepEqual([models?.[0].installed, models?.[0].on], [false, false]);
  for (const rel of Object.keys(files)) assert.equal(existsSync(join(/** @type {string} */ (process.env.OPENFILM_LIBRARY_CACHE), rel)), false, `${rel} thrown away`);
  let started = false;
  assert.equal(semanticState({ start: () => { started = true; } }), 'off');
  assert.equal(started, false, 'a search does not fetch it again');

  assert.equal((await call('/someone-else', 'DELETE')).status, 404);
});

test('a model that is part of the checkout cannot be uninstalled', async () => {
  for (const [rel, body] of Object.entries(files)) { mkdirSync(join(pkg, rel, '..'), { recursive: true }); writeFileSync(join(pkg, rel), body); }
  const { models } = await call('/multilingual-e5-small/install', 'POST');
  assert.deepEqual([models?.[0].installed, models?.[0].builtIn], [true, true]);
  assert.equal((await call('/multilingual-e5-small', 'DELETE')).status, 409);
});
