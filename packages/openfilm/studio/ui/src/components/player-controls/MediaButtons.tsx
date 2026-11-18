/**
 * The speed and full-screen buttons every editor's player has (the edit's viewer, Screening): the same icons (the
 * player's), the same look, sized to the bar they are in (`size`, the icon's). A button whose state is not the
 * default (a menu open, a speed other than 1×, a loop, full screen) is shown on a pressed background, so it is told
 * apart at a glance.
 */
import { Tooltip } from '@/components/Tooltip';
import type { ActionId } from '@/lib/keymap';
import { Icon, PATH_FULLSCREEN, PATH_FULLSCREEN_EXIT } from './controls-bar';

/* material "speed", 24×24, as the player's other icons */
export const PATH_SPEED = 'M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.27-10.44zm-9.79 6.84a2 2 0 0 0 2.83 0l5.66-8.49-8.49 5.66a2 2 0 0 0 0 2.83z';

/** A player button's look, at rest and pressed (its state not the default). */
export const mediaButton = (on: boolean, size: number) =>
  `flex shrink-0 items-center justify-center gap-1 rounded-[6px] px-1 outline-none transition focus-visible:ring-1 focus-visible:ring-[var(--accent)] disabled:pointer-events-none disabled:opacity-30 ${
    on ? 'bg-[var(--bg-pressed)] text-[var(--text)]' : 'text-[var(--text)] opacity-85 hover:bg-[var(--bg-hover)] hover:opacity-100'}` + ` ${size >= 22 ? 'h-8 min-w-8' : 'h-7 min-w-7'}`;

/** What the speed button shows: the speed icon at 1×, else the speed itself. */
export function SpeedFace({ speed, size }: { speed: number; size: number }) {
  return speed === 1 ? <Icon d={PATH_SPEED} size={size} />
    : <span className="text-[12.5px] font-semibold leading-none tabular-nums">{`${speed}×`}</span>;
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
