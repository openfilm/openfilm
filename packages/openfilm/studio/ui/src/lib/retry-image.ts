/**
 * A picture the server could not make yet — its browser still downloading on a first run, ffmpeg installed after
 * Studio started, a busy moment — is asked for again a few times, a little later each time. Gives up after the last.
 */
const RETRY_MS = [2000, 6000, 15000, 40000];

export function retryImage(img: HTMLImageElement, giveUp?: () => void): void {
  const n = Number(img.dataset.retry ?? 0);
  if (n >= RETRY_MS.length) { giveUp?.(); return; }
  img.dataset.retry = String(n + 1);
  window.setTimeout(() => {
    if (!img.isConnected) return;
    const url = new URL(img.src, window.location.href);
    url.searchParams.set('retry', String(n + 1));
    img.src = url.toString();
  }, RETRY_MS[n]);
}
