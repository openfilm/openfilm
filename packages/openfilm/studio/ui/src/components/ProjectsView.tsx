/**
 * The contents of the Projects popover (see ProjectsLibrary): a compact header (title, search, sort, view, new folder,
 * close), the folders and the projects as cards or a list, with "New project" as the first cell (and, under it, "Open
 * folder…" and "Get from GitHub…": an existing film), then the examples. Inside a folder a breadcrumb leads back to
 * all. Data and actions come from the popover.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, Check, ChevronDown, ChevronRight, Clock3, Folder, FolderInput, FolderOpen, FolderPlus, FolderSearch, Github, LayoutGrid, List, MoreHorizontal, Pencil, Plus, Search, SlidersHorizontal, Trash2, Video, X,
} from 'lucide-react';
import type { Example } from '@/lib/project-sources';
import { ExamplesSection } from './ProjectSources';
import { useLanguage, useT, type Language } from '@/i18n';
import { limitTitleWidth, TITLE_MAX_WIDTH } from '@/lib/title';
import { api, type Project } from '@/api';
import { folderCounts, folderPosters, folderTrail, listStarts, parentOf, visibleProjects, type LibrarySort, type ProjectFolder } from '@/lib/project-folders';
import { opensOnClick, posterRetryDelay, posterTry } from '@/lib/projects-page';
import { ContextMenu } from './ContextMenu';
import { ProjectMenu } from './ProjectMenu';
import { ProjectCoverContext } from './ProjectCover';
import { Tooltip } from './Tooltip';

/**
 * A project as the popover lists it: `poster` (an image URL; a gradient when it fails), `duration` (seconds, when
 * Studio knows the film's length), `createdAt` (when its folder was made) and `folderId` (its folder in the list).
 */
export type LibraryProject = Project & { poster?: string; duration?: number; createdAt?: number; folderId?: string };

type LibraryViewMode = 'cards' | 'list';

