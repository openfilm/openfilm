/**
 * A choice in Settings from a longer list: the trigger a bordered field, the list a menu card portaled to the page (Popover), so
 * the pane it sits in never clips it. The arrow keys move through it, Enter picks, typing jumps to a name.
 */
import React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Popover } from '@/components/Popover';

type Option<T extends string> = { value: T; label: string; icon?: React.ReactNode };

export function SettingsSelect<T extends string>({ label, value, options, onChange, width }: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  /** a fixed width (a form field); without one the trigger is as wide as what it shows */
  width?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const list = React.useRef<HTMLDivElement>(null);
  const typed = React.useRef({ text: '', at: 0 });
  const selected = options.find((option) => option.value === value) ?? options[0]!;

  /* the list opens on the chosen one */
  React.useEffect(() => {
    if (!open) return;
    const r = requestAnimationFrame(() => (list.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? list.current?.querySelector<HTMLElement>('[role="option"]'))?.focus());
    return () => cancelAnimationFrame(r);
  }, [open]);

  const choose = (option: Option<T>) => { setOpen(false); if (option.value !== value) onChange(option.value); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
      const match = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
      if (match >= 0) items[match]?.focus();
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="auto"
      align="end"
      layer={10060}
      trigger={(
        <button type="button" aria-label={`${label}: ${selected.label}`} aria-haspopup="listbox" aria-expanded={open}
          style={width ? { width } : undefined}
          className={`flex h-10 max-w-full items-center gap-2 ${width ? '' : 'w-auto'} rounded-[8px] border px-3 text-left text-[14.5px] text-[var(--text)] transition ${open ? 'border-[var(--text-muted)]' : 'border-[var(--border)] hover:border-[var(--border-strong)]'}`}>
          {selected.icon ? <span className="flex shrink-0 text-[var(--text-muted)]">{selected.icon}</span> : null}
          {/* without a width it is as wide as what it shows */}
          <span className={width ? 'min-w-0 flex-1 truncate' : 'whitespace-nowrap'}>{selected.label}</span>
          <ChevronDown size={15} className="shrink-0 text-[var(--text-muted)]" />
        </button>
      )}
    >
      <div ref={list} role="listbox" aria-label={label} onKeyDown={onKeyDown}
        style={{ minWidth: width ?? 160 }}
        className="max-h-[min(320px,var(--popover-max-h))] overflow-y-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-lg)]">
        {options.map((option) => {
          const on = option.value === value;
          return (
            <button key={option.value} type="button" role="option" aria-selected={on} onClick={() => choose(option)}
              className="flex h-9 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[14.5px] text-[var(--text)] outline-none hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)]">
              {option.icon ? <span className="flex shrink-0 text-[var(--text-muted)]">{option.icon}</span> : null}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              <Check size={16} className={on ? 'shrink-0 text-[var(--text)]' : 'invisible shrink-0'} />
            </button>
          );
        })}
      </div>
    </Popover>
  );
}
