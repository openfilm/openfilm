// openfilm look --full: a rendered film watched frame by frame, for what a look at a dozen frames misses. White
// flashes, frames unlike those on both sides, stretches where the picture stands still, and near-black frames, each
// with its time. One decode by ffmpeg, the picture at two small sizes, gray.
import { spawn } from 'node:child_process';

/** The thresholds, in 8-bit luma (0–255): the mean over the picture, or the mean change of its pixels. */
export const WATCH = {
  /* 10 fps: brightness up by more than flashUp from one frame to the next, and down by more than flashBack within 0.4 s */
  flashUp: 18, flashBack: 12, flashWithin: 4,
  /* 10 fps: a frame that changed by more than jump from both its neighbours, which are closer to each other than
     jumpNeighbours (or than back × the jump: moving footage never agrees exactly) */
  jump: 14, jumpNeighbours: 5,
  /* the film's own rate: one or two frames that changed by more than flicker, after which the picture is back to
     within back × that change */
  flicker: 8, back: 0.35,
  /* 10 fps: a mean change below still from frame to frame, for stillFor seconds or more */
  still: 0.35, stillFor: 6,
  /* mean brightness below dark */
  dark: 12,
};
const LOW = { w: 96, h: 54, fps: 10 };
const FULL = { w: 64, h: 36 };

/** @typedef {{ kind: 'flash' | 'jump' | 'still' | 'dark', from: number, to: number, detail: string }} Finding */

/**
 * What is wrong in a rendered film, by time: `file` from `from` for `length` seconds (all of it without), at its frame
 * rate `fps`. Findings are sorted by time, `from` and `to` in seconds of the file.
 * @param {string} file @param {{ fps: number, from?: number, length?: number }} opts
 * @returns {Promise<Finding[]>}
 */
export async function watch(file, { fps, from = 0, length }) {
  const low = lowRate();
  const full = fullRate();
  const span = [...(from > 0 ? ['-ss', String(from)] : []), ...(length != null ? ['-t', String(length)] : [])];
  await frames(['-hide_banner', '-v', 'error', '-nostdin', ...span, '-i', file, '-an', '-filter_complex',
    `[0:v]split=2[a][b];[a]fps=${LOW.fps},scale=${LOW.w}:${LOW.h},format=gray[A];[b]fps=${fps},scale=${FULL.w}:${FULL.h},format=gray[B]`,
    '-map', '[A]', '-f', 'rawvideo', 'pipe:1', '-map', '[B]', '-f', 'rawvideo', 'pipe:3'], [low, full]);
  const at = (/** @type {number} */ t) => Math.round((from + t) * 100) / 100;
  /* one fault seen at both rates (or in two runs that touch) is said once */
  /** @type {Finding[]} */
  const out = [];
  for (const f of [...low.found(), ...full.found(fps)].sort((a, b) => a.from - b.from)) {
    const same = out.findLast((o) => o.kind === f.kind);
    if (same && f.from <= same.to + 0.1) same.to = Math.max(same.to, f.to);
    else out.push({ ...f });
  }
  return out.map((f) => ({ ...f, from: at(f.from), to: at(f.to) }));
}

/** @typedef {{ size: number, take: (frame: Buffer) => void }} Reader */

/** ffmpeg with each output pipe read in frames of its reader's size: stdout to the first, pipe 3 on to the rest. @param {string[]} argv @param {Reader[]} readers */
function frames(argv, readers) {
  return new Promise((done, fail) => {
    const p = spawn('ffmpeg', argv, { stdio: ['ignore', 'pipe', 'pipe', ...readers.slice(1).map(() => /** @type {const} */ ('pipe'))], windowsHide: true });
    let err = '';
    p.stdio[2]?.on('data', (d) => { err += d; });
    readers.forEach((r, i) => {
      let rest = Buffer.alloc(0);
      p.stdio[i === 0 ? 1 : i + 2]?.on('data', (/** @type {Buffer} */ d) => {
        const buf = rest.length ? Buffer.concat([rest, d]) : d;
        let at = 0;
        for (; buf.length - at >= r.size; at += r.size) r.take(buf.subarray(at, at + r.size));
        rest = Buffer.from(buf.subarray(at));
      });
    });
    p.on('error', fail);
    p.on('close', (code) => (code === 0 ? done(undefined) : fail(new Error(`ffmpeg could not read the film: ${err.trim().split('\n').pop() ?? `exit ${code}`}`))));
  });
}

