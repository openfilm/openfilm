/**
 * What a track's head has beside lock, hide and mute: solo (hear this track alone, in Studio only) and the edge to
 * drag it taller or shorter by (lib/track-heights).
 */
import * as React from 'react';

import { useT } from '@/i18n';
import { clampTrackHeight } from '@/lib/track-heights';
import { Tooltip } from './Tooltip';

/** Solo: an S, lit while the track is soloed; ⌥-click soloes it alone. */
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
        className="flex h-full w-full items-center justify-center rounded-[4px] outline-none transition-colors hover:bg-[var(--bg-hover)]"
      >
        <span
          className="flex h-[14px] w-[14px] items-center justify-center rounded-[3px] text-[9.5px] font-bold leading-none"
          style={on
            ? { background: '#e8c547', color: '#1b1b1b' }
            : { color: 'var(--text-dim)', boxShadow: 'inset 0 0 0 1px currentColor' }}
        >
          S
        </span>
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
