/**
 * A file from the media pane put on the timeline without dragging it: its "+" button and Enter, and `,` / `.` from the
 * source viewer (insert / overwrite). The part of the file marked in the source viewer (I and O
 * there), else all of it, as one clip — a video carries its own sound.
 *
 * Where it goes: at the playhead on the targeted track (the track last clicked on the timeline), or without one at
 * the end of the main track (V1) for a picture, of a sound track for a sound (the first with room, else a new one
 * under the others). How, without `,` / `.`: on the main track with the magnet it goes in between at the playhead (as a
 * clip dragged there does); anywhere else it is put down, never cutting what is there — a taken spot opens a track
 * beside it.
 */
import type { Op } from '../api.ts';
import { assetClipElement, assetClipKindOf, dropDurMsOf, type StageSize } from './asset-timeline.ts';
import type { ResourceDragItem } from './resource-drag';
import { newTrackSide } from './timeline-drag.ts';
import { insertPointOn, magnetOn, planRoom, soundTrackFor, TOUCH_MS, type EditMode, type EditModel, type Switches, type TrackDest } from './timeline-edit.ts';
import { snapToFrame } from './timecode.ts';

export type PlaceFile = Pick<ResourceDragItem, 'path' | 'kind' | 'durationMs' | 'endless' | 'reflows' | 'w' | 'h'>;

/** A part of the file, in its own ms (the source viewer's in and out). */
export type SourceRange = { inMs: number; outMs: number };

export interface PlaceSpec extends Partial<Switches> {
  file: PlaceFile;
  range?: SourceRange | null;
  /** The targeted track (film.html index), or null for the lowest picture track. */
  target: number | null;
  /** Where: the playhead (ms), or `end`, after the last clip of the track it goes on. */
  at: number | 'end';
  /** Insert or overwrite, asked for (the source viewer's keys); not given, as the timeline's switches say. */
  mode?: EditMode;
  /** The canvas: a picture of another shape gets a box in its own (asset-timeline assetFitBox). */
  stage?: StageSize | null;
}

export type PlacePlan = { ops: Op[]; track: TrackDest; startMs: number; durMs: number } | { error: 'not-clip' | 'locked' };

const isSoundTrack = (role: string | undefined) => role === 'audio';

/** The clip as film.html takes it: the file, trimmed to the part marked (a still keeps its length). */
function elementOf(file: PlaceFile, range: SourceRange | null | undefined, stage: StageSize | null | undefined): { element: Record<string, unknown>; durMs: number } | null {
  const element = assetClipElement(file, stage);
  if (!element) return null;
  const still = Array.isArray(element.time);
  if (range && range.outMs > range.inMs && !(still && assetClipKindOf(file) === 'video')) {
    return { element: { ...element, time: [Math.round(range.inMs) / 1000, Math.round(range.outMs) / 1000] }, durMs: Math.round(range.outMs) - Math.round(range.inMs) };
  }
  return { element, durMs: dropDurMsOf(file) };
}

export function placeMedia(model: EditModel, spec: PlaceSpec): PlacePlan {
  const kind = assetClipKindOf(spec.file);
  const made = kind ? elementOf(spec.file, spec.range, spec.stage) : null;
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
    const lowest = pictures.at(-1);
    if (lowest?.locked) return { error: 'locked' };
    track = lowest ? lowest.index : { insert: 0 };
  }
  let startMs = spec.at === 'end' ? (typeof track === 'number' ? endOf(track) : 0) : Math.max(0, snapToFrame(spec.at));
  if (typeof track !== 'number') return { ops: [{ op: 'insert', clip: made.element as never, at: Math.round(startMs) / 1000, track }], track, startMs, durMs: made.durMs };
  const switches = { magnet: Boolean(spec.magnet), linkage: Boolean(spec.linkage) };
  /* on the main track with the magnet: in between, where the playhead is (before or after the clip under it) */
  const mode: EditMode | 'place' = spec.mode ?? (magnetOn(model, track, switches.magnet) ? 'insert' : 'place');
  if (!spec.mode && mode === 'insert') startMs = insertPointOn(model, track, startMs, startMs);
  const clips = model.find((t) => t.index === track)?.clips ?? [];
  if (mode === 'place' && clips.some((c) => c.startMs < startMs + made.durMs - TOUCH_MS && c.endMs > startMs + TOUCH_MS)) {
    /* the time is taken: a new track beside, nothing cut */
    const role = model.find((t) => t.index === track)?.role;
    const beside: TrackDest = { insert: newTrackSide(track, role) };
    return { ops: [{ op: 'insert', clip: made.element as never, at: Math.round(startMs) / 1000, track: beside }], track: beside, startMs, durMs: made.durMs };
  }
  const insert: Op = { op: 'insert', clip: made.element as never, at: Math.round(startMs) / 1000, track };
  /* at the very end nothing follows: no room to make */
  const after = clips.some((c) => c.endMs > startMs + TOUCH_MS);
  const room = after && !roomy && mode !== 'place' ? planRoom(model, [{ track, startMs, endMs: startMs + made.durMs }], { mode, ...switches }).ops : [];
  return { ops: [insert, ...room], track, startMs, durMs: made.durMs };
}
