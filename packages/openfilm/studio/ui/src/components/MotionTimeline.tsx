/**
 * The film as an animation editor lays out a composition, in its timeline panel's arrangement: the current time big
 * at the top left; a row per picture clip (a layer), the topmost first, with its label color, its number, its name and
 * its blending mode; its bar on the right, dragged to move it in time and by its ends
 * to trim it. A layer twirls open (▸) to its Transform: position, scale, rotation and opacity, each with the keyframe
 * navigator in the switches' column, a stopwatch, its value in blue (dragged left and right, or clicked and typed),
 * and its keyframes on its row (components/MotionLanes), or the graph.
 *
 * As there: P, S, R and T show only that property of the picked layers (⇧: added to what shows), U the ones that
 * move, the same key again closes them; J and K go to the keyframe before and after the playhead among what shows.
 * The work area (the film's marked range) is the bar over the ruler; the slider under the layers zooms the time.
 */
import * as React from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, X } from 'lucide-react';
import { EFFECTS, EFFECT_PROPS, MOTION_PROPS, type EffectProp, type KeyedProp, type MotionProp } from '../../../../src/clip-motion.mjs';
import type { effectsModel, EffectsChange } from '@/lib/motion-keys';
import type { FilmRange } from '@/lib/studio-refs';
import { BLEND_MODES } from '@/lib/clip-look';
import { formatTimecode } from '@/lib/timecode';
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
const FX_STEP: Record<EffectProp, number> = { blur: 0.1, brightness: 0.5, contrast: 0.5, saturate: 0.5, hue: 0.5, grayscale: 0.5, glow: 0.1 };
/** A layer's label color by what it is, as an animation editor gives each kind its own. */
const LABEL: Record<string, string> = { video: '#4ca3ad', mg: '#a594d6', still: '#c7a35f', text: '#d0706f', image: '#c7a35f', shape: '#5b8fd6', box: '#8c9a6b', group: '#8a8f98' };
const labelOf = (layer: Layer) => LABEL[layer.kind] ?? '#8a8f98';

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
function Scrub({ value, onCommit, step = 1, digits = 1, unit, disabled, label }: {
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
  const live = React.useRef({ layers, picked, shown, playheadMs, lanesOf });
  live.current = { layers, picked, shown, playheadMs, lanesOf };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const now = live.current;
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
  }, [onSeek]);

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
            const lanes = all && props ? { ...all, rows: all.rows.filter((r) => isTransform(r.prop) && props.includes(r.prop)) } : null;
            /* its Effects group: all of them, or those asked for by name (U) */
            const fxShown = Boolean(props && (props.includes('fx') || props.some((x) => x !== 'fx' && !isTransform(x))));
            const fxLanes = all && props && fxShown
              ? { ...all, rows: all.rows.filter((r) => !isTransform(r.prop) && (props.includes('fx') || props.includes(r.prop))) }
              : null;
            const on = picked.includes(layer.clipId);
            const host = hostOf(layer);
            const moving = lanesOf(layer).rows.some((r) => r.keys.length);
            const drag = barDrag?.id === layer.clipId ? barDrag : null;
            const startMs = layer.startMs + (drag && drag.kind !== 'end' ? drag.dms : 0);
            const endMs = layer.endMs + (drag && drag.kind !== 'start' ? drag.dms : 0);
            const tint = on ? 'bg-[color-mix(in_srgb,var(--tl-accent)_14%,var(--dock-pane))]' : 'bg-[var(--dock-pane)]';
            return (
              <div key={layer.clipId} data-motion-layer={layer.clipId} className="border-b border-[var(--dock-line)]">
                <div className="flex" style={{ height: LAYER_H }}>
                  <div className={`sticky left-0 z-10 flex shrink-0 items-center border-r border-[var(--dock-line)] ${tint}`} style={{ width: headW }}
                    onPointerDown={(e) => { if (e.button === 0) onPick(layer.clipId, e.shiftKey || e.metaKey || e.ctrlKey); }}>
                    <span className="flex shrink-0 items-center pl-1" style={{ width: AV_W }}>
                      {host.setVisible ? (
                        <button type="button" aria-label={t('canvas.motionVisible')} aria-pressed={host.visible} data-layer-eye={layer.clipId}
                          onPointerDown={(e) => e.stopPropagation()} onClick={() => host.setVisible?.(!host.visible)}
                          className="grid h-[18px] w-[18px] place-items-center rounded-[3px] text-[var(--text-muted)] hover:bg-white/10">
                          {host.visible ? <Eye size={12} /> : <EyeOff size={12} className="opacity-50" />}
                        </button>
                      ) : null}
                    </span>
                    <button type="button" aria-label={t('inspector.transform')} aria-expanded={Boolean(props)} data-twirl={layer.clipId}
                      onPointerDown={(e) => e.stopPropagation()} onClick={() => toggle(layer.clipId)}
                      className="grid h-[18px] w-[16px] shrink-0 place-items-center rounded-[3px] text-[var(--text-muted)] hover:bg-white/10">
                      {props ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                    <span className="mx-1 h-[10px] w-[10px] shrink-0 rounded-[2px]" style={{ background: labelOf(layer) }} />
                    <span className="w-[20px] shrink-0 text-center text-[11px] tabular-nums text-[var(--text-faint)]">{i + 1}</span>
                    <span className={`min-w-0 flex-1 truncate pl-1 ${on ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`} title={layer.title}
                      style={{ paddingLeft: 4 + (layer.depth ?? 0) * 12 }}
                      onDoubleClick={() => p.onOpen?.(layer)}>{layer.title || layer.clipId}</span>
                    {moving ? <svg className="mr-1 shrink-0" width="7" height="7" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 11 6 6 11 1 6Z" fill="var(--tl-accent)" /></svg> : null}
                    <select aria-label={t('canvas.motionMode')} value={host.blend} data-layer-mode={layer.clipId}
                      onPointerDown={(e) => e.stopPropagation()} onChange={(e) => host.setBlend(e.target.value)}
                      className="mr-1 h-[18px] shrink-0 rounded-[3px] border border-[var(--dock-line)] bg-transparent px-1 text-[11px] text-[var(--text-muted)]" style={{ width: MODE_W - 6 }}>
                      {BLEND_MODES.map((mode) => <option key={mode} value={mode}>{t(`inspector.blendModes.${mode}`)}</option>)}
                    </select>
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
                    {/* its Transform group, as the editor names it */}
                    <div className="flex" style={{ height: 20 }}>
                      <div className={`${head} flex items-center border-r border-[var(--dock-line)] text-[11.5px] text-[var(--text-muted)]`} style={{ width: headW, paddingLeft: AV_W + 18 }}>
                        <ChevronDown size={11} className="mr-1" /> {t('inspector.transform')}
                      </div>
                      <div style={{ width: timeW }} />
                    </div>
                    {lanes.rows.length ? (
                      <div className="flex" style={{ height: lanesHeight(lanes) }}>
                        <div className={`${head} border-r border-[var(--dock-line)]`} style={{ width: headW, paddingTop: LANE_PAD / 2 }}>
                          {lanes.graph ? <MotionLaneHeads lanes={lanes} /> : lanes.rows.map((row) => (
                            <PropertyHead key={row.prop} layer={layer} lanes={lanes} prop={row.prop as MotionProp} host={host} t={t} />
                          ))}
                        </div>
                        <div className="relative" style={{ width: timeW }}><MotionLaneRows lanes={lanes} top={0} pxPerMs={pxPerMs} /></div>
                      </div>
                    ) : null}
                  </>
                ) : null}
                {fxLanes && host.effects ? (
                  <>
                    {/* its Effects group: an effect added from the menu, each with its own row */}
                    <div className="flex" style={{ height: 22 }} data-effects-group={layer.clipId}>
                      <div className={`${head} flex items-center gap-2 border-r border-[var(--dock-line)] text-[11.5px] text-[var(--text-muted)]`} style={{ width: headW, paddingLeft: AV_W + 18 }}>
                        <span className="flex items-center"><ChevronDown size={11} className="mr-1" /> {t('canvas.fxGroup')}</span>
                        {host.effects.on.length < EFFECT_PROPS.length ? (
                          <select aria-label={t('canvas.fxAdd')} value="" data-effect-add={layer.clipId}
                            onPointerDown={(e) => e.stopPropagation()}
                            onChange={(e) => { const fx = e.target.value as EffectProp; if (fx) host.commitEffects(host.effects!.add(fx)); }}
                            className="h-[18px] rounded-[3px] border border-[var(--dock-line)] bg-transparent px-1 text-[11px] text-[var(--text-muted)]">
                            <option value="">{t('canvas.fxAdd')}</option>
                            {EFFECT_PROPS.filter((fx) => !host.effects!.on.includes(fx)).map((fx) => <option key={fx} value={fx}>{t(`canvas.fx.${fx}`)}</option>)}
                          </select>
                        ) : null}
                      </div>
                      <div style={{ width: timeW }} />
                    </div>
                    {fxLanes.rows.length ? (
                      <div className="flex" style={{ height: lanesHeight(fxLanes) }}>
                        <div className={`${head} border-r border-[var(--dock-line)]`} style={{ width: headW, paddingTop: LANE_PAD / 2 }}>
                          {fxLanes.graph ? <MotionLaneHeads lanes={fxLanes} /> : fxLanes.rows.map((row) => (
                            <EffectHead key={row.prop} layer={layer} lanes={fxLanes} fx={row.prop as EffectProp} host={host} t={t} />
                          ))}
                        </div>
                        <div className="relative" style={{ width: timeW }}><MotionLaneRows lanes={fxLanes} top={0} pxPerMs={pxPerMs} /></div>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            );
          })}
          <div style={{ height: 24 }} />
          {/* the playhead, over the ruler and every layer */}
          <div className="pointer-events-none absolute bottom-0 top-0 z-[15] w-px bg-[#4ea1ff]" style={{ left: headW + playheadMs * pxPerMs }} />
        </div>
      </div>
      {/* the time's zoom, under the layers as there */}
      <div className="flex h-[24px] shrink-0 items-center gap-2 border-t border-[var(--dock-line)] px-2 text-[var(--text-faint)]">
        <span className="text-[10.5px]" style={{ width: headW - 16 }}>{t('canvas.motionZoom')}</span>
        <input type="range" aria-label={t('canvas.motionZoom')} min={0} max={100} value={Math.round((Math.log(zoom) / Math.log(40)) * 100)}
          onChange={(e) => setZoom(40 ** (Number(e.target.value) / 100))} className="w-[160px]" data-motion-zoom="" />
      </div>
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
  const unit = EFFECTS[fx].unit === 'deg' ? '°' : EFFECTS[fx].unit;
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
      <span className="ml-1 w-[64px] shrink-0 truncate text-[var(--text-muted)]">{t(`canvas.fx.${fx}`)}</span>
      <Scrub label={t(`canvas.fx.${fx}`)} value={model.now(fx)} unit={unit} step={FX_STEP[fx]}
        onCommit={(n) => host.commitEffects(model.set(fx, EFFECTS[fx].unit === 'deg' ? n : Math.max(0, n)))} />
      <button type="button" aria-label={t('canvas.fxRemove')} title={t('canvas.fxRemove')} data-effect-remove={`${layer.clipId}:${fx}`}
        onClick={() => host.commitEffects(model.remove(fx))}
        className="ml-2 grid h-[16px] w-[16px] place-items-center rounded-[3px] text-[var(--text-faint)] opacity-0 hover:bg-white/10 hover:text-[var(--text)] group-hover/fx:opacity-100">
        <X size={11} />
      </button>
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
      <span className="ml-1 w-[64px] shrink-0 truncate text-[var(--text-muted)]">{t(PROP_LABEL[prop])}</span>
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
