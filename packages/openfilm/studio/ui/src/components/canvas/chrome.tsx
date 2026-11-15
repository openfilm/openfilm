/**
 * What is round the board, as the node canvases people know lay theirs out: the toolbar at its foot (a node of each
 * kind, the libraries, upload), the bar at its bottom left (the keys, select or the hand), the bar at its bottom right
 * (every node in a list, the overview map, the wires shown or not, snapping to the grid, how far it is zoomed), the list
 * itself, what an empty board says, and a file seen whole over the board.
 */
import React from 'react';
import { Background, BackgroundVariant, useReactFlow, useStore } from '@xyflow/react';
import {
  AudioLines, Clapperboard, Grid3x3, Hand, History, Image as ImageIcon, Keyboard, LayoutTemplate, ListTree, Map as MapIcon, MousePointer2, Palette, Scissors, Search,
  Shapes, Spline, Type as TypeIcon, Upload, UserRound, Video, X,
} from 'lucide-react';
import { useT } from '@/i18n';
import { useKeyHint } from '@/lib/keymap-store';
import type { MediaSources, WorkspaceResource } from '@/lib/workspace-resources';
import { Popover } from '../Popover';
import { Tooltip } from '../Tooltip';
import type { BoardNode, MakeData, SpawnKind } from './board';
import { KIND_ICON, MAKE_ICON } from './nodes';
import { MENU, MENU_ICON, MENU_ROW, MENU_TITLE } from './menu-style';

const MOD = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';
const OPT = MOD === '⌘' ? '⌥' : 'Alt+';
/** a panel's button, and one switched on: a clearly lighter ground */
const TOOL = 'flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]';
const ON = '!bg-[var(--cv-on)] !text-[var(--cv-ink)]';
/** the toolbar's buttons: they sink when pressed and spring back (globals.css) */
const BAR = 'cv-tool flex h-10 w-10 items-center justify-center rounded-[10px] text-[var(--cv-ink)] hover:bg-[var(--cv-float-hover)]';
/** the corner bars, and their smaller buttons: dimmer while off, so the ones on stand out */
const CORNER = 'pointer-events-auto absolute bottom-3 z-20 flex h-10 items-center gap-1 rounded-[12px] border-[0.5px] !border-[var(--cv-bar-line)] bg-[var(--cv-bar)] px-1.5';
const SMALL = 'cv-tool flex h-7 min-w-7 items-center justify-center rounded-[8px] px-1 text-[var(--cv-ink-2)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]';
const SMALL_ICON = { size: 15, strokeWidth: 1.75 } as const;

/** How far apart the board's dots are, on the board, at a zoom: 20, doubled while they would be closer than 14 on the screen. */
function dotGap(zoom: number) {
  let gap = 20;
  while (gap * zoom < 14) gap *= 2;
  return gap;
}
/** each dot's size on the screen */
const DOT = 1.6;

/**
 * The board's dots, the same on the screen however far it is zoomed: each 1.6 across, 20 apart, twice as far apart (on
 * every other one) each time zooming out would bring them closer than 14 — never a haze of specks, never gone.
 */
export function Dots() {
  const zoom = useStore((s) => s.transform[2]);
  return <Background variant={BackgroundVariant.Dots} gap={dotGap(zoom)} size={DOT / zoom} />;
}

/** The cursor an empty board shows double-clicking: an arrow in the brand's blue to warm yellow. */
function BrandCursor() {
  const id = React.useId();
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden className="overflow-visible">
      <defs>
        <linearGradient id={`${id}-fill`} x1="4" y1="4" x2="26" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2f6ff5" />
          <stop offset="0.55" stopColor="#34c6ee" />
          <stop offset="1" stopColor="#f2d250" />
        </linearGradient>
      </defs>
      <path d="M5.2 3.6 26 13.2a1 1 0 0 1-.1 1.86l-8.6 2.9-3.9 8.4a1 1 0 0 1-1.84-.08L4 5a1 1 0 0 1 1.2-1.4Z"
        fill={`url(#${id}-fill)`} stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * What an empty board says, in its middle: "double-click the canvas", a cursor double-clicking, "to add a node". The
 * cursor moves only once the board has been shown a moment (`shown`): its first frame with the rings and the shadow is
 * costly, and drawn with the board it slowed the canvas's first showing.
 */
export function EmptyBoard({ shown }: { shown: boolean }) {
  const t = useT();
  const [moving, setMoving] = React.useState(false);
  React.useEffect(() => {
    if (!shown) { setMoving(false); return; }
    const timer = window.setTimeout(() => setMoving(true), 600);
    return () => window.clearTimeout(timer);
  }, [shown]);
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-4 text-[16px] tracking-[0.02em] text-[var(--cv-ink-2)]">
      <span>{t('canvas.empty.before')}</span>
      <span className="relative flex h-[30px] w-[30px] items-center justify-center">
        {moving ? <span className="cv-dblclick-ring" /> : null}
        {moving ? <span className="cv-dblclick-ring cv-dblclick-ring-2" /> : null}
        <span className={moving ? 'cv-dblclick-arrow' : 'flex'}><BrandCursor /></span>
      </span>
      <span>{t('canvas.empty.after')}</span>
    </div>
  );
}

