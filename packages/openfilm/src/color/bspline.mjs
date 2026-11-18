// @ts-check
/**
 * The curves of GradingRGBCurve and GradingHueCurve: monotone quadratic B-splines through control points, with
 * slopes given or estimated. A curve is fitted once (fitCurve) into knots and per-segment coefficients, then evaluated
 * per pixel (evalCurve, evalCurveRev).
 *
 * The reference is OpenColorIO 2.6, src/OpenColorIO/ops/gradingrgbcurve/GradingBSplineCurve.cpp: validate(),
 * isIdentity(), PrepHueCurveData, CalcKsi, FitHueSpline, EstimateHueSlopes, EstimateRGBSlopes, FitRGBSpline,
 * AdjustRGBSlopes, computeKnotsAndCoefsFor{RGB,Hue}Curve and KnotsCoefs::evalCurve / evalCurveRev. OCIO fits in
 * single precision; the fit here rounds each stored value to single precision (Math.fround) so that its thresholds
 * (e.g. "is this segment already a parabola") decide as OCIO's do. Evaluation runs in double precision.
 */

const f = Math.fround;

/**
 * The kinds of spline (BSplineType): 'rgb' (B_SPLINE), 'diagonal', 'hueHue', 'periodic1', 'periodic0' and
 * 'horizontal1'. Each hue curve has its own (GetBSplineTypeForHueCurveType).
 * @typedef {'rgb' | 'diagonal' | 'hueHue' | 'periodic1' | 'periodic0' | 'horizontal1'} SplineType
 */

/** @type {Record<string, SplineType>} */
export const HUE_CURVE_SPLINE = {
  hueHue: 'hueHue', hueSat: 'periodic1', hueLum: 'periodic1', lumSat: 'horizontal1',
  satSat: 'diagonal', lumLum: 'diagonal', satLum: 'horizontal1', hueFx: 'periodic0',
};

/** A curve as read from a file. @typedef {{ points: [number, number][], slopes: number[] }} Curve */
/** A fitted curve: knots and the coefficients A, B, C of each segment (y = (A t + B) t + C, t = x - knot). */
/** @typedef {{ knots: number[], A: number[], B: number[], C: number[] }} Fit */

/** The most knots and coefficients one op's curves may have together (KnotsCoefs::MAX_NUM_KNOTS / COEFS). */
export const MAX_KNOTS = 120;
export const MAX_COEFS = 360;

/**
 * Throws when a curve is not one OCIO accepts (GradingBSplineCurveImpl::validate).
 * @param {Curve} curve
 * @param {SplineType} type
 * @param {string} name for the error
 */
export function validateCurve(curve, type, name) {
  const pts = curve.points;
  const n = pts.length;
  const fail = (/** @type {string} */ m) => {
    throw new Error(`${name} curve: ${m}`);
  };
  if (n < 2) fail('There must be at least 2 control points.');
  if (curve.slopes.length !== n) fail('The slopes array must be the same length as the control points.');
  for (let i = 1; i < n; i++) if (pts[i][0] < pts[i - 1][0]) fail(`Control point at index ${i} has a x coordinate less than the previous one.`);
  if (type === 'hueHue') {
    if (pts[0][0] < 0) fail('The HUE-HUE spline may not have negative x coordinates.');
    if (pts[n - 1][0] > 1) fail('The HUE-HUE spline may not have x coordinates greater than one.');
  }
  if (type === 'rgb' || type === 'diagonal' || type === 'hueHue') {
    // Diagonal curves are non-decreasing; hue-hue wraps its last point around to check the first.
    let last = type === 'hueHue' ? f(pts[n - 1][1] - 1) : -Number.MAX_VALUE;
    for (let i = 0; i < n; i++) {
      if (pts[i][1] < last) fail(`Control point at index ${i} has a y coordinate less than the previous one.`);
      last = pts[i][1];
    }
  }
  if (n === 2 && (type === 'periodic1' || type === 'periodic0' || type === 'hueHue')) {
    if (Math.abs(1 - f(pts[1][0] - pts[0][0])) < 1e-3) fail('The periodic spline x coordinates may not wrap to the same value.');
  }
}

/**
 * Whether a curve changes nothing: its identity points and no slopes given (GradingBSplineCurveImpl::isIdentity).
 * @param {Curve} curve
 * @param {SplineType} type
 */
export function isIdentityCurve(curve, type) {
  if (curve.slopes.some((s) => s !== 0)) return false;
  if (type === 'rgb' || type === 'diagonal' || type === 'hueHue') return curve.points.every(([x, y]) => x === y);
  if (type === 'periodic0') return curve.points.every(([, y]) => y === 0);
  return curve.points.every(([, y]) => y === 1);
}

