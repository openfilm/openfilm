// @ts-check
/**
 * A grade on a picture the browser draws: a page clip or a still graded by `--of-lut` (SPEC.md). Its picture is what
 * the screen shows already (sRGB), so the grade's input and output (`in-*`, `out-*`: a camera's footage into ACEScct
 * and ACEScct to the screen, chain.mjs) are not applied: its layers work in ACEScct as on a video, reached from the
 * picture by the sRGB curve and ACEScct's own (no change of primaries), and back; what comes after an output (a
 * filter, a LUT made for the screen) works on the picture as shown, as on a video.
 *
 * Drawn as an SVG filter (filterMarkup), the same in a preview and an export, both drawn by the browser: what a grade
 * does is put in steps, each a curve on each channel (feComponentTransfer, a table of 256) or a mix of the channels
 * (feColorMatrix), and the steps of OpenFilm's own operations are exact (a grading layer's sliders, wheels and curves,
 * a balance, a filter: curves per channel, and a saturation between them). One that mixes the channels otherwise (hue
 * curves, a 3D LUT, a film output) cannot be drawn so: it is left out, and said (`skipped`).
 *
 * The tables are 8-bit on the chip, so a curve's output between two mixes is stretched over its own range first and
 * the mix after it takes it back: a table keeps its 256 steps for the values it gives.
 */
import { parseColorTransform } from './ctf.mjs';
import { compile } from './ops.mjs';
import { roleOf } from './chain.mjs';

/** @typedef {import('./ctf.mjs').ColorOp} ColorOp */
/** @typedef {(v: Float64Array) => void} Step a change of an RGB triple, in place */
/** @typedef {{ kind: 'curve', f: Step } | { kind: 'mix', m: number[] }} Atom a curve on each channel, or a 3 × 4 mix (rows r, g, b: three weights and an offset) */
/** @typedef {{ kind: 'table', tables: [number[], number[], number[]] } | { kind: 'mix', m: number[] }} Stage a step of the filter: 256 values a channel (0–1 in, 0–1 out), or a mix of the channels (3 × 4) */

/** How many values a table has: one for each 8-bit input, so the browser's own table reads them with nothing between. */
export const TABLE = 256;

const LUMA = [0.2126, 0.7152, 0.0722];
const MAX = Number.MAX_VALUE;

