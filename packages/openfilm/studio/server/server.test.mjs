import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { connect } from 'node:net';
import { desktopInstaller, opener, startStudio } from './server.mjs';
import { filmHtml } from '../../src/film-doc.mjs';

let studio, scratch, opened;
before(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'of-server-'));
  process.env.OPENFILM_HOME = join(scratch, 'home');
  process.env.OPENFILM_LIBRARY = join(scratch, 'library');
  process.env.OPENFILM_TRASH_DIR = join(scratch, 'trash');
  mkdirSync(process.env.OPENFILM_TRASH_DIR);
  opened = [];
  studio = await startStudio({ port: 0, openBrowser: (url) => opened.push(url), quietMs: 150 });
});
after(() => studio.close());

const hasFfprobe = (() => { try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const api = (path, { method = 'GET', body, key = studio.key, headers = {} } = {}) => fetch(`${studio.origin}${path}`, {
  method,
  headers: { ...(key ? { 'x-studio-key': key } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
  body: body ? JSON.stringify(body) : undefined,
  redirect: 'manual',
});

/** A page's stream of events (a WebSocket), until `until(events)`. */
function collect(path, until) {
  return new Promise((done, fail) => {
    const ws = new WebSocket(`${studio.origin.replace(/^http/, 'ws')}${path}`, { headers: { 'x-studio-key': studio.key } });
    const events = [];
    ws.onmessage = (e) => { events.push(JSON.parse(String(e.data))); if (until(events)) ws.close(); };
    ws.onclose = () => done(events);
    ws.onerror = () => fail(new Error(`${path}: the stream did not open`));
  });
}

test('the API needs the key; /open sets it as a cookie and goes where it was asked', async () => {
  assert.equal((await api('/api/projects', { key: null })).status, 401);
  assert.equal((await api('/api/health', { key: null })).status, 200);
  assert.equal((await api(`/open?key=wrong`, { key: null })).status, 403);
  const res = await api(`/open?key=${studio.key}&to=/projects/x`, { key: null });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/projects/x');
  const cookie = res.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('/api/projects', { key: null, headers: { cookie } })).status, 200);
  /* a write with the cookie from any other origin is refused (a page elsewhere cannot drive Studio) */
  const write = await api('/api/projects', { method: 'POST', key: null, body: { name: 'x' }, headers: { cookie, origin: 'http://evil.test' } });
  assert.equal(write.status, 403);
});

test('openfilm open: with no editor page, the person\'s browser gets the address after the fallback', async () => {
  assert.equal((await api('/api/open', { method: 'POST', body: { path: 'Launch', fallback: 0 } })).status, 400, 'a relative folder would be Studio\'s own, not the caller\'s');
  const res = await api('/api/open', { method: 'POST', body: { path: join(scratch, 'Launch'), fallback: 0.05 } });
  const { project, url, pages } = await res.json();
  assert.equal(project.name, 'Launch');
  assert.equal(pages, 0);
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(opened, [url]);
});

test('openfilm open: an editor page that is open switches to the project, and nothing more opens', async () => {
  opened.length = 0;
  const events = collect('/api/events', (e) => e.length >= 1);
  await new Promise((r) => setTimeout(r, 50));
  const { project, pages } = await (await api('/api/open', { method: 'POST', body: { path: join(scratch, 'Second'), fallback: 0.05, now: true } })).json();
  assert.equal(pages, 1);
  assert.deepEqual(await events, [{ type: 'open', to: `/projects/${project.id}` }]);
  await new Promise((r) => setTimeout(r, 120));
  /* one window is enough: the page there shows it */
  assert.deepEqual(opened, []);
});

test('openfilm open: a page that opens the address within the fallback (an agent\'s own browser) keeps the person\'s closed', async () => {
  opened.length = 0;
  await api('/api/open', { method: 'POST', body: { path: join(scratch, 'Third'), fallback: 0.15 } });
  const page = new WebSocket(`${studio.origin.replace(/^http/, 'ws')}/api/events`, { headers: { 'x-studio-key': studio.key } });
  await new Promise((r) => { page.onopen = r; });
  await new Promise((r) => setTimeout(r, 250));
  assert.deepEqual(opened, [], 'no browser opened');
  page.close();
});

test('openfilm open: a page out of sight (a tab behind others, a hidden browser) switches too, and the browser opens', async () => {
  opened.length = 0;
  const ws = (visible) => new WebSocket(`${studio.origin.replace(/^http/, 'ws')}/api/events?visible=${visible}`, { headers: { 'x-studio-key': studio.key } });
  const hidden = ws(0);
  const told = [];
  hidden.onmessage = (e) => told.push(JSON.parse(e.data));
  await new Promise((r) => { hidden.onopen = r; });
  const { project, url, pages } = await (await api('/api/open', { method: 'POST', body: { path: join(scratch, 'Hidden'), now: true } })).json();
  assert.equal(pages, 0, 'none in sight');
  assert.deepEqual(opened, [url]);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(told, [{ type: 'open', to: `/projects/${project.id}` }]);
  /* brought into sight: it says so, and is enough again */
  opened.length = 0;
  hidden.send(JSON.stringify({ visible: true }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await (await api('/api/open', { method: 'POST', body: { path: join(scratch, 'Hidden'), now: true } })).json()).pages, 1);
  assert.deepEqual(opened, []);
  hidden.close();
});

test('openfilm open after a restart waits a moment for the pages of the Studio before to come back', async () => {
  opened.length = 0;
  const t0 = Date.now();
  const answer = api('/api/open', { method: 'POST', body: { path: join(scratch, 'Back'), now: true, pages: 1 } }).then((r) => r.json());
  await new Promise((r) => setTimeout(r, 300));
  const page = new WebSocket(`${studio.origin.replace(/^http/, 'ws')}/api/events?visible=1`, { headers: { 'x-studio-key': studio.key } });
  const { pages } = await answer;
  assert.equal(pages, 1, 'the page that came back shows it');
  assert.ok(Date.now() - t0 < 2000, 'not waited out once it is back');
  assert.deepEqual(opened, [], 'no second window');
  page.close();
});

test('openfilm open: `now` opens the person\'s browser at once (a person at a terminal)', async () => {
  opened.length = 0;
  const { url } = await (await api('/api/open', { method: 'POST', body: { path: join(scratch, 'Fourth'), now: true } })).json();
  assert.deepEqual(opened, [url]);
});

test('read, edit by id, and a stale edit on a clip the agent removed comes back 409 with the film as it is', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Edit') } })).json();
  const read = await (await api(`/api/projects/${project.id}`)).json();
  assert.deepEqual(read.doc, { stage: { w: 1920, h: 1080 }, tracks: [] });

  const added = await (await api(`/api/projects/${project.id}/edit`, { method: 'POST', body: { base: read.rev, ops: [{ op: 'insert', clip: { src: 'title.html' } }] } })).json();
  assert.equal(added.doc.tracks[0].clips[0].id, 'title');

  writeFileSync(join(project.path, 'film.html'), filmHtml({ stage: { w: 1920, h: 1080 }, tracks: [] }));
  const stale = await api(`/api/projects/${project.id}/edit`, { method: 'POST', body: { base: added.rev, ops: [{ op: 'set', clip: 'title', field: 'at', value: 2 }] } });
  assert.equal(stale.status, 409);
  const body = await stale.json();
  assert.match(body.error, /"title"/);
  assert.deepEqual(body.doc.tracks, []);

  const bad = await api(`/api/projects/${project.id}/edit`, { method: 'POST', body: { ops: [{ op: 'insert', clip: { src: 'notes.txt' } }] } });
  assert.equal(bad.status, 422);
});

test('a project\'s event stream reports the agent writing film.html', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Watch') } })).json();
  const events = collect(`/api/projects/${project.id}/events`, (e) => e.some((x) => x.type === 'film'));
  await new Promise((r) => setTimeout(r, 600));
  writeFileSync(join(project.path, 'film.html'), filmHtml({ stage: { w: 640, h: 360 }, tracks: [] }));
  const got = await events;
  assert.ok(got.find((e) => e.type === 'film').rev);
});

