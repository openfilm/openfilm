'use client';

import * as React from 'react';

/**
 * Keeps the conversation pinned to its latest line unless the user scrolls up.
 *
 * Re-renders are the wrong trigger: a streaming answer, an image finishing decoding, a
 * code block reflowing, a finished turn collapsing into a summary, or the composer
 * growing all change height without a new turn. So this watches size instead: a
 * ResizeObserver on the viewport and the content re-pins whenever either changes height
 * (the same approach as the use-stick-to-bottom library).
 *
 * Scrolling up releases the pin; scrolling back to the bottom resumes it. The release is
 * decided on `wheel`, not `scroll`: while content grows every frame and the observer
 * re-pins every frame, waiting for `scroll` makes the wheel feel stuck.
 */

/** How long the glide to the bottom takes after sending: visible, but no wait. */
const GLIDE_MS = 360;

/** How close to the bottom still counts as "at the bottom": about one line. */
const NEAR_BOTTOM_PX = 96;

export type StickToBottom = {
  /**
   * Goes on the overflow-y-auto box.
   *
   * A callback ref, not a ref object: the viewport may mount after the hook (the project
   * shows a loading screen first). A ref object would not notify anyone, so the
   * subscription would try once on the first frame, miss, and never follow.
   */
  viewportRef: (node: HTMLDivElement | null) => void;
  /** The viewport box itself, for other hooks (the tail spacer) to measure. */
  viewport: HTMLDivElement | null;
  /** Goes on the box that wraps all messages (a callback ref, so a swapped content box is picked up). */
  contentRef: (node: HTMLDivElement | null) => void;
  /** Whether the view is at the bottom now; decides whether "Back to latest" shows. */
  atBottom: boolean;
  /**
   * Pins to the bottom again and resumes following. Called on send and on "Back to latest".
   *
   * `smooth` glides instead of jumping, since a jump looks like a page reload. The glide
   * re-measures the bottom every frame, because the new bubble and the spacer grow meanwhile.
   */
  scrollToBottom: (opts?: { smooth?: boolean }) => void;
  /**
   * If following, pins again at the current height now. Does not change following.
   *
   * For content that grows or shrinks at the bottom while the viewport stays the same,
   * such as the padding under the asset drawer. Waiting for the observer would be one
   * frame late, which shows as a flash when the drawer closes.
   */
  pinIfFollowing: () => void;
  /**
   * Skips pinning on the next height change and stops following.
   *
   * Expanding or collapsing a summary changes height, and the observer would pin back to
   * the bottom, pulling away the row the user just clicked.
   */
  skipNextPin: () => void;
};

export const StickToBottomContext = React.createContext<StickToBottom | null>(null);

/**
 * While a turn runs, it may grow but not shrink.
 *
 * Finished tool rows collapse into a summary while the answer keeps growing; that
 * shrink would make the bottom-pinned view bounce back. So the running turn gets a
 * min-height equal to the tallest it has been, released when the run ends.
 *
 * The min-height only applies when the turn shrinks, so it is never a frame late: the
 * value was recorded while the turn grew.
 */
export function useTailSpacer(
  viewport: HTMLDivElement | null,
  pinIfFollowing: () => void,
  active = false,
): { lastTurnRef: (node: HTMLDivElement | null) => void } {
  const lastTurn = React.useRef<HTMLDivElement | null>(null);
  const observer = React.useRef<ResizeObserver | null>(null);
  const activeRef = React.useRef(active);
  activeRef.current = active;
  const tallest = React.useRef(0);
  const viewportSize = React.useRef('');

  const measure = React.useCallback(() => {
    const node = lastTurn.current;
    if (!viewport || !node) return;
    const size = `${viewport.clientWidth}:${viewport.clientHeight}`;
    if (viewportSize.current !== size) { tallest.current = 0; viewportSize.current = size; }
    let min = 0;
    if (activeRef.current) {
      tallest.current = Math.max(tallest.current, node.getBoundingClientRect().height);
      min = Math.max(min, Math.floor(tallest.current));
    } else tallest.current = 0;
    const next = min > 0 ? `${min}px` : '';
    if (node.style.minHeight !== next) {
      node.style.minHeight = next;
      pinIfFollowing();
    }
  }, [viewport, pinIfFollowing]);

  React.useLayoutEffect(() => { measure(); }, [active, measure]);

  React.useLayoutEffect(() => {
    if (!viewport) return undefined;
    const ro = new ResizeObserver(() => measure());
    observer.current = ro;
    ro.observe(viewport);
    if (lastTurn.current) ro.observe(lastTurn.current);
    measure();
    return () => {
      observer.current = null;
      ro.disconnect();
    };
  }, [measure, viewport]);

  /* A callback ref: each new turn becomes the last one, so the previous turn's min-height
     is cleared and the observer moves to the new box. */
  const lastTurnRef = React.useCallback((node: HTMLDivElement | null) => {
    const previous = lastTurn.current;
    if (previous && previous !== node) {
      observer.current?.unobserve(previous);
      previous.style.minHeight = '';
      tallest.current = 0;
    }
    lastTurn.current = node;
    if (node) observer.current?.observe(node);
    measure();
  }, [measure]);

  return { lastTurnRef };
}

