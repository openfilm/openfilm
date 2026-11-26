import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { filmHtml } from './film-doc.mjs';
import { launch, serve } from './host.mjs';
import { render } from './render.mjs';
import { copyNeed, firstFrame, gradedCopies, gradeKey, gradeRange, hasAlpha, madeCopy, seekableCopies, slowSeeking } from './seekable.mjs';
import { hash } from './shared.mjs';
import { look } from './look.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const ffmpeg = { skip: !hasFfmpeg && 'no ffmpeg', timeout: 120_000 };

/* On CI's virtual Macs the media engine (VideoToolbox) at times hangs for good, and every ffmpeg and browser test after
   it hangs with it until the job's limit. There these copies are made on the processor: an ffmpeg that refuses the
   engine stands in front of the real one. The engine's own path is still tested where it can hang (the test below). */
if (process.platform === 'darwin' && process.env.CI && hasFfmpeg) {
  const bin = mkdtempSync(join(tmpdir(), 'of-no-engine-'));
  const real = execFileSync('sh', ['-c', 'command -v ffmpeg']).toString().trim();
  writeFileSync(join(bin, 'ffmpeg'), `#!/bin/sh\ncase " $* " in *videotoolbox*) exit 1;; esac\nexec '${real}' "$@"\n`);
  chmodSync(join(bin, 'ffmpeg'), 0o755);
  process.env.PATH = `${bin}:${process.env.PATH}`;
}

/** 4 s at 30 fps with a key frame every `gop` frames. */
const clip = (file, gop) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-t', '4',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0', '-pix_fmt', 'yuv420p', file]);
/** The codecs of a file's sound streams, as ffprobe names them: '' when it has none. */
const soundStreams = (file) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]).toString().trim();
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