test('a film whose clips have no ids comes back with each named after its file, as the preview names them', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Unnamed') } })).json();
  writeFileSync(join(project.path, 'film.html'), filmHtml({ stage: { w: 1920, h: 1080 }, tracks: [{ clips: [{ src: 'title.html' }, { src: 'title.html', at: 2 }] }] }));
  const film = await (await api(`/api/projects/${project.id}`)).json();
  assert.deepEqual(film.value.tracks[0].clips.map((c) => c.id), ['title', 'title-2']);
});

test('rename renames the folder; delete moves it to the Trash and off the list', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { name: 'Draft' } })).json();
  const renamed = await (await api(`/api/projects/${project.id}`, { method: 'PATCH', body: { name: 'Final' } })).json();
  assert.equal(renamed.project.name, 'Final');
  assert.ok(existsSync(renamed.project.path));
  assert.equal((await api(`/api/projects/${project.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await api(`/api/projects/${project.id}`)).status, 404);
  assert.ok(!existsSync(renamed.project.path), 'the folder went to the Trash');
  assert.ok(readdirSync(process.env.OPENFILM_TRASH_DIR).some((n) => n.startsWith('Final')));
});

test('the film origin serves a project\'s files, with ranges, never .film/, and pages get the film clock', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Pages') } })).json();
  writeFileSync(join(project.path, 'scene.html'), '<!doctype html><html><head><title>x</title><script>window.mine=1</script></head></html>');
  writeFileSync(join(project.path, 'tone.wav'), '0123456789');
  const { folder } = await (await api(`/api/projects/${project.id}`)).json();
  assert.ok(folder.startsWith(studio.filmOrigin));

  const page = await fetch(`${folder}scene.html`);
  const html = await page.text();
  assert.ok(html.indexOf('window.filmHost') < html.indexOf('window.mine'), 'the clock comes before the page\'s own script');
  assert.equal(page.headers.get('access-control-allow-origin'), studio.origin);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors/);

  const tail = await fetch(`${folder}tone.wav`, { headers: { range: 'bytes=-3' } });
  assert.equal(tail.status, 206);
  assert.equal(await tail.text(), '789');
  assert.equal((await fetch(`${folder}tone.wav`, { headers: { range: 'bytes=20-' } })).status, 416);

  assert.equal((await fetch(`${folder}.film/id`)).status, 404);
  assert.equal((await fetch(`${folder}%2efilm/id`)).status, 404, 'an escaped dot is the same folder');
  assert.equal((await fetch(`${folder}.FILM/id`)).status, 404, 'and so is another case, on a disk that ignores it');
  assert.equal((await fetch(`${folder}.film.%20/id`)).status, 404, 'and the trailing dots and spaces Windows drops');
  assert.ok([400, 404].includes((await fetch(`${folder}assets%5C..%5C.film%5Cid`)).status), 'a backslash is never a separator in an address');
  /* a link the project brings that leads out of it (to any of the person's files) is not followed (links need
     Developer Mode on Windows: there the rest of the test stands) */
  if (process.platform !== 'win32') {
    writeFileSync(join(scratch, 'private.txt'), 'private');
    symlinkSync(join(scratch, 'private.txt'), join(project.path, 'notes.txt'));
    symlinkSync(scratch, join(project.path, 'up'));
    assert.equal((await fetch(`${folder}notes.txt`)).status, 404);
    assert.equal((await fetch(`${folder}up/private.txt`)).status, 404);
  }
  /* a malformed address is refused, and the origin keeps serving */
  assert.equal((await fetch(`${folder}%E0%A4%A`)).status, 400);
  assert.equal((await fetch(`${folder}tone.wav`)).status, 200);
  assert.equal((await fetch(`${folder}../Edit/film.html`)).status, 404);
  assert.equal((await fetch(`${studio.filmOrigin}/p/not-a-token/film.html`)).status, 404);
  assert.equal((await fetch(`${folder}film.html`, { method: 'POST' })).status, 405);
  /* the film is played by the timeline, which Studio drives */
  const played = await (await fetch(`${folder}film.html`)).text();
  assert.match(played, /window\.filmHost/);
  assert.match(played, /<script type="module" src="__film\/timeline\.mjs"><\/script>/);
  assert.equal((await fetch(`${folder}__film/timeline.mjs`)).status, 200);
});

test('files over the API: import a body of any size, list, move with film.html following, trash', async () => {
  process.env.OPENFILM_TRASH_DIR = join(scratch, 'trash');
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Media') } })).json();
  const big = Buffer.alloc(3 << 20, 7);
  const put = await api(`/api/projects/${project.id}/files?path=${encodeURIComponent('assets/footage/a.mp4')}`, { method: 'PUT' });
  assert.equal(put.status, 400, 'an import needs a body');
  const landed = await (await fetch(`${studio.origin}/api/projects/${project.id}/files?path=assets/footage/a.mp4`, {
    method: 'PUT', headers: { 'x-studio-key': studio.key }, body: big,
  })).json();
  assert.equal(landed.path, 'assets/footage/a.mp4');
  /* it is no video, and Studio says so (the file is kept: the person decides) */
  if (hasFfprobe) assert.match(landed.unreadable, /./);
  await api(`/api/projects/${project.id}/edit`, { method: 'POST', body: { ops: [{ op: 'insert', clip: { src: 'assets/footage/a.mp4' } }] } });
  const moved = await (await api(`/api/projects/${project.id}/files`, { method: 'PATCH', body: { from: 'assets/footage', to: 'assets/video' } })).json();
  assert.equal(moved.clips, 1);
  const listing = await (await api(`/api/projects/${project.id}/files`)).json();
  assert.deepEqual(listing.files.map((f) => [f.path, f.size]), [['assets/video/a.mp4', big.length]]);
  const { doc } = await (await api(`/api/projects/${project.id}`)).json();
  assert.equal(doc.tracks[0].clips[0].src, 'assets/video/a.mp4');
  assert.equal((await api(`/api/projects/${project.id}/files?path=assets/video/a.mp4`, { method: 'DELETE' })).status, 200);
  assert.equal((await api(`/api/projects/${project.id}/files?path=assets/video/a.mp4`, { method: 'DELETE' })).status, 404);
  assert.equal((await api(`/api/projects/${project.id}/files?path=..%2Fsecret`, { method: 'DELETE' })).status, 400);
  /* nor is a picture of three bytes, though a probe of it answers */
  if (hasFfprobe) {
    const tiny = await (await fetch(`${studio.origin}/api/projects/${project.id}/files?path=assets/broken.jpg`, {
      method: 'PUT', headers: { 'x-studio-key': studio.key }, body: 'abc',
    })).json();
    assert.equal(tiny.unreadable, 'there is no picture in it');
  }
});

test('history: nothing is committed on its own; the person commits, goes back as uncommitted changes, branches', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'History') } })).json();
  const history = (path = '', body, method = body ? 'POST' : 'GET') => api(`/api/projects/${project.id}/history${path}`, { method, ...(body ? { body } : {}) });
  writeFileSync(join(project.path, 'film.html'), filmHtml({ stage: { w: 640, h: 360 }, tracks: [] }));
  await api(`/api/projects/${project.id}/edit`, { method: 'POST', body: { ops: [{ op: 'stage', w: 800, h: 450 }] } });
  await new Promise((r) => setTimeout(r, 500));
  const before = await (await history()).json();
  assert.deepEqual(before.commits, [], 'nothing committed by the agent\'s writes or the person\'s edits');
  assert.ok(before.status.changes, 'they are uncommitted changes');
  assert.equal((await history('/commit', { message: ' ' })).status, 400);
  const events = collect(`/api/projects/${project.id}/events`, (e) => e.some((x) => x.type === 'history'));
  const { commit } = await (await history('/commit', { message: 'Wide' })).json();
  assert.ok((await events).some((e) => e.type === 'history-progress' && e.op === 'commit'), 'how far it is, while it runs');
  writeFileSync(join(project.path, 'film.html'), filmHtml({ stage: { w: 1, h: 1 }, tracks: [] }));
  const dirty = await history('/restore', { commit });
  assert.equal(dirty.status, 409);
  assert.equal((await dirty.json()).code, 'dirty', 'the editor says why in its own words');
  const discarded = await (await history('/discard', {})).json();
  assert.deepEqual(discarded.doc.stage, { w: 800, h: 450 });
  const branched = await (await history('/checkout', { branch: 'square', create: true })).json();
  assert.equal(branched.parkedBack, true);
  const after = await (await history()).json();
  assert.equal(after.status.branch, 'square');
  assert.deepEqual(after.status.files, { held: 1, heldBytes: after.status.files.heldBytes, ignored: 0 }, 'the film, and nothing else in the folder');
  assert.deepEqual((await (await history('/files')).json()).held.map((f) => f.path), ['film.html']);
  assert.deepEqual(after.commits.map((c) => c.message), ['Wide'], 'no commit of its own on the way');
  assert.equal((await history('/branches/square', undefined, 'DELETE')).status, 409, 'not the branch checked out');
});

test('a project whose folder is gone says so, never takes Studio down, and can be taken off the list', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Gone') } })).json();
  rmSync(project.path, { recursive: true, force: true });
  assert.equal((await api(`/api/projects/${project.id}`)).status, 410);
  assert.equal((await api(`/api/projects/${project.id}/events`)).status, 410);
  assert.equal((await api('/api/projects')).status, 200, 'Studio is still up');
  assert.equal((await api(`/api/projects/${project.id}`, { method: 'DELETE' })).status, 200);
  assert.ok(!(await (await api('/api/projects')).json()).projects.some((p) => p.id === project.id));
});

test('a page gone mid-request (its connection reset) ends only its own stream, never Studio', async () => {
  const { port } = new URL(studio.origin);
  const upgrade = (path, key) => `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n`
    + `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n${key ? `x-studio-key: ${key}\r\n` : ''}\r\n`;
  /* reset while Studio looks the project up, while it refuses one, and once the stream is open */
  const asks = [upgrade('/api/projects/nope/events', studio.key), upgrade('/api/events', null), upgrade('/api/events', studio.key)];
  await Promise.all(asks.flatMap((ask, i) => Array.from({ length: 10 }, () => new Promise((done) => {
    const socket = connect(Number(port), '127.0.0.1', () => {
      socket.write(ask);
      if (i < 2) socket.resetAndDestroy();
      else socket.once('data', () => socket.resetAndDestroy());
    });
    socket.on('error', () => {});
    socket.on('close', () => done(undefined));
  }))));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await api('/api/health')).status, 200);
});

test('an export is shown in the file manager only while it is there', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Shown') } })).json();
  const res = await api(`/api/projects/${project.id}/exports/nope/reveal`, { method: 'POST', body: {} });
  assert.equal(res.status, 404);
});

test('the Desktop button opens the installer for this computer, or the project\'s website, in the person\'s browser', async () => {
  /* a build from source names no place for installers: the website */
  assert.equal((await api('/api/desktop', { method: 'POST', body: { os: 'mac', arch: 'arm64' } })).status, 200);
  assert.equal(opened.at(-1), JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).homepage);
  const base = 'https://example.com/download/desktop';
  assert.equal(desktopInstaller('mac', 'arm64', base), `${base}/mac/arm64/OpenFilm-arm64.dmg`);
  assert.equal(desktopInstaller('win', 'x64', base), `${base}/win/x64/OpenFilm-Setup-x64.exe`);
  assert.equal(desktopInstaller('linux', 'x64', base), null);
  assert.equal(desktopInstaller('mac', 'ppc', base), null);
  assert.equal(desktopInstaller('mac', 'arm64', ''), null);
});

test('Settings → General: this Studio\'s version, and whether npm has a newer one', async () => {
  const v = await (await api('/api/version')).json();
  assert.equal(v.version, JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version);
  assert.equal(typeof v.newer, 'boolean');
});

test('the fonts installed here, for the inspector\'s font menu', async () => {
  const { fonts } = await (await api('/api/fonts')).json();
  assert.ok(Array.isArray(fonts));
  for (const f of fonts.slice(0, 20)) assert.ok(typeof f.family === 'string' && ['latin', 'zh-CN', 'ja-JP', 'ko-KR'].includes(f.locale) && f.weights.length > 0);
});

test('a project\'s own fonts: what its pages declare, and what one page can draw with and names', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Fonts') } })).json();
  mkdirSync(join(project.path, 'lib'));
  mkdirSync(join(project.path, 'fonts'));
  writeFileSync(join(project.path, 'fonts', 'Geist.ttf'), 'x');
  writeFileSync(join(project.path, 'lib', 'shared.css'), "@font-face { font-family: 'Geist'; src: url(../fonts/Geist.ttf); font-weight: 100 900 }\nbody { font-family: 'Geist', sans-serif }");
  writeFileSync(join(project.path, 'a.html'), '<link rel="stylesheet" href="lib/shared.css"><h1 style="font-family: Georgia">A</h1>');
  writeFileSync(join(project.path, 'b.html'), '<style>@font-face { font-family: Gone; src: url(fonts/gone.woff2) format("woff2") }</style>');
  const body = await (await api(`/api/projects/${project.id}/fonts?page=a.html`)).json();
  assert.deepEqual(body.fonts.map((f) => [f.family, f.variable ?? null, f.missing ?? false]), [['Geist', [100, 900], false], ['Gone', null, true]]);
  assert.deepEqual(body.fonts[0].faces[0].src, [{ path: 'fonts/Geist.ttf' }]);
  assert.deepEqual(body.page, { path: 'a.html', declared: ['Geist'], used: ['Georgia', 'Geist'] });
  assert.equal((await (await api(`/api/projects/${project.id}/fonts?page=../x.html`)).json()).page, undefined, 'out of the folder: no page');
});

test('a web page\'s poster and frames are drawn (it has no file to cut from)', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Pages') } })).json();
  writeFileSync(join(project.path, 'p.html'), `<!doctype html><body style="margin:0"><div id="b" style="width:1920px;height:1080px"></div><script>
    window.film = { duration: 2, width: 1920, height: 1080, frame(t) { document.getElementById('b').style.background = t < 1 ? '#f00' : '#00f'; } };
  </script></body>`);
  const poster = await api(`/api/projects/${project.id}/media?what=poster&path=p.html`);
  assert.equal(poster.status, 200);
  assert.equal(poster.headers.get('content-type'), 'image/jpeg');
  const bytes = Buffer.from(await poster.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xd8]);
  const frame = await api(`/api/projects/${project.id}/media?what=frame&path=p.html&ms=200&w=160`);
  assert.equal(frame.status, 200);
  assert.equal((await api(`/api/projects/${project.id}/media?what=poster&path=gone.html`)).status, 404);
});

test('files and addresses open without a shell: a name with & or | is never a command', () => {
  const link = 'http://127.0.0.1:4747/open?key=k&to=%2Fprojects%2Fx';
  for (const platform of /** @type {NodeJS.Platform[]} */ (['darwin', 'win32', 'linux'])) {
    const [cmd, ...args] = opener(link, platform);
    assert.ok(!['cmd', 'cmd.exe', 'sh', 'powershell', 'powershell.exe'].includes(cmd), `${platform}: ${cmd}`);
    assert.equal(args.at(-1), link, 'the whole address, as one argument');
  }
  assert.equal(opener('C:\\Exports\\a&calc.mp4', 'win32').at(-1), 'C:\\Exports\\a&calc.mp4');
});

test('an advertised Studio writes run.json, quits when asked by a key holder, and removes the file', async () => {
  let quit;
  const asked = new Promise((done) => { quit = done; });
  const other = await startStudio({ port: 0, advertise: true, onQuit: () => quit(), quietMs: 150 });
  const run = join(process.env.OPENFILM_HOME, 'run.json');
  try {
    const written = JSON.parse(readFileSync(run, 'utf8'));
    assert.equal(written.origin, other.origin);
    assert.equal(written.key, other.key);
    /* Windows has no file modes: the profile's own permissions keep it */
    if (process.platform !== 'win32') assert.equal((statSync(run).mode & 0o777).toString(8), '600');
    assert.equal(other.key, readFileSync(join(process.env.OPENFILM_HOME, 'key'), 'utf8'), 'the machine\'s key, the same every launch');
    const health = await (await fetch(`${other.origin}/api/health`)).json();
    /* its home only as a digest, and no process id: anyone may ask */
    assert.deepEqual(health, { product: 'openfilm-studio', version: JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version,
      home: createHash('sha256').update(process.env.OPENFILM_HOME).digest('hex'), filmOrigin: other.filmOrigin });
    assert.equal((await fetch(`${other.origin}/api/quit`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${other.origin}/api/quit`, { method: 'POST', headers: { 'x-studio-key': other.key } })).status, 200);
    await asked;
  } finally {
    await other.close();
  }
  assert.equal(existsSync(run), false);
});

