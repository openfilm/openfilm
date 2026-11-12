/**
 * Asset management (lib/library-page.ts): everything of the person's beyond any one film, each kind where it is tended
 * with room, in one page.
 *
 * - Projects: the projects window itself, filling the page (open, make, import, folders, rename, cover, delete).
 * - Mine (lib/saved): their own media for every project, in the folders they make, uploaded or linked where it is
 *   kept; the file picked played beside it, with what it is.
 * - Favorites: what they starred in OpenFilm's library, every category together, to look over and unstar.
 * - Skills: the skills installed, starred and to discover (the same pane as the assets drawer's).
 * - Storage: where projects are kept, the room they and their caches take, and the cache cleared.
 *
 * In an app with tabs it is a tab like a project's: the title bar has the app menu and the tabs, and "+" opens the
 * projects window.
 */
import React from 'react';
import { ArrowLeft, Clapperboard, FolderOpen, HardDrive, Library, Star, StarOff, Zap } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import { libraryUrl, nameOf, posterUrl, toggleFavorite, useLibraryFavorites, useLibraryIndex, type LibraryCategory, type LibraryItem } from '@/lib/library';
import { SAVED, importIntoSaved, pickFromComputer, savedActions, savedSources, useSavedListing } from '@/lib/saved';
import { formatClipDuration, formatFileSize, type WorkspaceResource } from '@/lib/workspace-resources';
import { AppMenu } from './AppMenu';
import { MediaPool } from './MediaPool';
import { ProjectTabs } from './ProjectTabs';
import tabStyles from './ProjectTabs.module.css';
import { ProjectsPopover } from './ProjectsLibrary';
import { SkillsPane, type SkillsLine } from './library/SkillsPane';
import { SettingsModal, type SettingsSection } from './settings/SettingsModal';
import { StorageGroup } from './settings/StorageGroup';

type Section = 'projects' | 'mine' | 'favorites' | 'skills' | 'storage';
/** The section shown, kept while Studio is open. */
const SHOWN: { section: Section } = { section: 'mine' };
/** Favorites, by category in the drawer's order. */
const CATEGORIES: readonly LibraryCategory[] = ['template', 'sound', 'music', 'text', 'sticker', 'filter', 'effect', 'transition'];

