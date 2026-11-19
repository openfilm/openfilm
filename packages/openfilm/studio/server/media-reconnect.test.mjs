import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bringIn, listFiles, readable } from './files.mjs';
import { scanProject } from './media-index.mjs';
import { createReconnector, missingMedia, onOtherDisks, reconnect } from './media-reconnect.mjs';
import { createProject } from './projects.mjs';

const KEYS = ['OPENFILM_HOME', 'OPENFILM_SHARED_HOME', 'OPENFILM_LIBRARY'];
let before;
let home;
beforeEach(() => {
  before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of-reconnect-')));
  home = join(base, 'home');
  process.env.OPENFILM_HOME = home;
  delete process.env.OPENFILM_SHARED_HOME;
  process.env.OPENFILM_LIBRARY = join(base, 'Projects');
});
afterEach(() => {
  for (const k of KEYS) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; }
});

function media(path, seed, size = 300_000) {
  const bytes = Buffer.alloc(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 7 + seed * 13 + (i >> 9)) & 255;
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, bytes);
  return path;
}
/** A place of its own, as a disk is: what is around it is looked through too, and must hold nothing of another test.
 * Where it really is: on Windows the temp folder may be named in its short form, which the native call spells out. */
const elsewhere = () => { const at = join(realpathSync.native(mkdtempSync(join(tmpdir(), 'of-reconnect-elsewhere-'))), 'disk'); mkdirSync(at); return at; };
const film = (root, ...srcs) => writeFileSync(join(root, 'film.html'), `<meta name="viewport" content="width=1920, height=1080">
<section>
${srcs.map((src, i) => `  <video id="v${i}" src="${src}#t=0,4" at="${i * 4}"></video>`).join('\n')}
</section>
`);
const missingPaths = async (root) => (await missingMedia(root)).map((m) => m.path);
const linksMissing = async (root) => Object.entries((await listFiles(root)).links).filter(([, l]) => l.missing).map(([p]) => p);

test('a linked file renamed where it is kept is connected again, unasked', async () => {
  const { path: root } = await createProject('Renamed');
  const nas = elsewhere();
  const clip = media(join(nas, 'day1', 'clip.mp4'), 1);
  await bringIn(root, 'assets', [clip], 'link');
  await scanProject(root);
  renameSync(clip, join(nas, 'day1', 'take 3 (best).mp4'));
  assert.deepEqual(await missingPaths(root), ['assets/clip.mp4']);

  const { found, missing } = await reconnect(root);
  assert.deepEqual(found, [{ path: 'assets/clip.mp4', to: join(nas, 'day1', 'take 3 (best).mp4') }]);
  assert.deepEqual(missing, []);
  assert.deepEqual(await linksMissing(root), []);
  assert.equal(readFileSync(readable(root, 'assets/clip.mp4')).length, 300_000);
});

test('the file itself, where it went, comes before a copy of it on record: never a copy in the project\'s own folder', async () => {
  const { path: root } = await createProject('Itself');
  const { path: other } = await createProject('Has a copy');
  const nas = elsewhere();
  const clip = media(join(nas, 'clip.mp4'), 1);
  media(join(root, 'assets', 'same bytes here.mp4'), 1);
  media(join(other, 'assets', 'same bytes there.mp4'), 1);
  await bringIn(root, 'assets', [clip], 'link');
  await scanProject(root);
  await scanProject(other);
  renameSync(clip, join(nas, 'clip renamed.mp4'));
  assert.deepEqual((await reconnect(root)).found, [{ path: 'assets/clip.mp4', to: join(nas, 'clip renamed.mp4') }]);

  /* gone for good: the copy another project holds stands in for it, not the one in this project */
  rmSync(join(nas, 'clip renamed.mp4'));
  assert.deepEqual((await reconnect(root)).found, [{ path: 'assets/clip.mp4', to: join(other, 'assets', 'same bytes there.mp4') }]);
});

test('a linked file moved to the folder beside its own is found one level up and one down', async () => {
  const { path: root } = await createProject('Beside');
  const nas = elsewhere();
  const a = media(join(nas, 'shoot', 'day1', 'a.mp4'), 1);
  media(join(nas, 'shoot', 'day1', 'stays.mp4'), 2);
  await bringIn(root, 'assets', [a], 'link');
  await scanProject(root);
  mkdirSync(join(nas, 'shoot', 'selects'));
  renameSync(a, join(nas, 'shoot', 'selects', 'a.mp4'));
  assert.deepEqual((await reconnect(root)).found, [{ path: 'assets/a.mp4', to: join(nas, 'shoot', 'selects', 'a.mp4') }]);
});

