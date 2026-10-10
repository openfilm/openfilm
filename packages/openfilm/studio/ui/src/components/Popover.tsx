/**
 * A small popover that opens next to its trigger: closes on outside click or Esc, and is
 * portaled to body so no pane's overflow can clip it. The panel has no skin of its own: its
 * children draw their card.
 */
import React from 'react';
import { createPortal } from 'react-dom';

function keepFocus(e: React.MouseEvent) {
  e.preventDefault();
}

/**
 * Popover for a toolbar button or a field: opens next to its trigger, closes on outside click
 * or Esc, and is portaled to body so no pane's overflow can clip it.
 */
export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  placement = 'bottom',
  align = 'start',
  layer = 10000,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  trigger: React.ReactNode;
  children: React.ReactNode;
  placement?: 'top' | 'bottom' | 'auto';
  /** end: align the panel's right edge to the trigger's right edge (avoids overflow for triggers near the right side of the screen). */
  align?: 'start' | 'end';
  /** its z-index: above a dialog it opens in */
  layer?: number;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const [panelStyle, setPanelStyle] = React.useState<React.CSSProperties | null>(null);

  const update = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 6;
    const pad = 12;
    const below = window.innerHeight - r.bottom - gap - pad;
    const above = r.top - gap - pad;
    /* `auto` picks the side by the panel's **real** height: prefer the side where it fits, and
       if neither fits, the larger side. Before the panel has been painted it cannot be measured,
       so 280 is assumed; it is measured again after painting (see the layoutEffect below).
       Relying on the 280 estimate alone would open a 700px-tall panel downward and off screen. */
    const panel = panelRef.current;
    const inner = panel?.firstElementChild as HTMLElement | null;
    /* Use the inner card's scrollHeight: once the card clamps itself via --popover-max-h, the
       panel's height is just the clamped value, and reading it would always say "it fits". */
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
      zIndex: layer,
      /* Hand the remaining height on this side to the card: it uses the value as its own
         max-height, so the scroll viewport is inside the card and the rounded corners and border
         do not scroll away with the content. */
      ['--popover-max-h' as string]: `${room}px`,
      overflow: 'visible',
    });
  }, [placement, align, layer]);

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

  /* Measure again once the panel is painted: during the first update it is not in the DOM yet
     and the side was chosen from an estimate. The dependency is the boolean "has it been
     painted", not the style object itself, which is new on every update and would loop forever. */
  const painted = panelStyle !== null;
  React.useLayoutEffect(() => {
    if (open && painted) update();
  }, [open, painted, update]);

  /*
   * Close on outside click.
   *
   * Three details; missing any one makes "clicked blank space but it does not close":
   *
   * 1. **Listen in the capture phase on window**, not the bubble phase on document. React
   *    delegates events at the root container (not document), so any `stopPropagation()` on
   *    the way stops the native event at the root and a document listener never sees it.
   *    The capture phase runs from window downward and nothing can intercept it.
   * 2. **Listen to pointerdown**, not mousedown. Pens and touch screens do not always
   *    synthesize mouse events.
   * 3. Close on **press**, not release: from the moment of the press, the popover is no
   *    longer what the user is talking about.
   *
   * `onOpenChange` goes through a ref rather than the dependency array: it is recreated on
   * every render, so listing it would tear down and re-add the listeners on every render.
   */
  const latest = React.useRef(onOpenChange);
  latest.current = onOpenChange;
  React.useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (e.type === 'pointerdown' && (ref.current?.contains(t) || panelRef.current?.contains(t))) return;
      latest.current(false);
    };
    /* first, and said to be handled: Esc closes the popover, not a dialog it is in */
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); latest.current(false); }
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const panel =
    open && panelStyle ? (
      <div
        ref={panelRef}
        data-popover-panel="true"
        style={panelStyle}
      >
        {children}
      </div>
    ) : null;

  return (
    <div ref={ref} className="inline-flex w-fit">
      <div className="inline-flex w-fit" onMouseDown={keepFocus} onClick={() => onOpenChange(!open)}>
        {trigger}
      </div>
      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
    </div>
  );
}
