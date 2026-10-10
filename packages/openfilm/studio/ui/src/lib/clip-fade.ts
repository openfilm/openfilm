/**
 * A clip's fades on the timeline: the handles at its top corners, dragged inward, and the ramp drawn over it.
 *
 * A fade is kept in film.html as the clip's own entry of its `overrides` (`{ "fade": [in, out] }`, seconds; see
 * SPEC §1): the timeline writes it with the `fade` prop (studio/server/ops.mjs), one edit for the clip and the clips
 * linked to it, so a picture and the sound taken off it fade together.
 *
 * Pure: the timeline draws a drag's fade from here while the hand is still on the handle, and writes it on release.
 */
import type { Op } from '../api.ts';
import { clipFade } from '../../../../src/film-doc.mjs';

/** In and out, in ms. */
export type FadeMs = readonly [number, number];
export type FadeEdge = 'in' | 'out';

/** A clip's fades in ms (`[0, 0]` without any), from its film.html row. */
export function fadeMsOf(clip: { overrides?: readonly unknown[] } | null | undefined): FadeMs {
  const fade = clipFade(clip);
  return fade ? [Math.round(fade[0] * 1000), Math.round(fade[1] * 1000)] : [0, 0];
}

/**
 * The fade a handle dragged to `pointerMs` sets on a clip over `[startMs, endMs)`: from its start (in) or back from
 * its end (out), on the frame grid (`frameMs` a frame), never past where the other fade begins, never below 0.
 */
export function fadeFromPointer(edge: FadeEdge, pointerMs: number, clip: { startMs: number; endMs: number }, other: number, frameMs: number): number {
  const room = Math.max(0, clip.endMs - clip.startMs - other);
  const raw = edge === 'in' ? pointerMs - clip.startMs : clip.endMs - pointerMs;
  const snapped = frameMs > 0 ? Math.round(raw / frameMs) * frameMs : raw;
  /* a whole frame less when the frame nearest does not fit, so it stays on the grid */
  const fit = snapped > room && frameMs > 0 ? Math.floor(room / frameMs) * frameMs : snapped;
  /* to the microsecond: frames of 33.33… ms gather float noise */
  return Math.round(Math.max(0, Math.min(room, fit)) * 1000) / 1000;
}

/** Where a fade's handle sits in a clip `widthPx` wide: px from its left edge. */
export function fadeHandleX(edge: FadeEdge, fadeMs: number, widthPx: number, pxPerMs: number): number {
  const px = Math.min(widthPx, fadeMs * pxPerMs);
  return edge === 'in' ? px : widthPx - px;
}

/** A clip as a fade edit sees it. */
export interface FadeClip { id: string; startMs: number; endMs: number; fade: FadeMs; locked?: boolean }

/**
 * One fade set on a clip and on the clips going with it (`with`: those linked to it, unless ⌥), each that has the same
 * edge within `tolMs` of the clip's: a picture and its sound end together, so they fade together. Fitted to each one's
 * length; none on a locked track. The edits film.html takes, by clip id.
 */
export function fadeEdits(edge: FadeEdge, ms: number, clip: FadeClip, others: readonly FadeClip[] = [], tolMs = 1): { clip: string; prop: 'fade'; value: [number, number] }[] {
  const at = (c: FadeClip) => (edge === 'in' ? c.startMs : c.endMs);
  const all = [clip, ...others.filter((c) => c.id !== clip.id && Math.abs(at(c) - at(clip)) <= tolMs)];
  return all.filter((c) => !c.locked).flatMap((c) => {
    const len = c.endMs - c.startMs;
    const other = edge === 'in' ? c.fade[1] : c.fade[0];
    const own = Math.max(0, Math.min(ms, len - other));
    const next: [number, number] = edge === 'in' ? [own, c.fade[1]] : [c.fade[0], own];
    if (Math.round(next[0]) === Math.round(c.fade[0]) && Math.round(next[1]) === Math.round(c.fade[1])) return [];
    return [{ clip: c.id, prop: 'fade' as const, value: [secs(next[0]), secs(next[1])] }];
  });
}

/** The edit of fades as an operation (one write, one undo step); null when nothing changes. */
export function fadeOp(edits: ReturnType<typeof fadeEdits>): Op | null {
  return edits.length ? { op: 'props', edits } : null;
}

/** ms → seconds to the millisecond, as film.html keeps them. */
export const secs = (ms: number): number => Math.round(ms) / 1000;
