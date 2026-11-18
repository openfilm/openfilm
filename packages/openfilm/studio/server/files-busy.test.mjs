import assert from 'node:assert/strict';
import { promises as fs, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { bringIn, importFile } from './files.mjs';

/* Inject Windows sharing violations while doing the actual streaming, hashing, naming and publication on disk. */
function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), 'of-import-busy-'));
  const root = join(folder, '未命名 2');
  mkdirSync(root);
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    Object.defineProperty(process, 'platform', platform);
    rmSync(folder, { recursive: true, force: true });
  });
  return { root, folder };
}
const busy = () => Object.assign(new Error('file is temporarily held'), { code: 'EBUSY' });
const bytes = (body) => Readable.from([Buffer.from(body)]);

test('streamed uploads and picked copies survive a temporarily locked staging rename', async (t) => {
  const { root, folder } = fixture(t);
  const rename = fs.rename;
  const attempts = new Map();
  t.mock.method(fs, 'rename', async (from, to) => {
    if (String(from).endsWith('.importing')) {
      const count = attempts.get(from) ?? 0;
      attempts.set(from, count + 1);
      if (count < 2) throw busy();
    }
    return rename(from, to);
  });
  syncBuiltinESMExports();
  const uploaded = await importFile(root, 'assets/picture.png', bytes('all picture bytes'));
  assert.equal(readFileSync(join(root, uploaded.path), 'utf8'), 'all picture bytes');
  const picked = join(folder, 'picked.png');
  writeFileSync(picked, 'picked picture');
  const [copied] = await bringIn(root, 'assets', [picked], 'copy');
  assert.equal(readFileSync(join(root, copied), 'utf8'), 'picked picture');
  assert.deepEqual([...attempts.values()], [3, 3]);
  assert.equal(readdirSync(join(root, 'assets')).some((name) => name.endsWith('.importing')), false);
});

test('re-importing identical bytes succeeds even when its staging cleanup is briefly locked', async (t) => {
  const { root } = fixture(t);
  await importFile(root, 'assets/picture.png', bytes('same picture'));
  const remove = fs.rm;
  let attempts = 0;
  t.mock.method(fs, 'rm', async (path, options) => {
    if (String(path).endsWith('.importing') && attempts++ < 2) throw busy();
    return remove(path, options);
  });
  syncBuiltinESMExports();
  assert.deepEqual(await importFile(root, 'assets/picture.png', bytes('same picture')), { path: 'assets/picture.png', reused: true });
  assert.equal(attempts, 3);
  assert.deepEqual(readdirSync(join(root, 'assets')), ['picture.png']);
});

test('a locked cleanup does not hide the original upload error', { timeout: 15_000 }, async (t) => {
  const { root } = fixture(t);
  const remove = fs.rm;
  t.mock.method(fs, 'rm', async (path, options) => {
    if (String(path).endsWith('.importing')) throw busy();
    return remove(path, options);
  });
  syncBuiltinESMExports();
  const original = Object.assign(new Error('the upload connection was lost'), { code: 'ECONNRESET' });
  const body = new Readable({ read() { this.destroy(original); } });
  await assert.rejects(importFile(root, 'assets/failed.png', body), (error) => error === original && error.cause?.code === 'EBUSY');
});

test('a persistently locked redundant staging file does not reject a verified existing picture', { timeout: 15_000 }, async (t) => {
  const { root } = fixture(t);
  await importFile(root, 'assets/picture.png', bytes('same picture'));
  const remove = fs.rm;
  t.mock.method(fs, 'rm', async (path, options) => {
    if (String(path).endsWith('.importing')) throw busy();
    return remove(path, options);
  });
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  syncBuiltinESMExports();
  assert.deepEqual(await importFile(root, 'assets/picture.png', bytes('same picture')), { path: 'assets/picture.png', reused: true });
  assert.equal(readFileSync(join(root, 'assets/picture.png'), 'utf8'), 'same picture');
  assert.equal(warnings[0][1].code, 'EBUSY', 'unremoved staging is recorded without rejecting the completed import');
});
