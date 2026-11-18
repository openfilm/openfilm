import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bringIn, listFiles } from './files.mjs';

let before;
beforeEach(() => {
  before = process.env.OPENFILM_HOME;
  process.env.OPENFILM_HOME = join(realpathSync(mkdtempSync(join(tmpdir(), 'of-bring-home-'))), 'home');
});
afterEach(() => { if (before === undefined) delete process.env.OPENFILM_HOME; else process.env.OPENFILM_HOME = before; });

const project = () => { const root = realpathSync(mkdtempSync(join(tmpdir(), 'of-bring-'))); mkdirSync(join(root, 'assets')); return root; };
/* where it really is: on Windows the temp folder may be named in its short form, which the native call spells out */
const outside = () => realpathSync.native(mkdtempSync(join(tmpdir(), 'of-bring-from-')));
const file = (path, size) => { writeFileSync(path, Buffer.alloc(size, 7)); return path; };
/* a disk that makes no clones, and one that also gives a file no second name (another disk) */
const noClone = async () => { throw Object.assign(new Error('no clones here'), { code: 'ENOTSUP' }); };
const otherDisk = async () => { throw Object.assign(new Error('another disk'), { code: 'EXDEV' }); };

test('unasked, media comes in as a file of the project\'s own when that takes no room: a clone', async () => {
  const root = project();
  const from = file(join(outside(), 'clip.mp4'), 5000);
  const linked = [];
  /* a clone as the disk would make it: here, a copy stands for it */
  const cloned = [];
  const clone = async (a, b) => { cloned.push(a); writeFileSync(b, readFileSync(a)); };
  assert.deepEqual(await bringIn(root, 'assets', [from], 'auto', { big: 1000, clone, onLinked: (rel) => linked.push(rel) }), ['assets/clip.mp4']);
  assert.deepEqual([cloned, linked], [[from], []]);
  assert.equal(lstatSync(join(root, 'assets', 'clip.mp4')).isFile(), true);
  /* its own file: the first one deleted, it is still there */
  rmSync(from);
  assert.equal(readFileSync(join(root, 'assets', 'clip.mp4')).length, 5000);
});

test('where the disk makes no clone, it is the same file under a second name: no room taken, and it stays when the first is deleted', async () => {
  const root = project();
  const from = file(join(outside(), 'clip.mp4'), 5000);
  const linked = [];
  const taken = statSync(from).mtimeMs;
  assert.deepEqual(await bringIn(root, 'assets', [from], 'auto', { big: 1000, clone: noClone, onLinked: (rel) => linked.push(rel) }), ['assets/clip.mp4']);
  const own = lstatSync(join(root, 'assets', 'clip.mp4'));
  assert.equal(own.isFile(), true);
  assert.deepEqual([own.ino, own.nlink, linked], [statSync(from).ino, 2, []]);
  /* the two names share one date: bringing it in did not change the original's */
  assert.equal(statSync(from).mtimeMs, taken);
  rmSync(from);
  assert.equal(readFileSync(join(root, 'assets', 'clip.mp4')).length, 5000);
});

test('from another disk, big media stays where it is and is linked; small media is copied', async () => {
  const root = project();
  const at = outside();
  const big = file(join(at, 'footage.mov'), 5000);
  const small = file(join(at, 'logo.png'), 200);
  const linked = [];
  const landed = await bringIn(root, 'assets', [big, small], 'auto', { big: 1000, clone: noClone, sameFile: otherDisk, onLinked: (rel) => linked.push(rel) });
  assert.deepEqual(landed, ['assets/footage.mov', 'assets/logo.png']);
  assert.deepEqual(linked, ['assets/footage.mov']);
  assert.equal(lstatSync(join(root, 'assets', 'footage.mov')).isSymbolicLink(), true);
  assert.equal((await listFiles(root)).links['assets/footage.mov'].to, big);
  const copy = lstatSync(join(root, 'assets', 'logo.png'));
  assert.deepEqual([copy.isFile(), copy.nlink], [true, 1]);
});

