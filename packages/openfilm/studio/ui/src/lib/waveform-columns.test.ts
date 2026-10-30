import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waveBarPx } from './waveform-columns.ts';

test('a peak is drawn as loud as the clip plays it: the file\'s level times its volume, the band\'s top full scale', () => {
  assert.deepEqual(waveBarPx(0.5, 1, 40), { barPx: 20, clipPx: 0 });
  /* +6 dB doubles it, −6 dB halves it */
  assert.equal(waveBarPx(0.25, 2, 40).barPx, 20);
  assert.equal(waveBarPx(0.5, 0.5, 40).barPx, 10);
  /* the same peak, louder, is taller: linear, as the peaks are */
  const heights = [0.25, 0.5, 1, 1.5, 2].map((v) => waveBarPx(0.4, v, 40).barPx);
  assert.deepEqual(heights, [...heights].sort((a, b) => a - b));
  /* just at full scale: the top, not clipped */
  assert.deepEqual(waveBarPx(0.5, 2, 40), { barPx: 40, clipPx: 0 });
});

test('a peak pushed past full scale is capped at the top, and its clipped part tinted: more the further over, within a third', () => {
  /* twice full scale: half of it is cut off, drawn as a third of the band at most */
  assert.deepEqual(waveBarPx(1, 2, 30), { barPx: 30, clipPx: 10 });
  /* a little over: at least 2 px, so it shows */
  const just = waveBarPx(0.9, 1.12, 30);
  assert.equal(just.barPx, 30);
  assert.equal(just.clipPx, 2);
  /* further over, more of it */
  const a = waveBarPx(1, 1.1, 60).clipPx;
  const b = waveBarPx(1, 1.3, 60).clipPx;
  assert.ok(a > 0 && b > a, `${a} < ${b}`);
  assert.ok(b <= 20);
  /* a band lower than the least tint: all of it */
  assert.deepEqual(waveBarPx(1, 4, 1.5), { barPx: 1.5, clipPx: 1.5 });
});

test('a silent clip, or a silent part, is a line along the bottom', () => {
  assert.deepEqual(waveBarPx(0.8, 0, 40), { barPx: 1, clipPx: 0 });
  assert.deepEqual(waveBarPx(0, 3, 40), { barPx: 1, clipPx: 0 });
  /* nothing below it: a negative volume or peak is silence */
  assert.deepEqual(waveBarPx(0.8, -1, 40), { barPx: 1, clipPx: 0 });
  assert.deepEqual(waveBarPx(-0.5, 1, 40), { barPx: 1, clipPx: 0 });
});
