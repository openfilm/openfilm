/**
 * Markers on the timeline (lib/markers): flags on the ruler for the film's, notches on the clips for a clip's, and the
 * list of them all behind the toolbar's flag button. A click goes to a marker, a drag moves a flag along the ruler,
 * a double-click names it, a right-click names, colors or deletes it.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Flag, Trash2 } from 'lucide-react';

import { useT } from '@/i18n';
import { MARKER_COLORS, MARKER_PAINT, type Marker, type MarkerColor, type PlacedMarker } from '@/lib/markers';
import { formatTimecode, snapToFrame } from '@/lib/timecode';
import { shortcutHint } from '@/lib/shortcut-hint';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { Popover } from './Popover';
import { Tooltip } from './Tooltip';

export interface MarkerActions {
  onSeek: (ms: number) => void;
  onChange: (id: string, change: { name?: string; color?: MarkerColor; t?: number }) => void;
  onRemove: (id: string) => void;
  /** The marker whose name is asked for (M again on a marker), and that it was opened. */
  naming: string | null;
  onNamed: () => void;
}

/** What is open for one marker: its name being typed (at x, y on the screen), or its menu. */
type Open = { id: string; x: number; y: number; what: 'name' | 'menu' } | null;

/** The menu and the name field for markers, shared by the flags and the notches. */
function useMarkerPanels(list: readonly PlacedMarker[], actions: MarkerActions) {
  const t = useT();
  const [open, setOpen] = React.useState<Open>(null);
  const marker = open ? list.find((p) => p.marker.id === open.id)?.marker : undefined;
  /* a click goes to the marker a moment later, unless a second click makes it a double-click (its name): gone there
     at once, the playhead (its knob on the ruler, its line on the rows) would sit on the marker and take the second */
  const pending = React.useRef<{ id: string; timer: number } | null>(null);
  React.useEffect(() => () => { if (pending.current) window.clearTimeout(pending.current.timer); }, []);
  /** A press on a marker: the second of a double-click names it (true); a first, nothing yet. */
  const secondClick = (e: React.PointerEvent, p: PlacedMarker): boolean => {
    if (pending.current?.id !== p.marker.id) return false;
    window.clearTimeout(pending.current.timer);
    pending.current = null;
    setOpen({ id: p.marker.id, x: e.clientX, y: e.clientY, what: 'name' });
    return true;
  };
  /** A click on a marker that was not a drag: to it, unless a second click follows. */
  const clicked = (p: PlacedMarker) => {
    pending.current = { id: p.marker.id, timer: window.setTimeout(() => { pending.current = null; actions.onSeek(p.ms); }, 260) };
  };
  /* M on a marker already there names it: its field opens under it (the playhead's knob may cover the flag itself) */
  const { naming, onNamed } = actions;
  React.useEffect(() => {
    if (!naming || !list.some((p) => p.marker.id === naming)) return;
    const el = document.querySelector(`[data-marker="${CSS.escape(naming)}"], [data-clip-marker="${CSS.escape(naming)}"]`);
    const r = el?.getBoundingClientRect();
    if (r) setOpen({ id: naming, x: r.left + 4, y: r.bottom, what: 'name' });
    onNamed();
  }, [naming, list, onNamed]);
  const items = (m: Marker): ContextMenuEntry[] => [
    { id: 'rename', label: t('editorTools.markerRename'), onSelect: () => setOpen((o) => (o ? { ...o, what: 'name' } : o)) },
    {
      id: 'color',
      label: t('editorTools.markerColor'),
      submenu: MARKER_COLORS.map((c) => ({
        id: `color:${c}`,
        label: t(`editorTools.colors.${c}`),
        checked: m.color === c,
        icon: <span className="block h-2.5 w-2.5 rounded-full" style={{ background: MARKER_PAINT[c] }} />,
        onSelect: () => actions.onChange(m.id, { color: c }),
      })),
    },
    { id: 'sep', separator: true },
    { id: 'delete', label: t('editorTools.markerDelete'), danger: true, icon: <Trash2 size={14} />, onSelect: () => actions.onRemove(m.id) },
  ];
  const panels = marker && open ? (
    open.what === 'menu'
      ? <ContextMenu x={open.x} y={open.y} items={items(marker)} onClose={() => setOpen((o) => (o?.what === 'menu' ? null : o))} />
      : createPortal(
        <MarkerNameField marker={marker} x={open.x} y={open.y} onDone={(name) => { if (name != null) actions.onChange(marker.id, { name }); setOpen(null); }} />,
        document.body,
      )
  ) : null;
  return { setOpen, panels, secondClick, clicked };
}

