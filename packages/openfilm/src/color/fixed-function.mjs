// @ts-check
/**
 * OpenColorIO's FixedFunction ops: fixed formulas a CTF names by style. Each is compiled into a step that changes an
 * RGB triple in place (see ops.mjs). The HSY conversions here are also the color model of GradingHueCurve.
 *
 * The reference is OpenColorIO 2.6, src/OpenColorIO/ops/fixedfunction/FixedFunctionOpCPU.cpp (Renderer_* classes,
 * gamut_comp/compress/uncompress, applyRGBToHSY/applyHSYToRGB, the ST_2084 renderers). The ACES 2.0 Output Transform
 * styles are aces2.mjs's.
 */

import { acesOutput20 } from './aces2.mjs';

/** @typedef {(v: Float64Array) => void} Step */

const SIXTH = 0.16666666666666666;
const f = Math.fround;
/** The largest saturation HSV_TO_RGB takes: a little under 2, where RGB would go to infinity. */
const MAX_SAT = f(1.999);

/** @param {number} x @param {number} lo @param {number} hi */
const clamp = (x, lo, hi) => (x > lo ? (x < hi ? x : hi) : lo);

/**
 * The step of a FixedFunction op.
 * @param {string} style a style ctf.mjs reads (FIXED_FUNCTION_STYLES)
 * @param {number[]} params
 * @returns {Step}
 */
export function fixedFunction(style, params) {
  switch (style) {
    case 'GamutComp13Fwd':
    case 'GamutComp13Rev':
      return gamutComp13(params, style === 'GamutComp13Rev');
    case 'Rec2100SurroundFwd':
    case 'Rec2100SurroundRev':
      return rec2100Surround(params[0], style === 'Rec2100SurroundRev');
    case 'RGB_TO_HSV':
      return rgbToHsv;
    case 'HSV_TO_RGB':
      return hsvToRgb;
    case 'RGB_TO_HSY_LIN':
      return (v) => rgbToHsy(v, 'linear');
    case 'RGB_TO_HSY_LOG':
      return (v) => rgbToHsy(v, 'log');
    case 'RGB_TO_HSY_VID':
      return (v) => rgbToHsy(v, 'video');
    case 'HSY_LIN_TO_RGB':
      return (v) => hsyToRgb(v, 'linear');
    case 'HSY_LOG_TO_RGB':
      return (v) => hsyToRgb(v, 'log');
    case 'HSY_VID_TO_RGB':
      return (v) => hsyToRgb(v, 'video');
    case 'XYZ_TO_xyY':
      return xyzToXyY;
    case 'xyY_TO_XYZ':
      return xyYToXyz;
    case 'XYZ_TO_uvY':
      return xyzToUvY;
    case 'uvY_TO_XYZ':
      return uvYToXyz;
    case 'XYZ_TO_LUV':
      return xyzToLuv;
    case 'LUV_TO_XYZ':
      return luvToXyz;
    case 'Lin_TO_PQ':
      return linToPq;
    case 'PQ_TO_Lin':
      return pqToLin;
    case 'ACESOutputTransform20Fwd':
    case 'ACESOutputTransform20Inv': {
      const apply = acesOutput20(params, style === 'ACESOutputTransform20Inv');
      return (v) => apply(v[0], v[1], v[2], v);
    }
    default:
      throw new Error(`FixedFunction style '${style}' is not supported`);
  }
}

/**
 * ACES gamut compression 1.3: pulls colors outside the gamut back in along lines of constant hue, per channel, past a
 * threshold (Renderer_ACES_GamutComp13_Fwd / _Inv). params: limits (cyan, magenta, yellow), thresholds, power.
 * @param {number[]} params @param {boolean} inverse
 * @returns {Step}
 */
