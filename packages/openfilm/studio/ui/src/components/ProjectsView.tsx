/**
 * The contents of the Projects popover (see ProjectsLibrary): a compact header (title, search, sort, view, new folder,
 * close), the folders and the projects as cards or a list, with "New project" as the first cell (and, under it, "Open
 * folder…" and "Get from GitHub…": an existing film), then the examples. Inside a folder a breadcrumb leads back to
 * all. Data and actions come from the popover.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clock3,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Github,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import type { Example } from '@/lib/project-sources';
import { ExamplesSection } from './ProjectSources';
import { useLanguage, useT, type Language } from '@/i18n';
import { limitTitleWidth, TITLE_MAX_WIDTH } from '@/lib/title';
import type { Project } from '@/api';
import { folderCounts, folderPosters, visibleProjects, type LibrarySort, type ProjectFolder } from '@/lib/project-folders';
import { ContextMenu } from './ContextMenu';
import { ProjectMenu } from './ProjectMenu';
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
  onDelete,
  folders,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveToFolder,
  onClose,
}: {
  projects: LibraryProject[];
  /** A project is being created or opened; "New project" does not take a second click meanwhile. */
  creating?: boolean;
  onNewProject: () => void;
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
  /** Ask to delete these projects (the popover confirms first). */
  onDelete: (projectIds: string[]) => void;
  /** The list's folders. */
  folders: ProjectFolder[];
  /** Make a folder; resolves to it (null: it could not be made). */
  onCreateFolder: (name: string) => Promise<ProjectFolder | null>;
  /** A new name for a folder. Never empty. */
  onRenameFolder: (folderId: string, name: string) => void;
  /** Ask to delete a folder and the projects in it (the popover confirms first). */
  onDeleteFolder: (folder: ProjectFolder) => void;
  /** Put a project in a folder, or (null) in none. */
  onMoveToFolder: (projectId: string, folderId: string | null) => void;
  /** Missing: no close button (Studio has no project to go back to). */
  onClose?: () => void;
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
  const [moving, setMoving] = React.useState<LibraryProject | null>(null);
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
  const showFolders = folderId === null && !query.trim();
  const currentFolder = folders.find((f) => f.id === folderId) ?? null;
  const counts = React.useMemo(() => folderCounts(projects), [projects]);
  const posters = React.useMemo(() => folderPosters(projects), [projects]);

  async function newFolder() {
    const created = await onCreateFolder(t('projects.untitledFolder'));
    if (created) setRenamingFolderId(created.id);
  }

  function folderProps(folder: ProjectFolder): FolderItemProps {
    return {
      folder,
      count: counts[folder.id] ?? 0,
      posters: posters[folder.id] ?? [],
      renaming: renamingFolderId === folder.id,
      onOpen: () => setFolderId(folder.id),
      onStartRename: () => setRenamingFolderId(folder.id),
      onCommitRename: (name: string) => {
        setRenamingFolderId(null);
        if (name && name !== folder.name) onRenameFolder(folder.id, name);
      },
      onCancelRename: () => setRenamingFolderId(null),
      onDelete: () => onDeleteFolder(folder),
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
      onOpen: () => onOpen(project),
      onStartRename: () => { if (!selecting) setRenamingId(project.id); },
      onCommitRename: (name: string) => {
        setRenamingId((current) => (current === project.id ? null : current));
        /* empty or unchanged: nothing to do (a project is its folder, and a folder needs a name) */
        if (!name || name === project.name.trim()) return;
        onRename(project.id, name);
      },
      onCancelRename: () => setRenamingId((current) => (current === project.id ? null : current)),
      onStartSelect: () => startSelecting(project),
      onMoveToFolder: () => setMoving(project),
      onLocate: () => onLocate(project),
      onDelete: () => onDelete([project.id]),
    };
  }

  const showNew = folderId === null && !query.trim();

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* the header stays out of the scroll area: inside it, the list view's scrollbar would narrow the header */}
      <header className="flex shrink-0 flex-col gap-3 px-6 pb-4 pt-5">
        <div className="flex items-center gap-2">
          <h2 className="mr-auto text-[17px] font-semibold tracking-[-0.01em] text-[var(--text)]">{t('nav.projects')}</h2>
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
                  className="h-8 w-full rounded-lg bg-[var(--surface-2)] pl-8 pr-3 text-[12.5px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:ring-1 focus:ring-[var(--border-strong)]"
                />
              </label>
              <SortButton sort={sort} onSort={setSort} />
              <div className="flex h-8 shrink-0 items-center gap-0.5 rounded-lg bg-[var(--surface-2)] px-[3px]" aria-label={t('library.viewLabel')}>
                <ViewButton active={view === 'cards'} label={t('library.viewCards')} onClick={() => setView('cards')} icon={<LayoutGrid size={14} />} />
                <ViewButton active={view === 'list'} label={t('library.viewList')} onClick={() => setView('list')} icon={<List size={14} />} />
              </div>
              {folderId === null ? (
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
              ) : null}
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
        {currentFolder ? (
          <FolderCrumb
            folder={currentFolder}
            count={counts[currentFolder.id] ?? 0}
            onBack={() => setFolderId(null)}
            onRename={(name) => onRenameFolder(currentFolder.id, name)}
            onDelete={() => onDeleteFolder(currentFolder)}
          />
        ) : null}
      </header>

      {/* the one scroll area; the scrollbar gutter is reserved so cards keep their width either way */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]">
        <div className="w-full flex-1 px-6 pb-6">
          {visible.length === 0 && !showNew && !(showFolders && folders.length > 0) ? (
            <div className="flex min-h-[42vh] items-center justify-center text-[14px] text-[var(--text-muted)]">
              {folderId && !query.trim() ? t('projects.folderEmpty') : t('library.noMatches')}
            </div>
          ) : view === 'cards' ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
              {showNew ? <NewProjectCard creating={creating} onNewProject={onNewProject} onOpenFolder={onOpenFolder} onGetFromGitHub={onGetFromGitHub} /> : null}
              {showFolders ? folders.map((folder) => <FolderCard key={`folder:${folder.id}`} {...folderProps(folder)} />) : null}
              {visible.map((project) => <ProjectCard key={project.id} {...itemProps(project)} />)}
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-[var(--border)]">
              {showNew ? <NewProjectListRow creating={creating} onNewProject={onNewProject} onOpenFolder={onOpenFolder} onGetFromGitHub={onGetFromGitHub} /> : null}
              {showFolders ? folders.map((folder) => <FolderListRow key={`folder:${folder.id}`} {...folderProps(folder)} />) : null}
              {visible.map((project) => <ProjectListRow key={project.id} {...itemProps(project)} />)}
            </div>
          )}
          {showNew && onOpenExample ? (
            <ExamplesSection examples={examples} collapsed={examplesCollapsed} onToggle={() => onToggleExamples?.()} onOpen={onOpenExample} />
          ) : null}
        </div>

        {selecting ? (
          <div className="pointer-events-none sticky bottom-0 z-20 flex justify-center pb-5">
            <div
              className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-4 pr-1.5 shadow-[var(--shadow-lg)]"
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
          title={titleOf(moving, t)}
          folders={folders}
          counts={counts}
          current={moving.folderId && folders.some((f) => f.id === moving.folderId) ? moving.folderId : null}
          onPick={(fid) => {
            onMoveToFolder(moving.id, fid);
            setMoving(null);
          }}
          onCreate={async (name) => {
            const created = await onCreateFolder(name);
            if (created) onMoveToFolder(moving.id, created.id);
            setMoving(null);
          }}
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
  onOpen: () => void;
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
  onOpen: () => void;
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
  onOpenFolder: () => void;
  onGetFromGitHub: () => void;
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
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text)] transition group-hover:scale-105">
          <Plus size={18} strokeWidth={2.2} />
        </span>
        <span className="text-[13px] font-medium">{t('projects.newProject')}</span>
      </button>
      {/* where the other cards have their name: starting from a film that exists */}
      <div className="mt-2 flex">
        <ImportMenu creating={creating} onOpenFolder={onOpenFolder} onGetFromGitHub={onGetFromGitHub} className="-ml-1.5 h-7 px-1.5 text-[12.5px]" />
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
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text)] transition group-hover:scale-105">
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
      <ImportMenu creating={creating} onOpenFolder={onOpenFolder} onGetFromGitHub={onGetFromGitHub} className="h-8 px-2.5 text-[12.5px]" />
    </article>
  );
}

