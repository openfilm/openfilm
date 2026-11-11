import type { Film, Op } from '../api.ts';
import { clipSpan } from '../../../../src/film-doc.mjs';
import { plainTrack } from '../../../server/track-layout.mjs';
import { filmClipKind } from './film.ts';
import { isLibraryText } from './timeline-layout.ts';

type Span = { id: string; start: number; end: number };
const overlaps = (a: Span, b: Span) => a.start < b.end - 1e-9 && b.start < a.end - 1e-9;
const byStart = (a: Span, b: Span) => a.start - b.start;

/**
 * Compact runs of compatible tracks from the bottom up. A clip can move down through a row only if nothing
 * there overlaps it, so no two overlapping clips change their stacking order. Keep a run as it was unless
 * the move actually frees a row.
 */
export function organizeTracks(
  film: Film,
  durations: ReadonlyMap<string, number>,
  protectedTracks: ReadonlySet<number>,
  protectedClips: ReadonlySet<string>,
): Op[] {
  const rows = film.tracks.map((track, i) => {
    if (protectedTracks.has(i) || !plainTrack(track) || !track.clips.length
        || track.clips.some((clip) => protectedClips.has(clip.id))) return null;
    const kinds = new Set(track.clips.map((clip) => isLibraryText(clip.src) ? 'text' : filmClipKind(clip)));
    if (kinds.size !== 1) return null;
    let spans: Span[];
    try {
      spans = track.clips.map((clip) => {
        const start = clip.at ?? 0;
        const { length } = clipSpan(clip, durations.get(clip.src));
        return { id: clip.id, start, end: start + length };
      }).sort(byStart);
    } catch {
      return null; // The source's duration is not known yet.
    }
    if (spans.some((span, j) => span.end <= span.start || (j > 0 && overlaps(spans[j - 1]!, span)))) return null;
    const [kind] = kinds;
    return { spans, kind };
  });

  const ops: Op[] = [];
  for (let at = 0; at < rows.length;) {
    const first = rows[at];
    if (!first) { at += 1; continue; }
    let end = at + 1;
    while (rows[end]?.kind === first.kind) end += 1;
    if (end > at + 1) {
      const lanes = rows.slice(at, end).map((row) => [...row!.spans]);
      for (let i = lanes.length - 2; i >= 0; i -= 1) {
        lanes[i] = lanes[i]!.filter((clip) => {
          let dest = i;
          while (dest + 1 < lanes.length && !lanes[dest + 1]!.some((other) => overlaps(clip, other))) dest += 1;
          if (dest === i) return true;
          lanes[dest]!.push(clip);
          return false;
        });
      }
      const compact = lanes.filter((lane) => lane.length);
      if (compact.length < lanes.length) {
        const from = film.tracks.slice(at, end).map((track) => track.clips.map((clip) => clip.id));
        const to = compact.map((lane) => lane.sort(byStart).map((clip) => clip.id));
        ops.push({ op: 'track-layout', at, from, to });
      }
    }
    at = end;
  }
  return ops.reverse(); // Earlier runs keep their indices as later ones shrink.
}
