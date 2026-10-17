/**
 * Studio's media pane, kept the way editors keep media (CapCut's media panel, DaVinci's Media Pool): everything at
 * one top level called All, folders as tiles beside the files, double-click a folder to go in.
 *
 * The top level is assets/ itself plus every web page of the project (its scenes). A person can make folders and
 * drag files into them. Paths are not shown: Reveal in Finder and Copy path are on the right-click menu.
 *
 * Click a file to see it: the viewer plays it and the inspector shows its facts (onSelectFile). Drag it to the
 * timeline to use it. Several are picked as in Finder (⌘-click, ⇧-click, a box dragged over empty space, ⌘A), to move
 * them (dragged onto a folder, or Move to) or delete them together. Any kind of file can be imported; Studio previews
 * and plays only pictures, videos, sounds and pages. Moving or renaming a file also repoints the timeline's clips (the server does it in the same
 * step), so nothing goes missing.
 *
 * The host owns the data and the changes: it passes the listing (`listing`), where pictures and sounds come from
 * (`sources`), and does each change through a callback; the listing it passes next shows the result.
 */
import React from 'react';
import {
  ArrowUpDown,
  Bookmark,
  BookmarkPlus,
  Layers,
  LayoutTemplate,
  ChevronRight,
  Clapperboard,
  Copy,
  Folder,
  ExternalLink,
  FolderInput,
  FolderSymlink,
  HardDriveDownload,
  Link2,
  Unlink,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  List,
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
  formatFileSize,
  mediaNameMatches,
  renameChangesKind,
  renamedPath,
  resourceKindOf,
  safeName,
  srcHitsAsset,
  type MediaListing,
  type MediaResult,
  type MediaSources,
  type WorkspaceResource,
  type WorkspaceResourceKind,
  type MediaLink,
  type MediaProxy,
} from '@/lib/workspace-resources';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { KIND_ICON, MediaPreview, useNearViewport } from './MediaPreview';
import { useMediaImage } from '@/lib/media-queue';
import { Tooltip } from './Tooltip';
import { retryImage } from '@/lib/retry-image';
import { boxBetween, boxHits, boxPick, moveTargets, pickItem, type Box } from '@/lib/media-selection';
import { barLayout, type BarWords } from '@/lib/media-bar';
import { byName, folderFaces } from '@/lib/media-folders';

type Filter = 'all' | 'video' | 'image' | 'audio' | 'page' | 'other';
type SortKey = 'name' | 'time' | 'duration' | 'type';
const FILTERS: readonly Filter[] = ['all', 'video', 'image', 'audio', 'page', 'other'];
const SORTS: readonly SortKey[] = ['name', 'time', 'duration', 'type'];
/** Tiles dragged inside the pane, to be moved into a folder: their paths, a line each (a name has no line break). */
const FOLDER_DRAG = 'application/x-openfilm-media';
/** Files dragged in from the computer, not a tile of this pane (the browser adds a dragged picture as a file). */
const fromComputer = (dt: DataTransfer) => dt.types.includes('Files') && !dt.types.includes(FOLDER_DRAG);
/** The open folder per project, kept across remounts (the layout re-mounts the pane). */
const OPEN_FOLDER = new Map<string, string>();

/** Tool folders, not material: fonts. */
const HIDDEN_DIRS = [/(^|\/)fonts?(\/|$)/i];
const hiddenDir = (rel: string) => HIDDEN_DIRS.some((re) => re.test(rel));

const filterOf = (f: WorkspaceResource): Filter => (f.kind === 'mg' ? 'page' : f.kind as Filter);

/** `layout`: tiles in a grid, or rows of a list (name, length, kind). */
interface ViewState { sort: SortKey; filter: Filter; layout: 'grid' | 'list' }
/* v2: the order became "as added" by default. A view kept before it (saved whether chosen or not) keeps its filter and
   layout, not its order */
const viewKey = (projectId: string) => `openfilm.media.v2.${projectId}`;
const oldViewKey = (projectId: string) => `openfilm.media.${projectId}`;
function loadView(projectId: string): ViewState {
  try {
    const kept = window.localStorage.getItem(viewKey(projectId));
    const raw = JSON.parse(kept ?? window.localStorage.getItem(oldViewKey(projectId)) ?? 'null') as Partial<ViewState> | null;
    return {
      sort: kept && SORTS.includes(raw?.sort as SortKey) ? raw!.sort as SortKey : 'time',
      filter: FILTERS.includes(raw?.filter as Filter) ? raw!.filter as Filter : 'all',
      layout: raw?.layout === 'list' ? 'list' : 'grid',
    };
  } catch { return { sort: 'time', filter: 'all', layout: 'grid' }; }
}

type Item = { type: 'folder'; rel: string; name: string; count: number; covers: WorkspaceResource[] } | { type: 'file'; file: WorkspaceResource };

