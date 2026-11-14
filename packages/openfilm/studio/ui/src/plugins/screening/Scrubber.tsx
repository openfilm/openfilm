/**
 * The playback bar: the film as a strip of its frames, the playhead a line on it. A click goes there; a double click
 * points at that moment; a drag picks a stretch to point at, the picture following the pointer as it goes (Esc lets go
 * of it). Scrolling or pinching over it brings the film closer (down to a second across the bar, a frame or so in each
 * picture) or farther; closer, a scrollbar along its foot shows the part shown and drags it along. What the message
 * being written points at is marked on it, numbered as the chat numbers it: a number goes there, its × takes it out.
 * The places the agent changed are lit under it.
 */
import * as React from 'react';
import { X } from 'lucide-react';
import type { StudioRef } from '@/lib/host';
import { fitted, tickStep, tileStep, timeLabel, timeOf, zoomed, type Clock, type Range, type View } from './screening-model';

/** A value of a Clock, kept current in React. */
export function useClock(source: Clock): number {
  return React.useSyncExternalStore(source.subscribe, source.get, source.get);
}

/** What the message being written points at, with its number there. */
export interface Mark { n: number; ref: StudioRef }

/** What the bar can be asked from outside (the keys). */
export interface ScrubberHandle { zoomIn(): void; zoomOut(): void; whole(): void }

/** How far the pointer moves before a press on the bar is a drag (a stretch), px. */
const DRAG_PX = 4;
/** The strip's height, px; each picture on it is as wide as the film's shape makes it at that height. */
const STRIP_H = 40;
/** A frame, s; the closest the bar comes is `LEAST_S` across it. */
const FRAME = 1 / 30;
const LEAST_S = 1;

