/**
 * How the project's page is laid out: one arrangement of the app's chat panel, the library, the canvas and the panes
 * of the workbench shown (the edit's viewer, layers, inspector and timeline), kept apart for the edit and for the
 * canvas. The shell holds it: the arrangements as stored and the one being rearranged, the app's own panel
 * (lib/host.ts `panel`) kept in step with them, where every panel is in the window, the library opened or closed, the
 * layout's menu on the top bar, and the seams and the editor drawn over the page. So the shell places the library, the
 * canvas, a plugin's surface and the notice that no workbench is on by itself, whichever workbench is shown, and with
 * none.
 *
 * The edit lays out and draws its own panes from what the frame says of them (shell/frame): its arrangement, where
 * its panes float, the room kept round them. What the layout reads of the edit's panes (how tall its timeline's tracks
 * are, whether its inspector has anything to show, its panes' sizes as drawn) comes through the wiring (`panes`);
 * without it the layout takes what it takes for a pane that is not there.
 */
import * as React from 'react';
import { studioHost, useHostPanel } from '@/lib/host';
import { useStudioPlugins } from '@/lib/plugins';
import { useWorkspaceDraft, useWorkspaceLayouts } from '@/lib/use-workspaces';
import { defaultDockTree, dockFrames, visibleDockPanels, type DockPanel } from '@/lib/workspace-dock';
import { defaultWorkspace, workspaceChatWidth, workspaceGeometry, type WorkspaceLayout, type WorkspaceMode } from '@/lib/workspaces';
import { ProjectLayoutMenu } from '@/components/ProjectLayoutMenu';
import { WorkspaceEditor, WorkspaceSeams } from '@/components/WorkspaceEditor';
import type { useProjectFrame } from './ProjectFrame';
import { useSteady, useWiring, wiringStore } from './frame';
import { HOST_PANEL_TOP } from './library';

/* what the layout takes for the edit's panes when no workbench tells of them (lib/workspace-preview, lib/workspace-dock):
   a timeline as tall as an empty one, an inspector with nothing to show */
const NO_PANES = { timelineFit: 200, inspectorIdle: true };

