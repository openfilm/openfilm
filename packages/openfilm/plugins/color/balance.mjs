// @ts-check
/**
 * Grades found from the picture, as a colorist starts a shot: balanced (its greys made grey, its middle at a usual
 * exposure) or matched to another shot (the same white, exposure and saturation as it measures). Each is a grade
 * returned, not written: the workbench shows it to take or leave, `openfilm color auto` and `match` write it.
 *
 * Pictures are a clip's frames read at the footage's depth (project.mjs frameOf), graded by the grade's own function
 * (engine/grade.mjs compile), and measured as shown (engine/measure.mjs), a few times over, each time closer.
 */
import { bt1886 } from './engine/math.mjs';
import { compile, normalize } from './engine/grade.mjs';
import { measure } from './engine/measure.mjs';
import { frameOf, gradeOf, lutsOfGrade, timingOf } from './project.mjs';

/** @typedef {import('./engine/grade.mjs').Grade} Grade @typedef {import('./engine/measure.mjs').Measure} Measure */
/** @typedef {Record<string, import('./engine/cube.mjs').Lut>} Luts @typedef {import('../../src/film-doc.mjs').FilmClip} FilmClip */

/**
 * The middles (median luma, as shown) a scene is usually exposed between, 33 to 52 IRE: a picture's middle inside them
 * is left as it is, one outside brought to MIDDLE. Never brighter than keeps its brightest 2 % below HEADROOM.
 */
export const MIDDLES = /** @type {[number, number]} */ ([0.33, 0.52]);
export const MIDDLE = 0.42;
export const HEADROOM = 0.94;
const mired = (/** @type {number} */ k) => 1e6 / k;
const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.min(hi, Math.max(lo, v));

/**
 * A clip's pictures, several moments of it joined (a quarter, the middle and three quarters of the way through), as
 * footage code values: what a grade is measured on. @param {string} root @param {FilmClip} clip
 */
export async function picturesOf(root, clip, width = 320) {
  const { file } = await gradeOf(root, clip);
  const t = timingOf(clip);
  const from = clip.time?.[0] ?? 0, length = t.end === null ? null : (t.end - t.at) * (clip.speed ?? 1);
  const moments = length === null ? [from] : [0.25, 0.5, 0.75].map((f) => from + length * f);
  const frames = await Promise.all(moments.map((s) => frameOf(file, s, { width })));
  const rgb = new Float32Array(frames.reduce((n, f) => n + f.rgb.length, 0));
  let at = 0;
  for (const f of frames) { rgb.set(f.rgb, at); at += f.rgb.length; }
  return rgb;
}

/** Footage graded and measured as shown. @param {Float32Array} rgb @param {Grade} g @param {Luts} [luts] */
export function measureGraded(rgb, g, luts = {}) {
  const f = compile(g, luts);
  const out = new Float32Array(rgb.length);
  for (let i = 0; i < rgb.length; i += 3) {
    const o = f(rgb[i], rgb[i + 1], rgb[i + 2]);
    out[i] = o[0]; out[i + 1] = o[1]; out[i + 2] = o[2];
  }
  return measure(out);
}

/**
 * A grade balanced: white and tint so its near-greys are grey, exposure so its middle is in MIDDLES (less where that
 * would push what is bright past HEADROOM). Everything else of `g` is kept. `luts`: the grade's LUT files, read.
 * @param {Float32Array} rgb @param {Grade} g @param {Luts} [luts]
 * @returns {{ grade: Grade, before: Measure, after: Measure }}
 */
