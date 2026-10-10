/**
 * Settings, opened from the logo at the top left: a search and the sections in groups on the left, the section on the
 * right as a page of titled groups. General (the theme and the language), Agents (in an app with a chat: the agents
 * it can use), Providers (the person's own keys for media services), Models (which provider and model makes each kind
 * of media) and the keyboard shortcuts; the search finds a section by any phrase on it.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { X, Settings2, Keyboard, Sun, Moon, Monitor, Plug, Boxes, Bot, Search, SquareTerminal } from 'lucide-react';
import { LANGUAGES, phrasesUnder, useLanguage, useLanguageChoice, useT, type LanguageChoice } from '@/i18n';
import { shortcutHint } from '@/lib/shortcut-hint';
import { SHORTCUTS, type ShortcutKey } from '@/lib/timeline-keys';
import { studioHost } from '@/lib/host';
import { api, type StudioVersion } from '@/api';
import { AgentsSection } from './AgentsSection';
import { ModelsSection } from './ModelsSection';
import { ProvidersSection } from './ProvidersSection';
import { SettingsSelect } from './SettingsSelect';
import { SettingsButton, SettingsGroup, SettingsItem, SettingsPage, SettingsSegmented, SettingsSwitch } from './ui';
import { useThemeMode, type ThemeMode } from './theme';

export type SettingsSection = 'general' | 'agents' | 'providers' | 'models' | 'developer' | 'shortcuts';

/* the nav, in groups: what OpenFilm does (Agents and Developer only inside an app with a chat: lib/host.ts `agents`,
   `developer`), then help */
const NAV: Array<{ group: 'settings' | 'help'; sections: SettingsSection[] }> = [
  { group: 'settings', sections: ['general', ...(studioHost?.agents ? ['agents' as const] : []), 'providers', 'models', ...(studioHost?.developer ? ['developer' as const] : [])] },
  { group: 'help', sections: ['shortcuts'] },
];

const SECTION_ICON: Record<SettingsSection, React.ReactNode> = {
  general: <Settings2 size={18} strokeWidth={1.75} />,
  agents: <Bot size={18} strokeWidth={1.75} />,
  providers: <Plug size={18} strokeWidth={1.75} />,
  models: <Boxes size={18} strokeWidth={1.75} />,
  developer: <SquareTerminal size={18} strokeWidth={1.75} />,
  shortcuts: <Keyboard size={18} strokeWidth={1.75} />,
};

/** what a search through each section reads: its name and every phrase it shows */
const SECTION_WORDS: Record<SettingsSection, string> = {
  general: 'settings.appearance',
  agents: 'settings.agents',
  providers: 'settings.providers',
  models: 'settings.models',
  developer: 'settings.developer',
  shortcuts: 'settings.shortcuts',
};

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** Where it opens (General when not given). */
  section?: SettingsSection;
}

