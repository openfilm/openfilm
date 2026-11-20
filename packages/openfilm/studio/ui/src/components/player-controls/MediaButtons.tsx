/**
 * The speed and full-screen buttons in the edit's viewer and Screening share their styling and fit the size of
 * their respective bar. A button whose state is not the
 * default (a menu open, a speed other than 1×, a loop, full screen) is shown on a pressed background, so it is told
 * apart at a glance.
 */
import { Tooltip } from '@/components/Tooltip';
import type { ActionId } from '@/lib/keymap';
import { speedText } from '@/lib/playback-speed';
import { Icon, PATH_FULLSCREEN, PATH_FULLSCREEN_EXIT } from './controls-bar';

/** A player button's look, at rest and pressed (its state not the default). */
export const mediaButton = (on: boolean, size: number) =>
  `flex shrink-0 items-center justify-center gap-1 rounded-[6px] px-1 text-[var(--editor-control)] outline-none transition focus-visible:ring-1 focus-visible:ring-[var(--accent)] disabled:pointer-events-none disabled:text-[var(--editor-control-disabled)] disabled:opacity-100 aria-disabled:text-[var(--editor-control-disabled)] aria-disabled:opacity-100 aria-disabled:hover:bg-transparent ${
    on ? 'bg-[var(--bg-pressed)]' : 'hover:bg-[var(--bg-hover)]'}` + ` ${size >= 22 ? 'h-8 min-w-8' : 'h-7 min-w-7'}`;

export function SpeedFace({ speed }: { speed: number }) {
  return <span className="text-[12.5px] font-semibold leading-none tabular-nums">{speedText(speed)}</span>;
}

/** Full screen, or back from it. */
export function FullscreenButton({ full = false, label, onClick, disabled, size, action, shortcut }: {
  full?: boolean; label: string; onClick: () => void; disabled?: boolean; size: number;
  /** the keymap's action, for the tooltip's key (the edit's) */
  action?: ActionId;
  /** a key of its own, said in the tooltip (Screening's F) */
  shortcut?: string;
}) {
  return (
    <Tooltip label={label} {...(action ? { action } : {})} {...(shortcut ? { shortcut } : {})}>
      <button type="button" aria-label={label} aria-pressed={full} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={mediaButton(full, size)}>
        <Icon d={full ? PATH_FULLSCREEN_EXIT : PATH_FULLSCREEN} size={size} />
      </button>
    </Tooltip>
  );
}
