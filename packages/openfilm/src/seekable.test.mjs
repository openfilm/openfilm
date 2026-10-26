import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filmHtml } from './film-doc.mjs';
import { render } from './render.mjs';
import { copyNeed, madeCopy, seekableCopies, slowSeeking } from './seekable.mjs';
import { look } from './look.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const ffmpeg = { skip: !hasFfmpeg && 'no ffmpeg', timeout: 120_000 };

/** 4 s at 30 fps with a key frame every `gop` frames. */
const clip = (file, gop) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-t', '4',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0', '-pix_fmt', 'yuv420p', file]);
/** A video's frame times, as its packets give them. */
const times = (file) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', file]).toString().trim().split('\n').map(Number).sort((a, b) => a - b);

test('a video with key frames far apart gets a copy with the same frames at the same times; one that seeks fast does not', ffmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-seekable-'));
  try {
    clip(join(dir, 'slow.mp4'), 120);
    clip(join(dir, 'fast.mp4'), 5);
    assert.ok(await slowSeeking(join(dir, 'slow.mp4')), 'a key frame every 4 s');
    assert.equal(await slowSeeking(join(dir, 'fast.mp4')), null, 'six a second');
    const copies = await seekableCopies([join(dir, 'slow.mp4'), join(dir, 'fast.mp4')], dir);
    assert.deepEqual([...copies.keys()], [join(dir, 'slow.mp4')]);
    const copy = /** @type {string} */ (copies.get(join(dir, 'slow.mp4')));
    assert.deepEqual(times(copy), times(join(dir, 'slow.mp4')));
    assert.equal(await slowSeeking(copy), null, 'the copy seeks fast');
    /* kept: the next render finds it */
    const again = await seekableCopies([join(dir, 'slow.mp4')], dir);
    assert.equal(again.get(join(dir, 'slow.mp4')), copy);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a render serves the film\'s slow-seeking videos as their copies', ffmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-seekable-render-'));
  try {
    clip(join(dir, 'a.mp4'), 120);
    writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'v', src: 'a.mp4', at: 0, time: [0, 3] }] }] }));
    const done = await render([dir], { out: join(dir, 'out.mp4'), workers: 2, silent: true, onProgress() {} });
    assert.ok(existsSync(done.out));
    assert.equal(readdirSync(join(dir, '.film/cache/seek')).filter((f) => f.endsWith('.mp4') && !f.includes('.part')).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('footage the browser does not decode gets a copy it plays, with its alpha when it has one; footage it decodes is not asked about', ffmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-seekable-unplayable-'));
  try {
    const make = (name, args) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', ...args, '-t', '1', join(dir, name)]);
    make('prores.mov', ['-i', 'testsrc2=size=320x180:rate=30', '-c:v', 'prores_ks', '-profile:v', '3']);
    make('alpha.mov', ['-i', 'color=c=red@0.5:size=320x180:rate=30,format=rgba', '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le']);
    clip(join(dir, 'fast.mp4'), 5);
    const asked = [];
    const plays = async (file) => { asked.push(file.split(/[\\/]/).pop()); return false; };
    assert.deepEqual(await copyNeed(join(dir, 'prores.mov'), { plays }), { why: 'unplayable', fps: 30, w: 320, h: 180, alpha: false });
    assert.equal((await copyNeed(join(dir, 'alpha.mov'), { plays }))?.alpha, true);
    assert.equal(await copyNeed(join(dir, 'fast.mp4'), { plays }), null, '8-bit H.264 plays anywhere');
    assert.deepEqual(asked, ['prores.mov', 'alpha.mov']);
    assert.equal(await copyNeed(join(dir, 'prores.mov'), { plays: async () => true }), null, 'a browser that decodes it needs no copy');
    const copies = await seekableCopies(['prores.mov', 'alpha.mov', 'fast.mp4'].map((n) => join(dir, n)), dir, { plays, slow: false });
    const prores = /** @type {string} */ (copies.get(join(dir, 'prores.mov')));
    const alpha = /** @type {string} */ (copies.get(join(dir, 'alpha.mov')));
    assert.ok(prores.endsWith('.mp4') && alpha.endsWith('.webm') && !copies.has(join(dir, 'fast.mp4')));
    assert.deepEqual(times(prores), times(join(dir, 'prores.mov')), 'the same frames at the same times');
    const probe = (file, entries) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', entries, '-of', 'csv=p=0', file]).toString().trim();
    assert.match(probe(prores, 'stream=codec_name,pix_fmt'), /^h264,(yuv420p|nv12)/);
    const kept = execFileSync('ffmpeg', ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', alpha, '-frames:v', '1', '-vf', 'format=rgba', '-f', 'rawvideo', '-']).filter((_, i) => i % 4 === 3);
    assert.ok(kept.every((a) => Math.abs(a - 128) <= 3), `the alpha kept: ${kept[0]}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a render shows ProRes footage, which no browser decodes, through its copy', ffmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-seekable-prores-render-'));
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2060c0:size=320x180:rate=30', '-t', '1', '-c:v', 'prores_ks', '-profile:v', '3', join(dir, 'a.mov')]);
    writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'v', src: 'a.mov', at: 0, time: [0, 1] }] }] }));
    const started = Date.now();
    const done = await render([dir, '0-0.5'], { out: join(dir, 'out.mp4'), workers: 1, silent: true, onProgress() {} });
    assert.ok(Date.now() - started < 60_000, 'no frame waits on a video that never shows');
    const [r, g, b] = execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.2', '-i', done.out, '-frames:v', '1', '-vf', 'crop=4:4:160:90,format=rgb24', '-f', 'rawvideo', '-']);
    assert.ok(Math.abs(r - 0x20) < 16 && Math.abs(g - 0x60) < 16 && Math.abs(b - 0xc0) < 16, `the footage's colour: ${r},${g},${b}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('footage too big for H.264 that the browser does not decode gets a copy scaled down to fit, and a render shows it', ffmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-seekable-big-'));
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2060c0:size=4400x2400:rate=10', '-t', '1', '-c:v', 'prores_ks', '-profile:v', '0', join(dir, 'a.mov')]);
    assert.deepEqual(await copyNeed(join(dir, 'a.mov'), { plays: async () => false }), { why: 'unplayable', fps: 10, w: 4096, h: 2234, alpha: false, scaled: true });
    writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'v', src: 'a.mov', at: 0, time: [0, 1] }] }] }));
    const done = await render([dir, '0-0.5'], { out: join(dir, 'out.mp4'), workers: 1, silent: true, onProgress() {} });
    const copy = readdirSync(join(dir, '.film/cache/seek')).filter((f) => f.endsWith('.mp4'));
    assert.equal(copy.length, 1);
    const size = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', join(dir, '.film/cache/seek', copy[0])]).toString().trim();
    assert.equal(size, '4096,2234');
    const [r, g, b] = execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.2', '-i', done.out, '-frames:v', '1', '-vf', 'crop=4:4:160:90,format=rgb24', '-f', 'rawvideo', '-']);
    assert.ok(Math.abs(r - 0x20) < 16 && Math.abs(g - 0x60) < 16 && Math.abs(b - 0xc0) < 16, `the footage's colour: ${r},${g},${b}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a copy that could not be made is said, and footage the browser does not decode then fails the render by its clip', {
  ...ffmpeg, skip: ffmpeg.skip || ((process.platform === 'win32' || process.getuid?.() === 0) && 'a folder it can\'t write to'),
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-seekable-uncopied-'));
  const seek = join(dir, '.film', 'cache', 'seek');
  const error = console.error;
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2060c0:size=320x180:rate=30', '-t', '1', '-c:v', 'prores_ks', '-profile:v', '3', join(dir, 'a.mov')]);
    writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'v', src: 'a.mov', at: 0, time: [0, 1] }] }] }));
    /* the copy can't be written */
    mkdirSync(seek, { recursive: true });
    chmodSync(seek, 0o555);
    const said = [];
    console.error = (...args) => { said.push(args.join(' ')); };
    await assert.rejects(render([dir, '0-0.5'], { out: join(dir, 'out.mp4'), workers: 1, silent: true, onProgress() {} }),
      /clip "v" \(a\.mov\): this browser can't play its video/);
    assert.ok(said.some((line) => line.includes('a.mov') && line.includes('could not be made')), said.join('\n'));
  } finally {
    console.error = error;
    chmodSync(seek, 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a copy once made is found for each request after it, and none before', ffmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-seekable-made-'));
  try {
    const file = join(dir, 'prores.mov');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-t', '1', '-c:v', 'prores_ks', '-profile:v', '3', file]);
    assert.equal(madeCopy(file, dir), null);
    const copies = await seekableCopies([file], dir, { plays: async () => false, slow: false });
    assert.ok(copies.get(file));
    assert.equal(madeCopy(file, dir), copies.get(file), 'at once, though a miss was just remembered');
    assert.equal(madeCopy(join(dir, 'gone.mov'), dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renders asking for the same copy at once share one, whole; one cancelled leaves it to the other', ffmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-seekable-shared-'));
  try {
    const file = join(dir, 'prores.mov');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-t', '8', '-c:v', 'prores_ks', '-profile:v', '3', file]);
    const ask = { plays: async () => false, slow: false };
    const seek = join(dir, '.film', 'cache', 'seek');
    /* the first starts the copy; the second asks a moment later and waits on it; the first is cancelled partway: the
       second makes the copy itself */
    const quit = new AbortController();
    const first = seekableCopies([file], dir, { ...ask, signal: quit.signal });
    const later = { plays: () => new Promise((r) => setTimeout(() => r(false), 100)), slow: false };
    const second = seekableCopies([file], dir, later);
    setTimeout(() => quit.abort(), 400);
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.size, 0, 'the cancelled one has none');
    const copy = /** @type {string} */ (b.get(file));
    assert.ok(copy);
    assert.equal(times(copy).length, 240, 'every frame');
    assert.deepEqual(readdirSync(seek), [copy.split(/[\\/]/).pop()], 'the copy alone: no part left');
    rmSync(seek, { recursive: true, force: true });
    const both = await Promise.all([seekableCopies([file], dir, ask), seekableCopies([file], dir, ask)]);
    assert.equal(both[0].get(file), both[1].get(file));
    assert.equal(times(/** @type {string} */ (both[0].get(file))).length, 240);
    assert.equal(readdirSync(seek).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two processes making the same copy at once never write the same file', ffmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-seekable-two-'));
  try {
    const file = join(dir, 'prores.mov');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '3', '-c:v', 'prores_ks', '-profile:v', '3', file]);
    const code = `const { seekableCopies } = await import(${JSON.stringify(new URL('./seekable.mjs', import.meta.url).href)});
const copies = await seekableCopies([${JSON.stringify(file)}], ${JSON.stringify(dir)}, { plays: async () => false, slow: false });
console.log(copies.get(${JSON.stringify(file)}) ?? '');`;
    const run = () => new Promise((done, fail) => execFile(process.execPath, ['--input-type=module', '-e', code], (e, out) => (e ? fail(e) : done(String(out).trim()))));
    const [a, b] = await Promise.all([run(), run()]);
    assert.ok(a);
    assert.equal(a, b);
    assert.equal(times(a).length, 90, 'whole');
    assert.equal(readdirSync(join(dir, '.film', 'cache', 'seek')).length, 1, 'no part left');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('look shows ProRes footage, which no browser decodes, through its copy', ffmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-seekable-prores-look-'));
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2060c0:size=320x180:rate=30', '-t', '1', '-c:v', 'prores_ks', '-profile:v', '3', join(dir, 'a.mov')]);
    writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'v', src: 'a.mov', at: 0, time: [0, 1] }] }] }));
    const seen = await look([dir, '0.5']);
    const [r, g, b] = execFileSync('ffmpeg', ['-v', 'error', '-i', seen.files[0], '-frames:v', '1', '-vf', 'crop=4:4:160:90,format=rgb24', '-f', 'rawvideo', '-']);
    assert.ok(Math.abs(r - 0x20) < 16 && Math.abs(g - 0x60) < 16 && Math.abs(b - 0xc0) < 16, `the footage's colour: ${r},${g},${b}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
