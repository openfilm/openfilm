/**
 * A project in Studio: the top bar, then the assets, the picture and the inspector side by side, and the timeline
 * across the bottom. Every pane floats on the darker board; the seams between them are the board showing through and
 * can be dragged.
 *
 * The film is film.html in the project folder. Edits made here show at once (applied with the server's own code) and
 * are written one at a time (see editor/use-film.ts); the agent's writes come in through the folder's events.
 */
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { BookmarkPlus, ChartSpline, Columns2, ChevronDown, ChevronRight, ClipboardCopy, ClipboardPaste, Diamond, Eye, EyeOff, FolderOpen, Layers, LibraryBig, Lock, LockOpen, MessageSquarePlus, Plus, Settings2, Spline, TriangleAlert, Upload } from 'lucide-react';
import { applyOps } from '../../../server/ops.mjs';
import { EFFECTS, MOTION_PROPS, animationsOf, effectsOf, readMotion, valueAt, withAnimations, withEffects, withPreset, type EffectProp, type KeyedProp, type Motion, type MotionProp } from '../../../../src/clip-motion.mjs';
import { copiedKeys, easeOfBezier, easedMotion, effectsModel, type EffectsChange, keyId, keyedBox, movedKeys, parseKeyId, pastedKeys, poseAt, withoutKeys, type CopiedKeys, type EaseCommand } from '@/lib/motion-keys';
import type { MotionLanes } from './MotionLanes';
import type { MotionPathKeys } from './MotionPath';
import { LAYER_ROW_H, layerBarColor, useMotionLayers, type Layer, type LayerContents, type LayerHost, type LayerMask, type MotionLayersView } from './MotionLayers';
import { maskCss, maskDefault, maskOf, type Mask } from '@/lib/clip-mask';
import { maskKeyframes, maskModel, readMaskKeys, type MaskKeys } from '@/lib/mask-motion';
import { splitFor, textAnimOf, type TextAnim } from '@/lib/text-animator';
import { elementModel, elementStatic, elementSubject, readElementMotion, sameElement, writeElementMotion, type ElementCommit } from '@/lib/element-motion';
import { transformModel, type TransformCommit } from './KeyframesSection';
import { staticTransform, transformEdits } from '@/lib/clip-transform';
import { declared, withDeclarations } from '@/lib/clip-look';
import { declarations } from '../../../../src/film-doc.mjs';
import { PARTS, compoundFolder, compoundOf, dissolvedOf, srcInto, srcOutOf } from '../../../server/compound.mjs';
import type { FilmValue } from '../../../server/ops.mjs';
import { api, ApiError, projectEvents, type Clip, type Film, type Listing, type MediaMade, type Op, type ProjectSettings, type SavedGroupClip } from '@/api';
import { coversApi, coverThumb, type CoverList } from '@/lib/covers';
import { CoverDesigner } from './cover/CoverDesigner';
import { useLanguage, useT } from '@/i18n';
import { useFilm, type OutsideStep, type Step } from '@/editor/use-film';
import { Player } from '@/editor/player';
import { Preview, type FilmInfo, type PlayedReport, type PreviewHandle } from '@/editor/Preview';
import { usePreviewRenders } from '@/editor/use-preview-renders';
import { filmShape, type MediaFacts } from '@/lib/film-shape';
import { changesPicture, colorFiles } from '@/lib/picture-files';
import { STANDARD, colorFilesChanged, readColorTexts, writeColorFiles, type ColorHost } from '@/lib/color-files';
import { draftOf, filterWrite } from '@/lib/clip-color';
import { ColorDesk, type GradedClip } from '@/plugins/color/ColorDesk';
import { filterUrl } from '../../../../src/color/adjust.mjs';
import { SPEED_MAX } from '@/lib/playback-speed';
import { replaceClip, type ReplaceFamily } from '@/lib/clip-replace';
import { fillFor, filmLength, filmTemplate, isSlotSrc, markedClips, placeFrame, retimedTemplate, templateFolderOf, templateMark, templateMarks, templateOf, templateOfFolder, withPlaceFrame } from '@/lib/template-instance';
import { keepTemplateFilm, TemplateFilmSection, TemplateSection, type TemplateHost } from '@/components/TemplateSection';
import { cutMovesOn, headStyle, joinedStyle, presetsOn, restStyle, takesMotion, withCutMove, type Preset, type PresetSlot } from '@/lib/clip-presets';
import { ClipMotionSection, type ClipMotionHost } from '@/components/ClipMotionSection';
import { TemplatePicker } from '@/components/TemplatePicker';
import { isLibraryText, layoutTracks, type TimelineBlock, type TimelineTrack } from '@/lib/timeline-layout';
import { organizeTracks } from '@/lib/organize-tracks';
import { useAgentWorking } from '@/lib/agent-working';
import { filmClipKind, filmDocLoc, filmSrcIsPage, filmSrcKind, filmTrackBadges, parseFilmDocLoc, type FilmBox, type FilmDoc, type FilmOverride } from '@/lib/film';
import { exactRate, footageFps, setTimecodeFps, snapToFrame, stepFrames } from '@/lib/timecode';
import { JUMP_FRAMES, loopBack, playStart, shuttleRate } from '@/lib/timeline-keys';
import { comboOf, parseCombo } from '@/lib/keymap';
import { currentKeymap, keyAction, useKeyHint } from '@/lib/keymap-store';
import { attrsOf, pasteAttrs, type AttrGroup, type CopiedAttrs } from '@/lib/clip-attrs';
import { cutPoints, nextCut } from '@/lib/timeline-nav';
import { anyLocked, lockedEdits } from '@/lib/track-lock';
import { placeMedia, type SourceRange } from '@/lib/media-place';
import { BUILT_IN, TEXT_COMPONENT, builtInItem, cutTrack, cutsOf, defaultTextWords, fromLibrary, isLibraryClip, isTextClip, libraryItemOfClip, libraryBox, libraryDragItem, libraryUrl, nameOf, onCut, pageUrl, placedGroup, withLook, withRootVars, type LibraryItem } from '@/lib/library';
import type { LibraryActions } from '@/components/library/LibraryDrawer';
import type { CaptionsActions, CaptionsMake } from '@/components/library/CaptionsPane';
import { LibraryTrial, type TemplatePreviewState } from '@/components/library/LibraryTrial';
import { hugText } from '@/lib/text-box';
import { textVars, withMotion, withWords } from '@/lib/text-look';
import { apartOnTracks, stackClipEdit, toggleClipEdits, type ClipEdit } from '@/lib/film-clip-edits';
import { useMediaImages } from '@/lib/media-queue';
import { clipboardItemsOf, clipboardNow, laneOfBlock, pasteEdit, type TimelineClipboardItem } from '@/lib/timeline-clipboard';
import {
  editModelOf, freshLink, linkedIds, magnetOn, mainTrackOf, planDetachAudio, planMove, planRippleTrim, planRoom, planSpeed, slowestSpeed, type EditMode,
  planCutRange,
} from '@/lib/timeline-edit';
import { readTimelinePrefs, switchesOf } from '@/lib/timeline-prefs';
import { fadeMsOf, type FadeMs } from '@/lib/clip-fade';
import { hasSoundToDetach } from '@/lib/clip-volume';
import {
  cutForClick, findTransitions, foldHeads, headsOf, planRemoveTransition, planResizeTransition, planTransition, TRANSITION_MS,
  type ClipFacts, type TransitionAsk, type TransitionPlan,
} from '@/lib/transitions';
import { frameMs } from '@/lib/timecode';
import { splitHalves } from '@/lib/timeline-split';
import { assetDropInsert, assetRunInsert, assetRunMs, pendingDropOf, soundLaneHit, withPendingBlocks, type AssetDropTarget, type AssetLaneHit, type AssetRunInsert, type PendingDrop } from '@/lib/asset-timeline';
import { isComputerFileDrag, type ResourceDragItem } from '@/lib/resource-drag';
import type { LibraryVoice, VoiceAccess, VoiceSpeech } from '@/lib/library-voices';
import { ladderStepMs, THUMB_CELL_PX, thumbAnchorTimes } from '@/lib/thumb-cache';
import { clipThumbId, overridesToken } from '@/lib/thumb-frame';
import { useLoadedThumbs } from '@/lib/use-loaded-thumbs';
import { droppedOverrides, overrideTarget, undoneFields, type DroppedEdits, type PersonEdit } from '@/lib/dropped-overrides';
import { filmFrameBox, type FilmFrameId } from '@/lib/film-frame';
import { canvasFor, firstPictureSize, fitToCanvas } from '@/lib/canvas-fit';
import { positionOf } from '@/lib/stage-crop';
import { createViewerZoom } from '@/lib/viewer-zoom';
import { factsOfProbe, resourceKindOf, srcHitsAsset, type WorkspaceResource } from '@/lib/workspace-resources';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { studioHost, type StageBox, type StudioCommand, type StudioRef } from '../lib/host';
import { clipRef, layerRef, markRange, momentRef, rangeRef, regionRef, subtitleRef, trackRef, type ClipFrameSource, type FilmRange } from '@/lib/studio-refs';
import { boxNow, chatPointOf, draftBoxesAt, draftMarksOf, sameClip, NO_DRAFT, type DraftMarks, type PictureMarks } from '@/lib/chat-marks';
import { filmCommandOf, FILM, parseLink } from '@/lib/links';
import { usePageChanges } from './use-page-changes';
import { CaptionInspector, type CaptionTrackInfo } from './CaptionInspector';
import { CaptionStage } from './CaptionStage';
import { captionSelectionNow, captionTrackNow, configureCaptionTracks, refreshCaptionTracks, setCaptionSelection, useCaptionSelection, useCaptionTracksOf, writeCaptionTrack, writeCaptionTracksWith } from '@/lib/caption-tracks';
import { cuePlain, madeOfSpeech, readVtt, speechClips, untouchedSpeech, writeVtt } from '../../../../src/captions.mjs';
import { FILM_SUBTITLE_LANGUAGES } from '../../../server/film-subtitle.mjs';
import { addCue, cueRule, placeCues, setCueRule, shifted, withIds } from '@/lib/caption-edits';
import { cueClipId, cueEditOf, cueOf, cueStandIn, isCueClip, withCueBlocks, type KeptCue } from '@/lib/caption-blocks';

/** How long a clip graded on the color workbench is on the film, seconds. */
const shotLength = (g: GradedClip) => g.length ?? (g.time?.length === 2 ? (g.time[1]! - g.time[0]!) / (g.speed || 1) : Infinity);

import { useFilmSubtitles } from '@/lib/use-film-subtitles';
import { DEFAULT_INSPECTOR, DOCK_GAP, MIN_DOCK_H, MIN_INSPECTOR, MIN_STAGE_H, MIN_VIEWER } from './PaneDivider';
import type { BlockPlace } from '@/lib/workspaces';
import type { DockRect } from '@/lib/workspace-dock';
import type { BlockRoom, BlockSizer } from '@/lib/workspace-preview';
import { PANE_BAR, PANE_BTN_ON, PANE_TOGGLE, PANE_TOGGLE_ICON } from './dock-pane-bar';
import { Tooltip } from './Tooltip';
import { MotionPanel } from './MotionPanel';
import { LayersPanel } from './LayersPanel';
import type { LayerRow, LayerSelection } from '@/lib/layers-tree';
import { SourcePreview } from './SourcePreview';
import { ResourceInspector, type MadeProps } from './ResourceInspector';
import { FilmInspector } from './FilmInspector';
import { Timeline, timelineFitHeight, type TimelineCommands, type TimelineHistory } from './Timeline';
import { useEditorTools } from './use-editor-tools';
import { AudioMeters, METERS_W } from './AudioMeters';
import { trackFlagStep, type SessionTimeline } from './OperationHistory';
import { FilmFullscreenBar, useFullscreenKeys } from './FilmFullscreenBar';
import { ViewerBar } from './ViewerBar';
import { ViewerZoom, ViewerZoomButton } from './ViewerZoom';
import type { PlaybackClock } from './LiveTime';
import { ExportCenter } from './export/ExportCenter';
import { PasteAttrsDialog } from './PasteAttrsDialog';
import { ExportTray, type ExportTrayHandle } from './export/ExportTray';
import { FilmStageSelect, type FilmStageControl, type FilmStageSelectRequest, type LayerGeometry, type StageClipEdit, type StagePick } from './FilmStageSelect';
import { openSection } from './inspector-fields';
import { FontScopeContext, type FontScope } from '@/lib/use-fonts';
import { stageMenu, stageRecoveryMenu, type StageArrangeResult, type StageMenuContext, type StagePictureActions } from './stage-menu';
import type { StageEditFailure, StageTextEdit } from './FilmInspector';
import { layerTarget, pageClipOf, recoverLayer } from '@/lib/stage-layers';
import { pictureStyle, relativeTo, withText, withVar, type TemplateControls } from '@/lib/template-controls';
import { numberOf, readVarMotion, writeVarMotion } from '@/lib/page-motion';
import { propsAttr, propsOf, withPropValue, type ComponentProp } from '@/lib/component-props';
import { pointersOf, propsWithoutDeleted, withDeleted } from '@/lib/layer-delete';
import {
  isLayerClipboardKey, PASTE_OFFSET, pasteGoals, pasteOffset, readLayerClipboard, whyNowhere, writeLayerClipboard, type CopiedLayers,
  type LayerClipboard,
} from '@/lib/layer-clipboard';
import { idsIn, pastedElsewhere, pastedPage, withoutPaste, withPaste, type PasteItem, type PasteLayer, type PastedPage } from '@/lib/layer-paste';
import { pasteTargets, targetById } from '@/lib/layer-paste-target';
import { PropertiesSection, type PropsHost } from './PropertiesSection';
import type { LayerPropsActions } from './FilmInspector';
import { savedSources } from '@/lib/saved';
import { useRecorder } from './RecordPane';
import { saveToEntry } from '@/lib/library-places';
import { deliveryGainDb, deliveryLoudness, onDeliveryLoudness } from '@/lib/delivery-loudness';
import { groupInsertAt, groupInsertOps, keyframesOps } from '@/lib/saved-insert';
import { pageClips, pageMayHave, similarEdits } from '@/lib/similar-layers';
import type { MaskSession } from '@/lib/stage-mask';
import type { MaskShape } from '@/lib/clip-mask';
import { nextOverrides, overrideOf, type OverrideGeometry, type OverrideTarget } from '@/lib/film-overrides';
import { compactScale, type MgTransform, type NodeOverride, type OverridePivot, type StageElement, type StageElementStyle, type StageGeometry } from '@/lib/stage-types';
import { usePreviewPrefs, writePreviewPref } from '@/lib/preview-prefs';
import { isTextField, isTypingTarget } from './typing-target';
/* Studio's public interface for what it offers (the app's chat, its commands, the edit's `add`, Settings), and the
   shell's frame and wiring, OpenFilm-internal, for the rest */
import { blocks, chat, onCommand, openSettings, provide } from '@/studio';
import { attachedBlocks, blockKey, TOP_BTN, useFrame, usePublishWiring, useSteady } from '@/studio/internal';

/** How far a caption track's translation sits above it (% of the frame): about a line. */
const TRANSLATION_LIFT_PCT = 7;

const PANE = 'relative flex min-h-0 min-w-0 flex-col overflow-hidden';
/** The files a picture inside a page can be replaced with. */
const PICTURE_FILE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i;
/* ⌘ is the modifier on a Mac, Ctrl elsewhere (the editor's keys, lib/timeline-keys) */
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const TIMELINE_H = 200;
const TIMELINE_SHARE = 0.45;
const TIMELINE_SPARE = 48;

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
  if (props.has('disabled')) return first?.value === true ? 'history.stepClipsDisabled' : 'history.stepClipsEnabled';
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
/** No keyframes picked. */
const NO_KEYS: ReadonlySet<string> = new Set();
const clipStep = (key: string, ids: readonly string[]) => `${key}|${ids.join(', ')}`;

/** Where keyframes are, ms on a bar that starts at second `from` of their time and is `lenMs` long; each once. */
function keyTimesMs(motion: Motion, from: number, lenMs: number): number[] {
  const out = new Set<number>();
  for (const keys of Object.values(motion)) for (const k of keys ?? []) { const ms = Math.round((k.t - from) * 1000); if (ms >= 0 && ms <= lenMs) out.add(ms); }
  return [...out].sort((a, b) => a - b);
}

/** A row of Motion's timeline: a layer, a folder (a track of several clips, `open` showing each as a layer) or a sound track. */
interface LayerRowSpec { track: TimelineTrack; layer: Layer | null; n: number; folder?: { count: number; open: boolean } }
/** A compound clip's folder (`parts/<name>`), from its src; null for any other clip. */

/** The project's id-named clips by their place in film.html (`film.html#t.c`). */
function clipIdAt(film: Film | null, loc: string): string | null {
  const at = parseFilmDocLoc(loc);
  return at ? film?.tracks[at.track]?.clips[at.clip]?.id ?? null : null;
}

export function ProjectView({ projectId, onProject }: {
  projectId: string;
  /** go to another project */
  onProject: (id: string) => void;
}) {
  const t = useT();
  /* what the shell holds of the project (shell/ProjectFrame): the project and its files as read there, how they were
     made, the media pane's operations on them, the toast. What is read of the project here is put there with its
     operations (adoptFilm, readFilm, listFiles) */
  const {
    toast, showToast, loaded, failure, firstRead, adoptFilm, readFilm, listFiles, filesTick, rawListing, facts, probeMedia, proxies, onUndecoded, prefsTick,
    folder, mediaSources, listing, mediaMade, setMissingMedia, findMissing,
    projectApi, onPick, onBring, onImport, coverSet,
    slots,
    canvasOpen, setCanvasOpen, motionOpen, workMode, setWorkMode, workModes,
    libraryIndex, setRevealMedia, showFile, saveThings, folders, onLibraryDownloadFailed,
    title,
    arrangement, openBlock, openLibrary, libraryPane,
  } = useFrame(projectId);
  const keyHint = useKeyHint();
  /** film.html is missing from the folder (an agent writing it again, or it lost): said on the picture until it is back */
  const [filmMissing, setFilmMissing] = React.useState(false);
  /* what the shell's first read of the project said of film.html, taken as it is drawn (never painted before it is) */
  const [firstReadSeen, setFirstReadSeen] = React.useState<typeof firstRead>(null);
  if (firstRead && firstRead !== firstReadSeen) { setFirstReadSeen(firstRead); setFilmMissing(Boolean(firstRead.filmMissing)); }
  /** why the picture could not draw the film (shown on the stage; the timeline then places clips by film.html alone) */
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const previewErrorRef = React.useRef(previewError);
  previewErrorRef.current = previewError;
  const [info, setInfo] = React.useState<FilmInfo | null>(null);
  const preview = React.useRef<PreviewHandle>(null);

  /* ── the film's picture, as the folder changes (the project and its files are read by the shell: shell/project-read) ── */
  React.useEffect(() => {
    const stop = projectEvents(projectId, (event) => {
      /* a picture that could not be drawn is tried again whenever the folder changes: the missing file arrived, or
         the clip that named it is gone from film.html now that the edit is written */
      if (previewErrorRef.current && (event.type === 'film' || event.type === 'files')) { preview.current?.reload?.(); }
      /* film.html alone gone: the project stays open (an agent at work in it goes on), and the picture says so until
         the film is back; a page opened while it was missing reads it then */
      if (event.type === 'film-missing') { setFilmMissing(true); return; }
      if (event.type !== 'files') return;
      /* a page, or a file pages use, changed on disk: the picture is drawn from them again. So is a media file a clip
         plays, made again in place (a render written over the last one): its element would go on playing what it
         had loaded of the old file. Other media under assets/ are loaded as they are used, and what no page loads
         (an agent's notes and scripts) leaves the picture as it is (lib/picture-files) */
      const used = new Set(blocksRef.current.map((b) => b.src).filter(Boolean));
      if (changesPicture(event.paths, used)) preview.current?.reload?.();
      else {
        const graded = colorFiles(event.paths);
        if (graded.length) void preview.current?.stage?.('regraded', { paths: graded });
      }
      colorFilesChanged(projectId, event.paths);
    });
    return () => { stop(); };
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
  /* the film as loaded: a new project name (a rename, or the snapshot a reconnecting page is sent) leaves it as it is */
  const initial = React.useMemo(() => (loaded?.doc && loaded.value ? { value: loaded.value, rev: loaded.rev } : null), [loaded?.doc, loaded?.value, loaded?.rev]);
  React.useEffect(() => { if (initial) lastServerDoc.current = initial.value; }, [initial]);
  /* the film with every edit made here, at once: an edit begun before the one before it was drawn (a color typed,
     then a stroke added with the same click) starts from it, not from the film before it */
  const filmRef = React.useRef<Film | null>(initial?.value ?? null);
  const film = useFilm(projectId, initial, React.useCallback((value: Film, kind: 'edit' | 'server', head?: string) => {
    filmRef.current = value;
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
  }, []), (latest) => {
    adoptFilm(latest);
    setFilmMissing(Boolean(latest.filmMissing));
  });
  personSteps.current = film.steps.done;
  filmRef.current = film.film;
  /* on `showError`, which stays the same: `toast` is new with every message, so showing it would run this again, and
     again (the editor gone) */
  const { showError } = toast;
  React.useEffect(() => { if (film.error) showError(film.error); }, [film.error, showError]);

  /* for the pictures' thumbnails in a menu built after the render that made it */
  const mediaSourcesRef = React.useRef(mediaSources);
  mediaSourcesRef.current = mediaSources;
  /* other preferences: the preview is loaded again behind the picture (the shell asks for the proxies again) */
  React.useEffect(() => { if (prefsTick) preview.current?.reload?.(); }, [prefsTick]);
  /* the caption tracks' files: read again when the folder changed (the agent may have written one), the picture too */
  React.useEffect(() => {
    if (!rawListing) return;
    refreshCaptionTracks(projectId);
    preview.current?.captions?.();
  }, [rawListing, projectId]);
  React.useEffect(() => () => setCaptionSelection(null), [projectId]);
  /* which workbench is shown (the canvas over the panes, the edit, Motion, a plugin's surface) is the shell's
     (shell/workbenches); what it asks of the edit as it changes that is kept here */
  /* opening it stops the film playing (the panes under it are hidden): the player's pause, set once it is made */
  const pauseRef = React.useRef<() => void>(() => {});
  /* layers the motion panel just put something on, twirled open on the motion timeline */
  const [motionReveal, setMotionReveal] = React.useState<{ ids: readonly string[]; n: number } | null>(null);
  /* the shell's way to show or hide a block of the edit's (shell/layout): the motion view opens the timeline and inspector with it */
  const openBlockRef = React.useRef<(id: string, open: boolean) => void>(() => {});

  /* ── transport: the sound is the clock; the picture follows it, drawn in the preview from the player's line ── */
  const player = React.useRef(new Player());
  React.useEffect(() => {
    const p = player.current;
    p.onAnchor = (anchor) => preview.current?.play?.(anchor);
    return () => { p.onAnchor = null; p.close(); };
  }, []);
  const [playing, setPlaying] = React.useState(false);
  const [timeMs, setTimeMs] = React.useState(0);
  const timeRef = React.useRef(0);
  timeRef.current = timeMs;
  const listeners = React.useRef(new Set<() => void>());
  /* where playback stops by itself (Play range: the range's end), ms; null: the film's end */
  const stopAtRef = React.useRef<number | null>(null);
  /* loop playback (⇧L, the viewer's button): the range marked, else the whole film, over and over */
  const [loop, setLoop] = React.useState(false);
  /* the picture's videos shown as their files are, their color grades left off: a before and after (⇧D) */
  const [ungraded, setUngraded] = React.useState(false);
  const loopRef = React.useRef(loop);
  loopRef.current = loop;
  /* the speed picked in the viewer's playback settings: what plays once a J/K/L shuttle is let go */
  const speedRef = React.useRef(1);
  /* the range marked (set below, with the timeline's): what loops */
  const rangeNowRef = React.useRef<FilmRange | null>(null);
  const clock = React.useMemo<PlaybackClock>(() => ({
    get: () => player.current.time() * 1000,
    subscribe: (fn) => { listeners.current.add(fn); return () => listeners.current.delete(fn); },
    line: () => { const a = player.current.anchor(); return a ? { ms: a.t * 1000, at: a.at, rate: a.rate } : null; },
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
        /* the player plays on from there: the preview is told its new line */
        player.current.seek(back / 1000);
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
      /* the picture draws itself from the player's line (Preview's play); the playhead, timecode and subtitles read the
         clock; the rest of the editor hears the time a few times a second (each time, all of it renders again) */
      for (const fn of listeners.current) fn();
      if (now - lastTick > 250) { lastTick = now; setTimeMs(t * 1000); }
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
    /* playing, it plays on from there (the preview is told the player's new line); still, the picture shows t */
    player.current.seek(t);
    setTimeMs(t * 1000);
    if (!player.current.playing) preview.current?.seek(pictureAt(t));
    for (const fn of listeners.current) fn();
  }, []);
  /* ── J / K / L: the shuttle. 1×, 2× and 4× forward are the player's own (with sound); backwards, the picture alone
     is sought along at that rate, silent, as a scrub is (the player plays forward only, at most 4×) ── */
  const shuttleRateRef = React.useRef(0);
  const shuttleFrame = React.useRef(0);
  /** The shuttle let go: the player back at the speed picked if the shuttle changed its rate. */
  const stopShuttle = React.useCallback(() => {
    if (shuttleFrame.current) cancelAnimationFrame(shuttleFrame.current);
    shuttleFrame.current = 0;
    if (shuttleRateRef.current !== 0 && player.current.rate !== speedRef.current) {
      player.current.setRate(speedRef.current);
      setRateState(player.current.rate);
    }
    shuttleRateRef.current = 0;
  }, []);
  const pause = React.useCallback(() => {
    stopAtRef.current = null;
    /* a picture-alone shuttle stops too */
    if (shuttleFrame.current) { cancelAnimationFrame(shuttleFrame.current); shuttleFrame.current = 0; shuttleRateRef.current = 0; }
    if (!player.current.playing) return;
    player.current.pause();
    /* stopped on the frame being shown: the timecode, the picture and an edit at the playhead all mean that frame */
    player.current.seek(snapToFrame(player.current.time() * 1000) / 1000);
    setPlaying(false);
    setTimeMs(player.current.time() * 1000);
    preview.current?.seek(pictureAt(player.current.time()));
    for (const fn of listeners.current) fn();
  }, []);
  pauseRef.current = pause;
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
    if (rate > 0 && rate <= SPEED_MAX) {
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
  /* Play range (its key, the ruler's menu): from its start, stopping at its end */
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
  /* while scrubbing, the picture and the timecode follow each step the timeline tells (every frame); the rest of the
     editor, which renders whole each time, hears the time a few times a second, and once more as the scrub ends */
  const scrubTold = React.useRef(0);
  const scrubPreview = React.useCallback((ms: number) => {
    pause();
    const t = Math.max(0, Math.min(ms / 1000, player.current.duration || ms / 1000));
    player.current.seek(t);
    preview.current?.seek(pictureAt(t));
    for (const fn of listeners.current) fn();
    const now = performance.now();
    if (now - scrubTold.current > 100) { scrubTold.current = now; setTimeMs(t * 1000); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pause]);
  const scrubCommit = React.useCallback((ms: number) => { pause(); seek(ms); }, [pause, seek]);
  /* Skimming shows a silent frame without moving the playback clock or the edit's playhead. */
  const skimPreview = React.useCallback((ms: number | null) => {
    if (player.current.playing || shuttleFrame.current) return;
    preview.current?.seek(pictureAt(ms == null ? player.current.time() : ms / 1000));
  }, []);

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
  /* the Layers panel reads its tree again when film.html changes, when the preview drew the film anew (a page
     written: a layer pasted into it, or the agent's edit), and when a page that came on is shown (it is in the tree
     only once drawn; the picture says so, and nothing else is rebuilt for it) */
  const [pageShown, setPageShown] = React.useState(0);
  /* the picture drawn again (a reload) is told again whether its grades are left off */
  /* the color workbench's before and after split across the picture, and where its line is (0–1 across) */
  const [split, setSplit] = React.useState<number | null>(null);
  React.useEffect(() => { void preview.current?.stage?.('compare', { off: ungraded, split }); }, [ungraded, split, pageShown]);
  const layersKey = React.useMemo(() => ({}), [film.film, info, pageShown]); // eslint-disable-line react-hooks/exhaustive-deps
  /* a file's length draws a clip that plays to its end before the preview places it (a split's second half, a drop) */
  const mediaFacts = React.useMemo<MediaFacts>(() => new Map([...facts].map(([path, f]) => [path, { audio: f.audio, ...(f.durationMs ? { duration: f.durationMs / 1000 } : {}) }])), [facts]);
  React.useEffect(() => {
    probeMedia(film.film?.tracks.flatMap((track) => track.clips.map((clip) => clip.src)) ?? []);
  }, [film.film, probeMedia]);
  const [pendingDrops, setPendingDrops] = React.useState<PendingDrop[]>([]);
  /* the caption tracks' files, read: their cues are blocks of their rows (lib/caption-blocks) */
  const captionSrcs = React.useMemo(() => (film.film?.tracks ?? []).flatMap((tr) => (tr.captions ? [tr.captions.src] : [])), [film.film]);
  const cuesOf = useCaptionTracksOf(projectId, captionSrcs);
  const timelineTracks = React.useMemo<TimelineTrack[]>(() => {
    if (!film.film) return [];
    const base = withCueBlocks(layoutTracks(filmShape(film.film as unknown as FilmDoc, info?.spans ?? [], mediaFacts, Boolean(previewError))), cuesOf);
    return pendingDrops.length ? withPendingBlocks(base, pendingDrops) : base;
  }, [film.film, info, mediaFacts, pendingDrops, previewError, cuesOf]);
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
  /** The main track (the lowest picture track), where the magnet acts: the inspector asks. */
  const mainTrack = React.useMemo(() => mainTrackOf(editModelOf(timelineTracks)), [timelineTracks]);
  /** How slow a clip can go without the magnet, with the clips linked to it (they take its speed too): the inspector asks. */
  const speedFloorOf = React.useCallback((block: TimelineBlock) => {
    if (!block.clipId) return 0;
    const model = editModel();
    return slowestSpeed(model, [block.clipId, ...linkedIds(model, [block.clipId]).filter((id) => id !== block.clipId)]);
  }, [editModel]);
  const blocksRef = React.useRef<readonly TimelineBlock[]>([]);
  blocksRef.current = React.useMemo(() => timelineTracks.flatMap((tr) => tr.blocks), [timelineTracks]);
  /* the film's length: the preview's, unless it could not draw the film; that length is then of the film before
     (a clip that lost its length still counted at its old one), and the timeline's own reading of film.html stands,
     less the clips that have no length (drawn at a stand-in one) */
  const totalMs = previewError || !info ? blocksRef.current.reduce((end, b) => (b.noLength || b.cue ? end : Math.max(end, Math.round(b.endMs))), 0) : drawnMs;
  /* before the preview is up (a long film still loading), that reading is the film's length too: the playhead moves
     and plays at once, the picture and the sound join it as they come (see onInfo) */
  React.useEffect(() => {
    if (!info && totalMs > 0) player.current.duration = totalMs / 1000;
  }, [info, totalMs]);

  /* ── the project's editor settings (`.film/settings.json`): its frame rate, its tracks' names ── */
  const [settings, setSettings] = React.useState<ProjectSettings | null>(null);
  React.useEffect(() => {
    setSettings(null);
    void api.settings(projectId).then(setSettings, () => setSettings({}));
  }, [projectId]);
  const patchSettings = React.useCallback((patch: Parameters<typeof api.patchSettings>[1]) =>
    api.patchSettings(projectId, patch).then(setSettings, (e: Error) => { toast.showError(e.message); }), [projectId, toast]);
  /* the rate frames are counted in: the project's own, else its first footage's (on the film by time, then the
     project's other videos), else 30 */
  const footageRate = React.useMemo(() => footageFps([
    ...timelineTracks.flatMap((tr) => tr.blocks).filter((b) => b.kind === 'video' && b.src).sort((a, b) => a.startMs - b.startMs).map((b) => facts.get(b.src!)?.fps),
    ...(rawListing?.files ?? []).filter((f) => f.kind === 'video').map((f) => facts.get(f.path)?.fps),
  ]), [timelineTracks, rawListing, facts]);
  const projectFps = settings?.fps ?? footageRate;
  /* stretches that play late, rendered in the background to play smoothly (editor/use-preview-renders) */
  const { renders: rendersOn, stats: statsOn } = usePreviewPrefs();
  const previewRenders = usePreviewRenders({ projectId, folder, fps: exactRate(projectFps), playing, on: rendersOn, film: film.film, files: filesTick, preview, duration: totalMs / 1000 });
  /* Settings → Developer: how playing goes, in the viewer's corner, said about once a second */
  const [played, setPlayed] = React.useState<PlayedReport | null>(null);
  const renderPreview = React.useCallback((clipId?: string) => {
    const range = rangeNowRef.current;
    const block = clipId ? blocksRef.current.find((b) => b.clipId === clipId) : blocksRef.current.find((b) => b.kind === 'video' && b.startMs <= player.current.time() * 1000 && b.endMs > player.current.time() * 1000);
    const a = range ? range.startMs / 1000 : block ? block.startMs / 1000 : Math.max(0, player.current.time());
    const b = range ? range.endMs / 1000 : block ? block.endMs / 1000 : Math.min(totalMs / 1000, a + 5);
    pause(); writePreviewPref('renders', true); previewRenders.request([[Math.max(0, a), Math.min(totalMs / 1000, b)]]);
  }, [previewRenders.request, totalMs, pause]);
  const visionPreview = { ...previewRenders, render: renderPreview };
  const onPlayed = React.useCallback((report: PlayedReport) => {
    previewRenders.onPlayed(report);
    if (statsOn) setPlayed(report);
  }, [previewRenders, statsOn]);
  React.useEffect(() => { setTimecodeFps(projectFps); }, [projectFps]);
  React.useEffect(() => () => setTimecodeFps(30), []);
  const frameRate = React.useMemo(() => ({ fps: projectFps, fromFootage: settings?.fps == null, onChange: (fps: number) => patchSettings({ fps }) }), [projectFps, settings, patchSettings]);

  /* selection, by clip id: a block's own id is its place, and that changes when it moves */
  const [selectedKeys, setSelectedKeys] = React.useState<readonly string[]>([]);
  const selectedKeysRef = React.useRef(selectedKeys);
  selectedKeysRef.current = selectedKeys;
  const selectedBlocks = React.useMemo(() => {
    const keys = new Set(selectedKeys);
    return blocksRef.current.filter((b) => keys.has(b.clipId ?? b.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineTracks, selectedKeys]);
  const selectedIds = React.useMemo(() => selectedBlocks.map((b) => b.id), [selectedBlocks]);
  /* the clips of film.html among them: a caption track's cues are picked with them, and have their own inspector */
  const selectedClips = React.useMemo(() => selectedBlocks.filter((b) => !b.cue), [selectedBlocks]);
  /* the timeline's commands (⌘B, Q / W, ⌥← / →, its switches), for the keys bound here */
  const timelineCommands = React.useRef<TimelineCommands | null>(null);
  /**
   * The picture has the keyboard (the last press was on it; the inspector and the picture's own bars and menus keep
   * it): the arrow keys move what is in hand there. Anywhere else they move the playhead. The frame round what is in
   * hand is the only mark: a ring round the whole picture read as the picture being selected.
   */
  const [viewerFocus, setViewerFocus] = React.useState(false);
  React.useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (el?.closest?.('[data-viewer-picture]')) { setViewerFocus(true); return; }
      if (el?.closest?.('[data-film-inspector], [role="menu"], [data-popover-panel]')) return;
      setViewerFocus(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, []);

  /* ── layout ── */
  /* how the window is laid out is the shell's (shell/layout, shell/arrangement): it lays out the edit's blocks (the
     viewer, the layers, the inspector, the timeline) wherever the arrangement shown puts them, and the edit draws each
     into its place (InBlock). What the edit reads of where they are (`arrangement`): their places by id, the room they
     share where the panels are docked, and their boxes where they float. How each is drawn there (the timeline fitted
     to its tracks, the inspector left out of a narrow window while idle) is the edit's (editSizes below), told to the
     shell through the wiring (`blocks`). A block shown or hidden here is told with `openBlock` */
  openBlockRef.current = (id, open) => openBlock('edit', id, open);
  const own = React.useMemo(() => {
    const places: Record<string, BlockPlace> = {}, free: Record<string, DockRect> = {};
    for (const block of arrangement.spec.blocks) {
      if (block.owner !== 'edit') continue;
      const place = arrangement.layout.blocks[block.key], box = arrangement.free?.[block.key];
      if (place) places[block.id] = place;
      if (box) free[block.id] = box;
    }
    return { places, free: arrangement.free ? free : null };
  }, [arrangement]);
  const timelineOpen = Boolean(own.places.timeline?.open);
  const inspectorOpen = Boolean(own.places.inspector?.open);
  const setLayersPaneOpen = React.useCallback((value: boolean) => openBlock('edit', 'layers', value), [openBlock]);
  const setInspectorOpen = React.useCallback((value: boolean) => openBlock('edit', 'inspector', value), [openBlock]);
  const layersPaneRef = React.useRef<HTMLDivElement | null>(null);
  const closeInspector = React.useCallback(() => setInspectorOpen(false), [setInspectorOpen]);
  /* the timeline fits its tracks (not taller than they need, up to 45% of the window) unless the person dragged it */
  const fitTimelineHeight = React.useRef<number>(TIMELINE_H);
  if (!pendingDrops.length) {
    const cap = Math.round(window.innerHeight * 0.45);
    fitTimelineHeight.current = Math.max(TIMELINE_H, Math.min(timelineFitHeight(timelineTracks), cap));
  }
  const timelineFit = fitTimelineHeight.current;

  /* what is selected in the picture: a layer of a page, or a clip in hand */
  const [stageElement, setStageElement] = React.useState<StageElement | null>(null);
  /* the inspector's font menu: this project's fonts, for the page the layer in hand is in */
  const stageClipLoc = stageElement?.clipLoc;
  const fontScope = React.useMemo<FontScope>(() => {
    const src = stageClipLoc ? blocksRef.current.find((b) => b.loc === stageClipLoc)?.src : undefined;
    return { projectId, folder, page: src && filmSrcIsPage(src) ? src : null, tick: filesTick };
  }, [projectId, folder, stageClipLoc, filesTick, timelineTracks]);
  const stageElementRef = React.useRef(stageElement);
  stageElementRef.current = stageElement;
  /* the inspector shows a media file, or what is selected */
  const [pickedMedia, setPickedMedia] = React.useState<WorkspaceResource | null>(null);
  const dismissLibraryPreview = React.useRef<() => boolean>(() => false);
  const [libraryPreviewBar, setLibraryPreviewBar] = React.useState<HTMLDivElement | null>(null);
  const [libraryPreviewPicture, setLibraryPreviewPicture] = React.useState<HTMLDivElement | null>(null);
  /* the file picked is one of Saved (lib/saved): shown from there, and brought into the project when it is used */
  const [pickedSaved, setPickedSaved] = React.useState(false);
  const [inspectorContent, setInspectorContent] = React.useState<'selection' | 'captions' | WorkspaceResource>('selection');
  const subs = useFilmSubtitles(projectId);
  /** Cues of a caption track picked (on its row, or on the picture): their look and words in the inspector. */
  const showCaptionLook = React.useCallback(() => {
    setSelectedKeys((keys) => keys.filter((k) => isCueClip(k)));
    setStageElement(null);
    setInspectorContent('captions');
    setInspectorOpen(true);
  }, []);
  const pickMedia = React.useCallback((file: WorkspaceResource | null) => {
    if (file) { dismissLibraryPreview.current(); pause(); }
    setPickedMedia(file);
    /* one of the project's, unless the Saved pane says otherwise right after (pickSaved) */
    setPickedSaved(false);
    if (file) { setInspectorContent(file); setInspectorOpen(true); }
    else setInspectorContent((c) => (typeof c === 'object' ? 'selection' : c));
  }, [pause]);
  /* Blank space anywhere in the workspace dismisses a source preview. Controls and selectable items handle their
     own presses, including the timeline, which also returns from preview on a clip click. */
  React.useEffect(() => {
    const interactive = [
      'button, a[href], input, select, textarea, [contenteditable], [draggable="true"]',
      '[role="button"], [role="tab"], [role="slider"], [role="treeitem"], [role="menu"], [role="listbox"], [role="dialog"]',
      '[data-media-key], [data-library-card], [data-library-audio], [data-library-voice], [data-asset-preview-control]',
      '[data-workspace-timeline], [data-popover-panel]',
    ].join(', ');
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      /* a source preview's own surface can be dragged onto the film, yet beside its picture it is blank space */
      const hit = event.target.closest(interactive);
      if (hit && !hit.matches('[data-source-drag]')) return;
      dismissLibraryPreview.current();
      if (pickedMedia) pickMedia(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [pickedMedia, pickMedia]);
  /* a caption's cues picked on the timeline are the picked cues of the caption inspector and the picture too, and
     those picked there are picked on the timeline (one selection, seen in three places) */
  const fromTimeline = React.useRef(false);
  const onTimelineSelected = React.useCallback((ids: readonly string[]) => {
    const picked = blocksRef.current.filter((b) => ids.includes(b.id));
    setSelectedKeys(picked.map((b) => b.clipId ?? b.id));
    setPickedTransition(null);
    const cues = picked.flatMap((b) => (b.cue ? [b.cue] : []));
    const src = cues[0]?.src;
    const next = src && cues.every((c) => c.src === src) ? { src, ids: new Set(cues.map((c) => c.id)) } : null;
    const now = captionSelectionNow();
    /* told only when it changes (the effect below then knows it came from here) */
    if (next?.src !== now?.src || next?.ids.size !== now?.ids.size || [...(next?.ids ?? [])].some((id) => !now?.ids.has(id))) {
      fromTimeline.current = true;
      setCaptionSelection(next);
    }
    if (ids.length) {
      setInspectorContent(cues.length === picked.length ? 'captions' : 'selection');
      setInspectorOpen(true);
      setStageElement((el) => (el && el.kind !== 'clip' ? null : el));
    }
  }, []);
  const cuePick = useCaptionSelection();
  React.useEffect(() => {
    if (fromTimeline.current) { fromTimeline.current = false; return; }
    const cues = cuePick ? [...cuePick.ids].map((id) => cueClipId(cuePick.src, id)) : [];
    setSelectedKeys((keys) => {
      const next = [...keys.filter((k) => !isCueClip(k)), ...cues];
      return next.length === keys.length && next.every((k, i) => k === keys[i]) ? keys : next;
    });
  }, [cuePick]);
  const inspectorIdle = inspectorContent === 'selection' && !stageElement && !selectedBlocks.length;
  const filmRead = Boolean(film.film);
  /**
   * How the edit's blocks are drawn where the panels are docked, in `room` (the row's width beside the viewer, the
   * column's height; 0: not measured yet), with their places (by id) and, where the panels float, their boxes.
   */
  const editSizes = React.useCallback((room: BlockRoom, places: Readonly<Record<string, BlockPlace>>, free: Readonly<Partial<Record<string, DockRect>>> | null) => {
    const { width: rowWidth, height: colHeight } = room;
    /* a height the person dragged is theirs, as tall as the picture's minimum allows; until then the tracks' fit (not
       taller than they need, nor than 45% of the column) */
    const storedTimelineHeight = places.timeline?.size ?? null;
    const timelineHeight = storedTimelineHeight ?? timelineFit;
    const timelineTallest = colHeight ? Math.max(MIN_DOCK_H, colHeight - MIN_STAGE_H - DOCK_GAP) : Infinity;
    const timelineShownHeight = storedTimelineHeight !== null
      ? Math.min(timelineHeight ?? TIMELINE_H, timelineTallest)
      : colHeight
        ? Math.min(timelineHeight, timelineTallest, timelineFit + TIMELINE_SPARE, Math.max(MIN_DOCK_H, Math.round(colHeight * TIMELINE_SHARE)))
        : Math.min(timelineHeight ?? TIMELINE_H, timelineFit + TIMELINE_SPARE);
    const rowNarrow = rowWidth > 0 && rowWidth < MIN_VIEWER + DEFAULT_INSPECTOR + 240;
    const inspectorShown = Boolean(places.inspector?.open) && (Boolean(free) || !(rowNarrow && inspectorIdle));
    const inspectorWanted = places.inspector?.size ?? DEFAULT_INSPECTOR;
    const inspectorShownWidth = free?.inspector?.width ?? (rowWidth && inspectorShown ? Math.max(200, Math.min(inspectorWanted, rowWidth - MIN_VIEWER - 8)) : inspectorWanted);
    const layersWidth = places.layers?.size ?? 240;
    const layersRoom = rowWidth - (inspectorShown ? inspectorShownWidth : 0) - MIN_VIEWER - 16;
    const layersShownWidth = free?.layers?.width ?? (rowWidth ? Math.min(layersWidth, layersRoom) : layersWidth);
    const layersFit = Boolean(free) || !rowWidth || layersShownWidth >= 180;
    const layersShown = Boolean(places.layers?.open) && layersFit;
    return {
      timelineShownHeight, timelineShown: Boolean(places.timeline?.open) && filmRead, inspectorShown, inspectorShownWidth,
      layersWidth, layersShownWidth, layersFit, layersShown,
    };
  }, [timelineFit, inspectorIdle, filmRead]);
  const { inspectorShown, inspectorShownWidth, layersShownWidth, layersFit, layersShown } = editSizes(arrangement.room, own.places, own.free);

  /* ── edits: the timeline's and the inspector's, turned into the server's operations by clip id ── */
  /* the picture's controls, set by FilmStageSelect (declared here: every edit asks it to write its arrow keys' first) */
  const stageControl = React.useRef<FilmStageControl | null>(null);
  /**
   * Every edit goes through here: what the arrow keys moved on the picture and is not written yet is written first, so
   * it is a step of its own before this one (and is never written after an undo, over it).
   */
  const filmEdit = film.edit;
  const filmRecord = film.record;
  const edit = React.useCallback(async (ops: Op[], label?: string, quiet?: boolean, outside?: OutsideStep): Promise<string | null> => {
    stageControl.current?.flushPending();
    /* a text of the library put in without a box of its own would be laid out over the whole picture, its words in
       the middle of an empty page as big as the frame: it gets its catalog shape's box (libraryBox) */
    ops = ops.map((op) => {
      if (op.op !== 'insert') return op;
      const clip = op.clip as { src?: string; box?: unknown; size?: unknown } | undefined;
      if (!clip?.src || clip.box || clip.size || !isLibraryText(clip.src)) return op;
      const folder = /^saved\/openfilm\/text-([^/]+)\//.exec(clip.src)?.[1] ?? '';
      const item = builtInItem(`${BUILT_IN}/text/${folder}`) ?? builtInItem(`${BUILT_IN}/${TEXT_COMPONENT}`);
      const box = libraryBox(item ?? { w: 1600, h: 260, fit: 0.14 }, stageRef.current ?? { w: 1920, h: 1080 });
      return box ? { ...op, clip: { ...op.clip, box, size: { w: box.w, h: box.h } } as never } : op;
    });
    /* the caption tracks' cues are clips of the timeline (lib/caption-blocks): what an edit does to them is written to
       their files first, and is one undo step with what it does to film.html */
    const current = filmRef.current;
    if (!current || outside || !current.tracks.some((tr) => tr.captions)) return filmEdit(ops, label, quiet, outside);
    const split = cueEditOf(current as never, ops, (src) => captionTrackNow(projectId, src), copiedCues.current);
    if (!split) return t('captionTrack.onlyCues');
    const cues = split.files.length ? await writeCaptionTracksWith(projectId, split.files) : null;
    if (typeof cues === 'string') return cues;
    const followSelection = () => {
      const sel = captionSelectionNow();
      if (!sel || !split.moved?.length) return;
      const picked = [...sel.ids].map((id) => split.moved!.find((c) => c.from === cueClipId(sel.src, id)) ?? { src: sel.src, id });
      const src = picked[0]?.src;
      setCaptionSelection(src && picked.every((c) => c.src === src) ? { src, ids: new Set(picked.map((c) => c.id)) } : null);
    };
    /* Empty caption tracks remain available for another caption or a drag back onto them. Removing a whole track is
       explicit (the track's menu), rather than a side effect of moving or deleting its last cue. */
    const filmOps = split.ops;
    if (!filmOps.length) {
      if (cues) filmRecord(label ?? 'history.stepEdit', cues);
      followSelection();
      return null;
    }
    const why = await filmEdit(filmOps, label, quiet, cues ?? undefined);
    if (why && cues) await cues.undo();
    if (!why) followSelection();
    return why;
  }, [filmEdit, filmRecord, projectId, t]);
  /** `quiet`: the caller shows why an edit was refused itself (the inspector does, beside its field) */
  const editBlocks = React.useCallback((given: ClipEdit[], quiet = false): Promise<string | null> => {
    const current = filmRef.current;
    /* a box changed (on the picture, by its fields) while its position, scale or rotation moves: a keyframe at the
       playhead for those, as an animation editor keys a value changed with its stopwatch on (lib/motion-keys keyedBox);
       an edit that writes the clip's keyframes itself is taken as it is */
    const asked = given.flatMap((e): ClipEdit[] => {
      if (e.prop !== 'box' || !e.value || given.some((o) => o.loc === e.loc && o.prop === 'motion')) return [e];
      const id = clipIdAt(current, e.loc);
      const clip = id ? current?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === id) : null;
      const block = blocksRef.current.find((bl) => bl.clipId === id);
      if (!clip || !block?.size) return [e];
      const local = (timeRef.current - block.startMs) / 1000;
      if (local < 0 || local > (block.endMs - block.startMs) / 1000) return [e];
      const motion = readMotion(clip as { id: string; style?: string }, current?.keyframes);
      const keyed = keyedBox((clip.box ?? {}) as Record<string, number>, e.value as Record<string, number>, block.size, motion, local, 1 / Math.max(1, projectFps));
      if (!keyed) return [e];
      return [{ loc: e.loc, prop: 'box', value: Object.keys(keyed.box).length ? keyed.box as Record<string, number> : null }, { loc: e.loc, prop: 'motion', value: keyed.motion as unknown as Record<string, unknown> }];
    });
    /* a locked track is the person's: nothing on it changes, whichever way the edit came (the picture, the inspector) */
    if (lockedEdits(asked, current).length) return Promise.resolve(t('timeline.trackLocked'));
    const edits = apartOnTracks(asked, blocksRef.current);
    const mapped = edits.map((e) => ({ clip: clipIdAt(current, e.loc), prop: e.prop, value: e.value }));
    if (mapped.some((e) => !e.clip)) return Promise.resolve(t('timeline.editFail'));
    return edit([{ op: 'props', edits: mapped as { clip: string; prop: string; value: never }[] }], editStepLabel(edits, tracksRef.current), quiet);
  }, [edit, t, projectFps]);
  /* ── keyframes on the timeline (components/MotionLanes): the picked clip's moving properties as rows under its track,
     the keyframes picked there, and what F9, Delete, ⌥←/→ and their menu do to them (lib/motion-keys) ── */
  const [pickedKeys, setPickedKeys] = React.useState<ReadonlySet<string>>(() => new Set());
  const [keyMenu, setKeyMenu] = React.useState<{ x: number; y: number } | null>(null);
  const motionBlock = selectedBlocks.length === 1 && selectedBlocks[0]!.clipId && selectedBlocks[0]!.loc ? selectedBlocks[0]! : null;
  /* keyframes picked on another clip's rows (the motion timeline): that clip picked first, then they are */
  const pendingPick = React.useRef<{ clip: string; ids: string[] } | null>(null);
  React.useEffect(() => {
    const pending = pendingPick.current;
    pendingPick.current = null;
    setPickedKeys(new Set(pending && pending.clip === motionBlock?.clipId ? pending.ids : []));
    setKeyMenu(null);
  }, [motionBlock?.clipId]);
  const motionOfBlock = React.useCallback((block: TimelineBlock | null): Motion => {
    const clip = block?.clipId ? film.film?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === block.clipId) : null;
    return clip ? readMotion(clip as { id: string; style?: string }, film.film?.keyframes) : {};
  }, [film.film]);
  /* where a clip's keyframes have its picture at the playhead: its frame on the picture is drawn there */
  const poseOf = React.useCallback((clipId: string) => {
    const block = blocksRef.current.find((b) => b.clipId === clipId);
    if (!block) return null;
    const local = Math.min(Math.max((timeRef.current - block.startMs) / 1000, 0), (block.endMs - block.startMs) / 1000);
    const style = (film.film?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clipId) as { style?: string } | undefined)?.style ?? '';
    const still = (p: 'ax' | 'ay') => { const n = Number.parseFloat(declared(style, `--fx-${p}`) ?? ''); return Number.isFinite(n) ? n : 0; };
    return poseAt(motionOfBlock(block), local, { ax: still('ax'), ay: still('ay') });
  }, [motionOfBlock, film.film]);
  const stagePoseKey = motionBlock?.clipId && !playing ? JSON.stringify(poseOf(motionBlock.clipId)) : '';
  /* the picked clip's keyframes rewritten; the ones picked follow where they went */
  const rewriteMotion = React.useCallback((next: Motion, picked?: ReadonlySet<string>) => {
    if (!motionBlock?.loc) return;
    if (picked) setPickedKeys(picked);
    void editBlocks([{ loc: motionBlock.loc, prop: 'motion', value: Object.keys(next).length ? (next as unknown as Record<string, unknown>) : null }]).then((err) => { if (err) toast.showError(err); });
  }, [motionBlock, editBlocks, toast]);
  const keyCommand = React.useCallback((what: EaseCommand | 'delete' | { move: number }) => {
    if (!pickedKeys.size) return;
    const motion = motionOfBlock(motionBlock);
    if (what === 'delete') { rewriteMotion(withoutKeys(motion, pickedKeys), new Set()); return; }
    if (typeof what === 'object') {
      const moved = movedKeys(motion, pickedKeys, what.move);
      /* the picked ones, where they are now */
      const now = new Set([...pickedKeys].flatMap((id) => {
        const k = parseKeyId(id);
        if (!k) return [];
        const lowest = Math.min(...[...pickedKeys].map((x) => parseKeyId(x)).filter((x) => x?.prop === k.prop).map((x) => x!.t));
        return [keyId(k.prop, Math.round((k.t + Math.max(what.move, -lowest)) * 1000) / 1000)];
      }));
      rewriteMotion(moved, now);
      return;
    }
    rewriteMotion(easedMotion(motion, pickedKeys, what));
  }, [pickedKeys, motionBlock, motionOfBlock, rewriteMotion]);
  const keyFrameS = 1 / Math.max(1, projectFps);
  /* keyframes copied (⌘C with keyframes picked): ⌘V puts them on the picked clip at the playhead, until something
     else is copied */
  const keyClipRef = React.useRef<CopiedKeys | null>(null);
  /* the same for an element's keyframes picked in a composition (set where its rows are made, elementLanesOf) */
  const elementKeys = React.useRef<{ run: (what: EaseCommand | 'delete' | { move: number }) => boolean; copy: () => CopiedKeys | null; paste: (copied: CopiedKeys) => boolean }>({ run: () => false, copy: () => null, paste: () => false });
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === 'F3' && e.shiftKey && motionBlock) { e.preventDefault(); setMotionGraph((on) => !on); return; }
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 'c' || key === 'x') {
        keyClipRef.current = key !== 'c' ? null : pickedKeys.size ? copiedKeys(motionOfBlock(motionBlock), pickedKeys) : elementKeys.current.copy();
        if (!keyClipRef.current) return;
      } else if (key === 'v' && keyClipRef.current && elementKeys.current.paste(keyClipRef.current)) {
        /* pasted on the element picked in the composition open */
      } else if (key === 'v' && keyClipRef.current && motionBlock) {
        const local = (timeRef.current - motionBlock.startMs) / 1000;
        if (local < -keyFrameS / 2 || local > (motionBlock.endMs - motionBlock.startMs) / 1000 + keyFrameS / 2) return;
        const pasted = pastedKeys(motionOfBlock(motionBlock), keyClipRef.current, Math.max(0, local), keyFrameS);
        rewriteMotion(pasted.motion, pasted.picked);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pickedKeys, motionBlock, motionOfBlock, rewriteMotion, keyFrameS]);
  React.useEffect(() => {
    if (!pickedKeys.size) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      let done = true;
      if (e.key === 'F9') keyCommand(e.metaKey && e.shiftKey ? 'easy-out' : e.shiftKey ? 'easy-in' : 'easy');
      else if (e.key === 'Backspace' || e.key === 'Delete') keyCommand('delete');
      else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) keyCommand({ move: (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1) * keyFrameS });
      else if (e.key === 'Escape') setPickedKeys(new Set());
      else done = false;
      if (done) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pickedKeys, keyCommand, keyFrameS]);
  const MOTION_LABEL: Record<MotionProp, string> = { translate: 'inspector.keyPosition', scale: 'inspector.keyScale', rotate: 'inspector.keyRotate', opacity: 'inspector.keyOpacity' };
  /* a keyed property's name: a Transform's, or an effect's */
  const keyedLabel = (p: KeyedProp) => t(p in EFFECTS ? `canvas.fx.${p}` : MOTION_LABEL[p as MotionProp]);
  /* the picked clip's rows drawn as a graph (⇧F3, or its button) */
  const [motionGraph, setMotionGraph] = React.useState(false);
  /**
   * A picture clip's rows of keyframes (components/MotionLanes): the picked clip's with its picked keyframes; another's
   * (the motion timeline shows every layer's) picks the clip first, then its keyframes.
   */
  const lanesOf = React.useCallback((block: TimelineBlock & { clipId: string }): MotionLanes => {
    const mine = block.clipId === motionBlock?.clipId;
    const motion = motionOfBlock(block);
    const clipStyle = (film.film?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === block.clipId) as { style?: string } | undefined)?.style;
    const fx = effectsOf(clipStyle);
    const threeD = /--fx-(z|rx|ry)\b/.test(clipStyle ?? '') || (['z', 'rx', 'ry'] as const).some((p) => motion[p]?.length);
    const rows = [...MOTION_PROPS, 'ax' as const, 'ay' as const, ...fx.on, ...(threeD ? (['z', 'rx', 'ry'] as const) : [])].map((p) => ({ prop: p, label: keyedLabel(p), keys: motion[p] ?? [] }));
    const startMs = block.startMs;
    const rewrite = (next: Motion, picked?: ReadonlySet<string>) => {
      if (!block.loc) return;
      if (picked) {
        if (mine) setPickedKeys(picked);
        else { pendingPick.current = { clip: block.clipId, ids: [...picked] }; setSelectedKeys([block.clipId]); }
      }
      void editBlocks([{ loc: block.loc, prop: 'motion', value: Object.keys(next).length ? (next as unknown as Record<string, unknown>) : null }]).then((err) => { if (err) toast.showError(err); });
    };
    return {
      clipId: block.clipId, startMs, endMs: block.endMs, rows, picked: mine ? pickedKeys : NO_KEYS, playheadMs: timeMs, frameMs: 1000 * keyFrameS,
      onPick: (ids, mode) => {
        if (!mine) {
          pendingPick.current = { clip: block.clipId, ids: [...ids] };
          setSelectedKeys([block.clipId]);
          return;
        }
        setPickedKeys((was) => {
          if (mode === 'set') return new Set(ids);
          const next = new Set(was);
          for (const id of ids) { if (mode === 'toggle' && next.has(id)) next.delete(id); else next.add(id); }
          return next;
        });
      },
      onMove: (dt) => { if (mine) keyCommand({ move: dt }); },
      onToggleHere: (prop) => {
        const local = (timeRef.current - startMs) / 1000;
        const keys = motion[prop] ?? [];
        const here = keys.find((k) => Math.abs(k.t - local) < keyFrameS / 2);
        const rest = keys.filter((k) => k !== here);
        /* the first keyframe of a property is its value now: the clip's own opacity, else no change */
        const own = () => {
          const clip = film.film?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === block.clipId) as { style?: string } | undefined;
          const n = Number.parseFloat(declared(clip?.style ?? '', 'opacity') ?? '1');
          return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
        };
        const still = prop in EFFECTS ? fx.values[prop as EffectProp] ?? EFFECTS[prop as EffectProp].rest : prop === 'opacity' ? own() : valueAt(prop, keys, local);
        if (!here) rest.push({ t: Math.round(local * 1000) / 1000, v: keys.length ? valueAt(prop, keys, local) : still });
        rest.sort((a, b) => a.t - b.t);
        const next = { ...motion };
        if (rest.length) next[prop] = rest; else delete next[prop];
        rewrite(next);
      },
      onSeek: seek,
      onMenu: (e) => { if (mine) setKeyMenu({ x: e.clientX, y: e.clientY }); },
      graph: motionGraph,
      onGraph: () => setMotionGraph((on) => !on),
      onCurve: (prop, at, curve) => {
        const ease = easeOfBezier(curve);
        rewrite({ ...motion, [prop]: (motion[prop] ?? []).map((k) => {
          if (k.t !== at) return k;
          const { ease: _was, ...rest } = k;
          return ease ? { ...rest, ease } : rest;
        }) });
      },
      onKeyEdit: (prop, at, to) => {
        const keys = (motion[prop] ?? []).filter((k) => k.t === at || Math.abs(k.t - to.t) >= keyFrameS / 2);
        const next = keys.map((k) => (k.t === at ? { ...k, t: to.t, v: to.v } : k)).sort((a, b) => a.t - b.t);
        rewrite({ ...motion, [prop]: next }, new Set([keyId(prop, to.t)]));
      },
      labels: { prev: t('inspector.keyPrev'), next: t('inspector.keyNext'), add: t('inspector.keyAdd'), remove: t('inspector.keyRemove'), graph: t('inspector.keyGraph') },
    };
  }, [motionBlock, motionOfBlock, pickedKeys, timeMs, keyFrameS, keyCommand, editBlocks, seek, t, motionGraph, film.film, toast]); // eslint-disable-line react-hooks/exhaustive-deps
  /* the motion timeline's layers: every picture clip, the topmost track's first, each by its start */
  const motionLayers = React.useMemo(() => [...timelineTracks]
    .flatMap((track) => track.blocks.filter((b) => b.clipId && b.loc && (b.kind === 'mg' || b.kind === 'video'))
      .sort((a, b) => a.startMs - b.startMs).map((b) => ({ ...b, clipId: b.clipId! }))), [timelineTracks]);
  /* a page layer's Contents (set once its properties can be read, below) */
  const contentsOfRef = React.useRef<(layer: TimelineBlock & { clipId: string }) => LayerContents | null>(() => null);
  /* a layer of the motion timeline beyond its keyframes: its Transform's numbers (the inspector's, lib/clip-transform),
     how it blends (its mix-blend-mode) */
  const layerHostOf = React.useCallback((layer: TimelineBlock & { clipId: string }): LayerHost => {
    const clip = film.film?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === layer.clipId) as { style?: string; box?: FilmBox } | undefined;
    const css = clip?.style ?? '';
    const placed = layer.size ? { kind: layer.kind, own: layer.size, box: clip?.box ?? layer.box, stage: film.film?.stage ?? { w: 1920, h: 1080 }, css } : null;
    const length = (layer.endMs - layer.startMs) / 1000;
    const model = placed ? transformModel(motionOfBlock(layer), staticTransform(placed).base, (timeMs - layer.startMs) / 1000, length, keyFrameS) : null;
    const style = (decl: Record<string, string | null>) => {
      if (!layer.loc) return;
      void editBlocks([{ loc: layer.loc, prop: 'style', value: withDeclarations(css, decl) || null }]).then((err) => { if (err) toast.showError(err); });
    };
    const local = (timeMs - layer.startMs) / 1000;
    const fx = effectsOf(css);
    const motion = motionOfBlock(layer);
    const effects = effectsModel(motion, fx.on, fx.values, Math.min(Math.max(local, 0), length), local >= 0 && local <= length, keyFrameS);
    /* its mask (lib/clip-mask), drawn in its box as it shows, and the keyframes it moves by (lib/mask-motion) */
    const tf = placed ? staticTransform(placed).tf : null;
    const mbox = placed && tf ? { w: placed.own.w * tf.scaleX, h: placed.own.h * tf.scaleY } : null;
    const maskName = `${layer.clipId}--mask`;
    const maskNow = maskOf(declared(css, 'mask-image'), declared(css, 'mask-composite'), mbox);
    const maskKeys = readMaskKeys(film.film?.keyframes?.[maskName]);
    const writeMask = (base: Mask | null, keys: MaskKeys) => {
      const read0 = (prop: string) => declared(css, prop) ?? undefined;
      const own = maskCss(read0, base, mbox);
      if (!own) return;
      const style1 = withDeclarations(css, own);
      const read1 = (prop: string) => declared(style1, prop) ?? undefined;
      const frames = base ? maskKeyframes(base, keys, read1, mbox, projectFps) : null;
      const entries = animationsOf(style1).filter((e) => e.split(/\s+/)[0] !== maskName);
      const style2 = withAnimations(style1, frames ? [...entries, `${maskName} ${Math.round(frames.secs * 1000) / 1000}s linear both`] : entries);
      void edit([
        { op: 'props', edits: [{ clip: layer.clipId, prop: 'style', value: style2 || null }] },
        { op: 'keyframes', set: { [maskName]: frames?.body ?? null } },
      ], clipStep('history.stepMoved', [layer.clipId])).then((err) => { if (err) toast.showError(err); });
    };
    const mask: LayerMask | null = !placed || maskNow === null ? null : {
      shape: maskNow?.shape ?? null,
      invert: Boolean(maskNow?.invert),
      model: maskNow ? maskModel(maskNow, maskKeys, Math.min(Math.max(local, 0), length), local >= 0 && local <= length, keyFrameS) : null,
      keys: maskKeys,
      setShape: (shape) => writeMask(shape ? maskDefault(shape, mbox, maskNow ?? null) : null, shape ? maskKeys : {}),
      setInvert: (on) => { if (maskNow) writeMask({ ...maskNow, invert: on }, maskKeys); },
      commit: (c) => { if (c && maskNow) writeMask(c.base ?? maskNow, c.keys); },
    };
    /* in 3D (SPEC §1): its depth and its turn about X and Y, kept in its style, keyed as its effects are */
    const THREE = ['z', 'rx', 'ry'] as const;
    const threeOn = /--fx-(z|rx|ry)\b/.test(css) || THREE.some((p) => motion[p]?.length);
    const threeValues = Object.fromEntries(THREE.flatMap((p) => {
      const n = Number.parseFloat(declared(css, `--fx-${p}`) ?? '');
      return Number.isFinite(n) ? [[p, n]] : [];
    }));
    const writeThree = (decl: Record<string, string | null>, next: Motion) => {
      if (!layer.loc) return;
      void editBlocks([
        { loc: layer.loc, prop: 'style', value: withDeclarations(css, decl) || null },
        { loc: layer.loc, prop: 'motion', value: Object.keys(next).length ? (next as unknown as Record<string, unknown>) : null },
      ]).then((err) => { if (err) toast.showError(err); });
    };
    const three = {
      on: threeOn,
      model: effectsModel(motion, threeOn ? [...THREE] : [], threeValues, Math.min(Math.max(local, 0), length), local >= 0 && local <= length, keyFrameS),
      commit: (c: EffectsChange | null) => {
        if (!c) return;
        const decl: Record<string, string | null> = {};
        if (c.fx) for (const p of THREE) decl[`--fx-${p}`] = c.motion[p]?.length || c.fx.values[p] == null ? null : `${c.fx.values[p]}${EFFECTS[p].unit}`;
        writeThree(decl, c.motion);
      },
      toggle: (on: boolean) => {
        const next = { ...motion };
        if (!on) for (const p of THREE) delete next[p];
        writeThree(Object.fromEntries(THREE.map((p) => [`--fx-${p}`, on ? `0${EFFECTS[p].unit}` : null])), next);
      },
    };
    /* its anchor point (SPEC §1): kept in its style, keyed as its effects are; at its box's middle it is not written */
    const ANCHOR = ['ax', 'ay'] as const;
    const anchorValues = Object.fromEntries(ANCHOR.flatMap((p) => {
      const n = Number.parseFloat(declared(css, `--fx-${p}`) ?? '');
      return Number.isFinite(n) ? [[p, n]] : [];
    }));
    const anchor = {
      model: effectsModel(motion, [...ANCHOR], anchorValues, Math.min(Math.max(local, 0), length), local >= 0 && local <= length, keyFrameS),
      commit: (c: EffectsChange | null) => {
        if (!c) return;
        const decl: Record<string, string | null> = {};
        if (c.fx) for (const p of ANCHOR) decl[`--fx-${p}`] = c.motion[p]?.length || !c.fx.values[p] ? null : `${c.fx.values[p]}px`;
        writeThree(decl, c.motion);
      },
    };
    return {
      /* what an animation preset keys from (lib/motion-presets): a clip's keyframes are on top of its box */
      model: model ? { ...model, preset: { motion, rest: { translate: [0, 0], scale: 1, rotate: 0, opacity: staticTransform(placed!).base.opacity }, span: [0, length], stage: film.film?.stage ?? { w: 1920, h: 1080 } } } : null,
      effects,
      mask,
      three,
      anchor,
      commitEffects: (c: EffectsChange | null) => {
        if (!c || !layer.loc) return;
        void editBlocks([
          ...(c.fx ? [{ loc: layer.loc, prop: 'style', value: withEffects(css, c.fx.on, c.fx.values) || null }] : []),
          { loc: layer.loc, prop: 'motion', value: Object.keys(c.motion).length ? (c.motion as unknown as Record<string, unknown>) : null },
        ]).then((err) => { if (err) toast.showError(err); });
      },
      commit: (made) => {
        const c = made as TransformCommit | null;
        if (!c || !placed || !layer.loc) return;
        void editBlocks(transformEdits(layer.loc, placed, c.motion, c.base)).then((err) => { if (err) toast.showError(err); });
      },
      blend: declared(css, 'mix-blend-mode') ?? 'normal',
      setBlend: (mode) => style({ 'mix-blend-mode': mode === 'normal' ? null : mode }),
      /* shown and locked as its track is (each layer Motion makes is on a track of its own) */
      ...(() => {
        const at = parseFilmDocLoc(layer.loc ?? '');
        const track = at ? film.film?.tracks[at.track] : undefined;
        const flag = (prop: 'hidden' | 'locked', on: boolean) => {
          if (!layer.loc) return;
          void editBlocks([{ loc: layer.loc, prop, value: on ? true : null }]).then((err) => { if (err) toast.showError(err); });
        };
        return track ? {
          visible: !track.hidden, setVisible: (on: boolean) => flag('hidden', !on),
          locked: Boolean(track.locked), setLocked: (on: boolean) => flag('locked', on),
        } : {};
      })(),
    };
  }, [film.film, motionOfBlock, timeMs, keyFrameS, editBlocks, edit, projectFps, toast]); // eslint-disable-line react-hooks/exhaustive-deps
  /* the picked clip's position keyframes, drawn on the picture as its path; the same picks as its timeline rows */
  const motionPath = React.useMemo<MotionPathKeys | null>(() => {
    if (!motionBlock?.clipId || playing) return null;
    const motion = motionOfBlock(motionBlock);
    const keys = motion.translate;
    if (!keys?.length) return null;
    return {
      clipId: motionBlock.clipId, keys, fps: projectFps,
      picked: new Set(keys.filter((k) => pickedKeys.has(keyId('translate', k.t))).map((k) => k.t)),
      onPick: (at, mode) => setPickedKeys((was) => {
        const id = keyId('translate', at);
        if (mode === 'set') return new Set([id]);
        const next = new Set(was);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      }),
      onMove: (at, v) => rewriteMotion({ ...motion, translate: keys.map((k) => (k.t === at ? { ...k, v } : k)) }),
    };
  }, [motionBlock, motionOfBlock, pickedKeys, playing, projectFps, rewriteMotion]);
  /* the picked keyframes' menu: an element's in the composition open, else the clip's */
  const runKeys = (what: EaseCommand | 'delete') => { if (!elementKeys.current.run(what)) keyCommand(what); };
  const keyMenuItems: ContextMenuEntry[] = [
    { id: 'easy', label: t('inspector.eases.ease-in-out'), shortcut: 'F9', onSelect: () => runKeys('easy') },
    { id: 'easy-in', label: t('inspector.eases.ease-in'), shortcut: '⇧F9', onSelect: () => runKeys('easy-in') },
    { id: 'easy-out', label: t('inspector.eases.ease-out'), shortcut: '⌘⇧F9', onSelect: () => runKeys('easy-out') },
    { id: 'linear', label: t('inspector.eases.linear'), onSelect: () => runKeys('linear') },
    { id: 'hold', label: t('inspector.eases.hold'), onSelect: () => runKeys('hold') },
    { id: 'sep', separator: true },
    { id: 'delete', label: t('inspector.keyRemove'), shortcut: '⌫', danger: true, onSelect: () => runKeys('delete') },
  ];
  /** An edit the timeline planned (lib/timeline-edit), as it planned it: one write, one undo step. */
  /* a template's clip made longer or shorter on the timeline: its film retimed first (set where its films are read) */
  const retimeRef = React.useRef<(ops: Op[]) => Promise<Op[]>>(async (ops) => ops);
  const editOps = React.useCallback((ops: Op[], label: string) => retimeRef.current(ops).then((next) => edit(next, label)), [edit]);

  /* ── a clip's attributes copied onto others (lib/clip-attrs, ⌘⇧C / ⌘⇧V) ── */
  const [copiedAttrs, setCopiedAttrs] = React.useState<CopiedAttrs | null>(null);
  const [pasteAttrsOpen, setPasteAttrsOpen] = React.useState(false);
  const filmClipOf = React.useCallback((id: string) => filmRef.current?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === id) ?? null, []);
  const copyAttrs = React.useCallback((blocks: readonly TimelineBlock[]) => {
    const clip = blocks.map((b) => (b.clipId ? filmClipOf(b.clipId) : null)).find(Boolean);
    if (!clip) { toast.show(t('clipAttrs.selectFirst')); return; }
    setCopiedAttrs(attrsOf(clip));
    toast.show(t('clipAttrs.copied'));
  }, [filmClipOf, toast, t]);
  const askPasteAttrs = React.useCallback((blocks: readonly TimelineBlock[]) => {
    if (!copiedAttrs) { toast.show(t('clipAttrs.nothing')); return; }
    if (!blocks.some((b) => b.clipId && b.loc)) { toast.show(t('clipAttrs.selectFirst')); return; }
    setPasteAttrsOpen(true);
  }, [copiedAttrs, toast, t]);
  const doPasteAttrs = React.useCallback((groups: ReadonlySet<AttrGroup>) => {
    setPasteAttrsOpen(false);
    if (!copiedAttrs) return;
    const targets = selectedClips.flatMap((b) => {
      const clip = b.clipId && b.loc ? filmClipOf(b.clipId) : null;
      return clip ? [{ loc: b.loc!, clip, lengthS: (b.endMs - b.startMs) / 1000 }] : [];
    });
    const edits = pasteAttrs(copiedAttrs, groups, targets);
    if (edits.length) void editBlocks(edits).then((err) => { if (err) toast.showError(err); });
  }, [copiedAttrs, selectedClips, filmClipOf, editBlocks, toast]);

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
        const moveIn = cutMovesOn(c.style).in;
        facts.set(c.id, {
          picture: filmClipKind(c) !== 'audio', fade: fadeMsOf(c), src: c.src.split('#')[0]!, ...(c.src === WHITE_SRC ? { white: true } : {}),
          ...(moveIn ? { moveIn: { slug: moveIn.slug, ms: Math.round(moveIn.secs * 1000) } } : {}),
        });
      }
    }
    return (id: string) => facts.get(id);
  }, [film.film]);
  /* a move is called by its library transition's name */
  const moveLanguage = useLanguage();
  const filmTransitions = React.useMemo(() => findTransitions(editModelOf(timelineTracks, clipLinks), clipFacts).map((tr) => {
    const item = tr.move ? builtInItem(`${BUILT_IN}/motions/move-${tr.move}`) : null;
    return item ? { ...tr, label: nameOf(item.name, moveLanguage) } : tr;
  }), [timelineTracks, clipLinks, clipFacts, moveLanguage]);
  /* the heads of transitions on one track folded away on the timeline: each shown by its mark on the main track */
  const foldedHeads = React.useMemo(() => headsOf(editModelOf(timelineTracks, clipLinks), filmTransitions), [timelineTracks, clipLinks, filmTransitions]);
  const [pickedTransition, setPickedTransition] = React.useState<string | null>(null);
  const pickTransition = React.useCallback((key: string | null) => {
    setPickedTransition(key);
    if (key) { setSelectedKeys([]); setInspectorContent('selection'); setInspectorOpen(true); }
  }, []);
  const pickedTr = filmTransitions.find((x) => x.key === pickedTransition) ?? null;
  /**
   * A transition put on a cut, made longer or shorter, or taken away (lib/transitions): planned on the timeline as it
   * is (on the main track with the magnet what follows an overlap closes up, linked clips along), one write and one
   * undo step. The menus put on fades only; other transitions are an agent's to write.
   */
  const askTransition = React.useCallback(async (ask: TransitionAsk): Promise<string | null> => {
    const model = editModel();
    /* the magnet acts on the main track: there an overlap closes up what follows, no gap opens after it */
    const cutClip = ask.kind === 'add' ? ask.cut.a : filmTransitions.find((x) => x.key === ask.key)?.a;
    const cutTrack = model.find((tr) => tr.clips.some((c) => c.id === cutClip))?.index;
    const opts = { ripple: magnetOn(model, cutTrack, readTimelinePrefs().magnet), linked: true, whiteSrc: WHITE_SRC };
    let plan: TransitionPlan;
    let label: string;
    if (ask.kind === 'add') {
      /* the default length, on the frame grid */
      const frame = frameMs(1);
      /* a move as long as the library has it */
      const ms = ask.move ? ask.move.in.secs * 1000 : TRANSITION_MS;
      plan = planTransition(model, clipFacts, ask.type, ask.cut, Math.round(ms / frame) * frame, opts);
      label = 'history.stepTransition';
    } else {
      const tr = filmTransitions.find((x) => x.key === ask.key);
      if (!tr) return t('transitions.none');
      plan = ask.kind === 'remove' ? planRemoveTransition(model, clipFacts, tr, opts) : planResizeTransition(model, clipFacts, tr, ask.durationMs, opts);
      label = ask.kind === 'remove' ? 'history.stepTransitionRemove' : 'history.stepTransitionResize';
    }
    if ('error' in plan) return t(plan.error === 'locked' ? 'transitions.locked' : plan.error === 'short' ? 'transitions.short' : 'transitions.none');
    /* the clips' ways in and out, in the same write: a shot cut for a transition on one track, its head keeping its way
       in and its rest its ways out (lib/clip-presets headStyle, restStyle), whole again when it is taken off; a move's
       two halves (withCutMove) put on, made as long as the overlap now, or taken off */
    const styles: { clip: string; prop: string; value: string | null }[] = [];
    const styleOf = (id: string) => filmClipOf(id)?.style ?? '';
    const restyle = (id: string, value: string, was = styleOf(id)) => { if (value !== was) styles.push({ clip: id, prop: 'style', value: value || null }); };
    const secs = (plan.lapMs ?? 0) / 1000;
    const half = (style: string, edge: 'in' | 'out', p: { name: string; ease: string } | undefined) => withCutMove(style, edge, p && secs > 0 ? { name: p.name, secs, ease: p.ease } : null);
    const keyframes: Op[] = [];
    if (ask.kind === 'add') {
      const cutFor = new Set((plan.pieces ?? []).map((p) => p.head));
      for (const p of plan.pieces ?? []) restyle(p.rest, restStyle(styleOf(p.head)), styleOf(p.head));
      const out = plan.replaced?.a ?? ask.cut.a;
      const into = plan.replaced?.b ?? ask.cut.b;
      if (out) restyle(out, half(styleOf(out), 'out', ask.move?.out));
      if (into) restyle(into, half(cutFor.has(into) ? headStyle(styleOf(into)) : styleOf(into), 'in', ask.move?.in));
      for (const id of cutFor) if (id !== into) restyle(id, headStyle(styleOf(id)));
      if (ask.move) keyframes.push({ op: 'keyframes', set: Object.fromEntries(Object.values(ask.move).map((p) => [p.name, p.body])) } as Op);
    } else {
      const tr = filmTransitions.find((x) => x.key === ask.key);
      if (tr && ask.kind === 'remove') {
        restyle(tr.a, withCutMove(styleOf(tr.a), 'out', null));
        restyle(tr.b, tr.rest ? joinedStyle(styleOf(tr.b), styleOf(tr.rest)) : withCutMove(styleOf(tr.b), 'in', null));
      } else if (tr?.kind === 'move') {
        restyle(tr.a, half(styleOf(tr.a), 'out', cutMovesOn(styleOf(tr.a)).out));
        restyle(tr.b, half(styleOf(tr.b), 'in', cutMovesOn(styleOf(tr.b)).in));
      }
    }
    const ops = [...plan.ops, ...keyframes, ...(styles.length ? [{ op: 'props', edits: styles } as Op] : [])];
    return ops.length ? edit(ops, label) : null;
  }, [editModel, clipFacts, filmTransitions, filmClipOf, edit, t]);
  /**
   * The inspector's edits (its refusals it says beside its field). A new speed goes to the clips linked to the clip
   * too. On the main track with the magnet (the timeline's switch) a speed or a length that makes the clip longer or
   * shorter pushes or pulls what follows, as a ripple trim does; elsewhere a speed too slow to fit before the next clip
   * is refused, and the inspector says why. With linkage what rides on the main track stays on its footage.
   */
  /**
   * A line of words' motion played on the picture, so a change to it is seen: its way in from its start, its way out to
   * its end, a couple of rounds of its loop from the playhead. A moment after it was written (the picture has it then).
   */
  const playTextMotion = React.useCallback((clipId: string, slot: 'in' | 'loop' | 'out') => {
    window.setTimeout(() => {
      const b = blocksRef.current.find((x) => x.clipId === clipId);
      const at = b?.loc ? parseFilmDocLoc(b.loc) : null;
      if (!b || !at) return;
      const vars = textVars(filmRef.current?.tracks[at.track]?.clips[at.clip]?.overrides as unknown[] | undefined);
      const ms = (key: string) => (Number.parseFloat(vars[key] ?? '') || 0.5) * 1000;
      if (slot === 'in') playRange({ startMs: b.startMs, endMs: Math.min(b.endMs, b.startMs + ms('--in-time') + 400) });
      else if (slot === 'out') playRange({ startMs: Math.max(b.startMs, b.endMs - ms('--out-time') - 400), endMs: b.endMs });
      else {
        const from = Math.min(Math.max(b.startMs, timeRef.current), b.endMs - 100);
        playRange({ startMs: from, endMs: Math.min(b.endMs, from + 2 * ms('--loop-time')) });
      }
    }, 150);
  }, [playRange]);
  /** A clip's animation played on the picture once put on, as a line of words' is: its way in, its way out, its loop. */
  const playClipMotion = React.useCallback((clipId: string, slot: PresetSlot, secs: number) => {
    window.setTimeout(() => {
      const b = blocksRef.current.find((x) => x.clipId === clipId);
      if (!b) return;
      const ms = secs * 1000;
      if (slot === 'in') playRange({ startMs: b.startMs, endMs: Math.min(b.endMs, b.startMs + ms + 400) });
      else if (slot === 'out') playRange({ startMs: Math.max(b.startMs, b.endMs - ms - 400), endMs: b.endMs });
      else {
        const from = Math.min(Math.max(b.startMs, timeRef.current), b.endMs - 100);
        playRange({ startMs: from, endMs: Math.min(b.endMs, from + Math.max(2 * ms, 1500)) });
      }
    }, 150);
  }, [playRange]);
  const editClips = React.useCallback(async (edits: ClipEdit[]): Promise<string | null> => {
    const [one] = edits;
    const block = one && edits.length === 1 ? blocksRef.current.find((b) => b.loc === one.loc) : undefined;
    if (block?.loc && lockedEdits(edits, filmRef.current).length) return t('timeline.trackLocked');
    /* a line of words given new words or a new look: its box stays its words (FilmStageControl fitText), in one edit */
    if (block?.loc && one!.prop === 'overrides' && isTextClip(block.src ?? '')) {
      const fitted = await stageControl.current?.fitText(block.loc, (one!.value ?? []) as unknown as unknown[]);
      if (fitted) {
        const failed = await editBlocks(fitted as unknown as ClipEdit[], true);
        if (failed) void stageControl.current?.fitText(block.loc, null);
        return failed;
      }
    }
    const model = editModel();
    const prefs = readTimelinePrefs();
    const switches = switchesOf(prefs);
    /* the magnet acts on the main track alone */
    const magnet = magnetOn(model, model.find((tr) => tr.clips.some((c) => c.id === block?.clipId))?.index, prefs.magnet);
    if (!block?.clipId || (one!.prop !== 'speed' && one!.prop !== 'at' && !(one!.prop === 'end' && magnet))) return editBlocks(edits, true);
    const ids = [block.clipId, ...linkedIds(model, [block.clipId]).filter((id) => id !== block.clipId)];
    if (one!.prop === 'at') {
      /* a start typed in: the clip (and those linked to it) moves as a drag would: on the main track with the magnet
         it goes in at the insert point there; elsewhere it lands there, or on a new track beside its own when that
         time is taken. Nothing there is cut */
      const startMs = Number(one!.value) * 1000 + (block.anchor?.parentStartMs ?? 0);
      if (!Number.isFinite(startMs)) return Promise.resolve(t('timeline.editFail'));
      const plan = planMove(model, { ids, deltaMs: startMs - block.startMs, pointerMs: startMs, mode: 'place', ...switches });
      if (!plan) return Promise.resolve(t('timeline.trackLocked'));
      return plan.ops.length ? edit(plan.ops, clipStep('history.stepMoved', [block.clipId]), true) : Promise.resolve(null);
    }
    if (one!.prop === 'speed') {
      const speed = typeof one!.value === 'number' ? one!.value : 1;
      const plan = planSpeed(model, ids, speed, { ripple: magnet, ...switches });
      if (plan.slowest != null) return Promise.resolve(t('inspector.speedTooSlow').replace('{n}', String(plan.slowest)));
      return plan.ops.length ? edit(plan.ops, `history.stepSpeed|${block.clipId}`, true) : Promise.resolve(null);
    }
    /* a new length, with the magnet: a ripple trim of the tail by the difference (source seconds over the speed) */
    const k = block.anchor?.trimFrom != null && block.speed ? block.speed : 1;
    const deltaMs = ((Number(one!.value) - Number(one!.from ?? one!.value)) * 1000) / k;
    const plan = planRippleTrim(model, ids, 'end', deltaMs, switches);
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
    /* a caption's cue is cut as a still is (its halves' lengths); its words are parted by its file (lib/caption-blocks) */
    const sec = (ms: number) => Math.round(ms) / 1000;
    const cueOps: Op[] = blocks.filter((b) => b.cue && atMs > b.startMs && atMs < b.endMs).map((b) => ({
      op: 'split', clip: b.clipId!, left: { end: sec(atMs - b.startMs) }, right: { at: sec(atMs), end: sec(b.endMs - atMs) },
    }));
    const halves = blocks.flatMap((block) => {
      if (!block.clipId || block.cue || !block.anchor?.move) return [];
      /* the halves' trims are the source's seconds, and the rest starts exactly where the first half ends */
      const clip = clips.find((c) => c.id === block.clipId);
      const split = splitHalves(block, atMs, Array.isArray(clip?.time) && clip.time.length === 2 ? clip.time[1] : undefined);
      return split ? [{ block, split, link: clip?.attrs?.['data-link'] }] : [];
    });
    if (!halves.length && !cueOps.length) return Promise.resolve(t('timeline.splitFail'));
    const rightLinks = new Map<string, string>();
    const taken = new Set<string>();
    for (const { link } of halves) {
      if (!link || rightLinks.has(link) || halves.filter((h) => h.link === link).length < 2) continue;
      const made = freshLink(model, `${link}-b`, taken);
      taken.add(made);
      rightLinks.set(link, made);
    }
    /* a selected clip's selection goes to its right half: named here so it can be selected once written */
    const selected = new Set(selectedKeysRef.current);
    const used = new Set(clips.map((c) => c.id));
    const rightIds = new Map<string, string>();
    for (const { block } of halves) {
      if (!selected.has(block.clipId!)) continue;
      let id = `${block.clipId}-b`;
      for (let n = 2; used.has(id); n++) id = `${block.clipId}-b-${n}`;
      used.add(id);
      rightIds.set(block.clipId!, id);
    }
    const ops: Op[] = halves.map(({ block, split, link }) => ({
      op: 'split',
      clip: block.clipId!,
      left: split.left,
      /* a half left alone with a link (its linked clip not under the cut) keeps none: it would pull the other along */
      right: { ...split.right, link: link ? rightLinks.get(link) ?? null : null },
      ...(rightIds.has(block.clipId!) ? { rightId: rightIds.get(block.clipId!)! } : {}),
    }));
    return edit([...ops, ...cueOps], halves.length ? clipStep('history.stepSplit', halves.slice(0, 2).map((h) => h.block.clipId!)) : 'captionTrack.stepSplit').then((err) => {
      if (!err && rightIds.size) setSelectedKeys((keys) => keys.map((k) => rightIds.get(k) ?? k));
      return err;
    });
  }, [edit, editModel, t]);
  /**
   * Videos' sounds taken apart from their pictures, as an editor unlinks them (lib/timeline-edit planDetachAudio): each
   * the same file's sound alone, at the same seconds and speed, on a sound track that has room for it (a new one under
   * the sound tracks only when none has), linked to its video (`data-link`) so they still move, trim, split and delete
   * together; the videos silent from then on. One edit, one step to undo.
   */
  const detachAudio = React.useCallback((blocks: readonly TimelineBlock[]): Promise<string | null> => {
    const clips = new Map((filmRef.current?.tracks ?? []).flatMap((tr) => tr.clips.map((c) => [c.id, c] as const)));
    const videos = blocks.flatMap((b) => {
      const clip = b.clipId ? clips.get(b.clipId) : undefined;
      return clip ? [clip] : [];
    });
    const ops = videos.length ? planDetachAudio(editModel(), videos) : [];
    if (!ops.length) return Promise.resolve(t('timeline.detachFail'));
    return edit(ops, clipStep('history.stepDetachAudio', videos.slice(0, 2).map((c) => c.id)));
  }, [edit, editModel, t]);
  /**
   * Clips made one compound clip (studio/server/compound.mjs): their own film written under parts/, then one edit puts
   * it where they were (undone and redone as any); and one taken apart, its clips back where it plays them.
   */
  const makeCompound = React.useCallback(async (blocks: readonly TimelineBlock[]): Promise<string | null> => {
    const current = filmRef.current;
    const ids = blocks.flatMap((b) => (b.clipId ? [b.clipId] : []));
    if (!current || !ids.length) return null;
    const ends = Object.fromEntries(blocksRef.current.flatMap((b) => (b.clipId ? [[b.clipId, b.endMs / 1000]] : [])));
    const draft = compoundOf(current as unknown as FilmValue, ids, ends, `${PARTS}/compound`);
    if (!draft) return null;
    try {
      const { folder } = await api.writePartFilm(projectId, 'compound', draft.film as unknown as Film);
      const made = compoundOf(filmRef.current as unknown as FilmValue, ids, ends, folder);
      if (!made) return null;
      const err = await edit(made.ops as Op[], clipStep('history.stepCompound', ids));
      if (!err) setSelectedKeys([folder.split('/').pop()!]);
      return err;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [edit, projectId]);
  const breakCompound = React.useCallback(async (block: TimelineBlock): Promise<string | null> => {
    const folder = compoundFolder(block.src);
    if (!folder || !block.clipId) return null;
    try {
      const { film: inner } = await api.readPartFilm(projectId, folder);
      const ops = dissolvedOf(filmRef.current as unknown as FilmValue, block.clipId, inner as unknown as FilmValue, folder);
      return ops ? await edit(ops as Op[], clipStep('history.stepUncompound', [block.clipId])) : null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [edit, projectId]);
  /* a compound clip double-clicked: its film opened as a project of its own, which leads back here */
  const enterCompound = React.useCallback((block: TimelineBlock) => {
    const folder = compoundFolder(block.src);
    if (!folder) return;
    void api.openPartFilm(projectId, folder).then(({ project }) => onProject(project.id), (e) => toast.showError(e instanceof Error ? e.message : String(e)));
  }, [projectId, onProject, toast]);
  const [clipboard, setClipboard] = React.useState<readonly TimelineClipboardItem[]>([]);
  /* layers copied (lib/layer-clipboard): kept in the browser, so another window or project pastes them too; the
     timeline's clipboard and this one are emptied by a copy to the other, so a paste pastes what was copied last */
  const [layerBoard, setLayerBoard] = React.useState<LayerClipboard | null>(readLayerClipboard);
  const layerBoardRef = React.useRef(layerBoard);
  layerBoardRef.current = layerBoard;
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (isLayerClipboardKey(e.key)) setLayerBoard(readLayerClipboard()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const keepLayerBoard = React.useCallback((board: LayerClipboard | null) => {
    writeLayerClipboard(board);
    setLayerBoard(board);
  }, []);
  /* the clips copied as film.html had them then: a clip cut (⌘X) is gone from the film, and is pasted from these */
  const copiedClips = React.useRef(new Map<string, Clip>());
  /* and the captions copied, as their files had them (a cue cut is pasted from these) */
  const copiedCues = React.useRef(new Map<string, KeptCue>());
  const copyBlocks = React.useCallback((blocks: readonly TimelineBlock[]) => {
    const clips = new Map((filmRef.current?.tracks ?? []).flatMap((tr) => tr.clips.map((c) => [c.id, c] as const)));
    copiedClips.current = new Map(blocks.flatMap((b) => {
      const clip = b.clipId ? clips.get(b.clipId) : undefined;
      return clip ? [[clip.id, structuredClone(clip)] as const] : [];
    }));
    copiedCues.current = new Map(blocks.flatMap((b) => {
      const vtt = b.cue ? captionTrackNow(projectId, b.cue.src) : null;
      const cue = vtt?.cues.find((c) => c.id === b.cue!.id);
      return vtt && cue ? [[b.clipId!, { cue: structuredClone(cue), rule: cueRule(vtt, `::cue(#${cue.id})`) }] as const] : [];
    }));
    setClipboard(clipboardItemsOf(blocks, timelineTracks));
    keepLayerBoard(null);
  }, [timelineTracks, keepLayerBoard, projectId]);
  /**
   * Layers copied (⌘C, the menus): per page clip, each as writing it into a page needs it (studio/server/stage.js
   * `layerSource`). Null, or why not.
   */
  const copyLayers = React.useCallback(async (elements: readonly StageElement[]): Promise<string | null> => {
    const doc = filmRef.current as unknown as FilmDoc | null;
    if (!doc) return t('layers.copyFail');
    const byClip = new Map<string, { clip: FilmDoc['tracks'][number]['clips'][number]; targets: OverrideTarget[] }>();
    for (const element of elements) {
      const found = pageClipOf(doc, element);
      const target = layerTarget(element);
      if (!found || !target) continue;
      const entry = byClip.get(found.clip.id) ?? { clip: found.clip, targets: [] };
      entry.targets.push(target);
      byClip.set(found.clip.id, entry);
    }
    const clips: CopiedLayers[] = [];
    for (const { clip, targets } of byClip.values()) {
      const layers = await preview.current?.stage?.<(PasteLayer | null)[]>('layerSource', { clip: clip.id, of: targets });
      if (!layers?.length || layers.some((l) => !l)) return t('layers.copyFail');
      clips.push({ from: clip.id, src: clip.src, layers: layers as PasteLayer[] });
    }
    if (!clips.length) return t('layers.copyFail');
    keepLayerBoard({ project: projectId, atMs: Math.round(timeRef.current), clips });
    setClipboard([]);
    return null;
  }, [keepLayerBoard, projectId, t]);
  /* one paste at a time: the next one reads the page the last one wrote, as the picture draws it */
  const pasting = React.useRef<Promise<unknown>>(Promise.resolve());
  /**
   * The copied layers pasted (lib/layer-clipboard pasteGoals): each written into a page (lib/layer-paste), into its
   * own page as itself, into another page as it looks, the files it loads brought in first from another project.
   * Every page written and film.html's changes are one step: one undo takes them all back. The pasted layers are
   * selected together, to be moved as one. Null, or why not.
   */
  const pasteLayers = React.useCallback((intoLoc: string | null): Promise<string | null> => {
    const run = pasting.current.then(() => pasteNowRef.current(intoLoc));
    pasting.current = run.catch(() => {});
    return run;
  }, []);
  const pasteNowRef = React.useRef<(intoLoc: string | null) => Promise<string | null>>(async () => null);
  pasteNowRef.current = async (intoLoc: string | null): Promise<string | null> => {
    const board = layerBoardRef.current;
    const doc = filmRef.current as unknown as FilmDoc | null;
    if (!board || !doc) return t('timeline.menuPasteEmpty');
    const pageClips = doc.tracks.flatMap((track) => track.clips.filter((c) => filmSrcIsPage(c.src)).map((c) => ({ id: c.id, src: c.src, locked: Boolean(track.locked), hidden: Boolean(track.hidden) })));
    const heldLoc = intoLoc ?? stageElementRef.current?.clipLoc ?? null;
    const heldAt = heldLoc ? parseFilmDocLoc(heldLoc) : null;
    const heldId = heldAt ? doc.tracks[heldAt.track]?.clips[heldAt.clip]?.id : undefined;
    const now = timeRef.current;
    const under = pageClips.filter((c) => {
      const b = blocksRef.current.find((x) => x.clipId === c.id);
      return !c.hidden && b && now >= b.startMs && now < b.endMs;
    });
    const goals = pasteGoals(board, projectId, pageClips.find((c) => c.id === heldId) ?? null, under, pageClips);
    if (!goals.length) return t(whyNowhere(board, projectId, pageClips) === 'locked' ? 'timeline.trackLocked' : 'layers.pasteNoPage');
    const { spot, n } = pasteOffset(board, goals);
    /* from another project: the files it loads brought in first (none: nothing to bring) */
    let moved = (path: string) => path;
    const loads = board.clips.some((c) => c.layers.some((l) => l.snapshot && [l.snapshot.html, ...l.snapshot.fonts].some((x) => x.includes(l.snapshot!.base))));
    if (board.project !== projectId && loads) {
      try {
        /* each page's files (copied from several clips: each one's), all under the same place here */
        let prefix = '';
        for (const src of new Set(board.clips.map((c) => c.src))) {
          const brought = (await api.bringClip(projectId, board.project, { src })).src;
          prefix = brought.slice(0, brought.length - src.length);
        }
        moved = (path) => `${prefix}${path}`;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    }
    const ops: Op[] = [];
    const steps: OutsideStep[] = [];
    const sources = new Map<string, string>();
    const made: string[] = [];
    /* each copy, by its clip, to be selected once drawn */
    const copies: { clip: string; at: string }[] = [];
    const undoAll = async () => { for (const st of [...steps].reverse()) await st.undo().catch(() => null); };
    for (const goal of goals) {
      const into = doc.tracks.flatMap((track) => track.clips).find((c) => c.id === goal.clip)!;
      let page: { text: string; rev: string };
      try { page = await api.readPage(projectId, into.src); } catch (e) { await undoAll(); return e instanceof Error ? e.message : String(e); }
      let out: PastedPage | null = null;
      if (goal.kind === 'own') {
        const targets = pasteTargets(page.text, goal.layers);
        const after = targets ? await preview.current?.stage?.<{
          places: { after: number; siblings: string[] }[];
          moved: (string | null)[];
          looks: NonNullable<PasteItem['look']>[];
        }>('afterCopy', { clip: into.id, of: goal.layers.map((l) => ({ at: l.at })) }) : null;
        /* pasted at this spot before: over the last copy */
        const lastAts = board.pasted?.spot === spot ? board.pasted.ats ?? [] : [];
        out = targets && after ? pastedPage(page.text, goal.layers.map((layer, i) => {
          const lastId = lastAts[i] ? idsIn(lastAts[i]!)[0]?.id : undefined;
          const last = lastId ? targetById(page.text, lastId) : null;
          return { layer, target: targets[i]!, place: after.places[i], look: after.looks[i], ...(last ? { over: last } : {}) };
        }), PASTE_OFFSET * n) : null;
        /* the clip's changes that would find others once the copies are there point at what they found */
        if (out && after && into.overrides) {
          const overrides = structuredClone(into.overrides);
          after.moved.forEach((at, i) => { const o = overrides[i]; if (at && o?.at) { o.at = at; delete o.n; } });
          if (JSON.stringify(overrides) !== JSON.stringify(into.overrides)) ops.push({ op: 'set', clip: into.id, field: 'overrides', value: overrides });
        }
      }
      /* another page, or a layer its page's code makes as it plays (it is not in the file): as it looks */
      out ??= pastedElsewhere(page.text, into.src, goal.layers, PASTE_OFFSET * n, board.project === projectId ? undefined : moved);
      if (!out) { await undoAll(); return t('layers.copyFail'); }
      const written = await writeIntoPage(into, page, out, ops);
      if (typeof written === 'string') { await undoAll(); return written; }
      steps.push(written.step);
      if (written.src !== into.src) sources.set(into.src, written.src);
      for (const at of out.ats) if (at) copies.push({ clip: into.id, at });
      made.push(...out.ats);
    }
    const outside: OutsideStep = {
      undo: async () => { for (const st of [...steps].reverse()) { const why = await st.undo(); if (why) return why; } return null; },
      redo: async () => { for (const st of steps) { const why = await st.redo(); if (why) return why; } return null; },
    };
    if (ops.length) {
      const failed = await edit(ops, 'history.stepPaste', false, outside);
      if (failed) { await undoAll(); return failed; }
    } else film.record('history.stepPaste', outside);
    /* a clip given a page of its own: the layers copied from it are of that page now */
    const clips = board.clips.map((c) => (sources.has(c.src) ? { ...c, src: sources.get(c.src)! } : c));
    keepLayerBoard({ ...board, clips, pasted: { spot, n, ats: made } });
    if (copies.length) await selectPasted(copies, 20_000);
    return null;
  };
  /**
   * The page of clip `into` written as a paste made it (`out`, from the page read as `page`). A page other clips show
   * too is not written: this clip gets a page of its own first (`<name> 2.html` beside it, its src in `ops`), the others
   * keep theirs as it is. Its undo puts the page back, or, the page changed since (the agent wrote it), takes out what
   * the paste wrote in. The step, and the page's place; or why it was not written.
   */
  const writeIntoPage = async (into: FilmDoc['tracks'][number]['clips'][number], page: { text: string; rev: string }, out: PastedPage, ops: Op[]): Promise<{ step: OutsideStep; src: string } | string> => {
    const doc = filmRef.current as unknown as FilmDoc | null;
    const shared = Boolean(doc?.tracks.some((track) => track.clips.some((x) => x.id !== into.id && x.src === into.src)));
    const text = out.text;
    try {
      if (shared) {
        const dot = into.src.lastIndexOf('.');
        const [stem, ext] = dot > into.src.lastIndexOf('/') ? [into.src.slice(0, dot), into.src.slice(dot)] : [into.src, '.html'];
        let path = '';
        let rev: string | null = null;
        for (let k = 2; rev == null; k++) {
          path = `${stem} ${k}${ext}`;
          rev = await api.writePage(projectId, path, text, null).catch((e: unknown) => {
            if (e instanceof ApiError && e.status === 409 && k < 50) return null;
            throw e;
          });
        }
        const made = rev;
        ops.unshift({ op: 'set', clip: into.id, field: 'src', value: path });
        return {
          src: path,
          step: {
            /* written since (the agent): kept, the clip goes back to the page it showed */
            undo: () => api.writePage(projectId, path, null, made, true).then(() => null, () => null),
            redo: () => api.writePage(projectId, path, text, null).then(() => null),
          },
        };
      }
      const path = into.src;
      const made = await api.writePage(projectId, path, text, page.rev);
      /* an undo of a page written since takes out what the paste wrote, and says where it was, for the redo */
      let undone: { rev: string | null; at: number[]; text: string } | null = null;
      return {
        src: path,
        step: {
          undo: async () => {
            try {
              await api.writePage(projectId, path, page.text, made, true);
              undone = null;
              return null;
            } catch (e) {
              if (!(e instanceof ApiError && e.status === 409)) throw e;
              const now = await api.readPage(projectId, path);
              const back = withoutPaste(now.text, out.inserted);
              if (back == null) return t('layers.pasteChanged');
              undone = { rev: await api.writePage(projectId, path, back.text, now.rev, true), at: back.at, text: back.text };
              return null;
            }
          },
          redo: async () => {
            if (!undone) await api.writePage(projectId, path, text, page.rev);
            else await api.writePage(projectId, path, withPaste(undone.text, out.inserted, undone.at), undone.rev);
            return null;
          },
        },
      };
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };
  /* what was pasted is selected, all of it together, once the picture draws it (a new page loads first, slowly on a
     slow computer); the copies the picture has not drawn within `wait` ms are left out */
  const selectPasted = async (copies: readonly { clip: string; at: string }[], wait = 3000) => {
    let there: { loc: string; clipLoc: string }[] = [];
    for (const end = Date.now() + wait; ;) {
      const doc = filmRef.current as unknown as FilmDoc | null;
      const found = await Promise.all(copies.map(async ({ clip, at }) => {
        const clipLoc = doc?.tracks.flatMap((tr, ti) => tr.clips.map((c, ci) => (c.id === clip ? filmDocLoc(ti, ci) : null))).find(Boolean);
        return clipLoc && await preview.current?.stage?.<object>('layer', { clip, loc: at, any: true }) ? { loc: at, clipLoc } : null;
      }));
      there = found.filter((x): x is { loc: string; clipLoc: string } => x != null);
      if (there.length === copies.length || Date.now() >= end) break;
      await new Promise((done) => window.setTimeout(done, 150));
    }
    if (there.length) selectStageLayers(there);
  };
  /**
   * A paste (⌘V, the menu) at a time: onto the track given (`lane`; `pointed`: under the pointer, so copies from
   * several tracks move there together) or each copy's own, never cutting what is
   * there: a taken spot opens a track beside it; with the magnet a copy for the main track goes in there, at the cut
   * nearest the playhead (lib/timeline-clipboard pasteEdit). A clip cut since it was copied comes back as it was copied (under a
   * new id).
   */
  const pasteAt = React.useCallback((lane: string | null, atMs: number, pointed = false): Promise<string | null> => {
    /* layers copied last: pasted as layers, over a clip of that row when one is selected there */
    if (layerBoardRef.current) {
      const row = lane ? timelineTracks.find((tr) => tr.lane === lane) : null;
      const picked = row?.blocks.find((b) => selectedClips.some((x) => x.id === b.id) && b.loc);
      return pasteLayers(picked?.loc ?? row?.blocks.find((b) => b.loc)?.loc ?? null);
    }
    if (!clipboard.length) return Promise.resolve(t('timeline.menuPasteEmpty'));
    const { items, missing } = clipboardNow(clipboard, timelineTracks);
    const cut = clipboard.filter((item) => !items.some((i) => i.clipId === item.clipId) && (copiedClips.current.has(item.clipId) || copiedCues.current.has(item.clipId)));
    if (missing > cut.length) toast.show(t('timeline.pasteGone'));
    const all = [...items, ...cut].sort((a, b) => a.startMs - b.startMs);
    if (!all.length) return Promise.resolve(null);
    const ops = pasteEdit(all, timelineTracks, editModel(), atMs, lane, { mode: 'place', pointed, ...switchesOf(readTimelinePrefs()) });
    if (!ops) return Promise.resolve(t('timeline.trackLocked'));
    const gone = new Set(cut.map((item) => item.clipId));
    const written = ops.map((op): Op => {
      if (op.op !== 'insert' || !op.from || !gone.has(op.from)) return op;
      /* a new id: the place it had may be another clip's by now, and a stale reading of the timeline would edit it */
      const { from, ...rest } = op;
      const kept = copiedCues.current.get(from);
      if (kept) return { ...rest, clip: cueStandIn(from, (kept.cue.end - kept.cue.start) * 1000) as never };
      const { id: _id, ...clip } = structuredClone(copiedClips.current.get(from)!);
      return { ...rest, clip };
    });
    return edit(written, 'history.stepPaste');
  }, [clipboard, timelineTracks, selectedClips, pasteLayers, editModel, edit, t, toast]);
  /** Room for clips dropped onto a track (an insert pushes on, an overwrite cuts out): after the inserts, in one edit. */
  const roomFor = React.useCallback((spans: { track: number | { insert: number } | undefined; atSec: number; durMs: number }[], mode?: EditMode): Op[] => {
    const onTracks = spans.flatMap((s) => (typeof s.track === 'number' ? [{ track: s.track, startMs: Math.round(s.atSec * 1000), endMs: Math.round(s.atSec * 1000) + s.durMs }] : []));
    if (!mode || !onTracks.length) return [];
    return planRoom(editModel(), onTracks, { mode, ...switchesOf(readTimelinePrefs()) }).ops;
  }, [editModel]);
  /* a group of Saved or the library, laid out for this picture (lib/library placedGroup); a template of the library has
     its music (one of the library's) taken in too, on a track of its own under it, fading out at its end */
  const templateClips = React.useCallback(async (saved: string | undefined, clips: SavedGroupClip[], marked = true): Promise<SavedGroupClip[]> => {
    const item = builtInItem(saved);
    /* a template of the library: each of its clips marked as this time's of it (lib/template-instance), so it is one
       template in the inspector (TemplateSection) */
    const laid = placedGroup(clips, stageRef.current ?? { w: 1920, h: 1080 });
    const mark = marked && item?.cat === 'template' ? templateMark(item.id, templateMarks(filmRef.current?.tracks ?? [])) : null;
    const placed = mark ? markedClips(laid, mark) : laid;
    const music = item?.music ? builtInItem(`${BUILT_IN}/${item.music}`) : null;
    if (!item?.music || !music) return placed;
    let taken: Awaited<ReturnType<typeof api.takeSaved>>;
    try { taken = await api.takeSaved(projectId, `${BUILT_IN}/${item.music}`); } catch { return placed; }
    if (!('path' in taken)) return placed;
    const len = Math.min(item.durationMs ?? 0, music.durationMs ?? Infinity) / 1000;
    /* under every track of the film, where its sound tracks are (a new track past the last goes last, ops.mjs) */
    const below = 1000;
    const tune = { track: below, at: 0, clip: { src: taken.path, time: [0, len], overrides: [{ fade: [0, Math.min(1.5, len / 3)] }] } };
    return [...placed, ...(mark ? markedClips([tune], mark) : [tune])];
  }, [projectId]);
  const language = useLanguage();
  /** The clip put in since `before` (the clips there were), picked on the timeline once it is drawn there. */
  const pickNewClip = React.useCallback((before: ReadonlySet<string>) => {
    let left = 30;
    const find = () => {
      const block = blocksRef.current.find((b) => b.clipId && !before.has(b.clipId));
      if (block) { setStageElement(null); setSelectedKeys([block.clipId ?? block.id]); return; }
      if (--left > 0) requestAnimationFrame(find);
    };
    requestAnimationFrame(find);
  }, []);
  /* the person's own chosen for a template's places at once (TemplatePicker): its places' lengths, and what it does with them */
  const [templateAsk, setTemplateAsk] = React.useState<{ name: string; slots: number[]; use: (paths: string[]) => void } | null>(null);
  /*
   * A template of the library: one compound clip, from where it was asked (the playhead, or where it was dropped), its
   * film of its own (parts/templates-<id>) the template's clips laid out for this picture, its example pictures in its
   * places and its music under them: it plays as the template's example until the person's own go in its places
   * (TemplateSection, or a file dropped on it on the timeline), its words and looks changed there too.
   */
  /** A template of the library as a film of its own, laid out for this picture, its files taken into the project. */
  const buildTemplateFilm = React.useCallback(async (item: LibraryItem): Promise<{ film: FilmValue; name: string; length: number } | null> => {
    let taken: Awaited<ReturnType<typeof api.takeSaved>>;
    try { taken = await api.takeSaved(projectId, `${BUILT_IN}/${item.id}`); } catch (e) { toast.show(e instanceof Error ? e.message : String(e)); return null; }
    if (!('clips' in taken)) return null;
    const name = item.id.replace(/\//g, '-');
    /* its clips named from a folder under parts/ (any: they are all as deep) */
    const clips = (await templateClips(`${BUILT_IN}/${item.id}`, taken.clips, false))
      .map((c) => ({ ...c, clip: { ...c.clip, src: srcInto(String(c.clip.src), `${PARTS}/${name}`) } }));
    const film = applyOps({ stage: { ...(stageRef.current ?? { w: 1920, h: 1080 }) }, tracks: [] } as unknown as FilmValue, groupInsertOps(clips, 0, 0, [], taken.keyframes) as never) as FilmValue;
    return { film, name, length: filmLength(film.tracks as never) };
  }, [projectId, templateClips, toast]);
  const insertTemplate = React.useCallback(async (item: LibraryItem, at: number, track: Parameters<typeof groupInsertAt>[0]) => {
    const made = await buildTemplateFilm(item);
    if (!made) return;
    const { film: inner, name, length: len } = made;
    let folder: string;
    try { ({ folder } = await api.writePartFilm(projectId, name, inner as unknown as Film)); } catch (e) { toast.showError(e instanceof Error ? e.message : String(e)); return; }
    keepTemplateFilm(folder, inner);
    const before = new Set(blocksRef.current.flatMap((b) => (b.clipId ? [b.clipId] : [])));
    const failed = await edit([{ op: 'insert', clip: { src: `${folder}/film.html`, time: [0, len] } as never, at, track: track ?? { insert: 0 } }] as never, 'history.stepDrop');
    if (failed) { toast.show(failed); return; }
    toast.show(t('assetDrawer.added').replace('{name}', nameOf(item.name, language)));
    pickNewClip(before);
  }, [projectId, buildTemplateFilm, edit, toast, t, language, pickNewClip]);
  const dropAsset = React.useCallback(async (file: ResourceDragItem, target: AssetDropTarget, atMs: number): Promise<string | null> => {
    const plan = assetDropInsert(file, timelineTracks, target, atMs, stageRef.current);
    if ('error' in plan) return plan.error === 'locked' ? t('timeline.trackLocked') : t('timeline.dropNotClip');
    /* a thing of Saved (lib/saved): brought into the project first (a file imported, a bundle's files copied in), then
       put where it was dropped: a file as a file of the project goes, a clip as it was saved */
    if (file.saved) {
      /* a template: the person's own for its places first */
      const asked = builtInItem(file.saved);
      if (asked?.kind === 'group') { void insertTemplate(asked, plan.at, plan.track); return null; }
      /* a text style: a new line of words in it, in its box (a title's taller) */
      const style = builtInItem(file.saved);
      const textStyle = style?.kind === 'textstyle' ? style : null;
      const from = textStyle ? `${BUILT_IN}/${TEXT_COMPONENT}` : file.saved;
      let taken: Awaited<ReturnType<typeof api.takeSaved>>;
      try { taken = await api.takeSaved(projectId, from); } catch (e) { return e instanceof Error ? e.message : String(e); }
      /* a group: its tracks new ones, where it was dropped */
      if ('clips' in taken) return edit(groupInsertOps(await templateClips(file.saved, taken.clips), plan.at, groupInsertAt(plan.track), editModel(), taken.keyframes), 'history.stepDrop');
      if ('path' in taken) {
        const { saved: _from, ...rest } = file;
        return dropAssetRef.current({ ...rest, path: taken.path }, target, atMs);
      }
      /* a sticker of the library: in the middle of the picture at a size it reads, not over all of it; a line of words
         in a box that hugs them (lib/text-box) */
      const own = builtInItem(from);
      const shape = textStyle?.w ? textStyle : own;
      const stageNow = stageRef.current ?? { w: 1920, h: 1080 };
      const shaped = libraryBox(shape, stageNow);
      /* a line of words says the default words, in a box that hugs them */
      const words = own?.id === TEXT_COMPONENT ? defaultTextWords() : undefined;
      const vars = textStyle?.vars ?? file.vars;
      const box = shaped && own && words != null ? await hugText(pageUrl(own), shaped, stageNow.w, vars, words) : shaped;
      const overrides = words != null ? withWords(vars ? withRootVars((taken.clip as { overrides?: unknown[] }).overrides, vars) : (taken.clip as { overrides?: unknown[] }).overrides, words) : undefined;
      const clip = { ...taken.clip, ...(box ? { box, size: { w: box.w, h: box.h } } : {}), ...(overrides ? { overrides } : {}) };
      const durMs = file.durationMs ?? assetRunMs([file]);
      /* the thing tried on the picture is the thing now put in: the try goes; what was put in is picked, as "+" does */
      dismissLibraryPreview.current();
      const before = new Set(blocksRef.current.flatMap((b) => (b.clipId ? [b.clipId] : [])));
      const picked = (failed: string | null) => { if (!failed) pickNewClip(before); return failed; };
      /* a transition of OpenFilm's library (lib/library): its middle on the cut it was put near, never pushing or
         cutting what is under it */
      if (builtInItem(file.saved)?.place === 'cut') {
        const at = onCut(plan.at, durMs, cutsOf(timelineTracks));
        return edit([{ op: 'insert', clip: clip as never, at, track: cutTrack(timelineTracks, plan.track, at, durMs) }], 'history.stepDrop');
      }
      return picked(await edit([
        { op: 'insert', clip: clip as never, at: plan.at, ...(plan.track != null ? { track: plan.track } : {}) },
        ...roomFor([{ track: plan.track, atSec: plan.at, durMs }], target.edit),
      ], 'history.stepDrop'));
    }
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
  }, [timelineTracks, edit, roomFor, t, projectId, editModel, language, pickNewClip, insertTemplate]);
  const dropAssetRef = React.useRef(dropAsset);
  dropAssetRef.current = dropAsset;
  /**
   * A media file put on the timeline without a drag (lib/media-place): the media pane's "+" and Enter and the library's
   * (at the playhead, which stays where it is), the source viewer's `,` and `.` (insert or overwrite the part marked, at
   * the playhead; the playhead then goes to its end: `follow`); a cut of the canvas, at the end of the film.
   */
  const addMedia = React.useCallback(async (file: WorkspaceResource, how: { mode?: EditMode; range?: SourceRange | null; atPlayhead?: boolean; follow?: boolean } = {}) => {
    const target = timelineCommands.current?.target() ?? null;
    const at = how.atPlayhead || target != null ? snapToFrame(timeRef.current) : 'end';
    const plan = placeMedia(editModel(), { file, range: how.range ?? null, target, at, ...(how.mode ? { mode: how.mode } : {}), ...switchesOf(readTimelinePrefs()), stage: stageRef.current });
    if ('error' in plan) { toast.show(plan.error === 'locked' ? t('timeline.trackLocked') : t('timeline.dropNotClip')); return false; }
    const failed = await edit(plan.ops, 'history.stepDrop');
    if (failed) { toast.show(failed); return false; }
    if (how.follow) {
      const end = plan.startMs + plan.durMs;
      pause();
      if (end <= player.current.duration * 1000 + 1) seek(end);
      else seekWhenLonger.current = end;
    }
    return true;
  }, [editModel, edit, pause, seek, t, toast]);
  /* a cut on the canvas: its files at the timeline's end, one after the other, then the edit shown */
  const sendFromCanvas = React.useCallback(async (list: WorkspaceResource[]) => {
    for (const file of list) if (!(await addMedia(file))) return;
    toast.show(t('canvas.cut.sent').replace('{n}', String(list.length)));
    setCanvasOpen(false);
  }, [addMedia, t, toast]); // eslint-disable-line react-hooks/exhaustive-deps
  /* a file on the canvas put on the timeline: at its end, as the Assets' "+" does when nothing is picked */
  const addFromCanvas = React.useCallback(async (file: WorkspaceResource) => {
    if (await addMedia(file)) toast.show(t('canvas.added'));
  }, [addMedia, t, toast]);
  /*
   * A thing of Saved put on the timeline without a drag (its "+", Enter, the source viewer's `,` and `.`): brought into
   * the project first, then as a file of the project goes (`how`), or a clip as it was saved, at the playhead on the
   * targeted track; a group on new tracks at the top, from the playhead.
   */
  const placeSaved = React.useCallback(async (file: WorkspaceResource, how: { mode?: EditMode; range?: SourceRange | null; atPlayhead?: boolean; follow?: boolean } = {}) => {
    let taken: Awaited<ReturnType<typeof api.takeSaved>>;
    try { taken = await api.takeSaved(projectId, file.path); } catch (e) { toast.show(e instanceof Error ? e.message : String(e)); return; }
    if ('path' in taken) {
      const { bundle: _bundle, ...rest } = file;
      await addMedia({ ...rest, path: taken.path }, how);
      return;
    }
    /* a group: on new tracks at the top, from the playhead */
    if ('clips' in taken) {
      const failed = await edit(groupInsertOps(taken.clips, snapToFrame(timeRef.current) / 1000, 0, editModel(), taken.keyframes), 'history.stepDrop');
      if (failed) toast.show(failed);
      return;
    }
    const target = timelineCommands.current?.target() ?? null;
    const plan = placeMedia(editModel(), { file, range: null, target, at: snapToFrame(timeRef.current), ...switchesOf(readTimelinePrefs()), stage: stageRef.current });
    if ('error' in plan) { toast.show(plan.error === 'locked' ? t('timeline.trackLocked') : t('timeline.dropNotClip')); return; }
    const clip = taken.clip;
    const failed = await edit([...keyframesOps(taken.keyframes), ...plan.ops.map((op) => (op.op === 'insert' ? { ...op, clip: clip as never } : op))], 'history.stepDrop');
    if (failed) toast.show(failed);
  }, [projectId, editModel, edit, addMedia, t, toast]);
  const placeFromSource = React.useCallback((mode: EditMode, range: SourceRange | null) => {
    if (pickedMedia && pickedSaved) void placeSaved(pickedMedia, { mode, range, atPlayhead: true, follow: true });
    else if (pickedMedia) void addMedia(pickedMedia, { mode, range, atPlayhead: true, follow: true });
  }, [addMedia, placeSaved, pickedMedia, pickedSaved]);
  /*
   * OpenFilm's library in the assets drawer (components/library/LibraryDrawer, lib/library). A click tries a thing in
   * the viewer, nothing written (components/library/LibraryTrial; a look through the stage's look preview, on the clip
   * it would go on). Enter or "+" puts it in: a page or a sound taken into the project and put at the
   * playhead (a sound as a file of the project goes, a page on a new track at the top, a transition's middle on the
   * cut), a look written into the clips' style, a fade made on a cut as the timeline's menu makes one; what was put
   * in is then picked on the timeline, so the inspector shows what can be changed in it. A drag onto the timeline
   * goes through dropAsset, or for a look or a fade through applyDrop.
   */
  const [libraryTrial, setLibraryTrial] = React.useState<LibraryItem | null>(null);
  const [templateStatus, setTemplateStatus] = React.useState<Partial<Record<string, 'failed'>>>({});
  const onTemplateState = React.useCallback((id: string, state: TemplatePreviewState) => {
    setTemplateStatus((current) => {
      if (state === null) {
        if (!(id in current)) return current;
        const copy = { ...current }; delete copy[id]; return copy;
      }
      return current[id] === state ? current : { ...current, [id]: state };
    });
  }, []);
  const beginLibraryPreview = React.useCallback(() => { pause(); pickMedia(null); }, [pause, pickMedia]);
  /* tried again, it starts again */
  const [libraryTrialRound, setLibraryTrialRound] = React.useState(0);
  /* playing, the film is what is watched: the try goes */
  React.useEffect(() => { if (playing || canvasOpen) dismissLibraryPreview.current(); }, [playing, canvasOpen]);
  const library = React.useMemo(() => {
    const picked = () => selectedClips.flatMap((b) => (b.clipId ? [b.clipId] : []));
    const target = () => timelineCommands.current?.target() ?? null;
    /* the cut a transition goes on: the picked clip's, else the one nearest the playhead; and the track it is on */
    const cutHere = () => {
      const model = editModel();
      const cut = cutForClick(model, 'dissolve', picked(), timeRef.current, target());
      const clips = model.flatMap((tr) => tr.clips.map((c) => ({ ...c, track: tr.index })));
      const after = clips.find((c) => c.id === cut?.b);
      const before = clips.find((c) => c.id === cut?.a);
      const edge = after ?? before;
      return cut && edge ? { cut, atMs: after ? after.startMs : before!.endMs, track: edge.track } : null;
    };
    /* the clips a look goes on: the picked pictures, else the main track's clip under the playhead */
    const lookTargets = (): { loc: string; style: string | undefined }[] => {
      const pics = selectedClips.flatMap((b) => {
        const clip = b.clipId && b.loc ? filmClipOf(b.clipId) : null;
        return clip && !clip.sound && filmSrcKind(clip.src) !== 'sound' ? [{ loc: b.loc!, style: clip.style }] : [];
      });
      if (pics.length) return pics;
      const model = editModel();
      const main = mainTrackOf(model);
      const ms = timeRef.current;
      const under = model.find((tr) => tr.index === main)?.clips.find((c) => ms >= c.startMs && ms < c.endMs);
      const block = under ? blocksRef.current.find((b) => b.clipId === under.id) : undefined;
      const clip = under ? filmClipOf(under.id) : null;
      return block?.loc && clip ? [{ loc: block.loc, style: clip.style }] : [];
    };
    /* what was just put in, picked on the timeline once it is drawn there */
    const pickAdded = pickNewClip;
    const clipIds = () => new Set(blocksRef.current.flatMap((b) => (b.clipId ? [b.clipId] : [])));
    const look = (item: LibraryItem, on: { loc: string; style: string | undefined }[]) => {
      if (!on.length) { toast.show(t('assetDrawer.pickClips')); return; }
      /* a video wears it as a file of the project, graded at its own depth (lib/clip-color); a picture or a page in CSS */
      const videos = on.flatMap((c) => {
        const block = blocksRef.current.find((b) => b.loc === c.loc);
        return block?.kind === 'video' && block.clipId && item.grade ? [{ id: block.clipId, style: c.style, loc: c.loc }] : [];
      });
      const rest = on.filter((c) => !videos.some((v) => v.loc === c.loc));
      void (async () => {
        if (videos.length && item.grade) {
          const filter = { id: item.id, title: nameOf(item.name, 'en'), grade: item.grade };
          const text = await readColorTexts(projectId, [filterUrl(item.id, 1), ...Object.keys(STANDARD)]);
          const err = await colorHost.commit(filterWrite(videos, text, filter, 1, STANDARD), 'history.stepColor');
          if (err) return err;
        }
        return rest.length ? editBlocks(rest.map((c) => ({ loc: c.loc, prop: 'style', value: withLook(c.style, item.filter ?? null) }))) : null;
      })().then((err) => {
        if (err) toast.showError(err);
        else toast.show(t('assetDrawer.looked').replace('{name}', nameOf(item.name, language)).replace('{n}', String(on.length)));
      });
    };
    /* a motion preset (src/clip-motion.mjs withPreset): on the picked clips, in its slots; a camera move on the cut
       nearest, the clip before it going out and the one after it coming in. Its keyframes go in the film's style */
    const motion = (item: LibraryItem, on?: { a: string | null; b: string | null }) => {
      const presets = item.motion ?? {};
      /* two shots moving at once: the next one overlapping the last, as a transition of the timeline's */
      if (item.place === 'cut' && item.lap && presets.in) {
        const cut = on ?? cutHere()?.cut ?? null;
        if (!cut?.a || !cut.b) { toast.show(t('assetDrawer.noCut')); return; }
        void askTransition({ kind: 'add', type: 'move', cut, move: { in: presets.in, ...(presets.out ? { out: presets.out } : {}) } }).then((err) => {
          if (err) toast.show(err);
          else toast.show(t('assetDrawer.added').replace('{name}', nameOf(item.name, language)));
        });
        return;
      }
      const keyframes = Object.fromEntries(Object.values(presets).map((p) => [p!.name, p!.body]));
      const styled: { clip: string; prop: string; value: string | null }[] = [];
      if (item.place === 'cut') {
        const cut = on ?? cutHere()?.cut ?? null;
        if (!cut) { toast.show(t('assetDrawer.noCut')); return; }
        for (const [id, slot] of [[cut.a, 'out'], [cut.b, 'in']] as const) {
          const clip = id ? filmClipOf(id) : null;
          if (clip && presets[slot]) styled.push({ clip: clip.id, prop: 'style', value: withPreset(clip.style, slot, presets[slot]!) || null });
        }
      } else {
        for (const c of lookTargets()) {
          const id = clipIdAt(filmRef.current, c.loc);
          if (!id) continue;
          let style = c.style;
          for (const slot of ['in', 'out', 'loop'] as const) if (presets[slot]) style = withPreset(style, slot, presets[slot]!);
          styled.push({ clip: id, prop: 'style', value: style || null });
        }
      }
      if (!styled.length) { toast.show(t('assetDrawer.pickClips')); return; }
      void edit([{ op: 'keyframes', set: keyframes }, { op: 'props', edits: styled as never }], 'history.stepDrop').then((err) => {
        if (err) toast.showError(err);
        else toast.show(t('assetDrawer.added').replace('{name}', nameOf(item.name, language)));
      });
    };
    const fade = (item: LibraryItem, cut: { a: string | null; b: string | null } | null) => {
      if (!cut || !item.fade) { toast.show(t('assetDrawer.noCut')); return; }
      void askTransition({ kind: 'add', type: item.fade, cut }).then((err) => { if (err) toast.show(err); });
    };
    /* the text component's clips picked, which a text style or motion goes on */
    const textTargets = () => selectedClips.flatMap((b) => {
      const clip = b.clipId && b.loc ? filmClipOf(b.clipId) : null;
      return clip && b.loc && isTextClip(clip.src) ? [{ loc: b.loc, overrides: clip.overrides }] : [];
    });
    /* a text style (or a look of one's own): a new line of words in it at the playhead, as its "+" says, whatever is
       picked (a look goes on picked words from the Text inspector's word art) */
    const textLine = (item: LibraryItem) => {
      const text = builtInItem(`${BUILT_IN}/${TEXT_COMPONENT}`);
      if (text) void place(text, item.vars ?? {}, nameOf(item.name, language), item.w ? item : text);
    };
    /* a text motion: on the words picked; none picked, a new line of words with it at the playhead */
    const textLook = (item: LibraryItem) => {
      const vars = item.vars ?? {};
      const on = textTargets();
      if (!on.length) {
        const text = builtInItem(`${BUILT_IN}/${TEXT_COMPONENT}`);
        /* its box the basic line's own (a title's taller), else the text's */
        if (text) void place(text, vars, nameOf(item.name, language), item.w ? item : text);
        return;
      }
      /* as the Text inspector puts them on: a look in place of the last one, a motion in its slot; one line of words
         refitted to its new look (editClips), several each as they are */
      const slot = item.kind === 'textmotion' && (item.group === 'in' || item.group === 'loop' || item.group === 'out') ? item.group : null;
      const next = (own: unknown[] | undefined) => (slot ? withMotion(own, slot, vars) : withRootVars(own, vars));
      const edits = on.map((c) => ({ loc: c.loc, prop: 'overrides' as const, value: next(c.overrides as unknown[] | undefined) as never }));
      void (on.length === 1 ? editClips(edits as never) : editBlocks(edits as never)).then((err) => {
        if (err) { toast.showError(err); return; }
        toast.show(t('assetDrawer.looked').replace('{name}', nameOf(item.name, language)).replace('{n}', String(on.length)));
        /* a motion put on: played, so it is seen */
        const id = on.length === 1 ? clipIdAt(filmRef.current, on[0]!.loc) : null;
        if (slot && id) playTextMotion(id, slot);
      });
    };
    /** `vars`: the page's CSS variables set on the clip put in (a text style or motion on new words), named `as`, its box
        `shape`'s (libraryBox). */
    const place = async (item: LibraryItem, vars?: Record<string, string>, as?: string, shape: LibraryItem = item) => {
      const name = as ?? nameOf(item.name, language);
      const drag = libraryDragItem(item, name);
      if (!drag) return;
      let at = snapToFrame(timeRef.current) / 1000;
      let track: number | { insert: number } = { insert: 0 };
      if (item.place === 'cut') {
        const here = cutHere();
        if (!here) { toast.show(t('assetDrawer.noCut')); return; }
        at = Math.max(0, Math.round(here.atMs - (item.durationMs ?? 0) / 2) / 1000);
        track = cutTrack(timelineTracks, here.track, at, item.durationMs ?? 0);
      }
      let taken: Awaited<ReturnType<typeof api.takeSaved>>;
      try { taken = await api.takeSaved(projectId, `${BUILT_IN}/${item.id}`); } catch (e) { toast.show(e instanceof Error ? e.message : String(e)); return; }
      const before = clipIds();
      if ('path' in taken) {
        if (await addMedia({ path: taken.path, name, dir: '', size: 0, kind: item.kind === 'file' ? drag.kind : 'audio', mtimeMs: 0, ...(drag.durationMs ? { durationMs: drag.durationMs } : {}) }, { atPlayhead: true })) {
          toast.show(t('assetDrawer.added').replace('{name}', name));
          pickAdded(before);
        }
        return;
      }
      /* a template: its tracks new ones at the top, from the playhead, laid out for this picture */
      if ('clips' in taken) {
        const failed = await edit(groupInsertOps(await templateClips(`${BUILT_IN}/${item.id}`, taken.clips), at, groupInsertAt(track), editModel(), taken.keyframes), 'history.stepDrop');
        if (failed) { toast.show(failed); return; }
        toast.show(t('assetDrawer.added').replace('{name}', name));
        pickAdded(before);
        return;
      }
      if (!('clip' in taken)) return;
      /* in a box of its own, the page drawn at the box's size (not the picture's, shrunk into it); a line of words in a
         box that hugs them (lib/text-box) */
      const stageNow = stageRef.current ?? { w: 1920, h: 1080 };
      const shaped = libraryBox(shape, stageNow);
      /* a line of words says the default words, in a box that hugs them */
      const words = item.id === TEXT_COMPONENT ? defaultTextWords() : undefined;
      const box = shaped && words != null ? await hugText(pageUrl(item), shaped, stageNow.w, vars, words) : shaped;
      const own = (taken.clip as { overrides?: unknown[] }).overrides;
      const overrides = words != null ? withWords(vars ? withRootVars(own, vars) : own, words) : vars ? withRootVars(own, vars) : undefined;
      const clip = { ...taken.clip, ...(box ? { box, size: { w: box.w, h: box.h } } : {}), ...(overrides ? { overrides } : {}) };
      const failed = await edit([{ op: 'insert', clip: clip as never, at, track }], 'history.stepDrop');
      if (failed) { toast.show(failed); return; }
      toast.show(t('assetDrawer.added').replace('{name}', name));
      pickAdded(before);
    };
    /* a filter on a track of its own over the film, from the playhead, its own length: a see-through page whose
       backdrop-filter grades every layer under it (lib/library isFilterLayer); dropped on a clip, that clip alone */
    const filterLayer = async (item: LibraryItem) => {
      if (!item.filter) return;
      const name = nameOf(item.name, language);
      let taken: Awaited<ReturnType<typeof api.takeSaved>>;
      try { taken = await api.takeSaved(projectId, `${BUILT_IN}/${item.id}`); } catch (e) { toast.show(e instanceof Error ? e.message : String(e)); return; }
      if (!('clip' in taken)) return;
      const before = clipIds();
      const at = snapToFrame(timeRef.current) / 1000;
      const clip = { ...taken.clip, style: `backdrop-filter: ${item.filter}` };
      const failed = await edit([{ op: 'insert', clip: clip as never, at, track: { insert: 0 } }], 'history.stepDrop');
      if (failed) { toast.show(failed); return; }
      toast.show(t('assetDrawer.added').replace('{name}', name));
      pickAdded(before);
    };
    const actions: LibraryActions = {
      add: (item) => {
        if (item.kind === 'look') void filterLayer(item);
        else if (item.kind === 'fade') fade(item, cutHere()?.cut ?? null);
        else if (item.kind === 'motion') motion(item);
        else if (item.kind === 'group') void insertTemplate(item, snapToFrame(timeRef.current) / 1000, { insert: 0 });
        else if (item.kind === 'textstyle') textLine(item);
        else if (item.kind === 'textmotion') textLook(item);
        else void place(item);
      },
      tryOut: (item) => { setLibraryTrial(item); if (item) setLibraryTrialRound((r) => r + 1); },
    };
    /* a look or a fade dropped on the timeline (Timeline onApplyDrop): on that clip, on that cut */
    const applyDrop = async (file: ResourceDragItem, at: { blockId: string } | { cut: { a: string | null; b: string | null } }): Promise<string | null> => {
      const item = builtInItem(file.saved);
      if (!item) return null;
      dismissLibraryPreview.current();
      if ('cut' in at) { if (item.kind === 'motion') motion(item, at.cut); else fade(item, at.cut); return null; }
      const block = blocksRef.current.find((b) => b.id === at.blockId);
      const clip = block?.clipId ? filmClipOf(block.clipId) : null;
      look(item, block?.loc && clip ? [{ loc: block.loc, style: clip.style }] : []);
      return null;
    };
    return { actions, applyDrop, lookTargets, place };
  }, [language, selectedClips, editModel, projectId, addMedia, timelineTracks, edit, filmClipOf, editBlocks, editClips, playTextMotion, askTransition, t, toast, insertTemplate]);
  const saveBlocks = React.useCallback((blocks: readonly TimelineBlock[], into: string, together = false) => {
    const kept = blocks.filter((b) => b.clipId);
    /* several as one: laid out as they are, from the first one's start to the last one's end */
    if (together && kept.length > 1) {
      const startMs = Math.min(...kept.map((b) => b.startMs));
      const endMs = Math.max(...kept.map((b) => b.endMs));
      /* named and pictured by the top one that draws a picture */
      const trackOf = (b: TimelineBlock) => parseFilmDocLoc(b.loc ?? '')?.track ?? 0;
      const byTrack = [...kept].sort((a, b) => trackOf(a) - trackOf(b) || a.startMs - b.startMs);
      const top = byTrack.find((b) => b.kind === 'mg' || b.kind === 'video') ?? byTrack[0]!;
      const w = top.box?.w ?? top.size?.w;
      const h = top.box?.h ?? top.size?.h;
      const name = `${top.title}${kept.length > 1 ? ` +${kept.length - 1}` : ''}`;
      void saveThings({ groups: [{ ids: kept.map((b) => b.clipId!), name, durationMs: endMs - startMs, ...(w ? { w } : {}), ...(h ? { h } : {}) }], into }, 1);
      return;
    }
    const clips = kept.map((b) => {
      const w = b.box?.w ?? b.size?.w;
      const h = b.box?.h ?? b.size?.h;
      return { id: b.clipId!, name: b.title, durationMs: Math.max(0, b.endMs - b.startMs), ...(w ? { w } : {}), ...(h ? { h } : {}) };
    });
    void saveThings({ clips, into }, clips.length);
  }, [saveThings]);
  /* one clip, or several as one (each one alone, too) */
  const saveEntry = (blocks: readonly TimelineBlock[]): ContextMenuEntry[] => {
    const n = blocks.filter((b) => b.clipId).length;
    if (!n) return [];
    /* to a place of the person's shelf (lib/library-places): the one there, or picked from them */
    const icon = <BookmarkPlus size={14} />;
    if (n === 1) return saveToEntry(folders, { id: 'save', label: t('saved.add'), many: t('saved.addTo'), icon, pick: (into) => saveBlocks(blocks, into) });
    return [
      ...saveToEntry(folders, { id: 'save', label: t('saved.addTogether').replace('{n}', String(n)), many: t('saved.addTogetherTo').replace('{n}', String(n)), icon, pick: (into) => saveBlocks(blocks, into, true) }),
      ...saveToEntry(folders, { id: 'save-each', label: t('saved.addEach'), many: t('saved.addEachTo'), icon, pick: (into) => saveBlocks(blocks, into) }),
    ];
  };
  /* caption tracks' edits are steps of the editor's history; a file written, the picture reads it again */
  React.useEffect(() => { configureCaptionTracks({ record: film.record, written: () => preview.current?.captions?.() }); }, [film.record]);
  /**
   * What is said in the film made a caption track (studio/server/caption-tracks.mjs), on top: one undo step. False when
   * it was not (said why).
   */
  /* the caption tracks the library's captions act on (components/library/CaptionsPane): the captions of speech are made
     again on the top one made of what is said (SPEECH_NOTE), a caption typed in goes on the picked track */
  const captionRows = timelineTracks.filter((tr) => tr.captions && tr.docIndex != null);
  const speechRow = captionRows.find((tr) => { const vtt = cuesOf(tr.captions!.src); return vtt ? madeOfSpeech(vtt) : false; }) ?? null;
  const captionRow = captionRows.find((tr) => tr.captions?.src === cuePick?.src)
    ?? captionRows.find((tr) => !tr.locked) ?? captionRows[0] ?? null;
  const speechSrc = speechRow?.captions?.src ?? null;
  /** Captions of what `clips` say (null: all that speak): again on the speech's track, else on a new one; its file, or null. */
  const captionsFromSpeech = React.useCallback(async (clips: readonly string[] | null): Promise<string | null> => {
    /* captions there already: what is said now, in their place, their look kept (a cue's own look goes with it) */
    if (speechSrc) {
      const got = await fetch(`/api/projects/${encodeURIComponent(projectId)}/caption-tracks/speech${clips ? `?clips=${encodeURIComponent(clips.join(','))}` : ''}`).then((r) => (r.ok ? r.json() : null), () => null) as { text?: string } | null;
      const was = captionTrackNow(projectId, speechSrc);
      if (typeof got?.text !== 'string' || !was) { toast.show(t('timeline.editFail')); return null; }
      const said = withIds(readVtt(got.text));
      if (!said.cues.length) { toast.show(t('timeline.captionsNone')); return null; }
      /* its note says what its cues are now, so it follows the cuts again from here */
      let next = { ...was, notes: said.notes, cues: said.cues.map((c) => ({ ...c, settings: was.cues[0]?.settings ?? c.settings })) };
      for (const c of was.cues) next = setCueRule(next, `::cue(#${c.id})`, null);
      const why = await writeCaptionTrack(projectId, speechSrc, next, 'captionTrack.stepRemake');
      if (why) { toast.show(why); return null; }
      return speechSrc;
    }
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/caption-tracks/from-subtitles`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: t('captionTrack.fileName'), ...(clips ? { clips } : {}) }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({})) as { src?: string; text?: string; error?: string } | undefined;
    if (!res?.ok || !body?.src) { toast.show(body?.error ?? t('timeline.editFail')); return null; }
    if (!body.text?.includes('-->')) { toast.show(t('timeline.captionsNone')); return null; }
    const why = await editOps([{ op: 'captions', at: 0, captions: { src: body.src, kind: 'captions', label: t('captionTrack.name') } }], 'captionTrack.stepAuto');
    if (why) { toast.show(why); return null; }
    return body.src;
  }, [projectId, speechSrc, editOps, toast, t]);
  /**
   * A caption track's translation (components/CaptionInspector) put in the film just above it, its lines a little
   * higher so the two languages read one over the other: one undo step. Null, or why not.
   */
  const addTranslation = React.useCallback(async (from: string | null, src: string, language: string): Promise<string | null> => {
    const at = Math.max(0, from ? film.film?.tracks.findIndex((tr) => tr.captions?.src === from) ?? 0 : 0);
    /* alone (no track of the words said under it): where its captions were made to sit */
    const got = from ? await fetch(`/api/projects/${encodeURIComponent(projectId)}/caption-tracks/file?src=${encodeURIComponent(src)}`).then((r) => r.json(), () => null) as { text?: string } | null : null;
    if (typeof got?.text === 'string') {
      const above = writeVtt(placeCues(withIds(readVtt(got.text)), null, 0, -TRANSLATION_LIFT_PCT));
      await fetch(`/api/projects/${encodeURIComponent(projectId)}/caption-tracks/file`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ src, text: above }) }).catch(() => null);
    }
    const name = FILM_SUBTITLE_LANGUAGES.find((l) => l.code === language)?.native ?? language;
    return editOps([{ op: 'captions', at, captions: { src, kind: 'subtitles', srclang: language, label: `${t('captionTrack.name')} · ${name}` } }], 'captionTrack.stepTranslate');
  }, [projectId, film.film, editOps, t]);
  /** A caption put in on a caption track at a time (a caption row's menu): picked, its words to type in the inspector. */
  const addCaption = React.useCallback(async (src: string, atMs: number): Promise<string | null> => {
    if (tracksRef.current.some((tr) => tr.captions?.src === src && tr.locked)) return t('timeline.trackLocked');
    const vtt = captionTrackNow(projectId, src);
    if (!vtt) return t('timeline.editFail');
    if (atMs >= totalMs - 100) return t('captionTrack.pastEnd');
    const made = addCue(vtt, snapToFrame(atMs) / 1000, t('subtitleRow.newText'), totalMs / 1000);
    if (!made) return t('subtitleRow.noRoom');
    const why = await writeCaptionTrack(projectId, src, made.vtt, 'captionTrack.stepAdd');
    if (!why) { setCaptionSelection({ src, ids: new Set([made.id]) }); showCaptionLook(); }
    return why;
  }, [projectId, totalMs, showCaptionLook, t]);
  /**
   * A new caption track on top (the library's captions, components/library/CaptionsPane): of a file's captions (SRT or
   * WebVTT, `file`; from `atMs` on when it was dropped there), or with one caption at the playhead, picked, its words to
   * type in the inspector. One undo step.
   */
  const newCaptionTrack = React.useCallback(async (file: File | null, atMs = 0): Promise<string | null> => {
    let text = '';
    let picked: string | null = null;
    if (file) text = await file.text();
    else {
      const atMs = snapToFrame(timeRef.current);
      const made = atMs < totalMs - 100 ? addCue(readVtt('WEBVTT\n'), atMs / 1000, t('subtitleRow.newText'), totalMs / 1000) : null;
      if (!made) { toast.show(t(atMs >= totalMs - 100 ? 'captionTrack.pastEnd' : 'subtitleRow.noRoom')); return null; }
      text = writeVtt(made.vtt);
      /* Extra tracks begin above the existing captions, so simultaneous lines can be read straight away. Their
         positions stay editable on the picture, independently of which timeline row they occupy. */
      if (captionRows.length) text = writeVtt(placeCues(made.vtt, null, 0, -Math.min(captionRows.length, 5) * TRANSLATION_LIFT_PCT));
      picked = made.id;
    }
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/caption-tracks/new`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: file ? file.name.replace(/\.[^.]+$/, '') : t('captionTrack.fileName'), text }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({})) as { src?: string; error?: string } | undefined;
    if (!res?.ok || !body?.src) { toast.show(body?.error ?? t('timeline.editFail')); return null; }
    const src = body.src;
    /* dropped at a time: its captions from there on, their words' times with them */
    const by = file && atMs > 0 ? snapToFrame(atMs) / 1000 : 0;
    if (by && typeof (body as { text?: string }).text === 'string') {
      const vtt = readVtt((body as { text: string }).text);
      const later = writeVtt({ ...vtt, cues: vtt.cues.map((c) => ({ ...c, start: c.start + by, end: c.end + by, text: shifted(c.text, by) })) });
      await fetch(`/api/projects/${encodeURIComponent(projectId)}/caption-tracks/file`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ src, text: later }) }).catch(() => null);
    }
    const why = await editOps([{ op: 'captions', at: 0, captions: { src, kind: 'captions', label: file ? file.name.replace(/\.[^.]+$/, '') : t('captionTrack.name') } }], file ? 'captionTrack.stepImport' : 'captionTrack.stepNew');
    if (why) { toast.show(why); return null; }
    if (picked) { setCaptionSelection({ src, ids: new Set([picked]) }); showCaptionLook(); }
    return src;
  }, [projectId, totalMs, captionRows.length, editOps, showCaptionLook, toast, t]);
  /** A caption at the playhead: on the picked caption track, else the first unlocked one or a new track. */
  const captionHere = React.useCallback(async () => {
    const src = captionRow?.captions?.src;
    if (!src) { await newCaptionTrack(null); return; }
    const why = await addCaption(src, timeRef.current);
    if (why) toast.show(why);
  }, [captionRow, newCaptionTrack, addCaption, toast]);
  /**
   * Captions translated into `language` (the library's New captions): a caption track's (`src`), on a track just above
   * it; or captions given whole (`text`: what is said, a subtitle file), alone on a track on top.
   */
  const translateTrack = React.useCallback(async (from: { src: string } | { text: string; name: string }, language: string) => {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/caption-tracks/translate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...from, language }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({})) as { src?: string; error?: string; code?: string } | undefined;
    if (!res?.ok || !body?.src) {
      toast.show(body?.code === 'no-translator' ? t(studioHost?.agents ? 'timeline.subtitleTranslateAgent' : 'timeline.subtitleTranslateConnect') : t('timeline.subtitleTranslateFailed'));
      return;
    }
    const why = await addTranslation('src' in from ? from.src : null, body.src, language);
    if (why) toast.show(why);
  }, [projectId, addTranslation, toast, t]);
  /** Subtitle files (SRT, WebVTT) among files dropped on the timeline or the picture: each a caption track from `atMs`. */
  const takeSubtitleFiles = React.useCallback((files: File[], atMs: number): File[] => {
    const subtitles = files.filter((f) => /\.(srt|vtt)$/i.test(f.name));
    for (const f of subtitles) void newCaptionTrack(f, atMs);
    return files.filter((f) => !subtitles.includes(f));
  }, [newCaptionTrack]);
  /* the captions of what is said kept in step with the film (server caption-tracks syncSpeechCaptions), from the
     transcripts as they are: a voice made with its words timed is never heard again. Asked as the project opens and
     whenever what is said changes (a voice put in, a clip cut or moved); not part of the person's undo */
  /* the media the film's words come from: their clips are marked on the timeline */
  const transcribedSrcs = React.useMemo(() => new Set((subs.captions?.cues ?? []).flatMap((c) => (c.src ? [c.src.replace(/#.*$/, '')] : []))), [subs.captions]);
  /* the caption inspector's Info: a caption track's badge, name and language, and where its captions come from */
  const captionInfoOf = React.useCallback((src: string): CaptionTrackInfo => {
    const row = captionRows.find((tr) => tr.captions?.src === src);
    const track = row?.docIndex != null ? film.film?.tracks[row.docIndex]?.captions : undefined;
    const vtt = cuesOf(src);
    const clips = vtt ? speechClips(vtt) : null;
    return {
      badge: row?.badge ?? null, label: track?.label ?? null, language: track?.srclang ?? null,
      speech: vtt && madeOfSpeech(vtt) ? { clips: clips ? clips.map((src) => src.replace(/^.*\//, '')) : null, auto: untouchedSpeech(vtt) } : null,
    };
  }, [captionRows, film.film, cuesOf]);
  /**
   * The words of captions cut out of the film, picture and sound with them (the caption inspector's Info): each stretch
   * (those that touch as one) taken out and the film closed up, the last first, each planned on the film the one
   * before made.
   */
  const cutRanges = React.useCallback(async (ranges: readonly { startMs: number; endMs: number }[]): Promise<string | null> => {
    const joined: { startMs: number; endMs: number }[] = [];
    for (const r of [...ranges].sort((a, b) => a.startMs - b.startMs)) {
      const last = joined.at(-1);
      if (last && r.startMs <= last.endMs + 1) last.endMs = Math.max(last.endMs, r.endMs);
      else joined.push({ ...r });
    }
    for (const r of joined.reverse()) {
      const before = filmRef.current;
      const plan = planCutRange(editModel(), r);
      if (!plan.ops.length) continue;
      const why = await edit(plan.ops, 'captionTrack.stepCut');
      if (why) { toast.show(why); return why; }
      for (let i = 0; i < 80 && filmRef.current === before; i += 1) await new Promise((done) => window.setTimeout(done, 25));
      await new Promise((done) => requestAnimationFrame(() => done(null)));
    }
    return null;
  }, [editModel, edit, toast]);
  /* the clips that speak, for the library's New captions to choose from: with a transcript, or wanting one */
  const heardClips = React.useMemo(() => {
    const wanting = new Set(subs.captions?.untranscribed ?? []);
    return timelineTracks.flatMap((tr) => (tr.muted || tr.hidden ? [] : tr.blocks.flatMap((b) => {
      const src = b.src?.replace(/#.*$/, '');
      if (!b.clipId || !src || b.cue || b.disabled) return [];
      const transcribed = transcribedSrcs.has(src);
      return transcribed || wanting.has(src) ? [{ clipId: b.clipId, name: b.title || src, src, startMs: b.startMs, endMs: b.endMs, transcribed }] : [];
    })));
  }, [timelineTracks, transcribedSrcs, subs.captions]);
  /* the clips with no transcript ticked to be transcribed for New captions (there and on the timeline): ticked by
     themselves only while nothing in the film has its words yet (then they are what speaks; else most likely music) */
  const [captionTicks, setCaptionTicks] = React.useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [captionChoosing, setCaptionChoosing] = React.useState(false);
  const captionPicked = React.useMemo(() => {
    const anyReady = heardClips.some((h) => h.transcribed);
    return new Set(heardClips.filter((h) => !h.transcribed && (captionTicks.get(h.clipId) ?? !anyReady)).map((h) => h.clipId));
  }, [heardClips, captionTicks]);
  const pickCaptionClip = React.useCallback((clipId: string, on: boolean) => setCaptionTicks((m) => new Map(m).set(clipId, on)), []);
  const timelineCaptionPick = React.useMemo(() => (captionChoosing ? {
    lit: new Set(heardClips.filter((h) => h.transcribed || captionPicked.has(h.clipId)).map((h) => h.clipId)),
    choosable: new Set(heardClips.filter((h) => !h.transcribed).map((h) => h.clipId)),
    picked: captionPicked,
    toggle: (clipId: string) => pickCaptionClip(clipId, !captionPicked.has(clipId)),
  } : null), [captionChoosing, heardClips, captionPicked, pickCaptionClip]);
  const saidKey = subs.captions ? JSON.stringify(subs.captions.cues.map((c) => [c.startMs, c.durMs, c.text])) : null;
  React.useEffect(() => {
    if (saidKey == null) return undefined;
    let gone = false;
    const timer = window.setTimeout(() => {
      void fetch(`/api/projects/${encodeURIComponent(projectId)}/caption-tracks/sync`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: t('captionTrack.fileName'), label: t('captionTrack.name') }),
      }).then((r) => (r.ok ? r.json() : null), () => null).then((body: { made?: string } | null) => { if (!gone && body?.made) toast.show(t('captionTrack.autoMade')); });
    }, 300);
    return () => { gone = true; window.clearTimeout(timer); };
  }, [projectId, saidKey]); // eslint-disable-line react-hooks/exhaustive-deps
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
  /* markers, solo, track heights, loudness, freeze frame, replace (use-editor-tools); a replacement from this computer
     is picked and brought in as the media pane's Import does (pickReplacement, below) */
  const pickReplacementRef = React.useRef<(family: ReplaceFamily) => Promise<string | null>>(async () => null);
  const pickReplacement = React.useCallback((family: ReplaceFamily) => pickReplacementRef.current(family), []);
  const tools = useEditorTools({
    projectId, tracks: timelineTracks, film: film.film, settings, patchSettings, player, timeRef, seek, edit: editOps, record: film.record,
    editModel, selectedClipIds: selectedKeys, listing, toast, pickFile: pickReplacement,
  });
  const shownTracks = React.useMemo(() => foldHeads(tools.tracks, foldedHeads), [tools.tracks, foldedHeads]);
  const organizeTimelineTracks = React.useCallback(async () => {
    const current = filmRef.current;
    if (!current) return;
    if (current !== film.film || pendingDrops.length) { toast.show(t('timeline.applying')); return; }
    const durations = new Map<string, number>();
    for (const span of spans) if (span.native != null) durations.set(span.src, span.native);
    for (const [src, fact] of mediaFacts) if (fact.duration != null) durations.set(src, fact.duration);
    const protectedTracks = new Set(tools.timeline.solo.tracks);
    if (mainTrack != null) protectedTracks.add(mainTrack);
    for (const row of shownTracks) {
      if (row.docIndex != null && (row.main || row.height != null)) protectedTracks.add(row.docIndex);
    }
    const protectedClips = new Set(clipFades.keys());
    for (const tr of filmTransitions) {
      for (const id of [tr.a, tr.b, tr.rest, tr.white]) if (id) protectedClips.add(id);
    }
    const ops = organizeTracks(current, durations, protectedTracks, protectedClips);
    if (!ops.length) { toast.show(t('timeline.organizeTracksNone')); return; }
    const why = await edit(ops, 'history.stepTrackOrganize');
    if (why) toast.showError(why);
  }, [film.film, pendingDrops, spans, mediaFacts, shownTracks, tools.timeline.solo.tracks, mainTrack, clipFades, filmTransitions, edit, toast, t]);
  /* a template put in as one compound clip: its film read from its folder (TemplateFilmSection keeps each) */
  const loadTemplateFilm = React.useCallback(async (dir: string) => (await api.readPartFilm(projectId, dir)).film as unknown as FilmValue, [projectId]);
  /*
   * What the inspector offers of a template put in as one compound clip (`block`, its film `film` in `dir`): its places,
   * words, looks, switches, pictures and sound (lib/template-instance filmTemplate). A change writes its film again in a
   * folder of its own and shows the clip from there: one step, undone as any other, the film before kept as it was.
   */
  const templateFilmHost = React.useCallback((block: TimelineBlock, dir: string, film: FilmValue): TemplateHost => {
    const offered = filmTemplate(film.tracks as never);
    const item = builtInItem(`${BUILT_IN}/${templateOfFolder(dir)}`);
    const clipOf = (id: string) => film.tracks.flatMap((tr) => tr.clips).find((c) => c.id === id) as unknown as Clip | undefined;
    /* a file of its film as the project names it */
    const outer = (src: string) => srcOutOf(src.split('#')[0]!, dir);
    const lenOf = (c: Clip) => Math.round(((c.time?.[1] ?? 0) - (c.time?.[0] ?? 0)) * 1000);
    const own = (kind: 'picture' | 'sound') => (listing?.files ?? []).filter((f) => (kind === 'sound' ? f.kind === 'audio' : f.kind === 'video' || f.kind === 'image') && !fromLibrary(f.path));
    /* the film as it is to be, written in a folder of its own; the clip shown from there (and changed so, `also`) */
    const rewriteFilm = async (next: FilmValue, label: string, also: { prop: string; value: unknown }[] = [], name = dir.split('/').pop()!.replace(/-\d+$/, '')) => {
      let made: string;
      try { ({ folder: made } = await api.writePartFilm(projectId, name, next as unknown as Film)); } catch (e) { toast.showError(e instanceof Error ? e.message : String(e)); return; }
      keepTemplateFilm(made, next);
      const err = await edit([{ op: 'props', edits: [{ clip: block.clipId!, prop: 'src', value: `${made}/film.html` }, ...also.map((x) => ({ clip: block.clipId!, ...x }))] }] as never, label);
      if (err) toast.showError(err);
    };
    const rewrite = (ops: Op[], label: string) => rewriteFilm(applyOps(film, ops as never) as FilmValue, label);
    const step = `history.stepReplaced|${block.clipId}`;
    /* a file of the project in a place (or the sound's): its edits */
    const putEdits = (id: string, file: { path: string; kind: string; durationMs?: number }) => {
      const c = clipOf(id);
      const plan = c ? replaceClip(c, lenOf(c), { ...file, path: srcInto(file.path, dir) }) : null;
      return plan && !('error' in plan) ? plan.edits.map((e) => ({ clip: id, ...e })) : [];
    };
    const put = (id: string, file: { path: string; kind: string; durationMs?: number }) => {
      const edits = putEdits(id, file);
      if (edits.length) void rewrite([{ op: 'props', edits }] as never, step);
    };
    const fileEntries = (id: string, kind: 'picture' | 'sound'): ContextMenuEntry[] => [
      ...own(kind).map((f) => ({ id: `use:${f.path}`, label: f.name, onSelect: () => put(id, f) })),
      ...(own(kind).length ? [{ id: 'sep', separator: true as const }] : []),
      { id: 'computer', label: t('template.import'), onSelect: () => { void pickReplacement(kind).then((path) => { if (path) put(id, { path, kind: kind === 'sound' ? 'audio' : PICTURE_FILE.test(path) ? 'image' : 'video' }); }); } },
    ];
    const setOverrides = (pairsOf: { clip: string; value: unknown }[], label: string) => {
      if (pairsOf.length) void rewrite([{ op: 'props', edits: pairsOf.map((x) => ({ clip: x.clip, prop: 'overrides', value: x.value })) }] as never, label);
    };
    const switchOf = (key: string) => offered.switches.find((s) => `${s.clip} ${s.prop.name}` === key);
    const pictureOf = (key: string) => offered.pictures.find((s) => `${s.clip} ${s.prop.name}` === key);
    const thumbOf = (src: string, ms = 0) => {
      const path = outer(src);
      return PICTURE_FILE.test(path) ? `${folder}${path.split('/').map(encodeURIComponent).join('/')}`
        : /\.html?$/i.test(path) ? null : `/api/projects/${encodeURIComponent(projectId)}/media?what=frame&path=${encodeURIComponent(path)}&ms=${ms}&w=200`;
    };
    const empty = offered.places.filter((s) => s.empty).map((s) => s.clip);
    const placeFiles = (paths: string[], ids: string[]) => ids.flatMap((id, i) => {
      const path = paths[i];
      if (!path) return [];
      const f = listing?.files.find((x) => x.path === path);
      return putEdits(id, { path, kind: f?.kind ?? (PICTURE_FILE.test(path) ? 'image' : 'video'), ...(f?.durationMs ? { durationMs: f.durationMs } : {}) });
    });
    return {
      instance: { mark: dir, id: templateOfFolder(dir), clips: film.tracks.flatMap((tr) => tr.clips.map((c) => c.id)), slots: offered.places, words: offered.words },
      name: item ? nameOf(item.name, language) : dir,
      slotOf: (id) => { const c = clipOf(id); return { durMs: c ? lenOf(c) : 0, thumb: c ? thumbOf(c.src, Math.round((c.time?.[0] ?? 0) * 1000)) : null }; },
      pickEntries: (id) => fileEntries(id, 'picture'),
      put: (id, file) => put(id, file),
      fill: own('picture').length && empty.length ? () => {
        const used = new Set(filmRef.current?.tracks.flatMap((tr) => tr.clips.map((c) => c.src.split('#')[0]!)) ?? []);
        const picks = fillFor(empty.length, own('picture'), used);
        const edits = placeFiles(picks.map((f) => f.path), empty);
        if (edits.length) void rewrite([{ op: 'props', edits }] as never, step);
      } : null,
      pickMany: () => setTemplateAsk({
        name: item ? nameOf(item.name, language) : dir,
        slots: offered.places.map((s) => { const c = clipOf(s.clip); return c ? lenOf(c) : 0; }),
        use: (paths) => { const edits = placeFiles(paths, offered.places.map((s) => s.clip)); if (edits.length) void rewrite([{ op: 'props', edits }] as never, step); },
      }),
      setWord: (w, text) => { const c = clipOf(w.clip); if (c) setOverrides([{ clip: w.clip, value: withText(c.overrides as never, w.at, w.n, text) }], 'history.stepEdit'); },
      pageUrl: (id) => { const c = clipOf(id); return c && folder ? `${folder}${outer(c.src)}` : null; },
      pickAll: null,
      looks: offered.looks.map((l) => { const c = clipOf(l.clips[0]!); return { key: `${l.var} ${l.name}`, name: l.name, var: l.var, value: l.value, page: c && folder ? `${folder}${outer(c.src)}` : null }; }),
      setLook: (key, value) => {
        const look = offered.looks.find((l) => `${l.var} ${l.name}` === key);
        if (look) setOverrides(look.clips.flatMap((id) => { const c = clipOf(id); return c ? [{ clip: id, value: withVar(c.overrides as never, look.var, value) }] : []; }), 'history.stepStyle');
      },
      switches: offered.switches.map((s) => ({ key: `${s.clip} ${s.prop.name}`, name: s.prop.name, on: s.on })),
      setSwitch: (key, on) => { const s = switchOf(key); const c = s ? clipOf(s.clip) : null; if (s && c) setOverrides([{ clip: s.clip, value: withPropValue(c.overrides as never, s.prop, on ? null : false) }], 'history.stepStyle'); },
      pictures: offered.pictures.map((s) => {
        const c = clipOf(s.clip);
        const page = c ? outer(c.src) : '';
        const at = s.value ? new URL(s.value, `http://x/${page}`).pathname.slice(1) : null;
        return { key: `${s.clip} ${s.prop.name}`, name: s.prop.name, thumb: at && folder ? `${folder}${at}` : null };
      }),
      pictureEntries: (key) => {
        const s = pictureOf(key);
        const c = s ? clipOf(s.clip) : null;
        if (!s || !c) return [];
        const set = (path: string) => setOverrides([{ clip: s.clip, value: withPropValue(c.overrides as never, s.prop, relativeTo(outer(c.src), path)) }], 'history.stepEdit');
        return [
          ...own('picture').filter((f) => f.kind === 'image').map((f) => ({ id: `use:${f.path}`, label: f.name, onSelect: () => set(f.path) })),
          { id: 'computer', label: t('template.import'), onSelect: () => { void pickReplacement('picture').then((path) => { if (path) set(path); }); } },
        ];
      },
      frameOf: (id) => {
        const c = clipOf(id);
        if (!c) return null;
        const path = outer(c.src);
        const video = !PICTURE_FILE.test(path) && !/\.html?$/i.test(path);
        const dur = listing?.files.find((f) => f.path === path)?.durationMs;
        return { frame: placeFrame(typeof c.style === 'string' ? c.style : undefined), inSec: video ? c.time?.[0] ?? 0 : null, maxIn: video && dur ? Math.max(0, dur / 1000 - lenOf(c) / 1000) : 0 };
      },
      setFrame: (id, frame) => { const c = clipOf(id); if (c) void rewrite([{ op: 'props', edits: [{ clip: id, prop: 'style', value: withPlaceFrame(typeof c.style === 'string' ? c.style : undefined, frame) }] }] as never, 'history.stepStyle'); },
      setIn: (id, sec) => { const c = clipOf(id); if (c) void rewrite([{ op: 'props', edits: [{ clip: id, prop: 'time', value: [Math.round(sec * 1000) / 1000, Math.round((sec + lenOf(c) / 1000) * 1000) / 1000] }] }] as never, 'history.stepStyle'); },
      setLooks: (values) => {
        const edits = new Map<string, unknown>();
        for (const [key, value] of values) {
          const look = offered.looks.find((l) => `${l.var} ${l.name}` === key);
          for (const id of look?.clips ?? []) {
            const had = edits.get(id) ?? clipOf(id)?.overrides;
            edits.set(id, withVar(had as never, look!.var, value));
          }
        }
        setOverrides([...edits].map(([clip, value]) => ({ clip, value })), 'history.stepStyle');
      },
      length: filmLength(film.tracks as never),
      setLength: (sec) => { void rewriteFilm(retimedTemplate(film as never, sec) as FilmValue, 'history.stepStyle', [{ prop: 'time', value: [0, Math.round(sec * 1000) / 1000] }]); },
      swapOptions: (templateItemsRef.current ?? []).map((i) => ({ id: i.id, name: nameOf(i.name, language) })),
      swapTo: (id) => {
        const next = builtInItem(`${BUILT_IN}/${id}`);
        if (next) void (async () => {
          const made = await buildTemplateFilm(next);
          if (!made) return;
          /* the person's own clips into its places in order, and the words they changed into its words in order */
          const mine = offered.places.filter((p) => !p.empty).map((p) => clipOf(p.clip)!).filter(Boolean);
          const into = filmTemplate(made.film.tracks as never);
          const innerOf = (id2: string) => made.film.tracks.flatMap((tr) => tr.clips).find((c) => c.id === id2) as unknown as Clip;
          const edits: { clip: string; prop: string; value: unknown }[] = [];
          into.places.forEach((p, i) => {
            const from = mine[i];
            if (!from) return;
            const path = outer(from.src);
            const f = listing?.files.find((x) => x.path === path);
            const c = innerOf(p.clip);
            const plan = replaceClip(c, lenOf(c), { path: srcInto(path, `${PARTS}/${made.name}`), kind: f?.kind ?? (PICTURE_FILE.test(path) ? 'image' : 'video'), ...(f?.durationMs ? { durationMs: f.durationMs } : {}) });
            if (!('error' in plan)) edits.push(...plan.edits.map((e) => ({ clip: p.clip, ...e })));
          });
          /* the words the person wrote: not those the template has of its own (its saved.json's) */
          const own = new Map<string, string>();
          try {
            const was = (await (await fetch(libraryUrl(`${templateOfFolder(dir)}/saved.json`))).json()) as { clips?: { clip: { src?: string; overrides?: { at?: string; n?: number; text?: string }[] } }[] };
            for (const c of was.clips ?? []) for (const o of c.clip.overrides ?? []) if (typeof o.text === 'string') own.set(`${(c.clip.src ?? '').split('/').pop()} ${o.at} ${o.n ?? ''}`, o.text);
          } catch { /* none known: every word set is the person's */ }
          const said = offered.words.filter((w) => w.text != null && own.get(`${(clipOf(w.clip)?.src ?? '').split('#')[0]!.split('/').pop()} ${w.at} ${w.n ?? ''}`) !== w.text);
          into.words.forEach((w, i) => {
            const was = said[i];
            if (was) edits.push({ clip: w.clip, prop: 'overrides', value: withText(innerOf(w.clip).overrides as never, w.at, w.n, was.text) });
          });
          const film2 = edits.length ? applyOps(made.film, [{ op: 'props', edits }] as never) as FilmValue : made.film;
          await rewriteFilm(film2, 'history.stepEdit', [{ prop: 'time', value: [0, made.length] }], made.name);
        })();
      },
      sounds: offered.sounds.map((s) => ({ key: s.clip, name: outer(s.src).split('/').pop() ?? s.src })),
      soundEntries: (key) => [
        ...fileEntries(key, 'sound'),
        { id: 'sep-off', separator: true as const },
        { id: 'remove', label: t('timeline.menuDelete'), danger: true, onSelect: () => { void rewrite([{ op: 'remove', clip: key }] as never, 'history.stepRemove'); } },
      ],
    };
  }, [listing, language, projectId, edit, toast, folder, t, pickReplacement, buildTemplateFilm]);
  /*
   * A template's clip made longer or shorter on the timeline (its `start` / `end`): its film retimed to that length
   * (lib/template-instance retimedTemplate: its places stretch, its opening and its end keep their time) and written
   * in a folder of its own, the clip shown from there from its start, in the same edit.
   */
  retimeRef.current = async (ops) => {
    const out: Op[] = [];
    for (const op of ops) {
      if (op.op !== 'props') { out.push(op); continue; }
      const edits = [...(op as { edits: { clip: string; prop: string; value: unknown }[] }).edits];
      for (const id of new Set(edits.filter((e) => e.prop === 'start' || e.prop === 'end').map((e) => e.clip))) {
        const clip = filmRef.current?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === id);
        const dir = templateFolderOf(clip?.src);
        if (!clip || !dir) continue;
        const film = await loadTemplateFilm(dir).catch(() => null);
        if (!film) continue;
        const was = filmLength(film.tracks as never);
        const time = (clip as { time?: number[] }).time ?? [0, was];
        const startE = edits.find((e) => e.clip === id && e.prop === 'start');
        const endE = edits.find((e) => e.clip === id && e.prop === 'end');
        const from = startE ? Number(startE.value ?? 0) : time[0] ?? 0;
        const to = endE ? Number(endE.value ?? was) : time[1] ?? was;
        const len = Math.round((to - from) * 1000) / 1000;
        if (!(len > 0.2) || Math.abs(len - was) < 0.01) continue;
        let made: string;
        try { ({ folder: made } = await api.writePartFilm(projectId, dir.split('/').pop()!.replace(/-\d+$/, ''), retimedTemplate(film as never, len) as unknown as Film)); } catch { continue; }
        keepTemplateFilm(made, retimedTemplate(film as never, len));
        for (let i = edits.length - 1; i >= 0; i--) if (edits[i]!.clip === id && (edits[i]!.prop === 'start' || edits[i]!.prop === 'end')) edits.splice(i, 1);
        edits.push({ clip: id, prop: 'src', value: `${made}/film.html` }, { clip: id, prop: 'start', value: 0 }, { clip: id, prop: 'end', value: len });
      }
      out.push({ ...op, edits } as Op);
    }
    return out;
  };
  /* a file dropped on a template's clip on the timeline: in the place playing where it was dropped (else the nearest) */
  const dropOnTemplate = React.useCallback(async (block: TimelineBlock, file: ResourceDragItem, atMs: number) => {
    const dir = templateFolderOf(block.src);
    if (!dir) return;
    const film = await loadTemplateFilm(dir).catch(() => null);
    if (!film) return;
    const at = (atMs - block.startMs) / 1000 + (block.inMs ?? 0) / 1000;
    const places = filmTemplate(film.tracks as never).places.map((s) => film.tracks.flatMap((tr) => tr.clips).find((c) => c.id === s.clip)!) as unknown as { id: string; at?: number; time?: readonly number[] }[];
    const span = (c: { at?: number; time?: readonly number[] }) => [c.at ?? 0, (c.at ?? 0) + ((c.time?.[1] ?? 0) - (c.time?.[0] ?? 0))] as const;
    const here = places.find((c) => { const [a, b] = span(c); return at >= a && at < b; })
      ?? [...places].sort((p, q) => Math.abs(span(p)[0] - at) - Math.abs(span(q)[0] - at))[0];
    if (here) templateFilmHost(block, dir, film).put(here.id, file);
  }, [loadTemplateFilm, templateFilmHost]);
  /* a template of the library the picked clip belongs to: its places for pictures, its words, picked whole
     (TemplateSection, lib/template-instance) */
  const templateSection = React.useCallback((blocks: readonly TimelineBlock[]): React.ReactNode => {
    /* put in as one compound clip: its film's */
    const one = blocks.length === 1 ? blocks[0]! : null;
    const dir = one ? templateFolderOf(one.src) : null;
    if (one && dir) return <TemplateFilmSection key={dir} folder={dir} load={loadTemplateFilm} hostOf={(film) => templateFilmHost(one, dir, film)} />;
    const value = filmRef.current;
    const first = blocks[0]?.clipId;
    const instance = first && value ? templateOf(value.tracks, first) : null;
    /* one of its clips, or several all its own */
    if (!instance || !value || !blocks.every((b) => b.clipId && instance.clips.includes(b.clipId))) return null;
    const item = builtInItem(`${BUILT_IN}/${instance.id}`);
    const blockOf = (id: string) => blocksRef.current.find((b) => b.clipId === id);
    const clipOf = (id: string) => value.tracks.flatMap((tr) => tr.clips).find((c) => c.id === id);
    const pictures = (listing?.files ?? []).filter((f) => (f.kind === 'video' || f.kind === 'image') && !fromLibrary(f.path));
    const host: TemplateHost = {
      instance,
      name: item ? nameOf(item.name, language) : instance.mark,
      slotOf: (id) => {
        const b = blockOf(id);
        const src = clipOf(id)?.src;
        const path = src && !isSlotSrc(src) ? src.split('#')[0]! : null;
        /* a picture as itself, a video its frame where the place starts it */
        const thumb = !path ? null : PICTURE_FILE.test(path) ? `${folder}${path.split('/').map(encodeURIComponent).join('/')}`
          : `/api/projects/${encodeURIComponent(projectId)}/media?what=frame&path=${encodeURIComponent(path)}&ms=${Math.round(b?.inMs ?? 0)}&w=200`;
        return { durMs: b ? b.endMs - b.startMs : 0, thumb };
      },
      /* a place takes the person's own videos and pictures (or one from this computer), not pages */
      pickEntries: (id) => {
        const b = blockOf(id);
        const own = new Set(pictures.map((f) => `replace:${f.path}`));
        const entries = b ? tools.replaceEntries(b).filter((e) => !e.id.startsWith('replace:') || own.has(e.id)) : [];
        return entries[0] && 'separator' in entries[0] ? entries.slice(1) : entries;
      },
      put: (id, file) => { const b = blockOf(id); if (b) tools.timeline.onReplaceDrop(b, file); },
      fill: pictures.length ? () => {
        const empty = instance.slots.filter((s) => s.empty).map((s) => s.clip);
        const used = new Set(value.tracks.flatMap((tr) => tr.clips.map((c) => c.src.split('#')[0]!)));
        const picks = fillFor(empty.length, pictures, used);
        const edits = picks.flatMap((file, i) => {
          const clip = clipOf(empty[i]!);
          const b = blockOf(empty[i]!);
          const plan = clip && b ? replaceClip(clip, b.endMs - b.startMs, file) : null;
          return plan && !('error' in plan) ? plan.edits.map((e) => ({ clip: clip!.id, ...e })) : [];
        });
        if (edits.length) void edit([{ op: 'props', edits }], `history.stepReplaced|${empty[0]}`).then((err) => { if (err) toast.showError(err); });
      } : null,
      setWord: (w, text) => {
        const b = blockOf(w.clip);
        const clip = clipOf(w.clip);
        if (b?.loc && clip) void editBlocks([{ loc: b.loc, prop: 'overrides', value: withText(clip.overrides as never, w.at, w.n, text) as never }]);
      },
      pageUrl: (id) => { const src = clipOf(id)?.src; return src && folder ? `${folder}${src.split('#')[0]}` : null; },
      pickAll: blocks.length < instance.clips.length ? () => { setStageElement(null); setSelectedKeys(instance.clips); } : null,
    };
    return <TemplateSection host={host} />;
  }, [listing, language, projectId, tools, edit, editBlocks, toast, folder, loadTemplateFilm, templateFilmHost]);
  /* a clip's animation (ClipMotionSection, lib/clip-presets): one of the library's motions in its In, Out or Loop, drawn
     on the clip's own picture, written into its style with the motion's keyframes and played once put on */
  const motionSection = React.useCallback((block: TimelineBlock): React.ReactNode => {
    const clip = block.clipId ? filmClipOf(block.clipId) : null;
    if (!clip || !block.src || !takesMotion(block)) return null;
    const path = block.src.split('#')[0]!;
    const api = `/api/projects/${encodeURIComponent(projectId)}/media`;
    /* a picture as itself; a video its frame a moment in; a page its poster */
    const picture = PICTURE_FILE.test(path) ? `${folder}${path.split('/').map(encodeURIComponent).join('/')}`
      : block.kind === 'video' ? `${api}?what=frame&path=${encodeURIComponent(path)}&ms=${Math.round((block.inMs ?? 0) + Math.min(1000, (block.endMs - block.startMs) / 2))}&w=240`
        : `${api}?what=poster&path=${encodeURIComponent(path)}`;
    const style = typeof clip.style === 'string' ? clip.style : undefined;
    const host: ClipMotionHost = {
      picture,
      cover: block.kind === 'video',
      on: presetsOn(style),
      lengthSecs: (block.endMs - block.startMs) / 1000,
      put: (slot: PresetSlot, preset: Preset | null) => {
        const ops = [
          ...(preset ? [{ op: 'keyframes', set: { [preset.name]: preset.body } }] : []),
          { op: 'props', edits: [{ clip: clip.id, prop: 'style', value: withPreset(style, slot, preset) || null }] },
        ];
        void edit(ops as never, 'history.stepMotion').then((err) => {
          if (err) toast.showError(err);
          else if (preset) playClipMotion(clip.id, slot, preset.secs);
        });
      },
    };
    return <ClipMotionSection key={clip.id} host={host} />;
  }, [filmClipOf, projectId, folder, edit, toast, playClipMotion]);

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
  /* the viewer's zoom: only the picture and its fit button re-render as it changes (components/ViewerZoom) */
  const viewerZoom = React.useMemo(() => createViewerZoom(), []);
  /* the layers selected together on the picture (its geometry's group), by name: the Layers panel shows each of them,
     and is drawn again when they change, not with every frame they are dragged */
  const groupKey = React.useSyncExternalStore(geometryStore.subscribe, () => groupLayersKey(geometryStore.get()));
  const [stageSelectRequest, setStageSelectRequest] = React.useState<FilmStageSelectRequest | null>(null);
  const [inlineTextFailure, setInlineTextFailure] = React.useState<{ loc: string; value: string; failure: StageEditFailure; seq: number } | null>(null);
  const setSelectedLocs = React.useCallback((locs: readonly string[], toggle = false) => {
    const want = new Set(locs);
    const keys = blocksRef.current.filter((b) => b.loc && want.has(b.loc)).map((b) => b.clipId ?? b.id);
    setSelectedKeys((current) => toggle ? [...current.filter((key) => !keys.includes(key)), ...keys.filter((key) => !current.includes(key))] : keys);
  }, []);
  /* the picture and the timeline share one selection of clips; a layer picked in the picture drops the timeline's */
  const selectStageElement = React.useCallback((element: StageElement | null, rowClipLocs?: readonly string[]) => {
    setStageElement(element);
    if (element) setInspectorContent('selection');
    if (element && element.kind !== 'clip') setInspectorOpen(true);
    if (rowClipLocs) {
      const cues = rowClipLocs.flatMap((loc) => { const cue = cueOf(loc); return cue ? [cue] : []; });
      const src = cues[0]?.src;
      const next = src && cues.every((c) => c.src === src) ? { src, ids: new Set(cues.map((c) => c.id)) } : null;
      const now = captionSelectionNow();
      if (next?.src !== now?.src || next?.ids.size !== now?.ids.size || [...(next?.ids ?? [])].some((id) => !now?.ids.has(id))) {
        fromTimeline.current = true;
        setCaptionSelection(next);
      }
      if (next && cues.length === rowClipLocs.length && !element) showCaptionLook();
      setSelectedLocs(rowClipLocs);
      return;
    }
    setSelectedLocs(element?.kind === 'clip' && element.clipLoc ? [element.clipLoc] : []);
  }, [setSelectedLocs, showCaptionLook]);

  /* ── the app Studio is embedded in (lib/host.ts): what the person points at, handed to it; what it asks to be shown ── */
  /* the library's templates, for one to take another's place (TemplateSection) */
  const templateItemsRef = React.useRef<LibraryItem[]>([]);
  templateItemsRef.current = (libraryIndex?.items ?? []).filter((i) => i.cat === 'template' && i.kind === 'group');
  /* the range marked on the timeline (⇧-drag on the ruler, I and O): Studio's, told to the app with the selection */
  const [markedRange, setMarkedRange] = React.useState<FilmRange | null>(null);
  /* Clicking a range in chat briefly points it out, separately from the editing selection. */
  const [flashRange, setFlashRange] = React.useState<FilmRange | null>(null);
  React.useEffect(() => {
    if (!flashRange) return;
    const timer = setTimeout(() => setFlashRange(null), 1200);
    return () => clearTimeout(timer);
  }, [flashRange]);
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
  /* the caption cues picked (on their track's row, or on the picture): each a reference as a subtitle line is */
  const captionPick = useCaptionSelection();
  const pickedCaptionRefs = (): StudioRef[] => {
    const sel = captionSelectionNow();
    const vtt = sel ? captionTrackNow(projectId, sel.src) : null;
    if (!sel || !vtt) return [];
    return vtt.cues.flatMap((c, i) => (sel.ids.has(c.id)
      ? [subtitleRef(projectId, { startMs: Math.round(c.start * 1000), durMs: Math.round((c.end - c.start) * 1000), text: cuePlain(c.text).trim() }, { index: i + 1 })]
      : []));
  };
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
   * What ⌘L references: the caption cues picked, else the layer picked in the picture (each of several), else each
   * clip selected and the range, else the moment.
   */
  const selectedRefs = (): StudioRef[] => {
    const lines = pickedCaptionRefs();
    if (lines.length) return lines;
    const el = stageElementRef.current;
    if (layerPicked(el)) return [refOfLayer(el)];
    const layers = stageControl.current?.picked() ?? [];
    if (layers.length > 1) return layers.flatMap((p) => refOfStagePick(p) ?? []);
    const refs = selectedClips.map(refOfBlock);
    if (markedRange) refs.push(rangeRef(projectId, markedRange, blocksRef.current));
    if (refs.length) return refs;
    return [momentRef(projectId, timeRef.current)];
  };
  const hostSelection = chat.select;
  React.useEffect(() => {
    if (!hostSelection) return undefined;
    const timer = setTimeout(() => {
      const refs: StudioRef[] = selectedClips.map(refOfBlock);
      if (layerPicked(stageElement)) refs.push(refOfLayer(stageElement));
      refs.push(...pickedCaptionRefs());
      hostSelection({ projectId, time: Math.round(timeMs) / 1000, refs, range: markedRange ? { start: Math.round(markedRange.startMs) / 1000, end: Math.round(markedRange.endMs) / 1000 } : null, stage: stageRef.current });
    }, 80);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostSelection, projectId, timeMs, selectedClips, stageElement, markedRange, captionPick]);
  /* a box the app shows on the picture (show-box), flashed there */
  const [flashBox, setFlashBox] = React.useState<{ box: StageBox; seq: number } | null>(null);
  /* what the app's chat points at (lib/chat-marks): the pill hovered there, the references of the message being written */
  const [chatRef, setChatRef] = React.useState<StudioRef | null>(null);
  const [draftMarks, setDraftMarks] = React.useState<DraftMarks>(NO_DRAFT);
  const hostCommands = React.useRef<(command: StudioCommand) => void>(() => {});
  hostCommands.current = (command) => {
    if (command.type === 'highlight') { setChatRef(command.ref ?? null); return; }
    if (command.type === 'draft-refs') { setDraftMarks(draftMarksOf(Array.isArray(command.refs) ? command.refs : [])); return; }
    if (command.type === 'seek' && Number.isFinite(command.time)) { pause(); seek(command.time * 1000); return; }
    if ((command.type === 'show-range' || command.type === 'show-subtitle') && Number.isFinite(command.start) && Number.isFinite(command.end)) {
      /* a subtitle's span marked, the playhead at its start */
      const startMs = Math.max(0, Math.min(command.start, command.end) * 1000);
      const endMs = Math.max(command.start, command.end) * 1000;
      if (command.type === 'show-range') {
        if (endMs > startMs) setFlashRange({ startMs, endMs });
        pause();
        seek(startMs);
        return;
      }
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
    if (command.type !== 'select-clip') return;
    const block = blocksRef.current.find((b) => (command.id && b.clipId === command.id) || (command.loc && b.loc === command.loc));
    if (!block) return;
    setStageElement(null);
    setSelectedKeys([block.clipId ?? block.id]);
    if (command.seek) { pause(); seek(block.startMs); }
  };
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
  const hostHover = chat.hover;
  const hoverBlock = React.useCallback((b: TimelineBlock | null) => hostHover?.(b ? refOfBlock(b) : null), [hostHover]); // eslint-disable-line react-hooks/exhaustive-deps
  const hoverLayer = React.useCallback((hit: { element: StageElement; box: StageBox } | null) => {
    hostHover?.(hit ? layerRef(hit.element, { projectId: refSource.current.projectId, ms: timeRef.current, box: hit.box, stage: stageRef.current }) : null);
  }, [hostHover]);
  React.useEffect(() => () => hostHover?.(null), [hostHover]);

  const editStageOverride = React.useCallback(async (
    element: StageElement, rawPatch: OverrideGeometry | null, allCopies = false, pivot?: OverridePivot,
  ): Promise<string | null> => {
    const patch = rawPatch && pivot && stageControl.current ? await stageControl.current.previewOverride(element, rawPatch, pivot) : rawPatch;
    /* the blocks written inside a line keep their place and look: their overrides go with it, one edit */
    const riders = await stageControl.current?.riders(element, patch) ?? [];
    /* the film read after the last wait and written with nothing between: an edit made meanwhile is in it, and kept */
    const doc = filmRef.current as unknown as FilmDoc | null;
    const found = doc ? pageClipOf(doc, element) : null;
    const target = layerTarget(element, allCopies);
    if (!found || !target) return t('timeline.editFail');
    let next = nextOverrides(found.clip.overrides, target, patch);
    for (const r of riders) next = nextOverrides(next ?? undefined, { at: r.at, ...(r.n != null ? { n: r.n } : {}) }, r.patch);
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
          if (fresh) setStageElement((el) => (el?.loc === element.loc ? { ...el, style: fresh.style, ...(fresh.picture ? { picture: fresh.picture } : {}) } : el));
        });
      }, 120);
    }
    return failed;
  }, [editBlocks, t]);
  const editStageOverrideRef = React.useRef(editStageOverride);
  editStageOverrideRef.current = editStageOverride;
  /* several layers at once (moved, hidden, aligned together): one write, one undo step */
  const editStageOverrides = React.useCallback(async (list: ReadonlyArray<{ element: StageElement; patch: OverrideGeometry | null }>): Promise<string | null> => {
    const riders: Awaited<ReturnType<FilmStageControl['riders']>>[] = [];
    for (const { element, patch } of list) riders.push(await stageControl.current?.riders(element, patch) ?? []);
    /* read after the waits, as for one layer (editStageOverride) */
    const doc = filmRef.current as unknown as FilmDoc | null;
    if (!doc || !list.length) return t('timeline.editFail');
    const byClip = new Map<string, ReturnType<typeof nextOverrides>>();
    for (const [i, { element, patch }] of list.entries()) {
      const found = pageClipOf(doc, element);
      const target = layerTarget(element);
      if (!found || !target) continue;
      const prev = byClip.has(found.loc) ? byClip.get(found.loc) ?? undefined : found.clip.overrides;
      let next = nextOverrides(prev, target, patch);
      for (const r of riders[i]!) next = nextOverrides(next ?? undefined, { at: r.at, ...(r.n != null ? { n: r.n } : {}) }, r.patch);
      byClip.set(found.loc, next);
    }
    if (!byClip.size) return t('timeline.editFail');
    return editBlocks([...byClip].map(([loc, value]) => ({ loc, prop: 'overrides', value: value as unknown as Record<string, unknown> | null })));
  }, [editBlocks, t]);
  /* layers deleted (lib/layer-delete): in each clip a `display: none` entry for each, and every change or property
     that pointed only at them, or inside them, gone too (the stage tells which); one write, one undo step */
  const deleteLayers = React.useCallback(async (elements: readonly StageElement[]): Promise<string | null> => {
    type Clip = NonNullable<ReturnType<typeof pageClipOf>>['clip'];
    /* the layers by the clip they are in (its place in film.html) */
    const byClip = (doc: FilmDoc) => {
      const out = new Map<string, { clip: Clip; targets: OverrideTarget[] }>();
      for (const element of elements) {
        const found = pageClipOf(doc, element);
        const target = layerTarget(element);
        if (!found || !target) continue;
        const entry = out.get(found.loc) ?? { clip: found.clip, targets: [] };
        entry.targets.push(target);
        out.set(found.loc, entry);
      }
      return out;
    };
    const keyOf = (at: OverrideTarget) => JSON.stringify([at.at, at.n ?? null]);
    const asked = filmRef.current ? byClip(filmRef.current as unknown as FilmDoc) : null;
    if (!asked?.size) return t('timeline.editFail');
    /* per clip, where its changes and properties point that is only at the deleted layers or inside them */
    const gone = new Map<string, Set<string>>();
    for (const { clip, targets } of asked.values()) {
      const pointers = pointersOf(clip.overrides, propsOf(clip));
      const all = [...pointers.overrides, ...pointers.props].filter((at): at is OverrideTarget => at != null);
      const answer = await preview.current?.stage?.<boolean[]>('within', { clip: clip.id, of: targets, targets: all }) ?? [];
      gone.set(clip.id, new Set(all.filter((_, i) => answer[i] === true).map(keyOf)));
    }
    /* the film read again after asking: an edit kept meanwhile is not written over */
    const doc = filmRef.current as unknown as FilmDoc | null;
    const now = doc ? byClip(doc) : null;
    if (!now?.size) return t('timeline.editFail');
    const edits: ClipEdit[] = [];
    for (const [loc, { clip, targets }] of now) {
      const out = gone.get(clip.id) ?? new Set<string>();
      const isGone = (at: OverrideTarget | null) => Boolean(at && out.has(keyOf(at)));
      const props = propsOf(clip);
      const pointers = pointersOf(clip.overrides, props);
      const overrides = withDeleted(clip.overrides, targets, pointers.overrides.map(isGone));
      edits.push({ loc, prop: 'overrides', value: overrides as unknown as Record<string, unknown> | null });
      const kept = propsWithoutDeleted(props, pointers.props.map(isGone));
      if (kept.length !== props.length) edits.push({ loc, prop: 'props', value: propsAttr(kept) });
    }
    const failed = await editBlocks(edits);
    /* refused (a locked track), what is in hand stays in hand */
    if (!failed) {
      setStageElement((el) => (el && elements.some((x) => x.loc === el.loc && x.clipId === el.clipId) ? null : el));
      stageControl.current?.letGo(elements);
    }
    return failed;
  }, [editBlocks, t]);
  const editStageStyle = React.useCallback(async (loc: string, patch: StageElementStyle): Promise<string | null> => {
    const held = stageElementRef.current;
    if (!held?.clipLoc) return t('timeline.editFail');
    const clean: Record<string, string | number | null> = {};
    for (const [key, v] of Object.entries(patch)) clean[key] = v ?? null;
    /* kept with what holds the other layers where they are (a wider font would push the words beside it on) */
    const hold = await stageControl.current?.holdStyle(held, clean) ?? {};
    const message = await editStageOverrideRef.current(held, { style: { ...clean, ...hold } } as OverrideGeometry);
    if (!message) setStageElement((cur) => (cur && (cur.loc === loc || cur.loc?.split('#')[0] === loc) ? { ...cur, style: { ...cur.style, ...patch } } : cur));
    return message;
  }, [t]);
  /* "All like it": the style for every layer of its tag and classes, in each page clip that may have one
     (lib/similar-layers), read from the pages' own files */
  const similarClips = React.useCallback(async (element: StageElement): Promise<{ doc: FilmDoc; holds: Set<string> } | null> => {
    const doc = filmRef.current as unknown as FilmDoc | null;
    if (!doc || !element.similar) return null;
    const srcs = [...new Set(pageClips(doc).map((c) => c.src))];
    const sources = await Promise.all(srcs.map((src) => fetch(`${folder}${src.split('/').map(encodeURIComponent).join('/')}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : ''), () => '')));
    return { doc, holds: new Set(srcs.filter((_, i) => pageMayHave(sources[i]!, element.similar!))) };
  }, [folder]);
  const countSimilar = React.useCallback(async (element: StageElement): Promise<number> => {
    const found = await similarClips(element);
    const own = found ? pageClipOf(found.doc, element)?.loc : undefined;
    return found ? pageClips(found.doc).filter((c) => c.loc === own || found.holds.has(c.src)).length : 0;
  }, [similarClips]);
  const editStageStyleSimilar = React.useCallback(async (element: StageElement, patch: StageElementStyle): Promise<string | null> => {
    const found = await similarClips(element);
    const own = found ? pageClipOf(found.doc, element) : null;
    if (!found || !own || !element.similar) return t('timeline.editFail');
    const clean: Record<string, string | number | null> = {};
    for (const [key, v] of Object.entries(patch)) clean[key] = v ?? null;
    const edits = similarEdits(found.doc, element.similar, clean, (src) => found.holds.has(src), own.loc);
    const message = await editBlocks(edits.map((e) => ({ loc: e.loc, prop: 'overrides', value: e.value as unknown as Record<string, unknown> | null })));
    if (!message) setStageElement((cur) => (cur && cur.loc === element.loc ? { ...cur, style: { ...cur.style, ...patch } } : cur));
    return message;
  }, [similarClips, editBlocks, t]);
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
  /* kept with what holds the other layers where they are (more words would push those beside them on): `hold`, worked
     out as the words were typed in place, else asked for now */
  const editStageText = React.useCallback(async (e: StageTextEdit, on?: StageElement, typedHold?: Record<string, string | null>): Promise<StageEditFailure | null> => {
    const held = on ?? stageElementRef.current;
    if (!held?.clipLoc) return { error: t('timeline.editFail') };
    const hold = typedHold ?? await stageControl.current?.holdStyle(held, {}, e.value) ?? {};
    stageControl.current?.previewText(held, e.value);
    const failed = await editStageOverrideRef.current(held, { text: e.value, ...(Object.keys(hold).length ? { style: hold } : {}) } as OverrideGeometry);
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
  const editStageTextInline = React.useCallback(async (element: StageElement, v: string, hold?: Record<string, string | null>) => {
    const text = element.text;
    if (!text) return t('timeline.editFail');
    const failed = await editStageText({ loc: text.loc, value: v, expect: text.value }, element, hold ?? {});
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
  /* layers selected on the picture from here (several: together); `toggle`, each added or taken away, as a Shift-click */
  const selectStageLayers = React.useCallback((layers: FilmStageSelectRequest['layers'], toggle = false) => {
    setStageSelectRequest((cur) => ({ layers, ...(toggle ? { toggle } : {}), seq: (cur?.seq ?? 0) + 1 }));
  }, []);
  const selectStageParent = React.useCallback((loc: string, clipLoc?: string) => {
    selectStageLayers([{ loc, ...(clipLoc ? { clipLoc } : {}) }]);
  }, [selectStageLayers]);
  const selectStageClip = React.useCallback((clipLoc: string, toggle = false) => {
    /* a caption's row in Layers: its cue picked, as a click on it on the picture does */
    const cue = cueOf(clipLoc);
    if (cue) { setCaptionSelection({ src: cue.src, ids: new Set([cue.id]) }); showCaptionLook(); return; }
    setStageElement(null);
    setSelectedLocs([clipLoc], toggle);
  }, [setSelectedLocs, showCaptionLook]);
  /* a marquee on the picture around several clips: the timeline selects them */
  const selectStageClips = React.useCallback((locs: readonly string[]) => { setStageElement(null); setSelectedLocs([...locs]); }, [setSelectedLocs]);
  /* ── the Layers panel: its rows select on the picture, outline there, hide, lock and restack (overrides) ── */
  const [pointedLayer, setPointedLayer] = React.useState<{ clipId: string; loc: string } | null>(null);
  /* its rows selected: each layer of a group in hand, else the one layer */
  const layersSelected = React.useMemo((): { clipId?: string; loc: string | null }[] => {
    if (groupKey) return (JSON.parse(groupKey) as [string, string | null][]).map(([clipId, loc]) => ({ clipId, loc }));
    return stageElement && stageElement.kind !== 'clip' ? [{ ...(stageElement.clipId ? { clipId: stageElement.clipId } : {}), loc: stageElement.loc }] : [];
  }, [groupKey, stageElement]);
  /* the captions shown at the playhead, which the picture's stage does not list: each by its caption track's place */
  const layerCaptions = React.useMemo(() => timelineTracks.flatMap((tr) => (tr.captions && !tr.hidden && tr.docIndex != null
    ? tr.blocks.flatMap((b) => (b.cue && b.clipId && b.startMs <= timeMs && timeMs < b.endMs
      ? [{ clip: b.clipId, track: tr.docIndex!, selected: Boolean(cuePick?.src === b.cue.src && cuePick.ids.has(b.cue.id)) }] : []))
    : [])), [timelineTracks, timeMs, cuePick]);
  const askStage = React.useCallback(<T,>(op: string, args: object = {}): Promise<T | null> => (
    preview.current?.stage?.<T>(op, args) ?? Promise.resolve(null)
  ), []);
  const layerClipOf = React.useCallback((clipId: string) => {
    const b = blocksRef.current.find((x) => x.clipId === clipId);
    /* a thing of the library: one row, as it is one thing on the picture */
    /* a thing of the library by its name there (every emoji's page is emoji.html) */
    const item = b ? libraryItemOfClip(b.src) : null;
    return b ? {
      label: item ? nameOf(item.name, language) : b.title, kind: b.kind, ...(b.loc ? { loc: b.loc } : {}), ...(b.src ? { src: b.src } : {}),
      ...(isLibraryClip(b.src) ? { whole: true } : {}), ...(b.words != null ? { words: true } : {}),
    } : null;
  }, [language]);
  const selectLayerRows = React.useCallback((rows: readonly LayerSelection[]) => {
    const layers: FilmStageSelectRequest['layers'][number][] = [];
    const clipLocs: string[] = [];
    for (const { clipId, loc } of rows) {
      const clipLoc = blocksRef.current.find((b) => b.clipId === clipId)?.loc;
      if (!clipLoc) continue;
      if (loc == null) clipLocs.push(clipLoc);
      else layers.push({ loc, clipLoc });
    }
    setStageSelectRequest((cur) => ({ layers, clipLocs, seq: (cur?.seq ?? 0) + 1 }));
  }, []);
  const layerElement = (clipId: string, at: string, n: number | undefined, label: string): StageElement => (
    { kind: 'box', loc: n ? `${at}#${n}` : at, label, clipId, ...(n ? { instance: n } : {}) }
  );
  const toggleLayerRow = React.useCallback((clipId: string, row: LayerRow, what: 'hidden' | 'locked') => {
    const at = row.instance ? row.loc.slice(0, -`#${row.instance}`.length) : row.loc;
    const patch = what === 'hidden' ? { style: { visibility: row.hidden ? null : 'hidden' } } : { lock: !row.locked };
    void editStageOverrides([{ element: layerElement(clipId, at, row.instance, row.label), patch: patch as OverrideGeometry }]).then((f) => { if (f) toast.show(f); });
  }, [editStageOverrides, toast]); // eslint-disable-line react-hooks/exhaustive-deps
  const deleteLayerRow = React.useCallback((clipId: string, row: LayerRow) => {
    const at = row.instance ? row.loc.slice(0, -`#${row.instance}`.length) : row.loc;
    /* its outline on the picture goes with it */
    setPointedLayer(null);
    void deleteLayers([layerElement(clipId, at, row.instance, row.label)]).then((f) => { if (f) toast.show(f); });
  }, [deleteLayers, toast]); // eslint-disable-line react-hooks/exhaustive-deps
  /* a Layers row's right-click: the picture's own menu, its layer (or clip) taken in hand there first */
  const openLayerMenu = React.useCallback((target: { clipId: string; loc?: string }, at: { x: number; y: number }) => {
    /* a caption has no menu on the picture: the right-click picks it */
    if (isCueClip(target.clipId)) { selectStageClip(target.clipId); return; }
    const clipLoc = blocksRef.current.find((b) => b.clipId === target.clipId)?.loc;
    if (clipLoc) stageControl.current?.openMenu({ clipLoc, ...(target.loc != null ? { loc: target.loc } : {}) }, at);
  }, [selectStageClip]);
  const restackLayers = React.useCallback((clipId: string, edits: StageArrangeResult['edits']) => {
    void editStageOverrides(edits.map(({ target, style }) => ({ element: layerElement(clipId, target.at, target.n, target.at), patch: { style } as OverrideGeometry })))
      .then((f) => { if (f) toast.show(f); });
  }, [editStageOverrides, toast]); // eslint-disable-line react-hooks/exhaustive-deps
  /* ── motion: a page clip opened as a composition, its elements its layers (lib/element-motion) ── */
  const [motionComp, setMotionComp] = React.useState<string | null>(null);
  React.useEffect(() => { if (!motionOpen) setMotionComp(null); }, [motionOpen]);
  const compBlock = motionComp ? blocksRef.current.find((b) => b.clipId === motionComp) ?? null : null;
  const compClip = motionComp ? film.film?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === motionComp) ?? null : null;
  /* its elements, as the Layers panel reads them from the page (only while it is in the picture) */
  const [compRows, setCompRows] = React.useState<readonly LayerRow[] | null>(null);
  const compShown = Boolean(compBlock && timeMs >= compBlock.startMs && timeMs < compBlock.endMs);
  /* another composition opened: its own elements, read anew; one off the picture keeps those it was read with */
  React.useEffect(() => { setCompRows(null); }, [motionComp]);
  React.useEffect(() => {
    if (!motionComp || !compShown) return undefined;
    let alive = true;
    let tries = 0;
    let wait: ReturnType<typeof setTimeout> | undefined;
    const read = () => void askStage<{ clip: string; layers: LayerRow[] }[]>('tree').then(async (tree) => {
      const rows = tree?.find((c) => c.clip === motionComp)?.layers ?? [];
      if (!alive) return;
      /* its page still loading: asked again in a moment */
      if (!rows.length && ++tries < 60) { wait = setTimeout(read, 500); return; }
      setCompRows(rows);
      /* each element's own size: what a mask of it is drawn in */
      const handles: number[] = [];
      const walk = (list: readonly LayerRow[]) => { for (const r of list) { handles.push(r.handle); walk(r.children ?? []); } };
      walk(rows);
      const sizes = await askStage<({ w: number; h: number } | null)[]>('sizes', { handles });
      if (alive) setCompSizes(new Map(handles.flatMap((h, i) => (sizes?.[i] ? [[h, sizes[i]!] as const] : []))));
    });
    read();
    return () => { alive = false; clearTimeout(wait); };
  }, [motionComp, compShown, film.film, askStage]);
  const [compSizes, setCompSizes] = React.useState<ReadonlyMap<number, { w: number; h: number }>>(new Map());
  const [compPicked, setCompPicked] = React.useState<readonly string[]>([]);
  const [compKeys, setCompKeys] = React.useState<{ id: string; keys: ReadonlySet<string> } | null>(null);
  /** An element layer's place: its override's selector and which match. */
  const elementAt = (row: LayerRow) => ({ at: row.instance ? row.loc.slice(0, -`#${row.instance}`.length) : row.loc, n: row.instance });
  /* its elements as layers, a tree: an element with others in it twirled open to them (none at first) */
  const [compOpen, setCompOpen] = React.useState<ReadonlySet<string>>(new Set());
  React.useEffect(() => { setCompOpen(new Set()); }, [motionComp]);
  const compLayers = React.useMemo<Layer[]>(() => {
    if (!compBlock || !compRows) return [];
    const out: Layer[] = [];
    /* a line of words the page split into an element a character (its own animation's parts): one layer, its words */
    const split = (row: LayerRow) => (row.children?.length ?? 0) > 1 && row.children.every((c) => !c.children?.length && [...c.label.trim()].length <= 1);
    const walk = (rows: readonly LayerRow[], depth: number, parent?: string) => {
      for (const row of rows) {
        const kids = split(row) ? 0 : row.children?.length ?? 0;
        const open = compOpen.has(row.loc);
        out.push({ clipId: row.loc, title: row.label, kind: row.kind, startMs: 0, endMs: compBlock.endMs - compBlock.startMs, depth, ...(parent ? { parent } : {}), ...(kids ? { kids, kidsOpen: open } : {}) });
        if (open && kids) walk(row.children ?? [], depth + 1, row.label);
      }
    };
    walk(compRows, 0);
    return out;
  }, [compBlock, compRows, compOpen]);
  const rowOf = React.useCallback((loc: string): LayerRow | null => {
    const find = (rows: readonly LayerRow[]): LayerRow | null => {
      for (const r of rows) { if (r.loc === loc) return r; const inner = find(r.children ?? []); if (inner) return inner; }
      return null;
    };
    return compRows ? find(compRows) : null;
  }, [compRows]);
  /* an element's keyframes and tweak written: the clip's overrides, the film's @keyframes, one edit */
  const writeElement = React.useCallback((loc: string, motion: Motion, stat?: ElementCommit['stat'], style?: Record<string, string | null>, words?: ReturnType<typeof splitFor>,
    mask?: { name: string; entry: string | null; body: string | null }) => {
    const row = rowOf(loc);
    if (!row || !motionComp) return;
    const { at, n } = elementAt(row);
    const list = (compClip?.overrides ?? []) as FilmOverride[];
    const out = writeElementMotion(list, at, n, elementSubject(motionComp, at, n), motion, stat);
    let overrides = out.overrides;
    if (style) {
      const has = overrides.some((o) => sameElement(o, at, n));
      overrides = (has ? overrides : [...overrides, { at, ...(n ? { n } : {}) }]).flatMap((o) => {
        if (!sameElement(o, at, n)) return [o];
        const css = { ...(o.style ?? {}) } as Record<string, string | number>;
        /* what moves keeps no static value (a tweak's style is applied with priority, over its animation) */
        const keyed = (k: string) => (k === 'opacity' ? Boolean(motion.opacity?.length) : k.startsWith('--fx-') && Boolean(motion[k.slice(5) as KeyedProp]?.length));
        for (const [k, v] of Object.entries(style)) { if (v == null || keyed(k)) delete css[k]; else css[k] = v; }
        const next = { ...o, style: css };
        if (!Object.keys(css).length) delete (next as { style?: unknown }).style;
        return Object.keys(next).some((k) => k !== 'at' && k !== 'n') ? [next] : [];
      });
    }
    if (words) {
      /* its words animated part by part, or not any more (lib/text-animator) */
      const has = overrides.some((o) => sameElement(o, at, n));
      overrides = (has || words.split ? (has ? overrides : [...overrides, { at, ...(n ? { n } : {}) }]) : overrides).flatMap((o) => {
        if (!sameElement(o, at, n)) return [o];
        const next = { ...o } as FilmOverride;
        if (words.split) next.split = words.split; else delete next.split;
        return Object.keys(next).some((k) => k !== 'at' && k !== 'n') ? [next] : [];
      });
    }
    if (mask) {
      /* its mask's keyframes, played among its animations (lib/mask-motion), or not any more */
      overrides = (overrides.some((o) => sameElement(o, at, n)) || !mask.entry ? overrides : [...overrides, { at, ...(n ? { n } : {}) }]).flatMap((o) => {
        if (!sameElement(o, at, n)) return [o];
        const css = { ...(o.style ?? {}) } as Record<string, string | number>;
        const entries = typeof css.animation === 'string' ? css.animation.split(',').map((e) => e.trim()).filter((e) => e && e.split(/\s+/)[0] !== mask.name) : [];
        if (mask.entry) entries.push(mask.entry);
        if (entries.length) css.animation = entries.join(', '); else delete css.animation;
        const next = { ...o, style: css };
        if (!Object.keys(css).length) delete (next as { style?: unknown }).style;
        return Object.keys(next).some((k) => k !== 'at' && k !== 'n') ? [next] : [];
      });
    }
    const set = Object.fromEntries(Object.entries({ ...out.keyframes, ...(words?.keyframes ?? {}), ...(mask ? { [mask.name]: mask.body } : {}) }).filter(([name, body]) => body != null || film.film?.keyframes?.[name] != null));
    void edit([
      { op: 'props', edits: [{ clip: motionComp, prop: 'overrides', value: overrides.length ? (overrides as unknown as Record<string, unknown>) : null }] },
      ...(Object.keys(set).length ? [{ op: 'keyframes' as const, set }] : []),
    ], clipStep('history.stepMoved', [motionComp])).then((err) => { if (err) toast.showError(err); });
  }, [rowOf, motionComp, compClip, film.film, edit, toast]); // eslint-disable-line react-hooks/exhaustive-deps
  /* where the page is: its own second at the playhead (the clip plays it from its trim's start) */
  const compOffset = Array.isArray(compClip?.time) ? Number(compClip!.time[0]) || 0 : 0;
  const compLocalMs = compBlock ? timeMs - compBlock.startMs : 0;
  /* a composition's time is its clip's: the playhead stays on it (its last frame at most), as a nested comp's ends */
  const inComp = (ms: number) => (compBlock ? Math.min(Math.max(ms, 0), Math.max(0, compBlock.endMs - compBlock.startMs - 1000 / Math.max(1, projectFps))) : ms);
  const elementMotionOf = React.useCallback((loc: string): Motion => {
    const row = rowOf(loc);
    if (!row || !motionComp) return {};
    const { at, n } = elementAt(row);
    const entry = ((compClip?.overrides ?? []) as FilmOverride[]).find((o) => sameElement(o, at, n));
    return readElementMotion(entry, film.film?.keyframes, elementSubject(motionComp, at, n));
  }, [rowOf, motionComp, compClip, film.film]); // eslint-disable-line react-hooks/exhaustive-deps
  const elementHostOf = React.useCallback((layer: Layer): LayerHost => {
    const row = rowOf(layer.clipId);
    const entry = row ? ((compClip?.overrides ?? []) as FilmOverride[]).find((o) => sameElement(o, elementAt(row).at, elementAt(row).n)) : undefined;
    const motion = elementMotionOf(layer.clipId);
    const on = compBlock != null && compLocalMs >= 0 && compLocalMs <= compBlock.endMs - compBlock.startMs;
    const model = elementModel(motion, elementStatic(entry), compLocalMs / 1000 + compOffset, on, keyFrameS);
    const css = (entry?.style ?? {}) as Record<string, string | number>;
    /* its effects, in its tweak's style: its filter and its `--fx-…` values (clip-motion effectsOf) */
    const fxCss = [`filter: ${css.filter ?? ''}`, ...Object.entries(css).filter(([k]) => k.startsWith('--fx-')).map(([k, v]) => `${k}: ${v}`)].join('; ');
    const fx = effectsOf(fxCss);
    const effects = effectsModel(motion, fx.on, fx.values, compLocalMs / 1000 + compOffset, on, keyFrameS);
    const stat = elementStatic(entry);
    const pageS = compBlock ? (compBlock.endMs - compBlock.startMs) / 1000 : 0;
    return {
      /* an element's keyframes are its transform itself, on the page's own seconds */
      model: { ...model, preset: { motion, rest: { translate: stat.t, scale: stat.s, rotate: stat.r, opacity: stat.opacity }, span: [compOffset, compOffset + pageS], stage: compBlock?.size ?? film.film?.stage ?? { w: 1920, h: 1080 } } },
      effects,
      commitEffects: (c: EffectsChange | null) => {
        if (!c) return;
        let patch: Record<string, string | null> | undefined;
        if (c.fx) {
          const next = Object.fromEntries(declarations(withEffects(fxCss, c.fx.on, c.fx.values)));
          patch = { filter: next.filter || null };
          for (const p of Object.keys(EFFECTS)) patch[`--fx-${p}`] = next[`--fx-${p}`] ?? null;
        }
        writeElement(layer.clipId, c.motion, undefined, patch);
      },
      commit: (c) => { const k = c as ElementCommit | null; if (k) writeElement(layer.clipId, k.motion, k.stat); },
      blend: String(css.mixBlendMode ?? 'normal'),
      setBlend: (mode) => writeElement(layer.clipId, motion, undefined, { mixBlendMode: mode === 'normal' ? null : mode }),
      visible: !row?.hidden,
      setVisible: (show) => writeElement(layer.clipId, motion, undefined, { visibility: show ? null : 'hidden' }),
      ...(row?.kind === 'text' ? { text: { anim: textAnimOf(entry), set: (anim: TextAnim | null) => writeElement(layer.clipId, motion, undefined, undefined, splitFor(anim)) } } : {}),
      ...(row && motionComp ? { mask: elementMaskOf(layer.clipId, row, css, motion) } : {}),
      ...(row?.kind === 'shape' ? { stroke: strokeOf(layer.clipId, row, css, motion, on) } : {}),
    };
  }, [rowOf, compClip, elementMotionOf, compBlock, compLocalMs, compOffset, keyFrameS, writeElement, film.film, compSizes, motionComp, projectFps]); // eslint-disable-line react-hooks/exhaustive-deps
  /*
   * An element's mask (lib/clip-mask) in its tweak's style, drawn in its own size. Its tweak's style is applied with
   * priority, over any animation: one that moves (lib/mask-motion) keeps no mask of its own there, its keyframes'
   * first stop says what it is.
   */
  const elementMaskOf = (loc: string, row: LayerRow, css: Record<string, string | number>, motion: Motion): LayerMask | null => {
    const { at, n } = elementAt(row);
    const box = compSizes.get(row.handle) ?? null;
    const name = `${elementSubject(motionComp!, at, n)}--mask`;
    const body = film.film?.keyframes?.[name];
    const keys = readMaskKeys(body);
    const first = /%\s*\{\s*mask-image:\s*(.*?);\s*mask-composite:\s*([^}]*?)\s*\}/.exec(body ?? '');
    const now = first && Object.keys(keys).length ? maskOf(first[1], first[2], box) : maskOf(css.maskImage as string | undefined, css.maskComposite as string | undefined, box);
    const read = (prop: string) => (prop === 'mask-image' ? css.maskImage : prop === 'mask-composite' ? css.maskComposite : css[prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())]) as string | undefined;
    const write = (base: Mask | null, next: MaskKeys) => {
      const own = base ? maskCss(read, base, box) : { 'mask-image': null, 'mask-composite': null };
      if (!own) return;
      const frames = base ? maskKeyframes(base, next, (prop) => (prop === 'mask-image' || prop === 'mask-composite' ? own[prop] ?? undefined : read(prop)), box, projectFps) : null;
      /* drawn over the whole element, whatever size and place a mask of the page's own had there (a shine moving) */
      const fit = base ? { maskSize: '100% 100%', maskPosition: '0 0', maskRepeat: 'no-repeat' } : { maskSize: null, maskPosition: null, maskRepeat: null };
      writeElement(loc, motion, undefined,
        frames ? { maskImage: null, maskComposite: null, ...fit } : { maskImage: own['mask-image'] ?? null, maskComposite: own['mask-composite'] ?? null, ...fit },
        undefined, { name, entry: frames ? `${name} ${Math.round(frames.secs * 1000) / 1000}s linear both` : null, body: frames?.body ?? null });
    };
    const on = compBlock != null && compLocalMs >= 0 && compLocalMs <= compBlock.endMs - compBlock.startMs;
    /* a mask Studio cannot read (written by hand): left as it is */
    if (now === null) return null;
    return {
      shape: now?.shape ?? null,
      invert: Boolean(now?.invert),
      model: now ? maskModel(now, keys, compLocalMs / 1000 + compOffset, on, keyFrameS) : null,
      keys,
      setShape: (shape) => write(shape ? maskDefault(shape, box, now ?? null) : null, shape ? keys : {}),
      setInvert: (inv) => { if (now) write({ ...now, invert: inv }, keys); },
      commit: (c) => { if (c && now) write(c.base ?? now, c.keys); },
    };
  };
  /*
   * A shape's stroke drawn on (an animation editor's Trim Paths): its dash as long as its longest path (asked of the
   * page once, as it is turned on), offset by what is not drawn of it, `--fx-trim` (0–100, keyed as an effect)
   */
  const strokeOf = (loc: string, row: LayerRow, css: Record<string, string | number>, motion: Motion, on: boolean) => {
    const strokeOn = String(css.strokeDashoffset ?? '').includes('--fx-trim');
    const trim = Number.parseFloat(String(css['--fx-trim'] ?? ''));
    const model = effectsModel(motion, strokeOn ? ['trim'] : [], Number.isFinite(trim) ? { trim } : {}, compLocalMs / 1000 + compOffset, on, keyFrameS);
    return {
      on: strokeOn,
      model,
      commit: (c: EffectsChange | null) => {
        if (!c) return;
        const keep = c.fx ? c.fx.on.includes('trim') : strokeOn;
        const value = c.fx?.values.trim;
        writeElement(loc, c.motion, undefined, keep
          ? (c.fx ? { '--fx-trim': value != null ? String(value) : null } : undefined)
          : { strokeDasharray: null, strokeDashoffset: null, '--fx-trim': null });
      },
      turnOn: () => {
        void askStage<number | null>('strokeLength', { handle: row.handle }).then((len) => {
          if (!len) { toast.show(t('canvas.strokeNone')); return; }
          writeElement(loc, motion, undefined, { strokeDasharray: `${len}px`, strokeDashoffset: `calc(${len}px * (1 - var(--fx-trim, 100) / 100))`, '--fx-trim': '100' });
        });
      },
    };
  };
  const elementLanesOf = React.useCallback((layer: Layer): MotionLanes => {
    const motion = elementMotionOf(layer.clipId);
    const id = layer.clipId;
    const picked = compKeys?.id === id ? compKeys.keys : NO_KEYS;
    const host = elementHostOf(layer);
    const model = host.model;
    return {
      clipId: id, startMs: -compOffset * 1000, endMs: layer.endMs, playheadMs: compLocalMs, frameMs: 1000 * keyFrameS,
      rows: [...MOTION_PROPS, ...(host.effects?.on ?? []), ...(host.stroke?.on ? ['trim' as const] : [])].map((prop) => ({ prop, label: keyedLabel(prop), keys: motion[prop] ?? [] })),
      picked,
      onPick: (ids, mode) => {
        setCompPicked([id]);
        setCompKeys((was) => {
          const base = was?.id === id ? was.keys : NO_KEYS;
          if (mode === 'set') return { id, keys: new Set(ids) };
          const next = new Set(base);
          for (const k of ids) { if (mode === 'toggle' && next.has(k)) next.delete(k); else next.add(k); }
          return { id, keys: next };
        });
      },
      onMove: (dt) => { if (picked.size) writeElement(id, movedKeys(motion, picked, dt)); },
      onToggleHere: (prop) => {
        if (prop === 'trim') { host.stroke?.commit(host.stroke.model.toggleHere('trim')); return; }
        if (prop in EFFECTS) { host.commitEffects(host.effects?.toggleHere(prop as EffectProp) ?? null); return; }
        const c = model?.toggleHere(prop as MotionProp) as ElementCommit | null;
        if (c) writeElement(id, c.motion, c.stat);
      },
      onSeek: (ms) => { if (compBlock) seek(compBlock.startMs + inComp(ms)); },
      onMenu: (e) => { if (picked.size) setKeyMenu({ x: e.clientX, y: e.clientY }); },
      graph: motionGraph,
      onGraph: () => setMotionGraph((v) => !v),
      onCurve: (prop, at, curve) => {
        const ease = easeOfBezier(curve);
        writeElement(id, { ...motion, [prop]: (motion[prop] ?? []).map((k) => {
          if (k.t !== at) return k;
          const { ease: _was, ...rest } = k;
          return ease ? { ...rest, ease } : rest;
        }) });
      },
      onKeyEdit: (prop, at, to) => {
        const keys = (motion[prop] ?? []).filter((k) => k.t === at || Math.abs(k.t - to.t) >= keyFrameS / 2);
        writeElement(id, { ...motion, [prop]: keys.map((k) => (k.t === at ? { ...k, t: to.t, v: to.v } : k)).sort((a, b) => a.t - b.t) });
      },
      labels: { prev: t('inspector.keyPrev'), next: t('inspector.keyNext'), add: t('inspector.keyAdd'), remove: t('inspector.keyRemove'), graph: t('inspector.keyGraph') },
    };
  }, [elementMotionOf, elementHostOf, compKeys, compOffset, compLocalMs, keyFrameS, writeElement, compBlock, seek, motionGraph, t]); // eslint-disable-line react-hooks/exhaustive-deps
  /* an element's picked keyframes: eased (F9), taken away, nudged (⌥←/→), copied and pasted, as a clip's are */
  elementKeys.current = {
    run: (what) => {
      if (!motionComp || !compKeys?.keys.size) return false;
      const { id, keys: picked } = compKeys;
      const motion = elementMotionOf(id);
      if (what === 'delete') { writeElement(id, withoutKeys(motion, picked)); setCompKeys({ id, keys: new Set() }); return true; }
      if (typeof what === 'object') {
        const lowest = Math.min(...[...picked].map((x) => parseKeyId(x)?.t ?? Infinity));
        const dt = Math.max(what.move, -lowest);
        writeElement(id, movedKeys(motion, picked, what.move));
        setCompKeys({ id, keys: new Set([...picked].flatMap((x) => { const k = parseKeyId(x); return k ? [keyId(k.prop, Math.round((k.t + dt) * 1000) / 1000)] : []; })) });
        return true;
      }
      writeElement(id, easedMotion(motion, picked, what));
      return true;
    },
    copy: () => (motionComp && compKeys?.keys.size ? copiedKeys(elementMotionOf(compKeys.id), compKeys.keys) : null),
    paste: (copied) => {
      const id = motionComp ? compPicked[0] : undefined;
      if (!id || !compBlock) return false;
      const pasted = pastedKeys(elementMotionOf(id), copied, Math.max(0, compLocalMs / 1000 + compOffset), keyFrameS);
      writeElement(id, pasted.motion);
      setCompKeys({ id, keys: pasted.picked });
      return true;
    },
  };
  React.useEffect(() => {
    if (!compKeys?.keys.size) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      let done = true;
      if (e.key === 'F9') elementKeys.current.run(e.metaKey && e.shiftKey ? 'easy-out' : e.shiftKey ? 'easy-in' : 'easy');
      else if (e.key === 'Backspace' || e.key === 'Delete') elementKeys.current.run('delete');
      else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) elementKeys.current.run({ move: (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1) * keyFrameS });
      else if (e.key === 'Escape') setCompKeys(null);
      else done = false;
      if (done) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [compKeys, keyFrameS]);
  /* a page layer double-clicked: its composition opened, the playhead brought into it */
  const openComposition = React.useCallback((layer: Layer) => {
    const block = blocksRef.current.find((b) => b.clipId === layer.clipId);
    if (!block || block.kind !== 'mg') return;
    if (timeRef.current < block.startMs || timeRef.current >= block.endMs) seek(block.startMs);
    setCompPicked([]);
    setCompKeys(null);
    setPickedKeys(new Set());
    setMotionComp(layer.clipId);
  }, [seek]);
  /* ── Motion's layers on the edit's own timeline (components/Timeline `layers`): a row a picture clip, the topmost
     first, its properties under it; a composition's, a row an element of its page (they play all of it: not moved) ── */
  const filmMotion = useMotionLayers({
    layers: motionLayers, playheadMs: timeMs, fps: projectFps, onSeek: seek,
    picked: selectedBlocks.flatMap((b) => (b.clipId ? [b.clipId] : [])),
    onPick: (id, add) => setSelectedKeys((was) => (add ? (was.includes(id) ? was.filter((x) => x !== id) : [...was, id]) : [id])),
    lanesOf: (l) => lanesOf(l as TimelineBlock & { clipId: string }),
    hostOf: (l) => ({ ...layerHostOf(l as TimelineBlock & { clipId: string }), contents: contentsOfRef.current(l as TimelineBlock & { clipId: string }) }),
    onOpen: openComposition, reveal: motionReveal, t,
  });
  const compMotion = useMotionLayers({
    layers: compLayers, playheadMs: compLocalMs, fps: projectFps, onSeek: (ms) => { if (compBlock) seek(compBlock.startMs + inComp(ms)); },
    picked: compPicked,
    onPick: (id, add) => {
      const next = add ? (compPicked.includes(id) ? compPicked.filter((x) => x !== id) : [...compPicked, id]) : [id];
      setCompPicked(next);
      /* in hand on the picture too, with its handles, as the Layers panel's row picks it */
      if (motionComp) selectLayerRows(next.map((loc) => ({ clipId: motionComp, loc })));
    },
    lanesOf: elementLanesOf, hostOf: elementHostOf, reveal: motionReveal, t,
    onKids: (layer) => setCompOpen((was) => { const next = new Set(was); if (next.has(layer.clipId)) next.delete(layer.clipId); else next.add(layer.clipId); return next; }),
  });
  /* a new layer (Motion's toolbar): words, a shape or a solid from the library's layers, still, on a track of its own at
     the top from the playhead, for keyframes to move; or the picked layers grouped (a compound clip, as an animation
     editor precomposes them, moved together) */
  const [newLayerMenu, setNewLayerMenu] = React.useState<{ x: number; y: number } | null>(null);
  const newLayerItems = (): ContextMenuEntry[] => {
    const layer = (id: string, label: string, vars?: Record<string, string>) => ({
      id, label, onSelect: () => { const item = builtInItem(`${BUILT_IN}/${id}`); if (item) void library.place(item, vars, label); else toast.show(t('timeline.editFail')); },
    });
    return [
      /* the words still: how they come in and go out is keyframes now, not the page's own */
      layer(TEXT_COMPONENT, t('canvas.layerText'), { '--in': 'none', '--loop': 'none', '--out': 'none' }),
      { id: 'sep-shapes', separator: true },
      layer('layers/rectangle', t('canvas.layerRect')),
      layer('layers/ellipse', t('canvas.layerEllipse')),
      layer('layers/polygon', t('canvas.layerPolygon')),
      layer('layers/star', t('canvas.layerStar')),
      layer('layers/solid', t('canvas.layerSolid')),
      { id: 'sep-group', separator: true },
      { id: 'group', label: t('canvas.layerGroup'), shortcut: '⌥G', disabled: !selectedBlocks.length || Boolean(motionComp),
        onSelect: () => { void makeCompound(selectedBlocks).then((err) => { if (err) toast.showError(err); }); } },
    ];
  };
  /* the edit's tracks as Motion's rows, in their order: a track with one picture clip is that layer; one with more is
     a folder, its clips on its row as in the edit, twirled open to a layer each (its track's, so drags and trims are
     the edit's), by time; sound tracks as they are */
  const [openTracks, setOpenTracks] = React.useState<ReadonlySet<string>>(new Set());
  /* a clip that has keyframes shows them on its bar, cutting it or animating it: what moves is in sight */
  const withKeyMarks = React.useCallback((b: TimelineBlock): TimelineBlock => {
    if (!b.clipId || (b.kind !== 'mg' && b.kind !== 'video')) return b;
    const clip = film.film?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === b.clipId);
    const own = keyTimesMs(motionOfBlock(b), 0, b.endMs - b.startMs);
    const vars = clip ? Object.values(readVarMotion(clip.id, clip.overrides as readonly FilmOverride[] | undefined, film.film?.keyframes)).flatMap((v) => v.keys.map((k) => Math.round(k.t * 1000))) : [];
    const keysMs = [...new Set([...own, ...vars])].filter((ms) => ms >= 0 && ms <= b.endMs - b.startMs).sort((x, y) => x - y);
    return keysMs.length ? { ...b, keysMs } : b;
  }, [film.film, motionOfBlock]);
  /* a layer shown twirled open (put on from the panels, or opened from the edit's inspector): its folder opens too */
  React.useEffect(() => {
    const ids = motionReveal?.ids ?? [];
    const lanes = tools.tracks.filter((tr) => tr.blocks.some((b) => b.clipId && ids.includes(b.clipId))).map((tr) => tr.lane);
    if (lanes.length) setOpenTracks((was) => (lanes.every((l) => was.has(l)) ? was : new Set([...was, ...lanes])));
  }, [motionReveal]); // eslint-disable-line react-hooks/exhaustive-deps
  const editTracks = React.useMemo(() => shownTracks.map((tr) => (tr.blocks.some((b) => b.clipId) ? { ...tr, blocks: tr.blocks.map(withKeyMarks) } : tr)), [shownTracks, withKeyMarks]);
  const layerTracks = React.useMemo(() => {
    if (!motionOpen) return null;
    const byClip = new Map(motionLayers.map((l) => [l.clipId, l]));
    let n = 0;
    const rows: LayerRowSpec[] = [];
    for (const track of tools.tracks) {
      const pictures = track.kind === 'visual' ? [...track.blocks].filter((b) => b.clipId && byClip.has(b.clipId)).sort((a, b) => a.startMs - b.startMs) : [];
      if (!pictures.length) { rows.push({ track, layer: null, n: 0 }); continue; }
      const folder = pictures.length > 1;
      const open = folder && openTracks.has(track.lane);
      if (folder) {
        /* open, its clips are on their own rows below it, not twice */
        rows.push({ track: { ...track, height: LAYER_ROW_H, extra: undefined, blocks: open ? track.blocks.filter((b) => !pictures.includes(b)) : track.blocks.map(withKeyMarks) }, layer: null, n: 0, folder: { count: pictures.length, open } });
        if (!open) continue;
      }
      for (const b of pictures) {
        const own = byClip.get(b.clipId!)!;
        const layer = folder ? { ...own, depth: 1 } : own;
        const extra = filmMotion.extraOf(layer);
        rows.push({ track: { ...track, lane: `${track.lane}~${b.id}`, blocks: [withKeyMarks(b)], name: b.title, height: LAYER_ROW_H, ...(extra ? { extra } : { extra: undefined }) }, layer, n: ++n });
      }
    }
    return rows;
  }, [motionOpen, motionLayers, tools.tracks, filmMotion, openTracks, withKeyMarks]); // eslint-disable-line react-hooks/exhaustive-deps
  const compTracks = React.useMemo(() => (compBlock ? compLayers.map((layer, i) => {
    const extra = compMotion.extraOf(layer);
    /* its bar in its label's color, its keyframes marked on it (they are on the page's time) */
    const keysMs = keyTimesMs(elementMotionOf(layer.clipId), -compOffset, layer.endMs);
    const block: TimelineBlock = { id: `el:${layer.clipId}`, title: layer.title || layer.clipId, startMs: 0, endMs: layer.endMs, kind: 'mg', color: layerBarColor(layer.kind), ...(keysMs.length ? { keysMs } : {}) };
    return { track: { lane: `el:${layer.clipId}`, role: 'mg' as const, kind: 'visual' as const, index: 1, name: block.title, blocks: [block], height: LAYER_ROW_H, ...(extra ? { extra } : {}) } as TimelineTrack, layer, n: i + 1 };
  }) : null), [compBlock, compLayers, compMotion, compOffset, film.film]); // eslint-disable-line react-hooks/exhaustive-deps
  /* what the timeline draws of a layer row: its head and its properties (a sound track keeps a plain head) */
  /* a folder's head: its track's eye and lock, its twirl, its badge and how many clips it has */
  const folderHead = (track: TimelineTrack, folder: NonNullable<LayerRowSpec['folder']>) => {
    const loc = track.blocks.find((b) => b.loc)?.loc ?? (track.docIndex != null ? `film.html#${track.docIndex}.0` : null);
    const flag = (prop: 'hidden' | 'locked') => { if (loc) void editBlocks([{ loc, prop, value: track[prop] ? null : true }]).then((err) => { if (err) toast.showError(err); }); };
    const btn = 'grid h-[18px] w-[18px] place-items-center rounded-[3px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]';
    return (
      <div className="flex h-full w-full min-w-0 items-center pr-2 text-[12px] text-[var(--text-muted)]" data-motion-folder={track.lane}>
        <span className="grid w-[22px] shrink-0 place-items-center">
          <button type="button" aria-label={t('canvas.motionVisible')} aria-pressed={!track.hidden} className={btn} onPointerDown={(e) => e.stopPropagation()} onClick={() => flag('hidden')}>
            {track.hidden ? <EyeOff size={12} className="opacity-50" /> : <Eye size={12} />}
          </button>
        </span>
        <span className="grid w-[20px] shrink-0 place-items-center">
          <button type="button" aria-label={t(track.locked ? 'canvas.layerUnlock' : 'canvas.layerLock')} className={`${btn} ${track.locked ? 'text-[var(--text)]' : 'text-[var(--text-faint)] opacity-60'}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => flag('locked')}>
            {track.locked ? <Lock size={11} /> : <LockOpen size={11} />}
          </button>
        </span>
        <button type="button" aria-expanded={folder.open} aria-label={t('canvas.trackLayers')} title={t('canvas.trackLayers')} data-folder-twirl={track.lane}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setOpenTracks((was) => { const next = new Set(was); if (next.has(track.lane)) next.delete(track.lane); else next.add(track.lane); return next; })}
          className="flex min-w-0 items-center gap-1.5 rounded-[3px] pr-1 hover:text-[var(--text)]">
          {folder.open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="rounded-[3px] bg-[var(--bg-hover)] px-1 text-[10.5px] font-medium tabular-nums text-[var(--text)]">{track.badge ?? ''}</span>
          <span className="truncate">{t('canvas.trackClips').replace('{n}', String(folder.count))}</span>
        </button>
      </div>
    );
  };
  const layerView = (view: MotionLayersView, rows: readonly LayerRowSpec[], keysPicked: boolean, layersPicked: boolean, open?: (layer: Layer) => void) => {
    const of = new Map(rows.map((r) => [r.track.lane, r]));
    return {
      headWidth: view.headWidth,
      ...(open ? { open: (block: TimelineBlock) => {
        const layer = rows.find((r) => r.layer?.clipId === block.clipId)?.layer;
        if (!layer || layer.kind !== 'mg') return false;
        open(layer);
        return true;
      } } : {}),
      /* an animation editor's tools in the place of cutting's: ease the picked keyframes, their curves, what moves */
      tools: [
        { id: 'new', label: t('canvas.newLayer'), icon: <Plus size={16} />, onClick: () => {
          const r = document.querySelector('[data-motion-tool="new"]')?.getBoundingClientRect();
          setNewLayerMenu(r ? { x: r.left, y: r.bottom + 4 } : { x: 200, y: 200 });
        } },
        { id: 'ease', label: t('canvas.toolEase'), hint: 'F9', icon: <Spline size={16} />, disabled: !keysPicked, onClick: () => runKeys('easy') },
        { id: 'graph', label: t('canvas.toolGraph'), hint: '⇧F3', icon: <ChartSpline size={16} />, active: motionGraph, onClick: () => setMotionGraph((on) => !on) },
        { id: 'moving', label: t('canvas.showMoving'), hint: 'U', icon: <Diamond size={15} />, disabled: !layersPicked, onClick: view.showMoving },
      ],
      head: (track: TimelineTrack) => {
        const row = of.get(track.lane);
        if (row?.folder) return folderHead(row.track, row.folder);
        return row?.layer ? view.head(row.layer, row.n) : <span className="truncate px-3 text-[11px] text-[var(--text-faint)]">{track.badge ?? ''} {track.name ?? ''}</span>;
      },
      extraHead: (track: TimelineTrack) => { const row = of.get(track.lane); return row?.layer ? view.extraHead(row.layer) : null; },
      extraBody: (track: TimelineTrack, px: number) => { const row = of.get(track.lane); return row?.layer ? view.extraBody(row.layer, px) : null; },
    };
  };
  const previewClip = React.useCallback((clipLoc: string, patch: Partial<MgTransform> | null) => clipPreviewRef.current?.(clipLoc, patch), []);
  const previewLook = React.useCallback((clipLoc: string, css: string | null) => lookPreviewRef.current?.(clipLoc, css), []);
  /* a video clip's color (inspector-color): shown on the picture as dragged, baked there from the files as changed;
     written as the files and film.html's styles in one undo step, the draft kept on the picture until that is drawn */
  const colorHost = React.useMemo<ColorHost>(() => ({
    projectId,
    preview(write, ids) {
      for (const id of ids) void preview.current?.stage?.('grade', { id, draft: write ? draftOf(write, id) : null });
    },
    async commit(write, label) {
      const current = filmRef.current;
      const clips = current?.tracks.flatMap((tr) => tr.clips) ?? [];
      const locked = write.styles.some((w) => current?.tracks.some((tr) => tr.locked && tr.clips.some((c) => c.id === w.id)));
      if (locked) return t('timeline.trackLocked');
      const changed = write.styles.filter((w) => (clips.find((c) => c.id === w.id)?.style ?? null) !== w.style);
      const step = await writeColorFiles(projectId, write.files);
      if (typeof step === 'string') return step;
      const ops: Op[] = changed.length ? [{ op: 'props', edits: changed.map((w) => ({ clip: w.id, prop: 'style', value: w.style as never })) }] : [];
      const failed = ops.length ? await edit(ops, label, false, step) : (filmRecord(label ?? 'history.stepEdit', step), null);
      if (failed) { await step.undo(); return failed; }
      for (const w of write.styles) void preview.current?.stage?.('grade', { id: w.id, draft: { written: true } });
      return null;
    },
  }), [projectId, edit, filmRecord, t]);
  /* the edit graded (plugins/color): its panel in the inspector's place, on the clips picked or the one at the playhead */
  const colorMode = workMode === 'color';
  React.useEffect(() => { if (!colorMode) setSplit(null); }, [colorMode]);
  /* the clips with a picture to grade: videos, and the pages and stills the browser draws (src/color/page-grade.mjs),
     each as long as the timeline has it */
  const gradedClips = React.useMemo<GradedClip[]>(() => {
    if (!colorMode) return [];
    const lengths = new Map(timelineTracks.flatMap((tr) => tr.blocks).flatMap((b) => (b.clipId ? [[b.clipId, (b.endMs - b.startMs) / 1000] as const] : [])));
    return (film.film?.tracks ?? []).flatMap((track) => (track.captions ? [] : track.clips.flatMap((c) => {
      const kind = c.sound ? null : filmSrcKind(c.src);
      return kind === 'video' || kind === 'page' || kind === 'still'
        ? [{ id: c.id, kind, style: c.style, src: c.src, at: c.at ?? 0, time: c.time ?? null, speed: c.speed ?? 1, length: lengths.get(c.id) ?? null }] : [];
    })));
  }, [colorMode, film.film, timelineTracks]);

  const colorCurrent = React.useMemo(() => {
    if (!colorMode) return [];
    const picked = selectedBlocks.flatMap((b) => (b.clipId && gradedClips.some((c) => c.id === b.clipId) ? [b.clipId] : []));
    if (picked.length) return picked;
    /* none picked: the top one playing at the playhead */
    const t = timeMs / 1000;
    for (const track of film.film?.tracks ?? []) {
      if (track.hidden) continue;
      for (const c of track.clips) {
        const g = gradedClips.find((x) => x.id === c.id);
        if (!g) continue;
        if (t >= g.at && t < g.at + shotLength(g)) return [g.id];
      }
    }
    return [];
  }, [colorMode, selectedBlocks, gradedClips, timeMs, film.film]);
  /* a point asked for on the picture (the color workbench's white-balance picker), and given when clicked */
  const [pointWanted, setPointWanted] = React.useState<{ done: (p: { x: number; y: number } | null) => void } | null>(null);
  const pickPoint = React.useCallback((done: (p: { x: number; y: number } | null) => void) => {
    setPointWanted((was) => { was?.done(null); return { done }; });
  }, []);
  React.useEffect(() => { if (!colorMode) setPointWanted((was) => { was?.done(null); return null; }); }, [colorMode]);
  const referShots = React.useCallback((ids: readonly string[]) => {
    for (const b of blocksRef.current) if (b.clipId && ids.includes(b.clipId)) chat.refer?.(refOfBlock(b));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /* one shot picked in the strip stays the one graded while the playhead is on it; moved off it (← →, ↑ ↓, a scrub), the
     shot under the playhead is */
  React.useEffect(() => {
    if (!colorMode || selectedKeys.length !== 1) return;
    const c = gradedClips.find((x) => x.id === selectedKeys[0]);
    if (!c) return;
    const t = timeMs / 1000;
    if (t < c.at - 0.001 || t >= c.at + shotLength(c)) setSelectedKeys([]);
  }, [colorMode, timeMs, selectedKeys, gradedClips]);
  /* a shot taken in the color workbench's strip: picked (with those picked already, with a modifier), the playhead on it */
  const takeShot = React.useCallback((id: string, more: boolean) => {
    if (more) { setSelectedKeys((was) => (was.includes(id) ? was.filter((k) => k !== id) : [...was, id])); return; }
    setSelectedKeys([id]);
    const c = gradedClips.find((x) => x.id === id);
    /* the playhead stays where it is when it is on the shot already */
    if (c && !(timeMs / 1000 >= c.at && timeMs / 1000 < c.at + shotLength(c))) seek(c.at * 1000);
  }, [gradedClips, timeMs, seek]);
  /* the inspector's Crop: crop mode on the picture, for the video or still in hand there */
  const startStageCrop = React.useCallback(() => { stageControl.current?.startCrop(); }, []);
  const editStageMask = React.useCallback((session: MaskSession | null) => { stageControl.current?.editMask(session); }, []);
  const pageChangesOf = usePageChanges(preview, filmRef);
  /* the project's files as listed now, for the pictures a picture is replaced with (a host outlives a render) */
  const listingRef = React.useRef(listing);
  listingRef.current = listing;
  /* another file in the place of a picture inside a page (an <img>, a box painted with one image): the clip's override,
     the file named from the page's folder, as a picture property writes it */
  const putLayerPicture = React.useCallback((element: StageElement, path: string | null) => {
    const doc = filmRef.current as unknown as FilmDoc | null;
    const found = doc ? pageClipOf(doc, element) : null;
    const picture = element.picture;
    if (!found || !picture) { toast.show(t('timeline.editFail')); return; }
    const style = pictureStyle(picture.kind, path == null ? null : relativeTo(found.clip.src, path));
    /* a box holding one picture: the file goes on its <img> */
    const target: StageElement = picture.at
      ? { ...element, loc: picture.n ? `${picture.at}#${picture.n}` : picture.at, ...(picture.n ? { instance: picture.n } : { instance: undefined }), override: null }
      : element;
    void editStageOverrideRef.current(target, { style }).then((failed) => {
      if (failed) { toast.show(failed); return; }
      /* the layer in hand shows the picture now on it once the page has it */
      window.setTimeout(() => {
        void stageControl.current?.describe(element).then((fresh) => {
          if (fresh) setStageElement((el) => (el?.loc === element.loc ? { ...el, ...(fresh.picture ? { picture: fresh.picture } : {}) } : el));
        });
      }, 150);
    });
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps
  const pictureActions = React.useMemo<StagePictureActions>(() => ({
    pictures: () => (listingRef.current?.files ?? []).filter((f) => PICTURE_FILE.test(f.path)).map((f) => ({ path: f.path, name: f.path.split('/').pop() ?? f.path, url: mediaSourcesRef.current.file(f) })),
    pickFromComputer: () => pickReplacement('picture'),
    put: putLayerPicture,
  }), [pickReplacement, putLayerPicture]);
  /* a page clip's component properties (lib/component-props): its data-props, read and written by its id */
  const clipPropsOf = React.useCallback((clipId: string | undefined): ComponentProp[] => (
    clipId ? propsOf(filmRef.current?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clipId)) : []
  ), []);
  /* the page's own value of each of its properties, as the picture last showed them (a page layer's Contents) */
  const [pageVars, setPageVars] = React.useState<ReadonlyMap<string, Readonly<Record<string, string>>>>(new Map());
  React.useEffect(() => {
    if (workMode !== 'motion') return undefined;
    let live = true;
    const want = motionLayers.filter((l) => l.kind === 'mg' && !pageVars.has(l.clipId) && clipPropsOf(l.clipId).some((p) => p.type === 'var'));
    if (!want.length) return undefined;
    const timer = window.setTimeout(() => {
      void Promise.all(want.map((l) => askStage<TemplateControls>('controls', { clip: l.clipId }).catch(() => null).then((c) => [l.clipId, c] as const))).then((read) => {
        if (!live) return;
        const found = read.filter((r): r is readonly [string, TemplateControls] => r[1] != null);
        if (found.length) setPageVars((was) => new Map([...was, ...found.map(([id, c]) => [id, Object.fromEntries(c.vars.map((v) => [v.name, v.value]))] as const)]));
      });
    }, 300);
    return () => { live = false; window.clearTimeout(timer); };
  }, [workMode, motionLayers, pageVars, clipPropsOf, askStage, Math.floor(timeMs / 1000)]); // eslint-disable-line react-hooks/exhaustive-deps
  /* its properties that are numbers, each keyed as its Transform is (lib/page-motion): still, a `:root` override */
  contentsOfRef.current = (layer) => {
    const clip = layer.kind === 'mg' ? film.film?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === layer.clipId) : undefined;
    if (!clip) return null;
    const overrides = clip.overrides as readonly FilmOverride[] | undefined;
    const keyed = readVarMotion(clip.id, overrides, film.film?.keyframes);
    const still = overrideOf(overrides, { at: ':root' })?.style ?? {};
    const own = pageVars.get(clip.id) ?? {};
    const params = clipPropsOf(clip.id).flatMap((p) => {
      if (p.type !== 'var' || p.var === '--clip-length') return [];
      const num = numberOf(still[p.var] as string | undefined) ?? numberOf(own[p.var]);
      const k = keyed[p.var];
      return k || num ? [{ var: p.var, label: p.name, unit: k?.unit ?? num?.unit ?? '', still: num?.n ?? null }] : [];
    });
    return {
      params,
      keys: Object.fromEntries(Object.entries(keyed).map(([v, k]) => [v, k.keys])),
      commit: (keys, stillPatch) => {
        const unitOf = (v: string) => params.find((x) => x.var === v)?.unit ?? '';
        let next = overrides;
        for (const [v, n] of Object.entries(stillPatch ?? {})) next = withVar(next, v, n == null ? null : `${Math.round(n * 1000) / 1000}${unitOf(v)}`) ?? undefined;
        const w = writeVarMotion(clip.id, next, Object.fromEntries(Object.entries(keys).filter(([, ks]) => ks.length).map(([v, ks]) => [v, { unit: unitOf(v), keys: ks }])), clip.time?.[0] ?? 0);
        const set = Object.fromEntries(Object.entries(w.keyframes).filter(([name, body]) => body != null || film.film?.keyframes?.[name] != null));
        void edit([
          { op: 'props', edits: [{ clip: clip.id, prop: 'overrides', value: w.overrides as unknown as Record<string, unknown> | null }] },
          ...(Object.keys(set).length ? [{ op: 'keyframes' as const, set }] : []),
        ], clipStep('history.stepMoved', [clip.id])).then((err) => { if (err) toast.showError(err); });
      },
    };
  };
  const writeClipProps = React.useCallback((clipId: string | undefined, next: readonly ComponentProp[]) => {
    const loc = blocksRef.current.find((b) => b.clipId === clipId)?.loc;
    if (!loc) { toast.show(t('timeline.editFail')); return; }
    void editBlocks([{ loc, prop: 'props', value: propsAttr(next) }]).then((failed) => { if (failed) toast.show(failed); });
  }, [editBlocks, t]); // eslint-disable-line react-hooks/exhaustive-deps
  /* a layer made a property of its clip (the inspector's ◇), or no longer one */
  const layerProps = React.useMemo<LayerPropsActions>(() => ({
    list: (element) => clipPropsOf(element.clipId),
    save: (element, next) => writeClipProps(element.clipId, next),
  }), [clipPropsOf, writeClipProps]);
  /* a page clip's Properties (components/PropertiesSection): what its page shows read on the picture, previewed there,
     filled in as its overrides by the inspector */
  const propsHostOf = React.useCallback((block: TimelineBlock): PropsHost | null => {
    const clip = block.clipId;
    if (!clip) return null;
    const overridesNow = () => {
      const at = parseFilmDocLoc(blocksRef.current.find((b) => b.clipId === clip)?.loc ?? '');
      return (at ? filmRef.current?.tracks[at.track]?.clips[at.clip]?.overrides : undefined) as readonly FilmOverride[] | undefined;
    };
    /* a line of words: a look previewed refits its box as it goes (FilmStageControl fitText), the last one asked shown */
    const text = isTextClip(block.src);
    let pending: readonly unknown[] | null | undefined;
    let fitting = false;
    const fitPreview = (next: readonly unknown[] | null | undefined) => {
      pending = next;
      if (fitting) return;
      fitting = true;
      void (async () => {
        while (pending !== undefined) {
          const now = pending;
          pending = undefined;
          const loc = blocksRef.current.find((b) => b.clipId === clip)?.loc;
          if (loc) await stageControl.current?.fitText(loc, now);
        }
        fitting = false;
      })();
    };
    return {
      read: () => askStage<TemplateControls>('controls', { clip }),
      props: () => clipPropsOf(clip),
      setProps: (next) => writeClipProps(clip, next),
      overrides: overridesNow,
      preview: (target, patch) => {
        if (text && target.at === ':root' && !target.n) {
          fitPreview(patch?.style ? withRootVars(overridesNow() as unknown[] | undefined, patch.style) : null);
          return;
        }
        void (patch ? askStage('tweak', { clip, at: target.at, ...(target.n ? { n: target.n } : {}), patch }) : askStage('release', { clip }));
      },
      ...(text ? {
        fits: true,
        settle: () => { pending = undefined; },
        playMotion: (slot: 'in' | 'loop' | 'out') => playTextMotion(clip, slot),
      } : {}),
      page: block.src ?? '',
      pictures: pictureActions.pictures,
      pickPicture: () => pickReplacement('picture'),
      point: (target) => setPointedLayer(target ? { clipId: clip, loc: target.n ? `${target.at}#${target.n}` : target.at } : null),
    };
  }, [askStage, pickReplacement, pictureActions, clipPropsOf, writeClipProps, playTextMotion]);
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
  /* a clip with the clips linked to it, as the timeline acts on them */
  const withLinkedBlocks = (b: TimelineBlock): TimelineBlock[] => {
    if (!b.clipId) return [b];
    const ids = new Set(linkedIds(editModel(), [b.clipId]));
    return blocksRef.current.filter((x) => x === b || (x.clipId != null && ids.has(x.clipId)));
  };
  const stageMenuFor = React.useCallback((el: StageElement, ctx: StageMenuContext) => stageMenu(el, ctx, {
    editOverride: (element, patch) => { void editStageOverrideRef.current(element, patch).then((f) => { if (f) toast.show(f); }); },
    editOverrides: (list) => { void editStageOverrides(list).then((f) => { if (f) toast.show(f); }); },
    deleteLayers: (list) => { void deleteLayers(list).then((f) => { if (f) toast.show(f); }); },
    copyLayers: (list) => { void copyLayers(list).then((f) => { if (f) toast.show(f); }); },
    selectParent: selectStageParent,
    selectClip: selectStageClip,
    notify: (message) => toast.show(message),
    picture: pictureActions,
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
      canPaste: () => clipboard.length > 0 || layerBoardRef.current != null,
      paste: (clipLoc) => {
        if (layerBoardRef.current) { void pasteLayers(clipLoc).then((f) => { if (f) toast.show(f); }); return; }
        const lane = timelineTracks.find((tr) => tr.blocks.some((b) => b.loc === clipLoc))?.lane ?? null;
        void pasteAt(lane, timeRef.current).then((f) => { if (f) toast.show(f); });
      },
      /* as ⌘D: right after it on its own track, in the timeline's mode */
      duplicate: (clipLoc) => {
        const b = blockAt(clipLoc);
        if (b?.clipId) void duplicateRef.current(withLinkedBlocks(b));
      },
      bringToFront: (clipLoc) => { const e = stackClipEdit(filmRef.current?.tracks ?? [], clipLoc, 'front'); if (e) void editBlocks([e]); },
      sendToBack: (clipLoc) => { const e = stackClipEdit(filmRef.current?.tracks ?? [], clipLoc, 'back'); if (e) void editBlocks([e]); },
      resetTransform: (clipLoc) => { void editBlocks([{ loc: clipLoc, prop: 'box', value: null }]); },
      exportClip: (clipId) => openClipExportRef.current(clipId),
      remove: (clipLoc) => { const b = blockAt(clipLoc); if (b) { void removeBlocks(withLinkedBlocks(b)); setStageElement(null); } },
    },
  }, t), [editStageOverrides, selectStageParent, selectStageClip, splitBlocks, copyBlocks, copyLayers, pasteLayers, clipboard, timelineTracks, pasteAt, editBlocks, removeBlocks, t, toast, pictureActions]); // eslint-disable-line react-hooks/exhaustive-deps
  /*
   * "Reference in chat", first on the menus of a clip, a layer and a track, a line under it, when the app around Studio
   * has a chat. The references are made when it is chosen: a layer right-clicked is measured just after its menu
   * opens. ⌘L does the same for what is selected (the clips or the layer right-clicked are), so a clip's and a layer's
   * item says so.
   */
  const referEntry = (refs: () => StudioRef[], withKey = true): ContextMenuEntry[] => {
    const refer = chat.refer;
    if (!refer) return [];
    return [{
      id: 'refer', label: t('host.refer'), icon: <MessageSquarePlus size={14} />,
      ...(withKey ? { shortcut: keyHint('refer') } : {}),
      onSelect: () => { for (const ref of refs()) refer(ref); },
    }];
  };
  /** Two groups of menu entries, a line between them when both have some. */
  const menuGroups = (a: readonly ContextMenuEntry[], b: readonly ContextMenuEntry[]): ContextMenuEntry[] => (a.length && b.length ? [...a, { id: `${a[a.length - 1]!.id}-sep`, separator: true }, ...b] : [...a, ...b]);
  /* the picture's menu, and so the Layers panel's (one menu: the row's layer is taken in hand on the picture first);
     several layers in hand are referenced each where it is drawn */
  const stageMenuWithRefer = React.useCallback((el: StageElement, ctx: StageMenuContext): readonly ContextMenuEntry[] => {
    const entries = stageMenuFor(el, ctx);
    const block = el.clipLoc ? blocksRef.current.find((b) => b.loc === el.clipLoc) : null;
    const whole = el.kind === 'clip' || el.isMgOuter;
    const refs = (): StudioRef[] => (ctx.multi
      ? (stageControl.current?.picked() ?? []).flatMap((p) => refOfStagePick(p) ?? [])
      : [whole ? refOfBlock(block!) : refOfLayer(el)]);
    const refer = whole && !block ? [] : referEntry(refs);
    return menuGroups(refer, menuGroups(whole && block ? saveEntry([block]) : [], entries));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageMenuFor, t, keyHint, saveBlocks]);
  /* copy and paste attributes, in the clip menu */
  const attrsEntries = (blocks: readonly TimelineBlock[]): ContextMenuEntry[] => [
    { id: 'copy-attrs', label: t('clipAttrs.copy'), icon: <ClipboardCopy size={14} />, shortcut: keyHint('copy-attrs'), disabled: blocks.length !== 1, onSelect: () => copyAttrs(blocks) },
    { id: 'paste-attrs', label: t('clipAttrs.pasteMenu'), icon: <ClipboardPaste size={14} />, shortcut: keyHint('paste-attrs'), disabled: !copiedAttrs, hint: t('clipAttrs.nothing'), onSelect: () => askPasteAttrs(blocks) },
  ];
  const timelineMenuExtra = React.useCallback((blocks: readonly TimelineBlock[], clicked?: TimelineBlock) => {
    if (!blocks.length) return [];
    const lead = referEntry(() => blocks.map(refOfBlock));
    if (clicked && compoundFolder(clicked.src)) {
      lead.push({ id: 'enter-compound', label: t('timeline.menuEnterCompound'), icon: <FolderOpen size={14} />, onSelect: () => enterCompound(clicked) });
    }
    return menuGroups(lead, menuGroups(menuGroups(saveEntry(blocks), tools.menuExtra(blocks)), attrsEntries(blocks)));
  }, [t, keyHint, tools.menuExtra, copiedAttrs, copyAttrs, askPasteAttrs, saveBlocks, enterCompound]); // eslint-disable-line react-hooks/exhaustive-deps
  const trackMenuExtra = React.useCallback((track: TimelineTrack) => {
    const docIndex = track.docIndex;
    const refer = docIndex == null || !chat.refer ? [] : referEntry(() => { const ref = trackRef(tracksRef.current, docIndex); return ref ? [ref] : []; }, false);
    /* the track and all on it, one undo step: a caption track taken out of the film (its file kept for the undo), a track
       of clips by its clips (a track with none goes, ops.mjs) */
    const src = track.captions?.src;
    const clips = (docIndex == null ? [] : filmRef.current?.tracks[docIndex]?.clips ?? []).map((c) => c.id);
    const remove: ContextMenuEntry[] = docIndex == null || (!src && !clips.length) ? [] : [{
      id: 'delete-track', label: t('timeline.deleteTrack'), danger: true,
      disabled: Boolean(track.locked), ...(track.locked ? { hint: t('timeline.trackLocked') } : {}),
      onSelect: () => {
        const ops: Op[] = src ? [{ op: 'uncaptions', src }] : clips.map((clip) => ({ op: 'remove', clip }));
        void edit(ops, 'history.stepTrackDelete').then((why) => { if (why) toast.show(why); });
      },
    }];
    const add: ContextMenuEntry[] = src ? [{
      id: 'new-caption-track', label: t('captionTrack.stepNew'), icon: <Plus size={14} />,
      onSelect: () => { void newCaptionTrack(null); },
    }] : [];
    return menuGroups(menuGroups(menuGroups(refer, add), tools.headMenuExtra(track)), remove);
  }, [t, tools.headMenuExtra, edit, toast, newCaptionTrack]); // eslint-disable-line react-hooks/exhaustive-deps
  /* clips dragged out of the timeline onto the app's chat */
  const referBlocks = React.useCallback((blocks: TimelineBlock[]) => { for (const b of blocks) chat.refer?.(refOfBlock(b)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const markedRangeRef = React.useCallback((range: FilmRange) => rangeRef(projectId, range, blocksRef.current), [projectId]);
  /* the ruler points at time for the chat: a ⌘-click, that moment; a ⌘-drag, that span */
  const referRuler = React.useCallback((what: { atMs: number } | { range: FilmRange }) => {
    const refer = chat.refer;
    if (!refer) return;
    refer('atMs' in what ? momentRef(projectId, what.atMs) : rangeRef(projectId, what.range, blocksRef.current));
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  /* the picture's Mask menu: the shape goes to the clip's Mask section (put on, its handles shown), opened */
  const [maskAsk, setMaskAsk] = React.useState<{ shape: MaskShape | 'none'; clipLoc: string; n: number } | null>(null);
  const maskAsked = React.useCallback(() => setMaskAsk(null), []);
  const openMaskSection = React.useCallback((shape: MaskShape | 'none', clipLoc: string) => {
    setMaskAsk({ shape, clipLoc, n: Date.now() });
    openSection('mask');
    setInspectorContent('selection');
    setInspectorOpen(true);
    window.setTimeout(() => {
      document.querySelector('[data-film-inspector] [data-section="mask"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 60);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * Duplicate (⌘D, the clip menus'): copies right after the clips, each on its own track, going in
   * between (what follows on that track moves on; with linkage, what rides on the main track along), so nothing is
   * covered; never a new track.
   */
  const duplicateBlocks = React.useCallback(async (blocks: readonly TimelineBlock[]) => {
    const picked = blocks.filter((b) => b.clipId);
    if (!picked.length) return null;
    const tracks = tracksRef.current;
    const ops = pasteEdit(clipboardItemsOf(picked, tracks), tracks, editModel(), Math.max(...picked.map((b) => b.endMs)), null, { mode: 'insert', ...switchesOf(readTimelinePrefs()) });
    const failed = !ops ? t('timeline.trackLocked') : ops.length ? await edit(ops, picked.length <= 2 ? clipStep('history.stepDuplicated', picked.map((b) => b.clipId!)) : 'history.stepDuplicate') : null;
    if (failed) toast.show(failed);
    return failed;
  }, [editModel, edit, t, toast]);
  duplicateRef.current = duplicateBlocks;
  /* a box drawn on the picture with ⌘ held, at the playhead */
  const referRegion = React.useCallback((region: { box: StageBox; clipIds: string[]; texts: string[] }) => {
    chat.refer?.(regionRef(projectId, timeRef.current, region.box, region, stageRef.current));
  }, [projectId]);
  const recoveryMenu = React.useCallback(() => stageRecoveryMenu(filmRef.current as unknown as FilmDoc, (layer, action) => {
    const doc = filmRef.current as unknown as FilmDoc | null;
    const e = doc && recoverLayer(doc, layer, action);
    if (e) void editBlocks([{ ...e, value: e.value as unknown as Record<string, unknown> | null }]).then((f) => { if (f) toast.show(f); });
  }, t), [editBlocks, t, toast]);
  const selectedLocs = React.useMemo(() => selectedClips.flatMap((b) => (b.loc ? [b.loc] : [])), [selectedClips]);
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
  /* the preview heard at the loudness the film is delivered at (lib/delivery-loudness): the mix measured as it is
     (again once its sounds, or a file of theirs, change; a moment after the last change), turned by the difference */
  const [deliveryLufs, setDeliveryLufs] = React.useState(deliveryLoudness);
  React.useEffect(() => onDeliveryLoudness(setDeliveryLufs), []);
  const mixKey = React.useMemo(() => (info?.sounds.length
    ? JSON.stringify([info.duration, info.sounds.map((s) => [s.src, s.at, s.from, s.to, s.volume, s.speed, s.fade, mtimeOf.get(s.src)])])
    : ''), [info, mtimeOf]);
  const [mixLufs, setMixLufs] = React.useState<{ key: string; lufs: number | null } | null>(null);
  React.useEffect(() => {
    if (!mixKey || !info) return undefined;
    let live = true;
    const sounds = info.sounds, duration = info.duration;
    const wait = window.setTimeout(() => {
      void api.mixLoudness(projectId, sounds, duration).then((r) => { if (live) setMixLufs({ key: mixKey, lufs: r.lufs }); }, () => {});
    }, 800);
    return () => { live = false; window.clearTimeout(wait); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, mixKey]);
  /* while a change is measured, the last measure stands: the sound does not jump to as-mixed and back */
  React.useEffect(() => { player.current.setDelivery(deliveryGainDb(deliveryLufs, mixKey ? mixLufs?.lufs : null)); }, [deliveryLufs, mixLufs, mixKey]);
  refSource.current = { projectId, version: (path) => mtimeOf.get(path) };
  /* a page clip's pictures are drawn with the changes made inside it (its overrides), by its id: changed, asked again */
  const tweakTokens = React.useMemo(() => {
    const out = new Map<string, string>();
    for (const track of film.film?.tracks ?? []) {
      for (const clip of track.clips) {
        const token = clip.id && filmSrcIsPage(clip.src) ? overridesToken(clip.overrides) : '';
        if (token) out.set(clip.id!, token);
      }
    }
    return out;
  }, [film.film]);
  const thumbs = React.useMemo(() => {
    const out = new Map<string, string>();
    if (!thumbView || !(thumbView.pxPerMs > 0)) return out;
    /* a page's frames change with the files it loads too (filesTick: asked again, an unchanged one answered 304), and
       with the clip's own changes (`clip`, and its token in the version) */
    const media = (path: string, ms: number, clip?: string) => {
      const token = clip ? tweakTokens.get(clip) : undefined;
      return `/api/projects/${encodeURIComponent(projectId)}/media?what=frame&path=${encodeURIComponent(path)}&ms=${Math.round(ms)}&w=${THUMB_CELL_PX * 2}&v=${mtimeOf.get(path) ?? 0}${filmSrcIsPage(path) ? `.${filesTick}` : ''}${token ? `.${token}&clip=${encodeURIComponent(clip!)}` : ''}`;
    };
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
      const token = b.clipId ? tweakTokens.get(b.clipId) ?? '' : '';
      const key = (into: number) => `${mtimeOf.get(b.src!) ?? 0}${token ? `.${token}` : ''}:${clipThumbId(b)}@${into}#v`;
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
        if (at >= own.startMs - stepMs && at <= own.endMs) out.set(key(at), media(b.src!, drawn, b.clipId));
        else margins.push([key(at), media(b.src!, drawn, b.clipId)]);
      }
    }
    for (const [k, u] of margins) if (!out.has(k)) out.set(k, u);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbView, timelineTracks, projectId, mtimeOf, folder, filesTick, tweakTokens]);
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
  /* each drawn once it has had its turn among Studio's media requests (lib/media-queue) */
  const shownPosters = useMediaImages(posters);
  /* the film's picture at the playhead, for the library's filter and effect cards to show themselves on: the frame of
     the video or picture there (the main track's first), else of the film's first; none without one. Kept while it
     plays, read again a second at a time once it stands */
  const frameSecRef = React.useRef(0);
  if (!playing) frameSecRef.current = Math.floor(timeMs / 1000);
  const frameSec = frameSecRef.current;
  const libraryFrame = React.useMemo(() => {
    const film = blocksRef.current.filter((b) => b.kind === 'video' && b.src && !isLibraryClip(b.src));
    if (!film.length) {
      /* none of the person's own in the film: the first video or picture of theirs in the project, never the
         library's sample */
      const own = (listing?.files ?? []).find((f) => (f.kind === 'video' || f.kind === 'image') && !fromLibrary(f.path));
      if (!own) return null;
      if (own.kind === 'image') return `${folder}${own.path.split('/').map(encodeURIComponent).join('/')}?v=${Math.round(own.mtimeMs)}`;
      return `/api/projects/${encodeURIComponent(projectId)}/media?what=frame&path=${encodeURIComponent(own.path)}&ms=${Math.round(Math.min(1000, (own.durationMs ?? 2000) / 2))}&w=360&v=${Math.round(own.mtimeMs)}`;
    }
    const at = frameSec * 1000;
    const here = film.filter((b) => b.startMs <= at && at < b.endMs);
    const main = timelineTracks.find((tr) => tr.main);
    const b = here.find((x) => main?.blocks.some((m) => m.id === x.id)) ?? here[0] ?? film[0]!;
    const into = here.includes(b) ? (at - b.startMs) * (b.speed && b.speed > 0 ? b.speed : 1) : 0;
    const ms = Math.round((b.inMs ?? 0) + into);
    /* a picture as itself: it has no frames to take */
    if (PICTURE_FILE.test(b.src!)) return `${folder}${b.src!.split('/').map(encodeURIComponent).join('/')}?v=${mtimeOf.get(b.src!) ?? 0}`;
    return `/api/projects/${encodeURIComponent(projectId)}/media?what=frame&path=${encodeURIComponent(b.src!)}&ms=${ms}&w=360&v=${mtimeOf.get(b.src!) ?? 0}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameSec, timelineTracks, projectId, mtimeOf, folder, listing]);
  const waveEpoch = React.useRef(Date.now());
  const waveUrl = React.useCallback((src: string) => {
    const mtime = mtimeOf.get(src) ?? 0;
    const version = compoundFolder(src) ? `${mtime}.${waveEpoch.current}.${filesTick}` : mtime;
    return `/api/projects/${encodeURIComponent(projectId)}/media?what=wave&path=${encodeURIComponent(src)}&v=${version}`;
  }, [projectId, mtimeOf, filesTick]);
  /* clips whose files are gone, and where the same name may be now. A file a clip names that the listing does not have
     is gone only once a listing read after it was first named still lacks it: one just brought in as its clip was put
     on the timeline (from Saved, the library) is not in the listing read before, and is not shown missing meanwhile */
  const firstMissedIn = React.useRef(new Map<string, Listing>());
  const [mediaTrouble, awaitingFiles] = React.useMemo(() => {
    const out = new Map<string, 'decode' | 'unreachable' | 'missing'>();
    if (!rawListing) return [out, false] as const;
    const paths = new Set([...rawListing.files.map((f) => f.path), ...rawListing.pages.map((p) => p.path)]);
    let awaiting = false;
    for (const b of blocksRef.current) {
      if (!b.src || !(b.src.startsWith('assets/') || /\.html?$/i.test(b.src))) continue;
      /* a link is listed though it leads nowhere: its file is as gone as one that is not listed */
      if (paths.has(b.src) && !rawListing.links?.[b.src]?.missing) { firstMissedIn.current.delete(b.src); continue; }
      const since = firstMissedIn.current.get(b.src);
      if (!since) firstMissedIn.current.set(b.src, rawListing);
      if (!since || since === rawListing) { awaiting = true; continue; }
      out.set(b.src, 'missing');
    }
    return [out, awaiting] as const;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawListing, timelineTracks]);
  /* the files read again for what is awaited */
  React.useEffect(() => { if (awaitingFiles) void listFiles(); }, [awaitingFiles, rawListing, listFiles]);
  /* while an agent changes the film, a file gone is on its way: its clips wait, and the viewer says nothing of it */
  const agentWorking = useAgentWorking();
  const timelineTrouble = React.useMemo(() => (agentWorking && [...mediaTrouble.values()].includes('missing')
    ? new Map([...mediaTrouble].map(([src, why]) => [src, why === 'missing' ? 'waiting' as const : why])) : mediaTrouble), [agentWorking, mediaTrouble]);
  /** The file of a clip under the playhead that is gone (on a track that is seen), for the viewer to say. */
  const missingHere = React.useMemo(() => {
    if (!mediaTrouble.size) return null;
    const hit = timelineTracks.filter((tr) => !tr.hidden).flatMap((tr) => tr.blocks)
      .find((b) => b.src && mediaTrouble.get(b.src) === 'missing' && timeMs >= b.startMs && timeMs < b.endMs);
    return hit?.src ? hit.src.split('/').pop() ?? hit.src : null;
  }, [mediaTrouble, timelineTracks, timeMs]);
  /** The footage of a clip under the playhead (on a track that is seen) that this browser does not decode and whose
      proxy is not made yet (or could not be): the viewer says so over the picture, which is empty meanwhile. */
  const preparingHere = React.useMemo(() => {
    const pending = Object.entries(proxies).filter(([, p]) => p.needed && p.state !== 'ready');
    if (!pending.length) return null;
    for (const b of timelineTracks.filter((tr) => !tr.hidden).flatMap((tr) => tr.blocks)) {
      if (!b.src || timeMs < b.startMs || timeMs >= b.endMs) continue;
      const hit = pending.find(([path]) => srcHitsAsset(b.src!, path));
      if (hit) return { path: hit[0], ...hit[1] };
    }
    return null;
  }, [proxies, timelineTracks, timeMs]);
  const relinkCandidates = React.useCallback((src: string): string[] => {
    const name = src.split('/').pop()?.toLowerCase();
    return name ? (rawListing?.files ?? []).filter((f) => f.path.split('/').pop()?.toLowerCase() === name && f.path !== src).map((f) => f.path) : [];
  }, [rawListing]);
  const usedSrcs = React.useMemo(() => blocksRef.current.flatMap((b) => (b.src ? [b.src] : [])), [timelineTracks]);

  /* ── media pane actions ── */
  /* media that cannot be found (studio/server/media-reconnect.mjs): asked for when a link leads nowhere or a clip
     names a file that is gone. What Studio finds on its own is connected again unasked, and said once; for the
     rest the person points at the folder it is in now */
  const linkMissing = React.useMemo(() => Object.values(rawListing?.links ?? {}).some((l) => l.missing), [rawListing]);
  const clipMissing = React.useMemo(() => [...mediaTrouble.values()].includes('missing'), [mediaTrouble]);
  React.useEffect(() => {
    if (!linkMissing && !clipMissing) { setMissingMedia([]); return undefined; }
    let live = true;
    void api.missingMedia(projectId).then((missing) => { if (live) setMissingMedia(missing); }, () => {});
    return () => { live = false; };
  }, [projectId, rawListing, linkMissing, clipMissing]);
  /* what "Make another" made is picked once the listing has it (it may have it before the run answers, or after) */
  const [pickWhenListed, setPickWhenListed] = React.useState<string | null>(null);
  React.useEffect(() => {
    const file = pickWhenListed ? listing?.files.find((f) => f.path === pickWhenListed) : undefined;
    if (!file) return;
    setPickWhenListed(null);
    pickMedia(file);
    setRevealMedia((cur) => ({ path: file.path, seq: (cur?.seq ?? 0) + 1, highlight: true }));
  }, [listing, pickWhenListed, pickMedia]);
  const makeAgain = React.useCallback(async (made: MediaMade) => {
    const folder = loaded?.project.path;
    if (!folder || !made.again) return;
    try {
      const receipt = JSON.parse(await api.make(folder, made.again.verb, made.again.args, { via: made.again.via, ...(made.again.model ? { model: made.again.model } : {}) })) as { src?: string; images?: Array<{ src?: string }> };
      const path = receipt.src ?? receipt.images?.[0]?.src;
      if (!path) return;
      setPickWhenListed(path);
      toast.show(t('made.made').replace('{name}', path.slice(path.lastIndexOf('/') + 1)));
    } catch (e) { toast.showError(e instanceof Error ? e.message : String(e)); }
  }, [loaded?.project.path, t, toast]);
  /** What the inspector says of how a file of the project was made. */
  const madeFor = (file: WorkspaceResource): MadeProps | undefined => {
    if (pickedSaved && file === pickedMedia) return undefined;
    const made = mediaMade[file.path];
    return made ? {
      made, sources: mediaSources,
      fileAt: (path) => listing?.files.find((f) => f.path === path),
      onShow: (path) => showFile(path),
      onAgain: () => makeAgain(made),
    } : undefined;
  };
  React.useEffect(() => projectEvents(projectId, (e) => {
    if (e.type !== 'files' || !e.reconnected) return;
    showToast(t('media.reconnected').replace('{n}', String(e.reconnected)));
    /* the picture had nothing to draw for it: drawn again now that it is back */
    preview.current?.reload?.();
  }), [projectId, showToast, t]);
  /* the person's own from this computer, into the project, for a template's places: where they landed */
  const importOwn = React.useCallback(async (): Promise<string[]> => {
    const picked = await onPick(t('template.import'), false);
    if (picked !== 'no-dialog') return picked.length ? onBring(picked, 'assets', 'auto') : [];
    const files = await new Promise<File[]>((done) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'video/*,image/*';
      input.addEventListener('change', () => done([...(input.files ?? [])]));
      input.addEventListener('cancel', () => done([]));
      input.click();
    });
    return files.length ? onImport(files, 'assets', () => {}) : [];
  }, [onPick, onBring, onImport, t]);
  pickReplacementRef.current = async (family) => {
    /* the system's dialog where there is one (the app, or Studio on this computer), else the browser's */
    const picked = await onPick(t('editorTools.replacePick'), false);
    if (picked !== 'no-dialog') {
      if (!picked.length) return null;
      const [at] = await onBring([picked[0]!], 'assets', 'auto');
      return at ?? null;
    }
    const file = await new Promise<File | null>((done) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = family === 'sound' ? 'audio/*,video/*' : 'video/*,image/*,.html,.htm';
      input.addEventListener('change', () => done(input.files?.[0] ?? null));
      input.addEventListener('cancel', () => done(null));
      input.click();
    });
    if (!file) return null;
    const [at] = await onImport([file], 'assets', () => {});
    return at ?? null;
  };

  /* ── files dropped from the computer: imported into assets/ (the media pane's own import), then put on the film ── */
  /** A file just imported, as the media pane would hand it to a drop: its kind from its name, its length and size probed. */
  const resourceOf = React.useCallback(async (path: string): Promise<ResourceDragItem> => {
    const kind = resourceKindOf(path);
    const base: ResourceDragItem = { path, name: path.slice(path.lastIndexOf('/') + 1), kind, dir: '', size: 0, mtimeMs: 0 };
    if (kind !== 'video' && kind !== 'image' && kind !== 'audio') return base;
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
  const dropFiles = React.useCallback((all: File[], hit: AssetLaneHit | null, atMs: number, mode?: EditMode) => {
    const files = takeSubtitleFiles(all, atMs);
    return files.length ? importAndPlace(files, (items) => assetRunInsert(items, tracksRef.current, hit, atMs, mode, stageRef.current), mode) : Promise.resolve(null);
  }, [importAndPlace, takeSubtitleFiles]);
  /* a sound recorded with the timeline's record button: where the playhead was as recording began, on a sound track
     with room there */
  /* words spoken in a voice of the library (VoicesPane's Generate), made by Studio's `get tts` as an agent's are (its
     words timed beside it: its captions come by themselves), put on a sound track at the playhead the same way */
  /* paid runs left pending when Studio or the network went (asked, never saved in the project): said as the project
     opens, with the way to collect them; collecting never makes and pays them again (server/get.mjs recoverRuns) */
  const pendingFolder = loaded?.project.path;
  React.useEffect(() => {
    if (!pendingFolder) return;
    let live = true;
    const post = (what: 'pending' | 'recover') => fetch(`/api/get/${what}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder: pendingFolder }) })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    void post('pending').then((body: { runs?: unknown[] } | null) => {
      const n = body?.runs?.length ?? 0;
      if (!live || !n) return;
      showToast(t('media.pendingRuns').replace('{n}', String(n)), { label: t('media.pendingCollect'), run: () => {
        showToast(t('media.pendingCollecting'));
        void post('recover').then((done: { recovered?: string[]; failed?: { why: string }[] } | null) => {
          const got = done?.recovered?.length ?? 0, lost = done?.failed?.length ?? 0;
          showToast(lost ? t('media.pendingSome').replace('{n}', String(got)).replace('{m}', String(lost)) : t('media.pendingDone').replace('{n}', String(got)));
        });
      } });
    });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFolder]);
  const speakVoice = React.useCallback(async (voice: LibraryVoice, access: VoiceAccess, text: string): Promise<VoiceSpeech | string> => {
    const folder = loaded?.project.path;
    if (!folder) return t('timeline.editFail');
    const res = await fetch('/api/get', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        folder, verb: 'tts', via: access.via, ...(access.models[0] ? { model: access.models[0] } : {}),
        /* named by what it says and in whose voice: asked again after an interruption, the paid take is recovered */
        args: { text, voice: voice.id, out: `vo-${stableName(`${access.via}\0${voice.id}\0${text}`)}` },
      }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null) as { ok?: boolean; text?: string } | null;
    if (!body?.ok) return body?.text ?? t('timeline.editFail');
    let made: { src?: string; dur?: number } | null = null;
    try { made = JSON.parse(body.text ?? '') as { src?: string; dur?: number }; } catch { made = null; }
    if (!made?.src) return t('timeline.editFail');
    const durMs = Math.round((made.dur ?? 0) * 1000) || undefined;
    const items = [{ path: made.src, name: made.src.replace(/^.*\//, ''), kind: 'audio', ...(durMs ? { durationMs: durMs } : {}) } as ResourceDragItem];
    return { src: made.src, url: new URL(made.src, loaded.folder).href, add: async () => {
      const atMs = snapToFrame(timeRef.current);
      const plan = assetRunInsert(items, tracksRef.current, soundLaneHit(tracksRef.current, atMs, assetRunMs(items)), atMs);
      if ('error' in plan) return plan.error === 'locked' ? t('timeline.trackLocked') : t('timeline.dropNotClip');
      const why = await edit(plan.inserts.map((i): Op => ({ op: 'insert', clip: i.element as never, at: i.at, ...(i.track != null ? { track: i.track } : {}) })), 'history.stepDrop');
      if (!why) toast.show(t('voiceSpeak.made'));
      return why;
    } };
  }, [loaded, edit, toast, t]);
  /* recording from the microphone (voice-over's Record tab): the edit's own, so it goes on while that panel is closed */
  const recorder = useRecorder(React.useMemo(() => ({
    now: () => snapToFrame(timeRef.current),
    onSave: (file: File, atMs: number) => importAndPlace([file], (items) => (
      assetRunInsert(items, tracksRef.current, soundLaneHit(tracksRef.current, atMs, assetRunMs(items)), atMs))),
  }), [importAndPlace]));
  /* on the picture: at the playhead, pictures on a new track on top, sounds on a sound track */
  const dropFilesOnPicture = React.useCallback((all: File[]) => {
    const atMs = snapToFrame(timeRef.current);
    const files = takeSubtitleFiles(all, atMs);
    if (!files.length) return Promise.resolve(null);
    return importAndPlace(files, (items) => {
      const sounds = items.filter((f) => f.kind === 'audio');
      const pictures = items.filter((f) => f.kind !== 'audio');
      const tracks = tracksRef.current;
      const heard = sounds.length ? assetRunInsert(sounds, tracks, soundLaneHit(tracks, atMs, assetRunMs(sounds)), atMs) : { inserts: [] };
      const seen = pictures.length ? assetRunInsert(pictures, tracks, { lane: -1, band: 'body' }, atMs, undefined, stageRef.current) : { inserts: [] };
      /* the sounds first: the pictures' new track goes in at the top and moves every track under it down one */
      const inserts = [...('inserts' in heard ? heard.inserts : []), ...('inserts' in seen ? seen.inserts : [])];
      if (inserts.length) return { inserts };
      return 'error' in seen ? seen : 'error' in heard ? heard : { error: 'not-clip' };
    });
  }, [importAndPlace, takeSubtitleFiles]);
  const [pictureDrop, setPictureDrop] = React.useState(false);
  /* the cover a sound of the library shows over the picture is the shell's drawer's, put there from another React
     root: what is dragged over it reaches the picture's handlers now, and is left alone as it was before */
  const overLibraryCover = (e: React.DragEvent) => Boolean(libraryPreviewPicture?.contains(e.target as Node));
  const pictureDropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (overLibraryCover(e) || !isComputerFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setPictureDrop(true);
    },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPictureDrop(false); },
    onDrop: (e: React.DragEvent) => {
      if (overLibraryCover(e)) return;
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

  /* ── picture: the delivery frame, fullscreen ── */
  const stage = film.film?.stage ?? { w: 1920, h: 1080 };
  stageRef.current = stage;
  const empty = !film.film?.tracks.some((tr) => tr.clips.length);
  /* the canvas (the stage in film.html), from the viewer's ratio button or the inspector: another shape
     keeps the canvas's short side (canvasFor; a typed size is that size), and every picture on it is scaled by one
     factor into the new canvas, centered, in the same edit (one undo). Laying the film out again for the new canvas
     is the agent's (the inspector gives the words) */
  /* "Fit (original)": the shape of the film's first picture (canvas-fit's firstPictureSize) */
  const originalSize = React.useMemo(() => firstPictureSize((film.film?.tracks ?? []).flatMap((track) => track.clips), spans), [spans, film.film]);
  /** The edit that makes the canvas `size`, the film fitted into it (see canvas-fit). */
  const canvasOps = React.useCallback((size: { w: number; h: number }): Op[] => {
    const own = new Map(spans.map((span) => [span.id, span.w && span.h ? { w: span.w, h: span.h } : null]));
    const reflows = new Set(spans.filter((span) => span.reflows).map((span) => span.id));
    const looks = new Map(spans.map((span) => [span.id, span.look]));
    const clips = (film.film?.tracks ?? []).flatMap((track) => track.clips.map((clip) => ({
      id: clip.id,
      kind: clip.sound ? 'sound' as const : filmSrcKind(clip.src),
      own: own.get(clip.id) ?? null,
      box: (clip.box as FilmBox | undefined) ?? null,
      reflows: reflows.has(clip.id),
      size: clip.size ?? null,
      fit: looks.get(clip.id)?.fit ?? null,
      position: positionOf(looks.get(clip.id)?.position),
    })));
    return [
      { op: 'stage', w: size.w, h: size.h },
      ...fitToCanvas(clips, stage, size).flatMap((fit) => [
        { op: 'set' as const, clip: fit.id, field: 'box', value: fit.box },
        ...(fit.size ? [{ op: 'set' as const, clip: fit.id, field: 'size', value: fit.size }] : []),
      ]),
    ];
  }, [stage, spans, film.film]);
  /* a canvas size shown on the picture while its width or height is dragged, not kept yet */
  const [canvasDraft, setCanvasDraft] = React.useState<{ w: number; h: number } | null>(null);
  const shownStage = canvasDraft ?? stage;
  /* the picture is the canvas, nothing around it: another shape is another canvas (a delivery frame is the export's) */
  const frameBox = React.useMemo(() => filmFrameBox(shownStage, 'native'), [shownStage]);
  const previewCanvas = React.useCallback((size: { w: number; h: number } | null) => {
    const value = film.film;
    if (!value) return;
    if (!size || (size.w === stage.w && size.h === stage.h)) {
      setCanvasDraft((cur) => { if (cur) preview.current?.update(value); return null; });
      return;
    }
    let shown: Film;
    try { shown = applyOps(structuredClone(value), canvasOps(size)) as Film; } catch { return; }
    setCanvasDraft(size);
    preview.current?.update(shown);
  }, [film.film, stage, canvasOps]);
  const changeCanvas = React.useCallback((next: FilmFrameId, given?: { w: number; h: number }) => {
    const size = given ?? canvasFor(stage, next);
    setCanvasDraft(null);
    if (size.w === stage.w && size.h === stage.h) { if (canvasDraft && film.film) preview.current?.update(film.film); return; }
    void edit(canvasOps(size), 'history.stepEdit');
  }, [edit, stage, canvasOps, canvasDraft, film.film]);
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
  /** Play at this speed from now on (the viewer's playback settings, the full-screen player's). */
  const setSpeed = React.useCallback((speed: number) => {
    player.current.setRate(speed);
    speedRef.current = player.current.rate;
    setRateState(player.current.rate);
  }, []);
  /* full screen only: elsewhere K, M, C and F are the editor's keys */
  useFullscreenKeys({
    enabled: fullscreen,
    onToggle: toggle,
    onToggleMute: () => { player.current.setMuted(!player.current.muted); setMutedState(player.current.muted); },
    onExit: toggleFullscreen,
  });

  /*
   * ── keys (lib/keymap, the scheme chosen in Settings; by default): Space plays, J / K / L shuttle, I / O mark a range,
   * ← / → step a frame (⇧ ten), ↑ / ↓ go from cut to cut, ⌘Z / ⇧⌘Z undo; the timeline's own (⌘B, Q / W, ⌥← / →, N…)
   * through its commands. Not while typing, nor in a dialog. ──
   */
  const tabbed = React.useRef(false);
  React.useEffect(() => {
    const byKey = (e: KeyboardEvent) => { if (e.key === 'Tab') tabbed.current = true; };
    const byPointer = () => { tabbed.current = false; };
    window.addEventListener('keydown', byKey, true);
    window.addEventListener('pointerdown', byPointer, true);
    return () => { window.removeEventListener('keydown', byKey, true); window.removeEventListener('pointerdown', byPointer, true); };
  }, []);
  /* K (stop) held down: J and L (back, forward) step a frame (K+J, K+L) */
  const kHeld = React.useRef(false);
  React.useEffect(() => {
    const up = (e: KeyboardEvent) => {
      const key = parseCombo(comboOf({ key: e.key, code: e.code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }, MAC) ?? '')?.key;
      if (key && currentKeymap()['shuttle-stop'].some((combo) => parseCombo(combo)?.key === key)) kHeld.current = false;
    };
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
    const refer = chat.refer;
    const el = event.target as HTMLElement | null;
    if (!refer || event.defaultPrevented || isTypingTarget(el) || el?.closest?.('[role="dialog"]')) return false;
    if (keyAction(event) === 'refer') {
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
    /* the cover design (a window over the edit) has keys of its own */
    if (document.querySelector('[data-cover-design]')) return;
    const cmd = keyAction(event);
    if (cmd === 'undo' || cmd === 'redo') {
      if (isTypingTarget(el) || el?.closest('[role="dialog"]')) return;
      /* not checked against canUndo: a nudge on the picture not written yet is written first, and is the step undone */
      event.preventDefault();
      stepHistory(cmd);
      return;
    }
    if (cmd === 'play-pause') {
      /* the library's panes are Studio's own: Space plays there too (its "+" just pressed is not pressed again), but
         not in its search field */
      if (el?.closest?.('[data-studio-library]') ? isTextField(el) : isTypingTarget(el)) return;
      if (event.repeat) { event.preventDefault(); return; }
      if (el?.closest('[role="dialog"]')) return;
      if (tabbed.current && el?.closest('button, a, [role="button"]')) return;
      event.preventDefault();
      const active = document.activeElement;
      if (!tabbed.current && active && active !== document.body && 'blur' in active) (active as HTMLElement).blur();
      if (!player.current.playing && !pickedMedia) {
        const from = timelineCommands.current?.takeSkim();
        if (from != null) seek(from);
      }
      toggle();
      return;
    }
    if (event.defaultPrevented || isTypingTarget(el) || el?.closest?.('[role="dialog"]')) return;
    /* Esc lets the range go as it lets the selection go (those listen on their own); a menu or a panel open takes it */
    if (event.key === 'Escape' && !document.querySelector('[role="menu"], [role="listbox"], [data-popover-panel]')) {
      if (dismissLibraryPreview.current()) { event.preventDefault(); return; }
      if (markedRange) setMarkedRange(null);
    }
    if (!cmd) return;
    /* a menu or a list open has the arrows; a slider (the ruler, a volume) steps itself with ← / → */
    if (el?.closest?.('[role="menu"], [role="listbox"]') && (/^(frame|second|prev|next|start|end|nudge|overwrite-track)/.test(cmd))) return;
    if (el?.closest?.('[role="slider"], input[type="range"]') && /^(frame|second|start|end)/.test(cmd)) return;
    const commands = timelineCommands.current;
    const now = player.current.time() * 1000;
    const go = (ms: number) => { pause(); seek(Math.max(0, Math.min(totalMs, ms))); };
    const take = () => event.preventDefault();
    const once = !event.repeat;
    switch (cmd) {
      case 'preview-fullscreen':
        if (!(totalMs > 0)) return;
        take();
        if (once) toggleFullscreen();
        return;
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
      case 'compare-grades':
        take();
        if (once) setUngraded((on) => !on);
        return;
      case 'play-range':
        if (!(totalMs > 0)) return;
        take();
        if (!once) return;
        if (markedRange) playRange(markedRange); else toggle();
        return;
      case 'frame-back': case 'frame-forward': case 'jump-back': case 'jump-forward': case 'start': case 'end': {
        if (!(totalMs > 0)) return;
        take();
        /* a frame (or ten, ⇧) on from the frame the playhead is on, so stepping never drifts */
        const frames = (cmd.endsWith('back') ? -1 : 1) * (cmd.startsWith('jump') ? JUMP_FRAMES : 1);
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
      case 'toggle-clip': {
        const edits = toggleClipEdits(selectedClips);
        if (!edits.length) return;
        take();
        if (once) void editBlocks(edits);
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
      case 'range-clip': {
        /* ⇧X: the range is the selected clips' span */
        if (!selectedBlocks.length) return;
        take();
        setMarkedRange({ startMs: Math.min(...selectedBlocks.map((b) => b.startMs)), endMs: Math.max(...selectedBlocks.map((b) => b.endMs)) });
        return;
      }
      case 'copy-attrs': if (!selectedBlocks.length) return; take(); if (once) copyAttrs(selectedClips); return;
      case 'paste-attrs': if (!selectedBlocks.length) return; take(); if (once) askPasteAttrs(selectedClips); return;
      case 'speed': {
        /* ⌘R: the selected clip's speed, in the inspector */
        if (selectedBlocks.length !== 1 || !once) return;
        take();
        setInspectorContent('selection');
        setInspectorOpen(true);
        /* the number beside the slider: typed into at once */
        window.setTimeout(() => document.querySelector<HTMLInputElement>(`[data-speed-field] input[aria-label="${t('inspector.speed')}"]:not([type=range])`)?.focus(), 80);
        return;
      }
      case 'compound': {
        /* ⌥G: the selected clips made one compound clip */
        const picked = selectedBlocks.filter((b) => b.clipId);
        if (!picked.length || !once) return;
        take();
        void makeCompound(picked).then((err) => { if (err) toast.showError(err); });
        return;
      }
      case 'uncompound': {
        /* ⌥⇧G: the selected compound clip taken apart */
        const held = selectedBlocks.find((b) => compoundFolder(b.src));
        if (!held || !once) return;
        take();
        void breakCompound(held).then((err) => { if (err) toast.showError(err); });
        return;
      }
      case 'detach-audio': {
        /* ⇧⌃S: the selected videos' sounds, each on a track of its own */
        const videos = selectedBlocks.filter(hasSoundToDetach);
        if (!videos.length || !once) return;
        take();
        void detachAudio(videos).then((err) => { if (err) toast.showError(err); });
        return;
      }
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
      case 'overwrite-track-down': case 'overwrite-track-up':
        if (!selectedBlocks.length) return;
        take();
        if (once) commands.overwriteTrack(cmd === 'overwrite-track-up' ? -1 : 1);
        return;
      case 'zoom-fit': take(); commands.zoomFit(); return;
      case 'toggle-skimming': take(); if (once) commands.toggleSkimming(); return;
      case 'select-left': case 'select-right': take(); if (once) commands.selectSide(cmd === 'select-left' ? -1 : 1); return;
      case 'ripple-start': take(); if (once) commands.rippleTrimStart(); return;
      case 'ripple-end': take(); if (once) commands.rippleTrimEnd(); return;
      case 'toggle-snap': case 'toggle-magnet': case 'toggle-linkage': {
        take();
        if (!once) return;
        const pref = cmd === 'toggle-snap' ? 'snap' : cmd === 'toggle-magnet' ? 'magnet' : 'linkage';
        const on = !readTimelinePrefs()[pref];
        if (pref === 'snap') commands.toggleSnap();
        else if (pref === 'magnet') commands.toggleMagnet();
        else commands.toggleLinkage();
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
  /* ⌘V with the picture's keyboard pastes what was copied last, as the timeline's does (which does not hear it) */
  const pasteKeyRef = React.useRef<() => void>(() => {});
  pasteKeyRef.current = () => {
    if (!layerBoardRef.current && !clipboard.length) return;
    const lane = selectedBlocks[0] ? laneOfBlock(timelineTracks, selectedBlocks[0].id) : null;
    void pasteAt(lane, timeRef.current).then((f) => { if (f) toast.show(f); });
  };
  const previewKey = React.useCallback((event: KeyboardEvent) => {
    if (keyAction(event) === 'paste' && !event.defaultPrevented) { event.preventDefault(); pasteKeyRef.current(); return; }
    onKeyRef.current(event);
  }, []);

  /* ── top bar: title, menus, panels ── */
  /* the film as a whole, for the inspector when nothing is selected, and its tracks' badges */
  const filmSummary = React.useMemo(() => {
    const tracks = film.film?.tracks ?? [];
    return { title, durationMs: totalMs, tracks: tracks.length, clips: tracks.reduce((n, tr) => n + tr.clips.length, 0), empty, badges: filmTrackBadges(tracks) };
  }, [title, totalMs, film.film?.tracks, empty]);
  /* the film at the playhead, drawn by Studio as the projects list will show it */
  const coverFromFrame = () => {
    if (previewError || totalMs <= 0) { toast.show(t('project.filmNotReady')); return; }
    void api.setCover(projectId, { ms: Math.max(0, Math.min(totalMs - 1, timeRef.current)) })
      .then(coverSet, () => toast.showError(t('projects.coverFailed')));
  };
  /* ── the film's covers (lib/covers, studio/server/covers.mjs): the tile at the head of the main track opens the cover
     design, a large window over the edit (components/cover/CoverDesigner); the film stays as it is under it ── */
  const [coverList, setCoverList] = React.useState<CoverList | null>(null);
  const [coverOpen, setCoverOpen] = React.useState(false);
  const readCovers = React.useCallback(() => void coversApi.list(projectId).then(setCoverList, () => {}), [projectId]);
  React.useEffect(() => { if (!coverOpen) readCovers(); }, [coverOpen, readCovers]);
  const mainCoverInfo = coverList?.covers.find((c) => c.folder === coverList.main) ?? null;
  const exportCovers = (folders: string[]) => {
    if (!folders.length) return;
    void coversApi.draw(projectId, folders).then(({ files }) => toast.show(t('covers.exported').replace('{n}', String(files.length))),
      (e) => toast.showError(t('covers.failed').replace('{error}', e instanceof Error ? e.message : String(e))));
  };
  const coverTile = React.useMemo(() => ({
    thumb: mainCoverInfo ? coverThumb(projectId, mainCoverInfo, 200) : null,
    open: () => setCoverOpen(true),
    menu: (): ContextMenuEntry[] => [
      { id: 'open', label: mainCoverInfo ? t('covers.menuOpen') : t('covers.tileNewTip'), onSelect: () => setCoverOpen(true) },
      ...(coverList?.covers.length ? [{ id: 'export', label: t('covers.menuExport'), onSelect: () => exportCovers(coverList.covers.map((c) => c.folder)) }] : []),
    ],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [mainCoverInfo, coverList, projectId, t]);
  /* captions of what is said (the library's captions): what went wrong, shown there; with no service to transcribe, it opens Services */
  const [subtitleProblem, setSubtitleProblem] = React.useState<{ text: string; connect: boolean } | null>(null);
  const [captionsMaking, setCaptionsMaking] = React.useState(false);
  /**
   * The library's New captions of what is said: by every clip with a transcript and those ticked; in the words said
   * (`original`, on the track of speech, else a new one), translated (on a track of its own), or both.
   */
  const makeCaptions = React.useCallback(async ({ original, translate }: CaptionsMake) => {
    setSubtitleProblem(null);
    setCaptionsMaking(true);
    try {
      const chosen = heardClips.filter((h) => h.transcribed || captionPicked.has(h.clipId));
      /* the chosen clips with no transcript yet are transcribed first; those with one are used as they are (a voice made
         with its words timed is never heard again), and made captions even when the rest cannot be transcribed (which
         the library then says, and why) */
      const need = [...new Set(chosen.filter((h) => !h.transcribed).map((h) => h.src))];
      if (need.length) {
        const r = await subs.transcribe(need);
        if (!r.ok) {
          setSubtitleProblem({ text: r.error ?? '', connect: !!r.needsTranscriber });
          if (!chosen.some((h) => h.transcribed)) return;
        }
      }
      /* what speaks is what has its words (a clip not ticked has none): the captions follow whatever speaks from now on */
      const src = original ? await captionsFromSpeech(null) : null;
      if (original && !src) return;
      if (translate && src) await translateTrack({ src }, translate);
      else if (translate) {
        /* the translation alone: of what is said, kept nowhere in the words said */
        const got = await fetch(`/api/projects/${encodeURIComponent(projectId)}/caption-tracks/speech`).then((r) => (r.ok ? r.json() : null), () => null) as { text?: string } | null;
        if (!got?.text?.includes('-->')) { toast.show(t('timeline.captionsNone')); return; }
        await translateTrack({ text: got.text, name: `${t('captionTrack.fileName')}.${translate}` }, translate);
      }
    } finally { setCaptionsMaking(false); }
  }, [subs, heardClips, captionPicked, captionsFromSpeech, translateTrack, projectId, toast, t]);
  /** The library's New captions of a subtitle file: as it is, translated, or both. */
  const captionsFromFile = React.useCallback(async (file: File, { original, translate }: CaptionsMake) => {
    setCaptionsMaking(true);
    try {
      const src = original ? await newCaptionTrack(file) : null;
      if (original && !src) return;
      if (translate) await translateTrack(src ? { src } : { text: await file.text(), name: `${file.name.replace(/\.[^.]+$/, '')}.${translate}` }, translate);
    } finally { setCaptionsMaking(false); }
  }, [newCaptionTrack, translateTrack]);
  /* the project's version history is the shell's (shell/history); what it asks of the edit is given with the rest
     below (provide): before it saves a version or puts files back, playing stopped and the edits still waiting to be
     written landed first, so the version holds what the person sees and a restore is not undone by them; once a
     version is put back, here or in another window, the folder's files changed under the editor: its undo steps were
     of the film before, and the film, its settings, markers and captions are read again (each where it is kept:
     use-editor-tools, use-film-subtitles, caption-tracks) */
  const forHistory = React.useRef({ settle: () => film.settled(), restored: () => {} });
  forHistory.current = {
    settle: () => { pause(); return film.settled(); },
    restored: () => {
      film.forget();
      readFilm();
      void api.settings(projectId).then(setSettings, () => {});
    },
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

  /* what the shell reaches of the edit when it needs it (shell/frame): the picture drawn again, the files the film
     plays; what changing the workbench shown asks of the edit (playing stopped, Motion's panes opened); what the
     layout reads of the edit's panes; what the library does here; and what the edit has on the top bar (below). The
     edit's own functions are called as the latest render made them */
  const forShell = React.useRef({ addFromCanvas, sendFromCanvas, listing });
  forShell.current = { addFromCanvas, sendFromCanvas, listing };
  /* what others put in the film (openfilm/studio addTo: the canvas's file, or its cut, then the film shown), by path;
     the links to the film it shows (lib/links: a clip, a moment, a stretch, as the app's commands they stand for); and
     the app's commands that are the edit's (openfilm/studio onCommand) */
  React.useEffect(() => provide('edit', {
    opens: [FILM],
    show: (link) => {
      const command = filmCommandOf(parseLink(link)?.fragment ?? null);
      if (command) hostCommands.current(command);
    },
    add: (paths, { show }) => {
      const { listing: listed } = forShell.current;
      const all = listed ? [...listed.files, ...listed.pages] : [];
      const files = paths.flatMap((path) => all.find((f) => f.path === path) ?? []);
      if (show) { void forShell.current.sendFromCanvas(files); return; }
      void (async () => { for (const file of files) await forShell.current.addFromCanvas(file); })();
    },
    settle: () => forHistory.current.settle(),
    restored: () => forHistory.current.restored(),
  }), []);
  React.useEffect(() => onCommand((command) => hostCommands.current(command)), []);
  /* the window is laid out by the shell (shell/layout); how the edit's blocks are drawn there is given here, for
     wherever they are and for the layout's menu, which draws each arrangement with it: each shown or not, its size
     (the layers' kept width while hidden, which rearranging begins from), its seam, and the timeline's fit */
  const blockSizer = React.useCallback<BlockSizer>((room, places, free) => {
    const drawn = editSizes(room, places, free);
    return {
      viewer: { shown: true, size: 0 },
      layers: { shown: drawn.layersShown, size: drawn.layersShown ? drawn.layersShownWidth : drawn.layersWidth, seam: { min: 180, minRest: MIN_VIEWER, label: t('layers.resize') } },
      inspector: { shown: drawn.inspectorShown, size: drawn.inspectorShownWidth, seam: { min: MIN_INSPECTOR, minRest: MIN_VIEWER, label: t('inspector.resize') } },
      timeline: { shown: drawn.timelineShown, size: drawn.timelineShownHeight, seam: { min: MIN_DOCK_H, minRest: MIN_STAGE_H, label: t('timeline.resize') }, fit: timelineFit },
    };
  }, [editSizes, timelineFit, t]);
  /* the library is the shell's (shell/library); what it does in the edit is given here: a file of the media pane put in
     the film at the playhead or taken in hand (shown in the viewer and the inspector), the library's things added or
     tried over the picture, the captions, the voices. Each the same one until it changes (useSteady) */
  const libraryCaptions = useSteady<CaptionsActions>({
              heard: heardClips, making: captionsMaking || subs.transcribing, problem: subtitleProblem,
              picked: captionPicked, pick: pickCaptionClip, choosing: setCaptionChoosing,
              speechTrack: speechRow?.badge ?? null, captionTrack: captionRow?.badge ?? null,
              speechAuto: Boolean(speechSrc && cuesOf(speechSrc) && untouchedSpeech(cuesOf(speechSrc)!)),
              make: (o) => void makeCaptions(o), connect: () => { setSubtitleProblem(null); openSettings('models'); },
              fromFile: (file, o) => void captionsFromFile(file, o), addOne: () => void captionHere(),
              addTrack: async () => { await newCaptionTrack(null); },
  });
  const libraryPreview = useSteady({ bar: libraryPreviewBar, picture: fullscreen ? null : libraryPreviewPicture, dismissRef: dismissLibraryPreview, begin: beginLibraryPreview });
  const shellLibrary = useSteady({
    add: (file: WorkspaceResource, saved: boolean) => { if (saved) void placeSaved(file, { atPlayhead: true }); else void addMedia(file, { atPlayhead: true }); },
    pickedPath: pickedMedia?.path ?? null, pickedSaved,
    pick: (file: WorkspaceResource | null, how?: { saved?: boolean; quiet?: boolean }) => {
      /* with the canvas over the viewer: in hand only, nothing paused or opened */
      if (how?.quiet) { setPickedMedia(file); setPickedSaved(false); return; }
      pickMedia(file);
      if (how?.saved) setPickedSaved(Boolean(file));
    },
    usedSrcs, onDropClipsForAssets: dropClipsForAssets, litPath: chatPoint?.file ?? null,
    actions: library.actions, tried: libraryTrial?.id ?? null, templateStatus,
    preview: libraryPreview, captions: libraryCaptions, speak: speakVoice, recorder,
  });
  /* the top bar is the shell's (shell/top-bar); what the edit has on it is given here, and drawn there in the shell's
     own React root: the edit's own buttons (its export and the exports' tray: the
     canvas has its own bars), the picked keyframes' menu, which is kept in the bar, what the edit knows of the film
     for the project's card, and the picture at the playhead made the cover. Each the same one until what it shows
     changes: the buttons call the edit's functions as the latest render made them */
  const barDoes = useSteady({
    coverFromFrame,
    askExport: () => {
      if (previewError) toast.showError(`${t('project.filmCannotExport')} ${previewError}`);
      else if (totalMs > 0) setExportOpen(true);
      else toast.show(t('project.filmNotReady'));
    },
  });
  /* the film's export wherever a workbench of the film is shown (the edit, Screening…); not over the canvas, which
     makes material and has bars of its own */
  const exportAway = canvasOpen;
  const topBarTools = React.useMemo(() => (<>
    {exportAway ? null : (<>
    <Tooltip label={t('projectMenu.export')} side="bottom">
      <button type="button" aria-label={t('projectMenu.export')} aria-haspopup="dialog" aria-expanded={exportOpen} className={TOP_BTN}
        onClick={() => barDoes.askExport()}>
        <Upload size={16} />
      </button>
    </Tooltip>
    </>)}
    <ExportTray ref={exportTrayRef} projectId={projectId} onError={showError} />
  </>), [barDoes, exportAway, exportOpen, projectId, showError, t]); // eslint-disable-line react-hooks/exhaustive-deps
  /* open only for a moment: made anew by each render meanwhile */
  const topBarMenu = keyMenu ? <ContextMenu x={keyMenu.x} y={keyMenu.y} dense items={keyMenuItems} onClose={() => setKeyMenu(null)} /> : null;
  const stageW = stage.w, stageH = stage.h, filmClips = filmSummary.clips;
  const topBarFilm = React.useMemo(() => ({ durationMs: totalMs, stage: { w: stageW, h: stageH }, fps: projectFps, clips: filmClips }), [totalMs, stageW, stageH, projectFps, filmClips]);
  const shellTopBar = React.useMemo(() => ({ tools: topBarTools, menu: topBarMenu, film: topBarFilm, coverFromFrame: barDoes.coverFromFrame }), [topBarTools, topBarMenu, topBarFilm, barDoes]);
  usePublishWiring('edit', React.useMemo(() => ({
    reloadPicture: () => preview.current?.reload?.(),
    srcsInUse: () => blocksRef.current.flatMap((b) => (b.src ? [b.src] : [])),
    pause: () => pauseRef.current(),
    motionShown: () => { openBlockRef.current('timeline', true); openBlockRef.current('inspector', true); },
    blocks: blockSizer,
    library: shellLibrary,
    topBar: shellTopBar,
  }), [blockSizer, shellLibrary, shellTopBar]));

  /* The page is the shell's (shell/ProjectFrame), and so is its top bar (shell/top-bar). In the edit's own element are
     only the edit's panes; the edit's own dialogs, which lie over the page, are put into the shell's places from here. */
  /* the shell draws the loading screen, and why the project could not be read */
  if (failure || !loaded) return null;

  const value = film.film;
  const viewerReady = Boolean(info);
  return (
    <>
          {/* the panes, each drawn into its block's place, which the shell lays out among the page's panels
              (shell/arrangement) with the seams between them */}
          <>
            <>
              {layersShown ? (
                <InBlock id="layers">
                  <div ref={layersPaneRef} className={`${PANE} flex-1 bg-[var(--bg-panel)]`} data-workspace-layers>
                    <LayersPanel
                      ask={askStage}
                      timeMs={timeMs}
                      playing={playing}
                      filmKey={layersKey}
                      clipOf={layerClipOf}
                      selected={layersSelected}
                      selectedClipLocs={selectedLocs}
                      captions={layerCaptions}
                      onSelectRows={selectLayerRows}
                      onPoint={setPointedLayer}
                      onToggle={toggleLayerRow}
                      onDelete={deleteLayerRow}
                      onMenu={openLayerMenu}
                      onRestack={restackLayers}
                      onNotify={toast.show}
                      width={layersShownWidth}
                      onClose={() => { setPointedLayer(null); setLayersPaneOpen(false); }}
                    />
                  </div>
                </InBlock>
              ) : null}

              <InBlock id="viewer">
              <div className={`${PANE} min-w-0 flex-1 bg-[var(--bg-viewer)]`} data-viewer-pane="" inert={coverOpen}>
                <div className={PANE_BAR}>
                  {/* in a browser, the library opened or closed (the layers are in the layout's menu); in the app, whose
                      chat has the library's button, the layers and the inspector shown or hidden where the arrangement has them */}
                  {!studioHost ? (
                  <Tooltip label={t('assetDrawer.library')} side="bottom">
                    <button type="button" data-viewer-library="" aria-pressed={libraryPane.open} onClick={() => openLibrary(!libraryPane.open)}
                      aria-label={t('assetDrawer.library')}
                      className={`${PANE_TOGGLE} ${libraryPane.open ? PANE_BTN_ON : ''}`}>
                      <LibraryBig size={PANE_TOGGLE_ICON} />
                    </button>
                  </Tooltip>
                  ) : own.places.layers ? (
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
                  ) : null}
                  <span className="min-w-0 flex-1" />
                  {own.places.inspector ? (
                  <Tooltip label={t(inspectorOpen ? 'inspector.hide' : 'inspector.show')} side="bottom">
                    <button type="button" onClick={() => setInspectorOpen(!inspectorOpen)}
                      aria-label={t(inspectorOpen ? 'inspector.hide' : 'inspector.show')}
                      className={`${PANE_TOGGLE} ${inspectorOpen ? PANE_BTN_ON : ''}`}>
                      <Settings2 size={PANE_TOGGLE_ICON} />
                    </button>
                  </Tooltip>
                  ) : null}
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
                    {/* a bundle of Saved plays its page as its clip had it; any other bundle shows its picture */}
                    <SourcePreview file={pickedSaved && pickedMedia.bundle && !pickedMedia.bundle.page && !pickedMedia.bundle.file ? { ...pickedMedia, kind: 'image' } : pickedMedia} saved={pickedSaved} sources={pickedSaved ? savedSources : mediaSources} onClose={() => pickMedia(null)} onPlace={placeFromSource} />
                  </div>
                ) : null}
                {dropped?.length || undone.length ? (
                  <div role="status" className="@container mx-3 mt-1.5 shrink-0 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-1 text-[12.5px] text-[var(--text)]">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {/* edits inside pages left out and clip edits changed back are one thing to the person: their edits, undone */}
                      <span className="min-w-0 basis-full truncate @xs:basis-0 @xs:flex-1" title={t('project.editsUndone').replace('{n}', String(undoneCount))}>
                        <span className="hidden @xl:inline">{t('project.editsUndone').replace('{n}', String(undoneCount))}</span>
                        <span className="@xl:hidden">{t('project.editsUndoneShort').replace('{n}', String(undoneCount))}</span>
                      </span>
                      <button type="button" onClick={() => void restoreDropped()} className="shrink-0 rounded-md bg-[var(--primary)] px-2.5 py-1 text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)]">{t('project.editsRestore')}</button>
                      <button type="button" onClick={() => { setDropped(null); for (const e of undone) settledEdits.current.add(e); setUndone([]); }} className="shrink-0 rounded-md px-2 py-1 text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">{t('project.editsLeaveOut')}</button>
                    </div>
                  </div>
                ) : null}
                {/* select-none: a press here is the stage's (a click, a box drawn from the dark around the picture); the
                    browser's own text selection went with it over the film's video and frames and tinted them blue */}
                <div className="relative flex min-h-0 flex-1 select-none items-center justify-center px-3 py-2.5" style={{ containerType: 'size' }} {...pictureDropProps}
                  data-viewer-picture="" data-viewer-focus={viewerFocus ? '1' : '0'}>
                  <div ref={setLibraryPreviewPicture} className="contents" />
                  {pictureDrop ? (
                    <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] ring-2 ring-inset ring-[var(--accent)]">
                      <span className="rounded-md bg-[var(--bg-raised)] px-2.5 py-1 text-[12.5px] text-[var(--text)] shadow-sm">{t('project.dropOnPicture')}</span>
                    </div>
                  ) : null}
                  {filmMissing ? (
                    <div data-film-missing="" className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-4">
                      <p role="status" className="max-w-[min(30rem,90%)] rounded-lg bg-black/70 px-3.5 py-2 text-center text-[12.5px] leading-snug text-white/90">{t('project.filmMissing')}</p>
                    </div>
                  ) : null}
                  {value ? (
                    <div ref={stageFullRef} className={`relative flex h-full w-full items-center justify-center ${fullscreen ? 'bg-black' : ''}`}
                      style={{ containerType: 'size' }} onClick={fullscreen ? toggle : undefined}>
                      <ViewerZoom store={viewerZoom} frame={frameBox} off={fullscreen}
                        className={`relative bg-black ${frameBox.inner.left < -0.5 || frameBox.inner.top < -0.5 ? 'overflow-hidden' : 'overflow-visible'}`}
                        notices={<>
                          {/* a clip under the playhead whose file is gone plays as nothing (src/timeline.mjs, film-missing):
                              said here, over the picture, with what to do; in sight at any zoom */}
                          {statsOn && playing && played ? (
                            <div data-playback-stats="" className="pointer-events-none absolute right-2 top-2 z-10 rounded-[4px] bg-black/75 px-2 py-1 font-mono text-[11px] tabular-nums text-white">
                              {t('viewer.stats').replace('{fps}', String(Math.round((played.drawn * 1000) / Math.max(1, played.ms)))).replace('{late}', String(Math.round((played.late * 1000) / Math.max(1, played.ms))))}
                              {played.rendered ? ` · ${t('viewer.statsRendered')}` : ''}
                            </div>
                          ) : null}
                          {missingHere && !fullscreen && !agentWorking ? (
                            <div data-preview-missing="" className="absolute left-2 top-2 z-10 flex max-w-[80%] items-center gap-2 rounded-[4px] bg-black/75 px-2 py-1 text-[11px] text-white">
                              <span className="min-w-0 truncate">{t('project.previewMissing').replace('{file}', missingHere)}</span>
                              <button type="button" onClick={() => void findMissing()} className="shrink-0 underline underline-offset-2 hover:text-white/80">{t('media.findMissing')}</button>
                            </div>
                          ) : null}
  {preparingHere ? (
                            <div data-preview-preparing="" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
                              <div role="status" className="flex max-w-[min(26rem,85%)] flex-col items-center gap-1.5 rounded-lg bg-black/70 px-4 py-3 text-center text-white">
                                <span className={`break-words text-[13px] ${preparingHere.state === 'failed' ? 'text-white/85' : 'text-sweep relative'}`}>
                                  {preparingHere.state === 'failed' ? t('project.previewPrepareFailed').replace('{reason}', preparingHere.reason ?? '')
                                    : preparingHere.state === 'making' ? t('project.previewPreparing').replace('{p}', String(Math.round((preparingHere.ratio ?? 0) * 100)))
                                      : t('project.previewPreparingWait')}
                                </span>
                                {preparingHere.state !== 'failed' ? (
                                  <span className="h-0.5 w-40 max-w-full overflow-hidden rounded-full bg-white/15">
                                    <span className="block h-full rounded-full bg-white/70 transition-[width] duration-500" style={{ width: `${Math.round((preparingHere.state === 'making' ? preparingHere.ratio ?? 0 : 0) * 100)}%` }} />
                                  </span>
                                ) : null}
                                <span className="text-[11px] leading-snug text-white/55">
                                  {preparingHere.state === 'failed' ? preparingHere.path.split('/').pop() : t('project.previewPreparingWhy').replace('{file}', preparingHere.path.split('/').pop() ?? preparingHere.path)}
                                </span>
                              </div>
                            </div>
                          ) : null}
                        </>}>
                        <div className="absolute" style={{
                          left: `${(frameBox.inner.left / frameBox.w) * 100}%`,
                          top: `${(frameBox.inner.top / frameBox.h) * 100}%`,
                          width: `${(frameBox.inner.w / frameBox.w) * 100}%`,
                          height: `${(frameBox.inner.h / frameBox.h) * 100}%`,
                        }}>
                          <Preview ref={preview} folder={folder} stage={shownStage} time={() => player.current.time()} fps={exactRate(projectFps)}
                            onInfo={onInfo} onKey={previewKey} onError={setPreviewError} onPlayed={onPlayed} onUndecoded={onUndecoded} waiting={agentWorking}
                            onSpans={(next) => setInfo((had) => (had ? { ...had, spans: next } : had))}
                            onShown={() => setPageShown((n) => n + 1)}>
                            {/* grading, the picture is looked at, not arranged: no picking or moving layers on it */}
                            {!fullscreen && !colorMode ? (
                              <FilmStageSelect
                                previewRef={preview}
                                stage={shownStage}
                                doc={value as unknown as FilmDoc}
                                spans={spans}
                                timeMs={timeMs}
                                poseOf={poseOf}
                                poseKey={stagePoseKey}
                                /* the path a picked layer moves along: Motion's (the edit keeps out of keyframes) */
                                motionPath={motionOpen ? motionPath : null}
                                playing={playing}
                                onPause={pause}
                                onSelectElement={selectStageElement}
                                onEditClip={editClipsFromStage}
                                linkedLocs={selectedLocs}
                                onSelectClips={selectStageClips}
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
                                {...(chat.refer ? { onRegion: referRegion, regionHint: t('host.regionHint') } : {})}
                                flashBox={flashBox}
                                chat={chatOnPicture}
                                {...(hostHover ? { onHoverLayer: hoverLayer } : {})}
                                onStartMask={openMaskSection}
                                pointLayer={pointedLayer}
                                onDropPicture={putLayerPicture}
                                arrowsMove={viewerFocus}
                              />
                            ) : null}
                            {!fullscreen ? <CaptionStage previewRef={preview} projectId={projectId} stage={shownStage} timeMs={timeMs} onPick={showCaptionLook} onPause={pause} /> : null}
                            {pointWanted && colorMode ? <PickPoint hint={t('project.pickWhiteHint')} onPick={(pt) => { setPointWanted(null); pointWanted.done(pt); }} /> : null}
                            {split != null && workMode === 'color' ? <SplitLine at={split} onMove={setSplit} label={t('project.splitCompare')} before={t('project.compareOriginal')} after={t('project.compareGraded')} /> : null}
                            {ungraded ? (
                              <button type="button" onClick={() => setUngraded(false)}
                                className="absolute left-2 top-2 z-20 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm transition hover:bg-black/80">
                                {t('project.ungraded')}<span className="ml-1.5 text-white/55">{keyHint('compare-grades')}</span>
                              </button>
                            ) : null}
                          </Preview>
                          {/* a thing of the library tried from the assets drawer: over the picture, nothing written */}
                          {libraryTrial && !fullscreen ? <LibraryTrial key={libraryTrialRound} item={libraryTrial} frame={libraryFrame}
                            target={libraryPreviewBar} onLetGo={() => dismissLibraryPreview.current()} onTemplateState={onTemplateState}
                            onDownloadFailed={onLibraryDownloadFailed} /> : null}
                        </div>
                        {!viewerReady && !empty && !previewError ? (
                          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black">
                            <span role="status" className="text-sweep relative text-[13px] text-white/60">{t('project.previewStageMount')}</span>
                          </div>
                        ) : null}
                        {fullscreen ? <div className="absolute inset-0 z-[5]" aria-hidden /> : null}
                      </ViewerZoom>
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
                          onRate={setSpeed}
                          onExit={toggleFullscreen}
                        />
                      ) : null}
                    </div>
                  ) : (
                    filmMissing ? null : <p className="max-w-[280px] text-center text-[12.5px] text-[var(--text-faint)]">{loaded.problems.join(' ') || t('project.filmEmptyHint')}</p>
                  )}
                </div>
                {film.broken ? (
                  <div role="status" className="mx-2 mb-1 flex items-start gap-2 rounded-md border border-[var(--warn)] px-2.5 py-1.5 text-[12px] leading-snug text-[var(--text)]">
                    <TriangleAlert size={14} className="mt-px shrink-0 text-[var(--warn)]" aria-hidden />
                    <span className="min-w-0 break-words"><span className="font-medium">{t('project.filmBroken')}</span>{' '}<span className="text-[var(--text-muted)]">{film.broken}</span></span>
                  </div>
                ) : null}
                <div ref={setLibraryPreviewBar} data-library-preview-bar="" className="peer empty:hidden" />
                <div data-project-player="" hidden={Boolean(pickedMedia)} className="peer-[:not(:empty)]:hidden">
                  <ViewerBar
                    timeMs={timeMs}
                    clock={clock}
                    totalMs={totalMs}
                    playing={playing}
                    onPlayPause={toggle}
                    playback={{
                      loop,
                      ranged: Boolean(markedRange),
                      onLoop: () => setLoop((on) => !on),
                      speed: rate,
                      onSpeed: setSpeed,
                    }}
                    onFullscreen={toggleFullscreen}
                    extra={<>
                      {workMode === 'color' ? (
                        /* the grade against the footage: graded, split (the footage left of a line), the footage alone (⇧D) */
                        <div role="radiogroup" aria-label={t('project.splitCompare')} className="flex h-7 items-center rounded-md bg-[var(--bg-field)] p-0.5">
                          {([['graded', t('project.compareGraded'), null], ['split', t('project.compareSplit'), null], ['original', t('project.compareOriginal'), keyHint('compare-grades')]] as const).map(([k, label, hint]) => {
                            const on = k === 'original' ? ungraded : k === 'split' ? !ungraded && split != null : !ungraded && split == null;
                            return (
                              <button key={k} type="button" role="radio" aria-checked={on}
                                onClick={() => { setUngraded(k === 'original'); setSplit(k === 'split' ? (split ?? 0.5) : null); }}
                                className={`flex h-6 items-center rounded-[5px] px-2 text-[11.5px] transition ${on ? 'bg-[var(--bg-selected)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
                                {label}{hint ? <span className="ml-1 text-[var(--text-faint)]">{hint}</span> : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      <ViewerZoomButton store={viewerZoom} />
                    </>}
                  />
                </div>
              </div>
              </InBlock>

              {/* the color workbench draws its own blocks (scopes, shots, tools) round the edit's viewer */}
              {colorMode ? <ColorDesk projectId={projectId} host={colorHost} clips={gradedClips} current={colorCurrent} timeMs={timeMs} onShot={takeShot} onSeek={(t) => seek(Math.round(t * 1000))}
                onPickPoint={pickPoint} onRefer={chat.refer ? referShots : undefined} onLeave={() => setWorkMode('edit')} /> : null}
              {inspectorShown ? (
                <InBlock id="inspector">
                  <div className={`${PANE} flex-1 bg-[var(--bg-panel)]`} data-workspace-inspector>
                  {typeof inspectorContent === 'object' ? (
                    <ResourceInspector file={inspectorContent} url={(pickedSaved && inspectorContent === pickedMedia ? savedSources : mediaSources).file(inspectorContent)} made={madeFor(inspectorContent)} width={inspectorShownWidth} onClose={closeInspector} />
                  ) : inspectorContent === 'captions' ? (
                    <CaptionInspector projectId={projectId} width={inspectorShownWidth} onClose={closeInspector} timeMs={timeMs} onSeek={seek} onTranslated={addTranslation}
                      infoOf={captionInfoOf} onCut={cutRanges} onAdd={addCaption} />
                  ) : motionOpen ? (
                    /* motion's own panel (components/MotionPanel): the picked layers' properties, the effects & presets */
                    <div className={`${PANE} flex shrink-0 flex-col`} style={{ width: inspectorShownWidth }}>
                      {compBlock ? (
                        <MotionPanel layers={compLayers.filter((l) => compPicked.includes(l.clipId))} hostOf={elementHostOf}
                          onApplied={(ids) => setMotionReveal((was) => ({ ids, n: (was?.n ?? 0) + 1 }))} />
                      ) : (
                        <MotionPanel layers={motionLayers.filter((l) => selectedBlocks.some((b) => b.clipId === l.clipId))} hostOf={(l) => layerHostOf(l as TimelineBlock & { clipId: string })}
                          contents={(() => {
                            /* a page layer's own properties (its words, its fill…), as the edit's inspector shows them */
                            const block = selectedBlocks.length === 1 ? selectedBlocks[0]! : null;
                            const own = block?.kind === 'mg' && block.loc ? propsHostOf(block) : null;
                            /* a number with keyframes is changed on its row under Contents, where its keyframes are: a
                               still value typed here would win over them */
                            const keyed = new Set(Object.keys((block?.clipId ? contentsOfRef.current(block as TimelineBlock & { clipId: string })?.keys : null) ?? {}));
                            const isKeyed = (p: ComponentProp) => p.type === 'var' && keyed.has(p.var);
                            const host = own && keyed.size ? {
                              ...own,
                              props: () => own.props().filter((p) => !isKeyed(p)),
                              setProps: (next: readonly ComponentProp[]) => own.setProps([...next, ...own.props().filter((p) => isKeyed(p) && !next.some((n) => n.name === p.name))]),
                            } : own;
                            return host && block?.loc ? <PropertiesSection host={host} commit={(next) => { void editBlocks([{ loc: block.loc!, prop: 'overrides', value: next as unknown as Record<string, unknown> | null }]).then((err) => { if (err) toast.showError(err); }); }} /> : null;
                          })()}
                          onApplied={(ids) => setMotionReveal((was) => ({ ids, n: (was?.n ?? 0) + 1 }))} />
                      )}
                    </div>
                  ) : (
                    <FontScopeContext.Provider value={fontScope}>
                    <LiveGeometryInspector
                      store={geometryStore}
                      {...(workModes.includes('motion') ? { onAnimate: (clipId: string) => { setWorkMode('motion'); setMotionReveal((was) => ({ ids: [clipId], n: (was?.n ?? 0) + 1 })); } } : {})}
                      element={stageElement}
                      clips={selectedClips}
                      mainTrack={mainTrack}
                      speedFloorOf={speedFloorOf}
                      onEditClips={editClips}
                      width={inspectorShownWidth}
                      onEditStyle={editStageStyle}
                      onEditSimilar={editStageStyleSimilar}
                      countSimilar={countSimilar}
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
                      propsHostOf={propsHostOf}
                      layerProps={layerProps}
                      pictures={pictureActions}
                      replaceEntries={tools.replaceEntries}
                      templateSection={templateSection}
                      motionSection={motionSection}
                      clipLookOf={clipLookOf}
                      visionPreview={visionPreview}
                      visionStatus={async (id, retry) => {
                        if (retry) await preview.current?.stage?.('visionRetry', { id });
                        return preview.current?.stage?.('vision', { id });
                      }}
                      onPreviewLook={previewLook}
                      colorHost={colorHost}
                      onStartCrop={startStageCrop}
                      onEditMask={editStageMask}
                      maskAsk={maskAsk}
                      onMaskAsked={maskAsked}
                      stage={stage}
                      film={filmSummary}
                      onCanvas={changeCanvas}
                      onCanvasPreview={previewCanvas}
                      canvasDraft={canvasDraft}
                      canvasOriginal={originalSize}
                      onEditLayers={editStageOverrides}
                      onPlaceLayers={(to) => stageControl.current?.placeLayers(to)}
                      locked={inspectorLocked}
                      rate={frameRate}
                      exportMotionBlur={settings && (settings.motionBlur?.enabled || film.film?.tracks.some((track) => !track.hidden && track.clips.some((clip) => filmSrcIsPage(clip.src))))
                        ? { value: settings.motionBlur, onChange: (motionBlur) => patchSettings({ motionBlur }) }
                        : null}
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
                  </div>
                </InBlock>
              ) : null}
            </>

            {timelineOpen && value ? (
              <InBlock id="timeline">
              <div className={`${PANE} flex-1 bg-[var(--bg-panel)]`} data-workspace-timeline
                onPointerDownCapture={() => { dismissLibraryPreview.current(); if (pickedMedia) pickMedia(null); }}>
                <div className="absolute inset-0 flex min-h-0 min-w-0 flex-col" data-timeline-scope="main" style={{ right: METERS_W }}>
                  {motionOpen && compBlock && compTracks ? (
                  /* a composition: its page's elements as layers, on the timeline of the page's own time */
                  <Timeline
                    tracks={compTracks.map((r) => r.track)}
                    layers={layerView(compMotion, compTracks, Boolean(compKeys?.keys.size), compPicked.length > 0)}
                    totalMs={compBlock.endMs - compBlock.startMs}
                    timeMs={compLocalMs}
                    playing={playing}
                    onSeek={(ms) => seek(compBlock.startMs + inComp(ms))}
                    onScrubPreview={(ms) => scrubPreview(compBlock.startMs + inComp(ms))}
                    onScrubCommit={(ms) => scrubCommit(compBlock.startMs + inComp(ms))}
                    selected={compPicked.map((id) => `el:${id}`)}
                    onSelectedChange={(ids) => {
                      const next = ids.map((x) => x.replace(/^el:/, ''));
                      setCompPicked(next);
                      /* in hand on the picture too, as a pick on its name does: once the press is over, which the picture
                         would otherwise answer by taking its clip again */
                      if (motionComp && next.length) window.setTimeout(() => selectLayerRows(next.map((loc) => ({ clipId: motionComp, loc }))), 0);
                    }}
                    crumb={{ outer: loaded?.project.name ?? '', name: compBlock.title || compBlock.clipId || '', onBack: () => setMotionComp(null) }}
                  />
                  ) : (
                  <Timeline
                    blockMenuExtra={timelineMenuExtra}
                    chat={timelineChat}
                    {...(hostHover ? { onHoverBlock: hoverBlock } : {})}
                    /* the range (I / O, ⇧-drag on the ruler, Play range) is Studio's own; referring it is the app's */
                    range={markedRange}
                    flashRange={flashRange}
                    onRangeChange={setMarkedRange}
                    trackMenuExtra={trackMenuExtra}
                    onOrganizeTracks={organizeTimelineTracks}
                    transcribed={transcribedSrcs}
                    captionPick={timelineCaptionPick}
                    {...(chat.refer ? {
                      onReferBlocks: referBlocks, rangeRef: markedRangeRef, onReferRuler: referRuler,
                    } : {})}
                    commandsRef={timelineCommands}
                    onDuplicate={duplicateBlocks}
                    onPlayRange={playRange}
                    thumbs={shownThumbs}
                    posters={shownPosters}
                    mediaTrouble={timelineTrouble}
                    relinkCandidates={relinkCandidates}
                    onRelink={(block, path) => void relinkBlock(block, path)}
                    onViewChange={setThumbView}
                    tracks={layerTracks ? layerTracks.map((r) => r.track) : editTracks}
                    layers={layerTracks ? layerView(filmMotion, layerTracks, pickedKeys.size > 0, selectedBlocks.length > 0, openComposition) : null}
                    timelineView={workModes.includes('motion') && workModes.includes('edit') ? { now: workMode === 'motion' ? 'motion' : 'edit', onView: setWorkMode } : null}
                    totalMs={totalMs}
                    timeMs={timeMs}
                    clock={playing ? clock : null}
                    playing={playing}
                    onSeek={(ms) => seek(ms)}
                    onScrubPreview={scrubPreview}
                    onScrubCommit={scrubCommit}
                    onSkimPreview={pickedMedia ? undefined : skimPreview}
                    onRemove={removeBlock}
                    onRemoveMany={removeBlocks}
                    onSplit={splitBlocks}
                    onAddCaption={addCaption}
                    onDetachAudio={detachAudio}
                    onCompound={(blocks) => { void makeCompound(blocks).then((err) => { if (err) toast.showError(err); }); }}
                    onUncompound={(block) => { void breakCompound(block).then((err) => { if (err) toast.showError(err); }); }}
                    onEnterCompound={enterCompound}
                    crumb={loaded?.outer ? { outer: loaded.outer.name, name: loaded.outer.folder, onBack: () => onProject(loaded.outer!.id) } : null}
                    cover={coverTile}
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
                    onApplyDrop={library.applyDrop}
                    onDropFiles={dropFiles}
                    onExportBlock={openClipExport}
                    hasClipboard={clipboard.length > 0 || layerBoard != null}
                    selected={selectedIds}
                    onSelectedChange={onTimelineSelected}
                    waveUrl={waveUrl}
                    history={timelineHistory}
                    {...tools.timeline}
                    /* a file dropped on a template's clip goes in its place there, without ⇧ */
                    dropInto={(b) => templateFolderOf(b.src) != null}
                    onReplaceDrop={(b, f, atMs) => { if (templateFolderOf(b.src) && atMs != null) void dropOnTemplate(b, f, atMs); else tools.timeline.onReplaceDrop(b, f as never); }}
                  />
                  )}
                  {motionOpen ? (compBlock ? compMotion.overlay : filmMotion.overlay) : null}
                  {newLayerMenu ? <ContextMenu x={newLayerMenu.x} y={newLayerMenu.y} items={newLayerItems()} onClose={() => setNewLayerMenu(null)} /> : null}
                </div>
                {/* the audio meters, beside the timeline */}
                <div className="absolute inset-y-0 right-0"><AudioMeters levels={tools.levels} playing={playing} /></div>
              </div>
              </InBlock>
            ) : null}
          </>

      {ReactDOM.createPortal(<>
      {templateAsk ? (
        <TemplatePicker
          name={templateAsk.name}
          slots={templateAsk.slots}
          media={(listing?.files ?? []).filter((f) => (f.kind === 'video' || f.kind === 'image') && !fromLibrary(f.path)).map((f) => ({
            path: f.path, name: f.name, kind: f.kind as 'video' | 'image', ...(f.durationMs ? { durationMs: f.durationMs } : {}),
            thumb: (f.kind === 'video' ? mediaSources.poster?.(f) : undefined) ?? mediaSources.file(f),
          }))}
          used={new Set(blocksRef.current.flatMap((b) => (b.src ? [b.src.split('#')[0]!] : [])))}
          onImport={importOwn}
          onUse={(paths) => { const ask = templateAsk; setTemplateAsk(null); ask.use(paths); }}
          onClose={() => setTemplateAsk(null)}
        />
      ) : null}
      </>, slots.over)}
      {/* the page's own windows, the library's pane and the layout's seams and editor are the shell's (shell/top-bar,
          shell/library, shell/layout), drawn between these two places */}
      {/* the cover design: a large window over the edit */}
      {coverOpen ? (
        <CoverDesigner projectId={projectId} filmTitle={title} filmMs={totalMs} atMs={timeRef.current} filmStage={film.film?.stage ?? { w: 1920, h: 1080 }}
          toast={toast} onClose={() => setCoverOpen(false)} />
      ) : null}
      {ReactDOM.createPortal(<>
      <ExportCenter
        covers={{ projectId, list: coverList?.covers ?? [], main: coverList?.main ?? null, edit: () => coverTile.open() }}
        open={exportOpen}
        onClose={() => { setExportOpen(false); setExportClipId(null); }}
        projectId={projectId}
        title={title || 'video'}
        durationMs={totalMs}
        stage={stage}
        frame="native"
        film={exportFilm as never}
        playheadMs={timeMs}
        markersMs={tools.timeline.snapPointsMs}
        mgBlocks={mgBlocks}
        {...(exportClipId ? { focusClipId: exportClipId } : {})}
        onQueued={(jobs) => exportTrayRef.current?.push(jobs)}
        projectFps={projectFps}
        missingFiles={[...mediaTrouble].flatMap(([src, why]) => (why === 'missing' ? [src] : []))}
      />
      <PasteAttrsDialog attrs={pasteAttrsOpen ? copiedAttrs : null} onPaste={doPasteAttrs} onCancel={() => setPasteAttrsOpen(false)} />
      </>, slots.overLibrary)}
    </>
  );
}

/**
 * A pane of the edit's, drawn into the place of its block (`id`, plugins/edit openfilm.json `blocks`) while it is
 * here: the shell lays out a slot for it and puts the place in it, and the pane is drawn there from then on (so what
 * it measures as it first draws is where it is shown).
 */
function InBlock({ id, children }: { id: string; children: React.ReactNode }) {
  React.useLayoutEffect(() => blocks.draw('edit', id), [id]);
  const key = blockKey('edit', id);
  const there = React.useSyncExternalStore(attachedBlocks.subscribe, () => attachedBlocks.get().has(key));
  return there ? ReactDOM.createPortal(children, blocks.slot('edit', id)) : null;
}

interface GeometryStore {
  get: () => StageGeometry | null;
  set: (g: StageGeometry | null) => void;
  subscribe: (fn: () => void) => () => void;
}

/** The layers of a group in hand (`[clipId, loc]` each), as one string; '' for none. */
function groupLayersKey(g: StageGeometry | null): string {
  const elements = g?.kind === 'group' ? g.group?.elements ?? [] : [];
  return elements.length ? JSON.stringify(elements.map((e) => [e.clipId ?? '', e.loc])) : '';
}

/**
 * Where the thing in hand is: only the inspector reads all of it, so a drag re-renders the inspector, not the editor
 * (which reads only which layers a group has, groupLayersKey).
 */
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

/** A short name a text always gives (FNV-1a, base 36): the same request, the same file. */
function stableName(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** A point clicked on the picture (0–1 across and down it), as the color workbench's picker asks; Esc lets go without one. */
function PickPoint({ hint, onPick }: { hint: string; onPick: (p: { x: number; y: number } | null) => void }) {
  React.useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onPick(null); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onPick]);
  return (
    <div className="absolute inset-0 z-30 cursor-crosshair" onPointerDown={(e) => {
      e.preventDefault(); e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      onPick({ x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) });
    }}>
      <span className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/70 px-3 py-1 text-[11.5px] text-white backdrop-blur-sm">
        {hint}<span className="ml-1.5 text-white/55">Esc</span>
      </span>
    </div>
  );
}

/** The line a split before and after is drawn at, over the picture: dragged across it, the original on its left. */
function SplitLine({ at, onMove, label, before, after }: { at: number; onMove: (x: number) => void; label: string; before: string; after: string }) {
  const box = React.useRef<HTMLDivElement | null>(null);
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    const parent = box.current?.parentElement?.getBoundingClientRect();
    if (!parent || !(e.buttons & 1)) return;
    onMove(Math.round(Math.min(1, Math.max(0, (e.clientX - parent.left) / parent.width)) * 1000) / 1000);
  };
  const tag = 'pointer-events-none absolute top-2 z-20 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm';
  return (
    <>
    {at > 0.08 ? <span className={`${tag} left-2`}>{before}</span> : null}
    {at < 0.92 ? <span className={`${tag} right-2`}>{after}</span> : null}
    <div ref={box} role="slider" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(at * 100)}
      className="absolute bottom-0 top-0 z-20 w-4 -translate-x-1/2 cursor-ew-resize touch-none" style={{ left: `${at * 100}%` }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); e.stopPropagation(); }} onPointerMove={drag}
      onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}>
      <span className="absolute left-1/2 top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black shadow-md">
        <Columns2 size={12} />
      </span>
    </div>
    </>
  );
}
