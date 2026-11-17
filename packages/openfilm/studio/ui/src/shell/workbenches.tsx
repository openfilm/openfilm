/**
 * Which workbench the project's page shows, and the workbenches themselves: the element each plugin on brings
 * (components/surfaces elementTag), put where its arrangement says (lib/blocks arrangementOf). The edit's (which draws
 * Motion too) is put in the page with it, and draws its blocks where the layout puts them (shell/arrangement); the
 * canvas is put in its box once warmed or shown, and kept there. Both stay for the project, hidden, while their plugins
 * are off. Another plugin's workbench with blocks of its own is laid out among the panels the same way while it is
 * picked (its element put in the page then, and kept for the project); one without takes the panes' place whole. Each is hidden under whatever else is shown. The notice that no workbench is on is here too. The shell holds
 * the choice (the edit or the canvas, by project as left; Motion, a view of the edit; a plugin's surface picked on the
 * top bar), tells it in the frame (shell/ProjectFrame), and tells which is shown to the wiring (shell/frame), so it
 * reaches that workbench's first.
 *
 * Where these go (the room kept round them, the canvas's own frame where the panels float) is the layout's
 * (shell/layout); what the canvas does to the film is reached through the edit's wiring (plugins/canvas).
 */
import { CANVAS_KEY, SURFACE_KEY, canvasShown, surfacePicked } from '@/lib/workbench-start';
import * as React from 'react';
import { api, projectEvents } from '@/api';
import { useT } from '@/i18n';
import { afterPaintIdle } from '@/lib/after-paint-idle';
import { keyAction } from '@/lib/keymap-store';
import { useStudioPlugins } from '@/lib/plugins';
import { usePluginsOf } from '@/lib/project-plugins';
import { useWorkModes } from '@/lib/work-modes';
import { arrangementOf, arrangementSpecs } from '@/lib/blocks';
import { CanvasLoading } from '@/components/canvas/CanvasLoading';
import { LoadBoundary } from '@/components/canvas/LoadBoundary';
import { DOCK_GAP } from '@/components/PaneDivider';
import { elementTag, elementTagNow, NOTE, PluginSurface } from '@/components/surfaces';
import { isTypingTarget } from '@/components/typing-target';
import { addTo } from '@/studio/hub';
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
/** The workbenches whose showing the shell holds itself: the edit, Motion and Color (views of the edit) and the canvas. */
const HELD_HERE: readonly string[] = ['edit', 'motion', 'color', 'canvas'];
/* whether a project shows its canvas, and the plugin's surface it was left on, kept on this computer by project
   (lib/workbench-start) */

/**
 * The workbench shown in the project `projectId`, and files asked onto the canvas. `canvasProject`: the project's
 * id once it was read (the canvas is warmed after that); `showError`: the toast's; `rearranging`: whether the page's
 * panels are being rearranged (shell/layout writes it).
 */
