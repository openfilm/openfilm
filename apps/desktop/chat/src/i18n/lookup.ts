/** The value at a dotted path of a table of words; the path itself when there is none. */
export function lookup(dict: unknown, path: string): string {
  let cur: unknown = dict;
  for (const part of path.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return path;
    }
  }
  return typeof cur === 'string' ? cur : path;
}
