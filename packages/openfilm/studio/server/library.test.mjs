import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { builtInRoot, libraryFile, libraryIndex } from './library.mjs';
import { takeSaved } from './saved.mjs';

const index = /** @type {{ groups: Record<string, { id: string }[]>, items: any[] }} */ (libraryIndex());
const LANGS = ['en', 'zh-CN', 'ja', 'ko', 'es'];

test('every thing of the library is there, named in each language, in a group of its category', () => {
  assert.ok(index.items.length > 50);
  const ids = new Set();
  for (const item of index.items) {
    assert.ok(!ids.has(item.id), `${item.id} twice`);
    ids.add(item.id);
    for (const lang of LANGS) assert.ok(item.name?.[lang], `${item.id} has no ${lang} name`);
    assert.ok(index.groups[item.cat]?.some((g) => g.id === item.group), `${item.id}: no group ${item.group} in ${item.cat}`);
    if (item.kind === 'page') {
      const about = JSON.parse(readFileSync(join(builtInRoot(), item.id, 'saved.json'), 'utf8'));
      assert.equal(about.kind, 'clip');
      assert.ok(existsSync(join(builtInRoot(), item.id, 'files', about.clip.src)), `${item.id}: its page`);
      assert.ok(item.place === 'cut' || Array.isArray(about.clip.time), `${item.id}: a page without an end needs its stretch`);
      for (const f of ['poster.jpg', 'preview.mp4']) assert.ok(libraryFile(`${item.id}/${f}`), `${item.id}: ${f}`);
      if (about.clip.attrs?.['data-props']) assert.ok(Array.isArray(JSON.parse(about.clip.attrs['data-props'])));
    }
    if (item.kind === 'sound') assert.ok(libraryFile(item.id), `${item.id}: the sound`);
    if (item.kind === 'look') assert.match(item.filter, /^[a-z-]+\(.+\)$/);
    if (item.kind === 'fade') assert.ok(['dissolve', 'dip-black', 'dip-white'].includes(item.fade));
  }
});

test('only files inside the library are given out', () => {
  assert.ok(libraryFile('index.json'));
  assert.equal(libraryFile('../package.json'), null);
  assert.equal(libraryFile('effects'), null);
  assert.equal(libraryFile(''), null);
  assert.equal(libraryFile(null), null);
});

test('a page of the library is taken into a project as a copy under saved/openfilm/, a sound into assets/', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-library-project-'));
  const taken = await takeSaved(root, 'openfilm/effects/snow');
  assert.ok('clip' in taken);
  assert.equal(taken.clip.src, 'saved/openfilm/effects-snow/snow.html');
  assert.deepEqual(/** @type {any} */ (taken.clip).time, [0, 4]);
  assert.ok(existsSync(join(root, 'saved/openfilm/effects-snow/snow.html')));
  assert.ok(JSON.parse(String(/** @type {any} */ (taken.clip).attrs['data-props'])).some((p) => p.var === '--color'));
  const sound = await takeSaved(root, 'openfilm/sounds/whoosh.m4a');
  assert.deepEqual(sound, { path: 'assets/whoosh.m4a' });
  await assert.rejects(() => takeSaved(root, 'openfilm/../package.json'));
});
