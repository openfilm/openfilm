/**
 * Which workbench the panes' place shows, on the top bar: one button saying which (its mark and name, on a fill of its
 * own so it reads apart from the bar's icons), and a short menu of the workbenches of the plugins on (lib/plugins):
 * each its mark, its name and its key (⌥1, ⌥2…; Alt elsewhere), and under them the key that goes back to the one
 * shown before (keymap `work-mode`, ⌘E). The keys are the shell's (shell/workbenches). The top bar (shell/top-bar)
 * shows it when there are more than the edit and the canvas to pick from (those two alone are one button that goes
 * from one to the other).
 */
import * as React from 'react';
import { Puzzle } from 'lucide-react';
import { useT } from '@/i18n';
import type { Plugin } from '@/lib/plugins';
import { MAC, useKeyHint } from '@/lib/keymap-store';
import { PLUGIN_ICONS, usePluginWords } from './library/PluginsPane';
import { Popover } from './Popover';

const ROW = 'flex w-full items-center gap-2.5 rounded-[6px] px-2 text-left outline-none transition hover:bg-[var(--bg-hover)] focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]';
const KEY = 'ml-auto shrink-0 font-sans text-[11px] tabular-nums text-[var(--text-faint)]';

/** The key that shows the `n`th workbench (from 1), as this computer's keyboard writes it. */
export const workbenchKey = (n: number): string => `${MAC ? '⌥' : 'Alt+'}${n}`;

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
  const keyHint = useKeyHint();
  const [open, setOpen] = React.useState(false);
  const shown = plugins.find((p) => p.workbench === now) ?? plugins[0];
  if (!shown || plugins.length < 2) return null;
  const Now = PLUGIN_ICONS[shown.icon ?? ''] ?? Puzzle;
  const back = keyHint('work-mode');
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
        className="flex w-[196px] flex-col rounded-[10px] border border-[var(--border-strong)] bg-[var(--panel)] p-1 text-[12.5px] text-[var(--text)] shadow-[0_10px_28px_rgb(0_0_0/.24),0_2px_6px_rgb(0_0_0/.16)]">
        {plugins.map((p, i) => {
          const on = p === shown;
          const Icon = PLUGIN_ICONS[p.icon ?? ''] ?? Puzzle;
          return (
            <button key={p.id} type="button" role="menuitemradio" aria-checked={on} data-mode-option={p.workbench}
              onClick={() => { setOpen(false); if (!on && p.workbench) onPick(p.workbench); }} className={`${ROW} h-8`}>
              <Icon size={15} className={`shrink-0 ${on ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`} />
              <span className={`min-w-0 truncate ${on ? 'font-medium text-[var(--accent)]' : ''}`}>{words(p).title}</span>
              {i < 9 ? <kbd className={KEY}>{workbenchKey(i + 1)}</kbd> : null}
            </button>
          );
        })}
        {back ? (
          <div className="mt-1 flex items-center border-t border-[var(--border)] px-2 pb-1 pt-2 text-[11px] text-[var(--text-faint)]">
            <span className="min-w-0 truncate">{t('settings.shortcuts.actions.work-mode')}</span>
            <kbd className={KEY}>{back}</kbd>
          </div>
        ) : null}
      </div>
    </Popover>
  );
}
