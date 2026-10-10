import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaError, frame, loudness, loudnessOf, poster, probe, soundOf, waveform } from './derived.mjs';

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
  const sound = await probe(root, 'assets/tone.wav');
  assert.equal(sound.width, undefined);
  assert.ok(Math.abs(sound.duration - 2) < 0.05);
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

test('waveform: loud where the tone is, silent after', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const { duration, peaks } = await waveform(root, 'assets/tone.wav');
  assert.ok(Math.abs(duration - 2) < 0.05);
  assert.ok(Math.abs(peaks.length - 80) <= 1);
  assert.ok(peaks[10] > 0.05 && peaks[70] < 0.001, `${peaks[10]} ${peaks[70]}`);
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
