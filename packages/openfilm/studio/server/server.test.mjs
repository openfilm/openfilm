import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
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

test('the API needs the key; /open sets it as a cookie and goes where it was asked, the key kept in the address', async () => {
  assert.equal((await api('/api/projects', { key: null })).status, 401);
  assert.equal((await api('/api/health', { key: null })).status, 200);
  assert.equal((await api(`/open?key=wrong`, { key: null })).status, 403);
  const res = await api(`/open?key=${studio.key}&to=/projects/x`, { key: null });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), `/projects/x?key=${studio.key}`);
  const [cookie, framed] = res.headers.getSetCookie();
  assert.match(cookie, /SameSite=Strict/);
  /* its twin for a page inside another site's frame (an agent's preview): kept for that frame alone */
  assert.match(framed, /SameSite=None/);
  assert.match(framed, /Partitioned/);
  assert.equal((await api('/api/projects', { key: null, headers: { cookie: cookie.split(';')[0] } })).status, 200);
  assert.equal((await api('/api/projects', { key: null, headers: { cookie: framed.split(';')[0] } })).status, 200);
  const wrongTwin = framed.split(';')[0].replace(/=.*/, '=nope');
  assert.equal((await api('/api/projects', { key: null, headers: { cookie: wrongTwin } })).status, 401);
  /* a write with the cookie from any other origin is refused (a page elsewhere cannot drive Studio) */
  const write = await api('/api/projects', { method: 'POST', key: null, body: { name: 'x' }, headers: { cookie: framed.split(';')[0], origin: 'http://evil.test' } });
  assert.equal(write.status, 403);
});

test('a page\'s address with the key signs a browser in (a copied address opens anywhere); one signed in gets the key in its address', async () => {
  const page = await api(`/projects/x?key=${studio.key}`, { key: null });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  const [cookie] = page.headers.getSetCookie();
  assert.equal((await api('/api/projects', { key: null, headers: { cookie: cookie.split(';')[0] } })).status, 200);
  /* signed in, an address without the key (typed, or from before) is sent to the one with it */
  const bare = await api('/projects/x?t=2', { key: null, headers: { cookie: cookie.split(';')[0] } });
  assert.equal(bare.status, 302);
  assert.equal(bare.headers.get('location'), `/projects/x?t=2&key=${studio.key}`);
  /* not signed in and no key: the page, which says how to get in; a wrong key signs nothing in */
  assert.equal((await api('/projects/x', { key: null })).status, 200);
  assert.deepEqual((await api('/projects/x?key=wrong', { key: null })).headers.getSetCookie(), []);
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

test('audio policy over HTTP: new cuts are managed, outside writes checked, repair is revision guarded', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { name: 'Audio policy' } })).json();
  const endpoint = `/api/projects/${project.id}`;
  const initial = { stage: { w: 320, h: 180 }, tracks: [{ clips: [
    { id: 'a', src: 'a.wav', time: [0, 1] }, { id: 'b', src: 'b.wav', at: 2, time: [0, 1] },
  ] }] };
  writeFileSync(join(project.path, 'film.html'), filmHtml(initial));
  assert.equal((await api(`${endpoint}/settings`, { method: 'PATCH', body: { audioSmoothingMs: 10 } })).status, 200);
  const edited = await (await api(`${endpoint}/edit`, { method: 'POST', body: { ops: [{ op: 'move', clip: 'b', at: 1 }] } })).json();
  assert.ok(edited.automatic);
  assert.equal(edited.audioSmoothing.pending, 0);
  initial.tracks[0].clips[1].at = 1;
  const outside = filmHtml(initial);
  writeFileSync(join(project.path, 'film.html'), outside);
  const checked = await (await api(endpoint)).json();
  assert.deepEqual(checked.audioSmoothing, { ms: 10, pending: 2 });
  assert.equal(readFileSync(join(project.path, 'film.html'), 'utf8'), outside);
  assert.equal((await api(`${endpoint}/edit`, { method: 'POST', body: { base: 'old', ops: [], repairAudio: true } })).status, 409);
  assert.equal((await api(`${endpoint}/edit`, { method: 'POST', body: { base: checked.rev, ops: [], repairAudio: true, replay: true } })).status, 400);
  const fixed = await (await api(`${endpoint}/edit`, { method: 'POST', body: { base: checked.rev, ops: [], repairAudio: true } })).json();
  assert.equal(fixed.audioSmoothing.pending, 0);
  assert.equal(fixed.effective.ops.length, 1);
});

