/**
 * The canvas's own model as React Flow draws it (toFlow, fromFlow), what each node needs of the board around it
 * (Board, BoardContext), and what is being made with the person's services: held beyond the board, so closing the
 * canvas neither stops a clip being made nor loses it.
 */
import React from 'react';
import type { Edge, Node } from '@xyflow/react';
import { api } from '@/api';
import { FILE_W, MAKE_MEDIA, MAKE_W, NOTE_H, NOTE_W, readCanvasDoc, withVersion, type CanvasDoc, type CanvasNode, type GroupColor, type MakeKind, type MediaOf, makeRequest } from '@/lib/canvas';
import type { ProvidersState } from '@/lib/providers';
import type { MediaSources, WorkspaceResource } from '@/lib/workspace-resources';

export type FileData = { path: string; by?: CanvasNode['by'] };
export type NoteData = { text: string; by?: CanvasNode['by'] };
export type FrameData = { label: string; color: GroupColor };
export type MakeData = Pick<CanvasNode, 'prompt' | 'via' | 'model' | 'opts' | 'versions' | 'path' | 'made' | 'by'> & { make: MakeKind };
export type CutData = { by?: CanvasNode['by'] };
export type FileNode = Node<FileData, 'file'>;
export type NoteNode = Node<NoteData, 'note'>;
export type FrameNode = Node<FrameData, 'frame'>;
export type MakeNode = Node<MakeData, 'make'>;
export type CutNode = Node<CutData, 'cut'>;
export type BoardNode = FileNode | NoteNode | FrameNode | MakeNode | CutNode;
export type MakingNode = CanvasNode & { make: MakeKind };

/** a cut's width on the board */
export const CUT_W = 320;

/** The board as React Flow draws it: groups before what is in them, as it needs them. */
export function toFlow(doc: CanvasDoc): { nodes: BoardNode[]; edges: Edge[] } {
  const ordered = [...doc.nodes.filter((n) => n.group != null), ...doc.nodes.filter((n) => n.group == null)];
  return {
    nodes: ordered.map((n): BoardNode => {
      const base = { id: n.id, position: { x: n.x, y: n.y }, ...(n.parent ? { parentId: n.parent } : {}) };
      const by = n.by ? { by: n.by } : {};
      if (n.group != null) return { ...base, type: 'frame', width: n.w ?? 480, height: n.h ?? 320, zIndex: -1, data: { label: n.group, color: n.color ?? 'gray' } };
      if (n.make) {
        const { id: _id, x: _x, y: _y, w: _w, h: _h, parent: _parent, text: _text, group: _group, color: _color, cut: _cut, ...data } = n;
        return { ...base, type: 'make', width: n.w ?? MAKE_W, data: { ...data, make: n.make } };
      }
      if (n.cut) return { ...base, type: 'cut', width: n.w ?? CUT_W, data: { ...by } };
      if (n.path != null) return { ...base, type: 'file', width: n.w ?? FILE_W, data: { path: n.path, ...by } };
      return { ...base, type: 'note', width: n.w ?? NOTE_W, height: n.h ?? NOTE_H, data: { text: n.text ?? '', ...by } };
    }),
    edges: doc.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, ...(e.order != null ? { data: { order: e.order } } : {}) })),
  };
}

export function fromFlow(nodes: readonly BoardNode[], edges: readonly Edge[]): CanvasDoc {
  return {
    nodes: nodes.map((n) => {
      const box = { id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y), ...(n.parentId ? { parent: n.parentId } : {}) };
      const w = Math.round(n.width ?? n.measured?.width ?? (n.type === 'note' ? NOTE_W : n.type === 'make' ? MAKE_W : n.type === 'cut' ? CUT_W : FILE_W));
      const h = () => Math.round(n.height ?? n.measured?.height ?? NOTE_H);
      const by = 'by' in n.data && n.data.by ? { by: n.data.by } : {};
      if (n.type === 'file') return { ...box, ...by, w, path: n.data.path };
      if (n.type === 'make') return { ...box, w, ...n.data };
      if (n.type === 'cut') return { ...box, ...by, w, cut: true as const };
      if (n.type === 'frame') return { id: n.id, x: box.x, y: box.y, w, h: h(), group: n.data.label, color: n.data.color };
      return { ...box, ...by, w, h: h(), text: n.data.text };
    }),
    edges: edges.map((e) => ({ id: e.id, from: e.source, to: e.target, ...(typeof e.data?.order === 'number' ? { order: e.data.order } : {}) })),
  };
}

