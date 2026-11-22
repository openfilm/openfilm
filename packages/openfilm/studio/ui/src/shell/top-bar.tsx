/**
 * The page's top bar, and the windows of the page's own that are opened from it: the shell draws them whichever
 * workbench is shown, and with none. On the bar: the app's menu (Settings in it), the app's tabs or the project's
 * title with its card (rename, the folder shown, all the projects), the updates, the desktop app's dialog, and the
 * switch between the workbenches, and the project's version history (shell/history). Over the page: the projects window,
 * Settings, the version history's window, the desktop app's dialog, and what an agent asks before it spends.
 *
 * What a workbench has on the bar it gives through the wiring (shell/frame `topBar`): its own buttons, drawn before
 * the switch, what it knows of the film for the project's card, and the picture at the playhead made the cover.
 * Without it the bar has the page's parts alone, the card says what the project says of itself, and no cover is made
 * from a frame. Any plugin's element puts buttons of its own there too, as a list the bar draws (openfilm/studio
 * `topBar`), after the edit's. The desktop project navigator opens from the corner of the title bar.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { MonitorDown, Puzzle, SquarePen } from 'lucide-react';
import { api, ApiError, type ProjectFilm } from '@/api';
import { useT } from '@/i18n';
import { PROJECT_SIDEBAR_WIDTH } from '@/lib/hover-open';
import { DESKTOP_TITLEBAR_HEIGHT } from '@/lib/workspaces';
import { readCanvasDoc } from '@/lib/canvas';
import { HOST_PANEL_WIDTH, studioHost, type StudioHost } from '@/lib/host';
import { leaveProject, openProject } from '@/lib/navigate';
import { setSidePageHost, useSidePageHost } from '@/lib/side-page';
import { closePlugins, openPlugins, usePluginsWindow } from '@/lib/plugins-window';
import { AppMenu } from '@/components/AppMenu';
import { DesktopWorkbenchTabs } from '@/components/DesktopWorkbenchTabs';
import { ProjectNavigator, type SidePage } from '@/components/DesktopNavigation';
import { LibraryPage } from '@/components/LibraryPage';
import { SearchPalette } from '@/components/SearchPalette';
import { readLastSubtitleStyle } from '@/lib/subtitles';
import { DesktopDialog } from '@/components/DesktopDialog';
import { PLUGIN_ICONS } from '@/components/library/PluginsPane';
import { ModeSwitcher } from '@/components/ModeSwitcher';
import { useWorkbenchGuide, WorkbenchGuide } from '@/components/WorkbenchGuide';
import { ProjectsPopover } from '@/components/ProjectsLibrary';
import { ProjectTabs } from '@/components/ProjectTabs';
import tabStyles from '@/components/ProjectTabs.module.css';
import { ProjectTitle } from '@/components/ProjectTitle';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { useSettings } from '@/components/settings/use-settings';
import { SpendAsks } from '@/components/SpendAsks';
import { Tooltip } from '@/components/Tooltip';
import { UpdateButton, WebUpdateButton } from '@/components/UpdateButton';
import { commandTo, topBarTools } from '@/studio/hub';
import type { useProjectFrame } from './ProjectFrame';
import { useWiring } from './frame';
import { useHistoryWindow } from './history';
import { LayoutMenu } from './layout';

/** A button of the top bar: the layout's menu, and a workbench's own beside it. */
export const TOP_BTN =
  'flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]';

/**
 * The page's own windows, open or not, and the project's name: held in the frame, so a workbench opens Settings or
 * the projects too. `loaded`: the project as read.
 */
export function usePageWindows(loaded: ProjectFilm | null) {
  const title = loaded?.project.name ?? '';
  /* the app's "New Tab" (its menu): the projects, to pick what the new tab shows */
  React.useEffect(() => studioHost?.tabs?.onPick(() => setProjectsOpen(true)), []);
  React.useEffect(() => { if (title) studioHost?.tabs?.report({ title }); }, [title]);
  /* the projects window: closed, open on the projects (true), or on the examples (and one example's page) */
  const [projectsOpen, setProjectsOpen] = React.useState<boolean | { example?: string }>(false);
  const [settingsOpen, setSettingsOpen] = useSettings();
  const [desktopOpen, setDesktopOpen] = React.useState(false);
  return { title, projectsOpen, setProjectsOpen, settingsOpen, setSettingsOpen, desktopOpen, setDesktopOpen };
}

