/**
 * The project's canvas: a board beside the edit, where the project's media is laid out, notes are
 * written beside it, things are gathered in groups and what leads to what is drawn as a wire. Nothing on it is in the
 * film until it is added to the timeline (a node's toolbar or menu). Kept in `.film/canvas.json` (lib/canvas,
 * studio/server/canvas.mjs), written a moment after each change.
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
import { Clapperboard, FileQuestion, Image as ImageIcon, Music, Plus, Search, StickyNote, Trash2, Video } from 'lucide-react';
import { useT } from '@/i18n';
import { api } from '@/api';
import {
  FILE_W, GROUP_COLORS, NOTE_H, NOTE_W, canvasId, canvasKey, copyOf, emptyHistory, readCanvasDoc, redo, remember, undo,
  type CanvasDoc, type CanvasHistory, type GroupColor,
} from '@/lib/canvas';
import { RESOURCE_DRAG_TYPE, isComputerFileDrag, readResourceDragData } from '@/lib/resource-drag';
import type { MediaSources, WorkspaceResource } from '@/lib/workspace-resources';
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

type FileData = { path: string };
type NoteData = { text: string };
type FrameData = { label: string; color: GroupColor };
type FileNode = Node<FileData, 'file'>;
type NoteNode = Node<NoteData, 'note'>;
type FrameNode = Node<FrameData, 'frame'>;
type BoardNode = FileNode | NoteNode | FrameNode;

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
  setData: (id: string, data: Partial<FileData & NoteData & FrameData>) => void;
  remove: (ids: string[]) => void;
  /** the board as it is now kept to go back to: called before a change made in a node (a resize, words written) */
  willChange: () => void;
  /** the note or group name being written in (null: none) */
  editing: string | null;
  edit: (id: string | null) => void;
}
const BoardContext = React.createContext<Board | null>(null);

/** The board as React Flow draws it: groups before what is in them, as it needs them. */
function toFlow(doc: CanvasDoc): { nodes: BoardNode[]; edges: Edge[] } {
  const ordered = [...doc.nodes.filter((n) => n.group != null), ...doc.nodes.filter((n) => n.group == null)];
  return {
    nodes: ordered.map((n): BoardNode => {
      const base = { id: n.id, position: { x: n.x, y: n.y }, ...(n.parent ? { parentId: n.parent } : {}) };
      if (n.group != null) return { ...base, type: 'frame', width: n.w ?? 480, height: n.h ?? 320, zIndex: -1, data: { label: n.group, color: n.color ?? 'gray' } };
      if (n.path != null) return { ...base, type: 'file', width: n.w ?? FILE_W, data: { path: n.path } };
      return { ...base, type: 'note', width: n.w ?? NOTE_W, height: n.h ?? NOTE_H, data: { text: n.text ?? '' } };
    }),
    edges: doc.edges.map((e) => ({ id: e.id, source: e.from, target: e.to })),
  };
}

function fromFlow(nodes: readonly BoardNode[], edges: readonly Edge[]): CanvasDoc {
  return {
    nodes: nodes.map((n) => {
      const box = { id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y), ...(n.parentId ? { parent: n.parentId } : {}) };
      const w = Math.round(n.width ?? n.measured?.width ?? (n.type === 'note' ? NOTE_W : FILE_W));
      const h = () => Math.round(n.height ?? n.measured?.height ?? NOTE_H);
      if (n.type === 'file') return { ...box, w, path: n.data.path };
      if (n.type === 'frame') return { id: n.id, x: box.x, y: box.y, w, h: h(), group: n.data.label, color: n.data.color };
      return { ...box, w, h: h(), text: n.data.text };
    }),
    edges: edges.map((e) => ({ id: e.id, from: e.source, to: e.target })),
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
      <div className="pointer-events-none absolute -top-5 left-0 flex items-center gap-1.5 text-[11px] text-[var(--text-faint)]">
        <StickyNote size={11} />{t('canvas.note')}
      </div>
      <div className={`flex h-full w-full overflow-hidden rounded-[10px] border bg-[var(--surface-2)] ${selected || editing ? 'border-[var(--text)]' : 'border-[var(--border)]'}`}>
        {editing ? (
          <textarea
            autoFocus
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
      </div>
    </div>
  );
}

const NODE_TYPES = { file: FileNodeView, note: NoteNodeView, frame: FrameNodeView };

/** where the add menu opens: on the screen, on the board, and the wire it joins (a node's side let go on the board) */
interface MenuAt { screen: { x: number; y: number }; at: { x: number; y: number }; from?: { node: string; side: 'source' | 'target' } }

/** The menu of what to add where it opened: a note, or a file of the project, searched; Enter takes the first. */
function AddMenu({ menu, files, onNote, onFile, onClose }: {
  menu: MenuAt;
  files: readonly WorkspaceResource[];
  onNote: () => void;
  onFile: (file: WorkspaceResource) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const needle = query.trim().toLowerCase();
  const shown = files.filter((f) => f.kind !== 'other' && (!needle || f.name.toLowerCase().includes(needle) || f.path.toLowerCase().includes(needle))).slice(0, MENU_FILES);
  const items: Array<{ key: string; label: string; icon: React.ReactNode; run: () => void }> = [
    ...(!needle || t('canvas.note').toLowerCase().includes(needle) ? [{ key: 'note', label: t('canvas.note'), icon: <StickyNote size={14} />, run: onNote }] : []),
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
          </button>
        ))}
        {items.length ? null : <div className="flex h-8 items-center px-2 text-[12.5px] text-[var(--text-faint)]">{t('canvas.nothing')}</div>}
      </div>
    </div>
  );
}

