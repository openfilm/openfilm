import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { after, before, test } from 'node:test';

/* the library's host: a folder served as openfilm.dev/library serves the published parts, counting what is asked */
const host = mkdtempSync(join(tmpdir(), 'library-host-'));
const put = (rel, body) => { mkdirSync(join(host, rel, '..'), { recursive: true }); writeFileSync(join(host, rel), body); };
put('audio/music/calm-piano-1a2b3c.mp3', 'mp3 bytes');
put('stickers/emoji/alien/files.json', JSON.stringify(['saved.json', 'files/emoji.html', 'files/emoji.png']));
put('stickers/emoji/alien/saved.json', JSON.stringify({ version: 2, kind: 'clip', clip: { src: 'emoji.html', time: [0, 3] }, durationMs: 3000 }));
put('stickers/emoji/alien/files/emoji.html', '<img src="emoji.png">');
put('stickers/emoji/alien/files/emoji.png', 'png bytes');
/** @type {string[]} */
const asked = [];
const server = createServer((req, res) => {
  asked.push(req.url ?? '');
  /* only what is in the fake library's folder */
  const at = resolve(host, decodeURIComponent(req.url ?? '').replace(/^\/library\//, ''));
  try {
    if (!at.startsWith(host + sep)) throw new Error('outside');
    res.end(readFileSync(at));
  } catch { res.writeHead(404); res.end(); }
});

before(async () => {
  await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  process.env.OPENFILM_LIBRARY_URL = `http://127.0.0.1:${address.port}/library`;
  process.env.OPENFILM_LIBRARY_CACHE = mkdtempSync(join(tmpdir(), 'library-cache-'));
  process.env.OPENFILM_BUILT_IN_LIBRARY = mkdtempSync(join(tmpdir(), 'library-package-'));
});
after(() => server.close());

const { fetchLibrary, libraryCache, libraryFile, libraryFileFetched, notHere } = await import('./library.mjs');

test('a published sound is fetched on first use, kept, and never asked for again', async () => {
  assert.equal(libraryFile('audio/music/calm-piano-1a2b3c.mp3'), null, 'not on this computer yet');
  const [one, two] = await Promise.all([libraryFileFetched('audio/music/calm-piano-1a2b3c.mp3'), libraryFileFetched('audio/music/calm-piano-1a2b3c.mp3')]);
  assert.equal(one, join(libraryCache(), 'audio/music/calm-piano-1a2b3c.mp3'));
  assert.equal(two, one, 'two asking at once share one fetch');
  assert.equal(readFileSync(one, 'utf8'), 'mp3 bytes');
  const before = asked.length;
  assert.equal(await libraryFileFetched('audio/music/calm-piano-1a2b3c.mp3'), one);
  assert.equal(libraryFile('audio/music/calm-piano-1a2b3c.mp3'), one);
  assert.equal(asked.length, before, 'kept: no second fetch');
});

test('Doubao public recordings play through the same local cache without keys or a separately published mirror', async (t) => {
  const sample = 'voices/doubao/zh_female_vv_uranus_bigtts.wav';
  const source = 'https://lf3-static.bytednsdoc.com/obj/eden-cn/lm_hz_ihsph/ljhwZthlaukjlkulzlp/portal/bigtts/zh_female_vv_uranus_bigtts.wav';
  writeFileSync(join(process.env.OPENFILM_BUILT_IN_LIBRARY, 'voices.json'), JSON.stringify({ providers: [], voices: [
    { provider: 'doubao', id: 'zh_female_vv_uranus_bigtts', sample, sampleSource: source },
  ] }));
  const requests = [];
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url !== source) return originalFetch(url, init);
    requests.push(init);
    return new Response('RIFF public preview', { headers: { 'content-type': 'audio/x-wav' } });
  });
  const at = await libraryFileFetched(sample);
  assert.equal(at, join(libraryCache(), sample));
  assert.equal(readFileSync(at, 'utf8'), 'RIFF public preview');
  assert.equal(await libraryFileFetched(sample), at);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers, undefined);
  assert.equal(requests[0].redirect, 'error');
});

test('official BytePlus recordings and synthesized Doubao previews use the library player cache', async (t) => {
  const official = 'voices/doubao/official.wav';
  const made = 'voices/doubao/made.m4a';
  const source = 'https://sf-bpcms.bytepluscdn.com/obj/byteplus-public-aiso/cloud-universal-doc/20260812141452-101140770855.wav';
  writeFileSync(join(process.env.OPENFILM_BUILT_IN_LIBRARY, 'voices.json'), JSON.stringify({ providers: [], voices: [
    { provider: 'doubao', id: 'official', sample: official, sampleSource: source },
    { provider: 'doubao', id: 'made', sample: made, sampleSource: null },
  ] }));
  put(made, 'AAC preview');
  const originalFetch = globalThis.fetch;
  const fetch = t.mock.method(globalThis, 'fetch', async (url, init) => url === source
    ? new Response('RIFF public preview', { headers: { 'content-type': 'audio/wav' } })
    : originalFetch(url, init));

  assert.equal(readFileSync(await libraryFileFetched(official), 'utf8'), 'RIFF public preview');
  assert.equal(readFileSync(await libraryFileFetched(made), 'utf8'), 'AAC preview');
  assert.deepEqual(fetch.mock.calls.map(({ arguments: [url] }) => url), [source, `${process.env.OPENFILM_LIBRARY_URL}/${made}`]);
});

