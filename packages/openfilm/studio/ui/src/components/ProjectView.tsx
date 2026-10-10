/**
 * A project in Studio: the top bar, then the assets, the picture and the inspector side by side, and the timeline
 * across the bottom. Every pane floats on the darker board; the seams between them are the board showing through and
 * can be dragged.
 *
 * The film is film.html in the project folder. Edits made here show at once (applied with the server's own code) and
 * are written one at a time (see editor/use-film.ts); the agent's writes come in through the folder's events.
 */
import * as React from 'react';
import { GalleryVerticalEnd, Layers, LibraryBig, MessageSquarePlus, MonitorDown, Settings2, TriangleAlert } from 'lucide-react';
import { api, ApiError, projectEvents, type Clip, type Film, type Listing, type Op, type ProjectFilm, type ProjectSettings } from '@/api';
import { useT } from '@/i18n';
import { useFilm, type Step } from '@/editor/use-film';
import { Player } from '@/editor/player';
import { Preview, type FilmInfo, type PreviewHandle } from '@/editor/Preview';
import { filmShape, type MediaFacts } from '@/lib/film-shape';
import { layoutTracks, type TimelineBlock, type TimelineTrack } from '@/lib/timeline-layout';
import { filmClipKind, filmSrcIsPage, filmTrackBadges, parseFilmDocLoc, type FilmDoc } from '@/lib/film';
import { footageFps, secondFrames, setTimecodeFps, snapToFrame, stepFrames } from '@/lib/timecode';
import { keyCommandOf, loopBack, playStart, shuttleRate } from '@/lib/timeline-keys';
import { cutPoints, namedTrack, nextCut, trackNamesOf } from '@/lib/timeline-nav';
import { anyLocked, lockedEdits } from '@/lib/track-lock';
import { placeMedia, type SourceRange } from '@/lib/media-place';
import { apartOnTracks, type ClipEdit } from '@/lib/film-clip-edits';
import { mediaFetch } from '@/lib/media-queue';
import { clipboardItemsOf, clipboardNow, pasteEdit, type TimelineClipboardItem } from '@/lib/timeline-clipboard';
import { editModelOf, freshLink, linkedIds, planMove, planRippleTrim, planRoom, planSpeed, soundTrackFor, type EditMode } from '@/lib/timeline-edit';
import { readTimelinePrefs } from '@/lib/timeline-prefs';
import { fadeMsOf, type FadeMs } from '@/lib/clip-fade';
import {
  findTransitions, planRemoveTransition, planResizeTransition, planTransition, TRANSITION_MS, WHITE_PAGE,
  type ClipFacts, type TransitionAsk, type TransitionPlan,
} from '@/lib/transitions';
import { frameMs } from '@/lib/timecode';
import { splitHalves } from '@/lib/timeline-split';
import { assetDropInsert, assetRunInsert, assetRunMs, pendingDropOf, soundLaneHit, withPendingBlocks, type AssetDropTarget, type AssetLaneHit, type AssetRunInsert, type PendingDrop } from '@/lib/asset-timeline';
import { isComputerFileDrag, type ResourceDragItem } from '@/lib/resource-drag';
import { ladderStepMs, THUMB_CELL_PX, thumbAnchorTimes } from '@/lib/thumb-cache';
import { clipThumbId } from '@/lib/thumb-frame';
import { useLoadedThumbs } from '@/lib/use-loaded-thumbs';
import { droppedOverrides, overrideTarget, undoneFields, type DroppedEdits, type PersonEdit } from '@/lib/dropped-overrides';
import { filmFrameBox, filmFrameOf, type FilmFrameId } from '@/lib/film-frame';
import { factsOfProbe, mediaListingOf, resourceKindOf, srcHitsAsset, warmProjectMedia, type MediaListing, type MediaResult, type MediaSources, type WorkspaceResource } from '@/lib/workspace-resources';
import { BrandLoadingScreen } from './BrandLoadingScreen';
import { BrandLogo } from './BrandLogo';
import { SettingsModal, type SettingsSection } from './settings/SettingsModal';
import { DesktopDialog } from './DesktopDialog';
import type { ContextMenuEntry } from './ContextMenu';
import { studioHost, useHostPanel, type HostPanel, type StageBox, type StudioCommand, type StudioRef } from '../lib/host';
import { clipRef, fileRef, layerRef, markRange, momentRef, rangeRef, regionRef, stillUrl, subtitleRef, trackRef, type ClipFrameSource, type FilmRange } from '@/lib/studio-refs';
import { boxNow, chatPointOf, draftBoxesAt, draftMarksOf, sameClip, NO_DRAFT, type DraftMarks, type PictureMarks } from '@/lib/chat-marks';
import { shortcutHint } from '@/lib/shortcut-hint';
import { usePageChanges } from './use-page-changes';
import { SubtitleOverlay } from './SubtitleOverlay';
import { SubtitleInspector, subtitleLineKey, type SubtitleLineAt, type SubtitleLineRefer } from './SubtitleInspector';
import { useFilmSubtitles } from '@/lib/use-film-subtitles';
import { speakerAt, useSubtitleEdits } from '@/lib/use-subtitle-edits';
import { cueAt, filmSubtitleStyleFor, sameFilmSubtitleLanguage } from '@/lib/subtitles';
import { DEFAULT_INSPECTOR, DOCK_GAP, DockPaneDivider, MIN_DOCK_H, MIN_INSPECTOR, MIN_STAGE_H, MIN_VIEWER, PaneDivider, usePaneSize } from './PaneDivider';
import { PANE_BAR, PANE_BTN_ON, PANE_TOGGLE, PANE_TOGGLE_ICON } from './dock-pane-bar';
import { Tooltip } from './Tooltip';
import { MediaPool } from './MediaPool';
import type { SubtitleRowSpec } from './SubtitleRow';
import { LayersPanel } from './LayersPanel';
import type { LayerRow } from '@/lib/layers-tree';
import { SourcePreview } from './SourcePreview';
import { ResourceInspector } from './ResourceInspector';
import { FilmInspector } from './FilmInspector';
import { Timeline, timelineFitHeight, type TimelineCommands, type TimelineHistory } from './Timeline';
import { useEditorTools } from './use-editor-tools';
import { AudioMeters, METERS_W } from './AudioMeters';
import { trackFlagStep, type SessionTimeline } from './OperationHistory';
import { ProjectLayoutMenu } from './ProjectLayoutMenu';
import { ProjectMenu } from './ProjectMenu';
import { ProjectHistoryButton, ProjectHistoryControls } from './ProjectHistoryControls';
import { useProjectHistory } from './use-project-history';
import { ProjectsPopover } from './ProjectsLibrary';
import { FramePicker, useDeliveryFrame } from './FramePicker';
import { FilmFullscreenBar, useFullscreenKeys } from './FilmFullscreenBar';
import { ViewerBar } from './ViewerBar';
import { LiveTime, type PlaybackClock } from './LiveTime';
import { Toast, useToast } from './Toast';
import { SpendAsks } from './SpendAsks';
import { ExportCenter } from './export/ExportCenter';
import { ExportTray, type ExportTrayHandle } from './export/ExportTray';
import { FilmStageSelect, type FilmStageControl, type LayerGeometry, type StageClipEdit, type StagePick } from './FilmStageSelect';
import { openSection } from './inspector-fields';
import { FontScopeContext, type FontScope } from '@/lib/use-fonts';
import { stageMenu, stageRecoveryMenu, type StageArrangeResult, type StageMenuContext } from './stage-menu';
import type { StageEditFailure, StageTextEdit } from './FilmInspector';
import { layerTarget, pageClipOf, recoverLayer } from '@/lib/stage-layers';
import type { MaskSession } from '@/lib/stage-mask';
import { nextOverrides, overrideOf, type OverrideGeometry } from '@/lib/film-overrides';
import { compactScale, type MgTransform, type NodeOverride, type OverridePivot, type StageElement, type StageElementStyle, type StageGeometry } from '@/lib/stage-types';
import { isTypingTarget } from './typing-target';

const PANE = 'relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[7px]';
/* ⌘ is the modifier on a Mac, Ctrl elsewhere (the editor's keys, lib/timeline-keys) */
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** where the app's panel starts: under Studio's top bar (its h-8) */
const HOST_PANEL_TOP = 32;

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
const TIMELINE_H = 200;
const TIMELINE_SHARE = 0.45;
const TIMELINE_SPARE = 48;
const VIEWER_BESIDE_ASSETS = 440;
const TITLE_MAX_CHARS = 56;
const TOP_BTN =
  'flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]';

const fitBox = (w: number, h: number): React.CSSProperties => ({
  width: `min(100cqw, 100cqh * ${w} / ${h})`,
  height: `min(100cqh, 100cqw * ${h} / ${w})`,
});
const clampTitle = (title: string) => (title.length > TITLE_MAX_CHARS ? `${title.slice(0, TITLE_MAX_CHARS)}…` : title);

/**
 * Which edit-history label a batch of clip edits gets: by its most telling property; a track's switch by its badge; a
 * move or a trim of one or two clips by their names ("Moved title2").
 */
function editStepLabel(edits: readonly ClipEdit[], tracks: readonly TimelineTrack[]): string {
  const props = new Set(edits.map((e) => e.prop));
  const [first] = edits;
  if (first && props.size === 1 && (first.prop === 'locked' || first.prop === 'hidden' || first.prop === 'muted')) {
    const badge = tracks.find((tr) => tr.docIndex === parseFilmDocLoc(first.loc)?.track)?.badge ?? '';
    return trackFlagStep(first.prop, first.value === true, badge);
  }
  if (props.has('box')) return 'history.stepTransform';
  if (props.has('fade')) return 'history.stepFade';
  if (props.has('volume') || props.has('muted')) return 'history.stepVolume';
  if (props.has('trackOrder')) return 'history.stepTrackOrder';
  if (props.has('locked') || props.has('hidden')) return 'history.stepTrackFlag';
  if (['at', 'start', 'end', 'track'].some((p) => props.has(p))) {
    const blocks = tracks.flatMap((tr) => tr.blocks);
    const names = [...new Set(edits.map((e) => blocks.find((b) => b.loc === e.loc)?.clipId ?? ''))];
    if (names.some((n) => !n) || names.length > 2) return 'history.stepMove';
    return clipStep(props.has('start') || props.has('end') ? 'history.stepTrimmed' : 'history.stepMoved', names);
  }
  return 'history.stepStyle';
}

/** The white page under a dip to white (studio/server/transition-pages.mjs keeps it once). */
const WHITE_SRC = 'transitions/white.html';

/** An edit-history label naming the clips it was done to (see OperationHistory's stepText): "Deleted slow". */
const clipStep = (key: string, ids: readonly string[]) => `${key}|${ids.join(', ')}`;

/** The project's id-named clips by their place in film.html (`film.html#t.c`). */
function clipIdAt(film: Film | null, loc: string): string | null {
  const at = parseFilmDocLoc(loc);
  return at ? film?.tracks[at.track]?.clips[at.clip]?.id ?? null : null;
}

