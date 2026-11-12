/**
 * The parts every section of Settings is made of, as a computer's system settings draws them: a page is a column of
 * cards, each a group of rows parted by hairlines (its title above it, a footnote under it), each row its title and
 * what it does on the left, its control on the right. A row that leads to a page of its own ends in a chevron
 * (SettingsNavRow); a section that is such a list of pages opens on a card that says what it is (SettingsHero).
 * Controls are quiet until pointed at: a choice of two or three is a segmented control, on/off a switch, a longer
 * list a select.
 */
import React from 'react';
import { ChevronRight } from 'lucide-react';

/** A section's body: an optional note, then its groups. */
export function SettingsPage({ note, children }: { note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      {note ? <p className="mb-8 text-[14.5px] leading-relaxed text-[var(--text-muted)]">{note}</p> : null}
      {children}
    </div>
  );
}

/** A card of rows, its title above it; `footnote` goes under it. */
export function SettingsGroup({ title, footnote, children }: { title?: React.ReactNode; footnote?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-6 last:mb-0">
      {title ? <h3 className="mb-2 px-1 text-[13.5px] font-semibold text-[var(--text)]">{title}</h3> : null}
      <div className="flex flex-col divide-y divide-[var(--border)] rounded-[12px] bg-[var(--settings-card)] px-4">{children}</div>
      {footnote ? <p className="px-1 pt-2 text-[13px] leading-relaxed text-[var(--text-faint)]">{footnote}</p> : null}
    </section>
  );
}

/** A section's or a page's mark: its glyph, white, on a rounded square of its color. */
export function SettingsTile({ color, size = 28, children }: { color: string; size?: number; children: React.ReactNode }) {
  return (
    <span aria-hidden className="grid shrink-0 place-items-center text-white shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.16)]"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.24), background: color }}>
      {children}
    </span>
  );
}

/** What a section is, on the card it opens on: its mark, large, its name and a line about it. */
export function SettingsHero({ tile, title, description }: { tile: React.ReactNode; title: React.ReactNode; description?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col items-center rounded-[12px] bg-[var(--settings-card)] px-8 pb-7 pt-8 text-center">
      {tile}
      <h2 className="mt-4 text-[22px] font-semibold tracking-[-0.015em] text-[var(--text)]">{title}</h2>
      {description ? <p className="mt-1.5 max-w-[560px] text-[14px] leading-relaxed text-[var(--text-muted)]">{description}</p> : null}
    </div>
  );
}

/** A row that opens a page of its own: its mark, its name, what is set there (or how much), a chevron. */
export function SettingsNavRow({ tile, title, value, onClick }: { tile?: React.ReactNode; title: React.ReactNode; value?: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="-mx-4 flex min-h-[52px] items-center gap-3 px-4 py-2.5 text-left transition first:rounded-t-[12px] last:rounded-b-[12px] hover:bg-[var(--bg-hover)]">
      {tile}
      <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--text)]">{title}</span>
      {value != null ? <span className="shrink-0 text-[14px] tabular-nums text-[var(--text-muted)]">{value}</span> : null}
      <ChevronRight size={16} strokeWidth={2} className="shrink-0 text-[var(--text-faint)]" aria-hidden />
    </button>
  );
}

/** One row: a mark, a title (with a badge beside it), what it does, its control; `children` open under it. */
export function SettingsItem({ mark, title, badge, description, control, children }: {
  mark?: React.ReactNode;
  title: React.ReactNode;
  badge?: React.ReactNode;
  description?: React.ReactNode;
  control?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="py-3">
      <div className="flex min-h-10 items-center gap-4">
        {mark ? <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--bg-field)] text-[var(--text)]">{mark}</span> : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[15px] text-[var(--text)]">{title}</span>
            {badge}
          </div>
          {description ? <div className="mt-1 text-[14px] leading-[1.55] text-[var(--text-muted)]">{description}</div> : null}
        </div>
        {control ? <div className="flex shrink-0 items-center gap-2">{control}</div> : null}
      </div>
      {children ? <div className="pt-3">{children}</div> : null}
    </div>
  );
}

/** "Connected", with a green dot and whatever tells which connection it is. */
export function SettingsStatus({ tone = 'ok', children }: { tone?: 'ok' | 'muted'; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13.5px] text-[var(--text-muted)]">
      <span className={`h-1.5 w-1.5 rounded-full ${tone === 'ok' ? 'bg-[var(--ok)]' : 'bg-[var(--text-faint)]'}`} aria-hidden />
      {children}
    </span>
  );
}

const BUTTON = {
  default: 'border border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-hover)]',
  primary: 'border border-transparent bg-[var(--primary)] text-[var(--on-primary)] hover:bg-[var(--primary-hover)]',
  quiet: 'border border-transparent text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]',
};

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON };

export function SettingsButton({ variant = 'default', className = '', ...props }: ButtonProps) {
  return (
    <button type="button" {...props}
      className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[8px] px-3.5 text-[14px] font-medium transition disabled:pointer-events-none disabled:opacity-50 ${BUTTON[variant]} ${className}`} />
  );
}

/** A link that looks like a button (an install page, a key page). */
export function SettingsLinkButton({ className = '', ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a target="_blank" rel="noreferrer" {...props}
      className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[8px] px-3.5 text-[14px] font-medium transition ${BUTTON.default} ${className}`} />
  );
}

/** On or off. */
export function SettingsSwitch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} title={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-[var(--switch-on)]' : 'bg-[var(--bg-pressed)]'}`}>
      <span className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-all ${checked ? 'left-[19px]' : 'left-[3px]'}`} />
    </button>
  );
}

/** One of two or three, all in view: the chosen one raised out of a quiet track. */
export function SettingsSegmented<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; icon?: React.ReactNode }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 gap-0.5 rounded-[10px] bg-[var(--bg-field)] p-[3px]">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button key={option.value} type="button" role="radio" aria-checked={on} onClick={() => { if (!on) onChange(option.value); }}
            className={`inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-[7px] px-3 text-[14px] transition ${
              on ? 'bg-[var(--bg-panel)] text-[var(--text)] shadow-[0_1px_2px_rgba(0,0,0,0.08)] ring-1 ring-[var(--border)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}>
            {option.icon ? <span className="flex shrink-0">{option.icon}</span> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** A text field. */
export const SettingsField = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function SettingsField({ className = '', ...props }, ref) {
  return (
    <input ref={ref} {...props}
      className={`h-10 w-full min-w-0 rounded-[8px] border border-[var(--border)] bg-transparent px-3 text-[14px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] hover:border-[var(--border-strong)] focus:border-[var(--text-muted)] ${className}`} />
  );
});

/** A form that opened under a row. */
export function SettingsInset({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2.5 rounded-[10px] border border-[var(--border)] p-4">{children}</div>;
}

export const settingsLink = 'inline-flex items-center gap-1 text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text)] hover:underline';
export const settingsError = 'text-[13.5px] leading-relaxed text-[var(--err)]';
