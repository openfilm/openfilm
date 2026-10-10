/**
 * The control bar over the bottom of the picture in full screen. The transport bar under the picture (ViewerBar)
 * stays in the window when the picture goes full screen, so full screen gets a bar of its own: the player's
 * PlayerControlsBar (seek bar, buttons, subtitles, speed, exit).
 *
 * This file adds what the bar itself does not do:
 * - fading out after 2.5s idle while playing, back on any pointer move or press on the full-screen element;
 * - the keys its tooltips advertise (`useFullscreenKeys`): k play/pause, m mute, c subtitles, f exit full screen.
 *   Space, the arrows and Esc are the editor's (and the browser's) as everywhere else.
 *
 * Mount it only while the picture is full screen.
 */
import React from 'react';
import { isTypingTarget } from './typing-target';
import { PlayerControlsBar } from './player-controls/controls-bar';

const HIDE_AFTER_MS = 2500;

export function FilmFullscreenBar({
  timeMs,
  totalMs,
  playing,
  volume,
  muted,
  rate,
  captionsOn,
  onToggle,
  onScrubPreview,
  onScrubCommit,
  onVolume,
  onToggleMute,
  onRate,
  onToggleCaptions,
  onExit,
  hostRef,
}: {
  timeMs: number;
  totalMs: number;
  playing: boolean;
  volume: number;
  muted: boolean;
  rate: number;
  /** Absent when the film has no subtitles: then no button (and `c` does nothing). */
  captionsOn?: boolean;
  onToggle: () => void;
  onScrubPreview: (ms: number) => void;
  onScrubCommit: (ms: number) => void;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  onRate: (r: number) => void;
  onToggleCaptions?: () => void;
  onExit: () => void;
  /** The full-screen element: a pointer move on it shows the bar. */
  hostRef: React.RefObject<HTMLElement | null>;
}) {
  const [visible, setVisible] = React.useState(true);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = React.useCallback(() => {
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
  }, []);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    show();
    host.addEventListener('pointermove', show);
    host.addEventListener('pointerdown', show);
    return () => {
      host.removeEventListener('pointermove', show);
      host.removeEventListener('pointerdown', show);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [hostRef, show]);

  const captions = captionsOn !== undefined && onToggleCaptions ? { on: captionsOn, onToggle: onToggleCaptions } : undefined;
  useFullscreenKeys({ onToggle, onToggleMute, onToggleCaptions: captions?.onToggle, onExit, onKey: show });

  return (
    <PlayerControlsBar
      timeMs={timeMs}
      totalMs={totalMs}
      onPreview={onScrubPreview}
      onCommit={onScrubCommit}
      playing={playing}
      onToggle={onToggle}
      volume={volume}
      muted={muted}
      onVolumeChange={onVolume}
      onToggleMute={onToggleMute}
      captions={captions}
      rate={rate}
      onRateChange={onRate}
      onExitFullscreen={onExit}
      /* paused: stay up — the person is most likely about to reach for the seek bar or play */
      visible={visible || !playing}
      onShow={show}
    />
  );
}

/**
 * The player's single-letter keys while full screen: k play/pause, m mute, c subtitles (when given), f exit. Not with
 * ⌘/Ctrl/Alt, not while typing, not on auto-repeat. `onKey` runs after each handled key (the bar uses it to show
 * itself). Listens while mounted.
 */
export function useFullscreenKeys({
  onToggle,
  onToggleMute,
  onToggleCaptions,
  onExit,
  onKey,
  enabled = true,
}: {
  onToggle: () => void;
  onToggleMute: () => void;
  onToggleCaptions?: (() => void) | undefined;
  onExit: () => void;
  onKey?: () => void;
  /** Off: the keys are left to the editor (K, M, C, F are its own when the film is not full screen). */
  enabled?: boolean;
}): void {
  const latest = React.useRef({ onToggle, onToggleMute, onToggleCaptions, onExit, onKey, enabled });
  latest.current = { onToggle, onToggleMute, onToggleCaptions, onExit, onKey, enabled };
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!latest.current.enabled) return;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const keys = latest.current;
      const action = ({
        k: keys.onToggle,
        m: keys.onToggleMute,
        c: keys.onToggleCaptions,
        f: keys.onExit,
      } as Record<string, (() => void) | undefined>)[e.key.toLowerCase()];
      if (!action) return;
      e.preventDefault();
      if (e.repeat) return;
      action();
      keys.onKey?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
