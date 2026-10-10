/**
 * A mask edited on the picture (the inspector's Mask › Edit on picture): its outline over the clip or layer in hand,
 * turned with it, and CapCut's handles — a press inside moves it (anywhere in the box for a line or a band), the squares
 * resize it, the round knob above turns it, the knob below pulled outward feathers it. The geometry is lib/stage-mask's.
 *
 * A drag shows on the picture as it goes (the session's preview, a frame at a time) and is written once, at the
 * release: one change, one undo step. Esc during a drag gives it up. Its presses are its own: none reaches the stage
 * (which would move the clip or start a marquee); a press elsewhere goes on to the stage as usual.
 */
import * as React from 'react';

import { FRAME_BLUE, GestureHint, type FrameGeometry } from '@/components/StageTransformFrame';
import { useT } from '@/i18n';
import { HEART_D, STAR_D, type Mask } from '@/lib/clip-mask';
import {
  draggedMask, featherPx, handlePivot, lineInBox, maskFrame, maskHandles, toLocal, type MaskDrag, type MaskHandleId,
  type MaskSession,
} from '@/lib/stage-mask';

type P = { x: number; y: number };

/** A resize cursor for a handle turned `angle` degrees (as the frame's). */
function resizeCursor(angle: number): string {
  const a = ((angle % 180) + 180) % 180;
  if (a < 22.5 || a >= 157.5) return 'ew-resize';
  if (a < 67.5) return 'nwse-resize';
  if (a < 112.5) return 'ns-resize';
  return 'nesw-resize';
}
const HANDLE_ANGLE: Record<MaskHandleId, number> = { e: 0, w: 0, n: 90, s: 90, nw: 45, se: 45, ne: 135, sw: 135 };

const fmt = (n: number) => String(Math.round(n * 10) / 10);

