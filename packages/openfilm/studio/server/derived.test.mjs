import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaError, frame, loudness, loudnessOf, mixLoudness, peakCounter, poster, probe, soundOf, strip, stripPicture, waveform } from './derived.mjs';

let root;
const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

before(() => {
  root = mkdtempSync(join(tmpdir(), 'of-derived-'));
  mkdirSync(join(root, 'assets'));
  if (!hasFfmpeg) return;
  /* two seconds of a test pattern with a tone, and one second of a 440 Hz sound followed by silence */
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=2', '-shortest', '-pix_fmt', 'yuv420p', join(root, 'assets', 'clip.mp4')]);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-af', 'apad=pad_dur=1', join(root, 'assets', 'tone.wav')]);
});

test('probe: length, picture size, frame rate and sound of a video; a sound has no picture', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const video = await probe(root, 'assets/clip.mp4');
  assert.equal(video.width, 320);
  assert.equal(video.fps, 25);
  assert.ok(Math.abs(video.duration - 2) < 0.1);
  assert.equal(video.audio, true);
  assert.deepEqual([video.codec, video.pixfmt], ['h264', 'yuv420p']);
  const sound = await probe(root, 'assets/tone.wav');
  assert.equal(sound.width, undefined);
  assert.ok(Math.abs(sound.duration - 2) < 0.05);
});

test('probe: a still\'s size, and a video turned a quarter (a phone\'s portrait video) as it is shown', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=300x200', '-frames:v', '1', join(root, 'assets', 'still.png')]);
  const still = await probe(root, 'assets/still.png');
  assert.deepEqual([still.width, still.height, still.duration], [300, 200, undefined]);
  execFileSync('ffmpeg', ['-v', 'error', '-display_rotation', '90', '-i', join(root, 'assets', 'clip.mp4'), '-c', 'copy', join(root, 'assets', 'turned.mp4')]);
  const turned = await probe(root, 'assets/turned.mp4');
  assert.deepEqual([turned.width, turned.height], [180, 320]);
});

test('poster and frames are JPEG, cached until the file changes', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const jpeg = await poster(root, 'assets/clip.mp4');
  assert.deepEqual([...jpeg.subarray(0, 2)], [0xff, 0xd8]);
  await frame(root, 'assets/clip.mp4', 1500, 160);
  assert.equal(readdirSync(join(root, '.film', 'cache', 'frames')).length, 1);
  await frame(root, 'assets/clip.mp4', 1500, 160);
  assert.equal(readdirSync(join(root, '.film', 'cache', 'frames')).length, 1, 'the second ask is the cache');
  utimesSync(join(root, 'assets', 'clip.mp4'), new Date(), new Date(Date.now() + 5000));
  await frame(root, 'assets/clip.mp4', 1500, 160);
  assert.equal(readdirSync(join(root, '.film', 'cache', 'frames')).length, 2, 'a changed file is worked out again');
});

test('a frame is cut from a lighter copy of the file when there is one, and from the file itself when that cannot be read', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  /* a copy with the same frames at the same times, half the size, as the preview's proxy is */
  execFileSync('ffmpeg', ['-v', 'error', '-i', join(root, 'assets', 'clip.mp4'), '-vf', 'scale=160:90,drawbox=0:0:160:90:red:fill', '-an', '-pix_fmt', 'yuv420p', join(root, 'copy.mp4')]);
  const size = (jpeg) => { const at = jpeg.indexOf(Buffer.from([0xff, 0xc0])); return [jpeg.readUInt16BE(at + 7), jpeg.readUInt16BE(at + 5)]; };
  const fromCopy = await frame(root, 'assets/clip.mp4', 700, 160, join(root, 'copy.mp4'));
  assert.deepEqual(size(fromCopy), [160, 90]);
  /* red all over: the copy's picture, not the file's test pattern */
  const own = await frame(root, 'assets/clip.mp4', 900, 160);
  assert.notDeepEqual(fromCopy, own);
  const fallen = await frame(root, 'assets/clip.mp4', 1100, 160, join(root, 'gone.mp4'));
  assert.deepEqual([...fallen.subarray(0, 2)], [0xff, 0xd8], 'a copy that is not there: the file itself');
  assert.deepEqual(size(fallen), [160, 90]);
});

