// @ts-check
/**
 * OpenColorIO's grading ops, compiled into steps that change an RGB triple in place (see ops.mjs): GradingPrimary
 * (forward and inverse), GradingTone (forward), GradingRGBCurve (forward and inverse) and GradingHueCurve (forward).
 * Everything that depends only on the op's values is computed once here, as OCIO's pre-render classes do.
 *
 * The reference is OpenColorIO 2.6, src/OpenColorIO/ops/:
 *   gradingprimary/GradingPrimary.cpp (GradingPrimaryPreRender::update) and GradingPrimaryOpCPU.cpp
 *   gradingtone/GradingTone.cpp (GradingTonePreRender) and GradingToneOpCPU.cpp
 *   gradingrgbcurve/GradingRGBCurveOpCPU.cpp (and GradingBSplineCurve.cpp, ported in bspline.mjs)
 *   gradinghuecurve/GradingHueCurveOpCPU.cpp (and FixedFunctionOpCPU.cpp's HSY conversions, in fixed-function.mjs)
 * OCIO's own CPU path uses fast approximations of pow, log2 and exp2 (SSE.h, about 15 bits) for the primary's gamma
 * and linear contrast and for the linear styles' lin/log conversions of GradingTone and GradingRGBCurve; this uses the
 * exact functions, so those differ from OCIO's output by about 3e-5 relative (ctf.test.mjs states the tolerance).
 * GradingTone's set-up rounds to single precision as OCIO's does: its curves' far ends depend on it.
 */

import { evalCurve, evalCurveRev, fitCurve, HUE_CURVE_SPLINE, MAX_COEFS, MAX_KNOTS } from './bspline.mjs';
import { hsyToRgb, rgbToHsy } from './fixed-function.mjs';

/** @typedef {(v: Float64Array) => void} Step */
/** @typedef {import('./ctf.mjs').ColorOp} ColorOp */
/** @typedef {{ r: number, g: number, b: number, m: number }} RGBM */

const f = Math.fround;
/** Rec.709 luma weights, as OCIO's saturation uses them. */
const LUMA = [0.2126, 0.7152, 0.0722];

/** @param {Float64Array} v @param {number} sat */
function saturate(v, sat) {
  if (sat === 1) return;
  const luma = LUMA[0] * v[0] + LUMA[1] * v[1] + LUMA[2] * v[2];
  for (let c = 0; c < 3; c++) v[c] = luma + sat * (v[c] - luma);
}

// ---------------------------------------------------------------------------------------------------------------
// GradingPrimary

/**
 * @param {ColorOp} op ctf.mjs's gradingPrimary
 * @returns {Step | null} null when it changes nothing
 */
