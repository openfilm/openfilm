/**
 * The viewer's picture, zoomed and panned (lib/viewer-zoom): a pinch or ⌘/Ctrl + wheel zooms about
 * the pointer; while it is not fitted, a scroll (Shift + wheel: sideways) or a drag with the middle button pans. The
 * picture is laid out at its zoomed size, not scaled by a transform, so the stage's handles, outlines and snapping,
 * all measured on screen, keep their size and feel at any zoom. ViewerZoomButton, in the viewer's bar, fits it again.
 * Nothing zooms or pans while a button is held: a drag on the stage keeps the places it measured at the press.
 * The film is drawn for the zoom once it settles (ZOOM_SETTLE_MS still, nothing held, typed or cropped): loaded again
 * behind the picture, as for a resized viewer, so a page's canvas is as sharp as it is seen; that load is shown only
 * when nothing is under way (`busy`), so a drag or a line typed in place started meanwhile goes on in the film it began in.
 */
import React from 'react';
import { useT } from '@/i18n';
import {
  FIT_VIEW, PictureZoom, ZOOM_SETTLE_MS, fittedSize, isFit, panBy, shownRect, wheelPx, wheelZoomFactor, zoomAt, zoomLayout, zoomMax,
  type ViewerView, type ViewerZoomStore,
} from '@/lib/viewer-zoom';
import { PANE_BTN } from './dock-pane-bar';
import { Tooltip } from './Tooltip';

type Size = { w: number; h: number };

/** How long after a drag or an edit in place ends a new drawing of the film still waits: its edit is written by then. */
const BUSY_AFTER_MS = 600;

/** The picture fitted in its container (the container's size, CSS container units). */
const fitBox = (w: number, h: number): React.CSSProperties => ({
  width: `min(100cqw, 100cqh * ${w} / ${h})`,
  height: `min(100cqh, 100cqw * ${h} / ${w})`,
});