test('a video\'s strip: pictures from all along it in one image, from its key frames at once where they are close enough', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  /* six seconds, a key frame every 0.4 s: as close as the pictures wanted (one every half second) */
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=6', '-pix_fmt', 'yuv420p', '-g', '10', '-keyint_min', '10', '-sc_threshold', '0', join(root, 'assets', 'keys.mp4')]);
  const made = await strip(root, 'assets/keys.mp4');
  assert.equal(made.part, 'all');
  assert.equal(made.closer, false, 'all it will ever be');
  const { cols, rows, w, h, times } = made.index;
  assert.deepEqual([cols, w, h], [12, 160, 90]);
  /* its key frames no closer than the half second asked: every other one of them, each at its own moment (the file's
     list of them: read apart from the frames between, a decoder says them a few frames off) */
  assert.deepEqual(times, [0, 800, 1600, 2400, 3200, 4000, 4800, 5600]);
  assert.ok(times.at(-1) < 6000);
  assert.equal(rows, Math.ceil(times.length / 12));
  const jpeg = readFileSync(made.picture);
  assert.deepEqual([...jpeg.subarray(0, 2)], [0xff, 0xd8]);
  assert.equal(await stripPicture(root, 'assets/keys.mp4', 'all'), made.picture);
  /* kept: asked again, nothing is made, and the answer is the same */
  const before = statSync(made.picture).mtimeMs;
  assert.deepEqual((await strip(root, 'assets/keys.mp4')).index, made.index);
  assert.equal(statSync(made.picture).mtimeMs, before);
  /* its index cut short (a disk that filled): the strip is made again, not refused for ever */
  const list = join(root, '.film', 'cache', 'strips', readdirSync(join(root, '.film', 'cache', 'strips')).find((name) => name.endsWith('.json')));
  writeFileSync(list, '{"cols":12,');
  assert.deepEqual((await strip(root, 'assets/keys.mp4')).index, made.index);
});

test('a video whose key frames are far apart has a first strip of those at once, and a closer one made behind it', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 60_000 }, async () => {
  /* six seconds with a single key frame (a generated clip) */
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=6', '-pix_fmt', 'yuv420p', '-g', '250', '-sc_threshold', '0', join(root, 'assets', 'one-key.mp4')]);
  const first = await strip(root, 'assets/one-key.mp4');
  assert.equal(first.part, 'keys');
  assert.equal(first.closer, true, 'a closer one is being made');
  assert.deepEqual(first.index.times, [0], 'its one key frame');
  assert.equal(await stripPicture(root, 'assets/one-key.mp4', 'keys'), first.picture);
  /* asked again as an editor does: the closer one takes its place once made */
  let made = first;
  for (let i = 0; i < 100 && made.part !== 'all'; i += 1) { await new Promise((r) => setTimeout(r, 100)); made = await strip(root, 'assets/one-key.mp4'); }
  assert.equal(made.part, 'all');
  assert.equal(made.closer, false);
  assert.ok(made.index.times.length >= 10, `a picture every half second: ${made.index.times}`);
  /* decoded without the frames nothing is built on: still one about every half second, none further than a second */
  assert.ok(made.index.times.every((t, i) => i === 0 || (t - made.index.times[i - 1] >= 400 && t - made.index.times[i - 1] <= 1000)), `half a second apart: ${made.index.times}`);
  assert.notEqual(made.picture, first.picture);
});

/* an HEVC encoder to make the footage with: x265, or the Mac's own */
const hevcEncoder = (() => {
  if (!hasFfmpeg) return null;
  try {
    const list = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return /\blibx265\b/.test(list) ? 'libx265' : /\bhevc_videotoolbox\b/.test(list) ? 'hevc_videotoolbox' : null;
  } catch { return null; }
})();

