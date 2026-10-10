/**
 * Studio's media pane, kept the way editors keep media (CapCut's media panel, DaVinci's Media Pool): everything at
 * one top level called All, folders as tiles beside the files, double-click a folder to go in.
 *
 * The top level is assets/ itself plus every web page of the project (its scenes). A person can make folders and
 * drag files into them. Paths are not shown: Reveal in Finder and Copy path are on the right-click menu.
 *
 * Click a file to see it: the viewer plays it and the inspector shows its facts (onSelectFile). Drag it to the
 * timeline to use it. Moving or renaming a file also repoints the timeline's clips (the server does it in the same
 * step), so nothing goes missing.
 *
 * The host owns the data and the changes: it passes the listing (`listing`), where pictures and sounds come from
 * (`sources`), and does each change through a callback; the listing it passes next shows the result.
 */
import React from 'react';
import {
  ArrowUpDown,
  ChevronRight,
  Clapperboard,
  Copy,
  Folder,
  FolderOpen,
  FolderPlus,
  ListFilter,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  AudioLines,
  MessageSquarePlus,
  X,
} from 'lucide-react';
import { useT } from '@/i18n';
import { clearResourceDrag, setResourceDragData } from '@/lib/resource-drag';
import { STUDIO_REF_TYPE, type StudioRef } from '@/lib/host';
import {
  formatClipDuration,
  mediaNameMatches,
  renameChangesKind,
  renamedPath,
  safeName,
  srcHitsAsset,
  type MediaListing,
  type MediaResult,
  type MediaSources,
  type WorkspaceResource,
} from '@/lib/workspace-resources';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { MediaPreview } from './MediaPreview';
import { Tooltip } from './Tooltip';
import { retryImage } from '@/lib/retry-image';

type Filter = 'all' | 'video' | 'image' | 'audio' | 'page';
type SortKey = 'name' | 'time' | 'duration' | 'type';
const FILTERS: readonly Filter[] = ['all', 'video', 'image', 'audio', 'page'];
const SORTS: readonly SortKey[] = ['name', 'time', 'duration', 'type'];
/** A tile dragged inside the pane, to be moved into a folder. */
const FOLDER_DRAG = 'application/x-openfilm-media';
/** The open folder per project, kept across remounts (the layout re-mounts the pane). */
const OPEN_FOLDER = new Map<string, string>();

/** Tool folders, not material: fonts. */
const HIDDEN_DIRS = [/(^|\/)fonts?(\/|$)/i];
const hiddenDir = (rel: string) => HIDDEN_DIRS.some((re) => re.test(rel));

const isMedia = (f: WorkspaceResource) => f.kind === 'video' || f.kind === 'image' || f.kind === 'audio';
const filterOf = (f: WorkspaceResource): Filter => (f.kind === 'mg' ? 'page' : f.kind as Filter);

interface ViewState { sort: SortKey; filter: Filter }
const viewKey = (projectId: string) => `openfilm.media.${projectId}`;
function loadView(projectId: string): ViewState {
  try {
    const raw = JSON.parse(window.localStorage.getItem(viewKey(projectId)) ?? 'null') as Partial<ViewState> | null;
    return {
      sort: SORTS.includes(raw?.sort as SortKey) ? raw!.sort as SortKey : 'name',
      filter: FILTERS.includes(raw?.filter as Filter) ? raw!.filter as Filter : 'all',
    };
  } catch { return { sort: 'name', filter: 'all' }; }
}

type Item = { type: 'folder'; rel: string; name: string; count: number; covers: WorkspaceResource[] } | { type: 'file'; file: WorkspaceResource };

export interface MediaPoolProps {
  projectId: string;
  /** The project's media and pages; null while the first listing loads (the pane stays blank). */
  listing: MediaListing | null;
  sources: MediaSources;
  /** Every clip `src` on the timeline: how many clips a delete would take with it. */
  usedSrcs?: readonly string[];
  /** The file the viewer and inspector are showing (the host owns it, so a click elsewhere can clear it). */
  selectedPath?: string | null;
  onSelectFile: (file: WorkspaceResource | null) => void;
  /**
   * Import files from the computer into `folder` (project-relative: `assets` or `assets/<sub>`), reporting progress
   * 0..1 over all of them. Reject with an Error whose message the pane shows (else "Upload failed, please retry").
   */
  onImport: (files: File[], folder: string, onProgress: (ratio: number) => void) => Promise<unknown>;
  /** Rename or move a file or folder (project-relative `from` → `to`); its clips follow. */
  onMove: (from: string, to: string) => Promise<MediaResult>;
  /** Delete a file or folder (project-relative). Its clips were already taken off (`onDropClips`). */
  onDelete: (path: string) => Promise<MediaResult>;
  /** A video's sound made a file of its own beside it (it shows up in the listing like any new file). */
  onExtractAudio?: (path: string) => Promise<MediaResult>;
  /** Make a folder (project-relative path, its name already made safe). */
  onNewFolder: (path: string) => Promise<MediaResult>;
  /** Before deleting files, take their clips off the timeline. A string is the reason it could not. */
  onDropClips?: (paths: readonly string[]) => Promise<string | null>;
  /** Show a file or folder in Finder (project-relative). Missing: the menu has no Reveal in Finder. */
  onReveal?: (path: string) => void;
  /** Where the pool is a drawer the person opened (a host app's panel, see lib/host.ts): its close button, last in the bar. */
  onClose?: () => void;
  /**
   * The app around Studio has a chat (lib/host.ts `refer`): a file as a reference in it. With it the file menu has
   * "Reference in chat", and a dragged file carries the reference too (STUDIO_REF_TYPE), for the chat to take.
   */
  fileRef?: (file: WorkspaceResource) => StudioRef;
  onRefer?: (ref: StudioRef) => void;
  /** Show this file: its folder opened, the tile scrolled into view. `seq` goes up each time. */
  reveal?: { path: string; seq: number } | null;
  /** The file a pill hovered in the app's chat points at: its tile lit while it is. */
  litPath?: string | null;
  /**
   * Put a file on the timeline, at the playhead on the targeted track or at the end of the main one (the tile's "+",
   * Enter on the file picked). Without it there is no "+".
   */
  onAdd?: (file: WorkspaceResource) => void;
}

