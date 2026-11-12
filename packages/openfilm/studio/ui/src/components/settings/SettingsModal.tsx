/**
 * Settings, opened from the app menu at the top left, laid out as a computer's system settings: on the left a search,
 * the account (OpenFilm is used here without one; signing in to OpenFilm's account is for its services), a note when
 * an update waits, and the sections in groups, each with its colored mark; on the right the page shown, under a bar
 * with Back and Forward and its name. A section is a page of cards, or a list of pages of its own (General, Advanced),
 * each a row with a chevron, opened in place: Back goes up again, as in a browser. The search finds a section by any
 * phrase on it or its pages.
 *
 * General: About (the version, what is new, where OpenFilm lives), Software update, Language, Notifications (in an app
 * that offers them). Appearance: the theme. Agents (in an app with a chat), Services, Plugins, Keyboard shortcuts.
 * Advanced: Asset management (everything OpenFilm keeps on this computer, StoragePages), versions saved on their own,
 * how the preview plays, the library's categories. Developer: diagnostics.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import {
  X, Settings, Keyboard, Boxes, Bot, Search, SquareTerminal, Loader2, SlidersHorizontal, Puzzle, ChevronLeft,
  ChevronRight, Contrast, Info, RefreshCw, Globe, Bell, HardDrive, History, Play, LayoutGrid, UserRound, ExternalLink,
} from 'lucide-react';
import { LANGUAGES, phrasesUnder, useLanguage, useLanguageChoice, useT, type LanguageChoice } from '@/i18n';
import { studioHost, type HostDeveloper, type HostUpdateState } from '@/lib/host';
import { showWhatsNew } from '@/lib/whats-new';
import { usePreviewPrefs, writePreviewPref } from '@/lib/preview-prefs';
import { useProviders } from '@/lib/providers';
import { hasNotes } from '../WhatsNew';
import { BrandLogo } from '../BrandLogo';
import { useWebUpdate } from '../UpdateButton';
import { api, type StudioPrefs, type StudioVersion } from '@/api';
import { AgentsSection } from './AgentsSection';
import { DiagnosticsGroup } from './DiagnosticsGroup';
import { ModelsSection } from './ModelsSection';
import { SettingsSelect } from './SettingsSelect';
import { ShortcutsSection } from './ShortcutsSection';
import {
  SettingsButton, SettingsGroup, SettingsHero, SettingsItem, SettingsLinkButton, SettingsNavRow, SettingsPage, SettingsSegmented, SettingsSwitch, SettingsTile,
} from './ui';
import { useThemeMode, type ThemeMode } from './theme';
import { PluginsSection } from './PluginsSection';
import { LibraryCategoriesGroup } from './LibraryCategoriesGroup';
import { STORAGE_KINDS, StorageKindPage, StorageOverview, type StorageKind } from './StoragePages';

export type SettingsSection = 'account' | 'general' | 'appearance' | 'agents' | 'models' | 'plugins' | 'shortcuts' | 'advanced' | 'developer';

/** A page: a section, or a page inside one (its section first, then its own name). */
type PageId = SettingsSection
  | 'general/about' | 'general/update' | 'general/language' | 'general/notifications'
  | 'advanced/storage' | 'advanced/versions' | 'advanced/playback' | 'advanced/library'
  | `advanced/storage/${StorageKind}`;

const sectionOf = (page: PageId) => page.split('/')[0] as SettingsSection;

/* the nav, in groups: OpenFilm itself, what it works with, and the rest (Agents only inside an app with a chat:
   lib/host.ts `agents`) */
const NAV: SettingsSection[][] = [
  ['general', 'appearance'],
  [...(studioHost?.agents ? ['agents' as const] : []), 'models', 'plugins'],
  ['shortcuts', 'advanced', 'developer'],
];

/** where OpenFilm lives, on About */
const LINKS = [
  { label: 'settings.links.github', href: 'https://github.com/openfilm/openfilm' },
  { label: 'settings.links.examples', href: 'https://github.com/openfilm/examples' },
  { label: 'settings.links.site', href: 'https://openfilm.dev' },
];

const ICON = { size: 16, strokeWidth: 2 } as const;
/** each section's mark: its glyph on its color */
const SECTION_TILE: Record<Exclude<SettingsSection, 'account'>, { color: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }> = {
  general: { color: '#8e8e93', icon: Settings },
  appearance: { color: '#2c2c2e', icon: Contrast },
  agents: { color: '#7d5bf0', icon: Bot },
  models: { color: '#0a84ff', icon: Boxes },
  plugins: { color: '#34a853', icon: Puzzle },
  shortcuts: { color: '#636366', icon: Keyboard },
  advanced: { color: '#5e6ad2', icon: SlidersHorizontal },
  developer: { color: '#4b5563', icon: SquareTerminal },
};
const sectionTile = (id: Exclude<SettingsSection, 'account'>, size = 26) => {
  const { color, icon: Icon } = SECTION_TILE[id];
  return <SettingsTile color={color} size={size}><Icon size={Math.round(size * 0.6)} strokeWidth={2} /></SettingsTile>;
};
const tile = (color: string, Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>) => <SettingsTile color={color}><Icon {...ICON} /></SettingsTile>;

