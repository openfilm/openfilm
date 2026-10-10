/**
 * Solo: listen to some tracks alone. The editor's own, for now (not in film.html, not kept): the other tracks are
 * silent in Studio's playback only; exports and the film are as they are.
 */

/** The clips heard while `solo` tracks (film.html indexes) are soloed: theirs alone; null when none is (all are). */
export function heardClips(tracks: readonly { clips: readonly { id: string }[] }[], solo: ReadonlySet<number>): Set<string> | null {
  if (!solo.size) return null;
  return new Set(tracks.flatMap((tr, i) => (solo.has(i) ? tr.clips.map((c) => c.id) : [])));
}

/** Solo turned on or off for track `index`; `only`: that track alone (⌥-click), or none when it was the only one. */
export function toggleSolo(solo: ReadonlySet<number>, index: number, only = false): Set<number> {
  if (only) return solo.size === 1 && solo.has(index) ? new Set() : new Set([index]);
  const next = new Set(solo);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}
