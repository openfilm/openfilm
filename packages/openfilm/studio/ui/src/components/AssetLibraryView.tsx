/** The personal library in the resource center. The editor and this window share Saved and the same MediaPool. */
import React from 'react';
import {
  ArrowLeft,
  Clapperboard,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Library,
  Loader2,
  Maximize2,
  MoreHorizontal,
  Plus,
  PanelRight,
  Star,
  Trash2,
  Unplug,
  X,
} from 'lucide-react';
import { useT } from '@/i18n';
import { assetLibrary, useAssetCatalog, type AssetUse } from '@/lib/asset-library';
import {
  importIntoSaved,
  pickFromComputer,
  refreshSaved,
  SAVED,
  savedActions,
  savedSources,
  useSavedListing,
  useSavedRevision,
} from '@/lib/saved';
import {
  formatClipDuration,
  formatFileSize,
  type WorkspaceResource,
  type MediaListing,
  type MediaLink,
} from '@/lib/workspace-resources';
import { readResourceDragData } from '@/lib/resource-drag';
import { MediaPool } from './MediaPool';
import { MediaPreview } from './MediaPreview';
import { SourcePreview } from './SourcePreview';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { ProjectsStorage } from './ProjectsStorage';
import { ResourceCenterBrand } from './ResourceCenterBrand';
import type { LibraryProject } from './ProjectsView';
import shared from './ProjectsView.module.css';
import styles from './AssetLibraryView.module.css';

type View = 'all' | 'recent' | 'starred' | 'offline' | 'managed' | `collection:${string}` | `location:${string}`;

