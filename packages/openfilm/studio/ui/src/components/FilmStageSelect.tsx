/**
 * Pointing at things in the picture: hover outlines, click and marquee selection, the transform handles, nudging,
 * typing a line in place, and the context menus.
 *
 * Two kinds of selection, each with its own way in:
 *
 * A **whole clip** (a frame with handles: move, scale, turn) is selected on the **timeline**: one block selected there
 * is in hand here. Clicking the picture does not pick a clip up, so pressing and dragging on the picture is never
 * "drag a clip away" and the marquee has somewhere to happen.
 *
 * A **layer inside a clip** is selected on the **picture**: with no clip in hand, the layer under the pointer (a line
 * of text, a picture, an SVG shape, a box that paints) is outlined; a click selects it and the inspector shows its
 * sections. Where several are stacked the smallest wins (the word, not the card); Alt-click again goes one down.
 * Empty shells that only place things are passed over.
 *
 * With nothing in hand, pressing and dragging draws a marquee; a click and a marquee part only when the pointer is let
 * go (further than the threshold: a marquee). Esc drops the selection.
 *
 * With ⌘ held (Ctrl on Windows), when the app around Studio has a chat (`onRegion`), a box drawn on the picture points
 * at that part of it in the chat instead: nothing is selected, the box flashes and is handed on with what is in it.
 *
 * A whole clip's frame, its handles and its snapping go by the part of it that shows (what its crop leaves). A video or
 * still in hand is cropped in place (C, a double-click on it, or the inspector's Crop): the whole picture shows with
 * what is cut away darkened, the crop's handles move its edges, a drag inside pans; Enter keeps it (written once, as
 * the clip's own `clip-path: inset(…)` and `object-position`), Esc gives it up.
 *
 * With something in hand, holding Alt over another clip or layer measures the distances to it (over nothing, or over
 * itself, to the stage's edges).
 *
 * The film runs on its own origin: everything about its DOM (what is under a point, where a layer is drawn, showing
 * a change before it is kept, the in-place text box) is asked of the film's stage through the picture's handle
 * (Preview `stage`, studio/server/stage.js). Hover asks at most once a frame, one question at a time, the latest
 * point winning. What is written is always film.html: a clip's `box`, a page's `overrides`, through the callbacks.
 */
import * as React from 'react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, Crop as CropIcon, MessageSquarePlus,
  MoreHorizontal, SquareDashed,
} from 'lucide-react';

import { ContextMenu, type ContextMenuEntry, type ContextMenuItem } from '@/components/ContextMenu';
import { SelectionToolbar, type SelectionToolEntry } from '@/components/SelectionToolbar';
import { MgOutline } from '@/components/MgOutline';
import { FRAME_BLUE, GestureHint, StageTransformFrame, type FrameGeometry } from '@/components/StageTransformFrame';
import { StageMaskOverlay } from '@/components/StageMaskOverlay';
import { linkedOutlines } from '@/components/film-stage-hit';
import type { StageArrange, StageArrangeResult, StageMenuContext } from '@/components/stage-menu';
import type { PreviewHandle, StageEvent } from '@/editor/Preview';
import { useT } from '@/i18n';
import { cropOf, declared, pxOf, type ClipLook, type Crop } from '@/lib/clip-look';
import { filmClipKind, filmDocLoc, filmSrcKind, parseFilmDocLoc, type FilmBox, type FilmDoc } from '@/lib/film';
import type { OverrideGeometry } from '@/lib/film-overrides';
import type { ClipSpan } from '@/lib/film-shape';
import {
  mgSize, moveTransform, rotateTransform, sameMgTransform, snapMove, type MgBox, type MgGuide, type MgTransform,
} from '@/lib/mg-transform';
import { compactBox, transformOf } from '@/lib/stage-clip';
import {
  aspectRatio, CROP_ASPECTS, cropOfRect, cropPreviewCss, croppedCss, cropRect, draggedCrop, fitAspect, frameAabb, pannedCrop,
  positionOf, roundOf, transformOfVisible, visibleFrame, type CropAspect, type Rect,
} from '@/lib/stage-crop';
import {
  alignShift, HANDLE_AT, insideBox, insideFrame, movedOffset, pivotCenter, resizedFrame, sameClientRect, sameGuides,
  sameLayerGeometry, scaledLayer, turnedLayer, unionRect, type AlignEdge, type ClientBox, type FramePivot,
  type LayerGeometry, type StageFrame,
} from '@/lib/stage-gesture';
import { measureGaps, type MeasureLine } from '@/lib/stage-measure';
import type { MaskSession } from '@/lib/stage-mask';
import { layerTarget } from '@/lib/stage-layers';
import { regionBox, regionClipIds, regionTexts } from '@/lib/studio-refs';
import type { StageBox } from '@/lib/host';
import { samePictureMarks, type PictureMarks } from '@/lib/chat-marks';
import { distributeShifts } from '@/lib/selection-toolbar';
import { shortcutHint } from '@/lib/shortcut-hint';
import { trackLockedAt } from '@/lib/track-lock';
import {
  compactScale, type NodeOverride, type StageElement, type StageElementStyle, type StageGeometry, type StageNodeKind,
  type StageNodeParent,
} from '@/lib/stage-types';

export type { LayerGeometry } from '@/lib/stage-gesture';

/** Pulled open this far (stage px, both ways) it is a marquee; less is a click (a shaky hand keeps its click). */
const MARQUEE_MIN_PX = 8;
const PICK_BLUE = FRAME_BLUE;
/** Two presses this close in time are one double-click (the system's own interval is about this). */
const DOUBLE_PRESS_MS = 500;
/** Snap this close (screen px: the feel must not change with the picture's scale). */
const SNAP_PX = 6;
const NO_GUIDES: readonly MgGuide[] = [];
/** A selected layer lost in a redraw is let go after this long without finding it again. */
const LOST_PICK_GRACE_MS = 1200;
/** The selection is measured again each time the playhead enters another half second. */
const STALE_BUCKET_MS = 500;
const staleBucket = (timeMs: number): number => Math.round(timeMs / STALE_BUCKET_MS);
/* the key a region is drawn with: ⌘ on a Mac (its Ctrl-click is a right click), Ctrl elsewhere */
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const REGION_KEY = MAC ? 'Meta' : 'Control';
const regionKeyHeld = (e: { metaKey: boolean; ctrlKey: boolean }) => (MAC ? e.metaKey : e.ctrlKey);
/** Arrow keys write what they moved this long after the last one (held down they come thirty a second). */
const NUDGE_WRITE_MS = 350;
const NO_CROP: Crop = [0, 0, 0, 0];
/** Figma's measuring red: distances held apart from the selection's blue. */
const MEASURE_RED = '#f24822';

/** A layer as the film's stage describes it (studio/server/stage.js `describe`); boxes in stage px. */
export interface StageLayer {
  handle: number;
  clip: string;
  at: string;
  n?: number;
  loc: string;
  instance?: number;
  instances?: number;
  kind: StageNodeKind;
  tag: string;
  label: string;
  text?: { value: string; shape: 'children' | 'prop' | 'value' };
  style: StageElementStyle;
  parents: StageNodeParent[];
  override: NodeOverride | null;
  group: boolean;
  locked: boolean;
  svg: boolean;
  rect: ClientBox;
  frame: StageFrame;
  geo: {
    /** The override geometry painted now. */
    g: LayerGeometry;
    /** Stage px per override px. */
    k: number;
    /** How far the layers around it are turned (the clip included), degrees. */
    parentR: number;
    /** Its turn besides its own override's (its own transform, its parents', the clip's), degrees. */
    around: number;
    /** z-index that restacks it to the front / back; null when it is not positioned. */
  };
}

/** Just where a hovered layer is. */
interface StageOutline {
  handle: number;
  rect: ClientBox;
  frame?: StageFrame;
}

/** A clip's edit from the stage: its film.html `box`, or its own CSS (`style`: a crop). */
export interface StageClipEdit {
  loc: string;
  prop: 'box' | 'style';
  value: FilmBox | string | null;
}

/** What the inspector needs of the stage while the editor wires it (see FilmStageSelect's `controlRef`). */
export interface FilmStageControl {
  /** Show style keys on a layer before they are kept (`null` takes a key back to the page's own). */
  previewStyle(element: StageElement, patch: StageElementStyle | Record<string, string | number | null>): void;
  /** Show a layer's words before they are kept. */
  previewText(element: StageElement, value: string): void;
  /**
   * Show a layer's move / scale / turn before it is kept. With `pivot` the offset is worked out so that point of its
   * box stays put (CSS scales and turns about its unmoved box), and returned with the patch, to be written so.
   */
  previewOverride(element: StageElement, patch: OverrideGeometry, pivot?: FramePivot): Promise<OverrideGeometry>;
  /** Stop showing what was not kept on the element's clip (an edit was refused). */
  release(element: StageElement): void;
  /** The layer read again (its style after an override was taken away). */
  describe(element: StageElement): Promise<StageElement | null>;
  /** Measure the selection again (something else changed the picture). */
  refresh(): void;
  /** Crop the video or still in hand in place (the inspector's Crop); false when nothing there can be. */
  startCrop(): boolean;
  /** The inspector's Mask › Edit on picture: the mask's handles over the thing it is for, while that is in hand. */
  editMask(session: MaskSession | null): void;
  /** What is in hand on the picture (each of several layers, a layer, a whole clip), where it is drawn (stage px). */
  picked(): StagePick[];
  /** Write now what the arrow keys moved and is not written yet: before an undo, or any other edit. */
  flushPending(): void;
}

/** One thing in hand on the picture, for a reference: what it is, and its box (stage px) when it is a layer. */
export interface StagePick { element: StageElement; box: StageBox | null }

interface Hit {
  /** Stage px. */
  rect: ClientBox;
  label?: string;
  /** None for a marquee that boxed no layer. */
  element?: StageElement;
  /** The film's description of a selected layer (none for a clip). */
  layer?: StageLayer;
}

interface MultiItem { layer: StageLayer; element: StageElement }

interface LinkedMark { loc: string; t: MgTransform; box: MgBox }
const NO_MARKS: readonly LinkedMark[] = [];
/** What the app's chat points at, on the picture: the timeline's accent, apart from the selection's blue. */
const CHAT_TONE = 'var(--tl-accent)';

function sameLinkedMarks(a: readonly LinkedMark[], b: readonly LinkedMark[]): boolean {
  return a.length === b.length && a.every((m, i) => {
    const other = b[i]!;
    return m.loc === other.loc && m.box.w === other.box.w && m.box.h === other.box.h
      && (m.box.x ?? 0) === (other.box.x ?? 0) && (m.box.y ?? 0) === (other.box.y ?? 0) && sameMgTransform(m.t, other.t);
  });
}

const scaleBox = (b: ClientBox, k: number): ClientBox => ({ left: b.left * k, top: b.top * k, width: b.width * k, height: b.height * k });
const scaleFrame = (f: StageFrame, k: number): StageFrame => ({ cx: f.cx * k, cy: f.cy * k, w: f.w * k, h: f.h * k, r: f.r });

const clientOf = (r: Rect): ClientBox => ({ left: r.x, top: r.y, width: r.w, height: r.h });

/**
 * A picture clip as film.html and the preview's spans have it: `box` is its picture's own size, once known; `crop`
 * what its clip-path leaves showing.
 */
interface ClipInfo { loc: string; id: string; kind: 'mg' | 'video'; t: MgTransform; box: MgBox | null; crop: Crop }

/** Where a clip is before its picture's size is known: nowhere to hold it by. */
const UNMEASURED: MgTransform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0 };

/** `live`: CSS the inspector shows on it, not kept yet, while film.html's style is still the one it was shown over. */
function clipInfo(
  doc: FilmDoc, spans: readonly ClipSpan[], stage: { w: number; h: number }, loc: string, live?: { css: string; written: string } | null,
): ClipInfo | null {
  const at = parseFilmDocLoc(loc);
  const clip = at ? doc.tracks[at.track]?.clips[at.clip] : undefined;
  if (!clip) return null;
  const kind = filmClipKind(clip);
  if (kind === 'audio') return null;
  const span = spans.find((s) => s.id === clip.id);
  const own = span?.w && span.h ? { w: span.w, h: span.h } : null;
  const style = live && live.written === (clip.style ?? '') ? live.css : clip.style ?? '';
  return {
    loc, id: clip.id, kind, t: own ? transformOf(filmSrcKind(clip.src), own, stage, clip.box) : UNMEASURED, box: own, crop: cropOfStyle(style, span?.look),
  };
}

/** What a clip's crop leaves (clip-look): its own `clip-path`, else the film's CSS's; another shape is no crop here. */
function cropOfStyle(style: string, look: ClipLook | undefined): Crop {
  return cropOf(declared(style, 'clip-path') ?? look?.clip) ?? NO_CROP;
}

/** A clip's written box as JSON ('null' without one), to tell when film.html's place for it changed. */
function writtenBoxOf(doc: FilmDoc, loc: string): string {
  const at = parseFilmDocLoc(loc);
  return JSON.stringify((at ? doc.tracks[at.track]?.clips[at.clip]?.box : undefined) ?? null);
}

function clipLocOf(doc: FilmDoc, id: string): string | undefined {
  for (const [ti, track] of doc.tracks.entries()) {
    const ci = track.clips.findIndex((c) => c.id === id);
    if (ci >= 0) return filmDocLoc(ti, ci);
  }
  return undefined;
}

/** A whole clip in hand: its box is the part that shows. */
function describeClip(info: ClipInfo, stage: { w: number; h: number }): Hit {
  const aabb = info.box ? frameAabb(visibleFrame(info.t, info.box, info.crop)) : { x: 0, y: 0, w: stage.w, h: stage.h };
  const element: StageElement = {
    kind: 'clip',
    loc: null,
    label: info.id,
    clipLoc: info.loc,
    clipId: info.id,
    clipKind: info.kind,
    isMgOuter: true,
    transform: info.t,
    ...(info.box ? { mgBox: info.box } : {}),
  };
  return { rect: { left: aabb.x, top: aabb.y, width: aabb.w, height: aabb.h }, label: element.label, element };
}

/**
 * One question at a time, the latest waiting one next (the ones it replaced are dropped): hover, drag painting and
 * re-measuring ask the film often, and must never queue up behind each other.
 */
class Latest<A> {
  private busy = false;
  private next: { a: A } | null = null;
  private waiting: (() => void)[] = [];
  constructor(private readonly run: (a: A) => Promise<void>) {}
  push(a: A): void { this.next = { a }; void this.pump(); }
  /** Resolves once nothing is running or waiting. */
  idle(): Promise<void> { return !this.busy && !this.next ? Promise.resolve() : new Promise((done) => { this.waiting.push(done); }); }
  private async pump(): Promise<void> {
    if (this.busy) return;
    while (this.next) {
      const { a } = this.next;
      this.next = null;
      this.busy = true;
      try { await this.run(a); } catch { /* a question that failed is not asked again */ }
      this.busy = false;
    }
    const waiting = this.waiting;
    this.waiting = [];
    for (const done of waiting) done();
  }
}

