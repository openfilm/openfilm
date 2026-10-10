import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExports, exportCapabilities, exportsRoot, ExportError, frameBox, dimsForShortEdge, projectFiles, projectSizes } from './exports.mjs';
import { allocateLanes, containMotion, fadeKeyframes, frameSpan, nleRate, planNleTimeline, xmemlDocument } from './nle.mjs';
import { pptxParts } from './slides.mjs';
import { filmSubtitleSrt, parseFilmSubtitleStyle } from './film-subtitle.mjs';
import { zipFiles } from './zip.mjs';
import { launch } from '../../src/host.mjs';
import { filmHtml } from '../../src/film-doc.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const ffmpeg = { skip: !hasFfmpeg && 'no ffmpeg', timeout: 120_000 };
let root, scratch;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'of-exports-'));
  process.env.OPENFILM_EXPORTS = join(scratch, 'Exports');
  root = join(scratch, 'Tiny');
  mkdirSync(join(root, 'assets', 'audio', 'sfx'), { recursive: true });
  mkdirSync(join(root, 'assets', 'audio', 'music'), { recursive: true });
  writeFileSync(join(root, 'title.html'), `<!doctype html><body style="margin:0;background:#123"><div id="t" style="font:60px sans-serif;color:#fff">Hi</div>
<script>window.film={duration:1,width:320,height:180,frame(t){document.getElementById('t').style.marginLeft=(t*100)+'px'}}</script></body>`);
  /* a badge on a transparent page: what a transparent export of one clip is for */
  writeFileSync(join(root, 'badge.html'), `<!doctype html><body style="margin:0"><div style="position:absolute;left:100px;top:50px;width:80px;height:60px;background:#f80"></div>
<script>window.film={duration:0.5,width:320,height:180,frame(t){}}</script></body>`);
  if (hasFfmpeg) {
    const tone = (hz, file) => execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=1`, join(root, file)]);
    tone(330, 'assets/tone.wav');
    tone(660, 'assets/audio/sfx/click.wav');
    tone(220, 'assets/audio/music/bed.wav');
  }
  writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [
    { clips: [{ src: 'badge.html', id: 'badge', at: 0.5 }] },
    { clips: [{ src: 'title.html', id: 'title' }] },
    { clips: [{ src: 'assets/tone.wav', id: 'tone' }, { src: 'assets/audio/sfx/click.wav', id: 'click', at: 0.5, time: [0, 0.3] }] },
    { clips: [{ src: 'assets/audio/music/bed.wav', id: 'bed', volume: 0.5 }] },
  ] }));
});

const project = (name = 'Tiny', path = root) => ({ id: 'p', name, path });
const CUES = [{ startMs: 0, durMs: 900, text: 'Hello there', speaker: 'Ann' }, { startMs: 800, durMs: 800, text: 'And welcome' }];
/* the person turned subtitles off in the editor: an export asked to burn them still does */
const subtitles = async () => ({ cues: CUES, style: { ...parseFilmSubtitleStyle(null), on: false } });
const until = (exports, id, done) => new Promise((resolve) => {
  const tick = () => { const job = exports.list('p').find((j) => j.id === id); if (done(job)) resolve(job); else setTimeout(tick, 50); };
  tick();
});
const ended = (exports, job) => until(exports, job.id, (j) => ['done', 'failed', 'cancelled'].includes(j.status));
/** Run one export to its end; it has to succeed. */
async function exported(ask, name, path = root) {
  const exports = createExports({ captions: subtitles });
  const done = await ended(exports, exports.start(project(name, path), ask));
  assert.equal(done.status, 'done', done.error);
  return done;
}
const probe = (file, entries) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', entries, '-of', 'csv=p=0', file]).toString().trim().replace(/,+$/, '');
/** The first frame's pixels, as RGB rows. */
function firstFrame(file) {
  const [w, h] = probe(file, 'stream=width,height').split(',').map(Number);
  const rgb = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  return { w, h, at: (x, y) => [...rgb.subarray((y * w + x) * 3, (y * w + x) * 3 + 3)] };
}
const near = (rgb, want, by = 14) => rgb.every((v, i) => Math.abs(v - want[i]) <= by);
/** The names in a zip, from its central directory. */
function zipNames(file) {
  const buf = readFileSync(file);
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = buf.readUInt32LE(end + 16);
  const names = [];
  for (let n = buf.readUInt16LE(end + 10); n > 0; n--) {
    const len = buf.readUInt16LE(at + 28);
    names.push(buf.subarray(at + 46, at + 46 + len).toString('utf8'));
    at += 46 + len + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return { names, buf };
}
/** The entries of a stored zip, by name. */
function zipEntries(file) {
  const buf = readFileSync(file);
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = buf.readUInt32LE(end + 16);
  const out = new Map();
  for (let n = buf.readUInt16LE(end + 10); n > 0; n--) {
    const len = buf.readUInt16LE(at + 28);
    const size = buf.readUInt32LE(at + 20);
    const local = buf.readUInt32LE(at + 42);
    const data = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    out.set(buf.subarray(at + 46, at + 46 + len).toString('utf8'), buf.subarray(data, data + size));
    at += 46 + len + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return out;
}
/** Each text parsed as XML by Chromium: null when well formed, else what is wrong; and `query(text)` run on each document. */
async function parseXml(texts, query = () => null) {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    return await page.evaluate(([list, fn]) => list.map((text) => {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      const error = doc.getElementsByTagName('parsererror')[0];
      return { error: error ? error.textContent : null, found: error ? null : new Function('doc', `return (${fn})(doc)`)(doc) };
    }), [texts, String(query)]);
  } finally {
    await browser.close();
  }
}
const frameCount = (file) => parseInt(execFileSync('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file]).toString(), 10);

test('the exports folder: OPENFILM_EXPORTS, else `exports` in OPENFILM_HOME, else the Movies folder', () => {
  const env = { exports: process.env.OPENFILM_EXPORTS, home: process.env.OPENFILM_HOME };
  try {
    delete process.env.OPENFILM_EXPORTS;
    process.env.OPENFILM_HOME = join(scratch, 'home');
    assert.equal(exportsRoot(), join(scratch, 'home', 'exports'));
    process.env.OPENFILM_EXPORTS = join(scratch, 'Mine');
    assert.equal(exportsRoot(), join(scratch, 'Mine'));
    delete process.env.OPENFILM_EXPORTS;
    delete process.env.OPENFILM_HOME;
    assert.equal(exportsRoot(), join(homedir(), process.platform === 'darwin' ? 'Movies' : 'Videos', 'OpenFilm', 'Exports'));
  } finally {
    for (const [key, value] of [['OPENFILM_EXPORTS', env.exports], ['OPENFILM_HOME', env.home]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('a video export is render: an MP4 named after the project, with progress, never over an earlier one', ffmpeg, async () => {
  const seen = [];
  const exports = createExports({ onChange: (job) => seen.push(job) });
  const job = exports.start(project(), { kind: 'video', fps: 24 });
  const done = await ended(exports, job);
  assert.equal(done.status, 'done', done.error);
  assert.equal(done.out, join(exportsRoot(), 'Tiny.mp4'));
  assert.deepEqual(done.outputs, [done.out]);
  assert.ok(done.bytes > 0 && done.finishedAt >= done.startedAt);
  /* the Mac's own H.264 encoder when it has one (below master), x264 otherwise; x264 when asked not to use it */
  const vt = hasFfmpeg && execFileSync('ffmpeg', ['-hide_banner', '-encoders']).toString().includes('h264_videotoolbox');
  assert.equal(done.encoder, vt ? 'h264_videotoolbox' : 'libx264');
  const soft = await ended(exports, exports.start(project('Soft'), { kind: 'video', fps: 24, range: [0, 0.25], hardware: false }));
  assert.equal(soft.status, 'done', soft.error);
  assert.equal(soft.encoder, 'libx264');
  const frames = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', done.out]).toString().trim();
  assert.equal(parseInt(frames, 10), 24);
  assert.ok(seen.some((j) => j.progress > 0 && j.progress < 1), 'progress between start and end');
  assert.ok(seen.some((j) => j.phase === 'rendering' && j.framesTotal === 24 && j.framesDone > 0), 'frames as they are drawn');

  const again = exports.start(project(), { kind: 'audio', format: 'm4a', range: [0, 0.5] });
  const sound = await ended(exports, again);
  assert.equal(sound.status, 'done', sound.error);
  assert.ok(existsSync(join(exportsRoot(), 'Tiny 0-0.5s - mix.m4a')), 'the mix, named so');
});

test('a renderer that dies fails its export with the reason, and exports go on', { ...ffmpeg, skip: ffmpeg.skip || (process.platform === 'win32' && 'no pgrep') }, async () => {
  const exports = createExports();
  const job = exports.start(project('Crash'), { kind: 'video' });
  await until(exports, job.id, (j) => j.status === 'running' && j.out);
  /* the film renders in a process of its own: ended from outside, as a crash would end it */
  let pid = '';
  for (let i = 0; i < 200 && !pid; i++) {
    pid = spawnSync('pgrep', ['-P', String(process.pid), '-f', 'render-worker'], { encoding: 'utf8' }).stdout.trim().split('\n')[0];
    if (!pid) await new Promise((r) => setTimeout(r, 25));
  }
  assert.ok(pid, 'a render process is running');
  process.kill(Number(pid), 'SIGKILL');
  const failed = await ended(exports, job);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /renderer stopped/);
  const again = exports.start(project('After'), { kind: 'video' });
  assert.equal((await ended(exports, again)).status, 'done');
});

test('a cancelled export stops and leaves no file, and a bad ask is refused before it is queued', ffmpeg, async () => {
  /** @type {any[]} */
  const seen = [];
  const exports = createExports({ onChange: (j) => seen.push(j) });
  const job = exports.start(project('Cancel'), { kind: 'video' });
  const running = await until(exports, job.id, (j) => j.status === 'running' && j.out);
  exports.cancel(job.id);
  /* said at once, before the render has stopped */
  assert.deepEqual([seen.at(-1).status, seen.at(-1).cancelling], ['running', true]);
  const stopped = await ended(exports, job);
  assert.equal(stopped.status, 'cancelled');
  assert.ok(!existsSync(running.out), 'the half-written file is gone');
  for (const bad of [{ kind: 'pdf' }, { kind: 'video', range: [3, 1] }, { kind: 'video', codec: 'av1' }, { kind: 'video', frame: '2:1' },
    { kind: 'audio', mix: false }, { kind: 'stills', range: [0, 1] }, { kind: 'gif', width: 5000 }, { kind: 'subtitles', format: 'ass' },
    { kind: 'slides', format: 'key' }, { kind: 'slides', range: [0, 1] }, { kind: 'nle', fps: 500 }, { kind: 'nle', audio: 'mix' }, { kind: 'nle', range: [0, 1] }]) {
    assert.throws(() => exports.start(project(), bad), ExportError, JSON.stringify(bad));
  }
});

test('the delivery frame: the same box as the editor, the short side asked, never past 4096', () => {
  assert.deepEqual(frameBox({ w: 1920, h: 1080 }, '9:16', 'contain'), { w: 1920, h: 3414, scale: 1 });
  assert.deepEqual(dimsForShortEdge(frameBox({ w: 1920, h: 1080 }, '9:16', 'contain'), 1080), { w: 1080, h: 1920 });
  assert.deepEqual(dimsForShortEdge({ w: 1920, h: 1080 }, 2160), { w: 3840, h: 2160 });
  assert.deepEqual(dimsForShortEdge({ w: 2520, h: 1080 }, 2160), { w: 4096, h: 1756 });
});

test('a film in another frame is fitted with bars, or fills it and is cropped', ffmpeg, async () => {
  const bars = firstFrame((await exported({ kind: 'video', frame: '9:16', shortEdge: 180, fps: 5, range: [0, 0.4] })).out);
  assert.deepEqual([bars.w, bars.h], [180, 320]);
  assert.ok(near(bars.at(90, 2), [0, 0, 0]), 'a bar above the film');
  assert.ok(near(bars.at(4, 200), [17, 34, 51]), 'the film in the middle');
  const crop = firstFrame((await exported({ kind: 'video', frame: '9:16', fill: 'cover', shortEdge: 180, fps: 5, range: [0, 0.4] })).out);
  assert.deepEqual([crop.w, crop.h], [180, 320]);
  assert.ok(near(crop.at(170, 2), [17, 34, 51]), 'the film to the edge: no bar');
});

test('each codec this machine encodes, at the size asked, transparent where the codec can be', ffmpeg, async () => {
  const can = await exportCapabilities();
  const codecs = [['vp9', 'vp9', 'webm'], ['prores422hq', 'prores', 'mov'], ['prores4444', 'prores', 'mov'],
    ...(can.hevc ? [['hevc', 'hevc', 'mp4']] : []), ...(can.hevcAlpha ? [['hevc_alpha', 'hevc', 'mov']] : [])];
  for (const [codec, name, ext] of codecs) {
    const done = await exported({ kind: 'video', codec, shortEdge: 90, fps: 5, range: [0, 0.2], quality: 'standard' });
    assert.ok(done.out.endsWith(`.${ext}`), done.out);
    assert.equal(probe(done.out, 'stream=codec_name,width,height'), `${name},160,90`, codec);
    if (codec === 'prores422hq') assert.equal(done.alpha, null, 'no alpha to measure');
    if (codec === 'prores4444' || codec === 'vp9') assert.deepEqual(done.alpha, { any: false }, `${codec}: the title paints over all of it`);
  }
  const hevc = can.hevc ? (await exported({ kind: 'video', codec: 'hevc', fps: 5, range: [0, 0.2] })).out : null;
  if (hevc) assert.equal(probe(hevc, 'stream=codec_tag_string'), 'hvc1', 'HEVC that Apple players open');
});

test('a PNG sequence comes zipped, one PNG with alpha per frame', ffmpeg, async () => {
  const done = await exported({ kind: 'video', codec: 'png', fps: 5, range: [0, 0.4] });
  assert.equal(done.out, join(exportsRoot(), 'Tiny (alpha) 0-0.4s.zip'));
  const { names, buf } = zipNames(done.out);
  assert.deepEqual(names, ['Tiny (alpha) 0-0.4s_000000.png', 'Tiny (alpha) 0-0.4s_000001.png']);
  const png = buf.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  assert.equal(buf[png + 25], 6, 'RGBA');
});

test('transparent: one clip alone from its start, with alpha; the whole film without the stage behind it', ffmpeg, async () => {
  const clip = await exported({ kind: 'video', codec: 'prores4444', clip: 'badge', fps: 10, scale: 0.5 });
  assert.equal(clip.out, join(exportsRoot(), 'Tiny · badge (alpha).mov'));
  assert.equal(probe(clip.out, 'stream=width,height'), '160,90');
  assert.equal(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', clip.out]).toString().trim(), '5');
  assert.deepEqual(clip.alpha, { any: true }, 'around the badge is transparent');
  assert.deepEqual(existsSync(join(root, '.film', 'cache', 'export')) ? readdirSync(join(root, '.film', 'cache', 'export')) : [], [], 'the one-clip edit is gone');
  /* the title paints its own background: the export is right, and says it is not see-through */
  const whole = await exported({ kind: 'video', codec: 'vp9', fps: 5, range: [0, 0.2] });
  assert.deepEqual(whole.alpha, { any: false });
  const exports = createExports();
  const missing = await ended(exports, exports.start(project(), { kind: 'video', codec: 'prores4444', clip: 'nope' }));
  assert.equal(missing.status, 'failed');
  assert.match(missing.error, /no clip "nope"/);
});

test('a page that throws while the video is made fails the export, and Studio carries on', ffmpeg, async () => {
  const folder = mkdtempSync(join(tmpdir(), 'of-throws-'));
  writeFileSync(join(folder, 'a.html'), '<!doctype html><body><script>window.film = { duration: 2, width: 160, height: 90, frame(t) { if (t > 0.5) throw new Error("boom"); } };</script>');
  writeFileSync(join(folder, 'film.html'), filmHtml({ stage: { w: 160, h: 90 }, tracks: [{ clips: [{ src: 'a.html' }] }] }));
  const crashed = [];
  const onCrash = (e) => crashed.push(e);
  process.on('unhandledRejection', onCrash);
  try {
    const exports = createExports();
    const done = await ended(exports, exports.start(project('Throws', folder), { kind: 'video', fps: 10 }));
    assert.equal(done.status, 'failed');
    assert.match(done.error, /boom/);
    await new Promise((r) => setTimeout(r, 1000));
    assert.deepEqual(crashed, [], 'nothing is left failing with no one to hear it');
  } finally {
    process.off('unhandledRejection', onCrash);
  }
});

test('a GIF at the width asked, looping', ffmpeg, async () => {
  const done = await exported({ kind: 'gif', width: 160, fps: 5, range: [0, 0.4] });
  assert.ok(done.out.endsWith('.gif'));
  const head = readFileSync(done.out);
  assert.equal(head.subarray(0, 6).toString(), 'GIF89a');
  assert.deepEqual([head.readUInt16LE(6), head.readUInt16LE(8)], [160, 90]);
});

test('the sound: the mix and the stems, by where each sound is, each named for what it is', ffmpeg, async () => {
  const can = await exportCapabilities();
  const format = can.mp3 ? 'mp3' : 'wav';
  const done = await exported({ kind: 'audio', format, mix: true, stems: true }, 'Stems');
  assert.deepEqual(done.outputs.map((f) => f.slice(exportsRoot().length + 1)), ['Stems - mix', 'Stems - voice', 'Stems - music', 'Stems - sfx'].map((n) => `${n}.${format}`));
  for (const f of done.outputs) assert.ok(Math.abs(Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString()) - 1) < 0.1, f);
  const stemsOnly = await exported({ kind: 'audio', mix: false, stems: true }, 'Only');
  assert.equal(stemsOnly.outputs.length, 3);

  /* a video's own sound is the footage's stem, not a voice: what soundRole calls a voice is a voice-over */
  const shot = join(scratch, 'Shot');
  mkdirSync(shot, { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x36:rate=25:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(shot, 'take.mp4')]);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', join(shot, 'narration.wav')]);
  writeFileSync(join(shot, 'film.html'), filmHtml({ stage: { w: 64, h: 36 }, tracks: [
    { clips: [{ src: 'take.mp4', id: 'take' }] }, { clips: [{ src: 'narration.wav', id: 'narration' }] },
  ] }));
  const footage = await exported({ kind: 'audio', format: 'wav', stems: true }, 'Shot', shot);
  assert.deepEqual(footage.outputs.map((f) => f.slice(exportsRoot().length + 1)), ['Shot - mix.wav', 'Shot - voice.wav', 'Shot - footage.wav']);
});

test('scene stills: the middle of each picture clip, zipped; a poster: one frame', ffmpeg, async () => {
  const stills = await exported({ kind: 'stills', format: 'png', shortEdge: 90 });
  assert.equal(stills.out, join(exportsRoot(), 'Tiny stills.zip'));
  assert.deepEqual(zipNames(stills.out).names, ['01 title.png', '02 badge.png']);
  const poster = await exported({ kind: 'poster', format: 'jpg', at: 0.25, frame: '1:1', shortEdge: 100 });
  assert.equal(poster.out, join(exportsRoot(), 'Tiny poster.jpg'));
  const jpg = readFileSync(poster.out);
  assert.equal(jpg[0], 0xff);
  assert.equal(probe(poster.out, 'stream=width,height'), '100,100');
});

test('several exports at once, into a folder of the person\'s; one wrong ask queues none', ffmpeg, async () => {
  const exports = createExports();
  const folder = join(scratch, 'Mine', 'Deliveries');
  const jobs = exports.startAll(project('Batch'), { folder, jobs: [{ kind: 'audio', format: 'wav', label: 'Full mix' }, { kind: 'poster', at: 0.1 }] });
  assert.deepEqual(jobs.map((j) => [j.label, j.status]), [['Full mix', 'waiting'], ['', 'waiting']]);
  const [mix, poster] = await Promise.all(jobs.map((job) => ended(exports, job)));
  assert.deepEqual([mix.status, poster.status], ['done', 'done']);
  assert.ok(mix.finishedAt <= poster.startedAt, 'one at a time, in the order asked');
  assert.ok(existsSync(join(folder, 'Batch - mix.wav')) && existsSync(join(folder, 'Batch poster.png')));
  const before = exports.list('p').length;
  assert.throws(() => exports.startAll(project(), { jobs: [{ kind: 'audio' }, { kind: 'nle', media: 'move' }] }), ExportError);
  assert.throws(() => exports.startAll(project(), { jobs: [{ kind: 'audio' }], folder: 'relative/path' }), ExportError);
  assert.equal(exports.list('p').length, before);
});

test('subtitles: SRT, WebVTT or a transcript of the film\'s cues; a film without cues is refused', async () => {
  const srt = await exported({ kind: 'subtitles' }, 'Subs');
  assert.equal(srt.out, join(exportsRoot(), 'Subs.srt'));
  assert.equal(readFileSync(srt.out, 'utf8'), '1\n00:00:00,000 --> 00:00:00,800\nAnn:Hello there\n\n2\n00:00:00,800 --> 00:00:01,600\nAnd welcome\n');
  const vtt = await exported({ kind: 'subtitles', format: 'vtt', range: [1, 2] }, 'Subs');
  assert.equal(vtt.out, join(exportsRoot(), 'Subs 1-2s.vtt'));
  assert.equal(readFileSync(vtt.out, 'utf8'), 'WEBVTT\n\n00:00:00.000 --> 00:00:00.600\nAnd welcome\n');
  const txt = await exported({ kind: 'subtitles', format: 'txt' }, 'Subs');
  assert.ok(txt.out.endsWith('Subs.txt'));
  const silent = createExports({ captions: async () => ({ cues: [], style: parseFilmSubtitleStyle(null) }) });
  const none = await ended(silent, silent.start(project('Silent'), { kind: 'subtitles' }));
  assert.equal(none.status, 'failed');
  assert.match(none.error, /no subtitles/);
  assert.equal(await silent.subtitles(root), 0);
  assert.equal(await createExports({ captions: subtitles }).subtitles(root), 2);
});

test('slides: a PowerPoint deck and a PDF, one page per scene, the scene named in the notes', ffmpeg, async () => {
  const deck = await exported({ kind: 'slides', format: 'pptx', shortEdge: 180 }, 'Deck');
  assert.equal(deck.out, join(exportsRoot(), 'Deck.pptx'));
  const parts = zipEntries(deck.out);
  assert.equal([...parts.keys()][0], '[Content_Types].xml');
  for (const name of ['_rels/.rels', 'ppt/presentation.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/notesSlides/notesSlide2.xml', 'ppt/theme/theme1.xml']) {
    assert.ok(parts.has(name), name);
  }
  assert.ok(!parts.has('ppt/slides/slide3.xml'), 'two scenes, two slides');
  for (const n of [1, 2]) assert.deepEqual([...parts.get(`ppt/media/image${n}.jpeg`).subarray(0, 2)], [0xff, 0xd8], 'a JPEG');
  const xml = [...parts].filter(([name]) => /\.(xml|rels)$/.test(name)).map(([, data]) => data.toString('utf8'));
  for (const { error } of await parseXml(xml)) assert.equal(error, null);
  const presentation = parts.get('ppt/presentation.xml').toString();
  assert.match(presentation, /<p:sldSz cx="12192000" cy="6858000"\/>/, 'a 16:9 slide, PowerPoint\'s widescreen');
  assert.match(parts.get('ppt/notesSlides/notesSlide1.xml').toString(), /<a:t>title<\/a:t>/, 'the first scene is the title');
  /* every relationship points at a part that is there */
  for (const [name, data] of parts) {
    if (!name.endsWith('.rels')) continue;
    const base = name.replace(/_rels\/[^/]*\.rels$/, '');
    for (const [, target] of data.toString().matchAll(/Target="([^"]+)"/g)) {
      const resolved = new URL(target, `http://x/${base}`).pathname.slice(1);
      assert.ok(parts.has(resolved), `${name} → ${resolved}`);
    }
  }
  const pdf = await exported({ kind: 'slides', format: 'pdf', shortEdge: 180, frame: '1:1' }, 'Deck');
  assert.equal(pdf.out, join(exportsRoot(), 'Deck.pdf'));
  const bytes = readFileSync(pdf.out).toString('latin1');
  assert.ok(bytes.startsWith('%PDF-'));
  assert.equal(bytes.match(/\/Type\s*\/Page(?![a-z])/g)?.length, 2, 'two pages');
  const sheets = [...bytes.matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(sheets.length, 2);
  for (const [w, h] of sheets) assert.ok(Math.abs(w - 135) < 0.5 && Math.abs(h - 135) < 0.5, `square sheets of 180 px (135 pt): ${w} × ${h}`);
});