/** The top bar, in the page's grid before the workbench's element: drawn once the project was read. */
export function TopBar({ frame }: { frame: ReturnType<typeof useProjectFrame> }) {
  const { loaded, failure } = frame;
  if (!loaded || failure) return null;
  return <Bar frame={frame} loaded={loaded} />;
}

function Bar({ frame, loaded }: { frame: ReturnType<typeof useProjectFrame>; loaded: ProjectFilm }) {
  const t = useT();
  const bar = useWiring('topBar')?.topBar;
  const {
    projectId, setLoaded, toast, reveal, title, setProjectsOpen, setSettingsOpen, desktopOpen, setDesktopOpen,
    canvasOpen, setCanvasOpen, nowShown, showWorkbench, benchPlugins, pickBench, canToggleCanvas,
    /* the page's panels are being rearranged (shell/layout): the workbench shown stays the one it is meanwhile */
    layoutEditing,
  } = frame;
  /* the workbench shown, as the top bar names it, and its help when requested */
  const guide = useWorkbenchGuide(nowShown, benchPlugins);
  /* ? (not while typing, nor over another dialog): the help of the editor shown, opened or put away */
  const guideRef = React.useRef({ guide, none: frame.noBench });
  guideRef.current = { guide, none: frame.noBench };
  React.useEffect(() => {
    const press = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable="true"], [data-studio-host-panel]')) return;
      const { guide: g, none } = guideRef.current;
      if (g.plugin) { e.preventDefault(); g.close(); return; }
      if (none || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      g.open();
    };
    window.addEventListener('keydown', press);
    return () => window.removeEventListener('keydown', press);
  }, []);
  const [renaming, setRenaming] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState('');
  const history = useHistoryWindow(projectId, { projectName: title, onError: toast.showError, className: TOP_BTN });

  const startRename = () => { setTitleDraft(title); setRenaming(true); };
  /* the film at the playhead as the projects list will show it: the workbench's to make (none shown: not offered) */
  const coverFromFrame = bar?.coverFromFrame;
  const renameError = (e: unknown, name: string) =>
    toast.showError(e instanceof ApiError && e.body.code === 'agent-running' ? t('projects.agentRunningRename')
      : e instanceof ApiError && e.body.code === 'export-running' ? t('projects.exportRunningRename')
      : e instanceof ApiError && e.body.code === 'folder-busy' ? t('projects.folderBusyRename')
      : e instanceof ApiError && e.status === 409 ? t('projects.renameTaken').replace('{name}', name) : t('project.renameFailed'));
  const commitTitle = async (draft = titleDraft) => {
    setRenaming(false);
    const next = draft.trim();
    if (!next || next === title || !loaded) return false;
    setLoaded({ ...loaded, project: { ...loaded.project, name: next } });
    try { const project = await api.rename(projectId, next); setLoaded((l) => (l ? { ...l, project } : l)); return true; }
    catch (e) {
      setLoaded((l) => (l ? { ...l, project: { ...l.project, name: title } } : l));
      renameError(e, next);
      return false;
    }
  };
  const navigation = studioHost?.conversations;
  const projectTitle = <ProjectTitle tab={Boolean(studioHost?.tabs)} name={title} editing={renaming} draft={titleDraft} onDraft={setTitleDraft}
    onRename={startRename} onCommit={() => void commitTitle()} onCancel={() => setRenaming(false)}
    facts={{ project: loaded.project, ...(bar ? { film: bar.film } : {}) }}
    actions={{ onRename: startRename, onCoverFromFrame: coverFromFrame, onReveal: () => reveal('') }}
    onAll={() => setProjectsOpen(true)} />;
  const appButton = <AppMenu onSettings={setSettingsOpen} />;
  const dialogs = <>
    {history.over}
    <WorkbenchGuide plugin={guide.plugin} benches={navigation || pickBench ? benchPlugins.length : 0} onClose={guide.close} />
  </>;
  if (navigation) {
    const picking = frame.newWorkbenchTab === 'active';
    return <>
      <DesktopHeader frame={frame} navigation={navigation} menu={bar?.menu}>
        {nowShown && <DesktopWorkbenchTabs key={projectId} projectId={projectId} now={nowShown} plugins={benchPlugins}
          onPick={showWorkbench} newTab={frame.newWorkbenchTab} onOpenNewTab={frame.openNewWorkbenchTab}
          onCloseNewTab={frame.closeNewWorkbenchTab} disabled={layoutEditing} />}
        <div data-workbench-actions className="ml-auto flex shrink-0 items-center gap-1">
          {!picking && <LayoutMenu frame={frame} className={TOP_BTN} />}
          {/* the app's update is the sidebar's card (UpdateNotice), above the account */}
          {history.button}
          {!picking && <>{bar?.tools}<PluginTools /></>}
        </div>
      </DesktopHeader>
      {dialogs}
    </>;
  }
  const desktopTabs = Boolean(studioHost?.tabs);
  return (<>
    <div data-titlebar className="relative flex h-8 min-w-0 items-center gap-1 bg-[var(--bg-titlebar)] px-[6px]" style={{ gridArea: 'bar', gap: desktopTabs ? 0 : undefined }} onContextMenu={event => event.preventDefault()}>
      {bar?.menu}
      {!desktopTabs && <div className="pointer-events-none absolute inset-0 flex min-w-0 items-center justify-center">
        <div className="pointer-events-auto flex min-w-0 max-w-full items-center">{projectTitle}</div>
      </div>}
      <div aria-hidden className={desktopTabs ? tabStyles.windowSpace : 'shrink-0 self-stretch'} style={{ width: 'var(--titlebar-logo-x)' }} />
      <div className={desktopTabs ? tabStyles.system : 'pointer-events-auto relative flex min-w-0 items-center'}>{appButton}</div>
      {desktopTabs && <ProjectTabs current={projectTitle} onProjects={() => setProjectsOpen(true)} onRenameCurrent={startRename} onCoverCurrent={coverFromFrame} />}
      <div className="pointer-events-auto relative flex min-w-0 items-center gap-1">
        <UpdateButton />
        <WebUpdateButton />
        {!studioHost && <Tooltip label={t('desktop.title')} side="bottom">
          <button type="button" aria-haspopup="dialog" onClick={() => setDesktopOpen(true)}
            className={`flex h-[26px] shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] ${desktopOpen ? 'bg-[var(--bg-hover)] text-[var(--text)]' : ''}`}>
            <MonitorDown size={14} />
            {t('nav.desktop')}
          </button>
        </Tooltip>}
      </div>
      <div className="min-w-0 flex-1" />
      <div className="pointer-events-auto flex min-w-0 items-center justify-end gap-1">
        {/* how the page's panels are arranged */}
        <LayoutMenu frame={frame} className={TOP_BTN} />
        {/* the project's version history, whichever workbench is shown */}
        {history.button}
        {/* the workbench's own: for the edit its export (the canvas has its own bars) */}
        {bar?.tools}
        {/* the buttons plugins put on the bar (openfilm/studio topBar) */}
        <PluginTools />
        {/* the edit or the canvas, in the panes' place: the one shown, by its name, and a click for the other */}
        {pickBench && nowShown ? <ModeSwitcher now={nowShown} plugins={benchPlugins} onPick={showWorkbench} onGuide={guide.open} disabled={layoutEditing} />
          : canToggleCanvas ? <Tooltip label={t(canvasOpen ? 'canvas.toEdit' : 'canvas.toCanvas')} action="work-mode" side="bottom">
          <button type="button" aria-label={t(canvasOpen ? 'canvas.toEdit' : 'canvas.toCanvas')} data-work-mode={canvasOpen ? 'canvas' : 'edit'} disabled={layoutEditing} onClick={() => setCanvasOpen(!canvasOpen)}
            className="flex h-[26px] shrink-0 items-center rounded-md bg-[var(--bg-hover)] px-2.5 text-[12.5px] font-medium text-[var(--text)] transition hover:bg-[var(--bg-pressed)]">
            {t(canvasOpen ? 'canvas.title' : 'canvas.editTitle')}
          </button>
        </Tooltip> : null}
      </div>
      <div aria-hidden className="shrink-0 self-stretch" style={{ width: 'var(--titlebar-right-x)' }} />
    </div>
    {/* the version history's window, put over the page (on the document's body) */}
    {dialogs}
  </>);
}

