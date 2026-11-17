import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseColorTransform, parseCtf } from './ctf.mjs';
import { compile } from './ops.mjs';
import { cdlXml, elementsOf, primaryXml, setOp, newCtf } from './edit.mjs';
import { ADJUST_KEYS, adjustOf, curvesOf, filterAt, filterCtf, filterOfUrl, filterUrl, hueCurvesOf, isEmptyLayer, isNeutral, PLAIN_CURVE, wheelAt, wheelColor, wheelsOf, withAdjust, withCurves, withHueCurves, withWheels } from './adjust.mjs';

const T = new URL('./transforms/', import.meta.url);
const chain = (/** @type {string} */ layer) => compile([
  ...parseColorTransform(readFileSync(new URL('in-rec709.ctf', T), 'utf8'), 'in-rec709.ctf'),
  ...parseCtf(layer),
  ...parseColorTransform(readFileSync(new URL('out-rec709.ctf', T), 'utf8'), 'out-rec709.ctf'),
]);
const shown = (/** @type {string} */ layer, /** @type {number[]} */ rgb) => { const o = [0, 0, 0]; chain(layer)(rgb[0], rgb[1], rgb[2], o); return o; };

test('the sliders read back as they were written, and each moves the picture its own way', () => {
  const set = { temperature: 30, tint: -10, exposure: 0.5, contrast: 20, highlights: -40, shadows: 25, saturation: 15 };
  const text = withAdjust(null, set, 'shot-s7');
  assert.deepEqual(adjustOf(text), set);
  assert.deepEqual(elementsOf(text).map((e) => e.name), ['adjust', 'adjust-tone']);
  /* one at a time, on mid grey and on a colour, through the clip's whole chain */
  const grey = [0.45, 0.45, 0.45], blue = [0.3, 0.45, 0.7];
  const one = (/** @type {string} */ k, /** @type {number} */ v) => withAdjust(null, { [k]: v });
  assert.ok(shown(one('exposure', 1), grey)[1] > shown(one('exposure', 0), grey)[1] + 0.08, 'brighter');
  const warm = shown(one('temperature', 60), grey);
  assert.ok(warm[0] > warm[2] + 0.03, `warmer: red over blue ${warm}`);
  const magenta = shown(one('tint', 60), grey);
  assert.ok(magenta[1] < magenta[0] - 0.02, `more magenta: green under red ${magenta}`);
  assert.ok(shown(one('highlights', -80), [0.85, 0.85, 0.85])[1] < shown(one('highlights', 0), [0.85, 0.85, 0.85])[1] - 0.02, 'highlights down');
  assert.ok(shown(one('shadows', 80), [0.12, 0.12, 0.12])[1] > shown(one('shadows', 0), [0.12, 0.12, 0.12])[1] + 0.01, 'shadows up');
  const bw = shown(one('saturation', -100), blue);
  assert.ok(Math.abs(bw[0] - bw[2]) < 0.002, `black and white ${bw}`);
  /* nothing set: no operations at all, so the layer changes nothing */
  assert.equal(elementsOf(withAdjust(text, Object.fromEntries(ADJUST_KEYS.map((k) => [k, 0])))).length, 0);
  assert.ok(isNeutral(adjustOf(newCtf('x'))));
});

test('a slider changes only what it says: others\' operations, comments and the rest of an operation are kept', () => {
  let text = newCtf('shot-s7');
  text = setOp(text, 'balance', cdlXml('balance', { offset: [0.01, 0, -0.02] }));
  /* an agent's adjust with a gamma and a red brightness of its own */
  text = setOp(text, 'adjust', primaryXml('adjust', { brightness: { r: 4, g: 0, b: 0, m: 0 }, gamma: { r: 1, g: 1, b: 1, m: 1.1 } }));
  text = text.replace('<ASC_CDL', '<!-- theirs -->\n    <ASC_CDL');
  const before = adjustOf(text);
  const after = withAdjust(text, { exposure: 0.3 });
  assert.deepEqual(adjustOf(after), { ...before, exposure: 0.3 });
  assert.match(after, /<!-- theirs -->/);
  assert.deepEqual(parseCtf(after).find((o) => o.type === 'cdl')?.offset, [0.01, 0, -0.02]);
  assert.equal(parseCtf(after).find((o) => o.type === 'gradingPrimary')?.gamma.m, 1.1, 'its gamma kept');
});