test('an unofficial sample address is never fetched, and a provider HTML error is not cached as audio', async (t) => {
  const source = 'https://lf3-static.bytednsdoc.com/obj/eden-cn/lm_hz_ihsph/ljhwZthlaukjlkulzlp/portal/bigtts/failed.mp3';
  const bad = 'voices/doubao/bad.mp3', failed = 'voices/doubao/failed.mp3';
  writeFileSync(join(process.env.OPENFILM_BUILT_IN_LIBRARY, 'voices.json'), JSON.stringify({ providers: [], voices: [
    { provider: 'doubao', sample: bad, sampleSource: 'http://127.0.0.1/private' },
    { provider: 'doubao', sample: failed, sampleSource: source },
  ] }));
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.notEqual(url, 'http://127.0.0.1/private');
    return url === source ? new Response('<html>unavailable</html>', { headers: { 'content-type': 'text/html' } }) : originalFetch(url, init);
  });
  assert.equal(await libraryFileFetched(bad), null);
  assert.equal(await libraryFileFetched(failed), null);
  assert.equal(libraryFile(failed), null);
});

test('checking preview files distinguishes a cached sample and an uncached example without downloading either', () => {
  const voice = 'voices/demo/cached.m4a';
  const example = 'examples/templates/uncached.mp4';
  mkdirSync(join(libraryCache(), voice, '..'), { recursive: true });
  writeFileSync(join(libraryCache(), voice), 'sample bytes');
  const before = asked.length;
  assert.deepEqual(notHere([voice, example, 'voices/../outside']), [example]);
  assert.equal(asked.length, before);
});

test('a published bundle comes with every file its list names', async () => {
  const folder = await fetchLibrary('stickers/emoji/alien');
  assert.equal(folder, join(libraryCache(), 'stickers/emoji/alien'));
  for (const file of ['saved.json', 'files/emoji.html', 'files/emoji.png']) assert.ok(libraryFile(`stickers/emoji/alien/${file}`), file);
});

test('an incomplete bundle retries the missing files instead of being offered as complete', async () => {
  const { existsSync } = await import('node:fs');
  put('stickers/emoji/retry/files.json', JSON.stringify(['saved.json', 'files/image.png']));
  put('stickers/emoji/retry/saved.json', '{}');
  assert.equal(await fetchLibrary('stickers/emoji/retry'), null);
  const folder = join(libraryCache(), 'stickers/emoji/retry');
  assert.equal(existsSync(join(folder, '.partial')), true);
  put('stickers/emoji/retry/files/image.png', 'complete image');
  assert.equal(await fetchLibrary('stickers/emoji/retry'), folder);
  assert.equal(readFileSync(join(folder, 'files/image.png'), 'utf8'), 'complete image');
  assert.equal(existsSync(join(folder, '.partial')), false);
});

test('a card preview and its bundle share one file download', async () => {
  put('stickers/emoji/parallel/files.json', JSON.stringify(['saved.json', 'files/image.png']));
  put('stickers/emoji/parallel/saved.json', '{}');
  put('stickers/emoji/parallel/files/image.png', 'one image');
  const [file, bundle] = await Promise.all([
    fetchLibrary('stickers/emoji/parallel/files/image.png'), fetchLibrary('stickers/emoji/parallel'),
  ]);
  assert.equal(file, join(libraryCache(), 'stickers/emoji/parallel/files/image.png'));
  assert.equal(bundle, join(libraryCache(), 'stickers/emoji/parallel'));
  assert.equal(asked.filter((url) => url.endsWith('/parallel/files/image.png')).length, 1);
});

test('nothing is fetched for what is not published, missing, or outside the library', async () => {
  const before = asked.length;
  assert.equal(await fetchLibrary('effects/snow/poster.jpg'), null, 'shipped with the package: never fetched');
  assert.equal(asked.length, before);
  assert.equal(await fetchLibrary('audio/music/no-such-thing.mp3'), null);
  assert.equal(libraryFile('audio/music/no-such-thing.mp3'), null, 'nothing half-written is left');
  assert.equal(await fetchLibrary('audio/../../outside.mp3'), null);
  assert.equal(await fetchLibrary(''), null);
});

test('which things still need fetching before they go in (a sound, a template\'s music), and fetching one', async () => {
  const { notHere, fetchItem } = await import('./library.mjs');
  writeFileSync(join(/** @type {string} */ (process.env.OPENFILM_BUILT_IN_LIBRARY), 'index.json'), JSON.stringify({ version: 1, groups: {}, items: [
    { id: 'templates/trip', cat: 'template', kind: 'group', music: 'audio/music/tune-9f9f9f.mp3' },
    { id: 'effects/snow', cat: 'effect', kind: 'page' },
    { id: 'audio/music/calm-piano-1a2b3c.mp3', cat: 'music', kind: 'sound' },
  ] }));
  put('audio/music/tune-9f9f9f.mp3', 'tune bytes');
  put('examples/templates/trip.mp4', 'example bytes');
  /* the piano was fetched above; the snow comes with the package; nothing is no thing */
  assert.deepEqual(notHere(['templates/trip', 'effects/snow', 'audio/music/calm-piano-1a2b3c.mp3', 'nothing']), ['templates/trip']);
  const example = 'examples/templates/trip.mp4';
  const before = asked.length;
  assert.deepEqual(await Promise.all([fetchItem(example), fetchItem(example)]), [true, true]);
  assert.equal(await libraryFileFetched(example), join(libraryCache(), example));
  assert.deepEqual(asked.slice(before), [`/library/${example}`], 'hover, click and playback share the cached example');
  assert.deepEqual(notHere([example, 'templates/trip']), ['templates/trip'], 'preview did not download the separate music');
  assert.equal(await fetchItem('examples/effects/snow.mp4'), false, 'only indexed template examples can be prepared');
  assert.equal(await fetchItem('templates/trip'), true);
  assert.deepEqual(notHere(['templates/trip']), [], 'here now');
  assert.equal(await fetchItem('nothing'), false);
  assert.deepEqual(notHere('not a list'), []);
});
