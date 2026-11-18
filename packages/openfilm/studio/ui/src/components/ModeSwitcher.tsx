/**
 * Which workbench the panes' place shows, on the top bar: one button saying which (its name, on a fill of its own so
 * it reads apart from the bar's icons), and a short menu of the workbenches of the plugins on (lib/plugins), in the
 * person's order, under its title and a "?" for how the workbench shown is used (components/WorkbenchGuide, which also
 * says the keys): each its mark (components/WorkbenchMark), its name and its key (⌥1, ⌥2…; Alt elsewhere). The keys
 * are the shell's (shell/workbenches). The top bar (shell/top-bar)
 * shows it when there are more than the edit and the canvas to pick from (those two alone are one button that goes
 * from one to the other).
 */
import * as React from 'react';
import { CircleHelp } from 'lucide-react';
import { useT } from '@/i18n';
import type { Plugin } from '@/lib/plugins';
import { MAC } from '@/lib/keymap-store';
import { usePluginWords } from './library/PluginsPane';
import { Popover } from './Popover';
import { Tooltip } from './Tooltip';
import { WorkbenchMark } from './WorkbenchMark';

const ROW = 'flex w-full items-center gap-2.5 rounded-[6px] px-2 text-left outline-none transition hover:bg-[var(--bg-hover)] focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]';
const KEY = 'ml-auto shrink-0 font-sans text-[11px] tabular-nums text-[var(--text-faint)]';

/** The key that shows the `n`th workbench (from 1), as this computer's keyboard writes it. */
export const workbenchKey = (n: number): string => `${MAC ? '⌥' : 'Alt+'}${n}`;

export function ModeSwitcher({ now, plugins, onPick, onGuide, disabled = false }: {
  /** the workbench shown */
  now: string;
  /** the plugins whose workbench can be shown, in their order */
  plugins: readonly Plugin[];
  onPick: (workbench: string) => void;
  /** what the workbench shown is for and how it is used (components/WorkbenchGuide) */
  onGuide?: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  const words = usePluginWords();
  const [open, setOpen] = React.useState(false);
  const shown = plugins.find((p) => p.workbench === now) ?? plugins[0];
  if (!shown || plugins.length < 2) return null;
  return (
    <Popover open={open} onOpenChange={setOpen} align="end"
      trigger={(
        <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={t('canvas.workspaceLabel')} data-work-mode={now} disabled={disabled}
          onClick={() => setOpen(!open)}
          className="flex h-[26px] shrink-0 items-center rounded-md bg-[var(--bg-hover)] px-2.5 text-[12.5px] font-medium text-[var(--text)] outline-none transition hover:bg-[var(--bg-pressed)] focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]">
          {words(shown).title}
        </button>
      )}>
      <div role="menu" aria-label={t('canvas.workspaceLabel')}
        className="flex w-[184px] flex-col rounded-[10px] border border-[var(--border-strong)] bg-[var(--bg-raised)] p-1 text-[12.5px] text-[var(--text)] shadow-[var(--shadow-lg)]">
        {/* its title, and beside it how the workbench shown is used (with the keys that go from one to another) */}
        <div className="flex h-8 items-center justify-between pl-2.5 pr-0.5">
          <strong className="text-[12.5px] font-semibold">{t('canvas.workspaceLabel')}</strong>
          {onGuide ? (
            <Tooltip label={t('guide.open').replace('{name}', words(shown).title)} side="bottom">
              <button type="button" role="menuitem" data-mode-guide aria-label={t('guide.open').replace('{name}', words(shown).title)}
                onClick={() => { setOpen(false); onGuide(); }}
                className="grid h-6 w-6 place-items-center rounded-md text-[var(--text-muted)] outline-none transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]">
                <CircleHelp size={14} />
              </button>
            </Tooltip>
          ) : null}
        </div>
        {plugins.map((p, i) => {
          const on = p === shown;
          return (
            <button key={p.id} type="button" role="menuitemradio" aria-checked={on} data-mode-option={p.workbench}
              onClick={() => { setOpen(false); if (!on && p.workbench) onPick(p.workbench); }} className={`${ROW} h-8`}>
              <WorkbenchMark plugin={p} size={20} />
              <span className={`min-w-0 truncate ${on ? 'font-medium text-[var(--accent)]' : ''}`}>{words(p).title}</span>
              {i < 9 ? <kbd className={KEY}>{workbenchKey(i + 1)}</kbd> : null}
            </button>
          );
        })}
      </div>
    </Popover>
  );
}
