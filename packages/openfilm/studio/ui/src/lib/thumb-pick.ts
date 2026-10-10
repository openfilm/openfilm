/**
 * Which shot a cell of a clip's thumbnail row shows (BlockThumbs). The cells sit on the source's own time grid, the
 * first one straddling the clip's start; a cell stands for the part of it inside the clip, so the straddling one asks
 * for the clip's start, not for the grid time before it (a trimmed clip's row must not open on a frame from before its
 * in-point, often the source's black first frame). A shot from inside the clip beats a nearer one from outside it;
 * with none inside yet, the nearest of any: a far picture beats a half-empty clip, and exact shots replace it as they
 * arrive.
 */

/** Index of the sorted time nearest to `want` (binary search: dozens of cells, each scanning would be thousands of steps). */
function nearestIndex(sorted: readonly number[], want: number, lo = 0, hi = sorted.length - 1): number {
  const first = lo;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < want) lo = mid + 1; else hi = mid;
  }
  return lo > first && want - sorted[lo - 1]! < sorted[lo]! - want ? lo - 1 : lo;
}

/** First index whose time is at least `at` (sorted.length when none is). */
function firstAtLeast(sorted: readonly number[], at: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < at) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * The shot for a cell standing at `cellMs` on the grid of a clip that shows `fromMs`–`toMs` of its source (in-clip
 * source ms): `undefined` when there are no shots at all.
 */
export function pickShot(sorted: readonly number[], cellMs: number, fromMs: number, toMs: number): number | undefined {
  if (!sorted.length) return undefined;
  const want = Math.min(Math.max(cellMs, fromMs), toMs);
  const lo = firstAtLeast(sorted, fromMs);
  const hi = firstAtLeast(sorted, toMs + 1) - 1;
  if (lo <= hi) return sorted[nearestIndex(sorted, want, lo, hi)];
  return sorted[nearestIndex(sorted, want)];
}