/** A marker's name, typed in a small field where it was double-clicked: Enter keeps it, Esc leaves it. */
function MarkerNameField({ marker, x, y, onDone }: { marker: Marker; x: number; y: number; onDone: (name: string | null) => void }) {
  const t = useT();
  const done = React.useRef(false);
  const finish = (name: string | null) => { if (!done.current) { done.current = true; onDone(name); } };
  return (
    <div className="fixed z-[10001] rounded-[6px] border p-1 shadow-lg" style={{ left: Math.max(8, Math.min(x - 90, window.innerWidth - 200)), top: y + 8, background: 'var(--tl-head)', borderColor: 'var(--tl-line)' }}
      data-popover-panel="">
      <input
        autoFocus
        defaultValue={marker.name ?? ''}
        maxLength={80}
        aria-label={t('editorTools.markerName')}
        placeholder={t('editorTools.markerName')}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(e.currentTarget.value);
          if (e.key === 'Escape') finish(null);
        }}
        onBlur={(e) => finish(e.currentTarget.value)}
        className="h-[24px] w-[180px] rounded-[4px] bg-[var(--bg)] px-1.5 text-[12px] text-[var(--text)] outline-none ring-1 ring-[var(--tl-accent)]"
      />
    </div>
  );
}

/** The film's markers on the ruler, inside its scrolled strip. */
export function RulerMarkers({ placed, pxPerMs, actions }: { placed: readonly PlacedMarker[]; pxPerMs: number; actions: MarkerActions }) {
  const t = useT();
  const { setOpen, panels, secondClick, clicked } = useMarkerPanels(placed, actions);
  const [moving, setMoving] = React.useState<{ id: string; ms: number } | null>(null);
  const press = (e: React.PointerEvent, p: PlacedMarker) => {
    if (e.button !== 0) return;
    /* the ruler under it scrubs: a flag is pressed on its own */
    e.preventDefault();
    e.stopPropagation();
    if (secondClick(e, p)) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    let to = p.ms;
    let dragged = false;
    const move = (ev: PointerEvent) => {
      if (!dragged && Math.abs(ev.clientX - x0) < 4) return;
      dragged = true;
      to = snapToFrame(Math.max(0, p.ms + (ev.clientX - x0) / pxPerMs));
      setMoving({ id: p.marker.id, ms: to });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setMoving(null);
      if (dragged) actions.onChange(p.marker.id, { t: to / 1000 });
      else clicked(p);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return (
    <>
      {placed.filter((p) => !p.clip).map((p) => {
        const ms = moving?.id === p.marker.id ? moving.ms : p.ms;
        const color = MARKER_PAINT[p.marker.color];
        const name = p.marker.name ?? '';
        return (
          <div
            key={p.marker.id}
            className="absolute top-0 z-[2] flex h-full cursor-pointer items-start"
            style={{ left: ms * pxPerMs - 1 }}
            data-marker={p.marker.id}
            title={`${name || t('editorTools.markerUntitled')} · ${formatTimecode(ms)}`}
            onPointerDown={(e) => press(e, p)}
            onDoubleClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setOpen({ id: p.marker.id, x: e.clientX, y: e.clientY, what: 'menu' }); }}
          >
            {/* the flag: a pole down the ruler and a pennant at its top */}
            <span className="block h-full w-[2px]" style={{ background: color }} />
            <svg width="9" height="10" viewBox="0 0 9 10" className="block shrink-0" aria-hidden>
              <path d="M0 0 H9 L6 4.5 L9 9 H0 Z" fill={color} />
            </svg>
            {name ? (
              <span className="ml-0.5 max-w-[120px] truncate rounded-[2px] px-0.5 text-[9.5px] font-medium leading-[11px]"
                style={{ color: '#111', background: color }}>{name}</span>
            ) : null}
          </div>
        );
      })}
      {panels}
    </>
  );
}

/** A clip's markers on its row: notches along the bottom of the clip, where each moment of its file is. */
export function ClipMarkers({ placed, pxPerMs, height, actions }: {
  /** this track's clip markers */
  placed: readonly PlacedMarker[];
  pxPerMs: number;
  height: number;
  actions: MarkerActions;
}) {
  const t = useT();
  const { setOpen, panels, secondClick, clicked } = useMarkerPanels(placed, actions);
  if (!placed.length) return null;
  return (
    <>
      {placed.map((p) => (
        <div
          key={p.marker.id}
          className="absolute z-[15] cursor-pointer"
          data-clip-marker={p.marker.id}
          style={{ left: p.ms * pxPerMs - 4, top: height - 10, width: 8, height: 9 }}
          title={`${p.marker.name || t('editorTools.markerUntitled')} · ${formatTimecode(p.ms)}`}
          onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); e.stopPropagation(); if (!secondClick(e, p)) clicked(p); } }}
          onDoubleClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setOpen({ id: p.marker.id, x: e.clientX, y: e.clientY, what: 'menu' }); }}
        >
          <svg width="8" height="9" viewBox="0 0 8 9" aria-hidden className="block">
            <path d="M0 9 L4 1 L8 9 Z" fill={MARKER_PAINT[p.marker.color]} stroke="rgba(0,0,0,0.45)" strokeWidth="0.8" />
          </svg>
        </div>
      ))}
      {panels}
    </>
  );
}

