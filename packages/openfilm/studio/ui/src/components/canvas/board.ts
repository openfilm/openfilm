/**
 * The canvas's own model as React Flow draws it (toFlow, fromFlow), what each node needs of the board around it
 * (Board, BoardContext), and what is being made with the person's services: held beyond the board, so closing the
 * canvas neither stops a clip being made nor loses it.
 */
import React from 'react';
import type { Edge, Node } from '@xyflow/react';
import { api, type CanvasCharacter } from '@/api';
import type { RedrawStart } from './redraw';
import { AUDIO_W, CARD_H, CUT_W, FILE_W, MAKE_MEDIA, NOTE_H, NOTE_W, cardWidth, makeSize, readCanvasDoc, withVersion, type CanvasDoc, type CanvasNode, type GroupColor, type MakeKind, type MediaOf, type ModelSpec, receiptOf } from '@/lib/canvas';
import type { ProvidersState } from '@/lib/providers';
import type { MediaSources, WorkspaceResource } from '@/lib/workspace-resources';
import { pendingCanvasMedia } from '@/lib/canvas-media-recovery';

export type UploadStatus = { name: string; kind: WorkspaceResource['kind']; progress: number };
export function fileCardWidth(file?: WorkspaceResource | null) {
  return file?.kind === 'audio' ? AUDIO_W : cardWidth(file?.w && file.h ? `${file.w}:${file.h}` : undefined);
}

export type FileData = { path: string; title?: string; by?: CanvasNode['by']; upload?: UploadStatus };
/** `versions`: its earlier words, the ones its agent's writing took the place of (oldest first) */
export type NoteData = { text: string; title?: string; color?: GroupColor; versions?: string[]; by?: CanvasNode['by'] };
export type FrameData = { label: string; color: GroupColor };
export type MakeData = Pick<CanvasNode, 'prompt' | 'via' | 'model' | 'opts' | 'preset' | 'versions' | 'path' | 'made' | 'by' | 'title'> & { make: MakeKind };
export type CutData = { by?: CanvasNode['by'] };
export type FileNode = Node<FileData, 'file'>;
export type NoteNode = Node<NoteData, 'note'>;
export type FrameNode = Node<FrameData, 'frame'>;
export type MakeNode = Node<MakeData, 'make'>;
export type CutNode = Node<CutData, 'cut'>;
export type BoardNode = FileNode | NoteNode | FrameNode | MakeNode | CutNode;

/** what a node's name counts among: texts with texts, pictures with pictures (a making node by what it makes), cuts with cuts */
const countedAs = (node: Pick<BoardNode, 'type' | 'data'>) => (node.type === 'make' ? `make:${(node.data as MakeData).make}` : node.type ?? '');

/** A node's number among the board's nodes of its kind, from 1, as its name numbers it ("Text 1", "Picture 1"). */
export function numberOf(nodes: ReadonlyArray<Pick<BoardNode, 'id' | 'type' | 'data'>>, id: string): number {
  const self = nodes.find((node) => node.id === id);
  if (!self) return 0;
  const kind = countedAs(self);
  let n = 0;
  for (const node of nodes) { if (countedAs(node) !== kind) continue; n += 1; if (node.id === id) break; }
  return n;
}
export type MakingNode = CanvasNode & { make: MakeKind };

/** The board as React Flow draws it: groups before what is in them, as it needs them. */
export function toFlow(doc: CanvasDoc): { nodes: BoardNode[]; edges: Edge[] } {
  const ordered = [...doc.nodes.filter((n) => n.group != null), ...doc.nodes.filter((n) => n.group == null)];
  return {
    nodes: ordered.map((n): BoardNode => {
      const base = { id: n.id, position: { x: n.x, y: n.y }, ...(n.parent ? { parentId: n.parent } : {}), ...(n.z ? { zIndex: n.z } : {}) };
      const by = n.by ? { by: n.by } : {};
      if (n.group != null) return { ...base, type: 'frame', width: n.w ?? 480, height: n.h ?? 320, zIndex: n.z ?? -1, ...GROUP_HELD, data: { label: n.group, color: n.color ?? 'gray' } };
      if (n.make) {
        const { id: _id, x: _x, y: _y, w: _w, h: _h, z: _z, parent: _parent, text: _text, group: _group, color: _color, cut: _cut, ...data } = n;
        /* sized as resized; else (and on a board from before cards had a height) as its shape draws it */
        const size = n.w != null && n.h != null ? { w: n.w, h: n.h } : makeSize(n.make, n.opts?.ratio);
        return { ...base, type: 'make', width: size.w, height: size.h, data: { ...data, make: n.make } };
      }
      if (n.cut) return { ...base, type: 'cut', width: n.w ?? CUT_W, height: n.h ?? CARD_H, data: { ...by } };
      /* a file is as its picture draws it until resized */
      if (n.path != null) return { ...base, type: 'file', ...(n.w != null && n.h != null ? { width: n.w, height: n.h } : {}), data: { path: n.path, ...(n.title ? { title: n.title } : {}), ...by } };
      return { ...base, type: 'note', width: n.w ?? NOTE_W, height: n.h ?? NOTE_H, data: { text: n.text ?? '', ...(n.title ? { title: n.title } : {}), ...(n.color ? { color: n.color } : {}), ...(n.versions?.length ? { versions: n.versions } : {}), ...by } };
    }),
    edges: doc.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, ...(e.order != null ? { data: { order: e.order } } : {}) })),
  };
}

