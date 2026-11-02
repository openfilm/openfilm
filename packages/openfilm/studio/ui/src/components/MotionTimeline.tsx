/**
 * The film as an animation editor lays out a composition: every picture clip a layer, the topmost first, its bar over
 * the time it plays. A layer twirls open (▸) to its Transform: position, scale, rotation and opacity, each a row of
 * keyframes (components/MotionLanes) with its navigator, or the graph. As there, P, S, R and T show only that property
 * of the picked layers (⇧: added to what shows), U the ones that move, and the same key again closes them; J and K go
 * to the keyframe before and after the playhead among what shows. A click on a layer picks it, as on the timeline.
 */
import * as React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { MotionProp } from '../../../../src/clip-motion.mjs';
import type { TimelineBlock } from '@/lib/timeline-layout';
import { formatTimecode } from '@/lib/timecode';
import { MotionLaneHeads, MotionLaneRows, lanesHeight, type MotionLanes } from './MotionLanes';

type Layer = TimelineBlock & { clipId: string };

export interface MotionTimelineProps {
  /** The picture clips, the topmost first. */
  layers: readonly Layer[];
  totalMs: number;
  playheadMs: number;
  onSeek: (ms: number) => void;
  picked: readonly string[];
  onPick: (clipId: string, add: boolean) => void;
  lanesOf: (layer: Layer) => MotionLanes;
  labels: { transform: string; empty: string };
}

const HEAD_W = 248;
const LAYER_H = 26;
const RULER_H = 24;
/** The keys that show one property, as an animation editor's. */
const SOLO: Record<string, MotionProp> = { p: 'translate', s: 'scale', r: 'rotate', t: 'opacity' };
const ALL: readonly MotionProp[] = ['translate', 'scale', 'rotate', 'opacity'];