export function ProjectsView({
  projects,
  creating = false,
  onNewProject,
  onOpenFolder,
  onGetFromGitHub,
  onLocate,
  examples = [],
  examplesCollapsed = false,
  onToggleExamples,
  onOpenExample,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  folders,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveToFolder,
  onMoveFolder,
  onClose,
  heading,
}: {
  projects: LibraryProject[];
  /** A project is being created or opened; "New project" does not take a second click meanwhile. */
  creating?: boolean;
  /** "New project": made at once in the folder looked at (null: the top level), named as Studio names it (Untitled, Untitled 2…), and opened. */
  onNewProject: (folderId: string | null) => void;
  /** "Open folder…": a folder anywhere, opened as a project (the app's own dialog, else Studio's folder browser). */
  onOpenFolder: () => void;
  /** "Get from GitHub…": a repository or a folder in one, copied into the library and opened. */
  onGetFromGitHub: () => void;
  /** A project whose folder is gone: pick the folder it is in now. */
  onLocate: (project: LibraryProject) => void;
  /** The example films (none: the section is not shown), folded away or not, and opening one. */
  examples?: Example[];
  examplesCollapsed?: boolean;
  onToggleExamples?: () => void;
  onOpenExample?: (example: Example) => void;
  onOpen: (project: LibraryProject) => void;
  /** A new name for the project (its folder is renamed). Never empty. */
  onRename: (projectId: string, name: string) => void;
  onDuplicate: (project: LibraryProject) => void;
  /** Ask to delete these projects (the popover confirms first). */
  onDelete: (projectIds: string[]) => void;
  /** The list's folders. */
  folders: ProjectFolder[];
  /** Make a folder; resolves to it (null: it could not be made). */
  /** A new folder, in `parentId` (null: the top level). */
  onCreateFolder: (name: string, parentId?: string | null) => Promise<ProjectFolder | null>;
  /** A new name for a folder. Never empty. */
  onRenameFolder: (folderId: string, name: string) => void;
  /** Ask to delete a folder and the projects in it (the popover confirms first). */
  onDeleteFolder: (folder: ProjectFolder) => void;
  /** Put a project in a folder, or (null) in none. */
  onMoveToFolder: (projectId: string, folderId: string | null) => void;
  /** a folder into another (null: the top level) */
  onMoveFolder: (folderId: string, parentId: string | null) => void;
  /** Missing: no close button (Studio has no project to go back to). */
  onClose?: () => void;
  /** The title row's left, in place of "Projects" (the launcher's switch between the projects and the examples). */
  heading?: React.ReactNode;
}) {
  const t = useT();
  /* recently opened first: someone coming back to the list most likely wants the one they just had */
  const [sort, setSort] = React.useState<LibrarySort>('recent');
  const [view, setView] = React.useState<LibraryViewMode>('cards');
  const [query, setQuery] = React.useState('');
  const [selecting, setSelecting] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());
  /** The card being renamed in place. One at a time; clicking the cover still opens the project. */
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  /* folders: the one being looked at (null = all), the project a folder is being picked for, the folder being named */
  const [folderId, setFolderId] = React.useState<string | null>(null);
  /* what the folder picker moves: a project, or a folder of the list */
  const [moving, setMoving] = React.useState<{ project: LibraryProject } | { folder: ProjectFolder } | null>(null);
  const [renamingFolderId, setRenamingFolderId] = React.useState<string | null>(null);
  /* the folder looked at was deleted (here or elsewhere): back to all */
  React.useEffect(() => {
    if (folderId && !folders.some((f) => f.id === folderId)) setFolderId(null);
  }, [folderId, folders]);

  const visible = React.useMemo(
    () => visibleProjects(projects, { query, folderId, sort, folders, titleOf: (p) => titleOf(p, t) }),
    [projects, query, folderId, sort, folders, t],
  );
  /* folder cards only at the top level and not while searching: inside a folder is its content, a search its results */
  /* the folders here: the top level's, or those inside the folder open (a search shows projects only) */
  const showFolders = !query.trim();
  const levelFolders = React.useMemo(() => folders.filter((f) => parentOf(f, folders) === folderId), [folders, folderId]);
  const currentFolder = folders.find((f) => f.id === folderId) ?? null;
  const trail = React.useMemo(() => folderTrail(folders, folderId), [folders, folderId]);
  const counts = React.useMemo(() => folderCounts(projects, folders), [projects, folders]);
  const posters = React.useMemo(() => folderPosters(projects, folders), [projects, folders]);

  /** A card's open: on a click, a key press or its menu, not on the second click of a double-click (lib/projects-page). */
  const opening = (run: () => void) => (event?: { detail: number }) => { if (!event || opensOnClick(event)) run(); };

  async function newFolder() {
    const created = await onCreateFolder(t('projects.untitledFolder'), folderId);
    if (created) setRenamingFolderId(created.id);
  }

  function folderProps(folder: ProjectFolder): FolderItemProps {
    return {
      folder,
      count: counts[folder.id] ?? 0,
      posters: posters[folder.id] ?? [],
      renaming: renamingFolderId === folder.id,
      onOpen: opening(() => setFolderId(folder.id)),
      onStartRename: () => setRenamingFolderId(folder.id),
      onCommitRename: (name: string) => {
        setRenamingFolderId(null);
        if (name && name !== folder.name) onRenameFolder(folder.id, name);
      },
      onCancelRename: () => setRenamingFolderId(null),
      onDelete: () => onDeleteFolder(folder),
      onMove: () => setMoving({ folder }),
    };
  }

  const selectableIds = React.useMemo(() => visible.map((project) => project.id), [visible]);
  const selectedCount = selectedIds.size;
  const allVisibleSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  const exitSelecting = React.useCallback(() => {
    setSelecting(false);
    setSelectedIds(new Set());
  }, []);

  /* selected projects left the list (deleted): drop them from the selection; none left → leave select mode, its job
     is done and an empty select mode only costs one more click to get back to opening projects */
  React.useEffect(() => {
    if (!selecting) return;
    const alive = new Set(projects.map((project) => project.id));
    const kept = [...selectedIds].filter((id) => alive.has(id));
    if (kept.length === selectedIds.size) return;
    if (kept.length === 0) {
      exitSelecting();
      return;
    }
    setSelectedIds(new Set(kept));
  }, [projects, selecting, selectedIds, exitSelecting]);

  /* Escape leaves select mode only. On the document, so it comes before the Projects window's own Escape (on the
     window), which a handled Escape (defaultPrevented) does not close */
  React.useEffect(() => {
    if (!selecting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      exitSelecting();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selecting, exitSelecting]);

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of selectableIds) {
        if (allVisibleSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  /** "Select" on a card's menu enters select mode with that card already ticked: it is the one being pointed at. */
  function startSelecting(project: LibraryProject) {
    setRenamingId(null);
    setSelecting(true);
    setSelectedIds(new Set([project.id]));
  }

  function itemProps(project: LibraryProject): ItemProps {
    return {
      project,
      title: titleOf(project, t),
      selecting,
      selected: selectedIds.has(project.id),
      renaming: renamingId === project.id,
      onToggleSelect: () => toggleSelected(project.id),
      onOpen: opening(() => onOpen(project)),
      onDuplicate: () => onDuplicate(project),
      onStartRename: () => { if (!selecting) setRenamingId(project.id); },
      onCommitRename: (name: string) => {
        setRenamingId((current) => (current === project.id ? null : current));
        /* empty or unchanged: nothing to do (a project is its folder, and a folder needs a name) */
        if (!name || name === project.name.trim()) return;
        onRename(project.id, name);
      },
      onCancelRename: () => setRenamingId((current) => (current === project.id ? null : current)),
      onStartSelect: () => startSelecting(project),
      onMoveToFolder: () => setMoving({ project }),
      onLocate: () => onLocate(project),
      onDelete: () => onDelete([project.id]),
    };
  }

  const starts = listStarts({ folderId, query });
  const showNew = starts.newProject;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* the header stays out of the scroll area: inside it, the list view's scrollbar would narrow the header */}
      <header className="flex shrink-0 flex-col gap-3 px-6 pb-4 pt-5">
        <div className="flex min-h-8 items-center gap-2">
          {/* inside a folder the title is the way back: "Projects / test", on the same line, so what is in the folder
              starts where the projects do */}
          {currentFolder ? (
            <FolderCrumb
              folder={currentFolder}
              above={trail.slice(0, -1)}
              count={counts[currentFolder.id] ?? 0}
              onGo={setFolderId}
              onRename={(name) => onRenameFolder(currentFolder.id, name)}
              onDelete={() => onDeleteFolder(currentFolder)}
              onMove={() => setMoving({ folder: currentFolder })}
            />
          ) : (
            heading ?? <h2 className="mr-auto text-[17px] font-semibold tracking-[-0.01em] text-[var(--text)]">{t('nav.projects')}</h2>
          )}
          {projects.length > 0 ? (
            <>
              <label className="relative w-[240px] shrink-0">
                <span className="sr-only">{t('library.searchPlaceholder')}</span>
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('library.searchPlaceholder')}
                  className="h-8 w-full rounded-lg bg-[var(--bg-field)] pl-8 pr-3 text-[12.5px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:ring-1 focus:ring-[var(--border-strong)]"
                />
              </label>
              <SortButton sort={sort} onSort={setSort} />
              <div className="flex h-8 shrink-0 items-center gap-0.5 rounded-lg bg-[var(--bg-field)] px-[3px]" aria-label={t('library.viewLabel')}>
                <ViewButton active={view === 'cards'} label={t('library.viewCards')} onClick={() => setView('cards')} icon={<LayoutGrid size={14} />} />
                <ViewButton active={view === 'list'} label={t('library.viewList')} onClick={() => setView('list')} icon={<List size={14} />} />
              </div>
              {/* at the top level or inside a folder: a folder can hold folders */}
              <Tooltip label={t('projects.newFolder')} side="bottom">
                <button
                  type="button"
                  aria-label={t('projects.newFolder')}
                  onClick={() => void newFolder()}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                >
                  <FolderPlus size={15} strokeWidth={1.9} />
                </button>
              </Tooltip>
            </>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('project.close')}
              className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
      </header>

      {/* the one scroll area; the scrollbar gutter is reserved so cards keep their width either way */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]">
        <div className="w-full flex-1 px-6 pb-6">
          {visible.length === 0 && !showNew && !(showFolders && levelFolders.length > 0) ? (
            <div className="flex min-h-[42vh] items-center justify-center text-[14px] text-[var(--text-muted)]">
              {t('library.noMatches')}
            </div>
          ) : view === 'cards' ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
              {showNew ? <NewProjectCard creating={creating} onNewProject={() => onNewProject(folderId)} {...(folderId === null ? { onOpenFolder, onGetFromGitHub } : {})} /> : null}
              {showFolders ? levelFolders.map((folder) => <FolderCard key={`folder:${folder.id}`} {...folderProps(folder)} />) : null}
              {visible.map((project) => <ProjectCard key={project.id} {...itemProps(project)} />)}
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-[var(--border)]">
              {showNew ? <NewProjectListRow creating={creating} onNewProject={() => onNewProject(folderId)} {...(folderId === null ? { onOpenFolder, onGetFromGitHub } : {})} /> : null}
              {showFolders ? levelFolders.map((folder) => <FolderListRow key={`folder:${folder.id}`} {...folderProps(folder)} />) : null}
              {visible.map((project) => <ProjectListRow key={project.id} {...itemProps(project)} />)}
            </div>
          )}
          {starts.examples && onOpenExample ? (
            <ExamplesSection examples={examples} collapsed={examplesCollapsed} onToggle={() => onToggleExamples?.()} onOpen={onOpenExample} view={view} />
          ) : null}
        </div>

        {selecting ? (
          <div className="pointer-events-none sticky bottom-0 z-20 flex justify-center pb-5">
            <div
              className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-[var(--border)] bg-[var(--bg-raised)] py-1.5 pl-4 pr-1.5 shadow-[var(--shadow-lg)]"
              style={{ animation: 'openfilm-rise 0.16s ease-out both' }}
            >
              <span className="text-[13px] font-medium tabular-nums text-[var(--text)]">
                {t('library.selectedCount').replace('{n}', String(selectedCount))}
              </span>
              <span className="mx-2 h-4 w-px bg-[var(--border)]" />
              <button
                type="button"
                onClick={toggleSelectAllVisible}
                disabled={selectableIds.length === 0}
                className="h-8 rounded-xl px-2.5 text-[12.5px] font-medium text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40"
              >
                {allVisibleSelected ? t('library.deselectAll') : t('library.selectAll')}
              </button>
              <button
                type="button"
                onClick={() => { if (selectedIds.size) onDelete([...selectedIds]); }}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--err)] px-3 text-[12.5px] font-semibold text-[var(--on-accent)] transition hover:brightness-110"
              >
                <Trash2 size={13} />
                {t('library.deleteSelected')}
              </button>
              <Tooltip label={t('library.cancelSelect')}>
                <button
                  type="button"
                  onClick={exitSelecting}
                  aria-label={t('library.cancelSelect')}
                  className="flex h-8 w-8 items-center justify-center rounded-xl text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                >
                  <X size={15} />
                </button>
              </Tooltip>
            </div>
          </div>
        ) : null}
      </div>

      {moving ? (
        <FolderPicker
          title={'project' in moving ? titleOf(moving.project, t) : moving.folder.name}
          folders={folders}
          current={'project' in moving
            ? (moving.project.folderId && folders.some((f) => f.id === moving.project.folderId) ? moving.project.folderId : null)
            : parentOf(moving.folder, folders)}
          /* a folder never goes into itself or a folder inside it */
          exclude={'folder' in moving ? new Set([moving.folder.id, ...folders.filter((f) => folderTrail(folders, f.id).some((up) => up.id === moving.folder.id)).map((f) => f.id)]) : new Set()}
          onMove={(fid) => {
            if ('project' in moving) onMoveToFolder(moving.project.id, fid);
            else onMoveFolder(moving.folder.id, fid);
            setMoving(null);
          }}
          onCreate={(name, parentId) => onCreateFolder(name, parentId)}
          onClose={() => setMoving(null)}
        />
      ) : null}
    </div>
  );
}

