import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure } from './audio-measure.mjs';

const RATE = 11025;
/** `secs` of sound, sample by sample. */
const make = (secs, fn) => Float32Array.from({ length: Math.round(secs * RATE) }, (_, i) => fn(i / RATE));

test('a steady beat is measured at its tempo', () => {
  for (const bpm of [72, 100, 128, 150]) {
    const every = 60 / bpm;
    const m = measure(make(20, (t) => Math.sin(2 * Math.PI * 880 * t) * Math.exp(-(t % every) * 30) * 0.5), RATE);
    assert.ok(Math.abs(/** @type {number} */ (m.bpm) - bpm) <= 2, `${bpm}: measured ${m.bpm}`);
    assert.ok(m.pulse > 0.5);
  }
});

test('a held tone has no beat, is even, and runs on into its start', () => {
  const m = measure(make(10, (t) => Math.sin(2 * Math.PI * 220 * t) * 0.3), RATE);
  assert.equal(m.bpm, null);
  assert.equal(m.steady, 1);
  assert.ok(m.seam > 0.9);
  assert.ok(Math.abs(m.db - -13.5) < 0.5, `${m.db} dB`);
  assert.ok(Math.abs(m.centroid - 220) < 30, `${m.centroid} Hz`);
});

test('a sound that fades away does not loop, and a bright one sits higher', () => {
  const fading = measure(make(8, (t) => Math.sin(2 * Math.PI * 330 * t) * Math.exp(-t * 0.8)), RATE);
  assert.ok(fading.seam < 0.5, `seam ${fading.seam}`);
  assert.ok(fading.steady < 0.6, `steady ${fading.steady}`);
  const bright = measure(make(4, (t) => Math.sin(2 * Math.PI * 3000 * t) * 0.3), RATE);
  assert.ok(bright.centroid > 2500);
});