export const Scrubber = React.forwardRef<ScrubberHandle, {
  duration: number; clock: Clock;
  /** the film's width over its height */
  aspect: number;
  /** the address of the film's picture at `t` s, `w` px wide, for a picture standing for `step` s; undefined: none */
  frameAt: (t: number, w: number, step: number) => string | undefined;
  marks: readonly Mark[]; changes: readonly Range[];
  /** `hints`: how the bar is used, said under the time while the pointer is on it */
  words: { go: string; remove: string; hints: readonly string[] };
  onSeek: (t: number) => void; onMoment: (t: number) => void; onRange: (a: number, b: number) => void;
  onGo: (mark: Mark) => void; onRemove: (ref: StudioRef) => void;
  /** how much of the film the bar shows now, s */
  onSpan: (span: number) => void;
}>(function Scrubber({ duration, clock, aspect, frameAt, marks, changes, words, onSeek, onMoment, onRange, onGo, onRemove, onSpan }, handle) {
  const wrap = React.useRef<HTMLDivElement>(null);
  const bar = React.useRef<HTMLDivElement>(null);
  const width = useWidth(bar);
  /* the part shown; null: the whole film */
  const [shown, setShown] = React.useState<View | null>(null);
  const v: View = shown && duration ? fitted(shown, duration) : { from: 0, span: duration };
  const close = duration > 0 && v.span < duration - 1e-3;
  const live = React.useRef({ v, duration });
  live.current = { v, duration };
  const show = React.useCallback((next: View | null) => {
    const d = live.current.duration;
    setShown(!next || next.span >= d - 1e-3 ? null : fitted(next, d));
  }, []);
  const zoomAt = React.useCallback((at: number, factor: number) => {
    const { v, duration } = live.current;
    if (duration) show(zoomed(v, at, factor, duration, LEAST_S));
  }, [show]);
  React.useImperativeHandle(handle, () => ({
    zoomIn: () => zoomAt(clock.get(), 0.5),
    zoomOut: () => zoomAt(clock.get(), 2),
    whole: () => show(null),
  }), [zoomAt, show, clock]);
  React.useEffect(() => { onSpan(v.span); }, [v.span, onSpan]);

  const [hover, setHover] = React.useState<{ t: number; x: number } | null>(null);
  const [span, setSpan] = React.useState<{ a: number; b: number } | null>(null);
  const press = React.useRef<{ x: number; t: number; moved: boolean } | null>(null);
  const x = (t: number) => (v.span ? ((t - v.from) / v.span) * width : 0);
  const left = (t: number) => `${v.span ? ((t - v.from) / v.span) * 100 : 0}%`;
  const across = (a: number, b: number) => `${v.span ? (Math.max(0, Math.min(b, v.from + v.span) - Math.max(a, v.from)) / v.span) * 100 : 0}%`;
  const seen = (a: number, b = a) => b >= v.from && a <= v.from + v.span;
  const timeAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return v.from + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * v.span;
  };

  /* scrolling or pinching over the bar: closer or farther around the pointer; sideways: along the film */
  React.useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      const { v, duration } = live.current;
      if (!duration || !bar.current) return;
      e.preventDefault();
      const line = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * line, dy = e.deltaY * line;
      const r = bar.current.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || Math.abs(dy) > Math.abs(dx)) {
        const at = v.from + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * v.span;
        /* a pinch comes as small steps with Ctrl held; a wheel as large ones */
        zoomAt(at, Math.exp(Math.max(-60, Math.min(60, dy)) * (e.ctrlKey ? 0.02 : 0.005)));
      } else if (v.span < duration) show({ from: v.from + (dx / r.width) * v.span, span: v.span });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [zoomAt, show]);

  /* closer in, the playhead is kept in sight: past the end the next part is shown, a jump puts it in the middle */
  React.useEffect(() => clock.subscribe(() => {
    const { v, duration } = live.current;
    if (!duration || v.span >= duration - 1e-3 || press.current) return;
    const t = clock.get(), end = v.from + v.span;
    if (t >= v.from && t <= end) return;
    show({ from: t > end && t - end < v.span * 0.25 ? t - v.span * 0.05 : t - v.span / 2, span: v.span });
  }), [clock, show]);

  /* a stretch being picked is let go of with Esc */
  React.useEffect(() => {
    if (!span) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      press.current = null;
      setSpan(null);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [span]);

  /* the pictures along the strip: each stands for `step` s of film, placed where that film is; under each, the
     picture the whole film's strip has there, shown until its own has come */
  const tile = Math.max(24, Math.round(STRIP_H * (aspect || 16 / 9)));
  const step = tileStep(v.span, width, tile, FRAME);
  const wholeStep = tileStep(duration, width, tile, FRAME);
  const tiles = React.useMemo(() => {
    if (!step || !duration) return [];
    const out: { at: number; srcs: string[] }[] = [];
    const picture = (t: number, each: number) => frameAt(Math.min(t, duration - 1e-3), 160, each);
    for (let k = Math.floor(v.from / step); k * step < v.from + v.span; k++) {
      const mid = k * step + step / 2;
      out.push({ at: k * step, srcs: [picture(mid, step), picture((Math.floor(mid / wholeStep) + 0.5) * wholeStep, wholeStep)].filter((src): src is string => Boolean(src)) });
    }
    return out;
  }, [step, wholeStep, v.from, v.span, duration, frameAt]);
  const tick = close ? tickStep(v.span, width) : 0;
  const ticks = tick ? Array.from({ length: Math.floor((v.from + v.span) / tick) - Math.ceil(v.from / tick) + 1 }, (_, i) => (Math.ceil(v.from / tick) + i) * tick) : [];

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || !duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { x: e.clientX, t: timeAt(e.clientX), moved: false };
  };
  const move = (e: React.PointerEvent) => {
    const t = timeAt(e.clientX);
    setHover({ t, x: e.clientX - bar.current!.getBoundingClientRect().left });
    const p = press.current;
    if (!p) return;
    if (!p.moved && Math.abs(e.clientX - p.x) < DRAG_PX) return;
    p.moved = true;
    setSpan({ a: p.t, b: t });
    /* the picture follows the pointer, so the stretch is picked by what is in it */
    onSeek(t);
  };
  const up = (e: React.PointerEvent) => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    if (p.moved && span) { onRange(Math.min(span.a, span.b), Math.max(span.a, span.b)); setSpan(null); return; }
    setSpan(null);
    onSeek(timeAt(e.clientX));
  };
  const decimals = close ? (v.span <= 4 ? 2 : 1) : 0;

  return (
    <div ref={wrap} className="relative min-w-0 flex-1">
      {/* the numbers of what is pointed at, over the strip */}
      <div className="pointer-events-none absolute inset-x-0 -top-[11px] z-30 h-0">
        {placeNumbers(marks, (t) => (seen(t) ? x(t) : null)).map(({ mark, x }) => (
          <span key={mark.n} className="pointer-events-auto absolute top-0 -translate-x-1/2" style={{ left: x }}>
            <MarkNumber mark={mark} go={words.go} remove={words.remove} onGo={() => onGo(mark)} onRemove={() => onRemove(mark.ref)} />
          </span>
        ))}
      </div>
      <div ref={bar} role="slider" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-label="film"
        className="relative cursor-pointer touch-none select-none overflow-hidden rounded-[8px] bg-black/40 ring-1 ring-inset ring-white/10"
        style={{ height: STRIP_H }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setHover(null)}
        onDoubleClick={(e) => onMoment(timeAt(e.clientX))}>
        <div className="pointer-events-none absolute inset-0">
          {/* the film's pictures */}
          {tiles.map(({ at, srcs }) => (
            <span key={at} className="absolute inset-y-0 bg-cover bg-[center_35%] opacity-90 shadow-[inset_-1px_0_0_rgb(0_0_0/.35)]"
              style={{ left: x(at), width: (step / v.span) * width + 0.5, ...(srcs.length ? { backgroundImage: [...new Set(srcs)].map((src) => `url("${src}")`).join(', ') } : {}) }} />
          ))}
          <span className={`absolute inset-0 bg-gradient-to-b from-transparent ${close ? 'via-transparent via-55% to-black/70' : 'via-transparent to-black/25'}`} />
          {/* closer in: a line every so often, so a second can be told */}
          {ticks.map((t) => <span key={t} className="absolute top-0 h-[6px] w-px bg-white/55" style={{ left: x(t) }} />)}
          {/* the changes, the stretches pointed at, the one being picked */}
          {changes.map((c, i) => (seen(c.start, c.end) ? <span key={`c${i}`} className="absolute inset-y-0 bg-[color-mix(in_srgb,var(--warn)_22%,transparent)] shadow-[inset_0_-3px_0_var(--warn)]" style={{ left: left(Math.max(c.start, v.from)), width: across(c.start, c.end) }} /> : null))}
          {marks.map((m) => (m.ref.kind === 'range' && m.ref.end - m.ref.start < duration - 0.05 && seen(m.ref.start, m.ref.end)
            ? <span key={`r${m.n}`} className="absolute inset-y-0 rounded-[6px] bg-[color-mix(in_srgb,var(--accent)_24%,transparent)] shadow-[inset_0_0_0_2px_var(--accent)]" style={{ left: left(Math.max(m.ref.start, v.from)), width: across(m.ref.start, m.ref.end) }} />
            : null))}
          {marks.map((m) => ((m.ref.kind === 'time' || m.ref.kind === 'region') && seen(m.ref.time) ? <span key={`t${m.n}`} className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-[var(--accent)]" style={{ left: left(m.ref.time) }} /> : null))}
          {span ? <span className="absolute inset-y-0 rounded-[6px] bg-[color-mix(in_srgb,var(--accent)_32%,transparent)] shadow-[inset_0_0_0_2px_var(--accent)]" style={{ left: left(Math.min(span.a, span.b)), width: across(Math.min(span.a, span.b), Math.max(span.a, span.b)) }} /> : null}
          {hover && !press.current ? <span className="absolute inset-y-0 w-px bg-white/45" style={{ left: hover.x }} /> : null}
          <Playhead clock={clock} at={(t) => (seen(t) ? left(t) : null)} />
        </div>
        {/* closer in: the part of the film shown, along the strip's foot, to drag */}
        {close ? <Scrollbar duration={duration} view={v} marks={marks} onView={show} /> : null}
      </div>
      {/* over the bar: the time under the pointer, or the stretch being picked; how the bar is used, until it has been */}
      {hover && duration ? (
        <div className="pointer-events-none absolute bottom-full z-40 mb-3 flex -translate-x-1/2 flex-col items-center"
          style={{ left: Math.max(70, Math.min(hover.x, width - 70)) }}>
          <span className="flex flex-col items-center gap-0.5 rounded-[7px] bg-black/80 px-2 py-1 text-white shadow-[0_6px_20px_rgb(0_0_0/.35)] backdrop-blur">
            <span className="font-mono text-[11px] tabular-nums">
              {span ? `${timeLabel(Math.min(span.a, span.b), decimals)} – ${timeLabel(Math.max(span.a, span.b), decimals)}` : timeLabel(hover.t, decimals)}
            </span>
            {!span && words.hints.length ? <span className="whitespace-nowrap text-[10.5px] text-white/60">{words.hints.join(' · ')}</span> : null}
          </span>
        </div>
      ) : null}
    </div>
  );
});

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setWidth(el.clientWidth);
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, [ref]);
  return width;
}