interface FilmStageSelectProps {
  /** The picture: the stage's questions go through its handle. */
  previewRef: React.RefObject<PreviewHandle | null>;
  /** The film's own size: everything asked of the film is in its px. */
  stage: { w: number; h: number };
  /** film.html now: clips' boxes and places. */
  doc: FilmDoc;
  /** Where each clip sits and its source's size, as the preview reports (a clip's box needs it). */
  spans: readonly ClipSpan[];
  /** Now (ms). Only its half-second bucket is looked at (see the memo below): a change re-measures the selection. */
  timeMs: number;
  playing?: boolean;
  /** Pressing the picture pauses: selecting something that moves is a contradiction. */
  onPause?: () => void;
  /** The selection changed: a layer clicked, the clip from the timeline in hand, or nothing (null). */
  onSelectElement?: (element: StageElement | null) => void;
  /** A whole clip moved / scaled / turned on the stage: its box written. Refused: an error message. */
  onEditClip?: (edits: StageClipEdit[]) => Promise<string | null>;
  /** The clips selected elsewhere (`film.html#<track>.<clip>`): one is in hand here, several are outlined. */
  linkedLocs?: readonly string[];
  /**
   * Select the layer at `loc` in the clip at `clipLoc` (the inspector's breadcrumb, the menu's Select parent). `seq`
   * goes up each time, so the same layer can be asked for twice.
   */
  selectRequest?: { loc: string; clipLoc?: string; seq: number } | null;
  /**
   * Set here: shows the clip in hand with a transform patch while the inspector drags its X / Y / scale / turn (null:
   * its own again). Only the clip in hand can be shown.
   */
  clipPreviewRef?: React.MutableRefObject<((clipLoc: string, patch: Partial<MgTransform> | null) => void) | null>;
  /** Filled here: shows a clip in CSS of its own not kept yet (null: its own again), as the inspector drags a value. */
  lookPreviewRef?: React.MutableRefObject<((clipLoc: string, css: string | null) => void) | null>;
  /** Set here: what the inspector needs of the stage (see FilmStageControl). */
  controlRef?: React.MutableRefObject<FilmStageControl | null>;
  /** The layer in hand was dragged / nudged / scaled / turned: its override `{ t, s, r }` written. Refused: a message. */
  onTransformLayer?: (element: StageElement, next: LayerGeometry) => Promise<string | null>;
  /** Several layers moved or aligned together: written in one go (one undo step). */
  onTransformLayers?: (list: ReadonlyArray<{ element: StageElement; g: LayerGeometry }>) => void;
  /** A line typed in place: its words written. Refused: a message (the words go back). */
  onEditTextInline?: (element: StageElement, value: string) => Promise<string | null>;
  /** Where the thing in hand is now (stage px), for the inspector's X / Y / W / H / turn; reported when it changes. */
  onGeometry?: (geometry: StageGeometry | null) => void;
  /** The context menu's entries for what was right-clicked (see components/stage-menu). */
  menuFor?: (element: StageElement, ctx: StageMenuContext) => readonly ContextMenuEntry[];
  /** Show… / Unlock… for layers that cannot be clicked, after every menu. */
  recoveryMenu?: () => readonly ContextMenuEntry[];
  /**
   * A box drawn with ⌘ held (stage px): the picture clips showing there and the words of the layers wholly inside it.
   * Without it ⌘ does nothing of its own here.
   */
  onRegion?: (region: { box: StageBox; clipIds: string[]; texts: string[] }) => void;
  /** Said beside the pointer while ⌘ is held over the picture (with `onRegion`). */
  regionHint?: string;
  /** A box to flash on the picture (the app showing a region it was pointed at); `seq` goes up each time. */
  flashBox?: { box: StageBox; seq: number } | null;
  /**
   * What the app's chat points at on the picture shown (lib/chat-marks): the clip or the box of the pill hovered
   * there, outlined, and the boxes of the message being written, each with its number in a corner.
   */
  chat?: PictureMarks | null;
  /** The pointer came onto a layer of a page (where it is drawn, stage px), or left it (null). */
  onHoverLayer?: (hit: { element: StageElement; box: StageBox } | null) => void;
  /** The bar beside what is in hand (SelectionToolbar) is the picture's: the person is working here, not on the timeline. */
  selectionBar?: boolean;
  /** The bar's first button, "Add to chat": what is in hand. Without it the bar has no such button. */
  onRefer?: (picks: StagePick[]) => void;
  /** The bar's Mask: the inspector's Mask section, for the clip in hand. */
  onStartMask?: () => void;
  /** A layer pointed at from elsewhere (a row of the Layers panel), outlined as the one under the pointer is. */
  pointLayer?: { clipId: string; loc: string } | null;
  /**
   * The picture has the keyboard: the arrow keys move what is in hand (1 px, ⇧ 10). Without it they are the
   * playhead's, whatever is in hand.
   */
  arrowsMove?: boolean;
}

