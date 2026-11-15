/**
 * The picture being graded, as large as its block lets it be: graded, or the footage as recorded beside it (a wipe
 * dragged across, or the whole of either), and a window's matte when one is checked. The pointer reads the color under
 * it (code values and IRE); with a picker on, a click takes a patch of it (a grey for the white balance, a color for a
 * window).
 */
import * as React from 'react';
import type { Shot } from './use-grader';

export type Compare = 'graded' | 'wipe' | 'original';
export type Tool = 'none' | 'white' | 'window';

export function Viewer({ shot, compare, wipe, onWipe, tool, onPick, loading, words }: {
  shot: Shot | null;
  compare: Compare;
  wipe: number;
  onWipe: (at: number) => void;
  tool: Tool;
  /** a click with a picker on: where, in the frame's pixels */
  onPick: (x: number, y: number) => void;
  loading: boolean;
  words: { original: string; graded: string; pickWhite: string; pickWindow: string; none: string };
}) {
  const wrap = React.useRef<HTMLDivElement | null>(null);
  const canvas = React.useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  const [readout, setReadout] = React.useState<{ x: number; y: number; text: string } | null>(null);
  const graded = React.useRef<HTMLCanvasElement | null>(null);
  const original = React.useRef<HTMLCanvasElement | null>(null);

  React.useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  /* the picture's place in the block: as large as fits, its shape kept */
  const fit = React.useMemo(() => {
    if (!shot || !size.w || !size.h) return null;
    const k = Math.min(size.w / shot.w, size.h / shot.h);
    const w = Math.round(shot.w * k), h = Math.round(shot.h * k);
    return { w, h, x: Math.round((size.w - w) / 2), y: Math.round((size.h - h) / 2) };
  }, [shot, size]);

  React.useEffect(() => {
    if (!shot) return;
    const put = (ref: React.MutableRefObject<HTMLCanvasElement | null>, image: ImageData | null) => {
      if (!image) return;
      const c = ref.current ?? document.createElement('canvas');
      ref.current = c;
      if (c.width !== image.width || c.height !== image.height) { c.width = image.width; c.height = image.height; }
      c.getContext('2d')!.putImageData(image, 0, 0);
    };
    put(graded, shot.graded);
    put(original, shot.original);
  }, [shot]);

  React.useEffect(() => {
    const c = canvas.current;
    if (!c || !fit || !shot) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(fit.w * dpr); c.height = Math.round(fit.h * dpr);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    const g = graded.current, o = original.current ?? g;
    if (!g || !o) return;
    if (compare === 'original') ctx.drawImage(o, 0, 0, c.width, c.height);
    else if (compare === 'graded') ctx.drawImage(g, 0, 0, c.width, c.height);
    else {
      const cut = Math.round(c.width * wipe);
      const sw = Math.round(shot.w * wipe);
      if (sw > 0) ctx.drawImage(o, 0, 0, sw, shot.h, 0, 0, cut, c.height);
      if (sw < shot.w) ctx.drawImage(g, sw, 0, shot.w - sw, shot.h, cut, 0, c.width - cut, c.height);
    }
  }, [shot, fit, compare, wipe]);

  const frameAt = (e: React.PointerEvent) => {
    if (!fit || !shot) return null;
    const r = canvas.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * shot.w, y = ((e.clientY - r.top) / r.height) * shot.h;
    if (x < 0 || y < 0 || x >= shot.w || y >= shot.h) return null;
    return { x, y };
  };
  const read = (e: React.PointerEvent) => {
    const at = frameAt(e);
    if (!at || !shot) { setReadout(null); return; }
    const showOriginal = compare === 'original' || (compare === 'wipe' && at.x / shot.w < wipe);
    const img = showOriginal ? shot.original ?? shot.graded : shot.graded;
    const i = (Math.floor(at.y) * shot.w + Math.floor(at.x)) * 4;
    const [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
    const ire = Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b) / 2.55);
    const ten = (v: number) => Math.round((v / 255) * 1023);
    setReadout({ x: e.clientX - wrap.current!.getBoundingClientRect().left, y: e.clientY - wrap.current!.getBoundingClientRect().top, text: `R ${ten(r)}  G ${ten(g)}  B ${ten(b)}  ·  ${ire} IRE` });
  };

  const dragWipe = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = canvas.current!.getBoundingClientRect();
      onWipe(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)));
    };
    const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  return (
    <div ref={wrap} className="relative h-full min-h-0 w-full overflow-hidden bg-[var(--bg-viewer)]"
      onPointerMove={read} onPointerLeave={() => setReadout(null)}>
      {fit ? (
        <canvas ref={canvas} className={`absolute ${tool !== 'none' ? 'cursor-crosshair' : ''}`}
          style={{ left: fit.x, top: fit.y, width: fit.w, height: fit.h }}
          onClick={(e) => { if (tool === 'none') return; const at = frameAt(e as unknown as React.PointerEvent); if (at) onPick(at.x, at.y); }} />
      ) : null}
      {fit && compare === 'wipe' ? (
        <>
          <div className="pointer-events-none absolute top-0 h-full w-px bg-white/70 shadow-[0_0_0_1px_rgba(0,0,0,0.3)]" style={{ left: fit.x + fit.w * wipe }} />
          <div role="slider" aria-label={words.original} aria-valuenow={Math.round(wipe * 100)} tabIndex={0}
            onPointerDown={dragWipe}
            onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); onWipe(Math.min(1, Math.max(0, wipe + (e.key === 'ArrowLeft' ? -0.05 : 0.05)))); } }}
            className="absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full bg-white/90 text-[11px] text-black shadow"
            style={{ left: fit.x + fit.w * wipe, top: fit.y + fit.h / 2 }}>⇔</div>
          <span className="pointer-events-none absolute rounded bg-black/55 px-1.5 py-0.5 text-[10.5px] text-white/85" style={{ left: fit.x + 8, top: fit.y + 8 }}>{words.original}</span>
          <span className="pointer-events-none absolute rounded bg-black/55 px-1.5 py-0.5 text-[10.5px] text-white/85" style={{ left: fit.x + fit.w - 8, top: fit.y + 8, transform: 'translateX(-100%)' }}>{words.graded}</span>
        </>
      ) : null}
      {tool !== 'none' && fit ? (
        <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-[11px] text-white" style={{ top: fit.y + 10 }}>
          {tool === 'white' ? words.pickWhite : words.pickWindow}
        </span>
      ) : null}
      {readout ? (
        <span className="pointer-events-none absolute whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white/85"
          style={{ left: Math.min(readout.x + 14, size.w - 210), top: Math.min(readout.y + 14, size.h - 24) }}>{readout.text}</span>
      ) : null}
      {!shot && !loading ? <div className="absolute inset-0 flex items-center justify-center text-[12px] text-[var(--text-faint)]">{words.none}</div> : null}
      {loading ? <div className="pointer-events-none absolute right-3 top-3 h-2 w-2 animate-pulse rounded-full bg-white/60" /> : null}
    </div>
  );
}