export function fromFlow(nodes: readonly BoardNode[], edges: readonly Edge[]): CanvasDoc {
  return {
    nodes: nodes.map((n) => {
      const box = { id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y),
        ...(n.parentId ? { parent: n.parentId } : {}), ...(n.zIndex && n.zIndex > 0 ? { z: n.zIndex } : {}) };
      const w = Math.round(n.width ?? n.measured?.width ?? (n.type === 'note' ? NOTE_W : n.type === 'cut' ? CUT_W : FILE_W));
      const h = () => Math.round(n.height ?? n.measured?.height ?? (n.type === 'note' ? NOTE_H : CARD_H));
      const by = 'by' in n.data && n.data.by ? { by: n.data.by } : {};
      if (n.type === 'file') return { ...box, ...by, ...(n.width != null && n.height != null ? { w, h: h() } : {}), path: n.data.path, ...(n.data.title ? { title: n.data.title } : {}) };
      if (n.type === 'make') return { ...box, w, h: h(), ...n.data };
      if (n.type === 'cut') return { ...box, ...by, w, h: h(), cut: true as const };
      if (n.type === 'frame') return { id: n.id, x: box.x, y: box.y, ...(n.zIndex && n.zIndex > 0 ? { z: n.zIndex } : {}), w, h: h(), group: n.data.label, color: n.data.color };
      return { ...box, ...by, w, h: h(), ...(n.data.title ? { title: n.data.title } : {}), text: n.data.text, ...(n.data.color ? { color: n.data.color } : {}), ...(n.data.versions?.length ? { versions: n.data.versions } : {}) };
    }),
    edges: edges.map((e) => ({ id: e.id, from: e.source, to: e.target, ...(typeof e.data?.order === 'number' ? { order: e.data.order } : {}) })),
  };
}

/** Cards without a saved layer are newer than the saved stack and follow document order. */
export function nextCardLayer(nodes: readonly BoardNode[]) {
  return Math.max(0, ...nodes.map((node) => node.zIndex ?? 0)) + 1;
}

/**
 * The board's stack after `moved` were let go: what was moved goes on top, the rest keep their order. A group is an
 * object like a card: it moves on top with everything in it, which stays above it.
 */
export function raiseCards(nodes: BoardNode[], moved: readonly BoardNode[]) {
  const ids = new Set(moved.map((node) => node.id));
  if (!ids.size) return nodes;
  const defaultLayer = nextCardLayer(nodes);
  /* a group's layer when it has none: under the cards, as groups always were */
  const layerOf = (node: BoardNode) => node.zIndex ?? (node.type === 'frame' ? 0 : defaultLayer);
  const frames = new Set(nodes.filter((node) => node.type === 'frame').map((node) => node.id));
  const inside = (node: BoardNode) => Boolean(node.parentId && frames.has(node.parentId));
  /* the stack's units: each group with what is in it, and each card on its own */
  const units = nodes.filter((node) => !inside(node)).map((head) => ({
    head, members: head.type === 'frame' ? nodes.filter((node) => node.parentId === head.id).sort((a, b) => layerOf(a) - layerOf(b)) : [],
  }));
  const raised = (unit: (typeof units)[number]) => Number(ids.has(unit.head.id) || unit.members.some((m) => ids.has(m.id)));
  units.sort((a, b) => raised(a) - raised(b) || layerOf(a.head) - layerOf(b.head));
  const layers = new Map(units.flatMap((unit) => [unit.head, ...unit.members]).map((node, index) => [node.id, index + 1]));
  return nodes.map((node) => ({ ...node, zIndex: layers.get(node.id) ?? node.zIndex }));
}

/** A node's box on the board, whatever group it is in, as it is drawn. */
export function boxOf(node: BoardNode, byId: ReadonlyMap<string, BoardNode>): { x: number; y: number; w: number; h: number } {
  const parent = node.parentId ? byId.get(node.parentId) : undefined;
  const at = parent ? { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y } : node.position;
  return { ...at, w: node.measured?.width ?? node.width ?? FILE_W, h: node.measured?.height ?? node.height ?? CARD_H };
}

