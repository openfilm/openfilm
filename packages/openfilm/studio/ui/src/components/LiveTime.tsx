import type React from 'react';
import { useSyncExternalStore } from 'react';

/**
 * The playing time as an external store. Keeping it in React state would re-render the whole editor ~20 times a
 * second while playing; only the few leaves that follow the clock (playhead, timecode, subtitles, stage outlines)
 * subscribe to it.
 */
export interface PlaybackClock {
  get(): number;
  subscribe(fn: () => void): () => void;
}

const NO_SUBSCRIBE = () => () => {};

/** Follow a PlaybackClock; without one, `fallback`. */
export function usePlaybackTime(clock: PlaybackClock | null | undefined, fallback: number): number {
  const read = (): number => (clock ? clock.get() : fallback);
  return useSyncExternalStore(clock ? clock.subscribe : NO_SUBSCRIBE, read, read);
}

/** Re-render only this small part as the clock moves: `<LiveTime clock={clock} timeMs={timeMs}>{(ms) => …}</LiveTime>`. */
export function LiveTime({
  clock,
  timeMs,
  children,
}: {
  clock: PlaybackClock | null | undefined;
  /** The time when there is no clock (or while stopped). */
  timeMs: number;
  children: (timeMs: number) => React.ReactNode;
}) {
  const live = usePlaybackTime(clock, timeMs);
  return <>{children(live)}</>;
}
