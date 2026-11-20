import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { alike, apart, footageOf, straight, straightGraph, straightPlan, straightRuns } from './direct.mjs';
import { filmHtml } from './film-doc.mjs';
import { exactRate } from './rate.mjs';
import { render } from './render.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const ffmpeg = { skip: !hasFfmpeg && 'no ffmpeg', timeout: 180_000 };

const STREAM = { codec_name: 'h264', pix_fmt: 'yuv420p', width: 1920, height: 1080, sample_aspect_ratio: '1:1', field_order: 'progressive', color_space: 'bt709', color_transfer: 'bt709', color_primaries: 'bt709', color_range: 'tv' };

test('footage read straight is 8-bit 4:2:0 in BT.709 or BT.601, whole frames, square pixels; HDR, ten bits and fields are the browser\'s', () => {
  assert.deepEqual(footageOf(STREAM), { codec: 'h264', pix: 'yuv420p', w: 1920, h: 1080, range: 'tv', matrix: 'bt709', srgb: false, tone: 'none' });
  /* nothing said: a browser takes 720 lines and more for BT.709, fewer for BT.601 */
  const unsaid = { ...STREAM, color_space: 'unknown', color_transfer: 'unknown', color_primaries: 'unknown', color_range: 'unknown' };
  assert.equal(footageOf(unsaid)?.matrix, 'bt709');
  assert.equal(footageOf({ ...unsaid, width: 640, height: 480 })?.matrix, 'bt601');
  assert.equal(footageOf({ ...STREAM, color_space: 'bt470bg' })?.matrix, 'bt601');
  /* a screen recording: sRGB's transfer; a phone's full range */
  assert.equal(footageOf({ ...STREAM, color_transfer: 'iec61966-2-1' })?.srgb, true);
  assert.equal(footageOf({ ...STREAM, pix_fmt: 'yuvj420p', color_range: 'pc' })?.range, 'pc');
  for (const other of [{ pix_fmt: 'yuv420p10le' }, { pix_fmt: 'yuva420p' }, { pix_fmt: 'yuv422p' }, { color_transfer: 'arib-std-b67' }, { color_transfer: 'smpte2084' },
    { color_space: 'bt2020nc' }, { color_primaries: 'bt2020' }, { field_order: 'tt' }, { sample_aspect_ratio: '4:3' }, { width: 0 }]) {
    assert.equal(footageOf({ ...STREAM, ...other }), null, JSON.stringify(other));
  }
  assert.equal(footageOf(null), null);
});

const FOOTAGE = { codec: 'h264', pix: 'yuv420p', w: 1920, h: 1080, range: 'tv', matrix: 'bt709', srgb: false, tone: 'none' };
const video = (id, track, at, end, more = {}) => ({ id, kind: 'video', track, at, end, from: 0, speed: 1, file: `/f/${id}.mp4`, fit: 'contain', own: { w: 1920, h: 1080 }, footage: { ...FOOTAGE }, ...more });
const film = (layers, more = {}) => ({ stage: { w: 1920, h: 1080 }, ground: '0x000000', layers, captions: { tracks: [], still: true }, ...more });

test('a plan: one plain video filling the stage with nothing over it, cut where its clips are; the bare stage between them', () => {
  /* two clips that touch, the second from 2 s into its file at double speed, then nothing, at 30 fps */
  const cut = film([video('a', 0, 0, 2), video('b', 0, 2, 3, { from: 2, speed: 2 })]);
  const plan = straightPlan(cut, 30, 120, 30, 4);
  assert.deepEqual(plan.segments.map((s) => ('gap' in s ? 'gap' : s.file.slice(3))), ['a.mp4', 'b.mp4', 'gap']);
  assert.deepEqual(plan.segments.map((s) => s.frames), [30, 30, 30]);
  assert.equal(plan.frames, 90);
  /* each segment's first frame shows its file's second for that moment: 1 s into a, the start of b's part */
  assert.equal(plan.segments[0].want, 1);
  assert.equal(plan.segments[1].want, 2);
  assert.equal(plan.segments[1].speed, 2);
  assert.deepEqual(plan.files, ['/f/a.mp4', '/f/b.mp4']);
  /* clips that touch to a rounding are both on for a moment: the later one is the picture, as the page paints it */
  const touching = film([video('a', 0, 0, 2.0000000000000004), video('b', 0, 2, 3)]);
  assert.equal(straightPlan(touching, 60, 61, 30, 3).segments[0].file, '/f/b.mp4');
  /* a stage that is not a plain color is drawn where no clip covers it */
  assert.equal(straightPlan({ ...cut, ground: null }, 90, 120, 30, 4), null);
  assert.ok(straightPlan({ ...cut, ground: null }, 0, 90, 30, 4));
});

