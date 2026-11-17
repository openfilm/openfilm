import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* A Studio of its own, with a folder of OpenFilm's plugins made here (src/plugins.mjs reads it as it loads) holding
   one plugin that brings server code: a note kept in a project's file */
const scratch = mkdtempSync(join(tmpdir(), 'of-plugin-servers-'));
for (const [name, at] of [['OPENFILM_HOME', 'home'], ['OPENFILM_SHARED_HOME', 'home'], ['OPENFILM_LIBRARY', 'library'], ['OPENFILM_EXPORTS', 'exports'],
  ['OPENFILM_SKILLS', 'skills'], ['OPENFILM_TRASH_DIR', 'trash'], ['OPENFILM_PLUGINS', 'plugins']]) {
  process.env[name] = join(scratch, at);
  mkdirSync(process.env[name], { recursive: true });
}
const plugin = join(scratch, 'plugins', 'example-api');
mkdirSync(plugin);
writeFileSync(join(plugin, 'openfilm.json'), JSON.stringify({ title: { en: 'Example API' }, about: 'an example', on: true, skills: [] }));
writeFileSync(join(plugin, 'server.mjs'), `
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
const NOTE = 'notes/example.txt';
export default (studio) => ({
  'GET /projects/:project/note': async ({ params }) => {
    const { path } = await studio.project(params.project);
    return { text: await readFile(studio.readable(path, NOTE), 'utf8').catch(() => ''), plugin: studio.id };
  },
  'POST /projects/:project/note': async ({ req, params }) => {
    const { path } = await studio.project(params.project);
    const { text, file = NOTE } = await studio.readJson(req);
    if (typeof text !== 'string') throw new studio.HttpError(400, 'text: a string');
    const at = studio.inside(path, String(file));
    await mkdir(dirname(at), { recursive: true });
    await writeFile(at, text);
    studio.emit(path, { note: text });
    return { ok: true };
  },
  'GET /answers-itself': ({ res }) => { res.writeHead(204); res.end(); },
});
`);
/* one whose server code does not load */
mkdirSync(join(scratch, 'plugins', 'broken'));
writeFileSync(join(scratch, 'plugins', 'broken', 'openfilm.json'), JSON.stringify({ title: { en: 'Broken' }, on: true, skills: [] }));
writeFileSync(join(scratch, 'plugins', 'broken', 'server.mjs'), 'export default () => { throw new Error("not today"); };');
/* and one on, with no server code */
mkdirSync(join(scratch, 'plugins', 'plain'));
writeFileSync(join(scratch, 'plugins', 'plain', 'openfilm.json'), JSON.stringify({ title: { en: 'Plain' }, on: true, skills: [] }));

const { startStudio } = await import('./server.mjs');

/** @type {Awaited<ReturnType<typeof startStudio>>} */
let studio;
before(async () => { studio = await startStudio({ port: 0, openBrowser: () => {} }); });
after(async () => { await studio.close(); rmSync(scratch, { recursive: true, force: true }); });

