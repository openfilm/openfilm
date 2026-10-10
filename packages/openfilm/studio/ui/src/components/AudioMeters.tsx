/**
 * The audio meters, as Premiere's: the film's sound as it plays, left and right, peak (the light bar, with a mark that
 * holds the loudest of late) and RMS (the solid bar inside it), on a dBFS scale. A channel that reached 0 dBFS lights
 * its clip light at the top until it is clicked.
 *
 * Drawn on a canvas once a frame while the film plays, from the player's mix (editor/player.ts levels); paused, the
 * bars fall back and then nothing runs at all.
 */
import * as React from 'react';

import { useT } from '@/i18n';
import {
  channelLevel, fallTo, formatDb, holdPeak, meterPosition, METER_FLOOR_DB, METER_MARKS, type HeldPeak,
} from '@/lib/audio-levels';
import type { MixSamples } from '@/editor/player';

/** How wide the meters are, px: two bars and their scale. */
export const METERS_W = 44;

const CLIP_H = 7;
const TOP = CLIP_H + 5;
const BOTTOM = 6;
const BAR_W = 6;
const BAR_GAP = 2;
const BARS_X = 4;

/** The bar's colors along the scale: green, yellow from −18 dB, red from −6 dB. */
function paint(ctx: CanvasRenderingContext2D, top: number, height: number, alpha: number) {
  const g = ctx.createLinearGradient(0, top + height, 0, top);
  const at = (db: number) => meterPosition(db);
  g.addColorStop(0, `rgba(63,191,111,${alpha})`);
  g.addColorStop(at(-18), `rgba(63,191,111,${alpha})`);
  g.addColorStop(at(-17), `rgba(232,197,71,${alpha})`);
  g.addColorStop(at(-7), `rgba(232,197,71,${alpha})`);
  g.addColorStop(at(-6), `rgba(229,72,77,${alpha})`);
  g.addColorStop(1, `rgba(229,72,77,${alpha})`);
  return g;
}

type Shown = { peak: number; rms: number; held: HeldPeak & { shown: number } };
const quiet = (): Shown => ({ peak: METER_FLOOR_DB, rms: METER_FLOOR_DB, held: { db: METER_FLOOR_DB, at: 0, shown: METER_FLOOR_DB } });

