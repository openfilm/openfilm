/**
 * The project's canvas: a board beside the edit, where the project's media is laid out, notes are
 * written beside it, things are gathered in groups and what leads to what is drawn as a wire. Nothing on it is in the
 * film until it is added to the timeline (a node's toolbar or menu). Kept in `.film/canvas.json` (lib/canvas,
 * studio/server/canvas.mjs), written a moment after each change.
 *
 * A node can make a picture, a clip or a sound with the person's own services (`openfilm get`, as their agent does):
 * what it is asked is its words and what is wired into it, in the wires' order (the notes' words first, pictures as a
 * clip's references or its first and last frames). Each time it makes one, that is a new file in assets/ and a new
 * version of the node; when what goes into it changes, it says so. Being made goes on with the board closed.
 *
 * Two fingers pan, a pinch zooms, a drag on the board selects (the middle
 * or right button pans); a double click on the board, `/`, or a wire let go on it opens the menu of what to add there
 * (a note, a file of the project), joined to that wire. Files come in from the Assets and from the computer too. ⌘Z
 * and ⇧⌘Z undo and redo, ⌘C ⌘V ⌘D copy, paste and duplicate, ⌘A selects all, ⌘G and ⇧⌘G group and ungroup, Delete
 * removes; a right click has the same in its menus. Far out a node is only its outline, and a video plays only under
 * the pointer: a board of hundreds stays light. The board is React Flow (@xyflow/react): its nodes are ours.
 *
 * Its keys are its own: Studio's shortcuts leave them alone (`data-studio-canvas`, typing-target.ts).
 */
import React from 'react';
import {
  Background, BackgroundVariant, Controls, Handle, MiniMap, NodeResizer, NodeToolbar, Position, ReactFlow, ReactFlowProvider,
  SelectionMode, useEdgesState, useNodesState, useReactFlow, useStore,
  type Connection, type Edge, type FinalConnectionState, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  AudioLines, Bot, ChevronLeft, LayoutTemplate, Play, X, ChevronRight, Clapperboard, FileQuestion, Image as ImageIcon, Loader2, Music, Plus, Search, Sparkles, Square,
  StickyNote, Trash2, Video,
} from 'lucide-react';
import { useT } from '@/i18n';
import { api, projectEvents } from '@/api';
import {
  FILE_W, GROUP_COLORS, IMAGE_RATIOS, MAKE_KINDS, MAKE_MEDIA, MAKE_SECONDS, MAKE_W, NOTE_H, NOTE_W, VIDEO_RATIOS, canvasId, canvasKey, copyOf,
  emptyHistory, inputsKey, inputsOf, isStale, makeName, makeRequest, nextOrder, readCanvasDoc, redo, remember, reorder, undo, withVersion,
  type CanvasDoc, type CanvasHistory, type CanvasNode, type GroupColor, type MakeKind, type MediaOf,
} from '@/lib/canvas';
import { useProviders, type ProvidersState } from '@/lib/providers';
import { builtInTemplates, type CanvasTemplate } from '@/lib/canvas-templates';
import { RESOURCE_DRAG_TYPE, isComputerFileDrag, readResourceDragData } from '@/lib/resource-drag';
import type { MediaSources, WorkspaceResource } from '@/lib/workspace-resources';
import type { StudioRef } from '@/lib/host';
import { useThemeChanges } from '@/lib/theme-changes';
import { ContextMenu, type ContextMenuEntry } from '../ContextMenu';
import { Tooltip } from '../Tooltip';

/** how long after the last change the board is written */
const SAVE_AFTER_MS = 600;
/** below this zoom a node is only its outline (its picture, its words are not drawn) */
const FAR = 0.35;
/** a group's room around what is in it, and above it for its name */
const GROUP_PAD = 32;
const GROUP_HEAD = 40;
/** how far a paste lands from what was copied, each time again */
const PASTE_STEP = 32;
/** what the add menu lists of the project's files, at most */
const MENU_FILES = 8;

const MOD = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';
const SHIFT = MOD === '⌘' ? '⇧⌘' : 'Ctrl+Shift+';

type FileData = { path: string; by?: CanvasNode['by'] };
type NoteData = { text: string; by?: CanvasNode['by'] };
type FrameData = { label: string; color: GroupColor };
type MakeData = Pick<CanvasNode, 'prompt' | 'via' | 'model' | 'opts' | 'versions' | 'path' | 'made' | 'by'> & { make: MakeKind };
type FileNode = Node<FileData, 'file'>;
type NoteNode = Node<NoteData, 'note'>;
type FrameNode = Node<FrameData, 'frame'>;
type MakeNode = Node<MakeData, 'make'>;
type BoardNode = FileNode | NoteNode | FrameNode | MakeNode;
type MakingNode = CanvasNode & { make: MakeKind };

/** a service and model a node can make its kind with (via, model: as `get` names them) */
interface Choice { via: string; model?: string; name: string }

/** What the person's connected services can make a kind with, each model of each. */
function choicesFor(state: ProvidersState | null, kind: MakeKind): Choice[] {
  return (state?.providers ?? []).filter((p) => p.source && p.verbs.includes(kind)).flatMap((p) => {
    const models = p.models[kind] ?? [];
    return models.length ? models.map((m) => ({ via: p.id, model: m.id, name: m.name })) : [{ via: p.id, name: p.name }];
  });
}
/** What a kind is made with when the node names none: the person's choice in Settings, else the first connected. */
function defaultChoice(state: ProvidersState | null, kind: MakeKind): Choice | null {
  const choices = choicesFor(state, kind);
  const via = state?.use[kind];
  const model = state?.model[kind];
  return choices.find((c) => c.via === via && (!model || c.model === model)) ?? choices.find((c) => c.via === via) ?? choices[0] ?? null;
}

/* ── what is being made: held beyond the board, so closing the canvas neither stops a clip being made nor loses it ── */

interface Run { started: number; abort: AbortController }
type Made = { path: string; made: string };
/** by `project/node` */
const runs = new Map<string, Run>();
const runErrors = new Map<string, string>();
/** the board shown for each project, to take what was made */
const shownBoards = new Map<string, (node: string, made: Made) => void>();
let runsVersion = 0;
const runWatchers = new Set<() => void>();
const runsChanged = () => { runsVersion += 1; for (const watch of runWatchers) watch(); };
const useRuns = () => React.useSyncExternalStore((watch) => { runWatchers.add(watch); return () => { runWatchers.delete(watch); }; }, () => runsVersion);

/** Whether it made one (false: it failed, was stopped, or was being made already). */
async function startRun(project: string, folder: string, node: string, request: ReturnType<typeof makeRequest>, pick: { via?: string; model?: string }, key: string, nothing: string): Promise<boolean> {
  const id = `${project}/${node}`;
  if (runs.has(id)) return false;
  const abort = new AbortController();
  runs.set(id, { started: Date.now(), abort });
  runErrors.delete(id);
  runsChanged();
  try {
    const receipt = JSON.parse(await api.make(folder, request.verb, request.args, pick, abort.signal)) as { src?: string; images?: Array<{ src?: string }> };
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

/** A group's frame and its name's chip, by its color. */
const FRAME_COLOR: Record<GroupColor, { line: string; fill: string; chip: string }> = {
  gray: { line: 'rgba(160,160,160,0.45)', fill: 'rgba(160,160,160,0.06)', chip: 'rgb(110,110,110)' },
  red: { line: 'rgba(239,68,68,0.5)', fill: 'rgba(239,68,68,0.07)', chip: 'rgb(185,48,48)' },
  orange: { line: 'rgba(249,115,22,0.5)', fill: 'rgba(249,115,22,0.07)', chip: 'rgb(194,88,20)' },
  yellow: { line: 'rgba(234,179,8,0.5)', fill: 'rgba(234,179,8,0.07)', chip: 'rgb(161,123,8)' },
  green: { line: 'rgba(34,197,94,0.5)', fill: 'rgba(34,197,94,0.07)', chip: 'rgb(28,140,70)' },
  blue: { line: 'rgba(59,130,246,0.5)', fill: 'rgba(59,130,246,0.07)', chip: 'rgb(45,100,200)' },
  purple: { line: 'rgba(168,85,247,0.5)', fill: 'rgba(168,85,247,0.07)', chip: 'rgb(126,62,190)' },
};

/** What the nodes need of the page around them: the project's files, how to show one, and what to do with them. */
interface Board {
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
  /** making: with what, whether it is at it or failed, what changed since, what it cannot use */
  choices: (kind: MakeKind) => Choice[];
  fallback: (kind: MakeKind) => Choice | null;
  run: (id: string) => Run | undefined;
  error: (id: string) => string | undefined;
  stale: ReadonlySet<string>;
  unused: ReadonlyMap<string, number>;
  make: (id: string) => void;
  stop: (id: string) => void;
  /** a group: whether it has nodes that make something, whether one is at it, and all of them made in order */
  makesIn: (group: string) => number;
  busyIn: (group: string) => boolean;
  makeAll: (group: string) => void;
  openSettings: () => void;
}
const BoardContext = React.createContext<Board | null>(null);

/** The board as React Flow draws it: groups before what is in them, as it needs them. */
function toFlow(doc: CanvasDoc): { nodes: BoardNode[]; edges: Edge[] } {
  const ordered = [...doc.nodes.filter((n) => n.group != null), ...doc.nodes.filter((n) => n.group == null)];
  return {
    nodes: ordered.map((n): BoardNode => {
      const base = { id: n.id, position: { x: n.x, y: n.y }, ...(n.parent ? { parentId: n.parent } : {}) };
      if (n.group != null) return { ...base, type: 'frame', width: n.w ?? 480, height: n.h ?? 320, zIndex: -1, data: { label: n.group, color: n.color ?? 'gray' } };
      if (n.make) {
        const { id: _id, x: _x, y: _y, w: _w, h: _h, parent: _parent, text: _text, group: _group, color: _color, ...data } = n;
        return { ...base, type: 'make', width: n.w ?? MAKE_W, data: { ...data, make: n.make } };
      }
      const by = n.by ? { by: n.by } : {};
      if (n.path != null) return { ...base, type: 'file', width: n.w ?? FILE_W, data: { path: n.path, ...by } };
      return { ...base, type: 'note', width: n.w ?? NOTE_W, height: n.h ?? NOTE_H, data: { text: n.text ?? '', ...by } };
    }),
    edges: doc.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, ...(e.order != null ? { data: { order: e.order } } : {}) })),
  };
}

