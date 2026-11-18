/**
 * The color workbench's pictures and scopes, made off the page's thread. A frame of a clip's footage at its own depth
 * (16-bit RGB, as ffmpeg reads it for the film's graded copy) is taken through a chain of color files (src/color: the
 * same evaluation the film plays and exports with, baked at 33 points) and then:
 *
 *   render   drawn as a colorist reads it: a waveform, an RGB parade, a vectorscope (as asked) and a histogram, and
 *            measured (plugins/color/measure: the middle in IRE, the white in kelvin, what is clipped), as
 *            `openfilm color look` measures it
 *   thumb    a small picture of it, RGBA: a shot as it plays, or as a filter would grade it
 *   pick     the white balance (temperature, tint of a layer's `adjust`) that makes a spot of it grey as it plays: a
 *            colorist's white-balance picker, solved through the whole chain
 *
 * A chain's files are given as text, so a grade being dragged (not written yet) is measured as it is shown.
 */
import { parseColorTransform } from '../../../../../src/color/ctf.mjs';
import { bake, compile, sampleBaked } from '../../../../../src/color/ops.mjs';
import { adjustOf, withAdjust, ADJUST_RANGE } from '../../../../../src/color/adjust.mjs';
import { pageStages, stagesFunction } from '../../../../../src/color/page-grade.mjs';
import { measure } from '../../../../../plugins/color/measure.mjs';

export type Scope = 'waveform' | 'parade' | 'vectorscope' | 'histogram';
export type Chain = readonly { name: string; text: string }[];

/**
 * `drawn`: the chain grades a picture the browser draws (a page, a still), as the browser draws it
 * (src/color/page-grade.mjs); else a video's footage through its input and output.
 */
export type ToWorker =
  | { type: 'frame'; key: string; w: number; h: number; data: ArrayBuffer }
  | { type: 'render'; seq: number; key: string; chain: Chain; scopes: Scope[]; drawn?: boolean }
  | { type: 'thumb'; seq: number; key: string; chain: Chain; drawn?: boolean }
  /** `x`, `y` 0–1 across the frame; `layer` the chain's file whose temperature and tint are solved */
  | { type: 'pick'; seq: number; key: string; chain: Chain; layer: string; x: number; y: number; drawn?: boolean };

export interface Drawn { w: number; h: number; image: ArrayBuffer }
export interface Read { middle: number; kelvin: number; tint: number; clipped: number; crushed: number; saturation: number }
export interface Rendered { type: 'rendered'; seq: number; scopes: Partial<Record<Scope, Drawn>>; bins: Uint32Array; read: Read; ms: number }
export interface Thumbed { type: 'thumbed'; seq: number; key: string; w: number; h: number; image: ArrayBuffer }
export interface Failed { type: 'failed'; seq: number; error: string }
export interface Picked { type: 'picked'; seq: number; temperature: number; tint: number }
export type FromWorker = Rendered | Thumbed | Picked | Failed;

/** The scopes' sizes, px. */
export const WAVE = { w: 512, h: 256 };
export const VECTOR = 256;

const frames = new Map<string, { w: number; h: number; rgb: Float32Array }>();
type Grade = (r: number, g: number, b: number, out: number[]) => void;
/** the chains last made into a function, by their texts: a video's baked, a drawn picture's as its filter */
const bakes = new Map<string, Grade | null>();
const gradeOf = (chain: Chain, drawn = false): Grade | null => {
  const key = `${drawn ? 'drawn' : 'video'}\0${chain.map((f) => `${f.name}\n${f.text}`).join('\0')}`;
  let b = bakes.get(key);
  if (b === undefined) {
    if (drawn) {
      const got = pageStages(chain);
      b = got?.stages.length ? stagesFunction(got.stages) : null;
    } else {
      const baked = chain.length ? bake(chain.flatMap((f) => parseColorTransform(f.text, f.name)), { size: 33 }) : null;
      b = baked ? (r, g, bl, out) => sampleBaked(baked, r, g, bl, out) : null;
    }
    if (bakes.size > 120) bakes.delete(bakes.keys().next().value!);
    bakes.set(key, b);
  }
  return b;
};
const graded = (rgb: Float32Array, b: Grade | null) => {
  const pic = new Float32Array(rgb.length);
  const o = [0, 0, 0];
  for (let i = 0; i < rgb.length; i += 3) {
    if (b) b(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!, o); else { o[0] = rgb[i]!; o[1] = rgb[i + 1]!; o[2] = rgb[i + 2]!; }
    pic[i] = clamp01(o[0]!); pic[i + 1] = clamp01(o[1]!); pic[i + 2] = clamp01(o[2]!);
  }
  return pic;
};