export function balance(rgb, g, luts = {}) {
  const before = measureGraded(rgb, g, luts);
  let grade = normalize({ ...g, white: 6500, tint: 0, exposure: 0 });
  let m = measureGraded(rgb, grade, luts);
  for (let i = 0; i < 4; i++) {
    /* a cast is read from what is nearly grey; with little grey, from the whole picture, and only half trusted */
    const trust = m.white.from === 'neutrals' ? 1 : 0.5;
    const white = 1e6 / (mired(grade.white) + (mired(m.white.kelvin) - mired(6500)) * trust);
    const tint = grade.tint + m.white.tint * trust;
    const mid = m.luma.median;
    const want = mid >= MIDDLES[0] && mid <= MIDDLES[1] ? 0 : Math.log2(bt1886.decode(MIDDLE) / Math.max(bt1886.decode(mid), 1e-4));
    const room = Math.log2(bt1886.decode(HEADROOM) / Math.max(bt1886.decode(m.luma.high), 1e-4));
    const exposure = grade.exposure + clamp(want > 0 ? Math.min(want, Math.max(room, 0)) : want, -1.5, 1.5);
    grade = normalize({ ...grade, white: clamp(white, 2000, 15000), tint: clamp(tint, -100, 100), exposure: clamp(exposure, -4, 4) });
    m = measureGraded(rgb, grade, luts);
  }
  return { grade: rounded(grade), before, after: m };
}

/**
 * A grade matched to another picture's: the same white and tint (as their near-greys read), the same middle and the
 * same mean saturation. Everything else of `g` is kept. `to`: the other clip's pictures, graded by `toGrade`.
 * @param {Float32Array} rgb @param {Grade} g @param {Float32Array} to @param {Grade} toGrade
 * @param {{ luts?: Luts, toLuts?: Luts }} [files]
 * @returns {{ grade: Grade, target: Measure, before: Measure, after: Measure }}
 */
export function match(rgb, g, to, toGrade, { luts = {}, toLuts = {} } = {}) {
  const target = measureGraded(to, toGrade, toLuts);
  const before = measureGraded(rgb, g, luts);
  let grade = g, m = before;
  for (let i = 0; i < 5; i++) {
    const white = 1e6 / (mired(grade.white) + (mired(m.white.kelvin) - mired(target.white.kelvin)));
    const tint = grade.tint + (m.white.tint - target.white.tint);
    const exposure = grade.exposure + Math.log2(Math.max(bt1886.decode(target.luma.median), 1e-4) / Math.max(bt1886.decode(m.luma.median), 1e-4));
    const saturation = grade.saturation * (m.saturation.mean > 0.02 ? clamp(target.saturation.mean / m.saturation.mean, 0.7, 1.4) : 1);
    grade = normalize({ ...grade, white: clamp(white, 2000, 15000), tint: clamp(tint, -100, 100), exposure: clamp(exposure, -4, 4), saturation: clamp(saturation, 0, 2) });
    m = measureGraded(rgb, grade, luts);
  }
  return { grade: rounded(grade), target, before, after: m };
}

/** A grade's amounts to the precision a person sets them to (a grade written to a file reads as typed). @param {Grade} g */
export function rounded(g) {
  const r = (/** @type {number} */ v, /** @type {number} */ step) => Math.round(v / step) * step;
  return normalize({ ...g, white: r(g.white, 10), tint: r(g.tint, 1), exposure: Number(r(g.exposure, 0.01).toFixed(2)), saturation: Number(r(g.saturation, 0.01).toFixed(2)) });
}

/** A clip's grade balanced, from its pictures. @param {string} root @param {FilmClip} clip */
export async function balanceClip(root, clip) {
  const { grade } = await gradeOf(root, clip);
  return balance(await picturesOf(root, clip), grade, lutsOfGrade(root, grade));
}

/** A clip's grade matched to another clip's. @param {string} root @param {FilmClip} clip @param {FilmClip} to */
export async function matchClip(root, clip, to) {
  const [{ grade }, { grade: toGrade }] = await Promise.all([gradeOf(root, clip), gradeOf(root, to)]);
  const [rgb, toRgb] = await Promise.all([picturesOf(root, clip), picturesOf(root, to)]);
  return match(rgb, grade, toRgb, toGrade, { luts: lutsOfGrade(root, grade), toLuts: lutsOfGrade(root, toGrade) });
}
