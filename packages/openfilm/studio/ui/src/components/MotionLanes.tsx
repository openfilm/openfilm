/**
 * The picked clip's moving properties as rows under its track, as an animation editor lays out a layer's properties:
 * each row's keyframes at their times, drawn by how they go in and out (a diamond linear, an hourglass eased, a
 * square held, half of each where it has no neighbour). A keyframe is picked by a click (⇧: added or taken away) and
 * dragged in time with the others picked; a row's name picks all of its keyframes; its navigator goes to the keyframe
 * before or after the playhead, and its middle sets one there or takes it away.
 */
import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Key, MotionProp } from '../../../../src/clip-motion.mjs';
import { keyId, sidesOf, type Side } from '@/lib/motion-keys';

/** A row's height, and the room kept above the first. */
export const LANE_H = 18;
export const LANE_PAD = 4;

export interface MotionLanes {
  clipId: string;
  /** Where the clip starts and ends on the film, ms. */
  startMs: number;
  endMs: number;
  rows: { prop: MotionProp; label: string; keys: readonly Key[] }[];
  /** The keyframes picked (lib/motion-keys keyId). */
  picked: ReadonlySet<string>;
  playheadMs: number;
  frameMs: number;
  onPick: (ids: string[], mode: 'set' | 'add' | 'toggle') => void;
  /** The picked keyframes moved in time, s. */
  onMove: (dt: number) => void;
  onToggleHere: (prop: MotionProp) => void;
  onSeek: (ms: number) => void;
  onMenu: (e: React.MouseEvent, id: string) => void;
  labels: { prev: string; next: string; add: string; remove: string };
}

const near = (a: number, b: number, frame: number) => Math.abs(a - b) < frame / 2;

/** One keyframe's mark: its left half how it comes in, its right half how it goes out. */
export function KeyMark({ into, out, picked }: { into: Side | null; out: Side | null; picked: boolean }) {
  const half = (side: Side | null, left: boolean) => {
    const fill = side ? (picked ? 'var(--tl-accent)' : '#e2e2e2') : (picked ? 'var(--tl-accent)' : '#8a8a8a');
    const d = side === 'ease'
      ? (left ? 'M6 1 H2.5 Q5 6 2.5 11 H6 Z' : 'M6 1 H9.5 Q7 6 9.5 11 H6 Z')
      : side === 'hold'
        ? (left ? 'M6 1.5 H2 V10.5 H6 Z' : 'M6 1.5 H10 V10.5 H6 Z')
        : (left ? 'M6 1 L1 6 L6 11 Z' : 'M6 1 L11 6 L6 11 Z');
    return <path d={d} fill={fill} stroke="rgba(0,0,0,0.55)" strokeWidth="0.6" />;
  };
  return (
    <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true" style={{ overflow: 'visible' }}>
      {half(into, true)}
      {half(out, false)}
      {picked ? <path d="M6 -1 L13 6 L6 13 L-1 6 Z" fill="none" stroke="var(--tl-accent)" strokeWidth="1" opacity="0.7" /> : null}
    </svg>
  );
}

