/**
 * The film as an animation editor lays out a composition, in its timeline panel's arrangement: the current time big
 * at the top left; a row per picture clip (a layer), the topmost first, with its label color, its number, its name and
 * its blending mode; its bar on the right, dragged to move it in time and by its ends
 * to trim it. A layer twirls open (▸) to its Transform: position, scale, rotation and opacity, each with the keyframe
 * navigator in the switches' column, a stopwatch, its value in blue (dragged left and right, or clicked and typed),
 * and its keyframes on its row (components/MotionLanes), or the graph. Under it, only the groups the layer has: its
 * Effects, its Shape (a stroke drawn on), its Text animator, its Mask, each twirled open and shut on its own. What a
 * layer does not have yet is put on it from its menu (a right click, or its + ), or dragged onto it from the Effects &
 * Presets panel (components/motion-items).
 *
 * As there: P, S, R and T show only that property of the picked layers (⇧: added to what shows), U the ones that
 * move, the same key again closes them; J and K go to the keyframe before and after the playhead among what shows.
 * The work area (the film's marked range) is the bar over the ruler; the slider under the layers zooms the time.
 */
import * as React from 'react';
import { Box, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, Lock, LockOpen, Plus, X } from 'lucide-react';
import { EFFECTS, MOTION_PROPS, valueAt, type EffectProp, type Key, type KeyedProp, type Motion, type MotionProp } from '../../../../src/clip-motion.mjs';
import type { effectsModel, EffectsChange } from '@/lib/motion-keys';
import { easeOfBezier, easedMotion, keyId, movedKeys, withoutKeys, type EaseCommand } from '@/lib/motion-keys';
import { MASK_FIELDS, MASK_SHAPES, type MaskShape } from '@/lib/clip-mask';
import type { MaskChange, MaskKeys, MaskParam, maskModel } from '@/lib/mask-motion';
import { TEXT_PRESETS, textAnimDefault, type TextAnim, type TextPreset } from '@/lib/text-animator';
import { BLEND_MODES } from '@/lib/clip-look';
import { ANIM_GROUPS, type Rest } from '@/lib/motion-presets';
import { keyAction } from '@/lib/keymap-store';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { FILTER_EFFECTS, ITEM_DRAG, applyItem, itemApplies, itemOfKey, type MotionItem } from './motion-items';
import { Stopwatch } from './KeyframesSection';
import { LANE_H, LANE_PAD, MotionLaneHeads, MotionLaneRows, lanesHeight, type MotionLanes } from './MotionLanes';
import { MenuSelect } from './MenuSelect';
import { isTextField } from './typing-target';

/**
 * A layer: a clip of the film, or an element of a page (a composition opened); `clipId` names it (an element's is
 * where it is). `depth` and `parent`: where it is nested, an element in another.
 */
export interface Layer { clipId: string; title?: string; kind: string; startMs: number; endMs: number; depth?: number; parent?: string; kids?: number; kidsOpen?: boolean }

/** A layer's Transform as numbers (KeyframesSection transformModel, lib/element-motion elementModel). */
export interface TransformNumbers {
  on: boolean;
  now: (prop: MotionProp) => number | [number, number];
  set: (prop: MotionProp, n: number | [number, number]) => unknown;
  stopwatch: (prop: MotionProp) => unknown;
  toggleHere: (prop: MotionProp) => unknown;
  /**
   * What an animation preset is keyed from (lib/motion-presets): the keyframes, the transform at rest in their terms,
   * where the layer shows in their seconds, its picture's size. `commit({ motion })` writes what it makes.
   */
  preset?: { motion: Motion; rest: Rest; span: [number, number]; stage: { w: number; h: number } };
}

/** What a layer is and does beyond its keyframes: its Transform's numbers, how it blends, whether it shows. */
export interface LayerHost {
  model: TransformNumbers | null;
  /** A change the model worked out, written (null: nothing). */
  commit: (c: unknown) => void;
  blend: string;
  setBlend: (mode: string) => void;
  /** Whether it shows (a clip's: its track's, an element's: its own). */
  visible?: boolean;
  setVisible?: (on: boolean) => void;
  /** Locked: kept from being moved or changed (a clip's track). */
  locked?: boolean;
  setLocked?: (on: boolean) => void;
  /** Its effects (lib/motion-keys effectsModel), and a change of them written. */
  effects: ReturnType<typeof effectsModel> | null;
  commitEffects: (c: EffectsChange | null) => void;
  /** Its mask (a clip's; none where it cannot have one here). */
  mask?: LayerMask | null;
  /** Its words animated part by part (a text element's; null: one Studio did not write, shown as such). */
  text?: { anim: TextAnim | null | undefined; set: (anim: TextAnim | null) => void };
  /** In 3D (a clip's): on or not, its depth and X and Y turns (an effect's numbers), switched. */
  three?: { on: boolean; model: ReturnType<typeof effectsModel>; commit: (c: EffectsChange | null) => void; toggle: (on: boolean) => void };
  /** Its anchor point (a clip's): where it turns and scales about, from its box's middle (an effect's numbers). */
  anchor?: { model: ReturnType<typeof effectsModel>; commit: (c: EffectsChange | null) => void };
  /** Its stroke drawn on (a shape's): on or not, how much is drawn (an effect's numbers, `trim`), turned on. */
  stroke?: { on: boolean; model: ReturnType<typeof effectsModel>; commit: (c: EffectsChange | null) => void; turnOn: () => void };
  /** What its page is made of, as numbers (a page layer's): each keyed as a Transform's property (lib/page-motion). */
  contents?: LayerContents | null;
}

/**
 * A page layer's Contents: its properties that are numbers (a shape's stroke width, a repeater's copies), each with
 * its value when it has no keyframes (`still`: null, the page's own not known yet) and its keyframes, at seconds of
 * the clip; `commit` writes them all (a still value null: the page's own again, left out: as it was).
 */
export interface LayerContents {
  params: { var: string; label: string; unit: string; still: number | null }[];
  keys: Readonly<Record<string, readonly Key[]>>;
  commit: (keys: Record<string, Key[]>, still?: Record<string, number | null>) => void;
}

/** A layer's mask in the Masks group: its shape (none: no mask), its keyframes (lib/mask-motion), what changes it. */
export interface LayerMask {
  shape: MaskShape | null;
  invert: boolean;
  model: ReturnType<typeof maskModel> | null;
  keys: MaskKeys;
  setShape: (shape: MaskShape | null) => void;
  setInvert: (on: boolean) => void;
  commit: (c: MaskChange | null) => void;
}

export interface MotionLayersArgs {
  /** The layers (picture clips, or a page's elements), the topmost first. */
  layers: readonly Layer[];
  playheadMs: number;
  fps: number;
  onSeek: (ms: number) => void;
  picked: readonly string[];
  onPick: (clipId: string, add: boolean) => void;
  lanesOf: (layer: Layer) => MotionLanes;
  hostOf: (layer: Layer) => LayerHost;
  /** A layer double-clicked: its composition opened (a page's elements); none where it has none. */
  onOpen?: (layer: Layer) => void;
  /** A layer with others in it (`kids`, an element holding elements) twirled open or shut to them. */
  onKids?: (layer: Layer) => void;
  /** Layers to show twirled open (what was just put on them from the Effects & Presets panel), by a count that changes. */
  reveal?: { ids: readonly string[]; n: number } | null;
  t: (key: string) => string;
}