test('an HEVC video has its strips and frames, decoded on the graphics chip where one decodes it and by the processor where none does', { skip: !hevcEncoder && 'no HEVC encoder', timeout: 120_000 }, async () => {
  /* eight seconds, a key frame every ten: its key frames are no strip to stay on, so every frame is decoded too */
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=8',
    '-c:v', hevcEncoder, ...(hevcEncoder === 'libx265' ? ['-x265-params', 'log-level=error:keyint=250:min-keyint=250:scenecut=0'] : ['-g', '250']),
    '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', join(root, 'assets', 'hevc.mp4')]);
  assert.equal((await probe(root, 'assets/hevc.mp4')).codec, 'hevc');
  const first = await strip(root, 'assets/hevc.mp4');
  assert.equal(first.part, 'keys');
  assert.deepEqual(first.index.times, [0]);
  let made = first;
  for (let i = 0; i < 300 && made.part !== 'all'; i += 1) { await new Promise((r) => setTimeout(r, 100)); made = await strip(root, 'assets/hevc.mp4'); }
  assert.equal(made.part, 'all');
  assert.ok(made.index.times.length >= 14, `a picture every half second: ${made.index.times}`);
  assert.ok(made.index.times.every((t, i) => i === 0 || (t - made.index.times[i - 1] >= 400 && t - made.index.times[i - 1] <= 1000)), `half a second apart: ${made.index.times}`);
  const jpeg = await frame(root, 'assets/hevc.mp4', 5300, 160);
  assert.deepEqual([...jpeg.subarray(0, 2)], [0xff, 0xd8]);
});

test('what has no moving picture has no strip', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  await assert.rejects(strip(root, 'assets/tone.wav'), (e) => e instanceof MediaError && e.status === 422);
  await assert.rejects(strip(root, 'assets/nope.mp4'), (e) => e instanceof MediaError && e.status === 404);
});

test('a poster of a picture or video with an alpha is a PNG with it, so what it leaves clear stays clear', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red@0.0:size=200x100,format=rgba', '-frames:v', '1', join(root, 'assets', 'clear.png')]);
  const png = await poster(root, 'assets/clear.png');
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  assert.equal(png[25], 6, 'its color type keeps the alpha (RGBA)');
});

test('a picture file\'s poster is the picture itself, small: a JPEG\'s too, turned as its Exif says', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  /* a JPEG's size: in its frame header (SOF0 or SOF2) */
  const sizeOf = (jpeg) => {
    for (let i = 2; i < jpeg.length - 8; i += 2 + jpeg.readUInt16BE(i + 2)) {
      if (jpeg[i] === 0xff && (jpeg[i + 1] === 0xc0 || jpeg[i + 1] === 0xc2)) return [jpeg.readUInt16BE(i + 7), jpeg.readUInt16BE(i + 5)];
    }
    return null;
  };
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x400', '-frames:v', '1', '-update', '1', join(root, 'assets', 'photo.jpg')]);
  /* sought, a JPEG gives no frame (ffmpeg 8): its poster was an empty file, kept */
  const small = await poster(root, 'assets/photo.jpg');
  assert.deepEqual(sizeOf(small), [480, 300]);
  /* the same photograph as a phone held upright writes it: its pixels on their side, and an Exif that says so (6) */
  const plain = readFileSync(join(root, 'assets', 'photo.jpg'));
  const exif = Buffer.concat([Buffer.from('Exif\0\0MM\0*', 'latin1'), Buffer.from([0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0])]);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe1, 0);
  head.writeUInt16BE(exif.length + 2, 2);
  writeFileSync(join(root, 'assets', 'upright.jpg'), Buffer.concat([plain.subarray(0, 2), head, exif, plain.subarray(2)]));
  assert.deepEqual(sizeOf(await poster(root, 'assets/upright.jpg')), [480, 768], 'turned upright, as a browser shows it');
  /* and its size is said as it is shown */
  const [plainFacts, uprightFacts] = [await probe(root, 'assets/photo.jpg'), await probe(root, 'assets/upright.jpg')];
  assert.deepEqual([plainFacts.width, plainFacts.height, plainFacts.duration], [640, 400, undefined]);
  assert.deepEqual([uprightFacts.width, uprightFacts.height], [400, 640]);
  /* a file that is no picture has no poster, and none is kept for it */
  writeFileSync(join(root, 'assets', 'broken.jpg'), 'not a picture');
  await assert.rejects(poster(root, 'assets/broken.jpg'));
  assert.ok(readdirSync(join(root, '.film', 'cache', 'posters')).every((name) => statSync(join(root, '.film', 'cache', 'posters', name)).size > 0));
});

test('waveform: loud where the tone is, silent after', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const { duration, peaks } = await waveform(root, 'assets/tone.wav');
  assert.ok(Math.abs(duration - 2) < 0.05);
  assert.ok(Math.abs(peaks.length - 80) <= 1);
  assert.ok(peaks[10] > 0.05 && peaks[70] < 0.001, `${peaks[10]} ${peaks[70]}`);
});

