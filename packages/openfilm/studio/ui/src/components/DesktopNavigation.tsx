/**
 * The desktop sidebar: a search at its top; its pages (the projects, the Community, the library), each shown right of
 * it in place of the chat and the editor (shell/top-bar); then the person's projects, each with its conversations under
 * it; the account at its foot.
 *
 * A project's row shows its folder (open, in the accent, while its conversations show); pointed at, the folder gives way
 * to the triangle that folds it, and More (rename, show its folder, take it off the list) and New chat come at its
 * right. A conversation's row is its name; pointed at, More (pin, rename, archive) comes at its right. Going to a project or a conversation leaves the page shown.
 */
import * as React from 'react';
import { Folder, FolderOpen, Folders, LibraryBig, MessageSquarePlus, MoreHorizontal, Pin, Plus, Search } from 'lucide-react';
import { api, type Project } from '@/api';
import { useT } from '@/i18n';
import { studioHost, type HostConversationEdit, type HostConversationList, type HostTab } from '@/lib/host';
import { openProject } from '@/lib/navigate';
import { readLastSubtitleStyle } from '@/lib/subtitles';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { COMMUNITY_ICON as Community } from './feature-kinds';
import { useHostTabs } from './ProjectCard';
import { UpdateNotice } from './UpdateNotice';
import styles from './DesktopNavigation.module.css';

type OpenChat = (project: string, session: string | null) => void;
/** A page the sidebar shows right of it, in place of the chat and the editor. */
export type SidePage = 'projects' | 'community' | 'library';
type Menu = { x: number; y: number; items: ContextMenuEntry[] };
/** the search's key, as the system writes it */
export const SEARCH_KEY = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘K' : 'Ctrl K';

/** The folding triangle, solid, pointing right (folded) or down. */
function Triangle({ open }: { open: boolean }) {
  return <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden style={{ transform: open ? 'rotate(90deg)' : undefined }}>
    <path d="M3 1.5 8 5 3 8.5Z" fill="currentColor" />
  </svg>;
}

/** A name edited where it is shown: Enter keeps it, Esc or leaving it empty does not. */
function InlineName({ value, label, onDone, onCancel }: { value: string; label: string; onDone: (name: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = React.useState(value);
  const done = React.useRef(false);
  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    const next = draft.trim();
    if (keep && next && next !== value) onDone(next); else onCancel();
  };
  return <input autoFocus className={styles.rename} value={draft} aria-label={label} onFocus={event => event.currentTarget.select()}
    onChange={event => setDraft(event.target.value)} onBlur={() => finish(true)} onClick={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    }} />;
}

const menuAt = (button: HTMLElement, items: ContextMenuEntry[]): Menu => {
  const box = button.getBoundingClientRect();
  return { x: box.right, y: box.bottom + 4, items };
};

function ProjectConversations({ projectId, currentProject, onOpen, onMenu, onError }: {
  projectId: string; currentProject: boolean; onOpen: OpenChat; onMenu: (menu: Menu) => void; onError: (message: string) => void;
}) {
  const t = useT();
  const bridge = studioHost?.conversations;
  const [chats, setChats] = React.useState<HostConversationList | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [asked, setAsked] = React.useState(0);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!bridge) return;
    let mounted = true;
    let fresh = false;
    const sync = () => {
      const snapshot = bridge.get();
      if (snapshot?.projectId === projectId) {
        fresh = true;
        setFailed(false);
        setChats(snapshot);
      }
    };
    const stop = bridge.subscribe(sync);
    sync();
    if (!fresh) void bridge.list(projectId).then(result => {
      if (mounted && !fresh) setChats(result);
    }, () => { if (mounted && !fresh) setFailed(true); });
    return () => { mounted = false; stop(); };
  }, [bridge, projectId, asked]);
  if (failed) return <p role="status" className={styles.notice}>{t('desktopNavigation.loadChatsFailed')}</p>;
  const change = async (id: string, edit: HostConversationEdit) => {
    try {
      const ok = await bridge?.edit?.(projectId, id, edit);
      if (ok === false) onError(t(edit.archived ? 'desktopNavigation.archiveRunning' : 'desktopNavigation.editFailed'));
    } catch {
      onError(t('desktopNavigation.editFailed'));
    }
    /* another project's list is not told of the change: read it again */
    if (bridge?.get()?.projectId !== projectId) setAsked(n => n + 1);
  };
  const canEdit = Boolean(bridge?.edit);
  const sessions = chats?.sessions ?? [];
  return sessions.map(session => {
    const title = session.title || t('desktopNavigation.newChat');
    const pin = () => void change(session.id, { pinned: !session.pinned });
    const archive = () => void change(session.id, { archived: true });
    const items: ContextMenuEntry[] = [
      { id: 'pin', label: t(session.pinned ? 'desktopNavigation.unpin' : 'desktopNavigation.pin'), onSelect: pin },
      { id: 'rename', label: t('desktopNavigation.rename'), onSelect: () => setRenaming(session.id) },
      { id: 'sep', separator: true },
      { id: 'archive', label: t('desktopNavigation.archive'), onSelect: archive },
    ];
    return <div key={session.id} className={styles.sessionRow} data-renaming={renaming === session.id || undefined}
      aria-current={currentProject && session.id === chats?.current ? 'page' : undefined}
      onContextMenu={canEdit ? event => { event.preventDefault(); onMenu({ x: event.clientX, y: event.clientY, items }); } : undefined}>
      {renaming === session.id
        ? <InlineName value={session.title} label={t('desktopNavigation.rename')} onCancel={() => setRenaming(null)}
            onDone={name => { setRenaming(null); void change(session.id, { title: name }); }} />
        : <button type="button" className={styles.session} data-navigation-session={session.id}
            aria-current={currentProject && session.id === chats?.current ? 'page' : undefined} onClick={() => onOpen(projectId, session.id)}>
            <span>{title}</span>{session.pinned && <Pin size={12} aria-hidden className={styles.pinned} />}
          </button>}
      {canEdit && renaming !== session.id && <span className={styles.rowActions}>
        <button type="button" className={styles.rowAction} data-session-more={session.id} aria-haspopup="menu" aria-label={t('desktopNavigation.more')} title={t('desktopNavigation.more')}
          onClick={event => onMenu(menuAt(event.currentTarget, items))}><MoreHorizontal size={14} aria-hidden /></button>
      </span>}
    </div>;
  });
}

