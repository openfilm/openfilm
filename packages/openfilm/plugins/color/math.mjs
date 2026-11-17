// @ts-check
/**
 * The color science the grade is made of: 3×3 matrices, RGB spaces by their primaries and white, chromatic adaptation,
 * the transfer functions of display video (BT.1886, sRGB, HLG, PQ) and of the grading space (ACEScct), and a light's
 * color by its temperature. Plain functions of numbers, the same in Studio's page, its server and the commands.
 */

/** @typedef {[number, number, number]} Vec3 @typedef {[Vec3, Vec3, Vec3]} Mat3 */

/** @param {Mat3} m @param {Vec3} v @returns {Vec3} */
export const mulVec = (m, v) => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

/** @param {Mat3} a @param {Mat3} b @returns {Mat3} */
export function mulMat(a, b) {
  /** @type {number[][]} */
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return /** @type {Mat3} */ (out);
}

/** @param {Mat3} m @returns {Mat3} */
export function invert(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('a matrix with no inverse');
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

/** xy chromaticity to XYZ with Y = 1. @param {[number, number]} xy @returns {Vec3} */
export const xyToXYZ = ([x, y]) => [x / y, 1, (1 - x - y) / y];

/**
 * The matrix from linear RGB to CIE XYZ of a space with these primaries and white (xy each), white at Y = 1.
 * @param {{ r: [number, number], g: [number, number], b: [number, number], w: [number, number] }} p @returns {Mat3}
 */
export function rgbToXYZ(p) {
  const [R, G, B] = [xyToXYZ(p.r), xyToXYZ(p.g), xyToXYZ(p.b)];
  const P = /** @type {Mat3} */ ([[R[0], G[0], B[0]], [R[1], G[1], B[1]], [R[2], G[2], B[2]]]);
  const S = mulVec(invert(P), xyToXYZ(p.w));
  return [[P[0][0] * S[0], P[0][1] * S[1], P[0][2] * S[2]], [P[1][0] * S[0], P[1][1] * S[1], P[1][2] * S[2]], [P[2][0] * S[0], P[2][1] * S[1], P[2][2] * S[2]]];
}

export const D65 = /** @type {[number, number]} */ ([0.3127, 0.3290]);
/** ACES' white (about D60), as ACES' documents give it */
export const ACES_WHITE = /** @type {[number, number]} */ ([0.32168, 0.33767]);

/**
 * @typedef {{ r: [number, number], g: [number, number], b: [number, number], w: [number, number] }} Primaries
 * @typedef {'bt709' | 'bt2020' | 'p3d65' | 'ap0' | 'ap1'} SpaceName
 */
/** RGB spaces by primaries and white. @type {Record<SpaceName, Primaries>} */
export const SPACES = {
  bt709: { r: [0.640, 0.330], g: [0.300, 0.600], b: [0.150, 0.060], w: D65 },
  bt2020: { r: [0.708, 0.292], g: [0.170, 0.797], b: [0.131, 0.046], w: D65 },
  p3d65: { r: [0.680, 0.320], g: [0.265, 0.690], b: [0.150, 0.060], w: D65 },
  ap0: { r: [0.7347, 0.2653], g: [0.0, 1.0], b: [0.0001, -0.0770], w: ACES_WHITE },
  ap1: { r: [0.713, 0.293], g: [0.165, 0.830], b: [0.128, 0.044], w: ACES_WHITE },
};

/** Bradford's cone response, for chromatic adaptation (as ACES and most graders' tools adapt). @type {Mat3} */
const BRADFORD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];

/** The XYZ → XYZ matrix that adapts colors seen under white `from` to how they look under white `to` (xy). */
export function adapt(/** @type {[number, number]} */ from, /** @type {[number, number]} */ to) {
  const s = mulVec(BRADFORD, xyToXYZ(from)), d = mulVec(BRADFORD, xyToXYZ(to));
  const scale = /** @type {Mat3} */ ([[d[0] / s[0], 0, 0], [0, d[1] / s[1], 0], [0, 0, d[2] / s[2]]]);
  return mulMat(invert(BRADFORD), mulMat(scale, BRADFORD));
}

