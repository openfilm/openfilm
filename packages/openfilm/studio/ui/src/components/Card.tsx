/**
 * The one card shell (confirmations, notices) and its buttons: background and border follow the theme, radius 12,
 * one button height (28) in three weights — primary (filled), secondary (outlined), quiet (text only) — plus danger.
 */
import React from 'react';
import { X } from 'lucide-react';
import { useT } from '@/i18n';

/** The shell of things that float up (menus, dropdowns): the card's shadow on the floating surface. */
export const POPOVER_CHROME: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-strong)',
  borderRadius: 12,
  boxShadow: '0 16px 40px -8px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.18)',
};

export function Card({
  icon,
  title,
  body,
  onClose,
  children,
  role,
  className = '',
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  body?: React.ReactNode;
  onClose?: () => void;
  children?: React.ReactNode;
  role?: React.AriaRole;
  className?: string;
}) {
  const t = useT();
  return (
    <div
      {...(role ? { role } : {})}
      className={`relative rounded-[12px] border border-[var(--card-border)] bg-[var(--card-bg)] px-3.5 pb-3 pt-3 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.35)] ${className}`}
    >
      {onClose ? (
        <div className="absolute right-2 top-2 flex items-center gap-0.5">
          <button
            type="button"
            onClick={onClose}
            aria-label={t('project.close')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
      ) : null}
      <div className={`flex items-start gap-2 ${onClose ? 'pr-7' : ''}`}>
        {icon ? <span className="mt-[2px] shrink-0 text-[var(--text-muted)]">{icon}</span> : null}
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-medium leading-snug text-[var(--text)]">{title}</h3>
          {body ? <div className="mt-1 text-[12.5px] leading-relaxed text-[var(--text-muted)]">{body}</div> : null}
        </div>
      </div>
      {children}
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