test('waveform: a recording longer than an hour (more samples than one read could hold) has its whole wave', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  /* 75 minutes: a tone for the first minute and the last, silence between */
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=60:sample_rate=8000', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono:d=4380',
    '-f', 'lavfi', '-i', 'sine=frequency=300:duration=60:sample_rate=8000', '-filter_complex', '[0][1][2]concat=n=3:v=0:a=1', '-c:a', 'flac', join(root, 'assets', 'long.flac')]);
  const { duration, peaks } = await waveform(root, 'assets/long.flac');
  assert.ok(Math.abs(duration - 4500) < 1, String(duration));
  assert.ok(Math.abs(peaks.length - 4500 * 40) <= 2, String(peaks.length));
  assert.ok(peaks[40 * 30] > 0.05 && peaks[40 * 2000] < 0.001 && peaks[40 * 4470] > 0.05, 'loud at the ends, silent between');
});

test('peaks counted a piece at a time are those of the whole, a piece ending inside a sample included', () => {
  const samples = Int16Array.from({ length: 1000 }, (_, i) => Math.round(Math.sin(i / 7) * 30000 * (i < 500 ? 1 : 0.25)));
  samples[3] = -32768;
  const bytes = Buffer.from(samples.buffer);
  const whole = peakCounter();
  whole.add(bytes);
  const pieces = peakCounter();
  for (let at = 0; at < bytes.length; at += 37) pieces.add(bytes.subarray(at, at + 37));
  assert.deepEqual(pieces.done(), whole.done());
  const { duration, peaks } = whole.done();
  assert.equal(duration, 1000 / 8000);
  assert.equal(peaks.length, 5, 'four whole windows of 200 samples and the last part of one');
  assert.equal(peaks[0], 1, 'the lowest sample is full scale');
  assert.ok(peaks[3] < 0.3, String(peaks[3]));
});

test('loudness: the part of the file asked for, in LUFS; 6 dB quieter reads 6 LU less; silence has none', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  /* a 1 kHz tone at ffmpeg's level (1/8 of full scale), and the same 6 dB quieter, then silence */
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=3', '-af', 'volume=0.5,apad=pad_dur=1', join(root, 'assets', 'half.wav')]);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=2', join(root, 'assets', 'full.wav')]);
  const tone = await loudness(root, 'assets/full.wav', 0, 2);
  const half = await loudness(root, 'assets/half.wav', 0, 3);
  assert.ok(tone.lufs != null && tone.lufs < -10 && tone.lufs > -30, JSON.stringify(tone));
  assert.ok(half.lufs != null && Math.abs((tone.lufs - half.lufs) - 6) < 0.6, `${tone.lufs} ${half.lufs}`);
  assert.ok(half.peak != null && half.peak < -20 && half.peak > -26, JSON.stringify(half));
  /* the last second of half.wav is silence: the part asked for is what is measured */
  assert.equal((await loudness(root, 'assets/half.wav', 3.05, 4)).lufs, null);
  assert.equal((await loudness(root, 'assets/half.wav', 3.05, 4)).lufs, null, 'the cache answers the same');
  await assert.rejects(loudness(root, 'assets/tone.wav', 2, 1), (e) => e instanceof MediaError && e.status === 400);
});

test('the mix\'s loudness: the sounds added as a render adds them, before any limiter; none for silence', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  /* stereo: a mono sound is put on both sides in the mix (as a browser plays it), 3 LU over the file measured alone */
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=2', '-ac', '2', join(root, 'assets', 'mixone.wav')]);
  const one = await loudness(root, 'assets/mixone.wav', 0, 2);
  const sound = { src: 'assets/mixone.wav', at: 0, from: 0, to: 2, volume: 1, speed: 1 };
  const alone = await mixLoudness(root, [sound], 2);
  assert.ok(alone.lufs != null && one.lufs != null && Math.abs(alone.lufs - one.lufs) < 0.3, `${alone.lufs} ${one.lufs}`);
  /* the same sound twice, in phase: twice as loud (6 dB), measured as it is, not caught by a limiter */
  const twice = await mixLoudness(root, [sound, { ...sound }], 2);
  assert.ok(twice.lufs != null && Math.abs(twice.lufs - alone.lufs - 6) < 0.3, `${twice.lufs} ${alone.lufs}`);
  assert.deepEqual(await mixLoudness(root, [{ ...sound, volume: 0 }], 2), { lufs: null, peak: null });
  assert.deepEqual(await mixLoudness(root, [], 2), { lufs: null, peak: null });
});

