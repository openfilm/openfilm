/**
 * What the panes are for, on the top bar: one button saying which (its mark and name, on a fill of its own so it reads
 * apart from the bar's icons), and a card of the three to go to — the edit (cutting the film), the canvas (making
 * material), motion (layers and keyframes, as an animation editor shows them). The one in use is in the accent.
 */
import * as React from 'react';
import { Film as FilmIcon, Spline, Workflow } from 'lucide-react';
import { useT } from '@/i18n';
import { Popover } from './Popover';

export type WorkMode = 'edit' | 'canvas' | 'motion';

const MODES: readonly { id: WorkMode; icon: typeof FilmIcon; title: string; note: string }[] = [
  { id: 'edit', icon: FilmIcon, title: 'canvas.modeEdit', note: 'canvas.noteEdit' },
  { id: 'canvas', icon: Workflow, title: 'canvas.modeCanvas', note: 'canvas.noteCanvas' },
  { id: 'motion', icon: Spline, title: 'canvas.modeMotion', note: 'canvas.noteMotion' },
];

export function ModeSwitcher({ mode, onMode }: { mode: WorkMode; onMode: (mode: WorkMode) => void }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const now = MODES.find((m) => m.id === mode) ?? MODES[0]!;
  const NowIcon = now.icon;
  return (
    <Popover open={open} onOpenChange={setOpen} align="end"
      trigger={(
        <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={t('canvas.modes')} data-work-mode={mode}
          onClick={() => setOpen(!open)}
          className={`ml-1 flex h-[26px] shrink-0 items-center gap-1.5 rounded-[7px] border border-[var(--border-strong)] px-2.5 text-[12px] font-medium text-[var(--text)] outline-none transition focus-visible:shadow-[inset_0_0_0_1px_var(--accent)] ${open ? 'bg-[var(--bg-active)]' : 'bg-[var(--fill-tsp)] hover:bg-[var(--bg-active)]'}`}>
          <NowIcon size={14} className="text-[var(--accent)]" />
          {t(now.title)}
        </button>
      )}>
      <div role="menu" aria-label={t('canvas.modes')}
        className="flex w-[300px] max-w-[calc(100vw-24px)] flex-col gap-0.5 rounded-[9px] border border-[var(--border-strong)] bg-[var(--panel)] p-1.5 text-[var(--text)] shadow-[0_10px_28px_rgb(0_0_0/.24),0_2px_6px_rgb(0_0_0/.12)]">
        <div className="px-2 pb-1 pt-1.5 text-[10.5px] font-medium leading-[18px] text-[var(--text-faint)]">{t('canvas.modes')}</div>
        {MODES.map((m) => {
          const on = m.id === mode;
          const Icon = m.icon;
          return (
            <button key={m.id} type="button" role="menuitemradio" aria-checked={on} data-mode-option={m.id}
              onClick={() => { setOpen(false); if (!on) onMode(m.id); }}
              className={`flex w-full items-center gap-3 rounded-[6px] px-2 py-2 text-left outline-none transition hover:bg-[var(--bg-hover)] focus-visible:shadow-[inset_0_0_0_1px_var(--accent)] ${on ? 'bg-[var(--accent-soft)]' : ''}`}>
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[7px] border ${on ? 'border-transparent bg-[var(--accent)] text-[var(--panel)]' : 'border-[var(--border)] bg-[var(--fill-tsp)] text-[var(--text-dim)]'}`}>
                <Icon size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[12.5px] font-medium leading-[18px] ${on ? 'text-[var(--accent)]' : ''}`}>{t(m.title)}</span>
                <span className="block text-[11px] leading-[16px] text-[var(--text-muted)]">{t(m.note)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Popover>
  );
}
