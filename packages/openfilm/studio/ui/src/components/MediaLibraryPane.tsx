/**
 * A folder of the person's own, at a project's side (the assets drawer's My media, under Saved): one of the folders
 * of this computer they keep media in, shown as it is on the disk, to take media from (lib/media-library;
 * studio/server/media-library.mjs). The drawer's side bar lists Saved and these folders, adds one and stops showing
 * one (`useMyFolders`); this pane is the folder picked there. Nothing is copied or moved by looking: a file comes into
 * the project as it is used.
 *
 * Its own folders open inside it. The search looks through all of My media: Saved's files, then every folder. A video
 * is looked through by moving the pointer across its tile. A click watches a file in the project's viewer (where its
 * inspector says which projects use it and how it was made), a double-click or Enter puts it in the film, a drag
 * takes it onto the timeline. Its menu points it at for the agent, shows it in the file manager, renames it where it
 * is, moves it to Saved or another folder, or moves it to the trash, as the file manager does.
 */
import React from 'react';
import { ChevronRight, Clapperboard, Folder, FolderInput, FolderOpen, MessageSquarePlus, Pencil, Plus, Search, Trash2, Unplug, X } from 'lucide-react';
import { useT } from '@/i18n';
import { clearResourceDrag, dragPicture, setResourceDragData } from '@/lib/resource-drag';
import { factsOf, knownFacts, libraryApi, libraryRef, referenceOf, resourceOf, sourcesOf, type LibraryFile, type LibraryFolder, type LibraryFound, type LibraryListing } from '@/lib/media-library';
import { refreshSaved } from '@/lib/saved';
import { formatClipDuration, formatFileSize, type MediaFacts, type MediaSources, type WorkspaceResource } from '@/lib/workspace-resources';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { MediaPreview } from './MediaPreview';

/** A tile is at least this wide; a row holds as many as fit. */
const TILE_MIN = 104;
const GAP = 12;
const PAD = 10;
/** Under a tile's picture: its name and a line of facts. */
const TILE_TEXT = 44;
/** How many found files are asked for at once. */
const FOUND_MAX = 600;
/** Saved, as a place of My media. */
export const SAVED_PLACE = 'saved';

/** A file shown: in its place; `where`, when it was found rather than opened to (its folder, to read). */
type Shown = { file: LibraryFile; place: string; where?: string };
type Item = { type: 'dir'; name: string; path: string; items: number } | ({ type: 'file' } & Shown);
const sameFile = (a: Shown | null, b: Shown) => Boolean(a && a.place === b.place && a.file.path === b.file.path);

/** Where each place's pictures, sounds and bytes come from, made once a place. */
const SOURCES = new Map<string, MediaSources>();
const sourcesFor = (place: string): MediaSources => SOURCES.get(place) ?? (SOURCES.set(place, sourcesOf(place)), SOURCES.get(place)!);

/**
 * The folders the person added, read again as the window comes back (a disk may have been plugged in): to list in the
 * drawer's side bar, add to (the system's dialog) and stop showing (the folder stays on the disk as it is).
 */
export function useMyFolders(on: boolean) {
  const [folders, setFolders] = React.useState<LibraryFolder[] | null>(null);
  const read = React.useCallback(async () => {
    const next = await libraryApi.places();
    if (next) setFolders(next.folders);
    return next?.folders ?? null;
  }, []);
  React.useEffect(() => {
    if (!on) return undefined;
    void read();
    const back = () => { void read(); };
    window.addEventListener('focus', back);
    return () => window.removeEventListener('focus', back);
  }, [on, read]);
  /**
   * A folder picked in the system's dialog and added: its place, null when none was picked; `wide` or `failed` when
   * it could not be (a disk's top, the home folder: far more than media).
   */
  const add = React.useCallback(async (title: string): Promise<string | null | { error: 'wide' | 'failed' }> => {
    try {
      const added = await libraryApi.addFolder(title);
      const next = await read();
      return added ? next?.find((f) => f.path === added)?.place ?? null : null;
    } catch (e) { return { error: (e as { reason?: string }).reason === 'wide' ? 'wide' : 'failed' }; }
  }, [read]);
  const remove = React.useCallback(async (path: string) => { await libraryApi.removeFolder(path); await read(); }, [read]);
  return { folders, add, remove };
}

