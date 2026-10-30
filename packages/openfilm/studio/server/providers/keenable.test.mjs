import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import keenable from './keenable.mjs';

const KEY = 'kn-test-key-0123456789';
/** A fake Keenable on 127.0.0.1: `reply` answers each request; `seen` keeps them. */
let server;
let reply = () => [404, {}];
const seen = [];

before(async () => {
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const call = { method: req.method, url: new URL(req.url, 'http://x'), headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString() || 'null') };
    seen.push(call);
    const [status, body] = await reply(call);
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  process.env.OPENFILM_KEENABLE_URL = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const ctx = (key = '') => ({ key, root: '/project', signal: new AbortController().signal, say: () => {}, read: async () => new Uint8Array() });

test('with no key, each query is one search on the public endpoint, the app named; the excerpt is the snippet', async () => {
  reply = (call) => [200, { query: call.body.query, results: [{ title: 'GSAP Docs', url: 'https://gsap.com/docs', description: '', snippet: '# Timelines\nSequence\n  tweens.', acquired_at: '2026-10-01T00:00:00Z' }] }];
  const one = await keenable.run('web-search', { query: 'gsap' }, ctx());
  const search = seen.at(-1);
  assert.equal(search.method, 'POST');
  assert.equal(search.url.pathname, '/v1/search/public');
  assert.equal(search.headers['x-keenable-title'], 'OpenFilm');
  assert.equal(search.headers['x-api-key'], undefined);
  assert.deepEqual(search.body, { query: 'gsap', max_results: 8 });
  assert.deepEqual(one.receipt, { provider: 'keenable', query: 'gsap', hits: [{ title: 'GSAP Docs', url: 'https://gsap.com/docs', excerpt: '# Timelines Sequence tweens.' }] });
  assert.equal(one.cost, undefined, 'nothing is billed without a key');
  const many = await keenable.run('web-search', { query: ['a', 'b', 'c', 'd'] }, ctx());
  assert.deepEqual(many.receipt.searches.map((s) => s.query), ['a', 'b', 'c']);
  assert.deepEqual(many.receipt.ignored, ['d']);
});

test('with a key, the keyed endpoint, the key in X-API-Key, billed to it', async () => {
  reply = () => [200, { results: [] }];
  const result = await keenable.run('web-search', { query: 'blender' }, ctx(KEY));
  const search = seen.at(-1);
  assert.equal(search.url.pathname, '/v1/search');
  assert.equal(search.headers['x-api-key'], KEY);
  assert.equal(search.headers['x-keenable-title'], 'OpenFilm');
  assert.deepEqual(result.receipt, { provider: 'keenable', query: 'blender', hits: [] });
  assert.deepEqual(result.cost, { note: 'billed by Keenable to your key' });
});

test('pages read by Keenable as Markdown, one request each; the ones it could not read are said beside the rest', async () => {
  seen.length = 0;
  reply = (call) => {
    const url = call.url.searchParams.get('url');
    if (url === 'https://gsap.com/docs') return [200, { url, title: 'GSAP', content: 'Animate anything.', description: '' }];
    if (url === 'https://y.com/empty') return [200, { url, title: 'Empty', content: '' }];
    return [502, { error: 'Bad gateway', message: 'The target page could not be reached by the fetcher.' }];
  };
  const result = await keenable.run('web-fetch', { url: ['https://gsap.com/docs', 'https://x.com/a', 'https://y.com/empty', 'https://z.com/four'] }, ctx());
  /* asked together, so they arrive in any order */
  assert.deepEqual(seen.map((c) => [c.method, c.url.pathname, c.url.searchParams.get('url')]).sort(), [
    ['GET', '/v1/fetch/public', 'https://gsap.com/docs'], ['GET', '/v1/fetch/public', 'https://x.com/a'], ['GET', '/v1/fetch/public', 'https://y.com/empty'],
  ]);
  assert.ok(seen.every((c) => c.headers['x-keenable-title'] === 'OpenFilm' && !c.headers['x-api-key']));
  assert.equal(result.files.length, 1);
  assert.match(Buffer.from(result.files[0].bytes).toString(), /<!-- source: https:\/\/gsap\.com\/docs -->[\s\S]*# GSAP\n\nAnimate anything\.\n$/);
  assert.equal(result.receipt.pages[0].title, 'GSAP');
  assert.deepEqual(result.receipt.failed, [
    /* with no key there is no key to blank out of the reason: it reads as Keenable said it */
    { url: 'https://x.com/a', why: 'Keenable answered 502: The target page could not be reached by the fetcher.' },
    { url: 'https://y.com/empty', why: 'Keenable read no text from it.' },
  ]);
  assert.deepEqual(result.receipt.ignored, ['https://z.com/four']);

  await keenable.run('web-fetch', { url: 'https://gsap.com/docs' }, ctx(KEY));
  assert.equal(seen.at(-1).url.pathname, '/v1/fetch');
  assert.equal(seen.at(-1).headers['x-api-key'], KEY);
});

test('out of credits is an empty balance, the same as every provider, for a search and for a page', async () => {
  reply = () => [402, { error: 'Payment required', message: 'No credits available' }];
  await assert.rejects(keenable.run('web-search', { query: 'x' }, ctx(KEY)), (e) => e.code === 'balance');
  await assert.rejects(keenable.run('web-fetch', { url: 'https://x.com/a' }, ctx(KEY)), (e) => e.code === 'balance');
});