/** "Import from ⌄": the ways to start from a film that exists, a folder on this computer or a repository on GitHub. */
function ImportMenu({ creating, onOpenFolder, onGetFromGitHub, className }: Omit<NewProjectProps, 'onNewProject'> & { className: string }) {
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
          className={`relative block aspect-video w-full overflow-hidden rounded-lg bg-[var(--surface-2)] text-left ring-1 transition duration-200 hover:brightness-[1.04] ${
            selected ? 'ring-2 ring-[var(--accent)]' : 'ring-[var(--border)]'
          }`}
          aria-label={title}
          aria-pressed={selecting ? selected : undefined}
        >
          <PosterMedia project={project} shade />
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
        {project.missing && !selecting ? <MissingActions onLocate={onLocate} onRemove={onDelete} /> : null}
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
            {project.missing ? <span className="truncate text-[var(--err)]">· {t('projects.missing')}</span> : null}
            {project.working ? <span className="truncate text-[var(--accent)]">· {t('projects.agentRunning')}</span> : null}
          </button>
        </div>
        {!selecting ? <ItemMenu project={project} onOpen={onOpen} onStartRename={onStartRename} onStartSelect={onStartSelect} onMoveToFolder={onMoveToFolder} onLocate={onLocate} onDelete={onDelete} size={14} /> : null}
      </div>
    </article>
  );
}

