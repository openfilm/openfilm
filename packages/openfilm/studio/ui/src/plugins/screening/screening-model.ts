/**
 * What the screening room works out from the film, apart from drawing it: the lines of a caption track, a reference as
 * a link for an agent outside the app, and a time as people read it.
 */
import type { StudioRef } from '@/lib/host';

/** A line of a caption track: its span on the film (s), its words, and its number in the file (from 1). */
export interface Cue { start: number; end: number; text: string; index: number }

const secondsOf = (stamp: string): number => {
  const parts = stamp.trim().split(':').map(Number);
  return parts.reduce((s, p) => s * 60 + p, 0);
};

/** The lines of a WebVTT file: each cue's times and its words (tags taken out). */
export function cuesOf(text: string): Cue[] {
  const out: Cue[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const [a, b] = lines[at]!.split('-->');
    const start = secondsOf(a!), end = secondsOf((b ?? '').trim().split(/\s+/)[0] ?? '');
    let words = lines.slice(at + 1).join(' ');
    /* tags taken out until none is left (one could hide inside another) */
    for (let was = ''; was !== words;) { was = words; words = words.replace(/<[^>]*>/g, ''); }
    words = words.trim();
    if (!words || !(end > start)) continue;
    out.push({ start, end, text: words, index: out.length + 1 });
  }
  return out;
}

const round = (t: number) => Math.round(t * 100) / 100;

/** A reference as a link an agent reads (lib/links): a clip by its id, a moment or a stretch by time, a file by path. */
export function linkOf(ref: StudioRef): string {
  switch (ref.kind) {
    case 'clip': return ref.id ? `film.html#${ref.id}` : `film.html#t=${round(ref.start)},${round(ref.end)}`;
    case 'time': return `film.html#t=${round(ref.time)}`;
    case 'region': return `film.html#t=${round(ref.time)}&xywh=${[ref.box.x, ref.box.y, ref.box.w, ref.box.h].map(Math.round).join(',')}`;
    case 'range': return `film.html#t=${round(ref.start)},${round(ref.end)}`;
    case 'subtitle': return `film.html#t=${round(ref.start)},${round(ref.end)} "${ref.text}"`;
    case 'file': return ref.path;
    default: return 'film.html';
  }
}

/** A time as people read it: 1:05, or 1:02:05 past an hour; with `decimals`, its tenths or hundredths too: 1:05.4. */
export function timeLabel(t: number, decimals = 0): string {
  const unit = 10 ** decimals;
  const all = Math.floor(Math.max(0, t) * unit + 1e-6);
  const s = Math.floor(all / unit);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`}${decimals ? `.${String(all % unit).padStart(decimals, '0')}` : ''}`;
}

/** Where a reference is on the film, s: a moment, a box's moment, a stretch's, a clip's or a line's start; a file: nowhere. */
export function timeOf(ref: StudioRef): number | null {
  switch (ref.kind) {
    case 'time': case 'region': return ref.time;
    case 'range': case 'clip': case 'subtitle': return ref.start;
    default: return null;
  }
}

/**
 * Whether two references point at the same thing (a pill in the chat and a mark here): the same kind, at the same
 * times (to the hundredth of a second), a box of the same place.
 */
export function sameRef(a: StudioRef, b: StudioRef): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) < 0.01;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'time': return b.kind === 'time' && near(a.time, b.time);
    case 'range': return b.kind === 'range' && near(a.start, b.start) && near(a.end, b.end);
    case 'region': return b.kind === 'region' && near(a.time, b.time)
      && (['x', 'y', 'w', 'h'] as const).every((key) => Math.abs(a.box[key] - b.box[key]) < 1);
    case 'file': return b.kind === 'file' && a.path === b.path;
    default: return false;
  }
}

/** A value several are told of as it changes (the time while the film plays): read with React's useSyncExternalStore. */
export interface Clock { get(): number; set(value: number): void; subscribe(listener: () => void): () => void }
export function clock(initial = 0): Clock {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => { if (next === value) return; value = next; for (const listener of [...listeners]) listener(); },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/** The part of the film the bar shows: from `from` s, `span` s of it. */
export interface View { from: number; span: number }

/** A view kept on the film: no longer than it, starting no earlier than 0 and ending no later than its end. */
export function fitted(view: View, duration: number): View {
  const span = Math.max(0, Math.min(view.span, duration));
  return { from: Math.max(0, Math.min(view.from, duration - span)), span };
}

/** The view `factor` times as long (under 1: closer), the time `at` s staying where it is on the bar; never shorter than `least` s. */
export function zoomed(view: View, at: number, factor: number, duration: number, least: number): View {
  if (!(view.span > 0)) return fitted(view, duration);
  const span = Math.max(Math.min(least, duration), Math.min(duration, view.span * factor));
  return fitted({ from: at - (at - view.from) * (span / view.span), span }, duration);
}

/**
 * How much film each picture on the strip stands for, s, when `span` s fill `width` px and a picture is `tile` px wide:
 * a frame (`frame` s) times a power of the square root of 2, the least that leaves each picture its width. The same
 * steps at every zoom, so moving along the film shows the pictures already fetched.
 */
export function tileStep(span: number, width: number, tile: number, frame: number): number {
  if (!(span > 0) || !(width > 0)) return 0;
  const want = (tile / width) * span;
  return frame * Math.SQRT2 ** Math.max(0, Math.ceil(2 * Math.log2(want / frame) - 1e-9));
}

/** The lines along the strip, every this many s: the least of the usual steps that leaves `px` px between them. */
export function tickStep(span: number, width: number, px = 64): number {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  if (!(span > 0) || !(width > 0)) return steps[steps.length - 1]!;
  return steps.find((s) => (s / span) * width >= px) ?? steps[steps.length - 1]!;
}
