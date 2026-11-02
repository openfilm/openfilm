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
import { Box, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, Plus, X } from 'lucide-react';
import { EFFECTS, MOTION_PROPS, type EffectProp, type KeyedProp, type Motion, type MotionProp } from '../../../../src/clip-motion.mjs';
import type { effectsModel, EffectsChange } from '@/lib/motion-keys';
import { easeOfBezier, easedMotion, keyId, movedKeys, withoutKeys, type EaseCommand } from '@/lib/motion-keys';
import { MASK_FIELDS, MASK_SHAPES, type MaskShape } from '@/lib/clip-mask';
import type { MaskChange, MaskKeys, MaskParam, maskModel } from '@/lib/mask-motion';
import { TEXT_PRESETS, textAnimDefault, type TextAnim, type TextPreset } from '@/lib/text-animator';
import type { FilmRange } from '@/lib/studio-refs';
import { BLEND_MODES } from '@/lib/clip-look';
import { formatTimecode } from '@/lib/timecode';
import { ANIM_GROUPS, type Rest } from '@/lib/motion-presets';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { FILTER_EFFECTS, ITEM_DRAG, applyItem, itemApplies, itemOfKey, type MotionItem } from './motion-items';
import { Stopwatch } from './KeyframesSection';
import { LANE_H, LANE_PAD, MotionLaneHeads, MotionLaneRows, lanesHeight, type MotionLanes } from './MotionLanes';

/**
 * A layer: a clip of the film, or an element of a page (a composition opened); `clipId` names it (an element's is
 * where it is). `depth` and `parent`: where it is nested, an element in another.
 */
export interface Layer { clipId: string; title?: string; kind: string; startMs: number; endMs: number; depth?: number; parent?: string }

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
  /** Only where a layer can be hidden on its own (an element of a page). */
  visible?: boolean;
  setVisible?: (on: boolean) => void;
  /** Its effects (lib/motion-keys effectsModel), and a change of them written. */
  effects: ReturnType<typeof effectsModel> | null;
  commitEffects: (c: EffectsChange | null) => void;
  /** Its mask (a clip's; none where it cannot have one here). */
  mask?: LayerMask | null;
  /** Its words animated part by part (a text element's; null: one Studio did not write, shown as such). */
  text?: { anim: TextAnim | null | undefined; set: (anim: TextAnim | null) => void };
  /** In 3D (a clip's): on or not, its depth and X and Y turns (an effect's numbers), switched. */
  three?: { on: boolean; model: ReturnType<typeof effectsModel>; commit: (c: EffectsChange | null) => void; toggle: (on: boolean) => void };
  /** Its stroke drawn on (a shape's): on or not, how much is drawn (an effect's numbers, `trim`), turned on. */
  stroke?: { on: boolean; model: ReturnType<typeof effectsModel>; commit: (c: EffectsChange | null) => void; turnOn: () => void };
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

export interface MotionTimelineProps {
  /** The picture clips, the topmost first. */
  layers: readonly Layer[];
  totalMs: number;
  playheadMs: number;
  fps: number;
  onSeek: (ms: number) => void;
  picked: readonly string[];
  onPick: (clipId: string, add: boolean) => void;
  lanesOf: (layer: Layer) => MotionLanes;
  hostOf: (layer: Layer) => LayerHost;
  /** A layer moved in time, or one of its ends (trimmed); none: its bar stays (an element plays all its page). */
  onMoveLayer?: (clipId: string, deltaMs: number) => void;
  onTrimLayer?: (clipId: string, edge: 'start' | 'end', deltaMs: number) => void;
  /** A layer double-clicked: its composition opened (a page's elements); none where it has none. */
  onOpen?: (layer: Layer) => void;
  /** The composition open, and the way back to the film. */
  crumb?: { outer: string; name: string; onBack: () => void } | null;
  /** Layers to show twirled open (what was just put on them from the Effects & Presets panel), by a count that changes. */
  reveal?: { ids: readonly string[]; n: number } | null;
  /** The work area: the film's marked range. */
  workArea: FilmRange | null;
  onWorkArea: (range: FilmRange | null) => void;
  t: (key: string) => string;
}

