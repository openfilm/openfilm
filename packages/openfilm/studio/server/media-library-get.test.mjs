import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fingerprint } from '../../src/media-fingerprint.mjs';
import { scanProject } from './media-index.mjs';
import { placeOf } from './media-library.mjs';
import { bringIn } from './files.mjs';
import { myMediaGet, myMediaVerb } from './media-library-get.mjs';
import { noteMade } from './media-made.mjs';
import { createProject } from './projects.mjs';

const KEYS = ['OPENFILM_HOME', 'OPENFILM_SHARED_HOME', 'OPENFILM_LIBRARY'];
let before;
beforeEach(() => {
  before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of-my-media-')));
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

test('an agent finds the person\'s own media by words, sees what each is, and brings one into the film', async () => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'of-my-media-folder-')));
  media(join(folder, 'beach', 'Sunrise 01.mp4'), 1);
  media(join(folder, 'beach', 'waves.mov'), 2);
  /* a folder of this computer linked into Saved, where it is kept */
  const lib = (await placeOf('saved')).root;
  await bringIn(lib, '', [folder], 'link', { anywhere: true });
  /* a project's own media is the project's: not found */
  const other = await createProject('Seaside');
  media(join(other.path, 'assets', 'image', 'fox.png'), 3);
  await noteMade(other.path, { verb: 'image', args: { out: 'fox', prompt: 'a red fox at dawn' }, paths: [], via: 'fal', by: 'fal.ai', files: ['assets/image/fox.png'] });
  await scanProject(other.path);
  /* what the person kept in Saved to use in every film */
  media(join((await placeOf('saved')).root, 'brand', 'logo.png'), 4);
  const film = await createProject('New film');

  const all = await myMediaGet({}, film.path);
  assert.equal(all.code, 0);
  assert.match(all.lines[0], /^3 in the person's media library, what is kept in Saved first, then the newest:/);
  assert.match(all.lines.join('\n'), /1\. logo\.png[^]*in Saved \/ brand, kept by the person to use in every film/);
  const sunrise = await myMediaGet({ prompt: 'sunrise' }, film.path);
  const id = (await fingerprint(join(folder, 'beach', 'Sunrise 01.mp4'))).slice(3);
  assert.deepEqual(sunrise.lines.slice(2, 6), [
    ` 1. Sunrise 01.mp4   video · 80 KB · ${new Date().toISOString().slice(0, 10)}`,
    `    id ${id}`, `    in Saved / ${basename(folder)} / beach, kept by the person to use in every film`, '    not used in any project yet',
  ]);
  assert.match((await myMediaGet({ prompt: 'dawn' }, film.path)).lines[0], /^Nothing in the person's media library for “dawn”/);
  assert.match((await myMediaGet({ kind: 'video', n: '1' }, film.path)).lines[0], /^1 of 2 in the person's media library \(video\)/);
  assert.match((await myMediaGet({ prompt: 'elephant' }, film.path)).lines[0], /^Nothing in the person's media library for “elephant”/);

  const taken = await myMediaGet({ take: id }, film.path);
  assert.deepEqual(taken, { code: 0, lines: ['In the project as assets/Sunrise 01.mp4. Use it as a clip\'s src in film.html.'] });
  assert.ok(existsSync(join(film.path, 'assets', 'Sunrise 01.mp4')));
  assert.match((await myMediaGet({ prompt: 'sunrise' }, film.path)).lines.join('\n'), /used in: New film/);
  assert.equal((await myMediaGet({ take: '0'.repeat(32) }, film.path)).code, 1);
});

test('a wrong option says what it takes; taking needs the film\'s folder', async () => {
  assert.match((await myMediaGet({ colour: 'red' }, null)).lines[0], /there is no --colour; it takes --prompt, --kind, --limit, --take/);
  assert.equal((await myMediaGet({ kind: 'page' }, null)).code, 2);
  assert.equal((await myMediaGet({ limit: '900' }, null)).code, 2);
  assert.equal((await myMediaGet({ liked: true }, null)).code, 2);
  assert.match((await myMediaGet({ take: 'abc' }, null)).lines[0], /run it in the film's folder/);
  assert.equal(myMediaVerb().verb, 'my-media');
});