/** Where each shown mark's number sits on the bar, px: at its time, moved along so none covers another. */
function placeNumbers(marks: readonly Mark[], xOf: (t: number) => number | null): { mark: Mark; x: number }[] {
  const GAP = 24;
  const placed = marks.flatMap((mark) => {
    const at = timeOf(mark.ref);
    const x = at == null ? null : xOf(at);
    return x == null ? [] : [{ mark, x }];
  }).sort((a, b) => a.x - b.x || a.mark.n - b.mark.n);
  for (let i = 1; i < placed.length; i++) placed[i]!.x = Math.max(placed[i]!.x, placed[i - 1]!.x + GAP);
  return placed;
}

function Playhead({ clock, at }: { clock: Clock; at: (t: number) => string | null }) {
  const left = at(useClock(clock));
  return left == null ? null : <span className="absolute inset-y-0 w-[2px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/.35),0_0_8px_rgb(255_255_255/.35)]" style={{ left }} />;
}

/**
 * The part of the film shown, as a scrollbar along the strip's foot: its thumb drags it along, a press beside the
 * thumb brings that part, a double click shows the whole film again. What is pointed at is dotted on it, so what is
 * out of sight can be found.
 */
function Scrollbar({ duration, view, marks, onView }: { duration: number; view: View; marks: readonly Mark[]; onView: (v: View | null) => void }) {
  const track = React.useRef<HTMLDivElement>(null);
  const grab = React.useRef<number | null>(null);
  const pct = (t: number) => `${(t / duration) * 100}%`;
  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration;
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div data-scrollbar="" className="group/s absolute inset-x-2 bottom-0 h-[11px] cursor-default"
      onPointerDown={(e) => {
        stop(e);
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const t = timeAt(e.clientX);
        const inside = t >= view.from && t <= view.from + view.span;
        grab.current = inside ? t - view.from : view.span / 2;
        if (!inside) onView({ from: t - grab.current, span: view.span });
      }}
      onPointerMove={(e) => { stop(e); if (grab.current != null) onView({ from: timeAt(e.clientX) - grab.current, span: view.span }); }}
      onPointerUp={(e) => { stop(e); grab.current = null; }}
      onDoubleClick={(e) => { stop(e); onView(null); }}>
      <div ref={track} className="absolute inset-x-0 bottom-[4px] h-[3px] rounded-full bg-white/15 transition-[height] group-hover/s:h-[5px]">
        {marks.map((m) => { const t = timeOf(m.ref); return t == null ? null : <span key={m.n} className="absolute top-1/2 h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)]" style={{ left: pct(t) }} />; })}
        <span className="absolute inset-y-0 rounded-full bg-white/85 shadow-[0_0_6px_rgb(0_0_0/.5)]"
          style={{ left: pct(view.from), width: `max(12px, ${(view.span / duration) * 100}%)` }} />
      </div>
    </div>
  );
}

