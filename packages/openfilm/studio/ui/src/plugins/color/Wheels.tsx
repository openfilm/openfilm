/**
 * A color wheel, as a colorist's: a dark disc in a thin ring of the colors it pushes toward, a puck for which way and
 * how far that part of the picture is pushed, a line under it for how much brighter or darker it is, and its red,
 * green and blue under that. Each zone wheel is one of the layer's `adjust-tone` (src/color/adjust: wheelAt,
 * wheelColor), red toward where the vectorscope has it.
 *
 * Shift moves the puck finely; a double-click puts the color (or, on the line, the brightness) back as it was; the
 * arrow at its corner puts the whole wheel back.
 */
import * as React from 'react';
import { RotateCcw } from 'lucide-react';
import { wheelAt, wheelColor, type Wheel } from '../../../../../src/color/adjust.mjs';

/** Where red is round a wheel, as a vectorscope draws it (radians, counterclockwise from the right). */
const RED_AT = (103 / 180) * Math.PI;
/** How far in from the edge the puck reaches at its most, px: the ring stays clear. */
const INSET = 9;

/** The screen angle of a hue, and back. */
const angleOf = (hue: number) => RED_AT + hue * 2 * Math.PI;
const hueOf = (angle: number) => ((((angle - RED_AT) / (2 * Math.PI)) % 1) + 1) % 1;

/** The color a wheel pushes toward at a hue, full: what its ring shows there. */
function hueColor(hue: number): [number, number, number] {
  const w = wheelAt({ r: 1, g: 1, b: 1, m: 1 }, hue, 1);
  const lo = Math.min(w.r, w.g, w.b), hi = Math.max(w.r, w.g, w.b);
  return [(w.r - lo) / (hi - lo), (w.g - lo) / (hi - lo), (w.b - lo) / (hi - lo)];
}

