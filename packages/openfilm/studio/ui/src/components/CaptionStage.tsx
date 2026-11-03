/**
 * The caption cues on the picture (SPEC §1 Captions), pointed at where they are drawn: a click selects one (⇧/⌘-click
 * one more or one less), as on its track's row, and its look shows in the inspector; a drag moves it. With "Apply to
 * all captions" on the drag moves every cue of the track, off only the picked ones (lib/caption-edits `placeCues`).
 * While dragging the film shows them moved (stage `captionShift`); on release the file is written once.
 *
 * The cues are drawn by the film, on its own origin: where each is is asked of its stage (studio/server/stage.js
 * `captions`) when the moment shown or a caption file changes. Only the cues have a hit box, so the rest of the
 * picture is FilmStageSelect's as before. Mount it in the Preview, over the picture, in stage px scaled to its box.
 */
import * as React from 'react';
import type { PreviewHandle } from '@/editor/Preview';
import { placeCues, type CueBox } from '@/lib/caption-edits';
import {
  captionApplyAllNow, captionSelectionNow, captionTrackNow, setCaptionSelection, useCaptionSelection, useCaptionTracksVersion, writeCaptionTrack,
} from '@/lib/caption-tracks';
import { DRAG_THRESHOLD_PX } from '@/lib/timeline-drag';

type Rect = { x: number; y: number; w: number; h: number };
type ShownCue = { track: number; src: string; id: string; locked: boolean; box: Rect; text: Rect };

/** How near the frame's middle a dragged cue's middle snaps to it (screen px). */
const SNAP_PX = 6;
const BLUE = '#0d99ff';

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
  /* the cues in hand, shown moved by (dx, dy) stage px until the film has drawn where they went (`ids` null: the track's) */
  const shown = React.useRef<ShownCue[]>([]);
  const [held, setHeld] = React.useState<{ src: string; ids: ReadonlySet<string> | null; dx: number; dy: number } | null>(null);
  /* asked again once a file written is drawn (the film reads it on its own time) */
  const [again, setAgain] = React.useState(0);

  /* where the cues are: asked once the film has drawn the moment (and read a file written, which takes a moment) */
  React.useEffect(() => {
    let gone = false;
    const ask = () => {
      if (dragging.current) return;
      void previewRef.current?.stage?.<ShownCue[]>('captions').then((list) => {
        if (gone || dragging.current) return;
        const next = list ?? [];
        /* drawn where they went: the boxes held moved are let go */
        if (JSON.stringify(next) !== JSON.stringify(shown.current)) setHeld(null);
        shown.current = next;
        setCues(next);
      });
    };
    const timers = [40, 300, 900].map((ms) => window.setTimeout(ask, ms));
    return () => { gone = true; for (const id of timers) window.clearTimeout(id); };
  }, [previewRef, timeMs, version, again]);

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

  const press = React.useCallback((e: React.PointerEvent, cue: ShownCue) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onPause?.();
    const now = captionSelectionNow();
    let ids = new Set(now?.src === cue.src ? now.ids : []);
    if (e.shiftKey || e.metaKey || e.ctrlKey) { if (ids.has(cue.id)) ids.delete(cue.id); else ids.add(cue.id); }
    else if (!ids.has(cue.id)) ids = new Set([cue.id]);
    setCaptionSelection({ src: cue.src, ids });
    onPick();
    const frame = box.current?.getBoundingClientRect();
    if (cue.locked || !frame || !ids.has(cue.id)) return;

    const all = captionApplyAllNow();
    const moving = cues.filter((c) => c.src === cue.src && (all || ids.has(c.id)));
    const from = { x: e.clientX, y: e.clientY };
    let shift = { dx: 0, dy: 0 };
    let raf = 0;
    const show = () => {
      raf = 0;
      setHeld({ src: cue.src, ids: all ? null : ids, dx: shift.dx, dy: shift.dy });
      void previewRef.current?.stage?.('captionShift', { track: cue.track, ids: all ? null : [...ids], dx: shift.dx, dy: shift.dy });
    };
    const move = (ev: PointerEvent) => {
      if (!dragging.current && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < DRAG_THRESHOLD_PX) return;
      dragging.current = true;
      /* the scale as the picture is now: the inspector opening on the press narrows it */
      const now = box.current?.getBoundingClientRect() ?? frame;
      const sx = stage.w / now.width, sy = stage.h / now.height;
      let dx = (ev.clientX - from.x) * sx;
      const dy = (ev.clientY - from.y) * sy;
      /* its middle on the frame's middle, when it comes near: a caption is centered more than anything */
      const mid = cue.box.x + cue.box.w / 2 + dx - stage.w / 2;
      const snapped = Math.abs(mid) / sx <= SNAP_PX;
      if (snapped) dx -= mid;
      setGuide(snapped);
      shift = { dx, dy };
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
      /* held where they were let go until the film draws them there */
      setHeld({ src: cue.src, ids: all ? null : ids, dx: shift.dx, dy: shift.dy });
      const done = () => {
        dragging.current = false;
        void previewRef.current?.stage?.('captionShift', { track: cue.track, ids: null, dx: 0, dy: 0 });
        setAgain((n) => n + 1);
      };
      if (!vtt) { setHeld(null); done(); return; }
      const next = placeCues(vtt, all ? null : ids, (shift.dx / stage.w) * 100, (shift.dy / stage.h) * 100, drawn);
      void writeCaptionTrack(projectId, cue.src, next, 'captionTrack.stepPlace').finally(done);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [cues, onPick, onPause, previewRef, projectId, stage.w, stage.h]);

  if (!cues.length) return null;
  const at = (r: Rect): React.CSSProperties => ({
    left: `${(r.x / stage.w) * 100}%`, top: `${(r.y / stage.h) * 100}%`, width: `${(r.w / stage.w) * 100}%`, height: `${(r.h / stage.h) * 100}%`,
  });
  return (
    <div ref={box} className="pointer-events-none absolute inset-0 z-[4]">
      {guide ? <div aria-hidden className="absolute inset-y-0 left-1/2 w-px" style={{ background: '#f0f', opacity: 0.9 }} /> : null}
      {cues.map((cue) => {
        const picked = sel?.src === cue.src && sel.ids.has(cue.id);
        const key = `${cue.src}#${cue.id}`;
        const moved = held && held.src === cue.src && (!held.ids || held.ids.has(cue.id));
        const r = moved ? { ...cue.text, x: cue.text.x + held.dx, y: cue.text.y + held.dy } : cue.text;
        return (
          <div key={key} data-caption-hit={cue.id} role="presentation"
            className={`pointer-events-auto absolute ${cue.locked ? '' : 'cursor-move'}`}
            style={{ ...at(r), outline: picked ? `1.5px solid ${BLUE}` : hover === key ? `1px solid ${BLUE}` : undefined, outlineOffset: 2 }}
            onPointerEnter={() => setHover(key)} onPointerLeave={() => setHover((h) => (h === key ? null : h))}
            onPointerDown={(e) => press(e, cue)} />
        );
      })}
    </div>
  );
}
