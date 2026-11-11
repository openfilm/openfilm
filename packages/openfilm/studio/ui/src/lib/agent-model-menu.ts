/** Reconcile a menu being edited with a background catalog update, retaining unsaved order and switches. */
export function mergeModelMenu<T extends { id: string; shown: boolean }>(draft: T[], catalog: T[]): T[] {
  const byId = new Map(catalog.map((model) => [model.id, model]));
  const kept = draft.flatMap((model) => {
    const current = byId.get(model.id);
    byId.delete(model.id);
    return current ? [{ ...current, shown: model.shown }] : [];
  });
  return [...kept, ...byId.values()];
}
