/**
 * The picked clip's moving properties as rows under its track, as an animation editor lays out a layer's properties:
 * each row's keyframes at their times, drawn by how they go in and out (a diamond linear, an hourglass eased, a
 * square held, half of each where it has no neighbour). A keyframe is picked by a click (⇧: added or taken away) and
 * dragged in time with the others picked; a row's name picks all of its keyframes; its navigator goes to the keyframe
 * before or after the playhead, and its middle sets one there or takes it away.
 *
 * The graph (its button by the first row's name, or ⇧F3) draws them instead as each property's value over time, each
 * fitted to the graph's height (a position as its X and its Y): a keyframe dragged there moves in time and value, and
 * the picked ones show the handles of the curves into and out of them, dragged to shape how each segment eases.
 */
import * as React from 'react';
import { ChevronLeft, ChevronRight, ChartSpline } from 'lucide-react';
import { valueAt, type Key, type KeyedProp, type MotionValue } from '../../../../src/clip-motion.mjs';
import { bezierOf, easeOfBezier, keyId, sidesOf, type Bezier, type Side } from '@/lib/motion-keys';

/** A row's height, and the room kept above the first. */
export const LANE_H = 18;
export const LANE_PAD = 4;
/** The graph's least height. */
const GRAPH_H = 150;

export interface MotionLanes {
  clipId: string;
  /** Where the clip starts and ends on the film, ms. */
  startMs: number;
  endMs: number;
  rows: { prop: KeyedProp; label: string; keys: readonly Key[] }[];
  /** The keyframes picked (lib/motion-keys keyId). */
  picked: ReadonlySet<string>;
  playheadMs: number;
  frameMs: number;
  onPick: (ids: string[], mode: 'set' | 'add' | 'toggle') => void;
  /** The picked keyframes moved in time, s. */
  onMove: (dt: number) => void;
  onToggleHere: (prop: KeyedProp) => void;
  onSeek: (ms: number) => void;
  onMenu: (e: React.MouseEvent, id: string) => void;
  /** The graph shown in place of the rows. */
  graph: boolean;
  onGraph: () => void;
  /** A segment's curve (the one from the keyframe at `t`) shaped. */
  onCurve: (prop: KeyedProp, t: number, curve: Bezier) => void;
  /** A keyframe dragged on the graph: its time and value. */
  onKeyEdit: (prop: KeyedProp, t: number, to: { t: number; v: MotionValue }) => void;
  labels: { prev: string; next: string; add: string; remove: string; graph: string };
}

/** How tall the rows (or the graph) are under the clip's own row. */
export const lanesHeight = (lanes: MotionLanes) => (lanes.graph ? Math.max(GRAPH_H, lanes.rows.length * LANE_H) : lanes.rows.length * LANE_H) + LANE_PAD;

const near = (a: number, b: number, frame: number) => Math.abs(a - b) < frame / 2;

/** One keyframe's mark: its left half how it comes in, its right half how it goes out. */
export function KeyMark({ into, out, picked }: { into: Side | null; out: Side | null; picked: boolean }) {
  const half = (side: Side | null, left: boolean) => {
    const fill = side ? (picked ? 'var(--tl-accent)' : '#e2e2e2') : (picked ? 'var(--tl-accent)' : '#8a8a8a');
    const d = side === 'ease'
      ? (left ? 'M6 1 H2.5 Q5 6 2.5 11 H6 Z' : 'M6 1 H9.5 Q7 6 9.5 11 H6 Z')
      : side === 'hold'
        ? (left ? 'M6 1.5 H2 V10.5 H6 Z' : 'M6 1.5 H10 V10.5 H6 Z')
        : (left ? 'M6 1 L1 6 L6 11 Z' : 'M6 1 L11 6 L6 11 Z');
    return <path d={d} fill={fill} stroke="rgba(0,0,0,0.55)" strokeWidth="0.6" />;
  };
  return (
    <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true" style={{ overflow: 'visible' }}>
      {half(into, true)}
      {half(out, false)}
      {picked ? <path d="M6 -1 L13 6 L6 13 L-1 6 Z" fill="none" stroke="var(--tl-accent)" strokeWidth="1" opacity="0.7" /> : null}
    </svg>
  );
}

/** The rows in the timeline, under the clip's own row (`top`: where they start in it). */
export function MotionLaneRows({ lanes, top, pxPerMs }: { lanes: MotionLanes; top: number; pxPerMs: number }) {
  if (lanes.graph) return <MotionGraph lanes={lanes} top={top} pxPerMs={pxPerMs} />;
  return <MotionLaneList lanes={lanes} top={top} pxPerMs={pxPerMs} />;
}