/** A node's box on the board, whatever group it is in, as it is drawn. */
export function boxOf(node: BoardNode, byId: ReadonlyMap<string, BoardNode>): { x: number; y: number; w: number; h: number } {
  const parent = node.parentId ? byId.get(node.parentId) : undefined;
  const at = parent ? { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y } : node.position;
  return { ...at, w: node.measured?.width ?? node.width ?? FILE_W, h: node.measured?.height ?? node.height ?? NOTE_H };
}

/* ── the services a node makes with ── */

/** a service and model a node can make its kind with (via, model: as `get` names them) */
export interface Choice { via: string; model?: string; name: string; provider: string }

/** What the person's connected services can make a kind with, each model of each. */
export function choicesFor(state: ProvidersState | null, kind: MakeKind): Choice[] {
  return (state?.providers ?? []).filter((p) => p.source && p.verbs.includes(kind)).flatMap((p) => {
    const models = p.models[kind] ?? [];
    return models.length ? models.map((m) => ({ via: p.id, model: m.id, name: m.name, provider: p.name })) : [{ via: p.id, name: p.name, provider: p.name }];
  });
}
/** What a kind is made with when the node names none: the person's choice in Settings, else the first connected. */
export function defaultChoice(state: ProvidersState | null, kind: MakeKind): Choice | null {
  const choices = choicesFor(state, kind);
  const via = state?.use[kind];
  const model = state?.model[kind];
  return choices.find((c) => c.via === via && (!model || c.model === model)) ?? choices.find((c) => c.via === via) ?? choices[0] ?? null;
}

/* ── what is being made ── */

export interface Run { started: number; abort: AbortController }
type Made = { path: string; made: string };
/** by `project/node` */
export const runs = new Map<string, Run>();
export const runErrors = new Map<string, string>();
/** the board shown for each project, to take what was made */
export const shownBoards = new Map<string, (node: string, made: Made) => void>();
let runsVersion = 0;
const runWatchers = new Set<() => void>();
export const runsChanged = () => { runsVersion += 1; for (const watch of runWatchers) watch(); };
export const useRuns = () => React.useSyncExternalStore((watch) => { runWatchers.add(watch); return () => { runWatchers.delete(watch); }; }, () => runsVersion);

/** Whether it made one (false: it failed, was stopped, or was being made already). */
export async function startRun(project: string, folder: string, node: string, request: ReturnType<typeof makeRequest>, pick: { via?: string; model?: string }, key: string, nothing: string): Promise<boolean> {
  const id = `${project}/${node}`;
  if (runs.has(id)) return false;
  const abort = new AbortController();
  runs.set(id, { started: Date.now(), abort });
  runErrors.delete(id);
  runsChanged();
  try {
    /* the person pressed Make on it: what it costs is not asked again, as an agent's would be */
    const receipt = JSON.parse(await api.make(folder, request.verb, request.args, { ...pick, yes: true }, abort.signal)) as { src?: string; images?: Array<{ src?: string }> };
    const path = receipt.src ?? receipt.images?.[0]?.src;
    if (!path) throw new Error(nothing);
    const made = { path, made: key };
    const shown = shownBoards.get(project);
    if (shown) shown(node, made);
    else {
      /* the board closed meanwhile: written into it as kept */
      const doc = readCanvasDoc(await api.canvas(project));
      await api.putCanvas(project, { ...doc, nodes: doc.nodes.map((n) => (n.id === node ? withVersion(n, made) : n)) });
    }
    return true;
  } catch (e) {
    if (!abort.signal.aborted) runErrors.set(id, e instanceof Error ? e.message : String(e));
    return false;
  } finally {
    runs.delete(id);
    runsChanged();
  }
}

