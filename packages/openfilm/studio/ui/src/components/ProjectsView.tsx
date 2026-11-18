/** Project browser: sidebar folders, history, path, and direct file selection. */
import React from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  ArrowRight,
  ClipboardPaste,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Github,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Plus,
  Scissors,
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
import { api, type Project } from '@/api';
import {
  folderCounts,
  folderTrail,
  listStarts,
  parentOf,
  visibleProjects,
  type LibrarySort,
  type ProjectFolder,
} from '@/lib/project-folders';
import { posterRetryDelay, posterTry } from '@/lib/projects-page';
import { ContextMenu } from './ContextMenu';
import { projectMenuItems } from './ProjectMenu';
import type { ContextMenuEntry } from './ContextMenu';
import { browserSelectionRoots, selectBrowserItems } from '@/lib/project-browser';
import styles from './ProjectsView.module.css';
import { ProjectCoverContext } from './ProjectCover';
import { Tooltip } from './Tooltip';
import { FileViewControl } from './FileViewControl';
import { RESOURCE_TILE_SIZE, type ResourceView } from '@/lib/resource-center';

/**
 * A project as the popover lists it: `poster` (an image URL; a gradient when it fails), `duration` (seconds, when
 * Studio knows the film's length), `createdAt` (when its folder was made) and `folderId` (its folder in the list).
 */
