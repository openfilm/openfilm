import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStudio } from './server.mjs';

let studio, scratch;
before(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'of-folders-'));
  process.env.OPENFILM_HOME = join(scratch, 'home');
  process.env.OPENFILM_LIBRARY = join(scratch, 'library');
  process.env.OPENFILM_TRASH_DIR = join(scratch, 'trash');
  mkdirSync(process.env.OPENFILM_TRASH_DIR);
  studio = await startStudio({ port: 0, openBrowser: () => {} });
});
after(() => studio.close());

const api = async (path, { method = 'GET', body } = {}) => {
  const res = await fetch(`${studio.origin}/api/${path}`, {
    method,
    headers: { 'x-studio-key': studio.key, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};
const saved = () => JSON.parse(readFileSync(join(process.env.OPENFILM_HOME, 'studio.json'), 'utf8'));

test('folders of the Projects list: make, rename, move projects in and out, kept in studio.json', async () => {
  const { body: { folder } } = await api('projects/folders', { method: 'POST', body: { name: '  Untitled   folder ' } });
  assert.equal(folder.name, 'Untitled folder');
  assert.ok(folder.id && folder.createdAt > 0);
  assert.equal((await api('projects/folders', { method: 'POST', body: { name: '  ' } })).status, 400);

  const renamed = await api(`projects/folders/${folder.id}`, { method: 'PATCH', body: { name: 'Ads' } });
  assert.equal(renamed.body.folder.name, 'Ads');
  assert.equal((await api('projects/folders/nope', { method: 'PATCH', body: { name: 'x' } })).status, 404);
  assert.deepEqual((await api('projects/folders')).body.folders.map((f) => f.name), ['Ads']);

  const { body: { project } } = await api('projects', { method: 'POST', body: { name: 'Spot' } });
  assert.ok(project.createdAt > 0, 'when its folder was made');
  const moved = await api(`projects/${project.id}/folder`, { method: 'PUT', body: { folderId: folder.id } });
  assert.equal(moved.body.project.folderId, folder.id);
  assert.equal((await api(`projects/${project.id}/folder`, { method: 'PUT', body: { folderId: 'nope' } })).status, 404);

  /* reopening a project keeps it in its folder */
  await api('projects', { method: 'POST', body: { path: project.path } });
  const listed = (await api('projects')).body.projects.find((p) => p.id === project.id);
  assert.equal(listed.folderId, folder.id);
  assert.deepEqual(saved().folders.map((f) => f.name), ['Ads']);
  assert.equal(saved().recent.find((r) => r.id === project.id).folderId, folder.id);

  await api(`projects/${project.id}/folder`, { method: 'PUT', body: { folderId: null } });
  assert.equal((await api('projects')).body.projects.find((p) => p.id === project.id).folderId, undefined);
});

test('deleting a folder answers the projects that were in it; deleting those moves them to the Trash', async () => {
  const { body: { folder } } = await api('projects/folders', { method: 'POST', body: { name: 'Old' } });
  const { body: { project: a } } = await api('projects', { method: 'POST', body: { name: 'A' } });
  const { body: { project: b } } = await api('projects', { method: 'POST', body: { name: 'B' } });
  for (const p of [a, b]) await api(`projects/${p.id}/folder`, { method: 'PUT', body: { folderId: folder.id } });

  const gone = await api(`projects/folders/${folder.id}`, { method: 'DELETE' });
  assert.deepEqual(gone.body.projects.sort(), [a.id, b.id].sort());
  assert.ok(!(await api('projects/folders')).body.folders.some((f) => f.id === folder.id));
  assert.equal((await api(`projects/folders/${folder.id}`, { method: 'DELETE' })).status, 404);
  for (const id of gone.body.projects) assert.equal((await api(`projects/${id}`, { method: 'DELETE' })).status, 200);
  const left = (await api('projects')).body.projects.map((p) => p.id);
  assert.ok(!left.includes(a.id) && !left.includes(b.id));
});

test('the film\'s length is listed once Studio has learnt it, and only while film.html is unchanged', async () => {
  const { body: { project } } = await api('projects', { method: 'POST', body: { name: 'Long' } });
  const film = join(project.path, 'film.html');
  const stat = statSync(film);
  mkdirSync(join(project.path, '.film', 'cache'), { recursive: true });
  writeFileSync(join(project.path, '.film', 'cache', 'film-duration.json'), JSON.stringify({ film: `${stat.mtimeMs}:${stat.size}`, duration: 12.5 }));
  assert.equal((await api('projects')).body.projects.find((p) => p.id === project.id).duration, 12.5);
  writeFileSync(film, JSON.stringify({ stage: { w: 640, h: 360 }, tracks: [{ clips: [] }] }));
  assert.equal((await api('projects')).body.projects.find((p) => p.id === project.id).duration, undefined);
});
