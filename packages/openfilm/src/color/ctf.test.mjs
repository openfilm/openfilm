// @ts-check
/**
 * The color transform evaluator against OpenColorIO 2.6. The reference outputs in fixtures/ were written once by
 * scripts/color-oracle.py with PyOpenColorIO; these tests only read them (no Python).
 *
 * Tolerance: |ours - OCIO| <= abs + rel * |OCIO|, per case in the fixtures: 1e-5 absolute for every op, plus 5e-6
 * relative because OCIO computes in single precision (past about 2 a float cannot hold 1e-5). Wider, each with its
 * reason in the fixture: ops whose OCIO CPU renderer always uses its ~15-bit fast pow/log2/exp2 (ExposureContrast
 * linear/video, GradingPrimary, the linear styles of GradingTone and GradingRGBCurve, which this evaluator computes
 * exactly) 1e-4 relative; the linear GradingHueCurve 4e-5; OpenFilm's camera transforms 2e-5 (linear values in the
 * hundreds in single precision); files with the ACES 2.0 Output Transform (aces2.mjs) 1e-4 absolute. Inputs where OCIO
 * overflows single precision (infinity or NaN) are not compared.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseColorTransform, parseCtf, parseCube } from './ctf.mjs';
import { bake, compile, DEFAULT_SHAPER, floatToHalf, sampleBaked, shaperDecode } from './ops.mjs';

const here = (/** @type {string} */ path) => new URL(path, import.meta.url);
/** JSON has no NaN or infinity: the oracle writes them as strings. */
const readJson = (/** @type {string} */ path) =>
  JSON.parse(readFileSync(here(path), 'utf8'), (_, v) => (v === 'NaN' ? NaN : v === 'Infinity' ? Infinity : v === '-Infinity' ? -Infinity : v));

/**
 * @typedef {{ name?: string, file: string, tolerance: { abs: number, rel: number, why?: string }, maxInput?: number,
 *   outputs: number[][] }} Case
 */

/** The half-domain LUT the oracle wrote and then dropped (400 KB): each half maps to the next one up. */
function halfDomainCtf() {
  const values = [];
  for (let i = 0; i < 65536; i++) values.push((i & 0x7fff) < 0x7bff ? i + 1 : (i & 0x8000) | 0x3c00);
  return `<?xml version="1.0" encoding="UTF-8"?>
<ProcessList version="2.5" id="fixture">
    <LUT1D inBitDepth="32f" outBitDepth="32f" halfDomain="true" rawHalfs="true">
        <Array dim="65536 1">
${values.join(' ')}
        </Array>
    </LUT1D>
</ProcessList>
`;
}

/**
 * Runs a file's ops on the fixture inputs and checks them against OCIO's outputs; returns the largest error.
 * @param {string} text @param {string} file @param {number[][]} inputs @param {Case} c
 */
function check(text, file, inputs, c) {
  const run = compile(parseColorTransform(text, file));
  const { abs, rel } = c.tolerance;
  const out = [0, 0, 0];
  let worst = 0;
  let compared = 0;
  const max = c.maxInput ?? Infinity;
  inputs.forEach((rgb, i) => {
    if (rgb.some((v) => Math.abs(v) > max)) return;
    run(rgb[0], rgb[1], rgb[2], out);
    for (let k = 0; k < 3; k++) {
      const want = c.outputs[i][k];
      if (!Number.isFinite(want)) continue; // OCIO overflowed single precision
      const err = Math.abs(out[k] - want);
      const ok = err <= abs + rel * Math.abs(want);
      if (!ok) assert.fail(`${file}: input ${rgb.join(', ')} channel ${k}: ${out[k]}, OCIO ${want} (error ${err})`);
      worst = Math.max(worst, err);
      compared++;
    }
  });
  assert.ok(compared > 100, `${file}: only ${compared} values compared`);
  return worst;
}

const ops = readJson('./fixtures/ops.json');
for (const c of /** @type {Case[]} */ (ops.cases)) {
  test(`${c.name} matches OpenColorIO 2.6`, () => {
    const text = c.file === 'lut1d-halfDomain.ctf' ? halfDomainCtf() : readFileSync(here(`./fixtures/ops/${c.file}`), 'utf8');
    check(text, c.file, ops.inputs, c);
  });
}

const transforms = readJson('./fixtures/transforms.json');
for (const c of /** @type {Case[]} */ (transforms.cases)) {
  test(`transforms/${c.file} parses and matches OpenColorIO 2.6`, () => {
    check(readFileSync(here(`./transforms/${c.file}`), 'utf8'), c.file, transforms.inputs, c);
  });
}