/** An import's progress, per file (its index in the import): 0..1, and where it landed once it is in. */
export type ImportProgress = (file: number, ratio: number, landed?: string) => void;
/** A file on its way in: a card of its own in the folder it goes to, its progress inside, until the listing has it. */
type Upload = { id: string; name: string; into: string; kind: WorkspaceResourceKind; ratio: number; preview?: string; landed?: string };
let uploadSeq = 0;

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
   * Import files from the computer into `folder` (project-relative: `assets` or `assets/<sub>`), reporting each file's
   * progress 0..1 and, once it is in, where it landed. Reject with an Error whose message the pane shows (else "Upload
   * failed, please retry").
   */
  onImport: (files: File[], folder: string, onProgress: ImportProgress) => Promise<unknown>;
  /** Rename or move a file or folder (project-relative `from` → `to`); its clips follow. */
  onMove: (from: string, to: string) => Promise<MediaResult>;
  /**
   * What a move could not keep true, asked before it: the paths a page or script among what moves makes while it runs
   * (the rest of its links are written again by Studio). Empty: nothing to say.
   */
  onMoveCheck?: (from: string, to: string) => Promise<{ file: string; unseen: string[] }[]>;
  /** Delete a file or folder (project-relative). Its clips were already taken off (`onDropClips`). */
  onDelete: (path: string) => Promise<MediaResult>;
  /** A video's sound made a file of its own beside it (it shows up in the listing like any new file). */
  onExtractAudio?: (path: string) => Promise<MediaResult>;
  /** Make a folder (project-relative path, its name already made safe). */
  onNewFolder: (path: string) => Promise<MediaResult>;
  /** Before deleting files, take their clips off the timeline. A string is the reason it could not. */
  onDropClips?: (paths: readonly string[]) => Promise<string | null>;
  /**
   * Show a file or folder in Finder (project-relative; `original`: where a linked one is kept). Missing: the menu has
   * no Reveal in Finder.
   */
  onReveal?: (path: string, original?: boolean) => void;
  /**
   * Media kept on this computer, picked in the system's dialog: files, or a folder (`'no-dialog'` where there is
   * none), then copied into `folder` (cloned where the disk can) or linked where it is kept, a NAS or another disk
   * (`onBring`, resolving where each landed). Without them, Upload sends files picked in the browser.
   */
  onPick?: (title: string, folder: boolean) => Promise<string[] | 'no-dialog'>;
  onBring?: (paths: string[], folder: string, mode: 'copy' | 'link') => Promise<string[]>;
  /** A link pointed at where its media is now (the person picks it), or copied into the project in its place. */
  onRelink?: (path: string, folder: boolean) => Promise<MediaResult>;
  onCollect?: (path: string) => Promise<MediaResult>;
  /** Files kept to use again in any project (lib/saved): the file menu's "Add to Saved". */
  onSave?: (files: WorkspaceResource[]) => void;
  /**
   * Which library the pane shows, the project's media or Saved (the person's own, for every project), and the button
   * beside Upload that switches between them. Both are the same pane: upload, folders, views, filters, sort, rename,
   * move, delete, drag onto the timeline.
   */
  scope?: 'project' | 'saved';
  onScope?: (next: 'project' | 'saved') => void;
  /** Upload may also link media kept elsewhere (a project's); without it, files are copied in only (Saved). */
  links?: boolean;
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
   * Put a file on the timeline, at the playhead on the targeted track or at the end of the main one (Enter on the file
   * picked; dragging it there is the usual way).
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
  onMoveCheck,
  onDelete,
  onExtractAudio,
  onNewFolder,
  onDropClips,
  onReveal,
  onPick,
  onBring,
  onRelink,
  onCollect,
  onSave,
  scope = 'project',
  onScope,
  links = true,
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
  /** What is picked: files and folders by their project-relative path (lib/media-selection). */
  const [picked, setPicked] = React.useState<string[]>(() => (selectedPath ? [selectedPath] : []));
  /** The one clicked last: where a ⇧-click's run starts. */
  const anchor = React.useRef<string | null>(selectedPath ?? null);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [menu, setMenu] = React.useState<{ x: number; y: number; flipTo?: number; items: ContextMenuEntry[]; dense?: boolean } | null>(null);
  const [confirm, setConfirm] = React.useState<{ targets: { path: string; folder: boolean }[]; name: string } | null>(null);
  const [uploads, setUploads] = React.useState<Upload[]>([]);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [dropTarget, setDropTarget] = React.useState<string | null>(null);
  const [osDrag, setOsDrag] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const inSaved = scope === 'saved';
  React.useEffect(() => { setQuery(''); }, [scope]);
  /* the top folder: All of the project's media, or Saved */
  const topName = inSaved ? t('saved.title') : t('media.filter_all');

  React.useEffect(() => { setView(loadView(projectId)); setAtState(OPEN_FOLDER.get(projectId) ?? ''); setPicked([]); }, [projectId]);
  /* the file the viewer shows is the host's: the one clicked last, when it is a file. One shown from elsewhere (a click
     on the timeline let it go, the chat pointed at one) is then all that is picked */
  const sentPath = React.useRef(selectedPath ?? null);
  const showFile = React.useCallback((file: WorkspaceResource | null) => {
    sentPath.current = file?.path ?? null;
    onSelectFile(file);
  }, [onSelectFile]);
  React.useEffect(() => {
    if ((selectedPath ?? null) === sentPath.current) return;
    sentPath.current = selectedPath ?? null;
    setPicked(selectedPath ? [selectedPath] : []);
    anchor.current = selectedPath ?? null;
  }, [selectedPath]);
  React.useEffect(() => {
    try { window.localStorage.setItem(viewKey(projectId), JSON.stringify(view)); } catch { /* per-viewer only */ }
  }, [projectId, view]);

  const root = media?.dir ?? 'assets';
  const assetRel = React.useCallback((path: string) => (path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path), [root]);
  /** Under assets/ (not one of the project's own pages, which are shown at the top). */
  const inMedia = React.useCallback((path: string) => path.startsWith(`${root}/`), [root]);
  const relDir = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

  const allFiles = React.useMemo(() => {
    if (!media) return null;
    /* every file, of any kind: a document or a model is material too (the agent can make a film of it); Studio
       plays and previews only pictures, videos, sounds and pages */
    const files = media.files.filter((f) => !hiddenDir(relDir(assetRel(f.path))));
    return [...media.pages, ...files];
  }, [media, assetRel]);

  /* every folder under assets/ but a tool's (fonts) */
  const folders = React.useMemo(() => (media ? media.dirs.filter((dir) => !hiddenDir(dir)) : []), [media]);

  const items = React.useMemo((): Item[] | null => {
    if (!allFiles) return null;
    const q = query.trim();
    const order = (a: WorkspaceResource, b: WorkspaceResource) => {
      /* as added: the oldest first, what comes in goes last */
      if (view.sort === 'time') return (a.addedMs ?? a.mtimeMs) - (b.addedMs ?? b.mtimeMs) || byName(a.name, b.name);
      if (view.sort === 'duration') return (b.durationMs ?? -1) - (a.durationMs ?? -1);
      if (view.sort === 'type') return filterOf(a).localeCompare(filterOf(b)) || a.name.localeCompare(b.name);
      return byName(a.name, b.name);
    };
    /* searching or showing one kind looks through every folder at once */
    if (q || view.filter !== 'all') {
      return allFiles
        .filter((f) => (view.filter === 'all' || filterOf(f) === view.filter) && mediaNameMatches(f.name, q))
        .sort(order).map((file) => ({ type: 'file', file }));
    }
    /* the project's pages are at the top; a page put in a folder is in its folder */
    const here = allFiles.filter((f) => (inMedia(f.path) ? relDir(assetRel(f.path)) === at : at === '')).sort(order);
    /* the folders here, what each holds and its cover (lib/media-folders) */
    const sub = folderFaces(allFiles, folders, at, (path) => (inMedia(path) ? assetRel(path) : null)).map((face) => ({ type: 'folder' as const, ...face }));
    return [...sub, ...here.map((file) => ({ type: 'file' as const, file }))];
  }, [allFiles, folders, at, query, view, assetRel, inMedia]);

  /* a file asked to be shown: its folder opened (pages are at the top), a search or a filter that hides it let go */
  const gridRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!reveal) return undefined;
    const file = allFiles?.find((f) => f.path === reveal.path);
    if (!file) return undefined;
    setQuery('');
    setView((v) => (v.filter === 'all' || v.filter === filterOf(file) ? v : { ...v, filter: 'all' }));
    setAt(inMedia(file.path) ? relDir(assetRel(file.path)) : '');
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
  const keyOf = React.useCallback((item: Item) => (item.type === 'folder' ? `${root}/${item.rel}` : item.file.path), [root]);
  /* the items as shown, by key: a ⇧-click's run goes along them */
  const order = React.useMemo(() => (items ?? []).map(keyOf), [items, keyOf]);
  const itemByKey = React.useMemo(() => new Map((items ?? []).map((item) => [keyOf(item), item])), [items, keyOf]);
  /* what is picked and shown: a search or another folder hides the rest, and what is hidden is not acted on */
  const chosen = React.useMemo(() => picked.filter((key) => itemByKey.has(key)), [picked, itemByKey]);
  /** The folder an item is in ('' the top, where the pages are shown). */
  const hereOf = (key: string) => (key.startsWith(`${root}/`) ? relDir(assetRel(key)) : '');

  const importFiles = async (list: File[], intoRel = at) => {
    if (!list.length) return;
    setNotice(null);
    /* a card each, at once, where it goes: a picture shows itself while it is sent */
    const batch: Upload[] = list.map((file) => {
      const kind = resourceKindOf(file.name);
      return { id: `upload-${++uploadSeq}`, name: file.name, into: intoRel, kind, ratio: 0, ...(kind === 'image' ? { preview: URL.createObjectURL(file) } : {}) };
    });
    setUploads((all) => [...all, ...batch]);
    try {
      /* into the open folder (the top of assets/ unless the person went into one), or the folder they were dropped on */
      await onImport(list, folderPath(intoRel), (i, ratio, landed) => {
        const id = batch[i]?.id;
        setUploads((all) => all.map((u) => (u.id === id ? { ...u, ratio, ...(landed ? { landed } : {}) } : u)));
      });
    } catch (e) {
      setNotice(e instanceof Error && e.message ? e.message : t('assets.uploadFailed'));
      /* what did not get in goes; what did stays until the listing has it */
      dropUploads((u) => batch.some((b) => b.id === u.id) && !u.landed);
    }
  };
  /**
   * Media on this computer, picked in the system's dialog, copied in or linked where it is kept (a NAS): a card each
   * while it comes. Where there is no dialog, an import is the browser's pick.
   */
  const bringFrom = async (mode: 'copy' | 'link', folder: boolean, intoRel = at) => {
    if (!onPick || !onBring) { inputRef.current?.click(); return; }
    setNotice(null);
    const paths = await onPick(t(mode === 'copy' ? 'media.pickImport' : folder ? 'media.pickLinkFolder' : 'media.pickLink'), folder);
    if (paths === 'no-dialog') { if (mode === 'copy' && !folder) inputRef.current?.click(); else setNotice(t('media.noDialog')); return; }
    const batch: Upload[] = paths.map((path) => {
      const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
      return { id: `upload-${++uploadSeq}`, name, into: intoRel, kind: folder ? 'other' : resourceKindOf(name), ratio: -1 };
    });
    setUploads((all) => [...all, ...batch]);
    for (const [i, path] of paths.entries()) {
      const id = batch[i]!.id;
      try {
        // eslint-disable-next-line no-await-in-loop
        const [landed] = await onBring([path], folderPath(intoRel), mode);
        setUploads((all) => all.map((u) => (u.id === id ? { ...u, ratio: 1, ...(landed ? { landed } : {}) } : u)));
      } catch (e) {
        setNotice(e instanceof Error && e.message ? e.message : t('assets.uploadFailed'));
        dropUploads((u) => u.id === id);
      }
    }
  };
  /** Take cards away (a picture's preview let go with them). */
  const dropUploads = React.useCallback((gone: (u: Upload) => boolean) => {
    setUploads((all) => {
      if (!all.some(gone)) return all;
      for (const u of all) if (gone(u) && u.preview) URL.revokeObjectURL(u.preview);
      return all.filter((u) => !gone(u));
    });
  }, []);
  const uploadsRef = React.useRef(uploads);
  uploadsRef.current = uploads;
  /* a card gives way to the file once the listing has it (or a while after it landed, if it never shows here); what
     came in is selected and scrolled to, so it is found among many */
  React.useEffect(() => {
    if (!media) return;
    const have = new Set([...media.files.map((f) => f.path), ...media.dirs.map((d) => `${media.dir}/${d}`)]);
    const arrived = uploadsRef.current.flatMap((u) => (u.landed && have.has(u.landed) ? [u.landed] : []));
    dropUploads((u) => Boolean(u.landed && have.has(u.landed)));
    if (!arrived.length) return undefined;
    setPicked(arrived);
    anchor.current = arrived[arrived.length - 1]!;
    const frame = requestAnimationFrame(() => {
      gridRef.current?.querySelector(`[data-media-key="${CSS.escape(arrived[arrived.length - 1]!)}"]`)?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [media, dropUploads]);
  const landedCount = uploads.filter((u) => u.landed).length;
  React.useEffect(() => {
    if (!landedCount) return undefined;
    const timer = window.setTimeout(() => dropUploads((u) => Boolean(u.landed)), 5000);
    return () => window.clearTimeout(timer);
  }, [landedCount, dropUploads]);
  React.useEffect(() => () => { for (const u of uploadsRef.current) if (u.preview) URL.revokeObjectURL(u.preview); }, []);
  /** Files on their way into a folder or one inside it: their progress together, for its cover. */
  const progressInto = (rel: string) => {
    const going = uploads.filter((u) => u.into === rel || u.into.startsWith(`${rel}/`));
    return going.length ? going.reduce((sum, u) => sum + Math.max(0, u.ratio), 0) / going.length : undefined;
  };

  /* read when a move or rename settles: the file picked may have changed while it was on its way */
  const selectedRef = React.useRef(selectedPath);
  selectedRef.current = selectedPath;
  /* a page (or a folder with one) whose code makes paths while it runs: those cannot be rewritten, so it is asked first */
  const [moveAsk, setMoveAsk] = React.useState<{ paths: string[]; intoRel: string; unseen: { file: string; unseen: string[] }[] } | null>(null);
  /** Move files and folders into a folder (`intoRel` under assets/, '' its top), one after another. */
  const moveAll = async (paths: readonly string[], intoRel: string, asked = false) => {
    const into = folderPath(intoRel);
    const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
    /* what is there already stays, and a folder never goes into itself */
    const going = paths.filter((path) => hereOf(path) !== intoRel && into !== path && !into.startsWith(`${path}/`));
    if (!going.length) return;
    if (!asked && onMoveCheck) {
      const unseen = (await Promise.all(going.map((path) => onMoveCheck(path, `${into}/${nameOf(path)}`).catch(() => [])))).flat();
      if (unseen.length) { setMoveAsk({ paths: going, intoRel, unseen }); return; }
    }
    const moved: string[] = [];
    let taken: string | null = null;
    let failed = false;
    for (const path of going) {
      // eslint-disable-next-line no-await-in-loop
      const result = await onMove(path, `${into}/${nameOf(path)}`);
      if (result === 'ok') moved.push(path);
      else if (result === 'taken') taken ??= nameOf(path);
      else failed = true;
    }
    if (taken) setNotice(t('media.moveTaken').replace('{name}', taken).replace('{folder}', intoRel ? intoRel.split('/').pop()! : topName));
    else if (failed) setNotice(t('media.moveFailed'));
    if (selectedRef.current && moved.includes(selectedRef.current)) showFile(null);
    setPicked((cur) => cur.filter((key) => !moved.includes(key)));
  };

  const remove = async (targets: readonly { path: string; folder: boolean }[]) => {
    const gone = targets.flatMap((target) => (target.folder
      ? (media?.files ?? []).filter((f) => f.path.startsWith(`${target.path}/`)).map((f) => f.path)
      : [target.path]));
    const dropped = await onDropClips?.(gone);
    if (dropped) { setNotice(dropped); return; }
    let failed = false;
    for (const target of targets) {
      // eslint-disable-next-line no-await-in-loop
      if (await onDelete(target.path) !== 'ok') failed = true;
    }
    if (failed) setNotice(t('assets.deleteFailed'));
    if (selectedPath && gone.includes(selectedPath)) showFile(null);
    setPicked((cur) => cur.filter((key) => !targets.some((target) => target.path === key)));
  };
  /** Ask to delete these (picked) items. */
  const askDelete = (keys: readonly string[]) => {
    const targets = keys.flatMap((key) => { const item = itemByKey.get(key); return item ? [{ path: key, folder: item.type === 'folder' }] : []; });
    const first = targets[0] ? itemByKey.get(targets[0].path) : undefined;
    if (first) setConfirm({ targets, name: first.type === 'folder' ? first.name : first.file.name });
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
    else if (selectedPath === path) showFile(null);
  };

  /* a folder just named stays where it was typed until the listing has it: no blink between Enter and the refresh */
  const [pendingFolder, setPendingFolder] = React.useState<string | null>(null);
  const makeFolder = async (name: string) => {
    setCreating(false);
    const safe = safeName(name);
    if (!safe) return;
    setPendingFolder(safe);
    const result = await onNewFolder(`${folderPath(at)}/${safe}`);
    if (result !== 'ok') {
      setPendingFolder(null);
      setNotice(t(result === 'taken' ? 'assets.renameTaken' : 'assets.newFolderFailed'));
    }
  };
  const pendingListed = pendingFolder != null && Boolean(items?.some((item) => item.type === 'folder' && item.name === pendingFolder));
  React.useEffect(() => { if (pendingListed) setPendingFolder(null); }, [pendingListed]);
  /* the listing never brought it (it was made elsewhere than shown): let go after a while */
  React.useEffect(() => {
    if (!pendingFolder) return undefined;
    const timer = window.setTimeout(() => setPendingFolder(null), 5000);
    return () => window.clearTimeout(timer);
  }, [pendingFolder]);

  const commonEntries = (path: string): ContextMenuEntry[] => [
    ...(onReveal ? [{ id: 'reveal', label: t('projects.revealFolder'), icon: <FolderOpen size={14} />, onSelect: () => onReveal(path) }] : []),
    { id: 'copy', label: t('media.copyPath'), icon: <Copy size={14} />, onSelect: () => { void navigator.clipboard?.writeText(path).catch(() => {}); } },
  ];
  /** What to say of a proxy. */
  const proxyText = (proxy: MediaProxy) => (proxy.state === 'making' ? t('media.proxyMaking').replace('{p}', String(Math.round((proxy.ratio ?? 0) * 100)))
    : proxy.state === 'waiting' ? t('media.proxyWaiting') : proxy.state === 'failed' ? t('media.proxyFailed') : t('media.proxyReady'));
  /** Where a file or folder is linked from (a NAS), if it is a link. */
  const linkOf = (key: string): MediaLink | undefined => {
    const item = itemByKey.get(key);
    return item?.type === 'file' ? item.file.link : item ? media?.linkedDirs?.[item.rel] : undefined;
  };
  /** Copy what links lead to into the project in their place, one after another. */
  const collectAll = async (keys: readonly string[]) => {
    if (!onCollect) return;
    for (const key of keys) {
      // eslint-disable-next-line no-await-in-loop
      if (await onCollect(key) !== 'ok') { setNotice(t('media.collectFailed')); return; }
    }
  };
  /* a link's own: where it is kept, pointed at where that is now, or copied into the project */
  const linkEntries = (key: string, folder: boolean): ContextMenuEntry[] => {
    const link = linkOf(key);
    if (!link) return [];
    return [
      ...(onReveal && !link.missing ? [{ id: 'reveal-original', label: t('media.revealOriginal'), icon: <ExternalLink size={14} />, onSelect: () => onReveal(key, true) }] : []),
      ...(onRelink ? [{ id: 'relink', label: t('media.relink'), icon: <Link2 size={14} />, onSelect: () => { void onRelink(key, folder).then((r) => { if (r !== 'ok') setNotice(t('media.relinkFailed')); }); } }] : []),
      ...(onCollect && !link.missing ? [{ id: 'collect', label: t('media.collect'), note: t('media.collectNote'), icon: <HardDriveDownload size={14} />, onSelect: () => { void collectAll([key]); } }] : []),
      { id: 'link-sep', separator: true } as const,
    ];
  };
  /** Move to: the top or any folder, the one they are all in checked (they are there already). */
  const moveEntry = (keys: readonly string[]): ContextMenuEntry => {
    const heres = new Set(keys.map(hereOf));
    const moving = keys.filter((key) => itemByKey.get(key)?.type === 'folder').map(assetRel);
    return {
      id: 'move-to', label: t('media.moveTo'), icon: <FolderInput size={14} />,
      submenu: moveTargets(folders, moving).map((rel) => {
        const here = heres.size === 1 && heres.has(rel);
        return {
          id: `move:${rel}`, label: rel ? rel.split('/').join(' / ') : topName, checked: here, disabled: here,
          ...(here ? { hint: t('media.moveHere') } : {}),
          onSelect: () => { void moveAll(keys, rel); },
        };
      }),
    };
  };
  const fileMenu = (file: WorkspaceResource): ContextMenuEntry[] => [
    ...(fileRef && onRefer ? [
      { id: 'refer', label: t('host.refer'), icon: <MessageSquarePlus size={14} />, onSelect: () => onRefer(fileRef(file)) },
      { id: 'refer-sep', separator: true } as const,
    ] : []),
    ...commonEntries(file.path),
    ...(onSave ? [{ id: 'save', label: t('saved.add'), icon: <BookmarkPlus size={14} />, onSelect: () => onSave([file]) }] : []),
    { id: 'sep', separator: true } as const,
    ...linkEntries(file.path, false),
    /* web pages are the film's code, written by the person's agent (and named in each other's code): not renamed
       here; any file can be deleted, to the Trash, its clips with it */
    ...(file.kind === 'video' && onExtractAudio ? [{
      id: 'extract-audio', label: t('assets.extractAudio'), icon: <AudioLines size={14} />,
      onSelect: () => { void onExtractAudio(file.path).then((r) => { if (r !== 'ok') setNotice(t('assets.extractAudioFailed')); }); },
    }] : []),
    /* a page of the project is named in other pages' code (not renamed here); one of Saved is its own folder */
    ...(file.kind === 'mg' && !file.bundle ? [] : [{ id: 'rename', label: t('assets.rename'), icon: <Pencil size={14} />, onSelect: () => setRenaming(file.path) }]),
    moveEntry([file.path]),
    { id: 'delete', label: t('assets.delete'), icon: <Trash2 size={14} />, danger: true, onSelect: () => setConfirm({ targets: [{ path: file.path, folder: false }], name: file.name }) },
  ];
  const folderMenu = (rel: string, name: string): ContextMenuEntry[] => [
    ...commonEntries(`${root}/${rel}`),
    { id: 'sep', separator: true },
    ...linkEntries(`${root}/${rel}`, true),
    { id: 'rename', label: t('assets.rename'), icon: <Pencil size={14} />, onSelect: () => setRenaming(`${root}/${rel}`) },
    moveEntry([`${root}/${rel}`]),
    { id: 'delete', label: t('assets.delete'), icon: <Trash2 size={14} />, danger: true, onSelect: () => setConfirm({ targets: [{ path: `${root}/${rel}`, folder: true }], name }) },
  ];
  /** Several picked: what can be done to all of them at once. */
  const manyMenu = (keys: readonly string[]): ContextMenuEntry[] => [
    ...(onCollect && keys.some((key) => linkOf(key) && !linkOf(key)!.missing) ? [{
      id: 'collect', label: t('media.collect'), note: t('media.collectNote'), icon: <HardDriveDownload size={14} />,
      onSelect: () => { void collectAll(keys.filter((key) => linkOf(key) && !linkOf(key)!.missing)); },
    }] : []),
    ...(onSave && keys.some((key) => itemByKey.get(key)?.type === 'file') ? [{
      id: 'save', label: t('saved.add'), icon: <BookmarkPlus size={14} />,
      onSelect: () => onSave(keys.flatMap((key) => { const item = itemByKey.get(key); return item?.type === 'file' ? [item.file] : []; })),
    }] : []),
    moveEntry(keys),
    { id: 'sep', separator: true },
    { id: 'delete', label: t('media.deleteMany').replace('{n}', String(keys.length)), icon: <Trash2 size={14} />, danger: true, onSelect: () => askDelete(keys) },
  ];
  /* what Upload offers: a copy in the project, or a link to where the media is kept (a NAS, another disk); where
     nothing is linked (Saved), Upload picks the files to copy in at once */
  const importMenu: ContextMenuEntry[] = [
    { id: 'import', label: t('media.importFiles'), note: t('media.importFilesNote'), icon: <Upload size={14} />, onSelect: () => { void bringFrom('copy', false); } },
    { id: 'link', label: t('media.linkFiles'), note: t('media.linkFilesNote'), icon: <Link2 size={14} />, onSelect: () => { void bringFrom('link', false); } },
    { id: 'link-folder', label: t('media.linkFolder'), icon: <FolderSymlink size={14} />, onSelect: () => { void bringFrom('link', true); } },
  ];
  const blankMenu: ContextMenuEntry[] = [
    { id: 'new-folder', label: t('assets.newFolder'), icon: <FolderPlus size={14} />, onSelect: () => setCreating(true) },
    { id: 'import', label: t('media.import'), icon: <Plus size={14} />, onSelect: () => (onPick && onBring ? void bringFrom('copy', false) : inputRef.current?.click()) },
    ...(onPick && onBring && links ? [
      { id: 'link', label: t('media.linkFiles'), icon: <Link2 size={14} />, onSelect: () => { void bringFrom('link', false); } },
      { id: 'link-folder', label: t('media.linkFolder'), icon: <FolderSymlink size={14} />, onSelect: () => { void bringFrom('link', true); } },
    ] : []),
  ];
  /** The bar button a menu hangs from: a press on it is not outside the menu, and a click on it closes the menu. */
  const menuFrom = React.useRef<HTMLElement | null>(null);
  const openMenuAt = (e: { clientX: number; clientY: number }, items: ContextMenuEntry[], dense?: boolean) => {
    menuFrom.current = null;
    setMenu({ x: e.clientX, y: e.clientY, items, dense });
  };

  /* a click picks (lib/media-selection pickItem); the viewer shows the file clicked while it is picked, else the film */
  const press = (item: Item, e?: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => {
    const key = keyOf(item);
    const mods = { toggle: Boolean(e && (e.metaKey || e.ctrlKey)), range: Boolean(e?.shiftKey) };
    const next = pickItem(chosen, key, order, anchor.current, mods);
    if (!mods.range) anchor.current = key;
    setPicked(next);
    showFile(item.type === 'file' && next.includes(key) ? item.file : null);
    /* the keys are the pane's now (Delete, ⌘A), whatever was clicked */
    if (!gridRef.current?.contains(document.activeElement)) gridRef.current?.focus({ preventScroll: true });
  };
  /* a right-click on one of several picked is about all of them; on anything else, about it alone */
  const menuFor = (item: Item, e: React.MouseEvent) => {
    const key = keyOf(item);
    if (chosen.length > 1 && chosen.includes(key)) { openMenuAt(e, manyMenu(chosen)); return; }
    press(item);
    openMenuAt(e, item.type === 'folder' ? folderMenu(item.rel, item.name) : fileMenu(item.file));
  };
  /** What a drag of this item moves: every one picked when it is one of them. */
  const dragKeys = (key: string) => (chosen.length > 1 && chosen.includes(key) ? chosen : [key]);

  /* a box dragged over empty space picks what it touches (lib/media-selection); held near the top or bottom, the pane
     scrolls on under it */
  const [marquee, setMarquee] = React.useState<Box | null>(null);
  /** The click that ends a box is not a click on empty space (which lets go of what is picked). */
  const boxed = React.useRef(false);
  const startBox = (e: React.PointerEvent<HTMLDivElement>) => {
    boxed.current = false;
    const grid = e.currentTarget;
    const r0 = grid.getBoundingClientRect();
    if (e.button !== 0 || e.clientX - r0.left >= grid.clientWidth) return;
    if ((e.target as Element).closest('[data-media-path], [data-media-folder], [data-media-new-folder], [data-media-upload], button, input')) return;
    /* no text selected as it goes; the keys are the pane's */
    e.preventDefault();
    grid.focus({ preventScroll: true });
    const at = (x: number, y: number) => { const r = grid.getBoundingClientRect(); return { x: x - r.left + grid.scrollLeft, y: y - r.top + grid.scrollTop }; };
    const start = at(e.clientX, e.clientY);
    const add = e.metaKey || e.ctrlKey || e.shiftKey;
    const before = add ? chosen : [];
    const byKey = itemByKey;
    let pointer = { x: e.clientX, y: e.clientY };
    let live = false;
    let hits: string[] = before;
    const tiles = () => [...grid.querySelectorAll<HTMLElement>('[data-media-key]')].map((el) => {
      const r = el.getBoundingClientRect();
      const o = at(r.left, r.top);
      return { key: el.dataset.mediaKey!, box: { left: o.x, top: o.y, right: o.x + r.width, bottom: o.y + r.height } };
    });
    const update = () => {
      const now = at(pointer.x, pointer.y);
      if (!live && Math.hypot(now.x - start.x, now.y - start.y) < 4) return;
      live = true;
      const box = boxBetween(start, now);
      setMarquee(box);
      hits = boxPick(before, boxHits(tiles(), box), add);
      setPicked(hits);
    };
    let frame = 0;
    const tick = () => {
      const r = grid.getBoundingClientRect();
      const dy = pointer.y < r.top + 24 ? -Math.min(20, Math.ceil((r.top + 24 - pointer.y) / 3))
        : pointer.y > r.bottom - 24 ? Math.min(20, Math.ceil((pointer.y - r.bottom + 24) / 3)) : 0;
      if (live && dy) { grid.scrollTop += dy; update(); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const move = (ev: PointerEvent) => { pointer = { x: ev.clientX, y: ev.clientY }; update(); };
    const end = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      setMarquee(null);
      if (!live) return;
      boxed.current = true;
      anchor.current = hits.at(-1) ?? null;
      const only = hits.length === 1 ? byKey.get(hits[0]!) : undefined;
      showFile(only?.type === 'file' ? only.file : null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  const barMenu = (e: React.MouseEvent<HTMLElement>, items: ContextMenuEntry[]) => {
    const from = e.currentTarget;
    if (menu && menuFrom.current === from) { setMenu(null); menuFrom.current = null; return; }
    menuFrom.current = from;
    const r = from.getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 4, flipTo: r.top - 4, items, dense: true });
  };

  /* the bar at the pane's width (the whole pane is measured: the bar's own padding changes with it) */
  /* a callback ref: watched from when the element is there, however late it comes */
  const [rootEl, setRootEl] = React.useState<HTMLDivElement | null>(null);
  const [paneWidth, setPaneWidth] = React.useState(0);
  React.useEffect(() => {
    if (!rootEl || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setPaneWidth(Math.round(entry?.contentRect.width ?? 0)));
    ro.observe(rootEl);
    return () => ro.disconnect();
  }, [rootEl]);
  /* what the bar's words measure in this language and font (again once the fonts have loaded) */
  const [fontsTick, setFontsTick] = React.useState(0);
  React.useEffect(() => { void document.fonts?.ready.then(() => setFontsTick((n) => n + 1)); }, []);
  const hint = t('media.searchShort');
  const uploadWord = t('media.upload');
  const words = React.useMemo((): BarWords | null => {
    const ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    if (!rootEl || !ctx) return null;
    const family = getComputedStyle(rootEl).fontFamily;
    const measure = (text: string, weight: number) => { ctx.font = `${weight} 12.5px ${family}`; return ctx.measureText(text).width; };
    return { hint: measure(hint, 400), upload: measure(uploadWord, 500) };
  }, [hint, uploadWord, fontsTick, rootEl]);
  /* the fullest bar that fits (lib/media-bar); before the pane is measured, the full one */
  const bar = paneWidth > 0 && words
    ? barLayout(paneWidth, words, 5, Boolean(query))
    : { field: true, uploadWord: true, tight: false, cramped: false };
  const tight = bar.tight;
  const [searchOpen, setSearchOpen] = React.useState(false);
  /* a search opened (from the button, or a field too short to type in) is over the bar; one typed stays open */
  const searching = bar.cramped && (searchOpen || Boolean(query));

  const crumbs = at ? at.split('/') : [];
  const flat = Boolean(query.trim()) || view.filter !== 'all';
  const rows = view.layout === 'list';
  /* results come from every folder: where a name shows more than once, each says which folder it is in */
  const repeated = React.useMemo(() => {
    const seen = new Map<string, number>();
    if (flat) for (const item of items ?? []) if (item.type === 'file') seen.set(item.file.name, (seen.get(item.file.name) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([name]) => name));
  }, [flat, items]);

  /* a tile dropped on a folder tile or a crumb moves there. Passing from one part of the tile to another is not
     leaving it (the highlight would flicker) */
  /* a folder takes what is dragged onto it: a file or folder of this pane (moved), or files from the computer (copied
     in, there rather than into the folder open) */
  const dropProps = (intoRel: string) => ({
    onDragOver: (e: React.DragEvent) => {
      const inside = e.dataTransfer.types.includes(FOLDER_DRAG);
      if (!inside && !fromComputer(e.dataTransfer)) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = inside ? 'move' : 'copy';
      setDropTarget(intoRel);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDropTarget((cur) => (cur === intoRel ? null : cur));
    },
    onDrop: (e: React.DragEvent) => {
      const paths = e.dataTransfer.getData(FOLDER_DRAG);
      if (paths) {
        e.preventDefault(); e.stopPropagation(); setDropTarget(null);
        void moveAll(paths.split('\n').filter(Boolean), intoRel);
        return;
      }
      if (!fromComputer(e.dataTransfer) || !e.dataTransfer.files.length) return;
      e.preventDefault(); e.stopPropagation(); setDropTarget(null); setOsDrag(false);
      void importFiles([...e.dataTransfer.files], intoRel);
    },
  });

  const counts = React.useMemo(() => {
    const out: Record<Filter, number> = { all: 0, video: 0, image: 0, audio: 0, page: 0, other: 0 };
    for (const f of allFiles ?? []) { out.all += 1; out[filterOf(f)] += 1; }
    return out;
  }, [allFiles]);

  return (
    <div
      ref={setRootEl}
      className="relative flex h-full min-h-0 flex-col"
      /* the pane's keys, while they are its own (the timeline's Delete is the timeline's): Delete (or Backspace) asks to
         delete what is picked, as an editor's project panel does; Enter puts the one file picked on the timeline, as
         its "+" does; ⌘A picks everything shown; Esc lets go */
      onKeyDown={(e) => {
        if (renaming || confirm) return;
        if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"], button')) return;
        const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
        if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a' && order.length) {
          e.preventDefault();
          e.stopPropagation();
          setPicked(order);
          return;
        }
        if (!chosen.length) return;
        if (e.key === 'Escape' && plain) { setPicked([]); return; }
        const only = chosen.length === 1 ? itemByKey.get(chosen[0]!) : undefined;
        if (e.key === 'Enter' && onAdd && plain && only?.type === 'file' && canAdd(only.file)) {
          e.preventDefault();
          e.stopPropagation();
          onAdd(only.file);
          return;
        }
        if (e.key !== 'Delete' && e.key !== 'Backspace') return;
        e.preventDefault();
        e.stopPropagation();
        askDelete(chosen);
      }}
      /* files from the computer: a drag of this pane's own tiles is not one, whatever the browser adds to it (a picture
         dragged carries itself as a file) */
      onDragEnter={(e) => { if (fromComputer(e.dataTransfer)) { e.preventDefault(); setOsDrag(true); } }}
      onDragOver={(e) => { if (fromComputer(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setOsDrag(false); setDropTarget(null); } }}
      onDrop={(e) => {
        if (!fromComputer(e.dataTransfer) || !e.dataTransfer.files.length) return;
        e.preventDefault(); setOsDrag(false); setDropTarget(null);
        void importFiles([...e.dataTransfer.files]);
      }}
    >
      {/* the bar at the pane's width (lib/media-bar): the search field fills the room left; narrowing, Upload is its
          icon first, then the field shortens, then the search is a button that opens over the bar */}
      <div className={`relative flex shrink-0 items-center pb-1.5 pt-2.5 ${tight ? 'gap-0.5 px-2' : 'gap-1 px-2.5'}`}>
        {/* one field throughout: opened over the bar it is restyled, not made again, so it keeps the focus; there, its
            see-through fill is laid on the pane's own, so the buttons under it do not show */}
        {bar.field || searching ? (
          <label className={`flex h-7 min-w-0 items-center gap-1.5 rounded-md bg-[var(--bg-hover)] px-2 text-[12.5px] text-[var(--text-muted)] ${searching ? `absolute top-2.5 z-10 ${tight ? 'inset-x-2' : 'inset-x-2.5'} [background:linear-gradient(var(--bg-hover),var(--bg-hover)),var(--dock-pane)]` : 'flex-1'}`}>
            <Search size={13} className="shrink-0" />
            <input autoFocus={!bar.field} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={hint}
              onFocus={() => { if (bar.cramped) setSearchOpen(true); }}
              onBlur={() => { if (!query) setSearchOpen(false); }}
              onKeyDown={(e) => { if (e.key === 'Escape' && searching) { setQuery(''); setSearchOpen(false); e.currentTarget.blur(); } }}
              className="min-w-0 flex-1 bg-transparent text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]" />
            {query || searching ? (
              <button type="button" aria-label={t('media.clearSearch')} onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setQuery(''); setSearchOpen(false); }} className="shrink-0 hover:text-[var(--text)]"><X size={12} /></button>
            ) : null}
          </label>
        ) : null}
        {bar.field ? null : (
          /* the field down to its icon, still filling the room: clicked, it opens over the bar */
          <Tooltip label={t('media.search')} side="bottom">
            <button type="button" aria-label={t('media.search')} onClick={() => setSearchOpen(true)}
              className="flex h-7 min-w-7 flex-1 items-center justify-center rounded-md bg-[var(--bg-hover)] text-[var(--text-muted)] transition hover:text-[var(--text)]">
              <Search size={13} />
            </button>
          </Tooltip>
        )}
        {/* bringing media in is what this pane is for: the one labeled button, right after the search */}
        <Tooltip label={t('media.import')} side="bottom">
          <button type="button" aria-label={t('media.import')} aria-haspopup={onPick && onBring ? 'menu' : undefined}
            onClick={(e) => (onPick && onBring ? (links ? barMenu(e, importMenu) : void bringFrom('copy', false)) : inputRef.current?.click())}
            className={`flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md bg-[var(--bg-active)] text-[12.5px] font-medium text-[var(--text)] transition hover:bg-[var(--border-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-strong)] ${bar.uploadWord ? 'px-2.5' : 'w-7'}`}>
            <Upload size={13} strokeWidth={2.2} />
            {bar.uploadWord ? uploadWord : null}
          </button>
        </Tooltip>
        {/* Saved, the person's own library for every project: the pane shows it in place of the project's media, and back */}
        {onScope ? (
          <BarButton label={t(inSaved ? 'saved.back' : 'saved.title')} on={inSaved} onClick={() => onScope(inSaved ? 'project' : 'saved')}>
            <Bookmark size={14} {...(inSaved ? { fill: 'currentColor' } : {})} />
          </BarButton>
        ) : null}
        <BarButton label={t(rows ? 'media.viewGrid' : 'media.viewList')} onClick={() => setView((v) => ({ ...v, layout: rows ? 'grid' : 'list' }))}>
          {rows ? <LayoutGrid size={14} /> : <List size={14} />}
        </BarButton>
        <BarButton label={t('media.filter')} on={view.filter !== 'all'} onClick={(e) => barMenu(e, FILTERS.map((f) => ({
          id: f, label: `${t(`media.filter_${f}`)}  ${counts[f]}`, checked: view.filter === f, onSelect: () => setView((v) => ({ ...v, filter: f })),
        })))}><ListFilter size={14} /></BarButton>
        <BarButton label={t('media.sort')} onClick={(e) => barMenu(e, SORTS.map((key) => ({
          id: key, label: t(`media.sort_${key}`), checked: view.sort === key, onSelect: () => setView((v) => ({ ...v, sort: key })),
        })))}><ArrowUpDown size={14} /></BarButton>
        <BarButton label={t('assets.newFolder')} onClick={() => { setQuery(''); setView((v) => ({ ...v, filter: 'all' })); setCreating(true); }}><FolderPlus size={14} /></BarButton>
        {/* any kind of file: what Studio cannot play is still the project's material */}
        <input ref={inputRef} type="file" multiple className="hidden"
          onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ''; void importFiles(list); }} />
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
              {topName}
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

      {notice ? (
        <div className="mx-2.5 mb-2 flex shrink-0 items-start gap-2 rounded-md bg-[var(--bg-hover)] px-2 py-1.5 text-[12px] text-[var(--text-muted)]">
          <span className="min-w-0 flex-1">{notice}</span>
          <button type="button" aria-label={t('media.dismiss')} onClick={() => setNotice(null)}><X size={12} /></button>
        </div>
      ) : null}

      <div
        ref={gridRef}
        tabIndex={-1}
        className="relative min-h-0 flex-1 overflow-y-auto px-2.5 pb-3 pt-1 outline-none"
        onPointerDown={startBox}
        /* a click on empty space (around the tiles, or in the gaps between them) lets go of what is picked */
        onClick={(e) => {
          if (boxed.current) { boxed.current = false; return; }
          if (!(e.target as Element).closest('[data-media-path], [data-media-folder], [data-media-new-folder], button')) { setPicked([]); showFile(null); }
        }}
        onContextMenu={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); openMenuAt(e, blankMenu); } }}
      >
        {marquee ? (
          <div className="pointer-events-none absolute z-20 rounded-[2px] border border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]"
            style={{ left: marquee.left, top: marquee.top, width: marquee.right - marquee.left, height: marquee.bottom - marquee.top }} />
        ) : null}
        {items && !items.length && !creating && !(flat ? [] : uploads.filter((u) => u.into === at)).length ? (
          flat ? <p className="px-1 pt-6 text-center text-[12px] text-[var(--text-muted)]">{t('media.noMatch')}</p> : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
              <Clapperboard size={22} className="text-[var(--text-faint)]" />
              <div className="text-[13px] font-medium text-[var(--text)]">{t(at ? 'media.emptyFolder' : inSaved ? 'saved.emptyTitle' : 'media.emptyTitle')}</div>
              {at ? null : <p className="max-w-[30ch] text-[12px] leading-relaxed text-[var(--text-muted)]">{t(inSaved ? 'saved.emptyBody' : 'media.emptyBody')}</p>}
              <button type="button" onClick={() => (onPick && onBring ? void bringFrom('copy', false) : inputRef.current?.click())}
                className="mt-1 inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 text-[12.5px] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)]">
                <Plus size={13} />{t('media.import')}
              </button>
            </div>
          )
        ) : (
          <div className={rows ? '@container flex flex-col gap-px' : 'grid gap-x-2 gap-y-2.5'} style={rows ? undefined : { gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))' }}
            onContextMenu={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); openMenuAt(e, blankMenu); } }}>
            {rows ? (
              <div className="flex h-6 shrink-0 select-none items-center gap-2 px-1.5 text-[11px] text-[var(--text-faint)]">
                <span className="w-[46px] shrink-0" />
                <span className="min-w-0 flex-1 truncate">{t('media.sort_name')}</span>
                <span className={COL_TYPE}>{t('assets.propType')}</span>
                <span className={COL_DIMS}>{t('assets.propDimensions')}</span>
                <span className={COL_SIZE}>{t('assets.propSize')}</span>
                <span className={COL_DUR}>{t('assets.propDuration')}</span>
              </div>
            ) : null}
            {creating ? <NewFolderTile row={rows} label={t('assets.newFolder')} onDone={(name) => void makeFolder(name)} onCancel={() => setCreating(false)} /> : null}
            {pendingFolder && !pendingListed ? <NewFolderTile row={rows} label={pendingFolder} /> : null}
            {(items ?? []).map((item) => item.type === 'folder' ? (
              <FolderTile
                key={`d:${item.rel}`}
                row={rows}
                name={item.name}
                count={item.count}
                covers={item.covers}
                linked={Boolean(media?.linkedDirs?.[item.rel])}
                progress={progressInto(item.rel)}
                sources={sources}
                pickKey={`${root}/${item.rel}`}
                selected={chosen.includes(`${root}/${item.rel}`)}
                target={dropTarget === item.rel}
                renaming={renaming === `${root}/${item.rel}`}
                drop={dropProps(item.rel)}
                onDragStart={(e) => { e.dataTransfer.setData(FOLDER_DRAG, dragKeys(`${root}/${item.rel}`).join('\n')); e.dataTransfer.effectAllowed = 'move'; }}
                onPress={(e) => press(item, e)}
                onOpen={() => { setPicked([]); setAt(item.rel); }}
                onMenu={(e) => menuFor(item, e)}
                onRename={(name) => void rename(`${root}/${item.rel}`, name, true)}
                onCancelRename={() => setRenaming(null)}
              />
            ) : (
              <FileTile
                key={item.file.path}
                row={rows}
                file={item.file}
                sources={sources}
                duration={formatClipDuration(item.file.durationMs ?? 0)}
                where={repeated.has(item.file.name) ? item.file.path.slice(0, Math.max(0, item.file.path.lastIndexOf('/'))) || item.file.path : undefined}
                selected={chosen.includes(item.file.path)}
                lit={litPath === item.file.path}
                {...(item.file.link ? { linkLabel: item.file.link.missing ? t('media.linkMissing') : t('media.linkedFrom').replace('{path}', item.file.link.to) } : {})}
                {...(item.file.proxy ? { proxyLabel: proxyText(item.file.proxy), proxyMark: t('media.proxy') } : {})}
                renaming={renaming === item.file.path}
                {...(fileRef ? { studioRef: () => fileRef(item.file) } : {})}
                moving={() => dragKeys(item.file.path)}
                onPress={(e) => press(item, e)}
                typeText={item.file.bundle ? t(`saved.kind_${item.file.bundle.kind}`) : item.file.kind === 'mg' ? t('assets.kindPage') : extOf(item.file.name).toUpperCase()}
                library={inSaved}
                {...(item.file.bundle?.template ? { templateMark: t('saved.template') } : {})}
                onMenu={(e) => menuFor(item, e)}
                onRename={(name) => void rename(item.file.path, name, false)}
                onCancelRename={() => setRenaming(null)}
              />
            ))}
            {flat ? null : uploads.filter((u) => u.into === at).map((u) => <UploadTile key={u.id} upload={u} row={rows} />)}
          </div>
        )}
      </div>

      {/* over a folder, the folder shows where they go */}
      {osDrag && dropTarget == null ? (
        <div className="pointer-events-none absolute inset-1 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-[var(--accent)] bg-[var(--surface)]/80 text-[13px] text-[var(--text)]">
          {t('media.dropHint')}
        </div>
      ) : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} flipTo={menu.flipTo} items={menu.items} onClose={() => { setMenu(null); menuFrom.current = null; }} dense={menu.dense} trigger={menuFrom} /> : null}
      <ConfirmDialog
        open={moveAsk != null}
        title={t('media.moveAskTitle')}
        description={moveAsk ? `${t('media.moveAskBody')}\n\n${moveAsk.unseen.flatMap((u) => u.unseen.map((line) => `${u.file}: ${line}`)).slice(0, 6).join('\n')}` : ''}
        confirmLabel={t('media.moveAskConfirm')}
        cancelLabel={t('confirm.cancel')}
        onCancel={() => setMoveAsk(null)}
        onConfirm={() => { const ask = moveAsk; setMoveAsk(null); if (ask) void moveAll(ask.paths, ask.intoRel, true); }}
      />
      <ConfirmDialog
        open={confirm != null}
        title={!confirm ? '' : confirm.targets.length > 1 ? t('media.deleteManyTitle').replace('{n}', String(confirm.targets.length))
          : confirm.targets[0]?.folder ? t('media.deleteFolderTitle').replace('{name}', confirm.name) : t('assets.deleteConfirmTitle')}
        description={(() => {
          if (!confirm) return '';
          const many = confirm.targets.length > 1;
          const hits = usedSrcs.filter((src) => confirm.targets.some((x) => srcHitsAsset(src, x.path) || src.startsWith(`${x.path}/`))).length;
          if (!hits) return t(many ? 'media.deleteManyConfirm' : 'assets.deleteConfirm');
          if (many) return t(hits === 1 ? 'media.deleteManyAlsoClip' : 'media.deleteManyAlsoClips').replace('{n}', String(hits));
          return t(hits === 1 ? 'assets.deleteAlsoClip' : 'assets.deleteAlsoClips').replace('{n}', String(hits));
        })()}
        confirmLabel={t('assets.delete')}
        cancelLabel={t('confirm.cancel')}
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => { const asked = confirm; setConfirm(null); if (asked) void remove(asked.targets); }}
      />
    </div>
  );
}

