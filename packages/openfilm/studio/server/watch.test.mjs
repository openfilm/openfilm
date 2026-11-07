import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { revOf } from './film.mjs';
import { createWatchers, watchFolder, watchTree } from './watch.mjs';

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const until = async (ready) => {
  for (const end = Date.now() + 4000; !ready() && Date.now() < end;) await settle(25);
  assert.ok(ready(), 'the presence change was reported');
};

test('a deleted film is said missing once, never gone, while its folder remains; no empty film is published', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-watch-film-gone-'));
  writeFileSync(join(root, 'film.html'), 'original');
  mkdirSync(join(root, '.film'));
  const seen = [];
  const stop = watchFolder(root, (event) => seen.push(event));
  try {
    await settle(600);
    seen.length = 0;
    rmSync(join(root, 'film.html'));
    await until(() => seen.some((e) => e.type === 'film-missing'));
    writeFileSync(join(root, '.film', 'cache'), 'cache written after deletion');
    await settle(2200);
    assert.deepEqual(seen, [{ type: 'film-missing' }]);
  } finally {
    stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a film deleted and written again seconds later (an agent replacing it whole) comes back as a film, the same text too', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-watch-film-back-'));
  writeFileSync(join(root, 'film.html'), 'original');
  const seen = [];
  const stop = watchFolder(root, (event) => seen.push(event));
  try {
    await settle(600);
    seen.length = 0;
    rmSync(join(root, 'film.html'));
    await until(() => seen.some((e) => e.type === 'film-missing'));
    await settle(1500);
    writeFileSync(join(root, 'film.html'), 'original');
    await until(() => seen.some((e) => e.type === 'film'));
    assert.deepEqual(seen, [{ type: 'film-missing' }, { type: 'film', rev: revOf('original') }]);
    /* gone again, then for good with its folder: gone */
    rmSync(root, { recursive: true, force: true });
    await until(() => seen.some((e) => e.type === 'gone'));
  } finally {
    stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a film briefly removed during a save is refreshed, without closing its editor', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-watch-save-'));
  writeFileSync(join(root, 'film.html'), 'before');
  const seen = [];
  const stop = watchFolder(root, (event) => seen.push(event));
  try {
    await settle(600);
    seen.length = 0;
    rmSync(join(root, 'film.html'));
    await settle(200);
    writeFileSync(join(root, 'film.html'), 'after');
    await until(() => seen.some((e) => e.type === 'film' && e.rev === revOf('after')));
    assert.ok(!seen.some((e) => e.type === 'gone' || (e.type === 'film' && e.rev === revOf(''))));
  } finally {
    stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('presence is checked even when no native watcher could start, and stops on unsubscribe', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'of-watch-missing-'));
  const seen = [];
  const stop = watchFolder(join(scratch, 'gone-before-subscribe'), (event) => seen.push(event));
  try {
    await until(() => seen.some((e) => e.type === 'gone'));
  } finally { stop(); }
  const cancelled = [];
  const cancel = watchFolder(join(scratch, 'also-gone'), (event) => cancelled.push(event));
  cancel();
  await settle(1600);
  assert.deepEqual(cancelled, []);
  rmSync(scratch, { recursive: true, force: true });
});

test('film.html changes come with their revision, other files as one files event; .film/ is not watched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-watch-'));
  writeFileSync(join(root, 'film.html'), '{"stage":{"w":1,"h":1},"tracks":[]}');
  mkdirSync(join(root, '.film'));
  mkdirSync(join(root, 'assets'));
  const watchers = createWatchers();
  const seen = [];
  const stop = watchers.subscribe(root, (e) => seen.push(e));
  try {
  /* macOS reports the folder's own creation a moment late: let it pass before the writes this test counts */
  await settle(600);
  seen.length = 0;

  const text = '{"stage":{"w":2,"h":2},"tracks":[]}';
  writeFileSync(join(root, 'film.html'), text);
  writeFileSync(join(root, 'assets', 'a.wav'), 'x');
  writeFileSync(join(root, 'assets', 'b.wav'), 'y');
  await settle();
  assert.deepEqual(seen.find((e) => e.type === 'film'), { type: 'film', rev: revOf(text) });
  assert.equal(seen.filter((e) => e.type === 'files').length, 1, 'several files settle into one event');

  seen.length = 0;
  writeFileSync(join(root, 'film.html'), text);
  writeFileSync(join(root, '.film', 'cache'), 'z');
  await settle();
  assert.deepEqual(seen, [], 'the same text again, and Studio\'s own folder, are no change');

  /* Studio's own half-written siblings (atomic.mjs, the asset index) */
  writeFileSync(join(root, 'film.html.0123456789ab.tmp'), text);
  writeFileSync(join(root, 'assets', 'index.jsonl.123e4567-e89b-12d3-a456-426614174000.tmp'), '');
  await settle();
  assert.deepEqual(seen, [], 'Studio\'s own half-written files are no change');
  } finally {
    stop();
    watchers.closeAll();
  }
});

