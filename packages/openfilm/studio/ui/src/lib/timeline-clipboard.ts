/**
 * Copy and paste on the timeline.
 *
 * The clipboard holds clips by their id in film.html, not by their place: a split, a delete or an undo renumbers the
 * places (`film.html#t.c`), and a place copied before then would paste whichever clip sits there now. A paste copies
 * the clip as film.html has it then; a clip that is gone by then is reported, not swapped for another.
 *
 * Start times are kept so several clips keep their spacing; tracks are kept so clips copied from several tracks go
 * back to their own tracks. Only clips copied from one track follow a track the person points at.
 */
import type { Op } from '../api.ts';
import { FILM_DOC_FILE } from './film.ts';

import { newTrackSide } from './timeline-drag.ts';
import { freshLink, planRoom, type EditMode, type EditModel } from './timeline-edit.ts';
import type { TimelineBlock, TimelineTrack } from './timeline-layout';

export type TimelineClipboardItem = {
  /** The clip's id in film.html. */
  clipId: string;
  startMs: number;
  /** The clip's length: a paste checks whether the spot is free. */
  durMs: number;
  lane: string;
};

export type TimelinePasteJob = {
  /** The id of the clip copied. */
  from: string;
  atSec: number;
  after: string | null;
  lane: string;
  /**
   * When the spot is taken the copy does not stack on the original track (it would spread into two rows sharing a
   * badge): it opens a track right after it. The first clip on each new track `{ insert: index }` opens it, the rest
   * name it.
   */
  track?: number | { insert: number };
};

export function laneOfBlock(tracks: readonly TimelineTrack[], id: string): string | null {
  for (const track of tracks) {
    if (track.blocks.some((b) => b.id === id)) return track.lane;
  }
  return null;
}

/** The row by name; when a spread row is gone, the same film.html track. */
export function trackByLane(
  tracks: readonly TimelineTrack[],
  lane: string,
): TimelineTrack | undefined {
  const exact = tracks.find((tr) => tr.lane === lane);
  if (exact) return exact;
  const doc = /^doc-(\d+)/.exec(lane)?.[1];
  if (doc == null) return undefined;
  return tracks.find((tr) => tr.docIndex === Number(doc));
}

/**
 * The last clip of film.html track `index` — a paste goes after it. One track may be spread over several rows
 * (`doc-3#2`), so every row is scanned.
 */
export function lastLocOfDocTrack(
  tracks: readonly TimelineTrack[],
  index: number,
): string | null {
  let best = -1;
  for (const track of tracks) {
    for (const b of track.blocks) {
      const m = b.loc ? /#(\d+)\.(\d+)$/.exec(b.loc) : null;
      if (m && Number(m[1]) === index) best = Math.max(best, Number(m[2]));
    }
  }
  return best < 0 ? null : `${FILM_DOC_FILE}#${index}.${best}`;
}

export function clipboardItemsOf(
  blocks: readonly TimelineBlock[],
  tracks: readonly TimelineTrack[],
): TimelineClipboardItem[] {
  return blocks
    .filter((b) => b.clipId)
    .map((b) => ({
      clipId: b.clipId!,
      startMs: b.startMs,
      durMs: Math.max(1, b.endMs - b.startMs),
      lane: laneOfBlock(tracks, b.id) ?? '',
    }))
    .sort((a, b) => a.startMs - b.startMs);
}

/**
 * The copied clips as the timeline has them now, and how many are gone (deleted, or undone since the copy). Length and
 * track are taken afresh, since the paste copies the clip as it is now; the start times stay as copied, for spacing.
 */
export function clipboardNow(
  clipboard: readonly TimelineClipboardItem[],
  tracks: readonly TimelineTrack[],
): { items: TimelineClipboardItem[]; missing: number } {
  const items: TimelineClipboardItem[] = [];
  for (const item of clipboard) {
    const track = tracks.find((tr) => tr.blocks.some((b) => b.clipId === item.clipId));
    const block = track?.blocks.find((b) => b.clipId === item.clipId);
    if (!track || !block) continue;
    items.push({ ...item, durMs: Math.max(1, block.endMs - block.startMs), lane: track.lane });
  }
  return { items, missing: clipboard.length - items.length };
}

