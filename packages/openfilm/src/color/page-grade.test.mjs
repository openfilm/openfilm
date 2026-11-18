import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseColorTransform, parseCtf } from './ctf.mjs';
import { compile } from './ops.mjs';
import { filterCtf, withAdjust, withCurves, withHueCurves, withWheels } from './adjust.mjs';
import { filterMarkup, pageStages, stagesFunction, TABLE } from './page-grade.mjs';

const T = new URL('./transforms/', import.meta.url);
const IN = { name: 'looks/in-rec709.ctf', text: readFileSync(new URL('in-rec709.ctf', T), 'utf8') };
const OUT = { name: 'looks/out-rec709.ctf', text: readFileSync(new URL('out-rec709.ctf', T), 'utf8') };

/* the grade as a page's picture has it, worked out apart: the picture into ACEScct by the sRGB curve and ACEScct's, the
   layer, and back; a screen's file on the picture as shown */
const fromSrgb = (/** @type {number} */ v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (/** @type {number} */ v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const toCct = (/** @type {number} */ x) => (x <= 0.0078125 ? 10.5402377416545 * x + 0.0729055341958355 : (Math.log2(x) + 9.72) / 17.52);
const fromCct = (/** @type {number} */ y) => (y <= 0.155251141552511 ? (y - 0.0729055341958355) / 10.5402377416545 : 2 ** (y * 17.52 - 9.72));
const c01 = (/** @type {number} */ v) => Math.min(1, Math.max(0, v));
function layerOnPicture(/** @type {string} */ layer) {
  const run = compile(parseCtf(layer));
  const o = [0, 0, 0];
  return (/** @type {number[]} */ rgb) => { run(...rgb.map((v) => toCct(fromSrgb(c01(v)))), o); return o.map((v) => c01(toSrgb(Math.max(0, fromCct(v))))); };
}
/** The most and the mean an 8-bit code the stages are off what they draw, over a grid of colors. */
function off(/** @type {(rgb: number[]) => number[]} */ want, /** @type {ReturnType<typeof pageStages>} */ got, quantize = false) {
  const run = stagesFunction(got?.stages ?? [], { quantize });
  const o = [0, 0, 0];
  let most = 0, sum = 0, n = 0;
  for (let r = 0; r <= 1.0001; r += 1 / 16) for (let g = 0; g <= 1.0001; g += 1 / 16) for (let b = 0; b <= 1.0001; b += 1 / 16) {
    const w = want([r, g, b]);
    run(r, g, b, o);
    for (let c = 0; c < 3; c++) { const e = Math.abs(w[c] - o[c]) * 255; most = Math.max(most, e); sum += e; n++; }
  }
  return { most, mean: sum / n };
}

const W = (/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b, m = 1) => ({ r, g, b, m });
const GRADES = {
  'white balance': withAdjust(null, { temperature: 40, tint: -20 }),
  'exposure and contrast': withAdjust(null, { exposure: 0.5, contrast: 30 }),
  saturation: withAdjust(null, { saturation: 40 }),
  'every slider': withAdjust(null, { temperature: 30, exposure: 0.3, contrast: 25, saturation: 25, highlights: -30, shadows: 20 }),
  wheels: withWheels(null, { shadows: W(0.9, 1, 1.15), highlights: W(1.12, 1, 0.88), midtones: W(1, 1, 1, 1.2) }),
  curves: withCurves(null, { master: [[0, 0], [0.3, 0.22], [0.7, 0.8], [1, 1]], red: [[0, 0], [0.5, 0.56], [1, 1]] }),
};

test('a layer on a page draws as it works out: in ACEScct, the input and output left out', () => {
  for (const [name, layer] of Object.entries(GRADES)) {
    const got = pageStages([IN, { name: 'looks/shot-a.ctf', text: layer }, OUT]);
    assert.ok(got, name);
    assert.deepEqual(got.skipped, [], name);
    const exact = off(layerOnPicture(layer), got);
    assert.ok(exact.most < 0.5, `${name}: off by ${exact.most.toFixed(2)} of 255 at most, drawn exactly`);
    /* as the chip draws it, each table's input and output in 8 bits */
    const chip = off(layerOnPicture(layer), got, true);
    assert.ok(chip.mean < 0.7 && chip.most < 6, `${name}: off by ${chip.mean.toFixed(2)} on average, ${chip.most.toFixed(2)} at most, in 8 bits`);
  }
});

test('a grade without a saturation is one curve a channel; with one, a mix between two', () => {
  assert.deepEqual(pageStages([IN, { name: 'looks/shot-a.ctf', text: GRADES.wheels }, OUT])?.stages.map((s) => s.kind), ['table']);
  assert.deepEqual(pageStages([IN, { name: 'looks/shot-a.ctf', text: GRADES.saturation }, OUT])?.stages.map((s) => s.kind), ['table', 'mix', 'table']);
  /* two layers with a saturation each: a table between each two mixes */
  const two = pageStages([IN, { name: 'looks/group-1.ctf', text: GRADES.saturation }, { name: 'looks/shot-a.ctf', text: GRADES['every slider'] }, OUT]);
  assert.deepEqual(two?.stages.map((s) => s.kind), ['table', 'mix', 'table', 'mix', 'table']);
  for (const s of two?.stages ?? []) if (s.kind === 'table') for (const t of s.tables) assert.equal(t.length, TABLE);
});

test('nothing changed is nothing to draw; what cannot be drawn is left out and said', () => {
  assert.equal(pageStages([IN, OUT]), null);
  assert.equal(pageStages([IN, { name: 'looks/shot-a.ctf', text: withAdjust(null, {}) }, OUT]), null);
  const hue = pageStages([IN, { name: 'looks/shot-a.ctf', text: withHueCurves(withAdjust(null, { exposure: 0.4 }), { hueSat: [[0, 1], [0.5, 1.5], [1, 1]] }) }, OUT]);
  assert.deepEqual(hue?.skipped, ['shot-a.ctf: gradingHueCurve']);
  /* the rest of the layer is drawn all the same */
  assert.ok(off(layerOnPicture(withAdjust(null, { exposure: 0.4 })), hue).most < 0.5);
});

test('a library filter after the output works on the picture as shown, exactly', () => {
  const items = JSON.parse(readFileSync(new URL('../../library/catalogs/filters.json', import.meta.url), 'utf8')).items.filter((/** @type {any} */ i) => i.grade);
  assert.ok(items.length > 3);
  for (const item of items.slice(0, 8)) {
    const text = filterCtf(item.id, item.name.en, item.grade, 0.8);
    const got = pageStages([IN, OUT, { name: 'looks/filter-x-80.ctf', text }]);
    assert.deepEqual(got?.skipped, [], item.id);
    const run = compile(parseColorTransform(text, 'filter.ctf'));
    const o = [0, 0, 0];
    const want = (/** @type {number[]} */ rgb) => { run(rgb[0], rgb[1], rgb[2], o); return o.map(c01); };
    const e = off(want, got);
    assert.ok(e.most < 1, `${item.id}: off by ${e.most.toFixed(2)} of 255`);
  }
});

test('the filter is SVG the browser draws: tables, mixes, and a split that grades the right part only', () => {
  const got = /** @type {NonNullable<ReturnType<typeof pageStages>>} */ (pageStages([IN, { name: 'looks/shot-a.ctf', text: GRADES.saturation }, OUT]));
  const svg = filterMarkup(got.stages, 'of-grade-a');
  assert.match(svg, /^<filter id="of-grade-a" [^>]*color-interpolation-filters="sRGB">/);
  assert.equal(svg.match(/<feComponentTransfer /g)?.length, 2);
  assert.equal(svg.match(/<feColorMatrix [^>]*type="matrix"/g)?.length, 1);
  const values = /values="([^"]+)"/.exec(svg)?.[1].split(' ').map(Number) ?? [];
  assert.equal(values.length, 20);
  assert.deepEqual(values.slice(15), [0, 0, 0, 1, 0]);
  assert.equal(/tableValues="([^"]+)"/.exec(svg)?.[1].split(' ').length, TABLE);
  const split = filterMarkup(got.stages, 'of-grade-a', { split: 0.25 });
  assert.match(split, /x="0\.25" y="0" width="0\.75" height="1"/);
  assert.match(split, /<feMerge><feMergeNode in="SourceGraphic"\/><feMergeNode in="s2"\/><\/feMerge><\/filter>$/);
});
