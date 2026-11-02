/**
 * What the panes are for, on the top bar: one button saying which (its mark and name, on a fill of its own so it reads
 * apart from the bar's icons), and a short menu of the ways of working on (lib/work-modes) — the edit (cutting the film),
 * the canvas (making material), motion (layers and keyframes) — and which of them are on, in Settings. With one on, there
 * is no button.
 */
import * as React from 'react';
import { Film as FilmIcon, Settings2, Spline, Workflow } from 'lucide-react';
import { useT } from '@/i18n';
import type { WorkMode } from '@/lib/work-modes';
import { Popover } from './Popover';

export type { WorkMode };

const MODES: Record<WorkMode, { icon: typeof FilmIcon; title: string; note: string }> = {
  edit: { icon: FilmIcon, title: 'canvas.modeEdit', note: 'canvas.noteEdit' },
  canvas: { icon: Workflow, title: 'canvas.modeCanvas', note: 'canvas.noteCanvas' },
  motion: { icon: Spline, title: 'canvas.modeMotion', note: 'canvas.noteMotion' },
};

const ROW = 'flex w-full items-center gap-2.5 rounded-[5px] px-2 text-left outline-none transition hover:bg-[var(--bg-hover)] focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]';

export function ModeSwitcher({ mode, modes, onMode, onSettings }: {
  mode: WorkMode;
  /** The ways of working on (Settings → Advanced). */
  modes: readonly WorkMode[];
  onMode: (mode: WorkMode) => void;
  onSettings: () => void;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  if (modes.length < 2) return null;
  const Now = MODES[mode].icon;
  return (
    <Popover open={open} onOpenChange={setOpen} align="end"
      trigger={(
        <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={t('canvas.modes')} data-work-mode={mode}
          onClick={() => setOpen(!open)}
          className={`ml-1 flex h-[26px] shrink-0 items-center gap-1.5 rounded-[7px] border border-[var(--border-strong)] px-2.5 text-[12px] font-medium text-[var(--text)] outline-none transition focus-visible:shadow-[inset_0_0_0_1px_var(--accent)] ${open ? 'bg-[var(--bg-active)]' : 'bg-[var(--fill-tsp)] hover:bg-[var(--bg-active)]'}`}>
          <Now size={14} className="text-[var(--accent)]" />
          {t(MODES[mode].title)}
        </button>
      )}>
      <div role="menu" aria-label={t('canvas.modes')}
        className="flex w-[248px] flex-col rounded-[9px] border border-[var(--border-strong)] bg-[var(--panel)] p-1 text-[12px] text-[var(--text)] shadow-[0_10px_28px_rgb(0_0_0/.24),0_2px_6px_rgb(0_0_0/.12)]">
        {modes.map((m) => {
          const on = m === mode;
          const Icon = MODES[m].icon;
          return (
            <button key={m} type="button" role="menuitemradio" aria-checked={on} data-mode-option={m}
              onClick={() => { setOpen(false); if (!on) onMode(m); }} className={`${ROW} py-1.5`}>
              <Icon size={15} className={`shrink-0 ${on ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`} />
              <span className="min-w-0 flex-1">
                <span className={`block leading-[17px] ${on ? 'font-medium text-[var(--accent)]' : ''}`}>{t(MODES[m].title)}</span>
                <span className="block truncate text-[11px] leading-[15px] text-[var(--text-faint)]">{t(MODES[m].note)}</span>
              </span>
            </button>
          );
        })}
        <div className="my-1 h-px bg-[var(--border)]" />
        <button type="button" role="menuitem" data-mode-settings="" onClick={() => { setOpen(false); onSettings(); }}
          className={`${ROW} h-[28px] text-[var(--text-muted)] hover:text-[var(--text)]`}>
          <Settings2 size={14} className="shrink-0" />
          {t('canvas.modesSettings')}
        </button>
      </div>
    </Popover>
  );
}