test('rename refreshes only its open pages, including writes still waiting to settle', { timeout: 10_000 }, async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { name: 'Refresh draft' } })).json();
  const before = await (await api(`/api/projects/${project.id}`)).json();
  const { project: other } = await (await api('/api/projects', { method: 'POST', body: { name: 'Unchanged project' } })).json();
  const sockets = [project, project, other].map((project) => {
    const ws = new WebSocket(`${studio.origin.replace(/^http/, 'ws')}/api/projects/${project.id}/events`, { headers: { 'x-studio-key': studio.key } });
    const page = { ws, events: [] };
    ws.onmessage = (event) => page.events.push(JSON.parse(String(event.data)));
    return page;
  });
  const pages = sockets.slice(0, 2);
  const unaffected = sockets[2];
  try {
    await Promise.all(sockets.map(({ ws }) => new Promise((done, fail) => { ws.onopen = done; ws.onerror = fail; })));
    await new Promise((r) => setTimeout(r, 600));
    /* only the project event: on a Mac the watcher can still report the new project's own files after the wait */
    assert.deepEqual(unaffected.events.filter((e) => e.type === 'project'), [{ type: 'project', project: other }], 'every connection receives its current project');
    unaffected.events.length = 0;
    let current = before;
    for (const [name, text] of [['Refresh film', null], ['Refresh final', filmHtml({ stage: { w: 800, h: 450 }, tracks: [] })]]) {
      for (const page of pages) page.events.length = 0;
      // A write just before rename must not be lost when its old watcher's settle timer is cancelled.
      if (text) writeFileSync(join(current.project.path, 'film.html'), text);
      const previous = current.project.path;
      const renamed = (await (await api(`/api/projects/${project.id}`, { method: 'PATCH', body: { name } })).json()).project;
      const refreshed = () => pages.every(({ events }) => ['project', 'film', 'files', 'history'].every((type) => events.some((e) => e.type === type)));
      for (const end = Date.now() + 4000; !refreshed() && Date.now() < end;) await new Promise((r) => setTimeout(r, 25));
      assert.ok(refreshed(), 'both existing sockets refresh without another write or reconnect');
      current = await (await api(`/api/projects/${project.id}`)).json();
      assert.equal(current.project.path, renamed.path);
      assert.notEqual(current.project.path, previous);
      if (text) assert.deepEqual(current.doc.stage, { w: 800, h: 450 });
      else assert.equal(current.rev, before.rev, 'unchanged films still refresh the project path');
      for (const { events } of pages) {
        assert.ok(events.some((e) => e.type === 'film' && e.rev === ''), 'a forced refresh bypasses the editor’s unchanged-revision filter');
        assert.deepEqual(events.find((e) => e.type === 'project').project, renamed);
      }
      assert.deepEqual(unaffected.events, [], 'a different open project never refreshes');
      const reconnected = await collect(`/api/projects/${project.id}/events`, (events) => events.some((e) => e.type === 'project'));
      assert.deepEqual(reconnected.find((e) => e.type === 'project').project, renamed, 'a page reconnecting after rename receives the current name and path');
      assert.equal((await fetch(`${before.folder}film.html`)).status, 200, 'the existing preview address resolves to the renamed folder');
    }
  } finally {
    await Promise.all(sockets.map(({ ws }) => new Promise((done) => { ws.onclose = done; ws.close(); })));
  }
});

