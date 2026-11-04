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
import {
  Background, BackgroundVariant, MiniMap, ReactFlow, ReactFlowProvider, SelectionMode, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Edge, type FinalConnectionState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Clapperboard, Download, FolderSearch, LayoutTemplate, Maximize2, Play, Plus, Sparkles, Square } from 'lucide-react';
import { useT } from '@/i18n';
import { api, projectEvents } from '@/api';
import {
  FILE_W, GROUP_COLORS, MAKE_W, NOTE_H, NOTE_W, canvasId, canvasKey, copyOf, emptyHistory, inputsKey, inputsOf, isStale, makeName, makeRequest,
  nextOrder, readCanvasDoc, redo, remember, reorder, undo, withVersion,
  type CanvasDoc, type CanvasHistory, type MediaOf,
} from '@/lib/canvas';
import { useProviders } from '@/lib/providers';
import { builtInTemplates, type CanvasTemplate } from '@/lib/canvas-templates';
import { RESOURCE_DRAG_TYPE, isComputerFileDrag, readResourceDragData } from '@/lib/resource-drag';
import type { MediaSources, WorkspaceResource } from '@/lib/workspace-resources';
import type { StudioRef } from '@/lib/host';
import { useThemeChanges } from '@/lib/theme-changes';
import { ContextMenu, type ContextMenuEntry } from '../ContextMenu';
import {
  BoardContext, CUT_W, boxOf, choicesFor, defaultChoice, fromFlow, inputViews, runErrors, runs, runsChanged, shownBoards, startRun, toFlow, useRuns,
  type Board, type BoardNode, type FrameData, type FrameNode, type MakingNode, type Side, type SpawnKind,
} from './board';
import { BottomToolbar, ChatToggle, Outline, Viewer, ZoomBar } from './chrome';
import { AddMenu, type MenuAt } from './menus';
import { FRAME_COLOR, NODE_TYPES } from './nodes';

/** how long after the last change the board is written */
const SAVE_AFTER_MS = 600;
/** a group's room around what is in it, and above it for its name */
const GROUP_PAD = 32;
const GROUP_HEAD = 40;
/** how far a paste lands from what was copied, each time again */
const PASTE_STEP = 32;
/** the room between a node and what is added beside it */
const BESIDE = 120;
/** a wire into or out of the node selected */
const LIT = 'var(--cv-edge-lit)';

const MOD = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';
const SHIFT = MOD === '⌘' ? '⇧⌘' : 'Ctrl+Shift+';
/** what each kind of node starts as, wide (and high, for words) */
const WIDE: Record<SpawnKind | 'file', number> = { note: NOTE_W, image: MAKE_W, video: MAKE_W, sfx: MAKE_W, music: MAKE_W, cut: CUT_W, file: FILE_W };
/** what the computer's file picker offers, by what it is for */
const ACCEPT = { image: 'image/*', video: 'video/*', audio: 'audio/*', media: 'image/*,video/*,audio/*' } as const;

const unselectEdges = (list: Edge[]) => (list.some((e) => e.selected) ? list.map((e) => (e.selected ? { ...e, selected: false } : e)) : list);

/** what was copied last, on any board of this page: pasted with new ids, a step further each time */
let clipboard: { doc: CanvasDoc; pasted: number } | null = null;

