/**
 * The library of the project's page: its pane and the drawer in it (components/library/LibraryDrawer), which the
 * shell draws once for whichever workbench is shown. What is browsed without a workbench is held here: the media pane
 * on the project's media or on Saved, a file asked to be found there, a file kept in Saved or pointed at for the agent. The files themselves and the operations on them are the frame's
 * (shell/ProjectFrame).
 *
 * What a workbench does with the library (a file put in its film or taken in hand, a thing of the library added or
 * tried over its picture, captions, voices) it gives through the wiring (shell/frame `library`); without it those are
 * left out, and the library is only browsed. While the canvas is shown, "+" sends files to the canvas, and nothing is
 * tried over the picture.
 *
 * Where the pane is and whether it is open are the layout's (shell/layout): the pane is drawn there with a workbench
 * in the page or none.
 */
import { onRevealInLibrary } from '@/lib/library-reveal';
import * as React from 'react';
import { api, type MediaMade } from '@/api';
import { useT } from '@/i18n';
import { HOST_PANEL_WIDTH, studioHost, type HostPanel } from '@/lib/host';
import { BUILT_IN, fromLibrary, useLibraryIndex } from '@/lib/library';
import type { Plugin } from '@/lib/plugins';
import { importIntoSaved, refreshSaved, savedActions, savedSources, starSaved, useSavedListing, useStarredSaved } from '@/lib/saved';
import { Star } from 'lucide-react';
import { relOf, useLibraryPlaces } from '@/lib/library-places';
import { fileRef, stillUrl } from '@/lib/studio-refs';
import type { MediaListing, MediaSources, WorkspaceResource } from '@/lib/workspace-resources';
import type { ResourceKind } from '@/lib/resource-drag';
import { LibraryDrawer, type LibraryActions } from '@/components/library/LibraryDrawer';
import { PluginsWindow } from '@/components/PluginsWindow';
import { openPlugins } from '@/lib/plugins-window';
import { sourcesApi } from '@/lib/project-sources';
import { MediaPool, type ImportProgress } from '@/components/MediaPool';
import type { useToast } from '@/components/Toast';
import { WorkspaceLibraryPane } from '@/components/WorkspaceLibraryPane';
import type { useProjectFrame } from './ProjectFrame';
import { useWiring, wiringStore, type Wiring } from './frame';

/** Which the media pane shows, the project's media or a place of the person's shelf (its `saved/` path): kept while
 * Studio is open, across projects. */
type MediaScope = string;
const MEDIA_SCOPE: { current: MediaScope } = { current: 'project' };
/** where the app's panel starts: under Studio's top bar (its h-8) */
export const HOST_PANEL_TOP = 32;
/* no template's try failed, and no way out of a try: what the drawer is given when no workbench tries anything */
const NO_STATUS: Partial<Record<string, 'failed'>> = {};
const nothing = () => {};

/**
 * What the library shows of the project `projectId`, whichever workbench is shown. `of`: what the frame holds that it
 * reads (the project's files, where their pictures come from, how they were made, the toast, the canvas shown or not,
 * the layout's way to open the pane).
 */
