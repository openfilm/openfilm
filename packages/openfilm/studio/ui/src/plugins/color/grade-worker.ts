/**
 * The color workbench's picture, made off the page's thread: a frame of the footage (16-bit RGB, as ffmpeg reads it
 * for the film's graded copy) graded by the clip's grade baked into a LUT, then by the LUTs after it, each looked up
 * tetrahedrally and clamped after, as ffmpeg's lut3d does: what is shown is what plays and exports. While a control
 * is dragged the grade is baked at 33 points (`draft`); let go, at the size it is written at.
 *
 * From the picture shown it draws the scopes (a waveform, an RGB parade, a vectorscope, a histogram), reads the colors
 * under the pointer, and finds the white balance that makes a picked patch grey.
 */
import { compile, sizeFor, hsv, windowKey, normalize, type Grade } from '../../../../../plugins/color/engine/grade.mjs';
import { readCube, sample, type Lut } from '../../../../../plugins/color/engine/cube.mjs';
import { temperatureOf, rgbToXYZ, SPACES, bt1886, D65 } from '../../../../../plugins/color/engine/math.mjs';

export type Scope = 'waveform' | 'parade' | 'vectorscope' | 'histogram';

export type ToWorker =
  | { type: 'luts'; luts: Record<string, string> }
  | { type: 'frame'; w: number; h: number; data: ArrayBuffer }
  | { type: 'render'; seq: number; grade: Grade; others: string[]; draft: boolean; key: number | null; scopes: Scope[] }
  | { type: 'pick'; seq: number; x: number; y: number }
  | { type: 'white'; seq: number; grade: Grade; x: number; y: number };

export interface Rendered {
  type: 'rendered'; seq: number; w: number; h: number;
  /** the graded picture, RGBA */
  graded: ArrayBuffer;
  /** the footage as recorded, RGBA: sent with the first picture of a frame */
  original: ArrayBuffer | null;
  scopes: { waveform?: ArrayBuffer; parade?: ArrayBuffer; vectorscope?: ArrayBuffer; histogram?: Uint32Array };
  ms: number;
  /** a LUT the grade names that is not read (yet) */
  missing: string[];
}
export interface Picked { type: 'picked'; seq: number; source: [number, number, number]; shown: [number, number, number]; hsv: [number, number, number] }
export interface Whitened { type: 'whitened'; seq: number; white: number; tint: number }
export type FromWorker = Rendered | Picked | Whitened;

/** The scopes' sizes, px. */
export const WAVE = { w: 512, h: 256 };
export const VECTOR = 256;

let frame: { w: number; h: number; rgb: Float32Array } | null = null;
let originalSent = false;
const luts = new Map<string, Lut>();
/** the last grade baked, by what it was baked from */
let baked: { key: string; lut: Lut } | null = null;
/** the picture last shown, 0–1, three values a pixel */
let shown: Float32Array | null = null;
/** the grade last shown, and the same grade baked without its windows and look: what a window keys on */
let lastGrade: Grade | null = null;
let before: { key: string; lut: Lut } | null = null;

/** The grade without its windows and look, baked: the picture as a window sees it (compile keys windows on it). */
function beforeWindows(g: Grade, size: number): Lut {
  const key = `${size}|${JSON.stringify({ ...g, windows: [], look: null })}`;
  if (before?.key !== key) before = { key, lut: bakeLut(normalize({ ...g, windows: [], look: null }), size) };
  return before.lut;
}

const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);

function bakeLut(g: Grade, size: number): Lut {
  const named: Record<string, Lut> = {};
  for (const path of [g.inputLut?.path, g.look?.path]) { const l = path ? luts.get(path) : undefined; if (path && l) named[path] = l; }
  const f = compile(g, named, { extended: true });
  const data = new Float32Array(size ** 3 * 3);
  const n = size - 1;
  let at = 0;
  for (let b = 0; b < size; b++) for (let gg = 0; gg < size; gg++) for (let r = 0; r < size; r++) {
    const o = f(r / n, gg / n, b / n);
    data[at++] = o[0]; data[at++] = o[1]; data[at++] = o[2];
  }
  return { size, oneD: false, data, min: [0, 0, 0], max: [1, 1, 1], title: '', grade: null };
}

