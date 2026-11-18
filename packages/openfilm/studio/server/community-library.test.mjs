import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fetchItem, fetchLibrary, libraryAdded, libraryIndex, notHere, refreshCommunity, setLibraryAdded, setLibraryFavorites } from './library.mjs';
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

test('a pack is a group of every category it has things in; a thing listed alone is a pack of its own; what is added and starred is kept by id', async (t) => {
  const cache = mkdtempSync(join(tmpdir(), 'openfilm-community-'));
  const shared = mkdtempSync(join(tmpdir(), 'openfilm-shared-'));
  const name = (en) => ({ en, 'zh-CN': en, ja: en, ko: en, es: en });
  const sound = (slug, by = 'maker') => {
    const base = `community-sound-${slug}`;
    return { id: `sound/${slug}`, version: 1, revision: 'b'.repeat(64), by, name: name(slug), about: '', tags: [], durationMs: 500,
      files: { [`${base}.m4a`]: { bytes: 3, sha256: 'c'.repeat(64) }, [`waves/${base}.png`]: { bytes: 3, sha256: 'd'.repeat(64) } } };
  };
  const catalog = { version: 1, items: [sound('rain'), sound('wind'), sound('bell', 'other')],
    packs: [{ id: 'weather', version: 2, revision: 'e'.repeat(64), by: 'Maker', name: name('Weather'), about: 'Two of them', items: ['sound/wind', 'sound/rain'],
      cover: { bytes: 5, sha256: 'f'.repeat(64) } }] };
  const server = createServer((req, res) => (req.url === '/catalog.json' ? res.end(JSON.stringify(catalog)) : res.writeHead(404).end()));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const keys = ['OPENFILM_LIBRARY_CACHE', 'OPENFILM_COMMUNITY_LIBRARY_URL', 'OPENFILM_SHARED_HOME'];
  const before = keys.map((key) => process.env[key]);
  process.env.OPENFILM_LIBRARY_CACHE = cache;
  process.env.OPENFILM_COMMUNITY_LIBRARY_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.OPENFILM_SHARED_HOME = shared;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    keys.forEach((key, i) => { if (before[i] == null) delete process.env[key]; else process.env[key] = before[i]; });
    rmSync(cache, { recursive: true, force: true });
    rmSync(shared, { recursive: true, force: true });
  });
  t.mock.method(Date, 'now', () => Date.UTC(2030, 0, 1));
  await refreshCommunity();
  const index = libraryIndex();
  const weather = index.packs.find((p) => p.id === 'maker/weather');
  assert.ok(weather, 'the pack, by its maker and name');
  assert.deepEqual(weather.items.map((id) => id.split('/')[3]), ['wind-v1-' + 'b'.repeat(64), 'rain-v1-' + 'b'.repeat(64)], 'in the pack\'s own order');
  assert.deepEqual(weather.cats, ['sound']);
  assert.equal(weather.version, 2);
  assert.match(weather.cover, /^community\/v1\/packs\/weather-v2-e+\/cover\.jpg$/);
  assert.ok(index.items.filter((it) => it.group === 'maker/weather').length === 2, 'its things are its group');
  assert.ok(index.groups.sound.some((g) => g.id === 'maker/weather' && g.by === 'Maker'));
  const bell = index.packs.find((p) => p.lone);
  assert.equal(bell.id, 'other/sound-bell', 'one listed alone: a pack of its own');
  assert.ok(index.packs.some((p) => p.official && p.id.startsWith('openfilm/')), 'OpenFilm\'s groups are its packs');
  assert.ok(!index.packs.some((p) => p.official && p.group === 'maker/weather'));

  const thing = index.items.find((it) => it.group === 'other/sound-bell').id;
  assert.deepEqual(setLibraryAdded(['maker/weather', thing, 'nobody/nothing', 7]), ['maker/weather', thing], 'only what the catalog has');
  assert.deepEqual(libraryAdded(), ['maker/weather', thing]);
  assert.deepEqual(setLibraryFavorites(['pack:maker/weather', 'pack:nobody/nothing']), ['pack:maker/weather'], 'a pack can be starred');
});

