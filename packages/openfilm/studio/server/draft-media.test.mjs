import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cropDraftPng, draftAlpha, draftCache } from './draft-media.mjs';

const frames = (file, filter = 'format=rgba') => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', '-vf', filter, '-r', '30', '-f', 'framemd5', '-']).toString().split('\n').filter((s) => s && !s.startsWith('#'));
test('alpha analysis keeps a one-level shadow, all frames and the exact opaque run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-draft-alpha-'));
  try {
    const file = join(dir, 'alpha.mov');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', "color=black@0:s=128x128:r=30:d=1,format=rgba,drawbox=x=21:y=23:w=20:h=18:color=0xff000001:t=fill:replace=1,drawbox=x=0:y=0:w=128:h=128:color=red:t=fill:replace=1:enable=gte(n\\,27)", '-c:v', 'png', file]);
    const result = await draftAlpha(file, new AbortController().signal);
    assert.equal(result.frames, 30);
    assert.deepEqual(result.spans, [{ opaque: false, from: 0, to: 27 }, { opaque: true, from: 27, to: 30 }]);
    assert.deepEqual(result.crop, { x: 0, y: 0, w: 128, h: 128 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a sparse PNG crop restores every pixel and PTS, including alpha=1 and fractional edges', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-draft-crop-'));
  try {
    const file = join(dir, 'sparse.mov');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=black@0:s=320x180:r=30:d=1,format=rgba,drawbox=x=63:y=35:w=41:h=33:color=0xff000001:t=fill:replace=1', '-c:v', 'png', file]);
    const before = frames(file);
    const result = await cropDraftPng(file, { w: 320, h: 180 }, new AbortController().signal);
    assert.deepEqual(result.crop, { x: 62, y: 34, w: 42, h: 34 });
    assert.deepEqual(frames(file, 'pad=320:180:62:34:color=black@0,format=rgba'), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('successful clip cache invalidates timestamp-preserving dependency replacements and corrupt payloads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-draft-cache-'));
  try {
    const source = join(dir, 'source.mov'), dependency = join(dir, 'page.html'), out = join(dir, 'output.mov');
    writeFileSync(source, 'media'); writeFileSync(dependency, 'first');
    let cache = draftCache(dir, 'test-v1'); const key = cache.keyOf({ clip: 'a' });
    await cache.put(key, source, [dependency], { durationFrames: 30 });
    assert.deepEqual(await cache.get(key, out), { durationFrames: 30 });
    assert.equal(readFileSync(out, 'utf8'), 'media');
    const original = statSync(dependency); writeFileSync(dependency, 'other'); utimesSync(dependency, original.atime, original.mtime);
    cache = draftCache(dir, 'test-v1'); assert.equal(await cache.get(key, out), null);
    writeFileSync(dependency, 'first');
    writeFileSync(source, 'wrong');
    cache = draftCache(dir, 'test-v1'); assert.equal(await cache.get(key, out), null);
    assert.equal(await draftCache(dir, 'test-v2').get(key, out), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