/**
 * A curve's knots and coefficients, or null when it is an identity (evaluate to the identity value).
 * @param {Curve} curve
 * @param {SplineType} type
 * @returns {Fit | null}
 */
export function fitCurve(curve, type) {
  if (curve.points.length < 2 || isIdentityCurve(curve, type)) return null;
  return type === 'rgb' ? fitRGBCurve(curve) : fitHueCurve(curve, type);
}

// ---------------------------------------------------------------------------------------------------------------
// RGB curves (B_SPLINE)

/** @param {Curve} curve @returns {Fit} */
function fitRGBCurve(curve) {
  const pts = curve.points;
  const slopes = curve.slopes.some((s) => s !== 0) ? curve.slopes.slice() : estimateRGBSlopes(pts);
  let fit = fitRGBSpline(pts, slopes);
  if (adjustRGBSlopes(pts, slopes, fit.knots)) fit = fitRGBSpline(pts, slopes);
  return fit;
}

/** EstimateRGBSlopes. @param {[number, number][]} pts */
function estimateRGBSlopes(pts) {
  const n = pts.length;
  const secantSlope = [];
  const secantLen = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = f(pts[i + 1][0] - pts[i][0]);
    const dy = f(pts[i + 1][1] - pts[i][1]);
    secantSlope.push(f(dy / dx));
    secantLen.push(f(Math.sqrt(f(dx * dx + dy * dy))));
  }
  if (n === 2) return [secantSlope[0], secantSlope[0]];
  // Runs of equal secant slopes share their total length.
  for (let i = 0; ;) {
    let j = i;
    /** @type {number} */
    let DL = secantLen[i];
    while (j < n - 2 && Math.abs(secantSlope[j + 1] - secantSlope[j]) < f(1e-6)) {
      DL = f(DL + secantLen[j + 1]);
      j++;
    }
    for (let k = i; k <= j; k++) secantLen[k] = DL;
    if (j >= n - 3) break;
    i = j + 1;
  }
  const slopes = [0];
  for (let k = 1; k < n - 1; k++) {
    slopes.push(f(f(secantLen[k] * secantSlope[k] + secantLen[k - 1] * secantSlope[k - 1]) / f(secantLen[k] + secantLen[k - 1])));
  }
  slopes.push(Math.max(f(0.01), f(0.5 * f(3 * secantSlope[n - 2] - slopes[n - 2]))));
  slopes[0] = Math.max(f(0.01), f(0.5 * f(3 * secantSlope[0] - slopes[1])));
  return slopes;
}

/** FitRGBSpline. @param {[number, number][]} pts @param {number[]} slopes @returns {Fit} */
function fitRGBSpline(pts, slopes) {
  /** @type {Fit} */
  const fit = { knots: [pts[0][0]], A: [], B: [], C: [] };
  for (let i = 0; i < pts.length - 1; i++) {
    const [xi, yi] = pts[i];
    const [xi1, yi1] = pts[i + 1];
    const dx = f(xi1 - xi);
    const secant = f(f(yi1 - yi) / dx);
    if (Math.abs(f(f(slopes[i] + slopes[i + 1]) - f(2 * secant))) < f(1e-6)) {
      fit.C.push(yi);
      fit.B.push(slopes[i]);
      fit.A.push(f(f(0.5 * f(slopes[i + 1] - slopes[i])) / dx));
    } else {
      const aa = f(slopes[i] - secant);
      const bb = f(slopes[i + 1] - secant);
      let ksi;
      if (f(aa * bb) >= 0) ksi = f(f(xi + xi1) * 0.5);
      else if (Math.abs(aa) > Math.abs(bb)) ksi = f(xi1 + f(f(aa * dx) / f(slopes[i + 1] - slopes[i])));
      else ksi = f(xi + f(f(bb * dx) / f(slopes[i + 1] - slopes[i])));
      const sBar = f(f(f(2 * secant) - slopes[i + 1]) + f(f(f(slopes[i + 1] - slopes[i]) * f(ksi - xi)) / dx));
      const eta = f(f(sBar - slopes[i]) / f(ksi - xi));
      fit.C.push(yi);
      fit.B.push(slopes[i]);
      fit.A.push(f(0.5 * eta));
      fit.C.push(f(yi + f(slopes[i] * f(ksi - xi)) + f(f(0.5 * eta) * f(f(ksi - xi) * f(ksi - xi)))));
      fit.B.push(sBar);
      fit.A.push(f(f(0.5 * f(slopes[i + 1] - sBar)) / f(xi1 - ksi)));
      fit.knots.push(ksi);
    }
    fit.knots.push(xi1);
  }
  return fit;
}

