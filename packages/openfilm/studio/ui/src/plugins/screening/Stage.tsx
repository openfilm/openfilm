/**
 * The picture, as large as fits, on black as the edit's: the film played by the page's own player. A click plays or
 * pauses it; a drag circles a part of it to point at (stopped, the pointer is a crosshair for it, and until a box has
 * been drawn once it says so). With nothing to play yet it is black, and out of use.
 * The boxes the message being written points at are drawn at their moment, each with its number and its way to take it
 * out. What is said over the picture (how to circle a part) floats at its top, so the picture keeps its size.
 */
import * as React from 'react';
import { SquareDashed, X } from 'lucide-react';
import { Preview, type FilmInfo, type PreviewHandle } from '@/editor/Preview';
import type { StageBox } from '@/lib/host';
import { REGION_MIN_PX } from '@/lib/studio-refs';
import { useClock, type Mark, type MarkState } from './Scrubber';
import type { Clock } from './screening-model';

export function Stage({ stage, folder, preview, time, onInfo, marks, clock, playing, hint, idle, unread, onFit, onToggle, onDragStart, onBox, onRemove, removeLabel, stateOf, onHoverMark }: {
  stage: { w: number; h: number }; folder: string; preview: React.RefObject<PreviewHandle | null>; time: () => number;
  onInfo: (info: FilmInfo) => void; marks: readonly Mark[]; clock: Clock; playing: boolean;
  /** said over the picture while the pointer is on it, stopped: how to circle a part */
  hint: string | null;
  /** nothing to play yet: the picture black and out of use, as the edit's */
  idle: boolean; unread: string | null;
  /** the picture's width on screen, px, each time it changes */
  onFit: (width: number) => void;
  onToggle: () => void; onDragStart: () => void; onBox: (box: StageBox) => void; onRemove: (mark: Mark) => void; removeLabel: string;
  /** how each box is shown (its pill hovered or pressed in the chat); the pointer over a box here (null: off it) */
  stateOf: (ref: Mark['ref']) => MarkState; onHoverMark: (ref: Mark['ref'] | null) => void;
}) {
  const room = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  React.useLayoutEffect(() => {
    const el = room.current;
    if (!el) return;
    const fit = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const k = Math.max(0, Math.min(size.w / stage.w, size.h / stage.h));
  const box = { w: Math.round(stage.w * k), h: Math.round(stage.h * k) };
  React.useEffect(() => { onFit(box.w); }, [box.w, onFit]);
  const [drag, setDrag] = React.useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [inside, setInside] = React.useState(false);
  const at = (e: React.PointerEvent) => { const r = e.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)) }; };
  return (
    <div ref={room} className="relative grid min-h-0 flex-1 place-items-center">
      {/* the corners cut by a clip-path: a frame the browser composites apart (the film's) is not cut by a rounded overflow */}
      <div className="relative overflow-hidden rounded-[8px] bg-black [clip-path:inset(0_round_8px)]" style={{ width: box.w, height: box.h }}>
        <Preview ref={preview} folder={folder} stage={stage} time={time} onInfo={onInfo} />
        <div data-capture-hide="" className={`absolute inset-0 ${idle ? 'pointer-events-none' : drag || !playing ? 'cursor-crosshair' : 'cursor-default'}`}
          onPointerEnter={() => setInside(true)} onPointerLeave={() => setInside(false)}
          onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); const p = at(e); setDrag({ x1: p.x, y1: p.y, x2: p.x, y2: p.y }); }}
          onPointerMove={(e) => {
            if (!drag) return;
            const p = at(e);
            /* a drag, not a click: the film stops, so the box is drawn on one picture */
            if (Math.abs(drag.x2 - drag.x1) < REGION_MIN_PX && Math.abs(p.x - drag.x1) >= REGION_MIN_PX) onDragStart();
            setDrag({ ...drag, x2: p.x, y2: p.y });
          }}
          onPointerUp={() => {
            if (!drag) return;
            const d = drag;
            setDrag(null);
            if (Math.abs(d.x2 - d.x1) < REGION_MIN_PX || Math.abs(d.y2 - d.y1) < REGION_MIN_PX) { if (Math.abs(d.x2 - d.x1) < REGION_MIN_PX && Math.abs(d.y2 - d.y1) < REGION_MIN_PX) onToggle(); return; }
            const x = Math.min(d.x1, d.x2) / k, y = Math.min(d.y1, d.y2) / k;
            onBox({ x: Math.round(x), y: Math.round(y), w: Math.round(Math.abs(d.x2 - d.x1) / k), h: Math.round(Math.abs(d.y2 - d.y1) / k) });
          }}>
          {drag && Math.abs(drag.x2 - drag.x1) >= REGION_MIN_PX ? <span className="absolute rounded-[4px] border-2 border-[color:var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]"
            style={{ left: Math.min(drag.x1, drag.x2), top: Math.min(drag.y1, drag.y2), width: Math.abs(drag.x2 - drag.x1), height: Math.abs(drag.y2 - drag.y1) }} /> : null}
          <Boxes marks={marks} clock={clock} k={k} onRemove={onRemove} removeLabel={removeLabel} stateOf={stateOf} onHover={onHoverMark} />
        </div>
        {unread ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-8 text-[13px] text-[var(--text-muted)]">{unread}</div>
        ) : null}
      </div>
      <div data-capture-hide="" className="pointer-events-none absolute inset-x-0 top-4 z-10 flex flex-col items-center gap-2 px-4">
        {hint && inside && !drag && !playing && !idle && !unread ? (
          <span className="flex h-8 items-center gap-1.5 rounded-full bg-black/65 px-3.5 text-[12px] font-medium text-white shadow-[0_8px_24px_rgb(0_0_0/.35)] backdrop-blur-xl">
            <SquareDashed size={13} className="text-[var(--accent)]" />{hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The boxes pointed at, shown at their moment (a box means the picture then); one whose pill is under the pointer in the
 * chat is shown whatever the moment, so what the pill means is seen, and one just found rings once.
 */
function Boxes({ marks, clock, k, onRemove, removeLabel, stateOf, onHover }: {
  marks: readonly Mark[]; clock: Clock; k: number; onRemove: (mark: Mark) => void; removeLabel: string;
  stateOf: (ref: Mark['ref']) => MarkState; onHover: (ref: Mark['ref'] | null) => void;
}) {
  const t = useClock(clock);
  return (
    <>
      {marks.map((m) => {
        if (m.ref.kind !== 'region') return null;
        const state = stateOf(m.ref);
        const now = Math.abs(m.ref.time - t) < 0.08;
        if (!now && !state) return null;
        return (
          <span key={m.n} className="absolute rounded-[3px] transition-[box-shadow,background-color]"
            onPointerEnter={() => onHover(m.ref)} onPointerLeave={() => onHover(null)}
            style={{
              left: m.ref.box.x * k, top: m.ref.box.y * k, width: m.ref.box.w * k, height: m.ref.box.h * k,
              border: `2px ${now ? 'solid' : 'dashed'} var(--accent)`,
              boxShadow: state ? '0 0 0 1px rgb(0 0 0 / .45), 0 0 0 4px color-mix(in srgb, var(--accent) 35%, transparent), 0 0 24px color-mix(in srgb, var(--accent) 45%, transparent)' : '0 0 0 1px rgb(0 0 0 / .45), inset 0 0 0 1px rgb(0 0 0 / .25)',
              background: `color-mix(in srgb, var(--accent) ${state ? 16 : 8}%, transparent)`,
            }}>
            {state === 'flash' ? <span className="pointer-events-none absolute -inset-[2px] animate-ping rounded-[4px] border-2 border-[var(--accent)]" style={{ animationIterationCount: 2 }} /> : null}
            <span className="pointer-events-none absolute -left-[10px] -top-[10px] grid h-5 min-w-5 place-items-center rounded-[6px] bg-[var(--accent)] px-1 text-[11px] font-semibold text-[var(--on-accent)] shadow">{m.n}</span>
            <button type="button" aria-label={`${removeLabel} ${m.n}`} title={removeLabel}
              onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onRemove(m); }}
              className="absolute -right-[10px] -top-[10px] grid h-5 w-5 place-items-center rounded-full bg-[var(--bg-raised)] text-[var(--text)] shadow ring-1 ring-[var(--border-strong)] transition hover:bg-[var(--err)] hover:text-white">
              <X size={12} strokeWidth={2.4} />
            </button>
          </span>
        );
      })}
    </>
  );
}