/** what a search through each section reads: its name and every phrase on it and its pages (Notifications only where
    it shows: inside an app that offers them, lib/host.ts `notifications`) */
const SECTION_WORDS: Record<SettingsSection, string | string[]> = {
  account: 'settings.account',
  general: ['settings.general', 'settings.about', 'settings.links', 'settings.appearance.language', 'settings.appearance.languageHint', ...(studioHost?.notifications ? ['settings.notifications'] : [])],
  appearance: 'settings.appearance',
  agents: 'settings.agents',
  models: ['settings.models', 'settings.providers'],
  plugins: 'settings.plugins',
  developer: ['settings.developer', 'settings.report'],
  shortcuts: 'settings.shortcuts',
  advanced: ['settings.advanced', 'settings.storage', 'settings.versions', 'settings.playback', 'settings.libraryCategories'],
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
  /* the pages gone through, as a browser's history: Back and Forward move along it, a page opened cuts what was ahead */
  const [trail, setTrail] = React.useState<{ pages: PageId[]; at: number }>({ pages: ['general'], at: 0 });
  const [query, setQuery] = React.useState('');
  const dialog = React.useRef<HTMLDivElement>(null);
  const search = React.useRef<HTMLInputElement>(null);
  /* the latest onClose without re-running the effect below: the page re-renders every frame while it plays, and
     re-running it would take the focus back each time */
  const close = React.useRef(onClose);
  close.current = onClose;

  React.useEffect(() => { if (open) { setTrail({ pages: [opening ?? 'general'], at: 0 }); setQuery(''); } }, [open, opening]);

  const go = React.useCallback((page: PageId) => setTrail(({ pages, at }) => (
    pages[at] === page ? { pages, at } : { pages: [...pages.slice(0, at + 1), page], at: at + 1 }
  )), []);
  const back = () => setTrail((was) => ({ ...was, at: Math.max(0, was.at - 1) }));
  const forward = () => setTrail((was) => ({ ...was, at: Math.min(was.pages.length - 1, was.at + 1) }));

  /* the sections a search finds: by their names and by every phrase on them */
  const words = React.useMemo(() => Object.fromEntries((Object.keys(SECTION_WORDS) as SettingsSection[]).map((id) => [
    id, [t(`settings.sections.${id}`), ...[SECTION_WORDS[id]].flat().flatMap((under) => phrasesUnder(under, language))].join('\n').toLowerCase(),
  ])) as Record<SettingsSection, string>, [t, language]);
  const needle = query.trim().toLowerCase();
  const nav = NAV.map((group) => group.filter((id) => !needle || words[id].includes(needle))).filter((group) => group.length > 0);
  const found: SettingsSection[] = [...(!needle || words.account.includes(needle) ? ['account' as const] : []), ...nav.flat()];
  const page = trail.pages[trail.at]!;
  const showing: PageId | null = found.includes(sectionOf(page)) ? page : found[0] ?? null;

  React.useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') close.current();
      /* ⌘[ and ⌘] go back and forward, as in a browser */
      if ((e.metaKey || e.ctrlKey) && (e.key === '[' || e.key === ']') && dialog.current?.contains(document.activeElement)) {
        e.preventDefault();
        setTrail((was) => ({ ...was, at: Math.max(0, Math.min(was.pages.length - 1, was.at + (e.key === '[' ? -1 : 1))) }));
      }
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
    /* shown at once, as the projects window is; the search takes the keys */
    const r = requestAnimationFrame(() => search.current?.focus());
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      cancelAnimationFrame(r);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;

  const title = showing ? pageTitle(showing, t) : t('settings.title');
  /* a section that opens on its own card names itself there; any other page is named in the bar */
  const hero = showing === 'general' || showing === 'advanced' || showing === 'account';
  const shownSection = showing ? sectionOf(showing) : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10050] grid place-items-center p-6"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-[86dvh] max-h-[900px] w-[92vw] max-w-[1120px] overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--settings-pane)] shadow-[0_24px_64px_-12px_rgba(0,0,0,0.5),0_4px_16px_rgba(0,0,0,0.14)]"
      >
        <nav aria-label={t('settings.title')} className="flex w-[264px] shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--settings-side)] px-2.5 pb-4 pt-3">
          <label className="mb-3 flex h-9 shrink-0 items-center gap-2 rounded-[8px] bg-[var(--bg-field)] px-2.5 text-[var(--text-muted)] transition focus-within:ring-2 focus-within:ring-[var(--accent)]/40">
            <Search size={15} strokeWidth={2} className="shrink-0" aria-hidden />
            <input
              ref={search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('settings.search')}
              aria-label={t('settings.search')}
              className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
            />
          </label>
          {found.includes('account') ? <AccountCard active={shownSection === 'account'} onOpen={() => go('account')} /> : null}
          <UpdateWaiting onOpen={() => go('general/update')} />
          {nav.map((group, i) => (
            <div key={i} className="mt-3 flex flex-col gap-px">
              {group.map((id) => {
                const active = shownSection === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => go(id)}
                    className={`flex h-9 min-w-0 items-center gap-2.5 rounded-[7px] px-2 text-left text-[14.5px] transition ${
                      active ? 'bg-[var(--accent)] text-white' : 'text-[var(--text)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    {sectionTile(id as Exclude<SettingsSection, 'account'>, 22)}
                    <span className="min-w-0 truncate">{t(`settings.sections.${id}`)}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {found.length === 0 ? <p className="px-2.5 pt-4 text-[14px] text-[var(--text-faint)]">{t('settings.noResults')}</p> : null}
        </nav>

        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex h-[52px] shrink-0 items-center gap-3 px-4">
            <div className="flex h-8 items-center rounded-[8px] bg-[var(--bg-field)]">
              <button type="button" onClick={back} disabled={trail.at === 0} aria-label={t('settings.back')} title={t('settings.back')}
                className="grid h-8 w-8 place-items-center rounded-l-[8px] text-[var(--text)] transition hover:bg-[var(--bg-hover)] disabled:text-[var(--text-faint)] disabled:hover:bg-transparent">
                <ChevronLeft size={17} strokeWidth={2} />
              </button>
              <span aria-hidden className="h-4 w-px bg-[var(--border)]" />
              <button type="button" onClick={forward} disabled={trail.at >= trail.pages.length - 1} aria-label={t('settings.forward')} title={t('settings.forward')}
                className="grid h-8 w-8 place-items-center rounded-r-[8px] text-[var(--text)] transition hover:bg-[var(--bg-hover)] disabled:text-[var(--text-faint)] disabled:hover:bg-transparent">
                <ChevronRight size={17} strokeWidth={2} />
              </button>
            </div>
            <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[var(--text)]">{showing && !hero ? title : ''}</h2>
            <button type="button" onClick={onClose} aria-label={t('settings.done')}
              className="grid h-8 w-8 place-items-center rounded-[8px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>
          <div key={showing ?? 'none'} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-8 pb-12 pt-2">
            <div className="mx-auto w-full max-w-[760px]">
              {showing ? <SettingsPageFor page={showing} go={go} /> : null}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A page's name, in the bar. */
function pageTitle(page: PageId, t: (key: string) => string): string {
  if (page.startsWith('advanced/storage/')) return t(`settings.storage.kinds.${page.split('/')[2]}`);
  switch (page) {
    case 'general/about': return t('settings.about.title');
    case 'general/update': return t('settings.about.update');
    case 'general/language': return t('settings.appearance.language');
    case 'general/notifications': return t('settings.notifications.group');
    case 'advanced/storage': return t('settings.storage.title');
    case 'advanced/versions': return t('settings.versions.group');
    case 'advanced/playback': return t('settings.playback.group');
    case 'advanced/library': return t('settings.libraryCategories.group');
    default: return t(`settings.sections.${page}`);
  }
}

function SettingsPageFor({ page, go }: { page: PageId; go: (page: PageId) => void }) {
  if (page.startsWith('advanced/storage/')) {
    const kind = page.split('/')[2] as StorageKind;
    return STORAGE_KINDS.includes(kind) ? <StorageKindPage kind={kind} /> : null;
  }
  switch (page) {
    case 'account': return <AccountSection go={go} />;
    case 'general': return <GeneralSection go={go} />;
    case 'general/about': return <AboutPage />;
    case 'general/update': return <SettingsPage>{studioHost?.update?.onState ? <AppAboutGroup /> : <AboutGroup />}</SettingsPage>;
    case 'general/language': return <LanguagePage />;
    case 'general/notifications': return <SettingsPage><NotificationsGroup /></SettingsPage>;
    case 'appearance': return <AppearanceSection />;
    case 'agents': return <AgentsSection />;
    case 'models': return <ModelsSection />;
    case 'plugins': return <PluginsSection />;
    case 'shortcuts': return <ShortcutsSection />;
    case 'advanced': return <AdvancedSection go={go} />;
    case 'advanced/storage': return <StorageOverview onOpen={(kind) => go(`advanced/storage/${kind}`)} />;
    case 'advanced/versions': return <SettingsPage><VersionsGroup /></SettingsPage>;
    case 'advanced/playback': return <SettingsPage><PlaybackGroup /></SettingsPage>;
    case 'advanced/library': return <SettingsPage><LibraryCategoriesGroup /></SettingsPage>;
    case 'developer': return <DeveloperSection />;
    default: return null;
  }
}

/** OpenFilm's account, signed in to or not: the person's own account at OpenFilm's service (Services' OpenFilm). */
function useAccount() {
  const hook = useProviders();
  const openfilm = hook.state?.providers.find((p) => p.id === 'openfilm') ?? null;
  return { hook, openfilm, signedIn: Boolean(openfilm?.source), waiting: hook.state?.signingIn?.provider === 'openfilm' };
}

/** A round picture for the account: the first letter of its email, or a person's outline while there is none. */
function Avatar({ email, size }: { email: string | null; size: number }) {
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: email ? 'linear-gradient(160deg, #3fc3cc, #0a7f88)' : 'linear-gradient(160deg, #a1a1a8, #6b6b72)' }}>
      {email ? email.slice(0, 1).toUpperCase() : <UserRound size={Math.round(size * 0.56)} strokeWidth={1.75} />}
    </span>
  );
}

/** At the top of the nav: who is signed in, or that OpenFilm is used here without an account. */
function AccountCard({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const t = useT();
  const { openfilm, signedIn } = useAccount();
  const email = signedIn ? openfilm?.account ?? null : null;
  return (
    <button type="button" onClick={onOpen} aria-current={active ? 'page' : undefined} data-settings-account=""
      className={`flex min-w-0 items-center gap-3 rounded-[9px] px-2 py-2 text-left transition ${active ? 'bg-[var(--bg-pressed)]' : 'hover:bg-[var(--bg-hover)]'}`}>
      <Avatar email={email} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-semibold text-[var(--text)]">{email ?? (signedIn ? t('settings.account.signedIn') : t('settings.account.local'))}</span>
        <span className="block truncate text-[12.5px] text-[var(--text-muted)]">{signedIn ? t('settings.account.signedInSub') : t('settings.account.localSub')}</span>
      </span>
    </button>
  );
}

/** Under the account, while a newer OpenFilm waits (the app's update, or a newer openfilm on npm): opens Software update. */
function UpdateWaiting({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  const update = studioHost?.update;
  const [waiting, setWaiting] = React.useState(false);
  React.useEffect(() => {
    if (update?.onState) return update.onState((s) => setWaiting(['available', 'downloading', 'staging', 'ready'].includes(s.status)));
    let live = true;
    void api.version().then((v) => { if (live) setWaiting(Boolean(v.newer) && !v.source); }, () => {});
    return () => { live = false; };
  }, [update]);
  if (!waiting) return null;
  return (
    <button type="button" onClick={onOpen} className="mt-1 flex items-center gap-3 rounded-[7px] px-2 py-1.5 text-left text-[14px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]">
      <span className="min-w-0 flex-1 truncate">{t('settings.updateWaiting')}</span>
      <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#ff453a] px-1.5 text-[12px] font-semibold text-white">1</span>
    </button>
  );
}

/**
 * The account: OpenFilm is used on this computer without one, its projects and media kept here; signed in (in the
 * browser, Services' OpenFilm), OpenFilm's own services make media, paid from the account's balance.
 */
function AccountSection({ go }: { go: (page: PageId) => void }) {
  const t = useT();
  const { hook, openfilm, signedIn, waiting } = useAccount();
  const email = signedIn ? openfilm?.account ?? null : null;
  const busy = hook.busy === 'openfilm';
  const problem = (hook.problemFor === 'openfilm' ? hook.problem : null) ?? (hook.state?.signingIn?.errorFor === 'openfilm' ? hook.state.signingIn.error : null) ?? openfilm?.connectionError ?? null;
  return (
    <SettingsPage>
      <SettingsHero tile={<Avatar email={email} size={72} />}
        title={email ?? (signedIn ? t('settings.account.signedIn') : t('settings.account.local'))}
        description={signedIn ? t('settings.account.signedInDesc') : t('settings.account.localDesc')} />
      <SettingsGroup title={t('settings.account.openfilm')} footnote={problem ? <span className="text-[var(--err)]" role="alert">{problem}</span> : null}>
        {signedIn ? (
          <SettingsItem title={email ?? t('settings.account.signedIn')} description={openfilm?.source === 'env' ? t('settings.account.envNote') : t('settings.account.signedInSub')}
            control={(
              <>
                {openfilm?.keysUrl ? <SettingsLinkButton href={openfilm.keysUrl}>{t('settings.account.page')}<ExternalLink size={12} /></SettingsLinkButton> : null}
                {openfilm?.source !== 'env' ? <SettingsButton variant="quiet" disabled={busy} onClick={() => void hook.removeKey('openfilm')}>{t('settings.account.signOut')}</SettingsButton> : null}
              </>
            )} />
        ) : (
          <SettingsItem title={t('settings.account.signInTitle')} description={waiting ? t('settings.providers.signingIn') : t('settings.account.signInHint')}
            control={waiting
              ? <SettingsButton variant="quiet" disabled={busy} onClick={() => void hook.cancelSignIn('openfilm')}>{t('settings.providers.cancel')}</SettingsButton>
              : <SettingsButton variant="primary" disabled={busy || !openfilm} onClick={() => void hook.signIn('openfilm')}>{t('settings.account.signIn')}</SettingsButton>} />
        )}
      </SettingsGroup>
      <SettingsGroup title={t('settings.account.thisComputer')}>
        <SettingsNavRow tile={tile('#5e6ad2', HardDrive)} title={t('settings.storage.title')} onClick={() => go('advanced/storage')} />
        <SettingsNavRow tile={sectionTile('models', 28)} title={t('settings.sections.models')} onClick={() => go('models')} />
      </SettingsGroup>
    </SettingsPage>
  );
}

/** General: a list of its pages. */
function GeneralSection({ go }: { go: (page: PageId) => void }) {
  const t = useT();
  const [language] = useLanguageChoice();
  const [version, setVersion] = React.useState<string | null>(null);
  React.useEffect(() => { void api.version().then((v) => setVersion(v.version), () => {}); }, []);
  const languageName = language === 'system' ? t('settings.appearance.languageSystem') : LANGUAGES.find((l) => l.code === language)?.name ?? '';
  return (
    <SettingsPage>
      <SettingsHero tile={sectionTile('general', 64)} title={t('settings.sections.general')} description={t('settings.general.desc')} />
      <SettingsGroup>
        <SettingsNavRow tile={tile('#8e8e93', Info)} title={t('settings.about.title')} value={version} onClick={() => go('general/about')} />
        <SettingsNavRow tile={tile('#8e8e93', RefreshCw)} title={t('settings.about.update')} onClick={() => go('general/update')} />
      </SettingsGroup>
      <SettingsGroup>
        <SettingsNavRow tile={tile('#0a84ff', Globe)} title={t('settings.appearance.language')} value={languageName} onClick={() => go('general/language')} />
        {studioHost?.notifications ? <SettingsNavRow tile={tile('#ff3b30', Bell)} title={t('settings.notifications.group')} onClick={() => go('general/notifications')} /> : null}
      </SettingsGroup>
    </SettingsPage>
  );
}

/** About: OpenFilm, its version, what is new in it, and where it lives. */
function AboutPage() {
  const t = useT();
  const [version, setVersion] = React.useState<string | null>(null);
  React.useEffect(() => { void api.version().then((v) => setVersion(v.version), () => {}); }, []);
  return (
    <SettingsPage>
      <SettingsHero tile={<span className="grid h-16 w-16 place-items-center rounded-[15px] bg-[var(--bg-panel)] text-[var(--text)] shadow-[inset_0_0_0_1px_var(--border)]"><BrandLogo size={36} /></span>}
        title="OpenFilm" description={(
          <>
            {version ? t('settings.about.version').replace('{version}', version) : null}
            {hasNotes(version ?? undefined) ? <span className="mt-2 block"><WhatsNewLink /></span> : null}
          </>
        )} />
      <SettingsGroup title={t('settings.about.links')}>
        {LINKS.map((link) => (
          <a key={link.href} href={link.href} target="_blank" rel="noreferrer"
            className="-mx-4 flex min-h-[48px] items-center gap-3 px-4 py-2.5 text-[15px] text-[var(--text)] transition first:rounded-t-[12px] last:rounded-b-[12px] hover:bg-[var(--bg-hover)]">
            <span className="min-w-0 flex-1">{t(link.label)}</span>
            <span className="text-[13.5px] text-[var(--text-faint)]">{link.href.replace(/^https:\/\//, '')}</span>
            <ExternalLink size={14} className="shrink-0 text-[var(--text-faint)]" aria-hidden />
          </a>
        ))}
      </SettingsGroup>
    </SettingsPage>
  );
}

/** The language OpenFilm shows itself in: each named in itself, so a person who cannot read the one shown still finds theirs. */
function LanguagePage() {
  const t = useT();
  const [language, setLanguage] = useLanguageChoice();
  return (
    <SettingsPage>
      <SettingsGroup>
        <SettingsItem
          title={t('settings.appearance.language')}
          description={t('settings.appearance.languageHint')}
          control={(
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
    </SettingsPage>
  );
}

/** A little window in a theme's colors, as the theme picker shows each (System: light and dark, half each). */
function ThemePicture({ mode }: { mode: ThemeMode }) {
  const pane = (dark: boolean) => (
    <span className="absolute inset-0 flex flex-col gap-1 p-2" style={{ background: dark ? '#1e1e20' : '#f2f2f4' }}>
      <span className="h-1.5 w-8 rounded-full" style={{ background: dark ? '#3a3a3e' : '#d6d6da' }} />
      <span className="flex flex-1 gap-1">
        <span className="w-4 rounded-[3px]" style={{ background: dark ? '#2b2b2e' : '#e3e3e7' }} />
        <span className="flex-1 rounded-[3px]" style={{ background: dark ? '#2b2b2e' : '#ffffff' }} />
      </span>
    </span>
  );
  return (
    <span className="relative block h-[66px] w-[100px] overflow-hidden rounded-[8px]">
      {mode === 'dark' ? pane(true) : pane(false)}
      {mode === 'system' ? <span className="absolute inset-0" style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}>{pane(true)}</span> : null}
    </span>
  );
}

/** Appearance: the theme, each choice a picture of it. */
function AppearanceSection() {
  const t = useT();
  const [mode, setMode] = useThemeMode();
  const options: Array<{ value: ThemeMode; label: string }> = [
    { value: 'system', label: t('settings.appearance.system') },
    { value: 'light', label: t('settings.appearance.light') },
    { value: 'dark', label: t('settings.appearance.dark') },
  ];
  return (
    <SettingsPage>
      <SettingsGroup>
        <SettingsItem title={t('settings.appearance.theme')} description={t('settings.appearance.themeHint')}>
          <div role="radiogroup" aria-label={t('settings.appearance.theme')} className="flex flex-wrap gap-5 pb-1">
            {options.map((option) => {
              const on = option.value === mode;
              return (
                <button key={option.value} type="button" role="radio" aria-checked={on} aria-label={option.label} onClick={() => { if (!on) setMode(option.value); }}
                  className="flex flex-col items-center gap-2 rounded-[10px] text-[13.5px]">
                  <span className={`rounded-[10px] p-[3px] ring-2 transition ${on ? 'ring-[var(--accent)]' : 'ring-transparent hover:ring-[var(--border-strong)]'}`}>
                    <ThemePicture mode={option.value} />
                  </span>
                  <span aria-hidden className={`${on ? 'font-medium text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{option.label}</span>
                </button>
              );
            })}
          </div>
        </SettingsItem>
      </SettingsGroup>
    </SettingsPage>
  );
}

/** In the app: the system's notification of a chat's turn done, stopped or waiting, while its window is not in front. */
function NotificationsGroup() {
  const t = useT();
  const notifications = studioHost?.notifications;
  const [on, setOn] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (!notifications) return undefined;
    void notifications.get().then(setOn);
    return notifications.onChange(setOn);
  }, [notifications]);
  return (
    <SettingsGroup title={t('settings.notifications.group')}>
      <SettingsItem
        title={t('settings.notifications.turns')}
        description={t('settings.notifications.turnsHint')}
        /* drawn once the app has said whether they are on: no switch slid on each time the page opens */
        control={on === null ? null : <SettingsSwitch checked={on} label={t('settings.notifications.turns')} onChange={(next) => { setOn(next); void notifications?.set(next); }} />}
      />
    </SettingsGroup>
  );
}

