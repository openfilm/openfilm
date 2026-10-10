/**
 * Draggable pane seam: the user decides how much room the picture gets versus the media pane,
 * the inspector and the timeline.
 *
 * The sides serve different jobs: you want a bigger picture when inspecting details, and a
 * wider pane or a taller timeline when working on a long edit. A fixed ratio always
 * shortchanges one of them, and only the user knows the trade-off at that moment.
 *
 * Modeled on Unreal: the gap between the panes is the seam, and the seam is the handle. Its
 * width must therefore equal the spacing between panes (DOCK_GAP); one pixel off makes it look crooked.
 *
 * With a mouse the seam draws nothing. Hovering already turns the cursor into a resize arrow,
 * and while dragging the panes widen under the hand, which is the most direct feedback there
 * is. Lighting up a line would say the same thing a third time, and it would flicker whenever
 * the pointer merely crosses the seam (a seam between panes is on the path across the screen).
 * CapCut and Unreal work this way: the cursor says where you can drag, the content says what is happening.
 *
 * It lights up only when reached by keyboard: there is no cursor shape and no held button
 * then, so without a highlight a keyboard user cannot tell which seam has focus.
 *
 * The size is stored in localStorage: it is a "this is how I like to work" preference, not a
 * one-off action; having to drag it again for every film would defeat the point.
 */
import React from 'react';

/** Gap between panes (px); the workspace's outer margin uses the same value so the seams line up. */
export const DOCK_GAP = 6;

/** A 6px seam is too thin to grab with a mouse, so the grab area is widened to 14px using negative margins, without taking layout space. */
const GRAB = 14;
const BLEED = (GRAB - DOCK_GAP) / 2;

/**
 * The viewer / inspector pair. The inspector is sized for two columns of number fields;
 * any narrower and the inputs pile on top of each other. The viewer keeps room for the
 * picture and its transport bar.
 */
export const MIN_INSPECTOR = 240;
export const MIN_VIEWER = 280;

/**
 * Default inspector width when first opened.
 *
 * The minimum (240) is the "any narrower and it breaks" line, not a comfortable width. Each
 * number field sits next to a label; narrower and the two columns get only a dozen or so
 * pixels each, and the font-name field collapses to an ellipsis. The first impression would be
 * a cramped column, and people do not think to drag it wider; they assume that is how the
 * panel looks. Users who have resized it are unaffected: usePaneSize stores their own value.
 */
export const DEFAULT_INSPECTOR = 300;

/**
 * Height limits for the pane below the viewer (the timeline).
 *
 * The minimum fits "toolbar + ruler + one video track": shorter and not even one track is
 * fully visible, and a timeline that shows no track is broken, not just small. The maximum is
 * not an absolute height but "the viewer must keep at least MIN_STAGE_H"; dragging the
 * timeline to the top would leave the player as a sliver.
 */
export const MIN_DOCK_H = 104;
export const MIN_STAGE_H = 220;

function clampDock(
  height: number,
  containerHeight: number,
  min: number,
  minRest: number,
): number {
  return Math.max(min, Math.min(height, Math.max(min, containerHeight - minRest)));
}

function clampAside(width: number, containerWidth: number, min: number, minRest: number): number {
  return Math.max(min, Math.min(width, Math.max(min, containerWidth - minRest)));
}

/**
 * Persists a pane size (width or height); shared by both seams.
 *
 * `min` is **today's** minimum: the stored number was set by the user on some earlier version
 * of the UI, and what the pane holds changes (the timeline later grew the audio tracks).
 * Restoring the old number could give a height that used to be enough and no longer fits,
 * and the user would think it is broken. What is stored is a preference, not a guarantee.
 */
export function usePaneSize(storageKey: string, fallback = 420, min = 0) {
  // Null until the effect below has read the stored size.
  const [width, setWidth] = React.useState<number | null>(null);
  /* Whether the user has ever dragged it. If not, the caller may pick a better default based on
     content (see the timeline's timelineFitHeight); once dragged, the user's value always wins. */
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    let stored = NaN;
    try { stored = Number(localStorage.getItem(storageKey)); } catch { /* unreadable: treat as never stored */ }
    const has = Number.isFinite(stored) && stored > 0;
    setSaved(has);
    setWidth(Math.max(min, has ? stored : fallback));
  }, [storageKey, fallback, min]);

  const commit = React.useCallback((next: number) => {
    setSaved(true);
    setWidth(next);
    try {
      localStorage.setItem(storageKey, String(Math.round(next)));
    } catch {
      // Writes fail in private mode. Not worth surfacing an error for a width; it works for this session.
    }
  }, [storageKey]);

  return { width, commit, saved };
}

