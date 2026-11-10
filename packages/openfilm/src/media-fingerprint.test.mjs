import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PIECE, fingerprint, held, isFingerprint } from './media-fingerprint.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'of-fingerprint-'));
/** `size` bytes that differ everywhere, `seed` choosing which. */
const bytes = (size, seed = 1) => { const b = Buffer.alloc(size); for (let i = 0; i < size; i++) b[i] = (i * 31 + seed * 17 + (i >> 8)) & 255; return b; };

test('a file keeps its fingerprint when it is renamed, moved or copied', async () => {
  const at = dir();
  writeFileSync(join(at, 'a.mp4'), bytes(5 * PIECE));
  const first = await fingerprint(join(at, 'a.mp4'));
  assert.ok(isFingerprint(first));
  copyFileSync(join(at, 'a.mp4'), join(at, 'copy.mp4'));
  renameSync(join(at, 'a.mp4'), join(dir(), 'renamed.mov'));
  assert.equal(await fingerprint(join(at, 'copy.mp4')), first);
});

test('files of one size that differ at their start, middle or end have fingerprints of their own', async () => {
  const at = dir();
  const size = 8 * PIECE;
  const base = bytes(size);
  writeFileSync(join(at, 'base'), base);
  const seen = new Set([await fingerprint(join(at, 'base'))]);
  for (const [name, where] of [['start', 10], ['middle', size / 2], ['end', size - 10]]) {
    const changed = Buffer.from(base);
    changed[where] ^= 255;
    writeFileSync(join(at, name), changed);
    seen.add(await fingerprint(join(at, name)));
  }
  assert.equal(seen.size, 4);
});

test('a small file is read whole, and the size is part of the fingerprint', async () => {
  const at = dir();
  writeFileSync(join(at, 'one'), bytes(1000));
  writeFileSync(join(at, 'other'), bytes(1000, 2));
  writeFileSync(join(at, 'longer'), Buffer.concat([bytes(1000), Buffer.alloc(1)]));
  writeFileSync(join(at, 'empty'), '');
  const prints = await Promise.all(['one', 'other', 'longer', 'empty'].map((n) => fingerprint(join(at, n))));
  assert.equal(new Set(prints).size, 4);
  assert.ok(prints.every(isFingerprint));
});

test('a file whose bytes a cloud drive keeps elsewhere is not read', async () => {
  assert.equal(held({ size: 10 * PIECE, blocks: 0 }), false);
  assert.equal(held({ size: 10 * PIECE, blocks: 1280 }), true);
  /* a small file may take no room of its own and still be here */
  assert.equal(held({ size: 100, blocks: 0 }), true);
  assert.equal(held({ size: 10 * PIECE }), true);
});

test('a folder has no fingerprint', async () => {
  await assert.rejects(fingerprint(dir()));
});
