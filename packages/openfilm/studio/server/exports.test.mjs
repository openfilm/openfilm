import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExports, diskFull, exportCapabilities, exportsRoot, ExportError, frameBox, dimsForShortEdge, keepChanges, projectFiles, projectSizes, shareOf, writableFolder } from './exports.mjs';
import { encoders, hardwareEncoder } from '../../src/encoders.mjs';
import { allocateLanes, containMotion, fadeKeyframes, frameSpan, nleRate, planNleTimeline, probeSource, xmemlDocument } from './nle.mjs';
import { fcpxmlDocument } from './fcpxml.mjs';
import { pptxParts } from './slides.mjs';
import { filmSubtitleSrt, parseFilmSubtitleStyle } from './film-subtitle.mjs';
import { zipFiles } from './zip.mjs';
import { launch } from '../../src/host.mjs';
import { layoutTracks } from '../ui/src/lib/timeline-layout.ts';
import { filmHtml } from '../../src/film-doc.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const ffmpeg = { skip: !hasFfmpeg && 'no ffmpeg', timeout: 120_000 };
/** The processes started by `parent` whose command matches `pattern`: pgrep's, or on Windows the system's process list. */
function children(parent, pattern) {
  if (process.platform !== 'win32') return spawnSync('pgrep', ['-P', String(parent), '-f', pattern], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean).map(Number);
  const listed = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${parent}' | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }`], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
  if (listed.status !== 0) throw new Error(`the process list did not answer: ${listed.error?.message ?? listed.stderr}`);
  return listed.stdout.split(/\r?\n/).filter((line) => new RegExp(pattern).test(line.slice(line.indexOf(' ') + 1))).map((line) => Number(line.split(' ')[0]));
}
/** End a process as a crash would; one gone already (a browser's helper, ended with the browser) is ended. */
function end(pid) {
  try { process.kill(pid, 'SIGKILL'); } catch (e) { if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'ESRCH') throw e; }
}
/* the tests that end an export's processes find them in the process list, which on Windows (WMI) can stop answering */
const processes = { skip: process.platform === 'win32' && (() => { try { children(process.pid, '.'); return false; } catch { return 'the process list does not answer'; } })() };
let root, scratch;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'of-exports-'));
  process.env.OPENFILM_EXPORTS = join(scratch, 'Exports');
  /* the problems the failing exports here record go to this home's log, not to the person's (Studio's report reads it) */
  process.env.OPENFILM_HOME = join(scratch, 'home');
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

test('a 16× clip exports its trimmed picture and pitch-preserved sound at the shortened duration', ffmpeg, async () => {
  const folder = join(scratch, 'Fast');
  mkdirSync(folder);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:size=160x90:rate=10:duration=8[a];color=c=red:size=160x90:rate=10:duration=32[b];[a][b]concat=n=2:v=1:a=0',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=8[a];sine=frequency=440:duration=32[b];[a][b]concat=n=2:v=0:a=1', '-shortest', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(folder, 'source.mp4')]);
  writeFileSync(join(folder, 'film.html'), filmHtml({ stage: { w: 160, h: 90 }, tracks: [
    { clips: [{ src: 'source.mp4', id: 'fast', time: [8, 40], speed: 16 }] },
  ] }));
  const done = await exported({ kind: 'video', fps: 10, hardware: false }, 'Fast', folder);
  assert.equal(frameCount(done.out), 20, '32 source seconds become 2 seconds at 10 fps');
  const [red, green, blue] = firstFrame(done.out).at(80, 45);
  assert.ok(red > 200 && green < 80 && blue < 50, `the source's red picture is present: ${red},${green},${blue}`);
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.05', '-i', done.out, '-t', '1', '-ac', '1', '-ar', '48000', '-f', 's16le', '-']);
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  assert.ok(samples.length >= 47000, 'sound lasts through the clip');
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] <= 0 && samples[i] > 0) crossings++;
  assert.ok(Math.abs(crossings - 440) < 5, `pitch stays 440 Hz: ${crossings}`);
});