/** The buttons plugins put on the top bar (studio/hub `topBarTools`), drawn as the bar's own: an icon, or a few words. */
function PluginTools() {
  const tools = React.useSyncExternalStore(topBarTools.subscribe, topBarTools.get);
  return [...tools].flatMap(([owner, list]) => list.map((tool) => {
    const Icon = tool.icon ? PLUGIN_ICONS[tool.icon] ?? Puzzle : null;
    return (
      <Tooltip key={`${owner}\u0000${tool.id}`} label={tool.label} side="bottom">
        <button type="button" aria-label={tool.label} aria-pressed={tool.pressed} disabled={tool.disabled} data-plugin-tool={`${owner}:${tool.id}`} onClick={() => tool.onClick()}
          className={tool.text ? `flex h-[26px] shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-50 ${tool.pressed ? 'bg-[var(--bg-hover)] text-[var(--text)]' : ''}`
            : `${TOP_BTN} disabled:opacity-50 ${tool.pressed ? 'bg-[var(--bg-hover)] text-[var(--text)]' : ''}`}>
          {Icon ? <Icon size={tool.text ? 14 : 16} /> : null}
          {tool.text ?? (Icon ? null : tool.label)}
        </button>
      </Tooltip>
    );
  }));
}

/** how far the docked sidebar's button starts from the sidebar's right edge: its 26px and 10px of margin */
const DOCKED_CORNER_INSET = 36;

