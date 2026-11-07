/**
 * The project's canvas as kept (`.film/canvas.json`, studio/server/canvas.mjs): notes, the project's files and what is
 * being made laid out on a board, in groups or not, and edges between them; what an undo goes back to, what a copy
 * makes, and what a node that makes something asks `get` for. The board itself is components/canvas.
 */
import { presetOf } from './canvas-presets.ts';

export interface CanvasNode {
  id: string;
  x: number;
  y: number;
  /** its card's size on the board, once sized (a file's follows its picture until resized) */
  w?: number;
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
  /** a cut: what is wired into it, in its order, goes onto the timeline */
  cut?: true;
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
  /** a way to ask for a picture that came with the canvas (lib/canvas-presets), its words put before the node's */
  preset?: string;
  versions?: string[];
  /** what it was asked when it last made one (inputsKey): when that is not what it would be asked now, it is stale */
  made?: string;
}

/** What a node can make, as `get` names it. */
export const MAKE_KINDS = ['image', 'video', 'sfx', 'music', 'tts'] as const;
export type MakeKind = typeof MAKE_KINDS[number];
/**
 * a picture's shape and quality, a clip's length or a sound's, and whether the pictures wired into a video are its first
 * and last frames
 */
export interface MakeOptions {
  ratio?: string; sec?: number; frames?: boolean; quality?: string; mode?: VideoMode;
  /** a picture's size (1k, 2k, 4k) or a clip's resolution (720p…); a picture with no background; how many are made at once */
  size?: string; transparent?: boolean; count?: number;
  /** a picture made as a GIF (its frames and each one's length) or an SVG; one redrawn from the first picture wired in,
      where a mask (a PNG, clear where it is redrawn) or a markup (changes drawn on a clear PNG) says */
  format?: 'gif' | 'svg'; gifFrames?: number; frameMs?: number; mask?: string; markup?: string;
  /** a voice-over's voice, its id at its service (`openfilm get tts --voice`) */
  voice?: string;
}

/** how many a node makes at once */
export const MAKE_COUNTS = [1, 2, 4] as const;
/** a GIF's frames and each frame's length, unless asked otherwise (`openfilm get image --format gif`) */
export const GIF_FRAMES = 9;
export const GIF_FRAME_MS = 200;

/**
 * How a clip is made from what is wired in: from the words alone; from everything wired in as references (pictures,
 * a clip, a voice: `omni`); from a picture as its first frame; between a first and a last frame; from pictures as
 * references.
 */
export const VIDEO_MODES = ['text', 'omni', 'first', 'firstLast', 'refs'] as const;
export type VideoMode = typeof VIDEO_MODES[number];

/**
 * What a model makes, as its provider says (studio/server/providers/contract.mjs ModelSpec): its shapes, a clip's
 * lengths (a range, or `only` some), the most pictures it is made from, whether a clip starts from a first frame, a
 * picture's qualities (the finest last), and a clip made only from a clip or a recording. Nothing said: the usual.
 */
export interface ModelSpec {
  ratios?: string[]; seconds?: [number, number]; only?: number[]; refs?: number; frames?: boolean; qualities?: string[]; needs?: 'clip' | 'audio';
  /** a clip that takes a recording of whose voice speaks in it, a clip of its own to continue or change */
  voice?: boolean; clip?: boolean;
  /** a picture's sizes (1k, 2k, 4k) or a clip's resolutions (480p…), as it makes them; a picture with no background */
  sizes?: string[]; transparent?: boolean;
  /** a picture's formats beyond PNG (gif, svg); one redrawn where a mask leaves it clear, or where changes are drawn on it */
  formats?: string[]; mask?: boolean; markup?: boolean;
}

/** What each kind makes, as the board shows it. */
export const MAKE_MEDIA: Record<MakeKind, 'image' | 'video' | 'audio'> = { image: 'image', video: 'video', sfx: 'audio', music: 'audio', tts: 'audio' };
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

/**
 * How big a card is drawn, at 100%: a picture's or a clip's is CARD_H high and as wide as its shape makes it (16:9,
 * MAKE_W); words, a sound and a cut are a box of their own. A new text is square until written in.
 */
