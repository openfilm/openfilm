import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLoudness, loudnessOf, toLoudness, TRUE_PEAK } from './loudness.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const AAC = ['-c:a', 'aac', '-b:a', '192k'];

/** A 20 s stereo WAV from an aevalsrc expression of t. @param {string} file @param {string} expr */
const wav = (file, expr) => {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=exprs='${expr}':s=48000:d=20:c=stereo`, '-c:a', 'pcm_f32le', file]);
  return file;
};

test('a loudness target is a number from -70 to -5 LUFS', () => {
  for (const ok of [-70, -23, -14, -5]) assert.equal(isLoudness(ok), true, String(ok));
  for (const bad of [-71, -4, 0, NaN, Infinity, '-14', null, undefined]) assert.equal(isLoudness(bad), false, String(bad));
});

test('a quiet mix with loud bangs is brought to the target as a whole, its bangs caught under the true-peak ceiling (#323)', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 120_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'of-loudness-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  /* a voice-like tone, and every 4 s a 5 ms bang near full scale (a microphone knocked): turned up by gain alone,
     the bangs would pass full scale by far */
  const mix = wav(join(dir, 'mix.wav'), '0.06*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*3*t))+0.95*lt(mod(t,4),0.005)*sin(2*PI*900*t)');
  const out = join(dir, 'sound.m4a');
  const { before, after } = await toLoudness(mix, out, AAC, { lufs: -14 });
  assert.ok(before.lufs < -16 && before.peak > TRUE_PEAK, `the mix starts quiet, its bangs near full scale: ${before.lufs} LUFS, ${before.peak} dBTP`);
  assert.ok(Math.abs(after.lufs - -14) <= 0.5, `integrated loudness ${after.lufs}`);
  assert.ok(after.peak <= TRUE_PEAK, `true peak ${after.peak}`);
  assert.deepEqual(await loudnessOf(out), after, 'what it says is what the file measures');
  /* and down: a loud mix to broadcast level */
  const down = await toLoudness(mix, join(dir, 'down.m4a'), AAC, { lufs: -30 });
  assert.ok(Math.abs(down.after.lufs - -30) <= 0.5, `integrated loudness ${down.after.lufs}`);
});

test('silence is encoded as it is, with nothing to measure', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 60_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'of-loudness-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { before, after } = await toLoudness(wav(join(dir, 'quiet.wav'), '0'), join(dir, 'quiet.m4a'), AAC, { lufs: -14 });
  assert.equal(before.lufs, -Infinity);
  assert.equal(after.lufs, -Infinity);
});
