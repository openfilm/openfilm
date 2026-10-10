import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import brave from './brave.mjs';
import { reading } from './web.mjs';

const KEY = 'brave-test-key-0123456789';
/** A fake Brave Search, and web pages, on 127.0.0.1: `reply` answers each request; `seen` keeps them. */
let server, base;
let reply = () => [404, {}];
const seen = [];

before(async () => {
  server = createServer(async (req, res) => {
    const call = { method: req.method, url: new URL(req.url, 'http://x'), headers: req.headers };
    seen.push(call);
    const [status, body, type = 'application/json'] = await reply(call);
    res.writeHead(status, { 'content-type': type }).end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.OPENFILM_BRAVE_URL = base;
});
after(() => server.close());

const ctx = () => ({ key: KEY, root: '/project', signal: new AbortController().signal, say: () => {}, read: async () => new Uint8Array() });

test('each query is one search for web results, with the key, without highlighting', async () => {
  reply = (call) => [200, { web: { results: [{ title: `About ${call.url.searchParams.get('q')}`, url: 'https://www.blender.org', description: 'Free and open 3D.', page_age: '2026-09-01T00:00:00' }] } }];
  const one = await brave.run('web-search', { query: 'blender' }, ctx());
  const search = seen.at(-1);
  assert.equal(search.url.pathname, '/res/v1/web/search');
  assert.equal(search.headers['x-subscription-token'], KEY);
  assert.deepEqual(Object.fromEntries(search.url.searchParams), { q: 'blender', count: '8', result_filter: 'web', text_decorations: 'false' });
  assert.deepEqual(one.receipt, { provider: 'brave', query: 'blender', hits: [{ title: 'About blender', url: 'https://www.blender.org', publishedAt: '2026-09-01T00:00:00', excerpt: 'Free and open 3D.' }] });
  const many = await brave.run('web-search', { query: ['a', 'b', 'c', 'd'] }, ctx());
  assert.deepEqual(many.receipt.searches.map((s) => s.query), ['a', 'b', 'c']);
  assert.deepEqual(many.receipt.ignored, ['d']);
});

test('pages are read here, without the key; one that cannot be read is said beside the rest', async () => {
  reading.publicOnly = false;
  try {
    seen.length = 0;
    reply = (call) => call.url.pathname === '/doc'
      ? [200, '<html><title>Doc</title><body><article><h2>Start</h2><p>Hello.</p></article></body></html>', 'text/html']
      : [403, 'no', 'text/plain'];
    const result = await brave.run('web-fetch', { url: [`${base}/doc`, `${base}/locked`] }, ctx());
    assert.ok(seen.every((c) => !c.headers['x-subscription-token']));
    assert.equal(result.files.length, 1);
    assert.match(Buffer.from(result.files[0].bytes).toString(), /# Doc\n\n## Start\n\nHello\.\n$/);
    assert.equal(result.receipt.pages[0].title, 'Doc');
    assert.deepEqual(result.receipt.failed, [{ url: `${base}/locked`, why: 'it answered 403.' }]);
  } finally {
    reading.publicOnly = true;
  }
});
