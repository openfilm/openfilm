// @ts-check
/**
 * What a person sets by hand on a video clip's color, as operations of its own layer (`looks/shot-<id>.ctf`,
 * chain.mjs): seven sliders, as the inspector shows them and an agent reads them, each 0 when untouched.
 *
 *   temperature, tint   -100…100   white balance: warmer (red up, blue down), more magenta (green down)
 *   exposure            -4…4 stops
 *   contrast            -100…100   about mid grey
 *   highlights, shadows -100…100   the bright and the dark parts brighter or darker
 *   saturation          -100…100   -100 is black and white
 *
 * They are two standard operations in the working space (ACEScct), named so they are found again: a GradingPrimary
 * `adjust` (white balance and exposure as its brightness, contrast, saturation) and a GradingTone `adjust-tone`
 * (highlights, shadows). Whatever else those operations hold, written by an agent or another program, is kept as it is:
 * reading and writing back changes only what a slider says.
 *
 * And the library's filters as files: a filter is a channel mix, a saturation and a tone curve per channel on the
 * picture as shown (library/catalogs/filters.json `grade`), so it is a color transform made for the screen
 * (`looks/filter-<name>-<strength>.ctf`) that goes after a clip's output, last (chain.mjs `after`). Its three
 * operations are those an SVG filter draws exactly (Matrix, ASC_CDL saturation, LUT1D), so a filter layer, drawn by the
 * browser over every layer under it, shows the same grade from the same file.
 *
 * Pure: no files, no DOM; Studio's inspector and the color plugin's commands both use it.
 */
import { parseCtf } from './ctf.mjs';
import { elementsOf, hueCurveXml, newCtf, primaryXml, rgbCurveXml, setOp, toneXml } from './edit.mjs';
import { HUE_CURVE_SPLINE, isIdentityCurve } from './bspline.mjs';

/** @typedef {'temperature' | 'tint' | 'exposure' | 'contrast' | 'highlights' | 'shadows' | 'saturation'} AdjustKey */
/** @typedef {Record<AdjustKey, number>} Adjust */

/** The sliders, in the order they are shown: white balance, then light, then color. */
export const ADJUST_KEYS = /** @type {readonly AdjustKey[]} */ (['temperature', 'tint', 'exposure', 'contrast', 'highlights', 'shadows', 'saturation']);

/** Each slider's range and step. */
export const ADJUST_RANGE = /** @type {Record<AdjustKey, { min: number, max: number, step: number }>} */ ({
  temperature: { min: -100, max: 100, step: 1 },
  tint: { min: -100, max: 100, step: 1 },
  exposure: { min: -4, max: 4, step: 0.05 },
  contrast: { min: -100, max: 100, step: 1 },
  highlights: { min: -100, max: 100, step: 1 },
  shadows: { min: -100, max: 100, step: 1 },
  saturation: { min: -100, max: 100, step: 1 },
});

export const ADJUST_OP = 'adjust';
export const TONE_OP = 'adjust-tone';

/** A GradingPrimary's (log) brightness unit: 1023 / 6.25 of them are one ACEScct code, 17.52 codes a stop. */
const PER_STOP = 1023 / 6.25 / 17.52;
/** Stops red and blue move apart at temperature 100 (each), and green at tint 100. */
const WARM_STOPS = 0.4, TINT_STOPS = 0.3;
/** Contrast 100 is ×2^0.6 about mid grey; a tone zone ±100 is its value 1 ± 0.9. */
const CONTRAST_LOG2 = 0.6, TONE = 0.9;

const round = (/** @type {number} */ v, /** @type {number} */ k = 1000) => Math.round(v * k) / k;
const NONE = /** @type {Adjust} */ (Object.fromEntries(ADJUST_KEYS.map((k) => [k, 0])));

/** One named operation of a layer, read (null: none, or not one it can read). @param {string} text @param {string} name */
function opNamed(text, name) {
  const el = elementsOf(text).find((e) => e.name === name);
  if (!el) return null;
  try {
    return parseCtf(`<ProcessList version="2.5" id="x">${text.slice(el.from, el.to)}</ProcessList>`)[0] ?? null;
  } catch { return null; }
}

