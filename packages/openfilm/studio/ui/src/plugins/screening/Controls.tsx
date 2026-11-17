/**
 * The screening room's row of controls, as a video player lays it out and drawn as Studio's full-screen player draws
 * its own (the same icons, white): play, volume and the time on the left; the speed and full screen on the right.
 */
import * as React from 'react';
import { Tooltip } from '@/components/Tooltip';
import { Icon, PATH_FULLSCREEN, PATH_FULLSCREEN_EXIT } from '@/components/player-controls/controls-bar';
import { PLAYBACK_SPEEDS, speedText } from '@/lib/playback-speed';

/* material "speed", 24×24, as the row's other icons */
const PATH_SPEED = 'M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.27-10.44zm-9.79 6.84a2 2 0 0 0 2.83 0l5.66-8.49-8.49 5.66a2 2 0 0 0 0 2.83z';

/* material icons, 24×24, as the player's */
const PATH_CHECK = 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z';

/** A bare icon button of the row (the player's look), with Studio's tooltip. */
export const Btn = React.forwardRef<HTMLButtonElement, { label: string; onClick: () => void; active?: boolean; children: React.ReactNode } & React.HTMLAttributes<HTMLButtonElement>>(
  function Btn({ label, onClick, active, children, ...rest }, ref) {
    return (
      <button ref={ref} type="button" aria-label={label} onClick={onClick} {...rest}
        /* no focus on click: the next Space would land on the button */
        onMouseDown={(e) => { e.preventDefault(); rest.onMouseDown?.(e); }}
        className={`flex shrink-0 items-center justify-center rounded-[6px] px-1.5 py-1 text-white opacity-90 transition hover:scale-[1.08] hover:opacity-100 ${active ? 'bg-white/20' : ''}`}>
        {children}
      </button>
    );
  },
);

/**
 * The speed: the button says it (1×), a press opens the speeds to pick from, above it, as the player's settings list
 * them. A press anywhere else, or Esc, closes it.
 */
export function SpeedMenu({ rate, label, normal, onRate }: { rate: number; label: string; normal: string; onRate: (rate: number) => void }) {
  const [open, setOpen] = React.useState(false);
  const wrap = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key, true); };
  }, [open]);
  return (
    <div ref={wrap} className="relative">
      <Tooltip label={open ? undefined : label} shortcut="S">
        <Btn label={label} active={open} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {rate === 1 ? <Icon d={PATH_SPEED} /> : <span className="flex h-6 min-w-[24px] items-center justify-center text-[12.5px] font-semibold tabular-nums">{speedText(rate)}</span>}
        </Btn>
      </Tooltip>
      {open ? (
        <div role="menu" aria-label={label} className="absolute bottom-[44px] right-0 z-30 min-w-[150px] rounded-[12px] bg-[rgb(28_28_28/.94)] py-1.5 shadow-[0_8px_28px_rgb(0_0_0/.45)] backdrop-blur">
          <div className="px-4 pb-1.5 pt-1 text-[12px] text-white/55">{label}</div>
          {[...PLAYBACK_SPEEDS].reverse().map((s) => (
            <button key={s} type="button" role="menuitemradio" aria-checked={s === rate} onClick={() => { onRate(s); setOpen(false); }}
              className="flex w-full items-center gap-2.5 px-3 py-[7px] text-left text-[13px] text-[#eee] transition-colors hover:bg-white/10">
              <span className="grid w-5 place-items-center">{s === rate ? <Icon d={PATH_CHECK} size={16} /> : null}</span>
              {s === 1 ? normal : `${s}×`}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Full screen, drawn as the row's other buttons. */
export function FullscreenButton({ full, label, onClick }: { full: boolean; label: string; onClick: () => void }) {
  return (
    <Tooltip label={label} shortcut="F">
      <Btn label={label} onClick={onClick}><Icon d={full ? PATH_FULLSCREEN_EXIT : PATH_FULLSCREEN} /></Btn>
    </Tooltip>
  );
}
