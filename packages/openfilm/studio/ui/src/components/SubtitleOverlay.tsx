/**
 * Subtitles over the picture.
 *
 * Subtitles are not part of the film: how they look, where they sit and whether they show is a preference (large
 * type, two languages, none), and drawing them into the film would decide for everyone and mean rendering the film
 * again for every change of look. So the film only says what is said when; the editor lays the lines over the
 * picture here, and exports burn them in or write them as files from the same cues and the same CSS
 * (studio/server/film-subtitle.mjs), so the preview is what the export shows.
 *
 * Moved by dragging, not by top/bottom presets: what a subtitle has to stay clear of differs in every film. Dragging
 * shows exactly where it lands.
 *
 * Mount it as a direct child of the delivery frame's box (the `position: relative` box with `container-type: size`
 * around the picture, letterbox included): positions are fractions of that box, and the font size is in its `cqmin`.
 */
import * as React from 'react';

import {
  cueAt,
  cueText,
  filmSubtitleWordCss,
  filmSubtitleWords,
  snapAxis,
  SNAP_X,
  SNAP_Y,
  subtitleCss,
  type SubtitleCue,
  type SubtitleStyle,
} from '@/lib/subtitles';

export function SubtitleOverlay({
  cues, timeMs, style, onMove,
}: {
  /** The lines as shown (see useFilmSubtitles: the picked language already applied). */
  cues: readonly SubtitleCue[];
  timeMs: number;
  /** The style for this frame (filmSubtitleStyleFor(style, frame)): off → nothing is drawn. */
  style: SubtitleStyle;
  /** Where it was dragged to (fractions of the frame). Without it the subtitle cannot be dragged (read only). */
  onMove?: (pos: { x: number; y: number }) => void;
}): React.ReactElement | null {
  const cue = React.useMemo(() => (style.on ? cueAt(cues, timeMs) : null), [cues, timeMs, style.on]);
  const box = React.useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = React.useState(false);
  /* while dragging the position lives here: handing every move up would re-render the whole editor each time.
     It is handed up once, on release. */
  const [livePos, setLivePos] = React.useState<{ x: number; y: number } | null>(null);
  /** The line it is snapped to now (fraction of the frame); null = none, and no line drawn. */
  const [guides, setGuides] = React.useState<{ x: number | null; y: number | null }>({ x: null, y: null });

  const onPointerDown = React.useCallback((e: React.PointerEvent) => {
    if (!onMove || e.button !== 0) return;
    const frame = box.current?.parentElement;
    if (!frame) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
    const rect = frame.getBoundingClientRect();
    /* how far from the anchor it was grabbed, or it would jump under the pointer. The anchor is `pos` itself (the line
       nearest the frame's edge, see filmSubtitleCss), not the block's center: with two lines they differ */
    const dx = e.clientX - (rect.left + style.pos.x * rect.width);
    const dy = e.clientY - (rect.top + style.pos.y * rect.height);

    let last: { x: number; y: number } | null = null;
    let raf = 0;
    const move = (ev: PointerEvent): void => {
      /* kept inside the picture: dragged out, it would vanish, and nobody thinks "it is still there, off the frame" */
      const rawX = Math.min(0.98, Math.max(0.02, (ev.clientX - dx - rect.left) / rect.width));
      const rawY = Math.min(0.98, Math.max(0.02, (ev.clientY - dy - rect.top) / rect.height));
      const x = snapAxis(rawX, rect.width, SNAP_X);
      const y = snapAxis(rawY, rect.height, SNAP_Y);
      /* a line only while snapped: always drawn, the center lines would be decoration; this one says "aligned now" */
      last = { x: x.value, y: y.value };
      const guide = { x: x.guide, y: y.guide };
      /* once a frame: pointer moves come far more often than the screen refreshes */
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          setGuides(guide);
          setLivePos(last);
        });
      }
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (raf) cancelAnimationFrame(raf);
      setDragging(false);
      setGuides({ x: null, y: null });
      setLivePos(null);
      if (last) onMove(last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [onMove, style.pos.x, style.pos.y]);

  if (!cue) return null;
  /* position, size, color, stroke and box all come from the shared function; this layer adds only what editing has:
     the move cursor and the dashed outline while dragging */
  const css = subtitleCss(livePos ? { ...style, pos: livePos } : style);
  return (
    <>
      {/* snap lines run across the whole frame: they say how the subtitle sits against the picture */}
      {guides.x !== null ? <Guide axis="x" at={guides.x} /> : null}
      {guides.y !== null ? <Guide axis="y" at={guides.y} /> : null}
      <div
        ref={box}
        role={onMove ? 'presentation' : undefined}
        onPointerDown={onPointerDown}
        className={onMove ? 'cursor-move' : 'pointer-events-none'}
        style={css.box as React.CSSProperties}
      >
        <span
          style={{
            ...(css.text as React.CSSProperties),
            /* subtitles have no edge of their own: the outline shows what is being held */
            ...(dragging ? { outline: '1px dashed rgba(255,255,255,0.7)', outlineOffset: 3 } : {}),
          }}
        >
          {style.karaoke ? (
            filmSubtitleWords(cue, timeMs).map((w, i) => (
              w.active
                ? <span key={i} style={filmSubtitleWordCss(style) as React.CSSProperties}>{w.text}</span>
                : <React.Fragment key={i}>{w.text}</React.Fragment>
            ))
          ) : cueText(cue)}
        </span>
      </div>
    </>
  );
}

/** A snap line. Magenta is what design tools use for these; it needs no explaining. */
function Guide({ axis, at }: { axis: 'x' | 'y'; at: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-10"
      style={axis === 'x'
        ? { left: `${at * 100}%`, top: 0, bottom: 0, width: 1, background: '#f0f', opacity: 0.9 }
        : { top: `${at * 100}%`, left: 0, right: 0, height: 1, background: '#f0f', opacity: 0.9 }}
    />
  );
}
