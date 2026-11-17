// @ts-check
/*
 * aces2.mjs against OpenColorIO 2.6 itself: fixtures/aces2/*.json hold OCIO's own outputs on seeded random values
 * (written by scripts/aces2-oracle.py; these tests never run Python).
 *
 * The tolerance is relative, not 1e-5 absolute: OCIO computes in single precision, and its result depends on how it
 * was compiled. The same OCIO source built with and without fused multiply-adds differs by up to 5e-5 × max(1, |v|)
 * forward and 3e-4 × max(1, |v|) inverse on these very fixtures (the inverse is steep near peak white, where display
 * 1.0 is scene ~128), mostly because the upper hull's gamma table comes from a search that small rounding moves by
 * 1e-4. This port, in double precision, is as close to OCIO's published build as OCIO's other builds are.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { acesOutput20 } from './aces2.mjs';

const FIXTURES = new URL('./fixtures/aces2/', import.meta.url);
const cases = readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort();

/** @typedef {{ params: number[], forward: { inputs: number[], outputs: number[] }, inverse: { inputs: number[], outputs: number[] } }} Fixture */
/** @param {string} name @returns {Fixture} */
const fixture = (name) => JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8'));

/**
 * The largest error of the transform over a fixture's inputs, each relative to max(1, |OCIO's value|).
 * @param {Fixture} fx @param {'forward' | 'inverse'} way
 */
function worst(fx, way) {
  const fn = acesOutput20(fx.params, way === 'inverse');
  const { inputs, outputs } = fx[way];
  const out = [0, 0, 0];
  let max = 0;
  let where = '';
  for (let i = 0; i < inputs.length; i += 3) {
    fn(inputs[i], inputs[i + 1], inputs[i + 2], out);
    for (let k = 0; k < 3; k++) {
      const ref = outputs[i + k];
      const e = Math.abs(out[k] - ref) / Math.max(1, Math.abs(ref));
      if (!(e <= max)) {
        max = e;
        where = `${inputs.slice(i, i + 3)} → ${out} (OCIO ${outputs.slice(i, i + 3)})`;
      }
    }
  }
  return { max, where };
}

/** A seeded uniform random number in [0, 1). @param {number} seed */
function random(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

test('the fixtures cover SDR Rec.709 and P3-D65, and 1000-nit P3-D65 and Rec.2020', () => {
  assert.deepEqual(cases, ['hdr-1000-p3d65.json', 'hdr-1000-rec2020.json', 'sdr-100-p3d65.json', 'sdr-100-rec709.json']);
});

for (const name of cases) {
  test(`${name}: forward matches OCIO on scene values, bright, saturated and negative ones among them`, () => {
    const { max, where } = worst(fixture(name), 'forward');
    assert.ok(max <= 1e-4, `relative error ${max.toExponential(2)} at ${where}`);
  });

  test(`${name}: inverse matches OCIO on display values`, () => {
    const { max, where } = worst(fixture(name), 'inverse');
    assert.ok(max <= 5e-4, `relative error ${max.toExponential(2)} at ${where}`);
  });

  test(`${name}: an untouched grade round-trips (forward of inverse is the display value)`, () => {
    const params = fixture(name).params;
    const top = params[0] / 100;
    const fwd = acesOutput20(params);
    const inv = acesOutput20(params, true);
    const rnd = random(7);
    const scene = [0, 0, 0];
    const back = [0, 0, 0];
    /* ACES 2's inverse is exact up to rounding below the top of the gamut, and approximate (by OCIO's design: its
       gamut compression inverts by one fixed-point step) within the last few percent below peak */
    for (const [reach, tolerance] of [[0.95, 1e-5], [1, 5e-4]]) {
      let max = 0;
      for (let i = 0; i < 20000; i++) {
        const x = [rnd() * top * reach, rnd() * top * reach, rnd() * top * reach];
        inv(x[0], x[1], x[2], scene);
        fwd(scene[0], scene[1], scene[2], back);
        for (let k = 0; k < 3; k++) max = Math.max(max, Math.abs(back[k] - x[k]) / top);
      }
      assert.ok(max <= tolerance, `up to ${reach} of peak: error ${max.toExponential(2)} of peak`);
    }
    /* black, grays and the peak itself */
    for (const v of [0, 0.001, 0.01, 0.18, 0.5, top]) {
      inv(v, v, v, scene);
      fwd(scene[0], scene[1], scene[2], back);
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(back[k] - v) <= 1e-4 * top, `gray ${v} → ${back}`);
    }
  });
}

test('18% gray lands near 10 nits on SDR and HDR alike', () => {
  const out = [0, 0, 0];
  acesOutput20([100, 0.64, 0.33, 0.3, 0.6, 0.15, 0.06, 0.3127, 0.329])(0.18, 0.18, 0.18, out);
  for (const v of out) assert.ok(Math.abs(v - 0.1) < 1e-5, String(out));
  acesOutput20([1000, 0.708, 0.292, 0.17, 0.797, 0.131, 0.046, 0.3127, 0.329])(0.18, 0.18, 0.18, out);
  for (const v of out) assert.ok(v > 0.13 && v < 0.16, String(out));
});

test('params are checked as OCIO checks them', () => {
  const p = [0.64, 0.33, 0.3, 0.6, 0.15, 0.06, 0.3127, 0.329];
  assert.throws(() => acesOutput20(p), /9 params/);
  assert.throws(() => acesOutput20([0, ...p]), /peak luminance/);
  assert.throws(() => acesOutput20([10001, ...p]), /peak luminance/);
  assert.throws(() => acesOutput20([100.5, ...p]), /peak luminance/);
  assert.throws(() => acesOutput20([100, ...p.slice(0, 7), NaN]), /numbers/);
});
