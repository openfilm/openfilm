/**
 * The project's canvas as kept (`.film/canvas.json`, studio/server/canvas.mjs): notes, the project's files and what is
 * being made laid out on a board, in groups or not, and edges between them; what an undo goes back to, what a copy
 * makes, and what a node that makes something asks `get` for. The board itself is components/canvas.
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
  /** who put it here, when not the person: an agent, in which of its conversations */
  by?: { agent: string; session?: string };
  /**
   * a node that makes something (MAKE_KINDS) with the person's services: what it is asked (`prompt`, and the words and
   * pictures wired into it), by which service and model (none: the person's choice in Settings) and its options; what
   * it made is `versions` (files in assets/, oldest first), the one shown its `path`
   */
  make?: MakeKind;
  prompt?: string;
  via?: string;
  model?: string;
  opts?: MakeOptions;
  versions?: string[];
  /** what it was asked when it last made one (inputsKey): when that is not what it would be asked now, it is stale */
  made?: string;
}

/** What a node can make, as `get` names it. */
export const MAKE_KINDS = ['image', 'video', 'sfx', 'music'] as const;
export type MakeKind = typeof MAKE_KINDS[number];
/** a picture's shape, a clip's length or a sound's, and whether the pictures wired into a video are its first and last frames */
export interface MakeOptions { ratio?: string; sec?: number; frames?: boolean }

/** What each kind makes, as the board shows it. */
export const MAKE_MEDIA: Record<MakeKind, 'image' | 'video' | 'audio'> = { image: 'image', video: 'video', sfx: 'audio', music: 'audio' };
export const IMAGE_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'] as const;
export const VIDEO_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const;
/** how long what is made may be, in seconds, and how long it is unless asked */
export const MAKE_SECONDS: Partial<Record<MakeKind, { min: number; max: number; default: number }>> = {
  video: { min: 4, max: 30, default: 5 }, sfx: { min: 0.5, max: 22, default: 3 }, music: { min: 3, max: 300, default: 30 },
};

export const GROUP_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type GroupColor = typeof GROUP_COLORS[number];

/** `order`: where what it brings stands among what goes into `to` (lowest first; none: after those that have one) */
export interface CanvasEdge { id: string; from: string; to: string; order?: number }

export interface CanvasDoc { nodes: CanvasNode[]; edges: CanvasEdge[] }

export const NOTE_W = 240;
export const NOTE_H = 140;
export const FILE_W = 280;
export const MAKE_W = 320;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The board as the server sent it: what is not a node or an edge is left out (it keeps the same rule). */
export function readCanvasDoc(raw: unknown): CanvasDoc {
  const doc = raw as { nodes?: unknown; edges?: unknown } | null;
  const nodes: CanvasNode[] = [];
  const ids = new Set<string>();
  for (const n of Array.isArray(doc?.nodes) ? doc.nodes as Array<Record<string, unknown>> : []) {
    if (!n || typeof n.id !== 'string' || ids.has(n.id) || !num(n.x) || !num(n.y)) continue;
    const box = { id: n.id, x: n.x, y: n.y, ...(num(n.w) ? { w: n.w } : {}), ...(num(n.h) ? { h: n.h } : {}) };
    const by = n.by as { agent?: unknown; session?: unknown } | undefined;
    const parent = {
      ...(typeof n.parent === 'string' ? { parent: n.parent } : {}),
      ...(by && typeof by.agent === 'string' && by.agent ? { by: { agent: by.agent, ...(typeof by.session === 'string' && by.session ? { session: by.session } : {}) } } : {}),
    };
    const make = MAKE_KINDS.find((k) => k === n.make);
    if (make) nodes.push({ ...box, ...parent, ...readMake(n), make });
    else if (typeof n.path === 'string' && n.path) nodes.push({ ...box, ...parent, path: n.path });
    else if (typeof n.text === 'string') nodes.push({ ...box, ...parent, text: n.text });
    else if (typeof n.group === 'string') {
      const color = GROUP_COLORS.find((c) => c === n.color) ?? 'gray';
      nodes.push({ ...box, ...(parent.by ? { by: parent.by } : {}), group: n.group, color });
    }
    else continue;
    ids.add(n.id);
  }
  const edges = (Array.isArray(doc?.edges) ? doc.edges as Array<Record<string, unknown>> : [])
    .filter((e): e is { id: string; from: string; to: string; order?: unknown } => Boolean(e) && typeof e.id === 'string'
      && typeof e.from === 'string' && typeof e.to === 'string' && ids.has(e.from) && ids.has(e.to));
  return { nodes, edges: edges.map((e) => ({ id: e.id, from: e.from, to: e.to, ...(num(e.order) ? { order: e.order } : {}) })) };
}