function gamutComp13(params, inverse) {
  // Single precision throughout, as OCIO: near the asymptote the inverse is ill-conditioned, and agreeing with OCIO
  // there means rounding where it rounds.
  const [limC, limM, limY, thrC, thrM, thrY, power] = params.map(f);
  const invPower = f(1 / power);
  // The scale that puts the curve through y = 1 at the limit.
  const scaleOf = (/** @type {number} */ lim, /** @type {number} */ thr) =>
    f(f(lim - thr) / f(f(f(f(f(1 - thr) / f(lim - thr)) ** -power) - 1) ** invPower));
  const scales = [scaleOf(limC, thrC), scaleOf(limM, thrM), scaleOf(limY, thrY)];
  const thrs = [thrC, thrM, thrY];
  /** @param {number} dist @param {number} thr @param {number} scale */
  const compress = (dist, thr, scale) => {
    const nd = f(f(dist - thr) / scale);
    return f(thr + f(f(scale * nd) / f(f(1 + f(nd ** power)) ** invPower)));
  };
  /** @param {number} dist @param {number} thr @param {number} scale */
  const uncompress = (dist, thr, scale) => {
    if (dist >= f(thr + scale)) return dist; // the asymptote
    const p = f(f(f(dist - thr) / scale) ** power);
    return f(thr + f(scale * f(f(-f(p / f(p - 1))) ** invPower)));
  };
  const curve = inverse ? uncompress : compress;
  return (v) => {
    const ach = f(Math.max(v[0], Math.max(v[1], v[2])));
    for (let c = 0; c < 3; c++) {
      if (ach === 0) {
        v[c] = 0;
        continue;
      }
      const dist = f(f(ach - f(v[c])) / Math.abs(ach));
      if (dist < thrs[c]) continue;
      v[c] = ach - curve(dist, thrs[c], scales[c]) * Math.abs(ach);
    }
  };
}

/**
 * The Rec.2100 surround correction: RGB scaled by Y^(gamma - 1), Y the Rec.2100 luminance, mirrored around 0 and
 * kept above a small floor (Renderer_REC2100_Surround). The inverse uses 1 / gamma.
 * @param {number} gamma @param {boolean} inverse
 * @returns {Step}
 */
function rec2100Surround(gamma, inverse) {
  const minLum = inverse ? f(f(1e-4) ** f(gamma)) : f(1e-4);
  const exponent = (inverse ? 1 / f(gamma) : f(gamma)) - 1;
  return (v) => {
    const Y = Math.max(minLum, Math.abs(0.2627 * v[0] + 0.678 * v[1] + 0.0593 * v[2]));
    const k = Y ** exponent;
    v[0] *= k;
    v[1] *= k;
    v[2] *= k;
  };
}

/**
 * RGB to HSV for extended values: S is on [0, 1] when RGB are all non-negative (or all negative) and on [1, 2] when
 * mixed; H on [0, 1) (Renderer_RGB_TO_HSV).
 * @type {Step}
 */
function rgbToHsv(v) {
  const [r, g, b] = v;
  const min = Math.min(Math.min(r, g), b);
  const max = Math.max(Math.max(r, g), b);
  let val = max;
  let sat = 0;
  let hue = 0;
  if (min !== max) {
    const delta = max - min;
    if (max !== 0) sat = delta / max;
    if (r === max) hue = (g - b) / delta;
    else if (g === max) hue = 2 + (b - r) / delta;
    else hue = 4 + (r - g) / delta;
    if (hue < 0) hue += 6;
    hue *= SIXTH;
  }
  if (min < 0) val += min;
  if (-min > max) sat = (max - min) / -min;
  v[0] = hue;
  v[1] = sat;
  v[2] = val;
}

/** HSV back to RGB, H wrapped into [0, 1), S clamped to [0, 1.999] (Renderer_HSV_TO_RGB). @type {Step} */
function hsvToRgb(v) {
  const hue = (v[0] - Math.floor(v[0])) * 6;
  const sat = clamp(v[1], 0, MAX_SAT);
  const val = v[2];
  const r = clamp(Math.abs(hue - 3) - 1, 0, 1);
  const g = clamp(2 - Math.abs(hue - 2), 0, 1);
  const b = clamp(2 - Math.abs(hue - 4), 0, 1);
  let max = val;
  let min = val * (1 - sat);
  if (sat > 1) {
    min = (val * (1 - sat)) / (2 - sat);
    max = val - min;
  }
  if (val < 0) {
    min = val / (2 - sat);
    max = val - min;
  }
  const delta = max - min;
  v[0] = r * delta + min;
  v[1] = g * delta + min;
  v[2] = b * delta + min;
}

