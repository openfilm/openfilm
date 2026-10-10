/**
 * The preview's frames (editor/Preview.tsx), each a load of the film: the one shown, and at most one loading behind
 * it, which replaces it once its first picture is drawn. Pure, so the order of things is tested apart from React.
 */
export type Frame = { key: number; ready: boolean; error?: string };

/** A new load behind the picture: the frame shown stays until it is drawn; one loading already is let go for it. */
export function reloaded(list: readonly Frame[]): Frame[] {
  const key = Math.max(0, ...list.map((f) => f.key)) + 1;
  return [...list.filter((f) => f.ready).slice(-1), { key, ready: false }];
}

/** Frame `key` drew its picture: it is the one shown, and the one it replaces goes. Unchanged when it was shown already. */
export function shownAfter(list: readonly Frame[], key: number): Frame[] {
  const i = list.findIndex((f) => f.key === key);
  if (i < 0 || list[i].ready) return list as Frame[];
  return [{ ...list[i], ready: true }, ...list.slice(i + 1)];
}

/**
 * Who is told of an edit: the frame shown, and each one whose film is up (said it is ready) though not shown yet. A
 * frame not up yet gets the latest film when it is (Preview's `born`).
 */
export function updateKeys(shown: number, up: ReadonlySet<number>): number[] {
  return [shown, ...[...up].filter((key) => key !== shown)];
}
