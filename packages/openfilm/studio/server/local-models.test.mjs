import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { after, before, test } from 'node:test';

/* the models as the library publishes them, listed with their sums in the package's local-models.json: two
   transcription models, a big one of two files and a small one */
const host = mkdtempSync(join(tmpdir(), 'library-host-'));
const files = { 'models/whisper-large-v3-turbo/encoder.onnx': 'onnx bytes', 'models/whisper-large-v3-turbo/config.json': 'vocab bytes' };
const whisper = { 'models/whisper-small/config.json': '{}' };
for (const [rel, body] of Object.entries({ ...files, ...whisper })) { mkdirSync(join(host, rel, '..'), { recursive: true }); writeFileSync(join(host, rel), body); }
const listed = (/** @type {Record<string, string>} */ some) => Object.entries(some).map(([path, body]) => ({ path, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') }));
const pkg = mkdtempSync(join(tmpdir(), 'library-package-'));
writeFileSync(join(pkg, 'local-models.json'), JSON.stringify({ version: 1, models: [{ id: 'whisper-small', files: listed(whisper) }, { id: 'whisper-large-v3-turbo', files: listed(files) }] }));
const library = createServer((req, res) => {
  /* only what is in the fake library's folder */
  const at = resolve(host, decodeURIComponent(req.url ?? '').replace(/^\/library\//, ''));
  try {
    if (!at.startsWith(host + sep)) throw new Error('outside');
    res.end(readFileSync(at));
  } catch { res.writeHead(404); res.end(); }
});

/** @type {import('node:http').Server} */
let api;
let base = '';
before(async () => {
  await new Promise((done) => library.listen(0, '127.0.0.1', () => done(undefined)));
  process.env.OPENFILM_LIBRARY_URL = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (library.address()).port}/library`;
  process.env.OPENFILM_LIBRARY_CACHE = mkdtempSync(join(tmpdir(), 'library-cache-'));
  process.env.OPENFILM_BUILT_IN_LIBRARY = pkg;
  /* the choices of Settings → Services, which a model coming or going moves: the test's own */
  process.env.OPENFILM_HOME = mkdtempSync(join(tmpdir(), 'local-models-home-'));
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

test('a local model is installed, turned off and on, and uninstalled', async () => {
  let { models } = await call('');
  assert.deepEqual(models?.map((m) => [m.id, m.kind, m.by, m.installed, m.on, m.builtIn]), [
    ['whisper-small', 'asr', 'OpenAI', false, false, false], ['whisper-large-v3-turbo', 'asr', 'OpenAI', false, false, false]]);
  const turbo = () => models?.find((m) => m.id === 'whisper-large-v3-turbo');
  assert.equal(turbo().bytes, 21, 'its files\' size');

  assert.equal((await call('/whisper-large-v3-turbo', 'PUT', { on: true })).status, 409, 'not before it is installed');
  ({ models } = await call('/whisper-large-v3-turbo/install', 'POST'));
  for (let i = 0; i < 100 && !turbo().installed; i++) {
    await new Promise((done) => setTimeout(done, 100));
    ({ models } = await call(''));
  }
  assert.equal(turbo().installed, true, 'fetched and checked, in a process of its own');
  assert.equal(turbo().on, true);

  ({ models } = await call('/whisper-large-v3-turbo', 'PUT', { on: false }));
  assert.deepEqual([turbo().installed, turbo().on], [true, false], 'kept, not used');
  ({ models } = await call('/whisper-large-v3-turbo', 'PUT', { on: true }));
  assert.equal(turbo().on, true);

  ({ models } = await call('/whisper-large-v3-turbo', 'DELETE'));
  assert.deepEqual([turbo().installed, turbo().on], [false, false]);
  for (const rel of Object.keys(files)) assert.equal(existsSync(join(/** @type {string} */ (process.env.OPENFILM_LIBRARY_CACHE), rel)), false, `${rel} thrown away`);

  assert.equal((await call('/someone-else', 'DELETE')).status, 404);
});

test('a model that is part of the checkout cannot be uninstalled', async () => {
  for (const [rel, body] of Object.entries(files)) { mkdirSync(join(pkg, rel, '..'), { recursive: true }); writeFileSync(join(pkg, rel), body); }
  const { models } = await call('/whisper-large-v3-turbo/install', 'POST');
  const turbo = models?.find((m) => m.id === 'whisper-large-v3-turbo');
  assert.deepEqual([turbo.installed, turbo.builtIn], [true, true]);
  assert.equal((await call('/whisper-large-v3-turbo', 'DELETE')).status, 409);
  /* gone from the checkout again for the next test: not installed, and what it made goes too */
  rmSync(join(pkg, 'models'), { recursive: true, force: true });
  assert.equal((await call('')).models?.find((m) => m.id === 'whisper-large-v3-turbo').installed, false);
});

test('a transcription model installed makes transcripts when nothing else was chosen for them, and uninstalled stops', async () => {
  const { readSettings } = await import('./keys.mjs');
  const { chooseProvider } = await import('./providers/index.mjs');
  assert.equal(await chooseProvider('asr'), null);
  let { models } = await call('/whisper-small/install', 'POST');
  for (let i = 0; i < 100 && !models?.find((m) => m.id === 'whisper-small').installed; i++) {
    await new Promise((done) => setTimeout(done, 100));
    ({ models } = await call(''));
  }
  assert.equal((await readSettings()).use.asr, 'local', 'the kind goes to it once it is here');
  assert.equal((await chooseProvider('asr'))?.id, 'local');
  await assert.rejects(chooseProvider('cutout', { via: 'local' }), /No local model for cutout is installed/);

  await call('/whisper-small', 'PUT', { on: false });
  assert.equal((await readSettings()).use.asr, undefined, 'off: it makes nothing');
  await call('/whisper-small', 'PUT', { on: true });
  assert.equal((await readSettings()).use.asr, 'local');
  await call('/whisper-small', 'DELETE');
  assert.equal((await readSettings()).use.asr, undefined);
});
