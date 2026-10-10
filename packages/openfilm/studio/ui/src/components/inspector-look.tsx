/**
 * How a picture looks, as the inspector shows it: crop and fill, appearance, adjustments, effects, type — the same
 * sections, the same controls, for a whole clip, a layer inside a page, and several of either.
 *
 * Each section works on a `Look`: one or more things, each read and written as standard CSS properties (see
 * lib/clip-look). A control turns what it is given into the properties to write for each thing (`LookEdit`), from
 * that thing's own values — so `+10` on several opacities raises each. What the properties are stored in (a clip's
 * `style` in film.html, a layer's override) is the panel's business, not the section's.
 */
import * as React from 'react';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Ban, ChevronDown, Circle, Crop as CropIcon, Heart, Minus, Plus, RotateCcw, Square,
  SquareDashed, Star,
} from 'lucide-react';

import type { useT } from '@/i18n';
import {
  ADJUST_KEYS, BLEND_MODES, FADE_DEFAULT, SHADOW_DEFAULT, STROKE_DEFAULT, adjustOf, cropCss, cropForRatio, cropOf,
  cropRatio, filterParts, framingCss, framingOf, ownedDeclaration, pxOf, shadowOf, strokeCss,
  strokeOf, withAdjust, withShadow, type AdjustKey, type Crop, type Fade, type FadeSide, type Shadow, type Stroke,
} from '@/lib/clip-look';
import {
  MASK_FIELDS, MASK_SHAPES, fadeIn, maskDefault, maskOf, maskOwned, withFade, withMask, type Mask, type MaskBox, type MaskShape,
} from '@/lib/clip-mask';
import type { MaskSession } from '@/lib/stage-mask';
import { knownAvailable, stylesOf } from '@/lib/font-menu';
import {
  NAMED_WEIGHTS, isItalic, joinFontFamily, parseStyleValue, snapStyle, splitFontFamily, styleOptions, styleValue, weightKey, weightNumber,
  type FontStyles,
} from '@/lib/font-styles';
import { FONT_SIZES, metricOf } from '@/lib/type-metrics';
import { familyRenders, useInstalledFonts, useProjectFonts } from '@/lib/use-fonts';
import { declarations } from '../../../../src/film-doc.mjs';
import {
  ColorField, EdgeGlyph, FontSizeGlyph, ICON, LetterSpacingGlyph, LineHeightGlyph, MIXED, MetricField, NumField, RadiusGlyph, RotateGlyph, Row, Section, SectionAction, Segmented, SelectField, SliderField, SubLabel, type FieldApply, type Mixed,
} from './inspector-fields';
import { FontFamilyPicker } from './FontFamilyPicker';
import { Popover } from './Popover';

type T = ReturnType<typeof useT>;

/* ───────────────────────────── the model ───────────────────────────── */

/** One thing's CSS property (kebab-case), as it is now. */
export type LookRead = (prop: string) => string | undefined;
/** Properties to write: a value, or null — "none of mine" (the panel decides what that leaves). */
export type LookSet = Record<string, string | null>;
/** What a control does to one thing, from that thing's own values. */
export type LookEdit = (read: LookRead) => LookSet;

export interface Look {
  /** How many things it is. */
  n: number;
  /** What `fn` makes of every thing's values, when they agree; MIXED when they do not. */
  common<V>(fn: (read: LookRead) => V): V | Mixed;
  /** Shows an edit on the picture, nothing written. */
  preview(edit: LookEdit): void;
  /** Writes an edit, as one change. */
  commit(edit: LookEdit): void;
  /** Takes a preview back off the picture. */
  revert(): void;
}

/**
 * A Look over `targets`: read each through `readOf`, and hand each one's properties to `write` (the panel stores
 * them). `write` gets only the things an edit changes.
 */
export function makeLook<Tg>(
  targets: readonly Tg[],
  readOf: (t: Tg) => LookRead,
  write: {
    commit: (sets: [Tg, LookSet][]) => void;
    preview?: (sets: [Tg, LookSet][]) => void;
    revert?: () => void;
  },
): Look {
  const reads = targets.map(readOf);
  const sets = (edit: LookEdit, kept?: ReadonlyMap<string, string | undefined>[] | null): [Tg, LookSet][] => targets.flatMap((tg, i) => {
    const read = reads[i]!;
    const set = edit(read);
    /* unchanged properties are not written: the agent reads the diff, and a no-op would be an undo step. Unchanged
       from what was there before a preview: the layer is measured again while previewed, so by now it reads as the
       preview, and a kept preview would read as no change */
    const was = (k: string) => (kept?.[i]?.has(k) ? kept[i]!.get(k) : read(k));
    const changed = Object.entries(set).filter(([k, v]) => (v ?? undefined) !== was(k));
    return changed.length ? [[tg, Object.fromEntries(changed)] as [Tg, LookSet]] : [];
  });
  return {
    n: targets.length,
    common(fn) {
      if (!reads.length) return MIXED;
      const first = fn(reads[0]!);
      const key = JSON.stringify(first);
      return reads.every((r) => JSON.stringify(fn(r)) === key) ? first : MIXED;
    },
    /* shown as said, unchanged or not: a layer reads as its kept change while a preview paints over it, so painting
       back what was there would read as no change */
    preview(edit) {
      if (!previewedBefore || previewedBefore.length !== targets.length) previewedBefore = targets.map(() => new Map());
      const list = targets.flatMap((tg, i) => {
        const set = edit(reads[i]!);
        for (const k of Object.keys(set)) if (!previewedBefore![i]!.has(k)) previewedBefore![i]!.set(k, reads[i]!(k));
        return Object.keys(set).length ? [[tg, set] as [Tg, LookSet]] : [];
      });
      write.preview?.(list);
    },
    commit(edit) {
      const list = sets(edit, previewedBefore);
      previewedBefore = null;
      if (list.length) write.commit(list);
    },
    revert() { previewedBefore = null; write.revert?.(); },
  };
}

/** What each previewed property of the things in hand was before its first preview (see makeLook's `sets`). */
let previewedBefore: Map<string, string | undefined>[] | null = null;
/** A preview was painted back by hand (as a preview of what was there): nothing previewed stands any more. */
const previewSettled = () => { previewedBefore = null; };

/** What a property is when nothing sets it: writing "none of mine" over a look the film's CSS gives, this is written. */
export const NEUTRAL: Record<string, string> = {
  opacity: '1', filter: 'none', 'clip-path': 'none', 'border-radius': '0', 'mix-blend-mode': 'normal', 'object-fit': 'contain',
  'object-position': '50% 50%', 'mask-image': 'none', border: 'none', 'text-transform': 'none',
};