test('the ends of the range: a 100× clip and a 0.1× one export at their length, every frame there, the pitch kept', ffmpeg, async () => {
  /* 100 source seconds at 100× are 1 s; 1 source second at 0.1× is 10 s */
  for (const [name, seconds, speed, frames] of [['Fastest', 100, 100, 10], ['Slowest', 1, 0.1, 100]]) {
    const folder = join(scratch, name);
    mkdirSync(folder);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=red:size=160x90:rate=10:duration=${seconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-shortest', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(folder, 'source.mp4')]);
    writeFileSync(join(folder, 'film.html'), filmHtml({ stage: { w: 160, h: 90 }, tracks: [
      { clips: [{ src: 'source.mp4', id: 'clip', time: [0, seconds], speed }] },
    ] }));
    const done = await exported({ kind: 'video', fps: 10, hardware: false }, name, folder);
    assert.equal(frameCount(done.out), frames, `${name}: ${seconds} source seconds at ${speed}× are ${frames / 10} s at 10 fps`);
    const length = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', done.out], { encoding: 'utf8' }));
    assert.ok(Math.abs(length - frames / 10) < 0.1, `${name}: ${length} s`);
    const [red] = firstFrame(done.out).at(80, 45);
    assert.ok(red > 200, `${name}: the picture is there`);
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.05', '-i', done.out, '-t', '0.9', '-ac', '1', '-ar', '48000', '-f', 's16le', '-']);
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
    assert.ok(samples.length >= 0.85 * 48000, `${name}: the sound lasts through the clip`);
    let crossings = 0;
    for (let i = 1; i < samples.length; i++) if (samples[i - 1] <= 0 && samples[i] > 0) crossings++;
    assert.ok(Math.abs(crossings - 396) < 8, `${name}: the pitch stays 440 Hz: ${crossings} in 0.9 s`);
  }
});

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
    assert.equal(exportsRoot(), join(homedir(), 'Desktop'));
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
  /* Use the same platform-aware hardware selection as video exports. */
  const available = new Set(
    execFileSync('ffmpeg', ['-hide_banner', '-encoders'])
      .toString()
      .match(/^ V\S{5} (\S+)/gm)
      ?.map((line) => line.trim().split(/\s+/)[1]) ?? []
  );
  const hardware = await hardwareEncoder('h264', available);
  assert.equal(done.encoder, hardware ?? 'libx264');
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

test('an export named where it is asked for: that is the file, and the project is not asked', ffmpeg, async () => {
  const done = await exported({ kind: 'video', fps: 24, name: '预告片' });
  assert.equal(done.out, join(exportsRoot(), '预告片.mp4'));
});

test('a name of nothing but spaces: the project names the file, as before', ffmpeg, async () => {
  const done = await exported({ kind: 'video', fps: 24, name: '   ' }, 'Blank');
  assert.equal(done.out, join(exportsRoot(), 'Blank.mp4'));
});

test('a name is text, at most 120 characters', () => {
  for (const name of [42, 'x'.repeat(121)]) {
    assert.throws(() => createExports().start(project(), { kind: 'subtitles', name }), ExportError, JSON.stringify(name));
  }
});

test('names Windows can hold: no dot or space at the end, none of its device names', async () => {
  const exports = createExports({ captions: subtitles });
  for (const [name, file] of [['Intro.', 'Intro.srt'], ['Outro . . ', 'Outro.srt'], ['CON', 'CON film.srt'], ['aux.final', 'aux film.final.srt'], ['Console', 'Console.srt']]) {
    const done = await ended(exports, exports.start(project(), { kind: 'subtitles', name }));
    assert.equal(done.status, 'done', done.error);
    assert.equal(basename(done.out), file, JSON.stringify(name));
  }
});

test('a full disk is said plainly, whichever words ffmpeg or the system use for it', async () => {
  for (const words of ['ffmpeg: [out#0/mov @ 0x1] Error writing trailer: No space left on device', 'ENOSPC: no space left on device, write', 'There is not enough space on the disk.']) {
    assert.ok(diskFull(new Error(words)), words);
  }
  assert.ok(diskFull(Object.assign(new Error('write'), { code: 'ENOSPC' })));
  for (const other of [new Error('ffmpeg: Invalid data found when processing input'), new Error('cancelled'), 'cancelled', null]) assert.ok(!diskFull(other), String(other));
  /* the export that meets it fails with that, and the tray says it in the person's language */
  const full = createExports({ captions: async () => { throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' }); } });
  const done = await ended(full, full.start(project(), { kind: 'subtitles' }));
  assert.equal(done.status, 'failed');
  assert.equal(done.diskFull, true);
  assert.equal(done.error, 'the disk is full: free up some space, then export again');
});

test('a renderer that dies fails its export with the reason, and exports go on', { ...ffmpeg, skip: ffmpeg.skip || processes.skip }, async () => {
  const exports = createExports();
  const job = exports.start(project('Crash'), { kind: 'video' });
  await until(exports, job.id, (j) => j.status === 'running' && j.out);
  /* the film renders in a process of its own: ended from outside, as a crash would end it */
  let pid = 0;
  for (let i = 0; i < 200 && !pid; i++) {
    [pid] = children(process.pid, 'render-worker');
    if (!pid) await new Promise((r) => setTimeout(r, 25));
  }
  assert.ok(pid, 'a render process is running');
  process.kill(pid, 'SIGKILL');
  const failed = await ended(exports, job);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /renderer stopped/);
  const again = exports.start(project('After'), { kind: 'video' });
  assert.equal((await ended(exports, again)).status, 'done');
});

test('a video whose browser is ended partway, as a crash would end it, is drawn again and done', { ...ffmpeg, skip: ffmpeg.skip || processes.skip }, async () => {
  const exports = createExports();
  const job = exports.start(project('Browser crash'), { kind: 'video' });
  await until(exports, job.id, (j) => j.status === 'running' && j.out);
  /** @type {number[]} */
  let browsers = [];
  for (let i = 0; i < 400 && !browsers.length; i++) {
    const [worker] = children(process.pid, 'render-worker');
    if (worker) browsers = children(worker, 'chrom');
    if (!browsers.length) await new Promise((r) => setTimeout(r, 25));
  }
  assert.ok(browsers.length, 'the film draws in a browser of the render process');
  for (const pid of browsers) end(pid);
  const done = await ended(exports, job);
  assert.equal(done.status, 'done', done.error);
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
  assert.deepEqual(readdirSync(exportsRoot()).filter((n) => n.startsWith('Cancel') || n.includes('.partial-')), [], 'nothing under its name, nothing half made');
  for (const bad of [{ kind: 'pdf' }, { kind: 'video', range: [3, 1] }, { kind: 'video', codec: 'av1' }, { kind: 'video', frame: '9:1' }, { kind: 'video', frame: 'wide' },
    { kind: 'audio', mix: false }, { kind: 'stills', range: [0, 1] }, { kind: 'stills', as: 'pdf' }, { kind: 'gif', width: 5000 }, { kind: 'subtitles', format: 'ass' },
    { kind: 'slides', format: 'key' }, { kind: 'slides', range: [0, 1] }, { kind: 'nle', fps: 500 }, { kind: 'nle', audio: 'mix' }, { kind: 'nle', range: [0, 1] },
    { kind: 'nle', format: 'fcpxml', alpha: 'png' }, { kind: 'nle', alpha: 'auto' }, { kind: 'nle', format: 'jianying', alpha: 'hevc_alpha' }, { kind: 'nle', format: 'jianying', alpha: 'prores4444' }]) {
    assert.throws(() => exports.start(project(), bad), ExportError, JSON.stringify(bad));
  }
});

test('what an export Studio could not finish left behind goes before the next one; what a running Studio is making stays', ffmpeg, async () => {
  /* a process that has ended, one still running, and this one */
  const gone = spawn(process.execPath, ['-e', '']);
  await new Promise((r) => gone.on('exit', r));
  const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
  try {
    const out = exportsRoot();
    const cache = (sub) => join(root, '.film', 'cache', sub);
    const left = (pid) => [join(out, `.Old.partial-${pid}-0123456789ab.mp4`), join(out, `.Old draft.partial-${pid}-0123456789ab`, 'media', 'p.mov'),
      join(cache('export'), `nle-${pid}-0123abcd`, 'film.html'), join(cache('render'), `.parts-${pid}`, 'part-0.mov'),
      join(cache('seek'), `0123abcd.mp4.part-${pid}-0123abcd.mp4`)];
    for (const pid of [gone.pid, live.pid, process.pid]) for (const f of left(pid)) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, 'x'); }
    const theirs = [join(out, '.Notes.partial'), join(out, 'Old.partial-1-0123456789ab.mp4'), join(cache('export'), 'nle-mine')];
    for (const f of theirs) writeFileSync(f, 'x');
    const exports = createExports({ captions: subtitles });
    assert.equal((await ended(exports, exports.start(project(), { kind: 'subtitles' }))).status, 'done');
    for (const f of left(gone.pid)) assert.ok(!existsSync(dirname(f).endsWith('media') ? dirname(dirname(f)) : f), `swept: ${f}`);
    for (const f of [...left(live.pid), ...left(process.pid), ...theirs]) assert.ok(existsSync(f), `kept: ${f}`);
    for (const f of [...left(live.pid), ...left(process.pid), ...theirs]) rmSync(dirname(f).endsWith('media') ? dirname(dirname(f)) : /(nle|\.parts)-\d+/.test(dirname(f)) ? dirname(f) : f, { recursive: true, force: true });
  } finally {
    live.kill();
  }
});

test('Studio closing stops its exports and waits for their half-made files to go', ffmpeg, async () => {
  const exports = createExports();
  const first = exports.start(project('Closing'), { kind: 'video' });
  const second = exports.start(project('Closing next'), { kind: 'video' });
  await until(exports, first.id, (j) => j.status === 'running' && j.framesDone > 0);
  await exports.stopAll();
  const [a, b] = [first, second].map((j) => exports.list('p').find((x) => x.id === j.id));
  assert.deepEqual([a.status, b.status], ['cancelled', 'cancelled']);
  assert.deepEqual(readdirSync(exportsRoot()).filter((n) => n.startsWith('Closing') || n.includes('.partial-')), [], 'nothing under their names, nothing half made');
  const parts = join(root, '.film', 'cache', 'render');
  assert.deepEqual(existsSync(parts) ? readdirSync(parts).filter((n) => n.startsWith('.parts-')) : [], [], 'no render parts');
});

test('the delivery frame: the same box as the editor, the short side asked, never past 4096', () => {
  assert.deepEqual(frameBox({ w: 1920, h: 1080 }, '9:16', 'contain'), { w: 1920, h: 3414, ratio: 9 / 16, scale: 1 });
  assert.deepEqual(dimsForShortEdge(frameBox({ w: 1920, h: 1080 }, '9:16', 'contain'), 1080), { w: 1080, h: 1920 });
  assert.deepEqual(dimsForShortEdge({ w: 1920, h: 1080 }, 2160), { w: 3840, h: 2160 });
  assert.deepEqual(dimsForShortEdge({ w: 2520, h: 1080 }, 2160), { w: 4096, h: 1756 });
  /* the frame's own shape, not its rounded pixels': 16:9 around a 2:1 film is 2160 × 1216, and comes out 1920 × 1080 */
  const wide = frameBox({ w: 2160, h: 1080 }, '16:9', 'contain');
  assert.deepEqual([wide.w, wide.h], [2160, 1216]);
  assert.deepEqual(dimsForShortEdge(wide, 1080), { w: 1920, h: 1080 });
  assert.deepEqual(dimsForShortEdge(wide, 2160), { w: 3840, h: 2160 });
  /* a frame drawn as a page (subtitles over it) keeps that shape */
  assert.deepEqual(dimsForShortEdge(frameBox(wide, 'native', 'contain'), 1080), { w: 1920, h: 1080 });
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
    /* ProRes on the Mac's ProRes engine when it has one, ffmpeg's own encoder otherwise */
    if (name === 'prores') assert.equal(done.encoder, (await hardwareEncoder('prores', await encoders())) ?? 'prores_ks', codec);
  }
  const hevc = can.hevc ? (await exported({ kind: 'video', codec: 'hevc', fps: 5, range: [0, 0.2] })).out : null;
  if (hevc) assert.equal(probe(hevc, 'stream=codec_tag_string'), 'hvc1', 'HEVC that Apple players open');
});

test('every codec carries the colors the page draws, tagged BT.709, through the graphics chip and without it', { ...ffmpeg, timeout: 300_000 }, async () => {
  const dir = join(scratch, 'Colors');
  mkdirSync(dir, { recursive: true });
  /* saturated red and green, where BT.601 and BT.709 differ most */
  writeFileSync(join(dir, 'colors.html'), `<!doctype html><body style="margin:0;width:320px;height:180px;background:#00ff00"><div style="position:absolute;left:0;top:0;width:160px;height:180px;background:#ff0000"></div>
<script>window.film={duration:0.4,width:320,height:180,frame(t){}}</script></body>`);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ src: 'colors.html', id: 'colors' }] }] }));
  const can = await exportCapabilities();
  const codecs = ['h264', 'prores422hq', 'prores4444', 'vp9', ...(can.hevc ? ['hevc'] : []), ...(can.hevcAlpha ? ['hevc_alpha'] : [])];
  for (const codec of codecs) {
    for (const hardware of [true, false]) {
      const done = await exported({ kind: 'video', codec, fps: 5, hardware }, 'Colors', dir);
      const label = `${codec}${hardware ? '' : ' without the chip'}`;
      assert.equal(probe(done.out, 'stream=color_space,color_primaries,color_transfer'), 'bt709,bt709,bt709', label);
      const frame = firstFrame(done.out);
      assert.ok(near(frame.at(80, 90), [255, 0, 0], 10), `${label}: red ${frame.at(80, 90)}`);
      assert.ok(near(frame.at(240, 90), [0, 255, 0], 10), `${label}: green ${frame.at(240, 90)}`);
      /* its alpha layer whole: ffmpeg copying such a file drops the layer's parameter sets, and Apple's apps open it no more */
      if (codec === 'hevc_alpha') assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-i', done.out, '-f', 'null', '-'], { encoding: 'utf8' }).stderr, '', `${label}: decodes without an error`);
    }
  }
});