/* ── what the nodes need of the board around them ── */

/** What is wired into a node, in its order, as its panel shows it. */
export interface InputView { edge: string; from: string; text?: string; path?: string; media?: 'image' | 'video' | 'audio' }

/** What is wired into `id`, in its wires' order (then as they were drawn), with the wire each comes by. */
export function inputViews(nodes: readonly BoardNode[], edges: readonly Edge[], id: string, mediaOf: MediaOf): InputView[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rank = (e: Edge) => (typeof e.data?.order === 'number' ? e.data.order : Infinity);
  return edges.map((e, i) => ({ e, i })).filter(({ e }) => e.target === id).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).flatMap(({ e }): InputView[] => {
    const n = byId.get(e.source);
    if (!n) return [];
    if (n.type === 'note') return [{ edge: e.id, from: n.id, text: n.data.text.trim() }];
    if (n.type === 'file') { const media = mediaOf(n.data.path); return [{ edge: e.id, from: n.id, path: n.data.path, ...(media ? { media } : {}) }]; }
    if (n.type === 'make') return [{ edge: e.id, from: n.id, ...(n.data.path ? { path: n.data.path, media: MAKE_MEDIA[n.data.make] } : {}) }];
    return [];
  });
}

/** what can be made next to a node, or put on the board: a node of a kind, or a file of the project */
export type SpawnKind = 'note' | MakeKind | 'cut';
/** which side of a node something is added at: right, made from it; left, going into it */
export type Side = 'source' | 'target';

export interface Board {
  /** the project's files (the Assets' listing), and one of them by its path */
  files: readonly WorkspaceResource[];
  fileOf: (path: string) => WorkspaceResource | null;
  sources: MediaSources;
  addToFilm: (file: WorkspaceResource) => void;
  setData: (id: string, data: Partial<FileData & NoteData & FrameData & MakeData>) => void;
  remove: (ids: string[]) => void;
  /** the board as it is now kept to go back to: called before a change made in a node (a resize, words written) */
  willChange: () => void;
  /** the note or group name being written in (null: none) */
  editing: string | null;
  edit: (id: string | null) => void;
  /** the one node selected, which shows its panel and its actions (null: none, or more than one) */
  single: string | null;
  /** making: with what, whether it is at it or failed, what changed since, what it cannot use */
  choices: (kind: MakeKind) => Choice[];
  fallback: (kind: MakeKind) => Choice | null;
  run: (id: string) => Run | undefined;
  error: (id: string) => string | undefined;
  stale: ReadonlySet<string>;
  unused: ReadonlyMap<string, number>;
  make: (id: string) => void;
  stop: (id: string) => void;
  /** what is wired into a node, in order; a wire taken out */
  inputs: (id: string) => InputView[];
  unwire: (edge: string) => void;
  /** the side ⊕ of a node pressed: what to add there, joined to it */
  sideMenu: (id: string, side: Side, screen: { x: number; y: number }) => void;
  /** a file of the computer brought in: as this node's newest version (it makes something), or wired into it */
  upload: (id: string, how: 'version' | 'input') => void;
  /** a node of the board, or a file of the project, wired into this one */
  wireIn: (id: string, from: { node: string } | { path: string }) => void;
  /** what a cut puts on the timeline, in its order */
  sendToFilm: (id: string) => void;
  /** a file shown whole, over the board; shown in the Assets */
  view: (path: string) => void;
  reveal?: (path: string) => void;
  /** a group: whether it has nodes that make something, whether one is at it, and all of them made in order */
  makesIn: (group: string) => number;
  busyIn: (group: string) => boolean;
  makeAll: (group: string) => void;
  openSettings: () => void;
  /** a board only looked at (an example's): nothing on it is changed, made or wired */
  readOnly?: boolean;
}
export const BoardContext = React.createContext<Board | null>(null);
export const useBoard = () => React.useContext(BoardContext)!;
