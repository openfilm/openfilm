// @ts-check
/**
 * What a picture's color is, in numbers a colorist reads off scopes: its exposure (luma's spread, in IRE, and what is
 * clipped or crushed), its white balance (the temperature and tint of what is nearly grey in it), skin (how far skin
 * tones are from the skin line: orange hues, which skin is among, as a vectorscope shows them, not people found), saturation
 * and contrast. Read from a picture as it is shown (BT.709 R'G'B', each 0–1,
 * as a graded copy plays), so the numbers are what the film shows.
 */
import { bt1886, D65, rgbToXYZ, SPACES, temperatureOf } from './math.mjs';
import { hsv } from './grade.mjs';

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
 *   white: { kelvin: number, tint: number, from: 'neutrals' | 'all', share: number },
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
  lumas.sort(); sats.sort();
  const fromGrey = greys >= n * 0.01;
  const sumLin = fromGrey ? grey : all;
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
    white: { kelvin: cct.kelvin, tint: Math.round((cct.duv - D65_DUV) / TINT_STEP), from: fromGrey ? 'neutrals' : 'all', share: n ? greys / n : 0 },
    skin: { share: n ? skins / n : 0, hue: skinHue, offset: skinHue === null ? null : Math.round((((skinHue - SKIN_HUE + 1.5) % 1) - 0.5) * 3600) / 10 },
    saturation: { mean: n ? satSum / n : 0, high: pct(sats, 0.95) },
    contrast: pct(lumas, 0.98) - pct(lumas, 0.02),
  };
}

/** IRE (0–100) of a 0–1 value, as scopes read it. */
export const ire = (/** @type {number} */ v) => Math.round(v * 1000) / 10;

/**
 * What a measure says to a person, a line each: the numbers, and `✗` / `!` / `✓` for what is wrong, worth watching or
 * right, as `look` commands print them.
 * @param {Measure} m @returns {string[]}
 */
export function verdicts(m) {
  const lines = [
    `exposure  median ${ire(m.luma.median)} IRE · shadows ${ire(m.luma.low)} · highlights ${ire(m.luma.high)} IRE`,
    `clipped ${(m.clipped * 100).toFixed(1)} % · crushed ${(m.crushed * 100).toFixed(1)} %`,
    `white balance  ${m.white.kelvin} K, tint ${m.white.tint > 0 ? '+' : ''}${m.white.tint} (${m.white.from === 'neutrals' ? `from ${(m.white.share * 100).toFixed(0)} % near-grey` : 'whole picture: little is grey'})`,
    `saturation  mean ${(m.saturation.mean * 100).toFixed(0)} %, 95th ${(m.saturation.high * 100).toFixed(0)} % · contrast ${ire(m.contrast)} IRE`,
  ];
  if (m.skin.share > 0.01 && m.skin.offset !== null) lines.push(`skin-tone hues  ${(m.skin.share * 100).toFixed(0)} % of the picture, ${m.skin.offset > 0 ? '+' : ''}${m.skin.offset}° from the skin line`);
  if (m.clipped > 0.02) lines.push(`✗ ${(m.clipped * 100).toFixed(1)} % of the picture is clipped white: bring the highlights or the gain down`);
  else if (m.luma.high > 0.97) lines.push('! the brightest parts touch 100 IRE');
  if (m.crushed > 0.05) lines.push(`✗ ${(m.crushed * 100).toFixed(1)} % of the picture is crushed black: lift the shadows`);
  if (m.luma.median < 0.2) lines.push('! dark: the middle of the picture is below 20 IRE');
  else if (m.luma.median > 0.7) lines.push('! bright: the middle of the picture is above 70 IRE');
  if (m.white.from === 'neutrals' && (Math.abs(m.white.kelvin - 6500) > 900 || Math.abs(m.white.tint) > 10)) {
    const cast = Math.abs(m.white.kelvin - 6500) > 900 ? (m.white.kelvin < 6500 ? 'warm' : 'cool') : m.white.tint > 0 ? 'green' : 'magenta';
    lines.push(`! near-grey reads ${m.white.kelvin} K, tint ${m.white.tint > 0 ? '+' : ''}${m.white.tint}: a ${cast} cast, unless it is meant (white ${m.white.kelvin} and tint ${m.white.tint} take it away)`);
  }
  if (m.skin.share > 0.01 && m.skin.offset !== null && Math.abs(m.skin.offset) > 6) lines.push(`! skin-tone hues sit ${Math.abs(m.skin.offset)}° ${m.skin.offset > 0 ? 'toward yellow' : 'toward red'} of the skin line: if they are people's skin, it reads ${m.skin.offset > 0 ? 'sallow' : 'flushed'} (wood, rust and sand share these hues and need nothing)`);
  if (m.saturation.high > 0.92) lines.push('! some colors are near full saturation: they may band or clip on export');
  if (m.luma.low > 0.06 && m.luma.high < 0.8 && m.contrast < 0.62 && m.saturation.mean < 0.22) lines.push('! flat and pale, as camera log footage looks: if it is log, grade it from its camera\'s log (its input)');
  if (!lines.some((l) => l.startsWith('✗') || l.startsWith('!'))) lines.push('✓ exposure, white balance and saturation are within the usual ranges');
  return lines;
}