test('a master export\'s copy is kept apart from the preview\'s, with the same frames at the same times', ffmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-seekable-'));
  try {
    clip(join(dir, 'slow.mp4'), 120);
    const file = join(dir, 'slow.mp4');
    const fine = /** @type {string} */ ((await seekableCopies([file], dir, { fine: true })).get(file));
    assert.match(fine, /-fine\.mp4$/);
    assert.deepEqual(times(fine), times(file));
    assert.equal(await slowSeeking(fine), null, 'the copy seeks fast');
    /* the preview neither finds nor uses it: its own copy is another file */
    assert.equal(madeCopy(file, dir), null);
    const preview = /** @type {string} */ ((await seekableCopies([file], dir)).get(file));
    assert.notEqual(preview, fine);
    assert.equal((await seekableCopies([file], dir, { fine: true })).get(file), fine, 'kept for the next master export');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an alpha is seen in a pixel format, beside a VP9\'s picture, and as an HEVC\'s second layer', () => {
  /* as ffprobe 8.1 tells them */
  assert.equal(hasAlpha({ pix_fmt: 'yuva444p12le' }), true, 'ProRes 4444');
  assert.equal(hasAlpha({ pix_fmt: 'argb' }), true, 'QuickTime Animation');
  assert.equal(hasAlpha({ pix_fmt: 'yuv420p', tags: { alpha_mode: '1' } }), true, 'VP9 with its alpha');
  assert.equal(hasAlpha({ pix_fmt: 'yuv420p', view_ids_available: '0,0', tags: {} }), true, "Apple's HEVC with alpha");
  assert.equal(hasAlpha({ pix_fmt: 'yuv420p', view_ids_available: '', tags: {} }), false, 'HEVC without');
  assert.equal(hasAlpha({ pix_fmt: 'yuv420p' }), false, 'an older ffprobe, H.264');
});

test('a VP9 with an alpha and key frames far apart keeps its alpha: it gets no copy, which would be H.264, without it', ffmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-seekable-alpha-'));
  try {
    /* 4 s, one key frame: as an animation exported with its alpha (WebM, libvpx-vp9) usually is */
    const webm = (name, format) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=red@0.5:size=320x180:rate=30,format=${format}`, '-t', '4',
      '-c:v', 'libvpx-vp9', '-pix_fmt', format === 'rgba' ? 'yuva420p' : 'yuv420p', '-g', '120', '-deadline', 'realtime', '-cpu-used', '8', join(dir, name)]);
    webm('alpha.webm', 'rgba');
    webm('opaque.webm', 'yuv420p');
    assert.equal(await slowSeeking(join(dir, 'alpha.webm')), null);
    assert.ok(await slowSeeking(join(dir, 'opaque.webm')), 'the same without an alpha seeks slowly');
    assert.equal(await copyNeed(join(dir, 'alpha.webm'), { plays: async () => true }), null);
    const copies = await seekableCopies([join(dir, 'alpha.webm'), join(dir, 'opaque.webm')], dir, { plays: async () => true });
    assert.deepEqual([...copies.keys()], [join(dir, 'opaque.webm')]);
    assert.equal(madeCopy(join(dir, 'alpha.webm'), dir), null, 'a page asking for it is served it as it is');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a render serves the film\'s slow-seeking videos as their copies', ffmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-seekable-render-'));
  try {
    clip(join(dir, 'a.mp4'), 120);
    writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'v', src: 'a.mp4', at: 0, time: [0, 3] }] }] }));
    /* drawn in the browser: footage that is the film's whole picture is read straight from its file where it can be,
       and needs no copy (direct.mjs) */
    const done = await render([dir], { out: join(dir, 'out.mp4'), workers: 2, silent: true, straight: false, onProgress() {} });
    assert.ok(existsSync(done.out));
    assert.equal(readdirSync(join(dir, '.film/cache/seek')).filter((f) => f.endsWith('.mp4') && !f.includes('.part')).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('footage the browser plays the sound of but shows no picture of, ProRes with sound, gets a copy it plays', ffmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-seekable-nopic-'));
  const site = await serve(dir);
  const browser = await launch();
  try {
    /* ProRes with AAC sound, as cameras record it: the browser plays the sound, shows no picture and reports no error */
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-t', '1', '-c:v', 'prores_ks', '-profile:v', '3', '-c:a', 'aac', '-shortest', join(dir, 'prores-sound.mov')]);
    clip(join(dir, 'fast.mp4'), 5);
    const page = await browser.newPage();
    const plays = (file) => page.evaluate(firstFrame, `${site.url}/${relative(dir, file).split(sep).map(encodeURIComponent).join('/')}`);
    assert.equal(await plays(join(dir, 'prores-sound.mov')), false, 'a file it shows no picture of is not playable');
    assert.equal(await plays(join(dir, 'fast.mp4')), true, 'a video with a picture plays');
    /* asked as a render asks it: only the footage without a picture needs a copy */
    const copies = await seekableCopies([join(dir, 'prores-sound.mov'), join(dir, 'fast.mp4')], dir, { plays, slow: false });
    assert.deepEqual([...copies.keys()], [join(dir, 'prores-sound.mov')]);
    const copy = /** @type {string} */ (copies.get(join(dir, 'prores-sound.mov')));
    assert.equal(await plays(copy), true, 'the copy plays');
    assert.deepEqual(times(copy), times(join(dir, 'prores-sound.mov')), 'the same frames at the same times');
    assert.equal(soundStreams(copy), '', 'the copy is the picture only: the sound is still mixed from the original');
  } finally {
    await browser.close();
    await site.close();
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
    /* ProRes with the sound a camera records with it: a browser plays the sound, shows no picture and reports no error */
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2060c0:size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-t', '1', '-c:v', 'prores_ks', '-profile:v', '3', '-c:a', 'aac', '-shortest', join(dir, 'a.mov')]);
    writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 180, h: 320 }, tracks: [{ clips: [{ id: 'v', src: 'a.mov', box: { x: 10, y: 20, w: 160 }, at: 0, time: [0, 1] }] }] }));
    /* A width of 160 on this portrait stage gives the 16:9 footage a height of 90. */
    const started = Date.now();
    const done = await render([dir, '0-0.5'], { out: join(dir, 'out.mp4'), workers: 1, silent: true, onProgress() {} });
    assert.ok(Date.now() - started < 60_000, 'no frame waits on a video that never shows');
    const [made] = readdirSync(join(dir, '.film/cache/seek')).filter((f) => f.endsWith('.mp4') && !f.includes('.part'));
    assert.ok(made, 'the footage is drawn through its copy');
    assert.equal(soundStreams(join(dir, '.film/cache/seek', made)), '', 'the copy is the picture only');
    const [r, g, b] = execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.2', '-i', done.out, '-frames:v', '1', '-vf', 'crop=4:4:90:40,format=rgb24', '-f', 'rawvideo', '-']);
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

test('a copy whose graphics chip hangs is stopped and made on the processor, and leaves no ffmpeg running', {
  ...ffmpeg, skip: ffmpeg.skip || (process.platform === 'win32' && 'a shell script stands in for ffmpeg'),
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-seekable-hung-'));
  try {
    const file = join(dir, 'prores.mov');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-t', '1', '-c:v', 'prores_ks', '-profile:v', '3', file]);
    /* ffmpeg, with a chip encoder that passes its test and then hangs on the copy: it writes its pid and never ends */
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const encoder = process.platform === 'darwin' ? 'h264_videotoolbox' : 'h264_nvenc';
    const pidFile = join(dir, 'hung.pid');
    writeFileSync(join(bin, 'ffmpeg'), `#!/bin/sh
case " $* " in
  *" -encoders "*) "$REAL_FFMPEG" "$@"; echo " V....D ${encoder} the chip's"; exit 0;;
  *" ${encoder} "*" -f null - "*) exit 0;;
  *" ${encoder} "*) echo $$ > '${pidFile}'; exec sleep 600;;