function render(m: Extract<ToWorker, { type: 'render' }>): Rendered | null {
  if (!frame) return null;
  const started = performance.now();
  const g = normalize(m.grade);
  const size = m.draft ? 33 : sizeFor(g);
  const missing = [g.inputLut?.path, g.look?.path, ...m.others].filter((p): p is string => Boolean(p) && !luts.has(p as string));
  const key = `${size}|${JSON.stringify(g)}|${missing.join(',')}`;
  if (baked?.key !== key) baked = { key, lut: bakeLut(g, size) };
  const after = m.others.map((p) => luts.get(p)).filter((l): l is Lut => Boolean(l));
  const { w, h, rgb } = frame;
  const out = new Uint8ClampedArray(w * h * 4);
  const pic = new Float32Array(w * h * 3);
  const keyWindow = m.key !== null ? g.windows[m.key] ?? null : null;
  const keyLut = keyWindow ? beforeWindows(g, 33) : null;
  lastGrade = g;
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    let c = sample(baked.lut, rgb[i], rgb[i + 1], rgb[i + 2]);
    c = [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
    for (const l of after) { c = sample(l, c[0], c[1], c[2]); c = [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])]; }
    pic[i] = c[0]; pic[i + 1] = c[1]; pic[i + 2] = c[2];
    if (keyWindow && keyLut) {
      /* the window's matte, as a colorist checks a key: what it takes white, the rest dark; keyed on the picture
         before the windows, as the grade keys it */
      const b = sample(keyLut, rgb[i], rgb[i + 1], rgb[i + 2]).map(clamp01);
      const [hh, s] = hsv(b[0], b[1], b[2]);
      const l = 0.2126 * b[0] + 0.7152 * b[1] + 0.0722 * b[2];
      const k = windowKey({ ...keyWindow, on: true }, hh, s, l);
      out[j] = out[j + 1] = out[j + 2] = Math.round((0.08 + 0.84 * k) * 255);
    } else {
      out[j] = c[0] * 255 + 0.5; out[j + 1] = c[1] * 255 + 0.5; out[j + 2] = c[2] * 255 + 0.5;
    }
    out[j + 3] = 255;
  }
  shown = pic;
  let original: ArrayBuffer | null = null;
  if (!originalSent) {
    const o = new Uint8ClampedArray(w * h * 4);
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) { o[j] = rgb[i] * 255 + 0.5; o[j + 1] = rgb[i + 1] * 255 + 0.5; o[j + 2] = rgb[i + 2] * 255 + 0.5; o[j + 3] = 255; }
    original = o.buffer;
    originalSent = true;
  }
  const scopes: Rendered['scopes'] = {};
  for (const s of m.scopes) {
    if (s === 'waveform') scopes.waveform = waveform(pic, w, h, false);
    else if (s === 'parade') scopes.parade = waveform(pic, w, h, true);
    else if (s === 'vectorscope') scopes.vectorscope = vectorscope(pic);
    else if (s === 'histogram') scopes.histogram = histogram(pic);
  }
  return { type: 'rendered', seq: m.seq, w, h, graded: out.buffer, original, scopes, ms: performance.now() - started, missing };
}

