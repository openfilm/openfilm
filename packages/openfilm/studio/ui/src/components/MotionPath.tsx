/**
 * The path a clip's position keyframes take it along, drawn on the picture as an animation editor draws a layer's
 * motion path: a line through where its middle is at every frame (the dots closer where it goes slower), a square at
 * each keyframe. A square is picked by a click (⇧: added or taken away), the same keyframes as on the timeline, and
 * dragged to move that keyframe's position on the picture.
 */
import * as React from 'react';
import { valueAt, type Key } from '../../../../src/clip-motion.mjs';

export interface MotionPathKeys {
  clipId: string;
  /** Its position keyframes (translate, px from its own place). */
  keys: readonly Key[];
  /** The seconds of those picked. */
  picked: ReadonlySet<number>;
  fps: number;
  onPick: (t: number, mode: 'set' | 'toggle') => void;
  /** A keyframe's position moved to `v`. */
  onMove: (t: number, v: [number, number]) => void;
}

/** Where its middle is with no keyframes (stage px), and the picture's scale on screen. */
export function MotionPath({ path, center, viewScale }: { path: MotionPathKeys; center: [number, number]; viewScale: number }) {
  const [drag, setDrag] = React.useState<{ t: number; dx: number; dy: number } | null>(null);
  const keys = React.useMemo(() => path.keys.map((k) => (drag && k.t === drag.t
    ? { ...k, v: [(k.v as [number, number])[0] + drag.dx, (k.v as [number, number])[1] + drag.dy] as [number, number] }
    : k)), [path.keys, drag]);
  const at = (v: [number, number]): [number, number] => [(center[0] + v[0]) * viewScale, (center[1] + v[1]) * viewScale];
  /* its middle at every frame from the first keyframe to the last */
  const dots = React.useMemo(() => {
    const out: [number, number][] = [];
    const first = keys[0]?.t ?? 0, last = keys[keys.length - 1]?.t ?? 0;
    const step = 1 / Math.max(1, path.fps);
    for (let t = first; t <= last + step / 2 && out.length < 2000; t += step) out.push(valueAt('translate', keys as Key[], Math.min(t, last)) as [number, number]);
    return out;
  }, [keys, path.fps]);

  const press = (e: React.PointerEvent, k: Key) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    if (e.shiftKey) { path.onPick(k.t, 'toggle'); return; }
    if (!path.picked.has(k.t)) path.onPick(k.t, 'set');
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / viewScale, dy = (ev.clientY - y0) / viewScale;
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
      moved = true;
      setDrag({ t: k.t, dx, dy });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (!moved) return;
      const [x, y] = k.v as [number, number];
      const round = (n: number) => Math.round(n * 100) / 100;
      path.onMove(k.t, [round(x + (ev.clientX - x0) / viewScale), round(y + (ev.clientY - y0) / viewScale)]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const line = dots.map((d) => at(d).map((n) => n.toFixed(1)).join(',')).join(' ');
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute left-0 top-0 z-[6] overflow-visible" width="1" height="1" data-motion-path={path.clipId}>
      <polyline points={line} fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="3" />
      <polyline points={line} fill="none" stroke="var(--tl-accent, #2dd4bf)" strokeWidth="1.25" />
      {dots.map((d, i) => {
        const [x, y] = at(d);
        return <circle key={i} cx={x} cy={y} r="1.6" fill="#fff" stroke="rgba(0,0,0,0.5)" strokeWidth="0.5" />;
      })}
      {keys.map((k) => {
        const [x, y] = at(k.v as [number, number]);
        const picked = path.picked.has(k.t);
        return (
          <rect key={k.t} data-path-key={k.t} x={x - 4.5} y={y - 4.5} width="9" height="9"
            className="pointer-events-auto cursor-move"
            fill={picked ? 'var(--tl-accent, #2dd4bf)' : '#fff'} stroke="rgba(0,0,0,0.7)" strokeWidth="1"
            onPointerDown={(e) => press(e, k)} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} />
        );
      })}
    </svg>
  );
}