export function useLibraryShown(projectId: string, of: {
  listing: MediaListing | null; mediaSources: MediaSources; mediaMade: Record<string, MediaMade>; toast: ReturnType<typeof useToast>; canvasOpen: boolean;
  openLibrary: (open: boolean) => void;
}) {
  const t = useT();
  const { listing, mediaSources, mediaMade, toast, canvasOpen, openLibrary } = of;
  const { show: showToast } = toast;
  /* a file of the media pane as a reference: shown by its poster (a video, a page) or itself (a still, on Studio's
     origin: see stillUrl) */
  const refOfFile = React.useCallback((file: WorkspaceResource, made: MediaMade | undefined = mediaMade[file.path]) => fileRef(file, file.kind === 'mg' ? mediaSources.pagePoster?.(file)
    : file.kind === 'image' ? stillUrl(projectId, file.path, Math.round(file.mtimeMs)) : file.kind === 'video' ? mediaSources.poster?.(file) : undefined, made), [mediaSources, projectId, mediaMade]);
  /* a file of the media library or of Saved pointed at for the agent: brought into the project first (how it was made comes
     with it), so what the agent is given is a file of the project it can use as it is */
  const referOutside = React.useCallback(async (file: WorkspaceResource) => {
    if (!studioHost?.refer) return;
    try {
      const taken = await api.takeSaved(projectId, file.path);
      if (!('path' in taken)) return;
      const made = (await api.mediaMade(projectId).catch(() => ({} as Record<string, MediaMade>)))[taken.path];
      const { bundle: _bundle, ...rest } = file;
      studioHost.refer(refOfFile({ ...rest, path: taken.path }, made));
    } catch (e) { toast.showError(e instanceof Error ? e.message : String(e)); }
  }, [projectId, refOfFile, toast]);
  /* a sound, a piece of music or a template's music of the library could not be fetched: said */
  const onLibraryDownloadFailed = React.useCallback(() => showToast(t('assetDrawer.networkRetry')), [showToast, t]);
  /* clips (and files) kept to use again in any project (lib/saved, studio/server/saved.mjs): the timeline's, the
     picture's and the media pane's "Add to Saved" */
  const saveThings = React.useCallback(async (what: Parameters<typeof api.save>[1], n: number) => {
    if (!n) return;
    try {
      await api.save(projectId, what);
      refreshSaved();
      const place = what.into?.split('/').at(-1) ?? '';
      toast.show((n === 1 ? t('saved.added') : t('saved.addedMany')).replace('{n}', String(n)).replace('{place}', place));
    } catch (e) {
      toast.showError(t('saved.failed').replace('{error}', e instanceof Error ? e.message : String(e)));
    }
  }, [projectId, t, toast]);
  const saveFiles = React.useCallback((files: WorkspaceResource[], into: string) => {
    const list = files.map((f) => ({ path: f.path, name: f.name, ...(f.durationMs ? { durationMs: f.durationMs } : {}), ...(f.w ? { w: f.w } : {}), ...(f.h ? { h: f.h } : {}) }));
    void saveThings({ files: list, into }, list.length);
  }, [saveThings]);
  /* the media pane shows the project's media, or Saved (lib/saved): the same pane, the button beside Upload switches */
  const [asked, setMediaScope] = React.useState<MediaScope>(() => MEDIA_SCOPE.current);
  const { ready: placesRead, folders } = useLibraryPlaces();
  /* a folder taken away (here or in another window): the project's media again */
  const mediaScope = asked === 'project' || !placesRead || folders.some((p) => p.path === asked) ? asked : 'project';
  const switchMedia = React.useCallback((next: MediaScope) => { MEDIA_SCOPE.current = next; setMediaScope(next); }, []);
  const [revealMedia, setRevealMedia] = React.useState<{ path: string; seq: number; highlight: boolean; done?: boolean } | null>(null);
  const mediaRevealed = React.useCallback((seq: number) => {
    setRevealMedia((request) => request?.seq === seq && !request.done ? { ...request, done: true } : request);
  }, []);
  /* the drawer's media: only the project's own; what it took from the library (lib/library fromLibrary) is shown in
     the library's own category, tried there without being listed here */
  const libraryIndex = useLibraryIndex();
  const scopedListing = React.useMemo(() => {
    if (!listing || mediaScope !== 'project') return listing;
    const keep = (f: { path: string }) => f.path === revealMedia?.path || !fromLibrary(f.path, libraryIndex?.items ?? null);
    return { ...listing, files: listing.files.filter(keep), pages: listing.pages.filter(keep) };
  }, [listing, mediaScope, libraryIndex, revealMedia?.path]);
  const [savedDirectory, setSavedDirectory] = React.useState('');
  const [savedQuery, setSavedQuery] = React.useState('');
  const savedListing = useSavedListing(mediaScope !== 'project', true, { base: relOf(mediaScope), at: savedDirectory, query: savedQuery });
  const savedImport = React.useCallback((files: File[], into: string, onProgress: ImportProgress) => importIntoSaved(files, into, onProgress, t('assets.uploadFailed')), [t]);
  /* the file a workbench was just asked to take in hand (showFile), with what it gave the library then: the media
     pane is told that file is in hand until the workbench says what is. The shell and a workbench are drawn one after
     the other, so without it the pane could be drawn on the file asked for before it is known to be the one in hand */
  const [askedInHand, setAskedInHand] = React.useState<{ path: string; of: NonNullable<Wiring['library']> } | null>(null);
  /**
   * Find a file in Assets; the canvas points it out without replacing the editing selection. The pane is opened, and
   * the file is taken in hand by the workbench shown (with the canvas over it, in hand only).
   */
  /* a category of the library asked for from elsewhere (the Community): the drawer opens (it shows the category) */
  React.useEffect(() => onRevealInLibrary(() => openLibrary(true)), [openLibrary]);
  const showFile = React.useCallback((path: string, highlight = false) => {
    const file = listing ? [...listing.pages, ...listing.files].find((f) => f.path === path) : undefined;
    if (!file) return;
    const library = wiringStore.get()?.library;
    openLibrary(true);
    switchMedia('project');
    if (!highlight && library) { setAskedInHand({ path: file.path, of: library }); library.pick(file, canvasOpen ? { quiet: true } : undefined); }
    setRevealMedia((cur) => ({ path: file.path, seq: (cur?.seq ?? 0) + 1, highlight }));
  }, [listing, canvasOpen, switchMedia, openLibrary]);

  return {
    refOfFile, referOutside, onLibraryDownloadFailed, saveThings, saveFiles,
    mediaScope, switchMedia, folders, revealMedia, setRevealMedia, mediaRevealed, libraryIndex, scopedListing, savedListing, savedImport, setSavedDirectory, setSavedQuery,
    showFile, askedInHand,
  };
}

