/**
 * The library drawer's categories as the person arranges them in Settings › Advanced (Studio's prefs,
 * `libraryCategories`): their order and which are shown. The media always comes first and is always shown; a category
 * the arrangement does not name (one added since) takes its place in OpenFilm's order. Kept and read by
 * components/library/arrangement (Studio's prefs).
 */

/** The order of every category but the media, and the ones turned off, by name. */
export type LibraryArrangement = { order: string[]; off: string[] };

/** The category that is always first and always shown. */
export const FIRST_CATEGORY = 'media';

/** Categories made one since an arrangement could name them: the old name → the one it is part of now (the skills are among the plugins). */
const MERGED: Readonly<Record<string, string>> = { skill: 'plugin' };

/**
 * An arrangement kept before categories were made one, in today's names (those of `all`): each old name as the one it
 * is part of, in the first place one of them had; off only when every one of them the arrangement names was off.
 */
function inTodaysNames(all: readonly string[], arranged: LibraryArrangement): LibraryArrangement {
  const now = (c: string) => (!all.includes(c) && MERGED[c] && all.includes(MERGED[c]) ? MERGED[c] : c);
  const on = new Set(arranged.order.filter((c) => !arranged.off.includes(c)).map(now));
  return { order: arranged.order.map(now), off: arranged.off.map(now).filter((c) => !on.has(c)) };
}

/**
 * Every category in the person's order (`all`: OpenFilm's), with whether it is shown: the media first; then the ones
 * the arrangement names, in its order; then the rest where OpenFilm has them.
 */
export function arrangedCategories<C extends string>(all: readonly C[], kept: LibraryArrangement | null | undefined): { id: C; on: boolean }[] {
  const arranged = kept ? inTodaysNames(all, kept) : null;
  const rest = all.filter((c) => c !== FIRST_CATEGORY);
  const named = [...new Set((arranged?.order ?? []).filter((c): c is C => rest.includes(c as C)))];
  const order = [...named];
  for (const c of rest) {
    if (order.includes(c)) continue;
    /* one not named: after the one before it in OpenFilm's order, else first */
    const before = rest.slice(0, rest.indexOf(c)).reverse().find((b) => order.includes(b));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, c);
  }
  const off = new Set(arranged?.off ?? []);
  return [
    ...(all.includes(FIRST_CATEGORY as C) ? [{ id: FIRST_CATEGORY as C, on: true }] : []),
    ...order.map((id) => ({ id, on: !off.has(id) })),
  ];
}