export function AudioMeters({ levels, playing }: {
  /** The mix's latest samples, or null when nothing plays (see Player.levels). */
  levels: () => MixSamples | null;
  playing: boolean;
}) {
  const t = useT();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const shown = React.useRef<[Shown, Shown]>([quiet(), quiet()]);
  const [clipped, setClipped] = React.useState<[boolean, boolean]>([false, false]);
  const clippedRef = React.useRef(clipped);
  clippedRef.current = clipped;
  const [size, setSize] = React.useState({ w: METERS_W, h: 0 });
  const [peakText, setPeakText] = React.useState(METER_FLOOR_DB);

  React.useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  /** One picture of the bars and the scale. */
  const draw = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.h <= TOP + BOTTOM) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size.w * dpr) || canvas.height !== Math.round(size.h * dpr)) {
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const h = size.h - TOP - BOTTOM;
    const y = (db: number) => TOP + h * (1 - meterPosition(db));
    const styles = getComputedStyle(canvas);
    const faint = styles.getPropertyValue('--tl-faint').trim() || 'rgba(128,128,128,0.6)';
    const lane = styles.getPropertyValue('--tl-lane').trim() || 'rgba(128,128,128,0.15)';
    /* the scale: a line and a number every 6 dB, a number every 12 */
    ctx.font = '8px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const scaleX = BARS_X + 2 * BAR_W + BAR_GAP + 3;
    for (const mark of METER_MARKS) {
      const my = Math.round(y(mark)) + 0.5;
      ctx.fillStyle = faint;
      ctx.fillRect(scaleX, my, 3, 1);
      if (mark % 12 === 0) ctx.fillText(String(Math.abs(mark)), scaleX + 5, my);
    }
    shown.current.forEach((ch, i) => {
      const x = BARS_X + i * (BAR_W + BAR_GAP);
      ctx.fillStyle = lane;
      ctx.fillRect(x, TOP, BAR_W, h);
      /* peak: the light bar; RMS: the solid one */
      ctx.fillStyle = paint(ctx, TOP, h, 0.45);
      ctx.fillRect(x, y(ch.peak), BAR_W, TOP + h - y(ch.peak));
      ctx.fillStyle = paint(ctx, TOP, h, 1);
      ctx.fillRect(x, y(ch.rms), BAR_W, TOP + h - y(ch.rms));
      if (ch.held.shown > METER_FLOOR_DB) {
        ctx.fillStyle = ch.held.shown >= -6 ? '#e5484d' : ch.held.shown >= -18 ? '#e8c547' : '#d9f2e2';
        ctx.fillRect(x, Math.round(y(ch.held.shown)), BAR_W, 2);
      }
    });
  }, [size]);

  React.useEffect(() => { draw(); }, [draw]);

  /* while playing (and while the bars fall back after), once a frame; nothing otherwise */
  React.useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      const samples = playing ? levels() : null;
      let moving = false;
      const clips: [boolean, boolean] = [...clippedRef.current];
      shown.current = shown.current.map((ch, i) => {
        const level = samples ? channelLevel(samples[i as 0 | 1]) : { peakDb: METER_FLOOR_DB, rmsDb: METER_FLOOR_DB, clipped: false };
        if (level.clipped) clips[i] = true;
        /* stopped, the bars drop four times as fast: what is left of them says nothing */
        const fall = samples ? dt : dt * 4;
        const next: Shown = {
          peak: fallTo(ch.peak, level.peakDb, fall),
          rms: fallTo(ch.rms, level.rmsDb, fall),
          held: holdPeak(ch.held, level.peakDb, now),
        };
        if (next.peak > METER_FLOOR_DB || next.held.shown > METER_FLOOR_DB) moving = true;
        return next;
      }) as [Shown, Shown];
      if (clips[0] !== clippedRef.current[0] || clips[1] !== clippedRef.current[1]) setClipped(clips);
      draw();
      if (playing || moving) frame = requestAnimationFrame(tick);
      else setPeakText(METER_FLOOR_DB);
    };
    frame = requestAnimationFrame(tick);
    /* the readout: the loudest held peak, a few times a second (a number that changes every frame cannot be read) */
    const readout = playing ? window.setInterval(() => setPeakText(Math.max(shown.current[0].held.shown, shown.current[1].held.shown)), 250) : 0;
    return () => { cancelAnimationFrame(frame); window.clearInterval(readout); };
  }, [playing, levels, draw]);

  const clipLabel = t('editorTools.metersClip');
  return (
    <div
      className="flex h-full shrink-0 flex-col border-l"
      style={{ width: METERS_W, borderColor: 'var(--tl-line)', background: 'var(--tl-head)' }}
      data-audio-meters=""
      aria-label={t('editorTools.meters')}
      role="group"
    >
      <div className="flex h-[34px] shrink-0 items-center justify-center font-mono text-[9px] tabular-nums" style={{ color: peakText >= -0.05 ? '#e5484d' : 'var(--tl-faint)' }}
        title={t('editorTools.metersPeak')}>
        {formatDb(peakText)}
      </div>
      <div ref={boxRef} className="relative min-h-0 flex-1">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ width: size.w, height: size.h }} />
        {/* the clip lights: lit when a channel reached 0 dBFS; a click puts them out */}
        {([0, 1] as const).map((i) => (
          <button
            key={i}
            type="button"
            aria-label={`${clipLabel} (${i ? 'R' : 'L'})`}
            title={clipLabel}
            data-meter-clip={clipped[i] ? '1' : '0'}
            onClick={() => setClipped([false, false])}
            className="absolute top-0 rounded-[1px]"
            style={{
              left: BARS_X + i * (BAR_W + BAR_GAP),
              width: BAR_W,
              height: CLIP_H,
              background: clipped[i] ? '#e5484d' : 'var(--tl-lane)',
            }}
          />
        ))}
      </div>
    </div>
  );
}