/** The rows in the timeline, under the clip's own row (`top`: where they start in it). */
export function MotionLaneRows({ lanes, top, pxPerMs }: { lanes: MotionLanes; top: number; pxPerMs: number }) {
  const [drag, setDrag] = React.useState<{ dx: number } | null>(null);
  const left = lanes.startMs * pxPerMs;
  const width = Math.max(2, (lanes.endMs - lanes.startMs) * pxPerMs);
  /* a frame's worth of px: a drag moves keyframes a whole number of frames */
  const framePx = lanes.frameMs * pxPerMs;
  const dragDt = drag ? (Math.round(drag.dx / Math.max(0.0001, framePx)) * lanes.frameMs) / 1000 : 0;

  const startKey = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const already = lanes.picked.has(id);
    if (e.shiftKey) { lanes.onPick([id], 'toggle'); return; }
    /* a click on a picked keyframe keeps the others picked, so they move together */
    if (!already) lanes.onPick([id], 'set');
    const x0 = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      setDrag({ dx });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (!moved) return;
      const dt = (Math.round((ev.clientX - x0) / Math.max(0.0001, framePx)) * lanes.frameMs) / 1000;
      if (dt) lanes.onMove(dt);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="absolute inset-x-0" style={{ top: top + LANE_PAD / 2 }}
      /* empty time in the rows: nothing picked (the clip stays picked, the playhead stays) */
      onPointerDown={(e) => { e.stopPropagation(); if (e.button === 0 && !e.shiftKey) lanes.onPick([], 'set'); }}>
      {lanes.rows.map((row) => {
        const sides = sidesOf(row.keys);
        return (
          <div key={row.prop} className="relative" style={{ height: LANE_H }} data-motion-lane={row.prop}>
            {/* the clip's stretch, where its keyframes can be */}
            <div className="absolute rounded-[2px]" style={{ left, width, top: 2, bottom: 2, background: 'rgba(255,255,255,0.05)', boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.06)' }} />
            {row.keys.map((k, i) => {
              const id = keyId(row.prop, k.t);
              const picked = lanes.picked.has(id);
              const x = left + (k.t * 1000 + (picked ? dragDt * 1000 : 0)) * pxPerMs;
              return (
                <span key={id} role="presentation" data-keyframe={id}
                  title={`${row.label} · ${(k.t).toFixed(2)}s`}
                  className="absolute top-1/2 z-[2] grid h-[16px] w-[16px] -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center"
                  style={{ left: x }}
                  onPointerDown={(e) => startKey(e, id)}
                  onDoubleClick={(e) => { e.stopPropagation(); lanes.onSeek(lanes.startMs + k.t * 1000); }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!picked) lanes.onPick([id], 'set'); lanes.onMenu(e, id); }}>
                  <KeyMark into={sides[i]!.in} out={sides[i]!.out} picked={picked} />
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** The rows' names in the head column, each with its navigator; a name picks its row's keyframes. */
export function MotionLaneHeads({ lanes }: { lanes: MotionLanes }) {
  const local = (lanes.playheadMs - lanes.startMs) / 1000;
  const frame = lanes.frameMs / 1000;
  const inClip = lanes.playheadMs >= lanes.startMs && lanes.playheadMs <= lanes.endMs;
  return (
    <div style={{ paddingTop: LANE_PAD / 2, paddingBottom: LANE_PAD / 2 }}>
      {lanes.rows.map((row) => {
        const here = inClip && row.keys.some((k) => near(k.t, local, frame));
        const prev = [...row.keys].reverse().find((k) => k.t < local - frame / 2);
        const next = row.keys.find((k) => k.t > local + frame / 2);
        return (
          <div key={row.prop} className="flex items-center gap-[1px] pl-1.5 pr-0.5" style={{ height: LANE_H }}>
            <button type="button" className="min-w-0 flex-1 truncate text-left text-[10.5px] text-[var(--text-muted)] hover:text-[var(--text)]"
              onClick={() => lanes.onPick(row.keys.map((k) => keyId(row.prop, k.t)), 'set')}>
              {row.label}
            </button>
            <HeadButton label={lanes.labels.prev} disabled={!prev} onClick={() => prev && lanes.onSeek(lanes.startMs + prev.t * 1000)}><ChevronLeft size={10} /></HeadButton>
            <HeadButton label={here ? lanes.labels.remove : lanes.labels.add} disabled={!inClip} onClick={() => lanes.onToggleHere(row.prop)}>
              <svg width="8" height="8" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M6 1 11 6 6 11 1 6Z" fill={here ? 'var(--tl-accent)' : 'none'} stroke={here ? 'var(--tl-accent)' : 'currentColor'} strokeWidth="1.5" />
              </svg>
            </HeadButton>
            <HeadButton label={lanes.labels.next} disabled={!next} onClick={() => next && lanes.onSeek(lanes.startMs + next.t * 1000)}><ChevronRight size={10} /></HeadButton>
          </div>
        );
      })}
    </div>
  );
}

function HeadButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="grid h-[14px] w-[12px] shrink-0 place-items-center rounded-[2px] text-[var(--text-faint)] hover:bg-white/10 hover:text-[var(--text)] disabled:opacity-30">
      {children}
    </button>
  );
}
