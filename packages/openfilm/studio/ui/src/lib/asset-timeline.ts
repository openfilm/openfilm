/**
 * A project file dropped on the timeline: which kind of clip it becomes and where it lands.
 *
 * A web page becomes an mg clip, a video or a still a video clip, a sound an audio clip — voice, sfx or music is read
 * from its path. A track has no kind (SPEC): any of them goes on any track. Documents cannot go on the timeline.
 *
 * There is one landing rule (assetDropSpot) and both the preview and the drop ask it, so a file lands where its
 * preview was drawn. Its first rule: never stack on a clip on the same track — stacked clips spread into two rows that
 * share a badge and look broken. With an edit mode (the timeline's magnet), a file dropped onto a track goes onto it
 * whatever is there: an insert pushes it on, an overwrite cuts it out (lib/timeline-edit planRoom), and only the empty
 * space above or below the tracks opens a new one. Without one, a taken spot opens a new track, shown by a line.
 */
import { filmAudioRoleOf, filmSrcIsPage, filmSrcIsStill } from './film.ts';

import type { ResourceDragItem } from './resource-drag';
import { exactRate, frameMs, timecodeFps } from './timecode.ts';
import { trackByLane } from './timeline-clipboard.ts';
import {
  MIN_BLOCK_MS,
  newTrackSide,
  rangeOverlaps,
  type DropBand,
} from './timeline-drag.ts';
import type { EditMode } from './timeline-edit.ts';
import { renumberTracks, type TimelineBlockKind, type TimelineTrack } from './timeline-layout.ts';

export type AssetClipKind = 'mg' | 'video' | 'audio';

export function assetClipKindOf(file: { path: string; kind: string }): AssetClipKind | null {
  /* a web page (`scenes/intro.html`) is an mg clip, its src the page's path */
  if (filmSrcIsPage(file.path)) return 'mg';
  if (file.kind === 'video' || file.kind === 'image') return 'video';
  if (file.kind === 'audio') return 'audio';
  return null;
}

/**
 * How long a dropped still, or a web page without a duration, stays: four seconds, as in Final Cut (Premiere and
 * Resolve use five). The number matters less than having one: neither has a length, a drag cannot ask for one, and
 * film.html needs a length for it (`#t=0,4`). A person can pull the edge right after. (An agent writing film.html
 * gives the fragment itself.)
 */
export const STILL_DROP_MS = 4000;

/** A file with no end of its own: a still, or a page without a duration. Its clip's `time` is its length. */
function isEndless(file: { path: string; kind: string; endless?: boolean }): boolean {
  const kind = assetClipKindOf(file);
  return (kind === 'video' && filmSrcIsStill(file.path)) || (kind === 'mg' && file.endless === true);
}

/** The length a dropped clip is drawn and written with. */
export function dropDurMsOf(file: { path: string; kind: string; durationMs?: number; endless?: boolean }): number {
  if (file.durationMs && file.durationMs > 0) return Math.max(MIN_BLOCK_MS, file.durationMs);
  /* for a still this is the `time` written, so preview, placeholder and film.html share it — or the clip would change
     length once written */
  if (isEndless(file)) return STILL_DROP_MS;
  return Math.max(MIN_BLOCK_MS, 1000);
}

/**
 * The file as a film.html clip: just `src` (its kind is the track it lands on, see assetDropInsert); a still, or a page
 * without a duration, also gets `time`, which is its length, not a trim.
 */
export function assetClipElement(file: Pick<ResourceDragItem, 'path' | 'kind' | 'endless'>): Record<string, unknown> | null {
  const kind = assetClipKindOf(file);
  if (!kind) return null;
  const src = file.path;
  if (!isEndless(file)) return { src };
  return { src, time: [0, STILL_DROP_MS / 1000] };
}

/** The clip's color and row height: sounds as voice / sfx / music by path. */
export function assetBlockKindOf(file: { path: string; kind: string }): TimelineBlockKind | null {
  const kind = assetClipKindOf(file);
  if (!kind) return null;
  return kind === 'audio' ? filmAudioRoleOf(file.path) : kind;
}