interface ItemProps {
  project: LibraryProject;
  /** The name shown ("Untitled" when empty). */
  title: string;
  selecting: boolean;
  selected: boolean;
  renaming: boolean;
  onToggleSelect: () => void;
  onOpen: (event?: { detail: number }) => void;
  onDuplicate: () => void;
  onStartRename: () => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
  onStartSelect: () => void;
  onMoveToFolder: () => void;
  onLocate: () => void;
  onDelete: () => void;
}

function SelectionCheck({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-5 w-5 items-center justify-center rounded-md border transition ${
        selected
          ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]'
          : 'border-white/60 bg-black/35 text-transparent backdrop-blur-sm hover:border-white'
      }`}
    >
      <Check size={12} strokeWidth={2.5} />
    </span>
  );
}

/** The tick at the cover's top left: only in select mode. */
function SelectToggle({
  selecting,
  selected,
  onToggle,
  label,
}: {
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  label: string;
}) {
  if (!selecting) return null;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      aria-label={label}
      aria-pressed={selected}
      className="absolute left-2 top-2 z-10 rounded-md"
    >
      <SelectionCheck selected={selected} />
    </button>
  );
}

function ProjectCardTitle({
  display,
  stored,
  renaming,
  size,
  onOpen,
  onCommit,
  onCancel,
}: {
  display: string;
  stored: string;
  renaming: boolean;
  size: 'card' | 'list';
  onOpen: (event?: { detail: number }) => void;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = React.useState(stored);
  const committed = React.useRef(false);

  React.useEffect(() => {
    if (!renaming) return;
    committed.current = false;
    setDraft(stored);
  }, [renaming, stored]);

  const textClass =
    size === 'card'
      ? 'text-[13px] font-semibold text-[var(--text)]'
      : 'text-[14px] font-semibold text-[var(--text)]';

  function commit() {
    if (committed.current) return;
    committed.current = true;
    onCommit(limitTitleWidth(draft.replace(/\s+/g, ' ').trim(), TITLE_MAX_WIDTH));
  }

  function cancel() {
    if (committed.current) return;
    committed.current = true;
    onCancel();
  }

  if (renaming) {
    return (
      <input
        autoFocus
        value={draft}
        aria-label={t('projectMenu.rename')}
        placeholder={t('project.untitled')}
        onChange={(event) => {
          const next = event.target.value;
          /* mid-composition (IME) the text is not final: limit it once composition ends */
          if ((event.nativeEvent as InputEvent).isComposing) {
            setDraft(next);
            return;
          }
          setDraft(limitTitleWidth(next, TITLE_MAX_WIDTH));
        }}
        onCompositionEnd={(event) => {
          setDraft(limitTitleWidth(event.currentTarget.value, TITLE_MAX_WIDTH));
        }}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            if (event.nativeEvent.isComposing) return;
            event.preventDefault();
            commit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            /* the popover would close on this Escape too */
            event.stopPropagation();
            cancel();
          }
        }}
        onClick={(event) => event.stopPropagation()}
        className={`box-border w-full min-w-0 bg-transparent outline-none placeholder:text-[var(--text-faint)] ${textClass}`}
      />
    );
  }

  return (
    <button type="button" onClick={onOpen} className="min-w-0 w-full text-left">
      {/* the folder's name as it is: two spaces stay two (HTML would show one) */}
      <h2 className={`truncate ${textClass}`} style={{ whiteSpace: 'pre' }}>{display}</h2>
    </button>
  );
}

type NewProjectProps = {
  creating: boolean;
  onNewProject: () => void;
  /* starting from a film that exists: at the top level only (what they make is not filed in a folder) */
  onOpenFolder?: () => void;
  onGetFromGitHub?: () => void;
};

/** The grid's first cell: start a new project, card-sized, so "new ones start here" reads at a glance. */
function NewProjectCard({ creating, onNewProject, onOpenFolder, onGetFromGitHub }: NewProjectProps) {
  const t = useT();
  return (
    <article className="group min-w-0">
      <button
        type="button"
        onClick={onNewProject}
        disabled={creating}
        aria-busy={creating}
        className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border-strong)] text-[var(--text-muted)] transition hover:border-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-60"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--bg-field)] text-[var(--text)] transition group-hover:scale-105">
          <Plus size={18} strokeWidth={2.2} />
        </span>
        <span className="text-[13px] font-medium">{t('projects.newProject')}</span>
      </button>
      {/* where the other cards have their name: starting from a film that exists */}
      <div className="mt-2 flex">
        {onOpenFolder && onGetFromGitHub ? <ImportMenu creating={creating} onOpenFolder={onOpenFolder} onGetFromGitHub={onGetFromGitHub} className="-ml-1.5 h-7 px-1.5 text-[12.5px]" /> : null}
      </div>
    </article>
  );
}

/** "New project" in the list view: the same entries, as a row. */
function NewProjectListRow({ creating, onNewProject, onOpenFolder, onGetFromGitHub }: NewProjectProps) {
  const t = useT();
  return (
    <article className="group flex min-w-0 items-center gap-3 py-4 sm:gap-4">
      <button
        type="button"
        onClick={onNewProject}
        disabled={creating}
        aria-busy={creating}
        className="flex aspect-video w-28 shrink-0 items-center justify-center rounded-md border border-dashed border-[var(--border-strong)] text-[var(--text-muted)] transition hover:border-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-60 sm:w-36"
        aria-label={t('projects.newProject')}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-field)] text-[var(--text)] transition group-hover:scale-105">
          <Plus size={16} strokeWidth={2.2} />
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onNewProject}
          disabled={creating}
          className="text-left text-[14px] font-medium text-[var(--text)] hover:underline disabled:opacity-60"
        >
          {t('projects.newProject')}
        </button>
      </div>
      {onOpenFolder && onGetFromGitHub ? <ImportMenu creating={creating} onOpenFolder={onOpenFolder} onGetFromGitHub={onGetFromGitHub} className="h-8 px-2.5 text-[12.5px]" /> : null}
    </article>
  );
}

/** "Import from ⌄": the ways to start from a film that exists, a folder on this computer or a repository on GitHub. */
function ImportMenu({ creating, onOpenFolder, onGetFromGitHub, className }: Required<Omit<NewProjectProps, 'onNewProject'>> & { className: string }) {
  const t = useT();
  const [anchor, setAnchor] = React.useState<{ x: number; y: number; top: number } | null>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        disabled={creating}
        aria-expanded={anchor != null}
        aria-haspopup="menu"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setAnchor((cur) => (cur ? null : { x: box.left, y: box.bottom + 4, top: box.top - 4 }));
        }}
        className={`inline-flex shrink-0 items-center gap-1 rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-60 ${className}`}
      >
        {t('projects.importFrom')}
        <ChevronDown size={13} />
      </button>
      {anchor ? (
        <ContextMenu
          x={anchor.x}
          y={anchor.y}
          flipTo={anchor.top}
          trigger={button}
          onClose={() => setAnchor(null)}
          items={[
            { id: 'folder', icon: <FolderOpen size={14} />, label: t('projects.openFolder'), onSelect: onOpenFolder },
            { id: 'github', icon: <Github size={14} />, label: t('projects.getFromGitHub'), onSelect: onGetFromGitHub },
          ]}
        />
      ) : null}
    </>
  );
}

function ProjectCard({
  project,
  title,
  selecting,
  selected,
  renaming,
  onToggleSelect,
  onOpen,
  onDuplicate,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onStartSelect,
  onMoveToFolder,
  onLocate,
  onDelete,
}: ItemProps) {
  const t = useT();
  const language = useLanguage();
  const open = selecting ? onToggleSelect : onOpen;
  return (
    <article className="group min-w-0">
      <div className="relative">
        <button
          type="button"
          onClick={open}
          className="relative block aspect-video w-full overflow-hidden rounded-lg bg-[var(--bg-field)] text-left ring-1 ring-[var(--border)] transition duration-200 hover:brightness-[1.04]"
          aria-label={title}
          aria-pressed={selecting ? selected : undefined}
        >
          <PosterMedia project={project} shade />
          {/* chosen: an outline drawn inside the card, over its picture, so the list's edge never cuts it */}
          {selected ? <span aria-hidden className="pointer-events-none absolute inset-0 z-[1] rounded-lg ring-2 ring-inset ring-[var(--accent)]" /> : null}
          {project.missing ? <span aria-hidden className="absolute inset-0 bg-black/45" /> : null}
          {project.duration && !project.missing ? (
            <div className="absolute bottom-2 right-2 text-[10.5px] font-medium text-white/80">
              <span className="flex items-center gap-1 rounded bg-black/40 px-1.5 py-0.5 tabular-nums backdrop-blur-sm">
                <Clock3 size={10} />
                {formatDuration(project.duration)}
              </span>
            </div>
          ) : null}
        </button>
        <SelectToggle selecting={selecting} selected={selected} onToggle={onToggleSelect} label={t('library.toggleSelect')} />
        {project.missing && !selecting ? <MissingActions reason={project.missingReason} onLocate={onLocate} onRemove={onDelete} /> : null}
      </div>

      <div className="mt-2 flex min-w-0 items-start gap-1.5">
        <div className="min-w-0 flex-1 text-left">
          <ProjectCardTitle
            display={title}
            stored={project.name}
            renaming={renaming}
            size="card"
            onOpen={open}
            onCommit={onCommitRename}
            onCancel={onCancelRename}
          />
          <button
            type="button"
            onClick={open}
            className="mt-0.5 flex w-full items-center gap-1.5 text-left text-[11.5px] text-[var(--text-faint)]"
          >
            <Video size={11} />
            {formatDate(project.openedAt, language)}
            {project.missing ? <span className="truncate text-[var(--err)]">· {t(project.missingReason === 'film' ? 'projects.missingFilm' : 'projects.missing')}</span> : null}
            {project.working ? <span className="truncate text-[var(--accent)]">· {t('projects.agentRunning')}</span> : null}
          </button>
        </div>
        {!selecting ? <ItemMenu project={project} onOpen={onOpen} onDuplicate={onDuplicate} onStartRename={onStartRename} onStartSelect={onStartSelect} onMoveToFolder={onMoveToFolder} onLocate={onLocate} onDelete={onDelete} size={14} /> : null}
      </div>
    </article>
  );
}

/**
 * On the cover of a project whose folder is gone: "Folder not found", and the two things to do about it: point it at
 * the folder it is in now (it keeps its place, and its history goes with the folder), or take it off the list.
 */
function MissingActions({ reason, onLocate, onRemove, compact = false }: { reason?: Project['missingReason']; onLocate: () => void; onRemove: () => void; compact?: boolean }) {
  const t = useT();
  const button = 'inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition';
  return (
    <div className={compact ? 'flex items-center gap-1' : 'pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-2'}>
      {compact ? null : <span className="text-[12px] font-semibold text-white drop-shadow">{t(reason === 'film' ? 'projects.missingFilm' : 'projects.missing')}</span>}
      <div className="pointer-events-auto flex items-center gap-1.5">
        <button type="button" onClick={onLocate} className={`${button} bg-[var(--bg-raised)] text-[var(--text)] shadow hover:brightness-95`}>
          <FolderSearch size={13} />
          {t('projects.locate')}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className={`${button} ${compact ? 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]' : 'bg-black/40 text-white backdrop-blur-sm hover:bg-black/55'}`}
        >
          {t('projects.removeFromList')}
        </button>
      </div>
    </div>
  );
}

