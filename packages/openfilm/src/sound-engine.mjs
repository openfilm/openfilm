/**
 * The film's sound engine: what is done to the sound of the film once it is mixed (the bus: the delivery gain, then
 * the limiter), and to a clip's sound before it is mixed (its chain, empty today), as plain functions over blocks of
 * samples. It is pure JavaScript, with nothing of a browser's or of Node's, so the very same code runs in the preview
 * (an AudioWorklet, studio/ui/src/editor/sound-worklet.ts), in the export (src/sound-render.mjs: in Node, between
 * ffmpeg decoding the mix and ffmpeg encoding it) and in tests. Given the same samples it gives the same samples, bit
 * for bit, wherever it runs: per sample it only adds, subtracts, multiplies, divides and compares, which IEEE 754
 * rounds the same everywhere; `**` is used once per setting.
 *
 * Sound here is stereo at 48 kHz, in blocks of any length (a worklet's 128 frames, an export's thousands): a block
 * is a left and a right Float32Array, the right one the left one itself for a mono block. What is processed in blocks
 * of one length is the same as in blocks of another.
 *
 * State is short. Whatever a process holds is decided by the last second of what it was given, so a process started
 * a second before a point (fed that second, its output thrown away) gives from that point on the samples a process
 * started at the very beginning gives: the preview starts there when the film is played from the middle, and a long
 * sound can be rendered in parts.
 */

/** The rate the film's sound is processed at (Hz): the mix's (src/shared.mjs mixGraph). */
export const RATE = 48000;
/** How far the limiter keeps the film's peaks under full scale (dBFS): -1 dBTP, as delivery asks, less 1 dB the
    encoder adds (src/loudness.mjs TRUE_PEAK, HEADROOM). */
export const CEILING_DB = -2;
/** How long the limiter takes to come down to a peak, the time it looks ahead (s). */
const ATTACK = 0.003;
/** How long the limiter holds its gain after a peak (s): a low note's peaks come again before it lets go. */
const HOLD = 0.02;
/** How fast the limiter lets go once it has held (dB per second). */
const RELEASE_DB = 60;

/**
 * The four points between two samples that the true-peak filter of ITU-R BS.1770-4 (Annex 2) finds, as four FIR
 * filters of 12 taps each: tap j is x[n - j], and the four points are between x[n - 6] and x[n - 5].
 */
const PHASES = [
  [0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125, -0.0594482421875, 0.1373291015625, 0.97216796875, -0.102294921875, 0.047607421875, -0.0266113281250, 0.014892578125, -0.00830078125],
  [-0.0291748046875, 0.029296875, -0.0517578125, 0.089111328125, -0.16650390625, 0.465087890625, 0.77978515625, -0.2003173828125, 0.1015625, -0.0582275390625, 0.0330810546875, -0.0189208984375],
  [-0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625, -0.2003173828125, 0.77978515625, 0.465087890625, -0.16650390625, 0.089111328125, -0.0517578125, 0.029296875, -0.0291748046875],
  [-0.00830078125, 0.014892578125, -0.0266113281250, 0.047607421875, -0.102294921875, 0.97216796875, 0.1373291015625, -0.0594482421875, 0.033203125, -0.0196533203125, 0.010986328125, 0.001708984375],
].flat();
const TAPS = 12;
/** The frames the true-peak filter needs after a sample to have seen the sound on both sides of it. */
const PEAK_DELAY = 6;
/** The limiter's memory of frames, a power of two past what it looks back at (its delay and the filter's taps). */
const SIZE = 512;
const MASK = SIZE - 1;

/** A level in dB as a gain. @param {number} db */
export const dbGain = (db) => 10 ** (db / 20);

/** The frames between a sample going into the limiter and coming out, at `rate`. @param {number} [rate] */
export const limiterLatency = (rate = RATE) => Math.round(rate * ATTACK) + PEAK_DELAY;

