import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import pixabay from './pixabay.mjs';

const KEY = 'pixabay-test-key-0123456789';
/** A fake Pixabay (its API and its picture files) on 127.0.0.1: `reply` answers each request; `seen` keeps them. */
let server, base;
let reply = () => [404, {}];
const seen = [];

before(async () => {
  server = createServer(async (req, res) => {
    const call = { method: req.method, url: new URL(req.url, 'http://x'), headers: req.headers };
    seen.push(call);
    const [status, body, type = 'application/json'] = await reply(call);
    res.writeHead(status, { 'content-type': type }).end(Buffer.isBuffer(body) ? body : typeof body === 'string' ? body : JSON.stringify(body));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.OPENFILM_PIXABAY_URL = base;
});
after(() => server.close());

const ctx = (model) => ({ key: KEY, model, root: '/project', signal: new AbortController().signal, say: () => {}, read: async () => new Uint8Array() });

function png(w, h) {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

test('pictures found with the key, the largest a key gets downloaded, each with its credit', async () => {
  reply = (call) => {
    if (call.url.pathname === '/api/') {
      return [200, { total: 2, totalHits: 2, hits: [
        { id: 7, pageURL: 'https://pixabay.com/photos/key-7/', user: 'Dee', largeImageURL: `${base}/get/7_1280.png`, webformatURL: `${base}/get/7_640.png` },
      ] }];
    }
    if (call.url.pathname === '/get/7_1280.png') return [200, png(1280, 853), 'image/png'];
    return [404, {}];
  };
  const result = await pixabay.run('image-search', { out: 'key.png', prompt: 'brass key', n: 3 }, ctx('illustration'));
  const search = seen.find((c) => c.url.pathname === '/api/').url.searchParams;
  assert.deepEqual([search.get('key'), search.get('q'), search.get('image_type'), search.get('safesearch'), search.get('per_page')], [KEY, 'brass key', 'illustration', 'true', '5']);
  assert.deepEqual(result.files.map((f) => f.path), ['assets/image/key.png']);
  assert.deepEqual(result.receipt.images[0], { src: 'assets/image/key.png', width: 1280, height: 853, source: 'web', alpha: false, credit: 'Image by Dee on Pixabay', page: 'https://pixabay.com/photos/key-7/' });
  assert.deepEqual([result.receipt.asked, result.receipt.landed], [3, 1]);
});

test('photos unless the person chose otherwise; a long prompt is cut to what Pixabay takes, and said', async () => {
  seen.length = 0;
  reply = (call) => call.url.pathname === '/api/' ? [200, { hits: [{ pageURL: 'p', user: 'u', largeImageURL: `${base}/get/1.png` }] }] : [200, png(4, 4), 'image/png'];
  const result = await pixabay.run('image-search', { out: 'x', prompt: 'a'.repeat(120) }, ctx());
  const search = seen.find((c) => c.url.pathname === '/api/').url.searchParams;
  assert.equal(search.get('image_type'), 'photo');
  assert.equal(search.get('q').length, 100);
  assert.equal(search.get('per_page'), '3');
  assert.equal(result.receipt.notes.length, 1);
});

test('a key it does not take is said like any refused key; an error echoing the key does not show it', async () => {
  reply = () => [400, '[ERROR 400] Invalid or missing API key (https://pixabay.com/api/docs/).', 'text/plain'];
  await assert.rejects(pixabay.run('image-search', { out: 'x', prompt: 'y' }, ctx()), /Pixabay did not accept your key\. Check it in Studio/);
  reply = () => [500, `failed for key=${KEY}`, 'text/plain'];
  await assert.rejects(pixabay.run('image-search', { out: 'x', prompt: 'y' }, ctx()), (e) => e.message === 'Pixabay answered 500: failed for key=•••');
});
