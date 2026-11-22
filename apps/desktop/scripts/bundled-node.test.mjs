import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fetchNode, untarEntry } from './bundled-node.mjs';

test('a file is read out of a tar by its name, past the others and their records', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-tar-'));
  try {
    const folder = join(dir, 'node-v1-darwin-arm64');
    mkdirSync(join(folder, 'bin'), { recursive: true });
    writeFileSync(join(folder, 'bin/node'), Buffer.alloc(70_000, 7));
    writeFileSync(join(folder, 'LICENSE'), 'MIT and more\n');
    writeFileSync(join(folder, 'README.md'), 'x'.repeat(513));
    execFileSync('tar', ['-czf', join(dir, 'n.tar.gz'), '-C', dir, 'node-v1-darwin-arm64'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
    const tar = gunzipSync(readFileSync(join(dir, 'n.tar.gz')));
    assert.deepEqual(untarEntry(tar, 'node-v1-darwin-arm64/bin/node'), Buffer.alloc(70_000, 7));
    assert.equal(String(untarEntry(tar, 'node-v1-darwin-arm64/LICENSE')), 'MIT and more\n');
    assert.throws(() => untarEntry(tar, 'node-v1-darwin-arm64/bin/npm'), /has no node-v1-darwin-arm64\/bin\/npm/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a Node download that is not the one pinned is not kept', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-node-'));
  try {
    let asked = 0;
    const fetch = async () => { asked += 1; return new Response('not node'); };
    await assert.rejects(fetchNode(join(dir, 'node'), { platform: 'darwin', arch: 'arm64', fetch }), /did not match its checksum/);
    assert.equal(asked, 3, 'tried again, then given up');
    await assert.rejects(fetchNode(join(dir, 'node'), { platform: 'linux', arch: 'x64', fetch }), /no Node to bring for linux-x64/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