/**
 * AdjustRGBSlopes: where a segment's middle slope would go negative, scale its end slopes down. Changes `slopes`.
 * @param {[number, number][]} pts @param {number[]} slopes @param {number[]} knots
 */
function adjustRGBSlopes(pts, slopes, knots) {
  let adjusted = false;
  for (let i = 0, j = 0; j < knots.length; j++) {
    if (pts[i][0] === knots[j]) continue;
    const ksi = knots[j];
    const [xi, yi] = pts[i];
    const [xi1, yi1] = pts[i + 1];
    const sBar = f(f(f(f(2 * f(yi1 - yi)) - f(f(ksi - xi) * slopes[i])) - f(f(xi1 - ksi) * slopes[i + 1])) / f(xi1 - xi));
    if (sBar < 0) {
      adjusted = true;
      const secant = f(f(yi1 - yi) / f(xi1 - xi));
      const blend = f(f(f(f(ksi - xi) * slopes[i]) + f(f(xi1 - ksi) * slopes[i + 1])) / f(xi1 - xi));
      let aim = f(f(0.01 * 0.5) * f(slopes[i] + slopes[i + 1]));
      if (aim > secant) aim = secant;
      const adjust = f(f(f(2 * secant) - aim) / blend);
      slopes[i] = f(slopes[i] * adjust);
      slopes[i + 1] = f(slopes[i + 1] * adjust);
    }
    i++;
  }
  return adjusted;
}

// ---------------------------------------------------------------------------------------------------------------
// Hue curves (every other spline type)

/** @param {Curve} curve @param {SplineType} type @returns {Fit} */
function fitHueCurve(curve, type) {
  const periodic = type === 'periodic1' || type === 'periodic0' || type === 'hueHue';
  const horizontal = type !== 'diagonal' && type !== 'hueHue';
  const pts = prepHueCurveData(curve.points, periodic, horizontal);
  let slopes;
  if (curve.slopes.some((s) => s !== 0)) {
    slopes = curve.slopes.slice();
    if (periodic) {
      // As OCIO does: the last slope is copied to both ends (the second copy reads the first one just inserted).
      slopes.unshift(slopes[slopes.length - 1]);
      slopes.push(slopes[0]);
    }
  } else {
    // Slopes are estimated as for a horizontal curve for hue-hue too.
    slopes = estimateHueSlopes(pts, periodic, horizontal || type === 'hueHue');
  }
  return fitHueSpline(pts, slopes);
}

/**
 * PrepHueCurveData: wrap periodic x into [0, 1), sort by x, keep a minimum spacing, and copy a point from each end
 * around to the other for periodic curves.
 * @param {[number, number][]} points @param {boolean} periodic @param {boolean} horizontal
 */
function prepHueCurveData(points, periodic, horizontal) {
  const n = points.length;
  /** @type {[number, number][]} */
  const out = points.map(([x, y]) => {
    if (periodic && x < 0) return [f(x + 1), horizontal ? y : f(y + 1)];
    if (periodic && x >= 1) return [f(x - 1), horizontal ? y : f(y - 1)];
    return [x, y];
  });
  // Selection sort, as OCIO's (its order for equal x is kept).
  for (let i = 0; i < n; i++) {
    let min = i;
    for (let j = i + 1; j < n; j++) if (out[j][0] < out[min][0]) min = j;
    [out[i], out[min]] = [out[min], out[i]];
  }
  const tol = f(2e-3);
  const xSpan = f(out[n - 1][0] - out[0][0]);
  for (let i = 1; i < n; i++) {
    if (f(out[i][0] - out[i - 1][0]) < f(xSpan * tol)) out[i][0] = f(out[i - 1][0] + f(xSpan * tol));
  }
  if (!horizontal) {
    const ySpan = f(out[n - 1][1] - out[0][1]);
    for (let i = 1; i < n; i++) {
      if (f(out[i][1] - out[i - 1][1]) < f(ySpan * tol)) out[i][1] = f(out[i - 1][1] + f(ySpan * tol));
    }
  }
  if (periodic) {
    const last = out[n - 1];
    out.unshift([f(last[0] - 1), horizontal ? last[1] : f(last[1] - 1)]);
    const first = out[1];
    out.push([f(first[0] + 1), horizontal ? first[1] : f(first[1] + 1)]);
  }
  return out;
}