export function useWorkbenchShown(projectId: string, canvasProject: string | undefined, showError: (message: string) => void, rearranging: React.RefObject<boolean>) {
  /* the canvas over the panes, or the edit: by project, as left */
  const [canvasLeft, setCanvasOpenState] = React.useState(() => canvasShown(projectId));
  React.useEffect(() => { setCanvasOpenState(canvasShown(projectId)); }, [projectId]);
  /* the edit seen as an animation editor sees it (components/MotionTimeline), in the timeline's place */
  const [motionOpen, keepMotionOpen] = useKeptFlag('openfilm.project.motion', false);
  /* the edit graded clip by clip (plugins/color): the color panel in the inspector's place */
  const [colorOpen, keepColorOpen] = useKeptFlag('openfilm.project.color', false);
  /* not while the page's panels are being rearranged; opening it stops the film playing (the panes under it are
     hidden): that is the workbench's, asked of it as this runs */
  const setCanvasOpen = React.useCallback((open: boolean) => {
    if (rearranging.current) return;
    if (open) wiringStore.get()?.pause?.();
    setCanvasOpenState(open);
    try { localStorage.setItem(`${CANVAS_KEY}:${projectId}`, open ? '1' : '0'); } catch { /* for this launch only */ }
  }, [projectId, rearranging]);
  /* the motion view opens what it is worked in (the workbench's own panes) with it */
  const setWorkMode = React.useCallback((mode: 'canvas' | 'edit' | 'motion' | 'color') => {
    setCanvasOpen(mode === 'canvas');
    if (mode !== 'canvas') { keepMotionOpen(mode === 'motion'); keepColorOpen(mode === 'color'); }
    if (mode === 'motion') wiringStore.get()?.motionShown?.();
  }, [setCanvasOpen, keepMotionOpen, keepColorOpen]);
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
  /* the canvas as left for the project, shown only while no plugin's surface is in its place: one picked over it (its
     own arrangement among the panels) is laid out as the panes are, not in the canvas's room */
  const canvasOpen = canvasLeft && surface == null;
  const workMode: 'canvas' | 'edit' | 'motion' | 'color' = canvasOpen ? 'canvas' : colorOpen ? 'color' : motionOpen ? 'motion' : 'edit';
  /* the plugins of the project, and the arrangements their workbenches are laid out in (lib/blocks) */
  const plugins = usePluginsOf(projectId);
  const specs = arrangementSpecs(plugins);
  /* the edit (and Motion, a view of it) and the canvas are held here; any other workbench is a plugin's, picked */
  const heldHere = React.useCallback((workbench: string) => HELD_HERE.includes(workbench), []);
  const showWorkbench = React.useCallback((mode: string) => {
    if (heldHere(mode)) { setSurface(null); setWorkMode(mode as 'canvas' | 'edit' | 'motion' | 'color'); } else setSurface(mode);
  }, [setWorkMode, setSurface, heldHere]);
  /* the arrangement laid out among the page's panels: the plugin's picked, when it has one of its own; else the edit's,
     under the canvas and any other plugin's surface too */
  /* one someone made is laid out among the panels once its element may run; until then its surface says why not */
  const surfacePlugin = surface != null ? plugins.find((p) => p.workbench === surface) : undefined;
  const surfaceArrangement = surface != null && (!surfacePlugin?.skill || surfacePlugin.element) ? arrangementOf(surface, plugins) : null;
  const among = surfaceArrangement != null && !heldHere(surface!) ? surfaceArrangement
    /* Color is the edit graded, in an arrangement of its own (the edit's viewer among its scopes, shots and tools) */
    : surface == null && colorOpen && specs.has('color') ? 'color' : 'edit';
  /* the edit and the canvas are not shown: no workbench is on, or a plugin's surface is in their place */
  const away = noBench || surface != null;
  /* the workbenches to pick from on the top bar (Motion is picked in the edit's timeline); the edit and the canvas
     alone are one button that goes from one to the other */
  const benchPlugins = React.useMemo(() => plugins.filter((p) => p.on && p.workbench && p.workbench !== 'motion'), [plugins]);
  const pickBench = benchPlugins.length > 1 && benchPlugins.some((p) => p.workbench !== 'edit' && p.workbench !== 'canvas');
  const canToggleCanvas = workModes.includes('canvas') && workModes.length > 1;
  /* one turned off while in use gives way to the first still on */
  React.useEffect(() => {
    if (surface == null && workModes.length && !workModes.includes(workMode)) showWorkbench(workModes[0]!);
  }, [workModes, workMode, surface, showWorkbench]);
  /* the workbench shown, told to the wiring (shell/frame): what the shell reaches is that workbench's first */
  usePublishShown(noBench ? null : surface ?? (canvasOpen ? 'canvas' : 'edit'));
  /* the workbench as the top bar names it: Color is the edit graded, named as its own */
  const named = (base: string | null) => (base === 'edit' && workMode === 'color' ? 'color' : base);
  /*
   * The elements of the plugins on, by where the layout puts them: the first plugin on that is laid out there
   * (`on`), and the module of its element (null: none, or not known yet). Where a module is is known once Studio has
   * said it (`pluginsRead`): what this browser kept is of an earlier launch, whose addresses have changed.
   */
  const pluginsRead = useStudioPlugins() !== null;
  const arranged = React.useMemo(() => {
    const of = (arrangement: string) => {
      const there = plugins.filter((p) => p.on && p.workbench && (arrangement === 'canvas' ? p.workbench === 'canvas' : p.workbench === 'edit' || p.workbench === 'motion' || p.workbench === 'color'));
      return { on: there.length > 0, element: (pluginsRead ? there.find((p) => p.element)?.element : null) ?? null };
    };
    return { edit: of('edit'), canvas: of('canvas') };
  }, [plugins, pluginsRead]);
  /* the elements of other plugins laid out among the page's panels (an arrangement of their own): put in the page once
     shown, and kept there for the project while their plugins are on, drawing their blocks where the layout puts them */
  const [shownAmong, setShownAmong] = React.useState<{ of: string; names: readonly string[] }>({ of: projectId, names: [] });
  const amongNames = shownAmong.of === projectId ? shownAmong.names : [];
  if (surface != null && surfaceArrangement === among && among !== 'edit' && !amongNames.includes(surface)) setShownAmong({ of: projectId, names: [...amongNames, surface] });
  const amongElements = React.useMemo(() => (pluginsRead ? amongNames.flatMap((name) => {
    const plugin = plugins.find((p) => p.on && p.workbench === name && p.element);
    return plugin ? [{ name, element: plugin.element! }] : [];
  }) : []), [amongNames, plugins, pluginsRead]);
  /* an element put in the page stays there for this project, hidden, when its plugin is turned off: turned on again,
     it is as it was left (what is in hand, the playhead, the steps to undo), and what it has on the top bar stays */
  const [placed, setPlaced] = React.useState<{ of: string; edit: string | null; canvas: string | null }>({ of: projectId, edit: null, canvas: null });
  const placedNow = placed.of === projectId ? placed : { of: projectId, edit: null, canvas: null };
  const placedNext = { of: projectId, edit: arranged.edit.element ?? placedNow.edit, canvas: arranged.canvas.element ?? placedNow.canvas };
  if (placedNext.of !== placed.of || placedNext.edit !== placed.edit || placedNext.canvas !== placed.canvas) setPlaced(placedNext);
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
  const toWarm = JSON.stringify((pluginsRead ? plugins : []).filter((p) => !p.skill && p.on && p.workbench && p.element && p.workbench !== 'edit' && p.workbench !== 'motion' && p.workbench !== 'color'
    && (p.workbench === 'canvas' ? !canvasKept : p.workbench !== surface)).map((p) => [p.element, p.workbench === 'canvas']));
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
  /* the workbench shown, and the one shown before it (Motion is the edit's) */
  const nowShown = named(noBench ? null : surface ?? (canvasOpen ? 'canvas' : 'edit'));
  const before = React.useRef<{ now: string | null; was: string | null }>({ now: nowShown, was: null });
  if (before.current.now !== nowShown) before.current = { now: nowShown, was: before.current.now };
  /* keymap `work-mode` (⌘E): back to the workbench shown before (else the next one); ⌥1, ⌥2… (Alt elsewhere): the
     workbenches in the top bar's order. Not while typing, nor over a dialog */
  const workModeRef = React.useRef<(event: KeyboardEvent) => boolean>(() => false);
  workModeRef.current = (event) => {
    const names = benchPlugins.map((p) => p.workbench!);
    const digit = event.altKey && !event.metaKey && !event.ctrlKey && /^Digit[1-9]$/.test(event.code) ? Number(event.code.slice(5)) : 0;
    if (digit) {
      const name = names[digit - 1];
      if (name && name !== nowShown) showWorkbench(name);
      return Boolean(name);
    }
    if (keyAction(event) !== 'work-mode') return false;
    const was = before.current.was;
    const next = was && was !== nowShown && names.includes(was) ? was : names[(names.indexOf(nowShown ?? '') + 1) % Math.max(1, names.length)];
    if (next && next !== nowShown) showWorkbench(next);
    else if (surface != null) setSurface(null);
    else if (canToggleCanvas) setCanvasOpen(!canvasOpen);
    return true;
  };
  React.useEffect(() => {
    const press = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.repeat || isTypingTarget(el) || el?.closest?.('[role="dialog"]')) return;
      /* a dialog of the canvas's open (a redraw, a library): it has the keys until it closes */
      if (document.querySelector('[data-studio-canvas] [role="dialog"]')) return;
      if (workModeRef.current(event)) event.preventDefault();
    };
    window.addEventListener('keydown', press, true);
    return () => window.removeEventListener('keydown', press, true);
  }, []);
  /* files asked onto the canvas (the library's "+" while the canvas is shown): one of Saved is brought into the
     project first, then they are the canvas's `add` (openfilm/studio addTo) */
  const requestCanvasFiles = React.useCallback(async (path: string, saved = false) => {
    try {
      let paths = [path];
      if (saved) {
        const taken = await api.takeSaved(projectId, path);
        paths = 'path' in taken ? [taken.path] : 'clip' in taken ? [taken.clip.src] : taken.clips.map(item => item.clip.src);
      }
      addTo('canvas', [...new Set(paths)]);
    } catch (error) { showError(error instanceof Error ? error.message : String(error)); }
  }, [projectId, showError]);

  /* whether a workbench draws its blocks in the page now: its element is there */
  const inPage = React.useCallback((workbench: string) => (workbench === 'edit' ? Boolean(arranged.edit.element ?? placedNext.edit)
    : workbench === 'canvas' ? Boolean(arranged.canvas.element ?? placedNext.canvas) : amongElements.some((e) => e.name === workbench)), [arranged, placedNext.edit, placedNext.canvas, amongElements]);

  return {
    canvasOpen, setCanvasOpen, motionOpen, colorOpen, workMode, setWorkMode, workModes, noBench, surface, showWorkbench, away,
    benchPlugins, pickBench, canToggleCanvas, pluginsRead, arranged, placed: placedNext,
    canvasKept, requestCanvasFiles, specs, among, amongElements, inPage, surfaceArrangement,
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
function PluginElement({ url, projectId, plugin, ready, loading, failed }: {
  url: string; projectId: string; plugin?: string; ready: boolean; loading: React.ReactNode; failed: (error: string) => React.ReactNode;
}) {
  const host = React.useRef<HTMLDivElement>(null);
  const put = React.useRef<{ tag: string; projectId: string; element: HTMLElement } | null>(null);
  /* a module loaded already (the canvas warmed): its element is put in at once, with nothing said meanwhile */
  const [state, setState] = React.useState<'loading' | 'shown' | { error: string }>(() => (elementTagNow(url) ? 'shown' : 'loading'));
  React.useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    elementTag(url).then((tag) => {
      if (!live || !host.current) return;
      if (put.current?.tag !== tag || put.current.projectId !== projectId) {
        put.current?.element.remove();
        const element = document.createElement(tag);
        element.setAttribute('project-id', projectId);
        if (plugin) element.setAttribute('plugin', plugin);
        host.current.append(element);
        put.current = { tag, projectId, element };
      }
      setState('shown');
    }, (e) => { if (live) setState({ error: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [url, projectId, plugin, ready]);
  React.useEffect(() => () => { put.current?.element.remove(); put.current = null; }, []);
  return (
    <>
      {state === 'loading' ? loading : typeof state === 'object' ? failed(state.error) : null}
      <div ref={host} style={PLACE} />
    </>
  );
}

/**
 * The elements laid out among the page's panels (the edit's, and a plugin's with blocks of its own: lib/blocks), where the panes are: put
 * in the page as soon as a plugin laid out there is on and Studio has said where its module is, and taken out when
 * none is on. One that cannot be loaded, or that this build has nothing of, says so in the panes' place.
 */
export function AmongPanes({ frame }: { frame: ReturnType<typeof useProjectFrame> }) {
  const t = useT();
  const { projectId, arranged, pluginsRead, placed, amongElements } = frame;
  /* one put in the page before stays while its plugin is off (hidden under what is shown: the panes know) */
  const element = arranged.edit.element ?? placed.edit;
  const failed = (error: string) => <p className={NOTE} style={{ gridArea: 'main' }}>{`${t('assetDrawer.surfaceFailed')}\n\n${error}`}</p>;
  return (
    <>
      {!arranged.edit.on && !element ? null
        : !element ? (pluginsRead ? <p className={NOTE} style={{ gridArea: 'main' }}>{t('assetDrawer.surfaceMissing')}</p> : null)
          : <PluginElement url={element} projectId={projectId} ready loading={null} failed={failed} />}
      {/* the elements of other plugins laid out among the panels: each draws its blocks into their slots */}
      {amongElements.map(({ name, element: url }) => <PluginElement key={name} url={url} projectId={projectId} plugin={name} ready loading={null} failed={failed} />)}
    </>
  );
}

/**
 * What takes the panes' place, drawn in the page's grid after the element among them: the plugin's surface picked
 * (while it is shown), the notice that no
 * workbench is on, and the canvas's box with its element (kept there once warmed or opened, hidden while it is not
 * shown). They are drawn once the project was read, where the layout says (shell/layout), with a workbench in the
 * page or none.
 */
export function InPanesPlace({ frame }: { frame: ReturnType<typeof useProjectFrame> }) {
  const t = useT();
  const {
    projectId, loaded, failure, slots,
    surface, surfaceArrangement, benchPlugins, noBench, away, canvasOpen, canvasKept, arranged, placed, pluginsRead,
    places,
  } = frame;
  /* the plugin's surface shown: one left is let go (a page hidden could go on playing), and loaded again when shown */
  const surfacePlugin = surface != null ? benchPlugins.find((p) => p.workbench === surface) : undefined;
  if (!loaded || failure) return null;
  /* how the window is laid out round these: the room the layout keeps round the panes with the arrangement among them
     shown, or the canvas (none where the panels float), and the canvas's own frame where they float */
  const room = canvasOpen ? places.canvas : places.among;
  return (
    <>
      {/* a plugin's own surface in the panes' place, as the canvas is: they stay laid out as they were, hidden under it.
          One with an arrangement of its own is laid out among the panels instead (shell/arrangement) */}
      {surface != null && surfaceArrangement == null ? (
        <div key={surface} data-workspace-surface={surface} className="relative z-[3] flex min-h-0 min-w-0 bg-[var(--dock-line)]"
          style={{ gridArea: 'main', paddingTop: DOCK_GAP, ...room }}>
          <div className="relative flex min-h-0 min-w-0 flex-1 bg-[var(--bg-panel)]">
            <PluginSurface id={surface} page={surfacePlugin?.page} files={surfacePlugin?.files} program={surfacePlugin?.program} runs={surfacePlugin?.runs} inApp={surfacePlugin?.inApp} element={surfacePlugin?.element} projectId={projectId} folder={loaded?.project.path ?? ''} />
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
      {(canvasKept || canvasOpen) && (arranged.canvas.on || placed.canvas) ? (
        <div data-workspace-canvas className="relative z-[2] flex min-h-0 min-w-0 bg-[var(--dock-line)]" aria-hidden={!canvasOpen || away} inert={!canvasOpen || away}
          style={{ gridArea: 'main', paddingTop: DOCK_GAP, ...places.canvas, ...places.canvasFrame, ...(canvasOpen && !away ? null : HIDDEN) }}>
          <div className="relative min-h-0 min-w-0 flex-1 bg-[var(--bg-panel)]">
            {arranged.canvas.element ?? placed.canvas ? (
              <PluginElement url={(arranged.canvas.element ?? placed.canvas)!} projectId={projectId} ready={Boolean(slots)} loading={<CanvasLoading />}
                failed={(error) => <LoadBoundary title={t('canvas.loadFailed')} action={t('canvas.reload')}><Thrown error={error} /></LoadBoundary>} />
            ) : pluginsRead ? <p className={NOTE}>{t('assetDrawer.surfaceMissing')}</p> : <CanvasLoading />}
          </div>
        </div>
      ) : null}
    </>
  );
}
