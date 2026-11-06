/**
 * The caption cues on the picture (SPEC §1 Captions), edited there as any thing on it is: a click selects one
 * (⇧/⌘-click one more or one less), as on its track's row, and its look shows in the inspector; a picked one has the
 * frame every picked thing has (StageTransformFrame). Its middle moves it, a corner scales it (its words' size), a side
 * makes it wider or narrower (its words wrapping). With "Apply to all captions" on that is every cue of the track, off
 * the picked ones only (lib/caption-edits placeCues, resizeCues; lib/caption-look). While dragging the film shows the
 * change (stage `captionShift`) and the frame follows; on release the file is written once.
 *
 * The cues are drawn by the film, on its own origin: where each is is asked of its stage (studio/server/stage.js
 * `captions`) when the moment shown or a caption file changes. Only the cues have a hit box, so the rest of the
 * picture is FilmStageSelect's as before. Mount it in the Preview, over the picture, in stage px scaled to its box.
 */
import * as React from 'react';
import type { PreviewHandle } from '@/editor/Preview';
import { cueRule, placeCues, resizeCues, setCueRule, type CueBox, type Vtt } from '@/lib/caption-edits';
import { lookDecls, sizeOf } from '@/lib/caption-look';
import {
  captionApplyAllNow, captionSelectionNow, captionTrackNow, setCaptionSelection, useCaptionSelection, useCaptionTracksVersion, writeCaptionTrack,
} from '@/lib/caption-tracks';
import { DRAG_THRESHOLD_PX } from '@/lib/timeline-drag';
import { FRAME_COLOR, StageTransformFrame } from './StageTransformFrame';

type Rect = { x: number; y: number; w: number; h: number };
type ShownCue = { track: number; src: string; id: string; locked: boolean; box: Rect; text: Rect };
/** What a press on a picked cue's frame does. */
type Gesture = 'move' | 'scale' | 'stretch-e' | 'stretch-w';
/** The cues in hand, as shown while dragged: moved by (dx, dy) stage px, scaled by `k`, a width `w` (stage px). */
type Held = { src: string; ids: ReadonlySet<string> | null; dx: number; dy: number; k: number; w: number | null };

/** How near the frame's middle a dragged cue's middle snaps to it (screen px). */
const SNAP_PX = 6;
/** The words' size a corner can make (cqmin). */
const SIZE_MIN = 1, SIZE_MAX = 30;

