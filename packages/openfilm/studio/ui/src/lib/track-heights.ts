/**
 * Track heights: how tall each track is drawn on the timeline, set by dragging the bottom edge of its head or picked
 * small / medium / large from its menu. Studio's own, per project (`.film/settings.json` `trackHeights`), each with
 * the clips its track had then, so it stays with its track when tracks move (see lib/timeline-nav placeSaved).
 */
import { placeSaved, type ClipsOf } from './timeline-nav.ts';
import type { TimelineLaneKind } from './timeline-layout';

export type SavedTrackHeight = { height: number; index: number; clips: string[] };

/** The heights a track can have, px. */
export const TRACK_MIN_H = 28;
export const TRACK_MAX_H = 160;

/** Small, medium (the timeline's own) and large, for a picture track and a sound track. */
export const TRACK_SIZES = {
  small: { visual: 36, audio: 30 },
  medium: { visual: 56, audio: 44 },
  large: { visual: 96, audio: 80 },
} as const;
export type TrackSize = keyof typeof TRACK_SIZES;

export function clampTrackHeight(h: number): number {
  return Math.round(Math.max(TRACK_MIN_H, Math.min(TRACK_MAX_H, h)));
}

/** The size a height is, when it is one of them. */
export function sizeOf(height: number, kind: TimelineLaneKind): TrackSize | null {
  return (Object.keys(TRACK_SIZES) as TrackSize[]).find((s) => TRACK_SIZES[s][kind] === height) ?? null;
}

/** The heights kept, by film.html track index now. */
export function trackHeightsOf(saved: readonly SavedTrackHeight[], tracks: ClipsOf): Map<number, number> {
  return new Map([...placeSaved(saved, tracks)].map(([entry, i]) => [i, clampTrackHeight(entry.height)]));
}

/**
 * The heights to keep once tracks `indexes` are `height` tall (null: back to the timeline's own). The others are kept
 * with the clips their tracks have now; heights found on no track go.
 */
export function withTrackHeight(saved: readonly SavedTrackHeight[], tracks: ClipsOf, indexes: readonly number[], height: number | null): SavedTrackHeight[] {
  const placed = placeSaved(saved, tracks);
  const kept = saved.filter((entry) => placed.has(entry) && !indexes.includes(placed.get(entry)!))
    .map((entry) => ({ height: entry.height, index: placed.get(entry)!, clips: (tracks[placed.get(entry)!]?.clips ?? []).map((c) => c.id) }));
  if (height == null) return kept;
  return [...kept, ...indexes.map((index) => ({ height: clampTrackHeight(height), index, clips: (tracks[index]?.clips ?? []).map((c) => c.id) }))];
}
