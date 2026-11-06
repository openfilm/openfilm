/**
 * The canvas's own model as React Flow draws it (toFlow, fromFlow), what each node needs of the board around it
 * (Board, BoardContext), and what is being made with the person's services: held beyond the board, so closing the
 * canvas neither stops a clip being made nor loses it.
 */
import React from 'react';
import type { Edge, Node } from '@xyflow/react';
import { api } from '@/api';
import { CARD_H, CUT_W, FILE_W, MAKE_MEDIA, NOTE_H, NOTE_W, makeSize, readCanvasDoc, withVersion, type CanvasDoc, type CanvasNode, type GroupColor, type MakeKind, type MediaOf, type ModelSpec, makeRequest } from '@/lib/canvas';
import type { ProvidersState } from '@/lib/providers';
import type { MediaSources, WorkspaceResource } from '@/lib/workspace-resources';

export type FileData = { path: string; by?: CanvasNode['by'] };
export type NoteData = { text: string; by?: CanvasNode['by'] };
export type FrameData = { label: string; color: GroupColor };
export type MakeData = Pick<CanvasNode, 'prompt' | 'via' | 'model' | 'opts' | 'preset' | 'versions' | 'path' | 'made' | 'by'> & { make: MakeKind };
export type CutData = { by?: CanvasNode['by'] };
export type FileNode = Node<FileData, 'file'>;
export type NoteNode = Node<NoteData, 'note'>;
export type FrameNode = Node<FrameData, 'frame'>;
export type MakeNode = Node<MakeData, 'make'>;
export type CutNode = Node<CutData, 'cut'>;
export type BoardNode = FileNode | NoteNode | FrameNode | MakeNode | CutNode;
export type MakingNode = CanvasNode & { make: MakeKind };

/** The board as React Flow draws it: groups before what is in them, as it needs them. */
export function toFlow(doc: CanvasDoc): { nodes: BoardNode[]; edges: Edge[] } {
  const ordered = [...doc.nodes.filter((n) => n.group != null), ...doc.nodes.filter((n) => n.group == null)];
  return {
    nodes: ordered.map((n): BoardNode => {
      const base = { id: n.id, position: { x: n.x, y: n.y }, ...(n.parent ? { parentId: n.parent } : {}) };
      const by = n.by ? { by: n.by } : {};
      if (n.group != null) return { ...base, type: 'frame', width: n.w ?? 480, height: n.h ?? 320, zIndex: -1, ...GROUP_HELD, data: { label: n.group, color: n.color ?? 'gray' } };
      if (n.make) {
        const { id: _id, x: _x, y: _y, w: _w, h: _h, parent: _parent, text: _text, group: _group, color: _color, cut: _cut, ...data } = n;
        /* sized as resized; else (and on a board from before cards had a height) as its shape draws it */
        const size = n.w != null && n.h != null ? { w: n.w, h: n.h } : makeSize(n.make, n.opts?.ratio);
        return { ...base, type: 'make', width: size.w, height: size.h, data: { ...data, make: n.make } };
      }
      if (n.cut) return { ...base, type: 'cut', width: n.w ?? CUT_W, height: n.h ?? CARD_H, data: { ...by } };
      /* a file is as its picture draws it until resized */
      if (n.path != null) return { ...base, type: 'file', ...(n.w != null && n.h != null ? { width: n.w, height: n.h } : {}), data: { path: n.path, ...by } };
      return { ...base, type: 'note', width: n.w ?? NOTE_W, height: n.h ?? NOTE_H, data: { text: n.text ?? '', ...by } };
    }),
    edges: doc.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, ...(e.order != null ? { data: { order: e.order } } : {}) })),
  };
}