test('loudness is read from ebur128\'s summary, not its running lines', () => {
  const log = '[Parsed_ebur128_0 @ 0x1] t: 0.4 M: -21.0 S:-120.7 I: -21.0 LUFS\n[Parsed_ebur128_0 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         -17.4 LUFS\n    Threshold: -27.4 LUFS\n\n  True peak:\n    Peak:       -2.9 dBFS\n';
  assert.deepEqual(loudnessOf(log), { lufs: -17.4, peak: -2.9 });
  assert.deepEqual(loudnessOf('Summary:\n    I:         -70.0 LUFS\n    Peak:       -inf dBFS'), { lufs: null, peak: null });
});

test('a missing file is a 404, a file that is not media a 422', async () => {
  await assert.rejects(probe(root, 'assets/none.mp4'), (e) => e instanceof MediaError && e.status === 404);
  writeFileSync(join(root, 'assets', 'notes.mp4'), 'not a video');
  await assert.rejects(waveform(root, 'assets/notes.mp4'), (e) => e instanceof MediaError && (e.status === 422 || e.status === 501));
});

/** Where the first loud sample of `file`'s sound is, in seconds (decoded by ffmpeg, as a browser decodes it). */
function onset(file) {
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], { maxBuffer: 1 << 28 });
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const i = samples.findIndex((v) => Math.abs(v) > 2000);
  assert.ok(i > 0, `no beep in ${file}`);
  return i / 48000;
}

test('a file\'s sound for the editor is small and in step: a video\'s AAC kept as it is, any other sound made AAC, once', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const at = (/** @type {string} */ name) => join(root, 'assets', name);
  /* a beep 1.5 s in: a minute of busy picture around it, so the sound alone is a small part of the file */
  const beep = ['-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.2,adelay=1500:all=1,apad=whole_dur=60'];
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=60', ...beep, '-shortest', '-pix_fmt', 'yuv420p', '-b:v', '4M', '-c:a', 'aac', at('long.mp4')]);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=4', ...beep, '-t', '4', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', at('pcm.mov')]);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=2', '-pix_fmt', 'yuv420p', at('mute.mp4')]);
  execFileSync('ffmpeg', ['-v', 'error', ...beep, '-t', '3', at('voice.wav')]);
  execFileSync('ffmpeg', ['-v', 'error', ...beep, '-t', '3', at('music.mp3')]);

  const long = await soundOf(root, 'assets/long.mp4');
  assert.match(String(long), /\.film[\\/]cache[\\/]audio[\\/]\w+\.m4a$/);
  assert.ok(statSync(String(long)).size < statSync(at('long.mp4')).size / 10, 'a small part of the video');
  assert.equal(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'csv=p=0', String(long)], { encoding: 'utf8' }).trim(), 'aac,audio');
  assert.ok(Math.abs(onset(String(long)) - onset(at('long.mp4'))) < 0.003, 'the copy is in step with the video');

  for (const name of ['pcm.mov', 'voice.wav']) {
    const copy = String(await soundOf(root, `assets/${name}`));
    assert.match(copy, /\.m4a$/, name);
    assert.equal(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', copy], { encoding: 'utf8' }).trim(), 'aac');
    assert.ok(Math.abs(onset(copy) - onset(at(name))) < 0.003, `${name}: the encoded copy is in step`);
  }
  assert.equal(await soundOf(root, 'assets/music.mp3'), at('music.mp3'), 'a small compressed sound is played as it is');
  assert.equal(await soundOf(root, 'assets/mute.mp4'), null, 'no sound in it');

  const made = readdirSync(join(root, '.film', 'cache', 'audio')).sort();
  assert.equal(made.length, 3);
  await soundOf(root, 'assets/long.mp4');
  assert.deepEqual(readdirSync(join(root, '.film', 'cache', 'audio')).sort(), made, 'asked again: the copy made');
  await assert.rejects(soundOf(root, 'assets/none.mp4'), (e) => e instanceof MediaError && e.status === 404);
});
