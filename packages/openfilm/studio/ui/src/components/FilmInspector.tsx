/**
 * The inspector: what is selected right now, read like Figma's properties panel and adjusted as in an editor.
 *
 * One property model wherever a thing is: a whole clip on the timeline (a video, a still, a page), a layer inside a
 * page on the picture, several of either, and the film itself when nothing is selected. The same sections in the
 * same order, by how often they are used — position and size, crop and fill, appearance, adjustments, effects,
 * timing, sound, and the raw CSS folded away under Advanced — each with the same controls (inspector-fields) over
 * the same standard CSS (inspector-look, lib/clip-look). What is written is a clip's `style` (film.html), a layer's
 * override (`overrides`), or a clip's own attributes (`at`, `src`'s fragment, `speed`, `volume`, `class`): nothing
 * film.html does not already say.
 *
 * A write takes a round trip and a repaint of the film, so every field **paints first, then writes**: while a value
 * is dragged or typed only the picture changes; letting go, Enter or leaving the field commits. A refused write
 * paints the old value back — the picture must never keep a look the film does not have — and the reason shows in a
 * banner.
 */
import * as React from 'react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, ArrowRightToLine, AudioLines, Captions,
  ChevronRight, CircleAlert, Clapperboard, Film, Gauge, Image as ImageIcon, Link2, Maximize2, MousePointerClick,
  Lock, MoveHorizontal, Music, RotateCcw, Scissors, Shapes, Square, Type, Unlink2, Video, Volume2, X,
} from 'lucide-react';

import {
  FILM_DEFAULT_STAGE, FILM_SPEED_MAX, FILM_SPEED_MIN, filmClipKind, filmGainDbToVolume, filmSrcIsStill, filmVolumeToGainDb,
  parseFilmDocLoc, type FilmOverride,
} from '@/lib/film';
import { useT } from '@/i18n';
import { wrapDeg } from '@/lib/stage-gesture';
import {
  compactScale, isSvgTextTag, scalePair, sourceLocBare,
  type MgBox, type MgTransform, type NodeOverride, type OverridePivot, type StageElement, type StageElementStyle, type StageGeometry,
} from '@/lib/stage-types';
import type { OverrideGeometry } from '@/lib/film-overrides';
import { plainClipRefusal, type ClipEdit } from '@/lib/film-clip-edits';
import { clipFieldPart, clipFields, compactBox, transformOf } from '@/lib/stage-clip';
import type { TimelineBlock } from '@/lib/timeline-layout';
import { editsForMoves } from '@/lib/timeline-drag';
import { useTimelinePrefs } from '@/lib/timeline-prefs';
import { formatTimecode, FRAME_RATES, timecodeFps, useTimecodeFps } from '@/lib/timecode';
import { FILM_FRAME_IDS, filmFrameOf, filmFrameStage, type FilmFrameId } from '@/lib/film-frame';
import { declared, withDeclarations, type ClipLook } from '@/lib/clip-look';
import { PANE_BAR, PANE_BTN, PANE_ICON, PANE_TITLE } from './dock-pane-bar';
import { Tooltip } from './Tooltip';
import {
  ColorField, ICON, MIXED, NumField, RadiusGlyph, Row, RotateGlyph, Section, SectionAction, Segmented, SelectField, SliderField, SubLabel,
  useTimeUnit, type FieldApply, type Mixed,
} from './inspector-fields';
import {
  AdjustSection, AdvancedSection, AppearanceSection, CropSection, EffectsSection, MaskSection, NEUTRAL, TypographySection, camelOf,
  isNeutral, kebabOf, makeLook, rawDeclarations, type Look, type LookRead, type LookSet,
} from './inspector-look';
import type { MaskSession } from '@/lib/stage-mask';
import type { FadeMs } from '@/lib/clip-fade';
import type { FoundKind } from '@/lib/transitions';

/** A change of a layer's words (kept as its `text` override). `expect` is what it said before: painted back on refusal. */
export type StageTextEdit = {
  loc: string;
  value: string;
  expect: string;
};

/** Why a text change was refused. */
export type StageEditFailure = {
  error: string;
};

/** A text edit made in place on the picture was refused. `seq` goes up by one each time. */
export type InlineTextFailure = { loc: string; value: string; failure: StageEditFailure; seq: number };

/** A page clip's in-page changes (film.html `overrides`), and the selectors among them its page no longer has. */
export type PageChanges = { list: readonly FilmOverride[]; lost: readonly string[]; own?: readonly FilmOverride[] };

/** The film as the panel shows it when nothing is selected. */
export type FilmSummary = {
  /** The film's name (the project's). */
  title?: string;
  durationMs: number;
  tracks: number;
  clips: number;
  /** Nothing made yet: the stage itself may change shape (see FramePicker). */
  empty: boolean;
  /** Each track's name (P1, V2, A1; see filmTrackBadges), by its place in film.html. */
  badges?: readonly string[];
};

/** Several layers' overrides written at once (one write, one undo step). */
export type LayerEdit = { element: StageElement; patch: OverrideGeometry | null };

type T = ReturnType<typeof useT>;

/* ───────────────────────────── skin ───────────────────────────── */

const PANE = 'relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[7px]';

type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

const PIVOT_CENTER: OverridePivot = { hx: 0, hy: 0 };
const PIVOT_TOP_LEFT: OverridePivot = { hx: -1, hy: -1 };

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round1 = (n: number) => Math.round(n * 10) / 10;
/** How far off the stage a place or a size may be typed (px): far past any stage, short of where CSS loses digits. */
const COORD_LIMIT = 100_000;

/* ───────────────────────────── the panel ───────────────────────────── */

/**
 * A field is half edited (typed, not yet left) and the hand goes to pick something else on the picture: that field
 * has to commit first, then the selection may change. Otherwise the stage changes the selection on pointerdown, the
 * panel re-renders for the new layer, and the field is either unmounted (no blur, the edit is lost) or blurs and
 * writes to the new layer's place.
 *
 * Listening on window in the capture phase runs before anything on the stage, while the selection is still the old one.
 */
function useCommitBeforeLeaving(): void {
  React.useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const focus = document.activeElement as HTMLElement | null;
      if (!focus?.closest('[data-film-inspector]') || !/^(INPUT|TEXTAREA)$/.test(focus.tagName)) return;
      if ((e.target as Element | null)?.closest?.('[data-film-inspector]')) return;
      focus.blur();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, []);
}

export const FilmInspector = React.memo(function FilmInspector({
  element,
  clips,
  onEditClips,
  width,
  onClose,
  onEditStyle,
  onPreviewStyle,
  onEditText,
  onPreviewText,
  geometry,
  inlineTextFailure,
  onEditOverride,
  onPreviewOverride,
  onSelectParent,
  onSelectClip,
  onPreviewClip,
  pageChangesOf,
  clipLookOf,
  onPreviewLook,
  stage,
  onStartCrop,
  onEditMask,
  film,
  onCanvas,
  frame,
  layers,
  onEditLayers,
  locked = false,
  rate,
  fades,
  transition,
}: {
  element: StageElement | null;
  /** The clips selected on the timeline. A layer picked on the picture wins: one selection at a time. */
  clips?: readonly TimelineBlock[];
  /** Writes clip properties, through the same queue as dragging on the timeline. Resolves to an error when refused. */
  onEditClips?: (edits: ClipEdit[]) => Promise<string | null>;
  /** The pane's width (dragged at the divider beside the viewer). */
  width: number;
  onClose: () => void;
  /** Writes a style. Resolves to an error when refused (the panel then paints the old value back). */
  onEditStyle: (loc: string, patch: StageElementStyle) => Promise<string | null>;
  /** Paints a style on the picture without writing it. */
  onPreviewStyle: (loc: string, patch: StageElementStyle) => void;
  onEditText: (edit: StageTextEdit) => Promise<StageEditFailure | null>;
  /** Paints the words as they are typed (written on blur, see TextSection). */
  onPreviewText?: (loc: string, value: string) => void;
  /** Where the thing in hand is on the stage now (stage px, reported by the stage). */
  geometry?: StageGeometry | null;
  inlineTextFailure?: InlineTextFailure | null;
  /** Writes a layer's offset / scale / rotation / style override. `null` resets it. */
  onEditOverride?: (
    element: StageElement,
    patch: OverrideGeometry | null,
    allCopies: boolean,
    pivot?: OverridePivot,
  ) => Promise<string | null>;
  /** Paints an override without writing it. `pivot`: the point that stays put while scaling or turning. */
  onPreviewOverride?: (loc: string, g: NodeOverride, pivot?: OverridePivot) => void;
  /** Breadcrumb: select an outer layer (in the same clip), or the whole clip. */
  onSelectParent?: (loc: string, clipLoc?: string) => void;
  onSelectClip?: (clipLoc: string) => void;
  /** Moves the clip on the picture while its transform numbers are dragged (nothing written); null puts it back. */
  onPreviewClip?: (clipLoc: string, patch: Partial<MgTransform> | null) => void;
  /** A page clip's in-page changes (film.html `overrides`) and which of them its page no longer has. */
  pageChangesOf?: (clipLoc: string) => PageChanges | null;
  /** A clip's own CSS and `class` in film.html and how it looks now (see clip-look): its look sections read them. */
  clipLookOf?: (clipLoc: string) => { css: string; look: ClipLook | null; cls?: string } | null;
  /** Shows a clip in CSS not kept yet while a look value is dragged (null: its own again). */
  onPreviewLook?: (clipLoc: string, css: string | null) => void;
  /** The film's stage (for a clip's place when it is not on screen). */
  stage?: { w: number; h: number } | null;
  /** Crop & fill's Crop button: the picture's crop on the picture itself. */
  onStartCrop?: () => void;
  /** The Mask section's "Edit on picture": the mask's handles over the thing in hand (null: none). */
  onEditMask?: (session: MaskSession | null) => void;
  /** The film when nothing is selected. */
  film?: FilmSummary | null;
  /** The stage's shape, while nothing has been made yet (FramePicker's onCanvas). */
  onCanvas?: (next: FilmFrameId, size: { w: number; h: number }) => void;
  /** The delivery frame, once the film has content (FramePicker's delivery mode). */
  frame?: { value: FilmFrameId; onChange: (next: FilmFrameId) => void } | null;
  /** Several layers selected on the picture, and how to write them at once. */
  layers?: readonly StageElement[];
  onEditLayers?: (list: LayerEdit[]) => Promise<string | null>;
  /** What is selected is on a locked track: shown, not changed (its fields are off, and say why). */
  locked?: boolean;
  /** The project's frame rate (the film's panel): its value, whether it was taken from the footage, and a new one. */
  rate?: { fps: number; fromFootage: boolean; onChange: (fps: number) => void } | null;
  /** Each clip's fades, ms (clip id → [in, out]): the Fades section's values. */
  fades?: ReadonlyMap<string, FadeMs>;
  /** The transition picked on the timeline (no clip selected): its kind and length, made longer or taken away here. */
  transition?: TransitionPick | null;
}) {
  const t = useT();
  useCommitBeforeLeaving();
  /* frames are counted at the project's rate: the panel shows them anew when it changes */
  useTimecodeFps();
  const layer = element && element.kind !== 'clip' ? element : null;
  const clip = !layer && clips?.length === 1 ? clips[0]! : null;
  const many = !layer && clips && clips.length > 1 ? clips : null;
  const stageSize = stage ?? FILM_DEFAULT_STAGE;

  return (
    <div
      data-film-inspector
      className={`${PANE} shrink-0 bg-[var(--dock-pane)]`}
      style={{ width }}
    >
      <div className={PANE_BAR}>
        <span className={`${PANE_TITLE} px-1`}>{t('inspector.panel')}</span>
        <span className="min-w-0 flex-1" />
        <Tooltip label={t('inspector.hide')} side="bottom">
          <button type="button" onClick={onClose} aria-label={t('inspector.hide')} className={PANE_BTN}>
            <X size={PANE_ICON} />
          </button>
        </Tooltip>
      </div>
      {locked && (layer || clip || many) ? (
        <div role="status" data-inspector-locked="" className="mx-2 mb-1 flex items-center gap-1.5 rounded-md bg-[var(--fill-tsp)] px-2 py-1 text-[11px] text-[var(--text-muted)]">
          <Lock size={12} className="shrink-0" aria-hidden />
          <span className="min-w-0">{t('inspector.trackLocked')}</span>
        </div>
      ) : null}
      {/* a locked track's clip: every field off (the edits are refused anyway, see lib/track-lock) */}
      <fieldset disabled={locked && Boolean(layer || clip || many)} className="contents">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6">
        {layer ? (
          <LayerPanel
            key={`${layer.loc}|${layer.clipLoc ?? ''}`}
            element={layer}
            geometry={geometry}
            inlineTextFailure={inlineTextFailure}
            onEditStyle={onEditStyle}
            onPreviewStyle={onPreviewStyle}
            onEditText={onEditText}
            onPreviewText={onPreviewText}
            onEditOverride={onEditOverride}
            onPreviewOverride={onPreviewOverride}
            onSelectParent={onSelectParent}
            onSelectClip={onSelectClip}
            {...(onEditMask ? { onEditMask } : {})}
          />
        ) : clip ? (
          <ClipPanel
            key={clip.id}
            block={clip}
            geometry={geometry && geometry.kind === 'clip' && geometry.loc === clip.loc ? geometry : null}
            onEdit={onEditClips}
            onPreviewClip={onPreviewClip}
            {...(pageChangesOf ? { pageChangesOf } : {})}
            {...(clipLookOf ? { clipLookOf } : {})}
            {...(onPreviewLook ? { onPreviewLook } : {})}
            {...(onStartCrop ? { onStartCrop } : {})}
            {...(onEditMask ? { onEditMask } : {})}
            badges={film?.badges}
            stage={stageSize}
            {...(fades ? { fades } : {})}
          />
        ) : many ? (
          <MultiClipPanel
            blocks={many}
            onEdit={onEditClips}
            stage={stageSize}
            {...(fades ? { fades } : {})}
            {...(clipLookOf ? { clipLookOf } : {})}
            {...(onPreviewLook ? { onPreviewLook } : {})}
          />
        ) : transition ? (
          <TransitionPanel t={t} pick={transition} />
        ) : geometry?.kind === 'group' && geometry.group ? (
          <GroupPanel geometry={geometry} group={geometry.group} layers={layers} onEditLayers={onEditLayers} t={t} />
        ) : (
          <FilmPanel t={t} stage={stageSize} film={film ?? null} onCanvas={onCanvas} frame={frame ?? null} rate={rate ?? null} />
        )}
      </div>
      </fieldset>
    </div>
  );
});

