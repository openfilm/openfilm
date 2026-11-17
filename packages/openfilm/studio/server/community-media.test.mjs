// The Community's media (footage, pictures, recordings): read from its catalog, and kept as files of the person's own:
// a pack as a folder named after it (savePack), a file alone in a folder (copyFromLibrary), each under its name.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const names = (en, zh) => ({ en, 'zh-CN': zh, ja: en, ko: en, es: en });
const file = (bytes) => ({ bytes: bytes.length, sha256: hex(bytes) });

test('a media pack of the Community is kept as a folder of the person\'s own, each file under its name; a file alone too', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'of-community-media-'));
  const video = Buffer.from('a short clip'), poster = Buffer.from('its poster'), picture = Buffer.from('a picture'), sound = Buffer.from('a recording');
  const item = (slug, media, files, durationMs) => ({ id: `media/${slug}`, version: 1, revision: 'b'.repeat(64), by: 'ana',
    name: names(slug.replace('-', ' '), `素材 ${slug}`), about: 'For a test.', tags: ['test'], durationMs, media, files });
  const catalog = {
    version: 1,
    packs: [{ id: 'city', version: 1, revision: 'c'.repeat(64), by: 'ana', name: names('City', '城市'), about: 'A city.', items: ['media/street', 'media/sky', 'media/rain'] }],
    items: [
      item('street', 'video', { 'community-media-street.mp4': file(video), 'poster.jpg': file(poster) }, 4000),
      item('sky', 'image', { 'community-media-sky.jpg': file(picture) }, 0),
      item('rain', 'audio', { 'community-media-rain.m4a': file(sound) }, 6000),
    ],
  };
  const blobs = new Map([video, poster, picture, sound].map((b) => [`/blobs/${hex(b)}`, b]));
  const server = createServer((req, res) => {
    if (req.url === '/catalog.json') return res.end(JSON.stringify(catalog));
    const blob = blobs.get(req.url ?? '');
    return blob ? res.end(blob) : res.writeHead(404).end();
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const keys = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS', 'LIBRARY_CACHE', 'COMMUNITY_LIBRARY_URL'];
  const before = new Map(keys.map((k) => [k, process.env[`OPENFILM_${k}`]]));
  for (const k of keys.slice(0, -1)) process.env[`OPENFILM_${k}`] = join(root, k.toLowerCase());
  process.env.OPENFILM_COMMUNITY_LIBRARY_URL = `http://127.0.0.1:${server.address().port}`;
  const { startStudio } = await import('./server.mjs');
  const studio = await startStudio({ port: 0, openBrowser: () => {} });
  t.after(async () => {
    await studio.close();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    for (const [k, v] of before) { if (v === undefined) delete process.env[`OPENFILM_${k}`]; else process.env[`OPENFILM_${k}`] = v; }
    rmSync(root, { recursive: true, force: true });
  });
  const api = (path, body) => fetch(studio.origin + path, { method: body ? 'POST' : 'GET', headers: { 'x-studio-key': studio.key, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });

  /* read: each a file of its kind, the footage with its poster, the picture its own; the pack holds the three */
  const index = await (await api('/api/library')).json();
  const media = index.items.filter((it) => it.cat === 'media');
  assert.deepEqual(media.map((it) => [it.kind, it.media, Boolean(it.poster)]), [['file', 'video', true], ['file', 'image', false], ['file', 'audio', false]]);
  const pack = index.packs.find((p) => p.id === 'ana/city');
  assert.deepEqual([pack.cats, pack.count], [['media'], 3]);

  /* the pack kept: a new folder named after it, the three files in it by their names, and the pack added */
  const saved = await (await api('/api/library/packs/save', { pack: 'ana/city', lang: 'zh-CN' })).json();
  assert.equal(saved.path, 'saved/城市');
  assert.deepEqual(readdirSync(join(root, 'saved', '城市')).sort(), ['素材 rain.m4a', '素材 sky.jpg', '素材 street.mp4']);
  assert.deepEqual(readFileSync(join(root, 'saved', '城市', '素材 street.mp4')), video);
  assert.ok((await (await api('/api/library/added')).json()).ids.includes('ana/city'));
  /* again: another folder beside it, never over it */
  assert.equal((await (await api('/api/library/packs/save', { pack: 'ana/city', lang: 'en' })).json()).path, 'saved/City');
  /* no such pack, or one with no media: said */
  assert.equal((await api('/api/library/packs/save', { pack: 'ana/none' })).status, 404);

  /* a file alone: into a folder of the person's, under its name */
  const sky = media.find((it) => it.media === 'image');
  const one = await (await api('/api/saved/files/from-library', { from: `openfilm/${sky.id}`, into: 'saved/City', name: 'Blue sky' })).json();
  assert.equal(one.path, 'saved/City/Blue sky.jpg');
  assert.ok(existsSync(join(root, 'saved', 'City', 'Blue sky.jpg')));
});

test('a media entry of the catalog is one file of its kind (footage with its poster), or the catalog is not read', async () => {
  const { decodeForTest } = await import('./community-library.mjs');
  const bytes = { bytes: 3, sha256: 'a'.repeat(64) };
  const entry = (media, files, durationMs = 1000) => ({ id: 'media/one', version: 1, revision: 'b'.repeat(64), by: 'ana',
    name: names('One', '一'), about: '', tags: [], durationMs, media, files });
  const read = (e) => decodeForTest({ version: 1, items: [e] });
  assert.equal(read(entry('video', { 'community-media-one.mov': bytes, 'poster.jpg': bytes })).items[0].poster, `community/v1/media/one-v1-${'b'.repeat(64)}/poster.jpg`);
  assert.equal(read(entry('image', { 'community-media-one.webp': bytes }, 0)).items[0].kind, 'file');
  assert.throws(() => read(entry('video', { 'community-media-one.mp4': bytes })), /files/, 'footage without its poster');
  assert.throws(() => read(entry('image', { 'community-media-one.png': bytes, 'poster.jpg': bytes }, 0)), /files/, 'a picture with a poster');
  assert.throws(() => read(entry('audio', { 'community-media-one.ogg': bytes })), /file/, 'a kind of file not taken');
  assert.throws(() => read(entry('model', { 'community-media-one.glb': bytes })), /item/, 'no such media');
  assert.throws(() => read(entry('audio', { 'community-media-one.m4a': bytes }, 0)), /item/, 'a recording lasts');
  assert.throws(() => read(entry('video', { 'community-media-one.mp4': { bytes: 60 * 1024 * 1024, sha256: 'a'.repeat(64) }, 'poster.jpg': bytes })), /file/, 'too large');
});