/** A ring spreading where the board was double-clicked, gone when it has spread. */
export function Ripples({ taps, onDone }: { taps: ReadonlyArray<{ id: number; x: number; y: number }>; onDone: (id: number) => void }) {
  return (
    <>
      {taps.map((tap) => (
        <span key={tap.id} className="cv-ripple" style={{ left: tap.x, top: tap.y }} onAnimationEnd={() => onDone(tap.id)} />
      ))}
    </>
  );
}

/** the nodes the toolbar adds with a click, in the order a film is made: the words, the pictures, the clips, the sound (the edit takes the cut) */
const KINDS: ReadonlyArray<[SpawnKind, React.ComponentType<{ size?: number; strokeWidth?: number }>, string]> = [
  ['note', TypeIcon, 'canvas.kinds.note'], ['image', ImageIcon, 'canvas.start.image'], ['video', Video, 'canvas.start.video'],
  ['music', AudioLines, 'canvas.start.audio'],
];
const ICON = { size: 20, strokeWidth: 1.75 } as const;
const BAR_LINE = <span className="mx-1 h-5 w-px shrink-0 bg-[var(--cv-bar-line)]" />;

/**
 * The toolbar at the board's foot: a node of each kind, the libraries (materials, characters, templates, what was made),
 * a file from the computer.
 */
export function BottomToolbar({ onKind, onUpload, onTemplates, onLibrary, onCharacters, onHistory }: {
  /** a node of this kind in the middle of the view */
  onKind: (kind: SpawnKind) => void;
  onUpload: () => void;
  onTemplates: (from: DOMRect) => void;
  /** the material libraries (styles, effects), the characters, what was made */
  onLibrary: (which: 'styles' | 'effects') => void;
  onCharacters: () => void;
  onHistory: () => void;
}) {
  const t = useT();
  const [library, setLibrary] = React.useState(false);
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center">
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-[14px] border-[0.5px] !border-[var(--cv-bar-line)] bg-[var(--cv-bar)] p-1.5 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.5)]">
        {KINDS.map(([kind, Icon, label]) => (
          <Tooltip key={kind} label={t(label)} side="top">
            <button type="button" aria-label={t(label)} onClick={() => onKind(kind)} className={BAR}><Icon {...ICON} /></button>
          </Tooltip>
        ))}
        {BAR_LINE}
        {/* the material libraries: styles for pictures, effects (camera moves) for clips */}
        <Popover open={library} onOpenChange={setLibrary} placement="top" align="center"
          trigger={(
            <Tooltip label={t('canvas.library.title')} side="top">
              <button type="button" aria-label={t('canvas.library.title')} onClick={() => setLibrary((v) => !v)} className={`${BAR} ${library ? ON : ''}`}><Shapes {...ICON} /></button>
            </Tooltip>
          )}>
          <div className={`${MENU} w-[180px]`}>
            <div className={MENU_TITLE}>{t('canvas.library.title')}</div>
            {(['styles', 'effects'] as const).map((which) => (
              <button key={which} type="button" onClick={() => { setLibrary(false); onLibrary(which); }}
                className={MENU_ROW}>
                {which === 'styles' ? <Palette size={MENU_ICON} /> : <Clapperboard size={MENU_ICON} />}{t(`canvas.library.${which}`)}
              </button>
            ))}
          </div>
        </Popover>
        <Tooltip label={t('canvas.characters.title')} side="top">
          <button type="button" aria-label={t('canvas.characters.title')} onClick={onCharacters} className={BAR}><UserRound {...ICON} /></button>
        </Tooltip>
        <Tooltip label={t('canvas.menu.templates')} side="top">
          <button type="button" aria-label={t('canvas.menu.templates')} onClick={(event) => onTemplates(event.currentTarget.getBoundingClientRect())} className={BAR}><LayoutTemplate {...ICON} /></button>
        </Tooltip>
        <Tooltip label={t('canvas.history.title')} side="top">
          <button type="button" aria-label={t('canvas.history.title')} onClick={onHistory} className={BAR}><History {...ICON} /></button>
        </Tooltip>
        <Tooltip label={t('canvas.menu.upload')} side="top">
          <button type="button" aria-label={t('canvas.menu.upload')} onClick={onUpload} className={BAR}><Upload {...ICON} /></button>
        </Tooltip>
      </div>
    </div>
  );
}

