import React from 'react';
import { createPortal } from 'react-dom';
import { Gauge, Repeat } from 'lucide-react';
import { useT } from '@/i18n';
import { useKeyHint } from '@/lib/keymap-store';
import { PLAYBACK_SPEEDS, speedStep, speedText } from '@/lib/playback-speed';
import { Tooltip } from './Tooltip';

export type PlaybackSettings = {
  /** Loop playback (⇧L): of the range marked (`ranged`), else of the whole film. */
  loop: boolean;
  ranged: boolean;
  onLoop: () => void;
  speed: number;
  onSpeed: (speed: number) => void;
};

/**
 * The viewer's playback settings: loop and the speed. What is not the default shows on the
 * button itself (the loop icon, "1.5×"), so it is seen without opening the menu. Laid out as the layout menu beside
 * it is (a row each, its icon in a tile); the speed is one segmented control. Nothing here takes focus on click: the next
 * Space still plays.
 */
export function PlaybackMenu({ className, disabled, settings }: {
  className?: string;
  disabled?: boolean;
  settings: PlaybackSettings;
}) {
  const t = useT();
  const keyHint = useKeyHint();
  const button = React.useRef<HTMLButtonElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = React.useState<{ right: number; bottom: number } | null>(null);
  const id = React.useId();
  React.useEffect(() => {
    if (!anchor) return;
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setAnchor(null);
    };
    const close = () => setAnchor(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
    };
    /* capture phase: the picture, the timeline and inputs each stop pointerdown, so it never bubbles to window.
       A click into the preview iframe sends no event at all, only a window blur — that counts as "elsewhere" too. */
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', escape, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [anchor]);

  const { loop, ranged, onLoop, speed, onSpeed } = settings;
  const loopLabel = t(ranged ? 'viewer.loopRange' : 'viewer.loopFilm');
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const tile = (Icon: typeof Repeat) => (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--bg-field)] text-[var(--text-muted)]"><Icon size={13} aria-hidden /></span>
  );

  return <>
    <Tooltip label={t('viewer.playback')}>
      <button ref={button} type="button" disabled={disabled} className={className} aria-label={t('viewer.playback')}
        aria-haspopup="dialog" aria-expanded={!!anchor} aria-controls={anchor ? id : undefined}
        data-viewer-loop={loop ? '1' : '0'} data-viewer-speed={speed}
        /* no focus on click: the next Space would land on this button instead of playing */
        onMouseDown={keep}
        onClick={() => {
          const rect = button.current!.getBoundingClientRect();
          setAnchor((current) => current ? null : { right: Math.max(12, window.innerWidth - rect.right), bottom: window.innerHeight - rect.top + 6 });
        }}>
        {loop ? <Repeat size={14} className="text-[var(--accent)]" aria-hidden /> : null}
        {speed !== 1 ? <span className="text-[12px] leading-none tabular-nums">{speedText(speed)}</span> : null}
        {!loop && speed === 1 ? <Gauge size={14} aria-hidden /> : null}
      </button>
    </Tooltip>
    {anchor && createPortal(<div ref={panel} id={id} role="dialog" aria-label={t('viewer.playback')}
      style={anchor} className="fixed z-[110] w-60 rounded-[14px] border border-[var(--border)] bg-[var(--bg-raised)] p-1.5 shadow-[0_18px_48px_-12px_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.12)]">
      <div className="px-2 pb-1 pt-1 text-[11px] font-medium text-[var(--text-faint)]">{t('viewer.playback')}</div>
      <button type="button" role="switch" aria-checked={loop} onClick={onLoop} onMouseDown={keep} data-playback="loop"
        className="flex w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-[13px] text-[var(--text)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-[var(--border-strong)]">
        {tile(Repeat)}
        <span className="flex-1 text-left">{loopLabel}</span>
        {keyHint('loop') ? <span className="text-[11px] text-[var(--text-faint)]">{keyHint('loop')}</span> : null}
        {/* a switch, ink-colored, as the layout menu's */}
        <span aria-hidden className={`relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors ${loop ? 'bg-[var(--switch-on)]' : 'bg-[var(--bg-field)] ring-1 ring-inset ring-[var(--border)]'}`}>
          <span className={`absolute top-[3px] h-3 w-3 rounded-full transition-all ${loop ? 'left-[15px] bg-white' : 'left-[3px] bg-[var(--text-faint)]'}`} />
        </span>
      </button>
      <div className="flex items-center gap-2.5 px-2 pb-1.5 pt-1.5 text-[13px] text-[var(--text)]">
        {tile(Gauge)}
        <span className="flex-1">{t('viewer.speed')}</span>
      </div>
      <SpeedRow label={t('viewer.speed')} speed={speed} onSpeed={onSpeed} keep={keep} />
    </div>, document.body)}
  </>;
}

/** Speeds a row: PLAYBACK_SPEEDS in two rows, the slower ones up to 1×, then the faster. */
const PER_ROW = 4;

/**
 * The speed: PLAYBACK_SPEEDS as one segmented control in two rows, as the inspector's choices are, the one playing
 * raised on a mark that slides to the next one picked. A speed between them (the shuttle's) marks the nearest.
 */
function SpeedRow({ label, speed, onSpeed, keep }: {
  label: string;
  speed: number;
  onSpeed: (speed: number) => void;
  keep: (e: React.MouseEvent) => void;
}) {
  const at = speedStep(speed);
  const rows = Math.ceil(PLAYBACK_SPEEDS.length / PER_ROW);
  return (
    <div role="radiogroup" aria-label={label} data-playback="speed"
      className="relative mx-2 mb-1.5 grid rounded-[8px] bg-[var(--bg-field)] p-[2px]"
      style={{ gridTemplateColumns: `repeat(${PER_ROW}, minmax(0, 1fr))` }}>
      <span aria-hidden className="absolute left-[2px] top-[2px] rounded-[6px] bg-[var(--bg-panel)] shadow-[0_0_0_0.5px_var(--border-strong),0_1px_2px_rgba(0,0,0,0.12)] transition-transform duration-200 ease-out"
        style={{
          width: `calc((100% - 4px) / ${PER_ROW})`,
          height: `calc((100% - 4px) / ${rows})`,
          transform: `translate(${(at % PER_ROW) * 100}%, ${Math.floor(at / PER_ROW) * 100}%)`,
        }} />
      {PLAYBACK_SPEEDS.map((s, i) => (
        <button key={s} type="button" role="radio" aria-checked={i === at} onClick={() => onSpeed(s)} onMouseDown={keep}
          className={`relative h-[28px] rounded-[6px] text-[12px] tabular-nums transition-colors focus-visible:outline focus-visible:outline-[var(--border-strong)] ${
            i === at ? 'font-medium text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}>
          {speedText(s)}
        </button>
      ))}
    </div>
  );
}