/**
 * On the cover of a project whose folder is gone: "Folder not found", and the two things to do about it: point it at
 * the folder it is in now (it keeps its place, and its history goes with the folder), or take it off the list.
 */
function MissingActions({ onLocate, onRemove, compact = false }: { onLocate: () => void; onRemove: () => void; compact?: boolean }) {
  const t = useT();
  const button = 'inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition';
  return (
    <div className={compact ? 'flex items-center gap-1' : 'pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-2'}>
      {compact ? null : <span className="text-[12px] font-semibold text-white drop-shadow">{t('projects.missing')}</span>}
      <div className="pointer-events-auto flex items-center gap-1.5">
        <button type="button" onClick={onLocate} className={`${button} bg-[var(--surface)] text-[var(--text)] shadow hover:brightness-95`}>
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

/** A card's or row's "…". A project whose folder is gone can be located or leave the list: there is nothing to open or rename. */
function ItemMenu({
  project,
  onOpen,
  onStartRename,
  onStartSelect,
  onMoveToFolder,
  onLocate,
  onDelete,
  size,
}: Pick<ItemProps, 'project' | 'onOpen' | 'onStartRename' | 'onStartSelect' | 'onMoveToFolder' | 'onLocate' | 'onDelete'> & { size: number }) {
  if (project.missing) return <ProjectMenu onLocate={onLocate} onRemove={onDelete} size={size} />;
  return (
    <ProjectMenu
      onOpen={onOpen}
      onRename={onStartRename}
      onSelect={onStartSelect}
      onMoveToFolder={onMoveToFolder}
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
          className={`relative block aspect-video w-28 overflow-hidden rounded-md bg-[var(--surface-2)] ring-1 sm:w-36 ${
            selected ? 'ring-2 ring-[var(--accent)]' : 'ring-[var(--border)]'
          }`}
          aria-label={title}
        >
          <PosterMedia project={project} />
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
            {project.missing ? <span className="text-[var(--err)]">· {t('projects.missing')}</span> : null}
            {project.working ? <span className="text-[var(--accent)]">· {t('projects.agentRunning')}</span> : null}
          </p>
        </button>
      </div>
      {project.missing && !selecting ? <MissingActions compact onLocate={onLocate} onRemove={onDelete} /> : null}
      {!selecting ? <ItemMenu project={project} onOpen={onOpen} onStartRename={onStartRename} onStartSelect={onStartSelect} onMoveToFolder={onMoveToFolder} onLocate={onLocate} onDelete={onDelete} size={15} /> : null}
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
  onOpen: () => void;
  onStartRename: () => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
  onDelete: () => void;
}

/**
 * A folder card: the project card's frame (a 16:9 face and a name under it), its face the covers of its newest
 * projects, so what it holds shows at a glance; an empty one shows the folder picture. Double-click the name to rename.
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
}: FolderItemProps) {
  const t = useT();
  const language = useLanguage();
  return (
    <article className="group min-w-0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={folder.name}
        className="relative block aspect-video w-full overflow-hidden rounded-lg bg-[var(--surface-2)] text-left ring-1 ring-[var(--border)] transition duration-200 hover:bg-[var(--surface-3)] hover:ring-[var(--border-strong)]"
      >
        {posters.length > 0 ? (
          /* as many cells as covers (one fills the face, three put the first beside the other two): no blank cells */
          <div className={`absolute inset-3 grid gap-1.5 ${posters.length === 1 ? 'grid-cols-1' : posters.length === 2 ? 'grid-cols-2' : 'grid-cols-2 grid-rows-2'}`}>
            {posters.slice(0, 4).map((cover, i) => (
              <div key={cover.id} className={`relative overflow-hidden rounded-[5px] bg-[var(--surface-3)] ${posters.length === 3 && i === 0 ? 'row-span-2' : ''}`}>
                <MiniPoster id={cover.id} url={cover.poster} />
              </div>
            ))}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <FolderGlyph className="w-[34%] transition-transform duration-200 group-hover:-translate-y-0.5" />
          </div>
        )}
        {/* the count: dark glass over covers; on the plain face a dark patch is too heavy, so the face's own style */}
        <span
          className={`absolute bottom-2 right-2 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums ${
            posters.length > 0
              ? 'bg-black/45 text-white/90 backdrop-blur-sm'
              : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]'
          }`}
        >
          {count}
        </span>
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
              className="h-6 w-full rounded-md border border-[var(--text)] bg-[var(--surface)] px-1.5 text-[13px] font-semibold text-[var(--text)] outline-none"
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
        <FolderMenu onRename={onStartRename} onDelete={onDelete} />
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
  renaming,
  onOpen,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
}: FolderItemProps) {
  const t = useT();
  const language = useLanguage();
  return (
    <div className="group flex min-w-0 items-center gap-3 py-4 sm:gap-4">
      <button
        type="button"
        onClick={onOpen}
        className="relative block aspect-video w-28 shrink-0 overflow-hidden rounded-md bg-[var(--surface-2)] ring-1 ring-[var(--border)] transition hover:bg-[var(--surface-3)] sm:w-36"
        aria-label={folder.name}
      >
        <span className="absolute inset-0 flex items-center justify-center">
          <FolderGlyph className="w-[34%]" />
        </span>
      </button>
      <div className="min-w-0 flex-1">
        {renaming ? (
          <InlineNameInput
            initial={folder.name}
            onCommit={onCommitRename}
            onCancel={onCancelRename}
            className="h-7 w-[240px] rounded-md border border-[var(--text)] bg-[var(--surface)] px-2 text-[14px] font-semibold text-[var(--text)] outline-none"
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
      <FolderMenu onRename={onStartRename} onDelete={onDelete} />
    </div>
  );
}

/** A folder's "…": rename, delete. The project card's menu, in looks and placement (see ProjectMenu). */
function FolderMenu({ onRename, onDelete }: { onRename: () => void; onDelete: () => void }) {
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
        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
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
            { id: 'sep', separator: true },
            { id: 'delete', icon: <Trash2 size={14} />, label: t('projects.deleteFolder'), danger: true, onSelect: onDelete },
          ]}
        />
      ) : null}
    </>
  );
}