/**
 * How the preview plays heavy footage (studio/server/proxies.mjs): from a lighter copy made in the background (a
 * proxy), and how tall that copy is; whether pages draw at the viewer's size, and whether stretches that play late are
 * rendered to play smoothly (lib/preview-prefs). Exports always read the originals and draw at full size.
 */
function PlaybackGroup() {
  const t = useT();
  const { fitPages, renders } = usePreviewPrefs();
  const [prefs, setPrefs] = React.useState<StudioPrefs | null>(null);
  React.useEffect(() => { void api.prefs().then(setPrefs).catch(() => {}); }, []);
  if (!prefs) return null;
  const change = (proxies: Partial<StudioPrefs['proxies']>) => {
    setPrefs({ ...prefs, proxies: { ...prefs.proxies, ...proxies } });
    void api.setPrefs({ proxies }).then(setPrefs).catch(() => {});
  };
  return (
    <SettingsGroup title={t('settings.playback.group')}>
      <SettingsItem
        title={t('settings.playback.proxies')}
        description={t('settings.playback.proxiesHint')}
        control={<SettingsSwitch checked={prefs.proxies.on} onChange={(on) => change({ on })} label={t('settings.playback.proxies')} />}
      />
      {prefs.proxies.on ? (
        <SettingsItem
          title={t('settings.playback.proxySize')}
          description={t('settings.playback.proxySizeHint')}
          control={(
            <SettingsSegmented<'540' | '720' | '1080'>
              label={t('settings.playback.proxySize')}
              value={String(prefs.proxies.height) as '540' | '720' | '1080'}
              onChange={(v) => change({ height: Number(v) as 540 | 720 | 1080 })}
              options={[{ value: '540', label: '540p' }, { value: '720', label: '720p' }, { value: '1080', label: '1080p' }]}
            />
          )}
        />
      ) : null}
      <SettingsItem
        title={t('settings.advanced.fitPages')}
        description={t('settings.advanced.fitPagesHint')}
        control={<SettingsSwitch checked={fitPages} onChange={(on) => writePreviewPref('fitPages', on)} label={t('settings.advanced.fitPages')} />}
      />
      <SettingsItem
        title={t('settings.advanced.renders')}
        description={t('settings.advanced.rendersHint')}
        control={<SettingsSwitch checked={renders} onChange={(on) => writePreviewPref('renders', on)} label={t('settings.advanced.renders')} />}
      />
    </SettingsGroup>
  );
}

