// @ts-check
/**
 * A sound that gives way to speech (a clip's `duck`, SPEC §1): lowered by its `duck` dB while someone speaks, back up
 * when they stop. The same numbers for every host, so the preview is heard as the render mixes it. Pure: no files, no
 * DOM; what was said comes in as cues.
 *
 * Who speaks: a sound with words beside it (its WebVTT, `vo/1.wav` → `vo/1.vtt`), at its cues' times; a sound that
 * is a voice by where it is (film-doc soundRole: vo/, voice…) without words, all along it. A video's own sound speaks
 * only where it has words: footage without them is the place's sound, not speech. A sound that gives way itself, or
 * is silent, never makes another give way.
 *
 * How it moves: down over ATTACK seconds before the first word, so the word is heard clear; up over RELEASE after the
 * last; pauses shorter than BRIDGE stay down, so the music does not pump between sentences.
 */
import { clipKind, DUCK_DB, DUCK_RANGE, soundRole } from './film-doc.mjs';

export { DUCK_DB, DUCK_RANGE };
export const ATTACK = 0.25;
export const RELEASE = 0.6;
export const BRIDGE = 1;

/** @typedef {{ src: string, at: number, from: number, to: number, volume: number, speed: number, duck?: number }} DuckSound */
/** @typedef {[number, number]} Span seconds, start and end */

/** Whether `n` is a `duck` there can be. @param {unknown} n @returns {n is number} */
export const isDuck = (n) => typeof n === 'number' && Number.isFinite(n) && n >= DUCK_RANGE[0] && n <= DUCK_RANGE[1];

/** The words beside a sound: its WebVTT, by the same name. @param {string} src */
export const wordsFile = (src) => src.replace(/\.[^./]*$/, '') + '.vtt';

/** A WebVTT timestamp in seconds (`01:02.500`, `1:01:02.500`), or NaN. @param {string} text */
function seconds(text) {
  const parts = text.trim().split(':').map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return NaN;
  return parts.reduce((s, n) => s * 60 + n, 0);
}

/** A WebVTT's cues, as their start and end in the file's seconds, in order. @param {string} text @returns {Span[]} */
export function cueSpans(text) {
  /** @type {Span[]} */
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*([\d:.]+)\s+-->\s+([\d:.]+)/.exec(line);
    if (!m) continue;
    const a = seconds(m[1]), b = seconds(m[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) out.push([a, b]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

/** How long a sound is on the film. @param {DuckSound} s */
const lengthOf = (s) => (s.to - s.from) / (s.speed || 1);

/** Spans joined where they overlap or are less than BRIDGE apart. @param {Span[]} spans @returns {Span[]} */
function joined(spans) {
  /** @type {Span[]} */
  const out = [];
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a - last[1] < BRIDGE) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * When someone speaks in the film, as film seconds: from each speaking sound's cues (`wordsOf(src)`: its cues in its
 * file's seconds, or null when it has no words), else all along a voice.
 * @param {readonly DuckSound[]} sounds @param {(src: string) => Span[] | null | undefined} wordsOf @returns {Span[]}
 */
export function speechSpans(sounds, wordsOf) {
  /** @type {Span[]} */
  const spans = [];
  for (const s of sounds) {
    if (s.duck || !(s.volume > 0)) continue;
    const end = s.at + lengthOf(s);
    const cues = wordsOf(s.src);
    if (cues?.length) {
      for (const [a, b] of cues) {
        const lo = Math.max(s.at, s.at + (a - s.from) / (s.speed || 1)), hi = Math.min(end, s.at + (b - s.from) / (s.speed || 1));
        if (hi > lo) spans.push([lo, hi]);
      }
    } else if (!cues && clipKind(s.src) !== 'video' && soundRole(s.src) === 'voice' && end > s.at) spans.push([s.at, end]);
  }
  return joined(spans);
}

/** A sound's gain at `db` dB down. @param {number} db */
export const duckGain = (db) => 10 ** (-db / 20);

/**
 * The gain a sound that gives way `db` dB has at film second `t` (1: as it is), as every host has it.
 * @param {readonly Span[]} speech @param {number} db @param {number} t
 */
export function duckAt(speech, db, t) {
  let down = 0;
  for (const [a, b] of speech) {
    if (t <= a - ATTACK || t >= b + RELEASE) continue;
    down = Math.max(down, t < a ? (t - (a - ATTACK)) / ATTACK : t > b ? (b + RELEASE - t) / RELEASE : 1);
  }
  return 1 - (1 - duckGain(db)) * down;
}

/**
 * The corners of that gain from film second `lo` to `hi`, as [second, gain], to be joined by straight lines (a
 * preview's gain ramps, a timeline's line): the gain at `lo` first, at `hi` last.
 * @param {readonly Span[]} speech @param {number} db @param {number} lo @param {number} hi @returns {Span[]}
 */
export function duckPoints(speech, db, lo, hi) {
  const g = duckGain(db);
  /** @type {Span[]} */
  const out = [[lo, duckAt(speech, db, lo)]];
  for (const [a, b] of speech) {
    for (const [t, v] of /** @type {Span[]} */ ([[a - ATTACK, 1], [a, g], [b, g], [b + RELEASE, 1]])) if (t > lo && t < hi) out.push([t, v]);
  }
  out.push([hi, duckAt(speech, db, hi)]);
  return out;
}

/**
 * The gain as an ffmpeg expression of its stream's `t` (film second `offset + t`), for the spans that reach into
 * `[lo, hi]`: 1 less the trapezoids under speech, which never overlap (BRIDGE is longer than ATTACK and RELEASE
 * together). '' when the sound never gives way there.
 * @param {readonly Span[]} speech @param {number} db @param {number} offset @param {number} lo @param {number} hi
 */
export function duckExpression(speech, db, offset, lo, hi) {
  const n = (/** @type {number} */ v) => String(Number(v.toFixed(6)));
  const f = offset ? `(t+${n(offset)})` : 't';
  const terms = speech.filter(([a, b]) => b + RELEASE > lo && a - ATTACK < hi)
    .map(([a, b]) => `clip(min(min((${f}-${n(a - ATTACK)})/${n(ATTACK)},1),(${n(b + RELEASE)}-${f})/${n(RELEASE)}),0,1)`);
  if (!terms.length) return '';
  return `1-${n(1 - duckGain(db))}*(${terms.join('+')})`;
}
