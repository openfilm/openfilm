import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changes, snapshot, undoTurn } from './file-changes.mjs';
import { readFileChanges } from '../chat/src/lib/file-changes.ts';

const project = () => mkdtempSync(join(tmpdir(), 'openfilm-file-changes-'));

test('nothing written: no changes', async () => {
  const dir = project();
  try {
    writeFileSync(join(dir, 'film.html'), '<div>\n</div>\n');
    const before = await snapshot(dir);
    assert.deepEqual(await changes(dir, before), { files: [], cut: false });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a text file added, changed and removed: each with its lines, in path order', async () => {
  const dir = project();
  try {
    writeFileSync(join(dir, 'film.html'), 'a\nb\nc\n');
    writeFileSync(join(dir, 'old.md'), 'one\ntwo\n');
    const before = await snapshot(dir);
    writeFileSync(join(dir, 'film.html'), 'a\nB\nc\nd\n');
    mkdirSync(join(dir, 'pages'));
    writeFileSync(join(dir, 'pages', 'title.html'), '<h1>Hi</h1>\n');
    rmSync(join(dir, 'old.md'));
    const { files } = await changes(dir, before);
    assert.deepEqual(files.map((f) => [f.path, f.change, f.added, f.removed]), [
      ['film.html', 'changed', 2, 1],
      ['old.md', 'removed', 0, 2],
      ['pages/title.html', 'added', 1, 0],
    ]);
    assert.deepEqual(files[0].hunks[0].lines, [' a', '-b', '+B', ' c', '+d']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a file that is not text says it changed, with no lines; a text file touched but the same is no change', async () => {
  const dir = project();
  try {
    writeFileSync(join(dir, 'voice.mp3'), Buffer.from([1, 2, 3]));
    writeFileSync(join(dir, 'film.html'), 'same\n');
    const before = await snapshot(dir);
    writeFileSync(join(dir, 'voice.mp3'), Buffer.from([1, 2, 3, 4]));
    writeFileSync(join(dir, 'music.mp3'), Buffer.from([9]));
    writeFileSync(join(dir, 'film.html'), 'same\n');
    utimesSync(join(dir, 'film.html'), new Date(), new Date(Date.now() + 5000));
    const { files } = await changes(dir, before);
    assert.deepEqual(files, [{ path: 'music.mp3', change: 'added' }, { path: 'voice.mp3', change: 'changed' }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Studio\'s own folder, hidden folders and node_modules are not read', async () => {
  const dir = project();
  try {
    const before = await snapshot(dir);
    for (const folder of ['.film', '.git', 'node_modules']) {
      mkdirSync(join(dir, folder));
      writeFileSync(join(dir, folder, 'x.json'), '{}\n');
    }
    assert.deepEqual((await changes(dir, before)).files, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a long change keeps only its first lines, and says so', async () => {
  const dir = project();
  try {
    const before = await snapshot(dir);
    writeFileSync(join(dir, 'long.txt'), Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n'));
    const [file] = (await changes(dir, before)).files;
    assert.equal(file.added, 1000);
    assert.equal(file.cut, true);
    assert.equal(file.hunks.reduce((n, h) => n + h.lines.length, 0), 400);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a saved turn\'s file changes are read back only as changes', () => {
  assert.equal(readFileChanges(undefined), null);
  assert.equal(readFileChanges([]), null);
  assert.deepEqual(readFileChanges([{ path: 'a.html', change: 'added' }, { path: 'b', change: 'odd' }, null]), [{ path: 'a.html', change: 'added' }]);
});


test('canvas snapshots do not read linked board documents or a linked tools folder', { skip: process.platform === 'win32' }, async () => {
  const dir = project();
  const elsewhere = project();
  try {
    writeFileSync(join(elsewhere, 'canvas.json'), 'private');
    symlinkSync(elsewhere, join(dir, '.film'), 'dir');
    const linked = await snapshot(dir, { canvas: true });
    assert.equal(linked.cut, true);
    assert.equal(linked.files.size, 0);
    rmSync(join(dir, '.film'));
    mkdirSync(join(dir, '.film'));
    symlinkSync(join(elsewhere, 'canvas.json'), join(dir, '.film', 'canvas.json'));
    const board = await snapshot(dir, { canvas: true });
    assert.equal(board.cut, true);
    assert.equal(board.files.size, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(elsewhere, { recursive: true, force: true }); }
});

test('undo leaves a board alone when its document or a parent became a link after the snapshot', { skip: process.platform === 'win32' }, async () => {
  for (const linked of ['.film', '.film/canvases', '.film/canvases/board.json']) {
    const dir = project();
    const elsewhere = project();
    try {
      mkdirSync(join(dir, '.film', 'canvases'), { recursive: true });
      writeFileSync(join(dir, '.film', 'canvases', 'board.json'), 'before');
      const before = await snapshot(dir, { canvas: true });
      mkdirSync(join(elsewhere, 'canvases'));
      writeFileSync(join(elsewhere, 'board.json'), 'external');
      writeFileSync(join(elsewhere, 'canvases', 'board.json'), 'external');
      rmSync(join(dir, linked), { recursive: true });
      symlinkSync(linked.endsWith('.json') ? join(elsewhere, 'board.json') : elsewhere, join(dir, linked), linked.endsWith('.json') ? 'file' : 'dir');
      const done = await undoTurn(dir, before, null, { trash: async () => assert.fail('no linked path is trashed') });
      assert.deepEqual(done, { restored: 0, missed: ['.film/canvases/board.json'] });
      assert.equal(readFileSync(join(elsewhere, 'board.json'), 'utf8'), 'external');
      assert.equal(readFileSync(join(elsewhere, 'canvases', 'board.json'), 'utf8'), 'external');
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(elsewhere, { recursive: true, force: true }); }
  }
});
