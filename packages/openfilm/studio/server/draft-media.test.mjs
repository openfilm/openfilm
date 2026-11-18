import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compactDraftPng, cropDraftPng, draftAlpha, draftCache, draftPartPath, splitDraftPng, draftRgbProfile, draftRleProfile, draftVideoCodec } from './draft-media.mjs';
import { signature } from '../../src/render-resume.mjs';
import { keepChanges } from './exports.mjs';

const frames = (file, filter = 'format=rgba') => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', '-vf', filter, '-r', '30', '-f', 'framemd5', '-']).toString().split('\n').filter((s) => s && !s.startsWith('#'));
test('transparent RLE compaction retains every RGBA pixel, VFR hold, final sample and source audio', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-draft-rle-'));
  try {
    const file = join(dir, 'page.mov');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=320x180:r=25:d=3,format=rgba,noise=alls=20:allf=u,colorchannelmixer=aa=0.7',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-vf', 'select=not(between(n\\,20\\,39))', '-fps_mode', 'passthrough', '-c:v', 'png', '-c:a', 'pcm_s16le', file]);
    const before = frames(file);
    const timing = (path) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,duration_time', '-of', 'json', path])).packets;
    const audio = (path) => execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-map', '0:a:0', '-f', 'hash', '-hash', 'sha256', '-']).toString();
    const clock = timing(file), sound = audio(file);
    const result = await compactDraftPng(file, { fps: 25, signal: new AbortController().signal });
    assert.equal(result?.codec, 'qtrle');
    assert.ok(result.after < result.before * 0.9);
    assert.equal(await draftVideoCodec(file, new AbortController().signal), 'qtrle');
    assert.deepEqual(frames(file), before);
    assert.deepEqual(timing(file), clock);
    assert.equal(audio(file), sound);
    assert.equal(await draftRleProfile('capcut'), null);
    assert.equal(await draftRleProfile('jianying', 'win32'), null);
    assert.equal(await draftRleProfile('jianying', 'darwin', 'x64'), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an unprofitable transparent representation leaves the source and cleans staging files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-draft-rle-refuse-'));
  try {
    const file = join(dir, 'page.mov');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=30:d=1,noise=alls=100:allf=t+u,format=rgba,colorchannelmixer=aa=0.5', '-c:v', 'png', file]);
    const before = readFileSync(file);
    assert.equal(await compactDraftPng(file, { fps: 30, signal: new AbortController().signal }), null);
    assert.deepEqual(readFileSync(file), before);
    assert.throws(() => statSync(`${file}.rle.mov`), { code: 'ENOENT' });
    assert.throws(() => statSync(`${file}.png-sample.mov`), { code: 'ENOENT' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('RLE preserves hidden RGB and all 256 alpha levels on a fractional frame clock', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-draft-rle-rgba-'));
  try {
    const file = join(dir, 'ramp.mov'), raw = Buffer.alloc(16 * 16 * 4 * 63);
    for (let f = 0; f < 63; f++) for (let p = 0; p < 256; p++) {
      const at = (f * 256 + p) * 4;
      raw[at] = (p * 79) % 256; raw[at + 1] = (p * 43) % 256; raw[at + 2] = (p * 17) % 256; raw[at + 3] = p;
      if (p === f) raw[at] ^= 1;
    }
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '16x16', '-r', '30000/1001', '-i', '-', '-c:v', 'png', file], { input: raw });
    const before = frames(file);
    const duration = (path) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).toString();
    const clock = duration(file);
    assert.equal((await compactDraftPng(file, { fps: 29.97, signal: new AbortController().signal }))?.codec, 'qtrle');
    assert.deepEqual(frames(file), before);
    assert.equal(duration(file), clock);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
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

test('an interframe source is cropped only after the new PNG frames have been deduplicated', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-draft-rle-crop-'));
  try {
    const file = join(dir, 'badge.mov');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=black@0:s=320x180:r=30:d=3,format=rgba,drawbox=x=60:y=40:w=120:h=60:color=0xff000001:t=fill:replace=1', '-c:v', 'qtrle', '-pix_fmt', 'argb', '-g', '30', file]);
    const before = frames(file);
    const result = await cropDraftPng(file, { w: 320, h: 180, frames: 90 }, new AbortController().signal, keepChanges);
    assert.deepEqual(result.crop, { x: 60, y: 40, w: 120, h: 60 });
    assert.deepEqual(frames(file, 'format=rgba,pad=320:180:60:40:color=black@0'), before);
    const count = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=nb_frames', '-of', 'csv=p=0', file]).toString().trim();
    assert.equal(count, '2');
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

test('cropping a deduplicated 25 fps still keeps its final packet one frame long', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-draft-sparse-clock-'));
  try {
    const file = join(dir, 'still.mov');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=black@0:s=320x180:r=25:d=1,format=rgba,drawbox=x=20:y=20:w=40:h=40:color=red:t=fill:replace=1',
      '-vf', 'select=eq(n\\,0)+eq(n\\,24)', '-fps_mode', 'passthrough', '-c:v', 'png', file]);
    const before = frames(file);
    const result = await cropDraftPng(file, { w: 320, h: 180, frames: 2, fps: 25 }, new AbortController().signal);
    assert.deepEqual(result.crop, { x: 20, y: 20, w: 40, h: 40 });
    assert.deepEqual(frames(file, 'pad=320:180:20:20:color=black@0,format=rgba'), before);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'packet=pts_time,duration_time:format=duration', '-of', 'json', file]));
    assert.equal(Number(probe.format.duration), 1);
    assert.deepEqual(probe.packets.map((p) => [Number(p.pts_time), Number(p.duration_time)]), [[0, 0.96], [0.96, 0.04]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('mixed-alpha pages split into pixel-identical PNG and lossless RGB runs, with the original frame clock', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-draft-split-'));
  try {
    const file = join(dir, 'page.mov');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', "testsrc2=s=160x90:r=30:d=3,noise=alls=10:allf=u,format=rgba,colorchannelmixer=aa=0.5:enable=lt(t\\,0.1)", '-c:v', 'png', file]);
    const before = frames(file).map((s) => s.split(',').at(-1));
    const analysis = await draftAlpha(file, new AbortController().signal);
    const parts = await splitDraftPng(file, analysis, { fps: 30, frames: 90, signal: new AbortController().signal });
    assert.ok(parts, 'the exact RGB representation earns its size');
    assert.deepEqual(parts.map((p) => [p.from, p.to, p.opaque]), [[0, 3, false], [3, 90, true]]);
    const after = parts.flatMap((p) => frames(draftPartPath(file, p.suffix)).map((s) => s.split(',').at(-1)));
    assert.deepEqual(after, before);
    assert.equal(await draftRgbProfile('capcut'), null, 'unverified target editors retain PNG');
    assert.equal(await draftRgbProfile('jianying', 'win32'), null, 'unverified platforms retain PNG');
    assert.equal(await draftRgbProfile('jianying', 'darwin', 'x64'), null, 'unverified decoder architectures retain PNG');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an incorrect alpha classification cannot publish opaque RGB over translucent pixels', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-draft-refuse-'));
  try {
    const file = join(dir, 'page.mov');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=30:d=2,format=rgba,colorchannelmixer=aa=0.5', '-c:v', 'png', file]);
    const before = readFileSync(file);
    const parts = await splitDraftPng(file, { spans: [{ from: 0, to: 3, opaque: false }, { from: 3, to: 60, opaque: true }] }, { fps: 30, frames: 60, signal: new AbortController().signal });
    assert.equal(parts, null);
    assert.deepEqual(readFileSync(file), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a split cache restores every part and refuses a damaged part before copying any media', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-draft-parts-cache-'));
  try {
    const source = join(dir, 'source.mov'), dependency = join(dir, 'page.html'), out = join(dir, 'output.mov');
    writeFileSync(source, 'alpha'); writeFileSync(draftPartPath(source, '.part-1'), 'opaque'); writeFileSync(dependency, 'page');
    const result = { durationFrames: 90, crop: null, parts: [{ from: 0, to: 3, opaque: false, suffix: '' }, { from: 3, to: 90, opaque: true, suffix: '.part-1' }] };
    let cache = draftCache(dir, 'test-parts'); const key = cache.keyOf({ clip: 'a' });
    await cache.put(key, source, [dependency], result, source, ['', '.part-1']);
    assert.deepEqual(await cache.get(key, out), result);
    assert.equal(readFileSync(out, 'utf8'), 'alpha');
    assert.equal(readFileSync(draftPartPath(out, '.part-1'), 'utf8'), 'opaque');
    rmSync(out); rmSync(draftPartPath(out, '.part-1'));
    writeFileSync(draftPartPath(source, '.part-1'), 'broken');
    cache = draftCache(dir, 'test-parts'); assert.equal(await cache.get(key, out), null);
    assert.throws(() => statSync(out), { code: 'ENOENT' });
    assert.throws(() => statSync(draftPartPath(out, '.part-1')), { code: 'ENOENT' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an edit made during export cannot label old pixels as the new source, and hash memoization observes later edits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-draft-edit-race-'));
  try {
    const source = join(dir, 'source.mov'), dependency = join(dir, 'page.html'), out = join(dir, 'out.mov');
    writeFileSync(source, 'media'); writeFileSync(dependency, 'first');
    const cache = draftCache(dir, 'race-v1'), key = cache.keyOf('drawn-before-edit');
    const snapshots = new Map([[dependency, signature(dependency)]]);
    writeFileSync(dependency, 'other');
    await cache.put(key, source, [dependency], { durationFrames: 30 }, source, [''], snapshots);
    assert.equal(await cache.get(key, out), null);
    const a = cache.keyOf('a'), b = cache.keyOf('b');
    await cache.put(a, source, [dependency], { durationFrames: 30 });
    writeFileSync(dependency, 'third');
    await cache.put(b, source, [dependency], { durationFrames: 30 });
    assert.deepEqual(await draftCache(dir, 'race-v1').get(b, out), { durationFrames: 30 });
    assert.equal(await draftCache(dir, 'race-v1').get(a, out), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

