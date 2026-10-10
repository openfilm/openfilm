/**
 * The arithmetic of dragging on the timeline: pixels to time, what to snap to, where to land.
 *
 * Kept apart because a drag is dozens of pointer moves and a wrong step in any of them only feels "a bit off"; as pure
 * functions they are easy to pin down. Following mature editors (OpenCut):
 *   · a 5 px threshold: without one, clicking a clip is a zero-length drag that writes the same value back;
 *   · snapping measured in screen pixels, not milliseconds, so it feels the same at every zoom;
 *   · a clip never snaps to itself, or it could not move at all.
 */
import { snapToFrame } from './timecode.ts';

/** Past this many pixels a press is a drag; under it, a click. */
export const DRAG_THRESHOLD_PX = 5;

/**
 * Whether a press `dx`, `dy` px along has become a drag. A move lifts in either direction (up to another row); a roll,
 * a slip and a slide past the threshold sideways, so a click on a cut is a click (its transitions), not a roll; a
 * trimmed edge follows at once.
 */
export function dragLifted(mode: 'move' | 'trim-start' | 'trim-end' | 'roll' | 'slip' | 'slide', dx: number, dy: number): boolean {
  if (mode === 'move') return Math.abs(dx) >= DRAG_THRESHOLD_PX || Math.abs(dy) >= DRAG_THRESHOLD_PX;
  if (mode === 'roll' || mode === 'slip' || mode === 'slide') return Math.abs(dx) >= DRAG_THRESHOLD_PX;
  return Math.abs(dx) >= 1;
}

/** Snap reach, in screen pixels (converted to ms with the current zoom). */
export const SNAP_THRESHOLD_PX = 8;

/** The shortest a clip can be. A zero-length clip cannot be seen, and usually means a negative number got written. */
export const MIN_BLOCK_MS = 100;

export interface SnapTarget {
  ms: number;
  /** What it snapped to. Snapping to the playhead draws no guide: the playhead is already there. */
  kind: 'playhead' | 'edge' | 'zero' | 'marker';
}

