import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint } from '../../src/media-fingerprint.mjs';
import { folderRecordFile, mediaFolders, scanFolder, scanProject } from './media-index.mjs';
import { aboutFile, fileIn, folderCache, inPlace, libraryPlaces, libraryRef, listFolder, moveFile, placeOf, renameFile, searchLibrary, setMediaFolder, takeByFingerprint, takeFile } from './media-library.mjs';
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

  assert.deepEqual(libraryPlaces(), { folders: [{ place: `folder:${folder}`, path: folder, name: folder.split('/').pop(), missing: false }] });
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

test('a project is no place of the library: its media is the project\'s', async () => {
  const p = await createProject('Film');
  media(join(p.path, 'assets', 'logo.png'), 2);
  writeFileSync(join(p.path, 'film.html'), '<!doctype html>');
  assert.equal(await placeOf(`project:${p.id}`), null);
  assert.deepEqual(libraryPlaces(), { folders: [] });
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

test('a file is found in the added folders by its name or its folders; a project\'s own media is not', async () => {
  const folder = elsewhere();
  media(join(folder, 'beach', 'Sunrise 01.mp4'), 1, 90_000);
  media(join(folder, 'beach', 'waves.mov'), 2, 70_000);
  media(join(folder, 'interview', 'A cam.mp4'), 3, 60_000);
  media(join(folder, 'cover.png'), 4, 50_000);
  await setMediaFolder(folder, true);
  await scanFolder(folder);
  const film = await createProject('Seaside');
  mkdirSync(join(film.path, 'assets', 'image'), { recursive: true });
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
  assert.deepEqual((await searchLibrary({ q: 'waves' })).files.map((f) => f.path), ['beach/waves.mov']);
  /* what only a project has is the project's */
  assert.deepEqual(await names({ q: 'seaside' }), []);
  assert.deepEqual(await names({ q: 'fox' }), []);
  assert.deepEqual(await names({ q: 'nothing like it' }), []);
  const [sunrise] = (await searchLibrary({ q: 'sunrise' })).files;
  assert.deepEqual({ place: sunrise.place, path: sunrise.path, where: sunrise.where, kind: sunrise.kind }, { place, path: 'beach/Sunrise 01.mp4', where: `${name} / beach`, kind: 'video' });
  assert.deepEqual(await names({ kind: 'image' }), ['cover.png']);
  assert.deepEqual(await names({ sort: 'size' }), ['Sunrise 01.mp4', 'waves.mov', 'A cam.mp4', 'cover.png']);
  assert.deepEqual(await names({ sort: 'name' }), ['A cam.mp4', 'cover.png', 'Sunrise 01.mp4', 'waves.mov']);
  const some = await searchLibrary({ limit: 2 });
  assert.deepEqual([some.files.length, some.total], [2, 4]);
  /* with Saved: the plain files kept there come first, not the clips kept there */
  const saved = await placeOf('saved');
  media(join(saved.root, 'brand', 'logo.png'), 6, 30_000);
  mkdirSync(join(saved.root, 'a clip', 'files'), { recursive: true });
  writeFileSync(join(saved.root, 'a clip', 'saved.json'), JSON.stringify({ kind: 'clip', clip: { src: 'a.png' } }));
  media(join(saved.root, 'a clip', 'files', 'a.png'), 7, 30_000);
  assert.deepEqual((await searchLibrary({ kind: 'image', saved: true })).files.map((f) => [f.place, f.path, f.where]), [['saved', 'brand/logo.png', 'Saved / brand'], [place, 'cover.png', name]]);
  assert.deepEqual(await names({ q: 'brand', saved: true }), ['logo.png']);
  assert.deepEqual(await names({ q: 'brand' }), []);
});

test('a file of an added folder is renamed where it is, keeping its kind', async () => {
  const folder = elsewhere();
  media(join(folder, 'shots', 'a.mp4'), 1);
  media(join(folder, 'shots', 'b.mp4'), 2);
  await setMediaFolder(folder, true);
  const at = await placeOf(`folder:${folder}`);
  assert.deepEqual(await renameFile(at, 'shots/a.mp4', ' Sunrise: take 1.mp4 '), { path: 'shots/Sunrise take 1.mp4' });
  assert.ok(existsSync(join(folder, 'shots', 'Sunrise take 1.mp4')));
  await assert.rejects(renameFile(at, 'shots/b.mp4', 'Sunrise take 1.mp4'), /taken/);
  await assert.rejects(renameFile(at, 'shots/b.mp4', 'b.mov'), /Keep the ending/);
  await assert.rejects(renameFile(at, 'shots/b.mp4', 'b'), /Keep the ending/);
  await assert.rejects(renameFile(at, 'shots/b.mp4', '  '), /A name/);
  await assert.rejects(renameFile(at, 'shots/nope.mp4', 'c.mp4'), /not there/);
  assert.deepEqual(await renameFile(at, 'shots/b.mp4', 'b.mp4'), { path: 'shots/b.mp4' });
});

test('a file moves between Saved and an added folder, keeping its name or taking a number, never a clip kept in Saved', async () => {
  const folder = elsewhere();
  media(join(folder, 'shots', 'a.mp4'), 1);
  media(join(folder, 'logo.png'), 2);
  await setMediaFolder(folder, true);
  const at = await placeOf(`folder:${folder}`);
  const saved = await placeOf('saved');
  assert.deepEqual(await moveFile(at, 'shots/a.mp4', saved), { place: 'saved', path: 'a.mp4' });
  assert.ok(existsSync(join(saved.root, 'a.mp4')) && !existsSync(join(folder, 'shots', 'a.mp4')));
  /* back, to the folder's top */
  assert.deepEqual(await moveFile(saved, 'a.mp4', at), { place: `folder:${folder}`, path: 'a.mp4' });
  /* a name taken there: the next number */
  media(join(saved.root, 'logo.png'), 3);
  assert.deepEqual(await moveFile(at, 'logo.png', saved), { place: 'saved', path: 'logo 2.png' });
  /* already there: stays */
  assert.deepEqual(await moveFile(at, 'a.mp4', at), { place: `folder:${folder}`, path: 'a.mp4' });
  /* a clip kept in Saved is a folder of its own, no file to move */
  mkdirSync(join(saved.root, 'a clip', 'files'), { recursive: true });
  writeFileSync(join(saved.root, 'a clip', 'saved.json'), '{}');
  await assert.rejects(moveFile(saved, 'a clip', at), /not there/);
  await assert.rejects(moveFile(at, 'nope.mp4', saved), /not there/);
});

test('a folder taken out of the library leaves nothing behind, and is itself left as it is', async () => {
  const folder = elsewhere();
  media(join(folder, 'a.mp4'), 1);
  await setMediaFolder(folder, true);
  await scanFolder(folder);
  mkdirSync(folderCache(folder), { recursive: true });
  assert.ok(existsSync(folderRecordFile(folder)));
  await setMediaFolder(folder, false);
  assert.deepEqual(mediaFolders(), []);
  assert.ok(!existsSync(folderRecordFile(folder)) && !existsSync(folderCache(folder)));
  assert.ok(existsSync(join(folder, 'a.mp4')));
});

test('a disk\'s top, the home folder and a folder that is not there are not added', async () => {
  await assert.rejects(setMediaFolder('/', true), /far more than media/);
  await assert.rejects(setMediaFolder(homedir(), true), /far more than media/);
  await assert.rejects(setMediaFolder(join(elsewhere(), 'nope'), true), /not there/);
  await assert.rejects(setMediaFolder('relative/path', true), /a folder/);
  assert.deepEqual(mediaFolders(), []);
});

test('a file used in a project comes in once; used again, it is the file already there', async () => {
  const folder = elsewhere();
  media(join(folder, 'beach', 'waves.mp4'), 1);
  await setMediaFolder(folder, true);
  await scanFolder(folder);
  const into = await createProject('Into');

  const at = await placeOf(`folder:${folder}`);
  assert.equal(await takeFile(at, 'beach/waves.mp4', into.path), 'assets/waves.mp4');
  assert.equal(await takeFile(at, 'beach/waves.mp4', into.path), 'assets/waves.mp4');
  assert.deepEqual(readdirSync(join(into.path, 'assets')).filter((n) => !n.startsWith('.')), ['waves.mp4']);
  assert.equal(await takeFile(at, 'beach/nope.mp4', into.path), null);
  /* by its fingerprint, as an agent names it: in an added folder or in Saved, and the project's own is itself */
  const fp = await fingerprint(join(folder, 'beach', 'waves.mp4'));
  const third = await createProject('Third');
  assert.equal(await takeByFingerprint(fp, third.path), 'assets/waves.mp4');
  assert.equal(await takeByFingerprint(fp, into.path), 'assets/waves.mp4');
  assert.equal(await takeByFingerprint('f1-00000000000000000000000000000000', third.path), null);
  const saved = await placeOf('saved');
  const logo = media(join(saved.root, 'logo.png'), 2);
  assert.equal(await takeByFingerprint(await fingerprint(logo), third.path), 'assets/logo.png');
});

test('Saved is a place: the files kept there, not the clips and pages kept as folders of their own', async () => {
  const at = await placeOf('saved');
  media(join(at.root, 'logo.png'), 1);
  media(join(at.root, 'stings', 'whoosh.wav'), 2);
  mkdirSync(join(at.root, 'a clip', 'files'), { recursive: true });
  writeFileSync(join(at.root, 'a clip', 'saved.json'), JSON.stringify({ kind: 'clip', clip: { src: 'a.mp4' } }));
  media(join(at.root, 'a clip', 'files', 'a.mp4'), 3);
  assert.deepEqual((await listFolder(at)).dirs.map((d) => d.name), ['stings']);
  assert.deepEqual((await listFolder(at)).files.map((f) => f.name), ['logo.png']);
  await assert.rejects(renameFile(at, 'logo.png', 'mark.png'), /in Saved/);
});

test('a thing dragged or pointed at names a file of the library by its place and path', () => {
  assert.deepEqual(libraryRef('lib:["folder:/Volumes/Footage","beach/a b.mp4"]'), { place: 'folder:/Volumes/Footage', path: 'beach/a b.mp4' });
  for (const not of ['saved/a.png', 'lib:', 'lib:{}', 'lib:["x"]', 'lib:[1,2]', 7, null]) assert.equal(libraryRef(not), null);
});
