/**
 * Small rules of the Projects page: how long its list is waited for, and when a card asks again for a poster that is
 * still being drawn.
 */

/** How long the list is waited for before the page says it could not load it (and offers to try again). */
export const LIST_WAIT_MS = 15_000;

/** What `promise` gives, or a failure once `ms` have passed without it. */
export function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`no answer within ${ms / 1000} s`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); done(value); },
      (error: unknown) => { clearTimeout(timer); fail(error); },
    );
  });
}

/**
 * A card's poster that did not come (still being drawn, which Studio answers at once rather than hold the browser's
 * connection): asked for again after this many ms, `tried` times so far; null: given up (the card keeps its face).
 */
export function posterRetryDelay(tried: number): number | null {
  return tried < 4 ? 4000 * 2 ** tried : null;
}

/** The poster's address for try `n` (0: the first), so the browser asks Studio again rather than its cache. */
export function posterTry(url: string, n: number): string {
  return n ? `${url}${url.includes('?') ? '&' : '?'}try=${n}` : url;
}