/** A waveform: each column of the picture, its luma (or, as a parade, its red, green and blue side by side) up the scope. */
function waveform(pic: Float32Array, w: number, h: number, parade: boolean): ArrayBuffer {
  const W = WAVE.w, H = WAVE.h;
  const counts = new Uint32Array(W * H * 3);
  const cols = parade ? Math.floor(W / 3) : W;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    const col = Math.min(cols - 1, Math.floor((x * cols) / w));
    if (parade) {
      for (let c = 0; c < 3; c++) {
        const row = H - 1 - Math.min(H - 1, Math.floor(pic[i + c] * (H - 1) + 0.5));
        counts[(row * W + c * cols + col) * 3 + c]++;
      }
    } else {
      const l = 0.2126 * pic[i] + 0.7152 * pic[i + 1] + 0.0722 * pic[i + 2];
      const row = H - 1 - Math.min(H - 1, Math.floor(l * (H - 1) + 0.5));
      const k = (row * W + col) * 3;
      counts[k]++; counts[k + 1]++; counts[k + 2]++;
    }
  }
  /* brightness by how many pixels land on a point, on a log scale so a few still show */
  const per = (h * w) / cols / H;
  const out = new Uint8ClampedArray(W * H * 4);
  const tone = (n: number) => (n ? Math.min(255, 40 + 215 * Math.log1p(n) / Math.log1p(per * 6)) : 0);
  const tints: [number, number, number][] = parade ? [[1, 0.35, 0.3], [0.35, 1, 0.4], [0.35, 0.55, 1]] : [[0.85, 0.95, 0.88], [0, 0, 0], [0, 0, 0]];
  for (let p = 0; p < W * H; p++) {
    let r = 0, g = 0, b = 0;
    if (parade) {
      for (let c = 0; c < 3; c++) { const v = tone(counts[p * 3 + c]); r += v * tints[c][0]; g += v * tints[c][1]; b += v * tints[c][2]; }
    } else { const v = tone(counts[p * 3]); r = v * tints[0][0]; g = v * tints[0][1]; b = v * tints[0][2]; }
    out[p * 4] = r; out[p * 4 + 1] = g; out[p * 4 + 2] = b; out[p * 4 + 3] = r || g || b ? 255 : 0;
  }
  return out.buffer;
}

/** A vectorscope: each pixel at its Cb, Cr (BT.709), in its own hue, brighter where more land. */
function vectorscope(pic: Float32Array): ArrayBuffer {
  const N = VECTOR;
  const counts = new Uint32Array(N * N);
  const sums = new Float32Array(N * N * 3);
  for (let i = 0; i < pic.length; i += 3) {
    const r = pic[i], g = pic[i + 1], b = pic[i + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const cb = (b - y) / 1.8556, cr = (r - y) / 1.5748;
    const x = Math.round((cb + 0.5) * (N - 1)), yy = Math.round((0.5 - cr) * (N - 1));
    if (x < 0 || x >= N || yy < 0 || yy >= N) continue;
    const k = yy * N + x;
    counts[k]++; sums[k * 3] += r; sums[k * 3 + 1] += g; sums[k * 3 + 2] += b;
  }
  const out = new Uint8ClampedArray(N * N * 4);
  const per = pic.length / 3 / (N * N) * 40;
  for (let k = 0; k < N * N; k++) {
    const n = counts[k];
    if (!n) continue;
    const t = Math.min(1, 0.25 + 0.75 * Math.log1p(n) / Math.log1p(per));
    /* its own color, lifted toward white so dim colors still read on black */
    const c = [sums[k * 3] / n, sums[k * 3 + 1] / n, sums[k * 3 + 2] / n];
    const m = Math.max(c[0], c[1], c[2], 0.2);
    out[k * 4] = (0.35 + 0.65 * c[0] / m) * t * 255; out[k * 4 + 1] = (0.35 + 0.65 * c[1] / m) * t * 255; out[k * 4 + 2] = (0.35 + 0.65 * c[2] / m) * t * 255;
    out[k * 4 + 3] = 255;
  }
  return out.buffer;
}

/** A histogram: 256 bins each of red, green, blue and luma, in that order. */
function histogram(pic: Float32Array): Uint32Array {
  const bins = new Uint32Array(256 * 4);
  for (let i = 0; i < pic.length; i += 3) {
    const r = pic[i], g = pic[i + 1], b = pic[i + 2];
    bins[Math.round(r * 255)]++; bins[256 + Math.round(g * 255)]++; bins[512 + Math.round(b * 255)]++;
    bins[768 + Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b) * 255)]++;
  }
  return bins;
}

