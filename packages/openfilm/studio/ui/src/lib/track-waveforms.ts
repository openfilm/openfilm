/**
 * How much of a video's content area is given to its sound: picked beside the track heights in the track's menu.
 * Kept with the track's clips in the project's settings, as its height is, so it follows a track that moves.
 */
import { placeSaved, type ClipsOf } from './timeline-nav.ts';

export const WAVEFORM_RATIOS = [30, 60, 90] as const;
export type WaveformRatio = typeof WAVEFORM_RATIOS[number];
export type SavedTrackWaveform = { ratio: WaveformRatio; index: number; clips: string[] };

/** The proportions kept, by film.html track index now. */
export function waveformRatiosOf(saved: readonly SavedTrackWaveform[], tracks: ClipsOf): Map<number, WaveformRatio> {
  return new Map([...placeSaved(saved, tracks)].map(([entry, i]) => [i, entry.ratio]));
}

/** Set one track's proportion, keeping the others with the tracks they belong to. */
export function withWaveformRatio(saved: readonly SavedTrackWaveform[], tracks: ClipsOf, index: number, ratio: WaveformRatio): SavedTrackWaveform[] {
  const placed = placeSaved(saved, tracks);
  const kept = saved.filter((entry) => placed.has(entry) && placed.get(entry) !== index)
    .map((entry) => ({ ratio: entry.ratio, index: placed.get(entry)!, clips: (tracks[placed.get(entry)!]?.clips ?? []).map((c) => c.id) }));
  return [...kept, { ratio, index, clips: (tracks[index]?.clips ?? []).map((c) => c.id) }];
}
