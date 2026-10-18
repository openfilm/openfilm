/**
 * Which stretches of a film play late in the preview, from how playing went (editor/Preview's `onPlayed`, about once a
 * second while playing): the refreshes the screen had per half second of film, and how many of them got no new frame.
 * A stretch where many did is rendered in the background (studio/server/preview-cache.mjs) and played from that
 * render from then on. Kept free of React so it is tested as it is.
 */

/** Per half second of film (its start, s): refreshes seen there while playing, and how many got no new frame. */
export type Heat = Map<number, { frames: number; late: number }>;

/** Refreshes a half second keeps counting before older ones count less: what it does now outweighs what it did. */
const HEAT_KEEP = 120;
/** Late on this share of refreshes or more, a half second plays late. */
export const LATE_SHARE = 0.12;
/** Refreshes a half second needs before it is judged (a stretch only glimpsed says little). */
const HEAT_SEEN = 20;
/** A stretch is rendered with this much more on each side (s), and at least this long. */
const PAD = 0.25;
const SHORTEST = 1;

/** Add how playing went (`spans`: [half second's start, refreshes, late]). */
export function addHeat(heat: Heat, spans: readonly (readonly [number, number, number])[]): void {
  for (const [t, frames, late] of spans) {
    if (!(frames > 0) || !Number.isFinite(t)) continue;
    const had = heat.get(t) ?? { frames: 0, late: 0 };
    let next = { frames: had.frames + frames, late: had.late + Math.min(late, frames) };
    if (next.frames > HEAT_KEEP) {
      const k = HEAT_KEEP / next.frames;
      next = { frames: next.frames * k, late: next.late * k };
    }
    heat.set(t, next);
  }
}

/**
 * The stretches that play late, film seconds [a, b): half seconds late on LATE_SHARE of their refreshes or more,
 * joined across a gap of half a second, PAD more on each side, SHORTEST at least, in order.
 */
export function lateStretches(heat: Heat): [number, number][] {
  const late = [...heat].filter(([, h]) => h.frames >= HEAT_SEEN && h.late / h.frames >= LATE_SHARE).map(([t]) => t).sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const t of late) {
    const last = out.at(-1);
    if (last && t <= last[1] + 0.5 + 1e-9) last[1] = t + 0.5;
    else out.push([t, t + 0.5]);
  }
  return out.map(([a, b]) => {
    let from = Math.max(0, a - PAD);
    let to = b + PAD;
    if (to - from < SHORTEST) { const mid = (from + to) / 2; from = Math.max(0, mid - SHORTEST / 2); to = from + SHORTEST; }
    return [round(from), round(to)] as [number, number];
  });
}

const round = (s: number) => Math.round(s * 1000) / 1000;

/** Two lists of stretches the same. */
export function sameStretches(a: readonly (readonly [number, number])[], b: readonly (readonly [number, number])[]): boolean {
  return a.length === b.length && a.every(([x, y], i) => x === b[i][0] && y === b[i][1]);
}

/** Stretches as one list: in order, those that overlap or touch joined. */
export function joinStretches(list: readonly (readonly [number, number])[]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of [...list].sort((x, y) => x[0] - y[0])) {
    const last = out.at(-1);
    if (last && a <= last[1] + 1e-9) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
