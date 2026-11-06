// @ts-check
/**
 * What a sound is like, measured from its samples (mono, any rate): how loud, how busy, how bright, its tempo when it
 * has a steady beat, and whether its end runs on into its start. scripts/library-describe.mjs measures the library's
 * sounds and music with it, once, as they are published, and writes what it found into library/audio.json.
 *
 *   db        its loudness while it sounds (dBFS of the frames' RMS, the quietest fifth left out)
 *   peak      its loudest frame (dBFS)
 *   flux      how much changes from frame to frame (spectral flux, mean): busy or still
 *   centroid  where its sound sits (Hz, the spectrum's center of mass): dark or bright
 *   bpm       its tempo, when a beat is clear (null: no steady beat, as a drone or an ambience)
 *   pulse     how clear that beat is, 0–1
 *   steady    how even its loudness is, 0–1 (1: the same all along)
 *   seam      how alike its last and first seconds are, 0–1 (1: the end runs on into the start)
 */

const FFT = 1024;
const HOP = 256;

/** The magnitude spectrum of `frame` (FFT long), in place radix-2. @param {Float32Array} re */
function spectrum(re) {
  const n = re.length;
  const im = new Float32Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2], ai = im[i + k + len / 2];
        const xr = ar * wr - ai * wi, xi = ar * wi + ai * wr;
        re[i + k + len / 2] = re[i + k] - xr; im[i + k + len / 2] = im[i + k] - xi;
        re[i + k] += xr; im[i + k] += xi;
      }
    }
  }
  const mag = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
  return mag;
}

const dbOf = (/** @type {number} */ rms) => 20 * Math.log10(Math.max(rms, 1e-6));
const quantile = (/** @type {number[]} */ list, /** @type {number} */ q) => {
  const s = [...list].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))] : 0;
};

/**
 * The tempo of an onset curve (`fps` values a second): the lag where it is most like itself, between 50 and 200 BPM,
 * leaning to around 110 as a listener does; and how clear that is.
 * @param {Float32Array} onset @param {number} fps
 */
function tempoOf(onset, fps) {
  const n = onset.length;
  if (n < fps * 4) return { bpm: null, pulse: 0 };
  /* what stands out of the last second around it: the beats, not the swells */
  const half = Math.round(fps / 2);
  const sums = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sums[i + 1] = sums[i] + onset[i];
  const x = Float32Array.from(onset, (v, i) => {
    const from = Math.max(0, i - half), to = Math.min(n, i + half + 1);
    return Math.max(0, v - (sums[to] - sums[from]) / (to - from));
  });
  const mean = x.reduce((s, v) => s + v, 0) / n;
  for (let i = 0; i < n; i++) x[i] -= mean;
  const ac = (/** @type {number} */ lag) => { let s = 0; for (let i = lag; i < n; i++) s += x[i] * x[i - lag]; return s / (n - lag); };
  const zero = ac(0);
  /* next to nothing changes (a held tone): no beat to find */
  if (zero <= 1e-9 || onset.reduce((s, v) => s + v, 0) / n < 0.01) return { bpm: null, pulse: 0 };
  let best = { lag: 0, score: -Infinity, value: 0 };
  const lo = Math.floor((60 * fps) / 200), hi = Math.ceil((60 * fps) / 50);
  for (let lag = lo; lag <= hi; lag++) {
    const value = ac(lag);
    const octaves = Math.log2((60 * fps) / lag / 110);
    const score = value * Math.exp(-0.5 * (octaves / 0.9) ** 2);
    if (score > best.score) best = { lag, score, value };
  }
  /* a finer lag: the peak's place between its neighbours */
  const a = ac(best.lag - 1), b = best.value, c = ac(best.lag + 1);
  const shift = a - 2 * b + c < 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  const pulse = Math.max(0, Math.min(1, b / zero));
  return { bpm: pulse >= 0.2 ? Math.round((60 * fps) / (best.lag + shift)) : null, pulse: Math.round(pulse * 100) / 100 };
}

/**
 * What the sound in `samples` is like (see above).
 * @param {Float32Array} samples @param {number} rate
 */