test('footage no browser reads, placed whole (no trim): its length is ffprobe\'s, in a video and in a draft', { ...ffmpeg, timeout: 240_000 }, async () => {
  const dir = join(scratch, 'Whole ProRes');
  mkdirSync(dir, { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=1.2', '-c:v', 'prores_ks', '-profile:v', '3', join(dir, 'pro.mov')]);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'pro', src: 'pro.mov' }] }] }));
  const video = await exported({ kind: 'video', fps: 25 }, 'Whole ProRes', dir);
  const length = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video.out]).toString());
  assert.ok(Math.abs(length - 1.2) < 0.05, `${length} s`);
  const drafts = join(scratch, 'Whole ProRes drafts');
  mkdirSync(drafts, { recursive: true });
  const exports = createExports({ captions: subtitles, drafts: () => drafts });
  const draft = await ended(exports, exports.start(project('Whole ProRes', dir), { kind: 'nle', format: 'jianying', fps: 25 }));
  assert.equal(draft.status, 'done', draft.error);
  assert.equal(JSON.parse(readFileSync(draft.out, 'utf8')).duration, 1_200_000);
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
  /* the moments picked, each named by the scene it is in: of two showing, the one that started last */
  const picked = await exported({ kind: 'stills', format: 'png', shortEdge: 90, at: [0.2, 0.7, 0.9] }, 'Picked');
  assert.deepEqual(zipNames(picked.out).names, ['01 title.png', '02 badge.png', '03 badge.png']);
  const poster = await exported({ kind: 'poster', format: 'jpg', at: 0.25, frame: '1:1', shortEdge: 100 });
  assert.equal(poster.out, join(exportsRoot(), 'Tiny poster.jpg'));
  const jpg = readFileSync(poster.out);
  assert.equal(jpg[0], 0xff);
  assert.equal(probe(poster.out, 'stream=width,height'), '100,100');
});

test('picked frames export as separate images or an explicit zip, including a one-frame zip', ffmpeg, async () => {
  const files = await exported({ kind: 'stills', as: 'files', format: 'png', shortEdge: 90, at: [0.2, 0.7] }, 'Separate');
  assert.deepEqual(files.outputs.map((f) => basename(f)), ['Separate stills 01 title.png', 'Separate stills 02 badge.png']);
  assert.equal(files.out, files.outputs[0]);
  for (const file of files.outputs) assert.equal(probe(file, 'stream=width,height'), '160,90');
  const original = readFileSync(files.outputs[0]);
  const again = await exported({ kind: 'stills', as: 'files', format: 'png', shortEdge: 90, at: [0.2] }, 'Separate');
  assert.notEqual(again.out, files.outputs[0], 'an existing image is never overwritten');
  assert.deepEqual(readFileSync(files.outputs[0]), original);
  const zip = await exported({ kind: 'stills', as: 'zip', format: 'jpg', shortEdge: 90, at: [0.2] }, 'One zipped');
  assert.ok(zip.out.endsWith('.zip'));
  assert.deepEqual(zipNames(zip.out).names, ['01 title.jpg']);
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
  /* the moments picked, a page each, each named by its scene */
  const picked = zipEntries((await exported({ kind: 'slides', format: 'pptx', shortEdge: 180, at: [0.2, 0.3, 0.7] }, 'Picked')).out);
  assert.ok(picked.has('ppt/slides/slide3.xml') && !picked.has('ppt/slides/slide4.xml'), 'three moments, three slides');
  assert.deepEqual([1, 2, 3].map((n) => picked.get(`ppt/notesSlides/notesSlide${n}.xml`).toString().match(/<a:t>([^<]*)<\/a:t>/)?.[1]), ['title', 'title', 'badge']);
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

test('an editing project\'s copied files get names of their own when two differ only in case or in how an accent is written', () => {
  const facts = { duration: 4, hasAudio: true, channels: 2, sampleRate: 48000 };
  const sound = (id, src, at) => ({ id, src, path: join(scratch, src), at, from: 0, to: 2, speed: 1, volume: 1, enabled: true, role: 'voice', facts });
  const nfc = 'caf\u00e9', nfd = 'cafe\u0301';
  const timeline = planNleTimeline({ stage: { w: 320, h: 180 }, duration: 6, pictures: [], sounds: [
    sound('a', `assets/a/${nfc}.wav`, 0), sound('b', `assets/b/${nfd}.wav`, 2), sound('c', `assets/c/CAF\u00c9.wav`, 4),
  ] }, { title: 'Names', fps: 25, audio: 'clips', media: 'copy', mediaDir: '/out/media' });
  const names = timeline.files.map((f) => f.name);
  assert.equal(names.length, 3);
  assert.equal(new Set(names.map((n) => n.toLowerCase().normalize('NFC'))).size, 3, names.join(', '));
  assert.deepEqual(timeline.files.map((f) => f.job.from), ['a', 'b', 'c'].map((d, i) => join(scratch, `assets/${d}/${[nfc, nfd, 'CAF\u00c9'][i]}.wav`)));
});

test('Premiere XML timecode matches a full video conversion without moving source-relative cuts', ffmpeg, async () => {
  const folder = join(scratch, 'Source timecode');
  mkdirSync(folder);
  const source = join(folder, 'Camera Original.mkv');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i',
    'color=red:s=160x90:r=25:d=4[r];color=green:s=160x90:r=25:d=4[g];color=blue:s=160x90:r=25:d=4[b];[r][g][b]concat=n=3:v=1:a=0',
    '-c:v', 'libx264', '-metadata', 'timecode=01:00:00:00', source]);
  assert.equal((await probeSource(source)).timecode?.value, '01:00:00:00', 'Matroska uses uppercase TIMECODE metadata');
  writeFileSync(join(folder, 'film.html'), filmHtml({ stage: { w: 160, h: 90 }, tracks: [
    { clips: [{ id: 'plain-cut', src: 'Camera Original.mkv', at: 0, time: [4, 6] }] },
  ] }));
  const done = await exported({ kind: 'nle', format: 'xml', fps: 25, audio: 'clips', subtitles: false }, 'Source timecode', folder);
  const converted = done.outputs.find((path) => path.endsWith('.mov'));
  assert.ok(converted);
  assert.equal((await probeSource(converted)).timecode?.value, '01:00:00:00');
  const [{ error, found }] = await parseXml([readFileSync(done.out, 'utf8')], (doc) => {
    const text = (selector) => doc.querySelector(selector)?.textContent;
    return { source: text('file > timecode > string'), rate: text('file > timecode > rate > timebase'),
      sequence: text('sequence > timecode > string'), start: text('clipitem > start'), end: text('clipitem > end'),
      from: text('clipitem > in'), to: text('clipitem > out') };
  });
  assert.equal(error, null);
  assert.deepEqual(found, { source: '01:00:00:00', rate: '25', sequence: '00:00:00:00', start: '0', end: '50', from: '100', to: '150' });
});

