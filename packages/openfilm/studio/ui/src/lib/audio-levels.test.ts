import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelLevel, fallTo, formatDb, holdPeak, meterPosition, METER_FLOOR_DB, PEAK_HOLD_MS } from './audio-levels.ts';

const sine = (amp: number, n = 4800) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * 440 * i) / 48000));

test('a full-scale sine peaks at 0 dBFS with an RMS 3 dB under, and clips', () => {
  const level = channelLevel(sine(1));
  assert.ok(Math.abs(level.peakDb) < 0.01, String(level.peakDb));
  assert.ok(Math.abs(level.rmsDb - -3.01) < 0.05, String(level.rmsDb));
  assert.equal(level.clipped, true);
});

test('half scale is −6 dB and does not clip; silence is the floor', () => {
  const level = channelLevel(sine(0.5));
  assert.ok(Math.abs(level.peakDb - -6.02) < 0.05);
  assert.equal(level.clipped, false);
  assert.deepEqual(channelLevel(new Float32Array(128)), { peakDb: METER_FLOOR_DB, rmsDb: METER_FLOOR_DB, clipped: false });
});

test('the scale runs from the floor to 0 dBFS', () => {
  assert.equal(meterPosition(METER_FLOOR_DB), 0);
  assert.equal(meterPosition(0), 1);
  assert.equal(meterPosition(6), 1);
  assert.equal(meterPosition(-30), 0.5);
});

test('a meter jumps up and falls back slowly; the peak mark holds, then falls', () => {
  assert.equal(fallTo(-30, -6, 16), -6);
  assert.ok(Math.abs(fallTo(-6, -40, 500) - -12) < 1e-9);
  let held = holdPeak({ db: -60, at: 0 }, -3, 0);
  assert.equal(held.shown, -3);
  held = holdPeak(held, -20, PEAK_HOLD_MS);
  assert.equal(held.shown, -3);
  held = holdPeak(held, -20, PEAK_HOLD_MS + 500);
  assert.ok(Math.abs(held.shown - -9) < 1e-9);
  assert.equal(formatDb(-6.04), '-6.0');
  assert.equal(formatDb(METER_FLOOR_DB), '-∞');
});
