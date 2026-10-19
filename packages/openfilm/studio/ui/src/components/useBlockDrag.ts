/**
 * Dragging on the timeline: a clip moved (or copied, ⌥), an edge trimmed. Press, follow the pointer, write the result
 * to film.html on release.
 *
 * Clips are a projection of the evaluated film, not data to change freely: release sends an edit and the timeline
 * redraws from the film that comes back. Two consequences:
 *   · while dragging only the local preview changes — a drag is hundreds of pointer moves;
 *   · after release the clips stay where they were let go until the new layout arrives, instead of jumping back
 *     first (which looks like a failed drag).
 *
 * What a gesture does to the other clips is planned by lib/timeline-edit (the main track's magnet, linkage, linked
 * clips), every frame, so the clips it pushes or carries are drawn where they will be before release; release sends
 * that plan, one write and one undo step.
 *
 * The idle / pending / dragging gesture with a 5 px threshold follows mature editors: without it, clicking a clip
 * would be a zero-length drag that writes the same value back.
 */
import * as React from 'react';

import type { Op } from '@/api';
import {
  applyDrag,
  dragCompanions,
  dragLifted,
  flushShiftMs,
  groupLaneShift,
  moveDestFor,
  moveEditMode,
  snapTargetsFor,
  SNAP_THRESHOLD_PX,
  trimFence,
  type Block,
  type BlockMove,
  type DragMode,
  type DropBand,
  type DropLane,
  type SnapTarget,
  type TrackDrop,
} from '@/lib/timeline-drag';
import {
  linkedIds,
  magnetOn,
  planEdges,
  planMove,
  planRippleTrim,
  sourceLeftMs,
  type EditModel,
  type EditPlan,
  type MoveMode,
  type TrackDest,
} from '@/lib/timeline-edit';
import { planCopies } from '@/lib/timeline-clipboard';
import { switchesOf, type TimelinePrefs } from '@/lib/timeline-prefs';
import type { TimelineBlock, TimelineTrack } from '@/lib/timeline-layout';

/** What a press on the timeline does: move a clip, or trim one of its edges. */
export type GestureMode = DragMode;

/**
 * The tracks as places to drop. `except` are the clips in hand (the dragged one and the selection moving with it):
 * they are not obstacles — the group is leaving.
 */
function dropLanesOf(lanes: readonly TimelineTrack[], except: readonly string[]): DropLane[] {
  const skip = new Set(except);
  const occupied = new Map<number, { startMs: number; endMs: number }[]>();
  for (const lane of lanes) {
    if (lane.docIndex == null) continue;
    const ranges = occupied.get(lane.docIndex) ?? [];
    for (const b of lane.blocks) if (!skip.has(b.id)) ranges.push({ startMs: b.startMs, endMs: b.endMs });
    occupied.set(lane.docIndex, ranges);
  }
  return lanes.map((lane) => ({
    ...(lane.docIndex != null ? { docIndex: lane.docIndex } : {}),
    ...(lane.locked ? { locked: true } : {}),
    occupied: lane.docIndex == null ? [] : occupied.get(lane.docIndex) ?? [],
  }));
}

/** What the label beside the pointer says while trimming. */
export interface GestureTip {
  kind: 'trim' | 'ripple';
  /** How far the edge, the cut, the content or the clip moved (film ms). */
  deltaMs: number;
  /** The clip's length now, for a trim. */
  lengthMs?: number;
  /** A trim that reached the end of the clip's source on that side: it can go no further. */
  sourceEnd?: boolean;
  /** Where to show it: this film time, on this row. */
  atMs: number;
  lane: number;
}

