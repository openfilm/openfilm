import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint } from '../../src/media-fingerprint.mjs';
import { bringIn } from './files.mjs';
import { scanProject } from './media-index.mjs';
import { placeOf, savedFiles, searchLibrary, takeByFingerprint } from './media-library.mjs';
import { noteMade } from './media-made.mjs';
import { createProject } from './projects.mjs';

const KEYS = ['OPENFILM_HOME', 'OPENFILM_SHARED_HOME', 'OPENFILM_LIBRARY', 'OPENFILM_SAVED'];
let before;
let lib;
beforeEach(() => {
  before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of-media-library-')));
  process.env.OPENFILM_HOME = join(base, 'home');
  process.env.OPENFILM_SHARED_HOME = join(base, 'shared');
  process.env.OPENFILM_LIBRARY = join(base, 'Projects');
  process.env.OPENFILM_SAVED = lib = join(base, 'Saved');
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
const elsewhere = () => realpathSync(mkdtempSync(join(tmpdir(), 'of-media-library-away-')));
/** A clip kept in Saved: a folder of its own, no file to look through or move. */
function keptClip(dir) {
  mkdirSync(join(dir, 'files'), { recursive: true });
  writeFileSync(join(dir, 'saved.json'), JSON.stringify({ kind: 'clip', clip: { src: 'a.png' } }));
  media(join(dir, 'files', 'a.png'), 9, 30_000);
}

test('the one place is Saved itself; nothing else is read', async () => {
  assert.equal((await placeOf('saved')).root, lib);
  for (const not of ['saved:Brand', 'folder:/tmp', 'project:x', 7, null]) assert.equal(await placeOf(not), null, String(not));
});

test('Mine is found by name and folder, through what is linked into it, the words a file was made with too', async () => {
  media(join(lib, 'logo.png'), 1, 30_000);
  media(join(lib, 'Brand', 'intro.mp4'), 2, 90_000);
  keptClip(join(lib, 'A clip'));
  const away = elsewhere();
  media(join(away, 'Shoot', 'beach', 'waves.mov'), 3, 70_000);
  await bringIn(lib, 'Brand', [join(away, 'Shoot')], 'link', { anywhere: true });
  /* a picture a service made, kept in Mine as well */
  const film = await createProject('Film');
  const fox = media(join(film.path, 'assets', 'fox.png'), 4, 40_000);
  await noteMade(film.path, { verb: 'image', args: { out: 'fox', prompt: 'a red fox at dawn' }, paths: [], via: 'fal', by: 'fal.ai', files: ['assets/fox.png'] });
  copyFileSync(fox, join(lib, 'fox.png'));

  assert.deepEqual((await savedFiles()).map((f) => f.path).sort(), ['Brand/Shoot/beach/waves.mov', 'Brand/intro.mp4', 'fox.png', 'logo.png']);
  const names = async (asked) => (await searchLibrary(asked)).files.map((f) => f.name);
  assert.deepEqual(await names({ q: 'beach' }), ['waves.mov']);
  assert.deepEqual(await names({ q: 'brand shoot' }), ['waves.mov']);
  assert.deepEqual(await names({ q: 'dawn' }), ['fox.png']);
  assert.deepEqual(await names({ q: 'nothing like it' }), []);
  assert.deepEqual((await names({ kind: 'image', sort: 'name' })), ['fox.png', 'logo.png']);
  assert.deepEqual(await names({ sort: 'size' }), ['intro.mp4', 'waves.mov', 'fox.png', 'logo.png']);
  const [waves] = (await searchLibrary({ q: 'waves' })).files;
  assert.deepEqual({ place: waves.place, path: waves.path, where: waves.where }, { place: 'saved', path: 'Brand/Shoot/beach/waves.mov', where: 'Saved / Brand / Shoot / beach' });
  const some = await searchLibrary({ limit: 2 });
  assert.deepEqual([some.files.length, some.total], [2, 4]);
});

test('a file of Mine used in a project comes in once, by its fingerprint; the project\'s own is itself', async () => {
  const away = elsewhere();
  media(join(away, 'Shoot', 'waves.mp4'), 1);
  await bringIn(lib, '', [join(away, 'Shoot')], 'link', { anywhere: true });
  const logo = media(join(lib, 'logo.png'), 2, 30_000);
  const into = await createProject('Into');
  const fp = await fingerprint(join(away, 'Shoot', 'waves.mp4'));
  assert.equal(await takeByFingerprint(fp, into.path), 'assets/waves.mp4');
  assert.equal(await takeByFingerprint(fp, into.path), 'assets/waves.mp4');
  assert.deepEqual(readdirSync(join(into.path, 'assets')).filter((n) => !n.startsWith('.')), ['waves.mp4']);
  assert.equal(await takeByFingerprint(await fingerprint(logo), into.path), 'assets/logo.png');
  assert.equal(await takeByFingerprint('f1-00000000000000000000000000000000', into.path), null);
  await scanProject(into.path);
});
