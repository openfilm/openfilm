import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import pexels from './pexels.mjs';

const KEY = 'pexels-test-key-0123456789';
/** A fake Pexels (its API and its picture files) on 127.0.0.1: `reply` answers each request; `seen` keeps them. */
let server, base;
let reply = () => [404, {}];
const seen = [];

before(async () => {
  server = createServer(async (req, res) => {
    const call = { method: req.method, url: new URL(req.url, 'http://x'), headers: req.headers };
    seen.push(call);
    const [status, body, type = 'application/json'] = await reply(call);
    res.writeHead(status, { 'content-type': type }).end(Buffer.isBuffer(body) ? body : JSON.stringify(body));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.OPENFILM_PEXELS_URL = base;
});
after(() => server.close());

const ctx = () => ({ key: KEY, root: '/project', signal: new AbortController().signal, say: () => {}, read: async () => new Uint8Array() });

/** A JPEG header saying its size. */
function jpeg(w, h) {
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
}

const photo = (id, photographer) => ({
  id, width: 6000, height: 4000, url: `https://www.pexels.com/photo/${id}/`, photographer,
  src: { original: `${base}/files/${id}-original.jpeg`, large2x: `${base}/files/${id}.jpeg`, large: `${base}/files/${id}-large.jpeg` },
});

test('photos found with the key, the large ones downloaded and named after --out, each with its credit', async () => {
  reply = (call) => {
    if (call.url.pathname === '/v1/search') return [200, { photos: [photo(1, 'Ann'), photo(2, 'Bo'), photo(3, 'Cy')] }];
    /* the first cannot be downloaded: the next one stands in */
    if (call.url.pathname === '/files/1.jpeg') return [500, {}];
    if (call.url.pathname.startsWith('/files/')) return [200, jpeg(1880, 1253), 'image/jpeg'];
    return [404, {}];
  };
  const result = await pexels.run('image-search', { out: 'hero', prompt: 'brass key on linen', n: 2 }, ctx());
  const search = seen.find((c) => c.url.pathname === '/v1/search');
  assert.equal(search.headers.authorization, KEY);
  assert.equal(search.url.searchParams.get('query'), 'brass key on linen');
  assert.equal(search.url.searchParams.get('per_page'), '4');
  assert.ok(seen.filter((c) => c.url.pathname.startsWith('/files/')).every((c) => !c.headers.authorization), 'the key goes to the API only');
  assert.deepEqual(result.files.map((f) => f.path), ['assets/image/hero.jpg', 'assets/image/hero_2.jpg']);
  assert.deepEqual(result.receipt.images.map((i) => [i.width, i.height, i.credit, i.page]), [
    [1880, 1253, 'Photo by Bo on Pexels', 'https://www.pexels.com/photo/2/'],
    [1880, 1253, 'Photo by Cy on Pexels', 'https://www.pexels.com/photo/3/'],
  ]);
  assert.deepEqual([result.receipt.asked, result.receipt.landed], [2, 2]);
  assert.deepEqual(result.index[0], { src: 'assets/image/hero.jpg', kind: 'image', w: 1880, h: 1253,
    from: { mode: 'search', prompt: 'brass key on linen', provider: 'pexels', sourceUrl: 'https://www.pexels.com/photo/2/', credit: 'Photo by Bo on Pexels' } });
});

test('nothing found says so; a refused key says where to check it', async () => {
  reply = () => [200, { photos: [] }];
  await assert.rejects(pexels.run('image-search', { out: 'x', prompt: 'zzqx' }, ctx()), /Pexels found no pictures for "zzqx"/);
  reply = () => [401, { error: 'Unauthorized' }];
  await assert.rejects(pexels.run('image-search', { out: 'x', prompt: 'y' }, ctx()), /Pexels did not accept your key \(401\)/);
});

test('clips found: each its MP4 nearest Full HD, with its length, size and who made it; the key to the API only', async () => {
  seen.length = 0;
  const files = (id) => [
    { quality: 'hd', file_type: 'video/mp4', width: 3840, height: 2160, link: `${base}/files/${id}-4k.mp4` },
    { quality: 'hd', file_type: 'video/mp4', width: 1920, height: 1080, link: `${base}/files/${id}-hd.mp4` },
    { quality: 'sd', file_type: 'video/mp4', width: 640, height: 360, link: `${base}/files/${id}-sd.mp4` },
  ];
  reply = (call) => {
    if (call.url.pathname === '/v1/videos/search') {
      return [200, { videos: [{ id: 7, url: 'https://www.pexels.com/video/7/', duration: 12, user: { name: 'Dee' }, video_files: files(7) }] }];
    }
    if (call.url.pathname.startsWith('/files/')) return [200, Buffer.from('mp4'), 'video/mp4'];
    return [404, {}];
  };
  const result = await pexels.run('video-search', { out: 'city', prompt: 'lisbon tram', orientation: 'portrait' }, ctx());
  const search = seen.find((c) => c.url.pathname === '/v1/videos/search');
  assert.deepEqual([search.headers.authorization, search.url.searchParams.get('orientation')], [KEY, 'portrait']);
  assert.ok(seen.some((c) => c.url.pathname === '/files/7-hd.mp4') && !seen.some((c) => c.url.pathname === '/files/7-4k.mp4'));
  assert.deepEqual(result.index[0], { src: 'assets/video/city.mp4', kind: 'video', dur: 12, w: 1920, h: 1080,
    from: { mode: 'search', prompt: 'lisbon tram', provider: 'pexels', sourceUrl: 'https://www.pexels.com/video/7/', credit: 'Video by Dee on Pexels' } });
});