/**
 * A limiter: the film's true peaks kept under a ceiling, what is under it not touched at all (the samples are the
 * ones given). Its gain comes down in a straight line over the ATTACK before a peak, so it is at the level the peak
 * needs when the peak comes, holds it for HOLD after, then goes back up at RELEASE_DB; both channels take the same gain. The
 * peaks are those between the samples too (BS.1770's true peak), as a player converting the sound to analog meets
 * them. It looks ahead: what comes out is what went in `latency` frames before (an export drops those first frames, the
 * preview hears the film that much later).
 */
export class Limiter {
  /** @param {number} [ceilingDb] @param {number} [rate] */
  constructor(ceilingDb = CEILING_DB, rate = RATE) {
    this.ceiling = dbGain(ceilingDb);
    this.ahead = Math.round(rate * ATTACK);
    /** The frames between a sample going in and coming out. */
    this.latency = limiterLatency(rate);
    this.hold = Math.round(rate * HOLD);
    this.release = dbGain(RELEASE_DB / rate);
    /* the share of the way back up to 1 the gain is k frames before a peak, k from 0 to `ahead` */
    this.ramp = Float64Array.from({ length: this.ahead + 1 }, (_, k) => k / (this.ahead + 1));
    this.l = new Float64Array(SIZE);
    this.r = new Float64Array(SIZE);
    /* each frame's true peak (both channels), and the gain it needs */
    this.peak = new Float64Array(SIZE);
    this.need = new Float64Array(SIZE);
    this.reset();
  }

  /** Back to how it starts: silence before, the gain at 1. */
  reset() {
    this.l.fill(0);
    this.r.fill(0);
    this.peak.fill(0);
    this.need.fill(1);
    /** frames taken in so far */
    this.n = 0;
    /** the latest frame that needs the gain under 1, and the latest such frame that went out */
    this.low = -Infinity;
    this.held = -Infinity;
    this.gain = 1;
  }

  /**
   * One frame in (`l`, `r`), and the frame `latency` frames before it out, into `outL[i]` and `outR[i]`.
   * @param {number} l @param {number} r @param {Float32Array} outL @param {Float32Array} outR @param {number} i
   */
  frame(l, r, outL, outR, i) {
    const { l: xl, r: xr, peak, need } = this;
    const n = this.n;
    xl[n & MASK] = l;
    xr[n & MASK] = r;
    /* frame n - 5's true peak: its own samples, and the four points between it and the one before */
    const at = (n - 5) & MASK;
    let p = Math.max(Math.abs(xl[at]), Math.abs(xr[at]));
    for (let k = 0; k < 4 * TAPS; k += TAPS) {
      let a = 0, b = 0;
      for (let j = 0; j < TAPS; j++) {
        const h = PHASES[k + j], back = (n - j) & MASK;
        a += h * xl[back];
        b += h * xr[back];
      }
      p = Math.max(p, Math.abs(a), Math.abs(b));
    }
    peak[at] = p;
    /* frame n - 6's gain needed: under the ceiling at its own sample and at the points on both sides of it */
    const m = n - PEAK_DELAY;
    const top = Math.max(peak[m & MASK], p);
    const v = top > this.ceiling ? this.ceiling / top : 1;
    need[m & MASK] = v;
    if (v < 1) this.low = m;
    /* frame o goes out: its gain held a while after a peak, then back up, and down to any peak ahead of it in a
       straight line */
    const o = m - this.ahead;
    let g = this.gain;
    if (o - this.held > this.hold) {
      g *= this.release;
      if (g > 1) g = 1;
    }
    if (this.low >= o) {
      for (let k = 0; k <= this.ahead; k++) {
        const w = need[(o + k) & MASK];
        if (w < 1) {
          const t = w + (1 - w) * this.ramp[k];
          if (t < g) g = t;
        }
      }
    }
    this.gain = g;
    if (need[o & MASK] < 1) this.held = o;
    outL[i] = xl[o & MASK] * g;
    outR[i] = xr[o & MASK] * g;
    this.n = n + 1;
  }
}

/**
 * The film's bus: the mix turned by the delivery gain (`gainDb`: as much as brings it to the loudness it is delivered
 * at, src/loudness.mjs toLoudness; 0 as mixed), then its peaks caught under `ceilingDb` (Limiter). Every film's sound
 * goes through it as it is delivered and as it is heard in the preview.
 */