/**
 * The matrix from linear RGB of space `a` to linear RGB of space `b`, a white adapted to the other's (Bradford).
 * @param {keyof typeof SPACES | { r: [number, number], g: [number, number], b: [number, number], w: [number, number] }} a
 * @param {keyof typeof SPACES | { r: [number, number], g: [number, number], b: [number, number], w: [number, number] }} b
 * @returns {Mat3}
 */
export function convert(a, b) {
  const A = typeof a === 'string' ? SPACES[a] : a, B = typeof b === 'string' ? SPACES[b] : b;
  const sameWhite = Math.abs(A.w[0] - B.w[0]) < 1e-6 && Math.abs(A.w[1] - B.w[1]) < 1e-6;
  const xyz = sameWhite ? rgbToXYZ(A) : mulMat(adapt(A.w, B.w), rgbToXYZ(A));
  return mulMat(invert(rgbToXYZ(B)), xyz);
}

/** Luminance weights of a space: the Y row of its RGB → XYZ matrix. */
export const lumaOf = (/** @type {keyof typeof SPACES} */ space) => rgbToXYZ(SPACES[space])[1];

/* ── transfer functions: encoded value ⇄ linear light ──────────────────────────────────────────────────────────── */

/** BT.1886's display (gamma 2.4, black at 0): how graders' monitors show BT.709 video, and how SDR footage is taken in. */
export const bt1886 = {
  decode: (/** @type {number} */ v) => Math.sign(v) * Math.abs(v) ** 2.4,
  encode: (/** @type {number} */ l) => Math.sign(l) * Math.abs(l) ** (1 / 2.4),
};

/** sRGB's transfer (IEC 61966-2-1). */
export const srgb = {
  decode: (/** @type {number} */ v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4),
  encode: (/** @type {number} */ l) => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.max(l, 0) ** (1 / 2.4) - 0.055),
};

/** ACEScct (S-2016-001): the log the grade's wheels and contrast work in; 0.18 is at about 0.4135. */
export const acescct = {
  encode: (/** @type {number} */ lin) => (lin <= 0.0078125 ? 10.5402377416545 * lin + 0.0729055341958355 : (Math.log2(lin) + 9.72) / 17.52),
  decode: (/** @type {number} */ v) => (v <= 0.155251141552511 ? (v - 0.0729055341958355) / 10.5402377416545
    : v < (Math.log2(65504) + 9.72) / 17.52 ? 2 ** (v * 17.52 - 9.72) : 65504),
};
/** Mid grey in ACEScct. */
export const CCT_GREY = acescct.encode(0.18);

/** BT.2100 HLG: the inverse OETF, a signal value to scene light from 0 to 1. */
const HLG = { a: 0.17883277, b: 1 - 4 * 0.17883277, c: 0.5 - 0.17883277 * Math.log(4 * 0.17883277) };
export const hlg = {
  decode: (/** @type {number} */ v) => (v <= 0.5 ? (v * v) / 3 : (Math.exp((v - HLG.c) / HLG.a) + HLG.b) / 12),
  encode: (/** @type {number} */ e) => (e <= 1 / 12 ? Math.sqrt(3 * Math.max(e, 0)) : HLG.a * Math.log(12 * e - HLG.b) + HLG.c),
};

/** SMPTE ST 2084 PQ: a signal value to display light in cd/m² (0 to 10 000). */
const PQ = { m1: 2610 / 16384, m2: (2523 / 4096) * 128, c1: 3424 / 4096, c2: (2413 / 4096) * 32, c3: (2392 / 4096) * 32 };
export const pq = {
  decode: (/** @type {number} */ v) => {
    const p = Math.max(v, 0) ** (1 / PQ.m2);
    return 10000 * (Math.max(p - PQ.c1, 0) / (PQ.c2 - PQ.c3 * p)) ** (1 / PQ.m1);
  },
  encode: (/** @type {number} */ nits) => {
    const y = (Math.max(nits, 0) / 10000) ** PQ.m1;
    return ((PQ.c1 + PQ.c2 * y) / (1 + PQ.c3 * y)) ** PQ.m2;
  },
};

