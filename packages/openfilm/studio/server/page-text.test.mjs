import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPage, revOf, writePage } from './page-text.mjs';

test('a page is written only over the text it was made from, a new one only where there is none, and taken away only as it was', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-page-text-'));
  writeFileSync(join(root, 'title.html'), '<h1>Hi</h1>');
  const { text, rev } = await readPage(root, 'title.html');
  assert.deepEqual([text, rev], ['<h1>Hi</h1>', revOf(Buffer.from('<h1>Hi</h1>'))]);
  const made = await writePage(root, 'title.html', '<h1>Hi</h1><h1>Hi</h1>', rev);
  assert.equal(made.rev, revOf(Buffer.from('<h1>Hi</h1><h1>Hi</h1>')));
  await assert.rejects(writePage(root, 'title.html', '<p>late</p>', rev), /changed since/, 'written meanwhile: refused');
  assert.equal(readFileSync(join(root, 'title.html'), 'utf8'), '<h1>Hi</h1><h1>Hi</h1>');
  await assert.rejects(writePage(root, 'title.html', 'x', null), /there already/);
  await writePage(root, 'scenes/title-2.html', '<p>own</p>', null);
  assert.equal(readFileSync(join(root, 'scenes/title-2.html'), 'utf8'), '<p>own</p>');
  await assert.rejects(readPage(root, 'notes.txt'), /a page of the project/);
  await assert.rejects(readPage(root, '../title.html'), /not a path inside/);
  await assert.rejects(writePage(root, 'scenes/title-2.html', null, revOf(Buffer.from('<p>other</p>'))), /changed since/, 'taken away only as it was written');
  assert.ok(existsSync(join(root, 'scenes/title-2.html')));
});

test('a page not in UTF-8 is written back byte for byte, its own bytes kept; a mark at the start of one in UTF-8 too', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-page-bytes-'));
  writeFileSync(join(root, 'p.html'), Buffer.from('<meta charset="windows-1252"><h1 id="t">Caf\xe9 \x93q\x94</h1>', 'latin1'));
  const { text, rev } = await readPage(root, 'p.html');
  await writePage(root, 'p.html', text.replace('</h1>', '</h1><h1 id="t-copy">x</h1>'), rev);
  assert.deepEqual(readFileSync(join(root, 'p.html')), Buffer.from('<meta charset="windows-1252"><h1 id="t">Caf\xe9 \x93q\x94</h1><h1 id="t-copy">x</h1>', 'latin1'));
  const again = await readPage(root, 'p.html');
  await assert.rejects(writePage(root, 'p.html', `${again.text}<p>\u2713</p>`, again.rev), /not written in UTF-8/);
  writeFileSync(join(root, 'u.html'), Buffer.from('\ufeff<h1>é</h1>', 'utf8'));
  const u = await readPage(root, 'u.html');
  await writePage(root, 'u.html', `${u.text}<p>✓</p>`, u.rev);
  assert.deepEqual(readFileSync(join(root, 'u.html')), Buffer.from('\ufeff<h1>é</h1><p>✓</p>', 'utf8'));
});
