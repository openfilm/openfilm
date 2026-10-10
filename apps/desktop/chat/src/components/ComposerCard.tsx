'use client';

/**
 * The cards above the composer and in the conversation that ask the person to decide: one shell, one set of
 * buttons.
 *
 * Background and border follow the composer (they sit together), radius 12, the same shadow as the model menu.
 * Buttons have one height (28) and three weights: primary (filled), secondary (outlined), quiet (text only).
 * Choice rows are shared by question and permission cards: one choice per row, a number key cap on the left,
 * pressing the number picks it, as in Claude Code's menus.
 */
import React from 'react';
import { ChevronDown, X } from 'lucide-react';
import { useT } from '@/i18n';
import { inChat } from '@/lib/chat-layer';

/** The shell of floating layers (menus, dropdowns): the cards' shadow, on the surface color. */
export const POPOVER_CHROME: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-strong)',
  borderRadius: 12,
  boxShadow: '0 16px 40px -8px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.18)',
};

export function ComposerCard({
  icon,
  title,
  body,
  onClose,
  collapse,
  children,
  role,
  className = '',
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  body?: React.ReactNode;
  onClose?: () => void;
  /**
   * Collapsible: a collapse button left of the close button. Collapsed, only the title row remains (the matter still
   * waits, just out of the way); the title or the button expands it. `label` is the button's current screen-reader text.
   */
  collapse?: { collapsed: boolean; onToggle: () => void; label: string };
  children?: React.ReactNode;
  role?: React.AriaRole;
  className?: string;
}) {
  const t = useT();
  const collapsed = collapse?.collapsed ?? false;
  const buttons = (onClose ? 1 : 0) + (collapse ? 1 : 0);
  return (
    <div
      {...(role ? { role } : {})}
      className={`relative rounded-[12px] border border-[var(--composer-border)] bg-[var(--composer-bg)] px-3.5 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.35)] ${collapsed ? 'py-2' : 'pb-3 pt-3'} ${className}`}
    >
      <div className={`absolute right-2 flex items-center gap-0.5 ${collapsed ? 'top-1.5' : 'top-2'}`}>
        {collapse ? (
          <button
            type="button"
            onClick={collapse.onToggle}
            aria-label={collapse.label}
            aria-expanded={!collapsed}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            <ChevronDown size={14} strokeWidth={1.75} className={`transition-transform duration-150 ${collapsed ? 'rotate-180' : ''}`} />
          </button>
        ) : null}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('project.close')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
      <div className={`flex items-start gap-2 ${buttons === 2 ? 'pr-14' : buttons === 1 ? 'pr-7' : ''}`}>
        {icon ? <span className="mt-[2px] shrink-0 text-[var(--text-muted)]">{icon}</span> : null}
        <div className="min-w-0 flex-1">
          {collapse && collapsed ? (
            <button type="button" onClick={collapse.onToggle} className="block w-full min-w-0 truncate text-left text-[13px] font-medium leading-snug text-[var(--text)]">
              {title}
            </button>
          ) : (
            <h3 className="text-[13px] font-medium leading-snug text-[var(--text)]">{title}</h3>
          )}
          {body && !collapsed ? <div className="mt-1 text-[12.5px] leading-relaxed text-[var(--text-muted)]">{body}</div> : null}
        </div>
      </div>
      {collapsed ? null : children}
    </div>
  );
}

export function CardActions({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`mt-3 flex items-center justify-end gap-2 ${className}`}>{children}</div>;
}

type Weight = 'primary' | 'secondary' | 'quiet' | 'danger';

const WEIGHT: Record<Weight, string> = {
  primary: 'bg-[var(--text)] text-[var(--panel)] hover:opacity-90',
  secondary: 'text-[var(--text)] ring-1 ring-inset ring-[var(--border-strong)] hover:bg-[var(--bg-hover)]',
  quiet: 'text-[var(--text-muted)] hover:text-[var(--text)]',
  danger: 'bg-[var(--err)] text-white hover:brightness-110',
};

export const CardButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { weight?: Weight }
>(function CardButton({ weight = 'secondary', className = '', type = 'button', ...props }, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={`inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-[12px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--text)]/30 disabled:pointer-events-none disabled:opacity-50 ${WEIGHT[weight]} ${className}`}
    />
  );
});

/**
 * One choice per row: a key cap (1, 2, 3…), the name, a line of description below; a tick on the selected row.
 * Without `onPick` the row can't be clicked (an answered question stays visible but can't be changed).
 */
export function ChoiceRow({
  index,
  label,
  description,
  selected = false,
  onPick,
}: {
  index?: number;
  label: React.ReactNode;
  description?: React.ReactNode;
  selected?: boolean;
  onPick?: () => void;
}) {
  const body = (
    <>
      {index != null ? (
        <span className="mt-[1px] flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[5px] border border-[var(--border)] px-1 text-[10.5px] tabular-nums text-[var(--text-faint)]">
          {index}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] leading-snug text-[var(--text)]">{label}</span>
        {description ? <span className="mt-0.5 text-[11.5px] leading-snug text-[var(--text-faint)]">{description}</span> : null}
      </span>
      {selected ? <span aria-hidden className="mt-[1px] shrink-0 text-[12px] text-[var(--text)]">✓</span> : null}
    </>
  );
  const shell = 'flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left';
  if (!onPick) return <div className={`${shell} ${selected ? 'bg-[var(--bg-hover)]' : 'opacity-70'}`}>{body}</div>;
  return (
    <button type="button" onClick={onPick} className={`${shell} outline-none transition hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)]`}>
      {body}
    </button>
  );
}

/** While a card is open and focus is not in a text field, 1–9 picks that choice. */
export function useNumberKeys(count: number, onPick: ((index: number) => void) | null): void {
  React.useEffect(() => {
    if (!onPick || count <= 0) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      /* a number typed in Studio (a field there, a shortcut) is not an answer to the agent's question */
      if (!inChat(target) && target !== document.body) return;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const n = Number(event.key);
      if (!Number.isInteger(n) || n < 1 || n > count) return;
      event.preventDefault();
      onPick(n - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, onPick]);
}
