import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCtf } from './ctf.mjs';
import { compile } from './ops.mjs';
import { cdlXml, elementsOf, hueCurveXml, newCtf, primaryXml, rgbCurveXml, setOp, toneXml } from './edit.mjs';
import { chainOf, ownLayer, partsOf, roleOf, withChain, withInput, withLayer, withoutLayer, withScreen, OUTPUT, SDR_INPUT } from './chain.mjs';

test('a layer written operation by operation reads back as those operations, with only what differs from each default', () => {
  let t = newCtf('shot-s7', 'the shot');
  assert.match(t, /<ProcessList version="2.5" id="shot-s7">/, 'the version whose readers take hue curves');
  t = setOp(t, 'balance', cdlXml('balance', { offset: [0.01, 0, -0.02] }));
  t = setOp(t, 'primary', primaryXml('primary', { contrast: { r: 1, g: 1, b: 1, m: 1.2 }, saturation: 1.15, brightness: { r: 0, g: 0, b: 0, m: 0 } }));
  t = setOp(t, 'tone', toneXml('tone', { shadows: { r: 1, g: 1, b: 1, m: 0.9 }, highlights: { r: 1, g: 1, b: 1, m: 1 } }));
  t = setOp(t, 'curves', rgbCurveXml('curves', { master: { points: [[0, 0], [0.4, 0.37], [1, 1]] }, red: { points: [[0, 0], [0.5, 0.5], [1, 1]] } }));
  t = setOp(t, 'hue', hueCurveXml('hue', { hueSat: { points: [[0, 1], [0.33, 1.3], [0.66, 1]] } }));
  const ops = parseCtf(t);
  assert.deepEqual(ops.map((o) => o.type), ['cdl', 'gradingPrimary', 'gradingTone', 'gradingRGBCurve', 'gradingHueCurve']);
  assert.deepEqual(ops[0].offset, [0.01, 0, -0.02]);
  assert.equal(ops[1].contrast.m, 1.2);
  assert.equal(ops[1].saturation, 1.15);
  assert.ok(!/Brightness/.test(t), 'a value at its default is left out');
  assert.equal(ops[2].shadows.m, 0.9);
  assert.ok(!/Highlights/.test(t), 'a zone as it is is left out');
  assert.deepEqual(ops[3].master.points.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]), [[0, 0], [0.4, 0.37], [1, 1]]);
  assert.ok(!/<Red>/.test(t), 'a straight curve is left out');
  assert.ok(Math.abs(ops[4].hueSat.points[1][1] - 1.3) < 1e-6);
  /* and it is a grade: mid grey goes somewhere else */
  const o = [0, 0, 0];
  compile(ops)(0.4, 0.4, 0.4, o);
  assert.ok(o.some((v) => Math.abs(v - 0.4) > 0.005), `${o}`);
});