/** The sliders a layer's text says (each 0 when it has nothing of it; no text: all 0). @param {string | null | undefined} text @returns {Adjust} */
export function adjustOf(text) {
  if (!text) return { ...NONE };
  const p = opNamed(text, ADJUST_OP), t = opNamed(text, TONE_OP);
  const out = { ...NONE };
  if (p?.type === 'gradingPrimary' && p.style === 'log') {
    const { r, g, b, m } = p.brightness;
    /* any brightness is a part common to all three (exposure), red against blue (temperature) and green against
       their middle (tint): read whole, written back whole */
    const common = (r + b) / 2;
    out.exposure = round((m + common) / PER_STOP, 100);
    out.temperature = round((r - b) / 2 / (WARM_STOPS * PER_STOP) * 100, 10);
    out.tint = round((common - g) / (TINT_STOPS * PER_STOP) * 100, 10);
    out.contrast = round(Math.log2(p.contrast.m) / CONTRAST_LOG2 * 100, 10);
    out.saturation = round((p.saturation - 1) * 100, 10);
  }
  if (t?.type === 'gradingTone' && t.style === 'log') {
    out.highlights = round((t.highlights.m - 1) / TONE * 100, 10);
    out.shadows = round((t.shadows.m - 1) / TONE * 100, 10);
  }
  return out;
}

/** Whether nothing is set. @param {Partial<Adjust>} a */
export const isNeutral = (a) => ADJUST_KEYS.every((k) => !a[k]);

/**
 * A layer's text with the sliders `set` (the rest as they were): its two operations rewritten, taken out when they
 * change nothing, everything else in the file as it was. `text` null: a new layer named `id`.
 * @param {string | null | undefined} text @param {Partial<Adjust>} set @param {string} [id]
 */
export function withAdjust(text, set, id = 'shot') {
  const now = { ...adjustOf(text), ...set };
  let out = text ?? newCtf(id);
  const p = text ? opNamed(text, ADJUST_OP) : null;
  const was = p?.type === 'gradingPrimary' && p.style === 'log' ? p : null;
  const warm = now.temperature / 100 * WARM_STOPS * PER_STOP, green = -now.tint / 100 * TINT_STOPS * PER_STOP;
  const primary = {
    brightness: { r: round(warm, 1e5), g: round(green, 1e5), b: round(-warm, 1e5), m: round(now.exposure * PER_STOP, 1e5) },
    contrast: { ...(was?.contrast ?? { r: 1, g: 1, b: 1 }), m: round(2 ** (now.contrast / 100 * CONTRAST_LOG2), 1e5) },
    gamma: was?.gamma ?? { r: 1, g: 1, b: 1, m: 1 },
    saturation: round(1 + now.saturation / 100, 1e5),
    pivot: was?.pivot ?? -0.2,
  };
  const plain = !now.temperature && !now.tint && !now.exposure && !now.contrast && !now.saturation
    && ['r', 'g', 'b'].every((c) => primary.contrast[/** @type {'r'} */ (c)] === 1) && Object.values(primary.gamma).every((v) => v === 1);
  out = setOp(out, ADJUST_OP, plain ? null : primaryXml(ADJUST_OP, primary));
  const t = text ? opNamed(text, TONE_OP) : null;
  const tone = t?.type === 'gradingTone' && t.style === 'log' ? t : null;
  /* its other zones, and where these two start and how wide they are, as they were (OpenColorIO's defaults: none) */
  const zones = {
    ...(tone ? { blacks: tone.blacks, midtones: tone.midtones, whites: tone.whites, scontrast: tone.scontrast } : {}),
    highlights: { ...(tone?.highlights ?? { r: 1, g: 1, b: 1 }), m: round(1 + now.highlights / 100 * TONE, 1e5) },
    shadows: { ...(tone?.shadows ?? { r: 1, g: 1, b: 1 }), m: round(1 + now.shadows / 100 * TONE, 1e5) },
  };
  const written = toneXml(TONE_OP, zones);
  out = setOp(out, TONE_OP, /<(Blacks|Shadows|Midtones|Highlights|Whites|SContrast)\b/.test(written) ? written : null);
  return out;
}

/* ───────────── wheels and curves ───────────── */