/** Opens on General each time, or on the section asked for. */
export function SettingsModal({ open, onClose, section: opening }: SettingsModalProps) {
  const t = useT();
  const language = useLanguage();
  const [section, setSection] = React.useState<SettingsSection>('general');
  const [query, setQuery] = React.useState('');
  const [shown, setShown] = React.useState(false);
  const dialog = React.useRef<HTMLDivElement>(null);
  const search = React.useRef<HTMLInputElement>(null);
  /* the latest onClose without re-running the effect below: the page re-renders every frame while it plays, and
     re-running it would fade the dialog out and in and take the focus back each time */
  const close = React.useRef(onClose);
  close.current = onClose;

  React.useEffect(() => { if (open) { setSection(opening ?? 'general'); setQuery(''); } }, [open, opening]);

  /* the sections a search finds: by their names and by every phrase on them */
  const words = React.useMemo(() => Object.fromEntries((Object.keys(SECTION_WORDS) as SettingsSection[]).map((id) => [
    id, [t(`settings.sections.${id}`), ...phrasesUnder(SECTION_WORDS[id], language)].join('\n').toLowerCase(),
  ])) as Record<SettingsSection, string>, [t, language]);
  const needle = query.trim().toLowerCase();
  const nav = NAV.map((group) => ({ ...group, sections: group.sections.filter((id) => !needle || words[id].includes(needle)) }))
    .filter((group) => group.sections.length > 0);
  const found = nav.flatMap((group) => group.sections);
  const showing: SettingsSection | null = found.includes(section) ? section : found[0] ?? null;

  React.useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') close.current();
      if (e.key !== 'Tab' || !dialog.current?.contains(document.activeElement)) return;
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]'))
        .filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const r = requestAnimationFrame(() => { setShown(true); search.current?.focus(); });
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      cancelAnimationFrame(r);
      setShown(false);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10050] grid place-items-center p-6"
      style={{ background: 'rgba(0,0,0,0.5)', opacity: shown ? 1 : 0, transition: 'opacity 160ms ease' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="relative flex h-[min(800px,90vh)] w-full max-w-[1120px] overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--dock-pane)] shadow-[0_24px_64px_-12px_rgba(0,0,0,0.5),0_4px_16px_rgba(0,0,0,0.14)]"
        style={{ opacity: shown ? 1 : 0, transform: shown ? 'scale(1)' : 'scale(0.98)', transition: 'opacity 160ms ease, transform 200ms ease' }}
      >
        <nav aria-label={t('settings.title')} className="flex w-[264px] shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] px-3 pb-4 pt-3">
          <label className="mb-3 flex h-10 shrink-0 items-center gap-2.5 rounded-[9px] border border-[var(--border)] px-3 text-[var(--text-muted)] transition focus-within:border-[var(--text-muted)]">
            <Search size={17} strokeWidth={1.75} className="shrink-0" aria-hidden />
            <input
              ref={search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('settings.search')}
              aria-label={t('settings.search')}
              className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
            />
          </label>
          {nav.map((group) => (
            <div key={group.group} className="mt-3 flex flex-col gap-0.5">
              <div className="px-2.5 pb-1.5 text-[13px] text-[var(--text-faint)]">{t(group.group === 'help' ? 'settings.groups.help' : 'settings.title')}</div>
              {group.sections.map((id) => {
                const active = showing === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setSection(id)}
                    className={`flex h-10 min-w-0 items-center gap-3 rounded-[8px] px-2.5 text-left text-[15px] transition ${
                      active ? 'bg-[var(--bg-active)] text-[var(--text)]' : 'text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'
                    }`}
                  >
                    <span className={`shrink-0 ${active ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{SECTION_ICON[id]}</span>
                    <span className="min-w-0 truncate">{t(`settings.sections.${id}`)}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {found.length === 0 ? <p className="px-2.5 pt-4 text-[14px] text-[var(--text-faint)]">{t('settings.noResults')}</p> : null}
        </nav>

        <div className="relative flex min-w-0 flex-1 flex-col">
          <button type="button" onClick={onClose} aria-label={t('settings.done')}
            className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-[8px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
            <X size={19} strokeWidth={1.75} />
          </button>
          <div key={showing ?? 'none'} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-10 pb-12 pt-9">
            {showing ? <h2 id="settings-title" className="mb-7 text-[22px] font-semibold tracking-[-0.015em] text-[var(--text)]">{t(`settings.sections.${showing}`)}</h2> : null}
            {showing === 'general' && <GeneralSection />}
            {showing === 'agents' && <AgentsSection />}
            {showing === 'providers' && <ProvidersSection />}
            {showing === 'models' && <ModelsSection onConnect={() => { setQuery(''); setSection('providers'); }} />}
            {showing === 'developer' && <DeveloperSection />}
            {showing === 'shortcuts' && <ShortcutsSection />}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function GeneralSection() {
  const t = useT();
  const [mode, setMode] = useThemeMode();
  const [language, setLanguage] = useLanguageChoice();

  return (
    <SettingsPage>
      <SettingsGroup title={t('settings.appearance.group')}>
        <SettingsItem
          title={t('settings.appearance.theme')}
          description={t('settings.appearance.themeHint')}
          control={(
            <SettingsSegmented<ThemeMode>
              label={t('settings.appearance.theme')}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'system', label: t('settings.appearance.system'), icon: <Monitor size={15} /> },
                { value: 'light', label: t('settings.appearance.light'), icon: <Sun size={15} /> },
                { value: 'dark', label: t('settings.appearance.dark'), icon: <Moon size={15} /> },
              ]}
            />
          )}
        />
        <SettingsItem
          title={t('settings.appearance.language')}
          description={t('settings.appearance.languageHint')}
          control={(
            /* each language named in itself, so a person who cannot read the one shown still finds theirs */
            <SettingsSelect<LanguageChoice>
              label={t('settings.appearance.language')}
              value={language}
              onChange={setLanguage}
              options={[
                { value: 'system', label: t('settings.appearance.languageSystem') },
                ...LANGUAGES.map((l) => ({ value: l.code, label: l.name })),
              ]}
            />
          )}
        />
      </SettingsGroup>
      <AboutGroup />
    </SettingsPage>
  );
}

/**
 * This Studio's version and whether npm has a newer openfilm. In the desktop app, Studio comes with the app and is
 * updated with it; anywhere else the person (or their agent) runs the latest, and the CLI restarts Studio on it.
 */
function AboutGroup() {
  const t = useT();
  const [info, setInfo] = React.useState<StudioVersion | null>(null);
  const [state, setState] = React.useState<'idle' | 'checking' | 'failed'>('idle');
  React.useEffect(() => { void api.version().then(setInfo).catch(() => {}); }, []);
  const inApp = Boolean(studioHost);
  const check = () => {
    setState('checking');
    const before = info?.checkedAt ?? null;
    void api.version(true)
      .then((v) => { setInfo(v); setState(v.checkedAt != null && v.checkedAt !== before ? 'idle' : 'failed'); })
      .catch(() => setState('failed'));
  };
  const status = inApp ? t('settings.about.inApp')
    : info?.source ? t('settings.about.source')
    : info && !info.checking ? t('settings.about.off')
    : state === 'checking' ? t('settings.about.checking')
    : state === 'failed' ? t('settings.about.failed')
    : info?.newer ? t('settings.about.newer').replace('{version}', info.latest ?? '')
    : info?.latest ? t('settings.about.upToDate')
    : t('settings.about.never');
  return (
    <SettingsGroup title={t('settings.about.group')}>
      <SettingsItem
        title={info ? `OpenFilm ${info.version}` : 'OpenFilm'}
        description={status}
        control={inApp || !info?.checking ? null : (
          <SettingsButton disabled={state === 'checking'} onClick={check}>{t('settings.about.check')}</SettingsButton>
        )}
      />
      {!inApp && !info?.source && info?.newer ? (
        <SettingsItem
          title={t('settings.about.howTitle')}
          description={t('settings.about.how')}
          control={<code className="select-all rounded-md bg-[var(--surface-2)] px-2 py-1 font-mono text-[12px] text-[var(--text)]">npx -y openfilm@latest open</code>}
        />
      ) : null}
    </SettingsGroup>
  );
}

/** The app's developer mode: each turn's full log in its chat (lib/host.ts `developer`). */
function DeveloperSection() {
  const t = useT();
  const developer = studioHost?.developer;
  const [on, setOn] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (!developer) return undefined;
    void developer.get().then(setOn);
    return developer.onChange(setOn);
  }, [developer]);
  if (!developer) return null;
  return (
    <SettingsPage note={t('settings.developer.intro')}>
      <SettingsGroup title={t('settings.developer.group')} footnote={t('settings.developer.where')}>
        <SettingsItem
          title={t('settings.developer.logs')}
          description={t('settings.developer.logsHint')}
          control={<SettingsSwitch checked={on === true} disabled={on === null} label={t('settings.developer.logs')} onChange={(next) => { setOn(next); void developer.set(next); }} />}
        />
      </SettingsGroup>
    </SettingsPage>
  );
}

/**
 * The keys, as lib/timeline-keys lists them beside the code that reads them (playback, marks, editing, the view),
 * then the picture's own (FilmStageSelect).
 */
function ShortcutsSection() {
  const t = useT();
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const alt = mac ? '⌥' : 'Alt';
  const k = (key: string, opts?: { mod?: boolean; shift?: boolean }) => shortcutHint(key, opts);
  /* a key as this platform writes it: ⌘⇧B on a Mac, Ctrl+Shift+B elsewhere; ⌫ is Backspace off a Mac */
  const keyText = (key: ShortcutKey): string => {
    const name = !mac && key.key === '⌫' ? 'Backspace' : key.key;
    const mods = [key.mod ? (mac ? '⌘' : 'Ctrl') : '', key.alt ? alt : '', key.shift ? (mac ? '⇧' : 'Shift') : ''].filter(Boolean);
    return mac ? `${mods.join('')}${name}` : [...mods, name].filter(Boolean).join('+');
  };

  const groups: Array<{ title: string; items: Array<{ label: string; keys: string[] }> }> = [
    ...SHORTCUTS.map((group) => ({
      title: t(`settings.shortcuts.${group.group}`),
      items: group.rows.map((row) => ({ label: t(`settings.shortcuts.${row.label}`), keys: row.keys.map(keyText) })),
    })),
    {
      title: t('settings.shortcuts.groupCanvas'),
      items: [
        { label: t('settings.shortcuts.nudge'), keys: ['↑', '↓', '←', '→'] },
        { label: t('settings.shortcuts.nudgeFast'), keys: [k('↑', { shift: true }), k('↓', { shift: true }), k('←', { shift: true }), k('→', { shift: true })] },
        { label: t('settings.shortcuts.editText'), keys: ['Enter'] },
        { label: t('settings.shortcuts.commitText'), keys: [k('Enter', { mod: true })] },
        { label: t('settings.shortcuts.cancelText'), keys: ['Esc'] },
      ],
    },
  ];

  return (
    <SettingsPage note={t('settings.shortcuts.hint')}>
      {groups.map((group) => (
        <SettingsGroup key={group.title} title={group.title}>
          {group.items.map((item) => (
            <div key={item.label} className="flex min-h-[52px] items-center justify-between gap-6 py-2.5">
              <span className="text-[15px] text-[var(--text)]">{item.label}</span>
              <span className="flex max-w-[55%] shrink-0 flex-wrap items-center justify-end gap-1">
                {item.keys.map((key, j) => (
                  <React.Fragment key={key}>
                    {j > 0 ? <span className="px-0.5 text-[13px] text-[var(--text-faint)]">/</span> : null}
                    <kbd className="inline-flex h-7 min-w-7 items-center justify-center rounded-[6px] border border-[var(--border)] px-1.5 font-sans text-[13px] text-[var(--text-dim)]">
                      {key}
                    </kbd>
                  </React.Fragment>
                ))}
              </span>
            </div>
          ))}
        </SettingsGroup>
      ))}
    </SettingsPage>
  );
}