/* ── a light's color by its temperature ────────────────────────────────────────────────────────────────────────── */

/**
 * The chromaticity (xy) of a light of `kelvin` on the Planckian locus (Kim et al.'s cubic spline, 1667–25000 K), moved
 * off it by `duv` (positive: toward green, as Δuv is signed; a tint toward magenta is negative).
 * @param {number} kelvin @param {number} [duv] @returns {[number, number]}
 */
export function whiteOf(kelvin, duv = 0) {
  const T = Math.min(Math.max(kelvin, 1667), 25000);
  const x = T <= 4000
    ? -0.2661239e9 / T ** 3 - 0.2343589e6 / T ** 2 + 0.8776956e3 / T + 0.179910
    : -3.0258469e9 / T ** 3 + 2.1070379e6 / T ** 2 + 0.2226347e3 / T + 0.240390;
  const y = T <= 2222 ? -1.1063814 * x ** 3 - 1.34811020 * x ** 2 + 2.18555832 * x - 0.20219683
    : T <= 4000 ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
      : 3.0817580 * x ** 3 - 5.87338670 * x ** 2 + 3.75112997 * x - 0.37001483;
  if (!duv) return [x, y];
  /* in CIE 1960 uv, step off the locus along its normal */
  const uv = (/** @type {number} */ px, /** @type {number} */ py) => [4 * px / (-2 * px + 12 * py + 3), 6 * py / (-2 * px + 12 * py + 3)];
  const [u, v] = uv(x, y);
  const ahead = whiteOf(T + 10);
  const [u2, v2] = uv(ahead[0], ahead[1]);
  const len = Math.hypot(u2 - u, v2 - v) || 1;
  /* the normal toward larger v, the green side, where Δuv is positive by convention (D65 is at +0.0032) */
  let nu = -(v2 - v) / len, nv = (u2 - u) / len;
  if (nv < 0) { nu = -nu; nv = -nv; }
  const U = u + nu * duv, V = v + nv * duv;
  return [3 * U / (2 * U - 8 * V + 4), 2 * V / (2 * U - 8 * V + 4)];
}

/**
 * The correlated color temperature of chromaticity `xy`, and its distance from the Planckian locus (Δuv, positive
 * toward green): searched along the locus, for telling a picture's white balance in kelvin.
 * @param {[number, number]} xy @returns {{ kelvin: number, duv: number }}
 */
export function temperatureOf(xy) {
  const uv = (/** @type {number} */ px, /** @type {number} */ py) => [4 * px / (-2 * px + 12 * py + 3), 6 * py / (-2 * px + 12 * py + 3)];
  const [u0, v0] = uv(xy[0], xy[1]);
  let best = 6500, least = Infinity;
  for (let mired = 40; mired <= 600; mired += 0.5) {
    const [x, y] = whiteOf(1e6 / mired);
    const [u, v] = uv(x, y);
    const d = (u - u0) ** 2 + (v - v0) ** 2;
    if (d < least) { least = d; best = 1e6 / mired; }
  }
  const [x, y] = whiteOf(best);
  const [u, v] = uv(x, y);
  const ahead = whiteOf(best + 10);
  const [u2, v2] = uv(ahead[0], ahead[1]);
  let nu = -(v2 - v), nv = u2 - u;
  if (nv < 0) { nu = -nu; nv = -nv; }
  const side = Math.sign((u0 - u) * nu + (v0 - v) * nv) || 1;
  return { kelvin: Math.round(best), duv: side * Math.sqrt(least) };
}

/** XYZ (D65 white at Y = 1) to CIE L*a*b*, for measuring how far colors are apart. @param {Vec3} xyz @returns {Vec3} */
export function xyzToLab(xyz) {
  const w = xyToXYZ(D65);
  const f = (/** @type {number} */ t) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  const [fx, fy, fz] = [f(xyz[0] / w[0]), f(xyz[1] / w[1]), f(xyz[2] / w[2])];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export const clamp = (/** @type {number} */ v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) => a + (b - a) * t;
export const smoothstep = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ x) => {
  const t = clamp((x - a) / (b - a || 1e-9));
  return t * t * (3 - 2 * t);
};