/**
 * RGB to HSY: hue (magenta at 0, not red), a saturation scaled for the style, and Rec.709 luma (applyRGBToHSY).
 * @param {Float64Array} v @param {'linear' | 'log' | 'video'} style
 */
export function rgbToHsy(v, style) {
  const [r, g, b] = v;
  const min = Math.min(Math.min(r, g), b);
  const max = Math.max(Math.max(r, g), b);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const dist = Math.abs(r - luma) + Math.abs(g - luma) + Math.abs(b - luma);
  let sat;
  if (style === 'linear') {
    const sum = r + g + b;
    const satHi = dist / Math.max(0.07 * dist + 1e-6, 0.15 + sum);
    const satLo = dist * 5;
    const alpha = clamp((luma - 0.001) / (0.01 - 0.001), 0, 1);
    sat = (satLo + alpha * (satHi - satLo)) * 1.4;
  } else {
    sat = dist * (style === 'log' ? 4 : 1.25);
  }
  let hue = 0;
  if (min !== max) {
    const delta = max - min;
    if (r === max) hue = 1 + (g - b) / delta;
    else if (g === max) hue = 3 + (b - r) / delta;
    else hue = 5 + (r - g) / delta;
    hue *= SIXTH;
  }
  v[0] = hue;
  v[1] = sat;
  v[2] = luma;
}

/**
 * HSY back to RGB (applyHSYToRGB).
 * @param {Float64Array} v @param {'linear' | 'log' | 'video'} style
 */
export function hsyToRgb(v, style) {
  let hue = v[0] - 1 / 6;
  let sat = v[1];
  const luma = v[2];
  // Negative luma turns the hue around.
  if (luma < 0) hue += 0.5;
  hue = (hue - Math.floor(hue)) * 6;
  let r = clamp(Math.abs(hue - 3) - 1, 0, 1);
  let g = clamp(2 - Math.abs(hue - 2), 0, 1);
  let b = clamp(2 - Math.abs(hue - 4), 0, 1);
  const currY = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  r *= luma / currY;
  g *= luma / currY;
  b *= luma / currY;
  const dist = Math.abs(r - luma) + Math.abs(g - luma) + Math.abs(b - luma);
  let gainS;
  if (style === 'linear') {
    const sum = r + g + b;
    const k = 0.15;
    const loGain = 5;
    sat /= 1.4;
    // Kept positive so that the gain is.
    const tmp = Math.max(1e-6, -sat * sum + sat * 3 * luma + dist);
    const s1 = Math.min((sat * (k + 3 * luma)) / tmp, 50);
    const s0 = sat / Math.max(1e-10, dist * loGain);
    const alpha = clamp((luma - 0.001) / (0.01 - 0.001), 0, 1);
    if (alpha === 1) gainS = s1;
    else if (alpha === 0) gainS = s0;
    else {
      const a = dist * loGain * (1 - alpha) * (sum - 3 * luma);
      const bb = dist * loGain * (1 - alpha) * (k + 3 * luma) + dist * alpha - sat * (sum - 3 * luma);
      const c = -sat * (k + 3 * luma);
      const discrim = Math.sqrt(bb * bb - 4 * a * c);
      const denom = -discrim - bb;
      gainS = (2 * c) / denom;
      if (!(gainS >= 0)) gainS = (2 * c) / (denom + discrim * 2);
    }
  } else {
    gainS = sat / Math.max(1e-10, dist * (style === 'log' ? 4 : 1.25));
  }
  v[0] = luma + gainS * (r - luma);
  v[1] = luma + gainS * (g - luma);
  v[2] = luma + gainS * (b - luma);
}

/** @type {Step} */
function xyzToXyY(v) {
  const [X, Y, Z] = v;
  const s = X + Y + Z;
  const d = s === 0 ? 0 : 1 / s;
  v[0] = X * d;
  v[1] = Y * d;
  v[2] = Y;
}

/** @type {Step} */
function xyYToXyz(v) {
  const [x, y, Y] = v;
  const d = y === 0 ? 0 : 1 / y;
  v[0] = Y * x * d;
  v[1] = Y;
  v[2] = Y * (1 - x - y) * d;
}

