/**
 * A picture clip's own transform, under its keyframes (components/KeyframesSection): where its box's top left is, its
 * scale of its own size, its turn and its opacity, and the edits that write a change of them with its keyframes. The
 * inspector's Transform and the motion timeline's rows read and write a clip through these alike.
 */
import type { Motion } from '../../../../src/clip-motion.mjs';
import { declared, withDeclarations } from '@/lib/clip-look';
import type { ClipEdit } from '@/lib/film-clip-edits';
import { clipFieldPart, clipFields, compactBox, transformOf } from '@/lib/stage-clip';
import type { MgBox, MgTransform } from '@/lib/stage-types';
import type { FilmBox } from '@/lib/film';

/** The clip's own transform under its keyframes: its box's top left, its scale of its own size, its turn, its opacity. */
export interface StaticTransform { x: number; y: number; scale: number; rotate: number; opacity: number }

/** What a clip is placed by: its kind, its picture's own size (`own`), its box, the stage, its style. */
export interface PlacedClip { kind: 'mg' | 'video' | string; own: MgBox; box?: FilmBox | null; stage: { w: number; h: number }; css: string }

/** The transform the clip's box makes (stage-clip), and its own transform as the Transform's numbers start from. */
export function staticTransform(c: PlacedClip, measured?: MgBox | null): { tf: MgTransform; box: MgBox; base: StaticTransform } {
  const box = measured ?? c.own;
  const tf = transformOf(c.kind === 'mg' ? 'page' : 'video', c.own, c.stage, c.box ?? undefined);
  const at = clipFields(tf, box);
  const opacity = Number.parseFloat(declared(c.css, 'opacity') ?? '1');
  return { tf, box, base: { x: at.x, y: at.y, scale: tf.scaleX, rotate: tf.rotate, opacity: Number.isFinite(opacity) ? opacity : 1 } };
}

/**
 * The edits that write the clip's keyframes `motion` and, when given, a change of its own transform (`own`): its
 * opacity first (the keyframes written after it read the style it leaves), its box, then its keyframes.
 */
export function transformEdits(loc: string, c: PlacedClip, motion: Motion, own?: Partial<StaticTransform>, measured?: MgBox | null): ClipEdit[] {
  const { tf, box } = staticTransform(c, measured);
  const edits: ClipEdit[] = [];
  if (own?.opacity != null) edits.push({ loc, prop: 'style', value: withDeclarations(c.css, { opacity: own.opacity >= 1 ? null : String(own.opacity) }) || null });
  if (own && (own.x != null || own.y != null || own.scale != null || own.rotate != null)) {
    const part: Partial<MgTransform> = {
      ...(own.x != null ? clipFieldPart('x', own.x, box) : {}),
      ...(own.y != null ? clipFieldPart('y', own.y, box) : {}),
      ...(own.scale != null ? { scaleX: own.scale, scaleY: own.scale * (tf.scaleY / (tf.scaleX || 1)) } : {}),
      ...(own.rotate != null ? { rotate: own.rotate } : {}),
    };
    edits.push({ loc, prop: 'box', value: compactBox({ ...tf, ...part }, c.own) });
  }
  edits.push({ loc, prop: 'motion', value: Object.keys(motion).length ? (motion as unknown as Record<string, unknown>) : null });
  return edits;
}