export function ProjectView({ projectId, onProject, onLeave }: {
  projectId: string;
  /** go to another project */
  onProject: (id: string) => void;
  /** this project was taken off the list (or is gone): leave it */
  onLeave: () => void;
}) {
  const t = useT();
  const toast = useToast();
  /* how many times the project's files changed since it opened (see the folder events below) */
  const [filesTick, setFilesTick] = React.useState(0);
  const [loaded, setLoaded] = React.useState<ProjectFilm | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  /** why the picture could not draw the film (shown on the stage; the timeline then places clips by film.html alone) */
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const previewErrorRef = React.useRef(previewError);
  previewErrorRef.current = previewError;
  const [rawListing, setRawListing] = React.useState<Listing | null>(null);
  const [facts, setFacts] = React.useState<Map<string, ReturnType<typeof factsOfProbe> & { audio?: boolean }>>(new Map());
  const [info, setInfo] = React.useState<FilmInfo | null>(null);
  const preview = React.useRef<PreviewHandle>(null);

  /* ── the project, its film and its files ── */
  React.useEffect(() => {
    api.film(projectId).then(setLoaded, (e: Error) => setFailure(e.message));
    void api.opened(projectId).catch(() => {});
    const loadFiles = () => api.files(projectId).then(setRawListing, () => {});
    void loadFiles();
    return projectEvents(projectId, (event) => {
      /* a picture that could not be drawn is tried again whenever the folder changes: the missing file arrived, or
         the clip that named it is gone from film.html now that the edit is written */
      if (previewErrorRef.current && (event.type === 'film' || event.type === 'files')) { preview.current?.reload?.(); }
      if (event.type !== 'files') return;
      void loadFiles();
      /* a page's picture depends on the files it loads (its styles, code, pictures): its thumbnails are asked again
         (the server answers an unchanged one in a word) */
      setFilesTick((n) => n + 1);
      /* a page, or a file pages use, changed on disk: the picture is drawn from them again. So is a media file a clip
         plays, made again in place (a render written over the last one): its element would go on playing what it
         had loaded of the old file. Other media under assets/ are loaded as they are used */
      const used = new Set(blocksRef.current.map((b) => b.src).filter(Boolean));
      if (!event.paths || event.paths.some((path) => !path.startsWith('assets/') || used.has(path))) preview.current?.reload?.();
    });
  }, [projectId]);

  /* the last film the folder had, to tell what an outside write left out (see droppedOverrides) */
  const lastServerDoc = React.useRef<Film | null>(null);
  const [dropped, setDropped] = React.useState<DroppedEdits[] | null>(null);
  /* the person's field edits an outside write changed (see undoneFields), and the steps they were made in. They are
     watched as long as their values are in the film, across any number of outside writes; `settledEdits` are the ones
     the person already put back or left out, and those whose clip went */
  const [undone, setUndone] = React.useState<PersonEdit[]>([]);
  const personSteps = React.useRef<readonly Step[]>([]);
  const settledEdits = React.useRef(new Set<PersonEdit>());
  const initial = React.useMemo(() => (loaded?.doc && loaded.value ? { value: loaded.value, rev: loaded.rev } : null), [loaded]);
  React.useEffect(() => { if (initial) lastServerDoc.current = initial.value; }, [initial]);
  const film = useFilm(projectId, initial, React.useCallback((value: Film, kind: 'edit' | 'server', head?: string) => {
    preview.current?.update(value, head);
    if (kind === 'server') {
      const found = droppedOverrides(lastServerDoc.current as unknown as FilmDoc, value as unknown as FilmDoc);
      if (found.length) setDropped(found);
      /* what the person set (and is still in the film), that this write changed */
      const edits = personSteps.current.flatMap((s) => s.redo.flatMap((op) => (op.op === 'props' ? op.edits : [])));
      /* compared with the film shown here (the person's edits in it), not the folder's last: an edit of theirs being
         written is no change */
      const fields = undoneFields(filmRef.current as unknown as FilmDoc, value as unknown as FilmDoc, edits, settledEdits.current);
      for (const e of fields.gone) settledEdits.current.add(e);
      if (fields.undone.length) {
        const key = (e: PersonEdit) => `${e.clip}\u0000${e.prop}`;
        const fresh = new Set(fields.undone.map(key));
        setUndone((cur) => [...cur.filter((e) => !fresh.has(key(e))), ...fields.undone]);
      }
      lastServerDoc.current = value;
    }
  }, []));
  personSteps.current = film.steps.done;
  const filmRef = React.useRef(film.film);
  filmRef.current = film.film;
  React.useEffect(() => { if (film.error) toast.showError(film.error); }, [film.error, toast]);

  /* media facts (length, size, sound) of the project's video and sound files and its web pages, probed once each: a
     page without a duration has no end, and is dropped on the timeline with a length of its own */
  const probed = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!rawListing) return;
    const wanted = [
      ...rawListing.files.filter((f) => f.kind === 'video' || f.kind === 'audio').map((f) => ({ f, page: false })),
      ...rawListing.pages.map((f) => ({ f, page: true })),
    ];
    for (const { f, page } of wanted) {
      const key = `${f.path}@${f.mtime}`;
      if (probed.current.has(key)) continue;
      probed.current.add(key);
      void mediaFetch(`/api/projects/${encodeURIComponent(projectId)}/media?what=probe&path=${encodeURIComponent(f.path)}&v=${f.mtime}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((probe) => {
          if (!probe) return;
          const facts = { ...factsOfProbe(probe), audio: Boolean(probe.audio), ...(page && !(probe.duration > 0) ? { endless: true } : {}) };
          setFacts((m) => new Map(m).set(f.path, facts));
        }, () => {});
    }
  }, [rawListing, projectId]);

  const folder = loaded?.folder ?? '';
  const mediaSources = React.useMemo<MediaSources>(() => {
    const media = (what: string, path: string, mtime: number | string) => `/api/projects/${encodeURIComponent(projectId)}/media?what=${what}&path=${encodeURIComponent(path)}&v=${mtime}`;
    return {
      file: (f) => `${folder}${f.path.split('/').map(encodeURIComponent).join('/')}?v=${Math.round(f.mtimeMs)}`,
      poster: (f) => (f.kind === 'video' ? media('poster', f.path, Math.round(f.mtimeMs)) : undefined),
      wave: (f) => media('wave', f.path, Math.round(f.mtimeMs)),
      pagePoster: (f) => media('poster', f.path, `${Math.round(f.mtimeMs)}.${filesTick}`),
      pageSurface: (f) => `${folder}${f.path.split('/').map(encodeURIComponent).join('/')}`,
    };
  }, [projectId, folder, filesTick]);
  const listing = React.useMemo<MediaListing | null>(
    () => (rawListing ? mediaListingOf(rawListing, (path) => facts.get(path), (rawListing as { made?: string[] }).made) : null),
    [rawListing, facts],
  );
  React.useEffect(() => { if (listing) warmProjectMedia(projectId, listing, mediaSources); }, [projectId, listing, mediaSources]);
  /* a file of the media pane as a reference: shown by its poster (a video, a page) or itself (a still, on Studio's
     origin: see stillUrl) */
  const refOfFile = React.useCallback((file: WorkspaceResource) => fileRef(file, file.kind === 'mg' ? mediaSources.pagePoster?.(file)
    : file.kind === 'image' ? stillUrl(projectId, file.path, Math.round(file.mtimeMs)) : file.kind === 'video' ? mediaSources.poster?.(file) : undefined), [mediaSources, projectId]);

  /* ── transport: the sound is the clock; the picture follows it ── */
  const player = React.useRef(new Player());
  React.useEffect(() => () => player.current.close(), []);
  const [playing, setPlaying] = React.useState(false);
  const [timeMs, setTimeMs] = React.useState(0);
  const timeRef = React.useRef(0);
  timeRef.current = timeMs;
  const listeners = React.useRef(new Set<() => void>());
  /* where playback stops by itself (Play range: the range's end), ms; null: the film's end */
  const stopAtRef = React.useRef<number | null>(null);
  /* loop playback (⇧L, the viewer's button): the range marked, else the whole film, over and over */
  const [loop, setLoop] = React.useState(false);
  const loopRef = React.useRef(loop);
  loopRef.current = loop;
  /* the range marked (set below, with the timeline's): what loops */
  const rangeNowRef = React.useRef<FilmRange | null>(null);
  const clock = React.useMemo<PlaybackClock>(() => ({
    get: () => player.current.time() * 1000,
    subscribe: (fn) => { listeners.current.add(fn); return () => listeners.current.delete(fn); },
  }), []);
  /* the player never says 0 (it divides by its length): an empty film is 0.001 s long, here 0 */
  const drawnMs = (info?.duration ?? 0) > 0.001 ? Math.round(info!.duration * 1000) : 0;
  /* the picture at t: at the film's very end (where nothing plays any more) its last frame, not black */
  const pictureAt = (t: number) => { const d = player.current.duration; return d > 0 ? Math.min(t, d - 1e-3) : t; };

  React.useEffect(() => {
    if (!playing) return undefined;
    let frame = 0;
    let lastTick = 0;
    const tick = (now: number) => {
      const t = player.current.time();
      /* looping: back to the start of what loops once its end is reached */
      const back = loopRef.current ? loopBack(t * 1000, rangeNowRef.current, player.current.duration * 1000) : null;
      if (back != null) {
        stopAtRef.current = null;
        player.current.seek(back / 1000);
        preview.current?.seek(pictureAt(back / 1000));
        setTimeMs(back);
        for (const fn of listeners.current) fn();
        frame = requestAnimationFrame(tick);
        return;
      }
      const stopAt = stopAtRef.current;
      if (stopAt != null && t * 1000 >= stopAt) {
        stopAtRef.current = null;
        player.current.pause();
        player.current.seek(stopAt / 1000);
        setPlaying(false);
        setTimeMs(stopAt);
        preview.current?.seek(pictureAt(stopAt / 1000));
        for (const fn of listeners.current) fn();
        return;
      }
      preview.current?.seek(pictureAt(t));
      for (const fn of listeners.current) fn();
      /* the rest of the editor hears the time a few times a second; the playhead and timecode read the clock */
      if (now - lastTick > 50) { lastTick = now; setTimeMs(t * 1000); }
      if (!player.current.playing || t >= player.current.duration - 1e-3) {
        player.current.pause();
        setPlaying(false);
        setTimeMs(player.current.time() * 1000);
        preview.current?.seek(pictureAt(player.current.time()));
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const seek = React.useCallback((ms: number) => {
    const t = Math.max(0, Math.min(ms / 1000, player.current.duration || ms / 1000));
    player.current.seek(t);
    setTimeMs(t * 1000);
    preview.current?.seek(pictureAt(t));
    for (const fn of listeners.current) fn();
  }, []);
  /* ── J / K / L: the shuttle. 1× and 2× forward are the player's own (with sound); faster, or backwards, the picture
     alone is sought along at that rate, silent, as a scrub is (the player plays forward only, at most 2×) ── */
  const shuttleRateRef = React.useRef(0);
  const shuttleFrame = React.useRef(0);
  /** The shuttle let go: the player back at 1× if the shuttle changed its rate. */
  const stopShuttle = React.useCallback(() => {
    if (shuttleFrame.current) cancelAnimationFrame(shuttleFrame.current);
    shuttleFrame.current = 0;
    if (shuttleRateRef.current !== 0 && player.current.rate !== 1) { player.current.setRate(1); setRateState(1); }
    shuttleRateRef.current = 0;
  }, []);
  const pause = React.useCallback(() => {
    stopAtRef.current = null;
    /* a picture-alone shuttle stops too */
    if (shuttleFrame.current) { cancelAnimationFrame(shuttleFrame.current); shuttleFrame.current = 0; shuttleRateRef.current = 0; }
    if (!player.current.playing) return;
    player.current.pause();
    setPlaying(false);
    setTimeMs(player.current.time() * 1000);
    preview.current?.seek(pictureAt(player.current.time()));
  }, []);
  const toggle = React.useCallback(() => {
    stopShuttle();
    if (player.current.playing) { pause(); return; }
    if (!(player.current.duration > 0)) return;
    stopAtRef.current = null;
    /* looping, it starts inside what loops */
    if (loopRef.current) {
      const from = playStart(player.current.time() * 1000, rangeNowRef.current, player.current.duration * 1000);
      if (Math.abs(from - player.current.time() * 1000) > 1) seek(from);
    }
    void player.current.play();
    setPlaying(true);
  }, [pause, seek]);
  /** J, K or L pressed (see lib/timeline-keys shuttleRate). */
  const shuttle = React.useCallback((key: 'j' | 'k' | 'l') => {
    const was = shuttleRateRef.current || (player.current.playing ? player.current.rate : 0);
    const rate = shuttleRate(was, key);
    if (rate === 0) { stopShuttle(); pause(); return; }
    if (!(player.current.duration > 0)) return;
    if (rate > 0 && rate <= 2) {
      if (shuttleFrame.current) { cancelAnimationFrame(shuttleFrame.current); shuttleFrame.current = 0; }
      shuttleRateRef.current = rate;
      player.current.setRate(rate);
      setRateState(player.current.rate);
      if (!player.current.playing) { stopAtRef.current = null; void player.current.play(); setPlaying(true); }
      return;
    }
    pause();
    shuttleRateRef.current = rate;
    const end = player.current.duration * 1000;
    let at = player.current.time() * 1000;
    let last = performance.now();
    let told = 0;
    const step = (now: number) => {
      at = Math.max(0, Math.min(end, at + (now - last) * rate));
      last = now;
      const done = at <= 0 || at >= end;
      /* the picture is told every 40 ms, as a scrub tells it */
      if (now - told >= 40 || done) { told = now; seek(at); }
      if (done) { shuttleFrame.current = 0; shuttleRateRef.current = 0; return; }
      shuttleFrame.current = requestAnimationFrame(step);
    };
    shuttleFrame.current = requestAnimationFrame(step);
  }, [pause, seek, stopShuttle]);
  React.useEffect(() => () => { if (shuttleFrame.current) cancelAnimationFrame(shuttleFrame.current); }, []);
  /* the selection bar's Play range: from its start, stopping at its end */
  const playRange = React.useCallback((range: FilmRange) => {
    pause();
    if (!(player.current.duration > 0)) return;
    seek(range.startMs);
    stopAtRef.current = range.endMs;
    void player.current.play();
    setPlaying(true);
  }, [pause, seek]);
  /* a browser that held the sound back lets it start on the next click or key anywhere on the page */
  React.useEffect(() => {
    const wake = () => player.current.wake();
    window.addEventListener('pointerdown', wake, true);
    window.addEventListener('keydown', wake, true);
    return () => { window.removeEventListener('pointerdown', wake, true); window.removeEventListener('keydown', wake, true); };
  }, []);
  /* scrubbing the timeline pauses, and stays paused */
  const scrubPreview = React.useCallback((ms: number) => { pause(); seek(ms); }, [pause, seek]);
  const scrubCommit = React.useCallback((ms: number) => { pause(); seek(ms); }, [pause, seek]);

  /* a seek asked for past the film's end as it was (the end of a clip just put on): made once the film is that long */
  const seekWhenLonger = React.useRef<number | null>(null);
  const onInfo = React.useCallback((next: FilmInfo) => {
    setInfo(next);
    if (loaded) player.current.load(new URL(loaded.folder).origin, next.sounds, next.duration);
    const want = seekWhenLonger.current;
    if (want != null && next.duration * 1000 >= want - 1) { seekWhenLonger.current = null; seek(want); }
  }, [loaded, seek]);

  /* ── the timeline: film.html + where the preview placed each clip ── */
  const spans = React.useMemo(() => info?.spans ?? [], [info]);
  /* a file's length draws a clip that plays to its end before the preview places it (a split's second half, a drop) */
  const mediaFacts = React.useMemo<MediaFacts>(() => new Map([...facts].map(([path, f]) => [path, { audio: f.audio, ...(f.durationMs ? { duration: f.durationMs / 1000 } : {}) }])), [facts]);
  const [pendingDrops, setPendingDrops] = React.useState<PendingDrop[]>([]);
  const timelineTracks = React.useMemo<TimelineTrack[]>(() => {
    if (!film.film) return [];
    const base = layoutTracks(filmShape(film.film as unknown as FilmDoc, info?.spans ?? [], mediaFacts, Boolean(previewError)));
    return pendingDrops.length ? withPendingBlocks(base, pendingDrops) : base;
  }, [film.film, info, mediaFacts, pendingDrops, previewError]);
  const tracksRef = React.useRef(timelineTracks);
  tracksRef.current = timelineTracks;
  /* the clips' links (`data-link`, by clip id): clips sharing one are edited together (lib/timeline-edit) */
  const clipLinks = React.useMemo(() => new Map((film.film?.tracks ?? []).flatMap((tr) => tr.clips.flatMap((c) => (
    c.attrs?.['data-link'] ? [[c.id, c.attrs['data-link']] as const] : []
  )))), [film.film]);
  const clipLinksRef = React.useRef(clipLinks);
  clipLinksRef.current = clipLinks;
  /** The timeline as an edit sees it now (lib/timeline-edit). */
  const editModel = React.useCallback(() => editModelOf(tracksRef.current, clipLinksRef.current), []);
  const blocksRef = React.useRef<readonly TimelineBlock[]>([]);
  blocksRef.current = React.useMemo(() => timelineTracks.flatMap((tr) => tr.blocks), [timelineTracks]);
  /* the film's length: the preview's, unless it could not draw the film; that length is then of the film before
     (a clip that lost its length still counted at its old one), and the timeline's own reading of film.html stands,
     less the clips that have no length (drawn at a stand-in one) */
  const totalMs = previewError ? blocksRef.current.reduce((end, b) => (b.noLength ? end : Math.max(end, Math.round(b.endMs))), 0) : drawnMs;

  /* ── the project's editor settings (`.film/settings.json`): its frame rate, its tracks' names ── */
  const [settings, setSettings] = React.useState<ProjectSettings | null>(null);
  React.useEffect(() => {
    setSettings(null);
    void api.settings(projectId).then(setSettings, () => setSettings({}));
  }, [projectId]);
  const patchSettings = React.useCallback((patch: Parameters<typeof api.patchSettings>[1]) => {
    void api.patchSettings(projectId, patch).then(setSettings, (e: Error) => toast.showError(e.message));
  }, [projectId, toast]);
  /* the rate frames are counted in: the project's own, else its first footage's (on the film by time, then the
     project's other videos), else 30 */
  const footageRate = React.useMemo(() => footageFps([
    ...timelineTracks.flatMap((tr) => tr.blocks).filter((b) => b.kind === 'video' && b.src).sort((a, b) => a.startMs - b.startMs).map((b) => facts.get(b.src!)?.fps),
    ...(rawListing?.files ?? []).filter((f) => f.kind === 'video').map((f) => facts.get(f.path)?.fps),
  ]), [timelineTracks, rawListing, facts]);
  const projectFps = settings?.fps ?? footageRate;
  React.useEffect(() => { setTimecodeFps(projectFps); }, [projectFps]);
  React.useEffect(() => () => setTimecodeFps(30), []);
  const frameRate = React.useMemo(() => ({ fps: projectFps, fromFootage: settings?.fps == null, onChange: (fps: number) => patchSettings({ fps }) }), [projectFps, settings, patchSettings]);
  /* tracks' names, by film.html track index (found again by their clips: lib/timeline-nav trackNamesOf) */
  const trackNames = React.useMemo(() => trackNamesOf(settings?.trackNames ?? [], film.film?.tracks ?? []), [settings, film.film]);
  const renameTrack = React.useCallback((docIndex: number, name: string) => {
    if ((trackNames.get(docIndex) ?? '') === name.trim()) return;
    patchSettings({ trackNames: namedTrack(settings?.trackNames ?? [], filmRef.current?.tracks ?? [], docIndex, name) });
  }, [trackNames, settings, patchSettings]);

  /* selection, by clip id: a block's own id is its place, and that changes when it moves */
  const [selectedKeys, setSelectedKeys] = React.useState<readonly string[]>([]);
  const selectedBlocks = React.useMemo(() => {
    const keys = new Set(selectedKeys);
    return blocksRef.current.filter((b) => keys.has(b.clipId ?? b.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineTracks, selectedKeys]);
  const selectedIds = React.useMemo(() => selectedBlocks.map((b) => b.id), [selectedBlocks]);
  /* the timeline's commands (⌘B, Q / W, ⌥← / →, its switches), for the keys bound here */
  const timelineCommands = React.useRef<TimelineCommands | null>(null);
  /**
   * The picture has the keyboard (the last press was on it; the inspector and the picture's own bars and menus keep
   * it): the arrow keys move what is in hand there. Anywhere else they move the playhead. Shown by a ring round the
   * picture while something is in hand.
   */
  const [viewerFocus, setViewerFocus] = React.useState(false);
  React.useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (el?.closest?.('[data-viewer-picture]')) { setViewerFocus(true); return; }
      if (el?.closest?.('[data-film-inspector], [data-selection-toolbar], [role="menu"], [data-popover-panel]')) return;
      setViewerFocus(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, []);

  /* ── layout ── */
  const dockColRef = React.useRef<HTMLDivElement | null>(null);
  const viewerRowRef = React.useRef<HTMLDivElement | null>(null);
  const { width: storedTimelineHeight, commit: commitTimelineHeight, saved: timelineHeightSaved } = usePaneSize('openfilm.project.timelineH', TIMELINE_H, MIN_DOCK_H);
  const { width: inspectorWidth, commit: commitInspectorWidth } = usePaneSize('openfilm.project.inspectorW', DEFAULT_INSPECTOR, MIN_INSPECTOR);
  const [assetsPaneOpen, setAssetsPaneOpen] = useKeptFlag('openfilm.project.assets');
  const [assetsWidth, setAssetsWidth] = React.useState(280);
  /* the Layers panel (components/LayersPanel), left of the picture, after the assets */
  const [layersPaneOpen, setLayersPaneOpen] = useKeptFlag('openfilm.project.layers');
  const [layersWidth, setLayersWidth] = React.useState(240);
  const layersPaneRef = React.useRef<HTMLDivElement | null>(null);
  const [timelineOpen, setTimelineOpen] = useKeptFlag('openfilm.project.timeline');
  /* closed until it has something to show (a selection opens it), or the person opens it */
  const [inspectorOpen, persistInspector, setInspectorOpen] = useKeptFlag('openfilm.project.inspector', false);
  const closeInspector = React.useCallback(() => persistInspector(false), [persistInspector]);
  const [rowWidth, setRowWidth] = React.useState(0);
  const [colHeight, setColHeight] = React.useState(0);
  React.useEffect(() => {
    const row = viewerRowRef.current;
    const col = dockColRef.current;
    if (!row || !col) return undefined;
    const ro = new ResizeObserver(([e]) => setRowWidth(Math.round(e?.contentRect.width ?? 0)));
    const co = new ResizeObserver(([e]) => setColHeight(Math.round(e?.contentRect.height ?? 0)));
    ro.observe(row);
    co.observe(col);
    return () => { ro.disconnect(); co.disconnect(); };
  }, [loaded]);
  /* the timeline fits its tracks (not taller than they need, up to 45% of the window) unless the person dragged it */
  const fitTimelineHeight = React.useRef<number>(TIMELINE_H);
  if (!pendingDrops.length) {
    const cap = Math.round(window.innerHeight * 0.45);
    fitTimelineHeight.current = Math.max(TIMELINE_H, Math.min(timelineFitHeight(timelineTracks), cap));
  }
  /* a height the person dragged is theirs, as tall as the picture's minimum allows; until then the tracks' fit (not
     taller than they need, nor than 45% of the column) */
  const timelineHeight = storedTimelineHeight == null ? null : timelineHeightSaved ? storedTimelineHeight : fitTimelineHeight.current;
  const timelineTallest = colHeight ? Math.max(MIN_DOCK_H, colHeight - MIN_STAGE_H - DOCK_GAP) : Infinity;
  const timelineShownHeight = timelineHeightSaved
    ? Math.min(timelineHeight ?? TIMELINE_H, timelineTallest)
    : colHeight
      ? Math.min(timelineHeight ?? TIMELINE_H, fitTimelineHeight.current + TIMELINE_SPARE, Math.max(MIN_DOCK_H, Math.round(colHeight * TIMELINE_SHARE)))
      : Math.min(timelineHeight ?? TIMELINE_H, fitTimelineHeight.current + TIMELINE_SPARE);

  /* what is selected in the picture: a layer of a page, or a clip in hand */
  const [stageElement, setStageElement] = React.useState<StageElement | null>(null);
  /* the inspector's font menu: this project's fonts, for the page the layer in hand is in */
  const stageClipLoc = stageElement?.clipLoc;
  const fontScope = React.useMemo<FontScope>(() => {
    const src = stageClipLoc ? blocksRef.current.find((b) => b.loc === stageClipLoc)?.src : undefined;
    return { projectId, folder, page: src && filmSrcIsPage(src) ? src : null, tick: filesTick };
  }, [projectId, folder, stageClipLoc, filesTick, timelineTracks]);
  /* where the selection bar goes (components/SelectionToolbar): the picture or the timeline, whichever was last pressed */
  const [barAt, setBarAt] = React.useState<'timeline' | 'stage'>('timeline');
  const stageElementRef = React.useRef(stageElement);
  stageElementRef.current = stageElement;
  /* the inspector shows a media file, or what is selected */
  const [pickedMedia, setPickedMedia] = React.useState<WorkspaceResource | null>(null);
  const [inspectorContent, setInspectorContent] = React.useState<'selection' | 'subtitles' | WorkspaceResource>('selection');
  const subs = useFilmSubtitles(projectId);
  /* fullscreen's CC button (and c): only what is shown, not the film's own setting */
  const [captionsOn, setCaptionsOn] = React.useState(true);
  const configureSubtitles = React.useCallback(() => {
    setInspectorContent('subtitles');
    setInspectorOpen(!(inspectorOpen && inspectorContent === 'subtitles'));
  }, [inspectorOpen, inspectorContent]);
  const pickMedia = React.useCallback((file: WorkspaceResource | null) => {
    setPickedMedia(file);
    if (file) { setInspectorContent(file); setInspectorOpen(true); }
    else setInspectorContent((c) => (typeof c === 'object' ? 'selection' : c));
  }, []);
  const onTimelineSelected = React.useCallback((ids: readonly string[]) => {
    setSelectedKeys(blocksRef.current.filter((b) => ids.includes(b.id)).map((b) => b.clipId ?? b.id));
    setPickedTransition(null);
    if (ids.length) {
      setInspectorContent('selection');
      setInspectorOpen(true);
      setStageElement((el) => (el && el.kind !== 'clip' ? null : el));
    }
  }, []);
  const rowNarrow = rowWidth > 0 && rowWidth < MIN_VIEWER + DEFAULT_INSPECTOR + 240;
  const inspectorIdle = inspectorContent === 'selection' && !stageElement && !selectedBlocks.length;
  const inspectorShown = inspectorOpen && !(rowNarrow && inspectorIdle);
  const inspectorWanted = inspectorWidth ?? DEFAULT_INSPECTOR;
  const assetsRoom = rowWidth - (inspectorShown ? inspectorWanted : 0) - VIEWER_BESIDE_ASSETS - 16;
  const assetsShownWidth = rowWidth ? Math.min(assetsWidth, assetsRoom) : assetsWidth;
  const assetsFit = !rowWidth || assetsShownWidth >= 200;
  const inspectorShownWidth = rowWidth && inspectorShown ? Math.max(200, Math.min(inspectorWanted, rowWidth - MIN_VIEWER - 8)) : inspectorWanted;

  /* ── edits: the timeline's and the inspector's, turned into the server's operations by clip id ── */
  /* the picture's controls, set by FilmStageSelect (declared here: every edit asks it to write its arrow keys' first) */
  const stageControl = React.useRef<FilmStageControl | null>(null);
  /**
   * Every edit goes through here: what the arrow keys moved on the picture and is not written yet is written first, so
   * it is a step of its own before this one (and is never written after an undo, over it).
   */
  const filmEdit = film.edit;
  const edit = React.useCallback((ops: Op[], label?: string, quiet?: boolean) => {
    stageControl.current?.flushPending();
    return filmEdit(ops, label, quiet);
  }, [filmEdit]);
  /** `quiet`: the caller shows why an edit was refused itself (the inspector does, beside its field) */
  const editBlocks = React.useCallback((asked: ClipEdit[], quiet = false): Promise<string | null> => {
    const current = filmRef.current;
    /* a locked track is the person's: nothing on it changes, whichever way the edit came (the picture, the inspector) */
    if (lockedEdits(asked, current).length) return Promise.resolve(t('timeline.trackLocked'));
    const edits = apartOnTracks(asked, blocksRef.current);
    const mapped = edits.map((e) => ({ clip: clipIdAt(current, e.loc), prop: e.prop, value: e.value }));
    if (mapped.some((e) => !e.clip)) return Promise.resolve(t('timeline.editFail'));
    return edit([{ op: 'props', edits: mapped as { clip: string; prop: string; value: never }[] }], editStepLabel(edits, tracksRef.current), quiet);
  }, [edit, t]);
  /** An edit the timeline planned (lib/timeline-edit), as it planned it: one write, one undo step. */
  const editOps = React.useCallback((ops: Op[], label: string) => edit(ops, label), [edit]);

  /* ── fades and transitions: each clip's fades (its `overrides`' own entry), and the transitions they make ── */
  const clipFades = React.useMemo(() => new Map<string, FadeMs>((film.film?.tracks ?? []).flatMap((tr) => tr.clips.flatMap((c) => {
    const fade = fadeMsOf(c);
    return fade[0] > 0 || fade[1] > 0 ? [[c.id, fade] as const] : [];
  }))), [film.film]);
  /** What a transition's plan needs of each clip: picture or sound, its fades, whether it is the white page. */
  const clipFacts = React.useMemo(() => {
    const facts = new Map<string, ClipFacts>();
    for (const tr of film.film?.tracks ?? []) {
      for (const c of tr.clips) {
        facts.set(c.id, { picture: filmClipKind(c) !== 'audio', fade: fadeMsOf(c), ...(c.src === WHITE_SRC ? { white: true } : {}) });
      }
    }
    return (id: string) => facts.get(id);
  }, [film.film]);
  const filmTransitions = React.useMemo(() => findTransitions(editModelOf(timelineTracks, clipLinks), clipFacts), [timelineTracks, clipLinks, clipFacts]);
  const [pickedTransition, setPickedTransition] = React.useState<string | null>(null);
  const pickTransition = React.useCallback((key: string | null) => {
    setPickedTransition(key);
    if (key) { setSelectedKeys([]); setInspectorContent('selection'); setInspectorOpen(true); }
  }, []);
  const pickedTr = filmTransitions.find((x) => x.key === pickedTransition) ?? null;
  /**
   * A transition put on a cut, made longer or shorter, or taken away (lib/transitions): planned on the timeline as it
   * is, in the timeline's mode (the magnet, sync lock, linked clips), one write and one undo step. A dip to white first
   * keeps its white page in the project (transitions/white.html).
   */
  const askTransition = React.useCallback(async (ask: TransitionAsk): Promise<string | null> => {
    const prefs = readTimelinePrefs();
    const opts = { ripple: prefs.magnet, sync: prefs.sync, linked: prefs.linked, whiteSrc: WHITE_SRC };
    const model = editModel();
    let plan: TransitionPlan;
    let label: string;
    if (ask.kind === 'add') {
      if (ask.type === 'dip-white') {
        const made = await fetch(`/api/projects/${encodeURIComponent(projectId)}/transition-pages`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'white', html: WHITE_PAGE }),
        }).catch(() => null);
        if (!made?.ok) return t('transitions.failed').replace('{error}', made ? String(made.status) : 'offline');
        await api.files(projectId).then(setRawListing, () => {});
      }
      /* the default length, on the frame grid */
      const frame = frameMs(1);
      plan = planTransition(model, clipFacts, ask.type, ask.cut, Math.round(TRANSITION_MS / frame) * frame, opts);
      label = 'history.stepTransition';
    } else {
      const tr = filmTransitions.find((x) => x.key === ask.key);
      if (!tr) return t('transitions.none');
      plan = ask.kind === 'remove' ? planRemoveTransition(model, clipFacts, tr, opts) : planResizeTransition(model, clipFacts, tr, ask.durationMs, opts);
      label = ask.kind === 'remove' ? 'history.stepTransitionRemove' : 'history.stepTransitionResize';
    }
    if ('error' in plan) return t(plan.error === 'locked' ? 'transitions.locked' : plan.error === 'short' ? 'transitions.short' : 'transitions.none');
    return plan.ops.length ? edit(plan.ops, label) : null;
  }, [editModel, clipFacts, filmTransitions, edit, projectId, t]);
  /**
   * The inspector's edits (its refusals it says beside its field). A new speed goes to the clips linked to the clip too; with the magnet on (the timeline's
   * switch) a speed or a length that makes the clip longer or shorter pushes or pulls what follows, as a ripple trim
   * does; without, a speed too slow to fit before the next clip is refused, and the inspector says why.
   */
  const editClips = React.useCallback((edits: ClipEdit[]): Promise<string | null> => {
    const [one] = edits;
    const block = one && edits.length === 1 ? blocksRef.current.find((b) => b.loc === one.loc) : undefined;
    const prefs = readTimelinePrefs();
    if (block?.loc && lockedEdits(edits, filmRef.current).length) return Promise.resolve(t('timeline.trackLocked'));
    if (!block?.clipId || (one!.prop !== 'speed' && one!.prop !== 'at' && !(one!.prop === 'end' && prefs.magnet))) return editBlocks(edits, true);
    const model = editModel();
    const ids = prefs.linked ? [block.clipId, ...linkedIds(model, [block.clipId]).filter((id) => id !== block.clipId)] : [block.clipId];
    if (one!.prop === 'at') {
      /* a start typed in: the clip (and those linked to it) moves as a drag would, in the timeline's mode: with the
         magnet it goes in at the insert point there and pushes what follows on; without it, it lands there and covers
         what is under it. Never onto a new track */
      const startMs = Number(one!.value) * 1000 + (block.anchor?.parentStartMs ?? 0);
      if (!Number.isFinite(startMs)) return Promise.resolve(t('timeline.editFail'));
      const plan = planMove(model, { ids, deltaMs: startMs - block.startMs, pointerMs: startMs, mode: prefs.magnet ? 'insert' : 'overwrite', sync: prefs.sync });
      if (!plan) return Promise.resolve(t('timeline.trackLocked'));
      return plan.ops.length ? edit(plan.ops, clipStep('history.stepMoved', [block.clipId]), true) : Promise.resolve(null);
    }
    if (one!.prop === 'speed') {
      const speed = typeof one!.value === 'number' ? one!.value : 1;
      const plan = planSpeed(model, ids, speed, { ripple: prefs.magnet, sync: prefs.sync });
      if (plan.slowest != null) return Promise.resolve(t('inspector.speedTooSlow').replace('{n}', String(plan.slowest)));
      return plan.ops.length ? edit(plan.ops, `history.stepSpeed|${block.clipId}`, true) : Promise.resolve(null);
    }
    /* a new length, with the magnet: a ripple trim of the tail by the difference (source seconds over the speed) */
    const k = block.anchor?.trimFrom != null && block.speed ? block.speed : 1;
    const deltaMs = ((Number(one!.value) - Number(one!.from ?? one!.value)) * 1000) / k;
    const plan = planRippleTrim(model, ids, 'end', deltaMs, { sync: prefs.sync });
    return plan.ops.length ? edit(plan.ops, `history.stepRippleTrimmed|${block.clipId}`, true) : Promise.resolve(null);
  }, [editBlocks, editModel, edit, t]);
  const removeBlock = React.useCallback((block: TimelineBlock): Promise<string | null> => {
    if (!block.clipId) return Promise.resolve(t('timeline.removeFail'));
    return edit([{ op: 'remove', clip: block.clipId }], clipStep('history.stepRemoved', [block.clipId]));
  }, [edit, t]);
  const removeBlocks = React.useCallback((blocks: readonly TimelineBlock[]): Promise<string | null> => {
    const ops: Op[] = blocks.flatMap((b) => (b.clipId ? [{ op: 'remove' as const, clip: b.clipId }] : []));
    const gone = blocks.flatMap((b) => (b.clipId ? [b.clipId] : []));
    return ops.length ? edit(ops, gone.length <= 2 ? clipStep('history.stepRemoved', gone) : 'history.stepRemove') : Promise.resolve(null);
  }, [edit]);
  /**
   * Clips split at one moment, in one edit (the timeline sends a clip with the clips linked to it). The right halves
   * of linked clips are linked to each other with a link of their own, as the left halves stay linked.
   */
  const splitBlocks = React.useCallback((blocks: readonly TimelineBlock[], atMs: number): Promise<string | null> => {
    const current = filmRef.current;
    const clips = current?.tracks.flatMap((tr) => tr.clips) ?? [];
    const model = editModel();
    const halves = blocks.flatMap((block) => {
      if (!block.clipId || !block.anchor?.move) return [];
      /* the halves' trims are the source's seconds, and the rest starts exactly where the first half ends */
      const clip = clips.find((c) => c.id === block.clipId);
      const split = splitHalves(block, atMs, Array.isArray(clip?.time) && clip.time.length === 2 ? clip.time[1] : undefined);
      return split ? [{ block, split, link: clip?.attrs?.['data-link'] }] : [];
    });
    if (!halves.length) return Promise.resolve(t('timeline.splitFail'));
    const rightLinks = new Map<string, string>();
    const taken = new Set<string>();
    for (const { link } of halves) {
      if (!link || rightLinks.has(link) || halves.filter((h) => h.link === link).length < 2) continue;
      const made = freshLink(model, `${link}-b`, taken);
      taken.add(made);
      rightLinks.set(link, made);
    }
    const ops: Op[] = halves.map(({ block, split, link }) => ({
      op: 'split',
      clip: block.clipId!,
      left: split.left,
      /* a half left alone with a link (its linked clip not under the cut) keeps none: it would pull the other along */
      right: { ...split.right, link: link ? rightLinks.get(link) ?? null : null },
    }));
    return edit(ops, clipStep('history.stepSplit', halves.slice(0, 2).map((h) => h.block.clipId!)));
  }, [edit, editModel, t]);
  /**
   * A video's sound taken apart from its picture, as an editor unlinks them: the same file's sound alone, at the same
   * seconds and speed, on a sound track that has room for it (a new one under the sound tracks only when none has),
   * linked to the video (`data-link`) so they still move, trim, split and delete together; the video silent from then on.
   */
  const detachAudio = React.useCallback((block: TimelineBlock): Promise<string | null> => {
    const current = filmRef.current;
    const ti = current?.tracks.findIndex((tr) => tr.clips.some((c) => c.id === block.clipId)) ?? -1;
    const clip = ti >= 0 ? current!.tracks[ti]!.clips.find((c) => c.id === block.clipId) : undefined;
    if (!clip || !block.clipId) return Promise.resolve(t('timeline.detachFail'));
    const model = editModel();
    const link = clip.attrs?.['data-link'] ?? freshLink(model, clip.id);
    const sound = {
      src: clip.src,
      sound: true as const,
      ...(clip.at != null ? { at: clip.at } : {}),
      ...(clip.time ? { time: clip.time } : {}),
      ...(clip.speed != null ? { speed: clip.speed } : {}),
      ...(clip.volume != null && clip.volume !== 0 ? { volume: clip.volume } : {}),
      attrs: { 'data-link': link },
    };
    const track = soundTrackFor(model, { startMs: block.startMs, endMs: block.endMs }, ti);
    return edit([
      { op: 'props', edits: [{ clip: block.clipId, prop: 'volume', value: 0 }, { clip: block.clipId, prop: 'link', value: link }] },
      { op: 'insert', clip: sound, track },
    ], clipStep('history.stepDetachAudio', [block.clipId]));
  }, [edit, editModel, t]);
  const [clipboard, setClipboard] = React.useState<readonly TimelineClipboardItem[]>([]);
  /* the clips copied as film.html had them then: a clip cut (⌘X) is gone from the film, and is pasted from these */
  const copiedClips = React.useRef(new Map<string, Clip>());
  const copyBlocks = React.useCallback((blocks: readonly TimelineBlock[]) => {
    const clips = new Map((filmRef.current?.tracks ?? []).flatMap((tr) => tr.clips.map((c) => [c.id, c] as const)));
    copiedClips.current = new Map(blocks.flatMap((b) => {
      const clip = b.clipId ? clips.get(b.clipId) : undefined;
      return clip ? [[clip.id, structuredClone(clip)] as const] : [];
    }));
    setClipboard(clipboardItemsOf(blocks, timelineTracks));
  }, [timelineTracks]);
  /**
   * A paste (⌘V, the menu) at a time, in the timeline's mode: onto the track pointed at (`lane`) or each copy's own,
   * an insert making room there with the magnet on, else an overwrite (lib/timeline-clipboard pasteEdit). Never a new
   * track. A clip cut since it was copied comes back as it was copied (under a new id).
   */
  const pasteAt = React.useCallback((lane: string | null, atMs: number): Promise<string | null> => {
    if (!clipboard.length) return Promise.resolve(t('timeline.menuPasteEmpty'));
    const { items, missing } = clipboardNow(clipboard, timelineTracks);
    const cut = clipboard.filter((item) => !items.some((i) => i.clipId === item.clipId) && copiedClips.current.has(item.clipId));
    if (missing > cut.length) toast.show(t('timeline.pasteGone'));
    const all = [...items, ...cut].sort((a, b) => a.startMs - b.startMs);
    if (!all.length) return Promise.resolve(null);
    const prefs = readTimelinePrefs();
    const ops = pasteEdit(all, timelineTracks, editModel(), atMs, lane, { mode: prefs.magnet ? 'insert' : 'overwrite', sync: prefs.sync });
    if (!ops) return Promise.resolve(t('timeline.trackLocked'));
    const gone = new Set(cut.map((item) => item.clipId));
    const written = ops.map((op): Op => {
      if (op.op !== 'insert' || !op.from || !gone.has(op.from)) return op;
      /* a new id: the place it had may be another clip's by now, and a stale reading of the timeline would edit it */
      const { from, ...rest } = op;
      const { id: _id, ...clip } = structuredClone(copiedClips.current.get(from)!);
      return { ...rest, clip };
    });
    return edit(written, 'history.stepPaste');
  }, [clipboard, timelineTracks, editModel, edit, t, toast]);
  /** Room for clips dropped onto a track (an insert pushes on, an overwrite cuts out): after the inserts, in one edit. */
  const roomFor = React.useCallback((spans: { track: number | { insert: number } | undefined; atSec: number; durMs: number }[], mode?: EditMode): Op[] => {
    const onTracks = spans.flatMap((s) => (typeof s.track === 'number' ? [{ track: s.track, startMs: Math.round(s.atSec * 1000), endMs: Math.round(s.atSec * 1000) + s.durMs }] : []));
    if (!mode || !onTracks.length) return [];
    return planRoom(editModel(), onTracks, { mode, sync: readTimelinePrefs().sync }).ops;
  }, [editModel]);
  const dropAsset = React.useCallback(async (file: ResourceDragItem, target: AssetDropTarget, atMs: number): Promise<string | null> => {
    const plan = assetDropInsert(file, timelineTracks, target, atMs);
    if ('error' in plan) return plan.error === 'locked' ? t('timeline.trackLocked') : t('timeline.dropNotClip');
    const pending = pendingDropOf(file, target, atMs);
    if (pending) setPendingDrops((all) => [...all, pending]);
    try {
      return await edit([
        { op: 'insert', clip: plan.element as never, at: plan.at, ...(plan.track != null ? { track: plan.track } : {}) },
        ...roomFor([{ track: plan.track, atSec: plan.at, durMs: assetRunMs([file]) }], target.edit),
      ], 'history.stepDrop');
    } finally {
      if (pending) setPendingDrops((all) => all.filter((d) => d.id !== pending.id));
    }
  }, [timelineTracks, edit, roomFor, t]);
  /**
   * A media file put on the timeline without a drag (lib/media-place): the media pane's "+" and Enter (in the
   * timeline's mode, at the playhead on the targeted track, else at the end of the main track), the source viewer's
   * `,` and `.` (insert or overwrite the part marked, at the playhead; the playhead then goes to its end, as Premiere's).
   */
  const addMedia = React.useCallback(async (file: WorkspaceResource, how: { mode?: EditMode; range?: SourceRange | null; atPlayhead?: boolean } = {}) => {
    const prefs = readTimelinePrefs();
    const target = timelineCommands.current?.target() ?? null;
    const at = how.atPlayhead || target != null ? snapToFrame(timeRef.current) : 'end';
    const plan = placeMedia(editModel(), { file, range: how.range ?? null, target, at, mode: how.mode ?? (prefs.magnet ? 'insert' : 'overwrite'), sync: prefs.sync });
    if ('error' in plan) { toast.show(plan.error === 'locked' ? t('timeline.trackLocked') : t('timeline.dropNotClip')); return; }
    const failed = await edit(plan.ops, 'history.stepDrop');
    if (failed) { toast.show(failed); return; }
    if (how.atPlayhead) {
      const end = plan.startMs + plan.durMs;
      pause();
      if (end <= player.current.duration * 1000 + 1) seek(end);
      else seekWhenLonger.current = end;
    }
  }, [editModel, edit, pause, seek, t, toast]);
  const placeFromSource = React.useCallback((mode: EditMode, range: SourceRange | null) => {
    if (pickedMedia) void addMedia(pickedMedia, { mode, range, atPlayhead: true });
  }, [addMedia, pickedMedia]);
  /* the subtitle row (components/SubtitleRow): its edits go into the transcripts, each a step of the undo here */
  const subtitleEdits = useSubtitleEdits(projectId, { film: film.film, refresh: subs.refresh, record: film.record });
  const subtitleRow = React.useMemo<SubtitleRowSpec>(() => ({
    cues: subs.captions?.cues ?? [], edits: subtitleEdits,
    speakerAt: (ms) => speakerAt(tracksRef.current, subs.captions?.cues ?? [], ms),
  }), [subs.captions, subtitleEdits]);
  const relinkInputRef = React.useRef<HTMLInputElement>(null);
  const relinkTarget = React.useRef<TimelineBlock | null>(null);
  const relinkBlock = React.useCallback(async (block: TimelineBlock, path: string | null) => {
    if (!block.loc) return;
    if (path == null) { relinkTarget.current = block; relinkInputRef.current?.click(); return; }
    const error = await editBlocks([{ loc: block.loc, prop: 'src', value: path }]);
    if (error) toast.show(error);
  }, [editBlocks, toast]);
  /* a media file going to the trash takes its clips off the timeline first, in one step a person can undo */
  const dropClipsForAssets = React.useCallback((paths: readonly string[]): Promise<string | null> => {
    const doomed = blocksRef.current.filter((b) => !!b.src && paths.some((p) => srcHitsAsset(b.src!, p)));
    return doomed.length ? removeBlocks(doomed) : Promise.resolve(null);
  }, [removeBlocks]);
  /* markers, solo, track heights, loudness, freeze frame, replace (use-editor-tools) */
  const tools = useEditorTools({
    projectId, tracks: timelineTracks, film: film.film, settings, patchSettings, player, timeRef, seek, edit: editOps, editModel,
    selectedClipIds: selectedKeys, listing, toast,
  });

  /* how many of the person's edits an outside write undid: edits inside pages it left out, and clip edits it changed */
  const undoneCount = (dropped ?? []).reduce((n, d) => n + d.dropped.length, 0) + undone.length;
  /* edits left out or undone by an outside write: put them back on the clips as they are now */
  const restoreDropped = React.useCallback(async () => {
    const found = dropped;
    const again = undone;
    setDropped(null);
    setUndone([]);
    for (const e of again) settledEdits.current.add(e);
    if (again.length) { const failed = await film.edit([{ op: 'props', edits: again as never }], 'history.stepRestoreEdits'); if (failed) toast.show(failed); }
    const current = filmRef.current;
    if (!found?.length || !current) return;
    const edits: ClipEdit[] = [];
    for (const d of found) {
      const at = parseFilmDocLoc(d.loc);
      const clip = at ? current.tracks[at.track]?.clips[at.clip] : undefined;
      if (!clip || clip.src !== d.src) continue;
      const have = new Set(((clip.overrides ?? []) as never[]).map(overrideTarget));
      const back = d.dropped.filter((o) => !have.has(overrideTarget(o)));
      if (back.length) edits.push({ loc: d.loc, prop: 'overrides', value: [...(clip.overrides ?? []), ...back] as unknown as Record<string, unknown> });
    }
    if (edits.length) { const failed = await editBlocks(edits); if (failed) toast.show(failed); }
  }, [dropped, undone, film, editBlocks, toast]);

  /* ── the picture: what is selected in it, and its edits (film.html `overrides` on the page clip, `box` on a clip) ── */
  const clipPreviewRef = React.useRef<((clipLoc: string, patch: Partial<MgTransform> | null) => void) | null>(null);
  const lookPreviewRef = React.useRef<((clipLoc: string, css: string | null) => void) | null>(null);
  /* where the thing in hand is, for the inspector only: it changes every frame of a drag */
  const geometryStore = React.useMemo(() => createGeometryStore(), []);
  const [stageSelectRequest, setStageSelectRequest] = React.useState<{ loc: string; clipLoc?: string; seq: number } | null>(null);
  const [inlineTextFailure, setInlineTextFailure] = React.useState<{ loc: string; value: string; failure: StageEditFailure; seq: number } | null>(null);
  const setSelectedLocs = React.useCallback((locs: readonly string[]) => {
    const want = new Set(locs);
    setSelectedKeys(blocksRef.current.filter((b) => b.loc && want.has(b.loc)).map((b) => b.clipId ?? b.id));
  }, []);
  /* the picture and the timeline share one selection of clips; a layer picked in the picture drops the timeline's */
  const selectStageElement = React.useCallback((element: StageElement | null) => {
    setStageElement(element);
    if (element) setInspectorContent('selection');
    if (element && element.kind !== 'clip') { setInspectorOpen(true); setSelectedLocs([]); return; }
    setSelectedLocs(element?.clipLoc ? [element.clipLoc] : []);
  }, [setSelectedLocs]);

  /* ── the app Studio is embedded in (lib/host.ts): what the person points at, handed to it; what it asks to be shown ── */
  const hostPanel = useHostPanel();
  /* an app that hosts Studio can keep the media in a drawer of its own panel (window.openfilmHost panel.assets): no
     left pane then, the viewer first on the left */
  const hostAssets = hostPanel?.assets ?? null;
  const assetsShown = !hostAssets && assetsPaneOpen && assetsFit;
  const layersRoom = rowWidth - (inspectorShown ? inspectorShownWidth : 0) - (assetsShown ? assetsShownWidth : 0) - MIN_VIEWER - 16;
  const layersShownWidth = rowWidth ? Math.min(layersWidth, layersRoom) : layersWidth;
  const layersFit = !rowWidth || layersShownWidth >= 180;
  const layersShown = layersPaneOpen && layersFit;
  const mediaPool = (onClose?: () => void) => (
    <MediaPool
      projectId={projectId}
      listing={listing}
      sources={mediaSources}
      usedSrcs={usedSrcs}
      selectedPath={pickedMedia?.path ?? null}
      onSelectFile={pickMedia}
      onImport={onImport}
      onMove={onMove}
      onDelete={onDelete}
      onExtractAudio={onExtractAudio}
      onNewFolder={onNewFolder}
      onDropClips={dropClipsForAssets}
      onReveal={reveal}
      onClose={onClose}
      {...(studioHost?.refer ? { fileRef: refOfFile, onRefer: studioHost.refer } : {})}
      reveal={revealMedia}
      litPath={chatPoint?.file ?? null}
      onAdd={(file) => void addMedia(file)}
    />
  );
  /* the range marked on the timeline (⇧-drag on the ruler, I and O): Studio's, told to the app with the selection */
  const [markedRange, setMarkedRange] = React.useState<FilmRange | null>(null);
  rangeNowRef.current = markedRange;
  /* the film's stage, for boxes in stage px (film.html's, set below with the picture) */
  const stageRef = React.useRef({ w: 1920, h: 1080 });
  /* a clip's reference shows its own frame, asked by its file's version: set with the thumbnails below, read through a
     ref (the menus' callbacks outlive the render they were made in, and the versions come later) */
  const refSource = React.useRef<ClipFrameSource>({ projectId });
  const refOfBlock = (b: TimelineBlock) => clipRef(b, refSource.current);
  /* a layer where it is drawn now: the picture reports the thing in hand (geometryStore) once it has measured it */
  const refOfLayer = (el: StageElement): StudioRef => {
    const g = geometryStore.get();
    const box: StageBox | null = g?.kind === 'layer' && g.loc === el.loc ? { x: g.x, y: g.y, w: g.w, h: g.h } : null;
    return layerRef(el, { projectId: refSource.current.projectId, ms: timeRef.current, box, stage: stageRef.current });
  };
  const layerPicked = (el: StageElement | null): el is StageElement => Boolean(el && el.kind !== 'clip' && !el.isMgOuter);
  /*
   * The subtitle line being worked on in the subtitle panel (focused there, or words selected in it): picked as a clip
   * is, it comes along with the selection until another line, a clip or a layer is picked, or the panel closes.
   */
  const [subtitlePick, setSubtitlePick] = React.useState<SubtitleLineAt | null>(null);
  const subtitlesShown = inspectorShown && inspectorContent === 'subtitles';
  React.useEffect(() => { if (!subtitlesShown) setSubtitlePick(null); }, [subtitlesShown]);
  React.useEffect(() => { if (selectedBlocks.length || layerPicked(stageElement)) setSubtitlePick(null); }, [selectedBlocks, stageElement]); // eslint-disable-line react-hooks/exhaustive-deps
  const refOfSubtitle = (line: SubtitleLineAt) => subtitleRef(projectId, line.cue, { index: line.index, lang: line.language, text: line.text, pick: line.pick });
  /* the line picked, while the film still has it (a line emptied is gone) */
  const pickedSubtitleRef = (): StudioRef | null => {
    const lines = subs.captions?.cues ?? [];
    return subtitlePick && lines.some((c) => subtitleLineKey(c) === subtitleLineKey(subtitlePick.cue)) ? refOfSubtitle(subtitlePick) : null;
  };
  /* with the subtitle panel open and nothing picked, ⌘L takes the line at the playhead, in the language it shows */
  const subtitleNowRef = (): StudioRef | null => {
    const lines = subs.captions?.cues ?? [];
    const cue = subtitlesShown ? cueAt(lines, timeRef.current) : null;
    if (!cue) return null;
    const lang = subs.style.language && !sameFilmSubtitleLanguage(subs.style.language, subs.sourceLanguage) ? subs.style.language : null;
    const alt = lang ? cue.alt?.[lang] : undefined;
    return refOfSubtitle({ cue, index: lines.indexOf(cue) + 1, language: alt ? lang : null, text: alt ?? cue.text, pick: null });
  };
  const subtitleRefer = React.useMemo<SubtitleLineRefer | undefined>(() => {
    const refer = studioHost?.refer;
    if (!refer) return undefined;
    const same = (a: SubtitleLineAt | null, b: SubtitleLineAt) => !!a && a.cue === b.cue && a.language === b.language && a.text === b.text
      && a.pick?.from === b.pick?.from && a.pick?.to === b.pick?.to;
    return {
      of: refOfSubtitle,
      send: refer,
      pick: (line) => setSubtitlePick((cur) => (same(cur, line) ? cur : line)),
      shortcut: shortcutHint('L', { mod: true }),
    };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  /** A thing in hand on the picture as a reference: a whole clip as its block is, a layer where it is drawn. */
  const refOfStagePick = (pick: StagePick): StudioRef | null => {
    const el = pick.element;
    if (el.kind === 'clip' || el.isMgOuter) {
      const block = el.clipLoc ? blocksRef.current.find((b) => b.loc === el.clipLoc) : undefined;
      return block ? refOfBlock(block) : null;
    }
    return layerRef(el, { projectId: refSource.current.projectId, ms: timeRef.current, box: pick.box, stage: stageRef.current });
  };
  /**
   * What ⌘L references (and the selection bar's "Add to chat"): the subtitle line picked, else the layer picked in the
   * picture (each of several), else each clip selected and the range, else the line at the playhead (the subtitle
   * panel open), else the moment.
   */
  const selectedRefs = (): StudioRef[] => {
    const line = pickedSubtitleRef();
    if (line) return [line];
    const el = stageElementRef.current;
    if (layerPicked(el)) return [refOfLayer(el)];
    const layers = stageControl.current?.picked() ?? [];
    if (layers.length > 1) return layers.flatMap((p) => refOfStagePick(p) ?? []);
    const refs = selectedBlocks.map(refOfBlock);
    if (markedRange) refs.push(rangeRef(projectId, markedRange, blocksRef.current));
    if (refs.length) return refs;
    return [subtitleNowRef() ?? momentRef(projectId, timeRef.current)];
  };
  const hostSelection = studioHost?.onSelection;
  React.useEffect(() => {
    if (!hostSelection) return undefined;
    const timer = setTimeout(() => {
      const refs: StudioRef[] = selectedBlocks.map(refOfBlock);
      if (layerPicked(stageElement)) refs.push(refOfLayer(stageElement));
      const line = pickedSubtitleRef();
      if (line) refs.push(line);
      hostSelection({ projectId, time: Math.round(timeMs) / 1000, refs, range: markedRange ? { start: Math.round(markedRange.startMs) / 1000, end: Math.round(markedRange.endMs) / 1000 } : null, stage: stageRef.current });
    }, 80);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostSelection, projectId, timeMs, selectedBlocks, stageElement, markedRange, subtitlePick, subs.captions]);
  /* a box the app shows on the picture (show-box), flashed there */
  const [flashBox, setFlashBox] = React.useState<{ box: StageBox; seq: number } | null>(null);
  /* a file the app shows in the media pane (show-file): its folder opened, the tile in view */
  const [revealMedia, setRevealMedia] = React.useState<{ path: string; seq: number } | null>(null);
  /* what the app's chat points at (lib/chat-marks): the pill hovered there, the references of the message being written */
  const [chatRef, setChatRef] = React.useState<StudioRef | null>(null);
  const [draftMarks, setDraftMarks] = React.useState<DraftMarks>(NO_DRAFT);
  const hostCommands = React.useRef<(command: StudioCommand) => void>(() => {});
  hostCommands.current = (command) => {
    if (command.type === 'highlight') { setChatRef(command.ref ?? null); return; }
    if (command.type === 'draft-refs') { setDraftMarks(draftMarksOf(Array.isArray(command.refs) ? command.refs : [])); return; }
    if (command.type === 'settings') { setSettingsOpen(command.section ?? 'agents'); return; }
    if (command.type === 'seek' && Number.isFinite(command.time)) { pause(); seek(command.time * 1000); return; }
    if ((command.type === 'show-range' || command.type === 'show-subtitle') && Number.isFinite(command.start) && Number.isFinite(command.end)) {
      /* a subtitle's span marked, and the subtitle panel open: the playhead at its start lights the line there */
      if (command.type === 'show-subtitle') { setInspectorContent('subtitles'); setInspectorOpen(true); }
      const startMs = Math.max(0, Math.min(command.start, command.end) * 1000);
      const endMs = Math.max(command.start, command.end) * 1000;
      if (endMs > startMs) setMarkedRange({ startMs, endMs });
      pause();
      seek(startMs);
      return;
    }
    if (command.type === 'show-box' && Number.isFinite(command.time) && command.box) {
      pause();
      seek(command.time * 1000);
      setFlashBox((cur) => ({ box: command.box, seq: (cur?.seq ?? 0) + 1 }));
      return;
    }
    if (command.type === 'show-track') {
      /* the track's clips selected: the timeline frames them, the inspector shows them */
      const keys = blocksRef.current.filter((b) => b.loc && parseFilmDocLoc(b.loc)?.track === command.track).map((b) => b.clipId ?? b.id);
      if (!keys.length) return;
      setStageElement(null);
      setSelectedKeys(keys);
      return;
    }
    if (command.type === 'show-file') {
      const file = listing ? [...listing.pages, ...listing.files].find((f) => f.path === command.path) : undefined;
      if (!file) return;
      if (hostAssets) hostAssets.setOpen(true);
      else setAssetsPaneOpen(true);
      pickMedia(file);
      setRevealMedia((cur) => ({ path: file.path, seq: (cur?.seq ?? 0) + 1 }));
      return;
    }
    if (command.type !== 'select-clip') return;
    const block = blocksRef.current.find((b) => (command.id && b.clipId === command.id) || (command.loc && b.loc === command.loc));
    if (!block) return;
    setStageElement(null);
    setSelectedKeys([block.clipId ?? block.id]);
    if (command.seek) { pause(); seek(block.startMs); }
  };
  React.useEffect(() => { studioHost?.onCommand?.((command) => hostCommands.current(command)); }, []);
  const chatPoint = React.useMemo(() => chatPointOf(chatRef), [chatRef]);
  const timelineChat = React.useMemo(() => ({
    clip: chatPoint?.clip ?? null, track: chatPoint?.track ?? null, span: chatPoint?.span ?? null, draft: draftMarks,
  }), [chatPoint, draftMarks]);
  /* on the picture: the hovered clip's box while it shows at the playhead, a hovered layer's or region's box and the
     message's numbered ones when the picture is of their moment */
  const chatOnPicture = ((): PictureMarks => {
    const hovered = chatRef?.kind === 'clip' && chatPoint?.clip
      ? blocksRef.current.find((b) => sameClip(chatPoint.clip!, { clipId: b.clipId, loc: b.loc }))
      : undefined;
    const showing = hovered?.loc && (hovered.kind === 'mg' || hovered.kind === 'video') && timeMs >= hovered.startMs && timeMs < hovered.endMs;
    return { clipLoc: showing ? hovered.loc! : null, box: boxNow(chatPoint?.box, timeMs), numbered: draftBoxesAt(draftMarks, timeMs) };
  })();
  /* what the pointer is over, told to the app (its chat lights the pills that point at it) */
  const hostHover = studioHost?.onHover;
  const hoverBlock = React.useCallback((b: TimelineBlock | null) => hostHover?.(b ? refOfBlock(b) : null), [hostHover]); // eslint-disable-line react-hooks/exhaustive-deps
  const hoverLayer = React.useCallback((hit: { element: StageElement; box: StageBox } | null) => {
    hostHover?.(hit ? layerRef(hit.element, { projectId: refSource.current.projectId, ms: timeRef.current, box: hit.box, stage: stageRef.current }) : null);
  }, [hostHover]);
  React.useEffect(() => () => hostHover?.(null), [hostHover]);

  const editStageOverride = React.useCallback(async (
    element: StageElement, rawPatch: OverrideGeometry | null, allCopies = false, pivot?: OverridePivot,
  ): Promise<string | null> => {
    const patch = rawPatch && pivot && stageControl.current ? await stageControl.current.previewOverride(element, rawPatch, pivot) : rawPatch;
    const doc = filmRef.current as unknown as FilmDoc | null;
    const found = doc ? pageClipOf(doc, element) : null;
    const target = layerTarget(element, allCopies);
    if (!found || !target) return t('timeline.editFail');
    const next = nextOverrides(found.clip.overrides, target, patch);
    /* the panel shows the new numbers at once; refused, they go back */
    const now = next ? overrideOf(next, target) : null;
    const before = element.override ?? null;
    setStageElement((el) => (el?.loc === element.loc ? { ...el, override: now ? {
      ...(now.t ? { t: now.t } : {}), ...(now.s != null ? { s: now.s } : {}), ...(now.r != null ? { r: now.r } : {}),
      ...(now.style ? { style: now.style } : {}), ...(now.lock ? { lock: true } : {}), ...(now.text != null ? { text: now.text } : {}),
    } as StageElement['override'] : null } : el));
    const failed = await editBlocks([{ loc: found.loc, prop: 'overrides', value: next as unknown as Record<string, unknown> | null }]);
    if (failed) {
      setStageElement((el) => (el?.loc === element.loc ? { ...el, override: before } : el));
      stageControl.current?.release(element);
    }
    /* a style taken away: the panel reads the page's own value again, once the picture has it */
    if (!failed && (patch === null || patch.style)) {
      window.setTimeout(() => {
        void stageControl.current?.describe(element).then((fresh) => {
          if (fresh) setStageElement((el) => (el?.loc === element.loc ? { ...el, style: fresh.style } : el));
        });
      }, 120);
    }
    return failed;
  }, [editBlocks, t]);
  const editStageOverrideRef = React.useRef(editStageOverride);
  editStageOverrideRef.current = editStageOverride;
  /* several layers at once (moved, hidden, aligned together): one write, one undo step */
  const editStageOverrides = React.useCallback(async (list: ReadonlyArray<{ element: StageElement; patch: OverrideGeometry | null }>): Promise<string | null> => {
    const doc = filmRef.current as unknown as FilmDoc | null;
    if (!doc || !list.length) return t('timeline.editFail');
    const byClip = new Map<string, ReturnType<typeof nextOverrides>>();
    for (const { element, patch } of list) {
      const found = pageClipOf(doc, element);
      const target = layerTarget(element);
      if (!found || !target) continue;
      const prev = byClip.has(found.loc) ? byClip.get(found.loc) ?? undefined : found.clip.overrides;
      byClip.set(found.loc, nextOverrides(prev, target, patch));
    }
    if (!byClip.size) return t('timeline.editFail');
    return editBlocks([...byClip].map(([loc, value]) => ({ loc, prop: 'overrides', value: value as unknown as Record<string, unknown> | null })));
  }, [editBlocks, t]);
  const editStageStyle = React.useCallback(async (loc: string, patch: StageElementStyle): Promise<string | null> => {
    const held = stageElementRef.current;
    if (!held?.clipLoc) return t('timeline.editFail');
    const clean: Record<string, string | number | null> = {};
    for (const [key, v] of Object.entries(patch)) clean[key] = v ?? null;
    const message = await editStageOverrideRef.current(held, { style: clean } as OverrideGeometry);
    if (!message) setStageElement((cur) => (cur && (cur.loc === loc || cur.loc?.split('#')[0] === loc) ? { ...cur, style: { ...cur.style, ...patch } } : cur));
    return message;
  }, [t]);
  const previewStageStyle = React.useCallback((_loc: string, patch: StageElementStyle) => {
    const held = stageElementRef.current;
    if (held) stageControl.current?.previewStyle(held, patch);
  }, []);
  const previewStageText = React.useCallback((_loc: string, v: string) => {
    const held = stageElementRef.current;
    if (held) stageControl.current?.previewText(held, v);
  }, []);
  /* `on`: the element typed in, when it is known (typing in place); the inspector edits the one it shows. A double-click
     selects and types at once, so the element held may still be the one before: written to that, the edit failed */
  const editStageText = React.useCallback(async (e: StageTextEdit, on?: StageElement): Promise<StageEditFailure | null> => {
    const held = on ?? stageElementRef.current;
    if (!held?.clipLoc) return { error: t('timeline.editFail') };
    stageControl.current?.previewText(held, e.value);
    const failed = await editStageOverrideRef.current(held, { text: e.value } as OverrideGeometry);
    if (failed) { stageControl.current?.previewText(held, e.expect); return { error: failed }; }
    setStageElement((el) => (el?.text?.loc === e.loc ? { ...el, text: { ...el.text, value: e.value }, label: e.value.slice(0, 40) } : el));
    return null;
  }, [t]);
  const previewStageOverride = React.useCallback((_loc: string, g: NodeOverride, pivot?: OverridePivot) => {
    const held = stageElementRef.current;
    if (held) void stageControl.current?.previewOverride(held, g as OverrideGeometry, pivot);
  }, []);
  const transformStageLayer = React.useCallback(
    (element: StageElement, g: LayerGeometry) => editStageOverride(element, { t: g.t, s: compactScale(g.s[0], g.s[1]), r: g.r }),
    [editStageOverride],
  );
  const transformStageLayers = React.useCallback((list: ReadonlyArray<{ element: StageElement; g: LayerGeometry }>) => {
    void editStageOverrides(list.map(({ element, g }) => ({ element, patch: { t: g.t, s: compactScale(g.s[0], g.s[1]), r: g.r } })))
      .then((failed) => { if (failed) toast.show(failed); });
  }, [editStageOverrides, toast]);
  const editStageTextInline = React.useCallback(async (element: StageElement, v: string) => {
    const text = element.text;
    if (!text) return t('timeline.editFail');
    const failed = await editStageText({ loc: text.loc, value: v, expect: text.value }, element);
    if (failed) {
      setInlineTextFailure((cur) => ({ loc: text.loc, value: v, failure: failed, seq: (cur?.seq ?? 0) + 1 }));
      return failed.error;
    }
    setInlineTextFailure(null);
    setStageElement((el) => (el?.loc === element.loc && el.text ? { ...el, text: { ...el.text, value: v } } : el));
    return null;
  }, [editStageText, t]);
  const editClipsFromStage = React.useCallback(async (edits: StageClipEdit[]) => {
    const failed = await editBlocks(edits as unknown as ClipEdit[]);
    if (failed) toast.show(failed);
    return failed;
  }, [editBlocks, toast]);
  const selectStageParent = React.useCallback((loc: string, clipLoc?: string) => {
    setStageSelectRequest((cur) => ({ loc, ...(clipLoc ? { clipLoc } : {}), seq: (cur?.seq ?? 0) + 1 }));
  }, []);
  const selectStageClip = React.useCallback((clipLoc: string) => { setStageElement(null); setSelectedLocs([clipLoc]); }, [setSelectedLocs]);
  /* ── the Layers panel: its rows select on the picture, outline there, hide, lock and restack (overrides) ── */
  const [pointedLayer, setPointedLayer] = React.useState<{ clipId: string; loc: string } | null>(null);
  const askStage = React.useCallback(<T,>(op: string, args: object = {}): Promise<T | null> => (
    preview.current?.stage?.<T>(op, args) ?? Promise.resolve(null)
  ), []);
  const layerClipOf = React.useCallback((clipId: string) => {
    const b = blocksRef.current.find((x) => x.clipId === clipId);
    return b ? { label: b.title, kind: b.kind, ...(b.loc ? { loc: b.loc } : {}) } : null;
  }, []);
  const selectLayerRow = React.useCallback((clipId: string, loc: string) => {
    const clipLoc = blocksRef.current.find((b) => b.clipId === clipId)?.loc;
    if (clipLoc) selectStageParent(loc, clipLoc);
  }, [selectStageParent]);
  const layerElement = (clipId: string, at: string, n: number | undefined, label: string): StageElement => (
    { kind: 'box', loc: n ? `${at}#${n}` : at, label, clipId, ...(n ? { instance: n } : {}) }
  );
  const toggleLayerRow = React.useCallback((clipId: string, row: LayerRow, what: 'hidden' | 'locked') => {
    const at = row.instance ? row.loc.slice(0, -`#${row.instance}`.length) : row.loc;
    const patch = what === 'hidden' ? { style: { visibility: row.hidden ? null : 'hidden' } } : { lock: !row.locked };
    void editStageOverrides([{ element: layerElement(clipId, at, row.instance, row.label), patch: patch as OverrideGeometry }]).then((f) => { if (f) toast.show(f); });
  }, [editStageOverrides, toast]); // eslint-disable-line react-hooks/exhaustive-deps
  const restackLayers = React.useCallback((clipId: string, edits: StageArrangeResult['edits']) => {
    void editStageOverrides(edits.map(({ target, style }) => ({ element: layerElement(clipId, target.at, target.n, target.at), patch: { style } as OverrideGeometry })))
      .then((f) => { if (f) toast.show(f); });
  }, [editStageOverrides, toast]); // eslint-disable-line react-hooks/exhaustive-deps
  const previewClip = React.useCallback((clipLoc: string, patch: Partial<MgTransform> | null) => clipPreviewRef.current?.(clipLoc, patch), []);
  const previewLook = React.useCallback((clipLoc: string, css: string | null) => lookPreviewRef.current?.(clipLoc, css), []);
  /* the inspector's Crop: crop mode on the picture, for the video or still in hand there */
  const startStageCrop = React.useCallback(() => { stageControl.current?.startCrop(); }, []);
  const editStageMask = React.useCallback((session: MaskSession | null) => { stageControl.current?.editMask(session); }, []);
  const pageChangesOf = usePageChanges(preview, filmRef);
  /* a clip's own CSS as film.html has it, and the look the player measured (the Inspector's Look section) */
  const clipLookOf = React.useCallback((clipLoc: string) => {
    const at = parseFilmDocLoc(clipLoc);
    const clip = at ? filmRef.current?.tracks[at.track]?.clips[at.clip] : undefined;
    if (!clip) return null;
    return { css: typeof clip.style === 'string' ? clip.style : '', look: spans.find((s) => s.id === clip.id)?.look ?? null, cls: clip.class ?? '' };
  }, [spans]);
  const openClipExportRef = React.useRef<(clipId: string) => void>(() => {});
  /* the picture's menu is built before Duplicate is: it reaches it through a ref */
  const duplicateRef = React.useRef<(blocks: readonly TimelineBlock[]) => Promise<string | null>>(async () => null);
  /* the whole clip's actions in the picture's menu: the timeline's own */
  const blockAt = (clipLoc: string) => blocksRef.current.find((b) => b.loc === clipLoc) ?? null;
  /* a clip with the clips linked to it (when the timeline's Linked switch is on), as the timeline acts on them */
  const withLinkedBlocks = (b: TimelineBlock): TimelineBlock[] => {
    if (!b.clipId || !readTimelinePrefs().linked) return [b];
    const ids = new Set(linkedIds(editModel(), [b.clipId]));
    return blocksRef.current.filter((x) => x === b || (x.clipId != null && ids.has(x.clipId)));
  };
  const stageMenuFor = React.useCallback((el: StageElement, ctx: StageMenuContext) => stageMenu(el, ctx, {
    editOverride: (element, patch) => { void editStageOverrideRef.current(element, patch).then((f) => { if (f) toast.show(f); }); },
    editOverrides: (list) => { void editStageOverrides(list).then((f) => { if (f) toast.show(f); }); },
    selectParent: selectStageParent,
    selectClip: selectStageClip,
    notify: (message) => toast.show(message),
    clip: {
      isLocked: (clipLoc) => Boolean(timelineTracks.find((tr) => tr.blocks.some((b) => b.loc === clipLoc))?.locked),
      canSplit: (clipLoc) => { const b = blockAt(clipLoc); const now = timeRef.current; return !!b && now > b.startMs + 100 && now < b.endMs - 100; },
      split: (clipLoc) => {
        const b = blockAt(clipLoc);
        const now = timeRef.current;
        const under = b ? withLinkedBlocks(b).filter((x) => now > x.startMs + 100 && now < x.endMs - 100) : [];
        if (under.length) void splitBlocks(under, now).then((f) => { if (f) toast.show(f); });
      },
      copy: (clipLoc) => { const b = blockAt(clipLoc); if (b) copyBlocks([b]); },
      canPaste: () => clipboard.length > 0,
      paste: (clipLoc) => {
        const lane = timelineTracks.find((tr) => tr.blocks.some((b) => b.loc === clipLoc))?.lane ?? null;
        void pasteAt(lane, timeRef.current).then((f) => { if (f) toast.show(f); });
      },
      /* as ⌘D: right after it on its own track, in the timeline's mode */
      duplicate: (clipLoc) => {
        const b = blockAt(clipLoc);
        if (b?.clipId) void duplicateRef.current(withLinkedBlocks(b));
      },
      bringToFront: (clipLoc) => { const at = parseFilmDocLoc(clipLoc); if (at) void editBlocks([{ loc: clipLoc, prop: 'trackOrder', value: { from: at.track, to: 0 } }]); },
      sendToBack: (clipLoc) => {
        const at = parseFilmDocLoc(clipLoc);
        const last = (filmRef.current?.tracks.length ?? 1) - 1;
        if (at) void editBlocks([{ loc: clipLoc, prop: 'trackOrder', value: { from: at.track, to: last } }]);
      },
      resetTransform: (clipLoc) => { void editBlocks([{ loc: clipLoc, prop: 'box', value: null }]); },
      exportClip: (clipId) => openClipExportRef.current(clipId),
      remove: (clipLoc) => { const b = blockAt(clipLoc); if (b) { void removeBlocks(withLinkedBlocks(b)); setStageElement(null); } },
    },
  }, t), [editStageOverrides, selectStageParent, selectStageClip, splitBlocks, copyBlocks, clipboard, timelineTracks, pasteAt, editBlocks, removeBlocks, t, toast]); // eslint-disable-line react-hooks/exhaustive-deps
  /*
   * "Reference in chat", first on the menus of a clip, a layer and a track, when the app around Studio has a chat.
   * The references are made when it is chosen: a layer right-clicked is measured just after its menu opens. ⌘L does
   * the same for what is selected (the clips or the layer right-clicked are), so a clip's and a layer's item says so.
   */
  const referEntry = (refs: () => StudioRef[], withKey = true): ContextMenuEntry[] => {
    const refer = studioHost?.refer;
    if (!refer) return [];
    return [{
      id: 'refer', label: t('host.refer'), icon: <MessageSquarePlus size={14} />,
      ...(withKey ? { shortcut: shortcutHint('L', { mod: true }) } : {}),
      onSelect: () => { for (const ref of refs()) refer(ref); },
    }];
  };
  const stageMenuWithRefer = React.useCallback((el: StageElement, ctx: StageMenuContext): readonly ContextMenuEntry[] => {
    const entries = stageMenuFor(el, ctx);
    const block = el.clipLoc ? blocksRef.current.find((b) => b.loc === el.clipLoc) : null;
    const whole = el.kind === 'clip' || el.isMgOuter;
    const extra = whole && !block ? [] : referEntry(() => [whole ? refOfBlock(block!) : refOfLayer(el)]);
    return extra.length ? [...extra, ...(entries.length ? [{ id: 'refer-sep', separator: true } as const] : []), ...entries] : entries;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageMenuFor, t]);
  /** Two groups of menu entries, a line between them when both have some. */
  const menuGroups = (a: ContextMenuEntry[], b: ContextMenuEntry[]): ContextMenuEntry[] => (a.length && b.length ? [...a, { id: 'tools-sep', separator: true }, ...b] : [...a, ...b]);
  const timelineMenuExtra = React.useCallback((blocks: readonly TimelineBlock[]) => (blocks.length ? menuGroups(referEntry(() => blocks.map(refOfBlock)), tools.menuExtra(blocks)) : []), [t, tools.menuExtra]); // eslint-disable-line react-hooks/exhaustive-deps
  const trackMenuExtra = React.useCallback((track: TimelineTrack) => {
    const docIndex = track.docIndex;
    const refer = docIndex == null || !studioHost?.refer ? [] : referEntry(() => { const ref = trackRef(tracksRef.current, docIndex); return ref ? [ref] : []; }, false);
    return menuGroups(refer, tools.headMenuExtra(track));
  }, [t, tools.headMenuExtra]); // eslint-disable-line react-hooks/exhaustive-deps
  /* clips dragged out of the timeline onto the app's chat */
  const referBlocks = React.useCallback((blocks: TimelineBlock[]) => { for (const b of blocks) studioHost?.refer?.(refOfBlock(b)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const markedRangeRef = React.useCallback((range: FilmRange) => rangeRef(projectId, range, blocksRef.current), [projectId]);
  /* the selection bar's "Add to chat" (components/SelectionToolbar): on the timeline the clips and the range, or the
     moment of a point picked on the ruler; on the picture what is in hand there */
  const referFromTimeline = React.useCallback((what: { blocks: readonly TimelineBlock[]; range: FilmRange | null; atMs: number | null }) => {
    const refer = studioHost?.refer;
    if (!refer) return;
    if (what.atMs != null) { refer(momentRef(projectId, what.atMs)); return; }
    for (const b of what.blocks) refer(refOfBlock(b));
    if (what.range) refer(rangeRef(projectId, what.range, blocksRef.current));
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const referFromStage = React.useCallback((picks: StagePick[]) => {
    const refer = studioHost?.refer;
    if (!refer) return;
    for (const p of picks) { const ref = refOfStagePick(p); if (ref) refer(ref); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /* the bar's Mask: the inspector open on its Mask section (the shapes are picked there) */
  const openMaskSection = React.useCallback(() => {
    openSection('mask');
    setInspectorContent('selection');
    setInspectorOpen(true);
    window.setTimeout(() => {
      document.querySelector('[data-film-inspector] [data-section="mask"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 60);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * Duplicate (⌘D, the bar's, the picture menu's): copies right after the clips, each on its own track, in the
   * timeline's mode (an insert pushes what follows on, an overwrite covers it), as a paste there is; never a new track.
   */
  const duplicateBlocks = React.useCallback(async (blocks: readonly TimelineBlock[]) => {
    const picked = blocks.filter((b) => b.clipId);
    if (!picked.length) return null;
    const prefs = readTimelinePrefs();
    const tracks = tracksRef.current;
    const ops = pasteEdit(clipboardItemsOf(picked, tracks), tracks, editModel(), Math.max(...picked.map((b) => b.endMs)), null, { mode: prefs.magnet ? 'insert' : 'overwrite', sync: prefs.sync });
    const failed = !ops ? t('timeline.trackLocked') : ops.length ? await edit(ops, picked.length <= 2 ? clipStep('history.stepDuplicated', picked.map((b) => b.clipId!)) : 'history.stepDuplicate') : null;
    if (failed) toast.show(failed);
    return failed;
  }, [editModel, edit, t, toast]);
  duplicateRef.current = duplicateBlocks;
  /* a box drawn on the picture with ⌘ held, at the playhead */
  const referRegion = React.useCallback((region: { box: StageBox; clipIds: string[]; texts: string[] }) => {
    studioHost?.refer?.(regionRef(projectId, timeRef.current, region.box, region, stageRef.current));
  }, [projectId]);
  const recoveryMenu = React.useCallback(() => stageRecoveryMenu(filmRef.current as unknown as FilmDoc, (layer, action) => {
    const doc = filmRef.current as unknown as FilmDoc | null;
    const e = doc && recoverLayer(doc, layer, action);
    if (e) void editBlocks([{ ...e, value: e.value as unknown as Record<string, unknown> | null }]).then((f) => { if (f) toast.show(f); });
  }, t), [editBlocks, t, toast]);
  const selectedLocs = React.useMemo(() => selectedBlocks.flatMap((b) => (b.loc ? [b.loc] : [])), [selectedBlocks]);
  /* what the inspector shows is on a locked track: shown, not changed */
  const inspectorLocked = anyLocked(film.film, [stageElement?.clipLoc, ...selectedLocs]);

  /* ── undo, redo and the edit history ── */
  /** Undo or redo, after what the arrow keys moved on the picture is written (so it is the step undone, not lost). */
  const stepHistory = React.useCallback((kind: 'undo' | 'redo') => {
    stageControl.current?.flushPending();
    if (kind === 'undo') film.undo(); else film.redo();
  }, [film.undo, film.redo]); // eslint-disable-line react-hooks/exhaustive-deps
  const sessionTimeline = React.useMemo<SessionTimeline>(() => ({
    steps: [...film.steps.done, ...[...film.steps.undone].reverse()].map((s) => ({ label: s.label, at: s.at })),
    cursor: film.steps.done.length,
  }), [film.steps]);
  const timelineHistory = React.useMemo<TimelineHistory>(() => ({
    canUndo: film.canUndo,
    canRedo: film.canRedo,
    step: stepHistory,
    ops: sessionTimeline,
    rollbackTo: film.rollbackTo,
  }), [film.canUndo, film.canRedo, stepHistory, film.rollbackTo, sessionTimeline]);

  /* ── thumbnails: video frames from ffmpeg, page frames drawn headless (server), stills as they are ── */
  const [thumbView, setThumbView] = React.useState<{ fromMs: number; toMs: number; pxPerMs: number } | null>(null);
  const mtimeOf = React.useMemo(() => new Map([...(rawListing?.files ?? []), ...(rawListing?.pages ?? [])].map((f) => [f.path, f.mtime])), [rawListing]);
  /* a sound made again in place is heard as it is now, not as it was decoded */
  React.useEffect(() => { player.current.setVersions((src) => mtimeOf.get(src)); }, [mtimeOf]);
  refSource.current = { projectId, version: (path) => mtimeOf.get(path) };
  const thumbs = React.useMemo(() => {
    const out = new Map<string, string>();
    if (!thumbView || !(thumbView.pxPerMs > 0)) return out;
    /* a page's frames change with the files it loads too (filesTick: asked again, an unchanged one answered 304) */
    const media = (path: string, ms: number) => `/api/projects/${encodeURIComponent(projectId)}/media?what=frame&path=${encodeURIComponent(path)}&ms=${Math.round(ms)}&w=${THUMB_CELL_PX * 2}&v=${mtimeOf.get(path) ?? 0}${filmSrcIsPage(path) ? `.${filesTick}` : ''}`;
    const span = thumbView.toMs - thumbView.fromMs;
    const fromMs = Math.max(0, thumbView.fromMs - span);
    const toMs = thumbView.toMs + span;
    const pictures = blocksRef.current.filter((b) => (b.kind === 'mg' || b.kind === 'video') && b.src && b.endMs > fromMs && b.startMs < toMs);
    /* every clip's own shots are asked for before any shot past a clip's edges: the server shoots them in that order,
       and until a clip's own arrive its cells borrow the nearest it has (lib/thumb-pick) — a trimmed clip borrowed the
       frame from before its in-point, often its source's black first frame */
    const margins: Array<[string, string]> = [];
    for (const b of pictures) {
      const still = /\.(png|jpe?g|webp|avif|gif|bmp|svg)$/i.test(b.src!);
      const key = (into: number) => `${mtimeOf.get(b.src!) ?? 0}:${clipThumbId(b)}@${into}#v`;
      if (still) { out.set(key(0), `${folder}${b.src!.split('/').map(encodeURIComponent).join('/')}`); continue; }
      const speed = b.speed && b.speed > 0 ? b.speed : 1;
      const trimMs = (b.anchor?.trimFrom ?? 0) * 1000;
      /* shot on the source's own grid (from its start, a step a cell in source ms), as BlockThumbs draws them: a trim
         keeps the shots and only crops the row. Past the clip's edges too, half a screen each way (and inside the
         file): an edge pulled out shows the source it reveals, not its edge frame again */
      const stepMs = ladderStepMs((THUMB_CELL_PX / thumbView.pxPerMs) * speed);
      const marginMs = (span / 2) * speed;
      const seenFrom = trimMs + (Math.max(b.startMs, fromMs) - b.startMs) * speed;
      const seenTo = trimMs + (Math.min(b.endMs, toMs) - b.startMs) * speed;
      const lo = Math.max(0, seenFrom - (b.startMs >= fromMs ? marginMs : 0));
      /* past the end only when the source's length is known (before it is probed, a shot there is a frame after the
         file's end, which the server refuses) */
      const hi = b.sourceDurMs != null ? Math.min(b.sourceDurMs, seenTo + (b.endMs <= toMs ? marginMs : 0)) : seenTo;
      /* a page's tile shows the frame from its middle, not its first: a scene starts on its fade-in, often blank */
      const lastMs = (b.sourceDurMs ?? Infinity) - 40;
      const grid: number[] = [];
      for (let into = Math.floor(lo / stepMs) * stepMs; into < hi; into += stepMs) grid.push(Math.round(into));
      const own = { startMs: trimMs, endMs: trimMs + (b.endMs - b.startMs) * speed };
      for (const at of [...grid, ...thumbAnchorTimes({ times: grid, spans: [own] })]) {
        const drawn = b.kind === 'mg' ? Math.round(Math.max(at, Math.min(at + stepMs / 2, lastMs))) : at;
        if (at >= own.startMs - stepMs && at <= own.endMs) out.set(key(at), media(b.src!, drawn));
        else margins.push([key(at), media(b.src!, drawn)]);
      }
    }
    for (const [k, u] of margins) if (!out.has(k)) out.set(k, u);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbView, timelineTracks, projectId, mtimeOf, folder, filesTick]);
  /* drawn once loaded: a zoom keeps the pictures it has until the new shots arrive */
  const shownThumbs = useLoadedThumbs(thumbs);
  const posters = React.useMemo(() => {
    const out: Record<string, string> = {};
    for (const b of blocksRef.current) {
      if (!b.src || out[b.src]) continue;
      if (b.kind === 'mg' || (b.kind === 'video' && !/\.(png|jpe?g|webp|avif|gif|bmp|svg)$/i.test(b.src))) {
        out[b.src] = `/api/projects/${encodeURIComponent(projectId)}/media?what=poster&path=${encodeURIComponent(b.src)}&v=${mtimeOf.get(b.src) ?? 0}`;
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineTracks, projectId, mtimeOf]);
  const waveUrl = React.useCallback((src: string) => `/api/projects/${encodeURIComponent(projectId)}/media?what=wave&path=${encodeURIComponent(src)}&v=${mtimeOf.get(src) ?? 0}`, [projectId, mtimeOf]);
  /* clips whose files are gone, and where the same name may be now */
  const mediaTrouble = React.useMemo(() => {
    const out = new Map<string, 'decode' | 'unreachable' | 'missing'>();
    if (!rawListing) return out;
    const paths = new Set([...rawListing.files.map((f) => f.path), ...rawListing.pages.map((p) => p.path)]);
    for (const b of blocksRef.current) if (b.src && (b.src.startsWith('assets/') || /\.html?$/i.test(b.src)) && !paths.has(b.src)) out.set(b.src, 'missing');
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawListing, timelineTracks]);
  const relinkCandidates = React.useCallback((src: string): string[] => {
    const name = src.split('/').pop()?.toLowerCase();
    return name ? (rawListing?.files ?? []).filter((f) => f.path.split('/').pop()?.toLowerCase() === name && f.path !== src).map((f) => f.path) : [];
  }, [rawListing]);
  const usedSrcs = React.useMemo(() => blocksRef.current.flatMap((b) => (b.src ? [b.src] : [])), [timelineTracks]);

  /* ── media pane actions ── */
  const projectApi = `/api/projects/${encodeURIComponent(projectId)}`;
  const mediaResult = async (res: Response): Promise<MediaResult> => (res.ok ? 'ok' : res.status === 409 ? 'taken' : 'failed');
  /* resolves with where each file landed (a taken name gets a number); one that is no readable media is said at once */
  const onImport = React.useCallback(async (files: File[], into: string, onProgress: (ratio: number) => void): Promise<string[]> => {
    let done = 0;
    const landed: string[] = [];
    for (const file of files) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(`${projectApi}/files?path=${encodeURIComponent(`${into}/${file.name}`)}`, { method: 'PUT', body: file });
      // eslint-disable-next-line no-await-in-loop
      const body = await res.json().catch(() => ({})) as { path?: string; error?: string; unreadable?: string };
      if (!res.ok) throw new Error(String(body.error ?? t('assets.uploadFailed')));
      if (body.path) landed.push(body.path);
      if (body.unreadable) toast.show(t('assets.unreadable').replace('{name}', file.name).replace('{why}', body.unreadable));
      onProgress(++done / files.length);
    }
    return landed;
  }, [projectApi, t, toast]);

  /* ── files dropped from the computer: imported into assets/ (the media pane's own import), then put on the film ── */
  /** A file just imported, as the media pane would hand it to a drop: its kind from its name, its length probed. */
  const resourceOf = React.useCallback(async (path: string): Promise<ResourceDragItem> => {
    const kind = resourceKindOf(path);
    const base: ResourceDragItem = { path, name: path.slice(path.lastIndexOf('/') + 1), kind, dir: '', size: 0, mtimeMs: 0 };
    if (kind !== 'video' && kind !== 'audio') return base;
    const probe = await fetch(`${projectApi}/media?what=probe&path=${encodeURIComponent(path)}`).then((r) => (r.ok ? r.json() : null), () => null);
    return { ...base, ...factsOfProbe(probe) };
  }, [projectApi]);
  /**
   * Import `files`, then insert them as `where` says (worked out from their real lengths), making room for them where
   * they land on a track with an edit mode: one step to undo.
   */
  const importAndPlace = React.useCallback(async (
    files: File[],
    where: (items: ResourceDragItem[]) => { inserts: AssetRunInsert[] } | { error: 'not-clip' | 'locked' },
    mode?: EditMode,
  ): Promise<string | null> => {
    let items: ResourceDragItem[];
    try {
      items = await Promise.all((await onImport(files, 'assets', () => {})).map(resourceOf));
    } catch (e) {
      return e instanceof Error && e.message ? e.message : t('assets.uploadFailed');
    }
    const plan = where(items);
    if ('error' in plan) return plan.error === 'locked' ? t('timeline.trackLocked') : t('timeline.dropNotClip');
    const first = plan.inserts[0];
    const last = plan.inserts.at(-1);
    /* the run is one span on its track: from the first's start to the last's end */
    const room = first && last ? roomFor([{ track: first.track, atSec: first.at, durMs: Math.round((last.at - first.at) * 1000) + last.durMs }], mode) : [];
    return edit([
      ...plan.inserts.map((i): Op => ({ op: 'insert', clip: i.element as never, at: i.at, ...(i.track != null ? { track: i.track } : {}) })),
      ...room,
    ], 'history.stepDrop');
  }, [onImport, resourceOf, edit, roomFor, t]);
  /* on the timeline: where they were dropped, as a drag from the media pane lands */
  const dropFiles = React.useCallback((files: File[], hit: AssetLaneHit | null, atMs: number, mode?: EditMode) => (
    importAndPlace(files, (items) => assetRunInsert(items, tracksRef.current, hit, atMs, mode), mode)
  ), [importAndPlace]);
  /* on the picture: at the playhead, pictures on a new track on top, sounds on a sound track */
  const dropFilesOnPicture = React.useCallback((files: File[]) => {
    const atMs = snapToFrame(timeRef.current);
    return importAndPlace(files, (items) => {
      const sounds = items.filter((f) => f.kind === 'audio');
      const pictures = items.filter((f) => f.kind !== 'audio');
      const tracks = tracksRef.current;
      const heard = sounds.length ? assetRunInsert(sounds, tracks, soundLaneHit(tracks, atMs, assetRunMs(sounds)), atMs) : { inserts: [] };
      const seen = pictures.length ? assetRunInsert(pictures, tracks, { lane: -1, band: 'body' }, atMs) : { inserts: [] };
      /* the sounds first: the pictures' new track goes in at the top and moves every track under it down one */
      const inserts = [...('inserts' in heard ? heard.inserts : []), ...('inserts' in seen ? seen.inserts : [])];
      if (inserts.length) return { inserts };
      return 'error' in seen ? seen : 'error' in heard ? heard : { error: 'not-clip' };
    });
  }, [importAndPlace]);
  const [pictureDrop, setPictureDrop] = React.useState(false);
  const pictureDropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!isComputerFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setPictureDrop(true);
    },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPictureDrop(false); },
    onDrop: (e: React.DragEvent) => {
      setPictureDrop(false);
      if (!isComputerFileDrag(e.dataTransfer) || !e.dataTransfer.files.length) return;
      e.preventDefault();
      void dropFilesOnPicture([...e.dataTransfer.files]).then((failed) => { if (failed) toast.show(failed); });
    },
  };
  /* anywhere else in the page a dropped file is imported into the media pane: left to the browser, it would open the
     file in place of Studio. While one is dragged, frames let it through (globals.css) */
  const importDroppedRef = React.useRef<(files: File[]) => void>(() => {});
  importDroppedRef.current = (files) => {
    void onImport(files, 'assets', () => {}).then(
      (landed) => { if (landed.length) toast.show(t('assets.imported').replace('{n}', String(landed.length))); },
      (e: Error) => toast.show(e.message || t('assets.uploadFailed')),
    );
  };
  React.useEffect(() => {
    const root = document.documentElement;
    const done = () => { delete root.dataset.fileDrag; setPictureDrop(false); };
    const over = (e: DragEvent) => {
      if (!e.dataTransfer || !isComputerFileDrag(e.dataTransfer)) return;
      root.dataset.fileDrag = '';
      if (e.defaultPrevented) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) done(); };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer || !isComputerFileDrag(e.dataTransfer)) return;
      if (e.defaultPrevented) return;
      e.preventDefault();
      if (e.dataTransfer.files.length) importDroppedRef.current([...e.dataTransfer.files]);
    };
    window.addEventListener('dragenter', over);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    /* the drag is over wherever it lands, even where the drop goes no further (the timeline keeps it to itself) */
    window.addEventListener('drop', done, true);
    window.addEventListener('drop', drop);
    window.addEventListener('dragend', done);
    return () => {
      done();
      window.removeEventListener('dragenter', over);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', done, true);
      window.removeEventListener('drop', drop);
      window.removeEventListener('dragend', done);
    };
  }, []);
  const onMove = React.useCallback(async (from: string, to: string) => mediaResult(await fetch(`${projectApi}/files`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from, to }),
  })), [projectApi]);
  const onDelete = React.useCallback(async (path: string) => mediaResult(await fetch(`${projectApi}/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' })), [projectApi]);
  const onExtractAudio = React.useCallback(async (path: string) => mediaResult(await fetch(`${projectApi}/files/audio`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }),
  })), [projectApi]);
  const onNewFolder = React.useCallback(async (path: string) => mediaResult(await fetch(`${projectApi}/folders`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }),
  })), [projectApi]);
  const reveal = React.useCallback((path: string) => {
    void fetch(`${projectApi}/reveal`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) });
  }, [projectApi]);

  /* ── picture: the delivery frame, fullscreen ── */
  const stage = film.film?.stage ?? { w: 1920, h: 1080 };
  stageRef.current = stage;
  const [deliveryFrame, setDeliveryFrame] = useDeliveryFrame(projectId);
  const empty = !film.film?.tracks.some((tr) => tr.clips.length);
  const frame: FilmFrameId = empty ? filmFrameOf(stage) : deliveryFrame;
  const frameBox = React.useMemo(() => filmFrameBox(stage, empty ? 'native' : frame), [stage, empty, frame]);
  /* the stage's shape: while nothing is made it is the film's own (written to film.html), after that the frame it is
     delivered in; the viewer's picker and the inspector's film panel both change it this way */
  const changeCanvas = React.useCallback((next: FilmFrameId, size: { w: number; h: number }) => {
    if (!empty) { setDeliveryFrame(next); return; }
    void edit([{ op: 'stage', w: size.w, h: size.h }], 'history.stepEdit');
  }, [empty, edit, setDeliveryFrame]);
  const stageFullRef = React.useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = React.useState(false);
  React.useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageFullRef.current && !!stageFullRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = React.useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageFullRef.current?.requestFullscreen();
  }, []);
  const [volume, setVolumeState] = React.useState(1);
  const [muted, setMutedState] = React.useState(false);
  const [rate, setRateState] = React.useState(1);
  /* full screen only: elsewhere K, M, C and F are the editor's keys */
  useFullscreenKeys({
    enabled: fullscreen,
    onToggle: toggle,
    onToggleMute: () => { player.current.setMuted(!player.current.muted); setMutedState(player.current.muted); },
    onExit: toggleFullscreen,
  });

  /*
   * ── keys (lib/timeline-keys, listed in Settings): Space plays, J / K / L shuttle, I / O mark a range, ← / → step a
   * frame (⇧ a second), ↑ / ↓ go from cut to cut, ⌘Z / ⇧⌘Z undo; the timeline's own (⌘B, Q / W, ⌥← / →, N…) through
   * its commands. Not while typing, nor in a dialog. ──
   */
  const tabbed = React.useRef(false);
  React.useEffect(() => {
    const byKey = (e: KeyboardEvent) => { if (e.key === 'Tab') tabbed.current = true; };
    const byPointer = () => { tabbed.current = false; };
    window.addEventListener('keydown', byKey, true);
    window.addEventListener('pointerdown', byPointer, true);
    return () => { window.removeEventListener('keydown', byKey, true); window.removeEventListener('pointerdown', byPointer, true); };
  }, []);
  /* K held down: J and L step a frame (K+J, K+L) */
  const kHeld = React.useRef(false);
  React.useEffect(() => {
    const up = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'k' || e.code === 'KeyK') kHeld.current = false; };
    const lost = () => { kHeld.current = false; };
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', lost);
    return () => { window.removeEventListener('keyup', up, true); window.removeEventListener('blur', lost); };
  }, []);
  /**
   * With an app that has a chat (lib/host.ts `refer`): ⌘L (Ctrl+L) references what is selected (selectedRefs). True:
   * the key was taken.
   */
  const referKeysRef = React.useRef<(event: KeyboardEvent) => boolean>(() => false);
  referKeysRef.current = (event) => {
    const refer = studioHost?.refer;
    const el = event.target as HTMLElement | null;
    if (!refer || event.defaultPrevented || isTypingTarget(el) || el?.closest?.('[role="dialog"]')) return false;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'l' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      for (const ref of selectedRefs()) refer(ref);
      return true;
    }
    return false;
  };
  /* the keys, read fresh each time (they act on what is selected and marked now) */
  const keyNowRef = React.useRef<(event: KeyboardEvent) => void>(() => {});
  keyNowRef.current = (event) => {
    if (referKeysRef.current(event)) return;
    const el = event.target as HTMLElement | null;
    const mod = MAC ? event.metaKey : event.ctrlKey;
    if (event.key.toLowerCase() === 'z' && mod && !event.altKey) {
      if (isTypingTarget(el) || el?.closest('[role="dialog"]')) return;
      /* not checked against canUndo: a nudge on the picture not written yet is written first, and is the step undone */
      event.preventDefault();
      stepHistory(event.shiftKey ? 'redo' : 'undo');
      return;
    }
    if (event.code === 'Space' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (isTypingTarget(el)) return;
      if (event.repeat) { event.preventDefault(); return; }
      if (el?.closest('[role="dialog"]')) return;
      if (tabbed.current && el?.closest('button, a, [role="button"]')) return;
      event.preventDefault();
      const active = document.activeElement;
      if (!tabbed.current && active && active !== document.body && 'blur' in active) (active as HTMLElement).blur();
      toggle();
      return;
    }
    if (event.defaultPrevented || isTypingTarget(el) || el?.closest?.('[role="dialog"]')) return;
    /* Esc lets the range go as it lets the selection go (those listen on their own); a menu or a panel open takes it */
    if (event.key === 'Escape' && markedRange && !document.querySelector('[role="menu"], [role="listbox"], [data-popover-panel]')) setMarkedRange(null);
    const cmd = keyCommandOf(event, MAC);
    if (!cmd) return;
    /* a menu or a list open has the arrows; a slider (the ruler, a volume) steps itself with ← / → */
    if (el?.closest?.('[role="menu"], [role="listbox"]') && /^(frame|second|prev|next|start|end|nudge)/.test(cmd)) return;
    if (el?.closest?.('[role="slider"]') && /^(frame|second|start|end)/.test(cmd)) return;
    const commands = timelineCommands.current;
    const now = player.current.time() * 1000;
    const go = (ms: number) => { pause(); seek(Math.max(0, Math.min(totalMs, ms))); };
    const take = () => event.preventDefault();
    const once = !event.repeat;
    switch (cmd) {
      case 'shuttle-back': case 'shuttle-stop': case 'shuttle-forward': {
        /* the source viewer has its own playhead: J / K / L are the film's only while the film is shown */
        if (pickedMedia || !(totalMs > 0)) return;
        take();
        if (cmd === 'shuttle-stop') { kHeld.current = true; if (once) shuttle('k'); return; }
        if (kHeld.current) { go(stepFrames(now, cmd === 'shuttle-back' ? -1 : 1)); return; }
        if (once) shuttle(cmd === 'shuttle-back' ? 'j' : 'l');
        return;
      }
      case 'mark-in': case 'mark-out':
        if (!(totalMs > 0)) return;
        take();
        /* an end that would leave no range (I at the film's end) leaves the range as it was */
        setMarkedRange((cur) => markRange(cur, cmd === 'mark-in' ? 'in' : 'out', snapToFrame(now), totalMs) ?? cur);
        return;
      case 'clear-range':
        if (!markedRange) return;
        take();
        setMarkedRange(null);
        return;
      case 'go-in': case 'go-out':
        if (!markedRange) return;
        take();
        go(cmd === 'go-in' ? markedRange.startMs : markedRange.endMs);
        return;
      case 'loop':
        take();
        if (once) setLoop((on) => !on);
        return;
      case 'play-range':
        if (!(totalMs > 0)) return;
        take();
        if (!once) return;
        if (markedRange) playRange(markedRange); else toggle();
        return;
      case 'frame-back': case 'frame-forward': case 'second-back': case 'second-forward': case 'start': case 'end': {
        if (!(totalMs > 0)) return;
        take();
        /* a frame (or a second) on from the frame the playhead is on, so stepping never drifts */
        const frames = (cmd.endsWith('back') ? -1 : 1) * (cmd.startsWith('second') ? secondFrames() : 1);
        const next = cmd === 'start' ? 0 : cmd === 'end' ? totalMs : stepFrames(now, frames);
        pause();
        seek(Math.max(0, Math.min(totalMs, next)));
        return;
      }
      case 'prev-cut': case 'next-cut': {
        if (!(totalMs > 0)) return;
        take();
        const to = nextCut(cutPoints(tracksRef.current), now, cmd === 'next-cut' ? 1 : -1);
        if (to != null) go(to);
        return;
      }
      case 'duplicate':
        if (!selectedBlocks.length) return;
        take();
        if (once) void duplicateBlocks(selectedBlocks);
        return;
      case 'add-marker': case 'next-marker': case 'prev-marker':
        /* markers (use-editor-tools): the film's, while the film is shown */
        if (pickedMedia || !(totalMs > 0) || !once) return;
        take();
        tools.onKey(cmd);
        return;
      case 'insert-source': case 'overwrite-source':
        /* the source viewer's keys (it takes them first while it is up) */
        return;
      default:
        break;
    }
    if (!commands || !timelineOpen) return;
    switch (cmd) {
      case 'split': take(); if (once) commands.split(); return;
      case 'split-all': take(); if (once) commands.splitAll(); return;
      case 'cut': if (!selectedBlocks.length) return; take(); if (once) commands.cut(); return;
      case 'nudge-back': case 'nudge-forward':
        if (!selectedBlocks.length) return;
        take();
        commands.nudge(cmd === 'nudge-back' ? -1 : 1);
        return;
      case 'zoom-fit': take(); commands.zoomFit(); return;
      case 'ripple-start': take(); if (once) commands.rippleTrimStart(); return;
      case 'ripple-end': take(); if (once) commands.rippleTrimEnd(); return;
      case 'toggle-snap': case 'toggle-magnet': {
        take();
        if (!once) return;
        const pref = cmd === 'toggle-snap' ? 'snap' : 'magnet';
        const on = !readTimelinePrefs()[pref];
        if (pref === 'snap') commands.toggleSnap(); else commands.toggleMagnet();
        toast.show(`${t(`timeline.${pref}`)} · ${t(`timeline.${pref}${on ? 'On' : 'Off'}`)}`);
        return;
      }
      default:
    }
  };
  /* the same keys pressed while the picture has focus come through the preview (key events stay in their document) */
  const onKeyRef = React.useRef<(event: KeyboardEvent) => void>(() => {});
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => keyNowRef.current(event);
    onKeyRef.current = onKey;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const previewKey = React.useCallback((event: KeyboardEvent) => onKeyRef.current(event), []);

  /* ── top bar: title, menus, panels ── */
  const [renaming, setRenaming] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState('');
  const titleBoxRef = React.useRef<HTMLButtonElement>(null);
  const [titleEditWidth, setTitleEditWidth] = React.useState<number | null>(null);
  const title = loaded?.project.name ?? '';
  /* the film as a whole, for the inspector when nothing is selected, and its tracks' badges */
  const filmSummary = React.useMemo(() => {
    const tracks = film.film?.tracks ?? [];
    return { title, durationMs: totalMs, tracks: tracks.length, clips: tracks.reduce((n, tr) => n + tr.clips.length, 0), empty, badges: filmTrackBadges(tracks) };
  }, [title, totalMs, film.film?.tracks, empty]);
  const startRename = () => { setTitleEditWidth(titleBoxRef.current?.offsetWidth ?? null); setTitleDraft(title); setRenaming(true); };
  const commitTitle = async () => {
    setRenaming(false);
    const next = titleDraft.trim();
    if (!next || next === title || !loaded) return;
    setLoaded({ ...loaded, project: { ...loaded.project, name: next } });
    try { const project = await api.rename(projectId, next); setLoaded((l) => (l ? { ...l, project } : l)); }
    catch (e) {
      setLoaded((l) => (l ? { ...l, project: { ...l.project, name: title } } : l));
      toast.showError(e instanceof ApiError && e.status === 409 ? t('projects.renameTaken').replace('{name}', next) : t('project.renameFailed'));
    }
  };
  const [projectsOpen, setProjectsOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState<SettingsSection | null>(null);
  /* making subtitles: what went wrong, shown on the CC button; with no service to transcribe, it opens Providers */
  const [subtitleProblem, setSubtitleProblem] = React.useState<{ text: string; connect: boolean } | null>(null);
  const makeSubtitles = React.useCallback(() => {
    if (subtitleProblem?.connect) { setSettingsOpen('providers'); setSubtitleProblem(null); return; }
    setSubtitleProblem(null);
    void subs.transcribe().then((r) => { if (!r.ok) setSubtitleProblem({ text: r.error ?? '', connect: !!r.needsTranscriber }); });
  }, [subs, subtitleProblem]);
  const [desktopOpen, setDesktopOpen] = React.useState(false);
  const headerOpsRef = React.useRef<HTMLDivElement>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyAnchor, setHistoryAnchor] = React.useState<{ x: number; y: number } | null>(null);
  const history = useProjectHistory(projectId, {
    onError: toast.showError,
    onMoved: () => { film.forget(); void api.film(projectId).then((f) => { setLoaded(f); }); },
    beforeCommit: film.settled,
  });
  const refreshHistory = React.useRef(history.refresh);
  refreshHistory.current = history.refresh;
  const historyOpenRef = React.useRef(historyOpen);
  historyOpenRef.current = historyOpen;
  React.useEffect(() => {
    /* a history action, at once; the folder changing (an edit, the agent's writes) while the panel shows its uncommitted
       changes, once the burst settles */
    let later: ReturnType<typeof setTimeout> | null = null;
    const stop = projectEvents(projectId, (e) => {
      if (e.type === 'history') { void refreshHistory.current(); return; }
      if ((e.type === 'film' || e.type === 'files') && historyOpenRef.current) {
        if (later) clearTimeout(later);
        later = setTimeout(() => { later = null; void refreshHistory.current(); }, 400);
      }
    });
    return () => { if (later) clearTimeout(later); stop(); };
  }, [projectId]);
  const openHistory = () => {
    const rect = headerOpsRef.current?.getBoundingClientRect();
    if (rect) setHistoryAnchor({ x: rect.right, y: rect.bottom + 4 });
    setHistoryOpen((v) => !v);
  };
  const [exportOpen, setExportOpen] = React.useState(false);
  const [exportClipId, setExportClipId] = React.useState<string | null>(null);
  /* the picture's menu is built before this: it reaches export through a ref */
  const exportTrayRef = React.useRef<ExportTrayHandle>(null);
  const openClipExport = React.useCallback((clipId: string) => {
    if (!(totalMs > 0)) { toast.show(t('project.filmNotReady')); return; }
    setExportClipId(clipId);
    setExportOpen(true);
  }, [totalMs, toast, t]);
  openClipExportRef.current = openClipExport;
  const mgBlocks = React.useMemo(() => timelineTracks
    .filter((tr) => !tr.hidden)
    .flatMap((tr) => tr.blocks)
    .filter((b) => b.kind === 'mg' && b.clipId && b.endMs > b.startMs)
    .sort((a, b) => a.startMs - b.startMs)
    .map((b) => ({ clipId: b.clipId!, label: b.title || b.clipId!, startMs: b.startMs, durMs: b.endMs - b.startMs })), [timelineTracks]);
  const exportFilm = React.useMemo(
    () => (film.film ? filmShape(film.film as unknown as FilmDoc, info?.spans ?? [], mediaFacts) : null),
    [film.film, info, mediaFacts],
  );

  if (failure) {
    return (
      <div className="workspace-shell flex flex-col items-center justify-center gap-3 bg-[var(--dock-shell)] text-[13px] text-[var(--text-muted)]">
        <p>{failure}</p>
        <button type="button" onClick={onLeave} className="rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--bg-hover)]">{t('nav.projects')}</button>
      </div>
    );
  }
  if (!loaded) return <BrandLoadingScreen labelKey="projects.opening" />;

  const value = film.film;
  const viewerReady = Boolean(info);
  return (
    <div className="workspace-shell flex flex-col bg-[var(--dock-shell)]">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" style={{ paddingLeft: DOCK_GAP, paddingRight: DOCK_GAP, paddingBottom: DOCK_GAP }}>
        <div className="relative z-10 grid min-h-0 min-w-0 flex-1" style={{ gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'auto minmax(0, 1fr)', gridTemplateAreas: '"bar" "main"' }}>
          {/* ── top bar: the title centered, whatever is on either side ── */}
          <div data-titlebar className="relative flex h-8 min-w-0 items-center gap-1" style={{ gridArea: 'bar' }}>
            <div className="pointer-events-none absolute inset-0 flex min-w-0 items-center justify-center">
              <div className="pointer-events-auto flex min-w-0 max-w-full items-center">
                {renaming ? (
                  <input
                    autoFocus
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={() => void commitTitle()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitTitle();
                      if (e.key === 'Escape') { setTitleDraft(title); setRenaming(false); }
                    }}
                    placeholder={t('project.untitled')}
                    maxLength={TITLE_MAX_CHARS}
                    style={titleEditWidth ? { width: titleEditWidth } : undefined}
                    className="box-border h-[26px] max-w-full rounded-md bg-transparent px-2 text-[13px] font-medium text-[var(--text-muted)] outline-none"
                  />
                ) : (
                  <Tooltip label={t('projectMenu.rename')} side="bottom">
                    <button ref={titleBoxRef} type="button" onClick={startRename}
                      className="flex h-[26px] w-fit min-w-0 max-w-[24ch] items-center rounded-md px-2 transition hover:bg-[var(--bg-hover)]">
                      <span className="min-w-0 truncate text-[13px] font-medium text-[var(--text-muted)]">{clampTitle(title || t('project.untitled'))}</span>
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>
            <div aria-hidden className="shrink-0 self-stretch" style={{ width: 'var(--titlebar-logo-x)' }} />
            <div className="pointer-events-auto relative flex min-w-0 items-center gap-1">
              <Tooltip label={t('project.appMenu')} side="bottom">
                <button type="button" aria-label={t('project.appMenu')} aria-haspopup="dialog"
                  onClick={() => setSettingsOpen('general')}
                  className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)]">
                  <BrandLogo size={15} />
                </button>
              </Tooltip>
              <Tooltip label={t('nav.projects')} side="bottom">
                <button type="button" aria-label={t('nav.projects')} onClick={() => setProjectsOpen((v) => !v)}
                  className={`${TOP_BTN} ${projectsOpen ? 'bg-[var(--bg-hover)] text-[var(--text)]' : ''}`}>
                  <GalleryVerticalEnd size={15} />
                </button>
              </Tooltip>
              {!studioHost && <Tooltip label={t('desktop.title')} side="bottom">
                <button type="button" aria-haspopup="dialog" onClick={() => setDesktopOpen(true)}
                  className={`flex h-[26px] shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] ${desktopOpen ? 'bg-[var(--bg-hover)] text-[var(--text)]' : ''}`}>
                  <MonitorDown size={14} />
                  {t('nav.desktop')}
                </button>
              </Tooltip>}
            </div>
            <div className="min-w-0 flex-1" />
            <div ref={headerOpsRef} className="pointer-events-auto flex min-w-0 items-center justify-end gap-1">
              <ProjectLayoutMenu className={TOP_BTN}
                /* an app that keeps the media in its own panel opens it there, from its own button: not a pane of Studio's */
                assets={hostAssets ? null : assetsPaneOpen} onAssets={setAssetsPaneOpen}
                layers={layersPaneOpen} onLayers={setLayersPaneOpen}
                timeline={timelineOpen} inspector={inspectorOpen}
                onTimeline={setTimelineOpen} onInspector={persistInspector}
                hostPanel={hostPanel ? { label: hostPanel.label, open: hostPanel.open, onChange: hostPanel.setOpen } : null} />
              <ProjectHistoryButton open={historyOpen} onClick={openHistory} className={TOP_BTN} />
              <ProjectMenu className={TOP_BTN}
                onExport={() => {
                  if (previewError) toast.showError(`${t('project.filmCannotExport')} ${previewError}`);
                  else if (totalMs > 0) setExportOpen(true);
                  else toast.show(t('project.filmNotReady'));
                }}
                onReveal={() => reveal('')} />
            </div>
            <div aria-hidden className="shrink-0 self-stretch" style={{ width: 'var(--titlebar-right-x)' }} />
          </div>

          {/* the app's own panel (lib/host.ts `panel`) sits right of this, under the top bar: room left for it */}
          <section ref={dockColRef} className="relative flex min-h-0 min-w-0 flex-col" style={{ gridArea: 'main', ...(hostPanel?.open ? { marginRight: Math.max(0, hostPanel.width - DOCK_GAP) } : null) }}>
            <div ref={viewerRowRef} className="relative flex min-h-0 min-w-0 flex-1 flex-row">
              {!hostAssets && assetsPaneOpen && assetsFit ? (
                <>
                  <div className={`${PANE} shrink-0 bg-[var(--dock-pane)]`} style={{ width: assetsShownWidth }}>
                    {mediaPool()}
                  </div>
                  <PaneDivider width={assetsShownWidth} onResize={setAssetsWidth} containerRef={viewerRowRef} label={t('layout.assets')} min={200} minRest={MIN_VIEWER} />
                </>
              ) : null}
              {layersShown ? (
                <>
                  <div ref={layersPaneRef} className={`${PANE} shrink-0 bg-[var(--dock-pane)]`} style={{ width: layersShownWidth }}>
                    <LayersPanel
                      ask={askStage}
                      timeMs={timeMs}
                      playing={playing}
                      filmKey={value}
                      clipOf={layerClipOf}
                      selected={stageElement && stageElement.kind !== 'clip' ? { ...(stageElement.clipId ? { clipId: stageElement.clipId } : {}), loc: stageElement.loc } : null}
                      selectedClipLocs={selectedLocs}
                      onSelectLayer={selectLayerRow}
                      onSelectClip={selectStageClip}
                      onPoint={setPointedLayer}
                      onToggle={toggleLayerRow}
                      onRestack={restackLayers}
                      onNotify={toast.show}
                      width={layersShownWidth}
                      onClose={() => { setPointedLayer(null); setLayersPaneOpen(false); }}
                    />
                  </div>
                  {/* the divider measures from the row's left edge: the assets left of this pane are taken off */}
                  <PaneDivider width={layersShownWidth} containerRef={viewerRowRef} label={t('layers.resize')} min={180} minRest={MIN_VIEWER}
                    onResize={(w) => {
                      const left = (layersPaneRef.current?.getBoundingClientRect().left ?? 0) - (viewerRowRef.current?.getBoundingClientRect().left ?? 0);
                      setLayersWidth(Math.max(180, w - left));
                    }} />
                </>
              ) : null}

              <div className={`${PANE} min-w-0 flex-1 bg-[var(--dock-pane)]`} data-viewer-pane="">
                <div className={PANE_BAR}>
                  {hostAssets ? null : (
                  <Tooltip label={t(assetsPaneOpen && assetsFit ? 'assetsPane.hide' : 'assetsPane.show')} side="bottom">
                    <button type="button"
                      onClick={() => {
                        if (assetsPaneOpen && assetsFit) { setAssetsPaneOpen(false); return; }
                        setAssetsPaneOpen(true);
                        /* asked for in a window too narrow for all three: the inspector makes room */
                        if (!assetsFit) setInspectorOpen(false);
                      }}
                      aria-label={t(assetsPaneOpen && assetsFit ? 'assetsPane.hide' : 'assetsPane.show')}
                      className={`${PANE_TOGGLE} ${assetsPaneOpen && assetsFit ? PANE_BTN_ON : ''}`}>
                      <LibraryBig size={PANE_TOGGLE_ICON} />
                    </button>
                  </Tooltip>
                  )}
                  <Tooltip label={t(layersShown ? 'layers.hidePane' : 'layers.showPane')} side="bottom">
                    <button type="button"
                      onClick={() => {
                        if (layersShown) { setPointedLayer(null); setLayersPaneOpen(false); return; }
                        setLayersPaneOpen(true);
                        /* asked for in a window too narrow for it: the inspector makes room */
                        if (!layersFit) setInspectorOpen(false);
                      }}
                      aria-label={t(layersShown ? 'layers.hidePane' : 'layers.showPane')}
                      className={`${PANE_TOGGLE} ${layersShown ? PANE_BTN_ON : ''}`}>
                      <Layers size={PANE_TOGGLE_ICON} />
                    </button>
                  </Tooltip>
                  <span className="min-w-0 flex-1" />
                  <Tooltip label={t(inspectorOpen ? 'inspector.hide' : 'inspector.show')} side="bottom">
                    <button type="button" onClick={() => persistInspector(!inspectorOpen)}
                      aria-label={t(inspectorOpen ? 'inspector.hide' : 'inspector.show')}
                      className={`${PANE_TOGGLE} ${inspectorOpen ? PANE_BTN_ON : ''}`}>
                      <Settings2 size={PANE_TOGGLE_ICON} />
                    </button>
                  </Tooltip>
                </div>
                <input ref={relinkInputRef} type="file" accept="video/*,image/*,audio/*" className="hidden"
                  onChange={(e) => {
                    const picked = e.target.files?.[0];
                    e.target.value = '';
                    const block = relinkTarget.current;
                    if (!picked || !block) return;
                    void onImport([picked], 'assets', () => {}).then(([landed]) => relinkBlock(block, landed ?? `assets/${picked.name}`), (err: Error) => toast.show(err.message));
                  }} />
                {pickedMedia ? (
                  <div className="absolute inset-x-0 bottom-0 top-8 z-20">
                    <SourcePreview file={pickedMedia} sources={mediaSources} onClose={() => pickMedia(null)} onPlace={placeFromSource} />
                  </div>
                ) : null}
                {dropped?.length || undone.length ? (
                  <div role="status" className="@container mx-3 mt-1.5 shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[12.5px] text-[var(--text)]">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {/* edits inside pages left out and clip edits changed back are one thing to the person: their edits, undone */}
                      <span className="min-w-0 basis-full truncate @xs:basis-0 @xs:flex-1" title={t('project.editsUndone').replace('{n}', String(undoneCount))}>
                        <span className="hidden @xl:inline">{t('project.editsUndone').replace('{n}', String(undoneCount))}</span>
                        <span className="@xl:hidden">{t('project.editsUndoneShort').replace('{n}', String(undoneCount))}</span>
                      </span>
                      <button type="button" onClick={() => void restoreDropped()} className="shrink-0 rounded-md bg-[var(--text)] px-2.5 py-1 text-[var(--surface)] transition hover:opacity-85">{t('project.editsRestore')}</button>
                      <button type="button" onClick={() => { setDropped(null); for (const e of undone) settledEdits.current.add(e); setUndone([]); }} className="shrink-0 rounded-md px-2 py-1 text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">{t('project.editsLeaveOut')}</button>
                    </div>
                  </div>
                ) : null}
                <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 py-2.5" style={{ containerType: 'size' }} {...pictureDropProps}
                  data-viewer-picture="" data-viewer-focus={viewerFocus ? '1' : '0'} onPointerDownCapture={() => setBarAt('stage')}>
                  {/* the picture has the keyboard and something is in hand: the arrow keys move it (not the playhead) */}
                  {viewerFocus && stageElement && !fullscreen ? (
                    <div aria-hidden data-viewer-keys="" className="pointer-events-none absolute inset-1 z-[25] rounded-md ring-1 ring-inset ring-[color-mix(in_srgb,var(--accent)_70%,transparent)]" />
                  ) : null}
                  {pictureDrop ? (
                    <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] ring-2 ring-inset ring-[var(--accent)]">
                      <span className="rounded-md bg-[var(--surface)] px-2.5 py-1 text-[12.5px] text-[var(--text)] shadow-sm">{t('project.dropOnPicture')}</span>
                    </div>
                  ) : null}
                  {value ? (
                    <div ref={stageFullRef} className={`relative flex h-full w-full items-center justify-center ${fullscreen ? 'bg-black' : ''}`}
                      style={{ containerType: 'size' }} onClick={fullscreen ? toggle : undefined}>
                      <div className={`relative bg-black ${frameBox.inner.left < -0.5 || frameBox.inner.top < -0.5 ? 'overflow-hidden' : 'overflow-visible'}`}
                        style={{ ...fitBox(frameBox.w, frameBox.h), containerType: 'size' }}>
                        <div className="absolute" style={{
                          left: `${(frameBox.inner.left / frameBox.w) * 100}%`,
                          top: `${(frameBox.inner.top / frameBox.h) * 100}%`,
                          width: `${(frameBox.inner.w / frameBox.w) * 100}%`,
                          height: `${(frameBox.inner.h / frameBox.h) * 100}%`,
                        }}>
                          <Preview ref={preview} folder={folder} stage={stage} time={() => player.current.time()}
                            onInfo={onInfo} onKey={previewKey} onError={setPreviewError}>
                            {!fullscreen ? (
                              <FilmStageSelect
                                previewRef={preview}
                                stage={stage}
                                doc={value as unknown as FilmDoc}
                                spans={spans}
                                timeMs={timeMs}
                                playing={playing}
                                onPause={pause}
                                onSelectElement={selectStageElement}
                                onEditClip={editClipsFromStage}
                                linkedLocs={selectedLocs}
                                selectRequest={stageSelectRequest}
                                clipPreviewRef={clipPreviewRef}
                                lookPreviewRef={lookPreviewRef}
                                controlRef={stageControl}
                                onTransformLayer={transformStageLayer}
                                onTransformLayers={transformStageLayers}
                                onEditTextInline={editStageTextInline}
                                onGeometry={geometryStore.set}
                                menuFor={stageMenuWithRefer}
                                recoveryMenu={recoveryMenu}
                                {...(studioHost?.refer ? { onRegion: referRegion, regionHint: t('host.regionHint') } : {})}
                                flashBox={flashBox}
                                chat={chatOnPicture}
                                {...(hostHover ? { onHoverLayer: hoverLayer } : {})}
                                selectionBar={barAt === 'stage'}
                                {...(studioHost?.refer ? { onRefer: referFromStage } : {})}
                                onStartMask={openMaskSection}
                                pointLayer={layersShown ? pointedLayer : null}
                                arrowsMove={viewerFocus}
                              />
                            ) : null}
                          </Preview>
                        </div>
                        {!viewerReady && !empty && !previewError ? (
                          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black">
                            <span role="status" className="text-sweep relative text-[13px] text-white/60">{t('project.previewStageMount')}</span>
                          </div>
                        ) : null}
                        {fullscreen ? <div className="absolute inset-0 z-[5]" aria-hidden /> : null}
                        {/* subtitles sit on the frame, not on the film: their place is a share of the frame, so a 9:16
                            frame puts them on its own bottom (the bar), not pushed up with the picture */}
                        <LiveTime clock={playing ? clock : null} timeMs={timeMs}>{(liveMs) => (
                          <SubtitleOverlay
                            cues={captionsOn ? subs.cues : []}
                            timeMs={liveMs}
                            style={filmSubtitleStyleFor(subs.style, frameBox)}
                            onMove={fullscreen ? undefined : subs.move}
                          />
                        )}</LiveTime>
                      </div>
                      {fullscreen ? (
                        <FilmFullscreenBar
                          hostRef={stageFullRef}
                          timeMs={timeMs}
                          totalMs={totalMs}
                          playing={playing}
                          volume={volume}
                          muted={muted}
                          rate={rate}
                          onToggle={toggle}
                          onScrubPreview={(ms) => seek(ms)}
                          onScrubCommit={(ms) => seek(ms)}
                          onVolume={(v) => { player.current.setVolume(v); setVolumeState(player.current.volume); setMutedState(player.current.muted); }}
                          onToggleMute={() => { player.current.setMuted(!player.current.muted); setMutedState(player.current.muted); }}
                          onRate={(r) => { player.current.setRate(r); setRateState(player.current.rate); }}
                          onExit={toggleFullscreen}
                          captionsOn={subs.count ? captionsOn : undefined}
                          onToggleCaptions={() => setCaptionsOn((v) => !v)}
                        />
                      ) : null}
                    </div>
                  ) : (
                    <p className="max-w-[280px] text-center text-[12.5px] text-[var(--text-faint)]">{loaded.problems.join(' ') || t('project.filmEmptyHint')}</p>
                  )}
                </div>
                {film.broken ? (
                  <div role="status" className="mx-2 mb-1 flex items-start gap-2 rounded-md border border-[var(--warn)] px-2.5 py-1.5 text-[12px] leading-snug text-[var(--text)]">
                    <TriangleAlert size={14} className="mt-px shrink-0 text-[var(--warn)]" aria-hidden />
                    <span className="min-w-0 break-words"><span className="font-medium">{t('project.filmBroken')}</span>{' '}<span className="text-[var(--text-dim)]">{film.broken}</span></span>
                  </div>
                ) : null}
                <ViewerBar
                  timeMs={timeMs}
                  clock={playing ? clock : null}
                  totalMs={totalMs}
                  playing={playing}
                  onPlayPause={toggle}
                  loop={{ on: loop, ranged: Boolean(markedRange), onToggle: () => setLoop((on) => !on) }}
                  frame={value ? (
                    <FramePicker
                      stage={stage}
                      value={deliveryFrame}
                      mode={empty ? 'canvas' : 'delivery'}
                      onDelivery={setDeliveryFrame}
                      onCanvas={changeCanvas}
                    />
                  ) : null}
                  onFullscreen={toggleFullscreen}
                />
              </div>

              {inspectorShown ? (
                <>
                  <PaneDivider width={inspectorShownWidth} onResize={commitInspectorWidth} containerRef={viewerRowRef} label={t('inspector.resize')} min={MIN_INSPECTOR} minRest={MIN_VIEWER} side="end" />
                  {typeof inspectorContent === 'object' ? (
                    <ResourceInspector file={inspectorContent} url={mediaSources.file(inspectorContent)} width={inspectorShownWidth} onClose={closeInspector} />
                  ) : inspectorContent === 'subtitles' ? (
                    <SubtitleInspector
                      subtitles={{ style: subs.style, onStyle: subs.patchStyle, translate: subs.translate, sourceLanguage: subs.sourceLanguage, lines: subs.captions?.cues ?? [], onEditLine: (cue, text, language) => void subs.setLine(cue, text, language), timeMs, onSeek: seek, untranscribed: subs.captions?.untranscribed.length ?? 0, onMake: makeSubtitles, making: subs.transcribing, ...(subtitleRefer ? { refer: subtitleRefer } : {}) }}
                      width={inspectorShownWidth}
                      onClose={closeInspector}
                    />
                  ) : (
                    <FontScopeContext.Provider value={fontScope}>
                    <LiveGeometryInspector
                      store={geometryStore}
                      element={stageElement}
                      clips={selectedBlocks}
                      onEditClips={editClips}
                      width={inspectorShownWidth}
                      onClose={closeInspector}
                      onEditStyle={editStageStyle}
                      onPreviewStyle={previewStageStyle}
                      onPreviewText={previewStageText}
                      onEditText={editStageText}
                      inlineTextFailure={inlineTextFailure}
                      onEditOverride={editStageOverride}
                      onPreviewOverride={previewStageOverride}
                      onSelectParent={selectStageParent}
                      onSelectClip={selectStageClip}
                      onPreviewClip={previewClip}
                      pageChangesOf={pageChangesOf}
                      clipLookOf={clipLookOf}
                      onPreviewLook={previewLook}
                      onStartCrop={startStageCrop}
                      onEditMask={editStageMask}
                      stage={stage}
                      film={filmSummary}
                      onCanvas={changeCanvas}
                      frame={{ value: deliveryFrame, onChange: setDeliveryFrame }}
                      onEditLayers={editStageOverrides}
                      locked={inspectorLocked}
                      rate={frameRate}
                      fades={clipFades}
                      transition={pickedTr && !selectedBlocks.length ? {
                        kind: pickedTr.kind,
                        durationMs: pickedTr.endMs - pickedTr.startMs,
                        onDuration: (ms) => askTransition({ kind: 'resize', key: pickedTr.key, durationMs: ms }),
                        onRemove: () => { void askTransition({ kind: 'remove', key: pickedTr.key }).then((err) => { if (err) toast.show(err); }); setPickedTransition(null); },
                      } : null}
                    />
                    </FontScopeContext.Provider>
                  )}
                </>
              ) : null}
            </div>

            {timelineOpen ? <DockPaneDivider height={timelineShownHeight} onResize={commitTimelineHeight} containerRef={dockColRef} label={t('timeline.resize')} /> : null}
            {timelineOpen && value ? (
              <div className={`${PANE} shrink-0 bg-[var(--dock-pane)]`} style={{ height: timelineShownHeight }}>
                <div className="absolute inset-0 flex min-h-0 min-w-0 flex-col" data-timeline-scope="main" style={{ right: METERS_W }}
                  onPointerDownCapture={() => { setBarAt('timeline'); if (pickedMedia) pickMedia(null); }}>
                  <Timeline
                    blockMenuExtra={timelineMenuExtra}
                    chat={timelineChat}
                    {...(hostHover ? { onHoverBlock: hoverBlock } : {})}
                    /* the range (I / O, ⇧-drag on the ruler, Play range) is Studio's own; referring it is the app's */
                    range={markedRange}
                    onRangeChange={setMarkedRange}
                    trackMenuExtra={trackMenuExtra}
                    {...(studioHost?.refer ? {
                      onReferBlocks: referBlocks, rangeRef: markedRangeRef, onReferSelection: referFromTimeline,
                    } : {})}
                    commandsRef={timelineCommands}
                    trackNames={trackNames}
                    onRenameTrack={renameTrack}
                    selectionBar={barAt === 'timeline'}
                    onDuplicate={duplicateBlocks}
                    onPlayRange={playRange}
                    thumbs={shownThumbs}
                    posters={posters}
                    mediaTrouble={mediaTrouble}
                    relinkCandidates={relinkCandidates}
                    onRelink={(block, path) => void relinkBlock(block, path)}
                    onViewChange={setThumbView}
                    tracks={tools.tracks}
                    totalMs={totalMs}
                    timeMs={timeMs}
                    clock={playing ? clock : null}
                    playing={playing}
                    onSeek={(ms) => seek(ms)}
                    onScrubPreview={scrubPreview}
                    onScrubCommit={scrubCommit}
                    onRemove={removeBlock}
                    onRemoveMany={removeBlocks}
                    onSplit={splitBlocks}
                    onDetachAudio={detachAudio}
                    onEditBlocks={editBlocks}
                    onEditOps={editOps}
                    links={clipLinks}
                    fades={clipFades}
                    transitions={filmTransitions}
                    onTransition={askTransition}
                    pickedTransition={pickedTr?.key ?? null}
                    onPickTransition={pickTransition}
                    onCopy={copyBlocks}
                    onPaste={pasteAt}
                    onDropAsset={dropAsset}
                    onDropFiles={dropFiles}
                    onExportBlock={openClipExport}
                    hasClipboard={clipboard.length > 0}
                    selected={selectedIds}
                    onSelectedChange={onTimelineSelected}
                    subtitles={{ on: subs.style.on, onToggle: subs.toggle, count: subs.count, untranscribed: subs.captions?.untranscribed.length ?? 0, onConfigure: configureSubtitles, configuring: inspectorShown && inspectorContent === 'subtitles', onMake: makeSubtitles, making: subs.transcribing, problem: subtitleProblem }}
                    subtitleRow={subtitleRow}
                    waveUrl={waveUrl}
                    history={timelineHistory}
                    {...tools.timeline}
                  />
                </div>
                {/* the audio meters, beside the timeline as Premiere's */}
                <div className="absolute inset-y-0 right-0"><AudioMeters levels={tools.levels} playing={playing} /></div>
              </div>
            ) : null}
          </section>
        </div>
      </div>

      <ProjectHistoryControls projectId={projectId} history={history} open={historyOpen} anchor={historyAnchor} onClose={() => setHistoryOpen(false)} />
      <ProjectsPopover open={projectsOpen} currentProjectId={projectId} onOpen={(id) => { setProjectsOpen(false); onProject(id); }} onCurrentRemoved={onLeave} onClose={() => setProjectsOpen(false)} />
      <SettingsModal open={settingsOpen !== null} section={settingsOpen ?? undefined} onClose={() => setSettingsOpen(null)} />
      {/* the host app's media drawer (panel.assets): over its panel, under Studio's top bar, down to the `bottom` px the
          panel keeps for itself (the panel goes on below it, so the two read as one) */}
      {hostAssets?.open && hostPanel ? <PanelSeam panel={hostPanel} bottom={hostAssets.bottom} /> : null}
      {hostAssets?.open && hostPanel ? (
        <div className="fixed z-30 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-t-[7px] bg-[var(--dock-pane)]"
          style={{ top: HOST_PANEL_TOP, right: DOCK_GAP, bottom: hostAssets.bottom, width: Math.max(0, hostPanel.width - 2 * DOCK_GAP) }}>
          {mediaPool(() => hostAssets.setOpen(false))}
        </div>
      ) : null}
      <DesktopDialog open={desktopOpen} onClose={() => setDesktopOpen(false)} />
      <ExportCenter
        open={exportOpen}
        onClose={() => { setExportOpen(false); setExportClipId(null); }}
        projectId={projectId}
        title={title || 'video'}
        durationMs={totalMs}
        stage={stage}
        frame={frame}
        film={exportFilm as never}
        playheadMs={timeMs}
        mgBlocks={mgBlocks}
        {...(exportClipId ? { focusClipId: exportClipId } : {})}
        onQueued={(jobs) => exportTrayRef.current?.push(jobs)}
        projectFps={projectFps}
      />
      <ExportTray ref={exportTrayRef} projectId={projectId} onError={toast.showError} />
      <SpendAsks projectId={projectId} />
      <Toast toast={toast.current} />
    </div>
  );
}

interface GeometryStore {
  get: () => StageGeometry | null;
  set: (g: StageGeometry | null) => void;
  subscribe: (fn: () => void) => () => void;
}

/** Where the thing in hand is: only the inspector subscribes, so a drag re-renders the inspector, not the editor. */
function createGeometryStore(): GeometryStore {
  let value: StageGeometry | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (g) => { value = g; for (const fn of listeners) fn(); },
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}

function LiveGeometryInspector({ store, ...props }: Omit<React.ComponentProps<typeof FilmInspector>, 'geometry'> & { store: GeometryStore }) {
  const geometry = React.useSyncExternalStore(store.subscribe, store.get, store.get);
  return <FilmInspector {...props} geometry={geometry} />;
}

/**
 * The seam that sizes the app's panel while Studio's assets drawer covers it (the panel's own seam is under the
 * drawer then): the same 10 px strip at the column's left edge, dragged or moved with the arrow keys.
 */
function PanelSeam({ panel, bottom }: { panel: HostPanel; bottom: number }) {
  const drag = React.useRef<{ x: number; width: number } | null>(null);
  return (
    <div role="separator" aria-orientation="vertical" aria-label={panel.label} tabIndex={0}
      className="fixed z-[31] w-[10px] cursor-col-resize outline-none focus-visible:bg-[var(--border-strong)]"
      style={{ top: HOST_PANEL_TOP, bottom, right: panel.width - 10 }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.screenX, width: panel.width };
        document.body.style.cursor = 'col-resize';
      }}
      onPointerMove={(e) => { if (drag.current) panel.setWidth(drag.current.width + (drag.current.x - e.screenX)); }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        panel.setWidth(drag.current.width + (drag.current.x - e.screenX), true);
        drag.current = null;
        document.body.style.cursor = '';
      }}
      onPointerCancel={() => { drag.current = null; document.body.style.cursor = ''; }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        panel.setWidth(panel.width + (e.key === 'ArrowLeft' ? 24 : -24), true);
      }} />
  );
}