export type LibraryProject = Project & { poster?: string; duration?: number; createdAt?: number; folderId?: string };

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
  onDeleteItems,
  folders,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveToFolder,
  onMoveFolder,
  shown = true,
  display,
  onDisplay,
  navigation, onBin,
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
  onDeleteItems: (projectIds: string[], folderIds: string[]) => void;
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
  /** false: another place of the window is shown (the examples, the library), and the projects wait as they were */
  shown?: boolean;
  display: ResourceView;
  onDisplay: (view: ResourceView) => void;
  navigation: { folderId: string | null; seq: number };
  /** Open OpenFilm's recycle bin (the button at the end of the projects' tools). */
  onBin?: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  const cover = React.useContext(ProjectCoverContext);
  const [sort, setSort] = React.useState<LibrarySort>(() =>
    readPreference('sort', 'recent', ['recent', 'newest', 'oldest', 'duration', 'title']),
  );
  const [reversed, setReversed] = React.useState(
    () => readPreference('reversed', 'false', ['true', 'false']) === 'true',
  );
  const view = display === 'list' ? 'list' : 'cards';
  const [query, setQuery] = React.useState('');
  const [location, setLocation] = React.useState<{ entries: (string | null)[]; index: number }>({
    entries: [null],
    index: 0,
  });
  const folderId = location.entries[location.index] ?? null;
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [cut, setCut] = React.useState<string[]>([]);
  const anchor = React.useRef<string | null>(null);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [moving, setMoving] = React.useState<string[] | null>(null);
  const [context, setContext] = React.useState<{ x: number; y: number; keys: string[] } | null>(null);
  const surface = React.useRef<HTMLDivElement>(null);
  const search = React.useRef<HTMLInputElement>(null);
  const dragging = React.useRef<string[]>([]);
  const [dropTarget, setDropTarget] = React.useState<string | null | undefined>(undefined);
  const [marquee, setMarquee] = React.useState<{ left: number; top: number; width: number; height: number } | null>(
    null,
  );
  const boxStart = React.useRef<{ x: number; y: number; selected: Set<string> } | null>(null);
  const typed = React.useRef({ text: '', at: 0 });

  React.useEffect(() => {
    surface.current?.focus({ preventScroll: true });
  }, []);

  React.useEffect(() => {
    try {
      localStorage.setItem('openfilm.projects.view', view);
      localStorage.setItem('openfilm.projects.sort', sort);
      localStorage.setItem('openfilm.projects.reversed', String(reversed));
    } catch {
      /* private browser */
    }
  }, [view, sort, reversed]);
  const sortColumn = (next: LibrarySort) => {
    setReversed(next === sort ? !reversed : false);
    setSort(next);
  };
  React.useEffect(() => {
    surface.current?.scrollTo(0, 0);
  }, [folderId, query]);
  /* back from another place: the keys work on the projects again */
  React.useEffect(() => {
    if (shown && !(document.activeElement as HTMLElement | null)?.closest('nav')) surface.current?.focus({ preventScroll: true });
  }, [shown]);
  const navigate = (id: string | null) => {
    if (id !== folderId)
      setLocation((was) => ({ entries: [...was.entries.slice(0, was.index + 1), id], index: was.index + 1 }));
    setQuery('');
    setSelected(new Set());
    setRenaming(null);
    anchor.current = null;
    surface.current?.focus({ preventScroll: true });
  };
  React.useEffect(() => {
    navigate(navigation.folderId);
  }, [navigation]);
  const history = (step: number) => {
    setLocation((was) => ({ ...was, index: Math.max(0, Math.min(was.entries.length - 1, was.index + step)) }));
    setQuery('');
    setSelected(new Set());
    setRenaming(null);
    anchor.current = null;
    surface.current?.focus({ preventScroll: true });
  };
  React.useEffect(() => {
    if (folderId && !folders.some((f) => f.id === folderId)) {
      setLocation((was) => ({ ...was, entries: was.entries.map((id) => (id === folderId ? null : id)) }));
      setSelected(new Set());
    }
  }, [folderId, folders]);
  const trail = folderTrail(folders, folderId);
  const counts = folderCounts(projects, folders);
  const visible = React.useMemo(
    () => visibleProjects(projects, { query, folderId, sort, folders, titleOf: (p) => titleOf(p, t) }),
    [projects, query, folderId, sort, folders, t],
  );
  const entries = React.useMemo<BrowserEntry[]>(() => {
    const needle = query.trim().toLocaleLowerCase();
    const listedFolders = folders
      .filter((f) => (needle ? f.name.toLocaleLowerCase().includes(needle) : parentOf(f, folders) === folderId))
      .sort((a, b) =>
        sort === 'newest'
          ? b.createdAt - a.createdAt
          : sort === 'oldest'
          ? a.createdAt - b.createdAt
          : a.name.localeCompare(b.name, language, { numeric: true }),
      );
    return [
      ...(reversed ? listedFolders.reverse() : listedFolders).map((folder) => ({
        key: `folder:${folder.id}`,
        name: folder.name,
        folder,
      })),
      ...(reversed ? [...visible].reverse() : visible).map((project) => ({
        key: `project:${project.id}`,
        name: titleOf(project, t),
        project,
      })),
    ];
  }, [folders, folderId, query, sort, reversed, language, visible, t]);
  const keys = entries.map((entry) => entry.key);
  const order = keys.join('\n');
  React.useEffect(() => {
    const alive = new Set(keys);
    setSelected((was) =>
      [...was].some((key) => !alive.has(key)) ? new Set([...was].filter((key) => alive.has(key))) : was,
    );
    if (anchor.current && !alive.has(anchor.current)) anchor.current = null;
  }, [order]); // selection follows the visible location, not a hidden search result

  const roots = (picked: string[]) => browserSelectionRoots(picked, folders, projects);
  const excluded = (picked: string[]) =>
    new Set(
      folders
        .filter((f) => folderTrail(folders, f.id).some((up) => picked.includes(`folder:${up.id}`)))
        .map((f) => f.id),
    );
  const openEntry = (entry: BrowserEntry) => {
    if ('folder' in entry) navigate(entry.folder.id);
    else onOpen(entry.project);
  };
  const rename = (entry: BrowserEntry) => {
    if ('project' in entry && entry.project.missing) return;
    setRenaming(entry.key);
  };
  const remove = (picked: string[]) => {
    const items = roots(picked);
    const projectIds = items.filter((k) => k.startsWith('project:')).map((k) => k.slice(8));
    const folderIds = items.filter((k) => k.startsWith('folder:')).map((k) => k.slice(7));
    if (!folderIds.length) {
      if (projectIds.length) onDelete(projectIds);
    } else if (folderIds.length === 1 && !projectIds.length) {
      const folder = folders.find((f) => f.id === folderIds[0]);
      if (folder) onDeleteFolder(folder);
    } else onDeleteItems(projectIds, folderIds);
  };
  const move = (picked: string[], destination: string | null) => {
    if (destination && excluded(picked).has(destination)) return;
    for (const key of roots(picked)) {
      if (key.startsWith('folder:')) {
        const folder = folders.find((f) => f.id === key.slice(7));
        if (folder && parentOf(folder, folders) !== destination) onMoveFolder(folder.id, destination);
      } else {
        const project = projects.find((p) => p.id === key.slice(8));
        if (project && (project.folderId ?? null) !== destination) onMoveToFolder(project.id, destination);
      }
    }
    setSelected(new Set());
    setCut([]);
  };
  async function newFolder() {
    setQuery('');
    const folder = await onCreateFolder(t('projects.untitledFolder'), folderId);
    if (folder) {
      const key = `folder:${folder.id}`;
      setSelected(new Set([key]));
      setRenaming(key);
      anchor.current = key;
    }
  }
  const choose = (entry: BrowserEntry, event: React.MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button,input')) return;
    setSelected((was) => selectBrowserItems(keys, was, entry.key, anchor.current, event));
    if (!event.shiftKey) anchor.current = entry.key;
    event.currentTarget.focus({ preventScroll: true });
  };
  const dropProps = (destination: string | null) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(BROWSER_DRAG)) return;
      event.preventDefault();
      event.stopPropagation();
      const allowed = !destination || !excluded(dragging.current).has(destination);
      event.dataTransfer.dropEffect = allowed ? 'move' : 'none';
      setDropTarget(allowed ? destination : undefined);
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(undefined);
    },
    onDrop: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(BROWSER_DRAG)) return;
      event.preventDefault();
      event.stopPropagation();
      // Only this browser's current drag may rearrange its library.
      if (dragging.current.length) move(dragging.current, destination);
      dragging.current = [];
      setDropTarget(undefined);
    },
  });
  const selectionActions = (picked: string[]): ContextMenuEntry[] => {
    const single = entries.find((e) => e.key === picked[0]);
    if (picked.length === 1 && single) {
      if ('project' in single) {
        const project = single.project;
        return projectMenuItems(
          t,
          project.missing
            ? { onLocate: () => onLocate(project), onRemove: () => remove(picked) }
            : {
                onOpen: () => onOpen(project),
                onRename: () => rename(single),
                onDuplicate: () => onDuplicate(project),
                onCut: () => setCut(picked),
                onMoveToFolder: () => setMoving(picked),
                onChangeCover: cover ? () => cover.change(project) : undefined,
                onRestoreCover: cover && project.cover ? () => cover.restore(project) : undefined,
                onReveal: () => void api.revealProject(project.id).catch(() => {}),
                onDelete: () => remove(picked),
              },
        );
      }
      return [
        { id: 'open', icon: <FolderOpen size={14} />, label: t('projectMenu.open'), onSelect: () => openEntry(single) },
        {
          id: 'rename',
          icon: <Pencil size={14} />,
          label: t('projectMenu.rename'),
          shortcut: 'F2',
          onSelect: () => rename(single),
        },
        { id: 'cut', icon: <Scissors size={14} />, label: t('projectBrowser.cut'), onSelect: () => setCut(picked) },
        { id: 'move', icon: <FolderInput size={14} />, label: t('projects.moveTo'), onSelect: () => setMoving(picked) },
        { id: 'sep', separator: true },
        {
          id: 'delete',
          icon: <Trash2 size={14} />,
          label: t('projectMenu.delete'),
          danger: true,
          onSelect: () => remove(picked),
        },
      ];
    }
    return [
      { id: 'cut', icon: <Scissors size={14} />, label: t('projectBrowser.cut'), onSelect: () => setCut(picked) },
      { id: 'move', icon: <FolderInput size={14} />, label: t('projects.moveTo'), onSelect: () => setMoving(picked) },
      {
        id: 'delete',
        icon: <Trash2 size={14} />,
        label: t('library.deleteSelected'),
        danger: true,
        onSelect: () => remove(picked),
      },
    ];
  };
  const backgroundActions: ContextMenuEntry[] = [
    {
      id: 'new',
      icon: <Plus size={14} />,
      label: t('projects.newProject'),
      disabled: creating,
      onSelect: () => onNewProject(folderId),
    },
    { id: 'folder', icon: <FolderPlus size={14} />, label: t('projects.newFolder'), onSelect: () => void newFolder() },
    { id: 'import', icon: <FolderOpen size={14} />, label: t('projects.openFolder'), onSelect: onOpenFolder },
    { id: 'github', icon: <Github size={14} />, label: t('projects.getFromGitHub'), onSelect: onGetFromGitHub },
    {
      id: 'paste',
      icon: <ClipboardPaste size={14} />,
      label: t('projectBrowser.paste'),
      disabled: !cut.length || !!(folderId && excluded(cut).has(folderId)),
      onSelect: () => move(cut, folderId),
    },
    { id: 'sep', separator: true },
    { id: 'all', label: t('library.selectAll'), disabled: !keys.length, onSelect: () => setSelected(new Set(keys)) },
  ];
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.defaultPrevented || moving || context || (event.target as HTMLElement).closest('[role="menu"]')) return;
    if (!shown) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      search.current?.focus();
      search.current?.select();
      return;
    }
    const typing = (event.target as HTMLElement).closest('input,textarea,[contenteditable=true]');
    if (typing) {
      if (event.key === 'Escape' && event.target === search.current && query) {
        event.preventDefault();
        setQuery('');
      }
      return;
    }
    if (mod && event.shiftKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      void newFolder();
      return;
    }
    if (event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'ArrowUp') navigate(trail.length > 1 ? trail[trail.length - 2]!.id : null);
      else history(event.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (event.key === 'Escape' && (selected.size || cut.length)) {
      event.preventDefault();
      setSelected(new Set());
      setCut([]);
      anchor.current = null;
      return;
    }
    if (!surface.current?.contains(event.target as Node)) return;
    if ((event.target as HTMLElement).closest('button') && (event.key === 'Enter' || event.key === ' ')) return;
    const activeKey = (event.target as HTMLElement).closest<HTMLElement>('[data-browser-item]')?.dataset.browserItem;
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const picked = activeKey && !selected.has(activeKey) ? [activeKey] : [...selected];
      setSelected(new Set(picked));
      const bounds = (event.target as HTMLElement).getBoundingClientRect();
      setContext({ x: bounds.left, y: bounds.bottom, keys: picked });
      return;
    }
    if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelected(new Set(keys));
      return;
    }
    if (mod && event.key.toLowerCase() === 'x' && selected.size) {
      event.preventDefault();
      setCut([...selected]);
      return;
    }
    if (mod && event.key.toLowerCase() === 'v' && cut.length) {
      event.preventDefault();
      move(cut, folderId);
      return;
    }
    const single = selected.size === 1 ? entries.find(e => selected.has(e.key)) : undefined;
    if (event.key === 'F2' && single) {
      event.preventDefault();
      rename(single);
      return;
    }
    if (mod && event.key.toLowerCase() === 'd' && single && 'project' in single && !single.project.missing) {
      event.preventDefault();
      onDuplicate(single.project);
      return;
    }
    if ((event.key === 'Delete' || (mod && event.key === 'Backspace')) && selected.size) {
      event.preventDefault();
      remove([...selected]);
      return;
    }
    if (event.key === 'Enter' && single) {
      event.preventDefault();
      openEntry(single);
      return;
    }
    if (event.key === ' ' && activeKey) {
      event.preventDefault();
      setSelected((was) => selectBrowserItems(keys, was, activeKey, anchor.current, { ctrlKey: true }));
      anchor.current = activeKey;
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) && keys.length) {
      event.preventDefault();
      const grid = surface.current.querySelector<HTMLElement>(`.${styles.grid}`);
      const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 1;
      const at = keys.indexOf(activeKey ?? [...selected].at(-1) ?? '');
      const step =
        event.key === 'ArrowUp' ? -columns : event.key === 'ArrowDown' ? columns : event.key === 'ArrowLeft' ? -1 : 1;
      const index =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
          ? keys.length - 1
          : at < 0
          ? 0
          : Math.max(0, Math.min(keys.length - 1, at + step));
      const key = keys[index]!;
      if (!mod || event.shiftKey)
        setSelected((was) =>
          selectBrowserItems(keys, was, key, anchor.current, { shiftKey: event.shiftKey, ctrlKey: mod }),
        );
      if (!event.shiftKey) anchor.current = key;
      surface.current.querySelector<HTMLElement>(`[data-browser-index="${index}"]`)?.focus();
      return;
    }
    if (!mod && !event.altKey && event.key.length === 1 && !event.nativeEvent.isComposing) {
      const now = Date.now();
      typed.current = {
        text: (now - typed.current.at < 750 ? typed.current.text : '') + event.key.toLocaleLowerCase(),
        at: now,
      };
      const index = entries.findIndex((entry) => entry.name.toLocaleLowerCase().startsWith(typed.current.text));
      if (index >= 0) {
        event.preventDefault();
        const key = keys[index]!;
        setSelected(new Set([key]));
        anchor.current = key;
        surface.current.querySelector<HTMLElement>(`[data-browser-index="${index}"]`)?.focus();
      }
    }
  };
  const starts = listStarts({ folderId, query });
  const movingParents =
    moving?.map((key) => {
      if (key.startsWith('folder:')) {
        const folder = folders.find((f) => f.id === key.slice(7));
        return folder ? parentOf(folder, folders) : null;
      }
      const id = projects.find((p) => p.id === key.slice(8))?.folderId;
      return folders.some((f) => f.id === id) ? id! : null;
    }) ?? [];
  const movingCurrent = new Set(movingParents).size === 1 ? movingParents[0] : undefined;
  const itemName = (entry: BrowserEntry) =>
    renaming === entry.key ? (
      <InlineNameInput
        key={entry.key}
        initial={entry.name}
        onCommit={(name) => {
          setRenaming(null);
          if (name && name !== entry.name) {
            if ('folder' in entry) onRenameFolder(entry.folder.id, name);
            else onRename(entry.project.id, limitTitleWidth(name, TITLE_MAX_WIDTH));
          }
          surface.current?.focus({ preventScroll: true });
        }}
        onCancel={() => {
          setRenaming(null);
          surface.current?.focus({ preventScroll: true });
        }}
        className="h-6 w-full min-w-0 rounded border border-[var(--accent)] bg-[var(--bg-raised)] px-1 text-[12px] text-[var(--text)] outline-none"
      />
    ) : (
      <span title={'project' in entry ? entry.project.path : entry.name}>{entry.name}</span>
    );
  const itemMenu = (entry: BrowserEntry) => (
    <button
      type="button"
      className={styles.iconButton}
      tabIndex={selected.has(entry.key) ? 0 : -1}
      aria-label={t('projectMenu.more')}
      aria-haspopup="menu"
      onClick={(event) => {
        event.stopPropagation();
        const picked = selected.has(entry.key) ? [...selected] : [entry.key];
        setSelected(new Set(picked));
        const rect = event.currentTarget.getBoundingClientRect();
        setContext({ x: rect.right, y: rect.bottom, keys: picked });
      }}
    >
      <MoreHorizontal size={14} />
    </button>
  );
  const renderEntry = (entry: BrowserEntry, index: number) => {
    const folder = 'folder' in entry ? entry.folder : null;
    const project = 'project' in entry ? entry.project : null;
    const date = project?.openedAt ?? folder!.createdAt;
    const status = project?.missing
      ? t(project.missingReason === 'film' ? 'projects.missingFilm' : 'projects.missing')
      : project?.working
      ? t('projects.agentRunning')
      : '';
    return (
      <div
        key={entry.key}
        role="option"
        aria-label={entry.name}
        aria-selected={selected.has(entry.key)}
        tabIndex={selected.has(entry.key) || (!selected.size && index === 0) ? 0 : -1}
        data-browser-item={entry.key}
        data-browser-index={index}
        data-browser-folder={folder?.id}
        className={`${styles.item} ${view === 'cards' ? styles.card : styles.row} ${
          folder && dropTarget === folder.id ? styles.dropTarget : ''
        } ${cut.includes(entry.key) ? styles.cut : ''}`}
        onClick={(event) => choose(entry, event)}
        onDoubleClick={(event) => {
          if (!(event.target as HTMLElement).closest('button,input') && !event.ctrlKey && !event.metaKey)
            openEntry(entry);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const picked = selected.has(entry.key) ? [...selected] : [entry.key];
          setSelected(new Set(picked));
          setContext({ x: event.clientX, y: event.clientY, keys: picked });
        }}
        draggable={renaming !== entry.key}
        onDragStart={(event) => {
          if ((event.target as HTMLElement).closest('button,input')) {
            event.preventDefault();
            return;
          }
          const picked = selected.has(entry.key) ? [...selected] : [entry.key];
          dragging.current = picked;
          setSelected(new Set(picked));
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(BROWSER_DRAG, JSON.stringify(picked));
        }}
        onDragEnd={() => {
          dragging.current = [];
          setDropTarget(undefined);
        }}
        {...(folder ? dropProps(folder.id) : {})}
      >
        {view === 'cards' ? (
          <>
            <div className={`${styles.cover} ${folder ? styles.folderCover : ''}`}>
              {folder ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <FolderGlyph className="h-[78%] w-[78%]" />
                </div>
              ) : (
                <PosterMedia project={project!} />
              )}
              {project?.duration ? <span className={styles.duration}>{formatDuration(project.duration)}</span> : null}
            </div>
            <div className={styles.name}>
              {itemName(entry)}
              <div className={styles.itemMenu}>{itemMenu(entry)}</div>
            </div>
            <div className={`${styles.meta} ${project?.missing ? styles.error : ''}`}>
              {status ||
                (folder
                  ? t(counts[folder.id] === 1 ? 'projects.folderCountOne' : 'projects.folderCount').replace(
                      '{n}',
                      String(counts[folder.id] ?? 0),
                    )
                  : formatDate(date, language))}
            </div>
          </>
        ) : (
          <>
            <div className={styles.name}>
              {folder ? (
                <Folder size={23} className="mr-2" />
              ) : (
                <div className={styles.thumbnail}>
                  <PosterMedia project={project!} />
                </div>
              )}
              {itemName(entry)}
            </div>
            <span>{formatDate(date, language)}</span>
            <span>{t(folder ? 'projectBrowser.folder' : 'projectBrowser.project')}</span>
            <span className={project?.missing ? styles.error : ''} title={status}>
              {status || (project?.duration ? formatDuration(project.duration) : '—')}
            </span>
            <div className={styles.itemMenu}>{itemMenu(entry)}</div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className={styles.browser} onKeyDown={onKeyDown} data-project-browser="" data-icon-size={display} style={{ '--resource-tile': `${RESOURCE_TILE_SIZE[display === 'list' ? 'medium' : display]}px`, ...(shown ? {} : { display: 'none' }) } as React.CSSProperties}>
      <div className={styles.body}>
        <main className={styles.main} aria-label={t('projects.sideProjects')}>
          <div
            ref={surface}
            className={styles.surface}
            tabIndex={0}
            aria-label={t('projectBrowser.contents')}
            {...dropProps(folderId)}
            onContextMenu={(event) => {
              if ((event.target as HTMLElement).closest('[data-browser-item]')) return;
              event.preventDefault();
              setSelected(new Set());
              setContext({ x: event.clientX, y: event.clientY, keys: [] });
            }}
            onPointerDown={(event) => {
              if (event.button !== 0 || (event.target as HTMLElement).closest('[data-browser-item],button,input'))
                return;
              surface.current?.focus({ preventScroll: true });
              const rect = event.currentTarget.getBoundingClientRect();
              boxStart.current = {
                x: event.clientX - rect.left + event.currentTarget.scrollLeft,
                y: event.clientY - rect.top + event.currentTarget.scrollTop,
                selected: new Set(event.ctrlKey || event.metaKey || event.shiftKey ? selected : []),
              };
              if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
                setSelected(new Set());
                anchor.current = null;
              }
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const start = boxStart.current;
              if (!start) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const x = event.clientX - rect.left + event.currentTarget.scrollLeft,
                y = event.clientY - rect.top + event.currentTarget.scrollTop;
              if (Math.abs(x - start.x) + Math.abs(y - start.y) < 5) return;
              const box = {
                left: Math.min(start.x, x),
                top: Math.min(start.y, y),
                width: Math.abs(x - start.x),
                height: Math.abs(y - start.y),
              };
              setMarquee(box);
              const picked = new Set(start.selected);
              event.currentTarget.querySelectorAll<HTMLElement>('[data-browser-item]').forEach((el) => {
                const bounds = el.getBoundingClientRect();
                const left = bounds.left - rect.left + event.currentTarget.scrollLeft,
                  top = bounds.top - rect.top + event.currentTarget.scrollTop;
                if (
                  left < box.left + box.width &&
                  left + bounds.width > box.left &&
                  top < box.top + box.height &&
                  top + bounds.height > box.top
                )
                  picked.add(el.dataset.browserItem!);
              });
              setSelected(picked);
            }}
            onPointerUp={(event) => {
              boxStart.current = null;
              setMarquee(null);
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              boxStart.current = null;
              setMarquee(null);
            }}
          >
            {/* ways to start (at the top level, not while searching): a new project, a folder on this computer, a
                repository, side by side */}
            {!folderId && !query ? (
              <div className={styles.starts}>
                <button type="button" className={`${styles.startCard} ${styles.startNew}`} disabled={creating} data-start="new" onClick={() => onNewProject(null)}>
                  <span className={styles.startPlus}><Plus size={20} strokeWidth={2.2} /></span>
                  <span className={styles.startText}><strong>{t('projects.newProject')}</strong><small>{t('projects.newProjectNote')}</small></span>
                </button>
                <button type="button" className={styles.startCard} data-start="folder" onClick={onOpenFolder}>
                  <FolderOpen size={20} strokeWidth={1.6} />
                  <span className={styles.startText}><strong>{t('projects.openFolderShort')}</strong><small>{t('projects.openFolderNote')}</small></span>
                </button>
                <button type="button" className={styles.startCard} data-start="github" onClick={onGetFromGitHub}>
                  <Github size={20} strokeWidth={1.6} />
                  <span className={styles.startText}><strong>{t('projects.githubShort')}</strong><small>{t('projects.githubNote')}</small></span>
                </button>
              </div>
            ) : null}
            {/* the projects' own bar, staying at the top as they scroll: where one is (the projects, or a folder's path
                with the way back), then the tools for them gathered at its end */}
            <div className={styles.listBar}>
              {/* back and forward once there is somewhere to go (a folder was opened) */}
              {location.entries.length > 1 ? (
                <>
                  <button type="button" className={styles.iconButton} aria-label={t('projectBrowser.back')} disabled={location.index === 0} onClick={() => history(-1)}><ArrowLeft size={16} /></button>
                  <button type="button" className={styles.iconButton} aria-label={t('projectBrowser.forward')} disabled={location.index === location.entries.length - 1} onClick={() => history(1)}><ArrowRight size={16} /></button>
                </>
              ) : null}
              {folderId || query ? (
                <>
                  <nav className={styles.path} aria-label={t('projectBrowser.path')}>
                    <button type="button" onClick={() => navigate(null)} {...dropProps(null)}><span>{t('launcher.projects')}</span></button>
                    {trail.map((folder) => (
                      <React.Fragment key={folder.id}>
                        <ChevronRight size={13} />
                        <button type="button" onClick={() => navigate(folder.id)} {...dropProps(folder.id)}><span>{folder.name}</span></button>
                      </React.Fragment>
                    ))}
                    {query ? <><ChevronRight size={13} /><span className="px-1 text-[var(--text-muted)]">{t('projectBrowser.results')}</span></> : null}
                  </nav>
                </>
              ) : (
                <h3 className={styles.listTitle} {...dropProps(null)}>{t('projects.listTitle')}<small>{entries.length}</small></h3>
              )}
              <span className={styles.listTools}>
                <label className={styles.search}>
                  <Search size={14} />
                  <input
                    ref={search}
                    type="search"
                    aria-label={t('projectBrowser.search')}
                    placeholder={t('projectBrowser.search')}
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSelected(new Set());
                    }}
                  />
                </label>
                {folderId ? <button type="button" className={`${styles.action} ${styles.primary}`} disabled={creating} onClick={() => onNewProject(folderId)}><Plus size={14} /><span>{t('projects.newProject')}</span></button> : null}
                <Tooltip label={t('projects.newFolder')}><button type="button" className={styles.iconButton} data-explorer-command="" aria-label={t('projects.newFolder')} onClick={() => void newFolder()}><FolderPlus size={16} strokeWidth={1.7} /></button></Tooltip>
                <SortButton sort={sort} onSort={next => { setSort(next); setReversed(false); }} />
                <FileViewControl value={display} onChange={onDisplay} />
                <Tooltip label={t('projectMenu.more')}><button type="button" className={styles.iconButton} aria-label={t('projectMenu.more')} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setContext({ x: rect.left, y: rect.bottom, keys: [...selected] }); }}><MoreHorizontal size={16} /></button></Tooltip>
                {/* OpenFilm's recycle bin: what was deleted in OpenFilm, projects and everything else, to put back */}
                {onBin ? <Tooltip label={t('recycleBin.title')}><button type="button" className={styles.iconButton} aria-label={t('recycleBin.title')} data-open-recycle-bin="" onClick={onBin}><Trash2 size={16} strokeWidth={1.7} /></button></Tooltip> : null}
              </span>
            </div>
            {view === 'list' ? (
              <div className={styles.list}>
                <div className={styles.listHeader}>
                  <button type="button" onClick={() => sortColumn('title')}>
                    {t('projectBrowser.name')}
                    {sort === 'title' ? (
                      <ChevronDown size={11} style={{ transform: reversed ? 'rotate(180deg)' : undefined }} />
                    ) : null}
                  </button>
                  <button type="button" onClick={() => sortColumn('recent')}>
                    {t('projectBrowser.lastOpened')}
                    {sort === 'recent' ? (
                      <ChevronDown size={11} style={{ transform: reversed ? 'rotate(180deg)' : undefined }} />
                    ) : null}
                  </button>
                  <span>{t('projectBrowser.kind')}</span>
                  <button type="button" onClick={() => sortColumn('duration')}>
                    {t('projectBrowser.duration')}
                    {sort === 'duration' ? (
                      <ChevronDown size={11} style={{ transform: reversed ? 'rotate(180deg)' : undefined }} />
                    ) : null}
                  </button>
                  <span />
                </div>
                <div role="listbox" aria-label={t('projectBrowser.contents')} aria-multiselectable="true">
                  {entries.map(renderEntry)}
                </div>
              </div>
            ) : (
              <div
                className={styles.grid}
                role="listbox"
                aria-label={t('projectBrowser.contents')}
                aria-multiselectable="true"
              >
                {entries.map(renderEntry)}
              </div>
            )}
            {!entries.length ? (
              <div className={styles.empty}>
                <FolderOpen size={36} strokeWidth={1} />
                <span>{t(query ? 'library.noMatches' : 'projectBrowser.empty')}</span>
                {!query ? (
                  <button type="button" className={styles.action} onClick={() => onNewProject(folderId)}>
                    <Plus size={14} />
                    {t('projects.newProject')}
                  </button>
                ) : null}
              </div>
            ) : null}
            {starts.examples && onOpenExample ? (
              <div className="px-5">
                <ExamplesSection
                  examples={examples}
                  collapsed={examplesCollapsed}
                  onToggle={() => onToggleExamples?.()}
                  onOpen={onOpenExample}
                  view={view}
                />
              </div>
            ) : null}
            {marquee ? <div className={styles.marquee} style={marquee} /> : null}
          </div>
          <footer className={styles.status} aria-live="polite">
            <span>{t('projectBrowser.itemCount').replace('{n}', String(entries.length))}</span>
            {selected.size ? <span>{t('library.selectedCount').replace('{n}', String(selected.size))}</span> : null}
            <span className={styles.hint}>{t('projectBrowser.hint')}</span>
          </footer>
        </main>
      </div>
      {context ? (
        <ContextMenu
          x={context.x}
          y={context.y}
          items={context.keys.length ? selectionActions(context.keys) : backgroundActions}
          onClose={() => {
            setContext(null);
            surface.current?.focus({ preventScroll: true });
          }}
        />
      ) : null}
      {moving ? (
        <FolderPicker
          title={
            moving.length === 1
              ? entries.find((e) => e.key === moving[0])?.name ?? ''
              : t('library.selectedCount').replace('{n}', String(moving.length))
          }
          folders={folders}
          current={movingCurrent}
          exclude={excluded(moving)}
          onMove={(id) => {
            move(moving, id);
            setMoving(null);
          }}
          onCreate={onCreateFolder}
          onClose={() => setMoving(null)}
        />
      ) : null}
    </div>
  );
}

