'use client';

/**
 * A small popover opened from a button: closes on an outside click or Esc, portalled so no overflow clips it.
 * Its own file: several places use it, and it shouldn't pull in the model menu.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { useChatMenu } from '@/lib/chat-menu';
import { chatLayer } from '@/lib/chat-layer';

export function keepFocus(e: React.MouseEvent) {
  e.preventDefault();
}

const EMPTY_INSIDE_REFS: Array<React.RefObject<HTMLElement | null>> = [];

/**
 * A modal opened from a popover (a full-screen scrim and a card), portalled on its own.
 *
 * It must be recognizable, or every press on it reads as an outside click: the popover closes, the component that
 * rendered the modal unmounts, and the button's click never fires. A marker, not `[role="dialog"]`: any dialog
 * mounted elsewhere would then keep the popover from ever closing.
 */
const MODAL_LAYER = '[data-modal-layer]';

function inModalLayer(node: Node): boolean {
  const el = node instanceof Element ? node : node.parentElement;
  return Boolean(el?.closest(MODAL_LAYER));
}

/**
 * A popover opened from a button: closes on an outside click or Esc, portalled so no overflow clips it.
 * Buttons that stand side by side should open the same kind of thing, with the same rules.
 */
export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  placement = 'bottom',
  align = 'start',
  insideRefs = EMPTY_INSIDE_REFS,
  bare = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  trigger: React.ReactNode;
  children: React.ReactNode;
  placement?: 'top' | 'bottom' | 'auto';
  /** end: the panel's right edge aligns with the trigger's (keeps triggers near the right edge on screen). */
  align?: 'start' | 'end';
  insideRefs?: Array<React.RefObject<HTMLElement | null>>;
  /** bare: no card styling on the panel (children draw their own, e.g. several cards side by side). */
  bare?: boolean;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  useChatMenu(open);
  const [panelStyle, setPanelStyle] = React.useState<React.CSSProperties | null>(null);

  const update = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 6;
    const pad = 12;
    const below = window.innerHeight - r.bottom - gap - pad;
    const above = r.top - gap - pad;
    /* `auto` picks a side by the panel's real height: a side it fits in first, else the larger one. Before the
       panel is drawn, 280 is assumed; it is measured again once drawn (see the layoutEffect below). */
    const panel = panelRef.current;
    const inner = panel?.firstElementChild as HTMLElement | null;
    /* The inner card's scrollHeight: once the card clamps itself to --popover-max-h, the panel's height is the
       clamped one and would always "fit". */
    const need = panel ? Math.max(panel.scrollHeight, inner?.scrollHeight ?? 0) : 280;
    const openUp = placement === 'top'
      || (placement === 'auto' && below < need && above > below);
    const room = Math.max(0, openUp ? above : below);
    const x = align === 'end' ? '-100%' : '0%';
    setPanelStyle({
      position: 'fixed',
      left: align === 'end' ? r.right : r.left,
      top: openUp ? r.top - gap : r.bottom + gap,
      transform: `translate(${x}, ${openUp ? '-100%' : '0%'})`,
      zIndex: 10000,
      /* The room on this side, for a bare card to use as its max-height: it scrolls inside, so its corners and
         border don't scroll away with the content. */
      ['--popover-max-h' as string]: `${room}px`,
      ...(bare
        ? { overflow: 'visible' }
        : {
            maxHeight: room,
            overflowY: 'auto' as const,
            overscrollBehavior: 'contain',
          }),
    });
  }, [placement, align, bare]);

  React.useLayoutEffect(() => {
    if (!open) {
      setPanelStyle(null);
      return;
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, update]);

  /* Measure again once the panel is drawn: on the first update it wasn't in the DOM and the side was a guess.
     The dependency is the "drawn" boolean, not the style object, which is new on every update and would loop. */
  const painted = panelStyle !== null;
  React.useLayoutEffect(() => {
    if (open && painted) update();
  }, [open, painted, update]);

  /*
   * Close on an outside click.
   *
   * Three details; miss one and a click outside doesn't close it:
   *
   * 1. Listen on window in the capture phase, not on document while bubbling. React delegates events at the root
   *    container, so any `stopPropagation()` on the way stops the native event there and document never hears it.
   *    Capture runs down from window and nothing can stop it first.
   * 2. pointerdown, not mousedown: pens and touch don't always synthesise mouse events.
   * 3. Close on press, not release: from the press on, the popover is no longer what the person is dealing with.
   *
   * Values go through a ref, not the dependency array: `insideRefs` is an inline literal at call sites and
   * `onOpenChange` is new each render, so listing them would re-attach the listeners on every render.
   */
  const latest = React.useRef({ onOpenChange, insideRefs });
  latest.current = { onOpenChange, insideRefs };
  React.useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (e.type === 'pointerdown') {
        if (ref.current?.contains(t) || panelRef.current?.contains(t)) return;
        if (inModalLayer(t)) return;
        for (const extra of latest.current.insideRefs) if (extra.current?.contains(t)) return;
      }
      latest.current.onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // With a modal open, Esc belongs to the modal, not to the popover beneath it.
      if (document.querySelector(MODAL_LAYER)) return;
      latest.current.onOpenChange(false);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const panel =
    open && panelStyle ? (
      <div
        ref={panelRef}
        data-popover-panel="true"
        style={
          bare
            ? panelStyle
            : {
                minWidth: 140,
                ...panelStyle,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-strong)',
                borderRadius: 16,
                boxShadow: '0 16px 40px -8px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.18)',
                overflowY: 'auto',
              }
        }
      >
        {children}
      </div>
    ) : null;

  return (
    <div ref={ref} className="inline-flex w-fit">
      <div className="inline-flex w-fit" onMouseDown={keepFocus} onClick={() => onOpenChange(!open)}>
        {trigger}
      </div>
      {typeof document !== 'undefined' && panel ? createPortal(panel, chatLayer()) : null}
    </div>
  );
}
