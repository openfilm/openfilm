/**
 * What is round the board: the toolbar at its foot (add, select or move, templates, undo and redo, the keys, the
 * agent), the bar at its bottom left (every node in a list, the overview map, how far it is zoomed), the list itself,
 * and a file seen whole over the board.
 */
import React from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import {
  Hand, Keyboard, LayoutTemplate, ListTree, Map as MapIcon, MousePointer2, PanelLeftClose, PanelLeftOpen, Plus, Redo2, Scissors, Search, Type as TypeIcon, Undo2, X,
} from 'lucide-react';
import { useT } from '@/i18n';
import type { MediaSources, WorkspaceResource } from '@/lib/workspace-resources';
import { Popover } from '../Popover';
import { Tooltip } from '../Tooltip';
import type { BoardNode, MakeData } from './board';
import { KIND_ICON, MAKE_ICON } from './nodes';

const MOD = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';
const BAR = 'flex items-center rounded-[14px] border border-[var(--cv-float-line)] bg-[var(--cv-float)] p-1 shadow-[var(--cv-float-shadow)]';
const TOOL = 'flex h-9 w-9 items-center justify-center rounded-[10px] text-[var(--cv-label)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]';
const ON = '!bg-[var(--cv-float-hover)] !text-[var(--cv-ink)]';

/** The toolbar at the board's foot: what is added and how the board is moved. */
export function BottomToolbar({ adding, onAdd, tool, onTool, onTemplates, onUndo, onRedo }: {
  adding: boolean;
  onAdd: (from: DOMRect) => void;
  tool: 'select' | 'hand';
  onTool: (tool: 'select' | 'hand') => void;
  onTemplates: (from: DOMRect) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const t = useT();
  const [keys, setKeys] = React.useState(false);
  const rows: Array<[string, string]> = [
    [t('canvas.keys.add'), '/'], [t('canvas.keys.select'), 'V'], [t('canvas.keys.hand'), `H · ${t('canvas.keys.space')}`],
    [t('canvas.keys.undo'), `${MOD}Z`], [t('canvas.keys.redo'), `⇧${MOD}Z`], [t('canvas.copy'), `${MOD}C`], [t('canvas.paste'), `${MOD}V`],
    [t('canvas.duplicate'), `${MOD}D`], [t('canvas.groupThem'), `${MOD}G`], [t('canvas.ungroup'), `⇧${MOD}G`], [t('canvas.selectAll'), `${MOD}A`],
    [t('host.refer'), `${MOD}L`], [t('canvas.make.run'), `${MOD}↵`], [t('canvas.remove'), '⌫'],
  ];
  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2">
      <div className={`pointer-events-auto ${BAR}`}>
        <Tooltip label={`${t('canvas.toolbar.add')} · /`} side="top">
          <button type="button" aria-label={t('canvas.toolbar.add')} onClick={(event) => onAdd(event.currentTarget.getBoundingClientRect())}
            className={`${TOOL} ${adding ? ON : '!bg-[var(--accent)] !text-[var(--on-accent)] hover:bg-[var(--accent-hover)]'}`}>
            {adding ? <X size={18} /> : <Plus size={18} />}
          </button>
        </Tooltip>
        <span className="mx-1 h-5 w-px bg-[var(--cv-float-line)]" />
        <Tooltip label={`${t('canvas.keys.select')} · V`} side="top">
          <button type="button" aria-label={t('canvas.keys.select')} onClick={() => onTool('select')} className={`${TOOL} ${tool === 'select' ? ON : ''}`}><MousePointer2 size={17} /></button>
        </Tooltip>
        <Tooltip label={`${t('canvas.keys.hand')} · H`} side="top">
          <button type="button" aria-label={t('canvas.keys.hand')} onClick={() => onTool('hand')} className={`${TOOL} ${tool === 'hand' ? ON : ''}`}><Hand size={17} /></button>
        </Tooltip>
        <Tooltip label={t('canvas.menu.templates')} side="top">
          <button type="button" aria-label={t('canvas.menu.templates')} onClick={(event) => onTemplates(event.currentTarget.getBoundingClientRect())} className={TOOL}><LayoutTemplate size={17} /></button>
        </Tooltip>
        <span className="mx-1 h-5 w-px bg-[var(--cv-float-line)]" />
        <Tooltip label={`${t('canvas.keys.undo')} · ${MOD}Z`} side="top">
          <button type="button" aria-label={t('canvas.keys.undo')} onClick={onUndo} className={TOOL}><Undo2 size={17} /></button>
        </Tooltip>
        <Tooltip label={`${t('canvas.keys.redo')} · ⇧${MOD}Z`} side="top">
          <button type="button" aria-label={t('canvas.keys.redo')} onClick={onRedo} className={TOOL}><Redo2 size={17} /></button>
        </Tooltip>
        <Popover open={keys} onOpenChange={setKeys} placement="top" align="center"
          trigger={(
            <Tooltip label={t('canvas.keys.title')} side="top">
              <button type="button" aria-label={t('canvas.keys.title')} onClick={() => setKeys((v) => !v)} className={`${TOOL} ${keys ? ON : ''}`}><Keyboard size={17} /></button>
            </Tooltip>
          )}>
          <div className="w-[280px] rounded-[14px] border border-[var(--cv-float-line)] bg-[var(--cv-float)] p-3 shadow-[var(--cv-float-shadow)]">
            <div className="mb-2 text-[12.5px] font-medium text-[var(--cv-ink)]">{t('canvas.keys.title')}</div>
            {rows.map(([what, key]) => (
              <div key={what} className="flex h-7 items-center justify-between text-[12.5px]">
                <span className="text-[var(--cv-label)]">{what}</span>
                <kbd className="rounded bg-[var(--cv-float-hover)] px-1.5 font-sans text-[11.5px] text-[var(--cv-ink)]">{key}</kbd>
              </div>
            ))}
          </div>
        </Popover>
      </div>
    </div>
  );
}