/** Where the pointer is: the row index and its band; out of range is -1 / tracks.length. */
export interface AssetLaneHit {
  lane: number;
  band: DropBand;
}

/**
 * Where a drop lands — the one answer the preview and the drop share.
 *
 * `into`: onto an existing row (the time is free there, or the track is locked: refused, but the slot is still drawn
 * where the user points). `new-track`: a new track at film.html index `docAt`, its insert line drawn at the top of
 * row `laneIndex` (which may be tracks.length: at the very bottom).
 */
export type AssetDropSpot =
  | { action: 'into'; laneIndex: number; lane: string; docIndex: number | null; locked: boolean }
  | { action: 'new-track'; laneIndex: number; docAt: number };

/** The time taken on a film.html track (every row spread from it). */
function occupiedOf(
  tracks: readonly TimelineTrack[],
  docIndex: number | null,
  laneIndex: number,
): { startMs: number; endMs: number }[] {
  const rows = docIndex == null
    ? [tracks[laneIndex]].filter((tr): tr is TimelineTrack => Boolean(tr))
    : tracks.filter((tr) => tr.docIndex === docIndex);
  return rows.flatMap((tr) => tr.blocks.map((b) => ({ startMs: b.startMs, endMs: b.endMs })));
}

/** A new track at film.html index `docAt`: which row its insert line is drawn on top of. */
function newTrackSpot(tracks: readonly TimelineTrack[], docAt: number): AssetDropSpot {
  const i = tracks.findIndex((tr) => tr.docIndex != null && tr.docIndex >= docAt);
  return { action: 'new-track', laneIndex: i >= 0 ? i : tracks.length, docAt };
}

export function assetDropSpot(
  file: Pick<ResourceDragItem, 'path' | 'kind' | 'durationMs'>,
  tracks: readonly TimelineTrack[],
  hit: AssetLaneHit | null,
  atMs: number,
  /** Onto a track whatever is there (the edit makes room); without, a taken spot opens a new track. */
  edit?: EditMode,
): AssetDropSpot | null {
  if (!assetClipKindOf(file)) return null;
  const durMs = dropDurMsOf(file);
  const startMs = Math.max(0, atMs);
  const range = { startMs, endMs: startMs + durMs };
  const onFilm = tracks.filter((tr) => tr.docIndex != null);

  /* pointing at a row: any track takes any clip (SPEC), so it goes onto the row under the pointer */
  if (hit && hit.lane >= 0 && hit.lane < tracks.length) {
    const target = tracks[hit.lane]!;
    /* its top or bottom edge = a new track above / below (without an edit mode) */
    if (target.docIndex != null && hit.band !== 'body' && !edit) {
      return newTrackSpot(tracks, hit.band === 'above' ? target.docIndex : target.docIndex + 1);
    }
    if (target.locked) {
      return { action: 'into', laneIndex: hit.lane, lane: target.lane, docIndex: target.docIndex ?? null, locked: true };
    }
    if (edit || !rangeOverlaps(range, occupiedOf(tracks, target.docIndex ?? null, hit.lane))) {
      return { action: 'into', laneIndex: hit.lane, lane: target.lane, docIndex: target.docIndex ?? null, locked: false };
    }
    /* the time is taken: no stacking, a new track right under this one (newTrackSide) */
    if (target.docIndex != null) return newTrackSpot(tracks, newTrackSide(target.docIndex));
    /* a row not on film.html cannot open a track: land on it as it is */
    return { action: 'into', laneIndex: hit.lane, lane: target.lane, docIndex: null, locked: false };
  }

  /* above or below every row: a new track at the top / bottom, like dragging a clip there (moveDestFor) */
  if (hit && hit.lane < 0 && onFilm.length) return newTrackSpot(tracks, onFilm[0]!.docIndex!);
  const docEnd = onFilm.reduce((m, tr) => Math.max(m, tr.docIndex! + 1), 0);
  return { action: 'new-track', laneIndex: tracks.length, docAt: docEnd };
}

/** What the drop tells whoever writes it — folded from `assetDropSpot`, so preview and drop agree. */
export interface AssetDropTarget {
  /** Onto an existing row: its lane name. Null for a new track or without an answer. */
  lane: string | null;
  /** A new track: its film.html index. */
  insertTrackAt: number | null;
  /** Onto an existing row: what happens to what is there (an insert pushes it on, an overwrite cuts it out). */
  edit?: EditMode;
}