test('changing one operation leaves the rest of a file as it was, comments and others\' operations too', () => {
  const theirs = `<?xml version="1.0" encoding="UTF-8"?>
<ProcessList version="2.5" id="beach">
    <!-- a note of the colorist's -->
    <Matrix inBitDepth="32f" outBitDepth="32f">
        <Array dim="3 3">1 0 0 0 1 0 0 0 1</Array>
    </Matrix>
    <ASC_CDL name="balance" inBitDepth="32f" outBitDepth="32f" style="FwdNoClamp">
        <SOPNode><Slope>1 1 1</Slope><Offset>0 0 0</Offset><Power>1 1 1</Power></SOPNode>
    </ASC_CDL>
</ProcessList>
`;
  const changed = setOp(theirs, 'balance', cdlXml('balance', { offset: [0.02, 0, 0] }));
  assert.ok(changed.startsWith(theirs.slice(0, theirs.indexOf('    <ASC_CDL'))), 'all before it the same, byte for byte');
  assert.match(changed, /<!-- a note of the colorist's -->/);
  assert.deepEqual(parseCtf(changed).map((o) => o.type), ['matrix', 'cdl']);
  assert.deepEqual(parseCtf(changed)[1].offset, [0.02, 0, 0]);
  /* added in front of a named one, then taken out */
  const before = setOp(changed, 'match', cdlXml('match', { slope: [1.1, 1, 1] }), { before: 'balance' });
  assert.deepEqual(elementsOf(before).map((e) => e.name ?? e.tag), ['Matrix', 'match', 'balance']);
  assert.equal(setOp(before, 'match', null), changed, 'taking it out gives the file back');
  assert.equal(setOp(changed, 'nothing', null), changed);
});

test('a clip\'s grade in parts: input, layers, output, read from film.html\'s style alone', () => {
  const style = 'left: 0; --of-lut: url(looks/in-sony-slog3.ctf) url(looks/beach.ctf) url(looks/out-rec709.ctf)';
  const chain = chainOf(style);
  assert.deepEqual(chain, ['looks/in-sony-slog3.ctf', 'looks/beach.ctf', 'looks/out-rec709.ctf']);
  assert.deepEqual(chain.map(roleOf), ['input', 'layer', 'output']);
  assert.deepEqual(partsOf(chain), { input: 'looks/in-sony-slog3.ctf', layers: ['looks/beach.ctf'], output: 'looks/out-rec709.ctf', after: [] });
  /* a look made for the screen, after the output: it stays last whatever goes in */
  const looked = [...chain, 'looks/film.cube'];
  assert.deepEqual(partsOf(looked).after, ['looks/film.cube']);
  assert.deepEqual(withLayer(looked, ownLayer('s7')), ['looks/in-sony-slog3.ctf', 'looks/beach.ctf', 'looks/shot-s7.ctf', 'looks/out-rec709.ctf', 'looks/film.cube']);
  assert.deepEqual(withoutLayer([SDR_INPUT, OUTPUT, 'looks/film.cube'], 'looks/film.cube'), []);
  /* a library filter: made for the screen by its name, alone on ordinary video, after the output once there is one */
  const filtered = withScreen([], 'looks/filter-warm-film-80.ctf', (u) => u.includes('/filter-'));
  assert.deepEqual(filtered, ['looks/filter-warm-film-80.ctf']);
  assert.equal(roleOf(filtered[0]), 'screen');
  assert.deepEqual(partsOf(filtered), { input: null, layers: [], output: null, after: ['looks/filter-warm-film-80.ctf'] });
  const both = withLayer(filtered, ownLayer('s7'));
  assert.deepEqual(both, [SDR_INPUT, 'looks/shot-s7.ctf', OUTPUT, 'looks/filter-warm-film-80.ctf']);
  assert.deepEqual(withoutLayer(both, 'looks/shot-s7.ctf'), filtered, 'its own layer gone: the filter alone again');
  assert.deepEqual(withScreen(both, 'looks/filter-teal-orange-50.ctf', (u) => u.includes('/filter-')), [SDR_INPUT, 'looks/shot-s7.ctf', OUTPUT, 'looks/filter-teal-orange-50.ctf']);
  assert.deepEqual(withScreen(filtered, null, (u) => u.includes('/filter-')), []);
  /* a clip's own layer goes in before the output; a clip graded for the first time gets ordinary footage's parts */
  assert.deepEqual(withLayer(chain, ownLayer('s7')), ['looks/in-sony-slog3.ctf', 'looks/beach.ctf', 'looks/shot-s7.ctf', 'looks/out-rec709.ctf']);
  assert.deepEqual(withLayer([], ownLayer('s7')), [SDR_INPUT, 'looks/shot-s7.ctf', OUTPUT]);
  assert.equal(roleOf(ownLayer('in-car')), 'layer', 'a clip named in-… is still a layer');
  assert.deepEqual(withInput(chain, 'looks/in-apple-log.ctf'), ['looks/in-apple-log.ctf', 'looks/beach.ctf', 'looks/out-rec709.ctf']);
  /* the last layer of ordinary footage taken out: no grade at all, so the clip plays exactly as it is */
  assert.deepEqual(withoutLayer([SDR_INPUT, 'looks/shot-s7.ctf', OUTPUT], 'looks/shot-s7.ctf'), []);
  assert.deepEqual(withoutLayer(chain, 'looks/beach.ctf'), ['looks/in-sony-slog3.ctf', 'looks/out-rec709.ctf'], 'log footage keeps its conversion');
  assert.equal(withChain(style, []), 'left: 0');
  assert.equal(withChain('', ['looks/a.ctf']), '--of-lut: url(looks/a.ctf)');
});
