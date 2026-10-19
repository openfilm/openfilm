import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
/* a film's first poster, asked for again while it is being drawn (503), as a card does */
const firstPosterOf = async (id) => {
  for (const end = Date.now() + 60_000; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) {
    const res = await api(`/api/projects/${id}/poster`);
    if (res.status !== 503) {
      assert.equal(res.status, 200);
      return Buffer.from(await res.arrayBuffer());
    }
  }
  assert.fail('never drawn');
};

test('a project\'s card: its film\'s poster; once the film changes, the last one at once while the new one is drawn', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Card') } })).json();
  /* a page slow to get ready: its film takes a while to draw, as a film of many pages does */
  const page = (color) => writeFileSync(join(project.path, 'p.html'), `<!doctype html><body style="margin:0"><div id="b" style="width:1920px;height:1080px"></div><script>
    window.film = { duration: 2, ready: new Promise((r) => setTimeout(r, 1500)), frame(t) { document.getElementById('b').style.background = '${color}'; } };
  </script></body>`);
  page('#f00');
  writeFileSync(join(project.path, 'film.html'), filmHtml({ tracks: [{ clips: [{ src: 'p.html' }] }] }));
  /* never drawn: drawn, asked for again meanwhile */
  const red = await firstPosterOf(project.id);
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

test('a card waits a moment only for a film\'s first poster: drawn on, it is asked for again (the request held no connection)', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Slow') } })).json();
  writeFileSync(join(project.path, 'p.html'), `<!doctype html><body style="margin:0;background:#0a0"><script>
    window.film = { duration: 2, ready: new Promise((r) => setTimeout(r, 6000)), frame() {} };
  </script></body>`);
  writeFileSync(join(project.path, 'film.html'), filmHtml({ tracks: [{ clips: [{ src: 'p.html' }] }] }));
  const t0 = Date.now();
  const res = await api(`/api/projects/${project.id}/poster`);
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('retry-after'), '5');
  assert.equal((await res.json()).code, 'drawing');
  assert.ok(Date.now() - t0 < 4000, 'answered within moments');
  const poster = await firstPosterOf(project.id);
  assert.deepEqual([...poster.subarray(0, 2)], [0xff, 0xd8]);
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

test('a page clip\'s thumbnail shows the changes made in it (its overrides): another change, another picture', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Tweaked') } })).json();
  writeFileSync(join(project.path, 'p.html'), '<!doctype html><body style="margin:0;background:#fff"><div id="box" style="width:960px;height:1080px;background:#f00"></div><script>window.film = { duration: 2, frame() {} };</script></body>');
  const film = (overrides) => writeFileSync(join(project.path, 'film.html'), filmHtml({ tracks: [{ clips: [{ id: 'p', src: 'p.html', ...(overrides ? { overrides } : {}) }] }] }));
  const frame = async (clip) => Buffer.from(await (await api(`/api/projects/${project.id}/media?what=frame&path=p.html&ms=500&w=160${clip ? '&clip=p' : ''}`)).arrayBuffer());
  film(null);
  const plain = await frame(true);
  assert.ok(plain.equals(await frame(false)), 'no changes: the page as it is');
  film([{ at: '#box', t: [960, 0] }]);
  const moved = await frame(true);
  assert.ok(!moved.equals(plain), 'the box moved across');
  assert.ok((await frame(false)).equals(plain), 'the page itself, asked without its clip, is as it was');
  film([{ at: '#box', style: { backgroundColor: '#00f' } }]);
  assert.ok(!(await frame(true)).equals(moved), 'changed again: drawn again');
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

test('a page\'s facts: its own size, or none (reflows: shown alone at 1920 × 1080, in a film at what it is given)', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Facts') } })).json();
  writeFileSync(join(project.path, 'chart.html'), '<!doctype html><script>window.film = { width: 480, height: 320, frame() {} };</script>');
  writeFileSync(join(project.path, 'cards.html'), '<!doctype html><script>window.film = { duration: 5, frame() {} };</script>');
  const facts = async (path) => (await api(`/api/projects/${project.id}/media?what=probe&path=${path}`)).json();
  assert.deepEqual(await facts('chart.html'), { width: 480, height: 320 });
  assert.deepEqual(await facts('cards.html'), { duration: 5, width: 1920, height: 1080, reflows: true });
});

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('a film whose footage no browser decodes (ProRes) has its picture on its card, through a copy', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 120_000 }, async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'ProRes') } })).json();
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2060c0:size=320x180:rate=30', '-t', '2', '-c:v', 'prores_ks', '-profile:v', '3', join(project.path, 'a.mov')]);
  writeFileSync(join(project.path, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'v', src: 'a.mov', at: 0, time: [0, 2] }] }] }));
  const jpeg = await firstPosterOf(project.id);
  const [r, g, b] = execFileSync('ffmpeg', ['-v', 'error', '-f', 'image2pipe', '-i', '-', '-frames:v', '1', '-vf', 'crop=4:4:iw/2:ih/2,format=rgb24', '-f', 'rawvideo', '-'], { input: jpeg });
  assert.ok(Math.abs(r - 0x20) < 20 && Math.abs(g - 0x60) < 20 && Math.abs(b - 0xc0) < 20, `the footage's colour: ${r},${g},${b}`);
});
