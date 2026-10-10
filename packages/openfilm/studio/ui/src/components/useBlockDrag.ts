/**
 * Dragging on the timeline: a clip moved, an edge trimmed, a cut rolled, a clip's content slipped or the clip slid
 * between its neighbors. Press, follow the pointer, write the result to film.html on release.
 *
 * Clips are a projection of the evaluated film, not data to change freely: release sends an edit and the timeline
 * redraws from the film that comes back. Two consequences:
 *   · while dragging only the local preview changes — a drag is hundreds of pointer moves;
 *   · after release the clips stay where they were let go until the new layout arrives, instead of jumping back
 *     first (which looks like a failed drag).
 *
 * What a gesture does to the other clips is planned by lib/timeline-edit (insert or overwrite, ripple, linked clips,
 * sync lock), every frame, so the clips it pushes, trims or cuts are drawn where they will be before release; release
 * sends that plan, one write and one undo step.
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
  planEdges,
  planMove,
  planRippleTrim,
  rollMoves,
  slideMoves,
  type EditMode,
  type EditModel,
  type EditPlan,
  type TrackDest,
} from '@/lib/timeline-edit';
import type { TimelinePrefs } from '@/lib/timeline-prefs';
import { snapToFrame } from '@/lib/timecode';
import type { TimelineBlock, TimelineTrack } from '@/lib/timeline-layout';

/** What a press on the timeline does: move a clip, trim one of its edges, roll a cut, slip its content, slide it. */
export type GestureMode = DragMode | 'roll' | 'slip' | 'slide';

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

/** What the label beside the pointer says while trimming, rolling, slipping or sliding. */
export interface GestureTip {
  kind: 'trim' | 'ripple' | 'roll' | 'slip' | 'slide';
  /** How far the edge, the cut, the content or the clip moved (film ms). */
  deltaMs: number;
  /** The clip's length now, for a trim. */
  lengthMs?: number;
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
  /** A move: whether it inserts (pushing what follows) or overwrites (cutting what it lands on). */
  editMode: EditMode;
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
   * Attached to the clip body, its edges and the cuts between clips. `selected`: the clips moving along (a move);
   * `other`: the clip after the cut (a roll). ⌥ at the press (`e.altKey`) trims or rolls this clip alone.
   */
  start: (e: React.PointerEvent, block: TimelineBlock, mode: GestureMode, selected?: readonly string[], other?: TimelineBlock, onLift?: () => void) => void;
  /** Whether a clip can move / be trimmed: decides handles and cursors. */
  can: (block: TimelineBlock) => { move: boolean; resize: boolean };
  dismissError: () => void;
}

/** Whether the pointer is over the panel of the app around Studio (lib/host.ts `panel`). */
function overHostPanel(ev: PointerEvent): boolean {
  return Boolean(document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-studio-host-panel]'));
}

