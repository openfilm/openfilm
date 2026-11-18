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
 * `topBar`), after the edit's. The layout's menu (shell/layout) is the page's: it is the first of the buttons on the right.
 */
import * as React from 'react';
import { MonitorDown, Puzzle } from 'lucide-react';
import { api, ApiError, type ProjectFilm } from '@/api';
import { useT } from '@/i18n';
import { readCanvasDoc } from '@/lib/canvas';
import { studioHost } from '@/lib/host';
import { leaveProject, openProject } from '@/lib/navigate';
import { AppMenu } from '@/components/AppMenu';
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
    canvasOpen, setCanvasOpen, surface, showWorkbench, benchPlugins, pickBench, canToggleCanvas, colorOpen,
    /* the page's panels are being rearranged (shell/layout): the workbench shown stays the one it is meanwhile */
    layoutEditing,
  } = frame;
  /* the workbench shown, as the top bar names it, and what it is for (by itself the first time it is shown) */
  const shownBench = surface ?? (canvasOpen ? 'canvas' : colorOpen ? 'color' : 'edit');
  const guide = useWorkbenchGuide(frame.noBench ? null : shownBench, benchPlugins);
  /* ? (not while typing, nor over another dialog): the help of the editor shown, opened or put away */
  const guideRef = React.useRef({ guide, shownBench, none: frame.noBench });
  guideRef.current = { guide, shownBench, none: frame.noBench };
  React.useEffect(() => {
    const press = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable="true"], [data-studio-host-panel]')) return;
      const { guide: g, shownBench: bench, none } = guideRef.current;
      if (g.plugin) { e.preventDefault(); g.close(); return; }
      if (none || !bench || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      g.open(bench);
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
  const projectTitle = <ProjectTitle tab={Boolean(studioHost?.tabs)} name={title} editing={renaming} draft={titleDraft} onDraft={setTitleDraft}
    onRename={startRename} onCommit={() => void commitTitle()} onCancel={() => setRenaming(false)}
    facts={{ project: loaded.project, ...(bar ? { film: bar.film } : {}) }}
    actions={{ onRename: startRename, onCoverFromFrame: coverFromFrame, onReveal: () => reveal('') }}
    onAll={() => setProjectsOpen(true)} />;
  /* The desktop's tabs share the left edge; a browser keeps the project title centered. */
  return (<>
    <div data-titlebar className="relative flex h-8 min-w-0 items-center gap-1 bg-[var(--bg-titlebar)] px-[6px]" style={{ gridArea: 'bar', ...(studioHost?.tabs ? { gap: 0 } : {}) }} onContextMenu={event => event.preventDefault()}>
      {/* The title and arrow open the same project card on click. */}
      {!studioHost?.tabs ? <div className="pointer-events-none absolute inset-0 flex min-w-0 items-center justify-center">
        <div className="pointer-events-auto flex min-w-0 max-w-full items-center">
          {projectTitle}
        </div>
      </div> : null}
      {/* a menu of the workbench's own, kept in the bar */}
      {bar?.menu}
      {/* the window's controls over this, then the app menu */}
      <div aria-hidden className={studioHost?.tabs ? tabStyles.windowSpace : 'shrink-0 self-stretch'} style={{ width: 'var(--titlebar-logo-x)' }} />
      <div className={studioHost?.tabs ? tabStyles.system : 'pointer-events-auto relative flex min-w-0 items-center'}><AppMenu onSettings={setSettingsOpen} /></div>
      {studioHost?.tabs ? <ProjectTabs current={projectTitle} onProjects={() => setProjectsOpen(true)} onRenameCurrent={startRename} onCoverCurrent={coverFromFrame} /> : null}
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
        {pickBench ? <ModeSwitcher now={shownBench} plugins={benchPlugins} onPick={showWorkbench} onGuide={() => guide.open(shownBench)} disabled={layoutEditing} />
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
    {history.over}
    <WorkbenchGuide plugin={guide.plugin} benches={pickBench ? benchPlugins.length : 0} onClose={guide.close} />
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

/** The projects window and Settings: over the page, before the library's pane. */
export function PageWindows({ frame }: { frame: ReturnType<typeof useProjectFrame> }) {
  const t = useT();
  const { projectId, loaded, failure, toast, projectsOpen, setProjectsOpen, settingsOpen, setSettingsOpen, setCanvasOpen } = frame;
  if (!loaded || failure) return null;
  return (
    <>
      <ProjectsPopover open={projectsOpen !== false} currentProjectId={projectId}
        {...(typeof projectsOpen === 'object' ? { examples: projectsOpen } : {})}
        onOpen={(id) => { if (!studioHost?.tabs) setProjectsOpen(false); openProject(id); }} onCurrentRemoved={leaveProject} onClose={() => setProjectsOpen(false)}
        onUseCanvas={(example) => {
          setProjectsOpen(false);
          void api.exampleCanvasInto(projectId, example.id).then((raw) => {
            setCanvasOpen(true);
            commandTo('canvas', { type: 'lay-board', board: readCanvasDoc(raw) });
            toast.show(t('canvas.exampleCopied').replace('{folder}', `assets/examples/${example.id}/`));
          }, (e: unknown) => toast.showError(e instanceof Error ? e.message : String(e)));
        }} />
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
