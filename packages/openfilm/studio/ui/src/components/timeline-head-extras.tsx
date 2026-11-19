/**
 * Track head controls shared by the timeline rows and their divider.
 */
import * as React from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { useT } from '@/i18n';
import { clampTrackHeight } from '@/lib/track-heights';
import { Tooltip } from './Tooltip';

/** The divider reveals the panel toggle beside the pointer, without re-rendering the tracks as it moves. */
export function TrackHeadDividerToggle({ x, bottom, collapsed, disabled, onToggle }: {
  x: number;
  bottom: number;
  collapsed: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const label = t(collapsed ? 'timeline.expandTrackHeads' : 'timeline.collapseTrackHeads');
  const follow = (e: React.PointerEvent<HTMLButtonElement>) => {
    const button = e.currentTarget;
    const y = e.clientY - button.getBoundingClientRect().top;
    button.style.setProperty('--track-toggle-y', `${Math.round(y)}px`);
  };
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={!collapsed}
      disabled={disabled}
      data-track-head-divider=""
      className="group absolute top-0 z-[55] w-1.5 -translate-x-1/2 cursor-pointer outline-none disabled:pointer-events-none"
      style={{ left: x, bottom }}
      onPointerEnter={follow}
      onPointerMove={follow}
      onPointerLeave={(e) => e.currentTarget.style.removeProperty('--track-toggle-y')}
      onClick={onToggle}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none invisible absolute left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center group-hover:visible group-focus-visible:visible"
        style={{ top: 'clamp(12px, var(--track-toggle-y, 50%), calc(100% - 34px))' }}
      >
        <span className="pointer-events-auto grid size-5 place-items-center rounded-[4px] border border-[var(--border-strong)] bg-[var(--bg-raised)] text-[var(--text)] shadow-sm group-focus-visible:outline group-focus-visible:outline-[var(--accent)]">
          {collapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
        </span>
        <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-[4px] bg-[var(--bg-raised)] px-1.5 py-1 text-[11px] font-medium leading-none text-[var(--text)] shadow-sm">
          {label}
        </span>
      </span>
    </button>
  );
}

/** Solo: an S in the accent color when on; ⌥-click soloes it alone. */
export function SoloButton({ on, onToggle }: { on: boolean; onToggle: (only: boolean) => void }) {
  const t = useT();
  const label = on ? t('editorTools.unsolo') : t('editorTools.solo');
  return (
    <Tooltip label={label}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={label}
        aria-pressed={on}
        data-track-solo={on ? '1' : '0'}
        onPointerDown={(e) => {
          /* no focus on press: Space plays (as the other head buttons) */
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          e.currentTarget.blur();
          onToggle(e.altKey);
        }}
        className={`flex size-6 items-center justify-center rounded-[4px] text-[12px] font-semibold leading-none outline-none transition-colors ${
          on ? 'text-[var(--accent)]' : 'text-[var(--editor-control)] hover:bg-[var(--bg-hover)]'
        }`}
      >
        S
      </button>
    </Tooltip>
  );
}

/**
 * The bottom edge of a track's head: dragged, the track gets taller or shorter (`onResize` as it goes, `done` at the
 * end); double-clicked, it goes back to its own height (null).
 */
export function TrackResizeHandle({ height, onResize }: {
  height: number;
  onResize: (height: number | null, done: boolean) => void;
}) {
  const t = useT();
  const start = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const y0 = e.clientY;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let last = height;
    const move = (ev: PointerEvent) => {
      const next = clampTrackHeight(height + ev.clientY - y0);
      if (next !== last) { last = next; onResize(next, false); }
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (last !== height) onResize(last, true);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={t('editorTools.resizeTrack')}
      title={t('editorTools.resizeTrack')}
      data-track-resize=""
      onPointerDown={start}
      onDoubleClick={(e) => { e.stopPropagation(); onResize(null, true); }}
      className="absolute inset-x-0 -bottom-[3px] z-10 h-[6px] cursor-row-resize touch-none"
    />
  );
}