const HEAD_W = 380;
const LAYER_H = 24;
const RULER_H = 30;
/** The switches' column (the keyframe navigator on a property's row). */
const AV_W = 58;
const MODE_W = 92;
const PARENT_W = 84;
/** The keys that show one property. */
const SOLO: Record<string, MotionProp> = { p: 'translate', s: 'scale', r: 'rotate', t: 'opacity' };
/** What shows of a layer twirled open: its Transform's properties, and its Effects group (`fx`: all its effects). */
type Shown = KeyedProp | 'fx';
const ALL: readonly Shown[] = [...MOTION_PROPS, 'fx'];
const isTransform = (p: KeyedProp) => (MOTION_PROPS as readonly string[]).includes(p);
const PROP_LABEL: Record<MotionProp, string> = { translate: 'inspector.keyPosition', scale: 'inspector.keyScale', rotate: 'inspector.keyRotate', opacity: 'inspector.keyOpacity' };
/** An effect's value: its step when dragged, its digits. */
const FX_STEP: Record<EffectProp, number> = { blur: 0.1, brightness: 0.5, contrast: 0.5, saturate: 0.5, hue: 0.5, grayscale: 0.5, glow: 0.1, trim: 0.5, z: 1, rx: 0.5, ry: 0.5 };
/** A 3D layer's numbers, shown with its Transform's: depth after position, its X and Y turns after rotation. */
const THREE_AFTER: Record<string, readonly KeyedProp[]> = { translate: ['z'], rotate: ['rx', 'ry'] };
const isThree = (p: string) => p === 'z' || p === 'rx' || p === 'ry';
/** A mask's parameters its shape has, and their names. */
const maskParamsOf = (shape: MaskShape): MaskParam[] => {
  const f = MASK_FIELDS[shape];
  return ['pos', ...(f.size === 'box' ? ['size' as const] : []), ...(f.rotate ? ['rotate' as const] : []), ...(f.feather ? ['feather' as const] : []), ...(f.radius ? ['radius' as const] : [])];
};
const MASK_LABEL: Record<MaskParam, string> = { pos: 'inspector.keyPosition', size: 'canvas.maskSize', rotate: 'inspector.keyRotate', feather: 'inspector.maskFeather', radius: 'canvas.maskRadius' };
/** A mask's row as the keyframe rows take it (a name of its own beside the Transform's). */
const maskRow = (p: MaskParam) => `mask-${p}` as KeyedProp;
const maskParamOf = (prop: string) => prop.slice('mask-'.length) as MaskParam;
/** A layer's label color by what it is, as an animation editor gives each kind its own. */
const LABEL: Record<string, string> = { video: '#4ca3ad', mg: '#a594d6', still: '#c7a35f', text: '#d0706f', image: '#c7a35f', shape: '#5b8fd6', box: '#8c9a6b', group: '#8a8f98' };
const labelOf = (layer: Layer) => LABEL[layer.kind] ?? '#8a8f98';
const SELECT = 'h-[18px] rounded-[4px] border border-[var(--dock-line)] bg-transparent px-1 text-[11px] text-[var(--text-muted)] outline-none hover:bg-[var(--bg-hover)]';

/**
 * A group's head under a layer (its Transform, Effects, Shape, Text, Mask): twirled open and shut, its name, what sets
 * it up beside that, and on the right, when it can go, a way to take it off.
 */
function GroupHead({ id, title, open, onTwirl, head, headW, timeW, removeLabel, onRemove, children }: {
  id: string; title: string; open: boolean; onTwirl: () => void; head: string; headW: number; timeW: number;
  removeLabel: string; onRemove?: (() => void) | undefined; children?: React.ReactNode;
}) {
  return (
    <div className="group/head flex" style={{ height: 22 }} data-group={id}>
      <div className={`${head} flex items-center gap-2 border-r border-[var(--dock-line)] pr-2 text-[11.5px] text-[var(--text-muted)]`} style={{ width: headW, paddingLeft: AV_W + 16 }}>
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
      <div style={{ width: timeW }} />
    </div>
  );
}

/** Follow the pointer from a press: `move` with how far it went (px), `done` on letting go. */
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
      <input autoFocus aria-label={label} value={typing} onChange={(e) => setTyping(e.target.value)}
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