test('saving the same project name does not redraw its open page or replace its watcher', { timeout: 10_000 }, async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { name: 'Same name' } })).json();
  const ws = new WebSocket(`${studio.origin.replace(/^http/, 'ws')}/api/projects/${project.id}/events`, { headers: { 'x-studio-key': studio.key } });
  const events = [];
  ws.onmessage = (event) => events.push(JSON.parse(String(event.data)));
  try {
    await new Promise((done, fail) => { ws.onopen = done; ws.onerror = fail; });
    await new Promise((done) => setTimeout(done, 600));
    events.length = 0;
    for (const name of ['Same name', '  Same name  ']) {
      const response = await api(`/api/projects/${project.id}`, { method: 'PATCH', body: { name } });
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).project, project);
    }
    await new Promise((done) => setTimeout(done, 250));
    assert.deepEqual(events, [], 'unchanged names, including normalized names, send no redraw events');
    writeFileSync(join(project.path, 'after.html'), '<p>still watched</p>');
    for (const end = Date.now() + 4000; !events.some((e) => e.type === 'files') && Date.now() < end;) await new Promise((done) => setTimeout(done, 25));
    assert.ok(events.some((e) => e.type === 'files' && e.paths?.includes('after.html')), 'the original watcher still reports changes');
  } finally {
    await new Promise((done) => { ws.onclose = done; ws.close(); });
  }
});

