/**
 * The project's canvas as kept (`.film/canvas.json`, studio/server/canvas.mjs): notes and the project's files laid
 * out on a board, and edges between them. The board itself is components/canvas.
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
}

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
    if (typeof n.path === 'string' && n.path) nodes.push({ ...box, path: n.path });
    else if (typeof n.text === 'string') nodes.push({ ...box, text: n.text });
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