/**
 * Versions saved on their own (studio/server/auto-versions.mjs): whether open projects save them while they are worked
 * on. Showing these versions is controlled by the type filter in Version history.
 */
function VersionsGroup() {
  const t = useT();
  const [prefs, setPrefs] = React.useState<StudioPrefs | null>(null);
  React.useEffect(() => { void api.prefs().then(setPrefs).catch(() => {}); }, []);
  if (!prefs) return null;
  const change = (patch: { autoVersions?: boolean }) => {
    setPrefs({ ...prefs, ...patch });
    void api.setPrefs(patch).then(setPrefs).catch(() => setPrefs(prefs));
  };
  return (
    <SettingsGroup title={t('settings.versions.group')}>
      <SettingsItem
        title={t('settings.versions.auto')}
        description={t('settings.versions.autoHint')}
        control={<SettingsSwitch checked={prefs.autoVersions === true} onChange={(on) => change({ autoVersions: on })} label={t('settings.versions.auto')} />}
      />
    </SettingsGroup>
  );
}

/**
 * Advanced, a list of its pages: Asset management (StoragePages), versions saved on their own (VersionsGroup), how the
 * preview plays (PlaybackGroup), the library's categories (LibraryCategoriesGroup). All but the first are already
 * set for the best experience.
 */
