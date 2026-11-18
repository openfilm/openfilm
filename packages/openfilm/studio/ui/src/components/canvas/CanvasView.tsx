/**
 * The project's canvas: the board beside the edit where a film's material is made and laid out. Words, pictures,
 * clips, sounds and music are nodes, wired into what is made from them; a cut puts what is wired into it on the
 * timeline, in its order. Nothing on it is in the film until it is put there. Kept in `.film/canvas.json` (lib/canvas,
 * studio/server/canvas.mjs), written a moment after each change.
 *
 * A node that makes something does it with the person's own services (`openfilm get`, as their agent does), asked its
 * words and what is wired into it, in the wires' order. Each time it makes one, that is a new file in assets/ and a
 * new version of the node; when what goes into it changes, it says so. Being made goes on with the board closed.
 *
 * Its toolbar is at its foot (add, select or move, templates, undo, the keys, the agent); a node's ⊕ adds what is
 * made from it (right) or what goes into it (left), and its panel is under it while it is the one selected. Two
 * fingers pan, a pinch zooms, a drag on the board selects (H, the hand, or Space: it moves the board); a double click,
 * `/`, or a wire let go on the board opens the menu of what to add there. ⌘Z ⇧⌘Z, ⌘C ⌘V ⌘D, ⌘A, ⌘G ⇧⌘G, ⌘L and
 * Delete do as they say; a right click has the same in its menus. The board is React Flow (@xyflow/react): its nodes are ours.
 *
 * Its keys are its own: Studio's shortcuts leave them alone (`data-studio-canvas`, typing-target.ts).
 */
import React from 'react';
import { flushSync } from 'react-dom';
import {
  MiniMap, ReactFlow, ReactFlowProvider, SelectionMode, useEdgesState, useNodesState, useReactFlow, useStoreApi, useUpdateNodeInternals,
  type Connection, type Edge, type FinalConnectionState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Clapperboard, Download, FolderSearch, LayoutTemplate, Maximize2, MousePointerClick, Play, Plus, Scissors, Sparkles, Square, Upload, UserRound } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { ApiError, api, projectEvents, type CanvasBoard, type CanvasCharacter, type SubjectKind } from '@/api';
import { BoardSwitcher, boardName, nextBoardName } from './boards';
import {
  CARD_H, CUT_W, FILE_W, GROUP_COLORS, MAKE_MEDIA, MAKE_W, NOTE_H, NOTE_W, canvasId, cardWidth, makeSize, canvasKey, copyOf, emptyHistory, inputsChanged, inputsKey, inputsOf, isStale, makeName, makeRequest, modeOf, frameRatio, lengthOf, ratioOf, receiptOf,
  nextOrder, readCanvasDoc, redo, remember, reorder, undo, withVersion,
  type CanvasDoc, type CanvasHistory, type MediaOf,
} from '@/lib/canvas';
import { useProviders } from '@/lib/providers';
import { useLibraryVoices } from '@/lib/library-voices';
import { defaultVoice, serviceOf, voicesOf } from './voices';
import { builtInTemplates, type CanvasTemplate } from '@/lib/canvas-templates';
import { RESOURCE_DRAG_TYPE, isComputerFileDrag, readResourceDragData } from '@/lib/resource-drag';
import { resourceKindOf, type MediaSources, type WorkspaceResource } from '@/lib/workspace-resources';
import { studioHost, type StudioRef } from '@/lib/host';
import { useThemeChanges } from '@/lib/theme-changes';
import { ContextMenu, type ContextMenuEntry } from '../ContextMenu';
import {
  BoardContext, allChoicesFor, boxOf, choiceOf, choicesFor, defaultChoice, GROUP_HELD, fileCardWidth, fitGroups, fromFlow, tidyGroup, unstack, inputViews, keepLastModel, keepModelTime, lastModel, leaveRun, nextCardLayer, raiseCards, runErrors, runs, runsChanged, shownBoards, startRun, toFlow, useRuns,
  numberOf, type AssistKind, type Board, type Choice, type BoardNode, type FileNode, type PictureTool, type FrameData, type FrameNode, type MakeData, type MakingNode, type NoteData, type Side, type SpawnKind, type UploadStatus,
} from './board';
import { BottomToolbar, CornerBar, Dots, EmptyBoard, Outline, Ripples, ToolCorner, Viewer } from './chrome';
import { AddMenu, type MenuAt } from './menus';
import { CANVAS_EDGE_OPTIONS, CANVAS_EDGE_TYPES, DraggedWire, MenuWire } from './connections';
import { CharacterLibrary, HistoryModal, MaterialLibrary, SUBJECT_KINDS, SUBJECT_PARTS, loadSubjects } from './libraries';
import { CutoutSetup } from './cutout';
import { CameraPicker } from './camera';
import { TrimEditor } from './trim';
import { WRITING_ATTACHMENT_LIMIT } from '../../../../../src/canvas-attachments.mjs';
import { ClipToolEditor, type ClipMade } from './clip-tools';
import { CLIP_TOOLS, clipModels, isOwn, type ClipTool, type ClipToolKey } from '@/lib/canvas-clip';
import { cameraOf, cameraText, picksAnything } from '@/lib/canvas-camera';
import { RedrawEditor, type RedrawJob, type RedrawStart } from './redraw';
import { EXPAND_ASK, ExpandEditor, expandName, expandPlan, framedPicture, type Expanded } from './expand';
import { CropEditor } from './crop';
import { AdjustEditor } from './adjust';
import { LightPanel } from './light';
import { presetOf } from '@/lib/canvas-presets';
import { splitGrid } from './pixels';
import { FRAME_COLOR, NODE_TYPES } from './nodes';
import { SelectionToolbar } from './panels';
import { CanvasLoading } from './CanvasLoading';
import type { ImportProgress } from '../MediaPool';

/** where the canvas keeps what it makes on the way to a picture: under assets/, in a dot folder the library never lists */
const WORK = 'assets/.canvas';
/** how long after the last change the board is written */
const SAVE_AFTER_MS = 600;
/** the project's first board, and the one shown last in this browser (a convenience: none kept, the first) */
const MAIN_BOARD = 'main';
const lastBoard = (project: string) => { try { return localStorage.getItem(`openfilm.canvas.board.${project}`) ?? MAIN_BOARD; } catch { return MAIN_BOARD; } };
const keepLastBoard = (project: string, board: string) => { try { localStorage.setItem(`openfilm.canvas.board.${project}`, board); } catch { /* not kept */ } };
/** a group's room around what is in it, and above it for its name */
const GROUP_PAD = 32;
const GROUP_HEAD = 40;
/** how far a paste lands from what was copied, each time again */
const PASTE_STEP = 32;
/** the room between a node and what is added beside it */
const BESIDE = 100;
/** a wire into or out of the node selected */
const LIT = 'var(--cv-edge-lit)';

const MOD = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';
const SHIFT = MOD === '⌘' ? '⇧⌘' : 'Ctrl+Shift+';
/** what each kind of node starts as, wide */
const WIDE: Record<SpawnKind | 'file', number> = { note: NOTE_W, image: MAKE_W, video: MAKE_W, sfx: makeSize('sfx').w, music: makeSize('music').w, tts: makeSize('tts').w, cut: CUT_W, file: FILE_W };
/** what the computer's file picker offers, by what it is for */
const ACCEPT = { image: 'image/*', video: 'video/*', audio: 'audio/*', media: 'image/*,video/*,audio/*' } as const;

const NO_EDGES: Edge[] = [];
const unselectEdges = (list: Edge[]) => (list.some((e) => e.selected) ? list.map((e) => (e.selected ? { ...e, selected: false } : e)) : list);

/** what was copied last, on any board of this page: pasted with new ids, a step further each time */
let clipboard: { doc: CanvasDoc; pasted: number } | null = null;

type NodePlacement = Pick<MenuAt, 'at' | 'from' | 'corner' | 'wire'>;

function topLeft({ at, corner, wire, from }: NodePlacement, w: number, h: number) {
  if (corner) return at;
  const x = wire && from ? at.x - (from.side === 'target' ? w : 0) : at.x - w / 2;
  return { x, y: at.y - h / 2 };
}

type UploadTarget = NodePlacement & {
  version?: string;
  wireFirstOnly?: boolean;
};

type PendingUpload = UploadStatus & Pick<UploadTarget, 'from' | 'version'> & {
  id: string;
  board: string;
  position: MenuAt['at'];
  wireDrop?: NodePlacement;
  path?: string;
};