test('a portrait deck has portrait slides', () => {
  const parts = pptxParts([{ jpeg: Buffer.from([0xff, 0xd8]), w: 1080, h: 1920, label: 'a & <b>' }], 'Tall & thin');
  const get = (name) => parts.find((p) => p.name === name).data.toString();
  assert.match(get('ppt/presentation.xml'), /<p:sldSz cx="6858000" cy="12192000"\/>/);
  assert.match(get('docProps/core.xml'), /<dc:title>Tall &amp; thin<\/dc:title>/);
  assert.match(get('ppt/notesSlides/notesSlide1.xml'), /<a:t>a &amp; &lt;b&gt;<\/a:t>/);
});

test('the editor\'s timeline: frames rounded edge by edge, tracks spread, placement as Basic Motion', () => {
  const rate = nleRate(29.97);
  assert.deepEqual(rate, { timebase: 30, ntsc: true, fps: 30000 / 1001 });
  assert.equal(nleRate(25).ntsc, false);
  assert.equal(frameSpan(0, 1.2345, rate).end, frameSpan(1.2345, 3, rate).start, 'back to back: no gap');
  assert.deepEqual(allocateLanes([{ start: 0, end: 10 }, { start: 5, end: 15 }, { start: 10, end: 20 }]), [0, 1, 0]);
  assert.deepEqual(containMotion({ w: 1920, h: 1080 }, { w: 1920, h: 1080 }), { kind: 'none' });
  assert.deepEqual(containMotion({ w: 960, h: 540 }, { w: 1920, h: 1080 }, { x: 480, y: 0, w: 960 }), { kind: 'motion', motion: { scale: 100, center: { h: 0, v: -0.25 } } });
  /* a box of another shape: the picture is fitted inside it, centered */
  assert.deepEqual(containMotion({ w: 100, h: 100 }, { w: 1920, h: 1080 }, { x: 760, y: 0, w: 400, h: 200 }), { kind: 'motion', motion: { scale: 200, center: { h: 0, v: -0.407407 } } });
  assert.equal(containMotion({ w: 100, h: 100 }, { w: 1920, h: 1080 }, { x: 0, y: 0, r: 10 }).kind, 'bake');
  assert.equal(containMotion({}, { w: 1920, h: 1080 }).kind, 'bake');
});