test('Final Cut Pro keeps source audio rows when an effect overlaps adjacent narration clips', () => {
  const facts = { duration: 120, hasAudio: true, channels: 2, sampleRate: 48000 };
  const sound = (id, track, at, to) => ({ id, track, at, from: 0, to, speed: 1, volume: 1, enabled: true,
    role: 'voice', src: `${id}.wav`, path: join(scratch, `${id}.wav`), facts });
  const film = { stage: { w: 320, h: 180 }, duration: 120, pictures: [], sounds: [
    sound('story-01-1', 1, 0.4, 4.98), sound('story-01-2', 1, 5.5683, 5.82),
    sound('game-sfx-1', 2, 5.4, 0.333), sound('adventure-music', 3, 0, 120),
  ] };
  const opts = { title: 'Source tracks', fps: 60, audio: 'clips', media: 'copy', mediaDir: scratch };
  const timeline = planNleTimeline(film, { ...opts, audioTracks: 'source' });
  assert.deepEqual(timeline.audio.map((t) => t.clips.map((c) => c.name)), [
    ['story-01-1', 'story-01-2'], ['game-sfx-1'], ['adventure-music'],
  ]);
  assert.deepEqual(timeline.audio.map((t) => t.sourceTrack), [1, 2, 3]);
  const xml = fcpxmlDocument(timeline);
  assert.match(xml, /name="story-01-1" lane="-1"[^>]*role="OpenFilm A1"/);
  assert.match(xml, /name="story-01-2" lane="-1"[^>]*role="OpenFilm A1"/);
  assert.match(xml, /name="game-sfx-1" lane="-2"[^>]*role="OpenFilm A2"/);
  assert.match(xml, /name="adventure-music" lane="-3"[^>]*role="OpenFilm A3"/);
  assert.notDeepEqual(planNleTimeline(film, opts).audio.map((t) => t.clips.map((c) => c.name)), timeline.audio.map((t) => t.clips.map((c) => c.name)), 'other editors keep their existing role grouping');
  const overlapping = planNleTimeline({ ...film, sounds: [...film.sounds, sound('overlapping-voice', 1, 1, 2)] }, { ...opts, audioTracks: 'source' });
  assert.equal(overlapping.audio.length, 4, 'only an overlap within a source row needs another lane');
  assert.deepEqual(overlapping.audio.map((t) => t.sourceTrack), [1, 1, 2, 3]);
  assert.match(fcpxmlDocument(overlapping), /name="overlapping-voice"[^>]*role="OpenFilm A1"/);
  const reversed = planNleTimeline({ ...film, sounds: [...film.sounds].reverse() }, { ...opts, audioTracks: 'source' });
  assert.deepEqual(reversed.audio.map((t) => t.clips.map((c) => c.name)), timeline.audio.map((t) => t.clips.map((c) => c.name)));
  const { track, ...untracked } = film.sounds[0];
  assert.throws(() => planNleTimeline({ ...film, sounds: [untracked] }, { ...opts, audioTracks: 'source' }), /story-01-1 has no source track/);
});

test('Final Cut Pro footage audio follows its own picture, including reused sources and processed audio', async () => {
  const facts = { w: 320, h: 180, duration: 20, fps: 25, hasVideo: true, hasAudio: true, channels: 2, sampleRate: 48000 };
  const picture = (id, track, at, end, from) => ({ id, track, at, end, from, kind: 'video',
    src: 'source.mov', path: join(scratch, 'source.mov'), speed: 1, hidden: false, facts });
  const pictures = [picture('main', 1, 0, 3, 0), picture('next', 1, 3, 8, 3),
    picture('overlay', 0, 1, 4, 2), picture('reused overlay', 0, 5, 7, 10)];
  const sounds = pictures.map((p) => ({ ...p, picture: p.id, role: 'footage', to: p.from + p.end - p.at,
    enabled: p.id !== 'main', volume: 0.5, ...(p.id === 'reused overlay' ? { fade: [0.2, 0.3] } : {}) }));
  sounds.push({ ...sounds[2], id: 'independent', picture: undefined, track: 2, enabled: true });
  const plans = [25, 29.97].map((fps) => planNleTimeline({
    stage: { w: 320, h: 180 }, duration: 8, pictures, sounds,
  }, { title: 'Linked footage', fps, audio: 'clips', media: 'copy', mediaDir: scratch, audioTracks: 'source' }));
  const parsed = await parseXml(plans.map((plan) => fcpxmlDocument(plan)), (doc) => {
    const seconds = (value) => {
      const [n, d = '1'] = (value ?? '0s').replace(/s$/, '').split('/');
      return Number(n) / Number(d);
    };
    const at = (el) => el.parentElement.tagName === 'spine' ? seconds(el.getAttribute('offset'))
      : at(el.parentElement) + seconds(el.getAttribute('offset')) - seconds(el.parentElement.getAttribute('start'));
    const clips = [...doc.querySelectorAll('audio, asset-clip[srcEnable="audio"]')].map((el) => ({
      name: el.getAttribute('name'), parent: el.parentElement.getAttribute('name'), parentTag: el.parentElement.tagName,
      owner: el.parentElement.parentElement.getAttribute('name'), at: at(el),
      from: seconds(el.getAttribute('start')), enabled: el.getAttribute('enabled'),
      volume: Boolean(el.querySelector('adjust-volume')), keyframes: el.querySelectorAll('keyframe').length,
    }));
    const overlay = doc.querySelector('clip[name="overlay"]');
    overlay.setAttribute('offset', `${seconds(overlay.getAttribute('offset')) + 1}s`);
    return { clips, moved: overlay.querySelector('audio') ? at(overlay.querySelector('audio')) : null, ambiguous: doc.querySelectorAll('asset-clip').length };
  });
  for (const [i, { error, found }] of parsed.entries()) {
    assert.equal(error, null);
    const plan = plans[i];
    assert.equal(found.clips.length, sounds.length, 'each sound appears exactly once as audio');
    const fps = plan.rate.fps;
    for (const original of sounds) {
      const clip = plan.audio.flatMap((track) => track.clips).find((clip) => clip.name === original.id);
      const actual = found.clips.find((clip) => clip.name === original.id);
      assert.ok(actual, original.id);
      assert.equal(actual.parent, original.picture ?? 'main', original.id);
      assert.equal(actual.parentTag, original.picture ? 'video' : 'clip', original.id);
      if (original.picture) assert.equal(actual.owner, original.picture, original.id);
      assert.equal(Math.round(actual.at * fps), clip.start, original.id);
      assert.equal(Math.round(actual.from * fps), clip.in, original.id);
      assert.equal(actual.enabled, original.enabled ? '1' : '0', original.id);
      assert.ok(actual.volume, original.id);
    }
    assert.equal(found.ambiguous, 0, 'audio nodes cannot enable video from an A/V asset');
    assert.ok(found.clips.find((clip) => clip.name === 'reused overlay').keyframes > 0);
    assert.ok(Math.abs(found.moved - 2) < 1 / fps, 'moving an overlay moves its sound by the same amount');
  }
});

test('Final Cut Pro keeps original audio paired when its picture is rendered', async () => {
  const facts = { w: 320, h: 180, duration: 8, hasVideo: true, hasAudio: true, channels: 2, sampleRate: 48000 };
  const documents = [1, 2].map((speed) => {
    const picture = { id: 'rendered', kind: 'video', src: 'source.mov', path: join(scratch, 'source.mov'),
      at: 1, end: 3, from: 2, speed, track: 0, hidden: false, styled: true, facts };
    const plan = planNleTimeline({ stage: { w: 320, h: 180 }, duration: 4, pictures: [picture],
      sounds: [{ ...picture, picture: picture.id, to: 2 + 2 * speed, volume: 0.5, enabled: true, role: 'footage' }],
    }, { title: 'Rendered footage', fps: 25, audio: 'clips', media: 'copy', mediaDir: scratch, audioTracks: 'source' });
    return fcpxmlDocument(plan);
  });
  for (const { error, found } of await parseXml(documents, (doc) => {
    const picture = doc.querySelector('clip[name="rendered"]');
    const audio = picture.querySelector('video > audio');
    return { linked: Boolean(audio), offset: audio?.getAttribute('offset'), count: doc.querySelectorAll('audio').length };
  })) {
    assert.equal(error, null);
    assert.ok(found.linked, 'rendering the picture must not detach its original sound');
    assert.equal(found.offset, '0/25s');
    assert.equal(found.count, 1);
  }
});

test('Final Cut Pro exports Studio row names for empty tracks, overlaps and footage sound', ffmpeg, async () => {
  const folder = join(scratch, 'Source rows');
  mkdirSync(folder);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=160x90:rate=25:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', join(folder, 'picture.mp4')]);
  for (const name of ['voice.wav', 'music.wav']) writeFileSync(join(folder, name), readFileSync(join(root, 'assets/tone.wav')));
  const definitions = [
    { clips: [{ id: 'picture', src: 'picture.mp4', at: 0, time: [0, 1] }] },
    { clips: [] },
    { clips: [{ id: 'voice', src: 'voice.wav', at: 0, time: [0, 1] },
      { id: 'overlap', src: 'voice.wav', at: 0.5, time: [0, 0.5] }] },
    { clips: [{ id: 'music', src: 'music.wav', at: 0, time: [0, 1] }] },
  ];
  const doc = { stage: { w: 160, h: 90 }, tracks: definitions };
  writeFileSync(join(folder, 'film.html'), filmHtml(doc));
  const evaluated = definitions.flatMap((track, index) => track.clips.map((clip) => ({
    clipId: clip.id, key: clip.id, src: clip.src, loc: `film.html#${index}.${track.clips.indexOf(clip)}`,
    startMs: clip.at * 1000, durMs: (clip.time[1] - clip.time[0]) * 1000,
    track: { index, kind: index === 0 ? 'video' : 'audio', name: index === 0 ? 'video' : 'audio' },
  })));
  const studio = layoutTracks({ doc, scenes: [], captions: [],
    videos: evaluated.filter((clip) => clip.track.kind === 'video'),
    sounds: evaluated.filter((clip) => clip.track.kind === 'audio').map((clip) => ({ ...clip, kind: 'voice' })),
  });
  assert.deepEqual(studio.map((row) => row.badge), ['V2', 'V1', 'A1', 'A2', 'A3']);
  const expected = Object.fromEntries(studio.flatMap((row) => row.blocks.map((clip) => [clip.clipId, `OpenFilm ${row.badge}`])));
  const done = await exported({ kind: 'nle', format: 'fcpxml', fps: 25, audio: 'clips', subtitles: false }, 'Source rows', folder);
  const [{ error, found }] = await parseXml([readFileSync(done.out, 'utf8')], (doc) =>
    Object.fromEntries([...doc.querySelectorAll('audio')].map((audio) => [audio.getAttribute('name'), audio.getAttribute('role')])));
  assert.equal(error, null);
  assert.deepEqual(found, expected);
});

