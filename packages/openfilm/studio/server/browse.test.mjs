import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowseError, browseFolder, browsePlaces, within } from './browse.mjs';

let root, outside;
before(() => {
  const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'of-browse-')));
  root = join(scratch, 'home');
  outside = join(scratch, 'elsewhere');
  mkdirSync(join(root, 'Films', 'Launch'), { recursive: true });
  mkdirSync(join(root, 'Films', 'notes'), { recursive: true });
  mkdirSync(join(root, '.hidden'), { recursive: true });
  mkdirSync(join(root, 'Desktop'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(root, 'Films', 'Launch', 'film.html'), '<!doctype html>');
  writeFileSync(join(root, 'a file.txt'), 'x');
  writeFileSync(join(outside, 'film.html'), '<!doctype html>');
  symlinkSync(outside, join(root, 'out-link'), 'dir');
  symlinkSync(join(root, 'Films'), join(root, 'films-link'), 'dir');
});

const refused = async (path, code) => assert.rejects(browseFolder(path, { root }), (e) => e instanceof BrowseError && e.code === code, path);

test('a folder\'s folders, sorted, hidden ones and files left out, film folders marked', async () => {
  const top = await browseFolder(null, { root });
  assert.equal(top.path, root);
  assert.equal(top.parent, null);
  assert.deepEqual(top.folders.map((f) => f.name), ['Desktop', 'Films', 'films-link']);
  const films = await browseFolder(join(root, 'Films'), { root });
  assert.equal(films.parent, root);
  assert.deepEqual(films.folders.map((f) => [f.name, f.film]), [['Launch', true], ['notes', false]]);
  assert.equal((await browseFolder(join(root, 'Films', 'Launch'), { root })).film, true);
});

test('nothing outside the home folder: not by a path, a .. or a link', async () => {
  await refused(outside, 'outside');
  await refused(join(root, '..'), 'outside');
  await refused(join(root, 'Films', '..', '..', 'elsewhere'), 'outside');
  await refused('/', 'outside');
  /* a link out of it is not listed, and not followed when asked for */
  await refused(join(root, 'out-link'), 'outside');
  /* a link to a folder inside it is, by its real path */
  assert.equal((await browseFolder(join(root, 'films-link'), { root })).path, join(root, 'Films'));
  await refused(join(root, 'nope'), 'not-found');
  await refused(join(root, 'a file.txt'), 'file');
  assert.equal(within(root, `${root}-other`), false);
});

test('a folder this account cannot read is refused as such', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const locked = join(root, 'locked');
  mkdirSync(locked);
  chmodSync(locked, 0o000);
  try { await refused(locked, 'denied'); } finally { chmodSync(locked, 0o755); }
});

test('places: home, the library and the usual folders that exist, then where recent projects are; none outside', async () => {
  const { places, recent } = await browsePlaces({ root, library: join(root, 'Films'), recent: [join(root, 'Films', 'Launch'), join(outside, 'x'), join(root, 'Films', 'notes')] });
  assert.deepEqual(places.map((p) => p.id), ['home', 'library', 'desktop']);
  assert.deepEqual(recent, [join(root, 'Films')]);
});