/** A drag in progress: the timeline draws the clips here, and the snap guide. */
export interface DragPreview {
  id: string;
  /**
   * Where the clip follows the pointer (a move: not clamped, not snapped). The landing is separate (`landStartMs`):
   * the clip follows the hand, the landing mark shows where release puts it.
   */
  startMs: number;
  endMs: number;
  snappedTo: SnapTarget | null;
  /** The selection moving along, by the same offset. */
  moves: BlockMove[];
  /** Where release puts it. Meaningful only when `droppable`. */
  landStartMs: number;
  landEndMs: number;
  landMoves: readonly BlockMove[];
  /** Vertical offset following the pointer: a lifted clip really leaves its row. 0 for the rest. */
  offsetY: number;
  /** The row under the pointer; out of range is -1 / lanes.length. */
  hoverLane: number;
  band: DropBand;
  /** Where release puts a single clip (a group: `laneDelta`). */
  drop: TrackDrop;
  /** Rows the whole group moves (negative = up); 0 = no track change. Only for groups. */
  laneDelta: number;
  /** The clips that change track → film.html index. */
  trackMoves: readonly { id: string; trackIndex: number }[];
  /** Whether it can go here. Only then is a landing drawn and release written; otherwise the clip goes back. */
  droppable: boolean;
  /** Released: this only holds the clips' places until the write lands (and only while the old layout is shown). */
  landed: boolean;
  mode: GestureMode;
  /** A move: put down (a taken spot opens a track) or inserted (pushing what follows on). */
  editMode: MoveMode;
  /** Clips in hand the move puts on a new track because their spot is taken: block id → the track's film.html place. */
  opens: ReadonlyMap<string, number>;
  /** An insert onto a track: where it goes in (a line is drawn there). */
  insertAtMs: number | null;
  /** Where the clips the edit pushes, trims or cuts are drawn meanwhile, by block id; null: it goes. */
  ghosts: ReadonlyMap<string, { startMs: number; endMs: number } | null>;
  tip: GestureTip | null;
}

export interface BlockDrag {
  preview: DragPreview | null;
  /** Where to draw a clip while a gesture changes it; null when it does not. `gone`: the edit takes it out. */
  placedOf: (id: string) => { startMs: number; endMs: number; gone?: boolean } | null;
  /** Writing the edit (film.html changing, the film evaluating again). */
  saving: boolean;
  error: string | null;
  /**
   * Attached to the clip body and its edges. `selected`: the clips moving along (a move). ⌥ at the press (`e.altKey`)
   * trims this clip alone; for a move it copies (`copy`).
   */
  start: (e: React.PointerEvent, block: TimelineBlock, mode: GestureMode, selected?: readonly string[], copy?: boolean) => void;
  /** Whether a clip can move / be trimmed: decides handles and cursors. */
  can: (block: TimelineBlock) => { move: boolean; resize: boolean };
  dismissError: () => void;
}

/** Whether the pointer is over the panel of the app around Studio (lib/host.ts `panel`). */
function overHostPanel(ev: PointerEvent): boolean {
  return Boolean(document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-studio-host-panel]'));
}

/** The clips in hand a plan puts on a new track: block id → the track's film.html place. */
function opensOf(
  plan: EditPlan | null,
  blockOfClip: ReadonlyMap<string, TimelineBlock>,
  inHand: ReadonlySet<string>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [clipId, at] of plan?.placed ?? []) {
    const b = blockOfClip.get(clipId);
    if (b && inHand.has(b.id) && at && typeof at.track === 'object') out.set(b.id, at.track.insert);
  }
  return out;
}

/** The history label of a gesture, naming the clip (see OperationHistory's stepText). */
function stepOf(mode: GestureMode, ripple: boolean, clipId: string): string {
  const key = mode === 'move' ? 'history.stepMoved' : ripple ? 'history.stepRippleTrimmed' : 'history.stepTrimmed';
  return `${key}|${clipId}`;
}