function FilmStageSelectImpl({
  previewRef, stage, doc, spans, timeMs, playing, onPause, onSelectElement, onEditClip, linkedLocs, selectRequest,
  clipPreviewRef, lookPreviewRef, controlRef, onTransformLayer, onTransformLayers, onEditTextInline, onGeometry, menuFor, recoveryMenu,
  onRegion, regionHint, flashBox, chat, onHoverLayer, selectionBar = false, onRefer, onStartMask, pointLayer, arrowsMove = true,
}: FilmStageSelectProps) {
  const arrowsMoveRef = React.useRef(arrowsMove);
  arrowsMoveRef.current = arrowsMove;
  const flushPendingRef = React.useRef<() => void>(() => {});
  const host = React.useRef<HTMLDivElement | null>(null);
  const [picked, setPickedState] = React.useState<Hit | null>(null);
  const pickedRef = React.useRef<Hit | null>(null);
  /** Kept in step at once (a handler running right after a set must see it), drawn on the next render. */
  const setPicked = React.useCallback((next: Hit | null | ((cur: Hit | null) => Hit | null)) => {
    const value = typeof next === 'function' ? next(pickedRef.current) : next;
    pickedRef.current = value;
    setPickedState(value);
  }, []);
  /** The layer under the pointer (only with no clip in hand). Stage px. */
  const [hover, setHover] = React.useState<StageOutline | null>(null);
  const [draft, setDraft] = React.useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  /** The marquee's own copy: a press and a release can land in one batch of updates, so decisions never read state. */
  const draftRef = React.useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  /** Layers (by loc) whose override was just written and is not in film.html yet. */
  const committing = React.useRef(new Set<string>());
  /** Since when the selected layer could not be found (see syncPick). */
  const lostSince = React.useRef<number | null>(null);
  const gestureRef = React.useRef<{
    kind: 'move' | 'scale' | 'rotate';
    /** A scale's handle: its place in the frame (see HANDLE_AT); an edge's has one axis. */
    handle?: FramePivot;
    /** A video or still: its box takes any proportions (its CSS fits the picture in it); a page's never does. */
    stretchable: boolean;
    pendingClick?: boolean;
    start: { x: number; y: number };
    origin: MgTransform;
    /* the picture's own size: the numbers in hand are its multiples */
    box: MgBox;
    /** What its crop leaves: the frame it is held by. */
    crop: Crop;
    clipLoc: string;
    clipId: string;
    hit?: { x: number; y: number };
    /** What a move or a scale can snap to (stage px), counted once at the press. */
    snapTargets: readonly { x: number; y: number; w: number; h: number }[];
  } | null>(null);
  const stageLayer = React.useRef<HTMLDivElement | null>(null);
  const [filmOffset, setFilmOffset] = React.useState({ left: 0, top: 0, width: 0, height: 0 });
  const liveTRef = React.useRef<MgTransform | null>(null);
  /** For an inspector preview in `liveT`: film.html's box of the clip when it began, as JSON. */
  const liveBoxRef = React.useRef<string | null>(null);
  const [liveT, setLiveT] = React.useState<MgTransform | null>(null);
  const [liveGuides, setLiveGuides] = React.useState<readonly MgGuide[]>(NO_GUIDES);
  /**
   * Something is being dragged: the hover outline and linked outlines are put away. Set once the drag passes its
   * threshold, not at the press (a click must not flash anything).
   */
  const [dragging, setDragging] = React.useState(false);
  /** Several layers selected together (marquee, Shift-click): `picked` is their union box. */
  const [multi, setMultiState] = React.useState<readonly MultiItem[] | null>(null);
  const multiRef = React.useRef<readonly MultiItem[] | null>(null);
  const setMulti = React.useCallback((next: readonly MultiItem[] | null) => {
    multiRef.current = next;
    setMultiState(next);
  }, []);
  /** Each press's number: an answer that comes after a later press is not acted on. */
  const pressSeq = React.useRef(0);
  /** The box being drawn with ⌘ held (screen px from the film's top left), and its own copy for the release. */
  const [regionDraft, setRegionDraft] = React.useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const regionDraftRef = React.useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  /** ⌘ held with the pointer over the picture: where the pointer is, for the hint (the cursor is a crosshair then). */
  const [modAt, setModAt] = React.useState<{ x: number; y: number } | null>(null);
  const pointerAt = React.useRef<{ x: number; y: number } | null>(null);
  /* ⌘ pressed or let go with the pointer resting on the picture sends no pointer move */
  React.useEffect(() => {
    if (!onRegion) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === REGION_KEY) setModAt(e.type === 'keydown' ? pointerAt.current : null);
    };
    const off = () => setModAt(null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', off);
    };
  }, [onRegion]);
  /** A region shown for a moment (stage px), then faded out. */
  const [flash, setFlash] = React.useState<{ box: StageBox; fading: boolean } | null>(null);
  const flashTimers = React.useRef<number[]>([]);
  const showFlash = React.useCallback((box: StageBox) => {
    for (const id of flashTimers.current) window.clearTimeout(id);
    setFlash({ box, fading: false });
    flashTimers.current = [
      window.setTimeout(() => setFlash((f) => (f ? { ...f, fading: true } : f)), 500),
      window.setTimeout(() => setFlash(null), 850),
    ];
  }, []);
  React.useEffect(() => () => { for (const id of flashTimers.current) window.clearTimeout(id); }, []);
  React.useEffect(() => {
    if (flashBox) showFlash(flashBox.box);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashBox?.seq, showFlash]);

  /* bring forward / send back, worked out in the page when asked (stage.js arrange) */
  const arrangeOf = (handle: number): StageArrange => (to) => ask<StageArrangeResult>('arrange', { handle, to });
  const ask = React.useCallback(<T,>(op: string, args: object = {}): Promise<T | null> => (
    previewRef.current?.stage?.<T>(op, args) ?? Promise.resolve(null)
  ), [previewRef]);

  const filmRect = (): DOMRect | null => previewRef.current?.frame?.()?.getBoundingClientRect() ?? host.current?.getBoundingClientRect() ?? null;
  const viewScaleNow = (): number => {
    const width = filmRect()?.width ?? stage.w;
    return width > 0 ? width / stage.w : 1;
  };
  /** Pointer → the film's top left in overlay px (the overlay may cover the letterbox; the origin is the film's). */
  const local = (e: { clientX: number; clientY: number }) => {
    const r = filmRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const docRef = React.useRef(doc);
  docRef.current = doc;
  /** A clip on a locked track: nothing of it is moved, scaled, turned, nudged, cropped or typed into here. */
  const lockedClip = (loc: string | null | undefined): boolean => trackLockedAt(docRef.current, loc);
  const spansRef = React.useRef(spans);
  spansRef.current = spans;
  /**
   * The inspector's look preview (a clip's CSS not kept yet) and film.html's style it was shown over: the frame follows
   * a crop being dragged there, and stops once film.html's style is another (kept, undone).
   */
  const [lookLive, setLookLive] = React.useState<{ clipLoc: string; css: string; written: string } | null>(null);
  const lookLiveRef = React.useRef(lookLive);
  lookLiveRef.current = lookLive;
  const infoOf = (loc: string) => {
    const live = lookLiveRef.current;
    return clipInfo(docRef.current, spansRef.current, stage, loc, live?.clipLoc === loc ? live : null);
  };
  /** Another clip as a snap or measuring target: the part its crop leaves (the film's stage tells whole boxes). */
  const shownBoxOf = (c: { id: string; x: number; y: number; w: number; h: number }): Rect => {
    const loc = clipLocOf(docRef.current, c.id);
    const info = loc ? infoOf(loc) : null;
    return info?.box && info.crop.some((n) => n > 0) ? frameAabb(visibleFrame(info.t, info.box, info.crop)) : { x: c.x, y: c.y, w: c.w, h: c.h };
  };

  const elementOf = React.useCallback((layer: StageLayer): StageElement => ({
    kind: layer.kind,
    loc: layer.loc,
    label: layer.label,
    clipId: layer.clip,
    ...(clipLocOf(docRef.current, layer.clip) ? { clipLoc: clipLocOf(docRef.current, layer.clip) } : {}),
    clipKind: 'mg',
    ...(layer.text ? { text: { loc: layer.loc, value: layer.text.value, shape: layer.text.shape } } : {}),
    tag: layer.tag,
    style: layer.style,
    declaredStyle: [],
    parents: layer.parents,
    override: layer.override,
    ...(layer.instance != null ? { instance: layer.instance, instances: layer.instances } : {}),
  }), []);
  const hitOf = React.useCallback((layer: StageLayer): Hit => ({ rect: layer.rect, label: layer.label, element: elementOf(layer), layer }), [elementOf]);

  /* ── in-place text editing state (the film runs the text box; it says when it ends) ── */
  const [editingText, setEditingTextState] = React.useState<string | null>(null);
  const textEdit = React.useRef<{ element: StageElement; layer: StageLayer } | null>(null);
  /** The last press on the picture, in stage px: a double-click is aimed by its first click (see onStageDoubleClick). */
  const lastPressRef = React.useRef<{ x: number; y: number; at: number } | null>(null);
  /* while a line is typed in place the picture takes the pointer (move the caret, select words, click away to blur) */
  const setEditingText = React.useCallback((loc: string | null) => {
    const frame = previewRef.current?.frame?.();
    if (frame) frame.style.pointerEvents = loc == null ? '' : 'auto';
    setEditingTextState(loc);
  }, [previewRef]);

  const dropPick = React.useCallback(() => {
    setMulti(null);
    gestureRef.current = null;
    liveTRef.current = null;
    liveBoxRef.current = null;
    setLiveT(null);
    setLiveGuides(NO_GUIDES);
    setDragging(false);
    setPicked(null);
  }, [setMulti, setPicked]);

  const commitHit = React.useCallback((hit: Hit | null) => {
    setMulti(null);
    setPicked(hit);
    onSelectElement?.(hit?.element ?? null);
  }, [onSelectElement, setMulti, setPicked]);

  /** Select these layers: one is one; several are their union box and each of them (see multi). */
  const selectMany = React.useCallback((layers: readonly StageLayer[]) => {
    if (!layers.length) { commitHit(null); return; }
    if (layers.length === 1) { commitHit(hitOf(layers[0]!)); return; }
    commitHit({ rect: unionRect(layers.map((l) => l.rect)) });
    setMulti(layers.map((layer) => ({ layer, element: elementOf(layer) })));
  }, [commitHit, elementOf, hitOf, setMulti]);
  /** The layers in hand now (one counts too): Shift-click adds to / takes from them. */
  const selectedLayers = (): StageLayer[] => {
    if (multiRef.current) return multiRef.current.map((i) => i.layer);
    const held = pickedRef.current;
    return held?.layer && held.element && held.element.kind !== 'clip' ? [held.layer] : [];
  };

  /* ── several layers moved together ── */
  type MultiDragItem = MultiItem & { base: LayerGeometry; scale: number; now: LayerGeometry };
  const multiDrag = React.useRef<{ x: number; y: number; moved: boolean; rect0: ClientBox; items: MultiDragItem[] } | null>(null);
  const multiItemsNow = (): MultiDragItem[] => {
    const vs = viewScaleNow();
    return (multiRef.current ?? []).map((it) => ({ ...it, base: it.layer.geo.g, now: it.layer.geo.g, scale: it.layer.geo.k * vs }));
  };
  const multiPaint = React.useMemo(() => new Latest<MultiDragItem[]>(async (items) => {
    const placed = await ask<({ rect: ClientBox; frame: StageFrame } | null)[]>('paintMany', {
      items: items.map((it) => ({ handle: it.layer.handle, g: it.now })),
    });
    if (!placed) return;
    const many = multiRef.current;
    if (!many) return;
    const next = many.map((it) => {
      const i = items.findIndex((x) => x.layer.handle === it.layer.handle);
      const p = i >= 0 ? placed[i] : null;
      return p ? { ...it, layer: { ...it.layer, rect: p.rect, frame: p.frame, geo: { ...it.layer.geo, g: items[i]!.now } } } : it;
    });
    setMulti(next);
    if (!multiDrag.current) setPicked((cur) => (cur ? { ...cur, rect: unionRect(next.map((i) => i.layer.rect)) } : cur));
  }), [ask, setMulti, setPicked]);
  /** Each layer moved by a screen offset (turned back by each one's parents' turn, at each one's scale), shown. */
  const shiftLayers = (items: MultiDragItem[], dxOf: (i: number) => number, dyOf: (i: number) => number) => {
    items.forEach((it, i) => { it.now = { ...it.base, t: movedOffset(it.base, dxOf(i), dyOf(i), it.layer.geo.parentR, it.scale) }; });
    multiPaint.push(items.map((it) => ({ ...it })));
  };
  /** Line several layers up with an edge / middle of their union box. */
  const alignMany = (edge: AlignEdge) => {
    const items = multiItemsNow();
    if (items.length < 2 || !onTransformLayers) return;
    const vs = viewScaleNow();
    const rects = items.map((it) => scaleBox(it.layer.rect, vs));
    const u = unionRect(rects);
    const shifts = rects.map((r) => alignShift(edge, r, u));
    shiftLayers(items, (i) => shifts[i]!.dx, (i) => shifts[i]!.dy);
    onTransformLayers(items.map((it) => ({ element: it.element, g: it.now })));
  };

  /* ── measuring the selection again ── */
  const syncPick = React.useCallback(async () => {
    const many = multiRef.current;
    if (many) {
      const fresh = await ask<(StageLayer | null)[]>('layers', {
        refs: many.map((it) => ({ handle: it.layer.handle, clip: it.layer.clip, at: it.layer.at, n: it.layer.n })),
      });
      if (!fresh || multiRef.current !== many || multiDrag.current) return;
      const next = many.flatMap((it, i) => {
        const layer = fresh[i];
        if (!layer) return [];
        const element = elementOf(layer);
        return [{ layer, element: JSON.stringify(element) === JSON.stringify(it.element) ? it.element : element }];
      });
      if (next.length < 2) { dropPick(); onSelectElement?.(null); return; }
      setMulti(next);
      const rect = unionRect(next.map((i) => i.layer.rect));
      setPicked((cur) => (cur && !sameClientRect(cur.rect, rect) ? { ...cur, rect } : cur));
      return;
    }
    const held = pickedRef.current;
    const layer = held?.layer;
    if (held?.element && held.element.kind !== 'clip' && layer) {
      const el = held.element;
      const fresh = await ask<StageLayer>('layer', { handle: layer.handle, clip: layer.clip, at: layer.at, n: layer.n });
      if (pickedRef.current?.layer?.handle !== layer.handle || layerDrag.current || nudge.current) return;
      /* found again only if it is the same kind of thing: an insert above shifts what a selector finds, and the next
         edit would land on another layer */
      const same = fresh && fresh.kind === el.kind && fresh.tag === el.tag;
      if (!fresh || !same) {
        if (fresh && !same) {
          lostSince.current = null;
          dropPick();
          onSelectElement?.(null);
          return;
        }
        /* the page may still be redrawing: let go only when it stays lost */
        const now = performance.now();
        if (lostSince.current == null) lostSince.current = now;
        if (now - lostSince.current > LOST_PICK_GRACE_MS) {
          lostSince.current = null;
          dropPick();
          onSelectElement?.(null);
        } else {
          window.setTimeout(() => { if (pickedRef.current?.layer?.handle === layer.handle) syncQueue.push(0); }, LOST_PICK_GRACE_MS);
        }
        return;
      }
      lostSince.current = null;
      const next = elementOf(fresh);
      /* a change just written: the film shows it, film.html has it a moment later; until then the numbers in hand stand */
      if (el.loc && committing.current.has(el.loc)) next.override = el.override ?? null;
      const changed = next.loc !== el.loc || next.clipLoc !== el.clipLoc || next.clipId !== el.clipId
        || next.text?.value !== el.text?.value || next.text?.loc !== el.text?.loc
        || JSON.stringify(next.style) !== JSON.stringify(el.style)
        || JSON.stringify(next.override) !== JSON.stringify(el.override);
      setPicked({ ...held, rect: fresh.rect, layer: fresh, element: changed ? next : el });
      if (changed) onSelectElement?.(next);
      return;
    }
    if (held?.element?.isMgOuter && held.element.clipLoc && !gestureRef.current && !clipNudge.current) {
      const info = infoOf(held.element.clipLoc);
      if (!info?.box) return;
      const rect = clientOf(frameAabb(visibleFrame(info.t, info.box, info.crop)));
      /* the inspector's preview has been written: the clip is drawn by film.html again. Told by film.html's box
         having changed since the preview began, not only by the numbers matching: a typed width moves the place by
         float noise (y 60.00000000000003) and the written box is rounded, so they may never match, and the frame and
         the inspector would keep the preview's place through every later write (a Reset among them) */
      if (liveTRef.current && (sameMgTransform(liveTRef.current, info.t)
        || (liveBoxRef.current != null && liveBoxRef.current !== writtenBoxOf(docRef.current, held.element.clipLoc)))) {
        liveTRef.current = null;
        liveBoxRef.current = null;
        setLiveT(null);
      }
      if (sameClientRect(held.rect, rect) && sameMgTransform(held.element.transform, info.t)) return;
      setPicked({ ...held, rect, element: { ...held.element, transform: info.t, mgBox: info.box } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, dropPick, elementOf, onSelectElement, setMulti, setPicked, stage]);
  const syncPickRef = React.useRef(syncPick);
  syncPickRef.current = syncPick;
  const syncQueue = React.useMemo(() => new Latest<number>(() => syncPickRef.current()), []);

  /** Re-measure once a frame at most (and once more the frame after: a page just drawn may still be laying out). */
  const geomRaf = React.useRef(0);
  const syncGeomSoon = React.useCallback(() => {
    if (gestureRef.current || layerDrag.current) return;
    if (geomRaf.current) return;
    geomRaf.current = requestAnimationFrame(() => {
      geomRaf.current = 0;
      if (gestureRef.current || layerDrag.current) return;
      if (pickedRef.current) syncQueue.push(0);
      requestAnimationFrame(() => { if (!gestureRef.current && pickedRef.current) syncQueue.push(0); });
    });
  }, [syncQueue]);
  React.useEffect(() => () => { if (geomRaf.current) cancelAnimationFrame(geomRaf.current); geomRaf.current = 0; }, []);

  /* the playhead moved a bucket on: what is selected stays selected, only where it is changed */
  const stale = staleBucket(timeMs);
  React.useEffect(() => {
    if (pickedRef.current) syncGeomSoon();
  }, [stale, syncGeomSoon]);
  /* film.html changed (an edit, an undo, the agent): the picture follows it a moment later */
  React.useEffect(() => {
    syncGeomSoon();
    const later = window.setTimeout(syncGeomSoon, 150);
    return () => window.clearTimeout(later);
  }, [doc, spans, syncGeomSoon]);

  /* ── the layer in hand: moved, scaled, turned by its own handles ── */
  const layerRaf = React.useRef(0);
  const layerMoveAt = React.useRef<{ p: { x: number; y: number }; mods: { shift: boolean; alt: boolean } } | null>(null);
  type LayerDrag = {
    kind: 'move' | 'scale' | 'stretch' | 'rotate';
    /** Which handle: its place in the frame (see HANDLE_AT); not used to move or turn. */
    hx: -1 | 0 | 1;
    hy: -1 | 0 | 1;
    /** Where the press was (overlay px). */
    x: number;
    y: number;
    base: LayerGeometry;
    /** The frame at the press (overlay px): scaling and turning go about it. */
    frame0: FrameGeometry;
    /** The box at the press (overlay px): a move snaps by it. */
    aabb0: ClientBox;
    /** Overlay px per override px. */
    scale: number;
    layer: StageLayer;
    element: StageElement;
    moved: boolean;
    now: LayerGeometry;
    /** What a move or a scale can snap to (overlay px), measured at the press. */
    targets: readonly { x: number; y: number; w: number; h: number }[];
  };
  const layerDrag = React.useRef<LayerDrag | null>(null);
  const [hint, setHint] = React.useState<{ x: number; y: number; text: string } | null>(null);

  /** The film's answer to a paint: the layer in hand is where it is drawn now. */
  const placeHeld = React.useCallback((handle: number, g: LayerGeometry, placed: { rect: ClientBox; frame: StageFrame }) => {
    setPicked((cur) => (cur?.layer?.handle === handle
      ? { ...cur, rect: placed.rect, layer: { ...cur.layer, rect: placed.rect, frame: placed.frame, geo: { ...cur.layer.geo, g } } }
      : cur));
  }, [setPicked]);
  const layerPaint = React.useMemo(() => new Latest<{ d: { now: LayerGeometry }; handle: number; g: LayerGeometry; center?: { x: number; y: number } }>(async ({ d, handle, g, center }) => {
    const r = await ask<{ g: LayerGeometry; rect: ClientBox; frame: StageFrame }>('paint', { handle, g, ...(center ? { center } : {}) });
    if (!r) return;
    d.now = r.g;
    placeHeld(handle, r.g, r);
  }), [ask, placeHeld]);

  /** A layer that can be taken in hand and moved: a layer (not a whole clip), not locked. */
  const layerMovable = (layer: StageLayer | undefined, element: StageElement | undefined): layer is StageLayer => (
    Boolean(layer && element && element.kind !== 'clip' && onTransformLayer && !layer.locked && !lockedClip(element.clipLoc))
  );

  /** One step of a layer gesture: the new geometry by kind, shown, and the value tag. */
  const stepLayerGesture = (p: { x: number; y: number }, mods: { shift: boolean; alt: boolean }) => {
    const d = layerDrag.current;
    if (!d) return;
    let dx = p.x - d.x;
    let dy = p.y - d.y;
    if (!d.moved) {
      if (d.kind === 'move' && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      setDragging(true);
      setHover(null);
    }
    const vs = viewScaleNow();
    let next = d.base;
    let text = '';
    let guides: MgGuide[] = [];
    let center: { x: number; y: number } | undefined;
    if (d.kind === 'move') {
      /* Shift keeps one axis, as in Figma */
      if (mods.shift) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      /* snaps to the stage's edges and middles and to other layers'; Alt turns it off for a moment */
      if (!mods.alt) {
        const hit = snapMove({ x: d.aabb0.left + dx, y: d.aabb0.top + dy, w: d.aabb0.width, h: d.aabb0.height }, d.targets, SNAP_PX);
        dx += hit.dx;
        dy += hit.dy;
        guides = hit.guides.map((g) => ({ ...g, at: g.at / vs }));
      }
      next = { ...d.base, t: movedOffset(d.base, dx, dy, d.layer.geo.parentR, d.scale) };
      d.now = next;
      /* the inspector's X / Y: the unturned frame's top left, not the turned box's */
      text = `X ${Math.round((d.frame0.cx + dx - d.frame0.w / 2) / vs)}   Y ${Math.round((d.frame0.cy + dy - d.frame0.h / 2) / vs)}`;
    } else if (d.kind === 'scale' || d.kind === 'stretch') {
      /* the edges it moves snap as a move does (Alt scales about the center, unsnapped) */
      const r = scaledLayer(d.frame0, d.base, { hx: d.hx, hy: d.hy }, { x: p.x - d.x, y: p.y - d.y }, { ...mods, proportional: d.kind === 'scale' },
        mods.alt ? undefined : { targets: d.targets, tolerance: SNAP_PX });
      next = r.g;
      guides = r.guides.map((g) => ({ ...g, at: g.at / vs }));
      center = { x: r.center.x / vs, y: r.center.y / vs };
      text = `${Math.round(r.size.w / vs)} × ${Math.round(r.size.h / vs)}`;
    } else {
      next = turnedLayer(d.frame0, d.base, { x: d.x, y: d.y }, p, mods.shift);
      /* about its own center, held where it was at the press */
      center = { x: d.frame0.cx / vs, y: d.frame0.cy / vs };
      text = `${Math.round(next.r)}°`;
    }
    layerPaint.push({ d, handle: d.layer.handle, g: next, ...(center ? { center } : {}) });
    setLiveGuides((cur) => (sameGuides(cur, guides) ? cur : guides));
    setHint({ x: p.x, y: p.y, text });
  };

  /* ── what the geometry callbacks hand out ── */
  const commitLayer = (element: StageElement, layer: StageLayer, base: LayerGeometry, next: LayerGeometry) => {
    if (!onTransformLayer || sameLayerGeometry(base, next)) return;
    const override: NodeOverride = { ...(element.override ?? {}), t: next.t, s: compactScale(next.s[0], next.s[1]), r: next.r };
    /* the numbers in hand are the new ones at once: the inspector and the next drag start from them */
    setPicked((cur) => (cur?.element?.loc === element.loc && cur.element ? { ...cur, element: { ...cur.element, override } } : cur));
    const loc = element.loc;
    if (loc) committing.current.add(loc);
    void onTransformLayer(element, next).then((failed) => {
      if (loc) window.setTimeout(() => { committing.current.delete(loc); syncGeomSoon(); }, failed ? 0 : 400);
      if (!failed) return;
      void ask('release', { clip: layer.clip });
      setPicked((cur) => (cur?.element?.loc === element.loc && cur.element ? { ...cur, element: { ...cur.element, override: element.override ?? null } } : cur));
      syncGeomSoon();
    });
  };

  /**
   * Arrow keys nudge the layer in hand 1 stage px (Shift 10), shown at once and written 350ms after the last key: held
   * down they come thirty a second, and a write per key would leave the picture behind the hand. Not while typing.
   */
  const nudge = React.useRef<{ element: StageElement; layer: StageLayer; base: LayerGeometry; now: LayerGeometry; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const flushNudge = () => {
    const n = nudge.current;
    nudge.current = null;
    if (!n) return;
    if (n.timer) clearTimeout(n.timer);
    commitLayer(n.element, n.layer, n.base, n.now);
  };
  const nudgeLayer = (e: KeyboardEvent) => {
    const held = pickedRef.current;
    const layer = held?.layer;
    if (!layerMovable(layer, held?.element)) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if (nudge.current && nudge.current.layer.handle !== layer.handle) flushNudge();
    const unit = 1 / (layer.geo.k || 1);
    const cur = nudge.current ?? { element: held!.element!, layer, base: layer.geo.g, now: layer.geo.g, timer: null };
    cur.now = { ...cur.now, t: [Math.round((cur.now.t[0] + dx * unit) * 10) / 10, Math.round((cur.now.t[1] + dy * unit) * 10) / 10] };
    layerPaint.push({ d: { now: cur.now }, handle: layer.handle, g: cur.now });
    if (cur.timer) clearTimeout(cur.timer);
    cur.timer = setTimeout(flushNudge, NUDGE_WRITE_MS);
    nudge.current = cur;
  };
  /* what was nudged and not written yet is written before the selection changes (only on that: every key renders) */
  const heldLoc = picked?.element?.loc ?? null;
  React.useEffect(() => () => { if (nudge.current) flushNudge(); }, [heldLoc]);

  /* ── typing a line in place ── */
  /**
   * Double-click a line (or select it and press Enter): the line itself becomes typeable in the picture, all of it
   * selected (an SVG text, or a line with inline parts, gets a box of its own type over it). Esc cancels; a click
   * elsewhere (blur) or Enter commits (⌘Enter where Enter breaks a line).
   */
  const finishTextEdit = (commit: boolean) => {
    if (!textEdit.current) return;
    void ask('textFinish', { commit });
  };
  const finishTextEditRef = React.useRef(finishTextEdit);
  finishTextEditRef.current = finishTextEdit;
  const onTextDone = (e: Extract<StageEvent, { event: 'text' }>) => {
    const edit = textEdit.current;
    if (!edit || edit.layer.handle !== e.handle) return;
    textEdit.current = null;
    setEditingText(null);
    syncGeomSoon();
    const { element, layer } = edit;
    if (!e.commit || !e.value || !onEditTextInline) return;
    const value = e.value;
    const nextElement = { ...element, ...(element.text ? { text: { ...element.text, value } } : {}) };
    setPicked((cur) => (cur?.element?.loc === element.loc ? { ...cur, element: nextElement } : cur));
    void onEditTextInline(element, value).then((failed) => {
      if (!failed) return;
      void ask('release', { clip: layer.clip });
      setPicked((cur) => (cur?.element?.loc === element.loc ? { ...cur, element } : cur));
      syncGeomSoon();
    });
  };
  const startTextEdit = (): boolean => {
    const held = pickedRef.current;
    const element = held?.element;
    const layer = held?.layer;
    if (!onEditTextInline || !layer || !element?.text || textEdit.current || layer.locked || lockedClip(element.clipLoc)) return false;
    if (nudge.current) flushNudge();
    textEdit.current = { element, layer };
    setEditingText(element.loc);
    setHover(null);
    previewRef.current?.focus?.();
    void ask<boolean>('textStart', { handle: layer.handle, multiline: element.text.shape === 'children' }).then((started) => {
      if (started || textEdit.current?.layer.handle !== layer.handle) return;
      textEdit.current = null;
      setEditingText(null);
    });
    return true;
  };
  const startTextEditRef = React.useRef(startTextEdit);
  startTextEditRef.current = startTextEdit;
  /* the selection changed, or the layer went: what was typed is committed (like a click elsewhere); not a box just
     opened on the new selection (a double-click selects and types at once) */
  React.useEffect(() => () => {
    if (textEdit.current && textEdit.current.element.loc !== pickedRef.current?.element?.loc) finishTextEditRef.current(true);
  }, [heldLoc]);

  /* ── the keyboard (the window's, and the picture's when it has focus: the film passes those on) ── */
  const keyHandler = React.useRef<((e: KeyboardEvent) => void) | null>(null);
  React.useEffect(() => {
    if (!picked) { keyHandler.current = null; return undefined; }
    const onKey = (e: KeyboardEvent) => {
      /* keys pressed in an app's own panel are the app's (typing-target.ts) */
      if ((e.target as Element | null)?.closest?.('[data-studio-host-panel]')) return;
      const typingNow = () => {
        const focus = document.activeElement as HTMLElement | null;
        return Boolean(focus && (/^(INPUT|TEXTAREA|SELECT)$/.test(focus.tagName) || focus.isContentEditable));
      };
      /* cropping: Enter keeps the crop, Esc gives it up (before anything else hears them: Esc would let the clip go);
         the arrows do nothing (they would move the clip, or the playhead, under the crop). A button of the crop's bar
         reached with Tab presses itself. */
      if (cropRef.current) {
        if (typingNow() || (document.activeElement as HTMLElement | null)?.closest?.('[data-crop-bar]')) return;
        /* a panel open over the inspector closes on its own Esc */
        if (e.key === 'Escape' && document.querySelector('[data-popover-panel], [role="menu"], [role="listbox"], [role="dialog"]')) return;
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finishCrop(e.key === 'Enter');
        } else if (e.key.startsWith('Arrow')) e.preventDefault();
        return;
      }
      /* the arrows are the playhead's unless the picture has the keyboard (arrowsMove) */
      if (e.key.startsWith('Arrow') && !arrowsMoveRef.current) return;
      if (e.key.startsWith('Arrow') && multiRef.current && onTransformLayers && !multiRef.current.some((it) => lockedClip(it.element.clipLoc)) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (!typingNow()) {
          e.preventDefault();
          const step = (e.shiftKey ? 10 : 1) * viewScaleNow();
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          const items = multiItemsNow();
          shiftLayers(items, () => dx, () => dy);
          onTransformLayers(items.map((it) => ({ element: it.element, g: it.now })));
          const vs = viewScaleNow();
          setPicked((cur) => (cur ? { ...cur, rect: { ...cur.rect, left: cur.rect.left + dx / vs, top: cur.rect.top + dy / vs } } : cur));
          return;
        }
      }
      if (e.key.startsWith('Arrow')) {
        /* with a modifier, or from the timeline: not a nudge */
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
        if ((e.target as Element | null)?.closest?.('[data-timeline]')) return;
        if (typingNow()) return;
        if (!nudgeClip(e)) nudgeLayer(e);
        return;
      }
      /* the shortcuts are the menu's items (Figma's): ⇧⌘H hide, ⇧⌘L lock, ] / [ to the front / back; grayed ones
         do nothing. A whole clip's delete / copy / paste are the timeline's keys. */
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const menuId = mod && e.shiftKey && k === 'h' ? 'hide'
        : mod && e.shiftKey && k === 'l' ? 'lock'
          : !mod && !e.altKey && e.key === ']' ? 'front'
            : !mod && !e.altKey && e.key === '[' ? 'back'
              : null;
      /* C crops the video or still in hand */
      if (!mod && !e.altKey && !e.shiftKey && k === 'c' && !textEdit.current && !typingNow()) {
        if (startCrop()) e.preventDefault();
        return;
      }
      if (menuId && menuFor && !textEdit.current && !typingNow()) {
        const many = multiRef.current;
        const held = pickedRef.current;
        const el = many ? many[0]!.element : held?.element;
        if (el && (many || el.kind !== 'clip')) {
          const item = menuFor(el, {
            arrange: many || !held?.layer ? null : arrangeOf(held.layer.handle),
            at: { x: 0, y: 0 },
            ...(many ? { multi: many.map((i) => i.element), align: alignMany } : {}),
            locked: Boolean(!many && held?.layer?.locked),
          }).find((entry) => 'label' in entry && entry.id === menuId);
          if (item && 'label' in item && !item.disabled && item.onSelect) {
            e.preventDefault();
            e.stopPropagation();
            item.onSelect();
            return;
          }
        }
      }
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const focus = document.activeElement as HTMLElement | null;
        if (focus && (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(focus.tagName) || focus.isContentEditable)) return;
        if (startTextEdit()) e.preventDefault();
        return;
      }
      if (e.key !== 'Escape') return;
      /* a number being typed in the inspector: the field gives it up itself (its own Esc runs after this one, which
         listens first), then it is blurred; the selection stays (as Figma does). Blurred here at once, the field
         would take the blur for a commit and keep what was typed. */
      const focus = document.activeElement as HTMLElement | null;
      if (focus?.closest('[data-film-inspector]') && /^(INPUT|TEXTAREA|SELECT)$/.test(focus.tagName)) {
        requestAnimationFrame(() => { if (document.activeElement === focus) focus.blur(); });
        return;
      }
      /* a panel open over the inspector (the color picker, the font list, a menu) closes on its own Esc: the
         selection stays */
      if (document.querySelector('[data-popover-panel], [role="menu"], [role="listbox"], [role="dialog"]')) return;
      dropPick();
      onSelectElement?.(null);
    };
    keyHandler.current = onKey;
    /* a press elsewhere lets go: selecting is "I mean this one", and the hand moving away ends it. Not the stage, its
       menus, the inspector (and its floating panels), the dividers, list boxes, or the timeline (it selects itself). */
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el?.closest('[data-film-select]')
        || el?.closest('[data-selection-toolbar]')
        || el?.closest('[role="menu"]')
        || el?.closest('[data-film-inspector]')
        || el?.closest('[role="separator"]')
        || el?.closest('[role="listbox"]')
        || el?.closest('[data-popover-panel]')
        || el?.closest('[data-timeline]')
      ) return;
      dropPick();
      onSelectElement?.(null);
    };
    /* capture: the arrow keys are the layer's first (it nudges and prevents default; the frame-step listener steps
       aside on defaultPrevented) */
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropPick, onSelectElement, picked]);

  /* the film's own events: an in-place edit ended, a key pressed in the picture, another load of the film shown */
  React.useEffect(() => {
    const preview = previewRef.current;
    if (!preview?.onStage) return undefined;
    return preview.onStage((e) => {
      if (e.event === 'text') onTextDoneRef.current(e);
      else if (e.event === 'key') keyHandler.current?.(e.key);
      else {
        if (textEdit.current) { textEdit.current = null; setEditingText(null); }
        syncFilmOffsetRef.current();
        syncGeomSoon();
      }
    });
  }, [previewRef, syncGeomSoon]);
  const onTextDoneRef = React.useRef(onTextDone);
  onTextDoneRef.current = onTextDone;

  /* ── the clips selected on the timeline ── */
  const [linkedMarks, setLinkedMarks] = React.useState<readonly LinkedMark[]>(NO_MARKS);
  React.useEffect(() => {
    const next: LinkedMark[] = [];
    for (const loc of linkedLocs ?? []) {
      const info = clipInfo(doc, spans, stage, loc);
      if (info?.box) next.push({ loc, t: info.t, box: info.box });
    }
    setLinkedMarks((cur) => (sameLinkedMarks(cur, next) ? cur : next));
  }, [doc, spans, stage, linkedLocs]);

  /**
   * One block selected on the timeline is in hand here at once (a frame with handles, not an outline): selecting it
   * there means "I want to move this one". Several stay outlines (taking one of them in hand would decide for the
   * person); when there is no longer exactly one, the handles go.
   */
  React.useEffect(() => {
    const locs = linkedLocs ?? [];
    if (locs.length !== 1) {
      /* only a clip in hand: a layer clicked on the picture was not selected on the timeline */
      if (pickedRef.current?.element?.isMgOuter) dropPick();
      return;
    }
    const only = locs[0]!;
    const held = pickedRef.current?.element;
    if (held?.isMgOuter && held.clipLoc === only) return;
    const info = clipInfo(doc, spans, stage, only);
    /* a sound has no picture: the handles of the clip held before go */
    if (!info) { if (pickedRef.current?.element?.isMgOuter) dropPick(); return; }
    /* the inspector's preview was of the clip held before */
    liveTRef.current = null;
    liveBoxRef.current = null;
    setLiveT(null);
    commitHit(describeClip(info, stage));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedLocs, stale, commitHit, dropPick, spans]);

  /* the inspector's live clip preview: only the clip in hand */
  React.useEffect(() => {
    if (!clipPreviewRef) return undefined;
    clipPreviewRef.current = (clipLoc, patch) => {
      const outer = pickedRef.current?.element;
      if (!outer?.isMgOuter || outer.clipLoc !== clipLoc || !outer.mgBox || !outer.transform || !outer.clipId) return;
      const next = patch ? { ...outer.transform, ...patch } : outer.transform;
      void ask('place', { clip: outer.clipId, box: patch ? compactBox(next, outer.mgBox) : null });
      /* film.html's box as the preview began (kept through the preview's every step): once it changes, the preview
         is over (see syncPick) */
      if (patch && !liveBoxRef.current) liveBoxRef.current = writtenBoxOf(docRef.current, clipLoc);
      if (!patch) liveBoxRef.current = null;
      liveTRef.current = patch ? next : null;
      setLiveT(patch ? next : null);
    };
    return () => { clipPreviewRef.current = null; };
  }, [ask, clipPreviewRef]);

  /* the inspector's live look preview: a clip in CSS not kept yet */
  React.useEffect(() => {
    if (!lookPreviewRef) return undefined;
    lookPreviewRef.current = (clipLoc, css) => {
      const at = parseFilmDocLoc(clipLoc);
      const clip = at ? docRef.current?.tracks[at.track]?.clips[at.clip] : undefined;
      if (!clip?.id) return;
      void ask('look', { clip: clip.id, css });
      setLookLive(css == null ? null : { clipLoc, css, written: clip.style ?? '' });
    };
    return () => { lookPreviewRef.current = null; };
  }, [ask, lookPreviewRef]);

  /* the inspector's live layer previews */
  React.useEffect(() => {
    if (!controlRef) return undefined;
    const clean = <V,>(o: Record<string, V | undefined>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
    const named = (element: StageElement) => {
      const target = layerTarget(element);
      return target && element.clipId ? { clip: element.clipId, ...target } : null;
    };
    controlRef.current = {
      previewStyle(element, patch) {
        const at = named(element);
        if (at) void ask('tweak', { ...at, patch: { style: clean(patch as Record<string, string | number | null | undefined>) } }).then(syncGeomSoon);
      },
      previewText(element, value) {
        const at = named(element);
        if (at) void ask('tweak', { ...at, patch: { text: value } }).then(syncGeomSoon);
      },
      async previewOverride(element, patch, pivot) {
        const at = named(element);
        if (!at) return patch;
        const geometry = clean({ t: patch.t, s: patch.s, r: patch.r });
        if (pivot && (patch.s != null || patch.r != null)) {
          const base = element.override ?? {};
          const t = await ask<[number, number]>('pivot', { ...at, base: clean({ t: base.t, s: base.s, r: base.r }), patch: geometry, pivot });
          syncGeomSoon();
          return t ? { ...patch, t } : patch;
        }
        await ask('tweak', { ...at, patch: geometry });
        syncGeomSoon();
        return patch;
      },
      release(element) {
        if (element.clipId) void ask('release', { clip: element.clipId }).then(syncGeomSoon);
      },
      async describe(element) {
        const at = named(element);
        const layer = at ? await ask<StageLayer>('layer', at) : null;
        return layer ? elementOf(layer) : null;
      },
      refresh: syncGeomSoon,
      startCrop: () => startCropRef.current(),
      editMask: setMaskSession,
      picked: () => pickedItemsRef.current(),
      flushPending: () => flushPendingRef.current(),
    };
    return () => { controlRef.current = null; };
  }, [ask, controlRef, elementOf, syncGeomSoon]);

  /* the inspector's breadcrumb (and Select parent): select the layer at that place; not found, nothing changes */
  const requestSeq = selectRequest?.seq;
  React.useEffect(() => {
    if (!selectRequest) return;
    const clipLoc = selectRequest.clipLoc ?? pickedRef.current?.element?.clipLoc;
    const at = clipLoc ? parseFilmDocLoc(clipLoc) : null;
    const clipId = at ? doc.tracks[at.track]?.clips[at.clip]?.id : pickedRef.current?.layer?.clip;
    if (!clipId) return;
    const token = ++pressSeq.current;
    void ask<StageLayer>('layer', { clip: clipId, loc: selectRequest.loc, any: true }).then((layer) => {
      if (!layer || token !== pressSeq.current) return;
      setHover(null);
      commitHit(hitOf(layer));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestSeq]);

  /* ── the hover outline: asked once a frame, one question at a time ── */
  const moveRaf = React.useRef(0);
  const moveAt = React.useRef<{ cx: number; cy: number; shift?: boolean; alt?: boolean } | null>(null);
  React.useEffect(() => () => { if (moveRaf.current) cancelAnimationFrame(moveRaf.current); }, []);
  const hoverQueue = React.useMemo(() => new Latest<{ x: number; y: number; from: number | null }>(async (p) => {
    const found = await ask<StageOutline>('hit', p);
    if (!moveAt.current) return;
    /* the same layer in the same place: keep the object (sixty questions a second must not redraw the outline) */
    setHover((cur) => (found
      ? (cur && cur.handle === found.handle && sameClientRect(cur.rect, found.rect) ? cur : found)
      : (cur ? null : cur)));
  }), [ask]);
  /* a layer pointed at from the Layers panel: outlined where it is drawn, until the pointer leaves the row */
  const pointClip = pointLayer?.clipId;
  const pointLoc = pointLayer?.loc;
  const pointed = React.useRef(false);
  React.useEffect(() => {
    if (!pointClip || !pointLoc) {
      if (pointed.current) { pointed.current = false; setHover(null); }
      return undefined;
    }
    let live = true;
    void ask<StageLayer>('layer', { clip: pointClip, loc: pointLoc, any: true }).then((layer) => {
      if (!live) return;
      pointed.current = Boolean(layer);
      setHover(layer ? { handle: layer.handle, rect: layer.rect, ...(layer.frame.r ? { frame: layer.frame } : {}) } : null);
    });
    return () => { live = false; };
  }, [pointClip, pointLoc, ask]);
  /** Only with no clip in hand: a clip in hand owns the picture. */
  const hoverEnabled = !picked?.element?.isMgOuter;
  const hoverEnabledRef = React.useRef(hoverEnabled);
  hoverEnabledRef.current = hoverEnabled;
  /* the layer under the pointer, told to the app: asked of the stage once each time it is another one */
  const hoverHandle = hover?.handle ?? null;
  React.useEffect(() => {
    if (!onHoverLayer) return undefined;
    if (hoverHandle == null) { onHoverLayer(null); return undefined; }
    let live = true;
    void ask<StageLayer>('layer', { handle: hoverHandle }).then((layer) => {
      if (!live) return;
      onHoverLayer(layer ? { element: elementOf(layer), box: { x: layer.rect.left, y: layer.rect.top, w: layer.rect.width, h: layer.rect.height } } : null);
    });
    return () => { live = false; };
  }, [hoverHandle, onHoverLayer, ask, elementOf]);

  /* ── a whole clip in hand: moved, scaled, turned ── */
  const clipPlace = React.useMemo(() => new Latest<{ clip: string; box: FilmBox | null }>(async (a) => { await ask('place', a); }), [ask]);
  const applyMgGesture = (stagePt: { x: number; y: number }, shift: boolean, alt: boolean) => {
    const g = gestureRef.current;
    if (!g) return;
    if (g.pendingClick) {
      if (Math.hypot(stagePt.x - g.start.x, stagePt.y - g.start.y) < MARQUEE_MIN_PX) return;
      g.pendingClick = false;
      setDragging(true);
    }
    const tolerance = SNAP_PX / Math.max(viewScaleNow(), 0.01);
    let next = g.origin;
    let guides: MgGuide[] = [];
    let shown = visibleFrame(g.origin, g.box, g.crop);
    if (g.kind === 'move') {
      const dx = stagePt.x - g.start.x;
      const dy = stagePt.y - g.start.y;
      next = shift
        ? (Math.abs(dx) > Math.abs(dy) ? moveTransform(g.origin, dx, 0) : moveTransform(g.origin, 0, dy))
        : moveTransform(g.origin, dx, dy);
      /* snaps to the stage and the other clips; Alt turns it off; a turned clip never snaps (its box is not its shape) */
      if (!alt && !g.origin.rotate) {
        const hit = snapMove(frameAabb(visibleFrame(next, g.box, g.crop)), g.snapTargets, tolerance);
        if (hit.dx || hit.dy) next = moveTransform(next, hit.dx, hit.dy);
        guides = hit.guides;
      }
    } else if (g.kind === 'rotate') {
      next = rotateTransform(g.origin, g.box, g.start, stagePt, shift ? 15 : 0);
    } else if (g.kind === 'scale' && g.handle) {
      const f0 = shown;
      /* as Figma: a corner keeps the proportions and an edge stretches its side, Shift the other way round; a page's
         box is never stretched. Alt: about the center, unsnapped (it moves both sides) */
      const proportional = !g.stretchable || (g.handle.hx && g.handle.hy ? !shift : shift);
      const r = resizedFrame(f0, g.handle, { x: stagePt.x - g.start.x, y: stagePt.y - g.start.y }, { proportional, fromCenter: alt },
        alt ? undefined : { targets: g.snapTargets, tolerance });
      /* the picture 0.01–8 times its own size; in proportion, both bounded alike */
      const bound = (k: number, scale: number) => Math.min(8, Math.max(0.01, scale * k)) / scale;
      let kx = bound(r.w / f0.w, g.origin.scaleX);
      let ky = bound(r.h / f0.h, g.origin.scaleY);
      if (proportional) kx = ky = r.w >= f0.w ? Math.min(kx, ky) : Math.max(kx, ky);
      const size = { w: f0.w * kx, h: f0.h * ky };
      const c = pivotCenter(f0, size, r.pivot);
      next = transformOfVisible(g.origin, g.box, g.crop, { cx: c.x, cy: c.y, w: size.w, h: size.h, r: f0.r });
      guides = r.guides;
    }
    shown = visibleFrame(next, g.box, g.crop);
    clipPlace.push({ clip: g.clipId, box: compactBox(next, g.box) });
    liveTRef.current = next;
    setLiveT(next);
    setLiveGuides((cur) => (sameGuides(cur, guides) ? cur : guides));
    const vs = viewScaleNow();
    setHint({
      x: stagePt.x * vs,
      y: stagePt.y * vs,
      text: g.kind === 'rotate' ? `${Math.round(next.rotate)}°`
        : g.kind === 'move' ? `X ${Math.round((g.box.x ?? 0) + next.x)}   Y ${Math.round((g.box.y ?? 0) + next.y)}`
          : `${Math.round(shown.w)} × ${Math.round(shown.h)}`,
    });
  };

  /** A whole clip's new numbers: in hand at once (the inspector and the next drag start from them), its outline too. */
  const holdClipAt = (g: { clipLoc: string; box: MgBox; crop: Crop }, at: MgTransform) => {
    const rect = clientOf(frameAabb(visibleFrame(at, g.box, g.crop)));
    const cur = pickedRef.current;
    if (cur?.element && cur.element.clipLoc === g.clipLoc) {
      const element = { ...cur.element, transform: at, mgBox: g.box };
      setPicked((now) => (now?.element?.clipLoc === g.clipLoc ? { ...now, rect, element } : now));
      onSelectElement?.(element);
    }
    /* the linked outline moves with it at once (film.html follows a moment later) */
    setLinkedMarks((marks) => (marks.some((m) => m.loc === g.clipLoc) ? marks.map((m) => (m.loc === g.clipLoc ? { ...m, t: at } : m)) : marks));
  };
  /** Written as film.html's `box`; refused, it goes back where it started (the caller says why). */
  const commitClipBox = (g: { clipLoc: string; clipId: string; box: MgBox; crop: Crop; origin: MgTransform }, t: MgTransform) => {
    holdClipAt(g, t);
    if (!onEditClip) return;
    void onEditClip([{ loc: g.clipLoc, prop: 'box', value: compactBox(t, g.box) }]).then((failed) => {
      if (!failed) return;
      clipPlace.push({ clip: g.clipId, box: null });
      holdClipAt(g, g.origin);
    });
  };

  const endMgGesture = () => {
    const g = gestureRef.current;
    const t = liveTRef.current;
    gestureRef.current = null;
    liveTRef.current = null;
    liveBoxRef.current = null;
    setLiveT(null);
    setLiveGuides(NO_GUIDES);
    setDragging(false);
    setHint(null);
    if (g && t) commitClipBox(g, t);
  };

  /** The arrow keys move the clip in hand as they do a layer (see nudge): shown at once, written after the last key. */
  const clipNudge = React.useRef<{
    clipLoc: string; clipId: string; box: MgBox; crop: Crop; origin: MgTransform; now: MgTransform; timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const flushClipNudge = () => {
    const n = clipNudge.current;
    clipNudge.current = null;
    if (!n) return;
    if (n.timer) clearTimeout(n.timer);
    liveTRef.current = null;
    setLiveT(null);
    if (!sameMgTransform(n.origin, n.now)) commitClipBox(n, n.now);
  };
  const nudgeClip = (e: KeyboardEvent): boolean => {
    const outer = pickedRef.current?.element;
    const origin = liveTRef.current ?? outer?.transform;
    if (!onEditClip || !outer?.isMgOuter || !outer.clipLoc || !outer.clipId || !outer.mgBox || !origin || gestureRef.current || cropRef.current || lockedClip(outer.clipLoc)) return false;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if (clipNudge.current && clipNudge.current.clipLoc !== outer.clipLoc) flushClipNudge();
    const cur = clipNudge.current ?? {
      clipLoc: outer.clipLoc, clipId: outer.clipId, box: outer.mgBox, crop: infoOf(outer.clipLoc)?.crop ?? NO_CROP, origin, now: origin, timer: null,
    };
    cur.now = moveTransform(cur.now, dx, dy);
    clipPlace.push({ clip: cur.clipId, box: compactBox(cur.now, cur.box) });
    liveTRef.current = cur.now;
    setLiveT(cur.now);
    if (cur.timer) clearTimeout(cur.timer);
    cur.timer = setTimeout(flushClipNudge, NUDGE_WRITE_MS);
    clipNudge.current = cur;
    return true;
  };

  /* what the arrow keys moved and is not written yet, written now (the editor asks before an undo or another edit) */
  flushPendingRef.current = () => {
    if (nudge.current) flushNudge();
    if (clipNudge.current) flushClipNudge();
  };

  /* ── crop mode: a video or still in hand, cropped in place ── */
  /** The crop being drawn: in the clip's box, its own px from its top left (unturned); the CSS it started from. */
  type CropSession = {
    clipLoc: string;
    clipId: string;
    t: MgTransform;
    box: MgBox;
    /** The box's size on the stage. */
    size: { w: number; h: number };
    css0: string;
    fit: string;
    radius: number;
    crop0: Crop;
    pos0: [number, number];
    rect: Rect;
    pos: [number, number];
    aspect: CropAspect;
  };
  const [cropping, setCroppingState] = React.useState<CropSession | null>(null);
  /* ── the inspector's mask, edited on the picture (StageMaskOverlay): drawn over the thing in hand it is for ── */
  const [maskSession, setMaskSession] = React.useState<MaskSession | null>(null);
  const cropRef = React.useRef<CropSession | null>(null);
  const cropPaint = React.useMemo(() => new Latest<{ clip: string; css: string | null }>(async (a) => { await ask('look', a); }), [ask]);
  const setCrop = (next: CropSession | null) => {
    cropRef.current = next;
    setCroppingState(next);
    if (next) cropPaint.push({ clip: next.clipId, css: cropPreviewCss(next.css0, next.pos0, next.pos) });
  };
  const cropDrag = React.useRef<{ kind: 'move' | 'scale' | 'stretch'; handle: FramePivot; start: { x: number; y: number }; rect0: Rect; pos0: [number, number] } | null>(null);

  const startCrop = (): boolean => {
    const held = pickedRef.current?.element;
    const t = liveTRef.current ?? held?.transform;
    if (!onEditClip || cropRef.current || gestureRef.current || !held?.isMgOuter || held.clipKind !== 'video' || !held.clipLoc || !held.clipId || !held.mgBox || !t || lockedClip(held.clipLoc)) return false;
    const at = parseFilmDocLoc(held.clipLoc);
    const clip = at ? docRef.current.tracks[at.track]?.clips[at.clip] : undefined;
    if (!clip) return false;
    const look = spansRef.current.find((sp) => sp.id === clip.id)?.look;
    const css0 = clip.style ?? '';
    const clipPath = declared(css0, 'clip-path') ?? look?.clip;
    const crop0 = cropOf(clipPath);
    /* a clip-path of another shape is the clip's own CSS (the inspector's Custom CSS): an inset is not put over it */
    if (!crop0) return false;
    if (clipNudge.current) flushClipNudge();
    const size = mgSize(t, held.mgBox);
    const pos0 = positionOf(declared(css0, 'object-position') ?? look?.position) ?? [50, 50];
    setHover(null);
    setMeasure(null);
    setCrop({
      clipLoc: held.clipLoc,
      clipId: held.clipId,
      t,
      box: held.mgBox,
      size,
      css0,
      fit: declared(css0, 'object-fit') ?? look?.fit ?? 'contain',
      /* the crop's corners: the clip's own radius, else its inset's, else the film's CSS's */
      radius: pxOf(declared(css0, 'border-radius')) ?? roundOf(clipPath) ?? pxOf(look?.radius) ?? 0,
      crop0,
      pos0,
      rect: cropRect(crop0, size.w, size.h),
      pos: pos0,
      aspect: 'free',
    });
    return true;
  };
  /** Kept (Enter, Done, a press elsewhere): written once, one undo step; or given up (Esc, Cancel). */
  const finishCrop = (keep: boolean) => {
    const s = cropRef.current;
    if (!s) return;
    cropRef.current = null;
    setCroppingState(null);
    cropDrag.current = null;
    setDragging(false);
    setHint(null);
    const css = keep && onEditClip
      ? croppedCss(s.css0, { crop: s.crop0, position: s.pos0 }, { crop: cropOfRect(s.rect, s.size.w, s.size.h), position: s.pos }, s.radius)
      : null;
    if (css == null || !onEditClip) { cropPaint.push({ clip: s.clipId, css: null }); return; }
    /* the preview stays until film.html has the crop (the film then wears it): put back first, the old one would flash */
    void cropPaint.idle()
      .then(() => onEditClip([{ loc: s.clipLoc, prop: 'style', value: css || null }]))
      .then((failed) => { if (failed) cropPaint.push({ clip: s.clipId, css: null }); });
  };
  const setCropAspect = (aspect: CropAspect) => {
    const s = cropRef.current;
    if (!s) return;
    const ratio = aspectRatio(aspect, s.box);
    setCrop({ ...s, aspect, rect: ratio ? fitAspect(s.rect, ratio, s.size.w, s.size.h) : s.rect });
  };
  /** One step of a crop drag (`p` overlay px): the hand's way turned back into the box's own axes. */
  const stepCrop = (p: { x: number; y: number }, shift: boolean) => {
    const s = cropRef.current;
    const d = cropDrag.current;
    if (!s || !d) return;
    const vs = viewScaleNow();
    const dx = p.x / vs - d.start.x;
    const dy = p.y / vs - d.start.y;
    const rad = (-(s.t.rotate || 0) * Math.PI) / 180;
    const way = { x: dx * Math.cos(rad) - dy * Math.sin(rad), y: dx * Math.sin(rad) + dy * Math.cos(rad) };
    if (d.kind === 'move') {
      const panned = pannedCrop(d.rect0, d.pos0, way, s.size, s.box, s.fit);
      setCrop({ ...s, rect: panned.rect, pos: panned.position });
      return;
    }
    /* a ratio picked holds; with Free, Shift keeps the crop's proportions at the press */
    const ratio = aspectRatio(s.aspect, s.box) ?? (shift ? d.rect0.w / d.rect0.h : null);
    const rect = draggedCrop(d.rect0, d.handle, way, s.size, ratio);
    setCrop({ ...s, rect });
    setHint({ x: p.x, y: p.y, text: `${Math.round(rect.w)} × ${Math.round(rect.h)}` });
  };
  /* the clip let go (another selected, or none): a crop being drawn is kept, as a click elsewhere keeps it; and a nudge
     not written yet is written */
  const heldClipLoc = picked?.element?.isMgOuter ? picked.element.clipLoc ?? null : null;
  React.useEffect(() => () => {
    if (clipNudge.current) flushClipNudge();
    if (cropRef.current) finishCrop(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldClipLoc]);

  const startCropRef = React.useRef(startCrop);
  startCropRef.current = startCrop;

  /* ── Alt held: distances from the thing in hand to what the pointer is over ── */
  const [measure, setMeasure] = React.useState<{ lines: MeasureLine[]; other: Rect | null } | null>(null);
  const altHeld = React.useRef(false);
  /** The thing in hand's box (stage px): a whole clip's shown part, a layer's drawn box, several layers' union. */
  const selectionBox = (): Rect | null => {
    const held = pickedRef.current;
    if (!held) return null;
    const el = held.element;
    const t = liveTRef.current ?? el?.transform;
    if (el?.isMgOuter && el.mgBox && el.clipLoc && t) return frameAabb(visibleFrame(t, el.mgBox, infoOf(el.clipLoc)?.crop ?? NO_CROP));
    const r = held.layer?.rect ?? held.rect;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };
  const selectionBoxRef = React.useRef(selectionBox);
  selectionBoxRef.current = selectionBox;
  const shownBoxOfRef = React.useRef(shownBoxOf);
  shownBoxOfRef.current = shownBoxOf;
  const measureQueue = React.useMemo(() => new Latest<{ x: number; y: number }>(async (p) => {
    const held = pickedRef.current;
    const mine = selectionBoxRef.current();
    if (!held || !mine) { setMeasure(null); return; }
    /* the layer under the pointer, else the clip; the thing in hand itself (or its own clip) measures to the stage */
    const own = new Set([held.element?.clipId, ...(multiRef.current ?? []).map((i) => i.element.clipId)]);
    const ownLayers = new Set([held.layer?.handle, ...(multiRef.current ?? []).map((i) => i.layer.handle)]);
    const layer = await ask<StageOutline>('hit', { ...p, from: null });
    let other: Rect | null = null;
    if (layer) {
      if (!ownLayers.has(layer.handle)) other = { x: layer.rect.left, y: layer.rect.top, w: layer.rect.width, h: layer.rect.height };
    } else {
      const id = await ask<string>('clipAt', p);
      const list = id && !own.has(id) ? await ask<{ id: string; x: number; y: number; w: number; h: number }[]>('clips') : null;
      const clip = list?.find((c) => c.id === id);
      if (clip) other = shownBoxOfRef.current(clip);
    }
    if (!altHeld.current || pickedRef.current !== held) return;
    setMeasure({ lines: measureGaps(mine, other ?? { x: 0, y: 0, w: stage.w, h: stage.h }), other });
  }), [ask, stage]);
  /** Measured only with nothing being dragged, drawn or cropped. */
  const measureAt = (p: { x: number; y: number } | null) => {
    const busy = gestureRef.current || layerDrag.current || multiDrag.current || draftRef.current || cropRef.current || textEdit.current;
    if (!p || !pickedRef.current || busy) {
      altHeld.current = false;
      setMeasure(null);
      return;
    }
    altHeld.current = true;
    const vs = viewScaleNow();
    measureQueue.push({ x: p.x / vs, y: p.y / vs });
  };
  const measureAtRef = React.useRef(measureAt);
  measureAtRef.current = measureAt;
  /* Alt pressed or let go with the pointer resting on the picture sends no pointer move */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Alt') measureAtRef.current(e.type === 'keydown' ? pointerAt.current : null);
    };
    const off = () => measureAtRef.current(null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', off);
    };
  }, []);

  /* ── geometry for the inspector ── */
  const lastGeometry = React.useRef('');
  const reportGeometry = (g: StageGeometry | null) => {
    const key = g ? JSON.stringify(g) : '';
    if (key === lastGeometry.current) return;
    lastGeometry.current = key;
    onGeometry?.(g);
  };
  /* unmounted (full screen, read only): the inspector must not keep showing the last numbers */
  const onGeometryRef = React.useRef(onGeometry);
  onGeometryRef.current = onGeometry;
  React.useEffect(() => () => { onGeometryRef.current?.(null); }, []);

  /* ── the film's box inside this overlay, and re-measuring when it changes size ── */
  const syncFilmOffset = React.useCallback(() => {
    const hostR = host.current?.getBoundingClientRect();
    const frameR = previewRef.current?.frame?.()?.getBoundingClientRect();
    if (!hostR || !frameR || !(frameR.width > 0)) return;
    const next = { left: frameR.left - hostR.left, top: frameR.top - hostR.top, width: frameR.width, height: frameR.height };
    setFilmOffset((cur) => (cur.left === next.left && cur.top === next.top && cur.width === next.width && cur.height === next.height ? cur : next));
  }, [previewRef]);
  const syncFilmOffsetRef = React.useRef(syncFilmOffset);
  syncFilmOffsetRef.current = syncFilmOffset;
  React.useLayoutEffect(() => {
    syncFilmOffset();
    let settle: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      setHover(null);
      syncFilmOffset();
      syncGeomSoon();
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => { settle = null; syncFilmOffset(); syncGeomSoon(); }, 180);
    };
    const ro = new ResizeObserver(onResize);
    if (host.current) ro.observe(host.current);
    const frame = previewRef.current?.frame?.();
    if (frame) ro.observe(frame);
    window.addEventListener('resize', onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      if (settle) clearTimeout(settle);
    };
  }, [previewRef, syncFilmOffset, syncGeomSoon]);

  /* ── context menu, double click ── */
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: readonly ContextMenuEntry[] } | null>(null);
  /** The menu's entries, then Show… / Unlock…, opened at a point on screen. */
  const openMenuAt = (at: { x: number; y: number }, items: readonly ContextMenuEntry[]) => {
    const recovery = recoveryMenu?.() ?? [];
    const combined: readonly ContextMenuEntry[] = recovery.length
      ? [...items, ...(items.length ? [{ id: 'recovery-separator', separator: true as const }] : []), ...recovery]
      : items;
    if (combined.length) setMenu({ x: at.x, y: at.y, items: combined });
  };
  /**
   * The menu of what is in hand (several layers, a layer, a whole clip), opened at `p` (overlay px): the right-click's
   * and the selection bar's (its tools are this menu's items). A delete leaves no frame behind (the thing is gone).
   */
  const heldMenu = (p: { x: number; y: number }): readonly ContextMenuEntry[] => {
    if (!menuFor) return [];
    const dropOnDelete = (items: readonly ContextMenuEntry[]) => items.map((entry) => ('label' in entry && entry.id === 'delete' && entry.onSelect
      ? { ...entry, onSelect: () => { entry.onSelect!(); dropPick(); } }
      : entry));
    const many = multiRef.current;
    if (many) {
      return dropOnDelete(menuFor(many[0]!.element, {
        arrange: null,
        at: p,
        multi: many.map((i) => i.element),
        align: (edge) => alignMany(edge),
      }));
    }
    const held = pickedRef.current;
    const element = held?.element;
    if (!element) return [];
    const layer = held.layer;
    return dropOnDelete(menuFor(element, {
      locked: Boolean(layer?.locked),
      ...(element.text && onEditTextInline && layer ? { editText: () => { startTextEditRef.current(); } } : {}),
      arrange: layer ? arrangeOf(layer.handle) : null,
      at: p,
    }));
  };
  const onStageContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!menuFor) return;
    const at = { x: e.clientX, y: e.clientY };
    const openMenu = (items: readonly ContextMenuEntry[]) => openMenuAt(at, items);
    const p = local(e);
    const vs = viewScaleNow();
    /* several selected, right-click inside their box: the menu is about them */
    const many = multiRef.current;
    const box0 = pickedRef.current?.rect;
    if (many && box0 && insideBox(scaleBox(box0, vs), p.x, p.y)) {
      openMenu(heldMenu(p));
      return;
    }
    const token = ++pressSeq.current;
    const forHeld = () => openMenu(heldMenu(p));
    /* inside what is in hand: that; elsewhere select what is under the pointer first (locked ones too: to unlock) */
    const held = pickedRef.current;
    if (held?.element && insideBox(scaleBox(held.rect, vs), p.x, p.y)) { forHeld(); return; }
    void ask<StageLayer>('hit', { x: p.x / vs, y: p.y / vs, includeLocked: true, from: held?.layer?.handle ?? null, detail: true }).then((layer) => {
      if (token !== pressSeq.current) return;
      if (!layer) { openMenu([]); return; }
      commitHit(hitOf(layer));
      forHeld();
    });
  };

  const onStageDoubleClick = (e: React.MouseEvent) => {
    const p = local(e);
    const vs = viewScaleNow();
    const held = pickedRef.current;
    e.stopPropagation();
    const token = ++pressSeq.current;
    /* where the double-click began, in the film's own pixels: its first click can open the inspector, and the picture
       shrinks under the hand before the second — taken where the second landed on screen, it typed in another line */
    const first = lastPressRef.current;
    const at = first && e.timeStamp - first.at < DOUBLE_PRESS_MS ? { x: first.x, y: first.y } : { x: p.x / vs, y: p.y / vs };
    const inside = held && insideBox(held.rect, at.x, at.y);
    /* cropping, a double-click keeps the crop (as in Figma); on the video or still in hand, it starts one */
    if (cropRef.current) { finishCrop(true); return; }
    const outer = held?.element;
    const t = liveTRef.current ?? outer?.transform;
    if (outer?.isMgOuter && outer.mgBox && outer.clipLoc && t
      && insideFrame(visibleFrame(t, outer.mgBox, infoOf(outer.clipLoc)?.crop ?? NO_CROP), at.x, at.y) && startCrop()) return;
    void (async () => {
      /* double-click a group: go in, selecting the layer under the pointer (a group in it: one level). Double-click
         that to type. */
      if (inside && held?.layer?.group) {
        const layer = await ask<StageLayer>('hit', { ...at, from: held.layer.handle, enter: true, detail: true });
        if (token !== pressSeq.current) return;
        if (layer && layer.handle !== held.layer.handle) { commitHit(hitOf(layer)); return; }
      }
      if (!inside || !held?.element?.text) {
        const layer = await ask<StageLayer>('hit', { ...at, from: held?.layer?.handle ?? null, detail: true });
        if (token !== pressSeq.current || !layer?.text) return;
        commitHit(hitOf(layer));
      }
      startTextEditRef.current();
    })();
  };

  /* ── during playback: the pointer stands still and the picture moves under it ── */
  const flushMove = (): void => {
    moveRaf.current = 0;
    const at = moveAt.current;
    const r = filmRect();
    if (!at || !r) return;
    const x = at.cx - r.left;
    const y = at.cy - r.top;
    const vs = r.width / stage.w;
    if (gestureRef.current) {
      applyMgGesture({ x: x / vs, y: y / vs }, Boolean(at.shift), Boolean(at.alt));
      return;
    }
    if (draftRef.current) {
      draftRef.current = { ...draftRef.current, x2: x, y2: y };
      setDraft(draftRef.current);
      return;
    }
    if (!hoverEnabledRef.current || textEdit.current) return;
    hoverQueue.push({ x: x / vs, y: y / vs, from: pickedRef.current?.layer?.handle ?? null });
  };
  const flushMoveRef = React.useRef(flushMove);
  flushMoveRef.current = flushMove;
  React.useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => {
      if (moveAt.current && !gestureRef.current && !draftRef.current) flushMoveRef.current();
      if (pickedRef.current) syncQueue.push(0);
    }, 80);
    return () => window.clearInterval(timer);
  }, [playing, syncQueue]);

  /* ── what is drawn ── */
  const vsNow = viewScaleNow();
  const heldT = liveT ?? picked?.element?.transform ?? null;
  /* a whole clip is held by the part of it that shows */
  const heldCrop = picked?.element?.isMgOuter && picked.element.clipLoc ? infoOf(picked.element.clipLoc)?.crop ?? NO_CROP : NO_CROP;
  const mgFrame: FrameGeometry | null = onEditClip && picked?.element?.isMgOuter && heldT && picked.element.mgBox && !lockedClip(picked.element.clipLoc)
    ? scaleFrame(visibleFrame(heldT, picked.element.mgBox, heldCrop), vsNow)
    : null;
  /* a group only moves: it fills the stage, so scaling or turning it would go about the stage's middle */
  const heldLayer = picked?.layer;
  const layerFrame: FrameGeometry | null = !mgFrame && picked?.element && layerMovable(heldLayer, picked.element)
    && editingText == null && !heldLayer.group
    ? scaleFrame(heldLayer.frame, vsNow)
    : null;
  /* the mask is drawn in the whole box (a crop does not move it); its handles stand in for the frame's meanwhile */
  const maskTarget = maskSession?.target;
  const maskBox: FrameGeometry | null = !maskTarget || cropping || editingText != null || !picked?.element ? null
    : maskTarget.kind === 'clip'
      ? (mgFrame && heldT && picked.element.mgBox && picked.element.clipLoc === maskTarget.clipLoc
        ? scaleFrame(visibleFrame(heldT, picked.element.mgBox, NO_CROP), vsNow) : null)
      : (heldLayer && !heldLayer.group && !multi && picked.element.loc === maskTarget.loc ? scaleFrame(heldLayer.frame, vsNow) : null);
  const outline = (f: FrameGeometry) => (
    <Box rect={{ left: f.cx - f.w / 2, top: f.cy - f.h / 2, width: f.w, height: f.h }} frame={f} tone="hover" />
  );
  const sizeLabel = (f: FrameGeometry) => `${Math.round(f.w / vsNow)} × ${Math.round(f.h / vsNow)}`;
  const stageBounds = { w: stage.w * vsNow, h: stage.h * vsNow };
  React.useEffect(() => {
    if (!picked) { reportGeometry(null); return; }
    /* 1920 measured through a 418px-wide preview comes back as 1919.9: within 0.15 of a whole number is that number */
    const round = (v: number) => {
      const whole = Math.round(v);
      return Math.abs(v - whole) < 0.15 ? whole : Math.round(v * 10) / 10;
    };
    if (picked && multi) {
      reportGeometry({
        kind: 'group',
        loc: null,
        x: round(picked.rect.left),
        y: round(picked.rect.top),
        w: round(picked.rect.width),
        h: round(picked.rect.height),
        r: 0,
        unit: 1,
        group: { n: multi.length, kinds: [...new Set(multi.map((i) => i.layer.kind))] },
        stage,
      });
      return;
    }
    if (!picked.element) { reportGeometry(null); return; }
    if (mgFrame && heldT && picked.element.mgBox) {
      const size = mgSize(heldT, picked.element.mgBox);
      reportGeometry({
        kind: 'clip',
        loc: picked.element.clipLoc ?? null,
        x: round((picked.element.mgBox.x ?? 0) + heldT.x),
        y: round((picked.element.mgBox.y ?? 0) + heldT.y),
        w: round(size.w),
        h: round(size.h),
        r: round(heldT.rotate || 0),
        unit: 1,
        box: picked.element.mgBox,
        stage,
      });
      return;
    }
    const layer = picked.layer;
    if (!layer) { reportGeometry(null); return; }
    const f = layer.frame;
    reportGeometry({
      kind: 'layer',
      loc: picked.element.loc,
      x: round(f.cx - f.w / 2),
      y: round(f.cy - f.h / 2),
      w: round(f.w),
      h: round(f.h),
      /* its own angle: what the inspector types is what the override says, without its parents' (see parentR) */
      r: round(f.r - layer.geo.around),
      parentR: round(layer.geo.parentR),
      unit: 1 / (layer.geo.k || 1),
      stage,
    });
  });

  /** A region drawn: flashed at once, then handed on with the clips and words the film finds in it. */
  const pointAt = async (box: StageBox) => {
    showFlash(box);
    const [clips, layers] = await Promise.all([
      ask<{ id: string; visible: boolean; x: number; y: number; w: number; h: number }[]>('clips'),
      ask<StageLayer[]>('box', { ...box, all: true }),
    ]);
    onRegion?.({ box, clipIds: regionClipIds(clips ?? [], box), texts: regionTexts(layers ?? []) });
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (moveRaf.current) {
      cancelAnimationFrame(moveRaf.current);
      moveRaf.current = 0;
    }
    if (cropDrag.current) {
      e.stopPropagation();
      if (e.type === 'pointerup') stepCrop(local(e), e.shiftKey);
      cropDrag.current = null;
      setDragging(false);
      setHint(null);
      return;
    }
    const vs = viewScaleNow();
    const region = regionDraftRef.current;
    if (region) {
      regionDraftRef.current = null;
      setRegionDraft(null);
      e.stopPropagation();
      /* only a release draws it: a cancelled gesture (the system took the pointer) points at nothing */
      const p = local(e);
      const box = e.type === 'pointerup' ? regionBox({ ...region, x2: p.x, y2: p.y }, vs, stage) : null;
      if (box) void pointAt(box);
      return;
    }
    const md = multiDrag.current;
    if (md) {
      multiDrag.current = null;
      e.stopPropagation();
      setDragging(false);
      if (md.moved) {
        void multiPaint.idle().then(() => onTransformLayers?.(md.items.map((it) => ({ element: it.element, g: it.now }))));
        return;
      }
      /* not pulled open: a click on one of them selects that one */
      const p = local(e);
      const token = ++pressSeq.current;
      void ask<StageLayer>('hit', { x: p.x / vs, y: p.y / vs, detail: true }).then((layer) => {
        if (layer && token === pressSeq.current) commitHit(hitOf(layer));
      });
      return;
    }
    const drag = layerDrag.current;
    if (drag) {
      if (layerRaf.current) {
        cancelAnimationFrame(layerRaf.current);
        layerRaf.current = 0;
        const at = layerMoveAt.current;
        layerMoveAt.current = null;
        if (at) stepLayerGesture(at.p, at.mods);
      }
      layerDrag.current = null;
      e.stopPropagation();
      if (drag.moved) {
        setDragging(false);
        setHint(null);
        setLiveGuides(NO_GUIDES);
        /* written as drawn: after the last step's answer (a scale's offset is the film's to work out) */
        void layerPaint.idle().then(() => commitLayer(drag.element, drag.layer, drag.base, drag.now));
        return;
      }
      /* not pulled open: a click; select what was clicked (most often itself) */
      const p = local(e);
      const token = ++pressSeq.current;
      void ask<StageLayer>('hit', { x: p.x / vs, y: p.y / vs, from: drag.layer.handle, detail: true }).then((layer) => {
        if (token !== pressSeq.current) return;
        commitHit(layer ? hitOf(layer) : null);
      });
      return;
    }
    if (gestureRef.current) {
      e.stopPropagation();
      const p = local(e);
      if (gestureRef.current.pendingClick) {
        /* a click on the clip in hand: the top clip under the pointer is taken in hand */
        const g = gestureRef.current;
        gestureRef.current = null;
        liveTRef.current = null;
        liveBoxRef.current = null;
        setLiveT(null);
        const at = g.hit ?? p;
        const token = ++pressSeq.current;
        void ask<string>('clipAt', { x: at.x / vs, y: at.y / vs }).then((id) => {
          if (token !== pressSeq.current) return;
          const loc = id ? clipLocOf(docRef.current, id) : undefined;
          const info = loc ? infoOf(loc) : null;
          commitHit(info ? describeClip(info, stage) : null);
        });
        return;
      }
      applyMgGesture({ x: p.x / vs, y: p.y / vs }, e.shiftKey, e.altKey);
      endMgGesture();
      return;
    }
    const start = draftRef.current;
    if (!start) return;
    e.stopPropagation();
    const p = local(e);
    const box = { left: Math.min(start.x1, p.x), top: Math.min(start.y1, p.y), width: Math.abs(p.x - start.x1), height: Math.abs(p.y - start.y1) };
    draftRef.current = null;
    setDraft(null);
    const shift = e.shiftKey;
    const alt = e.altKey;
    const base = shiftBase.current;
    shiftBase.current = null;
    const cycle = alt ? cycleFrom.current : null;
    const from = pressedFrom.current;
    cycleFrom.current = null;
    pressedFrom.current = null;
    const token = pressSeq.current;
    void (async () => {
      /* the press was on a clip selected on the timeline: not a click elsewhere, nothing happens */
      if (!(await pressGo.current)) return;
      if (token !== pressSeq.current) return;
      /* the threshold is in stage px: the same gesture is a click in a small window and in full screen alike */
      if (box.width / vs >= MARQUEE_MIN_PX && box.height / vs >= MARQUEE_MIN_PX) {
        /* the outermost layers wholly inside are selected (Figma); Shift adds them to what was selected */
        const inside = await ask<StageLayer[]>('box', { x: box.left / vs, y: box.top / vs, w: box.width / vs, h: box.height / vs }) ?? [];
        if (token !== pressSeq.current) return;
        const prior = shift ? (base ?? []) : [];
        const all = [...prior, ...inside.filter((l) => !prior.some((b) => b.handle === l.handle))];
        if (all.length) selectMany(all);
        else commitHit(null);
        return;
      }
      /* not pulled open far enough: a click. A layer of a page is selected, else a video or still; on nothing, nothing is */
      const layer = await ask<StageLayer>('hit', { x: p.x / vs, y: p.y / vs, cycleFrom: cycle, from, detail: true });
      if (token !== pressSeq.current) return;
      /* Shift-click adds to / takes from the selection (Figma) */
      if (base && layer) {
        const has = base.some((b) => b.handle === layer.handle);
        setHover(null);
        selectMany(has ? base.filter((b) => b.handle !== layer.handle) : [...base, layer]);
        return;
      }
      if (layer) {
        setHover(null);
        commitHit(hitOf(layer));
        return;
      }
      /* no layer of a page there: the video or still under the pointer is taken in hand, as on the timeline */
      const id = !base && onEditClip ? await ask<string>('clipAt', { x: p.x / vs, y: p.y / vs, pictures: true }) : null;
      if (token !== pressSeq.current) return;
      const loc = id ? clipLocOf(docRef.current, id) : undefined;
      const info = loc ? infoOf(loc) : null;
      commitHit(info ? describeClip(info, stage) : null);
    })();
  };

  /** At the press: the layer in hand (Alt-click cycles from it; a click in a group picks inside it once entered). */
  const cycleFrom = React.useRef<number | null>(null);
  const pressedFrom = React.useRef<number | null>(null);
  const shiftBase = React.useRef<StageLayer[] | null>(null);
  /** Whether the press goes on (false: it was on a clip selected on the timeline, see the press). */
  const pressGo = React.useRef<Promise<boolean>>(Promise.resolve(true));

  const draftRect = draft
    ? { left: Math.min(draft.x1, draft.x2), top: Math.min(draft.y1, draft.y2), width: Math.abs(draft.x2 - draft.x1), height: Math.abs(draft.y2 - draft.y1) }
    : null;
  const linkedShown = linkedOutlines(linkedMarks, picked?.element?.clipLoc, dragging);
  /* the clip of a pill hovered in the app's chat, where it is drawn now */
  const chatClip = chat?.clipLoc ? clipInfo(doc, spans, stage, chat.clipLoc) : null;

  /* ── the bar beside what is in hand (SelectionToolbar): its tools are the menu's items ── */
  const t = useT();
  const stageBoxOf = (r: ClientBox): StageBox => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  const pickedItems = (): StagePick[] => {
    const many = multiRef.current;
    if (many) return many.map((it) => ({ element: it.element, box: stageBoxOf(it.layer.rect) }));
    const held = pickedRef.current;
    if (!held?.element) return [];
    const whole = held.element.kind === 'clip' || held.element.isMgOuter;
    return [{ element: held.element, box: whole ? null : stageBoxOf(held.layer?.rect ?? held.rect) }];
  };
  const pickedItemsRef = React.useRef(pickedItems);
  pickedItemsRef.current = pickedItems;
  /** Space several layers evenly (as the inspector does several clips): one save. */
  const distributeMany = (axis: 'x' | 'y') => {
    const items = multiItemsNow();
    if (items.length < 3 || !onTransformLayers) return;
    const vs = viewScaleNow();
    const shifts = distributeShifts(items.map((it) => scaleBox(it.layer.rect, vs)), axis);
    shiftLayers(items, (i) => shifts[i]!.dx, (i) => shifts[i]!.dy);
    onTransformLayers(items.map((it) => ({ element: it.element, g: it.now })));
  };
  const heldEl = picked?.element;
  const barKind = !selectionBar || !picked ? null : multi ? 'layers' : !heldEl ? null : heldEl.kind === 'clip' || heldEl.isMgOuter ? 'clip' : 'layer';
  const barTools = ((): SelectionToolEntry[] => {
    if (!barKind) return [];
    const out: SelectionToolEntry[] = [];
    const entries = heldMenu({ x: 0, y: 0 });
    const find = (id: string): ContextMenuItem | null => {
      for (const e of entries) {
        if ('separator' in e) continue;
        if (e.id === id) return e;
        for (const sub of e.submenu ?? []) if (!('separator' in sub) && sub.id === id) return sub;
      }
      return null;
    };
    const tools: SelectionToolEntry[] = [];
    const fromMenu = (id: string, icon?: React.ReactNode) => {
      const item = find(id);
      if (!item || item.submenu) return;
      tools.push({
        id, label: item.label, icon: icon ?? item.icon,
        ...(item.shortcut ? { shortcut: item.shortcut } : {}), ...(item.hint ? { hint: item.hint } : {}),
        ...(item.disabled ? { disabled: true } : {}), ...(item.danger ? { danger: true } : {}),
        onSelect: () => item.onSelect?.(),
      });
    };
    if (barKind === 'layer') for (const id of ['edit-text', 'front', 'back', 'hide', 'reset']) fromMenu(id);
    if (barKind === 'clip') {
      if (heldEl?.clipKind === 'video' && onEditClip) tools.push({ id: 'crop', label: t('selectionBar.crop'), icon: <CropIcon size={14} />, shortcut: 'C', onSelect: () => { startCrop(); } });
      if (onStartMask) tools.push({ id: 'mask', label: t('selectionBar.mask'), icon: <SquareDashed size={14} />, onSelect: onStartMask });
      fromMenu('reset');
    }
    if (barKind === 'layers') {
      fromMenu('align-left', <AlignStartVertical size={14} />);
      fromMenu('align-hcenter', <AlignCenterVertical size={14} />);
      fromMenu('align-right', <AlignEndVertical size={14} />);
      fromMenu('align-top', <AlignStartHorizontal size={14} />);
      fromMenu('align-vcenter', <AlignCenterHorizontal size={14} />);
      fromMenu('align-bottom', <AlignEndHorizontal size={14} />);
      if ((multi?.length ?? 0) >= 3 && onTransformLayers) {
        tools.push({ id: 'distribute-x', label: t('inspector.distributeH'), icon: <AlignHorizontalDistributeCenter size={14} />, onSelect: () => distributeMany('x') });
        tools.push({ id: 'distribute-y', label: t('inspector.distributeV'), icon: <AlignVerticalDistributeCenter size={14} />, onSelect: () => distributeMany('y') });
      }
    }
    out.push(...tools);
    if (entries.length) {
      out.push({
        id: 'more', label: t('selectionBar.more'), icon: <MoreHorizontal size={14} />,
        onSelect: (button) => {
          const r = button.getBoundingClientRect();
          openMenuAt({ x: r.left, y: r.bottom + 4 }, heldMenu(local({ clientX: r.left + r.width / 2, clientY: r.bottom })));
        },
      });
    }
    return out;
  })();
  /* where it is drawn (overlay px): its frame (turned: the box around it), else its shape, else several's union */
  const aabbOf = (f: FrameGeometry): ClientBox => { const a = frameAabb(f); return { left: a.x, top: a.y, width: a.w, height: a.h }; };
  const barBox = !barKind || !picked ? null : mgFrame ? aabbOf(mgFrame) : layerFrame ? aabbOf(layerFrame) : scaleBox(picked.layer?.rect ?? picked.rect, vsNow);
  const barBoxRef = React.useRef(barBox);
  barBoxRef.current = barBox;
  /* inside the viewer: from its top (its bar of buttons) to the bottom of the picture's area (not over the transport) */
  const measureBar = () => {
    const box = barBoxRef.current;
    const film = stageLayer.current?.getBoundingClientRect();
    if (!box || !film) return null;
    const pane = host.current?.closest('[data-viewer-pane]')?.getBoundingClientRect();
    const area = host.current?.closest('[data-viewer-picture]')?.getBoundingClientRect() ?? pane;
    const top = pane?.top ?? 0;
    const bounds = area
      ? { left: area.left, top, width: area.width, height: area.bottom - top }
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    return { anchor: { left: film.left + box.left, top: film.top + box.top, width: box.width, height: box.height }, bounds };
  };
  const barKey = !barKind ? null
    : barKind === 'layers' ? `layers:${(multi ?? []).map((i) => i.layer.handle).join(',')}`
      : barKind === 'clip' ? `clip:${heldEl?.clipLoc ?? ''}` : `layer:${heldEl?.loc ?? ''}:${picked?.layer?.handle ?? ''}`;
  const barLead = barKind && onRefer ? {
    id: 'refer', label: t('selectionBar.addToChat'), icon: <MessageSquarePlus size={14} />, shortcut: shortcutHint('L', { mod: true }),
    onSelect: () => onRefer(pickedItems()),
  } : null;
  const barLabel = barKind === 'layers' ? t('selectionBar.layers').replace('{n}', String(multi?.length ?? 0)) : undefined;

  return (
    <div
      ref={host}
      data-film-select
      /* below the subtitles (z-5): they must get the pointer in their own box to be dragged */
      /* the cursor stays an arrow: text cursors over the size label would read as "this can be typed in" */
      className="absolute inset-0 z-[4] cursor-default overflow-visible"
      /* while typing in place the overlay steps aside: the pointer goes to the line (move the caret, select words) */
      style={{ touchAction: 'none', pointerEvents: editingText != null ? 'none' : undefined, ...(modAt || regionDraft ? { cursor: 'crosshair' } : {}) }}
      onDoubleClick={onStageDoubleClick}
      onContextMenu={onStageContextMenu}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        /* pause at the press, not the release: a clock still running would move the selection off under the hand */
        onPause?.();
        const p = local(e);
        /* the first press of a double-click is kept: the second one lands where the picture has moved to */
        const prev = lastPressRef.current;
        if (!prev || e.timeStamp - prev.at > DOUBLE_PRESS_MS) lastPressRef.current = { x: p.x / viewScaleNow(), y: p.y / viewScaleNow(), at: e.timeStamp };
        /* ⌘ held: a box to point at in the chat, whatever is under the press (nothing is selected or moved) */
        if (onRegion && regionKeyHeld(e)) {
          e.currentTarget.setPointerCapture(e.pointerId);
          regionDraftRef.current = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
          setRegionDraft(regionDraftRef.current);
          setHover(null);
          return;
        }
        measureAt(null);
        const vs = viewScaleNow();
        const stagePt = { x: p.x / vs, y: p.y / vs };
        const target = e.target as HTMLElement | null;
        /* cropping: the crop's handles move its edges, a press inside it pans; a press elsewhere keeps the crop */
        const crop = cropRef.current;
        if (crop) {
          const part = target?.closest('[data-crop-kind]');
          const kind = part?.getAttribute('data-crop-kind');
          if (kind === 'move' || kind === 'scale' || kind === 'stretch') {
            cropDrag.current = {
              kind,
              handle: HANDLE_AT[part?.getAttribute('data-crop-handle') ?? ''] ?? { hx: 0, hy: 0 },
              start: stagePt,
              rect0: crop.rect,
              pos0: crop.pos,
            };
            setDragging(true);
            e.currentTarget.setPointerCapture(e.pointerId);
          } else {
            finishCrop(true);
          }
          return;
        }
        const handle = target?.closest('[data-mg-handle]:not([data-mg-kind="move"])') as HTMLElement | null;
        const moveClip = target?.closest('[data-mg-kind="move"]');
        const outer = pickedRef.current?.element;
        const origin = liveTRef.current ?? outer?.transform;
        const currentTarget = e.currentTarget;
        const pointerId = e.pointerId;
        ++pressSeq.current;
        pressGo.current = Promise.resolve(true);
        const startGesture = (g: Omit<NonNullable<typeof gestureRef.current>, 'snapTargets'>) => {
          if (clipNudge.current) flushClipNudge();
          const gesture = { ...g, snapTargets: [{ x: 0, y: 0, w: stage.w, h: stage.h }] };
          gestureRef.current = gesture;
          /* counted once at the press, and only a move or a scale uses them: the stage first (it wins ties), then the
             part of each clip on screen now that shows */
          if (g.kind !== 'rotate') {
            void ask<{ id: string; visible: boolean; x: number; y: number; w: number; h: number }[]>('clips').then((list) => {
              if (gestureRef.current !== gesture || !list) return;
              gesture.snapTargets = [gesture.snapTargets[0]!, ...list.filter((c) => c.visible && c.id !== g.clipId).map(shownBoxOf)];
            });
          }
          liveTRef.current = g.origin;
          setLiveT(g.origin);
          /* a handle has no "maybe a click": pressed is dragging */
          if (!g.pendingClick) setDragging(true);
          currentTarget.setPointerCapture(pointerId);
        };
        const outerCrop = outer?.isMgOuter && outer.clipLoc ? infoOf(outer.clipLoc)?.crop ?? NO_CROP : NO_CROP;
        const stretchable = outer?.clipKind === 'video';
        if (onEditClip && handle && outer?.isMgOuter && outer.clipLoc && outer.clipId && outer.mgBox && origin && !lockedClip(outer.clipLoc)) {
          const kind = handle.getAttribute('data-mg-kind');
          const at = HANDLE_AT[handle.getAttribute('data-mg-handle') ?? ''];
          startGesture({
            kind: kind === 'rotate' ? 'rotate' : 'scale',
            ...(kind !== 'rotate' && at ? { handle: at } : {}),
            stretchable,
            start: stagePt,
            origin,
            box: outer.mgBox,
            crop: outerCrop,
            clipLoc: outer.clipLoc,
            clipId: outer.clipId,
          });
          return;
        }
        /*
         * A press inside the clip in hand moves it. Only the clip in hand: if a press on any clip started a drag,
         * every drag would move something and the marquee would never happen (and a move is a real edit).
         */
        if (onEditClip && outer?.isMgOuter && outer.clipLoc && outer.clipId && outer.mgBox && origin && !lockedClip(outer.clipLoc)
          && (moveClip || insideFrame(visibleFrame(origin, outer.mgBox, outerCrop), stagePt.x, stagePt.y))) {
          startGesture({
            kind: 'move',
            stretchable,
            pendingClick: true,
            start: stagePt,
            origin,
            box: outer.mgBox,
            crop: outerCrop,
            clipLoc: outer.clipLoc,
            clipId: outer.clipId,
            hit: { x: p.x, y: p.y },
          });
          return;
        }
        /* several selected: a press inside their box drags them all (Shift adds / takes away instead) */
        const many = multiRef.current;
        const held0 = pickedRef.current;
        if (many && held0 && !e.shiftKey && onTransformLayers && !many.some((it) => lockedClip(it.element.clipLoc)) && insideBox(scaleBox(held0.rect, vs), p.x, p.y)) {
          multiDrag.current = { x: p.x, y: p.y, moved: false, rect0: held0.rect, items: multiItemsNow() };
          currentTarget.setPointerCapture(pointerId);
          return;
        }
        shiftBase.current = e.shiftKey ? selectedLayers() : null;
        /* the layer in hand: its handles scale / turn it, a press in its box moves it (Alt in its box is kept for
           cycling down) */
        const held = pickedRef.current;
        const heldLayer0 = held?.layer;
        const layerHandle = target?.closest('[data-layer-kind]') as HTMLElement | null;
        const layerKind = layerHandle?.getAttribute('data-layer-kind');
        if (held?.element && layerMovable(heldLayer0, held.element)) {
          const base = heldLayer0.geo.g;
          const frame0 = scaleFrame(heldLayer0.frame, vs);
          const aabb0 = scaleBox(heldLayer0.rect, vs);
          const inside = insideBox(scaleBox(held.rect, vs), p.x, p.y);
          const kind = layerKind === 'scale' ? 'scale'
            : layerKind === 'stretch' ? 'stretch'
              : layerKind === 'rotate' ? 'rotate'
                : (layerKind === 'move' || inside) && !e.altKey ? 'move' : null;
          const at = HANDLE_AT[layerHandle?.getAttribute('data-layer-handle') ?? ''] ?? { hx: 0, hy: 0 };
          if (kind) {
            if (nudge.current) flushNudge();
            const d: LayerDrag = {
              kind,
              hx: at.hx,
              hy: at.hy,
              x: p.x,
              y: p.y,
              base,
              frame0,
              aabb0,
              scale: heldLayer0.geo.k * vs,
              layer: heldLayer0,
              element: held.element,
              /* a handle drags at once; a press in the box may be a click until it goes 4px */
              moved: kind !== 'move',
              now: base,
              targets: [{ x: 0, y: 0, w: stage.w * vs, h: stage.h * vs }],
            };
            layerDrag.current = d;
            if (kind !== 'rotate') {
              void ask<{ x: number; y: number; w: number; h: number }[]>('snaps', { handle: heldLayer0.handle }).then((list) => {
                if (list && layerDrag.current === d) d.targets = list.map((r) => ({ x: r.x * vs, y: r.y * vs, w: r.w * vs, h: r.h * vs }));
              });
            }
            if (kind !== 'move') {
              setDragging(true);
              setHover(null);
            }
            currentTarget.setPointerCapture(pointerId);
            return;
          }
        }
        /* about to draw: the previous selection goes first (two boxes on screen would read as two selected), and the
           timeline's with it; but a press on a clip selected there (several: no handles) is not a press elsewhere */
        cycleFrom.current = e.altKey ? pickedRef.current?.layer?.handle ?? null : null;
        pressedFrom.current = pickedRef.current?.layer?.handle ?? null;
        const clearPrevious = () => {
          dropPick();
          onSelectElement?.(null);
          setHover(null);
        };
        const linked = linkedLocs ?? [];
        if (linked.length) {
          pressGo.current = ask<string>('clipAt', stagePt).then((id) => {
            const loc = id ? clipLocOf(docRef.current, id) : undefined;
            if (loc && linked.includes(loc)) {
              draftRef.current = null;
              setDraft(null);
              return false;
            }
            clearPrevious();
            return true;
          });
        } else {
          clearPrevious();
        }
        /* a click or a marquee is decided at the release */
        currentTarget.setPointerCapture(pointerId);
        draftRef.current = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
        setDraft(draftRef.current);
      }}
      onPointerMove={(e) => {
        pointerAt.current = local(e);
        if (cropDrag.current) { stepCrop(local(e), e.shiftKey); return; }
        if (onRegion) {
          const p = local(e);
          const region = regionDraftRef.current;
          if (region) {
            regionDraftRef.current = { ...region, x2: p.x, y2: p.y };
            setRegionDraft(regionDraftRef.current);
            return;
          }
          const held = regionKeyHeld(e) && !gestureRef.current && !layerDrag.current && !multiDrag.current && !draftRef.current;
          setModAt(held ? p : null);
          /* nothing is hovered while ⌘ is held: what a box takes in is not one layer */
          if (held) { setHover(null); return; }
        }
        /* Alt held with something in hand: measuring, not hovering */
        if (e.altKey && pickedRef.current && !gestureRef.current && !layerDrag.current && !multiDrag.current && !draftRef.current && !cropRef.current) {
          measureAt(local(e));
          setHover(null);
          return;
        }
        if (altHeld.current) measureAt(null);
        if (multiDrag.current) {
          const d = multiDrag.current;
          const p = local(e);
          const dx = p.x - d.x;
          const dy = p.y - d.y;
          if (!d.moved && Math.hypot(dx, dy) < 4) return;
          if (!d.moved) { d.moved = true; setDragging(true); setHover(null); }
          shiftLayers(d.items, () => dx, () => dy);
          const vs = viewScaleNow();
          setPicked((cur) => (cur ? { ...cur, rect: { ...d.rect0, left: d.rect0.left + dx / vs, top: d.rect0.top + dy / vs } } : cur));
          return;
        }
        if (layerDrag.current) {
          /* one step a frame: a fast mouse sends several moves a frame, and only the last one shows */
          layerMoveAt.current = { p: local(e), mods: { shift: e.shiftKey, alt: e.altKey } };
          if (!layerRaf.current) {
            layerRaf.current = requestAnimationFrame(() => {
              layerRaf.current = 0;
              const at = layerMoveAt.current;
              layerMoveAt.current = null;
              if (at && layerDrag.current) stepLayerGesture(at.p, at.mods);
            });
          }
          return;
        }
        if (!gestureRef.current && !draftRef.current && !hoverEnabled) return;
        moveAt.current = { cx: e.clientX, cy: e.clientY, shift: e.shiftKey, alt: e.altKey };
        if (!moveRaf.current) moveRaf.current = requestAnimationFrame(flushMove);
      }}
      onPointerLeave={() => {
        pointerAt.current = null;
        setModAt(null);
        measureAt(null);
        if (moveRaf.current) {
          cancelAnimationFrame(moveRaf.current);
          moveRaf.current = 0;
        }
        moveAt.current = null;
        setHover(null);
      }}
      onPointerUp={endPointer}
      /* the system took the gesture (a pen cancelled, a dialog): released where it last was; the capture lost after a
         release finds nothing in hand and does nothing */
      onPointerCancel={endPointer}
      onLostPointerCapture={endPointer}
    >
      <div
        ref={stageLayer}
        className="absolute overflow-visible"
        style={{
          left: filmOffset.width ? filmOffset.left : 0,
          top: filmOffset.width ? filmOffset.top : 0,
          width: filmOffset.width || '100%',
          height: filmOffset.height || '100%',
        }}
      >
        {/* the clips selected elsewhere, under the selection: what is being moved is always on top */}
        {linkedShown.map((mark) => <MgOutline key={mark.loc} t={mark.t} box={mark.box} viewScale={vsNow} />)}
        {/* the menu is drawn on body, but React events bubble through the component tree: a press on an item must not
            reach the stage as a press on the picture */}
        {menu ? (
          <div
            className="contents"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => { e.stopPropagation(); e.preventDefault(); }}
          >
            <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
          </div>
        ) : null}
        {/* not on the layer in hand (it has its frame), not while drawing a marquee or dragging */}
        {hover && hoverEnabled && !draftRect && !dragging && editingText == null && !(picked && hover.handle === picked.layer?.handle) ? (
          <Box rect={scaleBox(hover.rect, vsNow)} frame={hover.frame && scaleFrame(hover.frame, vsNow)} tone="hover" />
        ) : null}
        {draftRect ? <Box rect={draftRect} tone="draft" /> : null}
        {regionDraft ? <Box rect={boxOfDrag(regionDraft)} tone="region" /> : null}
        {flash ? <Box rect={scaleBox({ left: flash.box.x, top: flash.box.y, width: flash.box.w, height: flash.box.h }, vsNow)} tone="region" fading={flash.fading} /> : null}
        {chatClip?.box ? <MgOutline t={chatClip.t} box={chatClip.box} viewScale={vsNow} color={CHAT_TONE} /> : null}
        {chat?.box ? <Box rect={scaleBox(clientOf(chat.box), vsNow)} tone="chat" /> : null}
        {chat?.numbered.map(({ n, box }) => (
          <React.Fragment key={n}>
            <Box rect={scaleBox(clientOf(box), vsNow)} tone="chat" />
            <span data-chat-number={n} className="pointer-events-none absolute flex h-[16px] min-w-[16px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full px-[4px] text-[10px] font-semibold leading-none tabular-nums text-white shadow-[0_1px_3px_rgba(0,0,0,.4)]"
              style={{ left: box.x * vsNow, top: box.y * vsNow, background: CHAT_TONE }}>{n}</span>
          </React.Fragment>
        ))}
        {modAt && !regionDraft && regionHint ? <GestureHint x={modAt.x} y={modAt.y} text={regionHint} /> : null}
        {liveGuides.map((g) => <Guide key={`${g.axis}:${g.at}`} guide={g} viewScale={vsNow} />)}
        {cropping ? (
          <CropOverlay
            session={cropping}
            viewScale={vsNow}
            moving={dragging}
            bounds={stageBounds}
            onAspect={setCropAspect}
            onDone={() => finishCrop(true)}
            onCancel={() => finishCrop(false)}
          />
        ) : null}
        {measure && picked ? <Measures lines={measure.lines} other={measure.other} viewScale={vsNow} /> : null}
        {hint ? <GestureHint x={hint.x} y={hint.y} text={hint.text} /> : null}
        {picked ? (
          <>
            {mgFrame ? (
              /* cropping, the crop's own frame is the one in hand */
              cropping ? null : maskBox ? outline(mgFrame) : (
                <StageTransformFrame
                  frame={mgFrame}
                  scope="mg"
                  edges={picked.element?.clipKind === 'video'}
                  moving={liveT != null && dragging}
                  label={sizeLabel(mgFrame)}
                  bounds={stageBounds}
                />
              )
            ) : layerFrame ? (
              maskBox ? outline(layerFrame) : (
                <StageTransformFrame frame={layerFrame} scope="layer" edges moving={dragging} label={sizeLabel(layerFrame)} bounds={stageBounds} />
              )
            ) : (
              /* what cannot be moved (a locked layer, a group, a clip without its size yet): its drawn shape */
              <Box
                rect={scaleBox(picked.layer?.rect ?? picked.rect, vsNow)}
                frame={picked.layer && !picked.layer.group ? scaleFrame(picked.layer.frame, vsNow) : undefined}
                tone="picked"
              />
            )}
            {maskBox && maskSession ? <StageMaskOverlay frame={maskBox} session={maskSession} /> : null}
            {/* several together: each one outlined (turned as drawn); the outer box is their union */}
            {multi ? multi.map((it) => (
              <Box key={it.layer.handle} rect={scaleBox(it.layer.rect, vsNow)} frame={scaleFrame(it.layer.frame, vsNow)} tone="hover" />
            )) : null}
          </>
        ) : null}
      </div>
      <SelectionToolbar
        selection={barKey}
        measure={measureBar}
        hidden={Boolean(playing || dragging || cropping || maskSession || regionDraft || draftRect || editingText != null)}
        lead={barLead}
        {...(barLabel ? { label: barLabel } : {})}
        tools={barTools}
        ariaLabel={t('selectionBar.toolbar')}
      />
    </div>
  );
}

