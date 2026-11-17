/**
 * A large window with a side: Settings, Features. One frame, so every such window reads the same: its size
 * (dialog-chrome), the side on the left (264 px, the side's color: the panels' in the dark, rgb 24) with its search
 * and its places, the page on the right (the raised color, rgb 32) with Close in its corner. It is put on the
 * document's body, over the app's chat as well as Studio. Esc pressed in it is its own, before Studio's keys under it
 * (a menu open in it, a card over it or a field takes it first): `onEscape` (a page going back), else it closes; Tab
 * stays in it.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { LARGE_DIALOG, LARGE_DIALOG_SIDE } from './dialog-chrome';

/* The large windows open, the top one last, each with what its Esc does. */
const opened: Array<{ element: () => HTMLElement | null; escape: () => void }> = [];
/* Esc pressed in the top window is its own, before Studio's keys for what is under it (keyframes or a mask picked
   in the editor take Esc on the window as it is pressed): so this listens from the start, ahead of them. Left to the
   window's own way (below) when a menu is open, another dialog is over it, or a field has the key. */
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    const top = opened[opened.length - 1];
    if (e.key !== 'Escape' || !top) return;
    const el = e.target as HTMLElement | null;
    const element = top.element();
    if (!element || !el || !element.contains(el)) return;
    if (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    if (document.querySelector('[data-popover-panel]') || document.querySelectorAll('[aria-modal="true"]').length > 1) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    top.escape();
  }, true);
}

export function LargeDialog({ label, labelledBy, onClose, onEscape, side, children, closeLabel, focusFirst }: {
  /** what the window is called, when no heading in it names it (`labelledBy`) */
  label?: string;
  labelledBy?: string;
  onClose: () => void;
  /** Esc: true when it was taken (a page went back), else the window closes */
  onEscape?: () => boolean;
  /** its side (none: the page takes the whole window, its own way between places at its top) */
  side?: React.ReactNode;
  children: React.ReactNode;
  closeLabel: string;
  /** what takes the keys as it opens (its search) */
  focusFirst?: React.RefObject<HTMLElement | null>;
}) {
  const dialog = React.useRef<HTMLDivElement>(null);
  const latest = React.useRef({ onClose, onEscape });
  latest.current = { onClose, onEscape };
  const escape = (e: KeyboardEvent | React.KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    if (!latest.current.onEscape?.()) latest.current.onClose();
  };
  React.useEffect(() => {
    const entry = { element: () => dialog.current, escape: () => { if (!latest.current.onEscape?.()) latest.current.onClose(); } };
    opened.push(entry);
    const previousFocus = document.activeElement as HTMLElement | null;
    /* the keys while nothing in the window has them (Esc), and Tab kept in it */
    const onKey = (e: KeyboardEvent) => {
      if (dialog.current?.contains(document.activeElement)) {
        if (e.key !== 'Tab') return;
        const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]'))
          .filter((element) => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        return;
      }
      escape(e);
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const r = requestAnimationFrame(() => (focusFirst?.current ?? dialog.current)?.focus());
    return () => {
      opened.splice(opened.indexOf(entry), 1);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      cancelAnimationFrame(r);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[10050] grid place-items-center bg-black/50 p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {/* Esc pressed in the window is its own, before Studio's keys under it (a picked clip let go, a toast) */}
      <div ref={dialog} role="dialog" aria-modal="true" tabIndex={-1} {...(labelledBy ? { 'aria-labelledby': labelledBy } : { 'aria-label': label })}
        onKeyDown={escape} className={`${LARGE_DIALOG} outline-none`}>
        {side ? <nav aria-label={label} className={`${LARGE_DIALOG_SIDE} overflow-y-auto px-3 pb-4 pt-3`}>{side}</nav> : null}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <button type="button" onClick={onClose} aria-label={closeLabel}
            className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-[8px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
            <X size={19} strokeWidth={1.75} />
          </button>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The side's search, at its top. */
export const LargeDialogSearch = React.forwardRef<HTMLInputElement, { value: string; onChange: (value: string) => void; placeholder: string }>(
  function LargeDialogSearch({ value, onChange, placeholder }, ref) {
    return (
      <label className="mb-3 flex h-10 shrink-0 items-center gap-2.5 rounded-[9px] border border-[var(--border)] px-3 text-[var(--text-muted)] transition focus-within:border-[var(--text-muted)]">
        <Search size={17} strokeWidth={1.75} className="shrink-0" aria-hidden />
        <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]" />
      </label>
    );
  },
);

/** A group of the side's places, under a quiet name (none: no name). */
export function LargeDialogGroup({ title, children }: { title?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-3 flex flex-col gap-0.5">
      {title ? <div className="flex items-center px-2.5 pb-1.5 text-[13px] text-[var(--text-faint)]">{title}</div> : null}
      {children}
    </div>
  );
}

/** One of the side's places: its icon and its name; the one shown pressed; `inset`: one of the place above it. */
export function LargeDialogPlace({ icon, active, onClick, children, end, inset }: {
  icon: React.ReactNode; active: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode; end?: React.ReactNode; inset?: boolean;
}) {
  return (
    <button type="button" aria-current={active ? 'page' : undefined} onClick={onClick}
      className={`flex min-w-0 items-center gap-3 rounded-[8px] pr-2.5 text-left transition ${inset ? 'h-9 pl-9 text-[14.5px]' : 'h-10 pl-2.5 text-[15px]'} ${
        active ? 'bg-[var(--bg-pressed)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'
      }`}>
      <span className={`shrink-0 ${active ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {end}
    </button>
  );
}

/** The page's column: in the middle of the room the window gives, its title over it. */
export function LargeDialogPage({ title, titleId, children, pageKey }: { title?: React.ReactNode; titleId?: string; children: React.ReactNode; pageKey?: string }) {
  return (
    <div key={pageKey} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-10 pb-12 pt-9">
      <div className="mx-auto w-full max-w-[920px]">
        {title ? <h2 id={titleId} className="mb-7 text-[22px] font-semibold tracking-[-0.015em] text-[var(--text)]">{title}</h2> : null}
        {children}
      </div>
    </div>
  );
}
