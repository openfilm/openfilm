// @ts-check
/**
 * The color transform evaluator: a list of ops (ctf.mjs) compiled into one function on a float RGB triple, and baked
 * into a 3D LUT. It runs unchanged in Node (to bake the LUT ffmpeg applies at the source's bit depth) and in a browser
 * Worker (the live preview). Plain JavaScript with no dependencies.
 *
 *   compile(ops)                  → (r, g, b, out) => void, the whole chain on one triple (out may be any [3] array)
 *   bake(ops, { size, shaper })   → { size, lut, shaper }: a size^3 3D LUT in .cube order (red fastest)
 *   sampleBaked(baked, r, g, b, out) → the baked LUT at one triple (its shaper, then tetrahedral interpolation)
 *
 * Every op computes what it can once, at compile time (matrices, curve fits, spline coefficients, constants), and
 * keeps only the per-pixel math in the returned function. Pixel values are float (any range, negatives included);
 * alpha is 1 where an op reads it (a 4x4 matrix's alpha column, folded in by ctf.mjs).
 *
 * The reference is OpenColorIO 2.6's CPU renderers, ported for the math, defaults, clamps and edge cases (NaN goes
 * where OCIO sends it): ops/matrix/MatrixOpCPU.cpp, ops/range/RangeOpCPU.cpp, ops/log/LogOpCPU.cpp and LogUtils.cpp,
 * ops/gamma/GammaOpCPU.cpp and GammaOpUtils.cpp (the CTF Exponent/Gamma op), ops/cdl/CDLOpCPU.cpp,
 * ops/exposurecontrast/ExposureContrastOpCPU.cpp, ops/lut1d/Lut1DOpCPU.cpp and ops/lut3d/Lut3DOpCPU.cpp; the grading
 * ops are in grading.mjs and the fixed functions in fixed-function.mjs. Arithmetic is double precision where OCIO's
 * is single, so results agree to float precision rather than bit for bit; where a formula is ill-conditioned enough
 * that single-precision rounding shows (PQ decoding, inverse gamut compression, the curve fits), it rounds as OCIO
 * does. Where OCIO's CPU renderers always use their fast ~15-bit pow/log2/exp2 approximations (some ExposureContrast,
 * GradingPrimary, GradingTone and GradingRGBCurve paths), this uses the exact functions.
 */

import { halfToFloat } from './ctf.mjs';
import { fixedFunction } from './fixed-function.mjs';
import { gradingHueCurve, gradingPrimary, gradingRGBCurve, gradingTone } from './grading.mjs';

/** @typedef {import('./ctf.mjs').ColorOp} ColorOp */
/** A compiled op: changes an RGB triple in place. @typedef {(v: Float64Array) => void} Step */
/** @typedef {(r: number, g: number, b: number, out: { [i: number]: number }) => void} ColorFunction */

/** The smallest normal float: log ops clamp to it rather than take the log of 0 or less. */
const FLT_MIN = 1.1754943508222875e-38;
/** std::max(FLT_MIN, x): NaN gives FLT_MIN. @param {number} x */
const aboveZero = (x) => (x > FLT_MIN ? x : FLT_MIN);
const f = Math.fround;
/** std::max(0, x) as OCIO writes it: NaN gives 0. @param {number} x */
const max0 = (x) => (x > 0 ? x : 0);

/**
 * The whole chain as one function on a float RGB triple.
 * @param {ColorOp[]} ops
 * @returns {ColorFunction}
 */
export function compile(ops) {
  const steps = /** @type {Step[]} */ (ops.map(compileOp).filter(Boolean));
  const v = new Float64Array(3);
  return (r, g, b, out) => {
    v[0] = r;
    v[1] = g;
    v[2] = b;
    for (let i = 0; i < steps.length; i++) steps[i](v);
    out[0] = v[0];
    out[1] = v[1];
    out[2] = v[2];
  };
}

/**
 * One op's step, or null for an op that changes nothing.
 * @param {ColorOp} op
 * @returns {Step | null}
 */