export function measure(samples, rate) {
  const frames = Math.max(0, Math.floor((samples.length - FFT) / HOP) + 1);
  const window = Float32Array.from({ length: FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT - 1)));
  const rms = new Float32Array(frames);
  const onset = new Float32Array(frames);
  /** @type {Float32Array[]} */
  const logs = [];
  let prev = null;
  let centroidSum = 0, centroidWeight = 0;
  for (let f = 0; f < frames; f++) {
    const at = f * HOP;
    const buf = new Float32Array(FFT);
    let sq = 0;
    for (let i = 0; i < FFT; i++) { const v = samples[at + i]; sq += v * v; buf[i] = v * window[i]; }
    rms[f] = Math.sqrt(sq / FFT);
    const mag = spectrum(buf);
    const log = Float32Array.from(mag, (m) => Math.log1p(100 * m));
    let flux = 0;
    if (prev) for (let k = 1; k < log.length; k++) flux += Math.max(0, log[k] - prev[k]);
    onset[f] = flux / log.length;
    prev = log;
    logs.push(log);
    let num = 0, den = 0;
    for (let k = 1; k < mag.length; k++) { num += k * mag[k]; den += mag[k]; }
    if (den > 0) { centroidSum += (num / den) * (rate / FFT) * rms[f]; centroidWeight += rms[f]; }
  }
  const levels = Array.from(rms, dbOf);
  const floor = quantile(levels, 0.2);
  const sounding = levels.filter((d) => d >= floor);
  const meanSq = sounding.reduce((s, d) => s + 10 ** (d / 10), 0) / Math.max(1, sounding.length);
  const db = Math.round(10 * Math.log10(Math.max(meanSq, 1e-12)) * 10) / 10;
  const peak = Math.round(Math.max(-120, ...levels) * 10) / 10;
  const flux = onset.length ? onset.reduce((s, v) => s + v, 0) / onset.length : 0;
  /* even: how little its loudness moves about its middle (in dB, a second at a time) */
  const second = Math.max(1, Math.round(rate / HOP));
  const seconds = [];
  for (let f = 0; f + second <= frames; f += second) seconds.push(dbOf(Math.sqrt(Array.from(rms.subarray(f, f + second)).reduce((s, v) => s + v * v, 0) / second)));
  const loud = seconds.filter((d) => d > peak - 40);
  const spread = loud.length > 1 ? quantile(loud, 0.9) - quantile(loud, 0.1) : 30;
  const steady = Math.round(Math.max(0, Math.min(1, 1 - spread / 30)) * 100) / 100;
  /* the seam: the last and first two seconds, alike in loudness and in what they hold */
  const span = Math.min(Math.floor((2 * rate) / HOP), Math.floor(frames / 3));
  let seam = 0;
  if (span > 2) {
    const meanOf = (/** @type {number} */ from) => {
      const m = new Float32Array(FFT / 2);
      for (let f = from; f < from + span; f++) for (let k = 0; k < m.length; k++) m[k] += logs[f][k] / span;
      return m;
    };
    const head = meanOf(0), tail = meanOf(frames - span);
    let dot = 0, h = 0, t = 0;
    for (let k = 0; k < head.length; k++) { dot += head[k] * tail[k]; h += head[k] ** 2; t += tail[k] ** 2; }
    const alike = h && t ? dot / Math.sqrt(h * t) : 0;
    const levelOf = (/** @type {number} */ from) => dbOf(Math.sqrt(Array.from(rms.subarray(from, from + span)).reduce((s, v) => s + v * v, 0) / span));
    const gap = Math.abs(levelOf(0) - levelOf(frames - span));
    seam = Math.round(Math.max(0, alike * Math.max(0, 1 - gap / 12)) * 100) / 100;
  }
  return {
    db, peak, flux: Math.round(flux * 1000) / 1000,
    centroid: centroidWeight ? Math.round(centroidSum / centroidWeight) : 0,
    ...tempoOf(onset, rate / HOP), steady, seam,
  };
}