esac
exec "$REAL_FFMPEG" "$@"
`);
    chmodSync(join(bin, 'ffmpeg'), 0o755);
    const real = execFileSync('sh', ['-c', 'command -v ffmpeg']).toString().trim();
    const code = `const { seekableCopies } = await import(${JSON.stringify(new URL('./seekable.mjs', import.meta.url).href)});
const copies = await seekableCopies([${JSON.stringify(file)}], ${JSON.stringify(dir)}, { plays: async () => false, slow: false });
console.log(copies.get(${JSON.stringify(file)}) ?? '');`;
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, REAL_FFMPEG: real };
    const copy = await new Promise((done, fail) => execFile(process.execPath, ['--input-type=module', '-e', code], { env }, (e, out) => (e ? fail(e) : done(String(out).trim()))));
    assert.ok(existsSync(pidFile), 'the chip was tried');
    assert.ok(copy, 'made all the same');
    assert.equal(times(copy).length, 30, 'whole');
    assert.equal(readdirSync(join(dir, '.film', 'cache', 'seek')).length, 1, 'no part left');
    const pid = Number(readFileSync(pidFile, 'utf8'));
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'the hung ffmpeg was stopped');
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

/* ── graded copies (SPEC.md --of-lut) ── */

/** A 10-bit ProRes 422 HQ of `w`×`h` at 24 fps, 12 frames, tagged BT.709: each frame's Y row from `y(x)` (10-bit codes),
    its colour neutral, or a flat colour (`color`, as ffmpeg names one). */
const tenBit = (dir, name, w, h, { y, color }) => {
  const file = join(dir, name);
  const tags = 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv';
  if (color) {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:size=${w}x${h}:rate=24`, '-frames:v', '12', '-vf', `format=yuv422p10le,${tags}`, '-c:v', 'prores_ks', '-profile:v', '3', file]);
    return file;
  }
  const luma = Buffer.alloc(w * h * 2), chroma = Buffer.alloc((w / 2) * h * 2);
  for (let x = 0; x < w; x++) for (let r = 0; r < h; r++) luma.writeUInt16LE(y(x), (r * w + x) * 2);
  for (let i = 0; i < chroma.length; i += 2) chroma.writeUInt16LE(512, i);
  const raw = join(dir, `${name}.yuv`);
  writeFileSync(raw, Buffer.concat(Array(12).fill(Buffer.concat([luma, chroma, chroma]))));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'yuv422p10le', '-s', `${w}x${h}`, '-r', '24', '-i', raw, '-vf', tags, '-c:v', 'prores_ks', '-profile:v', '3', file]);
  rmSync(raw);
  return file;
};
/** A 3D LUT (.cube, `n` points) whose output is `f(r, g, b)`. */
const cube = (file, n, f) => {
  let text = `LUT_3D_SIZE ${n}\n`;
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) text += `${f(r / (n - 1), g / (n - 1), b / (n - 1)).map((v) => v.toFixed(6)).join(' ')}\n`;
  writeFileSync(file, text);
  return file;
};
/** A frame of a video at `t` s (`vf` before, its files read from the video's folder), as full-range RGB: [r, g, b] at (x, y). */
const rgbAt = (file, t, w, h, vf = '') => {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `${vf}scale=w=${w}:h=${h}:in_range=tv:out_range=pc,format=rgb24`, '-f', 'rawvideo', '-'], { cwd: dirname(file) });
  return (/** @type {number} */ x, /** @type {number} */ y) => [...raw.subarray((y * w + x) * 3, (y * w + x) * 3 + 3)];
};
/**
 * How finely a gradient across the frame is graded: its green averaged down each column (the noise of compression
 * cancels, the steps stay), over the columns away from black and white: its biggest step from a column to the next,
 * and how much of its rise is in steps of 4 codes or more (bands), in 8-bit codes.
 */