/**
 * Memoized, and the time compared by its half-second bucket: the stage sits among a tree that renders for many other
 * reasons, and while playing the time changes every 50ms although only its bucket matters here.
 */
export const FilmStageSelect = React.memo(FilmStageSelectImpl, (a, b) => (
  a.previewRef === b.previewRef
  && a.stage.w === b.stage.w
  && a.stage.h === b.stage.h
  && a.doc === b.doc
  && a.spans === b.spans
  && a.onPause === b.onPause
  && a.onSelectElement === b.onSelectElement
  && a.onEditClip === b.onEditClip
  && Boolean(a.playing) === Boolean(b.playing)
  && staleBucket(a.timeMs) === staleBucket(b.timeMs)
  /* by content: the list is rebuilt with every film.html change while the selection is the same clips */
  && sameLocs(a.linkedLocs, b.linkedLocs)
  && a.selectRequest?.seq === b.selectRequest?.seq
  && a.clipPreviewRef === b.clipPreviewRef
  && a.lookPreviewRef === b.lookPreviewRef
  && a.controlRef === b.controlRef
  && a.onTransformLayer === b.onTransformLayer
  && a.onTransformLayers === b.onTransformLayers
  && a.onEditTextInline === b.onEditTextInline
  && a.onGeometry === b.onGeometry
  && a.menuFor === b.menuFor
  && a.recoveryMenu === b.recoveryMenu
  && a.onRegion === b.onRegion
  && a.regionHint === b.regionHint
  && a.flashBox?.seq === b.flashBox?.seq
  && samePictureMarks(a.chat, b.chat)
  && a.onHoverLayer === b.onHoverLayer
  && Boolean(a.selectionBar) === Boolean(b.selectionBar)
  && a.onRefer === b.onRefer
  && a.onStartMask === b.onStartMask
  && a.pointLayer?.clipId === b.pointLayer?.clipId
  && a.pointLayer?.loc === b.pointLayer?.loc
));

