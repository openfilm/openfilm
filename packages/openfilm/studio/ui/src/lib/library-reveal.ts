/**
 * Showing one of the library's categories from elsewhere (the Community's page of a thing that is in the library): the
 * drawer opens on that category. Asked before the drawer is drawn, it is taken as the drawer opens.
 */
/** A category, and a line of it (a group, a pack) when one is asked for. */
export interface Revealed { category: string; group?: string }
const listeners = new Set<(asked: Revealed) => void>();
let asked: Revealed | null = null;

/** Open the library on a category (its id: `sound`, `transition`…), on one of its groups when given. */
export function revealInLibrary(category: string, group?: string): void {
  asked = { category, ...(group ? { group } : {}) };
  for (const l of listeners) l(asked);
}

/** Listen for a category asked for. → stop listening. */
export function onRevealInLibrary(listener: (asked: Revealed) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The category asked for and not yet shown, taken (none: null). */
export function takeRevealed(): Revealed | null {
  const was = asked;
  asked = null;
  return was;
}