/* ───────────────────────────── nothing selected: the film ───────────────────────────── */

const STAGE_PRESETS: FilmFrameId[] = ['16:9', '9:16', '1:1', '4:5'];

/** Even sizes: H.264 samples chroma in 2×2 blocks and refuses odd dimensions (as film-frame does). */
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * The film itself: its name, its stage and shape, how long it is, what is in it. The shape changes as the
 * player's frame button changes it (FramePicker): the stage itself while nothing has been made (no coordinate can
 * break yet), the delivery frame around the film once it has content.
 */
function FilmPanel({
  t, stage, film, onCanvas, frame, rate,
}: {
  t: T;
  stage: { w: number; h: number };
  film: FilmSummary | null;
  onCanvas?: (next: FilmFrameId, size: { w: number; h: number }) => void;
  frame: { value: FilmFrameId; onChange: (next: FilmFrameId) => void } | null;
  rate: { fps: number; fromFootage: boolean; onChange: (fps: number) => void } | null;
}) {
  const canvas = Boolean(film?.empty && onCanvas);
  const shape = filmFrameOf(stage);
  const setSize = (w: number, h: number) => {
    const size = { w: even(w), h: even(h) };
    if (size.w === stage.w && size.h === stage.h) return;
    onCanvas?.(filmFrameOf(size), size);
  };
  const info = (label: string, value: string) => (
    <div className="flex h-6 items-center justify-between gap-2 text-[11px]">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="tabular-nums text-[var(--text)]">{value}</span>
    </div>
  );
  return (
    <>
      <Header
        icon={<Film size={13} />}
        name={film?.title || t('inspector.film')}
        meta={`${stage.w} × ${stage.h}${film ? ` · ${formatTimecode(film.durationMs)}` : ''}`}
      />
      <Section id="film-stage" title={t('inspector.stage')}>
        {canvas ? (
          <Segmented
            label={t('inspector.stageShape')}
            value={STAGE_PRESETS.includes(shape) ? shape : 'custom'}
            small
            options={[...STAGE_PRESETS.map((id) => ({ value: id, label: id })), { value: 'custom', label: t('inspector.custom') }]}
            onChange={(id) => { if (id !== 'custom') onCanvas?.(id as FilmFrameId, filmFrameStage(stage, id as FilmFrameId)); }}
          />
        ) : null}
        <Row>
          <NumField label={t('inspector.width')} prefix="W" value={stage.w} unit="px" min={2} max={8192} disabled={!canvas} onCommit={(w) => setSize(w, stage.h)} />
          <NumField label={t('inspector.height')} prefix="H" value={stage.h} unit="px" min={2} max={8192} disabled={!canvas} onCommit={(h) => setSize(stage.w, h)} />
        </Row>
        {!canvas && frame ? (
          <>
            <SubLabel>{t('inspector.deliveryFrame')}</SubLabel>
            <Segmented
              label={t('inspector.deliveryFrame')}
              value={frame.value}
              small
              options={FILM_FRAME_IDS.filter((id) => id === 'native' || STAGE_PRESETS.includes(id)).map((id) => ({
                value: id,
                label: id === 'native' ? t('viewer.frameNative') : id,
              }))}
              onChange={(id) => frame.onChange(id as FilmFrameId)}
            />
          </>
        ) : null}
        <p className="text-[10.5px] leading-[15px] text-[var(--text-faint)]">{canvas ? t('viewer.canvasNote') : t('inspector.stageFixed')}</p>
      </Section>
      {rate ? (
        <Section id="film-rate" title={t('inspector.frameRate')}>
          <SelectField
            label={t('inspector.frameRate')}
            prefix="fps"
            value={String(rate.fps)}
            options={FRAME_RATES.map((r) => ({ value: String(r), label: String(r) }))}
            onCommit={(v) => rate.onChange(Number(v))}
          />
          <p className="text-[10.5px] leading-[15px] text-[var(--text-faint)]">{t(rate.fromFootage ? 'inspector.frameRateFootage' : 'inspector.frameRateNote')}</p>
        </Section>
      ) : null}
      {film ? (
        <Section id="film-info" title={t('inspector.filmInfo')}>
          <div className="flex flex-col">
            {info(t('inspector.duration'), formatTimecode(film.durationMs))}
            {info(t('inspector.tracks'), String(film.tracks))}
            {info(t('inspector.clipsCount'), String(film.clips))}
          </div>
        </Section>
      ) : null}
      <div className="flex flex-col items-center px-6 pt-8 text-center">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--fill-tsp)] text-[var(--text-muted)]">
          <MousePointerClick size={15} strokeWidth={1.75} />
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--text-faint)]">{t('inspector.empty')}</p>
      </div>
    </>
  );
}

/* ───────────────────────────── header ───────────────────────────── */

function kindIcon(kind: string, size = 14): React.ReactNode {
  switch (kind) {
    case 'text': return <Type size={size} />;
    case 'image': return <ImageIcon size={size} />;
    case 'shape': return <Shapes size={size} />;
    case 'box': return <Square size={size} />;
    case 'mg': return <Clapperboard size={size} />;
    case 'video': return <Video size={size} />;
    case 'voice': return <AudioLines size={size} />;
    case 'sfx': return <Volume2 size={size} />;
    case 'caption': return <Captions size={size} />;
    default: return <Music size={size} />;
  }
}

function layerKindLabel(t: T, kind: StageElement['kind']): string {
  return t(
    kind === 'text' ? 'inspector.kindText'
      : kind === 'image' ? 'inspector.kindImage'
        : kind === 'shape' ? 'inspector.kindShape'
          : 'inspector.kindBox',
  );
}

/** What a clip is, by its file (as the media panel names them): the timeline's voice / music / sfx are all a sound. */
type ClipWhat = 'page' | 'video' | 'image' | 'audio' | 'caption';

function clipWhat(block: TimelineBlock): ClipWhat {
  if (block.kind === 'caption') return 'caption';
  if (block.src) {
    const kind = filmClipKind(block.src);
    return kind === 'mg' ? 'page' : kind === 'audio' ? 'audio' : filmSrcIsStill(block.src) ? 'image' : 'video';
  }
  return block.kind === 'mg' ? 'page' : block.kind === 'video' ? 'video' : 'audio';
}

function clipIcon(what: ClipWhat, size = 14): React.ReactNode {
  return kindIcon(what === 'page' ? 'mg' : what === 'audio' ? 'voice' : what, size);
}

function clipKindLabel(t: T, what: ClipWhat): string {
  return t(
    what === 'page' ? 'inspector.kindPage'
      : what === 'video' ? 'inspector.kindVideo'
        : what === 'image' ? 'inspector.kindImage'
          : what === 'caption' ? 'inspector.kindCaption'
            : 'inspector.kindAudio',
  );
}

/**
 * The header row: the kind's icon and the name, big enough to tell at a glance which thing this is; its track's
 * badge; the rest (kind, time, source file) is one gray line under it.
 */
function Header({
  icon, name, meta, mono, badge,
}: {
  icon: React.ReactNode;
  name: string;
  meta: string;
  /** Source file / asset path: monospace, truncated. */
  mono?: string;
  /** The track it is on (V1). */
  badge?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3 pb-2 pt-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] bg-[var(--fill-tsp)] text-[var(--text-muted)]">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[12px] font-semibold leading-[16px] text-[var(--text)]" title={name}>{name}</span>
          {badge ? (
            <span className="shrink-0 rounded-[3px] bg-[var(--accent-soft)] px-1 font-mono text-[9.5px] font-medium leading-[14px] text-[var(--text-muted)]">{badge}</span>
          ) : null}
        </div>
        <div className="truncate text-[10.5px] leading-[14px] text-[var(--text-faint)] tabular-nums" title={mono}>
          {mono ? `${meta} · ${mono}` : meta}
        </div>
      </div>
    </div>
  );
}

/**
 * Align: left / center / right, top / middle / bottom — to the stage for one thing, to each other for several (with
 * the two ways of spacing them evenly). Grayed when the thing cannot be measured (not on screen now).
 */