/**
 * The library's pane with its drawer, and the seam that sizes the app's panel while the pane covers it: drawn over the
 * page, where the layout says the pane is (shell/layout), once the project was read. It is the same drawer whichever
 * workbench is shown, so what is open in it stays as the edit gives way to the canvas.
 */
export function LibraryPlace({ frame }: { frame: ReturnType<typeof useProjectFrame> }) {
  const t = useT();
  const library = useWiring('library')?.library;
  const {
    projectId, loaded, failure, mediaSources,
    onPick, onBring, onRelink, onCollect, onImport, onMove, onMoveCheck, onDelete, onExtractAudio, onSetCover, onNewFolder, reveal,
    missingMedia, findMissing, madeWords,
    canvasOpen, setCanvasOpen, requestCanvasFiles,
    refOfFile, referOutside, onLibraryDownloadFailed, saveFiles,
    mediaScope, switchMedia, folders, revealMedia, mediaRevealed, scopedListing, savedListing, savedImport, setSavedDirectory, setSavedQuery, askedInHand,
    toast, showWorkbench, setSettingsOpen,
    libraryPane: pane, updateWorkspace, setPanelWidth,
  } = frame;
  /* Settings › Services, where a voice's service is connected */
  const openServices = React.useCallback(() => { setSettingsOpen('models'); }, [setSettingsOpen]);
  /* a file of the media pane clicked is taken in hand by the workbench shown (its viewer shows it): by none, nothing */
  const pickFile = React.useCallback((file: WorkspaceResource | null) => { wiringStore.get()?.library?.pick(file); }, []);
  const pickSavedFile = React.useCallback((file: WorkspaceResource | null) => { wiringStore.get()?.library?.pick(file, { saved: true }); }, []);
  const pauseWorkbench = React.useCallback(() => { wiringStore.get()?.pause?.(); }, []);
  /* a plugin with a workbench turned on in the plugins' window: where it now is (the edit's views, Motion, on its timeline;
     any other on the top bar's switch), with the way to show it */
  const { show: showToast } = toast;
  const workbenchOn = React.useCallback((plugin: Plugin) => {
    const workbench = plugin.workbench;
    if (!workbench) return;
    const onTimeline = workbench !== 'edit' && plugin.blocks === 'edit';
    showToast(t(onTimeline ? 'assetDrawer.workbenchAddedTimeline' : 'assetDrawer.workbenchAdded'), { label: t('assetDrawer.workbenchOpen'), run: () => showWorkbench(workbench) });
  }, [showToast, showWorkbench, t]);
  /* a project that brings skills not allowed in it yet says so as it opens, once, with the way to look at them
     (src/skills.mjs projectSkillAllowed): nothing of them reaches an agent until then */
  React.useEffect(() => {
    if (!projectId) return;
    let live = true;
    void sourcesApi.skills(projectId).then((list) => {
      const waiting = list.filter((k) => k.waits).length;
      if (live && waiting) showToast(t('assetDrawer.projectSkillsWaiting').replace('{n}', String(waiting)), { label: t('assetDrawer.reviewAndAllow'), run: () => openPlugins({ line: 'mine' }) });
    }, () => {});
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  /* the person's own files starred: the file menu stars them (or no longer), and they are under 收藏 */
  const starred = useStarredSaved();
  const starMenu = (files: WorkspaceResource[]) => {
    const all = files.length > 0 && files.every((f) => starred.has(f.path));
    return files.length ? [{ id: 'star', label: t(all ? 'assetDrawer.unstar' : 'assetDrawer.star'), icon: <Star size={14} />,
      onSelect: () => { for (const f of files) void starSaved(f.path, !all); } }, { id: 'star-sep', separator: true } as const] : [];
  };
  /* where the drawer writes the way out of a try when no workbench has a place for it */
  const noDismiss = React.useRef<() => boolean>(() => false);
  if (!loaded || failure) return null;
  /* the file the workbench was just asked to take in hand, until it says what is in hand (see `askedInHand`) */
  const asked = askedInHand && askedInHand.of === library ? askedInHand.path : null;
  /* the canvas shown: a page, a sound or a template goes to the canvas, anything else to the film, which is shown;
     nothing is tried */
  const actions: LibraryActions = canvasOpen ? {
    ...library?.actions,
    add: (item) => {
      if (['page', 'sound', 'group'].includes(item.kind)) void requestCanvasFiles(`${BUILT_IN}/${item.id}`, true);
      else if (library) { setCanvasOpen(false); library.actions.add(item); }
    },
    tryOut: () => {},
  } : library?.actions ?? { add: nothing, tryOut: nothing };
  /* what of the files a category of the drawer shows (`kinds`, null: all of them) */
  const only = (kinds: readonly ResourceKind[] | null, of: MediaListing | null): MediaListing | null => (!of || !kinds ? of
    : { ...of, files: of.files.filter((f) => kinds.includes(f.kind)), pages: kinds.includes('mg') ? of.pages : [] });
  const media = (kinds: readonly ResourceKind[] | null) => mediaScope !== 'project' ? (
    <MediaPool
      key={mediaScope}
      projectId={mediaScope}
      rootName={folders.find((p) => p.path === mediaScope)?.name}
      listing={only(kinds, savedListing)}
      onFolderChange={setSavedDirectory} onSearchChange={setSavedQuery}
      sources={savedSources}
      selectedPath={library?.pickedSaved ? library.pickedPath : null}
      onSelectFile={pickSavedFile}
      onImport={savedImport}
      onMove={savedActions.move}
      onDelete={savedActions.remove}
      onNewFolder={savedActions.newFolder}
      onReveal={savedActions.reveal}
      onPick={onPick}
      onBring={(paths, into, mode) => savedActions.bring(paths, into, mode)}
      {...(studioHost?.refer ? { onReferFile: (file: WorkspaceResource) => void referOutside(file) } : {})}
      scope="saved"
      browser={{ menu: starMenu }}
      onAdd={canvasOpen ? (file) => { void requestCanvasFiles(file.path, true); } : library ? (file) => library.add(file, true) : undefined}
    />
  ) : (
    <MediaPool
      key={mediaScope}
      projectId={projectId}
      listing={only(kinds, scopedListing)}
      sources={mediaSources}
      usedSrcs={library?.usedSrcs}
      selectedPath={asked ?? (library && !library.pickedSaved ? library.pickedPath : null)}
      onSelectFile={pickFile}
      onImport={onImport}
      onMove={onMove}
      onMoveCheck={onMoveCheck}
      onDelete={onDelete}
      onExtractAudio={onExtractAudio}
      onSetCover={onSetCover}
      onNewFolder={onNewFolder}
      onDropClips={library?.onDropClipsForAssets}
      onReveal={reveal}
      onPick={onPick}
      onBring={onBring}
      onRelink={onRelink}
      onCollect={onCollect}
      missing={missingMedia.length}
      onFindMissing={() => void findMissing()}
      wordsOf={madeWords}
      onSave={folders.length ? saveFiles : undefined}
      saveFolders={folders}
      scope="project"
      {...(studioHost?.refer ? { fileRef: refOfFile, onRefer: studioHost.refer } : {})}
      reveal={revealMedia}
      onRevealed={mediaRevealed}
      shown={pane.open}
      litPath={library?.litPath ?? null}
      onAdd={canvasOpen ? (file) => { void requestCanvasFiles(file.path); } : library ? (file) => library.add(file, false) : undefined}
    />
  );
  return (
    <>
      {pane.seam ? <PanelSeam panel={{ label: pane.seam.label, width: pane.seam.width, setWidth: setPanelWidth }} bottom={pane.seam.bottom} side={pane.seam.side} /> : null}
      <WorkspaceLibraryPane open={pane.open} dock={pane.dock}
        rect={pane.rect}
        free={pane.free}
        onResize={updateWorkspace}>
          <LibraryDrawer media={media} mediaScope={mediaScope} onMediaScope={switchMedia} mediaRequest={revealMedia?.seq} actions={actions}
            tried={library?.tried ?? null} templateStatus={library?.templateStatus ?? NO_STATUS} previewBar={canvasOpen ? null : library?.preview.bar ?? null} previewPicture={canvasOpen ? null : library?.preview.picture ?? null} dismissRef={library?.preview.dismissRef ?? noDismiss}
            onPreviewStart={canvasOpen ? pauseWorkbench : library?.preview.begin ?? nothing} onDownloadFailed={onLibraryDownloadFailed} shown={pane.open} under={pane.under} beside={pane.beside}
            onUpload={(files, into) => { if (into === 'project') void onImport(files, 'assets', () => {}); else void savedImport(files, into, () => {}).catch((e: unknown) => toast.showError(e instanceof Error ? e.message : String(e))); }}
            onKeep={(path, name, into) => saveFiles([{ path, name } as WorkspaceResource], into)}
            captions={library?.captions} covers={library?.covers} speak={library?.speak} recorder={library?.recorder} onServices={openServices}
            projectId={projectId} folder={loaded.project.path}
            onPickSaved={pickSavedFile}
            onAddSaved={canvasOpen ? (file) => { void requestCanvasFiles(file.path, true); } : library ? (file) => library.add(file, true) : undefined} />
      </WorkspaceLibraryPane>
      {/* the plugins, in a window of their own (lib/plugins-window opens it) */}
      <PluginsWindow projectId={projectId} onWorkbenchOn={workbenchOn} />
    </>
  );
}

/**
 * The seam that sizes the app's panel while Studio's assets drawer covers it (the panel's own seam is under the
 * drawer then): the same 10 px strip over the column's right edge, dragged or moved with the arrow keys.
 */
function PanelSeam({ panel, bottom, side = 'left' }: { panel: Pick<HostPanel, 'label' | 'width' | 'setWidth'>; bottom: number; side?: 'left' | 'right' }) {
  const drag = React.useRef<{ x: number; width: number } | null>(null);
  return (
    <div role="separator" aria-orientation="vertical" aria-label={panel.label} tabIndex={0}
      className="workspace-resize-handle fixed z-[38] w-[9px] cursor-col-resize touch-none outline-none"
      style={{ top: HOST_PANEL_TOP, bottom, left: side === 'right' ? `calc(100vw - ${HOST_PANEL_WIDTH} - 4px)` : `calc(${HOST_PANEL_WIDTH} - 5px)` }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width: panel.width };
        document.body.style.cursor = 'col-resize';
      }}
      onPointerMove={(e) => { if (drag.current) panel.setWidth(drag.current.width + (e.clientX - drag.current.x) * (side === 'right' ? -1 : 1)); }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        panel.setWidth(drag.current.width + (e.clientX - drag.current.x) * (side === 'right' ? -1 : 1), true);
        drag.current = null;
        document.body.style.cursor = '';
      }}
      onLostPointerCapture={() => { drag.current = null; document.body.style.cursor = ''; }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        panel.setWidth(panel.width + (e.key === 'ArrowRight' ? 24 : -24) * (side === 'right' ? -1 : 1), true);
      }} />
  );
}