/** what was copied last, on any board of this page: pasted with new ids, a step further each time */
let clipboard: { doc: CanvasDoc; pasted: number } | null = null;

function Board({ projectId, files, sources, onAddToFilm, onImportFiles, onError }: CanvasViewProps) {
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
  const board = React.useMemo<Board>(() => ({
    fileOf: (path) => byPath.get(path) ?? null,
    sources,
    addToFilm: onAddToFilm,
    setData: (id, data) => setNodes((list) => list.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } as BoardNode : n))),
    remove,
    willChange,
    editing,
    edit: (id) => { if (id) willChange(); setEditing(id); },
  }), [byPath, sources, onAddToFilm, setNodes, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── adding: a note, a file, joined to the wire it came from ── */
  const place = (node: BoardNode, from?: MenuAt['from']) => {
    willChange();
    setNodes((list) => [...list.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]);
    setEdges(unselectEdges);
    if (from) {
      const edge = from.side === 'source' ? { id: canvasId('e'), source: from.node, target: node.id } : { id: canvasId('e'), source: node.id, target: from.node };
      setEdges((list) => [...list, edge]);
    }
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

  /* ── right clicks ── */
  const nodeMenu = (event: React.MouseEvent, node: BoardNode) => {
    event.preventDefault();
    if (!node.selected) setNodes((list) => list.map((n) => ({ ...n, selected: n.id === node.id })));
    const file = node.type === 'file' ? board.fileOf(node.data.path) : null;
    setContext({ x: event.clientX, y: event.clientY, items: [
      ...(file && file.kind !== 'other' ? [{ id: 'film', label: t('canvas.addToFilm'), icon: <Clapperboard size={15} />, onSelect: () => onAddToFilm(file) }, { id: 's0', separator: true as const }] : []),
      { id: 'copy', label: t('canvas.copy'), shortcut: `${MOD}C`, onSelect: () => { copy(); } },
      { id: 'duplicate', label: t('canvas.duplicate'), shortcut: `${MOD}D`, onSelect: duplicate },
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
    setContext({ x: event.clientX, y: event.clientY, items: [
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
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStart={willChange}
          onSelectionDragStart={willChange}
          onConnect={(connection: Connection) => { willChange(); setEdges((list) => [...list, { ...connection, id: canvasId('e') } as Edge]); }}
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
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="max-w-[340px] text-center text-[13px] leading-relaxed text-[var(--text-faint)]">{t('canvas.empty')}</div>
          </div>
        ) : null}
        {menu ? (
          <AddMenu
            menu={menu}
            files={files}
            onClose={() => setMenu(null)}
            onNote={() => { setMenu(null); addNote(menu.at, menu.from); }}
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
  /** the project's files (the Assets' listing) */
  files: readonly WorkspaceResource[];
  sources: MediaSources;
  onAddToFilm: (file: WorkspaceResource) => void;
  /** files of this computer brought into the project, as the Assets bring them: their paths in it */
  onImportFiles: (files: File[]) => Promise<string[]>;
  onError: (message: string) => void;
}

export default function CanvasView(props: CanvasViewProps) {
  return (
    <ReactFlowProvider>
      <Board {...props} />
    </ReactFlowProvider>
  );
}
