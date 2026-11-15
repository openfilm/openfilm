/**
 * The color wheels: offset, lift, gamma and gain, each a wheel and its master below it. A wheel is laid out as the
 * vectorscope is (red up and a little left, blue right, green down left), so pushing it toward a color moves the
 * picture's colors that way on the scope: its puck is a color difference (Cb, Cr) whose luma is 0, turned into red,
 * green and blue amounts that change no brightness. The master moves all three alike, as brightness.
 */
import * as React from 'react';
import type { Wheel as WheelValue } from '../../../../../plugins/color/engine/grade.mjs';

export type WheelId = 'offset' | 'lift' | 'gamma' | 'gain';

/** How far each wheel's edge is from its middle, in the amount its red, green and blue take. */
const REACH: Record<WheelId, number> = { offset: 0.15, lift: 0.25, gamma: 0.3, gain: 0.35 };
/** The master's range. */
const MASTER: Record<WheelId, [number, number]> = { offset: [-0.5, 0.5], lift: [-0.5, 0.5], gamma: [-1, 1], gain: [0, 2] };
const KR = 0.2126, KB = 0.0722, KG = 0.7152;

/** A wheel's red, green, blue, apart from its master (gain's about 1, the rest about 0). */
const colorOf = (id: WheelId, v: WheelValue): [number, number, number] => (id === 'gain' ? [v.r - 1, v.g - 1, v.b - 1] : [v.r, v.g, v.b]);

/** The puck's place, -1–1 each way (up is +), for a wheel's red, green, blue. */
function puckOf(id: WheelId, v: WheelValue): [number, number] {
  const [r, g, b] = colorOf(id, v);
  const y = KR * r + KG * g + KB * b;
  const cb = (b - y) / 1.8556, cr = (r - y) / 1.5748;
  return [cb / REACH[id], cr / REACH[id]];
}
/** The red, green, blue for a puck's place: a color difference of no luma. */
function fromPuck(id: WheelId, x: number, y: number, v: WheelValue): WheelValue {
  const cb = x * REACH[id], cr = y * REACH[id];
  const r = 1.5748 * cr, b = 1.8556 * cb, g = -(KR * r + KB * b) / KG;
  const base = id === 'gain' ? 1 : 0;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return { y: v.y, r: round(base + r), g: round(base + g), b: round(base + b) };
}

/** Where pure red, yellow, green, cyan, blue and magenta are on the wheel, for its rim. */
const HUES: [string, [number, number, number]][] = [['#ff3b30', [1, 0, 0]], ['#ffd60a', [1, 1, 0]], ['#34c759', [0, 1, 0]], ['#32d4e6', [0, 1, 1]], ['#0a84ff', [0, 0, 1]], ['#ff2fd0', [1, 0, 1]]];
const RIM = (() => {
  const stops = HUES.map(([css, [r, g, b]]) => {
    const y = KR * r + KG * g + KB * b;
    const angle = Math.atan2((r - y) / 1.5748, (b - y) / 1.8556) * 180 / Math.PI;
    /* CSS's conic angle runs clockwise from up */
    return { css, deg: ((90 - angle) % 360 + 360) % 360 };
  }).sort((a, b) => a.deg - b.deg);
  const first = stops[0];
  return `conic-gradient(from 0deg, ${[...stops, { css: first.css, deg: first.deg + 360 }].map((s) => `${s.css} ${s.deg}deg`).join(', ')}, ${first.css} ${first.deg + 360}deg)`;
})();

export function Wheels({ values, labels, onPreview, onCommit, resetLabel }: {
  values: Record<WheelId, WheelValue>;
  labels: Record<WheelId, string>;
  onPreview: (id: WheelId, v: WheelValue) => void;
  onCommit: (id: WheelId, v: WheelValue) => void;
  resetLabel: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-3">
      {(['lift', 'gamma', 'gain', 'offset'] as const).map((id) => (
        <OneWheel key={id} id={id} value={values[id]} label={labels[id]} resetLabel={resetLabel}
          onPreview={(v) => onPreview(id, v)} onCommit={(v) => onCommit(id, v)} />
      ))}
    </div>
  );
}