/** The project navigator previews over the workspace and can dock beside it. */
function DesktopHeader({ frame, navigation, menu, children }: {
  frame: ReturnType<typeof useProjectFrame>;
  navigation: NonNullable<StudioHost['conversations']>;
  menu?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useT();
  const { projectSidebar: sidebar, workspaceLeft } = frame;
  const id = React.useId();
  const { open, docked, dismissPreview } = sidebar;
  const chatOpen = Boolean(frame.chat?.open);

  /* The sidebar's pages, right of it in place of the chat and the editor: the projects or the Community, one at a time. */
  const community = usePluginsWindow().open;
  const [library, setLibrary] = React.useState(false);
  const page: SidePage | null = community ? 'community' : frame.projectsOpen !== false ? 'projects' : library ? 'library' : null;
  const { setProjectsOpen, setLoaded } = frame;
  React.useEffect(() => { if (community) { setProjectsOpen(false); setLibrary(false); } }, [community, setProjectsOpen]);
  React.useEffect(() => { if (frame.projectsOpen !== false) { closePlugins(); setLibrary(false); } }, [frame.projectsOpen]);
  const showPage = (next: SidePage | null) => {
    if (next === 'community') openPlugins(); else closePlugins();
    setProjectsOpen(next === 'projects');
    setLibrary(next === 'library');
  };
  /* the search, over the page: the sidebar's Search, or ⌘K anywhere in the window */
  const [searching, setSearching] = React.useState(false);
  React.useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.defaultPrevented) return;
      event.preventDefault();
      setSearching(open => !open);
    };
    window.addEventListener('keydown', press);
    return () => window.removeEventListener('keydown', press);
  }, []);
  const newChat = () => { showPage(null); void navigation.open(frame.projectId, null); };
  const newProject = async () => {
    try {
      const project = await api.newProject(t('project.untitled'), readLastSubtitleStyle() ?? undefined);
      showPage(null);
      openProject(project.id);
    } catch {
      frame.toast.showError(t('projects.localProjectFailed'));
    }
  };
  /* a project renamed from the sidebar: the one open here through its page's own state, so its title and folder follow */
  const renameProject = async (id: string, name: string) => {
    const project = await api.rename(id, name);
    if (id === frame.projectId) setLoaded(l => (l ? { ...l, project } : l));
    return project;
  };

  React.useEffect(() => {
    if (frame.layoutEditing || page || frame.settingsOpen !== null) dismissPreview();
  }, [frame.layoutEditing, page, frame.settingsOpen, dismissPreview]);

  React.useEffect(() => { dismissPreview(); }, [frame.projectId, dismissPreview]);

  const geometry = frame.freeGeometry;
  const box = geometry?.panels.chat;
  const rightChat = chatOpen && (geometry
    ? box && box.left > geometry.root.left && box.left + box.width === geometry.root.left + geometry.root.width
    : frame.workspacePrefs.chatSide === 'right');
  const sideColumn = !geometry || (box && box.width < geometry.root.width && (box.left === geometry.root.left || rightChat));
  const joinsChat = chatOpen && (!geometry || box?.top === geometry.root.top);
  /* Docked, the button sits at the sidebar's top right, never over the window's controls. */
  const cornerPlace = docked ? { left: `max(calc(var(--titlebar-logo-x) + 6px), ${workspaceLeft - DOCKED_CORNER_INSET}px)` } : undefined;
  /* the corner's button docks the sidebar and puts it away: a click, never a pointer passing over it */
  const corner = <div ref={sidebar.corner} className={tabStyles.sidebarCorner} data-docked={docked || undefined} style={cornerPlace}>
    <div aria-hidden className={tabStyles.windowInset} />
    <button ref={sidebar.trigger} type="button" data-project-sidebar-trigger aria-controls={open ? id : undefined}
      aria-label={t('projectBrowser.sidebar')} title={t('projectBrowser.sidebar')} aria-expanded={open}
      disabled={frame.layoutEditing} className={tabStyles.cornerButton}
      onClick={event => { sidebar.toggle(); if (!docked && event.detail === 0) sidebar.focusFirst(); }}
      onKeyDown={event => {
        if (event.key !== 'ArrowDown') return;
        event.preventDefault();
        sidebar.showPreview();
        sidebar.focusFirst();
      }}>
      <span className={tabStyles.cornerIcon} aria-hidden />
    </button>
  </div>;
  const header = <header data-titlebar data-project-navigation-ready={frame.projectId} data-chat-right={rightChat || undefined}
    data-nav-first={!chatOpen || rightChat || page !== null || undefined} data-sidebar-docked={docked || undefined} data-side-page={page ?? undefined}
    className={tabStyles.header} style={{ height: DESKTOP_TITLEBAR_HEIGHT, paddingLeft: workspaceLeft || undefined, ...(page && docked ? { width: workspaceLeft } : null) }}
    onContextMenu={event => event.preventDefault()}>
    {corner}
    {menu}
    <div data-chat-header className={tabStyles.chatHeader} data-split={chatOpen || undefined} data-joined={joinsChat || undefined}
      data-edge={chatOpen && sideColumn ? (box ? 'outer' : 'inner') : undefined}
      style={chatOpen ? { width: box ? box.width : HOST_PANEL_WIDTH } : undefined}>
      {chatOpen && <div className={tabStyles.chatTitle}>
      {/* the sidebar put away: a new conversation from the chat's own corner */}
      {!docked && <button type="button" className={tabStyles.chatNew} data-chat-new aria-label={t('desktopNavigation.newChat')}
        title={t('desktopNavigation.newChat')} onClick={newChat}><SquarePen size={15} strokeWidth={1.8} aria-hidden /></button>}
      <div ref={navigation.setTitleSlot} className={tabStyles.titleSlot} />
    </div>}
    </div>
    <div className={tabStyles.editorHeader}>{children}</div>
    {open && <aside id={id} ref={sidebar.drawer} data-project-sidebar data-docked={docked || undefined}
      data-studio-host-panel aria-label={t('projectBrowser.sidebar')} className={tabStyles.sidebar}
      style={{ paddingTop: DESKTOP_TITLEBAR_HEIGHT, width: docked ? workspaceLeft : PROJECT_SIDEBAR_WIDTH }}>
      <ProjectNavigator projectId={frame.projectId} onDismiss={dismissPreview} page={page}
        onPage={next => { dismissPreview(); showPage(next); }} onRename={renameProject} onSearch={() => setSearching(true)}
        footer={<AppMenu sidebar onSettings={frame.setSettingsOpen} />} />
      {/* the sidebar's top drags the window, as the rest of the bar does */}
      <div aria-hidden className={tabStyles.sidebarDrag} style={{ height: DESKTOP_TITLEBAR_HEIGHT }} />
    </aside>}
    {/* Every strip above inherits the header's drag, and Electron applies regions in DOM order: the chat strip (under
        the corner while the chat is on the left) and the sidebar's top would cover the corner's no-drag again, so this
        hole over the corner comes last. */}
    <div aria-hidden className={tabStyles.cornerHole} data-docked={docked || undefined} style={cornerPlace} />
  </header>;
  /* where the page is drawn (lib/side-page): from the window's top, right of the docked sidebar, over the chat and the editor;
     Esc not taken in the page closes it */
  const pageHost = <div ref={setSidePageHost} data-side-page-host={page ?? undefined} data-docked={docked || undefined} aria-hidden={!page || undefined}
    className="fixed bottom-0 right-0 z-50 flex min-h-0 min-w-0 flex-col bg-[var(--dialog-main)]"
    style={{ left: workspaceLeft, top: 0, display: page ? undefined : 'none' }}
    onKeyDown={event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]')) return;
      event.preventDefault();
      showPage(null);
    }}>{page === 'library' && <LibraryPage />}</div>;
  return <>
    <div aria-hidden style={{ gridArea: 'bar', height: DESKTOP_TITLEBAR_HEIGHT }} />
    {createPortal(<>{pageHost}{header}</>, document.body)}
    <SearchPalette open={searching} projectId={frame.projectId} onClose={() => setSearching(false)}
      onOpenProject={id => { showPage(null); if (id !== frame.projectId) openProject(id); }}
      onOpenChat={(id, session) => { showPage(null); void navigation.open(id, session); }}
      onNewChat={newChat} onNewProject={() => void newProject()} onPage={showPage} />
  </>;
}

