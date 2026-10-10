/**
 * A tooltip that shows after half a second.
 *
 * Not the native `title`: its delay is the system's (a second or two), and icon buttons rely on the tooltip to say
 * what they are; by then the person has already clicked to find out.
 *
 * The delay is only for the first one: moving to another button within a moment shows at once. Waiting again on
 * every button while scanning a toolbar is worse than no tooltip.
 *
 * Side: above the button by default; most buttons sit near the bottom or the middle, so above covers nothing.
 * Buttons at the top of the window use `side="bottom"`.
 *
 * A shortcut shows as `Name (⌘Z)`, after the name, one step fainter. The modifier follows the platform
 * (⌘ on Mac, Ctrl elsewhere).
 */
'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { chatLayer } from '@/lib/chat-layer';

/** How long the first hover waits. */
const DELAY_MS = 500;
/** How long after leaving a button another one shows without waiting. */
const WARM_MS = 600;

let warmUntil = 0;

/** Minimum gap between the bubble and the window edge. */
const EDGE_PAD = 8;
/** How close to the bubble's ends the arrow may go; further out it runs onto the rounded corner and looks broken. */
const ARROW_INSET = 12;

export function Tooltip({
  label, shortcut, side = 'top', content, children,
}: {
  /** Empty or undefined: no tooltip right now; the child renders as is. */
  label: string | undefined;
  /** The shortcut, already formatted for the platform. Shown as `Name (⌘Z)`. */
  shortcut?: string;
  /** Which side the tooltip shows on. Buttons at the top of the window use `bottom`. */
  side?: 'top' | 'bottom';
  /** A card in place of the line of text (a pill's picture and facts on hover). `label` is still needed: it decides whether to show. */
  content?: React.ReactNode;
  /** The element the tooltip belongs to. It must take a ref and mouse events. */
  children: React.ReactElement;
}): React.ReactElement {
  const [at, setAt] = React.useState<{ x: number; y: number } | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const host = React.useRef<HTMLElement | null>(null);
  const bubble = React.useRef<HTMLDivElement | null>(null);
  /** How far to shift back and where the arrow goes, known only once measured. Hidden until then (see visibility below). */
  const [fit, setFit] = React.useState<{ shift: number; arrow: number } | null>(null);

  /* Near the window edge, a bubble centered on its button would be half outside and its text clipped. So it is
     pushed back in, and the arrow moves the other way by as much, so it still points at the button.
     useLayoutEffect, not useEffect: this must finish before the browser paints. */
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
    /* A window narrower than the bubble makes min exceed max: center it then, overflowing both sides equally. */
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

  /* Chain the child's own handlers: `cloneElement` overrides, it doesn't merge. Otherwise the child's own
     `onMouseDown` silently disappears (toolbar buttons use it to keep focus where it is). */
  const own = children.props as Partial<React.DOMAttributes<HTMLElement>>;
  const chain = <E extends React.SyntheticEvent>(
    mine: (e: E) => void,
    theirs?: (e: E) => void,
  ) => (e: E) => { theirs?.(e); mine(e); };

  const child = React.cloneElement(children, {
    onMouseEnter: chain(onEnter, own.onMouseEnter),
    onMouseLeave: chain(onLeave, own.onMouseLeave),
    /* Hide on press: a tooltip left after a click covers the part of the UI that just changed. */
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
            className={`pointer-events-none fixed z-[10200] -translate-x-1/2 rounded-[8px] text-[12px] font-medium shadow-md ${
              content ? 'p-2' : 'whitespace-nowrap px-2.5 py-[5px]'
            } ${
              side === 'bottom' ? '' : '-translate-y-full'
            }`}
            style={{
              left: at.x + (fit?.shift ?? 0),
              /* The arrow tip 2px from the button: the bubble sits against it, not floating. */
              top: side === 'bottom' ? at.y + 2 + ARROW_H : at.y - 2 - ARROW_H,
              /* Hidden on the first frame, before the shift is measured, so it doesn't jump from the wrong place. */
              visibility: fit ? 'visible' : 'hidden',
              background: 'var(--tooltip-bg)',
              color: 'var(--tooltip-text)',
              border: '1px solid var(--tooltip-border)',
            }}
          >
            {content ?? label}
            {shortcut && !content ? (
              /* Same color, fainter: a separate gray looks dirty on a dark bubble. */
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
                /* A square turned 45° with only its two outer edges stroked, over the bubble's border, makes one seamless arrow. */
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
          chatLayer(),
        )
        : null}
    </>
  );
}

/** The arrow square's side; turned, it sticks out of the bubble by half its diagonal. */
const ARROW_BOX = 7;
const ARROW_H = Math.round((ARROW_BOX * Math.SQRT2) / 2);
