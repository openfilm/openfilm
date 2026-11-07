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