function AlignBar({ t, onAlign, onDistribute }: { t: T; onAlign?: (edge: AlignEdge) => void; onDistribute?: (axis: 'x' | 'y') => void }) {
  const items: { edge: AlignEdge; label: string; icon: React.ReactNode }[] = [
    { edge: 'left', label: t('inspector.alignLeft'), icon: <AlignStartVertical size={ICON} /> },
    { edge: 'hcenter', label: t('inspector.alignHCenter'), icon: <AlignCenterVertical size={ICON} /> },
    { edge: 'right', label: t('inspector.alignRight'), icon: <AlignEndVertical size={ICON} /> },
    { edge: 'top', label: t('inspector.alignTop'), icon: <AlignStartHorizontal size={ICON} /> },
    { edge: 'vcenter', label: t('inspector.alignVCenter'), icon: <AlignCenterHorizontal size={ICON} /> },
    { edge: 'bottom', label: t('inspector.alignBottom'), icon: <AlignEndHorizontal size={ICON} /> },
  ];
  const btn = (key: string, label: string, icon: React.ReactNode, onClick?: () => void) => (
    <Tooltip key={key} label={label}>
      <button
        type="button"
        aria-label={label}
        disabled={!onClick}
        onClick={onClick}
        className="flex h-6 flex-1 items-center justify-center rounded-[4px] text-[var(--text-muted)] transition hover:bg-[var(--bg)] hover:text-[var(--text)] disabled:pointer-events-none disabled:opacity-40"
      >
        {icon}
      </button>
    </Tooltip>
  );
  return (
    <div className="flex items-center gap-1.5">
      {[items.slice(0, 3), items.slice(3)].map((group, i) => (
        <div key={i} className="flex h-[26px] flex-1 items-center rounded-[5px] bg-[var(--fill-tsp)] p-px">
          {group.map((item) => btn(item.edge, item.label, item.icon, onAlign ? () => onAlign(item.edge) : undefined))}
        </div>
      ))}
      {onDistribute ? (
        <div className="flex h-[26px] w-[54px] shrink-0 items-center rounded-[5px] bg-[var(--fill-tsp)] p-px">
          {btn('dx', t('inspector.distributeH'), <AlignHorizontalDistributeCenter size={ICON} />, () => onDistribute('x'))}
          {btn('dy', t('inspector.distributeV'), <AlignVerticalDistributeCenter size={ICON} />, () => onDistribute('y'))}
        </div>
      ) : null}
    </div>
  );
}

/** The proportion lock beside W / H. */
function LockToggle({ t, locked, onChange }: { t: T; locked: boolean; onChange?: (next: boolean) => void }) {
  const label = locked ? t('inspector.aspectLocked') : t('inspector.aspectFree');
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-pressed={locked}
        aria-label={label}
        disabled={!onChange}
        onClick={() => onChange?.(!locked)}
        className={`flex h-[26px] w-6 items-center justify-center rounded-[5px] transition disabled:pointer-events-none ${
          locked
            ? 'bg-[var(--accent-soft)] text-[var(--text)]'
            : 'text-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'
        }`}
      >
        {locked ? <Link2 size={13} /> : <Unlink2 size={13} />}
      </button>
    </Tooltip>
  );
}

/**
 * Breadcrumb: the clip › outer layers › this layer, each a step back out. The picture always picks the innermost
 * layer; to change the card around it, step out here.
 */
function Breadcrumb({
  element, onSelectParent, onSelectClip,
}: {
  element: StageElement;
  onSelectParent?: (loc: string, clipLoc?: string) => void;
  onSelectClip?: (clipLoc: string) => void;
}) {
  const parents = [...(element.parents ?? [])].reverse();
  if (!element.clipLoc && !parents.length) return null;
  const crumb = 'min-w-0 max-w-[7.5rem] shrink truncate rounded-[4px] px-1 py-0.5 text-[10.5px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]';
  return (
    <nav className="-mt-0.5 flex min-w-0 flex-wrap items-center gap-y-0.5 px-2.5 pb-2" aria-label="breadcrumb">
      {element.clipLoc ? (
        <button
          type="button"
          className={`${crumb} font-medium`}
          onClick={() => onSelectClip?.(element.clipLoc!)}
          disabled={!onSelectClip}
          title={element.clipId}
        >
          {element.clipId ?? element.clipLoc}
        </button>
      ) : null}
      {parents.map((p) => (
        <React.Fragment key={p.loc}>
          <ChevronRight size={11} className="shrink-0 text-[var(--text-faint)]" />
          <button
            type="button"
            className={crumb}
            onClick={() => onSelectParent?.(p.loc, element.clipLoc)}
            disabled={!onSelectParent}
            title={p.label}
          >
            {p.label}
          </button>
        </React.Fragment>
      ))}
      <ChevronRight size={11} className="shrink-0 text-[var(--text-faint)]" />
      <span className="min-w-0 max-w-[7.5rem] truncate px-1 py-0.5 text-[10.5px] font-medium text-[var(--text)]">
        {element.label}
      </span>
    </nav>
  );
}

