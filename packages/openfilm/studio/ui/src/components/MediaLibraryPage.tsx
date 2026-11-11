/**
 * The media library: where a person looks through the media they keep on this computer, whether or not a film uses
 * it (lib/media-library; studio/server/media-library.mjs). A page of the projects window, beside My projects and
 * Examples, with room to browse.
 *
 * On the left, the places: the folders the person added, each opening into its own folders as the disk has them, and
 * the projects. In the middle, the folder open: its folders, then its media, shown at once from the disk (lengths and
 * pictures come in as each tile is seen). On the right, the file picked: played, with what it is, where it is, the
 * projects that use it and how it was made.
 *
 * A folder taken out of the library stays on the disk as it is.
 *
 * `MediaLibraryPane` is the same library at a project's side (the assets drawer), small: one place or view at a
 * time, picked from a menu, to take media from while editing. A file there is watched in the viewer with a click and
 * goes onto the timeline with a drag or a double-click; it comes into the project as it does.
 */
import React from 'react';
import { ArrowDownUp, Bookmark, ChevronDown, ChevronRight, Clapperboard, Clock, Copy, EyeOff, Folder, FolderOpen, FolderPlus, HardDrive, Heart, LibraryBig, MessageSquarePlus, Pencil, Plus, Search, Sparkles, Trash2, Unplug, VideoOff, X } from 'lucide-react';
import { useT } from '@/i18n';
import { clearResourceDrag, dragPicture, setResourceDragData } from '@/lib/resource-drag';
import { factsOf, knownFacts, libraryApi, referenceOf, resourceOf, sourcesOf, type LibraryAbout, type LibraryFile, type LibraryFound, type LibraryListing, type LibraryMark, type LibraryPlaces } from '@/lib/media-library';
import { formatClipDuration, formatFileSize, type MediaFacts, type MediaSources, type WorkspaceResource } from '@/lib/workspace-resources';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { MediaPreview } from './MediaPreview';

type Sort = 'name' | 'date' | 'size';
const SORTS: readonly Sort[] = ['name', 'date', 'size'];
/** A tile is at least this wide; a row holds as many as fit. */
const TILE_MIN = 168;
const GAP = 12;
/** Under a tile's picture: its name and a line of facts. */
const TILE_TEXT = 44;

type Kind = 'all' | 'video' | 'image' | 'audio';
const KINDS: readonly Kind[] = ['all', 'video', 'image', 'audio'];
/**
 * A view of the whole library: the newest files, what the person liked, what no project has, what a service made,
 * files that are the same bytes as another, and what the person said they do not want (hidden everywhere else).
 */
type Smart = 'recent' | 'liked' | 'unused' | 'made' | 'duplicates' | 'rejected';
/** How many found files are asked for at once. */
const FOUND_MAX = 600;

/** A file shown: in its place; `where`, when it was found rather than opened to (its place and folders, to read). */
type Shown = { file: LibraryFile; place: string; where?: string; copies?: number };
type Picked = Shown;
type Item = { type: 'dir'; name: string; path: string; items: number } | ({ type: 'file' } & Shown);
const sameFile = (a: Shown | null, b: Shown) => Boolean(a && a.place === b.place && a.file.path === b.file.path);

/** Where each place's pictures, sounds and bytes come from, made once a place. */
const SOURCES = new Map<string, MediaSources>();
const sourcesFor = (place: string): MediaSources => SOURCES.get(place) ?? (SOURCES.set(place, sourcesOf(place)), SOURCES.get(place)!);

/**
 * What the whole library holds that fits: asked a moment after the last key, and again while the library is still
 * being read (more may be found).
 */
function useSearch(on: boolean, view: Smart | null, q: string, kind: Kind, sort: Sort, again: number): LibraryFound | null {
  const [state, setState] = React.useState<{ key: string; found: LibraryFound } | null>(null);
  /* words look in all of the library, whatever view was shown */
  const smart = q.trim() ? null : view;
  const key = `${q.trim()}\n${smart}\n${kind}\n${sort}`;
  const [more, setMore] = React.useState(0);
  React.useEffect(() => {
    if (!on) return undefined;
    let live = true;
    let later = 0;
    const timer = window.setTimeout(() => {
      const asked = smart === 'duplicates'
        ? libraryApi.duplicates().then((found) => (found && kind !== 'all' ? { ...found, files: found.files.filter((f) => f.kind === kind) } : found))
        : libraryApi.search({
          q: q.trim(), kind: kind === 'all' ? null : kind, made: smart === 'made', unused: smart === 'unused',
          mark: smart === 'liked' ? 'like' : smart === 'rejected' ? 'no' : null, sort: smart === 'recent' ? 'date' : sort, limit: FOUND_MAX,
        });
      void asked.then((found) => {
        if (!live || !found) return;
        setState({ key, found });
        if (found.scanning) later = window.setTimeout(() => setMore((n) => n + 1), 2500);
      });
    }, 180);
    return () => { live = false; window.clearTimeout(timer); window.clearTimeout(later); };
  }, [on, key, again, more]); // eslint-disable-line react-hooks/exhaustive-deps
  return on && state?.key === key ? state.found : null;
}

