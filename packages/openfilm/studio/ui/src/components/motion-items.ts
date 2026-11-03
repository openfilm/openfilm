/**
 * What can be put on a layer of the motion timeline, from the Effects & Presets panel (clicked, or dragged onto a
 * layer) or a layer's menu alike: an animation preset (lib/motion-presets), an effect, a mask's shape, a text
 * animator's preset, 3D, a stroke drawn on. Each says whether the layer can take it, and puts it there.
 */
import { EFFECT_PROPS, EFFECTS, type EffectProp } from '../../../../src/clip-motion.mjs';
import { MASK_SHAPES, type MaskShape } from '@/lib/clip-mask';
import { ANIM_GROUPS, presetMotion, type AnimPreset } from '@/lib/motion-presets';
import { TEXT_PRESETS, textAnimDefault, type TextPreset } from '@/lib/text-animator';
import type { LayerHost } from './MotionLayers';

export type MotionItem =
  | { kind: 'anim'; id: AnimPreset }
  | { kind: 'fx'; id: EffectProp }
  | { kind: 'mask'; id: MaskShape }
  | { kind: 'text'; id: TextPreset }
  | { kind: 'three' }
  | { kind: 'stroke' };

/** The effects a picture can be given (a filter each): the rest are a shape's stroke and 3D, items of their own. */
export const FILTER_EFFECTS = EFFECT_PROPS.filter((fx) => EFFECTS[fx].filter);
/** An effect put on as it shows at once (at its resting value it would not), to be turned down from there. */
const FX_START: Partial<Record<EffectProp, number>> = { blur: 8, brightness: 130, contrast: 130, saturate: 160, hue: 90, grayscale: 100, invert: 100, glow: 12 };

/** Every item, by the panel's sections. */
export const ITEM_SECTIONS: readonly { id: string; items: readonly MotionItem[] }[] = [
  ...ANIM_GROUPS.map((g) => ({ id: `anim-${g.id}`, items: g.presets.map((id) => ({ kind: 'anim' as const, id })) })),
  { id: 'fx', items: FILTER_EFFECTS.map((id) => ({ kind: 'fx' as const, id })) },
  { id: 'mask', items: MASK_SHAPES.map((id) => ({ kind: 'mask' as const, id })) },
  { id: 'text', items: TEXT_PRESETS.map((id) => ({ kind: 'text' as const, id })) },
  { id: 'layer', items: [{ kind: 'three' }, { kind: 'stroke' }] },
];

export const itemKey = (item: MotionItem) => ('id' in item ? `${item.kind}:${item.id}` : item.kind);
export function itemOfKey(key: string): MotionItem | null {
  for (const s of ITEM_SECTIONS) for (const item of s.items) if (itemKey(item) === key) return item;
  return null;
}
/** Its name (an i18n key). */
export function itemLabel(item: MotionItem): string {
  switch (item.kind) {
    case 'anim': return `canvas.anim.${item.id}`;
    case 'fx': return `canvas.fx.${item.id}`;
    case 'mask': return `inspector.maskShapes.${item.id}`;
    case 'text': return `canvas.textPresets.${item.id}`;
    case 'three': return 'canvas.threeD';
    case 'stroke': return 'canvas.fx.trim';
  }
}

/** Whether the layer can take it (and does not have it already, for what it has once). */
export function itemApplies(host: LayerHost | null, item: MotionItem): boolean {
  if (!host) return false;
  switch (item.kind) {
    case 'anim': return Boolean(host.model?.preset);
    case 'fx': return Boolean(host.effects) && !host.effects!.on.includes(item.id);
    case 'mask': return Boolean(host.mask);
    case 'text': return host.text != null && host.text.anim !== null;
    case 'three': return Boolean(host.three) && !host.three!.on;
    case 'stroke': return Boolean(host.stroke) && !host.stroke!.on;
  }
}

/** The item put on the layer. */
export function applyItem(host: LayerHost, item: MotionItem): void {
  switch (item.kind) {
    case 'anim': {
      const p = host.model?.preset;
      if (p) host.commit({ motion: presetMotion(item.id, p.motion, p.rest, p.span, p.stage) });
      return;
    }
    case 'fx': {
      const c = host.effects?.add(item.id);
      if (c?.fx) host.commitEffects({ ...c, fx: { ...c.fx, values: { ...c.fx.values, [item.id]: FX_START[item.id] ?? EFFECTS[item.id].rest } } });
      return;
    }
    case 'mask': host.mask?.setShape(item.id); return;
    case 'text': host.text?.set(textAnimDefault(item.id, host.text.anim)); return;
    case 'three': host.three?.toggle(true); return;
    case 'stroke': host.stroke?.turnOn(); return;
  }
}

/** Dragged from the panel onto a layer: the data's type. */
export const ITEM_DRAG = 'application/x-openfilm-motion-item';