function BarButton({ label, on, onClick, children }: { label: string; on?: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode }) {
  return (
    <Tooltip label={label} side="bottom">
      <button type="button" aria-label={label} onClick={onClick}
        /* two states, on and off: hovered, only the ground lights; an on button keeps its color */
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition hover:bg-[var(--bg-hover)] ${on ? 'text-[var(--accent)]' : 'text-[var(--text-dim)] hover:text-[var(--text)]'}`}>
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
/** A row of the list view, and its small picture. */
const ROW = 'group flex h-9 min-w-0 cursor-default select-none items-center gap-2 rounded-md px-1.5';
const ROW_THUMB = 'relative aspect-video h-[26px] shrink-0 overflow-hidden rounded-[4px] bg-[var(--bg-hover)] ring-1 ring-[var(--border)]';
/* the list's columns of facts, right of the name, as many as the pane is wide for (a container query on the list):
   the length always (a folder's count there), the size, the kind and the picture's size as it widens */
const COL = 'shrink-0 truncate text-right text-[11px] tabular-nums text-[var(--text-faint)]';
const COL_TYPE = `${COL} hidden w-11 @min-[340px]:block`;
const COL_DIMS = `${COL} hidden w-[76px] @min-[240px]:block`;
const COL_SIZE = `${COL} hidden w-14 @min-[410px]:block`;
const COL_DUR = `${COL} w-12`;
/** A file name's ending, without the dot (`png`), or '' when it has none. */
const extOf = (name: string) => /\.([^./\s]{1,8})$/.exec(name)?.[1] ?? '';

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
  /** Files on their way into it: their progress together, a bar along its cover. */
  progress?: number | undefined;
  /** A link to a folder kept elsewhere (a NAS). */
  linked?: boolean;
  /** Its key in what is picked (its path). */
  pickKey: string;
  selected: boolean; target: boolean; renaming: boolean;
  drop: { onDragOver: (e: React.DragEvent) => void; onDragLeave: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void };
  onDragStart: (e: React.DragEvent) => void;
  onPress: (e: React.MouseEvent) => void; onOpen: () => void; onMenu: (e: React.MouseEvent) => void;
  onRename: (name: string) => void; onCancelRename: () => void;
  /** A row of the list view, not a tile. */
  row?: boolean;
}) {
  const on = p.target || p.selected;
  const cells = p.covers.length;
  if (p.row) {
    return (
      <div className={`${ROW} ${on ? 'bg-[var(--bg-active)]' : 'hover:bg-[var(--bg-hover)]'} ${p.target ? 'ring-1 ring-inset ring-[var(--accent)]' : ''}`}
        data-media-folder="" data-media-key={p.pickKey} draggable={!p.renaming} onDragStart={p.onDragStart}
        onClick={p.onPress} onDoubleClick={p.onOpen} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); p.onMenu(e); }} {...p.drop}>
        <span className={ROW_THUMB}>
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {p.target ? <FolderOpen size={15} className="text-[var(--accent)]" /> : p.linked ? <FolderSymlink size={15} className="text-[var(--text-muted)]" /> : <Folder size={15} className="text-[var(--text-muted)]" />}
          </span>
          {p.progress != null ? <UploadBar ratio={p.progress} /> : null}
        </span>
        <span className="min-w-0 flex-1">
          {p.renaming ? <NameInput value={p.name} onDone={p.onRename} onCancel={p.onCancelRename} />
            : <span className={`block truncate text-[12.5px] font-medium ${on ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'}`} style={KEEP_SPACES}>{p.name}</span>}
        </span>
        <span className={COL_TYPE} />
        <span className={COL_DIMS} />
        <span className={COL_SIZE} />
        <span className={COL_DUR}>{p.count ? String(p.count) : ''}</span>
      </div>
    );
  }
  const grid = cells >= 4 ? 'grid-cols-2 grid-rows-2' : cells === 3 ? 'grid-cols-2 grid-rows-2' : cells === 2 ? 'grid-cols-2 grid-rows-1' : 'grid-cols-1 grid-rows-1';
  return (
    <div className="group min-w-0 cursor-default select-none" data-media-folder="" data-media-key={p.pickKey} draggable={!p.renaming} onDragStart={p.onDragStart}
      onClick={p.onPress} onDoubleClick={p.onOpen} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); p.onMenu(e); }} {...p.drop}>
      <div className="relative pt-[7px]">
        {/* the stack: two cards peeking out above the cover */}
        <span aria-hidden className="absolute inset-x-[14%] top-0 h-3 rounded-t-md bg-[var(--fill-tsp,rgba(127,127,127,0.18))] opacity-60" />
        <span aria-hidden className="absolute inset-x-[7%] top-[3px] h-3 rounded-t-md bg-[var(--fill-tsp,rgba(127,127,127,0.18))]" />
        <div className={`${TILE_BOX} bg-[var(--bg-hover)] shadow-[0_1px_0_rgba(255,255,255,0.06)_inset] ${on ? 'ring-[var(--accent)]' : 'ring-transparent group-hover:ring-[var(--border)]'} ${p.target ? 'scale-[1.03]' : ''}`}>
          {cells ? (
            <div className={`pointer-events-none absolute inset-0 grid gap-px bg-black/40 ${grid}`}>
              {p.covers.map((file, i) => (
                <span key={file.path} className={`relative overflow-hidden bg-[var(--bg-hover)] ${cells === 3 && i === 0 ? 'row-span-2' : ''}`}>
                  {file.kind === 'mg' ? <PagePoster file={file} sources={p.sources} /> : <MediaPreview file={file} sources={p.sources} />}
                </span>
              ))}
            </div>
          ) : <FolderGlyph open={p.target} />}
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 to-transparent" />
          {p.progress != null ? <UploadBar ratio={p.progress} /> : null}
          <span className="pointer-events-none absolute bottom-1 left-1.5 flex items-center gap-1 text-[10.5px] font-medium text-white/90">
            {p.target ? <FolderOpen size={11} /> : p.linked ? <FolderSymlink size={11} /> : <Folder size={11} />}
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