/** The projects window and Settings: over the page, before the library's pane. */
export function PageWindows({ frame }: { frame: ReturnType<typeof useProjectFrame> }) {
  const t = useT();
  const topBar = useWiring('topBar')?.topBar;
  const { projectId, loaded, failure, toast, projectsOpen, setProjectsOpen, settingsOpen, setSettingsOpen, setCanvasOpen } = frame;
  /* the desktop window shows the projects as a page right of its sidebar (lib/side-page) */
  const host = useSidePageHost();
  if (!loaded || failure) return null;
  const projects = (
      <ProjectsPopover coverFromFrame={topBar?.coverFromFrame} open={projectsOpen !== false} currentProjectId={projectId} embedded={Boolean(host)}
        {...(typeof projectsOpen === 'object' ? { examples: projectsOpen } : {})}
        onOpen={(id) => {
          if (!studioHost?.tabs || host) setProjectsOpen(false);
          if (id !== projectId) openProject(id);
        }} onCurrentRemoved={leaveProject} onClose={() => setProjectsOpen(false)}
        onUseCanvas={(example) => {
          setProjectsOpen(false);
          void api.exampleCanvasInto(projectId, example.id).then((raw) => {
            setCanvasOpen(true);
            commandTo('canvas', { type: 'lay-board', board: readCanvasDoc(raw) });
            toast.show(t('canvas.exampleCopied').replace('{folder}', `assets/examples/${example.id}/`));
          }, (e: unknown) => toast.showError(e instanceof Error ? e.message : String(e)));
        }} />
  );
  return (
    <>
      {host ? createPortal(projects, host) : projects}
      <SettingsModal open={settingsOpen !== null} section={settingsOpen ?? undefined} onClose={() => setSettingsOpen(null)} />
    </>
  );
}

/** The desktop app's dialog, and what an agent asks before it spends: over the page, after everything else on it. */
export function PageAsks({ frame }: { frame: ReturnType<typeof useProjectFrame> }) {
  const { projectId, loaded, failure, desktopOpen, setDesktopOpen } = frame;
  if (!loaded || failure) return null;
  return (
    <>
      <DesktopDialog open={desktopOpen} onClose={() => setDesktopOpen(false)} />
      <SpendAsks projectId={projectId} />
    </>
  );
}
