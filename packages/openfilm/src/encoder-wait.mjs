/**
 * A pipe write or encoder flush can wait forever when a GPU driver stops responding. This is an inactivity
 * deadline for an encoder operation, never a limit on how long drawing a film may take. The caller stops the
 * process on failure; the `ffmpeg:` prefix lets render's hardware fallback retry with the processor.
 */
export function encoderWait(pending, { signal, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    let timer;
    const clear = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const abort = () => { clear(); reject(new Error('cancelled')); };
    Promise.resolve(pending).then(value => { clear(); resolve(value); }, error => { clear(); reject(error); });
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => {
      clear();
      reject(Object.assign(new Error(`ffmpeg: encoder stopped responding for ${Math.round(timeoutMs / 1000)} s`), { code: 'ENCODER_STALLED' }));
    }, timeoutMs);
    timer.unref?.();
  });
}