/**
 * A folder's listing, read once per visit and again when asked (`again`): what was read of it stays shown while it
 * is read again, so nothing jumps when a file in it is marked or renamed.
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

export function MediaLibraryPage({ heading, onClose }: { heading: React.ReactNode; onClose?: (() => void) | undefined }) {
  const t = useT();
  const [places, setPlaces] = React.useState<LibraryPlaces | null>(null);
  const [at, setAt] = React.useState<{ place: string; dir: string } | null>(null);
  /* looking through the whole library instead of one folder: a view of it (the newest, what a service made), or words
     typed, which look in all of it whatever view was shown */
  const [smart, setSmart] = React.useState<Smart | null>(null);
  const [query, setQuery] = React.useState('');
  const [kind, setKind] = React.useState<Kind>('all');
  const [picked, setPicked] = React.useState<Picked | null>(null);
  const [sort, setSort] = React.useState<Sort>('name');
  const [again, setAgain] = React.useState(0);
  const [projectsOpen, setProjectsOpen] = React.useState(false);
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);

  const readPlaces = React.useCallback(async () => {
    const next = await libraryApi.places();
    if (next) setPlaces(next);
    return next;
  }, []);
  React.useEffect(() => { void readPlaces(); }, [readPlaces]);
  /* the window back: a disk may have been plugged in, a folder changed in the file manager */
  React.useEffect(() => {
    const back = () => { void readPlaces(); setAgain((n) => n + 1); };
    window.addEventListener('focus', back);
    return () => window.removeEventListener('focus', back);
  }, [readPlaces]);
  /* the first place there is, once they are read */
  React.useEffect(() => {
    if (at || !places) return;
    const first = places.folders.find((f) => !f.missing) ?? places.folders[0];
    if (first) setAt({ place: first.place, dir: '' });
  }, [places, at]);

  const go = React.useCallback((place: string, dir: string) => { setAt({ place, dir }); setSmart(null); setQuery(''); setPicked(null); }, []);
  const show = (view: Smart) => { setSmart(view); setQuery(''); setPicked(null); };
  const searching = Boolean(query.trim()) || smart !== null;
  const listing = useListing(searching ? null : at?.place ?? null, at?.dir ?? '', again);
  const found = useSearch(searching, smart, query, kind, sort, again);
  /* the views that are in their own order: no other to choose */
  const ordered = !query.trim() && (smart === 'recent' || smart === 'duplicates');

  const folder = places?.folders.find((f) => f.place === at?.place);
  const project = places?.projects.find((p) => p.place === at?.place);
  const placeName = folder?.name ?? project?.name ?? (at?.place === 'saved' ? t('saved.title') : '');
  const offline = Boolean(folder?.missing);

  const items = React.useMemo((): Item[] => {
    if (searching) return (found?.files ?? []).map((file) => ({ type: 'file' as const, file, place: file.place, where: file.where, ...(file.copies ? { copies: file.copies } : {}) }));
    if (!listing?.listing || !at) return [];
    /* what the person does not want is not shown in its folder (the view of it has it) */
    const files = listing.listing.files.filter((f) => f.mark !== 'no' && (kind === 'all' || f.kind === kind));
    if (sort === 'date') files.sort((a, b) => b.mtime - a.mtime);
    else if (sort === 'size') files.sort((a, b) => b.size - a.size);
    return [...listing.listing.dirs.map((d) => ({ type: 'dir' as const, ...d })), ...files.map((file) => ({ type: 'file' as const, file, place: at.place }))];
  }, [searching, found, listing, sort, kind, at]);

  const addFolder = async () => {
    if (adding) return;
    setAdding(true);
    setNotice(null);
    try {
      const added = await libraryApi.addFolder(t('mediaLibrary.pickFolder'));
      const next = await readPlaces();
      const place = added ? next?.folders.find((f) => f.path === added)?.place : undefined;
      if (place) go(place, '');
    } catch (e) { setNotice(t((e as { reason?: string }).reason === 'wide' ? 'mediaLibrary.tooWide' : 'mediaLibrary.addFailed')); }
    finally { setAdding(false); }
  };
  const removeFolder = async (path: string, place: string) => {
    await libraryApi.removeFolder(path);
    if (at?.place === place) { setAt(null); setPicked(null); }
    void readPlaces();
  };
  const folderMenu = (e: React.MouseEvent, f: { place: string; path: string; missing: boolean }) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, items: [
      ...(f.missing ? [] : [{ id: 'reveal', label: t('projects.revealFolder'), icon: <FolderOpen size={14} />, onSelect: () => libraryApi.reveal(f.place, '') }]),
      { id: 'remove', label: t('mediaLibrary.remove'), note: t('mediaLibrary.removeNote'), icon: <X size={14} />, onSelect: () => { void removeFolder(f.path, f.place); } },
    ] });
  };
  const crumbs = at?.dir ? at.dir.split('/') : [];
  const shownCount = searching ? found?.total : listing?.listing ? items.filter((i) => i.type === 'file').length : undefined;
  const smartRow = (view: Smart, icon: React.ReactNode) => (
    <button type="button" onClick={() => show(view)} aria-current={smart === view && !query.trim() ? 'true' : undefined}
      className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-left ${smart === view && !query.trim() ? 'bg-[var(--bg-pressed)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'}`}>
      {icon}<span className="truncate">{t(`mediaLibrary.smart_${view}`)}</span>
    </button>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-media-library="">
      <header className="flex shrink-0 flex-col px-6 pb-4 pt-5">
        <div className="flex min-h-8 items-center gap-1">
          {heading}
          {onClose ? (
            <button type="button" onClick={onClose} aria-label={t('project.close')}
              className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
              <X size={16} strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
      </header>

      {places && !places.folders.length && !at && !searching ? (
        /* nothing added yet: what the library is, and the one thing to do */
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 pb-16 text-center">
          <HardDrive size={28} strokeWidth={1.5} className="text-[var(--text-faint)]" />
          <div className="text-[16px] font-semibold text-[var(--text)]">{t('mediaLibrary.emptyTitle')}</div>
          <p className="max-w-[46ch] text-[13.5px] leading-relaxed text-[var(--text-muted)]">{t('mediaLibrary.emptyBody')}</p>
          <button type="button" onClick={() => void addFolder()} disabled={adding}
            className="mt-2 inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--bg-pressed)] px-4 text-[13.5px] font-medium text-[var(--text)] transition hover:bg-[var(--border-strong)] disabled:opacity-60">
            <FolderPlus size={15} />{t('mediaLibrary.addFolder')}
          </button>
          {notice ? <p role="alert" className="text-[12.5px] text-[var(--err)]">{notice}</p> : null}
          {places.projects.length ? (
            <button type="button" onClick={() => { setProjectsOpen(true); go(places.projects[0]!.place, ''); }} className="mt-1 text-[12.5px] text-[var(--text-muted)] underline decoration-[var(--border-strong)] hover:text-[var(--text)]">
              {t('mediaLibrary.seeProjects')}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 border-t border-[var(--border)]">
          {/* the places, and the views of the whole library */}
          <nav className="flex w-[232px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[var(--border)] px-2.5 py-3 text-[13px]" aria-label={t('mediaLibrary.places')}>
            <button type="button" onClick={() => void addFolder()} disabled={adding}
              className="mb-2 flex h-8 items-center gap-2 rounded-lg bg-[var(--bg-pressed)] px-2.5 font-medium text-[var(--text)] transition hover:bg-[var(--border-strong)] disabled:opacity-60">
              <FolderPlus size={15} />{t('mediaLibrary.addFolder')}
            </button>
            {notice ? <p role="alert" className="mb-1 px-1.5 text-[12px] leading-snug text-[var(--err)]">{notice}</p> : null}
            <div className="px-1.5 pb-0.5 pt-1 text-[11.5px] text-[var(--text-faint)]">{t('mediaLibrary.places')}</div>
            {(places?.folders ?? []).map((f) => (
              <TreeNode key={f.place} place={f.place} dir="" name={f.name} depth={0} offline={f.missing} at={at} marked={!searching} again={again} onGo={go}
                onMenu={(e) => folderMenu(e, f)} />
            ))}
            {/* the files kept in Saved, for every project (the clips and pages kept there are in a project's Saved) */}
            <TreeNode place="saved" dir="" name={t('saved.title')} depth={0} saved at={at} marked={!searching} again={again} onGo={go} />
            <div className="mt-3 px-1.5 pb-0.5 pt-1 text-[11.5px] text-[var(--text-faint)]">{t('mediaLibrary.smart')}</div>
            {smartRow('recent', <Clock size={14} className="shrink-0" />)}
            {smartRow('liked', <Heart size={14} className="shrink-0" />)}
            {smartRow('unused', <VideoOff size={14} className="shrink-0" />)}
            {smartRow('made', <Sparkles size={14} className="shrink-0" />)}
            {smartRow('duplicates', <Copy size={14} className="shrink-0" />)}
            {smartRow('rejected', <EyeOff size={14} className="shrink-0" />)}
            {places?.projects.length ? (
              <>
                <button type="button" onClick={() => setProjectsOpen((v) => !v)} aria-expanded={projectsOpen}
                  className="mt-3 flex items-center gap-1 px-1.5 pb-0.5 pt-1 text-left text-[11.5px] text-[var(--text-faint)] hover:text-[var(--text-muted)]">
                  {projectsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{t('mediaLibrary.projects').replace('{n}', String(places.projects.length))}
                </button>
                {projectsOpen ? places.projects.map((p) => (
                  <TreeNode key={p.place} place={p.place} dir="" name={p.name} depth={0} project at={at} marked={!searching} again={again} onGo={go} />
                )) : null}
              </>
            ) : null}
          </nav>

          {/* the folder open, or what was found */}
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-11 shrink-0 items-center gap-1 px-4 text-[13px]">
              <div className="flex min-w-0 flex-1 items-center gap-1">
                {searching ? (
                  <span className="truncate px-1 font-medium text-[var(--text)]">{query.trim() ? t('mediaLibrary.results') : t(`mediaLibrary.smart_${smart}`)}</span>
                ) : at ? (
                  <>
                    <button type="button" onClick={() => go(at.place, '')} className={`min-w-0 shrink truncate rounded px-1 ${crumbs.length ? 'text-[var(--text-muted)] hover:text-[var(--text)]' : 'font-medium text-[var(--text)]'}`}>{placeName}</button>
                    {crumbs.map((name, i) => (
                      <React.Fragment key={crumbs.slice(0, i + 1).join('/')}>
                        <ChevronRight size={12} className="shrink-0 text-[var(--text-faint)]" />
                        <button type="button" onClick={() => go(at.place, crumbs.slice(0, i + 1).join('/'))}
                          className={`min-w-0 shrink truncate rounded px-1 ${i === crumbs.length - 1 ? 'font-medium text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>{name}</button>
                      </React.Fragment>
                    ))}
                  </>
                ) : null}
                <span className="shrink-0 pl-2 text-[12px] tabular-nums text-[var(--text-faint)]" data-library-count="">
                  {shownCount == null ? '' : smart === 'duplicates' && !query.trim() && found?.groups != null
                    ? (found.groups ? t('mediaLibrary.dupCount').replace('{n}', String(found.groups)).replace('{size}', formatFileSize(found.spare ?? 0)) : '')
                    : searching && found && found.total > found.files.length
                    ? t('mediaLibrary.countFirst').replace('{n}', String(found.files.length)).replace('{total}', String(found.total))
                    : t('mediaLibrary.count').replace('{n}', String(shownCount))}
                </span>
              </div>
              {/* one kind of media, in the folder open or in what is found */}
              <div role="group" aria-label={t('media.filter')} className="flex shrink-0 items-center rounded-md bg-[var(--bg-hover)] p-0.5 text-[12px]">
                {KINDS.map((k) => (
                  <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
                    className={`h-6 rounded-[5px] px-2 transition ${kind === k ? 'bg-[var(--bg-pressed)] font-medium text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
                    {t(`mediaLibrary.kind_${k}`)}
                  </button>
                ))}
              </div>
              {ordered ? null : (
                <button type="button" aria-label={t('media.sort')} title={`${t('media.sort')}: ${t(`mediaLibrary.sort_${sort}`)}`}
                  onClick={() => setSort(SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length]!)}
                  className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
                  <ArrowDownUp size={13} />{t(`mediaLibrary.sort_${sort}`)}
                </button>
              )}
              {/* every place at once: by name, by folder, by the words a picture or clip was made with */}
              <label className="flex h-7 w-[210px] shrink-0 items-center gap-1.5 rounded-md bg-[var(--bg-hover)] px-2 text-[12.5px] text-[var(--text-muted)]">
                <Search size={13} className="shrink-0" />
                <input value={query} onChange={(e) => { setQuery(e.target.value); setPicked(null); if (e.target.value.trim()) setSmart(null); }} placeholder={t('mediaLibrary.search')} aria-label={t('mediaLibrary.search')}
                  onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); } }}
                  className="min-w-0 flex-1 bg-transparent text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]" />
                {query ? <button type="button" aria-label={t('media.clearSearch')} onClick={() => setQuery('')} className="shrink-0 hover:text-[var(--text)]"><X size={12} /></button> : null}
              </label>
            </div>
            {searching ? (
              !found ? <div className="flex-1" />
                : !items.length ? <Blank icon={<Search size={24} strokeWidth={1.5} />} title={t(query.trim() || !smart ? 'mediaLibrary.noneFound' : `mediaLibrary.none_${smart}`)} {...(found.scanning ? { body: t('mediaLibrary.stillReading') } : {})} />
                  : <Grid key={`found\n${smart}\n${query}\n${kind}`} items={items} picked={picked} onOpen={() => {}} onPick={setPicked} />
            ) : offline && !listing?.listing ? (
              <Blank icon={<Unplug size={24} strokeWidth={1.5} />} title={t('mediaLibrary.offlineTitle')} body={t('mediaLibrary.offlineBody')} />
            ) : listing?.gone ? (
              <Blank icon={<Unplug size={24} strokeWidth={1.5} />} title={t('mediaLibrary.goneTitle')} body={t('mediaLibrary.offlineBody')} />
            ) : listing && !items.length ? (
              <Blank icon={<Clapperboard size={24} strokeWidth={1.5} />} title={t('mediaLibrary.noMedia')} />
            ) : at && listing ? (
              <Grid key={`${at.place}\n${at.dir}`} items={items} picked={picked} onOpen={(path) => go(at.place, path)} onPick={setPicked} />
            ) : <div className="flex-1" />}
          </section>

          {/* the file picked */}
          <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-[var(--border)] px-4 py-4">
            {picked ? (
              <Details key={`${picked.place}\n${picked.file.path}\n${picked.file.mtime}`} place={picked.place} file={picked.file}
                onChanged={() => setAgain((n) => n + 1)} onGone={() => { setPicked(null); setAgain((n) => n + 1); }}
                onRenamed={(path) => { setPicked({ ...picked, file: { ...picked.file, path, name: path.slice(path.lastIndexOf('/') + 1) } }); setAgain((n) => n + 1); }}
                where={picked.where ?? [placeName, ...(picked.file.path.includes('/') ? picked.file.path.slice(0, picked.file.path.lastIndexOf('/')).split('/') : [])].join(' / ')}
                {...(searching ? { onShowFolder: () => go(picked.place, picked.file.path.includes('/') ? picked.file.path.slice(0, picked.file.path.lastIndexOf('/')) : '') } : {})} />
            ) : (
              <p className="m-auto max-w-[24ch] text-center text-[12.5px] leading-relaxed text-[var(--text-faint)]">{t('mediaLibrary.pickHint')}</p>
            )}
          </aside>
        </div>
      )}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
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

/**
 * A folder in the places: its name, opened into its own folders (read as it is opened). The one shown in the middle
 * is marked; a click shows it, the arrow opens it without leaving where you are.
 */
function TreeNode({ place, dir, name, depth, offline, project, saved, at, marked, again, onGo, onMenu }: {
  place: string; dir: string; name: string; depth: number; offline?: boolean; project?: boolean; saved?: boolean;
  /** the folder shown in the middle; `marked`: it is what the middle shows now (not what was found in every place) */
  at: { place: string; dir: string } | null; marked: boolean; again: number;
  onGo: (place: string, dir: string) => void; onMenu?: (e: React.MouseEvent) => void;
}) {
  const here = marked && at?.place === place && at.dir === dir;
  /* opened by hand, or because the folder shown is inside it */
  const holds = at?.place === place && (dir === '' ? at.dir !== '' : at.dir.startsWith(`${dir}/`));
  const [open, setOpen] = React.useState(false);
  const shown = open || holds;
  const listing = useListing(shown && !offline ? place : null, dir, again);
  const dirs = listing?.listing?.dirs ?? [];
  return (
    <>
      <div onContextMenu={onMenu} title={offline ? undefined : name}
        className={`group flex h-7 items-center rounded-md pr-1.5 ${here ? 'bg-[var(--bg-pressed)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'}`}
        style={{ paddingLeft: 2 + depth * 14 }}>
        <button type="button" aria-label={name} aria-expanded={shown} disabled={offline} onClick={() => setOpen(!shown)}
          className="flex h-6 w-5 shrink-0 items-center justify-center text-[var(--text-faint)] hover:text-[var(--text)] disabled:opacity-40">
          {shown ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <button type="button" onClick={() => onGo(place, dir)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {offline ? <Unplug size={14} className="shrink-0 text-[var(--text-faint)]" /> : project ? <Clapperboard size={14} className="shrink-0" /> : saved ? <Bookmark size={14} className="shrink-0" /> : <Folder size={14} className="shrink-0" />}
          <span className={`truncate ${offline ? 'text-[var(--text-faint)]' : ''}`}>{name}</span>
        </button>
      </div>
      {shown ? dirs.map((d) => (
        <TreeNode key={d.path} place={place} dir={d.path} name={d.name} depth={depth + 1} at={at} marked={marked} again={again} onGo={onGo} />
      )) : null}
    </>
  );
}

/**
 * The folder's tiles, however many: only the rows on screen are drawn. As many tiles to a row as fit at TILE_MIN,
 * each as wide as the room left allows.
 */
function Grid({ items, picked, onOpen, onPick, tileMin = TILE_MIN, pad = 16, use }: {
  items: Item[]; picked: Picked | null;
  onOpen: (path: string) => void; onPick: (file: Picked | null) => void;
  /** the least a tile is wide, and the room at the grid's sides */
  tileMin?: number; pad?: number;
  /** at a project's side: a file is put in the film (a double-click, Enter), dragged onto the timeline, and has a menu */
  use?: TileUse;
}) {
  const scroller = React.useRef<HTMLDivElement>(null);
  const [box, setBox] = React.useState({ width: 0, height: 0 });
  const [top, setTop] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setBox({ width: el.clientWidth - pad * 2, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pad]);
  const cols = Math.max(1, Math.floor((box.width + GAP) / (tileMin + GAP)));
  const tile = box.width > 0 ? (box.width - GAP * (cols - 1)) / cols : tileMin;
  const rowH = Math.round((tile * 9) / 16) + TILE_TEXT + GAP;
  const rows = Math.ceil(items.length / cols);
  const first = Math.max(0, Math.floor(top / rowH) - 1);
  const last = Math.min(rows, Math.ceil((top + box.height) / rowH) + 1);
  const shown = box.width > 0 ? items.slice(first * cols, last * cols) : [];
  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto pb-4 [scrollbar-gutter:stable]" style={{ paddingLeft: pad, paddingRight: pad }} data-media-library-grid=""
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
            <FileTile key={`f:${item.place}\n${item.file.path}`} place={item.place} file={item.file} where={item.where} copies={item.copies} sources={sourcesFor(item.place)} height={rowH}
              selected={sameFile(picked, item)} onPick={() => onPick({ file: item.file, place: item.place, ...(item.where ? { where: item.where } : {}) })} use={use} />
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

/** What a file's tile does at a project's side: put in the film, and its menu. */
interface TileUse {
  onAdd: (place: string, file: LibraryFile) => void;
  onMenu: (e: React.MouseEvent, place: string, file: LibraryFile) => void;
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
function FileTile({ place, file, where, copies, sources, height, selected, onPick, use }: {
  place: string; file: LibraryFile; where?: string | undefined; copies?: number | undefined; sources: MediaSources; height: number; selected: boolean; onPick: () => void;
  use?: TileUse | undefined;
}) {
  const t = useT();
  const resource = React.useMemo(() => resourceOf(file), [file]);
  const facts = useFacts(place, file);
  const [over, setOver] = React.useState(false);
  const [ratio, setRatio] = React.useState(0);
  const video = React.useRef<HTMLVideoElement>(null);
  const wait = React.useRef(0);
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
      onKeyDown={(e) => { if (e.key === 'Enter' && use) { e.preventDefault(); use.onAdd(place, file); } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } }}
      {...(use ? {
        /* at a project's side: onto the timeline as a thing of Saved goes (brought into the project as it lands) */
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
          window.clearTimeout(wait.current); setOver(false);
          const at = referenceOf(place, file);
          setResourceDragData(e.dataTransfer, { ...at, saved: at.path });
          dragPicture(e);
          e.dataTransfer.effectAllowed = 'copy';
        },
        onDragEnd: () => clearResourceDrag(),
        onDoubleClick: () => use.onAdd(place, file),
        onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); onPick(); use.onMenu(e, place, file); },
      } : {})}
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
        {file.mark === 'like' && !over ? <span data-library-liked="" className="absolute left-1 top-1 flex h-[18px] w-[18px] items-center justify-center rounded bg-black/65 text-white"><Heart size={11} fill="currentColor" /></span> : null}
        {copies && !over ? <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1 text-[10.5px] tabular-nums leading-[16px] text-white">{t('mediaLibrary.copies').replace('{n}', String(copies))}</span> : null}
      </div>
      <div className="mt-1.5 min-w-0 px-0.5">
        <div className={`truncate text-[12.5px] ${selected ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`} style={{ whiteSpace: 'pre' }}>{file.name}</div>
        {/* found in every place: where it is; in its own folder: what it is */}
        <div className="truncate text-[11.5px] tabular-nums text-[var(--text-faint)]">
          {where ?? [facts?.w && facts.h ? `${facts.w}×${facts.h}` : null, formatFileSize(file.size)].filter(Boolean).join(' · ')}
        </div>
      </div>
    </div>
  );
}

/**
 * The file picked: played, and what is known of it. What the person says of it (liked, not wanted) is kept with the
 * file itself; a file of a folder they added can be renamed where it is, or moved to the trash.
 */
function Details({ place, file, where, onShowFolder, onChanged, onRenamed, onGone }: {
  place: string; file: LibraryFile; where: string; onShowFolder?: () => void;
  /** something said of it changed; it has another name (its new path); it is in the trash */
  onChanged: () => void; onRenamed: (path: string) => void; onGone: () => void;
}) {
  const t = useT();
  const sources = sourcesFor(place);
  const resource = React.useMemo(() => resourceOf(file), [file]);
  const facts = useFacts(place, file);
  const [about, setAbout] = React.useState<LibraryAbout | null>(null);
  const [mark, setMark] = React.useState<LibraryMark | null>(file.mark ?? null);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [asking, setAsking] = React.useState(false);
  const [said, setSaid] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    void libraryApi.about(place, file.path).then((found) => { if (live) { setAbout(found); if (found) setMark(found.mark ?? null); } });
    return () => { live = false; };
  }, [place, file]);
  const url = sources.file(resource);
  /* a project's files are tended in the project, where its clips follow */
  const own = place.startsWith('folder:');
  const say = (next: LibraryMark) => {
    const to = mark === next ? null : next;
    setMark(to);
    void libraryApi.mark(place, file.path, to).then((ok) => { if (ok) onChanged(); else setMark(mark); });
  };
  const rename = async () => {
    const name = (renaming ?? '').trim();
    setRenaming(null);
    if (!name || name === file.name) return;
    setSaid(null);
    try { onRenamed(await libraryApi.rename(place, file.path, name)); }
    catch (e) {
      const reason = (e as { reason?: string }).reason;
      setSaid(t(reason === 'taken' ? 'assets.renameTaken' : reason === 'kind' ? 'mediaLibrary.renameKind' : 'mediaLibrary.renameFailed'));
    }
  };
  const label = 'text-[11px] leading-none text-[var(--text-faint)]';
  const made = about?.made;
  const act = 'flex items-center gap-1.5 rounded-md bg-[var(--bg-field)] px-2.5 py-2 text-[var(--text)] hover:bg-[var(--bg-hover)]';
  const toggle = (on: boolean) => `flex h-8 w-9 items-center justify-center rounded-md transition ${on ? 'bg-[var(--bg-pressed)] text-[var(--text)]' : 'bg-[var(--bg-field)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`;
  return (
    <div className="flex flex-col gap-3" data-library-details="">
      <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-black">
        {file.kind === 'video' ? <video key={url} src={url} poster={sources.poster?.(resource)} controls playsInline preload="metadata" className="h-full w-full object-contain" />
          : file.kind === 'image' ? <img src={url} alt="" className="max-h-full max-w-full" />
            : <audio key={url} src={url} controls preload="metadata" className="w-[92%]" />}
      </div>
      <div>
        {renaming != null ? (
          <input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} aria-label={t('assets.rename')}
            onFocus={(e) => { const dot = e.currentTarget.value.lastIndexOf('.'); e.currentTarget.setSelectionRange(0, dot > 0 ? dot : e.currentTarget.value.length); }}
            onBlur={() => void rename()} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void rename(); } else if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null); } }}
            className="w-full rounded-md bg-[var(--bg-field)] px-2 py-1 text-[13px] text-[var(--text)] outline-none ring-1 ring-[var(--accent)]" />
        ) : <p className="whitespace-pre-wrap break-words text-[13px] font-medium text-[var(--text)]">{file.name}</p>}
        {said ? <p role="alert" className="mt-1 text-[12px] leading-snug text-[var(--err)]">{said}</p> : null}
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-muted)]">
          {[facts?.w && facts.h ? `${facts.w} × ${facts.h}` : null, facts?.durationMs ? formatClipDuration(facts.durationMs) : null, formatFileSize(file.size)].filter(Boolean).join(' · ')}
          <br />{new Date(file.mtime).toLocaleString()}
        </p>
      </div>
      {/* what you say of it: kept with the file, wherever it goes */}
      <div className="flex items-center gap-2">
        <button type="button" aria-pressed={mark === 'like'} aria-label={t('mediaLibrary.like')} title={t('mediaLibrary.like')} onClick={() => say('like')} className={toggle(mark === 'like')}>
          <Heart size={15} {...(mark === 'like' ? { fill: 'currentColor' } : {})} />
        </button>
        <button type="button" aria-pressed={mark === 'no'} aria-label={t('mediaLibrary.reject')} title={t('mediaLibrary.rejectNote')} onClick={() => say('no')} className={toggle(mark === 'no')}>
          <EyeOff size={15} />
        </button>
        {mark === 'no' ? <span className="text-[11.5px] leading-snug text-[var(--text-faint)]">{t('mediaLibrary.rejected')}</span> : null}
      </div>
      <div>
        <p className={label}>{t('mediaLibrary.where')}</p>
        <p className="mt-1 break-words text-[12px] leading-relaxed text-[var(--text)]">{where}</p>
      </div>
      <div>
        <p className={label}>{t('mediaLibrary.usedIn')}</p>
        {!about ? <p className="mt-1 text-[12px] text-[var(--text-faint)]">…</p>
          : about.usedIn.length ? <ul className="mt-1 text-[12px] leading-relaxed text-[var(--text)]">{about.usedIn.map((p) => <li key={p.id} className="truncate">{p.name}</li>)}</ul>
            : <p className="mt-1 text-[12px] text-[var(--text-muted)]">{t('mediaLibrary.unused')}</p>}
      </div>
      {made ? (
        <div>
          <p className={label}>{t(made.found ? 'made.titleFound' : 'made.title')}</p>
          {made.words ? <p className="mt-1.5 max-h-36 select-text overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-[var(--bg-field)] px-2 py-1.5 text-[12px] leading-[1.5] text-[var(--text)]">{made.words}</p> : null}
          <p className="mt-1.5 break-words text-[11.5px] leading-relaxed text-[var(--text-muted)]">{[made.by, made.model, new Date(made.at).toLocaleDateString()].filter(Boolean).join(' · ')}</p>
        </div>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-2 border-t border-[var(--border)] pt-3 text-[12px]">
        <button type="button" onClick={() => libraryApi.reveal(place, file.path)} className={act}><FolderOpen size={13} />{t('projects.revealFolder')}</button>
        {onShowFolder ? <button type="button" onClick={onShowFolder} className={act}><Folder size={13} />{t('mediaLibrary.showFolder')}</button> : null}
        {own ? (
          <>
            <button type="button" onClick={() => setRenaming(file.name)} className={act}><Pencil size={13} />{t('assets.rename')}</button>
            <button type="button" onClick={() => setAsking(true)} className={`${act} hover:text-[var(--err)]`}><Trash2 size={13} />{t('mediaLibrary.discard')}</button>
          </>
        ) : null}
      </div>
      <ConfirmDialog
        open={asking}
        title={t('mediaLibrary.discardTitle').replace('{name}', file.name)}
        description={about?.linkedBy.length
          ? t('mediaLibrary.discardLinked').replace('{projects}', about.linkedBy.map((p) => p.name).join(t('settings.plugins.sep')))
          : t('mediaLibrary.discardBody')}
        confirmLabel={t('mediaLibrary.discard')}
        cancelLabel={t('confirm.cancel')}
        danger
        onCancel={() => setAsking(false)}
        onConfirm={() => { setAsking(false); void libraryApi.trash(place, file.path).then((ok) => { if (ok) onGone(); else setSaid(t('mediaLibrary.discardFailed')); }); }}
      />
    </div>
  );
}