/** A layer's head on the timeline: its switches, name and mode; its properties' names and values under it. */
export const MOTION_HEAD_W = 340;
/** A layer's row, as a track's in the edit but lower: one clip on it. */
export const LAYER_ROW_H = 30;
const GROUP_H = 22;
/** The switches' column (the keyframe navigator on a property's row). */
const AV_W = 50;
const MODE_W = 82;
/** The keys that show one property. */
const SOLO: Record<string, MotionProp> = { p: 'translate', s: 'scale', r: 'rotate', t: 'opacity' };
/** What shows of a layer twirled open: its Transform's properties, and its Effects group (`fx`: all its effects). */
type Shown = KeyedProp | 'fx';
const ALL: readonly Shown[] = [...MOTION_PROPS, 'fx'];
const isTransform = (p: KeyedProp) => (MOTION_PROPS as readonly string[]).includes(p);
const PROP_LABEL: Record<MotionProp, string> = { translate: 'inspector.keyPosition', scale: 'inspector.keyScale', rotate: 'inspector.keyRotate', opacity: 'inspector.keyOpacity' };
/** An effect's value: its step when dragged, its digits. */
const FX_STEP: Record<EffectProp, number> = { blur: 0.1, brightness: 0.5, contrast: 0.5, saturate: 0.5, hue: 0.5, grayscale: 0.5, invert: 0.5, glow: 0.1, trim: 0.5, z: 1, rx: 0.5, ry: 0.5, ax: 1, ay: 1 };
/** A 3D layer's numbers, shown with its Transform's: depth after position, its X and Y turns after rotation. */
const THREE_AFTER: Record<string, readonly KeyedProp[]> = { translate: ['z'], rotate: ['rx', 'ry'] };
const isThree = (p: string) => p === 'z' || p === 'rx' || p === 'ry';
/** The anchor point's two numbers, the Transform's first, as an animation editor lists it. */
const isAnchor = (p: string) => p === 'ax' || p === 'ay';
/** A mask's parameters its shape has, and their names. */
const maskParamsOf = (shape: MaskShape): MaskParam[] => {
  const f = MASK_FIELDS[shape];
  return ['pos', ...(f.size === 'box' ? ['size' as const] : []), ...(f.rotate ? ['rotate' as const] : []), ...(f.feather ? ['feather' as const] : []), ...(f.radius ? ['radius' as const] : [])];
};
const MASK_LABEL: Record<MaskParam, string> = { pos: 'inspector.keyPosition', size: 'canvas.maskSize', rotate: 'inspector.keyRotate', feather: 'inspector.maskFeather', radius: 'canvas.maskRadius' };
/** A mask's row as the keyframe rows take it (a name of its own beside the Transform's). */
const maskRow = (p: MaskParam) => `mask-${p}` as KeyedProp;
const maskParamOf = (prop: string) => prop.slice('mask-'.length) as MaskParam;
/** A page's number as the keyframe rows take it. */
const contentRow = (v: string) => `content${v}` as KeyedProp;
const isContentRow = (prop: string) => prop.startsWith('content--');
const contentVarOf = (prop: string) => prop.slice('content'.length);
/** A layer's label color by what it is, as an animation editor gives each kind its own. */
const LABEL: Record<string, string> = { video: '#4ca3ad', mg: '#a594d6', still: '#c7a35f', text: '#d0706f', image: '#c7a35f', shape: '#5b8fd6', box: '#8c9a6b', group: '#8a8f98' };
const labelOf = (layer: Layer) => LABEL[layer.kind] ?? '#8a8f98';
/** A layer's bar on the time: its label color, toned down so its name reads on it. */
export const layerBarColor = (kind: string) => `color-mix(in srgb, ${LABEL[kind] ?? '#8a8f98'} 58%, #1b2326)`;

function follow(e: React.PointerEvent, move: (dx: number, ev: PointerEvent) => void, done: (dx: number, moved: boolean) => void) {
  const x0 = e.clientX;
  let moved = false;
  const onMove = (ev: PointerEvent) => {
    if (!moved && Math.abs(ev.clientX - x0) < 3) return;
    moved = true;
    move(ev.clientX - x0, ev);
  };
  const onUp = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    done(ev.clientX - x0, moved);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

/**
 * A number in blue, as an animation editor shows a property's value: dragged left and right to change it (⇧ ten
 * times faster, ⌘/Ctrl ten times finer), clicked to type it. Written when let go or typed.
 */
export function Scrub({ value, onCommit, step = 1, digits = 1, unit, disabled, label }: {
  value: number; onCommit: (n: number) => void; step?: number; digits?: number; unit?: string; disabled?: boolean; label: string;
}) {
  const [live, setLive] = React.useState<number | null>(null);
  const [typing, setTyping] = React.useState<string | null>(null);
  const shown = live ?? value;
  const fmt = (n: number) => (Number.isInteger(n) && digits <= 1 ? n.toFixed(1) : n.toFixed(digits));
  if (typing != null) {
    return (
      <input autoFocus aria-label={label} value={typing} onChange={(e) => setTyping(e.target.value)} onFocus={(e) => e.currentTarget.select()}
        onBlur={() => { const n = Number(typing); setTyping(null); if (Number.isFinite(n)) onCommit(n); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setTyping(null);
          e.stopPropagation();
        }}
        className="h-[18px] w-[64px] rounded-[3px] border border-[var(--tl-accent)] bg-[var(--dock-pane)] px-1 text-[11.5px] tabular-nums text-[var(--text)] outline-none" />
    );
  }
  return (
    <span role="spinbutton" aria-label={label} aria-valuenow={value} tabIndex={disabled ? -1 : 0}
      className={`select-none tabular-nums ${disabled ? 'text-[var(--text-faint)]' : 'cursor-ew-resize text-[#4ea1ff] hover:underline'}`}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.stopPropagation();
        const start = value;
        let at = start;
        follow(e, (dx, ev) => { at = start + dx * step * (ev.shiftKey ? 10 : ev.metaKey || ev.ctrlKey ? 0.1 : 1); setLive(at); }, (_dx, moved) => {
          setLive(null);
          if (!moved) { setTyping(fmt(value)); return; }
          onCommit(Number(at.toFixed(3)));
        });
      }}>
      {fmt(shown)}{unit ?? ''}
    </span>
  );
}

/** What the edit's timeline draws of Motion's layers (its `layers`): a layer's head, and its properties under it. */
export interface MotionLayersView {
  headWidth: number;
  /** How tall a layer's properties are under it (0: twirled shut). */
  extraOf: (layer: Layer) => number;
  head: (layer: Layer, n: number) => React.ReactNode;
  extraHead: (layer: Layer) => React.ReactNode;
  extraBody: (layer: Layer, pxPerMs: number) => React.ReactNode;
  /** Its menus, drawn over everything. */
  overlay: React.ReactNode;
  /** The picked layers twirled open to what moves on them, or shut when they show just that (U). */
  showMoving: () => void;
}

/** A row under a layer: its height, its head (names, values), what it draws on the time. */
interface RowSpec { key: string; h: number; head: React.ReactNode; body?: (pxPerMs: number) => React.ReactNode; data?: Record<string, string> }

/**
 * A group's head under a layer (its Transform, Effects, Shape, Text, Mask): twirled open and shut, its name, what sets
 * it up beside that, and on the right, when it can go, a way to take it off.
 */