export function useBlockDrag(opts: {
  /** Every clip on the timeline (snapping uses their edges). */
  allBlocks: readonly TimelineBlock[];
  /** The same clips, by row. */
  lanes: readonly TimelineTrack[];
  /** The same clips as an edit sees them (lib/timeline-edit). */
  model: EditModel;
  playheadMs: number;
  /** More times to snap to: the markers (ms). */
  snapPointsMs?: readonly number[];
  pxPerMs: number;
  /** The timeline's switch: snapping. */
  prefs: TimelinePrefs;
  /** The timeline's scroller: it scrolls by itself when a drag reaches its left or right edge. */
  scrollEl?: React.RefObject<HTMLElement | null>;
  /** The row and band under the pointer. Without it a clip can only slide along its own row. */
  laneHitAtY?: (clientY: number) => { lane: number; band: DropBand };
  /** The selection: dragging one of it moves all of it (see dragCompanions). Read at press time. */
  selectedIds?: readonly string[];
  /** Write the plan's operations, as one edit. Null = done; a sentence = it did not go through. */
  onCommit?: (ops: Op[], label: string) => Promise<string | null>;
  /**
   * Clips moved out of the timeline and let go over the panel of the app around Studio (its chat,
   * `[data-studio-host-panel]`): the move is dropped and these clips are handed to it instead.
   */
  onDropOut?: (blocks: TimelineBlock[]) => void;
}): BlockDrag {
  const [storedPreview, setPreview] = React.useState<(DragPreview & { pendingProjection?: string }) | null>(null);
  // Evaluated keys include mutable track/clip indexes. A new projection can
  // reuse the dragged key for a different clip, even before the save resolves.
  const projection = React.useMemo(() => JSON.stringify(opts.lanes.map(lane => [
    lane.docIndex, lane.blocks.map(block => [block.id, block.clipId, block.loc]),
  ])), [opts.lanes]);
  const preview = storedPreview?.landed && storedPreview.pendingProjection !== projection
    ? null : storedPreview;
  // Retire before paint, and permanently: rollback must not revive an old drag.
  React.useLayoutEffect(() => {
    if (storedPreview && !preview) setPreview(p => p === storedPreview ? null : p);
  }, [storedPreview, preview]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const cancelGesture = React.useRef<(() => void) | null>(null);
  const pendingSaves = React.useRef(0);
  React.useEffect(() => () => cancelGesture.current?.(), []);

  /* read on every frame of a drag but new on every render: kept in a ref so the listeners are not re-attached (which
     would drop the drag in progress) */
  const latest = React.useRef({ ...opts, projection });
  latest.current = { ...opts, projection };

  const can = React.useCallback((block: TimelineBlock) => {
    const locked = latest.current.lanes.some(
      (lane) => lane.locked && lane.blocks.some((b) => b.id === block.id),
    );
    const writable = Boolean(latest.current.onCommit) && !locked && Boolean(block.clipId);
    return {
      move: writable && Boolean(block.loc && block.anchor?.move),
      resize: writable && Boolean(block.loc && block.anchor?.resize),
    };
  }, []);

  const start = React.useCallback((
    e: React.PointerEvent,
    block: TimelineBlock,
    mode: GestureMode,
    selected?: readonly string[],
    /** A move that copies (⌥ at the press): the clips stay, copies land where they are let go. */
    copy = false,
  ) => {
    if (e.button !== 0) return;
    const able = can(block);
    if (mode === 'move' ? !able.move : !able.resize) return;

    cancelGesture.current?.();
    setError(null);

    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    const pointerTarget = e.currentTarget;
    const { pxPerMs, lanes, allBlocks, model, prefs } = latest.current;
    if (!(pxPerMs > 0)) return;
    // Keep receiving move/up when the pointer crosses a preview iframe.
    try { pointerTarget.setPointerCapture(pointerId); } catch { /* Detached target. */ }
    const startScrollLeft = latest.current.scrollEl?.current?.scrollLeft ?? 0;
    const startScrollTop = latest.current.scrollEl?.current?.scrollTop ?? 0;
    /* the film time under the hand at the press: an insert goes before or after the clip under it */
    const grabMs = block.startMs + (startX - pointerTarget.getBoundingClientRect().left) / pxPerMs;
    /* ⌥ at the press: this clip alone, not the clips linked to it (a trim; for a move ⌥ copies) */
    const alone = e.altKey && (mode === 'trim-start' || mode === 'trim-end');

    const geom: Block = { id: block.id, startMs: block.startMs, endMs: block.endMs };
    /* a trim also leaves out where the dragged edge is now: with clips end to end the neighbor's edge sits right
       there and would hold the edge in place (see snapTargetsFor) */
    const edgeMs = mode === 'trim-end' ? block.endMs
      : mode === 'trim-start' ? block.startMs
        : undefined;
    const locked = new Set(lanes.filter((lane) => lane.locked).flatMap((lane) => lane.blocks.map((b) => b.id)));
    const blockOfClip = new Map(allBlocks.flatMap((b) => (b.clipId ? [[b.clipId, b] as const] : [])));
    const writable = (b: TimelineBlock | undefined): b is TimelineBlock => Boolean(b?.loc && b.clipId && b.anchor?.move && !locked.has(b.id));
    /* the clips linked to this one, unless ⌥ says alone */
    const partnersOf = (b: TimelineBlock): TimelineBlock[] => (!alone && b.clipId
      ? linkedIds(model, [b.clipId]).filter((id) => id !== b.clipId).map((id) => blockOfClip.get(id)).filter(writable)
      : []);
    /* a move takes the rest of the selection (and the clips linked to it, when the selection did not already) */
    const crowd = mode === 'move'
      ? [...new Set([
        ...dragCompanions(block.id, selected ?? latest.current.selectedIds ?? []),
        ...partnersOf(block).map((b) => b.id),
      ])].filter((id) => id !== block.id).map((id) => allBlocks.find((b) => b.id === id)).filter(writable)
      : [];
    const partners = mode === 'move' ? [] : partnersOf(block);
    const ids = [block.clipId!, ...(mode === 'move' ? crowd : partners).map((b) => b.clipId!)];

    const homeLaneIndex = lanes.findIndex((lane) => lane.blocks.some((b) => b.id === block.id));
    const homeLane = homeLaneIndex >= 0 ? lanes[homeLaneIndex] : undefined;
    const singleLanes = dropLanesOf(lanes, [block.id]);
    const groupLanes = crowd.length ? dropLanesOf(lanes, [block.id, ...crowd.map((b) => b.id)]) : singleLanes;
    const snapCache = new Map<string, SnapTarget[]>();
    /* a trim stops at the neighbors on the clip's own track (every row of it) */
    const fence = mode === 'trim-start' || mode === 'trim-end' ? trimFence(geom, singleLanes[homeLaneIndex]?.occupied ?? []) : undefined;
    /* on the main track with the magnet a trim ripples: what follows moves with the edge */
    const ripple = magnetOn(model, homeLane?.docIndex, prefs.magnet) && (mode === 'trim-start' || mode === 'trim-end');

    let dragging = false;
    let last: DragPreview | null = null;
    let lastPlan: EditPlan | null = null;
    let lastEv: PointerEvent | null = null;
    /* ⌥ while moving: the other edit mode (insert ↔ overwrite) */
    let altNow = false;
    let edgeRaf = 0;

    /** A plan's places by block id (the halves an edit cuts off are not blocks yet: not drawn until written). */
    const ghostsOf = (plan: EditPlan, except: ReadonlySet<string>): Map<string, { startMs: number; endMs: number } | null> => {
      const out = new Map<string, { startMs: number; endMs: number } | null>();
      for (const [clipId, placed] of plan.placed) {
        const b = blockOfClip.get(clipId);
        if (!b || except.has(b.id)) continue;
        out.set(b.id, placed ? { startMs: placed.startMs, endMs: placed.endMs } : null);
      }
      return out;
    };

    const apply = (): void => {
      const ev = lastEv;
      if (!ev || !dragging) return;
      const { model: m, prefs: p } = latest.current;
      /* while auto-scrolling the pointer stands still: add what was scrolled, or the clip stops at the window edge */
      const scrolled = (latest.current.scrollEl?.current?.scrollLeft ?? startScrollLeft) - startScrollLeft;
      const scrolledY = (latest.current.scrollEl?.current?.scrollTop ?? startScrollTop) - startScrollTop;
      const deltaMs = (ev.clientX - startX + scrolled) / pxPerMs;
      const snapping = p.snap;
      const movingIds = [block.id, ...crowd.map((b) => b.id), ...partners.map((b) => b.id)];
      const snapKey = `${latest.current.playheadMs}`;
      if (snapping && !snapCache.has(snapKey)) {
        snapCache.clear();
        snapCache.set(snapKey, snapTargetsFor(latest.current.allBlocks, movingIds, latest.current.playheadMs, edgeMs, latest.current.snapPointsMs));
      }
      const targets: SnapTarget[] = snapping ? snapCache.get(snapKey)! : [];
      const base = {
        id: block.id, moves: [] as BlockMove[], landMoves: [] as BlockMove[], offsetY: 0, hoverLane: homeLaneIndex,
        band: 'body' as DropBand, drop: { action: 'stay' } as TrackDrop, laneDelta: 0, trackMoves: [], droppable: true,
        landed: false, mode, editMode: 'place' as MoveMode, opens: new Map<string, number>(), insertAtMs: null,
      };

      if (mode !== 'move') {
        /* a trim: the clips stay on their rows; the plan says where every edge lands. Rippling (the main track with the
           magnet), the neighbor is no fence: it moves along */
        const out = applyDrag(geom, mode, deltaMs, targets, pxPerMs, block.room, undefined, ripple ? undefined : fence);
        const edge = mode === 'trim-end' ? 'end' : 'start';
        const want = edge === 'end' ? out.endMs - geom.endMs : out.startMs - geom.startMs;
        const plan = ripple
          ? planRippleTrim(m, ids, edge, want, switchesOf(p))
          : planEdges(m, ids.map((id) => ({ id, kind: edge })), want, switchesOf(p));
        const snappedTo = plan.deltaMs === want ? out.snappedTo : null;
        const own = plan.placed.get(block.clipId!);
        /* how much source is left past that edge once it moved (pulled out, the edge moves away from the clip) */
        const left = (sourceLeftMs(m, block.clipId!, edge) ?? Infinity) - (edge === 'end' ? plan.deltaMs : -plan.deltaMs);
        const tip: GestureTip = {
          kind: ripple ? 'ripple' : 'trim', deltaMs: plan.deltaMs, lengthMs: own ? own.endMs - own.startMs : geom.endMs - geom.startMs,
          atMs: edge === 'end' || ripple ? (own?.endMs ?? geom.endMs) : (own?.startMs ?? geom.startMs), lane: homeLaneIndex,
          ...(left < 1 ? { sourceEnd: true } : {}),
        };
        lastPlan = plan;
        document.body.style.cursor = 'ew-resize';
        last = {
          ...base,
          startMs: own?.startMs ?? geom.startMs,
          endMs: own?.endMs ?? geom.endMs,
          landStartMs: own?.startMs ?? geom.startMs,
          landEndMs: own?.endMs ?? geom.endMs,
          snappedTo,
          ghosts: ghostsOf(plan, new Set([block.id])),
          tip,
        };
        setPreview(last);
        return;
      }

      /* a move: the clip follows the hand; where it lands, and what it does to what is there, is the plan's */
      const offsetY = ev.clientY - startY + scrolledY;
      const hit = latest.current.laneHitAtY?.(ev.clientY) ?? { lane: homeLaneIndex, band: 'body' as const };
      const out = applyDrag(geom, 'move', deltaMs, targets, pxPerMs, block.room, crowd);
      const grouped = crowd.length > 0 && homeLaneIndex >= 0;
      /* a group above every row or below every row: new tracks there, one per track it came from (as one clip does) */
      const onFilm = groupLanes.filter((lane) => lane.docIndex != null);
      const groupOpens = grouped && onFilm.length
        ? hit.lane < 0 ? onFilm[0]!.docIndex! : hit.lane >= latest.current.lanes.length ? onFilm.at(-1)!.docIndex! + 1 : null
        : null;
      const shift = groupOpens != null
        ? { ok: true, delta: 0, moves: [] as { id: string; trackIndex: number }[] }
        : grouped
        ? groupLaneShift([
          { id: block.id, laneIndex: homeLaneIndex, startMs: out.startMs, endMs: out.endMs },
          ...crowd.map((b) => {
            const mv = out.moves.find((x) => x.id === b.id);
            return {
              id: b.id,
              laneIndex: latest.current.lanes.findIndex((lane) => lane.blocks.some((x) => x.id === b.id)),
              startMs: mv?.startMs ?? b.startMs,
              endMs: mv?.endMs ?? b.endMs,
            };
          }),
        ], groupLanes, hit.lane - homeLaneIndex)
        : { ok: true, delta: 0, moves: [] as { id: string; trackIndex: number }[] };
      const drop = grouped ? { action: 'stay' as const } : moveDestFor(homeLane?.docIndex, singleLanes, hit.lane);
      /*
       * Looks flush: make it flush. The nearest snap target is often the playhead a few ms off a neighbor's edge —
       * under a pixel on screen, but those ms would put it on a new track (flushShiftMs). Only with snapping on, for
       * one clip, put down.
       */
      const destLane = drop.action === 'move' ? singleLanes.find((l) => l.docIndex === drop.trackIndex) : singleLanes[homeLaneIndex];
      const flush = !grouped && snapping && drop.action !== 'insert'
        ? flushShiftMs({ startMs: out.startMs, endMs: out.endMs }, destLane?.occupied ?? [], SNAP_THRESHOLD_PX / pxPerMs)
        : null;
      /* a copy (⌥ at the press, often still held) is always put down: ⌥ inserts only a move */
      const editMode: MoveMode = copy ? 'place' : moveEditMode(altNow);
      /* onto the main track with the magnet it goes in between: the insert point decides, not a snap */
      const landsOn = groupOpens != null ? null : drop.action === 'move' ? drop.trackIndex : drop.action === 'stay' ? homeLane?.docIndex : null;
      const mainInsert = !grouped && magnetOn(m, landsOn, p.magnet);
      const settle = editMode === 'place' && !mainInsert ? flush : null;
      const to = new Map<string, TrackDest>();
      if (drop.action === 'move') to.set(block.clipId!, drop.trackIndex);
      if (drop.action === 'insert') to.set(block.clipId!, { insert: drop.at });
      for (const mv of shift.ok ? shift.moves : []) {
        const b = mv.id === block.id ? block : crowd.find((x) => x.id === mv.id);
        if (b?.clipId) to.set(b.clipId, mv.trackIndex);
      }
      if (groupOpens != null) for (const b of [block, ...crowd]) if (b.clipId) to.set(b.clipId, { insert: groupOpens });
      const outside = overHostPanel(ev);
      const moveBy = out.startMs + (settle?.shiftMs ?? 0) - geom.startMs;
      /* ⌥ at the press: copies land there, the clips stay (planCopies) */
      const plan = outside || drop.action === 'refuse' || !shift.ok ? null : copy
        ? planCopies(m, { ids, deltaMs: moveBy, to, pointerMs: grabMs + deltaMs, ...switchesOf(p) })
        : planMove(m, { ids, deltaMs: moveBy, pointerMs: grabMs + deltaMs, to, mode: editMode, ...switchesOf(p) });
      lastPlan = plan;
      document.body.style.cursor = outside || copy ? 'copy' : 'grabbing';
      const landed = plan?.placed.get(block.clipId!);
      const landStartMs = landed?.startMs ?? out.startMs;
      const inHand = new Set([block.id, ...crowd.map((b) => b.id)]);
      last = {
        ...base,
        startMs: geom.startMs + deltaMs,
        endMs: geom.endMs + deltaMs,
        /* a push into contact counts as a snap too: the guide shows it landed against the neighbor */
        snappedTo: plan && editMode === 'place' && !mainInsert ? (settle ? { ms: settle.edgeMs, kind: 'edge' as const } : out.snappedTo) : null,
        moves: crowd.map((b) => ({ id: b.id, startMs: b.startMs + deltaMs, endMs: b.endMs + deltaMs })),
        landStartMs,
        landEndMs: landStartMs + (geom.endMs - geom.startMs),
        landMoves: crowd.map((b) => {
          const at = plan?.placed.get(b.clipId!);
          const startMs = at?.startMs ?? b.startMs + (landStartMs - geom.startMs);
          return { id: b.id, startMs, endMs: startMs + (b.endMs - b.startMs) };
        }),
        offsetY,
        hoverLane: hit.lane,
        band: hit.band,
        drop,
        laneDelta: shift.ok ? shift.delta : 0,
        trackMoves: shift.ok ? shift.moves : [],
        droppable: Boolean(plan),
        editMode,
        opens: opensOf(plan, blockOfClip, inHand),
        insertAtMs: plan && (editMode === 'insert' || mainInsert) && drop.action !== 'insert' ? landStartMs : null,
        ghosts: plan ? ghostsOf(plan, inHand) : new Map(),
        tip: null,
      };
      setPreview(last);
    };

    /* at most one plan per frame: the pointer sends hundreds of moves a second, the screen draws one frame */
    let applyRaf = 0;
    const scheduleApply = (): void => {
      if (applyRaf) return;
      applyRaf = window.requestAnimationFrame(() => {
        applyRaf = 0;
        apply();
      });
    };
    const cancelApply = (): void => {
      if (!applyRaf) return;
      window.cancelAnimationFrame(applyRaf);
      applyRaf = 0;
    };
    /* at the scroller's left or right edge the timeline scrolls by itself, faster the further out, and keeps going
       while the pointer rests there */
    const EDGE_PX = 48;
    const nudgeScroll = (): void => {
      const el = latest.current.scrollEl?.current;
      if (!el || !lastEv || !dragging) {
        edgeRaf = 0;
        return;
      }
      const rect = el.getBoundingClientRect();
      const x = lastEv.clientX;
      let step = 0;
      if (x < rect.left + EDGE_PX) {
        const t = Math.min(1, (rect.left + EDGE_PX - x) / EDGE_PX);
        step = -Math.ceil(6 + 18 * t);
      } else if (x > rect.right - EDGE_PX) {
        const t = Math.min(1, (x - (rect.right - EDGE_PX)) / EDGE_PX);
        step = Math.ceil(6 + 18 * t);
      }
      if (!step) {
        edgeRaf = 0;
        return;
      }
      const next = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + step));
      if (next === el.scrollLeft) {
        edgeRaf = 0;
        return;
      }
      el.scrollLeft = next;
      /* already inside a frame: calculate now and drop the scheduled one */
      cancelApply();
      apply();
      edgeRaf = window.requestAnimationFrame(nudgeScroll);
    };

    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging) {
        if (!dragLifted(mode, dx, dy)) return;
        dragging = true;
        document.body.style.userSelect = 'none';
      }
      lastEv = ev;
      if (mode === 'move') altNow = ev.altKey;
      scheduleApply();
      if (!edgeRaf) edgeRaf = window.requestAnimationFrame(nudgeScroll);
    };

    /* pressing or releasing ⌥ sends no pointer move, yet people press it to see the result at once */
    const key = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') { ev.preventDefault(); cancel(); return; }
      if (ev.key !== 'Alt' || !dragging || mode !== 'move') return;
      altNow = ev.type === 'keydown';
      scheduleApply();
    };

    const oldCursor = document.body.style.cursor;
    const oldSelect = document.body.style.userSelect;
    const cleanup = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', pointerCancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      if (edgeRaf) window.cancelAnimationFrame(edgeRaf);
      cancelApply();
      try { if (pointerTarget.hasPointerCapture(pointerId)) pointerTarget.releasePointerCapture(pointerId); } catch { /* Unmounted target. */ }
      document.body.style.cursor = oldCursor;
      document.body.style.userSelect = oldSelect;
      if (cancelGesture.current === cancel) cancelGesture.current = null;
    };
    const cancel = (): void => { cleanup(); setPreview(null); };
    const pointerCancel = (ev: PointerEvent): void => { if (ev.pointerId === pointerId) cancel(); };
    const up = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return;
      if (dragging) {
        lastEv = ev;
        if (mode === 'move') altNow = ev.altKey;
        cancelApply();
        apply();
      }
      cleanup();
      if (!dragging || !last) {
        setPreview(null);
        return;
      }
      const dropOut = latest.current.onDropOut;
      if (mode === 'move' && dropOut && overHostPanel(ev)) {
        setPreview(null);
        dropOut([block, ...crowd]);
        return;
      }
      const commit = latest.current.onCommit;
      /* it cannot go here, or it changes nothing: nothing is written, the clip goes back */
      if (!last.droppable || !lastPlan?.ops.length || !commit) {
        setPreview(null);
        return;
      }
      const ops = lastPlan.ops;
      /* the clips stay where they were let go until the new layout is drawn */
      const held = {
        ...last,
        startMs: last.landStartMs,
        endMs: last.landEndMs,
        moves: [...last.landMoves],
        tip: null,
        landed: true,
        pendingProjection: latest.current.projection,
      };
      pendingSaves.current += 1;
      setSaving(true);
      setPreview(held);
      const label = copy ? `history.stepDuplicated|${block.clipId}` : stepOf(mode, ripple, block.clipId!);
      void Promise.resolve().then(() => commit(ops, label)).catch((err: unknown) => (
        err instanceof Error ? err.message : String(err)
      )).then((err) => {
        pendingSaves.current -= 1;
        setSaving(pendingSaves.current > 0);
        setError(err);
        /* clear only this drag's placeholder: the next clip may already be in hand */
        setPreview((p) => (p === held ? null : p));
      });
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', pointerCancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    cancelGesture.current = cancel;
  }, [can]);

  const dismissError = React.useCallback(() => setError(null), []);

  const placedOf = React.useCallback((id: string) => {
    if (!preview) return null;
    if (preview.id === id) return { startMs: preview.startMs, endMs: preview.endMs };
    const m = preview.moves.find((x) => x.id === id);
    if (m) return { startMs: m.startMs, endMs: m.endMs };
    if (!preview.ghosts.has(id)) return null;
    const ghost = preview.ghosts.get(id);
    return ghost ? { startMs: ghost.startMs, endMs: ghost.endMs } : { startMs: 0, endMs: 0, gone: true };
  }, [preview]);

  /* memoized: the timeline lists this object among what decides whether its clips redraw (see Timeline rows); a
     new literal every render would redraw every clip on every render */
  return React.useMemo(
    () => ({ preview, placedOf, saving, error, start, can, dismissError }),
    [preview, placedOf, saving, error, start, can, dismissError],
  );
}