self.onmessage = ({ data: m }: MessageEvent<ToWorker>) => {
  const post = (out: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(out, transfer);
  if (m.type === 'frame') {
    const raw = new Uint16Array(m.data);
    const rgb = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) rgb[i] = raw[i]! / 65535;
    frames.set(m.key, { w: m.w, h: m.h, rgb });
    /* the frames of a strip of shots and a scope's: a few dozen at most */
    if (frames.size > 64) frames.delete(frames.keys().next().value!);
    return;
  }
  const frame = frames.get(m.key);
  if (!frame) return;
  const started = performance.now();
  try {
    if (m.type === 'pick') { post({ type: 'picked', seq: m.seq, ...pickWhite(frame, m) }); return; }
    const pic = graded(frame.rgb, gradeOf(m.chain, m.drawn));
    if (m.type === 'thumb') {
      const out = new Uint8ClampedArray((pic.length / 3) * 4);
      for (let i = 0, j = 0; i < pic.length; i += 3, j += 4) { out[j] = pic[i]! * 255 + 0.5; out[j + 1] = pic[i + 1]! * 255 + 0.5; out[j + 2] = pic[i + 2]! * 255 + 0.5; out[j + 3] = 255; }
      post({ type: 'thumbed', seq: m.seq, key: m.key, w: frame.w, h: frame.h, image: out.buffer }, [out.buffer]);
      return;
    }
    const { w, h } = frame;
    const scopes: Partial<Record<Scope, Drawn>> = {};
    for (const s of m.scopes) {
      if (s === 'vectorscope') scopes[s] = { w: VECTOR, h: VECTOR, image: vectorscope(pic) };
      else if (s !== 'histogram') { const cols = Math.min(WAVE.w, w); scopes[s] = { w: cols, h: WAVE.h, image: waveform(pic, w, h, s === 'parade', cols) }; }
    }
    const mm = measure(pic);
    const read: Read = { middle: mm.luma.median, kelvin: mm.white.kelvin, tint: mm.white.tint, clipped: mm.clipped, crushed: mm.crushed, saturation: mm.saturation.mean };
    post({ type: 'rendered', seq: m.seq, scopes, bins: histogram(pic), read, ms: performance.now() - started }, Object.values(scopes).map((d) => d!.image));
  } catch (e) {
    post({ type: 'failed', seq: m.seq, error: e instanceof Error ? e.message : String(e) });
  }
};

const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);

/** A waveform: each column of the picture, its luma (or, as a parade, its red, green and blue side by side) up the scope. */
function waveform(pic: Float32Array, w: number, h: number, parade: boolean, W: number): ArrayBuffer {
  /* a column of the scope for each of the picture's at most, so none is left empty */
  const H = WAVE.h;
  const counts = new Uint32Array(W * H * 3);
  const cols = parade ? Math.floor(W / 3) : W;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    const col = Math.min(cols - 1, Math.floor((x * cols) / w));
    if (parade) {
      for (let c = 0; c < 3; c++) {
        const row = H - 1 - Math.min(H - 1, Math.floor(pic[i + c]! * (H - 1) + 0.5));
        counts[(row * W + c * cols + col) * 3 + c]!++;
      }
    } else {
      const l = 0.2126 * pic[i]! + 0.7152 * pic[i + 1]! + 0.0722 * pic[i + 2]!;
      const row = H - 1 - Math.min(H - 1, Math.floor(l * (H - 1) + 0.5));
      counts[(row * W + col) * 3]!++;
    }
  }
  /* brightness by how many pixels land on a point, on a log scale so a few still show */
  const per = (h * w) / cols / H;
  const out = new Uint8ClampedArray(W * H * 4);
  const tone = (n: number) => (n ? Math.min(255, 50 + (205 * Math.log1p(n)) / Math.log1p(per * 6)) : 0);
  const tints: [number, number, number][] = parade ? [[1, 0.32, 0.3], [0.35, 1, 0.42], [0.38, 0.55, 1]] : [[0.9, 0.95, 0.92], [0, 0, 0], [0, 0, 0]];
  for (let p = 0; p < W * H; p++) {
    let r = 0, g = 0, b = 0;
    if (parade) {
      for (let c = 0; c < 3; c++) { const v = tone(counts[p * 3 + c]!); r += v * tints[c]![0]; g += v * tints[c]![1]; b += v * tints[c]![2]; }
    } else { const v = tone(counts[p * 3]!); r = v * tints[0]![0]; g = v * tints[0]![1]; b = v * tints[0]![2]; }
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
    const r = pic[i]!, g = pic[i + 1]!, b = pic[i + 2]!;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const cb = (b - y) / 1.8556, cr = (r - y) / 1.5748;
    const x = Math.round((cb + 0.5) * (N - 1)), yy = Math.round((0.5 - cr) * (N - 1));
    if (x < 0 || x >= N || yy < 0 || yy >= N) continue;
    const k = yy * N + x;
    counts[k]!++; sums[k * 3]! += r; sums[k * 3 + 1]! += g; sums[k * 3 + 2]! += b;
  }
  const out = new Uint8ClampedArray(N * N * 4);
  const per = (pic.length / 3 / (N * N)) * 40;
  for (let k = 0; k < N * N; k++) {
    const n = counts[k]!;
    if (!n) continue;
    const t = Math.min(1, 0.3 + (0.7 * Math.log1p(n)) / Math.log1p(per));
    /* its own color, lifted toward white so dim colors still read on black */
    const c = [sums[k * 3]! / n, sums[k * 3 + 1]! / n, sums[k * 3 + 2]! / n];
    const m = Math.max(c[0]!, c[1]!, c[2]!, 0.2);
    out[k * 4] = (0.35 + (0.65 * c[0]!) / m) * t * 255; out[k * 4 + 1] = (0.35 + (0.65 * c[1]!) / m) * t * 255; out[k * 4 + 2] = (0.35 + (0.65 * c[2]!) / m) * t * 255;
    out[k * 4 + 3] = 255;
  }
  return out.buffer;
}

