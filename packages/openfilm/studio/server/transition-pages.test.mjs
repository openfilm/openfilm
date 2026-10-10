import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpError, json } from './http.mjs';
import { transitionPageRoutes, writeTransitionPage } from './transition-pages.mjs';

const PAGE = '<!doctype html><html><body style="background:#fff"><script>window.film = { frame() {} };</script></body></html>';

test('a transition\'s page is kept once, under its name; one there already stays as it is', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-transitions-'));
  assert.equal(await writeTransitionPage(root, 'white', PAGE), 'transitions/white.html');
  writeFileSync(join(root, 'transitions/white.html'), PAGE.replace('#fff', '#eee'));
  assert.equal(await writeTransitionPage(root, 'white', PAGE), 'transitions/white.html');
  assert.match(readFileSync(join(root, 'transitions/white.html'), 'utf8'), /#eee/);
  for (const name of ['../x', 'a/b', 'White', '']) await assert.rejects(writeTransitionPage(root, name, PAGE), HttpError, name);
  await assert.rejects(writeTransitionPage(root, 'black', '<!doctype html><p>no film</p>'), HttpError);
});

test('the route', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-transitions-'));
  const server = createServer((req, res) => {
    const rest = new URL(req.url ?? '/', 'http://x').pathname.slice(1);
    transitionPageRoutes(req, res, root, rest).then((done) => { if (!done) json(res, 404, {}); }, (e) => json(res, e instanceof HttpError ? e.status : 500, { error: e.message }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/transition-pages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.deepEqual(await (await post({ name: 'white', html: PAGE })).json(), { path: 'transitions/white.html' });
    assert.equal((await post({ name: 'white' })).status, 400);
    assert.equal((await fetch(`${base}/transition-pages`)).status, 404);
  } finally { server.close(); }
});