/** @type {Step} */
function xyzToUvY(v) {
  const [X, Y, Z] = v;
  const s = X + 15 * Y + 3 * Z;
  const d = s === 0 ? 0 : 1 / s;
  v[0] = 4 * X * d;
  v[1] = 9 * Y * d;
  v[2] = Y;
}

/** @type {Step} */
function uvYToXyz(v) {
  const [u, vv, Y] = v;
  const d = vv === 0 ? 0 : 1 / vv;
  v[0] = (9 / 4) * Y * u * d;
  v[1] = Y;
  v[2] = (3 / 4) * Y * (4 - u - 6.666666666666667 * vv) * d;
}

/* The D65 white's u' v' as OCIO writes them (single precision). */
const WHITE_U = Math.fround(0.19783001);
const WHITE_V = Math.fround(0.46831999);

/** CIE L*u*v* with L* on [0, 1] for Y on [0, 1], D65 white (Renderer_XYZ_TO_LUV). @type {Step} */
function xyzToLuv(v) {
  const [X, Y, Z] = v;
  const s = X + 15 * Y + 3 * Z;
  const d = s === 0 ? 0 : 1 / s;
  const u = 4 * X * d;
  const vv = 9 * Y * d;
  const L = Y <= 0.008856451679 ? 9.0329629629629608 * Y : 1.16 * Math.fround(Y) ** Math.fround(0.333333333) - 0.16;
  v[0] = L;
  v[1] = 13 * L * (u - WHITE_U);
  v[2] = 13 * L * (vv - WHITE_V);
}

/** @type {Step} */
function luvToXyz(v) {
  const [L, us, vs] = v;
  const d = L === 0 ? 0 : 0.076923076923076927 / L;
  const u = us * d + WHITE_U;
  const vv = vs * d + WHITE_V;
  const tmp = (L + 0.16) * 0.86206896551724144;
  const Y = L <= 0.08 ? 0.11070564598794539 * L : tmp * tmp * tmp;
  const dd = vv === 0 ? 0 : 0.25 / vv;
  v[0] = 9 * Y * u * dd;
  v[1] = Y;
  v[2] = Y * (12 - 3 * u - 20 * vv) * dd;
}

/* SMPTE ST 2084 (PQ), in single precision as OCIO's renderers compute it (Renderer_LIN_TO_PQ<float>,
   Renderer_PQ_TO_LIN<float>), multiply-adds fused as arm64 and recent x86 builds do. Decoding subtracts two close numbers
   (c2 - c3 x), so single precision is off the exact curve by up to 1.5e-5 relative near peak white; rounding where OCIO
   rounds gives OCIO's numbers. */
const PQ_M1 = f((0.25 * 2610) / 4096);
const PQ_M2 = f((128 * 2523) / 4096);
const PQ_C2 = f((32 * 2413) / 4096);
const PQ_C3 = f((32 * 2392) / 4096);
const PQ_C1 = f((32 * 2392) / 4096 - (32 * 2413) / 4096 + 1);
const PQ_M1_INV = f(1 / PQ_M1);
const PQ_M2_INV = f(1 / PQ_M2);

/** Linear (1.0 = 100 nits) to PQ, mirrored for negative values (Renderer_LIN_TO_PQ). @type {Step} */
function linToPq(v) {
  for (let c = 0; c < 3; c++) {
    const y = f(f(Math.abs(f(v[c]) * f(0.01))) ** PQ_M1);
    const n = f(f(f(PQ_C1 + PQ_C2 * y) / f(1 + PQ_C3 * y)) ** PQ_M2);
    v[c] = v[c] < 0 || Object.is(v[c], -0) ? -n : n;
  }
}

/** PQ to linear (1.0 = 100 nits), mirrored for negative values (Renderer_PQ_TO_LIN). @type {Step} */
function pqToLin(v) {
  for (let c = 0; c < 3; c++) {
    const x = f(Math.abs(f(v[c])) ** PQ_M2_INV);
    const nits = f(f(Math.max(0, f(x - PQ_C1)) / f(PQ_C2 - PQ_C3 * x)) ** PQ_M1_INV);
    v[c] = v[c] < 0 || Object.is(v[c], -0) ? -100 * nits : 100 * nits;
  }
}
