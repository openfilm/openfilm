/**
 * What is round the board, as the node canvases people know lay theirs out: the toolbar at its foot (add, move,
 * templates, the keys), the bar at its bottom right (every node in a list, the overview map, the wires shown or not,
 * snapping to the grid, how far it is zoomed), the list itself, and a file seen whole over the board.
 */
import React from 'react';
import { Background, BackgroundVariant, useReactFlow, useStore } from '@xyflow/react';
import {
  Clapperboard, Grid3x3, Hand, History, Keyboard, LayoutTemplate, ListTree, Map as MapIcon, MousePointer2, Palette, Plus, Scissors, Search, Shapes, Spline,
  Type as TypeIcon, UserRound, X,
} from 'lucide-react';
import { useT } from '@/i18n';
import { useKeyHint } from '@/lib/keymap-store';
import type { MediaSources, WorkspaceResource } from '@/lib/workspace-resources';
import { Popover } from '../Popover';
import { Tooltip } from '../Tooltip';
import type { BoardNode, MakeData } from './board';
import { KIND_ICON, MAKE_ICON } from './nodes';

const MOD = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';
const OPT = MOD === '⌘' ? '⌥' : 'Alt+';
/** a toolbar's button, and one switched on */
const TOOL = 'flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]';
const ON = '!bg-[var(--cv-float-hover)]';
/** the bottom left bar's smaller ones */
const SMALL = 'flex h-7 min-w-7 items-center justify-center rounded-[8px] px-1 text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]';

/**
 * The board's dots, the same on the screen however far it is zoomed: each 1.6 across, 20 apart, twice as far apart (on
 * every other one) each time zooming out would bring them closer than 14 — never a haze of specks, never gone.
 */
export function Dots() {
  const zoom = useStore((s) => s.transform[2]);
  let gap = 20;
  while (gap * zoom < 14) gap *= 2;
  return <Background variant={BackgroundVariant.Dots} gap={gap} size={1.6 / zoom} />;
}

/** The canvas is still being tried out: said at its bottom left, its tip saying what that means. */
export function BetaTag() {
  const t = useT();
  return (
    <Tooltip label={t('canvas.betaTip')} side="top">
      <span className="pointer-events-auto absolute bottom-4 left-3 z-20 flex h-[22px] cursor-default select-none items-center rounded-full border-[0.5px] !border-[var(--cv-bar-line)] bg-[color-mix(in_srgb,var(--cv-bg)_70%,transparent)] px-2.5 text-[11px] font-medium tracking-wide text-[var(--cv-ink-2)] backdrop-blur-[16px]">
        {t('canvas.beta')}
      </span>
    </Tooltip>
  );
}