/** Whether `v` looks as nothing set (`1`, `none`, `0px`, …). */
export function isNeutral(prop: string, v: string | undefined): boolean {
  if (v == null || v === '') return true;
  const s = v.trim().toLowerCase();
  if (s === NEUTRAL[prop]) return true;
  if (prop === 'opacity') return Number(s) === 1;
  if (prop === 'border-radius') return pxOf(s) === 0;
  if (prop === 'object-position') { const f = framingOf(s); return f != null && f[0] === 50 && f[1] === 50; }
  if (prop === 'border') return strokeOf(s) === undefined;
  return s === 'none' || s === 'normal';
}

export const camelOf = (prop: string) => prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
export const kebabOf = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Each value of an apply over a value that may be missing. */
const at = (apply: FieldApply, v: number | null | undefined, fallback = 0) => apply(v ?? fallback);
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/* ───────────────────────────── crop & fill ───────────────────────────── */

const RATIOS: { id: string; ratio?: number }[] = [
  { id: 'free' }, { id: 'original' }, { id: '16:9', ratio: 16 / 9 }, { id: '9:16', ratio: 9 / 16 }, { id: '1:1', ratio: 1 }, { id: '4:3', ratio: 4 / 3 },
];

/**
 * How the picture fills its box (`object-fit`), the crop of its edges (`clip-path: inset()`, in % of the box, its
 * corners kept round), a crop to a shape (centered), round corners, and where the picture sits in its box
 * (`object-position`). A `clip-path` of another shape is the raw CSS's, and the crop is not shown over it.
 */
export function CropSection({
  look, t, fit, framing, box, own, onStartCrop,
}: {
  look: Look;
  t: T;
  /** Whether the picture can be fitted or framed in its box (a video, a still, an image): a page always shows whole. */
  fit: boolean;
  framing: boolean;
  /** The box on the stage (unturned): what a crop to a shape is worked out on. Unknown: no shapes. */
  box?: { w: number; h: number } | null;
  /** The picture's own size: the "Original" shape. */
  own?: { w: number; h: number } | null;
  onStartCrop?: () => void;
}) {
  const crop = look.common((read) => cropOf(read('clip-path')));
  const fitValue = look.common((read) => {
    const v = read('object-fit') ?? 'contain';
    return v === 'cover' || v === 'fill' ? v : 'contain';
  });
  const radius = look.common((read) => pxOf(read('border-radius')) ?? 0);
  const frame = look.common((read) => framingOf(read('object-position')));
  const cropUnreadable = look.common((read) => cropOf(read('clip-path')) == null);
  const touched = look.common((read) => !isNeutral('clip-path', read('clip-path')) || !isNeutral('object-position', read('object-position'))
    || !isNeutral('border-radius', read('border-radius')) || (read('object-fit') ?? 'contain') !== 'contain');

  const cropEdit = (side: number, apply: FieldApply): LookEdit => (read): LookSet => {
    const now = cropOf(read('clip-path'));
    if (!now) return {};
    const next = [...now] as Crop;
    /* the opposite edge stays: the two never meet */
    next[side] = Math.max(0, Math.min(99 - now[(side + 2) % 4]!, round(apply(now[side]!), 2)));
    return { 'clip-path': cropCss(next, pxOf(read('border-radius')) ?? 0) };
  };
  const radiusEdit = (apply: FieldApply): LookEdit => (read) => {
    const r = Math.max(0, round(at(apply, pxOf(read('border-radius')))));
    const now = cropOf(read('clip-path'));
    /* a crop cuts the box's own corners away: it carries the same roundness */
    return { 'border-radius': r > 0 ? `${r}px` : null, ...(now && now.some((v) => v > 0) ? { 'clip-path': cropCss(now, r) } : {}) };
  };
  const ratioOf = (id: string) => (id === 'original' ? (own && own.h > 0 ? own.w / own.h : undefined) : RATIOS.find((r) => r.id === id)?.ratio);
  const shape = (() => {
    if (!box || crop === MIXED || !crop) return 'free';
    const now = cropRatio(crop, box.w, box.h);
    for (const r of RATIOS) {
      const ratio = ratioOf(r.id);
      if (!ratio) continue;
      /* a crop to a shape is centered, and as large as fits */
      const want = cropForRatio(box.w, box.h, ratio);
      if (Math.abs(now - ratio) / ratio < 0.005 && want.every((v, i) => Math.abs(v - crop[i]!) < 0.1)) return r.id;
    }
    return 'free';
  })();
  const toShape = (id: string) => {
    const ratio = ratioOf(id);
    if (!ratio || !box) return;
    look.commit((read) => ({ 'clip-path': cropCss(cropForRatio(box.w, box.h, ratio), pxOf(read('border-radius')) ?? 0) }));
  };
  const sides: { i: number; side: FadeSide; label: string }[] = [
    { i: 0, side: 'top', label: t('inspector.cropTop') },
    { i: 2, side: 'bottom', label: t('inspector.cropBottom') },
    { i: 3, side: 'left', label: t('inspector.cropLeft') },
    { i: 1, side: 'right', label: t('inspector.cropRight') },
  ];
  return (
    <Section
      id="crop"
      title={t('inspector.cropFill')}
      aside={(
        <>
          {onStartCrop ? (
            <button
              type="button"
              onClick={onStartCrop}
              className="flex h-5 items-center gap-1 rounded-[4px] px-1.5 text-[10.5px] font-medium text-[var(--accent)] transition hover:bg-[var(--bg-hover)]"
            >
              <CropIcon size={11} />{t('inspector.cropStart')}
            </button>
          ) : null}
          {touched === true || touched === MIXED ? (
            <SectionAction
              label={t('inspector.resetSection')}
              onClick={() => look.commit(() => ({ 'object-fit': null, 'object-position': null, 'clip-path': null, 'border-radius': null }))}
            >
              <RotateCcw size={11} />
            </SectionAction>
          ) : null}
        </>
      )}
    >
      {fit ? (
        <Segmented
          label={t('inspector.fit')}
          value={fitValue}
          options={[
            { value: 'contain', label: t('inspector.fitContain') },
            { value: 'cover', label: t('inspector.fitCover') },
            { value: 'fill', label: t('inspector.fitFill') },
          ]}
          onChange={(v) => look.commit(() => ({ 'object-fit': v === 'contain' ? null : v }))}
        />
      ) : null}
      {cropUnreadable === false ? (
        <>
          <Row>
            {sides.map(({ i, side, label }) => (
              <NumField
                key={side}
                label={label}
                prefix={<EdgeGlyph side={side} />}
                value={crop === MIXED || !crop ? MIXED : crop[i]}
                unit="%"
                min={0}
                max={99}
                step={0.5}
                onPreview={(_, apply) => look.preview(cropEdit(i, apply))}
                onCommit={(_, apply) => look.commit(cropEdit(i, apply))}
                onRevert={() => look.revert()}
              />
            ))}
          </Row>
          {box && look.n === 1 ? (
            <Segmented
              label={t('inspector.cropShape')}
              value={shape}
              small
              options={RATIOS.filter((r) => r.id !== 'original' || (own && own.h > 0)).map((r) => ({
                value: r.id,
                label: r.id === 'free' ? t('inspector.cropFree') : r.id === 'original' ? t('inspector.cropOriginal') : r.id,
              }))}
              onChange={toShape}
            />
          ) : null}
        </>
      ) : (
        <p className="text-[10.5px] leading-[15px] text-[var(--text-faint)]">{t('inspector.cropCustom')}</p>
      )}
      <Row>
        <NumField
          label={t('inspector.radius')}
          prefix={<RadiusGlyph />}
          value={radius}
          unit="px"
          min={0}
          max={100_000}
          onPreview={(_, apply) => look.preview(radiusEdit(apply))}
          onCommit={(_, apply) => look.commit(radiusEdit(apply))}
          onRevert={() => look.revert()}
        />
        <span />
      </Row>
      {framing && frame !== null ? (
        <>
          <SubLabel>{t('inspector.framing')}</SubLabel>
          <Row>
            {([0, 1] as const).map((axis) => {
              const edit = (apply: FieldApply): LookEdit => (read) => {
                const now = framingOf(read('object-position')) ?? [50, 50];
                const next: [number, number] = [...now];
                next[axis] = round(apply(now[axis]), 2);
                return { 'object-position': framingCss(next) };
              };
              return (
                <NumField
                  key={axis}
                  label={axis === 0 ? t('inspector.framingX') : t('inspector.framingY')}
                  prefix={axis === 0 ? 'X' : 'Y'}
                  value={frame === MIXED ? MIXED : frame[axis]}
                  unit="%"
                  min={-100}
                  max={200}
                  onPreview={(_, apply) => look.preview(edit(apply))}
                  onCommit={(_, apply) => look.commit(edit(apply))}
                  onRevert={() => look.revert()}
                />
              );
            })}
          </Row>
        </>
      ) : null}
    </Section>
  );
}

