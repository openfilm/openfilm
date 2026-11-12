/**
 * The library page (lib/library-page.ts): what is the person's beyond any one project, with the room to tend it.
 * Mine (lib/saved): their own media for every project, in the folders they make, uploaded or linked where it is kept;
 * the same pane as the assets drawer's, with a file picked shown beside it. Storage: where projects are kept and the
 * room they and their caches take (the same as Settings → General → Storage).
 *
 * In an app with tabs it is a tab like a project's: the title bar has the app menu and the tabs, and "+" opens the
 * projects window.
 */
import React from 'react';
import { ArrowLeft, HardDrive, Library } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import { SAVED, importIntoSaved, pickFromComputer, savedActions, savedSources, useSavedListing } from '@/lib/saved';
import type { WorkspaceResource } from '@/lib/workspace-resources';
import { AppMenu } from './AppMenu';
import { MediaPool } from './MediaPool';
import { ProjectTabs } from './ProjectTabs';
import tabStyles from './ProjectTabs.module.css';
import { ProjectsPopover } from './ProjectsLibrary';
import { SettingsModal, type SettingsSection } from './settings/SettingsModal';
import { StorageGroup } from './settings/StorageGroup';

type Section = 'mine' | 'storage';

export function LibraryPage() {
  const t = useT();
  const [section, setSection] = React.useState<Section>('mine');
  const listing = useSavedListing(section === 'mine');
  const [picked, setPicked] = React.useState<WorkspaceResource | null>(null);
  const [settings, setSettings] = React.useState<SettingsSection | null>(null);
  const [projectsOpen, setProjectsOpen] = React.useState(false);
  const tabs = studioHost?.tabs ?? null;
  /* the app's tab says what it is */
  React.useEffect(() => {
    document.title = t('libraryPage.title');
    studioHost?.tabs?.report({ title: t('libraryPage.title') });
  }, [t]);
  const tab = (id: Section, icon: React.ReactNode, label: string) => (
    <button type="button" onClick={() => setSection(id)} aria-pressed={section === id}
      className={`flex h-9 items-center gap-2 rounded-lg px-3 text-left text-[13px] ${section === id ? 'bg-[var(--bg-pressed)] font-medium text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}>
      {icon}{label}
    </button>
  );
  const url = picked ? savedSources.file(picked) : '';
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
        {tab('mine', <Library size={15} />, t('assetDrawer.mine'))}
        {tab('storage', <HardDrive size={15} />, t('libraryPage.storage'))}
      </nav>
      {section === 'mine' ? (
        <div className="flex min-h-0 min-w-0 flex-1">
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
          {/* the file picked, played */}
          <aside className="flex w-[340px] shrink-0 flex-col gap-3 border-l border-[var(--border)] p-4">
            {picked && url ? (
              <>
                <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-black">
                  {picked.kind === 'video' ? <video key={url} src={url} controls playsInline preload="metadata" className="h-full w-full object-contain" />
                    : picked.kind === 'image' ? <img src={url} alt="" className="max-h-full max-w-full" />
                      : picked.kind === 'audio' ? <audio key={url} src={url} controls preload="metadata" className="w-[92%]" /> : null}
                </div>
                <p className="break-words text-[13px] font-medium">{picked.name}</p>
                <p className="break-words text-[12px] text-[var(--text-muted)]">{picked.path.slice(SAVED.length + 1)}</p>
              </>
            ) : <p className="m-auto max-w-[26ch] text-center text-[12.5px] leading-relaxed text-[var(--text-faint)]">{t('libraryPage.pickHint')}</p>}
          </aside>
        </div>
      ) : (
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-10 py-8">
          <div className="max-w-[880px]"><StorageGroup /></div>
        </div>
      )}
      </div>
      <SettingsModal open={settings !== null} section={settings ?? undefined} onClose={() => setSettings(null)} />
      {tabs ? (
        <ProjectsPopover open={projectsOpen} currentProjectId="" onClose={() => setProjectsOpen(false)} onCurrentRemoved={() => {}}
          onOpen={(id) => { setProjectsOpen(false); tabs.open(id); }} />
      ) : null}
    </div>
  );
}