/** A histogram: 256 bins each of red, green, blue and luma, in that order. */
function histogram(pic: Float32Array): Uint32Array {
  const bins = new Uint32Array(256 * 4);
  for (let i = 0; i < pic.length; i += 3) {
    const r = pic[i]!, g = pic[i + 1]!, b = pic[i + 2]!;
    bins[Math.round(r * 255)]!++; bins[256 + Math.round(g * 255)]!++; bins[512 + Math.round(b * 255)]!++;
    bins[768 + Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b) * 255)]!++;
  }
  return bins;
}

/** Stops red and blue move apart at temperature 100, and green at tint 100 (src/color/adjust). */
const WARM_STOPS = 0.4, TINT_STOPS = 0.3;
/**
 * The temperature and tint of `layer` that make the spot at `x`, `y` (a few pixels round it, averaged) grey through
 * the chain: each step moves them by how far red and blue are from green there, as the sliders move them, until it
 * is grey or they reach their ends.
 */
function pickWhite(frame: { w: number; h: number; rgb: Float32Array }, m: { chain: Chain; layer: string; x: number; y: number; drawn?: boolean }) {
  const cx = Math.round(m.x * (frame.w - 1)), cy = Math.round(m.y * (frame.h - 1));
  const at = [0, 0, 0];
  let n = 0;
  for (let y = Math.max(0, cy - 3); y <= Math.min(frame.h - 1, cy + 3); y++) for (let x = Math.max(0, cx - 3); x <= Math.min(frame.w - 1, cx + 3); x++) {
    const i = (y * frame.w + x) * 3;
    at[0]! += frame.rgb[i]!; at[1]! += frame.rgb[i + 1]!; at[2]! += frame.rgb[i + 2]!; n++;
  }
  for (let c = 0; c < 3; c++) at[c]! /= n || 1;
  const own = m.chain.find((f) => f.name === m.layer)?.text ?? null;
  const start = adjustOf(own);
  let temperature = start.temperature, tint = start.tint;
  const out = [0, 0, 0];
  const clamp = (v: number, k: 'temperature' | 'tint') => Math.min(ADJUST_RANGE[k].max, Math.max(ADJUST_RANGE[k].min, v));
  for (let step = 0; step < 8; step++) {
    const text = withAdjust(own, { temperature, tint }, m.layer.split('/').pop()!.replace(/\.ctf$/, ''));
    const chain = m.chain.some((f) => f.name === m.layer) ? m.chain.map((f) => (f.name === m.layer ? { ...f, text } : f)) : m.chain;
    if (m.drawn) {
      const got = pageStages(chain);
      if (got?.stages.length) stagesFunction(got.stages)(at[0]!, at[1]!, at[2]!, out); else { out[0] = at[0]!; out[1] = at[1]!; out[2] = at[2]!; }
    } else compile(chain.flatMap((f) => parseColorTransform(f.text, f.name)))(at[0]!, at[1]!, at[2]!, out);
    const g = Math.max(1e-4, out[1]!);
    const a = Math.log2(Math.max(1e-4, out[0]!) / g), b = Math.log2(Math.max(1e-4, out[2]!) / g);
    if (Math.abs(a) < 0.004 && Math.abs(b) < 0.004) break;
    /* red up and blue down by w stops, green by gt: the spot's red and blue each at its green */
    const w = (b - a) / 2, gt = (a + b) / 2;
    temperature = clamp(temperature + (w / WARM_STOPS) * 100, 'temperature');
    tint = clamp(tint - (gt / TINT_STOPS) * 100, 'tint');
  }
  return { temperature: Math.round(temperature), tint: Math.round(tint) };
}
