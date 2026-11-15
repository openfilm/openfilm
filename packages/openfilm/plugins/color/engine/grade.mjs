// @ts-check
/**
 * A clip's grade: what the color workbench and `openfilm color set` change, and the one function of a color it makes,
 * which is baked into the clip's LUT (bake). In order:
 *
 *   1. input      the footage's code values to light (inputs.mjs; a camera's log by its maker's curve, from the file's
 *                 range), or a camera's own LUT that takes it to BT.709
 *   2. light      exposure (stops) and white balance (the light the shot was lit by, in kelvin and tint), in linear
 *                 light, in a wide working gamut (AP1's primaries, D65 white): nothing a camera saw is clipped here
 *   3. primaries  offset, lift, gamma, gain (each a master and red, green, blue), contrast about a pivot, highlights and
 *                 shadows, in ACEScct, the log graders' wheels work in; then saturation and vibrance, in linear light
 *   4. display    to BT.709 with BT.1886's gamma 2.4: SDR footage as it came (nothing changed is no change), log and
 *                 HDR footage with highlights rolled off as film does (`output: 'film'`), or clipped (`'standard'`)
 *   5. curves     a curve of all channels and one of each, then hue against hue, saturation and luminance, luminance
 *                 against saturation and saturation against saturation, on the picture as it is seen
 *   6. windows    corrections of one range of colors (a hue, saturation and luminance range, softened), keyed on the
 *                 picture as it is seen, as a grader picks a color on the viewer
 *   7. look       a LUT of the person's (a `.cube`), mixed in by an amount
 *
 * A grade with nothing changed on SDR footage is the identity. Every amount is a plain number; `normalize` gives each
 * left out its neutral value, so a grade written by hand or by an agent needs only what it changes.
 */
import { CCT_GREY, D65, acescct, adapt, bt1886, clamp, convert, invert, mulMat, mulVec, rgbToXYZ, smoothstep, whiteOf } from './math.mjs';
import { decoderOf, inputOf } from './inputs.mjs';
import { sample } from './cube.mjs';

/** @typedef {import('./math.mjs').Vec3} Vec3 @typedef {import('./math.mjs').Mat3} Mat3 @typedef {import('./cube.mjs').Lut} Lut */
/** @typedef {{ y: number, r: number, g: number, b: number }} Wheel @typedef {[number, number][]} Points */
/**
 * @typedef {{
 *   on: boolean, hue: number, width: number, sat: [number, number], lum: [number, number], soft: number, invert: boolean,
 *   hueShift: number, saturation: number, exposure: number, warmth: number,
 * }} Window
 */
/**
 * @typedef {{
 *   v: 1,
 *   input: string, range: 'legal' | 'full', inputLut: { path: string } | null,
 *   exposure: number, white: number, tint: number,
 *   offset: Wheel, lift: Wheel, gamma: Wheel, gain: Wheel,
 *   contrast: number, pivot: number, highlights: number, shadows: number, saturation: number, vibrance: number,
 *   output: 'auto' | 'film' | 'standard',
 *   curves: { y: Points, r: Points, g: Points, b: Points },
 *   hueHue: Points, hueSat: Points, hueLum: Points, lumSat: Points, satSat: Points,
 *   windows: Window[],
 *   look: { path: string, mix: number } | null,
 * }} Grade
 */

const wheel = (/** @type {number} */ n) => ({ y: n, r: n, g: n, b: n });
const DIAGONAL = /** @type {Points} */ ([[0, 0], [1, 1]]);

/** A grade with nothing changed, on footage of `input`. @returns {Grade} */
export function neutralGrade(input = 'rec709', range = /** @type {'legal' | 'full'} */ ('legal')) {
  return {
    v: 1, input, range, inputLut: null,
    exposure: 0, white: 6500, tint: 0,
    offset: wheel(0), lift: wheel(0), gamma: wheel(0), gain: wheel(1),
    contrast: 1, pivot: CCT_GREY, highlights: 0, shadows: 0, saturation: 1, vibrance: 0,
    output: 'auto',
    curves: { y: DIAGONAL, r: DIAGONAL, g: DIAGONAL, b: DIAGONAL },
    hueHue: [], hueSat: [], hueLum: [], lumSat: [], satSat: [],
    windows: [],
    look: null,
  };
}

/** A window (a range of colors) with nothing changed yet, around hue `hue` (degrees). @returns {Window} */
export function neutralWindow(hue = 30) {
  return { on: true, hue, width: 40, sat: [0.1, 1], lum: [0.05, 0.95], soft: 0.5, invert: false, hueShift: 0, saturation: 1, exposure: 0, warmth: 0 };
}