/** EstimateHueSlopes. @param {[number, number][]} pts @param {boolean} periodic @param {boolean} horizontal */
function estimateHueSlopes(pts, periodic, horizontal) {
  const n = pts.length;
  const secantSlope = [];
  const secantLen = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = f(pts[i + 1][0] - pts[i][0]);
    const dy = f(pts[i + 1][1] - pts[i][1]);
    secantSlope.push(f(dy / dx));
    secantLen.push(f(Math.sqrt(f(dx * dx + dy * dy))));
  }
  if (n === 2) return [secantSlope[0], secantSlope[0]];
  const slopes = [0];
  if (horizontal) {
    for (let i = 1; i < n - 1; i++) {
      const denom = f(secantSlope[i] + secantSlope[i - 1]);
      const d = Math.abs(denom) < f(1e-3) ? (denom < 0 ? f(-1e-3) : f(1e-3)) : denom;
      let s = f(f(f(2 * secantSlope[i]) * secantSlope[i - 1]) / d);
      // Flat at flat areas and extrema.
      if (f(secantSlope[i] * secantSlope[i - 1]) <= 0) s = 0;
      slopes.push(s);
    }
    slopes.push(f(0.5 * f(f(3 * secantSlope[n - 2]) - slopes[n - 2])));
    slopes[0] = f(0.5 * f(f(3 * secantSlope[0]) - slopes[1]));
  } else {
    for (let i = 0; ;) {
      let j = i;
      /** @type {number} */
    let DL = secantLen[i];
      while (j < n - 2 && Math.abs(f(secantSlope[j + 1] - secantSlope[j])) < f(1e-6)) {
        DL = f(DL + secantLen[j + 1]);
        j++;
      }
      for (let k = i; k <= j; k++) secantLen[k] = DL;
      if (j >= n - 3) break;
      i = j + 1;
    }
    for (let k = 1; k < n - 1; k++) {
      slopes.push(f(f(f(secantLen[k] * secantSlope[k]) + f(secantLen[k - 1] * secantSlope[k - 1])) / f(secantLen[k] + secantLen[k - 1])));
    }
    slopes.push(Math.max(f(0.01), f(0.5 * f(f(3 * secantSlope[n - 2]) - slopes[n - 2]))));
    slopes[0] = Math.max(f(0.01), f(0.5 * f(f(3 * secantSlope[0]) - slopes[1])));
  }
  // Scale down pairs of slopes that would not preserve the shape.
  for (let i = 0; i < n - 1; i++) {
    let k = f(0.2);
    if (Math.abs(slopes[i]) > Math.abs(slopes[i + 1])) k = f(1 - k);
    const mNearMin = f(slopes[i] + f(k * f(slopes[i + 1] - slopes[i])));
    let scale = 1;
    if (mNearMin !== 0) scale = f(f(f(0.75 * 2) * secantSlope[i]) / mNearMin);
    if (scale < 1) {
      slopes[i] = f(scale * slopes[i]);
      slopes[i + 1] = f(scale * slopes[i + 1]);
    }
  }
  if (periodic) {
    // Copy the end slopes from the opposite side.
    slopes[0] = slopes[n - 2];
    slopes[n - 1] = slopes[1];
  }
  return slopes;
}

/** CalcKsi: the middle knot of segment i. @param {number} i @param {[number, number][]} pts @param {number[]} slopes */
function calcKsi(i, pts, slopes) {
  const [x0, y0] = pts[i];
  const [x1, y1] = pts[i + 1];
  const k = f(0.2);
  const dx = f(x1 - x0);
  let secant = f(f(y1 - y0) / dx);
  let m0 = slopes[i];
  let m1 = slopes[i + 1];
  if (secant < 0) {
    m0 = -slopes[i];
    m1 = -slopes[i + 1];
    secant = -secant;
  }
  const xMid = f(x0 + f(0.5 * dx));
  const leftBnd = f(x0 + f(dx * k));
  const rightBnd = f(x1 - f(dx * k));
  let topBnd = leftBnd;
  let bottomBnd = rightBnd;
  let mMin = m0;
  let mMax = m1;
  if (m0 > m1) {
    mMax = m0;
    mMin = m1;
    topBnd = rightBnd;
    bottomBnd = leftBnd;
  }
  const dm = f(mMax - mMin);
  const b = f(1 - f(0.5 * k));
  const bHigh = f(mMin + f(b * dm));
  const bLow = f(mMin + f(f(1 - b) * dm));
  const bbb = f(mMax * 4);
  const bb = f(mMax * f(1.1));
  const mRelDiff = f(dm / Math.max(f(0.01), mMax));
  const alpha = Math.max(0, Math.min(f(f(mRelDiff - f(0.05)) / f(f(0.75) - f(0.05))), 1));
  topBnd = f(xMid + f(alpha * f(topBnd - xMid)));
  bottomBnd = f(xMid + f(alpha * f(bottomBnd - xMid)));
  if (secant >= bbb) return xMid;
  if (secant > bb) return f(topBnd + f(f(f(secant - bb) / f(bbb - bb)) * f(xMid - topBnd)));
  if (secant >= bHigh) return topBnd;
  if (secant > bLow && bHigh !== bLow) return f(bottomBnd + f(f(f(secant - bLow) / f(bHigh - bLow)) * f(topBnd - bottomBnd)));
  return bottomBnd;
}