test('a project an app\'s agent is working in is marked so, and is not deleted until it stops', async () => {
  let working = [];
  const app = await startStudio({ port: 0, openBrowser: () => {}, working: () => working });
  try {
    const call = (path, method = 'GET', body) => fetch(`${app.origin}${path}`, { method, headers: { 'x-studio-key': app.key, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const { project } = await (await call('/api/projects', 'POST', { path: join(scratch, 'Busy') })).json();
    working = [project.path];
    const listed = (await (await call('/api/projects')).json()).projects.find((p) => p.id === project.id);
    assert.equal(listed.working, true);
    const refused = await call(`/api/projects/${project.id}`, 'DELETE');
    assert.equal(refused.status, 409);
    assert.equal((await refused.json()).code, 'agent-running');
    assert.ok(existsSync(project.path), 'its folder untouched');
    working = [];
    assert.equal((await call(`/api/projects/${project.id}`, 'DELETE')).status, 200, 'once the agent stops');
    assert.ok(!existsSync(project.path), 'to the Trash');
  } finally {
    await app.close();
  }
});

test('an app\'s Studio (`stays`) is not stopped by `openfilm open`, and says why at once', async () => {
  const kept = await startStudio({ port: 0, stays: true, openBrowser: () => {} });
  try {
    const res = await fetch(`${kept.origin}/api/quit`, { method: 'POST', headers: { 'x-studio-key': kept.key, 'content-type': 'application/json' }, body: '{"whenIdle":true}' });
    /* 423, not 409: 409 is how the app tells that it is busy */
    assert.equal(res.status, 423);
    assert.match((await res.json()).error, /app/);
    assert.equal((await fetch(`${kept.origin}/api/health`)).status, 200, 'still there');
  } finally {
    await kept.close();
  }
});

test('`openfilm open` without a folder opens the project opened last, and makes none', async () => {
  const before = (await (await api('/api/projects')).json()).projects;
  const last = before.find((p) => !p.missing && existsSync(join(p.path, 'film.html')));
  const res = await api('/api/open', { method: 'POST', body: { fallback: 0 } });
  assert.equal(res.status, 200);
  const { project, url } = await res.json();
  assert.equal(project?.id, last?.id);
  assert.ok(url.endsWith(last ? `&to=${encodeURIComponent(`/projects/${last.id}`)}` : '&to=%2F'));
  assert.equal((await (await api('/api/projects')).json()).projects.length, before.length, 'no project was made');
});

test('a film opened in Studio is the one opened last: `openfilm open` alone comes back to it', async () => {
  const a = (await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Opened A') } })).json()).project;
  const b = (await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Opened B') } })).json()).project;
  assert.equal((await (await api('/api/projects')).json()).projects[0].id, b.id);
  /* the person opens A from the Projects window (or by its address): its page says so */
  assert.equal((await api(`/api/projects/${a.id}/opened`, { method: 'POST', headers: { origin: 'http://evil.test' }, key: null })).status, 401);
  assert.equal((await api(`/api/projects/${a.id}/opened`, { method: 'POST' })).status, 200);
  const list = (await (await api('/api/projects')).json()).projects;
  assert.equal(list[0].id, a.id);
  assert.ok(list[0].openedAt >= list[1].openedAt);
  const { project } = await (await api('/api/open', { method: 'POST', body: { fallback: 0 } })).json();
  assert.equal(project.id, a.id);
  assert.equal((await api('/api/projects/nope/opened', { method: 'POST' })).status, 404);
});

test('a project\'s film address stays the same when Studio starts again with the same key, and when it is renamed', async () => {
  const key = 'ab'.repeat(24);
  const first = await startStudio({ port: 0, key, openBrowser: () => {}, quietMs: 150 });
  let project, folder, other;
  try {
    const call = (s, path, init = {}) => fetch(`${s.origin}${path}`, { ...init, headers: { 'x-studio-key': key, 'content-type': 'application/json', ...init.headers } });
    project = (await (await call(first, '/api/projects', { method: 'POST', body: JSON.stringify({ path: join(scratch, 'Restarted') }) })).json()).project;
    writeFileSync(join(project.path, 'scene.html'), '<!doctype html><title>x</title>');
    folder = (await (await call(first, `/api/projects/${project.id}`)).json()).folder;
    other = (await (await call(first, '/api/projects', { method: 'POST', body: JSON.stringify({ path: join(scratch, 'Other') }) })).json()).project;
    const otherFolder = (await (await call(first, `/api/projects/${other.id}`)).json()).folder;
    assert.notEqual(new URL(otherFolder).pathname, new URL(folder).pathname, 'each project has a token of its own');
    await first.close();

    /* a page left open asks the restarted Studio for its film before it asks for anything else */
    const again = await startStudio({ port: 0, key, openBrowser: () => {}, quietMs: 150 });
    try {
      const path = new URL(folder).pathname;
      assert.equal((await fetch(`${again.filmOrigin}${path}scene.html`)).status, 200, 'the old address still reaches the folder');
      assert.equal((await (await call(again, `/api/projects/${project.id}`)).json()).folder, `${again.filmOrigin}${path}`);
      const renamed = (await (await call(again, `/api/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Restarted again' }) })).json()).project;
      assert.equal((await fetch(`${again.filmOrigin}${path}scene.html`)).status, 200, 'renamed, its address still reaches it');
      assert.equal((await (await call(again, `/api/projects/${project.id}`)).json()).folder, `${again.filmOrigin}${path}`);
      assert.ok(existsSync(join(renamed.path, 'scene.html')));
    } finally { await again.close(); }

    /* another key (another machine's Studio, or one not advertised) gives other addresses */
    const stranger = await startStudio({ port: 0, openBrowser: () => {}, quietMs: 150 });
    try { assert.equal((await fetch(`${stranger.filmOrigin}${new URL(folder).pathname}scene.html`)).status, 404); }
    finally { await stranger.close(); }
  } finally { await first.close(); }
});

test('a page\'s stream is a WebSocket: only with the key, and from the editor\'s own origin; closing Studio ends it', async () => {
  const ws = (headers) => new WebSocket(`${studio.origin.replace(/^http/, 'ws')}/api/events`, { headers });
  const outcome = (socket) => new Promise((done) => { socket.onopen = () => done('open'); socket.onerror = () => done('refused'); });
  assert.equal(await outcome(ws({})), 'refused', 'no key');
  /* the cookie is named for the port, so another Studio's cookie on the same host is not this one's */
  const named = `openfilm_studio_${new URL(studio.origin).port}`;
  assert.equal(await outcome(ws({ cookie: `openfilm_studio_1=${studio.key}`, origin: studio.origin })), 'refused', 'another port\'s cookie');
  assert.equal(await outcome(ws({ cookie: `${named}=${studio.key}`, origin: 'http://evil.test' })), 'refused', 'another site\'s page');
  const page = ws({ cookie: `${named}=${studio.key}`, origin: studio.origin });
  assert.equal(await outcome(page), 'open');
  page.close();

  /* a second Studio: closing it ends the streams open on it (or its process would never end) */
  const other = await startStudio({ port: 0, openBrowser: () => {}, quietMs: 150 });
  const held = new WebSocket(`${other.origin.replace(/^http/, 'ws')}/api/events`, { headers: { 'x-studio-key': other.key } });
  await new Promise((r) => { held.onopen = r; });
  const ended = new Promise((r) => { held.onclose = r; });
  await other.close();
  await ended;
});

test('a sound a browser cannot play (AIFF) reaches the preview as a WAV, made once and kept in .film/cache', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Aiff') } })).json();
  mkdirSync(join(project.path, 'assets'), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', join(project.path, 'assets', 'voice.aiff')]);
  const { folder } = await (await api(`/api/projects/${project.id}`)).json();
  const res = await fetch(`${folder}assets/voice.aiff`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/wav');
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
  assert.equal(readdirSync(join(project.path, '.film', 'cache', 'playable')).filter((f) => f.endsWith('.wav')).length, 1);
  /* asked again (a range, as a player seeks): the same copy */
  const part = await fetch(`${folder}assets/voice.aiff`, { headers: { range: 'bytes=0-3' } });
  assert.equal(part.status, 206);
  assert.equal(Buffer.from(await part.arrayBuffer()).toString(), 'RIFF');
  assert.equal((await fetch(`${folder}assets/missing.aiff`)).status, 404);
});

test('the preview\'s mixer gets a file\'s sound alone (?film-sound), never the whole video: small, made once, 204 when there is none', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Sound') } })).json();
  mkdirSync(join(project.path, 'assets'), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-shortest', '-pix_fmt', 'yuv420p', '-b:v', '4M', join(project.path, 'assets', 'talk.mp4')]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=2', '-pix_fmt', 'yuv420p', join(project.path, 'assets', 'mute.mp4')]);
  const { folder } = await (await api(`/api/projects/${project.id}`)).json();
  const res = await fetch(`${folder}assets/talk.mp4?film-sound=1&v=1`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/mp4');
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.subarray(4, 8).toString(), 'ftyp', 'an MP4 (.m4a) of the sound');
  assert.ok(bytes.length < statSync(join(project.path, 'assets', 'talk.mp4')).size / 10, `${bytes.length} bytes: the sound alone`);
  assert.equal(readdirSync(join(project.path, '.film', 'cache', 'audio')).length, 1);
  assert.equal((await fetch(`${folder}assets/talk.mp4?film-sound=1`)).status, 200);
  assert.equal(readdirSync(join(project.path, '.film', 'cache', 'audio')).length, 1, 'made once');
  assert.equal((await fetch(`${folder}assets/mute.mp4?film-sound=1`)).status, 204);
  assert.equal((await fetch(`${folder}assets/gone.mp4?film-sound=1`)).status, 404);
  assert.equal((await fetch(`${folder}.film/cache/audio/x.m4a?film-sound=1`)).status, 404, 'still nothing hidden');
});

/** A GET (or an upgrade, with `headers`) sent with the Host `host`: fetch never lets a page choose it, a rebound name does. */
function asHost(url, host, headers = {}) {
  return new Promise((done, fail) => {
    const req = request(url, { headers: { host, ...headers } });
    req.on('response', (res) => { res.resume(); done(res.statusCode); });
    req.on('upgrade', (res, socket) => { socket.destroy(); done(res.statusCode); });
    req.on('error', fail);
    req.end();
  });
}

test('only requests addressed to this machine by name are answered, on both origins (another site rebound to 127.0.0.1 gets nothing)', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Rebound') } })).json();
  writeFileSync(join(project.path, 'scene.html'), '<!doctype html><p>hi');
  const { folder } = await (await api(`/api/projects/${project.id}`)).json();
  const editorPort = new URL(studio.origin).port, filmPort = new URL(studio.filmOrigin).port;
  for (const host of [`127.0.0.1:${editorPort}`, `localhost:${editorPort}`, `[::1]:${editorPort}`]) {
    assert.equal(await asHost(`${studio.origin}/api/health`, host), 200, host);
  }
  for (const host of ['evil.test', `evil.test:${editorPort}`, `127.0.0.1:${filmPort}`, '127.0.0.1', `127.0.0.1.evil.test:${editorPort}`]) {
    assert.equal(await asHost(`${studio.origin}/api/health`, host), 403, host);
    assert.equal(await asHost(`${studio.origin}/`, host), 403, host);
  }
  assert.equal(await asHost(`${folder}scene.html`, `localhost:${filmPort}`), 200);
  assert.equal(await asHost(`${folder}scene.html`, `evil.test:${filmPort}`), 403);
  assert.equal(await asHost(`${folder}scene.html`, `127.0.0.1:${editorPort}`), 403, 'each origin its own port');
  /* the streams too, even with the key */
  const upgrade = { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'x-studio-key': studio.key };
  assert.equal(await asHost(`${studio.origin}/api/events`, `evil.test:${editorPort}`, upgrade), 403);
  assert.equal(await asHost(`${studio.origin}/api/events`, `127.0.0.1:${editorPort}`, upgrade), 101);
});

test('the film origin serves the film\'s files only: no dot file or folder (.git, .env), no Windows stream, nothing a link leads out to', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Hidden') } })).json();
  mkdirSync(join(project.path, '.git'), { recursive: true });
  writeFileSync(join(project.path, '.git', 'config'), '[remote]');
  writeFileSync(join(project.path, '.env'), 'TOKEN=x');
  mkdirSync(join(project.path, 'assets', '.private'), { recursive: true });
  writeFileSync(join(project.path, 'assets', '.private', 'a.png'), 'x');
  writeFileSync(join(project.path, 'assets', 'a.png'), 'x');
  const { folder } = await (await api(`/api/projects/${project.id}`)).json();
  assert.equal((await fetch(`${folder}assets/a.png`)).status, 200);
  for (const path of ['.git/config', '.env', '%2eenv', '.ENV', 'assets/.private/a.png', 'assets/%2Eprivate/a.png', 'assets/a.png::$DATA', 'assets/a.png%3A%3A$DATA', '.film::$INDEX_ALLOCATION/id']) {
    assert.equal((await fetch(`${folder}${path}`)).status, 404, path);
  }
  /* a link in the folder whose real name is hidden (as `ENV~1` is `.env` on Windows) is that file */
  if (process.platform !== 'win32') {
    symlinkSync(join(project.path, '.env'), join(project.path, 'settings.txt'));
    symlinkSync(join(project.path, '.git'), join(project.path, 'repo'));
    assert.equal((await fetch(`${folder}settings.txt`)).status, 404);
    assert.equal((await fetch(`${folder}repo/config`)).status, 404);
  }
});

test('a frame from a page larger than the cap closes its stream; small ones are still answered', async () => {
  const { MAX_FRAME } = await import('./websocket.mjs');
  const socket = await new Promise((done, fail) => {
    const req = request(`${studio.origin}/api/events`, { headers: {
      connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'x-studio-key': studio.key,
    } });
    req.on('upgrade', (_, s) => done(s));
    req.on('response', (res) => fail(new Error(`no upgrade: ${res.statusCode}`)));
    req.on('error', fail);
    req.end();
  });
  const got = [];
  socket.on('data', (chunk) => got.push(chunk));
  const closed = new Promise((done) => socket.once('close', done));
  const masked = (opcode, head, payload = Buffer.alloc(0)) => Buffer.concat([Buffer.from([0x80 | opcode, ...head]), Buffer.alloc(4), payload]);
  /* a ping (masked with zeros) is ponged */
  socket.write(masked(0x9, [0x80 | 2], Buffer.from('hi')));
  for (let i = 0; i < 50 && !Buffer.concat(got).includes(Buffer.from([0x8a, 2, 0x68, 0x69])); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(Buffer.concat(got).includes(Buffer.from([0x8a, 2, 0x68, 0x69])), 'pong');
  /* then a frame that says it carries more than the cap: closed (1009) without waiting for its bytes */
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(MAX_FRAME + 1));
  socket.write(masked(0x2, [0x80 | 127, ...length]));
  await closed;
  assert.ok(Buffer.concat(got).includes(Buffer.from([0x88, 2, 0x03, 0xf1])), 'a close saying the message was too big');
});
