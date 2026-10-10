import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, forgetProject, listProjects, locateProject, openProject, projectById, renameProject, ProjectError } from './projects.mjs';
import { readFilmFile } from '../../src/film-doc.mjs';

let scratch;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'of-projects-'));
  process.env.OPENFILM_HOME = join(scratch, 'home');
  process.env.OPENFILM_LIBRARY = join(scratch, 'library');
});

test('opening a new folder makes it a project: an empty film, .film/ with an id, kept out of git', async () => {
  const p = await openProject(join(scratch, 'Launch'));
  assert.equal(p.name, 'Launch');
  assert.deepEqual(readFilmFile(readFileSync(join(p.path, 'film.html'), 'utf8')).value, { stage: { w: 1920, h: 1080 }, tracks: [] });
  assert.equal(readFileSync(join(p.path, '.film', 'id'), 'utf8').trim(), p.id);
  assert.equal(readFileSync(join(p.path, '.film', '.gitignore'), 'utf8'), '*\n');
});

test('an existing film.html is never touched, and reopening keeps the id and moves it to the top', async () => {
  const folder = join(scratch, 'agent-made');
  mkdirSync(folder);
  writeFileSync(join(folder, 'film.html'), '{"stage":{"w":1080,"h":1920},"tracks":[]}');
  const first = await openProject(folder);
  await openProject(join(scratch, 'other'));
  const again = await openProject(folder);
  assert.equal(again.id, first.id);
  assert.equal(readFileSync(join(folder, 'film.html'), 'utf8'), '{"stage":{"w":1080,"h":1920},"tracks":[]}');
  assert.deepEqual((await listProjects()).map((p) => p.name), ['agent-made', 'other']);
});

test('a copied folder brings its original id and gets its own', async () => {
  const a = await openProject(join(scratch, 'original'));
  cpSync(a.path, join(scratch, 'copy'), { recursive: true });
  const b = await openProject(join(scratch, 'copy'));
  assert.notEqual(b.id, a.id);
  assert.equal((await projectById(a.id)).path, a.path);
});

test('new projects go to the library as Untitled, Untitled 2', async () => {
  const one = await createProject();
  const two = await createProject();
  assert.deepEqual([one.name, two.name], ['Untitled', 'Untitled 2']);
  assert.ok(one.path.startsWith(join(realpathSync(scratch), 'library')));
});

test('one folder is one project, however its path reaches it', { skip: process.platform === 'win32' }, async () => {
  const first = await openProject(join(scratch, 'same'));
  symlinkSync(join(scratch, 'same'), join(scratch, 'link-to-same'));
  const again = await openProject(join(scratch, 'link-to-same'));
  assert.equal(again.id, first.id);
  assert.equal(again.path, realpathSync(join(scratch, 'same')));
  assert.equal((await listProjects()).filter((p) => p.id === first.id).length, 1);
});

test('one folder by another spelling of its case is still one project', { skip: process.platform === 'linux' }, async () => {
  const first = await openProject(join(scratch, 'caseproj'));
  const upper = join(scratch, 'CASEPROJ');
  if (!existsSync(upper)) return; /* a disk that tells case apart */
  const again = await openProject(upper);
  assert.equal(again.id, first.id);
  assert.equal((await listProjects()).filter((p) => p.id === first.id).length, 1);
});

test('renaming a project renames its folder; a taken name is refused', async () => {
  const p = await openProject(join(scratch, 'draft'));
  await openProject(join(scratch, 'taken'));
  const renamed = await renameProject(p.id, 'Launch / v2');
  assert.equal(renamed.name, 'Launch v2');
  assert.ok(existsSync(join(scratch, 'Launch v2', 'film.html')) && !existsSync(join(scratch, 'draft')));
  await assert.rejects(renameProject(p.id, 'taken'), (e) => e instanceof ProjectError && e.status === 409 && /"taken" is taken/.test(e.message));
  /* spaces stay as typed (only what a file system refuses goes), as media names keep them */
  assert.equal((await renameProject(p.id, ' My  Film ✨ 日本 ')).name, 'My  Film ✨ 日本');
  assert.equal((await createProject('Two  spaces')).name, 'Two  spaces');
  /* the same name in another case is the same folder, not a taken one */
  if (existsSync(join(scratch, 'MY  FILM ✨ 日本'))) assert.equal((await renameProject(p.id, 'MY  FILM ✨ 日本')).name, 'MY  FILM ✨ 日本');
});