export function MediaPool({
  projectId,
  listing: media,
  sources,
  usedSrcs = [],
  selectedPath,
  onSelectFile,
  onImport,
  onMove,
  onDelete,
  onExtractAudio,
  onNewFolder,
  onDropClips,
  onReveal,
  onClose,
  fileRef,
  onRefer,
  reveal,
  litPath,
  onAdd,
}: MediaPoolProps) {
  const t = useT();
  const [view, setView] = React.useState<ViewState>(() => loadView(projectId));
  /** The open folder, relative to assets/ ('' is All). */
  const [at, setAtState] = React.useState(() => OPEN_FOLDER.get(projectId) ?? '');
  const setAt = React.useCallback((rel: string) => { OPEN_FOLDER.set(projectId, rel); setAtState(rel); }, [projectId]);
  const [query, setQuery] = React.useState('');
  const [selectedFolder, setSelectedFolder] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [menu, setMenu] = React.useState<{ x: number; y: number; flipTo?: number; items: ContextMenuEntry[]; dense?: boolean } | null>(null);
  const [confirm, setConfirm] = React.useState<{ path: string; name: string; folder: boolean } | null>(null);
  const [importing, setImporting] = React.useState<{ count: number; ratio: number } | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [dropTarget, setDropTarget] = React.useState<string | null>(null);
  const [osDrag, setOsDrag] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { setView(loadView(projectId)); setAtState(OPEN_FOLDER.get(projectId) ?? ''); }, [projectId]);
  React.useEffect(() => {
    try { window.localStorage.setItem(viewKey(projectId), JSON.stringify(view)); } catch { /* per-viewer only */ }
  }, [projectId, view]);

  const root = media?.dir ?? 'assets';
  const assetRel = React.useCallback((path: string) => (path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path), [root]);
  const relDir = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

  const allFiles = React.useMemo(() => {
    if (!media) return null;
    const files = media.files.filter((f) => isMedia(f) && !hiddenDir(relDir(assetRel(f.path))));
    return [...media.pages, ...files];
  }, [media, assetRel]);

  /* a folder shows when it holds media, when the person made it, or when it is empty (made in Finder, or by an agent,
     to be filled): only one holding nothing but other files (a tool's data) stays out of the way */
  const folders = React.useMemo(() => {
    if (!media) return [];
    const made = media.made ? new Set(media.made) : null;
    const under = (dir: string) => media.files.filter((f) => assetRel(f.path).startsWith(`${dir}/`));
    return media.dirs.filter((dir) => {
      if (hiddenDir(dir)) return false;
      if (!made || [...made].some((m) => m === dir || m.startsWith(`${dir}/`))) return true;
      const files = under(dir);
      return !files.length || files.some((f) => isMedia(f) && !hiddenDir(relDir(assetRel(f.path))));
    });
  }, [media, assetRel]);

  const items = React.useMemo((): Item[] | null => {
    if (!allFiles) return null;
    const q = query.trim();
    const order = (a: WorkspaceResource, b: WorkspaceResource) => {
      if (view.sort === 'time') return b.mtimeMs - a.mtimeMs;
      if (view.sort === 'duration') return (b.durationMs ?? -1) - (a.durationMs ?? -1);
      if (view.sort === 'type') return filterOf(a).localeCompare(filterOf(b)) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    };
    /* searching or showing one kind looks through every folder at once */
    if (q || view.filter !== 'all') {
      return allFiles
        .filter((f) => (view.filter === 'all' || filterOf(f) === view.filter) && mediaNameMatches(f.name, q))
        .sort(order).map((file) => ({ type: 'file', file }));
    }
    const here = allFiles.filter((f) => (f.kind === 'mg' ? at === '' : relDir(assetRel(f.path)) === at)).sort(order);
    const sub = folders
      .filter((dir) => relDir(dir) === at)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((rel) => ({
        type: 'folder' as const, rel, name: rel.split('/').pop()!,
        count: allFiles.filter((f) => f.kind !== 'mg' && assetRel(f.path).startsWith(`${rel}/`)).length,
        /* what the folder holds, on its cover: pictures first (they say the most), sounds after */
        covers: allFiles
          .filter((f) => f.kind !== 'mg' && assetRel(f.path).startsWith(`${rel}/`))
          .sort((a, b) => Number(a.kind === 'audio') - Number(b.kind === 'audio') || a.name.localeCompare(b.name, undefined, { numeric: true }))
          .slice(0, 4),
      }));
    return [...sub, ...here.map((file) => ({ type: 'file' as const, file }))];
  }, [allFiles, folders, at, query, view, assetRel]);

  /* a file asked to be shown: its folder opened (pages are at the top), a search or a filter that hides it let go */
  const gridRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!reveal) return undefined;
    const file = allFiles?.find((f) => f.path === reveal.path);
    if (!file) return undefined;
    setQuery('');
    setView((v) => (v.filter === 'all' || v.filter === filterOf(file) ? v : { ...v, filter: 'all' }));
    setAt(file.kind === 'mg' ? '' : relDir(assetRel(file.path)));
    const frame = requestAnimationFrame(() => {
      gridRef.current?.querySelector(`[data-media-path="${CSS.escape(file.path)}"]`)?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.seq]);

  /* the open folder went away (deleted, renamed outside): back to All */
  React.useEffect(() => {
    if (at && media && !media.dirs.includes(at)) setAt('');
  }, [at, media, setAt]);

  const folderPath = (rel: string) => (rel ? `${root}/${rel}` : root);

  const importFiles = async (list: File[]) => {
    if (!list.length) return;
    setNotice(null);
    setImporting({ count: list.length, ratio: 0 });
    try {
      /* into the open folder: the top of assets/ unless the person went into one */
      await onImport(list, folderPath(at), (ratio) => setImporting({ count: list.length, ratio }));
    } catch (e) {
      setNotice(e instanceof Error && e.message ? e.message : t('assets.uploadFailed'));
    } finally {
      setImporting(null);
    }
  };

  const moveInto = async (path: string, intoRel: string) => {
    const into = folderPath(intoRel);
    if (relDir(path) === into) return;
    const name = path.slice(path.lastIndexOf('/') + 1);
    const result = await onMove(path, `${into}/${name}`);
    if (result === 'taken') setNotice(t('media.moveTaken').replace('{name}', name).replace('{folder}', intoRel ? intoRel.split('/').pop()! : t('media.filter_all')));
    else if (result !== 'ok') setNotice(t('media.moveFailed'));
    else if (selectedPath === path) onSelectFile(null);
  };

  const remove = async (target: { path: string; folder: boolean }) => {
    const gone = target.folder
      ? (media?.files ?? []).filter((f) => f.path.startsWith(`${target.path}/`)).map((f) => f.path)
      : [target.path];
    const dropped = await onDropClips?.(gone);
    if (dropped) { setNotice(dropped); return; }
    const result = await onDelete(target.path);
    if (result !== 'ok') setNotice(t('assets.deleteFailed'));
    if (selectedPath && gone.includes(selectedPath)) onSelectFile(null);
  };

  const rename = async (path: string, name: string, folder: boolean) => {
    setRenaming(null);
    const to = renamedPath(path, name, folder);
    if (!to) return;
    /* a file's ending says what it is: the server refuses one that would change it, and this says why */
    if (!folder && renameChangesKind(path, to)) {
      setNotice(t('assets.renameKind').replace('{from}', path.slice(path.lastIndexOf('/') + 1)).replace('{to}', to.slice(to.lastIndexOf('/') + 1)));
      return;
    }
    const result = await onMove(path, to);
    if (result !== 'ok') setNotice(t(result === 'taken' ? 'assets.renameTaken' : 'assets.renameFailed'));
    else if (selectedPath === path) onSelectFile(null);
  };

  const makeFolder = async (name: string) => {
    setCreating(false);
    const safe = safeName(name);
    if (!safe) return;
    const result = await onNewFolder(`${folderPath(at)}/${safe}`);
    if (result !== 'ok') setNotice(t(result === 'taken' ? 'assets.renameTaken' : 'assets.newFolderFailed'));
  };

  const commonEntries = (path: string): ContextMenuEntry[] => [
    ...(onReveal ? [{ id: 'reveal', label: t('projects.revealFolder'), icon: <FolderOpen size={14} />, onSelect: () => onReveal(path) }] : []),
    { id: 'copy', label: t('media.copyPath'), icon: <Copy size={14} />, onSelect: () => { void navigator.clipboard?.writeText(path).catch(() => {}); } },
  ];
  const fileMenu = (file: WorkspaceResource): ContextMenuEntry[] => [
    ...(fileRef && onRefer ? [
      { id: 'refer', label: t('host.refer'), icon: <MessageSquarePlus size={14} />, onSelect: () => onRefer(fileRef(file)) },
      { id: 'refer-sep', separator: true } as const,
    ] : []),
    ...commonEntries(file.path),
    { id: 'sep', separator: true } as const,
    /* web pages are the film's code, written by the person's agent (and named in each other's code): not renamed
       here; any file can be deleted, to the Trash, its clips with it */
    ...(file.kind === 'video' && onExtractAudio ? [{
      id: 'extract-audio', label: t('assets.extractAudio'), icon: <AudioLines size={14} />,
      onSelect: () => { void onExtractAudio(file.path).then((r) => { if (r !== 'ok') setNotice(t('assets.extractAudioFailed')); }); },
    }] : []),
    ...(file.kind === 'mg' ? [] : [{ id: 'rename', label: t('assets.rename'), icon: <Pencil size={14} />, onSelect: () => setRenaming(file.path) }]),
    { id: 'delete', label: t('assets.delete'), icon: <Trash2 size={14} />, danger: true, onSelect: () => setConfirm({ path: file.path, name: file.name, folder: false }) },
  ];
  const folderMenu = (rel: string, name: string): ContextMenuEntry[] => [
    ...commonEntries(`${root}/${rel}`),
    { id: 'sep', separator: true },
    { id: 'rename', label: t('assets.rename'), icon: <Pencil size={14} />, onSelect: () => setRenaming(`${root}/${rel}`) },
    { id: 'delete', label: t('assets.delete'), icon: <Trash2 size={14} />, danger: true, onSelect: () => setConfirm({ path: `${root}/${rel}`, name, folder: true }) },
  ];
  const blankMenu: ContextMenuEntry[] = [
    { id: 'new-folder', label: t('assets.newFolder'), icon: <FolderPlus size={14} />, onSelect: () => setCreating(true) },
    { id: 'import', label: t('media.import'), icon: <Plus size={14} />, onSelect: () => inputRef.current?.click() },
  ];
  const openMenuAt = (e: { clientX: number; clientY: number }, items: ContextMenuEntry[], dense?: boolean) => setMenu({ x: e.clientX, y: e.clientY, items, dense });
  const barMenu = (e: React.MouseEvent, items: ContextMenuEntry[]) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 4, flipTo: r.top - 4, items, dense: true });
  };

  const crumbs = at ? at.split('/') : [];
  const flat = Boolean(query.trim()) || view.filter !== 'all';
  /* results come from every folder: where a name shows more than once, each says which folder it is in */
  const repeated = React.useMemo(() => {
    const seen = new Map<string, number>();
    if (flat) for (const item of items ?? []) if (item.type === 'file') seen.set(item.file.name, (seen.get(item.file.name) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([name]) => name));
  }, [flat, items]);

  /* a tile dropped on a folder tile or a crumb moves there. Passing from one part of the tile to another is not
     leaving it (the highlight would flicker) */
  const dropProps = (intoRel: string) => ({
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(FOLDER_DRAG)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setDropTarget(intoRel); } },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDropTarget((cur) => (cur === intoRel ? null : cur));
    },
    onDrop: (e: React.DragEvent) => {
      const path = e.dataTransfer.getData(FOLDER_DRAG);
      if (!path) return;
      e.preventDefault(); e.stopPropagation(); setDropTarget(null);
      void moveInto(path, intoRel);
    },
  });

  const counts = React.useMemo(() => {
    const out: Record<Filter, number> = { all: 0, video: 0, image: 0, audio: 0, page: 0 };
    for (const f of allFiles ?? []) { out.all += 1; out[filterOf(f)] += 1; }
    return out;
  }, [allFiles]);

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      /* Delete (or Backspace) on the file picked here asks to delete it, as an editor's project panel does; only while
         the keys are the pane's (the timeline's Delete is the timeline's) */
      onKeyDown={(e) => {
        if (!selectedPath || renaming || confirm) return;
        if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"], button')) return;
        const file = allFiles?.find((f) => f.path === selectedPath);
        if (!file) return;
        /* Enter puts the file picked on the timeline, as its "+" does */
        if (e.key === 'Enter' && onAdd && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && canAdd(file)) {
          e.preventDefault();
          e.stopPropagation();
          onAdd(file);
          return;
        }
        if (e.key !== 'Delete' && e.key !== 'Backspace') return;
        e.preventDefault();
        e.stopPropagation();
        setConfirm({ path: file.path, name: file.name, folder: false });
      }}
      onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOsDrag(true); } }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOsDrag(false); }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault(); setOsDrag(false);
        void importFiles([...e.dataTransfer.files]);
      }}
    >
      <div className="flex shrink-0 items-center gap-1 px-2.5 pb-1.5 pt-2.5">
        <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-[var(--bg-hover)] px-2 text-[12.5px] text-[var(--text-muted)]">
          <Search size={13} className="shrink-0" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('media.search')}
            className="min-w-0 flex-1 bg-transparent text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]" />
          {query ? <button type="button" aria-label={t('media.clearSearch')} onClick={() => setQuery('')} className="shrink-0 hover:text-[var(--text)]"><X size={12} /></button> : null}
        </label>
        {/* bringing media in is what this pane is for: the one labeled button, right after the search */}
        <Tooltip label={t('media.import')} side="bottom">
          <button type="button" onClick={() => inputRef.current?.click()}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-[var(--bg-active)] px-2.5 text-[12.5px] font-medium text-[var(--text)] transition hover:bg-[var(--border-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-strong)]">
            <Upload size={13} strokeWidth={2.2} />
            {t('media.upload')}
          </button>
        </Tooltip>
        <BarButton label={t('media.filter')} on={view.filter !== 'all'} onClick={(e) => barMenu(e, FILTERS.map((f) => ({
          id: f, label: `${t(`media.filter_${f}`)}  ${counts[f]}`, checked: view.filter === f, onSelect: () => setView((v) => ({ ...v, filter: f })),
        })))}><ListFilter size={14} /></BarButton>
        <BarButton label={t('media.sort')} onClick={(e) => barMenu(e, SORTS.map((key) => ({
          id: key, label: t(`media.sort_${key}`), checked: view.sort === key, onSelect: () => setView((v) => ({ ...v, sort: key })),
        })))}><ArrowUpDown size={14} /></BarButton>
        <BarButton label={t('assets.newFolder')} onClick={() => { setQuery(''); setView((v) => ({ ...v, filter: 'all' })); setCreating(true); }}><FolderPlus size={14} /></BarButton>
        <input ref={inputRef} type="file" multiple accept="video/*,image/*,audio/*" className="hidden"
          onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ''; void importFiles(list); }} />
        {onClose ? <BarButton label={t('media.close')} onClick={onClose}><X size={14} /></BarButton> : null}
      </div>

      {/* where you are: All, then the folders you went into (drop a file on one to move it there) */}
      <div className="flex h-7 shrink-0 items-center gap-0.5 overflow-hidden px-2.5 text-[12.5px]">
        {flat ? (
          <span className="truncate text-[var(--text-muted)]">
            {view.filter !== 'all' ? t(`media.filter_${view.filter}`) : t('media.results')}
          </span>
        ) : (
          <>
            <button type="button" onClick={() => setAt('')} {...dropProps('')}
              className={`shrink-0 rounded px-1 ${at ? 'text-[var(--text-muted)] hover:text-[var(--text)]' : 'font-medium text-[var(--text)]'} ${dropTarget === '' ? 'bg-[var(--bg-hover)] ring-1 ring-[var(--accent)]' : ''}`}>
              {t('media.filter_all')}
            </button>
            {crumbs.map((name, i) => {
              const rel = crumbs.slice(0, i + 1).join('/');
              const last = i === crumbs.length - 1;
              return (
                <React.Fragment key={rel}>
                  <ChevronRight size={12} className="shrink-0 text-[var(--text-faint)]" />
                  <button type="button" onClick={() => setAt(rel)} {...dropProps(rel)}
                    className={`min-w-0 truncate rounded px-1 ${last ? 'font-medium text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'} ${dropTarget === rel ? 'bg-[var(--bg-hover)] ring-1 ring-[var(--accent)]' : ''}`}>
                    {name}
                  </button>
                </React.Fragment>
              );
            })}
          </>
        )}
      </div>

      {importing ? (
        <div className="mx-2.5 mb-2 shrink-0">
          <div className="mb-1 text-[11.5px] text-[var(--text-muted)]">
            {t('media.importing').replace('{n}', String(importing.count)).replace('{p}', String(Math.round(importing.ratio * 100)))}
          </div>
          <div className="h-1 overflow-hidden rounded bg-[var(--bg-hover)]"><div className="h-full bg-[var(--accent)] transition-[width]" style={{ width: `${Math.round(importing.ratio * 100)}%` }} /></div>
        </div>
      ) : null}
      {notice ? (
        <div className="mx-2.5 mb-2 flex shrink-0 items-start gap-2 rounded-md bg-[var(--bg-hover)] px-2 py-1.5 text-[12px] text-[var(--text-muted)]">
          <span className="min-w-0 flex-1">{notice}</span>
          <button type="button" aria-label={t('media.dismiss')} onClick={() => setNotice(null)}><X size={12} /></button>
        </div>
      ) : null}

      <div
        ref={gridRef}
        className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3 pt-1"
        onClick={(e) => { if (e.target === e.currentTarget) { setSelectedFolder(null); onSelectFile(null); } }}
        onContextMenu={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); openMenuAt(e, blankMenu); } }}
      >
        {items && !items.length && !creating ? (
          flat ? <p className="px-1 pt-6 text-center text-[12px] text-[var(--text-muted)]">{t('media.noMatch')}</p> : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
              <Clapperboard size={22} className="text-[var(--text-faint)]" />
              <div className="text-[13px] font-medium text-[var(--text)]">{t(at ? 'media.emptyFolder' : 'media.emptyTitle')}</div>
              {at ? null : <p className="max-w-[30ch] text-[12px] leading-relaxed text-[var(--text-muted)]">{t('media.emptyBody')}</p>}
              <button type="button" onClick={() => inputRef.current?.click()}
                className="mt-1 inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 text-[12.5px] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)]">
                <Plus size={13} />{t('media.import')}
              </button>
            </div>
          )
        ) : (
          <div className="grid gap-x-2 gap-y-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))' }}
            onContextMenu={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); openMenuAt(e, blankMenu); } }}>
            {creating ? <NewFolderTile label={t('assets.newFolder')} onDone={(name) => void makeFolder(name)} onCancel={() => setCreating(false)} /> : null}
            {(items ?? []).map((item) => item.type === 'folder' ? (
              <FolderTile
                key={`d:${item.rel}`}
                name={item.name}
                count={item.count}
                covers={item.covers}
                sources={sources}
                selected={selectedFolder === item.rel}
                target={dropTarget === item.rel}
                renaming={renaming === `${root}/${item.rel}`}
                drop={dropProps(item.rel)}
                onDragStart={(e) => { e.dataTransfer.setData(FOLDER_DRAG, `${root}/${item.rel}`); e.dataTransfer.effectAllowed = 'move'; }}
                onPress={() => { setSelectedFolder(item.rel); onSelectFile(null); }}
                onOpen={() => { setSelectedFolder(null); setAt(item.rel); }}
                onMenu={(e) => { setSelectedFolder(item.rel); openMenuAt(e, folderMenu(item.rel, item.name)); }}
                onRename={(name) => void rename(`${root}/${item.rel}`, name, true)}
                onCancelRename={() => setRenaming(null)}
              />
            ) : (
              <FileTile
                key={item.file.path}
                file={item.file}
                sources={sources}
                duration={formatClipDuration(item.file.durationMs ?? 0)}
                where={repeated.has(item.file.name) ? item.file.path.slice(0, Math.max(0, item.file.path.lastIndexOf('/'))) || item.file.path : undefined}
                selected={selectedPath === item.file.path}
                lit={litPath === item.file.path}
                renaming={renaming === item.file.path}
                {...(fileRef ? { studioRef: () => fileRef(item.file) } : {})}
                onPress={() => { setSelectedFolder(null); onSelectFile(item.file); }}
                {...(onAdd && canAdd(item.file) ? { onAdd: () => onAdd(item.file), addLabel: t('media.addToTimeline') } : {})}
                onMenu={(e) => { onSelectFile(item.file); openMenuAt(e, fileMenu(item.file)); }}
                onRename={(name) => void rename(item.file.path, name, false)}
                onCancelRename={() => setRenaming(null)}
              />
            ))}
          </div>
        )}
      </div>

      {osDrag ? (
        <div className="pointer-events-none absolute inset-1 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-[var(--accent)] bg-[var(--surface)]/80 text-[13px] text-[var(--text)]">
          {t('media.dropHint')}
        </div>
      ) : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} flipTo={menu.flipTo} items={menu.items} onClose={() => setMenu(null)} dense={menu.dense} /> : null}
      <ConfirmDialog
        open={confirm != null}
        title={confirm?.folder ? t('media.deleteFolderTitle').replace('{name}', confirm.name) : t('assets.deleteConfirmTitle')}
        description={(() => {
          if (!confirm) return '';
          const hits = usedSrcs.filter((src) => srcHitsAsset(src, confirm.path) || src.startsWith(`${confirm.path}/`)).length;
          if (!hits) return t('assets.deleteConfirm');
          return t(hits === 1 ? 'assets.deleteAlsoClip' : 'assets.deleteAlsoClips').replace('{n}', String(hits));
        })()}
        confirmLabel={t('assets.delete')}
        cancelLabel={t('confirm.cancel')}
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => { const target = confirm; setConfirm(null); if (target) void remove(target); }}
      />
    </div>
  );
}

