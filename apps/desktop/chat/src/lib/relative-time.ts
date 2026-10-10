'use client';

/**
 * "38 minutes ago": how long ago a message or reply was (shown under it on hover).
 *
 * Intl.RelativeTimeFormat in the UI language, no strings of our own. Beyond a week it gives the date: "43 days
 * ago" makes the reader do the arithmetic.
 *
 * One minute tick for the whole page (useMinuteTick): a long conversation has dozens of times, and a timer each
 * would wake dozens of components every minute.
 */
import * as React from 'react';

export function relativeTime(iso: string | undefined, locale: string, now: number): string {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at) || !now) return '';
  /* `now` moves once a minute (useMinuteTick), so a line from the last few seconds can be up to a minute
     "ahead" of it: that is just now, never "in 1 minute". */
  const sec = Math.min(0, Math.round((at - now) / 1000));
  const fmt = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(sec);
  if (abs < 45) return fmt.format(0, 'second');
  if (abs < 3600) return fmt.format(Math.round(sec / 60), 'minute');
  if (abs < 86_400) return fmt.format(Math.round(sec / 3600), 'hour');
  if (abs < 7 * 86_400) return fmt.format(Math.round(sec / 86_400), 'day');
  return new Date(at).toLocaleDateString(locale, { month: 'short', day: 'numeric', ...(new Date(at).getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
}

const listeners = new Set<() => void>();
let minute = Date.now();
let timer: number | null = null;
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (timer == null) { minute = Date.now(); timer = window.setInterval(() => { minute = Date.now(); listeners.forEach((l) => l()); }, 60_000); }
  return () => {
    listeners.delete(fn);
    if (!listeners.size && timer != null) { window.clearInterval(timer); timer = null; }
  };
}
const snapshot = () => minute;
const serverSnapshot = () => 0;

/** Now, updated once a minute. */
export function useMinuteTick(): number {
  return React.useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