export const CARD_H = 350;
export const NOTE_W = 350;
export const NOTE_H = 200;
export const AUDIO_W = 320;
export const CUT_W = 350;
export const MAKE_W = 622;
export const FILE_W = MAKE_W;

/** A card's width at CARD_H high for a shape ('16:9'). */
export function cardWidth(ratio: string | undefined, h = CARD_H): number {
  const [w, hh] = (ratio ?? '16:9').split(':').map(Number);
  return w && hh ? Math.round((h * w) / hh) : MAKE_W;
}

/** A making node's card, as it is drawn until resized: a sound's box, else its shape at CARD_H high. */
export function makeSize(make: MakeKind, ratio?: string): { w: number; h: number } {
  return MAKE_MEDIA[make] === 'audio' ? { w: AUDIO_W, h: CARD_H } : { w: cardWidth(ratio), h: CARD_H };
}

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
    else if (n.cut === true) nodes.push({ ...box, ...parent, cut: true });
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
    ...(str(o.quality) ? { quality: o.quality as string } : {}),
    ...(VIDEO_MODES.find((m) => m === o.mode) ? { mode: o.mode as VideoMode } : {}),
    ...(str(o.size) ? { size: o.size as string } : {}),
    ...(o.transparent === true ? { transparent: true } : {}),
    ...(MAKE_COUNTS.find((c) => c === o.count && c > 1) ? { count: o.count as number } : {}),
    ...(o.format === 'gif' || o.format === 'svg' ? { format: o.format } : {}),
    ...(num(o.gifFrames) ? { gifFrames: o.gifFrames } : {}),
    ...(num(o.frameMs) ? { frameMs: o.frameMs } : {}),
    ...(str(o.mask) ? { mask: o.mask as string } : {}),
    ...(str(o.markup) ? { markup: o.markup as string } : {}),
    ...(str(o.voice) ? { voice: o.voice as string } : {}),
  };
  const versions = Array.isArray(n.versions) ? n.versions.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
  const fields = {
    prompt: typeof n.prompt === 'string' ? n.prompt : '',
    via: str(n.via), model: str(n.model), preset: str(n.preset),
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

const shortHash = (said: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < said.length; i++) hash = Math.imul(hash ^ said.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(36);
};
/** What is wired into a node, in a few characters. */
const fedKey = (inputs: readonly MakeInput[]): string => shortHash(JSON.stringify(inputs.map((i) => ('text' in i ? ['t', i.text] : ['f', i.path]))));

/**
 * What a node is asked, in a few characters: the same when nothing it is asked has changed. Two parts: all it is asked
 * (its own words and settings with what is wired in), then what is wired in alone.
 */
export function inputsKey(node: CanvasNode, inputs: readonly MakeInput[]): string {
  const said = JSON.stringify([node.make, node.prompt ?? '', node.via ?? '', node.model ?? '', node.opts ?? {},
    inputs.map((i) => ('text' in i ? ['t', i.text] : ['f', i.path])), ...(node.preset ? [node.preset] : [])]);
  return `${shortHash(said)}-${fedKey(inputs)}`;
}

/** Whether what a node last made was made from what it would not be asked now (it made nothing: it is not). */
export function isStale(node: CanvasNode, inputs: readonly MakeInput[]): boolean {
  return Boolean(node.make && node.path && node.made && node.made !== inputsKey(node, inputs));
}

/**
 * Whether what is wired into a node changed since it last made one: what the person changed in the node itself, they
 * know; a picture changed upstream, they may not. A node made before its key had two parts: not said.
 */
export function inputsChanged(node: CanvasNode, inputs: readonly MakeInput[]): boolean {
  const fed = node.make && node.path && node.made ? node.made.split('-')[1] : undefined;
  return Boolean(fed && fed !== fedKey(inputs));
}

/** The lengths a model makes, in seconds, as a range: its own, else the kind's. */
export function lengthRange(kind: MakeKind, spec?: ModelSpec): [number, number] | null {
  const usual = MAKE_SECONDS[kind];
  if (!usual) return null;
  if (spec?.only?.length) return [Math.min(...spec.only), Math.max(...spec.only)];
  return spec?.seconds ?? [usual.min, usual.max];
}

/** How long a node's media is asked to be: what it asks, else the usual, within what its model makes. */
export function lengthOf(kind: MakeKind, asked: number | undefined, spec?: ModelSpec): number | null {
  const usual = MAKE_SECONDS[kind];
  const range = lengthRange(kind, spec);
  if (!usual || !range) return null;
  const want = asked ?? usual.default;
  if (spec?.only?.length) return spec.only.reduce((best, n) => (Math.abs(n - want) < Math.abs(best - want) ? n : best));
  return Math.min(range[1], Math.max(range[0], want));
}

/** The shape a node's media is asked for: what it asks when its model makes it, else the nearest of the model's. */
/** A clip made from a picture is its shape unless asked otherwise: the nearest the model makes (or the usual ones) to it. */
export function frameRatio(w: number | undefined, h: number | undefined, spec?: ModelSpec): string | undefined {
  if (!w || !h) return undefined;
  return ratioOf(`${w}:${h}`, { ...spec, ratios: spec?.ratios?.length ? spec.ratios : [...VIDEO_RATIOS] });
}

export function ratioOf(asked: string | undefined, spec?: ModelSpec): string {
  const want = asked ?? '16:9';
  const ratios = spec?.ratios;
  if (!ratios?.length || ratios.includes(want)) return want;
  const [w, h] = want.split(':').map(Number);
  const r = (w ?? 16) / (h ?? 9);
  return ratios.reduce((best, x) => {
    const [a, b] = x.split(':').map(Number);
    const [c, d] = best.split(':').map(Number);
    return Math.abs(Math.log(a! / b!) - Math.log(r)) < Math.abs(Math.log(c! / d!) - Math.log(r)) ? x : best;
  });
}

/** The ways a model makes a clip (VIDEO_MODES): from words always; from frames, references, or everything, as it takes them. */
export function modesFor(spec?: ModelSpec): VideoMode[] {
  if (spec?.needs) return [];
  const frames = spec?.frames !== false;
  const refs = spec?.refs !== 0;
  return VIDEO_MODES.filter((m) => m === 'text' || (m === 'first' || m === 'firstLast' ? frames : m === 'refs' ? refs : refs && Boolean(spec?.voice || spec?.clip)));
}

/**
 * How a node's clip is made: the way it names, when its model makes clips so; else (a board from before, `frames`)
 * between frames; else from the pictures wired in as its model takes them (references, or a first frame), else words.
 */
export function modeOf(opts: MakeOptions | undefined, spec: ModelSpec | undefined, pictures: number): VideoMode {
  const can = modesFor(spec);
  if (opts?.mode && can.includes(opts.mode)) return opts.mode;
  if (opts?.frames && can.includes('firstLast')) return pictures > 1 ? 'firstLast' : 'first';
  if (!pictures) return 'text';
  return can.includes('refs') ? 'refs' : can.includes('first') ? 'first' : 'text';
}

/**
 * What `openfilm get` is asked for a node: the words wired in, then its own; a picture made from the pictures wired in
 * (`--ref`); a clip from them (its first and last frames, or references), or from a clip or a recording wired in when
 * its model makes it so; each within what the node's model makes (`spec`). `unused`: what is wired in that it cannot
 * use.
 */
export function makeRequest(node: CanvasNode & { make: MakeKind }, inputs: readonly MakeInput[], name: string, spec?: ModelSpec):
  { verb: MakeKind; args: Record<string, string | string[]>; unused: number } {
  /* a preset's words first, then the words wired in, then the node's own */
  const words = [presetOf(node.preset)?.prompt ?? '', ...inputs.flatMap((i) => ('text' in i ? [i.text] : [])), (node.prompt ?? '').trim()].filter(Boolean).join('\n\n');
  const pictures = inputs.flatMap((i) => ('media' in i && i.media === 'image' ? [i.path] : []));
  const clips = inputs.flatMap((i) => ('media' in i && i.media === 'video' ? [i.path] : []));
  const sounds = inputs.flatMap((i) => ('media' in i && i.media === 'audio' ? [i.path] : []));
  /* as `openfilm get` is given them: words, as on its command line */
  const opts = node.opts ?? {};
  /* a voice-over: its words spoken in its voice; nothing wired in but words is used */
  if (node.make === 'tts') return { verb: 'tts', args: { out: name, text: words, voice: opts.voice ?? '' }, unused: pictures.length + clips.length + sounds.length };
  const args: Record<string, string | string[]> = { out: name, prompt: words };
  const seconds = lengthOf(node.make, opts.sec, spec);
  let used = 0;
  if (node.make === 'image') {
    args.ratio = ratioOf(opts.ratio, spec);
    if (opts.quality && spec?.qualities?.includes(opts.quality)) args.quality = opts.quality;
    if (opts.size && spec?.sizes?.includes(opts.size)) args.size = opts.size;
    if (opts.transparent && spec?.transparent) args.transparent = 'true';
    /* a GIF (its frames, each so long) or an SVG, as the model makes them */
    if (opts.format && spec?.formats?.includes(opts.format)) {
      args.format = opts.format;
      if (opts.format === 'gif') { args.frames = String(opts.gifFrames ?? GIF_FRAMES); args['frame-ms'] = String(opts.frameMs ?? GIF_FRAME_MS); }
    }
    const refs = pictures.slice(0, spec?.refs ?? pictures.length);
    if (refs.length) { args.ref = refs; used = refs.length; }
    /* the first picture wired in redrawn where the mask leaves it clear, or where the changes are drawn on it */
    if (refs.length && opts.mask && spec?.mask && args.format !== 'gif' && args.format !== 'svg') args.mask = opts.mask;
    else if (refs.length && opts.markup && spec?.markup && args.format !== 'svg') args.markup = opts.markup;
  }
  if (node.make === 'video') {
    const fromClip = spec?.needs === 'clip';
    if (fromClip && clips[0]) { args.video = clips[0]; used += 1; }
    else if (spec?.needs === 'audio' && sounds[0]) { args.audio = sounds[0]; used += 1; }
    /* a clip made from a clip or a recording is as long as it */
    if (seconds !== null && !used) args.duration = String(seconds);
    if (opts.ratio && !spec?.needs) args['aspect-ratio'] = ratioOf(opts.ratio, spec);
    if (opts.size && spec?.sizes?.includes(opts.size)) args.resolution = opts.size;
    if (spec?.needs) {
      /* a person speaking a recording: from a picture of them */
      if (spec.needs === 'audio' && pictures[0]) { args['first-frame'] = pictures[0]; used += 1; }
      else if (spec.refs && pictures.length) { const refs = pictures.slice(0, spec.refs); args['input-reference'] = refs; used += refs.length; }
    } else {
      const mode = modeOf(opts, spec, pictures.length);
      const refs = pictures.slice(0, spec?.refs ?? pictures.length);
      if ((mode === 'first' || mode === 'firstLast') && pictures[0]) {
        args['first-frame'] = pictures[0];
        used += 1;
        if (mode === 'firstLast' && pictures[1]) { args['last-frame'] = pictures[1]; used += 1; }
      } else if ((mode === 'refs' || mode === 'omni') && refs.length) { args['input-reference'] = refs; used += refs.length; }
      if (mode === 'omni') {
        if (spec?.voice && sounds[0]) { args.voice = sounds[0]; used += 1; }
        if (spec?.clip && clips[0]) { args.video = clips[0]; used += 1; }
      }
    }
  } else if (seconds !== null) args.sec = String(seconds);
  return { verb: node.make, args, unused: pictures.length + clips.length + sounds.length - used };
}

/** when the last name was given: the next is later, so nodes made in the same moment never share a file */
let lastNamed = 0;

/** A name for what a node makes next: from its words (or its preset's name), and when, so no two are the same. */
export function makeName(node: CanvasNode & { make: MakeKind }, now = Date.now()): string {
  const words = (node.prompt ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 4);
  const preset = (node.preset ?? '').replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();
  lastNamed = Math.max(now, lastNamed + 1);
  return `${words.length ? words.join('-') : preset || node.make}-${lastNamed.toString(36)}`;
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
