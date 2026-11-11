import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setMediaFolder } from './all-media.mjs';
import { scanProject } from './media-index.mjs';
import { aboutFile, fileIn, inPlace, libraryPlaces, listFolder, placeOf } from './media-library.mjs';
import { createProject } from './projects.mjs';

const KEYS = ['OPENFILM_HOME', 'OPENFILM_SHARED_HOME', 'OPENFILM_LIBRARY'];
let before;
beforeEach(() => {
  before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of-media-library-')));
  process.env.OPENFILM_HOME = join(base, 'home');
  delete process.env.OPENFILM_SHARED_HOME;
  process.env.OPENFILM_LIBRARY = join(base, 'Projects');
});
afterEach(() => {
  for (const k of KEYS) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; }
});

function media(path, seed, size = 80_000) {
  const bytes = Buffer.alloc(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 7 + seed * 13 + (i >> 9)) & 255;
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, bytes);
  return path;
}
const elsewhere = () => realpathSync(mkdtempSync(join(tmpdir(), 'of-media-library-folder-')));

test('a folder the person added is listed as it is: its folders with what they hold, its media by name, nothing else', async () => {
  const folder = elsewhere();
  media(join(folder, 'Shot 10.mp4'), 1);
  media(join(folder, 'Shot 2.mp4'), 2);
  media(join(folder, 'beach', 'waves.mov'), 3);
  media(join(folder, 'beach', 'aerial', 'a.mp4'), 4);
  writeFileSync(join(folder, 'beach', 'notes.txt'), 'not media');
  media(join(folder, '.hidden', 'x.mp4'), 5);
  media(join(folder, 'node_modules', 'x.mp4'), 6);
  mkdirSync(join(folder, 'empty'));
  symlinkSync(folder, join(folder, 'loop'));
  await setMediaFolder(folder, true);

  const places = await libraryPlaces();
  assert.deepEqual(places.folders.map((f) => [f.place, f.missing]), [[`folder:${folder}`, false]]);
  const at = await placeOf(`folder:${folder}`);
  assert.deepEqual(await listFolder(at), {
    dirs: [{ name: 'beach', path: 'beach', items: 2 }, { name: 'empty', path: 'empty', items: 0 }],
    files: [
      { name: 'Shot 2.mp4', path: 'Shot 2.mp4', kind: 'video', size: 80_000, mtime: (await listFolder(at)).files[0].mtime },
      { name: 'Shot 10.mp4', path: 'Shot 10.mp4', kind: 'video', size: 80_000, mtime: (await listFolder(at)).files[1].mtime },
    ],
  });
  assert.deepEqual((await listFolder(at, 'beach')).files.map((f) => f.path), ['beach/waves.mov']);
  assert.deepEqual((await listFolder(at, 'beach')).dirs, [{ name: 'aerial', path: 'beach/aerial', items: 1 }]);
  assert.equal(await listFolder(at, 'nope'), null);
});

test('nothing outside a place is listed or read, and a folder not added is no place', async () => {
  const folder = elsewhere();
  media(join(folder, 'a.mp4'), 1);
  assert.equal(await placeOf(`folder:${folder}`), null);
  await setMediaFolder(folder, true);
  const at = await placeOf(`folder:${folder}`);
  for (const path of ['..', '../x.mp4', 'a/../../x.mp4', '.hidden/x.mp4', 'a\\b.mp4', 'a\0.mp4']) {
    assert.equal(inPlace(at, path), null, path);
    assert.equal(fileIn(at, path), null, path);
  }
  assert.equal(await listFolder(at, '..'), null);
  assert.equal(fileIn(at, ''), null);
  assert.equal(fileIn(at, 'a.txt'), null);
  assert.equal(fileIn(at, 'a.mp4').abs, join(folder, 'a.mp4'));
  /* what Studio works out from it is kept outside the person's folder */
  assert.ok(!fileIn(at, 'a.mp4').cache.startsWith(folder));
  assert.equal(await placeOf('project:nope'), null);
  assert.equal(await placeOf(7), null);
});

test('a project is a place too: its assets, read as the project reads them', async () => {
  const p = await createProject('Film');
  media(join(p.path, 'assets', 'clips', 'a.mp4'), 1);
  media(join(p.path, 'assets', 'logo.png'), 2);
  writeFileSync(join(p.path, 'film.html'), '<!doctype html>');
  const at = await placeOf(`project:${p.id}`);
  assert.equal(at.name, 'Film');
  assert.deepEqual((await listFolder(at)).dirs, [{ name: 'clips', path: 'clips', items: 1 }]);
  assert.deepEqual((await listFolder(at)).files.map((f) => f.path), ['logo.png']);
  assert.deepEqual(fileIn(at, 'clips/a.mp4'), { abs: join(p.path, 'assets', 'clips', 'a.mp4'), root: p.path, rel: 'assets/clips/a.mp4', cache: p.path });
  /* a link in it to somewhere the person did not link is not followed */
  const outside = elsewhere();
  media(join(outside, 'secret.mp4'), 3);
  symlinkSync(outside, join(p.path, 'assets', 'stray'));
  assert.deepEqual((await listFolder(at)).dirs.map((d) => d.name), ['clips']);
  assert.equal(fileIn(at, 'stray/secret.mp4'), null);
});

test('a file says which projects use it, under whatever name they have it', async () => {
  const folder = elsewhere();
  media(join(folder, 'sunrise.mp4'), 1);
  media(join(folder, 'unused.mp4'), 2);
  await setMediaFolder(folder, true);
  const one = await createProject('One');
  const two = await createProject('Two');
  mkdirSync(join(one.path, 'assets'), { recursive: true });
  mkdirSync(join(two.path, 'assets'), { recursive: true });
  copyFileSync(join(folder, 'sunrise.mp4'), join(one.path, 'assets', 'opening shot.mp4'));
  copyFileSync(join(folder, 'sunrise.mp4'), join(two.path, 'assets', 'sunrise.mp4'));
  await scanProject(one.path);
  await scanProject(two.path);
  const at = await placeOf(`folder:${folder}`);
  assert.deepEqual((await aboutFile(at, 'sunrise.mp4')).usedIn.map((p) => p.name).sort(), ['One', 'Two']);
  assert.deepEqual(await aboutFile(at, 'unused.mp4'), { usedIn: [], made: null });
  assert.equal(await aboutFile(at, 'nope.mp4'), null);
});
