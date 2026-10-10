/**
 * Hover tooltip: the kind that appears after half a second.
 *
 * Does not use the browser's native `title`: its delay is set by the OS (a second or two in
 * practice), while a row of icon buttons on a toolbar relies on it to say "what is this".
 * By the time it appears, the user has already clicked to find out. Mature editors use about half a second.
 *
 * The delay applies only the **first** time: moving from one button to another within half a
 * second shows the tooltip immediately. When the hand is already sweeping along the toolbar,
 * waiting half a second for each one is more annoying than no tooltip at all.
 *
 * Placement: above the button by default. Most buttons in the workspace (player bar,
 * timeline toolbar) sit along the bottom edge or in the middle of the screen, so a tooltip
 * rising upward blocks nothing. The top bar is the exception: the window edge is right above
 * it, so its tooltips must go below (`side="bottom"`).
 *
 * Shortcuts are written as `Name (⌘Z)`, after the name and one step dimmer. The modifier
 * follows the platform (see lib/shortcut-hint): ⌘ on Mac, Ctrl elsewhere; hard-coding one
 * would leave people on the other platform pressing keys that do nothing.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';

/** How long to wait on the first hover. */
const DELAY_MS = 500;
/** How long after leaving the pointer still counts as "in this area"; moving to another button within this time skips the wait. */
const WARM_MS = 600;

let warmUntil = 0;

/** Minimum distance between the bubble and the window edge. */
const EDGE_PAD = 8;
/** The arrow may go at most this far toward the bubble's ends; further and it would climb onto the rounded corner, and the missing corner would look like a rendering bug. */
const ARROW_INSET = 12;

