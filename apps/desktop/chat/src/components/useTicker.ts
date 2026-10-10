'use client';

import * as React from 'react';

/**
 * One clock shared by every row that shows a running time.
 *
 * With a timer per row, several running rows tick at unrelated moments and something always seems to flicker.
 * Five staggered ticks read as noise; one shared tick reads as a heartbeat.
 *
 * It runs only while someone is watching: the last unsubscribe stops it, so a finished conversation doesn't wake
 * every second.
 */
let listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let now = Date.now();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (!timer) {
    /* Set the time on start: the module may have loaded long ago, and the first frame would show seconds counted
       from then. */
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const listener of listeners) listener();
    }, 1000);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/* getSnapshot must return a stable value (React asks several times per render), so it reads the module variable,
   not Date.now(). */
const getSnapshot = (): number => now;
/** No "now" on the server: 0, and the renderer draws no seconds, so server and hydrated output match. */
const getServerSnapshot = (): number => 0;

/** The current time, ticking each second in phase everywhere. 0 when rendered on the server. */
export function useTick(): number {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Time since startedAt, `12s` / `1m 05s`; empty when unknown. */
export function elapsedLabel(startedAt: number | undefined, tick: number): string {
  if (!startedAt || !tick) return '';
  const seconds = Math.max(0, Math.floor((tick - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
