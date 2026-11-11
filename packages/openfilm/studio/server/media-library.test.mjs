import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setMediaFolder } from './all-media.mjs';
import { scanFolder, scanProject } from './media-index.mjs';
import { aboutFile, duplicates, fileIn, inPlace, libraryPlaces, listFolder, markFile, placeOf, readMarks, renameFile, searchLibrary } from './media-library.mjs';
import { noteMade } from './media-made.mjs';
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
  assert.deepEqual(await aboutFile(at, 'unused.mp4'), { usedIn: [], linkedBy: [], made: null });
  assert.equal(await aboutFile(at, 'nope.mp4'), null);
});

test('a file is found anywhere in the library by its name, its folders or the words it was made with', async () => {
  const folder = elsewhere();
  media(join(folder, 'beach', 'Sunrise 01.mp4'), 1, 90_000);
  media(join(folder, 'beach', 'waves.mov'), 2, 70_000);
  media(join(folder, 'interview', 'A cam.mp4'), 3, 60_000);
  media(join(folder, 'cover.png'), 4, 50_000);
  await setMediaFolder(folder, true);
  await scanFolder(folder);
  const film = await createProject('Seaside');
  mkdirSync(join(film.path, 'assets', 'image'), { recursive: true });
  /* the project has its own copy of one, and a picture a service made */
  copyFileSync(join(folder, 'beach', 'waves.mov'), join(film.path, 'assets', 'waves copy.mov'));
  media(join(film.path, 'assets', 'image', 'fox.png'), 5, 40_000);
  await noteMade(film.path, { verb: 'image', args: { out: 'fox', prompt: 'a red fox at dawn' }, paths: [], via: 'fal', by: 'fal.ai', files: ['assets/image/fox.png'] });
  await scanProject(film.path);
  const place = `folder:${folder}`;
  const name = folder.split('/').pop();
  const names = async (asked) => (await searchLibrary(asked)).files.map((f) => f.name);

  assert.deepEqual(await names({ q: 'sunrise' }), ['Sunrise 01.mp4']);
  assert.deepEqual((await names({ q: 'beach' })).sort(), ['Sunrise 01.mp4', 'waves.mov']);
  assert.deepEqual(await names({ q: 'beach  WAVES' }), ['waves.mov']);
  assert.deepEqual(await names({ q: 'dawn fox' }), ['fox.png']);
  /* a project's name finds what the project has, its own copy of a folder's file too */
  assert.deepEqual((await names({ q: 'seaside' })).sort(), ['fox.png', 'waves copy.mov']);
  /* found by a word both have, the same file is found once, where the person keeps it */
  assert.deepEqual((await searchLibrary({ q: 'waves' })).files.map((f) => f.path), ['beach/waves.mov']);
  assert.deepEqual(await names({ q: 'nothing like it' }), []);
  /* each says where it is */
  const [sunrise] = (await searchLibrary({ q: 'sunrise' })).files;
  assert.deepEqual({ place: sunrise.place, path: sunrise.path, where: sunrise.where, kind: sunrise.kind }, { place, path: 'beach/Sunrise 01.mp4', where: `${name} / beach`, kind: 'video' });
  assert.deepEqual((await searchLibrary({ q: 'fox' })).files.map((f) => [f.place, f.path, f.where]), [[`project:${film.id}`, 'image/fox.png', 'Seaside / image']]);
  /* of one kind, what a service made, in the order asked, and no more than asked */
  assert.deepEqual((await names({ kind: 'image' })).sort(), ['cover.png', 'fox.png']);
  assert.deepEqual(await names({ made: true }), ['fox.png']);
  assert.deepEqual(await names({ sort: 'size' }), ['Sunrise 01.mp4', 'waves.mov', 'A cam.mp4', 'cover.png', 'fox.png']);
  assert.deepEqual(await names({ sort: 'name' }), ['A cam.mp4', 'cover.png', 'fox.png', 'Sunrise 01.mp4', 'waves.mov']);
  const some = await searchLibrary({ limit: 2 });
  assert.deepEqual([some.files.length, some.total], [2, 5]);
});

