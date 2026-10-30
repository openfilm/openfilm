/**
 * The project's canvas as kept (`.film/canvas.json`, studio/server/canvas.mjs): notes and the project's files laid
 * out on a board, in groups or not, and edges between them; what an undo goes back to, and what a copy makes. The
 * board itself is components/canvas.
 */

export interface CanvasNode {
  id: string;
  x: number;
  y: number;
  /** its width on the board (a file's height follows its picture) */
  w?: number;
  /** a note's height */
  h?: number;
  /** a note: what it says */
  text?: string;
  /** a file of the project, project-relative */
  path?: string;
  /** a group: its name (and its color, one of GROUP_COLORS) */
  group?: string;
  color?: GroupColor;
  /** the group it is in (its x, y then from the group's corner) */
  parent?: string;
}

export const GROUP_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type GroupColor = typeof GROUP_COLORS[number];

export interface CanvasEdge { id: string; from: string; to: string }

export interface CanvasDoc { nodes: CanvasNode[]; edges: CanvasEdge[] }

export const NOTE_W = 240;
export const NOTE_H = 140;
export const FILE_W = 280;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The board as the server sent it: what is not a node or an edge is left out (it keeps the same rule). */
export function readCanvasDoc(raw: unknown): CanvasDoc {
  const doc = raw as { nodes?: unknown; edges?: unknown } | null;
  const nodes: CanvasNode[] = [];
  const ids = new Set<string>();
  for (const n of Array.isArray(doc?.nodes) ? doc.nodes as Array<Record<string, unknown>> : []) {
    if (!n || typeof n.id !== 'string' || ids.has(n.id) || !num(n.x) || !num(n.y)) continue;
    const box = { id: n.id, x: n.x, y: n.y, ...(num(n.w) ? { w: n.w } : {}), ...(num(n.h) ? { h: n.h } : {}) };
    const parent = typeof n.parent === 'string' ? { parent: n.parent } : {};
    if (typeof n.path === 'string' && n.path) nodes.push({ ...box, ...parent, path: n.path });
    else if (typeof n.text === 'string') nodes.push({ ...box, ...parent, text: n.text });
    else if (typeof n.group === 'string') {
      const color = GROUP_COLORS.find((c) => c === n.color) ?? 'gray';
      nodes.push({ ...box, group: n.group, color });
    }
    else continue;
    ids.add(n.id);
  }
  const edges = (Array.isArray(doc?.edges) ? doc.edges as Array<Record<string, unknown>> : [])
    .filter((e): e is { id: string; from: string; to: string } => Boolean(e) && typeof e.id === 'string'
      && typeof e.from === 'string' && typeof e.to === 'string' && ids.has(e.from) && ids.has(e.to));
  return { nodes, edges: edges.map(({ id, from, to }) => ({ id, from, to })) };
}

/** What a board says, as one string: two boards that say the same are written once. */
export function canvasKey(doc: CanvasDoc): string {
  return JSON.stringify(doc);
}

/** A new node's or edge's id. */
export function canvasId(prefix: 'n' | 'e'): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** How far back an undo goes. */
export const HISTORY_MAX = 100;

/** What an undo goes back to, and what a redo goes on to. */
export interface CanvasHistory { past: CanvasDoc[]; future: CanvasDoc[] }

export const emptyHistory = (): CanvasHistory => ({ past: [], future: [] });

/** The board as it was before a change, kept to go back to; a change made after an undo leaves nothing to redo. */
export function remember(history: CanvasHistory, before: CanvasDoc): CanvasHistory {
  const last = history.past.at(-1);
  if (last && canvasKey(last) === canvasKey(before)) return { past: history.past, future: [] };
  return { past: [...history.past, before].slice(-HISTORY_MAX), future: [] };
}

/** One step back from `now`: the board to show, and the history after it; null when there is none. */
export function undo(history: CanvasHistory, now: CanvasDoc): { doc: CanvasDoc; history: CanvasHistory } | null {
  const doc = history.past.at(-1);
  if (!doc) return null;
  return { doc, history: { past: history.past.slice(0, -1), future: [now, ...history.future] } };
}

/** One step forward again from `now` (after an undo); null when there is none. */
export function redo(history: CanvasHistory, now: CanvasDoc): { doc: CanvasDoc; history: CanvasHistory } | null {
  const [doc, ...rest] = history.future;
  if (!doc) return null;
  return { doc, history: { past: [...history.past, now], future: rest } };
}

/**
 * Copies of these nodes (a group's own with it) and of the edges between them, with new ids, moved by `offset`: what a
 * paste or a duplicate adds. A copy is a new node of its own, not linked to what it was copied from.
 */
export function copyOf(doc: CanvasDoc, ids: ReadonlySet<string>, offset: { x: number; y: number }): CanvasDoc {
  const taken = new Set(ids);
  for (const n of doc.nodes) if (n.parent && taken.has(n.parent)) taken.add(n.id);
  const fresh = new Map<string, string>();
  for (const id of taken) fresh.set(id, canvasId('n'));
  const nodes = doc.nodes.filter((n) => taken.has(n.id)).map((n) => {
    const inCopiedGroup = n.parent != null && taken.has(n.parent);
    const { parent: _parent, ...rest } = n;
    return {
      ...rest,
      id: fresh.get(n.id)!,
      /* in a copied group: where it was in it; else moved by the offset, and out of a group not copied */
      ...(inCopiedGroup ? { parent: fresh.get(n.parent!)! } : { x: n.x + offset.x, y: n.y + offset.y, ...(n.parent ? { parent: n.parent } : {}) }),
    };
  });
  const edges = doc.edges.filter((e) => taken.has(e.from) && taken.has(e.to))
    .map((e) => ({ id: canvasId('e'), from: fresh.get(e.from)!, to: fresh.get(e.to)! }));
  return { nodes, edges };
}