/**
 * A layer's color wheels: the shadows, the midtones and the highlights of its `adjust-tone`, each a gain on red, green,
 * blue and all three (`m`, the wheel's ring: the highlights and shadows sliders are the same), 1 as it is. A colorist's
 * log wheels, in ACEScct (OpenColorIO's GradingTone, log style).
 * @typedef {{ r: number, g: number, b: number, m: number }} Wheel
 * @typedef {'shadows' | 'midtones' | 'highlights'} Zone
 */
export const ZONES = /** @type {readonly Zone[]} */ (['shadows', 'midtones', 'highlights']);
const PLAIN_WHEEL = { r: 1, g: 1, b: 1, m: 1 };

/** A layer's wheels (each as it is when it has none). @param {string | null | undefined} text @returns {Record<Zone, Wheel>} */
export function wheelsOf(text) {
  const t = text ? opNamed(text, TONE_OP) : null;
  const tone = t?.type === 'gradingTone' && t.style === 'log' ? t : null;
  return /** @type {Record<Zone, Wheel>} */ (Object.fromEntries(ZONES.map((z) => {
    const w = tone?.[z];
    return [z, w ? { r: round(w.r, 1e5), g: round(w.g, 1e5), b: round(w.b, 1e5), m: round(w.m, 1e5) } : { ...PLAIN_WHEEL }];
  })));
}

/**
 * A layer's text with wheels `set` (the rest as they were: its other zones, where each starts and how wide it is).
 * @param {string | null | undefined} text @param {Partial<Record<Zone, Wheel>>} set @param {string} [id]
 */
export function withWheels(text, set, id = 'shot') {
  const out = text ?? newCtf(id);
  const t = text ? opNamed(text, TONE_OP) : null;
  const tone = t?.type === 'gradingTone' && t.style === 'log' ? t : null;
  const zones = { ...(tone ? { blacks: tone.blacks, midtones: tone.midtones, whites: tone.whites, highlights: tone.highlights, shadows: tone.shadows, scontrast: tone.scontrast } : {}) };
  for (const z of ZONES) {
    const w = set[z];
    if (w) zones[z] = { ...(tone?.[z] ?? {}), r: round(w.r, 1e5), g: round(w.g, 1e5), b: round(w.b, 1e5), m: round(w.m, 1e5) };
  }
  const written = toneXml(TONE_OP, zones);
  return setOp(out, TONE_OP, /<(Blacks|Shadows|Midtones|Highlights|Whites|SContrast)\b/.test(written) ? written : null);
}

/** A wheel's color as its puck shows it: which way (hue, 0–1 round from red) and how far (0–1), and back. */
export const wheelColor = (/** @type {Wheel} */ w) => {
  const mean = (w.r + w.g + w.b) / 3;
  /* red, green and blue as the three axes of the color plane, 120° apart */
  const x = (w.r - mean) - (w.g - mean) / 2 - (w.b - mean) / 2, y = (Math.sqrt(3) / 2) * ((w.g - mean) - (w.b - mean));
  const far = Math.min(1, Math.hypot(x, y) / WHEEL_REACH);
  return { hue: far ? ((Math.atan2(y, x) / (2 * Math.PI)) + 1) % 1 : 0, far };
};
/** How far apart red, green and blue are at the wheel's edge. */
const WHEEL_REACH = 0.3;
/** A wheel with its puck at `hue`, `far` (its ring as it was). @param {Wheel} w @param {number} hue @param {number} far */
export function wheelAt(w, hue, far) {
  const a = hue * 2 * Math.PI, d = Math.min(1, Math.max(0, far)) * WHEEL_REACH * (2 / 3);
  const mean = (w.r + w.g + w.b) / 3;
  const c = [Math.cos(a), Math.cos(a - (2 * Math.PI) / 3), Math.cos(a + (2 * Math.PI) / 3)].map((v) => round(Math.min(1.99, Math.max(0.01, mean + v * d)), 1e5));
  return { r: c[0], g: c[1], b: c[2], m: w.m };
}