test('fades in the editor\'s timeline: a picture that fades is rendered; a sound that fades is its own part with level keyframes', () => {
  const rate = nleRate(25);
  assert.deepEqual(fadeKeyframes([0.5, 1], 100, 0.8, rate), [{ when: 0, value: 0 }, { when: 13, value: 0.8 }, { when: 75, value: 0.8 }, { when: 100, value: 0 }]);
  assert.deepEqual(fadeKeyframes([0, 1], 50, 1, rate), [{ when: 0, value: 1 }, { when: 25, value: 1 }, { when: 50, value: 0 }]);
  const facts = { w: 320, h: 180, duration: 10, hasVideo: true, hasAudio: true, channels: 2, sampleRate: 48000 };
  const timeline = planNleTimeline({
    stage: { w: 320, h: 180 }, duration: 4,
    pictures: [{ id: 'shot', kind: 'video', src: 'a.mp4', path: '/p/a.mp4', at: 0, end: 4, from: 2, speed: 1, track: 0, hidden: false, faded: true, facts }],
    sounds: [{ id: 'shot', src: 'a.mp4', path: '/p/a.mp4', at: 0, from: 2, to: 6, speed: 1, volume: 1, enabled: true, role: 'footage', picture: 'shot', facts, fade: [0.5, 0] }],
  }, { title: 'T', fps: 25, audio: 'clips', media: 'copy', mediaDir: '/out/media' });
  assert.equal(timeline.files.find((f) => f.id === timeline.video[0].clips[0].fileId)?.job.kind, 'render', 'the picture rendered, its fade in its alpha');
  const sound = timeline.audio[0].clips[0];
  assert.deepEqual(timeline.files.find((f) => f.id === sound.fileId)?.job, { kind: 'transcode', from: '/p/a.mp4', to: 'wav', segment: { from: 2, to: 6, speed: 1, seconds: 4 } });
  assert.equal(sound.in, 0);
  assert.deepEqual(sound.levels, [{ when: 0, value: 0 }, { when: 13, value: 1 }]);
  assert.match(xmemlDocument(timeline), /<parameterid>level<\/parameterid>[\s\S]*<keyframe>\s*<when>0<\/when>\s*<value>0<\/value>\s*<\/keyframe>\s*<keyframe>\s*<when>13<\/when>/);
});

