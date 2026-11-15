/**
 * The library of the project's page: its pane and the drawer in it (components/library/LibraryDrawer), which the
 * shell draws once for whichever workbench is shown. What is browsed without a workbench is held here: the media pane
 * on the project's media or on Saved, a file asked to be found there, the skills asked to be shown, a file kept in
 * Saved or pointed at for the agent. The files themselves and the operations on them are the frame's
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
import * as React from 'react';
import { api, type MediaMade } from '@/api';
import { useT } from '@/i18n';
import { HOST_PANEL_WIDTH, studioHost, type HostPanel } from '@/lib/host';
import { BUILT_IN, fromLibrary, useLibraryIndex } from '@/lib/library';
import type { Plugin } from '@/lib/plugins';
import { SAVED, importIntoSaved, refreshSaved, savedActions, savedSources, useSavedListing } from '@/lib/saved';
import { fileRef, stillUrl } from '@/lib/studio-refs';
import type { MediaListing, MediaSources, WorkspaceResource } from '@/lib/workspace-resources';
import { LibraryDrawer, type LibraryActions, type SkillsRequest } from '@/components/library/LibraryDrawer';
import { MediaPool, type ImportProgress } from '@/components/MediaPool';
import type { useToast } from '@/components/Toast';
import { WorkspaceLibraryPane } from '@/components/WorkspaceLibraryPane';
import type { useProjectFrame } from './ProjectFrame';
import { useWiring, wiringStore, type Wiring } from './frame';

/** Which the media pane shows, the project's media, the media library or Saved: kept while Studio is open, across projects. */
type MediaScope = 'project' | 'saved';
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
      toast.show(n === 1 ? t('saved.added') : t('saved.addedMany').replace('{n}', String(n)));
    } catch (e) {
      toast.showError(t('saved.failed').replace('{error}', e instanceof Error ? e.message : String(e)));
    }
  }, [projectId, t, toast]);
  const saveFiles = React.useCallback((files: WorkspaceResource[]) => {
    const list = files.map((f) => ({ path: f.path, name: f.name, ...(f.durationMs ? { durationMs: f.durationMs } : {}), ...(f.w ? { w: f.w } : {}), ...(f.h ? { h: f.h } : {}) }));
    void saveThings({ files: list }, list.length);
  }, [saveThings]);
  /* the media pane shows the project's media, or Saved (lib/saved): the same pane, the button beside Upload switches */
  const [mediaScope, setMediaScope] = React.useState<MediaScope>(() => MEDIA_SCOPE.current);
  const switchMedia = React.useCallback((next: MediaScope) => { MEDIA_SCOPE.current = next; setMediaScope(next); }, []);
  const [revealMedia, setRevealMedia] = React.useState<{ path: string; seq: number; highlight: boolean; done?: boolean } | null>(null);
  const mediaRevealed = React.useCallback((seq: number) => {
    setRevealMedia((request) => request?.seq === seq && !request.done ? { ...request, done: true } : request);
  }, []);
  /* the drawer's media: only the project's own; what it took from the library (lib/library fromLibrary) is shown in
     the library's own category, tried there without being listed here */
  const libraryIndex = useLibraryIndex();
  const scopedListing = React.useMemo(() => {
    if (!listing || mediaScope === 'saved') return listing;
    const keep = (f: { path: string }) => f.path === revealMedia?.path || !fromLibrary(f.path, libraryIndex?.items ?? null);
    return { ...listing, files: listing.files.filter(keep), pages: listing.pages.filter(keep) };
  }, [listing, mediaScope, libraryIndex, revealMedia?.path]);
  const savedListing = useSavedListing(mediaScope === 'saved');
  const savedImport = React.useCallback((files: File[], into: string, onProgress: ImportProgress) => importIntoSaved(files, into, onProgress, t('assets.uploadFailed')), [t]);
  /* the file a workbench was just asked to take in hand (showFile), with what it gave the library then: the media
     pane is told that file is in hand until the workbench says what is. The shell and a workbench are drawn one after
     the other, so without it the pane could be drawn on the file asked for before it is known to be the one in hand */
  const [askedInHand, setAskedInHand] = React.useState<{ path: string; of: NonNullable<Wiring['library']> } | null>(null);
  /**
   * Find a file in Assets; the canvas points it out without replacing the editing selection. The pane is opened, and
   * the file is taken in hand by the workbench shown (with the canvas over it, in hand only).
   */
  const showFile = React.useCallback((path: string, highlight = false) => {
    const file = listing ? [...listing.pages, ...listing.files].find((f) => f.path === path) : undefined;
    if (!file) return;
    const library = wiringStore.get()?.library;
    openLibrary(true);
    switchMedia('project');
    if (!highlight && library) { setAskedInHand({ path: file.path, of: library }); library.pick(file, canvasOpen ? { quiet: true } : undefined); }
    setRevealMedia((cur) => ({ path: file.path, seq: (cur?.seq ?? 0) + 1, highlight }));
  }, [listing, canvasOpen, switchMedia, openLibrary]);
  /* the library's skills as the app's chat asked to show them (LibraryDrawer `showSkills`) */
  const [skillsShown, setSkillsShown] = React.useState<SkillsRequest | null>(null);

  return {
    refOfFile, referOutside, onLibraryDownloadFailed, saveThings, saveFiles,
    mediaScope, switchMedia, revealMedia, setRevealMedia, mediaRevealed, libraryIndex, scopedListing, savedListing, savedImport,
    showFile, askedInHand, skillsShown, setSkillsShown,
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
    mediaScope, switchMedia, revealMedia, mediaRevealed, scopedListing, savedListing, savedImport, skillsShown, askedInHand,
    setSettingsOpen, toast, showWorkbench,
    libraryPane: pane, updateWorkspace, setPanelWidth,
  } = frame;
  /* a file of the media pane clicked is taken in hand by the workbench shown (its viewer shows it): by none, nothing */
  const pickFile = React.useCallback((file: WorkspaceResource | null) => { wiringStore.get()?.library?.pick(file); }, []);
  const pickSavedFile = React.useCallback((file: WorkspaceResource | null) => { wiringStore.get()?.library?.pick(file, { saved: true }); }, []);
  const pauseWorkbench = React.useCallback(() => { wiringStore.get()?.pause?.(); }, []);
  const openServices = React.useCallback(() => { setSettingsOpen('models'); }, [setSettingsOpen]);
  /* a plugin with a workbench turned on in the library: where it now is (the edit's views, Motion, on its timeline;
     any other on the top bar's switch), with the way to show it */
  const { show: showToast } = toast;
  const workbenchOn = React.useCallback((plugin: Plugin) => {
    const workbench = plugin.workbench;
    if (!workbench) return;
    const onTimeline = workbench !== 'edit' && plugin.blocks === 'edit';
    showToast(t(onTimeline ? 'assetDrawer.workbenchAddedTimeline' : 'assetDrawer.workbenchAdded'), { label: t('assetDrawer.workbenchOpen'), run: () => showWorkbench(workbench) });
  }, [showToast, showWorkbench, t]);
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
  const media = mediaScope === 'saved' ? (
    <MediaPool
      key="saved"
      projectId={SAVED}
      listing={savedListing}
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
      onAdd={canvasOpen ? (file) => { void requestCanvasFiles(file.path, true); } : library ? (file) => library.add(file, true) : undefined}
    />
  ) : (
    <MediaPool
      key={mediaScope}
      projectId={projectId}
      listing={scopedListing}
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
      onSave={saveFiles}
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
            onPreviewStart={canvasOpen ? pauseWorkbench : library?.preview.begin ?? nothing} onDownloadFailed={onLibraryDownloadFailed} shown={pane.open} under={pane.under}
            captions={library?.captions}
            speak={library?.speak}
            onServices={openServices} projectId={projectId} folder={loaded.project.path} showSkills={skillsShown} onWorkbenchOn={workbenchOn} />
      </WorkspaceLibraryPane>
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
