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
 * Delete do as they say; a right click has the same in its menus. Far out a node is only its outline, and a clip plays
 * only under the pointer: a board of hundreds stays light. The board is React Flow (@xyflow/react): its nodes are ours.
 *
 * Its keys are its own: Studio's shortcuts leave them alone (`data-studio-canvas`, typing-target.ts).
 */
import React from 'react';
import { flushSync } from 'react-dom';
import {
  MiniMap, ReactFlow, ReactFlowProvider, SelectionMode, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Edge, type FinalConnectionState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AudioLines, Clapperboard, Download, Film, FolderSearch, Image as ImageIcon, LayoutTemplate, Maximize2, MousePointerClick, Play, Plus, Scissors, ScrollText, Sparkles, Square, Upload, UserRound } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { ApiError, api, projectEvents, type CanvasBoard, type CanvasCharacter } from '@/api';
import { BoardSwitcher, boardName, nextBoardName } from './boards';
import {
  CARD_H, CUT_W, FILE_W, GROUP_COLORS, MAKE_MEDIA, MAKE_W, NOTE_H, NOTE_W, canvasId, cardWidth, makeSize, canvasKey, copyOf, emptyHistory, inputsChanged, inputsKey, inputsOf, isStale, makeName, makeRequest, modeOf, frameRatio, ratioOf,
  nextOrder, readCanvasDoc, redo, remember, reorder, undo, withVersion,
  type CanvasDoc, type CanvasHistory, type MediaOf,
} from '@/lib/canvas';
import { useProviders } from '@/lib/providers';
import { useLibraryVoices } from '@/lib/library-voices';
import { defaultVoice, serviceOf, voicesOf } from './voices';
import { builtInTemplates, type CanvasTemplate } from '@/lib/canvas-templates';
import { RESOURCE_DRAG_TYPE, isComputerFileDrag, readResourceDragData } from '@/lib/resource-drag';
import type { MediaSources, WorkspaceResource } from '@/lib/workspace-resources';
import { studioHost, type StudioRef } from '@/lib/host';
import { useThemeChanges } from '@/lib/theme-changes';
import { ContextMenu, type ContextMenuEntry } from '../ContextMenu';
import {
  BoardContext, allChoicesFor, boxOf, choiceOf, choicesFor, defaultChoice, GROUP_HELD, fitGroups, fromFlow, tidyGroup, unstack, inputViews, keepModelTime, runErrors, runs, runsChanged, shownBoards, startRun, toFlow, useRuns,
  type Board, type BoardNode, type FrameData, type FrameNode, type MakeData, type MakingNode, type Side, type SpawnKind,
} from './board';
import { BetaTag, BottomToolbar, CornerBar, Dots, Outline, Viewer } from './chrome';
import { AddMenu, type MenuAt } from './menus';
import { CHARACTER_PARTS, CharacterLibrary, HistoryModal, MaterialLibrary } from './libraries';
import { RedrawEditor, type RedrawWay } from './redraw';
import { presetOf } from '@/lib/canvas-presets';
import { FRAME_COLOR, NODE_TYPES } from './nodes';

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