function fromFlow(nodes: readonly BoardNode[], edges: readonly Edge[]): CanvasDoc {
  return {
    nodes: nodes.map((n) => {
      const box = { id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y), ...(n.parentId ? { parent: n.parentId } : {}) };
      const w = Math.round(n.width ?? n.measured?.width ?? (n.type === 'note' ? NOTE_W : n.type === 'make' ? MAKE_W : FILE_W));
      const h = () => Math.round(n.height ?? n.measured?.height ?? NOTE_H);
      const by = 'by' in n.data && n.data.by ? { by: n.data.by } : {};
      if (n.type === 'file') return { ...box, ...by, w, path: n.data.path };
      if (n.type === 'make') return { ...box, w, ...n.data };
      if (n.type === 'frame') return { id: n.id, x: box.x, y: box.y, w, h: h(), group: n.data.label, color: n.data.color };
      return { ...box, ...by, w, h: h(), text: n.data.text };
    }),
    edges: edges.map((e) => ({ id: e.id, from: e.source, to: e.target, ...(typeof e.data?.order === 'number' ? { order: e.data.order } : {}) })),
  };
}

/** A node's place on the board, whatever group it is in. */
function absolute(node: BoardNode, byId: ReadonlyMap<string, BoardNode>): { x: number; y: number } {
  const parent = node.parentId ? byId.get(node.parentId) : undefined;
  return parent ? { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y } : node.position;
}

const KIND_ICON = { video: Video, image: ImageIcon, audio: Music, mg: Clapperboard, other: FileQuestion } as const;
const HANDLE = '!h-2.5 !w-2.5 !border-2 !border-[var(--dock-pane)] !bg-[var(--text-faint)] opacity-0 transition group-hover:opacity-100';
const RESIZE_HANDLE = '!h-2 !w-2 !rounded-sm !border !border-[var(--text)] !bg-[var(--dock-pane)]';
const unselectEdges = (list: Edge[]) => (list.some((e) => e.selected) ? list.map((e) => (e.selected ? { ...e, selected: false } : e)) : list);
/** zoomed out past FAR: drawn as outlines */
const farSelector = (s: { transform: [number, number, number] }) => s.transform[2] < FAR;

/** Who put a node on the board, when an agent did. */
function ByAgent({ by }: { by: NonNullable<CanvasNode['by']> }) {
  const t = useT();
  return (
    <span className="pointer-events-auto ml-auto flex shrink-0 items-center gap-1" title={t('canvas.make.by').replace('{agent}', by.agent)}>
      <Bot size={11} />{by.agent}
    </span>
  );
}

/** A node's buttons over it while it is the one selected: add it to the timeline, remove it from the board. */
function NodeButtons({ id, file }: { id: string; file?: WorkspaceResource | null }) {
  const t = useT();
  const board = React.useContext(BoardContext)!;
  const btn = 'flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]';
  return (
    <NodeToolbar position={Position.Top} offset={30}>
      <div className="flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5 shadow-[0_4px_14px_rgba(0,0,0,0.18)]">
        {file && file.kind !== 'other' ? (
          <button type="button" className={btn} onClick={() => board.addToFilm(file)}>
            <Clapperboard size={13} />{t('canvas.addToFilm')}
          </button>
        ) : null}
        <Tooltip label={t('canvas.remove')}>
          <button type="button" aria-label={t('canvas.remove')} className={btn} onClick={() => board.remove([id])}><Trash2 size={13} /></button>
        </Tooltip>
      </div>
    </NodeToolbar>
  );
}

/**
 * A file of the project: its name above it, its picture. A video shows its poster and plays only under the pointer or
 * while selected; a sound has its player. Far out, only its outline.
 */
function FileNodeView({ id, data, selected }: NodeProps<FileNode>) {
  const t = useT();
  const board = React.useContext(BoardContext)!;
  const far = useStore(farSelector);
  const [over, setOver] = React.useState(false);
  const file = board.fileOf(data.path);
  const Icon = KIND_ICON[file?.kind ?? 'other'];
  const name = file?.name ?? data.path.split('/').pop() ?? data.path;
  const picture = (src: string | undefined) => <img src={src} alt="" draggable={false} className="block aspect-video w-full bg-black object-cover" />;
  return (
    <div className="group relative h-full w-full" onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}>
      <NodeButtons id={id} file={file} />
      <NodeResizer isVisible={selected} minWidth={120} keepAspectRatio={file?.kind !== 'audio'} lineClassName="!border-transparent"
        handleClassName={RESIZE_HANDLE} onResizeStart={board.willChange} />
      <div className="pointer-events-none absolute -top-5 left-0 right-0 flex items-center gap-1.5 truncate text-[11px] text-[var(--text-faint)]">
        <Icon size={11} className="shrink-0" /><span className="truncate">{name}</span>
        {data.by ? <ByAgent by={data.by} /> : null}
      </div>
      <div className={`overflow-hidden rounded-[10px] border bg-[var(--surface)] ${selected ? 'border-[var(--text)]' : 'border-[var(--border)]'}`}>
        {far ? (
          <div className="flex aspect-video w-full items-center justify-center bg-[var(--surface-2)] text-[var(--text-faint)]"><Icon size={28} /></div>
        ) : !file ? (
          <div className="flex aspect-video items-center justify-center gap-2 px-3 text-center text-[12px] text-[var(--text-faint)]">
            <FileQuestion size={14} className="shrink-0" />{t('canvas.missing')}
          </div>
        ) : file.kind === 'image' ? (
          <img src={board.sources.file(file)} alt="" draggable={false} loading="lazy" className="block w-full" />
        ) : file.kind === 'video' ? (
          over || selected ? (
            <video src={board.sources.file(file)} poster={board.sources.poster?.(file)} muted loop playsInline autoPlay className="block aspect-video w-full bg-black object-contain" />
          ) : picture(board.sources.poster?.(file))
        ) : file.kind === 'mg' ? (
          picture(board.sources.pagePoster?.(file))
        ) : file.kind === 'audio' ? (
          <div className="flex items-center gap-2 p-2.5">
            <Music size={16} className="shrink-0 text-[var(--text-faint)]" />
            <audio src={board.sources.file(file)} controls preload="none" className="nodrag h-8 min-w-0 flex-1" />
          </div>
        ) : (
          <div className="flex aspect-video items-center justify-center text-[var(--text-faint)]"><FileQuestion size={18} /></div>
        )}
      </div>
      <Handle type="target" position={Position.Left} className={HANDLE} />
      <Handle type="source" position={Position.Right} className={HANDLE} />
    </div>
  );
}