test('rename waits for this project’s running or queued exports, but other projects can be renamed', { timeout: 15_000 }, async (t) => {
  const create = async (name) => (await (await api('/api/projects', { method: 'POST', body: { name } })).json()).project;
  const running = await create('Exporting draft');
  const waiting = await create('Queued draft');
  const other = await create('Idle draft');
  const film = join(running.path, 'film.html');
  const originalFilm = readFileSync(film, 'utf8');
  const copyFile = fsPromises.copyFile;
  const copying = Promise.withResolvers();
  const release = Promise.withResolvers();
  // Hold a real project export at its copy, so the route sees stable running and waiting jobs.
  t.mock.method(fsPromises, 'copyFile', async (...args) => {
    if (args[0] === film) { copying.resolve(); await release.promise; }
    return copyFile(...args);
  });
  syncBuiltinESMExports();
  const start = async (project) => {
    const response = await api(`/api/projects/${project.id}/exports`, { method: 'POST', body: { kind: 'project', as: 'folder', folder: join(scratch, 'rename-export-output') } });
    assert.equal(response.status, 200);
    return (await response.json()).export;
  };
  const jobs = async (project) => (await (await api(`/api/projects/${project.id}/exports`)).json()).exports;
  const rename = (project) => api(`/api/projects/${project.id}`, { method: 'PATCH', body: { name: `${project.name} renamed` } });
  let active;
  let queued;
  try {
    active = await start(running);
    await copying.promise;
    queued = await start(waiting);
    assert.equal((await jobs(running)).find((job) => job.id === active.id).status, 'running');
    assert.equal((await jobs(waiting)).find((job) => job.id === queued.id).status, 'waiting');
    for (const project of [running, waiting]) {
      const response = await rename(project);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, 'export-running');
      assert.ok(existsSync(project.path), 'the export’s captured source folder stays in place');
    }
    assert.equal((await rename(other)).status, 200, 'another project is unaffected by the export queue');
    assert.equal((await api(`/api/projects/${waiting.id}/exports/${queued.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await jobs(waiting)).find((job) => job.id === queued.id).status, 'cancelled');
    assert.equal((await rename(waiting)).status, 200, 'a cancelled queued job no longer prevents rename');
    release.resolve();
    let completed;
    for (const end = Date.now() + 4000; Date.now() < end;) {
      completed = (await jobs(running)).find((job) => job.id === active.id);
      if (completed.status !== 'running') break;
      await new Promise((done) => setTimeout(done, 25));
    }
    assert.equal(completed.status, 'done');
    assert.equal(readFileSync(join(completed.outputs[0], 'film.html'), 'utf8'), originalFilm);
    assert.equal((await rename(running)).status, 200, 'a finished export no longer prevents rename');
  } finally {
    release.resolve();
    if (queued) await api(`/api/projects/${waiting.id}/exports/${queued.id}`, { method: 'DELETE' });
    if (active) await api(`/api/projects/${running.id}/exports/${active.id}`, { method: 'DELETE' });
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('an open project keeps film, file, history and export events after rename without reconnecting', { timeout: 15_000 }, async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { name: 'Watched draft' } })).json();
  const ws = new WebSocket(`${studio.origin.replace(/^http/, 'ws')}/api/projects/${project.id}/events`, { headers: { 'x-studio-key': studio.key } });
  const events = [];
  ws.onmessage = (event) => events.push(JSON.parse(String(event.data)));
  const waitFor = async (predicate, message) => {
    for (const end = Date.now() + 4000; !events.some(predicate) && Date.now() < end;) await new Promise((r) => setTimeout(r, 25));
    assert.ok(events.some(predicate), message);
  };
  try {
    await new Promise((done, fail) => { ws.onopen = done; ws.onerror = fail; });
    const renamed = (await (await api(`/api/projects/${project.id}`, { method: 'PATCH', body: { name: 'Watched film' } })).json()).project;
    await new Promise((r) => setTimeout(r, 600));
    events.length = 0;
    writeFileSync(join(renamed.path, 'film.html'), filmHtml({ stage: { w: 640, h: 360 }, tracks: [] }));
    writeFileSync(join(renamed.path, 'scene.html'), '<p>after rename</p>');
    await waitFor((e) => e.type === 'film' && e.rev, 'the existing socket sees the new film revision');
    await waitFor((e) => e.type === 'files' && e.paths?.includes('scene.html'), 'the existing socket sees new files');
    const committed = await api(`/api/projects/${project.id}/history/commit`, { method: 'POST', body: { message: 'After rename' } });
    assert.equal(committed.status, 200);
    await waitFor((e) => e.type === 'history', 'the existing socket sees history changes');
    assert.ok(events.some((e) => e.type === 'history-progress' && e.op === 'commit'));
    const started = await api(`/api/projects/${project.id}/exports`, { method: 'POST', body: { kind: 'project', as: 'folder' } });
    assert.equal(started.status, 200);
    const job = (await started.json()).export;
    await waitFor((e) => e.type === 'export' && e.job.id === job.id && ['done', 'failed'].includes(e.job.status), 'the existing socket sees the finished export');
    const completed = events.find((e) => e.type === 'export' && e.job.id === job.id && e.job.status === 'done');
    assert.ok(completed, 'the export finishes successfully');
    assert.equal(readFileSync(join(completed.job.outputs[0], 'scene.html'), 'utf8'), '<p>after rename</p>');
  } finally {
    await new Promise((done) => { ws.onclose = done; ws.close(); });
  }
});

test('a film whose clips have no ids comes back with each named after its file, as the preview names them', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Unnamed') } })).json();
  writeFileSync(join(project.path, 'film.html'), filmHtml({ stage: { w: 1920, h: 1080 }, tracks: [{ clips: [{ src: 'title.html' }, { src: 'title.html', at: 2 }] }] }));
  const film = await (await api(`/api/projects/${project.id}`)).json();
  assert.deepEqual(film.value.tracks[0].clips.map((c) => c.id), ['title', 'title-2']);
});

test('rename renames the folder and tells the pages showing it; delete moves it to the Trash and off the list', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { name: 'Draft' } })).json();
  const events = collect(`/api/projects/${project.id}/events`, (e) => e.some((x) => x.type === 'project' && x.project.name === 'Final'));
  await new Promise((r) => setTimeout(r, 300));
  const renamed = await (await api(`/api/projects/${project.id}`, { method: 'PATCH', body: { name: 'Final' } })).json();
  assert.equal(renamed.project.name, 'Final');
  assert.equal((await events).findLast((e) => e.type === 'project').project.name, 'Final');
  assert.ok(existsSync(renamed.project.path));
  assert.equal((await api(`/api/projects/${project.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await api(`/api/projects/${project.id}`)).status, 404);
  assert.ok(!existsSync(renamed.project.path), 'the folder went to the Trash');
  assert.ok(readdirSync(process.env.OPENFILM_TRASH_DIR).some((n) => n.startsWith('Final')));
});

test('the preview plays heavy footage from its proxy once made; what the file is (film-facts), an export and proxies off read the original', { skip: !(() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })() && 'no ffmpeg' }, async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Proxied') } })).json();
  mkdirSync(join(project.path, 'assets'), { recursive: true });
  const big = join(project.path, 'assets', 'big.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=2560x1440:rate=25:duration=1', '-pix_fmt', 'yuv420p', big]);
  assert.deepEqual(await (await api('/api/prefs')).json(), { proxies: { on: true, height: 720 }, seenVersion: null, projectsFolder: null, keys: null });
  let answer;
  for (const end = Date.now() + 30_000; answer?.states?.['assets/big.mp4']?.state !== 'ready' && Date.now() < end;) {
    answer = await (await api(`/api/projects/${project.id}/proxies`, { method: 'POST', body: {} })).json();
    if (answer.states['assets/big.mp4']?.state !== 'ready') await new Promise((r) => setTimeout(r, 150));
  }
  assert.deepEqual(answer, { on: true, height: 720, states: { 'assets/big.mp4': { state: 'ready' } } });
  const { folder } = await (await api(`/api/projects/${project.id}`)).json();
  const size = async (q = '') => (await (await fetch(`${folder}assets/big.mp4${q}`)).arrayBuffer()).byteLength;
  const played = await size();
  assert.ok(played > 0 && played !== statSync(big).size, 'the proxy');
  assert.equal(await size('?film-facts=1'), statSync(big).size, 'what the file is: the file');
  /* off: the original, and no proxy asked for */
  assert.deepEqual(await (await api('/api/prefs', { method: 'PATCH', body: { proxies: { on: false } } })).json(), { proxies: { on: false, height: 720 }, seenVersion: null, projectsFolder: null, keys: null });
  assert.equal(await size(), statSync(big).size);
  assert.deepEqual((await (await api(`/api/projects/${project.id}/proxies`, { method: 'POST', body: {} })).json()).states, {});
  await api('/api/prefs', { method: 'PATCH', body: { proxies: { on: true } } });
});

