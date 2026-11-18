// @ts-check
/**
 * What a picture's color is, in numbers a colorist reads off scopes: its exposure (luma's spread, in IRE, and what is
 * clipped or crushed), its white balance (the temperature and tint of what is nearly grey in it), skin (how far skin
 * tones are from the skin line: orange hues, which skin is among, as a vectorscope shows them, not people found), saturation
 * and contrast. Read from a picture as it is shown (BT.709 R'G'B', each 0–1,
 * as a graded copy plays), so the numbers are what the film shows.
 */
import { bt1886, D65, rgbToXYZ, SPACES, temperatureOf } from './math.mjs';

const TO_XYZ = rgbToXYZ(SPACES.bt709);
/** BT.709's luma weights, on R'G'B' as video scopes weigh it. */
const L = [0.2126, 0.7152, 0.0722];
/** The skin line's hue on a BT.709 vectorscope, as HSV hue (0–1): about 123° from the Cb axis, which is about 20° in HSV. */
export const SKIN_HUE = 0.056;

/**
 * @typedef {{
 *   pixels: number,
 *   luma: { mean: number, median: number, low: number, high: number },
 *   clipped: number, crushed: number,
 *   white: { kelvin: number, tint: number, from: 'neutrals' | 'brightest', share: number, rgb: number[] },
 *   skin: { share: number, hue: number | null, offset: number | null },
 *   saturation: { mean: number, high: number },
 *   contrast: number,
 * }} Measure
 */

/** D65's own distance from the Planckian locus: a picture whose greys are D65 has no tint. */
const D65_DUV = temperatureOf(D65).duv;
/** Tint as a grade's `tint` counts it (0.0002 Δuv a step), so a measured tint set as the grade's tint takes it away. */
const TINT_STEP = 0.0002;

const pct = (/** @type {Float32Array} */ sorted, /** @type {number} */ p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];

/**
 * A picture measured: `rgb` its pixels, three values each (0–1, as shown).
 * @param {Float32Array | number[]} rgb @returns {Measure}
 */
export function measure(rgb) {
  const n = Math.floor(rgb.length / 3);
  const lumas = new Float32Array(n);
  const sats = new Float32Array(n);
  let sum = 0, clipped = 0, crushed = 0, satSum = 0;
  /* sums of linear light, of all pixels and of those nearly grey (and lit well enough to tell) */
  const all = [0, 0, 0], grey = [0, 0, 0];
  let greys = 0, skins = 0;
  const skinHues = [];
  for (let i = 0; i < n; i++) {
    const r = rgb[3 * i], g = rgb[3 * i + 1], b = rgb[3 * i + 2];
    const y = L[0] * r + L[1] * g + L[2] * b;
    lumas[i] = y; sum += y;
    if (Math.max(r, g, b) >= 0.995) clipped++;
    if (Math.max(r, g, b) <= 0.01) crushed++;
    const [h, s] = hsv(r, g, b);
    sats[i] = s; satSum += s;
    const lin = [bt1886.decode(r), bt1886.decode(g), bt1886.decode(b)];
    all[0] += lin[0]; all[1] += lin[1]; all[2] += lin[2];
    if (s < 0.22 && y > 0.18 && y < 0.92) { grey[0] += lin[0]; grey[1] += lin[1]; grey[2] += lin[2]; greys++; }
    /* skin: orange hues, moderately saturated, neither dark nor blown */
    const dh = Math.abs(((h - SKIN_HUE + 1.5) % 1) - 0.5);
    if (dh < 0.06 && s > 0.15 && s < 0.7 && y > 0.2 && y < 0.9) { skins++; skinHues.push(h); }
  }
  const fromGrey = greys >= n * 0.01;
  /* little that is grey: the brightest 3 % that is not clipped is taken for white (clouds, sails, a shirt), as a
     colorist reads a shot with a cast too strong for anything in it to look grey */
  const sumLin = fromGrey ? grey : brightest(rgb, lumas, n);
  lumas.sort(); sats.sort();
  const xyz = [0, 1, 2].map((k) => TO_XYZ[k][0] * sumLin[0] + TO_XYZ[k][1] * sumLin[1] + TO_XYZ[k][2] * sumLin[2]);
  const t = xyz[0] + xyz[1] + xyz[2];
  const cct = t > 0 ? temperatureOf([xyz[0] / t, xyz[1] / t]) : { kelvin: 6500, duv: 0 };
  /* the skin hues' circular mean, against the skin line */
  let skinHue = null;
  if (skinHues.length) {
    let sx = 0, sy = 0;
    for (const h of skinHues) { sx += Math.cos(2 * Math.PI * h); sy += Math.sin(2 * Math.PI * h); }
    skinHue = ((Math.atan2(sy, sx) / (2 * Math.PI)) + 1) % 1;
  }
  return {
    pixels: n,
    luma: { mean: n ? sum / n : 0, median: pct(lumas, 0.5), low: pct(lumas, 0.02), high: pct(lumas, 0.98) },
    clipped: n ? clipped / n : 0, crushed: n ? crushed / n : 0,
    white: { kelvin: cct.kelvin, tint: Math.round((cct.duv - D65_DUV) / TINT_STEP), from: fromGrey ? 'neutrals' : 'brightest', share: n ? greys / n : 0,
      rgb: sumLin[1] > 0 ? sumLin.map((v) => v / sumLin[1]) : [1, 1, 1] },
    skin: { share: n ? skins / n : 0, hue: skinHue, offset: skinHue === null ? null : Math.round((((skinHue - SKIN_HUE + 1.5) % 1) - 0.5) * 3600) / 10 },
    saturation: { mean: n ? satSum / n : 0, high: pct(sats, 0.95) },
    contrast: pct(lumas, 0.98) - pct(lumas, 0.02),
  };
}

/**
 * The light of a picture's brightest 3 % that is not clipped, summed (linear, red, green, blue): what a shot with
 * nothing grey in it takes for white. @param {Float32Array | number[]} rgb @param {Float32Array} lumas @param {number} n
 */
function brightest(rgb, lumas, n) {
  const order = [];
  for (let i = 0; i < n; i++) if (Math.max(rgb[3 * i], rgb[3 * i + 1], rgb[3 * i + 2]) < 0.985) order.push(i);
  order.sort((a, b) => lumas[b] - lumas[a]);
  const sum = [0, 0, 0];
  for (const i of order.slice(0, Math.max(1, Math.round(order.length * 0.03)))) for (let k = 0; k < 3; k++) sum[k] += bt1886.decode(rgb[3 * i + k]);
  return sum;
}

/** IRE (0–100) of a 0–1 value, as scopes read it. */
export const ire = (/** @type {number} */ v) => Math.round(v * 1000) / 10;

/** Hue, saturation and value of a color (0–1 each), hue from red. @param {number} r @param {number} g @param {number} b @returns {[number, number, number]} */
function hsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
  let h = 0;
  if (c > 1e-9) h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
  return [((h / 6) % 1 + 1) % 1, max > 1e-9 ? c / max : 0, max];
}