/**
 * A note: what was written on the board. It moves as any node does; a double click writes in it (a new one is written
 * at once), and clicking away is done.
 */
function NoteNodeView({ id, data, selected }: NodeProps<NoteNode>) {
  const t = useT();
  const board = React.useContext(BoardContext)!;
  const far = useStore(farSelector);
  const editing = board.editing === id;
  return (
    <div className="group relative h-full w-full" onDoubleClick={() => board.edit(id)}>
      <NodeButtons id={id} />
      <NodeResizer isVisible={selected} minWidth={140} minHeight={60} lineClassName="!border-transparent"
        handleClassName={RESIZE_HANDLE} onResizeStart={board.willChange} />
      <div className="pointer-events-none absolute -top-5 left-0 right-0 flex items-center gap-1.5 text-[11px] text-[var(--text-faint)]">
        <StickyNote size={11} />{t('canvas.note')}
        {data.by ? <ByAgent by={data.by} /> : null}
      </div>
      <div className={`flex h-full w-full overflow-hidden rounded-[10px] border bg-[var(--surface-2)] ${selected || editing ? 'border-[var(--text)]' : 'border-[var(--border)]'}`}>
        {editing ? (
          <textarea
            autoFocus
            /* written on where it ends */
            onFocus={(event) => { const end = event.currentTarget.value.length; event.currentTarget.setSelectionRange(end, end); }}
            value={data.text}
            onChange={(event) => board.setData(id, { text: event.target.value })}
            onBlur={() => board.edit(null)}
            onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.blur(); }}
            placeholder={t('canvas.notePlaceholder')}
            className="nodrag nowheel h-full w-full resize-none bg-transparent p-3 text-[13px] leading-relaxed text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          />
        ) : far ? null : (
          <div className={`h-full w-full whitespace-pre-wrap break-words p-3 text-[13px] leading-relaxed ${data.text ? 'text-[var(--text)]' : 'text-[var(--text-faint)]'}`}>
            {data.text || t('canvas.notePlaceholder')}
          </div>
        )}
      </div>
      <Handle type="target" position={Position.Left} className={HANDLE} />
      <Handle type="source" position={Position.Right} className={HANDLE} />
    </div>
  );
}

