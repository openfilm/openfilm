/**
 * Settings, opened from the app menu at the top left: a search and the sections in groups on the left, the section on the
 * right as a page of titled groups. General (the account, the theme and the language), Agents (in an app with a chat: the agents
 * it can use), Services (which model makes each kind of media, and the services connected for it), the keyboard
 * shortcuts, Advanced and Developer; the search finds a section by any phrase on it. At the
 * foot of the nav, quietly, where OpenFilm lives: its code, the examples and the website.
 */
import React from 'react';
import { Settings2, Keyboard, Sun, Moon, Monitor, Boxes, Bot, SquareTerminal, Loader2, SlidersHorizontal, ChevronLeft } from 'lucide-react';
import { LANGUAGES, phrasesUnder, useLanguage, useLanguageChoice, useT, type LanguageChoice } from '@/i18n';
import { studioHost, type HostDeveloper, type HostUpdateState } from '@/lib/host';
import { showWhatsNew } from '@/lib/whats-new';
import { usePreviewPrefs, writePreviewPref } from '@/lib/preview-prefs';
import { hasNotes } from '../WhatsNew';
import { useWebUpdate } from '../UpdateButton';
import { api, type StudioPrefs, type StudioVersion } from '@/api';
import { AgentsSection } from './AgentsSection';
import { DiagnosticsGroup } from './DiagnosticsGroup';
import { ModelsSection } from './ModelsSection';
import { SettingsSelect } from './SettingsSelect';
import { ShortcutsSection } from './ShortcutsSection';
import { SettingsButton, SettingsGroup, SettingsItem, SettingsPage, SettingsSegmented, SettingsSwitch } from './ui';
import { useThemeMode, type ThemeMode } from './theme';
import { AccountGroup } from './AccountGroup';
import { StorageGroup, StorageEntry } from './StorageGroup';
import { LargeDialog, LargeDialogGroup, LargeDialogPage, LargeDialogPlace, LargeDialogSearch } from '../LargeDialog';
import { LibraryCategoriesGroup } from './LibraryCategoriesGroup';

export type SettingsSection = 'general' | 'agents' | 'models' | 'developer' | 'shortcuts' | 'advanced';

/* the nav, in groups: what OpenFilm does, then help (Agents only inside an app with a chat: lib/host.ts `agents`;
   Advanced for what is already set for the best experience; Developer always, for its diagnostics). Read as it is
   shown: the app may give Studio its host after this module has run (a build split into several files) */
const navNow = (): Array<{ group: 'settings' | 'help'; sections: SettingsSection[] }> => [
  { group: 'settings', sections: ['general', ...(studioHost?.agents ? ['agents' as const] : []), 'models'] },
  { group: 'help', sections: ['shortcuts', 'advanced', 'developer'] },
];

/** where OpenFilm lives, linked at the foot of the nav */
const LINKS = [
  { label: 'settings.links.github', href: 'https://github.com/openfilm/openfilm' },
  { label: 'settings.links.examples', href: 'https://github.com/openfilm/examples' },
  { label: 'settings.links.site', href: 'https://openfilm.dev' },
];

const SECTION_ICON: Record<SettingsSection, React.ReactNode> = {
  general: <Settings2 size={18} strokeWidth={1.75} />,
  agents: <Bot size={18} strokeWidth={1.75} />,
  models: <Boxes size={18} strokeWidth={1.75} />,
  developer: <SquareTerminal size={18} strokeWidth={1.75} />,
  shortcuts: <Keyboard size={18} strokeWidth={1.75} />,
  advanced: <SlidersHorizontal size={18} strokeWidth={1.75} />,
};

/** what a search through each section reads: its name and every phrase it shows (Notifications only where it shows:
    inside an app that offers them, lib/host.ts `notifications`) */
