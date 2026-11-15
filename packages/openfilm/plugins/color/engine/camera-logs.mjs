// @ts-check
/**
 * Cameras' log encodings, each as its maker publishes it: the curve from a code value to scene light (0.18 is an 18 %
 * grey card, 0.9 a 90 % white card) and the gamut it is recorded in. Every constant is the maker's own, from the
 * documents named on each entry (or, where a maker's document is not public, the maker's ACES input transform).
 *
 * Makers define their curves on one of two scales, so `codes` says which:
 *   `signal`  the curve's value is the video signal, 0 at black's code and 1 at white's (ARRI, Blackmagic, Canon, Apple):
 *             what ffmpeg and the browser give for a file of either range
 *   `cv`      the curve's value is the stored 10-bit code over 1023 (Sony, Panasonic, Fujifilm, Nikon, DJI): in a file of
 *             video (legal) range, the signal is first taken back to that code, 64 + 876 × signal; in a full-range file
 *             the signal already is it
 * Checked on each maker's printed table (camera-logs.test.mjs): S-Log3's 18 % grey reads code 420, V-Log's 433, and so on.
 *
 * All the gamuts here are D65's white, so none needs adapting to a D65 display.
 */

/** @typedef {import('./inputs.mjs').Input} Input @typedef {import('./inputs.mjs').Primaries} Primaries */

const D65 = /** @type {[number, number]} */ ([0.3127, 0.3290]);
const space = (/** @type {number[]} */ [rx, ry, gx, gy, bx, by]) => /** @type {Primaries} */ ({ r: [rx, ry], g: [gx, gy], b: [bx, by], w: D65 });

/** Gamuts by their makers' primaries. */
export const CAMERA_GAMUTS = {
  /* Sony, S-Gamut3 and S-Gamut3.Cine (Sony's input transforms) */
  sgamut3: space([0.730, 0.280, 0.140, 0.855, 0.100, -0.050]),
  sgamut3cine: space([0.766, 0.275, 0.225, 0.800, 0.089, -0.087]),
  /* ARRI Wide Gamut 3 (ALEXA Log C Curve, Usage in VFX, 2017) and 4 (ARRI LogC4 Specification, 2025) */
  awg3: space([0.6840, 0.3130, 0.2210, 0.8480, 0.0861, -0.1020]),
  awg4: space([0.7347, 0.2653, 0.1424, 0.8576, 0.0991, -0.0308]),
  /* Canon Cinema Gamut (Canon's input transforms) */
  cinema: space([0.74, 0.27, 0.17, 1.14, 0.08, -0.10]),
  /* Panasonic V-Gamut (V-Log/V-Gamut Reference Manual, 2014) */
  vgamut: space([0.730, 0.280, 0.165, 0.840, 0.100, -0.030]),
  /* DJI D-Gamut (White Paper on D-Log and D-Gamut, 2017) */
  dgamut: space([0.71, 0.31, 0.21, 0.88, 0.09, -0.08]),
  /* Blackmagic Wide Gamut, Gen 5 (Generation 5 Color Science, 2021); its white is D65 to within 1e-5 */
  bmdwg: space([0.7177215, 0.3171181, 0.2280410, 0.8615690, 0.1005841, -0.0820452]),
  /* Apple Wide Gamut, Apple Log 2 (Apple Log 2 white paper, 2025) */
  applewg: space([0.725, 0.301, 0.221, 0.814, 0.068, -0.076]),
};

const log10 = Math.log10, ln = Math.log;

/* Apple Log (Apple Log Profile white paper, 2023; Apple's ACES input transform) */
const AL = { R0: -0.05641088, Rt: 0.01, c: 47.28711236, b: 0.00964052, g: 0.08550479, d: 0.69336945 };
const AL_PT = AL.c * (AL.Rt - AL.R0) ** 2;
const appleLog = {
  decode: (/** @type {number} */ p) => (p >= AL_PT ? 2 ** ((p - AL.d) / AL.g) - AL.b : p >= 0 ? Math.sqrt(p / AL.c) + AL.R0 : AL.R0),
  encode: (/** @type {number} */ r) => (r >= AL.Rt ? AL.g * Math.log2(r + AL.b) + AL.d : r >= AL.R0 ? AL.c * (r - AL.R0) ** 2 : 0),
};