export function MotionTimeline(p: MotionTimelineProps) {
  const { layers, totalMs, playheadMs, fps, onSeek, picked, onPick, lanesOf, hostOf, t } = p;
  const scroller = React.useRef<HTMLDivElement | null>(null);
  /* a parent's column only where layers are nested (a page's elements) */
  const hasParents = layers.some((l) => (l.depth ?? 0) > 0);
  const headW = HEAD_W + (hasParents ? PARENT_W : 0);
  const [width, setWidth] = React.useState(800);
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  /* the time's zoom: 1 is the whole film across */
  const [zoom, setZoom] = React.useState(1);
  const fitW = Math.max(100, width - headW - 24);
  const timeW = fitW * zoom;
  const pxPerMs = timeW / Math.max(totalMs, 1000);

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
    const mk = layer ? live.current.hostOf(layer).mask : null;
    if (!mk) return false;
    const rows = Object.fromEntries(Object.entries(mk.keys).map(([prop, keys]) => [maskRow(prop as MaskParam), keys])) as Motion;
    let next: Motion;
    let keep: ReadonlySet<string> = pick.keys;
    if (what === 'delete') { next = withoutKeys(rows, pick.keys); keep = new Set(); }
    else if (typeof what === 'object') {
      const at = (id: string) => ({ prop: id.slice(0, id.lastIndexOf('@')), t: Number(id.slice(id.lastIndexOf('@') + 1)) });
      const dt = Math.max(what.move, -Math.min(...[...pick.keys].map((id) => at(id).t)));
      next = movedKeys(rows, pick.keys, what.move);
      keep = new Set([...pick.keys].map((id) => keyId(at(id).prop as KeyedProp, Math.round((at(id).t + dt) * 1000) / 1000)));
    } else next = easedMotion(rows, pick.keys, what);
    mk.commit({ keys: Object.fromEntries(Object.entries(next).flatMap(([prop, keys]) => (keys?.length ? [[maskParamOf(prop), keys]] : []))) as MaskKeys });
    setMaskPick({ id: pick.id, keys: keep });
    return true;
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
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
      const key = e.key.toLowerCase();
      const targets = now.layers.filter((l) => now.picked.includes(l.clipId));
      if (key in SOLO || key === 'u' || key === 'e') {
        if (!targets.length) return;
        e.preventDefault();
        e.stopPropagation();
        setShown((was) => {
          const next = new Map(was);
          for (const layer of targets) {
            const moving = now.lanesOf(layer).rows.filter((r) => r.keys.length).map((r) => r.prop);
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

  /* the ruler: pressed and dragged, the playhead follows */
  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    const at = (x: number) => onSeek(Math.min(totalMs, Math.max(0, (x - box.left) / pxPerMs)));
    at(e.clientX);
    const move = (ev: PointerEvent) => at(ev.clientX);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  /* a tick each so many seconds that their labels stay apart */
  const step = [100, 250, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000].find((ms) => ms * pxPerMs >= 56) ?? 600_000;
  const ticks = Array.from({ length: Math.floor(totalMs / step) + 1 }, (_, i) => i * step);
  const tickLabel = (ms: number) => {
    const s = ms / 1000;
    if (s < 60) return `${Number.isInteger(s) ? s : s.toFixed(step < 1000 ? 2 : 1).replace(/0$/, '')}s`;
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };
  const frameMs = 1000 / Math.max(1, fps);
  const snapMs = (ms: number) => Math.round(ms / frameMs) * frameMs;

  /* a layer's bar dragged (moved), or one of its ends (trimmed): shown as it goes, written when let go */
  const [barDrag, setBarDrag] = React.useState<{ id: string; kind: 'move' | 'start' | 'end'; dms: number } | null>(null);
  const pressBar = (e: React.PointerEvent, layer: Layer, kind: 'move' | 'start' | 'end') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onPick(layer.clipId, e.shiftKey || e.metaKey || e.ctrlKey);
    if (kind === 'move' ? !p.onMoveLayer : !p.onTrimLayer) return;
    follow(e, (dx) => setBarDrag({ id: layer.clipId, kind, dms: snapMs(dx / pxPerMs) }), (dx, moved) => {
      setBarDrag(null);
      const dms = snapMs(dx / pxPerMs);
      if (!moved || !dms) return;
      if (kind === 'move') p.onMoveLayer?.(layer.clipId, dms);
      else p.onTrimLayer?.(layer.clipId, kind, dms);
    });
  };
  /* the work area's ends, dragged */
  const pressWork = (e: React.PointerEvent, edge: 'start' | 'end') => {
    const range = p.workArea;
    if (!range || e.button !== 0) return;
    e.stopPropagation();
    follow(e, (dx) => {
      const ms = snapMs(Math.min(totalMs, Math.max(0, (edge === 'start' ? range.startMs : range.endMs) + dx / pxPerMs)));
      p.onWorkArea(edge === 'start' ? { startMs: Math.min(ms, range.endMs - frameMs), endMs: range.endMs } : { startMs: range.startMs, endMs: Math.max(ms, range.startMs + frameMs) });
    }, () => {});
  };

  const head = 'sticky left-0 z-10 shrink-0 bg-[var(--dock-pane)]';
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
        ...g.presets.map((id) => ({ id, label: t(`canvas.anim.${id}`), onSelect: () => put(layer, host, { kind: 'anim', id }) })),
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
        const keyed = lanesOf(layer).rows.filter((r) => r.keys.length).map((r) => r.prop);
        const next = new Map(was);
        if (keyed.length) next.set(layer.clipId, keyed); else next.delete(layer.clipId);
        return next;
      }) },
    );
    if (p.onOpen && layer.kind === 'mg') items.push({ id: 'open', label: t('canvas.openComp'), onSelect: () => p.onOpen?.(layer) });
    return items;
  };
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden text-[12px]" data-motion-timeline="">
      {p.crumb ? (
        <div className="flex h-[24px] shrink-0 items-center gap-1 border-b border-[var(--dock-line)] px-2 text-[12px]">
          <button type="button" data-composition-back="" onClick={p.crumb.onBack}
            className="flex items-center gap-1 rounded-[4px] px-1 text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text)]">
            <ChevronLeft size={13} />{p.crumb.outer}
          </button>
          <span className="text-[var(--text-faint)]">/</span>
          <span className="truncate font-medium text-[var(--text)]">{p.crumb.name}</span>
        </div>
      ) : null}
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        <div className="relative" style={{ width: headW + timeW + 24 }}>
          {/* the current time, the columns' names, the work area and the ruler, kept in sight */}
          <div className="sticky top-0 z-20 flex border-b border-[var(--dock-line)] bg-[var(--dock-pane)]" style={{ height: RULER_H }}>
            <div className={`${head} z-30 flex items-end border-r border-[var(--dock-line)] pb-1`} style={{ width: headW }}>
              <span className="px-2 pb-[1px] text-[15px] font-medium leading-none tabular-nums text-[#4ea1ff]" data-motion-time="">{formatTimecode(playheadMs, { fps })}</span>
              <span className="ml-auto flex text-[10.5px] text-[var(--text-faint)]">
                <span style={{ width: MODE_W }}>{t('canvas.motionMode')}</span>
                {hasParents ? <span style={{ width: PARENT_W }}>{t('canvas.motionParent')}</span> : null}
              </span>
            </div>
            <div className="relative cursor-ew-resize" style={{ width: timeW }} onPointerDown={scrub}>
              {p.workArea ? (
                <div className="absolute top-[2px] h-[7px] rounded-[2px] bg-[#6b7a99]/70" style={{ left: p.workArea.startMs * pxPerMs, width: Math.max(2, (p.workArea.endMs - p.workArea.startMs) * pxPerMs) }}>
                  <span className="absolute -left-[3px] top-0 h-full w-[6px] cursor-ew-resize rounded-[2px] bg-[#9fb0d0]" onPointerDown={(e) => pressWork(e, 'start')} />
                  <span className="absolute -right-[3px] top-0 h-full w-[6px] cursor-ew-resize rounded-[2px] bg-[#9fb0d0]" onPointerDown={(e) => pressWork(e, 'end')} />
                </div>
              ) : null}
              {ticks.map((ms) => (
                <div key={ms} className="absolute bottom-0 top-[12px] border-l border-[var(--text-faint)]/40 pl-1 text-[10px] leading-none text-[var(--text-faint)]" style={{ left: ms * pxPerMs }}>
                  {tickLabel(ms)}
                </div>
              ))}
            </div>
          </div>
          {!layers.length ? <p className="p-4 text-[12px] text-[var(--text-faint)]">{t('canvas.motionEmpty')}</p> : null}
          {layers.map((layer, i) => {
            const props = shown.get(layer.clipId);
            const all = props ? lanesOf(layer) : null;
            const host = hostOf(layer);
            /* its Transform, a 3D layer's depth and turns each after the property it goes with */
            const order: KeyedProp[] = MOTION_PROPS.flatMap((p) => [p, ...(THREE_AFTER[p] ?? [])]);
            const lanes = all && props ? {
              ...all,
              rows: all.rows.filter((r) => (isTransform(r.prop) && props.includes(r.prop)) || (isThree(r.prop) && Object.entries(THREE_AFTER).some(([base, xs]) => xs.includes(r.prop) && props.includes(base as Shown))))
                .sort((a, b) => order.indexOf(a.prop) - order.indexOf(b.prop)),
            } : null;
            /* the groups beyond its Transform: all it has, or those asked for by name (U) */
            const fxShown = Boolean(props && (props.includes('fx') || props.some((x) => x !== 'fx' && !isTransform(x))));
            const fxLanes = all && props && fxShown && host.effects
              ? { ...all, rows: all.rows.filter((r) => !isTransform(r.prop) && Boolean(EFFECTS[r.prop as EffectProp]?.filter) && (props.includes('fx') || props.includes(r.prop))) }
              : null;
            const on = picked.includes(layer.clipId);
            const moving = lanesOf(layer).rows.some((r) => r.keys.length);
            const drag = barDrag?.id === layer.clipId ? barDrag : null;
            const startMs = layer.startMs + (drag && drag.kind !== 'end' ? drag.dms : 0);
            const endMs = layer.endMs + (drag && drag.kind !== 'start' ? drag.dms : 0);
            const tint = on ? 'bg-[color-mix(in_srgb,var(--tl-accent)_14%,var(--dock-pane))]' : 'bg-[var(--dock-pane)]';
            const openMenu = (e: React.MouseEvent, only?: 'fx') => {
              e.preventDefault();
              e.stopPropagation();
              if (!on) onPick(layer.clipId, false);
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setMenu(e.type === 'contextmenu' ? { x: e.clientX, y: e.clientY, layer, ...(only ? { only } : {}) } : { x: r.left, y: r.bottom + 2, layer, ...(only ? { only } : {}) });
            };
            const isOpen = (g: string) => !shut.has(`${layer.clipId}:${g}`);
            const group = (g: string, title: string, controls?: React.ReactNode, onRemove?: () => void) => (
              <GroupHead key={`${g}-head`} id={`${layer.clipId}:${g}`} title={title} open={isOpen(g)} onTwirl={() => twirl(`${layer.clipId}:${g}`)}
                head={head} headW={headW} timeW={timeW} removeLabel={t('canvas.groupRemove')} onRemove={onRemove}>{controls}</GroupHead>
            );
            const rowsOf = (rows: MotionLanes, heads: React.ReactNode) => (
              <div className="flex" style={{ height: lanesHeight(rows) }}>
                <div className={`${head} border-r border-[var(--dock-line)]`} style={{ width: headW, paddingTop: LANE_PAD / 2 }}>{rows.graph ? <MotionLaneHeads lanes={rows} /> : heads}</div>
                <div className="relative" style={{ width: timeW }}><MotionLaneRows lanes={rows} top={0} pxPerMs={pxPerMs} /></div>
              </div>
            );
            const fxOn = (host.effects?.on ?? []).filter((fx) => EFFECTS[fx].filter);
            const stroke = host.stroke;
            const text = host.text;
            const mk = host.mask;
            return (
              <div key={layer.clipId} data-motion-layer={layer.clipId}
                className={`border-b border-[var(--dock-line)] ${dropOn === layer.clipId ? 'outline outline-1 -outline-offset-1 outline-[var(--tl-accent)]' : ''}`}
                onDragOver={(e) => { if (!e.dataTransfer.types.includes(ITEM_DRAG)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropOn(layer.clipId); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOn(null); }}
                onDrop={(e) => {
                  setDropOn(null);
                  const item = itemOfKey(e.dataTransfer.getData(ITEM_DRAG));
                  if (!item) return;
                  e.preventDefault();
                  onPick(layer.clipId, false);
                  put(layer, host, item);
                }}>
                <div className="group/layer flex" style={{ height: LAYER_H }} onContextMenu={(e) => openMenu(e)}>
                  <div className={`sticky left-0 z-10 flex shrink-0 items-center border-r border-[var(--dock-line)] ${tint}`} style={{ width: headW }}
                    onPointerDown={(e) => { if (e.button === 0) onPick(layer.clipId, e.shiftKey || e.metaKey || e.ctrlKey); }}>
                    <span className="flex shrink-0 items-center pl-1" style={{ width: AV_W }}>
                      {host.setVisible ? (
                        <button type="button" aria-label={t('canvas.motionVisible')} aria-pressed={host.visible} data-layer-eye={layer.clipId}
                          onPointerDown={(e) => e.stopPropagation()} onClick={() => host.setVisible?.(!host.visible)}
                          className="grid h-[18px] w-[18px] place-items-center rounded-[3px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]">
                          {host.visible ? <Eye size={12} /> : <EyeOff size={12} className="opacity-50" />}
                        </button>
                      ) : null}
                    </span>
                    <button type="button" aria-label={t('inspector.transform')} aria-expanded={Boolean(props)} data-twirl={layer.clipId}
                      onPointerDown={(e) => e.stopPropagation()} onClick={() => toggle(layer.clipId)}
                      className="grid h-[18px] w-[16px] shrink-0 place-items-center rounded-[3px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]">
                      {props ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                    <span className="mx-1 h-[10px] w-[10px] shrink-0 rounded-[2px]" style={{ background: labelOf(layer) }} />
                    <span className="w-[20px] shrink-0 text-center text-[11px] tabular-nums text-[var(--text-faint)]">{i + 1}</span>
                    <span className={`min-w-0 flex-1 truncate pl-1 ${on ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`} title={layer.title}
                      style={{ paddingLeft: 4 + (layer.depth ?? 0) * 12 }}
                      onDoubleClick={() => p.onOpen?.(layer)}>{layer.title || layer.clipId}</span>
                    {moving ? <svg className="mr-1 shrink-0" width="7" height="7" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 11 6 6 11 1 6Z" fill="var(--tl-accent)" /></svg> : null}
                    <button type="button" aria-label={t('canvas.layerAdd')} title={t('canvas.layerAdd')} data-layer-add={layer.clipId}
                      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => openMenu(e)}
                      className={`mr-1 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] ${menu?.layer.clipId === layer.clipId ? 'opacity-100' : 'opacity-0 group-hover/layer:opacity-100'}`}>
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
                    <span className="relative mr-1 shrink-0" style={{ width: MODE_W - 6 }}>
                      <select aria-label={t('canvas.motionMode')} value={host.blend} data-layer-mode={layer.clipId}
                        onPointerDown={(e) => e.stopPropagation()} onChange={(e) => host.setBlend(e.target.value)}
                        className={`h-[18px] w-full appearance-none truncate rounded-[4px] bg-transparent pl-1.5 pr-4 text-[11px] outline-none hover:bg-[var(--bg-hover)] ${host.blend === 'normal' ? 'text-[var(--text-faint)]' : 'text-[var(--text)]'}`}>
                        {BLEND_MODES.map((mode) => <option key={mode} value={mode}>{t(`inspector.blendModes.${mode}`)}</option>)}
                      </select>
                      <ChevronDown size={10} className="pointer-events-none absolute right-1 top-[4px] text-[var(--text-faint)]" />
                    </span>
                    {hasParents ? (
                      <span className="shrink-0 truncate pr-1 text-[11px] text-[var(--text-faint)]" style={{ width: PARENT_W }} title={layer.parent}>{layer.parent ?? t('canvas.motionNone')}</span>
                    ) : null}
                  </div>
                  <div className="relative" style={{ width: timeW }} onPointerDown={(e) => { if (e.button === 0) onPick(layer.clipId, e.shiftKey || e.metaKey || e.ctrlKey); }}>
                    <div data-layer-bar={layer.clipId}
                      className={`group/bar absolute inset-y-[3px] rounded-[3px] ${p.onMoveLayer ? 'cursor-grab' : ''}`}
                      style={{
                        left: startMs * pxPerMs, width: Math.max(4, (endMs - startMs) * pxPerMs),
                        background: `color-mix(in srgb, ${labelOf(layer)} ${on ? 70 : 42}%, transparent)`,
                        boxShadow: on ? 'inset 0 0 0 1px rgba(255,255,255,0.75)' : 'inset 0 0 0 1px rgba(255,255,255,0.08)',
                        opacity: host.visible === false ? 0.4 : 1,
                      }}
                      onPointerDown={(e) => pressBar(e, layer, 'move')}
                      onDoubleClick={() => p.onOpen?.(layer)}>
                      {p.onTrimLayer ? (
                        <>
                          <span className="absolute inset-y-0 left-0 w-[6px] cursor-ew-resize rounded-l-[3px] hover:bg-white/40" data-layer-in={layer.clipId} onPointerDown={(e) => pressBar(e, layer, 'start')} />
                          <span className="absolute inset-y-0 right-0 w-[6px] cursor-ew-resize rounded-r-[3px] hover:bg-white/40" data-layer-out={layer.clipId} onPointerDown={(e) => pressBar(e, layer, 'end')} />
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
                {lanes?.rows.length ? (
                  <>
                    {group('transform', t('inspector.transform'))}
                    {isOpen('transform') ? rowsOf(lanes, lanes.rows.map((row) => (isThree(row.prop) && host.three
                      ? <EffectHead key={row.prop} layer={layer} lanes={lanes} fx={row.prop as EffectProp} host={{ ...host, effects: host.three.model, commitEffects: host.three.commit }} t={t} />
                      : <PropertyHead key={row.prop} layer={layer} lanes={lanes} prop={row.prop as MotionProp} host={host} t={t} />))) : null}
                  </>
                ) : null}
                {fxLanes && fxOn.length ? (
                  <div data-effects-group={layer.clipId}>
                    {group('fx', t('canvas.fxGroup'), FILTER_EFFECTS.some((fx) => !fxOn.includes(fx)) ? (
                      <button type="button" aria-label={t('canvas.fxAdd')} title={t('canvas.fxAdd')} data-effect-add={layer.clipId}
                        onPointerDown={(e) => e.stopPropagation()} onClick={(e) => openMenu(e, 'fx')}
                        className="grid h-[16px] w-[16px] place-items-center rounded-[3px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
                        <Plus size={12} />
                      </button>
                    ) : null)}
                    {isOpen('fx') && fxLanes.rows.length ? rowsOf(fxLanes, fxLanes.rows.map((row) => (
                      <EffectHead key={row.prop} layer={layer} lanes={fxLanes} fx={row.prop as EffectProp} host={host} t={t} />
                    ))) : null}
                  </div>
                ) : null}
                {all && fxShown && stroke?.on ? (
                  <div data-shape-group={layer.clipId}>
                    {group('shape', t('canvas.shapeGroup'), null, () => stroke.commit(stroke.model.remove('trim')))}
                    {isOpen('shape') ? (() => {
                      const rows = { ...all, rows: all.rows.filter((r) => r.prop === 'trim') };
                      return rows.rows.length ? rowsOf(rows, <EffectHead layer={layer} lanes={rows} fx="trim" host={{ ...host, effects: stroke.model, commitEffects: stroke.commit }} t={t} />) : null;
                    })() : null}
                  </div>
                ) : null}
                {fxShown && text && text.anim !== undefined ? (
                  <TextGroup layer={layer} host={text} head={head} headW={headW} timeW={timeW} pxPerMs={pxPerMs} open={isOpen('text')}
                    title={group('text', t('canvas.textGroup'), text.anim === null ? <span className="text-[11px] text-[var(--text-faint)]">{t('canvas.textCustom')}</span> : (
                      <select aria-label={t('canvas.textAnimate')} value={text.anim.preset} data-text-preset={layer.clipId} className={SELECT}
                        onPointerDown={(e) => e.stopPropagation()} onChange={(e) => text.set(textAnimDefault(e.target.value as TextPreset, text.anim))}>
                        {TEXT_PRESETS.map((x) => <option key={x} value={x}>{t(`canvas.textPresets.${x}`)}</option>)}
                      </select>
                    ), text.anim === null ? undefined : () => text.set(null))} t={t} />
                ) : null}
                {all && fxShown && mk?.shape ? (() => {
                  const masks = mk.model ? maskLanes(all, mk, {
                    picked: maskPick?.id === layer.clipId ? maskPick.keys : new Set(),
                    onPick: (ids, mode) => setMaskPick((was) => {
                      const base = was?.id === layer.clipId ? was.keys : new Set<string>();
                      if (mode === 'set') return { id: layer.clipId, keys: new Set(ids) };
                      const next = new Set(base);
                      for (const id of ids) { if (mode === 'toggle' && next.has(id)) next.delete(id); else next.add(id); }
                      return { id: layer.clipId, keys: next };
                    }),
                    onMove: (dt) => { maskKeysRun({ move: dt }); },
                    onMenu: (e) => setMaskMenu({ x: e.clientX, y: e.clientY }),
                  }) : null;
                  return (
                    <div data-masks-group={layer.clipId}>
                      {group('mask', t('inspector.mask'), (
                        <>
                          <select aria-label={t('inspector.maskShape')} value={mk.shape} data-mask-shape={layer.clipId} className={SELECT}
                            onPointerDown={(e) => e.stopPropagation()} onChange={(e) => mk.setShape(e.target.value as MaskShape)}>
                            {MASK_SHAPES.map((shape) => <option key={shape} value={shape}>{t(`inspector.maskShapes.${shape}`)}</option>)}
                          </select>
                          <label className="flex items-center gap-1 text-[11px]" onPointerDown={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={mk.invert} onChange={(e) => mk.setInvert(e.target.checked)} data-mask-invert={layer.clipId} />
                            {t('inspector.maskInvert')}
                          </label>
                        </>
                      ), () => mk.setShape(null))}
                      {isOpen('mask') && masks ? rowsOf(masks, masks.rows.map((row) => (
                        <MaskHead key={row.prop} layer={layer} lanes={masks} param={maskParamOf(row.prop)} mask={mk} t={t} />
                      ))) : null}
                    </div>
                  );
                })() : null}
              </div>
            );
          })}
          <div style={{ height: 24 }} />
          {/* the playhead, over the ruler and every layer */}
          <div className="pointer-events-none absolute bottom-0 top-0 z-[15] w-px bg-[#4ea1ff]" style={{ left: headW + playheadMs * pxPerMs }} />
        </div>
      </div>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} /> : null}
      {maskMenu ? (
        <ContextMenu x={maskMenu.x} y={maskMenu.y} dense onClose={() => setMaskMenu(null)} items={[
          ...([['easy', 'ease-in-out', 'F9'], ['easy-in', 'ease-in', '⇧F9'], ['easy-out', 'ease-out', '⌘⇧F9'], ['linear', 'linear', ''], ['hold', 'hold', '']] as const)
            .map(([id, label, shortcut]) => ({ id, label: t(`inspector.eases.${label}`), ...(shortcut ? { shortcut } : {}), onSelect: () => { maskKeysRun(id); } })),
          { id: 'sep', separator: true },
          { id: 'delete', label: t('inspector.keyRemove'), shortcut: '⌫', danger: true, onSelect: () => { maskKeysRun('delete'); } },
        ]} />
      ) : null}
      {/* the time's zoom, under the layers as there */}
      <div className="flex h-[24px] shrink-0 items-center gap-2 border-t border-[var(--dock-line)] px-2 text-[var(--text-faint)]">
        <span className="text-[10.5px]" style={{ width: headW - 16 }}>{t('canvas.motionZoom')}</span>
        <input type="range" aria-label={t('canvas.motionZoom')} min={0} max={100} value={Math.round((Math.log(zoom) / Math.log(40)) * 100)}
          onChange={(e) => setZoom(40 ** (Number(e.target.value) / 100))} className="w-[160px]" data-motion-zoom="" />
      </div>
    </div>
  );
}

/**
 * A text layer's Animate group, as an animation editor's text animator: a preset of how each part comes in, the
 * parts (characters, words, lines), their order, when the first starts, how far apart, how long each; its turns drawn
 * on the time from the start.
 */
function TextGroup({ layer, host, head, headW, timeW, pxPerMs, open, title, t }: {
  layer: Layer; host: NonNullable<LayerHost['text']>; head: string; headW: number; timeW: number; pxPerMs: number; open: boolean; title: React.ReactElement; t: (key: string) => string;
}) {
  const anim = host.anim;
  const sel = SELECT;
  const set = (part: Partial<TextAnim>) => { if (anim) host.set({ ...anim, ...part }); };
  return (
    <div data-text-group={layer.clipId}>
      {/* its head, its turns drawn on the time from the start */}
      <div className="relative">
        {title}
        {anim ? <div className="pointer-events-none absolute inset-y-[6px] rounded-[2px] bg-[#d0706f]/50" style={{ left: headW + anim.start * 1000 * pxPerMs, width: Math.max(3, anim.secs * 1000 * pxPerMs) }} /> : null}
      </div>
      {anim && open ? (
        <div className="flex" style={{ height: 22 }}>
          <div className={`${head} flex items-center gap-1.5 overflow-hidden border-r border-[var(--dock-line)] text-[11px] text-[var(--text-muted)]`} style={{ width: headW, paddingLeft: AV_W + 34 }}>
            <select aria-label={t('canvas.textDir')} value={anim.dir ?? 'in'} className={`${sel} w-[58px]`} data-text-dir={layer.clipId} onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                const dir = e.target.value as 'in' | 'out';
                /* going out: near the end of the page, where a line leaves */
                set(dir === 'out' ? { dir, start: Math.max(0, Math.round((layer.endMs / 1000 - anim.secs - 0.6) * 100) / 100) } : { dir: undefined, start: 0 });
              }}>
              {(['in', 'out'] as const).map((d) => <option key={d} value={d}>{t(`canvas.textDirs.${d}`)}</option>)}
            </select>
            <select aria-label={t('canvas.textBy')} value={anim.by} className={`${sel} w-[64px]`} onPointerDown={(e) => e.stopPropagation()} onChange={(e) => set({ by: e.target.value as TextAnim['by'] })}>
              {(['char', 'word', 'line'] as const).map((b) => <option key={b} value={b}>{t(`canvas.textBys.${b}`)}</option>)}
            </select>
            <select aria-label={t('canvas.textOrder')} value={anim.order} className={`${sel} w-[72px]`} onPointerDown={(e) => e.stopPropagation()} onChange={(e) => set({ order: e.target.value as TextAnim['order'] })}>
              {(['forward', 'reverse', 'center', 'random'] as const).map((o) => <option key={o} value={o}>{t(`canvas.textOrders.${o}`)}</option>)}
            </select>
            <span className="text-[var(--text-faint)]">{t('canvas.textStart')}</span>
            <Scrub label={t('canvas.textStart')} value={anim.start} unit="s" step={0.01} digits={2} onCommit={(n) => set({ start: Math.max(0, n) })} />
            <span className="text-[var(--text-faint)]">{t('canvas.textStagger')}</span>
            <Scrub label={t('canvas.textStagger')} value={anim.stagger} unit="s" step={0.002} digits={3} onCommit={(n) => set({ stagger: Math.max(0, n) })} />
            <span className="text-[var(--text-faint)]">{t('canvas.textSecs')}</span>
            <Scrub label={t('canvas.textSecs')} value={anim.secs} unit="s" step={0.01} digits={2} onCommit={(n) => set({ secs: Math.max(0.01, n) })} />
          </div>
          <div style={{ width: timeW }} />
        </div>
      ) : null}
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
        onCommit={(n) => host.commitEffects(model.set(fx, EFFECTS[fx].unit === 'deg' ? n : fx === 'trim' ? Math.min(100, Math.max(0, n)) : Math.max(0, n)))} />
      {isThree(fx) ? null : <button type="button" aria-label={t('canvas.fxRemove')} title={t('canvas.fxRemove')} data-effect-remove={`${layer.clipId}:${fx}`}
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
