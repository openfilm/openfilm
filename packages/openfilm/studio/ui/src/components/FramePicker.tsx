/**
 * The aspect ratio button beside the picture: the film's canvas (its stage in film.html). Picking a shape changes the
 * canvas itself (`onCanvas`): the film is scaled whole into it, centered, until the agent lays it
 * out again. A delivery frame (bars or a crop around the film) is the export's. Any other size is typed in the
 * inspector.
 */
import * as React from 'react';
import { Check, Proportions } from 'lucide-react';
import { useT } from '@/i18n';
import { customFilmFrame, filmFrameRatio, type FilmFrameId } from '@/lib/film-frame';
import { Tooltip } from './Tooltip';

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

/** Whether the stage has this ratio: its width within 2 px of it (a size made from a ratio is rounded to even px). */
export const shaped = (stage: { w: number; h: number }, ratio: number) => Math.abs(stage.w - stage.h * ratio) <= 2;

export function FramePicker({
  stage, original, busy, onCanvas,
}: {
  stage: { w: number; h: number };
  /** The first picture's own size: "Original" takes its shape. None: nothing to fit to yet. */
  original?: { w: number; h: number } | null;
  /** The canvas change is being written: no second one meanwhile (two requests would race for one file). */
  busy?: boolean;
  /** Change the film's canvas to this shape (the editor works out its size and fits the film into it). */
  onCanvas: (next: FilmFrameId) => void;
}): React.ReactElement {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const box = React.useRef<HTMLDivElement | null>(null);
  const fit = original ? customFilmFrame(original.w, original.h) : null;
  const preset = CANVAS_RATIOS.find((r) => shaped(stage, filmFrameRatio(r.id, stage)));
  const isFit = Boolean(original && shaped(stage, original.w / original.h));

  React.useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [open]);

  const pick = (id: FilmFrameId) => { setOpen(false); onCanvas(id); };
  const row = 'flex w-full items-center gap-2.5 rounded-[5px] px-2 py-1.5 text-left text-[12px] text-[var(--text)] transition hover:bg-[var(--bg-hover)] disabled:pointer-events-none disabled:opacity-40';
  const tick = (on: boolean) => <span className="flex w-3.5 shrink-0 justify-center">{on ? <Check size={13} className="text-[var(--accent)]" /> : null}</span>;
  const item = (r: (typeof CANVAS_RATIOS)[number]) => (
    <button key={r.id} type="button" disabled={busy} onClick={() => pick(r.id)} onMouseDown={(e) => e.preventDefault()} className={row}>
      {tick(!isFit && preset?.id === r.id)}
      <span className="flex-1">{canvasRatioLabel(t, r)}</span>
    </button>
  );

  return (
    <div ref={box} className="relative flex items-center">
      <Tooltip label={t('viewer.canvas')}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          /* no focus on click: the next Space would land on this button instead of playing */
          onMouseDown={(e) => e.preventDefault()}
          className={`flex h-[22px] items-center gap-1 rounded-md px-1.5 text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] ${
            busy ? 'opacity-50' : ''
          }`}
          aria-label={t('viewer.canvas')}
          aria-expanded={open}
        >
          <Proportions size={14} />
          {/* the ratio is printed on the button: "this film is vertical" must be visible without opening it */}
          <span className="text-[12px] leading-none tabular-nums">{preset ? preset.id : `${stage.w}×${stage.h}`}</span>
        </button>
      </Tooltip>
      {open ? (
        <div className="absolute bottom-[28px] right-0 z-50 max-h-[min(520px,75vh)] w-[180px] overflow-y-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-lg)]">
          <button type="button" disabled={busy || !fit} onClick={() => fit && pick(fit)} onMouseDown={(e) => e.preventDefault()} className={row}>
            {tick(isFit)}
            <span className="flex-1">{t('viewer.ratioOriginal')}</span>
          </button>
          <div className="mx-1 my-1 h-px bg-[var(--border)]" />
          {CANVAS_RATIOS.filter((r) => r.group === 'wide').map(item)}
          <div className="mx-1 my-1 h-px bg-[var(--border)]" />
          {CANVAS_RATIOS.filter((r) => r.group === 'tall').map(item)}
        </div>
      ) : null}
    </div>
  );
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
    ? 'h-6 w-9 rounded-full bg-[var(--fill-tsp)] text-center text-[12px] font-medium tabular-nums text-[var(--text)] outline-none ring-[var(--text-faint)] focus:ring-1'
    : 'h-6 w-12 rounded-[5px] border border-[var(--border)] bg-[var(--bg)] px-1.5 text-center text-[12px] tabular-nums text-[var(--text)] outline-none focus:border-[var(--accent)]';
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
