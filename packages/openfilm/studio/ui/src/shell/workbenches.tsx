/**
 * Which workbench the project's page shows, and the workbenches themselves: the element each plugin on brings
 * (components/surfaces elementTag), put where the layout says it goes (lib/workspaces arrangementOf). One laid out
 * among the page's panels (the edit's, which draws Motion too) is put in the page with it; the canvas is put in its
 * box once warmed or shown, and kept there; any other plugin's surface takes the panes' place once picked, and is kept
 * too. Each is hidden under whatever else is shown. The notice that no workbench is on is here too. The shell holds
 * the choice (the edit or the canvas, by project as left; Motion, a view of the edit; a plugin's surface picked on the
 * top bar), tells it in the frame (shell/ProjectFrame), and tells which is shown to the wiring (shell/frame), so it
 * reaches that workbench's first.
 *
 * Where these go (the room kept round them, the canvas's own frame where the panels float) is the layout's
 * (shell/layout); what the canvas does to the film is reached through the edit's wiring (workbenches/canvas.tsx).
 */
import * as React from 'react';
import { api, projectEvents } from '@/api';
import { useT } from '@/i18n';
import { afterPaintIdle } from '@/lib/after-paint-idle';
import type { CanvasDoc } from '@/lib/canvas';
import { keyAction } from '@/lib/keymap-store';
import { useStudioPlugins } from '@/lib/plugins';
import { usePluginsOf } from '@/lib/project-plugins';
import { useWorkModes } from '@/lib/work-modes';
import { arrangementOf, type WorkspaceMode } from '@/lib/workspaces';
import { CanvasLoading } from '@/components/canvas/CanvasLoading';
import { LoadBoundary } from '@/components/canvas/LoadBoundary';
import { DOCK_GAP } from '@/components/PaneDivider';
import { elementTag, NOTE, PluginSurface } from '@/components/surfaces';
import { isTypingTarget } from '@/components/typing-target';
import type { useProjectFrame } from './ProjectFrame';
import { usePublishShown, wiringStore } from './frame';

/**
 * A panel shown or hidden, as the person last left it (kept in this browser; open when nothing is kept): the value,
 * the way to change and keep it (the person's own toggle), and the way to change it for now only (shown on its own).
 */
function useKeptFlag(key: string, initial = true): [boolean, (open: boolean) => void, React.Dispatch<React.SetStateAction<boolean>>] {
  const [open, setOpen] = React.useState(() => {
    try { const kept = localStorage.getItem(key); return kept == null ? initial : kept !== '0'; } catch { return initial; }
  });
  const keep = React.useCallback((next: boolean) => {
    setOpen(next);
    try { localStorage.setItem(key, next ? '1' : '0'); } catch { /* not kept */ }
  }, [key]);
  return [open, keep, setOpen];
}
/** whether a project shows its canvas, kept on this computer by project */
const CANVAS_KEY = 'openfilm.canvas.open';
const canvasShown = (projectId: string) => { try { return localStorage.getItem(`${CANVAS_KEY}:${projectId}`) === '1'; } catch { return false; } };
/* the plugin's surface a project was left on (its workbench's name), kept as the canvas being open is */
const SURFACE_KEY = 'openfilm.surface';
const surfacePicked = (projectId: string) => { try { return localStorage.getItem(`${SURFACE_KEY}:${projectId}`); } catch { return null; } };

/**
 * The workbench shown in the project `projectId`, and what the canvas was asked for. `canvasProject`: the project's
 * id once it was read (the canvas is warmed after that); `showError`: the toast's; `rearranging`: whether the page's
 * panels are being rearranged (shell/layout writes it).
 */