/**
 * A card's or row's "…", with Reveal to show where its folder is. A project whose folder is gone can be located or
 * leave the list: there is nothing to open, rename or reveal.
 */
function ItemMenu({
  project,
  onOpen,
  onDuplicate,
  onStartRename,
  onStartSelect,
  onMoveToFolder,
  onLocate,
  onDelete,
  size,
}: Pick<ItemProps, 'project' | 'onOpen' | 'onDuplicate' | 'onStartRename' | 'onStartSelect' | 'onMoveToFolder' | 'onLocate' | 'onDelete'> & { size: number }) {
  const cover = React.useContext(ProjectCoverContext);
  if (project.missing) return <ProjectMenu onLocate={onLocate} onRemove={onDelete} size={size} />;
  return (
    <ProjectMenu
      onOpen={onOpen}
      onRename={onStartRename}
      onDuplicate={onDuplicate}
      onSelect={onStartSelect}
      onMoveToFolder={onMoveToFolder}
      onChangeCover={cover ? () => cover.change(project) : undefined}
      onRestoreCover={cover && project.cover ? () => cover.restore(project) : undefined}
      onReveal={() => void api.revealProject(project.id).catch(() => {})}
      onDelete={onDelete}
      size={size}
    />
  );
}

/** A row in the list view; the folder's path stands where a description would. */
function ProjectListRow({
  project,
  title,
  selecting,
  selected,
  renaming,
  onToggleSelect,
  onOpen,
  onDuplicate,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onStartSelect,
  onMoveToFolder,
  onLocate,
  onDelete,
}: ItemProps) {
  const t = useT();
  const language = useLanguage();
  const open = selecting ? onToggleSelect : onOpen;
  return (
    <article className={`group flex min-w-0 items-center gap-3 py-4 sm:gap-4 ${selected ? 'bg-[var(--bg-hover)]/40' : ''}`}>
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={open}
          className="relative block aspect-video w-28 overflow-hidden rounded-md bg-[var(--bg-field)] ring-1 ring-[var(--border)] sm:w-36"
          aria-label={title}
        >
          <PosterMedia project={project} />
          {selected ? <span aria-hidden className="pointer-events-none absolute inset-0 z-[1] rounded-md ring-2 ring-inset ring-[var(--accent)]" /> : null}
        </button>
        <SelectToggle selecting={selecting} selected={selected} onToggle={onToggleSelect} label={t('library.toggleSelect')} />
      </div>
      <div className="min-w-0 flex-1 text-left">
        <ProjectCardTitle
          display={title}
          stored={project.name}
          renaming={renaming}
          size="list"
          onOpen={open}
          onCommit={onCommitRename}
          onCancel={onCancelRename}
        />
        <button type="button" onClick={open} className="w-full text-left">
          <p className="mt-1 line-clamp-2 break-all text-[12.5px] leading-relaxed text-[var(--text-muted)]">
            {project.path}
          </p>
          <p className="mt-2 flex items-center gap-2 text-[11.5px] text-[var(--text-faint)]">
            {formatDate(project.openedAt, language)}
            {project.missing ? <span className="text-[var(--err)]">· {t(project.missingReason === 'film' ? 'projects.missingFilm' : 'projects.missing')}</span> : null}
            {project.working ? <span className="text-[var(--accent)]">· {t('projects.agentRunning')}</span> : null}
          </p>
        </button>
      </div>
      {project.missing && !selecting ? <MissingActions compact reason={project.missingReason} onLocate={onLocate} onRemove={onDelete} /> : null}
      {!selecting ? <ItemMenu project={project} onOpen={onOpen} onDuplicate={onDuplicate} onStartRename={onStartRename} onStartSelect={onStartSelect} onMoveToFolder={onMoveToFolder} onLocate={onLocate} onDelete={onDelete} size={15} /> : null}
    </article>
  );
}

