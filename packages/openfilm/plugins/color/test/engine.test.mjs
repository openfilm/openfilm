// The color engine against the makers' printed numbers and against itself: its LUTs bake what it computes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_LOGS } from '../engine/camera-logs.mjs';
import { decoderOf, inputOf, INPUTS } from '../engine/inputs.mjs';
import { bake, compile, curveOf, isNeutral, neutralGrade, normalize, sizeFor } from '../engine/grade.mjs';
import { readCube, sample, writeCube, gradeOfCube } from '../engine/cube.mjs';
import { measure } from '../engine/measure.mjs';
import { bt1886, temperatureOf, whiteOf } from '../engine/math.mjs';

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`);

test('each camera log meets its maker\'s printed code values', () => {
  /* [input, reflectance, 10-bit code as the maker prints it, tolerance in codes] */
  const table = [
    ['slog3', 0, 95, 0.5], ['slog3', 0.18, 420, 0.5], ['slog3', 0.9, 598, 0.5],
    ['vlog', 0, 128, 0.5], ['vlog', 0.18, 433, 0.5], ['vlog', 0.9, 602, 0.5],
    ['flog', 0, 95, 0.5], ['flog', 0.18, 470, 0.5], ['flog', 0.9, 705, 0.5],
    ['flog2', 0, 95, 0.5], ['flog2', 0.18, 400, 0.5], ['flog2', 0.9, 570, 0.5],
    ['dlog', 0, 95, 0.5], ['dlog', 0.18, 408, 0.5], ['dlog', 0.9, 586, 0.5],
    /* signal-scale curves: legal code = 64 + 876 × signal */
    ['logc4', 0.18, 308, 0.5], ['logc3', 0.18, 406.5, 0.5], ['bmdfilm5', 0, 145, 0.1], ['bmdfilm5', 0.18, 400, 0.1],
    ['clog3', 0, 128, 0.5], ['clog3', 0.18, 351.3, 0.5],
  ];
  for (const [id, x, code, tol] of table) {
    const input = /** @type {any} */ (inputOf(id));
    const y = input.encode(x);
    const cv = input.codes === 'cv' ? y * 1023 : 64 + 876 * y;
    near(cv, code, tol, `${id} at ${x}`);
  }
  /* the makers' published values on their own scales */
  near(/** @type {any} */ (inputOf('applelog')).encode(0.18), 0.4882724585, 1e-9, 'Apple Log grey');
  near(/** @type {any} */ (inputOf('nlog')).encode(0.18), 0.3636677701, 1e-9, 'N-Log grey');
  near(/** @type {any} */ (inputOf('bmdfilm5')).encode(222.86), 1, 1e-4, 'BMD Film Gen5 clip');
});

test('each log decodes what it encodes, and a legal file is decoded at its codes', () => {
  for (const input of CAMERA_LOGS) {
    for (const x of [0.001, 0.02, 0.18, 0.9, 4]) near(input.decode(/** @type {any} */ (input.encode)(x)), x, 1e-6 * Math.max(1, x), `${input.id} at ${x}`);
    /* a legal file's signal of 18 % grey decodes to 0.18 */
    const y = /** @type {any} */ (input.encode)(0.18);
    const signal = input.codes === 'cv' ? (y * 1023 - 64) / 876 : y;
    near(decoderOf(input, 'legal')(signal), 0.18, 1e-6, `${input.id} legal`);
    near(decoderOf(input, 'full')(y), 0.18, 1e-6, `${input.id} full`);
  }
  assert.equal(new Set(INPUTS.map((i) => i.id)).size, INPUTS.length);
});

test('a grade with nothing changed is the identity on SDR, and is neutral', () => {
  const g = neutralGrade();
  assert.ok(isNeutral(g));
  const f = compile(g);
  for (const c of [[0, 0, 0], [1, 1, 1], [0.2, 0.5, 0.8], [0.9, 0.1, 0.3]]) {
    const o = f(c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) near(o[i], c[i], 1e-9, `identity ${c}`);
  }
  assert.ok(!isNeutral(normalize({ exposure: 0.5 })));
  assert.ok(!isNeutral(neutralGrade('slog3')), 'log footage is never left as it is');
});

test('grey stays grey under exposure, contrast and saturation; white balance moves it', () => {
  const f = compile(normalize({ exposure: 1, contrast: 1.3, saturation: 1.5, vibrance: 0.4 }));
  for (const v of [0.1, 0.4, 0.7]) { const o = f(v, v, v); near(o[0], o[1], 1e-6, 'grey r=g'); near(o[1], o[2], 1e-6, 'grey g=b'); }
  /* lighting at 3200 K is warm: telling the grade so cools a grey */
  const warm = compile(normalize({ white: 3200 }))(0.5, 0.5, 0.5);
  assert.ok(warm[2] > warm[0], `a grey balanced for 3200 K turns cooler, ${warm}`);
  /* the temperature of a white is read back as it was made */
  for (const k of [2700, 4000, 6500, 9000]) near(temperatureOf(whiteOf(k, 0)).kelvin, k, k * 0.01, `${k} K`);
});

test('a measured cast, set as the grade\'s white balance, takes it away', () => {
  /* a grey card lit at 4000 K, as SDR footage shows it */
  const lit = compile(normalize({ white: 9000 }));
  const px = [];
  for (let i = 0; i < 2000; i++) { const v = 0.3 + (i % 50) / 100; px.push(...lit(v, v, v)); }
  const m = measure(px);
  assert.equal(m.white.from, 'neutrals');
  const fixed = compile(normalize({ white: m.white.kelvin, tint: m.white.tint }));
  const back = []; for (let i = 0; i < px.length; i += 3) back.push(...fixed(px[i], px[i + 1], px[i + 2]));
  const after = measure(back);
  near(after.white.kelvin, 6500, 250, 'balanced kelvin');
  near(after.white.tint, 0, 4, 'balanced tint');
});

test('curves are monotone between their points and pass through them', () => {
  const pts = /** @type {[number, number][]} */ ([[0, 0], [0.25, 0.15], [0.5, 0.55], [0.75, 0.9], [1, 1]]);
  const f = curveOf(pts);
  for (const [x, y] of pts) near(f(x), y, 1e-9, `through ${x}`);
  let last = -1;
  for (let x = 0; x <= 1; x += 0.001) { const y = f(x); assert.ok(y >= last - 1e-12, `monotone at ${x}`); last = y; }
});

test('a .cube keeps its grade and its values, past 0 and 1 too', () => {
  const g = normalize({ exposure: 1.2, contrast: 1.4, hueSat: [[0.6, 1.5]] });
  assert.equal(sizeFor(g), 65);
  assert.equal(sizeFor(normalize({ exposure: 0.3 })), 33);
  assert.equal(sizeFor(neutralGrade('logc4')), 65);
  const text = writeCube(9, compile(g, {}, { extended: true }), { grade: g });
  const lut = readCube(text);
  assert.deepEqual(lut.grade, g);
  assert.deepEqual(gradeOfCube(text.slice(0, 4000)), g);
  assert.equal(lut.size, 9);
  assert.ok(Math.max(...lut.data) > 1, 'a pushed grade keeps how far past white it went');
  /* the lattice holds the grade at its points */
  const f = compile(g, {}, { extended: true });
  const o = f(0.5, 0.25, 0.75), s = sample(lut, 0.5, 0.25, 0.75);
  for (let i = 0; i < 3; i++) near(s[i], o[i], 1e-5, 'lattice point');
  /* bake is the same lattice, red fastest */
  const b = bake(normalize({ exposure: 0.4 }), 5);
  const f2 = compile(normalize({ exposure: 0.4 }), {}, { extended: true });
  const at = (r, gg, bb) => 3 * (r + 5 * (gg + 5 * bb));
  const want = f2(1, 0.5, 0.25);
  for (let i = 0; i < 3; i++) near(b[at(4, 2, 1) + i], want[i], 1e-6, 'bake order');
});

/*
 * Where a grade drives a channel through black, gamma-encoded output rises steeper than any lattice can follow (as in
 * every grading tool's LUT); preview and export play the same LUT, so this measures the LUT against the grade's math.
 */
test('a 65-point LUT of a strong grade, clamped after its lookup, keeps all but 1 % of values within 2 codes', () => {
  const g = normalize({ exposure: 0.7, white: 5200, contrast: 1.15, saturation: 1.2, lift: { y: 0.03 }, curves: { y: [[0, 0], [0.25, 0.22], [0.75, 0.8], [1, 1]] } });
  const f = compile(g), lut = readCube(writeCube(65, compile(g, {}, { extended: true })));
  let over = 0, n = 0, worst = 0, sum = 0;
  /* a deterministic spread of colors, dense near grey where pictures are */
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 20000; i++) {
    const v = rnd(), c = [v + (rnd() - 0.5) * 0.3, v + (rnd() - 0.5) * 0.3, v + (rnd() - 0.5) * 0.3].map((x) => Math.min(1, Math.max(0, x)));
    const o = f(c[0], c[1], c[2]), s = sample(lut, c[0], c[1], c[2]).map((x) => Math.min(1, Math.max(0, x)));
    for (let k = 0; k < 3; k++) { const d = Math.abs(o[k] - s[k]) * 255; sum += d; worst = Math.max(worst, d); if (d > 2) over++; n++; }
  }
  assert.ok(over / n < 0.01, `${((over / n) * 100).toFixed(3)} % of values over 2 codes (worst ${worst.toFixed(1)})`);
  assert.ok(sum / n < 0.1, `mean ${(sum / n).toFixed(3)} codes`);
});

test('log footage graded to film keeps mid grey near the middle and never clips white hard', () => {
  for (const input of CAMERA_LOGS) {
    const f = compile(neutralGrade(input.id, 'full'));
    const grey = f(...(/** @type {[number, number, number]} */ ([0, 0, 0].map(() => /** @type {any} */ (input.encode)(0.18)))));
    near(grey[1], 0.44, 0.06, `${input.id} grey`);
    const hot = f(...(/** @type {[number, number, number]} */ ([0, 0, 0].map(() => /** @type {any} */ (input.encode)(8)))));
    assert.ok(hot[1] < 1 && hot[1] > 0.85, `${input.id}: 8× grey rolls off (${hot[1]})`);
  }
  near(bt1886.encode(bt1886.decode(0.3)), 0.3, 1e-12, 'bt1886');
});
