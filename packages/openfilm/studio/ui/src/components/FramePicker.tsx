/**
 * The canvas's shapes (the inspector's Stage menu) and a ratio typed by hand (the export's delivery frame). Picking a
 * shape changes the canvas itself: the film is scaled whole into it, centered, until the agent lays it out again.
 */
import * as React from 'react';
import { Check } from 'lucide-react';
import { useT } from '@/i18n';
import { customFilmFrame, type FilmFrameId } from '@/lib/film-frame';

/** The shapes a canvas is offered in: landscape, then portrait. */
export const CANVAS_RATIOS: { group: 'wide' | 'tall'; id: FilmFrameId; phone?: true }[] = [
  { group: 'wide', id: '16:9' },
  { group: 'wide', id: '21:9' },
  { group: 'wide', id: '4:3' },
  { group: 'wide', id: '2.35:1' },
  { group: 'wide', id: '2:1' },
  { group: 'wide', id: '1.85:1' },
  { group: 'tall', id: '9:16' },
  { group: 'tall', id: '3:4' },
  { group: 'tall', id: '9:19.5', phone: true },
  { group: 'tall', id: '1:1' },
  { group: 'tall', id: '1:2' },
];

/** A ratio's name in the menu: "9:16", or "5.8″ phone" for a phone's screen. */
export function canvasRatioLabel(t: (key: string) => string, item: { id: FilmFrameId; phone?: true }): string {
  return item.phone ? t('viewer.ratioPhone') : item.id;
}

/**
 * A ratio of the person's own, typed as width and height ("2.39" by "1", "5" by "4"), from 1:4 to 4:1: Enter or the
 * check puts it in use. Starts from the frame in use.
 */
export function CustomFrame({ value, disabled, onPick, className = '', chip = false }: {
  value: FilmFrameId;
  disabled?: boolean;
  onPick: (id: FilmFrameId) => void;
  className?: string;
  /** as one of a row of frame chips (the export dialog): the same height, border and corners, its fields capsules
      inside it with an even gap; else a menu's row */
  chip?: boolean;
}) {
  const t = useT();
  const [w0, h0] = value === 'native' ? ['16', '9'] : value.split(':');
  const [w, setW] = React.useState(w0 ?? '16');
  const [h, setH] = React.useState(h0 ?? '9');
  const id = customFilmFrame(Number(w), Number(h));
  const apply = () => { if (id) onPick(id); };
  const field = chip
    ? 'h-6 w-9 rounded-full bg-[var(--bg-field)] text-center text-[12px] font-medium tabular-nums text-[var(--text)] outline-none ring-[var(--text-faint)] focus:ring-1'
    : 'h-6 w-12 rounded-[5px] border border-[var(--border)] bg-[var(--bg-panel)] px-1.5 text-center text-[12px] tabular-nums text-[var(--text)] outline-none focus:border-[var(--accent)]';
  return (
    <div className={chip
      ? `flex items-center gap-1 rounded-lg border border-[var(--border)] py-[4px] pl-2.5 pr-[4px] ${className}`
      : `flex items-center gap-1.5 px-2 py-1 ${className}`}>
      <span className={chip ? 'mr-1 text-[12px] font-medium text-[var(--text-muted)]' : 'mr-auto text-[11.5px] text-[var(--text-muted)]'}>{t('viewer.frameCustom')}</span>
      <input aria-label={t('viewer.frameCustomW')} inputMode="decimal" value={w} disabled={disabled}
        onChange={(e) => setW(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} className={field} />
      <span className="text-[12px] text-[var(--text-faint)]">:</span>
      <input aria-label={t('viewer.frameCustomH')} inputMode="decimal" value={h} disabled={disabled}
        onChange={(e) => setH(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} className={field} />
      <button type="button" disabled={disabled || !id} onClick={apply} aria-label={t('viewer.frameCustomApply')}
        title={id ? undefined : t('viewer.frameCustomRange')}
        className={`flex h-6 w-6 items-center justify-center ${chip ? 'rounded-full' : 'rounded-[5px]'} text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-30`}>
        <Check size={13} />
      </button>
    </div>
  );
}