test('editing software: an xmeml folder; pages rendered with alpha, footage placed, sound as clips or stems, subtitles as SRT', { ...ffmpeg, timeout: 240_000 }, async () => {
  const cut = join(scratch, 'Cut');
  mkdirSync(join(cut, 'footage'), { recursive: true });
  mkdirSync(join(cut, 'assets', 'audio', 'music'), { recursive: true });
  const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(cut, 'footage', 'shot one.mp4')]);
  ff(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=2', join(cut, 'assets', 'audio', 'music', 'bed.wav')]);
  ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', join(cut, 'voice.ogg')]);
  writeFileSync(join(cut, 'badge.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#2a6"/></svg>');
  writeFileSync(join(cut, 'title.html'), `<!doctype html><body style="margin:0"><div style="position:absolute;left:20px;top:20px;width:40px;height:40px;background:#fff"></div>
<script>window.film={duration:1,width:320,height:180,frame(t){}}</script></body>`);
  writeFileSync(join(cut, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [
    { clips: [{ src: 'title.html', id: 'title' }] },
    { clips: [{ src: 'badge.svg', id: 'badge', at: 0.5, time: [0, 1], box: { x: 10, y: 20, w: 160 } }] },
    { hidden: true, clips: [{ src: 'title.html', id: 'title-2', at: 1 }] },
    { clips: [{ src: 'footage/shot one.mp4', id: 'shot', time: [0.4, 2], volume: 0.5 }, { src: 'footage/shot one.mp4', id: 'slow', at: 1.6, time: [1, 1.4], speed: 0.5 }] },
    { clips: [{ src: 'voice.ogg', id: 'voice', at: 0.2, time: [0, 0.8] }] },
    { muted: true, clips: [{ src: 'assets/audio/music/bed.wav', id: 'bed', speed: 2, volume: 0.7 }] },
  ] }));

  const done = await exported({ kind: 'nle', fps: 25 }, 'Cut', cut);
  const folder = join(exportsRoot(), 'Cut · Editor XML');
  /* the outputs are this system's paths: Windows separates them with \ */
  const rel = done.outputs.map((f) => f.slice(folder.length + 1).replaceAll('\\', '/'));
  assert.deepEqual(rel, ['Cut.xml', 'Cut.srt', 'media/badge.png', 'media/bed x2.wav', 'media/shot one x0.5.wav', 'media/shot one.mp4', 'media/slow.mov',
    'media/title-2.mov', 'media/title.mov', 'media/voice.wav']);
  assert.equal(done.out, join(folder, 'Cut.xml'));
  assert.equal(readFileSync(join(folder, 'Cut.srt'), 'utf8'), filmSubtitleSrt(CUES));
  for (const page of ['title', 'title-2']) {
    const mov = join(folder, 'media', `${page}.mov`);
    assert.equal(probe(mov, 'stream=codec_name,profile,width,height'), 'prores,4444,320,180', page);
    assert.equal(frameCount(mov), 25, `${page}: one second at 25 fps`);
  }
  assert.equal(probe(join(folder, 'media', 'badge.png'), 'stream=width,height'), '160,80', 'the drawing drawn as big as it shows');
  assert.ok(Math.abs(Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(folder, 'media', 'bed x2.wav')]).toString()) - 1) < 0.05, 'the bed at twice the speed');
  assert.ok(!existsSync(join(cut, '.film', 'cache', 'export')) || readdirSync(join(cut, '.film', 'cache', 'export')).length === 0, 'nothing left behind');
  assert.deepEqual(readdirSync(exportsRoot()).filter((n) => n.startsWith('.')), [], 'no half-made folder');

  const [{ error, found }] = await parseXml([readFileSync(done.out, 'utf8')], (doc) => {
    const text = (el, sel) => el.querySelector(sel)?.textContent ?? null;
    const clips = (kind) => [...doc.querySelectorAll(`sequence > media > ${kind} > track`)].map((track) => [...track.querySelectorAll(':scope > clipitem')].map((c) => ({
      name: text(c, ':scope > name'), enabled: text(c, ':scope > enabled'), start: Number(text(c, ':scope > start')), end: Number(text(c, ':scope > end')),
      in: Number(text(c, ':scope > in')), out: Number(text(c, ':scope > out')),
      effects: [...c.querySelectorAll(':scope > filter effectid')].map((e) => e.textContent), links: c.querySelectorAll(':scope > link').length,
      path: text(c, ':scope > file > pathurl'), file: c.querySelector(':scope > file')?.getAttribute('id'),
    })));
    return { timebase: text(doc, 'sequence > rate > timebase'), video: clips('video'), audio: clips('audio') };
  });
  assert.equal(error, null);
  assert.equal(found.timebase, '25');
  /* V1 is film.html's last picture track: the footage, at its trim, scaled up from 160 × 90, linked to its sound; the
     part at half speed rendered */
  const [[shot, slow], [hidden], [badge], [title]] = found.video;
  assert.deepEqual([slow.name, slow.start, slow.end, slow.in, slow.out, slow.effects], ['slow', 40, 60, 0, 20, []]);
  assert.deepEqual([shot.name, shot.start, shot.end, shot.in, shot.out, shot.links], ['shot', 0, 40, 10, 50, 2]);
  assert.deepEqual(shot.effects, ['basic']);
  assert.match(shot.path, /media\/shot%20one\.mp4$/);
  assert.deepEqual([hidden.name, hidden.enabled, hidden.start, hidden.end], ['title-2', 'FALSE', 25, 50]);
  assert.deepEqual([badge.name, badge.start, badge.end, badge.effects], ['badge', 13, 38, ['basic']]);
  assert.deepEqual([title.name, title.start, title.end, title.effects], ['title', 0, 25, []]);
  const sounds = found.audio.flat().map((c) => [c.name, c.enabled, c.start, c.end]);
  /* each named by its clip's id, as the pictures are: the footage's own sound, and its part at half speed; the voice,
     trimmed; the muted bed at twice the speed */
  assert.deepEqual(sounds, [['shot', 'TRUE', 0, 40], ['slow', 'TRUE', 40, 60], ['voice', 'TRUE', 5, 25], ['bed', 'FALSE', 0, 25]]);
  /* every clip's media is there for all of its frames; a sound at another speed is made as long as its clip, slowed or
     sped as the film plays it (an editor plays it at its own speed: shorter, it would stop halfway through its clip) */
  const paths = new Map(found.video.flat().concat(found.audio.flat()).filter((c) => c.path).map((c) => [c.file, decodeURIComponent(c.path.replace(/^file:\/\/localhost/, ''))]));
  for (const c of [...found.video.flat(), ...found.audio.flat()]) {
    const media = paths.get(c.file);
    if (/\.png$/.test(media)) continue;
    const frames = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', media]).toString()) * 25;
    assert.ok(c.out <= frames + 1, `${c.name}: its media has ${frames} frames, the clip plays to ${c.out}`);
    if (/ x[\d.]+\.wav$|\.mov$/.test(media)) assert.ok(Math.abs(frames - (c.end - c.start)) < 0.5 && c.in === 0, `${c.name}: ${frames} frames of media for ${c.end - c.start} on the timeline`);
  }
  /* sound to its end, not silence padded after half of it */
  const tail = spawnSync('ffmpeg', ['-hide_banner', '-ss', '0.65', '-i', join(folder, 'media', 'shot one x0.5.wav'), '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  assert.ok(Number(/max_volume: (-?[\d.]+) dB/.exec(tail)?.[1] ?? -99) > -20, 'the slowed sound plays to the end of its clip');

  /* the mixed stems instead, the media left where it is */
  const stems = await exported({ kind: 'nle', fps: 25, audio: 'stems', media: 'link', subtitles: false }, 'Cut', cut);
  const folder2 = join(exportsRoot(), 'Cut · Editor XML 2');
  assert.deepEqual(stems.outputs.map((f) => f.slice(folder2.length + 1).replaceAll('\\', '/')),
    ['Cut.xml', 'media/Cut - footage.wav', 'media/Cut - voice.wav', 'media/badge.png', 'media/slow.mov', 'media/title-2.mov', 'media/title.mov']);
  const xml = readFileSync(stems.out, 'utf8');
  assert.match(xml, /<pathurl>file:\/\/localhost\/[^<]*\/Cut\/footage\/shot%20one\.mp4<\/pathurl>/, 'linked to the footage where it is');
  assert.ok(!xml.includes('<link>'), 'a stem is not linked to a picture');
});