/** Snap a time to the nearest target within reach. Without a target in reach it comes back as is. */
export function snapMs(
  ms: number,
  targets: readonly SnapTarget[],
  pxPerMs: number,
): { ms: number; target: SnapTarget | null } {
  if (!(pxPerMs > 0)) return { ms, target: null };
  const withinMs = SNAP_THRESHOLD_PX / pxPerMs;
  let best: SnapTarget | null = null;
  let bestDist = Infinity;
  for (const t of targets) {
    const dist = Math.abs(ms - t.ms);
    if (dist <= withinMs && dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }
  return best ? { ms: best.ms, target: best } : { ms, target: null };
}

export interface Block {
  id: string;
  startMs: number;
  endMs: number;
}

/**
 * Who moves along when a clip of a selection is dragged: the others of the selection (not the dragged clip itself).
 * A clip outside the selection is a new single selection and moves alone.
 */
export function dragCompanions(id: string, selected: readonly string[]): string[] {
  if (!selected.includes(id)) return [];
  return selected.filter((one) => one !== id);
}

/**
 * Where a drag can snap to: zero, the playhead, the edges of every clip not moving, and the markers (`markersMs`).
 *
 * The moving clips are left out (a clip would stick to its own edge; a group would pull itself apart). `edgeMs` is
 * where the dragged edge is now, given for trims: a target sitting exactly there is left out too, or clips placed end
 * to end would hold the edge in place within the snap reach and then jump.
 *
 * Word cues are not targets: five or six words a second are closer together than the snap reach, so everything would
 * snap somewhere — and a few ms off a neighbor's edge, which looks flush but overlaps and opens a new track. The cues
 * are still drawn on the clip.
 */
export function snapTargetsFor(
  blocks: readonly Block[],
  except: string | readonly string[] | null,
  playheadMs: number,
  edgeMs?: number,
  markersMs: readonly number[] = [],
): SnapTarget[] {
  const skip = new Set(Array.isArray(except) ? except : except ? [except] : []);
  const out: SnapTarget[] = [{ ms: 0, kind: 'zero' }, { ms: playheadMs, kind: 'playhead' }, ...markersMs.map((ms) => ({ ms, kind: 'marker' as const }))];
  for (const b of blocks) {
    if (skip.has(b.id)) continue;
    out.push({ ms: b.startMs, kind: 'edge' }, { ms: b.endMs, kind: 'edge' });
  }
  return edgeMs == null ? out : out.filter((t) => Math.abs(t.ms - edgeMs) >= 1);
}

/** Neighbors' time merged into ranges that do not overlap (film.html may already hold overlaps). */
function busyRanges(
  blocks: readonly { startMs: number; endMs: number }[],
): { startMs: number; endMs: number }[] {
  const out: { startMs: number; endMs: number }[] = [];
  for (const b of [...blocks].sort((a, b2) => a.startMs - b2.startMs)) {
    const last = out.at(-1);
    if (last && b.startMs <= last.endMs) last.endMs = Math.max(last.endMs, b.endMs);
    else out.push({ startMs: b.startMs, endMs: b.endMs });
  }
  return out;
}

/**
 * Almost touching: push the clip until it really touches. Null when no push is needed or none works.
 *
 * Whether a stretch is taken is decided in milliseconds, but people see pixels: zoomed out a pixel is ~50 ms, so a
 * clip can look flush against its neighbor and overlap it by 20 ms — and an overwrite then cuts 20 ms off the
 * neighbor. The gesture was "against it", the result "a sliver gone".
 *
 * The push is at most the snap reach: within it, snapping was entitled to move the clip anyway. A bigger overlap is
 * meant, and the overwrite is then right. If the push still overlaps (no room between the neighbors), no push.
 */
export interface FlushShift {
  /** How far to shift, ms. */
  shiftMs: number;
  /**
   * The edge it ends up against (film time): pushed right, its head meets a neighbor's tail; pushed left, its tail
   * meets a neighbor's head. The guide is drawn there.
   */
  edgeMs: number;
}

export function flushShiftMs(
  range: { startMs: number; endMs: number },
  occupied: readonly { startMs: number; endMs: number }[],
  tolMs: number,
): FlushShift | null {
  if (!(tolMs > 0) || !occupied.length) return null;
  const busy = busyRanges(occupied);
  const hits = busy.filter((r) => r.startMs < range.endMs && r.endMs > range.startMs);
  if (!hits.length) return null;

  /* two candidates per neighbor in the way (after it / before it), nearest first */
  const tries: FlushShift[] = [];
  for (const r of hits) {
    tries.push(
      { shiftMs: r.endMs - range.startMs, edgeMs: r.endMs },
      { shiftMs: r.startMs - range.endMs, edgeMs: r.startMs },
    );
  }
  const durMs = range.endMs - range.startMs;
  for (const one of tries.sort((a, b) => Math.abs(a.shiftMs) - Math.abs(b.shiftMs))) {
    if (!one.shiftMs || Math.abs(one.shiftMs) > tolMs) continue;
    const at = range.startMs + one.shiftMs;
    /* not before zero: that is out of bounds, not flush */
    if (at < 0) continue;
    if (!busy.some((r) => r.startMs < at + durMs && r.endMs > at)) return one;
  }
  return null;
}

export type DragMode = 'move' | 'trim-start' | 'trim-end';

/** Where a clip moving along ends up. */
export interface BlockMove {
  id: string;
  startMs: number;
  endMs: number;
}

export interface DragOutcome {
  startMs: number;
  endMs: number;
  /** What it snapped to, for the guide. */
  snappedTo: SnapTarget | null;
  /** The clips moving along (not the dragged one). Only for a move: lengthening a clip moves nobody else. */
  moves: BlockMove[];
}

/**
 * The result of a drag.
 *
 * `move` shifts both ends: both try to snap and the nearer wins (snapping only the head, a tail could never be put
 * exactly on the next clip's start — the most common thing to do).
 *
 * `trim-*` moves one end, the other stays. Dragging too far clamps to the shortest length instead of failing: the hand
 * is faster than the eye, and bouncing back feels worse than stopping.
 *
 * What comes back is what gets written: a free edge lands on a frame here (a drag of a second is 1998 ms of pointer
 * travel, and `at: 1.998` is a frame no one meant), an edge snapped onto something or stopped by a limit lands exactly
 * there. Rounded later, after the landing was checked against the neighbors, an edge moved by up to half a frame onto
 * a neighbor that is not on the frame grid — and a clip that overlaps another goes to a track of its own.
 */
export function applyDrag(
  block: Block,
  mode: DragMode,
  deltaMs: number,
  targets: readonly SnapTarget[],
  pxPerMs: number,
  /**
   * How much source is left to pull into, from the current in point. Not past it: past the end of a source is
   * silence, yet the clip would look longer. Absent (an MG page has no source) = unlimited.
   */
  room?: { headMs?: number; tailMs?: number },
  /**
   * The clips moving along. They all shift by the same amount — no snapping or yielding of their own, the group's
   * shape is the user's — and none goes before zero.
   */
  follow?: readonly Block[],
  /** For trims: where the neighbors on the clip's track begin and end (see trimFence). A trimmed edge stops there. */
  fence?: TrimFence,
): DragOutcome {
  if (mode === 'move') {
    const rawStart = block.startMs + deltaMs;
    const rawEnd = block.endMs + deltaMs;
    const head = snapMs(rawStart, targets, pxPerMs);
    const tail = snapMs(rawEnd, targets, pxPerMs);
    const headDist = head.target ? Math.abs(rawStart - head.ms) : Infinity;
    const tailDist = tail.target ? Math.abs(rawEnd - tail.ms) : Infinity;
    let shift = snapToFrame(rawStart) - block.startMs;
    let snappedTo: SnapTarget | null = null;
    if (headDist <= tailDist && head.target) {
      shift = head.ms - block.startMs;
      snappedTo = head.target;
    } else if (tail.target) {
      shift = tail.ms - block.endMs;
      snappedTo = tail.target;
    }
    /* a group moving left stops when its earliest clip reaches zero */
    const floor = follow?.length
      ? Math.min(block.startMs, ...follow.map((b) => b.startMs))
      : block.startMs;
    const startMs = block.startMs + Math.max(shift, -floor);
    const durMs = block.endMs - block.startMs;
    const moves = (follow ?? []).map((b) => ({
      id: b.id,
      startMs: b.startMs + (startMs - block.startMs),
      endMs: b.endMs + (startMs - block.startMs),
    }));
    return { startMs, endMs: startMs + durMs, snappedTo, moves };
  }

  if (mode === 'trim-start') {
    const snapped = snapMs(block.startMs + deltaMs, targets, pxPerMs);
    const wanted = snapped.target ? snapped.ms : snapToFrame(snapped.ms);
    /* left as far as the source's head (what is left before the in point), and not into the clip before; right no
       shorter than the shortest clip (a clip already that short only gets longer) */
    const floor = Math.max(0, block.startMs - (room?.headMs ?? Infinity), fence?.startMs ?? 0);
    const startMs = Math.max(floor, Math.min(wanted, Math.max(block.startMs, block.endMs - MIN_BLOCK_MS)));
    return {
      startMs,
      endMs: block.endMs,
      snappedTo: startMs === snapped.ms && snapped.target ? snapped.target : startMs === fence?.startMs ? { ms: startMs, kind: 'edge' } : null,
      moves: [],
    };
  }

  const snapped = snapMs(block.endMs + deltaMs, targets, pxPerMs);
  const wanted = snapped.target ? snapped.ms : snapToFrame(snapped.ms);
  /* right as far as the source's tail, and not into the clip after */
  const ceil = Math.min(block.endMs + (room?.tailMs ?? Infinity), fence?.endMs ?? Infinity);
  const endMs = Math.min(ceil, Math.max(wanted, Math.min(block.endMs, block.startMs + MIN_BLOCK_MS)));
  return {
    startMs: block.startMs,
    endMs,
    snappedTo: endMs === snapped.ms && snapped.target ? snapped.target : endMs === fence?.endMs ? { ms: endMs, kind: 'edge' } : null,
    moves: [],
  };
}

/** How far a trim may reach on its track: the end of the clip before, the start of the clip after. */
export interface TrimFence {
  startMs?: number;
  endMs?: number;
}

/**
 * Clips on one track do not overlap (SPEC), so a trimmed edge stops at its neighbor — as a moved clip that would
 * overlap goes to a track of its own. `others` is what else is on the clip's track. A neighbor already overlapping
 * (film.html written that way) holds the edge where it is: the trim can shorten the clip, not grow the overlap.
 */
export function trimFence(
  block: { startMs: number; endMs: number },
  others: readonly { startMs: number; endMs: number }[],
): TrimFence {
  let startMs: number | undefined;
  let endMs: number | undefined;
  for (const r of others) {
    if (r.startMs < block.startMs) {
      const edge = Math.min(r.endMs, block.startMs);
      startMs = startMs == null ? edge : Math.max(startMs, edge);
    } else {
      const edge = Math.max(r.startMs, block.endMs);
      endMs = endMs == null ? edge : Math.min(endMs, edge);
    }
  }
  return { ...(startMs != null ? { startMs } : {}), ...(endMs != null ? { endMs } : {}) };
}

/**
 * What a drag writes back to film.html: only what changed (a plain move must not leave an unchanged end behind — the
 * agent reads that diff).
 *
 * A position is written relative to the parent window (that is what `at` means), so the parent's start is taken off;
 * written as film time, a sound inside a scene at 30 s would move to 30 s of the film.
 */
export interface DragEdit {
  loc: string;
  anchor: {
    move?: 'at';
    resize?: 'end';
    trimFrom?: number;
    /** A still: its `time` is only its length (no source to trim into), so the left edge changes the length. */
    still?: boolean;
    parentStartMs: number;
  };
  before: { startMs: number; endMs: number };
  after: { startMs: number; endMs: number };
  /** The clip's speed (source per film): `start` / `end` are the source's seconds, a film ms is `speed` of them. */
  speed?: number;
  /** The source's own length (ms): the trim written stays inside it (a frame-snapped edge, times `speed`, can pass it). */
  sourceDurMs?: number;
  /**
   * The clip's length comes from a live reference (a duration like `'q3.end + 3.4'`): moving its start would change
   * its length. Moving it writes the current length down as a number, so it keeps its length wherever it goes.
   */
  pinLength?: boolean;
}

/**
 * Every edit one drag writes: the dragged clip and those moving with it, in one write — split into several, a failure
 * halfway would leave the film half moved and take several undos.
 */
export function editsForMoves(
  items: readonly DragEdit[],
): { loc: string; prop: string; value: number; from: number }[] {
  return items.flatMap(editsForOne);
}

function editsForOne(opts: DragEdit): { loc: string; prop: string; value: number; from: number }[] {
  const { loc, anchor, before, after } = opts;
  const { parentStartMs } = anchor;
  const out: { loc: string; prop: string; value: number; from: number }[] = [];
  const sec = (ms: number): number => Math.round(ms) / 1000;
  /* compared as film.html writes them, to the millisecond: a move computes its end as start + length, and float noise
     in that sum (4000 → 3999.9999999995) would read as a trim and write a `time` the clip never had */
  const same = (a: number, b: number): boolean => Math.round(a) === Math.round(b);
  /* written where it landed: applyDrag already put a free edge on a frame, and kept a snapped one on its edge */
  const startMs = after.startMs;
  const endMs = after.endMs;

  if (anchor.move && !same(after.startMs, before.startMs)) {
    out.push({
      loc,
      prop: anchor.move,
      value: sec(startMs - parentStartMs),
      from: sec(before.startMs - parentStartMs),
    });
  }

  if (anchor.resize === 'end') {
    if (anchor.trimFrom != null) {
      /* film ms → the source's ms: `time` is written in the source's own seconds */
      const k = opts.speed && opts.speed > 0 ? opts.speed : 1;
      const inSource = (s: number): number => {
        const v = Math.max(0, Math.round(s * 1000) / 1000);
        return opts.sourceDurMs != null ? Math.min(v, opts.sourceDurMs / 1000) : v;
      };
      const beforeDur = (before.endMs - before.startMs) * k;
      const moved = !same(after.startMs, before.startMs);
      /* the start stays where it is written unless it moved: the end is a frame from there */
      const afterDur = (endMs - (moved ? startMs : before.startMs)) * k;
      /* the head pulled: the in point follows it and `end` stays. Not on a still, whose in point is clamped at 0: its
         left edge pulled out moved the picture along instead of lengthening it — it writes `end` like the right edge */
      const trimHead = moved && same(after.endMs, before.endMs) && !anchor.still;
      if (trimHead) {
        out.push({
          loc,
          prop: 'start',
          value: inSource(anchor.trimFrom + ((startMs - before.startMs) * k) / 1000),
          from: anchor.trimFrom,
        });
      } else if (!same((after.endMs - after.startMs) * k, beforeDur) || (opts.pinLength && moved)) {
        out.push({
          loc,
          prop: 'end',
          value: inSource(anchor.trimFrom + afterDur / 1000),
          from: Math.round((anchor.trimFrom + beforeDur / 1000) * 1000) / 1000,
        });
      }
    } else if (!same(after.endMs, before.endMs)) {
      out.push({
        loc,
        prop: 'end',
        value: sec(endMs - parentStartMs),
        from: sec(before.endMs - parentStartMs),
      });
    }
  }
  return out;
}

/** A marquee (track coordinates, without scrolling). */
export interface Marquee {
  fromMs: number;
  toMs: number;
  /**
   * The rows it spans (inclusive). May be out of range: -1 above the rows, the row count below. Callers must not clamp
   * it to the nearest row, or a marquee drawn in the empty space would select the edge row (see laneAtY).
   */
  fromLane: number;
  toLane: number;
}

/**
 * The clips a marquee hits: intersecting, not contained — a marquee is usually drawn across clips, and requiring
 * whole clips would select nothing the user clearly swept over. Out-of-range rows have no clips, so a marquee drawn
 * wholly in empty space selects nothing.
 */
export function marqueeHits(
  lanes: readonly { blocks: readonly Block[] }[],
  box: Marquee,
): string[] {
  const lo = Math.min(box.fromLane, box.toLane);
  const hi = Math.max(box.fromLane, box.toLane);
  const from = Math.min(box.fromMs, box.toMs);
  const to = Math.max(box.fromMs, box.toMs);
  const out: string[] = [];
  for (let i = lo; i <= hi; i += 1) {
    for (const b of lanes[i]?.blocks ?? []) {
      if (b.startMs < to && b.endMs > from) out.push(b.id);
    }
  }
  return out;
}

/**
 * Which track a dragged clip lands on.
 *
 * A track has no kind (SPEC): any clip goes on any track. Onto a row it goes to that row's track, whatever is on it
 * there: the edit mode decides what happens to what it lands on (an insert pushes it on, an overwrite cuts it out).
 * Above or below every row it opens a new track there, the one gesture that does. Clips never swap.
 */
export type TrackDrop =
  | { action: 'stay' }
  | { action: 'move'; trackIndex: number }
  | { action: 'insert'; at: number }
  /**
   * It cannot go here (locked, or not a track). Unlike `stay` ("stays on its track, its time may have
   * changed"), nothing is drawn and release writes nothing, not even the horizontal move.
   */
  | { action: 'refuse' };

/** Where on a row the pointer is (its top and bottom edges, or its body). */
export type DropBand = 'above' | 'body' | 'below';

export interface DropLane {
  docIndex?: number;
  /** Nothing can be put on a locked track. */
  locked?: boolean;
  /** What is taken on this film.html track besides the clips being dragged. Rows of one track share a docIndex. */
  occupied?: readonly { startMs: number; endMs: number }[];
}

export function rangeOverlaps(
  range: { startMs: number; endMs: number },
  others: readonly { startMs: number; endMs: number }[],
): boolean {
  return others.some((b) => b.startMs < range.endMs && b.endMs > range.startMs);
}

/**
 * Where a track that has to be opened goes: right after its source, one row down. The new track grew out of that one
 * (a copied page belongs next to its original), and badges count top to bottom, so inserting after renames no track
 * above — "my P1" stays P1.
 */
export function newTrackSide(fromDocIndex: number): number {
  return fromDocIndex + 1;
}

/**
 * Whether this drop really opens a new track. A clip alone on its track inserted next to itself would empty the track
 * and put it back where it was — nothing changes, so nothing is sent. `occupied` not worked out = assume it opens.
 */
export function insertCreatesTrack(
  drop: TrackDrop,
  sourceDocIndex: number | undefined,
  lanes: readonly DropLane[],
): boolean {
  if (drop.action !== 'insert' || sourceDocIndex == null) return false;
  const source = lanes.find((lane) => lane.docIndex === sourceDocIndex);
  if (!source || source.occupied === undefined) return true;
  if (source.occupied.length > 0) return true;
  const at = drop.at > sourceDocIndex ? drop.at - 1 : drop.at;
  return at !== sourceDocIndex;
}

export function moveDestFor(
  sourceDocIndex: number | undefined,
  lanes: readonly DropLane[],
  hoverLane: number,
): TrackDrop {
  if (sourceDocIndex == null) return { action: 'stay' };
  const onFilm = lanes.filter((lane) => lane.docIndex != null);
  const opens = (at: number): TrackDrop => {
    const drop: TrackDrop = { action: 'insert', at };
    return insertCreatesTrack(drop, sourceDocIndex, lanes) ? drop : { action: 'stay' };
  };
  /* above every row: a new top track; below every row: a new bottom one */
  if (hoverLane < 0) return onFilm[0] ? opens(onFilm[0].docIndex!) : { action: 'stay' };
  if (hoverLane >= lanes.length) return onFilm.length ? opens(onFilm.at(-1)!.docIndex! + 1) : { action: 'stay' };
  const target = lanes[hoverLane];
  if (!target || target.docIndex == null) return { action: 'refuse' };
  if (target.docIndex === sourceDocIndex) return { action: 'stay' };
  if (target.locked) return { action: 'refuse' };
  return { action: 'move', trackIndex: target.docIndex };
}

/** One clip of a selection moving up or down together. Times are after the horizontal move. */
export interface GroupMember {
  id: string;
  /** The row it is drawn on. Rows spread by overlap share a film.html index, so a row is not a track. */
  laneIndex: number;
  startMs: number;
  endMs: number;
}

export interface GroupLaneShift {
  /**
   * Whether the rows the pointer asks for have room. If not, the whole move is off: nothing drawn, nothing written.
   * It never settles for "a row that fits" — that would draw the landing where the pointer is not.
   */
  ok: boolean;
  /** Rows the whole group moves by. 0 = nobody changes track. Meaningless when not `ok`. */
  delta: number;
  /** The clips that really change track → film.html index. */
  moves: { id: string; trackIndex: number }[];
}

/**
 * Where a selection moved up or down lands.
 *
 * One degree of freedom: the whole group moves the same number of rows, keeping the shape the user made (Premiere /
 * Resolve do the same). Only the rows asked for are tried. Any track takes any clip; a track a clip moves to must be
 * unlocked. What is already on a track where a clip lands is the edit mode's to settle (insert or overwrite); the
 * landings themselves may not overlap each other: clips on one track do not overlap (SPEC).
 */
export function groupLaneShift(
  members: readonly GroupMember[],
  lanes: readonly DropLane[],
  wantDelta: number,
): GroupLaneShift {
  if (!members.length) return { ok: true, delta: 0, moves: [] };
  const moves = groupFitsAt(members, lanes, wantDelta);
  if (!moves) return { ok: false, delta: 0, moves: [] };
  return { ok: true, delta: wantDelta, moves };
}

/** Whether the group fits `delta` rows away: the clips that change track, or null. */
function groupFitsAt(
  members: readonly GroupMember[],
  lanes: readonly DropLane[],
  delta: number,
): { id: string; trackIndex: number }[] | null {
  const landed: { member: GroupMember; docIndex: number; moved: boolean }[] = [];
  for (const m of members) {
    const laneIndex = m.laneIndex + delta;
    const lane = lanes[laneIndex];
    const home = lanes[m.laneIndex];
    if (!lane || lane.docIndex == null) return null;
    const moved = lane.docIndex !== home?.docIndex;
    if (moved && lane.locked) return null;
    landed.push({ member: m, docIndex: lane.docIndex, moved });
  }
  /* landings may not overlap on one track (rows spread from one track share its index) */
  for (let i = 0; i < landed.length; i += 1) {
    for (let j = i + 1; j < landed.length; j += 1) {
      if (landed[i]!.docIndex !== landed[j]!.docIndex) continue;
      if (rangeOverlaps(landed[i]!.member, [landed[j]!.member])) return null;
    }
  }
  return landed.filter((o) => o.moved).map((o) => ({ id: o.member.id, trackIndex: o.docIndex }));
}
