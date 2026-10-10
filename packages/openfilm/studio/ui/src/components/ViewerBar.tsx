/**
 * The transport bar under the picture: the timecode on the left, play in the center, the frame picker and full screen
 * on the right. As tall (32px) as the pane bar above the picture, so the picture sits evenly between two equal edges.
 */
import React from 'react';
import { Expand, Pause, Play, Repeat } from 'lucide-react';
import { useT } from '@/i18n';
import { formatTimecode, useTimecodeFps } from '@/lib/timecode';
import { PANE_BTN, PANE_ICON } from './dock-pane-bar';
import { LiveTime, type PlaybackClock } from './LiveTime';
import { Tooltip } from './Tooltip';

/** The bar's buttons: the pane-bar size (22×22, icon 14) plus a keyboard focus ring (Tab must show where it is). */
const VIEW_BTN = `${PANE_BTN} outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]`;

export function ViewerBar({
  timeMs,
  clock,
  totalMs,
  playing,
  onPlayPause,
  frame,
  onFullscreen,
  loop,
}: {
  timeMs: number;
  /** While playing the time is on the clock; only the timecode subscribes to it, the rest of the bar stays still. */
  clock?: PlaybackClock | null;
  totalMs: number;
  playing: boolean;
  onPlayPause: () => void;
  /** The FramePicker, when the film can be framed (not read-only). */
  frame?: React.ReactNode;
  /** Full screen; the button is disabled while the film has no length. */
  onFullscreen?: () => void;
  /** Loop playback (⇧L): of the range marked, else of the whole film. Without it there is no loop button. */
  loop?: { on: boolean; ranged: boolean; onToggle: () => void } | null;
}) {
  const t = useT();
  /* frames are counted at the project's rate: shown anew when it changes */
  useTimecodeFps();
  const playable = totalMs > 0;
  const hours = totalMs >= 3_600_000;

  /* `minmax(0,1fr)` rather than `1fr`: a 1fr column will not shrink below its content, and two full timecodes are 25
     characters — a narrow pane would push the play button over the timecode. These columns shrink and clip. */
  return (
    <div className="grid h-8 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-2">
      {/* where we are is read constantly: body color, 12px; the length one step fainter. One line, never wrapped:
          when it does not fit, the length is clipped first. No hour field for a film under an hour. */}
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] tabular-nums text-[var(--text)]">
        <LiveTime clock={clock} timeMs={timeMs}>{(liveMs) => formatTimecode(liveMs, { hours })}</LiveTime>
        <span className="text-[11px] text-[var(--text-faint)]">
          {' / '}{formatTimecode(totalMs, { hours })}
        </span>
      </span>
      <Tooltip label={playing ? t('viewer.pause') : t('viewer.play')} shortcut="Space">
        <button
          type="button"
          onClick={onPlayPause}
          disabled={!playable}
          /* no focus on click: the next Space would land on the button and draw a focus ring; Tab focus is kept */
          onMouseDown={(e) => e.preventDefault()}
          className={`${VIEW_BTN} disabled:pointer-events-none disabled:opacity-30`}
          aria-label={playing ? t('viewer.pause') : t('viewer.play')}
        >
          {playing ? <Pause size={PANE_ICON} fill="currentColor" /> : <Play size={PANE_ICON} fill="currentColor" />}
        </button>
      </Tooltip>
      <span className="flex items-center justify-end gap-1">
        {loop ? (
          <Tooltip label={t(loop.ranged ? 'viewer.loopRange' : 'viewer.loopFilm')} shortcut="⇧L">
            <button
              type="button"
              onClick={loop.onToggle}
              onMouseDown={(e) => e.preventDefault()}
              disabled={!playable}
              aria-pressed={loop.on}
              aria-label={t(loop.ranged ? 'viewer.loopRange' : 'viewer.loopFilm')}
              data-viewer-loop={loop.on ? '1' : '0'}
              className={`${VIEW_BTN} disabled:pointer-events-none disabled:opacity-30 ${loop.on ? '!text-[var(--accent)]' : ''}`}
            >
              <Repeat size={PANE_ICON} />
            </button>
          </Tooltip>
        ) : null}
        {frame}
        {onFullscreen ? (
          <Tooltip label={t('viewer.fullscreen')}>
            <button
              type="button"
              onClick={onFullscreen}
              disabled={!playable}
              className={`${VIEW_BTN} disabled:pointer-events-none disabled:opacity-30`}
              aria-label={t('viewer.fullscreen')}
            >
              <Expand size={PANE_ICON} />
            </button>
          </Tooltip>
        ) : null}
      </span>
    </div>
  );
}
