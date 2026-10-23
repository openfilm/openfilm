// @ts-check
/** Deterministic short ramps at new audio-only cuts. No waveform analysis or picture/timing changes. */
import { clipFade, kindOf } from '../../src/film-doc.mjs';

/** @typedef {import('./ops.mjs').FilmValue} FilmValue */
/** @typedef {import('./ops.mjs').Clip & { overrides?: readonly unknown[], attrs?: Record<string, string> }} Clip */
/** @typedef {{ clip: Clip, at: number, end: number, from: number, to: number, speed: number }} Sound */
export const AUDIO_SMOOTHING_MS = /** @type {const} */ ([5, 10, 20]);

/** Only explicit finite source spans can be changed without probing media. @param {Clip} clip @returns {Sound | null} */
function sound(clip) {
  if (kindOf(clip) !== 'sound') return null;
  const from = Array.isArray(clip.time) ? clip.time[0] : 0;
  const to = Array.isArray(clip.time) ? clip.time[1] : undefined;
  const at = clip.at ?? 0, speed = clip.speed ?? 1;
  if (![from, to, at, speed].every((v) => typeof v === 'number' && Number.isFinite(v)) || !(Number(to) > Number(from)) || !(Number(speed) > 0)) return null;
  return { clip, at: Number(at), end: Number(at) + (Number(to) - Number(from)) / Number(speed), from: Number(from), to: Number(to), speed: Number(speed) };
}

/** Source identity at a seam, independent of a whole pair moving together or its track being reordered. @param {Sound} a @param {Sound} b */
const seamKey = (a, b) => JSON.stringify([a.clip.id, b.clip.id, a.clip.src, b.clip.src, a.to, b.from, a.speed, b.speed, a.clip.volume ?? 1, b.clip.volume ?? 1]);

/** @param {FilmValue} film */
function seams(film) {
  /** @type {{ a: Sound, b: Sound, key: string, enabled: boolean }[]} */
  const out = [];
  for (const track of film.tracks) {
    /* A non-sound or unresolved span between sounds is not a cut we can infer safely. */
    const sorted = track.clips.map((clip) => ({ clip, span: sound(clip), at: typeof clip.at === 'number' ? clip.at : 0 })).sort((a, b) => a.at - b.at);
    let earlierEnd = -Infinity;
    for (let i = 1; i < sorted.length; i++) {
      if (i > 1) earlierEnd = Math.max(earlierEnd, sorted[i - 2].span?.end ?? Infinity);
      const a = sorted[i - 1].span, b = sorted[i].span;
      if (!a || !b || Math.abs(a.end - b.at) > 0.001000001 || earlierEnd > b.at) continue;
      const audible = (/** @type {Clip} */ c) => c.volume !== 0 && c.attrs?.['data-audio-smoothing'] !== 'off';
      /* Splitting a continuous source alone creates no audible discontinuity. */
      const continuous = a.clip.src === b.clip.src && Math.abs(a.to - b.from) < 1e-6 && a.speed === b.speed && (a.clip.volume ?? 1) === (b.clip.volume ?? 1);
      out.push({ a, b, key: seamKey(a, b), enabled: !track.locked && !track.hidden && !track.muted && audible(a.clip) && audible(b.clip) && !continuous });
    }
  }
  return out;
}

/**
 * `before`: repair only new/changed seams; null: explicitly check/repair all. Existing fades and opted-out clips stay
 * untouched. Each ramp is in film seconds, not video frames. Unknown source lengths are left alone.
 * @param {FilmValue | null} before @param {FilmValue} after @param {number} ms @param {ReadonlySet<string>} [protectedIds]
 * @returns {import('./ops.mjs').Op | null}
 */
export function audioSmoothingOp(before, after, ms, protectedIds = new Set()) {
  if (!AUDIO_SMOOTHING_MS.includes(/** @type {5 | 10 | 20} */ (ms))) return null;
  const existing = new Set(before ? seams(before).map((s) => s.key) : []);
  /** @type {Map<Sound, Set<0 | 1>>} */
  const targets = new Map();
  /* The same clip can be a different Sound object at its next seam: group by its id. */
  /** @type {Map<string, Sound>} */
  const sounds = new Map();
  const add = (/** @type {Sound} */ s, /** @type {0 | 1} */ edge) => {
    if (protectedIds.has(s.clip.id)) return;
    const own = sounds.get(s.clip.id) ?? s;
    sounds.set(s.clip.id, own);
    const edges = targets.get(own) ?? new Set();
    edges.add(edge);
    targets.set(own, edges);
  };
  for (const { a, b, key, enabled } of seams(after)) {
    if (!enabled || existing.has(key)) continue;
    add(a, 1); add(b, 0);
  }
  /** @type {import('./ops.mjs').PropEdit[]} */
  const edits = [];
  for (const [s, edges] of targets) {
    const was = clipFade(s.clip) ?? [0, 0];
    const bare = [...edges].filter((e) => was[e] === 0);
    if (!bare.length) continue;
    const room = Math.max(0, s.end - s.at - was[0] - was[1]);
    const ramp = Math.floor(Math.min(ms, room * 1000 / bare.length) + 1e-7) / 1000;
    if (ramp <= 0) continue;
    /** @type {[number, number]} */
    const value = [was[0], was[1]];
    for (const e of bare) value[e] = ramp;
    edits.push({ clip: s.clip.id, prop: 'fade', value });
  }
  return edits.length ? { op: 'props', edits } : null;
}

/** A direct fade edit is intentional, including removing a fade. @param {import('./ops.mjs').Op[]} ops */
export function explicitFadeIds(ops) {
  const ids = new Set();
  for (const op of ops) {
    if (op.op === 'props') for (const e of op.edits) if (e.prop === 'fade' || e.prop === 'overrides') ids.add(e.clip);
    if (op.op === 'set' && op.field === 'overrides') ids.add(op.clip);
    if (op.op === 'fields' && 'overrides' in op.fields) ids.add(op.clip);
  }
  return ids;
}