/** The history label of a gesture, naming the clip (see OperationHistory's stepText). */
function stepOf(mode: GestureMode, ripple: boolean, clipId: string): string {
  const key = mode === 'move' ? 'history.stepMoved'
    : mode === 'roll' ? 'history.stepRolled'
      : mode === 'slip' ? 'history.stepSlipped'
        : mode === 'slide' ? 'history.stepSlid'
          : ripple ? 'history.stepRippleTrimmed' : 'history.stepTrimmed';
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
  /** The timeline's switches: snapping, the magnet (insert / ripple), sync lock, linked clips. */
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
    other?: TimelineBlock,
    /** Called once when the press becomes a drag (a roll selects its clip only then: a click on a cut is the cut's). */
    onLift?: () => void,
  ) => {
    if (e.button !== 0) return;
    const able = can(block);
    if (mode === 'move' || mode === 'slide' ? !able.move : !able.resize) return;
    if (mode === 'roll' && (!other || !can(other).resize)) return;

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
    /* ⌥ at the press: this clip alone, not the clips linked to it (a trim, a roll; for a slip or a slide ⌥ is what
       starts it) */
    const alone = e.altKey && (mode === 'trim-start' || mode === 'trim-end' || mode === 'roll');

    const geom: Block = { id: block.id, startMs: block.startMs, endMs: block.endMs };
    /* a trim also leaves out where the dragged edge is now: with clips end to end the neighbor's edge sits right
       there and would hold the edge in place (see snapTargetsFor) */
    const edgeMs = mode === 'trim-end' || mode === 'roll' ? block.endMs
      : mode === 'trim-start' ? block.startMs
        : undefined;
    const locked = new Set(lanes.filter((lane) => lane.locked).flatMap((lane) => lane.blocks.map((b) => b.id)));
    const blockOfClip = new Map(allBlocks.flatMap((b) => (b.clipId ? [[b.clipId, b] as const] : [])));
    const writable = (b: TimelineBlock | undefined): b is TimelineBlock => Boolean(b?.loc && b.clipId && b.anchor?.move && !locked.has(b.id));
    /* the clips linked to this one, unless ⌥ or the switch says alone */
    const partnersOf = (b: TimelineBlock): TimelineBlock[] => (prefs.linked && !alone && b.clipId
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
    /* without the magnet a trim stops at the neighbors on the clip's own track (every row of it) */
    const fence = mode === 'trim-start' || mode === 'trim-end' ? trimFence(geom, singleLanes[homeLaneIndex]?.occupied ?? []) : undefined;
    const ripple = prefs.magnet && (mode === 'trim-start' || mode === 'trim-end');

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
      const movingIds = [block.id, ...crowd.map((b) => b.id), ...(other ? [other.id] : []), ...partners.map((b) => b.id)];
      const snapKey = `${latest.current.playheadMs}`;
      if (snapping && !snapCache.has(snapKey)) {
        snapCache.clear();
        snapCache.set(snapKey, snapTargetsFor(latest.current.allBlocks, movingIds, latest.current.playheadMs, edgeMs, latest.current.snapPointsMs));
      }
      const targets: SnapTarget[] = snapping ? snapCache.get(snapKey)! : [];
      const base = {
        id: block.id, moves: [] as BlockMove[], landMoves: [] as BlockMove[], offsetY: 0, hoverLane: homeLaneIndex,
        band: 'body' as DropBand, drop: { action: 'stay' } as TrackDrop, laneDelta: 0, trackMoves: [], droppable: true,
        landed: false, mode, editMode: 'overwrite' as EditMode, insertAtMs: null,
      };

      if (mode !== 'move') {
        /* trims, rolls, slips and slides: the clips stay on their rows; the plan says where every edge lands */
        let plan: EditPlan & { deltaMs: number };
        let snappedTo: SnapTarget | null = null;
        let tip: GestureTip;
        if (mode === 'trim-start' || mode === 'trim-end') {
          const out = applyDrag(geom, mode, deltaMs, targets, pxPerMs, block.room, undefined, ripple ? undefined : fence);
          const edge = mode === 'trim-end' ? 'end' : 'start';
          const want = edge === 'end' ? out.endMs - geom.endMs : out.startMs - geom.startMs;
          plan = ripple
            ? planRippleTrim(m, ids, edge, want, { sync: p.sync })
            : planEdges(m, ids.map((id) => ({ id, kind: edge })), want);
          if (plan.deltaMs === want) snappedTo = out.snappedTo;
          const own = plan.placed.get(block.clipId!);
          tip = {
            kind: ripple ? 'ripple' : 'trim', deltaMs: plan.deltaMs, lengthMs: own ? own.endMs - own.startMs : geom.endMs - geom.startMs,
            atMs: edge === 'end' || ripple ? (own?.endMs ?? geom.endMs) : (own?.startMs ?? geom.startMs), lane: homeLaneIndex,
          };
        } else if (mode === 'roll') {
          const out = applyDrag(geom, 'trim-end', deltaMs, targets, pxPerMs);
          const want = out.endMs - geom.endMs;
          plan = planEdges(m, rollMoves(m, block.clipId!, other!.clipId!, p.linked && !alone), want);
          if (plan.deltaMs === want) snappedTo = out.snappedTo;
          tip = { kind: 'roll', deltaMs: plan.deltaMs, atMs: geom.endMs + plan.deltaMs, lane: homeLaneIndex };
        } else if (mode === 'slip') {
          plan = planEdges(m, ids.map((id) => ({ id, kind: 'slip' as const })), snapToFrame(deltaMs));
          tip = { kind: 'slip', deltaMs: plan.deltaMs, atMs: (geom.startMs + geom.endMs) / 2, lane: homeLaneIndex };
        } else {
          const out = applyDrag(geom, 'move', deltaMs, targets, pxPerMs);
          const want = out.startMs - geom.startMs;
          plan = planEdges(m, slideMoves(m, ids, p.linked), want);
          if (plan.deltaMs === want) snappedTo = out.snappedTo;
          tip = { kind: 'slide', deltaMs: plan.deltaMs, atMs: (geom.startMs + geom.endMs) / 2 + plan.deltaMs, lane: homeLaneIndex };
        }
        lastPlan = plan;
        const own = plan.placed.get(block.clipId!);
        document.body.style.cursor = mode === 'slip' || mode === 'slide' ? 'grabbing' : mode === 'roll' ? 'col-resize' : 'ew-resize';
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
      const editMode: EditMode = p.magnet !== altNow ? 'insert' : 'overwrite';
      const out = applyDrag(geom, 'move', deltaMs, targets, pxPerMs, block.room, crowd);
      const grouped = crowd.length > 0 && homeLaneIndex >= 0;
      const shift = grouped
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
       * under a pixel on screen, but an overwrite would cut those ms off the neighbor (flushShiftMs). Only with
       * snapping on, for one clip, overwriting.
       */
      const destLane = drop.action === 'move' ? singleLanes.find((l) => l.docIndex === drop.trackIndex) : singleLanes[homeLaneIndex];
      const settle = !grouped && snapping && editMode === 'overwrite' && drop.action !== 'insert'
        ? flushShiftMs({ startMs: out.startMs, endMs: out.endMs }, destLane?.occupied ?? [], SNAP_THRESHOLD_PX / pxPerMs)
        : null;
      const to = new Map<string, TrackDest>();
      if (drop.action === 'move') to.set(block.clipId!, drop.trackIndex);
      if (drop.action === 'insert') to.set(block.clipId!, { insert: drop.at });
      for (const mv of shift.ok ? shift.moves : []) {
        const b = mv.id === block.id ? block : crowd.find((x) => x.id === mv.id);
        if (b?.clipId) to.set(b.clipId, mv.trackIndex);
      }
      const outside = overHostPanel(ev);
      const plan = outside || drop.action === 'refuse' || !shift.ok ? null : planMove(m, {
        ids,
        deltaMs: out.startMs + (settle?.shiftMs ?? 0) - geom.startMs,
        pointerMs: grabMs + deltaMs,
        to,
        mode: editMode,
        sync: p.sync,
      });
      lastPlan = plan;
      document.body.style.cursor = outside ? 'copy' : 'grabbing';
      const landed = plan?.placed.get(block.clipId!);
      const landStartMs = landed?.startMs ?? out.startMs;
      const inHand = new Set([block.id, ...crowd.map((b) => b.id)]);
      last = {
        ...base,
        startMs: geom.startMs + deltaMs,
        endMs: geom.endMs + deltaMs,
        /* a push into contact counts as a snap too: the guide shows it landed against the neighbor */
        snappedTo: plan && editMode === 'overwrite' ? (settle ? { ms: settle.edgeMs, kind: 'edge' as const } : out.snappedTo) : null,
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
        insertAtMs: plan && editMode === 'insert' && drop.action !== 'insert' ? landStartMs : null,
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
        onLift?.();
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
      void Promise.resolve().then(() => commit(ops, stepOf(mode, ripple, block.clipId!))).catch((err: unknown) => (
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
