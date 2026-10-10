import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStudio } from './server.mjs';
import { filmHtml } from '../../src/film-doc.mjs';

let studio, scratch;
before(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'of-pageframes-'));
  process.env.OPENFILM_HOME = join(scratch, 'home');
  process.env.OPENFILM_LIBRARY = join(scratch, 'library');
  process.env.OPENFILM_TRASH_DIR = join(scratch, 'trash');
  mkdirSync(process.env.OPENFILM_TRASH_DIR);
  studio = await startStudio({ port: 0, openBrowser: () => {} });
});
after(() => studio.close());

const api = (path, { method = 'GET', body } = {}) => fetch(`${studio.origin}${path}`, {
  method,
  headers: { 'x-studio-key': studio.key, ...(body ? { 'content-type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const posterOf = async (id) => {
  const res = await api(`/api/projects/${id}/poster`);
  assert.equal(res.status, 200);
  return Buffer.from(await res.arrayBuffer());
};

test('a project\'s card: its film\'s poster; once the film changes, the last one at once while the new one is drawn', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Card') } })).json();
  /* a page slow to get ready: its film takes a while to draw, as a film of many pages does */
  const page = (color) => writeFileSync(join(project.path, 'p.html'), `<!doctype html><body style="margin:0"><div id="b" style="width:1920px;height:1080px"></div><script>
    window.film = { duration: 2, ready: new Promise((r) => setTimeout(r, 1500)), frame(t) { document.getElementById('b').style.background = '${color}'; } };
  </script></body>`);
  page('#f00');
  writeFileSync(join(project.path, 'film.html'), filmHtml({ tracks: [{ clips: [{ src: 'p.html' }] }] }));
  /* never drawn: waited for */
  const red = await posterOf(project.id);
  assert.deepEqual([...red.subarray(0, 2)], [0xff, 0xd8]);
  assert.ok(existsSync(join(project.path, '.film', 'cache', 'film-poster.jpg')), 'kept as the film\'s last poster');

  page('#00f');
  writeFileSync(join(project.path, 'film.html'), filmHtml({ tracks: [{ clips: [{ src: 'p.html', id: 'blue' }] }] }));
  const t0 = Date.now();
  const stale = await posterOf(project.id);
  assert.ok(Date.now() - t0 < 1200, 'not waiting for the new one');
  assert.ok(stale.equals(red), 'the last poster');
  /* the new one was drawn meanwhile, once however often it is asked for */
  let fresh = stale;
  for (const end = Date.now() + 30_000; fresh.equals(red) && Date.now() < end;) {
    await new Promise((r) => setTimeout(r, 200));
    fresh = await posterOf(project.id);
  }
  assert.ok(!fresh.equals(red), 'the changed film\'s poster, next time');
});

test('a film that has nothing in it has no poster', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Empty') } })).json();
  writeFileSync(join(project.path, 'film.html'), filmHtml({ tracks: [{ clips: [] }] }));
  assert.equal((await api(`/api/projects/${project.id}/poster`)).status, 404);
});

test('a page\'s thumbnail follows the files the page loads: a stylesheet it shares changed, it is drawn again', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Shared') } })).json();
  writeFileSync(join(project.path, 'look.css'), 'body { margin: 0; background: #f00 }');
  writeFileSync(join(project.path, 'p.html'), '<!doctype html><link rel="stylesheet" href="look.css"><body><script>window.film = { duration: 2, frame() {} };</script></body>');
  writeFileSync(join(project.path, 'film.html'), filmHtml({ tracks: [{ clips: [{ src: 'p.html' }] }] }));
  const frame = async (tag) => {
    const res = await api(`/api/projects/${project.id}/media?what=frame&path=p.html&ms=500&w=160`, tag ? { headers: {} } : undefined);
    return { status: res.status, etag: res.headers.get('etag'), cache: res.headers.get('cache-control'), body: Buffer.from(await res.arrayBuffer()) };
  };
  const red = await frame();
  assert.equal(red.status, 200);
  assert.match(red.cache, /no-cache/, 'asked again each time');
  const again = await fetch(`${studio.origin}/api/projects/${project.id}/media?what=frame&path=p.html&ms=500&w=160`, { headers: { 'x-studio-key': studio.key, 'if-none-match': red.etag } });
  assert.equal(again.status, 304, 'unchanged: answered in a word');
  writeFileSync(join(project.path, 'look.css'), 'body { margin: 0; background: #00f }');
  const blue = await frame();
  assert.ok(!blue.body.equals(red.body), 'the page drawn again with its new style');
});

test('a page that never gets ready (a loop that never ends) fails in its own time, and the pages after it are drawn', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Stuck') } })).json();
  writeFileSync(join(project.path, 'loop.html'), '<!doctype html><body><script>window.film = { duration: 2, ready: new Promise(() => setTimeout(() => { for (;;) {} }, 100)), frame() {} };</script></body>');
  writeFileSync(join(project.path, 'p.html'), '<!doctype html><body style="background:#0a0"><script>window.film = { duration: 2, frame() {} };</script></body>');
  writeFileSync(join(project.path, 'film.html'), filmHtml({ tracks: [{ clips: [{ src: 'loop.html' }, { src: 'p.html' }] }] }));
  const frame = (path, ms) => api(`/api/projects/${project.id}/media?what=frame&path=${path}&ms=${ms}&w=160`);
  const t0 = Date.now();
  const [stuck, next] = await Promise.all([frame('loop.html', 500), frame('p.html', 500)]);
  assert.equal(stuck.status, 422);
  assert.match((await stuck.json()).error, /film\.ready did not finish within 15 s \(the page is still running code/);
  assert.equal(next.status, 200, 'the page queued behind it');
  assert.ok(Date.now() - t0 < 25_000, 'not waited on for ever');
  /* its other frames fail at once for a while, rather than each waiting out the same page */
  const t1 = Date.now();
  assert.equal((await frame('loop.html', 1500)).status, 422);
  assert.ok(Date.now() - t1 < 2000);
});

test('a page asked for by a path out of the project (`../`) is not there: never opened, probed or drawn', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Asker') } })).json();
  mkdirSync(join(scratch, 'Elsewhere'), { recursive: true });
  writeFileSync(join(scratch, 'Elsewhere', 'p.html'), '<!doctype html><body><script>window.film = { duration: 2, frame() {} };</script></body>');
  for (const what of ['frame&ms=0&w=160', 'poster', 'probe']) {
    const res = await api(`/api/projects/${project.id}/media?what=${what}&path=${encodeURIComponent('../Elsewhere/p.html')}`);
    assert.equal(res.status, 404, what);
    assert.match((await res.json()).error, /is not there/);
  }
});