test('a linked file moved into a folder of its own, or whose folder was renamed, is found near where it was', async () => {
  const { path: root } = await createProject('Moved');
  const nas = elsewhere();
  const a = media(join(nas, 'shoot', 'day1', 'a.mp4'), 1);
  const b = media(join(nas, 'shoot', 'day2', 'b.mp4'), 2);
  await bringIn(root, 'assets', [a, b], 'link');
  await scanProject(root);
  mkdirSync(join(nas, 'shoot', 'day1', 'selects'));
  renameSync(a, join(nas, 'shoot', 'day1', 'selects', 'a.mp4'));
  renameSync(join(nas, 'shoot', 'day2'), join(nas, 'shoot', 'second day'));

  const { found, missing } = await reconnect(root);
  assert.deepEqual(found.sort((x, y) => x.path.localeCompare(y.path)), [
    { path: 'assets/a.mp4', to: join(nas, 'shoot', 'day1', 'selects', 'a.mp4') },
    { path: 'assets/b.mp4', to: join(nas, 'shoot', 'second day', 'b.mp4') },
  ]);
  assert.deepEqual(missing, []);
});

test('a linked folder that was renamed is connected again by the files recorded in it', async () => {
  const { path: root } = await createProject('Folder');
  const nas = elsewhere();
  media(join(nas, 'footage', 'a.mp4'), 1);
  media(join(nas, 'footage', 'b-roll', 'b.mp4'), 2);
  await bringIn(root, 'assets', [join(nas, 'footage')], 'link');
  await scanProject(root);
  renameSync(join(nas, 'footage'), join(nas, 'footage 2026'));
  const [gone] = await missingMedia(root);
  assert.deepEqual({ path: gone.path, folder: gone.folder, files: gone.files.map((f) => f.path) }, { path: 'assets/footage', folder: true, files: ['assets/footage/a.mp4', 'assets/footage/b-roll/b.mp4'] });

  const { found, missing } = await reconnect(root);
  assert.deepEqual(found, [{ path: 'assets/footage', to: join(nas, 'footage 2026') }]);
  assert.deepEqual(missing, []);
  assert.deepEqual((await listFiles(root)).files.map((f) => f.path), ['assets/footage/a.mp4', 'assets/footage/b-roll/b.mp4']);
});