test('burned-in subtitles: drawn over the frame, bars included; a subtitle file beside the video', ffmpeg, async () => {
  /* the pixels of the bottom tenth of a picture that are near white (the title's own text is at the top) */
  const bright = (file) => {
    const [w, h] = probe(file, 'stream=width,height').split(',').map(Number);
    const rgb = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    let n = 0;
    for (let y = Math.floor(h * 0.85); y < h; y++) for (let x = 0; x < w; x++) if (Math.min(...rgb.subarray((y * w + x) * 3, (y * w + x) * 3 + 3)) > 200) n++;
    return n;
  };
  const plain = await exported({ kind: 'poster', at: 0.25, shortEdge: 360 }, 'Burn');
  assert.equal(bright(plain.out), 0);
  const burned = await exported({ kind: 'poster', at: 0.25, shortEdge: 360, burnSubtitles: true }, 'Burn');
  assert.ok(bright(burned.out) > 20, 'the line is drawn');
  assert.equal(probe(burned.out, 'stream=width,height'), '640,360');
  /* a vertical frame: the line sits in the frame, below the film, where the bars are */
  const tall = await exported({ kind: 'poster', at: 0.25, frame: '9:16', shortEdge: 360, burnSubtitles: true }, 'Burn');
  assert.equal(probe(tall.out, 'stream=width,height'), '360,640');
  const video = await exported({ kind: 'video', fps: 5, range: [0, 1], shortEdge: 360, burnSubtitles: true, sidecar: 'vtt' }, 'Burn');
  assert.ok(bright(video.out) > 20, 'burned into the video');
  assert.deepEqual(video.outputs.map((f) => f.slice(exportsRoot().length + 1)), ['Burn 360p 0-1s.mp4', 'Burn 360p 0-1s.vtt']);
  assert.match(readFileSync(video.outputs[1], 'utf8'), /^WEBVTT\n\n00:00:00\.000 --> 00:00:00\.800\n<v Ann>Hello there\n\n00:00:00\.800 --> 00:00:01\.000\nAnd welcome\n$/);
  assert.equal(frameCount(video.out), 5);
  assert.deepEqual(readdirSync(join(root, '.film', 'cache', 'export')), [], 'the page drawing them is gone');
});

