/**
 * The transport bar under the picture: the timecode on the left, play in the center, the playback settings and full
 * screen on the right. As tall (32px) as the pane bar above the picture, so the picture sits evenly between two equal edges.
 */
import type React from 'react';
import { useT } from '@/i18n';
import { formatTimecode, useTimecodeFps } from '@/lib/timecode';
import { LiveText, type PlaybackClock } from './LiveTime';
import { PlaybackMenu, type PlaybackSettings } from './PlaybackMenu';
import { FullscreenButton, mediaButton } from './player-controls/MediaButtons';
import { Icon, PATH_PAUSE, PATH_PLAY } from './player-controls/controls-bar';

/** The speed's and full screen's icons in this bar (Screening's, in a taller bar, are larger: player-controls/MediaButtons). */
const MEDIA_ICON = 18;
import { Tooltip } from './Tooltip';

/** The bar's buttons: the pane-bar size (22×22, icon 14) plus a keyboard focus ring (Tab must show where it is). */

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
  /* frames are counted at the project's rate: shown anew when it changes */
  useTimecodeFps();
  const playable = totalMs > 0;
  const hours = totalMs >= 3_600_000;

  /* `minmax(0,1fr)` rather than `1fr`: a 1fr column will not shrink below its content, and two full timecodes are 25
     characters — a narrow pane would push the play button over the timecode. These columns shrink and clip. */
  return (
    <div className="@container grid h-10 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-2">
      {/* where we are is read constantly: body color, 12px; the length one step fainter. One line, never wrapped:
          when it does not fit, the length is clipped first. No hour field for a film under an hour. */}
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] tabular-nums text-[var(--text)]">
        <LiveText clock={clock} timeMs={timeMs} format={(ms) => formatTimecode(ms, { hours })} />
        <span className="text-[11px] text-[var(--text-faint)]">
          {' / '}{formatTimecode(totalMs, { hours })}
        </span>
      </span>
      <Tooltip label={playing ? t('viewer.pause') : t('viewer.play')} action="play-pause">
        <button
          type="button"
          onClick={() => { if (playable) onPlayPause(); }}
          aria-disabled={!playable}
          /* no focus on click: the next Space would land on the button and draw a focus ring; Tab focus is kept */
          onMouseDown={(e) => e.preventDefault()}
          className={`${mediaButton(false, MEDIA_ICON)} ${playable ? '' : 'opacity-30'}`}
          aria-label={playing ? t('viewer.pause') : t('viewer.play')}
        >
          <Icon d={playing ? PATH_PAUSE : PATH_PLAY} size={MEDIA_ICON} />
        </button>
      </Tooltip>
      <span className="flex items-center justify-end gap-1">
        {extra}
        {playback ? (
          <PlaybackMenu settings={playback} disabled={!playable} size={MEDIA_ICON} />
        ) : null}
        {onFullscreen ? (
          <FullscreenButton label={t('viewer.fullscreen')} action="preview-fullscreen" size={MEDIA_ICON} disabled={!playable} onClick={() => { if (playable) onFullscreen(); }} />
        ) : null}
      </span>
    </div>
  );
}