test('every op type and style in the fixtures is read', () => {
  const seen = new Set();
  for (const c of /** @type {Case[]} */ (ops.cases)) {
    if (c.file === 'lut1d-halfDomain.ctf') continue;
    for (const op of parseColorTransform(readFileSync(here(`./fixtures/ops/${c.file}`), 'utf8'), c.file)) {
      seen.add(op.style === undefined ? op.type : `${op.type}:${op.style}${op.inverse ? 'Rev' : ''}`);
    }
  }
  for (const want of ['matrix', 'range', 'lut1d', 'lut3d', 'log:log10', 'log:antiLog2', 'log:cameraLogToLin',
    'exponent:monCurveMirrorRev', 'cdl:RevNoClamp', 'exposureContrast:logRev', 'gradingPrimary:videoRev',
    'gradingTone:linear', 'gradingRGBCurve:logRev', 'gradingHueCurve:video', 'fixedFunction:GamutComp13Fwd']) {
    assert.ok(seen.has(want), want);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// What the reader refuses, by name

/** @param {string} body */
const ctf = (body) => `<ProcessList version="2.5" id="t">${body}</ProcessList>`;

test('unsupported elements, styles and directions are Errors naming them', () => {
  /** @type {[string, RegExp][]} */
  const cases = [
    [ctf('<InverseLUT1D inBitDepth="32f" outBitDepth="32f"><Array dim="2 1">0 1</Array></InverseLUT1D>'), /InverseLUT1D/],
    [ctf('<Reference inBitDepth="32f" outBitDepth="32f" path="x.ctf"/>'), /Reference/],
    [ctf('<LUT1D inBitDepth="32f" outBitDepth="32f"><IndexMap dim="2">0@0 1@1</IndexMap><Array dim="2 1">0 1</Array></LUT1D>'), /IndexMap/],
    [ctf('<FixedFunction inBitDepth="32f" outBitDepth="32f" style="RedMod03Fwd"/>'), /RedMod03Fwd/],
    [ctf('<Log inBitDepth="32f" outBitDepth="32f" style="sideways"/>'), /sideways/],
    [ctf('<Matrix inBitDepth="32f" outBitDepth="10i"><Array dim="3 3">1 0 0 0 1 0 0 0 1</Array></Matrix>'
      + '<Matrix inBitDepth="32f" outBitDepth="32f"><Array dim="3 3">1 0 0 0 1 0 0 0 1</Array></Matrix>'), /does not match/],
    [ctf('<Matrix inBitDepth="32f" outBitDepth="32f"><Array dim="3 3">1 0 0</Array></Matrix>'), /expected 3x3/],
    [ctf('<ASC_CDL inBitDepth="32f" outBitDepth="32f"><SOPNode><Power>0 1 1</Power></SOPNode></ASC_CDL>'), /power/],
    ['<Root/>', /ProcessList/],
  ];
  for (const [text, message] of cases) assert.throws(() => parseCtf(text), message);
});

test('inverse GradingTone and GradingHueCurve are Errors when compiled', () => {
  const tone = parseCtf(ctf('<GradingTone inBitDepth="32f" outBitDepth="32f" style="logRev"><SContrast master="1.2"/></GradingTone>'));
  assert.throws(() => compile(tone), /GradingTone.*logRev/);
  const hue = parseCtf(ctf('<GradingHueCurve inBitDepth="32f" outBitDepth="32f" style="videoRev"><HueSat><ControlPoints>0 1 0.5 1.2</ControlPoints></HueSat></GradingHueCurve>'));
  assert.throws(() => compile(hue), /GradingHueCurve.*videoRev/);
});

test('a curve OCIO would refuse is refused', () => {
  const text = ctf('<GradingRGBCurve inBitDepth="32f" outBitDepth="32f" style="log"><Master><ControlPoints>0 0 0.5 0.4 1 0.3</ControlPoints></Master></GradingRGBCurve>');
  assert.throws(() => compile(parseCtf(text)), /y coordinate/);
});

test('.cube: sizes, entry counts and unknown keywords are checked', () => {
  assert.throws(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n1 1 1\n'), /expected 8/);
  assert.throws(() => parseCube('LUT_3D_SIZE 2\nLUT_1D_SIZE 2\n'), /both/);
  assert.throws(() => parseCube('FROBNICATE 3\n'), /FROBNICATE/);
  assert.throws(() => parseColorTransform('', 'grade.png'), /not a color transform/);
});

test('floatToHalf rounds to the nearest half, ties to even', () => {
  assert.equal(floatToHalf(1), 0x3c00);
  assert.equal(floatToHalf(-2), 0xc000);
  assert.equal(floatToHalf(65504), 0x7bff);
  assert.equal(floatToHalf(65520), 0x7c00); // rounds up to infinity
  assert.equal(floatToHalf(1 + 2 ** -11), 0x3c00); // tie, to even
  assert.equal(floatToHalf(1 + 3 * 2 ** -11), 0x3c02); // tie, to even
  assert.equal(floatToHalf(2 ** -24), 0x0001); // smallest subnormal
});

// ---------------------------------------------------------------------------------------------------------------
// Baking

const read = (/** @type {string} */ path) => readFileSync(here(path), 'utf8');
const ACESCCT = 'base="2" linSideSlope="1" linSideOffset="0" logSideSlope="0.0570776255707763" logSideOffset="0.554794520547945" linSideBreak="0.0078125"';
/** A gentle grade in ACEScct, as a colorist's first pass. */
const GRADE = ctf(`<GradingPrimary inBitDepth="32f" outBitDepth="32f" style="log">
    <Brightness rgb="0.01 0 -0.01" master="0.02"/><Saturation master="1.1"/></GradingPrimary>
  <GradingRGBCurve inBitDepth="32f" outBitDepth="32f" style="log">
    <Master><ControlPoints>0 0 0.3 0.29 0.7 0.71 1 1</ControlPoints></Master></GradingRGBCurve>`);
/** ACEScct to a display: linear, then the sRGB curve (no gamut matrix and no clamp, so the chain itself is smooth). */
const DISPLAY = ctf(`<Log inBitDepth="32f" outBitDepth="32f" style="cameraLogToLin"><LogParams ${ACESCCT}/></Log>
  <Exponent inBitDepth="32f" outBitDepth="32f" style="monCurveMirrorRev"><ExponentParams exponent="2.4" offset="0.055"/></Exponent>`);

/** A deterministic random sequence on [0, 1). */
function random(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * The largest difference between a baked LUT and the chain it was baked from, in 10-bit code values of the display
 * (each output clamped to 0..1 and rounded to its 10-bit code, as a display gets it), at `samples` points from `next`.
 * @param {import('./ctf.mjs').ColorOp[]} chain @param {ReturnType<typeof bake>} baked @param {() => number[]} next
 */
function bakedError(chain, baked, next, samples = 20000) {
  const run = compile(chain);
  const exact = [0, 0, 0];
  const lut = [0, 0, 0];
  const clamp = (/** @type {number} */ v) => Math.min(1, Math.max(0, v));
  let worst = 0;
  for (let i = 0; i < samples; i++) {
    const [r, g, b] = next();
    run(r, g, b, exact);
    sampleBaked(baked, r, g, b, lut);
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(Math.round(clamp(lut[k]) * 1023) - Math.round(clamp(exact[k]) * 1023)));
  }
  return worst;
}

test('bake: S-Log3 footage through a grade to a display, sampled from its 65^3 LUT, stays within one 10-bit code', () => {
  const chain = [...parseColorTransform(read('./transforms/in-sony-slog3.ctf'), 'in-sony-slog3.ctf'), ...parseCtf(GRADE), ...parseCtf(DISPLAY)];
  const baked = bake(chain, { size: 65 });
  assert.equal(baked.lut.length, 65 ** 3 * 3);
  assert.equal(baked.shaper, null);
  // Footage: a level from deep shadow to highlight, each channel within 0.03 code of it (about +-0.4 stop of color).
  const rnd = random(7);
  const next = () => {
    const level = 0.1 + 0.8 * rnd();
    return [0, 1, 2].map(() => level + (rnd() * 2 - 1) * 0.03);
  };
  const worst = bakedError(chain, baked, next);
  assert.ok(worst <= 1, `${worst} codes`);
});

test('bake: with the log2 shaper, scene-linear input through the same grade stays within one 10-bit code', () => {
  const toCct = parseCtf(ctf(`<Log inBitDepth="32f" outBitDepth="32f" style="cameraLinToLog"><LogParams ${ACESCCT}/></Log>`));
  const chain = [...toCct, ...parseCtf(GRADE), ...parseCtf(DISPLAY)];
  const baked = bake(chain, { size: 65, shaper: true });
  assert.deepEqual(baked.shaper, DEFAULT_SHAPER);
  // Linear values spread evenly in stops over the shaper's range, each channel within 0.4 stop of the level.
  const rnd = random(11);
  const next = () => {
    const level = shaperDecode(DEFAULT_SHAPER, 0.03 + 0.94 * rnd());
    return [0, 1, 2].map(() => level * 2 ** ((rnd() * 2 - 1) * 0.4));
  };
  const worst = bakedError(chain, baked, next);
  assert.ok(worst <= 1, `${worst} codes`);
});

test('bake: the LUT is in .cube order, red fastest', () => {
  const chain = [...parseCtf(GRADE), ...parseCtf(DISPLAY)];
  const baked = bake(chain, { size: 5 });
  const run = compile(chain);
  const out = [0, 0, 0];
  run(1, 0, 0, out); // grid point r = 4, g = 0, b = 0
  assert.deepEqual([...baked.lut.subarray(12, 15)], out.map(Math.fround));
  run(0, 0.25, 1, out); // r = 0, g = 1, b = 4
  const at = 3 * (0 + 5 * (1 + 5 * 4));
  assert.deepEqual([...baked.lut.subarray(at, at + 3)], out.map(Math.fround));
});

test('bake: sizes outside 2..129 and a bad shaper are refused', () => {
  assert.throws(() => bake([], { size: 1 }), /size/);
  assert.throws(() => bake([], { size: 130 }), /size/);
  assert.throws(() => bake([], { shaper: { min: 0, max: 1 } }), /shaper/);
});