test('a zip of many files, readable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-zip-'));
  const files = Array.from({ length: 3 }, (_, i) => { const file = join(dir, `${i}.txt`); writeFileSync(file, `file ${i} ünïcode`); return { name: `frames/${i}.txt`, file }; });
  files.push({ name: 'déjà vu.txt', file: files[0].file });
  await zipFiles(join(dir, 'out.zip'), files);
  assert.deepEqual(zipNames(join(dir, 'out.zip')).names, files.map((f) => f.name));
  try {
    const listed = execFileSync('unzip', ['-Z1', join(dir, 'out.zip')]).toString().trim().split('\n');
    assert.deepEqual(listed.slice(0, 3), files.slice(0, 3).map((f) => f.name));
    assert.equal(execFileSync('unzip', ['-p', join(dir, 'out.zip'), 'frames/2.txt']).toString(), 'file 2 ünïcode');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e; // no unzip here: the directory read above is the check
  }
});

test('a zip copies a big file a piece at a time, its checksum right', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-zip-big-'));
  /* past one piece (4 MB), not a multiple of it, so the last piece is short */
  const big = Buffer.alloc(9 * 1024 * 1024 + 123);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff;
  writeFileSync(join(dir, 'footage.bin'), big);
  let told = 0;
  await zipFiles(join(dir, 'out.zip'), [{ name: 'a/footage.bin', file: join(dir, 'footage.bin') }, { name: 'a/note.txt', data: Buffer.from('hi') }], undefined, (n) => { told = n; });
  assert.equal(told, big.length + 2);
  const entries = zipEntries(join(dir, 'out.zip'));
  assert.ok(entries.get('a/footage.bin').equals(big));
  assert.equal(entries.get('a/note.txt').toString(), 'hi');
  try {
    assert.match(execFileSync('unzip', ['-t', join(dir, 'out.zip')]).toString(), /No errors detected/);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
});

