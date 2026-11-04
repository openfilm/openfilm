/**
 * A menu's entries with a line only between two groups that are there: none first, none last, never two in a row. A
 * menu narrowed after it was built (a caption's clip menu keeps only what a line of words has) leaves them so.
 */
export function tidySeparators<T extends object>(entries: readonly T[]): T[] {
  const line = (e: T) => 'separator' in e;
  const out: T[] = [];
  for (const e of entries) {
    if (line(e) && (!out.length || line(out[out.length - 1]!))) continue;
    out.push(e);
  }
  while (out.length && line(out[out.length - 1]!)) out.pop();
  return out;
}
