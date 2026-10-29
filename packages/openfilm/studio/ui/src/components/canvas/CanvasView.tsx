/**
 * The project's canvas: a board beside the edit, as a design app's, where the project's media is laid out, notes are
 * written beside it and what leads to what is drawn as a wire. Nothing on it is in the film until it is added to the
 * timeline (a node's toolbar). Kept in `.film/canvas.json` (lib/canvas, studio/server/canvas.mjs), written a moment
 * after each change.
 *
 * Media comes from the Assets (dragged in); a double click on the board writes a note there. Two fingers pan, a pinch
 * zooms, a drag on the board pans, ⇧ and a drag selects; Delete removes what is selected. The board is React Flow
 * (@xyflow/react): its nodes are ours.
 *
 * Its keys are its own: Studio's shortcuts leave them alone (`data-studio-canvas`, typing-target.ts).
 */
import React from 'react';
import {
  Background, BackgroundVariant, Controls, Handle, MiniMap, NodeResizer, NodeToolbar, Position, ReactFlow, ReactFlowProvider,
  addEdge, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Clapperboard, FileQuestion, Image as ImageIcon, Music, StickyNote, Trash2, Video } from 'lucide-react';
import { useT } from '@/i18n';
import { api } from '@/api';
import { FILE_W, NOTE_H, NOTE_W, canvasId, canvasKey, readCanvasDoc, type CanvasDoc } from '@/lib/canvas';
import { RESOURCE_DRAG_TYPE, readResourceDragData } from '@/lib/resource-drag';
import type { MediaSources, WorkspaceResource } from '@/lib/workspace-resources';
import { useThemeChanges } from '@/lib/theme-changes';
import { Tooltip } from '../Tooltip';

/** how long after the last change the board is written */
const SAVE_AFTER_MS = 600;

type FileData = { path: string };
type NoteData = { text: string };
type FileNode = Node<FileData, 'file'>;
type NoteNode = Node<NoteData, 'note'>;
type BoardNode = FileNode | NoteNode;

/** What the nodes need of the page around them: the project's files, how to show one, and what to do with them. */
interface Board {
  fileOf: (path: string) => WorkspaceResource | null;
  sources: MediaSources;
  addToFilm: (file: WorkspaceResource) => void;
  setText: (id: string, text: string) => void;
  remove: (id: string) => void;
  /** the note being written in (null: none) */
  editing: string | null;
  edit: (id: string | null) => void;
}
const BoardContext = React.createContext<Board | null>(null);

function toFlow(doc: CanvasDoc): { nodes: BoardNode[]; edges: Edge[] } {
  return {
    nodes: doc.nodes.map((n): BoardNode => (n.path != null
      ? { id: n.id, type: 'file', position: { x: n.x, y: n.y }, width: n.w ?? FILE_W, data: { path: n.path } }
      : { id: n.id, type: 'note', position: { x: n.x, y: n.y }, width: n.w ?? NOTE_W, height: n.h ?? NOTE_H, data: { text: n.text ?? '' } })),
    edges: doc.edges.map((e) => ({ id: e.id, source: e.from, target: e.to })),
  };
}

function fromFlow(nodes: readonly BoardNode[], edges: readonly Edge[]): CanvasDoc {
  return {
    nodes: nodes.map((n) => {
      const box = { id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) };
      const w = Math.round(n.width ?? n.measured?.width ?? (n.type === 'note' ? NOTE_W : FILE_W));
      if (n.type === 'file') return { ...box, w, path: n.data.path };
      return { ...box, w, h: Math.round(n.height ?? n.measured?.height ?? NOTE_H), text: n.data.text };
    }),
    edges: edges.map((e) => ({ id: e.id, from: e.source, to: e.target })),
  };
}

const KIND_ICON = { video: Video, image: ImageIcon, audio: Music, mg: Clapperboard, other: FileQuestion } as const;

/** A node's buttons over it while it is the one selected: add it to the timeline, remove it from the board. */
function NodeButtons({ id, file }: { id: string; file?: WorkspaceResource | null }) {
  const t = useT();
  const board = React.useContext(BoardContext)!;
  const btn = 'flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]';
  return (
    <NodeToolbar position={Position.Top} offset={10}>
      <div className="flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5 shadow-[0_4px_14px_rgba(0,0,0,0.18)]">
        {file && file.kind !== 'other' ? (
          <button type="button" className={btn} onClick={() => board.addToFilm(file)}>
            <Clapperboard size={13} />{t('canvas.addToFilm')}
          </button>
        ) : null}
        <Tooltip label={t('canvas.remove')}>
          <button type="button" aria-label={t('canvas.remove')} className={btn} onClick={() => board.remove(id)}><Trash2 size={13} /></button>
        </Tooltip>
      </div>
    </NodeToolbar>
  );
}