/* Sony S-Log3 (S-Gamut3/S-Log3 Technical Summary; Sony's ACES input transforms) */
const SL3_CUT = 171.2102946929 / 1023;
const sLog3 = {
  decode: (/** @type {number} */ y) => (y >= SL3_CUT ? 10 ** ((y * 1023 - 420) / 261.5) * 0.19 - 0.01 : ((y * 1023 - 95) * 0.01125) / (171.2102946929 - 95)),
  encode: (/** @type {number} */ x) => (x >= 0.01125 ? (420 + log10((x + 0.01) / 0.19) * 261.5) / 1023 : ((x * (171.2102946929 - 95)) / 0.01125 + 95) / 1023),
};

/* ARRI LogC3, EI 800 (ALEXA Log C Curve, Usage in VFX): ARRI's own default for any EI, within 10 % from 200 to 1600 */
const C3 = { cut: 0.010591, a: 5.555556, b: 0.052272, c: 0.247190, d: 0.385537, e: 5.367655, f: 0.092809 };
const logC3 = {
  decode: (/** @type {number} */ t) => (t > C3.e * C3.cut + C3.f ? (10 ** ((t - C3.d) / C3.c) - C3.b) / C3.a : (t - C3.f) / C3.e),
  encode: (/** @type {number} */ x) => (x > C3.cut ? C3.c * log10(C3.a * x + C3.b) + C3.d : C3.e * x + C3.f),
};

/* ARRI LogC4 (ARRI LogC4 Specification, 2025) */
const C4a = (2 ** 18 - 16) / 117.45, C4b = (1023 - 95) / 1023, C4c = 95 / 1023;
const C4s = (7 * ln(2) * 2 ** (7 - (14 * C4c) / C4b)) / (C4a * C4b), C4t = (2 ** (14 * (-C4c / C4b) + 6) - 64) / C4a;
const logC4 = {
  decode: (/** @type {number} */ e) => (e >= 0 ? (2 ** ((14 * (e - C4c)) / C4b + 6) - 64) / C4a : e * C4s + C4t),
  encode: (/** @type {number} */ x) => (x >= C4t ? ((Math.log2(C4a * x + 64) - 6) / 14) * C4b + C4c : (x - C4t) / C4s),
};

/* Canon Log 3, on the video signal (Canon's input transforms; Canon's signal convention, Canon-Log white paper, 2012) */
const canonLog3 = {
  decode: (/** @type {number} */ y) => 0.9 * (y < 0.04076162 ? -(10 ** ((0.07623209 - y) / 0.42889912) - 1) / 14.98325
    : y <= 0.105357102 ? (y - 0.073059361) / 2.3069815 : (10 ** ((y - 0.069886632) / 0.42889912) - 1) / 14.98325),
  encode: (/** @type {number} */ x) => {
    const X = x / 0.9;
    if (X < (0.04076162 - 0.073059361) / 2.3069815) return -0.42889912 * log10(-X * 14.98325 + 1) + 0.07623209;
    if (X <= (0.105357102 - 0.073059361) / 2.3069815) return 2.3069815 * X + 0.073059361;
    return 0.42889912 * log10(X * 14.98325 + 1) + 0.069886632;
  },
};

/* Panasonic V-Log (V-Log/V-Gamut Reference Manual) */
const vLog = {
  decode: (/** @type {number} */ v) => (v < 0.181 ? (v - 0.125) / 5.6 : 10 ** ((v - 0.598206) / 0.241514) - 0.00873),
  encode: (/** @type {number} */ x) => (x < 0.01 ? 5.6 * x + 0.125 : 0.241514 * log10(x + 0.00873) + 0.598206),
};

/* DJI D-Log (White Paper on D-Log and D-Gamut): the exact inverse of DJI's curve (its printed inverse is rounded) */
const DL_C = 0.256663, DL_D = 0.584555;
const dLog = {
  decode: (/** @type {number} */ y) => (y <= 0.14 ? (y - 0.0929) / 6.025 : (10 ** ((y - DL_D) / DL_C) - 0.0108) / 0.9892),
  encode: (/** @type {number} */ x) => (x <= 0.0078 ? 6.025 * x + 0.0929 : log10(x * 0.9892 + 0.0108) * DL_C + DL_D),
};