/** The wheel's face, drawn once for its size: the disc, a faint wash of each hue toward its edge, and the ring. */
function useFace(size: number) {
  return React.useMemo(() => {
    const c = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    c.width = c.height = Math.round(size * dpr);
    const g = c.getContext('2d')!;
    const img = g.createImageData(c.width, c.height);
    const r = c.width / 2;
    const ringIn = 1 - (4.5 * dpr) / r, gap = 1 - (6 * dpr) / r;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const dx = x - r + 0.5, dy = r - y - 0.5, d = Math.hypot(dx, dy) / r;
      if (d > 1) continue;
      const [cr, cg, cb] = hueColor(hueOf(Math.atan2(dy, dx)));
      const i = (y * c.width + x) * 4;
      if (d >= ringIn) {
        /* the ring: the hue itself, a little muted */
        img.data[i] = 70 + cr * 150; img.data[i + 1] = 70 + cg * 150; img.data[i + 2] = 70 + cb * 150;
        img.data[i + 3] = d > 1 - 1.2 / r ? 255 * (1 - d) * r / 1.2 : 255;
      } else if (d >= gap) {
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 16; img.data[i + 3] = 255;
      } else {
        /* the disc: near black, each hue coming in faintly toward the edge */
        const k = 0.1 * d * d;
        img.data[i] = 30 + cr * 255 * k; img.data[i + 1] = 30 + cg * 255 * k; img.data[i + 2] = 31 + cb * 255 * k;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL();
  }, [size]);
}

const signed = (v: number, d = 2) => { const r = Math.round(v * 10 ** d) / 10 ** d; return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(d)}`; };

/**
 * One wheel, `size` px across. `readout` is what its line reads (by default the brightness as -1…1); `detail` what is
 * under its name (by default its red, green and blue against as they were).
 */
export function ColorWheel({ wheel, label, size = 132, readout, detail, onPreview, onCommit, onReset }: {
  wheel: Wheel; label: string; size?: number; readout?: (w: Wheel) => string; detail?: (w: Wheel) => React.ReactNode;
  onPreview: (w: Wheel) => void; onCommit: (w: Wheel) => void; onReset?: () => void;
}) {
  const SIZE = size;
  const face = useFace(size);
  const [live, setLive] = React.useState<Wheel | null>(null);
  const w = live ?? wheel;
  const { hue, far } = wheelColor(w);
  const a = angleOf(hue);
  const reach = SIZE / 2 - INSET;
  const px = SIZE / 2 + Math.cos(a) * far * reach, py = SIZE / 2 - Math.sin(a) * far * reach;
  const drag = React.useRef<{ x: number; y: number; hue: number; far: number } | null>(null);
  const set = (next: Wheel) => { setLive(next); onPreview(next); };
  const commit = () => { if (live) onCommit(live); setLive(null); };

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, hue, far };
    /* a press away from the puck puts it there at once (not at the very middle: a double-click there puts it back) */
    const r = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - r.left - SIZE / 2, dy = SIZE / 2 - (e.clientY - r.top);
    if (Math.hypot(e.clientX - r.left - px, e.clientY - r.top - py) > 8 && Math.hypot(dx, dy) > SIZE * 0.06) {
      const f = Math.min(1, Math.hypot(dx, dy) / reach);
      drag.current = { x: e.clientX, y: e.clientY, hue: hueOf(Math.atan2(dy, dx)), far: f };
      set(wheelAt(w, hueOf(Math.atan2(dy, dx)), f));
    }
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    /* the puck follows the pointer, a fifth as far with Shift */
    const k = e.shiftKey ? 0.2 : 1;
    const a0 = angleOf(d.hue);
    const x = Math.cos(a0) * d.far * reach + (e.clientX - d.x) * k;
    const y = Math.sin(a0) * d.far * reach - (e.clientY - d.y) * k;
    set(wheelAt(w, hueOf(Math.atan2(y, x)), Math.min(1, Math.hypot(x, y) / reach)));
  };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    commit();
  };

  /* the line under the wheel: how much brighter or darker, -1…1 for a gain of 0.01…1.99 */
  const bright = Math.round((w.m - 1) * 100) / 100;
  const line = React.useRef<{ x: number; m: number } | null>(null);
  const lineDown = (e: React.PointerEvent<HTMLDivElement>) => { e.currentTarget.setPointerCapture(e.pointerId); line.current = { x: e.clientX, m: w.m }; };
  const lineMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const l = line.current;
    if (!l) return;
    const m = Math.min(1.99, Math.max(0.01, l.m + ((e.clientX - l.x) / SIZE) * (e.shiftKey ? 0.2 : 1)));
    set({ ...w, m: Math.round(m * 1000) / 1000 });
  };
  const lineUp = (e: React.PointerEvent<HTMLDivElement>) => { if (!line.current) return; line.current = null; e.currentTarget.releasePointerCapture(e.pointerId); commit(); };

  const plain = far < 0.006;
  const mean = (w.r + w.g + w.b) / 3;
  const changed = !plain || Math.abs(w.m - 1) > 0.0005;
  /* the puck in the color it pushes toward, as bright as the ring */
  const [pr, pg, pb] = hueColor(hue);
  const tone = (v: number) => Math.round(255 * (0.45 + 0.55 * (1 - far + far * v)));
  return (
    <div className="group/wheel relative flex min-w-0 flex-col items-center gap-2" style={{ width: SIZE }}>
      <div className="flex w-full items-baseline justify-between text-[11.5px]">
        <span className="text-[var(--text-muted)]">{label}</span>
        {onReset ? (
          <button type="button" aria-label={label} onClick={onReset}
            className={`rounded p-0.5 text-[var(--text-faint)] transition hover:text-[var(--text)] ${changed ? 'opacity-0 group-hover/wheel:opacity-100' : 'pointer-events-none opacity-0'}`}>
            <RotateCcw size={11} />
          </button>
        ) : null}
      </div>
      <div className="relative cursor-crosshair touch-none select-none rounded-full shadow-[0_1px_0_rgba(255,255,255,0.04),0_6px_18px_rgba(0,0,0,0.35)]"
        style={{ width: SIZE, height: SIZE, backgroundImage: `url(${face})`, backgroundSize: 'cover' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onDoubleClick={() => onCommit(wheelAt(w, 0, 0))} title={label}>
        <span className="pointer-events-none absolute left-1/2 top-1/2 h-px w-3 -translate-x-1/2 bg-white/20" />
        <span className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-px -translate-y-1/2 bg-white/20" />
        <span className="pointer-events-none absolute left-1/2 top-1/2 rounded-full border border-white/[0.05]" style={{ width: reach, height: reach, transform: 'translate(-50%,-50%)' }} />
        {!plain ? <svg className="pointer-events-none absolute inset-0" width={SIZE} height={SIZE}><line x1={SIZE / 2} y1={SIZE / 2} x2={px} y2={py} stroke="rgba(255,255,255,0.35)" strokeWidth="1" /></svg> : null}
        <span className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-white shadow-[0_0_0_1px_rgba(0,0,0,0.55),0_1px_4px_rgba(0,0,0,0.6)]"
          style={{ left: px, top: py, background: plain ? 'rgba(20,20,22,0.9)' : `rgb(${tone(pr)},${tone(pg)},${tone(pb)})` }} />
      </div>
      <div className="relative h-4 w-full cursor-ew-resize touch-none select-none" onPointerDown={lineDown} onPointerMove={lineMove} onPointerUp={lineUp} onPointerCancel={lineUp}
        onDoubleClick={() => onCommit({ ...w, m: 1 })}>
        <span className="absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-white/[0.08]" />
        <span className="absolute top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-white/60"
          style={{ left: `${50 + Math.min(0, bright) * 50}%`, width: `${Math.abs(bright) * 50}%` }} />
        <span className="absolute left-1/2 top-1/2 h-2 w-px -translate-y-1/2 bg-white/25" />
        <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.55),0_1px_3px_rgba(0,0,0,0.5)]" style={{ left: `${50 + bright * 50}%` }} />
      </div>
      <div className="flex w-full items-center justify-between font-mono text-[10.5px] tabular-nums leading-none">
        {detail ? detail(w) : (
          <>
            <span className="text-[#ff7a6e]">{signed(w.r - mean)}</span>
            <span className="text-[#62d98a]">{signed(w.g - mean)}</span>
            <span className="text-[#6f9cff]">{signed(w.b - mean)}</span>
          </>
        )}
        <span className="text-[var(--text)]">{readout ? readout(w) : signed(bright)}</span>
      </div>
    </div>
  );
}