/* ───────────────────────────── mask ───────────────────────────── */

/** The shape buttons' glyphs: a line, a band, then lucide's. */
function MaskGlyph({ shape }: { shape: MaskShape | 'none' }) {
  if (shape === 'linear' || shape === 'mirror') {
    return (
      <svg width={ICON} height={ICON} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
        <rect x="1.5" y="1.5" width="11" height="11" rx="2" />
        {shape === 'linear'
          ? <path d="M1.5 7.5h11V10.5a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2z" fill="currentColor" stroke="none" />
          : <path d="M1.5 5h11v4h-11z" fill="currentColor" stroke="none" />}
      </svg>
    );
  }
  const Icon = { none: Ban, ellipse: Circle, rect: Square, star: Star, heart: Heart }[shape];
  return <Icon size={ICON} strokeWidth={1.6} />;
}

/**
 * A mask, as CapCut's: a shape the picture shows through (or, inverted, is hidden by), placed, sized, turned and
 * feathered in % of the box. Written as `mask-image` layers (lib/clip-mask: what each shape is in CSS, and how it sits
 * with the faded edges, which share the property, and with the crop's clip-path). A mask written by hand is "custom":
 * the raw CSS (Advanced) has it.
 *
 * "Edit on picture" draws the mask's outline and handles over the thing in hand (`onEditMask`, see lib/stage-mask):
 * the stage previews a drag and writes once, at the release; it is turned on with a new shape.
 */