/**
 * The library at a project's side (the assets drawer): one place or view at a time, chosen from a menu, and a search
 * of all of it. A click watches a file in the project's viewer (`onPick`, as a file named by its reference:
 * lib/media-library `referenceOf`); a double-click or Enter puts it in the film (`onAdd`), a drag takes it onto the
 * timeline; its menu points it at for the agent (`onRefer`). "Manage" opens the whole library (`onManage`).
 */
export function MediaLibraryPane({ selected, onPick, onAdd, onRefer, onManage }: {
  /** the reference of the file the viewer shows, when it is one of the library */
  selected: string | null;
  onPick: (file: WorkspaceResource | null) => void;
  onAdd: (file: WorkspaceResource) => void;
  onRefer?: ((file: WorkspaceResource) => void) | undefined;
  onManage: () => void;
}) {
  const t = useT();
  const [places, setPlaces] = React.useState<LibraryPlaces | null>(null);
  const [at, setAt] = React.useState<{ place: string; dir: string } | null>(null);
  const [smart, setSmart] = React.useState<Smart | null>(null);
  const [query, setQuery] = React.useState('');
  const [picked, setPicked] = React.useState<Picked | null>(null);
  const [again, setAgain] = React.useState(0);
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);

  React.useEffect(() => {
    const read = () => { void libraryApi.places().then((next) => { if (next) setPlaces(next); }); setAgain((n) => n + 1); };
    read();
    window.addEventListener('focus', read);
    return () => window.removeEventListener('focus', read);
  }, []);
  /* the first place there is; with none added yet, the newest of what the projects hold */
  React.useEffect(() => {
    if (at || smart || !places) return;
    const first = places.folders.find((f) => !f.missing);
    if (first) setAt({ place: first.place, dir: '' }); else setSmart('recent');
  }, [places, at, smart]);
  /* what the viewer shows went elsewhere: nothing here is picked */
  React.useEffect(() => { if (!selected) setPicked(null); }, [selected]);

  const go = (place: string, dir: string) => { setAt({ place, dir }); setSmart(null); setQuery(''); };
  const searching = Boolean(query.trim()) || smart !== null;
  const listing = useListing(searching ? null : at?.place ?? null, at?.dir ?? '', again);
  const found = useSearch(searching, smart, query, 'all', 'name', again);
  const items = React.useMemo((): Item[] => {
    if (searching) return (found?.files ?? []).map((file) => ({ type: 'file' as const, file, place: file.place, where: file.where }));
    if (!listing?.listing || !at) return [];
    return [...listing.listing.dirs.map((d) => ({ type: 'dir' as const, ...d })),
      ...listing.listing.files.filter((f) => f.mark !== 'no').map((file) => ({ type: 'file' as const, file, place: at.place }))];
  }, [searching, found, listing, at]);

  const folder = places?.folders.find((f) => f.place === at?.place);
  const project = places?.projects.find((p) => p.place === at?.place);
  const name = query.trim() ? t('mediaLibrary.results') : smart ? t(`mediaLibrary.smart_${smart}`) : folder?.name ?? project?.name ?? (at?.place === 'saved' ? t('saved.title') : t('launcher.library'));
  const crumbs = !searching && at?.dir ? at.dir.split('/') : [];
  /* what is known of its length goes with it: a clip on the timeline is as long as its file */
  const withFacts = async (place: string, file: LibraryFile) => { await factsOf(place, file); return referenceOf(place, file); };
  const use: TileUse = {
    onAdd: (place, file) => { void withFacts(place, file).then(onAdd); },
    onMenu: (e, place, file) => setMenu({ x: e.clientX, y: e.clientY, items: [
      { id: 'add', label: t('mediaLibrary.addToFilm'), icon: <Plus size={14} />, onSelect: () => { void withFacts(place, file).then(onAdd); } },
      ...(onRefer ? [{ id: 'refer', label: t('host.refer'), icon: <MessageSquarePlus size={14} />, onSelect: () => { void withFacts(place, file).then(onRefer); } }] : []),
      { id: 'reveal', label: t('projects.revealFolder'), icon: <FolderOpen size={14} />, onSelect: () => libraryApi.reveal(place, file.path) },
    ] }),
  };
  const view = (id: Smart) => ({ id: `view:${id}`, label: t(`mediaLibrary.smart_${id}`), checked: smart === id && !query.trim(), onSelect: () => { setSmart(id); setQuery(''); } });
  const placesMenu = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 4, items: [
      ...(places?.folders ?? []).filter((f) => !f.missing).map((f) => ({ id: f.place, label: f.name, icon: <Folder size={14} />, checked: !searching && at?.place === f.place, onSelect: () => go(f.place, '') })),
      { id: 'saved', label: t('saved.title'), icon: <Bookmark size={14} />, checked: !searching && at?.place === 'saved', onSelect: () => go('saved', '') },
      { id: 'views-sep', separator: true } as const,
      view('recent'), view('liked'), view('unused'), view('made'),
      ...(places?.projects.length ? [
        { id: 'projects-sep', separator: true } as const,
        { id: 'projects', label: t('mediaLibrary.projects').replace('{n}', String(places.projects.length)), icon: <Clapperboard size={14} />,
          submenu: places.projects.map((p) => ({ id: p.place, label: p.name, checked: !searching && at?.place === p.place, onSelect: () => go(p.place, '') })) },
      ] : []),
      { id: 'manage-sep', separator: true } as const,
      { id: 'manage', label: t('mediaLibrary.manage'), note: t('mediaLibrary.manageNote'), icon: <LibraryBig size={14} />, onSelect: onManage },
    ] });
  };
  const pick = (next: Picked | null) => {
    setPicked(next);
    onPick(next ? referenceOf(next.place, next.file) : null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-media-library-pane="" data-drag-home="">
      <div className="flex shrink-0 items-center gap-1.5 px-2.5 pb-1.5 pt-2.5">
        <button type="button" aria-haspopup="menu" onClick={placesMenu} title={name}
          className="flex h-7 min-w-0 max-w-[46%] shrink-0 items-center gap-1.5 rounded-md bg-[var(--bg-pressed)] px-2 text-[12.5px] font-medium text-[var(--text)] transition hover:bg-[var(--border-strong)]">
          <span className="truncate">{name}</span><ChevronDown size={12} className="shrink-0" />
        </button>
        <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-[var(--bg-hover)] px-2 text-[12.5px] text-[var(--text-muted)]">
          <Search size={13} className="shrink-0" />
          <input value={query} onChange={(e) => { setQuery(e.target.value); if (e.target.value.trim()) setSmart(null); }} placeholder={t('mediaLibrary.search')} aria-label={t('mediaLibrary.search')}
            onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); } }}
            className="min-w-0 flex-1 bg-transparent text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]" />
          {query ? <button type="button" aria-label={t('media.clearSearch')} onClick={() => setQuery('')} className="shrink-0 hover:text-[var(--text)]"><X size={12} /></button> : null}
        </label>
      </div>
      {crumbs.length && at ? (
        <div className="flex h-6 shrink-0 items-center gap-0.5 overflow-hidden px-2.5 text-[12px]">
          <button type="button" onClick={() => go(at.place, '')} className="shrink-0 rounded px-1 text-[var(--text-muted)] hover:text-[var(--text)]">{folder?.name ?? project?.name ?? name}</button>
          {crumbs.map((part, i) => (
            <React.Fragment key={crumbs.slice(0, i + 1).join('/')}>
              <ChevronRight size={11} className="shrink-0 text-[var(--text-faint)]" />
              <button type="button" onClick={() => go(at.place, crumbs.slice(0, i + 1).join('/'))}
                className={`min-w-0 truncate rounded px-1 ${i === crumbs.length - 1 ? 'font-medium text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>{part}</button>
            </React.Fragment>
          ))}
        </div>
      ) : null}
      {places && !places.folders.length && !searching && !at ? (
        <Blank icon={<HardDrive size={22} strokeWidth={1.5} />} title={t('mediaLibrary.emptyTitle')} body={t('mediaLibrary.paneEmpty')} />
      ) : searching && found && !items.length ? (
        <Blank icon={<Search size={22} strokeWidth={1.5} />} title={t(query.trim() || !smart ? 'mediaLibrary.noneFound' : `mediaLibrary.none_${smart}`)} {...(found.scanning ? { body: t('mediaLibrary.stillReading') } : {})} />
      ) : !searching && (listing?.gone || folder?.missing) ? (
        <Blank icon={<Unplug size={22} strokeWidth={1.5} />} title={t('mediaLibrary.offlineTitle')} body={t('mediaLibrary.offlineBody')} />
      ) : !searching && listing && !items.length ? (
        <Blank icon={<Clapperboard size={22} strokeWidth={1.5} />} title={t('mediaLibrary.noMedia')} />
      ) : (searching ? found : listing) ? (
        <Grid key={searching ? `found\n${smart}\n${query}` : `${at?.place}\n${at?.dir}`} items={items} picked={picked} tileMin={104} pad={10}
          onOpen={(path) => { if (at) go(at.place, path); }} onPick={pick} use={use} />
      ) : <div className="flex-1" />}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} dense /> : null}
    </div>
  );
}
