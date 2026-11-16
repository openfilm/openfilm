// @ts-check

/** Postprocessing encoders can use two CPU threads apiece. Bound this stage by both CPU capacity and the drawing
 * budget, with at most four jobs retaining decoded frames at once.
 * @param {number} browsers @param {number} cores */
export const postprocessingLimit = (browsers, cores) => Math.max(1, Math.min(browsers, 4, Math.floor(cores / 2)));

/** A bounded stage of an export pipeline. Waiting work can be cancelled without taking a permit.
 * @param {number} limit */
export function workGate(limit) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('work limit must be a positive integer');
  let active = 0;
  /** @type {(() => void)[]} */ const waiting = [];
  /** @param {AbortSignal} signal @returns {Promise<() => void>} */
  return (signal) => {
    if (signal.aborted) return Promise.reject(signal.reason ?? new Error('cancelled'));
    return new Promise((resolve, reject) => {
      const cancel = () => {
        const index = waiting.indexOf(grant);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal.reason ?? new Error('cancelled'));
      };
      const grant = () => {
        signal.removeEventListener('abort', cancel);
        active++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          active--;
          waiting.shift()?.();
        });
      };
      if (active < limit) grant();
      else {
        waiting.push(grant);
        signal.addEventListener('abort', cancel, { once: true });
      }
    });
  };
}
