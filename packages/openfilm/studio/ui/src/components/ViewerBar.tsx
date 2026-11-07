/**
 * The transport bar under the picture: the timecode on the left, play in the center, the playback settings and full
 * screen on the right. As tall (32px) as the pane bar above the picture, so the picture sits evenly between two equal edges.
 */
import type React from 'react';
import { Expand, Pause, Play } from 'lucide-react';
import { useT } from '@/i18n';
import { formatTimecode, useTimecodeFps } from '@/lib/timecode';
import { PANE_BTN, PANE_ICON } from './dock-pane-bar';
import { LiveText, type PlaybackClock } from './LiveTime';
import { PlaybackMenu, type PlaybackSettings } from './PlaybackMenu';
import { Tooltip } from './Tooltip';
import { useKeyHint } from '@/lib/keymap-store';

/** The bar's buttons: the pane-bar size (22×22, icon 14) plus a keyboard focus ring (Tab must show where it is). */
const VIEW_BTN = `${PANE_BTN} outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]`;

export function ViewerBar({
  timeMs,
  clock,
  totalMs,
  playing,
  onPlayPause,
  onFullscreen,
  playback,
  extra,
}: {
  timeMs: number;
  /** The time on the clock (playing, scrubbing): only the timecode follows it, the rest of the bar stays still. */
  clock?: PlaybackClock | null;
  totalMs: number;
  playing: boolean;
  onPlayPause: () => void;
  /** Full screen; the button is disabled while the film has no length. */
  onFullscreen?: () => void;
  /** Loop and speed (see PlaybackMenu). Without it there is no settings button. */
  playback?: PlaybackSettings | null;
  /** Shown before the buttons on the right (the source viewer: the part marked). */
  extra?: React.ReactNode;
}) {
  const t = useT();
  const keyHint = useKeyHint();
  /* frames are counted at the project's rate: shown anew when it changes */
  useTimecodeFps();
  const playable = totalMs > 0;
  const hours = totalMs >= 3_600_000;

  /* `minmax(0,1fr)` rather than `1fr`: a 1fr column will not shrink below its content, and two full timecodes are 25
     characters — a narrow pane would push the play button over the timecode. These columns shrink and clip. */
  return (
    <div className="grid h-10 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-2">
      {/* where we are is read constantly: body color, 12px; the length one step fainter. One line, never wrapped:
          when it does not fit, the length is clipped first. No hour field for a film under an hour. */}
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] tabular-nums text-[var(--text)]">
        <LiveText clock={clock} timeMs={timeMs} format={(ms) => formatTimecode(ms, { hours })} />
        <span className="text-[11px] text-[var(--text-faint)]">
          {' / '}{formatTimecode(totalMs, { hours })}
        </span>
      </span>
      <Tooltip label={playing ? t('viewer.pause') : t('viewer.play')} shortcut={keyHint('play-pause')}>
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
        {extra}
        {playback ? (
          <PlaybackMenu
            settings={playback}
            disabled={!playable}
            className={`${VIEW_BTN} !w-auto min-w-[22px] gap-1 px-1 disabled:pointer-events-none disabled:opacity-30`}
          />
        ) : null}
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