export function CaptionStage({ previewRef, projectId, stage, timeMs, onPick, onPause }: {
  previewRef: React.RefObject<PreviewHandle | null>;
  projectId: string;
  stage: { w: number; h: number };
  timeMs: number;
  /** A cue picked: its look and words in the inspector. */
  onPick: () => void;
  /** Pressed while the film plays: it stops, as a picture pressed does. */
  onPause?: () => void;
}): React.ReactElement | null {
  const [cues, setCues] = React.useState<ShownCue[]>([]);
  const [hover, setHover] = React.useState<string | null>(null);
  const [guide, setGuide] = React.useState(false);
  const sel = useCaptionSelection();
  const version = useCaptionTracksVersion();
  const box = React.useRef<HTMLDivElement | null>(null);
  const dragging = React.useRef(false);
  const shown = React.useRef<ShownCue[]>([]);
  /* the cues in hand, held as dragged until the film has drawn where they went */
  const [held, setHeld] = React.useState<Held | null>(null);
  /* asked again once a file written is drawn (the film reads it on its own time) */
  const [again, setAgain] = React.useState(0);
  /* the overlay's px per stage px: the frame is drawn in the overlay's px */
  const [scale, setScale] = React.useState(1);

  /* where the cues are: asked once the film has drawn the moment (and read a file written, which takes a moment) */
  React.useEffect(() => {
    let gone = false;
    const ask = () => {
      if (dragging.current) return;
      void previewRef.current?.stage?.<ShownCue[]>('captions').then((list) => {
        if (gone || dragging.current) return;
        const next = list ?? [];
        /* drawn where they went: the cues held as dragged are let go */
        if (JSON.stringify(next) !== JSON.stringify(shown.current)) setHeld(null);
        shown.current = next;
        setCues(next);
      });
    };
    const timers = [40, 300, 900].map((ms) => window.setTimeout(ask, ms));
    return () => { gone = true; for (const id of timers) window.clearTimeout(id); };
  }, [previewRef, timeMs, version, again, stage.w]);

  /* the overlay's scale, as the picture's size changes (the inspector opening narrows it) */
  const hasCues = cues.length > 0;
  React.useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const measure = () => { const r = el.getBoundingClientRect(); if (r.width) setScale(r.width / stage.w); };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [stage.w, hasCues]);

  /* pressing anywhere else on the picture lets the cues go */
  React.useEffect(() => {
    const down = (e: PointerEvent) => {
      const frame = box.current?.parentElement;
      const el = e.target as Element | null;
      if (!frame || !el?.closest || !frame.contains(el) || el.closest('[data-caption-hit]')) return;
      if (captionSelectionNow()) setCaptionSelection(null);
    };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, []);

  const press = React.useCallback((e: React.PointerEvent, cue: ShownCue, gesture: Gesture) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onPause?.();
    const now = captionSelectionNow();
    let ids = new Set(now?.src === cue.src ? now.ids : []);
    if (gesture === 'move' && (e.shiftKey || e.metaKey || e.ctrlKey)) { if (ids.has(cue.id)) ids.delete(cue.id); else ids.add(cue.id); }
    else if (!ids.has(cue.id)) ids = new Set([cue.id]);
    setCaptionSelection({ src: cue.src, ids });
    onPick();
    const frame = box.current?.getBoundingClientRect();
    if (cue.locked || !frame || !ids.has(cue.id)) return;

    const all = captionApplyAllNow();
    const moving = cues.filter((c) => c.src === cue.src && (all || ids.has(c.id)));
    const from = { x: e.clientX, y: e.clientY };
    let change: Held = { src: cue.src, ids: all ? null : ids, dx: 0, dy: 0, k: 1, w: null };
    let raf = 0;
    const show = () => {
      raf = 0;
      setHeld(change);
      void previewRef.current?.stage?.('captionShift', { track: cue.track, ids: all ? null : [...ids], dx: change.dx, dy: change.dy, k: change.k });
    };
    const mid = { x: cue.text.x + cue.text.w / 2, y: cue.text.y + cue.text.h / 2 };
    const move = (ev: PointerEvent) => {
      if (!dragging.current && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < DRAG_THRESHOLD_PX) return;
      dragging.current = true;
      /* the scale as the picture is now: the inspector opening on the press narrows it */
      const r = box.current?.getBoundingClientRect() ?? frame;
      const sx = stage.w / r.width, sy = stage.h / r.height;
      const at = { x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sy };
      if (gesture === 'move') {
        let dx = (ev.clientX - from.x) * sx;
        const dy = (ev.clientY - from.y) * sy;
        /* its middle on the frame's middle, when it comes near: a caption is centered more than anything */
        const off = mid.x + dx - stage.w / 2;
        const snapped = Math.abs(off) / sx <= SNAP_PX;
        if (snapped) dx -= off;
        setGuide(snapped);
        change = { ...change, dx, dy };
      } else if (gesture === 'scale') {
        /* as far from its middle as the corner is now, against where it was pressed */
        const was = Math.hypot((from.x - frame.left) * sx - mid.x, (from.y - frame.top) * sy - mid.y) || 1;
        change = { ...change, k: Math.max(0.1, Math.hypot(at.x - mid.x, at.y - mid.y) / was) };
      } else {
        /* a side out from the middle, the other side as far the other way */
        const half = Math.max(stage.w * 0.025, Math.abs(at.x - (cue.box.x + cue.box.w / 2)));
        change = { ...change, w: Math.min(stage.w, half * 2) };
      }
      if (!raf) raf = requestAnimationFrame(show);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (raf) cancelAnimationFrame(raf);
      setGuide(false);
      if (!dragging.current) return;
      const vtt = captionTrackNow(projectId, cue.src);
      const pct = (r: Rect): CueBox => ({ left: (r.x / stage.w) * 100, top: (r.y / stage.h) * 100, width: (r.w / stage.w) * 100, height: (r.h / stage.h) * 100 });
      const drawn = new Map(moving.map((c) => [c.id, pct(c.box)]));
      /* held where it was let go until the film draws it there */
      setHeld(change);
      const done = () => {
        dragging.current = false;
        void previewRef.current?.stage?.('captionShift', { track: cue.track, ids: null, dx: 0, dy: 0, k: 1 });
        setAgain((n) => n + 1);
      };
      if (!vtt) { setHeld(null); done(); return; }
      let next: Vtt;
      if (gesture === 'move') next = placeCues(vtt, all ? null : ids, (change.dx / stage.w) * 100, (change.dy / stage.h) * 100, drawn);
      else if (gesture === 'scale') next = scaled(vtt, all ? null : ids, change.k);
      else next = resizeCues(vtt, all ? null : ids, ((change.w ?? cue.box.w) / stage.w) * 100, drawn);
      void writeCaptionTrack(projectId, cue.src, next, gesture === 'move' ? 'captionTrack.stepPlace' : 'captionTrack.stepLook').finally(done);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [cues, onPick, onPause, previewRef, projectId, stage.w, stage.h]);

  if (!cues.length) return null;
  const at = (r: Rect): React.CSSProperties => ({
    left: `${(r.x / stage.w) * 100}%`, top: `${(r.y / stage.h) * 100}%`, width: `${(r.w / stage.w) * 100}%`, height: `${(r.h / stage.h) * 100}%`,
  });
  /* a cue as held: moved, scaled about its middle, or as wide as dragged */
  const asHeld = (cue: ShownCue): Rect => {
    const r = cue.text;
    if (!held || held.src !== cue.src || (held.ids && !held.ids.has(cue.id))) return r;
    const w = held.w != null ? held.w : r.w * held.k;
    const h = r.h * held.k;
    return { x: r.x + r.w / 2 - w / 2 + held.dx, y: r.y + r.h / 2 - h / 2 + held.dy, w, h };
  };
  return (
    <div ref={box} className="pointer-events-none absolute inset-0 z-[4]">
      {guide ? <div aria-hidden className="absolute inset-y-0 left-1/2 w-px" style={{ background: '#f0f', opacity: 0.9 }} /> : null}
      {cues.map((cue) => {
        const picked = sel?.src === cue.src && sel.ids.has(cue.id);
        const key = `${cue.src}#${cue.id}`;
        const r = asHeld(cue);
        return (
          <React.Fragment key={key}>
            <div data-caption-hit={cue.id} role="presentation"
              className="pointer-events-auto absolute cursor-default"
              style={{ ...at(r), outline: !picked && hover === key ? `1px solid ${FRAME_COLOR}` : undefined }}
              onPointerEnter={() => setHover(key)} onPointerLeave={() => setHover((h) => (h === key ? null : h))}
              onPointerDown={(e) => press(e, cue, 'move')} />
            {picked && !cue.locked ? (
              /* the frame every picked thing has: its corners scale, its sides stretch, its middle moves */
              <div data-caption-hit={cue.id} className="pointer-events-auto absolute inset-0" style={{ pointerEvents: 'none' }}
                onPointerDown={(e) => {
                  const el = (e.target as Element).closest('[data-layer-kind]');
                  const kind = el?.getAttribute('data-layer-kind');
                  const edge = el?.getAttribute('data-layer-handle');
                  if (kind === 'scale') press(e, cue, 'scale');
                  else if (kind === 'stretch' && (edge === 'e' || edge === 'w')) press(e, cue, edge === 'e' ? 'stretch-e' : 'stretch-w');
                  else if (kind === 'move' || kind === 'stretch') press(e, cue, 'move');
                }}>
                {/* the frame's own handles take the pointer (its border and ring do not) */}
                <div>
                  <StageTransformFrame scope="layer" edges rotate={false} label={null}
                    frame={{ cx: (r.x + r.w / 2) * scale, cy: (r.y + r.h / 2) * scale, w: r.w * scale, h: r.h * scale, r: 0 }} />
                </div>
              </div>
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/** The words of the cues (`ids`, or every cue: null) `k` times as big, as a corner of the frame scaled them. */
function scaled(vtt: Vtt, ids: ReadonlySet<string> | null, k: number): Vtt {
  const sizeAt = (prelude: string) => sizeOf(cueRule(vtt, prelude));
  const grow = (n: number) => `${Math.round(Math.min(SIZE_MAX, Math.max(SIZE_MIN, n * k)) * 100) / 100}cqmin`;
  const track = sizeAt('::cue') ?? 5;
  if (!ids) {
    let next = setCueRule(vtt, '::cue', lookDecls(cueRule(vtt, '::cue'), { '--size': grow(track) }));
    /* each cue with a size of its own keeps it, scaled too */
    for (const c of vtt.cues) {
      const own = sizeAt(`::cue(#${c.id})`);
      if (own != null) next = setCueRule(next, `::cue(#${c.id})`, lookDecls(cueRule(next, `::cue(#${c.id})`), { '--size': grow(own) }));
    }
    return next;
  }
  let next = vtt;
  for (const id of ids) next = setCueRule(next, `::cue(#${id})`, lookDecls(cueRule(next, `::cue(#${id})`), { '--size': grow(sizeAt(`::cue(#${id})`) ?? track) }));
  return next;
}