/**
 * A group is held by its title bar. The board handles marquee selection of whole groups separately from their cards.
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
/** a picture's own tools, each in a window over the board */
export type PictureTool = 'expand' | 'crop' | 'adjust' | 'light';
export type AssistKind = 'prompt' | 'ideas' | 'shots' | 'text';

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

/** a run: when it started; `left` once the person stopped waiting for it (what it makes still lands in the project) */
export interface Run { started: number; abort: AbortController; left?: boolean }
type Made = { path: string; made: string };
/** by `project/node` */
export const runs = new Map<string, Run>();
export const runErrors = new Map<string, string>();
/** the board shown for each project, to take what was made */
/**
 * How long a model takes, as this person's own runs with it took (the middle of the last few that made something),
 * kept in this browser: what the progress on a card making with it is measured against. None run yet: none shown.
 */
const TIMES_KEY = 'openfilm.canvas.times';
const readKept = <T>(key: string): Record<string, T> => { try { return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, T>; } catch { return {}; } };
export function modelTime(via: string, model?: string): number | null {
  const list = readKept<number[]>(TIMES_KEY)[`${via}|${model ?? ''}`];
  if (!Array.isArray(list) || !list.length) return null;
  return [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]!;
}
export function keepModelTime(via: string, model: string | undefined, seconds: number) {
  const all = readKept<number[]>(TIMES_KEY);
  const key = `${via}|${model ?? ''}`;
  all[key] = [...(all[key] ?? []), Math.round(seconds)].slice(-5);
  try { localStorage.setItem(TIMES_KEY, JSON.stringify(all)); } catch { /* not kept */ }
}

/** The model last picked for each kind, kept in this browser: a new node of that kind makes with it. */
const LAST_KEY = 'openfilm.canvas.lastModel';
export function lastModel(kind: MakeKind): { via: string; model?: string } | null {
  const kept = readKept<{ via?: unknown; model?: unknown }>(LAST_KEY)[kind];
  return kept && typeof kept.via === 'string' ? { via: kept.via, ...(typeof kept.model === 'string' ? { model: kept.model } : {}) } : null;
}
export function keepLastModel(kind: MakeKind, choice: { via: string; model?: string } | null) {
  const all = readKept<unknown>(LAST_KEY);
  if (choice) all[kind] = { via: choice.via, ...(choice.model ? { model: choice.model } : {}) };
  else delete all[kind];
  try { localStorage.setItem(LAST_KEY, JSON.stringify(all)); } catch { /* not kept */ }
}

/** each project's board shown now (which of its boards, and how what is made comes onto it) */
export const shownBoards = new Map<string, { board: string; take: (node: string, made: Made) => void }>();
let runsVersion = 0;
const runWatchers = new Set<() => void>();
export const runsChanged = () => { runsVersion += 1; for (const watch of runWatchers) watch(); };
export const useRuns = () => React.useSyncExternalStore((watch) => { runWatchers.add(watch); return () => { runWatchers.delete(watch); }; }, () => runsVersion);

/** Whether it made one (false: it failed, was stopped, or was being made already). */
export async function startRun(project: string, folder: string, node: string, request: { verb: string; args: Record<string, string | string[]> }, pick: { via?: string; model?: string }, key: string,
  say: { nothing: string; balance: string }, board = 'main', recovery?: {scope:string;onResumed?:()=>void}): Promise<boolean> {
  const id = `${project}/${node}`;
  if (runs.has(id)) return false;
  const abort = new AbortController();
  const run: Run = { started: Date.now(), abort };
  runs.set(id, run);
  runErrors.delete(id);
  runsChanged();
  try {
    const pending = recovery ? await pendingCanvasMedia([folder,board,node,recovery.scope],request,pick) : null;
    if (pending?.resumed) recovery?.onResumed?.();
    /* the person pressed Make on it: what it costs is not asked again, as an agent's would be */
    const asked = pending?.request ?? request;
    const receipt = receiptOf<{ src?: string; images?: Array<{ src?: string }> }>(await api.make(folder, asked.verb, asked.args, { ...pick, yes: true }, abort.signal));
    const path = receipt.src ?? receipt.images?.[0]?.src;
    if (!path) throw new Error(say.nothing);
    /* stopped: it was paid for once it started, so it is kept in the project (and its history), not on the node */
    if (run.left) { pending?.finish(); return false; }
    const made = { path, made: key };
    const shown = shownBoards.get(project);
    if (shown?.board === board) shown.take(node, made);
    else {
      /* the board closed, or another shown, meanwhile: written into it as kept */
      const doc = readCanvasDoc(await api.canvas(project, board));
      await api.putCanvas(project, { ...doc, nodes: doc.nodes.map((n) => (n.id === node ? withVersion(n, made) : n)) }, board);
    }
    pending?.finish();
    return true;
  } catch (e) {
    /* what the service's account lacked is said to the person (its dialog says where to top it up), not as told to an agent */
    if (!abort.signal.aborted && !run.left) runErrors.set(id, (e as { reason?: string })?.reason === 'balance' ? say.balance : e instanceof Error ? e.message : String(e));
    return false;
  } finally {
    if (runs.get(id) === run) runs.delete(id);
    runsChanged();
  }
}