export function ViewerZoom({ store, frame, off, className, notices, children }: {
  store: ViewerZoomStore;
  /** The film's canvas, px. */
  frame: Size;
  /** Fitted and still (full screen): the zoom is kept for when it comes back. */
  off?: boolean;
  /** The picture's box's classes. */
  className?: string;
  /** Over the part of the picture on screen, not on it: notices that must stay in sight at any zoom. */
  notices?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const scroller = React.useRef<HTMLDivElement>(null);
  const { view } = React.useSyncExternalStore(store.subscribe, store.get, store.get);
  const [viewer, setViewer] = React.useState<Size | null>(null);
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const size = () => setViewer((had) => (had && had.w === el.clientWidth && had.h === el.clientHeight ? had : { w: el.clientWidth, h: el.clientHeight }));
    size();
    const observer = new ResizeObserver(size);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const fitted = viewer && viewer.w > 0 && viewer.h > 0 ? fittedSize(viewer, frame) : null;
  React.useEffect(() => { store.setFitK(fitted ? fitted.w / frame.w : null); }, [store, fitted?.w, frame.w]); // eslint-disable-line react-hooks/exhaustive-deps

  const layout = !off && viewer && fitted && !isFit(view) ? zoomLayout(view, viewer, fitted) : null;
  /* the scroll is the view's center: put there in the same frame as the size, so a zoom never jumps */
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !layout) return;
    el.scrollLeft = layout.scroll.x;
    el.scrollTop = layout.scroll.y;
  });

  /* a button held anywhere (a drag on the stage, a pan): no zoom, and the film is not drawn again under it */
  const held = React.useRef(false);
  /* when the last of them ended (performance.now()): what it kept reaches the film a moment later */
  const ended = React.useRef(-Infinity);
  React.useEffect(() => {
    const onPress = (e: PointerEvent) => {
      if (held.current && e.buttons === 0) ended.current = performance.now();
      held.current = e.buttons !== 0;
    };
    const onLetGo = () => {
      if (held.current) ended.current = performance.now();
      held.current = false;
    };
    window.addEventListener('pointerdown', onPress, true);
    window.addEventListener('pointerup', onPress, true);
    window.addEventListener('pointercancel', onLetGo, true);
    window.addEventListener('blur', onLetGo);
    /* the stage says when words are typed in place or a crop is open (FilmStageSelect, data-stage-busy) */
    const stage = new MutationObserver((changes) => {
      if (changes.some((c) => c.oldValue != null && !(c.target as Element).hasAttribute('data-stage-busy'))) ended.current = performance.now();
    });
    if (scroller.current) stage.observe(scroller.current, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['data-stage-busy'] });
    return () => {
      window.removeEventListener('pointerdown', onPress, true);
      window.removeEventListener('pointerup', onPress, true);
      window.removeEventListener('pointercancel', onLetGo, true);
      window.removeEventListener('blur', onLetGo);
      stage.disconnect();
    };
  }, []);

  /**
   * A button held (a mask's knobs too), words typed in place, a crop open, or one of them just ended (what it kept is
   * on its way to the film, BUSY_AFTER_MS): the film is not drawn again, nor a new drawing shown.
   */
  const busy = React.useCallback(() => held.current || performance.now() - ended.current < BUSY_AFTER_MS
    || Boolean(scroller.current?.querySelector('[data-film-select][data-stage-busy]')), []);

  /* the zoom the film is drawn for: the shown one once it has been still a while, with nothing held or typed in */
  const z = layout ? view.z : 1;
  const [drawn, setDrawn] = React.useState(1);
  React.useEffect(() => {
    if (z === drawn) return undefined;
    let timer = 0;
    const settle = () => {
      timer = window.setTimeout(() => { if (busy()) settle(); else setDrawn(z); }, ZOOM_SETTLE_MS);
    };
    settle();
    return () => window.clearTimeout(timer);
  }, [z, drawn, busy]);
  const zoom = React.useMemo(() => ({ z, drawn, busy }), [z, drawn, busy]);

  const now = React.useRef({ viewer, fitted, off });
  now.current = { viewer, fitted, off };
  React.useEffect(() => {
    const el = scroller.current;
    const area = el?.closest<HTMLElement>('[data-viewer-picture]') ?? el;
    if (!el || !area) return undefined;
    /* one step per frame: a pinch sends a hundred wheel events a second */
    let factor = 1, dx = 0, dy = 0;
    let anchor = { x: 0, y: 0 };
    let raf = 0;
    const flush = () => {
      raf = 0;
      const { viewer: v, fitted: f } = now.current;
      if (!v || !f) { factor = 1; dx = 0; dy = 0; return; }
      let next: ViewerView = store.get().view;
      if (factor !== 1) next = zoomAt(next, factor, anchor, v, f, zoomMax(f.w / frame.w));
      if (dx || dy) next = panBy(next, dx, dy, f);
      factor = 1; dx = 0; dy = 0;
      store.set(next);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(flush); };
    const onWheel = (e: WheelEvent) => {
      if (now.current.off) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.buttons) return;
        factor *= wheelZoomFactor(wheelPx(e, e.deltaY));
        const r = el.getBoundingClientRect();
        anchor = { x: e.clientX - r.left, y: e.clientY - r.top };
        schedule();
        return;
      }
      if (isFit(store.get().view)) return;
      e.preventDefault();
      if (e.buttons) return;
      /* a mouse's wheel turned with Shift scrolls sideways (macOS does it itself, as deltaX) */
      const sideways = e.shiftKey && !e.deltaX;
      dx += wheelPx(e, sideways ? e.deltaY : e.deltaX);
      dy += sideways ? 0 : wheelPx(e, e.deltaY);
      schedule();
    };
    /* the middle button drags the picture (Windows' autoscroll would take it otherwise) */
    const onDown = (e: PointerEvent) => {
      if (e.button !== 1 || now.current.off || isFit(store.get().view)) return;
      e.preventDefault();
      e.stopPropagation();
      let last = { x: e.clientX, y: e.clientY };
      const move = (m: PointerEvent) => {
        dx += last.x - m.clientX;
        dy += last.y - m.clientY;
        last = { x: m.clientX, y: m.clientY };
        schedule();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    };
    /* Safari sends a pinch as gesture events, its scale since the pinch began, rather than as Ctrl + wheel */
    let pinched = 1;
    const onGesture = (e: Event) => {
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      e.preventDefault();
      if (e.type === 'gesturestart') pinched = 1;
      if (now.current.off || held.current || !(g.scale > 0)) return;
      factor *= g.scale / pinched;
      pinched = g.scale;
      const r = el.getBoundingClientRect();
      anchor = { x: g.clientX - r.left, y: g.clientY - r.top };
      schedule();
    };
    area.addEventListener('wheel', onWheel, { passive: false });
    area.addEventListener('pointerdown', onDown, true);
    area.addEventListener('gesturestart', onGesture);
    area.addEventListener('gesturechange', onGesture);
    return () => {
      area.removeEventListener('wheel', onWheel);
      area.removeEventListener('pointerdown', onDown, true);
      area.removeEventListener('gesturestart', onGesture);
      area.removeEventListener('gesturechange', onGesture);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [store, frame.w]);

  const shown = viewer && fitted ? shownRect(layout ? view : FIT_VIEW, viewer, fitted) : null;
  /* one tree fitted or zoomed (only its styles change): the film's frames inside are never loaded again by a zoom */
  return (
    <>
    <div ref={scroller} className="absolute inset-0" data-viewer-zoom={layout ? '' : undefined}
      style={{ overflow: layout ? 'hidden' : 'visible', overflowAnchor: 'none' }}>
      <div className={layout ? 'relative' : 'flex h-full w-full items-center justify-center'}
        style={layout ? { width: layout.box.w, height: layout.box.h } : undefined}>
        <div className={className}
          style={{
            ...(layout
              ? { position: 'absolute', left: layout.picture.x, top: layout.picture.y, width: layout.picture.w, height: layout.picture.h }
              : fitBox(frame.w, frame.h)),
            containerType: 'size',
          }}>
          <PictureZoom.Provider value={zoom}>{children}</PictureZoom.Provider>
        </div>
      </div>
    </div>
    {notices && shown ? (
      <div className="pointer-events-none absolute" style={{ left: shown.x, top: shown.y, width: shown.w, height: shown.h }}>{notices}</div>
    ) : null}
    </>
  );
}

/** The zoom, in the viewer's bar while the picture is not fitted: a press fits it again. */
export function ViewerZoomButton({ store }: { store: ViewerZoomStore }) {
  const t = useT();
  const { view, fitK } = React.useSyncExternalStore(store.subscribe, store.get, store.get);
  if (isFit(view) || fitK == null) return null;
  return (
    <Tooltip label={t('viewer.zoomFit')}>
      <button
        type="button"
        onClick={() => store.set(FIT_VIEW)}
        onMouseDown={(e) => e.preventDefault()}
        aria-label={t('viewer.zoomFit')}
        data-viewer-zoom-fit=""
        className={`${PANE_BTN} !w-auto min-w-[22px] px-1 text-[12px] tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]`}
      >
        {Math.round(view.z * fitK * 100)}%
      </button>
    </Tooltip>
  );
}