/** `value`, the same one until what it holds changes (compared as JSON): the frame is not told anew by every render. */
function useSame<T>(value: T): T {
  const key = JSON.stringify(value);
  return React.useMemo(() => value, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The room a docked arrangement keeps round the panes (for the app's panel, for the library docked beside them). */
const insetStyle = ({ inset }: ReturnType<typeof workspaceGeometry>): React.CSSProperties => ({ marginLeft: inset.left, marginRight: inset.right, marginBottom: inset.bottom });

/**
 * The layout of the project's page. `canvasOpen`: the canvas is shown (it has its own arrangement); `noBench`: no
 * workbench is on; `rearranging`: written here, whether the panels are being rearranged (the workbench shown stays
 * the one it is meanwhile, shell/workbenches).
 */
export function useLayout(of: { canvasOpen: boolean; noBench: boolean; rearranging: React.RefObject<boolean> }) {
  const { canvasOpen, noBench, rearranging } = of;
  /* the workspace's own setter, made further down */
  const updateWorkspaceRef = React.useRef<(patch: Partial<WorkspaceLayout>) => void>(() => {});
  /* every plugin off: no workbench is shown, only the library (and the app's chat), which opens. Once Studio has said
     which plugins are on: what this browser kept of them is of an earlier launch */
  const pluginsRead = useStudioPlugins() !== null;
  React.useEffect(() => { if (noBench && pluginsRead) updateWorkspaceRef.current({ assets: true }); }, [noBench, pluginsRead]);

  /* ── layout ── */
  const workspaceMode: WorkspaceMode = canvasOpen ? 'canvas' : 'edit';
  const { layout: storedWorkspace, profiles: workspaceProfiles, update: commitWorkspace, viewport: workspaceViewport, storageFailed: workspaceStorageFailed } = useWorkspaceLayouts(workspaceMode);
  const layoutDraft = useWorkspaceDraft();
  const workspacePrefs = layoutDraft.draft ?? storedWorkspace;
  const editPrefs = workspaceMode === 'edit' ? workspacePrefs : workspaceProfiles.edit;
  const canvasPrefs = workspaceMode === 'canvas' ? workspacePrefs : workspaceProfiles.canvas;
  rearranging.current = layoutDraft.draft !== null;
  const updateWorkspace = React.useCallback((patch: Partial<WorkspaceLayout>) => {
    if (layoutDraft.active.current) layoutDraft.update(patch); else commitWorkspace(patch);
  }, [layoutDraft.active, layoutDraft.update, commitWorkspace]);
  updateWorkspaceRef.current = updateWorkspace;
  const assetsPaneOpen = workspacePrefs.assets;
  /* where the panels float (an arrangement with a tree of splits): each panel's box in the window; null when docked */
  const editFree = React.useMemo(() => (editPrefs.tree ? dockFrames(editPrefs.tree, workspaceViewport, visibleDockPanels(editPrefs, Boolean(studioHost?.panel))) : null), [editPrefs, workspaceViewport]);
  const canvasFree = React.useMemo(() => (canvasPrefs.tree ? dockFrames(canvasPrefs.tree, workspaceViewport, visibleDockPanels(canvasPrefs, Boolean(studioHost?.panel))) : null), [canvasPrefs, workspaceViewport]);
  const freeGeometry = canvasOpen ? canvasFree : editFree;
  const freeStyle = React.useCallback((panel: DockPanel): React.CSSProperties => {
    const rect = (panel === 'canvas' ? canvasFree : editFree)?.panels[panel];
    return rect ? { position: 'fixed', zIndex: 30, ...rect, paddingTop:0, borderTop:rect.top===HOST_PANEL_TOP?'1px solid var(--dock-line)':0 } : {};
  }, [editFree, canvasFree]);

  /* ── the app Studio is embedded in (lib/host.ts): its own panel beside the panes, kept in step with the arrangement ── */
  const hostPanel = useHostPanel();
  /* an app that hosts Studio can keep the media in a drawer of its own panel (window.openfilmHost panel.assets): no
     left pane then, the viewer first on the left */
  const hostAssets = hostPanel?.assets ?? null;
  const workspaceLayout: WorkspaceLayout = { ...workspacePrefs, chat: hostPanel?.open ?? workspacePrefs.chat,
    chatWidth: hostPanel?.preferredWidth ?? workspacePrefs.chatWidth };
  const restoringHost = React.useRef(false);
  const applyHostWorkspace = (next: WorkspaceLayout) => {
    const native = studioHost?.panel;
    hostPanel?.setPlacement({ side: next.chatSide, libraryDock: next.libraryDock });
    hostPanel?.setOpen(next.chat);
    if (native?.preferredWidth !== next.chatWidth) hostPanel?.setWidth(next.chatWidth, true);
    if (native?.assets?.open !== next.assets) hostAssets?.setOpen(next.assets);
  };
  const hostApplyRef = React.useRef(applyHostWorkspace); hostApplyRef.current = applyHostWorkspace;
  // Changing mode restores its own profile before accepting new changes from the native chat.
  React.useLayoutEffect(() => {
    const next = workspacePrefs;
    restoringHost.current = true;
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      try { hostApplyRef.current(next); }
      finally { restoringHost.current = false; }
    });
    return () => { live = false; restoringHost.current = false; };
  }, [workspaceMode, workspacePrefs.chat, workspacePrefs.assets, workspacePrefs.chatWidth, workspacePrefs.libraryDock, workspacePrefs.chatSide]);
  React.useEffect(() => {
    const native = studioHost?.panel;
    if (!hostPanel || !native || restoringHost.current) return;
    // A profile can already match the host and produce no change event. Read the current host, not an older render's
    // snapshot, so a later drag is never mistaken for an acknowledgement of that profile.
    updateWorkspace({ chat: native.open, chatWidth: native.preferredWidth ?? hostPanel.preferredWidth,
      ...(hostAssets && native.assets ? { assets: native.assets.open } : {}) });
  }, [hostPanel?.open, hostPanel?.preferredWidth, hostAssets?.open, workspaceMode, updateWorkspace]);
  const applyWorkspace = (next: WorkspaceLayout) => {
    if (next.mode !== workspaceMode) return;
    if (next.libraryDock === 'chat' && !next.chat && hostAssets) next = { ...next, assets: false };
    updateWorkspace(next); applyHostWorkspace(next);
  };
  const resetWorkspace = () => applyWorkspace(defaultWorkspace(workspaceMode));
  /* begun from the panes as they are drawn now: the workbench's own are asked of it (none shown: as stored) */
  const beginLayoutEdit = () => {
    const sizes = wiringStore.get()?.panes?.sizes();
    layoutDraft.begin({ ...workspaceLayout, tree: workspaceLayout.tree ?? defaultDockTree({ ...workspaceLayout, chatWidth:hostPanel?.width || workspaceLayout.chatWidth, ...(sizes ? { inspectorWidth:sizes.inspector, layersWidth:sizes.layers } : {}) }, sizes?.timeline) });
  };
  const cancelLayoutEdit = () => { layoutDraft.close(); applyHostWorkspace(storedWorkspace); };
  const finishLayoutEdit = () => { const next = layoutDraft.draft; if (!next) return; layoutDraft.close(); commitWorkspace(next); applyHostWorkspace(next); };
  const chatBounds = freeGeometry?.panels.chat ?? null;
  const boundsKey = JSON.stringify(chatBounds);
  React.useLayoutEffect(() => {
    let live = true;
    queueMicrotask(() => { if (live) studioHost?.panel?.setBounds?.(chatBounds); });
    return () => { live = false; };
  }, [boundsKey]);
  React.useEffect(() => () => studioHost?.panel?.setBounds?.(null), []);
  const dockOf = (layout: WorkspaceLayout) => {
    const active = layout.mode === workspaceMode && !layout.tree ? hostPanel : null;
    return workspaceGeometry({ ...layout, chat: active?.open ?? layout.chat,
      libraryDock: !hostAssets && layout.libraryDock === 'chat' ? 'left' : layout.libraryDock },
      workspaceViewport, active?.width ?? (hostPanel && layout.chat ? workspaceChatWidth(workspaceViewport.width, layout.chatWidth) : 0));
  };
  const editDock = useSame(dockOf(editPrefs));
  const canvasDock = useSame(dockOf(canvasPrefs));
  const dockGeometry = canvasOpen ? canvasDock : editDock;
  const chatWidth = dockGeometry.inset[workspacePrefs.chatSide];
  const chatLibraryRect = chatBounds ?? { left: workspacePrefs.chatSide === 'right' ? workspaceViewport.width - chatWidth : 0,
    top: HOST_PANEL_TOP, width: chatWidth, height: workspaceViewport.height - HOST_PANEL_TOP };
  const independentLibrary = workspacePrefs.libraryDock !== 'chat' || !hostAssets;
  const libraryOpen = independentLibrary ? assetsPaneOpen : Boolean(hostAssets?.open);
  const openLibrary = (open: boolean) => { updateWorkspace({ assets: open }); hostAssets?.setOpen(open); };

  /* ── what the shell draws with, and what a workbench is told: each the same one until it changes ── */
  /* the app's own panel beside the panes (none: the app has no such panel): whether it is open, and the way to open or fold it */
  const chatThere = Boolean(hostPanel);
  const chatOpen = Boolean(hostPanel?.open);
  const does = useSteady({
    applyWorkspace, resetWorkspace, beginLayoutEdit, cancelLayoutEdit, finishLayoutEdit, openLibrary,
    toggleChat: () => hostPanel?.setOpen(!chatOpen),
    /* sizes the app's panel (`done`: the drag is over) */
    setPanelWidth: (width: number, done?: boolean) => { hostPanel?.setWidth(width, done); },
  });
  const chat = React.useMemo(() => (chatThere ? { open: chatOpen, toggle: does.toggleChat } : undefined), [chatThere, chatOpen, does]);
  /* where the library's pane is: docked on its own, or in the app's panel over the chat, with the seam that sizes the
     panel while the pane covers it. Open or not, the side it is docked on and its box, `free` when the panels float,
     how much of its foot the app's composer covers (`under`), and that seam (null: none) */
  const libraryPane = useSame({
    open: libraryOpen, dock: independentLibrary ? dockGeometry.dock : 'chat' as const,
    rect: independentLibrary ? freeGeometry?.panels.library ?? dockGeometry.library : chatLibraryRect,
    free: Boolean(freeGeometry), under: !independentLibrary ? hostAssets?.bottom ?? 0 : 0,
    seam: !freeGeometry && !independentLibrary && hostAssets?.open && hostPanel ? { label: hostPanel.label, width: hostPanel.width, bottom: hostAssets.bottom, side: workspacePrefs.chatSide } : null,
  });
  const layoutEditing = Boolean(layoutDraft.draft);
  const { draft, canUndo, canRedo, checkpoint, change, undo, redo } = layoutDraft;
  /* the arrangement being rearranged (`draft`; null: none is), and its steps taken back and again */
  const rearranged = React.useMemo(() => ({ draft, canUndo, canRedo, checkpoint, change, undo, redo }), [draft, canUndo, canRedo, checkpoint, change, undo, redo]);

  return {
    workspaceMode, workspacePrefs, editPrefs, workspaceLayout: useSame(workspaceLayout), workspaceViewport, workspaceStorageFailed,
    layoutDraft: rearranged, layoutEditing, updateWorkspace,
    editFree, canvasFree, freeGeometry, freeStyle, editDock, canvasDock, insetStyle,
    chat, chatThere, libraryPane,
    applyWorkspace: does.applyWorkspace, resetWorkspace: does.resetWorkspace, beginLayoutEdit: does.beginLayoutEdit,
    cancelLayoutEdit: does.cancelLayoutEdit, finishLayoutEdit: does.finishLayoutEdit, openLibrary: does.openLibrary, setPanelWidth: does.setPanelWidth,
  };
}

/**
 * The layout's menu, the first of the buttons on the right of the top bar (`className`: the bar's buttons'): the
 * arrangements to pick from, each drawn as the window would be, and the way into rearranging. The same one until what
 * it shows changes.
 */
export function LayoutMenu({ frame, className }: { frame: ReturnType<typeof useProjectFrame>; className: string }) {
  const panes = useWiring('panes')?.panes;
  const { workspaceLayout, applyWorkspace, resetWorkspace, beginLayoutEdit, chatThere, workspaceViewport, layoutEditing, workspaceStorageFailed } = frame;
  const fitHeight = panes?.timelineFit ?? NO_PANES.timelineFit;
  const inspectorIdle = panes?.inspectorIdle ?? NO_PANES.inspectorIdle;
  return React.useMemo(() => (
    <ProjectLayoutMenu className={className}
      value={workspaceLayout} onChange={applyWorkspace} onReset={resetWorkspace}
      hasChat={chatThere} viewport={workspaceViewport} timelineFitHeight={fitHeight} inspectorIdle={inspectorIdle} onEdit={beginLayoutEdit} layoutEditing={layoutEditing} storageFailed={workspaceStorageFailed} />
  ), [className, workspaceLayout, applyWorkspace, resetWorkspace, chatThere, workspaceViewport, fitHeight, inspectorIdle, beginLayoutEdit, layoutEditing, workspaceStorageFailed]);
}

/**
 * Over the page: the seams between the panels where they float, and the editor while they are rearranged. Drawn once
 * the project was read.
 */
export function LayoutOver({ frame }: { frame: ReturnType<typeof useProjectFrame> }) {
  const { loaded, failure, workspaceMode, workspacePrefs, freeGeometry, layoutDraft, updateWorkspace, chatThere, finishLayoutEdit, cancelLayoutEdit } = frame;
  if (!loaded || failure) return null;
  return (
    <>
      {freeGeometry && workspacePrefs.tree ? <WorkspaceSeams tree={workspacePrefs.tree} frames={freeGeometry} editing={Boolean(layoutDraft.draft)} onChange={tree => updateWorkspace({ tree })} onCheckpoint={layoutDraft.draft ? layoutDraft.checkpoint : undefined} /> : null}
      {layoutDraft.draft && freeGeometry ? <WorkspaceEditor value={layoutDraft.draft} frames={freeGeometry} hasChat={chatThere} onChange={layoutDraft.change}
        onDone={finishLayoutEdit} onCancel={cancelLayoutEdit} onUndo={layoutDraft.undo} onRedo={layoutDraft.redo} canUndo={layoutDraft.canUndo} canRedo={layoutDraft.canRedo}
        onReset={() => { const next=defaultWorkspace(workspaceMode); layoutDraft.change({ ...next, tree:defaultDockTree(next,wiringStore.get()?.panes?.timelineFit ?? NO_PANES.timelineFit) }); }} /> : null}
    </>
  );
}