export function MaskSection({
  look, t, box, target, onEditMask,
}: {
  look: Look;
  t: T;
  /** The box on the stage (unturned): its proportions place a line's stops. Unknown: as if square. */
  box?: MaskBox | null;
  /** Whose mask, for the stage's handles. */
  target?: MaskSession['target'] | null;
  onEditMask?: (session: MaskSession | null) => void;
}) {
  const mbox = box && box.w > 0 && box.h > 0 ? box : null;
  const mask = look.common((read) => maskOf(read('mask-image'), read('mask-composite'), mbox));
  const now = mask === MIXED ? null : mask;
  const [editing, setEditing] = React.useState(false);
  const canEdit = Boolean(onEditMask && target && look.n === 1);

  const write = (next: Mask | null): LookEdit => (read) => withMask(read('mask-image'), read('mask-composite'), next, mbox) ?? {};
  const edit = (fn: (m: Mask) => Mask): LookEdit => (read) => {
    const m = maskOf(read('mask-image'), read('mask-composite'), mbox);
    return m ? write(fn(m))(read) : {};
  };
  const pick = (shape: string) => {
    if (shape === 'none') { setEditing(false); look.commit(write(null)); return; }
    look.commit((read) => {
      const m = maskOf(read('mask-image'), read('mask-composite'), mbox);
      return m === null ? {} : write(maskDefault(shape as MaskShape, mbox, m))(read);
    });
    if (canEdit) setEditing(true);
  };

  /* the stage's handles: the mask as written, written back through this look (one change at the release) */
  const lookRef = React.useRef(look);
  lookRef.current = look;
  const boxRef = React.useRef(mbox);
  boxRef.current = mbox;
  const maskKey = editing && canEdit && now ? JSON.stringify(now) : null;
  const targetKey = target ? JSON.stringify(target) : null;
  React.useEffect(() => {
    if (!onEditMask) return;
    if (!maskKey || !targetKey) { onEditMask(null); return; }
    const put = (m: Mask): LookEdit => (read) => withMask(read('mask-image'), read('mask-composite'), m, boxRef.current) ?? {};
    onEditMask({
      target: JSON.parse(targetKey) as MaskSession['target'],
      mask: JSON.parse(maskKey) as Mask,
      preview: (m) => lookRef.current.preview(put(m)),
      commit: (m) => lookRef.current.commit(put(m)),
      cancel: () => lookRef.current.revert(),
    });
  }, [maskKey, targetKey, onEditMask]);
  React.useEffect(() => () => onEditMask?.(null), [onEditMask]);

  const num = (key: 'x' | 'y' | 'w' | 'h' | 'rotate' | 'radius', label: string, prefix: React.ReactNode, unit: string, range: { min?: number; max?: number } = {}) => {
    const change = (apply: FieldApply) => edit((m) => ({ ...m, [key]: round(apply(m[key]), 2) }));
    return (
      <NumField
        label={label}
        prefix={prefix}
        value={mask === MIXED ? MIXED : now?.[key]}
        unit={unit}
        {...range}
        onPreview={(_, apply) => look.preview(change(apply))}
        onCommit={(_, apply) => look.commit(change(apply))}
        onRevert={() => look.revert()}
      />
    );
  };
  const fields = now ? MASK_FIELDS[now.shape] : null;
  const shapeValue = mask === MIXED ? MIXED : mask === null ? 'custom' : mask?.shape ?? 'none';
  const featherEdit = (apply: FieldApply) => edit((m) => ({ ...m, feather: Math.max(0, Math.min(100, round(apply(m.feather)))) }));

  return (
    <Section
      id="mask"
      title={t('inspector.mask')}
      aside={(
        <>
          {canEdit && now ? (
            <button
              type="button"
              aria-pressed={editing}
              onClick={() => setEditing((v) => !v)}
              className={`flex h-5 items-center gap-1 rounded-[4px] px-1.5 text-[10.5px] font-medium transition hover:bg-[var(--bg-hover)] ${editing ? 'bg-[var(--fill-tsp)] text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}
            >
              <SquareDashed size={11} />{t('inspector.maskEditOnPicture')}
            </button>
          ) : null}
          {mask ? (
            <SectionAction label={t('inspector.maskRemove')} onClick={() => pick('none')}><RotateCcw size={11} /></SectionAction>
          ) : null}
        </>
      )}
    >
      {mask === null ? (
        <p className="text-[10.5px] leading-[15px] text-[var(--text-faint)]">{t('inspector.maskCustom')}</p>
      ) : (
        <Segmented
          label={t('inspector.maskShape')}
          value={shapeValue}
          options={(['none', ...MASK_SHAPES] as const).map((s) => ({
            value: s,
            title: t(`inspector.maskShapes.${s}`),
            label: <MaskGlyph shape={s} />,
          }))}
          onChange={pick}
        />
      )}
      {now && fields ? (
        <>
          <Row>
            {num('x', t('inspector.maskX'), 'X', '%', { min: -500, max: 600 })}
            {num('y', t('inspector.maskY'), 'Y', '%', { min: -500, max: 600 })}
          </Row>
          {fields.size === 'box' ? (
            <Row>
              {num('w', t('inspector.maskW'), 'W', '%', { min: 0.5, max: 1000 })}
              {num('h', t('inspector.maskH'), 'H', '%', { min: 0.5, max: 1000 })}
            </Row>
          ) : null}
          <Row>
            {fields.size === 'band' ? num('h', t('inspector.maskBand'), <LineHeightGlyph />, '%', { min: 0.5, max: 1000 }) : null}
            {fields.rotate ? num('rotate', t('inspector.rotate'), <RotateGlyph />, '°') : null}
            {fields.radius ? num('radius', t('inspector.radius'), <RadiusGlyph />, '%', { min: 0, max: 500 }) : null}
            <button
              type="button"
              aria-pressed={now.invert}
              onClick={() => look.commit(edit((m) => ({ ...m, invert: !m.invert })))}
              className={`flex h-[26px] items-center justify-center gap-1 rounded-[5px] text-[11px] transition ${now.invert
                ? 'bg-[var(--bg)] text-[var(--text)] shadow-[0_0_0_0.5px_var(--border-strong)]'
                : 'bg-[var(--fill-tsp)] text-[var(--text-muted)] hover:text-[var(--text)]'}`}
            >
              {t('inspector.maskInvert')}
            </button>
            {[fields.size === 'band', fields.rotate, fields.radius].filter(Boolean).length % 2 === 0 ? <span /> : null}
          </Row>
          {fields.feather ? (
            <SliderField
              label={t('inspector.maskFeather')}
              value={mask === MIXED ? MIXED : now.feather}
              min={0}
              max={50}
              fieldMax={100}
              neutral={0}
              unit="%"
              onPreview={(_, apply) => look.preview(featherEdit(apply))}
              onCommit={(_, apply) => look.commit(featherEdit(apply))}
              onRevert={() => look.revert()}
            />
          ) : null}
        </>
      ) : null}
    </Section>
  );
}

/* ───────────────────────────── appearance ───────────────────────────── */

/** Opacity (`opacity`) and blending (`mix-blend-mode`), with names people use; `children` adds fills. */
export function AppearanceSection({ look, t, children }: { look: Look; t: T; children?: React.ReactNode }) {
  const opacity = look.common((read) => {
    const v = Number(read('opacity') ?? 1);
    return Number.isFinite(v) ? round(v * 100) : 100;
  });
  const blend = look.common((read) => read('mix-blend-mode') ?? 'normal');
  const opacityEdit = (apply: FieldApply): LookEdit => (read) => {
    const now = Number(read('opacity') ?? 1);
    const n = Math.max(0, Math.min(100, apply(Number.isFinite(now) ? now * 100 : 100)));
    return { opacity: n >= 100 ? null : String(Math.round(n * 10) / 1000) };
  };
  return (
    <Section id="appearance" title={t('inspector.appearance')}>
      <SliderField
        label={t('inspector.opacity')}
        value={opacity}
        min={0}
        max={100}
        neutral={100}
        unit="%"
        onPreview={(_, apply) => look.preview(opacityEdit(apply))}
        onCommit={(_, apply) => look.commit(opacityEdit(apply))}
        onRevert={() => look.revert()}
      />
      <SelectField
        label={t('inspector.blend')}
        prefix={t('inspector.blendShort')}
        value={blend}
        options={BLEND_MODES.map((b) => ({ value: b, label: t(`inspector.blendModes.${b}`) }))}
        onCommit={(v) => look.commit(() => ({ 'mix-blend-mode': v === 'normal' ? null : v }))}
      />
      {children}
    </Section>
  );
}

/* ───────────────────────────── adjust ───────────────────────────── */

const ADJUST_RANGE: Record<AdjustKey, { min: number; max: number; unit: string; fieldMax?: number }> = {
  brightness: { min: -100, max: 100, unit: '' },
  contrast: { min: -100, max: 100, unit: '' },
  saturate: { min: -100, max: 100, unit: '' },
  hue: { min: -180, max: 180, unit: '°' },
  blur: { min: 0, max: 40, unit: 'px', fieldMax: 1000 },
  grayscale: { min: 0, max: 100, unit: '%' },
};

/**
 * The picture's color and focus, each a CSS `filter` function (brightness, contrast, saturate, hue-rotate, blur,
 * grayscale): 0 is as is, a double-click puts one back, the reset all. Filter functions without a control here
 * (sepia, a url) are kept as written, in their place.
 */
export function AdjustSection({ look, t }: { look: Look; t: T }) {
  const readable = look.common((read) => filterParts(read('filter')) != null);
  const touched = look.common((read) => ADJUST_KEYS.some((k) => adjustOf(read('filter'))[k] !== 0));
  const edit = (key: AdjustKey, apply: FieldApply): LookEdit => (read) => {
    const now = adjustOf(read('filter'))[key];
    const r = ADJUST_RANGE[key];
    const n = Math.max(r.min, Math.min(r.fieldMax ?? r.max, round(apply(now ?? 0))));
    return { filter: withAdjust(read('filter'), key, n) };
  };
  if (readable === false) {
    return (
      <Section id="adjust" title={t('inspector.adjust')}>
        <p className="text-[10.5px] leading-[15px] text-[var(--text-faint)]">{t('inspector.adjustCustom')}</p>
      </Section>
    );
  }
  return (
    <Section
      id="adjust"
      title={t('inspector.adjust')}
      aside={touched === false ? null : (
        <SectionAction
          label={t('inspector.resetSection')}
          onClick={() => look.commit((read) => ({ filter: ADJUST_KEYS.reduce<string | null>((f, k) => withAdjust(f ?? undefined, k, 0), read('filter') ?? null) }))}
        >
          <RotateCcw size={11} />
        </SectionAction>
      )}
    >
      {ADJUST_KEYS.map((key) => {
        const r = ADJUST_RANGE[key];
        const v = look.common((read) => adjustOf(read('filter'))[key]);
        return (
          <SliderField
            key={key}
            label={t(`inspector.adjustKeys.${key}`)}
            value={v === null ? undefined : v}
            {...(v === null ? { placeholder: t('inspector.custom') } : {})}
            min={r.min}
            max={r.max}
            neutral={0}
            unit={r.unit}
            fieldMin={r.min}
            fieldMax={r.fieldMax ?? r.max}
            onPreview={(_, apply) => look.preview(edit(key, apply))}
            onCommit={(_, apply) => look.commit(edit(key, apply))}
            onRevert={() => look.revert()}
          />
        );
      })}
    </Section>
  );
}

/* ───────────────────────────── effects ───────────────────────────── */

type EffectId = 'shadow' | 'stroke' | 'fade';

/**
 * Effects a picture may have, each added with "+" and taken off with "−", none taking room unless used:
 * a drop shadow, a stroke, faded edges.
 *
 * The shadow is `filter: drop-shadow()`, not `box-shadow`: it follows what is drawn — the letters of a title on a
 * see-through page, a cut-out PNG, a layer of text — where a box shadow would draw the rectangle behind them, and it
 * is the same for a clip and a layer. (A `box-shadow` already written stays as it is, in the raw CSS.)
 * The stroke is `border`; faded edges are `mask-image` gradients, one an axis, intersected by `mask-composite`.
 */
export function EffectsSection({ look, t }: { look: Look; t: T }) {
  const shadow = look.common((read) => shadowOf(read('filter')));
  const stroke = look.common((read) => strokeOf(read('border')));
  /* faded edges share mask-image with the Mask section's shape (clip-mask): read and written beside it */
  const fadeRead = (read: LookRead) => fadeIn(read('mask-image'), read('mask-composite'));
  const fadeWrite = (read: LookRead, next: Fade | null): LookSet => withFade(read('mask-image'), read('mask-composite'), next) ?? {};
  const fade = look.common(fadeRead);
  const filterReadable = look.common((read) => filterParts(read('filter')) != null) !== false;
  const [adding, setAdding] = React.useState(false);
  const has = (v: unknown) => v !== undefined;
  const missing: { id: EffectId; label: string }[] = [
    ...(!has(shadow) && filterReadable ? [{ id: 'shadow' as const, label: t('inspector.shadow') }] : []),
    ...(!has(stroke) ? [{ id: 'stroke' as const, label: t('inspector.stroke') }] : []),
    ...(!has(fade) ? [{ id: 'fade' as const, label: t('inspector.fade') }] : []),
  ];
  const add = (id: EffectId) => {
    setAdding(false);
    if (id === 'shadow') look.commit((read) => ({ filter: withShadow(read('filter'), shadowOf(read('filter')) ?? SHADOW_DEFAULT) }));
    if (id === 'stroke') look.commit((read) => ({ border: strokeCss(strokeOf(read('border')) ?? STROKE_DEFAULT) }));
    if (id === 'fade') look.commit((read) => fadeWrite(read, fadeRead(read) ?? FADE_DEFAULT));
  };
  const remove = (id: EffectId) => {
    if (id === 'shadow') look.commit((read) => ({ filter: withShadow(read('filter'), null) }));
    if (id === 'stroke') look.commit(() => ({ border: null }));
    if (id === 'fade') look.commit((read) => fadeWrite(read, null));
  };
  const removeBtn = (id: EffectId) => (
    <SectionAction label={t('inspector.effectRemove')} onClick={() => remove(id)}><Minus size={12} /></SectionAction>
  );

  /* shadow: each thing's own, or the default for one without */
  const shadowField = (key: 'x' | 'y' | 'blur') => {
    const edit = (apply: FieldApply): LookEdit => (read) => {
      const now: Shadow = shadowOf(read('filter')) ?? SHADOW_DEFAULT;
      const n = round(apply(now[key]));
      return { filter: withShadow(read('filter'), { ...now, [key]: key === 'blur' ? Math.max(0, n) : n }) };
    };
    return (
      <NumField
        label={t(`inspector.shadow${key === 'x' ? 'X' : key === 'y' ? 'Y' : 'Blur'}`)}
        prefix={key === 'x' ? 'X' : key === 'y' ? 'Y' : 'B'}
        value={look.common((read) => shadowOf(read('filter'))?.[key])}
        unit="px"
        {...(key === 'blur' ? { min: 0 } : {})}
        onPreview={(_, apply) => look.preview(edit(apply))}
        onCommit={(_, apply) => look.commit(edit(apply))}
        onRevert={() => look.revert()}
      />
    );
  };
  const shadowColor = (color: string): LookEdit => (read) => ({ filter: withShadow(read('filter'), { ...(shadowOf(read('filter')) ?? SHADOW_DEFAULT), color }) });
  const strokeEdit = (part: Partial<Stroke>): LookEdit => (read) => ({ border: strokeCss({ ...(strokeOf(read('border')) ?? STROKE_DEFAULT), ...part }) });
  const strokeWidth = (apply: FieldApply): LookEdit => (read) => {
    const now = strokeOf(read('border')) ?? STROKE_DEFAULT;
    return { border: strokeCss({ ...now, width: Math.max(0, round(apply(now.width))) }) };
  };
  const fadeOn = (side: FadeSide) => look.common((read) => fadeRead(read)?.sides[side] ?? false);
  const fadeSize = look.common((read) => fadeRead(read)?.size ?? null);
  const fadeToggle = (side: FadeSide) => {
    const on = fadeOn(side) === true;
    look.commit((read) => {
      const now: Fade = fadeRead(read) ?? { ...FADE_DEFAULT, sides: { top: false, right: false, bottom: false, left: false } };
      const sides = { ...now.sides, [side]: !on };
      return fadeWrite(read, Object.values(sides).some(Boolean) ? { ...now, sides } : null);
    });
  };
  const fadeSizeEdit = (apply: FieldApply): LookEdit => (read): LookSet => {
    const now = fadeRead(read);
    return now ? fadeWrite(read, { ...now, size: Math.max(0.5, Math.min(50, round(apply(now.size)))) }) : {};
  };
  const custom = (label: string) => (
    <SubLabel>{label} · <span className="text-[var(--text-faint)]">{t('inspector.effectCustom')}</span></SubLabel>
  );

  return (
    <Section
      id="effects"
      title={t('inspector.effects')}
      aside={missing.length ? (
        <Popover
          open={adding}
          onOpenChange={setAdding}
          align="end"
          trigger={(
            <button type="button" aria-label={t('inspector.effectAdd')} className="flex h-5 w-5 items-center justify-center rounded-[5px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
              <Plus size={12} />
            </button>
          )}
        >
          <div className="min-w-[140px] rounded-[7px] border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-lg)]">
            {missing.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => add(m.id)}
                className="flex w-full items-center rounded-[5px] px-2 py-1.5 text-left text-[11.5px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]"
              >
                {m.label}
              </button>
            ))}
          </div>
        </Popover>
      ) : null}
    >
      {!has(shadow) && !has(stroke) && !has(fade) ? (
        <p className="text-[10.5px] leading-[15px] text-[var(--text-faint)]">{t('inspector.effectsNone')}</p>
      ) : null}
      {shadow === null ? custom(t('inspector.shadow')) : has(shadow) ? (
        <>
          <SubLabel aside={removeBtn('shadow')}>{t('inspector.shadow')}</SubLabel>
          <Row cols={3}>{shadowField('x')}{shadowField('y')}{shadowField('blur')}</Row>
          <ColorField
            label={t('inspector.shadowColor')}
            value={look.common((read) => shadowOf(read('filter'))?.color ?? '')}
            onPreview={(c) => look.preview(shadowColor(c))}
            onCommit={(c) => look.commit(shadowColor(c))}
          />
        </>
      ) : null}
      {stroke === null ? custom(t('inspector.stroke')) : has(stroke) ? (
        <>
          <SubLabel aside={removeBtn('stroke')}>{t('inspector.stroke')}</SubLabel>
          <Row>
            <NumField
              label={t('inspector.strokeWidth')}
              prefix={<span className="block h-[7px] w-[9px] rounded-[1.5px] border-[1.5px]" style={{ borderColor: 'currentColor' }} />}
              value={look.common((read) => strokeOf(read('border'))?.width)}
              unit="px"
              min={0}
              max={1000}
              onPreview={(_, apply) => look.preview(strokeWidth(apply))}
              onCommit={(_, apply) => look.commit(strokeWidth(apply))}
              onRevert={() => look.revert()}
            />
            <Segmented
              label={t('inspector.strokeStyle')}
              value={look.common((read) => strokeOf(read('border'))?.style ?? '')}
              small
              options={(['solid', 'dashed', 'dotted'] as const).map((s) => ({
                value: s,
                title: t(`inspector.strokeStyles.${s}`),
                label: <span className="block w-4 border-t-[1.5px]" style={{ borderTopStyle: s, borderTopColor: 'currentColor' }} />,
              }))}
              onChange={(s) => look.commit(strokeEdit({ style: s as Stroke['style'] }))}
            />
          </Row>
          <ColorField
            label={t('inspector.strokeColor')}
            value={look.common((read) => strokeOf(read('border'))?.color ?? '')}
            onPreview={(c) => look.preview(strokeEdit({ color: c }))}
            onCommit={(c) => look.commit(strokeEdit({ color: c }))}
          />
        </>
      ) : null}
      {fade === null ? custom(t('inspector.fade')) : has(fade) ? (
        <>
          <SubLabel aside={removeBtn('fade')}>{t('inspector.fade')}</SubLabel>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1.5">
            <div role="group" aria-label={t('inspector.fadeSides')} className="flex h-[26px] items-center gap-0.5 rounded-[5px] bg-[var(--fill-tsp)] p-px">
              {(['top', 'right', 'bottom', 'left'] as const).map((side) => {
                const on = fadeOn(side) === true;
                return (
                  <button
                    key={side}
                    type="button"
                    aria-pressed={on}
                    aria-label={t(`inspector.fadeSide.${side}`)}
                    title={t(`inspector.fadeSide.${side}`)}
                    onClick={() => fadeToggle(side)}
                    className={`flex h-6 flex-1 items-center justify-center rounded-[4px] transition ${on
                      ? 'bg-[var(--bg)] text-[var(--text)] shadow-[0_0_0_0.5px_var(--border-strong)]'
                      : 'text-[var(--text-faint)] hover:text-[var(--text)]'}`}
                  >
                    <EdgeGlyph side={side} />
                  </button>
                );
              })}
            </div>
            <NumField
              label={t('inspector.fadeSize')}
              prefix={<LineHeightGlyph />}
              value={fadeSize === MIXED ? MIXED : fadeSize ?? undefined}
              unit="%"
              min={0.5}
              max={50}
              onPreview={(_, apply) => look.preview(fadeSizeEdit(apply))}
              onCommit={(_, apply) => look.commit(fadeSizeEdit(apply))}
              onRevert={() => look.revert()}
            />
          </div>
        </>
      ) : null}
    </Section>
  );
}

/* ───────────────────────────── typography ───────────────────────────── */

/** What a type property is when nothing sets it (what giving up a preview paints back when the layer had none). */
const TYPE_NEUTRAL: Record<string, string> = { 'font-weight': '400', 'font-style': 'normal', 'line-height': 'normal', 'letter-spacing': 'normal' };

/** A family's weight menu: its own weights and italics by name, as Figma's ("Semi Bold", "Bold Italic"). */
function weightOptions(styles: FontStyles | null, t: T): { value: string; label: string }[] {
  const list = styleOptions(styles ?? { weights: NAMED_WEIGHTS });
  return list.map((s) => {
    const key = weightKey(s.weight);
    /* a weight between the named ones (Hiragino's W2 is 250) says its number, or two would read the same */
    const name = `${t(`inspector.weights.w${key}`)}${key === s.weight ? '' : ` ${s.weight}`}`;
    return { value: styleValue(s), label: s.italic ? t('inspector.weightItalic').replace('{name}', name) : name };
  });
}

/**
 * Type, as Figma's typography panel: font (its menu shows each family on the picture as it is pointed at), weight
 * (the family's own), size (with a menu of common sizes), line height, letter spacing, alignment, case
 * (`text-transform`) and color. Text in an SVG has no line layout and is colored by its fill.
 */
export function TypographySection({ look, t, svg, sample }: { look: Look; t: T; svg?: boolean; sample: string }) {
  const installed = useInstalledFonts();
  const { fonts: project, page, ready } = useProjectFonts();
  const family = look.common((read) => splitFontFamily(read('font-family') ?? '')[0]);
  const style = look.common((read) => ({ weight: weightNumber(read('font-weight')) ?? 400, italic: isItalic(read('font-style')) }));
  const size = look.common((read) => pxOf(read('font-size')));
  const lineHeight = look.common((read) => metricOf('line-height', read('line-height')));
  const spacing = look.common((read) => metricOf('letter-spacing', read('letter-spacing')));
  const align = look.common((read) => read('text-align') ?? '');
  const textCase = look.common((read) => read('text-transform') ?? 'none');
  const colorProp = svg ? 'fill' : 'color';
  const color = look.common((read) => read(colorProp) ?? '');
  const styles = family === MIXED || !family ? null : stylesOf(family, installed ?? [], project);
  /* not drawn as named: not installed, not declared for the page — once the lists came, and the browser agrees */
  const missing = React.useMemo(() => {
    if (family === MIXED || !family || installed == null || !ready) return false;
    const known = knownAvailable(family, installed, project, page);
    return known == null ? !familyRenders(family) : !known;
  }, [family, installed, project, page, ready]);
  /*
   * What the type was before a preview showed something else on the picture: the stage measures the layer again after
   * each preview, so its values are the preview's by then. Families tried are worked out from it, and giving up paints
   * it back.
   */
  const before = React.useRef<Record<string, string> | null>(null);
  const remember = (props: readonly string[]) => {
    const now = look.common((read) => Object.fromEntries(props.map((p) => [p, read(p) ?? TYPE_NEUTRAL[p] ?? ''])));
    if (now !== MIXED) before.current = { ...now, ...before.current };
  };
  const restore = () => {
    const was = before.current;
    before.current = null;
    if (was) { look.preview(() => was); previewSettled(); } else look.revert();
  };
  /**
   * A new family, the fallbacks kept; a weight or an italic it does not have snapped to what it has. Shown only
   * (`preview`): the weight and slant of before are shown again too, after a family that snapped them.
   */
  const familyEdit = (next: string, preview: boolean, was = before.current): LookEdit => (current) => {
    const read: LookRead = was ? (p) => was[p] ?? current(p) : current;
    const set: LookSet = { 'font-family': joinFontFamily(next, splitFontFamily(read('font-family') ?? '')[1]) };
    const has = stylesOf(next, installed ?? [], project);
    const now = { weight: weightNumber(read('font-weight')) ?? 400, italic: isItalic(read('font-style')) };
    const snapped = has ? snapStyle(has, now) : now;
    if (snapped.weight !== now.weight) set['font-weight'] = String(snapped.weight);
    else if (was && preview) set['font-weight'] = read('font-weight') ?? '400';
    if (now.italic && !snapped.italic) set['font-style'] = 'normal';
    else if (was && preview) set['font-style'] = read('font-style') ?? 'normal';
    return set;
  };
  const num = (prop: string, now: (read: LookRead) => number | undefined, out: (n: number) => string, lo: number, hi: number) => (apply: FieldApply): LookEdit => (read) => {
    const n = Math.max(lo, Math.min(hi, round(apply(now(read) ?? 0), 2)));
    return { [prop]: out(n) };
  };
  const sizeEdit = num('font-size', (r) => pxOf(r('font-size')), (n) => `${n}px`, 1, 5000);
  const bind = (edit: (apply: FieldApply) => LookEdit) => ({
    onPreview: (_: number, apply: FieldApply) => look.preview(edit(apply)),
    onCommit: (_: number, apply: FieldApply) => look.commit(edit(apply)),
    onRevert: () => look.revert(),
  });
  const metric = (prop: string) => ({
    onPreview: (css: string) => { remember([prop]); look.preview(() => ({ [prop]: css })); },
    onCommit: (css: string) => { before.current = null; look.commit(() => ({ [prop]: css })); },
    onRevert: restore,
  });
  const CASES = [
    { value: 'none', label: '—', title: t('inspector.caseNone') },
    { value: 'uppercase', label: 'AG', title: t('inspector.caseUpper') },
    { value: 'lowercase', label: 'ag', title: t('inspector.caseLower') },
    { value: 'capitalize', label: 'Ag', title: t('inspector.caseTitle') },
  ];
  return (
    <Section id="typography" title={t('inspector.typography')}>
      <FontFamilyPicker
        label={t('inspector.fontFamily')}
        value={family === MIXED ? '' : family}
        sample={sample}
        missing={missing}
        onPreview={(next) => {
          remember(['font-family', 'font-weight', 'font-style']);
          look.preview(familyEdit(next, true));
        }}
        onRevert={restore}
        onCommit={(next) => {
          const edit = familyEdit(next, false);
          before.current = null;
          look.commit(edit);
        }}
        className="group/field relative flex h-[26px] min-w-0 w-full items-center overflow-hidden rounded-[5px] bg-[var(--fill-tsp)] ring-1 ring-inset ring-transparent transition-[box-shadow,background-color] hover:ring-[var(--border)] focus-within:bg-[var(--bg)] focus-within:ring-[1.5px] focus-within:ring-[var(--accent)]"
      />
      <Row>
        <SelectField
          label={t('inspector.fontWeight')}
          value={style === MIXED ? MIXED : styleValue(style)}
          options={weightOptions(styles, t)}
          onCommit={(v) => {
            const next = parseStyleValue(v);
            if (next) look.commit((read) => ({ 'font-weight': String(next.weight), 'font-style': next.italic ? 'italic' : isItalic(read('font-style')) ? 'normal' : null }));
          }}
        />
        <NumField
          label={t('inspector.fontSize')}
          prefix={<FontSizeGlyph />}
          value={size}
          unit="px"
          min={1}
          max={5000}
          {...bind(sizeEdit)}
          trailing={<FontSizeMenu t={t} onPick={(n) => look.commit(() => ({ 'font-size': `${n}px` }))} />}
        />
      </Row>
      <Row>
        {svg ? null : (
          <MetricField label={t('inspector.lineHeight')} prefix={<LineHeightGlyph />} kind="line-height" value={lineHeight} placeholder={t('inspector.auto')} {...metric('line-height')} />
        )}
        <MetricField label={t('inspector.letterSpacing')} prefix={<LetterSpacingGlyph />} kind="letter-spacing" value={spacing} placeholder="0" {...metric('letter-spacing')} />
        {svg ? <span /> : null}
      </Row>
      {svg ? null : (
        <Row>
          <Segmented
            label={t('inspector.textAlign')}
            value={align}
            options={[
              { value: 'left', title: t('inspector.alignTextLeft'), label: <AlignLeft size={ICON} /> },
              { value: 'center', title: t('inspector.alignTextCenter'), label: <AlignCenter size={ICON} /> },
              { value: 'right', title: t('inspector.alignTextRight'), label: <AlignRight size={ICON} /> },
              { value: 'justify', title: t('inspector.alignTextJustify'), label: <AlignJustify size={ICON} /> },
            ]}
            onChange={(v) => look.commit(() => ({ 'text-align': v }))}
          />
          <Segmented
            label={t('inspector.textCase')}
            value={textCase}
            small
            options={CASES}
            onChange={(v) => look.commit(() => ({ 'text-transform': v === 'none' ? null : v }))}
          />
        </Row>
      )}
      <ColorField
        label={svg ? t('inspector.fill') : t('inspector.color')}
        value={color}
        onPreview={(c) => look.preview(() => ({ [colorProp]: c }))}
        onCommit={(c) => look.commit(() => ({ [colorProp]: c }))}
      />
    </Section>
  );
}

/** The font size field's menu: the common sizes, as Figma's. */
function FontSizeMenu({ t, onPick }: { t: T; onPick: (n: number) => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="auto"
      align="end"
      trigger={(
        <button
          type="button"
          aria-label={t('inspector.fontSizes')}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex h-[26px] w-[18px] shrink-0 items-center justify-center text-[var(--text-faint)] hover:text-[var(--text)]"
        >
          <ChevronDown size={11} aria-hidden />
        </button>
      )}
    >
      <div
        data-film-inspector=""
        role="listbox"
        aria-label={t('inspector.fontSizes')}
        className="w-[72px] overflow-y-auto rounded-[8px] border border-[var(--border)] bg-[var(--panel)] py-1 shadow-[var(--shadow-lg)]"
        style={{ maxHeight: 'min(320px, var(--popover-max-h, 320px))' }}
      >
        {FONT_SIZES.map((n) => (
          <button
            key={n}
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => { setOpen(false); onPick(n); }}
            className="block w-full px-3 py-[3px] text-left text-[11.5px] tabular-nums text-[var(--text)] hover:bg-[var(--bg-hover)]"
          >
            {n}
          </button>
        ))}
      </div>
    </Popover>
  );
}

/* ───────────────────────────── advanced ───────────────────────────── */

/** The declarations of `css` none of the controls says (as `prop: value` lines). */
export function rawDeclarations(css: string): string {
  const all = declarations(css);
  const get = (p: string) => all.find(([k]) => k === p)?.[1];
  return all.filter(([k, v]) => !ownedDeclaration(k, v, get) && !maskOwned(k, v, get)).map(([k, v]) => `${k}: ${v}`).join(';\n');
}

/** What was typed into the raw CSS, as properties to write: those shown before and not typed again go. */
export function rawEdit(before: string, typed: string): LookSet {
  const set: LookSet = {};
  for (const [k] of declarations(before)) set[k] = null;
  for (const [k, v] of declarations(typed.replace(/\n/g, ';'))) if (k) set[k] = v;
  return set;
}

/**
 * The raw CSS, folded away: what the controls above do not say, as written, one property a line (⌘↵ or leaving
 * keeps it, Esc gives up). A clip's `class` is here too.
 */
export function AdvancedSection({
  t, css, onCommit, cls, onClear,
}: {
  t: T;
  /** The declarations to show (rawDeclarations). */
  css: string;
  onCommit: (set: LookSet) => void;
  /** The element's `class` (a clip's), and how to write it. */
  cls?: { value: string; onCommit: (next: string | null) => void };
  /** Takes every change of the person's away (a layer's overrides). */
  onClear?: () => void;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const [clsDraft, setClsDraft] = React.useState<string | null>(null);
  const dropDraft = React.useRef(false);
  return (
    <Section
      id="advanced"
      title={t('inspector.advanced')}
      closedByDefault
      aside={onClear ? (
        <SectionAction label={t('inspector.clearOverride')} onClick={onClear}><RotateCcw size={11} /></SectionAction>
      ) : null}
    >
      {cls ? (
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] text-[var(--text-muted)]">{t('inspector.classes')}</span>
          <input
            type="text"
            spellCheck={false}
            value={clsDraft ?? cls.value}
            placeholder={t('inspector.classesEmpty')}
            onChange={(e) => setClsDraft(e.target.value)}
            onBlur={() => {
              const next = clsDraft?.trim().split(/\s+/).filter(Boolean).join(' ');
              if (!dropDraft.current && next != null && next !== cls.value) cls.onCommit(next || null);
              dropDraft.current = false;
              setClsDraft(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
              if (e.key === 'Escape') { e.preventDefault(); dropDraft.current = true; e.currentTarget.blur(); }
            }}
            className="h-[26px] w-full rounded-[5px] bg-[var(--fill-tsp)] px-2 font-mono text-[10.5px] text-[var(--text)] outline-none ring-1 ring-inset ring-transparent placeholder:text-[var(--text-faint)] hover:ring-[var(--border)] focus:bg-[var(--bg)] focus:ring-[1.5px] focus:ring-[var(--accent)]"
          />
        </label>
      ) : null}
      <span className="text-[10.5px] text-[var(--text-muted)]">{t('inspector.clipCss')}</span>
      <textarea
        aria-label={t('inspector.clipCss')}
        spellCheck={false}
        placeholder={t('inspector.clipCssEmpty')}
        value={draft ?? css}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (!dropDraft.current && draft != null && draft.trim() !== css.trim()) onCommit(rawEdit(css, draft));
          dropDraft.current = false;
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.blur(); }
          if (e.key === 'Escape') { e.preventDefault(); dropDraft.current = true; e.currentTarget.blur(); }
        }}
        rows={Math.min(8, Math.max(2, (draft ?? css).split('\n').length))}
        className="block w-full resize-y rounded-[5px] bg-[var(--fill-tsp)] px-2 py-1.5 font-mono text-[10.5px] leading-[1.5] text-[var(--text)] outline-none ring-1 ring-inset ring-transparent placeholder:text-[var(--text-faint)] hover:ring-[var(--border)] focus:bg-[var(--bg)] focus:ring-[1.5px] focus:ring-[var(--accent)]"
      />
    </Section>
  );
}
