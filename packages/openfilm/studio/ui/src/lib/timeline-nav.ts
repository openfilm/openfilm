/**
 * What the editor's keys act on, worked out from the timeline as it is drawn: the cuts ↑ / ↓ jump between, the clips
 * ⌘B and ⇧⌘B split, and a selection moved a frame with ⌥ ← / →. Pure: the keys call these, the edits are written by
 * the editor (components/ProjectView).
 */
import { MIN_BLOCK_MS } from './timeline-drag.ts';
import { planEdges, planMove, type EditMode, type EditModel, type EditPlan } from './timeline-edit.ts';
import { stepFrames } from './timecode.ts';
import type { TimelineBlock, TimelineTrack } from './timeline-layout';

/**
 * Every clip edge on the tracks that can be cut (not locked) and are seen (not hidden), in order, once each: what
 * ↑ / ↓ go to. Clips not on film.html yet (a drop being written) are left out.
 */
export function cutPoints(tracks: readonly TimelineTrack[]): number[] {
  const out = new Set<number>();
  for (const tr of tracks) {
    if (tr.locked || tr.hidden) continue;
    for (const b of tr.blocks) {
      if (!b.loc) continue;
      out.add(Math.round(b.startMs));
      out.add(Math.round(b.endMs));
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** The next cut after `nowMs` (`dir` 1), or the one before it (-1); null when there is none that way. */
export function nextCut(points: readonly number[], nowMs: number, dir: 1 | -1): number | null {
  /* within a millisecond is where the playhead already is */
  if (dir > 0) return points.find((p) => p > nowMs + 1) ?? null;
  for (let i = points.length - 1; i >= 0; i--) if (points[i]! < nowMs - 1) return points[i]!;
  return null;
}

/** Whether a cut at `atMs` falls inside a clip, far enough from both its ends (the split button's own rule). */
export function splitsAt(b: Pick<TimelineBlock, 'startMs' | 'endMs'>, atMs: number): boolean {
  return atMs > b.startMs + MIN_BLOCK_MS && atMs < b.endMs - MIN_BLOCK_MS;
}

const lockedRows = (tracks: readonly TimelineTrack[]) => new Set(tracks.filter((tr) => tr.locked).flatMap((tr) => tr.blocks.map((b) => b.id)));

/**
 * What ⌘B splits at the playhead: the selected clips it is inside; with nothing selected, the clip it is inside on the
 * targeted track (`targetLane`), else on the topmost track that is seen and has one. Never a clip on a locked track.
 * The clips linked to them are the caller's to add (the Linked switch).
 */
export function splitTargets(
  tracks: readonly TimelineTrack[],
  selectedIds: readonly string[],
  atMs: number,
  targetLane: string | null,
): TimelineBlock[] {
  const locked = lockedRows(tracks);
  const can = (b: TimelineBlock) => Boolean(b.loc && b.clipId) && !locked.has(b.id) && splitsAt(b, atMs);
  if (selectedIds.length) return tracks.flatMap((tr) => tr.blocks).filter((b) => selectedIds.includes(b.id) && can(b));
  const target = targetLane ? tracks.find((tr) => tr.lane === targetLane) : undefined;
  if (target) {
    const hit = target.blocks.find(can);
    return hit ? [hit] : [];
  }
  for (const tr of tracks) {
    if (tr.hidden) continue;
    const hit = tr.blocks.find(can);
    if (hit) return [hit];
  }
  return [];
}

/** What ⇧⌘B splits: every clip the playhead is inside, on every track not locked. */
export function splitAllTargets(tracks: readonly TimelineTrack[], atMs: number): TimelineBlock[] {
  return tracks.filter((tr) => !tr.locked).flatMap((tr) => tr.blocks).filter((b) => Boolean(b.loc && b.clipId) && splitsAt(b, atMs));
}

/**
 * Clips (by id, the first leading) moved `frames` frames along their tracks, landing on the frame grid. With the
 * magnet (insert) they move into free time only and stop at a neighbor, as nothing is overwritten then; without it
 * (overwrite) they land a frame on and cut what they cover. Null when nothing can move (a locked track, a neighbor
 * right there, the film's start).
 */
export function planNudge(model: EditModel, ids: readonly string[], frames: number, opts: { mode: EditMode; sync: boolean }): EditPlan | null {
  const main = model.flatMap((t) => t.clips).find((c) => c.id === ids[0]);
  if (!main || !frames) return null;
  const deltaMs = stepFrames(main.startMs, frames) - main.startMs;
  if (!deltaMs) return null;
  if (opts.mode === 'overwrite') {
    const plan = planMove(model, { ids, deltaMs, pointerMs: main.startMs + deltaMs, mode: 'overwrite', sync: opts.sync });
    return plan?.ops.length ? plan : null;
  }
  const plan = planEdges(model, ids.map((id) => ({ id, kind: 'shift' as const })), deltaMs);
  return plan.ops.length ? plan : null;
}

/** A track's name as Studio keeps it (`.film/settings.json`): the clips it had when it was named find it again. */
export type SavedTrackName = { name: string; index: number; clips: string[] };

export type ClipsOf = readonly { clips: readonly { id: string }[] }[];

/**
 * Which track each thing kept about a track (a name, a height) is on now: the track holding the most of the clips it
 * had then, else its place (see trackNamesOf).
 */
export function placeSaved<T extends { index: number; clips: readonly string[] }>(saved: readonly T[], tracks: ClipsOf): Map<T, number> {
  const out = new Map<T, number>();
  const taken = new Set<number>();
  const late: T[] = [];
  for (const entry of saved) {
    const had = new Set(entry.clips);
    let best = -1;
    let most = 0;
    tracks.forEach((tr, i) => {
      const n = tr.clips.filter((c) => had.has(c.id)).length;
      if (n > most && !taken.has(i)) { most = n; best = i; }
    });
    if (best >= 0) { out.set(entry, best); taken.add(best); } else late.push(entry);
  }
  for (const entry of late) {
    if (entry.index < tracks.length && !taken.has(entry.index)) { out.set(entry, entry.index); taken.add(entry.index); }
  }
  return out;
}

/**
 * The names kept for tracks, by film.html track index now. A track is found by the clips it had when named (tracks
 * move, and open and close above it, so its place changes; film.html gives a track no id of its own), the one holding
 * the most of them; a track named while empty, or whose clips are all gone, by its place, when no other name took it.
 */
export function trackNamesOf(saved: readonly SavedTrackName[], tracks: ClipsOf): Map<number, string> {
  return new Map([...placeSaved(saved, tracks)].map(([entry, i]) => [i, entry.name]));
}

/** The names to keep once track `index` is named `name` (an empty name takes its name away); names found nowhere go. */
export function namedTrack(saved: readonly SavedTrackName[], tracks: ClipsOf, index: number, name: string): SavedTrackName[] {
  const placed = placeSaved(saved, tracks);
  const kept = saved.filter((entry) => placed.has(entry) && placed.get(entry) !== index)
    .map((entry) => ({ ...entry, index: placed.get(entry)!, clips: (tracks[placed.get(entry)!]?.clips ?? []).map((c) => c.id) }));
  const clean = name.trim().slice(0, 40);
  return clean ? [...kept, { name: clean, index, clips: (tracks[index]?.clips ?? []).map((c) => c.id) }] : kept;
}