function OneWheel({ id, value, label, resetLabel, onPreview, onCommit }: {
  id: WheelId; value: WheelValue; label: string; resetLabel: string;
  onPreview: (v: WheelValue) => void; onCommit: (v: WheelValue) => void;
}) {
  const disk = React.useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = React.useState<WheelValue | null>(null);
  const v = drag ?? value;
  const [px, py] = puckOf(id, v);
  const neutral = id === 'gain' ? 1 : 0;
  const changed = v.r !== neutral || v.g !== neutral || v.b !== neutral;
  const masterChanged = v.y !== neutral;
  /** The pointer's place on the disk, -1–1 each way (up is +). */
  const placeOf = (clientX: number, clientY: number): [number, number] => {
    const box = disk.current!.getBoundingClientRect();
    const rad = box.width / 2;
    return [(clientX - box.left - rad) / rad, -(clientY - box.top - rad) / rad];
  };
  const inside = (x: number, y: number): [number, number] => { const d = Math.hypot(x, y); return d > 1 ? [x / d, y / d] : [x, y]; };
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const start = placeOf(e.clientX, e.clientY);
    /* a press on the puck takes it from where it is; anywhere else, the puck jumps there first */
    const onPuck = Math.hypot(start[0] - px, start[1] - py) < 0.15;
    const origin: [number, number] = onPuck ? [px, py] : inside(start[0], start[1]);
    let last = onPuck ? value : fromPuck(id, origin[0], origin[1], value);
    if (!onPuck) { setDrag(last); onPreview(last); }
    const move = (ev: PointerEvent) => {
      const [x, y] = placeOf(ev.clientX, ev.clientY);
      /* with ⇧, a tenth as far */
      const k = ev.shiftKey ? 0.1 : 1;
      const [nx, ny] = inside(origin[0] + (x - start[0]) * k, origin[1] + (y - start[1]) * k);
      last = fromPuck(id, nx, ny, value);
      setDrag(last);
      onPreview(last);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setDrag(null);
      onCommit(last);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  const [lo, hi] = MASTER[id];
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5">
      <div className="flex w-full items-center justify-between">
        <span className="text-[11px] font-medium text-[var(--text-muted)]">{label}</span>
        <button type="button" disabled={!changed && !masterChanged} onClick={() => onCommit({ y: neutral, r: neutral, g: neutral, b: neutral })}
          className="rounded px-1 text-[10px] text-[var(--text-faint)] hover:text-[var(--text)] disabled:invisible">{resetLabel}</button>
      </div>
      <div ref={disk} role="slider" aria-label={label} aria-valuetext={`${v.r.toFixed(3)} ${v.g.toFixed(3)} ${v.b.toFixed(3)}`} tabIndex={0}
        onPointerDown={down}
        onDoubleClick={() => onCommit({ ...value, r: neutral, g: neutral, b: neutral })}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.01 : 0.05;
          const moves: Record<string, [number, number]> = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
          const m = moves[e.key];
          if (!m) return;
          e.preventDefault();
          onCommit(fromPuck(id, px + m[0], py + m[1], value));
        }}
        className="relative aspect-square w-full max-w-[150px] cursor-crosshair touch-none rounded-full outline-none ring-1 ring-[var(--border)] focus-visible:ring-[var(--accent)]"
        style={{ background: `radial-gradient(circle, #2a2a2a 0%, rgba(42,42,42,0.9) 38%, rgba(42,42,42,0) 72%), ${RIM}` }}>
        <div className="pointer-events-none absolute inset-[18%] rounded-full border border-white/10" />
        <div className="pointer-events-none absolute left-1/2 top-[8%] h-[84%] w-px -translate-x-1/2 bg-white/10" />
        <div className="pointer-events-none absolute left-[8%] top-1/2 h-px w-[84%] -translate-y-1/2 bg-white/10" />
        <div className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/40 shadow"
          style={{ left: `${50 + px * 50}%`, top: `${50 - py * 50}%` }} />
      </div>
      <Master value={v.y} lo={lo} hi={hi} neutral={neutral} label={label}
        onPreview={(y) => { const n = { ...v, y }; setDrag(n); onPreview(n); }}
        onCommit={(y) => { setDrag(null); onCommit({ ...value, y }); }} />
      <div className="flex w-full justify-between font-mono text-[9.5px] tabular-nums text-[var(--text-faint)]">
        <span className="text-[#ff6b61]">{v.r.toFixed(2)}</span><span className="text-[#5fd97a]">{v.g.toFixed(2)}</span><span className="text-[#5aa8ff]">{v.b.toFixed(2)}</span>
        <span className="text-[var(--text-muted)]">{v.y.toFixed(2)}</span>
      </div>
    </div>
  );
}

/** A wheel's master: a thin bar dragged sideways, double-click back to neutral. */
function Master({ value, lo, hi, neutral, label, onPreview, onCommit }: {
  value: number; lo: number; hi: number; neutral: number; label: string;
  onPreview: (v: number) => void; onCommit: (v: number) => void;
}) {
  const bar = React.useRef<HTMLDivElement | null>(null);
  const pct = (n: number) => ((n - lo) / (hi - lo)) * 100;
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const box = bar.current!.getBoundingClientRect();
    const x0 = e.clientX, v0 = value;
    let last = value;
    const move = (ev: PointerEvent) => {
      const k = ev.shiftKey ? 0.1 : 1;
      last = Math.round(Math.min(hi, Math.max(lo, v0 + ((ev.clientX - x0) / box.width) * (hi - lo) * k)) * 1000) / 1000;
      onPreview(last);
    };
    const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); onCommit(last); };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };
  return (
    <div ref={bar} role="slider" aria-label={`${label} master`} aria-valuemin={lo} aria-valuemax={hi} aria-valuenow={value} tabIndex={0}
      onPointerDown={down} onDoubleClick={() => onCommit(neutral)}
      onKeyDown={(e) => {
        const step = (hi - lo) / (e.shiftKey ? 400 : 80);
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); onCommit(Math.round(Math.min(hi, Math.max(lo, value + (e.key === 'ArrowLeft' ? -step : step))) * 1000) / 1000); }
      }}
      className="relative h-4 w-full max-w-[150px] cursor-ew-resize touch-none outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]">
      <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--border-strong)]" />
      <div className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--text-muted)]"
        style={{ left: `${Math.min(pct(neutral), pct(value))}%`, width: `${Math.abs(pct(value) - pct(neutral))}%` }} />
      <div className="absolute top-1/2 h-[9px] w-px -translate-y-1/2 bg-[var(--text-faint)]" style={{ left: `${pct(neutral)}%` }} />
      <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--bg-panel)] shadow-[0_0_0_1px_var(--border-strong),0_1px_3px_rgba(0,0,0,0.25)]"
        style={{ left: `${pct(value)}%` }} />
    </div>
  );
}
