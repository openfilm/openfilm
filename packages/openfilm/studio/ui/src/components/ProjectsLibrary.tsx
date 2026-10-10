/**
 * The Projects popover (the top bar's Projects button): a large centered dialog to switch project, start one, open a
 * folder, rename, delete, or file projects in folders of the list. Its contents are ProjectsView; this file holds the
 * data and actions.
 *
 * Studio's projects are folders on disk: deleting one moves its folder to the system's Trash. One whose folder is gone
 * (moved, renamed or deleted outside Studio: `missing`) cannot be opened; it can only be taken off the list.
 *
 *   GET /api/projects → { projects }; POST /api/projects { name } | { path } → { project };
 *   PATCH /api/projects/:id { name } → { project } (renames the folder); DELETE /api/projects/:id (to the Trash);
 *   the list's folders: see lib/project-folders.ts
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { api, ApiError } from '@/api';
import { useT } from '@/i18n';
import { folderApi, type ProjectFolder } from '@/lib/project-folders';
import { studioHost } from '@/lib/host';
import { ConfirmDialog } from './ConfirmDialog';
import { ProjectsView, type LibraryProject } from './ProjectsView';

/* each card's picture: the film's middle frame, drawn by Studio (cached until film.html changes); none for a project
   whose folder is gone (its card shows its color) */
const posterOf = (p: LibraryProject) => (p.missing ? undefined : `/api/projects/${encodeURIComponent(p.id)}/poster`);

function useProjectLibrary(open: boolean) {
  const t = useT();
  const [projects, setProjects] = React.useState<LibraryProject[]>([]);
  const [folders, setFolders] = React.useState<ProjectFolder[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const errorTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (errorTimer.current) clearTimeout(errorTimer.current); }, []);

  const flash = React.useCallback((message: string) => {
    setError(message);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 4000);
  }, []);

  /* fetched fresh on every open: the agent or another window may have made or removed one meanwhile */
  React.useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    void Promise.all([
      api.projects().then(
        (list) => { if (alive) setProjects(list.map((p) => ({ ...p, poster: posterOf(p) }))); },
        () => {},
      ),
      folderApi.list().then((list) => { if (alive) setFolders(list); }, () => {}),
    ]).then(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [open]);

  const reloadFolders = React.useCallback(() => {
    void folderApi.list().then(setFolders, () => {});
    void api.projects().then((list) => setProjects((cur) => list.map((p) => ({ ...p, poster: cur.find((c) => c.id === p.id)?.poster ?? posterOf(p) }))), () => {});
  }, []);

  /**
   * How many of `ids` an agent is working in right now, read afresh (an agent may have started or finished since the
   * list was read); each card's mark follows.
   */
  async function workingIn(ids: string[]): Promise<number> {
    const list = await api.projects().catch(() => null);
    if (!list) return 0;
    const now = new Map(list.map((p) => [p.id, Boolean(p.working)]));
    setProjects((cur) => cur.map((p) => (now.has(p.id) && Boolean(p.working) !== now.get(p.id) ? { ...p, working: now.get(p.id) } : p)));
    return ids.filter((id) => now.get(id)).length;
  }

  /** What to say when an agent is working in `n` of the projects asked to be deleted (`of` of them). */
  const agentRunning = (n: number, of: number) => (n === 1 && of === 1 ? t('projects.agentRunningDelete') : t('projects.agentRunningDeleteMany').replace('{n}', String(n)));

  /** Delete projects (their folders go to the Trash), optimistically; the ones that fail come back. Returns the ids deleted. */
  async function deleteProjects(ids: string[]): Promise<Set<string>> {
    const before = projects;
    const drop = new Set(ids);
    setProjects((list) => list.filter((p) => !drop.has(p.id)));
    /* null: deleted; else why not ('agent-running': an agent started in it since the list was read) */
    const results = await Promise.all(ids.map((id) => api.forget(id).then(() => null, (e: unknown) => ({ id, working: e instanceof ApiError && e.body.code === 'agent-running' }))));
    const failed = results.filter((r): r is { id: string; working: boolean } => r !== null);
    if (failed.length) {
      const back = new Set(failed.map((f) => f.id));
      setProjects((list) => [...list, ...before.filter((p) => back.has(p.id)).map((p) => (failed.find((f) => f.id === p.id)?.working ? { ...p, working: true } : p))]);
      const working = failed.filter((f) => f.working).length;
      flash(working ? agentRunning(working, ids.length) : t('project.deleteFailed'));
    }
    const gone = new Set(failed.map((f) => f.id));
    return new Set(ids.filter((id) => !gone.has(id)));
  }

  async function createFolder(name: string): Promise<ProjectFolder | null> {
    try {
      const folder = await folderApi.create(name);
      setFolders((list) => [...list, folder]);
      return folder;
    } catch {
      return null;
    }
  }

  function renameFolder(id: string, name: string) {
    setFolders((list) => list.map((f) => (f.id === id ? { ...f, name } : f)));
    folderApi.rename(id, name).then(
      (folder) => setFolders((list) => list.map((f) => (f.id === id ? folder : f))),
      () => reloadFolders(),
    );
  }

  function moveProject(projectId: string, folderId: string | null) {
    setProjects((list) => list.map((p) => (p.id === projectId ? { ...p, folderId: folderId ?? undefined } : p)));
    folderApi.move(projectId, folderId).catch(() => reloadFolders());
  }

  /**
   * Delete a folder and the projects in it: the folder leaves the list, then each project is
   * deleted as one is (its folder to the Trash). A project that fails stays, at the top level. Returns the ids deleted.
   */
  async function deleteFolder(folder: ProjectFolder): Promise<Set<string>> {
    setFolders((list) => list.filter((f) => f.id !== folder.id));
    let inside: string[];
    try {
      inside = await folderApi.remove(folder.id);
    } catch {
      flash(t('project.deleteFailed'));
      reloadFolders();
      return new Set();
    }
    setProjects((list) => list.map((p) => (p.folderId === folder.id ? { ...p, folderId: undefined } : p)));
    return deleteProjects(inside);
  }

  async function renameProject(id: string, name: string) {
    const before = projects;
    setProjects((list) => list.map((p) => (p.id === id ? { ...p, name } : p)));
    try {
      const renamed = await api.rename(id, name);
      /* the server cleans the name for the file system: show what the folder is really called */
      setProjects((list) => list.map((p) => (p.id === id ? { ...p, ...renamed } : p)));
    } catch (e) {
      setProjects(before);
      /* a name that is taken: retrying can't help, so the message says what to do instead */
      flash(e instanceof ApiError && e.status === 409 ? t('projects.renameTaken').replace('{name}', name.trim()) : t('project.renameFailed'));
    }
  }

  return { projects, folders, loaded, error, flash, agentRunning, workingIn, deleteProjects, renameProject, createFolder, renameFolder, moveProject, deleteFolder };
}

