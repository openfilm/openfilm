import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import tavily from './tavily.mjs';

const KEY = 'tvly-test-key-0123456789';
/** A fake Tavily on 127.0.0.1: `reply` answers each request; `seen` keeps them. */
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
  process.env.OPENFILM_TAVILY_URL = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const ctx = (model) => ({ key: KEY, model, root: '/project', signal: new AbortController().signal, say: () => {}, read: async () => new Uint8Array() });

test('a search with the key, at the depth the person chose', async () => {
  reply = () => [200, { query: 'gsap', results: [{ title: 'GSAP Docs', url: 'https://gsap.com/docs', content: 'Timelines let you sequence…', score: 0.9 }] }];
  const result = await tavily.run('web-search', { query: 'gsap' }, ctx('advanced'));
  const search = seen.at(-1);
  assert.equal(search.url.pathname, '/search');
  assert.equal(search.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(search.body, { query: 'gsap', search_depth: 'advanced', max_results: 8, topic: 'general' });
  assert.deepEqual(result.receipt, { provider: 'tavily', query: 'gsap', hits: [{ title: 'GSAP Docs', url: 'https://gsap.com/docs', excerpt: 'Timelines let you sequence…' }] });
  await tavily.run('web-search', { query: 'x' }, ctx());
  assert.equal(seen.at(-1).body.search_depth, 'basic');
});

test('pages read by Tavily as Markdown, the heading as the title; the ones it could not read are said', async () => {
  reply = () => [200, {
    results: [{ url: 'https://gsap.com/docs', raw_content: '# GSAP\n\nAnimate anything.' }],
    failed_results: [{ url: 'https://x.com/a', error: 'blocked' }],
  }];
  const result = await tavily.run('web-fetch', { url: ['https://gsap.com/docs', 'https://x.com/a', 'https://y.com/b'] }, ctx());
  assert.deepEqual(seen.at(-1).body, { urls: ['https://gsap.com/docs', 'https://x.com/a', 'https://y.com/b'], format: 'markdown', extract_depth: 'basic' });
  assert.match(Buffer.from(result.files[0].bytes).toString(), /# GSAP\n\nAnimate anything\.\n$/);
  assert.equal(result.receipt.pages[0].title, 'GSAP');
  assert.deepEqual(result.receipt.failed, [{ url: 'https://x.com/a', why: 'blocked' }, { url: 'https://y.com/b', why: 'Tavily read no text from it.' }]);
});

test('out of credits is an empty balance, the same as every provider', async () => {
  reply = () => [432, { detail: { error: 'This request exceeds your plan\'s set usage limit.' } }];
  await assert.rejects(tavily.run('web-search', { query: 'x' }, ctx()), (e) => e.code === 'balance');
});