/** A making node's own fields, as sent (its kind aside). */
function readMake(n: Record<string, unknown>): Omit<CanvasNode, 'id' | 'x' | 'y' | 'make'> {
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const o = (n.opts && typeof n.opts === 'object' ? n.opts : {}) as Record<string, unknown>;
  const opts: MakeOptions = {
    ...(str(o.ratio) ? { ratio: o.ratio as string } : {}),
    ...(num(o.sec) ? { sec: o.sec } : {}),
    ...(o.frames === true ? { frames: true } : {}),
  };
  const versions = Array.isArray(n.versions) ? n.versions.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
  const fields = {
    prompt: typeof n.prompt === 'string' ? n.prompt : '',
    via: str(n.via), model: str(n.model),
    opts: Object.keys(opts).length ? opts : undefined,
    versions: versions.length ? versions : undefined,
    path: str(n.path) && versions.includes(n.path as string) ? n.path as string : versions.at(-1),
    made: str(n.made),
  };
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
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
    /* a copy is the person's, whoever put the first one there */
    const { parent: _parent, by: _by, ...rest } = n;
    return {
      ...rest,
      id: fresh.get(n.id)!,
      /* in a copied group: where it was in it; else moved by the offset, and out of a group not copied */
      ...(inCopiedGroup ? { parent: fresh.get(n.parent!)! } : { x: n.x + offset.x, y: n.y + offset.y, ...(n.parent ? { parent: n.parent } : {}) }),
    };
  });
  const edges = doc.edges.filter((e) => taken.has(e.from) && taken.has(e.to))
    .map((e) => ({ id: canvasId('e'), from: fresh.get(e.from)!, to: fresh.get(e.to)!, ...(e.order != null ? { order: e.order } : {}) }));
  return { nodes, edges };
}

/* ── what a making node is asked ── */

/** What is wired into a node, in its order: a note's words, a file's (or what a node made) path and what it is. */
export type MakeInput = { from: string; text: string } | { from: string; path: string; media: 'image' | 'video' | 'audio' };

/** What a file is, as the board knows it: a picture, a clip, a sound; anything else is not an input. */
export type MediaOf = (path: string) => 'image' | 'video' | 'audio' | null;

/** What is wired into `id`, in the order its edges say (then as they were drawn). */
export function inputsOf(doc: CanvasDoc, id: string, mediaOf: MediaOf): MakeInput[] {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const into = doc.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.to === id)
    .sort((a, b) => (a.e.order ?? Infinity) - (b.e.order ?? Infinity) || a.i - b.i);
  const inputs: MakeInput[] = [];
  for (const { e } of into) {
    const n = byId.get(e.from);
    if (!n) continue;
    if (n.make) { if (n.path) inputs.push({ from: n.id, path: n.path, media: MAKE_MEDIA[n.make] }); continue; }
    if (n.path != null) {
      const media = mediaOf(n.path);
      if (media) inputs.push({ from: n.id, path: n.path, media });
    } else if (n.text != null && n.text.trim()) inputs.push({ from: n.id, text: n.text.trim() });
  }
  return inputs;
}

