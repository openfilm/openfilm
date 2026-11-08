/** Optional work after the first paint, in idle time; cancelled when its page/project goes away. */
export function afterPaintIdle(work: () => void): () => void {
  let idle: number | undefined;
  let timer: number | undefined;
  const frame = requestAnimationFrame(() => {
    if (window.requestIdleCallback) idle = window.requestIdleCallback(work, { timeout: 1500 });
    else timer = window.setTimeout(work, 200);
  });
  return () => {
    cancelAnimationFrame(frame);
    if (idle !== undefined) window.cancelIdleCallback(idle);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
