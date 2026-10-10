/**
 * The seam between Studio and the chat is the handle that sizes the chat, as Studio's own seams are (its
 * PaneDivider): it draws nothing for a mouse (the cursor says it can be dragged, the panes say what is happening) and
 * lights up only when reached by keyboard. The app owns the width (shell/bridge.ts keeps it within the window).
 */
import React from 'react';
import { app as desktop } from '../app-bridge';

const STEP = 24;

/** the chat's column: its width is what the seam changes */
const columnWidth = (el: Element) => (el.closest('[data-studio-host-panel]') ?? el.parentElement ?? el).getBoundingClientRect().width;

export function Divider() {
  const drag = React.useRef<{ x: number; width: number } | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the chat"
      tabIndex={0}
      className="absolute bottom-0 left-0 top-0 z-20 w-[10px] cursor-col-resize outline-none focus-visible:bg-[var(--border-strong)]"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width: columnWidth(event.currentTarget) };
        document.body.style.cursor = 'col-resize';
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        desktop.setChatWidth(drag.current.width + (drag.current.x - event.clientX));
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        desktop.setChatWidth(drag.current.width + (drag.current.x - event.clientX), true);
        drag.current = null;
        document.body.style.cursor = '';
      }}
      onPointerCancel={() => { drag.current = null; document.body.style.cursor = ''; }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        desktop.setChatWidth(columnWidth(event.currentTarget) + (event.key === 'ArrowLeft' ? STEP : -STEP), true);
      }}
    />
  );
}