/* the picture's values into ACEScct, and back */
const fromSrgb = (/** @type {number} */ v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (/** @type {number} */ v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const toCct = (/** @type {number} */ x) => (x <= 0.0078125 ? 10.5402377416545 * x + 0.0729055341958355 : (Math.log2(x) + 9.72) / 17.52);
const fromCct = (/** @type {number} */ y) => (y <= 0.155251141552511 ? (y - 0.0729055341958355) / 10.5402377416545 : 2 ** (y * 17.52 - 9.72));
const clamp01 = (/** @type {number} */ v) => (v > 0 ? (v < 1 ? v : 1) : 0);

/** A picture's values (as shown, sRGB) in ACEScct, where a grade's layers work on it: its own measure of a grade's working space. @param {number} r @param {number} g @param {number} b @param {number[]} out */
export const intoWorking = (r, g, b, out) => { out[0] = toCct(fromSrgb(clamp01(r))); out[1] = toCct(fromSrgb(clamp01(g))); out[2] = toCct(fromSrgb(clamp01(b))); };

/** @type {Atom} */
const INTO = { kind: 'curve', f: (v) => { for (let c = 0; c < 3; c++) v[c] = toCct(fromSrgb(clamp01(v[c]))); } };
/** @type {Atom} */
const OUT_OF = { kind: 'curve', f: (v) => { for (let c = 0; c < 3; c++) v[c] = toSrgb(Math.max(0, fromCct(v[c]))); } };

/** A saturation with Rec.709 luma (OCIO's) as a mix. @param {number} s @returns {Atom} */
const saturation = (s) => ({
  kind: 'mix',
  m: [0, 1, 2].flatMap((row) => [...LUMA.map((w, col) => (1 - s) * w + (row === col ? s : 0)), 0]),
});
/** A clamp of each channel. @param {number} lo @param {number} hi @returns {Atom} */
const clamp = (lo, hi) => ({ kind: 'curve', f: (v) => { for (let c = 0; c < 3; c++) v[c] = Math.min(Math.max(v[c], lo), hi); } });
/** An op as one curve on each channel (its own step). @param {ColorOp} op @returns {Atom} */
const curveOf = (op) => {
  const run = compile([op]);
  const out = [0, 0, 0];
  return { kind: 'curve', f: (v) => { run(v[0], v[1], v[2], out); v[0] = out[0]; v[1] = out[1]; v[2] = out[2]; } };
};

/** Whether an op changes each channel by itself alone: tried on values far apart. @param {ColorOp} op */
function onEachChannel(op) {
  const run = compile([op]);
  const a = [0, 0, 0], b = [0, 0, 0];
  const tries = [[0.1, 0.5, 0.9], [0.9, 0.2, 0.4], [0.3, 0.8, 0.05], [0.6, 0.6, 0.6], [0.02, 0.97, 0.5]];
  for (const [r, g, bl] of tries) {
    run(r, g, bl, a);
    for (const [c, x] of [[0, r], [1, g], [2, bl]]) {
      run(x, x, x, b);
      if (Math.abs(a[c] - b[c]) > 1e-6) return false;
    }
  }
  return true;
}

/**
 * An op as curves and mixes, in order; null when it mixes the channels in a way these cannot draw.
 * @param {ColorOp} op @returns {Atom[] | null}
 */
function atomsOf(op) {
  if (op.type === 'matrix') {
    const m = /** @type {number[]} */ (op.matrix), o = /** @type {number[]} */ (op.offset);
    return [{ kind: 'mix', m: [m[0], m[1], m[2], o[0], m[3], m[4], m[5], o[1], m[6], m[7], m[8], o[2]] }];
  }
  if (op.type === 'gradingPrimary' && op.saturation !== 1) {
    /* each channel moved, then the saturation, then the clamp (and the other way round when inverse) */
    const each = curveOf({ ...op, saturation: 1, clampBlack: -MAX, clampWhite: MAX });
    const lo = /** @type {number} */ (op.clampBlack), hi = /** @type {number} */ (op.clampWhite);
    if (op.inverse) return [clamp(lo, hi), saturation(1 / (op.saturation || 1)), each];
    return [each, saturation(/** @type {number} */ (op.saturation)), clamp(lo, hi)];
  }
  if (op.type === 'cdl' && op.saturation !== 1) {
    const clamps = op.style === 'Fwd' || op.style === 'Rev';
    const each = curveOf({ ...op, saturation: 1 });
    const sat = /** @type {number} */ (op.saturation);
    if (op.style === 'Rev' || op.style === 'RevNoClamp') {
      return [...(clamps ? [clamp(0, 1)] : []), saturation(1 / Math.max(Math.fround(sat), Math.fround(1e-2))), each];
    }
    return [each, saturation(sat), ...(clamps ? [clamp(0, 1)] : [])];
  }
  return onEachChannel(op) ? [curveOf(op)] : null;
}

/** Whether a grade's file is left out on a page or a still (a footage's input, an output): it need not be read. @param {string} name */
export const leftOut = (name) => { const role = roleOf(name); return role === 'input' || role === 'output'; };

/**
 * The steps of a page's or a still's grade: `files` its `--of-lut` files in order, each its path (or url) and text.
 * Null when it changes nothing; `skipped`, the names of the operations left out (none drawn so), with the files.
 * @param {readonly { name: string, text: string }[]} files
 * @returns {{ stages: Stage[], skipped: string[] } | null}
 */
export function pageStages(files) {
  /** @type {Atom[]} */
  const atoms = [];
  /** @type {string[]} */
  const skipped = [];
  let inCct = false;
  for (const { name, text } of files) {
    const role = roleOf(name);
    if (leftOut(name)) continue;
    const ops = parseColorTransform(text, name);
    /* a layer works in ACEScct, what is made for the screen on the picture as shown */
    if ((role === 'layer') !== inCct && ops.length) { atoms.push(inCct ? OUT_OF : INTO); inCct = !inCct; }
    for (const op of ops) {
      const a = atomsOf(op);
      if (a) atoms.push(...a);
      else skipped.push(`${name.split('/').pop()}: ${op.type}`);
    }
  }
  if (inCct) atoms.push(OUT_OF);
  atoms.push(clamp(0, 1));
  const stages = stagesOf(atoms);
  const plain = stages.length === 1 && stages[0].kind === 'table' && stages[0].tables.every((t) => t.every((v, i) => Math.abs(v - i / (TABLE - 1)) < 0.5 / 255));
  return plain && !skipped.length ? null : { stages: plain ? [] : stages, skipped };
}

/** Two mixes as one: `b` after `a`. @param {number[]} a @param {number[]} b */
function mixAfter(a, b) {
  const out = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let s = c === 3 ? b[r * 4 + 3] : 0;
      for (let k = 0; k < 3; k++) s += b[r * 4 + k] * a[k * 4 + c];
      out.push(s);
    }
  }
  return out;
}