export function assetDropTargetOf(spot: AssetDropSpot | null, edit?: EditMode): AssetDropTarget {
  if (!spot) return { lane: null, insertTrackAt: null };
  if (spot.action === 'new-track') return { lane: null, insertTrackAt: spot.docAt };
  return { lane: spot.lane, insertTrackAt: null, ...(edit ? { edit } : {}) };
}

export type AssetDropPlan =
  | { element: Record<string, unknown>; kind: AssetClipKind; at: number; track?: number | { insert: number } }
  | { error: 'not-clip' | 'locked' };

/**
 * The insert a drop becomes. Onto an existing track: `track: index`; a new one: `track: { insert: index }`. A locked
 * target is refused — the user pointed at it, and quietly going elsewhere would confuse more than "locked". Without an
 * answer, no track is named and the insert finds one of the kind.
 */
export function assetDropInsert(
  file: Pick<ResourceDragItem, 'path' | 'kind'>,
  tracks: readonly TimelineTrack[],
  target: AssetDropTarget,
  atMs: number,
): AssetDropPlan {
  const element = assetClipElement(file);
  if (!element) return { error: 'not-clip' };
  const kind = assetClipKindOf(file)!;
  /* where it was dropped: on the frame grid, or on the edge it snapped to (the timeline decides, see its dropAt) */
  const at = Math.max(0, Math.round(atMs)) / 1000;
  if (target.insertTrackAt != null) return { element, kind, at, track: { insert: target.insertTrackAt } };
  if (!target.lane) return { element, kind, at };
  const track = trackByLane(tracks, target.lane);
  if (!track) return { element, kind, at };
  if (track.locked) return { error: 'locked' };
  if (track.docIndex == null) return { element, kind, at };
  return { element, kind, at, track: track.docIndex };
}

/** One clip of a run of dropped files: what assetDropInsert's plan says, per file, and how long it is. */
export type AssetRunInsert = { element: Record<string, unknown>; at: number; durMs: number; track?: number | { insert: number } };

/**
 * Files dropped from the computer, once imported: one after another from `atMs`, each starting on the frame after the
 * one before it ends, on one track. The landing is assetDropSpot's for the whole run, so none of them stacks on a
 * clip; the first opens a new track when it lands on one, the rest follow it there. Files that cannot be clips (a
 * document) are left out; none left is `not-clip`.
 */
export function assetRunInsert(
  files: readonly Pick<ResourceDragItem, 'path' | 'kind' | 'durationMs' | 'endless'>[],
  tracks: readonly TimelineTrack[],
  hit: AssetLaneHit | null,
  atMs: number,
  edit?: EditMode,
): { inserts: AssetRunInsert[] } | { error: 'not-clip' | 'locked' } {
  const usable = files.filter((f) => assetClipElement(f));
  if (!usable.length) return { error: 'not-clip' };
  const lengths = usable.map(dropDurMsOf);
  const whole = { path: usable[0]!.path, kind: usable[0]!.kind, durationMs: lengths.reduce((a, b) => a + b, 0) + lengths.length * frameMs(1) };
  const first = assetDropInsert(usable[0]!, tracks, assetDropTargetOf(assetDropSpot(whole, tracks, hit, atMs, edit)), atMs);
  if ('error' in first) return first;
  /* after the first: the track it went onto (a new one is at the index it was opened at) */
  const then = typeof first.track === 'object' ? first.track.insert : first.track;
  const inserts: AssetRunInsert[] = [];
  let startMs = Math.max(0, Math.round(atMs));
  usable.forEach((file, i) => {
    const track = i === 0 ? first.track : then;
    inserts.push({ element: assetClipElement(file)!, at: Math.round(startMs) / 1000, durMs: lengths[i]!, ...(track != null ? { track } : {}) });
    /* the next one on the first whole frame past this one's end: rounded to the nearest, it could start inside it */
    startMs = frameMs(Math.ceil(((startMs + lengths[i]!) * exactRate(timecodeFps())) / 1000 - 1e-6));
  });
  return { inserts };
}

