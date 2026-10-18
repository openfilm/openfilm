import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStudio } from './server.mjs';
import { filmHtml } from '../../src/film-doc.mjs';
import { pictureType } from './cover.mjs';

let studio, scratch;
before(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'of-cover-'));
  process.env.OPENFILM_HOME = join(scratch, 'home');
  process.env.OPENFILM_LIBRARY = join(scratch, 'library');
  process.env.OPENFILM_TRASH_DIR = join(scratch, 'trash');
  mkdirSync(process.env.OPENFILM_TRASH_DIR);
  studio = await startStudio({ port: 0, openBrowser: () => {} });
});
after(() => studio.close());

/** a 1×1 PNG */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const api = (path, { method = 'GET', body, raw } = {}) => fetch(`${studio.origin}${path}`, {
  method,
  headers: { 'x-studio-key': studio.key, ...(body ? { 'content-type': 'application/json' } : {}), ...(raw ? { 'content-type': 'application/octet-stream' } : {}) },
  body: raw ?? (body ? JSON.stringify(body) : undefined),
});
const make = async (name) => (await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, name) } })).json()).project;
const listed = async (id) => (await (await api('/api/projects')).json()).projects.find((p) => p.id === id);
const poster = async (id) => {
  const res = await api(`/api/projects/${id}/poster`);
  return { status: res.status, type: res.headers.get('content-type'), body: Buffer.from(await res.arrayBuffer()) };
};

test('a picture from this computer becomes the card, even of an empty film; taken off, the film\'s poster again', async () => {
  const project = await make('Uploaded');
  writeFileSync(join(project.path, 'film.html'), filmHtml({ tracks: [{ clips: [] }] }));
  assert.equal((await poster(project.id)).status, 404, 'an empty film has no poster');
  assert.equal((await listed(project.id)).cover, undefined);

  const set = await (await api(`/api/projects/${project.id}/cover`, { method: 'PUT', raw: PNG })).json();
  assert.equal(typeof set.cover, 'number');
  const shown = await poster(project.id);
  assert.equal(shown.status, 200);
  assert.equal(shown.type, 'image/png');
  assert.ok(shown.body.equals(PNG), 'the picture as it was given');
  assert.equal((await listed(project.id)).cover, set.cover, 'the list says when, for the card to ask again');
  assert.deepEqual(readdirSync(join(project.path, '.film')).filter((n) => n.startsWith('cover')), ['cover.png'], 'one copy, in .film');

  assert.deepEqual(await (await api(`/api/projects/${project.id}/cover`, { method: 'DELETE' })).json(), { cover: null });
  assert.equal((await poster(project.id)).status, 404, 'the film\'s own poster again');
  assert.equal((await listed(project.id)).cover, undefined);
});

test('only a picture is a cover: anything else is refused and the cover is kept', async () => {
  const project = await make('Refused');
  await api(`/api/projects/${project.id}/cover`, { method: 'PUT', raw: PNG });
  const res = await api(`/api/projects/${project.id}/cover`, { method: 'PUT', raw: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
  assert.equal(res.status, 415);
  assert.ok((await poster(project.id)).body.equals(PNG));
  assert.equal(pictureType(Buffer.from('GIF89a......')), 'gif');
  assert.equal(pictureType(Buffer.from('not a picture')), null);
});

test('a picture of the project becomes the cover; one outside it cannot', async () => {
  const project = await make('FromAssets');
  mkdirSync(join(project.path, 'assets'), { recursive: true });
  writeFileSync(join(project.path, 'assets', 'still.png'), PNG);
  const set = await api(`/api/projects/${project.id}/cover`, { method: 'POST', body: { path: 'assets/still.png' } });
  assert.equal(set.status, 200);
  assert.ok((await poster(project.id)).body.equals(PNG));
  writeFileSync(join(scratch, 'outside.png'), PNG);
  assert.notEqual((await api(`/api/projects/${project.id}/cover`, { method: 'POST', body: { path: '../outside.png' } })).status, 200);
  assert.equal((await api(`/api/projects/${project.id}/cover`, { method: 'POST', body: { path: 'assets/gone.png' } })).status, 404);
});

test('the film at a moment becomes the cover, a JPEG, in place of a picture set before', async () => {
  const project = await make('Moment');
  writeFileSync(join(project.path, 'p.html'), `<!doctype html><body style="margin:0"><div id="b" style="width:1920px;height:1080px"></div><script>
    window.film = { duration: 2, frame(t) { document.getElementById('b').style.background = t < 1 ? '#f00' : '#00f'; } };
  </script></body>`);
  writeFileSync(join(project.path, 'film.html'), filmHtml({ tracks: [{ clips: [{ src: 'p.html' }] }] }));
  await api(`/api/projects/${project.id}/cover`, { method: 'PUT', raw: PNG });
  const set = await api(`/api/projects/${project.id}/cover`, { method: 'POST', body: { ms: 1500 } });
  assert.equal(set.status, 200);
  const shown = await poster(project.id);
  assert.equal(shown.type, 'image/jpeg');
  assert.equal(pictureType(shown.body), 'jpg');
  assert.ok(existsSync(join(project.path, '.film', 'cover.jpg')));
  assert.ok(!existsSync(join(project.path, '.film', 'cover.png')), 'the picture before is gone');
  assert.equal((await api(`/api/projects/${project.id}/cover`, { method: 'POST', body: { ms: -1 } })).status, 400);
});