/**
 * Stop waiting for a run. What is being made is not called off: a service charges once it starts, and most cannot
 * stop then, so it is let finish and land in the project (and its history) rather than be paid for and lost; the node
 * is free at once to make again.
 */
export function leaveRun(project: string, node: string) {
  const id = `${project}/${node}`;
  const run = runs.get(id);
  if (!run) return;
  run.left = true;
  runs.delete(id);
  runsChanged();
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
  /** a node made from this one, wired from it: its id */
  spawn: (id: string, kind: SpawnKind, data?: Partial<MakeData>) => string;
  /** a picture's own tool opened over the board: widen, crop and turn, color, light */
  openTool: (id: string, path: string, tool: PictureTool) => void;
  /** a picture made again at each of these shapes, in a group beside it, made at once */
  sizes: (id: string, ratios: string[]) => void;
  /** a product's set of pictures (each a preset: main shot, detail, in use, ad, features), in a group beside it, made at once */
  productSet: (id: string, presets: string[]) => void;
  /** a picture parted into its subject (cut out) and the background without it */
  layers: (id: string, path: string) => void;
  /** the agent reading a picture into words, on a text node beside it: its prompt, ideas, a shot list, its text to edit */
  assist: (id: string, path: string, kind: AssistKind) => void;
  /** files made from a node on this computer (its picture's cells, a frame of its clip): into the project, beside it */
  bring: (id: string, files: File[]) => void;
  uploading?: (id: string) => UploadStatus | undefined;
  shown?: boolean;
  showComposer?: (id: string) => void;
  reportError?: (error: string) => void;
  /** a picture's background taken out by the person's service: a new picture beside it */
  cutout: (id: string, path: string) => void;
  /** a clip worked on this computer: a part of it (asks where), its sound, cropped to a shape; beside it, wired from it */
  clipTool: (id: string, path: string, op: 'trim' | 'audio' | 'crop', ratio?: string) => void;
  /** a clip tool done by a model opened for a clip: what it asks, then the clip made beside it */
  clipAI: (id: string, path: string, tool: import('@/lib/canvas-clip').ClipToolKey) => void;
  /** a clip's shots, a still where each begins, in a group beside it */
  shots: (id: string, path: string) => void;
  /** the agent reading a clip (its shots) into words beside it: a shot list, or a prompt to make it again */
  clipAssist: (id: string, path: string, kind: 'shots' | 'prompt') => void;
  /** a picture of panels cut into them (`rows`×`cols`, or 0×0: as its gutters say), laid out in a group beside it */
  split: (id: string, path: string, rows: number, cols: number) => void;
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
  /** a node's name as its name row shows it ("Picture 1", "Picture 1_Expand") */
  nameOf: (id: string) => string;
  /** what goes into a node put in this order (its wires, by id): the first is the first reference */
  reorderInputs: (id: string, edges: readonly string[]) => void;
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
  /** a subject wired into a node: its main picture, named as it is (what @its name in the node's words means) */
  useSubject: (id: string, subject: CanvasCharacter) => void;
  openLibrary: (which: 'characters' | 'styles' | 'effects', node?: string) => void;
  /** what a node is shot with, picked: words wired into it */
  openCamera: (node: string) => void;
  openSettings: () => void;
  /** what is in a group laid out again in rows, clear of each other */
  tidy: (group: string) => void;
  /** a picture changed in part (brushed or drawn on, then said what to): the editor opened on it */
  redraw: (id: string, path: string, start?: RedrawStart) => void;
  /** a text node's words written by the person's agent from what they ask and what is wired in (in the app with a chat); why not, if not */
  write?: (id: string, ask: string, attachments: string[]) => Promise<string | null>;
  /** whether a text node is being written by the agent now (since when), and its writing stopped */
  writing?: (id: string) => number | undefined;
  stopWriting?: (id: string) => void;
  /** a node brought into view and flashed, as what something is made from is found */
  locate?: (id: string) => void;
  /** a node made a reference in the chat's message (in the app with a chat), for the agent to change or make from */
  refer?: (id: string) => void;
  uploadWritingFiles?: (files: File[], onProgress?: (index: number, progress: number, path?: string) => void) => Promise<string[]>;
  /** a board only looked at (an example's): nothing on it is changed, made or wired */
  readOnly?: boolean;
}
export const BoardContext = React.createContext<Board | null>(null);
export const useBoard = () => React.useContext(BoardContext)!;
