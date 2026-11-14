/**
 * Which workbench the panes' place shows, on the top bar: the workbenches of the plugins on (lib/plugins), side by side,
 * each its mark and name, the one shown lit. One click shows another; ⌥1, ⌥2… (Alt elsewhere) show them in this order,
 * and ⌘E (Ctrl+E) goes back to the one shown before (shell/workbenches), as each one's tooltip says.
 */
import { Puzzle } from 'lucide-react';
import type { Plugin } from '@/lib/plugins';
import { MAC } from '@/lib/keymap-store';
import { PLUGIN_ICONS, usePluginWords } from './library/PluginsPane';
import { Tooltip } from './Tooltip';

/** The key that shows the `n`th workbench (from 1), as this computer's keyboard writes it. */
export const workbenchKey = (n: number): string => `${MAC ? '⌥' : 'Alt+'}${n}`;

export function ModeSwitcher({ now, plugins, onPick, disabled = false, label }: {
  /** the workbench shown */
  now: string;
  /** the plugins whose workbench can be shown, in their order */
  plugins: readonly Plugin[];
  onPick: (workbench: string) => void;
  disabled?: boolean;
  /** the row's name, for those who cannot see it */
  label: string;
}) {
  const words = usePluginWords();
  if (plugins.length < 2) return null;
  return (
    <div role="tablist" aria-label={label} data-work-mode={now}
      className="flex h-[28px] shrink-0 items-center gap-[2px] rounded-[8px] bg-[var(--bg-hover)] p-[2px]">
      {plugins.map((p, i) => {
        const on = p.workbench === now;
        const Icon = PLUGIN_ICONS[p.icon ?? ''] ?? Puzzle;
        const title = words(p).title;
        return (
          <Tooltip key={p.id} label={title} shortcut={i < 9 ? workbenchKey(i + 1) : undefined} side="bottom">
            <button type="button" role="tab" aria-selected={on} data-mode-option={p.workbench} disabled={disabled}
              onClick={() => { if (!on && p.workbench) onPick(p.workbench); }}
              className={`flex h-full items-center gap-1.5 rounded-[6px] px-2.5 text-[12.5px] font-medium outline-none transition focus-visible:shadow-[inset_0_0_0_1px_var(--accent)] ${on
                ? 'bg-[var(--bg-raised)] text-[var(--text)] shadow-[0_1px_2px_rgb(0_0_0/.25),0_0_0_0.5px_var(--border-strong)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
              <Icon size={14} />
              {title}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
