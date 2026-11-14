/**
 * The film's sound rendered through the sound engine (src/sound-engine.mjs) in Node: ffmpeg decodes (the mix, and
 * each clip that has a chain), the engine processes the samples, ffmpeg encodes them. The engine's code is the one the
 * preview's AudioWorklet runs, so what is delivered is what was heard, sample for sample, for the same mix.
 */
import { spawn } from 'node:child_process';
import { RATE } from './sound-engine.mjs';

/** Frames processed at a time. */
const BLOCK = 4096;
/** ffmpeg's raw sound in and out of Node: 32-bit float, stereo, at the engine's rate. */
const RAW = ['-f', 'f32le', '-ac', '2', '-ar', String(RATE)];

/**
 * ffmpeg with `args`, its sound read from (`out`) or written to (`in`) a pipe. `done` settles when it has ended: with
 * its error when it failed, unless it was stopped on purpose (`stop`).
 * @param {string[]} args @param {'in' | 'out'} pipe
 */
function ffmpeg(args, pipe) {
  const proc = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args],
    { stdio: [pipe === 'in' ? 'pipe' : 'ignore', pipe === 'out' ? 'pipe' : 'ignore', 'pipe'], windowsHide: true });
  let err = '';
  let stopped = false;
  proc.stderr?.on('data', (d) => { err += d; });
  /** @type {Promise<void>} */
  const done = new Promise((ok, fail) => {
    proc.on('error', (e) => fail(new Error(`ffmpeg: ${/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT' ? 'not found on the PATH' : e.message}`)));
    proc.on('close', (code) => (code === 0 || stopped ? ok() : fail(new Error(`ffmpeg: ${err.trim() || `exit ${code}`}`))));
  });
  done.catch(() => {});
  const stop = () => {
    stopped = true;
    /* what it wrote and was not read is let go of: until then the process does not close */
    proc.stdout?.destroy();
    if (proc.exitCode === null && proc.signalCode === null) {
      if (process.platform === 'win32' && proc.pid) spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => proc.kill());
      else proc.kill('SIGKILL');
    }
  };
  return { proc, done, stop };
}

/** Raw stereo frames read from a stream, as many as asked for at a time. */
class Frames {
  /** @param {NodeJS.ReadableStream} stream */
  constructor(stream) {
    this.it = stream[Symbol.asyncIterator]();
    /** @type {Buffer} */
    this.buf = Buffer.alloc(0);
    this.ended = false;
  }

  /**
   * Up to `n` frames into `l` and `r` from their start, how many there were (fewer only at the end).
   * @param {number} n @param {Float32Array} l @param {Float32Array} r
   */
  async read(n, l, r) {
    /** @type {Buffer[]} */
    const more = [this.buf];
    let have = this.buf.length;
    while (have < n * 8 && !this.ended) {
      const next = await this.it.next();
      if (next.done) this.ended = true;
      else { more.push(/** @type {Buffer} */ (next.value)); have += next.value.length; }
    }
    const buf = more.length > 1 ? Buffer.concat(more) : this.buf;
    const got = Math.min(n, Math.floor(buf.length / 8));
    /* copied to a buffer of its own: a chunk's floats may not start at a multiple of four */
    const f = new Float32Array(got * 2);
    new Uint8Array(f.buffer).set(buf.subarray(0, got * 8));
    for (let i = 0; i < got; i++) { l[i] = f[2 * i]; r[i] = f[2 * i + 1]; }
    this.buf = buf.subarray(got * 8);
    return got;
  }
}

/**
 * A clip whose sound goes through a chain before it is mixed: `args` are ffmpeg's input options and filters that
 * decode its sound alone (cut, at its speed, stereo, at the engine's rate); it is added from frame `start` on, each
 * frame turned by `gain` (its volume and fades, by the frame of its own sound).
 * @typedef {{ args: string[], start: number, chain: import('./sound-engine.mjs').Processor, gain: (frame: number) => number }} ChainClip
 */

/**
 * The film's sound: the mix ffmpeg makes from `source` (its input options and filters, or null for silence), the
 * clips with chains added to it (`clips`), through `bus` (none: as it is), encoded with `codec` into `out`. `frames`
 * long (Infinity: as long as the source). Fails with ffmpeg's error, and stops when `signal` is aborted or after
 * `timeoutMs`.
 * @param {{ source: string[] | null, clips?: ChainClip[], bus: import('./sound-engine.mjs').Bus | null, frames: number,
 *   out: string, codec: string[], signal?: AbortSignal, timeoutMs?: number, what?: string }} job
 */