test('media linked in the media pane is served to the film; a link a project brings from elsewhere is not', { skip: process.platform === 'win32' && 'links need Developer Mode on Windows' }, async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Linked') } })).json();
  const nas = mkdtempSync(join(tmpdir(), 'of-nas-'));
  writeFileSync(join(nas, 'take.wav'), 'footage');
  writeFileSync(join(nas, 'secret.wav'), 'theirs');
  mkdirSync(join(project.path, 'assets'), { recursive: true });
  symlinkSync(join(nas, 'secret.wav'), join(project.path, 'assets', 'secret.wav'));
  const res = await api(`/api/projects/${project.id}/files/bring`, { method: 'POST', body: { into: 'assets', mode: 'link', paths: [join(nas, 'take.wav')] } });
  assert.deepEqual((await res.json()).landed, ['assets/take.wav']);
  const { folder } = await (await api(`/api/projects/${project.id}`)).json();
  assert.equal(await (await fetch(`${folder}assets/take.wav`)).text(), 'footage');
  assert.equal((await fetch(`${folder}assets/secret.wav`)).status, 404);
  const listed = await (await api(`/api/projects/${project.id}/files`)).json();
  assert.deepEqual(listed.links['assets/take.wav'], { to: join(realpathSync(nas), 'take.wav') });
  assert.equal(listed.links['assets/secret.wav'].missing, true);
  /* copied in its place: the project's own file */
  await api(`/api/projects/${project.id}/files/collect`, { method: 'POST', body: { path: 'assets/take.wav' } });
  assert.deepEqual((await (await api(`/api/projects/${project.id}/files`)).json()).links['assets/take.wav'], undefined);
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
  /* no frame-ancestors: it is checked against every frame up to the window, and Studio inside an agent's preview pane
     would lose its picture */
  assert.equal(page.headers.get('content-security-policy'), null);

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

test('a project an app\'s agent is working in is marked so, and is neither renamed nor deleted until it stops', async () => {
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
    const rename = await call(`/api/projects/${project.id}`, 'PATCH', { name: 'Busy renamed' });
    assert.equal(rename.status, 409);
    assert.equal((await rename.json()).code, 'agent-running');
    assert.ok(existsSync(project.path), 'rename leaves the working folder untouched');
    assert.equal((await (await call(`/api/projects/${project.id}`)).json()).project.path, project.path);
    working = [];
    const renamed = await call(`/api/projects/${project.id}`, 'PATCH', { name: 'Busy renamed' });
    assert.equal(renamed.status, 200, 'rename succeeds once the agent stops');
    const moved = (await renamed.json()).project;
    assert.ok(existsSync(moved.path));
    assert.equal((await call(`/api/projects/${project.id}`, 'DELETE')).status, 200, 'once the agent stops');
    assert.ok(!existsSync(moved.path), 'to the Trash');
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
    /* it says it is the app's, so `openfilm update` says the app updates it */
    assert.equal((await (await fetch(`${kept.origin}/api/health`)).json()).app, true);
    const update = await fetch(`${kept.origin}/api/update`, { method: 'POST', headers: { 'x-studio-key': kept.key, 'content-type': 'application/json' }, body: '{}' });
    assert.deepEqual([update.status, (await update.json()).code], [409, 'app'], 'it does not update itself');
  } finally {
    await kept.close();
  }
});