test('what a browser has to draw: a clip that is not plain footage, anything over the footage, bars with something behind them', () => {
  const page = { id: 'title', kind: 'page', track: 0, at: 1, end: 2, from: 0, speed: 1, file: null, fit: 'contain', own: { w: 1920, h: 1080 }, footage: null };
  const under = film([page, video('a', 1, 0, 3)]);
  assert.ok(straightPlan(under, 0, 30, 30, 3));
  assert.equal(straightPlan(under, 0, 60, 30, 3), null, 'a title over it');
  /* footage on top hides what is under it, when it covers the stage */
  const over = film([video('a', 0, 0, 3), { ...page, track: 1 }]);
  assert.ok(straightPlan(over, 0, 90, 30, 3));
  /* a picture that leaves bars shows what is behind them: alone it is read straight, with its bars the stage's color */
  const tall = video('tall', 0, 0, 3, { own: { w: 1080, h: 1920 } });
  assert.equal(straightPlan(film([tall]), 0, 30, 30, 3).segments[0].bars, true);
  assert.equal(straightPlan(film([tall, { ...page, track: 1 }]), 30, 60, 30, 3), null);
  assert.equal(straightPlan(film([tall], { ground: null }), 0, 30, 30, 3), null);
  /* cropped to cover, it hides everything */
  const covering = { ...tall, fit: 'cover' };
  assert.equal(straightPlan(film([covering, { ...page, track: 1 }]), 30, 60, 30, 3).segments[0].bars, false);
  /* footage a browser shows its own way (its file refused) */
  assert.equal(straightPlan(film([video('a', 0, 0, 3, { footage: null })]), 0, 30, 30, 3), null);
});

test('captions over the footage: the cues on are one picture for as long as they are; cues that move, or under a clip, are drawn', () => {
  const cues = [{ start: 0.5, end: 1.5 }, { start: 1.5, end: 2 }, { start: 2.5, end: 2.8 }];
  const said = film([video('a', 1, 0, 3)], { captions: { tracks: [{ track: 0, cues }], still: true } });
  const plan = straightPlan(said, 0, 90, 30, 3);
  assert.deepEqual(plan.overlays, [
    { key: '0:0', runs: [[15, 45]], at: 15 },
    { key: '0:1', runs: [[45, 60]], at: 45 },
    { key: '0:2', runs: [[75, 84]], at: 75 },
  ]);
  /* a plan from the film's 30th frame counts its own frames, and draws each picture at the film's */
  assert.deepEqual(straightPlan(said, 30, 60, 30, 3).overlays, [{ key: '0:0', runs: [[0, 15]], at: 30 }, { key: '0:1', runs: [[15, 30]], at: 45 }]);
  /* two tracks on at once are one picture */
  const two = film([video('a', 2, 0, 3)], { captions: { tracks: [{ track: 0, cues: [cues[0]] }, { track: 1, cues: [{ start: 1, end: 2 }] }], still: true } });
  assert.deepEqual(straightPlan(two, 0, 90, 30, 3).overlays.map((o) => o.key), ['0:0', '0:0 1:0', '1:0']);
  /* words lit as they are said: every frame is another picture */
  assert.equal(straightPlan({ ...said, captions: { ...said.captions, still: false } }, 0, 90, 30, 3), null);
  assert.ok(straightPlan({ ...said, captions: { ...said.captions, still: false } }, 0, 15, 30, 3), 'the frames with no cue on are still read straight');
  /* a caption track under the footage is not over it */
  assert.equal(straightPlan(film([video('a', 0, 0, 3)], { captions: { tracks: [{ track: 1, cues }], still: true } }), 0, 90, 30, 3), null);
});