test('Final Cut Pro reports unreadable subtitles before writing an incomplete export', async () => {
  const exports = createExports({ captions: async () => { throw new Error('subtitle storage is unreadable'); } });
  const name = 'Unreadable captions';
  const done = await ended(exports, exports.start(project(name), { kind: 'nle', format: 'fcpxml', subtitles: true }));
  assert.equal(done.status, 'failed');
  assert.match(done.error, /subtitle storage is unreadable/);
  assert.deepEqual(done.outputs, []);
  assert.ok(!readdirSync(process.env.OPENFILM_EXPORTS).some((entry) => entry.includes(name)), 'no incomplete folder is published');
});

test('Final Cut Pro connections retain their parent and sequence positions across cuts, trims and gaps', async () => {
  const clip = (name, start, end, from, fileId = 'picture') => ({ name, start, end, in: from, out: from + end - start, fileId, enabled: true });
  const primary = [clip('first', 10, 35, 50), clip('second', 40, 70, 5), clip('third', 70, 100, 30)];
  const overlays = [clip('overlay-a', 20, 60, 7), clip('overlay-b', 50, 90, 9)];
  const across = clip('across-gap', 5, 105, 0);
  const music = clip('music', 0, 110, 0, 'sound');
  const voice = clip('voice', 55, 75, 12, 'sound');
  const caption = clip('Caption & <text>\nNext line', 55, 85, 0);
  const gapCaption = clip('Caption in gap', 37, 50, 0);
  const expected = [...primary, ...overlays, across, music, voice, caption, gapCaption];
  const rates = [25, 29.97];
  const documents = rates.map((fps) => {
    const rate = nleRate(fps);
    const cues = [caption, gapCaption].map((c) => ({
      text: c.name, startMs: c.start / rate.fps * 1000, durMs: (c.end - c.start) / rate.fps * 1000,
    }));
    return fcpxmlDocument({
      name: 'Connected\tclips\nwith\rnames', rate, width: 1920, height: 1080, durationFrames: 110,
      files: [
        { id: 'picture', name: 'picture.mov', path: join(scratch, 'picture.mov'), durationFrames: 200, video: { w: 1920, h: 1080, still: false, alpha: true } },
        { id: 'sound', name: 'sound.wav', path: join(scratch, 'sound.wav'), durationFrames: 200, audio: { channels: 2, sampleRate: 48000 } },
      ],
      video: [{ enabled: true, clips: primary }, { enabled: true, clips: overlays }, { enabled: true, clips: [across] }],
      audio: [{ enabled: true, clips: [music] }, { enabled: true, clips: [voice] }],
    }, { cues });
  });
  const parsed = await parseXml(documents, (doc) => {
    const seconds = (value) => {
      const [n, d = '1'] = (value ?? '0s').replace(/s$/, '').split('/');
      return Number(n) / Number(d);
    };
    const attr = (el, name) => seconds(el.getAttribute(name));
    const clips = [];
    const visit = (el, parentAt, parentIn) => {
      const at = parentAt + attr(el, 'offset') - parentIn;
      if (['clip', 'audio', 'title'].includes(el.tagName)) clips.push({
        name: el.getAttribute('name'), parent: el.parentElement?.getAttribute('name'),
        at, end: at + attr(el, 'duration'), from: attr(el, 'start'),
      });
      for (const child of el.children) if (['clip', 'video', 'audio', 'gap', 'title'].includes(child.tagName)) visit(child, at, attr(el, 'start'));
    };
    const spine = doc.querySelector('sequence > spine');
    for (const child of spine.children) visit(child, 0, 0);
    return { name: doc.querySelector('project').getAttribute('name'), primary: [...spine.children].map((el) => el.tagName === 'gap' ? 'gap' : el.getAttribute('name')), clips };
  });
  for (const [i, { error, found }] of parsed.entries()) {
    assert.equal(error, null);
    assert.equal(found.name, 'Connected\tclips\nwith\rnames');
    assert.deepEqual(found.primary, ['gap', 'first', 'gap', 'second', 'third', 'gap']);
    assert.equal(found.clips.length, expected.length);
    const fps = nleRate(rates[i]).fps;
    for (const original of expected) {
      const actual = found.clips.find((c) => c.name === original.name);
      assert.ok(actual, original.name);
      assert.deepEqual([actual.at, actual.end, actual.from].map((t) => Math.round(t * fps)), [original.start, original.end, original.in], original.name);
    }
    const parents = Object.fromEntries(found.clips.map((c) => [c.name, c.parent]));
    assert.equal(parents['overlay-a'], 'first');
    assert.equal(parents['overlay-b'], 'second');
    assert.equal(parents.voice, 'second');
    assert.equal(parents['across-gap'], 'OpenFilm');
    assert.equal(parents[caption.name], 'second');
    assert.equal(parents[gapCaption.name], 'OpenFilm');
  }
});