function GroupHead({ id, title, open, onTwirl, removeLabel, onRemove, children }: {
  id: string; title: string; open: boolean; onTwirl: () => void; removeLabel: string; onRemove?: (() => void) | undefined; children?: React.ReactNode;
}) {
  return (
    <div className="group/head flex h-full items-center gap-2 pr-2 text-[11.5px] text-[var(--text-muted)]" style={{ paddingLeft: AV_W + 16 }} data-group={id}>
      <button type="button" aria-expanded={open} onClick={onTwirl} onPointerDown={(e) => e.stopPropagation()}
        className="flex shrink-0 items-center gap-1 rounded-[3px] pr-1 font-medium hover:text-[var(--text)]">
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}{title}
      </button>
      {children}
      {onRemove ? (
        <button type="button" aria-label={removeLabel} title={removeLabel} data-group-remove={id} onPointerDown={(e) => e.stopPropagation()} onClick={onRemove}
          className="ml-auto grid h-[16px] w-[16px] shrink-0 place-items-center rounded-[3px] text-[var(--text-faint)] opacity-0 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] group-hover/head:opacity-100">
          <X size={11} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Motion's layers, drawn by the edit's own timeline (components/Timeline `layers`): the toolbar, the ruler, the clips,
 * their drags and trims are the edit's; a layer's head and the properties under it are these. Keys as an animation
 * editor's: P, S, R, T one property of the picked layers (⇧ added), U what moves, E the effects; J and K the keyframe
 * before and after the playhead; F9, ⌫ and ⌥←/→ on a mask's picked keyframes.
 */
export function useMotionLayers(p: MotionLayersArgs): MotionLayersView {
  const { layers, playheadMs, fps, onSeek, picked, onPick, lanesOf, hostOf, t } = p;
  /* what each layer shows of its Transform (none: closed) */
  const [shown, setShown] = React.useState<ReadonlyMap<string, readonly Shown[]>>(new Map());
  const toggle = (id: string) => setShown((was) => {
    const next = new Map(was);
    if (next.has(id)) next.delete(id); else next.set(id, ALL);
    return next;
  });
  /* layers twirled open to show what was just put on them */
  const reveal = React.useCallback((ids: readonly string[]) => setShown((was) => {
    if (ids.every((id) => was.get(id)?.includes('fx'))) return was;
    const next = new Map(was);
    for (const id of ids) next.set(id, ALL);
    return next;
  }), []);
  React.useEffect(() => { if (p.reveal?.ids.length) reveal(p.reveal.ids); }, [p.reveal, reveal]); // eslint-disable-line react-hooks/exhaustive-deps
  /* a group of a layer twirled shut (`<layer>:<group>`) */
  const [shut, setShut] = React.useState<ReadonlySet<string>>(new Set());
  const twirl = (key: string) => setShut((was) => {
    const next = new Set(was);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  /* a layer's menu (its right click, its +), or its effects' (the Effects group's +) */
  const [menu, setMenu] = React.useState<{ x: number; y: number; layer: Layer; only?: 'fx' } | null>(null);
  const [dropOn, setDropOn] = React.useState<string | null>(null);
  /* a mask's keyframes picked (`mask-pos@1.2`), by its layer; and their menu */
  const [maskPick, setMaskPick] = React.useState<{ id: string; keys: ReadonlySet<string> } | null>(null);
  const [maskMenu, setMaskMenu] = React.useState<{ x: number; y: number } | null>(null);
  const put = (layer: Layer, host: LayerHost, item: MotionItem) => {
    if (!itemApplies(host, item)) return;
    applyItem(host, item);
    reveal([layer.clipId]);
  };
  const live = React.useRef({ layers, picked, shown, playheadMs, lanesOf, hostOf, maskPick });
  live.current = { layers, picked, shown, playheadMs, lanesOf, hostOf, maskPick };
  /* the picked mask keyframes eased, taken away or moved, as a clip's are (lib/motion-keys, on the mask's rows) */
  const maskKeysRun = React.useCallback((what: EaseCommand | 'delete' | { move: number }) => {
    const pick = live.current.maskPick;
    if (!pick?.keys.size) return false;
    const layer = live.current.layers.find((l) => l.clipId === pick.id);
    const host = layer ? live.current.hostOf(layer) : null;
    const mk = host?.mask ?? null;
    const ct = host?.contents ?? null;
    if (!mk && !ct) return false;
    const rows = {
      ...Object.fromEntries(Object.entries(mk?.keys ?? {}).map(([prop, keys]) => [maskRow(prop as MaskParam), keys])),
      ...Object.fromEntries(Object.entries(ct?.keys ?? {}).map(([v, keys]) => [contentRow(v), keys])),
    } as Motion;
    let next: Motion;
    let keep: ReadonlySet<string> = pick.keys;
    if (what === 'delete') { next = withoutKeys(rows, pick.keys); keep = new Set(); }
    else if (typeof what === 'object') {
      const at = (id: string) => ({ prop: id.slice(0, id.lastIndexOf('@')), t: Number(id.slice(id.lastIndexOf('@') + 1)) });
      const dt = Math.max(what.move, -Math.min(...[...pick.keys].map((id) => at(id).t)));
      next = movedKeys(rows, pick.keys, what.move);
      keep = new Set([...pick.keys].map((id) => keyId(at(id).prop as KeyedProp, Math.round((at(id).t + dt) * 1000) / 1000)));
    } else next = easedMotion(rows, pick.keys, what);
    const touched = [...pick.keys].map((k) => k.slice(0, k.lastIndexOf('@')));
    if (mk && touched.some((prop) => !isContentRow(prop))) mk.commit({ keys: Object.fromEntries(Object.entries(next).flatMap(([prop, keys]) => (keys?.length && !isContentRow(prop) ? [[maskParamOf(prop), keys]] : []))) as MaskKeys });
    if (ct && touched.some(isContentRow)) ct.commit(Object.fromEntries(Object.entries(next).flatMap(([prop, keys]) => (keys?.length && isContentRow(prop) ? [[contentVarOf(prop), [...keys]]] : []))));
    setMaskPick({ id: pick.id, keys: keep });
    return true;
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTextField(e.target)) return;
      const now = live.current;
      /* a mask's picked keyframes: as a clip's (F9 and its ⇧/⌘⇧, ⌫, ⌥←/→, Esc) */
      if (now.maskPick?.keys.size) {
        let done = true;
        if (e.key === 'F9') maskKeysRun(e.metaKey && e.shiftKey ? 'easy-out' : e.shiftKey ? 'easy-in' : 'easy');
        else if (e.key === 'Backspace' || e.key === 'Delete') maskKeysRun('delete');
        else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) maskKeysRun({ move: ((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1)) / Math.max(1, fps) });
        else if (e.key === 'Escape') setMaskPick(null);
        else done = false;
        if (done) { e.preventDefault(); e.stopPropagation(); return; }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      /* The selected clips' enable switch takes precedence over revealing a property (Shift+E by default). */
      if (keyAction(e) === 'toggle-clip') return;
      const key = e.key.toLowerCase();
      const targets = now.layers.filter((l) => now.picked.includes(l.clipId));
      if (key in SOLO || key === 'u' || key === 'e') {
        if (!targets.length) return;
        e.preventDefault();
        e.stopPropagation();
        setShown((was) => {
          const next = new Map(was);
          for (const layer of targets) {
            const moving = [...now.lanesOf(layer).rows.filter((r) => r.keys.length).map((r) => r.prop), ...contentsKeyed(now.hostOf(layer))];
            const want: readonly Shown[] = key === 'u' ? moving : key === 'e' ? ['fx'] : [SOLO[key]!];
            const had = next.get(layer.clipId) ?? [];
            const same = had.length === want.length && want.every((x) => had.includes(x));
            if (e.shiftKey) next.set(layer.clipId, [...new Set([...had, ...want])]);
            else if (same || !want.length) next.delete(layer.clipId);
            else next.set(layer.clipId, want);
          }
          return next;
        });
        return;
      }
      if (key === 'j' || key === 'k') {
        /* the keyframes of what shows (of the picked layers when some are), on the film's time */
        const from = targets.length ? targets : now.layers;
        const times = from.flatMap((layer) => {
          const props = now.shown.get(layer.clipId) ?? (targets.length ? ALL : []);
          return now.lanesOf(layer).rows.filter((r) => props.includes(r.prop) || (!isTransform(r.prop) && props.includes('fx'))).flatMap((r) => r.keys.map((k) => layer.startMs + k.t * 1000));
        });
        const to = key === 'j' ? Math.max(...times.filter((ms) => ms < now.playheadMs - 1)) : Math.min(...times.filter((ms) => ms > now.playheadMs + 1));
        e.preventDefault();
        e.stopPropagation();
        if (Number.isFinite(to)) onSeek(to);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onSeek, maskKeysRun, fps]);

  const openMenu = (e: React.MouseEvent, layer: Layer, only?: 'fx') => {
    e.preventDefault();
    e.stopPropagation();
    if (!picked.includes(layer.clipId)) onPick(layer.clipId, false);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu(e.type === 'contextmenu' ? { x: e.clientX, y: e.clientY, layer, ...(only ? { only } : {}) } : { x: r.left, y: r.bottom + 2, layer, ...(only ? { only } : {}) });
  };
  /* dragged from the Effects & Presets panel onto a layer: put on it */
  const dropProps = (layer: Layer) => ({
    onDragOver: (e: React.DragEvent) => { if (!e.dataTransfer.types.includes(ITEM_DRAG)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropOn(layer.clipId); },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOn(null); },
    onDrop: (e: React.DragEvent) => {
      setDropOn(null);
      const item = itemOfKey(e.dataTransfer.getData(ITEM_DRAG));
      if (!item) return;
      e.preventDefault();
      onPick(layer.clipId, false);
      put(layer, hostOf(layer), item);
    },
  });

  /* the rows under a layer twirled open, worked out once a render */
  const specCache = new Map<string, RowSpec[]>();
  const specsOf = (layer: Layer): RowSpec[] => {
    const id = layer.clipId;
    const cached = specCache.get(id);
    if (cached) return cached;
    const props = shown.get(id);
    const out: RowSpec[] = [];
    specCache.set(id, out);
    if (!props) return out;
    const all = lanesOf(layer);
    const host = hostOf(layer);
    const isOpen = (g: string) => !shut.has(`${id}:${g}`);
    const group = (g: string, title: string, controls?: React.ReactNode, onRemove?: () => void, body?: RowSpec['body'], data?: Record<string, string>) => out.push({
      key: `${g}-head`, h: GROUP_H, body, data,
      head: <GroupHead id={`${id}:${g}`} title={title} open={isOpen(g)} onTwirl={() => twirl(`${id}:${g}`)} removeLabel={t('canvas.groupRemove')} onRemove={onRemove}>{controls}</GroupHead>,
    });
    const rows = (key: string, lanes: MotionLanes, heads: React.ReactNode) => out.push({
      key, h: lanesHeight(lanes),
      head: <div style={{ paddingTop: LANE_PAD / 2 }}>{lanes.graph ? <MotionLaneHeads lanes={lanes} /> : heads}</div>,
      body: (px) => <MotionLaneRows lanes={lanes} top={0} pxPerMs={px} />,
    });
    const pickOf = (): Pick<MotionLanes, 'picked' | 'onPick' | 'onMove' | 'onMenu'> => ({
      picked: maskPick?.id === id ? maskPick.keys : new Set(),
      onPick: (ids, mode) => setMaskPick((was) => {
        const base = was?.id === id ? was.keys : new Set<string>();
        if (mode === 'set') return { id, keys: new Set(ids) };
        const next = new Set(base);
        for (const k of ids) { if (mode === 'toggle' && next.has(k)) next.delete(k); else next.add(k); }
        return { id, keys: next };
      }),
      onMove: (dt) => { maskKeysRun({ move: dt }); },
      onMenu: (e) => setMaskMenu({ x: e.clientX, y: e.clientY }),
    });
    /* what its page is made of, first, as an animation editor shows a shape's Contents above its Transform */
    const ct = host.contents;
    if (ct?.params.length && (props.includes('fx') || props.some((x) => isContentRow(x)))) {
      group('contents', t('canvas.contentsGroup'), undefined, undefined, undefined, { 'data-contents-group': id });
      if (isOpen('contents')) {
        const lanes = contentLanes(all, ct, pickOf(), props.includes('fx') ? null : props.filter(isContentRow).map(contentVarOf));
        if (lanes.rows.length) rows('contents', lanes, lanes.rows.map((row) => <ContentHead key={row.prop} layer={layer} lanes={lanes} v={contentVarOf(row.prop)} contents={ct} t={t} />));
      }
    }
    /* its Transform: its anchor point first, a 3D layer's depth and turns each after the property it goes with */
    const order: KeyedProp[] = ['ax', 'ay', ...MOTION_PROPS.flatMap((x) => [x, ...(THREE_AFTER[x] ?? [])])];
    const tf = { ...all, rows: all.rows.filter((r) => (isTransform(r.prop) && props.includes(r.prop))
      || (isAnchor(r.prop) && (props.includes('translate') || props.includes(r.prop)))
      || (isThree(r.prop) && Object.entries(THREE_AFTER).some(([base, xs]) => xs.includes(r.prop) && props.includes(base as Shown))))
      .sort((a, b) => order.indexOf(a.prop) - order.indexOf(b.prop)) };
    if (tf.rows.length) {
      group('transform', t('inspector.transform'));
      if (isOpen('transform')) rows('transform', tf, tf.rows.map((row) => (isAnchor(row.prop) && host.anchor
        ? <EffectHead key={row.prop} layer={layer} lanes={tf} fx={row.prop as EffectProp} host={{ ...host, effects: host.anchor.model, commitEffects: host.anchor.commit }} t={t} />
        : isThree(row.prop) && host.three
        ? <EffectHead key={row.prop} layer={layer} lanes={tf} fx={row.prop as EffectProp} host={{ ...host, effects: host.three.model, commitEffects: host.three.commit }} t={t} />
        : <PropertyHead key={row.prop} layer={layer} lanes={tf} prop={row.prop as MotionProp} host={host} t={t} />)));
    }
    /* the groups beyond its Transform: those it has, or those asked for by name (U) */
    const fxShown = props.includes('fx') || props.some((x) => x !== 'fx' && !isTransform(x));
    if (!fxShown) return out;
    const fxOn = (host.effects?.on ?? []).filter((fx) => EFFECTS[fx].filter);
    if (host.effects && fxOn.length) {
      const fxLanes = { ...all, rows: all.rows.filter((r) => !isTransform(r.prop) && Boolean(EFFECTS[r.prop as EffectProp]?.filter) && (props.includes('fx') || props.includes(r.prop))) };
      group('fx', t('canvas.fxGroup'), FILTER_EFFECTS.some((fx) => !fxOn.includes(fx)) ? (
        <button type="button" aria-label={t('canvas.fxAdd')} title={t('canvas.fxAdd')} data-effect-add={id}
          onPointerDown={(e) => e.stopPropagation()} onClick={(e) => openMenu(e, layer, 'fx')}
          className="grid h-[16px] w-[16px] place-items-center rounded-[3px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
          <Plus size={12} />
        </button>
      ) : null, undefined, undefined, { 'data-effects-group': id });
      if (isOpen('fx') && fxLanes.rows.length) rows('fx', fxLanes, fxLanes.rows.map((row) => <EffectHead key={row.prop} layer={layer} lanes={fxLanes} fx={row.prop as EffectProp} host={host} t={t} />));
    }
    const stroke = host.stroke;
    if (stroke?.on) {
      group('shape', t('canvas.shapeGroup'), null, () => stroke.commit(stroke.model.remove('trim')), undefined, { 'data-shape-group': id });
      const trim = { ...all, rows: all.rows.filter((r) => r.prop === 'trim') };
      if (isOpen('shape') && trim.rows.length) rows('shape', trim, <EffectHead layer={layer} lanes={trim} fx="trim" host={{ ...host, effects: stroke.model, commitEffects: stroke.commit }} t={t} />);
    }
    const text = host.text;
    if (text && text.anim !== undefined) {
      const anim = text.anim;
      group('text', t('canvas.textGroup'), anim === null ? <span className="text-[11px] text-[var(--text-faint)]">{t('canvas.textCustom')}</span> : (
        <MenuSelect label={t('canvas.textAnimate')} value={anim.preset} data-text-preset={id} size="xs" block={false}
          onPointerDown={(e) => e.stopPropagation()} onPick={(value) => text.set(textAnimDefault(value as TextPreset, anim))}
          groups={[{ choices: TEXT_PRESETS.map((value) => ({ value, label: t(`canvas.textPresets.${value}`) })) }]} />
      ), anim === null ? undefined : () => text.set(null),
      /* its turns drawn on the time from when they start */
      anim ? (px) => <div className="pointer-events-none absolute inset-y-[6px] rounded-[2px] bg-[#d0706f]/50" style={{ left: anim.start * 1000 * px, width: Math.max(3, anim.secs * 1000 * px) }} /> : undefined,
      { 'data-text-group': id });
      if (anim && isOpen('text')) out.push({ key: 'text-params', h: GROUP_H, head: <TextParams layer={layer} host={text} anim={anim} t={t} /> });
    }
    const mk = host.mask;
    if (mk?.shape) {
      group('mask', t('inspector.mask'), (
        <>
          <MenuSelect label={t('inspector.maskShape')} value={mk.shape} data-mask-shape={id} size="xs" block={false}
            onPointerDown={(e) => e.stopPropagation()} onPick={(value) => mk.setShape(value as MaskShape)}
            groups={[{ choices: MASK_SHAPES.map((value) => ({ value, label: t(`inspector.maskShapes.${value}`) })) }]} />
          <label className="flex items-center gap-1 text-[11px]" onPointerDown={(e) => e.stopPropagation()}>
            <input type="checkbox" checked={mk.invert} onChange={(e) => mk.setInvert(e.target.checked)} data-mask-invert={id} />
            {t('inspector.maskInvert')}
          </label>
        </>
      ), () => mk.setShape(null), undefined, { 'data-masks-group': id });
      if (isOpen('mask') && mk.model) {
        const masks = maskLanes(all, mk, pickOf());
        rows('mask', masks, masks.rows.map((row) => <MaskHead key={row.prop} layer={layer} lanes={masks} param={maskParamOf(row.prop)} mask={mk} t={t} />));
      }
    }
    return out;
  };

  /* a layer's menu: what can be put on it (each checked when it has it, picked again to take it off), how it blends */
  const menuItems = (m: { layer: Layer; only?: 'fx' }): ContextMenuEntry[] => {
    const { layer } = m;
    const host = hostOf(layer);
    const fxItems = FILTER_EFFECTS.flatMap((fx): ContextMenuEntry[] => {
      const has = host.effects?.on.includes(fx) ?? false;
      if (m.only && has) return [];
      return [{ id: `fx-${fx}`, label: t(`canvas.fx.${fx}`), checked: has, disabled: !host.effects,
        onSelect: () => { if (has) host.commitEffects(host.effects!.remove(fx)); else put(layer, host, { kind: 'fx', id: fx }); } }];
    });
    if (m.only) return fxItems;
    const items: ContextMenuEntry[] = [];
    if (host.model?.preset) {
      items.push({ id: 'anim', label: t('canvas.animPresets'), submenu: ANIM_GROUPS.flatMap((g, gi): ContextMenuEntry[] => [
        ...(gi ? [{ id: `sep-${g.id}`, separator: true as const }] : []),
        ...g.presets.map((x) => ({ id: x, label: t(`canvas.anim.${x}`), onSelect: () => put(layer, host, { kind: 'anim', id: x }) })),
      ]) });
    }
    if (host.effects) items.push({ id: 'fx', label: t('canvas.fxGroup'), submenu: fxItems });
    const mk = host.mask;
    if (mk) {
      items.push({ id: 'mask', label: t('inspector.mask'), submenu: [
        ...MASK_SHAPES.map((shape) => ({ id: `mask-${shape}`, label: t(`inspector.maskShapes.${shape}`), checked: mk.shape === shape, onSelect: () => put(layer, host, { kind: 'mask', id: shape }) })),
        ...(mk.shape ? [
          { id: 'sep-mask', separator: true as const },
          { id: 'mask-invert', label: t('inspector.maskInvert'), checked: mk.invert, onSelect: () => mk.setInvert(!mk.invert) },
          { id: 'mask-remove', label: t('canvas.maskRemove'), danger: true, onSelect: () => mk.setShape(null) },
        ] : []),
      ] });
    }
    const text = host.text;
    if (text && text.anim !== null) {
      items.push({ id: 'text', label: t('canvas.textAnimator'), submenu: [
        ...TEXT_PRESETS.map((x) => ({ id: `text-${x}`, label: t(`canvas.textPresets.${x}`), checked: text.anim?.preset === x, onSelect: () => put(layer, host, { kind: 'text', id: x }) })),
        ...(text.anim ? [{ id: 'sep-text', separator: true as const }, { id: 'text-remove', label: t('canvas.textRemove'), danger: true, onSelect: () => text.set(null) }] : []),
      ] });
    }
    const stroke = host.stroke;
    if (stroke) items.push({ id: 'stroke', label: t('canvas.fx.trim'), checked: stroke.on, onSelect: () => { if (stroke.on) stroke.commit(stroke.model.remove('trim')); else put(layer, host, { kind: 'stroke' }); } });
    const three = host.three;
    if (three) items.push({ id: 'three', label: t('canvas.threeD'), checked: three.on, onSelect: () => { if (three.on) three.toggle(false); else put(layer, host, { kind: 'three' }); } });
    items.push(
      { id: 'sep-blend', separator: true },
      { id: 'blend', label: t('canvas.motionMode'), submenu: BLEND_MODES.map((mode) => ({ id: `blend-${mode}`, label: t(`inspector.blendModes.${mode}`), checked: host.blend === mode, onSelect: () => host.setBlend(mode) })) },
      { id: 'sep-show', separator: true },
      { id: 'moving', label: t('canvas.showMoving'), shortcut: 'U', onSelect: () => setShown((was) => {
        const keyed = [...lanesOf(layer).rows.filter((r) => r.keys.length).map((r) => r.prop), ...contentsKeyed(hostOf(layer))];
        const next = new Map(was);
        if (keyed.length) next.set(layer.clipId, keyed); else next.delete(layer.clipId);
        return next;
      }) },
    );
    if (p.onOpen && layer.kind === 'mg') items.push({ id: 'open', label: t('canvas.openComp'), onSelect: () => p.onOpen?.(layer) });
    return items;
  };

  const head = (layer: Layer, n: number) => {
    const host = hostOf(layer);
    const props = shown.get(layer.clipId);
    const on = picked.includes(layer.clipId);
    const moving = lanesOf(layer).rows.some((r) => r.keys.length);
    return (
      <div className={`group/layer flex h-full w-full min-w-0 items-center pr-1 text-[12px] ${dropOn === layer.clipId ? 'outline outline-1 -outline-offset-1 outline-[var(--tl-accent)]' : ''}`}
        data-motion-layer={layer.clipId} {...dropProps(layer)}
        onPointerDown={(e) => { if (e.button === 0) onPick(layer.clipId, e.shiftKey || e.metaKey || e.ctrlKey); }}
        onContextMenu={(e) => openMenu(e, layer)} onDoubleClick={() => p.onOpen?.(layer)}>
        <span className="grid w-[22px] shrink-0 place-items-center">
          {host.setVisible ? (
            <button type="button" aria-label={t('canvas.motionVisible')} aria-pressed={host.visible} data-layer-eye={layer.clipId}
              onPointerDown={(e) => e.stopPropagation()} onClick={() => host.setVisible?.(!host.visible)}
              className="grid h-[18px] w-[18px] place-items-center rounded-[3px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]">
              {host.visible ? <Eye size={12} /> : <EyeOff size={12} className="opacity-50" />}
            </button>
          ) : null}
        </span>
        <span className="grid w-[20px] shrink-0 place-items-center">
          {host.setLocked ? (
            <button type="button" aria-label={t(host.locked ? 'canvas.layerUnlock' : 'canvas.layerLock')} title={t(host.locked ? 'canvas.layerUnlock' : 'canvas.layerLock')} aria-pressed={host.locked} data-layer-lock={layer.clipId}
              onPointerDown={(e) => e.stopPropagation()} onClick={() => host.setLocked?.(!host.locked)}
              className={`grid h-[18px] w-[18px] place-items-center rounded-[3px] hover:bg-[var(--bg-hover)] ${host.locked ? 'text-[var(--text)]' : 'text-[var(--text-faint)] opacity-0 group-hover/layer:opacity-60'}`}>
              {host.locked ? <Lock size={11} /> : <LockOpen size={11} />}
            </button>
          ) : null}
        </span>
        <button type="button" aria-label={t('inspector.transform')} aria-expanded={Boolean(props)} data-twirl={layer.clipId}
          onPointerDown={(e) => e.stopPropagation()} onClick={() => toggle(layer.clipId)}
          className="grid h-[18px] w-[16px] shrink-0 place-items-center rounded-[3px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]">
          {props ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className="mx-1 h-[10px] w-[10px] shrink-0 rounded-[2px]" style={{ background: labelOf(layer) }} />
        <span className="w-[20px] shrink-0 text-center text-[11px] tabular-nums text-[var(--text-faint)]">{n}</span>
        {/* where it is in the tree: a guide for each level it is in, then the twirl to what is in it (a slot kept when
            nothing is, so names line up), then its name; what holds others reads as a group */}
        <span className="flex h-full min-w-0 flex-1 items-center pl-1">
          {Array.from({ length: layer.depth ?? 0 }, (_, i) => (
            <span key={i} aria-hidden className="h-full w-[14px] shrink-0 border-l border-[var(--dock-line)]" style={{ marginLeft: i ? 0 : 6 }} />
          ))}
          <span className="grid w-[16px] shrink-0 place-items-center">
            {layer.kids ? (
              <button type="button" aria-expanded={Boolean(layer.kidsOpen)} aria-label={t('canvas.layerKids').replace('{n}', String(layer.kids))} title={t('canvas.layerKids').replace('{n}', String(layer.kids))} data-layer-kids={layer.clipId}
                onPointerDown={(e) => e.stopPropagation()} onClick={() => p.onKids?.(layer)}
                className="grid h-[16px] w-[16px] place-items-center rounded-[3px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
                {layer.kidsOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              </button>
            ) : null}
          </span>
          <span className={`min-w-0 truncate ${layer.kids ? 'font-medium' : ''} ${on ? 'font-medium text-[var(--text)]' : layer.kids ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`} title={layer.title}>{layer.title || layer.clipId}</span>
          {layer.kids ? <span className="ml-1.5 shrink-0 text-[10.5px] tabular-nums text-[var(--text-faint)]">{layer.kids}</span> : null}
        </span>
        {moving ? <svg className="mr-1 shrink-0" width="7" height="7" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 11 6 6 11 1 6Z" fill="var(--tl-accent)" /></svg> : null}
        <button type="button" aria-label={t('canvas.layerAdd')} title={t('canvas.layerAdd')} data-layer-add={layer.clipId}
          onPointerDown={(e) => e.stopPropagation()} onClick={(e) => openMenu(e, layer)}
          className={`mr-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] ${menu?.layer.clipId === layer.clipId ? 'opacity-100' : 'opacity-0 group-hover/layer:opacity-100'}`}>
          <Plus size={13} />
        </button>
        <span className="grid w-[22px] shrink-0 place-items-center">
          {host.three ? (
            <button type="button" aria-label={t('canvas.threeD')} title={t('canvas.threeD')} aria-pressed={host.three.on} data-layer-3d={layer.clipId}
              onPointerDown={(e) => e.stopPropagation()} onClick={() => { host.three?.toggle(!host.three.on); if (!host.three?.on) reveal([layer.clipId]); }}
              className={`grid h-[18px] w-[20px] place-items-center rounded-[3px] hover:bg-[var(--bg-hover)] ${host.three.on ? 'text-[var(--tl-accent)]' : 'text-[var(--text-faint)] opacity-60'}`}>
              <Box size={12} />
            </button>
          ) : null}
        </span>
        <span className="relative shrink-0" style={{ width: MODE_W }}>
          <MenuSelect label={t('canvas.motionMode')} value={host.blend} data-layer-mode={layer.clipId} size="xs"
            onPointerDown={(e) => e.stopPropagation()} onPick={host.setBlend}
            className={`w-full border-transparent ${host.blend === 'normal' ? 'text-[var(--text-faint)]' : 'text-[var(--text)]'}`}
            groups={[{ choices: BLEND_MODES.map((value) => ({ value, label: t(`inspector.blendModes.${value}`) })) }]} />
        </span>
      </div>
    );
  };

  const showMoving = () => setShown((was) => {
    const next = new Map(was);
    for (const layer of layers.filter((l) => picked.includes(l.clipId))) {
      const keyed = [...lanesOf(layer).rows.filter((r) => r.keys.length).map((r) => r.prop), ...contentsKeyed(hostOf(layer))];
      const had = next.get(layer.clipId) ?? [];
      if (!keyed.length || (had.length === keyed.length && keyed.every((x) => had.includes(x)))) next.delete(layer.clipId);
      else next.set(layer.clipId, keyed);
    }
    return next;
  });
  return {
    headWidth: MOTION_HEAD_W,
    showMoving,
    extraOf: (layer) => specsOf(layer).reduce((h, s) => h + s.h, 0),
    head,
    extraHead: (layer) => (
      <div className="text-[12px]" {...dropProps(layer)}>
        {specsOf(layer).map((s) => <div key={s.key} style={{ height: s.h }} {...(s.data ?? {})}>{s.head}</div>)}
      </div>
    ),
    extraBody: (layer, px) => (
      <div>
        {specsOf(layer).map((s) => <div key={s.key} className="relative" style={{ height: s.h }}>{s.body?.(px)}</div>)}
      </div>
    ),
    overlay: (
      <>
        {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} /> : null}
        {maskMenu ? (
          <ContextMenu x={maskMenu.x} y={maskMenu.y} dense onClose={() => setMaskMenu(null)} items={[
            ...([['easy', 'ease-in-out', 'F9'], ['easy-in', 'ease-in', '⇧F9'], ['easy-out', 'ease-out', '⌘⇧F9'], ['linear', 'linear', ''], ['hold', 'hold', '']] as const)
              .map(([id, label, shortcut]) => ({ id, label: t(`inspector.eases.${label}`), ...(shortcut ? { shortcut } : {}), onSelect: () => { maskKeysRun(id); } })),
            { id: 'sep', separator: true },
            { id: 'delete', label: t('inspector.keyRemove'), shortcut: '⌫', danger: true, onSelect: () => { maskKeysRun('delete'); } },
          ]} />
        ) : null}
      </>
    ),
  };
}

/**
 * A text animator's settings, as an animation editor's: in or out, the parts (characters, words, lines), their order,
 * when the first starts, how far apart, how long each.
 */
function TextParams({ layer, host, anim, t }: { layer: Layer; host: NonNullable<LayerHost['text']>; anim: TextAnim; t: (key: string) => string }) {
  const set = (part: Partial<TextAnim>) => host.set({ ...anim, ...part });
  return (
    <div className="flex h-full items-center gap-1.5 overflow-hidden text-[11px] text-[var(--text-muted)]" style={{ paddingLeft: AV_W + 34 }}>
      <MenuSelect label={t('canvas.textDir')} value={anim.dir ?? 'in'} size="xs" block={false} className="w-[58px]" data-text-dir={layer.clipId} onPointerDown={(e) => e.stopPropagation()}
        onPick={(value) => {
          const dir = value as 'in' | 'out';
          /* going out: near the end of the page, where a line leaves */
          set(dir === 'out' ? { dir, start: Math.max(0, Math.round((layer.endMs / 1000 - anim.secs - 0.6) * 100) / 100) } : { dir: undefined, start: 0 });
        }} groups={[{ choices: ['in', 'out'].map((value) => ({ value, label: t(`canvas.textDirs.${value}`) })) }]} />
      <MenuSelect label={t('canvas.textBy')} value={anim.by} size="xs" block={false} className="w-[64px]" onPointerDown={(e) => e.stopPropagation()} onPick={(value) => set({ by: value as TextAnim['by'] })}
        groups={[{ choices: ['char', 'word', 'line'].map((value) => ({ value, label: t(`canvas.textBys.${value}`) })) }]} />
      <MenuSelect label={t('canvas.textOrder')} value={anim.order} size="xs" block={false} className="w-[72px]" onPointerDown={(e) => e.stopPropagation()} onPick={(value) => set({ order: value as TextAnim['order'] })}
        groups={[{ choices: ['forward', 'reverse', 'center', 'random'].map((value) => ({ value, label: t(`canvas.textOrders.${value}`) })) }]} />
      <Scrub label={t('canvas.textStart')} value={anim.start} unit="s" step={0.01} digits={2} onCommit={(n) => set({ start: Math.max(0, n) })} />
      <Scrub label={t('canvas.textStagger')} value={anim.stagger} unit="s" step={0.002} digits={3} onCommit={(n) => set({ stagger: Math.max(0, n) })} />
      <Scrub label={t('canvas.textSecs')} value={anim.secs} unit="s" step={0.01} digits={2} onCommit={(n) => set({ secs: Math.max(0.01, n) })} />
    </div>
  );
}

/** A layer's page numbers that have keyframes, as rows (what U shows). */
const contentsKeyed = (host: LayerHost) => Object.entries(host.contents?.keys ?? {}).filter(([, k]) => k.length).map(([v]) => contentRow(v));

/** A page's number now: as its keyframes have it at the clip's second `t`, else its still value. */
const contentNow = (ct: LayerContents, v: string, t: number) => {
  const keys = ct.keys[v];
  return keys?.length ? (valueAt('opacity', keys as Key[], t) as number) : ct.params.find((p) => p.var === v)?.still ?? null;
};

/** A page's numbers as keyframe rows (only those named, or all), as a mask's are. */
function contentLanes(all: MotionLanes, ct: LayerContents, pick: Pick<MotionLanes, 'picked' | 'onPick' | 'onMove' | 'onMenu'>, only: string[] | null): MotionLanes {
  const keysOf = (v: string) => [...(ct.keys[v] ?? [])];
  const write = (v: string, keys: Key[]) => {
    const next: Record<string, Key[]> = Object.fromEntries(Object.entries(ct.keys).map(([k, ks]) => [k, [...ks]]));
    if (keys.length) next[v] = keys; else delete next[v];
    ct.commit(next);
  };
  const local = (all.playheadMs - all.startMs) / 1000;
  const frame = all.frameMs / 1000;
  return {
    ...all,
    rows: ct.params.filter((p) => !only || only.includes(p.var)).map((p) => ({ prop: contentRow(p.var), label: p.label, keys: ct.keys[p.var] ?? [] })),
    ...pick,
    onToggleHere: (prop) => {
      const v = contentVarOf(prop);
      const keys = keysOf(v);
      const here = keys.find((k) => Math.abs(k.t - local) < frame / 2);
      const now = contentNow(ct, v, local);
      if (here) write(v, keys.filter((k) => k !== here));
      else if (now != null) write(v, [...keys, { t: Math.round(local * 1000) / 1000, v: now }].sort((a, b) => a.t - b.t));
    },
    onCurve: (prop, at, curve) => {
      const ease = easeOfBezier(curve);
      write(contentVarOf(prop), keysOf(contentVarOf(prop)).map((k) => {
        if (k.t !== at) return k;
        const { ease: _was, ...rest } = k;
        return ease ? { ...rest, ease } : rest;
      }));
    },
    onKeyEdit: (prop, at, to) => write(contentVarOf(prop), keysOf(contentVarOf(prop)).filter((k) => k.t === at || Math.abs(k.t - to.t) >= frame / 2)
      .map((k) => (k.t === at ? { ...k, t: to.t, v: to.v } : k)).sort((a, b) => a.t - b.t)),
  };
}

/** A page's number as a row in the layer's head: navigator, stopwatch, its name, its value (typed or dragged). */
function ContentHead({ layer, lanes, v, contents, t }: { layer: Layer; lanes: MotionLanes; v: string; contents: LayerContents; t: (key: string) => string }) {
  const param = contents.params.find((p) => p.var === v)!;
  const keys = [...(contents.keys[v] ?? [])];
  const local = (lanes.playheadMs - lanes.startMs) / 1000;
  const frame = lanes.frameMs / 1000;
  const inClip = lanes.playheadMs >= lanes.startMs && lanes.playheadMs <= lanes.endMs;
  const here = inClip && keys.some((k) => Math.abs(k.t - local) < frame / 2);
  const prev = [...keys].reverse().find((k) => k.t < local - frame / 2);
  const next = keys.find((k) => k.t > local + frame / 2);
  const value = contentNow(contents, v, local);
  const others = (): Record<string, Key[]> => Object.fromEntries(Object.entries(contents.keys).map(([k, ks]) => [k, [...ks]]));
  /* typed or dragged: a keyframe here when it has keyframes (the playhead on the clip), else its still value */
  const set = (n: number) => {
    if (!keys.length) { contents.commit(others(), { [v]: n }); return; }
    if (!inClip) return;
    const at = Math.round(local * 1000) / 1000;
    contents.commit({ ...others(), [v]: [...keys.filter((k) => Math.abs(k.t - local) >= frame / 2), { ...(keys.find((k) => Math.abs(k.t - local) < frame / 2) ?? {}), t: at, v: n }].sort((a, b) => a.t - b.t) });
  };
  /* the stopwatch: on, a keyframe of its value now; off, its keyframes gone and the value now kept still */
  const stopwatch = () => {
    const rest = others();
    if (keys.length) { delete rest[v]; contents.commit(rest, { [v]: value }); return; }
    if (value == null) return;
    contents.commit({ ...rest, [v]: [{ t: Math.round(Math.max(0, local) * 1000) / 1000, v: value }] });
  };
  const nav = 'grid h-[16px] w-[14px] place-items-center rounded-[2px] text-[var(--text-faint)] hover:bg-white/10 hover:text-[var(--text)] disabled:opacity-30';
  const unit = param.unit === 'deg' ? '°' : param.unit;
  const step = param.unit === 'px' || param.unit === '' ? (Math.abs(value ?? 0) >= 20 ? 1 : 0.05) : 0.5;
  return (
    <div className="flex items-center text-[11.5px]" style={{ height: LANE_H }} data-content-row={`${layer.clipId}:${v}`}>
      <span className="flex shrink-0 items-center justify-center" style={{ width: AV_W }}>
        {keys.length ? (
          <>
            <button type="button" aria-label={t('inspector.keyPrev')} disabled={!prev} className={nav} onClick={() => prev && lanes.onSeek(lanes.startMs + prev.t * 1000)}><ChevronLeft size={10} /></button>
            <button type="button" aria-label={t(here ? 'inspector.keyRemove' : 'inspector.keyAdd')} disabled={!inClip} className={nav} onClick={() => lanes.onToggleHere(contentRow(v))}>
              <svg width="8" height="8" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 11 6 6 11 1 6Z" fill={here ? 'var(--tl-accent)' : 'none'} stroke={here ? 'var(--tl-accent)' : 'currentColor'} strokeWidth="1.5" /></svg>
            </button>
            <button type="button" aria-label={t('inspector.keyNext')} disabled={!next} className={nav} onClick={() => next && lanes.onSeek(lanes.startMs + next.t * 1000)}><ChevronRight size={10} /></button>
          </>
        ) : null}
      </span>
      <span style={{ width: 34 }} />
      <Stopwatch on={keys.length > 0} label={t(keys.length ? 'inspector.stopwatchOff' : 'inspector.stopwatchOn')} disabled={value == null || (!keys.length && !inClip)} onClick={stopwatch} />
      <span className="ml-1 w-[84px] shrink-0 truncate text-[var(--text-muted)]" title={param.label}>{param.label}</span>
      {value == null ? <span className="text-[var(--text-faint)]">—</span>
        : <Scrub label={param.label} value={value} unit={unit} step={step} digits={Number.isInteger(value) && step >= 0.5 ? 1 : 2} onCommit={set} />}
    </div>
  );
}

/**
 * A mask's numbers as keyframe rows (components/MotionLanes): the layer's rows' time and playhead, its own keyframes;
 * one set, moved in the graph or eased there changes the mask's.
 */
function maskLanes(all: MotionLanes, mk: LayerMask, pick: Pick<MotionLanes, 'picked' | 'onPick' | 'onMove' | 'onMenu'>): MotionLanes {
  const params = maskParamsOf(mk.shape!);
  const keysOf = (prop: string) => mk.keys[maskParamOf(prop)] ?? [];
  const write = (prop: string, keys: MaskKeys[MaskParam]) => {
    const next = { ...mk.keys };
    if (keys?.length) next[maskParamOf(prop)] = keys; else delete next[maskParamOf(prop)];
    mk.commit({ keys: next });
  };
  return {
    ...all,
    rows: params.map((p) => ({ prop: maskRow(p), label: p, keys: mk.keys[p] ?? [] })),
    ...pick,
    onToggleHere: (prop) => mk.commit(mk.model?.toggleHere(maskParamOf(prop)) ?? null),
    onCurve: (prop, at, curve) => {
      const ease = easeOfBezier(curve);
      write(prop, keysOf(prop).map((k) => {
        if (k.t !== at) return k;
        const { ease: _was, ...rest } = k;
        return ease ? { ...rest, ease } : rest;
      }));
    },
    onKeyEdit: (prop, at, to) => write(prop, keysOf(prop).filter((k) => k.t === at || Math.abs(k.t - to.t) >= all.frameMs / 2000)
      .map((k) => (k.t === at ? { ...k, t: to.t, v: to.v } : k)).sort((a, b) => a.t - b.t)),
  };
}

/** A mask's number as a row in the layer's head: navigator, stopwatch, name, its value (a pair for position and size). */
function MaskHead({ layer, lanes, param, mask, t }: { layer: Layer; lanes: MotionLanes; param: MaskParam; mask: LayerMask; t: (key: string) => string }) {
  const model = mask.model!;
  const keys = mask.keys[param] ?? [];
  const local = (lanes.playheadMs - lanes.startMs) / 1000;
  const frame = lanes.frameMs / 1000;
  const inClip = lanes.playheadMs >= lanes.startMs && lanes.playheadMs <= lanes.endMs;
  const here = inClip && keys.some((k) => Math.abs(k.t - local) < frame / 2);
  const prev = [...keys].reverse().find((k) => k.t < local - frame / 2);
  const next = keys.find((k) => k.t > local + frame / 2);
  const nav = 'grid h-[16px] w-[14px] place-items-center rounded-[2px] text-[var(--text-faint)] hover:bg-white/10 hover:text-[var(--text)] disabled:opacity-30';
  const value = model.now(param);
  const set = (v: number | [number, number]) => mask.commit(model.set(param, v));
  return (
    <div className="flex items-center text-[11.5px]" style={{ height: LANE_H }} data-mask-row={`${layer.clipId}:${param}`}>
      <span className="flex shrink-0 items-center justify-center" style={{ width: AV_W }}>
        {keys.length ? (
          <>
            <button type="button" aria-label={t('inspector.keyPrev')} disabled={!prev} className={nav} onClick={() => prev && lanes.onSeek(lanes.startMs + prev.t * 1000)}><ChevronLeft size={10} /></button>
            <button type="button" aria-label={t(here ? 'inspector.keyRemove' : 'inspector.keyAdd')} disabled={!inClip} className={nav} onClick={() => mask.commit(model.toggleHere(param))}>
              <svg width="8" height="8" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 11 6 6 11 1 6Z" fill={here ? 'var(--tl-accent)' : 'none'} stroke={here ? 'var(--tl-accent)' : 'currentColor'} strokeWidth="1.5" /></svg>
            </button>
            <button type="button" aria-label={t('inspector.keyNext')} disabled={!next} className={nav} onClick={() => next && lanes.onSeek(lanes.startMs + next.t * 1000)}><ChevronRight size={10} /></button>
          </>
        ) : null}
      </span>
      <span style={{ width: 34 }} />
      <Stopwatch on={keys.length > 0} label={t(keys.length ? 'inspector.stopwatchOff' : 'inspector.stopwatchOn')} disabled={!keys.length && !inClip}
        onClick={() => mask.commit(model.stopwatch(param))} />
      <span className="ml-1 w-[84px] shrink-0 truncate text-[var(--text-muted)]">{t(MASK_LABEL[param])}</span>
      <span className="flex min-w-0 items-center gap-2">
        {Array.isArray(value) ? (
          <>
            <Scrub label="X" value={value[0]} unit="%" step={0.2} onCommit={(n) => set([n, value[1]])} />
            <span className="text-[var(--text-faint)]">,</span>
            <Scrub label="Y" value={value[1]} unit="%" step={0.2} onCommit={(n) => set([value[0], n])} />
          </>
        ) : <Scrub label={t(MASK_LABEL[param])} value={value} unit={param === 'rotate' ? '°' : '%'} step={0.2} onCommit={(n) => set(param === 'rotate' ? n : Math.max(0, n))} />}
      </span>
    </div>
  );
}

/** An effect's row in the layer's head, as a property's: navigator, stopwatch, name, value; and a way to take it off. */
function EffectHead({ layer, lanes, fx, host, t }: { layer: Layer; lanes: MotionLanes; fx: EffectProp; host: LayerHost; t: (key: string) => string }) {
  const model = host.effects!;
  const keys = lanes.rows.find((r) => r.prop === fx)?.keys ?? [];
  const local = (lanes.playheadMs - lanes.startMs) / 1000;
  const frame = lanes.frameMs / 1000;
  const inClip = lanes.playheadMs >= 0 && lanes.playheadMs <= lanes.endMs;
  const here = inClip && keys.some((k) => Math.abs(k.t - local) < frame / 2);
  const prev = [...keys].reverse().find((k) => k.t < local - frame / 2);
  const next = keys.find((k) => k.t > local + frame / 2);
  const nav = 'grid h-[16px] w-[14px] place-items-center rounded-[2px] text-[var(--text-faint)] hover:bg-white/10 hover:text-[var(--text)] disabled:opacity-30';
  const unit = EFFECTS[fx].unit === 'deg' ? '°' : EFFECTS[fx].unit || '%';
  return (
    <div className="group/fx flex items-center text-[11.5px]" style={{ height: LANE_H }} data-effect-row={`${layer.clipId}:${fx}`}>
      <span className="flex shrink-0 items-center justify-center" style={{ width: AV_W }}>
        {keys.length ? (
          <>
            <button type="button" aria-label={t('inspector.keyPrev')} disabled={!prev} className={nav} onClick={() => prev && lanes.onSeek(lanes.startMs + prev.t * 1000)}><ChevronLeft size={10} /></button>
            <button type="button" aria-label={t(here ? 'inspector.keyRemove' : 'inspector.keyAdd')} disabled={!inClip} className={nav} onClick={() => host.commitEffects(model.toggleHere(fx))}>
              <svg width="8" height="8" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 11 6 6 11 1 6Z" fill={here ? 'var(--tl-accent)' : 'none'} stroke={here ? 'var(--tl-accent)' : 'currentColor'} strokeWidth="1.5" /></svg>
            </button>
            <button type="button" aria-label={t('inspector.keyNext')} disabled={!next} className={nav} onClick={() => next && lanes.onSeek(lanes.startMs + next.t * 1000)}><ChevronRight size={10} /></button>
          </>
        ) : null}
      </span>
      <span style={{ width: 34 }} />
      <Stopwatch on={keys.length > 0} label={t(keys.length ? 'inspector.stopwatchOff' : 'inspector.stopwatchOn')} disabled={!keys.length && !inClip}
        onClick={() => host.commitEffects(model.stopwatch(fx))} />
      <span className="ml-1 w-[84px] shrink-0 truncate text-[var(--text-muted)]">{t(`canvas.fx.${fx}`)}</span>
      <Scrub label={t(`canvas.fx.${fx}`)} value={model.now(fx)} unit={unit} step={FX_STEP[fx]}
        onCommit={(n) => host.commitEffects(model.set(fx, EFFECTS[fx].unit === 'deg' || isThree(fx) || isAnchor(fx) ? n : fx === 'trim' ? Math.min(100, Math.max(0, n)) : Math.max(0, n)))} />
      {isThree(fx) || isAnchor(fx) ? null : <button type="button" aria-label={t('canvas.fxRemove')} title={t('canvas.fxRemove')} data-effect-remove={`${layer.clipId}:${fx}`}
        onClick={() => host.commitEffects(model.remove(fx))}
        className="ml-2 grid h-[16px] w-[16px] place-items-center rounded-[3px] text-[var(--text-faint)] opacity-0 hover:bg-white/10 hover:text-[var(--text)] group-hover/fx:opacity-100">
        <X size={11} />
      </button>}
    </div>
  );
}

/** A property's row in the layer's head: the navigator in the switches' column, its stopwatch, its name, its value. */
function PropertyHead({ layer, lanes, prop, host, t }: { layer: Layer; lanes: MotionLanes; prop: MotionProp; host: LayerHost; t: (key: string) => string }) {
  const model = host.model;
  const row = lanes.rows.find((r) => r.prop === prop)!;
  const keys = row.keys;
  const local = (lanes.playheadMs - lanes.startMs) / 1000;
  const frame = lanes.frameMs / 1000;
  const inClip = lanes.playheadMs >= lanes.startMs && lanes.playheadMs <= lanes.endMs;
  const here = inClip && keys.some((k) => Math.abs(k.t - local) < frame / 2);
  const prev = [...keys].reverse().find((k) => k.t < local - frame / 2);
  const next = keys.find((k) => k.t > local + frame / 2);
  const value = model?.now(prop);
  const set = (n: number | [number, number]) => host.commit(model?.set(prop, n) ?? null);
  const nav = 'grid h-[16px] w-[14px] place-items-center rounded-[2px] text-[var(--text-faint)] hover:bg-white/10 hover:text-[var(--text)] disabled:opacity-30';
  return (
    <div className="flex items-center text-[11.5px]" style={{ height: LANE_H }} data-property-row={`${layer.clipId}:${prop}`}>
      <span className="flex shrink-0 items-center justify-center" style={{ width: AV_W }}>
        {keys.length ? (
          <>
            <button type="button" aria-label={t('inspector.keyPrev')} disabled={!prev} className={nav} onClick={() => prev && lanes.onSeek(lanes.startMs + prev.t * 1000)}><ChevronLeft size={10} /></button>
            <button type="button" aria-label={t(here ? 'inspector.keyRemove' : 'inspector.keyAdd')} disabled={!inClip} className={nav} onClick={() => host.commit(model?.toggleHere(prop) ?? null)}>
              <svg width="8" height="8" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 11 6 6 11 1 6Z" fill={here ? 'var(--tl-accent)' : 'none'} stroke={here ? 'var(--tl-accent)' : 'currentColor'} strokeWidth="1.5" /></svg>
            </button>
            <button type="button" aria-label={t('inspector.keyNext')} disabled={!next} className={nav} onClick={() => next && lanes.onSeek(lanes.startMs + next.t * 1000)}><ChevronRight size={10} /></button>
          </>
        ) : null}
      </span>
      <span style={{ width: 34 }} />
      <Stopwatch on={keys.length > 0} label={t(keys.length ? 'inspector.stopwatchOff' : 'inspector.stopwatchOn')} disabled={!model || (!keys.length && !inClip)}
        onClick={() => host.commit(model?.stopwatch(prop) ?? null)} />
      <span className="ml-1 w-[84px] shrink-0 truncate text-[var(--text-muted)]">{t(PROP_LABEL[prop])}</span>
      <span className="flex min-w-0 items-center gap-2">
        {value == null ? <span className="text-[var(--text-faint)]">—</span>
          : prop === 'translate' ? (
            <>
              <Scrub label="X" value={(value as [number, number])[0]} onCommit={(n) => set([n, (value as [number, number])[1]])} />
              <span className="text-[var(--text-faint)]">,</span>
              <Scrub label="Y" value={(value as [number, number])[1]} onCommit={(n) => set([(value as [number, number])[0], n])} />
            </>
          ) : prop === 'scale' ? <Scrub label={t('inspector.keyScale')} value={value as number} unit="%" step={0.5} onCommit={set} />
            : prop === 'rotate' ? <Scrub label={t('inspector.keyRotate')} value={value as number} unit="°" step={0.5} onCommit={set} />
              : <Scrub label={t('inspector.keyOpacity')} value={value as number} unit="%" step={0.5} digits={0} onCommit={(n) => set(Math.min(100, Math.max(0, n)))} />}
      </span>
    </div>
  );
}