/** A project with every part of .film/, and what never goes in an export. */
function fullProject() {
  const dir = join(mkdtempSync(join(tmpdir(), 'of-project-')), 'My Film');
  const put = (rel, text = rel) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), text); };
  put('film.html', filmHtml({ stage: { w: 320, h: 180 }, tracks: [] }));
  put('scenes/one.html');
  put('assets/audio/vo/line.mp3');
  put('.film/id', 'abc123\n');
  put('.film/opened', '');
  put('.film/subtitles.json', '{}');
  put('.film/history/HEAD', 'ref: refs/heads/main');
  put('.film/chat/sessions.json', '{}');
  put('.film/chat/agent/s.jsonl');
  put('.film/logs/t1.jsonl');
  put('.film/cache/posters/x.jpg');
  put('.git/HEAD');
  put('node_modules/x/index.js');
  put('.DS_Store');
  /* footage linked in from elsewhere: the export carries the file itself */
  const outside = join(dir, '..', 'shoot.mov');
  writeFileSync(outside, 'footage');
  symlinkSync(outside, join(dir, 'assets', 'shoot.mov'));
  return dir;
}

test('a project\'s export takes its work and the parts asked, never its id, cache or another tool\'s files', async () => {
  const dir = fullProject();
  const names = async (parts) => (await projectFiles(dir, parts)).map((f) => f.name).sort();
  const work = ['.film/subtitles.json', 'assets/audio/vo/line.mp3', 'assets/shoot.mov', 'film.html', 'scenes/one.html'];
  assert.deepEqual(await names([]), work);
  assert.deepEqual(await names(['history', 'chat', 'logs']), [...work, '.film/chat/agent/s.jsonl', '.film/chat/sessions.json', '.film/history/HEAD', '.film/logs/t1.jsonl'].sort());
  /* the folder being written to, inside the project, is left out */
  assert.deepEqual((await projectFiles(dir, [], join(dir, 'scenes'))).map((f) => f.name).sort(), work.filter((n) => !n.startsWith('scenes/')));
  const sizes = await projectSizes(dir);
  assert.equal(sizes.chat, '{}'.length + '.film/chat/agent/s.jsonl'.length);
  assert.equal(sizes.logs, '.film/logs/t1.jsonl'.length);
  assert.ok(sizes.work > 0 && sizes.history > 0);
  rmSync(join(dir, '.film', 'logs'), { recursive: true });
  assert.equal((await projectSizes(dir)).logs, null);
});

