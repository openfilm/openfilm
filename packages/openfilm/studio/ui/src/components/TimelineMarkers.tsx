/**
 * Markers on the timeline (lib/markers): pins on their own row under the ruler for the film's, notches on the clips for
 * a clip's. A click goes to a marker and opens its card (its name, its color, delete), a drag moves a pin along its
 * row, a right-click opens the card too. M (or the toolbar's button) adds one at the playhead (M on one opens its card),
 * ⇧M / ⌥M go to the next / the one before.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';

import { useT } from '@/i18n';
import { MARKER_COLORS, MARKER_NAME_MAX, MARKER_PAINT, type Marker, type MarkerColor, type PlacedMarker } from '@/lib/markers';
import { formatTimecode, snapToFrame } from '@/lib/timecode';

import type { MarkerLaneView } from './Timeline';

export interface MarkerActions {
  onSeek: (ms: number) => void;
  onChange: (id: string, change: { name?: string; color?: MarkerColor; t?: number }) => void;
  onRemove: (id: string) => void;
  /** The marker whose card is asked for (M again on a marker), and that it was opened. */
  naming: string | null;
  onNamed: () => void;
}

/** The card open for one marker, under (x, y) on the screen; `name`: its name field takes the keys at once. */
type Open = { id: string; x: number; y: number; name: boolean } | null;

/** The card shared by the pins and the notches, and what opens it. */
function useMarkerCard(list: readonly PlacedMarker[], actions: MarkerActions) {
  const [open, setOpen] = React.useState<Open>(null);
  const placed = open ? list.find((p) => p.marker.id === open.id) : undefined;
  /* M on a marker already there: its card, its name field ready (the playhead's knob may cover the pin itself) */
  const { naming, onNamed } = actions;
  React.useEffect(() => {
    if (!naming || !list.some((p) => p.marker.id === naming)) return;
    const el = document.querySelector(`[data-marker="${CSS.escape(naming)}"], [data-clip-marker="${CSS.escape(naming)}"]`);
    const r = el?.getBoundingClientRect();
    if (r) setOpen({ id: naming, x: r.left + r.width / 2, y: r.bottom, name: true });
    onNamed();
  }, [naming, list, onNamed]);
  /* a marker that went (undone, its clip deleted): its card goes with it */
  React.useEffect(() => { if (open && !placed) setOpen(null); }, [open, placed]);
  const card = placed && open ? createPortal(
    <MarkerCard key={placed.marker.id} placed={placed} x={open.x} y={open.y} focusName={open.name} actions={actions} onClose={() => setOpen(null)} />,
    document.body,
  ) : null;
  /** Open a marker's card under its pin. */
  const openAt = (el: Element, p: PlacedMarker, name = false) => {
    const r = el.getBoundingClientRect();
    setOpen({ id: p.marker.id, x: r.left + r.width / 2, y: r.bottom, name });
  };
  return { open, setOpen, openAt, card };
}

/**
 * A marker's card: its name (typed in, kept on Enter or when the card is left), its color (kept at a click), where it
 * is, and delete (also Delete / ⌫ while the card has the keys). Esc or a press elsewhere closes it, the name kept.
 */