export function ProjectsPopover({
  open,
  currentProjectId,
  onOpen,
  onCurrentRemoved,
  onClose,
}: {
  open: boolean;
  /** The project open in the editor ("" when none: Studio has no project to show, and this window is all there is). */
  currentProjectId: string;
  /**
   * Go to this project. The popover shows "Opening project" until `currentProjectId` changes, then closes; picking
   * the project already open just closes it.
   */
  onOpen: (projectId: string) => void;
  /** The project open in the editor was deleted: leave it (its API answers 404 from now on). */
  onCurrentRemoved: () => void;
  /** Missing: the window cannot be closed (there is no project behind it). */
  onClose?: () => void;
}) {
  const t = useT();
  const lib = useProjectLibrary(open);
  const [pendingDelete, setPendingDelete] = React.useState<string[] | null>(null);
  const [pendingFolder, setPendingFolder] = React.useState<ProjectFolder | null>(null);
  const [busy, setBusy] = React.useState<'creating' | 'opening' | null>(null);
  const close = React.useCallback(() => onClose?.(), [onClose]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !pendingDelete && !pendingFolder) close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, pendingDelete, pendingFolder]);

  const go = (projectId: string, kind: 'creating' | 'opening') => {
    /* the project already open: nowhere to go, and an "Opening" that would never end */
    if (projectId === currentProjectId) { close(); return; }
    setBusy(kind);
    onOpen(projectId);
  };
  /* another project opened: done */
  const latestClose = React.useRef(close);
  latestClose.current = close;
  const wasOpen = React.useRef(open);
  wasOpen.current = open;
  const shownFor = React.useRef(currentProjectId);
  React.useEffect(() => {
    if (shownFor.current === currentProjectId) return;
    shownFor.current = currentProjectId;
    setBusy(null);
    if (wasOpen.current) latestClose.current();
  }, [currentProjectId]);

  async function newProject() {
    setBusy('creating');
    try {
      const project = await api.newProject(t('project.untitled'));
      go(project.id, 'creating');
    } catch {
      setBusy(null);
      lib.flash(t('projects.localProjectFailed'));
    }
  }

  /** Open a folder as a project: the one dropped, else the one the app asks the person for. */
  async function openFolder(path?: string) {
    const folder = path ?? await studioHost?.folders?.pick();
    if (!folder) return;
    setBusy('opening');
    try {
      const project = await api.openFolder(folder);
      go(project.id, 'opening');
    } catch (e) {
      setBusy(null);
      lib.flash(t('projects.openFolderFailed').replace('{error}', e instanceof Error ? e.message : String(e)));
    }
  }

  /* a folder dropped on the list is opened (where the app can tell where it is) */
  const folderOf = (e: React.DragEvent) => [...e.dataTransfer.items].find((item) => item.webkitGetAsEntry()?.isDirectory)?.getAsFile() ?? null;
  const onDragOver = (e: React.DragEvent) => {
    if (studioHost?.folders && e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  };
  const onDrop = (e: React.DragEvent) => {
    if (!studioHost?.folders) return;
    e.preventDefault();
    const file = folderOf(e);
    const path = file ? studioHost.folders.pathOf(file) : '';
    if (path) void openFolder(path);
    else lib.flash(t('projects.dropFolder'));
  };

  if (!open) return null;

  /* what the delete dialog says: a project whose folder is gone only leaves the list (the server keeps to that too) */
  const pendingMissing = (pendingDelete ?? []).filter((id) => lib.projects.find((p) => p.id === id)?.missing).length;
  const onlyMissing = pendingDelete != null && pendingMissing === pendingDelete.length;
  const deleteTitle = !pendingDelete ? ''
    : onlyMissing ? t('projects.removeTitle')
      : pendingDelete.length > 1 ? t('confirm.deleteManyTitle').replace('{n}', String(pendingDelete.length)) : t('confirm.deleteTitle');
  const deleteDesc = !pendingDelete ? ''
    : onlyMissing ? t('projects.removeDesc')
      : `${t(pendingDelete.length > 1 ? 'confirm.deleteManyDesc' : 'confirm.deleteDesc')}${pendingMissing ? ` ${t('projects.removeAlso')}` : ''}`;
  const folderHeld = pendingFolder ? lib.projects.filter((p) => p.folderId === pendingFolder.id).length : 0;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[10040] bg-black/60" onMouseDown={close} />
      <div
        role="dialog"
        aria-label={t('project.projects')}
        aria-modal="true"
        className="fixed left-1/2 top-1/2 z-[10050] flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--app-content-bg)] shadow-[0_24px_64px_rgba(0,0,0,0.35)]"
        style={{
          width: 'min(1080px, calc(100vw - 64px))',
          height: 'min(760px, calc(100vh - 96px))',
        }}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {lib.loaded ? (
            <ProjectsView
              projects={lib.projects}
              creating={busy !== null}
              onNewProject={() => void newProject()}
              onOpenFolder={studioHost?.folders ? () => void openFolder() : undefined}
              /* its folder is gone: there is nothing to open, and the editor would only say so */
              onOpen={(project) => (project.missing ? lib.flash(t('projects.missingOpen')) : go(project.id, 'opening'))}
              onRename={(projectId, name) => void lib.renameProject(projectId, name)}
              /* an agent working in one: said at once, before asking (the server refuses it too) */
              onDelete={(ids) => void lib.workingIn(ids).then((working) => {
                if (working) lib.flash(lib.agentRunning(working, ids.length));
                else setPendingDelete(ids);
              })}
              folders={lib.folders}
              onCreateFolder={lib.createFolder}
              onRenameFolder={lib.renameFolder}
              onDeleteFolder={(folder) => {
                const inside = lib.projects.filter((p) => p.folderId === folder.id).map((p) => p.id);
                void lib.workingIn(inside).then((working) => {
                  if (working) lib.flash(lib.agentRunning(working, inside.length));
                  else setPendingFolder(folder);
                });
              }}
              onMoveToFolder={lib.moveProject}
              onClose={onClose}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-[var(--text-muted)]">
              <Loader2 size={18} className="animate-spin" />
            </div>
          )}
        </div>
        {busy ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--app-content-bg)]/70">
            <div className="flex items-center gap-2 rounded-lg bg-[var(--surface)] px-4 py-3 text-sm shadow-lg">
              <Loader2 size={16} className="animate-spin" />{t(busy === 'creating' ? 'projects.creating' : 'projects.opening')}
            </div>
          </div>
        ) : null}
        {lib.error ? (
          <div role="alert" className="pointer-events-none absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full border border-[var(--err)]/40 bg-[var(--surface)] px-4 py-2 text-[12.5px] font-medium text-[var(--err)] shadow-[var(--shadow-lg)]">
            {lib.error}
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={!!pendingDelete}
        title={deleteTitle}
        description={deleteDesc}
        confirmLabel={onlyMissing ? t('projects.removeFromList') : t('confirm.delete')}
        cancelLabel={t('confirm.cancel')}
        danger={!onlyMissing}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const ids = pendingDelete;
          setPendingDelete(null);
          if (!ids) return;
          void lib.deleteProjects(ids).then((deleted) => {
            if (deleted.has(currentProjectId)) onCurrentRemoved();
          });
        }}
      />
      <ConfirmDialog
        open={!!pendingFolder}
        title={pendingFolder ? `${t('projects.deleteFolder')} · ${pendingFolder.name}` : ''}
        description={t(folderHeld === 0 ? 'projects.deleteFolderHintEmpty' : folderHeld === 1 ? 'projects.deleteFolderHintOne' : 'projects.deleteFolderHint').replace('{n}', String(folderHeld))}
        confirmLabel={t('confirm.delete')}
        cancelLabel={t('confirm.cancel')}
        danger
        onCancel={() => setPendingFolder(null)}
        onConfirm={() => {
          const folder = pendingFolder;
          setPendingFolder(null);
          if (!folder) return;
          void lib.deleteFolder(folder).then((deleted) => {
            if (deleted.has(currentProjectId)) onCurrentRemoved();
          });
        }}
      />
    </>,
    document.body,
  );
}