export function ProjectNavigator({ projectId, onDismiss, page, onPage, onRename, onSearch, footer }: {
  projectId: string;
  onDismiss(): void;
  page: SidePage | null;
  /** show a page (null: back to the project) */
  onPage(page: SidePage | null): void;
  /** rename a project (the one open through its page, so everything showing it hears of it) */
  onRename(projectId: string, name: string): Promise<Project>;
  /** open the search (a window of its own, over the page) */
  onSearch(): void;
  footer: React.ReactNode;
}) {
  const t = useT();
  const { tabs, self } = useHostTabs();
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [failed, setFailed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [menu, setMenu] = React.useState<Menu | null>(null);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  /* the current project starts open, its conversations under it */
  const [expanded, setExpanded] = React.useState(() => new Set<string>([projectId]));
  const treeId = React.useId();
  const load = React.useCallback(() => api.projects().then(rows => rows.filter(project => !project.missing || project.missingReason === 'film')), []);
  React.useEffect(() => {
    let live = true;
    void load().then(rows => { if (live) setProjects(rows); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [load]);
  React.useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error]);
  const leave = () => onPage(null);
  const toggle = (id: string) => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const openChat: OpenChat = async (project, session) => {
    try {
      const opened = await studioHost?.conversations?.open(project, session);
      if (opened === false) setError(t('desktopNavigation.openChatFailed'));
      else leave();
    } catch {
      setError(t('desktopNavigation.openChatFailed'));
    }
  };
  const newProject = async () => {
    setCreating(true);
    try {
      const project = await api.newProject(t('project.untitled'), readLastSubtitleStyle() ?? undefined);
      leave();
      openProject(project.id);
    } catch {
      setError(t('projects.localProjectFailed'));
    } finally {
      setCreating(false);
    }
  };
  const rename = async (id: string, name: string) => {
    try {
      const project = await onRename(id, name);
      setProjects(list => list.map(item => (item.id === id ? project : item)));
    } catch {
      setError(t('desktopNavigation.renameFailed'));
    }
  };
  const unlist = async (id: string, tab?: HostTab) => {
    try {
      if (tab) studioHost?.tabs?.close(tab.id);
      await api.unlistProject(id);
      setProjects(list => list.filter(item => item.id !== id));
    } catch {
      setError(t('projects.removeFromListFailed'));
    }
  };

  // Open projects retain their native tab order, followed by the rest of the project library.
  const projectsById = new Map(projects.map(project => [project.id, project]));
  const rows: { id: string; name: string; path?: string; tab?: HostTab }[] = tabs.map(tab => {
    const project = projectsById.get(tab.projectId);
    return { id: tab.projectId, name: project?.name || tab.title || t('project.untitled'), path: project?.path, tab };
  });
  const openIds = new Set(rows.map(row => row.id));
  for (const project of projects) {
    if (!openIds.has(project.id)) rows.push({ id: project.id, name: project.name || t('project.untitled'), path: project.path });
  }
  const locations = new Map<string, string[][]>();
  for (const row of rows) {
    const parts = (row.path || row.id).split(/[\\/]/);
    const group = locations.get(row.name);
    if (group) group.push(parts);
    else locations.set(row.name, [parts]);
  }
  const place = (id: SidePage, icon: React.ReactNode, label: string) => (
    <button type="button" className={styles.place} data-navigation-page={id} aria-current={page === id ? 'page' : undefined}
      onClick={() => onPage(page === id ? null : id)}>{icon}{label}</button>
  );
  return <section className={styles.panel} data-project-navigator aria-label={t('launcher.projects')}>
    <button type="button" className={styles.search} data-navigation-search aria-haspopup="dialog" aria-keyshortcuts="Meta+K" onClick={onSearch}>
      <Search size={15} aria-hidden /><span>{t('desktopNavigation.search')}</span><kbd>{SEARCH_KEY}</kbd>
    </button>
    <nav className={styles.places} aria-label={t('desktopNavigation.pages')}>
      {place('projects', <Folders size={16} aria-hidden />, t('projects.sideProjects'))}
      {place('community', <Community size={16} aria-hidden />, t('assetDrawer.pluginsWindow'))}
      {place('library', <LibraryBig size={16} aria-hidden />, t('desktopNavigation.library'))}
    </nav>
    <div className={styles.heading}>
      <h2>{t('desktopNavigation.myProjects')}</h2>
      <button type="button" className={styles.headingAction} data-navigation-new-project disabled={creating}
        aria-label={t('projects.newProject')} title={t('projects.newProject')} onClick={newProject}><Plus size={15} aria-hidden /></button>
    </div>
    <div className={styles.tree}>
      {failed && <p className={styles.notice} role="status">{t('projects.loadFailed')}</p>}
      {rows.map(({ id, name, path, tab }) => {
        const peers = locations.get(name)!;
        let location: string | undefined;
        if (peers.length > 1) {
          const fullPath = path || id;
          const parts = fullPath.split(/[\\/]/);
          const firstDifference = parts.findIndex((part, index) => peers.some(peer => peer[index] !== part));
          location = firstDifference < 0 ? fullPath : parts.slice(firstDifference).join('/');
        }
        const accessibleName = location ? `${name} (${location})` : name;
        const isExpanded = expanded.has(id);
        const current = id === projectId;
        const childrenId = `${treeId}-${encodeURIComponent(id)}`;
        const FolderIcon = isExpanded ? FolderOpen : Folder;
        const items: ContextMenuEntry[] = [
          { id: 'rename', label: t('desktopNavigation.rename'), onSelect: () => setRenaming(id) },
          { id: 'reveal', label: t('exportTray.reveal'), onSelect: () => { void api.revealProject(id).catch(() => {}); } },
          ...(tab ? [{ id: 'close', label: t('desktopNavigation.closeTab'), onSelect: () => { if (tab.id === self) onDismiss(); studioHost?.tabs?.close(tab.id); } }] : []),
          { id: 'sep', separator: true },
          { id: 'unlist', label: t('desktopNavigation.removeFromList'), danger: true, disabled: current,
            hint: current ? t('desktopNavigation.currentStays') : undefined, onSelect: () => void unlist(id, tab) },
        ];
        return <div key={id}>
          <div className={styles.projectRow} data-project-tab={tab?.id} data-with-location={location ? true : undefined}
            data-expanded={isExpanded || undefined} data-renaming={renaming === id || undefined}
            onContextMenu={event => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, items }); }}>
            <button type="button" className={styles.disclosure} aria-expanded={isExpanded} aria-controls={isExpanded ? childrenId : undefined} data-navigation-disclosure={id}
              aria-label={t(isExpanded ? 'projectBrowser.collapse' : 'projectBrowser.expand').replace('{name}', accessibleName)}
              onClick={() => toggle(id)}>
              <FolderIcon size={16} aria-hidden className={styles.folder} /><span className={styles.triangle}><Triangle open={isExpanded} /></span>
            </button>
            {renaming === id
              ? <InlineName value={name} label={t('desktopNavigation.rename')} onCancel={() => setRenaming(null)}
                  onDone={next => { setRenaming(null); void rename(id, next); }} />
              : <button type="button" className={styles.projectName} data-navigation-project={id} aria-current={current && !page ? 'page' : undefined}
                  title={path || name} onClick={() => {
                    leave();
                    setExpanded(previous => new Set(previous).add(id));
                    if (tab) studioHost?.tabs?.show(tab.id); else if (!current) openProject(id);
                  }}>
                  <span className={styles.projectLabel}><span>{name}</span>{location && <small>{location}</small>}</span>
                </button>}
            {renaming !== id && <span className={styles.rowActions}>
              <button type="button" className={styles.rowAction} data-project-more={id} aria-haspopup="menu" aria-label={t('desktopNavigation.more')} title={t('desktopNavigation.more')}
                onClick={event => setMenu(menuAt(event.currentTarget, items))}><MoreHorizontal size={14} aria-hidden /></button>
              <button type="button" className={styles.rowAction} data-project-new-chat={id} aria-label={t('desktopNavigation.newChat')} title={t('desktopNavigation.newChat')}
                onClick={() => openChat(id, null)}><MessageSquarePlus size={14} aria-hidden /></button>
            </span>}
          </div>
          {isExpanded && <div id={childrenId}>
            <ProjectConversations projectId={id} currentProject={current && !page}
              onOpen={openChat} onMenu={setMenu} onError={setError} />
          </div>}
        </div>;
      })}
    </div>
    {error && <p role="status" className={styles.notice}>{error}</p>}
    <UpdateNotice />
    <footer data-navigation-footer className={styles.footer}>{footer}</footer>
    {menu && <ContextMenu x={menu.x} y={menu.y} align="end" items={menu.items} onClose={() => setMenu(null)} />}
  </section>;
}
