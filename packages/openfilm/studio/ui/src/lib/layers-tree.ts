/**
 * The Layers panel's tree (components/LayersPanel): the picture clips shown at the playhead, the top one first, and a
 * page's layers inside it, each level in the order it is drawn (the one on top first), as the stage reads them
 * (studio/server/stage.js `tree`). Reordering a level writes z-index overrides (stage.js `restack`).
 */

export type LayerRowKind = 'text' | 'image' | 'shape' | 'box' | 'group';

export interface LayerRow {
  /** The element's handle in the page (good while the page is loaded). */
  handle: number;
  /** The handle of the element the row is restacked by: the child of its parent row's element that holds it. */
  branch: number;
  /** Its selector, with `#n` when the selector finds several (the override target). */
  loc: string;
  instance?: number;
  tag: string;
  kind: LayerRowKind;
  label: string;
  /** Hidden by the person (an override's visibility: hidden). */
  hidden: boolean;
  locked: boolean;
  /** Not drawn at this moment (faded out, hidden by the page, no size). */
  off: boolean;
  children: LayerRow[];
}

export interface LayerClip {
  clip: string;
  kind: 'page' | 'video' | 'image' | string;
  layers: LayerRow[];
}

/** One line of the panel as drawn: a clip, or a layer `depth` levels in, with the rows it sits among. */
export interface LayerLine {
  key: string;
  clipId: string;
  depth: number;
  row: LayerRow | null;
  /** The level it is in (its parent's children), and its place there; none for a clip. */
  siblings: readonly LayerRow[];
  index: number;
  /** The key of the line its level is under. */
  parentKey: string;
  open: boolean;
  canOpen: boolean;
}

export const clipKey = (clipId: string) => `clip:${clipId}`;
export const layerKey = (clipId: string, loc: string) => `layer:${clipId}:${loc}`;

/**
 * Whether a line starts open: a clip does, and a row alone in its level (a page's one wrapper is no stop on the way
 * in); the person's `toggled` lines are the other way round.
 */
const startsOpen = (siblings: number | null) => siblings == null || siblings === 1;

/** The lines shown: each clip, then the layers of the open ones and of their open rows. */
export function layerLines(clips: readonly LayerClip[], toggled: ReadonlySet<string>): LayerLine[] {
  const out: LayerLine[] = [];
  const walk = (clipId: string, rows: readonly LayerRow[], depth: number, parentKey: string) => {
    rows.forEach((row, index) => {
      const key = layerKey(clipId, row.loc);
      const canOpen = row.children.length > 0;
      const isOpen = canOpen && startsOpen(rows.length) !== toggled.has(key);
      out.push({ key, clipId, depth, row, siblings: rows, index, parentKey, open: isOpen, canOpen });
      if (isOpen) walk(clipId, row.children, depth + 1, key);
    });
  };
  for (const c of clips) {
    const key = clipKey(c.clip);
    const canOpen = c.layers.length > 0;
    const isOpen = canOpen && startsOpen(null) !== toggled.has(key);
    out.push({ key, clipId: c.clip, depth: 0, row: null, siblings: [], index: 0, parentKey: '', open: isOpen, canOpen });
    if (isOpen) walk(c.clip, c.layers, 1, key);
  }
  return out;
}

/** The person's toggled lines with the clip and the rows around the layer at `loc` open (the same set when they are). */
export function openTo(clips: readonly LayerClip[], toggled: ReadonlySet<string>, clipId: string, loc: string): ReadonlySet<string> {
  const c = clips.find((x) => x.clip === clipId);
  if (!c) return toggled;
  const around: Array<{ key: string; siblings: number | null }> = [];
  const find = (rows: readonly LayerRow[]): boolean => rows.some((row) => {
    if (row.loc === loc) return true;
    around.push({ key: layerKey(clipId, row.loc), siblings: rows.length });
    if (find(row.children)) return true;
    around.pop();
    return false;
  });
  if (!find(c.layers)) return toggled;
  const shut = [{ key: clipKey(clipId), siblings: null }, ...around].filter((l) => startsOpen(l.siblings) === toggled.has(l.key));
  if (!shut.length) return toggled;
  const next = new Set(toggled);
  for (const l of shut) { if (next.has(l.key)) next.delete(l.key); else next.add(l.key); }
  return next;
}

/**
 * The line that moves when a dragged row is let go over line `over`: CSS restacks only within a level, so a row can be
 * dropped in its own level or in the level of any row around it, and there the row around it moves, with all it holds.
 * Null when `over` is in none of those levels (another clip, a group it is not in).
 */
export function moverFor(lines: readonly LayerLine[], dragged: LayerLine, over: LayerLine): LayerLine | null {
  const byKey = new Map(lines.map((l) => [l.key, l]));
  /* per level (the key of the line it is under), the row of the dragged one's chain in it */
  const chain = new Map<string, LayerLine>();
  for (let c: LayerLine | undefined = dragged; c?.row; c = byKey.get(c.parentKey)) chain.set(c.parentKey, c);
  for (let c: LayerLine | undefined = over; c?.row; c = byKey.get(c.parentKey)) {
    const mover = chain.get(c.parentKey);
    if (mover) return mover;
  }
  return null;
}

/**
 * A level reordered: the row at `from` dropped at `to` (a gap, 0 above the first row … length below the last), as the
 * handles to restack by, the top one first. Null when it lands where it was.
 */
export function movedOrder(siblings: readonly LayerRow[], from: number, to: number): number[] | null {
  if (from < 0 || from >= siblings.length) return null;
  const at = to > from ? to - 1 : to;
  if (at === from) return null;
  const rest = siblings.filter((_, i) => i !== from);
  rest.splice(Math.max(0, Math.min(rest.length, at)), 0, siblings[from]!);
  return rest.map((r) => r.branch);
}

/** Two reads of the tree are the same picture of it (the panel redraws only when they differ). */
export function sameTree(a: readonly LayerClip[] | null, b: readonly LayerClip[] | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