test('a file renamed in the project\'s own folder: the clips that named it are pointed at it', async () => {
  const { path: root } = await createProject('Own');
  media(join(root, 'assets', 'IMG_0042.mp4'), 1);
  media(join(root, 'assets', 'other.mp4'), 2);
  film(root, 'assets/IMG_0042.mp4', 'assets/other.mp4', 'assets/IMG_0042.mp4');
  await scanProject(root);
  mkdirSync(join(root, 'assets', 'interview'));
  renameSync(join(root, 'assets', 'IMG_0042.mp4'), join(root, 'assets', 'interview', 'wide.mp4'));
  assert.deepEqual(await missingPaths(root), ['assets/IMG_0042.mp4']);

  const { found, missing } = await reconnect(root);
  assert.deepEqual(found, [{ path: 'assets/IMG_0042.mp4', to: 'assets/interview/wide.mp4' }]);
  assert.deepEqual(missing, []);
  const text = readFileSync(join(root, 'film.html'), 'utf8');
  assert.equal(text.match(/assets\/interview\/wide\.mp4#t=0,4/g)?.length, 2);
  assert.ok(!text.includes('IMG_0042'));
  assert.ok(text.includes('assets/other.mp4'));
});

test('a file that left the project is not looked for far away unasked; pointed at its folder, it is back under its name without a copy', async () => {
  const { path: root } = await createProject('Left');
  media(join(root, 'assets', 'a.mp4'), 1);
  film(root, 'assets/a.mp4');
  await scanProject(root);
  const archive = elsewhere();
  renameSync(join(root, 'assets', 'a.mp4'), join(archive, 'old name.mp4'));
  assert.deepEqual((await reconnect(root)).found, []);

  const { found, missing } = await reconnect(root, { folders: [archive] });
  assert.deepEqual(found, [{ path: 'assets/a.mp4', to: join(archive, 'old name.mp4') }]);
  assert.deepEqual(missing, []);
  assert.equal((await listFiles(root)).links['assets/a.mp4'].to, join(archive, 'old name.mp4'));
  assert.ok(readFileSync(join(root, 'film.html'), 'utf8').includes('assets/a.mp4#t=0,4'));
});

test('a file taken out of the project is not brought back unasked from another project that holds it; asked, it is', async () => {
  const { path: root } = await createProject('Taken out');
  const { path: other } = await createProject('Holds it');
  media(join(root, 'assets', 'a.mp4'), 1);
  media(join(other, 'assets', 'same bytes.mp4'), 1);
  film(root, 'assets/a.mp4');
  await scanProject(root);
  await scanProject(other);
  rmSync(join(root, 'assets', 'a.mp4'));
  assert.deepEqual((await reconnect(root)).found, []);
  assert.equal(existsSync(join(root, 'assets', 'a.mp4')), false);
  const { found } = await reconnect(root, { folders: [elsewhere()] });
  assert.deepEqual(found, [{ path: 'assets/a.mp4', to: join(other, 'assets', 'same bytes.mp4') }]);
});

test('another file by the same name is not the missing one; a name alone is enough only in a folder the person points at, for media never recorded', async () => {
  const { path: root } = await createProject('Name');
  const nas = elsewhere();
  const recorded = media(join(nas, 'recorded.mp4'), 1);
  const never = media(join(nas, 'never.mp4'), 2);
  await bringIn(root, 'assets', [recorded], 'link');
  await scanProject(root);
  await bringIn(root, 'assets', [never], 'link');
  rmSync(recorded);
  rmSync(never);
  const other = elsewhere();
  media(join(other, 'recorded.mp4'), 8);
  media(join(other, 'never.mp4'), 9);

  const { found, missing } = await reconnect(root, { folders: [other] });
  assert.deepEqual(found, [{ path: 'assets/never.mp4', to: join(other, 'never.mp4') }]);
  assert.deepEqual(missing.map((m) => m.path), ['assets/recorded.mp4']);
});

test('a linked file still where it was, in a Studio that was never told of the place, is connected by its record', async () => {
  const { path: root } = await createProject('Told');
  const nas = elsewhere();
  const clip = media(join(nas, 'clip.mp4'), 1);
  const unrecorded = media(join(nas, 'unrecorded.mp4'), 2);
  await bringIn(root, 'assets', [clip], 'link');
  await scanProject(root);
  await bringIn(root, 'assets', [unrecorded], 'link');
  /* another Studio's home: it knows no linked place */
  rmSync(join(home, 'links.json'));
  assert.deepEqual(await linksMissing(root), ['assets/clip.mp4', 'assets/unrecorded.mp4']);

  const { found, missing } = await reconnect(root);
  /* the recorded one is the file the project held; nothing says so of the other, and it stays out of reach */
  assert.deepEqual(found, [{ path: 'assets/clip.mp4', to: clip }]);
  assert.deepEqual(missing.map((m) => m.path), ['assets/unrecorded.mp4']);
  assert.deepEqual(await linksMissing(root), ['assets/unrecorded.mp4']);
});

test('what cannot be found stays missing, and says what it was', async () => {
  const { path: root } = await createProject('Lost');
  const nas = elsewhere();
  const clip = media(join(nas, 'clip.mp4'), 1);
  await bringIn(root, 'assets', [clip], 'link');
  await scanProject(root);
  rmSync(clip);
  const { found, missing } = await reconnect(root);
  assert.deepEqual(found, []);
  assert.deepEqual(missing.map((m) => ({ path: m.path, name: m.name, folder: m.folder, linked: m.linked, was: m.was })), [{ path: 'assets/clip.mp4', name: 'clip.mp4', folder: false, linked: true, was: clip }]);
  assert.equal(existsSync(join(root, 'assets', 'clip.mp4')), false);
});

test('the same path on the other disks that are there', () => {
  assert.deepEqual(onOtherDisks('/Volumes/SSD/shoot/a.mp4', { platform: 'darwin', others: () => ['SSD', 'SSD 1', 'Backup'] }), ['/Volumes/SSD 1/shoot/a.mp4', '/Volumes/Backup/shoot/a.mp4']);
  assert.deepEqual(onOtherDisks('/Users/me/a.mp4', { platform: 'darwin', others: () => ['SSD'] }), []);
  const letters = onOtherDisks('D:\\shoot\\a.mp4', { platform: 'win32' });
  assert.equal(letters.length, 23);
  assert.ok(letters.includes('E:\\shoot\\a.mp4') && !letters.includes('D:\\shoot\\a.mp4'));
  assert.deepEqual(onOtherDisks('\\\\nas\\share\\a.mp4', { platform: 'win32' }), []);
  assert.deepEqual(onOtherDisks('/media/me/USB/a.mp4', { platform: 'linux', others: (at) => (at === '/media/me' ? ['USB', 'USB1'] : []) }), ['/media/me/USB1/a.mp4']);
  assert.deepEqual(onOtherDisks('/mnt/nas/a.mp4', { platform: 'linux', others: () => ['nas', 'nas2'] }), ['/mnt/nas2/a.mp4']);
});

test('after a scan, what is missing is looked for unasked, and what stays missing is not looked for again at once', async () => {
  const { path: root } = await createProject('After');
  const nas = elsewhere();
  const a = media(join(nas, 'a.mp4'), 1);
  const b = media(join(nas, 'b.mp4'), 2);
  await bringIn(root, 'assets', [a, b], 'link');
  await scanProject(root);
  let clock = 0;
  const heard = [];
  const after = createReconnector({ onFound: (at, found) => heard.push([at === root, found.map((f) => f.path)]), again: 1000, now: () => clock });

  /* nothing missing: nothing to say */
  await after(root, await scanProject(root));
  assert.deepEqual(heard, []);

  renameSync(a, join(nas, 'a2.mp4'));
  rmSync(b);
  await after(root, await scanProject(root));
  assert.deepEqual(heard, [[true, ['assets/a.mp4']]]);

  /* b is still missing: put back, it is not looked for until a while has passed */
  media(join(nas, 'b renamed.mp4'), 2);
  clock = 500;
  await after(root, await scanProject(root));
  assert.equal(heard.length, 1);
  clock = 2000;
  await after(root, await scanProject(root));
  assert.deepEqual(heard[1], [true, ['assets/b.mp4']]);
});