test('Update is not run from a source checkout (git pull updates it), nor without the key', async () => {
  assert.equal((await api('/api/update', { method: 'POST', body: {}, key: null })).status, 401);
  const res = await api('/api/update', { method: 'POST', body: {} });
  assert.deepEqual([res.status, (await res.json()).code], [409, 'source']);
  assert.equal((await (await api('/api/health')).json()).app, undefined, 'not an app\'s');
  assert.equal((await (await api('/api/version')).json()).update, undefined, 'no update running');
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

test('Settings moves the library: how many projects it holds, then the folder and, when asked, its projects', async () => {
  const before = await (await api('/api/locations')).json();
  const { project } = await (await api('/api/projects', { method: 'POST', body: { name: 'To move' } })).json();
  assert.equal((await (await api('/api/locations')).json()).projects.count, before.projects.count + 1);
  const to = join(scratch, 'Moved library');
  const res = await api('/api/locations/projects', { method: 'PUT', body: { path: to, move: true } });
  const done = await res.json();
  assert.equal(res.status, 200);
  assert.equal(done.failed.length, 0);
  assert.equal(done.locations.projects.path, to);
  assert.equal(done.locations.projects.chosen, true);
  assert.ok(existsSync(join(to, 'To move', 'film.html')));
  const listed = (await (await api('/api/projects')).json()).projects.find((p) => p.id === project.id);
  assert.equal(listed.path, join(realpathSync(to), 'To move'), 'the same project, at its new folder');
  assert.equal((await api('/api/locations/projects', { method: 'PUT', body: { path: 'relative' } })).status, 400);
  const back = await (await api('/api/locations/projects', { method: 'PUT', body: { path: null, move: true } })).json();
  assert.equal(back.locations.projects.chosen, false);
  assert.ok(existsSync(join(back.locations.projects.path, 'To move', 'film.html')), 'and back to the default');
});

test('a project deleted: every page showing it is told it is gone; several deleted at once all leave the list', async () => {
  const made = [];
  for (const name of ['Gone one', 'Gone two', 'Gone three']) made.push((await (await api('/api/projects', { method: 'POST', body: { name } })).json()).project);
  const told = collect(`/api/projects/${made[0].id}/events`, (events) => events.some((e) => e.type === 'gone'));
  await new Promise((r) => setTimeout(r, 300));
  /* deleted together, as the Projects window does: none comes back */
  const answers = await Promise.all(made.map((p) => api(`/api/projects/${p.id}`, { method: 'DELETE' })));
  assert.deepEqual(answers.map((r) => r.status), [200, 200, 200]);
  assert.ok((await told).some((e) => e.type === 'gone'));
  const { projects } = await (await api('/api/projects')).json();
  assert.deepEqual(projects.filter((p) => made.some((m) => m.id === p.id)), []);
});