test('a film in runs: footage alone from one whole second to another, the rest drawn; a short stretch of footage drawn with it', () => {
  const page = { id: 'title', kind: 'page', track: 0, at: 4.4, end: 6.2, from: 0, speed: 1, file: null, fit: 'contain', own: { w: 1920, h: 1080 }, footage: null };
  const cut = film([page, video('a', 1, 0, 12)]);
  const runs = straightRuns(cut, 0, 360, 30, 12, { grid: 30, least: 30 });
  /* the title is on over frames 132 to 185: drawn from second 4 to second 7 */
  assert.deepEqual(runs, [{ a: 0, b: 120, straight: true }, { a: 120, b: 210, straight: false }, { a: 210, b: 360, straight: true }]);
  /* a render from the 3rd second counts its seconds from there, and ends where it ends */
  assert.deepEqual(straightRuns(cut, 100, 355, 30, 12, { grid: 30, least: 30 }),
    [{ a: 100, b: 130, straight: true }, { a: 130, b: 190, straight: false }, { a: 190, b: 355, straight: true }]);
  /* footage for less than a second between two titles is drawn with them */
  const busy = film([page, { ...page, id: 'title2', at: 6.8, end: 8 }, video('a', 1, 0, 12)]);
  assert.deepEqual(straightRuns(busy, 0, 360, 30, 12, { grid: 30, least: 30 }).map((r) => [r.a, r.b, r.straight]), [[0, 120, true], [120, 240, false], [240, 360, true]]);
  assert.deepEqual(straightRuns(film([page]), 0, 360, 30, 12, { grid: 30, least: 30 }).filter((r) => !r.straight), [{ a: 120, b: 210, straight: false }]);
});