test('Final Cut Pro export packages FCPXML, rendered pages, audio and optional subtitle sidecars', ffmpeg, async () => {
  for (const audio of ['clips', 'stems']) {
    const done = await exported({ kind: 'nle', format: 'fcpxml', fps: 25, audio, subtitles: audio === 'clips' });
    assert.match(done.out, /Tiny\.fcpxml$/);
    for (const file of done.outputs) assert.ok(existsSync(file), file);
    assert.equal(done.outputs.some((f) => f.endsWith('.srt')), audio === 'clips');
    const [{ error, found }] = await parseXml([readFileSync(done.out, 'utf8')], (doc) => ({
      version: doc.documentElement.getAttribute('version'),
      primary: [...doc.querySelectorAll('sequence > spine > clip')].map((c) => c.getAttribute('name')),
      clips: [...doc.querySelectorAll('clip, audio')].map((c) => ({ name: c.getAttribute('name'), role: c.getAttribute('role'), lane: Number(c.getAttribute('lane')), enabled: c.getAttribute('enabled'), kind: c.tagName === 'clip' ? 'video' : 'audio' })),
      media: [...doc.querySelectorAll('media-rep')].map((m) => m.getAttribute('src')),
      formats: [...doc.querySelectorAll('format')].map((f) => f.getAttribute('frameDuration')),
      subtitles: [...doc.querySelectorAll('title > text')].map((c) => c.textContent),
      captions: doc.querySelectorAll('caption').length,
    }));
    assert.equal(error, null);
    assert.equal(found.version, '1.10');
    assert.deepEqual(found.subtitles, audio === 'clips' ? ['Ann：Hello there', 'And welcome'] : []);
    assert.equal(found.captions, 0, 'subtitles use ordinary title clips instead of the fixed caption area');
    assert.deepEqual(found.primary, ['title'], 'Studio’s main picture track becomes the primary storyline');
    assert.equal(found.clips.filter((c) => c.kind === 'video').length, 2);
    assert.ok(found.clips.some((c) => c.kind === 'audio' && c.lane < 0));
    if (audio === 'clips') {
      assert.equal(found.clips.find((c) => c.name === 'tone')?.role, 'OpenFilm A1');
      assert.equal(found.clips.find((c) => c.name === 'click')?.role, 'OpenFilm A2');
      assert.equal(found.clips.find((c) => c.name === 'bed')?.role, 'OpenFilm A3');
    } else {
      assert.equal(found.clips.find((c) => c.name === 'Voice stem')?.role, 'dialogue.Voice');
      assert.equal(found.clips.find((c) => c.name === 'SFX stem')?.role, 'effects');
      assert.equal(found.clips.find((c) => c.name === 'Music stem')?.role, 'music');
    }
    assert.ok(found.formats.every((f) => f === '1/25s'));
    for (const url of found.media) assert.ok(existsSync(fileURLToPath(url)), url);
  }
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
  assert.equal(probe(join(folder, 'media', 'title.mov'), 'stream=codec_name,pix_fmt').split(',')[0], 'prores', 'ProRes 4444 for the other editors');
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
  const paths = new Map(found.video.flat().concat(found.audio.flat()).filter((c) => c.path).map((c) => [c.file, fileURLToPath(c.path.replace(/^file:\/\/localhost\//, 'file:///'))]));
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

test('剪映: the same timeline as a draft in 剪映\'s drafts folder, its media beside it, subtitles a text track', { ...ffmpeg, timeout: 240_000 }, async () => {
  /* the Cut project the editing-software test made */
  const cut = join(scratch, 'Cut');
  const drafts = join(scratch, 'JianyingPro Drafts');
  mkdirSync(drafts, { recursive: true });
  const exports = createExports({ captions: subtitles, drafts: (app) => (app === 'jianying' ? drafts : null) });
  const done = await ended(exports, exports.start(project('Cut', cut), { kind: 'nle', format: 'jianying', fps: 25 }));
  assert.equal(done.status, 'done', done.error);
  const folder = join(drafts, 'Cut');
  assert.equal(done.out, join(folder, 'draft_info.json'));
  assert.deepEqual(readdirSync(folder).sort(), ['draft_content.json', 'draft_info.json', 'draft_meta_info.json', 'media']);
  assert.equal(readFileSync(join(folder, 'draft_content.json'), 'utf8'), readFileSync(join(folder, 'draft_info.json'), 'utf8'));
  assert.deepEqual(readdirSync(drafts).filter((n) => n.startsWith('.')), [], 'no half-made draft');
  /* a page lossless, with its alpha (剪映 shows PNG's on both systems), and clear where the page draws nothing */
  const page = join(folder, 'media', 'title.mov');
  assert.equal(probe(page, 'stream=codec_name,pix_fmt'), 'png,rgba');
  const corner = execFileSync('ffmpeg', ['-v', 'error', '-i', page, '-frames:v', '1', '-vf', 'crop=1:1:200:120,format=rgba', '-f', 'rawvideo', '-']);
  assert.equal(corner[3], 0, 'transparent away from the page\'s box');
  /* the page holds still: its first and last pictures, for its whole second */
  assert.equal(frameCount(page), 2);
  assert.equal(Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', page]).toString()), 1);
  const info = JSON.parse(readFileSync(done.out, 'utf8'));
  const meta = JSON.parse(readFileSync(join(folder, 'draft_meta_info.json'), 'utf8'));
  assert.deepEqual([meta.draft_name, meta.draft_fold_path, meta.draft_root_path, meta.draft_id], ['Cut', folder, drafts, info.id]);
  assert.deepEqual(info.canvas_config, { width: 320, height: 180, ratio: 'original' });
  assert.equal(info.fps, 25);
  /* every clip's material is a file in the draft's media folder */
  const materials = new Map([...info.materials.videos, ...info.materials.audios].map((m) => [m.id, m]));
  for (const seg of info.tracks.filter((t) => t.type !== 'text').flatMap((t) => t.segments)) {
    const m = materials.get(seg.material_id);
    assert.ok(m && existsSync(m.path) && m.path.startsWith(join(folder, 'media')), `${m?.path}`);
  }
  /* the footage plays its own sound at its level, so there is no second clip of it */
  const shot = info.tracks.flatMap((t) => t.segments).find((s) => materials.get(s.material_id)?.path.endsWith('shot one.mp4') && s.clip);
  assert.equal(shot.volume, 0.5);
  assert.deepEqual(shot.target_timerange, { start: 0, duration: 1_600_000 });
  assert.deepEqual(shot.source_timerange, { start: 400_000, duration: 1_600_000 });
  /* the muted bed comes muted */
  assert.equal(info.tracks.find((t) => t.type === 'audio' && t.name === 'Music').attribute, 1);
  const text = info.tracks.find((t) => t.type === 'text');
  assert.deepEqual(info.materials.texts.map((m) => JSON.parse(m.content).text), CUES.map((c) => c.text));
  assert.deepEqual(text.segments.map((s) => s.target_timerange.start), [0, 800_000]);
  /* a drafts folder that refuses the write: the draft in the exports folder, said so, rather than no draft */
  if (process.platform === 'win32' || process.getuid?.() === 0) return;
  chmodSync(drafts, 0o555);
  try {
    const refused = await ended(exports, exports.start(project('Cut', cut), { kind: 'nle', format: 'jianying', fps: 25 }));
    assert.equal(refused.status, 'done', refused.error);
    assert.equal(refused.draftsRefused, drafts);
    assert.ok(refused.out.startsWith(exportsRoot()), refused.out);
  } finally {
    chmodSync(drafts, 0o755);
  }
});

test('剪映: a page with no clear pixel in any frame comes as H.264, one clear for a single frame stays PNG', { ...ffmpeg, timeout: 240_000 }, async () => {
  const dir = join(scratch, 'Opaque');
  mkdirSync(dir, { recursive: true });
  /* both fill the frame; `blink` lets the stage through for one frame (0.4 s, the eleventh at 25 fps) */
  const page = (clearAt) => `<!doctype html><body style="margin:0;width:320px;height:180px"><script>window.film={duration:1,width:320,height:180,frame(t){
document.body.style.background=${clearAt === null ? 'false' : `Math.abs(t-${clearAt})<0.01`}?'transparent':'hsl('+Math.round(t*300)+',70%,40%)'}}</script></body>`;
  writeFileSync(join(dir, 'solid.html'), page(null));
  writeFileSync(join(dir, 'blink.html'), page(0.4));
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ src: 'solid.html', id: 'solid' }, { src: 'blink.html', id: 'blink', at: 1 }] }] }));
  const drafts = join(scratch, 'Opaque drafts');
  mkdirSync(drafts, { recursive: true });
  const seen = [];
  const exports = createExports({ captions: subtitles, drafts: (app) => (app === 'jianying' ? drafts : null), onChange: (job) => seen.push(job) });
  const media = async (alpha) => {
    const done = await ended(exports, exports.start(project('Opaque', dir), { kind: 'nle', format: 'jianying', fps: 25, subtitles: false, ...(alpha ? { alpha } : {}) }));
    assert.equal(done.status, 'done', done.error);
    /* `blink` is drawn opaque up to its clear frame, then again with its alpha: what was drawn stays counted */
    const progress = seen.filter((j) => j.id === done.id && j.status === 'running').map((j) => j.progress);
    assert.deepEqual(progress.filter((v, i) => i && v < progress[i - 1]), [], 'progress never goes back');
    return (name) => join(dirname(done.out), 'media', name);
  };
  const auto = await media();
  assert.equal(probe(auto('solid.mov'), 'stream=codec_name,pix_fmt'), 'h264,yuv420p', 'opaque in every frame: H.264');
  /* the first frame is hsl(0, 70%, 40%): rgb(173, 31, 31), in the colors Studio shows, tagged so editors read them so */
  const red = (file) => firstFrame(file).at(160, 90);
  assert.equal(probe(auto('solid.mov'), 'stream=color_space,color_primaries,color_transfer,color_range'), 'tv,bt709,bt709,bt709', 'range, matrix, transfer, primaries');
  assert.ok(near(red(auto('solid.mov')), [173, 31, 31], 8), `H.264: ${red(auto('solid.mov'))}`);
  assert.equal(frameCount(auto('solid.mov')), 25);
  assert.equal(probe(auto('blink.mov'), 'stream=codec_name,pix_fmt'), 'png,rgba', 'one clear frame: lossless, with its alpha');
  const clear = execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.4', '-i', auto('blink.mov'), '-frames:v', '1', '-vf', 'crop=1:1:10:10,format=rgba', '-f', 'rawvideo', '-']);
  assert.equal(clear[3], 0, 'that frame clear, as Studio shows it');
  const prores = await media('prores');
  assert.equal(probe(prores('solid.mov'), 'stream=codec_name,profile'), 'prores,HQ');
  /* ProRes carries no range flag (it is video range): ffprobe before FFmpeg 7 says unknown */
  assert.match(probe(prores('solid.mov'), 'stream=color_space,color_primaries,color_transfer,color_range'), /^(tv|unknown),bt709,bt709,bt709$/, 'range, matrix, transfer, primaries');
  assert.ok(near(red(prores('solid.mov')), [173, 31, 31], 6), `ProRes: ${red(prores('solid.mov'))}`);
  assert.match(probe(prores('blink.mov'), 'stream=codec_name,profile'), /^prores,4444/);
  const png = await media('png');
  assert.equal(probe(png('solid.mov'), 'stream=codec_name'), 'png', 'all PNG when asked');
});

test('剪映: a page that fails stops the export, its error said, nothing left behind', { ...ffmpeg, timeout: 240_000 }, async () => {
  const dir = join(scratch, 'Broken');
  mkdirSync(dir, { recursive: true });
  /* `broken` throws partway, while the pages around it may be drawing */
  const page = (breaks) => `<!doctype html><body style="margin:0;width:160px;height:90px"><script>window.film={duration:2,width:160,height:90,frame(t){
${breaks ? "if(t>1)throw new Error('the page broke');" : ''}document.body.style.background='hsl('+Math.round(t*100)+',70%,40%)'}}</script></body>`;
  writeFileSync(join(dir, 'a.html'), page(false));
  writeFileSync(join(dir, 'broken.html'), page(true));
  writeFileSync(join(dir, 'c.html'), page(false));
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 160, h: 90 }, tracks: [{ clips: [{ src: 'a.html', id: 'a' }, { src: 'broken.html', id: 'broken', at: 2 }, { src: 'c.html', id: 'c', at: 4 }] }] }));
  const drafts = join(scratch, 'Broken drafts');
  mkdirSync(drafts, { recursive: true });
  const exports = createExports({ captions: subtitles, drafts: (app) => (app === 'jianying' ? drafts : null) });
  const done = await ended(exports, exports.start(project('Broken', dir), { kind: 'nle', format: 'jianying', fps: 30, subtitles: false }));
  assert.equal(done.status, 'failed');
  assert.match(done.error, /the page broke/);
  assert.deepEqual(readdirSync(drafts), [], 'no draft, and no part of one');
});

