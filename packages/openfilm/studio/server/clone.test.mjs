// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLONE_MIN_BYTES, cloneFile, eachLimited } from './clone.mjs';

test('cloneFile copies the bytes, replaces what is there, and copies a small file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-clone-'));
  try {
    const big = Buffer.alloc(CLONE_MIN_BYTES + 4096, 7);
    writeFileSync(join(dir, 'big.bin'), big);
    writeFileSync(join(dir, 'small.txt'), 'small');
    writeFileSync(join(dir, 'there.bin'), 'older');
    await cloneFile(join(dir, 'big.bin'), join(dir, 'big-copy.bin'), { size: big.length });
    await cloneFile(join(dir, 'big.bin'), join(dir, 'there.bin'));
    await cloneFile(join(dir, 'small.txt'), join(dir, 'small-copy.txt'), { size: 5 });
    assert.ok(readFileSync(join(dir, 'big-copy.bin')).equals(big));
    assert.ok(readFileSync(join(dir, 'there.bin')).equals(big));
    assert.equal(readFileSync(join(dir, 'small-copy.txt'), 'utf8'), 'small');
    /* a clone is a file of its own: changing it leaves the original as it was */
    writeFileSync(join(dir, 'big-copy.bin'), 'changed');
    assert.ok(readFileSync(join(dir, 'big.bin')).equals(big));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cloneFile fails for a file that is not there', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-clone-'));
  try {
    await assert.rejects(cloneFile(join(dir, 'none.bin'), join(dir, 'copy.bin')), /ENOENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a clone takes no room on a Mac disk that makes clones', { skip: process.platform !== 'darwin' }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-clone-'));
  try {
    /* 64 MB that does not compress: its room on the disk is told apart from the noise of other writes */
    const size = 64 << 20;
    execFileSync('/bin/dd', ['if=/dev/urandom', `of=${join(dir, 'footage.bin')}`, 'bs=1048576', 'count=64'], { stdio: 'ignore' });
    const free = () => { execFileSync('/bin/sync'); return Number(execFileSync('/bin/df', ['-k', dir], { encoding: 'utf8' }).trim().split('\n').at(-1)?.split(/\s+/)[3]) * 1024; };
    /* APFS, by the number macOS gives it (files.mjs) */
    if (statfsSync(dir).type !== 0x1a) { t.skip('this disk makes no clones'); return; }
    const before = free();
    await cloneFile(join(dir, 'footage.bin'), join(dir, 'footage-copy.bin'), { size });
    const taken = before - free();
    assert.equal(statSync(join(dir, 'footage-copy.bin')).size, size);
    assert.ok(taken < size / 2, `the copy took ${taken} bytes of the disk: not a clone`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('eachLimited runs every item, a few at a time, and stops starting more after a failure', async () => {
  let running = 0, most = 0;
  /** @type {number[]} */
  const seen = [];
  await eachLimited([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    most = Math.max(most, ++running);
    await new Promise((done) => setTimeout(done, 5));
    seen.push(n);
    running--;
  });
  assert.deepEqual(seen.sort(), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(most, 3);
  /** @type {number[]} */
  const started = [];
  await assert.rejects(eachLimited([1, 2, 3, 4, 5, 6], 1, async (n) => { started.push(n); if (n === 2) throw new Error('second'); }), /second/);
  assert.deepEqual(started, [1, 2]);
  await eachLimited([], 4, async () => { throw new Error('never'); });
});
