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

/**
 * The device pixels a page draws per CSS px in the viewer (its devicePixelRatio there): what the viewer shows of the
 * film (`k`, viewer px per stage px, times the screen's `dpr`), in quarter steps rounded up, so a small resize does not
 * load the film again; never more than the screen's own, nor under a quarter.
 */
export function pageScaleFor(k: number, dpr: number): number {
  const shown = Math.max(0.25, k * dpr);
  return Math.min(dpr, Math.ceil(shown * 4 - 1e-9) / 4);
}