export function MotionTimeline({ layers, totalMs, playheadMs, onSeek, picked, onPick, lanesOf, labels }: MotionTimelineProps) {
  const host = React.useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState(800);
  React.useLayoutEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const timeW = Math.max(100, width - HEAD_W - 16);
  const pxPerMs = timeW / Math.max(totalMs, 1000);

  /* what each layer shows of its Transform (none: closed) */
  const [shown, setShown] = React.useState<ReadonlyMap<string, readonly MotionProp[]>>(new Map());
  const toggle = (id: string) => setShown((was) => {
    const next = new Map(was);
    if (next.has(id)) next.delete(id); else next.set(id, ALL);
    return next;
  });
  const lanesOfRef = React.useRef(lanesOf);
  lanesOfRef.current = lanesOf;
  const layersRef = React.useRef(layers);
  layersRef.current = layers;
  const pickedRef = React.useRef(picked);
  pickedRef.current = picked;
  const shownRef = React.useRef(shown);
  shownRef.current = shown;
  const playRef = React.useRef(playheadMs);
  playRef.current = playheadMs;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const targets = layersRef.current.filter((l) => pickedRef.current.includes(l.clipId));
      if (key in SOLO || key === 'u') {
        if (!targets.length) return;
        e.preventDefault();
        e.stopPropagation();
        setShown((was) => {
          const next = new Map(was);
          for (const layer of targets) {
            const moving = ALL.filter((p) => lanesOfRef.current(layer).rows.some((r) => r.prop === p && r.keys.length));
            const want: readonly MotionProp[] = key === 'u' ? moving : [SOLO[key]!];
            const had = next.get(layer.clipId) ?? [];
            const same = had.length === want.length && want.every((p) => had.includes(p));
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
        const from = targets.length ? targets : layersRef.current;
        const times = from.flatMap((layer) => {
          const props = shownRef.current.get(layer.clipId) ?? (targets.length ? ALL : []);
          return lanesOfRef.current(layer).rows.filter((r) => props.includes(r.prop)).flatMap((r) => r.keys.map((k) => layer.startMs + k.t * 1000));
        });
        const now = playRef.current;
        const to = key === 'j' ? Math.max(...times.filter((ms) => ms < now - 1)) : Math.min(...times.filter((ms) => ms > now + 1));
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

  return (
    <div ref={host} className="relative flex min-h-0 flex-1 flex-col overflow-hidden text-[12px]" data-motion-timeline="">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {/* the ruler, kept in sight */}
        <div className="sticky top-0 z-20 flex border-b border-[var(--dock-line)] bg-[var(--dock-pane)]" style={{ height: RULER_H }}>
          <div className="flex shrink-0 items-center px-2 text-[11px] text-[var(--text-faint)]" style={{ width: HEAD_W }}>{formatTimecode(playheadMs)}</div>
          <div className="relative cursor-ew-resize" style={{ width: timeW }} onPointerDown={scrub}>
            {ticks.map((ms) => (
              <div key={ms} className="absolute bottom-0 top-[10px] border-l border-[var(--text-faint)]/40 pl-1 text-[10px] leading-none text-[var(--text-faint)]" style={{ left: ms * pxPerMs }}>
                {tickLabel(ms)}
              </div>
            ))}
          </div>
        </div>
        {!layers.length ? <p className="p-4 text-[12px] text-[var(--text-faint)]">{labels.empty}</p> : null}
        {layers.map((layer, i) => {
          const props = shown.get(layer.clipId);
          const all = props ? lanesOf(layer) : null;
          const lanes = all && props ? { ...all, rows: all.rows.filter((r) => props.includes(r.prop)) } : null;
          const on = picked.includes(layer.clipId);
          const moving = all ? all.rows.some((r) => r.keys.length) : false;
          return (
            <div key={layer.clipId} data-motion-layer={layer.clipId} className="border-b border-[var(--dock-line)]">
              <div className={`flex ${on ? 'bg-[color-mix(in_srgb,var(--tl-accent)_14%,transparent)]' : ''}`} style={{ height: LAYER_H }}>
                <div className="flex shrink-0 cursor-default items-center gap-1 pl-1 pr-2" style={{ width: HEAD_W }}
                  onPointerDown={(e) => { if (e.button === 0) onPick(layer.clipId, e.shiftKey || e.metaKey || e.ctrlKey); }}>
                  <button type="button" aria-label={labels.transform} aria-expanded={Boolean(props)} data-twirl={layer.clipId}
                    onPointerDown={(e) => e.stopPropagation()} onClick={() => toggle(layer.clipId)}
                    className="grid h-[18px] w-[18px] place-items-center rounded-[3px] text-[var(--text-muted)] hover:bg-white/10">
                    {props ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                  <span className="w-[18px] shrink-0 text-right text-[11px] tabular-nums text-[var(--text-faint)]">{i + 1}</span>
                  <span className={`min-w-0 flex-1 truncate ${on ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`} title={layer.title}>{layer.title || layer.clipId}</span>
                  {moving ? <svg width="8" height="8" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 11 6 6 11 1 6Z" fill="var(--tl-accent)" /></svg> : null}
                </div>
                <div className="relative" style={{ width: timeW }}
                  onPointerDown={(e) => { if (e.button === 0) onPick(layer.clipId, e.shiftKey || e.metaKey || e.ctrlKey); }}>
                  <div className="absolute inset-y-[4px] rounded-[3px]"
                    style={{
                      left: layer.startMs * pxPerMs, width: Math.max(2, (layer.endMs - layer.startMs) * pxPerMs),
                      background: on ? 'color-mix(in srgb, var(--tl-accent) 55%, transparent)' : 'rgba(120,140,170,0.35)',
                      boxShadow: on ? 'inset 0 0 0 1px var(--tl-accent)' : 'inset 0 0 0 1px rgba(255,255,255,0.08)',
                    }} />
                </div>
              </div>
              {lanes && lanes.rows.length ? (
                <div className="flex" style={{ height: lanesHeight(lanes) }}>
                  <div className="shrink-0 pl-6" style={{ width: HEAD_W }}><MotionLaneHeads lanes={lanes} /></div>
                  <div className="relative" style={{ width: timeW }}><MotionLaneRows lanes={lanes} top={0} pxPerMs={pxPerMs} /></div>
                </div>
              ) : null}
            </div>
          );
        })}
        <div style={{ height: 24 }} />
      </div>
      {/* the playhead, over the ruler and every layer */}
      <div className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-[var(--tl-accent)]" style={{ left: HEAD_W + playheadMs * pxPerMs }} />
    </div>
  );
}
