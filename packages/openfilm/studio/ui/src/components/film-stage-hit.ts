/**
 * Which of the clips selected elsewhere (on the timeline) get an outline on the stage. Kept apart so it can be tested
 * without a DOM: when it goes wrong a person only sees "the box is off", the hardest bug to describe.
 *
 * One way of saying it at a time:
 * - the clip in hand is not outlined again: it already has a frame with handles, and a second line would read as two
 *   things selected;
 * - while dragging, none: the picture moves, and a line that cannot keep up points at nothing.
 */
export function linkedOutlines<T extends { loc: string }>(
  marks: readonly T[],
  pickedLoc: string | undefined,
  dragging: boolean,
): readonly T[] {
  if (dragging) return [];
  if (!pickedLoc) return marks;
  return marks.filter((mark) => mark.loc !== pickedLoc);
}