/* Fujifilm F-Log and F-Log2 (F-Log Data Sheet 1.1, F-Log2 Data Sheet 1.0): one form, two sets of constants */
const fujifilm = (/** @type {{ a: number, b: number, c: number, d: number, e: number, f: number, cut1: number, cut2: number }} */ k) => ({
  decode: (/** @type {number} */ v) => (v >= k.cut2 ? 10 ** ((v - k.d) / k.c) / k.a - k.b / k.a : (v - k.f) / k.e),
  encode: (/** @type {number} */ x) => (x >= k.cut1 ? k.c * log10(k.a * x + k.b) + k.d : k.e * x + k.f),
});
const fLog = fujifilm({ a: 0.555556, b: 0.009468, c: 0.344676, d: 0.790453, e: 8.735631, f: 0.092864, cut1: 0.00089, cut2: 0.100537775223865 });
const fLog2 = fujifilm({ a: 5.555556, b: 0.064829, c: 0.245281, d: 0.384316, e: 8.799461, f: 0.092864, cut1: 0.000889, cut2: 0.100686685370811 });

/* Nikon N-Log (N-Log Specification 1.0.0): written on the 10-bit code, with natural logarithms */
const nLog = {
  decode: (/** @type {number} */ v) => { const X = v * 1023; return X < 452 ? (X / 650) ** 3 - 0.0075 : Math.exp((X - 619) / 150); },
  encode: (/** @type {number} */ y) => (y < 0.328 ? 650 * Math.cbrt(y + 0.0075) : 150 * ln(y) + 619) / 1023,
};

/* Blackmagic Film Generation 5 (Generation 5 Color Science) */
const BM = { A: 0.08692876065491224, B: 0.005494072432257808, C: 0.5300133392291939, D: 8.283605932402494, E: 0.09246575342465753, cut: 0.005 };
const bmdFilm5 = {
  decode: (/** @type {number} */ y) => (y < BM.D * BM.cut + BM.E ? (y - BM.E) / BM.D : Math.exp((y - BM.C) / BM.A) - BM.B),
  encode: (/** @type {number} */ x) => (x < BM.cut ? BM.D * x + BM.E : BM.A * ln(x + BM.B) + BM.C),
};

/** @type {Input[]} */
export const CAMERA_LOGS = [
  { id: 'applelog', name: 'Apple Log', kind: 'log', gamut: 'bt2020', codes: 'signal', ...appleLog },
  { id: 'applelog2', name: 'Apple Log 2', kind: 'log', gamut: CAMERA_GAMUTS.applewg, codes: 'signal', ...appleLog },
  { id: 'slog3', name: 'Sony S-Log3 / S-Gamut3.Cine', kind: 'log', gamut: CAMERA_GAMUTS.sgamut3cine, codes: 'cv', ...sLog3 },
  { id: 'slog3sg3', name: 'Sony S-Log3 / S-Gamut3', kind: 'log', gamut: CAMERA_GAMUTS.sgamut3, codes: 'cv', ...sLog3 },
  { id: 'logc3', name: 'ARRI LogC3 / Wide Gamut 3', kind: 'log', gamut: CAMERA_GAMUTS.awg3, codes: 'signal', ...logC3 },
  { id: 'logc4', name: 'ARRI LogC4 / Wide Gamut 4', kind: 'log', gamut: CAMERA_GAMUTS.awg4, codes: 'signal', ...logC4 },
  { id: 'clog3', name: 'Canon Log 3 / Cinema Gamut', kind: 'log', gamut: CAMERA_GAMUTS.cinema, codes: 'signal', ...canonLog3 },
  { id: 'vlog', name: 'Panasonic V-Log / V-Gamut', kind: 'log', gamut: CAMERA_GAMUTS.vgamut, codes: 'cv', ...vLog },
  { id: 'flog2', name: 'Fujifilm F-Log2', kind: 'log', gamut: 'bt2020', codes: 'cv', ...fLog2 },
  { id: 'flog', name: 'Fujifilm F-Log', kind: 'log', gamut: 'bt2020', codes: 'cv', ...fLog },
  { id: 'nlog', name: 'Nikon N-Log', kind: 'log', gamut: 'bt2020', codes: 'cv', ...nLog },
  { id: 'dlog', name: 'DJI D-Log / D-Gamut', kind: 'log', gamut: CAMERA_GAMUTS.dgamut, codes: 'cv', ...dLog },
  { id: 'bmdfilm5', name: 'Blackmagic Film Gen 5', kind: 'log', gamut: CAMERA_GAMUTS.bmdwg, codes: 'signal', ...bmdFilm5 },
];