/** A refused change: why. */
function RefusalBanner({
  message, onDismiss, t,
}: {
  message: string;
  onDismiss: () => void;
  t: T;
}) {
  return (
    <div role="alert" className="mx-3 mb-2.5 rounded-[7px] border border-[color-mix(in_srgb,var(--err)_28%,transparent)] bg-[color-mix(in_srgb,var(--err)_7%,transparent)] px-2.5 py-2">
      <div className="flex items-start gap-2">
        <CircleAlert size={13} className="mt-[1px] shrink-0 text-[var(--err)]" />
        <p className="min-w-0 flex-1 text-[11px] leading-[16px] text-[var(--text)]">{message}</p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('inspector.dismiss')}
          className="-mr-1 -mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-faint)] hover:text-[var(--text)]"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────────── a layer's CSS ───────────────────────────── */

/** A layer's CSS property: its override's, else what the page draws it with now. */
function layerRead(element: StageElement): LookRead {
  return (prop) => {
    const key = camelOf(prop);
    const v = element.override?.style?.[key] ?? element.style?.[key];
    return v == null || v === '' ? undefined : String(v);
  };
}

/**
 * Properties for a layer's override. "None of mine" takes the person's change away, back to the page's own; when the
 * person had none and the page's own is not neutral (its CSS fades it), the neutral value is written over it.
 */
function layerStyle(element: StageElement, set: LookSet): Record<string, string | null> {
  const read = layerRead(element);
  const out: Record<string, string | null> = {};
  for (const [prop, v] of Object.entries(set)) {
    const key = camelOf(prop);
    if (v != null) { out[key] = v; continue; }
    const mine = element.override?.style?.[key] != null;
    out[key] = !mine && !isNeutral(prop, read(prop)) && NEUTRAL[prop] ? NEUTRAL[prop]! : null;
  }
  return out;
}

/* ───────────────────────────── a layer on the picture ───────────────────────────── */

/**
 * Which copies a style change goes to when a list renders several. Words are not scoped: copies showing the same
 * words come from one template, so changing them changes all (see TextSection).
 */
type Scope = 'one' | 'all';

function LayerPanel({
  element, geometry, inlineTextFailure, onEditStyle, onPreviewStyle, onEditText, onPreviewText,
  onEditOverride, onPreviewOverride, onSelectParent, onSelectClip, onEditMask,
}: {
  element: StageElement;
  geometry?: StageGeometry | null;
  inlineTextFailure?: InlineTextFailure | null;
  onEditStyle: (loc: string, patch: StageElementStyle) => Promise<string | null>;
  onPreviewStyle: (loc: string, patch: StageElementStyle) => void;
  onEditText: (edit: StageTextEdit) => Promise<StageEditFailure | null>;
  onPreviewText?: (loc: string, value: string) => void;
  onEditOverride?: (
    element: StageElement,
    patch: OverrideGeometry | null,
    allCopies: boolean,
    pivot?: OverridePivot,
  ) => Promise<string | null>;
  onPreviewOverride?: (loc: string, g: NodeOverride, pivot?: OverridePivot) => void;
  onSelectParent?: (loc: string, clipLoc?: string) => void;
  onSelectClip?: (clipLoc: string) => void;
  onEditMask?: (session: MaskSession | null) => void;
}) {
  const t = useT();
  const [refusal, setRefusalState] = React.useState<string | null>(null);
  /* after a refusal the fields below remount: a field still holding the value just typed would look as if it took */
  const [rev, setRev] = React.useState(0);
  const setRefusal = (next: string | null) => {
    setRefusalState(next);
    if (next) setRev((n) => n + 1);
  };
  const copies = element.instances != null && element.instances > 1 ? element.instances : 0;
  const [scope, setScope] = React.useState<Scope>('one');
  const loc = element.loc;
  const bare = sourceLocBare(loc) ?? loc;

  /* a text edit made in place on the picture was refused: the reason shows here */
  const failureSeq = inlineTextFailure?.seq;
  React.useEffect(() => {
    const f = inlineTextFailure;
    const text = element.text;
    if (!f || !text || f.loc !== text.loc) return;
    setRefusal(f.failure.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failureSeq]);

  /* the anchor below is a hook: it has to run before the early return */
  const geoAnchor = React.useRef<StageGeometry | null>(null);
  React.useEffect(() => { geoAnchor.current = null; }, [element.loc, element.override]);
  /* aspect lock: on by default for text (squashed letters are never wanted), off otherwise (as in Figma) */
  const [ratioLocked, setRatioLocked] = React.useState(element.kind === 'text');
  /* the properties a preview has painted: what a revert paints back */
  const previewedKeys = React.useRef(new Set<string>());

  if (!loc || !bare) return null;
  const styleLoc = copies && scope === 'all' ? bare : loc;
  const style = element.style ?? {};
  const kind = element.kind;

  /** A style patch for the stage: "none of mine" is unset (the stage takes the property away). */
  const stagePatch = (set: Record<string, string | null>): StageElementStyle => {
    const out: StageElementStyle = {};
    for (const [k, v] of Object.entries(set)) out[k] = v ?? undefined;
    return out;
  };
  const commitStyle = async (patch: StageElementStyle) => {
    previewedKeys.current.clear();
    onPreviewStyle(styleLoc, patch);
    setRefusal(null);
    const failed = await onEditStyle(styleLoc, patch);
    if (!failed) return;
    /* refused: take the change back off the picture, or it keeps a look the film does not have */
    const back: StageElementStyle = {};
    for (const key of Object.keys(patch)) back[key] = style[key];
    onPreviewStyle(styleLoc, back);
    setRefusal(failed);
  };
  const look: Look = makeLook([element], layerRead, {
    commit: ([[, set]]) => { void commitStyle(stagePatch(layerStyle(element, set))); },
    preview: (sets) => {
      if (!sets.length) return;
      const patch = stagePatch(layerStyle(element, sets[0]![1]));
      for (const k of Object.keys(patch)) previewedKeys.current.add(k);
      onPreviewStyle(styleLoc, patch);
    },
    revert: () => {
      const back: StageElementStyle = {};
      for (const k of previewedKeys.current) back[k] = element.override?.style?.[k] ?? style[k];
      previewedKeys.current.clear();
      if (Object.keys(back).length) onPreviewStyle(styleLoc, back);
    },
  });

  /*
   * Position and size are an override. The panel shows Figma's numbers — X / Y, W / H on the stage, the angle — as
   * the stage measures them (geometry); what is written is the override's offset / factors, converted back by
   * `unit` (the offset is in the parent's coordinates). Not measurable (not on screen) → the written offset.
   * With "All N copies" one override covers every copy, otherwise only the picked one.
   */
  const override = element.override ?? {};
  const ot = override.t ?? [0, 0];
  const [osx, osy] = scalePair(override.s);
  const liveGeo = geometry && geometry.kind === 'layer' && geometry.loc === element.loc ? geometry : null;
  /*
   * While previewing, work from the geometry measured when the preview **began**: the preview moves the layer, the
   * measurement follows, and adding it to the written offset again would count the same move twice — a dragged
   * number jitters back and a typed one misses. Released on commit or revert.
   */
  const geo = geoAnchor.current ?? liveGeo;
  const canMove = Boolean(onEditOverride && element.clipLoc);
  const commitOverride = async (patch: OverrideGeometry | null, pivot?: OverridePivot) => {
    geoAnchor.current = null;
    if (!onEditOverride) return;
    setRefusal(null);
    const failed = await onEditOverride(element, patch, Boolean(copies) && scope === 'all', pivot);
    if (!failed) return;
    onPreviewOverride?.(styleLoc, override);
    setRefusal(failed);
  };
  const previewGeom = (part: NodeOverride, pivot?: OverridePivot) => {
    geoAnchor.current ??= liveGeo;
    onPreviewOverride?.(styleLoc, { ...override, ...part }, pivot);
  };
  const revertGeom = () => {
    geoAnchor.current = null;
    onPreviewOverride?.(styleLoc, override);
  };
  /** The override offset that puts the layer at stage (x, y). */
  const offsetFor = (x: number | null, y: number | null): [number, number] => {
    if (!geo) return [x ?? ot[0], y ?? ot[1]];
    /* moved (dx, dy) on the stage; the offset is in the parent's coordinates, so turn it back by the parent's angle */
    const dx = (x == null ? 0 : x - geo.x) * geo.unit;
    const dy = (y == null ? 0 : y - geo.y) * geo.unit;
    const pr = ((geo.parentR ?? 0) * Math.PI) / 180;
    return [
      round1(ot[0] + dx * Math.cos(pr) + dy * Math.sin(pr)),
      round1(ot[1] - dx * Math.sin(pr) + dy * Math.cos(pr)),
    ];
  };
  /**
   * W / H write the override's x / y factors (both together when the aspect is locked). The top left stays put, as
   * in Figma; the offset that keeps it there is added by the caller from what the stage measures.
   */
  const sizeFor = (w: number | null, h: number | null): { s: number | [number, number] } | null => {
    if (!geo || !(geo.w > 0) || !(geo.h > 0)) return null;
    const kx = w != null ? w / geo.w : ratioLocked && h != null ? h / geo.h : 1;
    const ky = h != null ? h / geo.h : ratioLocked && w != null ? w / geo.w : 1;
    if (!(kx > 0) || !(ky > 0)) return null;
    const clampS = (v: number) => Math.round(Math.min(50, Math.max(0.02, v)) * 10000) / 10000;
    return { s: compactScale(clampS(osx * kx), clampS(osy * ky)) };
  };
  const alignTo = (edge: AlignEdge) => {
    if (!geo) return;
    const { w: sw, h: sh } = geo.stage;
    const x = edge === 'left' ? 0 : edge === 'hcenter' ? (sw - geo.w) / 2 : edge === 'right' ? sw - geo.w : null;
    const y = edge === 'top' ? 0 : edge === 'vcenter' ? (sh - geo.h) / 2 : edge === 'bottom' ? sh - geo.h : null;
    const next = offsetFor(x, y);
    if (next[0] === ot[0] && next[1] === ot[1]) return;
    previewGeom({ t: next });
    void commitOverride({ t: next });
  };
  const moved = Boolean(override.t?.[0] || override.t?.[1] || osx !== 1 || osy !== 1 || override.r);
  /* style keys applied as an override */
  const overrideStyle = override.style ?? {};
  const overrideStyleKeys = Object.keys(overrideStyle);
  const stageW = geo?.stage.w ?? FILM_DEFAULT_STAGE.w;
  const stageH = geo?.stage.h ?? FILM_DEFAULT_STAGE.h;

  const declaredKeys = new Set(element.declaredStyle ?? []);
  const bgProp = declaredKeys.has('background') ? 'background' : 'background-color';
  /* text in an SVG (`<text>` / `<tspan>`): no line layout, its color is fill — those sections look different */
  const svgText = kind === 'text' && isSvgTextTag(element.tag ?? '');
  const fill = (prop: string, label: string) => (
    <ColorField
      label={label}
      value={look.common((read) => read(prop) ?? '')}
      onPreview={(c) => look.preview(() => ({ [prop]: c }))}
      onCommit={(c) => look.commit(() => ({ [prop]: c }))}
    />
  );
  /* the override's own CSS, as declarations: what Advanced shows of it */
  const overrideCss = Object.entries(overrideStyle)
    .map(([k, v]) => `${kebabOf(k)}: ${typeof v === 'number' && !/opacity|z-index|font-weight|line-height|flex/.test(kebabOf(k)) ? `${v}px` : v}`)
    .join('; ');

  return (
    <>
      <Header icon={kindIcon(kind, 13)} name={element.label} meta={layerKindLabel(t, kind)} />
      <Breadcrumb element={element} onSelectParent={onSelectParent} onSelectClip={onSelectClip} />
      {copies ? (
        <div className="px-3 pb-2.5">
          <Segmented
            label={t('inspector.scope')}
            value={scope}
            onChange={(v) => setScope(v as Scope)}
            options={[
              { value: 'one', label: t('inspector.scopeOne').replace('{i}', String(element.instance ?? 1)) },
              { value: 'all', label: t('inspector.scopeAll').replace('{n}', String(copies)) },
            ]}
          />
        </div>
      ) : null}
      {refusal ? (
        <RefusalBanner message={refusal} onDismiss={() => setRefusal(null)} t={t} />
      ) : null}

      <React.Fragment key={rev}>
      {element.text ? (
        <TextSection
          text={element.text}
          shared={copies}
          onEditText={onEditText}
          onPreviewText={onPreviewText}
          onRefused={setRefusal}
        />
      ) : null}

      {canMove ? (
        <Section
          id="position"
          title={t('inspector.position')}
          aside={moved ? (
            <SectionAction
              label={t('inspector.resetPosition')}
              onClick={() => {
                onPreviewOverride?.(styleLoc, overrideStyleKeys.length ? { style: override.style } : {});
                /* reset the geometry only: style overrides stay (Advanced has its own Clear) */
                void commitOverride(overrideStyleKeys.length ? { t: [0, 0], s: 1, r: 0 } : null);
              }}
            >
              <RotateCcw size={11} />
            </SectionAction>
          ) : null}
        >
          <AlignBar t={t} onAlign={geo ? alignTo : undefined} />
          <Row>
            <NumField
              label={geo ? t('inspector.x') : t('inspector.offsetX')}
              prefix="X"
              value={geo ? geo.x : ot[0]}
              min={-COORD_LIMIT}
              max={COORD_LIMIT}
              ctx={{ percent: stageW }}
              onPreview={(x) => previewGeom({ t: offsetFor(x, null) })}
              onRevert={revertGeom}
              onCommit={(x) => { void commitOverride({ t: offsetFor(x, null) }); }}
            />
            <NumField
              label={geo ? t('inspector.y') : t('inspector.offsetY')}
              prefix="Y"
              value={geo ? geo.y : ot[1]}
              min={-COORD_LIMIT}
              max={COORD_LIMIT}
              ctx={{ percent: stageH }}
              onPreview={(y) => previewGeom({ t: offsetFor(null, y) })}
              onRevert={revertGeom}
              onCommit={(y) => { void commitOverride({ t: offsetFor(null, y) }); }}
            />
          </Row>
          {geo ? (
            <div className="grid grid-cols-[1fr_1fr_24px] items-center gap-1.5">
              <NumField
                label={t('inspector.width')}
                prefix="W"
                value={geo.w}
                min={1}
                max={COORD_LIMIT}
                ctx={{ percent: stageW }}
                onPreview={(w) => { const g = sizeFor(w, null); if (g) previewGeom(g, PIVOT_TOP_LEFT); }}
                onRevert={revertGeom}
                onCommit={(w) => { const g = sizeFor(w, null); if (g) void commitOverride(g, PIVOT_TOP_LEFT); }}
              />
              <NumField
                label={t('inspector.height')}
                prefix="H"
                value={geo.h}
                min={1}
                max={COORD_LIMIT}
                ctx={{ percent: stageH }}
                onPreview={(h) => { const g = sizeFor(null, h); if (g) previewGeom(g, PIVOT_TOP_LEFT); }}
                onRevert={revertGeom}
                onCommit={(h) => { const g = sizeFor(null, h); if (g) void commitOverride(g, PIVOT_TOP_LEFT); }}
              />
              <LockToggle t={t} locked={ratioLocked} onChange={setRatioLocked} />
            </div>
          ) : null}
          <Row>
            <NumField
              label={t('inspector.rotate')}
              prefix={<RotateGlyph />}
              value={geo ? geo.r : override.r ?? 0}
              unit="°"
              onPreview={(r) => previewGeom({ r: wrapDeg(r) }, PIVOT_CENTER)}
              onRevert={revertGeom}
              onCommit={(r) => { void commitOverride({ r: wrapDeg(r) }, PIVOT_CENTER); }}
            />
            {geo ? <span /> : (
              <NumField
                label={t('inspector.scale')}
                prefix={<Maximize2 size={10} />}
                value={Math.round(osx * 1000) / 10}
                unit="%"
                min={2}
                max={5000}
                onPreview={(n) => previewGeom({ s: n / 100 }, PIVOT_CENTER)}
                onRevert={revertGeom}
                onCommit={(n) => { void commitOverride({ s: round3(n / 100) }, PIVOT_CENTER); }}
              />
            )}
          </Row>
        </Section>
      ) : null}

      {kind === 'text' ? <TypographySection look={look} t={t} svg={svgText} sample={element.text?.value ?? ''} /> : null}

      {kind === 'image' || kind === 'box' ? (
        <CropSection
          look={look}
          t={t}
          fit={kind === 'image'}
          framing={kind === 'image'}
          box={geo ? { w: geo.w, h: geo.h } : null}
        />
      ) : null}

      <MaskSection
        look={look}
        t={t}
        box={geo ? { w: geo.w, h: geo.h } : null}
        target={{ kind: 'layer', loc, ...(element.clipLoc ? { clipLoc: element.clipLoc } : {}) }}
        {...(onEditMask ? { onEditMask } : {})}
      />

      <AppearanceSection look={look} t={t}>
        {kind === 'box' ? fill(bgProp, t('inspector.fill')) : null}
        {kind === 'shape' && declaredKeys.has('fill') ? fill('fill', t('inspector.fill')) : null}
        {kind === 'text' && !svgText && style.backgroundColor != null ? (
          <>
            {fill(bgProp, t('inspector.background'))}
            <Row>
              <NumField
                label={t('inspector.radius')}
                prefix={<RadiusGlyph />}
                value={look.common((read) => Number.parseFloat(read('border-radius') ?? '0') || 0)}
                unit="px"
                min={0}
                onPreview={(n) => look.preview(() => ({ 'border-radius': n > 0 ? `${n}px` : null }))}
                onCommit={(n) => look.commit(() => ({ 'border-radius': n > 0 ? `${n}px` : null }))}
                onRevert={() => look.revert()}
              />
              <span />
            </Row>
          </>
        ) : null}
      </AppearanceSection>
      <AdjustSection look={look} t={t} />
      <EffectsSection look={look} t={t} />
      {onEditOverride ? (
        <AdvancedSection
          t={t}
          css={rawDeclarations(overrideCss)}
          onCommit={(set) => {
            const patch: Record<string, string | null> = {};
            for (const [k, v] of Object.entries(set)) patch[camelOf(k)] = v;
            void commitOverride({ style: patch });
          }}
          {...(overrideStyleKeys.length ? {
            onClear: () => {
              const cleared: Record<string, null> = {};
              for (const key of overrideStyleKeys) cleared[key] = null;
              void commitOverride({ style: cleared });
            },
          } : {})}
        />
      ) : null}
      </React.Fragment>
    </>
  );
}

/**
 * The words themselves, saved on blur — painted as they are typed, written once.
 */
function TextSection({
  text, shared, onEditText, onPreviewText, onRefused,
}: {
  text: NonNullable<StageElement['text']>;
  /** How many copies share these words: changing them changes all, and the panel says so. */
  shared: number;
  onEditText: (edit: StageTextEdit) => Promise<StageEditFailure | null>;
  /** Paints the words as they are typed; on refusal paints the old words back (see send). */
  onPreviewText?: (loc: string, value: string) => void;
  onRefused: (message: string | null) => void;
}) {
  const t = useT();
  const [raw, setRaw] = React.useState(text.value);
  const [saving, setSaving] = React.useState(false);
  /* the picture paints the words as they are typed, and the layer is measured again from the picture: while typing,
     `text.value` is the typed words, not the written ones. What was written is kept from before the first key. */
  const written = React.useRef(text.value);
  const typing = React.useRef(false);
  React.useEffect(() => {
    if (typing.current) return;
    written.current = text.value;
    setRaw(text.value);
  }, [text.value]);
  React.useEffect(() => {
    typing.current = false;
    written.current = text.value;
    setRaw(text.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text.loc]);
  const send = async (value: string) => {
    onRefused(null);
    setSaving(true);
    const loc = text.loc;
    const failed = await onEditText({ loc, value, expect: written.current });
    setSaving(false);
    typing.current = false;
    if (!failed) { written.current = value; return; }
    /* not written: the box and the picture go back to the written words, or it looks as if it took */
    setRaw(written.current);
    onPreviewText?.(loc, written.current);
    onRefused(failed.error);
  };
  /* Esc is "never mind": it blurs right after, and that blur still reads the half-typed words */
  const cancelled = React.useRef(false);
  const save = () => {
    if (cancelled.current) { cancelled.current = false; return; }
    if (raw === written.current) { typing.current = false; return; }
    void send(raw);
  };
  return (
    <Section
      id="text"
      title={t('inspector.content')}
      aside={shared ? (
        <span className="text-[10.5px] text-[var(--text-faint)]">
          {t('inspector.mapTextShared').replace('{n}', String(shared))}
        </span>
      ) : null}
    >
      <textarea
        value={raw}
        aria-label={t('inspector.content')}
        onChange={(e) => {
          cancelled.current = false;
          typing.current = true;
          setRaw(e.target.value);
          /* the picture follows the words (Figma's feel); the write still waits for blur / Enter */
          onPreviewText?.(text.loc, e.target.value);
        }}
        onBlur={save}
        onKeyDown={(e) => {
          /* Enter saves, as every editor does; Shift+Enter is a new line */
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
          if (e.key === 'Escape') {
            cancelled.current = true;
            typing.current = false;
            setRaw(written.current);
            onPreviewText?.(text.loc, written.current);
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        rows={Math.min(6, Math.max(2, raw.split('\n').length))}
        className={`w-full resize-none rounded-[5px] bg-[var(--fill-tsp)] px-2 py-1.5 text-[11.5px] leading-[1.5] text-[var(--text)] outline-none ring-1 ring-inset ring-transparent transition hover:ring-[var(--border)] focus:bg-[var(--bg)] focus:ring-[1.5px] focus:ring-[var(--accent)] ${saving ? 'opacity-60' : ''}`}
      />
      <p className="text-[10.5px] leading-[15px] text-[var(--text-faint)]">
        {t('inspector.editOnCanvas')}
      </p>
    </Section>
  );
}

/**
 * Several layers selected on the picture: how many, of what, and where their box is. They are moved together on
 * the picture (dragged, nudged, aligned from the menu); here what they share: their look, and their type when all
 * are text.
 */
function GroupPanel({ geometry, group, layers, onEditLayers, t }: {
  geometry: StageGeometry;
  group: NonNullable<StageGeometry['group']>;
  layers?: readonly StageElement[];
  onEditLayers?: (list: LayerEdit[]) => Promise<string | null>;
  t: T;
}) {
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const cell = (label: string, value: number) => (
    <NumField label={label} prefix={label.slice(0, 1)} value={Math.round(value * 10) / 10} disabled onCommit={() => {}} />
  );
  const targets = layers?.filter((l) => l.clipLoc) ?? [];
  const look = targets.length && onEditLayers ? makeLook(targets, layerRead, {
    commit: (sets) => {
      setRefusal(null);
      void onEditLayers(sets.map(([element, set]) => ({ element, patch: { style: layerStyle(element, set) } })))
        .then((failed) => setRefusal(failed));
    },
  }) : null;
  const allText = targets.length > 0 && targets.every((l) => l.kind === 'text' && !isSvgTextTag(l.tag ?? ''));
  return (
    <>
      <Header
        icon={group.kinds.length === 1 ? kindIcon(group.kinds[0]!, 13) : <Shapes size={13} />}
        name={t('inspector.multiLayers').replace('{n}', String(group.n))}
        meta={group.kinds.map((k) => layerKindLabel(t, k)).join(' · ')}
      />
      {refusal ? <RefusalBanner message={refusal} onDismiss={() => setRefusal(null)} t={t} /> : null}
      <Section id="position" title={t('inspector.position')}>
        <Row>{cell(t('inspector.x'), geometry.x)}{cell(t('inspector.y'), geometry.y)}</Row>
        <Row>{cell(t('inspector.width'), geometry.w)}{cell(t('inspector.height'), geometry.h)}</Row>
        <p className="text-[11px] leading-[16px] text-[var(--text-faint)]">{t('inspector.multiLayersHint')}</p>
      </Section>
      {look ? (
        <>
          {allText ? <TypographySection look={look} t={t} sample={targets[0]?.text?.value ?? ''} /> : null}
          <AppearanceSection look={look} t={t} />
          <AdjustSection look={look} t={t} />
          <EffectsSection look={look} t={t} />
        </>
      ) : null}
    </>
  );
}

/* ───────────────────────────── a clip on the timeline ───────────────────────────── */

/** Whether a clip has a volume: sounds always, a video when it carries its own sound (a page has none). */
function blockHasVolume(b: TimelineBlock): boolean {
  return b.kind === 'voice' || b.kind === 'sfx' || b.kind === 'music' || Boolean(b.ownAudio);
}

/** The panel shows linear volume only: film.html writes `volume`, a code-shaped film `gainDb`; `1` is as is. */
function linearVolumeOf(b: TimelineBlock): number {
  return b.volume ?? filmGainDbToVolume(b.gainDb ?? 0);
}

/** One volume for a batch of clips: `volume` in film.html, `gainDb` otherwise (back to as-is removes the key). */
function volumeEdits(blocks: readonly TimelineBlock[], apply: FieldApply): ClipEdit[] {
  return blocks.flatMap((b) => {
    if (!b.loc || !blockHasVolume(b)) return [];
    const v = round3(Math.max(0, Math.min(2, apply(linearVolumeOf(b) * 100) / 100)));
    if (v === round3(linearVolumeOf(b))) return [];
    if (parseFilmDocLoc(b.loc) != null) return [{ loc: b.loc, prop: 'volume', value: v }];
    return [{ loc: b.loc, prop: 'gainDb', value: filmVolumeToGainDb(v) ?? null }];
  });
}

/**
 * How long a clip can run on the film: until its source runs out (none for a still, or a page, which holds its last
 * frame past its end), and not into the next clip on its track, as a trim on the timeline stops there — unless the
 * timeline's magnet is on (`ripple`): then the next clip is pushed along.
 */
function longestSec(block: TimelineBlock, durSec: number, ripple: boolean): number | undefined {
  const bySource = block.room?.tailMs != null ? durSec + block.room.tailMs / 1000 : Infinity;
  const byNext = block.nextMs != null && !ripple ? (block.nextMs - block.startMs) / 1000 : Infinity;
  const sec = Math.min(bySource, byNext);
  /* down to the ms: rounded up, the length would reach a millisecond into the next clip or past the file */
  return Number.isFinite(sec) ? Math.floor(sec * 1000 + 1e-6) / 1000 : undefined;
}

/** A clip whose picture can be placed and dressed in film.html: a page, a video or a still, written there. */
function isPicture(b: TimelineBlock): boolean {
  return (b.kind === 'mg' || b.kind === 'video') && b.loc != null && parseFilmDocLoc(b.loc) != null;
}

type ClipTarget = { loc: string; css: string; look: ClipLook | null };

/** A clip's CSS property: its own `style`'s, else what the film's CSS gives it (its classes), as the player measured. */
function clipRead(tg: ClipTarget): LookRead {
  const measured: Record<string, string | undefined> = {
    'object-fit': tg.look?.fit, 'object-position': tg.look?.position, 'border-radius': tg.look?.radius, opacity: tg.look?.opacity,
    'mix-blend-mode': tg.look?.blend, 'clip-path': tg.look?.clip, filter: tg.look?.filter,
  };
  return (prop) => declared(tg.css, prop) ?? measured[prop];
}

/**
 * A clip's style with `set` written. "None of mine" takes the declaration out — unless the clip has none and its
 * classes give it a look (a `.card` with round corners): then the neutral value is written over them.
 */
function clipCss(tg: ClipTarget, set: LookSet): string {
  const read = clipRead(tg);
  const resolved: LookSet = {};
  for (const [prop, v] of Object.entries(set)) {
    resolved[prop] = v == null && declared(tg.css, prop) === undefined && !isNeutral(prop, read(prop)) ? NEUTRAL[prop] ?? null : v;
  }
  return withDeclarations(tg.css, resolved);
}

/** A Look over clips' own CSS: written as their `style`, shown while dragged with onPreviewLook. */
function clipsLook(
  targets: readonly ClipTarget[],
  commit: (edits: ClipEdit[]) => void,
  onPreviewLook?: (clipLoc: string, css: string | null) => void,
): Look {
  return makeLook(targets, clipRead, {
    commit: (sets) => commit(sets.map(([tg, set]) => ({ loc: tg.loc, prop: 'style', value: clipCss(tg, set) || null }))),
    preview: (sets) => { for (const [tg, set] of sets) onPreviewLook?.(tg.loc, clipCss(tg, set)); },
    revert: () => { for (const tg of targets) onPreviewLook?.(tg.loc, null); },
  });
}

/**
 * One whole clip selected on the timeline. Every field writes back to the clip at `block.loc`; a clip without one
 * can only be looked at.
 */
function ClipPanel({
  block, geometry, stage, badges, onEdit, onPreviewClip, pageChangesOf, clipLookOf, onPreviewLook, onStartCrop, onEditMask, fades,
}: {
  fades?: ReadonlyMap<string, FadeMs>;
  block: TimelineBlock;
  geometry?: StageGeometry | null;
  /** The film's stage: with the clip's own size, where it lands when it is not on screen to measure. */
  stage: { w: number; h: number };
  badges?: readonly string[] | undefined;
  onEdit?: (edits: ClipEdit[]) => Promise<string | null>;
  onPreviewClip?: (clipLoc: string, patch: Partial<MgTransform> | null) => void;
  pageChangesOf?: (clipLoc: string) => PageChanges | null;
  clipLookOf?: (clipLoc: string) => { css: string; look: ClipLook | null; cls?: string } | null;
  onPreviewLook?: (clipLoc: string, css: string | null) => void;
  onStartCrop?: () => void;
  onEditMask?: (session: MaskSession | null) => void;
}) {
  const t = useT();
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const loc = block.loc;
  const editable = Boolean(loc && onEdit);
  const docLoc = loc != null && parseFilmDocLoc(loc) != null;
  const readPageChanges = React.useCallback(() => (pageChangesOf && loc ? pageChangesOf(loc) : null), [pageChangesOf, loc]);
  const commit = (edits: ClipEdit[]) => {
    if (!onEdit || !edits.length) return;
    setRefusal(null);
    void onEdit(edits).then((failed) => {
      if (!failed) return;
      /* the picture must not keep a place or a look the film does not have */
      if (loc && edits.some((e) => e.prop === 'box')) onPreviewClip?.(loc, null);
      if (loc && edits.some((e) => e.prop === 'style')) onPreviewLook?.(loc, null);
      setRefusal(plainClipRefusal(failed));
    });
  };
  const what = clipWhat(block);
  const picture = isPicture(block);
  const own = block.size ?? null;
  const geo = geometry ?? (own ? computedGeometry(block, own, stage) : null);
  const lookOf = picture && clipLookOf && loc ? clipLookOf(loc) : null;
  const target: ClipTarget | null = lookOf && loc ? { loc, css: lookOf.css, look: lookOf.look } : null;
  const look = target ? clipsLook([target], commit, onPreviewLook) : null;
  const at = parseFilmDocLoc(loc ?? '');
  const badge = at ? badges?.[at.track] : undefined;

  return (
    <>
      <Header
        icon={clipIcon(what, 13)}
        name={block.title || block.clipId || clipKindLabel(t, what)}
        meta={`${clipKindLabel(t, what)} · ${formatTimecode(block.startMs)} – ${formatTimecode(block.endMs)}`}
        {...(block.src ? { mono: block.src } : {})}
        {...(badge ? { badge } : {})}
      />
      {refusal ? (
        <RefusalBanner message={refusal} onDismiss={() => setRefusal(null)} t={t} />
      ) : null}
      {!editable ? (
        <p className="mx-3 rounded-[6px] bg-[var(--fill-tsp)] px-2.5 py-2 text-[11px] text-[var(--text-muted)]">
          {t('inspector.noEdit')}
        </p>
      ) : (
        <>
          {picture && own && geo ? (
            <ClipPositionSection
              t={t}
              loc={loc!}
              page={block.kind === 'mg'}
              own={own}
              placed={block.box != null}
              geometry={geo}
              value={clipTransform(block, own, stage)}
              onCommit={commit}
              {...(onPreviewClip ? { onPreview: (patch: Partial<MgTransform> | null) => onPreviewClip(loc!, patch) } : {})}
            />
          ) : null}
          {look ? (
            <>
              <CropSection
                look={look}
                t={t}
                fit={block.kind === 'video'}
                framing={block.kind === 'video'}
                box={geo ? { w: geo.w, h: geo.h } : null}
                own={own}
                {...(onStartCrop ? { onStartCrop } : {})}
              />
              <MaskSection
                look={look}
                t={t}
                box={geo ? { w: geo.w, h: geo.h } : null}
                target={{ kind: 'clip', clipLoc: target!.loc }}
                {...(onEditMask ? { onEditMask } : {})}
              />
              <AppearanceSection look={look} t={t} />
              <AdjustSection look={look} t={t} />
              <EffectsSection look={look} t={t} />
            </>
          ) : null}
          {block.anchor?.move || block.anchor?.resize === 'end' ? <TimingSection t={t} block={block} commit={commit} /> : null}
          {docLoc && block.clipId ? <FadeSection t={t} blocks={[block]} fades={fades} commit={commit} /> : null}
          {blockHasVolume(block) ? (
            <Section id="sound" title={t('inspector.sound')}>
              <VolumeField value={linearVolumeOf(block)} t={t} onCommit={(apply) => commit(volumeEdits([block], apply))} />
            </Section>
          ) : null}
          {block.kind === 'mg' && docLoc && pageChangesOf ? (
            <PageChangesSection
              read={readPageChanges}
              /* the clip's own entry (its fades) is not a change inside the page: it stays */
              onRemove={(list) => {
                const own = readPageChanges()?.own ?? [];
                const next = [...own, ...list];
                commit([{ loc: loc!, prop: 'overrides', value: next.length ? next as unknown as Record<string, unknown> : null }]);
              }}
              t={t}
            />
          ) : null}
          {target && lookOf ? (
            <AdvancedSection
              t={t}
              css={rawDeclarations(target.css)}
              onCommit={(set) => commit([{ loc: target.loc, prop: 'style', value: withDeclarations(target.css, set) || null }])}
              {...(lookOf.cls != null ? {
                cls: { value: lookOf.cls, onCommit: (next: string | null) => commit([{ loc: target.loc, prop: 'class', value: next }]) },
              } : {})}
            />
          ) : null}
        </>
      )}
    </>
  );
}

/**
 * Start, length, in point and speed, as timecodes (frames at the project's rate, as the player counts them) or seconds;
 * and the source bar: the whole file, the part the clip plays drawn on it — dragged, the clip plays another part of
 * its file in the same place (a slip); its ends dragged, it is trimmed.
 *
 * `at` is written the way dragging writes it, from the parent window; `end` is `in point + length` in source time
 * when there is an in point, else (a still) the right edge in the parent window.
 */
function TimingSection({ t, block, commit }: { t: T; block: TimelineBlock; commit: (edits: ClipEdit[]) => void }) {
  const [unit, setUnit] = useTimeUnit();
  const loc = block.loc!;
  const parentSec = (block.anchor?.parentStartMs ?? 0) / 1000;
  const durSec = (block.endMs - block.startMs) / 1000;
  /* the timeline's magnet: a longer clip pushes the next one along (a ripple), so the next one is no limit */
  const { magnet } = useTimelinePrefs();
  const maxDurSec = longestSec(block, durSec, magnet);
  const k = block.speed ?? 1;
  /* slowed down, the clip gets longer on the film: without the magnet, no slower than fits before the next clip */
  const fitSpeed = block.nextMs != null && block.nextMs > block.startMs
    ? Math.ceil(((durSec * k) / ((block.nextMs - block.startMs) / 1000)) * 100) / 100
    : FILM_SPEED_MIN;
  const minSpeed = magnet ? FILM_SPEED_MIN : Math.max(FILM_SPEED_MIN, fitSpeed);
  const trimFrom = block.anchor?.trimFrom;
  const timecode = unit === 'timecode';
  /* a frame of the project's rate: the step of the arrows on a time field, and what a typed `12f` counts in */
  const fps = useTimecodeFps();
  const time = {
    ctx: { time: true, fps },
    step: 1 / fps,
    ...(timecode ? { format: (s: number) => formatTimecode(s * 1000) } : { unit: 's' }),
  };
  const slipTo = (n: number) => {
    /* the in point slips the source, it does not change the length: the clip stays where and as long as it is */
    const span = durSec * k;
    commit([
      { loc, prop: 'start', value: round3(n), from: round3(trimFrom!) },
      { loc, prop: 'end', value: round3(n + span), from: round3(trimFrom! + span) },
    ].filter((e) => e.value !== e.from));
  };
  const lengthTo = (n: number) => {
    /* `time=[start,end]` is a window in source time: with an in point, push `end` and keep the in point. A still has
       no window; its `end` is the right edge on the film. A film second of a sped-up clip is `speed` of its source. */
    commit(trimFrom != null
      ? [{
        loc,
        prop: 'end',
        value: Math.min(round3(trimFrom + n * k), block.sourceDurMs != null ? block.sourceDurMs / 1000 : Infinity),
        from: round3(trimFrom + durSec * k),
      }]
      : [{ loc, prop: 'end', value: round3(block.startMs / 1000 - parentSec + n), from: round3(block.endMs / 1000 - parentSec) }]);
  };
  const canSpeed = (block.kind === 'video' || block.kind === 'voice' || block.kind === 'music' || block.kind === 'sfx') && !(block.src && filmSrcIsStill(block.src));
  return (
    <Section
      id="timing"
      title={t('inspector.timing')}
      aside={(
        <div role="radiogroup" aria-label={t('inspector.timeUnit')} className="flex h-5 items-center rounded-[4px] bg-[var(--fill-tsp)] p-px text-[10px]">
          {(['timecode', 'seconds'] as const).map((u) => (
            <button
              key={u}
              type="button"
              role="radio"
              aria-checked={unit === u}
              title={t(u === 'timecode' ? 'inspector.timeTimecode' : 'inspector.timeSeconds')}
              onClick={() => setUnit(u)}
              className={`h-[18px] rounded-[3px] px-1.5 font-medium transition ${unit === u ? 'bg-[var(--bg)] text-[var(--text)]' : 'text-[var(--text-faint)] hover:text-[var(--text)]'}`}
            >
              {u === 'timecode' ? 'TC' : 's'}
            </button>
          ))}
        </div>
      )}
    >
      <Row>
        {block.anchor?.move ? (
          <NumField
            label={t('inspector.at')}
            prefix={<ArrowRightToLine size={11} />}
            value={round3(block.startMs / 1000 - parentSec)}
            min={0}
            {...time}
            onCommit={(n) => commit([{ loc, prop: 'at', value: round3(n), from: round3(block.startMs / 1000 - parentSec) }])}
          />
        ) : <span />}
        {block.anchor?.resize === 'end' ? (
          <NumField
            label={t('inspector.duration')}
            prefix={<MoveHorizontal size={11} />}
            value={round3(durSec)}
            min={1 / fps}
            {...(maxDurSec != null ? { max: maxDurSec } : {})}
            {...time}
            onCommit={lengthTo}
          />
        ) : <span />}
      </Row>
      {trimFrom != null ? (
        <Row>
          <NumField
            label={t('inspector.inPoint')}
            prefix={<Scissors size={11} />}
            value={round3(trimFrom)}
            min={0}
            /* the clip keeps its length, so the in point goes as far as the source left after the clip: further, its
               end would pass the end of the file */
            max={block.room?.tailMs != null
              ? round3(trimFrom + (block.room.tailMs / 1000) * k)
              : round3(Math.max(0, trimFrom + durSec * k - 0.01))}
            {...time}
            onCommit={slipTo}
          />
          {canSpeed ? (
            <NumField
              label={t('inspector.speed')}
              prefix={<Gauge size={11} />}
              value={k}
              unit="×"
              step={0.25}
              min={minSpeed}
              max={FILM_SPEED_MAX}
              /* the source range stays; the clip gets shorter or longer on the film (its sound keeps its pitch) */
              onCommit={(n) => {
                const next = Math.round(Math.min(FILM_SPEED_MAX, Math.max(minSpeed, n)) * 100) / 100;
                if (next === k) return;
                commit([{ loc, prop: 'speed', value: next, from: k }]);
              }}
            />
          ) : <span />}
        </Row>
      ) : null}
      {/* why it cannot get slower: the next clip; the magnet would push it along instead */}
      {trimFrom != null && canSpeed && !magnet && minSpeed > FILM_SPEED_MIN ? (
        <p data-speed-limit="" className="px-0.5 text-[10.5px] leading-snug text-[var(--text-faint)]">
          {t('inspector.speedLimit').replace('{n}', String(minSpeed))}
        </p>
      ) : null}
      {trimFrom != null && block.sourceDurMs != null && block.sourceDurMs > 0 && block.anchor?.resize === 'end' && !block.anchor.still ? (
        <SourceBar t={t} block={block} timecode={timecode} onSlip={slipTo} onCommit={commit} maxDurSec={maxDurSec} />
      ) : null}
    </Section>
  );
}

/**
 * The whole source file as a bar, and the part the clip plays as a window on it. The window dragged is a slip: the
 * in point moves, the clip keeps its length and its place. Its left end dragged trims the head as the timeline does
 * (the in point and the start move together, the end stays); its right end trims the tail. Kept inside the file and
 * short of the next clip.
 */
function SourceBar({ t, block, timecode, onSlip, onCommit, maxDurSec }: {
  t: T;
  block: TimelineBlock;
  timecode: boolean;
  onSlip: (inSec: number) => void;
  onCommit: (edits: ClipEdit[]) => void;
  maxDurSec: number | undefined;
}) {
  const bar = React.useRef<HTMLDivElement | null>(null);
  const k = block.speed ?? 1;
  const total = block.sourceDurMs! / 1000;
  const inS = block.anchor!.trimFrom!;
  const span = ((block.endMs - block.startMs) / 1000) * k;
  const minSpan = k / timecodeFps();
  const [drag, setDrag] = React.useState<{ mode: 'slip' | 'head' | 'tail'; x: number; a: number; b: number } | null>(null);
  const a = drag?.a ?? inS;
  const b = drag?.b ?? inS + span;
  const label = (s: number) => (timecode ? formatTimecode(s * 1000) : `${round1(s)}s`);
  /* the head pulled out goes no further back than the film's start (the start moves with it) */
  const atSec = (block.startMs - (block.anchor?.parentStartMs ?? 0)) / 1000;
  const headFloor = block.anchor?.move ? Math.max(0, inS - atSec * k) : inS;
  const tailCeil = Math.min(total, maxDurSec != null ? inS + maxDurSec * k : total);
  const place = (mode: 'slip' | 'head' | 'tail', rawDx: number) => {
    /* by whole frames of the film, as the timeline moves an edge */
    const dxSec = Math.round(rawDx / minSpan) * minSpan;
    if (mode === 'slip') {
      const na = Math.max(0, Math.min(total - span, inS + dxSec));
      return { a: na, b: na + span };
    }
    if (mode === 'head') return { a: Math.max(headFloor, Math.min(inS + span - minSpan, inS + dxSec)), b: inS + span };
    return { a: inS, b: Math.max(inS + minSpan, Math.min(tailCeil, inS + span + dxSec)) };
  };
  const start = (mode: 'slip' | 'head' | 'tail') => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ mode, x: e.clientX, a: inS, b: inS + span });
  };
  const secPerPx = () => total / Math.max(1, bar.current?.clientWidth ?? 1);
  /* the ends sit inside the window: their events must not reach it as well (a trim written twice) */
  const move = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!drag) return;
    setDrag({ ...drag, ...place(drag.mode, (e.clientX - drag.x) * secPerPx()) });
  };
  const end = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!drag) return;
    const next = place(drag.mode, (e.clientX - drag.x) * secPerPx());
    setDrag(null);
    if (Math.abs(next.a - inS) < 0.0005 && Math.abs(next.b - inS - span) < 0.0005) return;
    if (drag.mode === 'slip') { onSlip(round3(next.a)); return; }
    /* a trim is written as the timeline writes one (the in point and the start move together at the head) */
    const ms = (s: number) => (s / k) * 1000;
    onCommit(editsForMoves([{
      loc: block.loc!,
      anchor: block.anchor!,
      before: { startMs: block.startMs, endMs: block.endMs },
      after: drag.mode === 'head'
        ? { startMs: block.startMs + ms(next.a - inS), endMs: block.endMs }
        : { startMs: block.startMs, endMs: block.startMs + ms(next.b - inS) },
      speed: k,
      sourceDurMs: block.sourceDurMs!,
    }]));
  };
  const pct = (s: number) => `${(s / total) * 100}%`;
  return (
    <div className="flex flex-col gap-1 pt-0.5">
      <div
        ref={bar}
        role="group"
        aria-label={t('inspector.sourceBar')}
        className="relative h-[22px] rounded-[4px]"
        style={{ background: 'repeating-linear-gradient(90deg, var(--fill-tsp) 0 14px, transparent 14px 28px), var(--fill-tsp)' }}
      >
        <div
          onPointerDown={start('slip')}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={() => setDrag(null)}
          title={t('inspector.slipHint')}
          className={`absolute inset-y-0 touch-none rounded-[4px] bg-[var(--accent-soft)] ${drag?.mode === 'slip' ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{ left: pct(a), width: pct(b - a), boxShadow: 'inset 0 0 0 2px var(--text)' }}
        >
          <span onPointerDown={start('head')} onPointerMove={move} onPointerUp={end} title={t('inspector.trimHead')}
            className="absolute inset-y-0 -left-1 w-2.5 cursor-ew-resize touch-none" />
          <span onPointerDown={start('tail')} onPointerMove={move} onPointerUp={end} title={t('inspector.trimTail')}
            className="absolute inset-y-0 -right-1 w-2.5 cursor-ew-resize touch-none" />
        </div>
      </div>
      <div className="flex justify-between font-mono text-[9.5px] tabular-nums text-[var(--text-faint)]">
        <span>{label(a)} – {label(b)}</span>
        <span>{label(total)}</span>
      </div>
    </div>
  );
}

/** Volume: a percentage (100% = as is) on a slider — adjusted by ear, so dragging beats typing. */
function VolumeField({ value, onCommit, t }: { value: number | Mixed; onCommit: (apply: FieldApply) => void; t: T }) {
  return (
    <SliderField
      label={t('inspector.gainDb')}
      value={value === MIXED ? MIXED : Math.round(value * 100)}
      min={0}
      max={200}
      neutral={100}
      unit="%"
      onCommit={(_, apply) => onCommit(apply)}
    />
  );
}

/** A clip's box as the stage's numbers, from its picture's own size `own` (see stage-clip). */
function clipTransform(block: TimelineBlock, own: MgBox, stage: { w: number; h: number }): MgTransform {
  return transformOf(block.kind === 'mg' ? 'page' : 'video', own, stage, block.box);
}

/**
 * Where a clip's box is when the clip is not on screen to be measured (the playhead elsewhere): from its own size and
 * its box, the same arithmetic the stage draws by, so the panel always speaks in stage pixels.
 */
function computedGeometry(block: TimelineBlock, own: MgBox, stage: { w: number; h: number }): StageGeometry {
  const t = clipTransform(block, own, stage);
  const b = clipFields(t, own);
  return { kind: 'clip', loc: block.loc ?? null, x: b.x, y: b.y, w: b.w, h: b.h, r: t.rotate, unit: 1, box: own, stage };
}

/**
 * What the person changed inside this page (text, styles, moves of its elements), one line each, with a way to undo
 * one. A change whose element the page no longer has (the agent rewrote the page) says so: it does nothing until the
 * element comes back, and undoing it is the way to clear it.
 */
function PageChangesSection({ read, onRemove, t }: {
  read: () => PageChanges | null;
  onRemove: (rest: FilmOverride[]) => void;
  t: T;
}) {
  /* the page says which changes lost their element when it reports its elements after a still frame, which comes
     after this panel opens: look again while it is open (a DOM attribute read, nothing more) */
  const [changes, setChanges] = React.useState(read);
  React.useEffect(() => {
    const id = window.setInterval(() => setChanges((prev) => {
      const next = read();
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
    }), 1000);
    return () => window.clearInterval(id);
  }, [read]);
  if (!changes?.list.length) return null;
  const what = (o: FilmOverride) => [
    o.text != null && t('inspector.pageChangeText'),
    o.t && t('inspector.pageChangeMoved'),
    o.s != null && t('inspector.pageChangeScaled'),
    o.r != null && t('inspector.pageChangeRotated'),
    o.style && Object.keys(o.style).length && t('inspector.pageChangeStyled'),
  ].filter(Boolean).join(', ');
  return (
    <Section id="page-changes" title={t('inspector.pageChanges')}>
      <ul className="flex flex-col gap-1">
        {changes.list.map((o, i) => {
          const lost = changes.lost.includes(o.at ?? '');
          return (
            <li key={`${o.at}#${o.n ?? 0}`} className="flex min-w-0 items-center gap-1.5 text-[11px]">
              {lost ? <CircleAlert size={12} className="shrink-0 text-[var(--warn)]" aria-label={t('inspector.pageChangeLost')} /> : null}
              <span className="min-w-0 flex-1 truncate" title={lost ? `${o.at} · ${t('inspector.pageChangeLost')}` : o.at}>
                <span className="font-mono text-[var(--text)]">{o.at}{o.n ? ` (${o.n})` : ''}</span>
                <span className="text-[var(--text-muted)]"> · {lost ? t('inspector.pageChangeLost') : what(o)}</span>
              </span>
              <SectionAction label={t('inspector.pageChangeRemove')} onClick={() => onRemove(changes.list.filter((_, j) => j !== i))}>
                <X size={12} />
              </SectionAction>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** Each picture clip's place, for moving several together. */
type Placed = { block: TimelineBlock; loc: string; own: MgBox; value: MgTransform; x: number; y: number; w: number; h: number };

function placedOf(block: TimelineBlock, stage: { w: number; h: number }): Placed | null {
  if (!isPicture(block) || !block.size) return null;
  const value = clipTransform(block, block.size, stage);
  return { block, loc: block.loc!, own: block.size, value, ...clipFields(value, block.size) };
}

/**
 * Several clips: what they share. Their places move together (`+20` moves each by 20, a value typed puts each
 * there), they align to each other and space out evenly; their look and their volume change on all at once.
 * "Mixed" where they differ.
 */
function MultiClipPanel({
  blocks, onEdit, stage, clipLookOf, onPreviewLook, fades,
}: {
  fades?: ReadonlyMap<string, FadeMs>;
  blocks: readonly TimelineBlock[];
  onEdit?: (edits: ClipEdit[]) => Promise<string | null>;
  stage: { w: number; h: number };
  clipLookOf?: (clipLoc: string) => { css: string; look: ClipLook | null } | null;
  onPreviewLook?: (clipLoc: string, css: string | null) => void;
}) {
  const t = useT();
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const commit = (edits: ClipEdit[]) => {
    if (!onEdit || !edits.length) return;
    setRefusal(null);
    void onEdit(edits).then((failed) => {
      if (!failed) return;
      for (const loc of new Set(edits.filter((e) => e.prop === 'style').map((e) => e.loc))) onPreviewLook?.(loc, null);
      setRefusal(plainClipRefusal(failed));
    });
  };
  const kinds = [...new Set(blocks.map(clipWhat))];
  const placed = blocks.map((b) => placedOf(b, stage));
  const allPlaced = onEdit && placed.every(Boolean) ? placed as Placed[] : null;
  const targets: ClipTarget[] = [];
  if (onEdit && clipLookOf && blocks.every(isPicture)) {
    for (const b of blocks) {
      const found = clipLookOf(b.loc!);
      if (found) targets.push({ loc: b.loc!, css: found.css, look: found.look });
    }
  }
  const look = targets.length === blocks.length ? clipsLook(targets, commit, onPreviewLook) : null;
  const volumeAll = Boolean(onEdit) && blocks.every((b) => b.loc && blockHasVolume(b));
  const volume = volumeAll && blocks.every((b) => linearVolumeOf(b) === linearVolumeOf(blocks[0]!)) ? linearVolumeOf(blocks[0]!) : MIXED;

  const boxEdits = (each: (p: Placed) => Partial<MgTransform>): ClipEdit[] => (allPlaced ?? []).flatMap((p) => {
    const next = compactBox({ ...p.value, ...each(p) }, p.own);
    const before = compactBox(p.value, p.own);
    return JSON.stringify(next) === JSON.stringify(before) ? [] : [{ loc: p.loc, prop: 'box', value: next }];
  });
  const common = (fn: (p: Placed) => number) => {
    if (!allPlaced) return MIXED;
    const v = round1(fn(allPlaced[0]!));
    return allPlaced.every((p) => round1(fn(p)) === v) ? v : MIXED;
  };
  const alignTo = (edge: AlignEdge) => {
    if (!allPlaced) return;
    const left = Math.min(...allPlaced.map((p) => p.x));
    const top = Math.min(...allPlaced.map((p) => p.y));
    const right = Math.max(...allPlaced.map((p) => p.x + p.w));
    const bottom = Math.max(...allPlaced.map((p) => p.y + p.h));
    commit(boxEdits((p) => {
      if (edge === 'left') return clipFieldPart('x', left, p.own);
      if (edge === 'hcenter') return clipFieldPart('x', (left + right) / 2 - p.w / 2, p.own);
      if (edge === 'right') return clipFieldPart('x', right - p.w, p.own);
      if (edge === 'top') return clipFieldPart('y', top, p.own);
      if (edge === 'vcenter') return clipFieldPart('y', (top + bottom) / 2 - p.h / 2, p.own);
      return clipFieldPart('y', bottom - p.h, p.own);
    }));
  };
  /* the same gap between each and the next, the first and the last staying */
  const distribute = (axis: 'x' | 'y') => {
    if (!allPlaced || allPlaced.length < 3) return;
    const size = (p: Placed) => (axis === 'x' ? p.w : p.h);
    const sorted = [...allPlaced].sort((p, q) => p[axis] - q[axis]);
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const gap = (last[axis] + size(last) - first[axis] - sorted.reduce((s, p) => s + size(p), 0)) / (sorted.length - 1);
    const to = new Map<Placed, number>();
    let cursor = first[axis];
    for (const p of sorted) { to.set(p, cursor); cursor += size(p) + gap; }
    commit(boxEdits((p) => clipFieldPart(axis, to.get(p)!, p.own)));
  };

  return (
    <>
      <Header
        icon={kinds.length === 1 ? clipIcon(kinds[0]!, 13) : kindIcon('mg', 13)}
        name={t('inspector.multi').replace('{n}', String(blocks.length))}
        meta={kinds.map((k) => clipKindLabel(t, k)).join(' · ')}
      />
      {refusal ? (
        <RefusalBanner message={refusal} onDismiss={() => setRefusal(null)} t={t} />
      ) : null}
      {allPlaced ? (
        <Section id="position" title={t('inspector.position')}>
          <AlignBar t={t} onAlign={alignTo} {...(allPlaced.length >= 3 ? { onDistribute: distribute } : {})} />
          <Row>
            <NumField label={t('inspector.x')} prefix="X" value={common((p) => p.x)} min={-COORD_LIMIT} max={COORD_LIMIT} ctx={{ percent: stage.w }}
              onCommit={(_, apply) => commit(boxEdits((p) => clipFieldPart('x', apply(p.x), p.own)))} />
            <NumField label={t('inspector.y')} prefix="Y" value={common((p) => p.y)} min={-COORD_LIMIT} max={COORD_LIMIT} ctx={{ percent: stage.h }}
              onCommit={(_, apply) => commit(boxEdits((p) => clipFieldPart('y', apply(p.y), p.own)))} />
          </Row>
          <div className="grid grid-cols-[1fr_1fr_24px] items-center gap-1.5">
            <NumField label={t('inspector.width')} prefix="W" value={common((p) => p.w)} min={1} max={COORD_LIMIT} ctx={{ percent: stage.w }}
              onCommit={(_, apply) => commit(boxEdits((p) => clipFieldPart('w', apply(p.w), p.own)))} />
            <NumField label={t('inspector.height')} prefix="H" value={common((p) => p.h)} min={1} max={COORD_LIMIT} ctx={{ percent: stage.h }}
              onCommit={(_, apply) => commit(boxEdits((p) => clipFieldPart('h', apply(p.h), p.own)))} />
            <LockToggle t={t} locked />
          </div>
          <Row>
            <NumField label={t('inspector.rotate')} prefix={<RotateGlyph />} value={common((p) => p.value.rotate)} unit="°"
              onCommit={(_, apply) => commit(boxEdits((p) => ({ rotate: wrapDeg(apply(p.value.rotate)) })))} />
            <span />
          </Row>
        </Section>
      ) : null}
      {look ? (
        <>
          <AppearanceSection look={look} t={t} />
          <AdjustSection look={look} t={t} />
          <EffectsSection look={look} t={t} />
        </>
      ) : null}
      {onEdit && blocks.every((b) => b.clipId && b.loc && parseFilmDocLoc(b.loc) != null) ? <FadeSection t={t} blocks={blocks} fades={fades} commit={commit} /> : null}
      {volumeAll ? (
        <Section id="sound" title={t('inspector.sound')}>
          <VolumeField value={volume} t={t} onCommit={(apply) => commit(volumeEdits(blocks, apply))} />
        </Section>
      ) : null}
    </>
  );
}

/**
 * Fade in and out, in seconds: how long the clips' picture and sound take to come up from nothing at their start and
 * to go down to nothing at their end (film.html keeps them in each clip's `overrides`, see lib/clip-fade). Each fits in
 * its clip: the other fade gives way only as far as it must.
 */
function FadeSection({ t, blocks, fades, commit }: { t: T; blocks: readonly TimelineBlock[]; fades: ReadonlyMap<string, FadeMs> | undefined; commit: (edits: ClipEdit[]) => void }) {
  const fps = useTimecodeFps();
  const of = (b: TimelineBlock): FadeMs => (b.clipId ? fades?.get(b.clipId) : undefined) ?? [0, 0];
  const common = (i: 0 | 1): number | Mixed => {
    const v = round3(of(blocks[0]!)[i] / 1000);
    return blocks.every((b) => round3(of(b)[i] / 1000) === v) ? v : MIXED;
  };
  const set = (i: 0 | 1, apply: FieldApply) => commit(blocks.flatMap((b) => {
    const was = of(b);
    const len = (b.endMs - b.startMs) / 1000;
    const own = Math.max(0, Math.min(len, round3(apply(was[i] / 1000))));
    const other = Math.min(round3(was[1 - i]! / 1000), round3(len - own));
    const next = i === 0 ? [own, other] : [other, own];
    return next[0] === round3(was[0] / 1000) && next[1] === round3(was[1] / 1000) ? [] : [{ loc: b.loc!, prop: 'fade', value: next }];
  }));
  const longest = Math.min(...blocks.map((b) => (b.endMs - b.startMs) / 1000));
  return (
    <Section id="fades" title={t('inspector.fades')}>
      <Row>
        <NumField label={t('inspector.fadeIn')} word value={common(0)} min={0} max={round3(longest)} step={1 / fps} unit="s"
          ctx={{ time: true, fps }} onCommit={(_, apply) => set(0, apply)} />
        <NumField label={t('inspector.fadeOut')} word value={common(1)} min={0} max={round3(longest)} step={1 / fps} unit="s"
          ctx={{ time: true, fps }} onCommit={(_, apply) => set(1, apply)} />
      </Row>
    </Section>
  );
}

/** The transition picked on the timeline, for the inspector: its kind and length; a new length, or taken away. */
export type TransitionPick = {
  kind: FoundKind;
  durationMs: number;
  onDuration: (ms: number) => Promise<string | null>;
  onRemove: () => void;
};

/** A transition picked on the timeline: its length, typed, and a button that takes it away. */
function TransitionPanel({ t, pick }: { t: T; pick: TransitionPick }) {
  const fps = useTimecodeFps();
  const [refusal, setRefusal] = React.useState<string | null>(null);
  return (
    <>
      <Header icon={<Film size={13} />} name={t(`transitions.${pick.kind}`)} meta={t('inspector.transition')} />
      {refusal ? <RefusalBanner message={refusal} onDismiss={() => setRefusal(null)} t={t} /> : null}
      <Section id="transition" title={t('inspector.transition')}>
        <Row>
          <NumField label={t('inspector.transitionLength')} word value={round3(pick.durationMs / 1000)} min={1 / fps} step={1 / fps} unit="s"
            ctx={{ time: true, fps }}
            onCommit={(n) => { void pick.onDuration(Math.round(n * 1000)).then((failed) => setRefusal(failed)); }} />
          <span />
        </Row>
        <button type="button" data-transition-remove="" onClick={pick.onRemove}
          className="mt-1 flex h-7 w-full items-center justify-center gap-1.5 rounded-md border text-[11.5px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]"
          style={{ borderColor: 'var(--border)' }}>
          <X size={12} aria-hidden />
          {t('inspector.transitionRemove')}
        </button>
      </Section>
    </>
  );
}

/**
 * A clip's `box` (film.html only — a code-shaped clip has no such section), its picture's own size `own` known.
 *
 * The fields are Figma's: X / Y, W / H in stage px, the angle, and the align row. W and H keep the picture's
 * proportions while locked (typing one sets the other, and the box is written with its width alone); unlocked, a
 * video or still gets a box of its own proportions (its CSS fits or crops the picture in it). A page always shows
 * whole, so its box keeps its proportions.
 */
function ClipPositionSection({
  t, loc, page, own, placed, value, geometry, onCommit, onPreview,
}: {
  t: T;
  loc: string;
  page: boolean;
  own: MgBox;
  /** A box is written (else the clip is where it lands by default, and there is nothing to reset). */
  placed: boolean;
  value: MgTransform;
  geometry: StageGeometry;
  onCommit: (edits: ClipEdit[]) => void;
  /** The picture follows a dragged number; letting go / Enter writes (the same feel as a layer's fields). */
  onPreview?: (patch: Partial<MgTransform> | null) => void;
}) {
  const [locked, setLocked] = React.useState(true);
  const lockedNow = page || locked;
  const patch = (part: Partial<MgTransform>) => {
    onCommit([{ loc, prop: 'box', value: compactBox({ ...value, ...part }, own) }]);
  };
  /* the fields show where the clip is now (it follows a drag on the stage); a typed number is worked out from the
     picture's own size and the written box, never from the drawn place, which already shows this very edit */
  const box = geometry.box ?? own;
  const bind = (part: (n: number) => Partial<MgTransform>) => ({
    onCommit: (n: number) => patch(part(n)),
    ...(onPreview ? { onPreview: (n: number) => onPreview(part(n)), onRevert: () => onPreview(null) } : {}),
  });
  const xPart = (x: number) => clipFieldPart('x', x, box);
  const yPart = (y: number) => clipFieldPart('y', y, box);
  const sizePart = (field: 'w' | 'h', n: number): Partial<MgTransform> => {
    if (lockedNow) return clipFieldPart(field, n, box);
    return field === 'w' ? { scaleX: n / (box.w || 1) } : { scaleY: n / (box.h || 1) };
  };
  const { w: stageW, h: stageH } = geometry.stage;
  const alignTo = (edge: AlignEdge) => {
    const { w, h } = clipFields(value, box);
    const part: Partial<MgTransform> = {};
    if (edge === 'left') Object.assign(part, xPart(0));
    if (edge === 'hcenter') Object.assign(part, xPart((stageW - w) / 2));
    if (edge === 'right') Object.assign(part, xPart(stageW - w));
    if (edge === 'top') Object.assign(part, yPart(0));
    if (edge === 'vcenter') Object.assign(part, yPart((stageH - h) / 2));
    if (edge === 'bottom') Object.assign(part, yPart(stageH - h));
    if ((part.x ?? value.x) === value.x && (part.y ?? value.y) === value.y) return;
    patch(part);
  };
  return (
    <Section
      id="position"
      title={t('inspector.position')}
      aside={placed ? (
        <SectionAction label={t('inspector.resetTransform')} onClick={() => onCommit([{ loc, prop: 'box', value: null }])}>
          <RotateCcw size={11} />
        </SectionAction>
      ) : null}
    >
      <AlignBar t={t} onAlign={alignTo} />
      <Row>
        <NumField label={t('inspector.x')} prefix="X" value={geometry.x} min={-COORD_LIMIT} max={COORD_LIMIT} ctx={{ percent: stageW }} {...bind(xPart)} />
        <NumField label={t('inspector.y')} prefix="Y" value={geometry.y} min={-COORD_LIMIT} max={COORD_LIMIT} ctx={{ percent: stageH }} {...bind(yPart)} />
      </Row>
      <div className="grid grid-cols-[1fr_1fr_24px] items-center gap-1.5">
        <NumField label={t('inspector.width')} prefix="W" value={geometry.w} min={1} max={COORD_LIMIT} ctx={{ percent: stageW }} {...bind((w) => sizePart('w', w))} />
        <NumField label={t('inspector.height')} prefix="H" value={geometry.h} min={1} max={COORD_LIMIT} ctx={{ percent: stageH }} {...bind((h) => sizePart('h', h))} />
        <LockToggle t={t} locked={lockedNow} {...(page ? {} : { onChange: setLocked })} />
      </div>
      <Row>
        <NumField label={t('inspector.rotate')} prefix={<RotateGlyph />} value={value.rotate} unit="°" {...bind((rotate) => ({ rotate: wrapDeg(rotate) }))} />
        <span />
      </Row>
    </Section>
  );
}