test('a project exports as a zip holding its folder, or as the folder, each opened like any project', async () => {
  const dir = fullProject();
  const zipped = await exported({ kind: 'project', parts: ['history'] }, 'My Film', dir);
  assert.equal(zipped.out, join(exportsRoot(), 'My Film.zip'));
  const entries = zipEntries(zipped.out);
  assert.deepEqual([...entries.keys()].sort(), ['My Film/.film/history/HEAD', 'My Film/.film/subtitles.json', 'My Film/assets/audio/vo/line.mp3', 'My Film/assets/shoot.mov', 'My Film/film.html', 'My Film/scenes/one.html']);
  assert.equal(entries.get('My Film/assets/shoot.mov').toString(), 'footage');
  const copied = await exported({ kind: 'project', as: 'folder', parts: ['chat', 'logs'] }, 'My Film', dir);
  assert.equal(copied.out, join(exportsRoot(), 'My Film'));
  assert.ok(existsSync(join(copied.out, 'film.html')) && existsSync(join(copied.out, '.film', 'chat', 'sessions.json')) && existsSync(join(copied.out, '.film', 'logs', 't1.jsonl')));
  assert.ok(!existsSync(join(copied.out, '.film', 'id')) && !existsSync(join(copied.out, '.film', 'history')) && !existsSync(join(copied.out, '.film', 'cache')));
  assert.equal(readFileSync(join(copied.out, 'assets', 'shoot.mov'), 'utf8'), 'footage');
  /* never over an earlier one */
  assert.equal((await exported({ kind: 'project', as: 'folder' }, 'My Film', dir)).out, join(exportsRoot(), 'My Film 2'));
  assert.throws(() => createExports().start(project('My Film', dir), { kind: 'project', parts: ['cache'] }), ExportError);
  assert.throws(() => createExports().start(project('My Film', dir), { kind: 'project', range: [0, 1] }), ExportError);
});

test('the API: where exports go and what can be made here; several at once; open and reveal only what is there', async () => {
  process.env.OPENFILM_HOME = join(scratch, 'home');
  process.env.OPENFILM_LIBRARY = join(scratch, 'library');
  const { startStudio } = await import('./server.mjs');
  const studio = await startStudio({ port: 0, openBrowser: () => {} });
  try {
    const api = (path, { method = 'GET', body } = {}) => fetch(`${studio.origin}/api${path}`, {
      method, headers: { 'x-studio-key': studio.key, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
    const { project } = await (await api('/projects', { method: 'POST', body: { path: join(scratch, 'Api') } })).json();
    const listed = await (await api(`/projects/${project.id}/exports`)).json();
    assert.deepEqual(listed.exports, []);
    assert.equal(listed.folder, exportsRoot());
    assert.deepEqual(Object.keys(listed.can).sort(), ['h264', 'hevc', 'hevcAlpha', 'mp3', 'prores', 'vp9']);
    assert.equal(listed.subtitles, 0, 'no subtitle cues in a new project');
    const bad = await api(`/projects/${project.id}/exports`, { method: 'POST', body: { jobs: [{ kind: 'audio' }, { kind: 'slides', format: 'key' }] } });
    assert.equal(bad.status, 400);
    const queued = await (await api(`/projects/${project.id}/exports`, { method: 'POST', body: { jobs: [{ kind: 'audio', label: 'Sound' }] } })).json();
    assert.equal(queued.exports.length, 1);
    assert.equal(queued.exports[0].label, 'Sound');
    const one = await (await api(`/projects/${project.id}/exports`, { method: 'POST', body: { kind: 'audio' } })).json();
    assert.equal(one.export.kind, 'audio');
    for (const action of ['open', 'reveal']) assert.equal((await api(`/projects/${project.id}/exports/${one.export.id}/${action}`, { method: 'POST', body: {} })).status, 404);
  } finally {
    await studio.close();
  }
});

test('an editing-software export of a film whose clip leads out of the project (`../`) fails before anything is copied', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'of-outside-'));
  const film = join(folder, 'Film');
  mkdirSync(film);
  writeFileSync(join(folder, 'private.wav'), 'not the film\'s');
  writeFileSync(join(film, 'film.html'), filmHtml({ stage: { w: 160, h: 90 }, tracks: [{ clips: [{ src: '../private.wav', id: 'theirs' }] }] }));
  const exports = createExports({ captions: subtitles });
  const done = await ended(exports, exports.start(project('Outside', film), { kind: 'nle', fps: 25 }));
  assert.equal(done.status, 'failed');
  assert.match(done.error, /\.\.\/private\.wav is not a file inside the project/);
  const made = readdirSync(exportsRoot()).filter((n) => n.startsWith('Outside'));
  assert.deepEqual(made.flatMap((n) => readdirSync(join(exportsRoot(), n), { recursive: true })).filter((f) => /private/.test(String(f))), []);
});