function BarButton({ label, on, onClick, children }: { label: string; on?: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode }) {
  return (
    <Tooltip label={label} side="bottom">
      <button type="button" aria-label={label} onClick={onClick}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] ${on ? 'text-[var(--accent)]' : 'text-[var(--text-dim)]'}`}>
        {children}
      </button>
    </Tooltip>
  );
}

function NameInput({ value, onDone, onCancel }: { value: string; onDone: (name: string) => void; onCancel: () => void }) {
  return (
    <input
      autoFocus
      defaultValue={value}
      onFocus={(e) => { const dot = value.lastIndexOf('.'); e.currentTarget.setSelectionRange(0, dot > 0 ? dot : value.length); }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Enter') onDone(e.currentTarget.value); if (e.key === 'Escape') onCancel(); }}
      onBlur={(e) => onDone(e.currentTarget.value)}
      className="w-full min-w-0 rounded bg-[var(--bg-hover)] px-1 text-[12px] text-[var(--text)] outline-none ring-1 ring-[var(--accent)]"
    />
  );
}

const TILE_BOX = 'relative aspect-video overflow-hidden rounded-md ring-2 transition';

/** Whether a file can be a clip (a video, a still, a sound, a page; not a document). */
const canAdd = (file: WorkspaceResource) => file.kind === 'video' || file.kind === 'image' || file.kind === 'audio' || file.kind === 'mg';
/** A name as it is on disk: two spaces stay two (HTML would show one), so what the search is typed from is the name. */
const KEEP_SPACES: React.CSSProperties = { whiteSpace: 'pre' };

/**
 * An empty folder's mark. Never a drag's target (pointer-events none), and drawn the same while a drag is over it:
 * an element swapped under the pointer mid-drag makes the browser leave and re-enter the tile on every move, so the
 * highlight flickers and the drop is lost.
 */
function FolderGlyph({ open }: { open?: boolean }) {
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <Folder size={30} strokeWidth={1.4} className={open ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />
    </span>
  );
}

/**
 * A folder as an album: the media it holds tiled on its cover (one, two, three or four), on two cards stacked behind,
 * so it reads as a set at a glance. An empty folder shows the folder mark.
 */
function FolderTile(p: {
  name: string; count: number; covers: readonly WorkspaceResource[]; sources: MediaSources;
  selected: boolean; target: boolean; renaming: boolean;
  drop: { onDragOver: (e: React.DragEvent) => void; onDragLeave: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void };
  onDragStart: (e: React.DragEvent) => void;
  onPress: () => void; onOpen: () => void; onMenu: (e: React.MouseEvent) => void;
  onRename: (name: string) => void; onCancelRename: () => void;
}) {
  const on = p.target || p.selected;
  const cells = p.covers.length;
  const grid = cells >= 4 ? 'grid-cols-2 grid-rows-2' : cells === 3 ? 'grid-cols-2 grid-rows-2' : cells === 2 ? 'grid-cols-2 grid-rows-1' : 'grid-cols-1 grid-rows-1';
  return (
    <div className="group min-w-0 cursor-default select-none" draggable={!p.renaming} onDragStart={p.onDragStart}
      onClick={p.onPress} onDoubleClick={p.onOpen} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); p.onMenu(e); }} {...p.drop}>
      <div className="relative pt-[7px]">
        {/* the stack: two cards peeking out above the cover */}
        <span aria-hidden className="absolute inset-x-[14%] top-0 h-3 rounded-t-md bg-[var(--fill-tsp,rgba(127,127,127,0.18))] opacity-60" />
        <span aria-hidden className="absolute inset-x-[7%] top-[3px] h-3 rounded-t-md bg-[var(--fill-tsp,rgba(127,127,127,0.18))]" />
        <div className={`${TILE_BOX} bg-[var(--bg-hover)] shadow-[0_1px_0_rgba(255,255,255,0.06)_inset] ${on ? 'ring-[var(--accent)]' : 'ring-transparent group-hover:ring-[var(--border)]'} ${p.target ? 'scale-[1.03]' : ''}`}>
          {cells ? (
            <div className={`absolute inset-0 grid gap-px bg-black/40 ${grid}`}>
              {p.covers.map((file, i) => (
                <span key={file.path} className={`relative overflow-hidden bg-[var(--bg-hover)] ${cells === 3 && i === 0 ? 'row-span-2' : ''}`}>
                  <MediaPreview file={file} sources={p.sources} />
                </span>
              ))}
            </div>
          ) : <FolderGlyph open={p.target} />}
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 to-transparent" />
          <span className="pointer-events-none absolute bottom-1 left-1.5 flex items-center gap-1 text-[10.5px] font-medium text-white/90">
            {p.target ? <FolderOpen size={11} /> : <Folder size={11} />}
            <span className="tabular-nums">{p.count ? String(p.count) : ''}</span>
          </span>
        </div>
      </div>
      <div className="mt-1 min-w-0 px-0.5">
        {p.renaming ? <NameInput value={p.name} onDone={p.onRename} onCancel={p.onCancelRename} />
          : <div className={`truncate text-[12px] font-medium ${on ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'}`} style={KEEP_SPACES}>{p.name}</div>}
      </div>
    </div>
  );
}

