/** The player bar's two parts: the seek bar and the round icon button. */
import React from 'react';
import { useT } from '@/i18n';
import { secondFrames, stepFrames } from '@/lib/timecode';

/** The played part and the knob. */
const SEEK_COLOR = '#f03';

export function TransportSeekBar({
  timeMs,
  totalMs,
  onPreview,
  onCommit,
}: {
  timeMs: number;
  totalMs: number;
  /** While dragging: show that frame only. */
  onPreview(ms: number): void;
  /** On release: go there. */
  onCommit(ms: number): void;
}) {
  const t = useT();
  const ref = React.useRef<HTMLDivElement | null>(null);
  const fillRef = React.useRef<HTMLDivElement | null>(null);
  const thumbRef = React.useRef<HTMLDivElement | null>(null);
  const dragging = React.useRef(false);
  const [hovering, setHovering] = React.useState(false);
  const [dragActive, setDragActive] = React.useState(false);
  /** pointer x from the bar's left edge, in px */
  const [hoverX, setHoverX] = React.useState<number | null>(null);
  const active = hovering || dragActive;
  /* the last valid position while dragging: on release/cancel clientX can be 0 (Safari, lost capture) */
  const lastValidMs = React.useRef(timeMs);
  const activePointerId = React.useRef<number | null>(null);
  const cleanupDragListeners = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    if (!dragging.current) lastValidMs.current = timeMs;
  }, [timeMs]);

  const applyProgress = React.useCallback((ms: number) => {
    const pct = totalMs ? (ms / totalMs) * 100 : 0;
    if (fillRef.current) fillRef.current.style.width = `${pct}%`;
    if (thumbRef.current) thumbRef.current.style.left = `${pct}%`;
  }, [totalMs]);

  React.useEffect(() => {
    applyProgress(timeMs);
  }, [timeMs, applyProgress]);

  const pos = React.useCallback((clientX: number): number | null => {
    const el = ref.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    /* no width yet (bar not laid out) or a bad coordinate: skip, never jump to the start on NaN/0 */
    if (!(r.width > 0) || !Number.isFinite(clientX)) return null;
    /* Safari sometimes reports clientX 0 on capture release; not valid unless the bar touches the left edge */
    if (clientX === 0 && r.left > 1) return null;
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * totalMs;
  }, [totalMs]);

  const cleanupDocumentDrag = React.useCallback(() => {
    cleanupDragListeners.current?.();
    cleanupDragListeners.current = null;
    activePointerId.current = null;
  }, []);

  const previewAt = React.useCallback((clientX: number) => {
    const ms = pos(clientX);
    if (ms == null) return;
    lastValidMs.current = ms;
    onPreview(ms);
  }, [onPreview, pos]);

  const finishDrag = React.useCallback((releaseClientX?: number) => {
    if (!dragging.current) return;
    dragging.current = false;
    setDragActive(false);
    cleanupDocumentDrag();
    let ms = lastValidMs.current;
    if (releaseClientX != null) {
      const atRelease = pos(releaseClientX);
      if (atRelease != null) ms = atRelease;
    }
    if (!Number.isFinite(ms)) return;
    onCommit(ms);
  }, [cleanupDocumentDrag, onCommit, pos]);

  React.useEffect(() => cleanupDocumentDrag, [cleanupDocumentDrag]);

  /* pointer capture is the main path; the document listeners are the fallback when capture is lost and the release
     never comes back to the bar (it would stick to the pointer) */
  return (
    <div
      ref={ref}
      role="slider"
      aria-label={t('player.seek')}
      aria-valuemin={0}
      aria-valuemax={totalMs}
      aria-valuenow={Math.max(0, Math.min(totalMs, timeMs))}
      tabIndex={0}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        /* a frame, ⇧ a second: the arrows step the same everywhere in Studio */
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? totalMs
          : Math.max(0, Math.min(totalMs, stepFrames(timeMs, (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? secondFrames() : 1))));
        onPreview(next);
        onCommit(next);
      }}
      style={{
        position: 'relative',
        height: 16,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        touchAction: 'none',
      }}
      onPointerDown={e => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        e.preventDefault();
        e.stopPropagation();
        const ms = pos(e.clientX);
        if (ms == null) return;
        dragging.current = true;
        setDragActive(true);
        lastValidMs.current = ms;
        cleanupDocumentDrag();
        activePointerId.current = e.pointerId;
        const doc = e.currentTarget.ownerDocument;
        const onDocMove = (ev: PointerEvent) => {
          if (ev.pointerId !== activePointerId.current) return;
          ev.preventDefault();
          previewAt(ev.clientX);
        };
        const onDocEnd = (ev: PointerEvent) => {
          if (ev.pointerId !== activePointerId.current) return;
          ev.preventDefault();
          finishDrag(ev.clientX);
        };
        doc.addEventListener('pointermove', onDocMove, true);
        doc.addEventListener('pointerup', onDocEnd, true);
        doc.addEventListener('pointercancel', onDocEnd, true);
        cleanupDragListeners.current = () => {
          doc.removeEventListener('pointermove', onDocMove, true);
          doc.removeEventListener('pointerup', onDocEnd, true);
          doc.removeEventListener('pointercancel', onDocEnd, true);
        };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the document listeners cover it */ }
        onPreview(ms);
      }}
      onPointerMove={e => {
        const r = ref.current?.getBoundingClientRect();
        if (r && r.width > 0) setHoverX(Math.max(0, Math.min(r.width, e.clientX - r.left)));
        if (!dragging.current) return;
        previewAt(e.clientX);
      }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => { setHovering(false); setHoverX(null); }}
      onPointerUp={e => {
        if (!dragging.current) return;
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
        finishDrag(e.clientX);
      }}
      onPointerCancel={(e) => {
        finishDrag(e.clientX);
      }}
    >
      {/* hover time bubble */}
      {hovering && hoverX != null && (() => {
        const el = ref.current;
        const w = el?.getBoundingClientRect().width ?? 0;
        if (!(w > 0) || !Number.isFinite(totalMs)) return null;
        const hoverMs = (hoverX / w) * totalMs;
        return (
          <div
            style={{
              position: 'absolute',
              left: hoverX,
              bottom: 20,
              transform: 'translateX(-50%)',
              padding: '3px 8px',
              borderRadius: 4,
              background: 'rgba(0,0,0,.82)',
              color: '#fff',
              fontSize: 12,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              fontVariantNumeric: 'tabular-nums',
              textAlign: 'center',
            }}
          >
            {transportTimeText(hoverMs)}
          </div>
        );
      })()}
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: active ? 5 : 3,
          borderRadius: active ? 2.5 : 1.5,
          background: 'rgba(255,255,255,.25)',
          pointerEvents: 'none',
          transition: 'height .1s',
        }}
      >
        <div
          ref={fillRef}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '0%',
            background: SEEK_COLOR,
            pointerEvents: 'none',
          }}
        />
        {/* the round thumb: shown on hover and while dragging */}
        <div
          ref={thumbRef}
          style={{
            position: 'absolute',
            left: '0%',
            top: '50%',
            width: 13,
            height: 13,
            marginLeft: -6.5,
            marginTop: -6.5,
            borderRadius: '50%',
            background: SEEK_COLOR,
            transform: active ? 'scale(1)' : 'scale(0)',
            transition: 'transform .1s',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}

export function TransportIconBtn({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode;
  onClick(): void;
  title?: string;
  /** Buttons that open a panel (settings): a light background while it is open. */
  active?: boolean;
}) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      /* no focus on click: the next Space would land on the button with a focus ring; Tab focus is kept */
      onMouseDown={(e) => e.preventDefault()}
      style={{
        border: 0,
        background: active ? 'rgba(255,255,255,.2)' : 'transparent',
        color: '#fff',
        cursor: 'pointer',
        padding: '4px 6px',
        borderRadius: 6,
        lineHeight: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        opacity: hover ? 1 : 0.9,
        transform: hover ? 'scale(1.08)' : 'scale(1)',
        transition: 'opacity .1s, transform .1s',
      }}
    >
      {children}
    </button>
  );
}

/** `m:ss`, for the bar's readout and the hover bubble. */
export function transportTimeText(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
