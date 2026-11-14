/**
 * The playback bar: the whole film as a strip of its frames, the playhead on it. A click goes there, the playhead's knob
 * drags it, and a drag anywhere else picks a stretch to point at. Hovering shows the frame there and its time. What the
 * message being written points at is marked on it, numbered as the chat numbers it (a number turns into its × under
 * the pointer); the places the agent changed are lit under it.
 */
import * as React from 'react';
import { X } from 'lucide-react';
import type { StudioRef } from '@/lib/host';
import { timeLabel, type Clock, type Range } from './screening-model';

/** A value of a Clock, kept current in React. */
export function useClock(source: Clock): number {
  return React.useSyncExternalStore(source.subscribe, source.get, source.get);
}

/** What the message being written points at, with its number there. */
export interface Mark { n: number; ref: StudioRef }

/** How far the pointer moves before a press on the bar is a drag (a stretch), px. */
const DRAG_PX = 4;
/** The strip's height, px; each frame on it is as wide as the film's shape makes it at that height. */
const STRIP_H = 40;

export function Scrubber({ duration, clock, aspect, frameAt, marks, changes, removeLabel, onSeek, onScrub, onRange, onRemove }: {
  duration: number; clock: Clock;
  /** the film's width over its height */
  aspect: number;
  /** the address of the film's picture at `t` s, `w` px wide; undefined: none to show */
  frameAt: (t: number, w: number) => string | undefined;
  marks: readonly Mark[]; changes: readonly Range[]; removeLabel: string;
  onSeek: (t: number) => void; onScrub: (scrubbing: boolean) => void; onRange: (a: number, b: number) => void; onRemove: (ref: StudioRef) => void;
}) {
  const bar = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const fit = () => setWidth(el.clientWidth);
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const [hover, setHover] = React.useState<{ t: number; x: number } | null>(null);
  const [span, setSpan] = React.useState<{ a: number; b: number } | null>(null);
  const press = React.useRef<{ x: number; t: number; knob: boolean; moved: boolean } | null>(null);
  const pct = (t: number) => `${duration ? Math.max(0, Math.min(100, (t / duration) * 100)) : 0}%`;
  const across = (a: number, b: number) => `${duration ? Math.max(0, ((Math.min(b, duration) - Math.max(a, 0)) / duration) * 100) : 0}%`;
  const timeAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration;
  };
  /* the frames along the strip, one for each place a frame fits */
  const frameW = Math.max(24, Math.round(STRIP_H * (aspect || 16 / 9)));
  const slots = width && duration ? Math.max(1, Math.ceil(width / frameW)) : 0;
  const frames = React.useMemo(() => Array.from({ length: slots }, (_, i) => frameAt(((i + 0.5) / slots) * duration, 160)), [slots, duration, frameAt]);

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || !duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const knob = Boolean((e.target as HTMLElement).closest('[data-knob]'));
    const t = timeAt(e.clientX);
    press.current = { x: e.clientX, t, knob, moved: false };
    if (knob) onScrub(true);
  };
  const move = (e: React.PointerEvent) => {
    const t = timeAt(e.clientX);
    const r = bar.current!.getBoundingClientRect();
    setHover({ t, x: e.clientX - r.left });
    const p = press.current;
    if (!p) return;
    if (p.knob) { onSeek(t); return; }
    if (!p.moved && Math.abs(e.clientX - p.x) < DRAG_PX) return;
    p.moved = true;
    setSpan({ a: p.t, b: t });
  };
  const up = (e: React.PointerEvent) => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    if (p.knob) { onScrub(false); return; }
    if (p.moved && span) { onRange(Math.min(span.a, span.b), Math.max(span.a, span.b)); setSpan(null); return; }
    setSpan(null);
    onSeek(timeAt(e.clientX));
  };
  const hoverFrame = hover && !press.current?.moved ? frameAt(Math.round(hover.t * 4) / 4, 320) : undefined;

  return (
    <div className="relative min-w-0 flex-1">
      {/* the numbers of what is pointed at, over the strip */}
      <div className="pointer-events-none absolute inset-x-0 -top-[11px] z-30 h-0">
        {placeNumbers(marks, duration, width).map(({ mark, x }) => (
          <span key={mark.n} className="pointer-events-auto absolute top-0 -translate-x-1/2" style={{ left: x }}>
            <MarkNumber n={mark.n} label={removeLabel} onRemove={() => onRemove(mark.ref)} />
          </span>
        ))}
      </div>
      <div ref={bar} role="slider" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-label="film"
        className="relative cursor-pointer touch-none select-none overflow-hidden rounded-[8px] bg-black/40 ring-1 ring-inset ring-white/10"
        style={{ height: STRIP_H }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setHover(null)}>
        {/* the film's frames */}
        <div className="pointer-events-none absolute inset-0 flex">
          {frames.map((src, i) => (
            <span key={i} className="h-full min-w-0 flex-1 bg-cover bg-center opacity-90" style={src ? { backgroundImage: `url("${src}")` } : undefined} />
          ))}
        </div>
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/25" />
        {/* the changes, the stretches pointed at, the one being picked */}
        {changes.map((c, i) => <span key={`c${i}`} className="pointer-events-none absolute inset-y-0 bg-[color-mix(in_srgb,var(--warn)_22%,transparent)] shadow-[inset_0_-3px_0_var(--warn)]" style={{ left: pct(c.start), width: across(c.start, c.end) }} />)}
        {marks.map((m) => (m.ref.kind === 'range' && m.ref.end - m.ref.start < duration - 0.05
          ? <span key={`r${m.n}`} className="pointer-events-none absolute inset-y-0 rounded-[6px] bg-[color-mix(in_srgb,var(--accent)_24%,transparent)] shadow-[inset_0_0_0_2px_var(--accent)]" style={{ left: pct(m.ref.start), width: across(m.ref.start, m.ref.end) }} />
          : null))}
        {marks.map((m) => (m.ref.kind === 'time' || m.ref.kind === 'region' ? <span key={`t${m.n}`} className="pointer-events-none absolute inset-y-0 w-[2px] -translate-x-1/2 bg-[var(--accent)]" style={{ left: pct(m.ref.time) }} /> : null))}
        {span ? <span className="pointer-events-none absolute inset-y-0 rounded-[6px] bg-[color-mix(in_srgb,var(--accent)_32%,transparent)] shadow-[inset_0_0_0_2px_var(--accent)]" style={{ left: pct(Math.min(span.a, span.b)), width: across(Math.min(span.a, span.b), Math.max(span.a, span.b)) }} /> : null}
        {hover && !press.current ? <span className="pointer-events-none absolute inset-y-0 w-px bg-white/60" style={{ left: hover.x }} /> : null}
        <Playhead clock={clock} duration={duration} />
      </div>
      {/* over the bar: the frame and the time under the pointer, or the stretch being picked */}
      {hover && duration ? (
        <div className="pointer-events-none absolute bottom-full z-40 mb-3 flex -translate-x-1/2 flex-col items-center gap-1.5"
          style={{ left: Math.max(90, Math.min(hover.x, width - 90)) }}>
          {hoverFrame && !span ? (
            <span className="block overflow-hidden rounded-[8px] bg-black bg-cover bg-center shadow-[0_10px_30px_rgb(0_0_0/.5)] ring-1 ring-white/15"
              style={{ width: 176, height: Math.round(176 / (aspect || 16 / 9)), backgroundImage: `url("${hoverFrame}")` }} />
          ) : null}
          <span className="rounded-[5px] bg-black/80 px-1.5 py-[2px] font-mono text-[11px] tabular-nums text-white">
            {span ? `${timeLabel(Math.min(span.a, span.b))} – ${timeLabel(Math.max(span.a, span.b))}` : timeLabel(hover.t)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Where each mark's number sits on the bar, px: at its time, moved along so none covers another. */
function placeNumbers(marks: readonly Mark[], duration: number, width: number): { mark: Mark; x: number }[] {
  const GAP = 22;
  const placed = marks.flatMap((mark) => {
    const at = markAt(mark.ref);
    return at == null || !duration ? [] : [{ mark, x: (Math.max(0, Math.min(at, duration)) / duration) * width }];
  }).sort((a, b) => a.x - b.x || a.mark.n - b.mark.n);
  for (let i = 1; i < placed.length; i++) placed[i]!.x = Math.max(placed[i]!.x, placed[i - 1]!.x + GAP);
  return placed;
}

/** Where a mark is on the bar: a moment, a box's moment, a stretch's start, a clip's or a line's start. */
function markAt(ref: StudioRef): number | null {
  switch (ref.kind) {
    case 'time': case 'region': return ref.time;
    case 'range': case 'clip': case 'subtitle': return ref.start;
    default: return null;
  }
}

function Playhead({ clock, duration }: { clock: Clock; duration: number }) {
  const t = useClock(clock);
  return (
    <span data-knob="" className="absolute inset-y-0 z-20 w-[14px] -translate-x-1/2 cursor-ew-resize" style={{ left: `${duration ? Math.max(0, Math.min(100, (t / duration) * 100)) : 0}%` }}>
      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/.35)]" />
    </span>
  );
}

/** A number of what the message points at; under the pointer it is the way to take it out. */
export function MarkNumber({ n, label, onRemove }: { n: number; label: string; onRemove: () => void }) {
  return (
    <button type="button" aria-label={`${label} ${n}`} title={label} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onRemove(); }}
      className="group/n grid h-[20px] min-w-[20px] place-items-center rounded-full bg-[var(--accent)] px-1 text-[11px] font-semibold leading-none text-[var(--on-accent)] shadow-[0_2px_6px_rgb(0_0_0/.4)] ring-2 ring-[var(--bg-raised)] transition hover:bg-[var(--err)]">
      <span className="group-hover/n:hidden">{n}</span>
      <X size={11} strokeWidth={2.8} className="hidden group-hover/n:block" />
    </button>
  );
}