function MarkerCard({ placed, x, y, focusName, actions, onClose }: {
  placed: PlacedMarker; x: number; y: number; focusName: boolean; actions: MarkerActions; onClose: () => void;
}) {
  const t = useT();
  const { marker } = placed;
  const box = React.useRef<HTMLDivElement | null>(null);
  const field = React.useRef<HTMLInputElement | null>(null);
  const keepName = () => {
    const name = field.current?.value ?? '';
    if (name.trim() !== (marker.name ?? '')) actions.onChange(marker.id, { name });
  };
  const close = () => { keepName(); onClose(); };
  const closeRef = React.useRef(close);
  closeRef.current = close;
  React.useEffect(() => {
    if (focusName) { field.current?.focus(); field.current?.select(); } else box.current?.focus();
    /* a press elsewhere: the name as typed is kept, the card goes */
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) closeRef.current(); };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [focusName]);
  const W = 224;
  return (
    <div
      ref={box}
      tabIndex={-1}
      role="dialog"
      aria-label={marker.name || t('editorTools.markerUntitled')}
      data-popover-panel=""
      data-marker-card={marker.id}
      /* portaled, but React still bubbles its events up to the pin's ruler or clip (which take the press for
         themselves, and the field would never get the keys): the card's presses stay in the card */
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        /* the card's keys are its own: not the timeline's (Delete there deletes clips) */
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if ((e.key === 'Delete' || e.key === 'Backspace') && e.target === box.current) { e.preventDefault(); actions.onRemove(marker.id); onClose(); }
      }}
      className="fixed z-[10001] flex flex-col gap-2 rounded-[8px] border p-2 shadow-[var(--shadow-lg)] outline-none"
      style={{ left: Math.max(8, Math.min(x - W / 2, window.innerWidth - W - 8)), top: y + 6, width: W, background: 'var(--bg-raised)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center gap-1.5">
        <span className="shrink-0"><MarkerGlyph size={13} fill={MARKER_PAINT[marker.color]} /></span>
        <input
          ref={field}
          defaultValue={marker.name ?? ''}
          maxLength={MARKER_NAME_MAX}
          aria-label={t('editorTools.markerName')}
          placeholder={t('editorTools.markerUntitled')}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); close(); }
            if (e.key === 'Escape') { e.preventDefault(); close(); }
          }}
          onBlur={keepName}
          className="h-[24px] min-w-0 flex-1 rounded-[4px] bg-[var(--bg-panel)] px-1.5 text-[12px] text-[var(--text)] outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
        />
      </div>
      <div className="flex items-center gap-1" role="radiogroup" aria-label={t('editorTools.markerColor')}>
        {MARKER_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={marker.color === c}
            aria-label={t(`editorTools.colors.${c}`)}
            title={t(`editorTools.colors.${c}`)}
            onClick={() => actions.onChange(marker.id, { color: c })}
            className="flex h-[22px] w-[22px] items-center justify-center rounded-full outline-none transition hover:bg-black/5 focus-visible:ring-1 focus-visible:ring-[var(--accent)] dark:hover:bg-white/10"
          >
            <span className="block h-3 w-3 rounded-full" style={{ background: MARKER_PAINT[c], boxShadow: marker.color === c ? `0 0 0 2px var(--bg-panel), 0 0 0 3.5px ${MARKER_PAINT[c]}` : undefined }} />
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between border-t pt-1.5" style={{ borderColor: 'var(--border)' }}>
        <span className="font-mono text-[10.5px] tabular-nums" style={{ color: 'var(--text-faint)' }}>{formatTimecode(placed.ms)}</span>
        <button
          type="button"
          onClick={() => { actions.onRemove(marker.id); onClose(); }}
          className="flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[11px] outline-none transition hover:bg-black/5 focus-visible:ring-1 focus-visible:ring-[var(--accent)] dark:hover:bg-white/10"
          style={{ color: 'var(--text-muted)' }}
        >
          <Trash2 size={12} aria-hidden />{t('editorTools.markerDelete')}
        </button>
      </div>
    </div>
  );
}

/** A marker's name and time, on a tag in its color beside its pin (hovered, or while it is dragged). */
function MarkerTag({ marker, ms, flip }: { marker: Marker; ms: number; flip: boolean }) {
  const t = useT();
  return (
    <span
      className="pointer-events-none absolute top-1/2 z-[3] flex h-[14px] items-center gap-1 whitespace-nowrap rounded-[3px] px-[5px] text-[10px] font-medium leading-none tabular-nums shadow-[0_1px_3px_rgba(0,0,0,.35)]"
      style={{ left: 0, background: MARKER_PAINT[marker.color], color: '#111', transform: `translate(${flip ? 'calc(-100% - 9px)' : '9px'}, -50%)` }}
    >
      <span className="max-w-[160px] truncate">{marker.name || t('editorTools.markerUntitled')}</span>
      <span style={{ opacity: 0.65 }}>{formatTimecode(ms, { hours: false })}</span>
    </span>
  );
}

/** The marker's shape: a tab pointing down at its moment. Outlined for the toolbar's button, filled for a pin. */
export function MarkerGlyph({ size = 16, fill, ring }: { size?: number; fill?: string; ring?: boolean }) {
  if (!fill) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M4 2.5h8a1 1 0 0 1 1 1v6.3a1 1 0 0 1-.38.78l-4 3.2a1 1 0 0 1-1.24 0l-4-3.2A1 1 0 0 1 3 9.8V3.5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width={size * 0.8} height={size} viewBox="0 0 10 12.5" aria-hidden className="block overflow-visible">
      <path
        d="M1.2.5h7.6a.7.7 0 0 1 .7.7v6.9a.7.7 0 0 1-.26.54L5.44 11.8a.7.7 0 0 1-.88 0L.76 8.64A.7.7 0 0 1 .5 8.1V1.2a.7.7 0 0 1 .7-.7Z"
        fill={fill}
        stroke={ring ? '#fff' : 'rgba(0,0,0,.4)'}
        strokeWidth={ring ? 1.4 : 0.8}
      />
    </svg>
  );
}

/**
 * The film's markers on their row under the ruler: a pin each. Hovered: its name and time, and its line through the
 * timeline. Dragged: it moves (snapping as clips do), its line and time shown all the way. A click goes there and
 * opens its card; a right-click opens the card with its name ready.
 */
