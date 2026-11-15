/** The personal library in the resource center. The editor and this window share Saved and the same MediaPool. */
import React from 'react';
import {
  ArrowLeft,
  Folder,
  House,
  Monitor,
  Pin,
  Clock3,
  Clapperboard,
  FolderPlus,
  Folders,
  LibraryBig,
  Loader2,
  Maximize2,
  Plus,
  PanelRight,
  Star,
  Unplug,
  X,
} from 'lucide-react';
import { useT } from '@/i18n';
import { assetLibrary, type AssetUse } from '@/lib/asset-library';
import {
  importIntoSaved,
  pickFromComputer,
  refreshSaved,
  SAVED,
  savedActions,
  savedSources,
  useSavedRevision,
} from '@/lib/saved';
import {
  formatClipDuration,
  formatFileSize,
  type WorkspaceResource,
  type MediaListing,
  type MediaLink,
} from '@/lib/workspace-resources';
import type { ProjectFolder } from '@/lib/project-folders';
import { ConfirmDialog } from './ConfirmDialog';
import { pinKey, type ResourcePinActions, type ResourceLibraryData, ResourceNavigation, ResourceAssetLocation, ResourceView } from '@/lib/resource-center';
import { MediaPool } from './MediaPool';
import { MediaPreview } from './MediaPreview';
import { SourcePreview } from './SourcePreview';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import type { LibraryProject } from './ProjectsView';
import shared from './ProjectsView.module.css';
import styles from './AssetLibraryView.module.css';