test('a pack that names a thing of another maker, or a thing twice, makes the catalog refused (the last good one is kept)', async () => {
  const { decodeForTest } = await import('./community-library.mjs');
  const name = { en: 'x', 'zh-CN': 'x', ja: 'x', ko: 'x', es: 'x' };
  const item = { id: 'sound/a', version: 1, revision: 'b'.repeat(64), by: 'one', name, about: '', tags: [], durationMs: 5,
    files: { 'community-sound-a.m4a': { bytes: 1, sha256: 'c'.repeat(64) }, 'waves/community-sound-a.png': { bytes: 1, sha256: 'd'.repeat(64) } } };
  const pack = (over) => ({ id: 'p', version: 1, revision: 'e'.repeat(64), by: 'two', name, about: '', items: ['sound/a'], ...over });
  assert.throws(() => decodeForTest({ version: 1, items: [item], packs: [pack()] }), /pack/, 'another maker\'s thing');
  assert.throws(() => decodeForTest({ version: 1, items: [item], packs: [pack({ by: 'one', items: ['sound/a', 'sound/a'] })] }), /pack/);
  assert.throws(() => decodeForTest({ version: 1, items: [item], packs: [pack({ by: 'one', id: 'Bad Slug' })] }), /pack/);
  assert.equal(decodeForTest({ version: 1, items: [item], packs: [pack({ by: 'one' })] }).packs[0].id, 'one/p');
});

test('a text style, a filter and a sticker read from the catalog as the library draws them', async () => {
  const { decodeForTest } = await import('./community-library.mjs');
  const hex = (c) => c.repeat(64);
  const file = (c) => ({ sha256: hex(c), bytes: 10 });
  const name = { en: 'X', 'zh-CN': 'X', ja: 'X', ko: 'X', es: 'X' };
  const base = { version: 1, revision: hex('a'), name, about: 'A test item.', tags: ['test'], by: 'tester' };
  const grade = { sat: 0.9, all: Array.from({ length: 17 }, (_, i) => i / 16) };
  const catalog = decodeForTest({ version: 1, items: [
    { ...base, id: 'text/bold', durationMs: 0, vars: { '--weight': '900' }, files: {} },
    { ...base, id: 'filter/warm', durationMs: 0, grade, files: { 'sample.jpg': file('b') } },
    { ...base, id: 'sticker/star', durationMs: 3000, w: 400, h: 300, files: { 'saved.json': file('c'), 'files/sticker.html': file('d'), 'files/sticker.png': file('e') } },
  ] });
  const [text, filter, sticker] = catalog.items;
  assert.equal(text.kind, 'textstyle');
  assert.deepEqual(text.vars, { '--weight': '900' });
  assert.equal(filter.kind, 'look');
  assert.deepEqual(filter.grade, grade);
  assert.match(String(filter.sample), /filter\/warm-v1-a+\/sample\.jpg$/);
  assert.equal(sticker.kind, 'page');
  assert.equal(sticker.src, 'sticker.html');
  assert.deepEqual([sticker.w, sticker.h], [400, 300]);
  assert.equal(catalog.bundles.get(sticker.id)?.length, 3);
  assert.throws(() => decodeForTest({ version: 1, items: [{ ...base, id: 'text/bad', durationMs: 0, vars: { '--bg': 'url(x)' }, files: {} }] }), /Invalid/);
});

test('a kind added to the Community later is skipped, the rest of the catalog still shows', async () => {
  const { decodeForTest } = await import('./community-library.mjs');
  const hex = (c) => c.repeat(64);
  const name = { en: 'X', 'zh-CN': 'X', ja: 'X', ko: 'X', es: 'X' };
  const base = { version: 1, revision: hex('a'), name, about: 'A test item.', tags: ['test'], by: 'tester' };
  const catalog = decodeForTest({ version: 1, items: [
    { ...base, id: 'hologram/orb', durationMs: 1000, files: { 'orb.glb': { sha256: hex('b'), bytes: 10 } } },
    { ...base, id: 'text/bold', durationMs: 0, vars: { '--weight': '900' }, files: {} },
  ], packs: [{ id: 'mixed', version: 1, revision: hex('c'), name, about: 'A mixed pack.', by: 'tester', items: ['hologram/orb', 'text/bold'] },
    { id: 'future', version: 1, revision: hex('d'), name, about: 'A pack of a later kind.', by: 'tester', items: ['hologram/other'] }] });
  assert.deepEqual(catalog.items.map((i) => i.cat), ['text']);
  assert.deepEqual(catalog.packs.map((p) => [p.id, p.items.length]), [['tester/mixed', 1]]);
});