export const CURVES_OP = 'curves';
export const HUE_OP = 'hue-curves';
/** @typedef {[number, number][]} Points */
/** @typedef {'master' | 'red' | 'green' | 'blue'} RgbCurve */
/** @typedef {'hueHue' | 'hueSat' | 'hueLum' | 'lumSat' | 'satSat'} HueCurve */
export const RGB_CURVES = /** @type {readonly RgbCurve[]} */ (['master', 'red', 'green', 'blue']);
export const HUE_CURVES = /** @type {readonly HueCurve[]} */ (['hueHue', 'hueSat', 'hueLum', 'lumSat', 'satSat']);
const SIXTHS = [0, 1 / 6, 2 / 6, 0.5, 4 / 6, 5 / 6];
/** Each curve as it is when it changes nothing (OpenColorIO's own, log style). */
export const PLAIN_CURVE = /** @type {Record<RgbCurve | HueCurve, Points>} */ ({
  master: [[0, 0], [0.5, 0.5], [1, 1]], red: [[0, 0], [0.5, 0.5], [1, 1]], green: [[0, 0], [0.5, 0.5], [1, 1]], blue: [[0, 0], [0.5, 0.5], [1, 1]],
  hueHue: SIXTHS.map((x) => [x, x]), hueSat: SIXTHS.map((x) => [x, 1]), hueLum: SIXTHS.map((x) => [x, 1]),
  lumSat: [[0, 1], [0.5, 1], [1, 1]], satSat: [[0, 0], [0.5, 0.5], [1, 1]],
});
const pts = (/** @type {{ points: number[][] } | undefined} */ c, /** @type {Points} */ plain) => /** @type {Points} */ (c ? c.points.map(([x, y]) => [round(x, 1e5), round(y, 1e5)]) : plain.map((p) => [...p]));

/** A layer's RGB curves (ACEScct, x and y 0–1). @param {string | null | undefined} text @returns {Record<RgbCurve, Points>} */
export function curvesOf(text) {
  const o = text ? opNamed(text, CURVES_OP) : null;
  const op = o?.type === 'gradingRGBCurve' && o.style === 'log' ? o : null;
  return /** @type {Record<RgbCurve, Points>} */ (Object.fromEntries(RGB_CURVES.map((k) => [k, pts(op?.[k], PLAIN_CURVE[k])])));
}
/** A layer's text with RGB curves `set` (the others as they were); none bent: the operation taken out. @param {string | null | undefined} text @param {Partial<Record<RgbCurve, Points>>} set @param {string} [id] */
export function withCurves(text, set, id = 'shot') {
  const all = { ...curvesOf(text), ...set };
  const bent = RGB_CURVES.filter((k) => !isIdentityCurve({ points: all[k], slopes: all[k].map(() => 0) }, 'rgb'));
  return setOp(text ?? newCtf(id), CURVES_OP, bent.length ? rgbCurveXml(CURVES_OP, Object.fromEntries(bent.map((k) => [k, { points: all[k] }]))) : null);
}

/** A layer's hue curves (x and y 0–1; hue round from magenta, as OpenColorIO's). @param {string | null | undefined} text @returns {Record<HueCurve, Points>} */
export function hueCurvesOf(text) {
  const o = text ? opNamed(text, HUE_OP) : null;
  const op = o?.type === 'gradingHueCurve' && o.style === 'log' ? o : null;
  return /** @type {Record<HueCurve, Points>} */ (Object.fromEntries(HUE_CURVES.map((k) => [k, pts(op?.[k], PLAIN_CURVE[k])])));
}
/** A layer's text with hue curves `set`; none bent: the operation taken out. @param {string | null | undefined} text @param {Partial<Record<HueCurve, Points>>} set @param {string} [id] */
export function withHueCurves(text, set, id = 'shot') {
  const all = { ...hueCurvesOf(text), ...set };
  const bent = HUE_CURVES.filter((k) => !isIdentityCurve({ points: all[k], slopes: all[k].map(() => 0) }, HUE_CURVE_SPLINE[k]));
  return setOp(text ?? newCtf(id), HUE_OP, bent.length ? hueCurveXml(HUE_OP, Object.fromEntries(bent.map((k) => [k, { points: all[k] }]))) : null);
}

/** Whether a layer changes nothing: no operation in it. @param {string | null | undefined} text */
export const isEmptyLayer = (text) => !text || elementsOf(text).length === 0;

/* ───────────── the library's filters as files ───────────── */

/** A filter's grade as the library writes it: tables are tone curves, outputs 0–1 over even inputs. */
/** @typedef {{ mix?: number[], sat?: number, all?: number[], r?: number[], g?: number[], b?: number[] }} FilterGrade */