function NewFolderTile({ label, onDone, onCancel }: { label: string; onDone: (name: string) => void; onCancel: () => void }) {
  return (
    <div className="min-w-0">
      <div className="relative pt-[7px]">
        <span aria-hidden className="absolute inset-x-[14%] top-0 h-3 rounded-t-md bg-[var(--fill-tsp,rgba(127,127,127,0.18))] opacity-60" />
        <span aria-hidden className="absolute inset-x-[7%] top-[3px] h-3 rounded-t-md bg-[var(--fill-tsp,rgba(127,127,127,0.18))]" />
        <div className={`${TILE_BOX} bg-[var(--bg-hover)] ring-[var(--accent)]`}><FolderGlyph /></div>
      </div>
      <div className="mt-1 min-w-0 px-0.5"><NameInput value={label} onDone={onDone} onCancel={onCancel} /></div>
    </div>
  );
}

function FileTile(p: {
  file: WorkspaceResource; sources: MediaSources; duration: string;
  /** Its folder, shown under the name (search results where the name repeats). */
  where?: string | undefined;
  selected: boolean; renaming: boolean;
  /** What a pill hovered in the app's chat points at. */
  lit?: boolean;
  /** The file as a reference in the app's chat, carried by a drag beside the file itself. */
  studioRef?: () => StudioRef;
  onPress: () => void; onMenu: (e: React.MouseEvent) => void; onRename: (name: string) => void; onCancelRename: () => void;
  /** The "+": the file put on the timeline. */
  onAdd?: () => void;
  addLabel?: string;
}) {
  return (
    <div
      className="group min-w-0 cursor-default select-none outline-none"
      data-media-path={p.file.path}
      data-chat-lit={p.lit ? '' : undefined}
      title={p.where ? p.file.path : p.file.name}
      draggable={!p.renaming}
      onDragStart={(e) => {
        p.onPress();
        setResourceDragData(e.dataTransfer, p.file);
        if (p.studioRef) e.dataTransfer.setData(STUDIO_REF_TYPE, JSON.stringify([p.studioRef()]));
        /* web pages stay where their code is; assets can also go into a folder of this pane */
        if (p.file.kind !== 'mg') e.dataTransfer.setData(FOLDER_DRAG, p.file.path);
        e.dataTransfer.effectAllowed = 'copyMove';
      }}
      onDragEnd={() => clearResourceDrag()}
      /* focusable, so the keys pressed after picking it are the pane's (Delete asks to delete it) */
      tabIndex={-1}
      onClick={(e) => { e.currentTarget.focus({ preventScroll: true }); p.onPress(); }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); p.onMenu(e); }}
    >
      {/* the same room above as a folder's stacked cards, so covers and names line up across a row */}
      <div className="pt-[7px]">
        <div className={`${TILE_BOX} bg-[var(--bg-hover)] ${p.lit ? 'ring-[var(--tl-accent)] shadow-[0_0_10px_1px_color-mix(in_srgb,var(--tl-accent)_55%,transparent)]' : p.selected ? 'ring-[var(--accent)]' : 'ring-transparent group-hover:ring-[var(--border)]'}`}>
          {p.file.kind === 'mg' ? <PagePoster file={p.file} sources={p.sources} /> : <MediaPreview file={p.file} sources={p.sources} />}
          {/* "+": on the timeline at the playhead (or the main track's end), without dragging it there */}
          {p.onAdd ? (
            <Tooltip label={p.addLabel ?? ''} shortcut="Enter">
              <button
                type="button"
                data-media-add=""
                aria-label={p.addLabel}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => { e.stopPropagation(); p.onPress(); p.onAdd!(); }}
                className={`absolute left-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded bg-black/65 text-white transition hover:bg-[var(--accent)] ${p.selected ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'}`}
              >
                <Plus size={13} strokeWidth={2.4} />
              </button>
            </Tooltip>
          ) : null}
          {p.duration ? <span className="absolute bottom-1 right-1 z-10 rounded bg-black/65 px-1 text-[10.5px] tabular-nums leading-[16px] text-white">{p.duration}</span> : null}
        </div>
      </div>
      <div className="mt-1 min-w-0 px-0.5">
        {p.renaming ? <NameInput value={p.file.name} onDone={p.onRename} onCancel={p.onCancelRename} />
          : <div className={`truncate text-[12px] ${p.selected ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'}`} style={KEEP_SPACES}>{p.file.name}</div>}
        {p.where ? <div className="truncate text-left text-[11px] text-[var(--text-faint)]" dir="rtl"><bdi>{p.where}</bdi></div> : null}
      </div>
    </div>
  );
}

