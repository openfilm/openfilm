/**
 * A card that opens while the pointer rests on what it belongs to, as a design app's title does: a moment after the
 * pointer comes, and it stays while the pointer goes over to it. A click on the trigger keeps it open until a click
 * elsewhere (the popover closes it then), for a keyboard and a touch screen too.
 *
 * `trigger` goes on what the card hangs from, `card` on the card itself; `open` and `setOpen` drive the popover.
 */
import React from 'react';

/** how long the pointer rests before the card opens, and how long it may be away before it closes */
const OPEN_MS = 120;
const CLOSE_MS = 220;

export function useHoverOpen() {
  const [open, setOpenState] = React.useState(false);
  const pinned = React.useRef(false);
  const over = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  React.useEffect(() => clear, []);
  const setOpen = React.useCallback((next: boolean) => {
    clear();
    /* a click on the trigger of a card the pointer opened keeps it, rather than closing it */
    if (!next && over.current && !pinned.current) { pinned.current = true; setOpenState(true); return; }
    /* opened by a click (the popover's own toggle): it stays; closed: by anything */
    pinned.current = next;
    setOpenState(next);
  }, []);
  /** Actions, outside clicks and Esc close even while the pointer is still on the trigger. */
  const dismiss = React.useCallback(() => {
    clear(); pinned.current = false; over.current = false; setOpenState(false);
  }, []);
  const toggle = () => {
    if (open && pinned.current) dismiss();
    else { clear(); pinned.current = true; setOpenState(true); }
  };
  const enter = () => {
    over.current = true;
    clear();
    if (!open) timer.current = setTimeout(() => setOpenState(true), OPEN_MS);
  };
  const leave = () => {
    over.current = false;
    clear();
    if (pinned.current) return;
    timer.current = setTimeout(() => setOpenState(false), CLOSE_MS);
  };
  return {
    open,
    setOpen,
    dismiss,
    toggle,
    trigger: { onMouseEnter: enter, onMouseLeave: leave },
    card: { onMouseEnter: () => clear(), onMouseLeave: () => { clear(); if (!pinned.current) timer.current = setTimeout(() => setOpenState(false), CLOSE_MS); } },
  };
}
