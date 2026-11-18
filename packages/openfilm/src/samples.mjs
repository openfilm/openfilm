// @ts-check

/**
 * The times a contact sheet draws, spread over the whole stretch with both ends taken: four frames over 0–3 s
 * are 0, 1, 2, 3. Dividing by `count` instead leaves the last slice of the film out, so the sheet never watched
 * its end and a draw-twice check could not see a page that changes there. One frame is the start of the stretch.
 * @param {number} from @param {number} to @param {number} count
 * @returns {number[]}
 */
export function sheetTimes(from, to, count) {
  const n = Number.isFinite(count) ? Math.max(1, Math.round(count)) : 1;
  return Array.from({ length: n }, (_, i) => (n === 1 ? from : from + ((to - from) * i) / (n - 1)));
}

/** Frames across each range of a sheet of several moments, unless --count says otherwise: its start, middle and end. */
export const MOMENT_FRAMES = 3;

/**
 * The times a sheet of several moments draws, in the order they were given: a time once, a range `perRange` frames
 * across it (sheetTimes), so every cut of a film is checked in one look.
 * @param {Array<number | [number, number]>} moments @param {number} [perRange]
 * @returns {number[]}
 */
export function momentTimes(moments, perRange = MOMENT_FRAMES) {
  return moments.flatMap((m) => (Array.isArray(m) ? sheetTimes(m[0], m[1], perRange) : [m]));
}