const gradientOf = (/** @type {(x: number, y: number) => number[]} */ at, w, h) => {
  const columns = Array.from({ length: w }, (_, x) => { let sum = 0; for (let y = 0; y < h; y++) sum += at(x, y)[1]; return sum / h; });
  let step = 0, rise = 0, banded = 0;
  for (let x = 1; x < w; x++) {
    if (!(columns[x - 1] > 12 && columns[x - 1] < 243 && columns[x] > 12 && columns[x] < 243)) continue;
    const d = Math.abs(columns[x] - columns[x - 1]);
    step = Math.max(step, d);
    rise += d;
    if (d >= 4) banded += d;
  }
  return { step: Math.round(step * 100) / 100, bands: Math.round((banded / rise) * 100) / 100 };
};

test('a video clip graded by a LUT is drawn through a copy graded at its own bit depth: its colour as the LUT says, a gradient without the bands of grading after 8 bits', { ...ffmpeg, timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-seekable-graded-'));
  try {
    const w = 640, h = 64;
    /* a flat colour, and a narrow gradient (10-bit Y 256 to 384, 32 codes in 8 bits) */
    const flat = tenBit(dir, 'flat.mov', w, h, { color: '0x2060c0' });
    const ramp = tenBit(dir, 'ramp.mov', w, h, { y: (x) => Math.round(256 + (128 * x) / (w - 1)) });
    mkdirSync(join(dir, 'looks'));
    /* one LUT swaps red and blue; one stretches the gradient's span over the whole range, about 8 times */
    cube(join(dir, 'looks', 'swap.cube'), 17, (r, g, b) => [b, g, r]);
    const lo = (256 - 64) / 876, hi = (384 - 64) / 876;
    const push = (/** @type {number} */ v) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    cube(join(dir, 'looks', 'push.cube'), 33, (r, g, b) => [push(r), push(g), push(b)]);
    writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w, h }, tracks: [{ clips: [
      { id: 'flat', src: 'flat.mov', at: 0, time: [0, 0.5], style: '--of-lut: url(looks/swap.cube)' },
      { id: 'ramp', src: 'ramp.mov', at: 0.5, time: [0, 0.5], style: '--of-lut: url(looks/push.cube)' },
    ] }] }));
    const done = await render([dir], { out: join(dir, 'out.mp4'), workers: 1, silent: true, onProgress() {} });
    const seek = join(dir, '.film/cache/seek');
    /* each clip plays its file's first half second: its copy is of that part (and a second after it) */
    const copyOf = (/** @type {string} */ file, /** @type {string} */ lut) => join(seek, `${gradeKey(file, [join(dir, 'looks', lut)], false, gradeRange([0, 0.5]))}.mp4`);
    assert.ok(existsSync(copyOf(flat, 'swap.cube')) && existsSync(copyOf(ramp, 'push.cube')), 'each graded clip has its graded copy');
    assert.deepEqual(readdirSync(seek).filter((f) => f.endsWith('.mp4')).length, 2, `and no other: ProRes graded needs no copy as it is: ${readdirSync(seek).join(', ')}`);
    const tags = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt,color_space,color_transfer,color_primaries', '-of', 'csv=p=0', copyOf(ramp, 'push.cube')]).toString().trim();
    assert.equal(tags, 'yuv420p,bt709,iec61966-2-1,bt709', '8-bit, BT.709, with sRGB\'s transfer');
    /* the colour, as the LUT says: red and blue swapped */
    const [r, g, b] = rgbAt(done.out, 0.25, w, h)(w / 2, h / 2);
    assert.ok(Math.abs(r - 0xc0) < 12 && Math.abs(g - 0x60) < 12 && Math.abs(b - 0x20) < 12, `the graded colour: ${r},${g},${b}`);
    /* and as look shows it */
    const seen = rgbAt((await look([dir, '0.25'])).files[0], 0, w, h)(w / 2, h / 2);
    assert.ok(Math.abs(seen[0] - 0xc0) < 12 && Math.abs(seen[1] - 0x60) < 12 && Math.abs(seen[2] - 0x20) < 12, `look's colour: ${seen}`);
    /* the gradient: as fine as graded at 10 bits (ffmpeg, in 16-bit RGB, cut to 8 once), far finer than graded after
       the 8-bit copy a browser plays today */
    const lut = (/** @type {string} */ f) => `scale=in_color_matrix=bt709,format=gbrp16le,lut3d=file=${relative(dirname(f), join(dir, 'looks', 'push.cube')).split(sep).join('/')}:interp=tetrahedral,`;
    const ideal = gradientOf(rgbAt(ramp, 0, w, h, lut(ramp)), w, h);
    const plain = /** @type {string} */ ((await seekableCopies([ramp], dir, { plays: async () => false, slow: false })).get(ramp));
    const eightBitFirst = gradientOf(rgbAt(plain, 0, w, h, lut(plain)), w, h);
    const copy = gradientOf(rgbAt(copyOf(ramp, 'push.cube'), 0, w, h), w, h);
    const drawn = gradientOf(rgbAt(done.out, 0.75, w, h), w, h);
    const said = JSON.stringify({ ideal, eightBitFirst, copy, drawn });
    assert.ok(eightBitFirst.step >= 6 && eightBitFirst.bands >= 0.3, `graded after 8 bits, the gradient breaks into bands: ${said}`);
    assert.ok(ideal.step <= 2.5 && ideal.bands <= 0.05, `graded at 10 bits, it does not: ${said}`);
    for (const got of [copy, drawn]) assert.ok(got.step <= ideal.step + 3 && got.bands <= 0.1, `nor through the graded copy: ${said}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a clip playing a part of a long file gets a graded copy of that part only, and plays it at the right seconds, drawn or read straight', { ...ffmpeg, timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-seekable-range-'));
  try {
    const w = 320, h = 180;
    /* red for its first six seconds, blue for the four after */
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=red:size=${w}x${h}:rate=30:d=6`, '-f', 'lavfi', '-i', `color=c=blue:size=${w}x${h}:rate=30:d=4`,
      '-filter_complex', '[0][1]concat=n=2:v=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', join(dir, 'long.mp4')]);
    cube(join(dir, 'swap.cube'), 17, (r, g, b) => [b, g, r]);
    /* 5.5 to 6.5 s of it: red then blue, swapped by the grade to blue then red */
    writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w, h }, tracks: [{ clips: [{ id: 'part', src: 'long.mp4', at: 0, time: [5.5, 6.5], style: '--of-lut: url(swap.cube)' }] }] }));
    for (const straight of [true, false]) {
      const done = await render([dir], { out: join(dir, `out-${straight}.mp4`), workers: 1, silent: true, straight, onProgress() {} });
      const at = (/** @type {number} */ t) => rgbAt(done.out, t, w, h)(w / 2, h / 2);
      const [early, late] = [at(0.2), at(0.8)];
      assert.ok(early[2] > 200 && early[0] < 60, `${straight ? 'read straight' : 'drawn'}: at 5.7 s of the file, red graded blue: ${early}`);
      assert.ok(late[0] > 200 && late[2] < 60, `${straight ? 'read straight' : 'drawn'}: at 6.3 s of the file, blue graded red: ${late}`);
    }
    const key = /** @type {string} */ (gradeKey(join(dir, 'long.mp4'), [join(dir, 'swap.cube')], false, gradeRange([5.5, 6.5])));
    const copy = join(dir, '.film/cache/seek', `${key}.mp4`);
    const length = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', copy]).toString());
    assert.ok(Math.abs(length - 4) < 0.1, `a copy of 4.5 to 7.5 s rounded out to whole seconds (4 to 8), not of all ten: ${length}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a list naming a color transform file is evaluated whole into one LUT: the copy is graded by it, and changing a file makes another', { ...ffmpeg, timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-seekable-ctf-'));
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x808080:size=320x180:rate=30', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'grey.mp4')]);
    const ctf = (/** @type {number} */ slope) => `<?xml version="1.0" encoding="UTF-8"?>
<ProcessList version="2.5" id="t">
  <ASC_CDL inBitDepth="32f" outBitDepth="32f" style="Fwd"><SOPNode><Slope>${slope} 1 0.5</Slope><Offset>0 0 0</Offset><Power>1 1 1</Power></SOPNode></ASC_CDL>
</ProcessList>
`;
    writeFileSync(join(dir, 'warm.ctf'), ctf(1.25));
    const file = join(dir, 'grey.mp4'), luts = [join(dir, 'warm.ctf')];
    const key = /** @type {string} */ (gradeKey(file, luts));
    const copy = (await gradedCopies([{ file, luts }], dir)).get(key);
    assert.ok(copy, 'made');
    const [r, g, b] = rgbAt(/** @type {string} */ (copy), 0.5, 320, 180)(160, 90);
    /* 128 (mid grey) by the CDL's slopes: red up a quarter, blue halved */
    assert.ok(Math.abs(r - 160) < 6 && Math.abs(g - 128) < 6 && Math.abs(b - 64) < 6, `graded by the file: ${r},${g},${b}`);
    assert.ok(readdirSync(join(dir, '.film/cache/seek')).some((f) => /^grade-[0-9a-f]{16}\.cube$/.test(f)), 'the list baked into one LUT');
    writeFileSync(join(dir, 'warm.ctf'), ctf(1));
    assert.notEqual(gradeKey(file, luts), key, 'a file changed in place makes another copy');
    writeFileSync(join(dir, 'bad.ctf'), '<ProcessList><Nonsense/></ProcessList>');
    const failed = [];
    await gradedCopies([{ file, luts: [join(dir, 'bad.ctf')] }], dir, { failed: (grade) => failed.push(grade.file) });
    assert.deepEqual(failed, [file], 'one that can\'t be evaluated is said');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a graded copy is named by its LUTs\' contents: a LUT changed in place makes another; one ffmpeg can\'t read is said, and its clip drawn as it is', { ...ffmpeg, timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-seekable-graded-key-'));
  try {
    const file = join(dir, 'a.mp4');
    clip(file, 5);
    const lut = cube(join(dir, 'a.cube'), 2, (r, g, b) => [b, g, r]);
    const before = gradeKey(file, [lut]);
    assert.match(String(before), /^[0-9a-f]{12}$/);
    assert.notEqual(gradeKey(file, [lut], true), before, 'a master export\'s is another');
    assert.notEqual(gradeKey(file, [lut, lut]), before, 'twice is another grade');
    const copies = await gradedCopies([{ file, luts: [lut] }], dir);
    assert.equal(copies.get(/** @type {string} */ (before)), join(dir, '.film/cache/seek', `${before}.mp4`));
    assert.deepEqual(times(/** @type {string} */ (copies.get(/** @type {string} */ (before)))), times(file), 'the same frames at the same times');
    /* a master export's, on the processor near lossless (as a copy on a computer without the chip's encoder) */
    const fine = await gradedCopies([{ file, luts: [lut] }], dir, { fine: true });
    assert.deepEqual(times(/** @type {string} */ (fine.get(/** @type {string} */ (gradeKey(file, [lut], true))))), times(file));
    cube(lut, 2, (r, g, b) => [g, b, r]);
    assert.notEqual(gradeKey(file, [lut]), before);
    assert.equal(gradeKey(file, [join(dir, 'gone.cube')]), null);
    writeFileSync(join(dir, 'bad.cube'), 'not a LUT\n');
    const failed = [];
    const none = await gradedCopies([{ file, luts: [join(dir, 'bad.cube')] }], dir, { failed: (grade) => failed.push(grade.file) });
    assert.equal(none.size, 0);
    assert.deepEqual(failed, [file]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2060c0:size=320x180:rate=30', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'flat.mp4')]);
    writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'v', src: 'flat.mp4', at: 0, time: [0, 1], style: '--of-lut: url(bad.cube)' }] }] }));
    const done = await render([dir, '0-0.5'], { out: join(dir, 'out.mp4'), workers: 1, silent: true, onProgress() {} });
    assert.ok(done.lines.some((line) => line.startsWith('✗ copy: ') && line.includes('flat.mp4')), done.lines.join('\n'));
    const [r, g, b] = rgbAt(done.out, 0.2, 320, 180)(160, 90);
    assert.ok(Math.abs(r - 0x20) < 16 && Math.abs(g - 0x60) < 16 && Math.abs(b - 0xc0) < 16, `drawn as it is: ${r},${g},${b}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a video clip without --of-lut gets the same copy as ever, named as ever, and no graded one', ffmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-seekable-ungraded-'));
  try {
    const file = join(dir, 'slow.mp4');
    clip(file, 120);
    writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'v', src: 'slow.mp4', at: 0, time: [0, 3], style: 'opacity: 0.9' }] }] }));
    await render([dir], { out: join(dir, 'out.mp4'), workers: 1, silent: true, onProgress() {} });
    const stat = statSync(file);
    const named = `${hash(Buffer.from(`3\0${file}\0${stat.size}\0${stat.mtimeMs}`))}.mp4`;
    assert.deepEqual(readdirSync(join(dir, '.film/cache/seek')).filter((f) => !f.includes('.part')), [named]);
    assert.equal(madeCopy(file, dir), join(dir, '.film/cache/seek', named));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