export function fromFlow(nodes: readonly BoardNode[], edges: readonly Edge[]): CanvasDoc {
  return {
    nodes: nodes.map((n) => {
      const box = { id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y), ...(n.parentId ? { parent: n.parentId } : {}) };
      const w = Math.round(n.width ?? n.measured?.width ?? (n.type === 'note' ? NOTE_W : n.type === 'cut' ? CUT_W : FILE_W));
      const h = () => Math.round(n.height ?? n.measured?.height ?? (n.type === 'note' ? NOTE_H : CARD_H));
      const by = 'by' in n.data && n.data.by ? { by: n.data.by } : {};
      if (n.type === 'file') return { ...box, ...by, ...(n.width != null && n.height != null ? { w, h: h() } : {}), path: n.data.path };
      if (n.type === 'make') return { ...box, w, h: h(), ...n.data };
      if (n.type === 'cut') return { ...box, ...by, w, h: h(), cut: true as const };
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
  return { ...at, w: node.measured?.width ?? node.width ?? FILE_W, h: node.measured?.height ?? node.height ?? CARD_H };
}

/**
 * A group is moved by its title bar and picked by a click on it, never by a selection box: a box drawn inside a group
 * picks what is in it, as anywhere on the board.
 */
export const GROUP_HELD = { selectable: false, dragHandle: '.cv-group-head' } as const;

/** the room in a group round what is in it, and at its top under its name */
const GROUP_ROOM = 32;
const GROUP_TOP = 52;

/**
 * Every group round what is in it: grown (never shrunk) where something lies past its edge, what is in it staying
 * where it is on the board. The same list when nothing had to change.
 */
export function fitGroups(list: BoardNode[]): BoardNode[] {
  const byId = new Map(list.map((n) => [n.id, n]));
  let changed = false;
  const fitted = new Map<string, { dx: number; dy: number; frame: BoardNode }>();
  for (const g of list) {
    if (g.type !== 'frame') continue;
    const kids = list.filter((n) => n.parentId === g.id);
    if (!kids.length) continue;
    const size = (n: BoardNode) => boxOf(n, byId);
    const left = Math.min(0, ...kids.map((k) => k.position.x - GROUP_ROOM));
    const top = Math.min(0, ...kids.map((k) => k.position.y - GROUP_TOP));
    const w = Math.max(g.width ?? 0, ...kids.map((k) => k.position.x - left + size(k).w + GROUP_ROOM));
    const h = Math.max(g.height ?? 0, ...kids.map((k) => k.position.y - top + size(k).h + GROUP_ROOM));
    if (left === 0 && top === 0 && Math.round(w) === Math.round(g.width ?? 0) && Math.round(h) === Math.round(g.height ?? 0)) continue;
    changed = true;
    fitted.set(g.id, { dx: left, dy: top, frame: { ...g, position: { x: g.position.x + left, y: g.position.y + top }, width: Math.round(w), height: Math.round(h) } as BoardNode });
  }
  if (!changed) return list;
  return list.map((n) => {
    const own = fitted.get(n.id);
    if (own) return own.frame;
    const parent = n.parentId ? fitted.get(n.parentId) : undefined;
    return parent ? { ...n, position: { x: n.position.x - parent.dx, y: n.position.y - parent.dy } } : n;
  });
}

/**
 * Nothing laid on another: among the nodes of each group (and those of the board), left to right, one that lies on one
 * before it moves right of it, and what it then lies on after it. `first` keep their place (a card that just grew
 * pushes its neighbours, not itself). The groups are fitted round what they hold after. The same list when nothing
 * lay on anything.
 */
export function unstack(list: BoardNode[], first: readonly string[] = []): BoardNode[] {
  const GAP = 48;
  /* its size as it is now asked to be (a card just reshaped is not measured yet), with the title over it */
  const HEAD = 28;
  const box = (n: BoardNode, x = n.position.x) => ({ x, y: n.position.y - HEAD, w: n.width ?? n.measured?.width ?? FILE_W, h: (n.height ?? n.measured?.height ?? CARD_H) + HEAD });
  const on = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const moved = new Map<string, number>();
  const sets = new Map<string, BoardNode[]>();
  for (const n of list) if (n.type !== 'frame') sets.set(n.parentId ?? '', [...(sets.get(n.parentId ?? '') ?? []), n]);
  for (const nodes of sets.values()) {
    const order = [...nodes].sort((a, b) => Number(first.includes(b.id)) - Number(first.includes(a.id)) || a.position.x - b.position.x);
    const placed: Array<ReturnType<typeof box>> = [];
    for (const n of order) {
      let me = box(n);
      for (let tries = 0; tries < 100; tries++) {
        const hit = placed.find((o) => on(me, o));
        if (!hit) break;
        me = box(n, hit.x + hit.w + GAP);
      }
      if (me.x !== n.position.x) moved.set(n.id, me.x);
      placed.push(me);
    }
  }
  if (!moved.size) return list;
  return fitGroups(list.map((n) => (moved.has(n.id) ? { ...n, position: { ...n.position, x: moved.get(n.id)! } } : n)));
}

/**
 * What is in a group laid out again, in rows as they read (top to bottom, then left to right): words first, the rest
 * after them, at most four a row, clear of each other; the group round them.
 */
export function tidyGroup(list: BoardNode[], group: string): BoardNode[] {
  const byId = new Map(list.map((n) => [n.id, n]));
  const kids = list.filter((n) => n.parentId === group)
    .sort((a, b) => (a.type === 'note' ? 0 : 1) - (b.type === 'note' ? 0 : 1) || (Math.abs(a.position.y - b.position.y) > 120 ? a.position.y - b.position.y : a.position.x - b.position.x));
  const GAP = 48;
  const places = new Map<string, { x: number; y: number }>();
  let x = GROUP_ROOM;
  let y = GROUP_TOP;
  let rowH = 0;
  let inRow = 0;
  for (const k of kids) {
    const { w, h } = boxOf(k, byId);
    if (inRow === 4 || (inRow > 0 && x + w > 4 * 700)) { x = GROUP_ROOM; y += rowH + GAP; rowH = 0; inRow = 0; }
    places.set(k.id, { x, y });
    x += w + GAP;
    rowH = Math.max(rowH, h);
    inRow += 1;
  }
  const laid = list.map((n) => (places.has(n.id) ? { ...n, position: places.get(n.id)! } : n));
  /* the group sized to them anew: shrunk too */
  const tidied = laid.map((n) => (n.id === group ? { ...n, width: 0, height: 0 } as BoardNode : n));
  return fitGroups(tidied);
}

/* ── the services a node makes with ── */

/**
 * a service and model a node can make its kind with (via, model: as `get` names them), whether the person has
 * connected that service, and what the model makes
 */
export interface Choice { via: string; model?: string; name: string; provider: string; connected: boolean; spec?: ModelSpec; kind?: MakeKind }

/** Every service that makes a kind, each model of each: the connected ones first, then the others to connect. */
export function allChoicesFor(state: ProvidersState | null, kind: MakeKind): Choice[] {
  const providers = (state?.providers ?? []).filter((p) => p.verbs.includes(kind));
  return [...providers.filter((p) => p.source), ...providers.filter((p) => !p.source)].flatMap((p) => {
    const models = p.models[kind] ?? [];
    const connected = Boolean(p.source);
    return models.length ? models.map((m) => ({ via: p.id, model: m.id, name: m.name, provider: p.name, connected, kind, ...(m.spec ? { spec: m.spec } : {}) }))
      : [{ via: p.id, name: p.name, provider: p.name, connected, kind }];
  });
}

/** What the person's connected services can make a kind with, each model of each. */
export function choicesFor(state: ProvidersState | null, kind: MakeKind): Choice[] {
  return allChoicesFor(state, kind).filter((c) => c.connected);
}

/** The model a node makes with: the one it names, else what Settings say for its kind. */
export function choiceOf(state: ProvidersState | null, kind: MakeKind, via?: string, model?: string): Choice | null {
  return (via ? choicesFor(state, kind).find((c) => c.via === via && (!model || c.model === model)) : null) ?? defaultChoice(state, kind);
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
/**
 * How long a model takes, as this person's own runs with it took (the middle of the last few that made something):
 * kept in this browser, shown by the model in the panel's list. None run yet: nothing said.
 */
const TIMES_KEY = 'openfilm.canvas.times';
const TIMES_KEPT = 5;
const readTimes = (): Record<string, number[]> => { try { return JSON.parse(localStorage.getItem(TIMES_KEY) ?? '{}') as Record<string, number[]>; } catch { return {}; } };
export function modelTime(via: string, model?: string): number | null {
  const list = readTimes()[`${via}|${model ?? ''}`];
  if (!Array.isArray(list) || !list.length) return null;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}
export function keepModelTime(via: string, model: string | undefined, seconds: number) {
  const all = readTimes();
  const key = `${via}|${model ?? ''}`;
  all[key] = [...(all[key] ?? []), Math.round(seconds)].slice(-TIMES_KEPT);
  try { localStorage.setItem(TIMES_KEY, JSON.stringify(all)); } catch { /* not kept */ }
}
/** "15s", "2min" */
export function timeLabel(seconds: number): string {
  return seconds < 90 ? `${Math.max(1, Math.round(seconds))}s` : `${Math.round(seconds / 60)}min`;
}

/** each project's board shown now (which of its boards, and how what is made comes onto it) */
export const shownBoards = new Map<string, { board: string; take: (node: string, made: Made) => void }>();
let runsVersion = 0;
const runWatchers = new Set<() => void>();
export const runsChanged = () => { runsVersion += 1; for (const watch of runWatchers) watch(); };
export const useRuns = () => React.useSyncExternalStore((watch) => { runWatchers.add(watch); return () => { runWatchers.delete(watch); }; }, () => runsVersion);

/** Whether it made one (false: it failed, was stopped, or was being made already). */
export async function startRun(project: string, folder: string, node: string, request: ReturnType<typeof makeRequest>, pick: { via?: string; model?: string }, key: string,
  say: { nothing: string; balance: string }, board = 'main'): Promise<boolean> {
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
    if (!path) throw new Error(say.nothing);
    const made = { path, made: key };
    const shown = shownBoards.get(project);
    if (shown?.board === board) shown.take(node, made);
    else {
      /* the board closed, or another shown, meanwhile: written into it as kept */
      const doc = readCanvasDoc(await api.canvas(project, board));
      await api.putCanvas(project, { ...doc, nodes: doc.nodes.map((n) => (n.id === node ? withVersion(n, made) : n)) }, board);
    }
    return true;
  } catch (e) {
    /* what the service's account lacked is said to the person (its dialog says where to top it up), not as told to an agent */
    if (!abort.signal.aborted) runErrors.set(id, (e as { reason?: string })?.reason === 'balance' ? say.balance : e instanceof Error ? e.message : String(e));
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
  /** a node's card drawn this big */
  resize: (id: string, size: { w: number; h: number }) => void;
  /** a node of a kind made from this one: beside it on the right, wired from it (with what it starts with) */
  spawn: (id: string, kind: SpawnKind, data?: Partial<MakeData>) => void;
  /** files made from a node on this computer (its picture's cells, a frame of its clip): into the project, beside it */
  bring: (id: string, files: File[]) => void;
  /** a picture's background taken out by the person's service: a new picture beside it */
  cutout: (id: string, path: string) => void;
  remove: (ids: string[]) => void;
  /** the board as it is now kept to go back to: called before a change made in a node (a resize, words written) */
  willChange: () => void;
  /** the note or group name being written in (null: none) */
  editing: string | null;
  edit: (id: string | null) => void;
  /** the one node selected, which shows its panel and its actions (null: none, or more than one) */
  single: string | null;
  /** a node picked by a click of its own (a group's title bar): it alone, or added to what is picked (`add`) */
  select: (id: string, add: boolean) => void;
  /** making: with what, whether it is at it or failed, what changed since, what it cannot use */
  choices: (kind: MakeKind) => Choice[];
  /** every service's models for a kind, the ones to connect after */
  allChoices: (kind: MakeKind) => Choice[];
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
  /** what goes into a node picked on the board itself, a click a node (its panel's "From the canvas") */
  pick: (id: string) => void;
  /** a group taken apart (what was in it stays where it is), or kept as a template */
  ungroup: (group: string) => void;
  keepTemplate: (group: string) => void;
  /** a group's pictures, or a picture, kept as a character; a library opened (for a node: what is picked goes into it) */
  keepCharacter: (id: string) => void;
  openLibrary: (which: 'characters' | 'styles' | 'effects', node?: string) => void;
  openSettings: () => void;
  /** what is in a group laid out again in rows, clear of each other */
  tidy: (group: string) => void;
  /** a picture changed in part (brushed or drawn on, then said what to): the editor opened on it */
  redraw: (id: string, path: string) => void;
  /** a text node's words written by the person's agent from what they ask and what is wired in (in the app with a chat); why not, if not */
  write?: (id: string, ask: string) => Promise<string | null>;
  /** a board only looked at (an example's): nothing on it is changed, made or wired */
  readOnly?: boolean;
}
export const BoardContext = React.createContext<Board | null>(null);
export const useBoard = () => React.useContext(BoardContext)!;
