/**
 * Showing one of the library's categories from elsewhere (the Community's page of a thing that is in the library): the
 * drawer opens on that category. Asked before the drawer is drawn, it is taken as the drawer opens.
 */
const listeners = new Set<(category: string) => void>();
let asked: string | null = null;

/** Open the library on a category (its id: `sound`, `transition`…). */
export function revealInLibrary(category: string): void {
  asked = category;
  for (const l of listeners) l(category);
}

/** Listen for a category asked for. → stop listening. */
export function onRevealInLibrary(listener: (category: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The category asked for and not yet shown, taken (none: null). */
export function takeRevealed(): string | null {
  const category = asked;
  asked = null;
  return category;
}