export function Tooltip({
  label, shortcut, side = 'top', children,
}: {
  /** Empty string/undefined = no tooltip right now (e.g. a "Restore" button sitting on the current version); the child is passed through untouched. */
  label: string | undefined;
  /** Shortcut (the string already arranged for the platform, from shortcutHint). Shown as `Name (⌘Z)`. */
  shortcut?: string;
  /** Which side the tooltip appears on. Top-bar buttons use `bottom`; everything else defaults to above. */
  side?: 'top' | 'bottom';
  /** The element the tooltip attaches to. Must accept a ref and mouse events. */
  children: React.ReactElement;
}): React.ReactElement {
  const [at, setAt] = React.useState<{ x: number; y: number } | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const host = React.useRef<HTMLElement | null>(null);
  const bubble = React.useRef<HTMLDivElement | null>(null);
  /** Only after measuring do we know how far to shift back and where the arrow goes. Do not paint before then (see visibility below). */
  const [fit, setFit] = React.useState<{ shift: number; arrow: number } | null>(null);

  /* Buttons near the edge: a bubble centered on the button would stick halfway out of the
     window, and that half is cropped along with its text, often the first few words. So after
     measuring we push it back, and move the arrow the opposite way by the same amount: the
     bubble shifts but the tip still points at its button, otherwise "which one is this about"
     would be a guess.
     useLayoutEffect rather than useEffect: this must finish before the browser paints. */
  React.useLayoutEffect(() => {
    if (!at) {
      setFit(null);
      return;
    }
    const el = bubble.current;
    if (!el) return;
    const w = el.offsetWidth;
    const half = w / 2;
    const min = EDGE_PAD + half;
    const max = window.innerWidth - EDGE_PAD - half;
    /* When the window is narrower than the bubble, min exceeds max and clamping gives an absurd position; center it then and let both sides overflow equally. */
    const want = max < min ? window.innerWidth / 2 : Math.min(Math.max(at.x, min), max);
    const shift = want - at.x;
    setFit({
      shift: Math.round(shift),
      arrow: Math.round(Math.min(Math.max(half - shift, ARROW_INSET), w - ARROW_INSET)),
    });
  }, [at, label, shortcut]);

  const clear = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const show = React.useCallback(() => {
    const el = host.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAt({
      x: Math.round(r.left + r.width / 2),
      y: Math.round(side === 'bottom' ? r.bottom : r.top),
    });
  }, [side]);

  const onEnter = React.useCallback((e: React.MouseEvent) => {
    host.current = e.currentTarget as HTMLElement;
    clear();
    if (Date.now() < warmUntil) {
      show();
      return;
    }
    timer.current = setTimeout(show, DELAY_MS);
  }, [clear, show]);

  const onLeave = React.useCallback(() => {
    clear();
    if (at) warmUntil = Date.now() + WARM_MS;
    setAt(null);
  }, [at, clear]);

  React.useEffect(() => clear, [clear]);

  if (!label) return children;

  /* Chain the existing handlers before attaching ours: `cloneElement` overrides rather than
     merges. Overriding directly would make the wrapped element's own `onMouseDown`
     **silently disappear** (toolbar buttons rely on it to avoid taking focus). */
  const own = children.props as Partial<React.DOMAttributes<HTMLElement>>;
  const chain = <E extends React.SyntheticEvent>(
    mine: (e: E) => void,
    theirs?: (e: E) => void,
  ) => (e: E) => { theirs?.(e); mine(e); };

  const child = React.cloneElement(children, {
    onMouseEnter: chain(onEnter, own.onMouseEnter),
    onMouseLeave: chain(onLeave, own.onMouseLeave),
    /* Hide on press: a tooltip left floating after a click would cover the part of the UI that just changed. */
    onMouseDown: chain(onLeave, own.onMouseDown),
  } as Partial<React.HTMLAttributes<HTMLElement>>);

  return (
    <>
      {child}
      {at && typeof document !== 'undefined'
        ? createPortal(
          <div
            ref={bubble}
            role="tooltip"
            className={`pointer-events-none fixed z-[10200] -translate-x-1/2 whitespace-nowrap rounded-[8px] px-2.5 py-[5px] text-[12px] font-medium shadow-md ${
              side === 'bottom' ? '' : '-translate-y-full'
            }`}
            style={{
              left: at.x + (fit?.shift ?? 0),
              /* The arrow tip sits 2px from the button: the bubble should hug the button, not hang in mid-air. */
              top: side === 'bottom' ? at.y + 2 + ARROW_H : at.y - 2 - ARROW_H,
              /* The first frame has not measured the shift yet; do not paint, so it is not seen jumping from the wrong position. */
              visibility: fit ? 'visible' : 'hidden',
              background: 'var(--tooltip-bg)',
              color: 'var(--tooltip-text)',
              border: '1px solid var(--tooltip-border)',
            }}
          >
            {label}
            {shortcut ? (
              /* ASCII parentheses. One step dimmer but the same color; switching to a separate gray looks muddy on a dark bubble. */
              <span style={{ opacity: 0.55, marginLeft: 5 }}>({shortcut})</span>
            ) : null}
            <span
              aria-hidden
              className="absolute block"
              style={{
                left: fit?.arrow ?? '50%',
                width: ARROW_BOX,
                height: ARROW_BOX,
                background: 'var(--tooltip-bg)',
                /* A square rotated 45 degrees, with only its two outward-facing edges stroked, overlaps the bubble's border to form one continuous arrow. */
                ...(side === 'bottom'
                  ? {
                    top: -ARROW_BOX / 2 - 0.5,
                    transform: 'translateX(-50%) rotate(45deg)',
                    borderTop: '1px solid var(--tooltip-border)',
                    borderLeft: '1px solid var(--tooltip-border)',
                  }
                  : {
                    bottom: -ARROW_BOX / 2 - 0.5,
                    transform: 'translateX(-50%) rotate(45deg)',
                    borderBottom: '1px solid var(--tooltip-border)',
                    borderRight: '1px solid var(--tooltip-border)',
                  }),
              }}
            />
          </div>,
          document.body,
        )
        : null}
    </>
  );
}

/** Side length of the arrow square; after rotation, the height it sticks out of the bubble is half the diagonal. */
const ARROW_BOX = 7;
const ARROW_H = Math.round((ARROW_BOX * Math.SQRT2) / 2);
