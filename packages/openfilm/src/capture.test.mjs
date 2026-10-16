import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { capture } from './capture.mjs';
import { UsageError } from './shared.mjs';

const BIN = new URL('../bin/openfilm.mjs', import.meta.url).pathname;

test('a capture asked wrong is a usage error, said before any browser starts', async () => {
  await assert.rejects(capture(['https://example.com']), UsageError);
  await assert.rejects(capture(['example.com', 'a.png']), /not a web address/);
  await assert.rejects(capture(['https://example.com', 'a.jpg']), /is a \.png/);
  await assert.rejects(capture(['https://example.com', 'a.png'], { size: 'big' }), /--size/);
  await assert.rejects(capture(['https://example.com', 'a.png'], { wait: '-1' }), /--wait/);
});

test('the window at its scale, the whole page, one element, and a banner removed that is not there', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-capture-'));
  try {
    writeFileSync(join(dir, 'page.html'), '<!doctype html><body style="margin:0;height:1000px;background:#fff">'
      + '<div id="card" style="position:absolute;left:50px;top:40px;width:300px;height:200px;background:#e33"></div></body>');
    const url = pathToFileURL(join(dir, 'page.html')).href;
    const fast = { size: '400x300', wait: '0' };
    const window = await capture([url, join(dir, 'out', 'window.png')], { ...fast, scale: 1 });
    assert.match(window.lines[0], /400 × 300 px$/);
    assert.ok(existsSync(join(dir, 'out', 'window.png')), 'the folder for the picture is made');
    assert.match((await capture([url, join(dir, 'whole.png')], { ...fast, scale: 1, full: true })).lines[0], /400 × 1000 px$/);
    assert.match((await capture([url, join(dir, 'card.png')], { ...fast, selector: '#card' })).lines[0], /600 × 400 px$/);
    assert.match((await capture([url, join(dir, 'clean.png')], { ...fast, scale: 1, hide: ['#cookie-banner'] })).lines[0], /400 × 300 px$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('openfilm capture is a command: its help, and a wrong address exits 2', () => {
  const help = spawnSync(process.execPath, [BIN, 'capture', '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--selector <css>/);
  const wrong = spawnSync(process.execPath, [BIN, 'capture', 'example.com', 'a.png'], { encoding: 'utf8' });
  assert.equal(wrong.status, 2);
  assert.match(wrong.stderr, /not a web address/);
});
