/**
 * What the desktop app adds, opened from the top bar's Desktop button (never on its own). Two halves: on the left a
 * picture of its window (Studio with the person's agent beside the film) over the agents it works with; on the right
 * what it does, in eight points, and the download for this computer's system and chip (lib/desktop-build), beside
 * the version. "Download"
 * has Studio open the installer in the person's browser (the website when this build names no place for
 * installers); Studio sends nothing else.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeftRight, Bot, FileDown, Gauge, History, MonitorPlay, PackageCheck, RefreshCw, X } from 'lucide-react';
import { useT } from '@/i18n';
import { desktopBuild, desktopSystem } from '@/lib/desktop-build';
import { BrandLogo } from './BrandLogo';
import { ProviderMark } from './settings/ProviderMark';
import { Tooltip } from './Tooltip';

/* what the app does: the chat and the editor together, the agents, the engine, no setup, and staying current */
const FEATURES: { key: string; icon: React.ReactNode }[] = [
  { key: 'sync', icon: <ArrowLeftRight size={15} strokeWidth={1.75} /> },
  { key: 'live', icon: <MonitorPlay size={15} strokeWidth={1.75} /> },
  { key: 'drop', icon: <FileDown size={15} strokeWidth={1.75} /> },
  { key: 'agents', icon: <Bot size={15} strokeWidth={1.75} /> },
  { key: 'speed', icon: <Gauge size={15} strokeWidth={1.75} /> },
  { key: 'setup', icon: <PackageCheck size={15} strokeWidth={1.75} /> },
  { key: 'updates', icon: <RefreshCw size={15} strokeWidth={1.75} /> },
  { key: 'history', icon: <History size={15} strokeWidth={1.75} /> },
];

/** The agents it finds on the computer, by their marks (Codex's is OpenAI's). */
const AGENTS: { id: string; name: string }[] = [
  { id: 'claude', name: 'Claude Code' },
  { id: 'openai', name: 'Codex' },
  { id: 'copilot', name: 'GitHub Copilot' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'qwen', name: 'Qwen Code' },
  { id: 'kimi', name: 'Kimi' },
  { id: 'minimax', name: 'MiniMax Code' },
  { id: 'deepseek', name: 'DeepSeek Harness' },
];

const SYSTEM_NAMES = { mac: 'macOS', win: 'Windows' } as const;

/**
 * The picture half is dark in either theme (a window on a stage): Studio's dark colors, set on it alone, so the drawn
 * window and the agents' marks read the same in a light Studio.
 */
const DARK: React.CSSProperties = {
  '--text': '#ebebed',
  '--text-muted': '#a4a4a9',
  '--text-faint': '#717177',
  '--bg-raised': '#242427',
  '--bg-field': 'rgba(240, 240, 255, 0.06)',
  '--border': 'rgba(240, 240, 255, 0.075)',
  '--bg-app': '#111114',
  '--primary': '#ebebed',
  '--primary-hover': '#ffffff',
  '--on-primary': '#0a0a0c',
  '--accent': '#45cfb5',
  '--on-accent': '#04221d',
  '--tl-playhead': '#ffffff',
  '--clip-audio': '#1c5757',
  background: [
    'radial-gradient(90% 70% at 0% 0%, color-mix(in srgb, #5ecb92 34%, transparent), transparent 70%)',
    'radial-gradient(80% 60% at 100% 100%, color-mix(in srgb, #7fd3e4 26%, transparent), transparent 70%)',
    '#0d1110',
  ].join(', '),
} as React.CSSProperties;

const APPLE = 'M16.37 12.6c-.02-2.3 1.88-3.4 1.97-3.46-1.07-1.57-2.74-1.79-3.33-1.81-1.42-.14-2.77.84-3.49.84-.72 0-1.83-.82-3.01-.8-1.55.02-2.98.9-3.78 2.29-1.61 2.8-.41 6.94 1.16 9.2.77 1.11 1.68 2.36 2.88 2.31 1.16-.05 1.59-.75 2.99-.75 1.39 0 1.79.75 3.01.72 1.24-.02 2.03-1.13 2.79-2.25.88-1.29 1.24-2.54 1.26-2.6-.03-.01-2.42-.93-2.45-3.69ZM14.07 5.85c.64-.77 1.07-1.85.95-2.92-.92.04-2.03.61-2.69 1.38-.59.68-1.11 1.78-.97 2.83 1.02.08 2.07-.52 2.71-1.29Z';
const WINDOWS = 'M3 5.1 10.4 4v7.1H3V5.1Zm8.4-1.2L21 2.5v8.6h-9.6V3.9ZM3 12.9h7.4V20L3 18.9v-6Zm8.4 0H21v8.6l-9.6-1.4v-7.2Z';