const SECTION_WORDS: Record<SettingsSection, string | string[]> = {
  general: ['settings.account', 'settings.appearance'],
  agents: 'settings.agents',
  models: ['settings.models', 'settings.providers'],
  developer: ['settings.developer', 'settings.report'],
  shortcuts: 'settings.shortcuts',
  advanced: ['settings.advanced', ...(studioHost?.notifications ? ['settings.notifications'] : []), 'settings.versions', 'settings.playback', 'settings.libraryCategories'],
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
  const [section, setSectionNow] = React.useState<SettingsSection>('general');
  /* a page under General (Storage), opened from its row; any other section shown leaves it */
  const [sub, setSub] = React.useState<'storage' | null>(null);
  const setSection = (id: SettingsSection) => { setSectionNow(id); setSub(null); };
  const [query, setQuery] = React.useState('');
  const search = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { if (open) { setSectionNow(opening ?? 'general'); setSub(null); setQuery(''); } }, [open, opening]);

  /* the sections a search finds: by their names and by every phrase on them */
  const words = React.useMemo(() => Object.fromEntries((Object.keys(SECTION_WORDS) as SettingsSection[]).map((id) => [
    id, [t(`settings.sections.${id}`), ...[SECTION_WORDS[id]].flat().flatMap((under) => phrasesUnder(under, language))].join('\n').toLowerCase(),
  ])) as Record<SettingsSection, string>, [t, language]);
  const needle = query.trim().toLowerCase();
  const nav = navNow().map((group) => ({ ...group, sections: group.sections.filter((id) => !needle || words[id].includes(needle)) }))
    .filter((group) => group.sections.length > 0);
  const found = nav.flatMap((group) => group.sections);
  const showing: SettingsSection | null = found.includes(section) ? section : found[0] ?? null;

  if (!open) return null;

  return (
    <LargeDialog labelledBy="settings-title" label={t('settings.title')} closeLabel={t('settings.done')} onClose={onClose} focusFirst={search}
      side={(
        <>
          <LargeDialogSearch ref={search} value={query} onChange={setQuery} placeholder={t('settings.search')} />
          {nav.map((group) => (
            <LargeDialogGroup key={group.group} title={t(group.group === 'help' ? 'settings.groups.help' : 'settings.title')}>
              {group.sections.map((id) => (
                <LargeDialogPlace key={id} active={showing === id} onClick={() => setSection(id)} icon={SECTION_ICON[id]}>
                  {t(`settings.sections.${id}`)}
                </LargeDialogPlace>
              ))}
            </LargeDialogGroup>
          ))}
          {found.length === 0 ? <p className="px-2.5 pt-4 text-[14px] text-[var(--text-faint)]">{t('settings.noResults')}</p> : null}
          <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 px-2.5 pt-6 text-[13px] text-[var(--text-faint)]">
            {LINKS.map((link) => (
              <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="rounded-[4px] transition hover:text-[var(--text)]">{t(link.label)}</a>
            ))}
          </div>
        </>
      )}>
      {/* one column in the middle of whatever room the window gives */}
      <LargeDialogPage pageKey={`${showing ?? 'none'}${showing === 'general' && sub ? `/${sub}` : ''}`} titleId="settings-title"
        title={showing === 'general' && sub ? (
          /* a page under General: the way back to it, then its own name */
          <span className="flex items-center gap-1.5">
            <button type="button" onClick={() => setSub(null)} data-settings-back=""
              className="-ml-2 flex items-center gap-0.5 rounded-[8px] px-2 py-0.5 text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
              <ChevronLeft size={20} aria-hidden />{t('settings.sections.general')}
            </button>
            <span className="text-[var(--text-faint)]">/</span>
            {t('settings.storage.group')}
          </span>
        ) : showing ? t(`settings.sections.${showing}`) : undefined}>
        {showing === 'general' && (sub === 'storage' ? <StorageGroup titled={false} /> : <GeneralSection onStorage={() => setSub('storage')} />)}
        {showing === 'agents' && <AgentsSection />}
        {showing === 'models' && <ModelsSection />}
        {showing === 'developer' && <DeveloperSection />}
        {showing === 'shortcuts' && <ShortcutsSection />}
        {showing === 'advanced' && <AdvancedSection />}
      </LargeDialogPage>
    </LargeDialog>
  );
}

function GeneralSection({ onStorage }: { onStorage: () => void }) {
  const t = useT();
  const [mode, setMode] = useThemeMode();
  const [language, setLanguage] = useLanguageChoice();

  return (
    <SettingsPage>
      <AccountGroup />
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
      {/* what OpenFilm takes on this computer, and where its projects live: one row, its page a click away */}
      <SettingsGroup title={t('settings.storage.group')}>
        <StorageEntry onOpen={onStorage} />
      </SettingsGroup>
      {studioHost?.update?.onState ? <AppAboutGroup /> : <AboutGroup />}
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

/** What is already set for the best experience, for whoever wants it otherwise: versions saved on their own
 * (VersionsGroup), how the preview plays (PlaybackGroup), the library's categories (LibraryCategoriesGroup). */
function AdvancedSection() {
  const t = useT();
  return (
    <SettingsPage note={t('settings.advanced.intro')}>
      {studioHost?.notifications ? <NotificationsGroup /> : null}
      <VersionsGroup />
      <PlaybackGroup />
      <LibraryCategoriesGroup />
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