/** The mean of a patch around (x, y) of a picture, three values a pixel. */
function patch(pic: Float32Array, w: number, h: number, x: number, y: number, r = 2): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  let n = 0;
  for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
    const i = (yy * w + xx) * 3;
    out[0] += pic[i]; out[1] += pic[i + 1]; out[2] += pic[i + 2]; n++;
  }
  return n ? [out[0] / n, out[1] / n, out[2] / n] : out;
}

const TO_XYZ = rgbToXYZ(SPACES.bt709);
const D65_DUV = temperatureOf(D65).duv;

/**
 * The white and tint that make a patch of the footage grey as graded: the patch's color read as light, its temperature
 * and tint taken away, a few times over (each step measured through the whole grade).
 */
function whiteAt(m: Extract<ToWorker, { type: 'white' }>): Whitened | null {
  if (!frame) return null;
  const { w, h, rgb } = frame;
  const src = patch(rgb, w, h, Math.round(m.x), Math.round(m.y));
  let g = normalize(m.grade);
  for (let i = 0; i < 6; i++) {
    const named: Record<string, Lut> = {};
    for (const path of [g.inputLut?.path, g.look?.path]) { const l = path ? luts.get(path) : undefined; if (path && l) named[path] = l; }
    const o = compile(g, named)(src[0], src[1], src[2]);
    const lin = o.map((v) => bt1886.decode(v));
    const xyz = [0, 1, 2].map((k) => TO_XYZ[k][0] * lin[0] + TO_XYZ[k][1] * lin[1] + TO_XYZ[k][2] * lin[2]);
    const t = xyz[0] + xyz[1] + xyz[2];
    if (t <= 1e-6) break;
    const cct = temperatureOf([xyz[0] / t, xyz[1] / t]);
    const white = 1e6 / (1e6 / g.white + (1e6 / cct.kelvin - 1e6 / 6500));
    const tint = g.tint + (cct.duv - D65_DUV) / 0.0002;
    g = normalize({ ...g, white: Math.min(15000, Math.max(1700, white)), tint: Math.min(100, Math.max(-100, tint)) });
  }
  return { type: 'whitened', seq: m.seq, white: Math.round(g.white / 10) * 10, tint: Math.round(g.tint) };
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'luts') {
    for (const [path, text] of Object.entries(m.luts)) { try { luts.set(path, readCube(text)); } catch { /* not a LUT this reads: left out */ } }
    baked = null;
  } else if (m.type === 'frame') {
    const raw = new Uint16Array(m.data);
    const rgb = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) rgb[i] = raw[i] / 65535;
    frame = { w: m.w, h: m.h, rgb };
    originalSent = false;
    shown = null;
  } else if (m.type === 'render') {
    const out = render(m);
    if (out) (self as unknown as Worker).postMessage(out, [out.graded, ...(out.original ? [out.original] : []), ...Object.values(out.scopes).map((s) => (s instanceof Uint32Array ? s.buffer : s)).filter((b): b is ArrayBuffer => b instanceof ArrayBuffer)]);
  } else if (m.type === 'pick') {
    if (!frame || !shown) return;
    const x = Math.round(m.x), y = Math.round(m.y);
    const source = patch(frame.rgb, frame.w, frame.h, x, y);
    /* as a window sees it: before the windows */
    const seen = lastGrade ? sample(beforeWindows(lastGrade, 33), source[0], source[1], source[2]).map(clamp01) as [number, number, number] : patch(shown, frame.w, frame.h, x, y);
    (self as unknown as Worker).postMessage({ type: 'picked', seq: m.seq, source, shown: seen, hsv: hsv(seen[0], seen[1], seen[2]) } satisfies Picked);
  } else if (m.type === 'white') {
    const out = whiteAt(m);
    if (out) (self as unknown as Worker).postMessage(out);
  }
};