/**
 * A folder's picture: a folder with some depth (a back panel with its tab, the front panel over it, a highlight along
 * its top). Not lucide's outline Folder: an outline drawn for 16 px buttons, blown up to a third of a card, looks like
 * a placeholder. Three grays (`--folder-*`) per theme and no hue: the covers around it carry the color.
 *
 * Its width comes from `className`; the height follows at 72:56.
 */
function FolderGlyph({ className }: { className?: string }) {
  const id = React.useId();
  return (
    <svg viewBox="0 0 72 56" aria-hidden className={className}>
      <defs>
        <linearGradient id={`${id}-front`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--folder-front-hi)" />
          <stop offset="0.18" stopColor="var(--folder-front)" />
          <stop offset="1" stopColor="var(--folder-front)" />
        </linearGradient>
      </defs>
      <path
        d="M2 12c0-3.3 2.7-6 6-6h16.6c1.6 0 3.1.6 4.2 1.8l3.4 3.4c.8.8 1.9 1.2 3 1.2H64c3.3 0 6 2.7 6 6V48c0 3.3-2.7 6-6 6H8c-3.3 0-6-2.7-6-6Z"
        fill="var(--folder-back)"
      />
      <rect x="2" y="20" width="68" height="34" rx="6" fill={`url(#${id}-front)`} />
    </svg>
  );
}

interface FolderItemProps {
  folder: ProjectFolder;
  count: number;
  /** its newest projects, up to four, with their covers when they have one */
  posters: { id: string; poster?: string }[];
  renaming: boolean;
  onOpen: (event?: { detail: number }) => void;
  onStartRename: () => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onMove: () => void;
}

/**
 * A folder's face: the covers of its newest projects (as many cells as covers: one fills the face, three put the first
 * beside the other two, so no cell is blank), or the folder picture when it holds none. The card's, and the list row's
 * thumbnail (`small`: tighter margins).
 */
function FolderFace({ posters, small = false }: { posters: FolderItemProps['posters']; small?: boolean }) {
  if (!posters.length) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <FolderGlyph className="w-[34%] transition-transform duration-200 group-hover:-translate-y-0.5" />
      </div>
    );
  }
  return (
    <div className={`absolute grid ${small ? 'inset-1.5 gap-1' : 'inset-3 gap-1.5'} ${posters.length === 1 ? 'grid-cols-1' : posters.length === 2 ? 'grid-cols-2' : 'grid-cols-2 grid-rows-2'}`}>
      {posters.slice(0, 4).map((cover, i) => (
        <div key={cover.id} className={`relative overflow-hidden ${small ? 'rounded-[3px]' : 'rounded-[5px]'} bg-[var(--bg-pressed)] ${posters.length === 3 && i === 0 ? 'row-span-2' : ''}`}>
          <MiniPoster id={cover.id} url={cover.poster} />
        </div>
      ))}
    </div>
  );
}

/**
 * A folder's 16:9 box drawn as a folder, so it doesn't read as a project: the back's tab (`--folder-back`, as in the
 * folder picture) at the top left, and the front under it, which holds the face and anything over it (`children`).
 * The card's, and the list row's thumbnail (`small`).
 */
function FolderFrame({ small = false, children }: { small?: boolean; children: React.ReactNode }) {
  return (
    <>
      <span aria-hidden className={`absolute left-0 top-0 h-1/2 w-[38%] bg-[var(--folder-back)] ${small ? 'rounded-[5px]' : 'rounded-lg'}`} />
      <span
        className={`absolute inset-x-0 bottom-0 overflow-hidden bg-[var(--bg-field)] ring-1 ring-[var(--border)] transition duration-200 group-hover/frame:bg-[var(--bg-pressed)] group-hover/frame:ring-[var(--border-strong)] ${small ? 'top-[9%] rounded-md' : 'top-[7%] rounded-lg'}`}
      >
        {children}
      </span>
    </>
  );
}