function sameLocs(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return (a?.length ?? 0) === (b?.length ?? 0);
  return a.length === b.length && a.every((loc, i) => loc === b[i]);
}

const boxOfDrag = (d: { x1: number; y1: number; x2: number; y2: number }): ClientBox => (
  { left: Math.min(d.x1, d.x2), top: Math.min(d.y1, d.y2), width: Math.abs(d.x2 - d.x1), height: Math.abs(d.y2 - d.y1) }
);

function Box({ rect, frame, tone, fading }: {
  rect: ClientBox;
  /** A turned layer: its turned frame, the same shape hit and selected (see the stage's frameOf). */
  frame?: StageFrame | undefined;
  /** `region`: a box pointed at in the chat (drawn with ⌘, or flashed when the app shows one); `chat`: what the chat
      points at now (a pill hovered there, the message being written). */
  tone: 'hover' | 'draft' | 'picked' | 'region' | 'chat';
  /** Fading out (a flashed region). */
  fading?: boolean;
}) {
  const turned = frame && frame.r ? frame : null;
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        ...(turned
          ? { left: turned.cx - turned.w / 2, top: turned.cy - turned.h / 2, width: turned.w, height: turned.h, transform: `rotate(${turned.r}deg)` }
          : { left: rect.left, top: rect.top, width: rect.width, height: rect.height }),
        border: tone === 'picked' || tone === 'region' ? `2px solid ${PICK_BLUE}` : `1px solid ${PICK_BLUE}`,
        ...(tone === 'draft' ? { background: 'rgba(12,140,232,.13)' } : {}),
        ...(tone === 'region' ? { background: 'rgba(12,140,232,.2)', borderRadius: 3, transition: 'opacity 300ms ease-out', opacity: fading ? 0 : 1 } : {}),
        ...(tone === 'picked' ? { background: 'rgba(12,140,232,.06)', boxShadow: '0 0 0 1px rgba(255,255,255,.45)' } : {}),
        ...(tone === 'chat' ? { border: `2px solid ${CHAT_TONE}`, borderRadius: 3, background: `color-mix(in srgb, ${CHAT_TONE} 10%, transparent)`, boxShadow: '0 0 0 1px rgba(255,255,255,.45)' } : {}),
      }}
    />
  );
}