function MotionLaneList({ lanes, top, pxPerMs }: { lanes: MotionLanes; top: number; pxPerMs: number }) {
  const [drag, setDrag] = React.useState<{ dx: number } | null>(null);
  // Pointer-down can select a key or layer before pointer-up commits the move.
  const moveKeys = React.useRef(lanes.onMove);
  moveKeys.current = lanes.onMove;
  const left = lanes.startMs * pxPerMs;
  const width = Math.max(2, (lanes.endMs - lanes.startMs) * pxPerMs);
  /* a frame's worth of px: a drag moves keyframes a whole number of frames */
  const framePx = lanes.frameMs * pxPerMs;
  const dragDt = drag ? (Math.round(drag.dx / Math.max(0.0001, framePx)) * lanes.frameMs) / 1000 : 0;

  const startKey = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const already = lanes.picked.has(id);
    if (e.shiftKey) { lanes.onPick([id], 'toggle'); return; }
    /* a click on a picked keyframe keeps the others picked, so they move together */
    if (!already) lanes.onPick([id], 'set');
    const x0 = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      setDrag({ dx });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (!moved) return;
      const dt = (Math.round((ev.clientX - x0) / Math.max(0.0001, framePx)) * lanes.frameMs) / 1000;
      if (dt) moveKeys.current(dt);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="absolute inset-x-0" style={{ top: top + LANE_PAD / 2 }}
      /* empty time in the rows: nothing picked (the clip stays picked, the playhead stays) */
      onPointerDown={(e) => { e.stopPropagation(); if (e.button === 0 && !e.shiftKey) lanes.onPick([], 'set'); }}>
      {lanes.rows.map((row) => {
        const sides = sidesOf(row.keys);
        return (
          <div key={row.prop} className="relative" style={{ height: LANE_H }} data-motion-lane={row.prop}>
            {/* the clip's stretch, where its keyframes can be */}
            <div className="absolute rounded-[2px]" style={{ left, width, top: 2, bottom: 2, background: 'rgba(255,255,255,0.05)', boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.06)' }} />
            {row.keys.map((k, i) => {
              const id = keyId(row.prop, k.t);
              const picked = lanes.picked.has(id);
              const x = left + (k.t * 1000 + (picked ? dragDt * 1000 : 0)) * pxPerMs;
              return (
                <span key={id} role="presentation" data-keyframe={id}
                  title={`${row.label} · ${(k.t).toFixed(2)}s`}
                  className="absolute top-1/2 z-[2] grid h-[16px] w-[16px] -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center"
                  style={{ left: x }}
                  onPointerDown={(e) => startKey(e, id)}
                  onDoubleClick={(e) => { e.stopPropagation(); lanes.onSeek(lanes.startMs + k.t * 1000); }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!picked) lanes.onPick([id], 'set'); lanes.onMenu(e, id); }}>
                  <KeyMark into={sides[i]!.in} out={sides[i]!.out} picked={picked} />
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** The rows' names in the head column, each with its navigator; a name picks its row's keyframes. */
export function MotionLaneHeads({ lanes }: { lanes: MotionLanes }) {
  const local = (lanes.playheadMs - lanes.startMs) / 1000;
  const frame = lanes.frameMs / 1000;
  const inClip = lanes.playheadMs >= lanes.startMs && lanes.playheadMs <= lanes.endMs;
  return (
    <div style={{ paddingTop: LANE_PAD / 2, paddingBottom: LANE_PAD / 2 }}>
      {lanes.rows.map((row, ri) => {
        const here = inClip && row.keys.some((k) => near(k.t, local, frame));
        const prev = [...row.keys].reverse().find((k) => k.t < local - frame / 2);
        const next = row.keys.find((k) => k.t > local + frame / 2);
        return (
          <div key={row.prop} className="flex items-center gap-[1px] pl-1.5 pr-0.5" style={{ height: LANE_H }}>
            {ri === 0 ? (
              <HeadButton label={lanes.labels.graph} on={lanes.graph} onClick={lanes.onGraph}><ChartSpline size={10} /></HeadButton>
            ) : <span className="w-[12px] shrink-0" />}
            <button type="button" className={`flex min-w-0 flex-1 items-center gap-1 truncate text-left text-[10.5px] hover:text-[var(--text)] ${row.keys.length ? 'text-[var(--text-muted)]' : 'text-[var(--text-faint)]'}`}
              onClick={() => lanes.onPick(row.keys.map((k) => keyId(row.prop, k.t)), 'set')}>
              {lanes.graph && row.keys.length ? (row.prop === 'translate'
                ? <><span className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: CURVE.x }} /><span className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: CURVE.y }} /></>
                : <span className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: curveOf(row.prop) }} />) : null}
              <span className="truncate">{row.label}</span>
            </button>
            <HeadButton label={lanes.labels.prev} disabled={!prev} onClick={() => prev && lanes.onSeek(lanes.startMs + prev.t * 1000)}><ChevronLeft size={10} /></HeadButton>
            <HeadButton label={here ? lanes.labels.remove : lanes.labels.add} disabled={!inClip} onClick={() => lanes.onToggleHere(row.prop)}>
              <svg width="8" height="8" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M6 1 11 6 6 11 1 6Z" fill={here ? 'var(--tl-accent)' : 'none'} stroke={here ? 'var(--tl-accent)' : 'currentColor'} strokeWidth="1.5" />
              </svg>
            </HeadButton>
            <HeadButton label={lanes.labels.next} disabled={!next} onClick={() => next && lanes.onSeek(lanes.startMs + next.t * 1000)}><ChevronRight size={10} /></HeadButton>
          </div>
        );
      })}
    </div>
  );
}

function HeadButton({ label, disabled, on, onClick, children }: { label: string; disabled?: boolean; on?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} aria-pressed={on}
      style={on ? { color: 'var(--tl-accent)' } : undefined}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="grid h-[14px] w-[12px] shrink-0 place-items-center rounded-[2px] text-[var(--text-faint)] hover:bg-white/10 hover:text-[var(--text)] disabled:opacity-30">
      {children}
    </button>
  );
}

/** Each curve's colour: a position's X and Y, and the other properties. */
const CURVE: Record<string, string> = { x: '#ff6b6b', y: '#5fd38d', translate: '#ff6b6b', scale: '#f5c451', rotate: '#6aa8ff', opacity: '#d9d9d9' };
/** An effect's curve (blur, brightness…). */
const EFFECT_CURVE = '#c58af0';
const curveOf = (prop: string) => CURVE[prop] ?? EFFECT_CURVE;
const GRAPH_PAD = 12;
/** Points along each segment, to draw its curve. */
const STEPS = 24;

type Curve = { prop: KeyedProp; dim: 0 | 1 | null; keys: Key[]; color: string; min: number; max: number };
type GraphDrag =
  | { kind: 'handle'; prop: KeyedProp; seg: number; side: 'out' | 'in'; curve: Bezier }
  | { kind: 'key'; prop: KeyedProp; dim: 0 | 1 | null; index: number; dt: number; dv: number };

const part = (v: MotionValue, dim: 0 | 1 | null) => (dim == null ? (v as number) : (v as [number, number])[dim]);

/** The rows' keyframes as values over time: curves, keyframes on them, the picked ones' handles. */
function MotionGraph({ lanes, top, pxPerMs }: { lanes: MotionLanes; top: number; pxPerMs: number }) {
  const svg = React.useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = React.useState<GraphDrag | null>(null);
  const H = lanesHeight(lanes) - LANE_PAD;
  const left = lanes.startMs * pxPerMs;
  const width = Math.max(2, (lanes.endMs - lanes.startMs) * pxPerMs);
  const frameS = lanes.frameMs / 1000;

  /* the rows' keyframes as they are while dragged */
  const rowKeys = (prop: KeyedProp, keys: readonly Key[]): Key[] => {
    const out = keys.map((k) => ({ ...k }));
    if (drag?.prop !== prop) return out;
    if (drag.kind === 'handle') {
      const k = out[drag.seg];
      if (k) k.ease = easeOfBezier(drag.curve) ?? 'linear';
    } else {
      const k = out[drag.index];
      if (k) {
        k.t = Math.max(0, k.t + drag.dt);
        if (drag.dim == null) k.v = (k.v as number) + drag.dv;
        else { const v = [...(k.v as [number, number])] as [number, number]; v[drag.dim] += drag.dv; k.v = v; }
      }
      out.sort((a, b) => a.t - b.t);
    }
    return out;
  };
  /* each curve fitted to the height by its own least and greatest value: kept still while something is dragged */
  const fit = React.useRef<Map<string, [number, number]>>(new Map());
  const curves: Curve[] = lanes.rows.filter((row) => row.keys.length).flatMap((row) => {
    const keys = rowKeys(row.prop, row.keys);
    /* a pair (a position, a mask's) is two curves, its X and its Y */
    const dims: (0 | 1 | null)[] = Array.isArray(keys[0]?.v) ? [0, 1] : [null];
    return dims.map((dim) => {
      const name = `${row.prop}:${dim}`;
      let range = drag ? fit.current.get(name) : undefined;
      if (!range) {
        const vs: number[] = [];
        for (let i = 0; i < keys.length; i++) {
          vs.push(part(keys[i]!.v, dim));
          const b = keys[i + 1];
          if (b) for (let s = 1; s < STEPS; s++) vs.push(part(valueAt(row.prop, keys, keys[i]!.t + ((b.t - keys[i]!.t) * s) / STEPS), dim));
        }
        let lo = Math.min(...vs), hi = Math.max(...vs);
        if (!(hi - lo > 1e-6)) { lo -= 1; hi += 1; }
        range = [lo, hi];
        fit.current.set(name, range);
      }
      const color = dim === 0 ? CURVE.x! : dim === 1 ? CURVE.y! : curveOf(row.prop);
      return { prop: row.prop, dim, keys, color, min: range[0], max: range[1] };
    });
  });
  const X = (t: number) => left + t * 1000 * pxPerMs;
  const Y = (c: Curve, v: number) => GRAPH_PAD + (1 - (v - c.min) / (c.max - c.min)) * (H - 2 * GRAPH_PAD);
  const fromY = (c: Curve, y: number) => c.min + (1 - (y - GRAPH_PAD) / (H - 2 * GRAPH_PAD)) * (c.max - c.min);
  const local = (e: PointerEvent | React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const follow = (onMove: (ev: PointerEvent) => void, onUp: (ev: PointerEvent) => void) => {
    const move = (ev: PointerEvent) => onMove(ev);
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onUp(ev);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* a keyframe pressed: picked, and dragged in time (whole frames) and value */
  const pressKey = (e: React.PointerEvent, c: Curve, index: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const k = c.keys[index]!;
    const id = keyId(c.prop, k.t);
    if (e.shiftKey) { lanes.onPick([id], 'toggle'); return; }
    if (!lanes.picked.has(id)) lanes.onPick([id], 'set');
    const p0 = local(e);
    let moved = false;
    const at = (ev: PointerEvent) => {
      const p = local(ev);
      const dt = Math.round((p.x - p0.x) / Math.max(0.0001, lanes.frameMs * pxPerMs)) * frameS;
      return { dt: Math.max(-k.t, dt), dv: fromY(c, p.y) - fromY(c, p0.y) };
    };
    follow((ev) => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
      moved = true;
      setDrag({ kind: 'key', prop: c.prop, dim: c.dim, index, ...at(ev) });
    }, (ev) => {
      setDrag(null);
      if (!moved) return;
      const { dt, dv } = at(ev);
      const round = (n: number) => Math.round(n * 10000) / 10000;
      const v: MotionValue = c.dim == null ? round((k.v as number) + dv)
        : (() => { const w = [...(k.v as [number, number])] as [number, number]; w[c.dim] = Math.round((w[c.dim] + dv) * 100) / 100; return w; })();
      lanes.onKeyEdit(c.prop, k.t, { t: Math.round((k.t + dt) * 1000) / 1000, v });
    });
  };
  /* a handle pressed: the curve of its segment shaped (in time, between its keyframes; in value, past them too) */
  const pressHandle = (e: React.PointerEvent, c: Curve, seg: number, side: 'out' | 'in') => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    const a = c.keys[seg]!, b = c.keys[seg + 1]!;
    const va = part(a.v, c.dim), vb = part(b.v, c.dim);
    const start = bezierOf(a.ease) ?? [1 / 3, 1 / 3, 2 / 3, 2 / 3];
    const shaped = (ev: PointerEvent): Bezier => {
      const p = local(ev);
      const x = Math.min(1, Math.max(0, ((p.x - left) / pxPerMs / 1000 - a.t) / (b.t - a.t || 1)));
      const y = (fromY(c, p.y) - va) / (vb - va);
      const r = (n: number) => Math.round(n * 1000) / 1000;
      return side === 'out' ? [r(x), r(y), start[2], start[3]] : [start[0], start[1], r(x), r(y)];
    };
    follow((ev) => setDrag({ kind: 'handle', prop: c.prop, seg, side, curve: shaped(ev) }), (ev) => {
      setDrag(null);
      lanes.onCurve(c.prop, a.t, shaped(ev));
    });
  };

  const path = (c: Curve) => {
    const pts: string[] = [];
    const k = c.keys;
    if (!k.length) return '';
    pts.push(`${X(0).toFixed(1)},${Y(c, part(k[0]!.v, c.dim)).toFixed(1)}`);
    for (let i = 0; i < k.length; i++) {
      pts.push(`${X(k[i]!.t).toFixed(1)},${Y(c, part(k[i]!.v, c.dim)).toFixed(1)}`);
      const b = k[i + 1];
      if (!b) continue;
      for (let s = 1; s < STEPS; s++) {
        const t = k[i]!.t + ((b.t - k[i]!.t) * s) / STEPS;
        pts.push(`${X(t).toFixed(1)},${Y(c, part(valueAt(c.prop, k, t), c.dim)).toFixed(1)}`);
      }
    }
    pts.push(`${X((lanes.endMs - lanes.startMs) / 1000).toFixed(1)},${Y(c, part(k[k.length - 1]!.v, c.dim)).toFixed(1)}`);
    return pts.join(' ');
  };

  return (
    <div className="absolute inset-x-0" style={{ top: top + LANE_PAD / 2, height: H }}
      onPointerDown={(e) => { e.stopPropagation(); if (e.button === 0 && !e.shiftKey) lanes.onPick([], 'set'); }}>
      <svg ref={svg} className="absolute left-0 top-0 overflow-visible" width="100%" height={H} data-motion-graph={lanes.clipId}>
        <rect x={left} y={1} width={width} height={H - 2} rx={2} fill="rgba(255,255,255,0.04)" />
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={left} x2={left + width} y1={H * f} y2={H * f} stroke="rgba(255,255,255,0.05)" />)}
        {curves.map((c) => <polyline key={`${c.prop}:${c.dim}`} points={path(c)} fill="none" stroke={c.color} strokeWidth="1.4" opacity="0.9" />)}
        {curves.map((c) => c.keys.map((k, i) => {
          const picked = lanes.picked.has(keyId(c.prop, k.t)) && !(drag?.kind === 'key' && drag.prop === c.prop);
          const handles: React.ReactNode[] = [];
          /* the handles of a picked keyframe: on the curve of a position's part that moves more there */
          const shows = (seg: number) => {
            if (c.dim == null) return true;
            const a = c.keys[seg], b = c.keys[seg + 1];
            if (!a || !b) return false;
            const d = (dim: 0 | 1) => Math.abs((b.v as [number, number])[dim] - (a.v as [number, number])[dim]);
            return d(c.dim) >= d(c.dim === 0 ? 1 : 0) && d(c.dim) > 1e-6;
          };
          if (picked || (drag?.kind === 'handle' && drag.prop === c.prop && (drag.seg === i || drag.seg === i - 1))) {
            const handle = (seg: number, side: 'out' | 'in') => {
              const a = c.keys[seg], b = c.keys[seg + 1];
              if (!a || !b || a.ease === 'hold' || !shows(seg)) return;
              const va = part(a.v, c.dim), vb = part(b.v, c.dim);
              if (Math.abs(vb - va) < 1e-9) return;
              const bz = bezierOf(a.ease)!;
              const hx = X(a.t + (side === 'out' ? bz[0] : bz[2]) * (b.t - a.t));
              const hy = Y(c, va + (side === 'out' ? bz[1] : bz[3]) * (vb - va));
              const kx = X(side === 'out' ? a.t : b.t), ky = Y(c, side === 'out' ? va : vb);
              handles.push(
                <g key={`${side}${seg}`}>
                  <line x1={kx} y1={ky} x2={hx} y2={hy} stroke="var(--tl-accent)" strokeWidth="1" opacity="0.8" />
                  <circle cx={hx} cy={hy} r="3.5" fill="#1b1b1b" stroke="var(--tl-accent)" strokeWidth="1.4" className="cursor-grab"
                    data-curve-handle={`${c.prop}@${a.t}:${side}`} onPointerDown={(e) => pressHandle(e, c, seg, side)} />
                </g>,
              );
            };
            handle(i, 'out');
            handle(i - 1, 'in');
          }
          return (
            <React.Fragment key={`${c.prop}:${c.dim}:${k.t}`}>
              {handles}
              <rect x={X(k.t) - 3.5} y={Y(c, part(k.v, c.dim)) - 3.5} width="7" height="7" transform={`rotate(45 ${X(k.t)} ${Y(c, part(k.v, c.dim))})`}
                fill={picked ? 'var(--tl-accent)' : c.color} stroke="rgba(0,0,0,0.6)" strokeWidth="1" className="cursor-pointer"
                data-graph-key={`${keyId(c.prop, k.t)}:${c.dim ?? ''}`} onPointerDown={(e) => pressKey(e, c, i)}
                onDoubleClick={(e) => { e.stopPropagation(); lanes.onSeek(lanes.startMs + k.t * 1000); }} />
            </React.Fragment>
          );
        }))}
      </svg>
    </div>
  );
}