/** What My media holds that fits the words: asked a moment after the last key, and again while it is still being read. */
function useSearch(q: string, again: number): LibraryFound | null {
  const [state, setState] = React.useState<{ key: string; found: LibraryFound } | null>(null);
  const key = q.trim();
  const [more, setMore] = React.useState(0);
  React.useEffect(() => {
    if (!key) return undefined;
    let live = true;
    let later = 0;
    const timer = window.setTimeout(() => {
      void libraryApi.search({ q: key, saved: true, sort: 'name', limit: FOUND_MAX }).then((found) => {
        if (!live || !found) return;
        setState({ key, found });
        if (found.scanning) later = window.setTimeout(() => setMore((n) => n + 1), 2500);
      });
    }, 180);
    return () => { live = false; window.clearTimeout(timer); window.clearTimeout(later); };
  }, [key, again, more]);
  return key && state?.key === key ? state.found : null;
}

/**
 * A folder's listing, read once per visit and again when asked (`again`): what was read of it stays shown while it
 * is read again, so nothing jumps when a file in it is renamed.
 */
function useListing(place: string | null, dir: string, again: number) {
  const [state, setState] = React.useState<{ key: string; listing: LibraryListing | null; gone: boolean } | null>(null);
  const key = `${place}\n${dir}`;
  React.useEffect(() => {
    if (!place) { setState(null); return undefined; }
    let live = true;
    void libraryApi.list(place, dir).then((listing) => { if (live) setState({ key, listing, gone: !listing }); });
    return () => { live = false; };
  }, [place, dir, again]); // eslint-disable-line react-hooks/exhaustive-deps
  return state?.key === key ? state : null;
}