function AdvancedSection({ go }: { go: (page: PageId) => void }) {
  const t = useT();
  return (
    <SettingsPage>
      <SettingsHero tile={sectionTile('advanced', 64)} title={t('settings.sections.advanced')} description={t('settings.advanced.desc')} />
      <SettingsGroup>
        <SettingsNavRow tile={tile('#5e6ad2', HardDrive)} title={t('settings.storage.title')} onClick={() => go('advanced/storage')} />
      </SettingsGroup>
      <SettingsGroup>
        <SettingsNavRow tile={tile('#ff9f0a', History)} title={t('settings.versions.group')} onClick={() => go('advanced/versions')} />
        <SettingsNavRow tile={tile('#34a853', Play)} title={t('settings.playback.group')} onClick={() => go('advanced/playback')} />
        <SettingsNavRow tile={tile('#32ade6', LayoutGrid)} title={t('settings.libraryCategories.group')} onClick={() => go('advanced/library')} />
      </SettingsGroup>
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
  /* Update here as in the top bar: Studio runs the newest and starts again on it */
  const web = useWebUpdate();
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
      >
        {hasNotes(info?.version) ? <WhatsNewLink /> : null}
      </SettingsItem>
      {!inApp && !info?.source && info?.newer ? (
        <SettingsItem
          title={t('settings.about.howTitle')}
          description={web.update?.status === 'updating' ? t('update.webUpdating')
            : web.update?.status === 'waiting' ? t(web.update.reason === 'exporting' ? 'update.webExporting' : 'update.webMaking')
            : web.update?.status === 'failed' ? t('update.webFailed').replace('{error}', web.update.error)
            : t('settings.about.how')}
          control={(
            <>
              <code className="select-all rounded-md bg-[var(--bg-field)] px-2 py-1 font-mono text-[12px] text-[var(--text)]">npx -y openfilm@latest update</code>
              <SettingsButton variant="primary" disabled={!web.update || web.update.status === 'updating'} onClick={web.start}>
                {web.update?.status === 'updating' ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
                {t('update.webUpdate')}
              </SettingsButton>
            </>
          )}
        />
      ) : null}
    </SettingsGroup>
  );
}

/** This release's notes again (components/WhatsNew). */
function WhatsNewLink() {
  const t = useT();
  return (
    <button type="button" onClick={() => showWhatsNew()}
      className="mb-2 text-[13.5px] text-[var(--text-muted)] underline underline-offset-2 transition hover:text-[var(--text)]">
      {t('settings.about.whatsNew')}
    </button>
  );
}

/** A check that answered this long ago is still news: opening About within it looks again only on a click. */
const CHECKED_FRESH_MS = 10 * 60_000;

/**
 * The app's version and its update (lib/host.ts `update`), as an app's About shows them: looked for on opening (unless
 * a check answered a few minutes ago), downloaded by itself with its progress, Restart when it is ready (it installs at
 * the next quit too). The menu's Check for Updates… stays.
 */
function AppAboutGroup() {
  const t = useT();
  const language = useLanguage();
  const update = studioHost?.update;
  const [state, setState] = React.useState<HostUpdateState | null>(null);
  const [refused, setRefused] = React.useState<string | null>(null);
  React.useEffect(() => update?.onState?.(setState), [update]);
  /* looked for once on opening, when the last answer is old or there is none */
  const looked = React.useRef(false);
  React.useEffect(() => {
    if (!state || looked.current) return;
    looked.current = true;
    const stale = state.checkedAt == null || Date.now() - state.checkedAt > CHECKED_FRESH_MS;
    if (stale && ['idle', 'current', 'error'].includes(state.status)) void update?.check?.();
  }, [state, update]);
  const check = () => { setRefused(null); void update?.check?.(); };
  const restart = () => {
    setRefused(null);
    void update?.restart().then((r) => { if (!r.ok && r.error) setRefused(r.error); });
  };
  const ago = (at: number) => {
    const minutes = Math.round((Date.now() - at) / 60_000);
    const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
    return minutes < 60 ? rtf.format(-minutes, 'minute') : minutes < 48 * 60 ? rtf.format(-Math.round(minutes / 60), 'hour') : rtf.format(-Math.round(minutes / 1440), 'day');
  };
  const s = state;
  const next = s?.availableVersion ?? '';
  const waiting = refused ?? (s?.status === 'ready' ? s.error : null);
  const why = waiting === 'agent-busy' ? t('update.agentBusy') : waiting === 'exporting' ? t('update.exporting')
    : waiting === 'install-failed' ? t('update.installFailed').replace('{version}', next) : null;
  const errorText = s?.error === 'offline' ? t('settings.about.appOffline') : s?.error === 'unavailable' ? t('settings.about.appUnavailable') : t('settings.about.appFailed');
  const busy = (text: string) => <span className="inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" aria-hidden />{text}</span>;
  const description = !s ? null
    : s.status === 'off' ? t('settings.about.appOff')
    : s.status === 'idle' || s.status === 'checking' ? busy(t('settings.about.checking'))
    : s.status === 'current' ? `${t('settings.about.upToDate')}${s.checkedAt ? ` ${t('settings.about.appChecked').replace('{time}', ago(s.checkedAt))}` : ''}`
    : s.status === 'available' || s.status === 'downloading' ? busy(`${t('settings.about.appDownloading').replace('{version}', next)}${s.status === 'downloading' ? ` ${Math.round(s.progress)}%` : ''}`)
    : s.status === 'staging' ? busy(t('settings.about.appStaging').replace('{version}', next))
    : s.status === 'ready' ? (why ?? t('update.ready').replace('{version}', next))
    : s.status === 'installing' ? busy(t('update.installing'))
    : errorText;
  const control = !s ? null
    : s.status === 'current' ? <SettingsButton onClick={check}>{t('settings.about.check')}</SettingsButton>
    : s.status === 'error' ? <SettingsButton onClick={check}>{t('settings.about.appRetry')}</SettingsButton>
    : s.status === 'ready' ? <SettingsButton variant="primary" onClick={restart}>{t('update.restart')}</SettingsButton>
    : null;
  return (
    <SettingsGroup title={t('settings.about.group')}>
      <SettingsItem
        title={`OpenFilm ${s?.version ?? ''}`.trim()}
        badge={s?.channel === 'beta' ? <span className="rounded-full bg-[var(--bg-field)] px-2 py-0.5 text-[11.5px] text-[var(--text-muted)]">beta</span> : null}
        description={description}
        control={control}
      >
        {hasNotes(s?.version) ? <WhatsNewLink /> : null}
        {s?.status === 'downloading' ? (
          <div className="h-1 overflow-hidden rounded-full bg-[var(--bg-field)]" role="progressbar" aria-valuenow={Math.round(s.progress)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-[var(--accent)] transition-[width]" style={{ width: `${Math.max(2, s.progress)}%` }} />
          </div>
        ) : null}
      </SettingsItem>
    </SettingsGroup>
  );
}

/**
 * Diagnostics (DiagnosticsGroup), for when something does not work; how playing goes, in the viewer's corner
 * (lib/preview-prefs `stats`); in the app, what its chat shows of each turn: what it changed in the files, and its
 * full log (lib/host.ts `developer`).
 */
function DeveloperSection() {
  const t = useT();
  const developer = studioHost?.developer;
  const [prefs, setPrefs] = React.useState<HostDeveloper | null>(null);
  React.useEffect(() => {
    if (!developer) return undefined;
    void developer.get().then(setPrefs);
    return developer.onChange(setPrefs);
  }, [developer]);
  const change = (next: Partial<HostDeveloper>) => {
    setPrefs((was) => (was ? { ...was, ...next } : was));
    void developer?.set(next);
  };
  const { stats } = usePreviewPrefs();
  return (
    <SettingsPage note={t('settings.developer.intro')}>
      <DiagnosticsGroup />
      <SettingsGroup title={t('settings.developer.playbackGroup')}>
        <SettingsItem
          title={t('settings.developer.playbackStats')}
          description={t('settings.developer.playbackStatsHint')}
          control={<SettingsSwitch checked={stats} onChange={(on) => writePreviewPref('stats', on)} label={t('settings.developer.playbackStats')} />}
        />
      </SettingsGroup>
      {developer ? (
        <SettingsGroup title={t('settings.developer.group')} footnote={t('settings.developer.where')}>
          {/* drawn once the app has said whether each is on: drawn off first, a switch slid on each time the page opened */}
          <SettingsItem
            title={t('settings.developer.changes')}
            description={t('settings.developer.changesHint')}
            control={prefs ? <SettingsSwitch checked={prefs.changes} label={t('settings.developer.changes')} onChange={(on) => change({ changes: on })} /> : null}
          />
          <SettingsItem
            title={t('settings.developer.logs')}
            description={t('settings.developer.logsHint')}
            control={prefs ? <SettingsSwitch checked={prefs.logs} label={t('settings.developer.logs')} onChange={(on) => change({ logs: on })} /> : null}
          />
        </SettingsGroup>
      ) : null}
    </SettingsPage>
  );
}
