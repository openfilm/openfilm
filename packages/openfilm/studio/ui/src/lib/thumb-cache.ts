/**
 * Which thumbnails the timeline wants: the cell width shared by shooting and drawing, and the step shots are taken at.
 */

/**
 * How wide one thumbnail cell is on the timeline — the one number shooting and drawing share. If they ever differ,
 * shooting follows the film's steps and drawing the clip's, and every cell shows its neighbor's frame.
 */
export const THUMB_CELL_PX = 80;

/**
 * The step snapped up to a fixed ladder (1 · 2 · 2.5 · 5 × 10ⁿ ms). The raw step (cell width / px per ms) changes with
 * every zoom, which would make every zoom a new set of times and keys and shoot the whole timeline again. On the
 * ladder, zooming within a rung keeps the same times; cells are at most 2.5× sparser and still filled (each cell takes
 * the nearest shot).
 */
const LADDER = [1, 2, 2.5, 5];
export function ladderStepMs(rawMs: number): number {
  if (!(rawMs > 0)) return rawMs;
  let scale = 10 ** Math.floor(Math.log10(rawMs));
  for (;;) {
    for (const k of LADDER) {
      const step = k * scale;
      if (step >= rawMs - 1e-9) return step;
    }
    scale *= 10;
  }
}

/** The stretch one picture clip takes on the timeline. */
export interface ThumbSpan {
  startMs: number;
  endMs: number;
}

/**
 * One extra shot for every clip no step falls into (times and spans in the clip's source ms). Zoomed out, a step can
 * be longer than a clip, and that clip would show its neighbors' frames, at that zoom for good. The extra shot is ~28% into the clip (its first frames
 * often still fade in), fixed by the clip alone so it stays cached across zooms.
 */
export function thumbAnchorTimes(opts: {
  times: readonly number[];
  spans: readonly ThumbSpan[];
  fromMs?: number;
  toMs?: number;
}): number[] {
  const from = opts.fromMs ?? -Infinity;
  const to = opts.toMs ?? Infinity;
  const out: number[] = [];
  for (const span of opts.spans) {
    const dur = span.endMs - span.startMs;
    if (!(dur > 0)) continue;
    if (span.endMs <= from || span.startMs >= to) continue;
    if (opts.times.some((t) => t >= span.startMs && t < span.endMs)) continue;
    /* 28% in, not before 240 ms, not past the end; clips under 240 ms take the middle */
    const into = dur <= 240
      ? dur / 2
      : Math.min(Math.max(240, dur * 0.28), Math.max(0, dur - 40));
    const t = Math.round(span.startMs + into);
    if (!out.includes(t)) out.push(t);
  }
  return out;
}