/**
 * A snap guide, drawn only while snapped (a set of candidate lines always on screen would stop meaning "lined up"),
 * across the whole picture so it is plain what it lines up with.
 */
function Guide({ guide, viewScale }: { guide: MgGuide; viewScale: number }) {
  const at = guide.at * viewScale;
  return (
    <div
      className="pointer-events-none absolute z-[6]"
      style={guide.axis === 'x'
        ? { left: at, top: 0, bottom: 0, width: 1, background: PICK_BLUE }
        : { top: at, left: 0, right: 0, height: 1, background: PICK_BLUE }}
    />
  );
}

/**
 * Crop mode on the picture: the clip's whole box with what the crop cuts away darkened (a shadow thrown out of the
 * crop's rect, clipped by the box), its thirds, the crop's own frame and handles, and a bar of ratios with Done and
 * Cancel under it. Everything turns with the clip.
 */
function CropOverlay({ session: s, viewScale: vs, moving, bounds, onAspect, onDone, onCancel }: {
  session: { t: MgTransform; box: MgBox; size: { w: number; h: number }; rect: Rect; aspect: CropAspect };
  viewScale: number;
  moving: boolean;
  bounds: { w: number; h: number };
  onAspect: (aspect: CropAspect) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const whole = scaleFrame(visibleFrame(s.t, s.box, NO_CROP), vs);
  const frame = scaleFrame(visibleFrame(s.t, s.box, cropOfRect(s.rect, s.size.w, s.size.h)), vs);
  /* the bar under the crop, or over it when the stage's bottom is near (below is the viewer's own bar) */
  const around = frameAabb(frame);
  const BAR_H = 30;
  const below = around.y + around.h + 10;
  const barTop = below + BAR_H <= bounds.h ? below : Math.max(0, around.y - BAR_H - 10);
  const ratioLabel = (a: CropAspect) => (a === 'free' ? t('stageCrop.free') : a === 'original' ? t('stageCrop.original') : a);
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute overflow-hidden"
        style={{
          left: whole.cx - whole.w / 2,
          top: whole.cy - whole.h / 2,
          width: whole.w,
          height: whole.h,
          transform: whole.r ? `rotate(${whole.r}deg)` : undefined,
        }}
      >
        <div
          className="absolute"
          style={{ left: s.rect.x * vs, top: s.rect.y * vs, width: s.rect.w * vs, height: s.rect.h * vs, boxShadow: '0 0 0 100000px rgba(0,0,0,.55)' }}
        >
          {[1, 2].map((i) => (
            <React.Fragment key={i}>
              <div className="absolute inset-y-0 w-px bg-white/45" style={{ left: `${(i * 100) / 3}%` }} />
              <div className="absolute inset-x-0 h-px bg-white/45" style={{ top: `${(i * 100) / 3}%` }} />
            </React.Fragment>
          ))}
        </div>
      </div>
      <StageTransformFrame frame={frame} scope="crop" edges rotate={false} moving={moving} label={null} />
      {/* its own presses: none reaches the stage as a press on the picture, and its buttons take no focus (Enter
          stays Done) */}
      <div
        data-crop-bar
        role="toolbar"
        aria-label={t('stageCrop.bar')}
        className="absolute z-[9] flex -translate-x-1/2 items-center gap-0.5 whitespace-nowrap rounded-[6px] p-[3px] text-[11px] font-medium leading-[16px] text-white shadow-[0_2px_10px_rgba(0,0,0,.35)]"
        style={{ left: Math.min(Math.max(frame.cx, 0), bounds.w), top: barTop, height: BAR_H, background: 'rgba(30,30,30,.94)' }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.preventDefault()}
        onDoubleClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => { e.stopPropagation(); e.preventDefault(); }}
      >
        <span className="px-1.5 tabular-nums text-white/60">{Math.round(s.rect.w)} × {Math.round(s.rect.h)}</span>
        {CROP_ASPECTS.map((a) => (
          <button
            key={a}
            type="button"
            aria-pressed={s.aspect === a}
            className={`rounded-[4px] px-1.5 py-0.5 ${s.aspect === a ? 'bg-white/20' : 'hover:bg-white/10'}`}
            onClick={() => onAspect(a)}
          >
            {ratioLabel(a)}
          </button>
        ))}
        <span aria-hidden className="mx-1 h-4 w-px bg-white/20" />
        <button type="button" title={t('stageCrop.cancelHint')} className="rounded-[4px] px-2 py-0.5 hover:bg-white/10" onClick={onCancel}>
          {t('stageCrop.cancel')}
        </button>
        <button type="button" title={t('stageCrop.doneHint')} className="rounded-[4px] px-2 py-0.5" style={{ background: FRAME_BLUE }} onClick={onDone}>
          {t('stageCrop.done')}
        </button>
      </div>
    </>
  );
}