const num = (/** @type {unknown} */ v, /** @type {number} */ d, lo = -Infinity, hi = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);
const wheelOf = (/** @type {unknown} */ v, /** @type {number} */ d, /** @type {number} */ lo, /** @type {number} */ hi) => {
  const w = /** @type {Record<string, unknown>} */ (v && typeof v === 'object' ? v : {});
  return { y: num(w.y, d, lo, hi), r: num(w.r, d, lo, hi), g: num(w.g, d, lo, hi), b: num(w.b, d, lo, hi) };
};
/** Points of a curve, in order of x, each inside `[0,1]` × `[ylo, yhi]`. */
const pointsOf = (/** @type {unknown} */ v, /** @type {Points} */ d, ylo = 0, yhi = 1, xhi = 1) => {
  if (!Array.isArray(v)) return d;
  const p = v.filter((q) => Array.isArray(q) && q.length === 2 && q.every((n) => typeof n === 'number' && Number.isFinite(n)))
    .map(([x, y]) => /** @type {[number, number]} */ ([clamp(x, 0, xhi), clamp(y, ylo, yhi)])).sort((a, b) => a[0] - b[0]);
  return p.length ? p : d;
};

/** An object's own fields, or none: what a grade written by anyone holds is read through it. */
const fields = (/** @type {unknown} */ v) => /** @type {Record<string, unknown>} */ (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** A grade as written by anyone, every amount in its range and each left out neutral. @param {unknown} raw @returns {Grade} */
export function normalize(raw) {
  const g = fields(raw);
  const inputLut = fields(g.inputLut), look = fields(g.look);
  const n = neutralGrade(typeof g.input === 'string' && inputOf(g.input) ? g.input : 'rec709');
  const curves = fields(g.curves);
  return {
    v: 1, input: n.input, range: g.range === 'full' ? 'full' : 'legal',
    inputLut: typeof inputLut.path === 'string' ? { path: inputLut.path } : null,
    exposure: num(g.exposure, 0, -8, 8), white: num(g.white, 6500, 1700, 15000), tint: num(g.tint, 0, -100, 100),
    offset: wheelOf(g.offset, 0, -1, 1), lift: wheelOf(g.lift, 0, -1, 1), gamma: wheelOf(g.gamma, 0, -1, 1), gain: wheelOf(g.gain, 1, 0, 4),
    contrast: num(g.contrast, 1, 0, 3), pivot: num(g.pivot, CCT_GREY, 0, 1), highlights: num(g.highlights, 0, -1, 1), shadows: num(g.shadows, 0, -1, 1),
    saturation: num(g.saturation, 1, 0, 3), vibrance: num(g.vibrance, 0, -1, 1),
    output: g.output === 'film' || g.output === 'standard' ? g.output : 'auto',
    curves: { y: pointsOf(curves.y, DIAGONAL), r: pointsOf(curves.r, DIAGONAL), g: pointsOf(curves.g, DIAGONAL), b: pointsOf(curves.b, DIAGONAL) },
    hueHue: pointsOf(g.hueHue, [], -0.5, 0.5), hueSat: pointsOf(g.hueSat, [], 0, 2), hueLum: pointsOf(g.hueLum, [], -1, 1),
    lumSat: pointsOf(g.lumSat, [], 0, 2), satSat: pointsOf(g.satSat, [], 0, 2),
    windows: (Array.isArray(g.windows) ? g.windows : []).slice(0, 8).map((raw) => {
      const d = neutralWindow(), w = fields(raw);
      const pair = (/** @type {unknown} */ v, /** @type {[number, number]} */ p) => (Array.isArray(v) && v.length === 2 ? /** @type {[number, number]} */ ([num(v[0], p[0], 0, 1), num(v[1], p[1], 0, 1)]) : p);
      return {
        on: w.on !== false, hue: num(w.hue, d.hue, 0, 360), width: num(w.width, d.width, 1, 180), sat: pair(w.sat, d.sat), lum: pair(w.lum, d.lum),
        soft: num(w.soft, d.soft, 0, 1), invert: w.invert === true,
        hueShift: num(w.hueShift, 0, -180, 180), saturation: num(w.saturation, 1, 0, 3), exposure: num(w.exposure, 0, -4, 4), warmth: num(w.warmth, 0, -1, 1),
      };
    }),
    look: typeof look.path === 'string' ? { path: look.path, mix: num(look.mix, 1, 0, 1) } : null,
  };
}

/** Whether `points` is the diagonal (a curve that changes nothing). */
const straight = (/** @type {Points} */ p) => p.every(([x, y]) => Math.abs(x - y) < 1e-6);

/** Whether a grade changes nothing at all on its footage (no LUT is needed then, for SDR footage). @param {Grade} g */
export function isNeutral(g) {
  const n = neutralGrade(g.input);
  const same = (/** @type {Wheel} */ a, /** @type {Wheel} */ b) => a.y === b.y && a.r === b.r && a.g === b.g && a.b === b.b;
  return inputOf(g.input)?.kind === 'display' && !g.inputLut && !g.look && g.exposure === 0 && g.white === n.white && g.tint === 0
    && same(g.offset, n.offset) && same(g.lift, n.lift) && same(g.gamma, n.gamma) && same(g.gain, n.gain)
    && g.contrast === 1 && g.highlights === 0 && g.shadows === 0 && g.saturation === 1 && g.vibrance === 0
    && straight(g.curves.y) && straight(g.curves.r) && straight(g.curves.g) && straight(g.curves.b)
    && !g.hueHue.length && !g.hueSat.length && !g.hueLum.length && !g.lumSat.length && !g.satSat.length
    && !g.windows.some((w) => w.on && (w.hueShift || w.saturation !== 1 || w.exposure || w.warmth));
}

/* ── curves ──────────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * A monotone cubic through `points` (Fritsch–Carlson: no overshoot between points, as graders' curves behave), level
 * beyond the first and last point. @param {Points} points @returns {(x: number) => number}
 */
export function curveOf(points) {
  const p = points.length >= 2 ? points : points.length === 1 ? [points[0], points[0]] : DIAGONAL;
  const n = p.length;
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const d = new Array(n - 1).fill(0).map((_, i) => (ys[i + 1] - ys[i]) / ((xs[i + 1] - xs[i]) || 1e-9));
  const m = new Array(n).fill(0).map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / (h || 1e-9);
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/**
 * A smooth curve around the hue circle through `points` ([hue 0–1, value]), `rest` where there are none: each point a
 * soft bump that falls off over the hue to its neighbors, so a few points shape a hue without a seam at red.
 * @param {Points} points @param {number} rest @returns {(hue: number) => number}
 */
export function hueCurveOf(points, rest) {
  if (!points.length) return () => rest;
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const xs = [...sorted.map((p) => p[0] - 1), ...sorted.map((p) => p[0]), ...sorted.map((p) => p[0] + 1)];
  const ys = [...sorted, ...sorted, ...sorted].map((p) => p[1]);
  /* the rest value at hues no point is near: points farther apart than a sixth of the circle fall back to it between */
  const pts = /** @type {Points} */ ([]);
  for (let i = 0; i < xs.length; i++) {
    pts.push([xs[i], ys[i]]);
    if (i + 1 < xs.length && xs[i + 1] - xs[i] > 1 / 3) { pts.push([xs[i] + 1 / 6, rest]); pts.push([xs[i + 1] - 1 / 6, rest]); }
  }
  const f = curveOf(pts);
  return (h) => f(((h % 1) + 1) % 1);
}

/* ── color models on the picture as it is seen ─────────────────────────────────────────────────────────────────── */

/** RGB (0–1) to hue (0–1), saturation (chroma over value) and value. @param {number} r @param {number} g @param {number} b @returns {Vec3} */
export function hsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
  let h = 0;
  if (c > 1e-9) h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
  return [((h / 6) % 1 + 1) % 1, max > 1e-9 ? c / max : 0, max];
}
/** Hue, saturation and value back to RGB. @param {number} h @param {number} s @param {number} v @returns {Vec3} */
export function rgbOf(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  switch (((i % 6) + 6) % 6) {
    case 0: return [v, t, p]; case 1: return [q, v, p]; case 2: return [p, v, t];
    case 3: return [p, q, v]; case 4: return [t, p, v]; default: return [v, p, q];
  }
}
/** BT.709's luma weights. */
const L709 = /** @type {Vec3} */ ([0.2126, 0.7152, 0.0722]);
const luma = (/** @type {Vec3} */ c) => L709[0] * c[0] + L709[1] * c[1] + L709[2] * c[2];

/** How much of a pixel a window takes (0–1). @param {Window} w @param {number} h hue 0–1 @param {number} s @param {number} l */
export function windowKey(w, h, s, l) {
  const soft = Math.max(w.soft, 0.001);
  const dh = Math.abs(((h * 360 - w.hue + 540) % 360) - 180);
  const half = w.width / 2, edge = Math.max(half * soft, 0.5);
  const hk = 1 - smoothstep(half - edge, half + edge, dh);
  const band = (/** @type {number} */ v, /** @type {[number, number]} */ [lo, hi]) => {
    const e = Math.max((hi - lo) * soft * 0.5, 0.01);
    return smoothstep(lo - e, lo + e, v) * (1 - smoothstep(hi - e, hi + e, v));
  };
  /* a hue means little where there is hardly any color: the hue key fades out toward grey */
  const k = hk * smoothstep(0, 0.06, s) * band(s, w.sat) * band(l, w.lum);
  return w.invert ? 1 - k : k;
}

/* ── the display ─────────────────────────────────────────────────────────────────────────────────────────────── */

/** Film's response, as a smooth curve of scene light to display light with a toe and a rolled-off shoulder (Narkowicz's fit). */
const filmic = (/** @type {number} */ x) => {
  const v = Math.max(x, 0) * 0.6;
  return (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
};

/**
 * A color brought into the display's gamut smoothly: each channel's distance from the color's largest (0 on the
 * achromatic axis, 1 on the gamut's edge) compressed past a threshold so distances up to a limit land inside it, as
 * ACES 1.3's reference gamut compression does (its thresholds, limits and power). Colors well inside are untouched;
 * the saturated colors log and wide-gamut cameras record roll into the gamut instead of being cut at its edge, which
 * also keeps a LUT of the grade smooth there. @param {Vec3} c
 */
function intoGamut(c) {
  const ach = Math.max(c[0], c[1], c[2]);
  if (ach <= 0) return c;
  return /** @type {Vec3} */ (c.map((v, i) => {
    const d = (ach - v) / ach;
    const thr = GAMUT_THRESHOLD[i];
    if (d <= thr) return v;
    const lim = GAMUT_LIMIT[i];
    const scl = (lim - thr) / ((((1 - thr) / (lim - thr)) ** -GAMUT_POWER - 1) ** (1 / GAMUT_POWER));
    const nd = (d - thr) / scl;
    return ach - (thr + (scl * nd) / (1 + nd ** GAMUT_POWER) ** (1 / GAMUT_POWER)) * ach;
  }));
}
/* ACES 1.3 reference gamut compression's parameters: red's distance (toward cyan), green's (magenta), blue's (yellow) */
const GAMUT_THRESHOLD = [0.815, 0.803, 0.88], GAMUT_LIMIT = [1.147, 1.264, 1.312], GAMUT_POWER = 1.2;

/* ── the whole grade, as a function of a color ───────────────────────────────────────────────────────────────── */

/** The grade's working space: AP1's primaries with D65 white (wide enough for any camera's colors; white stays white). */
const WORK = { r: /** @type {[number, number]} */ ([0.713, 0.293]), g: /** @type {[number, number]} */ ([0.165, 0.830]), b: /** @type {[number, number]} */ ([0.128, 0.044]), w: D65 };
const WORK_LUMA = rgbToXYZ(WORK)[1];

/**
 * The grade as one function from a code value of the footage (RGB, each 0–1) to a code value shown (BT.709, gamma 2.4,
 * each 0–1). `luts`: the LUT files the grade names (its input LUT and its look), read, by their paths.
 *
 * `extended`: where the grade clips a channel at black or white, how far past it the color went is kept, below 0 or
 * above 1, for a LUT to hold. A LUT's lattice points are far apart; between a clipped point and an unclipped one its
 * lookup would round the clip's corner off (up to ten 8-bit codes, in shadows pushed below black). Clamped after the
 * lookup, as ffmpeg's lut3d and the workbench's preview clamp, the extended LUT gives the clip where it is.
 * @param {Grade} g @param {Record<string, Lut>} [luts] @param {{ extended?: boolean }} [how]
 * @returns {(r: number, g: number, b: number) => Vec3}
 */
export function compile(g, luts = {}, { extended = false } = {}) {
  const input = inputOf(g.input) ?? /** @type {import('./inputs.mjs').Input} */ (inputOf('rec709'));
  const inputLut = g.inputLut ? luts[g.inputLut.path] ?? null : null;
  const look = g.look ? luts[g.look.path] ?? null : null;
  /* a camera's own LUT takes its footage to BT.709 video: graded from there as SDR footage is */
  const kind = inputLut ? 'display' : input.kind;
  const decode = inputLut ? bt1886.decode : decoderOf(input, g.range);
  const toWork = convert(inputLut ? 'bt709' : input.gamut, WORK);
  /* white balance: the light the shot was lit by made white again (Bradford, in the working space) */
  const balanced = g.white !== 6500 || g.tint !== 0;
  /* relative to 6500 K on the same locus, so the first step off 6500 K is as small as the next */
  const wb = balanced ? mulMat(invert(rgbToXYZ(WORK)), mulMat(adapt(whiteOf(g.white, g.tint * 0.0002), whiteOf(6500)), rgbToXYZ(WORK))) : null;
  const exposure = 2 ** g.exposure;
  const toDisplay = convert(WORK, 'bt709');
  const output = g.output === 'auto' ? (kind === 'display' ? 'standard' : 'film') : g.output;
  /* SDR footage given back the way it came in; else BT.1886 */
  const encode = kind === 'display' && output === 'standard' ? (inputLut ? bt1886.encode : input.encode ?? bt1886.encode) : bt1886.encode;
  const black = acescct.encode(0), white = acescct.encode(1);
  const span = white - black;
  const lgg = ['r', 'g', 'b'].map((c) => {
    const k = /** @type {'r' | 'g' | 'b'} */ (c);
    return { offset: g.offset.y + g.offset[k], lift: g.lift.y + g.lift[k], gain: g.gain.y * g.gain[k], power: 2 ** -(g.gamma.y + g.gamma[k]) };
  });
  const primaries = lgg.some((p) => p.offset || p.lift || p.gain !== 1 || p.power !== 1) || g.contrast !== 1 || g.highlights || g.shadows;
  const curveY = straight(g.curves.y) ? null : curveOf(g.curves.y);
  const curveRGB = [g.curves.r, g.curves.g, g.curves.b].map((p) => (straight(p) ? null : curveOf(p)));
  const hueHue = g.hueHue.length ? hueCurveOf(g.hueHue, 0) : null;
  const hueSat = g.hueSat.length ? hueCurveOf(g.hueSat, 1) : null;
  const hueLum = g.hueLum.length ? hueCurveOf(g.hueLum, 0) : null;
  const lumSat = g.lumSat.length ? curveOf(g.lumSat) : null;
  const satSat = g.satSat.length ? curveOf(g.satSat) : null;
  const windows = g.windows.filter((w) => w.on && (w.hueShift || w.saturation !== 1 || w.exposure || w.warmth));
  const hsl = hueHue || hueSat || hueLum || lumSat || satSat || windows.length;

  return (r0, g0, b0) => {
    /* 1–2: light, in the working gamut */
    let c = /** @type {Vec3} */ (inputLut ? sample(inputLut, r0, g0, b0) : [r0, g0, b0]);
    c = mulVec(toWork, [decode(c[0]), decode(c[1]), decode(c[2])]);
    if (wb) c = mulVec(wb, c);
    if (exposure !== 1) c = [c[0] * exposure, c[1] * exposure, c[2] * exposure];
    /* 3: the wheels, contrast and zones in ACEScct */
    if (primaries) {
      const v = [acescct.encode(c[0]), acescct.encode(c[1]), acescct.encode(c[2])];
      const y = WORK_LUMA[0] * v[0] + WORK_LUMA[1] * v[1] + WORK_LUMA[2] * v[2];
      const zones = g.highlights * 0.12 * smoothstep(CCT_GREY, white + 0.08, y) + g.shadows * 0.12 * (1 - smoothstep(black, CCT_GREY + 0.05, y));
      for (let i = 0; i < 3; i++) {
        const p = lgg[i];
        let u = (v[i] + p.offset - black) / span;
        u = p.gain * (u + p.lift * (1 - u));
        u = u > 0 ? u ** p.power : u;
        let w = black + u * span + zones;
        w = (w - g.pivot) * g.contrast + g.pivot;
        v[i] = w;
      }
      c = [acescct.decode(v[0]), acescct.decode(v[1]), acescct.decode(v[2])];
    }
    if (g.saturation !== 1 || g.vibrance) {
      const l = WORK_LUMA[0] * c[0] + WORK_LUMA[1] * c[1] + WORK_LUMA[2] * c[2];
      const max = Math.max(c[0], c[1], c[2]), min = Math.min(c[0], c[1], c[2]);
      const chroma = max > 1e-6 ? clamp((max - min) / max) : 0;
      const s = g.saturation * (1 + g.vibrance * (1 - chroma));
      c = [l + (c[0] - l) * s, l + (c[1] - l) * s, l + (c[2] - l) * s];
    }
    /* 4: the display */
    c = mulVec(toDisplay, c);
    /* a camera's colors outside BT.709 rolled into it; SDR footage, already in it, only clipped where a grade pushes it out */
    if (kind !== 'display') c = intoGamut(c);
    if (output === 'film') c = [filmic(c[0]), filmic(c[1]), filmic(c[2])];
    /* how far past black or white each channel went, for an extended LUT */
    const over = extended ? /** @type {Vec3} */ (c.map((x) => (x > 1 ? bt1886.encode(x) - 1 : x < 0 ? x : 0))) : null;
    c = [encode(clamp(c[0])), encode(clamp(c[1])), encode(clamp(c[2]))];
    /* 5: curves, on the picture as it is seen */
    if (curveY) c = [curveY(c[0]), curveY(c[1]), curveY(c[2])];
    for (let i = 0; i < 3; i++) { const f = curveRGB[i]; if (f) c[i] = f(c[i]); }
    if (hsl) {
      let [h, s, v] = hsv(clamp(c[0]), clamp(c[1]), clamp(c[2]));
      const l = luma(c);
      const colored = smoothstep(0, 0.08, s);
      if (hueHue) h += hueHue(h) * colored;
      let sat = 1;
      if (hueSat) sat *= 1 + (hueSat(h) - 1) * colored;
      if (lumSat) sat *= lumSat(l);
      if (satSat) sat *= satSat(s);
      let gainV = hueLum ? 2 ** (hueLum(h) * colored) : 1;
      /* 6: windows, each keyed on the color as it was before them */
      let warm = 0;
      for (const w of windows) {
        const k = windowKey(w, h, s, l);
        if (k <= 0) continue;
        h += (w.hueShift / 360) * k;
        sat *= 1 + (w.saturation - 1) * k;
        gainV *= 2 ** (w.exposure * 0.5 * k);
        warm += w.warmth * k;
      }
      c = rgbOf(((h % 1) + 1) % 1, clamp(s * sat), clamp(v * gainV));
      if (warm) c = [c[0] * (1 + 0.12 * warm), c[1], c[2] * (1 - 0.12 * warm)];
    }
    /* 7: the person's look */
    if (look && g.look) {
      const o = sample(look, clamp(c[0]), clamp(c[1]), clamp(c[2]));
      const m = g.look.mix;
      c = [c[0] + (o[0] - c[0]) * m, c[1] + (o[1] - c[1]) * m, c[2] + (o[2] - c[2]) * m];
    }
    if (over) {
      /* past the clip only where the channel still is at it: a curve or window that took it off the clip has the say */
      for (let i = 0; i < 3; i++) {
        const o = over[i];
        if ((o > 0 && c[i] >= 1) || (o < 0 && c[i] <= 0)) c[i] = clamp(c[i] + o, -1, 2);
        else c[i] = clamp(c[i]);
      }
      return c;
    }
    return [clamp(c[0]), clamp(c[1]), clamp(c[2])];
  };
}

/**
 * The LUT size a grade is baked at: 65 where the grade bends hard between a 33³ lattice's points (log or HDR input, a
 * LUT, hue and saturation curves, windows), else 33. Measured on real footage against the grade itself: 65³ keeps all
 * but a few hundredths of a percent of pixels within 2 eight-bit codes. @param {Grade} g
 */
export const sizeFor = (g) => (g.inputLut || inputOf(g.input)?.kind !== 'display' || g.hueHue.length || g.hueSat.length || g.hueLum.length
  || g.lumSat.length || g.satSat.length || g.windows.some((w) => w.on) ? 65 : 33);

/**
 * The grade baked: `size`³ RGB outputs, red fastest, as a `.cube` lists them and a 3D texture takes them; extended
 * past black and white where the grade clips (compile), so they are clamped after the lookup.
 * @param {Grade} g @param {number} size @param {Record<string, Lut>} [luts] @returns {Float32Array}
 */
export function bake(g, size, luts = {}) {
  const f = compile(g, luts, { extended: true });
  const out = new Float32Array(size ** 3 * 3);
  const n = size - 1;
  let at = 0;
  for (let b = 0; b < size; b++) for (let gg = 0; gg < size; gg++) for (let r = 0; r < size; r++) {
    const o = f(r / n, gg / n, b / n);
    out[at++] = o[0]; out[at++] = o[1]; out[at++] = o[2];
  }
  return out;
}