function BoardView({ projectId, folder, files, sources, onAddToFilm, onSendToFilm, onImportFiles, onOpenSettings, onReveal, chat, onError, onNotice, focus, insert, onRefer }: CanvasViewProps) {
  const t = useT();
  const flow = useReactFlow<BoardNode, Edge>();
  const [nodes, setNodes, onNodesChange] = useNodesState<BoardNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [ready, setReady] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [menu, setMenu] = React.useState<MenuAt | null>(null);
  const [context, setContext] = React.useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  const [tool, setTool] = React.useState<'select' | 'hand'>('select');
  const [outline, setOutline] = React.useState(false);
  const [map, setMap] = React.useState(false);
  const [viewing, setViewing] = React.useState<string | null>(null);
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
    const added = doc.nodes.map((n) => (n.parent && !groups.has(n.parent) ? (({ parent: _parent, ...rest }) => rest)(n) : n));
    show({ nodes: [...current.nodes, ...added], edges: [...current.edges, ...doc.edges] }, new Set(added.map((n) => n.id)));
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
      place({ id, type: 'note', position: topLeft(at, corner, w, NOTE_H), width: w, height: NOTE_H, data: { text: '' } }, from);
      /* written in at once, as a note on paper */
      setEditing(id);
    } else if (kind === 'cut') {
      place({ id, type: 'cut', position: topLeft(at, corner, w, 180), width: w, data: {} }, from);
    } else {
      place({ id, type: 'make', position: topLeft(at, corner, w, 180), width: w, data: { make: kind, prompt: '' } }, from);
    }
    return id;
  };
  const addFile = (path: string, at: MenuAt['at'], from?: MenuAt['from'], corner?: boolean) => {
    place({ id: canvasId('n'), type: 'file', position: topLeft(at, corner, FILE_W, 160), width: FILE_W, data: { path } }, from);
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
      add(copyOf(doc, new Set(doc.nodes.filter((n) => !n.parent).map((n) => n.id)), at));
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  };
  /** a group kept as a template, by its name, with what is in it and the wires between them */
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
    shownBoards.set(projectId, (id, made) => {
      willChange();
      setNodes((list) => list.map((n) => (n.id === id && n.type === 'make' ? { ...n, data: withVersion(n.data, made) } : n)));
    });
    return () => { shownBoards.delete(projectId); };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = nodes.filter((n) => n.selected);
  const single = selected.length === 1 ? selected[0]!.id : null;
  /* the one selected, with its panel under it, kept on the screen: the board moves as much as it takes */
  React.useEffect(() => {
    if (!single) return undefined;
    const frame = requestAnimationFrame(() => {
      const box = rootRef.current?.getBoundingClientRect();
      const el = rootRef.current?.querySelector(`.react-flow__node[data-id="${CSS.escape(single)}"]`);
      if (!box || !el) return;
      const node = el.getBoundingClientRect();
      const type = now.current.nodes.find((n) => n.id === single)?.type;
      const panel = type === 'make' ? { w: Math.min(600, box.width * 0.8), h: 250 } : type === 'cut' ? { w: 420, h: 80 } : { w: 0, h: 0 };
      const mid = node.left + node.width / 2;
      const left = Math.min(node.left, mid - panel.w / 2);
      const right = Math.max(node.right, mid + panel.w / 2);
      const bottom = node.bottom + (panel.h ? panel.h + 14 : 0);
      const pad = 24;
      const dx = left < box.left + pad ? box.left + pad - left : right > box.right - pad ? box.right - pad - right : 0;
      const dy = bottom > box.bottom - 80 ? Math.max(box.bottom - 80 - bottom, box.top + 60 - node.top) : node.top < box.top + 50 ? box.top + 50 - node.top : 0;
      if (!dx && !dy) return;
      const view = flow.getViewport();
      void flow.setViewport({ ...view, x: view.x + dx, y: view.y + dy }, { duration: 220 });
    });
    return () => cancelAnimationFrame(frame);
  }, [single]); // eslint-disable-line react-hooks/exhaustive-deps
  const board = React.useMemo<Board>(() => ({
    files,
    fileOf: (path) => byPath.get(path) ?? null,
    sources,
    addToFilm: onAddToFilm,
    setData: (id, data) => setNodes((list) => list.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } as BoardNode : n))),
    remove,
    willChange,
    editing,
    edit: (id) => { if (id) willChange(); setEditing(id); },
    single,
    choices: (kind) => choicesFor(providers, kind),
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
    openSettings: onOpenSettings,
  }), [files, byPath, sources, onAddToFilm, setNodes, editing, single, providers, runsSeen, making, projectId, folder, onOpenSettings, nodes, edges, onReveal]); // eslint-disable-line react-hooks/exhaustive-deps

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
      ? { x: Math.min(...here.map((n) => n.position.x)), y: Math.max(...here.map((n) => n.position.y + (n.measured?.height ?? n.height ?? NOTE_H))) + 160 }
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
    const target = event.target as HTMLElement;
    if (target !== document.body && !rootRef.current?.contains(target)) return;
    /* a menu open has the keys (its Escape closes it, and only it) */
    if (menu || context) return;
    if (viewing) { if (event.key === 'Escape') { event.preventDefault(); setViewing(null); } return; }
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
    else if (!mod && key === 'v') { done(); setTool('select'); }
    else if (!mod && key === 'h') { done(); setTool('hand'); }
    else if (!mod && (key === 'backspace' || key === 'delete')) { done(); removeSelected(); }
    else if (!mod && key === '/') {
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
        ...(lit ? { style: { stroke: LIT, strokeWidth: 2.25 }, zIndex: 1 } : {}),
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
      ...(node.type === 'make' || node.type === 'cut' || file ? [{ id: 's0', separator: true as const }] : []),
      ...(onRefer ? [{ id: 'refer', label: t('host.refer'), shortcut: `${MOD}L`, onSelect: () => { refer(); } }] : []),
      { id: 'copy', label: t('canvas.copy'), shortcut: `${MOD}C`, onSelect: () => { copy(); } },
      { id: 'duplicate', label: t('canvas.duplicate'), shortcut: `${MOD}D`, onSelect: duplicate },
      { id: 'paste', label: t('canvas.paste'), shortcut: `${MOD}V`, disabled: !clipboard, hint: t('canvas.nothingCopied'), onSelect: paste },
      ...(node.type === 'frame' && board.makesIn(node.id) ? [{ id: 'all', label: t('canvas.makeAll'), icon: <Play size={15} />, disabled: board.busyIn(node.id), onSelect: () => { void makeAll(node.id); } }] : []),
      ...(node.type === 'frame' ? [{ id: 'template', label: t('canvas.keepTemplate'), icon: <LayoutTemplate size={15} />, onSelect: () => { void keepTemplate(node.id); } }] : []),
      ...(node.type === 'frame'
        ? [{ id: 'ungroup', label: t('canvas.ungroup'), shortcut: `${SHIFT}G`, onSelect: ungroup }]
        : node.parentId ? [] : [{ id: 'group', label: t('canvas.groupThem'), shortcut: `${MOD}G`, onSelect: group }]),
      ...(node.type === 'frame' ? [{ id: 'color', label: t('canvas.color'), submenu: GROUP_COLORS.map((c) => ({
        id: c, label: t(`canvas.colors.${c}`), checked: (node.data as FrameData).color === c,
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
          edges={drawn}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStart={willChange}
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
          onPaneClick={() => setContext(null)}
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
          snapToGrid
          snapGrid={[8, 8]}
          paneClickDistance={8}
          nodeClickDistance={8}
          elevateNodesOnSelect
          onlyRenderVisibleElements
          minZoom={0.1}
          maxZoom={4}
          proOptions={{ hideAttribution: true }}
          className={`openfilm-canvas ${tool === 'hand' ? 'cursor-grab' : ''}`}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.4} />
          {map ? (
            <MiniMap position="bottom-right" pannable zoomable style={{ marginBottom: 64 }}
              nodeColor={(n) => (n.type === 'frame' ? 'transparent' : n.type === 'note' ? 'var(--bg-pressed)' : 'var(--text-faint)')}
              nodeStrokeColor={(n) => (n.type === 'frame' ? FRAME_COLOR[(n.data as FrameData).color].line : 'transparent')} />
          ) : null}
        </ReactFlow>
        <BottomToolbar
          adding={Boolean(menu && !menu.from && menu.above)}
          onAdd={(from) => {
            if (menu) { setMenu(null); return; }
            setContext(null);
            setMenu({ screen: { x: from.left, y: from.top }, above: true, at: middle() });
          }}
          tool={tool}
          onTool={setTool}
          onTemplates={(from) => { setContext(null); setMenu({ screen: { x: from.left, y: from.top }, above: true, at: middle(), view: 'templates' }); }}
          onUndo={() => step(true)}
          onRedo={() => step(false)}
        />
        {chat ? <ChatToggle open={chat.open} onToggle={chat.toggle} /> : null}
        <ZoomBar outline={outline} onOutline={() => setOutline((v) => !v)} map={map} onMap={() => setMap((v) => !v)} />
        {outline ? (
          <Outline nodes={nodes} fileOf={board.fileOf} sources={sources} onShow={showNode} onClose={() => setOutline(false)} />
        ) : null}
        {ready && nodes.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4">
            <div className="text-[16px] font-medium tracking-[-0.01em] text-[var(--cv-ink)]">{t('canvas.start.title')}</div>
            <div className="max-w-[400px] text-center text-[13px] leading-relaxed text-[var(--cv-label)]">{t('canvas.empty')}</div>
            <div className="pointer-events-auto flex flex-wrap justify-center gap-2">
              {templates.slice(0, 4).map((template) => (
                <button key={template.id} type="button"
                  onClick={() => { const box = rootRef.current!.getBoundingClientRect(); void layTemplate(template, flow.screenToFlowPosition({ x: box.left + 80, y: box.top + 120 }))
                    .then(() => requestAnimationFrame(() => { void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 200 }); })); }}
                  className="flex h-9 items-center gap-1.5 rounded-xl border border-[var(--cv-float-line)] bg-[var(--cv-float)] px-3.5 text-[13px] text-[var(--cv-label)] shadow-[var(--cv-float-shadow)] transition hover:text-[var(--cv-ink)]">
                  <LayoutTemplate size={14} />{template.name}
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
  /** the chat beside the board: open or folded away, and the button at the board's bottom left that does it */
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
      addToFilm: nothing, setData: nothing, remove: nothing, willChange: nothing, editing: null, edit: nothing, single: null,
      choices: () => [], fallback: () => null, run: () => undefined, error: () => undefined, stale: NOTHING, unused: NONE,
      make: nothing, stop: nothing, inputs: (id) => inputViews(drawn.nodes, drawn.edges, id, mediaOf), unwire: nothing, sideMenu: nothing,
      upload: nothing, wireIn: nothing, sendToFilm: nothing, view: nothing,
      makesIn: () => 0, busyIn: () => false, makeAll: nothing, openSettings: nothing, readOnly: true,
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
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} />
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
