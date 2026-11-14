/**
 * What the screening room works out from the film, apart from drawing it: the lines of a caption track, a reference as
 * a link for an agent outside the app, a time as people read it, and what changed between two versions of the film.
 */
import type { Clip, Film } from '@/api';
import type { ClipSpan } from '@/lib/film-shape';
import type { StudioRef } from '@/lib/host';

/** A line of a caption track: its span on the film (s), its words, and its number in the file (from 1). */
export interface Cue { start: number; end: number; text: string; index: number }

/** A stretch of the film, s. */
export interface Range { start: number; end: number }

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
    const words = lines.slice(at + 1).join(' ').replace(/<[^>]*>/g, '').trim();
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
    case 'region': return `film.html#t=${round(ref.time)} (x ${ref.box.x}, y ${ref.box.y}, ${ref.box.w}×${ref.box.h})`;
    case 'range': return `film.html#t=${round(ref.start)},${round(ref.end)}`;
    case 'subtitle': return `film.html#t=${round(ref.start)},${round(ref.end)} "${ref.text}"`;
    case 'file': return ref.path;
    default: return 'film.html';
  }
}

/** A time as people read it: 1:05, or 1:02:05 past an hour. */
export function timeLabel(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

/** Every clip of a film by its id. */
const clipsOf = (film: Film | null): Map<string, Clip> => new Map((film?.tracks ?? []).flatMap((t) => t.clips.map((c) => [c.id, c] as const)));

/**
 * Where the film changed from `before` to `after`: each clip added, taken out or changed (by its id), where it plays
 * now (a clip taken out: where the clip after it starts, a moment), joined where they touch, in order. `spans`: where
 * `after`'s clips play. Nothing when there was no film before.
 */
export function changedRanges(before: Film | null, after: Film | null, spans: readonly ClipSpan[]): Range[] {
  if (!before || !after || before === after) return [];
  const was = clipsOf(before), now = clipsOf(after);
  const placed = new Map(spans.map((s) => [s.id, s]));
  const out: Range[] = [];
  for (const [id, clip] of now) {
    const old = was.get(id);
    if (old && JSON.stringify(old) === JSON.stringify(clip)) continue;
    const span = placed.get(id);
    if (span) out.push({ start: span.at, end: span.end });
  }
  /* a clip taken out leaves a moment where it was: its own start if it had one written, else nothing to show */
  for (const [id, clip] of was) {
    if (now.has(id)) continue;
    const at = clip.at ?? null;
    if (at != null) out.push({ start: at, end: at + 0.5 });
  }
  out.sort((a, b) => a.start - b.start);
  const joined: Range[] = [];
  for (const r of out) {
    const last = joined[joined.length - 1];
    if (last && r.start <= last.end + 0.05) last.end = Math.max(last.end, r.end);
    else joined.push({ ...r });
  }
  return joined;
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

/** The ruler's marks for a film `duration` s long: a step that gives about `count` of them, and each mark's time. */
export function ticksOf(duration: number, count = 10): { step: number; marks: number[] } {
  if (!(duration > 0)) return { step: 1, marks: [] };
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  const step = steps.find((s) => duration / s <= count) ?? steps[steps.length - 1]!;
  const marks: number[] = [];
  for (let t = 0; t <= duration + 1e-6; t += step) marks.push(t);
  return { step, marks };
}

/** The part of a sound file's peaks a clip plays: from its in point (`time[0]`, s) for `seconds` of it at `speed`. */
export function peaksOfClip(peaks: readonly number[], fileSeconds: number, inPoint: number, seconds: number, speed = 1): number[] {
  if (!peaks.length || !(fileSeconds > 0)) return [];
  const a = Math.max(0, Math.floor((inPoint / fileSeconds) * peaks.length));
  const b = Math.min(peaks.length, Math.ceil(((inPoint + seconds * speed) / fileSeconds) * peaks.length));
  return peaks.slice(a, Math.max(a + 1, b));
}