/** A group: a tinted frame round what is in it, its name in a chip above (a double click renames it). */
function FrameNodeView({ id, data, selected }: NodeProps<FrameNode>) {
  const t = useT();
  const board = React.useContext(BoardContext)!;
  const editing = board.editing === id;
  const paint = FRAME_COLOR[data.color];
  return (
    <div className="relative h-full w-full rounded-[14px] border-2" style={{ borderColor: selected ? 'var(--text)' : paint.line, background: paint.fill }}>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={120} lineClassName="!border-transparent"
        handleClassName={RESIZE_HANDLE} onResizeStart={board.willChange} />
      <div className="absolute left-0 -top-9 flex h-7 max-w-full items-center" onDoubleClick={(event) => { event.stopPropagation(); board.edit(id); }}>
        {editing ? (
          <input
            autoFocus
            defaultValue={data.label}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={(event) => { board.setData(id, { label: event.currentTarget.value.trim() || t('canvas.group') }); board.edit(null); }}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur(); }}
            className="nodrag h-7 w-[220px] rounded-md bg-[var(--surface)] px-2 text-[13px] font-medium text-[var(--text)] outline-none"
          />
        ) : (
          <span className="truncate rounded-md px-2.5 py-1 text-[13px] font-medium text-white" style={{ background: paint.chip }}>{data.label || t('canvas.group')}</span>
        )}
        {board.makesIn(id) && !editing ? (
          <Tooltip label={t('canvas.makeAllTip')}>
            <button type="button" disabled={board.busyIn(id)} onClick={() => board.makeAll(id)}
              className="nodrag ml-1.5 flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-white disabled:opacity-60" style={{ background: paint.chip }}>
              {board.busyIn(id) ? <Loader2 size={12} className="animate-spin" /> : <Play size={11} />}{t('canvas.makeAll')}
            </button>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

const MAKE_ICON = { image: ImageIcon, video: Video, sfx: AudioLines, music: Music } as const;
/** the lengths offered for each kind, in seconds */
const MAKE_LENGTHS: Partial<Record<MakeKind, number[]>> = { video: [4, 5, 6, 8, 10, 15], sfx: [1, 2, 3, 5, 10], music: [15, 30, 60, 120] };
const PICK = 'nodrag h-7 min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-1.5 text-[11.5px] text-[var(--text-muted)] outline-none hover:text-[var(--text)]';

/** How long it has been at it, counted each second. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => { const tick = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(tick); }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <span className="tabular-nums">{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}

/**
 * A node that makes something: above it what and with which model (and when what goes into it changed since, or an
 * agent put it there), what it made (its versions, one shown), its words, its options and Make. Being made, it says
 * how long it has been at it and can be stopped.
 */
function MakeNodeView({ id, data, selected }: NodeProps<MakeNode>) {
  const t = useT();
  const board = React.useContext(BoardContext)!;
  const far = useStore(farSelector);
  const [over, setOver] = React.useState(false);
  const run = board.run(id);
  const error = board.error(id);
  const Icon = MAKE_ICON[data.make];
  const media = MAKE_MEDIA[data.make];
  const choices = board.choices(data.make);
  const fallback = board.fallback(data.make);
  const picked = choices.find((c) => c.via === data.via && c.model === data.model);
  const versions = data.versions ?? [];
  const at = data.path ? versions.indexOf(data.path) : -1;
  const file = data.path ? board.fileOf(data.path) : null;
  const unused = board.unused.get(id) ?? 0;
  const lengths = MAKE_LENGTHS[data.make];
  const ratios = data.make === 'image' ? IMAGE_RATIOS : data.make === 'video' ? VIDEO_RATIOS : null;
  const ratio = data.opts?.ratio ?? (data.make === 'image' || data.make === 'video' ? '16:9' : undefined);
  const set = (patch: Partial<MakeData>) => { board.willChange(); board.setData(id, patch); };
  const setOpts = (patch: Partial<NonNullable<MakeData['opts']>>) => set({ opts: { ...data.opts, ...patch } });
  const show = (i: number) => { const path = versions[i]; if (path) set({ path }); };
  const [w, h] = (ratio ?? '16:9').split(':').map(Number) as [number, number];
  return (
    <div className="group relative h-full w-full" onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}>
      <NodeButtons id={id} file={file} />
      <NodeResizer isVisible={selected} minWidth={260} lineClassName="!border-transparent" handleClassName={RESIZE_HANDLE} onResizeStart={board.willChange} />
      <div className="pointer-events-none absolute -top-5 left-0 right-0 flex items-center gap-1.5 text-[11px] text-[var(--text-faint)]">
        <Icon size={11} className="shrink-0" />
        <span className="shrink-0">{t(`canvas.make.${data.make}`)}</span>
        {(picked ?? fallback) ? <span className="truncate">· {(picked ?? fallback)!.name}</span> : null}
        <span className="flex-1" />
        {board.stale.has(id) ? (
          <span className="pointer-events-auto shrink-0" title={t('canvas.make.staleTip')}>
            <span className="rounded px-1 text-[10.5px] font-medium text-amber-500">{t('canvas.make.stale')}</span>
          </span>
        ) : null}
        {data.by ? <ByAgent by={data.by} /> : null}
      </div>
      <div className={`overflow-hidden rounded-[10px] border bg-[var(--surface)] ${selected ? 'border-[var(--text)]' : 'border-[var(--border)]'}`}>
        <div className="relative w-full bg-[var(--surface-2)]" style={media === 'audio' ? undefined : { aspectRatio: `${w} / ${h}` }}>
          {far ? (
            <div className="flex h-full min-h-14 items-center justify-center text-[var(--text-faint)]"><Icon size={28} /></div>
          ) : file ? (
            media === 'image' ? <img src={board.sources.file(file)} alt="" draggable={false} className="block h-full w-full bg-black object-contain" />
            : media === 'video' ? (over || selected
              ? <video src={board.sources.file(file)} poster={board.sources.poster?.(file)} muted loop playsInline autoPlay className="block h-full w-full bg-black object-contain" />
              : <img src={board.sources.poster?.(file)} alt="" draggable={false} className="block h-full w-full bg-black object-contain" />)
            : <div className="flex items-center gap-2 p-2.5"><audio src={board.sources.file(file)} controls preload="none" className="nodrag h-8 min-w-0 flex-1" /></div>
          ) : (
            <div className={`flex h-full flex-col items-center justify-center gap-1.5 text-[12px] text-[var(--text-faint)] ${media === 'audio' ? 'h-14 flex-row' : ''}`}>
              <Icon size={media === 'audio' ? 15 : 22} />{data.path ? null : t('canvas.make.empty')}
            </div>
          )}
          {run ? (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/55 text-[12px] text-white">
              <Loader2 size={14} className="animate-spin" />{t('canvas.make.making')} <Elapsed since={run.started} />
            </div>
          ) : null}
          {versions.length > 1 && !far ? (
            <div className="nodrag absolute bottom-1.5 right-1.5 flex items-center rounded-md bg-black/60 text-[11px] text-white" title={t('canvas.make.version').replace('{n}', String(at + 1)).replace('{total}', String(versions.length))}>
              <button type="button" aria-label={t('canvas.make.earlier')} disabled={at <= 0} onClick={() => show(at - 1)} className="flex h-6 w-5 items-center justify-center disabled:opacity-35"><ChevronLeft size={12} /></button>
              <span className="tabular-nums">{at + 1}/{versions.length}</span>
              <button type="button" aria-label={t('canvas.make.later')} disabled={at >= versions.length - 1} onClick={() => show(at + 1)} className="flex h-6 w-5 items-center justify-center disabled:opacity-35"><ChevronRight size={12} /></button>
            </div>
          ) : null}
        </div>
        {far ? null : (
          <div className="nodrag nowheel flex cursor-default flex-col gap-1.5 border-t border-[var(--border)] p-2">
            <textarea
              value={data.prompt ?? ''}
              rows={3}
              onFocus={board.willChange}
              onChange={(event) => board.setData(id, { prompt: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Escape') event.currentTarget.blur();
                else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); board.make(id); }
              }}
              placeholder={t('canvas.make.prompt')}
              className="w-full resize-none rounded-md bg-transparent px-1 py-0.5 text-[12.5px] leading-relaxed text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
            />
            <div className="flex min-w-0 items-center gap-1">
              {choices.length > 1 ? (
                <select aria-label={t('canvas.make.model')} className={`${PICK} flex-1`} value={picked ? `${picked.via}|${picked.model ?? ''}` : ''}
                  onChange={(event) => {
                    const [via, model] = event.target.value.split('|');
                    set({ via: via || undefined, model: model || undefined });
                  }}>
                  <option value="">{t('canvas.make.default').replace('{name}', fallback?.name ?? '')}</option>
                  {choices.map((c) => <option key={`${c.via}|${c.model ?? ''}`} value={`${c.via}|${c.model ?? ''}`}>{c.name}</option>)}
                </select>
              ) : null}
              {ratios ? (
                <select aria-label={t('canvas.make.ratio')} className={PICK} value={ratio} onChange={(event) => setOpts({ ratio: event.target.value })}>
                  {ratios.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              ) : null}
              {lengths ? (
                <select aria-label={t('canvas.make.length')} className={PICK} value={data.opts?.sec ?? MAKE_SECONDS[data.make]!.default} onChange={(event) => setOpts({ sec: Number(event.target.value) })}>
                  {lengths.map((sec) => <option key={sec} value={sec}>{t('canvas.make.seconds').replace('{n}', String(sec))}</option>)}
                </select>
              ) : null}
              {data.make === 'video' ? (
                <Tooltip label={t('canvas.make.framesTip')}>
                  <button type="button" onClick={() => setOpts({ frames: !data.opts?.frames || undefined })}
                    className={`${PICK} whitespace-nowrap ${data.opts?.frames ? '!text-[var(--text)]' : ''}`}>
                    {data.opts?.frames ? t('canvas.make.frames') : t('canvas.make.refs')}
                  </button>
                </Tooltip>
              ) : null}
              {choices.length > 1 ? null : <span className="flex-1" />}
              {run ? (
                <button type="button" onClick={() => board.stop(id)}
                  className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[12px] text-[var(--text)] hover:bg-[var(--bg-hover)]">
                  <Square size={11} />{t('canvas.make.stop')}
                </button>
              ) : (
                <Tooltip label={`${t('canvas.make.run')} · ${MOD}↵`}>
                  <button type="button" disabled={!choices.length} onClick={() => board.make(id)}
                    className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-[var(--text)] px-2.5 text-[12px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:opacity-35">
                    <Sparkles size={12} />{versions.length ? t('canvas.make.again') : t('canvas.make.run')}
                  </button>
                </Tooltip>
              )}
            </div>
            {choices.length ? null : (
              <button type="button" onClick={board.openSettings} className="text-left text-[11.5px] text-[var(--text-faint)] underline-offset-2 hover:text-[var(--text)] hover:underline">
                {t('canvas.make.noService')}
              </button>
            )}
            {unused ? <div className="text-[11.5px] text-[var(--text-faint)]">{t('canvas.make.unused').replace('{n}', String(unused))}</div> : null}
            {error ? <div className="select-text text-[11.5px] leading-snug text-red-500">{error}</div> : null}
          </div>
        )}
      </div>
      <Handle type="target" position={Position.Left} className={HANDLE} />
      <Handle type="source" position={Position.Right} className={HANDLE} />
    </div>
  );
}

const NODE_TYPES = { file: FileNodeView, note: NoteNodeView, frame: FrameNodeView, make: MakeNodeView };

/** where the add menu opens: on the screen, on the board, and the wire it joins (a node's side let go on the board) */
interface MenuAt { screen: { x: number; y: number }; at: { x: number; y: number }; from?: { node: string; side: 'source' | 'target' } }

/** The menu of what to add where it opened: a note, or a file of the project, searched; Enter takes the first. */
function AddMenu({ menu, files, templates, onNote, onMake, onTemplate, onRemoveTemplate, onFile, onClose }: {
  menu: MenuAt;
  files: readonly WorkspaceResource[];
  templates: readonly CanvasTemplate[];
  onNote: () => void;
  onMake: (kind: MakeKind) => void;
  onTemplate: (template: CanvasTemplate) => void;
  onRemoveTemplate: (template: CanvasTemplate) => void;
  onFile: (file: WorkspaceResource) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const needle = query.trim().toLowerCase();
  const shown = files.filter((f) => f.kind !== 'other' && (!needle || f.name.toLowerCase().includes(needle) || f.path.toLowerCase().includes(needle))).slice(0, MENU_FILES);
  const items: Array<{ key: string; label: string; icon: React.ReactNode; run: () => void; remove?: () => void }> = [
    ...(!needle || t('canvas.note').toLowerCase().includes(needle) ? [{ key: 'note', label: t('canvas.note'), icon: <StickyNote size={14} />, run: onNote }] : []),
    ...MAKE_KINDS.filter((k) => !needle || t(`canvas.make.${k}`).toLowerCase().includes(needle)).map((k) => {
      const Icon = MAKE_ICON[k];
      return { key: `make:${k}`, label: t(`canvas.make.${k}`), icon: <Icon size={14} />, run: () => onMake(k) };
    }),
    /* laid down where wires do not lead: a template has its own */
    ...(menu.from ? [] : templates.filter((tp) => !needle || tp.name.toLowerCase().includes(needle)).map((tp) => ({
      key: `template:${tp.id}`, label: tp.name, icon: <LayoutTemplate size={14} />, run: () => onTemplate(tp),
      ...(tp.builtIn ? {} : { remove: () => onRemoveTemplate(tp) }),
    }))),
    ...shown.map((f) => {
      const Icon = KIND_ICON[f.kind];
      return { key: f.path, label: f.name, icon: <Icon size={14} />, run: () => onFile(f) };
    }),
  ];
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const away = (event: PointerEvent) => { if (!ref.current?.contains(event.target as globalThis.Node)) onClose(); };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [onClose]);
  return (
    <div ref={ref} className="fixed z-[200] w-[280px] overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--panel)] p-1 shadow-[var(--shadow-lg)]"
      style={{ left: menu.screen.x, top: menu.screen.y }}>
      <label className="flex h-8 items-center gap-2 px-2 text-[13px]">
        <Search size={13} className="shrink-0 text-[var(--text-faint)]" />
        <input
          autoFocus
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActive(0); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            else if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(items.length - 1, i + 1)); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
            else if (event.key === 'Enter') items[active]?.run();
          }}
          placeholder={t('canvas.search')}
          className="min-w-0 flex-1 bg-transparent text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
        />
      </label>
      <div className="max-h-[300px] overflow-y-auto">
        {items.map((item, i) => (
          <button key={item.key} type="button" onMouseEnter={() => setActive(i)} onClick={item.run}
            className={`flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-[13px] ${i === active ? 'bg-[var(--bg-hover)] text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
            <span className="shrink-0 text-[var(--text-faint)]">{item.icon}</span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.remove && i === active ? (
              <span role="button" tabIndex={-1} aria-label={t('canvas.removeTemplate')} title={t('canvas.removeTemplate')}
                onClick={(event) => { event.stopPropagation(); item.remove!(); }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
                <X size={12} />
              </span>
            ) : null}
          </button>
        ))}
        {items.length ? null : <div className="flex h-8 items-center px-2 text-[12.5px] text-[var(--text-faint)]">{t('canvas.nothing')}</div>}
      </div>
    </div>
  );
}

/** what was copied last, on any board of this page: pasted with new ids, a step further each time */
let clipboard: { doc: CanvasDoc; pasted: number } | null = null;

function Board({ projectId, folder, files, sources, onAddToFilm, onImportFiles, onOpenSettings, onError, onNotice, focus, onRefer }: CanvasViewProps) {
  const t = useT();
  const flow = useReactFlow<BoardNode, Edge>();
  const [nodes, setNodes, onNodesChange] = useNodesState<BoardNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [ready, setReady] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [menu, setMenu] = React.useState<MenuAt | null>(null);
  const [context, setContext] = React.useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  const saved = React.useRef('');
  const rootRef = React.useRef<HTMLDivElement>(null);
  const themeChanges = useThemeChanges();
  const dark = React.useMemo(() => document.documentElement.dataset.theme === 'dark', [themeChanges]); // eslint-disable-line react-hooks/exhaustive-deps

  /* the board now, for what is done from handlers made in an earlier render */
  const now = React.useRef({ nodes, edges });
  now.current = { nodes, edges };
  const docNow = () => fromFlow(now.current.nodes, now.current.edges);
  const show = (doc: CanvasDoc, select?: ReadonlySet<string>) => {
    const next = toFlow(doc);
    setNodes(next.nodes.map((n) => ({ ...n, selected: select?.has(n.id) ?? false })));
    setEdges(next.edges);
  };

  /* ── undo and redo: the board before each change ── */
  const history = React.useRef<CanvasHistory>(emptyHistory());
  const willChange = React.useCallback(() => { history.current = remember(history.current, docNow()); }, []);
  const step = (back: boolean) => {
    const moved = (back ? undo : redo)(history.current, docNow());
    if (!moved) return;
    history.current = moved.history;
    show(moved.doc);
  };

  /* read once; shown fitted to the view */
  React.useEffect(() => {
    let live = true;
    void api.canvas(projectId).then((raw) => {
      if (!live) return;
      const doc = readCanvasDoc(raw);
      saved.current = canvasKey(doc);
      history.current = emptyHistory();
      show(doc);
      setReady(true);
      requestAnimationFrame(() => { void flow.fitView({ padding: 0.2, maxZoom: 1 }); });
    }, (e: unknown) => { if (live) { setReady(true); onError(t('canvas.saveFailed').replace('{error}', e instanceof Error ? e.message : String(e))); } });
    return () => { live = false; };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* what an agent changed (`openfilm canvas apply`) comes onto the board at once, and ⌘Z takes it back as any change */
  React.useEffect(() => projectEvents(projectId, (event) => {
    if (event.type !== 'canvas') return;
    void api.canvas(projectId).then((raw) => {
      const doc = readCanvasDoc(raw);
      const key = canvasKey(doc);
      saved.current = key;
      if (key === canvasKey(docNow())) return;
      willChange();
      show(doc, selectedIds());
    }, () => {});
  }), [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* written a moment after the last change that says something new (a selection says nothing) */
  React.useEffect(() => {
    if (!ready) return undefined;
    const doc = fromFlow(nodes, edges);
    const key = canvasKey(doc);
    if (key === saved.current) return undefined;
    const write = setTimeout(() => {
      void api.putCanvas(projectId, doc).then(() => { saved.current = key; },
        (e: unknown) => onError(t('canvas.saveFailed').replace('{error}', e instanceof Error ? e.message : String(e))));
    }, SAVE_AFTER_MS);
    return () => clearTimeout(write);
  }, [nodes, edges, ready, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── what can be done to the board ── */
  const selectedIds = () => new Set(now.current.nodes.filter((n) => n.selected).map((n) => n.id));
  /** these nodes gone, what was in a group gone with it, and every wire to them */
  const remove = (ids: string[]) => {
    const gone = new Set(ids);
    for (const n of now.current.nodes) if (n.parentId && gone.has(n.parentId)) gone.add(n.id);
    const edgesGone = new Set(now.current.edges.filter((e) => e.selected).map((e) => e.id));
    if (!gone.size && !edgesGone.size) return;
    willChange();
    setNodes((list) => list.filter((n) => !gone.has(n.id)));
    setEdges((list) => list.filter((e) => !gone.has(e.source) && !gone.has(e.target) && !edgesGone.has(e.id)));
  };
  const removeSelected = () => remove([...selectedIds()]);
  const add = (doc: CanvasDoc) => {
    willChange();
    const current = docNow();
    /* a copy out of a group that is gone since lands on the board itself */
    const groups = new Set([...current.nodes, ...doc.nodes].filter((n) => n.group != null).map((n) => n.id));
    const nodes = doc.nodes.map((n) => (n.parent && !groups.has(n.parent) ? (({ parent: _parent, ...rest }) => rest)(n) : n));
    show({ nodes: [...current.nodes, ...nodes], edges: [...current.edges, ...doc.edges] }, new Set(nodes.map((n) => n.id)));
  };
  const copy = () => {
    const ids = selectedIds();
    if (!ids.size) return false;
    const doc = docNow();
    clipboard = { doc: copyOf(doc, ids, { x: 0, y: 0 }), pasted: 0 };
    return true;
  };
  const paste = () => {
    if (!clipboard) return;
    clipboard.pasted += 1;
    const d = PASTE_STEP * clipboard.pasted;
    add(copyOf(clipboard.doc, new Set(clipboard.doc.nodes.filter((n) => !n.parent || !clipboard!.doc.nodes.some((g) => g.id === n.parent)).map((n) => n.id)), { x: d, y: d }));
  };
  const duplicate = () => {
    const ids = selectedIds();
    if (!ids.size) return;
    add(copyOf(docNow(), ids, { x: PASTE_STEP, y: PASTE_STEP }));
  };
  /** the selected nodes not in a group, in a new group round them */
  const group = () => {
    const byId = new Map(now.current.nodes.map((n) => [n.id, n]));
    const picked = now.current.nodes.filter((n) => n.selected && !n.parentId && n.type !== 'frame');
    if (!picked.length) return;
    willChange();
    const box = picked.reduce((b, n) => {
      const at = absolute(n, byId);
      const w = n.measured?.width ?? n.width ?? FILE_W;
      const h = n.measured?.height ?? n.height ?? NOTE_H;
      return { x0: Math.min(b.x0, at.x), y0: Math.min(b.y0, at.y), x1: Math.max(b.x1, at.x + w), y1: Math.max(b.y1, at.y + h) };
    }, { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    const id = canvasId('n');
    const origin = { x: box.x0 - GROUP_PAD, y: box.y0 - GROUP_PAD - GROUP_HEAD / 2 };
    const frame: FrameNode = {
      id, type: 'frame', position: origin, zIndex: -1, selected: true,
      width: box.x1 - box.x0 + 2 * GROUP_PAD, height: box.y1 - box.y0 + 2 * GROUP_PAD + GROUP_HEAD / 2,
      data: { label: t('canvas.group'), color: GROUP_COLORS[(now.current.nodes.filter((n) => n.type === 'frame').length + 5) % GROUP_COLORS.length]! },
    };
    const inIt = new Set(picked.map((n) => n.id));
    setEdges(unselectEdges);
    setNodes((list) => [frame, ...list.map((n) => (inIt.has(n.id)
      ? { ...n, selected: false, parentId: id, position: { x: n.position.x - origin.x, y: n.position.y - origin.y } }
      : { ...n, selected: false }))] as BoardNode[]);
  };
  /** the selected groups gone, what was in them left where it is */
  const ungroup = () => {
    const frames = now.current.nodes.filter((n) => n.selected && n.type === 'frame');
    if (!frames.length) return;
    willChange();
    const at = new Map(frames.map((f) => [f.id, f.position]));
    setNodes((list) => list.filter((n) => !at.has(n.id)).map((n) => {
      const origin = n.parentId ? at.get(n.parentId) : undefined;
      if (!origin) return n;
      const { parentId: _parentId, ...rest } = n;
      return { ...rest, position: { x: n.position.x + origin.x, y: n.position.y + origin.y } } as BoardNode;
    }));
  };
  const selectAll = () => setNodes((list) => list.map((n) => ({ ...n, selected: true })));

  const byPath = React.useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const mediaOf = React.useCallback<MediaOf>((path) => {
    const kind = byPath.get(path)?.kind;
    return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : null;
  }, [byPath]);

  /* ── making ── */
  const providers = useProviders().state;
  const runsSeen = useRuns();
  /** what changed since each making node last made one, and what is wired into it that it cannot use */
  const making = React.useMemo(() => {
    const stale = new Set<string>();
    const unused = new Map<string, number>();
    if (!nodes.some((n) => n.type === 'make')) return { stale, unused };
    const doc = fromFlow(nodes, edges);
    for (const n of doc.nodes) {
      if (!n.make) continue;
      const inputs = inputsOf(doc, n.id, mediaOf);
      if (isStale(n, inputs)) stale.add(n.id);
      const left = makeRequest(n as MakingNode, inputs, '').unused;
      if (left) unused.set(n.id, left);
    }
    return { stale, unused };
  }, [nodes, edges, mediaOf]);
  const makeNow = (id: string): Promise<boolean> => {
    const doc = docNow();
    const node = doc.nodes.find((n) => n.id === id);
    if (!node?.make || !folder) return Promise.resolve(false);
    const inputs = inputsOf(doc, id, mediaOf);
    const request = makeRequest(node as MakingNode, inputs, makeName(node as MakingNode));
    if (!String(request.args.prompt).trim()) { runErrors.set(`${projectId}/${id}`, t('canvas.make.noWords')); runsChanged(); return Promise.resolve(false); }
    const pick = node.via ? { via: node.via, ...(node.model ? { model: node.model } : {}) } : {};
    return startRun(projectId, folder, id, request, pick, inputsKey(node, inputs), t('canvas.make.nothing'));
  };
  /**
   * Everything a group makes, in the order its wires say: what feeds another is made first, and what waits for it is
   * made after it, with it. What is made already and has not changed since is left (and so is what only it feeds); what
   * failed stops what it feeds.
   */
  const makeAll = async (group: string) => {
    const start = docNow();
    const members = start.nodes.filter((n) => n.parent === group && n.make).map((n) => n.id);
    const inGroup = new Set(members);
    const feeds = new Map(members.map((id) => [id, start.edges.filter((e) => e.to === id && inGroup.has(e.from)).map((e) => e.from)]));
    const need = new Set(members.filter((id) => {
      const n = start.nodes.find((m) => m.id === id)!;
      return !n.path || isStale(n, inputsOf(start, id, mediaOf));
    }));
    for (let grew = true; grew;) {
      grew = false;
      for (const id of members) if (!need.has(id) && feeds.get(id)!.some((f) => need.has(f))) { need.add(id); grew = true; }
    }
    if (!need.size) { onNotice(t('canvas.upToDate')); return; }
    const done = new Set(members.filter((id) => !need.has(id)));
    const failed = new Set<string>();
    for (;;) {
      const ready = [...need].filter((id) => !done.has(id) && !failed.has(id) && feeds.get(id)!.every((f) => done.has(f)));
      if (!ready.length) break;
      await Promise.all(ready.map(async (id) => { (await makeNow(id) ? done : failed).add(id); }));
      /* what was made is on the board before what it feeds is asked */
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    }
  };

  /* ── templates: the person's own, and OpenFilm's ── */
  const [ownTemplates, setOwnTemplates] = React.useState<CanvasTemplate[]>([]);
  const loadTemplates = () => { void api.canvasTemplates().then(setOwnTemplates, () => {}); };
  React.useEffect(loadTemplates, []);
  const builtIns = React.useMemo(() => builtInTemplates((key) => t(`canvas.templates.${key}`)), [t]);
  const templates = React.useMemo(() => [...ownTemplates, ...builtIns], [ownTemplates, builtIns]);
  /** a template laid down with its corner at `at`: every node new */
  const layTemplate = async (template: CanvasTemplate, at: { x: number; y: number }) => {
    try {
      const doc = template.builtIn ? builtIns.find((b) => b.id === template.id)!.doc : readCanvasDoc(await api.useCanvasTemplate(projectId, template.id));
      add(copyOf(doc, new Set(doc.nodes.filter((n) => !n.parent).map((n) => n.id)), at));
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  /** a group kept as a template, by its name, with what is in it and the wires between them */
  const keepTemplate = async (group: string) => {
    const doc = docNow();
    const node = doc.nodes.find((n) => n.id === group);
    if (!node) return;
    const part = copyOf(doc, new Set([group]), { x: 0, y: 0 });
    try {
      const kept = await api.saveCanvasTemplate(projectId, node.group || t('canvas.group'), part);
      onNotice(t('canvas.templateKept').replace('{name}', kept.name));
      loadTemplates();
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  const removeTemplate = async (template: CanvasTemplate) => {
    setOwnTemplates((list) => list.filter((tp) => tp.id !== template.id));
    await api.removeCanvasTemplate(template.id).catch((e: unknown) => { onError(e instanceof Error ? e.message : String(e)); loadTemplates(); });
  };
  /* what is made while this board is shown comes onto it (and can be undone, as any change) */
  React.useEffect(() => {
    shownBoards.set(projectId, (id, made) => {
      willChange();
      setNodes((list) => list.map((n) => (n.id === id && n.type === 'make' ? { ...n, data: withVersion(n.data, made) } : n)));
    });
    return () => { shownBoards.delete(projectId); };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const board = React.useMemo<Board>(() => ({
    fileOf: (path) => byPath.get(path) ?? null,
    sources,
    addToFilm: onAddToFilm,
    setData: (id, data) => setNodes((list) => list.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } as BoardNode : n))),
    remove,
    willChange,
    editing,
    edit: (id) => { if (id) willChange(); setEditing(id); },
    choices: (kind) => choicesFor(providers, kind),
    fallback: (kind) => defaultChoice(providers, kind),
    run: (id) => runs.get(`${projectId}/${id}`),
    error: (id) => runErrors.get(`${projectId}/${id}`),
    stale: making.stale,
    unused: making.unused,
    make: makeNow,
    stop: (id) => runs.get(`${projectId}/${id}`)?.abort.abort(),
    makesIn: (group) => nodes.filter((n) => n.parentId === group && n.type === 'make').length,
    busyIn: (group) => nodes.some((n) => n.parentId === group && runs.has(`${projectId}/${n.id}`)),
    makeAll: (group) => { void makeAll(group); },
    openSettings: onOpenSettings,
  }), [byPath, sources, onAddToFilm, setNodes, editing, providers, runsSeen, making, projectId, folder, onOpenSettings, nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── adding: a note, a file, joined to the wire it came from ── */
  const place = (node: BoardNode, from?: MenuAt['from']) => {
    willChange();
    setNodes((list) => [...list.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]);
    setEdges(unselectEdges);
    if (from) {
      const [source, target] = from.side === 'source' ? [from.node, node.id] : [node.id, from.node];
      setEdges((list) => [...list, { id: canvasId('e'), source, target, data: { order: nextOrder(docNow(), target) } }]);
    }
  };
  const addMake = (make: MakeKind, at: { x: number; y: number }, from?: MenuAt['from']) => {
    place({ id: canvasId('n'), type: 'make', position: { x: at.x - (from ? 0 : MAKE_W / 2), y: at.y - 100 }, width: MAKE_W, data: { make, prompt: '' } }, from);
  };
  const addNote = (at: { x: number; y: number }, from?: MenuAt['from']) => {
    const id = canvasId('n');
    place({ id, type: 'note', position: { x: at.x - (from ? 0 : NOTE_W / 2), y: at.y - NOTE_H / 2 }, width: NOTE_W, height: NOTE_H, data: { text: '' } }, from);
    /* written in at once, as a note on paper */
    setEditing(id);
  };
  const addFile = (path: string, at: { x: number; y: number }, from?: MenuAt['from']) => {
    place({ id: canvasId('n'), type: 'file', position: { x: at.x - (from ? 0 : FILE_W / 2), y: at.y - 80 }, width: FILE_W, data: { path } }, from);
  };
  const openMenu = (clientX: number, clientY: number, from?: MenuAt['from']) => {
    setContext(null);
    setMenu({ screen: { x: clientX, y: clientY }, at: flow.screenToFlowPosition({ x: clientX, y: clientY }), ...(from ? { from } : {}) });
  };

  const onDrop = (event: React.DragEvent) => {
    const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const item = readResourceDragData(event.dataTransfer);
    if (item) { event.preventDefault(); addFile(item.path, at); return; }
    /* files of this computer: brought into the project first (as the Assets bring them), then laid down side by side */
    if (isComputerFileDrag(event.dataTransfer) && event.dataTransfer.files.length) {
      event.preventDefault();
      event.stopPropagation();
      void onImportFiles([...event.dataTransfer.files]).then((paths) => {
        if (!paths.length) return;
        willChange();
        const added: BoardNode[] = paths.map((path, i) => ({ id: canvasId('n'), type: 'file', position: { x: at.x - FILE_W / 2 + i * (FILE_W + 24), y: at.y - 80 }, width: FILE_W, data: { path } }));
        setNodes((list) => [...list.map((n) => ({ ...n, selected: false })), ...added.map((n) => ({ ...n, selected: true }))]);
      });
    }
  };

  /* ── the chat: nodes as references (⌘L), and a node a reference points at shown ── */
  const refOf = (n: BoardNode): StudioRef | null => {
    const words = (text: string, fallback: string) => text.replace(/\s+/g, ' ').trim().slice(0, 60) || fallback;
    const picture = (path: string | undefined) => {
      const file = path ? byPath.get(path) : undefined;
      const src = !file ? undefined : file.kind === 'image' ? sources.file(file) : file.kind === 'video' ? sources.poster?.(file) : file.kind === 'mg' ? sources.pagePoster?.(file) : undefined;
      return src ? { image: { src } } : {};
    };
    if (n.type === 'note') return { kind: 'node', id: n.id, nodeKind: 'note', label: words(n.data.text, t('canvas.note')), text: n.data.text };
    if (n.type === 'frame') return { kind: 'node', id: n.id, nodeKind: 'group', label: n.data.label || t('canvas.group') };
    if (n.type === 'file') {
      return { kind: 'node', id: n.id, nodeKind: 'file', label: byPath.get(n.data.path)?.name ?? n.data.path.split('/').pop() ?? n.data.path, path: n.data.path, ...picture(n.data.path) };
    }
    return {
      kind: 'node', id: n.id, nodeKind: n.data.make, label: words(n.data.prompt ?? '', t(`canvas.make.${n.data.make}`)), prompt: n.data.prompt ?? '',
      ...(n.data.path ? { path: n.data.path } : {}), ...(n.data.versions?.length ? { versions: n.data.versions.length } : {}), ...picture(n.data.path),
    };
  };
  const refer = () => {
    if (!onRefer) return false;
    const refs = now.current.nodes.filter((n) => n.selected).flatMap((n) => refOf(n) ?? []);
    if (!refs.length) return false;
    onRefer(refs);
    return true;
  };
  React.useEffect(() => {
    if (!focus || !ready) return;
    const node = now.current.nodes.find((n) => n.id === focus.id);
    if (!node) { onError(t('canvas.gone')); return; }
    setNodes((list) => list.map((n) => ({ ...n, selected: n.id === focus.id })));
    requestAnimationFrame(() => { void flow.fitView({ nodes: [{ id: focus.id }], padding: 0.6, maxZoom: 1, duration: 250 }); });
  }, [focus, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── keys: the board's own, and the page's while nothing else has them (a menu closed, a node drawn again): the
     board covers the edit, so Studio's ⌘Z, Space and the rest are not to act on a film out of sight ── */
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target !== document.body && !rootRef.current?.contains(target)) return;
    /* a menu open has the keys (its Escape closes it, and only it) */
    if (menu || context) return;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    const done = () => { event.preventDefault(); event.stopPropagation(); };
    if (mod && key === 'z') { done(); step(!event.shiftKey); }
    else if (mod && key === 'y') { done(); step(false); }
    else if (mod && key === 'c') { if (copy()) done(); }
    else if (mod && key === 'x') { if (copy()) { done(); removeSelected(); } }
    else if (mod && key === 'v') { done(); paste(); }
    else if (mod && key === 'd') { done(); duplicate(); }
    else if (mod && key === 'a') { done(); selectAll(); }
    else if (mod && key === 'g') { done(); if (event.shiftKey) ungroup(); else group(); }
    else if (mod && key === 'l') { if (refer()) done(); }
    else if (!mod && (key === 'backspace' || key === 'delete')) { done(); removeSelected(); }
    else if (!mod && key === '/') {
      done();
      const box = rootRef.current!.getBoundingClientRect();
      openMenu(box.left + box.width / 2 - 140, box.top + box.height / 3);
    } else if (key === 'escape') { setNodes((list) => list.map((n) => (n.selected ? { ...n, selected: false } : n))); setEdges(unselectEdges); }
    else if (target === document.body) event.stopPropagation();
  };
  const keys = React.useRef(onKeyDown);
  keys.current = onKeyDown;
  React.useEffect(() => {
    const listen = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener('keydown', listen, true);
    return () => window.removeEventListener('keydown', listen, true);
  }, []);

  /* the wires into a node that makes something, numbered in their order when there are more than one */
  const numbered = React.useMemo(() => {
    const makes = new Set(nodes.flatMap((n) => (n.type === 'make' ? [n.id] : [])));
    const into = new Map<string, Edge[]>();
    for (const e of edges) if (makes.has(e.target)) into.set(e.target, [...(into.get(e.target) ?? []), e]);
    const place = new Map<string, number>();
    for (const list of into.values()) {
      if (list.length < 2) continue;
      const rank = (e: Edge) => (typeof e.data?.order === 'number' ? e.data.order : Infinity);
      list.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).forEach(({ e }, i) => place.set(e.id, i + 1));
    }
    if (!place.size) return edges;
    return edges.map((e) => (place.has(e.id) ? {
      ...e, label: String(place.get(e.id)), labelBgPadding: [5, 2] as [number, number], labelBgBorderRadius: 4,
      labelStyle: { fontSize: 10.5, fill: 'var(--text-muted)' }, labelBgStyle: { fill: 'var(--surface)' },
    } : e));
  }, [nodes, edges]);

  /* ── right clicks ── */
  const nodeMenu = (event: React.MouseEvent, node: BoardNode) => {
    event.preventDefault();
    if (!node.selected) setNodes((list) => list.map((n) => ({ ...n, selected: n.id === node.id })));
    const file = node.type === 'file' ? board.fileOf(node.data.path) : node.type === 'make' && node.data.path ? board.fileOf(node.data.path) : null;
    const running = node.type === 'make' && board.run(node.id);
    setContext({ x: event.clientX, y: event.clientY, items: [
      ...(node.type === 'make' ? [running
        ? { id: 'stop', label: t('canvas.make.stop'), icon: <Square size={15} />, onSelect: () => board.stop(node.id) }
        : { id: 'make', label: node.data.versions?.length ? t('canvas.make.again') : t('canvas.make.run'), icon: <Sparkles size={15} />, shortcut: `${MOD}↵`,
          disabled: !board.choices(node.data.make).length, hint: t('canvas.make.noService'), onSelect: () => makeNow(node.id) }] : []),
      ...(file && file.kind !== 'other' ? [{ id: 'film', label: t('canvas.addToFilm'), icon: <Clapperboard size={15} />, onSelect: () => onAddToFilm(file) }, { id: 's0', separator: true as const }] : []),
      ...(onRefer ? [{ id: 'refer', label: t('host.refer'), shortcut: `${MOD}L`, onSelect: () => { refer(); } }] : []),
      { id: 'copy', label: t('canvas.copy'), shortcut: `${MOD}C`, onSelect: () => { copy(); } },
      { id: 'duplicate', label: t('canvas.duplicate'), shortcut: `${MOD}D`, onSelect: duplicate },
      ...(node.type === 'frame' && board.makesIn(node.id) ? [{ id: 'all', label: t('canvas.makeAll'), icon: <Play size={15} />, disabled: board.busyIn(node.id), onSelect: () => { void makeAll(node.id); } }] : []),
      ...(node.type === 'frame' ? [{ id: 'template', label: t('canvas.keepTemplate'), icon: <LayoutTemplate size={15} />, onSelect: () => { void keepTemplate(node.id); } }] : []),
      ...(node.type === 'frame'
        ? [{ id: 'ungroup', label: t('canvas.ungroup'), shortcut: `${SHIFT}G`, onSelect: ungroup }]
        : node.parentId ? [] : [{ id: 'group', label: t('canvas.groupThem'), shortcut: `${MOD}G`, onSelect: group }]),
      ...(node.type === 'frame' ? [{ id: 'color', label: t('canvas.color'), submenu: GROUP_COLORS.map((c) => ({
        id: c, label: t(`canvas.colors.${c}`), checked: node.data.color === c,
        icon: <span className="block h-3 w-3 rounded-full" style={{ background: FRAME_COLOR[c].chip }} />,
        onSelect: () => { willChange(); board.setData(node.id, { color: c }); },
      })) }] : []),
      { id: 's1', separator: true },
      { id: 'delete', label: t('canvas.remove'), shortcut: '⌫', danger: true, onSelect: removeSelected },
    ] });
  };
  const paneMenu = (event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    const { clientX, clientY } = event;
    setContext({ x: clientX, y: clientY, items: [
      { id: 'add', label: t('canvas.addHere'), icon: <Plus size={15} />, shortcut: '/', onSelect: () => openMenu(clientX, clientY) },
      { id: 'paste', label: t('canvas.paste'), shortcut: `${MOD}V`, disabled: !clipboard, hint: t('canvas.nothingCopied'), onSelect: paste },
      { id: 'all', label: t('canvas.selectAll'), shortcut: `${MOD}A`, onSelect: selectAll },
      { id: 's', separator: true },
      { id: 'fit', label: t('canvas.fit'), onSelect: () => { void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 200 }); } },
    ] });
  };
  const edgeMenu = (event: React.MouseEvent, edge: Edge) => {
    event.preventDefault();
    const into = now.current.nodes.find((n) => n.id === edge.target)?.type === 'make' && now.current.edges.filter((e) => e.target === edge.target).length > 1;
    setContext({ x: event.clientX, y: event.clientY, items: [
      ...(into ? [{ id: 'first', label: t('canvas.make.first'), onSelect: () => {
        willChange();
        const order = new Map(reorder(docNow(), edge.target, edge.id).map((e) => [e.id, e.order]));
        setEdges((list) => list.map((e) => (e.target === edge.target ? { ...e, data: { ...e.data, order: order.get(e.id) } } : e)));
      } }, { id: 's', separator: true as const }] : []),
      { id: 'delete', label: t('canvas.removeWire'), danger: true, onSelect: () => { willChange(); setEdges((list) => list.filter((e) => e.id !== edge.id)); } },
    ] });
  };

  return (
    <BoardContext.Provider value={board}>
      <div
        ref={rootRef}
        data-studio-canvas=""
        tabIndex={-1}
        className="relative h-full w-full outline-none"
        onPointerDown={(event) => { if (!(event.target as HTMLElement).closest('input, textarea')) rootRef.current?.focus({ preventScroll: true }); }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(RESOURCE_DRAG_TYPE) && !isComputerFileDrag(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={onDrop}
        onDoubleClick={(event) => {
          if (!(event.target as Element).classList?.contains('react-flow__pane')) return;
          openMenu(event.clientX, event.clientY);
        }}
      >
        <ReactFlow<BoardNode, Edge>
          nodes={nodes}
          edges={numbered}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStart={willChange}
          onSelectionDragStart={willChange}
          onConnect={(connection: Connection) => {
            willChange();
            setEdges((list) => [...list, { ...connection, id: canvasId('e'), data: { order: nextOrder(docNow(), connection.target) } } as Edge]);
          }}
          onConnectEnd={(event, state: FinalConnectionState) => {
            /* let go on the board: what to add there, joined to that wire */
            if (state.isValid || !state.fromNode) return;
            const point = 'changedTouches' in event ? event.changedTouches[0]! : event;
            openMenu(point.clientX, point.clientY, { node: state.fromNode.id, side: state.fromHandle?.type === 'target' ? 'target' : 'source' });
          }}
          isValidConnection={(c) => c.source !== c.target}
          onNodeContextMenu={nodeMenu}
          onPaneContextMenu={paneMenu}
          onEdgeContextMenu={edgeMenu}
          onPaneClick={() => setContext(null)}
          colorMode={dark ? 'dark' : 'light'}
          panOnScroll
          zoomOnPinch
          zoomOnScroll={false}
          panOnDrag={[1, 2]}
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={['Meta', 'Shift', 'Control']}
          connectionRadius={30}
          snapToGrid
          snapGrid={[8, 8]}
          paneClickDistance={8}
          nodeClickDistance={8}
          elevateNodesOnSelect
          onlyRenderVisibleElements
          minZoom={0.1}
          maxZoom={4}
          proOptions={{ hideAttribution: true }}
          className="openfilm-canvas"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
          <Controls position="bottom-left" showInteractive={false} fitViewOptions={{ padding: 0.2, maxZoom: 1 }} />
          <MiniMap position="bottom-right" pannable zoomable
            nodeColor={(n) => (n.type === 'frame' ? 'transparent' : n.type === 'note' ? 'var(--surface-3)' : 'var(--text-faint)')}
            nodeStrokeColor={(n) => (n.type === 'frame' ? FRAME_COLOR[(n.data as FrameData).color].line : 'transparent')} />
        </ReactFlow>
        <div className="absolute left-3 top-3 z-10">
          <Tooltip label={t('canvas.addNote')} side="bottom">
            <button type="button" aria-label={t('canvas.addNote')}
              onClick={() => {
                const box = rootRef.current!.getBoundingClientRect();
                addNote(flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 }));
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] shadow-[0_2px_8px_rgba(0,0,0,0.12)] transition hover:text-[var(--text)]">
              <StickyNote size={15} />
            </button>
          </Tooltip>
        </div>
        {ready && nodes.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4">
            <div className="max-w-[340px] text-center text-[13px] leading-relaxed text-[var(--text-faint)]">{t('canvas.empty')}</div>
            <div className="pointer-events-auto flex flex-wrap justify-center gap-2">
              {templates.slice(0, 4).map((template) => (
                <button key={template.id} type="button"
                  onClick={() => { const box = rootRef.current!.getBoundingClientRect(); void layTemplate(template, flow.screenToFlowPosition({ x: box.left + 80, y: box.top + 120 }))
                    .then(() => requestAnimationFrame(() => { void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 200 }); })); }}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[12.5px] text-[var(--text-muted)] transition hover:text-[var(--text)]">
                  <LayoutTemplate size={13} />{template.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {menu ? (
          <AddMenu
            menu={menu}
            files={files}
            onClose={() => setMenu(null)}
            onNote={() => { setMenu(null); addNote(menu.at, menu.from); }}
            onMake={(kind) => { setMenu(null); addMake(kind, menu.at, menu.from); }}
            templates={templates}
            onTemplate={(template) => { setMenu(null); void layTemplate(template, menu.at); }}
            onRemoveTemplate={(template) => { void removeTemplate(template); }}
            onFile={(file) => { setMenu(null); addFile(file.path, menu.at, menu.from); }}
          />
        ) : null}
        {context ? <ContextMenu x={context.x} y={context.y} items={context.items} onClose={() => setContext(null)} /> : null}
      </div>
    </BoardContext.Provider>
  );
}

export interface CanvasViewProps {
  projectId: string;
  /** the project's folder: where what is made lands (under assets/) */
  folder: string;
  /** the project's files (the Assets' listing) */
  files: readonly WorkspaceResource[];
  sources: MediaSources;
  onAddToFilm: (file: WorkspaceResource) => void;
  /** files of this computer brought into the project, as the Assets bring them: their paths in it */
  onImportFiles: (files: File[]) => Promise<string[]>;
  /** where the person connects a service to make with */
  onOpenSettings: () => void;
  /** a word that something went as asked (a template kept) */
  onNotice: (message: string) => void;
  /** the selected nodes into the chat as references (⌘L); none: no chat here */
  onRefer?: (refs: StudioRef[]) => void;
  /** a node to show (a chat's reference to it clicked): selected and in view; `n` is new each time */
  focus?: { id: string; n: number } | null;
  onError: (message: string) => void;
}

export default function CanvasView(props: CanvasViewProps) {
  return (
    <ReactFlowProvider>
      <Board {...props} />
    </ReactFlowProvider>
  );
}