/**
 * Atoms as stages: the curves between two mixes made one table each (its output stretched over its own range, the mix
 * after it taking that back, and the table after a mix reading the mix's range), the mixes between two curves one.
 * Starts and ends with a table. @param {Atom[]} atoms @returns {Stage[]}
 */
function stagesOf(atoms) {
  /** @type {({ kind: 'curve', f: Step } | { kind: 'mix', m: number[] })[]} */
  const runs = [];
  for (const a of atoms) {
    const last = runs.at(-1);
    if (a.kind === 'curve') {
      if (last?.kind === 'curve') { const prev = last.f; const next = a.f; last.f = (v) => { prev(v); next(v); }; }
      else runs.push({ kind: 'curve', f: a.f });
    } else if (last?.kind === 'mix') last.m = mixAfter(last.m, a.m);
    else runs.push({ kind: 'mix', m: [...a.m] });
  }
  if (runs[0]?.kind !== 'curve') runs.unshift({ kind: 'curve', f: () => {} });
  if (runs.at(-1)?.kind !== 'curve') { const held = /** @type {{ f: Step }} */ (clamp(0, 1)); runs.push({ kind: 'curve', f: held.f }); }
  /* each table reads 0–1: the first the picture, the others a mix's output over [lo, hi] a channel */
  /** @type {[number, number][]} */
  let inRange = [[0, 1], [0, 1], [0, 1]];
  /** @type {Stage[]} */
  const stages = [];
  const v = new Float64Array(3);
  for (let i = 0; i < runs.length; i += 2) {
    const run = /** @type {{ f: Step }} */ (runs[i]);
    const last = i === runs.length - 1;
    /* the curve's values a channel, read at the 256 inputs */
    const raw = [0, 1, 2].map((c) => {
      const [lo, hi] = inRange[c];
      return Array.from({ length: TABLE }, (_, k) => { const x = lo + (hi - lo) * k / (TABLE - 1); v[0] = v[1] = v[2] = x; run.f(v); return v[c]; });
    });
    /* stretched over its own range (the last is the picture: 0–1 as it is) */
    /** @type {[number, number][]} */
    const outRange = raw.map((t) => { if (last) return [0, 1]; const lo = Math.min(...t), hi = Math.max(...t); return [lo, hi - lo < 1e-6 ? lo + 1e-6 : hi]; });
    stages.push({ kind: 'table', tables: /** @type {[number[], number[], number[]]} */ (raw.map((t, c) => t.map((x) => clamp01((x - outRange[c][0]) / (outRange[c][1] - outRange[c][0]))))) });
    if (last) break;
    /* the mix after it: from the table's stretched values, to the next table's range */
    const m = /** @type {{ m: number[] }} */ (runs[i + 1]).m;
    const unstretch = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => (r === c ? outRange[c][1] - outRange[c][0] : 0)).concat(outRange[r][0]));
    const mixed = mixAfter(unstretch, m);
    /* where the mix can go, a channel: its least and most over the corners of what comes in, less where the curve
       after it no longer changes */
    const after = /** @type {{ f: Step }} */ (runs[i + 2]).f;
    /** @type {[number, number][]} */
    const next = [0, 1, 2].map((r) => {
      let lo = mixed[r * 4 + 3], hi = lo;
      for (let c = 0; c < 3; c++) { const w = mixed[r * 4 + c]; lo += Math.min(0, w); hi += Math.max(0, w); }
      return /** @type {[number, number]} */ (flatTrimmed(after, r, lo, hi));
    });
    const stretch = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => (r === c ? 1 / (next[r][1] - next[r][0]) : 0)).concat(-next[r][0] / (next[r][1] - next[r][0])));
    stages.push({ kind: 'mix', m: mixAfter(mixed, stretch) });
    inRange = next;
  }
  return stages;
}

