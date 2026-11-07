import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fetchItem, fetchLibrary, libraryIndex, notHere, refreshCommunity } from './library.mjs';
import { findInLibrary } from '../../src/library-search.mjs';

const hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('community catalog makes approved items searchable, verifies bytes and stops serving withdrawn cache entries', async (t) => {
  const cache = mkdtempSync(join(tmpdir(), 'openfilm-community-'));
  const requests = new Map();
  const wav = Buffer.from('published sound');
  const sound = 'community-sound-test-tone.m4a';
  const wave = Buffer.from('waveform');
  const doc = { id: 'sound/test-tone', version: 1, revision: 'a'.repeat(64), by: 'contributor',
    name: { en: 'Test Pulse Tone', 'zh-CN': '测试音', ja: 'テスト音', ko: '테스트 음', es: 'Tono de prueba' },
    about: 'A short test tone', tags: ['test-tone'], durationMs: 800,
    files: { [sound]: { bytes: wav.length, sha256: hex(wav) }, 'waves/community-sound-test-tone.png': { bytes: wave.length, sha256: hex(wave) } } };
  let catalog = { version: 1, items: [doc] };
  let bad = true;
  const server = createServer((req, res) => {
    requests.set(req.url, (requests.get(req.url) ?? 0) + 1);
    if (req.url === '/catalog.json') return res.end(JSON.stringify(catalog));
    if (req.url === `/blobs/${hex(wav)}`) return res.end(bad ? Buffer.alloc(wav.length, 0) : wav);
    if (req.url === `/blobs/${hex(wave)}`) return res.end(wave);
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const before = [process.env.OPENFILM_LIBRARY_CACHE, process.env.OPENFILM_COMMUNITY_LIBRARY_URL];
  process.env.OPENFILM_LIBRARY_CACHE = cache;
  process.env.OPENFILM_COMMUNITY_LIBRARY_URL = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    for (const [i, key] of ['OPENFILM_LIBRARY_CACHE', 'OPENFILM_COMMUNITY_LIBRARY_URL'].entries()) {
      if (before[i] == null) delete process.env[key]; else process.env[key] = before[i];
    }
    rmSync(cache, { recursive: true, force: true });
  });
  const now = Date.now();
  t.mock.method(Date, 'now', () => now);
  await refreshCommunity();
  const entry = libraryIndex().items.find((item) => item.name.en === doc.name.en);
  assert.ok(entry);
  assert.equal(entry.by, doc.by);
  assert.ok(findInLibrary('sound', 'Test Pulse Tone').some((found) => found.item.id === entry.id));
  assert.deepEqual(notHere([entry.id]), [entry.id]);
  assert.equal(await fetchItem(entry.id), false, 'wrong data with the correct size is rejected');
  bad = false;
  assert.deepEqual(await Promise.all([fetchItem(entry.id), fetchItem(entry.id)]), [true, true]);
  assert.equal(requests.get(`/blobs/${hex(wav)}`), 2, 'the successful retry shares a download');
  assert.deepEqual(readFileSync(join(cache, entry.id)), wav);
  assert.deepEqual(notHere([entry.id]), []);
  catalog = { version: 1, items: [] };
  t.mock.method(Date, 'now', () => now + 61_000);
  await refreshCommunity();
  assert.ok(!libraryIndex().items.some((item) => item.id === entry.id));
  assert.equal(await fetchLibrary(entry.id), null, 'withdrawn items cannot be reimported from the cache');
});