/** A film of three pages long enough to be ended partway, for a draft. */
function threePages(name) {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  const page = (hue) => `<!doctype html><body style="margin:0;width:320px;height:180px"><script>window.film={duration:4,width:320,height:180,frame(t){
document.body.style.background='hsl('+Math.round(${hue}+t*60)+',70%,40%)'}}</script></body>`;
  for (const [i, id] of ['a', 'b', 'c'].entries()) writeFileSync(join(dir, `${id}.html`), page(i * 100));
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ src: 'a.html', id: 'a' }, { src: 'b.html', id: 'b', at: 4 }, { src: 'c.html', id: 'c', at: 8 }] }] }));
  const drafts = join(scratch, `${name} drafts`);
  mkdirSync(drafts, { recursive: true });
  return { dir, drafts, exports: createExports({ captions: subtitles, drafts: (app) => (app === 'jianying' ? drafts : null) }) };
}

test('剪映: the pages\' browsers, ended partway as a crash would end them, are started again and the draft is whole', { ...ffmpeg, timeout: 240_000, skip: ffmpeg.skip || processes.skip }, async () => {
  const { dir, exports } = threePages('Crashing browsers');
  const job = exports.start(project('Crashing browsers', dir), { kind: 'nle', format: 'jianying', fps: 30, subtitles: false });
  await until(exports, job.id, (j) => ['done', 'failed', 'cancelled'].includes(j.status) || (j.framesDone ?? 0) > 20);
  /* every browser the pages are drawing in, ended at once */
  const [worker] = children(process.pid, 'render-worker');
  assert.ok(worker, 'the pages draw in a process of their own');
  const browsers = children(worker, 'chrom');
  assert.ok(browsers.length, 'with browsers of its own');
  for (const pid of browsers) end(pid);
  const done = await ended(exports, job);
  assert.equal(done.status, 'done', done.error);
  for (const id of ['a', 'b', 'c']) assert.equal(frameCount(join(dirname(done.out), 'media', `${id}.mov`)), 120, `${id}: every frame`);
});

test('剪映: the process drawing the pages, ended partway, fails the draft with the reason and leaves nothing', { ...ffmpeg, timeout: 240_000, skip: ffmpeg.skip || processes.skip }, async () => {
  const { dir, drafts, exports } = threePages('Crashing drawer');
  const job = exports.start(project('Crashing drawer', dir), { kind: 'nle', format: 'jianying', fps: 30, subtitles: false });
  await until(exports, job.id, (j) => ['done', 'failed', 'cancelled'].includes(j.status) || (j.framesDone ?? 0) > 20);
  const [worker] = children(process.pid, 'render-worker');
  assert.ok(worker);
  process.kill(worker, 'SIGKILL');
  const failed = await ended(exports, job);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /renderer stopped/);
  assert.deepEqual(readdirSync(drafts), [], 'no draft, and no part of one');
});

test('剪映: a draft cancelled partway stops drawing at once, its browsers closed, nothing left', { ...ffmpeg, timeout: 240_000, skip: ffmpeg.skip || processes.skip }, async () => {
  const { dir, drafts, exports } = threePages('Cancelled draft');
  const job = exports.start(project('Cancelled draft', dir), { kind: 'nle', format: 'jianying', fps: 30, subtitles: false });
  await until(exports, job.id, (j) => ['done', 'failed', 'cancelled'].includes(j.status) || (j.framesDone ?? 0) > 20);
  const [worker] = children(process.pid, 'render-worker');
  assert.ok(worker);
  const asked = Date.now();
  exports.cancel(job.id);
  const done = await ended(exports, job);
  assert.equal(done.status, 'cancelled');
  assert.ok(Date.now() - asked < 8000, `stopped in ${Date.now() - asked} ms`);
  assert.deepEqual(readdirSync(drafts), [], 'no draft, and no part of one');
  for (let i = 0; i < 100 && children(process.pid, 'render-worker').length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(children(process.pid, 'render-worker'), [], 'its process and browsers gone');
});

test('an editing project\'s pages share the browsers by their frames', () => {
  /* ten pages of 150 frames, three browsers: one each, three pages at once */
  assert.equal(shareOf(3, 150, 1500, 2), 1);
  /* the last page alone: as many as it would get on its own */
  assert.equal(shareOf(3, 150, 150, 2), 2);
  /* a 900-frame page among four of 150: two of three, the short ones share the third */
  assert.equal(shareOf(3, 900, 1500, 3), 2);
  assert.equal(shareOf(1, 150, 600, 2), 1);
  /* never more than are free */
  assert.equal(shareOf(1, 900, 900, 3), 1);
});

test('an export is written under a name of its own until it is whole, then renamed: none is left behind', ffmpeg, async () => {
  const exports = createExports({ captions: subtitles });
  for (const ask of [{ kind: 'video', name: 'Whole' }, { kind: 'gif', name: 'Whole' }, { kind: 'audio', name: 'Whole', stems: true }, { kind: 'stills', name: 'Whole' },
    { kind: 'slides', name: 'Whole' }, { kind: 'project', name: 'Whole' }]) {
    const done = await ended(exports, exports.start(project(), ask));
    assert.equal(done.status, 'done', `${ask.kind}: ${done.error}`);
    assert.ok(done.outputs.length && done.outputs.every((f) => existsSync(f) && basename(f).startsWith('Whole')), `${ask.kind}: ${done.outputs.join(', ')}`);
  }
  assert.deepEqual(readdirSync(exportsRoot()).filter((n) => n.includes('.partial-')), []);
});

test('a PNG video keeps each picture once, for as long as it shows: a pixel apart is not a repeat', ffmpeg, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-keep-'));
  try {
    const file = join(dir, 'page.mov');
    /* 30 clear frames; in frames 10 to 19 one pixel is a step off clear (red and alpha 1 of 255) */
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black@0:s=16x16:r=30:d=1,format=rgba,drawbox=x=3:y=3:w=1:h=1:color=0x01000001:t=fill:replace=1:enable=between(n\\,10\\,19)', '-c:v', 'png', file]);
    const decoded = (f) => execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-vf', 'format=rgba', '-fps_mode', 'cfr', '-r', '30', '-f', 'framemd5', '-']).toString().split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').pop());
    const before = decoded(file);
    await keepChanges(file, new AbortController().signal);
    assert.equal(frameCount(file), 4, 'the first, the step, the step back, the last');
    assert.deepEqual(decoded(file), before, 'every frame the same pixels at the same time');
    /* a picture that changes every third frame: far more pictures kept than ffmpeg takes in one sum */
    const busy = join(dir, 'busy.mov');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=32x32:r=10:d=40,fps=30,format=rgba', '-c:v', 'png', busy]);
    const busyBefore = decoded(busy);
    await keepChanges(busy, new AbortController().signal);
    const pictures = busyBefore.filter((sum, i) => i === 0 || i === busyBefore.length - 1 || sum !== busyBefore[i - 1]).length;
    assert.ok(pictures > 300, `${pictures} pictures`);
    assert.equal(frameCount(busy), pictures, 'each picture once, and the last frame');
    assert.deepEqual(decoded(busy), busyBefore);
    /* a long page that steps every few frames: more runs than a command line holds on Windows, the sum read from a file */
    const steps = join(dir, 'steps.mov');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=32x32:r=10:d=240,fps=30,format=rgba', '-c:v', 'png', steps]);
    const stepsBefore = decoded(steps);
    const stepPictures = stepsBefore.filter((sum, i) => i === 0 || i === stepsBefore.length - 1 || sum !== stepsBefore[i - 1]).length;
    assert.ok(stepPictures > 2000, `${stepPictures} pictures`);
    await keepChanges(steps, new AbortController().signal);
    assert.equal(frameCount(steps), stepPictures);
    assert.deepEqual(decoded(steps), stepsBefore);
    assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith('.filter')), [], 'its sum file gone');
    /* drawn as a quick PNG and changing in every frame: every frame kept, written again at ffmpeg's own settings */
    const quick = join(dir, 'quick.mov');
    const own = join(dir, 'own.mov');
    const moving = ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=64x36:r=30:d=1,format=rgba'];
    execFileSync('ffmpeg', [...moving, '-c:v', 'png', '-compression_level', '1', '-pred', 'sub', quick]);
    execFileSync('ffmpeg', [...moving, '-c:v', 'png', own]);
    const quickBefore = decoded(quick);
    await keepChanges(quick, new AbortController().signal);
    assert.equal(frameCount(quick), 30);
    assert.deepEqual(decoded(quick), quickBefore, 'the same pixels at the same time');
    const packets = (f) => execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-map', '0:v:0', '-c', 'copy', '-f', 'framemd5', '-']).toString().split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').pop());
    assert.deepEqual(packets(quick), packets(own), 'written as ffmpeg writes a PNG');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

