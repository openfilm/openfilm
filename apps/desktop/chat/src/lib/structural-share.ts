/**
 * Structural sharing: subtrees of `next` deeply equal to `prev` get `prev`'s references back; if all is equal,
 * `prev` itself is returned.
 *
 * Each poll returns freshly parsed objects even when nothing changed. Put straight into state, every card and turn
 * gets new props and every memo misses, worse the longer the list. Through here, unchanged parts keep their
 * references and React skips them; when nothing changed, setState gets the same reference and skips the render.
 *
 * Handles JSON shapes only (objects, arrays, primitives), which is what the API returns.
 */
export function shareStructure<T>(prev: T, next: T): T {
  if (Object.is(prev, next)) return prev;
  if (typeof prev !== 'object' || typeof next !== 'object' || prev === null || next === null) {
    return next;
  }
  if (Array.isArray(prev) !== Array.isArray(next)) return next;
  if (Array.isArray(prev)) {
    const a = prev as unknown[];
    const b = next as unknown[];
    let same = a.length === b.length;
    const out = b.map((item, i) => {
      const shared = i < a.length ? shareStructure(a[i], item) : item;
      if (shared !== a[i]) same = false;
      return shared;
    });
    return (same ? prev : out) as T;
  }
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const keys = Object.keys(b);
  let same = keys.length === Object.keys(a).length;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const shared = k in a ? shareStructure(a[k], b[k]) : b[k];
    if (shared !== a[k] || !(k in a)) same = false;
    out[k] = shared;
  }
  return (same ? prev : out) as T;
}

/** The list version, matched by id: each item shares structure with the previous item of the same id; unchanged, returns `prev` itself. */
export function shareListById<T extends { id: string }>(prev: readonly T[], next: T[]): T[] {
  const byId = new Map(prev.map((item) => [item.id, item]));
  let same = prev.length === next.length;
  const out = next.map((item, i) => {
    const old = byId.get(item.id);
    const shared = old ? shareStructure(old, item) : item;
    if (shared !== prev[i]) same = false;
    return shared;
  });
  return same ? (prev as T[]) : out;
}
