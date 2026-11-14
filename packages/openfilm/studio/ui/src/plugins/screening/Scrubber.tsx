/**
 * The film along a line, as a strip of its frames, the playhead a line on it: a click goes there, a drag runs the
 * picture along. What is pointed at and what the agent changed are marked on it. While the pointer is on it, two
 * thin rows come round it:
 *  - above, the marks row: a click there points at that moment, a drag picks a stretch (the picture following the
 *    pointer; Esc lets go of it). What the message being written points at is numbered there as the chat numbers it
 *    (shown always): a number goes to its place, its × takes it out.
 *  - below, the zoom bar: the whole film, the part shown as its thumb. Its ends bring the film closer (down to a
 *    second across the strip) or farther, its middle drags along, a double click shows the whole film. Scrolling or
 *    pinching over the strip does the same around the pointer.
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

/** What the bar can be asked from outside (the keys, the zoom control). */
export interface ScrubberHandle {
  zoomIn(): void; zoomOut(): void; whole(): void;
  /** how close, from 0 (the whole film) to 1 (the closest), around the playhead */
  setLevel(level: number): void;
}

/** How far the pointer moves before a press on the marks row is a drag (a stretch), px. */
const DRAG_PX = 4;
const LANE_H = 18;
/** The strip's height, px; each picture on it is as wide as the film's shape makes it at that height. */
const STRIP_H = 36;
/** A frame, s. */
const FRAME = 1 / 30;
/** The closest the bar comes: this many seconds across it. */
export const LEAST_S = 1;

/** How close a view is, from 0 (the whole film) to 1 (`LEAST_S` across), on a scale that doubles evenly. */
export function levelOf(span: number, duration: number): number {
  const most = Math.log(Math.max(1, duration / LEAST_S));
  return most > 0 && span > 0 ? Math.max(0, Math.min(1, Math.log(duration / span) / most)) : 0;
}

