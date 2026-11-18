/**
 * How the project's page is laid out: one arrangement for each workbench laid out in it (lib/workspaces), of the app's
 * chat panel, the library and the blocks the workbench declares (lib/blocks: the edit's viewer, layers, inspector and
 * timeline, the canvas's board, a plugin's own and those it borrows). The shell holds it: the arrangements as stored
 * and the one being rearranged, the app's own panel (lib/host.ts `panel`) kept in step with them, where every panel and
 * block is in the window, the library opened or closed, the layout's menu on the top bar, and the seams and the editor
 * drawn over the page. The blocks of the arrangement among the page's panels are laid out here too (shell/arrangement),
 * each in a slot its workbench draws into; the canvas's board in its own box (shell/workbenches).
 *
 * How a workbench's blocks are drawn where the panels are docked (the edit's timeline fitted to its tracks, its
 * inspector left out of a narrow window while idle) is the workbench's, told through its wiring (`blocks`, a sizer);
 * without one, each block is drawn as declared.
 */
import * as React from 'react';
import { useLanguage, useT } from '@/i18n';
import { blockTitle } from '@/lib/blocks';
import { HOST_PANEL_WIDTH, studioHost, useHostPanel } from '@/lib/host';
import { useStudioPlugins } from '@/lib/plugins';
import { useWorkspaceDraft, useWorkspaceLayouts } from '@/lib/use-workspaces';
import { defaultDockTree, dockFrames, panelMinimum, visibleDockPanels, type DockRect } from '@/lib/workspace-dock';
import { dockedSizes, type BlockRoom, type DrawnBlock } from '@/lib/workspace-preview';
import { centerOf, defaultWorkspace, workspaceChatWidth, workspaceGeometry, type ArrangementSpec, type BlockPlace, type BlockSpec, type WorkspaceLayout } from '@/lib/workspaces';
import { ProjectLayoutMenu } from '@/components/ProjectLayoutMenu';
import { WorkspaceEditor, WorkspaceSeams } from '@/components/WorkspaceEditor';
import type { useProjectFrame } from './ProjectFrame';
import { useSteady, useWiringsOf } from './frame';
import { HOST_PANEL_TOP } from './library';