/** A file of footage whose every frame says its own number: a gray that brightens by two levels a frame (up to 109 frames: a video's white). */
function numbered(file, fps, frames, size = '1280x720') {
  /* Declare the source's color space too: an implicit YUV conversion can change the levels that identify frames. */
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=gray:s=${size}:r=${fps},format=yuv420p,geq=lum='16+2*N':cb=128:cr=128,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv`,
    '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-g', '12', '-bf', '2', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', file]);
}
/** The number each frame of a file says (see numbered). */
function numbers(file) {
  const out = execFileSync('ffmpeg', ['-hide_banner', '-i', file, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return [...out.matchAll(/YAVG=([\d.]+)/g)].map((m) => Math.round((Number(m[1]) - 16) / 2));
}
const LOSSLESS = { video: ['-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0'], pix: 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p' };

test('read straight, each of the film\'s frames is the footage\'s frame on screen at that moment: across rates, speeds and cuts', ffmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-straight-'));
  try {
    const at24 = join(dir, '24.mp4'), at60 = join(dir, '60.mp4');
    const at30 = join(dir, '30.mp4');
    for (const [file, fps, frames] of [[at24, 24, 96], [at60, 60, 100], [at30, 30, 100]]) {
      numbered(file, fps, frames);
      assert.deepEqual(numbers(file), Array.from({ length: frames }, (_, n) => n), `${fps} fps fixture preserves its frame numbers`);
    }
    const segment = (file, want, speed, frames) => ({ file, range: 'tv', matrix: 'bt709', tone: 'none', fit: 'contain', bars: false, want, speed, frames });
    /* the frame on screen a millisecond after the moment asked (host.mjs SEEK_INSIDE_FRAME), as a browser shows it */
    const shown = (want, speed, n, fps, of) => Math.floor((want + (n / fps) * speed + 0.001) * of);
    for (const [name, rate, plan, expected] of [
      ['24 fps footage in a 30 fps film, from its start', 30, [segment(at24, 0, 1, 40)], (n) => shown(0, 1, n, 30, 24)],
      ['from the middle of a group of pictures', 30, [segment(at24, 1.3, 1, 30)], (n) => shown(1.3, 1, n, 30, 24)],
      ['60 fps footage at double speed', 30, [segment(at60, 0.25, 2, 20)], (n) => shown(0.25, 2, n, 30, 60)],
      ['at half speed, in a 29.97 fps film', 29.97, [segment(at24, 0.5, 0.5, 45)], (n) => shown(0.5, 0.5, n, 30000 / 1001, 24)],
      ['a cut from one file to another', 30, [segment(at24, 2, 1, 15), segment(at60, 1, 1, 15)], (n) => (n < 15 ? shown(2, 1, n, 30, 24) : shown(1, 1, n - 15, 30, 60))],
      ['held on its last frame past its end', 30, [segment(at24, 3.8, 1, 12)], (n) => Math.min(95, shown(3.8, 1, n, 30, 24))],
      /* 30 fps footage in a 29.97 fps film: its 56th frame begins at the very moment the film's 10th asks for, and a
         browser still shows the one before */
      ['a frame that begins at the moment asked is not on screen yet', 29.97, [segment(at30, 1.532, 1, 12)], (n) => (n === 10 ? 55 : shown(1.532, 1, n, 30000 / 1001, 30))],
    ]) {
      const frames = plan.reduce((n, s) => n + s.frames, 0);
      const out = join(dir, 'out.mp4');
      await straight({ segments: plan, frames, files: [...new Set(plan.map((s) => s.file))], overlays: [] }, out, { size: { w: 1280, h: 720 }, rate: exactRate(rate), ground: '0x000000', format: LOSSLESS });
      assert.deepEqual(numbers(out), Array.from({ length: frames }, (_, n) => expected(n)), name);
    }
    /* the bare stage, in the stage's color, between two clips */
    const gap = join(dir, 'gap.mp4');
    await straight({ segments: [segment(at24, 0, 1, 3), { gap: true, frames: 4 }, segment(at24, 1, 1, 3)], frames: 10, files: [at24], overlays: [] }, gap,
      { size: { w: 1280, h: 720 }, rate: exactRate(30), ground: '0x000000', format: LOSSLESS });
    assert.deepEqual(numbers(gap), [0, 0, 1, 0, 0, 0, 0, 24, 24, 25]);
    /* a file that is not there is an error, for the part to be drawn in a browser */
    await assert.rejects(straight({ segments: [segment(join(dir, 'none.mp4'), 0, 1, 3)], frames: 3, files: [], overlays: [] }, join(dir, 'no.mp4'),
      { size: { w: 1280, h: 720 }, rate: exactRate(30), ground: '0x000000', format: LOSSLESS }), /ffmpeg/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a picture is fitted to the stage as CSS fits it, and a frame drawn another way is told apart', ffmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-straight-fit-'));
  try {
    /* a picture taller than the stage: a quarter of it white, the rest gray */
    const tall = join(dir, 'tall.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=gray:s=720x1280:r=30,drawbox=x=0:y=0:w=720:h=320:color=white:t=fill',
      '-frames:v', '10', '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', tall]);
    const one = (fit, bars) => ({ segments: [{ file: tall, range: 'tv', matrix: 'bt709', tone: 'none', fit, bars, want: 0, speed: 1, frames: 1 }], frames: 1, files: [tall], overlays: [] });
    const how = { stage: { w: 1280, h: 720 }, rate: exactRate(30), ground: '0x204060' };
    /* the frame as RGB, rounded exactly: the fast conversions on some processors are a level off everywhere */
    const png = (plan, more = '') => {
      const { inputs, graph } = straightGraph(plan, { size: how.stage, rate: how.rate, ground: how.ground });
      return execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', `${graph};[film]scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags=accurate_rnd+full_chroma_int,format=rgb24${more}[out]`,
        '-map', '[out]', '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-'], { maxBuffer: 1 << 26 });
    };
    /* contained, it stands in the middle with the stage's color beside it; covering, its middle fills the stage */
    const contained = png(one('contain', true), ',crop=8:8:8:8');
    const pixel = (buf) => [...execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-i', '-', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { input: buf }).subarray(0, 3)];
    assert.deepEqual(pixel(contained).map((v) => Math.round(v / 4)), [0x20, 0x40, 0x60].map((v) => Math.round(v / 4)), 'the bars are the stage\'s color');
    assert.equal(pixel(png(one('contain', true), ',crop=8:8:636:8'))[0] > 240, true, 'its top, white, in the middle');
    assert.equal(Math.abs(pixel(png(one('cover', false), ',crop=8:8:8:8'))[0] - 128) < 6, true, 'covering: the gray of its middle, edge to edge');
    /* the frame as a browser would draw it is the same picture; with a corner rounded, a tint or a fade it is another */
    const drawn = png(one('cover', false));
    assert.equal(await alike(one('cover', false), drawn, how), true);
    assert.deepEqual(await apart(one('cover', false), drawn, how).then((far) => far && [far.most < 3, far.mean < 1]), [true, true]);
    for (const [look, filter] of [['a corner cut', ',drawbox=x=0:y=0:w=40:h=40:color=black:t=fill'], ['dimmed', ',lutrgb=r=val*0.93:g=val*0.93:b=val*0.93'], ['another fit', null]]) {
      const other = filter ? png(one('cover', false), filter) : png(one('contain', true));
      assert.equal(await alike(one('cover', false), other, how), false, look);
    }
    /* captions laid over it: a picture with alpha, on at the frames its cues are */
    const cue = join(dir, 'cue.png');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', "color=white:s=1280x720,format=rgba,geq=r=255:g=255:b=255:a='255*between(X,320,960)*between(Y,600,660)'", '-frames:v', '1', cue]);
    const captioned = { segments: [{ ...one('cover', false).segments[0], frames: 6 }], frames: 6, files: [tall], overlays: [{ key: '0:0', runs: [[2, 4]], at: 2 }] };
    const out = join(dir, 'captioned.mp4');
    await straight(captioned, out, { size: how.stage, rate: how.rate, ground: how.ground, format: LOSSLESS, pictures: new Map([['0:0', cue]]) });
    const band = execFileSync('ffmpeg', ['-hide_banner', '-i', out, '-vf', 'crop=600:40:340:610,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.deepEqual([...band.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]) > 200), [false, false, true, true, false, false]);
    await assert.rejects(straight(captioned, out, { size: how.stage, rate: how.rate, ground: how.ground, format: LOSSLESS }), /no picture for the captions/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a film of footage, a title and captions renders to the same frames with its footage read straight as with every frame drawn', ffmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-straight-film-'));
  try {
    mkdirSync(join(dir, 'assets'));
    mkdirSync(join(dir, 'captions'));
    /* footage that moves: a pattern, and the same slid along; a title for a second over the first */
    for (const [name, source] of [['a', 'testsrc2=size=1280x720:rate=24'], ['b', 'testsrc=size=1280x720:rate=30']]) {
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', source, '-t', '4', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p',
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', join(dir, 'assets', `${name}.mp4`)]);
    }
    writeFileSync(join(dir, 'title.html'), '<!doctype html><body style="margin:0"><div id="t" style="position:absolute;left:80px;top:80px;width:400px;height:120px;background:#e33"></div>'
      + '<script>window.film = { duration: 1, width: 1280, height: 720, frame(t) { document.getElementById("t").style.left = `${80 + t * 300}px`; } };</script>');
    writeFileSync(join(dir, 'captions', 'en.vtt'), 'WEBVTT\n\nSTYLE\n::cue { font: 40px sans-serif; color: #fff; background: #000; }\n\n00:00:00.500 --> 00:00:01.400\nOne line\n\n00:00:03.200 --> 00:00:04.600\nAnother, over the cut\n');
    writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 1280, h: 720 }, tracks: [
      { captions: { src: 'captions/en.vtt', kind: 'captions' }, clips: [] },
      { clips: [{ id: 'title', src: 'title.html', at: 2 }] },
      { clips: [{ id: 'a', src: 'assets/a.mp4', time: [0.5, 4], volume: 0 }, { id: 'b', src: 'assets/b.mp4', time: [1, 3], at: 3.5, speed: 2, volume: 0 }] },
    ] }));
    const quiet = { silent: true, onProgress() {}, workers: 1, fine: true, format: { ...LOSSLESS, tag: [] } };
    const read = await render([dir], { ...quiet, out: join(dir, 'straight.mp4') });
    const drawn = await render([dir], { ...quiet, out: join(dir, 'drawn.mp4'), straight: false });
    assert.equal(drawn.straight, undefined);
    assert.ok(drawn.lines.every((l) => !/read straight/.test(l)));
    /* a browser that shows this footage in a way not known here draws it all, and the film is the same film */
    if (process.platform === 'darwin') assert.equal(read.straight, 105, 'every second but the title\'s: 0 to 2 and 3 to 4.5');
    if (read.straight) assert.ok(read.lines.includes(`  ${read.straight} of them read straight from the footage`), read.lines.join('\n'));
    const log = join(dir, 'psnr.log');
    /* named from its folder: a filter's argument would take a Windows path's drive colon and backslashes as its own */
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', read.out, '-i', drawn.out, '-lavfi', 'psnr=stats_file=psnr.log', '-f', 'null', '-'], { cwd: dir });
    const frames = readFileSync(log, 'utf8').trim().split('\n').map((l) => (/psnr_avg:inf/.test(l) ? 99 : Number(/psnr_avg:([\d.]+)/.exec(l)?.[1])));
    assert.equal(frames.length, 135);
    /* another frame of this footage, a caption missing or a cut a frame off is under 25 dB */
    assert.ok(Math.min(...frames) > 30, `the frame furthest apart: ${Math.min(...frames)} dB at ${frames.indexOf(Math.min(...frames))}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