function compileOp(op) {
  switch (op.type) {
    case 'matrix': return matrix(op);
    case 'range': return range(op);
    case 'log': return log(op);
    case 'exponent': return exponent(op);
    case 'cdl': return cdl(op);
    case 'exposureContrast': return exposureContrast(op);
    case 'gradingPrimary': return gradingPrimary(op);
    case 'gradingTone': return gradingTone(op);
    case 'gradingRGBCurve': return gradingRGBCurve(op);
    case 'gradingHueCurve': return gradingHueCurve(op);
    case 'fixedFunction': return fixedFunction(op.style, op.params);
    case 'lut1d': return op.halfDomain ? lut1DHalf(op) : lut1D(op);
    case 'lut3d': return op.interpolation === 'tetrahedral' ? lut3DTetrahedral(op) : lut3DTrilinear(op);
    default: throw new Error(`unknown color op '${op.type}'`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Matrix, Range

/** @param {ColorOp} op @returns {Step} */
function matrix({ matrix: m, offset: o }) {
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = m;
  const [o0, o1, o2] = o;
  return (v) => {
    const r = v[0];
    const g = v[1];
    const b = v[2];
    v[0] = m0 * r + m1 * g + m2 * b + o0;
    v[1] = m3 * r + m4 * g + m5 * b + o1;
    v[2] = m6 * r + m7 * g + m8 * b + o2;
  };
}

/**
 * Range: scale and offset between the bounds, then clamp to the output bounds; with one bound missing, only a clamp
 * on that side (RangeOpData::fillScaleOffset, the Range*Renderer classes). NaN goes to the bound.
 * @param {ColorOp} op @returns {Step}
 */
function range({ minIn, maxIn, minOut, maxOut }) {
  if (minIn === null) return (v) => { for (let c = 0; c < 3; c++) v[c] = v[c] < maxOut ? v[c] : maxOut; };
  if (maxIn === null) return (v) => { for (let c = 0; c < 3; c++) v[c] = v[c] > minOut ? v[c] : minOut; };
  const scale = (maxOut - minOut) / (maxIn - minIn);
  const offset = minOut - scale * minIn;
  return (v) => {
    for (let c = 0; c < 3; c++) {
      const t = v[c] * scale + offset;
      v[c] = t > minOut ? (t < maxOut ? t : maxOut) : minOut;
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Log

/**
 * Log: logSlope * log_base(linSlope * x + linOffset) + logOffset and its inverse, with a linear segment below
 * linSideBreak for the camera styles (LogOpCPU.cpp; LogUtils.cpp GetLinearSlope, GetLogSideBreak, GetLinearOffset).
 * log2/log10/antiLog2/antiLog10 are the same formulas with the default params.
 * @param {ColorOp} op @returns {Step}
 */
function log({ style, base, params }) {
  const inverse = ['antiLog10', 'antiLog2', 'logToLin', 'cameraLogToLin'].includes(style);
  const camera = style === 'cameraLinToLog' || style === 'cameraLogToLin';
  const log2Base = Math.log2(base);
  const ch = params.map((/** @type {number[]} */ p) => {
    const [logSlope, logOffset, linSlope, linOffset, linBreak] = p;
    const c = { logSlope, logOffset, linSlope, linOffset, linBreak, linearSlope: 0, linearOffset: 0, logBreak: 0 };
    if (camera) {
      c.linearSlope = p.length > 5 ? p[5] : (logSlope * linSlope) / ((linSlope * linBreak + linOffset) * Math.log(base));
      c.logBreak = (Math.log2(linSlope * linBreak + linOffset) * logSlope) / log2Base + logOffset;
      c.linearOffset = c.logBreak - c.linearSlope * linBreak;
    }
    return c;
  });
  if (!inverse) {
    return (v) => {
      for (let i = 0; i < 3; i++) {
        const c = ch[i];
        const x = v[i];
        if (camera && x < c.linBreak) v[i] = c.linearSlope * x + c.linearOffset;
        else v[i] = (Math.log2(aboveZero(x * c.linSlope + c.linOffset)) * c.logSlope) / log2Base + c.logOffset;
      }
    };
  }
  return (v) => {
    for (let i = 0; i < 3; i++) {
      const c = ch[i];
      const y = v[i];
      if (camera && y < c.logBreak) v[i] = (y - c.linearOffset) / c.linearSlope;
      else v[i] = (2 ** (((y - c.logOffset) * log2Base) / c.logSlope) - c.linOffset) / c.linSlope;
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Exponent (CTF Gamma)

/**
 * The monCurve parameters of one channel, forward or reverse (GammaOpUtils.cpp): the power, its offset and scale,
 * and the break point and slope of the linear segment that meets the power function smoothly.
 * @param {number[]} p [gamma, offset] @param {boolean} reverse
 */
function monCurve([g, o], reverse) {
  const EPS = 1e-6;
  const gamma = Math.max(g, 1 + EPS);
  const offset = Math.max(o, EPS);
  if (!reverse) {
    return {
      gamma: f(gamma),
      offset: f(offset / (1 + offset)),
      brk: f(offset / (gamma - 1)),
      slope: f(((gamma - 1) / offset) * ((offset * gamma) / ((gamma - 1) * (1 + offset))) ** gamma),
      scale: f(1 / (1 + offset)),
    };
  }
  return {
    gamma: f(1 / gamma),
    offset: f(offset),
    brk: f(((offset * gamma) / ((gamma - 1) * (1 + offset))) ** gamma),
    slope: f(((gamma - 1) / offset) ** (gamma - 1) * ((1 + offset) / gamma) ** gamma),
    scale: f(1 + offset),
  };
}

/**
 * Exponent: a power function, its mirror around 0 or pass-through for negatives; or the monCurve power with a
 * linear toe (GammaOpCPU.cpp).
 * @param {ColorOp} op @returns {Step}
 */
function exponent({ style, params }) {
  const reverse = style.endsWith('Rev');
  const mirror = style.includes('Mirror');
  if (style.startsWith('basic')) {
    const g = params.map((/** @type {number[]} */ p) => f(reverse ? 1 / p[0] : p[0]));
    if (mirror) return (v) => { for (let c = 0; c < 3; c++) v[c] = (v[c] < 0 || Object.is(v[c], -0) ? -1 : 1) * Math.abs(v[c]) ** g[c]; };
    if (style.includes('PassThru')) return (v) => { for (let c = 0; c < 3; c++) if (v[c] > 0) v[c] = v[c] ** g[c]; };
    return (v) => { for (let c = 0; c < 3; c++) v[c] = max0(v[c]) ** g[c]; };
  }
  const k = params.map((/** @type {number[]} */ p) => monCurve(p, reverse));
  /** @type {(x: number, p: ReturnType<typeof monCurve>) => number} */
  const curve = reverse
    ? (x, p) => (x <= p.brk ? x * p.slope : x ** p.gamma * p.scale - p.offset)
    : (x, p) => (x <= p.brk ? x * p.slope : (x * p.scale + p.offset) ** p.gamma);
  if (mirror) {
    return (v) => {
      for (let c = 0; c < 3; c++) v[c] = (v[c] < 0 || Object.is(v[c], -0) ? -1 : 1) * curve(Math.abs(v[c]), k[c]);
    };
  }
  return (v) => { for (let c = 0; c < 3; c++) v[c] = curve(v[c], k[c]); };
}

// ---------------------------------------------------------------------------------------------------------------
// ASC CDL

/** @param {number} x clamp to [0, 1], NaN to 0 */
const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);

/**
 * ASC CDL: slope, offset, power, then saturation with Rec.709 luma. The clamping styles clamp to [0, 1] before the
 * power and at the end; the no-clamp styles pass negative values through the power. Rev inverts each step in reverse
 * order, with the reciprocals kept above 0.01 (CDLOpCPU.cpp).
 * @param {ColorOp} op @returns {Step}
 */
function cdl({ style, slope, offset, power, saturation }) {
  const clamp = style === 'Fwd' || style === 'Rev';
  const reverse = style === 'Rev' || style === 'RevNoClamp';
  const recip = (/** @type {number} */ x) => 1 / Math.max(f(x), f(1e-2));
  /** @param {Float64Array} v @param {number[]} p */
  const pow = (v, p) => {
    for (let c = 0; c < 3; c++) {
      if (clamp) v[c] = clamp01(v[c]) ** p[c];
      else v[c] = Number.isNaN(v[c]) ? 0 : v[c] < 0 ? v[c] : v[c] ** p[c];
    }
  };
  /** @param {Float64Array} v @param {number} sat */
  const saturate = (v, sat) => {
    const luma = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    for (let c = 0; c < 3; c++) v[c] = luma + sat * (v[c] - luma);
  };
  if (!reverse) {
    return (v) => {
      for (let c = 0; c < 3; c++) v[c] = v[c] * slope[c] + offset[c];
      pow(v, power);
      saturate(v, saturation);
      if (clamp) for (let c = 0; c < 3; c++) v[c] = clamp01(v[c]);
    };
  }
  const slopeInv = slope.map(recip);
  const powerInv = power.map(recip);
  const satInv = recip(saturation);
  return (v) => {
    if (clamp) for (let c = 0; c < 3; c++) v[c] = clamp01(v[c]);
    saturate(v, satInv);
    pow(v, powerInv);
    for (let c = 0; c < 3; c++) v[c] = (v[c] - offset[c]) * slopeInv[c];
    if (clamp) for (let c = 0; c < 3; c++) v[c] = clamp01(v[c]);
  };
}

// ---------------------------------------------------------------------------------------------------------------
// ExposureContrast

const MIN_PIVOT = 0.001;
const MIN_CONTRAST = 0.001;
const VIDEO_OETF_POWER = 0.54644808743169393; // 1 / 1.83

/**
 * ExposureContrast (ExposureContrastOpCPU.cpp). linear and video: x * exposure, or with contrast a power around the
 * pivot (negative values go to 0); video works on 1/1.83-power-encoded exposure and pivot. log: a line of slope
 * contrast through the pivot's log value, offset by exposure stops. logRev uses 0.088 for its exposure step whatever
 * the op says, as OCIO 2.6 does (ECLogarithmicRevRenderer never reads the op's logExposureStep).
 * @param {ColorOp} op @returns {Step}
 */
function exposureContrast(op) {
  const { style } = op;
  if (style === 'log' || style === 'logRev') {
    const pivot = f(Math.max(0, Math.log2(f(Math.max(MIN_PIVOT, op.pivot)) / 0.18) * op.logExposureStep + op.logMidGray));
    if (style === 'log') {
      const exposure = f(op.exposure) * f(op.logExposureStep);
      const k = f(Math.max(MIN_CONTRAST, op.contrast * op.gamma));
      const offset = (exposure - pivot) * k + pivot;
      return (v) => { for (let c = 0; c < 3; c++) v[c] = v[c] * k + offset; };
    }
    const exposure = f(op.exposure) * f(0.088);
    const kInv = f(Math.max(MIN_CONTRAST, 1 / (op.contrast * op.gamma)));
    const negOffset = pivot - pivot * kInv - exposure;
    return (v) => { for (let c = 0; c < 3; c++) v[c] = v[c] * kInv + negOffset; };
  }
  const video = style === 'video' || style === 'videoRev';
  const k = f(Math.max(MIN_CONTRAST, op.contrast * op.gamma));
  let exposure = 2 ** f(op.exposure);
  let pivot = f(Math.max(MIN_PIVOT, op.pivot));
  if (video) {
    exposure **= VIDEO_OETF_POWER;
    pivot **= VIDEO_OETF_POWER;
  }
  if (style === 'linear' || style === 'video') {
    if (k === 1) return (v) => { for (let c = 0; c < 3; c++) v[c] *= exposure; };
    const e = exposure / pivot;
    return (v) => { for (let c = 0; c < 3; c++) v[c] = max0(v[c] * e) ** k * pivot; };
  }
  if (k === 1) return (v) => { for (let c = 0; c < 3; c++) v[c] /= exposure; };
  const kInv = 1 / k;
  const pOverE = pivot / exposure;
  return (v) => { for (let c = 0; c < 3; c++) v[c] = max0(v[c] / pivot) ** kInv * pOverE; };
}

// ---------------------------------------------------------------------------------------------------------------
// LUT1D

/**
 * The order of a triple's channels: [max, mid, min] indices (GamutMapUtils::Order3, NaN cases included).
 * @param {number} r @param {number} g @param {number} b
 */
function order3(r, g, b) {
  const table = [2, 1, 0, 2, 1, 0, 2, 1, 2, 0, 1, 2];
  const i = (r > g ? 5 : 0) + (g > b ? 4 : 0) - (r > b ? 3 : 0) + 3;
  return [table[i], table[i + 1], table[i + 2]];
}

/**
 * The hue adjustment of a LUT1D with hueAdjust="dw3": the middle channel is put back where it was between the others,
 * so the LUT changes lightness and chroma but not hue (Lut1DRendererHueAdjust).
 * @param {(v: Float64Array) => void} lookup
 * @returns {Step}
 */
function hueAdjusted(lookup) {
  return (v) => {
    const [max, mid, min] = order3(v[0], v[1], v[2]);
    const chroma = v[max] - v[min];
    const hueFactor = chroma === 0 ? 0 : (v[mid] - v[min]) / chroma;
    lookup(v);
    v[mid] = hueFactor * (v[max] - v[min]) + v[min];
  };
}

/**
 * A LUT1D on [0, 1], linear interpolation, clamped at the ends, NaN to the first entry (Lut1DRenderer).
 * @param {ColorOp} op @returns {Step}
 */
function lut1D({ size, values, hueAdjust }) {
  const last = size - 1;
  /** @type {Step} */
  const lookup = (v) => {
    for (let c = 0; c < 3; c++) {
      let idx = v[c] * last;
      idx = idx > 0 ? (idx < last ? idx : last) : 0;
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      const a = values[hi * 3 + c];
      v[c] = (values[lo * 3 + c] - a) * (hi - idx) + a;
    }
  };
  return hueAdjust ? hueAdjusted(lookup) : lookup;
}

const halfBuffer = new DataView(new ArrayBuffer(4));

/**
 * A float's nearest half float, as its 16-bit pattern (round half to even; overflow to infinity).
 * @param {number} x
 */
export function floatToHalf(x) {
  halfBuffer.setFloat32(0, x);
  const bits = halfBuffer.getUint32(0);
  const sign = (bits >>> 16) & 0x8000;
  const exp = (bits >>> 23) & 0xff;
  const mant = bits & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  const e = exp - 127 + 15;
  if (e >= 31) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    const m = mant | 0x800000;
    const shift = 14 - e;
    let h = m >>> shift;
    const rest = m & ((1 << shift) - 1);
    const halfway = 1 << (shift - 1);
    if (rest > halfway || (rest === halfway && h & 1)) h++;
    return sign | h;
  }
  let h = (e << 10) | (mant >>> 13);
  const rest = mant & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && h & 1)) h++;
  return sign | h;
}

const HALF_MAX_BITS = 0x7bff;

/**
 * A half-domain LUT1D: 65536 entries, one per half float; a value is interpolated between the two halfs around it
 * (Lut1DRendererHalfCode, IndexPair::GetEdgeFloatValues).
 * @param {ColorOp} op @returns {Step}
 */
function lut1DHalf({ values, hueAdjust }) {
  /** @param {number} x @param {number} c */
  const lookup1 = (x, c) => {
    x = f(x);
    let bits = floatToHalf(x);
    if ((bits & 0x7fff) === 0x7c00) {
      bits = (bits & 0x8000) | HALF_MAX_BITS;
      x = halfToFloat(bits);
    }
    let a;
    let b;
    if (Math.abs(halfToFloat(bits)) > Math.abs(x)) {
      b = bits;
      a = bits - 1;
    } else {
      a = bits;
      b = bits + 1;
      if ((b & 0x7fff) === 0x7c00) {
        b = (b & 0x8000) | HALF_MAX_BITS;
        x = halfToFloat(b);
      }
    }
    const fa = halfToFloat(a);
    let frac = (x - fa) / (halfToFloat(b) - fa);
    if (Number.isNaN(frac)) frac = 0;
    const vb = values[b * 3 + c];
    return (values[a * 3 + c] - vb) * (1 - frac) + vb;
  };
  /** @type {Step} */
  const lookup = (v) => {
    for (let c = 0; c < 3; c++) v[c] = lookup1(v[c], c);
  };
  return hueAdjust ? hueAdjusted(lookup) : lookup;
}

// ---------------------------------------------------------------------------------------------------------------
// LUT3D (values blue fastest, as a LUT3D element)

/** @param {ColorOp} op @returns {Step} */
function lut3DTrilinear({ size, values }) {
  const last = size - 1;
  const n2 = size * size;
  return (v) => {
    const ir = clampIndex(v[0] * last, last);
    const ig = clampIndex(v[1] * last, last);
    const ib = clampIndex(v[2] * last, last);
    const r0 = Math.floor(ir), g0 = Math.floor(ig), b0 = Math.floor(ib);
    const r1 = Math.ceil(ir), g1 = Math.ceil(ig), b1 = Math.ceil(ib);
    const dr = ir - r0, dg = ig - g0, db = ib - b0;
    for (let c = 0; c < 3; c++) {
      const at = (/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b) => values[3 * (r * n2 + g * size + b) + c];
      const g00 = at(r0, g0, b0) * (1 - db) + at(r0, g0, b1) * db;
      const g01 = at(r0, g1, b0) * (1 - db) + at(r0, g1, b1) * db;
      const g10 = at(r1, g0, b0) * (1 - db) + at(r1, g0, b1) * db;
      const g11 = at(r1, g1, b0) * (1 - db) + at(r1, g1, b1) * db;
      const r0v = g00 * (1 - dg) + g01 * dg;
      const r1v = g10 * (1 - dg) + g11 * dg;
      v[c] = r0v * (1 - dr) + r1v * dr;
    }
  };
}

/** An index clamped to [0, last], NaN to 0. @param {number} x @param {number} last */
const clampIndex = (x, last) => (x > 0 ? (x < last ? x : last) : 0);

/**
 * Tetrahedral interpolation in a size^3 LUT, `index(r, g, b)` giving an entry's first value.
 * @param {ArrayLike<number>} values @param {number} size @param {(r: number, g: number, b: number) => number} index
 * @param {number} r @param {number} g @param {number} b @param {{ [i: number]: number }} out
 */
function tetrahedral(values, size, index, r, g, b, out) {
  const last = size - 1;
  const ir = clampIndex(r * last, last);
  const ig = clampIndex(g * last, last);
  const ib = clampIndex(b * last, last);
  const r0 = Math.floor(ir), g0 = Math.floor(ig), b0 = Math.floor(ib);
  const r1 = Math.ceil(ir), g1 = Math.ceil(ig), b1 = Math.ceil(ib);
  const fx = ir - r0, fy = ig - g0, fz = ib - b0;
  const n000 = index(r0, g0, b0);
  const n111 = index(r1, g1, b1);
  // The four corners and weights of the tetrahedron the point is in (Lut3DTetrahedralRenderer).
  let n1, n2, w0, w1, w2, w3;
  if (fx > fy) {
    if (fy > fz) { n1 = index(r1, g0, b0); n2 = index(r1, g1, b0); w0 = 1 - fx; w1 = fx - fy; w2 = fy - fz; w3 = fz; }
    else if (fx > fz) { n1 = index(r1, g0, b0); n2 = index(r1, g0, b1); w0 = 1 - fx; w1 = fx - fz; w2 = fz - fy; w3 = fy; }
    else { n1 = index(r0, g0, b1); n2 = index(r1, g0, b1); w0 = 1 - fz; w1 = fz - fx; w2 = fx - fy; w3 = fy; }
  } else if (fz > fy) { n1 = index(r0, g0, b1); n2 = index(r0, g1, b1); w0 = 1 - fz; w1 = fz - fy; w2 = fy - fx; w3 = fx; }
  else if (fz > fx) { n1 = index(r0, g1, b0); n2 = index(r0, g1, b1); w0 = 1 - fy; w1 = fy - fz; w2 = fz - fx; w3 = fx; }
  else { n1 = index(r0, g1, b0); n2 = index(r1, g1, b0); w0 = 1 - fy; w1 = fy - fx; w2 = fx - fz; w3 = fz; }
  for (let c = 0; c < 3; c++) {
    out[c] = w0 * values[n000 + c] + w1 * values[n1 + c] + w2 * values[n2 + c] + w3 * values[n111 + c];
  }
}

/** @param {ColorOp} op @returns {Step} */
function lut3DTetrahedral({ size, values }) {
  const n2 = size * size;
  /** @param {number} r @param {number} g @param {number} b */
  const index = (r, g, b) => 3 * (r * n2 + g * size + b);
  return (v) => tetrahedral(values, size, index, v[0], v[1], v[2], v);
}

// ---------------------------------------------------------------------------------------------------------------
// Baking

/**
 * The log2 shaper a bake can put in front of its 3D LUT, so that scene-linear (and HDR) input keeps precision: the
 * linear range [min, max] maps to [0, 1] evenly in stops, values below min to 0 and above max to 1:
 *   t = (log2(clamp(x, min, max)) - log2(min)) / (log2(max) - log2(min))
 * The default spans 0.18 * 2^-8 to 0.18 * 2^6 (14 stops around mid gray, about 0.0007 to 11.5): a 65^3 LUT then has
 * about 0.22 stop per step, which keeps an exponential display curve within one 10-bit code (the interpolation error
 * grows with the square of the stops per step). Input already encoded for display or log (0..1 code values) needs no
 * shaper.
 * @typedef {{ min: number, max: number }} Shaper
 */
export const DEFAULT_SHAPER = Object.freeze({ min: 0.18 * 2 ** -8, max: 0.18 * 2 ** 6 });

/** The shaper's [0, 1] coordinate of a linear value. @param {Shaper} s @param {number} x */
export function shaperEncode(s, x) {
  const lo = Math.log2(s.min);
  const t = (Math.log2(x > s.min ? (x < s.max ? x : s.max) : s.min) - lo) / (Math.log2(s.max) - lo);
  return t;
}

/** The linear value at a shaper coordinate. @param {Shaper} s @param {number} t */
export function shaperDecode(s, t) {
  const lo = Math.log2(s.min);
  return 2 ** (lo + t * (Math.log2(s.max) - lo));
}

/**
 * The chain baked into a 3D LUT: lut[3 * (r + size * (g + size * b))] is the output at grid point (r, g, b), red
 * fastest as in a .cube. Without a shaper the grid spans input 0..1; with one it spans the shaper's [0, 1], and the
 * input must go through shaperEncode first (sampleBaked does).
 * @param {ColorOp[]} ops
 * @param {{ size?: number, shaper?: Shaper | boolean }} [options] size: points per side (65 by default, at most 129);
 *   shaper: true for DEFAULT_SHAPER, or { min, max }
 * @returns {{ size: number, lut: Float32Array, shaper: Shaper | null }}
 */
export function bake(ops, options = {}) {
  const size = options.size ?? 65;
  if (!Number.isInteger(size) || size < 2 || size > 129) throw new Error(`bake: size ${size} is not 2 to 129`);
  const shaper = options.shaper === true ? DEFAULT_SHAPER : options.shaper ? options.shaper : null;
  if (shaper && !(shaper.min > 0 && shaper.max > shaper.min)) throw new Error('bake: the shaper needs 0 < min < max');
  const run = compile(ops);
  const axis = new Float64Array(size);
  for (let i = 0; i < size; i++) axis[i] = shaper ? shaperDecode(shaper, i / (size - 1)) : i / (size - 1);
  const lut = new Float32Array(size ** 3 * 3);
  const out = [0, 0, 0];
  let k = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        run(axis[r], axis[g], axis[b], out);
        lut[k++] = out[0];
        lut[k++] = out[1];
        lut[k++] = out[2];
      }
    }
  }
  return { size, lut, shaper };
}

/**
 * A baked LUT at one input triple: its shaper, then tetrahedral interpolation (what ffmpeg's lut3d does by default).
 * @param {{ size: number, lut: Float32Array, shaper: Shaper | null }} baked
 * @param {number} r @param {number} g @param {number} b @param {{ [i: number]: number }} out
 */
export function sampleBaked({ size, lut, shaper }, r, g, b, out) {
  if (shaper) {
    r = shaperEncode(shaper, r);
    g = shaperEncode(shaper, g);
    b = shaperEncode(shaper, b);
  }
  tetrahedral(lut, size, (ri, gi, bi) => 3 * (ri + size * (gi + size * bi)), r, g, b, out);
}

/**
 * A baked LUT (bake, without a shaper) as a `.cube` file's text: what ffmpeg's lut3d reads. Values are written with
 * enough digits for a 16-bit picture; those past 0–1 are kept, and the picture is clamped after the lookup.
 * @param {{ size: number, lut: Float32Array, shaper?: unknown }} baked @param {string} [title]
 */
export function cubeText({ size, lut, shaper }, title = 'OpenFilm grade') {
  if (shaper) throw new Error('cubeText: a LUT baked with a shaper needs its 1D shaper too');
  const lines = [`TITLE "${title.replace(/"/g, "'")}"`, `LUT_3D_SIZE ${size}`];
  for (let i = 0; i < lut.length; i += 3) lines.push(`${lut[i].toFixed(6)} ${lut[i + 1].toFixed(6)} ${lut[i + 2].toFixed(6)}`);
  return `${lines.join('\n')}\n`;
}