const FILTER = /^filter-(.+)-(\d{1,3})\.ctf$/;
const SAMPLES = 17;
const IDENTITY_MIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const lerp = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ k) => a + (b - a) * k;
const clamp01 = (/** @type {number} */ v) => Math.min(1, Math.max(0, v));

/** A library id's part in a file name: `filters/teal-orange` → `teal-orange`. @param {string} id */
export const filterSlug = (id) => id.replace(/^filters\//, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');

/** The file a filter at `amount` (0–1) is: `looks/filter-teal-orange-80.ctf`. @param {string} id @param {number} amount */
export const filterUrl = (id, amount) => `looks/filter-${filterSlug(id)}-${Math.round(clamp01(amount) * 100)}.ctf`;

/** Which filter a file of a chain is, and how strong; null: not a filter's. @param {string} url */
export function filterOfUrl(url) {
  const m = FILTER.exec(url.split(/[?#]/)[0].split('/').pop() ?? '');
  return m ? { slug: m[1], amount: Number(m[2]) / 100 } : null;
}

/** A curve's value at x (0–1), straight between its points. @param {readonly number[] | undefined} table @param {number} x */
function at(table, x) {
  if (!table?.length) return x;
  if (table.length === 1) return table[0];
  const p = clamp01(x) * (table.length - 1);
  const i = Math.min(table.length - 2, Math.floor(p));
  return lerp(table[i], table[i + 1], p - i);
}

/**
 * A filter's grade at `amount` (0–1), as the library's SVG filter draws it (studio/ui lib/grade): its channel mix,
 * saturation and curves each taken that far from leaving the picture as it is.
 * @param {FilterGrade} grade @param {number} amount
 */
export function filterAt(grade, amount) {
  const k = clamp01(amount);
  const mix = grade.mix?.length === 12 ? grade.mix.map((v, i) => round(lerp(IDENTITY_MIX[i], v, k))) : null;
  const sat = grade.sat != null && grade.sat !== 1 ? round(lerp(1, grade.sat, k)) : 1;
  const curve = (/** @type {number[] | undefined} */ own) => Array.from({ length: SAMPLES }, (_, i) => {
    const x = i / (SAMPLES - 1);
    return round(clamp01(lerp(x, at(own, at(grade.all, x)), k)));
  });
  const curves = grade.all || grade.r || grade.g || grade.b ? { r: curve(grade.r), g: curve(grade.g), b: curve(grade.b) } : null;
  return { mix, sat, curves };
}

/**
 * A filter's file: a color transform made for the screen, of the three operations an SVG filter draws exactly (a
 * matrix with its offsets, the ASC CDL's saturation, clamped, and a 1D LUT a channel).
 * @param {string} id the library's id @param {string} title @param {FilterGrade} grade @param {number} amount
 */
export function filterCtf(id, title, grade, amount) {
  const f = filterAt(grade, amount);
  const esc = (/** @type {string} */ s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const ops = [];
  if (f.mix) {
    ops.push(`    <Matrix name="mix" inBitDepth="32f" outBitDepth="32f">
        <Array dim="3 4">${f.mix.join(' ')}</Array>
    </Matrix>`);
  }
  ops.push(`    <ASC_CDL name="saturation" inBitDepth="32f" outBitDepth="32f" style="Fwd">
        <SOPNode><Slope>1 1 1</Slope><Offset>0 0 0</Offset><Power>1 1 1</Power></SOPNode>
        <SatNode><Saturation>${f.sat}</Saturation></SatNode>
    </ASC_CDL>`);
  const curves = f.curves;
  if (curves) {
    const rows = Array.from({ length: SAMPLES }, (_, i) => `${curves.r[i]} ${curves.g[i]} ${curves.b[i]}`);
    ops.push(`    <LUT1D name="curves" inBitDepth="32f" outBitDepth="32f" interpolation="linear">
        <Array dim="${SAMPLES} 3">
${rows.map((r) => `            ${r}`).join('\n')}
        </Array>
    </LUT1D>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<ProcessList version="2.5" id="${esc(id)}" name="${esc(title)}">
    <Description>${esc(title)}, ${Math.round(clamp01(amount) * 100)} %: OpenFilm's library filter ${esc(id)}, made for the screen (after a clip's output)</Description>
${ops.join('\n')}
</ProcessList>
`;
}