test('watching folder by folder (Linux): a file replaced by a rename is seen every time, and new folders are taken in', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-tree-'));
  writeFileSync(join(root, 'film.html'), '{}');
  mkdirSync(join(root, 'node_modules'));
  const names = new Set();
  const close = watchTree(root, (name) => names.add(name), false);
  try {
    for (const n of [1, 2]) {
      writeFileSync(join(root, `film.html.${n}.tmp`), `{"n":${n}}`);
      renameSync(join(root, `film.html.${n}.tmp`), join(root, 'film.html'));
      await settle(150);
      assert.ok(names.has('film.html'), `replacement ${n} seen`);
      names.clear();
    }
    mkdirSync(join(root, 'scenes'));
    await settle(150);
    writeFileSync(join(root, 'scenes', 'a.html'), '<p>');
    writeFileSync(join(root, 'node_modules', 'x.js'), '');
    await settle(150);
    assert.ok(names.has('scenes/a.html'), 'a file in a folder made while watching');
    assert.ok(![...names].some((n) => n?.startsWith('node_modules/')), 'ignored folders are not watched');
  } finally {
    close();
  }
});


test('renamed folders keep their listeners and original unsubscribe functions through repeated moves', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'of-watch-rename-'));
  const from = join(scratch, 'Untitled');
  const to = join(scratch, 'Named film');
  const again = join(scratch, 'Final film');
  mkdirSync(from);
  writeFileSync(join(from, 'film.html'), 'initial');
  const watchers = createWatchers();
  const first = [], second = [];
  const stopFirst = watchers.subscribe(from, (event) => first.push(event));
  const stopSecond = watchers.subscribe(from, (event) => second.push(event));
  try {
    await settle(600);
    renameSync(from, to);
    watchers.move(from, to);
    assert.deepEqual(watchers.roots(), [to]);
    await settle(600);
    first.length = second.length = 0;
    writeFileSync(join(to, 'film.html'), 'renamed');
    writeFileSync(join(to, 'scene.html'), '<p>new scene</p>');
    await settle();
    for (const seen of [first, second]) {
      assert.deepEqual(seen.filter((e) => e.type === 'film'), [{ type: 'film', rev: revOf('renamed') }]);
      assert.ok(seen.some((e) => e.type === 'files' && e.paths?.includes('scene.html')));
    }
    const history = { type: 'history' };
    watchers.emit(to, history);
    assert.equal(first.at(-1), history);
    assert.equal(second.at(-1), history);
    stopFirst();
    stopFirst(); // closing the same page twice must not stop the other one
    first.length = second.length = 0;
    renameSync(to, again);
    watchers.move(to, again);
    await settle(600);
    second.length = 0;
    writeFileSync(join(again, 'film.html'), 'renamed again');
    await settle();
    assert.deepEqual(first, [], 'the first page stays unsubscribed after another rename');
    assert.deepEqual(second.filter((e) => e.type === 'film'), [{ type: 'film', rev: revOf('renamed again') }]);
    watchers.emit(from, history);
    watchers.emit(to, history);
    assert.ok(!second.some((e) => e.type === 'history'), 'old paths no longer route events');
    stopSecond();
    assert.deepEqual(watchers.roots(), [], 'the original final unsubscribe closes the moved watcher');
  } finally {
    watchers.closeAll();
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('moving into an already watched path preserves both subscriptions', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'of-watch-merge-'));
  const from = join(scratch, 'before'), to = join(scratch, 'after');
  mkdirSync(from);
  mkdirSync(to);
  const watchers = createWatchers();
  const first = [], second = [];
  const stopFirst = watchers.subscribe(from, (event) => first.push(event));
  const stopSecond = watchers.subscribe(to, (event) => second.push(event));
  try {
    watchers.move(from, to);
    watchers.move(to, to);
    watchers.move(join(scratch, 'not watched'), to);
    assert.deepEqual(watchers.roots(), [to]);
    watchers.emit(to, { type: 'history' });
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    stopFirst();
    watchers.emit(to, { type: 'history' });
    assert.equal(first.length, 1);
    assert.equal(second.length, 2);
    stopSecond();
    assert.deepEqual(watchers.roots(), []);
  } finally {
    watchers.closeAll();
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("a watched project's folder that goes is said gone; one renamed in Studio (moved) is not", async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-watch-gone-'));
  writeFileSync(join(root, 'film.html'), '{"stage":{"w":1,"h":1},"tracks":[]}');
  const watchers = createWatchers();
  const seen = [];
  const stop = watchers.subscribe(root, (e) => seen.push(e));
  try {
    await settle(600);
    /* renamed by Studio: the watch follows it, and nothing is gone */
    const renamed = `${root}-renamed`;
    renameSync(root, renamed);
    watchers.move(root, renamed);
    await settle(900);
    assert.ok(!seen.some((e) => e.type === 'gone'), JSON.stringify(seen));
    /* deleted (or moved away outside Studio) */
    rmSync(renamed, { recursive: true, force: true });
    await settle(1200);
    assert.ok(seen.some((e) => e.type === 'gone'), JSON.stringify(seen));
  } finally {
    stop();
  }
});