test('burned-in bilingual subtitles: the original and its translation, each once', ffmpeg, async () => {
  /* how much of the bottom half of a picture (the title's own text is at the top) is near-white: the subtitles' text */
  const lit = (file) => {
    const [w, h] = probe(file, 'stream=width,height').split(',').map(Number);
    const rgb = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    let n = 0;
    for (let i = Math.floor(h / 2) * w; i < w * h; i++) if (Math.min(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]) > 200) n++;
    return n;
  };
  const cues = [{ startMs: 0, durMs: 900, text: 'Hello there', alt: { fr: 'Bonjour' } }];
  /* the original alone, the translation alone, then both, each in the same type: the two lines together are as much
     text as the two alone, however a font draws them; the translation twice would be a whole translation more */
  const burned = async (style, name) => {
    const exports = createExports({ captions: async () => ({ cues, style: { ...parseFilmSubtitleStyle(null), ...style } }) });
    const done = await ended(exports, exports.start(project(name), { kind: 'poster', at: 0.25, shortEdge: 360, burnSubtitles: true }));
    assert.equal(done.status, 'done', done.error);
    return lit(done.out);
  };
  const original = await burned({}, 'Original');
  const translation = await burned({ language: 'fr', bilingual: false }, 'Translation');
  const both = await burned({ language: 'fr', bilingual: true }, 'Bilingual');
  assert.ok(original > 0 && translation > 0);
  assert.ok(Math.abs(both - (original + translation)) < translation / 2, `both ${both}, original ${original}, translation ${translation}`);
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
  /* footage linked in from elsewhere: the export carries the file itself (links need Developer Mode on Windows:
     without it the footage is a copy) */
  const outside = join(dir, '..', 'shoot.mov');
  writeFileSync(outside, 'footage');
  try { symlinkSync(outside, join(dir, 'assets', 'shoot.mov')); } catch (e) {
    if (e.code !== 'EPERM') throw e;
    writeFileSync(join(dir, 'assets', 'shoot.mov'), 'footage');
  }
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

test('a project\'s export takes the files of a linked folder the film uses, as files, and leaves the rest of it out', async () => {
  const dir = fullProject();
  const library = join(dir, '..', 'Library');
  const put = (rel, text = rel) => { mkdirSync(join(library, rel, '..'), { recursive: true }); writeFileSync(join(library, rel), text); };
  put('ext.mp4');
  put('ext.vtt');
  put('ext.zh.vtt');
  put('day2/b.wav');
  put('unused.mp4');
  put('day2/unused.wav');
  /* a junction on Windows, which needs no Developer Mode; a symlink elsewhere (as Studio's link makes it) */
  symlinkSync(library, join(dir, 'assets', 'linked'), 'junction');
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [
    { clips: [{ src: 'assets/linked/ext.mp4', id: 'ext' }] },
    { clips: [{ src: 'assets/linked/day2/b.wav', id: 'b', time: [0, 1] }] },
  ] }));
  const used = ['assets/linked/day2/b.wav', 'assets/linked/ext.mp4', 'assets/linked/ext.vtt', 'assets/linked/ext.zh.vtt'];
  const names = (await projectFiles(dir, [])).map((f) => f.name);
  assert.deepEqual(names.filter((n) => n.startsWith('assets/linked/')).sort(), used);
  assert.ok((await projectSizes(dir)).work >= used.reduce((n, f) => n + f.slice('assets/linked/'.length).length, 0));
  const entries = zipEntries((await exported({ kind: 'project' }, 'My Film', dir)).out);
  assert.deepEqual([...entries.keys()].filter((n) => n.startsWith('My Film/assets/linked/')).sort(), used.map((n) => `My Film/${n}`));
  assert.equal(entries.get('My Film/assets/linked/ext.mp4').toString(), 'ext.mp4');
  const copied = (await exported({ kind: 'project', as: 'folder' }, 'My Film', dir)).out;
  for (const n of used) assert.equal(readFileSync(join(copied, ...n.split('/')), 'utf8'), n.slice('assets/linked/'.length));
  assert.ok(!existsSync(join(copied, 'assets', 'linked', 'unused.mp4')) && !existsSync(join(copied, 'assets', 'linked', 'day2', 'unused.wav')));
});

test('a project export named where it is asked for: the zip and the folder in it take that name', async () => {
  const dir = fullProject();
  const zipped = await exported({ kind: 'project', name: 'Hand-off' }, 'My Film', dir);
  assert.equal(zipped.out, join(exportsRoot(), 'Hand-off.zip'));
  assert.ok([...zipEntries(zipped.out).keys()].every((n) => n.startsWith('Hand-off/')));
  assert.equal((await exported({ kind: 'project', as: 'folder', name: 'Hand-off' }, 'My Film', dir)).out, join(exportsRoot(), 'Hand-off'));
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
    assert.deepEqual(Object.keys(listed.drafts).sort(), ['capcut', 'jianying'], 'whether 剪映 and CapCut are here, for an editing project');
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


test('a poster, and a video with its subtitles burned in, show footage no browser decodes (ProRes) through its copy', ffmpeg, async () => {
  const folder = mkdtempSync(join(tmpdir(), 'of-exports-prores-'));
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2060c0:size=320x180:rate=30', '-t', '1', '-c:v', 'prores_ks', '-profile:v', '3', join(folder, 'a.mov')]);
    writeFileSync(join(folder, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'v', src: 'a.mov', at: 0, time: [0, 1] }] }] }));
    const poster = await exported({ kind: 'poster', format: 'png', at: 0.5 }, 'ProRes', folder);
    assert.ok(near(firstFrame(poster.out).at(160, 90), [0x20, 0x60, 0xc0], 20), `the poster: ${firstFrame(poster.out).at(160, 90)}`);
    /* the film drawn inside a frame with its subtitles: the project's footage, copied for it too */
    const burned = await exported({ kind: 'video', fps: 10, range: [0, 0.5], burnSubtitles: true }, 'ProRes burned', folder);
    assert.ok(near(firstFrame(burned.out).at(160, 30), [0x20, 0x60, 0xc0], 24), `the burned video: ${firstFrame(burned.out).at(160, 30)}`);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('platforms that take the same picture are drawn once, the others get its file under their own name', ffmpeg, async () => {
  const seen = [];
  const exports = createExports({ captions: subtitles, onChange: (job) => seen.push(job) });
  const same = { kind: 'video', frame: '9:16', shortEdge: 180, fps: 10, range: [0, 0.4] };
  const queued = exports.startAll(project('Feeds'), { jobs: [{ ...same, preset: '抖音' }, { ...same, preset: '快手' }, { ...same, preset: '视频号' }, { ...same, fps: 5, preset: 'Other' }] });
  const done = [];
  for (const job of queued) done.push(await ended(exports, job));
  assert.deepEqual(done.map((j) => j.status), ['done', 'done', 'done', 'done'], done.map((j) => j.error).join(' '));
  assert.deepEqual(done.map((j) => basename(j.out)), ['Feeds · 抖音 0-0.4s.mp4', 'Feeds · 快手 0-0.4s.mp4', 'Feeds · 视频号 0-0.4s.mp4', 'Feeds · Other 0-0.4s.mp4']);
  const drawn = new Set(seen.filter((j) => j.phase === 'rendering').map((j) => j.id));
  assert.deepEqual(done.map((j) => drawn.has(j.id)), [true, false, false, true], 'only the first of the same, and the one at another rate');
  assert.ok(readFileSync(done[1].out).equals(readFileSync(done[0].out)) && readFileSync(done[2].out).equals(readFileSync(done[0].out)), 'the same file');
});

test("a drafts folder that refuses a new folder is told apart, and the probe leaves nothing behind", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-drafts-'));
  assert.equal(await writableFolder(dir), true);
  assert.deepEqual(readdirSync(dir), [], 'the probe is removed');
  assert.equal(await writableFolder(join(dir, 'missing')), false);
  /* a folder Windows (or its security software) refuses is a folder without write permission here */
  if (process.platform === 'win32' || process.getuid?.() === 0) return;
  chmodSync(dir, 0o555);
  try {
    assert.equal(await writableFolder(dir), false);
  } finally {
    chmodSync(dir, 0o755);
  }
});