/**
 * A folder card: the project card's size (a 16:9 box and a name under it), drawn as a folder (FolderFrame), its face
 * the covers of its newest projects, so what it holds shows at a glance; an empty one shows the folder picture.
 */
function FolderCard({
  folder,
  count,
  posters,
  renaming,
  onOpen,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
  onMove,
}: FolderItemProps) {
  const t = useT();
  const language = useLanguage();
  return (
    <article className="group min-w-0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={folder.name}
        className="group/frame relative block aspect-video w-full text-left"
      >
        <FolderFrame>
          <FolderFace posters={posters} />
          {/* the count: dark glass over covers; on the plain face a dark patch is too heavy, so the face's own style */}
          <span
            className={`absolute bottom-2 right-2 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums ${
              posters.length > 0
                ? 'bg-black/45 text-white/90 backdrop-blur-sm'
                : 'border border-[var(--border)] bg-[var(--bg-raised)] text-[var(--text-muted)]'
            }`}
          >
            {count}
          </span>
        </FolderFrame>
      </button>
      {/* the same two lines as a project card (name, then a dated line); no folder icon before the name: the face says
          it is a folder already, and an icon would put this name out of line with the projects'. A click on the name
          opens the folder, as a project's opens the project, so it is renamed from "…" or from the open folder's
          title, not by a double-click (the first click would already have opened it) */}
      <div className="mt-2 flex min-w-0 items-start gap-1.5">
        <div className="min-w-0 flex-1 text-left">
          {renaming ? (
            <InlineNameInput
              initial={folder.name}
              onCommit={onCommitRename}
              onCancel={onCancelRename}
              className="h-6 w-full rounded-md border border-[var(--text)] bg-[var(--bg-raised)] px-1.5 text-[13px] font-semibold text-[var(--text)] outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={onOpen}
              className="block w-full truncate text-left text-[13px] font-semibold text-[var(--text)]"
            >
              {folder.name}
            </button>
          )}
          <button
            type="button"
            onClick={onOpen}
            className="mt-0.5 flex w-full items-center gap-1.5 text-left text-[11.5px] text-[var(--text-faint)]"
          >
            <Clock3 size={11} />
            {formatDate(folder.createdAt, language)}
          </button>
        </div>
        <FolderMenu onRename={onStartRename} onMove={onMove} onDelete={onDelete} />
      </div>
      <span className="sr-only">{t('projects.folderAll')}</span>
    </article>
  );
}

/**
 * One of a folder card's small covers: the project's poster, or (none, or it failed to load) the same face its own
 * card shows. The cell stays plain while the poster loads.
 */