export function AssetLibraryView({
  projects,
  currentProjectId,
  onProjects,
  onExamples,
  onClose,
  onOpenProject,
  onInsert,
}: {
  projects: LibraryProject[];
  currentProjectId: string;
  onProjects: () => void;
  onExamples: () => void;
  onClose?: () => void;
  onOpenProject: (id: string) => void;
  onInsert?: (file: WorkspaceResource) => void;
}) {
  const t = useT();
  const listing = useSavedListing(true);
  const revision = useSavedRevision();
  const { catalog, error } = useAssetCatalog();
  const [view, setView] = React.useState<View>('all');
  const [folder, setFolder] = React.useState({ path: '', seq: 0 });
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [selection, setSelection] = React.useState<WorkspaceResource[]>([]);
  const [detailsClosed, setDetailsClosed] = React.useState(false);
  const selectionChanged = React.useCallback((files: WorkspaceResource[]) => { setSelection(files); }, []);
  const [target, setTarget] = React.useState(currentProjectId || projects.find((p) => !p.missing)?.id || '');
  const [mode, setMode] = React.useState<'copy' | 'link'>('copy');
  const [usage, setUsage] = React.useState<AssetUse[]>([]);
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [naming, setNaming] = React.useState(false);
  const [name, setName] = React.useState('');
  const [pendingLocation, setPendingLocation] = React.useState<string | null>(null);
  const [pendingCollection, setPendingCollection] = React.useState<string | null>(null);
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
  const paths = selection.map((file) => file.path);
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
    setView('all');
  }, [catalog.collections, currentCollection, view]);

  const run = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('assetLibrary.failed'));
    }
  };
  const navigate = (next: View) => {
    setView(next);
    setSelectedPath(null);
    setSelection([]);
    setNotice('');
    setFolder((old) => ({ path: next.startsWith('location:') ? next.slice(9) : '', seq: old.seq + 1 }));
  };
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
        : location
        ? file.path.startsWith(`${SAVED}/${location}/`)
        : true;
    return {
      ...listing,
      files: listing.files.filter(include),
      dirs: location
        ? listing.dirs.filter((dir) => dir === location || dir.startsWith(`${location}/`))
        : listing.dirs.filter((dir) => !connections.some(([path]) => dir === path || dir.startsWith(`${path}/`))),
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
              setSelection(picked);
              setNaming(true);
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
  const connect = async () => {
    setBusy(true);
    try {
      const picked = await pickFromComputer(t('assetLibrary.connectFolder'), true);
      if (picked === 'no-dialog') {
        setNotice(t('media.noDialog'));
        return;
      }
      if (!picked.length) return;
      await savedActions.bring(picked, SAVED, 'link');
      setNotice(t('assetLibrary.connected'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('assetLibrary.failed'));
    } finally {
      setBusy(false);
    }
  };
  const reconnect = async (path: string) => {
    const picked = await pickFromComputer(t('assetLibrary.reconnect'), true);
    if (picked === 'no-dialog') {
      setNotice(t('media.noDialog'));
      return;
    }
    if (picked[0]) await savedActions.relink(`${SAVED}/${path}`, picked[0]);
  };
  const locationMenu = (path: string): ContextMenuEntry[] => [
    {
      id: 'reconnect',
      label: t('assetLibrary.reconnect'),
      icon: <FolderOpen size={14} />,
      onSelect: () => void run(() => reconnect(path)),
    },
    {
      id: 'reveal',
      label: t('projects.revealFolder'),
      icon: <FolderOpen size={14} />,
      onSelect: () => savedActions.reveal(`${SAVED}/${path}`, true),
    },
    {
      id: 'disconnect',
      label: t('assetLibrary.disconnect'),
      icon: <Unplug size={14} />,
      onSelect: () => setPendingLocation(path),
    },
  ];
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
  const title = currentCollection?.name ?? (location ? location.split('/').at(-1)! : t(`assetLibrary.${view}`));
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
  const side = (next: View, label: string, icon: React.ReactNode, count?: number) => (
    <div className={shared.treeRow} data-active={view === next}>
      <button
        type="button"
        className="pl-3"
        aria-current={view === next ? 'page' : undefined}
        onClick={() => navigate(next)}
      >
        {icon}
        <span>{label}</span>
        {count != null ? <small>{count}</small> : null}
      </button>
    </div>
  );
  return (
    <div ref={rootRef} className={shared.browser} data-asset-library="" onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); }}>
      <div className={shared.body}>
        <aside className={shared.sidebar} aria-label={t('resourceCenter.title')}>
          <ResourceCenterBrand />
          <div className={shared.treeRow} data-nav-kind="domain">
            <button type="button" className="pl-3" onClick={onProjects}>
              <Clapperboard size={16} />
              <span>{t('launcher.projects')}</span>
            </button>
          </div>
          <div className={shared.treeRow} data-nav-kind="domain" data-active="true">
            <button type="button" className="pl-3" onClick={() => navigate('all')}>
              <Library size={16} />
              <span>{t('saved.title')}</span>
            </button>
          </div>
          <div className={shared.treeRow} data-nav-kind="domain">
            <button type="button" className="pl-3" onClick={onExamples}>
              <Clapperboard size={16} />
              <span>{t('launcher.examples')}</span>
            </button>
          </div>
          <div className={shared.sideLabel}>{t('assetLibrary.quickAccess')}</div>
          {side('all', t('assetLibrary.all'), <Library size={14} />, files.length)}
          {side('recent', t('assetLibrary.recent'), <FolderOpen size={14} />)}
          {side(
            'starred',
            t('assetLibrary.starred'),
            <Star size={14} />,
            files.filter((file) => catalog.items[file.path]?.starred).length,
          )}
          {files.some(unavailable)
            ? side('offline', t('assetLibrary.offline'), <Unplug size={14} />, files.filter(unavailable).length)
            : null}
          <div className={styles.sectionHeading}>
            <span>{t('assetLibrary.collections')}</span>
            <button
              type="button"
              className={shared.iconButton}
              aria-label={t('assetLibrary.newCollection')}
              onClick={() => setNaming(true)}
            >
              <Plus size={13} />
            </button>
          </div>
          {catalog.collections.map((collection) => (
            <div
              key={collection.id}
              className={styles.collection}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes('application/x-openfilm-resource')) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'link';
                }
              }}
              onDrop={(event) => {
                const file = readResourceDragData(event.dataTransfer);
                if (!file?.saved?.startsWith('saved/')) return;
                event.preventDefault();
                event.stopPropagation();
                void run(() => assetLibrary.collect([file.saved!], collection.id));
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({
                  x: event.clientX,
                  y: event.clientY,
                  items: [
                    {
                      id: 'remove',
                      label: t('assetLibrary.deleteCollection'),
                      icon: <Trash2 size={14} />,
                      onSelect: () => setPendingCollection(collection.id),
                    },
                  ],
                });
              }}
            >
              {side(
                `collection:${collection.id}`,
                collection.name,
                <Folder size={14} />,
                files.filter((file) => catalog.items[file.path]?.collections.includes(collection.id)).length,
              )}
              <button
                type="button"
                className={styles.collectionMore}
                aria-label={t('projectMenu.more')}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenu({
                    x: rect.left,
                    y: rect.bottom,
                    items: [
                      {
                        id: 'remove',
                        label: t('assetLibrary.deleteCollection'),
                        onSelect: () => setPendingCollection(collection.id),
                      },
                    ],
                  });
                }}
              >
                <MoreHorizontal size={13} />
              </button>
            </div>
          ))}
          {naming ? (
            <form
              className={styles.naming}
              onSubmit={(event) => {
                event.preventDefault();
                if (!name.trim()) return;
                void run(async () => {
                  const collection = await assetLibrary.createCollection(name);
                  if (paths.length) await assetLibrary.collect(paths, collection.id);
                  setName('');
                  setNaming(false);
                  setNotice(t('assetLibrary.collectionCreated'));
                });
              }}
            >
              <input
                autoFocus
                aria-label={t('assetLibrary.collectionName')}
                placeholder={t('assetLibrary.collectionName')}
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    setNaming(false);
                  }
                }}
              />
              <button type="submit" className={shared.action}>
                {t('assetLibrary.create')}
              </button>
            </form>
          ) : null}
          <div className={shared.sideLabel}>{t('assetLibrary.locations')}</div>
          {side('managed', t('assetLibrary.managed'), <HardDrive size={14} />)}
          {connections.map(([path, link]) => (
            <div
              key={path}
              className={styles.collection}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ x: event.clientX, y: event.clientY, items: locationMenu(path) });
              }}
            >
              {side(
                `location:${path}`,
                path.split('/').at(-1)!,
                link.missing ? <Unplug size={14} /> : <FolderOpen size={14} />,
              )}
              <button
                type="button"
                className={styles.collectionMore}
                aria-label={t('projectMenu.more')}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenu({ x: rect.left, y: rect.bottom, items: locationMenu(path) });
                }}
              >
                <MoreHorizontal size={13} />
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={busy}
            className={`${shared.action} justify-start`}
            onClick={() => void connect()}
          >
            <FolderPlus size={14} />
            {t('assetLibrary.connectFolder')}
          </button>
          <ProjectsStorage className={shared.storage} />
        </aside>
        <main className={shared.main}>
          <header className={styles.header}>
            <div>
              <span className={styles.breadcrumb}>{t('saved.title')}</span>
              <div className={styles.titleLine}><h2>{title}</h2><span className={styles.count}>{filtered?.files.length ?? 0}</span></div>
            </div>
            <div className={styles.headerTools}>
            {selection.length ? (
            <div className={styles.selectionBar}>
              <span>{t('library.selectedCount').replace('{n}', String(selection.length))}</span>
              <button
                type="button"
                className={shared.action}
                title={t(selection.every(file => catalog.items[file.path]?.starred) ? 'assetLibrary.unstar' : 'assetLibrary.star')}
                onClick={() =>
                  void run(() =>
                    assetLibrary.star(paths, !selection.every((file) => catalog.items[file.path]?.starred)),
                  )
                }
              >
                <Star size={13} />
                {t(
                  selection.every((file) => catalog.items[file.path]?.starred)
                    ? 'assetLibrary.unstar'
                    : 'assetLibrary.star',
                )}
              </button>
              <button
                type="button"
                className={shared.action}
                title={t('assetLibrary.addToCollection')}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const entry = organizeMenu(selection).find(
                    (item) => !('separator' in item) && item.id === 'collection',
                  );
                  const entries = entry && 'submenu' in entry ? entry.submenu : [];
                  setMenu({ x: rect.left, y: rect.bottom, items: [...(entries ?? [])] });
                }}
              >
                <FolderPlus size={13} />
                {t('assetLibrary.addToCollection')}
              </button>
            </div>
          ) : null}
            <button type="button" className={shared.iconButton} aria-label={t('assetLibrary.details')} title={t('assetLibrary.details')} aria-pressed={!detailsClosed} onClick={() => setDetailsClosed(value => !value)}>
              <PanelRight size={16} />
            </button>
            {onClose ? (
              <button type="button" className={shared.iconButton} aria-label={t('project.close')} onClick={onClose}>
                <X size={17} />
              </button>
            ) : null}
            </div>
          </header>
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
          <div className={styles.workspace}>
            <div className={styles.browser}>
              <MediaPool
                projectId="resource-center"
                listing={filtered}
                sources={savedSources}
                selectedPath={selectedPath}
                onSelectFile={selectFile}
                onImport={(picked, into, progress) => importIntoSaved(picked, into, progress, t('assets.uploadFailed'))}
                onMove={savedActions.move}
                onDelete={savedActions.remove}
                onNewFolder={savedActions.newFolder}
                onReveal={savedActions.reveal}
                onPick={pickFromComputer}
                onBring={savedActions.bring}
                scope="saved"
                browser={{
                  flat: !location && view !== 'managed',
                  recent: view === 'recent',
                  tileMin: 168,
                  starred: file => Boolean(catalog.items[file.path]?.starred),
                  ...(currentCollection || view === 'starred' || view === 'offline' ? { empty: {
                    title: t(currentCollection ? 'assetLibrary.emptyCollection' : view === 'starred' ? 'assetLibrary.emptyStarred' : 'assetLibrary.emptyOffline'),
                    body: t(currentCollection ? 'assetLibrary.emptyCollectionHint' : view === 'starred' ? 'assetLibrary.emptyStarredHint' : 'assetLibrary.emptyOfflineHint'),
                    canImport: false,
                  } } : {}),
                  onOpen: (file) => { setSelectedPath(file.path); setPreview(true); },
                  folder,
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
            {!selected && !detailsClosed ? <aside className={`${styles.inspector} ${styles.emptyInspector}`} aria-label={t('assetLibrary.details')}><div className={styles.emptyDetailIcon}><Library size={22} strokeWidth={1.4} /></div><h3>{t('assetLibrary.details')}</h3><p>{t('assetLibrary.selectHint')}</p></aside> : null}
            {selected && !detailsClosed ? (
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
            <span>{t('assetLibrary.itemCount').replace('{n}', String(filtered?.files.length ?? 0))}</span>
            <span>{t('assetLibrary.collectionHint')}</span>
          </footer>
        </main>
      </div>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
      <ConfirmDialog
        open={Boolean(pendingCollection)}
        title={t('assetLibrary.deleteCollection')}
        description={t('assetLibrary.deleteCollectionHint')}
        confirmLabel={t('assetLibrary.deleteCollection')}
        cancelLabel={t('confirm.cancel')}
        onCancel={() => setPendingCollection(null)}
        onConfirm={() => {
          if (pendingCollection) void run(() => assetLibrary.removeCollection(pendingCollection));
          setPendingCollection(null);
          navigate('all');
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingLocation)}
        title={t('assetLibrary.disconnect')}
        description={t('assetLibrary.disconnectHint')}
        confirmLabel={t('assetLibrary.disconnect')}
        cancelLabel={t('confirm.cancel')}
        onCancel={() => setPendingLocation(null)}
        onConfirm={() => {
          if (pendingLocation)
            void run(async () => {
              const result = await savedActions.remove(`${SAVED}/${pendingLocation}`);
              if (result !== 'ok') throw new Error(t('assetLibrary.failed'));
              navigate('all');
            });
          setPendingLocation(null);
        }}
      />
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