test('a folder from another disk: linked when what is in it is big, copied when it is not', async () => {
  const root = project();
  const at = outside();
  mkdirSync(join(at, 'shoot', 'day1'), { recursive: true });
  file(join(at, 'shoot', 'day1', 'a.mp4'), 700);
  file(join(at, 'shoot', 'b.mp4'), 700);
  mkdirSync(join(at, 'icons'));
  file(join(at, 'icons', 'a.png'), 100);
  const linked = [];
  const landed = await bringIn(root, 'assets', [join(at, 'shoot'), join(at, 'icons')], 'auto', { big: 1000, clone: noClone, sameFile: otherDisk, onLinked: (rel) => linked.push(rel) });
  assert.deepEqual([landed, linked], [['assets/shoot', 'assets/icons'], ['assets/shoot']]);
  assert.equal(lstatSync(join(root, 'assets', 'shoot')).isSymbolicLink(), true);
  assert.equal(lstatSync(join(root, 'assets', 'icons')).isDirectory(), true);
  assert.equal(lstatSync(join(root, 'assets', 'icons', 'a.png')).isFile(), true);
});

test('asked to copy, it is copied whatever its size; asked to link, linked', async () => {
  const root = project();
  const from = file(join(outside(), 'clip.mp4'), 5000);
  assert.deepEqual(await bringIn(root, 'assets', [from], 'copy', { big: 1000, clone: noClone, sameFile: otherDisk }), ['assets/clip.mp4']);
  assert.equal(lstatSync(join(root, 'assets', 'clip.mp4')).isFile(), true);
  assert.deepEqual(await bringIn(root, 'assets', [from], 'link', { big: 1000 }), ['assets/clip 2.mp4']);
  assert.equal(lstatSync(join(root, 'assets', 'clip 2.mp4')).isSymbolicLink(), true);
});

test('on this disk, as it is: unasked media takes no room, by a clone or a second name', async () => {
  const root = project();
  const from = file(join(outside(), 'clip.mp4'), 300_000);
  const linked = [];
  await bringIn(root, 'assets', [from], 'auto', { big: 1000, onLinked: (rel) => linked.push(rel) });
  /* the temporary folder is one disk: never a link, never the bytes written again where a clone or a name does */
  assert.deepEqual(linked, []);
  const own = lstatSync(join(root, 'assets', 'clip.mp4'));
  assert.equal(own.isFile(), true);
  /* on a Mac's own disk it is a clone (a file of its own), which Node's copy never makes there */
  if (process.platform === 'darwin' && statfsSync(root).type === 0x1a) assert.equal(own.nlink, 1);
});

test('a folder cloned on a Mac\'s own disk is the project\'s own, without its hidden files', { skip: process.platform !== 'darwin' || statfsSync(tmpdir()).type !== 0x1a }, async () => {
  const root = project();
  const at = outside();
  mkdirSync(join(at, 'shoot', 'day1'), { recursive: true });
  file(join(at, 'shoot', 'day1', 'a.mp4'), 700);
  file(join(at, 'shoot', '.DS_Store'), 10);
  file(join(at, 'shoot', 'day1', '.hidden.mp4'), 10);
  const linked = [];
  assert.deepEqual(await bringIn(root, 'assets', [join(at, 'shoot')], 'auto', { big: 100, onLinked: (rel) => linked.push(rel) }), ['assets/shoot']);
  assert.deepEqual(linked, []);
  assert.equal(lstatSync(join(root, 'assets', 'shoot')).isDirectory(), true);
  assert.equal(lstatSync(join(root, 'assets', 'shoot', 'day1', 'a.mp4')).isFile(), true);
  assert.equal(lstatSync(join(root, 'assets', 'shoot', '.DS_Store'), { throwIfNoEntry: false }), undefined);
  assert.equal(lstatSync(join(root, 'assets', 'shoot', 'day1', '.hidden.mp4'), { throwIfNoEntry: false }), undefined);
});