const HANDLE = '!h-2.5 !w-2.5 !border-2 !border-[var(--dock-pane)] !bg-[var(--text-faint)] opacity-0 transition group-hover:opacity-100';

/** A file of the project: its name above it, its picture (a video plays under the pointer, a sound has its player). */
function FileNodeView({ id, data, selected }: NodeProps<FileNode>) {
  const t = useT();
  const board = React.useContext(BoardContext)!;
  const file = board.fileOf(data.path);
  const Icon = KIND_ICON[file?.kind ?? 'other'];
  const name = file?.name ?? data.path.split('/').pop() ?? data.path;
  const video = React.useRef<HTMLVideoElement>(null);
  return (
    <div className="group relative h-full w-full">
      <NodeButtons id={id} file={file} />
      <NodeResizer isVisible={selected} minWidth={120} keepAspectRatio={file?.kind !== 'audio'} lineClassName="!border-transparent"
        handleClassName="!h-2 !w-2 !rounded-sm !border !border-[var(--text)] !bg-[var(--dock-pane)]" />
      <div className="pointer-events-none absolute -top-5 left-0 right-0 flex items-center gap-1.5 truncate text-[11px] text-[var(--text-faint)]">
        <Icon size={11} className="shrink-0" /><span className="truncate">{name}</span>
      </div>
      <div className={`overflow-hidden rounded-[10px] border bg-[var(--surface)] ${selected ? 'border-[var(--text)]' : 'border-[var(--border)]'}`}>
        {!file ? (
          <div className="flex aspect-video items-center justify-center gap-2 px-3 text-center text-[12px] text-[var(--text-faint)]">
            <FileQuestion size={14} className="shrink-0" />{t('canvas.missing')}
          </div>
        ) : file.kind === 'image' ? (
          <img src={board.sources.file(file)} alt="" draggable={false} className="block w-full" />
        ) : file.kind === 'video' ? (
          <video ref={video} src={board.sources.file(file)} poster={board.sources.poster?.(file)} muted loop playsInline preload="metadata"
            onMouseEnter={() => { void video.current?.play().catch(() => {}); }} onMouseLeave={() => video.current?.pause()}
            className="block w-full" />
        ) : file.kind === 'mg' ? (
          <img src={board.sources.pagePoster?.(file)} alt="" draggable={false} className="block aspect-video w-full object-cover" />
        ) : file.kind === 'audio' ? (
          <div className="flex items-center gap-2 p-2.5">
            <Music size={16} className="shrink-0 text-[var(--text-faint)]" />
            <audio src={board.sources.file(file)} controls preload="metadata" className="nodrag h-8 min-w-0 flex-1" />
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
  const editing = board.editing === id;
  return (
    <div className="group relative h-full w-full" onDoubleClick={() => board.edit(id)}>
      <NodeButtons id={id} />
      <NodeResizer isVisible={selected} minWidth={140} minHeight={60} lineClassName="!border-transparent"
        handleClassName="!h-2 !w-2 !rounded-sm !border !border-[var(--text)] !bg-[var(--dock-pane)]" />
      <div className="pointer-events-none absolute -top-5 left-0 flex items-center gap-1.5 text-[11px] text-[var(--text-faint)]">
        <StickyNote size={11} />{t('canvas.note')}
      </div>
      <div className={`flex h-full w-full overflow-hidden rounded-[10px] border bg-[var(--surface-2)] ${selected || editing ? 'border-[var(--text)]' : 'border-[var(--border)]'}`}>
        {editing ? (
          <textarea
            autoFocus
            value={data.text}
            onChange={(event) => board.setText(id, event.target.value)}
            onBlur={() => board.edit(null)}
            onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.blur(); }}
            placeholder={t('canvas.notePlaceholder')}
            className="nodrag nowheel h-full w-full resize-none bg-transparent p-3 text-[13px] leading-relaxed text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          />
        ) : (
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

const NODE_TYPES = { file: FileNodeView, note: NoteNodeView };

function Board({ projectId, files, sources, onAddToFilm, onError }: CanvasViewProps) {
  const t = useT();
  const flow = useReactFlow<BoardNode, Edge>();
  const [nodes, setNodes, onNodesChange] = useNodesState<BoardNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [ready, setReady] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const saved = React.useRef('');
  const themeChanges = useThemeChanges();
  const dark = React.useMemo(() => document.documentElement.dataset.theme === 'dark', [themeChanges]); // eslint-disable-line react-hooks/exhaustive-deps

  /* read once; shown fitted to the view */
  React.useEffect(() => {
    let live = true;
    void api.canvas(projectId).then((raw) => {
      if (!live) return;
      const doc = readCanvasDoc(raw);
      saved.current = canvasKey(doc);
      const flowDoc = toFlow(doc);
      setNodes(flowDoc.nodes);
      setEdges(flowDoc.edges);
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

  const byPath = React.useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const board = React.useMemo<Board>(() => ({
    fileOf: (path) => byPath.get(path) ?? null,
    sources,
    addToFilm: onAddToFilm,
    setText: (id, text) => setNodes((list) => list.map((n) => (n.id === id && n.type === 'note' ? { ...n, data: { text } } : n))),
    remove: (id) => {
      setNodes((list) => list.filter((n) => n.id !== id));
      setEdges((list) => list.filter((e) => e.source !== id && e.target !== id));
    },
    editing,
    edit: setEditing,
  }), [byPath, sources, onAddToFilm, setNodes, setEdges, editing]);

  const addNote = (x: number, y: number) => {
    const id = canvasId('n');
    setNodes((list) => [...list.map((n) => ({ ...n, selected: false })),
      { id, type: 'note', position: { x: x - NOTE_W / 2, y: y - NOTE_H / 2 }, width: NOTE_W, height: NOTE_H, data: { text: '' }, selected: true }]);
    /* written in at once, as a note on paper */
    setEditing(id);
  };

  const onDrop = (event: React.DragEvent) => {
    const item = readResourceDragData(event.dataTransfer);
    if (!item) return;
    event.preventDefault();
    const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setNodes((list) => [...list.map((n) => ({ ...n, selected: false })),
      { id: canvasId('n'), type: 'file', position: { x: at.x - FILE_W / 2, y: at.y - 40 }, width: FILE_W, data: { path: item.path }, selected: true }]);
  };

  return (
    <BoardContext.Provider value={board}>
      <div
        data-studio-canvas=""
        className="relative h-full w-full"
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(RESOURCE_DRAG_TYPE)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={onDrop}
        onDoubleClick={(event) => {
          if (!(event.target as Element).classList?.contains('react-flow__pane')) return;
          const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
          addNote(at.x, at.y);
        }}
      >
        <ReactFlow<BoardNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={(connection: Connection) => setEdges((list) => addEdge({ ...connection, id: canvasId('e') }, list))}
          colorMode={dark ? 'dark' : 'light'}
          panOnScroll
          zoomOnDoubleClick={false}
          deleteKeyCode={['Backspace', 'Delete']}
          minZoom={0.1}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
          className="openfilm-canvas"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
          <Controls position="bottom-left" showInteractive={false} fitViewOptions={{ padding: 0.2, maxZoom: 1 }} />
          <MiniMap position="bottom-right" pannable zoomable nodeColor={(n) => (n.type === 'note' ? 'var(--surface-3)' : 'var(--text-faint)')} />
        </ReactFlow>
        <div className="absolute left-3 top-3 z-10">
          <Tooltip label={t('canvas.addNote')} side="bottom">
            <button type="button" aria-label={t('canvas.addNote')}
              onClick={() => {
                const box = document.querySelector('[data-studio-canvas]')!.getBoundingClientRect();
                const at = flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
                addNote(at.x, at.y);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] shadow-[0_2px_8px_rgba(0,0,0,0.12)] transition hover:text-[var(--text)]">
              <StickyNote size={15} />
            </button>
          </Tooltip>
        </div>
        {ready && nodes.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="max-w-[320px] text-center text-[13px] leading-relaxed text-[var(--text-faint)]">{t('canvas.empty')}</div>
          </div>
        ) : null}
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
  onError: (message: string) => void;
}

export default function CanvasView(props: CanvasViewProps) {
  return (
    <ReactFlowProvider>
      <Board {...props} />
    </ReactFlowProvider>
  );
}
