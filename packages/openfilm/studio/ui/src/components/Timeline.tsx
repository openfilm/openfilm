/**
 * The timeline under the picture — the multi-track kind, as in CapCut and OpenCut.
 *
 * film.html has tracks of clips; each film.html track is a row here (overlapping clips spread into extra rows, see
 * layoutTracks), pictures above, sounds below.
 *
 * There is no play button or timecode here: the transport is under the picture (one place for one thing). The
 * timeline shows what the film looks like over time and is the one place to drag the playhead. Everything it changes
 * (move, trim, roll, slip, slide, split, delete, paste, a gap closed) is written back to film.html through the
 * callbacks; what an edit does to the other clips is planned in lib/timeline-edit, by the switches in the toolbar: the
 * magnet (insert and ripple, or overwrite), sync lock (ripples move every unlocked track) and linked clips.
 */
import React from 'react';
import {
  ClipboardPaste,
  Copy,
  CopyPlus,
  Download,
  Eye,
  EyeOff,
  ListRestart,
  Lock,
  LockOpen,
  Magnet,
  MessageSquarePlus,
  MoreHorizontal,
  ChevronDown,
  ChevronUp,
  MousePointer2,
  MoveHorizontal,
  Play,
  Redo2,
  Scissors,
  SplitSquareHorizontal,
  Trash2,
  Undo2,
  Video,
  X,
  ZoomIn,
  ZoomOut,
  Volume2,
  VolumeX,
  Waves,
  Link2,
  Link2Off,
  Mic,
  Rows3,
  SeparatorVertical,
  BetweenHorizontalStart,
  ArrowLeftToLine,
  ArrowRightToLine,
  Pencil,
  TriangleAlert,
  AudioLines,
  Blend,
} from 'lucide-react';
import { useT } from '@/i18n';
import { shortcutHint } from '@/lib/shortcut-hint';
import type { Op } from '@/api';
import type { ClipEdit } from '@/lib/film-clip-edits';
import { laneOfBlock } from '@/lib/timeline-clipboard';
import { filmSrcIsStill, parseFilmDocLoc } from '@/lib/film';
import {
  assetDropPreview,
  assetDropSpot,
  assetDropTargetOf,
  type AssetDropPreview,
  type AssetDropTarget,
  type AssetLaneHit,
} from '@/lib/asset-timeline';
import {
  computerFileDragItem,
  isComputerFileDrag,
  peekResourceDrag,
  readResourceDragData,
  RESOURCE_DRAG_TYPE,
  type ResourceDragItem,
} from '@/lib/resource-drag';
import {
  DRAG_THRESHOLD_PX,
  marqueeHits,
  MIN_BLOCK_MS,
  snapMs,
  snapTargetsFor,
  type DropBand,
  type SnapTarget,
  type TrackDrop,
} from '@/lib/timeline-drag';
import {
  editModelOf,
  gapAt,
  insertPointOn,
  linkedIds,
  planCloseGap,
  planLink,
  planRemove,
  planRippleTrimTo,
  planRoom,
  planUnlink,
  TOUCH_MS,
  type EditMode,
  type EditPlan,
} from '@/lib/timeline-edit';
import { clipThumbId, indexClipThumbs, thumbIntoOrigin } from '@/lib/thumb-frame';
import { THUMB_CELL_PX } from '@/lib/thumb-cache';
import { useTimelinePrefs, writeTimelinePref } from '@/lib/timeline-prefs';
import { STUDIO_REF_TYPE, type StudioRef } from '@/lib/host';
import { orderedRange, rangeLabel, type FilmRange } from '@/lib/studio-refs';
import { draftNumbersOf, sameClip, type ChatPoint, type DraftMarks } from '@/lib/chat-marks';
import { formatRulerLabel, formatTimecode, frameAt, frameMs, secondFrames, snapToFrame, stepFrames, useTimecodeFps } from '@/lib/timecode';
import { planNudge, splitAllTargets, splitTargets } from '@/lib/timeline-nav';
import {
  VIEW_SPAN_MIN_MS,
  ZOOM_DEFAULT,
  zoomMaxOf,
  zoomMinOf,
  ZOOM_STEP,
  canvasTimeMs,
  dragReachMs,
  blockTitleOf,
  filmZoomThumb,
  liveCanvasMs,
  rulerMarks,
  rulerSteps,
  rulerCoverMs,
  sliderToZoom,
  timeAtPx,
  zoomForPxPerMs,
  zoomToSlider,
  zoomedPxPerMs,
  type TimelineBlock,
  type TimelineBlockKind,
  type TimelineTrack,
} from '@/lib/timeline-layout';
import { OperationHistory, type SessionTimeline } from './OperationHistory';
import { BlockThumbs } from './BlockThumbs';
import { BlockWaveform } from './BlockWaveform';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import type { PlaybackClock } from './LiveTime';
import { CaptionsIcon } from './player-controls/controls-bar';
import { isTypingTarget } from './typing-target';
import { Popover } from './Popover';
import { SUBTITLE_ROW_H, SubtitleRow, SubtitleRowHead, useSubtitleRowShown, type SubtitleRowHandle, type SubtitleRowSpec } from './SubtitleRow';
import { SoloButton, TrackResizeHandle } from './timeline-head-extras';
import { clipAtPoint, markReplaceTarget } from './replace-drop';
import { SelectionToolbar, type SelectionToolEntry } from './SelectionToolbar';
import { Tooltip } from './Tooltip';
import { unionBox, type ScreenBox } from '@/lib/selection-toolbar';
import { useBlockDrag, type GestureTip } from './useBlockDrag';
import { fadeEdits, fadeFromPointer, fadeHandleX, type FadeEdge, type FadeMs } from '@/lib/clip-fade';
import { cutNear, transitionSpan, type CutRef, type FilmTransition, type TransitionAsk, type TransitionKind } from '@/lib/transitions';

/** Track head column: kind badge + lock + hide + original sound. */
const HEAD_W = 108;
/** The head column's width when a track has a name: room for the name beside its badge. */
const HEAD_NAMED_W = 168;
/** The room solo's S takes in a head. */
const HEAD_SOLO_W = 24;
/* the head toggles' icons: at 10 px lock and eye are indistinguishable dots on Retina */
const HEAD_ICON_H = 12;
/** The kind icon of a row without a badge. */
const TYPE_BOX = 13;
/** Toolbar height. The playhead layer starts below it, so it is a constant. */
const TOOLBAR_H = 34;
/**
 * How far the playhead layer reaches left of the track area. At 0 half the knob is left of the track area, and the
 * layer must clip horizontally; reaching further left and shifting the content back keeps the knob whole.
 */
const PLAYHEAD_BLEED = 8;
/** How long a ripple delete waits for clips an undo just put back to be drawn (see rippleRemove). */
const RIPPLE_WAIT_MS = 1000;
/** Within this many pixels either side of the playhead line, a press in the track area grabs the playhead. */
const PLAYHEAD_GRAB_PX = 4;
/* the range bar's hit height (the visible bar is thinner, see .tl-range-thumb; 5 px could hardly be hit) */
const H_SCROLL_H = 10;
const RULER_H = 20;
/**
 * Row heights. A clip is three layers — info strip (name + length), preview band (thumbnails / waveform), audio band —
 * and a low waveform shows nothing, while "did this cut land mid-word" can only be seen on it.
 */
const TRACK_H = { visual: 56, audio: 44 } as const;
/** The info strip at the top of a clip (name + length). */
const INFO_H = 15;
/**
 * While scrubbing, how often the time is told upward: every 40 ms (25 Hz). Telling it re-renders the editor and seeks
 * the preview — the expensive part. The line itself follows every frame from local state.
 */
const SCRUB_TELL_MS = 40;
/**
 * The audio band at the bottom of a video clip: its own sound draws its waveform here; a video without sound keeps
 * the band empty but still takes its height, so the preview bands of neighboring videos line up. A page or a still
 * has no sound at all: its picture takes the whole clip.
 */
const AUDIO_BAND_H = INFO_H;
/** The gap between rows: two rows read as two, not as one area. */
const GAP = 3;
/**
 * How close to a row's top or bottom edge counts as "open a new track here" rather than "onto this row". It used to
 * be up to 12 px each side of a 44 px row, so more than half the row meant "new track" and a purely horizontal drag
 * grabbed near an edge kept opening rows. Now a narrow edge: with the gap it gives 5 + 3 + 5 = 13 px per boundary.
 */
const LANE_EDGE_PX = 5;
/** At least this much space above and below the rows: rows pressed against the edge look cut off. */
const TL_VPAD = 10;
/** While playing, the timeline pages when the playhead gets this close to the edge. */
const FOLLOW_EDGE = 24;

/** Color by kind of clip: picture, voice, other sound. Muted tones, dark enough for white text and waveforms. */
const KIND_COLOR: Record<TimelineBlockKind, string> = {
  mg: 'var(--tl-scene)',
  video: 'var(--tl-video)',
  voice: 'var(--tl-voice)',
  sfx: 'var(--tl-sfx)',
  music: 'var(--tl-music)',
  caption: 'var(--tl-caption)',
};

/** The timeline's surfaces, CSS variables with a light and a dark set (see globals.css `--tl-*`). */
const TL = {
  lane: 'var(--tl-lane)',
  laneOn: 'var(--tl-lane-on)',
  head: 'var(--tl-head)',
  ruler: 'var(--tl-ruler)',
  line: 'var(--tl-line)',
  tick: 'var(--tl-tick)',
  text: 'var(--tl-text)',
  faint: 'var(--tl-faint)',
} as const;

function laneTone(track: TimelineTrack, selected: boolean): string {
  if (track.hidden) return TL.head;
  return selected ? TL.laneOn : TL.lane;
}

/** A row's height: the person's for its track (lib/track-heights), else the timeline's own for its kind. */
function rowH(track: Pick<TimelineTrack, 'kind' | 'height'>): number {
  return track.height ?? TRACK_H[track.kind];
}

/**
 * The height that shows every row (toolbar + ruler + rows + padding + range bar). The editor uses it for the
 * timeline's default height.
 */
export function timelineFitHeight(tracks: readonly Pick<TimelineTrack, 'kind' | 'height'>[]): number {
  const lanes = tracks.reduce((h, tr) => h + rowH(tr) + GAP, 0);
  return TOOLBAR_H + RULER_H + lanes + GAP + 2 * TL_VPAD + H_SCROLL_H;
}

/** The top of row `laneIndex` (or of a new row opened at that index) within the content. */
function trackSlotTop(
  tracks: readonly TimelineTrack[],
  laneIndex: number,
  padTop: number,
): number {
  let top = padTop;
  const last = Math.min(Math.max(0, laneIndex), tracks.length);
  for (let i = 0; i < last; i += 1) top += GAP + rowH(tracks[i]!);
  return top + GAP;
}

/** The middle of the gap above row `laneIndex`, where a new track's insert line is drawn (tracks.length = bottom). */
function laneBoundaryY(
  tracks: readonly TimelineTrack[],
  laneIndex: number,
  padTop: number,
): number {
  return trackSlotTop(tracks, laneIndex, padTop) - GAP / 2;
}

function moveLandingLane(
  drop: TrackDrop,
  tracks: readonly TimelineTrack[],
  homeIndex: number,
): { laneIndex: number; newTrack: boolean } {
  if (drop.action === 'stay' || drop.action === 'refuse') {
    return { laneIndex: Math.max(0, homeIndex), newTrack: false };
  }
  if (drop.action === 'move') {
    const i = tracks.findIndex((tr) => tr.docIndex === drop.trackIndex);
    return { laneIndex: i >= 0 ? i : Math.max(0, homeIndex), newTrack: false };
  }
  const i = tracks.findIndex((tr) => tr.docIndex != null && tr.docIndex >= drop.at);
  return { laneIndex: i >= 0 ? i : tracks.length, newTrack: true };
}

type DropLanding =
  | { type: 'slot'; startMs: number; endMs: number; title: string; color: string; top: number; height: number; refused: boolean }
  | { type: 'line'; startMs: number; endMs: number; top: number }
  /** An insert: the point on a row it goes in at, what follows pushed on. */
  | { type: 'insert'; startMs: number; endMs: number; top: number; height: number };

/** Where a clip lies after release — the floating clip follows the hand, this is its slot. */
function landingForClip(
  block: { title: string; kind: TimelineBlockKind },
  startMs: number,
  endMs: number,
  at: { laneIndex: number; newTrack: boolean },
  tracks: readonly TimelineTrack[],
  padTop: number,
  refused = false,
): DropLanding {
  const { laneIndex, newTrack } = at;
  if (newTrack) {
    return {
      type: 'line',
      startMs,
      endMs,
      top: laneBoundaryY(tracks, laneIndex, padTop),
    };
  }
  return {
    type: 'slot',
    startMs,
    endMs,
    title: block.title,
    color: KIND_COLOR[block.kind],
    top: trackSlotTop(tracks, laneIndex, padTop),
    height: trackKindHeight(tracks[Math.min(laneIndex, Math.max(0, tracks.length - 1))]?.kind ?? block.kind),
    refused,
  };
}

/** Whether two landing slots cover the same row at the same time. */
function landingSlotsOverlap(a: DropLanding, b: DropLanding): boolean {
  if (a.type !== 'slot' || b.type !== 'slot') return false;
  if (a.top !== b.top) return false;
  return a.startMs < b.endMs && a.endMs > b.startMs;
}

function LandingMark({ landing, pxPerMs }: { landing: DropLanding; pxPerMs: number }) {
  if (landing.type === 'insert') {
    /* a bar at the insert point, a little taller than the row: "it goes in here, between these" */
    return (
      <div
        data-insert-point={Math.round(landing.startMs)}
        className="absolute rounded-full"
        style={{
          left: Math.round(landing.startMs * pxPerMs) - 1,
          width: 3,
          top: landing.top - 3,
          height: landing.height + 6,
          background: 'var(--tl-accent)',
          boxShadow: '0 0 6px color-mix(in srgb, var(--tl-accent) 70%, transparent)',
        }}
      />
    );
  }
  if (landing.type === 'line') {
    return (
      <>
        {/* a thin full-width line says "a new track opens in this gap", the thick part "the clip takes this time";
            no slot, which could only be drawn on a neighboring row and would look stacked */}
        <div
          data-drop-guide=""
          className="absolute h-[2px]"
          style={{
            left: 0,
            width: '100%',
            top: landing.top - 1,
            background: 'color-mix(in srgb, var(--tl-accent) 45%, transparent)',
          }}
        />
        <div
          data-drop-slot=""
          data-drop-start={Math.round(landing.startMs)}
          className="absolute rounded-full"
          style={{
            left: Math.round(landing.startMs * pxPerMs),
            width: Math.max(8, Math.round((landing.endMs - landing.startMs) * pxPerMs)),
            top: landing.top - 2,
            height: 4,
            background: 'var(--tl-accent)',
            boxShadow: '0 0 6px color-mix(in srgb, var(--tl-accent) 70%, transparent)',
          }}
        />
      </>
    );
  }
  return (
    <div
      data-drop-slot=""
      data-drop-start={Math.round(landing.startMs)}
      className="absolute overflow-hidden rounded-[3px]"
      style={{
        left: Math.round(landing.startMs * pxPerMs),
        width: Math.max(8, Math.round(landing.endMs * pxPerMs) - Math.round(landing.startMs * pxPerMs) - 1),
        top: landing.top,
        height: landing.height,
        background: landing.color,
        opacity: landing.refused ? 0.28 : 0.45,
        boxShadow: landing.refused
          ? 'inset 0 0 0 1px color-mix(in srgb, var(--err) 70%, transparent)'
          : undefined,
      }}
    >
      <div
        className="truncate px-1.5 text-[10px] font-medium leading-none text-white/95"
        style={{ height: INFO_H, display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.3)' }}
      >
        {landing.title}
      </div>
    </div>
  );
}

type AssetHint = AssetDropPreview & {
  /** Set only when snapped to another clip's edge: draws the snap guide. */
  snapGuideMs: number | null;
  /** Onto a track: insert (pushing what follows on) or overwrite (cutting what is there). */
  editMode: EditMode;
  /** Where the clips the drop pushes or cuts are drawn meanwhile, by block id; null: it goes. */
  ghosts: ReadonlyMap<string, { startMs: number; endMs: number } | null>;
};

function sameAssetHint(a: AssetHint | null, b: AssetHint | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.startMs === b.startMs
    && a.endMs === b.endMs
    && a.laneIndex === b.laneIndex
    && a.newTrack === b.newTrack
    && a.docAt === b.docAt
    && a.lane === b.lane
    && a.error === b.error
    && a.title === b.title
    && a.blockKind === b.blockKind
    && a.snapGuideMs === b.snapGuideMs
    && a.editMode === b.editMode;
}

/** The cuts on a row: the clips that touch, end to start, in order. */
function cutsOf(blocks: readonly TimelineBlock[]): [TimelineBlock, TimelineBlock][] {
  const sorted = [...blocks].sort((a, b) => a.startMs - b.startMs);
  const out: [TimelineBlock, TimelineBlock][] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    if (Math.abs(sorted[i]!.startMs - sorted[i - 1]!.endMs) <= TOUCH_MS) out.push([sorted[i - 1]!, sorted[i]!]);
  }
  return out;
}

/** A trim handle's grab width on a clip this wide: SELECT_HIT at most, and never more than a quarter of the clip. */
function trimHit(width: number): number {
  return Math.min(SELECT_HIT, Math.max(2, Math.floor(width / 4)));
}

/** A roll handle's grab width on the cut between clips this wide: 6 px, less where either is narrow. */
function rollHit(width: number): number {
  return Math.min(6, Math.max(2, Math.floor(width / 4)));
}

/** Whether a press is on a clip, one of its edges or a cut between two (not the empty track space). */
function overClip(e: React.PointerEvent): boolean {
  return Boolean((e.target as Element | null)?.closest?.('[data-block-id],[data-roll]'));
}

function trackKindHeight(kind: string): number {
  return kind === 'audio' ? TRACK_H.audio : TRACK_H.visual;
}

function laneKindForHint(kind: string): 'visual' | 'audio' {
  return kind === 'voice' || kind === 'sfx' || kind === 'music' || kind === 'audio' ? 'audio' : 'visual';
}

/* A row head starts with its badge (P1 / V1 / A1, see timeline-layout badgeRows); rows without one fall back to an
   icon: a camera for pictures, a wave for sound. */

/** Badge colors: the family of the clips on the row. */
const BADGE_COLOR: Record<string, string> = {
  M: 'var(--tl-scene)',
  V: 'var(--tl-video)',
  A: 'var(--tl-voice)',
};

/** Word cues too close together keep only the first: zoomed out, five words a second is a smear. */
function cueTicks(
  cues: readonly { word: string; tMs: number }[],
  pxPerMs: number,
): { word: string; tMs: number }[] {
  const out: { word: string; tMs: number }[] = [];
  let lastPx = -Infinity;
  for (const c of cues) {
    const px = c.tMs * pxPerMs;
    if (px - lastPx < 4) continue;
    lastPx = px;
    out.push(c);
  }
  return out;
}

/** What the undo / redo buttons need. */
export interface TimelineHistory {
  canUndo: boolean;
  canRedo: boolean;
  step: (kind: 'undo' | 'redo') => void;
  /** This session's edits. Without it there is no "Edit history" button. */
  ops?: SessionTimeline;
  /** Go back to just after step n. */
  rollbackTo?: (cursor: number) => void;
}

export interface TimelineProps {
  /** The rows, top to bottom. Empty before the film has anything — the timeline is still there. */
  tracks: readonly TimelineTrack[];
  /** Entries put first on the menu of the clips right-clicked (an app Studio is embedded in adds its own). */
  blockMenuExtra?: (blocks: readonly TimelineBlock[]) => ContextMenuEntry[];
  /** The menu of a track's head (right-clicked); without entries the head has no menu. */
  trackMenuExtra?: (track: TimelineTrack) => ContextMenuEntry[];
  /** Clips dragged out of the timeline onto the panel of the app around Studio (its chat): handed to it, not moved. */
  onReferBlocks?: (blocks: TimelineBlock[]) => void;
  /** The range marked on the ruler (the editor keeps it): drawn as a band across the tracks. */
  range?: FilmRange | null;
  /**
   * What the app's chat points at (lib/chat-marks): the clip, track or span of the pill hovered there, lit; and the
   * clips of the message being written, each with its number.
   */
  chat?: { clip: ChatPoint['clip']; track: number | null; span: FilmRange | null; draft: DraftMarks };
  /** The pointer came onto a clip's block, or left it (null). */
  onHoverBlock?: (block: TimelineBlock | null) => void;
  /** With it, ⇧-dragging along the ruler marks a range. */
  onRangeChange?: (range: FilmRange | null) => void;
  /** With it, the range's label can be dragged into the app's chat (STUDIO_REF_TYPE), and says the key that refers it. */
  rangeRef?: (range: FilmRange) => StudioRef;
  /**
   * The bar beside the selection (SelectionToolbar) is the timeline's: the person is working here, not on the picture.
   * It is about the clips selected, the range marked or the point picked on the ruler, whichever was picked last.
   */
  selectionBar?: boolean;
  /**
   * The bar's first button, "Add to chat": the clips selected and the range marked (either, or both), or the moment
   * at the playhead (`atMs`) for a point picked on the ruler. Without it the bar has no such button.
   */
  onReferSelection?: (what: { blocks: readonly TimelineBlock[]; range: FilmRange | null; atMs: number | null }) => void;
  /** The bar's Duplicate: copies of the clips right after them. */
  onDuplicate?: (blocks: readonly TimelineBlock[]) => Promise<string | null>;
  /** The bar's Play range: from the range's start, stopping at its end. */
  onPlayRange?: (range: FilmRange) => void;
  totalMs: number;
  /**
   * The playhead while stopped, seeking or scrubbing. With `clock`, it does not follow playback (it stays at the time
   * playback started); the playhead reads the clock itself (see PlayheadTrack).
   */
  timeMs: number;
  /** The playback clock. With it, playing does not re-render the timeline: the playhead and follow-scroll read it. */
  clock?: PlaybackClock | null;
  playing: boolean;
  /** While dragging the playhead: move the picture, do not settle. */
  onScrubPreview: (ms: number) => void;
  /** On release, once: settle. */
  onScrubCommit: (ms: number) => void;
  /** A single seek: the keyboard. */
  onSeek: (ms: number) => void;
  /** Delete a clip from film.html. Null = done. */
  onRemove?: (block: TimelineBlock) => Promise<string | null>;
  /** Delete several at once (a selection), as one edit; without it they go one by one through onRemove. */
  onRemoveMany?: (blocks: readonly TimelineBlock[]) => Promise<string | null>;
  /** Write a track toggle or reorder back to film.html. Null = done; a sentence = shown to the user. */
  onEditBlocks?: (edits: ClipEdit[]) => Promise<string | null>;
  /**
   * Write an edit planned here (lib/timeline-edit: a drag, a trim, a ripple, a link) as film.html's operations by
   * clip id, in one write and one undo step; `label` names it in the edit history. Without it clips can be selected
   * but not dragged — a read-only film, rather than a drag that does nothing. Null = done; a sentence = shown.
   */
  onEditOps?: (ops: Op[], label: string) => Promise<string | null>;
  /** Clip id → its `data-link`: clips sharing one are selected and edited together (see the Linked switch). */
  links?: ReadonlyMap<string, string>;
  /**
   * Filled with the timeline's commands, for keys bound outside it (Q / W, N…): each acts as its menu entry or switch
   * does, on the selection or the clips under the playhead.
   */
  commandsRef?: React.MutableRefObject<TimelineCommands | null>;
  /**
   * Split clips in two at a time, in one edit (the clips linked to them are already among them). Null = done.
   * Without it there is no split tool.
   */
  onSplit?: (blocks: readonly TimelineBlock[], atMs: number) => Promise<string | null>;
  /** Take a video's sound apart from its picture, onto a track of its own (an editor's unlink). */
  onDetachAudio?: (block: TimelineBlock) => Promise<string | null>;
  /**
   * Thumbnails: key (`mtime:clipId@intoMs#v`, see thumb-frame) → image address. Shot outside; keyed by the
   * clip's own millisecond, not film time, so moving a clip does not change its pictures.
   */
  thumbs?: ReadonlyMap<string, string>;
  /** A poster per clip src, covering a picture clip until its thumbnails exist. */
  posters?: Readonly<Record<string, string>>;
  /** Clips whose media shows no picture, by source path, and why — marked on their own block. */
  mediaTrouble?: ReadonlyMap<string, 'decode' | 'unreachable' | 'missing'>;
  /** Files in the project a missing clip's media may have moved to (same file name), best first. */
  relinkCandidates?: (src: string) => readonly string[];
  /** Point a clip whose media is missing at another file: one of the candidates, or null to pick a file to import. */
  onRelink?: (block: TimelineBlock, path: string | null) => void;
  /** What is in view and at what density: thumbnail shooting only shoots what can be seen (the zoom is ours). */
  onViewChange?: (view: { fromMs: number; toMs: number; pxPerMs: number }) => void;
  subtitles?: {
    on: boolean;
    onToggle: () => void;
    onConfigure: () => void;
    configuring?: boolean;
    /** How many subtitle lines the film has. 0 = none yet: the button is disabled and says why. */
    count: number;
    /** Speech heard in the film with no transcript yet: the button makes subtitles for it (`onMake`). */
    untranscribed?: number;
    onMake?: () => void;
    /** A transcription runs now. */
    making?: boolean;
    /** Why making them failed; `connect`: no service can transcribe, and the button opens Providers. */
    problem?: { text: string; connect: boolean } | null;
  };
  /** A clip's waveform address, from its src. Without it no waveforms are drawn. */
  waveUrl?: (src: string) => string;
  /** Copy clips (the clipboard lives outside, so it survives across tracks and projects). */
  onCopy?: (blocks: readonly TimelineBlock[]) => void;
  /** Export this clip alone (MG only), by film.html clip id. */
  onExportBlock?: (clipId: string) => void;
  /**
   * Paste at a time. `lane` = the whole group onto that row (right-click); `null` = each back to its own row
   * (keyboard, nothing selected).
   */
  onPaste?: (lane: string | null, atMs: number) => Promise<string | null>;
  /**
   * A file from the media pane dropped at this time and place. `target` is the timeline's landing answer (see
   * assetDropSpot) — the preview drew exactly it — with its edit mode onto a track (room made by planRoom). Null = done.
   */
  onDropAsset?: (file: ResourceDragItem, target: AssetDropTarget, atMs: number) => Promise<string | null>;
  /**
   * Files from the computer dropped at this time and place: imported into the media pane, then placed where they were
   * dropped (`hit` is the row under the pointer, as assetDropSpot reads it). Null = done.
   */
  onDropFiles?: (files: File[], hit: AssetLaneHit | null, atMs: number, edit?: EditMode) => Promise<string | null>;
  /** Whether anything is copied — only decides whether Paste is disabled. */
  hasClipboard?: boolean;
  /** Without it there are no undo / redo buttons (read-only). */
  history?: TimelineHistory;
  /** Selection, when owned outside (the Inspector). Kept internally without it. */
  selected?: readonly string[];
  onSelectedChange?: (ids: readonly string[]) => void;
  /** Names given to tracks (by film.html track index), shown in their heads. */
  trackNames?: ReadonlyMap<number, string>;
  /** Name a track (an empty name takes it away): with it, a track's head menu has Rename. */
  onRenameTrack?: (docIndex: number, name: string) => void;
  /** The subtitle row under the ruler (components/SubtitleRow): the film's subtitles, timed by hand. */
  subtitleRow?: SubtitleRowSpec;
  /** Solo (Studio's playback only): the tracks soloed (film.html indexes), and a click on a head's S (⌥: alone). */
  solo?: { tracks: ReadonlySet<number>; onToggle: (docIndex: number, only: boolean) => void };
  /** Drawn on the ruler, scrolling with it (the markers, components/TimelineMarkers). */
  rulerOverlay?: (pxPerMs: number) => React.ReactNode;
  /** Drawn on each row, over its clips (the clips' markers). */
  trackOverlay?: (track: TimelineTrack, pxPerMs: number) => React.ReactNode;
  /** More buttons in the toolbar, before the zoom (the markers' list). */
  toolbarExtra?: React.ReactNode;
  /** More times a drag snaps to (the markers), ms. */
  snapPointsMs?: readonly number[];
  /** A track's head edge dragged (a height, `done` at the end) or double-clicked (null: its own height). */
  onResizeTrack?: (track: TimelineTrack, height: number | null, done: boolean) => void;
  /** A file from the media pane dropped with ⇧ on a clip: it takes the clip's place (lib/clip-replace). */
  onReplaceDrop?: (block: TimelineBlock, file: ResourceDragItem) => void;
  /**
   * Each clip's fades, ms (clip id → [in, out]; lib/clip-fade): drawn as a ramp over the clip, with a handle at each
   * top corner that is dragged inward to set them (written through onEditOps).
   */
  fades?: ReadonlyMap<string, FadeMs>;
  /** The transitions the fades make (lib/transitions findTransitions): a mark over each, picked, resized, deleted. */
  transitions?: readonly FilmTransition[];
  /** A transition put on a cut (the cut's menu, a clip's menu), resized or deleted. Null = done. */
  onTransition?: (ask: TransitionAsk) => Promise<string | null>;
  /** The transition picked (its key), shared with the inspector. */
  pickedTransition?: string | null;
  onPickTransition?: (key: string | null) => void;
}