export function DesktopDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const dialog = React.useRef<HTMLDivElement>(null);
  const download = React.useRef<HTMLButtonElement>(null);
  /* the latest onClose, so a parent's re-render does not move focus back to the first button */
  const close = React.useRef(onClose);
  close.current = onClose;
  const system = desktopSystem();
  /* the version: Studio's, which the app shares (one version for all of OpenFilm) */
  const [version, setVersion] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open || version) return;
    void fetch('/api/health', { cache: 'no-store' }).then((r) => r.json())
      .then((h: { version?: unknown }) => { if (typeof h?.version === 'string') setVersion(h.version); })
      .catch(() => { /* no version shown */ });
  }, [open, version]);

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

  const openDownload = async () => {
    const build = await desktopBuild();
    void fetch('/api/desktop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(build ?? {}) })
      .catch(() => { /* Studio is gone: nothing to open */ });
    onClose();
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[3px]"
      style={{ animation: 'openfilm-rise 0.18s ease-out both' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-title"
        className="relative grid max-h-[calc(100vh-32px)] w-full max-w-[1040px] overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--bg-raised)] shadow-[0_32px_80px_-24px_rgba(0,0,0,0.6)] md:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('desktop.close')}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          <X size={16} />
        </button>

        {/* the picture: the window, then the agents it works with */}
        <div className="flex min-w-0 flex-col gap-6 p-6 md:p-7" style={DARK}>
          <div className="flex flex-1 items-center">
            <AppPicture />
          </div>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-faint)]">{t('desktop.worksWith')}</div>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {AGENTS.map(({ id, name }) => (
                <Tooltip key={id} label={name}>
                  <span aria-label={name} className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-white/10 bg-white/[0.06] transition hover:border-white/25 hover:bg-white/[0.12]">
                    <ProviderMark id={id} size={15} />
                  </span>
                </Tooltip>
              ))}
            </div>
            <div className="mt-2.5 text-[12px] text-[var(--text-muted)]">{t('desktop.orOwnKey')}</div>
          </div>
        </div>

        {/* what it does, and the download */}
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-5 pt-7 md:px-8">
            <div className="flex items-center gap-2 text-[var(--text-muted)]">
              <BrandLogo size={14} />
              <span className="text-[11.5px] font-medium uppercase tracking-[0.1em]">{t('desktop.title')}</span>
            </div>
            <h2 id="desktop-title" className="mt-3 pr-8 text-[24px] font-semibold leading-[1.2] tracking-[-0.015em] text-[var(--text)]">
              {t('desktop.tagline')}
            </h2>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-[var(--text-muted)]">{t('desktop.intro')}</p>

            <ul className="mt-6 grid gap-x-6 gap-y-5 sm:grid-cols-2">
              {FEATURES.map(({ key, icon }) => (
                <li key={key} className="min-w-0">
                  <span className="flex items-center gap-2.5">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]"
                      style={{ background: 'color-mix(in srgb, var(--brand-wind-mid) 14%, transparent)', color: 'var(--brand-wind-from)' }}
                    >
                      {icon}
                    </span>
                    <span className="min-w-0 text-[13.5px] font-medium leading-snug text-[var(--text)]">{t(`desktop.features.${key}.title`)}</span>
                  </span>
                  <span className="mt-1.5 block text-[12.5px] leading-relaxed text-[var(--text-muted)]">{t(`desktop.features.${key}.body`)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-[var(--border)] px-7 py-4 md:px-8">
            <span className="text-[12px] text-[var(--text-faint)]">
              {[t('desktop.status'), t('desktop.otherSystems'), version ? `v${version}` : null].filter(Boolean).join(' · ')}
            </span>
            <button
              ref={download}
              type="button"
              onClick={() => void openDownload()}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--primary)] px-5 text-[13.5px] font-medium text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)]"
            >
              {system ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d={system === 'mac' ? APPLE : WINDOWS} /></svg>
              ) : null}
              {system ? t('desktop.downloadFor').replaceAll('{system}', SYSTEM_NAMES[system]) : t('desktop.getIt')}
            </button>
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
    <div aria-hidden className="w-full overflow-hidden rounded-[12px] border border-white/10 bg-[var(--bg-app)] shadow-[0_24px_48px_-20px_rgba(0,0,0,0.7)]">
      {/* the window's top bar */}
      <div className="flex h-[22px] items-center gap-[5px] border-b border-[var(--border)] px-2.5">
        <span className="h-[7px] w-[7px] rounded-full bg-[#ff5f57]" />
        <span className="h-[7px] w-[7px] rounded-full bg-[#febc2e]" />
        <span className="h-[7px] w-[7px] rounded-full bg-[#28c840]" />
      </div>
      <div className="grid grid-cols-[1fr_40%] gap-[5px] p-[5px]">
        {/* Studio: the picture, then the timeline */}
        <div className="flex min-w-0 flex-col gap-[5px]">
          <div className="flex aspect-[16/10] items-center justify-center rounded-[6px] bg-[var(--bg-raised)]">
            <div
              className="flex aspect-video w-[78%] flex-col justify-end rounded-[4px] p-[8%]"
              style={{ background: 'linear-gradient(135deg, #5ecb92, #7fd3e4)' }}
            >
              <span className="openfilm-desktop-pulse h-[7px] w-[58%] rounded-full bg-white/90" />
              <span className="mt-[4px] h-[4px] w-[36%] rounded-full bg-white/60" />
            </div>
          </div>
          <div className="relative rounded-[6px] bg-[var(--bg-raised)] px-[6px] py-[7px]">
            <div className="flex flex-col gap-[4px]">
              <div className="flex gap-[3px]">
                <span className="h-[10px] w-[30%] rounded-[2px] bg-white/[0.13]" />
                <span className="openfilm-desktop-pulse h-[10px] w-[28%] rounded-[2px] outline outline-[1.5px] outline-offset-[1px]" style={{ background: 'color-mix(in srgb, var(--accent) 45%, transparent)', outlineColor: 'var(--accent)' }} />
                <span className="h-[10px] w-[34%] rounded-[2px] bg-white/[0.13]" />
              </div>
              <div className="flex gap-[3px] pl-[18%]">
                <span className="h-[10px] w-[48%] rounded-[2px] bg-[color-mix(in_srgb,#66d8b8_40%,transparent)]" />
              </div>
              <span className="h-[8px] w-[92%] rounded-[2px] bg-[color-mix(in_srgb,var(--clip-audio)_90%,transparent)]" />
            </div>
            <span className="openfilm-desktop-playhead absolute bottom-[4px] top-[3px] w-[1.5px] rounded-full bg-[var(--tl-playhead)]" />
          </div>
        </div>
        {/* the chat beside it */}
        <div className="flex min-w-0 flex-col gap-[6px] rounded-[6px] bg-[var(--bg-raised)] p-[6px]">
          <div className="ml-auto max-w-[96%] rounded-[6px] bg-[var(--bg-field)] px-[6px] py-[5px]">
            <span
              className="openfilm-desktop-pulse mb-[4px] inline-flex max-w-full items-center truncate rounded-[3px] px-[4px] py-[1px] text-[7.5px] font-medium leading-tight"
              style={{ background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)', boxShadow: 'inset 0 0 0 1px var(--accent)' }}
            >
              {t('desktop.picture.clip')}
            </span>
            <span className="block text-[8px] leading-snug text-[var(--text)]">{t('desktop.picture.ask')}</span>
          </div>
          <div className="max-w-[96%] text-[8px] leading-snug text-[var(--text-muted)]">{t('desktop.picture.reply')}</div>
          <div className="mt-auto h-[18px] rounded-[5px] border border-[var(--border)] bg-[var(--bg-field)]" />
        </div>
      </div>
    </div>
  );
}