/**
 * The part of [lo, hi] where curve `f` changes channel `c`: past it, the curve gives the same as at its end (it is
 * clamped there), so a table spends its 256 steps where they show; values beyond are held to its ends, which give the
 * same. @param {Step} f @param {number} c @param {number} lo @param {number} hi
 */
function flatTrimmed(f, c, lo, hi) {
  const N = 4096;
  const v = new Float64Array(3);
  const at = (/** @type {number} */ k) => { v[0] = v[1] = v[2] = lo + (hi - lo) * k / N; f(v); return v[c]; };
  const ys = Array.from({ length: N + 1 }, (_, k) => at(k));
  let a = 0, b = N;
  while (a < N && Math.abs(ys[a + 1] - ys[0]) < 1e-7) a++;
  while (b > a && Math.abs(ys[b - 1] - ys[N]) < 1e-7) b--;
  const from = lo + (hi - lo) * a / N, to = lo + (hi - lo) * b / N;
  return to - from < 1e-6 ? [from, from + 1e-6] : [from, to];
}

/**
 * The stages as one function on an RGB triple (0–1), as the browser draws them: a table read between its values, a
 * mix, each step's output held to 0–1. `quantize`: each table's input and output in 8 bits, as on the chip.
 * @param {readonly Stage[]} stages @param {{ quantize?: boolean }} [how]
 * @returns {(r: number, g: number, b: number, out: number[] | Float32Array | Float64Array) => void}
 */
export function stagesFunction(stages, { quantize = false } = {}) {
  const q = quantize ? (/** @type {number} */ x) => Math.round(clamp01(x) * 255) / 255 : clamp01;
  const v = [0, 0, 0];
  return (r, g, b, out) => {
    v[0] = r; v[1] = g; v[2] = b;
    for (const s of stages) {
      if (s.kind === 'table') {
        for (let c = 0; c < 3; c++) {
          const t = s.tables[c], x = q(v[c]) * (TABLE - 1), k = Math.min(TABLE - 2, Math.floor(x)), f = x - k;
          v[c] = q(t[k] * (1 - f) + t[k + 1] * f);
        }
      } else {
        const [a, bb, c] = v, m = s.m;
        for (let row = 0; row < 3; row++) v[row] = clamp01(m[row * 4] * a + m[row * 4 + 1] * bb + m[row * 4 + 2] * c + m[row * 4 + 3]);
      }
    }
    out[0] = v[0]; out[1] = v[1]; out[2] = v[2];
  };
}

const num = (/** @type {number} */ x) => String(Math.round(x * 1e5) / 1e5);

/**
 * The SVG `<filter>` that draws `stages`, as `id`. `split` (0–1): only the part right of that share of the picture is
 * graded, the rest as it is (an editor's before and after).
 * @param {readonly Stage[]} stages @param {string} id @param {{ split?: number | null }} [how]
 */
export function filterMarkup(stages, id, { split = null } = {}) {
  const region = split == null ? '' : ` x="${num(split)}" y="0" width="${num(1 - split)}" height="1"`;
  const steps = stages.map((s, i) => {
    const from = i === 0 ? 'SourceGraphic' : `s${i - 1}`;
    if (s.kind === 'mix') {
      /* a row a channel: its weights of red, green, blue and alpha, and its offset (0–1); alpha as it is */
      const m = [0, 1, 2].flatMap((r) => [s.m[r * 4], s.m[r * 4 + 1], s.m[r * 4 + 2], 0, s.m[r * 4 + 3]]).concat([0, 0, 0, 1, 0]);
      return `<feColorMatrix in="${from}" result="s${i}" type="matrix"${region} values="${m.map(num).join(' ')}"/>`;
    }
    const fn = (/** @type {string} */ ch, /** @type {number[]} */ t) => `<feFunc${ch} type="table" tableValues="${t.map(num).join(' ')}"/>`;
    return `<feComponentTransfer in="${from}" result="s${i}"${region}>${fn('R', s.tables[0])}${fn('G', s.tables[1])}${fn('B', s.tables[2])}</feComponentTransfer>`;
  });
  const last = `s${stages.length - 1}`;
  const merge = split == null ? '' : `<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="${last}"/></feMerge>`;
  return `<filter id="${id}" x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" color-interpolation-filters="sRGB">${steps.join('')}${merge}</filter>`;
}