/**
 * A web page's cover: its poster (the middle frame: a title that fades in is black on its first), else the scene
 * mark. The mark shows until the poster has loaded, so a page whose poster can't be drawn (it throws) never shows the
 * browser's broken picture while it is asked again.
 */
function PagePoster({ file, sources }: { file: WorkspaceResource; sources: MediaSources }) {
  /* kept by the address they are about (it changes with the file and what it loads): a reset after the fact would
     undo a poster that came from the cache and loaded before it ran. Once one has loaded, it stays shown while the
     next is asked for (the browser keeps the last picture until the new one is in), so a change never flickers */
  const [loaded, setLoaded] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);
  const own = sources.pagePoster?.(file);
  const src = own && failed !== own ? own : null;
  const shown = src != null && loaded != null;
  return (
    <>
      {shown ? null : <span className="absolute inset-0 flex items-center justify-center"><Clapperboard size={20} className="text-[var(--text-muted)]" /></span>}
      {src ? (
        <img src={src} alt="" loading="lazy" onLoad={() => setLoaded(src)}
          onError={(e) => { setLoaded(null); retryImage(e.currentTarget, () => setFailed(src)); }}
          className={`absolute inset-0 h-full w-full object-cover ${shown ? '' : 'invisible'}`} />
      ) : null}
    </>
  );
}