/** The folder being named; without `onDone`, one just named and on its way (its name, not a field). */
function NewFolderTile({ label, onDone, onCancel, row = false }: { label: string; onDone?: (name: string) => void; onCancel?: () => void; row?: boolean }) {
  if (row) {
    return (
      <div className={`${ROW} bg-[var(--bg-hover)]`} data-media-new-folder="">
        <span className={`${ROW_THUMB} ring-[var(--accent)]`}>
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center"><Folder size={15} className="text-[var(--text-muted)]" /></span>
        </span>
        <span className="min-w-0 flex-1">
          {onDone ? <NameInput value={label} onDone={onDone} onCancel={onCancel ?? (() => {})} />
            : <span className="block truncate text-[12.5px] font-medium text-[var(--text)]" style={KEEP_SPACES}>{label}</span>}
        </span>
      </div>
    );
  }
  return (
    <div className="min-w-0" data-media-new-folder="">
      <div className="relative pt-[7px]">
        <span aria-hidden className="absolute inset-x-[14%] top-0 h-3 rounded-t-md bg-[var(--fill-tsp,rgba(127,127,127,0.18))] opacity-60" />
        <span aria-hidden className="absolute inset-x-[7%] top-[3px] h-3 rounded-t-md bg-[var(--fill-tsp,rgba(127,127,127,0.18))]" />
        <div className={`${TILE_BOX} bg-[var(--bg-hover)] ring-[var(--accent)]`}><FolderGlyph /></div>
      </div>
      <div className="mt-1 min-w-0 px-0.5">
        {onDone ? <NameInput value={label} onDone={onDone} onCancel={onCancel ?? (() => {})} />
          : <div className="truncate text-[12px] font-medium text-[var(--text)]" style={KEEP_SPACES}>{label}</div>}
      </div>
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
  /** What a drag of it moves into a folder: it, or every one picked with it. */
  moving: () => readonly string[];
  onPress: (e?: React.MouseEvent) => void; onMenu: (e: React.MouseEvent) => void; onRename: (name: string) => void; onCancelRename: () => void;
  /** A link to media kept elsewhere: what to say of it (where it is kept, or that it cannot be reached). */
  linkLabel?: string;
  /** Heavy footage's proxy: what to say of it (being made, ready…), and its mark once ready. */
  proxyLabel?: string;
  proxyMark?: string;
  /** What kind of file it is, short (`PNG`, `Page`): the list view's Type. */
  typeText: string;
  /** A row of the list view, not a tile. */
  row?: boolean;
  /** In Saved: a drag of it says its place there (its files are brought into the project as it lands). */
  library?: boolean;
  /** A bundle of Saved whose page has custom properties: the word that marks it a template. */
  templateMark?: string;
}) {
  const bundle = p.file.bundle;
  return (
    <div
      className={p.row
        ? `${ROW} outline-none ${p.lit ? 'ring-1 ring-inset ring-[var(--tl-accent)]' : ''} ${p.selected ? 'bg-[var(--bg-active)]' : 'hover:bg-[var(--bg-hover)]'}`
        : 'group min-w-0 cursor-default select-none outline-none'}
      data-media-path={p.file.path}
      data-media-key={p.file.path}
      data-chat-lit={p.lit ? '' : undefined}
      title={p.where ? p.file.path : p.file.name}
      draggable={!p.renaming}
      /* a drag picks nothing: picking opens the inspector, and the pane laid out again under the pointer (or hidden for
         room) would lose the drag */
      onDragStart={(e) => {
        setResourceDragData(e.dataTransfer, p.library ? { ...p.file, saved: p.file.path } : p.file);
        if (p.studioRef) e.dataTransfer.setData(STUDIO_REF_TYPE, JSON.stringify([p.studioRef()]));
        /* any file can go into a folder of this pane: a page's links are written again as it moves (Studio) */
        e.dataTransfer.setData(FOLDER_DRAG, p.moving().join('\n'));
        e.dataTransfer.effectAllowed = 'copyMove';
      }}
      onDragEnd={() => clearResourceDrag()}
      /* focusable, so the keys pressed after picking it are the pane's (Delete asks to delete it) */
      tabIndex={-1}
      onClick={(e) => { e.currentTarget.focus({ preventScroll: true }); p.onPress(e); }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); p.onMenu(e); }}
    >
      {p.row ? (
        <>
          <span className={`${ROW_THUMB} pointer-events-none`}>
            {p.file.kind === 'mg' ? <PagePoster file={p.file} sources={p.sources} /> : <MediaPreview file={p.file} sources={p.sources} />}
            {p.file.proxy && p.file.proxy.state !== 'ready' && p.file.proxy.state !== 'failed' ? <UploadBar ratio={p.file.proxy.state === 'making' ? p.file.proxy.ratio ?? 0 : -1} /> : null}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            {p.renaming ? <NameInput value={p.file.name} onDone={p.onRename} onCancel={p.onCancelRename} />
              : (
                <span className="flex min-w-0 items-center gap-1" title={p.linkLabel}>
                  {p.file.link ? (p.file.link.missing ? <Unlink size={12} className="shrink-0 text-[var(--danger,#e5484d)]" /> : <Link2 size={12} className="shrink-0 text-[var(--text-faint)]" />) : null}
                  <span className={`block truncate text-[12.5px] ${p.file.link?.missing ? 'text-[var(--text-faint)]' : p.selected ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'}`} style={KEEP_SPACES}>{p.file.name}</span>
                </span>
              )}
            {p.where ? <span className="block truncate text-left text-[11px] text-[var(--text-faint)]" dir="rtl"><bdi>{p.where}</bdi></span> : null}
          </span>
          <span className={COL_TYPE}>{p.typeText}</span>
          <span className={COL_DIMS}>{p.file.w && p.file.h ? `${p.file.w} × ${p.file.h}` : ''}</span>
          <span className={COL_SIZE}>{p.file.size ? formatFileSize(p.file.size) : ''}</span>
          <span className={COL_DUR}>{p.duration}</span>
        </>
      ) : <>
      {/* the same room above as a folder's stacked cards, so covers and names line up across a row */}
      <div className="pt-[7px]">
        <div className={`${TILE_BOX} bg-[var(--bg-hover)] ${p.lit ? 'ring-[var(--tl-accent)] shadow-[0_0_10px_1px_color-mix(in_srgb,var(--tl-accent)_55%,transparent)]' : p.selected ? 'ring-[var(--accent)]' : 'ring-transparent group-hover:ring-[var(--border)]'}`}>
          {p.file.kind === 'mg' ? <PagePoster file={p.file} sources={p.sources} /> : <MediaPreview file={p.file} sources={p.sources} />}
          {/* a link to media kept elsewhere: marked; one that cannot be reached (a NAS that is off) says so over it */}
          {p.file.link?.missing ? (
            <span className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-black/65 text-[10.5px] text-white/85" title={p.linkLabel}>
              <Unlink size={16} />{p.linkLabel}
            </span>
          ) : p.file.link ? (
            <span className="absolute bottom-1 left-1 z-10 flex h-4 w-4 items-center justify-center rounded bg-black/65 text-white" title={p.linkLabel}><Link2 size={10} /></span>
          ) : null}
          {/* heavy footage's proxy: its making along the bottom, then a mark */}
          {p.file.proxy?.state === 'ready' ? (
            <span className="absolute right-1 top-1 z-10 rounded bg-black/65 px-1 text-[9.5px] font-semibold uppercase leading-[15px] tracking-wide text-white/90" title={p.proxyLabel}>{p.proxyMark}</span>
          ) : p.file.proxy && p.file.proxy.state !== 'failed' ? (
            <span className="absolute inset-x-0 bottom-0 z-10 h-1" title={p.proxyLabel}><UploadBar ratio={p.file.proxy.state === 'making' ? p.file.proxy.ratio ?? 0 : -1} /></span>
          ) : null}
          {/* a bundle of Saved: a template, and how many clips a group holds */}
          {p.templateMark ? (
            <span className="absolute left-1 top-1 z-10 flex items-center gap-0.5 rounded bg-black/65 px-1 text-[9.5px] font-semibold leading-[15px] text-white/90"><LayoutTemplate size={9} />{p.templateMark}</span>
          ) : null}
          {bundle?.kind === 'group' && bundle.count ? (
            <span className="absolute bottom-1 left-1 z-10 flex items-center gap-0.5 rounded bg-black/65 px-1 text-[10.5px] tabular-nums leading-[16px] text-white"><Layers size={10} />{bundle.count}</span>
          ) : null}
          {p.duration ? <span className="absolute bottom-1 right-1 z-10 rounded bg-black/65 px-1 text-[10.5px] tabular-nums leading-[16px] text-white">{p.duration}</span> : null}
        </div>
      </div>
      <div className="mt-1 min-w-0 px-0.5">
        {p.renaming ? <NameInput value={p.file.name} onDone={p.onRename} onCancel={p.onCancelRename} />
          : <div className={`truncate text-[12px] ${p.selected ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'}`} style={KEEP_SPACES}>{p.file.name}</div>}
        {p.where ? <div className="truncate text-left text-[11px] text-[var(--text-faint)]" dir="rtl"><bdi>{p.where}</bdi></div> : null}
      </div>
      </>}
    </div>
  );
}