export function LibraryPage() {
  const t = useT();
  const [section, setSectionState] = React.useState<Section>(SHOWN.section);
  const setSection = (next: Section) => { SHOWN.section = next; setSectionState(next); };
  const [settings, setSettings] = React.useState<SettingsSection | null>(null);
  const [projectsOpen, setProjectsOpen] = React.useState(false);
  const tabs = studioHost?.tabs ?? null;
  /* the app's tab says what it is */
  React.useEffect(() => {
    document.title = t('libraryPage.title');
    tabs?.report({ title: t('libraryPage.title') });
  }, [t, tabs]);
  /** A project opened from here: in its own tab, or this page goes to it. */
  const openProject = (id: string) => {
    if (tabs) { tabs.open(id); return; }
    history.pushState(null, '', `/projects/${id}${location.search}`);
    dispatchEvent(new PopStateEvent('popstate'));
  };
  const entry = (id: Section, icon: React.ReactNode, label: string) => (
    <button type="button" onClick={() => setSection(id)} aria-pressed={section === id} data-library-section={id}
      className={`flex h-9 items-center gap-2.5 rounded-lg px-3 text-left text-[13px] ${section === id ? 'bg-[var(--bg-pressed)] font-medium text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}>
      {icon}{label}
    </button>
  );
  return (
    <div className="workspace-shell flex h-full min-h-0 flex-col bg-[var(--bg-app)] text-[var(--text)]" data-library-page="">
      {tabs ? (
        <div data-titlebar className="relative flex h-8 min-w-0 shrink-0 items-center bg-[var(--bg-titlebar)] px-[6px]" onContextMenu={(e) => e.preventDefault()}>
          {/* the window's controls over this, then the app menu and the tabs, as on a project's page */}
          <div aria-hidden className={tabStyles.windowSpace} style={{ width: 'var(--titlebar-logo-x)' }} />
          <div className={tabStyles.system}><AppMenu onSettings={setSettings} /></div>
          <ProjectTabs onProjects={() => setProjectsOpen(true)} />
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[220px] shrink-0 flex-col gap-1 border-r border-[var(--border)] px-3 py-4" aria-label={t('libraryPage.title')}>
          <div className="mb-3 flex items-center gap-1.5 px-1">
            {/* in a browser, the way back to the project it came from */}
            {tabs ? null : (
              <button type="button" onClick={() => history.back()} aria-label={t('libraryPage.back')} title={t('libraryPage.back')}
                className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
                <ArrowLeft size={15} />
              </button>
            )}
            <h1 className="text-[15px] font-semibold">{t('libraryPage.title')}</h1>
          </div>
          {entry('projects', <Clapperboard size={15} />, t('libraryPage.projects'))}
          {entry('mine', <Library size={15} />, t('assetDrawer.mine'))}
          {entry('favorites', <Star size={15} />, t('assetDrawer.favorites'))}
          {entry('skills', <Zap size={15} />, t('assetDrawer.cat_skill'))}
          {entry('storage', <HardDrive size={15} />, t('libraryPage.storage'))}
        </nav>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {section === 'projects' ? (
            <ProjectsPopover inline open currentProjectId="" onOpen={openProject} onCurrentRemoved={() => {}} />
          ) : section === 'mine' ? <MineSection />
            : section === 'favorites' ? <FavoritesSection />
              : section === 'skills' ? <SkillsSection />
                : (
                  <div className="min-h-0 flex-1 overflow-y-auto px-10 py-8">
                    <div className="max-w-[880px]"><StorageGroup /></div>
                  </div>
                )}
        </main>
      </div>
      <SettingsModal open={settings !== null} section={settings ?? undefined} onClose={() => setSettings(null)} />
      {tabs ? (
        <ProjectsPopover open={projectsOpen} currentProjectId="" onClose={() => setProjectsOpen(false)} onCurrentRemoved={() => {}}
          onOpen={(id) => { setProjectsOpen(false); tabs.open(id); }} />
      ) : null}
    </div>
  );
}

/** Mine: the pane of the assets drawer, with room, and the file picked beside it. */
function MineSection() {
  const t = useT();
  const listing = useSavedListing(true);
  const [picked, setPicked] = React.useState<WorkspaceResource | null>(null);
  const url = picked ? savedSources.file(picked) : '';
  const facts = picked ? [
    picked.w && picked.h ? `${picked.w} × ${picked.h}` : null,
    picked.durationMs ? formatClipDuration(picked.durationMs) : null,
    formatFileSize(picked.size),
  ].filter(Boolean).join(' · ') : '';
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <MediaPool
          projectId={SAVED}
          listing={listing}
          sources={savedSources}
          selectedPath={picked?.path ?? null}
          onSelectFile={setPicked}
          onImport={(files, into, onProgress) => importIntoSaved(files, into, onProgress, t('assets.uploadFailed'))}
          onMove={savedActions.move}
          onDelete={savedActions.remove}
          onNewFolder={savedActions.newFolder}
          onReveal={savedActions.reveal}
          onPick={pickFromComputer}
          onBring={(paths, into, mode) => savedActions.bring(paths, into, mode)}
          scope="saved"
        />
      </div>
      {/* the file picked, played, and what it is */}
      <aside className="flex w-[340px] shrink-0 flex-col gap-3 border-l border-[var(--border)] p-4" data-library-details="">
        {picked && url ? (
          <>
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-black">
              {picked.kind === 'video' ? <video key={url} src={url} controls playsInline preload="metadata" className="h-full w-full object-contain" />
                : picked.kind === 'image' ? <img src={url} alt="" className="max-h-full max-w-full" />
                  : picked.kind === 'audio' ? <audio key={url} src={url} controls preload="metadata" className="w-[92%]" />
                    : picked.bundle ? <img src={savedSources.poster?.(picked) ?? ''} alt="" className="max-h-full max-w-full" /> : null}
            </div>
            <div>
              <p className="break-words text-[13px] font-medium">{picked.name}</p>
              {facts ? <p className="mt-1 text-[12px] tabular-nums text-[var(--text-muted)]">{facts}</p> : null}
            </div>
            <div>
              <p className="text-[11px] text-[var(--text-faint)]">{t('libraryPage.where')}</p>
              <p className="mt-1 break-words text-[12px] text-[var(--text)]">{[t('assetDrawer.mine'), ...picked.path.slice(SAVED.length + 1).split('/').slice(0, -1)].join(' / ')}</p>
              {picked.link ? <p className="mt-1 break-words text-[12px] text-[var(--text-muted)]">{t('libraryPage.linkedFrom').replace('{path}', picked.link.to)}</p> : null}
            </div>
            <button type="button" onClick={() => savedActions.reveal(picked.path)}
              className="flex w-fit items-center gap-1.5 rounded-md bg-[var(--bg-field)] px-2.5 py-2 text-[12px] hover:bg-[var(--bg-hover)]">
              <FolderOpen size={13} />{t('projects.revealFolder')}
            </button>
          </>
        ) : <p className="m-auto max-w-[26ch] text-center text-[12.5px] leading-relaxed text-[var(--text-faint)]">{t('libraryPage.pickHint')}</p>}
      </aside>
    </div>
  );
}

/** Favorites: what the person starred in OpenFilm's library, by category; a sound plays on a click; unstarred here. */
function FavoritesSection() {
  const t = useT();
  const lang = useLanguage();
  const index = useLibraryIndex(true);
  const favorites = useLibraryFavorites();
  const [playing, setPlaying] = React.useState<string | null>(null);
  const audio = React.useRef<HTMLAudioElement | null>(null);
  React.useEffect(() => () => audio.current?.pause(), []);
  const starred = new Set(favorites);
  const items = (index?.items ?? []).filter((item) => starred.has(item.id));
  const play = (item: LibraryItem) => {
    audio.current?.pause();
    if (playing === item.id) { setPlaying(null); return; }
    const sound = new Audio(libraryUrl(item.id));
    audio.current = sound;
    sound.onended = () => setPlaying(null);
    void sound.play().catch(() => setPlaying(null));
    setPlaying(item.id);
  };
  if (!index) return <div className="flex-1" />;
  if (!items.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <Star size={24} strokeWidth={1.5} className="text-[var(--text-faint)]" />
        <p className="text-[13.5px] font-medium text-[var(--text-muted)]">{t('libraryPage.noFavorites')}</p>
        <p className="max-w-[44ch] text-[12.5px] leading-relaxed text-[var(--text-faint)]">{t('libraryPage.noFavoritesBody')}</p>
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6" data-library-favorites="">
      {CATEGORIES.map((cat) => {
        const own = items.filter((item) => item.cat === cat);
        if (!own.length) return null;
        const sounding = cat === 'sound' || cat === 'music';
        return (
          <section key={cat} className="mb-8">
            <h2 className="mb-3 text-[13px] font-semibold text-[var(--text-muted)]">{t(`assetDrawer.cat_${cat}`)}<span className="ml-2 font-normal text-[var(--text-faint)]">{own.length}</span></h2>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              {own.map((item) => (
                <div key={item.id} className="group relative min-w-0" data-favorite={item.id}>
                  <button type="button" onClick={() => (sounding ? play(item) : undefined)} title={nameOf(item.name, lang)}
                    className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-[var(--bg-hover)] text-[12px] text-[var(--text-muted)]">
                    {sounding ? (playing === item.id ? t('assetDrawer.stop') : t('assetDrawer.play'))
                      : <img src={posterUrl(item)} alt="" loading="lazy" className="h-full w-full object-cover" />}
                  </button>
                  <p className="mt-1.5 truncate text-[12.5px] text-[var(--text)]">{nameOf(item.name, lang)}</p>
                  <button type="button" onClick={() => toggleFavorite(item.id)} aria-label={t('assetDrawer.unstar')} title={t('assetDrawer.unstar')}
                    className="absolute right-1.5 top-1.5 hidden h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white group-hover:flex">
                    <StarOff size={13} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Skills: installed, starred, to discover; a skill's page opens in place. */
function SkillsSection() {
  const t = useT();
  const [line, setLine] = React.useState<SkillsLine>('installed');
  const [opened, setOpened] = React.useState<string | null>(null);
  const lineButton = (id: SkillsLine, label: string) => (
    <button type="button" onClick={() => { setLine(id); setOpened(null); }} aria-pressed={line === id}
      className={`h-7 rounded-md px-3 text-[12.5px] ${line === id ? 'bg-[var(--bg-pressed)] font-medium text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'}`}>
      {label}
    </button>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-1 px-6 pb-2 pt-4">
        {lineButton('installed', t('assetDrawer.skillsInstalled'))}
        {lineButton('favorites', t('assetDrawer.favorites'))}
        {lineButton('discover', t('assetDrawer.skillsDiscover'))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-3">
        <SkillsPane line={line} query="" projectId={null} opened={opened} onOpen={setOpened} onDiscover={() => { setLine('discover'); setOpened(null); }} />
      </div>
    </div>
  );
}