export function StageMaskOverlay({ frame, session }: {
  /** The box the mask is drawn in, on the overlay (whole: a crop does not move a mask). */
  frame: FrameGeometry;
  session: MaskSession;
}) {
  const t = useT();
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  /* what is drawn while dragging, and after the release until the written mask comes back as the session's */
  const [live, setLive] = React.useState<Mask | null>(null);
  const [hint, setHint] = React.useState<{ x: number; y: number; text: string } | null>(null);
  const drag = React.useRef<{ kind: MaskDrag; m0: Mask; from: P; frame: FrameGeometry; el: Element; pointerId: number; last: Mask } | null>(null);
  const previewRaf = React.useRef(0);
  const settle = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (drag.current) return;
    setLive(null);
  }, [session]);
  React.useEffect(() => () => {
    if (previewRaf.current) cancelAnimationFrame(previewRaf.current);
    if (settle.current) clearTimeout(settle.current);
  }, []);

  const stagePoint = (e: { clientX: number; clientY: number }): P => {
    const r = rootRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (previewRaf.current) { cancelAnimationFrame(previewRaf.current); previewRaf.current = 0; }
    setHint(null);
    try { if (d?.el.hasPointerCapture(d.pointerId)) d.el.releasePointerCapture(d.pointerId); } catch { /* gone already */ }
    return d;
  };
  const cancel = () => {
    const d = end();
    if (!d) return;
    setLive(null);
    sessionRef.current.cancel();
  };
  const finish = () => {
    const d = end();
    if (!d) return;
    if (JSON.stringify(d.last) === JSON.stringify(d.m0)) { setLive(null); return; }
    setLive(d.last);
    sessionRef.current.commit(d.last);
    /* a write refused never comes back: the mask as written shows again */
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => { if (!drag.current) setLive(null); }, 2000);
  };
  const step = (e: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean }) => {
    const d = drag.current;
    if (!d) return;
    const p = stagePoint(e);
    const box = { w: Math.max(1, d.frame.w), h: Math.max(1, d.frame.h) };
    const next = draggedMask(d.m0, d.kind, box, d.from, toLocal(d.frame, p), { shift: e.shiftKey, alt: e.altKey });
    d.last = next;
    setLive(next);
    const text = d.kind.kind === 'move' ? `X ${fmt(next.x)}%  Y ${fmt(next.y)}%`
      : d.kind.kind === 'turn' ? `${fmt(next.rotate)}°`
        : d.kind.kind === 'feather' ? `${t('inspector.maskFeather')} ${fmt(next.feather)}%`
          : next.shape === 'mirror' ? `${fmt(next.h)}%` : `${fmt(next.w)}% × ${fmt(next.h)}%`;
    setHint({ x: p.x, y: p.y, text });
    if (!previewRaf.current) {
      previewRaf.current = requestAnimationFrame(() => {
        previewRaf.current = 0;
        if (drag.current) sessionRef.current.preview(drag.current.last);
      });
    }
  };

  /* Esc gives a drag up, before the stage hears it (it would let the clip go) */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !drag.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const m = live ?? session.mask;
  const box = { w: Math.max(1, frame.w), h: Math.max(1, frame.h) };
  const f = maskFrame(m, box);
  const handles = maskHandles(m, box);
  const fpx = featherPx(m, box);
  const line = m.shape === 'linear' || m.shape === 'mirror';
  const rad = (f.r * Math.PI) / 180;
  const ux = { x: Math.cos(rad), y: Math.sin(rad) };
  const uy = { x: -Math.sin(rad), y: Math.cos(rad) };
  const at = (a: number, b: number): P => ({ x: f.cx + ux.x * a + uy.x * b, y: f.cy + ux.y * a + uy.y * b });
  const segment = (off: number, key: string, dashed?: boolean) => {
    const seg = lineInBox(at(0, off), ux, box.w, box.h);
    return seg ? <Stroke key={key} d={`M${seg[0].x} ${seg[0].y}L${seg[1].x} ${seg[1].y}`} dashed={dashed} /> : null;
  };
  /* an ellipse `grow` px out of the mask's (its feather's outer edge) */
  const ellipsePath = (grow: number) => {
    const w = Math.max(0, f.w / 2 + grow);
    const h = Math.max(0, f.h / 2 + grow);
    return `M${f.cx - w} ${f.cy}a${w} ${h} 0 1 0 ${2 * w} 0a${w} ${h} 0 1 0 ${-2 * w} 0Z`;
  };

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute left-0 top-0 z-[6]"
      onPointerDown={(e) => {
        const part = (e.target as HTMLElement | null)?.closest('[data-mask-kind]');
        if (!part || e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        const kind = part.getAttribute('data-mask-kind');
        const handle = part.getAttribute('data-mask-handle') as MaskHandleId | null;
        const dk: MaskDrag | null = kind === 'move' ? { kind: 'move' } : kind === 'turn' ? { kind: 'turn' } : kind === 'feather' ? { kind: 'feather' }
          : kind === 'resize' && handle ? { kind: 'resize', handle: handlePivot(handle) } : null;
        if (!dk) return;
        if (settle.current) { clearTimeout(settle.current); settle.current = null; }
        part.setPointerCapture(e.pointerId);
        drag.current = { kind: dk, m0: m, from: toLocal(frame, stagePoint(e)), frame, el: part, pointerId: e.pointerId, last: m };
      }}
      onPointerMove={(e) => { if (!drag.current) return; e.stopPropagation(); step(e); }}
      onPointerUp={(e) => { if (!drag.current) return; e.stopPropagation(); step(e); finish(); }}
      onPointerCancel={(e) => { if (!drag.current) return; e.stopPropagation(); finish(); }}
      /* the system took the pointer: kept where it last was, as the stage's own gestures are */
      onLostPointerCapture={(e) => { e.stopPropagation(); if (drag.current) finish(); }}
      onDoubleClick={(e) => { if ((e.target as HTMLElement | null)?.closest('[data-mask-kind]')) e.stopPropagation(); }}
    >
      <div
        className="absolute"
        style={{
          left: frame.cx - frame.w / 2,
          top: frame.cy - frame.h / 2,
          width: frame.w,
          height: frame.h,
          transform: frame.r ? `rotate(${frame.r}deg)` : undefined,
        }}
      >
        {/* moved from inside the shape; a line or a band from anywhere in the box */}
        <div
          data-mask-kind="move"
          aria-label={t('stageMask.move')}
          className={`pointer-events-auto absolute ${drag.current?.kind.kind === 'move' ? 'cursor-grabbing' : 'cursor-move'}`}
          style={line ? { inset: 0 } : {
            left: f.cx - Math.max(f.w, 12) / 2,
            top: f.cy - Math.max(f.h, 12) / 2,
            width: Math.max(f.w, 12),
            height: Math.max(f.h, 12),
            transform: f.r ? `rotate(${f.r}deg)` : undefined,
          }}
        />
        <svg aria-hidden className="pointer-events-none absolute left-0 top-0 overflow-visible" width={box.w} height={box.h}>
          {m.shape === 'linear' ? (
            <>
              {segment(0, 'line')}
              {fpx > 0 ? <>{segment(fpx / 2, 'a', true)}{segment(-fpx / 2, 'b', true)}</> : null}
            </>
          ) : m.shape === 'mirror' ? (
            <>
              {segment(-f.h / 2, 'top')}
              {segment(f.h / 2, 'bottom')}
              {fpx > 0 ? <>{segment(-f.h / 2 - fpx / 2, 'ta', true)}{segment(f.h / 2 + fpx / 2, 'ba', true)}</> : null}
            </>
          ) : m.shape === 'ellipse' ? (
            <>
              <Stroke d={ellipsePath(0)} />
              {fpx > 0 ? <Stroke d={ellipsePath(fpx / 2)} dashed /> : null}
            </>
          ) : m.shape === 'rect' ? (
            <g transform={`rotate(${f.r} ${f.cx} ${f.cy})`}>
              <Stroke rect={{ x: f.cx - f.w / 2, y: f.cy - f.h / 2, w: f.w, h: f.h, r: Math.min((m.radius / 100) * Math.min(box.w, box.h), f.w / 2, f.h / 2) }} />
              {fpx > 0 ? <Stroke rect={{ x: f.cx - f.w / 2 - fpx / 2, y: f.cy - f.h / 2 - fpx / 2, w: f.w + fpx, h: f.h + fpx, r: 0 }} dashed /> : null}
            </g>
          ) : (
            <g transform={`translate(${f.cx} ${f.cy}) rotate(${f.r}) scale(${Math.max(f.w, 0.01) / 2} ${Math.max(f.h, 0.01) / 2})`}>
              <Stroke d={m.shape === 'star' ? STAR_D : HEART_D} scaled />
            </g>
          )}
          {/* the knobs' stems */}
          {handles.turn && !line ? <Stroke d={`M${at(0, -f.h / 2).x} ${at(0, -f.h / 2).y}L${handles.turn.x} ${handles.turn.y}`} thin /> : null}
          {handles.feather ? (() => {
            const from = line ? at(0, m.shape === 'mirror' ? -f.h / 2 : 0) : at(0, f.h / 2);
            return <Stroke d={`M${from.x} ${from.y}L${handles.feather.at.x} ${handles.feather.at.y}`} thin dashed />;
          })() : null}
          {handles.turn && line ? <Stroke d={`M${f.cx} ${f.cy}L${handles.turn.x} ${handles.turn.y}`} thin /> : null}
        </svg>
        {/* the point a line or a band goes through */}
        {line ? <Dot at={{ x: f.cx, y: f.cy }} size={8} kind="move" label={t('stageMask.move')} cursor="move" /> : null}
        {handles.resize.map((h) => (
          <div
            key={h.id}
            data-mask-kind="resize"
            data-mask-handle={h.id}
            aria-label={t('stageMask.resize')}
            className="pointer-events-auto absolute flex items-center justify-center"
            style={{
              left: h.at.x - 7,
              top: h.at.y - 7,
              width: 14,
              height: 14,
              transform: f.r ? `rotate(${f.r}deg)` : undefined,
              cursor: resizeCursor(HANDLE_ANGLE[h.id] + f.r + frame.r),
            }}
          >
            <span className="block h-[8px] w-[8px] bg-white" style={{ border: `1px solid ${FRAME_BLUE}` }} />
          </div>
        ))}
        {handles.turn ? <Dot at={handles.turn} size={10} kind="turn" label={t('stageMask.turn')} cursor="grab" /> : null}
        {handles.feather ? (
          <Dot at={handles.feather.at} size={10} kind="feather" label={t('stageMask.feather')} cursor={resizeCursor(90 + f.r + frame.r)} filled />
        ) : null}
      </div>
      {hint ? <GestureHint x={hint.x} y={hint.y} text={hint.text} /> : null}
    </div>
  );
}

