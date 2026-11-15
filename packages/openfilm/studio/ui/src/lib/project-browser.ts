/** File-browser selection: the anchor stays put while Shift extends a range. */
export function selectBrowserItems(
  order: readonly string[],
  selected: ReadonlySet<string>,
  key: string,
  anchor: string | null,
  modifiers: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {},
): Set<string> {
  const additive = modifiers.metaKey || modifiers.ctrlKey;
  if (modifiers.shiftKey && anchor && order.includes(anchor)) {
    const from = order.indexOf(anchor),
      to = order.indexOf(key);
    if (to < 0) return new Set(selected);
    return new Set([...(additive ? selected : []), ...order.slice(Math.min(from, to), Math.max(from, to) + 1)]);
  }
  const next = new Set(additive ? selected : []);
  if (additive && next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** A move/delete of a parent already includes its descendants. */
export function browserSelectionRoots(
  keys: readonly string[],
  folders: readonly { id: string; parentId?: string }[],
  projects: readonly { id: string; folderId?: string }[],
): string[] {
  const picked = new Set(keys);
  const parents = new Map(folders.map((f) => [f.id, f.parentId]));
  return keys.filter((key) => {
    let parent = key.startsWith('folder:')
      ? parents.get(key.slice(7))
      : projects.find((p) => p.id === key.slice(8))?.folderId;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      if (picked.has(`folder:${parent}`)) return false;
      seen.add(parent);
      parent = parents.get(parent);
    }
    return true;
  });
}