/** `value`, the same one until what it holds changes (compared as JSON): the frame is not told anew by every render. */
function useSame<T>(value: T): T {
  const key = JSON.stringify(value);
  return React.useMemo(() => value, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The room a docked arrangement keeps round the panes (for the app's panel, for the library docked beside them). */
const insetStyle = ({ inset }: ReturnType<typeof workspaceGeometry>): React.CSSProperties => ({ marginLeft: inset.left, marginRight: inset.right, marginBottom: inset.bottom });
/** A block's box where the panels float; none where they are docked. */
const freeBox = (rect: { left: number; top: number; width: number; height: number } | undefined): React.CSSProperties =>
  (rect ? { position: 'fixed', zIndex: 30, ...rect, paddingTop: 0, borderTop: rect.top === HOST_PANEL_TOP ? '1px solid var(--dock-line)' : 0 } : {});
/** An arrangement whose blocks are not known yet (its plugin not listed): the page's own blocks only. */
const UNKNOWN = new Map<string, ArrangementSpec>();
const unknownSpec = (name: string): ArrangementSpec => { let spec = UNKNOWN.get(name); if (!spec) UNKNOWN.set(name, spec = { name, blocks: [] }); return spec; };

/**
 * The layout of the project's page. `canvasOpen`: the canvas is shown (it has its own arrangement); `noBench`: no
 * workbench is on; `among`: the arrangement laid out among the page's panels (the edit's, or the one of the workbench
 * shown there); `specs`: every arrangement's blocks (lib/blocks); `inPage`: whether a workbench draws its blocks now
 * (its plugin on); `rearranging`: written here, whether the panels are being rearranged (the workbench shown stays the
 * one it is meanwhile, shell/workbenches).
 */
export function useLayout(of: { canvasOpen: boolean; noBench: boolean; among: string; specs: ReadonlyMap<string, ArrangementSpec>; inPage: (workbench: string) => boolean; rearranging: React.RefObject<boolean> }) {
  const { canvasOpen, noBench, among, specs, inPage, rearranging } = of;
  const t = useT();
  const language = useLanguage();
  /* the workspace's own setter, made further down */
  const updateWorkspaceRef = React.useRef<(patch: Partial<WorkspaceLayout>) => void>(() => {});
  /* every plugin off: no workbench is shown, only the library (and the app's chat), which opens. Once Studio has said
     which plugins are on: what this browser kept of them is of an earlier launch */
  const pluginsRead = useStudioPlugins() !== null;
  React.useEffect(() => { if (noBench && pluginsRead) updateWorkspaceRef.current({ assets: true }); }, [noBench, pluginsRead]);

  /* ── layout ── */
  const workspaceMode = canvasOpen ? 'canvas' : among;
  const specOf = React.useCallback((name: string) => specs.get(name) ?? unknownSpec(name), [specs]);
  const shownSpec = specOf(workspaceMode), amongSpec = specOf(among), canvasSpec = specOf('canvas');
  const { layout: storedWorkspace, layoutOf, update: commitWorkspace, viewport: workspaceViewport, storageFailed: workspaceStorageFailed } = useWorkspaceLayouts(workspaceMode, specs);
  const layoutDraft = useWorkspaceDraft();
  const workspacePrefs = layoutDraft.draft ?? storedWorkspace;
  const amongPrefs = workspaceMode === among ? workspacePrefs : layoutOf(among);
  const canvasPrefs = workspaceMode === 'canvas' ? workspacePrefs : layoutOf('canvas');
  rearranging.current = layoutDraft.draft !== null;
  const updateWorkspace = React.useCallback((patch: Partial<WorkspaceLayout>) => {
    if (layoutDraft.active.current) layoutDraft.update(patch); else commitWorkspace(patch);
  }, [layoutDraft.active, layoutDraft.update, commitWorkspace]);
  updateWorkspaceRef.current = updateWorkspace;
  /* a block of the arrangement shown changed (shown or hidden, sized): one it does not have is left alone */
  const placeRef = React.useRef({ layout: workspacePrefs, spec: shownSpec });
  placeRef.current = { layout: workspacePrefs, spec: shownSpec };
  const placeBlock = React.useCallback((key: string, patch: Partial<BlockPlace>) => {
    const { layout, spec } = placeRef.current;
    const place = layout.blocks[key];
    if (!place || !spec.blocks.some((b) => b.key === key)) return;
    updateWorkspace({ blocks: { [key]: { ...place, ...patch } } });
  }, [updateWorkspace]);
  /* a block by its workbench and id, as the arrangement shown names it */
  const openBlock = React.useCallback((owner: string, id: string, open: boolean) => {
    const block = placeRef.current.spec.blocks.find((b) => b.owner === owner && b.id === id);
    if (block && block !== centerOf(placeRef.current.spec)) placeBlock(block.key, { open });
  }, [placeBlock]);
  const assetsPaneOpen = workspacePrefs.assets;
  /* a block is drawn when its workbench is in the page (one of another workbench's whose plugin is off is not) */
  const drawnIn = React.useCallback((spec: ArrangementSpec) => (key: string) => { const block = spec.blocks.find((b) => b.key === key); return !block || block.owner === spec.name || inPage(block.owner); }, [inPage]);
  /* where the panels float (an arrangement with a tree of splits): each panel's box in the window; null when docked */
  const amongFree = React.useMemo(() => (amongPrefs.tree ? dockFrames(amongPrefs.tree, workspaceViewport, visibleDockPanels(amongPrefs, Boolean(studioHost?.panel), amongSpec, drawnIn(amongSpec)), panelMinimum(amongSpec)) : null), [amongPrefs, amongSpec, workspaceViewport, drawnIn]);
  const canvasFree = React.useMemo(() => (canvasPrefs.tree ? dockFrames(canvasPrefs.tree, workspaceViewport, visibleDockPanels(canvasPrefs, Boolean(studioHost?.panel), canvasSpec), panelMinimum(canvasSpec)) : null), [canvasPrefs, canvasSpec, workspaceViewport]);
  const freeGeometry = canvasOpen ? canvasFree : amongFree;

  /* ── the blocks among the page's panels where they are docked: the room they share, measured where they are drawn
     (shell/arrangement), and each as its workbench draws it there ── */
  const [blockRoom, setBlockRoom] = React.useState<BlockRoom>({ width: 0, height: 0 });
  const sizers = useWiringsOf('blocks');
  const seamLabel = React.useCallback((block: BlockSpec) => t('layout.resizeBlock').replace('{name}', blockTitle(block, language)), [t, language]);
  const sizesOf = React.useCallback((spec: ArrangementSpec, layout: WorkspaceLayout, room: BlockRoom, free: Readonly<Partial<Record<string, DockRect>>> | null) =>
    dockedSizes(spec, layout, room, free, (owner) => sizers.get(owner), seamLabel), [sizers, seamLabel]);
  const amongDrawn = useSame(React.useMemo(() => sizesOf(amongSpec, amongPrefs, blockRoom, amongFree?.panels ?? null), [sizesOf, amongSpec, amongPrefs, blockRoom, amongFree]));
  /* the arrangement among the panels as its workbenches read it (shell/frame): its blocks, their places, the room they
     share and their boxes where the panels float */
  const arrangement = React.useMemo(() => ({ spec: amongSpec, layout: amongPrefs, room: blockRoom, free: amongFree?.panels ?? null }), [amongSpec, amongPrefs, blockRoom, amongFree]);

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
  const resetWorkspace = () => applyWorkspace(defaultWorkspace(shownSpec));
  /* begun from the panes as they are drawn now: the blocks among the panels as drawn (none: as stored) */
  const beginLayoutEdit = () => {
    const drawn = workspaceMode === among ? Object.fromEntries(Object.entries(amongDrawn).map(([key, block]) => [key, block.size])) : {};
    layoutDraft.begin({ ...workspaceLayout, tree: workspaceLayout.tree ?? defaultDockTree({ ...workspaceLayout, chatWidth: hostPanel?.width || workspaceLayout.chatWidth }, shownSpec, drawn) });
  };
  const cancelLayoutEdit = () => { layoutDraft.close(); applyHostWorkspace(storedWorkspace); };
  const finishLayoutEdit = () => { const next = layoutDraft.draft; if (!next) return; layoutDraft.close(); commitWorkspace(next); applyHostWorkspace(next); };
  /* the arrangement shown as it first is, its panels floating: its blocks fitted to their content (none: as declared) */
  const resetLayoutEdit = () => {
    const next = defaultWorkspace(shownSpec);
    const fits = workspaceMode === among ? Object.fromEntries(Object.entries(amongDrawn).flatMap(([key, block]) => (block.fit != null ? [[key, block.fit]] : []))) : {};
    layoutDraft.change({ ...next, tree: defaultDockTree(next, shownSpec, fits) });
  };
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
  const amongDock = useSame(dockOf(amongPrefs));
  const canvasDock = useSame(dockOf(canvasPrefs));
  const dockGeometry = canvasOpen ? canvasDock : amongDock;
  const chatWidth = dockGeometry.inset[workspacePrefs.chatSide];
  const chatLibraryRect = chatBounds ?? { left: workspacePrefs.chatSide === 'right' ? workspaceViewport.width - chatWidth : 0,
    top: HOST_PANEL_TOP, width: chatWidth, height: workspaceViewport.height - HOST_PANEL_TOP };
  const independentLibrary = workspacePrefs.libraryDock !== 'chat' || !hostAssets;
  const libraryOpen = independentLibrary ? assetsPaneOpen : Boolean(hostAssets?.open);
  const openLibrary = (open: boolean) => { updateWorkspace({ assets: open }); hostAssets?.setOpen(open); };

  /* how the panes and the canvas's box are placed: the room kept round them where the panels are docked, and the
     canvas's box where they float */
  /* beside the app's panel, its side follows the panel's width the moment the app tells it (--host-panel-width, before
     React renders this), so a fast drag of the panel's seam leaves no gap between the two */
  const besidePanel = (style: React.CSSProperties, dock: ReturnType<typeof workspaceGeometry>, layout: WorkspaceLayout): React.CSSProperties => {
    const panel = layout.mode === workspaceMode && !layout.tree && hostPanel?.open ? hostPanel.width : 0;
    const side = layout.chatSide;
    const rest = dock.inset[side] - panel;
    return panel && rest >= 0 ? { ...style, [side === 'left' ? 'marginLeft' : 'marginRight']: `calc(${HOST_PANEL_WIDTH} + ${rest}px)` } : style;
  };
  const places = React.useMemo(() => ({
    among: amongFree ? {} : besidePanel(insetStyle(amongDock), amongDock, amongPrefs),
    canvas: canvasFree ? {} : besidePanel(insetStyle(canvasDock), canvasDock, canvasPrefs),
    canvasFrame: freeBox(canvasFree?.panels[centerOf(canvasSpec)?.key ?? 'canvas']),
  }), [amongFree, canvasFree, amongDock, canvasDock, canvasSpec, amongPrefs, canvasPrefs, workspaceMode, hostPanel?.open, hostPanel?.width]); // eslint-disable-line react-hooks/exhaustive-deps
  const blockBox = React.useCallback((key: string) => freeBox(amongFree?.panels[key]), [amongFree]);

  /* ── what the shell draws with, and what a workbench is told: each the same one until it changes ── */
  /* the app's own panel beside the panes (none: the app has no such panel): whether it is open, and the way to open or fold it */
  const chatThere = Boolean(hostPanel);
  const chatOpen = Boolean(hostPanel?.open);
  const does = useSteady({
    applyWorkspace, resetWorkspace, beginLayoutEdit, cancelLayoutEdit, finishLayoutEdit, resetLayoutEdit, openLibrary,
    toggleChat: () => hostPanel?.setOpen(!chatOpen),
    /* sizes the app's panel (`done`: the drag is over) */
    setPanelWidth: (width: number, done?: boolean) => { hostPanel?.setWidth(width, done); },
  });
  const chat = React.useMemo(() => (chatThere ? { open: chatOpen, toggle: does.toggleChat } : undefined), [chatThere, chatOpen, does]);
  /* where the library's pane is: docked on its own, or in the app's panel over the chat, with the seam that sizes the
     panel while the pane covers it. Open or not, the side it is docked on and its box, `free` when the panels float,
     how much of its foot the app's composer covers (`under`; `beside`, beside the way back to the chat), and that seam
     (null: none) */
  const libraryPane = useSame({
    open: libraryOpen, dock: independentLibrary ? dockGeometry.dock : 'chat' as const,
    rect: independentLibrary ? freeGeometry?.panels.library ?? dockGeometry.library : chatLibraryRect,
    free: Boolean(freeGeometry), under: !independentLibrary ? hostAssets?.bottom ?? 0 : 0, beside: !independentLibrary ? hostAssets?.beside ?? 0 : 0,
    seam: !freeGeometry && !independentLibrary && hostAssets?.open && hostPanel ? { label: hostPanel.label, width: hostPanel.width, bottom: hostAssets.bottom, side: workspacePrefs.chatSide } : null,
  });
  const layoutEditing = Boolean(layoutDraft.draft);
  const { draft, canUndo, canRedo, checkpoint, change, undo, redo } = layoutDraft;
  /* the arrangement being rearranged (`draft`; null: none is), and its steps taken back and again */
  const rearranged = React.useMemo(() => ({ draft, canUndo, canRedo, checkpoint, change, undo, redo }), [draft, canUndo, canRedo, checkpoint, change, undo, redo]);
  /* each preset of the menu as the window would show it: its blocks as their workbenches draw them */
  const previewSizes = React.useCallback((layout: WorkspaceLayout, room: BlockRoom): Readonly<Record<string, DrawnBlock>> => sizesOf(specOf(layout.mode), layout, room, null), [sizesOf, specOf]);

  return {
    workspaceMode, workspacePrefs, shownSpec, workspaceLayout: useSame(workspaceLayout), workspaceViewport, workspaceStorageFailed,
    layoutDraft: rearranged, layoutEditing, updateWorkspace, placeBlock, openBlock, previewSizes,
    amongFree, canvasFree, freeGeometry, amongDock, canvasDock, places, blockBox, arrangement, amongDrawn, setBlockRoom, drawnIn,
    chat, chatThere, libraryPane,
    applyWorkspace: does.applyWorkspace, resetWorkspace: does.resetWorkspace, beginLayoutEdit: does.beginLayoutEdit,
    cancelLayoutEdit: does.cancelLayoutEdit, finishLayoutEdit: does.finishLayoutEdit, resetLayoutEdit: does.resetLayoutEdit, openLibrary: does.openLibrary, setPanelWidth: does.setPanelWidth,
  };
}

/**
 * The layout's menu, the first of the buttons on the right of the top bar (`className`: the bar's buttons'): the
 * arrangements to pick from, each drawn as the window would be, and the way into rearranging. The same one until what
 * it shows changes.
 */
export function LayoutMenu({ frame, className }: { frame: ReturnType<typeof useProjectFrame>; className: string }) {
  const { workspaceLayout, shownSpec, applyWorkspace, resetWorkspace, beginLayoutEdit, chatThere, workspaceViewport, layoutEditing, workspaceStorageFailed, previewSizes, benchPlugins } = frame;
  /* the words of the workbench whose arrangement it is (one someone made is not among OpenFilm's own plugins) */
  const title = benchPlugins.find((p) => p.workbench === workspaceLayout.mode)?.title;
  return React.useMemo(() => (
    <ProjectLayoutMenu className={className}
      value={workspaceLayout} spec={shownSpec} title={title} onChange={applyWorkspace} onReset={resetWorkspace}
      hasChat={chatThere} viewport={workspaceViewport} sizes={previewSizes} onEdit={beginLayoutEdit} layoutEditing={layoutEditing} storageFailed={workspaceStorageFailed} />
  ), [className, workspaceLayout, shownSpec, title, applyWorkspace, resetWorkspace, chatThere, workspaceViewport, previewSizes, beginLayoutEdit, layoutEditing, workspaceStorageFailed]);
}

/**
 * Over the page: the seams between the panels where they float, and the editor while they are rearranged. Drawn once
 * the project was read.
 */
export function LayoutOver({ frame }: { frame: ReturnType<typeof useProjectFrame> }) {
  const { loaded, failure, workspacePrefs, shownSpec, benchPlugins, freeGeometry, layoutDraft, updateWorkspace, chatThere, finishLayoutEdit, cancelLayoutEdit, resetLayoutEdit } = frame;
  if (!loaded || failure) return null;
  return (
    <>
      {freeGeometry && workspacePrefs.tree ? <WorkspaceSeams tree={workspacePrefs.tree} frames={freeGeometry} editing={Boolean(layoutDraft.draft)} onChange={tree => updateWorkspace({ tree })} onCheckpoint={layoutDraft.draft ? layoutDraft.checkpoint : undefined} /> : null}
      {layoutDraft.draft && freeGeometry ? <WorkspaceEditor value={layoutDraft.draft} spec={shownSpec} title={benchPlugins.find((p) => p.workbench === layoutDraft.draft!.mode)?.title} frames={freeGeometry} hasChat={chatThere} onChange={layoutDraft.change}
        onDone={finishLayoutEdit} onCancel={cancelLayoutEdit} onUndo={layoutDraft.undo} onRedo={layoutDraft.redo} canUndo={layoutDraft.canUndo} canRedo={layoutDraft.canRedo}
        onReset={resetLayoutEdit} /> : null}
    </>
  );
}