test('a library filter as a file grades exactly as its SVG filter draws it', () => {
  const items = JSON.parse(readFileSync(new URL('../../library/catalogs/filters.json', import.meta.url), 'utf8')).items.filter((/** @type {any} */ i) => i.grade);
  assert.ok(items.length > 30, 'the library\'s filters');
  for (const item of items) {
    for (const amount of [1, 0.6]) {
      const f = filterAt(item.grade, amount);
      const run = compile(parseCtf(filterCtf(item.id, item.name.en, item.grade, amount)));
      /* the SVG filter (color-interpolation-filters sRGB): the matrix, clamped; saturate; each channel's table */
      const svg = (/** @type {number[]} */ c) => {
        let v = c;
        if (f.mix) v = [0, 1, 2].map((r) => Math.min(1, Math.max(0, f.mix[r * 4] * c[0] + f.mix[r * 4 + 1] * c[1] + f.mix[r * 4 + 2] * c[2] + f.mix[r * 4 + 3])));
        const s = f.sat, l = [0.2126, 0.7152, 0.0722];
        const y = l[0] * v[0] + l[1] * v[1] + l[2] * v[2];
        v = v.map((x) => Math.min(1, Math.max(0, y + s * (x - y))));
        if (f.curves) v = v.map((x, k) => { const t = f.curves[['r', 'g', 'b'][k]]; const p = x * 16, i = Math.min(15, Math.floor(p)); return t[i] + (t[i + 1] - t[i]) * (p - i); });
        return v;
      };
      for (const c of [[0.1, 0.2, 0.3], [0.9, 0.5, 0.1], [0.5, 0.5, 0.5], [0.02, 0.95, 0.6], [1, 1, 1]]) {
        const o = [0, 0, 0];
        run(c[0], c[1], c[2], o);
        const want = svg(c);
        assert.ok(o.every((v, k) => Math.abs(v - want[k]) < 2e-4), `${item.id} ${amount} ${c}: ${o} vs ${want}`);
      }
    }
  }
  assert.equal(filterUrl('filters/teal-orange', 0.8), 'looks/filter-teal-orange-80.ctf');
  assert.deepEqual(filterOfUrl('looks/filter-teal-orange-80.ctf'), { slug: 'teal-orange', amount: 0.8 });
  assert.equal(filterOfUrl('looks/shot-s7.ctf'), null);
});

test('wheels, curves and hue curves read back as written, move the picture their way, and go when plain', () => {
  const warmShadows = wheelAt({ r: 1, g: 1, b: 1, m: 1 }, 0, 0.6);
  assert.ok(warmShadows.r > 1 && warmShadows.b < 1, 'hue 0 is toward red');
  const back = wheelColor(warmShadows);
  assert.ok(Math.abs(back.hue) < 1e-3 || Math.abs(back.hue - 1) < 1e-3);
  assert.ok(Math.abs(back.far - 0.6) < 1e-3);
  let t = withWheels(null, { shadows: warmShadows, highlights: { r: 1, g: 1, b: 1, m: 1.3 } });
  assert.deepEqual(wheelsOf(t).shadows, warmShadows);
  assert.ok(adjustOf(t).highlights > 30, 'the highlights ring is the highlights slider');
  const dark = [0.15, 0.15, 0.15];
  const o = shown(t, dark);
  assert.ok(o[0] > o[2] + 0.01, `shadows warmer ${o}`);
  t = withCurves(t, { master: [[0, 0], [0.42, 0.36], [1, 1]] });
  assert.deepEqual(curvesOf(t).master, [[0, 0], [0.42, 0.36], [1, 1]]);
  assert.deepEqual(curvesOf(t).red, PLAIN_CURVE.red);
  assert.ok(shown(t, [0.45, 0.45, 0.45])[1] < shown(withCurves(t, { master: PLAIN_CURVE.master }), [0.45, 0.45, 0.45])[1] - 0.01, 'the master curve pulled down darkens the middle');
  t = withHueCurves(t, { hueSat: [[0, 1], [0.6, 1], [0.76, 1.4], [0.9, 1]] });
  assert.equal(hueCurvesOf(t).hueSat[2][1], 1.4);
  /* each taken back to plain: nothing left in the layer */
  t = withHueCurves(withCurves(withWheels(t, { shadows: { r: 1, g: 1, b: 1, m: 1 }, highlights: { r: 1, g: 1, b: 1, m: 1 } }), { master: PLAIN_CURVE.master }), { hueSat: PLAIN_CURVE.hueSat });
  assert.ok(isEmptyLayer(t), t);
});