/** The toolbar at the board's foot: what is added, how the board is moved, the templates, the keys. */
export function BottomToolbar({ adding, onAdd, tool, onTool, onTemplates, onLibrary, onCharacters, onHistory }: {
  adding: boolean;
  onAdd: (from: DOMRect) => void;
  tool: 'select' | 'hand';
  onTool: (tool: 'select' | 'hand') => void;
  onTemplates: (from: DOMRect) => void;
  /** the material libraries (styles, effects), the characters, what was made */
  onLibrary: (which: 'styles' | 'effects') => void;
  onCharacters: () => void;
  onHistory: () => void;
}) {
  const t = useT();
  const [keys, setKeys] = React.useState(false);
  const keysButton = React.useRef<HTMLButtonElement>(null);
  const keysPanel = React.useRef<HTMLDivElement>(null);
  const hint = useKeyHint();
  /* the keys close on a press outside them (their button toggles them) and on Escape */
  React.useEffect(() => {
    if (!keys) return undefined;
    const away = (event: PointerEvent) => {
      const at = event.target as Node;
      if (!keysPanel.current?.contains(at) && !keysButton.current?.contains(at)) setKeys(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setKeys(false); };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', escape, true);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', escape, true); };
  }, [keys]);
  const [library, setLibrary] = React.useState(false);
  /* the keys, in four columns: making, zooming, moving the board, and the rest */
  const columns: Array<[string, Array<[string, string]>]> = [
    [t('canvas.keys.make'), [
      [t('canvas.groupThem'), `${MOD} G`], [t('canvas.ungroup'), `${MOD} ⇧ G`], [t('canvas.keys.wire'), `${MOD} L`], [t('canvas.duplicate'), `${MOD} D`],
      [t('canvas.make.run'), `${MOD} Enter`], [t('canvas.keys.add'), 'Tab · /'], [t('host.refer'), `${MOD} L`],
    ]],
    [t('canvas.keys.zoom'), [[t('canvas.zoom.in'), `${MOD} +`], [t('canvas.zoom.out'), `${MOD} −`], [t('canvas.fit'), `${MOD} 0`], [t('canvas.keys.pinch'), '⌘ + scroll']]],
    [t('canvas.keys.move'), [[t('canvas.keys.space'), 'Space'], [t('canvas.keys.scroll'), '↕ ↔'], [t('canvas.keys.select'), 'V'], [t('canvas.keys.hand'), 'H']]],
    [t('canvas.keys.other'), [
      [t('canvas.keys.undo'), `${MOD} Z`], [t('canvas.keys.redo'), `${MOD} ⇧ Z`], [t('canvas.copy'), `${MOD} C`], [t('canvas.paste'), `${MOD} V`],
      [t('canvas.selectAll'), `${MOD} A`], [t('canvas.keys.find'), `${MOD} F`], [t('canvas.remove'), '⌫'],
      ...(hint('work-mode') ? [[t('canvas.toEdit'), hint('work-mode')!] as [string, string]] : []),
    ]],
  ];
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2">
      {/* the keys over the bar, in the middle of the board's foot as the bar is */}
      {keys ? (
        <div ref={keysPanel} role="dialog" aria-label={t('canvas.keys.title')}
          className="cv-pop pointer-events-auto absolute bottom-full left-1/2 mb-2 grid w-[min(860px,92vw)] -translate-x-1/2 grid-cols-4 gap-6 rounded-[12px] bg-[var(--cv-float)] p-5 shadow-[var(--cv-float-shadow)]">
          <button type="button" aria-label={t('canvas.outline.close')} onClick={() => setKeys(false)} className="absolute right-3 top-3 text-[var(--cv-ink-2)] hover:text-[var(--cv-ink)]"><X size={15} /></button>
          {columns.map(([title, rows]) => (
            <div key={title}>
              <div className="mb-2 text-[12.5px] font-medium text-[var(--cv-edge-lit)]">{title}</div>
              {rows.map(([what, key]) => (
                <div key={what} className="flex h-8 items-center justify-between gap-2 text-[12.5px]">
                  <span className="truncate text-[var(--cv-ink-2)]">{what}</span>
                  <kbd className="shrink-0 rounded-[6px] bg-[var(--cv-chip)] px-1.5 py-0.5 font-sans text-[11.5px] text-[var(--cv-ink)]">{key}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      <div className="pointer-events-auto flex items-center gap-2 rounded-[12px] border-[0.5px] !border-[var(--cv-bar-line)] bg-[var(--cv-bar)] p-2">
        <Tooltip label={`${t('canvas.toolbar.add')} · /`} side="top">
          <button type="button" aria-label={t('canvas.toolbar.add')} onClick={(event) => onAdd(event.currentTarget.getBoundingClientRect())}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[var(--cv-invert)] text-[var(--cv-on-invert)] transition hover:opacity-90">
            {adding ? <X size={17} /> : <Plus size={18} />}
          </button>
        </Tooltip>
        {/* select (V) and the hand (H): one button, the one in use */}
        <Tooltip label={tool === 'select' ? `${t('canvas.keys.select')} · V` : `${t('canvas.keys.hand')} · H`} side="top">
          <button type="button" aria-label={t(tool === 'select' ? 'canvas.keys.select' : 'canvas.keys.hand')} onClick={() => onTool(tool === 'select' ? 'hand' : 'select')} className={TOOL}>
            {tool === 'select' ? <MousePointer2 size={17} /> : <Hand size={17} />}
          </button>
        </Tooltip>
        <Tooltip label={t('canvas.menu.templates')} side="top">
          <button type="button" aria-label={t('canvas.menu.templates')} onClick={(event) => onTemplates(event.currentTarget.getBoundingClientRect())} className={TOOL}><LayoutTemplate size={17} /></button>
        </Tooltip>
        {/* the material libraries: styles for pictures, effects (camera moves) for clips */}
        <Popover open={library} onOpenChange={setLibrary} placement="top" align="center"
          trigger={(
            <Tooltip label={t('canvas.library.title')} side="top">
              <button type="button" aria-label={t('canvas.library.title')} onClick={() => setLibrary((v) => !v)} className={`${TOOL} ${library ? ON : ''}`}><Shapes size={17} /></button>
            </Tooltip>
          )}>
          <div className="cv-pop w-[154px] rounded-[12px] bg-[var(--cv-float)] p-1 shadow-[var(--cv-float-shadow)]">
            <div className="flex h-7 items-center px-2 text-[12px] font-medium text-[var(--cv-ink-3)]">{t('canvas.library.title')}</div>
            {(['styles', 'effects'] as const).map((which) => (
              <button key={which} type="button" onClick={() => { setLibrary(false); onLibrary(which); }}
                className="flex h-9 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[13px] text-[var(--cv-ink)] hover:bg-[var(--cv-float-hover)]">
                {which === 'styles' ? <Palette size={15} /> : <Clapperboard size={15} />}{t(`canvas.library.${which}`)}
              </button>
            ))}
          </div>
        </Popover>
        <Tooltip label={t('canvas.characters.title')} side="top">
          <button type="button" aria-label={t('canvas.characters.title')} onClick={onCharacters} className={TOOL}><UserRound size={17} /></button>
        </Tooltip>
        <Tooltip label={t('canvas.history.title')} side="top">
          <button type="button" aria-label={t('canvas.history.title')} onClick={onHistory} className={TOOL}><History size={17} /></button>
        </Tooltip>
        <span className="h-4 w-px bg-[var(--cv-bar-line)]" />
        <Tooltip label={t('canvas.keys.title')} side="top">
          <button ref={keysButton} type="button" aria-label={t('canvas.keys.title')} aria-expanded={keys} onClick={() => setKeys((v) => !v)} className={`${TOOL} ${keys ? ON : ''}`}><Keyboard size={17} /></button>
        </Tooltip>
      </div>
    </div>
  );
}

/**
 * The bar at the board's bottom right: the list of what is on the board, the overview map, the wires shown or hidden,
 * snapping to the grid, how far it is zoomed.
 */
export function CornerBar({ outline, onOutline, map, onMap, wires, onWires, snap, onSnap }: {
  outline: boolean; onOutline: () => void;
  map: boolean; onMap: () => void;
  wires: boolean; onWires: () => void;
  snap: boolean; onSnap: () => void;
}) {
  const t = useT();
  const flow = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const [open, setOpen] = React.useState(false);
  const row = 'flex h-8 w-full items-center justify-between rounded-[8px] px-2 text-[13px] text-[var(--cv-ink)] hover:bg-[var(--cv-float-hover)]';
  const act = (run: () => void) => () => { run(); setOpen(false); };
  return (
    <div className="pointer-events-auto absolute bottom-3 right-2 z-20 flex h-10 items-center gap-1 rounded-[12px] bg-[color-mix(in_srgb,var(--cv-bg)_70%,transparent)] px-1.5 backdrop-blur-[16px]">
      <Tooltip label={t('canvas.outline.title')} side="top">
        <button type="button" aria-label={t('canvas.outline.title')} onClick={onOutline} className={`${SMALL} ${outline ? ON : ''}`}><ListTree size={15} /></button>
      </Tooltip>
      <Tooltip label={t('canvas.toolbar.map')} side="top">
        <button type="button" aria-label={t('canvas.toolbar.map')} onClick={onMap} className={`${SMALL} ${map ? ON : ''}`}><MapIcon size={15} /></button>
      </Tooltip>
      <Tooltip label={t(wires ? 'canvas.toolbar.hideWires' : 'canvas.toolbar.showWires')} side="top">
        <button type="button" aria-label={t(wires ? 'canvas.toolbar.hideWires' : 'canvas.toolbar.showWires')} onClick={onWires} className={`${SMALL} ${wires ? '' : ON}`}><Spline size={15} /></button>
      </Tooltip>
      <Tooltip label={t('canvas.toolbar.snap')} side="top">
        <button type="button" aria-label={t('canvas.toolbar.snap')} aria-pressed={snap} onClick={onSnap} className={`${SMALL} ${snap ? ON : ''}`}><Grid3x3 size={15} /></button>
      </Tooltip>
      <Popover open={open} onOpenChange={setOpen} placement="top" align="end"
        trigger={(
          <button type="button" onClick={() => setOpen((v) => !v)} className={`${SMALL} !px-1.5 text-[12.5px] tabular-nums`}>
            {Math.round(zoom * 100)}%
          </button>
        )}>
        <div className="w-[200px] rounded-[12px] bg-[var(--cv-float)] p-1 shadow-[var(--cv-float-shadow)]">
          <button type="button" className={row} onClick={act(() => { void flow.zoomIn({ duration: 150 }); })}>{t('canvas.zoom.in')}<kbd className="font-sans text-[11px] text-[var(--cv-ink-3)]">{MOD}+</kbd></button>
          <button type="button" className={row} onClick={act(() => { void flow.zoomOut({ duration: 150 }); })}>{t('canvas.zoom.out')}<kbd className="font-sans text-[11px] text-[var(--cv-ink-3)]">{MOD}−</kbd></button>
          <button type="button" className={row} onClick={act(() => { void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 200 }); })}>{t('canvas.fit')}<kbd className="font-sans text-[11px] text-[var(--cv-ink-3)]">{MOD}0</kbd></button>
          <button type="button" className={row} onClick={act(() => { void flow.zoomTo(1, { duration: 150 }); })}>{t('canvas.zoom.actual')}<kbd className="font-sans text-[11px] text-[var(--cv-ink-3)]">{OPT}0</kbd></button>
        </div>
      </Popover>
    </div>
  );
}

/** A node as the list names it: a small picture of it, and what it is. */
function nodeRow(n: BoardNode, fileOf: (path: string) => WorkspaceResource | null, sources: MediaSources, t: (key: string) => string) {
  if (n.type === 'note') return { label: n.data.text.trim().split('\n')[0]?.slice(0, 40) || t('canvas.kinds.note'), kind: t('canvas.kinds.note'), icon: <TypeIcon size={15} /> };
  if (n.type === 'frame') return { label: n.data.label, kind: t('canvas.group'), icon: <LayoutTemplate size={15} /> };
  if (n.type === 'cut') return { label: t('canvas.kinds.cut'), kind: t('canvas.kinds.cut'), icon: <Scissors size={15} /> };
  const path = (n.data as { path?: string }).path;
  const file = path ? fileOf(path) : null;
  const src = file ? (file.kind === 'image' ? sources.file(file) : sources.poster?.(file)) : undefined;
  const kind = n.type === 'make' ? t(`canvas.make.${(n.data as MakeData).make}`) : file ? t(`canvas.outline.kind.${file.kind}`) : '';
  const Icon = n.type === 'make' ? MAKE_ICON[(n.data as MakeData).make] : KIND_ICON[file?.kind ?? 'other'];
  return {
    label: n.data.title ?? (n.type === 'make' ? (n.data.prompt?.trim().slice(0, 40) || kind) : file?.name ?? path ?? ''),
    kind,
    icon: src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <Icon size={15} />,
  };
}

type Category = 'image' | 'video' | 'audio' | 'note' | 'group' | 'other';
const CATEGORIES: readonly Category[] = ['image', 'video', 'audio', 'note', 'group', 'other'];
/** Which of the list's kinds a node is: what it makes, else what its file is. */
function categoryOf(n: BoardNode, fileOf: (path: string) => WorkspaceResource | null): Category {
  if (n.type === 'note') return 'note';
  if (n.type === 'frame') return 'group';
  if (n.type === 'make') { const make = (n.data as MakeData).make; return make === 'image' || make === 'video' ? make : 'audio'; }
  const path = n.type === 'file' ? n.data.path : undefined;
  const kind = path ? fileOf(path)?.kind : undefined;
  return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : 'other';
}

/** What is on the board, in a list (a click shows it), by kind: the board's own, not the Assets (the chat beside it has those). */
export function Outline({ nodes, fileOf, sources, onShow, onClose }: {
  nodes: readonly BoardNode[];
  fileOf: (path: string) => WorkspaceResource | null;
  sources: MediaSources;
  onShow: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = React.useState('');
  const [only, setOnly] = React.useState<Category | null>(null);
  const needle = query.trim().toLowerCase();
  const all = nodes.map((n) => ({ id: n.id, category: categoryOf(n, fileOf), ...nodeRow(n, fileOf, sources, t) }));
  /* the kinds the board has, each a filter; the one picked again: all */
  const present = CATEGORIES.filter((c) => all.some((r) => r.category === c));
  const shown = only && present.includes(only) ? only : null;
  const rows = all.filter((r) => (!shown || r.category === shown) && (!needle || r.label.toLowerCase().includes(needle) || r.kind.toLowerCase().includes(needle)));
  const chip = (on: boolean) => `h-6 shrink-0 rounded-full px-2.5 text-[12px] transition ${on ? 'bg-[var(--cv-invert)] text-[var(--cv-on-invert)]' : 'bg-[var(--cv-float-hover)] text-[var(--cv-ink-2)] hover:text-[var(--cv-ink)]'}`;
  const named = (c: Category) => t(c === 'note' ? 'canvas.kinds.note' : c === 'group' ? 'canvas.group' : `canvas.outline.kind.${c}`);
  return (
    <div className="pointer-events-auto absolute bottom-[60px] right-2 top-3 z-20 flex w-[320px] flex-col overflow-hidden rounded-[12px] bg-[var(--cv-float)] shadow-[var(--cv-float-shadow)]">
      <div className="flex items-center gap-1 py-2 pl-3.5 pr-2">
        <span className="text-[13px] font-medium text-[var(--cv-ink)]">{t('canvas.outline.title')}</span>
        <span className="flex-1" />
        <button type="button" aria-label={t('canvas.outline.close')} onClick={onClose} className={`${TOOL} !h-7 !w-7`}><X size={14} /></button>
      </div>
      <label className="mx-2 mb-1 flex h-8 items-center gap-2 rounded-lg bg-[var(--cv-float-hover)] px-2 text-[12.5px]">
        <Search size={13} className="shrink-0 text-[var(--cv-label)]" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('canvas.outline.search')}
          className="min-w-0 flex-1 bg-transparent text-[var(--cv-ink)] outline-none placeholder:text-[var(--cv-label)]" />
      </label>
      {present.length > 1 ? (
        <div className="mx-2 mb-1 flex flex-wrap gap-1">
          <button type="button" aria-pressed={!shown} onClick={() => setOnly(null)} className={chip(!shown)}>{t('canvas.outline.all')}</button>
          {present.map((c) => (
            <button key={c} type="button" aria-pressed={shown === c} onClick={() => setOnly(shown === c ? null : c)} className={chip(shown === c)}>
              {named(c)} {all.filter((r) => r.category === c).length}
            </button>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {rows.map((row) => (
          <button key={row.id} type="button" onClick={() => onShow(row.id)}
            className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1 text-left hover:bg-[var(--cv-float-hover)]">
            <span className="flex h-8 w-11 shrink-0 items-center justify-center overflow-hidden rounded bg-[var(--cv-float-hover)] text-[var(--cv-label)]">{row.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] text-[var(--cv-ink)]">{row.label}</span>
              <span className="block truncate text-[11px] text-[var(--cv-label)]">{row.kind}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="border-t !border-[var(--cv-float-line)] px-3.5 py-2 text-[11.5px] text-[var(--cv-label)]">{t('canvas.outline.count').replace('{n}', String(nodes.length))}</div>
    </div>
  );
}

/** A file seen whole over the board: a picture, a clip with its controls, a sound; Escape or a click outside closes it. */
export function Viewer({ file, sources, onClose }: { file: WorkspaceResource; sources: MediaSources; onClose: () => void }) {
  const t = useT();
  const src = sources.file(file);
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/85 p-10" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <button type="button" aria-label={t('canvas.outline.close')} onClick={onClose}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"><X size={18} /></button>
      <div className="absolute left-5 top-5 max-w-[60%] truncate text-[13px] text-white/80">{file.name}</div>
      {file.kind === 'image' ? <img src={src} alt="" className="max-h-full max-w-full object-contain" />
        : file.kind === 'video' ? <video src={src} controls autoPlay playsInline className="max-h-full max-w-full" />
          : file.kind === 'audio' ? <audio src={src} controls autoPlay className="w-[min(520px,80%)]" />
            : <div className="text-white/70">{file.name}</div>}
    </div>
  );
}