/**
 * Distances while Alt is held (Figma's): a red line across each gap with its length in stage px, dashed helpers from
 * the other box's edge, and the other box outlined.
 */
function Measures({ lines, other, viewScale: vs }: { lines: readonly MeasureLine[]; other: Rect | null; viewScale: number }) {
  return (
    <>
      {other ? (
        <div
          aria-hidden
          className="pointer-events-none absolute z-[6]"
          style={{ left: other.x * vs, top: other.y * vs, width: other.w * vs, height: other.h * vs, border: `1px solid ${MEASURE_RED}` }}
        />
      ) : null}
      {lines.map((l) => {
        const across = l.y1 === l.y2;
        const x = Math.min(l.x1, l.x2) * vs;
        const y = Math.min(l.y1, l.y2) * vs;
        const span = (across ? Math.abs(l.x2 - l.x1) : Math.abs(l.y2 - l.y1)) * vs;
        const stroke = `1px ${l.length == null ? 'dashed' : 'solid'} ${MEASURE_RED}`;
        return (
          <React.Fragment key={`${l.x1},${l.y1},${l.x2},${l.y2}`}>
            <div
              aria-hidden
              className="pointer-events-none absolute z-[6]"
              style={across ? { left: x, top: y, width: span, height: 0, borderTop: stroke } : { left: x, top: y, width: 0, height: span, borderLeft: stroke }}
            />
            {l.length != null ? (
              <div
                className="pointer-events-none absolute z-[7] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[3px] px-1 text-[10px] font-medium leading-[14px] text-white tabular-nums"
                style={{ left: ((l.x1 + l.x2) / 2) * vs, top: ((l.y1 + l.y2) / 2) * vs, background: MEASURE_RED }}
              >
                {Math.round(l.length)}
              </div>
            ) : null}
          </React.Fragment>
        );
      })}
    </>
  );
}