function BoardView({ shown = true, projectId, folder, files, sources, onAddToFilm, onSendToFilm, onImportFiles, onOpenSettings, onReveal, chat, onError, onNotice, focus, insert, addFiles, onRefer }: CanvasViewProps) {
  const t = useT();
  const flow = useReactFlow<BoardNode, Edge>();
  const updateNodeInternals = useUpdateNodeInternals();
  const flowStore = useStoreApi();
  const selectionStart = React.useRef<{ x: number; y: number } | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<BoardNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  /** New videos share the last shape chosen here for as long as this canvas is open. */
  const lastVideoRatio = React.useRef<string | undefined>(undefined);
  const [ready, setReady] = React.useState(false);
  /* the board is seen once it is fitted to what is on it: never first drawn close up and then pulled out to all of it */
  const [fitted, setFitted] = React.useState(false);
  /* Warming may lay out overlapping nodes, but must not save that layout before the board is ever opened. */
  const opened = React.useRef(shown);
  React.useEffect(() => { if (shown) opened.current = true; }, [shown]);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [menu, setMenu] = React.useState<MenuAt | null>(null);
  const [context, setContext] = React.useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  /** a wire clicked: where, so a button there cuts it */
  const [cutAt, setCutAt] = React.useState<{ id: string; x: number; y: number } | null>(null);
  /** the board's last press, for a double click on it */
  const boardPress = React.useRef<{ at: number; x: number; y: number } | null>(null);
  const [tool, setTool] = React.useState<'select' | 'hand'>('select');
  /* the nodes just added, which come in with a small pop (or, wired as they come, a fade, so the wire meets them where
     they stay), and the rings where the board was double-clicked */
  const [born, setBorn] = React.useState<ReadonlyMap<string, 'cv-born' | 'cv-born-fade' | 'cv-flash'>>(() => new Map());
  const [taps, setTaps] = React.useState<Array<{ id: number; x: number; y: number }>>([]);
  const [outline, setOutline] = React.useState(false);
  const [map, setMap] = React.useState(false);
  /* a node's references being picked on the board: the node they go into (its panel's "From the canvas") */
  const [picking, setPicking] = React.useState<string | null>(null);
  /* the wires drawn or not, and nodes kept to the grid as they move (the bottom left bar) */
  const [wires, setWires] = React.useState(true);
  const [snap, setSnap] = React.useState(false);
  const [viewing, setViewing] = React.useState<string | null>(null);
  /* which of the project's boards is shown (a link's ?canvas=, else the one shown last here), and how */
  const [boards, setBoards] = React.useState<CanvasBoard[]>([{ id: MAIN_BOARD, nodes: 0 }]);
  const [boardId, setBoardId] = React.useState(() => new URLSearchParams(window.location.search).get('canvas') ?? lastBoard(projectId));
  /* a window over the board: what was made, the characters, the styles, the effects */
  const [modal, setModal] = React.useState<null | 'history' | 'characters' | 'styles' | 'effects'>(null);
  /* a picture being changed in part: the node it is on and its file */
  const [redraw, setRedraw] = React.useState<{ id: string; path: string; start?: RedrawStart } | null>(null);
  /* a picture's own tool open over the board */
  const [pictureTool, setPictureTool] = React.useState<{ id: string; path: string; tool: PictureTool } | null>(null);
  /** a clip whose part to keep is being picked */
  const [trimming, setTrimming] = React.useState<{ id: string; path: string } | null>(null);
  /** a clip tool done by a model, open over the board for a clip */
  const [clipAI, setClipAI] = React.useState<{ id: string; path: string; tool: ClipToolKey } | null>(null);
  /* a cut-out asked for while nothing here cuts out: what to do once the way to cut out is there */
  /* the node whose camera is being picked */
  const [cameraFor, setCameraFor] = React.useState<string | null>(null);
  const [cutoutThen, setCutoutThen] = React.useState<{ run: () => void; cancel?: () => void } | null>(null);
  /* the node a library was opened for (its panel's chip): what is picked goes into it */
  const [modalFor, setModalFor] = React.useState<string | null>(null);
  const openLibrary = (which: 'characters' | 'styles' | 'effects', node?: string) => { setModalFor(node ?? null); setModal(which); };
  const boardRef = React.useRef(boardId);
  boardRef.current = boardId;
  const switchingBoards = React.useRef(false);
  const saved = React.useRef('');
  const rootRef = React.useRef<HTMLDivElement>(null);
  const lastViewSize = React.useRef<{ board: string; width: number; height: number } | null>(null);
  /* A dock can shrink or move the canvas. Keep the same world point in its center, without refitting or touching nodes. */
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !fitted) return;
    const resize = () => {
      const width = root.clientWidth, height = root.clientHeight, previous = lastViewSize.current;
      if (!width || !height) return;
      if (shown && previous?.board === boardId && (width !== previous.width || height !== previous.height)) {
        const view = flow.getViewport();
        void flow.setViewport({ ...view, x:view.x+(width-previous.width)/2, y:view.y+(height-previous.height)/2 }, { duration:0 });
      }
      if (shown || previous?.board !== boardId) lastViewSize.current = { board:boardId,width,height };
    };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(root);
    return () => observer.disconnect();
  }, [fitted,shown,boardId]);
  /* ⌘ with the wheel zooms round the pointer wherever the keys are being typed: React Flow hears of ⌘ only from a
     keydown reaching the document, which a composer being typed in keeps to itself, and it would pan instead */
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const wheel = (event: WheelEvent) => {
      if (!event.metaKey || event.ctrlKey || (event.target as Element).closest('.nowheel')) return;
      const pane = root.querySelector('.react-flow')?.getBoundingClientRect();
      if (!pane) return;
      event.preventDefault();
      event.stopPropagation();
      const { x, y, zoom } = flow.getViewport();
      const { minZoom, maxZoom } = flowStore.getState();
      const step = event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002;
      const next = Math.min(maxZoom, Math.max(minZoom, zoom * 2 ** (-event.deltaY * step)));
      const px = event.clientX - pane.left, py = event.clientY - pane.top;
      void flow.setViewport({ x: px - ((px - x) * next) / zoom, y: py - ((py - y) * next) / zoom, zoom: next }, { duration: 0 });
    };
    root.addEventListener('wheel', wheel, { capture: true, passive: false });
    return () => root.removeEventListener('wheel', wheel, { capture: true });
  }, [flow, flowStore]);
  const pickerRef = React.useRef<HTMLInputElement>(null);
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
  const editVersion = React.useRef(0);
  const willChange = React.useCallback(() => { editVersion.current++; history.current = remember(history.current, docNow()); }, []);
  const step = (back: boolean) => {
    const moved = (back ? undo : redo)(history.current, docNow());
    if (!moved) return;
    history.current = moved.history;
    show(moved.doc);
  };

  /* the project's boards; one gone (deleted elsewhere): the first */
  const loadBoards = React.useCallback(() => api.canvasBoards(projectId).then((list) => {
    setBoards(list);
    if (!list.some((b) => b.id === boardRef.current)) { setReady(false); setBoardId(MAIN_BOARD); }
    return list;
  }, () => boards), [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void loadBoards(); }, [loadBoards]);
  /* another board shown: this one written first if it has a change not yet kept */
  const showBoard = async (id: string) => {
    if (id === boardRef.current || switchingBoards.current) return;
    switchingBoards.current = true;
    const doc = docNow();
    if (ready && canvasKey(doc) !== saved.current) await api.putCanvas(projectId, doc, boardRef.current).catch(() => {});
    setReady(false);
    setEditing(null);
    setBoardId(id);
    keepLastBoard(projectId, id);
    switchingBoards.current = false;
  };
  const addBoard = async (from?: string) => {
    try {
      const list = await loadBoards();
      const name = from ? t('canvas.boards.copyName').replace('{name}', boardName(list, from, t)) : nextBoardName(list, t);
      if (from === boardRef.current) await api.putCanvas(projectId, docNow(), from).catch(() => {});
      const made = await api.newCanvasBoard(projectId, { name, ...(from ? { from } : {}) });
      await loadBoards();
      await showBoard(made.id);
      onNotice(t(from ? 'canvas.boards.copied' : 'canvas.boards.added'));
      return made.id;
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); return null; }
  };
  const renameBoard = (id: string, name: string) => {
    void api.renameCanvasBoard(projectId, id, name).then(() => loadBoards(), (e: unknown) => onError(e instanceof Error ? e.message : String(e)));
  };
  const removeBoard = async (id: string) => {
    try {
      /* the one shown: written first, so what goes into the trash is all of it */
      if (id === boardRef.current) await api.putCanvas(projectId, docNow(), id).catch(() => {});
      const list = await api.removeCanvasBoard(projectId, id);
      setBoards(list);
      /* the first one deleted: the next one is the first now, under its id */
      const shownNow = boardRef.current;
      if (id === shownNow || !list.some((b) => b.id === shownNow)) {
        setReady(false);
        keepLastBoard(projectId, MAIN_BOARD);
        if (shownNow === MAIN_BOARD) reloadBoard.current(); else setBoardId(MAIN_BOARD);
      }
      onNotice(t('canvas.boards.removed'));
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  const reloadBoard = React.useRef(() => {});

  /* Read once a board is mounted (possibly in the background), fitted before it is shown. */
  const [loads, setLoads] = React.useState(0);
  const pendingBoard = React.useRef<{ key:string; promise:ReturnType<typeof api.canvas> } | null>(null);
  reloadBoard.current = () => setLoads((n) => n + 1);
  React.useEffect(() => {
    let live = true;
    const version = editVersion.current;
    setFitted(false);
    const key = `${projectId}/${boardId}/${loads}`;
    /* StrictMode replays setup before the first request resolves. Reuse only that in-flight read, never a stale board. */
    if (pendingBoard.current?.key !== key) {
      const request = { key,promise:api.canvas(projectId,boardId) };
      pendingBoard.current = request;
      const settled = () => { if (pendingBoard.current === request) pendingBoard.current = null; };
      void request.promise.then(settled,settled);
    }
    void pendingBoard.current.promise.then((raw) => {
      if (!live) return;
      const doc = readCanvasDoc(raw);
      saved.current = canvasKey(doc);
      history.current = emptyHistory();
      show(doc);
      setReady(true);
      /* once the cards are measured: every group round what is in it (a board an agent laid out loosely), then all in view */
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!live) return;
        setNodes((list) => {
          const fitted = fitGroups(list);
          /* Fitting the display is not a document edit. Keep it as the comparison baseline until the person changes something. */
          if (editVersion.current === version) saved.current = canvasKey(fromFlow(fitted,now.current.edges));
          return fitted;
        });
        /* An empty board has nothing to fit. Populated boards wait for the actual measured fit, not a timer. */
        const seen = () => { if (live) setFitted(true); };
        if (!doc.nodes.length) seen();
        else void flow.fitView({ padding: 0.2, maxZoom: 1 }).then(seen, seen);
      }));
    }, (e: unknown) => {
      if (!live) return;
      setFitted(true);
      /* a board that is not there (any more): the first */
      if (e instanceof ApiError && e.status === 404 && boardId !== MAIN_BOARD) { setBoardId(MAIN_BOARD); keepLastBoard(projectId, MAIN_BOARD); return; }
      setReady(true);
      onError(t('canvas.saveFailed').replace('{error}', e instanceof Error ? e.message : String(e)));
    });
    return () => { live = false; };
  }, [projectId, boardId, loads]); // eslint-disable-line react-hooks/exhaustive-deps

  /* what an agent changed (`openfilm canvas apply`) comes onto the board at once, and ⌘Z takes it back as any change */
  React.useEffect(() => projectEvents(projectId, (event) => {
    if (event.type !== 'canvas') return;
    if (event.reset) {
      history.current = emptyHistory();
      void loadBoards();
    }
    void api.canvas(projectId, boardRef.current).then((raw) => {
      const doc = readCanvasDoc(raw);
      const key = canvasKey(doc);
      saved.current = key;
      if (key === canvasKey(docNow())) return;
      if (!event.reset) willChange();
      const before = new Set(now.current.nodes.map((n) => n.id));
      show(doc, selectedIds());
      /* what it added, brought into view */
      const added = doc.nodes.filter((n) => !before.has(n.id) && !n.parent).map((n) => ({ id: n.id }));
      if (added.length && !event.reset) requestAnimationFrame(() => requestAnimationFrame(() => { void flow.fitView({ nodes: added, padding: 0.15, maxZoom: 1, duration: 300 }); }));
    }, () => {});
  }), [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* written a moment after the last change that says something new (a selection says nothing) */
  React.useEffect(() => {
    if (!ready || !opened.current || nodes.some((node) => node.resizing)) return undefined;
    const doc = fromFlow(nodes, edges);
    const key = canvasKey(doc);
    if (key === saved.current) return undefined;
    const write = setTimeout(() => {
      void api.putCanvas(projectId, doc, boardId).then(() => { saved.current = key; },
        (e: unknown) => onError(t('canvas.saveFailed').replace('{error}', e instanceof Error ? e.message : String(e))));
    }, SAVE_AFTER_MS);
    return () => clearTimeout(write);
  }, [nodes, edges, ready, projectId, boardId, shown]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const add = (doc: CanvasDoc, select = true) => {
    willChange();
    const current = docNow();
    /* a copy out of a group that is gone since lands on the board itself */
    const groups = new Set([...current.nodes, ...doc.nodes].filter((n) => n.group != null).map((n) => n.id));
    const layer = nextCardLayer(now.current.nodes);
    const added = doc.nodes.map(({ parent, ...node }) => ({
      ...node,
      ...(parent && groups.has(parent) ? { parent } : {}),
      ...(node.z ? { z: node.z + layer } : {}),
    }));
    show({ nodes: [...current.nodes, ...added], edges: [...current.edges, ...doc.edges] }, select ? new Set(added.map((n) => n.id)) : undefined);
  };
  const copy = () => {
    const ids = selectedIds();
    if (!ids.size) return false;
    clipboard = { doc: copyOf(docNow(), ids, { x: 0, y: 0 }), pasted: 0 };
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
    if (ids.size) add(copyOf(docNow(), ids, { x: PASTE_STEP, y: PASTE_STEP }));
  };
  /** the selected nodes not in a group, in a new group round them */
  const group = () => {
    const byId = new Map(now.current.nodes.map((n) => [n.id, n]));
    const picked = now.current.nodes.filter((n) => n.selected && !n.parentId && n.type !== 'frame');
    if (!picked.length) return;
    willChange();
    const box = picked.reduce((b, n) => {
      const at = boxOf(n, byId);
      return { x0: Math.min(b.x0, at.x), y0: Math.min(b.y0, at.y), x1: Math.max(b.x1, at.x + at.w), y1: Math.max(b.y1, at.y + at.h) };
    }, { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    const id = canvasId('n');
    const origin = { x: box.x0 - GROUP_PAD, y: box.y0 - GROUP_PAD - GROUP_HEAD / 2 };
    const frame: FrameNode = {
      id, type: 'frame', position: origin, zIndex: -1, selected: true, ...GROUP_HELD,
      width: box.x1 - box.x0 + 2 * GROUP_PAD, height: box.y1 - box.y0 + 2 * GROUP_PAD + GROUP_HEAD / 2,
      data: { label: `${t('canvas.group')} ${now.current.nodes.filter((n) => n.type === 'frame').length + 1}`, color: 'gray' },
    };
    const inIt = new Set(picked.map((n) => n.id));
    setEdges(unselectEdges);
    setNodes((list) => [frame, ...list.map((n) => (inIt.has(n.id)
      ? { ...n, selected: false, parentId: id, position: { x: n.position.x - origin.x, y: n.position.y - origin.y } }
      : { ...n, selected: false }))] as BoardNode[]);
  };
  /** the selected groups gone, what was in them left where it is */
  const ungroup = (only?: string) => {
    const frames = now.current.nodes.filter((n) => (only ? n.id === only : n.selected) && n.type === 'frame');
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
  /** a node selected alone and brought into view */
  const showNode = (id: string) => {
    setNodes((list) => list.map((n) => ({ ...n, selected: n.id === id })));
    requestAnimationFrame(() => { void flow.fitView({ nodes: [{ id }], padding: 0.6, maxZoom: 1, duration: 250 }); });
  };

  const byPath = React.useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  /** the project's files as they are now (a file just made reaches the list a moment later) */
  const filesNow = React.useRef(byPath);
  filesNow.current = byPath;
  const listed = async (path: string) => { for (let i = 0; i < 50 && !filesNow.current.has(path); i++) await new Promise((done) => setTimeout(done, 200)); };
  const mediaOf = React.useCallback<MediaOf>((path) => {
    const kind = byPath.get(path)?.kind;
    return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : null;
  }, [byPath]);

  /* ── adding: beside a node, joined to it, or where the menu opened ── */
  /** where something `w` wide goes beside a node: right of it (made from it) or left (going into it), clear of the rest */
  const spotBeside = (id: string, side: Side, w: number) => {
    const byId = new Map(now.current.nodes.map((n) => [n.id, n]));
    const node = byId.get(id);
    if (!node) return { x: 0, y: 0 };
    const b = boxOf(node, byId);
    const x = side === 'source' ? b.x + b.w + BESIDE : b.x - w - BESIDE;
    const others = now.current.nodes.filter((n) => n.type !== 'frame' && n.id !== id).map((n) => boxOf(n, byId));
    const hits = (y: number) => others.some((o) => x < o.x + o.w && x + w > o.x && y < o.y + o.h + 40 && y + 220 > o.y);
    let y = b.y;
    for (let i = 0; i < 60 && hits(y); i++) y += 48;
    return { x, y };
  };
  const place = (node: BoardNode, from?: MenuAt['from'], wireDrop?: boolean) => {
    willChange();
    setBorn((ids) => new Map(ids).set(node.id, from ? 'cv-born-fade' : 'cv-born'));
    window.setTimeout(() => {
      setBorn((ids) => { const next = new Map(ids); next.delete(node.id); return next; });
      /* its handles were measured while it was still growing: measured again, as it stays */
      updateNodeInternals(node.id);
    }, 400);
    /* off the screen: the board moves to it, as far zoomed as it is */
    if (!wireDrop) requestAnimationFrame(() => requestAnimationFrame(() => {
      const box = rootRef.current?.getBoundingClientRect();
      const at = flow.flowToScreenPosition(node.position);
      const zoom = flow.getZoom();
      const w = (node.width ?? FILE_W) * zoom;
      if (box && (at.x < box.left || at.y < box.top || at.x + w > box.right || at.y + 200 * zoom > box.bottom - 80)) {
        void flow.fitView({ nodes: [{ id: node.id }], padding: 0.4, minZoom: zoom, maxZoom: zoom, duration: 250 });
      }
    }));
    setNodes((list) => [...list.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]);
    setEdges(unselectEdges);
    if (from) {
      const [source, target] = from.side === 'source' ? [from.node, node.id] : [node.id, from.node];
      setEdges((list) => [...list, { id: canvasId('e'), source, target, data: { order: nextOrder(docNow(), target) } }]);
    }
  };
  const addKind = (kind: SpawnKind, placement: NodePlacement) => {
    const id = canvasId('n');
    const w = WIDE[kind];
    if (kind === 'note') {
      /* new, it is square and says what it can start as; written in, it is a box of words */
      place({ id, type: 'note', position: topLeft(placement, w, CARD_H), width: w, height: CARD_H, data: { text: '' } }, placement.from, placement.wire);
    } else if (kind === 'cut') {
      place({ id, type: 'cut', position: topLeft(placement, w, CARD_H), width: w, height: CARD_H, data: {} }, placement.from, placement.wire);
    } else {
      /* a new picture is square, and made square until another shape is asked */
      const ratio = kind === 'video' ? lastVideoRatio.current : kind === 'image' ? '1:1' : undefined;
      const size = makeSize(kind, ratio);
      /* made with the model last picked for its kind, while it is still there */
      const last = lastModel(kind);
      const model = last && choicesFor(providers, kind).some((c) => c.via === last.via && c.model === last.model) ? last : null;
      place({ id, type: 'make', position: topLeft(placement, size.w, size.h), width: size.w, height: size.h, data: { make: kind, prompt: '', ...(model ?? {}), ...(ratio ? { opts: { ratio } } : {}) } }, placement.from, placement.wire);
    }
    return id;
  };
  /** a node's name as its name row shows it */
  const nameOfNode = (n: BoardNode): string => {
    const nth = () => String(numberOf(now.current.nodes, n.id));
    if (n.type === 'note') return n.data.title ?? t('canvas.titles.note').replace('{n}', nth());
    if (n.type === 'make') return n.data.title ?? (n.data.preset ? t(`canvas.presets.names.${n.data.preset}`) : t(`canvas.titles.${n.data.make}`).replace('{n}', nth()));
    if (n.type === 'file') return n.data.title ?? (byPath.get(n.data.path)?.name ?? n.data.path.split('/').pop() ?? n.data.path).replace(/\.[^.]+$/, '');
    if (n.type === 'frame') return n.data.label || t('canvas.group');
    return t('canvas.titles.cut').replace('{n}', nth());
  };
  /**
   * The name of what a tool makes from a node: its name, `_`, what the tool did ("Picture 1_Expand"); a number after
   * it when that name is taken ("Picture 1_Expand 2").
   */
  const nameFrom = (sourceId: string, tool: string) => {
    const source = now.current.nodes.find((n) => n.id === sourceId);
    const base = `${source ? nameOfNode(source) : ''}_${tool}`;
    const taken = new Set(now.current.nodes.map((n) => nameOfNode(n)));
    if (!taken.has(base)) return base;
    for (let k = 2; ; k++) if (!taken.has(`${base} ${k}`)) return `${base} ${k}`;
  };
  /**
   * What the canvas makes on its way to a picture (a mask, the marks, a picture framed for widening) kept out of the
   * person's files: in `assets/.canvas`, which the library never lists, where a model can still read it.
   */
  const keepWork = async (blob: Blob, name: string) => (await onImportFiles([new File([blob], name, { type: 'image/png' })], undefined, WORK))[0];
  /** a file made only on the way (a subject cut out to select, a picture before it was cut to size): into the trash */
  const dropWork = (path: string) => { void api.removeFile(projectId, path).catch(() => {}); };
  const addFile = (path: string, placement: NodePlacement, size?: { w: number; h: number }, title?: string) => {
    const width = size?.w ?? (placement.wire ? fileCardWidth(byPath.get(path)) : FILE_W);
    place({ id: canvasId('n'), type: 'file', position: topLeft(placement, width, size?.h ?? CARD_H), data: { path, ...(title ? { title } : {}) }, ...(size ? { width: size.w, height: size.h } : {}) }, placement.from, placement.wire);
  };
  const openMenu = (clientX: number, clientY: number, from?: MenuAt['from']) => {
    setContext(null);
    const screen = { x: clientX, y: clientY };
    const at = flow.screenToFlowPosition(screen, from ? { snapToGrid: false } : undefined);
    setMenu({ screen, at, ...(from ? { from, wire: true } : {}) });
  };
  /** the board's middle, as a point on it */
  const middle = () => {
    const box = rootRef.current!.getBoundingClientRect();
    return flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
  };

  const addedRequest = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!shown || !ready || !addFiles || addedRequest.current === addFiles.n) return;
    addedRequest.current = addFiles.n;
    const at = middle();
    for (const [i,path] of addFiles.paths.entries()) addFile(path, { at: { x: at.x + i * (FILE_W + 24), y: at.y } });
  }, [shown, ready, addFiles?.n]);

  /** The picker hands off local files immediately so each caller can show what is being imported. */
  const pickLocalFiles = (accept: string) => new Promise<File[]>((done) => {
    const input = pickerRef.current;
    if (!input) { done([]); return; }
    input.accept = accept;
    input.value = '';
    input.onchange = () => done([...(input.files ?? [])]);
    input.oncancel = () => done([]);
    input.click();
  });
  const pickFiles = async (accept: string) => {
    const list = await pickLocalFiles(accept);
    if (!list.length) return [];
    try { return await onImportFiles(list); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); return []; }
  };

  /* Uploads stay outside the document until their paths are available in the media listing. */
  const [uploads, setUploads] = React.useState<PendingUpload[]>([]);
  const activeUploads = React.useMemo(() => uploads.filter((upload) => upload.board === boardId), [uploads, boardId]);
  const uploadFiles = (list: File[], { at, from, corner, wire, version, wireFirstOnly }: UploadTarget) => {
    if (!list.length || boardRef.current !== boardId) return;
    const batch = list.map((file, i): PendingUpload => {
      const placement = { at: { x: at.x + i * (FILE_W + 24) * (from?.side === 'target' ? -1 : 1), y: at.y }, from, corner, wire };
      return {
        id: canvasId('n'), board: boardId, name: file.name, kind: resourceKindOf(file.name), progress: -1,
        position: topLeft(placement, FILE_W, CARD_H),
        ...(wire ? { wireDrop: placement } : {}),
        ...(from && (!i || !wireFirstOnly) ? { from } : {}),
        ...(version ? { version } : {}),
      };
    });
    const ids = new Set(batch.map((upload) => upload.id));
    setUploads((previous) => [...previous, ...batch]);
    const progress: ImportProgress = (i, ratio, path) => {
      const upload = batch[i];
      if (upload) setUploads((previous) => previous.map((item) => item.id === upload.id ? { ...item, progress: ratio, path } : item));
    };
    void onImportFiles(list, progress).catch((error: unknown) => {
      onError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      setUploads((previous) => previous.filter((item) => item.path || !ids.has(item.id)));
    });
  };
  const pickUpload = async (placement: NodePlacement) => {
    uploadFiles(await pickLocalFiles(ACCEPT.media), placement);
  };

  const drawnNodes = React.useMemo(() => {
    const defaultLayer = nextCardLayer(nodes);
    /* a group picked or held is on top while it is, with what is in it, as a card is while held */
    const lifted = new Set(nodes.filter((node) => node.type === 'frame' && (node.selected || node.dragging)).map((node) => node.id));
    return [
      ...nodes.map((node) => node.type === 'frame' ? { ...node, zIndex: (node.zIndex ?? -1) + (lifted.has(node.id) ? defaultLayer * 2 : 0) } : {
        ...node, zIndex: (node.zIndex ?? defaultLayer) + (node.dragging || (node.parentId && lifted.has(node.parentId)) ? defaultLayer * 2 : 0),
        ...(born.has(node.id) ? { className: `${node.className ?? ''} ${born.get(node.id)}` } : {}),
      }),
      ...activeUploads.filter((upload) => !upload.version).map((upload): FileNode => ({
        id: upload.id, type: 'file', position: upload.position, width: FILE_W, height: CARD_H, zIndex: defaultLayer,
        selectable: false, draggable: false, connectable: false, focusable: false,
        style: { pointerEvents: 'none' },
        data: { path: '', upload },
      })),
    ];
  }, [nodes, activeUploads, born]);

  React.useEffect(() => {
    if (!ready || switchingBoards.current) return;
    const landed = activeUploads.flatMap((upload) => {
      const file = upload.path ? byPath.get(upload.path) : undefined;
      return file ? [{ upload, file }] : [];
    });
    if (!landed.length) return;
    const finished = new Set(landed.map(({ upload }) => upload.id));
    const existing = new Set(now.current.nodes.map((n) => n.id));
    const added: FileNode[] = [];
    const wires: Edge[] = [];
    const versions = new Map<string, string[]>();
    for (const { upload, file } of landed) {
      if (upload.version) {
        if (existing.has(upload.version)) versions.set(upload.version, [...(versions.get(upload.version) ?? []), file.path]);
        continue;
      }
      added.push({
        id: upload.id, type: 'file', data: { path: file.path },
        position: upload.wireDrop && file.kind !== 'video' ? topLeft(upload.wireDrop, fileCardWidth(file), CARD_H) : upload.position,
        ...(file.kind === 'video' ? { width: FILE_W, height: CARD_H } : {}),
      });
      const from = upload.from;
      if (from && existing.has(from.node)) {
        const [source, target] = from.side === 'source' ? [from.node, upload.id] : [upload.id, from.node];
        wires.push({ id: canvasId('e'), source, target });
      }
    }
    setUploads((previous) => previous.filter((upload) => !finished.has(upload.id)));
    if (!added.length && !versions.size) return;
    willChange();
    setNodes((previous) => [
      ...previous.map((node) => {
        const paths = versions.get(node.id);
        return node.type === 'make' && paths ? { ...node, data: paths.reduce((data, path) => withVersion(data, { path, made: '' }), node.data) } : node;
      }),
      ...added,
    ]);
    if (wires.length) setEdges((previous) => {
      const doc = fromFlow(now.current.nodes, previous);
      const next = wires.map((wire) => {
        const order = nextOrder(doc, wire.target);
        doc.edges.push({ id: wire.id, from: wire.source, to: wire.target, order });
        return { ...wire, data: { order } };
      });
      return [...previous, ...next];
    });
  }, [ready, activeUploads, byPath, setNodes, setEdges, willChange]);

  /* ── making ── */
  const providers = useProviders().state;
  const libraryVoices = useLibraryVoices();
  const language = useLanguage();
  const runsSeen = useRuns();
  /** the making nodes whose inputs changed since they last made one (said on them), and what is wired into each that it cannot use */
  const making = React.useMemo(() => {
    const stale = new Set<string>();
    const unused = new Map<string, number>();
    if (!nodes.some((n) => n.type === 'make')) return { stale, unused };
    const doc = fromFlow(nodes, edges);
    for (const n of doc.nodes) {
      if (!n.make) continue;
      const inputs = inputsOf(doc, n.id, mediaOf);
      if (inputsChanged(n, inputs)) stale.add(n.id);
      const left = makeRequest(n as MakingNode, inputs, '', choiceOf(providers, n.make, n.via, n.model)?.spec).unused;
      if (left) unused.set(n.id, left);
    }
    return { stale, unused };
  }, [nodes, edges, mediaOf, providers]);
  const makeNow = (id: string): Promise<boolean> => {
    const doc = docNow();
    const node = doc.nodes.find((n) => n.id === id);
    if (!node?.make || !folder) return Promise.resolve(false);
    const fail = (key: string) => { runErrors.set(`${projectId}/${id}`, t(key)); runsChanged(); return Promise.resolve(false); };
    /* what is wired in is used, so nothing wired in is left out unsaid: words still to write, a node still to make */
    const wired = doc.edges.filter((e) => e.to === id).map((e) => doc.nodes.find((n) => n.id === e.from));
    if (wired.some((n) => n && n.text != null && n.group == null && !n.text.trim())) return fail('canvas.make.emptyNote');
    if (wired.some((n) => n?.make && !n.path)) return fail('canvas.make.unmadeInput');
    const inputs = inputsOf(doc, id, mediaOf);
    /* a cut-out: the first picture wired in, its background taken out by what cuts out here (Settings: Local services,
       or another service); nothing does yet: the way to have it, then made */
    if (node.preset === 'cutout') {
      const picture = inputs.find((i) => 'media' in i && i.media === 'image');
      if (!picture || !('path' in picture)) return fail('canvas.makeNeeds.refs');
      if (!providers?.use.cutout) { setCutoutThen({ run: () => { void makeNow(id); } }); return Promise.resolve(false); }
      return startRun(projectId, folder, id, { verb: 'cutout', args: { src: picture.path, out: makeName(node as MakingNode) } }, {}, inputsKey(node, inputs),
        { nothing: t('canvas.make.nothing'), balance: t('canvas.make.noBalance') }, boardId);
    }
    const choice = choiceOf(providers, node.make, node.via, node.model);
    const spec = choice?.spec;
    /* widened: the picture wired in, placed in the shape it is made at as the mask's name says, sent with the mask;
       what comes back cut to the canvas set */
    if (node.preset === 'expand') {
      const picture = inputs.find((i) => 'media' in i && i.media === 'image');
      const plan = expandPlan(node.opts?.mask);
      if (!picture || !('path' in picture)) return fail('canvas.makeNeeds.refs');
      if (!plan || !node.opts?.mask) return fail('canvas.make.nothing');
      const mask = node.opts.mask;
      return (async () => {
        try {
          const framed = await framedPicture(srcOf(picture.path), srcOf(mask), plan.place);
          const held = await keepWork(framed, `expand-${Date.now().toString(36)}.png`);
          if (!held) return false;
          const asked = { ...node, prompt: [EXPAND_ASK, node.prompt?.trim()].filter(Boolean).join('\n\n') } as MakingNode;
          const request = makeRequest(asked, [{ from: picture.from, path: held, media: 'image' }], makeName(node as MakingNode), spec);
          const pick = node.via ? { via: node.via, ...(node.model ? { model: node.model } : {}) } : {};
          const ok = await startRun(projectId, folder, id, request, pick, inputsKey(node, inputs), { nothing: t('canvas.make.nothing'), balance: t('canvas.make.noBalance') }, boardId);
          if (ok) await cropMade(id, plan.crop).catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
          /* made again from the picture and the mask each time: the framed picture was only for this run */
          dropWork(held);
          return ok;
        } catch (e) { runErrors.set(`${projectId}/${id}`, e instanceof Error ? e.message : String(e)); runsChanged(); return false; }
      })();
    }
    /* a subject named with @ in its words: said as the reference picture it is (its picture wired in, named for it) */
    /* what is named with @ (a subject, a picture or clip wired in, by its name): said as the reference it is, by its
       place among the pictures or clips wired in; the longest names first, so "Picture 1_Expand" is not read as "Picture 1" */
    if (node.prompt?.includes('@')) {
      const named = (['image', 'video'] as const).flatMap((media) => inputs.filter((i) => 'media' in i && i.media === media)
        .map((input, k) => ({ name: (() => { const n = now.current.nodes.find((x) => x.id === input.from); return n ? nameOfNode(n) : ''; })(), as: media === 'image' ? `reference picture ${k + 1}` : `reference clip ${k + 1}` })))
        .filter((x) => x.name).sort((a, b) => b.name.length - a.name.length);
      for (const { name, as } of named) node.prompt = node.prompt!.split(`@${name}`).join(`${name} (${as})`);
    }
    /* a clip made from frames or references: they are there first */
    if (node.make === 'video') {
      const pictures = inputs.filter((i) => 'media' in i && i.media === 'image').length;
      const clip = inputs.some((i) => 'media' in i && i.media === 'video');
      const sound = inputs.some((i) => 'media' in i && i.media === 'audio');
      const way = modeOf(node.opts, spec, pictures, clip, sound);
      if (way === 'first' && pictures < 1) return fail('canvas.makeNeeds.first');
      if (way === 'firstLast' && pictures < 2) return fail('canvas.makeNeeds.firstLast');
      if (way === 'refs' && pictures < 1) return fail('canvas.makeNeeds.refs');
      if (way === 'omni' && !(pictures > 0 && spec?.refs !== 0)
        && !(clip && spec?.clip) && !(sound && spec?.voice && !spec.voiceNeedsVisual)) return fail('canvas.makeNeeds.omni');
      /* from a first frame: its shape, unless one was picked */
      const first = inputs.find((i) => 'media' in i && i.media === 'image');
      const frame = first && 'path' in first ? byPath.get(first.path) : undefined;
      if ((way === 'first' || way === 'firstLast') && !node.opts?.ratio && frame) {
        const shape = frameRatio(frame.w, frame.h, spec);
        if (shape) node.opts = { ...node.opts, ratio: shape };
      }
    }
    /* a voice-over in the voice picked, else in its service's first voice in the person's language */
    if (node.make === 'tts' && !node.opts?.voice) {
      const voice = defaultVoice(voicesOf(libraryVoices, serviceOf(choice)), language);
      if (!voice) return fail('canvas.make.noVoice');
      node.opts = { ...node.opts, voice: voice.id };
    }
    const request = makeRequest(node as MakingNode, inputs, makeName(node as MakingNode), spec);
    if (!String(request.args.prompt ?? request.args.text).trim()) { runErrors.set(`${projectId}/${id}`, t('canvas.make.noWords')); runsChanged(); return Promise.resolve(false); }
    const pick = choice?.via === 'openfilm' ? {via:choice.via,...(choice.model ? {model:choice.model} : {})}
      : node.via ? { via: node.via, ...(node.model ? { model: node.model } : {}) } : {};
    const say = { nothing: t('canvas.make.nothing'), balance: t('canvas.make.noBalance') };
    const account = providers?.providers.find(provider=>provider.id==='openfilm');
    let resumed = false;
    const recovery = choice?.via === 'openfilm' ? {scope:JSON.stringify([account?.account ?? '',account?.last4 ?? '']),onResumed:()=>{resumed=true;}} : undefined;
    /* two or four at once: one after another, each a version of its own (a clip asked again is made anew) */
    const count = node.opts?.count ?? 1;
    /* how long it took, kept to measure the progress of the next run with this model */
    const timed = async (run: ReturnType<typeof makeRequest>) => {
      const started = Date.now();
      const ok = await startRun(projectId, folder, id, run, pick, inputsKey(node, inputs), say, boardId, recovery);
      if (ok && choice && !resumed) keepModelTime(choice.via, choice.model, (Date.now() - started) / 1000);
      return ok;
    };
    if (count < 2) return timed(request);
    return (async () => {
      let made = false;
      for (let i = 0; i < count; i++) {
        const again = i ? makeRequest(node as MakingNode, inputs, makeName(node as MakingNode), spec) : request;
        if (node.make === 'video') again.args.force = 'true';
        const ok = await timed(again);
        made ||= ok;
        if (!ok || resumed) break;
      }
      return made;
    })();
  };
  /** making as the board is now (a step that waits — for a file to be listed — makes with what it then knows) */
  const makeLatest = React.useRef(makeNow);
  makeLatest.current = makeNow;
  /**
   * Everything a group makes, in the order its wires say: what feeds another is made first, and what waits for it is
   * made after it, with it. What is made already and has not changed since is left (and so is what only it feeds); what
   * failed stops what it feeds.
   */
  const makeAll = async (groupId: string) => {
    const start = docNow();
    const members = start.nodes.filter((n) => n.parent === groupId && n.make).map((n) => n.id);
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
      const next = [...need].filter((id) => !done.has(id) && !failed.has(id) && feeds.get(id)!.every((f) => done.has(f)));
      if (!next.length) break;
      await Promise.all(next.map(async (id) => { (await makeNow(id) ? done : failed).add(id); }));
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
      const laid = copyOf(doc, new Set(doc.nodes.filter((n) => !n.parent).map((n) => n.id)), at);
      /* nothing picked: the first words left to write are open to write in */
      add(laid, false);
      const first = laid.nodes.filter((n) => n.group == null && !n.make && !n.cut && n.path == null && !n.text?.trim()).sort((a, b) => a.y - b.y || a.x - b.x)[0];
      if (first) setEditing(first.id);
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  /** a group kept as a template, by its name, with what is in it and the wires between them */
  /* a text node written by the person's agent: the words wired in (and its own, to rework) go with what they ask */
  /** the text nodes being written by the agent now (since when), and how each is stopped */
  const [writing, setWriting] = React.useState<ReadonlyMap<string, number>>(new Map());
  const writers = React.useRef(new Map<string, AbortController>());
  const write = async (id: string, ask: string, attachments: string[]): Promise<string | null> => {
    const inputs = edges.filter((e) => e.target === id).map((e) => nodes.find((n) => n.id === e.source))
      .flatMap((n) => (n?.type === 'note' && n.data.text.trim() ? [n.data.text] : []));
    const own = nodes.find((n) => n.id === id);
    const before = own?.type === 'note' ? own.data.text : '';
    const mine = before.trim();
    const stop = new AbortController();
    writers.current.set(id, stop);
    setWriting((ids) => new Map(ids).set(id, Date.now()));
    /* the words onto the card as the agent writes them, in place of what it said before; one undo takes them all back */
    const put = (data: Partial<NoteData>) => setNodes((all) => all.map((n) => (n.id === id && n.type === 'note' ? { ...n, data: { ...n.data, ...data } } : n)));
    let said = '';
    try {
      const model = studioHost?.canvasWriting?.selection();
      if (model === null) return t('canvas.write.noAgent');
      willChange();
      const { text } = await api.canvasWriteStream(projectId, ask, mine ? [...inputs, `(the node's words now, to rework) ${mine}`] : inputs, model, attachments, (delta) => {
        said += delta;
        put({ text: said.replace(/^\s+/, '') });
      }, stop.signal);
      /* written: what it said before kept as an earlier version */
      const kept = own?.type === 'note' ? own.data.versions ?? [] : [];
      put({ text: text || before, ...(text && mine ? { versions: [...kept.filter((v) => v !== before), before].slice(-20) } : {}) });
      return null;
    } catch (error) {
      /* stopped, or not written after all: its words as they were */
      if (said) put({ text: before });
      if (stop.signal.aborted) return null;
      if (error instanceof ApiError && error.body.code === 'no-agent') return t('canvas.write.noAgent');
      return error instanceof Error ? error.message : String(error);
    } finally {
      writers.current.delete(id);
      setWriting((ids) => { const next = new Map(ids); next.delete(id); return next; });
    }
  };
  /** a node flashed where it is; brought into view (the board's zoom kept) only when it is not all in sight */
  const locate = (id: string) => {
    const node = flow.getInternalNode(id);
    const pane = rootRef.current?.getBoundingClientRect();
    if (node && pane) {
      const { x, y } = node.internals.positionAbsolute;
      const a = flow.flowToScreenPosition({ x, y });
      const b = flow.flowToScreenPosition({ x: x + (node.measured.width ?? 0), y: y + (node.measured.height ?? 0) });
      const seen = a.x >= pane.left && a.y >= pane.top && b.x <= pane.right && b.y <= pane.bottom;
      if (!seen) void flow.fitView({ nodes: [{ id }], padding: 0.5, minZoom: flow.getZoom(), maxZoom: flow.getZoom(), duration: 300 });
    }
    setBorn((ids) => new Map(ids).set(id, 'cv-flash'));
    window.setTimeout(() => setBorn((ids) => { if (ids.get(id) !== 'cv-flash') return ids; const next = new Map(ids); next.delete(id); return next; }), 1400);
  };

  /* ── the libraries: a style or an effect onto the board, a character's pictures, a new character made ── */
  /** where something `w` × `h` goes clear of what is on the board: right of it all, level with its top (empty: the middle) */
  const clearSpot = (w: number, h: number) => {
    const byId = new Map(now.current.nodes.map((n) => [n.id, n]));
    const top = now.current.nodes.filter((n) => !n.parentId);
    if (!top.length) { const at = middle(); return { x: at.x - w / 2, y: at.y - h / 2 }; }
    const box = top.reduce((b, n) => { const at = boxOf(n, byId); return { x1: Math.max(b.x1, at.x + at.w), y0: Math.min(b.y0, at.y) }; }, { x1: -Infinity, y0: Infinity });
    return { x: box.x1 + 160, y: box.y0 };
  };
  /** where something `w` × `h` goes in view: its middle at `at` when that is clear of what is on the board, else the clear spot nearest it */
  const clearNear = (at: { x: number; y: number }, w: number, h: number) => {
    const byId = new Map(now.current.nodes.map((n) => [n.id, n]));
    const boxes = now.current.nodes.filter((n) => !n.parentId).map((n) => boxOf(n, byId));
    const clear = ({ x, y }: { x: number; y: number }) => boxes.every((b) => x + w + 48 <= b.x || x >= b.x + b.w + 48 || y + h + 64 <= b.y || y >= b.y + b.h + 64);
    const spots: Array<{ x: number; y: number }> = [];
    for (let i = -6; i <= 6; i++) for (let j = -4; j <= 4; j++) spots.push({ x: at.x - w / 2 + (i * (w + 48)) / 2, y: at.y - h / 2 + (j * (h + 64)) / 2 });
    /* along the row first: a step up or down counts twice */
    const far = (s: { x: number; y: number }) => Math.hypot(s.x + w / 2 - at.x, 2 * (s.y + h / 2 - at.y));
    return spots.sort((a, b) => far(a) - far(b)).find(clear) ?? clearSpot(w, h);
  };
  /** a text node of the style's or effect's words, wired into the node it was picked for (or in the middle) */
  const placeMaterial = (kind: 'styles' | 'effects', item: { id: string; words: string }) => {
    /* for a node that makes: kept on it (shown on its tool, said when it is made), not a note beside it */
    const into = modalFor ? now.current.nodes.find((n) => n.id === modalFor) : undefined;
    if (into?.type === 'make') {
      willChange();
      setNodes((list) => list.map((n) => (n.id === into.id && n.type === 'make' ? { ...n, data: { ...n.data, opts: { ...n.data.opts, [kind === 'styles' ? 'style' : 'effect']: item.id } } } : n)));
      return;
    }
    const text = `${t(`canvas.library.tag.${kind}`)} · ${t(`canvas.${kind}.names.${item.id}`)} — ${item.words}`;
    const target = modalFor && now.current.nodes.some((n) => n.id === modalFor) ? modalFor : null;
    const at = target ? spotBeside(target, 'target', NOTE_W) : middle();
    place({ id: canvasId('n'), type: 'note', position: target ? at : { x: at.x - NOTE_W / 2, y: at.y - NOTE_H / 2 }, width: NOTE_W, height: NOTE_H, data: { text } },
      target ? { node: target, side: 'target' } : undefined);
  };
  /**
   * A subject's pictures, copied into the project: into the node it was picked for (its main picture, named as the
   * subject is, so @its name in the node's words is that picture), or a group of them.
   */
  const useCharacter = async (character: CanvasCharacter, into: string | null = modalFor) => {
    try {
      const target = into && now.current.nodes.some((n) => n.id === into) ? into : null;
      /* already wired into it: nothing more */
      if (target && now.current.edges.some((e) => e.target === target && (now.current.nodes.find((n) => n.id === e.source)?.data as { title?: string } | undefined)?.title === character.name)) return;
      const used = await api.useCanvasCharacter(projectId, character.id);
      if (target) {
        const main = used.pictures.find((p) => p.role === 'face') ?? used.pictures.find((p) => p.role === 'body') ?? used.pictures[0];
        const shape: Record<string, string> = { face: '1:1', body: '9:16', expressions: '1:1', turnaround: '16:9' };
        const size = main ? { w: cardWidth(shape[main.role] ?? '1:1'), h: CARD_H } : null;
        if (main && size) addFile(main.path, { at: spotBeside(target, 'target', size.w), from: { node: target, side: 'target' }, corner: true }, size, used.name);
        return;
      }
      /* in a row, each its own shape (a portrait square, the full body tall, the turnaround wide) */
      const group = canvasId('n');
      const shape: Record<string, string> = { face: '1:1', body: '9:16', expressions: '1:1', turnaround: '16:9' };
      const widths = used.pictures.map((p) => cardWidth(shape[p.role] ?? '1:1'));
      const w = widths.reduce((sum, x) => sum + x, 0) + 40 * (widths.length - 1) + 2 * GROUP_PAD;
      const h = CARD_H + 2 * GROUP_PAD + GROUP_HEAD / 2;
      const at = clearSpot(w, h);
      let x = GROUP_PAD;
      add({
        nodes: [
          { id: group, x: at.x, y: at.y, w, h, group: used.name, color: 'gray' },
          ...used.pictures.map((p, i) => {
            const node = { id: canvasId('n'), parent: group, path: p.path, x, y: GROUP_PAD + GROUP_HEAD / 2, w: widths[i]!, h: CARD_H };
            x += widths[i]! + 40;
            return node;
          }),
        ],
        edges: [],
      });
      requestAnimationFrame(() => requestAnimationFrame(() => { void flow.fitView({ nodes: [{ id: group }], padding: 0.2, maxZoom: 1, duration: 300 }); }));
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  /**
   * A new character from a few words: a group named after them, the words wired into its portrait, and the portrait
   * into its full body, expressions and turnaround — all made at once, in that order. Once made, the group is kept as
   * a character from its bar.
   */
  const generateCharacter = (name: string, about: string, kind: SubjectKind = 'person') => {
    const group = canvasId('n');
    const note = canvasId('n');
    const parts = SUBJECT_PARTS[kind].map((part) => ({ ...part, id: canvasId('n'), size: makeSize('image', presetOf(part.preset)?.ratio) }));
    const gap = 60;
    const face = parts[0]!;
    const rest = parts.slice(1);
    const colW = Math.max(...rest.map((p) => p.size.w));
    const w = NOTE_W + face.size.w + colW + 2 * gap + 2 * GROUP_PAD;
    const restH = rest.reduce((sum, p) => sum + p.size.h, 0) + gap * (rest.length - 1);
    const h = Math.max(restH, face.size.h, NOTE_H) + 2 * GROUP_PAD + GROUP_HEAD / 2;
    const top = GROUP_PAD + GROUP_HEAD / 2;
    let y = top;
    const at = clearSpot(w, h);
    add({
      nodes: [
        { id: group, x: at.x, y: at.y, w, h, group: name, color: 'gray' },
        { id: note, parent: group, x: GROUP_PAD, y: top, w: NOTE_W, h: NOTE_H, text: about },
        { id: face.id, parent: group, x: GROUP_PAD + NOTE_W + gap, y: top, w: face.size.w, h: face.size.h, make: 'image', prompt: '', preset: face.preset, opts: { ratio: presetOf(face.preset)?.ratio, quality: 'high' } },
        ...rest.map((p) => {
          const node = { id: p.id, parent: group, x: GROUP_PAD + NOTE_W + face.size.w + 2 * gap, y, w: p.size.w, h: p.size.h, make: 'image' as const, prompt: '', preset: p.preset, opts: { ratio: presetOf(p.preset)?.ratio, quality: 'high' } };
          y += p.size.h + gap;
          return node;
        }),
      ],
      edges: [
        { id: canvasId('e'), from: note, to: face.id, order: 0 },
        ...rest.flatMap((p) => [{ id: canvasId('e'), from: note, to: p.id, order: 0 }, { id: canvasId('e'), from: face.id, to: p.id, order: 1 }]),
      ],
    });
    requestAnimationFrame(() => requestAnimationFrame(() => { void flow.fitView({ nodes: [{ id: group }], padding: 0.15, maxZoom: 1, duration: 300 }); void makeAll(group); }));
  };
  /* the connected models that redraw part of a picture; the one picked first: the picture's own node's model, else the
     last picture model used, when it redraws so */
  const redrawModels = choicesFor(providers, 'image').filter((c) => c.spec?.refs !== 0);
  const keyOfChoice = (c: { via: string; model?: string }) => `${c.via}/${c.model ?? ''}`;
  const redrawFirst = (id: string) => {
    const own = now.current.nodes.find((n) => n.id === id);
    const mine = own?.type === 'make' && own.data.via ? { via: own.data.via, model: own.data.model } : null;
    const last = lastModel('image');
    return [mine, last].map((c) => (c ? keyOfChoice(c) : null)).find((k) => k && redrawModels.some((c) => keyOfChoice(c) === k)) ?? undefined;
  };
  /**
   * A picture changed in part: what was drawn kept in the project (a mask or a markup), and a new picture made from it
   * beside it, by a model that redraws so, at once.
   */
  const redrawMake = async ({ way, drawn, prompt, model, refs }: RedrawJob) => {
    const source = redraw;
    if (!source) return;
    const fits = (c: Choice) => (way === 'edit' ? c.spec?.refs !== 0 : Boolean(c.spec?.[way]));
    const choice = redrawModels.find((c) => keyOfChoice(c) === model && fits(c)) ?? redrawModels.find(fits);
    if (!choice) { onError(t('canvas.redraw.noModel')); return; }
    try {
      /* what was marked, kept in the project: the mask or the marks the model reads */
      const kept = drawn ? await keepWork(drawn, `${way}-${Date.now().toString(36)}.png`) : undefined;
      if (drawn && !kept) return;
      const picture = byPath.get(source.path);
      const ratio = picture?.w && picture.h ? ratioOf(`${picture.w}:${picture.h}`, choice.spec) : undefined;
      const size = makeSize('image', ratio);
      const id = canvasId('n');
      const at = spotBeside(source.id, 'source', size.w);
      /* the pictures to take from: under it, wired in after the picture it changes */
      const REF = 220;
      const held = refs.map((path, i) => ({ id: canvasId('n'), x: at.x + i * (REF + 20), y: at.y + size.h + 72, w: REF, h: REF, path }));
      add({
        nodes: [
          { id, x: at.x, y: at.y, w: size.w, h: size.h, make: 'image', title: nameFrom(source.id, t('canvas.names.redraw')), prompt, via: choice.via, ...(choice.model ? { model: choice.model } : {}),
            opts: { ...(ratio ? { ratio } : {}), ...(kept && way !== 'edit' ? { [way]: kept } : {}) } },
          ...held,
        ],
        edges: [{ id: canvasId('e'), from: source.id, to: id, order: 0 }, ...held.map((r, i) => ({ id: canvasId('e'), from: r.id, to: id, order: i + 1 }))],
      }, false);
      keepLastModel('image', { via: choice.via, ...(choice.model ? { model: choice.model } : {}) });
      setRedraw(null);
      requestAnimationFrame(() => requestAnimationFrame(() => { void makeNow(id); }));
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  /** the picture's subject cut out, for smart edit to select: by what cuts out here, once there is something that does */
  const subjectOf = (path: string) => new Promise<string>((resolve, reject) => {
    const picture = byPath.get(path);
    if (!folder || !picture) { reject(new Error(t('canvas.missing'))); return; }
    const go = () => {
      void api.make(folder, 'cutout', { src: path, out: `${picture.name.replace(/\.[^.]+$/, '')}-subject` }, {}).then((text) => {
        const receipt = receiptOf<{ src?: string; images?: Array<{ src?: string }> }>(text);
        const made = receipt.src ?? receipt.images?.[0]?.src;
        if (!made) throw new Error(t('canvas.make.nothing'));
        resolve(sources.file({ ...picture, path: made }));
        /* only to select by: gone once the editor has read it */
        window.setTimeout(() => dropWork(made), 20_000);
      }).catch(reject);
    };
    if (providers?.use.cutout) go();
    else setCutoutThen({ run: go, cancel: () => reject(new Error(t('canvas.redraw.subjectNone'))) });
  });

  /**
   * Pictures made from one, each its own preset and shape, in a row in a group beside it, every one wired from it and
   * all made at once.
   */
  const makeGroupFrom = (sourceId: string, label: string, items: Array<{ preset: string; ratio: string; prompt?: string }>) => {
    const gap = 40;
    const sizes = items.map((item) => makeSize('image', item.ratio));
    const w = sizes.reduce((sum, z) => sum + z.w, 0) + gap * (items.length - 1) + 2 * GROUP_PAD;
    const h = Math.max(...sizes.map((z) => z.h)) + 2 * GROUP_PAD + GROUP_HEAD / 2;
    const at = spotBeside(sourceId, 'source', w);
    const group = canvasId('n');
    let x = GROUP_PAD;
    const made = items.map((item, i) => {
      const node = { id: canvasId('n'), parent: group, x, y: GROUP_PAD + GROUP_HEAD / 2, w: sizes[i]!.w, h: sizes[i]!.h, make: 'image' as const, prompt: item.prompt ?? '', preset: item.preset, opts: { ratio: item.ratio } };
      x += sizes[i]!.w + gap;
      return node;
    });
    add({
      nodes: [{ id: group, x: at.x, y: at.y, w, h, group: label, color: 'gray' }, ...made],
      edges: made.map((n) => ({ id: canvasId('e'), from: sourceId, to: n.id, order: 0 })),
    });
    requestAnimationFrame(() => requestAnimationFrame(() => { void flow.fitView({ nodes: [{ id: group }], padding: 0.2, maxZoom: 1, duration: 300 }); void makeAll(group); }));
  };
  /** a picture widened: one node beside it, wired from it, made at once from it and the mask (its canvas in its name) */
  const outpaint = async (sourceId: string, expanded: Expanded, model?: string) => {
    const masking = choicesFor(providers, 'image').filter((c) => c.spec?.mask);
    const choice = masking.find((c) => keyOfChoice(c) === model) ?? masking[0];
    if (!choice) { onError(t('canvas.redraw.noModel')); return; }
    try {
      const mask = await keepWork(expanded.mask, expandName(Date.now().toString(36), expanded.place, expanded.crop));
      if (!mask) return;
      const ratio = ratioOf(expanded.ratio, choice.spec);
      const size = makeSize('image', `${expanded.crop.width}:${expanded.crop.height}`);
      const id = canvasId('n');
      place({ id, type: 'make', position: spotBeside(sourceId, 'source', size.w), width: size.w, height: size.h,
        data: { make: 'image', preset: 'expand', title: nameFrom(sourceId, t('canvas.expand.title')), prompt: expanded.words, via: choice.via, ...(choice.model ? { model: choice.model } : {}), opts: { ratio, mask } } },
      { node: sourceId, side: 'source' });
      setPictureTool(null);
      requestAnimationFrame(() => requestAnimationFrame(() => { void makeNow(id); }));
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  /** a file of the project to draw, known to the board or only just brought in */
  const srcOf = (path: string) => sources.file(byPath.get(path) ?? ({ path, name: path.split('/').pop() ?? path, kind: 'image' } as WorkspaceResource));
  /**
   * What was made at the model's shape, cut to the canvas the person set and made its size in pixels: it takes the
   * place of the uncut one as the node's newest version.
   */
  const cropMade = async (id: string, crop: Expanded['crop']) => {
    /* the version just made reaches the board a render later */
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const node = now.current.nodes.find((n) => n.id === id);
    const path = node?.type === 'make' ? node.data.path : undefined;
    if (!path) return;
    const img = await new Promise<HTMLImageElement>((done, fail) => {
      const i = new Image(); i.crossOrigin = 'anonymous';
      i.onload = () => done(i); i.onerror = () => fail(new Error('the picture did not load')); i.src = srcOf(path);
    });
    const out = document.createElement('canvas');
    out.width = crop.width; out.height = crop.height;
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, crop.x * img.naturalWidth, crop.y * img.naturalHeight, crop.w * img.naturalWidth, crop.h * img.naturalHeight, 0, 0, crop.width, crop.height);
    const blob = await new Promise<Blob | null>((done) => out.toBlob(done, 'image/png'));
    if (!blob) return;
    const [cut] = await onImportFiles([new File([blob], `${path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'expanded'}-${crop.width}x${crop.height}.png`, { type: 'image/png' })]);
    if (!cut) return;
    setNodes((list) => list.map((n) => (n.id === id && n.type === 'make'
      ? { ...n, data: { ...n.data, versions: [...(n.data.versions ?? []).filter((v) => v !== path), cut], path: cut } } : n)));
    /* the uncut one was only on the way */
    dropWork(path);
  };
  /** an edited copy of a picture (cropped, colored) brought in beside it, wired from it */
  const bringEdited = async (sourceId: string, file: File, tool: string) => {
    try {
      const [path] = await onImportFiles([file]);
      if (path) addFile(path, { at: spotBeside(sourceId, 'source', FILE_W), from: { node: sourceId, side: 'source' }, corner: true }, undefined, nameFrom(sourceId, tool));
      setPictureTool(null);
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  /** a frame of a clip at a time, small, as the timeline shows them (studio/server/derived.mjs) */
  const frameOf = (path: string) => (ms: number) => `/api/projects/${encodeURIComponent(projectId)}/media?path=${encodeURIComponent(path)}&what=frame&ms=${ms}&w=160`;
  /** a clip worked on this computer, what it made beside it, wired from it, named for the tool */
  const runClip = async (sourceId: string, body: Parameters<typeof api.clipTool>[1], tool: string) => {
    onNotice(t('canvas.clipTools.working'));
    try {
      const { paths } = await api.clipTool(projectId, body);
      for (const path of paths) addFile(path, { at: spotBeside(sourceId, 'source', FILE_W), from: { node: sourceId, side: 'source' }, corner: true }, undefined, nameFrom(sourceId, tool));
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      onError(message.includes('no-audio') ? t('canvas.clipTools.noAudio') : message);
      return false;
    }
  };
  /**
   * A clip made from a clip by a model, made at once: beside it, wired from it and from what the tool was given (a
   * picture or a recording already on the board wired from where it is, else put beside the new clip), named for the tool.
   */
  const makeFromClip = async (sourceId: string, path: string, tool: ClipTool, made: ClipMade) => {
    const clip = byPath.get(path);
    const ratio = frameRatio(clip?.w, clip?.h, made.choice.spec) ?? '16:9';
    const size = makeSize('video', ratio);
    /* a clip longer than a model takes: the part picked, cut here first (a clip of the project, as Trim makes) */
    let input = path;
    if (made.part) {
      try { input = (await api.clipTool(projectId, { op: 'trim', path, from: made.part[0], to: made.part[1] })).paths[0]!; }
      catch (e) { onError(e instanceof Error ? e.message : String(e)); return; }
      /* known as a clip before it is sent as one */
      await listed(input);
    }
    /* what goes in besides: in a column between the clip and what is made from it, each wired in its order */
    const ins = [...(made.part ? [input] : []), ...made.extras];
    const COLUMN = ins.length ? FILE_W + 80 : 0;
    const at = spotBeside(sourceId, 'source', size.w + COLUMN);
    const id = canvasId('n');
    const onBoard = (p: string) => now.current.nodes.find((n) => (n.type === 'file' || n.type === 'make') && n.data.path === p && !n.parentId);
    const brought: CanvasDoc['nodes'] = [];
    const wired = ins.map((p, i) => {
      const there = p !== input && onBoard(p);
      if (there) return there.id;
      const node = canvasId('n');
      brought.push({ id: node, path: p, x: at.x, y: at.y + i * (CARD_H + 24), w: FILE_W, h: CARD_H,
        ...(p === input && made.part ? { title: nameFrom(sourceId, `${t('canvas.clipTools.part')} ${made.part.map((v) => v.toFixed(1)).join('–')}s`) } : {}) });
      return node;
    });
    /* as long as what it is made from (a clip carried on: as long as asked), within what the model makes */
    const used = made.part ? made.part[1] - made.part[0] : (clip?.durationMs ?? 5000) / 1000;
    const sec = made.sec ?? lengthOf('video', Math.round(used), made.choice.spec, 'omni') ?? undefined;
    add({
      nodes: [{ id, x: at.x + COLUMN, y: at.y, w: size.w, h: size.h, make: 'video', prompt: made.words, preset: tool.preset, via: made.choice.via,
        ...(made.choice.model ? { model: made.choice.model } : {}), title: nameFrom(sourceId, t(`canvas.clipTools.${tool.key}`)),
        opts: { ...(made.choice.spec?.needs ? {} : { mode: 'omni' as const }), ratio, ...(sec ? { sec } : {}), ...(made.style ? { style: made.style } : {}) } }, ...brought],
      edges: [
        ...(made.part ? [] : [{ id: canvasId('e'), from: sourceId, to: id, order: 0 }]),
        ...wired.map((node, i) => ({ id: canvasId('e'), from: node, to: id, order: i + (made.part ? 0 : 1) })),
      ],
    }, false);
    keepLastModel('video', made.choice);
    setClipAI(null);
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    void flow.fitView({ nodes: [{ id: sourceId }, { id }], padding: 0.2, maxZoom: 1, duration: 300 });
    const ok = await makeLatest.current(id);
    /* carried on: the clip and its continuation joined, shown as the card's newest version (the continuation alone before it) */
    if (!ok || tool.key !== 'extend') return;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const node = now.current.nodes.find((n) => n.id === id);
    const continued = node?.type === 'make' ? node.data.path : undefined;
    if (!continued) return;
    try {
      const whole = (await api.clipTool(projectId, { op: 'join', path, then: continued })).paths[0]!;
      await listed(whole);
      setNodes((list) => list.map((n) => (n.id === id && n.type === 'make'
        ? { ...n, data: { ...n.data, versions: [...(n.data.versions ?? [continued]).filter((v) => v !== whole), whole], path: whole } } : n)));
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  /** a clip's shots, a still where each begins, laid out in a group beside it as wide as the clip */
  const layShots = async (sourceId: string, path: string) => {
    onNotice(t('canvas.clipTools.working'));
    try {
      const { paths } = await api.clipTool(projectId, { op: 'shots', path });
      const clip = byPath.get(path);
      const H = 180, GAP = 20;
      const W = Math.round((H * (clip?.w ?? 16)) / (clip?.h ?? 9));
      const cols = Math.min(4, paths.length);
      const rows = Math.ceil(paths.length / cols);
      const w = cols * W + GAP * (cols - 1) + 2 * GROUP_PAD;
      const h = rows * H + GAP * (rows - 1) + 2 * GROUP_PAD + GROUP_HEAD / 2;
      const at = spotBeside(sourceId, 'source', w);
      const group = canvasId('n');
      add({
        nodes: [
          { id: group, x: at.x, y: at.y, w, h, group: nameFrom(sourceId, t('canvas.clipTools.shots')), color: 'gray' },
          ...paths.map((p, i) => ({ id: canvasId('n'), parent: group, path: p, x: GROUP_PAD + (i % cols) * (W + GAP), y: GROUP_PAD + GROUP_HEAD / 2 + Math.floor(i / cols) * (H + GAP), w: W, h: H })),
        ],
        edges: [],
      });
      requestAnimationFrame(() => requestAnimationFrame(() => { void flow.fitView({ nodes: [{ id: group }], padding: 0.2, maxZoom: 1, duration: 300 }); }));
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  /** the agent reading a clip by its shots into words beside it: its shot list, or a prompt to make it again */
  const clipAssist = async (sourceId: string, path: string, kind: 'shots' | 'prompt') => {
    const tongue = ({ 'zh-CN': 'Simplified Chinese', en: 'English', ja: 'Japanese', ko: 'Korean', es: 'Spanish' } as Record<string, string>)[language] ?? 'English';
    const at = spotBeside(sourceId, 'source', NOTE_W);
    const note = canvasId('n');
    add({ nodes: [{ id: note, x: at.x, y: at.y, w: NOTE_W, h: CARD_H, text: '', title: t(`canvas.clipTools.${kind === 'shots' ? 'shotList' : 'prompt'}`) }], edges: [] }, false);
    /* nothing written: the empty note goes, the reason is said */
    const dropNote = () => setNodes((list) => list.filter((n) => n.id !== note));
    try {
      /* as many shots as the writer takes attached */
      const { paths, times = [] } = await api.clipTool(projectId, { op: 'shots', path, most: WRITING_ATTACHMENT_LIMIT, work: true });
      const when = times.map((s) => `${s}s`).join(', ');
      const ask = kind === 'shots'
        ? `The attached pictures are the shots of one video clip, in order, each where a shot begins (at ${when}). Write the clip's shot list: one numbered line per shot with its start time, shot size, camera angle, lens, camera movement, light and what happens; then one line on the cutting rhythm. No preamble. Write it in ${tongue}.`
        : `The attached pictures are frames of one video clip, in order (at ${when}). Write one detailed prompt a video model could use to make this clip again: the subject and the action as it unfolds, the setting, the camera and how it moves, the light, the colors, the style and the mood. One paragraph, no preamble. Write it in ${tongue}.`;
      const error = await write(note, ask, paths);
      if (error) { dropNote(); onError(error); }
    } catch (e) { dropNote(); onError(e instanceof Error ? e.message : String(e)); }
  };
  /**
   * A picture parted into layers: its subject cut out (on this computer), and the background without it — the subject's
   * shape, a little larger, as a mask a model fills in — in a group beside it.
   */
  const splitLayers = async (sourceId: string, path: string) => {
    if (!folder) return;
    const source = byPath.get(path);
    if (!source) return;
    if (!providers?.use.cutout) { setCutoutThen({ run: () => { void splitLayers(sourceId, path); } }); return; }
    const base = source.name.replace(/\.[^.]+$/, '');
    onNotice(t('canvas.marketing.parting'));
    try {
      const receipt = receiptOf<{ src?: string; images?: Array<{ src?: string }> }>(await api.make(folder, 'cutout', { src: path, out: `${base}-subject` }, {}));
      const subject = receipt.src ?? receipt.images?.[0]?.src;
      if (!subject) return;
      const cut = await new Promise<HTMLImageElement>((done, fail) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => done(img);
        img.onerror = () => fail(new Error('the cut-out did not load'));
        img.src = sources.file({ ...source, path: subject });
      });
      const W = cut.naturalWidth; const H = cut.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      /* the subject's shape, grown a little all round, cleared: what the model redraws */
      ctx.globalCompositeOperation = 'destination-out';
      const grow = Math.max(4, Math.round(Math.min(W, H) * 0.012));
      for (let a = 0; a < 16; a++) ctx.drawImage(cut, Math.cos((a / 16) * Math.PI * 2) * grow, Math.sin((a / 16) * Math.PI * 2) * grow);
      ctx.drawImage(cut, 0, 0);
      const mask = await new Promise<Blob>((done, fail) => canvas.toBlob((b) => (b ? done(b) : fail(new Error('no mask was made'))), 'image/png'));
      const maskPath = await keepWork(mask, `${base}-layer-mask.png`);
      const choice = choicesFor(providers, 'image').find((c) => c.spec?.mask);
      const ratio = frameRatio(source.w, source.h, choice?.spec) ?? '1:1';
      const size = makeSize('image', ratio);
      const gap = 40;
      const w = size.w * 2 + gap + 2 * GROUP_PAD;
      const h = size.h + 2 * GROUP_PAD + GROUP_HEAD / 2;
      const at = spotBeside(sourceId, 'source', w);
      const group = canvasId('n');
      const background = canvasId('n');
      const y = GROUP_PAD + GROUP_HEAD / 2;
      add({
        nodes: [
          { id: group, x: at.x, y: at.y, w, h, group: t('canvas.marketing.layers'), color: 'gray' },
          { id: canvasId('n'), parent: group, x: GROUP_PAD, y, w: size.w, h: size.h, path: subject, title: t('canvas.marketing.subject') },
          ...(choice && maskPath ? [{ id: background, parent: group, x: GROUP_PAD + size.w + gap, y, w: size.w, h: size.h, make: 'image' as const, title: t('canvas.marketing.background'),
            prompt: 'Remove the subject in the masked area completely and fill the place in with the background behind it, continuing its texture, light and perspective, with no trace of the subject and no shadow of it.',
            via: choice.via, ...(choice.model ? { model: choice.model } : {}), opts: { ratio, mask: maskPath } }] : []),
        ],
        edges: choice && maskPath ? [{ id: canvasId('e'), from: sourceId, to: background, order: 0 }] : [],
      });
      if (!choice) onError(t('canvas.redraw.noModel'));
      else requestAnimationFrame(() => requestAnimationFrame(() => { void makeNow(background); }));
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  /**
   * The agent reading a picture: a text node beside it written from the picture — the prompt that would make it again,
   * four ideas to take it further, a shot list around it, or the words in it, each as a line to change (then wired into
   * a picture node that changes them).
   */
  const assist = (sourceId: string, path: string, kind: AssistKind) => {
    const tongue = ({ 'zh-CN': 'Simplified Chinese', en: 'English', ja: 'Japanese', ko: 'Korean', es: 'Spanish' } as Record<string, string>)[language] ?? 'English';
    const asks: Record<AssistKind, string> = {
      prompt: `Look at the attached picture and write one detailed prompt an image model could use to make it again: the subject and what it is doing, the setting, the composition and framing, the camera and lens, the light, the colors, the style and the mood. One paragraph, no preamble. Write it in ${tongue}.`,
      ideas: `Look at the attached picture and suggest four different creative directions to take it further, each a ready-to-use prompt for an image model, numbered 1 to 4, one or two sentences each: change the moment, the angle, the light or the style while keeping its subject. No preamble. Write in ${tongue}.`,
      shots: `Look at the attached picture as a frame of a film and design a cinematic shot list of six shots that build a short scene around it. For each shot, one numbered line: shot size, camera angle, lens, camera movement, light, and what happens. No preamble. Write in ${tongue}.`,
      text: 'List every piece of text visible in the attached picture exactly as it is written, one per line, each written twice as: "text" → "text" (the second to be changed). Only those lines, no preamble.',
    };
    const at = spotBeside(sourceId, 'source', NOTE_W);
    const note = canvasId('n');
    const nodesAdded: CanvasDoc['nodes'] = [{ id: note, x: at.x, y: at.y, w: NOTE_W, h: CARD_H, text: '', title: t(`canvas.assist.${kind}`) }];
    const edgesAdded: CanvasDoc['edges'] = [];
    /* the words in it: the lines wired, with the picture, into a node that changes them */
    if (kind === 'text') {
      const change = canvasId('n');
      const source = byPath.get(path);
      const ratio = frameRatio(source?.w, source?.h) ?? '1:1';
      const size = makeSize('image', ratio);
      nodesAdded.push({ id: change, x: at.x + NOTE_W + BESIDE, y: at.y, w: size.w, h: size.h, make: 'image', prompt: '', preset: 'editText', opts: { ratio } });
      edgesAdded.push({ id: canvasId('e'), from: sourceId, to: change, order: 0 }, { id: canvasId('e'), from: note, to: change, order: 1 });
    }
    add({ nodes: nodesAdded, edges: edgesAdded }, false);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      void write(note, asks[kind], [path]).then((error) => { if (error) onError(error); });
    }));
  };
  /** a group's pictures (or one picture) kept as a character, named as the group is, its words what it is about */
  const keepCharacter = async (id: string) => {
    const nodesNow = now.current.nodes;
    const node = nodesNow.find((n) => n.id === id);
    if (!node) return;
    const inIt = node.type === 'frame' ? nodesNow.filter((n) => n.parentId === id) : [node];
    const pictures = inIt.flatMap((n) => {
      const path = n.type === 'file' ? n.data.path : n.type === 'make' && n.data.make === 'image' ? n.data.path : undefined;
      if (!path || mediaOf(path) !== 'image') return [];
      const part = n.type === 'make' ? SUBJECT_KINDS.flatMap((k) => SUBJECT_PARTS[k].map((p) => ({ ...p, kind: k }))).find((p) => p.preset === n.data.preset) : undefined;
      const role = n.type === 'make' ? part?.role ?? 'other' : node.type === 'frame' ? 'other' : 'body';
      return [{ role, path, kind: part?.kind }];
    });
    if (!pictures.length) { onError(t('canvas.characters.noPictures')); return; }
    const about = inIt.flatMap((n) => (n.type === 'note' && n.data.text.trim() ? [n.data.text.trim()] : [])).join('\n\n');
    const name = node.type === 'frame' ? node.data.label : byPath.get(pictures[0]!.path)?.name.replace(/\.[^.]+$/, '') ?? t('canvas.characters.title');
    try {
      /* its kind as its pictures were made: a product's or a place's sheet, else a character */
      const kind = pictures.find((p) => p.kind)?.kind ?? 'person';
      await api.saveCanvasCharacter(projectId, { name, kind, ...(about ? { about } : {}), pictures: pictures.map(({ role, path }) => ({ role, path })) });
      loadSubjects();
      onNotice(t('canvas.characters.kept').replace('{name}', name));
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };

  const keepTemplate = async (groupId: string) => {
    const doc = docNow();
    const node = doc.nodes.find((n) => n.id === groupId);
    if (!node) return;
    try {
      const kept = await api.saveCanvasTemplate(projectId, node.group || t('canvas.group'), copyOf(doc, new Set([groupId]), { x: 0, y: 0 }));
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
    if (!ready) return undefined;
    shownBoards.set(projectId, { board: boardId, take: (id, made) => {
      willChange();
      setNodes((list) => list.map((n) => (n.id === id && n.type === 'make' ? { ...n, data: withVersion(n.data, made) } : n)));
    } });
    return () => { shownBoards.delete(projectId); };
  }, [projectId, boardId, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = nodes.filter((n) => n.selected);
  const single = selected.length === 1 ? selected[0]!.id : null;
  /**
   * A node clicked (not dragged), with its panel under it, kept on the screen: the board glides as much as it takes.
   * Never on a press that starts a drag: the board stays where it is under the pointer, whatever is picked.
   */
  const keepShown = (id: string, composerOnly = false) => {
    requestAnimationFrame(() => {
      const box = rootRef.current?.getBoundingClientRect();
      const el = rootRef.current?.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
      if (!box || !el) return;
      const node = el.getBoundingClientRect();
      const type = now.current.nodes.find((n) => n.id === id)?.type;
      /* its panel as drawn (a frame later), else as it is about to be */
      const toolbar = `.react-flow__node-toolbar[data-id="${CSS.escape(id)}"]`;
      const drawn = rootRef.current?.querySelector(`${toolbar} ${composerOnly ? '[data-canvas-composer]' : '.nodrag'}`)?.getBoundingClientRect();
      if (composerOnly && !drawn) return;
      const panel = drawn && drawn.height > 40 ? { w: drawn.width, h: drawn.height }
        : type === 'make' ? { w: Math.min(660, box.width * 0.86), h: 260 } : type === 'cut' ? { w: 420, h: 80 } : { w: 0, h: 0 };
      const mid = node.left + node.width / 2;
      const left = composerOnly && drawn ? drawn.left : Math.min(node.left, mid - panel.w / 2);
      const right = composerOnly && drawn ? drawn.right : Math.max(node.right, mid + panel.w / 2);
      const bottom = node.bottom + (panel.h ? panel.h + 14 : 0);
      const pad = 24;
      const dx = left < box.left + pad ? box.left + pad - left : right > box.right - pad ? box.right - pad - right : 0;
      /* clear of the toolbar at the foot */
      const dy = composerOnly && drawn
        ? Math.min(0, Math.max(box.bottom - 76 - drawn.bottom, box.top + pad - drawn.top))
        : bottom > box.bottom - 76 ? Math.max(box.bottom - 76 - bottom, box.top + 60 - node.top) : node.top < box.top + 50 ? box.top + 50 - node.top : 0;
      if (!dx && !dy) return;
      const view = flow.getViewport();
      void flow.setViewport({ ...view, x: view.x + dx, y: view.y + dy }, { duration: 220 });
    });
  };
  const board = React.useMemo<Board>(() => ({
    files,
    fileOf: (path) => byPath.get(path) ?? null,
    sources,
    shown,
    showComposer: (id) => keepShown(id, true),
    reportError: onError,
    uploading: (id) => activeUploads.find((upload) => upload.version === id),
    addToFilm: onAddToFilm,
    setData: (id, data) => {
      const node = now.current.nodes.find((n) => n.id === id);
      if (node?.type === 'make' && (data.make ?? node.data.make) === 'video' && data.opts?.ratio) lastVideoRatio.current = data.opts.ratio;
      setNodes((list) => {
        let grew = false;
        const next = list.map((n) => {
          if (n.id !== id) return n;
          /* a picture or a clip asked in another shape: its card takes that shape, as high as it was */
          const ratio = n.type === 'make' && MAKE_MEDIA[n.data.make] !== 'audio' ? data.opts?.ratio : undefined;
          const width = ratio && ratio !== (n.data as MakeData).opts?.ratio ? cardWidth(ratio, n.height ?? CARD_H) : null;
          grew = width !== null && width > (n.width ?? 0);
          return { ...n, ...(width !== null ? { width } : {}), data: { ...n.data, ...data } } as BoardNode;
        });
        /* a card grown wider moves what it now lies on out of its way */
        return grew ? unstack(next, [id]) : next;
      });
    },
    resize: (id, size) => setNodes((list) => unstack(list.map((n) => (n.id === id ? { ...n, width: size.w, height: size.h } : n)), [id])),
    spawn: (id, kind, data) => {
      /* named from where it came: the picture's name and the preset, or a clip */
      const tool = data?.title ? null : data?.preset ? t(`canvas.presets.names.${data.preset}`) : kind === 'video' ? t('canvas.names.clip') : null;
      const named = tool ? { ...data, title: nameFrom(id, tool) } : data;
      const made = addKind(kind, { at: spotBeside(id, 'source', WIDE[kind]), from: { node: id, side: 'source' }, corner: true });
      if (named) setNodes((list) => list.map((n) => (n.id === made ? { ...n, data: { ...n.data, ...named } } as BoardNode : n)));
      return made;
    },
    openTool: (id, path, which) => setPictureTool({ id, path, tool: which }),
    sizes: (id, ratios) => makeGroupFrom(id, t('canvas.presets.names.multiSize'), ratios.map((ratio) => ({ preset: 'multiSize', ratio }))),
    productSet: (id, presets) => makeGroupFrom(id, t('canvas.marketing.set'), presets.map((preset) => ({ preset, ratio: presetOf(preset)?.ratio ?? '1:1' }))),
    layers: (id, path) => { void splitLayers(id, path); },
    assist: (id, path, kind) => assist(id, path, kind),
    clipTool: (id, path, op, ratio) => {
      if (op === 'trim') { setTrimming({ id, path }); return; }
      void runClip(id, { op, path, ...(ratio ? { ratio } : {}) }, t(op === 'audio' ? 'canvas.clipTools.audio' : 'canvas.clipTools.crop'));
    },
    shots: (id, path) => { void layShots(id, path); },
    clipAssist: (id, path, kind) => { void clipAssist(id, path, kind); },
    clipAI: (id, path, tool) => setClipAI({ id, path, tool }),
    bring: (id, list) => {
      uploadFiles(list, { at: spotBeside(id, 'source', FILE_W), from: { node: id, side: 'source' }, corner: true, wireFirstOnly: true });
    },
    cutout: (id, path) => {
      /* a card beside it, wired from it, its shape, cut out at once (on the board as anything being made is) */
      const picture = byPath.get(path);
      const ratio = picture?.w && picture.h ? `${picture.w}:${picture.h}` : '1:1';
      const size = makeSize('image', ratio);
      const made = canvasId('n');
      place({ id: made, type: 'make', position: spotBeside(id, 'source', size.w), width: size.w, height: size.h,
        data: { make: 'image', prompt: '', preset: 'cutout', title: nameFrom(id, t('canvas.actions.cutout')), opts: { ratio } } }, { node: id, side: 'source' });
      requestAnimationFrame(() => requestAnimationFrame(() => { void makeNow(made); }));
    },
    split: (id, path, rows, cols) => {
      const picture = byPath.get(path);
      if (!picture) return;
      const base = picture.name.replace(/\.[^.]+$/, '');
      void splitGrid(sources.file(picture), rows, cols, base).then(async (cut) => {
        const paths = await onImportFiles(cut.files);
        /* the panels as they sat in the picture: a row of cards each as high, each as wide as its own shape */
        const H = 220;
        const GAP = 20;
        const widths = cut.cells.map((c) => Math.round((H * c.w) / c.h));
        const colW = Array.from({ length: cut.cols }, (_, c) => Math.max(...widths.filter((_, i) => i % cut.cols === c)));
        const w = colW.reduce((sum, x) => sum + x, 0) + GAP * (cut.cols - 1) + 2 * GROUP_PAD;
        const h = cut.rows * H + GAP * (cut.rows - 1) + 2 * GROUP_PAD + GROUP_HEAD / 2;
        const at = spotBeside(id, 'source', w);
        const group = canvasId('n');
        add({
          nodes: [
            { id: group, x: at.x, y: at.y, w, h, group: `${base} · ${cut.cols}×${cut.rows}`, color: 'gray' },
            ...paths.map((p, i) => {
              const c = i % cut.cols;
              const r = Math.floor(i / cut.cols);
              const x = GROUP_PAD + colW.slice(0, c).reduce((sum, v) => sum + v + GAP, 0) + (colW[c]! - widths[i]!) / 2;
              return { id: canvasId('n'), parent: group, path: p, x, y: GROUP_PAD + GROUP_HEAD / 2 + r * (H + GAP), w: widths[i]!, h: H };
            }),
          ],
          edges: [],
        });
        requestAnimationFrame(() => requestAnimationFrame(() => { void flow.fitView({ nodes: [{ id: group }], padding: 0.2, maxZoom: 1, duration: 300 }); }));
      }).catch((e: unknown) => onError(e instanceof Error && e.message === 'no grid found' ? t('canvas.split.none') : e instanceof Error ? e.message : String(e)));
    },
    remove,
    willChange,
    editing,
    edit: (id) => { if (id) willChange(); setEditing(id); },
    select: (id, add) => setNodes((list) => list.map((n) => (n.id === id ? { ...n, selected: add ? !n.selected : true } : add ? n : { ...n, selected: false }))),
    /* a window over the board (a picture's tool, a library): the bars round the node give way to it */
    single: redraw || pictureTool || trimming || clipAI || modal || cutoutThen ? null : single,
    choices: (kind) => choicesFor(providers, kind),
    allChoices: (kind) => allChoicesFor(providers, kind),
    fallback: (kind) => defaultChoice(providers, kind),
    run: (id) => runs.get(`${projectId}/${id}`),
    error: (id) => runErrors.get(`${projectId}/${id}`),
    stale: making.stale,
    unused: making.unused,
    make: (id) => { void makeNow(id); },
    stop: (id) => leaveRun(projectId, id),
    inputs: (id) => inputViews(now.current.nodes, now.current.edges, id, mediaOf),
    nameOf: (id) => { const n = now.current.nodes.find((x) => x.id === id); return n ? nameOfNode(n) : ''; },
    reorderInputs: (id, order) => {
      willChange();
      setEdges((list) => list.map((e) => (e.target === id && order.includes(e.id) ? { ...e, data: { ...e.data, order: order.indexOf(e.id) } } : e)));
    },
    unwire: (edge) => { willChange(); setEdges((list) => list.filter((e) => e.id !== edge)); },
    sideMenu: (id, side, screen) => {
      setContext(null);
      setMenu({ screen, at: spotBeside(id, side, MAKE_W), corner: true, from: { node: id, side } });
    },
    upload: (id, how) => {
      const node = now.current.nodes.find((n) => n.id === id);
      const kind = node?.type === 'make' ? node.data.make : null;
      const spec = node?.type === 'make' && kind === 'video' ? choiceOf(providers, kind, node.data.via, node.data.model)?.spec : undefined;
      const accept = how === 'input'
        ? (kind === 'video' ? (spec?.voice || spec?.needs === 'audio' ? ACCEPT.media : `${ACCEPT.image},${ACCEPT.video}`) : ACCEPT.image)
        : kind === 'image' ? ACCEPT.image : kind === 'video' ? ACCEPT.video : ACCEPT.audio;
      void pickLocalFiles(accept).then((list) => {
        if (how === 'version') uploadFiles(list, { at: node?.position ?? { x: 0, y: 0 }, version: id });
        else uploadFiles(list, { at: spotBeside(id, 'target', FILE_W), from: { node: id, side: 'target' }, corner: true });
      });
    },
    wireIn: (id, from) => {
      if ('path' in from) { addFile(from.path, { at: spotBeside(id, 'target', FILE_W), from: { node: id, side: 'target' }, corner: true }); return; }
      if (now.current.edges.some((e) => e.source === from.node && e.target === id)) return;
      willChange();
      setEdges((list) => [...list, { id: canvasId('e'), source: from.node, target: id, data: { order: nextOrder(docNow(), id) } }]);
    },
    sendToFilm: (id) => {
      const shots = inputViews(now.current.nodes, now.current.edges, id, mediaOf).flatMap((i) => (i.path && byPath.get(i.path) ? [byPath.get(i.path)!] : []));
      if (shots.length) onSendToFilm(shots);
    },
    view: (path) => setViewing(path),
    ...(onReveal ? { reveal: onReveal } : {}),
    makesIn: (groupId) => nodes.filter((n) => n.parentId === groupId && n.type === 'make').length,
    busyIn: (groupId) => nodes.some((n) => n.parentId === groupId && runs.has(`${projectId}/${n.id}`)),
    makeAll: (groupId) => { void makeAll(groupId); },
    ungroup: (groupId) => ungroup(groupId),
    pick: (id) => setPicking(id),
    keepTemplate: (groupId) => { void keepTemplate(groupId); },
    keepCharacter: (id) => { void keepCharacter(id); },
    openLibrary,
    useSubject: (id, subject) => { void useCharacter(subject, id); },
    redraw: (id, path, start) => setRedraw({ id, path, ...(start ? { start } : {}) }),
    tidy: (group) => { willChange(); setNodes((list) => tidyGroup(list, group)); },
    openSettings: onOpenSettings,
    openCamera: (node) => setCameraFor(node),
    ...(chat ? { write, writing: (id: string) => writing.get(id), stopWriting: (id: string) => writers.current.get(id)?.abort(), uploadWritingFiles: onImportFiles } : {}),
    locate,
    ...(onRefer ? { refer: (id: string) => { const node = now.current.nodes.find((n) => n.id === id); const ref = node ? refOf(node) : null; if (ref) onRefer([ref]); } } : {}),
  }), [chat, writing, boardId, files, byPath, sources, onAddToFilm, setNodes, editing, single, redraw, pictureTool, trimming, clipAI, modal, cutoutThen, providers, runsSeen, making, projectId, folder, onOpenSettings, nodes, edges, onReveal, onError, onImportFiles, activeUploads, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDrop = (event: React.DragEvent) => {
    const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const item = readResourceDragData(event.dataTransfer);
    if (item) {
      event.preventDefault(); event.stopPropagation();
      if (item.apply) { onNotice(t('layout.canvasEffectInEdit')); return; }
      if (!item.saved) { addFile(item.path, { at }); return; }
      const board = boardRef.current;
      void api.takeSaved(projectId, item.saved).then(taken => {
        if (boardRef.current !== board) return;
        const paths = 'path' in taken ? [taken.path] : 'clip' in taken ? [taken.clip.src] : taken.clips.map(row => row.clip.src);
        for (const [i,path] of [...new Set(paths)].entries()) addFile(path, { at: { x: at.x + i*(FILE_W+24), y: at.y } });
      }, error => onError(error instanceof Error ? error.message : String(error)));
      return;
    }
    /* Files from this computer get their spots as soon as they are dropped. */
    if (isComputerFileDrag(event.dataTransfer) && event.dataTransfer.files.length) {
      event.preventDefault();
      event.stopPropagation();
      uploadFiles([...event.dataTransfer.files], { at });
    }
  };

  /* ── the chat: nodes as references (⌘L), and a node a reference points at shown ── */
  /* what a making node makes with, as the person set it on it (its model, else the one it falls back to): an agent
     asked to change it makes it the same way */
  const makerOf = (data: MakeData) => {
    const choice = data.via ? { via: data.via, model: data.model } : defaultChoice(providers, data.make);
    if (!choice) return {};
    const opts = Object.fromEntries(Object.entries(data.opts ?? {}).filter((entry): entry is [string, string | number | boolean] => ['string', 'number', 'boolean'].includes(typeof entry[1])));
    return { maker: { via: choice.via, ...(choice.model ? { model: choice.model } : {}), ...(Object.keys(opts).length ? { opts } : {}) } };
  };
  const refOf = (n: BoardNode): StudioRef | null => {
    /* its pill says its name, as the board's name row does ("Text 2", "Picture node 1", a file's name), kept short */
    const short = (name: string) => (name.length > 16 ? `${name.slice(0, 15)}…` : name);
    const number = () => String(numberOf(now.current.nodes, n.id));
    const picture = (path: string | undefined) => {
      const file = path ? byPath.get(path) : undefined;
      const src = !file ? undefined : file.kind === 'image' ? sources.file(file) : file.kind === 'video' ? sources.poster?.(file) : file.kind === 'mg' ? sources.pagePoster?.(file) : undefined;
      return src ? { image: { src } } : {};
    };
    if (n.type === 'note') return { kind: 'node', id: n.id, nodeKind: 'note', label: short(n.data.title ?? t('canvas.titles.note').replace('{n}', number())), text: n.data.text };
    if (n.type === 'frame') return { kind: 'node', id: n.id, nodeKind: 'group', label: short(n.data.label || t('canvas.group')) };
    if (n.type === 'cut') return { kind: 'node', id: n.id, nodeKind: 'cut', label: t('canvas.kinds.cut') };
    if (n.type === 'file') {
      return { kind: 'node', id: n.id, nodeKind: 'file', label: short(n.data.title ?? byPath.get(n.data.path)?.name ?? n.data.path.split('/').pop() ?? n.data.path), path: n.data.path, ...picture(n.data.path) };
    }
    return {
      kind: 'node', id: n.id, nodeKind: n.data.make, label: short(n.data.title ?? (n.data.preset ? t(`canvas.presets.names.${n.data.preset}`) : t(`canvas.titles.${n.data.make}`).replace('{n}', number()))), prompt: n.data.prompt ?? '',
      ...(n.data.path ? { path: n.data.path } : {}), ...(n.data.versions?.length ? { versions: n.data.versions.length } : {}), ...picture(n.data.path),
      ...makerOf(n.data),
    };
  };
  const refer = () => {
    if (!onRefer) return false;
    const refs = now.current.nodes.filter((n) => n.selected).flatMap((n) => refOf(n) ?? []);
    if (!refs.length) return false;
    onRefer(refs);
    return true;
  };
  /* a link shown (`.film/canvases/<board>.json#<node>`): its board first, then the node on it once it is in view */
  const focusSwitched = React.useRef(0);
  const focusDone = React.useRef(0);
  React.useEffect(() => {
    if (!focus || !ready || !fitted || focusDone.current === focus.n) return;
    if (focus.board && focus.board !== boardRef.current) {
      /* tried once: a board that is not there falls back to the first, and is said gone */
      if (focusSwitched.current !== focus.n) { focusSwitched.current = focus.n; void showBoard(focus.board); return; }
      focusDone.current = focus.n;
      onError(t('canvas.gone'));
      return;
    }
    focusDone.current = focus.n;
    if (!focus.id) return;
    if (!now.current.nodes.some((n) => n.id === focus.id)) { onError(t('canvas.gone')); return; }
    showNode(focus.id);
  }, [focus, ready, fitted, boardId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* a board copied in (an example's): laid down below what is there, and shown */
  const laid = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!insert || !ready || laid.current === insert.n) return;
    laid.current = insert.n;
    const here = now.current.nodes.filter((n) => !n.parentId);
    const at = here.length
      ? { x: Math.min(...here.map((n) => n.position.x)), y: Math.max(...here.map((n) => n.position.y + (n.measured?.height ?? n.height ?? CARD_H))) + 160 }
      : { x: 0, y: 0 };
    const top = insert.doc.nodes.filter((n) => !n.parent);
    const x0 = top.length ? Math.min(...top.map((n) => n.x)) : 0;
    const y0 = top.length ? Math.min(...top.map((n) => n.y)) : 0;
    const copied = copyOf(insert.doc, new Set(top.map((n) => n.id)), { x: at.x - x0, y: at.y - y0 });
    add(copied);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      void flow.fitView({ nodes: copied.nodes.filter((n) => !n.parent).map((n) => ({ id: n.id })), padding: 0.15, maxZoom: 1, duration: 250 });
    }));
  }, [insert, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── keys: the board's own, and the page's while nothing else has them (a menu closed, a node drawn again): the
     board covers the edit, so Studio's ⌘Z, Space and the rest are not to act on a film out of sight ── */
  const onKeyDown = (event: KeyboardEvent) => {
    if (!shown || !fitted) return;
    const target = event.target as HTMLElement;
    if (target !== document.body && !rootRef.current?.contains(target)) return;
    /* a menu open has the keys (its Escape closes it, and only it); a dialog over the board has them all (its own undo) */
    if (menu || context) return;
    if (modal || redraw || pictureTool || trimming || clipAI || target.closest('[role="dialog"]')) { if (target === document.body) event.stopPropagation(); return; }
    if (viewing) { if (event.key === 'Escape') { event.preventDefault(); setViewing(null); } return; }
    if (picking && event.key === 'Escape') { event.preventDefault(); setPicking(null); return; }
    if (cutAt && event.key === 'Escape') { event.preventDefault(); setCutAt(null); return; }
    if (target.closest('input, textarea, [contenteditable="true"], [data-canvas-video-controls], [data-canvas-title]')) return;
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
    else if (mod && (key === '=' || key === '+')) { done(); void flow.zoomIn({ duration: 150 }); }
    else if (mod && key === '-') { done(); void flow.zoomOut({ duration: 150 }); }
    else if (mod && key === 'enter' && single && now.current.nodes.find((n) => n.id === single)?.type === 'make') { done(); void makeNow(single); }
    else if (!mod && event.shiftKey && event.code === 'Digit1') { done(); void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 200 }); }
    else if (!mod && event.shiftKey && event.code === 'Digit0') { done(); void flow.zoomTo(1, { duration: 150 }); }
    /*
     * a text node selected and typed into (or Enter): its words opened and the focus in them before the key does what it
     * does, so what is typed lands there as typed — an input method's composing too, which a key put in by hand broke
     */
    else if (!mod && !event.altKey && single && !editing && (event.key.length === 1 || event.key === 'Process' || event.keyCode === 229 || key === 'enter')
      && now.current.nodes.find((n) => n.id === single)?.type === 'note') {
      const note = now.current.nodes.find((n) => n.id === single)!;
      if (key === 'enter') done();
      willChange();
      flushSync(() => {
        if (note.width === NOTE_W && note.height === CARD_H) setNodes((list) => list.map((n) => (n.id === single ? { ...n, width: NOTE_W, height: NOTE_H } : n)));
        setEditing(single);
      });
      rootRef.current?.querySelector<HTMLTextAreaElement>(`.react-flow__node[data-id="${CSS.escape(single)}"] textarea`)?.focus();
    }
    else if (!mod && key === 'v') { done(); setTool('select'); }
    else if (!mod && key === 'h') { done(); setTool('hand'); }
    else if (!mod && (key === 'backspace' || key === 'delete')) { done(); removeSelected(); }
    else if (mod && key === '0') { done(); void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 200 }); }
    else if (mod && key === 'f') { done(); setOutline(true); }
    else if (!mod && (key === '/' || (key === 'tab' && selected.length < 2))) {
      done();
      const box = rootRef.current!.getBoundingClientRect();
      openMenu(box.left + box.width / 2 - 130, box.top + box.height / 3);
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

  /* the wires: those into and out of the node selected lit; those into a node with more than one, numbered in their order */
  const drawn = React.useMemo(() => {
    const takes = new Set(nodes.flatMap((n) => (n.type === 'make' || n.type === 'cut' ? [n.id] : [])));
    const picked = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
    const into = new Map<string, Edge[]>();
    for (const e of edges) if (takes.has(e.target)) into.set(e.target, [...(into.get(e.target) ?? []), e]);
    const place = new Map<string, number>();
    for (const list of into.values()) {
      if (list.length < 2) continue;
      const rank = (e: Edge) => (typeof e.data?.order === 'number' ? e.data.order : Infinity);
      list.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).forEach(({ e }, i) => place.set(e.id, i + 1));
    }
    return edges.map((e) => {
      const lit = Boolean(e.selected) || picked.has(e.source) || picked.has(e.target);
      return {
        ...e,
        data: { ...e.data, lit },
        ...(place.has(e.id) ? {
          label: String(place.get(e.id)), labelBgPadding: [5, 2] as [number, number], labelBgBorderRadius: 4,
          labelStyle: { fontSize: 11, fontWeight: 500, fill: lit ? '#fff' : 'var(--cv-label)' }, labelBgStyle: { fill: lit ? LIT : 'var(--cv-float)', stroke: 'var(--cv-float-line)' },
        } : {}),
      };
    });
  }, [nodes, edges]);

  /* ── right clicks ── */
  const nodeMenu = (event: React.MouseEvent, node: BoardNode) => {
    event.preventDefault();
    if (!node.selected) setNodes((list) => list.map((n) => ({ ...n, selected: n.id === node.id })));
    const path = node.type === 'file' || node.type === 'make' ? (node.data as { path?: string }).path : undefined;
    const file = path ? board.fileOf(path) : null;
    const running = node.type === 'make' && board.run(node.id);
    setContext({ x: event.clientX, y: event.clientY, items: [
      ...(node.type === 'make' ? [running
        ? { id: 'stop', label: t('canvas.make.stop'), icon: <Square size={15} />, onSelect: () => board.stop(node.id) }
        : { id: 'make', label: node.data.versions?.length ? t('canvas.make.again') : t('canvas.make.run'), icon: <Sparkles size={15} />, shortcut: `${MOD}↵`,
          disabled: !board.choices(node.data.make).length, hint: t('canvas.make.noService'), onSelect: () => { void makeNow(node.id); } }] : []),
      ...(node.type === 'cut' ? [{ id: 'send', label: t('canvas.cut.send'), icon: <Clapperboard size={15} />, onSelect: () => board.sendToFilm(node.id) }] : []),
      ...(file && file.kind !== 'other' ? [{ id: 'film', label: t('canvas.addToFilm'), icon: <Clapperboard size={15} />, onSelect: () => onAddToFilm(file) }] : []),
      ...(file && onReveal ? [{ id: 'reveal', label: t('canvas.actions.reveal'), icon: <FolderSearch size={15} />, onSelect: () => onReveal(file.path) }] : []),
      ...(file ? [
        { id: 'view', label: t('canvas.actions.view'), icon: <Maximize2 size={15} />, onSelect: () => setViewing(file.path) },
        { id: 'download', label: t('canvas.actions.download'), icon: <Download size={15} />, onSelect: () => { const a = document.createElement('a'); a.href = sources.file(file); a.download = file.name; a.click(); } },
      ] : []),
      /* a picture onto the clipboard, to paste anywhere */
      ...(file?.kind === 'image' && typeof ClipboardItem !== 'undefined' ? [{ id: 'clip', label: t('canvas.toClipboard'), onSelect: () => {
        void fetch(sources.file(file)).then((res) => res.blob()).then(async (blob) => {
          const bitmap = await createImageBitmap(blob);
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width; canvas.height = bitmap.height;
          canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
          const png = await new Promise<Blob>((done, fail) => canvas.toBlob((b) => (b ? done(b) : fail(new Error('no picture'))), 'image/png'));
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
          onNotice(t('canvas.copiedPicture'));
        }).catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
      } }] : []),
      ...(node.type === 'make' || node.type === 'cut' || file ? [{ id: 's0', separator: true as const }] : []),
      ...(onRefer ? [{ id: 'refer', label: t('host.refer'), shortcut: `${MOD}L`, onSelect: () => { refer(); } }] : []),
      { id: 'copy', label: t('canvas.copy'), shortcut: `${MOD}C`, onSelect: () => { copy(); } },
      { id: 'duplicate', label: t('canvas.duplicate'), shortcut: `${MOD}D`, onSelect: duplicate },
      { id: 'paste', label: t('canvas.paste'), shortcut: `${MOD}V`, disabled: !clipboard, hint: t('canvas.nothingCopied'), onSelect: paste },
      ...(node.type === 'frame' && board.makesIn(node.id) ? [{ id: 'all', label: t('canvas.makeAll'), icon: <Play size={15} />, disabled: board.busyIn(node.id), onSelect: () => { void makeAll(node.id); } }] : []),
      ...(node.type === 'frame' ? [{ id: 'template', label: t('canvas.keepTemplate'), icon: <LayoutTemplate size={15} />, onSelect: () => { void keepTemplate(node.id); } }] : []),
      ...(node.type === 'frame' || (file?.kind === 'image') || (node.type === 'make' && node.data.make === 'image' && node.data.path)
        ? [{ id: 'character', label: t('canvas.characters.keep'), icon: <UserRound size={15} />, onSelect: () => { void keepCharacter(node.id); } }] : []),
      ...(node.type === 'frame'
        ? [{ id: 'ungroup', label: t('canvas.ungroup'), shortcut: `${SHIFT}G`, onSelect: () => ungroup() }]
        : node.parentId ? [] : [{ id: 'group', label: t('canvas.groupThem'), shortcut: `${MOD}G`, onSelect: group }]),
      ...(node.type === 'frame' ? [{ id: 'color', label: t('canvas.color'), submenu: GROUP_COLORS.map((c) => ({
        id: c, label: t(`canvas.colors.${c}`), checked: (node.data as FrameData).color === c,
        icon: <span className="block h-3 w-3 rounded-full" style={{ background: FRAME_COLOR[c].dot }} />,
        onSelect: () => { willChange(); board.setData(node.id, { color: c }); },
      })) }] : []),
      { id: 's1', separator: true },
      { id: 'delete', label: t('canvas.remove'), shortcut: '⌫', danger: true, onSelect: removeSelected },
    ] });
  };
  const paneMenu = (event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    const { clientX, clientY } = event;
    const at = flow.screenToFlowPosition({ x: clientX, y: clientY });
    setContext({ x: clientX, y: clientY, items: [
      { id: 'upload', label: t('canvas.menu.upload'), icon: <Upload size={15} />, onSelect: () => { void pickUpload({ at }); } },
      { id: 'add', label: t('canvas.addHere'), icon: <Plus size={15} />, shortcut: '/', onSelect: () => openMenu(clientX, clientY) },
      { id: 's0', separator: true },
      { id: 'undo', label: t('canvas.keys.undo'), shortcut: `${MOD}Z`, disabled: !history.current.past.length, onSelect: () => step(true) },
      { id: 'redo', label: t('canvas.keys.redo'), shortcut: `${SHIFT}Z`, disabled: !history.current.future.length, onSelect: () => step(false) },
      { id: 'paste', label: t('canvas.paste'), shortcut: `${MOD}V`, disabled: !clipboard, hint: t('canvas.nothingCopied'), onSelect: paste },
      { id: 'all', label: t('canvas.selectAll'), shortcut: `${MOD}A`, onSelect: selectAll },
      { id: 's', separator: true },
      { id: 'fit', label: t('canvas.fit'), shortcut: '⇧1', onSelect: () => { void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 200 }); } },
    ] });
  };
  const edgeMenu = (event: React.MouseEvent, edge: Edge) => {
    event.preventDefault();
    const target = now.current.nodes.find((n) => n.id === edge.target);
    const into = (target?.type === 'make' || target?.type === 'cut') && now.current.edges.filter((e) => e.target === edge.target).length > 1;
    setContext({ x: event.clientX, y: event.clientY, items: [
      ...(into ? [{ id: 'first', label: t('canvas.make.first'), onSelect: () => {
        willChange();
        const order = new Map(reorder(docNow(), edge.target, edge.id).map((e) => [e.id, e.order]));
        setEdges((list) => list.map((e) => (e.target === edge.target ? { ...e, data: { ...e.data, order: order.get(e.id) } } : e)));
      } }, { id: 's', separator: true as const }] : []),
      { id: 'delete', label: t('canvas.removeWire'), danger: true, onSelect: () => { willChange(); setEdges((list) => list.filter((e) => e.id !== edge.id)); } },
    ] });
  };

  const viewed = viewing ? byPath.get(viewing) ?? null : null;
  return (
    <BoardContext.Provider value={board}>
      <div
        ref={rootRef}
        data-studio-canvas=""
        data-canvas-ready={fitted ? '1' : '0'}
        aria-busy={!fitted}
        tabIndex={-1}
        className="relative h-full w-full outline-none"
        onPointerDown={(event) => { if (!(event.target as HTMLElement).closest('input, textarea, [contenteditable="true"], [data-writing-bar], [data-canvas-video-controls]')) rootRef.current?.focus({ preventScroll: true }); }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(RESOURCE_DRAG_TYPE) && !isComputerFileDrag(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={onDrop}
        /*
         * a double click on the board opens the add menu: two presses close in time and place, counted here, as the
         * browser's own double click is lost when the first press starts a selection or lands on what lies on the board
         */
        onPointerDownCapture={(event) => {
          if (event.button !== 0) return;
          const target = event.target as Element;
          const onBoard = target.closest('.react-flow__pane')
            && !target.closest('.react-flow__node, .react-flow__edge, .react-flow__nodesselection, .react-flow__panel, .react-flow__handle, button, input, textarea, [contenteditable="true"]');
          const last = boardPress.current;
          /* a press that closes a menu only closes it: it is not the first half of a double click */
          boardPress.current = onBoard && !menu && !context ? { at: event.timeStamp, x: event.clientX, y: event.clientY } : null;
          if (!onBoard || menu || context || !last || event.timeStamp - last.at > DOUBLE_MS || Math.hypot(event.clientX - last.x, event.clientY - last.y) > DOUBLE_PX) return;
          boardPress.current = null;
          const box = event.currentTarget.getBoundingClientRect();
          setTaps((list) => [...list, { id: event.timeStamp, x: event.clientX - box.left, y: event.clientY - box.top }]);
          openMenu(event.clientX, event.clientY);
        }}
      >
        <ReactFlow<BoardNode, Edge>
          nodes={drawnNodes}
          edges={wires ? drawn : NO_EDGES}
          nodeTypes={NODE_TYPES}
          edgeTypes={CANVAS_EDGE_TYPES}
          defaultEdgeOptions={CANVAS_EDGE_OPTIONS}
          onNodesChange={(changes) => {
            onNodesChange(changes);
            if (changes.some((change) => change.type === 'dimensions' && change.resizing === false)) setNodes(fitGroups);
          }}
          onEdgesChange={onEdgesChange}
          onNodeDragStart={willChange}
          onNodeDragStop={(_event, _node, moved) => setNodes((list) => fitGroups(raiseCards(list, moved)))}
          onSelectionDragStart={willChange}
          onConnect={(connection: Connection) => {
            willChange();
            /* drawn from a ⊕, it meets the card at its side, as every wire does */
            setEdges((list) => [...list, { id: canvasId('e'), source: connection.source, target: connection.target, data: { order: nextOrder(docNow(), connection.target) } }]);
          }}
          onConnectEnd={(event, state: FinalConnectionState) => {
            /* let go on the board: what to add there, joined to that wire */
            if (state.isValid || !state.fromNode || !state.to) return;
            const point = 'changedTouches' in event ? event.changedTouches[0]! : event;
            const from = state.fromHandle?.position === 'left' || state.fromHandle?.type === 'target' ? 'target' : 'source';
            const bounds = rootRef.current?.getBoundingClientRect();
            if (!bounds || point.clientX < bounds.left || point.clientX > bounds.right || point.clientY < bounds.top || point.clientY > bounds.bottom) return;
            /* let go anywhere on a node: wired to it */
            const onto = document.elementsFromPoint(point.clientX, point.clientY)
              .map((el) => el.closest<HTMLElement>('.react-flow__node')).find((el) => el && el.dataset.id !== state.fromNode!.id);
            const target = onto?.dataset.id ? now.current.nodes.find((n) => n.id === onto.dataset.id) : undefined;
            if (target && target.type !== 'frame') {
              const [source, into] = from === 'source' ? [state.fromNode.id, target.id] : [target.id, state.fromNode.id];
              if (now.current.edges.some((e) => e.source === source && e.target === into)) return;
              willChange();
              setEdges((list) => [...list, { id: canvasId('e'), source, target: into, data: { order: nextOrder(docNow(), into) } }]);
              return;
            }
            openMenu(point.clientX, point.clientY, { node: state.fromNode.id, side: from });
          }}
          isValidConnection={(c) => c.source !== c.target}
          connectionDragThreshold={5}
          connectionLineComponent={DraggedWire}
          connectOnClick={false}
          onNodeContextMenu={nodeMenu}
          onPaneContextMenu={paneMenu}
          onEdgeContextMenu={(event, edge) => { setCutAt(null); edgeMenu(event, edge); }}
          /* a wire clicked: a button to cut it, where it was clicked */
          onEdgeClick={(event, edge) => {
            if (board.readOnly) return;
            const box = rootRef.current?.getBoundingClientRect();
            if (box) setCutAt({ id: edge.id, x: event.clientX - box.left, y: event.clientY - box.top });
          }}
          onMoveStart={() => setCutAt(null)}
          /* a click on the board or on another node: done writing */
          onPaneClick={() => { setContext(null); setEditing(null); setCutAt(null); }}
          onNodeClick={(event, node) => {
            setCutAt(null);
            if (editing && editing !== node.id) setEditing(null);
            if (!picking) {
              if (!event.shiftKey && !event.metaKey && !event.ctrlKey && node.type !== 'frame' && !(event.target as Element).closest('[data-canvas-node-header]')) keepShown(node.id);
              return;
            }
            /* picking: the node clicked goes into the one picking, and picking is done */
            event.stopPropagation();
            if (node.id !== picking && node.type !== 'frame') board.wireIn(picking, { node: node.id });
            const into = picking;
            setPicking(null);
            setNodes((list) => list.map((n) => ({ ...n, selected: n.id === into })));
          }}
          colorMode={dark ? 'dark' : 'light'}
          panOnScroll
          zoomOnPinch
          zoomOnScroll={false}
          panOnDrag={tool === 'hand' ? true : [1, 2]}
          selectionOnDrag={tool === 'select'}
          selectionMode={SelectionMode.Partial}
          onSelectionStart={() => {
            const rect = flowStore.getState().userSelectionRect;
            selectionStart.current = rect ? { x: rect.startX, y: rect.startY } : null;
          }}
          onSelectionEnd={(event) => {
            const start = selectionStart.current;
            selectionStart.current = null;
            if (!start) return;
            const end = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false });
            const left = Math.min(start.x, end.x), right = Math.max(start.x, end.x);
            const top = Math.min(start.y, end.y), bottom = Math.max(start.y, end.y);
            setNodes((list) => {
              const groups = new Set(list.filter((node) => {
                if (node.type !== 'frame') return false;
                const { x, y } = node.position;
                return x >= left && y >= top && x + (node.width ?? 0) <= right && y + (node.height ?? 0) <= bottom;
              }).map((node) => node.id));
              if (!groups.size) return list;
              return list.map((node) => {
                if (groups.has(node.id)) return { ...node, selected: true };
                if (node.selected && node.parentId && groups.has(node.parentId)) return { ...node, selected: false };
                return node;
              });
            });
          }}
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={['Meta', 'Shift', 'Control']}
          connectionRadius={30}
          snapToGrid={snap}
          snapGrid={[20, 20]}
          paneClickDistance={8}
          nodeClickDistance={8}
          zIndexMode="manual"
          onlyRenderVisibleElements
          minZoom={0.1}
          maxZoom={4}
          proOptions={{ hideAttribution: true }}
          className={`openfilm-canvas ${fitted ? 'opacity-100' : 'opacity-0'} ${tool === 'hand' ? 'cursor-grab' : ''}`}
        >
          <Dots />
          {menu?.wire ? <MenuWire menu={menu} /> : null}
          {shown && !picking && selected.length > 1 ? (
            <SelectionToolbar ids={selected.map((node) => node.id)}
              onGroup={selected.every((node) => node.type !== 'frame' && !node.parentId) ? group : undefined}
              onUngroup={selected.some((node) => node.type === 'frame') ? () => ungroup() : undefined}
              onDuplicate={duplicate} onRemove={removeSelected} />
          ) : null}
          {map ? (
            /* beside the list of nodes when that is open, both on the right */
            <MiniMap position="bottom-right" pannable zoomable style={{ marginBottom: 60, marginRight: outline ? 336 : 8 }}
              nodeColor={(n) => (n.type === 'frame' ? 'transparent' : n.type === 'note' ? 'var(--bg-pressed)' : 'var(--text-faint)')}
              nodeStrokeColor={(n) => (n.type === 'frame' ? FRAME_COLOR[(n.data as FrameData).color].line : 'transparent')} />
          ) : null}
        </ReactFlow>
        {picking ? (
          <div className="pointer-events-auto absolute left-1/2 top-3 z-30 flex h-10 -translate-x-1/2 items-center gap-3 rounded-full bg-[var(--cv-edge-lit)] pl-4 pr-1.5 text-[13px] font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,0.3)]">
            <MousePointerClick size={15} />{t('canvas.pick.banner')}
            <button type="button" onClick={() => setPicking(null)} className="flex h-7 items-center gap-1 rounded-full bg-white/20 px-3 text-[12.5px] hover:bg-white/30">{t('canvas.pick.done')}<kbd className="font-sans text-[11px] opacity-80">Esc</kbd></button>
          </div>
        ) : null}
        {picking ? null : <BottomToolbar
          onKind={(kind) => {
            setMenu(null);
            setContext(null);
            /* a little above the middle (so the panel under it clears the toolbar), clear of the rest */
            const at = middle();
            const size = kind === 'note' || kind === 'cut' ? { w: WIDE[kind], h: CARD_H } : makeSize(kind);
            addKind(kind, { at: clearNear({ x: at.x, y: at.y - 90 / flow.getZoom() }, size.w, size.h), corner: true });
          }}
          onUpload={() => { setMenu(null); setContext(null); void pickUpload({ at: middle() }); }}
          onTemplates={(from) => { setContext(null); setMenu({ screen: { x: from.left, y: from.top }, above: true, at: middle(), view: 'templates' }); }}
          onLibrary={(which) => openLibrary(which)} onCharacters={() => openLibrary('characters')} onHistory={() => setModal('history')}
        />}
        {cameraFor ? (
          <CameraPicker start={(() => { const n = now.current.nodes.find((x) => x.id === cameraFor); return n?.type === 'make' ? cameraOf(n.data.opts?.camera) : undefined; })()} onClose={() => setCameraFor(null)}
            onPick={(pick) => {
              /* kept on the node (shown on its tool, said when it is made) */
              const node = cameraFor;
              setCameraFor(null);
              willChange();
              setNodes((list) => list.map((n) => (n.id === node && n.type === 'make' ? { ...n, data: { ...n.data, opts: { ...n.data.opts, camera: picksAnything(pick) ? cameraText(pick) : undefined } } } : n)));
            }} />
        ) : null}
        {cutoutThen ? (
          <CutoutSetup onClose={() => { cutoutThen.cancel?.(); setCutoutThen(null); }} onSettings={() => { cutoutThen.cancel?.(); setCutoutThen(null); onOpenSettings(); }}
            onReady={() => { const then = cutoutThen; setCutoutThen(null); requestAnimationFrame(() => then.run()); }} />
        ) : null}
        {redraw && byPath.get(redraw.path) ? (
          <RedrawEditor src={sources.file(byPath.get(redraw.path)!)} start={redraw.start} onClose={() => setRedraw(null)} onMake={redrawMake}
            models={redrawModels.map((c) => ({ key: keyOfChoice(c), name: c.name, via: c.via, mask: Boolean(c.spec?.mask), markup: Boolean(c.spec?.markup), refs: c.spec?.refs ?? 1 }))}
            model={redrawFirst(redraw.id)} onSubject={() => subjectOf(redraw.path)}
            onAddRef={async (file) => { const [path] = await onImportFiles([file]); return path ? { path, src: URL.createObjectURL(file) } : null; }}
            pictures={files.filter((f) => f.kind === 'image' && f.path !== redraw.path && !/(^|\/)(expand-|mask-|markup-)/.test(f.path)).slice(0, 80).map((f) => ({ path: f.path, src: sources.file(f), name: f.name }))} />
        ) : null}
        {/* a picture's own tools: widened, cropped and turned, colored, lit anew */}
        {clipAI && byPath.get(clipAI.path) ? (() => {
          const clip = byPath.get(clipAI.path)!;
          const tool = CLIP_TOOLS.find((x) => x.key === clipAI.tool)!;
          const models = clipModels(tool, choicesFor(providers, 'video'));
          const last = lastModel('video');
          return <ClipToolEditor tool={tool} src={sources.file(clip)} frameAt={frameOf(clipAI.path)} length={(clip.durationMs ?? 0) / 1000} models={models}
            first={models.find((m) => isOwn(tool, m)) ?? models.find((m) => last && m.via === last.via && m.model === last.model)}
            files={files.filter((f) => !f.path.startsWith(`${WORK}/`))} srcOf={(f) => sources.file(f)} onClose={() => setClipAI(null)}
            onMake={(made) => makeFromClip(clipAI.id, clipAI.path, tool, made)} />;
        })() : null}
        {trimming && byPath.get(trimming.path) ? (
          <TrimEditor src={sources.file(byPath.get(trimming.path)!)} frameAt={frameOf(trimming.path)} onClose={() => setTrimming(null)}
            onDone={async (from, to) => { if (await runClip(trimming.id, { op: 'trim', path: trimming.path, from, to }, t('canvas.clipTools.trim'))) setTrimming(null); }} />
        ) : null}
        {pictureTool && byPath.get(pictureTool.path) ? (() => {
          const picture = byPath.get(pictureTool.path)!;
          const src = sources.file(picture);
          const close = () => setPictureTool(null);
          if (pictureTool.tool === 'expand') {
            return <ExpandEditor src={src} onClose={close} onMake={(expanded, model) => outpaint(pictureTool.id, expanded, model)} model={redrawFirst(pictureTool.id)}
              models={choicesFor(providers, 'image').map((c) => ({ key: keyOfChoice(c), name: c.name, via: c.via, mask: Boolean(c.spec?.mask), ratios: c.spec?.ratios ?? [] }))} />;
          }
          if (pictureTool.tool === 'crop') return <CropEditor src={src} name={picture.name} onClose={close} onDone={(file) => bringEdited(pictureTool.id, file, t('canvas.names.crop'))} />;
          if (pictureTool.tool === 'adjust') return <AdjustEditor src={src} name={picture.name} onClose={close} onDone={(file) => bringEdited(pictureTool.id, file, t('canvas.names.adjust'))} />;
          return (
            <LightPanel src={src} onClose={close} onMake={(made) => {
              /* made at once, as every picture window makes what it was set to */
              const shape = frameRatio(picture.w, picture.h) ?? '1:1';
              const id = board.spawn(pictureTool.id, 'image', { ...('preset' in made ? { preset: made.preset } : {}), prompt: made.words, opts: { ratio: shape }, title: nameFrom(pictureTool.id, t('canvas.actions.light')) });
              close();
              requestAnimationFrame(() => requestAnimationFrame(() => { void makeNow(id); }));
            }} />
          );
        })() : null}
        {modal === 'styles' || modal === 'effects' ? (
          <MaterialLibrary kind={modal} onClose={() => setModal(null)} onPick={(item) => { placeMaterial(modal, item); setModal(null); }} />
        ) : null}
        {modal === 'characters' ? (
          <CharacterLibrary projectId={projectId} forNode={modalFor !== null} onClose={() => setModal(null)}
            onUse={(c) => { void useCharacter(c); }} onGenerate={generateCharacter}
            onImport={() => pickFiles('image/*')}
            assets={files.filter((f) => f.kind === 'image').map((f) => ({ path: f.path, name: f.name, url: sources.file(f) }))} />
        ) : null}
        {modal === 'history' ? (
          <HistoryModal projectId={projectId} onClose={() => setModal(null)} onAdd={(path) => addFile(path, { at: middle() })}
            uploads={[...new Set(nodes.flatMap((n) => (n.type === 'file' ? [n.data.path] : [])))].flatMap((path) => {
              const file = byPath.get(path);
              if (!file || (file.kind !== 'image' && file.kind !== 'video' && file.kind !== 'audio')) return [];
              return [{ path, media: file.kind, url: file.kind === 'image' ? sources.file(file) : file.kind === 'video' ? sources.file(file) : undefined }];
            })} />
        ) : null}
        <BoardSwitcher boards={boards} current={boardId}
          onPick={(id) => { void showBoard(id); }} onAdd={() => addBoard()} onRename={renameBoard} onCopy={(id) => { void addBoard(id); }}
          onRemove={(id) => { void removeBoard(id); }}
          {...(studioHost ? {} : { onOpenApart: (id: string) => { const url = new URL(window.location.href); url.searchParams.set('canvas', id); window.open(url.toString(), '_blank'); } })} />
        <ToolCorner tool={tool} onTool={setTool} />
        <CornerBar outline={outline} onOutline={() => setOutline((v) => !v)} map={map} onMap={() => setMap((v) => !v)}
          wires={wires} onWires={() => setWires((v) => !v)} snap={snap} onSnap={() => setSnap((v) => !v)} />
        {outline ? (
          <Outline nodes={nodes} fileOf={board.fileOf} sources={sources} onShow={showNode} onClose={() => setOutline(false)} />
        ) : null}
        {ready && nodes.length === 0 && !board.readOnly ? <EmptyBoard shown={shown && fitted} /> : null}
        <Ripples taps={taps} onDone={(id) => setTaps((list) => list.filter((tap) => tap.id !== id))} />
        {menu ? (
          <AddMenu
            menu={menu}
            files={files}
            templates={templates}
            onClose={() => setMenu(null)}
            onKind={(kind) => { setMenu(null); addKind(kind, menu); }}
            onUpload={() => {
              setMenu(null);
              void pickUpload(menu);
            }}
            onFile={(file) => { setMenu(null); addFile(file.path, menu); }}
            onTemplate={(template) => { setMenu(null); void layTemplate(template, menu.at); }}
            onRemoveTemplate={(template) => { void removeTemplate(template); }}
          />
        ) : null}
        {context ? <ContextMenu canvas x={context.x} y={context.y} items={context.items} onClose={() => setContext(null)} /> : null}
        {cutAt && edges.some((e) => e.id === cutAt.id) ? (
          <button type="button" aria-label={t('canvas.removeWire')} title={t('canvas.removeWire')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => { willChange(); setEdges((list) => list.filter((e) => e.id !== cutAt.id)); setCutAt(null); }}
            className="cv-pop absolute z-30 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] text-[var(--cv-ink)] shadow-[var(--cv-float-shadow)] transition hover:bg-[#e5484d] hover:text-white"
            style={{ left: cutAt.x, top: cutAt.y }}><Scissors size={15} /></button>
        ) : null}
        {viewed ? <Viewer file={viewed} sources={sources} onClose={() => setViewing(null)} /> : null}
        {!fitted ? <CanvasLoading /> : null}
        <input ref={pickerRef} type="file" multiple hidden />
      </div>
    </BoardContext.Provider>
  );
}

export interface CanvasViewProps {
  /** false: kept under the edit, hidden, as it was left; its keys are the edit's then */
  shown?: boolean;
  projectId: string;
  /** the project's folder: where what is made lands (under assets/) */
  folder: string;
  /** the project's files (the Assets' listing) */
  files: readonly WorkspaceResource[];
  sources: MediaSources;
  onAddToFilm: (file: WorkspaceResource) => void;
  /** a cut's files onto the timeline, one after the other, in its order */
  onSendToFilm: (files: WorkspaceResource[]) => void;
  /** files of this computer brought into the project, as the Assets bring them: their paths in it */
  /** files brought into the project: into assets/, or `into` another folder under it (the canvas's own work: `assets/.canvas`, which the library never lists) */
  onImportFiles: (files: File[], onProgress?: ImportProgress, into?: string) => Promise<string[]>;
  /** where the person connects a service to make with */
  onOpenSettings: () => void;
  /** a file shown in the Assets */
  onReveal?: (path: string) => void;
  /** the chat beside the board (in an app with one): its agent writes a text node's words; the top bar opens and folds it */
  chat?: { open: boolean; toggle: () => void };
  /** a word that something went as asked (a template kept) */
  onNotice: (message: string) => void;
  /** the selected nodes into the chat as references (⌘L); none: no chat here */
  onRefer?: (refs: StudioRef[]) => void;
  /** a node to show (a chat's reference to it clicked): selected and in view; `n` is new each time */
  focus?: { id: string | null; board?: string; n: number } | null;
  /** a board to lay down below what is there (an example's canvas, copied in): its nodes new; `n` is new each time */
  insert?: { doc: CanvasDoc; n: number } | null;
  /** Files chosen in the independent project library, placed at the current board center. */
  addFiles?: { paths: string[]; n: number } | null;
  onError: (message: string) => void;
}

/** what a file is, by its name, for a board whose files are not the project's (an example's) */
function kindByName(path: string): WorkspaceResource['kind'] {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac'].includes(ext)) return 'audio';
  return ext === 'html' ? 'mg' : 'other';
}

const NOTHING = new Set<string>();
const NONE = new Map<string, number>();

/**
 * A board only looked at: an example film's canvas, shown in the Community. It pans and zooms; nothing on it moves,
 * is written in or made. `fileUrl` is where each file it shows is read from.
 */
function Preview({ doc, fileUrl }: { doc: CanvasDoc; fileUrl: (path: string) => string }) {
  const themeChanges = useThemeChanges();
  const dark = React.useMemo(() => document.documentElement.dataset.theme === 'dark', [themeChanges]); // eslint-disable-line react-hooks/exhaustive-deps
  const drawn = React.useMemo(() => toFlow(doc), [doc]);
  const board = React.useMemo<Board>(() => {
    const files = new Map<string, WorkspaceResource>();
    for (const n of doc.nodes) for (const path of [n.path, ...(n.versions ?? [])]) {
      if (path && !files.has(path)) {
        files.set(path, { path, name: path.split('/').pop() ?? path, dir: path.split('/').slice(0, -1).join('/'), size: 0, kind: kindByName(path), mtimeMs: 0 } as WorkspaceResource);
      }
    }
    const mediaOf: MediaOf = (path) => { const kind = files.get(path)?.kind; return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : null; };
    const nothing = () => {};
    return {
      files: [...files.values()],
      fileOf: (path) => files.get(path) ?? null,
      sources: { file: (file) => fileUrl(file.path), wave: () => '' },
      addToFilm: nothing, setData: nothing, resize: nothing, spawn: () => '', bring: nothing, cutout: nothing, clipAI: nothing, clipTool: nothing, shots: nothing, clipAssist: nothing, split: nothing, openTool: nothing, sizes: nothing, productSet: nothing, layers: nothing, assist: nothing, remove: nothing, willChange: nothing, editing: null, edit: nothing, single: null,
      choices: () => [], allChoices: () => [], fallback: () => null, run: () => undefined, error: () => undefined, stale: NOTHING, unused: NONE,
      make: nothing, stop: nothing, inputs: (id) => inputViews(drawn.nodes, drawn.edges, id, mediaOf), nameOf: () => '', reorderInputs: nothing, unwire: nothing, sideMenu: nothing,
      upload: nothing, wireIn: nothing, sendToFilm: nothing, view: nothing,
      makesIn: () => 0, busyIn: () => false, makeAll: nothing, ungroup: nothing, keepTemplate: nothing, keepCharacter: nothing, openLibrary: nothing, openCamera: nothing, useSubject: nothing, redraw: nothing, tidy: nothing, select: nothing, pick: nothing, openSettings: nothing, readOnly: true,
    };
  }, [doc, fileUrl, drawn]);
  return (
    <BoardContext.Provider value={board}>
      <ReactFlow<BoardNode, Edge>
        nodes={drawn.nodes}
        edges={drawn.edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={CANVAS_EDGE_TYPES}
        defaultEdgeOptions={CANVAS_EDGE_OPTIONS}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        colorMode={dark ? 'dark' : 'light'}
        panOnScroll
        zoomOnPinch
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.1}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
        className="openfilm-canvas"
      >
        <Dots />
      </ReactFlow>
    </BoardContext.Provider>
  );
}

export function CanvasPreview(props: { doc: CanvasDoc; fileUrl: (path: string) => string }) {
  return (
    <ReactFlowProvider>
      <Preview {...props} />
    </ReactFlowProvider>
  );
}

/** two presses on the board this close in time (ms) and place (px) are a double click */
const DOUBLE_MS = 400;
const DOUBLE_PX = 8;

export default function CanvasView(props: CanvasViewProps) {
  return (
    <ReactFlowProvider>
      <BoardView {...props} />
    </ReactFlowProvider>
  );
}
