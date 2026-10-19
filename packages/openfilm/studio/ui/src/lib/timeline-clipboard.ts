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
import { newTrackSide } from './timeline-drag.ts';
import {
  TOUCH_MS, freshLink, insertPointOn, mainTrackOf, magnetOn, planRoom,
  type EditModel, type EditPlan, type Placed, type Switches, type TrackDest,
} from './timeline-edit.ts';
import type { TimelineBlock, TimelineTrack } from './timeline-layout';

export type TimelineClipboardItem = {
  /** The clip's id in film.html. */
  clipId: string;
  startMs: number;
  /** The clip's length: a paste checks whether the spot is free. */
  durMs: number;
  lane: string;
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

/** A copy to put down: of clip `from`, at this time, onto this track; `source` is the track it was copied from. */
type CopySpan = { from: string; startMs: number; endMs: number; dest: TrackDest; source: number };

const overlap = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }): boolean => (
  a.startMs < b.endMs - TOUCH_MS && a.endMs > b.startMs + TOUCH_MS
);

/**
 * Copies put down, never cutting or moving what is there. Onto their track where that time is free; where it is taken
 * (by a clip there, or by another copy) the copies headed there all go to a new track beside it instead (newTrackSide),
 * and one more for each that would still overlap another. `keepOff` (the main track with the magnet) is
 * always taken: copies headed there go to a new track right above it. Copies headed for a new track (`{ insert }`)
 * open one per track they came from, so a group keeps its rows. The inserts onto tracks that are there go first, then
 * the new tracks from the last place up, so every place written holds. `placed`: where each copy lands, by the id it
 * was copied from.
 */
function placeCopies(
  model: EditModel,
  spans: readonly CopySpan[],
  links: ReadonlyMap<string, string | null>,
  keepOff: number | null = null,
): { ops: Op[]; placed: Map<string, Placed> } {
  const there: CopySpan[] = [];
  /* a new track: where it opens, and how low it ends among those opened at that place (higher = lower down) */
  const opened: { at: number; low: number; key: string; spans: CopySpan[] }[] = [];
  const openAt = (at: number, low: number, key: string, span: CopySpan) => {
    const found = opened.find((o) => o.at === at && o.key === key);
    if (found) found.spans.push(span);
    else opened.push({ at, low, key, spans: [span] });
  };
  const byTrack = new Map<number, CopySpan[]>();
  for (const s of spans) {
    if (typeof s.dest === 'object') openAt(s.dest.insert, s.source, `from-${s.source}`, s);
    else byTrack.set(s.dest, [...(byTrack.get(s.dest) ?? []), s]);
  }
  for (const [index, group] of byTrack) {
    const track = model.find((t) => t.index === index);
    const clips = track?.clips ?? [];
    const taken = index === keepOff
      || group.some((s, i) => clips.some((c) => overlap(s, c)) || group.slice(0, i).some((o) => overlap(s, o)));
    if (!taken) {
      there.push(...group);
      continue;
    }
    const side = newTrackSide(index, track?.role);
    const rows: CopySpan[][] = [];
    for (const s of [...group].sort((a, b) => a.startMs - b.startMs)) {
      const row = rows.find((r) => !r.some((o) => overlap(s, o)));
      if (row) row.push(s);
      else rows.push([s]);
    }
    /* the first row next to the track, the others further away: above a picture track, below a sound one */
    rows.forEach((row, n) => {
      for (const s of row) openAt(side, side === index ? -n : n, `beside-${index}-${n}`, s);
    });
  }
  const insertOf = (s: CopySpan, track: TrackDest): Op => ({
    op: 'insert',
    from: s.from,
    at: Math.round(s.startMs) / 1000,
    track,
    ...(links.has(s.from) ? { link: links.get(s.from)! } : {}),
  });
  const ops: Op[] = there.map((s) => insertOf(s, s.dest));
  const placed = new Map<string, Placed>(there.map((s) => [s.from, { startMs: s.startMs, endMs: s.endMs, track: s.dest }]));
  /* a track opened at a place goes above those opened there before it: the lowest of them opens first */
  for (const o of [...opened].sort((a, b) => b.at - a.at || b.low - a.low)) {
    [...o.spans].sort((a, b) => a.startMs - b.startMs).forEach((s, i) => {
      ops.push(insertOf(s, i === 0 ? { insert: o.at } : o.at));
      placed.set(s.from, { startMs: s.startMs, endMs: s.endMs, track: { insert: o.at } });
    });
  }
  return { ops, placed };
}

