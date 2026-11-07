/**
 * How long the app waits before starting its Studio again after it stopped. A Studio that stops again and again at
 * once (a port taken, a project it cannot open) was started again every second, without end: each start loading
 * every tab again. Now the wait doubles each time it stops soon after starting, up to RESTART_MAX_MS; one that ran a
 * while (SETTLED_MS) starts again at once, as before. Reads no Electron module, so `node --test` can use it.
 */
export const RESTART_MS = 1000;
export const RESTART_MAX_MS = 60_000;
export const SETTLED_MS = 60_000;

/** The wait before the next start: `last`, the wait before this Studio started (0: none); `ran`, how long it ran (ms). */
export function restartDelay(last, ran) {
  if (ran >= SETTLED_MS || !last) return RESTART_MS;
  return Math.min(RESTART_MAX_MS, last * 2);
}
