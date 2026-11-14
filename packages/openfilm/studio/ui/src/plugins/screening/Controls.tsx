/**
 * The screening room's row of controls, as a video player lays it out and drawn as Studio's full-screen player draws
 * its own (the same icons, volume and settings): play, volume and the time on the left; zoom, settings, how it is used
 * and full screen on the right.
 */
import * as React from 'react';
import { Tooltip } from '@/components/Tooltip';
import { Icon } from '@/components/player-controls/controls-bar';

/* material icons, 24×24, as the player's */
export const PATH_ZOOM_IN = 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zm.5-7H9v2H7v1h2v2h1v-2h2V9h-2z';
export const PATH_ZOOM_OUT = 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM7 9h5v1H7z';
export const PATH_HELP = 'M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z';

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

/** The slider's track length and the padding at each end for its knob, as the volume's. */
const TRACK_W = 52;
const PAD = 7;

/**
 * Zoom, as the volume is: the magnifier (closer when the whole film is shown, the whole film when closer), and a
 * slider sliding out under the pointer from the whole film (left) to a second across the bar (right).
 */
export function ZoomControl({ level, label, wholeLabel, onLevel }: { level: number; label: string; wholeLabel: string; onLevel: (level: number) => void }) {
  const [hover, setHover] = React.useState(false);
  const track = React.useRef<HTMLDivElement>(null);
  const dragging = React.useRef(false);
  const open = hover || dragging.current;
  const at = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (r && r.width > 0) onLevel(Math.max(0, Math.min(1, (clientX - r.left) / r.width)));
  };
  return (
    <div className="flex items-center" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="overflow-hidden transition-[width,opacity] duration-200" style={{ width: open ? TRACK_W + PAD * 2 : 0, opacity: open ? 1 : 0 }}>
        <div role="slider" aria-label={label} aria-valuemin={0} aria-valuemax={1} aria-valuenow={level}
          className="relative flex h-6 cursor-pointer touch-none items-center" style={{ width: TRACK_W + PAD * 2, padding: `0 ${PAD}px` }}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); at(e.clientX); }}
          onPointerMove={(e) => { if (dragging.current) at(e.clientX); }}
          onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}>
          <div ref={track} className="pointer-events-none relative h-[3px] rounded-full bg-white/30" style={{ width: TRACK_W }}>
            <div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${level * 100}%` }} />
            <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" style={{ left: `${level * 100}%` }} />
          </div>
        </div>
      </div>
      <Tooltip label={level > 0 ? wholeLabel : label} shortcut={level > 0 ? '0' : '+'}>
        <Btn label={level > 0 ? wholeLabel : label} onClick={() => onLevel(level > 0 ? 0 : 0.5)}>
          <Icon d={level > 0 ? PATH_ZOOM_OUT : PATH_ZOOM_IN} />
        </Btn>
      </Tooltip>
    </div>
  );
}
