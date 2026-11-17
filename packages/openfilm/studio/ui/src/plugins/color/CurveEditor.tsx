/**
 * A curve of a layer, edited by its points: the RGB curves (all three, red, green, blue: output against input, both in
 * ACEScct) and the hue curves (hue against hue, saturation against hue, luma against hue, saturation against luma and
 * against saturation). It is drawn as OpenColorIO fits and applies it (src/color/bspline), so what is seen is what plays.
 *
 * A click on the curve's box adds a point there; a point is dragged, and taken out by a double-click or dragged off
 * the box. Curves that bend a value round its own (hue, saturation, luma gains) are drawn flat at "as it is", up and down
 * from it: a colorist's hue curves.
 */
import * as React from 'react';
import { evalCurve, fitCurve, HUE_CURVE_SPLINE } from '../../../../../src/color/bspline.mjs';
import type { HueCurve, Points, RgbCurve } from '../../../../../src/color/adjust.mjs';

export type CurveKind = RgbCurve | HueCurve;

/** How a curve is shown: a line from corner to corner (output against input), or flat at as-it-is with a range. */
const SHOWN: Record<CurveKind, { flat: false } | { flat: true; mid: number; span: number }> = {
  master: { flat: false }, red: { flat: false }, green: { flat: false }, blue: { flat: false }, satSat: { flat: false },
  /* hue against hue: how far the hue turns, half a turn either way */
  hueHue: { flat: true, mid: 0, span: 0.5 },
  hueSat: { flat: true, mid: 1, span: 1 }, hueLum: { flat: true, mid: 1, span: 1 }, lumSat: { flat: true, mid: 1, span: 1 },
};
/** The line's color for each: the channel's, or the text's. */
const STROKE: Partial<Record<CurveKind, string>> = { red: '#ff6b5e', green: '#4fd47a', blue: '#5b8cff' };
/** Hue round from magenta, as OpenColorIO's hue curves count it: what the strip under a hue curve shows. */
const HUE_STRIP = 'linear-gradient(90deg, #ff00ff 0%, #ff0000 16.7%, #ffff00 33.3%, #00ff00 50%, #00ffff 66.7%, #0000ff 83.3%, #ff00ff 100%)';

const typeOf = (k: CurveKind) => (k === 'master' || k === 'red' || k === 'green' || k === 'blue' ? 'rgb' : HUE_CURVE_SPLINE[k]);

