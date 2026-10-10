/**
 * A file from the media pane put on the timeline without dragging it: its "+" button and Enter (in the timeline's edit
 * mode), and `,` / `.` from the source viewer (insert / overwrite, as Premiere's keys). The part of the file marked in
 * the source viewer (I and O there), else all of it, as one clip — a video carries its own sound.
 *
 * Where it goes: at the playhead on the targeted track (the track last clicked on the timeline), or without one at
 * the end of the main track: the bottom picture track (V1) for a picture, a sound track for a sound (the first with
 * room, else a new one under the others).
 */
import type { Op } from '../api.ts';
import { assetClipElement, assetClipKindOf, dropDurMsOf } from './asset-timeline.ts';
import type { ResourceDragItem } from './resource-drag';
import { planRoom, soundTrackFor, TOUCH_MS, type EditMode, type EditModel, type TrackDest } from './timeline-edit.ts';
import { snapToFrame } from './timecode.ts';

export type PlaceFile = Pick<ResourceDragItem, 'path' | 'kind' | 'durationMs' | 'endless'>;

/** A part of the file, in its own ms (the source viewer's in and out). */
export type SourceRange = { inMs: number; outMs: number };

export interface PlaceSpec {
  file: PlaceFile;
  range?: SourceRange | null;
  /** The targeted track (film.html index), or null for the main one. */
  target: number | null;
  /** Where: the playhead (ms), or `end`, after the last clip of the track it goes on. */
  at: number | 'end';
  mode: EditMode;
  sync: boolean;
}

export type PlacePlan = { ops: Op[]; track: TrackDest; startMs: number; durMs: number } | { error: 'not-clip' | 'locked' };

const isSoundTrack = (role: string | undefined) => role === 'audio';

/** The clip as film.html takes it: the file, trimmed to the part marked (a still keeps its length). */
function elementOf(file: PlaceFile, range: SourceRange | null | undefined): { element: Record<string, unknown>; durMs: number } | null {
  const element = assetClipElement(file);
  if (!element) return null;
  const still = Array.isArray(element.time);
  if (range && range.outMs > range.inMs && !(still && assetClipKindOf(file) === 'video')) {
    return { element: { ...element, time: [Math.round(range.inMs) / 1000, Math.round(range.outMs) / 1000] }, durMs: Math.round(range.outMs) - Math.round(range.inMs) };
  }
  return { element, durMs: dropDurMsOf(file) };
}

export function placeMedia(model: EditModel, spec: PlaceSpec): PlacePlan {
  const kind = assetClipKindOf(spec.file);
  const made = kind ? elementOf(spec.file, spec.range) : null;
  if (!kind || !made) return { error: 'not-clip' };
  const sound = kind === 'audio';
  const fits = (role: string | undefined) => (sound ? isSoundTrack(role) : !isSoundTrack(role));
  const targeted = spec.target != null ? model.find((t) => t.index === spec.target) : undefined;
  /* a targeted track of the other family (a sound aimed at a picture track) is passed over for the usual one */
  if (targeted && fits(targeted.role) && targeted.locked) return { error: 'locked' };
  const endOf = (index: number) => Math.max(0, ...(model.find((t) => t.index === index)?.clips ?? []).map((c) => c.endMs));
  let track: TrackDest;
  /* a sound track picked for having room: nothing there to push on or cut */
  let roomy = false;
  if (targeted && fits(targeted.role)) {
    track = targeted.index;
  } else if (sound) {
    const sounds = model.filter((t) => isSoundTrack(t.role) && !t.locked);
    if (spec.at === 'end' && sounds.length) {
      /* at the end of a sound track: the first with any sound, or the first */
      track = (sounds.find((t) => t.clips.length) ?? sounds[0]!).index;
    } else {
      const from = spec.at === 'end' ? 0 : snapToFrame(spec.at);
      track = soundTrackFor(model, { startMs: from, endMs: from + made.durMs }, -1);
      roomy = true;
    }
  } else {
    /* the main track: the lowest picture track (V1), film.html's last picture track */
    const pictures = model.filter((t) => !isSoundTrack(t.role));
    const main = pictures.at(-1);
    if (main?.locked) return { error: 'locked' };
    track = main ? main.index : { insert: 0 };
  }
  const startMs = spec.at === 'end' ? (typeof track === 'number' ? endOf(track) : 0) : Math.max(0, snapToFrame(spec.at));
  const insert: Op = { op: 'insert', clip: made.element as never, at: Math.round(startMs) / 1000, track };
  if (typeof track !== 'number') return { ops: [insert], track, startMs, durMs: made.durMs };
  /* at the very end nothing follows: no room to make */
  const after = (model.find((t) => t.index === track)?.clips ?? []).some((c) => c.endMs > startMs + TOUCH_MS);
  const room = after && !roomy ? planRoom(model, [{ track, startMs, endMs: startMs + made.durMs }], { mode: spec.mode, sync: spec.sync }).ops : [];
  return { ops: [insert, ...room], track, startMs, durMs: made.durMs };
}