/** What a node is asked, in a few characters: the same when nothing it is asked has changed. */
export function inputsKey(node: CanvasNode, inputs: readonly MakeInput[]): string {
  const said = JSON.stringify([node.make, node.prompt ?? '', node.via ?? '', node.model ?? '', node.opts ?? {},
    inputs.map((i) => ('text' in i ? ['t', i.text] : ['f', i.path]))]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < said.length; i++) hash = Math.imul(hash ^ said.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(36);
}

/** Whether what a node last made was made from what it would not be asked now (it made nothing: it is not). */
export function isStale(node: CanvasNode, inputs: readonly MakeInput[]): boolean {
  return Boolean(node.make && node.path && node.made && node.made !== inputsKey(node, inputs));
}

/**
 * What `get` is asked to make a node's next version: its verb and its options. The words wired in come before its own
 * prompt; pictures wired into a video are its references (or its first and last frames). What the kind cannot take
 * (pictures for a picture, a clip, a sound) is counted in `unused`.
 */
export function makeRequest(node: CanvasNode & { make: MakeKind }, inputs: readonly MakeInput[], name: string):
  { verb: MakeKind; args: Record<string, string | number | string[]>; unused: number } {
  const words = [...inputs.flatMap((i) => ('text' in i ? [i.text] : [])), (node.prompt ?? '').trim()].filter(Boolean).join('\n\n');
  const pictures = inputs.flatMap((i) => ('media' in i && i.media === 'image' ? [i.path] : []));
  const others = inputs.filter((i) => 'media' in i && i.media !== 'image').length;
  const args: Record<string, string | number | string[]> = { out: name, prompt: words };
  const opts = node.opts ?? {};
  const seconds = MAKE_SECONDS[node.make];
  if (seconds) args[node.make === 'video' ? 'duration' : 'sec'] = Math.min(seconds.max, Math.max(seconds.min, opts.sec ?? seconds.default));
  let used = 0;
  if (node.make === 'image') args.ratio = opts.ratio ?? '16:9';
  if (node.make === 'video') {
    if (opts.ratio) args['aspect-ratio'] = opts.ratio;
    if (opts.frames && pictures.length) {
      args['first-frame'] = pictures[0]!;
      if (pictures[1]) args['last-frame'] = pictures[1];
      used = Math.min(2, pictures.length);
    } else if (pictures.length) { args['input-reference'] = pictures; used = pictures.length; }
  }
  return { verb: node.make, args, unused: pictures.length - used + others };
}

/** A name for what a node makes next: from its words, and when, so no two are the same. */
export function makeName(node: CanvasNode & { make: MakeKind }, now = Date.now()): string {
  const words = (node.prompt ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 4);
  return `${words.length ? words.join('-') : node.make}-${now.toString(36)}`;
}

/** The edge's place among what goes into its node: after every other one there. */
export function nextOrder(doc: CanvasDoc, to: string): number {
  return doc.edges.filter((e) => e.to === to).reduce((max, e) => Math.max(max, (e.order ?? -1) + 1), 0);
}

/** The edges into `to` numbered again from 0 in their order, `first` (when given) at the front. */
export function reorder(doc: CanvasDoc, to: string, first?: string): CanvasEdge[] {
  const into = doc.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.to === to)
    .sort((a, b) => Number(b.e.id === first) - Number(a.e.id === first) || (a.e.order ?? Infinity) - (b.e.order ?? Infinity) || a.i - b.i);
  const place = new Map(into.map(({ e }, i) => [e.id, i]));
  return doc.edges.map((e) => (place.has(e.id) ? { ...e, order: place.get(e.id)! } : e));
}

/** A node with what it just made: its newest version, shown, and what it was asked for it. */
export function withVersion<N extends Pick<CanvasNode, 'versions' | 'path' | 'made'>>(node: N, made: { path: string; made: string }): N {
  return { ...node, versions: [...(node.versions ?? []).filter((v) => v !== made.path), made.path], path: made.path, made: made.made };
}
