/**
 * The library as the desktop sidebar's page (lib/side-page): every folder the person keeps things in for all their
 * films, looked after here as a file manager is used. Its head has Import and New folder; under it the kinds of file as
 * pills with how many of each; then the files (the media pane as an explorer: where one is, back and up, the order, the
 * size of the tiles, a search), and at the right the one picked, large, with its facts.
 *
 * The chat's assets button is the same library at hand while making a film (dragged onto it, tried in the viewer); this
 * page is where it is kept in order. OpenFilm's own things and the Community's are on the Community's page.
 */
import * as React from 'react';
import { AudioLines, FileQuestion, FolderOpen, FolderPlus, Shapes, Upload, X } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import { relOf, useLibraryPlaces } from '@/lib/library-places';
import { openPlugins } from '@/lib/plugins-window';
import { readResourceView, RESOURCE_VIEW_KEY, type ResourceView } from '@/lib/resource-center';
import { importIntoSaved, savedActions, savedSources, useSavedListing } from '@/lib/saved';
import type { WorkspaceResource, WorkspaceResourceKind } from '@/lib/workspace-resources';
import { MediaPool, type ImportProgress, type MediaPoolCommands } from './MediaPool';
import { SidePage, SidePageButton } from './SidePage';

const PLACE_KEY = 'openfilm.library-page.place';
/* the kinds as the pills name them (the media pane's own words: media.filter_…) */
const KINDS: { id: 'all' | WorkspaceResourceKind; word: string }[] = [
  { id: 'all', word: 'all' }, { id: 'video', word: 'video' }, { id: 'image', word: 'image' }, { id: 'audio', word: 'audio' }, { id: 'mg', word: 'page' }, { id: 'other', word: 'other' },
];

