import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { allMedia, fileOf, folderCache, isAllPath, setMediaFolder, takeMedia, whereAll } from './all-media.mjs';
import { folderRecordFile, mediaFolders, scanFolder, scanProject } from './media-index.mjs';
import { createProject } from './projects.mjs';

const KEYS = ['OPENFILM_HOME', 'OPENFILM_SHARED_HOME', 'OPENFILM_LIBRARY'];
let before;
beforeEach(() => {
  before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of-all-media-')));
  process.env.OPENFILM_HOME = join(base, 'home');
  delete process.env.OPENFILM_SHARED_HOME;
  process.env.OPENFILM_LIBRARY = join(base, 'Projects');
});
afterEach(() => {
  for (const k of KEYS) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; }
});

/** A media file of its own bytes (`seed`), made `age` seconds ago. */
function media(path, seed, age = 0, size = 200_000) {
  const bytes = Buffer.alloc(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 7 + seed * 13 + (i >> 9)) & 255;
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, bytes);
  const at = new Date(Date.now() - age * 1000);
  utimesSync(path, at, at);
  return path;
}
const elsewhere = () => realpathSync(mkdtempSync(join(tmpdir(), 'of-all-media-folder-')));

test('every project\'s media and every added folder\'s, one line a file, the newest first, each with where it is from', async () => {
  const one = await createProject('One');
  const two = await createProject('Two');
  media(join(one.path, 'assets', 'old.mp4'), 1, 300);
  media(join(one.path, 'assets', 'shared.png'), 2, 200);
  media(join(two.path, 'assets', 'new.wav'), 3, 10);
  copyFileSync(join(one.path, 'assets', 'shared.png'), join(two.path, 'assets', 'same bytes.png'));
  const folder = elsewhere();
  media(join(folder, 'trip', 'beach.mov'), 4, 100);
  await setMediaFolder(folder, true);
  await scanProject(one.path);
  await scanProject(two.path);
  await scanFolder(folder);

  const { files, folders } = await allMedia();
  assert.deepEqual(files.map((f) => f.name), ['new.wav', 'beach.mov', 'shared.png', 'old.mp4']);
  assert.ok(files.every((f) => isAllPath(f.path)));
  const shared = files.find((f) => f.name === 'shared.png');
  assert.deepEqual({ from: shared.from, uses: shared.uses, kind: shared.kind }, { from: 'One', uses: 2, kind: 'image' });
  assert.equal(files.find((f) => f.name === 'beach.mov').from, folder.split('/').pop());
  assert.equal(files.find((f) => f.name === 'beach.mov').uses, 0);
  assert.deepEqual(folders.map((f) => f.path), [folder]);
});

test('a file is found by its path here after it moved within its project', async () => {
  const one = await createProject('Moves');
  media(join(one.path, 'assets', 'a.mp4'), 1);
  await scanProject(one.path);
  const [{ path }] = (await allMedia()).files;
  assert.equal(fileOf(await whereAll(path)), join(one.path, 'assets', 'a.mp4'));
  mkdirSync(join(one.path, 'assets', 'shots'));
  copyFileSync(join(one.path, 'assets', 'a.mp4'), join(one.path, 'assets', 'shots', 'a.mp4'));
  rmSync(join(one.path, 'assets', 'a.mp4'));
  await scanProject(one.path);
  assert.equal(fileOf(await whereAll(path)), join(one.path, 'assets', 'shots', 'a.mp4'));
  assert.equal(await whereAll('all/../../etc/passwd'), null);
  assert.equal(await whereAll('assets/a.mp4'), null);
});

test('a file used in a project comes in once: used again, it is the file already there', async () => {
  const from = await createProject('From');
  const into = await createProject('Into');
  media(join(from.path, 'assets', 'shot.mp4'), 1);
  await scanProject(from.path);
  const [{ path }] = (await allMedia()).files;
  const first = await takeMedia(into.path, path);
  assert.equal(first, 'assets/shot.mp4');
  assert.ok(existsSync(join(into.path, 'assets', 'shot.mp4')));
  assert.equal(await takeMedia(into.path, path), first);
  assert.deepEqual(readdirSync(join(into.path, 'assets')).filter((n) => !n.startsWith('.')), ['shot.mp4']);
  /* a file of the project itself is that file */
  assert.equal(await takeMedia(from.path, path), 'assets/shot.mp4');
  assert.equal(await takeMedia(into.path, 'all/0123456789abcdef.mp4'), null);
});

test('a file of an added folder has what Studio works out from it kept by Studio, and a folder taken away leaves nothing behind', async () => {
  const folder = elsewhere();
  media(join(folder, 'a.mp4'), 1);
  await setMediaFolder(folder, true);
  await scanFolder(folder);
  const [{ path }] = (await allMedia()).files;
  const at = await whereAll(path);
  assert.equal(at.project, false);
  assert.equal(at.cache, folderCache(folder));
  assert.ok(!at.cache.startsWith(folder));
  mkdirSync(at.cache, { recursive: true });
  await setMediaFolder(folder, false);
  assert.deepEqual(mediaFolders(), []);
  assert.ok(!existsSync(folderRecordFile(folder)));
  assert.ok(!existsSync(at.cache));
  assert.ok(existsSync(join(folder, 'a.mp4')));
  assert.deepEqual((await allMedia()).files, []);
});

test('a disk\'s top, the home folder and a folder that is not there are not added', async () => {
  await assert.rejects(setMediaFolder('/', true), /far more than media/);
  await assert.rejects(setMediaFolder(homedir(), true), /far more than media/);
  await assert.rejects(setMediaFolder(join(elsewhere(), 'nope'), true), /not there/);
  await assert.rejects(setMediaFolder('relative/path', true), /a folder/);
  assert.deepEqual(mediaFolders(), []);
});
