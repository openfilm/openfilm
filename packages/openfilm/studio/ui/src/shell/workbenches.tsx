/**
 * Which workbench the project's page shows, and what takes the panes' place when it is not the edit: the canvas, a
 * plugin's own surface, or the notice that no workbench is on. The shell holds the choice (the edit or the canvas, by
 * project as left; Motion, a view of the edit; a plugin's surface picked on the top bar) and tells it in the frame
 * (shell/ProjectFrame); the edit draws its panes hidden under whatever else is shown.
 *
 * For now the window is still laid out by the edit, so where these go (the room kept round them, the canvas's own
 * frame) and what the canvas does to the film are reached through the wiring (shell/frame).
 */
import * as React from 'react';
import { api, projectEvents } from '@/api';
import { useT } from '@/i18n';
import { afterPaintIdle } from '@/lib/after-paint-idle';
import type { CanvasDoc } from '@/lib/canvas';
import { studioHost } from '@/lib/host';
import { keyAction } from '@/lib/keymap-store';
import { usePluginsOf } from '@/lib/project-plugins';
import { useWorkModes } from '@/lib/work-modes';
import { loadCanvas } from '@/components/canvas/load';
import { CanvasLoading } from '@/components/canvas/CanvasLoading';
import { LoadBoundary } from '@/components/canvas/LoadBoundary';
import { DOCK_GAP } from '@/components/PaneDivider';
import { OWN_SURFACES, PluginSurface } from '@/components/surfaces';
import { isTypingTarget } from '@/components/typing-target';
import type { useProjectFrame } from './ProjectFrame';
import { useWiring, wiringStore } from './frame';

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
/* the canvas beside the edit: its code and fitted layout are warmed while the edit is in use */
const CanvasView = React.lazy(loadCanvas);
/** whether a project shows its canvas, kept on this computer by project */
const CANVAS_KEY = 'openfilm.canvas.open';
const canvasShown = (projectId: string) => { try { return localStorage.getItem(`${CANVAS_KEY}:${projectId}`) === '1'; } catch { return false; } };
/* the plugin's surface a project was left on (its workbench's name), kept as the canvas being open is */
const SURFACE_KEY = 'openfilm.surface';
const surfacePicked = (projectId: string) => { try { return localStorage.getItem(`${SURFACE_KEY}:${projectId}`); } catch { return null; } };

/**
 * The workbench shown in the project `projectId`, and what the canvas was asked for. `canvasProject`: the project's
 * id once it was read (the canvas is warmed after that); `showError`: the toast's.
 */
export function useWorkbenchShown(projectId: string, canvasProject: string | undefined, showError: (message: string) => void) {
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
  /* not while the workbench's panes are being rearranged; opening it stops the film playing (the panes under it are
     hidden): both are the workbench's, asked of it as this runs */
  const setCanvasOpen = React.useCallback((open: boolean) => {
    if (wiringStore.get()?.rearranging?.()) return;
    if (open) wiringStore.get()?.pause?.();
    setCanvasOpenState(open);
    try { localStorage.setItem(`${CANVAS_KEY}:${projectId}`, open ? '1' : '0'); } catch { /* for this launch only */ }
  }, [projectId]);
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
    if (mode === 'canvas' || mode === 'edit' || mode === 'motion') { setSurface(null); setWorkMode(mode); } else setSurface(mode);
  }, [setWorkMode, setSurface]);
  /* the edit and the canvas are not shown: no workbench is on, or a plugin's surface is in their place */
  const away = noBench || surface != null;
  /* the workbenches to pick from on the top bar (Motion is picked in the edit's timeline); the edit and the canvas
     alone are one button that goes from one to the other */
  const plugins = usePluginsOf(projectId);
  const benchPlugins = React.useMemo(() => plugins.filter((p) => p.on && p.workbench && p.workbench !== 'motion'), [plugins]);
  const surfacePlugin = surface != null ? benchPlugins.find((p) => p.workbench === surface) : undefined;
  const pickBench = benchPlugins.length > 1 && benchPlugins.some((p) => !OWN_SURFACES.includes(p.workbench!));
  const canToggleCanvas = workModes.includes('canvas') && workModes.length > 1;
  /* what an agent lays out on the canvas (`openfilm canvas apply`) is shown: the canvas opens on it */
  React.useEffect(() => projectEvents(projectId, (event) => { if (event.type === 'canvas') setCanvasOpen(true); }), [projectId, setCanvasOpen]);
  /* warmed in place, then kept hidden under the edit: opening it never reloads or refits the same board */
  const [canvasKept, setCanvasKept] = React.useState(canvasOpen);
  React.useEffect(() => { if (canvasOpen) setCanvasKept(true); }, [canvasOpen]);
  React.useEffect(() => { setCanvasKept(canvasShown(projectId)); }, [projectId]);
  /* Only the current visible project's board, after the project has opened and the UI has painted. */
  React.useEffect(() => {
    if (!canvasProject || canvasKept) return;
    let live = true;
    let cancel = () => {};
    const warm = () => {
      cancel();
      if (document.hidden) return;
      cancel = afterPaintIdle(() => {
        void loadCanvas().then(() => {
          if (live && !document.hidden) React.startTransition(() => setCanvasKept(true));
        }, () => {});
      });
    };
    warm();
    document.addEventListener('visibilitychange', warm);
    return () => { live = false; cancel(); document.removeEventListener('visibilitychange', warm); };
  }, [canvasProject, canvasKept]);
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
    benchPlugins, surfacePlugin, pickBench, canToggleCanvas,
    canvasKept, canvasFocus, setCanvasFocus, canvasInsert, setCanvasInsert, canvasAddFiles, requestCanvasFiles,
  };
}

