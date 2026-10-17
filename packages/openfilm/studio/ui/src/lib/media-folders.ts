/**
 * The media pane's folders (MediaPool): those directly in the folder shown, each with how many files it holds (at any
 * depth) and the four on its cover (pictures first, they say the most; sounds after; by name). Worked out in one pass
 * over the files, with one collator: a project holds thousands of files, the pane is laid out again whenever its
 * listing changes, and a filter and a sort per folder (a collator made for each comparison) took tens of ms each time.
 */

/** Names in their natural order (shot 2 before shot 10). */
export const byName = new Intl.Collator(undefined, { numeric: true }).compare;

type File = { path: string; name: string; kind: string };
export type FolderFace<F extends File> = { rel: string; name: string; count: number; covers: F[] };

/** Pictures before sounds, then by name: the order of a folder's cover. */
const coverOrder = (a: File, b: File) => Number(a.kind === 'audio') - Number(b.kind === 'audio') || byName(a.name, b.name);
const COVERS = 4;

/**
 * The folders of `dirs` (paths under the media folder) directly in `at` ('' its top), in name order. `relOf` gives a
 * file's path under the media folder, or null for one outside it (a project's own page).
 */
export function folderFaces<F extends File>(files: readonly F[], dirs: readonly string[], at: string, relOf: (path: string) => string | null): FolderFace<F>[] {
  const parentOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
  const faces = new Map<string, FolderFace<F>>();
  for (const rel of [...dirs].filter((d) => parentOf(d) === at).sort(byName)) faces.set(rel, { rel, name: rel.split('/').pop()!, count: 0, covers: [] });
  if (!faces.size) return [];
  const prefix = at ? `${at}/` : '';
  for (const f of files) {
    const rel = relOf(f.path);
    if (rel == null || !rel.startsWith(prefix)) continue;
    const slash = rel.indexOf('/', prefix.length);
    if (slash < 0) continue;                                         // a file of `at` itself
    const face = faces.get(rel.slice(0, slash));
    if (!face) continue;
    face.count++;
    /* the cover's four, kept in order as they come (no sort of the whole folder) */
    const covers = face.covers;
    if (covers.length === COVERS && coverOrder(f, covers[COVERS - 1]!) >= 0) continue;
    let i = covers.length;
    while (i > 0 && coverOrder(f, covers[i - 1]!) < 0) i--;
    covers.splice(i, 0, f);
    if (covers.length > COVERS) covers.pop();
  }
  return [...faces.values()];
}