export function CurveEditor({ kind, points, onPreview, onCommit, histogram }: {
  kind: CurveKind;
  points: Points;
  onPreview: (points: Points) => void;
  onCommit: (points: Points) => void;
  /** luma of the picture as graded, 256 bins: drawn behind an RGB curve */
  histogram?: readonly number[] | null;
}) {
  const shown = SHOWN[kind];
  const box = React.useRef<HTMLDivElement | null>(null);
  const canvas = React.useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = React.useState(0);
  const [live, setLive] = React.useState<Points | null>(null);
  const [hot, setHot] = React.useState<number | null>(null);
  const pts = live ?? points;
  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const h = shown.flat ? Math.round(size * 0.62) : size;

  /* a point's place in the box, and back: y up; a flat curve's value against its middle */
  const toBox = React.useCallback(([x, y]: [number, number]): [number, number] => {
    const v = shown.flat ? (kind === 'hueHue' ? y - x : y) : y;
    const yy = shown.flat ? 0.5 - (v - shown.mid) / (2 * shown.span) : 1 - v;
    return [x * size, yy * h];
  }, [shown, kind, size, h]);
  const fromBox = React.useCallback((px: number, py: number): [number, number] => {
    const x = Math.min(1, Math.max(0, px / size));
    const t = py / h;
    if (!shown.flat) return [x, Math.min(1, Math.max(0, 1 - t))];
    const v = shown.mid + (0.5 - t) * 2 * shown.span;
    const clamped = Math.min(shown.mid + shown.span, Math.max(shown.mid - shown.span, v));
    return [x, kind === 'hueHue' ? x + clamped : Math.max(0, clamped)];
  }, [shown, kind, size, h]);

  React.useEffect(() => {
    const c = canvas.current;
    if (!c || !size) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, h);
    /* the picture's luma behind an RGB curve, faint */
    if (histogram && !shown.flat) {
      let max = 1;
      for (let i = 2; i < 254; i++) max = Math.max(max, histogram[i]!);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.beginPath(); g.moveTo(0, h);
      for (let i = 0; i < 256; i++) g.lineTo((size * i) / 255, h - h * Math.min(1, Math.sqrt(histogram[i]! / max)));
      g.lineTo(size, h); g.closePath(); g.fill();
    }
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
    for (const k of [0.25, 0.5, 0.75]) {
      g.beginPath(); g.moveTo(Math.round(size * k) + 0.5, 0); g.lineTo(Math.round(size * k) + 0.5, h); g.stroke();
      g.beginPath(); g.moveTo(0, Math.round(h * k) + 0.5); g.lineTo(size, Math.round(h * k) + 0.5); g.stroke();
    }
    /* as it is: the diagonal, or the middle */
    g.strokeStyle = 'rgba(255,255,255,0.16)'; g.setLineDash([3, 3]);
    g.beginPath();
    if (shown.flat) { g.moveTo(0, h / 2); g.lineTo(size, h / 2); } else { g.moveTo(0, h); g.lineTo(size, 0); }
    g.stroke(); g.setLineDash([]);
    /* the curve, as it is fitted and applied */
    const type = typeOf(kind);
    const fit = fitCurve({ points: pts.map(([x, y]) => [Math.fround(x), Math.fround(y)]), slopes: pts.map(() => 0) }, type);
    g.strokeStyle = STROKE[kind] ?? 'rgba(255,255,255,0.9)'; g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i <= 160; i++) {
      const x = i / 160;
      const identity = kind === 'hueHue' || !shown.flat ? x : shown.mid;
      const y = evalCurve(fit, x, identity);
      const [bx, by] = toBox([x, y]);
      if (i) g.lineTo(bx, by); else g.moveTo(bx, by);
    }
    g.stroke();
  }, [pts, kind, size, h, histogram, shown, toBox]);

  const drag = React.useRef<{ i: number; pts: Points } | null>(null);
  const near = (px: number, py: number) => pts.findIndex((p) => { const [bx, by] = toBox(p); return Math.hypot(bx - px, by - py) < 8; });
  const local = (e: React.PointerEvent) => { const r = box.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  const sorted = (list: Points) => [...list].sort((a, b) => a[0] - b[0]);
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const [px, py] = local(e);
    let i = near(px, py);
    let list = pts.map((p) => [...p] as [number, number]);
    if (i < 0) {
      list = sorted([...list, fromBox(px, py)]);
      i = list.findIndex((p) => p[0] === fromBox(px, py)[0]);
    }
    drag.current = { i, pts: list };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setLive(list); onPreview(list);
  };
  const move = (e: React.PointerEvent) => {
    const [px, py] = local(e);
    const d = drag.current;
    if (!d) { setHot(near(px, py)); return; }
    const list = d.pts.map((p) => [...p] as [number, number]);
    /* off the box (and not an end of an RGB curve): it goes */
    const end = !shown.flat && (d.i === 0 || d.i === list.length - 1);
    if (!end && list.length > 2 && (py < -24 || py > h + 24)) {
      const left = list.filter((_, k) => k !== d.i);
      setLive(left); onPreview(left);
      return;
    }
    let [x, y] = fromBox(px, py);
    /* between its neighbours, so the curve stays a function; an RGB curve's ends keep their x */
    const lo = d.i > 0 ? list[d.i - 1]![0] + 0.01 : 0, hi = d.i < list.length - 1 ? list[d.i + 1]![0] - 0.01 : 1;
    x = end ? list[d.i]![0] : Math.min(hi, Math.max(lo, x));
    if (kind === 'hueHue') y = x + (y - fromBox(px, py)[0]);
    list[d.i] = [round(x), round(y)];
    setLive(list); onPreview(list);
  };
  const up = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    const done = live ?? pts;
    setLive(null);
    onCommit(done);
  };
  const dbl = (e: React.MouseEvent) => {
    const r = box.current!.getBoundingClientRect();
    const i = near(e.clientX - r.left, e.clientY - r.top);
    const end = !shown.flat && (i === 0 || i === pts.length - 1);
    if (i >= 0 && !end && pts.length > 2) onCommit(pts.filter((_, k) => k !== i));
  };

  return (
    <div className="flex flex-col gap-1">
      <div ref={box} className="relative w-full cursor-crosshair touch-none select-none overflow-visible rounded-[6px] bg-black/40" style={{ height: h || undefined, aspectRatio: h ? undefined : shown.flat ? '1 / 0.62' : '1 / 1' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => setHot(null)} onDoubleClick={dbl}>
        <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
        {pts.map((p, i) => {
          const [bx, by] = toBox(p);
          return <span key={i} className={`pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border ${hot === i || drag.current?.i === i ? 'border-white bg-white' : 'border-white/80 bg-black'}`} style={{ left: bx, top: by }} />;
        })}
      </div>
      {kind.startsWith('hue') ? <div className="h-1.5 rounded-full opacity-70" style={{ background: HUE_STRIP }} /> : null}
    </div>
  );
}

const round = (n: number) => Math.round(n * 10000) / 10000;
