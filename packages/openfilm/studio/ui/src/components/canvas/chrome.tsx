/**
 * What is round the board, as the node canvases people know lay theirs out: the toolbar at its foot (add, move,
 * templates, the keys), the bar at its bottom left (the chat beside it, every node in a list, the overview map, the
 * wires shown or not, snapping to the grid, how far it is zoomed), the list itself, and a file seen whole over the board.
 */
import React from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import {
  Grid3x3, Hand, Keyboard, LayoutTemplate, ListTree, Map as MapIcon, MousePointer2, PanelLeftClose, PanelLeftOpen, Plus, Scissors, Search, Spline,
  Type as TypeIcon, X,
} from 'lucide-react';
import { useT } from '@/i18n';
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

/** The toolbar at the board's foot: what is added, how the board is moved, the templates, the keys. */
export function BottomToolbar({ adding, onAdd, tool, onTool, onTemplates }: {
  adding: boolean;
  onAdd: (from: DOMRect) => void;
  tool: 'select' | 'hand';
  onTool: (tool: 'select' | 'hand') => void;
  onTemplates: (from: DOMRect) => void;
}) {
  const t = useT();
  const [keys, setKeys] = React.useState(false);
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
    ]],
  ];
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2">
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
        <span className="h-4 w-px bg-[var(--cv-bar-line)]" />
        <Popover open={keys} onOpenChange={setKeys} placement="top" align="center"
          trigger={(
            <Tooltip label={t('canvas.keys.title')} side="top">
              <button type="button" aria-label={t('canvas.keys.title')} onClick={() => setKeys((v) => !v)} className={`${TOOL} ${keys ? ON : ''}`}><Keyboard size={17} /></button>
            </Tooltip>
          )}>
          <div className="relative grid w-[min(860px,92vw)] grid-cols-4 gap-6 rounded-[12px] bg-[var(--cv-float)] p-5 shadow-[var(--cv-float-shadow)]">
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
        </Popover>
      </div>
    </div>
  );
}

/**
 * The bar at the board's bottom left: the chat beside the board folded away or back (in an app with one), the list
 * of what is on the board, the overview map, the wires shown or hidden, snapping to the grid, how far it is zoomed.
 */
export function LeftBar({ chat, outline, onOutline, map, onMap, wires, onWires, snap, onSnap }: {
  chat?: { open: boolean; toggle: () => void };
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
  const chatLabel = chat ? t(chat.open ? 'canvas.toolbar.chatHide' : 'canvas.toolbar.chatShow') : '';
  return (
    <div className="pointer-events-auto absolute bottom-3 left-2 z-20 flex h-10 items-center gap-1 rounded-[12px] bg-[color-mix(in_srgb,var(--cv-bg)_70%,transparent)] px-1.5 backdrop-blur-[16px]">
      {chat ? (
        <Tooltip label={chatLabel} side="top">
          <button type="button" aria-label={chatLabel} aria-pressed={chat.open} onClick={chat.toggle} className={SMALL}>
            {chat.open ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
          </button>
        </Tooltip>
      ) : null}
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
      <Popover open={open} onOpenChange={setOpen} placement="top" align="start"
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
    label: n.type === 'make' ? ((n.data as MakeData).prompt?.trim().slice(0, 40) || kind) : file?.name ?? path ?? '',
    kind,
    icon: src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <Icon size={15} />,
  };
}

/** What is on the board, in a list (a click shows it): the board's own, not the Assets (the chat beside it has those). */
export function Outline({ nodes, fileOf, sources, onShow, onClose }: {
  nodes: readonly BoardNode[];
  fileOf: (path: string) => WorkspaceResource | null;
  sources: MediaSources;
  onShow: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = React.useState('');
  const needle = query.trim().toLowerCase();
  const rows = nodes.map((n) => ({ id: n.id, ...nodeRow(n, fileOf, sources, t) })).filter((r) => !needle || r.label.toLowerCase().includes(needle) || r.kind.toLowerCase().includes(needle));
  return (
    <div className="pointer-events-auto absolute bottom-[60px] left-2 top-3 z-20 flex w-[320px] flex-col overflow-hidden rounded-[12px] bg-[var(--cv-float)] shadow-[var(--cv-float-shadow)]">
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