const api = (/** @type {string} */ path, { method = 'GET', body, key = studio.key, headers = {} } = /** @type {{ method?: string, body?: unknown, key?: string | null, headers?: Record<string, string> }} */ ({})) => fetch(`${studio.origin}${path}`, {
  method,
  headers: { ...(key ? { 'x-studio-key': key } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
  body: body ? JSON.stringify(body) : undefined,
  redirect: 'manual',
});

/** A project's stream of events (a WebSocket), until `until(events)`. */
function collect(/** @type {string} */ path, /** @type {(events: any[]) => boolean} */ until) {
  return new Promise((done, fail) => {
    const ws = new WebSocket(`${studio.origin.replace(/^http/, 'ws')}${path}`, { headers: { 'x-studio-key': studio.key } });
    /** @type {any[]} */
    const events = [];
    ws.onmessage = (e) => { events.push(JSON.parse(String(e.data))); if (until(events)) ws.close(); };
    ws.onclose = () => done(events);
    ws.onerror = () => fail(new Error(`${path}: the stream did not open`));
  });
}

test('an own plugin\'s routes: the key needed, a project\'s file read and written, its pages told, gone while it is off', async () => {
  const { project } = await (await api('/api/projects', { method: 'POST', body: { name: 'Notes' } })).json();
  const note = `/api/plugins/example-api/projects/${encodeURIComponent(project.id)}/note`;

  /* the key, as for every route of the API: none is 401; the cookie from another origin cannot write */
  assert.equal((await api(note, { key: null })).status, 401);
  assert.equal((await api(note, { method: 'POST', key: null, body: { text: 'x' } })).status, 401);
  const signIn = (await api(`/open?key=${studio.key}`, { key: null })).headers.getSetCookie()[0].split(';')[0];
  assert.equal((await api(note, { key: null, headers: { cookie: signIn } })).status, 200);
  assert.equal((await api(note, { method: 'POST', key: null, body: { text: 'x' }, headers: { cookie: signIn, origin: 'http://elsewhere.test' } })).status, 403);

  assert.deepEqual(await (await api(note)).json(), { text: '', plugin: 'example-api' });
  const told = collect(`/api/projects/${encodeURIComponent(project.id)}/events`, (events) => events.some((e) => e.type === 'plugin'));
  await new Promise((done) => setTimeout(done, 200));
  const wrote = await api(note, { method: 'POST', body: { text: 'hello' } });
  assert.equal(wrote.status, 200);
  assert.deepEqual(await wrote.json(), { ok: true });
  assert.equal(readFileSync(join(project.path, 'notes', 'example.txt'), 'utf8'), 'hello');
  assert.deepEqual(await (await api(note)).json(), { text: 'hello', plugin: 'example-api' });
  assert.deepEqual((await told).find((e) => e.type === 'plugin'), { type: 'plugin', plugin: 'example-api', data: { note: 'hello' } });

  /* a file outside the project, or in its .film/, is refused; an HttpError is answered with its status */
  assert.equal((await api(note, { method: 'POST', body: { text: 'x', file: '../outside.txt' } })).status, 400);
  assert.equal(existsSync(join(project.path, '..', 'outside.txt')), false);
  assert.equal((await api(note, { method: 'POST', body: { text: 'x', file: '.film/x.txt' } })).status, 400);
  assert.equal((await api(note, { method: 'POST', body: { text: 1 } })).status, 400);
  /* a handler may answer itself; a route not there, a project not there, are 404 */
  assert.equal((await api('/api/plugins/example-api/answers-itself')).status, 204);
  assert.equal((await api('/api/plugins/example-api/projects/nope/note')).status, 404);
  assert.equal((await api(`/api/plugins/example-api/projects/${encodeURIComponent(project.id)}/other`)).status, 404);
  assert.equal((await api(note, { method: 'DELETE' })).status, 404);
  /* a plugin with no server code, and one there is not, have no routes */
  assert.equal((await api('/api/plugins/plain/anything')).status, 404);
  assert.equal((await api('/api/plugins/nope/anything')).status, 404);
  /* one whose server code throws as it is loaded says so, with a 500 */
  const broken = await api('/api/plugins/broken/anything');
  assert.equal(broken.status, 500);
  assert.match((await broken.json()).error, /broken plugin's server code did not load: not today/);

  /* turned off: its routes are not there, at once; on again, they answer, with no restart */
  assert.equal((await api('/api/plugins/example-api', { method: 'PUT', body: { on: false } })).status, 200);
  assert.equal((await api(note)).status, 404);
  assert.equal((await api(note, { method: 'POST', body: { text: 'off' } })).status, 404);
  assert.equal(readFileSync(join(project.path, 'notes', 'example.txt'), 'utf8'), 'hello');
  assert.equal((await api('/api/plugins/example-api', { method: 'PUT', body: { on: true } })).status, 200);
  assert.deepEqual(await (await api(note)).json(), { text: 'hello', plugin: 'example-api' });
  assert.equal((await api(note, { method: 'POST', body: { text: 'again' } })).status, 200);
  assert.equal(readFileSync(join(project.path, 'notes', 'example.txt'), 'utf8'), 'again');
  /* removed (on: null): one OpenFilm comes with is only turned off, so it is refused; anything else is not an answer */
  const removed = await api('/api/plugins/example-api', { method: 'PUT', body: { on: null } });
  assert.equal(removed.status, 409);
  assert.match((await removed.json()).error, /comes with OpenFilm/);
  assert.equal((await api('/api/plugins/example-api', { method: 'PUT', body: { on: 'yes' } })).status, 400);
});