/** A mark's number: a click goes to it; its × (under the pointer) takes it out. A box's number is square, as its box. */
export function MarkNumber({ mark, go, remove, onGo, onRemove }: { mark: Mark; go: string; remove: string; onGo: () => void; onRemove: () => void }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <span className="group/n relative inline-flex">
      <button type="button" aria-label={`${go} ${mark.n}`} title={go} onPointerDown={stop} onDoubleClick={stop} onClick={(e) => { stop(e); onGo(); }}
        className={`grid h-[20px] min-w-[20px] place-items-center bg-[var(--accent)] px-1 text-[11px] font-semibold leading-none text-[var(--on-accent)] shadow-[0_2px_6px_rgb(0_0_0/.4)] ring-2 ring-[var(--bg-raised)] transition hover:brightness-110 ${mark.ref.kind === 'region' ? 'rounded-[6px]' : 'rounded-full'}`}>
        {mark.n}
      </button>
      <button type="button" aria-label={`${remove} ${mark.n}`} title={remove} onPointerDown={stop} onDoubleClick={stop} onClick={(e) => { stop(e); onRemove(); }}
        className="absolute -right-[8px] -top-[8px] hidden h-[15px] w-[15px] place-items-center rounded-full bg-[var(--bg-raised)] text-[var(--text)] shadow ring-1 ring-[var(--border-strong)] transition hover:bg-[var(--err)] hover:text-white group-hover/n:grid">
        <X size={9} strokeWidth={3} />
      </button>
    </span>
  );
}
