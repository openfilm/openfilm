/**
 * A clip's speed, as Studio sets it: by dragging its edges on the timeline (the clip toolbar's Speed button turns a
 * clip's edge handles into speed handles), or on the inspector's slider. The clip keeps the part of its source it
 * plays, so what changes is its length on the film, and its speed is that source over the new length.
 *
 * Written as the clip's `speed` (SPEC §1: SPEED_MIN to SPEED_MAX, 0.1× to 100×, its sound keeping its pitch), with
 * the edits a speed typed in the inspector makes (lib/timeline-edit planSpeed): one write, one undo step.
 *
 * Pure: the timeline and the inspector show the speed while the hand is on it, and write it on release.
 */
import { SPEED_MAX, SPEED_MIN, isStill } from '../../../../src/film-doc.mjs';
import { snapToFrame } from './timecode.ts';

/** A clip as a speed drag sees it: its place on the film and its speed now. */
export interface SpeedClip { startMs: number; endMs: number; speed?: number }

/** Whether a clip has a speed to change: a video or a sound with a part of its source on the film (not a still, not a page). */
export function canChangeSpeed(block: { kind: string; src?: string; anchor?: { trimFrom?: number; still?: boolean } }): boolean {
  return (block.kind === 'video' || block.kind === 'voice' || block.kind === 'music' || block.kind === 'sfx')
    && block.anchor?.trimFrom != null && !block.anchor.still && !(block.src && isStill(block.src));
}

/**
 * The source the clip plays, in source ms: what stays while its speed changes. Whole ms, as film.html writes it: the
 * clip's length on the film is rounded, and times its speed it misses the source by a little.
 */
const sourceMsOf = (clip: SpeedClip): number => Math.round((clip.endMs - clip.startMs) * (clip.speed && clip.speed > 0 ? clip.speed : 1));

/** How much longer the clip can get at that edge before it is at the slowest speed (film ms; 0 when it is already). */
export function speedRoomMs(clip: SpeedClip): number {
  return Math.max(0, sourceMsOf(clip) / SPEED_MIN - (clip.endMs - clip.startMs));
}

/** A speed as people set it: three figures (`0.125×`, `1.6×`, `37.5×`), as fine at 0.1× as at 100×. */
export function roundSpeed(speed: number): number {
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number(speed.toPrecision(3))));
}

/** A speed typed in: as typed, to the ten-thousandth (`12.34×`), inside the speeds a clip can have. */
export function exactSpeed(speed: number): number {
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(speed * 1e4) / 1e4));
}

/**
 * The speed for the clip at `lengthMs` on the film, inside the speeds a clip can have. Let go anywhere it is a round
 * one (roundSpeed: `1.6×`); `exact`, when the edge snapped to something, the speed that lands it there, a hair faster
 * rather than slower so it never runs past what it snapped to.
 */
export function speedForLength(clip: SpeedClip, lengthMs: number, exact = false): number {
  if (!(lengthMs > 0)) return SPEED_MAX;
  const raw = sourceMsOf(clip) / lengthMs;
  return exact ? Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.ceil(raw * 1e4 - 1e-6) / 1e4)) : roundSpeed(raw);
}

/** The speed a clip `lengthMs` long on the film plays at `speed`: how long it lasts then (ms). */
export function lengthAtSpeed(clip: SpeedClip, speed: number): number {
  return sourceMsOf(clip) / speed;
}

/* ── the slider ── */

/** The speeds marked under the inspector's slider. */
export const SPEED_STOPS: readonly number[] = [0.1, 1, 2, 5, 10, 100].filter((s) => s >= SPEED_MIN && s <= SPEED_MAX);

const LOG_MIN = Math.log10(SPEED_MIN);
const LOG_SPAN = Math.log10(SPEED_MAX) - LOG_MIN;

/** Where a speed sits along the slider, 0 to 1: on a log scale, so 0.1× to 1× takes as much room as 10× to 100×. */
export function speedPosition(speed: number): number {
  return Math.min(1, Math.max(0, (Math.log10(speed) - LOG_MIN) / LOG_SPAN));
}

/**
 * The speed at a place along the slider (0 to 1): a stop when it is within `snap` of one (the hand finds 1× and 2×
 * by feel), else a round one.
 */
export function speedAtPosition(pos: number, snap = 0.012): number {
  const p = Math.min(1, Math.max(0, pos));
  const stop = SPEED_STOPS.find((s) => Math.abs(speedPosition(s) - p) <= snap);
  return stop ?? roundSpeed(10 ** (LOG_MIN + p * LOG_SPAN));
}

/**
 * Which edge a speed handle's drag moves, and by how much: its own, but rippling (the main track with the magnet) the
 * start stays and what follows moves, as a magnet's trim of the head: the start knob then moves the end the other way,
 * left longer, right shorter.
 */
export function speedDragEdge(edge: 'start' | 'end', ripple: boolean, deltaMs: number): { edge: 'start' | 'end'; deltaMs: number } {
  return edge === 'start' && ripple ? { edge: 'end', deltaMs: -deltaMs } : { edge, deltaMs };
}

/**
 * Whether the edge stopped away from the hand (`handMs`, where the hand puts it): a neighbor, the film's start, a snap.
 * A free edge only goes to the nearest frame, and that is not held, however many pixels a frame is zoomed in.
 */
export function edgeHeld(edgeMs: number, handMs: number): boolean {
  return Math.abs(edgeMs - snapToFrame(handMs)) >= 0.5;
}

/**
 * Where a key moves the slider from `pos` (0 to 1): the arrows a step of the scale (⇧ five), Page Up / Down a tenth of
 * it, Home and End its ends. Null for any other key.
 */
export function sliderKeyPosition(key: string, pos: number, shift = false): number | null {
  const step = shift ? 0.05 : 0.01;
  switch (key) {
    case 'ArrowRight': case 'ArrowUp': return Math.min(1, pos + step);
    case 'ArrowLeft': case 'ArrowDown': return Math.max(0, pos - step);
    case 'PageUp': return Math.min(1, pos + 0.1);
    case 'PageDown': return Math.max(0, pos - 0.1);
    case 'Home': return 0;
    case 'End': return 1;
    default: return null;
  }
}