export const Scrubber = React.forwardRef<ScrubberHandle, {
  duration: number; clock: Clock;
  /** the film's width over its height */
  aspect: number;
  /** the address of the film's picture at `t` s, `w` px wide, for a picture standing for `step` s; undefined: none */
  frameAt: (t: number, w: number, step: number) => string | undefined;
  marks: readonly Mark[]; changes: readonly Range[];
  /**
   * `lane`: said in the empty marks row (null: nothing); `laneHints`, `barHints`: how each is used, said under the time
   * while the pointer is on it
   */
  words: { go: string; remove: string; lane: string | null; laneHints: readonly string[]; barHints: readonly string[] };
  onSeek: (t: number) => void; onMoment: (t: number) => void; onRange: (a: number, b: number) => void;
  onGo: (mark: Mark) => void; onRemove: (ref: StudioRef) => void;
  /** how much of the film the bar shows now, s */
  onSpan: (span: number) => void;
}>(function Scrubber({ duration, clock, aspect, frameAt, marks, changes, words, onSeek, onMoment, onRange, onGo, onRemove, onSpan }, handle) {
  const wrap = React.useRef<HTMLDivElement>(null);
  const strip = React.useRef<HTMLDivElement>(null);
  const width = useWidth(strip);
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
    setLevel: (level) => {
      const { v, duration } = live.current;
      if (!duration) return;
      const span = duration * (LEAST_S / duration) ** Math.max(0, Math.min(1, level));
      zoomAt(v.span ? Math.max(v.from, Math.min(clock.get(), v.from + v.span)) : clock.get(), span / (v.span || duration));
    },
  }), [zoomAt, show, clock]);
  React.useEffect(() => { onSpan(v.span); }, [v.span, onSpan]);

  /* the pointer on the bar (its rows come round it then), over which row, its time and place */
  const [inside, setInside] = React.useState(false);
  const [hover, setHover] = React.useState<{ row: 'lane' | 'strip'; t: number; x: number } | null>(null);
  const [span, setSpan] = React.useState<{ a: number; b: number } | null>(null);
  const press = React.useRef<{ row: 'lane' | 'strip'; x: number; t: number; moved: boolean } | null>(null);
  const [held, setHeld] = React.useState(false);
  const x = (t: number) => (v.span ? ((t - v.from) / v.span) * width : 0);
  const left = (t: number) => `${v.span ? ((t - v.from) / v.span) * 100 : 0}%`;
  const across = (a: number, b: number) => `${v.span ? (Math.max(0, Math.min(b, v.from + v.span) - Math.max(a, v.from)) / v.span) * 100 : 0}%`;
  const seen = (a: number, b = a) => b >= v.from && a <= v.from + v.span;
  const timeAt = (clientX: number) => {
    const r = strip.current!.getBoundingClientRect();
    return v.from + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * v.span;
  };
  const xAt = (clientX: number) => clientX - strip.current!.getBoundingClientRect().left;
  /* the rows round the strip: shown while the pointer is on the bar, or something on it is held */
  const rows = inside || held || Boolean(span);

  /* scrolling or pinching over the bar: closer or farther around the pointer; sideways: along the film */
  React.useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      const { v, duration } = live.current;
      if (!duration || !strip.current) return;
      e.preventDefault();
      const line = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * line, dy = e.deltaY * line;
      const r = strip.current.getBoundingClientRect();
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

  /* ── the strip: a press goes there, a drag runs the picture along ── */
  const stripDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { row: 'strip', x: e.clientX, t: timeAt(e.clientX), moved: false };
    setHeld(true);
    onSeek(timeAt(e.clientX));
  };
  const stripMove = (e: React.PointerEvent) => {
    const t = timeAt(e.clientX);
    setHover({ row: 'strip', t, x: xAt(e.clientX) });
    if (press.current?.row === 'strip') onSeek(t);
  };
  const stripUp = () => { press.current = null; setHeld(false); };
  /* ── the marks row: a click points at that moment, a drag at a stretch, the picture following ── */
  const laneDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { row: 'lane', x: e.clientX, t: timeAt(e.clientX), moved: false };
  };
  const laneMove = (e: React.PointerEvent) => {
    const t = timeAt(e.clientX);
    setHover({ row: 'lane', t, x: xAt(e.clientX) });
    const p = press.current;
    if (p?.row !== 'lane') return;
    if (!p.moved && Math.abs(e.clientX - p.x) < DRAG_PX) return;
    p.moved = true;
    setSpan({ a: p.t, b: t });
    onSeek(t);
  };
  const laneUp = () => {
    const p = press.current;
    press.current = null;
    if (p?.row !== 'lane') return;
    if (p.moved) { if (span) onRange(Math.min(span.a, span.b), Math.max(span.a, span.b)); setSpan(null); return; }
    onMoment(p.t);
  };
  const decimals = close ? (v.span <= 4 ? 2 : 1) : 0;
  const hints = hover?.row === 'lane' ? words.laneHints : words.barHints;
  const fade = `transition-opacity duration-150 ${rows ? 'opacity-100' : 'pointer-events-none opacity-0'}`;

  return (
    <div ref={wrap} className="relative min-w-0" onPointerEnter={() => setInside(true)} onPointerLeave={() => { setInside(false); setHover(null); }}>
      {/* the marks row */}
      <div data-lane="" className="relative cursor-crosshair touch-none select-none" style={{ height: LANE_H }}
        onPointerDown={laneDown} onPointerMove={laneMove} onPointerUp={laneUp} onPointerLeave={() => setHover(null)}>
        <div className={`pointer-events-none absolute inset-0 overflow-hidden rounded-[5px] ${fade} ${hover?.row === 'lane' ? 'bg-white/[.07]' : 'bg-white/[.035]'}`}>
          {!marks.length && !span && words.lane ? <span className="absolute inset-0 flex items-center pl-1.5 text-[10.5px] text-[var(--text-faint)]">{words.lane}</span> : null}
          {/* where a click would point */}
          {hover?.row === 'lane' && !span ? <span className="absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-[var(--accent)]" style={{ left: hover.x }} /> : null}
        </div>
        {/* what is pointed at: always shown, numbered as the chat numbers it */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {marks.map((m) => (m.ref.kind === 'range' && m.ref.end - m.ref.start < duration - 0.05 && seen(m.ref.start, m.ref.end)
            ? <span key={`r${m.n}`} className="absolute top-1/2 h-[4px] -translate-y-1/2 rounded-full bg-[var(--accent)] opacity-80" style={{ left: left(Math.max(m.ref.start, v.from)), width: across(m.ref.start, m.ref.end) }} />
            : null))}
          {span ? <span className="absolute top-1/2 h-[4px] -translate-y-1/2 rounded-full bg-[var(--accent)]" style={{ left: left(Math.min(span.a, span.b)), width: across(Math.min(span.a, span.b), Math.max(span.a, span.b)) }} /> : null}
        </div>
        {placeNumbers(marks, (t) => (seen(t) ? x(t) : null)).map(({ mark, x }) => (
          <span key={mark.n} className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: x }}>
            <MarkNumber mark={mark} go={words.go} remove={words.remove} onGo={() => onGo(mark)} onRemove={() => onRemove(mark.ref)} />
          </span>
        ))}
      </div>
      {/* the film */}
      <div ref={strip} role="slider" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-label="film"
        className="relative mt-[3px] cursor-pointer touch-none select-none overflow-hidden rounded-[6px] bg-black/40"
        style={{ height: STRIP_H }}
        onPointerDown={stripDown} onPointerMove={stripMove} onPointerUp={stripUp} onPointerCancel={stripUp} onPointerLeave={() => setHover(null)}>
        <div className="pointer-events-none absolute inset-0">
          {tiles.map(({ at, srcs }) => (
            <span key={at} className="absolute inset-y-0 bg-cover bg-[center_35%] shadow-[inset_-1px_0_0_rgb(0_0_0/.4)]"
              style={{ left: x(at), width: (step / v.span) * width + 0.5, ...(srcs.length ? { backgroundImage: [...new Set(srcs)].map((src) => `url("${src}")`).join(', ') } : {}) }} />
          ))}
          <span className="absolute inset-0 rounded-[6px] shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)]" />
          {/* closer in: a line every so often, so a second can be told */}
          {ticks.map((t) => <span key={t} className="absolute top-0 h-[5px] w-px bg-white/60" style={{ left: x(t) }} />)}
          {/* the changes; what is pointed at, carried down from the marks */}
          {changes.map((c, i) => (seen(c.start, c.end) ? <span key={`c${i}`} className="absolute inset-y-0 bg-[color-mix(in_srgb,var(--warn)_22%,transparent)] shadow-[inset_0_-3px_0_var(--warn)]" style={{ left: left(Math.max(c.start, v.from)), width: across(c.start, c.end) }} /> : null))}
          {marks.map((m) => (m.ref.kind === 'range' && m.ref.end - m.ref.start < duration - 0.05 && seen(m.ref.start, m.ref.end)
            ? <span key={`r${m.n}`} className="absolute inset-y-0 bg-[color-mix(in_srgb,var(--accent)_16%,transparent)]" style={{ left: left(Math.max(m.ref.start, v.from)), width: across(m.ref.start, m.ref.end) }} />
            : null))}
          {span ? <span className="absolute inset-y-0 bg-[color-mix(in_srgb,var(--accent)_22%,transparent)]" style={{ left: left(Math.min(span.a, span.b)), width: across(Math.min(span.a, span.b), Math.max(span.a, span.b)) }} /> : null}
          {marks.map((m) => ((m.ref.kind === 'time' || m.ref.kind === 'region') && seen(m.ref.time) ? <span key={`t${m.n}`} className="absolute inset-y-0 w-[1.5px] -translate-x-1/2 bg-[var(--accent)]" style={{ left: left(m.ref.time) }} /> : null))}
          {hover && !press.current ? <span className={`absolute inset-y-0 w-px ${hover.row === 'lane' ? 'bg-[var(--accent)]' : 'bg-white/50'}`} style={{ left: hover.x }} /> : null}
          <Playhead clock={clock} at={(t) => (seen(t) ? left(t) : null)} />
        </div>
      </div>
      {/* the zoom bar */}
      <div className={`mt-[3px] h-[10px] ${fade}`}>
        <ZoomBar duration={duration} view={v} marks={marks} onView={show} onHold={setHeld} />
      </div>
      {/* over the bar: the time under the pointer (or the stretch being picked), and how that row is used until it has been */}
      {hover && duration ? (
        <div className="pointer-events-none absolute bottom-full z-40 mb-1.5 flex -translate-x-1/2 flex-col items-center"
          style={{ left: Math.max(70, Math.min(hover.x, width - 70)) }}>
          <span className="flex flex-col items-center rounded-[6px] bg-black/75 px-1.5 py-[3px] text-white shadow-[0_4px_14px_rgb(0_0_0/.3)] backdrop-blur">
            <span className="font-mono text-[11px] leading-[15px] tabular-nums">
              {span ? `${timeLabel(Math.min(span.a, span.b), decimals)} – ${timeLabel(Math.max(span.a, span.b), decimals)}` : timeLabel(hover.t, decimals)}
            </span>
            {!span && hints.length ? <span className="whitespace-nowrap text-[10px] leading-[14px] text-white/55">{hints.join(' · ')}</span> : null}
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

/** Where each shown mark's number sits on its row, px: at its time, moved along so none covers another. */
function placeNumbers(marks: readonly Mark[], xOf: (t: number) => number | null): { mark: Mark; x: number }[] {
  const GAP = 22;
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
 * The zoom bar: the whole film, the part shown as its thumb. The thumb's ends bring the film closer or farther, its
 * middle drags along; a press beside it brings that part; a double click shows the whole film. What is pointed at is
 * dotted on it, so what is out of sight can be found.
 */
function ZoomBar({ duration, view, marks, onView, onHold }: {
  duration: number; view: View; marks: readonly Mark[]; onView: (v: View | null) => void; onHold: (held: boolean) => void;
}) {
  const track = React.useRef<HTMLDivElement>(null);
  const grab = React.useRef<{ part: 'from' | 'to' | 'move'; t: number; from: number; span: number } | null>(null);
  const pct = (t: number) => `${duration ? (t / duration) * 100 : 0}%`;
  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration;
  };
  const whole = !(view.span < duration - 1e-3);
  const letGo = () => { grab.current = null; onHold(false); };
  return (
    <div data-zoom="" className="group/z relative h-full touch-none select-none"
      onPointerDown={(e) => {
        if (e.button !== 0 || !duration) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        onHold(true);
        const t = timeAt(e.clientX);
        const part = ((e.target as HTMLElement).closest('[data-end]') as HTMLElement | null)?.dataset.end as 'from' | 'to' | undefined;
        if (part) { grab.current = { part, t, from: view.from, span: view.span }; return; }
        const inside = t >= view.from && t <= view.from + view.span;
        const from = inside ? view.from : t - view.span / 2;
        if (!inside) onView({ from, span: view.span });
        grab.current = { part: 'move', t, from, span: view.span };
      }}
      onPointerMove={(e) => {
        const g = grab.current;
        if (!g) return;
        const dt = timeAt(e.clientX) - g.t, end = g.from + g.span;
        if (g.part === 'move') onView({ from: g.from + dt, span: g.span });
        else if (g.part === 'from') { const from = Math.max(0, Math.min(g.from + dt, end - LEAST_S)); onView({ from, span: end - from }); }
        else { const to = Math.min(duration, Math.max(end + dt, g.from + LEAST_S)); onView({ from: g.from, span: to - g.from }); }
      }}
      onPointerUp={letGo} onPointerCancel={letGo}
      onDoubleClick={() => onView(null)}>
      <div ref={track} className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/[.07] transition-[height] group-hover/z:h-[5px]">
        <span className={`absolute inset-y-0 cursor-grab rounded-full transition-colors active:cursor-grabbing ${whole ? 'bg-white/20 group-hover/z:bg-white/30' : 'bg-white/45 group-hover/z:bg-white/65'}`}
          style={{ left: pct(view.from), width: `max(14px, ${duration ? (view.span / duration) * 100 : 100}%)` }}>
          <span data-end="from" className="absolute -left-[5px] top-1/2 grid h-[12px] w-[10px] -translate-y-1/2 cursor-ew-resize place-items-center">
            <span className="h-[9px] w-[3px] rounded-full bg-white opacity-60 shadow transition-opacity group-hover/z:opacity-95" />
          </span>
          <span data-end="to" className="absolute -right-[5px] top-1/2 grid h-[12px] w-[10px] -translate-y-1/2 cursor-ew-resize place-items-center">
            <span className="h-[9px] w-[3px] rounded-full bg-white opacity-60 shadow transition-opacity group-hover/z:opacity-95" />
          </span>
        </span>
        {marks.map((m) => { const t = timeOf(m.ref); return t == null ? null : <span key={m.n} className="pointer-events-none absolute top-1/2 h-[4px] w-[4px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)]" style={{ left: pct(t) }} />; })}
      </div>
    </div>
  );
}

/** A mark's number: a click goes to it; its × (under the pointer) takes it out. A box's number is square, as its box. */
export function MarkNumber({ mark, go, remove, onGo, onRemove }: { mark: Mark; go: string; remove: string; onGo: () => void; onRemove: () => void }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <span className="group/n relative inline-flex">
      <button type="button" aria-label={`${go} ${mark.n}`} title={go} onPointerDown={stop} onPointerUp={stop} onClick={(e) => { stop(e); onGo(); }}
        className={`grid h-[15px] min-w-[15px] cursor-pointer place-items-center bg-[var(--accent)] px-[3px] text-[9.5px] font-semibold leading-none text-[var(--on-accent)] shadow-[0_0_0_2px_var(--bg-viewer)] transition hover:brightness-110 ${mark.ref.kind === 'region' ? 'rounded-[4px]' : 'rounded-full'}`}>
        {mark.n}
      </button>
      <button type="button" aria-label={`${remove} ${mark.n}`} title={remove} onPointerDown={stop} onPointerUp={stop} onClick={(e) => { stop(e); onRemove(); }}
        className="absolute -right-[8px] -top-[8px] hidden h-[13px] w-[13px] cursor-pointer place-items-center rounded-full bg-[var(--bg-raised)] text-[var(--text)] shadow ring-1 ring-[var(--border-strong)] transition hover:bg-[var(--err)] hover:text-white group-hover/n:grid">
        <X size={8} strokeWidth={3} />
      </button>
    </span>
  );
}
