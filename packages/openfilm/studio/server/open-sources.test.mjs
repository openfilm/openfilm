import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStudio } from './server.mjs';

/* the routes of "Open folder…", "Get from GitHub…", the examples and "Locate…" (the work itself: browse, fetch-repo,
   examples and projects tests) */
let studio, scratch;
before(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'of-sources-'));
  process.env.OPENFILM_HOME = join(scratch, 'home');
  process.env.OPENFILM_LIBRARY = join(scratch, 'library');
  process.env.OPENFILM_EXAMPLES_INDEX = join(scratch, 'examples.json');
  writeFileSync(process.env.OPENFILM_EXAMPLES_INDEX, JSON.stringify({ examples: [{ folder: 'one-prompt', title: 'One Prompt', duration: '1:29' }] }));
  studio = await startStudio({ port: 0, openBrowser: () => {} });
});
after(() => { delete process.env.OPENFILM_EXAMPLES_INDEX; return studio.close(); });

const api = async (path, { method = 'GET', body } = {}) => {
  const res = await fetch(`${studio.origin}/api/${path}`, {
    method,
    headers: { 'x-studio-key': studio.key, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

test('a folder is opened only when it holds a film (create false); a folder without one is said with its code', async () => {
  const plain = join(scratch, 'plain');
  mkdirSync(plain);
  const asked = await api('projects', { method: 'POST', body: { path: plain, create: false } });
  assert.deepEqual([asked.status, asked.body.code], [409, 'no-film']);
  /* the person said yes: a film is started there */
  const started = await api('projects', { method: 'POST', body: { path: plain } });
  assert.equal(started.status, 200);
  assert.equal(started.body.project.name, 'plain');
});

test('the folder browser shows the home folder only', async () => {
  const home = await api('browse');
  assert.equal(home.status, 200);
  assert.ok(Array.isArray(home.body.folders) && home.body.places[0].id === 'home');
  if (homedir() !== '/') assert.equal((await api(`browse?path=${encodeURIComponent('/')}`)).body.code, 'outside');
});

test('a fetch: a wrong address is refused at once, with its code; an unknown job is a 404', async () => {
  const wrong = await api('projects/fetch', { method: 'POST', body: { url: 'https://example.com/o/r' } });
  assert.deepEqual([wrong.status, wrong.body.code], [400, 'host']);
  assert.equal((await api('projects/fetch', { method: 'POST', body: {} })).body.code, 'url');
  assert.equal((await api('projects/fetch/nope')).status, 404);
});

test('the examples, from the index Studio is pointed at', async () => {
  const { body } = await api('examples');
  assert.deepEqual(body.examples.map((e) => [e.id, e.duration, e.url]), [['one-prompt', 89, 'https://github.com/openfilm/examples/tree/main/one-prompt']]);
});

test('a project whose folder moved is located, though its folder is gone; it opens again', async () => {
  const { body: { project } } = await api('projects', { method: 'POST', body: { path: join(scratch, 'was-here') } });
  renameSync(project.path, join(scratch, 'is-here'));
  assert.equal((await api(`projects/${project.id}`)).status, 410);
  assert.equal((await api(`projects/${project.id}/locate`, { method: 'POST', body: { path: 'relative' } })).status, 400);
  const located = await api(`projects/${project.id}/locate`, { method: 'POST', body: { path: join(scratch, 'is-here') } });
  assert.equal(located.status, 200);
  assert.equal(located.body.project.id, project.id);
  assert.equal((await api(`projects/${project.id}`)).status, 200);
});