/** How much of a file is in: a bar along the bottom of its card. */
function UploadBar({ ratio }: { ratio: number }) {
  /* below 0: how much is in is not known (a copy made on this computer): the bar pulses */
  return (
    <span className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-1 bg-black/35">
      <span className={`block h-full bg-[var(--accent)] transition-[width] duration-200 ${ratio < 0 ? 'animate-pulse' : ''}`} style={{ width: `${ratio < 0 ? 100 : Math.round(ratio * 100)}%` }} />
    </span>
  );
}

/** A file on its way in, where it will be: a picture shows itself, anything else its icon; its progress inside. */
function UploadTile({ upload, row }: { upload: Upload; row: boolean }) {
  const pct = upload.ratio < 0 ? '' : `${Math.round(upload.ratio * 100)}%`;
  const Icon = KIND_ICON[upload.kind];
  const picture = upload.preview
    ? <img src={upload.preview} alt="" className="absolute inset-0 h-full w-full object-contain opacity-45" />
    : <span className="absolute inset-0 flex items-center justify-center"><Icon size={row ? 14 : 24} className="text-[var(--text-faint)]" /></span>;
  if (row) {
    return (
      <div className={ROW} data-media-upload="">
        <span className={ROW_THUMB}>{picture}<UploadBar ratio={upload.ratio} /></span>
        <span className="block min-w-0 flex-1 truncate text-[12.5px] text-[var(--text-muted)]" style={KEEP_SPACES}>{upload.name}</span>
        <span className={COL_DUR}>{pct}</span>
      </div>
    );
  }
  return (
    <div className="min-w-0 cursor-default select-none" data-media-upload="">
      <div className="pt-[7px]">
        <div className={`${TILE_BOX} bg-[var(--bg-hover)] ring-transparent`}>
          {picture}
          <span className="absolute inset-0 flex items-center justify-center text-[12px] font-medium tabular-nums text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.7)]">{pct}</span>
          <UploadBar ratio={upload.ratio} />
        </div>
      </div>
      <div className="mt-1 min-w-0 px-0.5">
        <div className="truncate text-[12px] text-[var(--text-muted)]" style={KEEP_SPACES}>{upload.name}</div>
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
  /* drawn in the headless browser: asked for in turn with Studio's other media (lib/media-queue), once near the screen */
  const [nearRef, near] = useNearViewport<HTMLSpanElement>();
  const turn = useMediaImage(own && failed !== own ? own : null, near);
  const src = turn && failed !== turn ? turn : null;
  const shown = src != null && loaded != null;
  return (
    <span ref={nearRef} className="absolute inset-0">
      {shown ? null : <span className="absolute inset-0 flex items-center justify-center"><Clapperboard size={20} className="text-[var(--text-muted)]" /></span>}
      {src ? (
        <img src={src} alt="" onLoad={() => setLoaded(src)}
          onError={(e) => { setLoaded(null); retryImage(e.currentTarget, () => setFailed(src)); }}
          className={`absolute inset-0 h-full w-full object-cover ${shown ? '' : 'invisible'}`} />
      ) : null}
    </span>
  );
}