test('forgetting a project leaves its folder; a deleted folder shows as missing', async () => {
  const p = await openProject(join(scratch, 'keep'));
  await forgetProject(p.id);
  assert.equal((await listProjects()).length, 0);
  assert.ok(existsSync(join(p.path, 'film.html')));
  const q = await openProject(join(scratch, 'gone'));
  (await import('node:fs')).rmSync(q.path, { recursive: true });
  assert.equal((await listProjects()).find((x) => x.id === q.id).missing, true);
  /* only the folder being gone is missing: one that lost its film.html is still there (and opens) */
  const r = await openProject(join(scratch, 'no-film'));
  (await import('node:fs')).rmSync(join(r.path, 'film.html'));
  assert.equal((await listProjects()).find((x) => x.id === r.id).missing, false);
});

test('the disk root, the home folder and files are not projects', async () => {
  await assert.rejects(openProject('/'), ProjectError);
  await assert.rejects(openProject(homedir()), ProjectError);
  writeFileSync(join(scratch, 'a.txt'), '');
  await assert.rejects(openProject(join(scratch, 'a.txt')), /is a file/);
});

test('opened only when there is a film (create false): a folder without one is said, and nothing is written', async () => {
  const empty = join(scratch, 'plain');
  mkdirSync(empty);
  await assert.rejects(openProject(empty, { create: false }), (e) => e instanceof ProjectError && e.code === 'no-film');
  assert.ok(!existsSync(join(empty, '.film')) && !existsSync(join(empty, 'film.html')));
  await assert.rejects(openProject(join(scratch, 'nowhere'), { create: false }), (e) => e.code === 'not-found');
  assert.ok(!existsSync(join(scratch, 'nowhere')));
  writeFileSync(join(empty, 'film.html'), '<!doctype html>');
  assert.equal((await openProject(empty, { create: false })).name, 'plain');
});

test('a moved project is located: same id and place in the list, its history with it; a wrong folder is refused', async () => {
  const p = await openProject(join(scratch, 'before'));
  const other = await openProject(join(scratch, 'other'));
  mkdirSync(join(scratch, 'moved'));
  renameSync(p.path, join(scratch, 'moved', 'after'));
  assert.equal((await listProjects()).find((x) => x.id === p.id).missing, true);
  /* not a film; another project of the list */
  mkdirSync(join(scratch, 'not-a-film'));
  await assert.rejects(locateProject(p.id, join(scratch, 'not-a-film')), (e) => e.code === 'no-film');
  await assert.rejects(locateProject(p.id, join(scratch, 'other')), (e) => e.code === 'listed');
  await assert.rejects(locateProject(p.id, join(scratch, 'nowhere')), (e) => e.code === 'not-found');
  const found = await locateProject(p.id, join(scratch, 'moved', 'after'));
  assert.equal(found.id, p.id);
  assert.equal(found.missing, false);
  assert.equal(found.path, realpathSync(join(scratch, 'moved', 'after')));
  assert.deepEqual((await listProjects()).map((x) => x.id), [other.id, p.id], 'its place in the list stays');
  /* a folder that lost its .film/id (copied without it) gets the project's */
  const q = await openProject(join(scratch, 'q'));
  renameSync(q.path, join(scratch, 'q2'));
  (await import('node:fs')).rmSync(join(scratch, 'q2', '.film'), { recursive: true });
  await locateProject(q.id, join(scratch, 'q2'));
  assert.equal(readFileSync(join(scratch, 'q2', '.film', 'id'), 'utf8').trim(), q.id);
  assert.equal((await openProject(join(scratch, 'q2'))).id, q.id, 'opened again, it is the same project');
});