type BrowserEntry =
  | { key: string; name: string; folder: ProjectFolder }
  | { key: string; name: string; project: LibraryProject };
const BROWSER_DRAG = 'application/x-openfilm-project-items';
function readPreference<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const value = localStorage.getItem(`openfilm.projects.${key}`) as T;
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

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
          event.preventDefault();
          event.stopPropagation();
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
      className={
        className ??
        'h-8 w-[160px] rounded-lg border border-[var(--text)] bg-[var(--bg-raised)] px-2.5 text-[12.5px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]'
      }
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
  current: string | null | undefined;
  exclude: ReadonlySet<string>;
  onMove: (folderId: string | null) => void;
  onCreate: (name: string, parentId: string | null) => Promise<ProjectFolder | null>;
  onClose: () => void;
}) {
  const t = useT();
  /* null is the project list itself (no folder) */
  const [picked, setPicked] = React.useState<string | null>(current ?? null);
  const [shut, setShut] = React.useState<ReadonlySet<string>>(new Set());
  /* a new folder being named, inside this place (undefined: none) */
  const [naming, setNaming] = React.useState<string | null | undefined>(undefined);
  const children = React.useCallback(
    (parent: string | null) =>
      folders
        .filter((f) => parentOf(f, folders) === parent && !exclude.has(f.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [folders, exclude],
  );
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
  const move = (to: string | null) => {
    if (to !== current) onMove(to);
  };
  const toggle = (id: string) =>
    setShut((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const startNew = () => {
    setNaming(picked);
    if (picked)
      setShut((was) => {
        const next = new Set(was);
        next.delete(picked);
        return next;
      });
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
            <button
              type="button"
              aria-label={label}
              onClick={(event) => {
                event.stopPropagation();
                toggle(id);
              }}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-70 hover:opacity-100"
            >
              <ChevronRight size={13} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <span className={`shrink-0 ${isPicked ? '' : 'text-[var(--text-muted)]'}`}>{icon}</span>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {here ? (
            <span className={`shrink-0 text-[11.5px] ${isPicked ? 'opacity-80' : 'text-[var(--text-faint)]'}`}>
              {t('projects.hereNow')}
            </span>
          ) : null}
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
          if (event.key === 'Enter' && naming === undefined && canMove && !(event.target instanceof HTMLInputElement)) {
            event.preventDefault();
            move(picked);
          }
        }}
      >
        <div className="flex items-start gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-[var(--text)]">
              {t('projects.moveToTitle').replace('{name}', title)}
            </p>
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

        <div
          role="tree"
          tabIndex={0}
          className="mx-5 h-[260px] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-1 outline-none"
        >
          {place(null, 0, <LayoutGrid size={15} strokeWidth={1.7} />, t('nav.projects'))}
        </div>

        <div className="flex items-center gap-2 px-5 py-4">
          <button
            type="button"
            onClick={startNew}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[12.5px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]"
          >
            <FolderPlus size={14} strokeWidth={1.8} />
            {t('projects.newFolder')}
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-lg border border-[var(--border)] px-3 text-[12.5px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]"
          >
            {t('confirm.cancel')}
          </button>
          <button
            type="button"
            disabled={!canMove}
            onClick={() => move(picked)}
            className="h-8 rounded-lg bg-[var(--primary)] px-4 text-[12.5px] font-medium text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] disabled:opacity-40"
          >
            {t('projects.move')}
          </button>
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
  const tried =
    attempt && attempt.url === project.poster ? attempt : { url: project.poster ?? '', n: 0, failed: false };
  const again = tried.failed ? posterRetryDelay(tried.n) : null;
  React.useEffect(() => {
    if (again == null) return undefined;
    const timer = setTimeout(() => setAttempt({ url: tried.url, n: tried.n + 1, failed: false }), again);
    return () => clearTimeout(timer);
  }, [again, tried.url, tried.n]);
  /* `shade`: darker toward the bottom, under the length badge; only over a picture (on the plain face it is a smudge) */
  const shadow = shade ? (
    <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent opacity-90" />
  ) : null;
  const face = <div className="absolute inset-0 opacity-80" style={{ background: gradientForId(project.id) }} />;
  if (!project.poster || (tried.failed && again == null))
    return (
      <>
        {face}
        {shadow}
      </>
    );
  const src = posterTry(project.poster, tried.n);
  const ready = loadedUrl === src;
  return (
    <>
      {ready ? null : tried.n > 0 || tried.failed ? (
        face
      ) : (
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
        className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-200 ${
          ready ? 'opacity-100' : 'opacity-0'
        }`}
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
function SortButton({ sort, onSort }: { sort: LibrarySort; onSort: (next: LibrarySort) => void }) {
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
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ${
            anchor != null
              ? 'bg-[var(--bg-pressed)] text-[var(--text)]'
              : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'
          }`}
        >
          <SlidersHorizontal size={16} strokeWidth={1.7} />
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
              <p className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--text-faint)]">
                {t('library.sortLabel')}
              </p>
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onSort(option.id)}
                  className={row(option.id === sort)}
                >
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