function MiniPoster({ id, url }: { id: string; url?: string }) {
  const [state, setState] = React.useState<'loading' | 'ready' | 'failed'>('loading');
  if (!url || state === 'failed') return <div className="absolute inset-0 opacity-80" style={{ background: gradientForId(id) }} />;
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      draggable={false}
      onLoad={() => setState('ready')}
      onError={() => setState('failed')}
      className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${state === 'ready' ? 'opacity-100' : 'opacity-0'}`}
    />
  );
}

/** A folder in the list view; its thumbnail is the project rows' size, so the column of thumbnails lines up. */
function FolderListRow({
  folder,
  count,
  posters,
  renaming,
  onOpen,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
  onMove,
}: FolderItemProps) {
  const t = useT();
  const language = useLanguage();
  return (
    <div className="group flex min-w-0 items-center gap-3 py-4 sm:gap-4">
      <button
        type="button"
        onClick={onOpen}
        className="group/frame relative block aspect-video w-28 shrink-0 sm:w-36"
        aria-label={folder.name}
      >
        <FolderFrame small>
          <FolderFace posters={posters} small />
        </FolderFrame>
      </button>
      <div className="min-w-0 flex-1">
        {renaming ? (
          <InlineNameInput
            initial={folder.name}
            onCommit={onCommitRename}
            onCancel={onCancelRename}
            className="h-7 w-[240px] rounded-md border border-[var(--text)] bg-[var(--bg-raised)] px-2 text-[14px] font-semibold text-[var(--text)] outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={onOpen}
            className="block max-w-full truncate text-left text-[14px] font-semibold text-[var(--text)]"
          >
            {folder.name}
          </button>
        )}
        <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
          {t(count === 1 ? 'projects.folderCountOne' : 'projects.folderCount').replace('{n}', String(count))}
        </p>
        <p className="mt-2 text-[11.5px] text-[var(--text-faint)]">
          {formatDate(folder.createdAt, language)}
        </p>
      </div>
      <FolderMenu onRename={onStartRename} onMove={onMove} onDelete={onDelete} />
    </div>
  );
}

/** A folder's "…": rename, delete. The project card's menu, in looks and placement (see ProjectMenu). */
function FolderMenu({ onRename, onMove, onDelete }: { onRename: () => void; onMove: () => void; onDelete: () => void }) {
  const t = useT();
  const [anchor, setAnchor] = React.useState<{ x: number; y: number; top: number } | null>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={t('projectMenu.more')}
        aria-expanded={anchor != null}
        aria-haspopup="menu"
        onClick={(event) => {
          event.stopPropagation();
          const box = event.currentTarget.getBoundingClientRect();
          setAnchor((cur) => (cur ? null : { x: box.right, y: box.bottom + 4, top: box.top - 4 }));
        }}
        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
      >
        <MoreHorizontal size={14} />
      </button>
      {anchor ? (
        <ContextMenu
          x={anchor.x}
          y={anchor.y}
          flipTo={anchor.top}
          align="end"
          trigger={button}
          onClose={() => setAnchor(null)}
          items={[
            { id: 'rename', icon: <Pencil size={14} />, label: t('projects.renameFolder'), onSelect: onRename },
            { id: 'move', icon: <FolderInput size={14} />, label: t('projects.moveTo'), onSelect: onMove },
            { id: 'sep', separator: true },
            { id: 'delete', icon: <Trash2 size={14} />, label: t('projects.deleteFolder'), danger: true, onSelect: onDelete },
          ]}
        />
      ) : null}
    </>
  );
}

/**
 * Inside a folder, in the title's place: "← Projects / Clients / Acme  count  …", each folder above it a way back to
 * it, the arrow one level up. Double-click the name to rename.
 */
function FolderCrumb({
  folder,
  above,
  count,
  onGo,
  onRename,
  onDelete,
  onMove,
}: {
  folder: ProjectFolder;
  /** the folders it is in, the outermost first */
  above: ProjectFolder[];
  count: number;
  /** go to a folder of the trail (null: all projects) */
  onGo: (folderId: string | null) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onMove: () => void;
}) {
  const t = useT();
  const [renaming, setRenaming] = React.useState(false);
  const step = 'inline-flex h-8 min-w-0 items-center rounded-lg px-1.5 text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]';
  return (
    <h2 className="mr-auto flex min-w-0 items-center gap-1 text-[17px] font-semibold tracking-[-0.01em]">
      <button type="button" onClick={() => onGo(above.length ? above[above.length - 1]!.id : null)} aria-label={t('projects.folderUp')}
        className="-ml-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
        <ArrowLeft size={15} />
      </button>
      <button type="button" onClick={() => onGo(null)} className={`${step} shrink-0`}>{t('nav.projects')}</button>
      {above.map((up) => (
        <React.Fragment key={up.id}>
          <span className="shrink-0 font-normal text-[var(--text-faint)]">/</span>
          <button type="button" onClick={() => onGo(up.id)} className={`${step} max-w-[160px]`}><span className="truncate">{up.name}</span></button>
        </React.Fragment>
      ))}
      <span className="shrink-0 font-normal text-[var(--text-faint)]">/</span>
      <Folder size={16} strokeWidth={1.9} className="shrink-0 text-[var(--text-faint)]" />
      {renaming ? (
        <InlineNameInput
          initial={folder.name}
          onCommit={(name) => {
            setRenaming(false);
            if (name && name !== folder.name) onRename(name);
          }}
          onCancel={() => setRenaming(false)}
          className="h-8 w-[220px] rounded-lg border border-[var(--text)] bg-[var(--bg-raised)] px-2.5 text-[15px] font-semibold text-[var(--text)] outline-none"
        />
      ) : (
        <button
          type="button"
          onDoubleClick={() => setRenaming(true)}
          className="min-w-0 truncate text-[var(--text)]"
          title={t('projects.renameFolder')}
        >
          {folder.name}
        </button>
      )}
      <span className="shrink-0 text-[12.5px] font-normal tabular-nums text-[var(--text-faint)]">{count}</span>
      <FolderMenu onRename={() => setRenaming(true)} onMove={onMove} onDelete={onDelete} />
    </h2>
  );
}

/** A name typed in place: Enter or leaving the field keeps it, Escape cancels (and does not close the popover). */
function InlineNameInput({
  initial,
  placeholder,
  onCommit,
  onCancel,
  className,
}: {
  initial: string;
  placeholder?: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [value, setValue] = React.useState(initial);
  const committed = React.useRef(false);
  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    onCommit(value.trim());
  };
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      maxLength={40}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          if (event.nativeEvent.isComposing) return;
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          committed.current = true;
          onCancel();
        }
      }}
      onBlur={commit}
      onFocus={(event) => event.currentTarget.select()}
      onClick={(event) => event.stopPropagation()}
      className={className ?? 'h-8 w-[160px] rounded-lg border border-[var(--text)] bg-[var(--bg-raised)] px-2.5 text-[12.5px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]'}
    />
  );
}

/**
 * Where a project, or a folder of the list, goes: the folders as a tree, as a file browser shows them. "Projects" (no
 * folder) at the top and each folder under the one it is in, opened and closed by its arrow. A click picks a place and
 * a double click (or Move, or Enter) moves it there; the place it is in now is marked and cannot be picked. New folder
 * makes one inside the place picked, named in the tree, and picks it. A folder never offers itself or what is in it
 * (`exclude`).
 */
function FolderPicker({
  title,
  folders,
  current,
  exclude,
  onMove,
  onCreate,
  onClose,
}: {
  title: string;
  folders: ProjectFolder[];
  current: string | null;
  exclude: ReadonlySet<string>;
  onMove: (folderId: string | null) => void;
  onCreate: (name: string, parentId: string | null) => Promise<ProjectFolder | null>;
  onClose: () => void;
}) {
  const t = useT();
  /* null is the project list itself (no folder) */
  const [picked, setPicked] = React.useState<string | null>(current);
  const [shut, setShut] = React.useState<ReadonlySet<string>>(new Set());
  /* a new folder being named, inside this place (undefined: none) */
  const [naming, setNaming] = React.useState<string | null | undefined>(undefined);
  const children = React.useCallback((parent: string | null) => folders
    .filter((f) => parentOf(f, folders) === parent && !exclude.has(f.id))
    .sort((a, b) => a.name.localeCompare(b.name)), [folders, exclude]);
  React.useEffect(() => {
    /* this Escape closes the picker, not the popover under it */
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const canMove = picked !== current;
  const move = (to: string | null) => { if (to !== current) onMove(to); };
  const toggle = (id: string) => setShut((was) => { const next = new Set(was); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const startNew = () => {
    setNaming(picked);
    if (picked) setShut((was) => { const next = new Set(was); next.delete(picked); return next; });
  };
  const named = async (name: string) => {
    const parent = naming ?? null;
    setNaming(undefined);
    if (!name) return;
    const made = await onCreate(name, parent);
    if (made) setPicked(made.id);
  };

  /* a place: its arrow (when it holds folders), its icon, its name, and "Here now" on the place it is in */
  const place = (id: string | null, depth: number, icon: React.ReactNode, label: string): React.ReactNode => {
    const kids = children(id);
    const open = id === null || !shut.has(id);
    const isPicked = picked === id;
    const here = current === id;
    return (
      <React.Fragment key={id ?? 'top'}>
        <div
          role="treeitem"
          aria-selected={isPicked}
          aria-expanded={kids.length ? open : undefined}
          onClick={() => setPicked(id)}
          onDoubleClick={() => move(id)}
          style={{ paddingLeft: 6 + depth * 18 }}
          className={`flex h-8 cursor-default select-none items-center gap-1.5 rounded-md pr-2.5 text-[13px] ${
            isPicked ? 'bg-[var(--accent)] text-[var(--on-accent)]' : 'text-[var(--text)] hover:bg-[var(--bg-hover)]'
          }`}
        >
          {kids.length && id !== null ? (
            <button type="button" aria-label={label} onClick={(event) => { event.stopPropagation(); toggle(id); }}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-70 hover:opacity-100">
              <ChevronRight size={13} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
            </button>
          ) : <span className="w-4 shrink-0" />}
          <span className={`shrink-0 ${isPicked ? '' : 'text-[var(--text-muted)]'}`}>{icon}</span>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {here ? <span className={`shrink-0 text-[11.5px] ${isPicked ? 'opacity-80' : 'text-[var(--text-faint)]'}`}>{t('projects.hereNow')}</span> : null}
        </div>
        {open ? (
          <>
            {naming === id ? (
              <div className="flex h-8 items-center gap-1.5 pr-2.5" style={{ paddingLeft: 6 + (depth + 1) * 18 }}>
                <span className="w-4 shrink-0" />
                <Folder size={15} strokeWidth={1.7} className="shrink-0 text-[var(--text-muted)]" />
                <InlineNameInput
                  initial=""
                  placeholder={t('projects.newFolderName')}
                  onCommit={(name) => void named(name)}
                  onCancel={() => setNaming(undefined)}
                  className="h-6 min-w-0 flex-1 rounded border border-[var(--text)] bg-[var(--bg-raised)] px-1.5 text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
                />
              </div>
            ) : null}
            {kids.map((f) => place(f.id, depth + 1, <Folder size={15} strokeWidth={1.7} />, f.name))}
          </>
        ) : null}
      </React.Fragment>
    );
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal
      aria-label={t('projects.moveToTitle').replace('{name}', title)}
      className="fixed inset-0 z-[10100] flex items-center justify-center bg-black/35 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="flex w-full max-w-[460px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-raised)] shadow-[var(--shadow-lg)]"
        style={{ animation: 'openfilm-pop 0.16s ease-out both' }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && naming === undefined && canMove && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); move(picked); }
        }}
      >
        <div className="flex items-start gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-[var(--text)]">{t('projects.moveToTitle').replace('{name}', title)}</p>
            <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">{t('projects.moveHint')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('confirm.cancel')}
            className="-mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            <X size={15} />
          </button>
        </div>

        <div role="tree" tabIndex={0} className="mx-5 h-[260px] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-1 outline-none">
          {place(null, 0, <LayoutGrid size={15} strokeWidth={1.7} />, t('nav.projects'))}
        </div>

        <div className="flex items-center gap-2 px-5 py-4">
          <button type="button" onClick={startNew}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[12.5px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]">
            <FolderPlus size={14} strokeWidth={1.8} />{t('projects.newFolder')}
          </button>
          <span className="flex-1" />
          <button type="button" onClick={onClose}
            className="h-8 rounded-lg border border-[var(--border)] px-3 text-[12.5px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]">{t('confirm.cancel')}</button>
          <button type="button" disabled={!canMove} onClick={() => move(picked)}
            className="h-8 rounded-lg bg-[var(--primary)] px-4 text-[12.5px] font-medium text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] disabled:opacity-40">{t('projects.move')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The cover, or (none, or it failed to load) a gradient made from the id. While Studio draws it (the first time can
 * take a while) the card shows its plain face with the film mark, not a black frame that reads as a black film. Studio
 * answers at once while it draws a film's first poster (so the card holds none of the browser's few connections to
 * it): the card shows its gradient and asks again a few times.
 */
function PosterMedia({ project, shade = false }: { project: LibraryProject; shade?: boolean }) {
  /* the try asked for now (0: the first) and whether it failed, for this poster */
  const [attempt, setAttempt] = React.useState<{ url: string; n: number; failed: boolean } | null>(null);
  const [loadedUrl, setLoadedUrl] = React.useState<string | null>(null);
  const tried = attempt && attempt.url === project.poster ? attempt : { url: project.poster ?? '', n: 0, failed: false };
  const again = tried.failed ? posterRetryDelay(tried.n) : null;
  React.useEffect(() => {
    if (again == null) return undefined;
    const timer = setTimeout(() => setAttempt({ url: tried.url, n: tried.n + 1, failed: false }), again);
    return () => clearTimeout(timer);
  }, [again, tried.url, tried.n]);
  /* `shade`: darker toward the bottom, under the length badge; only over a picture (on the plain face it is a smudge) */
  const shadow = shade ? <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent opacity-90" /> : null;
  const face = <div className="absolute inset-0 opacity-80" style={{ background: gradientForId(project.id) }} />;
  if (!project.poster || (tried.failed && again == null)) return <>{face}{shadow}</>;
  const src = posterTry(project.poster, tried.n);
  const ready = loadedUrl === src;
  return (
    <>
      {ready ? null : tried.n > 0 || tried.failed ? face : (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center text-[var(--text-faint)]">
          <Video size={22} strokeWidth={1.5} />
        </span>
      )}
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onLoad={() => setLoadedUrl(src)}
        onError={() => setAttempt({ url: tried.url, n: tried.n, failed: true })}
        className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-200 ${ready ? 'opacity-100' : 'opacity-0'}`}
      />
      {ready ? shadow : null}
    </>
  );
}

