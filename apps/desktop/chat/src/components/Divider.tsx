/**
 * The seam between the chat and Studio (on its right) is the handle that sizes the chat, as Studio's own seams are (its
 * PaneDivider): it draws nothing for a mouse (the cursor says it can be dragged, the panes say what is happening) and
 * lights up only when reached by keyboard. The app owns the width (shell/bridge.ts keeps it within the window).
 */
import React from 'react';
import { app as desktop } from '../app-bridge';

const STEP = 24;
const direction = (el: Element) => el.closest('#of-chat')?.getAttribute('data-side') === 'right' ? -1 : 1;

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
      className="workspace-chat-divider workspace-resize-handle absolute bottom-0 top-0 z-20 w-[9px] cursor-col-resize outline-none"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width: columnWidth(event.currentTarget) };
        document.body.style.cursor = 'col-resize';
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        desktop.setChatWidth(drag.current.width + (event.clientX - drag.current.x) * direction(event.currentTarget));
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        desktop.setChatWidth(drag.current.width + (event.clientX - drag.current.x) * direction(event.currentTarget), true);
        drag.current = null;
        document.body.style.cursor = '';
      }}
      onPointerCancel={() => { drag.current = null; document.body.style.cursor = ''; }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        desktop.setChatWidth(columnWidth(event.currentTarget) + (event.key === 'ArrowRight' ? STEP : -STEP) * direction(event.currentTarget), true);
      }}
    />
  );
}