/** The film.html track a row belongs to (`doc-3#2` is a spread row of track 3). */
function docIndexOfLane(lane: string): number | null {
  const doc = /^doc-(\d+)/.exec(lane)?.[1];
  return doc == null ? null : Number(doc);
}

type Range = { startMs: number; endMs: number };

/**
 * Whether two clips would overlap on one track. The pasted start is rounded to the millisecond and clip ends are not,
 * so clips that meet end to end may share up to 1 ms; that is not an overlap.
 */
function clashes(range: Range, others: readonly Range[]): boolean {
  return others.some((o) => o.startMs < range.endMs - 1 && o.endMs > range.startMs + 1);
}

/**
 * The inserts one paste sends.
 *
 * `forceLane` = a track the person pointed at (right-click, or the selected clip's track): clips copied from one track
 * all go there. Clips copied from several tracks each go back to their own track, whatever was pointed at — stacking
 * them on one track would overlap a video with its own sound. The group's earliest clip lands at `atMs`, the rest
 * keep their spacing, across tracks too.
 *
 * The pasted clips are checked against what is on the track and against each other. A taken spot sends that track's
 * clips to a new track right after it (newTrackSide); clips that would still overlap each other there get one more
 * track each, so nothing on one track ever overlaps. Opening a track shifts the indexes below it, so groups that open
 * tracks go last, from the highest index down, and each group's new tracks are opened top to bottom.
 */