export function MediaLibraryPane({ folder, folders, selected, onPick, onAdd, onRefer }: {
  /** the folder picked in the side bar */
  folder: LibraryFolder;
  /** every folder added, to move a file to */
  folders: readonly LibraryFolder[];
  /** the reference of the file the viewer shows, when it is one of My media's */
  selected: string | null;
  onPick: (file: WorkspaceResource | null) => void;
  onAdd: (file: WorkspaceResource) => void;
  onRefer?: ((file: WorkspaceResource) => void) | undefined;
}) {
  const t = useT();
  const [dir, setDir] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [picked, setPicked] = React.useState<Shown | null>(null);
  const [again, setAgain] = React.useState(0);
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState<{ place: string; path: string; name: string } | null>(null);
  const [trashing, setTrashing] = React.useState<{ place: string; file: LibraryFile; linked: string[] } | null>(null);

  /* another folder picked in the side bar: its top; the window back: read again (a folder changed in the file manager) */
  React.useEffect(() => { setDir(''); setQuery(''); }, [folder.place]);
  React.useEffect(() => {
    const back = () => setAgain((n) => n + 1);
    window.addEventListener('focus', back);
    return () => window.removeEventListener('focus', back);
  }, []);
  /* what the viewer shows went elsewhere: nothing here is picked */
  React.useEffect(() => { if (!selected) setPicked(null); }, [selected]);

  const searching = Boolean(query.trim());
  const listing = useListing(searching || folder.missing ? null : folder.place, dir, again);
  const found = useSearch(query, again);
  const items = React.useMemo((): Item[] => {
    if (searching) return (found?.files ?? []).map((file) => ({ type: 'file' as const, file, place: file.place, where: file.where }));
    if (!listing?.listing) return [];
    return [...listing.listing.dirs.map((d) => ({ type: 'dir' as const, ...d })), ...listing.listing.files.map((file) => ({ type: 'file' as const, file, place: folder.place }))];
  }, [searching, found, listing, folder.place]);
  const crumbs = !searching && dir ? dir.split('/') : [];
  /* the file the viewer shows, as it is when a menu's choice is done (the menu was made in the click that picked it) */
  const shownNow = React.useRef(selected);
  shownNow.current = selected;
  const unpick = (place: string, path: string) => {
    setPicked((p) => (p?.place === place && p.file.path === path ? null : p));
    if (shownNow.current === libraryRef(place, path)) onPick(null);
  };

  /* what is known of its length goes with it: a clip on the timeline is as long as its file */
  const withFacts = async (place: string, file: LibraryFile) => { await factsOf(place, file); return referenceOf(place, file); };
  const askTrash = async (place: string, file: LibraryFile) => {
    const about = await libraryApi.about(place, file.path);
    setTrashing({ place, file, linked: about?.linkedBy.map((p) => p.name) ?? [] });
  };
  const moveTo = async (place: string, file: LibraryFile, to: string) => {
    const moved = await libraryApi.move(place, file.path, to);
    if (!moved) { setNotice(t('mediaLibrary.moveFailed')); return; }
    unpick(place, file.path);
    if (place === SAVED_PLACE || to === SAVED_PLACE) refreshSaved();
    setAgain((n) => n + 1);
  };
  /* Saved first, then the folders; where the file is now (the top of its folder) is no place to move it */
  const moveEntry = (place: string, file: LibraryFile): ContextMenuEntry => ({
    id: 'move-to', label: t('media.moveTo'), icon: <FolderInput size={14} />,
    submenu: [{ place: SAVED_PLACE, name: t('saved.title') }, ...folders.filter((f) => !f.missing)].map((f) => {
      const here = f.place === place && !file.path.includes('/');
      return { id: `move:${f.place}`, label: f.name, checked: here, disabled: here, ...(here ? { hint: t('media.moveHere') } : {}), onSelect: () => { void moveTo(place, file, f.place); } };
    }),
  });
  const use: TileUse = {
    onAdd: (place, file) => { void withFacts(place, file).then(onAdd); },
    onMenu: (e, place, file) => setMenu({ x: e.clientX, y: e.clientY, items: [
      { id: 'add', label: t('mediaLibrary.addToFilm'), icon: <Plus size={14} />, onSelect: () => { void withFacts(place, file).then(onAdd); } },
      ...(onRefer ? [{ id: 'refer', label: t('host.refer'), icon: <MessageSquarePlus size={14} />, onSelect: () => { void withFacts(place, file).then(onRefer); } }] : []),
      { id: 'reveal', label: t('projects.revealFolder'), icon: <FolderOpen size={14} />, onSelect: () => libraryApi.reveal(place, file.path) },
      { id: 'tend-sep', separator: true } as const,
      /* Saved's files are renamed and taken away in Saved */
      ...(place === SAVED_PLACE ? [] : [{ id: 'rename', label: t('assets.rename'), icon: <Pencil size={14} />, onSelect: () => { setNotice(null); setRenaming({ place, path: file.path, name: file.name }); } }]),
      moveEntry(place, file),
      ...(place === SAVED_PLACE ? [] : [{ id: 'trash', label: t('mediaLibrary.discard'), icon: <Trash2 size={14} />, danger: true, onSelect: () => { void askTrash(place, file); } }]),
    ] }),
  };
  const rename = async (to: string) => {
    const was = renaming;
    setRenaming(null);
    const clean = to.trim();
    if (!was || !clean || clean === was.name) return;
    try {
      await libraryApi.rename(was.place, was.path, clean);
      unpick(was.place, was.path);
      setAgain((n) => n + 1);
    } catch (e) {
      const reason = (e as { reason?: string }).reason;
      setNotice(t(reason === 'taken' ? 'assets.renameTaken' : reason === 'kind' ? 'mediaLibrary.renameKind' : 'mediaLibrary.renameFailed'));
    }
  };
  const pick = (next: Shown | null) => {
    setPicked(next);
    onPick(next ? referenceOf(next.place, next.file) : null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-media-library-pane="" data-drag-home="">
      <div className="flex shrink-0 items-center gap-1.5 px-2.5 pb-1.5 pt-2.5">
        {/* in all of My media at once: by name, by folder, by the words a picture or clip was made with */}
        <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-[var(--bg-hover)] px-2 text-[12.5px] text-[var(--text-muted)]">
          <Search size={13} className="shrink-0" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('mediaLibrary.search')} aria-label={t('mediaLibrary.search')}
            onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); } }}
            className="min-w-0 flex-1 bg-transparent text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]" />
          {query ? <button type="button" aria-label={t('media.clearSearch')} onClick={() => setQuery('')} className="shrink-0 hover:text-[var(--text)]"><X size={12} /></button> : null}
        </label>
      </div>
      {/* where it is: the folder, and the folders inside it opened */}
      <div className="flex h-6 shrink-0 items-center gap-0.5 overflow-hidden px-2.5 text-[12px]" data-library-crumbs="">
        {searching ? <span className="px-1 font-medium text-[var(--text)]">{t('mediaLibrary.results')}</span> : (
          <>
            <button type="button" onClick={() => setDir('')} className={`shrink-0 rounded px-1 ${crumbs.length ? 'text-[var(--text-muted)] hover:text-[var(--text)]' : 'font-medium text-[var(--text)]'}`}>{folder.name}</button>
            {crumbs.map((part, i) => (
              <React.Fragment key={crumbs.slice(0, i + 1).join('/')}>
                <ChevronRight size={11} className="shrink-0 text-[var(--text-faint)]" />
                <button type="button" onClick={() => setDir(crumbs.slice(0, i + 1).join('/'))}
                  className={`min-w-0 truncate rounded px-1 ${i === crumbs.length - 1 ? 'font-medium text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>{part}</button>
              </React.Fragment>
            ))}
          </>
        )}
      </div>
      {notice ? <p role="alert" className="shrink-0 px-3 pb-1 text-[12px] leading-snug text-[var(--err)]">{notice}</p> : null}
      {searching && found && !items.length ? (
        <Blank icon={<Search size={22} strokeWidth={1.5} />} title={t('mediaLibrary.noneFound')} {...(found.scanning ? { body: t('mediaLibrary.stillReading') } : {})} />
      ) : !searching && (listing?.gone || folder.missing) ? (
        <Blank icon={<Unplug size={22} strokeWidth={1.5} />} title={t('mediaLibrary.offlineTitle')} body={t('mediaLibrary.offlineBody')} />
      ) : !searching && listing && !items.length ? (
        <Blank icon={<Clapperboard size={22} strokeWidth={1.5} />} title={t('mediaLibrary.noMedia')} />
      ) : (searching ? found : listing) ? (
        <Grid key={searching ? `found\n${query}` : `${folder.place}\n${dir}`} items={items} picked={picked} renaming={renaming}
          onOpen={setDir} onPick={pick} onRename={(to) => void rename(to)} onStopRename={() => setRenaming(null)} use={use} />
      ) : <div className="flex-1" />}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} dense /> : null}
      <ConfirmDialog
        open={Boolean(trashing)}
        title={t('mediaLibrary.discardTitle').replace('{name}', trashing?.file.name ?? '')}
        description={trashing?.linked.length
          ? t('mediaLibrary.discardLinked').replace('{projects}', trashing.linked.join(t('settings.plugins.sep')))
          : t('mediaLibrary.discardBody')}
        confirmLabel={t('mediaLibrary.discard')}
        cancelLabel={t('confirm.cancel')}
        danger
        onCancel={() => setTrashing(null)}
        onConfirm={() => {
          const was = trashing;
          setTrashing(null);
          if (!was) return;
          void libraryApi.trash(was.place, was.file.path).then((ok) => {
            if (!ok) { setNotice(t('mediaLibrary.discardFailed')); return; }
            unpick(was.place, was.file.path);
            setAgain((n) => n + 1);
          });
        }}
      />
    </div>
  );
}

function Blank({ icon, title, body }: { icon: React.ReactNode; title: string; body?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 pb-10 text-center text-[var(--text-faint)]">
      {icon}
      <div className="text-[13.5px] font-medium text-[var(--text-muted)]">{title}</div>
      {body ? <p className="max-w-[40ch] text-[12.5px] leading-relaxed">{body}</p> : null}
    </div>
  );
}

/** What a file's tile does: put in the film, and its menu. */
interface TileUse {
  onAdd: (place: string, file: LibraryFile) => void;
  onMenu: (e: React.MouseEvent, place: string, file: LibraryFile) => void;
}

/**
 * The folder's tiles, however many: only the rows on screen are drawn. As many tiles to a row as fit at TILE_MIN,
 * each as wide as the room left allows.
 */
function Grid({ items, picked, renaming, onOpen, onPick, onRename, onStopRename, use }: {
  items: Item[]; picked: Shown | null;
  /** the file whose name is being changed */
  renaming: { place: string; path: string; name: string } | null;
  onOpen: (path: string) => void; onPick: (file: Shown | null) => void;
  onRename: (name: string) => void; onStopRename: () => void;
  use: TileUse;
}) {
  const scroller = React.useRef<HTMLDivElement>(null);
  const [box, setBox] = React.useState({ width: 0, height: 0 });
  const [top, setTop] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setBox({ width: el.clientWidth - PAD * 2, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cols = Math.max(1, Math.floor((box.width + GAP) / (TILE_MIN + GAP)));
  const tile = box.width > 0 ? (box.width - GAP * (cols - 1)) / cols : TILE_MIN;
  const rowH = Math.round((tile * 9) / 16) + TILE_TEXT + GAP;
  const rows = Math.ceil(items.length / cols);
  const first = Math.max(0, Math.floor(top / rowH) - 1);
  const last = Math.min(rows, Math.ceil((top + box.height) / rowH) + 1);
  const shown = box.width > 0 ? items.slice(first * cols, last * cols) : [];
  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto pb-4 [scrollbar-gutter:stable]" style={{ paddingLeft: PAD, paddingRight: PAD }} data-media-library-grid=""
      onScroll={(e) => setTop(e.currentTarget.scrollTop)}
      onClick={(e) => { if (!(e.target as Element).closest('[data-library-item]')) onPick(null); }}>
      <div className="relative" style={{ height: rows * rowH }}>
        <div className="absolute inset-x-0 grid" style={{ top: first * rowH, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, columnGap: GAP }}>
          {shown.map((item) => (item.type === 'dir' ? (
            <button key={`d:${item.path}`} type="button" data-library-item="" data-library-folder={item.path} onDoubleClick={() => onOpen(item.path)} onClick={() => onPick(null)}
              onKeyDown={(e) => { if (e.key === 'Enter') onOpen(item.path); }}
              className="group min-w-0 text-left outline-none" style={{ height: rowH }}>
              <span className="flex aspect-video items-center justify-center rounded-lg bg-[var(--bg-hover)] text-[var(--text-faint)] ring-2 ring-transparent transition group-hover:text-[var(--text-muted)] group-focus-visible:ring-[var(--accent)]">
                <Folder size={34} strokeWidth={1.25} />
              </span>
              <FolderWords name={item.name} items={item.items} />
            </button>
          ) : (
            <FileTile key={`f:${item.place}\n${item.file.path}`} place={item.place} file={item.file} where={item.where} sources={sourcesFor(item.place)} height={rowH}
              selected={sameFile(picked, item)} onPick={() => onPick({ file: item.file, place: item.place, ...(item.where ? { where: item.where } : {}) })} use={use}
              renaming={renaming?.place === item.place && renaming.path === item.file.path} onRename={onRename} onStopRename={onStopRename} />
          )))}
        </div>
      </div>
    </div>
  );
}

function FolderWords({ name, items }: { name: string; items: number }) {
  const t = useT();
  return (
    <span className="mt-1.5 block min-w-0 px-0.5">
      <span className="block truncate text-[12.5px] text-[var(--text)]">{name}</span>
      <span className="block truncate text-[11.5px] text-[var(--text-faint)]">{t('mediaLibrary.items').replace('{n}', String(items))}</span>
    </span>
  );
}

/** A file's length and size as known, asked for when its tile is drawn. */
function useFacts(place: string, file: LibraryFile): MediaFacts | undefined {
  const [facts, setFacts] = React.useState(() => knownFacts(place, file));
  React.useEffect(() => {
    if (facts || file.kind === 'image') return undefined;
    let live = true;
    void factsOf(place, file).then((found) => { if (live && found) setFacts(found); });
    return () => { live = false; };
  }, [place, file, facts]);
  return facts;
}

/**
 * A media file's tile. A video is looked through by moving the pointer across it: the frame under the pointer shows,
 * left to right its start to its end.
 */
function FileTile({ place, file, where, sources, height, selected, onPick, use, renaming, onRename, onStopRename }: {
  place: string; file: LibraryFile; where?: string | undefined; sources: MediaSources; height: number; selected: boolean; onPick: () => void;
  use: TileUse; renaming: boolean; onRename: (name: string) => void; onStopRename: () => void;
}) {
  const t = useT();
  const resource = React.useMemo(() => resourceOf(file), [file]);
  const facts = useFacts(place, file);
  const [over, setOver] = React.useState(false);
  const [ratio, setRatio] = React.useState(0);
  const video = React.useRef<HTMLVideoElement>(null);
  const wait = React.useRef(0);
  /* Escape leaves the name as it was, and the blur that follows says nothing */
  const kept = React.useRef(false);
  React.useEffect(() => { if (renaming) kept.current = false; }, [renaming]);
  const seek = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const at = Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)));
    setRatio(at);
    const el = video.current;
    if (el && Number.isFinite(el.duration) && el.duration > 0) el.currentTime = at * el.duration;
  };
  React.useEffect(() => () => window.clearTimeout(wait.current), []);
  return (
    <div data-library-item="" data-library-file={file.path} role="button" tabIndex={0} onClick={onPick}
      onKeyDown={(e) => { if (renaming) return; if (e.key === 'Enter') { e.preventDefault(); use.onAdd(place, file); } else if (e.key === ' ') { e.preventDefault(); onPick(); } }}
      /* onto the timeline as a thing of Saved goes (brought into the project as it lands) */
      draggable={!renaming}
      onDragStart={(e) => {
        window.clearTimeout(wait.current); setOver(false);
        const at = referenceOf(place, file);
        setResourceDragData(e.dataTransfer, { ...at, saved: at.path });
        dragPicture(e);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onDragEnd={() => clearResourceDrag()}
      onDoubleClick={() => { if (!renaming) use.onAdd(place, file); }}
      onContextMenu={(e) => { e.preventDefault(); onPick(); use.onMenu(e, place, file); }}
      className="group min-w-0 cursor-default select-none outline-none" style={{ height }} title={where ? `${file.name}\n${where}` : file.name}>
      <div className={`relative aspect-video overflow-hidden rounded-lg bg-[var(--bg-hover)] ring-2 transition ${selected ? 'ring-[var(--accent)]' : 'ring-transparent group-hover:ring-[var(--border-strong)] group-focus-visible:ring-[var(--accent)]'}`}
        {...(file.kind === 'video' ? {
          /* a pointer passing over on its way elsewhere starts nothing */
          onPointerEnter: () => { wait.current = window.setTimeout(() => setOver(true), 140); },
          onPointerLeave: () => { window.clearTimeout(wait.current); setOver(false); },
          onPointerMove: seek,
        } : {})}>
        <MediaPreview file={resource} sources={sources} />
        {over ? (
          <>
            <video ref={video} src={sources.file(resource)} muted playsInline preload="auto" data-library-scrub=""
              onLoadedMetadata={(e) => { e.currentTarget.currentTime = ratio * e.currentTarget.duration; }}
              className="absolute inset-0 h-full w-full bg-black object-contain" />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-white/25"><span className="block h-full bg-white" style={{ width: `${ratio * 100}%` }} /></span>
          </>
        ) : null}
        {facts?.durationMs && !over ? <span className="absolute bottom-1 right-1 rounded bg-black/65 px-1 text-[10.5px] tabular-nums leading-[16px] text-white">{formatClipDuration(facts.durationMs)}</span> : null}
      </div>
      <div className="mt-1.5 min-w-0 px-0.5">
        {renaming ? (
          /* its name changed where it is: the ending stays, so the name is picked without it */
          <input autoFocus defaultValue={file.name} aria-label={t('assets.rename')} data-library-rename=""
            onFocus={(e) => { const dot = e.currentTarget.value.lastIndexOf('.'); e.currentTarget.setSelectionRange(0, dot > 0 ? dot : e.currentTarget.value.length); }}
            onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
            onBlur={(e) => { if (!kept.current) onRename(e.currentTarget.value); }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') { e.preventDefault(); kept.current = true; onRename(e.currentTarget.value); }
              else if (e.key === 'Escape') { kept.current = true; onStopRename(); }
            }}
            className="w-full rounded bg-[var(--bg-field)] px-1 text-[12.5px] text-[var(--text)] outline-none ring-1 ring-[var(--accent)]" />
        ) : <div className={`truncate text-[12.5px] ${selected ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`} style={{ whiteSpace: 'pre' }}>{file.name}</div>}
        {/* found in every folder: where it is; in its own folder: what it is */}
        <div className="truncate text-[11.5px] tabular-nums text-[var(--text-faint)]">
          {where ?? [facts?.w && facts.h ? `${facts.w}×${facts.h}` : null, formatFileSize(file.size)].filter(Boolean).join(' · ')}
        </div>
      </div>
    </div>
  );
}