/** What keys bound outside the timeline can ask it to do (see TimelineProps.commandsRef). */
export interface TimelineCommands {
  /** Q: take off the head of the selected clip (or the one under the playhead) up to the playhead, and close up. */
  rippleTrimStart: () => void;
  /** W: take off its tail from the playhead, and close up. */
  rippleTrimEnd: () => void;
  /** Close the gap picked on a track. */
  closeGap: () => void;
  /** Link the selected clips, or unlink them. */
  link: () => void;
  unlink: () => void;
  /** The switches (see lib/timeline-prefs). */
  toggleMagnet: () => void;
  toggleSnap: () => void;
  toggleSync: () => void;
  toggleLinked: () => void;
  /**
   * ⌘B: split the selected clips at the playhead; with nothing selected, the clip under it on the targeted track (the
   * one last pressed), else on the topmost track seen. The clips linked to them go too.
   */
  split: () => void;
  /** ⇧⌘B: split every clip under the playhead, on every unlocked track. */
  splitAll: () => void;
  /** ⌘X: copy the selected clips, then delete them (closing the gap with the magnet on, as ⌫ does). */
  cut: () => void;
  /** ⌥← / ⌥→: move the selected clips `frames` frames, in the timeline's mode. */
  nudge: (frames: number) => void;
  /** ⇧Z: the whole film in view. */
  zoomFit: () => void;
  /** The targeted track (film.html index): the one last pressed; null when none is. */
  target: () => number | null;
}

/** The selection frame: thin top and bottom, wide sides, drawn outside the clip. The hit area is wider still. */
const SELECT_Y = 1;
const SELECT_X = 2;
const SELECT_HIT = 8;
/** What the app's chat points at (a pill hovered there): an accent ring and its glow, around a clip or a track's head. */
const CHAT_RING = '0 0 0 2px var(--tl-accent), 0 0 10px 1px color-mix(in srgb, var(--tl-accent) 60%, transparent)';
/* the sides (trim handles) are solid, top and bottom lighter; theme color (--tl-select) so it shows on light lanes */
const SELECT_EDGE_X = 'var(--tl-select)';
const SELECT_EDGE_Y = 'color-mix(in srgb, var(--tl-select) 70%, transparent)';

function SelectFrame() {
  return (
    <span
      aria-hidden
      data-block-frame=""
      className="pointer-events-none absolute rounded-[3px]"
      style={{
        top: -SELECT_Y,
        bottom: -SELECT_Y,
        left: -SELECT_X,
        right: -SELECT_X,
        boxSizing: 'border-box',
        borderStyle: 'solid',
        borderColor: `${SELECT_EDGE_Y} ${SELECT_EDGE_X}`,
        borderWidth: `${SELECT_Y}px ${SELECT_X}px`,
      }}
    />
  );
}

/** A clip's numbers in the message being written in the app's chat ([1], [2], … as the agent reads them). */
function ChatNumbers({ numbers }: { numbers: readonly number[] }) {
  return (
    <span aria-hidden data-chat-numbers={numbers.join(',')} className="pointer-events-none absolute -top-[5px] left-[3px] z-[3] flex gap-[2px]">
      {numbers.map((n) => (
        <span key={n} className="flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-[3px] text-[9.5px] font-semibold leading-none tabular-nums text-white shadow-[0_1px_3px_rgba(0,0,0,.35)]"
          style={{ background: 'var(--tl-accent)' }}>{n}</span>
      ))}
    </span>
  );
}