export function pastePlan(
  clipboard: readonly TimelineClipboardItem[],
  tracks: readonly TimelineTrack[],
  atMs: number,
  forceLane?: string | null,
): TimelinePasteJob[] {
  if (!clipboard.length) return [];
  const base = Math.min(...clipboard.map((item) => item.startMs));
  const copiedTracks = new Set(clipboard.map((item) => docIndexOfLane(item.lane) ?? item.lane));
  const force = forceLane && copiedTracks.size === 1 ? forceLane : null;
  /* rows of one film.html track are one track here: clips pasted onto two of its rows still land on the same track */
  const groups = new Map<string, { lane: string; items: TimelineClipboardItem[] }>();
  for (const item of clipboard) {
    const lane = force || item.lane;
    const key = String(docIndexOfLane(lane) ?? lane);
    const group = groups.get(key) ?? { lane, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  const plans = [...groups.values()].map(({ lane, items }) => {
    const docIndex = docIndexOfLane(lane);
    const ranges = items.map((item) => {
      const startMs = Math.round(atMs + (item.startMs - base));
      return { item, startMs, endMs: startMs + item.durMs };
    }).sort((a, b) => a.startMs - b.startMs);
    /* one track may be spread over several rows: scan every row with this index */
    const occupied = docIndex == null
      ? []
      : tracks
        .filter((tr) => tr.docIndex === docIndex)
        .flatMap((tr) => tr.blocks.map((b) => ({ startMs: b.startMs, endMs: b.endMs })));
    const collides = docIndex != null && ranges.some((r, i) => clashes(r, occupied) || clashes(r, ranges.slice(0, i)));
    return { lane, ranges, docIndex, collides };
  });
  plans.sort((a, b) => (
    Number(a.collides) - Number(b.collides)
    || (b.docIndex ?? -1) - (a.docIndex ?? -1)
  ));

  const out: TimelinePasteJob[] = [];
  for (const { lane, ranges, docIndex, collides } of plans) {
    if (collides) {
      /* the spot is taken: the copies get tracks of their own right after the original, each filled without overlap */
      const rows: (typeof ranges)[] = [];
      for (const r of ranges) {
        const row = rows.find((placed) => !clashes(r, placed));
        if (row) row.push(r);
        else rows.push([r]);
      }
      rows.forEach((row, n) => {
        const insertAt = newTrackSide(docIndex!) + n;
        row.forEach(({ item, startMs }, i) => {
          out.push({ from: item.clipId, atSec: startMs / 1000, after: null, lane, track: i === 0 ? { insert: insertAt } : insertAt });
        });
      });
      continue;
    }
    const after = docIndex == null ? null : lastLocOfDocTrack(tracks, docIndex);
    for (const { item, startMs } of [...ranges].reverse()) {
      out.push({ from: item.clipId, atSec: startMs / 1000, after, lane });
    }
  }
  return out;
}

export function pasteDestLocked(
  jobs: readonly TimelinePasteJob[],
  tracks: readonly TimelineTrack[],
): boolean {
  /* jobs that open a new track do not land on a locked one: the lock only stops pasting into that track */
  return jobs.some((job) => (
    job.track == null && Boolean(job.lane && trackByLane(tracks, job.lane)?.locked)
  ));
}

/**
 * The links copies get: copies of clips linked together and pasted together are linked to each other, with a link
 * of their own (not the originals', or moving a copy would move the original); a copy pasted without the clips its
 * original is linked to is linked to nothing. Clip id → the link for its copy (null: none); unlinked clips are left
 * out.
 */
export function copyLinks(clipIds: readonly string[], model: EditModel): Map<string, string | null> {
  const linkOf = new Map(model.flatMap((t) => t.clips.flatMap((c) => (c.link ? [[c.id, c.link] as const] : []))));
  const count = new Map<string, number>();
  for (const id of clipIds) {
    const link = linkOf.get(id);
    if (link) count.set(link, (count.get(link) ?? 0) + 1);
  }
  const fresh = new Map<string, string>();
  const taken = new Set<string>();
  const out = new Map<string, string | null>();
  for (const id of clipIds) {
    const link = linkOf.get(id);
    if (!link) continue;
    if ((count.get(link) ?? 0) < 2) { out.set(id, null); continue; }
    if (!fresh.has(link)) {
      const made = freshLink(model, `${id}-copy`, taken);
      taken.add(made);
      fresh.set(link, made);
    }
    out.set(id, fresh.get(link)!);
  }
  return out;
}

/**
 * A paste as an edit in the timeline's mode, never onto a new track: copied from one track, the copies go onto the
 * track pointed at (`forceLane`) if any; from several, each back onto its own. The group's earliest clip lands at
 * `atMs`, the rest keep their spacing. An insert makes room there (pushing what follows on, with sync lock on every
 * unlocked track); an overwrite takes that time off the tracks. The copies go in first, so a clip pasted over itself
 * is copied whole before it is cut. Null when a track it goes onto is locked or gone.
 */
export function pasteEdit(
  clipboard: readonly TimelineClipboardItem[],
  tracks: readonly TimelineTrack[],
  model: EditModel,
  atMs: number,
  forceLane: string | null,
  opts: { mode: EditMode; sync: boolean },
): Op[] | null {
  if (!clipboard.length) return [];
  const base = Math.min(...clipboard.map((item) => item.startMs));
  const copiedTracks = new Set(clipboard.map((item) => docIndexOfLane(item.lane) ?? item.lane));
  const force = forceLane && copiedTracks.size === 1 ? forceLane : null;
  const spans = clipboard.map((item) => {
    const row = trackByLane(tracks, force || item.lane);
    const startMs = Math.round(Math.max(0, atMs) + (item.startMs - base));
    return { item, track: row?.docIndex, locked: Boolean(row?.locked), startMs, endMs: startMs + item.durMs };
  });
  if (spans.some((s) => s.track == null || s.locked)) return null;
  const room = planRoom(model, spans.map((s) => ({ track: s.track!, startMs: s.startMs, endMs: s.endMs })), opts);
  const links = copyLinks(clipboard.map((item) => item.clipId), model);
  const inserts: Op[] = spans.map((s) => ({
    op: 'insert',
    from: s.item.clipId,
    at: s.startMs / 1000,
    track: s.track!,
    ...(links.has(s.item.clipId) ? { link: links.get(s.item.clipId)! } : {}),
  }));
  return [...inserts, ...room.ops];
}