/** The toolbar's flag button: every marker in time order, to go to, name, color or delete. */
export function MarkersButton({ placed, actions, onAdd, nowMs }: {
  placed: readonly PlacedMarker[];
  actions: MarkerActions;
  onAdd: () => void;
  nowMs: number;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const label = t('editorTools.markers');
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="auto"
      align="end"
      trigger={
        <Tooltip side="bottom" label={label}>
          <button
            type="button"
            aria-label={label}
            aria-expanded={open}
            data-markers-button=""
            onMouseDown={(e) => e.preventDefault()}
            className="relative flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[6px] outline-none transition hover:bg-black/5 focus-visible:ring-1 focus-visible:ring-[var(--tl-accent)] dark:hover:bg-white/10"
            style={{ color: 'var(--text-dim)' }}
          >
            <Flag size={15} />
            {placed.length ? (
              <span className="absolute right-[2px] top-[2px] min-w-[12px] rounded-full px-[3px] text-[8.5px] font-semibold leading-[12px] text-white"
                style={{ background: 'var(--tl-accent)' }}>{placed.length}</span>
            ) : null}
          </button>
        </Tooltip>
      }
    >
      <div className="flex max-h-[min(360px,var(--popover-max-h))] w-[300px] flex-col rounded-[8px] border shadow-lg" data-markers-list=""
        style={{ background: 'var(--tl-head)', borderColor: 'var(--tl-line)' }}>
        <div className="flex items-center justify-between border-b px-2.5 py-1.5" style={{ borderColor: 'var(--tl-line)' }}>
          <span className="text-[12px] font-medium" style={{ color: 'var(--tl-text)' }}>{label}</span>
          <button type="button" onClick={onAdd} className="rounded-[4px] px-1.5 py-0.5 text-[11px] hover:bg-black/5 dark:hover:bg-white/10" style={{ color: 'var(--tl-text)' }}>
            {t('editorTools.markerAdd')} <span style={{ color: 'var(--tl-faint)' }}>M</span>
          </button>
        </div>
        {placed.length ? (
          <ul className="min-h-0 flex-1 overflow-y-auto p-1">
            {placed.map((p) => (
              <li key={p.marker.id} className="group flex items-center gap-1.5 rounded-[4px] px-1.5 py-1"
                style={{ background: Math.abs(p.ms - nowMs) < 1 ? 'var(--tl-line)' : undefined }}>
                <button type="button" aria-label={t(`editorTools.colors.${p.marker.color}`)} title={t('editorTools.markerColor')}
                  onClick={() => actions.onChange(p.marker.id, { color: MARKER_COLORS[(MARKER_COLORS.indexOf(p.marker.color) + 1) % MARKER_COLORS.length] })}
                  className="h-3 w-3 shrink-0 rounded-full" style={{ background: MARKER_PAINT[p.marker.color] }} />
                <button type="button" onClick={() => actions.onSeek(p.ms)} className="shrink-0 font-mono text-[10.5px] tabular-nums hover:underline"
                  style={{ color: 'var(--tl-text)' }}>{formatTimecode(p.ms, { hours: false })}</button>
                <input
                  key={p.marker.name ?? ''}
                  defaultValue={p.marker.name ?? ''}
                  placeholder={p.clip ? t('editorTools.markerOnClip').replace('{clip}', p.clip.title) : t('editorTools.markerUntitled')}
                  aria-label={t('editorTools.markerName')}
                  maxLength={80}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); }}
                  onBlur={(e) => { if (e.currentTarget.value.trim() !== (p.marker.name ?? '')) actions.onChange(p.marker.id, { name: e.currentTarget.value }); }}
                  className="h-[22px] min-w-0 flex-1 rounded-[3px] bg-transparent px-1 text-[11.5px] text-[var(--text)] outline-none focus:bg-[var(--bg)] focus:ring-1 focus:ring-[var(--tl-accent)]"
                />
                <button type="button" aria-label={t('editorTools.markerDelete')} title={t('editorTools.markerDelete')} onClick={() => actions.onRemove(p.marker.id)}
                  className="shrink-0 rounded-[3px] p-0.5 opacity-0 transition group-hover:opacity-100 focus:opacity-100 hover:bg-black/5 dark:hover:bg-white/10"
                  style={{ color: 'var(--text-dim)' }}><Trash2 size={12} /></button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-3 text-[11.5px] leading-snug" style={{ color: 'var(--tl-faint)' }}>{t('editorTools.markerNone')}</p>
        )}
        <p className="border-t px-2.5 py-1 text-[10.5px]" style={{ borderColor: 'var(--tl-line)', color: 'var(--tl-faint)' }}>
          {t('editorTools.markerKeys').replace('{next}', shortcutHint('M', { shift: true })).replace('{prev}', shortcutHint('M', { alt: true }))}
        </p>
      </div>
    </Popover>
  );
}
