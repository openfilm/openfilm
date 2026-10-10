/**
 * What the desktop app adds, opened from the top bar's Desktop button (never on its own): a picture of its window
 * (Studio with the person's agent beside the film), what it does, and a download for this computer's system.
 * "Download" opens the website in the person's browser, where the download is; Studio sends nothing itself.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { FileDown, MessagesSquare, MousePointerClick, Sparkles, X } from 'lucide-react';
import { useT } from '@/i18n';

const FEATURES: { key: string; icon: React.ReactNode }[] = [
  { key: 'chat', icon: <MessagesSquare size={16} strokeWidth={1.75} /> },
  { key: 'point', icon: <MousePointerClick size={16} strokeWidth={1.75} /> },
  { key: 'drop', icon: <FileDown size={16} strokeWidth={1.75} /> },
  { key: 'launch', icon: <Sparkles size={16} strokeWidth={1.75} /> },
];

/** The system this page runs on, for the download button's words (the website picks the file). */
function systemName(): 'macOS' | 'Windows' | null {
  if (typeof navigator === 'undefined') return null;
  if (/Mac/.test(navigator.platform)) return 'macOS';
  if (/Win/.test(navigator.platform)) return 'Windows';
  return null;
}

export function DesktopDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const dialog = React.useRef<HTMLDivElement>(null);
  const download = React.useRef<HTMLButtonElement>(null);
  /* the latest onClose, so a parent's re-render does not move focus back to the first button */
  const close = React.useRef(onClose);
  close.current = onClose;
  const system = systemName();

  React.useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    download.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab' || !dialog.current) return;
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.current.contains(document.activeElement)) { e.preventDefault(); first?.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  const openDownload = () => {
    void fetch('/api/account/desktop', { method: 'POST' }).catch(() => { /* Studio is gone: nothing to open */ });
    onClose();
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[3px]"
      style={{ animation: 'openfilm-rise 0.18s ease-out both' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-title"
        className="relative flex max-h-[calc(100vh-32px)] w-full max-w-[720px] flex-col overflow-hidden rounded-[16px] border border-[var(--card-border)] bg-[var(--card-bg)] shadow-[0_24px_64px_-24px_rgba(0,0,0,0.55)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('desktop.close')}
          className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          <X size={15} />
        </button>

        <AppPicture />

        <div className="overflow-y-auto px-7 pb-6 pt-5">
          <div className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-[var(--text-faint)]">{t('desktop.title')}</div>
          <h2 id="desktop-title" className="mt-1.5 text-[22px] font-semibold leading-tight tracking-[-0.01em] text-[var(--text)]">
            {t('desktop.tagline')}
          </h2>
          <p className="mt-2 max-w-[560px] text-[13px] leading-relaxed text-[var(--text-muted)]">{t('desktop.intro')}</p>

          <ul className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {FEATURES.map(({ key, icon }) => (
              <li key={key} className="flex items-start gap-3">
                <span className="mt-px flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-dim)]">
                  {icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-[var(--text)]">{t(`desktop.features.${key}.title`)}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-relaxed text-[var(--text-muted)]">{t(`desktop.features.${key}.body`)}</span>
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
            <span className="text-[12px] text-[var(--text-muted)]">{t('desktop.status')}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-full px-4 text-[13px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
              >
                {t('desktop.close')}
              </button>
              <button
                ref={download}
                type="button"
                onClick={openDownload}
                className="h-9 rounded-full bg-[var(--text)] px-5 text-[13px] font-medium text-[var(--card-bg)] transition hover:opacity-90"
              >
                {system ? t('desktop.downloadFor').replaceAll('{system}', system) : t('desktop.download')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The app's window, drawn: Studio's picture and timeline on the left, the chat on the right, and the clip selected on
 * the timeline sitting in the person's message, in the same color and glowing together. Decoration only (hidden
 * from screen readers).
 */
function AppPicture() {
  const t = useT();
  return (
    <div
      aria-hidden
      className="relative h-[232px] shrink-0 overflow-hidden border-b border-[var(--card-border)]"
      style={{ background: 'radial-gradient(120% 140% at 15% 0%, color-mix(in srgb, var(--brand-wind-mid) 26%, transparent), transparent 60%), radial-gradient(90% 120% at 100% 100%, color-mix(in srgb, var(--brand-wind-to) 22%, transparent), transparent 55%), var(--surface-2)' }}
    >
      <div className="absolute inset-x-10 top-7 bottom-[-18px] overflow-hidden rounded-t-[10px] border border-[var(--border)] bg-[var(--dock-shell)] shadow-[0_18px_40px_-18px_rgba(0,0,0,0.5)]">
        {/* the window's top bar */}
        <div className="flex h-[18px] items-center gap-1 border-b border-[var(--border)] px-2">
          <span className="h-[6px] w-[6px] rounded-full bg-[#ff5f57]" />
          <span className="h-[6px] w-[6px] rounded-full bg-[#febc2e]" />
          <span className="h-[6px] w-[6px] rounded-full bg-[#28c840]" />
        </div>
        <div className="grid h-full grid-cols-[1fr_34%] gap-[5px] p-[5px]">
          {/* Studio: the picture, then the timeline */}
          <div className="flex min-w-0 flex-col gap-[5px]">
            <div className="flex h-[96px] items-center justify-center rounded-[5px] bg-[var(--surface)]">
              <div
                className="flex h-[78px] w-[138px] flex-col justify-end rounded-[3px] p-2"
                style={{ background: 'linear-gradient(135deg, var(--brand-wind-from), var(--brand-wind-to))' }}
              >
                <span className="h-[7px] w-[64px] rounded-full bg-white/90" />
                <span className="mt-1 h-[4px] w-[40px] rounded-full bg-white/60" />
              </div>
            </div>
            <div className="relative flex-1 rounded-[5px] bg-[var(--surface)] px-[6px] py-[6px]">
              <div className="flex flex-col gap-[4px]">
                <div className="flex gap-[3px]">
                  <span className="h-[11px] w-[30%] rounded-[2px] bg-[color-mix(in_srgb,var(--text)_14%,transparent)]" />
                  <span className="openfilm-desktop-pulse h-[11px] w-[26%] rounded-[2px] outline outline-[1.5px] outline-offset-[1px]" style={{ background: 'color-mix(in srgb, var(--tl-accent) 45%, transparent)', outlineColor: 'var(--tl-accent)' }} />
                  <span className="h-[11px] w-[34%] rounded-[2px] bg-[color-mix(in_srgb,var(--text)_14%,transparent)]" />
                </div>
                <div className="flex gap-[3px] pl-[18%]">
                  <span className="h-[11px] w-[48%] rounded-[2px] bg-[color-mix(in_srgb,var(--brand-wind-mid)_40%,transparent)]" />
                </div>
                <span className="h-[9px] w-[92%] rounded-[2px] bg-[color-mix(in_srgb,var(--tl-wave)_55%,transparent)]" />
              </div>
              <span className="openfilm-desktop-playhead absolute bottom-[4px] top-[2px] w-[1.5px] rounded-full bg-[var(--tl-playhead)]" />
            </div>
          </div>
          {/* the chat beside it */}
          <div className="flex min-w-0 flex-col gap-[5px] rounded-[5px] bg-[var(--surface)] p-[6px]">
            <div className="ml-auto max-w-[92%] rounded-[6px] bg-[var(--surface-2)] px-[6px] py-[5px]">
              <span
                className="openfilm-desktop-pulse mb-[4px] inline-flex items-center gap-[3px] rounded-[3px] px-[4px] py-[1px] text-[7.5px] font-medium leading-tight"
                style={{ background: 'color-mix(in srgb, var(--tl-accent) 18%, transparent)', color: 'var(--tl-accent)', boxShadow: 'inset 0 0 0 1px var(--tl-accent)' }}
              >
                {t('desktop.picture.clip')}
              </span>
              <span className="block text-[8px] leading-snug text-[var(--text)]">{t('desktop.picture.ask')}</span>
            </div>
            <div className="max-w-[92%] text-[8px] leading-snug text-[var(--text-muted)]">{t('desktop.picture.reply')}</div>
            <div className="flex flex-col gap-[3px]">
              <span className="h-[4px] w-[86%] rounded-full bg-[color-mix(in_srgb,var(--text)_12%,transparent)]" />
              <span className="h-[4px] w-[64%] rounded-full bg-[color-mix(in_srgb,var(--text)_12%,transparent)]" />
            </div>
            <div className="mt-auto h-[16px] rounded-[5px] border border-[var(--border)] bg-[var(--surface-2)]" />
          </div>
        </div>
      </div>
    </div>
  );
}
