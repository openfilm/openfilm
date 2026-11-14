/**
 * How the screening room is used: its gestures and its keys, shown while ⌘ (Ctrl elsewhere) is held alone for a moment
 * and gone as it is let go, or opened from its button (and closed by a click anywhere). Each line: what it does, and
 * the gesture or keys that do it, as key caps.
 */
import * as React from 'react';
import { MAC } from '@/lib/keymap-store';

/** How long the key is held alone before the sheet shows, ms: a ⌘ pressed for a shortcut never shows it. */
const HOLD_MS = 450;

export interface Shortcut { keys: readonly string[]; label: string }

/** Whether the sheet is shown: while ⌘ (Ctrl) is held alone, from `HOLD_MS` on; `active` false: never. */
export function useHeldSheet(active: boolean): boolean {
  const [held, setHeld] = React.useState(false);
  React.useEffect(() => {
    if (!active) { setHeld(false); return; }
    const modifier = MAC ? 'Meta' : 'Control';
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = () => { if (timer) clearTimeout(timer); timer = null; setHeld(false); };
    const down = (e: KeyboardEvent) => {
      if (e.key === modifier && !e.repeat && !e.shiftKey && !e.altKey) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => setHeld(true), HOLD_MS);
      } else stop();
    };
    const up = (e: KeyboardEvent) => { if (e.key === modifier) stop(); };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', stop);
    window.addEventListener('pointerdown', stop, true);
    return () => {
      stop();
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', stop);
      window.removeEventListener('pointerdown', stop, true);
    };
  }, [active]);
  return held;
}

export function Keys({ keys, small = false }: { keys: readonly string[]; small?: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((k) => (
        <kbd key={k} className={`grid place-items-center rounded-[5px] border border-[color:var(--border-strong)] bg-[var(--bg-raised)] font-sans font-medium text-[var(--text)] shadow-[0_1px_0_var(--border-strong)] ${small ? 'h-[18px] min-w-[18px] px-1 text-[10.5px]' : 'h-6 min-w-6 px-1.5 text-[12px]'}`}>{k}</kbd>
      ))}
    </span>
  );
}

/** The sheet over the screening room; `onClose`: it was opened from its button, and a click anywhere closes it. */
export function ShortcutSheet({ title, groups, hold, onClose }: {
  title: string; groups: readonly { title: string; items: readonly Shortcut[] }[]; hold: Shortcut; onClose?: () => void;
}) {
  return (
    <div className={`absolute inset-0 z-40 grid place-items-center bg-black/30 ${onClose ? 'pointer-events-auto' : 'pointer-events-none'}`} onClick={onClose}>
      <div role="dialog" aria-label={title} className="w-[min(620px,calc(100%-48px))] rounded-2xl border border-[color:var(--border-strong)] bg-[var(--bg-raised)] p-5 shadow-[0_24px_64px_rgb(0_0_0/.45)]">
        <div className="mb-4 text-[14px] font-semibold text-[var(--text)]">{title}</div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
          {groups.map((group) => (
            <div key={group.title} className="flex flex-col gap-2.5">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-faint)]">{group.title}</div>
              {group.items.map((s) => (
                <div key={s.label} className="flex items-center justify-between gap-3 text-[12.5px] text-[var(--text-muted)]">
                  <span className="min-w-0 truncate">{s.label}</span>
                  <Keys keys={s.keys} />
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-[color:var(--border)] pt-3 text-[11.5px] text-[var(--text-faint)]">
          <span>{hold.label}</span>
          <Keys keys={hold.keys} small />
        </div>
      </div>
    </div>
  );
}

/** The modifier's name as this computer's keyboard shows it. */
export const MOD = MAC ? '⌘' : 'Ctrl';
