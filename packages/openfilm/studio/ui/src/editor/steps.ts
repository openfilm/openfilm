/**
 * The edit history's two lists: the steps done (oldest first) and the steps undone (the last one undone last). Plain
 * functions, so the editor (use-film) and its tests move steps the same way.
 */
export type Steps<S> = { done: S[]; undone: S[] };

/** How many steps are kept: the oldest go first. */
const KEPT = 100;

/** A new step: it goes on the done list, and what was undone cannot be made again. */
export function pushStep<S>(s: Steps<S>, one: S): Steps<S> {
  return { done: [...s.done.slice(-(KEPT - 1)), one], undone: [] };
}

/**
 * `one` undone or made again: it moves to the other list. Only that step moves, so a list changed meanwhile (a step
 * left out) never moves another one, and never one that is not there.
 */
export function moveStep<S>(s: Steps<S>, one: S, kind: 'undo' | 'redo'): Steps<S> {
  const [from, to] = kind === 'undo' ? [s.done, s.undone] : [s.undone, s.done];
  if (!from.includes(one)) return s;
  const left = from.filter((x) => x !== one);
  const moved = [...to, one];
  return kind === 'undo' ? { done: left, undone: moved } : { done: moved, undone: left };
}

/** `one` cannot be undone or made again (what it was about changed since, elsewhere): it leaves both lists. */
export function dropStep<S>(s: Steps<S>, one: S): Steps<S> {
  return { done: s.done.filter((x) => x !== one), undone: s.undone.filter((x) => x !== one) };
}

/** The step the next undo or redo takes, or null at the end of the history (nothing is done then). */
export function nextStep<S>(s: Steps<S>, kind: 'undo' | 'redo'): S | null {
  const list = kind === 'undo' ? s.done : s.undone;
  return list.length ? list[list.length - 1] : null;
}