export function useStickToBottom(): StickToBottom {
  /* The node is kept twice: the ref for synchronous reads in callbacks, the state so the
     subscription below re-attaches when the viewport finally mounts. */
  const viewportNode = React.useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = React.useState<HTMLDivElement | null>(null);
  const viewportRef = React.useCallback((node: HTMLDivElement | null) => {
    viewportNode.current = node;
    setViewport(node);
  }, []);
  const contentNode = React.useRef<HTMLDivElement | null>(null);
  const observer = React.useRef<ResizeObserver | null>(null);
  /* Following lives in a ref, not state: the observer reads it every frame and needs the
     current value, while state in its closure would be last frame's snapshot. */
  const following = React.useRef(true);
  const [atBottom, setAtBottom] = React.useState(true);

  /* While gliding, the glide pins each frame; the observer must not jump it to the end. */
  const glide = React.useRef<number | null>(null);
  const pin = React.useCallback(() => {
    const el = viewportNode.current;
    if (glide.current != null) return;
    // Overshoot and let the browser clamp to scrollHeight - clientHeight. Computing it
    // ourselves is half a pixel short at fractional scaling (125% displays).
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  const stopGlide = React.useCallback(() => {
    if (glide.current != null) cancelAnimationFrame(glide.current);
    glide.current = null;
  }, []);

  const scrollToBottom = React.useCallback((opts?: { smooth?: boolean }) => {
    following.current = true;
    setAtBottom(true);
    stopGlide();
    const el = viewportNode.current;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!el || !opts?.smooth || reduced) { pin(); return; }
    const from = el.scrollTop;
    const started = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - started) / GLIDE_MS);
      const eased = 1 - (1 - k) ** 3;
      const target = el.scrollHeight - el.clientHeight;
      if (!following.current) { glide.current = null; return; }
      if (k >= 1) { glide.current = null; el.scrollTop = el.scrollHeight; return; }
      el.scrollTop = from + (target - from) * eased;
      glide.current = requestAnimationFrame(step);
    };
    glide.current = requestAnimationFrame(step);
  }, [pin, stopGlide]);

  const pinIfFollowing = React.useCallback(() => {
    if (following.current) pin();
  }, [pin]);

  const skipPin = React.useRef(false);
  const skipGen = React.useRef(0);
  const skipNextPin = React.useCallback(() => {
    skipPin.current = true;
    following.current = false;
    setAtBottom(false);
    const gen = ++skipGen.current;
    /* The content grows on the click frame and the spacer shrinks on the next, so both
       observations are skipped. On repeated clicks only the last one counts. */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (skipGen.current === gen) skipPin.current = false;
      });
    });
  }, []);

  /* The content box can be swapped (empty state and conversation list), so a callback ref
     moves the observer to the new box. `observe` fires once right away, which pins. */
  const contentRef = React.useCallback((node: HTMLDivElement | null) => {
    if (contentNode.current) observer.current?.unobserve(contentNode.current);
    contentNode.current = node;
    if (node) observer.current?.observe(node);
  }, []);

  /* Re-subscribes whenever the viewport changes (first mount or a replaced tree); that is
     why `viewport` is a dependency. */
  React.useLayoutEffect(() => {
    const el = viewport;
    if (!el) return undefined;

    const nearBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
    let previousTop = el.scrollTop;
    const sync = () => {
      const near = nearBottom();
      const top = el.scrollTop;
      /* During a glide the bottom can move up (a turn collapsed) and scrollTop with it; that is not the user scrolling up */
      if (glide.current == null && top < previousTop - 1 && el.scrollHeight - top - el.clientHeight > 2) following.current = false;
      // Resizes and our own pin also emit scroll events. Only a downward user
      // scroll all the way to the bottom resumes following after an upward wheel.
      if (!following.current && top > previousTop && el.scrollHeight - top - el.clientHeight <= 2) {
        following.current = true;
      }
      previousTop = top;
      setAtBottom(following.current && near);
    };
    const release = () => {
      // When the content does not scroll yet, a wheel up does nothing and does not release.
      if (el.scrollHeight <= el.clientHeight + 1) return;
      stopGlide();
      following.current = false;
      setAtBottom(false);
    };

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) release();
    };
    let lastTouchY = 0;
    const onTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0;
      if (y > lastTouchY + 2) release();
      lastTouchY = y;
    };

    el.addEventListener('scroll', sync, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });

    const ro = new ResizeObserver(() => {
      if (skipPin.current) {
        /* Only update `atBottom`; do not resume following or clear the flag. This height
           change came from a click, not from content growing; sync() would resume
           following while still at the bottom, and the spacer frame would pin again. */
        const near = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
        setAtBottom((was) => (was === near ? was : near));
        return;
      }
      if (following.current) pin();
    });
    observer.current = ro;
    ro.observe(el);
    if (contentNode.current) ro.observe(contentNode.current);
    pin();

    return () => {
      observer.current = null;
      ro.disconnect();
      el.removeEventListener('scroll', sync);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [pin, stopGlide, viewport]);

  return React.useMemo(
    () => ({
      viewportRef,
      viewport,
      contentRef,
      atBottom,
      scrollToBottom,
      pinIfFollowing,
      skipNextPin,
    }),
    [
      viewportRef,
      viewport,
      contentRef,
      atBottom,
      scrollToBottom,
      pinIfFollowing,
      skipNextPin,
    ],
  );
}