export function PaneDivider({
  width,
  onResize,
  containerRef,
  label,
  min,
  minRest,
  side = 'start',
}: {
  /** Current width (px) of the measured pane; `side` decides which one it is. */
  width: number;
  onResize: (next: number) => void;
  /** The row that holds the panes; its bounds are used for the math, not the window width. */
  containerRef: React.RefObject<HTMLElement | null>;
  label: string;
  /** Narrowest the measured pane may get; the rest must keep at least minRest. */
  min: number;
  minRest: number;
  /** Which pane is measured. Use 'end' when the fixed-width pane is on the right: the math runs from the right edge. */
  side?: 'start' | 'end';
}) {
  const [dragging, setDragging] = React.useState(false);
  const fromEnd = side === 'end';

  const applyFromClientX = React.useCallback((clientX: number) => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    /* Measure inward from the measured pane's own outer edge. When the fixed-width pane is on the
       right, dragging left widens it, so the measurement is reversed; computing from the left
       would make the drag direction and the width change opposite. */
    const next = fromEnd ? box.right - clientX : clientX - box.left;
    onResize(clampAside(next, box.width, min, minRest));
  }, [containerRef, fromEnd, onResize, min, minRest]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    // Capture the pointer so that when the drag passes over the player iframe, events still
    // come back here instead of being swallowed by the iframe; without it the drag breaks as
    // soon as the mouse enters the viewer.
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    applyFromClientX(event.clientX);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  };

  /** Keyboard resizing too: if dragging were the only way, people without a mouse could not use this. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    /* Arrow keys follow the hand: with the measured pane on the left, Right widens it; on the right, the reverse. */
    const grow = event.key === (fromEnd ? 'ArrowLeft' : 'ArrowRight');
    const shrink = event.key === (fromEnd ? 'ArrowRight' : 'ArrowLeft');
    if (!grow && !shrink) return;
    event.preventDefault();
    onResize(clampAside(width + (grow ? step : -step), box.width, min, minRest));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      style={{ width: GRAB, marginLeft: -BLEED, marginRight: -BLEED }}
      /* pointer-events-auto is for canvas mode: the whole pane layer then ignores the mouse
         (see ProjectView), so the seam must opt back in or the side pane could not be resized. */
      className={`group pointer-events-auto relative z-10 flex shrink-0 cursor-col-resize touch-none items-stretch justify-center outline-none ${
        dragging ? 'select-none' : ''
      }`}
    >
      <div
        style={{ width: DOCK_GAP }}
        className="pointer-events-none rounded-full bg-[var(--text-faint)] opacity-0 transition-opacity duration-150 group-focus-visible:opacity-40"
      />
    </div>
  );
}

/**
 * The horizontal seam: viewer above, timeline below.
 *
 * It measures the **lower** pane, so the math runs upward from the container's bottom edge:
 * moving the hand up makes it taller. The vertical seam measures the left pane from the left
 * edge; it is the same idea mirrored.
 */
export function DockPaneDivider({
  height,
  onResize,
  containerRef,
  label,
  min = MIN_DOCK_H,
  minRest = MIN_STAGE_H,
}: {
  /** Current height (px) of the lower pane. */
  height: number;
  onResize: (next: number) => void;
  containerRef: React.RefObject<HTMLElement | null>;
  label: string;
  /** Shortest the lower pane may get; the part above must keep at least minRest. Defaults suit the viewer / timeline pair. */
  min?: number;
  minRest?: number;
}) {
  const [dragging, setDragging] = React.useState(false);

  const applyFromClientY = React.useCallback((clientY: number) => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    onResize(clampDock(box.bottom - clientY, box.height, min, minRest));
  }, [containerRef, onResize, min, minRest]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    applyFromClientY(event.clientY);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    // Up arrow makes the lower pane taller (it grows from the bottom, so dragging up enlarges it).
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      onResize(clampDock(height + step, box.height, min, minRest));
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      onResize(clampDock(height - step, box.height, min, minRest));
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuenow={Math.round(height)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      style={{ height: GRAB, marginTop: -BLEED, marginBottom: -BLEED }}
      className={`group relative z-10 flex shrink-0 cursor-row-resize touch-none items-center justify-stretch outline-none ${
        dragging ? 'select-none' : ''
      }`}
    >
      <div
        style={{ height: DOCK_GAP }}
        className="pointer-events-none w-full rounded-full bg-[var(--text-faint)] opacity-0 transition-opacity duration-150 group-focus-visible:opacity-40"
      />
    </div>
  );
}