export function AssetLibraryView({
  projects,
  history,
  onMove,
  pins, onPin, onUnpin, onProjects, folders, onFolder,
  currentProjectId,
  library,
  navigation,
  onNavigate,
  onNewCollection,
  display,
  onDisplay,
  onClose,
  onOpenProject,
  onInsert,
}: {
  projects: LibraryProject[];
  onMove: typeof savedActions.move;
  history: { canBack: boolean; canForward: boolean; go: (step: number) => void };
  pins: ResourcePinActions['pins'];
  onPin: ResourcePinActions['onPin'];
  onUnpin: ResourcePinActions['onUnpin'];
  onProjects: (folderId?: string | null) => void;
  folders: ProjectFolder[];
  onFolder: (path: string) => void;
  currentProjectId: string;
  library: ResourceLibraryData;
  navigation: ResourceNavigation;
  onNavigate: (location: ResourceAssetLocation) => void;
  onNewCollection: (paths: string[]) => void;
  display: ResourceView;
  onDisplay: (view: ResourceView) => void;
  onClose?: () => void;
  onOpenProject: (id: string) => void;
  onInsert?: (file: WorkspaceResource) => void;
}) {
  const t = useT();
  const { listing, catalog, error } = library;
  const view = navigation.location;
  const revision = useSavedRevision();
  const [folder, setFolder] = React.useState({ path: '', seq: 0 });
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [selection, setSelection] = React.useState<WorkspaceResource[]>([]);
  const [detailsClosed, setDetailsClosed] = React.useState(false);
  const [pendingCollection, setPendingCollection] = React.useState<string | null>(null);
  const selectionChanged = React.useCallback((files: WorkspaceResource[]) => { setSelection(files); }, []);
  const [target, setTarget] = React.useState(currentProjectId || projects.find((p) => !p.missing)?.id || '');
  const [mode, setMode] = React.useState<'copy' | 'link'>('copy');
  const [usage, setUsage] = React.useState<AssetUse[]>([]);
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  const [preview, setPreview] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const previewWasOpen = React.useRef(false);
  const files = listing?.files ?? [];
  const primary = selectedPath ?? (selection.length > 1 ? selection.at(-1)?.path : null);
  const selected = files.find((file) => file.path === primary) ?? null;
  const connections = React.useMemo(
    () => Object.entries(listing?.linkedDirs ?? {}).sort((a, b) => a[0].localeCompare(b[0])),
    [listing],
  );
  const sourceOf = React.useCallback(
    (path: string): [string, MediaLink] | undefined =>
      connections
        .filter(([root]) => path === `${SAVED}/${root}` || path.startsWith(`${SAVED}/${root}/`))
        .sort((a, b) => b[0].length - a[0].length)[0],
    [connections],
  );
  const unavailable = (file: WorkspaceResource) => Boolean(file.link?.missing || sourceOf(file.path)?.[1].missing);
  const currentCollection = view.startsWith('collection:')
    ? catalog.collections.find((c) => c.id === view.slice(11))
    : undefined;
  const location = view.startsWith('location:') ? view.slice(9) : null;
  const currentUse = usage.find((use) => use.id === target);
  const many = selection.length > 1;
  const toAdd = many ? selection : selected ? [selected] : [];
  const alreadyAdded = !many && Boolean(currentUse?.present);
  const blocked = toAdd.some(unavailable);

  React.useEffect(() => {
    if (!target && projects.length)
      setTarget(currentProjectId || projects.find((project) => !project.missing)?.id || '');
  }, [target, projects, currentProjectId]);
  React.useEffect(() => {
    if (!selectedPath) {
      setUsage([]);
      return;
    }
    let alive = true;
    setUsage([]);
    void assetLibrary.usage(selectedPath).then(
      (value) => {
        if (alive) setUsage(value);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [selectedPath, revision]);
  React.useEffect(() => {
    if (preview && !selected) setPreview(false);
  }, [preview, selected]);
  React.useEffect(() => {
    const returning = previewWasOpen.current && !preview;
    previewWasOpen.current = preview;
    if (!returning || !primary) return;
    const frame = requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(`[data-media-path="${CSS.escape(primary)}"]`)?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [preview, primary]);
  React.useEffect(() => {
    if (currentCollection || !view.startsWith('collection:')) return;
    onNavigate('all');
  }, [catalog.collections, currentCollection, view, onNavigate]);

  const run = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('assetLibrary.failed'));
    }
  };
  React.useEffect(() => {
    const next = navigation.location;
    setSelectedPath(null); setSelection([]); setNotice('');
    setFolder(old => ({ path: next.startsWith('location:') ? next.slice(9) : '', seq: old.seq + 1 }));
    const frame = requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('[data-browser-scroll]')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [navigation.seq]);
  const filtered = React.useMemo<MediaListing | null>(() => {
    if (!listing) return null;
    const include = (file: WorkspaceResource) =>
      view === 'starred'
        ? catalog.items[file.path]?.starred
        : view === 'offline'
        ? unavailable(file)
        : currentCollection
        ? catalog.items[file.path]?.collections.includes(currentCollection.id)
        : view === 'managed'
        ? !sourceOf(file.path) && !file.link
        : true;
    return {
      ...listing,
      files: listing.files.filter(include),
      dirs: listing.dirs,
      pages: [],
    };
  }, [listing, catalog.items, view, currentCollection, location, sourceOf]);

  React.useEffect(() => {
    if (selectedPath && filtered && !filtered.files.some((file) => file.path === selectedPath)) setSelectedPath(null);
  }, [filtered, selectedPath]);

  const organizeMenu = (picked: WorkspaceResource[]): ContextMenuEntry[] => {
    if (!picked.length) return [];
    const selectedPaths = picked.map((file) => file.path);
    const starred = picked.every((file) => catalog.items[file.path]?.starred);
    return [
      {
        id: 'star',
        icon: <Star size={14} />,
        label: t(starred ? 'assetLibrary.unstar' : 'assetLibrary.star'),
        onSelect: () => void run(() => assetLibrary.star(selectedPaths, !starred)),
      },
      {
        id: 'collection',
        icon: <FolderPlus size={14} />,
        label: t('assetLibrary.addToCollection'),
        submenu: [
          ...catalog.collections.map((collection) => ({
            id: collection.id,
            label: collection.name,
            onSelect: () => void run(() => assetLibrary.collect(selectedPaths, collection.id)),
          })),
          {
            id: 'new',
            label: t('assetLibrary.newCollection'),
            onSelect: () => {
              onNewCollection(picked.map(file => file.path));
            },
          },
        ],
      },
      ...(currentCollection
        ? [
            {
              id: 'remove-from-collection',
              label: t('assetLibrary.removeFromCollection'),
              onSelect: () => void run(() => assetLibrary.collect(selectedPaths, currentCollection.id, false)),
            },
          ]
        : []),
      { id: 'organization-separator', separator: true },
    ];
  };
  const add = async () => {
    if (!selected || !target || blocked) return;
    setBusy(true);
    try {
      for (const file of toAdd) await assetLibrary.add(target, file.path, file.bundle ? 'copy' : mode);
      setUsage(await assetLibrary.usage(selected.path));
      setNotice(t(many ? 'assetLibrary.addedMany' : 'assetLibrary.added').replace('{n}', String(toAdd.length)).replace('{name}', projects.find((p) => p.id === target)?.name ?? ''));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('assetLibrary.failed'));
    } finally {
      setBusy(false);
    }
  };
  const title = currentCollection?.name ?? (view === 'home' || view === 'computer' ? t(`resourceCenter.${view}`) : view === 'all' || view === 'managed' || location ? t('saved.title') : t(`assetLibrary.${view}`));
  const physical = view === 'all' || view === 'managed' || Boolean(location);
  const folderPinMenu = (path: string): ContextMenuEntry[] => { const pin = { kind: 'assets' as const, path }; const pinned = pins.some(p => pinKey(p) === pinKey(pin)); return [{ id: 'pin-folder', icon: <Pin size={14} />, label: t(pinned ? 'resourceCenter.unpin' : 'resourceCenter.pin'), onSelect: () => pinned ? onUnpin(pin) : onPin(pin) }]; };
  const selectFile = React.useCallback((file: WorkspaceResource | null) => {
    setSelectedPath(file?.path ?? null);
  }, []);
  const protect = (path: string) => Boolean(sourceOf(path) || files.find((file) => file.path === path)?.link);
  const panel = (file: WorkspaceResource, enlarged = false) => {
    if (unavailable(file))
      return (
        <div className={styles.offline}>
          <Unplug size={25} />
          <span>{t('assetLibrary.sourceOffline')}</span>
        </div>
      );
    if (enlarged) return <SourcePreview file={file} sources={savedSources} onClose={() => setPreview(false)} withinDialog />;
    return (
      <div className="absolute inset-0">
        <MediaPreview file={file} sources={savedSources} />
      </div>
    );
  };
  return (
    <div ref={rootRef} className={shared.browser} data-asset-library="" onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); }}>
      <div className={shared.body}>
        <main className={shared.main}>
          {notice || error ? (
            <div role={error ? 'alert' : 'status'} className={styles.notice}>
              <span>{notice || t('assetLibrary.loadFailed')}</span>
              <button
                type="button"
                className={shared.action}
                onClick={() => {
                  setNotice('');
                  refreshSaved();
                }}
              >
                {t(error ? 'projects.loadRetry' : 'media.dismiss')}
              </button>
            </div>
          ) : null}
          <div className={styles.workspace} data-details={!detailsClosed && view !== 'home' && view !== 'computer'}>
            <div className={styles.browser}>
              <MediaPool
                projectId="resource-center"
                listing={filtered}
                sources={savedSources}
                selectedPath={selectedPath}
                onSelectFile={selectFile}
                onImport={(picked, into, progress) => importIntoSaved(picked, into, progress, t('assets.uploadFailed'))}
                onMove={onMove}
                onDelete={savedActions.remove}
                onNewFolder={savedActions.newFolder}
                onReveal={savedActions.reveal}
                onPick={pickFromComputer}
                onBring={savedActions.bring}
                scope="saved"
                browser={{
                  flat: !physical,
                  explorer: {
                    history,
                    title, icon: view === 'home' ? <House size={15} /> : view === 'computer' ? <Monitor size={15} /> : undefined,
                    onUp: () => onNavigate(view === 'home' || physical ? 'computer' : 'home'),
                    canUp: view !== 'computer',
                    hideItems: view === 'computer',
                    tools: <><button type="button" className={shared.iconButton} data-explorer-command="" aria-label={t('assetLibrary.addToCollection')} title={t('assetLibrary.addToCollection')} disabled={!selection.length} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); const entry = organizeMenu(selection).find(item => !('separator' in item) && item.id === 'collection'); setMenu({ x: rect.left, y: rect.bottom, items: entry && 'submenu' in entry ? [...(entry.submenu ?? [])] : [] }); }}><Folders size={15} /></button><button type="button" className={shared.iconButton} aria-label={t('assetLibrary.details')} title={t('assetLibrary.details')} aria-pressed={!detailsClosed} onClick={() => setDetailsClosed(value => !value)}><PanelRight size={16} /></button>{onClose ? <button type="button" className={shared.iconButton} aria-label={t('project.close')} onClick={onClose}><X size={17} /></button> : null}</>,
                    leading: view === 'home' || view === 'computer' ? <div className={styles.home} data-resource-home="">
                      <details open><summary>{t(view === 'home' ? 'resourceCenter.quickAccess' : 'assetLibrary.locations')}</summary><div className={styles.quickGrid}>
                        {(view === 'home' ? pins : [{ kind: 'projects' as const, folderId: null }, { kind: 'assets' as const, path: '' }, ...connections.map(([path]) => ({ kind: 'assets' as const, path }))]).map(pin => <button key={pinKey(pin)} type="button" onDoubleClick={() => pin.kind === 'projects' ? onProjects(pin.folderId) : onNavigate(pin.path ? `location:${pin.path}` : 'all')} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); pin.kind === 'projects' ? onProjects(pin.folderId) : onNavigate(pin.path ? `location:${pin.path}` : 'all'); } }} onContextMenu={e => { e.preventDefault(); const pinned = pins.some(p => pinKey(p) === pinKey(pin)); setMenu({ x: e.clientX, y: e.clientY, items: [{ id: 'open', label: t('projectMenu.open'), onSelect: () => pin.kind === 'projects' ? onProjects(pin.folderId) : onNavigate(pin.path ? `location:${pin.path}` : 'all') }, { id: 'pin', label: t(pinned ? 'resourceCenter.unpin' : 'resourceCenter.pin'), onSelect: () => pinned ? onUnpin(pin) : onPin(pin) }] }); }}>
                          {pin.kind === 'assets' && !pin.path ? <LibraryBig size={28} strokeWidth={1.5} /> : <Folder size={30} strokeWidth={1.4} />}<span><strong>{pin.kind === 'projects' ? pin.folderId ? folders.find(f => f.id === pin.folderId)?.name ?? t('resourceCenter.unavailable') : t('resourceCenter.projects') : pin.path.split('/').at(-1) || t('saved.title')}</strong><small>{pin.kind === 'assets' && pin.path ? pin.path : t('resourceCenter.computer')}</small></span>{view === 'home' ? <Pin size={11} /> : null}
                        </button>)}
                      </div></details>
                      {view === 'home' ? <>
                        <details open><summary>{t('assetLibrary.collections')}</summary><div className={styles.collectionGrid}>{catalog.collections.map(collection => <button type="button" key={collection.id} onClick={() => onNavigate(`collection:${collection.id}`)} onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items: [{ id: 'delete-collection', label: t('assetLibrary.deleteCollection'), onSelect: () => setPendingCollection(collection.id) }] }); }}><Folder size={18} /><span>{collection.name}</span></button>)}<button type="button" onClick={() => onNewCollection([])}><FolderPlus size={17} /><span>{t('assetLibrary.newCollection')}</span></button></div></details>
                        <div className={styles.homeRecent}><h3><Clock3 size={14} />{t('resourceCenter.recentFiles')}</h3><button type="button" onClick={() => onNavigate('starred')}><Star size={13} />{t('assetLibrary.starred')}</button>{files.some(unavailable) ? <button type="button" onClick={() => onNavigate('offline')}><Unplug size={13} />{t('assetLibrary.offline')}</button> : null}</div>
                      </> : null}
                    </div> : undefined,
                  },
                  folderMenu: physical ? folderPinMenu : undefined,
                  recent: view === 'recent' || view === 'home',
                  display: { value: display, onChange: onDisplay },
                  starred: file => Boolean(catalog.items[file.path]?.starred),
                  ...(currentCollection || view === 'starred' || view === 'offline' ? { empty: {
                    title: t(currentCollection ? 'assetLibrary.emptyCollection' : view === 'starred' ? 'assetLibrary.emptyStarred' : 'assetLibrary.emptyOffline'),
                    body: t(currentCollection ? 'assetLibrary.emptyCollectionHint' : view === 'starred' ? 'assetLibrary.emptyStarredHint' : 'assetLibrary.emptyOfflineHint'),
                    canImport: false,
                  } } : {}),
                  onOpen: (file) => { setSelectedPath(file.path); setPreview(true); },
                  folder,
                  onFolder: physical ? onFolder : undefined,
                  onSelection: selectionChanged,
                  protectedPath: protect,
                  menu: organizeMenu,
                  badge: (file) =>
                    `${
                      file.bundle
                        ? t(`saved.kind_${file.bundle.kind}`)
                        : file.path.split('.').at(-1)?.toUpperCase() ?? ''
                    }`,
                }}
              />
            </div>
            {!selected && !detailsClosed && view !== 'home' && view !== 'computer' ? <aside className={`${styles.inspector} ${styles.emptyInspector}`} aria-label={t('assetLibrary.details')}><div className={styles.emptyDetailIcon}><LibraryBig size={22} strokeWidth={1.4} /></div><h3>{t('assetLibrary.details')}</h3><p>{t('assetLibrary.selectHint')}</p></aside> : null}
            {selected && !detailsClosed && view !== 'computer' ? (
              <aside className={styles.inspector} aria-label={t('assetLibrary.details')}>
                <div className={styles.detailHeading}>
                  <h3>{many ? t('library.selectedCount').replace('{n}', String(selection.length)) : selected.name}</h3>
                  <button
                    type="button"
                    className={shared.iconButton}
                    aria-label={t('assetLibrary.closeDetails')}
                    onClick={() => setDetailsClosed(true)}
                  >
                    <X size={14} />
                  </button>
                </div>
                {many ? (
                  <div className={styles.batchNames}>
                    {selection.slice(0, 100).map(file => <div key={file.path} title={file.path}>{file.name}</div>)}
                    <p className={styles.muted}>{t('assetLibrary.size')}: {formatFileSize(selection.reduce((total, file) => total + file.size, 0))}</p>
                  </div>
                ) : <>
                <button
                  type="button"
                  className={styles.preview}
                  aria-label={t('assetLibrary.preview')}
                  onClick={() => setPreview(true)}
                >
                  {panel(selected)}
                  <span className={styles.expandPreview}><Maximize2 size={13} /></span>
                </button>
                <div className={styles.assetTools}>
                <button
                  type="button"
                  className={styles.starAction}
                  data-starred={Boolean(catalog.items[selected.path]?.starred)}
                  onClick={() =>
                    void run(() => assetLibrary.star([selected.path], !catalog.items[selected.path]?.starred))
                  }
                >
                  <Star size={14} fill={catalog.items[selected.path]?.starred ? 'currentColor' : 'none'} />
                  {t(catalog.items[selected.path]?.starred ? 'assetLibrary.unstar' : 'assetLibrary.star')}
                </button>
                <span className={styles.fileType}>{selected.bundle ? t(`saved.kind_${selected.bundle.kind}`) : selected.path.split('.').at(-1)?.toUpperCase()}</span>
                </div>
                <dl>
                  <dt>{t('assetLibrary.location')}</dt>
                  <dd>
                    {selected.link?.to ??
                      sourceOf(selected.path)?.[1].to ??
                      (selected.dir || t('assetLibrary.managed'))}
                  </dd>
                  <dt>{t('assetLibrary.status')}</dt>
                  <dd>
                    {t(
                      unavailable(selected)
                        ? 'assetLibrary.sourceOffline'
                        : sourceOf(selected.path) || selected.link
                        ? 'assetLibrary.referenced'
                        : 'assetLibrary.inLibrary',
                    )}
                  </dd>
                  <dt>{t('assetLibrary.size')}</dt>
                  <dd>{formatFileSize(selected.size)}</dd>
                  {selected.durationMs ? (
                    <>
                      <dt>{t('assetLibrary.duration')}</dt>
                      <dd>{formatClipDuration(selected.durationMs)}</dd>
                    </>
                  ) : null}
                </dl>
                <h4>{t('assetLibrary.usedIn')}</h4>
                {usage.length ? (
                  usage.map((use) => (
                    <button type="button" key={use.id} className={styles.usage} onClick={() => onOpenProject(use.id)}>
                      <span>{use.name}</span>
                      <small>
                        {t(use.uses ? 'assetLibrary.timelineUses' : 'assetLibrary.addedNotUsed').replace(
                          '{n}',
                          String(use.uses),
                        )}
                      </small>
                    </button>
                  ))
                ) : (
                  <p className={styles.muted}>{t('assetLibrary.noKnownUse')}</p>
                )}
                </>}
                <div className={styles.addActions}>
                  <label>
                    {t('assetLibrary.target')}
                    <select
                      aria-label={t('assetLibrary.target')}
                      value={target}
                      onChange={(event) => setTarget(event.target.value)}
                    >
                      <option value="">{t('assetLibrary.chooseProject')}</option>
                      {projects
                        .filter((project) => !project.missing)
                        .map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  {toAdd.some(file => !file.bundle) ? (
                    <label>
                      {t('assetLibrary.useMode')}
                      <select
                        aria-label={t('assetLibrary.useMode')}
                        disabled={alreadyAdded}
                        value={currentUse?.mode ?? mode}
                        onChange={(event) => setMode(event.target.value as 'copy' | 'link')}
                      >
                        <option value="copy">{t('assetLibrary.copy')}</option>
                        <option value="link">{t('assetLibrary.reference')}</option>
                      </select>
                    </label>
                  ) : (
                    <p className={styles.muted}>{t('assetLibrary.bundleCopy')}</p>
                  )}
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={busy || !target || blocked || alreadyAdded}
                    onClick={() => void add()}
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    {t(many ? 'assetLibrary.addMany' : alreadyAdded ? 'assetLibrary.alreadyAdded' : 'assetLibrary.addProject').replace('{n}', String(toAdd.length))}
                  </button>
                  {onInsert && !many && target === currentProjectId && selected.kind !== 'other' ? (
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={busy || (unavailable(selected) && !alreadyAdded)}
                      onClick={() =>
                        void run(async () => {
                          setBusy(true);
                          try {
                            await assetLibrary.add(target, selected.path, selected.bundle ? 'copy' : mode);
                            onInsert(selected);
                          } finally {
                            setBusy(false);
                          }
                        })
                      }
                    >
                      <Clapperboard size={14} />{t('assetLibrary.insertTimeline')}
                    </button>
                  ) : null}
                </div>
              </aside>
            ) : null}
          </div>
          <footer className={shared.status} aria-live="polite">
            <span>{t('assetLibrary.itemCount').replace('{n}', String(filtered?.files.length ?? 0))}</span>{selection.length ? <span>{t('library.selectedCount').replace('{n}', String(selection.length))}</span> : null}
            <span>{t('assetLibrary.collectionHint')}</span>
          </footer>
        </main>
      </div>
      <ConfirmDialog open={Boolean(pendingCollection)} title={t('assetLibrary.deleteCollection')} description={t('assetLibrary.deleteCollectionHint')} confirmLabel={t('assetLibrary.deleteCollection')} cancelLabel={t('confirm.cancel')} onCancel={() => setPendingCollection(null)} onConfirm={() => { if (pendingCollection) void run(() => assetLibrary.removeCollection(pendingCollection)); setPendingCollection(null); }} />
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
      {preview && selected ? (
        <div
          className={styles.previewOverlay}
          role="dialog"
          aria-modal="true"
          aria-label={t('assetLibrary.preview')}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.defaultPrevented) {
              event.preventDefault();
              event.stopPropagation();
              setPreview(false);
            }
          }}
        >
          <div className={styles.previewHeader}>
            <button type="button" className={shared.action} autoFocus onClick={() => setPreview(false)}>
              <ArrowLeft size={15} />
              {t('assetLibrary.back')}
            </button>
            <span>{selected.name}</span>
          </div>
          <div className={styles.largePreview}>{panel(selected, true)}</div>
        </div>
      ) : null}
    </div>
  );
}