test('what the person says of a file stays with it when it is renamed or moved, and what they do not want is hidden', async () => {
  const folder = elsewhere();
  media(join(folder, 'good.mp4'), 1);
  media(join(folder, 'bad.mp4'), 2);
  media(join(folder, 'plain.mp4'), 3);
  await setMediaFolder(folder, true);
  const at = await placeOf(`folder:${folder}`);
  /* said before the index has read the folder: known at once all the same */
  assert.deepEqual(await markFile(at, 'good.mp4', 'like'), { mark: 'like' });
  assert.deepEqual(await markFile(at, 'bad.mp4', 'no'), { mark: 'no' });
  assert.equal(await markFile(at, 'nope.mp4', 'like'), null);
  assert.deepEqual((await listFolder(at)).files.map((f) => [f.name, f.mark]), [['bad.mp4', 'no'], ['good.mp4', 'like'], ['plain.mp4', undefined]]);
  assert.equal((await aboutFile(at, 'good.mp4')).mark, 'like');

  mkdirSync(join(folder, 'picks'));
  renameSync(join(folder, 'good.mp4'), join(folder, 'picks', 'the one.mp4'));
  await scanFolder(folder);
  assert.deepEqual((await listFolder(at, 'picks')).files.map((f) => [f.name, f.mark]), [['the one.mp4', 'like']]);
  const names = async (asked) => (await searchLibrary({ sort: 'name', ...asked })).files.map((f) => f.name);
  assert.deepEqual(await names({}), ['plain.mp4', 'the one.mp4'], 'what is not wanted is not found');
  assert.deepEqual(await names({ mark: 'like' }), ['the one.mp4']);
  assert.deepEqual(await names({ mark: 'no' }), ['bad.mp4']);
  /* said no more */
  await markFile(at, 'bad.mp4', null);
  assert.deepEqual(Object.values(readMarks()), ['like']);
  assert.deepEqual(await names({}), ['bad.mp4', 'plain.mp4', 'the one.mp4']);
});

test('files no project has are found alone; files of the same bytes are grouped, with the room they take', async () => {
  const folder = elsewhere();
  media(join(folder, 'used.mp4'), 1, 100_000);
  media(join(folder, 'unused.mp4'), 2, 100_000);
  media(join(folder, 'big.mov'), 3, 300_000);
  mkdirSync(join(folder, 'backup'));
  copyFileSync(join(folder, 'big.mov'), join(folder, 'backup', 'big copy.mov'));
  copyFileSync(join(folder, 'unused.mp4'), join(folder, 'backup', 'unused.mp4'));
  copyFileSync(join(folder, 'unused.mp4'), join(folder, 'backup', 'unused again.mp4'));
  /* a second name for one file takes no more room: no copy */
  linkSync(join(folder, 'used.mp4'), join(folder, 'backup', 'used link.mp4'));
  await setMediaFolder(folder, true);
  const film = await createProject('Film');
  mkdirSync(join(film.path, 'assets'), { recursive: true });
  copyFileSync(join(folder, 'used.mp4'), join(film.path, 'assets', 'used.mp4'));
  await scanFolder(folder);
  await scanProject(film.path);

  assert.deepEqual((await searchLibrary({ unused: true, sort: 'name' })).files.map((f) => f.name), ['big.mov', 'unused.mp4']);
  const dup = await duplicates();
  assert.deepEqual([dup.groups, dup.spare], [2, 300_000 + 2 * 100_000]);
  assert.deepEqual(dup.files.map((f) => [f.path, f.copies]), [
    ['big.mov', 2], ['backup/big copy.mov', 2],
    ['unused.mp4', 3], ['backup/unused again.mp4', 3], ['backup/unused.mp4', 3],
  ]);
});

test('a file of an added folder is renamed where it is, keeping its kind; a project\'s is not touched here', async () => {
  const folder = elsewhere();
  media(join(folder, 'shots', 'a.mp4'), 1);
  media(join(folder, 'shots', 'b.mp4'), 2);
  await setMediaFolder(folder, true);
  const at = await placeOf(`folder:${folder}`);
  await markFile(at, 'shots/a.mp4', 'like');
  assert.deepEqual(await renameFile(at, 'shots/a.mp4', ' Sunrise: take 1.mp4 '), { path: 'shots/Sunrise take 1.mp4' });
  assert.ok(existsSync(join(folder, 'shots', 'Sunrise take 1.mp4')));
  assert.equal((await aboutFile(at, 'shots/Sunrise take 1.mp4')).mark, 'like');
  await assert.rejects(renameFile(at, 'shots/b.mp4', 'Sunrise take 1.mp4'), /taken/);
  await assert.rejects(renameFile(at, 'shots/b.mp4', 'b.mov'), /Keep the ending/);
  await assert.rejects(renameFile(at, 'shots/b.mp4', 'b'), /Keep the ending/);
  await assert.rejects(renameFile(at, 'shots/b.mp4', '  '), /A name/);
  await assert.rejects(renameFile(at, 'shots/nope.mp4', 'c.mp4'), /not there/);
  assert.deepEqual(await renameFile(at, 'shots/b.mp4', 'b.mp4'), { path: 'shots/b.mp4' });
  const film = await createProject('Film');
  media(join(film.path, 'assets', 'c.mp4'), 3);
  await assert.rejects(renameFile(await placeOf(`project:${film.id}`), 'c.mp4', 'd.mp4'), /in the project/);
});