/** The chat beside the board, folded away or back, from the board's bottom left. */
export function ChatToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const t = useT();
  const label = t(open ? 'canvas.toolbar.chatHide' : 'canvas.toolbar.chatShow');
  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-20 flex items-center rounded-[12px] border border-[var(--cv-float-line)] bg-[var(--cv-float)] p-0.5 shadow-[var(--cv-float-shadow)]">
      <Tooltip label={label} side="top">
        <button type="button" aria-label={label} aria-pressed={open} onClick={onToggle} className={`${TOOL} !h-8 !w-8`}>
          {open ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
      </Tooltip>
    </div>
  );
}

/** The bar at the board's bottom right: the list of what is on the board, the overview map, and how far it is zoomed. */
export function ZoomBar({ outline, onOutline, map, onMap }: { outline: boolean; onOutline: () => void; map: boolean; onMap: () => void }) {
  const t = useT();
  const flow = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const [open, setOpen] = React.useState(false);
  const row = 'flex h-8 w-full items-center justify-between rounded-lg px-2 text-[12.5px] text-[var(--cv-ink)] hover:bg-[var(--cv-float-hover)]';
  const act = (run: () => void) => () => { run(); setOpen(false); };
  return (
    <div className="pointer-events-auto absolute bottom-4 right-4 z-20 flex items-center gap-0.5 rounded-[12px] border border-[var(--cv-float-line)] bg-[var(--cv-float)] p-0.5 shadow-[var(--cv-float-shadow)]">
      <Tooltip label={t('canvas.outline.title')} side="top">
        <button type="button" aria-label={t('canvas.outline.title')} onClick={onOutline} className={`${TOOL} !h-8 !w-8 ${outline ? ON : ''}`}><ListTree size={16} /></button>
      </Tooltip>
      <Tooltip label={t('canvas.toolbar.map')} side="top">
        <button type="button" aria-label={t('canvas.toolbar.map')} onClick={onMap} className={`${TOOL} !h-8 !w-8 ${map ? ON : ''}`}><MapIcon size={16} /></button>
      </Tooltip>
      <Popover open={open} onOpenChange={setOpen} placement="top" align="end"
        trigger={(
          <button type="button" onClick={() => setOpen((v) => !v)}
            className="h-8 min-w-[52px] rounded-[10px] px-2 text-[12.5px] tabular-nums text-[var(--cv-label)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">
            {Math.round(zoom * 100)}%
          </button>
        )}>
        <div className="w-[200px] rounded-[12px] border border-[var(--cv-float-line)] bg-[var(--cv-float)] p-1 shadow-[var(--cv-float-shadow)]">
          <button type="button" className={row} onClick={act(() => { void flow.zoomIn({ duration: 150 }); })}>{t('canvas.zoom.in')}<kbd className="font-sans text-[11px] text-[var(--cv-label)]">{MOD}+</kbd></button>
          <button type="button" className={row} onClick={act(() => { void flow.zoomOut({ duration: 150 }); })}>{t('canvas.zoom.out')}<kbd className="font-sans text-[11px] text-[var(--cv-label)]">{MOD}-</kbd></button>
          <button type="button" className={row} onClick={act(() => { void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 200 }); })}>{t('canvas.fit')}<kbd className="font-sans text-[11px] text-[var(--cv-label)]">⇧1</kbd></button>
          <button type="button" className={row} onClick={act(() => { void flow.zoomTo(1, { duration: 150 }); })}>{t('canvas.zoom.actual')}<kbd className="font-sans text-[11px] text-[var(--cv-label)]">⇧0</kbd></button>
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
    <div className="pointer-events-auto absolute bottom-[68px] right-4 top-4 z-20 flex w-[272px] flex-col overflow-hidden rounded-[14px] border border-[var(--cv-float-line)] bg-[var(--cv-float)] shadow-[var(--cv-float-shadow)]">
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
      <div className="border-t border-[var(--cv-float-line)] px-3.5 py-2 text-[11.5px] text-[var(--cv-label)]">{t('canvas.outline.count').replace('{n}', String(nodes.length))}</div>
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