/** An outline: a dark line under a white one, to show on any picture. */
function Stroke({ d, rect, dashed, thin, scaled }: {
  d?: string;
  rect?: { x: number; y: number; w: number; h: number; r: number };
  dashed?: boolean;
  thin?: boolean;
  /** Drawn in a scaled group: the stroke keeps its width on screen. */
  scaled?: boolean;
}) {
  const common = { fill: 'none', vectorEffect: scaled ? 'non-scaling-stroke' as const : undefined, strokeLinejoin: 'round' as const };
  const shape = (stroke: string, width: number, dash?: string) => (rect
    ? <rect x={rect.x} y={rect.y} width={Math.max(0, rect.w)} height={Math.max(0, rect.h)} rx={rect.r} stroke={stroke} strokeWidth={width} strokeDasharray={dash} {...common} />
    : <path d={d} stroke={stroke} strokeWidth={width} strokeDasharray={dash} {...common} />);
  return (
    <>
      {shape('rgba(0,0,0,.45)', thin ? 2 : 3, dashed ? '4 3' : undefined)}
      {shape(dashed ? 'rgba(255,255,255,.8)' : '#fff', thin ? 1 : 1.5, dashed ? '4 3' : undefined)}
    </>
  );
}

/** A round knob. */
function Dot({ at, size, kind, label, cursor, filled }: { at: P; size: number; kind: 'move' | 'turn' | 'feather'; label: string; cursor: string; filled?: boolean }) {
  return (
    <div
      data-mask-kind={kind}
      aria-label={label}
      title={label}
      className="pointer-events-auto absolute flex items-center justify-center"
      style={{ left: at.x - 8, top: at.y - 8, width: 16, height: 16, cursor }}
    >
      <span
        className="block rounded-full"
        style={{
          width: size,
          height: size,
          background: filled ? FRAME_BLUE : '#fff',
          border: `1.5px solid ${filled ? '#fff' : FRAME_BLUE}`,
          boxShadow: '0 0 0 0.5px rgba(0,0,0,.25), 0 1px 3px rgba(0,0,0,.3)',
        }}
      />
    </div>
  );
}
