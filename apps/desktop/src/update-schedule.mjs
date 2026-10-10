/**
 * When the app checks for updates by itself: 15 s after it starts, then every 6 hours, and 15 s after the computer
 * wakes (once its network is back; a burst of wakes is one check). A check that failed is tried again on the next
 * 5-minute tick, so a dropped connection does not cost 6 hours; a feed that is not there (a channel nothing was
 * published to yet) is tried hourly.
 */
export const FIRST_CHECK_MS = 15_000;
export const TICK_MS = 5 * 60_000;
export const EVERY_MS = 6 * 60 * 60_000;
export const UNAVAILABLE_RETRY_MS = 60 * 60_000;
export const WAKE_MS = 15_000;

/** @param {{ controller: { check: () => Promise<any>, snapshot: () => { status: string, error: string | null } }, now?: () => number }} options */
export function scheduleUpdateChecks({ controller, now = Date.now }) {
  let lastCheck = 0;
  const check = () => { lastCheck = now(); void controller.check(); };
  const first = setTimeout(check, FIRST_CHECK_MS);
  const tick = setInterval(() => {
    const { status, error } = controller.snapshot();
    const since = now() - lastCheck;
    if (since >= EVERY_MS || (status === 'error' && (error !== 'unavailable' || since >= UNAVAILABLE_RETRY_MS))) check();
  }, TICK_MS);
  let wakeTimer = null;
  return {
    wake() {
      clearTimeout(wakeTimer);
      wakeTimer = setTimeout(check, WAKE_MS);
    },
    stop() {
      clearTimeout(first);
      clearTimeout(wakeTimer);
      clearInterval(tick);
    },
  };
}