export class Bus {
  /** @param {{ gainDb?: number, ceilingDb?: number, rate?: number }} [options] */
  constructor({ gainDb = 0, ceilingDb = CEILING_DB, rate = RATE } = {}) {
    this.limiter = new Limiter(ceilingDb, rate);
    this.gain = dbGain(gainDb);
    /* a change of gain in progress: by `step` a frame, `left` frames more */
    this.step = 0;
    this.left = 0;
    this.target = this.gain;
  }

  /** The frames between a sample going in and coming out (Limiter `latency`). */
  get latency() { return this.limiter.latency; }

  /**
   * Turn the bus to `db`, in a straight line over `frames` frames (the preview's, so a change while it plays does
   * not click; an export's gain is one for the whole film).
   * @param {number} db @param {number} [frames]
   */
  setGain(db, frames = 0) {
    this.target = dbGain(db);
    this.left = Math.max(0, Math.round(frames));
    if (this.left) this.step = (this.target - this.gain) / this.left;
    else this.gain = this.target;
  }

  /** Back to how it starts (the gain kept). */
  reset() {
    this.limiter.reset();
    if (this.left) { this.gain = this.target; this.left = 0; }
  }

  /**
   * A block through the bus: `inL`, `inR` in (the right the left itself for a mono block), what comes out of the
   * limiter into `outL`, `outR` (they may be the arrays given). Sound comes out `latency` frames after it went in.
   * @param {Float32Array} inL @param {Float32Array} inR @param {Float32Array} outL @param {Float32Array} outR
   */
  process(inL, inR, outL, outR) {
    const lim = this.limiter;
    for (let i = 0; i < inL.length; i++) {
      if (this.left) {
        this.left -= 1;
        this.gain = this.left ? this.gain + this.step : this.target;
      }
      const s = this.gain;
      lim.frame(inL[i] * s, inR[i] * s, outL, outR, i);
    }
  }
}

/**
 * A processor a clip's sound can go through: made for one clip with its step's settings and the rate, then given the
 * clip's sound block after block from where the clip starts. It may be given the same arrays in and out, and has no
 * latency (what comes out of a frame is that frame's).
 * @typedef {{ process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array): void }} Processor
 * @typedef {{ name: string } & Record<string, unknown>} Step one processor in a clip's chain, by name, with its settings
 */

/** The processors there are, by name: one map for this realm, whichever copy of this module defines them. */
const KEY = Symbol.for('openfilm.sound.processors');
/** @type {Map<string, (step: Step, rate: number) => Processor>} */
const processors = /** @type {Record<symbol, Map<string, (step: Step, rate: number) => Processor>>} */ (/** @type {unknown} */ (globalThis))[KEY] ??= new Map();

/**
 * Makes a processor known by `name`, for clips' chains. Internal for now, for the sound plugin: none is defined here.
 * In the preview a processor is defined in the AudioWorklet's scope (a module added to the audio context that calls
 * this), in the export in Node's; how a clip names its chain in film.html is the plugin's to decide.
 * @param {string} name @param {(step: Step, rate: number) => Processor} make
 */
export function defineProcessor(name, make) {
  processors.set(name, make);
}

/**
 * A clip's chain: the processors its sound goes through, in order, after its speed and before its volume and fades
 * (its own level, like a fader after the inserts), in the preview (studio/ui/src/editor/player.ts, a worklet node per
 * clip) and in the export (src/shared.mjs mix, in Node) alike. Null for none, the clip mixed as it is; no clip has one
 * today. A step whose processor is not defined is an error.
 * @param {readonly Step[] | undefined} steps @param {number} [rate] @returns {Processor | null}
 */
export function clipChain(steps, rate = RATE) {
  if (!steps?.length) return null;
  const stages = steps.map((step) => {
    const make = processors.get(step.name);
    if (!make) throw new Error(`no sound processor named "${step.name}"`);
    return make(step, rate);
  });
  return {
    process(inL, inR, outL, outR) {
      let l = inL, r = inR;
      for (const stage of stages) {
        stage.process(l, r, outL, outR);
        l = outL;
        r = outR;
      }
    },
  };
}