export function gradingPrimary(op) {
  const { style, inverse } = op;
  /** @param {RGBM} x @param {'r' | 'g' | 'b'} c */
  const sum = (x, c) => x.m + x[c];
  /** @param {RGBM} x @param {'r' | 'g' | 'b'} c */
  const prod = (x, c) => x.m * x[c];
  /** @type {('r' | 'g' | 'b')[]} */
  const RGB = ['r', 'g', 'b'];
  const clampBlack = op.clampBlack;
  const clampWhite = op.clampWhite;
  const sat = op.saturation;
  const satInv = 1 / (sat !== 0 ? sat : 1);
  const clampsNothing = clampBlack === -Number.MAX_VALUE && clampWhite === Number.MAX_VALUE;
  /** @param {Float64Array} v */
  const clampAll = (v) => {
    for (let c = 0; c < 3; c++) v[c] = Math.min(Math.max(v[c], clampBlack), clampWhite);
  };
  const pivotBlack = op.pivotBlack;
  const range = op.pivotWhite - op.pivotBlack;
  /** Gamma around the black and white pivots, mirrored below black. @param {Float64Array} v @param {number[]} g */
  const gamma = (v, g) => {
    for (let c = 0; c < 3; c++) {
      const d = v[c] - pivotBlack;
      v[c] = (Math.abs(d) / range) ** g[c] * (d < 0 || Object.is(d, -0) ? -range : range) + pivotBlack;
    }
  };
  /** @param {Float64Array} v @param {number[]} k @param {number} pivot */
  const contrast = (v, k, pivot) => {
    for (let c = 0; c < 3; c++) v[c] = (v[c] - pivot) * k[c] + pivot;
  };

  if (style === 'log') {
    const brightness = RGB.map((c) => (sum(op.brightness, c) * 6.25) / 1023);
    const k = RGB.map((c) => prod(op.contrast, c));
    const g = RGB.map((c) => prod(op.gamma, c));
    const pivot = 0.5 + op.pivot * 0.5;
    const kInv = k.map((x) => 1 / (x === 0 ? 1 : x));
    const gFwd = g.map((x) => 1 / x);
    // OCIO decides on the single-precision values of the direction's own parameters.
    const gammaIdentity = (inverse ? g : gFwd).every((x) => f(x) === 1);
    const contrastIdentity = (inverse ? kInv : k).every((x) => f(x) === 1);
    if (sat === 1 && clampsNothing && gammaIdentity && contrastIdentity && brightness.every((x) => x === 0)) return null;
    if (!inverse) {
      return (v) => {
        for (let c = 0; c < 3; c++) v[c] += brightness[c];
        contrast(v, k, pivot);
        if (!gammaIdentity) gamma(v, gFwd);
        saturate(v, sat);
        clampAll(v);
      };
    }
    return (v) => {
      clampAll(v);
      saturate(v, satInv);
      if (!gammaIdentity) gamma(v, g);
      contrast(v, kInv, pivot);
      for (let c = 0; c < 3; c++) v[c] -= brightness[c];
    };
  }

  if (style === 'linear') {
    const offset = RGB.map((c) => sum(op.offset, c));
    const exposure = RGB.map((c) => 2 ** sum(op.exposure, c));
    const k = RGB.map((c) => prod(op.contrast, c));
    const pivot = 0.18 * 2 ** op.pivot;
    const kInv = k.map((x) => 1 / x);
    const contrastIdentity = (inverse ? kInv : k).every((x) => f(x) === 1);
    if (sat === 1 && clampsNothing && contrastIdentity && exposure.every((x) => x === 1) && offset.every((x) => x === 0)) return null;
    /** Contrast as a power around the pivot, mirrored for negative values. @param {Float64Array} v @param {number[]} p */
    const linContrast = (v, p) => {
      for (let c = 0; c < 3; c++) {
        const x = v[c];
        v[c] = Math.abs(x / pivot) ** p[c] * (x < 0 || Object.is(x, -0) ? -pivot : pivot);
      }
    };
    if (!inverse) {
      return (v) => {
        for (let c = 0; c < 3; c++) v[c] = (v[c] + offset[c]) * exposure[c];
        if (!contrastIdentity) linContrast(v, k);
        saturate(v, sat);
        clampAll(v);
      };
    }
    return (v) => {
      clampAll(v);
      saturate(v, satInv);
      if (!contrastIdentity) linContrast(v, kInv);
      for (let c = 0; c < 3; c++) v[c] = v[c] / exposure[c] - offset[c];
    };
  }

  // video
  const offset = RGB.map((c) => sum(op.offset, c) + sum(op.lift, c));
  const gain = RGB.map((c) => prod(op.gain, c) || 1);
  const lift = RGB.map((c) => sum(op.lift, c));
  const g = RGB.map((c) => prod(op.gamma, c));
  const gFwd = g.map((x) => 1 / x);
  const slopeFwd = RGB.map((_, i) => {
    const den = op.pivotWhite / gain[i] + lift[i] - op.pivotBlack;
    return range / (den === 0 ? 1 : den);
  });
  const slopeInv = RGB.map((_, i) => (op.pivotWhite / gain[i] + (lift[i] - op.pivotBlack)) / range);
  const slope = inverse ? slopeInv : slopeFwd;
  const gammaIdentity = (inverse ? g : gFwd).every((x) => f(x) === 1);
  if (sat === 1 && clampsNothing && gammaIdentity && slope.every((x) => f(x) === 1) && offset.every((x) => x === 0)) return null;
  if (!inverse) {
    return (v) => {
      for (let c = 0; c < 3; c++) v[c] += offset[c];
      contrast(v, slopeFwd, pivotBlack);
      if (!gammaIdentity) gamma(v, gFwd);
      saturate(v, sat);
      clampAll(v);
    };
  }
  return (v) => {
    clampAll(v);
    saturate(v, satInv);
    if (!gammaIdentity) gamma(v, g);
    contrast(v, slopeInv, pivotBlack);
    for (let c = 0; c < 3; c++) v[c] -= offset[c];
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Lin/log conversion of the linear grading styles (GradingToneOpCPU.cpp and GradingRGBCurveOpCPU.cpp, LogLinConstants):
// a log2 curve around 0.18 with a linear toe below -5.5 (about 0.004).

const LL_XBRK = f(0.0041318374739483946);
const LL_SHIFT = f(-0.000157849851665374);
const LL_M = f(1 / f(0.18 + LL_SHIFT));
const LL_GAIN = f(363.034608563);
const LL_OFFS = -7;
const LL_YBRK = -5.5;
const LL_SHIFT018 = f(0.18 + LL_SHIFT);

/** @param {number} x */
export const linToLog = (x) => (x < LL_XBRK ? x * LL_GAIN + LL_OFFS : Math.log2((x + LL_SHIFT) * LL_M));
/** @param {number} y */
export const logToLin = (y) => (y < LL_YBRK ? (y - LL_OFFS) / LL_GAIN : 2 ** y * LL_SHIFT018 - LL_SHIFT);

// ---------------------------------------------------------------------------------------------------------------
// GradingTone (forward)

/** The zones' value of a channel; m is the master. @param {RGBM} x @param {number} ch 0-2 r g b, 3 master */
const channelValue = (x, ch) => (ch === 0 ? x.r : ch === 1 ? x.g : ch === 2 ? x.b : x.m);

/** FauxCubicFwdEval. @param {number} t @param {number} x0 @param {number} x2 @param {number} y0 @param {number} y2 @param {number} m0 @param {number} m2 @param {number} x1 */
function fauxCubicFwd(t, x0, x2, y0, y2, m0, m2, x1) {
  const y1 = (0.5 / (x2 - x1 + (x1 - x0))) * ((2 * y0 + m0 * (x1 - x0)) * (x2 - x1) + (2 * y2 - m2 * (x2 - x1)) * (x1 - x0));
  const tL = (t - x0) / (x1 - x0);
  const tR = (t - x1) / (x2 - x1);
  const fL = y0 * (1 - tL * tL) + y1 * tL * tL + m0 * (1 - tL) * tL * (x1 - x0);
  const fR = y1 * (1 - tR) * (1 - tR) + y2 * (2 - tR) * tR + m2 * (tR - 1) * tR * (x2 - x1);
  let res = t < x1 ? fL : fR;
  if (t < x0) res = y0 + (t - x0) * m0;
  if (t > x2) res = y2 + (t - x2) * m2;
  return res;
}

/** FauxCubicRevEval. @param {number} t @param {number} x0 @param {number} x2 @param {number} y0 @param {number} y2 @param {number} m0 @param {number} m2 @param {number} x1 */
function fauxCubicRev(t, x0, x2, y0, y2, m0, m2, x1) {
  const y1 = (0.5 / (x2 - x1 + (x1 - x0))) * ((2 * y0 + m0 * (x1 - x0)) * (x2 - x1) + (2 * y2 - m2 * (x2 - x1)) * (x1 - x0));
  const cL = y0 - t;
  const bL = m0 * (x1 - x0);
  const aL = y1 - y0 - m0 * (x1 - x0);
  const outL = ((2 * cL) / (-Math.sqrt(bL * bL - 4 * aL * cL) - bL)) * (x1 - x0) + x0;
  const cR = y1 - t;
  const bR = 2 * y2 - 2 * y1 - m2 * (x2 - x1);
  const aR = y1 - y2 + m2 * (x2 - x1);
  const outR = ((2 * cR) / (-Math.sqrt(bR * bR - 4 * aR * cR) - bR)) * (x2 - x1) + x1;
  let res = t < y1 ? outL : outR;
  if (t < y0) res = x0 + (t - y0) / m0;
  if (t > y2) res = x2 + (t - y2) / m2;
  return res;
}

/** HighlightFwdEval. @param {number} t @param {number} start @param {number} pivot @param {number} val */
function highlightFwdEval(t, start, pivot, val) {
  const x1 = start + (pivot - start) * 0.5;
  val = 2 - val;
  if (val <= 1) return fauxCubicFwd(t, start, pivot, start, pivot, 1, val < 0.01 ? 0.01 : val, x1);
  return fauxCubicRev(t, start, pivot, start, pivot, 1, 2 - val < 0.01 ? 0.01 : 2 - val, x1);
}

/** ShadowFwdEval. @param {number} t @param {number} start @param {number} pivot @param {number} val */
function shadowFwdEval(t, start, pivot, val) {
  const x1 = start + (pivot - start) * 0.5;
  if (val <= 1) return fauxCubicFwd(t, start, pivot, start, pivot, val < 0.01 ? 0.01 : val, 1, x1);
  return fauxCubicRev(t, start, pivot, start, pivot, 2 - val < 0.01 ? 0.01 : 2 - val, 1, x1);
}

/** @param {number} x @param {number} lo @param {number} hi */
const clamp = (x, lo, hi) => (x > lo ? (x < hi ? x : hi) : lo);

/**
 * The curve of one zone for one channel: (t) => t', or null when the zone changes nothing on it.
 * @typedef {((t: number) => number) | null} ZoneCurve
 */

/**
 * The midtones curve of a channel (mids_precompute and GradingToneFwdOpCPU::mids): six knots of a piecewise
 * quadratic whose area under the slope stays balanced around the center.
 * @param {ColorOp} op @param {number} ch @param {number} top @param {number} bottom
 * @returns {ZoneCurve}
 */
function midsCurve(op, ch, top, bottom) {
  let adj = clamp(f(channelValue(op.midtones, ch)), f(0.01), f(1.99));
  if (adj === 1) return null;
  const halo = f(0.4);
  const x0 = bottom;
  const x5 = top;
  const width = clamp(f(op.midtones.width), f(0.01), f(f(x5 - x0) * f(0.95)));
  const center = clamp(f(op.midtones.start), f(x0 + f(width * f(0.51))), f(x5 - f(width * f(0.51))));
  const x1 = f(center - f(width * 0.5));
  const x4 = f(x1 + width);
  const x2 = f(x1 + f(f(x4 - x1) * 0.25));
  const x3 = f(x1 + f(f(x4 - x1) * 0.75));
  const y0 = x0;
  const m0 = 1;
  const m5 = 1;
  adj = f(f(adj - 1) * f(1 - f(0.1)));
  const m2 = f(1 + adj);
  const m3 = f(1 - adj);
  let m1 = f(1 + f(adj * halo));
  let m4 = f(1 - f(adj * halo));
  if (center <= f(f(x5 + x0) * 0.5)) {
    const area = f((x1 - x0) * (m1 - m0) * 0.5 + (x2 - x1) * (m1 - m0 + (m2 - m1) * 0.5) + (center - x2) * (m2 - m0) * 0.5);
    m4 = f((-0.5 * (x5 - x4) * m5 + (x4 - x3) * (0.5 * m3 - m5) + (x3 - center) * (m3 - m5) * 0.5 + area) / (-0.5 * (x5 - x3)));
  } else {
    const area = f((x5 - x4) * (m4 - m5) * 0.5 + (x4 - x3) * (m4 - m5 + (m3 - m4) * 0.5) + (x3 - center) * (m3 - m5) * 0.5);
    m1 = f((-0.5 * (x1 - x0) * m0 + (x2 - x1) * (0.5 * m2 - m0) + (center - x2) * (m2 - m0) * 0.5 + area) / (-0.5 * (x2 - x0)));
  }
  const y1 = f(y0 + (m0 + m1) * (x1 - x0) * 0.5);
  const y2 = f(y1 + (m1 + m2) * (x2 - x1) * 0.5);
  const y3 = f(y2 + (m2 + m3) * (x3 - x2) * 0.5);
  const y4 = f(y3 + (m3 + m4) * (x4 - x3) * 0.5);
  const y5 = f(y4 + (m4 + m5) * (x5 - x4) * 0.5);
  /** One quadratic piece from (xa, ya) with slopes ma to mb over [xa, xb]. */
  const piece = (/** @type {number} */ t, /** @type {number} */ xa, /** @type {number} */ xb, /** @type {number} */ ya,
    /** @type {number} */ ma, /** @type {number} */ mb) => {
    const u = (t - xa) / (xb - xa);
    return u * (xb - xa) * (u * 0.5 * (mb - ma) + ma) + ya;
  };
  return (t) => {
    if (t < x0) return y0 + (t - x0) * m0;
    if (t > x5) return y5 + (t - x5) * m5;
    if (t > x4) return piece(t, x4, x5, y4, m4, m5);
    if (t > x3) return piece(t, x3, x4, y3, m3, m4);
    if (t > x2) return piece(t, x2, x3, y2, m2, m3);
    if (t < x1) return piece(t, x0, x1, y0, m0, m1);
    return piece(t, x1, x2, y1, m1, m2);
  };
}

/**
 * The highlights or shadows curve of a channel (highlightShadow_precompute, ComputeHSFwd / ComputeHSRev).
 * @param {ColorOp} op @param {number} ch @param {boolean} isShadow @param {number} start @param {number} pivot
 * @returns {ZoneCurve}
 */
function highlightShadowCurve(op, ch, isShadow, start, pivot) {
  let val = f(channelValue(isShadow ? op.shadows : op.highlights, ch));
  if (!isShadow) val = f(2 - val);
  if (val === 1) return null;
  const x0 = isShadow ? pivot : start;
  const x2 = isShadow ? start : pivot;
  const y0 = x0;
  const y2 = x2;
  const x1 = f(x0 + f(f(x2 - x0) * 0.5));
  const soft = val < 1 ? Math.max(f(0.01), val) : Math.max(f(0.01), f(2 - val));
  const m0 = isShadow ? soft : 1;
  const m2 = isShadow ? 1 : soft;
  const y1 = f((0.5 / (x2 - x0)) * ((2 * y0 + m0 * (x1 - x0)) * (x2 - x1) + (2 * y2 - m2 * (x2 - x1)) * (x1 - x0)));
  if (val < 1) {
    return (t) => {
      if (t < x0) return (t - x0) * m0 + y0;
      if (!(t < x2)) return (t - x2) * m2 + y2;
      if (t < x1) {
        const tL = (t - x0) / (x1 - x0);
        return y0 * (1 - tL * tL) + y1 * tL * tL + m0 * (1 - tL) * tL * (x1 - x0);
      }
      const tR = (t - x1) / (x2 - x1);
      return y1 * (1 - tR) * (1 - tR) + y2 * (2 - tR) * tR + m2 * (tR - 1) * tR * (x2 - x1);
    };
  }
  const bL = m0 * (x1 - x0);
  const aL = y1 - y0 - m0 * (x1 - x0);
  const bR = 2 * y2 - 2 * y1 - m2 * (x2 - x1);
  const aR = y1 - y2 + m2 * (x2 - x1);
  return (t) => {
    if (t < y0) return (t - y0) / m0 + x0;
    if (!(t < y2)) return (t - y2) / m2 + x2;
    if (t < y1) {
      const c = y0 - t;
      return ((-2 * c) / (Math.sqrt(bL * bL - 4 * aL * c) + bL)) * (x1 - x0) + x0;
    }
    const c = y1 - t;
    return ((-2 * c) / (Math.sqrt(bR * bR - 4 * aR * c) + bR)) * (x2 - x1) + x1;
  };
}

/**
 * The whites or blacks curve of a channel (whiteBlack_precompute and ComputeWBFwd).
 * @param {ColorOp} op @param {number} ch @param {boolean} isBlack @param {number} start @param {number} width
 * @returns {ZoneCurve}
 */
function whiteBlackCurve(op, ch, isBlack, start, width) {
  const val = f(channelValue(isBlack ? op.blacks : op.whites, ch));
  const x0 = isBlack ? f(start - width) : start;
  const x1 = isBlack ? start : f(x0 + width);
  const mtest = isBlack ? f(2 - val) : val;
  if (mtest < 1) {
    let m0, m1, y0, y1;
    if (!isBlack) {
      m0 = 1;
      m1 = Math.max(f(0.01), val);
      y0 = x0;
      y1 = f(y0 + (m0 + m1) * (x1 - x0) * 0.5);
    } else {
      m0 = Math.max(f(0.01), f(2 - val));
      m1 = 1;
      y1 = x1;
      y0 = f(y1 - (m0 + m1) * (x1 - x0) * 0.5);
    }
    return (t) => {
      if (t < x0) return y0 + (t - x0) * m0;
      if (!(t < x1)) return y1 + (t - x1) * m1;
      const u = (t - x0) / (x1 - x0);
      return u * (x1 - x0) * (u * 0.5 * (m1 - m0) + m0) + y0;
    };
  }
  if (!(mtest > 1)) return null;
  const m0 = isBlack ? Math.max(f(0.01), val) : 1;
  const m1 = isBlack ? 1 : Math.max(f(0.01), f(2 - val));
  const y1 = x1;
  const y0 = isBlack ? f(y1 - (m0 + m1) * (x1 - x0) * 0.5) : x0;
  const gain = f((m0 + m1) * 0.5);
  const a = f(0.5 * (m1 - m0) * (x1 - x0));
  const b = f(m0 * (x1 - x0));
  // Whites: past x1 a quadratic that meets the line of slope 1/m1 smoothly.
  const newY1 = f((x1 - x0) / gain + x0);
  const xd = f(x0 + (x1 - x0) * f(0.99));
  const md = f(1 / f(m0 + ((xd - x0) * (m1 - m0)) / (x1 - x0)));
  const aa = f((0.5 * (1 / m1 - md)) / (x1 - xd));
  const bb = f(1 / m1 - 2 * aa * x1);
  const cc = f(newY1 - bb * x1 - aa * x1 * x1);
  return (t) => {
    t = isBlack ? (t - x1) * gain + x1 : (t - x0) * gain + x0;
    const c = y0 - t;
    let res = t < y0 ? x0 + (t - y0) / m0 : ((-2 * c) / (Math.sqrt(b * b - 4 * a * c) + b)) * (x1 - x0) + x0;
    if (!isBlack) {
      res = (res - x0) / gain + x0;
      const u = (t - x0) / gain + x0;
      if (!(u < x1)) res = (aa * u + bb) * u + cc;
      return res;
    }
    if (!(t < y1)) res = x1 + (t - y1) / m1;
    return (res - x1) / gain + x1;
  };
}

/**
 * The s-contrast curve (scontrast_precompute and GradingToneFwdOpCPU::scontrast): contrast around the pivot that
 * rolls back to a slope of 1 at the top and the bottom.
 * @param {number} scontrast @param {number} topSC @param {number} bottom @param {number} pivot
 * @returns {ZoneCurve}
 */
function sContrastCurve(scontrast, topSC, bottom, pivot) {
  const sc = f(scontrast);
  if (sc === 1) return null;
  const k = sc > 1 ? f(1 / f(1.8125 - 0.8125 * Math.min(sc, f(1.99)))) : f(0.28125 + 0.71875 * Math.max(sc, f(0.01)));
  // Top: from the contrast line back to slope 1/k, ending at (topSC, topSC).
  let tx1, tx2, ty1, ty2, tm3;
  {
    const x3 = topSC;
    const y3 = topSC;
    const y0 = f(pivot + (y3 - pivot) * 0.25);
    const m0 = k;
    const x0 = f(pivot + (y0 - pivot) / m0);
    const minWidth = f((x3 - x0) * f(0.3));
    let m3 = f(1 / m0);
    const center = f((y3 - y0 - m3 * x3 + m0 * x0) / (m0 - m3));
    let x1 = x0;
    let x2 = f(2 * center - x1);
    if (x2 > x3) {
      x2 = x3;
      x1 = f(2 * center - x2);
    } else if (x2 - x1 < minWidth) {
      x2 = f(x1 + minWidth);
      const newCenter = f((x2 + x1) * 0.5);
      m3 = f((y3 - y0 + m0 * x0 - newCenter * m0) / (x3 - newCenter));
    }
    [tx1, tx2, ty1, tm3] = [x1, x2, y0, m3];
    ty2 = f(ty1 + (m0 + m3) * (x2 - x1) * 0.5);
  }
  // Bottom: from (bottom, bottom) at slope 1/k up to the contrast line.
  let bx1, bx2, by1, bm0;
  {
    const x0 = bottom;
    const y0 = bottom;
    const y3 = f(pivot - (pivot - y0) * 0.25);
    const m3 = k;
    const x3 = f(pivot - (pivot - y3) / m3);
    const minWidth = f((x3 - x0) * f(0.3));
    let m0 = f(1 / m3);
    const center = f((y3 - y0 - m3 * x3 + m0 * x0) / (m0 - m3));
    let x2 = x3;
    let x1 = f(2 * center - x2);
    if (x1 < x0) {
      x1 = x0;
      x2 = f(2 * center - x1);
    } else if (x2 - x1 < minWidth) {
      x1 = f(x2 - minWidth);
      const newCenter = f((x2 + x1) * 0.5);
      m0 = f((y3 - y0 - m3 * x3 + newCenter * m3) / (newCenter - x0));
    }
    [bx1, bx2, bm0] = [x1, x2, m0];
    by1 = f(y3 - (m0 + m3) * (x2 - x1) * 0.5);
  }
  return (t) => {
    let out = (t - pivot) * k + pivot;
    if (!(t < tx1)) {
      const u = (t - tx1) / (tx2 - tx1);
      out = u * (tx2 - tx1) * (u * 0.5 * (tm3 - k) + k) + ty1;
    }
    if (!(t < tx2)) out = ty2 + (t - tx2) * tm3;
    if (t < bx2) {
      const u = (t - bx1) / (bx2 - bx1);
      out = u * (bx2 - bx1) * (u * 0.5 * (k - bm0) + bm0) + by1;
    }
    if (t < bx1) out = by1 + (t - bx1) * bm0;
    return out;
  };
}

/** Each style's range: top, top of the s-contrast, bottom, pivot (GradingTonePreRender::FromStyle). */
const TONE_RANGE = /** @type {Record<string, number[]>} */ ({ log: [1, 1, 0, f(0.4)], linear: [7.5, 6.5, -5.5, 0], video: [1, 1, 0, f(0.4)] });

/**
 * @param {ColorOp} op ctf.mjs's gradingTone
 * @returns {Step | null} null when it changes nothing
 */
export function gradingTone(op) {
  if (op.inverse) throw new Error(`GradingTone: the inverse style '${op.style}Rev' is not supported`);
  const zones = ['blacks', 'shadows', 'midtones', 'highlights', 'whites'];
  const identity = zones.every((z) => ['r', 'g', 'b', 'm'].every((k) => op[z][k] === 1)) && op.scontrast === 1;
  if (identity) return null;
  const [top, topSC, bottom, pivot] = TONE_RANGE[op.style];

  // Where the whites and blacks sit once the highlights and shadows have moved them (GradingTonePreRender::update).
  const hiPivot = op.highlights.width;
  const hiStart = op.highlights.start > hiPivot - 0.01 ? hiPivot - 0.01 : op.highlights.start;
  const whitesStart = highlightFwdEval(op.whites.start, hiStart, hiPivot, op.highlights.m);
  const whitesWidth = highlightFwdEval(op.whites.start + op.whites.width, hiStart, hiPivot, op.highlights.m) - whitesStart;
  const shPivot = op.shadows.width;
  const shStart = op.shadows.start < shPivot + 0.01 ? shPivot + 0.01 : op.shadows.start;
  const blacksStart = shadowFwdEval(op.blacks.start, shPivot, shStart, op.shadows.m);
  const blacksWidth = blacksStart - shadowFwdEval(op.blacks.start - op.blacks.width, shPivot, shStart, op.shadows.m);

  // Per zone: the curves for R, G, B and the master (applied to all three), in OCIO's order.
  /** @type {ZoneCurve[][]} */
  const stages = [
    [0, 1, 2, 3].map((ch) => midsCurve(op, ch, top, bottom)),
    [0, 1, 2, 3].map((ch) => highlightShadowCurve(op, ch, false, f(hiStart), f(hiPivot))),
    [0, 1, 2, 3].map((ch) => whiteBlackCurve(op, ch, false, f(whitesStart), f(whitesWidth))),
    [0, 1, 2, 3].map((ch) => highlightShadowCurve(op, ch, true, f(shStart), f(shPivot))),
    [0, 1, 2, 3].map((ch) => whiteBlackCurve(op, ch, true, f(blacksStart), f(blacksWidth))),
  ];
  const sc = sContrastCurve(op.scontrast, topSC, bottom, pivot);
  const linear = op.style === 'linear';
  return (v) => {
    if (linear) for (let c = 0; c < 3; c++) v[c] = linToLog(v[c]);
    for (const curves of stages) {
      for (let c = 0; c < 3; c++) {
        const own = curves[c];
        if (own) v[c] = own(v[c]);
      }
      const master = curves[3];
      if (master) for (let c = 0; c < 3; c++) v[c] = master(v[c]);
    }
    if (sc) for (let c = 0; c < 3; c++) v[c] = sc(v[c]);
    // Keep values within half float (ClampMaxRGB).
    for (let c = 0; c < 3; c++) v[c] = Math.min(linear ? logToLin(v[c]) : v[c], 65504);
  };
}

// ---------------------------------------------------------------------------------------------------------------
// GradingRGBCurve

/** @param {(import('./bspline.mjs').Fit | null)[]} fits @param {string} what */
function checkSize(fits, what) {
  let knots = 0;
  let coefs = 0;
  for (const fit of fits) {
    if (!fit) continue;
    knots += fit.knots.length;
    coefs += fit.A.length * 3;
  }
  if (knots > MAX_KNOTS || coefs > MAX_COEFS) throw new Error(`${what}: maximum number of control points reached`);
}

/**
 * @param {ColorOp} op ctf.mjs's gradingRGBCurve
 * @returns {Step | null} null when it changes nothing
 */
export function gradingRGBCurve(op) {
  const [r, g, b, m] = ['red', 'green', 'blue', 'master'].map((name) => fitCurve(op[name], 'rgb'));
  checkSize([r, g, b, m], 'RGB curve');
  if (!r && !g && !b && !m) return null;
  const linear = op.style === 'linear' && !op.bypassLinToLog;
  const own = [r, g, b];
  if (!op.inverse) {
    return (v) => {
      for (let c = 0; c < 3; c++) {
        const x = linear ? linToLog(v[c]) : v[c];
        const y0 = evalCurve(own[c], x, x);
        const y = evalCurve(m, y0, y0);
        v[c] = linear ? logToLin(y) : y;
      }
    };
  }
  return (v) => {
    for (let c = 0; c < 3; c++) {
      const y = linear ? linToLog(v[c]) : v[c];
      const x = evalCurveRev(own[c], evalCurveRev(m, y));
      v[c] = linear ? logToLin(x) : x;
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------
// GradingHueCurve (forward)

/**
 * @param {ColorOp} op ctf.mjs's gradingHueCurve
 * @returns {Step | null} null when it changes nothing
 */
export function gradingHueCurve(op) {
  if (op.inverse) throw new Error(`GradingHueCurve: the inverse style '${op.style}Rev' is not supported`);
  const fit = Object.fromEntries(Object.entries(HUE_CURVE_SPLINE).map(([name, type]) => [name, fitCurve(op[name], type)]));
  checkSize(Object.values(fit), 'Hue curve');
  if (Object.values(fit).every((x) => !x)) return null;
  const style = /** @type {'linear' | 'log' | 'video'} */ (op.style);
  const isLog = style === 'log';
  const linear = style === 'linear';
  return (v) => {
    if (op.hsy) rgbToHsy(v, style);
    if (linear) v[2] = linToLog(v[2]);
    const hueSatGain = Math.max(0, evalCurve(fit.hueSat, v[0], 1));
    let hueLumGain = Math.max(0, evalCurve(fit.hueLum, v[0], 1));
    v[0] = evalCurve(fit.hueHue, v[0], v[0]);
    v[1] = Math.max(0, evalCurve(fit.satSat, v[1], v[1]));
    const lumSatGain = Math.max(0, evalCurve(fit.lumSat, v[2], 1));
    v[1] *= lumSatGain * hueSatGain;
    const satLumGain = Math.max(0, evalCurve(fit.satLum, v[1], 1));
    v[2] = evalCurve(fit.lumLum, v[2], v[2]);
    if (linear) v[2] = logToLin(v[2]);
    hueLumGain = 1 - (1 - hueLumGain) * Math.min(v[1], 1);
    v[2] = isLog ? v[2] + (hueLumGain + satLumGain - 2) * 0.1 : v[2] * hueLumGain * satLumGain;
    v[0] -= Math.floor(v[0]); // wrap to [0, 1)
    v[0] += evalCurve(fit.hueFx, v[0], 0);
    if (op.hsy) hsyToRgb(v, style);
  };
}
