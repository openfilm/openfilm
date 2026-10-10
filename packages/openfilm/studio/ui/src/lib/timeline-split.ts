/**
 * Where a split cuts a clip, as film.html writes its halves: the left one's trim end, the right one's trim and place.
 *
 * film.html writes moments to the millisecond (ops.mjs rounds them), and a clip's length on the film is its trim over
 * its speed. So the cut is taken on a whole millisecond of the source, and the right half starts where that puts the
 * left one's end: worked out the other way round (the film moment rounded, the trim from it), a clip at speed 0.5
 * ends a millisecond past where the rest starts, and the two overlap.
 */
export type SplitHalves = {
  left: { end: number };
  /** `end` only when the clip writes one: without, the rest plays to the end of its file */
  right: { start: number; end?: number; at: number };
};

export function splitHalves(
  block: { startMs: number; endMs: number; speed?: number; anchor?: { trimFrom?: number; parentStartMs: number } },
  atMs: number,
  /** the clip's own trim end in film.html (source seconds), when it writes one */
  sourceEnd?: number,
): SplitHalves | null {
  const k = block.speed && block.speed > 0 ? block.speed : 1;
  const startMs = Math.round(block.startMs);
  const fromMs = Math.round((block.anchor?.trimFrom ?? 0) * 1000);
  /* source ms after the clip's in point: to the cut, and to its end */
  const cut = Math.round((atMs - startMs) * k);
  const ends = sourceEnd != null && Number.isFinite(sourceEnd);
  const total = ends ? Math.round(sourceEnd * 1000) - fromMs : Math.round((block.endMs - startMs) * k);
  if (!(cut > 0 && cut < total)) return null;
  const parentMs = block.anchor?.parentStartMs ?? 0;
  const end = (fromMs + cut) / 1000;
  /* the first half's length on the film, worked out as the timeline does from film.html (clipSpan's (to − from) /
     speed, to the ms): the rest starts there, not at its own rounding of the cut (450.5 ms is 450 one way, 451 the other) */
  const leftMs = Math.round(((end - fromMs / 1000) / k) * 1000);
  return {
    left: { end },
    /* no end written when the clip has none: worked out from its length on the film (to the ms), it could land past
       the file's own length (10.010667 s → 10.011) and the film would refuse to play */
    right: { start: end, ...(ends ? { end: (fromMs + total) / 1000 } : {}), at: (startMs - parentMs + leftMs) / 1000 },
  };
}