/** FitHueSpline. @param {[number, number][]} pts @param {number[]} slopes @returns {Fit} */
function fitHueSpline(pts, slopes) {
  /** @type {Fit} */
  const fit = { knots: [pts[0][0]], A: [], B: [], C: [] };
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const dx = f(x1 - x0);
    const secant = f(f(y1 - y0) / dx);
    if (Math.abs(f(f(slopes[i] + slopes[i + 1]) - f(2 * secant))) <= f(1e-5)) {
      fit.C.push(y0);
      fit.B.push(slopes[i]);
      fit.A.push(f(f(0.5 * f(slopes[i + 1] - slopes[i])) / dx));
    } else {
      const ksi = calcKsi(i, pts, slopes);
      const mBar = f(f(f(2 * secant) - slopes[i + 1]) + f(f(f(slopes[i + 1] - slopes[i]) * f(ksi - x0)) / f(x1 - x0)));
      const eta = f(f(mBar - slopes[i]) / f(ksi - x0));
      fit.C.push(y0);
      fit.B.push(slopes[i]);
      fit.A.push(f(0.5 * eta));
      fit.C.push(f(f(y0 + f(slopes[i] * f(ksi - x0))) + f(f(f(0.5 * eta) * f(ksi - x0)) * f(ksi - x0))));
      fit.B.push(mBar);
      fit.A.push(f(f(0.5 * f(slopes[i + 1] - mBar)) / f(x1 - ksi)));
      fit.knots.push(ksi);
    }
    fit.knots.push(x1);
  }
  return fit;
}

// ---------------------------------------------------------------------------------------------------------------
// Evaluation

/**
 * A fitted curve at x; the identity curve (null) gives `identity`. Outside the knots the curve continues as a line
 * with its end slope (KnotsCoefs::evalCurve).
 * @param {Fit | null} fit @param {number} x @param {number} identity
 */
export function evalCurve(fit, x, identity) {
  if (!fit) return identity;
  const { knots, A, B, C } = fit;
  const n = A.length;
  const last = knots.length - 1;
  if (x <= knots[0]) return (x - knots[0]) * B[0] + C[0];
  if (x >= knots[last]) {
    const t = knots[last] - knots[last - 1];
    const slope = 2 * A[n - 1] * t + B[n - 1];
    const offs = (A[n - 1] * t + B[n - 1]) * t + C[n - 1];
    return (x - knots[last]) * slope + offs;
  }
  let i = 0;
  while (i < last - 1 && !(x < knots[i + 1])) i++;
  const t = x - knots[i];
  return (A[i] * t + B[i]) * t + C[i];
}

/**
 * The x at which a monotone fitted curve gives y (KnotsCoefs::evalCurveRev); the identity curve gives y.
 * @param {Fit | null} fit @param {number} y
 */
export function evalCurveRev(fit, y) {
  if (!fit) return y;
  const { knots, A, B, C } = fit;
  const n = A.length;
  const last = knots.length - 1;
  const tEnd = knots[last] - knots[last - 1];
  const endY = (A[n - 1] * tEnd + B[n - 1]) * tEnd + C[n - 1];
  if (y <= C[0]) return Math.abs(B[0]) < 1e-5 ? knots[0] : (y - C[0]) / B[0] + knots[0];
  if (y >= endY) {
    const slope = 2 * A[n - 1] * tEnd + B[n - 1];
    return Math.abs(slope) < 1e-5 ? knots[last] : (y - endY) / slope + knots[last];
  }
  let i = 0;
  while (i < last - 1 && !(y < C[i + 1])) i++;
  const c0 = C[i] - y;
  const discrim = Math.sqrt(B[i] * B[i] - 4 * A[i] * c0);
  const denom = discrim + B[i];
  // A ~ 0 and B < 0: a straight segment; invert it as a line.
  if (Math.abs(denom) < 1e-5) return Math.abs(B[i]) < 1e-5 ? knots[i] : knots[i] - c0 / B[i];
  return knots[i] + (-2 * c0) / denom;
}