/**
 * A paste: copied from one track, the copies go onto the track pointed at (`forceLane`) if any; from several, each
 * back onto its own. The group's earliest clip lands at `atMs`, the rest keep their spacing. Put down (`place`), they
 * never cut or move what is there: a taken spot opens a track beside it (placeCopies), and with the magnet a copy
 * headed for the main track goes to a new track right above it. An insert makes room there instead,
 * pushing what follows on, on the tracks they go in on (with linkage, what rides on the main track along). Null when a
 * track it goes onto is locked or gone.
 */
export function pasteEdit(
  clipboard: readonly TimelineClipboardItem[],
  tracks: readonly TimelineTrack[],
  model: EditModel,
  atMs: number,
  forceLane: string | null,
  opts: { mode: 'place' | 'insert' } & Partial<Switches>,
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
  const links = copyLinks(clipboard.map((item) => item.clipId), model);
  if (opts.mode === 'place') {
    return placeCopies(model, spans.map((s) => ({
      from: s.item.clipId, startMs: s.startMs, endMs: s.endMs, dest: s.track!, source: s.track!,
    })), links, opts.magnet ? mainTrackOf(model) : null).ops;
  }
  const insertOf = (s: (typeof spans)[number]): Op => ({
    op: 'insert',
    from: s.item.clipId,
    at: s.startMs / 1000,
    track: s.track!,
    ...(links.has(s.item.clipId) ? { link: links.get(s.item.clipId)! } : {}),
  });
  /* the copies go in first, so a clip pasted inside itself is copied whole before the insert cuts it */
  const room = planRoom(model, spans.map((s) => ({ track: s.track!, startMs: s.startMs, endMs: s.endMs })), { ...opts, mode: 'insert' });
  return [...spans.map(insertOf), ...room.ops];
}

/**
 * Copies of clips put down where a drag lets them go (⌥-drag): the clips stay, a copy of each lands
 * `deltaMs` later (earlier when negative) on its track or the one in `to`, never cutting what is there (placeCopies).
 * With the magnet, when the grabbed one's copy goes onto the main track, the copies headed there go in end to end at
 * the insert point under the hand (`pointerMs`), what follows moving on. Copies of clips linked together are linked to
 * each other. `placed`: where each copy lands, by the clip it copies. Null when a track it goes onto is locked.
 */
export function planCopies(
  model: EditModel,
  spec: { ids: readonly string[]; deltaMs: number; to?: ReadonlyMap<string, TrackDest>; pointerMs?: number } & Partial<Switches>,
): EditPlan | null {
  const clips = model.flatMap((t) => t.clips.map((c) => ({ c, track: t.index })));
  const picked = spec.ids.flatMap((id) => clips.filter((x) => x.c.id === id));
  if (!picked.length) return null;
  /* the group keeps its shape; none goes before 0 */
  const shift = Math.max(spec.deltaMs, -Math.min(...picked.map((x) => x.c.startMs)));
  const spans = picked.map(({ c, track }): CopySpan => {
    const startMs = Math.max(0, c.startMs + shift);
    return { from: c.id, startMs, endMs: startMs + c.endMs - c.startMs, dest: spec.to?.get(c.id) ?? track, source: track };
  });
  if (spans.some((s) => typeof s.dest === 'number' && model.find((t) => t.index === s.dest)?.locked)) return null;
  const links = copyLinks(spec.ids, model);
  const main = mainTrackOf(model);
  const lead = spans[0]!;
  if (!(spec.magnet && main != null && lead.dest === main && magnetOn(model, main, true))) {
    const { ops, placed } = placeCopies(model, spans, links, spec.magnet ? main : null);
    return { ops, placed, shortMs: 0 };
  }
  /* onto the main track with the magnet: in end to end at the insert point, what follows (and rides on it) moving on */
  const going = spans.filter((s) => s.dest === main).sort((a, b) => a.startMs - b.startMs);
  let at = insertPointOn(model, main, spec.pointerMs ?? lead.startMs, lead.startMs);
  const inserts: Op[] = [];
  const placed = new Map<string, Placed>();
  const startAt = at;
  for (const s of going) {
    const len = s.endMs - s.startMs;
    inserts.push({ op: 'insert', from: s.from, at: Math.round(at) / 1000, track: main, ...(links.has(s.from) ? { link: links.get(s.from)! } : {}) });
    placed.set(s.from, { startMs: at, endMs: at + len, track: main });
    at += len;
  }
  const room = planRoom(model, [{ track: main, startMs: startAt, endMs: at }], { mode: 'insert', magnet: spec.magnet, linkage: spec.linkage });
  const rest = placeCopies(model, spans.filter((s) => s.dest !== main), links, main);
  for (const [id, p] of rest.placed) placed.set(id, p);
  return { ops: [...inserts, ...room.ops, ...rest.ops], placed, shortMs: room.shortMs };
}
