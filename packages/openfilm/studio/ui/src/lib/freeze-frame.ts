/**
 * Freeze frame: the frame of a video clip under the playhead, made a still (studio/server/files.mjs freezeFrame) and
 * put in at the playhead on the clip's track, in the timeline's edit mode: with the magnet the video is cut there and
 * what follows moves on by the still's length (with sync lock, on every unlocked track); without it the still covers
 * that much of the video after the playhead. The still looks as the video does (its box, class and style).
 */
import type { Clip, Op } from '../api.ts';
import { planRoom, type EditMode, type EditModel } from './timeline-edit.ts';
import { snapToFrame } from './timecode.ts';
import type { TimelineBlock } from './timeline-layout';

/** How long a freeze frame lasts. */
export const FREEZE_MS = 2000;

/** The moment of the clip's file the playhead is on (ms), or null when the playhead is not on the clip. */
export function freezeSourceMs(block: Pick<TimelineBlock, 'startMs' | 'endMs' | 'inMs' | 'speed'>, atMs: number): number | null {
  if (!(atMs >= block.startMs && atMs < block.endMs)) return null;
  return Math.round((block.inMs ?? 0) + (atMs - block.startMs) * (block.speed ?? 1));
}

export interface FreezeSpec {
  /** The video clip, as film.html has it. */
  clip: Clip;
  /** Its track (film.html index). */
  track: number;
  /** The playhead. */
  atMs: number;
  /** The still made of its frame (a project path). */
  still: string;
  mode: EditMode;
  sync: boolean;
  durMs?: number;
}

/** The edit: the still in at the playhead, and room made for it. Null when the track is locked. */
export function planFreeze(model: EditModel, spec: FreezeSpec): Op[] | null {
  if (model.find((t) => t.index === spec.track)?.locked) return null;
  const startMs = Math.max(0, snapToFrame(spec.atMs));
  const durMs = spec.durMs ?? FREEZE_MS;
  const { box, class: cls, style } = spec.clip;
  const still: Partial<Clip> & { src: string } = {
    src: spec.still,
    time: [0, durMs / 1000],
    ...(box ? { box } : {}),
    ...(cls ? { class: cls } : {}),
    ...(style ? { style } : {}),
  };
  const room = planRoom(model, [{ track: spec.track, startMs, endMs: startMs + durMs }], { mode: spec.mode, sync: spec.sync });
  return [{ op: 'insert', clip: still, at: Math.round(startMs) / 1000, track: spec.track }, ...room.ops];
}