function BoardView({ shown = true, projectId, folder, files, sources, onAddToFilm, onSendToFilm, onImportFiles, onOpenSettings, onReveal, chat, onError, onNotice, focus, insert, onRefer }: CanvasViewProps) {
  const t = useT();
  const flow = useReactFlow<BoardNode, Edge>();
  const [nodes, setNodes, onNodesChange] = useNodesState<BoardNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [ready, setReady] = React.useState(false);
  /* the board is seen once it is fitted to what is on it: never first drawn close up and then pulled out to all of it */
  const [fitted, setFitted] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [menu, setMenu] = React.useState<MenuAt | null>(null);
  const [context, setContext] = React.useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  const [tool, setTool] = React.useState<'select' | 'hand'>('select');
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
  const [redraw, setRedraw] = React.useState<{ id: string; path: string } | null>(null);
  /* the node a library was opened for (its panel's chip): what is picked goes into it */
  const [modalFor, setModalFor] = React.useState<string | null>(null);
  const openLibrary = (which: 'characters' | 'styles' | 'effects', node?: string) => { setModalFor(node ?? null); setModal(which); };
  const boardRef = React.useRef(boardId);
  boardRef.current = boardId;
  const saved = React.useRef('');
  const rootRef = React.useRef<HTMLDivElement>(null);
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
  const willChange = React.useCallback(() => { history.current = remember(history.current, docNow()); }, []);
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
    if (id === boardRef.current) return;
    const doc = docNow();
    if (ready && canvasKey(doc) !== saved.current) await api.putCanvas(projectId, doc, boardRef.current).catch(() => {});
    setReady(false);
    setEditing(null);
    setBoardId(id);
    keepLastBoard(projectId, id);
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

  /* read once a board is shown; shown fitted to the view */
  const [loads, setLoads] = React.useState(0);
  reloadBoard.current = () => setLoads((n) => n + 1);
  React.useEffect(() => {
    let live = true;
    void api.canvas(projectId, boardId).then((raw) => {
      if (!live) return;
      const doc = readCanvasDoc(raw);
      saved.current = canvasKey(doc);
      history.current = emptyHistory();
      show(doc);
      setReady(true);
      /* once the cards are measured: every group round what is in it (a board an agent laid out loosely), then all in view */
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setNodes((list) => fitGroups(unstack(list)));
        /* an empty board's fit never settles: seen within a moment whatever it does */
        const seen = () => { if (live) setFitted(true); };
        void Promise.race([flow.fitView({ padding: 0.2, maxZoom: 1 }), new Promise((done) => { window.setTimeout(done, 300); })]).then(seen, seen);
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
    void api.canvas(projectId, boardRef.current).then((raw) => {
      const doc = readCanvasDoc(raw);
      const key = canvasKey(doc);
      saved.current = key;
      if (key === canvasKey(docNow())) return;
      willChange();
      const before = new Set(now.current.nodes.map((n) => n.id));
      show(doc, selectedIds());
      /* what it added, brought into view */
      const added = doc.nodes.filter((n) => !before.has(n.id) && !n.parent).map((n) => ({ id: n.id }));
      if (added.length) requestAnimationFrame(() => requestAnimationFrame(() => { void flow.fitView({ nodes: added, padding: 0.15, maxZoom: 1, duration: 300 }); }));
    }, () => {});
  }), [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* written a moment after the last change that says something new (a selection says nothing) */
  React.useEffect(() => {
    if (!ready) return undefined;
    const doc = fromFlow(nodes, edges);
    const key = canvasKey(doc);
    if (key === saved.current) return undefined;
    const write = setTimeout(() => {
      void api.putCanvas(projectId, doc, boardId).then(() => { saved.current = key; },
        (e: unknown) => onError(t('canvas.saveFailed').replace('{error}', e instanceof Error ? e.message : String(e))));
    }, SAVE_AFTER_MS);
    return () => clearTimeout(write);
  }, [nodes, edges, ready, projectId, boardId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const added = doc.nodes.map((n) => (n.parent && !groups.has(n.parent) ? (({ parent: _parent, ...rest }) => rest)(n) : n));
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
  const place = (node: BoardNode, from?: MenuAt['from']) => {
    willChange();
    /* off the screen: the board moves to it, as far zoomed as it is */
    requestAnimationFrame(() => requestAnimationFrame(() => {
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
  const topLeft = (at: MenuAt['at'], corner: boolean | undefined, w: number, h: number) => (corner ? at : { x: at.x - w / 2, y: at.y - h / 2 });
  const addKind = (kind: SpawnKind, at: MenuAt['at'], from?: MenuAt['from'], corner?: boolean) => {
    const id = canvasId('n');
    const w = WIDE[kind];
    if (kind === 'note') {
      /* new, it is square and says what it can start as; written in, it is a box of words */
      place({ id, type: 'note', position: topLeft(at, corner, w, CARD_H), width: w, height: CARD_H, data: { text: '' } }, from);
    } else if (kind === 'cut') {
      place({ id, type: 'cut', position: topLeft(at, corner, w, CARD_H), width: w, height: CARD_H, data: {} }, from);
    } else {
      const size = makeSize(kind);
      place({ id, type: 'make', position: topLeft(at, corner, size.w, size.h), width: size.w, height: size.h, data: { make: kind, prompt: '' } }, from);
    }
    return id;
  };
  const addFile = (path: string, at: MenuAt['at'], from?: MenuAt['from'], corner?: boolean, size?: { w: number; h: number }) => {
    place({ id: canvasId('n'), type: 'file', position: topLeft(at, corner, size?.w ?? FILE_W, size?.h ?? CARD_H), data: { path }, ...(size ? { width: size.w, height: size.h } : {}) }, from);
  };
  const openMenu = (clientX: number, clientY: number, from?: MenuAt['from']) => {
    setContext(null);
    setMenu({ screen: { x: clientX, y: clientY }, at: flow.screenToFlowPosition({ x: clientX, y: clientY }), ...(from ? { from } : {}) });
  };
  /** the board's middle, as a point on it */
  const middle = () => {
    const box = rootRef.current!.getBoundingClientRect();
    return flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
  };

  /** files of this computer, picked: brought into the project first (as the Assets bring them) */
  const picked = React.useRef<((files: File[]) => void) | null>(null);
  const pickFiles = (accept: string) => new Promise<string[]>((done) => {
    const input = pickerRef.current;
    if (!input) { done([]); return; }
    input.accept = accept;
    input.value = '';
    picked.current = (list) => { void onImportFiles(list).then(done, (e: unknown) => { onError(e instanceof Error ? e.message : String(e)); done([]); }); };
    input.click();
  });

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
    /* a clip made from frames or references: they are there first */
    if (node.make === 'video') {
      const pictures = inputs.filter((i) => 'media' in i && i.media === 'image').length;
      const way = modeOf(node.opts, choiceOf(providers, node.make, node.via, node.model)?.spec, pictures);
      if (way === 'first' && pictures < 1) return fail('canvas.makeNeeds.first');
      if (way === 'firstLast' && pictures < 2) return fail('canvas.makeNeeds.firstLast');
      if ((way === 'refs' || way === 'omni') && pictures < 1) return fail('canvas.makeNeeds.refs');
      /* from a first frame: its shape, unless one was picked */
      const first = inputs.find((i) => 'media' in i && i.media === 'image');
      const frame = first && 'path' in first ? byPath.get(first.path) : undefined;
      if ((way === 'first' || way === 'firstLast') && !node.opts?.ratio && frame) {
        const shape = frameRatio(frame.w, frame.h, choiceOf(providers, node.make, node.via, node.model)?.spec);
        if (shape) node.opts = { ...node.opts, ratio: shape };
      }
    }
    /* a voice-over in the voice picked, else in its service's first voice in the person's language */
    if (node.make === 'tts' && !node.opts?.voice) {
      const voice = defaultVoice(voicesOf(libraryVoices, serviceOf(choiceOf(providers, 'tts', node.via, node.model))), language);
      if (!voice) return fail('canvas.make.noVoice');
      node.opts = { ...node.opts, voice: voice.id };
    }
    const request = makeRequest(node as MakingNode, inputs, makeName(node as MakingNode), choiceOf(providers, node.make, node.via, node.model)?.spec);
    if (!String(request.args.prompt ?? request.args.text).trim()) { runErrors.set(`${projectId}/${id}`, t('canvas.make.noWords')); runsChanged(); return Promise.resolve(false); }
    const pick = node.via ? { via: node.via, ...(node.model ? { model: node.model } : {}) } : {};
    const say = { nothing: t('canvas.make.nothing'), balance: t('canvas.make.noBalance') };
    /* two or four at once: one after another, each a version of its own (a clip asked again is made anew) */
    const count = node.opts?.count ?? 1;
    const choice = choiceOf(providers, node.make, node.via, node.model);
    const spec = choice?.spec;
    /* how long it took, kept for the model's list */
    const timed = async (run: ReturnType<typeof makeRequest>) => {
      const started = Date.now();
      const ok = await startRun(projectId, folder, id, run, pick, inputsKey(node, inputs), say, boardId);
      if (ok && choice) keepModelTime(choice.via, choice.model, (Date.now() - started) / 1000);
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
        if (!ok) break;
      }
      return made;
    })();
  };
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
  const write = async (id: string, ask: string): Promise<string | null> => {
    const inputs = edges.filter((e) => e.target === id).map((e) => nodes.find((n) => n.id === e.source))
      .flatMap((n) => (n?.type === 'note' && n.data.text.trim() ? [n.data.text] : []));
    const own = nodes.find((n) => n.id === id);
    const mine = own?.type === 'note' ? own.data.text.trim() : '';
    try {
      const { text } = await api.canvasWrite(projectId, ask, mine ? [...inputs, `(the node's words now, to rework) ${mine}`] : inputs);
      if (!text) return null;
      willChange();
      setNodes((all) => all.map((n) => (n.id === id && n.type === 'note' ? { ...n, data: { ...n.data, text } } : n)));
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.body.code === 'no-agent') return t('canvas.write.noAgent');
      return error instanceof Error ? error.message : String(error);
    }
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
  /** a text node of the style's or effect's words, wired into the node it was picked for (or in the middle) */
  const placeMaterial = (kind: 'styles' | 'effects', item: { id: string; words: string }) => {
    const text = `${t(`canvas.library.tag.${kind}`)} · ${t(`canvas.${kind}.names.${item.id}`)} — ${item.words}`;
    const target = modalFor && now.current.nodes.some((n) => n.id === modalFor) ? modalFor : null;
    const at = target ? spotBeside(target, 'target', NOTE_W) : middle();
    place({ id: canvasId('n'), type: 'note', position: target ? at : { x: at.x - NOTE_W / 2, y: at.y - NOTE_H / 2 }, width: NOTE_W, height: NOTE_H, data: { text } },
      target ? { node: target, side: 'target' } : undefined);
  };
  /** a character's pictures, copied into the project: into the node it was picked for (its portrait), or a group of them */
  const useCharacter = async (character: CanvasCharacter) => {
    try {
      const used = await api.useCanvasCharacter(projectId, character.id);
      const target = modalFor && now.current.nodes.some((n) => n.id === modalFor) ? modalFor : null;
      if (target) {
        const main = used.pictures.find((p) => p.role === 'face') ?? used.pictures.find((p) => p.role === 'body') ?? used.pictures[0];
        const shape: Record<string, string> = { face: '1:1', body: '9:16', expressions: '1:1', turnaround: '16:9' };
        const size = main ? { w: cardWidth(shape[main.role] ?? '1:1'), h: CARD_H } : null;
        if (main && size) addFile(main.path, spotBeside(target, 'target', size.w), { node: target, side: 'target' }, true, size);
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
  const generateCharacter = (name: string, about: string) => {
    const group = canvasId('n');
    const note = canvasId('n');
    const parts = CHARACTER_PARTS.map((part) => ({ ...part, id: canvasId('n'), size: makeSize('image', presetOf(part.preset)?.ratio) }));
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
  /**
   * A picture changed in part: what was drawn kept in the project (a mask or a markup), and a new picture made from it
   * beside it, by a model that redraws so, at once.
   */
  const redrawMake = async (way: RedrawWay, drawn: Blob, prompt: string) => {
    const source = redraw;
    if (!source) return;
    const choice = choicesFor(providers, 'image').find((c) => c.spec?.[way]);
    if (!choice) { onError(t('canvas.redraw.noModel')); return; }
    try {
      const [kept] = await onImportFiles([new File([drawn], `${way}-${Date.now().toString(36)}.png`, { type: 'image/png' })]);
      if (!kept) return;
      const picture = byPath.get(source.path);
      const ratio = picture?.w && picture.h ? ratioOf(`${picture.w}:${picture.h}`, choice.spec) : undefined;
      const size = makeSize('image', ratio);
      const id = canvasId('n');
      place({ id, type: 'make', position: spotBeside(source.id, 'source', size.w), width: size.w, height: size.h,
        data: { make: 'image', prompt, via: choice.via, ...(choice.model ? { model: choice.model } : {}), opts: { ...(ratio ? { ratio } : {}), [way]: kept } } },
      { node: source.id, side: 'source' });
      setRedraw(null);
      requestAnimationFrame(() => requestAnimationFrame(() => { void makeNow(id); }));
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
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
      const role = n.type === 'make' ? CHARACTER_PARTS.find((p) => p.preset === n.data.preset)?.role ?? 'other' : node.type === 'frame' ? 'other' : 'body';
      return [{ role, path }];
    });
    if (!pictures.length) { onError(t('canvas.characters.noPictures')); return; }
    const about = inIt.flatMap((n) => (n.type === 'note' && n.data.text.trim() ? [n.data.text.trim()] : [])).join('\n\n');
    const name = node.type === 'frame' ? node.data.label : byPath.get(pictures[0]!.path)?.name.replace(/\.[^.]+$/, '') ?? t('canvas.characters.title');
    try {
      await api.saveCanvasCharacter(projectId, { name, ...(about ? { about } : {}), pictures });
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
  const keepShown = (id: string) => {
    requestAnimationFrame(() => {
      const box = rootRef.current?.getBoundingClientRect();
      const el = rootRef.current?.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
      if (!box || !el) return;
      const node = el.getBoundingClientRect();
      const type = now.current.nodes.find((n) => n.id === id)?.type;
      /* its panel as drawn (a frame later), else as it is about to be */
      const drawn = rootRef.current?.querySelector('.react-flow__node-toolbar .nodrag')?.getBoundingClientRect();
      const panel = drawn && drawn.height > 40 ? { w: drawn.width, h: drawn.height }
        : type === 'make' ? { w: Math.min(660, box.width * 0.86), h: 260 } : type === 'cut' ? { w: 420, h: 80 } : { w: 0, h: 0 };
      const mid = node.left + node.width / 2;
      const left = Math.min(node.left, mid - panel.w / 2);
      const right = Math.max(node.right, mid + panel.w / 2);
      const bottom = node.bottom + (panel.h ? panel.h + 14 : 0);
      const pad = 24;
      const dx = left < box.left + pad ? box.left + pad - left : right > box.right - pad ? box.right - pad - right : 0;
      /* clear of the toolbar at the foot */
      const dy = bottom > box.bottom - 76 ? Math.max(box.bottom - 76 - bottom, box.top + 60 - node.top) : node.top < box.top + 50 ? box.top + 50 - node.top : 0;
      if (!dx && !dy) return;
      const view = flow.getViewport();
      void flow.setViewport({ ...view, x: view.x + dx, y: view.y + dy }, { duration: 220 });
    });
  };
  const board = React.useMemo<Board>(() => ({
    files,
    fileOf: (path) => byPath.get(path) ?? null,
    sources,
    addToFilm: onAddToFilm,
    setData: (id, data) => setNodes((list) => {
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
    }),
    resize: (id, size) => setNodes((list) => unstack(list.map((n) => (n.id === id ? { ...n, width: size.w, height: size.h } : n)), [id])),
    spawn: (id, kind, data) => {
      const made = addKind(kind, spotBeside(id, 'source', WIDE[kind]), { node: id, side: 'source' }, true);
      if (data) setNodes((list) => list.map((n) => (n.id === made ? { ...n, data: { ...n.data, ...data } } as BoardNode : n)));
    },
    bring: (id, list) => {
      void onImportFiles(list).then((paths) => {
        const at = spotBeside(id, 'source', FILE_W);
        paths.forEach((path, i) => addFile(path, { x: at.x + (i % 3) * (FILE_W / 2 + 24), y: at.y + Math.floor(i / 3) * (CARD_H / 2 + 48) }, i ? undefined : { node: id, side: 'source' }, true));
      }, (e: unknown) => onError(e instanceof Error ? e.message : String(e)));
    },
    cutout: (id, path) => {
      if (!folder) return;
      onNotice(t('canvas.actions.cutting'));
      void api.make(folder, 'cutout', { src: path, out: `${path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'picture'}-cutout` }, {}).then((text) => {
        const receipt = JSON.parse(text) as { src?: string };
        if (receipt.src) addFile(receipt.src, spotBeside(id, 'source', FILE_W), { node: id, side: 'source' }, true);
      }, (e: unknown) => onError(e instanceof Error ? e.message : String(e)));
    },
    remove,
    willChange,
    editing,
    edit: (id) => { if (id) willChange(); setEditing(id); },
    select: (id, add) => setNodes((list) => list.map((n) => (n.id === id ? { ...n, selected: add ? !n.selected : true } : add ? n : { ...n, selected: false }))),
    single,
    choices: (kind) => choicesFor(providers, kind),
    allChoices: (kind) => allChoicesFor(providers, kind),
    fallback: (kind) => defaultChoice(providers, kind),
    run: (id) => runs.get(`${projectId}/${id}`),
    error: (id) => runErrors.get(`${projectId}/${id}`),
    stale: making.stale,
    unused: making.unused,
    make: (id) => { void makeNow(id); },
    stop: (id) => runs.get(`${projectId}/${id}`)?.abort.abort(),
    inputs: (id) => inputViews(now.current.nodes, now.current.edges, id, mediaOf),
    unwire: (edge) => { willChange(); setEdges((list) => list.filter((e) => e.id !== edge)); },
    sideMenu: (id, side, screen) => {
      setContext(null);
      setMenu({ screen, at: spotBeside(id, side, MAKE_W), corner: true, from: { node: id, side } });
    },
    upload: (id, how) => {
      const node = now.current.nodes.find((n) => n.id === id);
      const kind = node?.type === 'make' ? node.data.make : null;
      const accept = how === 'input' ? (kind === 'video' ? `${ACCEPT.image},${ACCEPT.video}` : ACCEPT.image) : kind === 'image' ? ACCEPT.image : kind === 'video' ? ACCEPT.video : ACCEPT.audio;
      void pickFiles(accept).then((paths) => {
        if (!paths.length) return;
        if (how === 'version') {
          willChange();
          setNodes((list) => list.map((n) => (n.id === id && n.type === 'make' ? { ...n, data: paths.reduce((d, path) => withVersion(d, { path, made: '' }), n.data) } : n)));
          return;
        }
        for (const path of paths) addFile(path, spotBeside(id, 'target', FILE_W), { node: id, side: 'target' }, true);
      });
    },
    wireIn: (id, from) => {
      if ('path' in from) { addFile(from.path, spotBeside(id, 'target', FILE_W), { node: id, side: 'target' }, true); return; }
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
    redraw: (id, path) => setRedraw({ id, path }),
    tidy: (group) => { willChange(); setNodes((list) => tidyGroup(list, group)); },
    openSettings: onOpenSettings,
    ...(chat ? { write } : {}),
  }), [chat, boardId, files, byPath, sources, onAddToFilm, setNodes, editing, single, providers, runsSeen, making, projectId, folder, onOpenSettings, nodes, edges, onReveal]); // eslint-disable-line react-hooks/exhaustive-deps

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
        const added: BoardNode[] = paths.map((path, i) => ({ id: canvasId('n'), type: 'file', position: { x: at.x - FILE_W / 2 + i * (FILE_W + 24), y: at.y - CARD_H / 2 }, data: { path } }));
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
    if (n.type === 'note') return { kind: 'node', id: n.id, nodeKind: 'note', label: words(n.data.text, t('canvas.kinds.note')), text: n.data.text };
    if (n.type === 'frame') return { kind: 'node', id: n.id, nodeKind: 'group', label: n.data.label || t('canvas.group') };
    if (n.type === 'cut') return { kind: 'node', id: n.id, nodeKind: 'cut', label: t('canvas.kinds.cut') };
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
    if (!now.current.nodes.some((n) => n.id === focus.id)) { onError(t('canvas.gone')); return; }
    showNode(focus.id);
  }, [focus, ready]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!shown) return;
    const target = event.target as HTMLElement;
    if (target !== document.body && !rootRef.current?.contains(target)) return;
    /* a menu open has the keys (its Escape closes it, and only it); a dialog over the board has them all (its own undo) */
    if (menu || context) return;
    if (modal || redraw || target.closest('[role="dialog"]')) { if (target === document.body) event.stopPropagation(); return; }
    if (viewing) { if (event.key === 'Escape') { event.preventDefault(); setViewing(null); } return; }
    if (picking && event.key === 'Escape') { event.preventDefault(); setPicking(null); return; }
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
        if (note.height === CARD_H) setNodes((list) => list.map((n) => (n.id === single ? { ...n, width: NOTE_W, height: NOTE_H } : n)));
        setEditing(single);
      });
      rootRef.current?.querySelector<HTMLTextAreaElement>(`.react-flow__node[data-id="${CSS.escape(single)}"] textarea`)?.focus();
    }
    else if (!mod && key === 'v') { done(); setTool('select'); }
    else if (!mod && key === 'h') { done(); setTool('hand'); }
    else if (!mod && (key === 'backspace' || key === 'delete')) { done(); removeSelected(); }
    else if (mod && key === '0') { done(); void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 200 }); }
    else if (mod && key === 'f') { done(); setOutline(true); }
    else if (!mod && (key === '/' || key === 'tab')) {
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
    const into = new Map<string, Edge[]>();
    for (const e of edges) if (takes.has(e.target)) into.set(e.target, [...(into.get(e.target) ?? []), e]);
    const place = new Map<string, number>();
    for (const list of into.values()) {
      if (list.length < 2) continue;
      const rank = (e: Edge) => (typeof e.data?.order === 'number' ? e.data.order : Infinity);
      list.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).forEach(({ e }, i) => place.set(e.id, i + 1));
    }
    return edges.map((e) => {
      const lit = single != null && (e.source === single || e.target === single);
      return {
        ...e,
        /* lit: blue, glowing and flowing towards what it feeds (globals.css .lit) */
        ...(lit ? { className: 'lit', zIndex: 1 } : {}),
        ...(place.has(e.id) ? {
          label: String(place.get(e.id)), labelBgPadding: [5, 2] as [number, number], labelBgBorderRadius: 4,
          labelStyle: { fontSize: 11, fontWeight: 500, fill: lit ? '#fff' : 'var(--cv-label)' }, labelBgStyle: { fill: lit ? LIT : 'var(--cv-float)', stroke: 'var(--cv-float-line)' },
        } : {}),
      };
    });
  }, [nodes, edges, single]);

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
      { id: 'upload', label: t('canvas.menu.upload'), icon: <Upload size={15} />, onSelect: () => { void pickFiles(ACCEPT.media).then((paths) => paths.forEach((path, i) => addFile(path, { x: at.x + i * 40, y: at.y + i * 40 }))); } },
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
          edges={wires ? drawn : NO_EDGES}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStart={willChange}
          onNodeDragStop={() => setNodes((list) => fitGroups(list))}
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
            /* a press on the ⊕ without a drag is its click (its menu), not a wire */
            const start = flow.flowToScreenPosition(state.from);
            if (Math.hypot(point.clientX - start.x, point.clientY - start.y) < 8) return;
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
          connectOnClick={false}
          onNodeContextMenu={nodeMenu}
          onPaneContextMenu={paneMenu}
          onEdgeContextMenu={edgeMenu}
          /* a click on the board or on another node: done writing */
          onPaneClick={() => { setContext(null); setEditing(null); }}
          onNodeClick={(event, node) => {
            if (editing && editing !== node.id) setEditing(null);
            if (!picking) { if (!event.shiftKey && !event.metaKey && !event.ctrlKey && node.type !== 'frame') keepShown(node.id); return; }
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
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={['Meta', 'Shift', 'Control']}
          connectionRadius={30}
          snapToGrid={snap}
          snapGrid={[20, 20]}
          paneClickDistance={8}
          nodeClickDistance={8}
          elevateNodesOnSelect
          onlyRenderVisibleElements
          minZoom={0.1}
          maxZoom={4}
          proOptions={{ hideAttribution: true }}
          className={`openfilm-canvas transition-opacity duration-150 ${fitted ? 'opacity-100' : 'opacity-0'} ${tool === 'hand' ? 'cursor-grab' : ''}`}
        >
          <Dots />
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
          adding={Boolean(menu && !menu.from && menu.above)}
          onAdd={(from) => {
            if (menu) { setMenu(null); return; }
            setContext(null);
            setMenu({ screen: { x: from.left, y: from.top }, above: true, at: middle() });
          }}
          tool={tool}
          onTool={setTool}
          onTemplates={(from) => { setContext(null); setMenu({ screen: { x: from.left, y: from.top }, above: true, at: middle(), view: 'templates' }); }}
          onLibrary={(which) => openLibrary(which)} onCharacters={() => openLibrary('characters')} onHistory={() => setModal('history')}
        />}
        {redraw && byPath.get(redraw.path) ? (
          <RedrawEditor src={sources.file(byPath.get(redraw.path)!)} onClose={() => setRedraw(null)} onMake={redrawMake} />
        ) : null}
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
          <HistoryModal projectId={projectId} onClose={() => setModal(null)} onAdd={(path) => addFile(path, middle())}
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
        <BetaTag />
        <CornerBar outline={outline} onOutline={() => setOutline((v) => !v)} map={map} onMap={() => setMap((v) => !v)}
          wires={wires} onWires={() => setWires((v) => !v)} snap={snap} onSnap={() => setSnap((v) => !v)} />
        {outline ? (
          <Outline nodes={nodes} fileOf={board.fileOf} sources={sources} onShow={showNode} onClose={() => setOutline(false)} />
        ) : null}
        {ready && nodes.length === 0 && !board.readOnly ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-5 px-6">
            <div className="flex items-center gap-2 text-[13px] text-[var(--cv-label)]"><MousePointerClick size={16} />{t('canvas.empty')}</div>
            {/* to start: a node of each kind in the middle of the view, or the agent asked for a script */}
            <div className="pointer-events-auto flex flex-wrap justify-center gap-2">
              {([
                /* in the order a film is made: the words, the pictures, the sound, the clips, the cut */
                ['script', ScrollText, 'canvas.start.script'], ['image', ImageIcon, 'canvas.start.image'], ['music', AudioLines, 'canvas.start.audio'],
                ['video', Film, 'canvas.start.video'], ['cut', Scissors, 'canvas.start.cut'],
              ] as const).map(([kind, Icon, label]) => (
                <button key={kind} type="button"
                  onClick={() => {
                    if (kind === 'script') { if (studioHost?.ask) studioHost.ask({ text: t('canvas.start.scriptAsk'), refs: [] }); else addKind('note', middle()); return; }
                    addKind(kind, middle());
                  }}
                  className="flex h-14 w-[184px] items-center gap-3 rounded-2xl border !border-[var(--cv-float-line)] bg-[var(--cv-float)] px-3 text-left text-[14px] font-medium text-[var(--cv-ink)] transition hover:bg-[color-mix(in_srgb,var(--cv-float)_93%,var(--cv-ink))]">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--cv-chip)]"><Icon size={16} /></span>
                  <span className="min-w-0 flex-1 truncate">{t(label)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {menu ? (
          <AddMenu
            menu={menu}
            files={files}
            templates={templates}
            onClose={() => setMenu(null)}
            onKind={(kind) => { setMenu(null); addKind(kind, menu.at, menu.from, menu.corner); }}
            onUpload={() => {
              setMenu(null);
              void pickFiles(ACCEPT.media).then((paths) => {
                paths.forEach((path, i) => addFile(path, { x: menu.at.x, y: menu.at.y + i * 40 }, menu.from, menu.corner));
              });
            }}
            onFile={(file) => { setMenu(null); addFile(file.path, menu.at, menu.from, menu.corner); }}
            onTemplate={(template) => { setMenu(null); void layTemplate(template, menu.at); }}
            onRemoveTemplate={(template) => { void removeTemplate(template); }}
          />
        ) : null}
        {context ? <ContextMenu x={context.x} y={context.y} items={context.items} onClose={() => setContext(null)} /> : null}
        {viewed ? <Viewer file={viewed} sources={sources} onClose={() => setViewing(null)} /> : null}
        <input ref={pickerRef} type="file" multiple hidden onChange={(event) => { const list = [...(event.target.files ?? [])]; if (list.length) picked.current?.(list); }} />
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
  onImportFiles: (files: File[]) => Promise<string[]>;
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
  focus?: { id: string; n: number } | null;
  /** a board to lay down below what is there (an example's canvas, copied in): its nodes new; `n` is new each time */
  insert?: { doc: CanvasDoc; n: number } | null;
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
      addToFilm: nothing, setData: nothing, resize: nothing, spawn: nothing, bring: nothing, cutout: nothing, remove: nothing, willChange: nothing, editing: null, edit: nothing, single: null,
      choices: () => [], allChoices: () => [], fallback: () => null, run: () => undefined, error: () => undefined, stale: NOTHING, unused: NONE,
      make: nothing, stop: nothing, inputs: (id) => inputViews(drawn.nodes, drawn.edges, id, mediaOf), unwire: nothing, sideMenu: nothing,
      upload: nothing, wireIn: nothing, sendToFilm: nothing, view: nothing,
      makesIn: () => 0, busyIn: () => false, makeAll: nothing, ungroup: nothing, keepTemplate: nothing, keepCharacter: nothing, openLibrary: nothing, redraw: nothing, tidy: nothing, select: nothing, pick: nothing, openSettings: nothing, readOnly: true,
    };
  }, [doc, fileUrl, drawn]);
  return (
    <BoardContext.Provider value={board}>
      <ReactFlow<BoardNode, Edge>
        nodes={drawn.nodes}
        edges={drawn.edges}
        nodeTypes={NODE_TYPES}
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

export default function CanvasView(props: CanvasViewProps) {
  return (
    <ReactFlowProvider>
      <BoardView {...props} />
    </ReactFlowProvider>
  );
}
