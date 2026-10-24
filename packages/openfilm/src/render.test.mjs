import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { getPriority, tmpdir, totalmem } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserPool } from './browser-pool.mjs';
import { encoders, hardwareEncoder } from './encoders.mjs';
import { filmHtml } from './film-doc.mjs';
import { launch } from './host.mjs';
import { defaultWorkers, machine, outOfMemory, render } from './render.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('the render command accepts decimal frame rates and still rejects invalid rates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-render-fps-options-'));
  try {
    const cli = fileURLToPath(new URL('../bin/openfilm.mjs', import.meta.url));
    for (const fps of ['1', '23.976', '29.97', '59.94', String(30000 / 1001), '240']) {
      const result = spawnSync(process.execPath, [cli, 'render', `--fps=${fps}`], { cwd: dir, encoding: 'utf8' });
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /is not in a project/, `--fps ${fps} passes option validation`);
    }
    for (const fps of ['0', '-1', '0.99', '240.1', 'NaN', 'Infinity']) {
      const result = spawnSync(process.execPath, [cli, 'render', `--fps=${fps}`], { cwd: dir, encoding: 'utf8' });
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /--fps is a number from 1 to 240/, `--fps ${fps} is rejected`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the render command renders 29.97 as exactly 30000/1001, and keeps another decimal rate, through encoding, blur and parallel parts', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 120_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-render-fractional-'));
  try {
    writeFileSync(join(dir, 'p.html'), '<!doctype html><body style="margin:0"><script>window.film = { duration: 0.5, width: 320, height: 180, frame(t) { document.body.style.background = `hsl(${t * 360}, 80%, 50%)`; } };</script>');
    writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'p', src: 'p.html', at: 0, time: [0, 0.5] }] }] }));
    mkdirSync(join(dir, '.film'));
    writeFileSync(join(dir, '.film', 'opened'), '');
    const cli = fileURLToPath(new URL('../bin/openfilm.mjs', import.meta.url));
    for (const [fps, rate, workers, samples] of [[29.97, '30000/1001', 1, 1], [30000 / 1001, '30000/1001', 2, 2], [12.5, '25/2', 1, 1]]) {
      const out = join(dir, `${fps}.mp4`);
      execFileSync(process.execPath, [cli, 'render', '--fps', String(fps), '--workers', String(workers), '--samples', String(samples), '--out', out], { cwd: dir, timeout: 60_000, stdio: 'pipe' });
      const { streams: [video] } = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate,avg_frame_rate,nb_read_frames', '-of', 'json', out], { encoding: 'utf8' }));
      assert.equal(video.r_frame_rate, rate);
      assert.equal(video.avg_frame_rate, rate);
      assert.equal(Number(video.nb_read_frames), Math.round(0.5 * fps));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a render with no format of its own encodes on the graphics chip when it can: H.264 for an MP4, ProRes for a MOV', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-render-chip-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><body style="margin:0"><div id="box" style="width:320px;height:180px"></div><script>'
      + 'window.film = { duration: 1, width: 320, height: 180, frame(t) { document.getElementById("box").style.background = `hsl(${t * 360}, 80%, 50%)`; } };</script>');
    const have = await encoders();
    const quiet = { workers: 1, silent: true, onProgress() {} };
    const mp4 = await render([dir, '0-0.5'], { ...quiet, out: join(dir, 'chip.mp4') });
    assert.equal(mp4.encoder, (await hardwareEncoder('h264', have)) ?? 'libx264');
    assert.match(mp4.lines[1], new RegExp(` · ${mp4.encoder} · `), 'the summary says which encoder');
    const soft = await render([dir, '0-0.5'], { ...quiet, out: join(dir, 'soft.mp4'), hardware: false });
    assert.equal(soft.encoder, 'libx264', 'hardware: false keeps the processor\'s');
    const mov = await render([dir, '0-0.5'], { ...quiet, out: join(dir, 'chip.mov'), alpha: true });
    assert.equal(mov.encoder, (await hardwareEncoder('prores', have)) ?? 'prores_ks');
    assert.equal(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,profile', '-of', 'csv=p=0', mov.out]).toString().trim(), 'prores,4444');
    const frames = (file) => parseInt(execFileSync('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file]).toString(), 10);
    assert.deepEqual([mp4.out, soft.out, mov.out].map(frames), [15, 15, 15]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an encoder that fails to start fails the render with ffmpeg\'s error, instead of waiting forever', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-render-fails-'));
  try {
    /* noise: frames too big for the pipe to take while no one reads it */
    writeFileSync(join(dir, 'index.html'), '<!doctype html><body style="margin:0"><canvas width="1280" height="720"></canvas><script>'
      + 'const c = document.querySelector("canvas").getContext("2d"), img = c.createImageData(1280, 720);'
      + 'window.film = { duration: 1, width: 1280, height: 720, frame(t) { let s = 1 + Math.round(t * 30);'
      + 'for (let i = 0; i < img.data.length; i++) { s = (s * 1103515245 + 12345) % 2147483648; img.data[i] = i % 4 === 3 ? 255 : s & 255; }'
      + 'c.putImageData(img, 0, 0); } };</script>');
    await assert.rejects(render([dir], { out: join(dir, 'out.mp4'), workers: 1, format: { video: ['-c:v', 'no_such_encoder'] } }), /^Error: ffmpeg: .*no_such_encoder/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed encode is the error told, even when its parts folder cannot be removed', { skip: (!hasFfmpeg && 'no ffmpeg') || (process.platform === 'win32' && 'no read-only folders') || (process.getuid?.() === 0 && 'root removes anything'), timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-render-held-'));
  /* the folder this render encodes its parts in, made read-only with a file in it: as Windows holds the files of an
     encoder still exiting, the folder cannot be removed */
  const work = join(dir, '.film', 'cache', 'render', `.parts-${process.pid}`);
  try {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><body><script>window.film = { duration: 1, width: 320, height: 180, frame() {} };</script>');
    mkdirSync(work, { recursive: true });
    writeFileSync(join(work, 'held'), '');
    chmodSync(work, 0o555);
    await assert.rejects(render([dir], { out: join(dir, 'out.mp4'), workers: 1, onProgress() {}, format: { video: ['-c:v', 'no_such_encoder'] } }), /^Error: ffmpeg: .*no_such_encoder/);
  } finally {
    chmodSync(work, 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an encoder out of memory is said plainly, with fewer browsers to try', () => {
  const x264 = new Error('ffmpeg: x264 [error]: malloc of size 6220800 failed\nError while opening encoder');
  assert.match(outOfMemory(x264, 5).message, /^ffmpeg ran out of memory with 5 browsers rendering at once: try fewer, for example --workers 2\nffmpeg: x264/);
  assert.match(outOfMemory(new Error('ffmpeg: exit 3221225495'), 2).message, /--workers 1\n/, 'Windows ended it for lack of memory');
  assert.match(outOfMemory(x264, 1).message, /^ffmpeg ran out of memory: close other apps and try again\n/);
  const other = new Error('ffmpeg: Unknown encoder');
  assert.equal(outOfMemory(other, 5), other, 'any other error is told as it is');
});

test('browsers: one per performance core but one, as many as the free memory holds with room to spare, enough frames each, at most four', () => {
  const GB = 2 ** 30;
  assert.equal(defaultWorkers({ cores: 4, available: 6.5 * GB }), 3, 'an M5 with 16 GB, 41% free');
  assert.equal(defaultWorkers({ cores: 4, available: 3 * GB }), 1, 'little memory free: one, never swapping');
  assert.equal(defaultWorkers({ cores: 12, available: 48 * GB }), 4, 'a big machine: four, as one graphics chip takes no more');
  assert.equal(defaultWorkers({ cores: 2, available: 16 * GB }), 1, 'two cores: one left for the person');
  assert.equal(defaultWorkers({ cores: 8, available: 32 * GB }, 100), 1, 'a short render: one browser, its start not worth more');
  assert.equal(defaultWorkers({ cores: 8, available: 32 * GB }, 240), 4);
  const { cores, available } = machine();
  assert.ok(cores >= 1 && available > 0 && available <= totalmem(), `this machine: ${cores} cores, ${available} bytes free`);
});

test('a render runs below the person\'s own apps, with every process it starts', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-render-priority-'));
  try {
    /* a project Studio has shown before (`.film/opened`), so the command goes straight to the render */
    writeFileSync(join(dir, 'p.html'), '<!doctype html><body><script>window.film = { duration: 3, width: 320, height: 180, frame() {} };</script>');
    writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'p', src: 'p.html', at: 0, time: [0, 3] }] }] }));
    mkdirSync(join(dir, '.film'));
    writeFileSync(join(dir, '.film', 'opened'), '');
    const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/openfilm.mjs', import.meta.url)), 'render', '0-3', '--workers', '1', '--out', join(dir, 'out.mp4')], { cwd: dir, stdio: 'ignore' });
    const ended = new Promise((done) => child.on('exit', done));
    /* read until it is lowered: the process may start at another nice value (a CI runner's is not 0) */
    let priority = null;
    for (const end = Date.now() + 20_000; priority !== 10 && child.exitCode == null && Date.now() < end;) {
      try { priority = getPriority(/** @type {number} */ (child.pid)); } catch { break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    await ended;
    assert.equal(priority, 10);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a transparent page comes out the same however many browsers share it', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-render-split-'));
  try {
    /* soft, see-through shapes turning over nothing: where a tab's first pictures used to come out a level off */
    writeFileSync(join(dir, 'page.html'), `<!doctype html><style>html,body{margin:0;width:960px;height:540px;background:transparent}
.b{position:absolute;width:120px;height:120px;border-radius:24px;background:linear-gradient(135deg,hsla(200,80%,60%,.8),hsla(320,80%,40%,.6));box-shadow:0 16px 48px rgba(0,0,0,.4)}</style>
<body><script>const els=[];for(let k=0;k<24;k++){const d=document.createElement('div');d.className='b';document.body.appendChild(d);els.push(d)}
window.film={duration:2,width:960,height:540,frame(t){els.forEach((d,k)=>{const a=t*0.9+k*0.37;d.style.transform='translate('+(480+Math.cos(a)*(150+k*8)-60)+'px,'+(270+Math.sin(a*1.3)*(100+k*4)-60)+'px) rotate('+(a*60)+'deg) scale('+(0.6+0.4*Math.sin(a+k))+')'})}};</script></body>`);
    writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 960, h: 540 }, tracks: [{ clips: [{ src: 'page.html', id: 'page' }] }] }));
    const format = { video: ['-c:v', 'png'], pix: 'format=rgba' };
    const sums = (file) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'format=rgba', '-f', 'framemd5', '-']).toString().split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').pop());
    const drawn = [];
    for (const workers of [1, 3]) {
      const out = join(dir, `w${workers}.mov`);
      await render([dir], { out, workers, alpha: true, silent: true, onProgress() {}, format });
      drawn.push(sums(out));
    }
    assert.equal(drawn[0].length, 60);
    assert.deepEqual(drawn[1].map((s, i) => (s === drawn[0][i] ? '' : i)).filter(String), [], 'no frame differs');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a render is written once: its parts straight into the file with the sound, and one part with nothing to add moved there', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-render-once-'));
  try {
    writeFileSync(join(dir, 'p.html'), '<!doctype html><body style="margin:0"><script>window.film = { duration: 1, width: 320, height: 180, frame(t) { document.body.style.background = `hsl(${t * 360}, 80%, 50%)`; } };</script>');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', join(dir, 'tone.wav')]);
    writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'p', src: 'p.html', at: 0, time: [0, 1] }] }, { clips: [{ id: 'tone', src: 'tone.wav' }] }] }));
    const probe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,nb_read_frames,duration', '-of', 'json', file], { encoding: 'utf8' })).streams;
    for (const [ext, workers] of [['.mp4', 1], ['.mp4', 2], ['.mov', 1], ['.mov', 2]]) {
      const streams = probe((await render([dir], { out: join(dir, `w${workers}${ext}`), workers, onProgress() {} })).out);
      assert.equal(Number(streams.find((s) => s.codec_type === 'video')?.nb_read_frames), 30, `${ext} by ${workers}: its frames`);
      assert.ok(Math.abs(Number(streams.find((s) => s.codec_type === 'audio')?.duration) - 1) < 0.05, `${ext} by ${workers}: its sound`);
    }
    /* the part a browser writes is the file, not copied: the same one on the disk */
    const part = join(dir, '.film', 'cache', 'render', `.parts-${process.pid}`, 'part-0.mov');
    let ino = null;
    const look = setInterval(() => { if (existsSync(part)) ino = statSync(part).ino; }, 5);
    const quiet = join(dir, 'quiet.mov');
    try {
      await render([dir], { out: quiet, workers: 1, silent: true, onProgress() {} });
    } finally {
      clearInterval(look);
    }
    assert.ok(ino != null, 'the part was seen while drawn');
    /* Windows may hold the part a moment after ffmpeg ends (an antivirus reading it): then it is copied, as before */
    if (process.platform !== 'win32') assert.equal(statSync(quiet).ino, ino);
    assert.equal(probe(quiet).length, 1, 'no sound asked for');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a page drawn opaque until a pixel shows through is drawn again with its alpha, in the same tabs', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-render-opaque-'));
  let started = 0;
  const pool = new BrowserPool({ start: () => { started++; return launch(); } });
  try {
    /* both fill the frame for 4 s; `blink` lets everything through at 0.4 s (frame 10 at 25 fps) */
    const page = (clearAt) => `<!doctype html><body style="margin:0;width:320px;height:180px"><script>window.film={duration:4,width:320,height:180,frame(t){
document.body.style.background=${clearAt === null ? 'false' : `Math.abs(t-${clearAt})<0.01`}?'transparent':'hsl('+Math.round(t*90)+',70%,40%)'}}</script></body>`;
    writeFileSync(join(dir, 'blink.html'), page(0.4));
    writeFileSync(join(dir, 'solid.html'), page(null));
    const formats = { format: { video: ['-c:v', 'libx264', '-crf', '16'], pix: 'format=yuv420p' }, clear: { video: ['-c:v', 'png'], pix: 'format=rgba' } };
    const ask = (name, onProgress = () => {}) => render([join(dir, `${name}.html`)], { alpha: true, silent: true, fps: 25, workers: 1, browsers: pool, ...formats, out: join(dir, `${name}.mov`), onProgress });
    const probe = (file) => execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,pix_fmt,nb_read_frames', '-of', 'csv=p=0', file]).toString().trim();
    const drawn = [];
    const blink = await ask('blink', (done) => drawn.push(done));
    assert.deepEqual([blink.clear, blink.encoder], [true, 'png']);
    /* opaque to a few frames past the clear one, then again from the first */
    const again = drawn.findIndex((d, i) => i && d < drawn[i - 1]);
    assert.ok(again > 0 && drawn[again - 1] >= 10 && drawn[again - 1] < 40, `drawn again after ${drawn[again - 1]} of 100 frames`);
    assert.equal(probe(blink.out), 'png,rgba,100');
    const at10 = execFileSync('ffmpeg', ['-v', 'error', '-i', blink.out, '-vf', 'select=eq(n\\,10),format=rgba,crop=1:1:10:10', '-frames:v', '1', '-f', 'rawvideo', '-']);
    assert.equal(at10[3], 0, 'that frame clear');
    const solid = await ask('solid');
    assert.deepEqual([solid.clear, solid.encoder], [false, 'libx264']);
    assert.equal(probe(solid.out), 'h264,yuv420p,100', 'every frame read and none clear: written as it was drawn');
    assert.equal(started, 1, 'one browser for both pages');
  } finally {
    await pool.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--subtitles burns the project\'s subtitles into its film, named as its render is; a page of it, or a film with none, is refused', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-render-subs-'));
  try {
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'page.html'), '<!doctype html><body style="margin:0;background:#204080"><script>window.film = { duration: 2, width: 640, height: 360, frame() {} };</script>');
    writeFileSync(join(dir, 'film.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=640, height=360"></head>'
      + '<body><section><iframe src="page.html"></iframe></section><section><audio src="assets/vo.wav"></audio></section></body></html>');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ac', '1', '-ar', '48000', join(dir, 'assets', 'vo.wav')]);
    writeFileSync(join(dir, 'assets', 'vo.vtt'), 'WEBVTT\n\n00:00:00.500 --> 00:00:01.800\nBurned in\n');
    const quiet = { workers: 1, silent: true, onProgress() {}, fps: 10 };
    /* the bottom third of frame n, in grey, and how many of its pixels differ from another's */
    const bottom = (file, n) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${n}),crop=iw:ih/3:0:ih*2/3,format=gray`, '-frames:v', '1', '-f', 'rawvideo', '-']);
    const changed = (a, b) => a.reduce((n, v, i) => n + (Math.abs(v - b[i]) > 48 ? 1 : 0), 0);
    const plain = await render([dir], { ...quiet, out: join(dir, 'plain.mp4') });
    const burned = await render([dir], { ...quiet, subtitles: true, out: join(dir, 'burned.mp4') });
    assert.equal(changed(bottom(plain.out, 2), bottom(plain.out, 10)), 0, 'without it, the bottom of the picture stays the same');
    assert.equal(changed(bottom(burned.out, 2), bottom(plain.out, 2)), 0, 'before the line, the picture is the film\'s');
    assert.ok(changed(bottom(burned.out, 10), bottom(burned.out, 2)) > 200, 'during the line, it is drawn at the bottom');
    assert.deepEqual(readdirSync(join(dir, '.film', 'cache', 'export')).filter((n) => n.startsWith('burn-')), [], 'the burn page is removed');
    const past = await render([dir, '1-5'], { ...quiet, subtitles: true });
    assert.equal(basename(past.out), `${basename(dir)}-1-2.mp4`, 'a range past the end is named as it was rendered, as a plain render names it');
    await assert.rejects(render([join(dir, 'page.html')], { ...quiet, subtitles: true }), /into the project's film: render the project's folder, not page\.html/);
    rmSync(join(dir, 'assets', 'vo.vtt'));
    await assert.rejects(render([dir], { ...quiet, subtitles: true, out: join(dir, 'none.mp4') }), /no subtitles to burn in/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