/**
 * Where a sound dropped on the picture goes: the first sound track free from `atMs` for `durMs`, else a new track
 * below every other (as a lane hit for assetDropSpot / assetRunInsert).
 */
export function soundLaneHit(tracks: readonly TimelineTrack[], atMs: number, durMs: number): AssetLaneHit {
  const range = { startMs: Math.max(0, atMs), endMs: Math.max(0, atMs) + durMs };
  const free = tracks.findIndex((tr, i) => tr.role === 'audio' && tr.docIndex != null && !tr.locked
    && !rangeOverlaps(range, occupiedOf(tracks, tr.docIndex, i)));
  return { lane: free >= 0 ? free : tracks.length, band: 'body' };
}

/** The length a run of dropped files is drawn and written with, end to end. */
export function assetRunMs(files: readonly Pick<ResourceDragItem, 'path' | 'kind' | 'durationMs' | 'endless'>[]): number {
  return files.reduce((sum, f) => sum + (assetClipElement(f) ? dropDurMsOf(f) : 0), 0);
}

/**
 * What a drop will look like, for the preview while dragging; the landing is assetDropSpot's. Onto a row: a
 * see-through slot; a new track: only the line between tracks (a slot on the neighbor would look stacked). `atMs` is
 * already snapped. The length is the file's own, else a placeholder; the real length comes once it is written.
 */
export type AssetDropPreview = {
  kind: AssetClipKind;
  blockKind: TimelineBlockKind;
  title: string;
  startMs: number;
  endMs: number;
  /** The row the slot is on; for a new track, where the line is (may be `tracks.length`). */
  laneIndex: number;
  newTrack: boolean;
  /** A new track's film.html index (the drop uses the same answer); null onto an existing row. */
  docAt: number | null;
  /** The row's lane name; null for a new track. */
  lane: string | null;
  error: 'locked' | null;
};

export function assetDropPreview(
  file: Pick<ResourceDragItem, 'path' | 'kind' | 'name' | 'durationMs'>,
  tracks: readonly TimelineTrack[],
  hit: AssetLaneHit | null,
  atMs: number,
  edit?: EditMode,
): AssetDropPreview | null {
  const spot = assetDropSpot(file, tracks, hit, atMs, edit);
  const kind = assetClipKindOf(file);
  const blockKind = assetBlockKindOf(file);
  if (!spot || !kind || !blockKind) return null;
  const durMs = dropDurMsOf(file);
  const startMs = Math.max(0, atMs);
  const base = { kind, blockKind, title: clipTitleOf(file), startMs, endMs: startMs + durMs };
  if (spot.action === 'new-track') {
    return { ...base, laneIndex: spot.laneIndex, newTrack: true, docAt: spot.docAt, lane: null, error: null };
  }
  return {
    ...base,
    laneIndex: spot.laneIndex,
    newTrack: false,
    docAt: null,
    lane: spot.lane,
    error: spot.locked ? 'locked' : null,
  };
}

/** The clip's name, as the timeline names evaluated clips: an MG without its extension, the rest with it. */
function clipTitleOf(file: Pick<ResourceDragItem, 'name' | 'path' | 'kind'>): string {
  const base = file.name || file.path.split('/').pop() || file.path;
  if (assetClipKindOf(file) !== 'mg') return base;
  return base.replace(/\.[a-z0-9]{1,5}$/i, '') || base;
}

/**
 * A dropped clip not written yet. Writing it and evaluating the film again takes from a few hundred ms to seconds;
 * with nothing on the timeline meanwhile people think the drop missed and drop again. So it is drawn at once,
 * see-through, until the real clip arrives. Everything needed to draw it is known at drop time.
 */
export interface PendingDrop {
  id: string;
  blockKind: TimelineBlockKind;
  title: string;
  /** film.html's src: the real clip is recognized by it (see withPendingBlocks). */
  src: string;
  startMs: number;
  endMs: number;
  /** Onto an existing row: its lane name. */
  lane: string | null;
  /** A new track: its film.html index. */
  insertTrackAt: number | null;
}