/** Mean of |a - b| over two frames. @param {Buffer} a @param {Buffer} b */
function change(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d += Math.abs(a[i] - b[i]);
  return d / a.length;
}

/** Runs of frame numbers (one apart at most `join`) as [from, to) seconds at `rate`. @param {number[]} list @param {number} rate */
function stretches(list, rate, join = 1) {
  /** @type {[number, number][]} */
  const out = [];
  for (const i of list) {
    const last = out.at(-1);
    if (last && i - last[1] <= join) last[1] = i; else out.push([i, i]);
  }
  return out.map(([a, b]) => [a / rate, (b + 1) / rate]);
}

/** The 10 fps picture: flashes, jumps, stillness, darkness. */
function lowRate() {
  /** @type {number[]} */ const lum = [];
  /** @type {number[]} */ const diff = [];
  /** @type {number[]} */ const jumps = [];
  /** @type {Buffer | null} */ let prev = null;
  /** @type {Buffer | null} */ let prev2 = null;
  return {
    size: LOW.w * LOW.h,
    take(/** @type {Buffer} */ f) {
      let sum = 0;
      for (let i = 0; i < f.length; i += 1) sum += f[i];
      const n = lum.length;
      lum.push(sum / f.length);
      diff.push(prev ? change(f, prev) : 0);
      /* frame n-1 is unlike both its neighbours, which agree with each other */
      if (prev2 && diff[n - 1] > WATCH.jump && diff[n] > WATCH.jump
        && change(f, prev2) < Math.max(WATCH.jumpNeighbours, WATCH.back * Math.min(diff[n - 1], diff[n]))) jumps.push(n - 1);
      prev2 = prev;
      prev = Buffer.from(f);
    },
    /** @returns {Finding[]} */
    found() {
      /** @type {Finding[]} */
      const out = [];
      const flashes = [];
      for (let i = 1; i + WATCH.flashWithin < lum.length; i += 1) {
        if (lum[i] - lum[i - 1] > WATCH.flashUp && lum[i] - lum[i + WATCH.flashWithin] > WATCH.flashBack) flashes.push(i);
      }
      for (const [from, to] of stretches(flashes, LOW.fps, 2)) out.push({ kind: 'flash', from, to, detail: `the picture turns bright and back within ${WATCH.flashWithin / LOW.fps}s` });
      for (const [from, to] of stretches(jumps, LOW.fps)) out.push({ kind: 'jump', from, to, detail: 'a frame unlike the frames on both sides of it' });
      /** @type {number | null} */
      let run = null;
      [...diff, Infinity].forEach((d, i) => {
        if (i > 0 && d < WATCH.still) { run ??= i - 1; return; }
        if (run != null && (i - run) / LOW.fps >= WATCH.stillFor) out.push({ kind: 'still', from: run / LOW.fps, to: i / LOW.fps, detail: `the picture hardly changes for ${((i - run) / LOW.fps).toFixed(1)}s` });
        run = null;
      });
      const dark = lum.flatMap((l, i) => (l < WATCH.dark ? [i] : []));
      for (const [from, to] of stretches(dark, LOW.fps)) out.push({ kind: 'dark', from, to, detail: 'near black' });
      return out;
    },
  };
}

/** The picture at the film's own rate: one or two frames that come and go, which 10 fps can step over. */
function fullRate() {
  /** @type {Buffer[]} */ const recent = [];
  /** @type {Set<number>} */ const flicks = new Set();
  let n = 0;
  return {
    size: FULL.w * FULL.h,
    take(/** @type {Buffer} */ f) {
      recent.push(Buffer.from(f));
      if (recent.length > 4) recent.shift();
      const j = n++;
      for (const gap of [1, 2]) {
        if (j - gap < 1) continue;
        const before = recent[recent.length - 2 - gap], inside = recent[recent.length - 1 - gap], after = recent[recent.length - 1];
        const away = change(inside, before);
        if (away > WATCH.flicker && change(after, before) < WATCH.back * away) flicks.add(j - gap);
      }
    },
    /** @param {number} fps @returns {Finding[]} */
    found(fps) {
      return stretches([...flicks].sort((a, b) => a - b), fps, 2).map(([from, to]) => ({ kind: /** @type {const} */ ('jump'), from, to, detail: 'one or two frames that come and go' }));
    },
  };
}