function TrimHandle({
  edge,
  picked,
  hit = SELECT_HIT,
  onDown,
}: {
  edge: 'start' | 'end';
  /** Picked and with no clip right against this edge: the grab reaches outside the clip too. */
  picked: boolean;
  /** Grab width; narrower on narrow clips so the handles do not cover the whole clip. */
  hit?: number;
  onDown: (e: React.PointerEvent) => void;
}) {
  return (
    <span
      role="presentation"
      data-trim={edge}
      className="group/trim absolute inset-y-0 z-[2] cursor-ew-resize"
      /* picked, the grab straddles the edge (the selection frame outside, the clip's own edge inside): a person reaches
         for the clip's edge, and grabbing just inside it moved the whole clip instead (UI test, 2026-10-03). Not where
         another clip touches it: outside is that clip's edge, and the cut between them a roll */
      style={{
        width: picked ? hit * 2 : hit,
        ...(edge === 'start'
          ? { left: picked ? -hit : 0 }
          : { right: picked ? -hit : 0 }),
      }}
      onPointerDown={onDown}
    >
      {/* a bar shows on hover: an invisible handle gives no hint it can be pulled */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-[3px] w-[3px] rounded-full bg-[var(--tl-select)] opacity-0 transition-opacity group-hover/trim:opacity-90"
        style={edge === 'start' ? { right: picked ? hit : undefined, left: picked ? undefined : 1 } : { left: picked ? hit : undefined, right: picked ? undefined : 1 }}
      />
    </span>
  );
}

/**
 * The range bar under the tracks — the only horizontal scrollbar (the track area's own is hidden). Its thumb goes
 * against the zoom: at 100% or less it fills the bar and cannot move; above that it can be dragged.
 */
function TimelineRangeBar({
  zoom,
  totalMs,
  fromMs,
  viewMs,
  height,
  onPan,
}: {
  zoom: number;
  totalMs: number;
  fromMs: number;
  viewMs: number;
  height: number;
  onPan: (fromMs: number) => void;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [barW, setBarW] = React.useState(0);
  const drag = React.useRef<{ grab: number; viewMs: number } | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setBarW(el.clientWidth));
    ro.observe(el);
    setBarW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const thumb = filmZoomThumb({ zoom, width: barW, fromMs, totalMs, viewMs });

  const panAt = (clientX: number, grab: number, span: number) => {
    const el = ref.current;
    if (!el || barW <= 0) return;
    const thumbW = filmZoomThumb({ zoom, width: barW, fromMs: 0, totalMs, viewMs: span }).width;
    const travel = barW - thumbW;
    if (travel <= 0 || !(totalMs > 0) || span >= totalMs) {
      onPan(0);
      return;
    }
    const left = Math.min(travel, Math.max(0, clientX - el.getBoundingClientRect().left - grab));
    onPan((left / travel) * (totalMs - span));
  };

  return (
    <div
      ref={ref}
      role="scrollbar"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.round(totalMs)}
      aria-valuenow={Math.round(fromMs)}
      onPointerDown={(e) => {
        if (e.button !== 0 || !thumb.canDrag) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const local = e.clientX - e.currentTarget.getBoundingClientRect().left;
        const onThumb = local >= thumb.left && local <= thumb.left + thumb.width;
        const grab = onThumb ? local - thumb.left : thumb.width / 2;
        drag.current = { grab, viewMs };
        panAt(e.clientX, grab, viewMs);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        panAt(e.clientX, d.grab, d.viewMs);
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      className="tl-range relative min-w-0 shrink-0 touch-none"
      style={{ height, cursor: thumb.canDrag ? 'pointer' : 'default' }}
    >
      <div
        className="tl-range-thumb absolute inset-y-0"
        style={{ left: thumb.left, width: thumb.width }}
      />
    </div>
  );
}

/**
 * Memoized: the editor holds a lot of state, and none of it should redraw hundreds of clips. While playing,
 * `timeMs` changes every tick and gets through; the rows inside are memoized too so only the playhead moves.
 */
export const Timeline = React.memo(function Timeline({
  tracks,
  blockMenuExtra,
  trackMenuExtra,
  onReferBlocks,
  range,
  chat,
  onHoverBlock,
  onRangeChange,
  rangeRef,
  selectionBar = false,
  onReferSelection,
  onDuplicate,
  onPlayRange,
  totalMs,
  timeMs,
  clock,
  playing,
  onScrubPreview,
  onScrubCommit,
  onSeek,
  onRemove,
  onRemoveMany,
  onEditBlocks,
  onEditOps,
  links,
  commandsRef,
  onSplit,
  onDetachAudio,
  onCopy,
  onPaste,
  onExportBlock,
  onDropAsset,
  onDropFiles,
  hasClipboard,
  thumbs,
  posters,
  mediaTrouble,
  relinkCandidates,
  onRelink,
  onViewChange,
  subtitles,
  waveUrl,
  history,
  selected: selectedProp,
  onSelectedChange,
  trackNames,
  onRenameTrack,
  subtitleRow,
  solo,
  rulerOverlay,
  trackOverlay,
  toolbarExtra,
  snapPointsMs,
  onResizeTrack,
  onReplaceDrop,
  fades,
  transitions,
  onTransition,
  pickedTransition = null,
  onPickTransition,
}: TimelineProps) {
  /* the project's frame rate: the ruler's labels, the frame grid and the arrow keys' steps */
  const fps = useTimecodeFps();
  /* "now" for event handlers is read from a ref: as a dependency it would rebuild callbacks twenty times a second
     while playing and defeat the memoized children */
  const timeMsRef = React.useRef(timeMs);
  /* with a clock, "now" comes from the clock: while playing, timeMs stays at the time playback started */
  timeMsRef.current = clock ? clock.get() : timeMs;
  React.useEffect(() => {
    if (!clock) return undefined;
    const sync = () => { timeMsRef.current = clock.get(); };
    sync();
    return clock.subscribe(sync);
  }, [clock]);
  const t = useT();
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const toolbarRef = React.useRef<HTMLDivElement | null>(null);
  /* the head column and the ruler do not scroll themselves; the track area drives them (ruler horizontally, heads
     vertically), so clips and ticks never drift apart by a few pixels */
  const headRef = React.useRef<HTMLDivElement | null>(null);
  const rulerRef = React.useRef<HTMLDivElement | null>(null);
  const skinsShiftRef = React.useRef<HTMLDivElement | null>(null);
  const padTopRef = React.useRef(0);
  const dragExtentRef = React.useRef(0);
  /** The view: scroll position and size. Ticks drawn and rows centered by it. */
  const [view, setView] = React.useState({ left: 0, top: 0, width: 0, height: 0 });

  const [zoom, setZoom] = React.useState(ZOOM_DEFAULT);
  /* the switches: snapping, the magnet (insert and ripple), sync lock, linked clips; kept on this machine */
  const prefs = useTimelinePrefs();
  const snap = prefs.snap;
  const prefsRef = React.useRef(prefs);
  prefsRef.current = prefs;
  const togglePref = React.useCallback((pref: keyof typeof prefs) => writeTimelinePref(pref, !prefsRef.current[pref]), []);
  const [assetHint, setAssetHint] = React.useState<AssetHint | null>(null);
  const [dropBusy, setDropBusy] = React.useState(false);
  /* what went wrong (a drop, an edit), or what an edit could not do: said in the toolbar until dismissed */
  const [dropError, setDropError] = React.useState<string | null>(null);
  /* what an edit that was made could not do all of (a ripple that left a gap): said beside it, as a warning */
  const [notice, setNotice] = React.useState<string | null>(null);
  /* the tracks as an edit sees them (lib/timeline-edit): every gesture plans on it */
  const model = React.useMemo(() => editModelOf(tracks, links), [tracks, links]);
  const modelRef = React.useRef(model);
  modelRef.current = model;
  /** Block ids → the same clips with every clip linked to them, unless the Linked switch is off (or `alone`). */
  const withLinked = React.useCallback((ids: readonly string[], alone = false): string[] => {
    if (alone || !prefsRef.current.linked) return [...ids];
    const blocks = tracks.flatMap((tr) => tr.blocks);
    const clipIds = blocks.filter((b) => ids.includes(b.id) && b.clipId).map((b) => b.clipId!);
    if (!clipIds.length) return [...ids];
    const linked = new Set(linkedIds(modelRef.current, clipIds));
    return [...new Set([...ids, ...blocks.filter((b) => b.clipId && linked.has(b.clipId)).map((b) => b.id)])];
  }, [tracks]);
  const [internalSelected, setInternalSelected] = React.useState<readonly string[]>([]);
  const selected = selectedProp ?? internalSelected;
  const setSelected = React.useCallback((ids: readonly string[]) => {
    if (selectedProp === undefined) setInternalSelected(ids);
    onSelectedChange?.(ids);
  }, [selectedProp, onSelectedChange]);
  /** Select a clip, with the clips linked to it (⌥: it alone). */
  const selectOne = React.useCallback((id: string | null, alone = false) => {
    setSelected(id ? withLinked([id], alone) : []);
  }, [setSelected, withLinked]);
  /**
   * Clicking a clip that is part of a multi-selection: on release without movement, the selection becomes that clip
   * (and its linked clips; ⌥ it alone). Not on press — then it is not yet known whether this is "select it" or "drag
   * the group", and collapsing would leave the group undraggable. Same threshold as dragging.
   */
  const collapseIfClick = React.useCallback((e: React.PointerEvent, id: string, alone = false) => {
    const fromX = e.clientX;
    const fromY = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent): void => {
      if (Math.abs(ev.clientX - fromX) >= DRAG_THRESHOLD_PX
        || Math.abs(ev.clientY - fromY) >= DRAG_THRESHOLD_PX) moved = true;
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) selectOne(id, alone);
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up);
  }, [selectOne]);
  /* scrubbing: the knob is filled while held, hollow at rest */
  const [scrubbing, setScrubbing] = React.useState(false);
  /**
   * The line's own time while scrubbing (null = follow `timeMs`). The line follows every frame from this local state
   * (only the timeline re-renders); the editor and the picture are told every SCRUB_TELL_MS.
   */
  const [scrubMs, setScrubMs] = React.useState<number | null>(null);
  /** When the time was last told upward (see SCRUB_TELL_MS). */
  const lastTold = React.useRef(0);
  /** What the selection bar is about: what was picked last (the clips, the range, a point on the ruler). */
  const [barFocus, setBarFocus] = React.useState<'clips' | 'range' | 'point' | null>(null);
  /* select or split: a mode, because a rough cut is a dozen cuts in a row */
  const [selectedMode, setMode] = React.useState<TimelineMode>('select');
  const mode = onSplit ? selectedMode : 'select';

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      setView((cur) => (cur.width === el.clientWidth && cur.height === el.clientHeight
        ? cur
        : { ...cur, width: el.clientWidth, height: el.clientHeight }));
    });
    ro.observe(el);
    setView({
      left: el.scrollLeft,
      top: el.scrollTop,
      width: el.clientWidth,
      height: el.clientHeight,
    });
    return () => ro.disconnect();
  }, []);

  /* ruler and heads follow at once, and the view is written back at once (a frame late shows a gap at the top) */
  const onScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (rulerRef.current) rulerRef.current.scrollLeft = el.scrollLeft;
    if (headRef.current) headRef.current.scrollTop = el.scrollTop;
    if (skinsShiftRef.current) {
      skinsShiftRef.current.style.transform = `translate3d(0,${padTopRef.current - el.scrollTop}px,0)`;
    }
    const left = el.scrollLeft;
    const top = el.scrollTop;
    el.style.setProperty('--tl-scroll-left', `${left}px`);
    setView((cur) => (
      cur.left === left && cur.top === top
        ? cur
        : { ...cur, left, top }
    ));
  }, []);

  /* with length 0 there may still be empty tracks (`clips: []`): they are drawn so assets can be dropped on them;
     playback and scrubbing still need a length */
  const hasLanes = tracks.length > 0;
  const playable = totalMs > 0 && hasLanes;
  const laneW = Math.max(0, view.width);
  /*
   * When the film's length changes (dragged past the end, undo, a new evaluation) the time in view stays; only the
   * zoom factor is adjusted. Otherwise 100% = the whole film, and a longer film would squeeze every clip mid-drag.
   * Not from a film shorter than the narrowest view (the first clip arriving): that would open zoomed all the way in.
   * Worked out during render and written back (the slider follows); not before the width is known.
   */
  const clipEndMs = tracks.reduce((ms, tr) => {
    for (const b of tr.blocks) if (b.endMs > ms) ms = b.endMs;
    return ms;
  }, 0);
  /* what the timeline lays out: every clip, those of a hidden track too (the film's own length leaves them out, and
     hiding a track would rescale the timeline) */
  const spanMs = Math.max(totalMs, clipEndMs);
  const prevTotalMs = React.useRef(spanMs);
  let viewZoom = zoom;
  if (prevTotalMs.current !== spanMs) {
    if (laneW > 0) {
      const prev = prevTotalMs.current;
      prevTotalMs.current = spanMs;
      if (prev >= VIEW_SPAN_MIN_MS && spanMs > 0) {
        const keep = zoomedPxPerMs(prev, laneW, zoom);
        viewZoom = zoomForPxPerMs(spanMs, laneW, keep);
        if (Math.abs(viewZoom - zoom) > 1e-9) setZoom(viewZoom);
      }
    }
  }
  const pxPerMs = zoomedPxPerMs(spanMs, laneW, viewZoom);
  const canvasMs = canvasTimeMs(spanMs, laneW, pxPerMs);

  /* tell what is in view (thumbnails only shoot what can be seen), at most every 150 ms so scrolling does not keep
     cancelling the shooting */
  React.useEffect(() => {
    if (!onViewChange || !(pxPerMs > 0)) return;
    const timer = setTimeout(() => {
      onViewChange({
        fromMs: view.left / pxPerMs,
        toMs: (view.left + view.width) / pxPerMs,
        pxPerMs,
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [onViewChange, view.left, view.width, pxPerMs]);
  /*
   * Rows are centered vertically: a few rows pinned to the top of a tall pane leave a meaningless empty half. Heights
   * are computed from constants, not measured (measuring costs a render, right when the rows appear).
   */
  const tracksH = hasLanes
    ? tracks.reduce((h, tr) => h + rowH(tr) + GAP, 0)
    : 0;
  /* at least TL_VPAD even when the rows overflow, counted in padTop so every hit test uses the same number */
  const padTop = Math.max(TL_VPAD, Math.floor((view.height - tracksH) / 2));
  padTopRef.current = padTop;

  /* in the project's frames: at 25 fps a tick every 5 frames, not every 6 as at 30 */
  const steps = React.useMemo(() => rulerSteps(pxPerMs, fps), [pxPerMs, fps]);

  /* ── Zoom around a point ──
     Without a fixed point, zooming jumps elsewhere: the scroll stays, the time under it changes. The point: the
     pointer (wheel zoom), else the playhead if in view, else the middle of the view. */
  const anchorRef = React.useRef<{ ms: number; x: number } | null>(null);
  const anchorAt = React.useCallback((clientX?: number) => {
    const el = scrollRef.current;
    if (!el || pxPerMs <= 0) return;
    const playX = timeMsRef.current * pxPerMs - el.scrollLeft;
    const raw = clientX != null
      ? clientX - el.getBoundingClientRect().left
      : playX >= 0 && playX <= el.clientWidth
        ? playX
        : el.clientWidth / 2;
    const x = Math.min(el.clientWidth, Math.max(0, raw));
    anchorRef.current = { ms: timeAtPx(el.scrollLeft + x, pxPerMs, canvasMs), x };
  }, [pxPerMs, canvasMs]);

  const zoomBy = React.useCallback((factor: number, clientX?: number) => {
    anchorAt(clientX);
    setZoom((z) => Math.min(zoomMaxOf(spanMs), Math.max(zoomMinOf(spanMs), z * factor)));
  }, [anchorAt, spanMs]);

  const zoomTo = React.useCallback((next: number) => {
    anchorAt();
    setZoom(Math.min(zoomMaxOf(spanMs), Math.max(zoomMinOf(spanMs), next)));
  }, [anchorAt, spanMs]);

  /* when the density changes, put the fixed point back in place — before paint, or a frame shows the jump */
  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (!el || !anchor || pxPerMs <= 0) return;
    el.scrollLeft = Math.max(0, anchor.ms * pxPerMs - anchor.x);
    setView({
      left: el.scrollLeft,
      top: el.scrollTop,
      width: el.clientWidth,
      height: el.clientHeight,
    });
  }, [pxPerMs]);

  const panViewTo = React.useCallback((fromMs: number) => {
    const el = scrollRef.current;
    if (!el || !(pxPerMs > 0)) return;
    el.scrollLeft = Math.max(0, fromMs * pxPerMs);
  }, [pxPerMs]);

  /* Ctrl/⌘ + wheel (and pinch) zooms around the pointer. A native non-passive listener: React's onWheel is passive and
     cannot stop the browser's page zoom. Horizontal swipes and Shift+wheel scroll here too: the track area hides its
     horizontal scrollbar. */
  const zoomByRef = React.useRef(zoomBy);
  React.useEffect(() => { zoomByRef.current = zoomBy; }, [zoomBy]);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    /* one zoom per frame: a pinch sends a hundred wheel events a second, each relaying out every clip */
    let factor = 1;
    let anchorX = 0;
    let raf = 0;
    const flush = () => {
      raf = 0;
      const f = factor;
      factor = 1;
      if (f !== 1) zoomByRef.current(f, anchorX);
    };
    /* Firefox reports lines (deltaMode 1) or pages (2) */
    const pixels = (e: WheelEvent, d: number) => (e.deltaMode === 1 ? d * 16 : e.deltaMode === 2 ? d * 400 : d);
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        factor *= Math.exp(-pixels(e, e.deltaY) / 180);
        anchorX = e.clientX;
        if (!raf) raf = requestAnimationFrame(flush);
        return;
      }
      const dx = pixels(e, e.deltaX || (e.shiftKey ? e.deltaY : 0));
      if (!dx) return;
      el.scrollLeft += dx;
      if (e.shiftKey) e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  /**
   * The row under the pointer. Outside the rows it says so (-1 above, tracks.length below) instead of clamping to the
   * nearest row: a marquee in the empty space around centered rows must not select the edge row. marqueeHits takes
   * these safely, and dragging a clip above / below all rows opens a new track there.
   */
  const laneHitAtY = React.useCallback((clientY: number): { lane: number; band: DropBand } => {
    const el = scrollRef.current;
    if (!el) return { lane: -1, band: 'above' };
    let y = clientY - el.getBoundingClientRect().top + el.scrollTop - padTop;
    if (y < 0) return { lane: -1, band: 'above' };
    for (let i = 0; i < tracks.length; i += 1) {
      const h = rowH(tracks[i]!);
      y -= GAP;
      if (y < 0) return { lane: i, band: 'above' };
      if (y < h) {
        /* a narrow band at the top and bottom means "new track"; the rest is "onto this row" (see LANE_EDGE_PX) */
        const edge = Math.min(LANE_EDGE_PX, Math.floor(h / 6));
        if (y < edge) return { lane: i, band: 'above' };
        if (y >= h - edge) return { lane: i, band: 'below' };
        return { lane: i, band: 'body' };
      }
      y -= h;
    }
    return { lane: tracks.length, band: 'below' };
  }, [tracks, padTop]);
  const laneAtY = React.useCallback((clientY: number): number => laneHitAtY(clientY).lane, [laneHitAtY]);

  /* dragging clips; every clip flat for snapping, across rows (putting a sound on a picture cut is the common case) */
  const allBlocks = React.useMemo(() => tracks.flatMap((tr) => tr.blocks), [tracks]);
  /* the subtitle row, under the ruler while its switch is on */
  const [subRowOn] = useSubtitleRowShown();
  const subRowRef = React.useRef<SubtitleRowHandle | null>(null);
  const subRowShown = Boolean(subtitleRow) && subRowOn && hasLanes;
  const subRowH = subRowShown ? SUBTITLE_ROW_H : 0;
  const drag = useBlockDrag({
    allBlocks,
    lanes: tracks,
    model,
    playheadMs: timeMs,
    ...(snapPointsMs ? { snapPointsMs } : {}),
    pxPerMs,
    prefs,
    scrollEl: scrollRef,
    laneHitAtY,
    selectedIds: selected,
    onCommit: onEditOps,
    onDropOut: onReferBlocks,
  });

  /* a dragged right edge grows the canvas at once, and within one drag it only grows (no ruler pumping) */
  /* clips an edit pushes on count too, or a pushed clip would run off the end of the canvas */
  const ghostReach = (ghosts: ReadonlyMap<string, { endMs: number } | null> | undefined) => {
    let ms = 0;
    for (const g of ghosts?.values() ?? []) if (g && g.endMs > ms) ms = g.endMs;
    return ms;
  };
  const reach = Math.max(dragReachMs(drag.preview), assetHint?.endMs ?? 0, ghostReach(drag.preview?.ghosts), ghostReach(assetHint?.ghosts));
  if (drag.preview || assetHint) dragExtentRef.current = Math.max(dragExtentRef.current, reach);
  else dragExtentRef.current = 0;
  const viewMs = pxPerMs > 0 && view.width > 0 ? view.width / pxPerMs : 0;
  const tailMs = (drag.preview || assetHint) ? Math.max(viewMs * 0.5, VIEW_SPAN_MIN_MS) : 0;
  const extentMs = liveCanvasMs({
    canvasMs,
    clipEndMs,
    dragReachMs: dragExtentRef.current,
    tailMs,
  });
  /* whole pixels: a fractional width blurs every clip edge on it */
  const trackPx = pxPerMs > 0 ? Math.max(laneW, Math.ceil(extentMs * pxPerMs)) : laneW;

  const ticks = React.useMemo(() => {
    if (!hasLanes) return [];
    const { fromMs, toMs } = rulerCoverMs({
      leftPx: view.left,
      widthPx: view.width,
      pxPerMs,
      maxMs: extentMs,
      tickMs: steps.tickMs,
    });
    return rulerMarks(fromMs, toMs, steps);
  }, [hasLanes, view.left, view.width, pxPerMs, extentMs, steps]);

  const msAtClientX = React.useCallback((clientX: number): number => {
    const el = scrollRef.current;
    if (!el) return 0;
    /* scroll read now (not view.left): while scrubbing during playback the timeline follows the playhead by itself */
    const ms = timeAtPx(clientX - el.getBoundingClientRect().left + el.scrollLeft, pxPerMs, extentMs);
    /* on a frame: a click and a split land where the arrow keys would, not 11 ms past it */
    return Math.min(extentMs, frameMs(frameAt(ms, fps), fps));
  }, [pxPerMs, extentMs, fps]);

  /**
   * How many pixels the pointer is from the line at `ms`. In pixels, not time: time is clamped twice (to the canvas
   * and to the film), and past the end of the film every point would clamp to "on the playhead".
   */
  const playheadGapPx = React.useCallback((clientX: number, ms: number): number => {
    const el = scrollRef.current;
    if (!el) return Infinity;
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft;
    return Math.abs(x - ms * pxPerMs);
  }, [pxPerMs]);

  /** Right after a seek the playhead is under the pointer: show the scrub cursor without waiting for a move. */
  const warmPlayheadAt = React.useCallback((clientX: number, clientY: number, atMs: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const inside = clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
    /* compared with where the playhead really settled: a seek past the end clamps to the end */
    const settled = Math.max(0, Math.min(totalMs, atMs));
    const hot = inside && playable && hasLanes
      && playheadGapPx(clientX, settled) <= PLAYHEAD_GRAB_PX;
    el.classList.toggle('tl-playhead-hot', hot);
  }, [playable, hasLanes, playheadGapPx, totalMs]);

  /* A scrub follows the pointer from pointerdown to pointerup even outside the timeline (listeners on window). Each
     frame previews, release commits: hundreds of seeks would make the sound tear. A click without dragging takes the
     same path. */
  const startScrub = React.useCallback((e: React.PointerEvent, fromRuler = false) => {
    if (e.button !== 0 || !playable) return;
    e.preventDefault();
    let at = msAtClientX(e.clientX);
    setScrubMs(at);
    onScrubPreview(at);
    lastTold.current = performance.now();
    setScrubbing(true);
    /* the scrub cursor holds for the whole drag (an !important class), or clips under the line take it */
    document.body.classList.add('tl-scrubbing');
    /* once per frame: the pointer sends far more moves than the screen draws */
    let raf = 0;
    let atX = e.clientX;
    const flush = (): void => {
      raf = 0;
      at = msAtClientX(atX);
      /* the line every frame (cheap: the rows are memoized without the time) */
      setScrubMs(at);
      /* the editor and the picture every SCRUB_TELL_MS (the expensive part) */
      const now = performance.now();
      if (now - lastTold.current >= SCRUB_TELL_MS) {
        lastTold.current = now;
        onScrubPreview(at);
      }
    };
    /* auto-scroll at the edges, then recompute the time under the pointer */
    const edge = edgeAutoScroll(scrollRef, () => { if (!raf) raf = requestAnimationFrame(flush); });
    const move = (ev: PointerEvent) => {
      atX = ev.clientX;
      if (!raf) raf = requestAnimationFrame(flush);
      edge.at(ev.clientX);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      edge.stop();
      /* a frame still pending is settled now: the last bit of movement counts */
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        at = msAtClientX(atX);
      }
      document.body.classList.remove('tl-scrubbing');
      setScrubbing(false);
      setScrubMs(null);
      onScrubCommit(at);
      warmPlayheadAt(ev.clientX, ev.clientY, at);
      /* a point picked on the ruler: the selection bar is about the moment there */
      if (fromRuler) setBarFocus('point');
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up);
  }, [msAtClientX, onScrubCommit, onScrubPreview, playable, warmPlayheadAt]);

  /** The range being pulled on the ruler, before it is the editor's (drawn from here, not re-rendering the editor). */
  const [rangeDraft, setRangeDraft] = React.useState<FilmRange | null>(null);
  /*
   * The ruler marks a range with Shift held: a plain press there still scrubs (the one place the playhead is dragged
   * keeps its meaning), a ⇧-drag pulls a range from where it was pressed, on frames, inside the film. A ⇧-click that
   * does not drag leaves the range as it was.
   */
  const startRange = React.useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || !playable || !onRangeChange) return;
    e.preventDefault();
    const startX = e.clientX;
    const at = (clientX: number) => Math.min(totalMs, msAtClientX(clientX));
    const fromMs = at(e.clientX);
    let dragged = false;
    let atX = e.clientX;
    let raf = 0;
    const flush = (): void => { raf = 0; setRangeDraft(orderedRange(fromMs, at(atX))); };
    const edge = edgeAutoScroll(scrollRef, () => { if (!raf) raf = requestAnimationFrame(flush); });
    const move = (ev: PointerEvent) => {
      atX = ev.clientX;
      if (!dragged && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX) return;
      dragged = true;
      if (!raf) raf = requestAnimationFrame(flush);
      edge.at(ev.clientX);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      edge.stop();
      if (raf) cancelAnimationFrame(raf);
      setRangeDraft(null);
      if (dragged) onRangeChange(orderedRange(fromMs, at(ev.clientX)));
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up);
  }, [msAtClientX, onRangeChange, playable, totalMs]);

  /**
   * The marquee being drawn. `y` follows the pointer (content coordinates), not row edges: starting in a gap, a box
   * snapped to a row edge would jump. Hits are worked out by row (marqueeHits).
   */
  const [marquee, setMarquee] = React.useState<
  { fromMs: number; toMs: number; fromLane: number; toLane: number; fromY: number; toY: number }
  | null>(null);

  /**
   * Send a plan (lib/timeline-edit) as one edit. A ripple that could not close all of its time (a clip on a track it
   * reaches is in the way) says so: the clips stay in sync, and the person learns why a gap is left.
   */
  const runPlan = React.useCallback(async (plan: EditPlan | null, label: string): Promise<void> => {
    if (!onEditOps || !plan?.ops.length) return;
    const err = await onEditOps(plan.ops, label);
    if (err) setDropError(err);
    /* not an error: the edit was made, and this says why a gap was left (a warning's look, not an error's) */
    else if (plan.shortMs > 0) setNotice(t('timeline.rippleShort').replace('{s}', (plan.shortMs / 1000).toFixed(2)));
  }, [onEditOps, t]);

  /** A gap picked on a track (a click between two clips, or before the first): drawn, and ⌫ closes it. */
  const [gap, setGap] = React.useState<{ track: number; startMs: number; endMs: number } | null>(null);
  /**
   * The targeted track (its row's lane): the one last pressed, its head or its empty space or a clip on it. ⌘B with
   * nothing selected cuts there, and the media pane's "+" puts a file there. Marked on its head.
   */
  const [targetLane, setTargetLane] = React.useState<string | null>(null);
  const targetLaneRef = React.useRef(targetLane);
  targetLaneRef.current = targetLane;
  React.useEffect(() => {
    if (targetLane && !tracks.some((tr) => tr.lane === targetLane)) setTargetLane(null);
  }, [tracks, targetLane]);
  /** The track whose name is being typed in its head (film.html index). */
  const [renaming, setRenaming] = React.useState<number | null>(null);
  const renamingRef = React.useRef(renaming);
  renamingRef.current = renaming;
  /* a named track widens the heads, so its name fits beside its badge */
  const named = renaming != null || tracks.some((tr) => tr.docIndex != null && Boolean(trackNames?.get(tr.docIndex)));
  const headW = (named ? HEAD_NAMED_W : HEAD_W) + (solo ? HEAD_SOLO_W : 0);
  /* picking clips lets the gap go; so does an edit that fills or moves it */
  React.useEffect(() => { if (selected.length) setGap(null); }, [selected.length]);
  React.useEffect(() => {
    setGap((g) => {
      if (!g) return g;
      const now = gapAt(model, g.track, (g.startMs + g.endMs) / 2);
      return now && Math.abs(now.startMs - g.startMs) < TOUCH_MS && Math.abs(now.endMs - g.endMs) < TOUCH_MS ? g : null;
    });
  }, [model]);
  /** Close the gap picked: what is after it moves back (with sync lock, on every unlocked track). */
  const closeGap = React.useCallback(() => {
    const g = gap;
    if (!g) return;
    setGap(null);
    void runPlan(planCloseGap(modelRef.current, g.track, g, { sync: prefsRef.current.sync }), 'history.stepGapClosed');
  }, [gap, runPlan]);

  /** Clips inside the marquee are framed while it is drawn — "what does this box catch" is the whole question. */
  const framed = React.useMemo(
    () => (marquee ? marqueeHits(tracks, marquee) : null),
    [marquee, tracks],
  );
  /** The clips to frame: the marquee's while drawing, else the selection. */
  const ringed = framed ?? selected;
  /* handlers read the selection from a ref: as a dependency every click would rebuild callbacks and clips */
  const selectedRef = React.useRef(selected);
  selectedRef.current = selected;
  /* whether the last press was on the timeline: ⌘A selects all clips only then */
  const activeRef = React.useRef(false);

  /** The pointer's y in the track content (with scroll, without the centering pad). */
  const contentY = React.useCallback((clientY: number): number => {
    const el = scrollRef.current;
    if (!el) return 0;
    return clientY - el.getBoundingClientRect().top + el.scrollTop;
  }, []);
  /**
   * A press on empty track space: dragging ≥5 px draws a marquee; otherwise it is a click that moves the playhead
   * (on release, so a marquee never throws the playhead to its start).
   */
  const startMarquee = React.useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || !playable) return;
    e.preventDefault();
    const startX = e.clientX;
    const fromMs = msAtClientX(e.clientX);
    const fromLane = laneAtY(e.clientY);
    const fromY = contentY(e.clientY);
    /* ⇧ / ⌘ adds to the selection instead of replacing it */
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = additive ? selectedRef.current : [];
    let dragged = false;
    /* measured and set once per frame */
    let pending: PointerEvent | null = null;
    let raf = 0;
    const flush = (): void => {
      raf = 0;
      const ev = pending;
      if (!ev) return;
      pending = null;
      setMarquee({
        fromMs,
        toMs: msAtClientX(ev.clientX),
        fromLane,
        toLane: laneAtY(ev.clientY),
        fromY,
        toY: contentY(ev.clientY),
      });
    };

    let lastEv: PointerEvent | null = null;
    const edge = edgeAutoScroll(scrollRef, () => {
      if (lastEv) pending = lastEv;
      if (!raf) raf = requestAnimationFrame(flush);
    });
    const move = (ev: PointerEvent): void => {
      if (!dragged && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX) return;
      dragged = true;
      pending = ev;
      lastEv = ev;
      if (!raf) raf = requestAnimationFrame(flush);
      edge.at(ev.clientX);
    };
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      edge.stop();
      if (raf) cancelAnimationFrame(raf);
      setMarquee(null);
      if (dragged) {
        const hits = withLinked(marqueeHits(tracks, {
          fromMs, toMs: msAtClientX(ev.clientX), fromLane, toLane: laneAtY(ev.clientY),
        }));
        setSelected(additive ? [...new Set([...base, ...hits])] : hits);
        return;
      }
      /* ⇧ / ⌘ click on empty space: keep the selection, do nothing */
      if (additive) return;
      /* the track clicked is the targeted one (⌘B with nothing selected, the media pane's "+") */
      const pressed = tracks[fromLane];
      setTargetLane(pressed?.docIndex != null ? pressed.lane : null);
      /* a click: clear the selection and move the playhead there; in a gap between clips, the gap is picked (⌫ closes
         it). Its own time, not the frame the playhead lands on: a gap a frame wide is still a gap */
      selectOne(null);
      const docIndex = tracks[fromLane]?.docIndex;
      const exactMs = Math.max(0, (e.clientX - (scrollRef.current?.getBoundingClientRect().left ?? 0) + (scrollRef.current?.scrollLeft ?? 0)) / pxPerMs);
      const found = docIndex != null && onEditOps && !tracks[fromLane]?.locked ? gapAt(modelRef.current, docIndex, exactMs) : null;
      setGap(found ? { track: docIndex!, ...found } : null);
      onScrubCommit(fromMs);
      warmPlayheadAt(ev.clientX, ev.clientY, fromMs);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [playable, msAtClientX, laneAtY, contentY, tracks, selectOne, onScrubCommit, warmPlayheadAt, setSelected, withLinked, onEditOps, pxPerMs]);

  /**
   * A press within ±4 px of the playhead line in the empty track space grabs the playhead. Not over a clip: a clip a
   * few pixels wide under the line could not be selected, dragged or trimmed (the ruler and the knob drag the
   * playhead anywhere). Computed in the capture phase instead of a permanent transparent strip, for the same reason.
   */
  const grabPlayhead = React.useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || !playable || !hasLanes || overClip(e)) return;
    if (playheadGapPx(e.clientX, timeMsRef.current) > PLAYHEAD_GRAB_PX) return;
    e.stopPropagation();
    startScrub(e);
  }, [playable, hasLanes, playheadGapPx, startScrub]);

  /**
   * The scrub cursor within the same ±4 px. A class, not state (a re-render per pointer move is not worth a cursor);
   * the class is !important so it wins over clips' own cursors.
   */
  const hotPlayhead = React.useCallback((e: React.PointerEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    const hot = playable && hasLanes && !overClip(e)
      && playheadGapPx(e.clientX, timeMsRef.current) <= PLAYHEAD_GRAB_PX;
    el.classList.toggle('tl-playhead-hot', hot);
  }, [playable, hasLanes, playheadGapPx]);
  const coldPlayhead = React.useCallback(() => {
    scrollRef.current?.classList.remove('tl-playhead-hot');
  }, []);

  /**
   * In split mode, the blade line under the pointer — what a cut is aimed by. Drawn only where a cut is possible
   * (MIN_BLOCK_MS from either end, unlocked; the same rule as the click): seeing the line means the cut will happen.
   */
  const splitSpots = React.useMemo(() => {
    if (mode !== 'split') return null;
    const out = new Map<string, { fromMs: number; toMs: number }>();
    for (const tr of tracks) {
      if (tr.locked) continue;
      for (const b of tr.blocks) {
        const fromMs = b.startMs + MIN_BLOCK_MS;
        const toMs = b.endMs - MIN_BLOCK_MS;
        /* too short to split anywhere: no line */
        if (toMs > fromMs) out.set(b.id, { fromMs, toMs });
      }
    }
    return out;
  }, [mode, tracks]);

  const bladeRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const hideBlade = React.useCallback(() => {
    const line = bladeRef.current;
    if (line) line.style.display = 'none';
  }, []);
  /* written to the DOM directly, not state: a re-render per pointer move would make split mode stutter */
  const aimBlade = React.useCallback((e: React.PointerEvent) => {
    const line = bladeRef.current;
    const box = contentRef.current;
    if (!line || !box || !splitSpots) return;
    const hit = (e.target as Element | null)?.closest('[data-block-id]');
    const el = hit instanceof HTMLElement ? hit : null;
    const spot = el ? splitSpots.get(el.dataset.blockId ?? '') : undefined;
    const at = spot ? msAtClientX(e.clientX) : 0;
    if (!el || !spot || !(at > spot.fromMs && at < spot.toMs)) {
      line.style.display = 'none';
      return;
    }
    /* only as tall as the clip under the pointer: a full-height line would suggest cutting every track. Rects are
       subtracted (not offsetTop: the clip's offsetParent is its row), which is immune to scrolling. */
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    line.style.display = 'block';
    line.style.transform = `translateX(${at * pxPerMs}px)`;
    line.style.top = `${top}px`;
    line.style.height = `${el.offsetHeight}px`;
  }, [msAtClientX, pxPerMs, splitSpots]);

  /**
   * Delete clips: locked rows untouched. Planned (lib/timeline-edit) as one edit; with `ripple` the time they took
   * closes (with sync lock on every unlocked track). Without onEditOps, one by one through onRemove(Many).
   */
  const removeMany = React.useCallback(async (blocks: readonly TimelineBlock[], ripple = false) => {
    const locked = new Set(
      tracks.filter((tr) => tr.locked).flatMap((tr) => tr.blocks.map((b) => b.id)),
    );
    const targets = blocks.filter((b) => b.loc && !locked.has(b.id));
    /* clear the selection first: the delete is immediate, a lingering frame feels slow */
    setSelected([]);
    if (!targets.length) return;
    if (onEditOps) {
      const ids = targets.flatMap((b) => (b.clipId ? [b.clipId] : []));
      const label = ids.length <= 2 ? `history.stepRemoved|${ids.join(', ')}` : 'history.stepRemove';
      await runPlan(planRemove(modelRef.current, ids, { ripple, sync: prefsRef.current.sync }), label);
      return;
    }
    if (onRemoveMany) {
      await onRemoveMany(targets);
      return;
    }
    if (!onRemove) return;
    const ordered = [...targets].sort((a, b) => (a.loc! < b.loc! ? 1 : -1));
    for (const one of ordered) {
      // One at a time: each delete changes film.html, locations sent together would be stale.
      // eslint-disable-next-line no-await-in-loop
      await onRemove(one);
    }
  }, [onEditOps, onRemove, onRemoveMany, tracks, setSelected, runPlan]);

  /**
   * Ripple delete (⇧Delete, the menu, or Delete with the magnet on): what comes after closes the gap, on the clips'
   * tracks and with sync lock every unlocked track. One edit, one ⌘Z.
   */
  const rippleRemove = React.useCallback(async (blocks: readonly TimelineBlock[], waited = false) => {
    /* a track with clips not drawn yet (an undo just put them back): wait for them, or the gap closes onto them */
    const ids = new Set(blocks.map((b) => b.id));
    if (!waited && tracks.some((tr) => tr.incomplete && tr.blocks.some((b) => ids.has(b.id)))) {
      const wait = { keys: blocks.map((b) => b.clipId ?? b.id) };
      rippleWait.current = wait;
      /* past the wait it goes with what is drawn: a page that never loads must not block it for good */
      window.setTimeout(() => { if (rippleWait.current === wait) rippleRetry.current(true); }, RIPPLE_WAIT_MS);
      return;
    }
    rippleWait.current = null;
    await removeMany(blocks, true);
  }, [removeMany, tracks]);
  /* a waiting ripple delete goes once its tracks are whole, its clips found again by id (their places may have
     changed meanwhile) */
  const rippleWait = React.useRef<{ keys: readonly string[] } | null>(null);
  const rippleRetry = React.useRef((_late: boolean) => {});
  rippleRetry.current = (late: boolean) => {
    const wait = rippleWait.current;
    if (!wait) return;
    const mine = (b: TimelineBlock) => wait.keys.includes(b.clipId ?? b.id);
    if (!late && tracks.some((tr) => tr.incomplete && tr.blocks.some(mine))) return;
    void rippleRemove(tracks.flatMap((tr) => tr.blocks).filter(mine), true);
  };
  React.useEffect(() => { rippleRetry.current(false); }, [tracks]);

  /* selected clips: Delete / Backspace deletes, ⌘C copies, ⌘V pastes at the playhead; not while typing */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTypingTarget(e.target)) return;
      if ((e.target as Element | null)?.closest?.('[role="dialog"]')) return;
      const picked = tracks.flatMap((tr) => tr.blocks).filter((b) => selected.includes(b.id) && b.loc);
      if (e.key === 'Escape' && (selected.length || gap || pickedTransition) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setSelected([]);
        setGap(null);
        onPickTransition?.(null);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a' && activeRef.current) {
        const all = tracks.filter((tr) => !tr.locked).flatMap((tr) => tr.blocks).filter((b) => b.loc).map((b) => b.id);
        if (!all.length) return;
        e.preventDefault();
        setSelected(all);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        /* a transition picked: taken away (its fades, and the overlap it made) */
        if (pickedTransition && !picked.length && onTransition) {
          e.preventDefault();
          void onTransition({ kind: 'remove', key: pickedTransition }).then((err) => { if (err) setDropError(err); });
          onPickTransition?.(null);
          return;
        }
        /* a gap picked on a track: closed */
        if (gap && !picked.length) {
          e.preventDefault();
          closeGap();
          return;
        }
        if ((!onRemove && !onRemoveMany && !onEditOps) || !picked.length) return;
        e.preventDefault();
        /* with the magnet on a delete closes the gap it leaves, as ⇧Delete always does */
        void (e.shiftKey || prefsRef.current.magnet ? rippleRemove(picked) : removeMany(picked));
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      /* ⌘= / ⌘- / ⌘0 zoom the timeline (only when it is visible). ⌘+ is ⇧= on most keyboards, so before the ⇧ check. */
      if (mod && !e.altKey && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
        if (!playable || !scrollRef.current?.checkVisibility?.({ visibilityProperty: true })) return;
        e.preventDefault();
        if (e.key === '0') zoomTo(ZOOM_DEFAULT);
        else zoomBy(e.key === '-' ? 1 / ZOOM_STEP : ZOOM_STEP);
        return;
      }
      if (!mod || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 'c') {
        if (!onCopy || !picked.length) return;
        e.preventDefault();
        onCopy(picked);
        return;
      }
      if (key === 'v') {
        if (!onPaste || !hasClipboard) return;
        const lane = picked[0] ? laneOfBlock(tracks, picked[0].id) : null;
        if (lane && tracks.find((tr) => tr.lane === lane)?.locked) return;
        e.preventDefault();
        void onPaste(lane, timeMsRef.current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    /* the playhead is read from a ref: as a dependency the listener would be swapped twenty times a second */
  }, [onRemove, onRemoveMany, onEditOps, onCopy, onPaste, hasClipboard, removeMany, rippleRemove, selected, tracks, setSelected, playable, zoomBy, zoomTo, gap, closeGap, pickedTransition, onTransition, onPickTransition]);

  /* whether the last press was on the timeline (for ⌘A); capture phase, since presses here are often stopped */
  React.useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const root = scrollRef.current?.closest('[data-timeline]');
      activeRef.current = Boolean(root && e.target instanceof Node && root.contains(e.target));
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, []);

  const [splitting, setSplitting] = React.useState(false);

  const acceptAssetDrag = React.useCallback((e: React.DragEvent): boolean => (
    (Boolean(onDropAsset) && e.dataTransfer.types.includes(RESOURCE_DRAG_TYPE))
    || (Boolean(onDropFiles) && isComputerFileDrag(e.dataTransfer))
  ), [onDropAsset, onDropFiles]);

  /**
   * The time under the pointer for a drop — unlike msAtClientX, not clamped to the film: a drop is what makes the film
   * longer. Clamped, an empty timeline would always drop at 0 (the canvas grows from the preview, the preview starts
   * at the clamped time, which is 0 on an empty timeline…).
   */
  const dropMsAtClientX = React.useCallback((clientX: number): number => {
    const el = scrollRef.current;
    if (!el || pxPerMs <= 0) return 0;
    return Math.max(0, (clientX - el.getBoundingClientRect().left + el.scrollLeft) / pxPerMs);
  }, [pxPerMs]);

  /* where a drop lands, and what it snapped to: on an edge it snapped to, else on a frame. Decided here, before the
     free space is checked: rounded after, a drop on a clip's end (not on a frame) landed a few ms inside it. The first
     clip of a film starts at 0: black before it is never what was meant */
  const dropAt = React.useCallback((atMs: number): { ms: number; target: SnapTarget | null } => {
    if (!allBlocks.some((b) => b.clipId)) return { ms: 0, target: { ms: 0, kind: 'zero' } };
    const raw = Math.max(0, atMs);
    const snapped = snap && pxPerMs > 0
      ? snapMs(raw, snapTargetsFor(allBlocks, '', timeMsRef.current, undefined, snapPointsMs), pxPerMs)
      : { ms: raw, target: null };
    return snapped.target ? snapped : { ms: snapToFrame(raw), target: null };
  }, [allBlocks, pxPerMs, snap, snapPointsMs]);

  /**
   * Where a drop from the media pane lands and what it does there, for the preview and the drop alike. Onto a track,
   * with the magnet (⌥: the other way): an insert at the insert point of the track (lib/timeline-edit insertPointOn),
   * pushing what follows on; without: an overwrite where it was let go. The clips it pushes or cuts are drawn moved.
   */
  const assetLanding = React.useCallback((file: ResourceDragItem, clientX: number, clientY: number, altKey: boolean): AssetHint | null => {
    const editMode: EditMode = prefsRef.current.magnet !== altKey ? 'insert' : 'overwrite';
    const laneHit = laneHitAtY(clientY);
    const pointerMs = dropMsAtClientX(clientX);
    const snapped = dropAt(pointerMs);
    const preview = assetDropPreview(file, tracks, laneHit, snapped.ms, onEditOps ? editMode : undefined);
    if (!preview) return null;
    const docIndex = preview.lane != null ? tracks[preview.laneIndex]?.docIndex : undefined;
    const ghosts = new Map<string, { startMs: number; endMs: number } | null>();
    let startMs = preview.startMs;
    if (docIndex != null && !preview.error && onEditOps) {
      if (editMode === 'insert') startMs = insertPointOn(modelRef.current, docIndex, pointerMs, startMs);
      const plan = planRoom(modelRef.current, [{ track: docIndex, startMs, endMs: startMs + preview.endMs - preview.startMs }], { mode: editMode, sync: prefsRef.current.sync });
      for (const [clipId, at] of plan.placed) {
        const b = allBlocks.find((x) => x.clipId === clipId);
        if (b) ghosts.set(b.id, at ? { startMs: at.startMs, endMs: at.endMs } : null);
      }
    }
    const moved = startMs !== preview.startMs;
    return {
      ...preview,
      startMs,
      endMs: startMs + preview.endMs - preview.startMs,
      editMode,
      ghosts,
      /* the guide only when release lands right there: not for a new track, a refused spot or an insert moved to a
         cut (same rule as moving clips) */
      snapGuideMs: snapped.target && snapped.target.kind !== 'playhead' && !preview.newTrack && !preview.error && !moved
        ? snapped.target.ms
        : null,
    };
  }, [allBlocks, dropAt, dropMsAtClientX, laneHitAtY, onEditOps, tracks]);

  const onAssetDragOver = React.useCallback((e: React.DragEvent) => {
    if (!acceptAssetDrag(e)) return;
    e.preventDefault();
    /* the preview reads the file kept at dragstart: during a drag Safari often only exposes text/plain. A file from
       the computer is only a type until it is dropped: drawn by its kind, at a default length */
    const file = isComputerFileDrag(e.dataTransfer) ? computerFileDragItem(e.dataTransfer, t('timeline.dropFromComputer')) : peekResourceDrag();
    /* ⇧ over a clip: the file takes its place (onReplaceDrop), shown by a ring round it, not by a landing */
    const over = onReplaceDrop && e.shiftKey && !isComputerFileDrag(e.dataTransfer) ? clipAtPoint(e.clientX, e.clientY) : null;
    markReplaceTarget(over);
    if (over) { e.dataTransfer.dropEffect = 'copy'; setAssetHint(null); return; }
    const next = file ? assetLanding(file, e.clientX, e.clientY, e.altKey) : null;
    e.dataTransfer.dropEffect = next && !next.error ? 'copy' : 'none';
    setAssetHint((cur) => (sameAssetHint(cur, next) ? cur : next));
  }, [acceptAssetDrag, assetLanding, t, onReplaceDrop]);

  const onAssetDragLeave = React.useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setAssetHint(null);
    markReplaceTarget(null);
  }, []);

  const onAssetDrop = React.useCallback((e: React.DragEvent) => {
    if (!acceptAssetDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setAssetHint(null);
    markReplaceTarget(null);
    const replaced = onReplaceDrop && e.shiftKey && !isComputerFileDrag(e.dataTransfer) ? clipAtPoint(e.clientX, e.clientY) : null;
    const replacing = replaced ? tracks.flatMap((tr) => tr.blocks).find((b) => b.id === replaced && b.clipId) : undefined;
    const dragged = replacing ? readResourceDragData(e.dataTransfer) ?? peekResourceDrag() : null;
    if (replacing && dragged) { onReplaceDrop!(replacing, dragged); return; }
    const editMode: EditMode = prefsRef.current.magnet !== e.altKey ? 'insert' : 'overwrite';
    if (isComputerFileDrag(e.dataTransfer)) {
      const files = [...e.dataTransfer.files];
      if (!onDropFiles || !files.length) return;
      setDropBusy(true);
      setDropError(null);
      void onDropFiles(files, laneHitAtY(e.clientY), dropAt(dropMsAtClientX(e.clientX)).ms, onEditOps ? editMode : undefined).then(
        (err) => { setDropBusy(false); if (err) setDropError(err); },
        () => { setDropBusy(false); },
      );
      return;
    }
    if (!onDropAsset) return;
    const file = readResourceDragData(e.dataTransfer) ?? peekResourceDrag();
    if (!file) return;
    /* the same landing as the preview: it lands where the preview was */
    const landing = assetLanding(file, e.clientX, e.clientY, e.altKey);
    if (!landing) return;
    const spot = assetDropSpot(file, tracks, laneHitAtY(e.clientY), landing.startMs, onEditOps ? editMode : undefined);
    const target = assetDropTargetOf(spot, onEditOps ? editMode : undefined);
    setDropBusy(true);
    setDropError(null);
    void onDropAsset(file, target, landing.startMs).then(
      (err) => {
        setDropBusy(false);
        if (err) setDropError(err);
      },
      () => { setDropBusy(false); },
    );
  }, [acceptAssetDrag, assetLanding, dropAt, dropMsAtClientX, laneHitAtY, onDropAsset, onDropFiles, onEditOps, tracks, onReplaceDrop]);

  /**
   * Split clips at a time (the playhead by default), in one edit: those it is not inside, or on a locked track, are
   * left alone (the user can see where it is).
   */
  const runSplit = React.useCallback(async (blocks: readonly TimelineBlock[], atMs = timeMsRef.current) => {
    if (!onSplit || splitting) return;
    const cut = [...new Map(blocks.map((b) => [b.id, b])).values()].filter((block) => (
      !tracks.some((tr) => tr.locked && tr.blocks.some((b) => b.id === block.id))
      && atMs > block.startMs + MIN_BLOCK_MS && atMs < block.endMs - MIN_BLOCK_MS
    ));
    if (!cut.length) return;
    setSplitting(true);
    try {
      await onSplit(cut, atMs);
    } finally {
      setSplitting(false);
    }
  }, [onSplit, splitting, tracks]);

  /**
   * The tool keys: plain A / V / B switch the tool (the letters printed in the mode picker): B = "the pointer becomes a
   * blade". ⌘B, "cut here", is the editor's (see TimelineCommands.split).
   */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTypingTarget(e.target)) return;
      if ((e.target as Element | null)?.closest?.('[role="dialog"]')) return;
      if (!onSplit) return;
      if (e.altKey || e.shiftKey || e.metaKey || e.ctrlKey || e.defaultPrevented) return;
      const key = e.key.toLowerCase();
      /* A or V selects (CapCut's key, Premiere's key), B splits */
      if (key !== 'a' && key !== 'b' && key !== 'v') return;
      e.preventDefault();
      setMode(key === 'b' ? 'split' : 'select');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSplit]);

  /**
   * The context menu: on a clip, on a selection, or on empty track space. On a clip outside the selection the clip
   * is selected first — a menu acting on something other than what was right-clicked deletes the wrong thing.
   */
  const [menu, setMenu] = React.useState<
  {
    x: number; y: number; blocks: readonly TimelineBlock[]; lane: string | null; atMs: number; head?: TimelineTrack;
    /** The clip right-clicked (the selection may also hold the clips linked to it). */
    clicked?: TimelineBlock;
    /** Right-clicked in a gap on a track: it can be closed. */
    gap?: { track: number; startMs: number; endMs: number };
    /** A cut clicked or right-clicked: transitions go on it. */
    cut?: CutRef;
    /** A transition's mark right-clicked. */
    transition?: FilmTransition;
  }
  | null>(null);
  const closeMenu = React.useCallback(() => setMenu(null), []);

  const openBlockMenu = React.useCallback((e: React.MouseEvent, block: TimelineBlock) => {
    e.preventDefault();
    e.stopPropagation();
    /* right-click in the selection = the whole selection; outside it = select this clip (and its linked clips) first */
    const ids = selected.includes(block.id) ? selected : withLinked([block.id]);
    const picked = tracks.flatMap((tr) => tr.blocks).filter((b) => ids.includes(b.id));
    if (!selected.includes(block.id)) setSelected(ids);
    setMenu({ x: e.clientX, y: e.clientY, blocks: picked, lane: null, atMs: msAtClientX(e.clientX), clicked: block });
  }, [selected, tracks, setSelected, withLinked, msAtClientX]);

  const openLaneMenu = React.useCallback((e: React.MouseEvent, lane: string) => {
    e.preventDefault();
    const row = tracks.find((tr) => tr.lane === lane);
    const el = scrollRef.current;
    const exactMs = el && pxPerMs > 0 ? Math.max(0, (e.clientX - el.getBoundingClientRect().left + el.scrollLeft) / pxPerMs) : 0;
    const found = row?.docIndex != null && !row.locked ? gapAt(modelRef.current, row.docIndex, exactMs) : null;
    setMenu({
      x: e.clientX, y: e.clientY, blocks: [], lane, atMs: msAtClientX(e.clientX),
      ...(found ? { gap: { track: row!.docIndex!, ...found } } : {}),
    });
  }, [msAtClientX, tracks, pxPerMs]);

  /* a track's head: the app's entries (a reference in its chat), then the track's own (its name) */
  const headEntries = React.useCallback((track: TimelineTrack): ContextMenuEntry[] => {
    const extra = trackMenuExtra?.(track) ?? [];
    const own: ContextMenuEntry[] = onRenameTrack && track.docIndex != null ? [{
      id: 'rename-track', label: t('timeline.renameTrack'), icon: <Pencil size={14} />, onSelect: () => setRenaming(track.docIndex!),
    }] : [];
    return extra.length && own.length ? [...extra, { id: 'track-sep', separator: true }, ...own] : [...extra, ...own];
  }, [trackMenuExtra, onRenameTrack, t]);
  /* the menu of the whole track, when there is anything on it (else the browser's own) */
  const openHeadMenu = React.useCallback((e: React.MouseEvent, track: TimelineTrack) => {
    if (!headEntries(track).length) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, blocks: [], lane: track.lane, atMs: 0, head: track });
  }, [headEntries]);

  /**
   * A press on the ruler or the tracks focuses the timeline, so its keys (←/→ a frame, ⇧ a second) work after a click, not only
   * after Tab. After the press: the browser's own mousedown would move focus back to the page. Not from a text field.
   */
  const seekRef = React.useRef<HTMLDivElement | null>(null);
  const focusTimeline = React.useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || isTypingTarget(e.target)) return;
    window.setTimeout(() => {
      if (!isTypingTarget(document.activeElement)) seekRef.current?.focus({ preventScroll: true });
    }, 0);
  }, []);

  /* the keyboard can move the playhead too (this is the only progress bar): ←/→ a frame (⇧ a second), Home / End —
     the same steps as anywhere else in Studio, so a click on the ruler does not change what the arrows do */
  const onKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (!playable) return;
    /* in whole frames, so the playhead lands on a frame (see stepFrames) */
    const step = e.shiftKey ? secondFrames(fps) : 1;
    const next = e.key === 'ArrowLeft'
      ? stepFrames(timeMsRef.current, -step)
      : e.key === 'ArrowRight'
        ? Math.min(totalMs, stepFrames(timeMsRef.current, step))
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? totalMs
            : null;
    if (next == null || e.altKey || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    onSeek(next);
  }, [onSeek, playable, totalMs, fps]);

  /* zoomed in, the playhead walks out of view: follow it while playing (only then — not while the user looks
     elsewhere). With a clock, PlayheadTrack does this every frame. */
  React.useEffect(() => {
    const el = scrollRef.current;
    if (clock || !playing || !el || pxPerMs <= 0) return;
    const x = timeMs * pxPerMs;
    if (x < el.scrollLeft + FOLLOW_EDGE || x > el.scrollLeft + el.clientWidth - FOLLOW_EDGE) {
      el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
    }
  }, [clock, playing, timeMs, pxPerMs]);

  /*
   * A seek (Home / End, ↑ / ↓, the arrows, a jump to the range's ends, a click on the ruler) keeps the playhead in view
   * too: out of it, the timeline pages so the view lies ahead of it, the way it went (as playback pages). Not while
   * scrubbing (the edges scroll by themselves then), and only when the time changed, so the person can scroll away.
   */
  React.useEffect(() => {
    const el = scrollRef.current;
    if (playing || scrubMs != null || !el || !(pxPerMs > 0)) return;
    const x = timeMs * pxPerMs;
    /* past the edge only: a click near it is in view, and the view must not jump under the pointer */
    if (x > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.1);
    else if (x < el.scrollLeft) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.9);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeMs]);

  /** Reorder tracks by dragging their heads: changes film.html's order; spread rows go along. */
  const [laneOrder, setLaneOrder] = React.useState<{
    fromLane: number;
    hoverLane: number;
    fromDoc: number;
  } | null>(null);
  const startLaneReorder = React.useCallback((e: React.PointerEvent, laneIndex: number) => {
    if (e.button !== 0) return;
    /* a head pressed is the targeted track */
    if (tracks[laneIndex]?.docIndex != null) setTargetLane(tracks[laneIndex]!.lane);
    if (!onEditBlocks) return;
    const fromDoc = tracks[laneIndex]?.docIndex;
    if (fromDoc == null) return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    let dragging = false;
    let hoverLane = laneIndex;

    const move = (ev: PointerEvent): void => {
      if (!dragging) {
        if (Math.abs(ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
      }
      hoverLane = laneAtY(ev.clientY);
      setLaneOrder({ fromLane: laneIndex, hoverLane, fromDoc });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setLaneOrder(null);
      if (!dragging) return;
      let toDoc: number | undefined;
      if (hoverLane < 0) {
        toDoc = tracks.find((row) => row.docIndex != null)?.docIndex;
      } else if (hoverLane >= tracks.length) {
        toDoc = [...tracks].reverse().find((row) => row.docIndex != null)?.docIndex;
      } else {
        toDoc = tracks[hoverLane]?.docIndex;
      }
      if (toDoc == null || toDoc === fromDoc) return;
      void onEditBlocks([{
        loc: `film.html#${fromDoc}.0`,
        prop: 'trackOrder',
        value: { from: fromDoc, to: toDoc },
      }]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [onEditBlocks, tracks, laneAtY]);

  const clipThumbs = React.useMemo(
    () => indexClipThumbs(thumbs ?? new Map()) as ReadonlyMap<string, ReadonlyMap<number, string>>,
    [thumbs],
  );

  const toggleTrack = React.useCallback((track: TimelineTrack, prop: 'locked' | 'hidden' | 'muted') => {
    if (!onEditBlocks) return;
    const loc = track.blocks.find((b) => b.loc)?.loc ?? (
      track.docIndex != null ? `film.html#${track.docIndex}.0` : null
    );
    if (!loc) return;
    void onEditBlocks([{ loc, prop, value: track[prop] ? null : true }]);
  }, [onEditBlocks]);

  /* what the app's chat points at: read in the memoized rows and heads (they rebuild only when it changes) */
  const chatTrack = chat?.track ?? null;
  const chatClip = chat?.clip ?? null;
  const chatDraft = chat?.draft ?? null;
  /* read through a ref: the clips' nodes are kept between renders (clipElements) */
  const hoverBlockRef = React.useRef(onHoverBlock);
  hoverBlockRef.current = onHoverBlock;

  /* rows and clips are memoized: they change with the film, the zoom or the selection, not with every playback tick */
  const selectedLanes = React.useMemo(() => {
    const lanes = new Set<string>();
    for (const track of tracks) {
      if (track.blocks.some((b) => selected.includes(b.id))) lanes.add(track.lane);
    }
    return lanes;
  }, [tracks, selected]);

  /** The head column (outside the scroller, so drawn apart from the rows). */
  const heads = React.useMemo(() => tracks.map((track, laneIndex) => {
    const h = rowH(track);
    const liftingHead = laneOrder?.fromLane === laneIndex;
    const canReorder = Boolean(onEditBlocks && track.docIndex != null);
    const canToggle = Boolean(onEditBlocks && (track.docIndex != null || track.blocks.some((b) => b.loc)));
    const LaneIcon = track.kind === 'visual' ? Video : Waves;
    /* the name the person gave it (on its first row only: rows spread from one track share it) */
    const given = track.docIndex != null && track.index === 1 ? trackNames?.get(track.docIndex) : undefined;
    const laneTitle = given ?? track.name ?? track.kind;
    const lit = selectedLanes.has(track.lane);
    const targeted = targetLane === track.lane;
    const renamingHere = renaming != null && renaming === track.docIndex && track.index === 1;
    /* the track a pill hovered in the app's chat points at */
    const chatLit = chatTrack != null && track.docIndex === chatTrack;
    return (
      /* each head is its own block with gaps between, matching its row one to one */
      <div
        key={track.lane}
        className="relative grid w-full items-center justify-items-center rounded-l-[3px] px-0.5"
        data-lane-reorder={canReorder ? '1' : '0'}
        data-lane-target={targeted ? '1' : '0'}
        data-lane-type={track.kind}
        data-lane-on={lit ? '1' : '0'}
        data-chat-lit={chatLit ? '' : undefined}
        data-lane-hidden={track.hidden ? '1' : '0'}
        data-lane-locked={track.locked ? '1' : '0'}
        data-lane-muted={track.muted ? '1' : '0'}
        onPointerDown={(e) => startLaneReorder(e, laneIndex)}
        onDoubleClick={() => { if (onRenameTrack && track.docIndex != null && track.index === 1) setRenaming(track.docIndex); }}
        onContextMenu={(e) => openHeadMenu(e, track)}
        title={laneTitle}
        style={{
          marginTop: GAP,
          height: h,
          gridTemplateColumns: named ? `minmax(0,1fr) 24px 24px 24px${solo ? ' 24px' : ''}` : `repeat(${solo ? 5 : 4}, minmax(0, 1fr))`,
          background: laneTone(track, lit),
          /* the targeted track: an accent bar down its left edge */
          boxShadow: [chatLit ? CHAT_RING : '', targeted ? 'inset 2px 0 0 var(--tl-accent)' : ''].filter(Boolean).join(', ') || undefined,
          opacity: liftingHead ? 0.45 : 1,
          cursor: canReorder ? (liftingHead ? 'grabbing' : 'grab') : undefined,
        }}
      >
        <span className={`flex min-w-0 items-center gap-1 ${named ? 'w-full justify-self-stretch pl-0.5' : ''}`}>
          {track.badge ? (
            <span
              className="flex items-center justify-center rounded-[3px] font-semibold tabular-nums"
              style={{
                minWidth: 21,
                height: 14,
                padding: '0 3px',
                fontSize: 10,
                letterSpacing: '0.02em',
                color: '#fff',
                background: BADGE_COLOR[track.badge[0]!] ?? 'var(--tl-caption)',
                opacity: track.hidden ? 0.55 : 1,
              }}
            >
              {track.badge}
            </span>
          ) : (
            <span
              className="flex items-center justify-center"
              style={{ width: TYPE_BOX, height: TYPE_BOX, color: 'var(--text-faint)' }}
            >
              <LaneIcon size={TYPE_BOX} />
            </span>
          )}
          {renamingHere ? (
            <input
              autoFocus
              defaultValue={given ?? ''}
              aria-label={t('timeline.renameTrack')}
              placeholder={track.badge ?? ''}
              maxLength={40}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') { onRenameTrack?.(track.docIndex!, e.currentTarget.value); setRenaming(null); }
                if (e.key === 'Escape') setRenaming(null);
              }}
              onBlur={(e) => { if (renamingRef.current === track.docIndex) { onRenameTrack?.(track.docIndex!, e.currentTarget.value); setRenaming(null); } }}
              className="h-[18px] min-w-0 flex-1 rounded-[3px] bg-[var(--bg)] px-1 text-[11px] text-[var(--text)] outline-none ring-1 ring-[var(--tl-accent)]"
            />
          ) : given ? (
            <span className="min-w-0 truncate text-[11px] font-medium" style={{ color: TL.text }} data-track-name="">{given}</span>
          ) : null}
        </span>
        {onEditBlocks ? <>
        <TrackHeadButton
          label={track.locked ? t('timeline.unlockTrack') : t('timeline.lockTrack')}
          active={Boolean(track.locked)}
          disabled={!canToggle}
          onToggle={() => toggleTrack(track, 'locked')}
        >
          {track.locked ? <Lock size={HEAD_ICON_H} /> : <LockOpen size={HEAD_ICON_H} />}
        </TrackHeadButton>
        <TrackHeadButton
          label={track.hidden ? t('timeline.showTrack') : t('timeline.hideTrack')}
          active={Boolean(track.hidden)}
          disabled={!canToggle}
          onToggle={() => toggleTrack(track, 'hidden')}
        >
          {track.hidden ? <EyeOff size={HEAD_ICON_H} /> : <Eye size={HEAD_ICON_H} />}
        </TrackHeadButton>
        {/* a track of pages has no sound to mute (its place is kept, so the heads line up) */}
        {track.role === 'mg' ? <span aria-hidden /> : <TrackHeadButton
          /* "original sound" is footage's own; a sound track is just muted */
          label={track.role === 'video'
            ? t(track.muted ? 'timeline.unmuteTrack' : 'timeline.muteTrack')
            : t(track.muted ? 'timeline.unmuteSoundTrack' : 'timeline.muteSoundTrack')}
          active={Boolean(track.muted)}
          disabled={!canToggle}
          onToggle={() => toggleTrack(track, 'muted')}
        >
          {track.muted ? <VolumeX size={HEAD_ICON_H} /> : <Volume2 size={HEAD_ICON_H} />}
        </TrackHeadButton>}
        </> : null}
        {/* solo: Studio's playback only; a track of pages has no sound (its place is kept) */}
        {solo ? (track.role === 'mg' || track.docIndex == null ? <span aria-hidden /> : (
          <SoloButton on={solo.tracks.has(track.docIndex)} onToggle={(only) => solo.onToggle(track.docIndex!, only)} />
        )) : null}
        {onResizeTrack && track.docIndex != null ? <TrackResizeHandle height={h} onResize={(height, done) => onResizeTrack(track, height, done)} /> : null}
      </div>
    );
  }), [tracks, t, laneOrder, onEditBlocks, startLaneReorder, toggleTrack, selectedLanes, openHeadMenu, chatTrack, trackNames, targetLane, renaming, named, onRenameTrack, solo, onResizeTrack]);

  /* row backgrounds are fixed to the view and only follow vertical scroll; the clips move horizontally above them */
  const laneSkins = React.useMemo(() => tracks.map((track) => (
    <div
      key={track.lane}
      style={{
        marginTop: GAP,
        height: rowH(track),
        background: laneTone(track, selectedLanes.has(track.lane)),
      }}
    />
  )), [tracks, selectedLanes]);

  /* thumbnails only within a screen either side of the view (BlockThumbs visiblePx), rounded to whole screens so the
     window changes, and clips rebuild, only every screen of scrolling */
  const screenPx = Math.max(1, view.width);
  const screenIndex = Math.floor(view.left / screenPx);
  const thumbWindow = React.useMemo(
    () => ({ from: (screenIndex - 1) * screenPx, to: (screenIndex + 2) * screenPx }),
    [screenIndex, screenPx],
  );
  // Reuse untouched clip elements while dragging. A pointer frame should update
  // the moved clips and landing guides, not every thumbnail and waveform.
  /* selection, marquee and the thumbnail window are not dependencies: they change how a few clips look, and those
     clips' pose changes with them (see `pose`); handlers read the selection from a ref */
  /** A press on a clip's edge or on a cut selects the clip (with its linked clips; ⌥ alone) unless it is selected. */
  const pickForTrim = React.useCallback((e: React.PointerEvent, block: TimelineBlock) => {
    if (e.button !== 0 || selectedRef.current.includes(block.id)) return;
    setSelected(withLinked([block.id], e.altKey));
  }, [setSelected, withLinked]);
  /* ── fades: each clip's ramp, and the handles at its top corners that set it (lib/clip-fade) ── */
  const fadesRef = React.useRef(fades);
  fadesRef.current = fades;
  /** A fade handle in hand: the clips it sets (with those linked at the same edge), which edge, how long, whose. */
  const [fadeDrag, setFadeDrag] = React.useState<{ ids: readonly string[]; block: string; edge: FadeEdge; ms: number } | null>(null);
  /** A clip's fades as drawn: its own, or the one in hand. */
  const fadeOfBlock = React.useCallback((b: TimelineBlock): FadeMs => {
    const own = (b.clipId ? fades?.get(b.clipId) : undefined) ?? [0, 0];
    if (!fadeDrag || !fadeDrag.ids.includes(b.id)) return own;
    const len = b.endMs - b.startMs;
    return fadeDrag.edge === 'in' ? [Math.min(fadeDrag.ms, len - own[1]), own[1]] : [own[0], Math.min(fadeDrag.ms, len - own[0])];
  }, [fades, fadeDrag]);
  /**
   * A fade handle pressed: dragged inward the fade gets longer, on the frame grid, never past the other fade; on release
   * it is written for the clip and the clips linked to it whose same edge is there (⌥: it alone), in one step.
   */
  const startFade = React.useCallback((e: React.PointerEvent, block: TimelineBlock, edge: FadeEdge) => {
    e.stopPropagation();
    if (e.button !== 0 || !onEditOps || !block.clipId) return;
    e.preventDefault();
    pickForTrim(e, block);
    const blocks = tracks.flatMap((tr) => tr.blocks);
    const locked = new Set(tracks.filter((tr) => tr.locked).flatMap((tr) => tr.blocks.map((b) => b.id)));
    const at = (b: TimelineBlock) => (edge === 'in' ? b.startMs : b.endMs);
    const going = withLinked([block.id], e.altKey)
      .map((id) => blocks.find((b) => b.id === id))
      .filter((b): b is TimelineBlock => Boolean(b?.clipId && !locked.has(b.id) && Math.abs(at(b) - at(block)) <= 1));
    const fadeOf = (b: TimelineBlock): FadeMs => fadesRef.current?.get(b.clipId!) ?? [0, 0];
    const own = fadeOf(block);
    const other = edge === 'in' ? own[1] : own[0];
    const frame = frameMs(1, fps);
    let ms = edge === 'in' ? own[0] : own[1];
    const ids = going.map((b) => b.id);
    setFadeDrag({ ids, block: block.id, edge, ms });
    const move = (ev: PointerEvent) => {
      ms = fadeFromPointer(edge, dropMsAtClientX(ev.clientX), block, other, frame);
      setFadeDrag({ ids, block: block.id, edge, ms });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setFadeDrag(null);
      const asClip = (b: TimelineBlock) => ({ id: b.clipId!, startMs: b.startMs, endMs: b.endMs, fade: fadeOf(b) });
      const edits = fadeEdits(edge, ms, asClip(block), going.filter((b) => b.id !== block.id).map(asClip));
      if (edits.length) void onEditOps([{ op: 'props', edits }], 'history.stepFade').then((err) => { if (err) setDropError(err); });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, [onEditOps, pickForTrim, tracks, withLinked, fps, dropMsAtClientX]);

  /* ── transitions: a mark over each, picked, resized by its edges, deleted (lib/transitions) ── */
  /** A transition's edge in hand: how long it is now. */
  const [transitionDrag, setTransitionDrag] = React.useState<{ key: string; durationMs: number } | null>(null);
  const startTransitionResize = React.useCallback((e: React.PointerEvent, tr: FilmTransition, side: 'start' | 'end') => {
    e.stopPropagation();
    if (e.button !== 0 || !onTransition) return;
    e.preventDefault();
    onPickTransition?.(tr.key);
    const frame = frameMs(1, fps);
    const was = tr.endMs - tr.startMs;
    let durationMs = was;
    const dip = tr.kind === 'dip-black' || tr.kind === 'dip-white';
    const move = (ev: PointerEvent) => {
      const p = dropMsAtClientX(ev.clientX);
      const raw = dip ? 2 * Math.abs(p - tr.cutMs) : side === 'start' ? tr.endMs - p : p - tr.startMs;
      durationMs = Math.max(frame, Math.round(raw / frame) * frame);
      setTransitionDrag({ key: tr.key, durationMs });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setTransitionDrag(null);
      if (Math.abs(durationMs - was) >= 1) void onTransition({ kind: 'resize', key: tr.key, durationMs }).then((err) => { if (err) setDropError(err); });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, [onTransition, onPickTransition, fps, dropMsAtClientX]);
  /** A press on a cut that comes up where it went down: the cut's menu (its transitions), at the pointer. */
  const openCutIfClick = React.useCallback((e: React.PointerEvent, cut: CutRef) => {
    const fromX = e.clientX, fromY = e.clientY;
    const lane = tracks.find((tr) => tr.blocks.some((b) => b.clipId === cut.a))?.lane ?? null;
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointerup', up);
      if (Math.abs(ev.clientX - fromX) >= DRAG_THRESHOLD_PX || Math.abs(ev.clientY - fromY) >= DRAG_THRESHOLD_PX) return;
      setMenu({ x: ev.clientX, y: ev.clientY, blocks: [], lane, atMs: 0, cut });
    };
    window.addEventListener('pointerup', up);
  }, [tracks]);

  /** Where a clip is drawn while a gesture or a drop changes it (null: where it is). */
  const placedOf = React.useCallback((id: string): { startMs: number; endMs: number; gone?: boolean } | null => {
    const live = drag.placedOf(id);
    if (live) return live;
    if (!assetHint?.ghosts.has(id)) return null;
    return assetHint.ghosts.get(id) ?? { startMs: 0, endMs: 0, gone: true };
  }, [drag.placedOf, assetHint]);
  const clipElements = React.useMemo(() => new Map<string, { pose: string; node: React.ReactElement }>(), [
    tracks, pxPerMs, waveUrl, mode, msAtClientX, onSplit,
    clipThumbs, posters, mediaTrouble, t, openBlockMenu, onEditBlocks, collapseIfClick, selectOne, setSelected,
    drag.start, drag.can, withLinked, runSplit, pickForTrim, startFade, onEditOps,
  ]);
  const rows = React.useMemo(() => {
    /* the clips in hand — the dragged one and the selection moving with it — all float */
    const liftingIds = drag.preview
      ? new Set([drag.preview.id, ...drag.preview.moves.map((m) => m.id)])
      : null;
    return tracks.map((track) => {
    const h = rowH(track);
    const liftingHere = Boolean(liftingIds && track.blocks.some((b) => liftingIds.has(b.id)));
    /* the edges another clip touches (`<id>:start` / `<id>:end`): their handles stay inside the clip */
    const touching = new Set(cutsOf(track.blocks).flatMap(([a, b]) => [`${a.id}:end`, `${b.id}:start`]));
    return (
      <div
        key={track.lane}
        className="relative"
        style={{
          marginTop: GAP,
          width: '100%',
          height: h,
          /* no background here: it would scroll with the content (see laneSkins) */
          filter: track.hidden ? 'grayscale(1)' : undefined,
          /* the row with a lifted clip goes on top, or the rows below would cover the floating clip */
          zIndex: liftingHere ? 50 : undefined,
        }}
        /* right-click on empty space: the track menu at this time (clips stop their own right-clicks) */
        onContextMenu={(e) => openLaneMenu(e, track.lane)}
      >
          {track.blocks.map((block) => {
            /* while dragging, drawn where the preview says (film.html only updates after the write); a clip the edit
               takes out is drawn faint where it is */
            const placed = placedOf(block.id);
            const gone = Boolean(placed?.gone);
            const live = placed && !gone ? placed : null;
            const startMs = live?.startMs ?? block.startMs;
            const endMs = live?.endMs ?? block.endMs;
            const lifting = Boolean(liftingIds?.has(block.id));
            const floating = lifting && drag.preview?.mode === 'move';
            const picked = ringed.includes(block.id);
            /* the thumbnail window, cut to this clip: clips outside it get the same numbers and do not rebuild */
            const blockLeft = startMs * pxPerMs;
            const blockW = (endMs - startMs) * pxPerMs;
            const winFrom = Math.max(0, Math.min(blockW, thumbWindow.from - blockLeft));
            const winTo = Math.max(0, Math.min(blockW, thumbWindow.to - blockLeft));
            /* clips more than a screen out of view are not drawn, except those in hand, moving or selected */
            if (view.width > 0 && (blockLeft + blockW < thumbWindow.from || blockLeft > thumbWindow.to) && !lifting && !live && !picked) {
              return null;
            }
            /* `length`: the clip has no length (see TimelineBlock.noLength), and the film cannot be drawn until it has */
            const trouble = block.noLength ? 'length' : block.src ? mediaTrouble?.get(block.src) : undefined;
            /* the app's chat: the clip of the pill hovered there, and this clip's numbers in the message being written */
            const key = { clipId: block.clipId, loc: block.loc };
            const chatLit = Boolean(chatClip && sameClip(chatClip, key));
            const chatNumbers = chatDraft ? draftNumbersOf(chatDraft, key) : [];
            /* its fades: as written, or as the handle in hand has them */
            const fade = fadeOfBlock(block);
            const fadeTip = fadeDrag?.block === block.id ? fadeDrag.edge : '';
            const pose = `${startMs}:${endMs}:${!!live}:${gone}:${lifting}:${floating ? drag.preview?.offsetY : ''}:${picked}:${Math.round(winFrom)}-${Math.round(winTo)}:${trouble ?? ''}:${chatLit}:${chatNumbers.join(',')}:${fade[0]}-${fade[1]}:${fadeTip}`;
            const cached = clipElements.get(block.id);
            if (cached?.pose === pose) return cached.node;
            /* on whole pixels: a fractional left and width blur the edges, and a cut between two clips is the key
               information. 1 px narrower: clips end to end must read as two; the gap is on the right so the start
               still lines up with the ruler */
            const left = Math.round(startMs * pxPerMs);
            const width = Math.max(2, Math.round(endMs * pxPerMs) - left - 1);
            const color = KIND_COLOR[block.kind];
            const able = drag.can(block);
            const strip = clipThumbs.get(clipThumbId(block));
            const poster = block.src ? posters?.[block.src] : undefined;
            const trimFromMs = block.inMs ?? Math.round((block.anchor?.trimFrom ?? 0) * 1000);
            /* thumbnails are keyed by the source's ms: a sped-up clip covers `speed` times as much source as film */
            const thumbSpeed = block.speed && block.speed > 0 ? block.speed : 1;
            const intoOrigin = thumbIntoOrigin({
              committedStart: block.startMs,
              committedEnd: block.endMs,
              visualStart: startMs,
              visualEnd: endMs,
              trimFromMs,
              speed: thumbSpeed,
            });
            /* a video has three bands (info / preview / its sound); a page or a still two (info / preview), a sound two
               (info / waveform) */
            const visual = block.kind === 'mg' || block.kind === 'video';
            const soundBand = block.kind === 'video' && !(block.src && filmSrcIsStill(block.src));
            const previewH = Math.max(6, h - INFO_H - (soundBand ? AUDIO_BAND_H : 0));
            const bandAudio = visual && !!block.ownAudio && !block.silent;
            const node = (
              <div
                key={block.id}
                /* data-* for automated UI checks: where a clip is drawn, whether a drag moved it */
                data-block-id={block.id}
                data-block-kind={block.kind}
                data-block-title={block.title}
                data-can-move={able.move ? '1' : '0'}
                data-can-resize={able.resize ? '1' : '0'}
                data-media-trouble={trouble}
                data-chat-lit={chatLit ? '' : undefined}
                /* overflow is clipped on the inner box: the selection frame is drawn outside */
                className={`group/block absolute inset-y-0 ${
                  lifting ? 'z-[12]' : picked || chatLit ? 'z-10' : live ? 'z-10' : ''
                }`}
                style={{
                  left,
                  width,
                  opacity: gone ? 0.25 : block.off ? 0.4 : floating ? 0.72 : 1,
                  /* follows the pointer up and down: a lifted clip really leaves its row */
                  transform: floating
                    ? `translateY(${drag.preview?.offsetY ?? 0}px)`
                    : undefined,
                  /* always a pointer (a grab hand would promise a drag some clips cannot do); empty in split mode, where
                     .tl-blade on the scroller sets the blade and an inline cursor would override it */
                  cursor: mode === 'split' ? undefined : floating ? 'grabbing' : 'pointer',
                }}
                title={trouble ? `${blockTitleOf(block)}\n${t(trouble === 'length' ? 'timeline.noLengthHint' : trouble === 'missing' ? 'timeline.mediaMissingHint' : trouble === 'decode' ? 'timeline.mediaCannotPlay' : 'timeline.mediaReconnecting')}` : blockTitleOf(block)}
                onPointerDown={(e) => {
                  /* a click selects and does not move the playhead (only empty space seeks); stop it reaching the
                     empty-space handler, which would seek and clear the selection */
                  e.stopPropagation();
                  /* a right press does not change the selection (it comes before contextmenu; see openBlockMenu) */
                  if (e.button !== 0) return;
                  /* the clip's track is the targeted one */
                  if (track.docIndex != null) setTargetLane(track.lane);
                  const current = selectedRef.current;
                  const inGroup = current.includes(block.id);
                  /* the clip with the clips linked to it (⌥: it alone) */
                  const own = withLinked([block.id], e.altKey);
                  /* ⌘/Ctrl click toggles the clip (no drag); ⇧ click adds it and can drag the group */
                  if ((e.metaKey || e.ctrlKey) && mode !== 'split') {
                    e.preventDefault();
                    setSelected(inGroup ? current.filter((id) => !own.includes(id)) : [...new Set([...current, ...own])]);
                    return;
                  }
                  if (e.shiftKey && !e.altKey && !inGroup && mode !== 'split') {
                    const next = [...new Set([...current, ...own])];
                    setSelected(next);
                    if (able.move) drag.start(e, block, 'move', next);
                    return;
                  }
                  /* split mode: cut where clicked (the clips linked to it too), no need to move the playhead first */
                  if (mode === 'split') {
                    if (!inGroup) setSelected(own);
                    if (track.locked) return;
                    const cut = new Set(own);
                    void runSplit(tracks.flatMap((tr) => tr.blocks).filter((b) => cut.has(b.id)), msAtClientX(e.clientX));
                    return;
                  }
                  /* ⌥-drag slips the content inside the clip, ⌥⇧-drag slides the clip between its neighbors; a ⌥-click
                     picks this clip alone */
                  if (e.altKey) {
                    if (!inGroup) setSelected(withLinked([block.id]));
                    collapseIfClick(e, block.id, true);
                    if (e.shiftKey ? able.move : able.resize) drag.start(e, block, e.shiftKey ? 'slide' : 'slip');
                    return;
                  }
                  if (!inGroup) setSelected(own);
                  /* in a group: select it alone or drag the group — known on release */
                  if (inGroup) collapseIfClick(e, block.id);
                  /* the 5 px threshold is in the drag, so click and drag are one gesture; the group is taken as selected
                     at this moment */
                  if (able.move) drag.start(e, block, 'move', inGroup ? current : own);
                }}
                onContextMenu={(e) => openBlockMenu(e, block)}
                onPointerEnter={() => hoverBlockRef.current?.(block)}
                onPointerLeave={() => hoverBlockRef.current?.(null)}
              >
                <div
                  className="absolute inset-0 overflow-hidden rounded-[3px]"
                  style={{
                    background: color,
                    boxShadow: floating
                      ? '0 8px 18px rgba(0,0,0,0.32)'
                      : chatLit
                        ? CHAT_RING
                        : live
                          ? '0 2px 8px rgba(0,0,0,0.18)'
                          : undefined,
                  }}
                >
                {/* info strip: name and length side by side (one statement), not at opposite ends of a wide clip */}
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 flex items-center overflow-hidden px-1.5"
                  style={{ height: INFO_H, background: 'rgba(0,0,0,0.3)' }}
                >
                  {/* pinned to the left of the view so a clip wider than the screen still says what it is; the scroll
                      position comes from a CSS variable (set in onScroll), not React, so scrolling rebuilds nothing */}
                  <span
                    className="flex min-w-0 items-center gap-1"
                    style={{
                      transform: `translateX(clamp(0px, calc(var(--tl-scroll-left, 0px) - ${left}px), ${width - 48}px))`,
                    }}
                  >
                    {/* a voice says so before its name: it is what the subtitles are made from */}
                    {block.kind === 'voice' ? <Mic className="h-2.5 w-2.5 shrink-0 text-white/90" aria-hidden /> : null}
                    <span className="min-w-0 truncate text-[10px] font-medium leading-none text-white/95">
                      {block.title}
                    </span>
                    {width > 64 ? (
                      <span className="shrink-0 text-[10px] leading-none tabular-nums text-white/70">
                        {block.noLength ? t('timeline.noLength') : `${((endMs - startMs) / 1000).toFixed(1)}s`}
                      </span>
                    ) : null}
                  </span>
                </div>
                {/* the file is not in the project any more: say so where the picture would be (an editor's "media offline") */}
                {trouble === 'missing' ? (
                  <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] flex items-center justify-center overflow-hidden bg-[#4a0d0d]" style={{ top: INFO_H }}>
                    {width > 64 ? <span className="truncate px-1 text-[11px] font-medium text-white/90">{t('timeline.mediaMissing')}</span> : null}
                  </span>
                ) : null}
                {/* preview band: thumbnails by the clip's own time (a move keeps them, a left trim seeks deeper).
                    Before thumbnails exist, one poster at the left — tiling it would fake a filmstrip. */}
                {strip?.size && visual && width > 8 ? (
                  <BlockThumbs
                    thumbs={strip}
                    startMs={intoOrigin}
                    endMs={intoOrigin + (endMs - startMs) * thumbSpeed}
                    pxPerMs={pxPerMs / thumbSpeed}
                    topOffset={INFO_H}
                    height={previewH}
                    thumbWidthPx={THUMB_CELL_PX}
                    visiblePx={{ from: thumbWindow.from - left, to: thumbWindow.to - left }}
                  />
                ) : poster && visual && width > 8 ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-0 opacity-90"
                    style={{
                      top: INFO_H,
                      height: previewH,
                      width: Math.min(THUMB_CELL_PX, width),
                      backgroundImage: `url(${JSON.stringify(poster)})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      backgroundRepeat: 'no-repeat',
                    }}
                  />
                ) : null}
                {/* audio band: a video's own sound, or an empty band so preview bands line up */}
                {soundBand ? (
                  <span
                    aria-hidden={!bandAudio}
                    data-audio-band={bandAudio ? 'on' : 'off'}
                    className="absolute inset-x-0 bottom-0"
                    style={{
                      height: AUDIO_BAND_H,
                      background: 'rgba(0,0,0,0.3)',
                    }}
                  >
                    {bandAudio && waveUrl && block.src && width > 8 ? (
                      <BlockWaveform
                        url={waveUrl(block.src)}
                        width={width}
                        height={AUDIO_BAND_H - 2}
                        color="var(--tl-wave-band)"
                        visiblePx={{ from: winFrom, to: winTo }}
                        /* the source span under this block: film length × the clip's speed */
                        inMs={(block.inMs ?? 0)
                          + (endMs === block.endMs ? (startMs - block.startMs) * (block.speed ?? 1) : 0)}
                        durMs={(endMs - startMs) * (block.speed ?? 1)}
                      />
                    ) : null}
                  </span>
                ) : null}
                {/* word cues (voice): to see whether a cut lands mid-word. Not snap targets (see snapTargetsFor);
                    not drawn when too dense. */}
                {block.cues?.length && width > 40 ? (
                  <span className="pointer-events-none absolute inset-x-0" style={{ top: INFO_H, bottom: 0 }}>
                    {cueTicks(block.cues, pxPerMs).map((c) => (
                      <span
                        key={c.tMs}
                        className="absolute top-0 bottom-0 w-px"
                        style={{ left: c.tMs * pxPerMs, background: 'rgba(255,255,255,0.45)' }}
                        title={c.word}
                      />
                    ))}
                  </span>
                ) : null}
                {/* sound clips' waveform (picture clips draw their sound in the audio band). In point and length
                    follow the preview, so a left trim moves the in point; a move does not. */}
                {!visual && waveUrl && block.src && width > 8 ? (
                  <BlockWaveform
                    url={waveUrl(block.src)}
                    width={width}
                    height={Math.max(6, h - INFO_H - 2)}
                    color="var(--tl-wave)"
                    visiblePx={{ from: winFrom, to: winTo }}
                    inMs={(block.inMs ?? 0)
                      + (endMs === block.endMs ? (startMs - block.startMs) * (block.speed ?? 1) : 0)}
                    durMs={(endMs - startMs) * (block.speed ?? 1)}
                  />
                ) : null}
                {/* its fades: the part faded shaded, a line where it ramps (picture and sound alike) */}
                {fade[0] > 0 || fade[1] > 0 ? (
                  <svg aria-hidden data-fade-ramp={`${fade[0]}-${fade[1]}`} className="pointer-events-none absolute inset-0 z-[1]" width={width} height={h}>
                    {fade[0] > 0 ? (() => {
                      const x = Math.min(width, fade[0] * pxPerMs);
                      return <><polygon points={`0,0 ${x},0 0,${h}`} fill="rgba(0,0,0,0.4)" /><line x1={0} y1={h} x2={x} y2={0} stroke="rgba(255,255,255,0.9)" strokeWidth={1.25} /></>;
                    })() : null}
                    {fade[1] > 0 ? (() => {
                      const x = Math.max(0, width - fade[1] * pxPerMs);
                      return <><polygon points={`${x},0 ${width},0 ${width},${h}`} fill="rgba(0,0,0,0.4)" /><line x1={x} y1={0} x2={width} y2={h} stroke="rgba(255,255,255,0.9)" strokeWidth={1.25} /></>;
                    })() : null}
                  </svg>
                ) : null}
                </div>
                {/* frame and handles stay while trimming (the hand is on one of them); hidden while the clip floats */}
                {picked && !floating ? <SelectFrame /> : null}
                {chatNumbers.length ? <ChatNumbers numbers={chatNumbers} /> : null}
                {/* handles on clips down to 6 px wide (short sounds zoomed out are often a dozen pixels), each never more
                    than a quarter of the clip: the middle half always takes the press that selects or moves it. Pressing
                    one selects the clip too (⌥: alone, and trims it alone) */}
                {able.resize && width > 6 && !floating ? (
                  <>
                    {able.move ? (
                      <TrimHandle
                        edge="start"
                        picked={picked && !touching.has(`${block.id}:start`)}
                        hit={trimHit(width)}
                        onDown={(e) => { e.stopPropagation(); pickForTrim(e, block); drag.start(e, block, 'trim-start'); }}
                      />
                    ) : null}
                    <TrimHandle
                      edge="end"
                      picked={picked && !touching.has(`${block.id}:end`)}
                      hit={trimHit(width)}
                      onDown={(e) => { e.stopPropagation(); pickForTrim(e, block); drag.start(e, block, 'trim-end'); }}
                    />
                  </>
                ) : null}
                {/* fade handles at the top corners: dragged inward, the clip fades in or out (lib/clip-fade) */}
                {onEditOps && block.clipId && !track.locked && width > 18 && !floating && mode === 'select' ? (['in', 'out'] as const).map((edge) => {
                  const ms = edge === 'in' ? fade[0] : fade[1];
                  const x = Math.max(5, Math.min(width - 5, fadeHandleX(edge, ms, width, pxPerMs)));
                  const what = t(edge === 'in' ? 'inspector.fadeIn' : 'inspector.fadeOut');
                  return (
                    <span key={edge} role="presentation" data-fade-handle={edge}
                      title={t('transitions.handle').replace('{what}', what).replace('{s}', (ms / 1000).toFixed(2))}
                      className={`absolute top-[1px] z-[5] h-[9px] w-[9px] -translate-x-1/2 cursor-ew-resize rounded-full border border-black/50 bg-white shadow-[0_0_2px_rgba(0,0,0,.4)] transition-opacity ${ms > 0 || picked || fadeTip === edge ? 'opacity-100' : 'opacity-0 group-hover/block:opacity-100'}`}
                      style={{ left: x }}
                      onPointerDown={(e) => startFade(e, block, edge)}
                    >
                      {fadeTip === edge ? (
                        <span className="pointer-events-none absolute left-1/2 top-[12px] -translate-x-1/2 whitespace-nowrap rounded-[4px] px-1.5 py-[1px] text-[10.5px] font-medium leading-[15px] text-white tabular-nums shadow-[0_1px_4px_rgba(0,0,0,.35)]"
                          style={{ background: 'var(--tl-accent)' }}>
                          {t('transitions.fadeTip').replace('{what}', what).replace('{s}', (ms / 1000).toFixed(2))}
                        </span>
                      ) : null}
                    </span>
                  );
                }) : null}
              </div>
            );
            clipElements.set(block.id, { pose, node });
            return node;
          })}
        {/* the cuts between clips that touch: dragged, a roll (one gets longer, the other shorter); not while a move
            is in hand, and not on a locked track */}
        {!track.locked && mode === 'select' && !(drag.preview?.mode === 'move' && !drag.preview.landed) ? cutsOf(track.blocks).map(([a, b]) => {
          const pa = placedOf(a.id);
          const pb = placedOf(b.id);
          if (pa?.gone || pb?.gone || !drag.can(a).resize || !drag.can(b).resize) return null;
          const atMs = pb?.startMs ?? b.startMs;
          const w = rollHit(Math.min(((pa?.endMs ?? a.endMs) - (pa?.startMs ?? a.startMs)) * pxPerMs, ((pb?.endMs ?? b.endMs) - atMs) * pxPerMs));
          return (
            <span
              key={`roll:${a.id}:${b.id}`}
              role="presentation"
              data-roll={`${a.clipId ?? a.id}|${b.clipId ?? b.id}`}
              title={t('timeline.rollHint')}
              className="group/roll absolute inset-y-0 z-[11] cursor-col-resize"
              style={{ left: Math.round(atMs * pxPerMs) - w / 2, width: w }}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (e.button !== 0) return;
                /* a drag rolls the cut (and selects the clip before it then); a click is the cut's alone: its
                   transitions (lib/transitions) */
                drag.start(e, a, 'roll', undefined, b, () => pickForTrim(e, a));
                if (onTransition && a.clipId && b.clipId) openCutIfClick(e, { a: a.clipId, b: b.clipId });
              }}
              onContextMenu={(e) => {
                if (!onTransition || !a.clipId || !b.clipId) return;
                e.preventDefault();
                e.stopPropagation();
                setMenu({ x: e.clientX, y: e.clientY, blocks: [], lane: track.lane, atMs: atMs, cut: { a: a.clipId, b: b.clipId } });
              }}
            >
              <span aria-hidden className="pointer-events-none absolute inset-y-[2px] left-1/2 w-[2px] -translate-x-1/2 rounded-full bg-[var(--tl-select)] opacity-0 transition-opacity group-hover/roll:opacity-90" />
            </span>
          );
        }) : null}
        {/* the transitions drawn on this row: a mark over each, picked by a click, resized by its edges */}
        {(transitions ?? []).filter((tr) => track.blocks.some((b) => b.clipId === tr.on)).map((tr) => {
          const span = transitionDrag?.key === tr.key ? transitionSpan(tr, transitionDrag.durationMs) : tr;
          const x = Math.round(span.startMs * pxPerMs);
          const w = Math.max(10, Math.round(span.endMs * pxPerMs) - x);
          const on = pickedTransition === tr.key;
          const len = ((span.endMs - span.startMs) / 1000).toFixed(2);
          const top = Math.max(INFO_H + 1, Math.round(h / 2) - 8);
          return (
            <div key={`tr:${tr.key}`} role="button" tabIndex={-1} data-transition={tr.kind} data-transition-picked={on ? '1' : '0'}
              title={t('transitions.mark').replace('{kind}', t(`transitions.${tr.kind}`)).replace('{s}', len)}
              className="absolute z-[13] flex items-center justify-center overflow-hidden rounded-[4px] text-[10px] font-medium leading-none"
              style={{
                left: x, width: w, top, height: 16,
                background: on ? 'var(--tl-select)' : 'rgba(255,255,255,0.88)',
                color: on ? '#fff' : '#1b1e25',
                boxShadow: on ? '0 0 0 1px rgba(255,255,255,.9), 0 1px 4px rgba(0,0,0,.35)' : '0 1px 3px rgba(0,0,0,.35)',
                cursor: 'pointer',
              }}
              onPointerDown={(e) => { e.stopPropagation(); if (e.button !== 0) return; setSelected([]); onPickTransition?.(tr.key); }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onPickTransition?.(tr.key);
                setMenu({ x: e.clientX, y: e.clientY, blocks: [], lane: track.lane, atMs: tr.cutMs, transition: tr });
              }}
            >
              {/* the two ramps crossing */}
              <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 16" preserveAspectRatio="none">
                <path d="M0 15 L100 1" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.2" vectorEffect="non-scaling-stroke" fill="none" />
                <path d="M0 1 L100 15" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.2" vectorEffect="non-scaling-stroke" fill="none" />
              </svg>
              {w > 70 ? <span className="relative truncate px-1.5">{t(`transitions.${tr.kind}`)}</span> : null}
              {!track.locked && onTransition ? (['start', 'end'] as const).map((side) => (
                <span key={side} role="presentation" data-transition-edge={side}
                  className="absolute inset-y-0 w-[6px] cursor-ew-resize"
                  style={side === 'start' ? { left: 0 } : { right: 0 }}
                  onPointerDown={(e) => startTransitionResize(e, tr, side)} />
              )) : null}
            </div>
          );
        })}
        {/* the gap picked on this track (on its first row): ⌫ closes it */}
        {gap && track.docIndex === gap.track && track.index === 1 ? (
          <div
            data-gap=""
            className="pointer-events-none absolute inset-y-[2px] z-[3] rounded-[3px] border border-dashed"
            style={{
              left: Math.round(gap.startMs * pxPerMs),
              width: Math.max(2, Math.round(gap.endMs * pxPerMs) - Math.round(gap.startMs * pxPerMs) - 1),
              borderColor: 'var(--tl-select)',
              background: 'color-mix(in srgb, var(--tl-select) 16%, transparent)',
            }}
          />
        ) : null}
        {trackOverlay?.(track, pxPerMs)}
        {track.locked ? (
          <div
            className="pointer-events-none absolute inset-0 z-[20]"
            style={{
              backgroundImage:
                'repeating-linear-gradient(-45deg, transparent, transparent 5px, color-mix(in srgb, var(--tl-accent) 16%, transparent) 5px, color-mix(in srgb, var(--tl-accent) 16%, transparent) 10px)',
            }}
          />
        ) : null}
      </div>
    );
    });
  }, [
    tracks, trackPx, pxPerMs, ringed, selected, drag, waveUrl, mode, msAtClientX, onSplit, clipThumbs, posters, mediaTrouble, t,
    openBlockMenu, openLaneMenu, onEditBlocks, collapseIfClick, selectOne, setSelected, clipElements, thumbWindow, view.width,
    chatClip, chatDraft, placedOf, pickForTrim, gap, withLinked, runSplit, trackOverlay,
    fadeOfBlock, fadeDrag, startFade, transitions, transitionDrag, pickedTransition, onPickTransition, onTransition, startTransitionResize, openCutIfClick,
  ]);

  const tickMarks = React.useMemo(() => ticks.map(({ ms, label }) => {
    return (
      <span
        key={ms}
        className={`absolute bottom-0 select-none border-l tabular-nums ${
          label ? 'top-0 pl-1 text-[10px] leading-[14px]' : 'top-[9px]'
        }`}
        style={{
          left: ms * pxPerMs,
          borderColor: label ? TL.line : TL.tick,
          /* labels are read to find a place: 82% of the text color, not the faintest tone */
          color: label ? 'color-mix(in srgb, var(--tl-text) 82%, transparent)' : undefined,
        }}
      >
        {label ? formatRulerLabel(ms, fps) : null}
      </span>
    );
  }), [ticks, pxPerMs, fps]);

  const playheadX = (scrubMs ?? timeMs) * pxPerMs;
  const shownRange = rangeDraft ?? range ?? null;
  /* the playhead is drawn on the outer layer (ruler top to bottom), so it takes off the scroll itself */
  const scrollLeft = view.left;

  /**
   * What release will look like — for a media-pane drop and for moving clips (the floating clip is not the landing).
   *   · `slot`: a see-through slot on the target row — the time is free, it lands here;
   *   · `line`: an insert line between rows — a new track opens here (no slot: it could only be drawn on a neighbor).
   * Drawn only where it can land (`droppable`); for a group one slot per clip, and none if slots overlap.
   */
  const landings = React.useMemo((): DropLanding[] => {
    if (assetHint) {
      if (assetHint.newTrack) {
        return [{
          type: 'line',
          startMs: assetHint.startMs,
          endMs: assetHint.endMs,
          top: laneBoundaryY(tracks, assetHint.laneIndex, padTop),
        }];
      }
      const top = trackSlotTop(tracks, assetHint.laneIndex, padTop);
      const height = trackKindHeight(tracks[assetHint.laneIndex]?.kind ?? laneKindForHint(assetHint.blockKind));
      return [{
        type: 'slot',
        startMs: assetHint.startMs,
        endMs: assetHint.endMs,
        title: assetHint.title,
        color: KIND_COLOR[assetHint.blockKind],
        top,
        height,
        refused: Boolean(assetHint.error),
      }, ...(assetHint.editMode === 'insert' && !assetHint.error && onEditOps
        ? [{ type: 'insert' as const, startMs: assetHint.startMs, endMs: assetHint.startMs, top, height }] : [])];
    }
    const p = drag.preview;
    /* after release the preview only holds the place (DragPreview.landed); where it cannot land, nothing */
    if (!p || p.mode !== 'move' || p.landed || !p.droppable) return [];
    const landById = new Map<string, { startMs: number; endMs: number }>();
    landById.set(p.id, { startMs: p.landStartMs, endMs: p.landEndMs });
    for (const m of p.landMoves) landById.set(m.id, { startMs: m.startMs, endMs: m.endMs });
    const followById = new Map<string, { startMs: number; endMs: number }>();
    followById.set(p.id, { startMs: p.startMs, endMs: p.endMs });
    for (const m of p.moves) followById.set(m.id, { startMs: m.startMs, endMs: m.endMs });
    const out: DropLanding[] = [];
    for (const [id, land] of landById) {
      const home = tracks.findIndex((tr) => tr.blocks.some((b) => b.id === id));
      const block = allBlocks.find((b) => b.id === id);
      if (!block || home < 0) continue;
      const at = p.laneDelta
        ? { laneIndex: home + p.laneDelta, newTrack: false }
        : moveLandingLane(id === p.id ? p.drop : { action: 'stay' }, tracks, home);
      /* the floating clip already sits at its own row and time: a slot there would just double it */
      const follow = followById.get(id);
      if (follow && !at.newTrack && at.laneIndex === home
        && Math.abs(follow.startMs - land.startMs) < 1) continue;
      out.push(landingForClip(block, land.startMs, land.endMs, at, tracks, padTop));
    }
    /* two slots on the same row and time = it cannot land here: none */
    for (let i = 0; i < out.length; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        if (landingSlotsOverlap(out[i]!, out[j]!)) return [];
      }
    }
    /* an insert: the point it goes in at, on the row it lands on */
    if (p.insertAtMs != null) {
      const home = tracks.findIndex((tr) => tr.blocks.some((b) => b.id === p.id));
      const at = moveLandingLane(p.laneDelta ? { action: 'stay' } : p.drop, tracks, home + p.laneDelta);
      const row = tracks[at.laneIndex];
      if (row && !at.newTrack) {
        out.push({ type: 'insert', startMs: p.insertAtMs, endMs: p.insertAtMs, top: trackSlotTop(tracks, at.laneIndex, padTop), height: rowH(row) });
      }
    }
    return out;
  }, [allBlocks, assetHint, drag.preview, padTop, tracks, onEditOps]);

  /* the snap guide only when snapped to an edge (or zero) and landing right there (useBlockDrag landsFlush); not for
     the playhead, which is already a line */
  const snapGuideMs = drag.preview?.snappedTo && drag.preview.snappedTo.kind !== 'playhead'
    ? drag.preview.snappedTo.ms
    : (assetHint?.snapGuideMs ?? null);

  /** The selected clips, in timeline order. */
  const selectedBlocks = React.useMemo(
    () => tracks.flatMap((tr) => tr.blocks).filter((b) => selected.includes(b.id)),
    [selected, tracks],
  );

  /**
   * Ripple trim to the playhead (Q / W): `start` takes the head of the clip off up to the playhead, `end` its tail
   * from it, and what follows closes up (with sync lock on every unlocked track). On the clips given, else the
   * selected ones the playhead is inside, else the topmost under it; the clips linked to them go along.
   */
  const rippleTrimToPlayhead = React.useCallback((edge: 'start' | 'end', given?: readonly TimelineBlock[]) => {
    const atMs = timeMsRef.current;
    const lockedRow = (b: TimelineBlock) => tracks.some((tr) => tr.locked && tr.blocks.some((x) => x.id === b.id));
    const inside = (b: TimelineBlock) => Boolean(b.clipId) && !lockedRow(b) && atMs > b.startMs + TOUCH_MS && atMs < b.endMs - TOUCH_MS;
    const all = tracks.flatMap((tr) => tr.blocks);
    const main = (given ?? all.filter((b) => selectedRef.current.includes(b.id))).find(inside) ?? all.find(inside);
    if (!main?.clipId) return;
    const ids = prefsRef.current.linked ? [main.clipId, ...linkedIds(modelRef.current, [main.clipId]).filter((id) => id !== main.clipId)] : [main.clipId];
    const plan = planRippleTrimTo(modelRef.current, ids, edge, atMs, { sync: prefsRef.current.sync });
    void runPlan(plan, `history.stepRippleTrimmed|${main.clipId}`);
  }, [tracks, runPlan]);

  /** Link clips (one `data-link`), or unlink them. */
  const linkBlocks = React.useCallback((blocks: readonly TimelineBlock[]) => {
    const ids = blocks.flatMap((b) => (b.clipId ? [b.clipId] : []));
    void runPlan({ ops: planLink(modelRef.current, ids), placed: new Map(), shortMs: 0 }, `history.stepLinked|${ids.slice(0, 2).join(', ')}`);
  }, [runPlan]);
  const unlinkBlocks = React.useCallback((blocks: readonly TimelineBlock[]) => {
    const ids = blocks.flatMap((b) => (b.clipId ? [b.clipId] : []));
    void runPlan({ ops: planUnlink(modelRef.current, ids), placed: new Map(), shortMs: 0 }, `history.stepUnlinked|${ids.slice(0, 2).join(', ')}`);
  }, [runPlan]);

  /* the commands keys bound outside call (see TimelineProps.commandsRef) */
  React.useEffect(() => {
    if (!commandsRef) return undefined;
    const all = () => tracks.flatMap((tr) => tr.blocks);
    const picked = () => all().filter((b) => selectedRef.current.includes(b.id));
    commandsRef.current = {
      rippleTrimStart: () => rippleTrimToPlayhead('start'),
      rippleTrimEnd: () => rippleTrimToPlayhead('end'),
      closeGap,
      link: () => linkBlocks(picked()),
      unlink: () => unlinkBlocks(picked()),
      toggleMagnet: () => togglePref('magnet'),
      toggleSnap: () => togglePref('snap'),
      toggleSync: () => togglePref('sync'),
      toggleLinked: () => togglePref('linked'),
      split: () => {
        const atMs = timeMsRef.current;
        const found = splitTargets(tracks, selectedRef.current, atMs, targetLaneRef.current);
        /* the clips linked to them too (runSplit leaves out those the playhead is not inside) */
        const ids = new Set(withLinked(found.map((b) => b.id)));
        if (found.length) void runSplit(all().filter((b) => ids.has(b.id)), atMs);
      },
      splitAll: () => { void runSplit(splitAllTargets(tracks, timeMsRef.current), timeMsRef.current); },
      cut: () => {
        const clips = picked().filter((b) => b.loc);
        if (!clips.length) return;
        onCopy?.(clips);
        void (prefsRef.current.magnet ? rippleRemove(clips) : removeMany(clips));
      },
      nudge: (frames) => {
        const ids = picked().flatMap((b) => (b.clipId ? [b.clipId] : []));
        if (!ids.length) return;
        const plan = planNudge(modelRef.current, ids, frames, { mode: prefsRef.current.magnet ? 'insert' : 'overwrite', sync: prefsRef.current.sync });
        if (plan) void runPlan(plan, 'history.stepMove');
      },
      zoomFit: () => {
        zoomTo(ZOOM_DEFAULT);
        requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollLeft = 0; });
      },
      target: () => tracks.find((tr) => tr.lane === targetLaneRef.current)?.docIndex ?? null,
    };
    return () => { commandsRef.current = null; };
  }, [commandsRef, tracks, rippleTrimToPlayhead, closeGap, linkBlocks, unlinkBlocks, togglePref, withLinked, runSplit, onCopy, rippleRemove, removeMany, runPlan, zoomTo]);

  /** A transition's entries for a cut (or a clip's edge): each put there at its default length, in one step. */
  const transitionEntries = React.useCallback((cut: CutRef, kinds: readonly TransitionKind[]): ContextMenuEntry[] => kinds.map((kind) => ({
    id: `tr-${kind}-${cut.a ?? ''}-${cut.b ?? ''}`,
    label: t(`transitions.${kind}`),
    icon: kind === 'crossfade' ? <AudioLines size={14} /> : <Blend size={14} />,
    onSelect: () => { void onTransition?.({ kind: 'add', type: kind, cut }).then((err) => { if (err) setDropError(err); }); },
  })), [t, onTransition]);

  /**
   * The context menu's items — all actions that exist elsewhere (split, copy, paste, delete). Items that cannot run
   * stay in place, disabled, with the reason (`hint`): an item that is "Delete" one time and "Copy" the next cannot be
   * learned.
   */
  const menuItems = React.useMemo((): ContextMenuEntry[] => {
    if (!menu) return [];
    if (menu.head) return headEntries(menu.head);
    /* a cut, or a transition's mark: the transitions that go there, and taking one away */
    if (menu.cut || menu.transition) {
      const cut = menu.cut ?? { a: menu.transition!.a, b: menu.transition!.b };
      const there = menu.transition ?? transitions?.find((x) => x.a === cut.a && x.b === cut.b);
      return [
        ...(menu.cut ? transitionEntries(cut, ['dissolve', 'dip-black', 'dip-white', 'crossfade']) : []),
        ...(there && menu.cut ? [{ id: 'tr-sep', separator: true } as const] : []),
        ...(there ? [{
          id: 'tr-remove', label: t('transitions.remove'), icon: <Trash2 size={14} />, danger: true, shortcut: '⌫',
          onSelect: () => { void onTransition?.({ kind: 'remove', key: there.key }).then((err) => { if (err) setDropError(err); }); onPickTransition?.(null); },
        }] : []),
      ];
    }
    const picked = menu.blocks;
    /* one clip, or one clip with the clips linked to it: the entries about a single clip are about the one clicked */
    const one = picked.length === 1 ? picked[0]!
      : menu.clicked && withLinked([menu.clicked.id]).length === picked.length ? menu.clicked : null;

    /* empty track space: paste here; in a gap, close it */
    if (!picked.length) {
      const laneLocked = Boolean(tracks.find((tr) => tr.lane === menu.lane)?.locked);
      const entries: ContextMenuEntry[] = [];
      if (onPaste) {
        entries.push({
          id: 'paste',
          label: t('timeline.menuPaste'),
          icon: <ClipboardPaste size={14} />,
          shortcut: shortcutHint('V', { mod: true }),
          disabled: !onPaste || !hasClipboard || !menu.lane || laneLocked,
          hint: laneLocked ? t('timeline.trackLocked') : t('timeline.menuPasteEmpty'),
          onSelect: () => { if (menu.lane) void onPaste?.(menu.lane, menu.atMs); },
        });
      }
      if (menu.gap && onEditOps) {
        const found = menu.gap;
        entries.push({
          id: 'close-gap',
          label: t('timeline.menuCloseGap'),
          icon: <BetweenHorizontalStart size={14} />,
          shortcut: '⌫',
          onSelect: () => { void runPlan(planCloseGap(modelRef.current, found.track, found, { sync: prefsRef.current.sync }), 'history.stepGapClosed'); },
        });
      }
      return entries;
    }

    const pickedLocked = picked.some((b) => (
      tracks.some((tr) => tr.locked && tr.blocks.some((row) => row.id === b.id))
    ));
    const nowMs = timeMsRef.current;
    const spans = (b: TimelineBlock) => nowMs > b.startMs + MIN_BLOCK_MS && nowMs < b.endMs - MIN_BLOCK_MS;
    const canSplit = Boolean(onSplit && !pickedLocked && picked.some((b) => b.loc && spans(b)));
    const out: ContextMenuEntry[] = [];
    const extra = blockMenuExtra?.(picked) ?? [];
    if (extra.length) out.push(...extra, { id: 'extra-sep', separator: true });

    if (one && onSplit) {
      out.push({
        id: 'split',
        label: t('timeline.menuSplitHere'),
        icon: <Scissors size={14} />,
        shortcut: shortcutHint('B', { mod: true }),
        disabled: !canSplit,
        /* disabled for one reason only: the playhead is not over this clip */
        hint: t('timeline.menuSplitOutside'),
        onSelect: () => { void runSplit(picked); },
      });
    }
    /* ripple trims to the playhead (Q / W in Premiere): off the head up to it, or off the tail from it, closing up */
    if (one && onEditOps && one.clipId) {
      const under = spans(one) && !pickedLocked;
      out.push({
        id: 'ripple-start',
        label: t('timeline.menuRippleStart'),
        icon: <ArrowLeftToLine size={14} />,
        shortcut: 'Q',
        disabled: !under,
        hint: pickedLocked ? t('timeline.trackLocked') : t('timeline.menuSplitOutside'),
        onSelect: () => { rippleTrimToPlayhead('start', [one]); },
      }, {
        id: 'ripple-end',
        label: t('timeline.menuRippleEnd'),
        icon: <ArrowRightToLine size={14} />,
        shortcut: 'W',
        disabled: !under,
        hint: pickedLocked ? t('timeline.trackLocked') : t('timeline.menuSplitOutside'),
        onSelect: () => { rippleTrimToPlayhead('end', [one]); },
      });
    }
    /* clips that go together: link them, or take them apart */
    if (onEditOps) {
      const ids = picked.flatMap((b) => (b.clipId ? [b.clipId] : []));
      const linkOps = planLink(modelRef.current, ids);
      const unlinkOps = planUnlink(modelRef.current, ids);
      if (linkOps.length && ids.length > 1) {
        out.push({
          id: 'link', label: t('timeline.menuLink'), icon: <Link2 size={14} />, disabled: pickedLocked, hint: t('timeline.trackLocked'),
          onSelect: () => { linkBlocks(picked); },
        });
      }
      if (unlinkOps.length) {
        out.push({
          id: 'unlink', label: t('timeline.menuUnlink'), icon: <Link2Off size={14} />, disabled: pickedLocked, hint: t('timeline.trackLocked'),
          onSelect: () => { unlinkBlocks(picked); },
        });
      }
    }
    /* a video's sound onto a track of its own: its picture and sound edited apart from then on */
    if (one && onDetachAudio && one.kind === 'video' && one.clipId && !(one.src && filmSrcIsStill(one.src))) {
      const heard = Boolean(one.ownAudio) && !one.silent;
      out.push({
        id: 'detach-audio',
        label: t('timeline.menuDetachAudio'),
        icon: <Waves size={14} />,
        disabled: !heard || pickedLocked,
        hint: pickedLocked ? t('timeline.trackLocked') : t('timeline.menuDetachAudioNone'),
        onSelect: () => { void onDetachAudio(one); },
      });
    }
    /* fades and transitions at the clip's start and end (lib/transitions) */
    if (one && onTransition && one.clipId && !pickedLocked) {
      const row = tracks.find((tr) => tr.blocks.some((b) => b.id === one.id));
      const at = (ms: number) => (row?.docIndex != null ? cutNear(modelRef.current, row.docIndex, ms, 1) : null);
      const start = at(one.startMs), end = at(one.endMs);
      const startCut: CutRef = { a: start?.b === one.clipId ? start.a : null, b: one.clipId };
      const endCut: CutRef = { a: one.clipId, b: end?.a === one.clipId ? end.b : null };
      out.push(
        { id: 'tr-sep-1', separator: true },
        ...transitionEntries(startCut, ['fade-in']),
        ...transitionEntries(endCut, ['fade-out']),
        { id: 'tr-start', label: t('transitions.atStart'), icon: <Blend size={14} />, submenu: transitionEntries(startCut, ['dissolve', 'dip-black', 'dip-white', 'crossfade']) },
        { id: 'tr-end', label: t('transitions.atEnd'), icon: <Blend size={14} />, submenu: transitionEntries(endCut, ['dissolve', 'dip-black', 'dip-white', 'crossfade']) },
        { id: 'tr-sep-2', separator: true },
      );
    }
    /* a clip whose file went away: point it at the file again (found by name in the project, or a new one) */
    if (one?.src && onRelink && mediaTrouble?.get(one.src) === 'missing') {
      const found = relinkCandidates?.(one.src) ?? [];
      out.push({
        id: 'relink',
        label: t('timeline.menuRelink'),
        icon: <Link2 size={14} />,
        submenu: [
          ...found.slice(0, 8).map((path) => ({ id: `relink:${path}`, label: path, onSelect: () => onRelink(one, path) })),
          ...(found.length ? [{ id: 'relink-sep', separator: true } as const] : []),
          { id: 'relink-pick', label: t('timeline.menuRelinkPick'), onSelect: () => onRelink(one, null) },
        ],
      });
    }
    if (onCopy) {
      out.push({
        id: 'copy',
        label: t('timeline.menuCopy'),
        icon: <Copy size={14} />,
        shortcut: shortcutHint('C', { mod: true }),
        disabled: !picked.some((b) => b.loc),
        hint: t('timeline.menuCopyNone'),
        onSelect: () => onCopy(picked.filter((b) => b.loc)),
      });
    }
    if (onPaste) {
      const pasteLane = one ? laneOfBlock(tracks, one.id) : (picked[0] ? laneOfBlock(tracks, picked[0].id) : null);
      out.push({
        id: 'paste',
        label: t('timeline.menuPaste'),
        icon: <ClipboardPaste size={14} />,
        shortcut: shortcutHint('V', { mod: true }),
        disabled: !hasClipboard || !pasteLane || pickedLocked,
        hint: pickedLocked ? t('timeline.trackLocked') : t('timeline.menuPasteEmpty'),
        onSelect: () => { if (pasteLane) void onPaste(pasteLane, menu.atMs); },
      });
    }
    /* exporting one clip is for MG only: its point is a transparent background, which only an MG page has */
    if (onExportBlock && one?.kind === 'mg') {
      out.push({
        id: 'export',
        label: t('timeline.menuExportClip'),
        icon: <Download size={14} />,
        /* a clip without an id is not on film.html and cannot be found by it */
        disabled: !one.clipId,
        hint: t('timeline.menuExportNoId'),
        onSelect: () => { if (one.clipId) onExportBlock(one.clipId); },
      });
    }
    if (onRemove || onRemoveMany || onEditOps) {
      out.push({ id: 's2', separator: true });
      out.push({
        id: 'remove',
        label: t('timeline.removeBlock'),
        icon: <Trash2 size={14} />,
        danger: true,
        disabled: pickedLocked || !picked.some((b) => b.loc),
        hint: pickedLocked ? t('timeline.trackLocked') : t('timeline.menuCopyNone'),
        shortcut: '⌫',
        /* as ⌫: with the magnet on, the gap closes */
        onSelect: () => { void (prefsRef.current.magnet ? rippleRemove(picked) : removeMany(picked)); },
      });
      if (onEditOps) {
        out.push({
          id: 'ripple',
          label: t('timeline.rippleRemove'),
          icon: <Trash2 size={14} />,
          danger: true,
          disabled: pickedLocked || !picked.some((b) => b.loc),
          hint: pickedLocked ? t('timeline.trackLocked') : t('timeline.menuCopyNone'),
          shortcut: '⇧⌫',
          onSelect: () => { void rippleRemove(picked); },
        });
      }
    }
    return out;
  }, [
    menu, t, onSplit, onDetachAudio, onRemove, onRemoveMany, onCopy, onPaste, onExportBlock, mediaTrouble, relinkCandidates,
    onRelink, hasClipboard, runSplit, removeMany, rippleRemove, onEditOps, tracks, blockMenuExtra, headEntries, withLinked,
    runPlan, rippleTrimToPlayhead, linkBlocks, unlinkBlocks, transitions, onTransition, onPickTransition, transitionEntries,
  ]);

  /* ── the bar beside the selection (SelectionToolbar): what was picked last, the clips, the range or a point ── */
  const selKey = selected.join('|');
  React.useEffect(() => { setBarFocus((f) => (selKey ? 'clips' : f === 'clips' ? null : f)); }, [selKey]);
  const rangeKey = range ? `${Math.round(range.startMs)}-${Math.round(range.endMs)}` : '';
  React.useEffect(() => { setBarFocus((f) => (rangeKey ? 'range' : f === 'range' ? null : f)); }, [rangeKey]);
  React.useEffect(() => { if (playing) setBarFocus((f) => (f === 'point' ? null : f)); }, [playing]);
  const barKind = !selectionBar ? null
    : barFocus === 'point' && playable ? 'point'
      : barFocus === 'range' && range ? 'range'
        : selectedBlocks.length ? 'clips' : range ? 'range' : null;
  const barTools = ((): SelectionToolEntry[] => {
    if (!barKind) return [];
    const nowMs = scrubMs ?? timeMs;
    const out: SelectionToolEntry[] = [];
    const lockedBlock = (b: TimelineBlock) => tracks.some((tr) => tr.locked && tr.blocks.some((row) => row.id === b.id));
    /* the clips the playhead is inside, as the split button and ⌘B have it (all of them in one edit) */
    const underPlayhead = selectedBlocks.filter((b) => b.loc && !lockedBlock(b) && drag.can(b).resize
      && nowMs > b.startMs + MIN_BLOCK_MS && nowMs < b.endMs - MIN_BLOCK_MS);
    const splitAll = async () => { await runSplit(underPlayhead, nowMs); };
    if (barKind === 'point') {
      if (onSplit && selectedBlocks.length) {
        out.push({
          id: 'split', label: t('selectionBar.splitSelected'), icon: <Scissors size={14} />, shortcut: shortcutHint('B', { mod: true }),
          disabled: !underPlayhead.length || splitting, hint: t('selectionBar.splitNone'), onSelect: () => { void splitAll(); },
        });
      }
      return out;
    }
    if (barKind === 'range' && range) {
      if (onPlayRange) out.push({ id: 'play-range', label: t('selectionBar.playRange'), icon: <Play size={14} />, onSelect: () => onPlayRange(range) });
      if (onRangeChange) out.push({ id: 'clear-range', label: t('selectionBar.clearRange'), icon: <X size={14} />, shortcut: 'X', onSelect: () => onRangeChange(null) });
      return out;
    }
    const picked = selectedBlocks;
    const pickedLocked = picked.some(lockedBlock);
    const lockedHint = t('timeline.trackLocked');
    if (onSplit) {
      out.push({
        id: 'split', label: t('timeline.menuSplitHere'), icon: <Scissors size={14} />, shortcut: shortcutHint('B', { mod: true }),
        disabled: !underPlayhead.length || splitting, hint: pickedLocked ? lockedHint : t('timeline.menuSplitOutside'), onSelect: () => { void splitAll(); },
      });
    }
    if (onDuplicate) {
      out.push({
        id: 'duplicate', label: t('stageMenu.duplicate'), icon: <CopyPlus size={14} />, disabled: pickedLocked || !picked.some((b) => b.clipId), hint: lockedHint,
        onSelect: () => { void onDuplicate(picked.filter((b) => b.clipId)); },
      });
    }
    /* a clip's own sound: film.html's `volume` 0 is silent; unmuted it plays as is (the inspector sets a level) */
    const sounding = picked.filter((b) => b.loc && parseFilmDocLoc(b.loc) != null
      && (b.kind === 'voice' || b.kind === 'sfx' || b.kind === 'music' || Boolean(b.ownAudio)));
    if (onEditBlocks && sounding.length) {
      const allSilent = sounding.every((b) => b.silent);
      out.push({
        id: 'mute', label: t(allSilent ? 'selectionBar.unmute' : 'selectionBar.mute'), icon: allSilent ? <Volume2 size={14} /> : <VolumeX size={14} />,
        disabled: pickedLocked, hint: lockedHint,
        onSelect: () => { void onEditBlocks(sounding.map((b) => ({ loc: b.loc!, prop: 'volume', value: allSilent ? null : 0 }))); },
      });
    }
    /* clips that go together: one button to link them, or to take them apart (what the selection is now) */
    if (onEditOps && picked.length > 1) {
      const ids = picked.flatMap((b) => (b.clipId ? [b.clipId] : []));
      const linked = ids.length > 1 && !planLink(model, ids).length;
      out.push({
        id: 'link', label: t(linked ? 'timeline.menuUnlink' : 'timeline.menuLink'), icon: linked ? <Link2Off size={14} /> : <Link2 size={14} />,
        disabled: pickedLocked, hint: lockedHint, onSelect: () => { (linked ? unlinkBlocks : linkBlocks)(picked); },
      });
    }
    if (onRemove || onRemoveMany || onEditOps) {
      out.push({
        id: 'delete', label: t('timeline.removeBlock'), icon: <Trash2 size={14} />, shortcut: '⌫', danger: true,
        disabled: pickedLocked || !picked.some((b) => b.loc), hint: lockedHint,
        onSelect: () => { void (prefs.magnet ? rippleRemove(picked) : removeMany(picked)); },
      });
    }
    out.push({
      id: 'more', label: t('selectionBar.more'), icon: <MoreHorizontal size={14} />,
      onSelect: (button) => {
        const r = button.getBoundingClientRect();
        setMenu({ x: r.left, y: r.bottom + 4, blocks: picked, lane: null, atMs: timeMsRef.current });
      },
    });
    return out;
  })();
  /* first, always: the clips and the range, or the moment of the point */
  const barLead = barKind && onReferSelection ? {
    id: 'refer', label: t('selectionBar.addToChat'), icon: <MessageSquarePlus size={14} />, shortcut: shortcutHint('L', { mod: true }),
    onSelect: () => onReferSelection(barKind === 'point'
      ? { blocks: [], range: null, atMs: timeMsRef.current }
      : { blocks: selectedBlocks, range: range ?? null, atMs: null }),
  } : null;
  const clipCount = selectedBlocks.length;
  const clipsWord = clipCount === 1 ? t('selectionBar.oneClip') : t('selectionBar.clips').replace('{n}', String(clipCount));
  const barLabel = barKind === 'point' || !clipCount ? undefined
    : range ? t('selectionBar.plusRange').replace('{what}', clipsWord)
      : clipCount > 1 ? clipsWord : undefined;
  /* the clips' union box (their blocks as drawn), the range or the playhead on the ruler; in the track area across.
     A range's or a point's bar goes over the timeline's toolbar row, just above the ruler; a clip's stays among the
     tracks, under the ruler */
  const measureBar = () => {
    const root = rootRef.current;
    const scroller = scrollRef.current;
    const ruler = rulerRef.current;
    if (!root || !scroller || !ruler || !barKind) return null;
    const sr = scroller.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    const rl = ruler.getBoundingClientRect();
    const bounds = { left: sr.left, top: rr.top, width: sr.width, height: sr.bottom - rr.top };
    if (barKind === 'clips') {
      /* never over another clip (it covered the clips on the track above), nor over the ruler (a bar there took the
         clicks meant to move the playhead) or the timeline's own buttons: the nearest place clear of them, among the
         tracks or, when they are full, in the middle of the timeline's toolbar row */
      const ids = new Set(selected);
      const rect = (el: Element): ScreenBox => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
      const clips = [...(contentRef.current?.querySelectorAll<HTMLElement>('[data-block-id]') ?? [])];
      const anchor = unionBox(clips.filter((el) => ids.has(el.dataset.blockId ?? '')).map(rect));
      const avoid = [
        ...clips.filter((el) => !ids.has(el.dataset.blockId ?? '')).map(rect),
        rect(ruler),
        ...[...(toolbarRef.current?.querySelectorAll('button, input') ?? [])].map(rect),
      ];
      return anchor ? { anchor, bounds, avoid } : null;
    }
    const x = (ms: number) => sr.left + ms * pxPerMs - scroller.scrollLeft;
    const anchor = barKind === 'range' && range
      ? { left: x(range.startMs), top: rl.top, width: Math.max(1, (range.endMs - range.startMs) * pxPerMs), height: rl.height }
      : { left: x(scrubMs ?? timeMs), top: rl.top, width: 0, height: rl.height };
    /* just over the ruler: the toolbar row above it is the room there is */
    return { anchor, bounds, gap: 2 };
  };
  const barKey = !barKind ? null : barKind === 'clips' ? `clips:${selKey}` : barKind === 'range' ? `range:${rangeKey}` : 'point';

  return (
    /* no background on the outer box: the pane's rounded corners come from the pane's own background */
    <div
      ref={rootRef}
      data-timeline=""
      className="relative isolate overflow-hidden flex min-h-0 min-w-0 flex-1 flex-col"
      /* any press here takes focus out of a text field: most presses preventDefault (which also stops the browser's
         own blur), and a focused field would keep eating Space */
      onPointerDownCapture={(e) => {
        const active = document.activeElement;
        if (active && active !== e.target && isTypingTarget(active) && !isTypingTarget(e.target)) {
          (active as HTMLElement).blur();
        }
      }}
    >
      {/* ── Toolbar: mode (select / split) · undo / redo / history · split · status · the switches · zoom · subtitles ── */}
      <div
        ref={toolbarRef}
        className="@container relative flex h-[34px] shrink-0 items-center gap-1.5 border-b px-2"
        style={{ background: TL.head, borderColor: TL.line }}
      >
        {onSplit ? <>
          <ModePicker mode={mode} onPick={setMode} />
          <span className="mx-0.5 h-4 w-px" style={{ background: TL.line }} />
        </> : null}

        {history ? (
          <>
            <ToolButton
              onClick={() => history.step('undo')}
              disabled={!history.canUndo}
              label={t('history.undo')}
              hint={shortcutHint('Z', { mod: true })}
            >
              <Undo2 size={16} />
            </ToolButton>
            <ToolButton
              onClick={() => history.step('redo')}
              disabled={!history.canRedo}
              label={t('history.redo')}
              hint={shortcutHint('Z', { mod: true, shift: true })}
            >
              <Redo2 size={16} />
            </ToolButton>
            {/* edit history next to undo: it answers "where does the next ⌘Z go" (not version history) */}
            {history.ops && history.rollbackTo ? (
              <OpsButton ops={history.ops} onRollback={history.rollbackTo} />
            ) : null}
          </>
        ) : null}

        {onSplit ? (
          <ToolButton
            onClick={() => { void runSplit(selectedBlocks.filter((b) => drag.can(b).resize)); }}
            /* lit only with a selection: a disabled button already says "this acts on the selection" */
            disabled={!selectedBlocks.some((b) => drag.can(b).resize)}
            label={t('timeline.split')}
            hint={shortcutHint('B', { mod: true })}
          >
            <Scissors size={16} />
          </ToolButton>
        ) : null}

        {/* the middle is for status: "Editing source…" and errors (not among the tools, where it would look like one) */}
        <div className="flex min-w-0 flex-1 items-center justify-center">
          {dropBusy || drag.saving ? (
            <span className="text-[11px]" style={{ color: TL.faint }}>{t('timeline.applying')}</span>
          ) : dropError || drag.error ? (
            <button
              type="button"
              onClick={() => {
                setDropError(null);
                drag.dismissError();
              }}
              className="max-w-[min(280px,100%)] truncate rounded-[4px] bg-[color-mix(in_srgb,var(--err)_14%,transparent)] px-1.5 py-0.5 text-[11px] text-[var(--err)]"
              title={dropError ?? drag.error ?? undefined}
            >
              {dropError ?? drag.error}
            </button>
          ) : notice ? (
            <button
              type="button"
              data-timeline-notice=""
              onClick={() => setNotice(null)}
              className="flex max-w-[min(320px,100%)] items-center gap-1 truncate rounded-[4px] bg-[color-mix(in_srgb,var(--warn)_14%,transparent)] px-1.5 py-0.5 text-[11px] text-[var(--text)]"
              title={notice}
            >
              <TriangleAlert size={12} className="shrink-0 text-[var(--warn)]" aria-hidden />
              <span className="min-w-0 truncate">{notice}</span>
            </button>
          ) : null}
        </div>

        {/* the switches (lib/timeline-prefs): the magnet (insert, ripple; off: overwrite), sync lock (ripples move every
            unlocked track), linked clips, snapping */}
        {onEditOps ? <>
          <span data-timeline-magnet={prefs.magnet ? '1' : '0'}>
            <ToolButton onClick={() => togglePref('magnet')} active={prefs.magnet} label={t('timeline.magnet')}
              hint={prefs.magnet ? t('timeline.magnetOn') : t('timeline.magnetOff')}>
              <Magnet size={15} />
            </ToolButton>
          </span>
          <span data-timeline-sync={prefs.sync ? '1' : '0'}>
            <ToolButton onClick={() => togglePref('sync')} active={prefs.sync} label={t('timeline.sync')}
              hint={prefs.sync ? t('timeline.syncOn') : t('timeline.syncOff')}>
              <Rows3 size={15} />
            </ToolButton>
          </span>
          <span data-timeline-linked={prefs.linked ? '1' : '0'}>
            <ToolButton onClick={() => togglePref('linked')} active={prefs.linked} label={t('timeline.linked')}
              hint={prefs.linked ? t('timeline.linkedOn') : t('timeline.linkedOff')}>
              {prefs.linked ? <Link2 size={15} /> : <Link2Off size={15} />}
            </ToolButton>
          </span>
          <span data-timeline-snap={snap ? '1' : '0'}>
            <ToolButton onClick={() => togglePref('snap')} active={snap} label={t('timeline.snap')}
              hint={snap ? t('timeline.snapOn') : t('timeline.snapOff')}>
              <SeparatorVertical size={15} />
            </ToolButton>
          </span>
        </> : null}
        {toolbarExtra}

        <ToolButton
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          disabled={!(hasLanes && spanMs > 0) || viewZoom <= zoomMinOf(spanMs)}
          label={t('timeline.zoomOut')}
          hint={shortcutHint('-', { mod: true })}
        >
          <ZoomOut size={15} />
        </ToolButton>
        <Tooltip side="bottom" label={`${Math.round(viewZoom * 100)}%`}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={zoomToSlider(viewZoom, spanMs)}
            onChange={(e) => zoomTo(sliderToZoom(Number(e.target.value), spanMs))}
            disabled={!(hasLanes && spanMs > 0)}
            aria-label={t('timeline.zoom')}
            className="tl-zoom hidden h-[3px] w-[78px] shrink-0 cursor-pointer disabled:opacity-40 @lg:block"
            style={{ '--pos': zoomToSlider(zoom, spanMs) } as React.CSSProperties}
          />
        </Tooltip>
        <ToolButton
          onClick={() => zoomBy(ZOOM_STEP)}
          disabled={!(hasLanes && spanMs > 0) || viewZoom >= zoomMaxOf(spanMs)}
          label={t('timeline.zoomIn')}
          hint={shortcutHint('+', { mod: true })}
        >
          <ZoomIn size={15} />
        </ToolButton>
        {/* back to the opening zoom (80%, a little room after the end); a horizontal arrow: zoom is horizontal only */}
        <ToolButton
          onClick={() => zoomTo(ZOOM_DEFAULT)}
          disabled={!playable || Math.abs(viewZoom - ZOOM_DEFAULT) < 0.01}
          label={t('timeline.zoomFit')}
        >
          <MoveHorizontal size={15} />
        </ToolButton>

        {/* subtitles: toggles the overlay on the picture (not the film itself) */}
        {subtitles ? <SubtitlePicker subtitles={subtitles} /> : null}
      </div>

      {/* ── Body: two columns. The head column is not inside the scroller (no scrollbar under it, no rubber-band,
          wheel over it does nothing); the ruler follows the track area's scrollLeft. ── */}
      <div className="flex min-h-0 min-w-0 flex-1">
        {/* left: track heads */}
        <div
          className="relative z-20 shrink-0 overflow-hidden border-r"
          style={{
            width: headW,
            background: TL.head,
            borderColor: TL.line,
            /* a shadow only once content has scrolled under it */
            boxShadow: view.left > 0 ? '6px 0 8px -6px rgba(0,0,0,0.55)' : undefined,
          }}
        >
          {/* as tall as the ruler, so heads line up with rows; no bottom line, it is not a column of its own */}
          <div style={{ height: RULER_H }} />
          {subRowShown ? <SubtitleRowHead onAdd={() => subRowRef.current?.addAtPlayhead()} /> : null}
          <div
            ref={headRef}
            className="relative overflow-hidden"
            /* the same padding as the track area, so both scroll the same height and scrollTop stays in sync */
            style={{
              height: `calc(100% - ${RULER_H + subRowH}px - ${H_SCROLL_H}px)`,
              paddingTop: padTop,
              paddingBottom: TL_VPAD,
            }}
          >
            {heads}
            {laneOrder ? (() => {
              const hover = laneOrder.hoverLane;
              let top = padTop;
              if (hover < 0) {
                /* above all rows */
              } else if (hover >= tracks.length) {
                top += tracksH;
              } else {
                for (let i = 0; i < hover; i += 1) top += GAP + rowH(tracks[i]!);
                if (hover > laneOrder.fromLane) top += GAP + rowH(tracks[hover]!);
                else top += GAP / 2;
              }
              return (
                <div
                  className="pointer-events-none absolute left-0 right-0 z-40 h-0.5"
                  data-lane-order-guide=""
                  style={{ top, background: 'var(--tl-select)' }}
                />
              );
            })() : null}
          </div>
        </div>

        {/* right: ruler + track area; the only part that scrolls, and where media-pane drops land */}
        <div
          className="relative flex min-w-0 flex-1 flex-col"
          onPointerDownCapture={focusTimeline}
          onDragOver={onAssetDragOver}
          onDragLeave={onAssetDragLeave}
          onDrop={onAssetDrop}
        >
          {/* ruler: follows the track area, ignores the wheel (two scroll sources would fight) */}
          <div
            ref={rulerRef}
            className="relative shrink-0 overflow-hidden border-b"
            style={{ height: RULER_H, background: TL.ruler, borderColor: TL.line }}
          >
            <div
              ref={seekRef}
              role="slider"
              tabIndex={0}
              aria-label={t('timeline.seek')}
              aria-valuemin={0}
              aria-valuemax={Math.round(totalMs)}
              aria-valuenow={Math.round(timeMs)}
              aria-valuetext={`${formatTimecode(timeMs)} / ${formatTimecode(totalMs)}`}
              onPointerDown={(e) => (e.shiftKey && onRangeChange ? startRange(e) : startScrub(e, true))}
              onKeyDown={onKeyDown}
              /* the point picked on the ruler is let go with the timeline's focus */
              onBlur={() => setBarFocus((f) => (f === 'point' ? null : f))}
              className="relative h-full touch-none select-none outline-none"
              style={{ width: trackPx, cursor: 'col-resize' }}
            >
              {tickMarks}
              {rulerOverlay?.(pxPerMs)}
            </div>
          </div>

          {subRowShown && subtitleRow ? (
            <SubtitleRow ref={subRowRef} spec={subtitleRow} pxPerMs={pxPerMs} scrollLeft={view.left} width={trackPx}
              playheadMs={() => timeMsRef.current} snap={snap} snapTargets={() => snapTargetsFor(allBlocks, null, timeMsRef.current)}
              onError={setDropError} />
          ) : null}

          {/* track area: backgrounds fixed to the view, clips scroll horizontally above them */}
          <div className="relative min-h-0 min-w-0 flex-1" style={{ background: TL.head }}>
            {hasLanes ? (
              <div
                aria-hidden
                data-lane-skins=""
                className="pointer-events-none absolute inset-0 overflow-hidden"
              >
                <div
                  ref={skinsShiftRef}
                  style={{ transform: `translate3d(0,${padTop - view.top}px,0)` }}
                >
                  {laneSkins}
                </div>
              </div>
            ) : null}
          <div
            ref={scrollRef}
            onScroll={onScroll}
            /* capture phase: a press on the playhead line goes to the scrub before clips and marquee (grabPlayhead);
               move / leave only manage the cursor */
            onPointerDownCapture={grabPlayhead}
            onPointerMove={(e) => { hotPlayhead(e); aimBlade(e); }}
            onPointerLeave={() => { coldPlayhead(); hideBlade(); }}
            /* no rubber-band: a ruler that bounces makes people think they dragged wrong */
            className={`tl-scroll absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-none bg-transparent${
              mode === 'split' ? ' tl-blade' : ''
            }`}
          >
            {!hasLanes && !landings.length ? (
              /* empty timeline: a dashed drop hint. Drops are handled on the whole right column, so dropping on the
                 hint adds the first clip and its track. */
              <div className="flex h-full w-full items-center justify-center px-6">
                <div className="pointer-events-none flex h-[44px] w-full max-w-[720px] items-center gap-2.5 rounded-[6px] border border-dashed border-[var(--border)] px-4">
                  <Video size={15} className="shrink-0 text-[var(--text-faint)]" aria-hidden />
                  <p className="truncate text-[11px] leading-relaxed text-[var(--text-faint)]">
                    {t('timeline.emptyStudio')}
                  </p>
                </div>
              </div>
            ) : (
              <div
                ref={contentRef}
                className="relative select-none"
                /* full height, so the empty space below the rows can be clicked too (a seek); the centering space is
                   padding, not a child's margin — a margin would collapse outside this box and not take clicks */
                style={{
                  width: trackPx, minWidth: '100%', minHeight: '100%', paddingTop: padTop, paddingBottom: TL_VPAD,
                }}
                onPointerDown={startMarquee}
              >
                {rows}
                {landings.length ? (
                  /* above the row being dragged (z-50); no pointer events, so release is not blocked */
                  <div className="pointer-events-none absolute inset-0 z-[60]" aria-hidden>
                    {landings.map((landing, i) => (
                      <LandingMark
                        key={`${landing.type}:${Math.round(landing.startMs)}:${Math.round(landing.endMs)}:${Math.round(landing.top)}:${i}`}
                        landing={landing}
                        pxPerMs={pxPerMs}
                      />
                    ))}
                  </div>
                ) : null}
                {/* while trimming, rolling, slipping or sliding: how far, beside the edge in hand */}
                {drag.preview?.tip && !drag.preview.landed ? (
                  <GestureLabel tip={drag.preview.tip} left={Math.round(drag.preview.tip.atMs * pxPerMs)} top={trackSlotTop(tracks, drag.preview.tip.lane, padTop)} />
                ) : null}
                {marquee ? (
                  <div
                    className="pointer-events-none absolute z-20 rounded-[2px] border"
                    style={{
                      left: Math.min(marquee.fromMs, marquee.toMs) * pxPerMs,
                      width: Math.abs(marquee.toMs - marquee.fromMs) * pxPerMs,
                      /* follows the pointer, not row edges (contentY already includes the scroll) */
                      top: Math.min(marquee.fromY, marquee.toY),
                      height: Math.abs(marquee.toY - marquee.fromY),
                      borderColor: 'var(--tl-accent)',
                      background: 'color-mix(in srgb, var(--tl-accent) 18%, transparent)',
                    }}
                  />
                ) : null}
                {/* the blade (positioned by aimBlade): white with a dark halo so it shows on every clip color */}
                {mode === 'split' ? (
                  <div
                    ref={bladeRef}
                    aria-hidden
                    className="pointer-events-none absolute left-0 z-30 w-px"
                    style={{
                      display: 'none',
                      background: '#fff',
                      boxShadow: '0 0 0 0.5px rgba(0,0,0,0.55), 0 0 3px rgba(0,0,0,0.35)',
                    }}
                  />
                ) : null}
              </div>
            )}
          </div>
          </div>
          <TimelineRangeBar
            zoom={viewZoom}
            totalMs={hasLanes ? Math.max(totalMs, extentMs) : 0}
            fromMs={pxPerMs > 0 ? view.left / pxPerMs : 0}
            viewMs={pxPerMs > 0 ? view.width / pxPerMs : 0}
            height={H_SCROLL_H}
            onPan={panViewTo}
          />
        </div>
      </div>

      {/* the playhead, on the outer layer from the ruler's top to the bottom; knob and line in one layer so they never
          drift apart. The layer reaches PLAYHEAD_BLEED further left so the knob at 0 is not cut in half. */}
      {hasLanes ? (
        <div
          className="pointer-events-none absolute inset-y-0 z-[35]"
          style={{ left: headW - PLAYHEAD_BLEED, right: 0, top: TOOLBAR_H, bottom: H_SCROLL_H, overflow: 'hidden' }}
        >
          {/* moved with transform, not left: the most frequently moving thing here, and transform skips layout */}
          <PlayheadTrack
            clock={clock}
            animate={playing && scrubMs == null}
            x={playheadX - scrollLeft + PLAYHEAD_BLEED}
            pxPerMs={pxPerMs}
            totalMs={totalMs}
            scrollRef={scrollRef}
          >
            <div className="absolute inset-y-0 left-0 w-px" style={{ background: 'var(--tl-playhead)' }} />
            {/* the knob; its hit area (24×20) is larger than the visible pin, people aim for the line and miss by a
                few pixels. Through the rows the line takes no pointer events: grabbing there is grabPlayhead's. */}
            <span
              role="presentation"
              onPointerDown={startScrub}
              className="pointer-events-auto absolute top-0 left-1/2 flex h-[20px] w-[24px] -translate-x-1/2 cursor-col-resize items-start justify-center"
            >
              <PlayheadKnob filled={scrubbing} />
            </span>
          </PlayheadTrack>
        </div>
      ) : null}

      {/* the snap guide: only when snapped to an edge; a thin accent line, nothing more */}
      {snapGuideMs != null ? (
        <div
          className="pointer-events-none absolute inset-y-0 z-[25] overflow-hidden"
          style={{ left: headW - PLAYHEAD_BLEED, right: 0, top: TOOLBAR_H, bottom: H_SCROLL_H }}
        >
          <div
            data-snap-guide=""
            className="absolute inset-y-0 left-0 w-px bg-[var(--tl-accent)]"
            style={{
              transform: `translate3d(${snapGuideMs * pxPerMs - scrollLeft + PLAYHEAD_BLEED}px,0,0)`,
            }}
          />
        </div>
      ) : null}

      {/* the span of a pill hovered in the app's chat (a range, a subtitle line, a moment), tinted on the ruler */}
      {chat?.span ? (
        <div className="pointer-events-none absolute z-[26] overflow-hidden" style={{ left: headW, right: 0, top: TOOLBAR_H, height: RULER_H }}>
          <div
            data-chat-span=""
            className="absolute inset-y-0 left-0"
            style={{
              transform: `translate3d(${chat.span.startMs * pxPerMs - scrollLeft}px,0,0)`,
              width: Math.max(2, (chat.span.endMs - chat.span.startMs) * pxPerMs),
              background: 'color-mix(in srgb, var(--tl-accent) 45%, transparent)',
              boxShadow: 'inset 0 -2px 0 var(--tl-accent)',
            }}
          />
        </div>
      ) : null}

      {/* the range marked on the ruler: a band from the ruler's top down through the tracks. It takes no pointer (the
          ruler scrubs and the clips under it are pressed as ever); its label does, and is dragged into the app's chat */}
      {shownRange && hasLanes ? (() => {
        const fromX = shownRange.startMs * pxPerMs - scrollLeft;
        const width = Math.max(1, (shownRange.endMs - shownRange.startMs) * pxPerMs);
        const label = rangeLabel(shownRange, rangeRef ? shortcutHint('L', { mod: true }) : undefined);
        return (
          <>
            <div className="pointer-events-none absolute z-[24] overflow-hidden" style={{ left: headW, right: 0, top: TOOLBAR_H, bottom: H_SCROLL_H }}>
              <div
                data-timeline-range=""
                className="absolute inset-y-0 left-0 border-x"
                style={{
                  transform: `translate3d(${fromX}px,0,0)`,
                  width,
                  borderColor: 'var(--tl-accent)',
                  background: 'color-mix(in srgb, var(--tl-accent) 13%, transparent)',
                }}
              >
                <div className="absolute inset-x-0 top-0" style={{ height: RULER_H, background: 'color-mix(in srgb, var(--tl-accent) 28%, transparent)' }} />
              </div>
            </div>
            {/* pinned to the view's left while the band starts before it */}
            {fromX + width > 0 ? (
              <div className="pointer-events-none absolute z-[36] overflow-hidden" style={{ left: headW, right: 0, top: TOOLBAR_H + RULER_H + 3, height: 20 }}>
                <div
                  draggable={Boolean(rangeRef && range && !rangeDraft)}
                  title={rangeRef ? t('host.rangeDrag') : undefined}
                  onDragStart={(e) => {
                    if (!rangeRef || !range) return;
                    e.dataTransfer.setData(STUDIO_REF_TYPE, JSON.stringify([rangeRef(range)]));
                    e.dataTransfer.setData('text/plain', label);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  className={`absolute top-0 whitespace-nowrap rounded-[4px] px-1.5 py-[2px] text-[10.5px] font-medium leading-[15px] text-white tabular-nums shadow-[0_1px_4px_rgba(0,0,0,.25)] ${rangeRef ? 'pointer-events-auto cursor-grab active:cursor-grabbing' : ''}`}
                  style={{ left: Math.max(4, fromX + 4), background: 'var(--tl-accent)' }}
                >
                  {label}
                </div>
              </div>
            ) : null}
          </>
        );
      })() : null}

      <SelectionToolbar
        selection={barKey}
        measure={measureBar}
        hidden={playing || scrubbing || Boolean(marquee || rangeDraft || drag.preview || laneOrder || assetHint)}
        lead={barLead}
        {...(barLabel ? { label: barLabel } : {})}
        tools={barTools}
        ariaLabel={t('selectionBar.toolbar')}
      />

      {/* the context menu; with no items (read-only) the browser's own menu shows instead of an empty box */}
      {menu && menuItems.length ? (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />
      ) : null}
    </div>
  );
});

/** A length as the label beside a trim says it: signed, in seconds to the hundredth (`+0.40 s`, `−1.20 s`). */
function signedSeconds(ms: number): string {
  const s = (Math.abs(ms) / 1000).toFixed(2);
  return `${ms < 0 ? '\u2212' : '+'}${s} s`;
}

/** The label beside the edge in hand while trimming, rolling, slipping or sliding: what, how far, how long now. */
function GestureLabel({ tip, left, top }: { tip: GestureTip; left: number; top: number }) {
  const t = useT();
  const what = t(`timeline.tip.${tip.kind}`);
  return (
    <div
      data-gesture-tip={tip.kind}
      className="pointer-events-none absolute z-[70] -translate-x-1/2 whitespace-nowrap rounded-[4px] px-1.5 py-[2px] text-[10.5px] font-medium leading-[15px] text-white tabular-nums shadow-[0_1px_4px_rgba(0,0,0,.35)]"
      style={{ left, top: Math.max(0, top - 21), background: 'var(--tl-accent)' }}
    >
      {what} {signedSeconds(tip.deltaMs)}
      {tip.lengthMs != null ? <span className="opacity-75"> · {(tip.lengthMs / 1000).toFixed(2)} s</span> : null}
    </div>
  );
}

/**
 * The playhead's knob: flat on top, round at the bottom like a pin's head — it points down at the line, which leaves
 * from the bottom of the curve. A capsule would have no direction.
 */
function PlayheadKnob({ filled }: { filled: boolean }) {
  /* no taller than the ruler (20 px): the layer clips, and anything above its top is cut */
  return (
    <svg width="12" height="17" viewBox="0 0 12 17" aria-hidden="true">
      <path
        d="M1.9 3.4a2 2 0 0 1 2-2h4.2a2 2 0 0 1 2 2v5.3a4.1 4.1 0 0 1-8.2 0z"
        fill={filled ? 'var(--tl-playhead)' : 'var(--tl-ruler)'}
        stroke="var(--tl-playhead)"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The CC mark, the same shape as the player's captions button: one thing, one look. */
/** A toggle on a track head. Its press does not bubble (it would start a track reorder). */
function TrackHeadButton({
  label,
  active,
  disabled,
  onToggle,
  children,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onPointerDown={(e) => {
          /* no focus on press: Space plays, and a focused button would show a ring and toggle again */
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          (e.currentTarget as HTMLButtonElement).blur();
          if (!disabled) onToggle();
        }}
        className="flex h-full w-full items-center justify-center rounded-[4px] bg-transparent outline-none ring-0 transition-colors hover:bg-[var(--bg-hover)] focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 disabled:hover:bg-transparent"
        style={{
          color: disabled ? 'var(--text-faint)' : active ? 'var(--tl-accent)' : 'var(--text-dim)',
        }}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** The "Edit history" button: keeps its own open state and anchor. */
function OpsButton({
  ops, onRollback,
}: { ops: SessionTimeline; onRollback: (cursor: number) => void }) {
  const t = useT();
  const box = React.useRef<HTMLDivElement | null>(null);
  const [at, setAt] = React.useState<DOMRect | null>(null);
  return (
    <div ref={box} className="flex items-center">
      <ToolButton
        onClick={() => setAt((open) => (open ? null : box.current?.getBoundingClientRect() ?? null))}
        label={t('history.opsTitle')}
        active={at !== null}
      >
        <ListRestart size={16} />
      </ToolButton>
      {at ? (
        <OperationHistory
          ops={ops}
          anchor={at}
          trigger={box.current}
          onRollback={onRollback}
          onClose={() => setAt(null)}
        />
      ) : null}
    </div>
  );
}

function ToolButton({
  onClick,
  disabled,
  label,
  hint,
  active = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  /** The shortcut, already formatted by shortcutHint (⌘ on Mac, Ctrl elsewhere); shown as `Label (⌘Z)`. */
  hint?: string;
  /** Pressed state: a toggle that is on. */
  active?: boolean;
  children: React.ReactNode;
}) {
  const title = hint ? `${label} (${hint})` : label;
  return (
    <Tooltip side="bottom" label={label} {...(hint ? { shortcut: hint } : {})}>
      <button
        type="button"
        onClick={() => { if (!disabled) onClick(); }}
        /* a mouse click leaves no focus: otherwise the next Space presses this button (and shows a focus ring)
           instead of playing. Keyboard focus is unaffected. */
        onMouseDown={(e) => e.preventDefault()}
        /* aria-disabled, not disabled: a disabled button gets no mouse events and so no tooltip, and a disabled
           button's tooltip ("why can't I") is the one most needed */
        aria-disabled={disabled}
        aria-label={title}
        aria-pressed={active}
        /* no focus outline after a click; focus-visible still shows for keyboard users */
        className={`flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[6px] outline-none transition focus-visible:ring-1 focus-visible:ring-[var(--tl-accent)] ${
          disabled ? 'cursor-default' : ''
        } ${active || disabled ? '' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}
        style={active
          ? { color: '#fff', background: 'var(--tl-accent)' }
          : { color: disabled ? 'var(--text-faint)' : 'var(--text-dim)' }}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** Visibility stays in the toolbar; appearance is edited in the Inspector. */
function SubtitlePicker({ subtitles }: { subtitles: NonNullable<TimelineProps['subtitles']> }) {
  const t = useT();
  const none = subtitles.count === 0;
  const n = subtitles.untranscribed ?? 0;
  /* no lines yet and speech with no transcript: the button makes them (with some lines, it shows them, and the
     Inspector makes the rest) */
  const make = none && n > 0 && !!subtitles.onMake;
  const label = subtitles.making ? t('timeline.subtitlesMaking')
    : subtitles.problem ? (subtitles.problem.connect ? t('timeline.subtitlesConnect') : t('timeline.subtitlesFailed').replace('{error}', subtitles.problem.text))
      : make ? t(n === 1 ? 'timeline.subtitlesMakeOne' : 'timeline.subtitlesMake').replace('{n}', String(n))
        : !none ? t('timeline.subtitles') : t('timeline.subtitlesNone');
  return (
    <div className="flex items-center gap-0.5">
      <ToolButton onClick={make || subtitles.problem ? () => subtitles.onMake?.() : subtitles.onToggle} active={subtitles.on && !none && !make} disabled={subtitles.making || (none && !make && !subtitles.problem)}
        label={label}>
        <CaptionsIcon size={19} />
      </ToolButton>
      <Tooltip side="bottom" label={t('timeline.subtitleStyle')}>
        <button type="button" onClick={subtitles.onConfigure}
          aria-label={t('timeline.subtitleStyle')} aria-expanded={!!subtitles.configuring}
          className={`flex h-6 w-4 shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--text-muted)] ${subtitles.configuring ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
          <ChevronUp size={12} aria-hidden className={`transition-transform ${subtitles.configuring ? 'rotate-180' : ''}`} />
        </button>
      </Tooltip>
    </div>
  );
}

/** What the pointer does on the timeline. */
export type TimelineMode = 'select' | 'split';

/**
 * Select / split — a button and a dropdown. Split is a mode, not only a button: a rough cut is a dozen cuts in a row,
 * and the pointer becoming a blade beats select-then-split each time.
 */
function ModePicker({
  mode, onPick,
}: { mode: TimelineMode; onPick: (m: TimelineMode) => void }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);

  const items: { id: TimelineMode; label: string; key: string; icon: React.ReactNode }[] = [
    { id: 'select', label: t('timeline.modeSelect'), key: 'A', icon: <MousePointer2 size={16} /> },
    { id: 'split', label: t('timeline.modeSplit'), key: 'B', icon: <SplitSquareHorizontal size={16} /> },
  ];
  const current = items.find((i) => i.id === mode) ?? items[0]!;

  return (
    <div className="relative flex items-center">
      {/* no active background: the cursor and the blade line already say split mode is on, and the icon changes.
          The button toggles between modes; its tooltip names the mode it switches to, with that mode's key. */}
      <ToolButton
        onClick={() => onPick(mode === 'split' ? 'select' : 'split')}
        label={mode === 'split' ? t('timeline.modeSelect') : t('timeline.modeSplit')}
        hint={mode === 'split' ? 'A' : 'B'}
      >
        {current.icon}
      </ToolButton>
      {/* Popover closes on pointerdown in the capture phase: timeline gestures preventDefault their pointerdown,
          which suppresses mousedown, so a mousedown listener would never hear them. Esc closes too. */}
      <Popover
        open={open}
        onOpenChange={setOpen}
        placement="bottom"
        align="start"
        trigger={
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex h-[28px] w-[15px] shrink-0 items-center justify-center rounded-[6px] transition hover:bg-black/5 dark:hover:bg-white/10"
            style={{ color: 'var(--text-dim)' }}
            aria-label={current.label}
          >
            <ChevronDown size={12} />
          </button>
        }
      >
        <div
          className="min-w-[150px] rounded-[8px] border p-1 shadow-lg"
          style={{ background: 'var(--tl-head)', borderColor: 'var(--tl-line)' }}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => { onPick(item.id); setOpen(false); }}
              className="flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-[12px] transition hover:bg-black/5 dark:hover:bg-white/10"
              style={{
                color: 'var(--tl-text)',
                /* the current row: --tl-line (a gray in both themes; translucent white vanishes on light) */
                background: item.id === mode ? 'var(--tl-line)' : undefined,
              }}
            >
              {item.icon}
              <span className="flex-1 text-left">{item.label}</span>
              <span style={{ color: 'var(--tl-faint)' }}>{item.key}</span>
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

/**
 * The playhead line — while playing it follows the clock itself, outside React.
 *
 * The clock ticks at 20 Hz; drawn tick by tick the line jumps, zoomed in by a dozen pixels. Each frame it moves on
 * from the last tick by the time since, and lines up at the next tick; when a new tick is slightly behind what was
 * drawn, it waits instead of stepping back.
 *
 * Follow-scroll happens here too: out of view, the timeline pages (the playhead at 10% from the left) rather than
 * recentring every step, which would slide constantly. For a while after the user scrolls, it does not follow.
 */
function PlayheadTrack({
  clock,
  animate,
  x,
  pxPerMs,
  totalMs,
  scrollRef,
  children,
}: {
  clock: PlaybackClock | null | undefined;
  /** Playing and not scrubbing: the line moves itself. Otherwise it is drawn at `x`. */
  animate: boolean;
  /** Where the line is when not moving itself (scroll already taken off). */
  x: number;
  pxPerMs: number;
  totalMs: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const live = Boolean(clock) && animate;

  React.useLayoutEffect(() => {
    if (live || !ref.current) return;
    ref.current.style.transform = `translate3d(${x}px,0,0)`;
  }, [live, x]);

  React.useEffect(() => {
    if (!live || !clock) return undefined;
    const scroller = scrollRef.current;
    let tick = { ms: clock.get(), at: performance.now() };
    let shown = tick.ms;
    let userAt = -Infinity;
    const off = clock.subscribe(() => { tick = { ms: clock.get(), at: performance.now() }; });
    const onUser = () => { userAt = performance.now(); };
    scroller?.addEventListener('wheel', onUser, { passive: true });
    scroller?.addEventListener('pointerdown', onUser, { passive: true });
    let raf = 0;
    const frame = (now: number) => {
      let ms = Math.min(tick.ms + Math.min(now - tick.at, 120), totalMs);
      /* a new tick slightly behind what was drawn: wait, do not step back. Far behind (a seek, a loop): follow it. */
      if (ms < shown && shown - ms < 80) ms = shown;
      shown = ms;
      const el = scrollRef.current;
      const scrollLeft = el?.scrollLeft ?? 0;
      const px = ms * pxPerMs;
      if (el && now - userAt > 1500 && pxPerMs > 0) {
        if (px < scrollLeft + FOLLOW_EDGE || px > scrollLeft + el.clientWidth - FOLLOW_EDGE) {
          el.scrollLeft = Math.max(0, px - el.clientWidth * 0.1);
        }
      }
      if (ref.current) {
        ref.current.style.transform = `translate3d(${px - (el?.scrollLeft ?? scrollLeft) + PLAYHEAD_BLEED}px,0,0)`;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      off();
      scroller?.removeEventListener('wheel', onUser);
      scroller?.removeEventListener('pointerdown', onUser);
    };
  }, [live, clock, pxPerMs, totalMs, scrollRef]);

  return (
    <div ref={ref} className="absolute inset-y-0 left-0 will-change-transform" style={{ width: 1 }}>
      {children}
    </div>
  );
}

/**
 * Auto-scroll while scrubbing or drawing a marquee near the track area's left or right edge (moving clips has its
 * own, see useBlockDrag): faster nearer the edge; each step calls back so the caller recomputes the time under the
 * pointer.
 */
const EDGE_SCROLL_PX = 40;
function edgeAutoScroll(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  onScrolled: () => void,
): { at: (clientX: number) => void; stop: () => void } {
  let x = 0;
  let raf = 0;
  const step = (): void => {
    raf = 0;
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let d = 0;
    if (x < rect.left + EDGE_SCROLL_PX) d = -Math.ceil(6 + 18 * Math.min(1, (rect.left + EDGE_SCROLL_PX - x) / EDGE_SCROLL_PX));
    else if (x > rect.right - EDGE_SCROLL_PX) d = Math.ceil(6 + 18 * Math.min(1, (x - (rect.right - EDGE_SCROLL_PX)) / EDGE_SCROLL_PX));
    if (!d) return;
    const next = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + d));
    if (next === el.scrollLeft) return;
    el.scrollLeft = next;
    onScrolled();
    raf = requestAnimationFrame(step);
  };
  return {
    at(clientX: number) {
      x = clientX;
      if (!raf) raf = requestAnimationFrame(step);
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