const SORT_OPTIONS: ReadonlyArray<{ id: LibrarySort; labelKey: string }> = [
  { id: 'recent', labelKey: 'library.sortRecent' },
  { id: 'newest', labelKey: 'library.sortNewest' },
  { id: 'oldest', labelKey: 'library.sortOldest' },
  { id: 'duration', labelKey: 'library.sortDuration' },
  { id: 'title', labelKey: 'library.sortTitle' },
];

/** The sort button: a small card of options, one ticked. */
function SortButton({
  sort,
  onSort,
}: {
  sort: LibrarySort;
  onSort: (next: LibrarySort) => void;
}) {
  const t = useT();
  const [anchor, setAnchor] = React.useState<{ left: number; top: number } | null>(null);
  const toggle = (event: React.MouseEvent) => {
    event.stopPropagation();
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setAnchor((current) => (current ? null : { left: box.left, top: box.bottom + 6 }));
  };
  React.useEffect(() => {
    if (!anchor) return;
    const close = () => setAnchor(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      /* this Escape closes the menu, not the popover under it */
      event.stopImmediatePropagation();
      setAnchor(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
    };
  }, [anchor]);
  const row = (selected: boolean) =>
    `flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition hover:bg-[var(--bg-hover)] ${
      selected ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'
    }`;

  return (
    <>
      <Tooltip label={t('library.sortLabel')}>
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="dialog"
          aria-expanded={anchor != null}
          aria-label={t('library.sortLabel')}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] transition ${
            anchor != null
              ? 'bg-[var(--bg-pressed)] text-[var(--text)]'
              : 'bg-[var(--bg-raised)] text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
        >
          <SlidersHorizontal size={14} />
        </button>
      </Tooltip>
      {anchor
        ? createPortal(
          <div
            role="dialog"
            className="fixed z-[10060] w-[200px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] pb-1.5 shadow-[var(--shadow-lg)]"
            style={{ left: anchor.left, top: anchor.top, animation: 'openfilm-rise 0.14s ease-out both' }}
            onClick={(event) => event.stopPropagation()}
          >
            <p className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--text-faint)]">{t('library.sortLabel')}</p>
            {SORT_OPTIONS.map((option) => (
              <button key={option.id} type="button" onClick={() => onSort(option.id)} className={row(option.id === sort)}>
                <Check size={14} className={option.id === sort ? 'text-[var(--text)]' : 'text-transparent'} />
                {t(option.labelKey)}
              </button>
            ))}
          </div>,
          document.body,
        )
        : null}
    </>
  );
}

function ViewButton({
  active,
  label,
  onClick,
  icon,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={`flex h-6 w-8 items-center justify-center rounded-[5px] transition ${
          active
            ? 'bg-[var(--bg-pressed)] text-[var(--text)]'
            : 'text-[var(--text-faint)] hover:text-[var(--text)]'
        }`}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

function titleOf(project: LibraryProject, t: (key: string) => string): string {
  return project.name.trim() || t('project.untitled');
}

/**
 * A card without a cover gets a gradient made from its id, not a random one: people recognize a card by "the blue
 * one at the top left", so it must be the same color every time.
 */
function gradientForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const next = (hue + 48 + (hash % 42)) % 360;
  return `linear-gradient(135deg, hsl(${hue} 58% 34%), hsl(${next} 62% 20%))`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** A day in the UI's language: "Oct 7, 2026", "2026年10月7日". */
function formatDate(ms: number, language: Language): string {
  try {
    return new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(ms));
  } catch {
    return '';
  }
}