export function LaneMarkers({ placed, lane, actions }: { placed: readonly PlacedMarker[]; lane: MarkerLaneView; actions: MarkerActions }) {
  const { open, openAt, card } = useMarkerCard(placed, actions);
  const [moving, setMoving] = React.useState<{ id: string; ms: number } | null>(null);
  const [hover, setHover] = React.useState<string | null>(null);
  const { pxPerMs, widthPx, snap, guide } = lane;
  /* the click after a drag is not one */
  const wasDragged = React.useRef(false);
  const press = (e: React.PointerEvent, p: PlacedMarker) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const color = MARKER_PAINT[p.marker.color];
    let to = p.ms;
    let dragged = false;
    const move = (ev: PointerEvent) => {
      if (!dragged && Math.abs(ev.clientX - x0) < 4) return;
      dragged = true;
      to = snapToFrame(snap(Math.max(0, p.ms + (ev.clientX - x0) / pxPerMs)));
      setMoving({ id: p.marker.id, ms: to });
      guide({ ms: to, color, held: true });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setMoving(null);
      guide(null);
      if (dragged && to !== p.ms) actions.onChange(p.marker.id, { t: to / 1000 });
      wasDragged.current = dragged;
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const film = placed.filter((p) => !p.clip);
  /* where each pin is drawn, left to right: a name runs up to the next pin */
  const xs = film.map((p) => (moving?.id === p.marker.id ? moving.ms : p.ms) * pxPerMs).sort((a, b) => a - b);
  return (
    <>
      {film.map((p) => {
        const ms = moving?.id === p.marker.id ? moving.ms : p.ms;
        const x = ms * pxPerMs;
        const on = open?.id === p.marker.id;
        const tagged = moving?.id === p.marker.id || (hover === p.marker.id && !on);
        const room = Math.min(160, (xs.find((o) => o > x) ?? widthPx) - x - 14);
        return (
          <div
            key={p.marker.id}
            className="absolute inset-y-0 z-[2] flex w-[14px] -translate-x-1/2 cursor-ew-resize items-center justify-center"
            /* one at the very start is drawn whole, a few px in (its line stays on the moment) */
            style={{ left: Math.max(x, 7) }}
            data-marker={p.marker.id}
            aria-label={p.marker.name || undefined}
            onPointerDown={(e) => press(e, p)}
            onPointerEnter={() => {
              setHover(p.marker.id);
              if (!moving) guide({ ms: p.ms, color: MARKER_PAINT[p.marker.color], held: false });
            }}
            onPointerLeave={() => {
              setHover((h) => (h === p.marker.id ? null : h));
              if (!moving) guide(null);
            }}
            onClick={(e) => {
              /* a click: there, and its card */
              e.stopPropagation();
              if (wasDragged.current) { wasDragged.current = false; return; }
              actions.onSeek(p.ms);
              openAt(e.currentTarget, p);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openAt(e.currentTarget, p, true); }}
          >
            <MarkerGlyph size={12} fill={MARKER_PAINT[p.marker.color]} ring={on} />
            {tagged ? (
              <span className="absolute inset-y-0 left-1/2">
                <MarkerTag marker={p.marker} ms={ms} flip={x > widthPx - 180} />
              </span>
            ) : p.marker.name && room >= 16 ? (
              /* its name beside it, as far as the next pin */
              <span
                className="pointer-events-none absolute left-[12px] top-1/2 -translate-y-1/2 truncate whitespace-nowrap text-[10px] leading-none"
                style={{ maxWidth: room, color: 'var(--text-muted)' }}
                data-marker-name=""
              >
                {p.marker.name}
              </span>
            ) : null}
          </div>
        );
      })}
      {card}
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
  const { openAt, card } = useMarkerCard(placed, actions);
  if (!placed.length) return card;
  return (
    <>
      {placed.map((p) => (
        <div
          key={p.marker.id}
          className="absolute z-[15] cursor-pointer"
          data-clip-marker={p.marker.id}
          style={{ left: p.ms * pxPerMs - 4, top: height - 10, width: 8, height: 9 }}
          title={`${p.marker.name || t('editorTools.markerUntitled')} · ${formatTimecode(p.ms)}`}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            actions.onSeek(p.ms);
            openAt(e.currentTarget, p);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openAt(e.currentTarget, p, true); }}
        >
          <svg width="8" height="9" viewBox="0 0 8 9" aria-hidden className="block">
            <path d="M0 9 L4 1 L8 9 Z" fill={MARKER_PAINT[p.marker.color]} stroke="rgba(0,0,0,0.45)" strokeWidth="0.8" />
          </svg>
        </div>
      ))}
      {card}
    </>
  );
}
