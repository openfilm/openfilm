import type React from 'react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * The playing time as an external store. Keeping it in React state would re-render the whole editor each frame while
 * playing; only the few leaves that follow the clock (playhead, timecode, subtitles, stage outlines) subscribe to it,
 * and each changes the page only when what it shows changes.
 */
export interface PlaybackClock {
  get(): number;
  subscribe(fn: () => void): () => void;
  /**
   * The line the film plays on now (film `ms` at `at` on the page's clock, `rate` film ms a ms; held at `ms` until
   * `at`), or null while still: what moves by itself (the playhead) follows it without being told each frame.
   */
  line?(): { ms: number; at: number; rate: number } | null;
}

const NO_SUBSCRIBE = () => () => {};

/** Follow a PlaybackClock; without one, `fallback`. */
export function usePlaybackTime(clock: PlaybackClock | null | undefined, fallback: number): number {
  const read = (): number => (clock ? clock.get() : fallback);
  return useSyncExternalStore(clock ? clock.subscribe : NO_SUBSCRIBE, read, read);
}

/**
 * Follow a PlaybackClock, rendering again only when `step(ms)` changes (what is shown changes: another subtitle, its
 * next word), with the time it changed at; without a clock, `fallback`.
 */
export function useSteppedPlaybackTime(clock: PlaybackClock | null | undefined, fallback: number, step: (ms: number) => unknown): number {
  const [ms, setMs] = useState(fallback);
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    if (!clock) return undefined;
    let shown: unknown = Symbol('none');
    const tick = () => {
      const now = clock.get();
      const key = stepRef.current(now);
      if (key !== shown) { shown = key; setMs(now); }
    };
    tick();
    return clock.subscribe(tick);
  }, [clock]);
  return clock ? ms : fallback;
}

/**
 * Re-render only this small part as the clock moves: `<LiveTime clock={clock} timeMs={timeMs}>{(ms) => …}</LiveTime>`.
 * `step`: only when that says what is shown changed (see useSteppedPlaybackTime).
 */
export function LiveTime({
  clock,
  timeMs,
  step,
  children,
}: {
  clock: PlaybackClock | null | undefined;
  /** The time when there is no clock (or while stopped). */
  timeMs: number;
  step?: (ms: number) => unknown;
  children: (timeMs: number) => React.ReactNode;
}) {
  return step ? <SteppedTime clock={clock} timeMs={timeMs} step={step}>{children}</SteppedTime> : <EveryTime clock={clock} timeMs={timeMs}>{children}</EveryTime>;
}
function EveryTime({ clock, timeMs, children }: { clock: PlaybackClock | null | undefined; timeMs: number; children: (timeMs: number) => React.ReactNode }) {
  return <>{children(usePlaybackTime(clock, timeMs))}</>;
}
function SteppedTime({ clock, timeMs, step, children }: { clock: PlaybackClock | null | undefined; timeMs: number; step: (ms: number) => unknown; children: (timeMs: number) => React.ReactNode }) {
  return <>{children(useSteppedPlaybackTime(clock, timeMs, step))}</>;
}

/**
 * Text that follows the clock (a timecode): written into the page directly, and only when it reads differently, so a
 * playing film costs the editor no rendering for it.
 */
export function LiveText({ clock, timeMs, format, className }: {
  clock: PlaybackClock | null | undefined;
  timeMs: number;
  format: (ms: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const formatRef = useRef(format);
  formatRef.current = format;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let shown: string | null = null;
    const show = (ms: number) => {
      const text = formatRef.current(ms);
      if (text !== shown) { shown = text; el.textContent = text; }
    };
    if (!clock) { show(timeMs); return undefined; }
    const tick = () => show(clock.get());
    tick();
    return clock.subscribe(tick);
  }, [clock, timeMs, format]);
  return <span ref={ref} className={className} />;
}