/**
 * What takes the panes' place, drawn in the page's grid after the workbench's element: a plugin's surface, the notice
 * that no workbench is on, and the canvas (kept there once warmed or opened, hidden while it is not shown). They are
 * drawn while a workbench is in the page (its wiring says where they go) and the project was read.
 */
export function InPanesPlace({ frame }: { frame: ReturnType<typeof useProjectFrame> }) {
  const t = useT();
  const wiring = useWiring('places', 'chat');
  const {
    projectId, loaded, failure, folder, listing, mediaSources, onImport, toast, showFile,
    surface, surfacePlugin, noBench, away, canvasOpen, canvasKept, canvasFocus, canvasInsert, canvasAddFiles,
  } = frame;
  const canvasFiles = React.useMemo(() => (listing ? [...listing.files, ...listing.pages] : []), [listing]);
  if (!wiring || !loaded || failure) return null;
  /* the room the workbench's layout keeps round its panes, with the edit shown or the canvas: the same round these */
  const room = canvasOpen ? wiring.places?.canvas : wiring.places?.edit;
  const chat = wiring.chat;
  return (
    <>
      {/* a plugin's own surface in the panes' place, as the canvas is: they stay laid out as they were, hidden under it */}
      {surface != null ? (
        <div data-workspace-surface={surface} className="relative z-[3] flex min-h-0 min-w-0 bg-[var(--dock-line)]"
          style={{ gridArea: 'main', paddingTop: DOCK_GAP, ...room }}>
          <div className="relative flex min-h-0 min-w-0 flex-1 bg-[var(--bg-panel)]">
            <PluginSurface id={surface} page={surfacePlugin?.page} files={surfacePlugin?.files} program={surfacePlugin?.program} runs={surfacePlugin?.runs} inApp={surfacePlugin?.inApp} element={surfacePlugin?.element} projectId={projectId} folder={loaded?.project.path ?? ''} film={folder} />
          </div>
        </div>
      ) : null}
      {/* no workbench on: where one would be says so, over the panes (and the canvas), which stay as they were */}
      {noBench ? (
        <div data-workspace-empty className="relative z-[3] flex min-h-0 min-w-0 items-center justify-center bg-[var(--bg-panel)] px-8 text-center text-[13px] leading-relaxed text-[var(--text-muted)]"
          style={{ gridArea: 'main', ...room }}>
          <p className="max-w-[360px]">{t('assetDrawer.noPluginsOn')}</p>
        </div>
      ) : null}
      {/* the canvas in the panes' place: they stay laid out as they were, hidden under it; the gaps round it are the
          panes' lines (the one under the top bar, the one by the chat) */}
      {canvasKept || canvasOpen ? (
        /* hidden with opacity too: the canvas's library writes `visibility: visible` on each of its nodes */
        <div data-workspace-canvas className="relative z-[2] flex min-h-0 min-w-0 bg-[var(--dock-line)]" aria-hidden={!canvasOpen || away} inert={!canvasOpen || away}
          style={{ gridArea: 'main', paddingTop: DOCK_GAP, ...wiring.places?.canvas, ...wiring.places?.canvasFrame, ...(canvasOpen && !away ? null : { visibility: 'hidden', opacity: 0, zIndex: 0 }) }}>
          <div className="relative min-h-0 min-w-0 flex-1 bg-[var(--bg-panel)]">
            <LoadBoundary title={t('canvas.loadFailed')} action={t('canvas.reload')}>
              <React.Suspense fallback={<CanvasLoading />}>
                <CanvasView shown={canvasOpen} projectId={projectId} folder={loaded?.project.path ?? ''} files={canvasFiles} sources={mediaSources} onAddToFilm={(file) => { wiringStore.get()?.addToFilm?.(file); }}
                  onImportFiles={(dropped, progress = () => {}) => onImport(dropped, 'assets', progress)} onOpenSettings={() => wiringStore.get()?.openSettings?.('models')}
                  focus={canvasFocus} insert={canvasInsert} addFiles={canvasAddFiles} onRefer={studioHost?.refer ? (refs) => { for (const ref of refs) studioHost?.refer?.(ref); } : undefined}
                  onSendToFilm={(list) => { wiringStore.get()?.sendToFilm?.(list); }} onReveal={(path) => showFile(path, true)}
                  {...(chat ? { chat } : {})}
                  onError={toast.showError} onNotice={(message) => toast.show(message)} />
              </React.Suspense>
            </LoadBoundary>
          </div>
        </div>
      ) : null}
    </>
  );
}
