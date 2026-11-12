/**
 * Which workbench the panes' place shows, on the top bar: one button saying which (its mark and name, on a fill of its
 * own so it reads apart from the bar's icons), and a short menu of the workbenches of the plugins on (lib/plugins),
 * each with what it is for. ProjectView shows it when there are more than the edit and the canvas to pick from (those
 * two alone are one button that goes from one to the other).
 */
import * as React from 'react';
import { Puzzle } from 'lucide-react';
import { useT } from '@/i18n';
import type { Plugin } from '@/lib/plugins';
import { PLUGIN_ICONS, usePluginWords } from './library/PluginsPane';
import { Popover } from './Popover';

const ROW = 'flex w-full items-center gap-2.5 rounded-[5px] px-2 text-left outline-none transition hover:bg-[var(--bg-hover)] focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]';

export function ModeSwitcher({ now, plugins, onPick, disabled = false }: {
  /** the workbench shown */
  now: string;
  /** the plugins whose workbench can be shown, in their order */
  plugins: readonly Plugin[];
  onPick: (workbench: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const words = usePluginWords();
  const [open, setOpen] = React.useState(false);
  const shown = plugins.find((p) => p.workbench === now) ?? plugins[0];
  if (!shown || plugins.length < 2) return null;
  const Now = PLUGIN_ICONS[shown.icon ?? ''] ?? Puzzle;
  return (
    <Popover open={open} onOpenChange={setOpen} align="end"
      trigger={(
        <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={t('canvas.workspaceLabel')} data-work-mode={now} disabled={disabled}
          onClick={() => setOpen(!open)}
          className="flex h-[26px] shrink-0 items-center gap-1.5 rounded-md bg-[var(--bg-hover)] px-2.5 text-[12.5px] font-medium text-[var(--text)] outline-none transition hover:bg-[var(--bg-pressed)] focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]">
          <Now size={14} />
          {words(shown).title}
        </button>
      )}>
      <div role="menu" aria-label={t('canvas.workspaceLabel')}
        className="flex w-[248px] flex-col rounded-[9px] border border-[var(--border-strong)] bg-[var(--panel)] p-1 text-[12px] text-[var(--text)] shadow-[0_10px_28px_rgb(0_0_0/.24),0_2px_6px_rgb(0_0_0/.16)]">
        {plugins.map((p) => {
          const on = p === shown;
          const Icon = PLUGIN_ICONS[p.icon ?? ''] ?? Puzzle;
          const { title, summary } = words(p);
          return (
            <button key={p.id} type="button" role="menuitemradio" aria-checked={on} data-mode-option={p.workbench}
              onClick={() => { setOpen(false); if (!on && p.workbench) onPick(p.workbench); }} className={`${ROW} py-1.5`}>
              <Icon size={15} className={`shrink-0 ${on ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`} />
              <span className="min-w-0 flex-1">
                <span className={`block leading-[17px] ${on ? 'font-medium text-[var(--accent)]' : ''}`}>{title}</span>
                <span className="block truncate text-[11px] leading-[15px] text-[var(--text-faint)]">{summary}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Popover>
  );
}
