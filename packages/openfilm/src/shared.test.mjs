import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fadeFilter, ffmpeg, mix } from './shared.mjs';

test('an ffmpeg that does not end is stopped, and says what did not finish', { timeout: 20_000 }, async () => {
  /* an endless silent source, written nowhere: it never ends by itself */
  const { done } = ffmpeg(['-f', 'lavfi', '-i', 'anullsrc', '-f', 'null', '-'], { timeoutMs: 400, what: 'mixing the sound' });
  await assert.rejects(done, /mixing the sound did not finish within 0 s/);
});

test('a mix is exactly the film\'s length: padded when its sounds end early, cut when one runs on', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-mix-'));
  try {
    const tone = (name, seconds, rate) => {
      const file = join(dir, name);
      spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}:sample_rate=${rate}`, file]);
      return file;
    };
    const short = tone('short.wav', 1, 32000);
    const long = tone('long.wav', 5, 48000);
    const out = join(dir, 'mix.wav');
    await mix([{ file: short, at: 0.5, from: 0, volume: 1, speed: 1 }, { file: long, at: 0, from: 0, volume: 0.5, speed: 1 }], 3, out, ['-c:a', 'pcm_s16le']);
    const seconds = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout);
    assert.ok(Math.abs(seconds - 3) < 0.01, `${seconds} s`);
    await mix([{ file: short, at: 0, from: 0, volume: 1, speed: 1 }], 2.5, out, ['-c:a', 'pcm_s16le']);
    const padded = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout);
    assert.ok(Math.abs(padded - 2.5) < 0.01, `${padded} s`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A 16-bit WAV's level (RMS, 0–1) over `ms` around film second `t`, its first channel. */
function levelAt(file, t, ms = 20) {
  const wav = readFileSync(file);
  const channels = wav.readUInt16LE(22), rate = wav.readUInt32LE(24);
  let at = 12;
  while (wav.toString('ascii', at, at + 4) !== 'data') at += 8 + wav.readUInt32LE(at + 4);
  const data = at + 8, frame = 2 * channels;
  const from = Math.round((t - ms / 2000) * rate), to = Math.round((t + ms / 2000) * rate);
  let sum = 0;
  for (let i = from; i < to; i++) { const v = wav.readInt16LE(data + i * frame) / 32768; sum += v * v; }
  return Math.sqrt(sum / (to - from));
}

test('a sound\'s fades ramp its level in the mix, straight, from where its clip starts (cut by a range too)', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-fade-'));
  try {
    const tone = join(dir, 'tone.wav');
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=6:sample_rate=48000', tone]);
    const out = join(dir, 'mix.wav');
    /* on the film at 1 s for 4 s: 1 s in, 2 s out */
    await mix([{ file: tone, at: 1, from: 0, to: 4, volume: 1, speed: 1, fade: { in: 1, out: 2, length: 4, skip: 0 } }], 6, out, ['-c:a', 'pcm_s16le']);
    const full = levelAt(out, 2.5);
    assert.ok(full > 0.05, `the tone is heard: ${full}`);
    const ratio = (t) => Math.round((levelAt(out, t) / full) * 100) / 100;
    assert.ok(ratio(1.01) < 0.03, `silent as it starts: ${ratio(1.01)}`);
    assert.equal(ratio(1.5), 0.5);
    assert.equal(ratio(3.5), 0.75);
    assert.equal(ratio(4), 0.5);
    assert.equal(ratio(4.5), 0.25);
    assert.ok(ratio(4.99) < 0.03, `silent as it ends: ${ratio(4.99)}`);
    /* a mix from the film's second 1.5: half the fade in is gone, the sound starts at half its level */
    await mix([{ file: tone, at: 0, from: 0.5, to: 4, volume: 1, speed: 1, fade: { in: 1, out: 2, length: 4, skip: 0.5 } }], 4, out, ['-c:a', 'pcm_s16le']);
    assert.equal(ratio(0.25), 0.75);
    assert.equal(ratio(3), 0.25);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fadeFilter: the ramps as a per-sample expression, nothing without fades', () => {
  assert.equal(fadeFilter(undefined), '');
  assert.equal(fadeFilter({ in: 0, out: 0, length: 3, skip: 0 }), '');
  assert.equal(fadeFilter({ in: 0.5, out: 0, length: 3, skip: 0 }), "aeval='val(ch)*clip(min(1,t/0.5),0,1)':c=same");
  assert.equal(fadeFilter({ in: 0, out: 1, length: 3, skip: 0.25 }), "aeval='val(ch)*clip(min(1,(3-(t+0.25))/1),0,1)':c=same");
});
