/**
 * A field that opens a menu of choices, drawn as Studio's own menus are (a card in the panel's colors, the chosen one
 * checked), in place of the browser's own list: that one is drawn by the system, light in a dark Studio, and with
 * the field's text color it read as if every choice were disabled. Choices may come in groups, each under a small
 * heading. The arrow keys move through them, Enter picks, Esc closes. With `onPreview`, the choice under the pointer (or
 * the keys) is shown on the picture before it is picked (a font, a blend mode); closing without a pick
 * takes it back (`onRevert`).
 */
import React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Popover } from './Popover';

export type MenuChoice = { value: string; label: string };
export type MenuGroup = { label?: string; choices: MenuChoice[] };

export function MenuSelect({
  label, value, groups, onPick, onPreview, onRevert, disabled = false, className = '', size = 'sm', prefix, menuWidth = 'trigger',
}: {
  /** what it chooses, for screen readers (the field shows the choice) */
  label: string;
  value: string;
  groups: MenuGroup[];
  onPick: (value: string) => void;
  /** Show a choice before it is picked (hovered, or reached with the keys). */
  onPreview?: (value: string) => void;
  /** Take the shown choice back: the menu closed without a pick, or the pointer left the list. */
  onRevert?: () => void;
  disabled?: boolean;
  className?: string;
  /** `sm`: the inspector's fields; `md`: a dialog's (the export's) */
  size?: 'sm' | 'md';
  /** A word before the choice (Blend), as the inspector's other fields have their mark. */
  prefix?: string;
  /** Long choices can size the open menu independently of a compact field. */
  menuWidth?: 'trigger' | 'content';
}) {
  const [open, setOpen] = React.useState(false);
  const [width, setWidth] = React.useState(0);
  const [active, setActive] = React.useState(-1);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const all = React.useMemo(() => groups.flatMap((g) => g.choices), [groups]);
  const current = all.find((c) => c.value === value);
  /* a choice is shown on the picture (onPreview), not picked yet. What was chosen when the menu opened: the field
     reads what is on the picture, so while a choice is shown, `value` is that one */
  const previewing = React.useRef(false);
  const origin = React.useRef(value);
  if (!open) origin.current = value;
  const show = (choice: MenuChoice | undefined) => {
    if (!onPreview) return;
    if (choice && choice.value !== origin.current) { previewing.current = true; onPreview(choice.value); }
    else if (previewing.current) { previewing.current = false; onRevert?.(); }
  };
  /* closed without a pick: what was shown goes */
  React.useEffect(() => {
    if (!open && previewing.current) { previewing.current = false; onRevert?.(); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  /* opened: at least as wide as the field, the chosen one in view and lit for the keys */
  React.useLayoutEffect(() => {
    if (!open) return;
    setWidth(triggerRef.current?.getBoundingClientRect().width ?? 0);
    setActive(Math.max(0, all.findIndex((c) => c.value === value)));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!open || active < 0) return;
    /* the list's own scroll only: scrollIntoView would also scroll what the field is in (a dialog's body) */
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!list || !item) return;
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [open, active]);

  const pick = (choice: MenuChoice) => {
    /* picked: the preview is the pick now (a pick of the one chosen before only takes the preview back) */
    const changed = choice.value !== origin.current;
    if (changed) previewing.current = false;
    setOpen(false);
    triggerRef.current?.focus();
    if (changed) onPick(choice.value);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); }
      return;
    }
    const go = (i: number) => { e.preventDefault(); setActive(i); show(all[i]); };
    if (e.key === 'ArrowDown') go(Math.min(all.length - 1, active + 1));
    else if (e.key === 'ArrowUp') go(Math.max(0, active - 1));
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(all.length - 1);
    else if ((e.key === 'Enter' || e.key === ' ') && all[active]) { e.preventDefault(); pick(all[active]); }
    else if (e.key === 'Tab') setOpen(false);
  };

  let index = -1;
  return (
    <Popover open={open && !disabled} onOpenChange={(next) => setOpen(next && !disabled)} placement="auto" block trigger={(
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        /* the popover keeps focus where it was on a press: the keys need it here */
        onClick={(e) => e.currentTarget.focus()}
        onKeyDown={onKeyDown}
        className={`flex min-w-0 flex-1 items-center gap-1.5 border border-[var(--border)] bg-[var(--fill-tsp)] text-left text-[var(--text)] ${size === 'md' ? 'h-9 rounded-lg pl-3 pr-2 text-[13px]' : 'h-7 rounded-md pl-2 pr-1.5 text-[11px]'} outline-none transition hover:border-[var(--text-faint)] focus-visible:border-[var(--accent)] disabled:opacity-50 ${open ? 'border-[var(--accent)]' : ''} ${className}`}
      >
        {prefix ? <span className="shrink-0 whitespace-nowrap text-[10.5px] text-[var(--text-faint)]">{prefix}</span> : null}
        <span className="min-w-0 flex-1 truncate">{current?.label ?? value}</span>
        <ChevronDown size={12} aria-hidden className={`shrink-0 text-[var(--text-faint)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
    )}>
      <div
        ref={listRef}
        data-film-inspector=""
        role="listbox"
        aria-label={label}
        onKeyDown={onKeyDown}
        onMouseLeave={() => show(undefined)}
        className="relative overflow-y-auto rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-1 shadow-[var(--shadow-lg)]"
        style={{
          width: menuWidth === 'content' ? 'max-content' : Math.max(width, 160),
          minWidth: Math.max(width, 160),
          maxWidth: 'calc(100vw - 24px)',
          maxHeight: 'min(320px, var(--popover-max-h, 320px))',
        }}
      >
        {groups.map((group, g) => (
          <div key={group.label ?? g} role="group" aria-label={group.label}>
            {group.label ? (
              <div className={`px-2 pb-1 text-[10.5px] font-medium text-[var(--text-faint)] ${g > 0 ? 'mt-1 border-t border-[var(--border)] pt-2' : 'pt-1'}`}>
                {group.label}
              </div>
            ) : g > 0 ? <div className="mx-1 my-1 h-px bg-[var(--border)]" /> : null}
            {group.choices.map((choice) => {
              index += 1;
              const i = index;
              const chosen = choice.value === value;
              return (
                <button
                  key={choice.value}
                  type="button"
                  role="option"
                  aria-selected={chosen}
                  data-index={i}
                  onMouseEnter={() => { setActive(i); show(choice); }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(choice)}
                  className={`flex w-full items-center gap-2 rounded-[5px] px-2 text-left text-[var(--text)] ${size === 'md' ? 'h-8 text-[13px]' : 'h-7 text-[11.5px]'} ${i === active ? 'bg-[var(--bg-hover)]' : ''}`}
                >
                  <span className="min-w-0 flex-1 truncate">{choice.label}</span>
                  {chosen ? <Check size={12} aria-hidden className="shrink-0 text-[var(--accent)]" /> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </Popover>
  );
}
