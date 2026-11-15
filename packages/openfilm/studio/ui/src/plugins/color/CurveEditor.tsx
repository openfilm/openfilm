/**
 * A curve, drawn and shaped by hand: a click on the line adds a point there, a point is dragged, a double-click (or a
 * drag far off the box) takes it away. Three kinds:
 *
 *   tone    a picture's levels in to out, both 0–1; its first and last point stay at the left and right edges
 *   hue     a value round the hue circle (x 0–1, joined at red), from `range`, `rest` where there are no points
 *   graph   a value along luminance or saturation (x 0–1), from `range`, `rest` where there are no points
 *
 * Drawn from the engine's own curves (engine/grade.mjs curveOf, hueCurveOf), so what is seen is what the grade does.
 */
import * as React from 'react';
import { curveOf, hueCurveOf, type Points } from '../../../../../plugins/color/engine/grade.mjs';

export type CurveKind = 'tone' | 'hue' | 'graph';

const PAD = 8;
const HIT = 9;
/** How far off the box a point is dragged to be taken away, px. */
const OFF = 36;

export function CurveEditor({ kind, points, color = 'var(--text)', range = [0, 1], rest = 0, height = 180, backdrop, label, onPreview, onCommit, format }: {
  kind: CurveKind;
  points: Points;
  color?: string;
  /** the values the curve's y spans (tone: 0–1) */
  range?: [number, number];
  /** the value with no points (hue, graph) */
  rest?: number;
  height?: number;
  /** drawn behind: a histogram (bins 0–1 each), or a strip of hues */
  backdrop?: { bins?: ArrayLike<number>; hues?: boolean; ramp?: boolean };
  label: string;
  onPreview: (points: Points) => void;
  onCommit: (points: Points) => void;
  /** the readout of a point: its x and y as a person reads them */
  format?: (x: number, y: number) => string;
}) {
  const box = React.useRef<SVGSVGElement | null>(null);
  const [width, setWidth] = React.useState(280);
  const [drag, setDrag] = React.useState<{ points: Points; at: number; gone: boolean } | null>(null);
  const [hover, setHover] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(120, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(120, el.clientWidth));
    return () => ro.disconnect();
  }, []);
  const tone = kind === 'tone';
  const shown: Points = drag ? drag.points.filter((_, i) => !(drag.gone && i === drag.at)) : points;
  const base: Points = tone && shown.length < 2 ? [[0, 0], [1, 1]] : shown;
  const [lo, hi] = range;
  const W = width - PAD * 2, H = height - PAD * 2;
  const sx = (x: number) => PAD + x * W;
  const sy = (y: number) => PAD + (1 - (y - lo) / (hi - lo)) * H;
  const fromX = (px: number) => Math.min(1, Math.max(0, (px - PAD) / W));
  const fromY = (py: number) => Math.min(hi, Math.max(lo, lo + (1 - (py - PAD) / H) * (hi - lo)));
  const f = React.useMemo(() => (kind === 'hue' ? hueCurveOf(base, rest) : kind === 'graph' ? (base.length ? curveOf(base) : () => rest) : curveOf(base)), [kind, base, rest]);
  const path = React.useMemo(() => {
    const steps = 160;
    let d = '';
    for (let i = 0; i <= steps; i++) { const x = i / steps; d += `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(Math.min(hi, Math.max(lo, f(x)))).toFixed(1)}`; }
    return d;
  }, [f, width, height, lo, hi]); // eslint-disable-line react-hooks/exhaustive-deps

  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const nearest = (px: number, py: number) => {
    let best = -1, dist = HIT;
    base.forEach(([x, y], i) => { const d = Math.hypot(sx(x) - px, sy(y) - py); if (d < dist) { dist = d; best = i; } });
    return best;
  };
  const sorted = (p: Points) => [...p].sort((a, b) => a[0] - b[0]) as Points;
  const round = (n: number) => Math.round(n * 1000) / 1000;

  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const [px, py] = local(e);
    let pts: Points = base.map((p) => [p[0], p[1]] as [number, number]);
    let at = nearest(px, py);
    if (e.altKey && at >= 0) { removeAt(at); return; }
    if (at < 0) {
      /* a new point on the line, where the click is along it */
      const x = fromX(px);
      pts = sorted([...pts, [round(x), round(fromY(sy(f(x))))]]);
      at = pts.findIndex((p) => p[0] === round(x));
    }
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const edge = tone && (at === 0 || at === pts.length - 1);
    const x0 = pts[at][0];
    let current = { points: pts, at, gone: false };
    setDrag(current);
    onPreview(pts);
    const move = (ev: PointerEvent) => {
      const [mx, my] = local(ev);
      const outside = !edge && (my < -OFF || my > height + OFF || mx < -OFF || mx > width + OFF);
      const next = current.points.map((p) => [p[0], p[1]] as [number, number]);
      let x = edge ? x0 : fromX(mx);
      /* a point stays between its neighbors, as a curve's points keep their order */
      if (!edge) {
        const left = next[current.at - 1]?.[0] ?? (kind === 'tone' ? 0 : -Infinity), right = next[current.at + 1]?.[0] ?? (kind === 'tone' ? 1 : Infinity);
        x = Math.min(right - 0.005, Math.max(left + 0.005, x));
      }
      next[current.at] = [round(x), round(fromY(my))];
      current = { points: next, at: current.at, gone: outside };
      setDrag(current);
      onPreview(outside ? next.filter((_, i) => i !== current.at) : next);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setDrag(null);
      onCommit(current.gone ? current.points.filter((_, i) => i !== current.at) : current.points);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  const removeAt = (at: number) => {
    if (tone && (at === 0 || at === base.length - 1)) return;
    onCommit(base.filter((_, i) => i !== at));
  };

  const bins = backdrop?.bins;
  const histo = React.useMemo(() => {
    if (!bins || !bins.length) return null;
    let max = 0;
    for (let i = 0; i < bins.length; i++) max = Math.max(max, bins[i]);
    if (!max) return null;
    let d = `M${sx(0)},${sy(lo)}`;
    for (let i = 0; i < bins.length; i++) d += `L${sx(i / (bins.length - 1)).toFixed(1)},${(PAD + H - (Math.sqrt(bins[i] / max) * H * 0.9)).toFixed(1)}`;
    return `${d}L${sx(1)},${sy(lo)}Z`;
  }, [bins, width, height]); // eslint-disable-line react-hooks/exhaustive-deps
  const gradId = React.useId();
  const restY = tone ? null : sy(rest);
  const hovered = hover !== null && base[hover] ? base[hover] : null;
  return (
    <div className="relative">
      <svg ref={box} width="100%" height={height} role="img" aria-label={label}
        className="block cursor-crosshair touch-none select-none rounded-[6px] bg-[#1b1b1b]"
        onPointerDown={down}
        onPointerMove={(e) => { if (!drag) { const [px, py] = local(e); const n = nearest(px, py); setHover(n >= 0 ? n : null); } }}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={(e) => { const [px, py] = local(e); const n = nearest(px, py); if (n >= 0) removeAt(n); }}>
        {backdrop?.hues ? (
          <>
            <defs>
              <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
                {[0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1].map((t) => <stop key={t} offset={t} stopColor={`hsl(${t * 360} 85% 55%)`} />)}
              </linearGradient>
            </defs>
            <rect x={PAD} y={PAD + H - 6} width={W} height={6} fill={`url(#${gradId})`} opacity={0.85} rx={2} />
          </>
        ) : null}
        {backdrop?.ramp ? (
          <>
            <defs>
              <linearGradient id={`${gradId}r`} x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#000" /><stop offset="1" stopColor="#fff" /></linearGradient>
            </defs>
            <rect x={PAD} y={PAD + H - 6} width={W} height={6} fill={`url(#${gradId}r)`} opacity={0.8} rx={2} />
          </>
        ) : null}
        {histo ? <path d={histo} fill="rgba(255,255,255,0.07)" /> : null}
        {[0.25, 0.5, 0.75].map((t) => (
          <g key={t} stroke="rgba(255,255,255,0.07)">
            <line x1={sx(t)} x2={sx(t)} y1={PAD} y2={PAD + H} />
            {tone ? <line x1={PAD} x2={PAD + W} y1={sy(t)} y2={sy(t)} /> : null}
          </g>
        ))}
        <rect x={PAD} y={PAD} width={W} height={H} fill="none" stroke="rgba(255,255,255,0.1)" />
        {tone ? <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke="rgba(255,255,255,0.14)" strokeDasharray="3 3" /> : null}
        {restY !== null ? <line x1={PAD} x2={PAD + W} y1={restY} y2={restY} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" /> : null}
        <path d={path} fill="none" stroke={color} strokeWidth={1.6} />
        {base.map(([x, y], i) => (
          <circle key={i} cx={sx(x)} cy={sy(Math.min(hi, Math.max(lo, y)))} r={hover === i || drag?.at === i ? 4.5 : 3.5}
            fill={drag?.at === i && drag.gone ? 'transparent' : '#1b1b1b'} stroke={color} strokeWidth={1.5} />
        ))}
      </svg>
      {hovered && format ? (
        <span className="pointer-events-none absolute right-2 top-1.5 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white/80">{format(hovered[0], hovered[1])}</span>
      ) : null}
    </div>
  );
}