async function pick(title: string, folder: boolean): Promise<string[] | 'no-dialog'> {
  if (folder && studioHost?.folders?.pick) { const path = await studioHost.folders.pick({ title }); return path ? [path] : []; }
  const res = await fetch(folder ? '/api/pick-folder' : '/api/pick-files', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
  if (res.status === 501) return 'no-dialog';
  if (!res.ok) return [];
  const answer = await res.json().catch(() => ({})) as { path?: unknown; paths?: unknown };
  return folder ? (typeof answer.path === 'string' ? [answer.path] : []) : Array.isArray(answer.paths) ? answer.paths.map(String) : [];
}

const sizeOf = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
const lengthOf = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function LibraryPage() {
  const t = useT();
  const { ready, folders } = useLibraryPlaces();
  const [place, setPlace] = React.useState<string | null>(() => { try { return localStorage.getItem(PLACE_KEY); } catch { return null; } });
  const current = folders.find(folder => folder.path === place) ?? folders[0] ?? null;
  const [at, setAt] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [kind, setKind] = React.useState<'all' | WorkspaceResourceKind>('all');
  const [display, setDisplay] = React.useState<ResourceView>(readResourceView);
  const [picked, setPicked] = React.useState<WorkspaceResource | null>(null);
  const commands = React.useRef<MediaPoolCommands | null>(null);
  const listing = useSavedListing(Boolean(current), true, { base: current ? relOf(current.path) : '', at, query });
  const onImport = React.useCallback((files: File[], into: string, onProgress: ImportProgress) => importIntoSaved(files, into, onProgress, t('assets.uploadFailed')), [t]);
  const choose = (path: string) => {
    setPlace(path); setAt(''); setQuery(''); setPicked(null);
    try { localStorage.setItem(PLACE_KEY, path); } catch { /* private window */ }
  };
  const show = (view: ResourceView) => { setDisplay(view); try { localStorage.setItem(RESOURCE_VIEW_KEY, view); } catch { /* private window */ } };
  /* how many of each kind are in the folder shown, and the folder with one kind alone when a pill is picked */
  const counts = React.useMemo(() => {
    const n: Record<string, number> = { all: 0 };
    for (const file of listing.ready ? listing.files : []) { n[file.kind] = (n[file.kind] ?? 0) + 1; n.all! += 1; }
    return n;
  }, [listing]);
  const shown = React.useMemo(() => (!listing.ready ? null : kind === 'all' ? listing
    : { ...listing, files: listing.files.filter(file => file.kind === kind), pages: kind === 'mg' ? listing.pages : [] }), [listing, kind]);
  /* the file picked is shown while it is still there (deleted or moved: the panel closes) */
  const inHand = picked && listing.ready && listing.files.some(file => file.path === picked.path) ? picked : null;

  return (
    <SidePage layout="manager" title={t('desktopNavigation.library')} note={t('desktopNavigation.libraryNote')}
      places={folders.map(folder => ({ id: folder.path, label: folder.name }))} place={current?.path ?? null} onPlace={choose}
      actions={<>
        <SidePageButton icon={<Shapes size={15} strokeWidth={1.7} />} data-library-community onClick={() => openPlugins({ line: 'assets' })}>{t('desktopNavigation.libraryCommunity')}</SidePageButton>
        <SidePageButton icon={<FolderPlus size={15} strokeWidth={1.7} />} disabled={!current} onClick={() => commands.current?.newFolder()}>{t('assets.newFolder')}</SidePageButton>
        <SidePageButton primary icon={<Upload size={15} strokeWidth={2} />} disabled={!current} data-library-import onClick={event => commands.current?.import(event.currentTarget)}>{t('desktopNavigation.libImport')}</SidePageButton>
      </>}
      data={{ 'data-library-page': '' }}>
      {current ? (
        <div className="flex min-h-0 min-w-0 flex-1 border-t border-[var(--frame-line)]">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div role="tablist" aria-label={t('media.filter')} className="flex shrink-0 gap-1.5 overflow-x-auto px-[var(--page-x)] pt-4 [scrollbar-width:none]">
              {KINDS.filter(item => item.id === 'all' || counts[item.id]).map(item => {
                const on = kind === item.id;
                return <button key={item.id} type="button" role="tab" aria-selected={on} data-library-kind={item.id} onClick={() => setKind(item.id)}
                  className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] transition-colors ${on ? 'bg-[var(--text)] font-medium text-[var(--bg-panel)]' : 'bg-[color-mix(in_srgb,var(--text)_6%,transparent)] text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
                  {t(`media.filter_${item.word}`)}<span className={`text-[12px] tabular-nums ${on ? 'opacity-60' : 'text-[var(--text-faint)]'}`}>{counts[item.id] ?? 0}</span>
                </button>;
              })}
            </div>
            {/* the media pane in the page's column, at the size of type it is drawn at in the drawer */}
            <div className="library-files flex min-h-0 flex-1 flex-col text-[12px]">
              <MediaPool
                key={current.path}
                projectId={current.path}
                rootName={current.name}
                scope="saved"
                listing={shown}
                sources={savedSources}
                selectedPath={inHand?.path ?? null}
                onSelectFile={setPicked}
                onFolderChange={setAt}
                onSearchChange={setQuery}
                onImport={onImport}
                onMove={savedActions.move}
                onDelete={savedActions.remove}
                onNewFolder={savedActions.newFolder}
                onReveal={savedActions.reveal}
                onPick={pick}
                onBring={(paths, into, mode) => savedActions.bring(paths, into, mode)}
                browser={{
                  explorer: { title: current.name, onUp: () => {}, canUp: at !== '' },
                  display: { value: display, onChange: show },
                  transfer: savedActions.transfer,
                  commands,
                }}
              />
            </div>
          </div>
          {inHand ? <Details file={inHand} onClose={() => setPicked(null)} /> : null}
        </div>
      ) : (
        <p role="status" className="px-[var(--page-x)] py-10 text-[13px] text-[var(--text-muted)]">{ready ? t('desktopNavigation.libraryEmpty') : ''}</p>
      )}
    </SidePage>
  );
}

/** The file picked, at the page's right: itself large (a picture, a video or a sound to play), its name, its facts. */
function Details({ file, onClose }: { file: WorkspaceResource; onClose: () => void }) {
  const t = useT();
  const language = useLanguage();
  const src = savedSources.file(file);
  const poster = savedSources.poster?.(file) ?? savedSources.pagePoster?.(file);
  const word = file.kind === 'mg' ? 'page' : file.kind;
  const facts: [string, string][] = [
    [t('desktopNavigation.libKind'), `${t(`media.filter_${word}`)}${file.name.includes('.') ? ` · ${file.name.split('.').pop()!.toUpperCase()}` : ''}`],
    ...(file.w && file.h ? [[t('desktopNavigation.libDimensions'), `${file.w} × ${file.h}`] as [string, string]] : []),
    ...(file.durationMs ? [[t('desktopNavigation.libDuration'), lengthOf(file.durationMs)] as [string, string]] : []),
    [t('desktopNavigation.libSize'), sizeOf(file.size)],
    [t('desktopNavigation.libModified'), new Date(file.mtimeMs).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' })],
    [t('desktopNavigation.libWhere'), file.dir || '/'],
  ];
  return (
    <aside data-library-details aria-label={t('desktopNavigation.libDetails')} className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-[var(--frame-line)] px-5 pb-6 pt-4">
      <div className="mb-3 flex items-center">
        <h2 className="flex-1 text-[13px] text-[var(--text-muted)]">{t('desktopNavigation.libDetails')}</h2>
        <button type="button" aria-label={t('switcher.close')} onClick={onClose}
          className="-mr-1.5 grid h-7 w-7 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"><X size={15} aria-hidden /></button>
      </div>
      <div className="grid aspect-[4/3] w-full shrink-0 place-items-center overflow-hidden rounded-[12px] bg-[color-mix(in_srgb,var(--text)_5%,transparent)]">
        {file.kind === 'video' ? <video key={src} src={src} poster={poster} controls className="h-full w-full object-contain" />
          : file.kind === 'image' ? <img key={src} src={src} alt="" className="h-full w-full object-contain" />
          : file.kind === 'audio' ? <div className="flex w-full flex-col items-center gap-4 px-4 text-[var(--text-muted)]"><AudioLines size={34} strokeWidth={1.4} aria-hidden /><audio key={src} src={src} controls className="w-full" /></div>
          : poster ? <img key={poster} src={poster} alt="" className="h-full w-full object-contain" />
          : <FileQuestion size={34} strokeWidth={1.4} className="text-[var(--text-faint)]" aria-hidden />}
      </div>
      <h3 className="mt-4 break-words text-[15px] font-semibold leading-[21px]">{file.name}</h3>
      <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2.5 text-[12.5px] leading-[18px]">
        {facts.map(([name, value]) => <React.Fragment key={name}>
          <dt className="text-[var(--text-faint)]">{name}</dt>
          <dd className="break-words text-right text-[var(--text)]">{value}</dd>
        </React.Fragment>)}
      </dl>
      <button type="button" onClick={() => savedActions.reveal(file.path)}
        className="mt-6 flex h-9 items-center justify-center gap-2 rounded-full bg-[color-mix(in_srgb,var(--text)_7%,transparent)] text-[13px] font-medium hover:bg-[color-mix(in_srgb,var(--text)_11%,transparent)]">
        <FolderOpen size={15} strokeWidth={1.7} aria-hidden />{t('exportTray.reveal')}
      </button>
    </aside>
  );
}