/** Inside a folder: "← All / folder name  count  …". Double-click the name to rename. */
function FolderCrumb({
  folder,
  count,
  onBack,
  onRename,
  onDelete,
}: {
  folder: ProjectFolder;
  count: number;
  onBack: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [renaming, setRenaming] = React.useState(false);
  return (
    <div className="mt-5 flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
      >
        <ArrowLeft size={14} />
        {t('projects.folderAll')}
      </button>
      <span className="text-[var(--text-faint)]">/</span>
      <Folder size={15} strokeWidth={1.9} className="text-[var(--text-faint)]" />
      {renaming ? (
        <InlineNameInput
          initial={folder.name}
          onCommit={(name) => {
            setRenaming(false);
            if (name && name !== folder.name) onRename(name);
          }}
          onCancel={() => setRenaming(false)}
          className="h-8 w-[240px] rounded-lg border border-[var(--text)] bg-[var(--surface)] px-2.5 text-[14px] font-semibold text-[var(--text)] outline-none"
        />
      ) : (
        <button
          type="button"
          onDoubleClick={() => setRenaming(true)}
          className="truncate text-[14px] font-semibold text-[var(--text)]"
          title={t('projects.renameFolder')}
        >
          {folder.name}
        </button>
      )}
      <span className="text-[12.5px] tabular-nums text-[var(--text-faint)]">{count}</span>
      <FolderMenu onRename={() => setRenaming(true)} onDelete={onDelete} />
    </div>
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
      className={className ?? 'h-8 w-[160px] rounded-lg border border-[var(--text)] bg-[var(--surface)] px-2.5 text-[12.5px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]'}
    />
  );
}

/**
 * Pick a folder for a project: a small centered card, "Move to folder" and the project's name on top, then the places
 * it can go (each a tinted folder tile, the name and how many it holds; the current one ticked), "No folder" first and
 * a new folder last (named, then the project goes straight in). A pick moves it and closes.
 */
function FolderPicker({
  title,
  folders,
  counts,
  current,
  onPick,
  onCreate,
  onClose,
}: {
  title: string;
  folders: ProjectFolder[];
  counts: Record<string, number>;
  current: string | null;
  onPick: (folderId: string | null) => void;
  onCreate: (name: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [creating, setCreating] = React.useState(false);
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

  const row = (selected: boolean) =>
    `group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${
      selected ? 'bg-[var(--bg-active)]' : 'hover:bg-[var(--bg-hover)]'
    }`;
  const tile = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg';

  return createPortal(
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-[10100] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-[360px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]"
        style={{ animation: 'openfilm-pop 0.16s ease-out both' }}
      >
        <div className="flex items-start gap-3 px-5 pb-3 pt-5">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-[var(--text)]">{t('projects.moveToFolder')}</p>
            <p className="mt-0.5 truncate text-[12.5px] text-[var(--text-muted)]">{title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('confirm.cancel')}
            className="-mr-1.5 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            <X size={15} />
          </button>
        </div>

        <div className="max-h-[52vh] overflow-y-auto px-2.5 pb-1">
          <button type="button" onClick={() => onPick(null)} className={row(current === null)}>
            <span className={`${tile} border border-dashed border-[var(--border-strong)] text-[var(--text-faint)]`}>
              <FolderOpen size={16} strokeWidth={1.7} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--text)]">{t('projects.noFolder')}</span>
            {current === null ? <Check size={15} className="shrink-0 text-[var(--text)]" /> : null}
          </button>
          {folders.map((folder) => (
            <button key={folder.id} type="button" onClick={() => onPick(folder.id)} className={row(current === folder.id)}>
              <span className={`${tile} bg-[var(--surface-3)] text-[var(--text-dim)]`}>
                <Folder size={16} strokeWidth={1.7} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] text-[var(--text)]">{folder.name}</span>
                <span className="block text-[11.5px] tabular-nums text-[var(--text-faint)]">
                  {counts[folder.id] ?? 0}
                </span>
              </span>
              {current === folder.id ? <Check size={15} className="shrink-0 text-[var(--text)]" /> : null}
            </button>
          ))}
        </div>

        <div className="border-t border-[var(--border-soft)] p-2.5">
          {creating ? (
            <div className="flex items-center gap-3 px-2.5 py-1.5">
              <span className={`${tile} bg-[var(--brand-wind-from)]/15 text-[var(--brand-wind-from)]`}>
                <FolderPlus size={16} strokeWidth={1.7} />
              </span>
              <InlineNameInput
                initial=""
                placeholder={t('projects.folderNamePlaceholder')}
                onCommit={(name) => {
                  setCreating(false);
                  if (name) void onCreate(name);
                }}
                onCancel={() => setCreating(false)}
                className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--text)] bg-[var(--surface)] px-2.5 text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-[var(--bg-hover)]"
            >
              <span className={`${tile} bg-[var(--brand-wind-from)]/15 text-[var(--brand-wind-from)]`}>
                <FolderPlus size={16} strokeWidth={1.7} />
              </span>
              <span className="text-[13.5px] text-[var(--text)]">{t('projects.newFolder')}</span>
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The cover, or (none, or it failed to load) a gradient made from the id. While Studio draws it (the first time can
 * take a while) the card shows its plain face with the film mark, not a black frame that reads as a black film.
 */
function PosterMedia({ project, shade = false }: { project: LibraryProject; shade?: boolean }) {
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = React.useState<string | null>(null);
  /* `shade`: darker toward the bottom, under the length badge; only over a picture (on the plain face it is a smudge) */
  const shadow = shade ? <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent opacity-90" /> : null;
  if (!project.poster || failedUrl === project.poster) {
    return <><div className="absolute inset-0 opacity-80" style={{ background: gradientForId(project.id) }} />{shadow}</>;
  }
  const ready = loadedUrl === project.poster;
  return (
    <>
      {ready ? null : (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center text-[var(--text-faint)]">
          <Video size={22} strokeWidth={1.5} />
        </span>
      )}
      <img
        src={project.poster}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onLoad={() => setLoadedUrl(project.poster ?? null)}
        onError={() => setFailedUrl(project.poster ?? null)}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${ready ? 'opacity-100' : 'opacity-0'}`}
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
      selected ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'
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
              ? 'bg-[var(--bg-active)] text-[var(--text)]'
              : 'bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
        >
          <SlidersHorizontal size={14} />
        </button>
      </Tooltip>
      {anchor
        ? createPortal(
          <div
            role="dialog"
            className="fixed z-[10060] w-[200px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] pb-1.5 shadow-[var(--shadow-lg)]"
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
            ? 'bg-[var(--surface-3)] text-[var(--text)]'
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
