import React from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Folder, FolderOpen, FolderPlus, HardDrive, House, LibraryBig, Monitor, Pin, PinOff, Unplug, X } from 'lucide-react';
import { useT } from '@/i18n';
import { assetLibrary } from '@/lib/asset-library';
import { pickFromComputer, savedActions, SAVED } from '@/lib/saved';
import { pinKey, type ResourceAssetLocation, type ResourceLibraryData, type ResourcePin, type ResourcePinActions } from '@/lib/resource-center';
import type { ProjectFolder } from '@/lib/project-folders';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { ProjectsStorage } from './ProjectsStorage';
import shared from './ProjectsView.module.css';

/** Explorer navigation: Home, pinned shortcuts, then the actual folder locations. */
export function ResourceCenterSidebar({ library, active, projectFolder, folders, onProjects, onAssets, onNotice, collectionRequest, onRequestHandled, pins, onPin, onUnpin, onReorder }: ResourcePinActions & {
  library: ResourceLibraryData;
  active: ResourceAssetLocation | null;
  projectFolder: string | null;
  folders: ProjectFolder[];
  onProjects: (folderId?: string | null) => void;
  onAssets: (location: ResourceAssetLocation) => void;
  onNotice: (message: string) => void;
  collectionRequest: string[] | null;
  onRequestHandled: () => void;
  onReorder: (from: string, to: string) => void;
}) {
  const t = useT();
  const { listing } = library;
  const connections = Object.entries(listing?.linkedDirs ?? {}).sort((a, b) => a[0].localeCompare(b[0]));
  const [expanded, setExpanded] = React.useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('openfilm.resource-center.expanded') ?? '["computer"]')); } catch { return new Set(['computer']); }
  });
  const toggle = (id: string) => setExpanded(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); try { localStorage.setItem('openfilm.resource-center.expanded', JSON.stringify([...next])); } catch { /* preferences unavailable */ } return next; });
  const [busy, setBusy] = React.useState(false);
  const [naming, setNaming] = React.useState(false);
  const [name, setName] = React.useState('');
  const [paths, setPaths] = React.useState<string[]>([]);
  const [pendingLocation, setPendingLocation] = React.useState<string | null>(null);
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  React.useEffect(() => {
    if (!collectionRequest) return;
    setPaths(collectionRequest); setNaming(true); onRequestHandled();
  }, [collectionRequest, onRequestHandled]);
  const run = async (work: () => Promise<unknown>) => {
    try { await work(); } catch (error) { onNotice(error instanceof Error ? error.message : t('assetLibrary.failed')); }
  };
  const connect = async () => {
    setBusy(true);
    try {
      const picked = await pickFromComputer(t('assetLibrary.connectFolder'), true);
      if (picked === 'no-dialog') { onNotice(t('media.noDialog')); return; }
      if (!picked.length) return;
      const landed = await savedActions.bring(picked, SAVED, 'link');
      if (landed[0]) onAssets(`location:${landed[0].slice(SAVED.length + 1)}`);
      onNotice(t('assetLibrary.connected'));
    } finally { setBusy(false); }
  };
  const pinMenu = (pin: ResourcePin): ContextMenuEntry[] => {
    const pinned = pins.some(p => pinKey(p) === pinKey(pin));
    return [{ id: 'pin', label: t(pinned ? 'resourceCenter.unpin' : 'resourceCenter.pin'), icon: pinned ? <PinOff size={14} /> : <Pin size={14} />, onSelect: () => pinned ? onUnpin(pin) : onPin(pin) }];
  };
  const locationMenu = (path: string): ContextMenuEntry[] => [
    ...pinMenu({ kind: 'assets', path }),
    { id: 'reconnect', label: t('assetLibrary.reconnect'), icon: <FolderOpen size={14} />, onSelect: () => void run(async () => {
      const picked = await pickFromComputer(t('assetLibrary.reconnect'), true);
      if (picked === 'no-dialog') { onNotice(t('media.noDialog')); return; }
      if (picked[0]) await savedActions.relink(`${SAVED}/${path}`, picked[0]);
    }) },
    { id: 'reveal', label: t('projects.revealFolder'), icon: <FolderOpen size={14} />, onSelect: () => savedActions.reveal(`${SAVED}/${path}`, true) },
    { id: 'disconnect', label: t('assetLibrary.disconnect'), icon: <Unplug size={14} />, onSelect: () => setPendingLocation(path) },
  ];
  const showMenu = (event: React.MouseEvent, items: ContextMenuEntry[]) => { event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY, items }); };
  const openPin = (pin: ResourcePin) => {
    if (pin.kind === 'projects' && pin.folderId && !folders.some(f => f.id === pin.folderId) || pin.kind === 'assets' && pin.path && listing && !listing.dirs.includes(pin.path)) { onNotice(t('resourceCenter.unavailable')); return; }
    if (pin.kind === 'projects') onProjects(pin.folderId); else onAssets(pin.path ? `location:${pin.path}` : 'all');
  };
  const activePin = (pin: ResourcePin) => pin.kind === 'projects' ? active === null && projectFolder === pin.folderId : pin.path ? active === `location:${pin.path}` : active === 'all' || active === 'managed';
  const pinLabel = (pin: ResourcePin) => pin.kind === 'projects' ? pin.folderId ? folders.find(f => f.id === pin.folderId)?.name ?? t('resourceCenter.unavailable') : t('resourceCenter.projects') : pin.path.split('/').at(-1) || t('saved.title');
  const pinIcon = (pin: ResourcePin) => pin.kind === 'assets' && !pin.path ? <LibraryBig size={16} strokeWidth={1.75} /> : <Folder size={16} />;
  const row = (id: string, label: string, icon: React.ReactNode, onOpen: () => void, selected: boolean, menuItems?: ContextMenuEntry[], children?: React.ReactNode, depth = 0) => <React.Fragment key={id}>
    <div className={shared.explorerRow} data-active={selected} style={{ '--depth': depth } as React.CSSProperties} onContextMenu={menuItems ? e => showMenu(e, menuItems) : undefined}>
      {children ? <button type="button" className={shared.treeToggle} aria-label={t(expanded.has(id) ? 'projectBrowser.collapse' : 'projectBrowser.expand').replace('{name}', label)} aria-expanded={expanded.has(id)} onClick={() => toggle(id)}><ChevronRight size={12} style={{ transform: expanded.has(id) ? 'rotate(90deg)' : undefined }} /></button> : <span className={shared.treeToggle} />}
      <button type="button" className={shared.explorerLink} aria-current={selected ? 'page' : undefined} onClick={onOpen}>{icon}<span>{label}</span></button>
    </div>
    {children && expanded.has(id) ? children : null}
  </React.Fragment>;
  const projectTree = (parent: string | null, depth: number): React.ReactNode => folders.filter(f => (f.parentId ?? null) === parent).map(f => row(`project:${f.id}`, f.name, <Folder size={16} />, () => onProjects(f.id), active === null && projectFolder === f.id, pinMenu({ kind: 'projects', folderId: f.id }), folders.some(c => c.parentId === f.id) ? projectTree(f.id, depth + 1) : undefined, depth));
  const folderTree = (parent: string, depth: number): React.ReactNode => (listing?.dirs ?? []).filter(path => path.split('/').slice(0, -1).join('/') === parent).map(path => row(`folder:${path}`, path.split('/').at(-1)!, listing?.linkedDirs?.[path]?.missing ? <Unplug size={16} /> : <Folder size={16} />, () => onAssets(`location:${path}`), active === `location:${path}`, listing?.linkedDirs?.[path] ? locationMenu(path) : pinMenu({ kind: 'assets', path }), listing?.dirs.some(p => p.startsWith(`${path}/`)) ? folderTree(path, depth + 1) : undefined, depth));
  return <>
    <aside className={shared.sidebar} aria-label={t('resourceCenter.navigation')} data-resource-sidebar="" onDragOver={e => { e.preventDefault(); e.stopPropagation(); }} onDrop={e => { e.preventDefault(); e.stopPropagation(); }}>
      <nav aria-label={t('resourceCenter.navigation')}>
        {row('home', t('resourceCenter.home'), <House size={16} />, () => onAssets('home'), active === 'home')}
        <div className={shared.sideSeparator} />
        <div aria-label={t('resourceCenter.quickAccess')}>
          {pins.map(pin => <div key={pinKey(pin)} className={shared.explorerRow} data-active={activePin(pin)} data-quick-pin={pinKey(pin)} draggable onDragStart={e => { e.dataTransfer.setData('application/x-openfilm-pin', pinKey(pin)); e.dataTransfer.effectAllowed = 'move'; }} onDragOver={e => { if (e.dataTransfer.types.includes('application/x-openfilm-pin')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }} onDrop={e => { const from = e.dataTransfer.getData('application/x-openfilm-pin'); if (from) { e.preventDefault(); e.stopPropagation(); onReorder(from, pinKey(pin)); } }} onContextMenu={e => showMenu(e, pinMenu(pin))}>
            <span className={shared.treeToggle} /><button type="button" className={shared.explorerLink} aria-current={activePin(pin) ? 'page' : undefined} onClick={() => openPin(pin)}>{pinIcon(pin)}<span>{pinLabel(pin)}</span><Pin size={11} className={shared.pinMark} /></button>
          </div>)}
        </div>
        <div className={shared.sideSeparator} />
        {row('computer', t('resourceCenter.computer'), <Monitor size={16} />, () => onAssets('computer'), active === 'computer', undefined, <>
          {row('projects', t('resourceCenter.projects'), <FolderOpen size={16} />, () => onProjects(null), active === null && !projectFolder, pinMenu({ kind: 'projects', folderId: null }), folders.length ? projectTree(null, 2) : undefined, 1)}
          {row('library', t('saved.title'), <LibraryBig size={16} strokeWidth={1.75} />, () => onAssets('all'), active === 'all', pinMenu({ kind: 'assets', path: '' }), (listing?.dirs.length ?? 0) > 0 ? folderTree('', 2) : undefined, 1)}
          {connections.map(([path, link]) => row(`source:${path}`, path.split('/').at(-1)!, link.missing ? <Unplug size={16} /> : <HardDrive size={16} />, () => onAssets(`location:${path}`), active === `location:${path}`, locationMenu(path), listing?.dirs.some(p => p.startsWith(`${path}/`)) ? folderTree(path, 2) : undefined, 1))}
          <button type="button" className={shared.connectFolder} disabled={busy} onClick={() => void run(connect)}><FolderPlus size={15} />{t('assetLibrary.connectFolder')}</button>
        </>)}
      </nav>
      <ProjectsStorage className={shared.storage} />
    </aside>
    {naming ? createPortal(<div className={shared.namingOverlay} onMouseDown={e => { if (e.target === e.currentTarget) setNaming(false); }}><form role="dialog" aria-modal="true" aria-label={t('assetLibrary.newCollection')} className={shared.namingDialog} onSubmit={event => { event.preventDefault(); if (!name.trim() || busy) return; setBusy(true); void run(async () => {
      const collection = await assetLibrary.createCollection(name);
      if (paths.length) await assetLibrary.collect(paths, collection.id);
      setName(''); setNaming(false); onAssets(`collection:${collection.id}`); onNotice(t('assetLibrary.collectionCreated'));
    }).finally(() => setBusy(false)); }} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setNaming(false); } }}><div><strong>{t('assetLibrary.newCollection')}</strong><button type="button" className={shared.iconButton} aria-label={t('project.close')} onClick={() => setNaming(false)}><X size={16} /></button></div><input autoFocus aria-label={t('assetLibrary.collectionName')} placeholder={t('assetLibrary.collectionName')} value={name} maxLength={80} onChange={e => setName(e.target.value)} /><button type="submit" disabled={!name.trim() || busy} className={`${shared.action} ${shared.primary}`}>{t('assetLibrary.create')}</button></form></div>, document.body) : null}
    {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
    <ConfirmDialog open={Boolean(pendingLocation)} title={t('assetLibrary.disconnect')} description={t('assetLibrary.disconnectHint')} confirmLabel={t('assetLibrary.disconnect')} cancelLabel={t('confirm.cancel')} onCancel={() => setPendingLocation(null)} onConfirm={() => {
      if (pendingLocation) void run(async () => { if (await savedActions.remove(`${SAVED}/${pendingLocation}`) !== 'ok') throw new Error(t('assetLibrary.failed')); if (active?.startsWith(`location:${pendingLocation}`)) onAssets('all'); });
      setPendingLocation(null);
    }} />
  </>;
}