export async function renderSound({ source, clips = [], bus, frames, out, codec, signal, timeoutMs = 0, what = 'the sound' }) {
  if (signal?.aborted) throw new Error('cancelled');
  if (source == null && !Number.isFinite(frames)) throw new Error('a sound of silence needs a length');
  const encoder = ffmpeg([...RAW, '-i', 'pipe:0', ...codec, out], 'in');
  const decoder = source ? ffmpeg([...source, ...RAW, 'pipe:1'], 'out') : null;
  /** @type {Map<ChainClip, { run: ReturnType<typeof ffmpeg>, frames: Frames, at: number, ended: boolean }>} */
  const open = new Map();
  const all = [encoder, ...(decoder ? [decoder] : [])];
  let failure = /** @type {Error | null} */ (null);
  const fail = (/** @type {Error} */ e) => {
    failure ??= e;
    for (const run of [...all, ...[...open.values()].map((c) => c.run)]) run.stop();
  };
  for (const run of all) run.done.catch(fail);
  const cancel = () => fail(new Error('cancelled'));
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = timeoutMs > 0 ? setTimeout(() => fail(new Error(`${what} did not finish within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs) : null;
  timer?.unref();
  /* a pipe closed by a process that failed: its error is the one told */
  encoder.proc.stdin?.on('error', () => {});
  try {
    const src = decoder?.proc.stdout ? new Frames(decoder.proc.stdout) : null;
    const lag = bus ? bus.latency : 0;
    const inL = new Float32Array(BLOCK), inR = new Float32Array(BLOCK);
    const outL = new Float32Array(BLOCK), outR = new Float32Array(BLOCK);
    const cl = new Float32Array(BLOCK), cr = new Float32Array(BLOCK);
    let length = frames;
    for (let at = 0; at - lag < length; at += BLOCK) {
      if (failure) throw failure;
      /* the mix: the frames there are, silence after its end (the limiter's last frames come out of it) */
      const want = Math.max(0, Math.min(BLOCK, length - at));
      const got = src && want ? await src.read(want, inL, inR) : 0;
      if (src && got < want && !Number.isFinite(length)) length = at + got;
      inL.fill(0, got);
      inR.fill(0, got);
      const end = Math.min(at + BLOCK, length);
      for (const clip of clips) {
        if (clip.start >= end || at >= end) continue;
        let c = open.get(clip);
        if (!c) {
          const run = ffmpeg([...clip.args, ...RAW, 'pipe:1'], 'out');
          run.done.catch(fail);
          c = { run, frames: new Frames(/** @type {NodeJS.ReadableStream} */ (run.proc.stdout)), at: 0, ended: false };
          open.set(clip, c);
        }
        if (c.ended) continue;
        /* its frames in this block, from where it got to */
        const from = Math.max(at, clip.start + c.at);
        const n = await c.frames.read(end - from, cl, cr);
        /* its sound ended before the block did: it is let finish, and its error, if any, told */
        if (n < end - from) c.ended = true;
        const part = (/** @type {Float32Array} */ a) => a.subarray(0, n);
        clip.chain.process(part(cl), part(cr), part(cl), part(cr));
        for (let i = 0; i < n; i++) {
          const g = clip.gain(c.at + i);
          inL[from - at + i] += cl[i] * g;
          inR[from - at + i] += cr[i] * g;
        }
        c.at += n;
        /* the film ends before its sound does: the rest is not wanted */
        if (!c.ended && clip.start + c.at >= length) { c.ended = true; c.run.stop(); }
      }
      if (bus) bus.process(inL, inR, outL, outR);
      else { outL.set(inL); outR.set(inR); }
      /* out: the frames from 0 to the end, `lag` frames after they went in */
      const first = Math.max(0, lag - at), last = Math.min(BLOCK, length + lag - at);
      if (last > first) {
        const f = new Float32Array((last - first) * 2);
        for (let i = first; i < last; i++) { f[2 * (i - first)] = outL[i]; f[2 * (i - first) + 1] = outR[i]; }
        const stdin = /** @type {NodeJS.WritableStream} */ (encoder.proc.stdin);
        if (!stdin.write(Buffer.from(f.buffer))) {
          await new Promise((drained) => {
            const go = () => { stdin.off('drain', go); encoder.proc.off('close', go); drained(undefined); };
            stdin.on('drain', go);
            encoder.proc.on('close', go);
          });
        }
      }
    }
    if (failure) throw failure;
    /* a decoder that ended has its say (a file it could not read); one with more than the film needs is stopped */
    if (src?.ended) await decoder?.done;
    else decoder?.stop();
    for (const c of open.values()) if (!c.ended) c.run.stop();
    await Promise.all([...open.values()].map((c) => c.run.done));
    encoder.proc.stdin?.end();
    await encoder.done;
    if (failure) throw failure;
  } catch (e) {
    fail(e instanceof Error ? e : new Error(String(e)));
    throw failure ?? e;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