/** How the clip is drawn from the moment it is dropped. */
export function pendingDropOf(
  file: Pick<ResourceDragItem, 'path' | 'kind' | 'name' | 'durationMs'>,
  target: AssetDropTarget,
  atMs: number,
): PendingDrop | null {
  const element = assetClipElement(file);
  const blockKind = assetBlockKindOf(file);
  if (!element || !blockKind || typeof element.src !== 'string') return null;
  /* the same start as the write (assetDropInsert's `at` is this / 1000), so the real clip is recognized */
  const startMs = Math.max(0, Math.round(atMs));
  const durMs = dropDurMsOf(file);
  return {
    id: `pending:${element.src}@${startMs}`,
    blockKind,
    title: clipTitleOf(file),
    src: element.src,
    startMs,
    endMs: startMs + durMs,
    lane: target.lane,
    insertTrackAt: target.insertTrackAt,
  };
}

/**
 * The drops not written yet, laid onto the timeline. A drop steps aside by itself once a clip of the same src overlaps
 * it — not by timing its removal, which shows one clip turning into two and back.
 */
export function withPendingBlocks(
  tracks: readonly TimelineTrack[],
  drops: readonly PendingDrop[],
): TimelineTrack[] {
  /* recognized by "same file, overlapping time", not an exact start: the placeholder's length is a guess (a new file
     is not probed yet) and the written start may be rounded by a millisecond. Too strict, and the placeholder stays
     next to the real clip until the write returns. */
  const live = drops.filter((d) => !tracks.some(
    (tr) => tr.blocks.some((b) => b.src === d.src && b.startMs < d.endMs && b.endMs > d.startMs),
  ));
  if (!live.length) return [...tracks];

  const out = tracks.map((tr) => ({ ...tr, blocks: [...tr.blocks] }));
  let opened = false;
  for (const drop of live) {
    const block = {
      id: drop.id,
      title: drop.title,
      startMs: drop.startMs,
      endMs: drop.endMs,
      kind: drop.blockKind,
      src: drop.src,
      /* see-through: not written yet. No `loc`: it cannot be selected or dragged, there is nowhere to write an edit */
      off: true,
    };
    const into = drop.lane != null ? out.findIndex((tr) => tr.lane === drop.lane) : -1;
    if (into >= 0) {
      const row = out[into]!;
      row.blocks = [...row.blocks, block].sort((a, b) => a.startMs - b.startMs);
      continue;
    }
    const kind = laneKindForHint(drop.blockKind);
    const role = kind === 'audio' ? 'audio' : drop.blockKind === 'mg' ? 'mg' : 'video';
    /*
     * The new track may already be on film.html, still empty: film.html changes at once, the evaluation catches up
     * later, and layoutTracks has drawn an empty row for it. Adding another row here would draw the track twice.
     *
     * Matched by index, kind and emptiness together: the insert shifted every track after it, so in the not yet
     * updated projection the same index may be another track — putting a video into the MG row. Without such a row,
     * a new row (a brief double track beats a clip on the wrong row).
     */
    const settled = drop.insertTrackAt != null
      ? out.findIndex((tr) => tr.docIndex === drop.insertTrackAt
        && tr.kind === kind
        && !tr.blocks.length
        && (kind === 'audio' || tr.role === role))
      : -1;
    if (settled >= 0) {
      const row = out[settled]!;
      row.blocks = [block];
      continue;
    }
    const at = drop.insertTrackAt != null
      ? out.findIndex((tr) => tr.docIndex != null && tr.docIndex >= drop.insertTrackAt!)
      : -1;
    out.splice(at >= 0 ? at : out.length, 0, {
      lane: drop.id,
      role,
      index: 0,
      name: null,
      kind,
      blocks: [block],
    });
    opened = true;
  }
  /* rows not on film.html have no badge from layoutTracks; give them one now rather than a blank head */
  return opened ? renumberTracks(out) : out;
}

/** The kind of row a clip kind goes on. */
function laneKindForHint(kind: TimelineBlockKind): 'visual' | 'audio' {
  return kind === 'voice' || kind === 'sfx' || kind === 'music' ? 'audio' : 'visual';
}
