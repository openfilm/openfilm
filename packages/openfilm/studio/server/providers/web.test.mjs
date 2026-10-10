import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetched, hitOf, htmlText, readPage, reading, searched, urlsOf } from './web.mjs';

/** Web pages on 127.0.0.1: `pages` answers each path. */
let server, base;
let pages = {};

before(async () => {
  server = createServer((req, res) => {
    const [status, body, headers = { 'content-type': 'text/html; charset=utf-8' }] = pages[req.url] ?? [404, 'no'];
    res.writeHead(status, headers).end(body);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const ctx = () => ({ key: '', root: '/project', signal: new AbortController().signal, say: () => {}, read: async () => new Uint8Array() });

test('a page\'s text: its article, headings and list items kept, scripts, navigation and footers left out', () => {
  const page = htmlText(`<!doctype html><html><head><title>Brass &amp; keys</title><style>p{}</style></head><body>
    <nav><a href="/">Home</a></nav><script>var x = "<p>no</p>";</script>
    <article><h1>Brass <em>keys</em></h1><p>Old keys&nbsp;are   heavy.<br>Very&#x21;</p><ul><li>One</li><li>Two</li></ul></article>
    <footer>© 2026</footer></body></html>`);
  assert.equal(page.title, 'Brass & keys');
  assert.equal(page.text, '# Brass keys\n\nOld keys are heavy.\nVery!\n\n- One\n- Two');
});

test('the page is read in the character set it says it is in', async () => {
  reading.publicOnly = false;
  try {
    pages = { '/gbk': [200, Buffer.from([0xc4, 0xe3, 0xba, 0xc3]), { 'content-type': 'text/plain; charset=gbk' }] };
    assert.equal((await readPage(`${base}/gbk`, ctx())).text, '你好');
  } finally {
    reading.publicOnly = true;
  }
});

test('redirects are followed (each checked again); what is not a page or not there says so', async () => {
  reading.publicOnly = false;
  try {
    pages = {
      '/old': [301, '', { location: '/new' }],
      '/new': [200, '<html><title>New</title><body><main><p>Here now.</p></main></body></html>'],
      '/file.zip': [200, 'PK', { 'content-type': 'application/zip' }],
    };
    assert.deepEqual(await readPage(`${base}/old`, ctx()), { url: `${base}/new`, title: 'New', text: 'Here now.' });
    await assert.rejects(readPage(`${base}/file.zip`, ctx()), /not a web page \(application\/zip\)/);
    await assert.rejects(readPage(`${base}/gone`, ctx()), /answered 404/);
  } finally {
    reading.publicOnly = true;
  }
});

test('only public pages: this machine and its network are refused before anything is sent', async () => {
  pages = { '/': [200, '<p>private</p>'] };
  for (const url of [`${base}/`, 'http://localhost:1/', 'http://[::1]/', 'http://10.0.0.8/', 'http://192.168.1.1/admin', 'http://printer.local/', 'http://intranet/']) {
    await assert.rejects(readPage(url, ctx()), /only public web pages/, url);
  }
  await assert.rejects(readPage('ftp://example.com/', ctx()), /only http and https/);
});

test('search hits on one line and short; one query as it is, more as searches', () => {
  const hit = hitOf({ title: ' Blender ', url: 'https://www.blender.org', excerpt: `Free\n\n  and ${'open '.repeat(100)}` });
  assert.equal(hit.excerpt.length, 301);
  assert.match(hit.excerpt, /^Free and open/);
  assert.deepEqual(searched('brave', [{ query: 'a', hits: [hit] }], []).receipt, { provider: 'brave', query: 'a', hits: [hit] });
  assert.deepEqual(Object.keys(searched('brave', [{ query: 'a', hits: [] }, { query: 'b', hits: [] }], ['c']).receipt), ['provider', 'searches', 'ignored']);
});

test('pages read are saved as Markdown named after their address, with where they came from', () => {
  assert.throws(() => urlsOf({ url: ['assets/a.md'] }), /Not web addresses: assets\/a\.md/);
  assert.deepEqual(urlsOf({ url: ['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com'] }).ignored, ['https://d.com']);
  const result = fetched('tavily', [{ url: 'https://www.blender.org/download/releases/', title: 'Releases', text: 'Blender 5.2\n\nOut now.' }], [], []);
  assert.match(result.files[0].path, /^assets\/fetch\/blender\.org-download-releases-[0-9a-f]{6}\.md$/);
  const saved = Buffer.from(result.files[0].bytes).toString('utf8');
  assert.match(saved, /^<!-- source: https:\/\/www\.blender\.org\/download\/releases\/ -->\n<!-- fetched: .+ -->\n# Releases\n\nBlender 5\.2\n\nOut now\.\n$/);
  assert.deepEqual(result.receipt, { provider: 'tavily', src: result.files[0].path, url: 'https://www.blender.org/download/releases/', title: 'Releases', chars: 21, head: 'Blender 5.2 Out now.' });
  assert.throws(() => fetched('tavily', [], [{ url: 'https://x.com', why: 'it answered 403.' }], []), /Could not read:\n {2}https:\/\/x\.com: it answered 403\./);
});
