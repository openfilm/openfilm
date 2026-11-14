import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bus, CEILING_DB, RATE, clipChain, dbGain, defineProcessor, limiterLatency } from './sound-engine.mjs';

/** A deterministic stereo sound of `seconds`: a tone at `level`, and every second a short bang at `bang` (0: none). */
function sound(seconds, level, bang = 0) {
  const n = Math.round(seconds * RATE), l = new Float32Array(n), r = new Float32Array(n);
  let s = 7;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const t = i / RATE;
    l[i] = level * Math.sin(2 * Math.PI * 220 * t) + (i % RATE < 240 ? bang * Math.sin(2 * Math.PI * 900 * t) : 0) + 0.01 * (s / 2 ** 32 - 0.5);
    r[i] = 0.8 * l[i];
  }
  return [l, r];
}

/** `l`, `r` through a bus in blocks of `block` frames, `latency` frames of silence after; what came out, from its start. */
function through(bus, [l, r], block) {
  const n = l.length + bus.latency;
  const inL = new Float32Array(n), inR = new Float32Array(n), outL = new Float32Array(n), outR = new Float32Array(n);
  inL.set(l);
  inR.set(r);
  for (let i = 0; i < n; i += block) {
    const e = Math.min(n, i + block);
    bus.process(inL.subarray(i, e), inR.subarray(i, e), outL.subarray(i, e), outR.subarray(i, e));
  }
  return [outL.subarray(bus.latency), outR.subarray(bus.latency)];
}

const peak = (/** @type {Float32Array[]} */ chs) => chs.reduce((m, c) => c.reduce((a, v) => Math.max(a, Math.abs(v)), m), 0);
const same = (/** @type {Float32Array} */ a, /** @type {Float32Array} */ b) => a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;

test('under the ceiling the bus gives the sound it was given, sample for sample, `latency` frames later', () => {
  const quiet = sound(3, 0.5);
  const [l, r] = through(new Bus(), quiet, 128);
  assert.ok(same(l, quiet[0]) && same(r, quiet[1]));
  assert.equal(new Bus().latency, limiterLatency(), 'what the preview allows for is what the bus delays');
  assert.equal(limiterLatency(), 150, '3 ms ahead and the true-peak filter\'s 6 frames');
});

test('the limiter keeps every sample under the ceiling, and what is far from a peak is not touched', () => {
  const loud = sound(4, 0.5, 1.2);
  const [l, r] = through(new Bus(), loud, 4096);
  assert.ok(peak(loud) > 1.5, 'the bangs pass full scale');
  assert.ok(peak([l, r]) <= dbGain(CEILING_DB), `peak ${20 * Math.log10(peak([l, r]))} dBFS`);
  /* half a second after a bang the gain is back at 1: the samples are the ones given */
  for (const i of [RATE / 2, RATE + RATE / 2, 3 * RATE + RATE / 2]) assert.equal(l[i], loud[0][i]);
});

test('the peaks between samples are caught too: a tone whose samples are under the ceiling, its true peak over it', () => {
  /* a quarter of the rate, 45° off: every sample at 0.707 of a true peak at full scale (3 dB more) */
  const n = RATE, l = new Float32Array(n);
  for (let i = 0; i < n; i++) l[i] = Math.sin(Math.PI / 2 * i + Math.PI / 4);
  assert.ok(peak([l]) < dbGain(CEILING_DB));
  const [out] = through(new Bus(), [l, l], 128);
  /* turned down by about the 2 dB the true peak is over the ceiling, not left as it is */
  assert.ok(peak([out.subarray(RATE / 10)]) < 0.707 * dbGain(CEILING_DB) * 1.01, `sample peak ${peak([out])}`);
});

test('the same samples in blocks of any length', () => {
  const loud = sound(2, 0.6, 1);
  const [a] = through(new Bus(), loud, 128);
  for (const block of [1, 127, 4096, loud[0].length + 500]) assert.ok(same(through(new Bus(), loud, block)[0], a), `blocks of ${block}`);
});

test('started a second before a point, with the second before fed first, it gives from there what it gives from the start', () => {
  const loud = sound(5, 0.6, 1.4);
  const whole = through(new Bus(), loud, 128);
  /* from 2.0003 s, just after a bang: the limiter is holding and letting go there */
  for (const at of [Math.round(2.0003 * RATE), Math.round(3.5 * RATE)]) {
    const from = at - RATE;
    const part = through(new Bus(), [loud[0].subarray(from), loud[1].subarray(from)], 128);
    assert.ok(same(part[0].subarray(RATE), whole[0].subarray(at)) && same(part[1].subarray(RATE), whole[1].subarray(at)), `from ${at / RATE} s`);
  }
});

test('the bus turns the mix by its gain before the limiter; a change of gain ramps over the frames asked', () => {
  const quiet = sound(1, 0.2);
  const [l] = through(new Bus({ gainDb: 6 }), quiet, 128);
  const g = dbGain(6);
  assert.equal(l[1000], Math.fround(quiet[0][1000] * g));
  const bus = new Bus();
  bus.setGain(-6, 480);
  const [m] = through(bus, quiet, 128);
  assert.equal(m[0], Math.fround(quiet[0][0] * (1 + (dbGain(-6) - 1) / 480)), 'the first frame a step of the way');
  assert.equal(m[1000], Math.fround(quiet[0][1000] * dbGain(-6)), 'there after 480 frames');
});

test('a clip\'s chain: none is null; processors run in order, by name; one not defined is an error', () => {
  assert.equal(clipChain(undefined), null);
  assert.equal(clipChain([]), null);
  defineProcessor('test-times', (step) => ({
    process(inL, inR, outL, outR) { for (let i = 0; i < inL.length; i++) { outL[i] = inL[i] * Number(step.by); outR[i] = inR[i] * Number(step.by); } },
  }));
  defineProcessor('test-plus', (step) => ({
    process(inL, inR, outL, outR) { for (let i = 0; i < inL.length; i++) { outL[i] = inL[i] + Number(step.add); outR[i] = inR[i] + Number(step.add); } },
  }));
  const chain = clipChain([{ name: 'test-times', by: 2 }, { name: 'test-plus', add: 1 }]);
  const l = Float32Array.of(1, 2), r = Float32Array.of(3, 4), outL = new Float32Array(2), outR = new Float32Array(2);
  chain?.process(l, r, outL, outR);
  assert.deepEqual([...outL, ...outR], [3, 5, 7, 9]);
  assert.throws(() => clipChain([{ name: 'test-none' }]), /no sound processor named "test-none"/);
});