export function useWorkbenchShown(projectId: string, canvasProject: string | undefined, showError: (message: string) => void, rearranging: React.RefObject<boolean>) {
  /* the canvas over the panes, or the edit: by project, as left */
  const [canvasOpen, setCanvasOpenState] = React.useState(() => canvasShown(projectId));
  /** the canvas node a chat's reference asked to be shown (`n`: each time again) */
  const [canvasFocus, setCanvasFocus] = React.useState<{ id: string; n: number } | null>(null);
  /** a board to lay down on the canvas (an example's, copied in) */
  const [canvasAddFiles, setCanvasAddFiles] = React.useState<{ paths: string[]; n: number } | null>(null);
  const [canvasInsert, setCanvasInsert] = React.useState<{ doc: CanvasDoc; n: number } | null>(null);
  React.useEffect(() => { setCanvasOpenState(canvasShown(projectId)); }, [projectId]);
  /* the edit seen as an animation editor sees it (components/MotionTimeline), in the timeline's place */
  const [motionOpen, keepMotionOpen] = useKeptFlag('openfilm.project.motion', false);
  /* not while the page's panels are being rearranged; opening it stops the film playing (the panes under it are
     hidden): that is the workbench's, asked of it as this runs */
  const setCanvasOpen = React.useCallback((open: boolean) => {
    if (rearranging.current) return;
    if (open) wiringStore.get()?.pause?.();
    setCanvasOpenState(open);
    try { localStorage.setItem(`${CANVAS_KEY}:${projectId}`, open ? '1' : '0'); } catch { /* for this launch only */ }
  }, [projectId, rearranging]);
  const workMode: 'canvas' | 'edit' | 'motion' = canvasOpen ? 'canvas' : motionOpen ? 'motion' : 'edit';
  /* the motion view opens what it is worked in (the workbench's own panes) with it */
  const setWorkMode = React.useCallback((mode: 'canvas' | 'edit' | 'motion') => {
    setCanvasOpen(mode === 'canvas');
    if (mode !== 'canvas') keepMotionOpen(mode === 'motion');
    if (mode === 'motion') wiringStore.get()?.motionShown?.();
  }, [setCanvasOpen, keepMotionOpen]);
  /* the ways of working turned on (Settings → Advanced): one turned off while in use gives way to the first still on */
  const workModes = useWorkModes(projectId);
  /* every plugin off: no workbench is shown, only the library (and the app's chat), which opens */
  const noBench = workModes.length === 0;
  /* a plugin's own surface shown in the panes' place (components/surfaces), by its workbench's name; none: the edit
     or the canvas, which are held here. The one picked is kept for the project, and shown while its plugin is on */
  const [pickedSurface, setPickedSurface] = React.useState<string | null>(() => surfacePicked(projectId));
  React.useEffect(() => { setPickedSurface(surfacePicked(projectId)); }, [projectId]);
  const setSurface = React.useCallback((next: string | null) => {
    setPickedSurface(next);
    try { if (next) localStorage.setItem(`${SURFACE_KEY}:${projectId}`, next); else localStorage.removeItem(`${SURFACE_KEY}:${projectId}`); } catch { /* for this launch only */ }
  }, [projectId]);
  const surface = pickedSurface != null && workModes.includes(pickedSurface) ? pickedSurface : null;
  const showWorkbench = React.useCallback((mode: string) => {
    if (arrangementOf(mode) != null) { setSurface(null); setWorkMode(mode as 'canvas' | 'edit' | 'motion'); } else setSurface(mode);
  }, [setWorkMode, setSurface]);
  /* the edit and the canvas are not shown: no workbench is on, or a plugin's surface is in their place */
  const away = noBench || surface != null;
  /* the workbenches to pick from on the top bar (Motion is picked in the edit's timeline); the edit and the canvas
     alone are one button that goes from one to the other */
  const plugins = usePluginsOf(projectId);
  const benchPlugins = React.useMemo(() => plugins.filter((p) => p.on && p.workbench && p.workbench !== 'motion'), [plugins]);
  const pickBench = benchPlugins.length > 1 && benchPlugins.some((p) => arrangementOf(p.workbench!) == null);
  const canToggleCanvas = workModes.includes('canvas') && workModes.length > 1;
  /* one turned off while in use gives way to the first still on */
  React.useEffect(() => {
    if (surface == null && workModes.length && !workModes.includes(workMode)) showWorkbench(workModes[0]!);
  }, [workModes, workMode, surface, showWorkbench]);
  /* the workbench shown, told to the wiring (shell/frame): what the shell reaches is that workbench's first */
  usePublishShown(noBench ? null : surface ?? (canvasOpen ? 'canvas' : 'edit'));
  /*
   * The elements of the plugins on, by where the layout puts them: the first plugin on that is laid out there
   * (`on`), and the module of its element (null: none, or not known yet). Where a module is is known once Studio has
   * said it (`pluginsRead`): what this browser kept is of an earlier launch, whose addresses have changed.
   */
  const pluginsRead = useStudioPlugins() !== null;
  const arranged = React.useMemo(() => {
    const of = (arrangement: WorkspaceMode) => {
      const there = plugins.filter((p) => p.on && p.workbench && arrangementOf(p.workbench) === arrangement);
      return { on: there.length > 0, element: (pluginsRead ? there.find((p) => p.element)?.element : null) ?? null };
    };
    return { edit: of('edit'), canvas: of('canvas') };
  }, [plugins, pluginsRead]);
  /* what an agent lays out on the canvas (`openfilm canvas apply`) is shown: the canvas opens on it */
  React.useEffect(() => projectEvents(projectId, (event) => { if (event.type === 'canvas') setCanvasOpen(true); }), [projectId, setCanvasOpen]);
  /* warmed in place, then kept hidden under the edit: opening it never reloads or refits the same board */
  const [canvasKept, setCanvasKept] = React.useState(canvasOpen);
  React.useEffect(() => { if (canvasOpen) setCanvasKept(true); }, [canvasOpen]);
  React.useEffect(() => { setCanvasKept(canvasShown(projectId)); }, [projectId]);
  /*
   * OpenFilm's own workbenches that are not in the page yet are warmed (their elements' modules loaded) once this
   * project has opened and the page has painted, while it is visible: the canvas is then put in its box, hidden. A
   * plugin someone made is loaded only when first shown. Each: its module, and whether it is the canvas's.
   */
  const toWarm = JSON.stringify((pluginsRead ? plugins : []).filter((p) => !p.skill && p.on && p.workbench && p.element && arrangementOf(p.workbench) !== 'edit'
    && (arrangementOf(p.workbench) === 'canvas' ? !canvasKept : p.workbench !== surface)).map((p) => [p.element, arrangementOf(p.workbench!) === 'canvas']));
  React.useEffect(() => {
    if (!canvasProject || toWarm === '[]') return;
    let live = true;
    let cancel = () => {};
    const warm = () => {
      cancel();
      if (document.hidden) return;
      cancel = afterPaintIdle(() => {
        for (const [url, canvas] of JSON.parse(toWarm) as [string, boolean][]) {
          void elementTag(url).then(() => {
            if (canvas && live && !document.hidden) React.startTransition(() => setCanvasKept(true));
          }, () => {});
        }
      });
    };
    warm();
    document.addEventListener('visibilitychange', warm);
    return () => { live = false; cancel(); document.removeEventListener('visibilitychange', warm); };
  }, [canvasProject, toWarm]);
  /* the edit or the canvas, from either (keymap `work-mode`, ⌘E): not while typing, nor over a dialog */
  const workModeRef = React.useRef(() => {});
  workModeRef.current = () => { if (surface != null) setSurface(null); else if (canToggleCanvas) setCanvasOpen(!canvasOpen); };
  React.useEffect(() => {
    const press = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.repeat || keyAction(event) !== 'work-mode' || isTypingTarget(el) || el?.closest?.('[role="dialog"]')) return;
      /* a dialog of the canvas's open (a redraw, a library): it has the keys until it closes */
      if (document.querySelector('[data-studio-canvas] [role="dialog"]')) return;
      event.preventDefault();
      workModeRef.current();
    };
    window.addEventListener('keydown', press, true);
    return () => window.removeEventListener('keydown', press, true);
  }, []);
  /* files asked onto the canvas (the library's "+" while the canvas is shown): one of Saved is brought into the
     project first */
  const requestCanvasFiles = React.useCallback(async (path: string, saved = false) => {
    try {
      let paths = [path];
      if (saved) {
        const taken = await api.takeSaved(projectId, path);
        paths = 'path' in taken ? [taken.path] : 'clip' in taken ? [taken.clip.src] : taken.clips.map(item => item.clip.src);
      }
      setCanvasAddFiles({ paths: [...new Set(paths)], n: performance.now() });
    } catch (error) { showError(error instanceof Error ? error.message : String(error)); }
  }, [projectId, showError]);

  return {
    canvasOpen, setCanvasOpen, motionOpen, workMode, setWorkMode, workModes, noBench, surface, showWorkbench, away,
    benchPlugins, pickBench, canToggleCanvas, pluginsRead, arranged,
    canvasKept, canvasFocus, setCanvasFocus, canvasInsert, setCanvasInsert, canvasAddFiles, requestCanvasFiles,
  };
}