/**
 * The bar at the board's bottom left: the keys, and one button for the tool in use, select (V) or the hand (H),
 * while it is the hand; a click takes the other.
 */
export function ToolCorner({ tool, onTool }: { tool: 'select' | 'hand'; onTool: (tool: 'select' | 'hand') => void }) {
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
  const other = tool === 'select' ? 'hand' : 'select';
  return (
    <>
      {/* the keys over the board's bottom toolbar, in the middle */}
      {keys ? (
        <div className="pointer-events-none absolute bottom-[74px] left-1/2 z-30 w-[min(860px,calc(100%-24px))] -translate-x-1/2">
          <div ref={keysPanel} role="dialog" aria-label={t('canvas.keys.title')}
            className="cv-pop pointer-events-auto relative grid grid-cols-4 gap-6 rounded-[12px] bg-[var(--cv-float)] p-5 shadow-[var(--cv-float-shadow)]">
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
        </div>
      ) : null}
      <div className={`${CORNER} left-2`}>
        <Tooltip label={t('canvas.keys.title')} side="top">
          <button ref={keysButton} type="button" aria-label={t('canvas.keys.title')} aria-expanded={keys} onClick={() => setKeys((v) => !v)} className={`${SMALL} ${keys ? ON : ''}`}><Keyboard {...SMALL_ICON} /></button>
        </Tooltip>
        <span className="mx-0.5 h-4 w-px shrink-0 bg-[var(--cv-bar-line)]" />
        {/* one button: it shows the tool in use, and a click takes the other */}
        <Tooltip label={t(`canvas.keys.${other}`)} shortcut={other === 'select' ? 'V' : 'H'} side="top">
          <button type="button" aria-label={t(`canvas.keys.${tool}`)} onClick={() => onTool(other)} className={`${SMALL} ${ON}`}>
            <span key={tool} className="cv-swap flex">{tool === 'select' ? <MousePointer2 {...SMALL_ICON} /> : <Hand {...SMALL_ICON} />}</span>
          </button>
        </Tooltip>
      </div>
    </>
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
  const row = `${MENU_ROW} justify-between`;
  const act = (run: () => void) => () => { run(); setOpen(false); };
  return (
    <div className={`${CORNER} right-2`}>
      <Tooltip label={t('canvas.outline.title')} shortcut={`${MOD}F`} side="top">
        <button type="button" aria-label={t('canvas.outline.title')} onClick={onOutline} className={`${SMALL} ${outline ? ON : ''}`}><ListTree {...SMALL_ICON} /></button>
      </Tooltip>
      <Tooltip label={t('canvas.toolbar.map')} side="top">
        <button type="button" aria-label={t('canvas.toolbar.map')} onClick={onMap} className={`${SMALL} ${map ? ON : ''}`}><MapIcon {...SMALL_ICON} /></button>
      </Tooltip>
      <Tooltip label={t(wires ? 'canvas.toolbar.hideWires' : 'canvas.toolbar.showWires')} side="top">
        <button type="button" aria-label={t(wires ? 'canvas.toolbar.hideWires' : 'canvas.toolbar.showWires')} onClick={onWires} className={`${SMALL} ${wires ? '' : ON}`}><Spline {...SMALL_ICON} /></button>
      </Tooltip>
      <Tooltip label={t('canvas.toolbar.snap')} side="top">
        <button type="button" aria-label={t('canvas.toolbar.snap')} aria-pressed={snap} onClick={onSnap} className={`${SMALL} ${snap ? ON : ''}`}><Grid3x3 {...SMALL_ICON} /></button>
      </Tooltip>
      <Popover open={open} onOpenChange={setOpen} placement="top" align="end"
        trigger={(
          <button type="button" onClick={() => setOpen((v) => !v)} className={`${SMALL} ${open ? ON : ''} !px-1.5 text-[12.5px] tabular-nums`}>
            {Math.round(zoom * 100)}%
          </button>
        )}>
        <div className={`${MENU} w-[220px]`}>
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
      {file.kind === 'image' ? <img src={src} alt="" className="cv-checker cv-checker-night max-h-full max-w-full object-contain" />
        : file.kind === 'video' ? <video src={src} controls autoPlay playsInline className="max-h-full max-w-full" />
          : file.kind === 'audio' ? <audio src={src} controls autoPlay className="w-[min(520px,80%)]" />
            : <div className="text-white/70">{file.name}</div>}
    </div>
  );
}