/** A place of the page's that takes no room of its own: what is put in it is laid out as its parent's. */
const PLACE = { display: 'contents' } as const;
/* how a workbench kept in the page is hidden while another is shown: with opacity too, as the canvas's library
   writes `visibility: visible` on each of its nodes */
const HIDDEN = { visibility: 'hidden', opacity: 0, zIndex: 0 } as const;

/** What a module that could not be loaded threw, thrown again where a boundary catches it as it caught a lazy view's. */
function Thrown({ error }: { error: string }): never {
  throw new Error(error);
}

/**
 * A plugin's element in the page: its module (`url`) loaded (components/surfaces elementTag) once the frame is told
 * with its places (`ready`), and one element of it put in a place that takes no room, told the project by
 * `project-id`. Before it while the module loads: `loading`; if it cannot be loaded: `failed`. Another module whose
 * element has the same tag (two plugins that bring one workbench, as the edit's and Motion's do) keeps the element
 * there; it is taken out when this is.
 */
function PluginElement({ url, projectId, ready, loading, failed }: {
  url: string; projectId: string; ready: boolean; loading: React.ReactNode; failed: (error: string) => React.ReactNode;
}) {
  const host = React.useRef<HTMLDivElement>(null);
  const put = React.useRef<{ tag: string; projectId: string; element: HTMLElement } | null>(null);
  const [state, setState] = React.useState<'loading' | 'shown' | { error: string }>('loading');
  React.useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    elementTag(url).then((tag) => {
      if (!live || !host.current) return;
      if (put.current?.tag !== tag || put.current.projectId !== projectId) {
        put.current?.element.remove();
        const element = document.createElement(tag);
        element.setAttribute('project-id', projectId);
        host.current.append(element);
        put.current = { tag, projectId, element };
      }
      setState('shown');
    }, (e) => { if (live) setState({ error: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [url, projectId, ready]);
  React.useEffect(() => () => { put.current?.element.remove(); put.current = null; }, []);
  return (
    <>
      {state === 'loading' ? loading : typeof state === 'object' ? failed(state.error) : null}
      <div ref={host} style={PLACE} />
    </>
  );
}

/**
 * The element laid out among the page's panels (the edit's: lib/workspaces arrangementOf), where the panes are: put
 * in the page as soon as a plugin laid out there is on and Studio has said where its module is, and taken out when
 * none is on. One that cannot be loaded, or that this build has nothing of, says so in the panes' place.
 */
export function AmongPanes({ frame }: { frame: ReturnType<typeof useProjectFrame> }) {
  const t = useT();
  const { projectId, arranged, pluginsRead } = frame;
  const { on, element } = arranged.edit;
  if (!on) return null;
  if (!element) return pluginsRead ? <p className={NOTE} style={{ gridArea: 'main' }}>{t('assetDrawer.surfaceMissing')}</p> : null;
  return <PluginElement url={element} projectId={projectId} ready loading={null}
    failed={(error) => <p className={NOTE} style={{ gridArea: 'main' }}>{`${t('assetDrawer.surfaceFailed')}\n\n${error}`}</p>} />;
}

/**
 * What takes the panes' place, drawn in the page's grid after the element among them: the plugins' surfaces picked
 * (each kept once shown, until its plugin is turned off, hidden while another workbench is shown), the notice that no
 * workbench is on, and the canvas's box with its element (kept there once warmed or opened, hidden while it is not
 * shown). They are drawn once the project was read, where the layout says (shell/layout), with a workbench in the
 * page or none.
 */
export function InPanesPlace({ frame }: { frame: ReturnType<typeof useProjectFrame> }) {
  const t = useT();
  const {
    projectId, loaded, failure, slots,
    surface, benchPlugins, noBench, away, canvasOpen, canvasKept, arranged, pluginsRead,
    editFree, canvasFree, editDock, canvasDock, insetStyle, freeStyle,
  } = frame;
  /* how the window is laid out round these: the room kept round the panes with the edit shown and with the canvas
     shown (none where the panels float), and the canvas's own frame where they float */
  const places = React.useMemo(() => ({ edit: editFree ? {} : insetStyle(editDock), canvas: canvasFree ? {} : insetStyle(canvasDock), canvasFrame: freeStyle('canvas') }), [editFree, canvasFree, editDock, canvasDock, insetStyle, freeStyle]);
  /* the plugins' surfaces shown in this project, in the order they were first shown: kept while their plugin is on */
  const [kept, setKept] = React.useState<{ of: string; surfaces: readonly string[] }>({ of: projectId, surfaces: [] });
  const was = kept.of === projectId ? kept.surfaces : [];
  const surfaces = was.filter((name) => benchPlugins.some((p) => p.workbench === name));
  if (surface != null && !surfaces.includes(surface)) surfaces.push(surface);
  if (kept.of !== projectId || surfaces.length !== was.length || surfaces.some((name, i) => name !== was[i])) setKept({ of: projectId, surfaces });
  if (!loaded || failure) return null;
  /* the room the layout keeps round the panes, with the edit shown or the canvas: the same round these */
  const room = canvasOpen ? places.canvas : places.edit;
  return (
    <>
      {/* a plugin's own surface in the panes' place, as the canvas is: they stay laid out as they were, hidden under it */}
      {surfaces.map((name) => {
        const plugin = benchPlugins.find((p) => p.workbench === name);
        const hidden = name !== surface;
        return (
          <div key={name} data-workspace-surface={name} className="relative z-[3] flex min-h-0 min-w-0 bg-[var(--dock-line)]" aria-hidden={hidden || undefined} inert={hidden || undefined}
            style={{ gridArea: 'main', paddingTop: DOCK_GAP, ...room, ...(hidden ? HIDDEN : null) }}>
            <div className="relative flex min-h-0 min-w-0 flex-1 bg-[var(--bg-panel)]">
              <PluginSurface id={name} page={plugin?.page} files={plugin?.files} program={plugin?.program} runs={plugin?.runs} inApp={plugin?.inApp} element={plugin?.element} hidden={hidden} projectId={projectId} folder={loaded?.project.path ?? ''} />
            </div>
          </div>
        );
      })}
      {/* no workbench on: where one would be says so, over the panes (and the canvas), which stay as they were */}
      {noBench ? (
        <div data-workspace-empty className="relative z-[3] flex min-h-0 min-w-0 items-center justify-center bg-[var(--bg-panel)] px-8 text-center text-[13px] leading-relaxed text-[var(--text-muted)]"
          style={{ gridArea: 'main', ...room }}>
          <p className="max-w-[360px]">{t('assetDrawer.noPluginsOn')}</p>
        </div>
      ) : null}
      {/* the canvas in the panes' place: they stay laid out as they were, hidden under it; the gaps round it are the
          panes' lines (the one under the top bar, the one by the chat) */}
      {(canvasKept || canvasOpen) && arranged.canvas.on ? (
        <div data-workspace-canvas className="relative z-[2] flex min-h-0 min-w-0 bg-[var(--dock-line)]" aria-hidden={!canvasOpen || away} inert={!canvasOpen || away}
          style={{ gridArea: 'main', paddingTop: DOCK_GAP, ...places.canvas, ...places.canvasFrame, ...(canvasOpen && !away ? null : HIDDEN) }}>
          <div className="relative min-h-0 min-w-0 flex-1 bg-[var(--bg-panel)]">
            {arranged.canvas.element ? (
              <PluginElement url={arranged.canvas.element} projectId={projectId} ready={Boolean(slots)} loading={<CanvasLoading />}
                failed={(error) => <LoadBoundary title={t('canvas.loadFailed')} action={t('canvas.reload')}><Thrown error={error} /></LoadBoundary>} />
            ) : pluginsRead ? <p className={NOTE}>{t('assetDrawer.surfaceMissing')}</p> : <CanvasLoading />}
          </div>
        </div>
      ) : null}
    </>
  );
}
