/**
 * The audio meters: the film's sound as it plays, left and right, peak (the light bar, with a mark that
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
import { useThemeChanges } from '@/lib/theme-changes';
import { mediaButton } from './player-controls/MediaButtons';

export const AUDIO_METERS_WIDTH = 44;
const OVERVIEW_W = 18;
const OVERVIEW_H = 14;
const SEGMENT_LEVELS = [-48, -36, -24, -18, -6] as const;
const METER_GREEN = '#63816e';
const METER_AMBER = '#927d52';
const METER_RED = '#a66365';
const METER_CLIP = '#ba7371';

const CLIP_H = 7;
const TOP = CLIP_H + 5;
const BOTTOM = 6;
const BAR_W = 6;
const BAR_GAP = 2;
const BARS_X = 4;

const levelColor = (db: number) => db >= -6 ? METER_RED : db >= -18 ? METER_AMBER : METER_GREEN;

/** The bar's colors along the scale: green, amber from −18 dB, red from −6 dB. */
function paint(ctx: CanvasRenderingContext2D, top: number, height: number) {
  const g = ctx.createLinearGradient(0, top + height, 0, top);
  const at = (db: number) => meterPosition(db);
  g.addColorStop(0, METER_GREEN);
  g.addColorStop(at(-19), METER_GREEN);
  g.addColorStop(at(-18), METER_AMBER);
  g.addColorStop(at(-7), METER_AMBER);
  g.addColorStop(at(-6), METER_RED);
  g.addColorStop(1, METER_RED);
  return g;
}

type Shown = { peak: number; rms: number; held: HeldPeak & { shown: number } };
const quiet = (): Shown => ({ peak: METER_FLOOR_DB, rms: METER_FLOOR_DB, held: { db: METER_FLOOR_DB, at: 0, shown: METER_FLOOR_DB } });

function meterCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const dpr = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

function drawOverview(canvas: HTMLCanvasElement, channels: [Shown, Shown]) {
  const ctx = meterCanvas(canvas, OVERVIEW_W, OVERVIEW_H);
  if (!ctx) return;
  const idle = document.documentElement.dataset.theme === 'dark' ? '#2e2e2e' : '#c5c5c5';
  channels.forEach(({ peak }, channel) => {
    SEGMENT_LEVELS.forEach((db, i) => {
      ctx.fillStyle = peak < db ? idle : levelColor(db);
      ctx.beginPath();
      ctx.roundRect(channel * 10, 1 + (SEGMENT_LEVELS.length - i - 1) * 2.5, 8, 2, 0.5);
      ctx.fill();
    });
  });
}

export function AudioMeters({ levels, playing, onMenu, menuOpen = false, menuTrigger, vertical = false }: {
  /** The mix's latest samples, or null when nothing plays (see Player.levels). */
  levels: () => MixSamples | null;
  playing: boolean;
  onMenu: React.MouseEventHandler;
  menuOpen?: boolean;
  menuTrigger?: React.Ref<HTMLButtonElement>;
  vertical?: boolean;
}) {
  const t = useT();
  const overviewRef = React.useRef<HTMLCanvasElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const detailSize = React.useRef({ width: 0, height: 0 });
  const detailResize = React.useRef<ResizeObserver | null>(null);
  const shown = React.useRef<[Shown, Shown]>([quiet(), quiet()]);
  const [clipped, setClipped] = React.useState<[boolean, boolean]>([false, false]);
  const clippedRef = React.useRef(clipped);
  clippedRef.current = clipped;
  const [peakText, setPeakText] = React.useState(METER_FLOOR_DB);

  const drawDetail = React.useCallback((canvas: HTMLCanvasElement) => {
    const { width, height } = detailSize.current;
    if (width <= 0 || height <= TOP + BOTTOM) return;
    const ctx = meterCanvas(canvas, width, height);
    if (!ctx) return;
    const h = height - TOP - BOTTOM;
    const y = (db: number) => TOP + h * (1 - meterPosition(db));
    const styles = getComputedStyle(canvas);
    const faint = styles.getPropertyValue('--text-faint').trim() || 'rgba(128,128,128,0.6)';
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
    const gradient = paint(ctx, TOP, h);
    shown.current.forEach((ch, i) => {
      const x = BARS_X + i * (BAR_W + BAR_GAP);
      ctx.fillStyle = lane;
      ctx.fillRect(x, TOP, BAR_W, h);
      /* peak: the light bar; RMS: the solid one */
      ctx.fillStyle = gradient;
      ctx.globalAlpha = 0.36;
      ctx.fillRect(x, y(ch.peak), BAR_W, TOP + h - y(ch.peak));
      ctx.globalAlpha = 1;
      ctx.fillRect(x, y(ch.rms), BAR_W, TOP + h - y(ch.rms));
      if (ch.held.shown > METER_FLOOR_DB) {
        ctx.fillStyle = ch.held.shown >= -18 ? levelColor(ch.held.shown) : '#91a097';
        ctx.fillRect(x, Math.round(y(ch.held.shown)), BAR_W, 2);
      }
    });
  }, []);

  const setDetailCanvas = React.useCallback((canvas: HTMLCanvasElement | null) => {
    detailResize.current?.disconnect();
    detailResize.current = null;
    canvasRef.current = canvas;
    if (!canvas) return;
    detailResize.current = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      detailSize.current = { width, height };
      drawDetail(canvas);
    });
    detailResize.current.observe(canvas);
    detailSize.current = { width: canvas.clientWidth, height: canvas.clientHeight };
    drawDetail(canvas);
  }, [drawDetail]);

  const draw = React.useCallback(() => {
    if (overviewRef.current) drawOverview(overviewRef.current, shown.current);
    if (canvasRef.current) drawDetail(canvasRef.current);
  }, [drawDetail]);

  /* its colors are the theme's, read as it draws: when the theme changes it draws again, or it would keep the old
     theme's bars until the film plays */
  const theme = useThemeChanges();
  React.useEffect(() => { draw(); }, [draw, theme]);

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
    return () => cancelAnimationFrame(frame);
  }, [playing, levels, draw]);

  React.useEffect(() => {
    if (!vertical) return;
    const read = () => setPeakText(Math.max(shown.current[0].held.shown, shown.current[1].held.shown));
    read();
    if (!playing) return;
    const readout = window.setInterval(read, 250);
    return () => window.clearInterval(readout);
  }, [vertical, playing]);

  if (!vertical) {
    return (
      <button ref={menuTrigger} type="button" className={mediaButton(menuOpen, OVERVIEW_W)}
        aria-label={t('editorTools.meters')} aria-haspopup="menu" aria-expanded={menuOpen}
        onClick={onMenu} onContextMenu={onMenu}>
        <canvas ref={overviewRef} width={OVERVIEW_W} height={OVERVIEW_H}
          style={{ width: OVERVIEW_W, height: OVERVIEW_H }} aria-hidden="true" />
      </button>
    );
  }

  const clipLabel = t('editorTools.metersClip');
  return (
    <div
      className="flex h-full flex-col border-l border-[var(--border)] bg-[var(--bg-panel)]"
      style={{ width: AUDIO_METERS_WIDTH }}
      data-audio-meters="timeline" role="group" aria-label={t('editorTools.meters')}
      onContextMenu={onMenu}
    >
      <div className="flex h-[34px] shrink-0 items-center justify-center font-mono text-[9px] tabular-nums"
        style={{ color: peakText >= -0.05 ? METER_CLIP : 'var(--text-faint)' }}>
        <span className="sr-only">{t('editorTools.metersPeak')} </span>
        {formatDb(peakText)}
      </div>
      <div className="relative min-h-0 flex-1">
        <canvas ref={setDetailCanvas} className="absolute inset-0 h-full w-full" aria-hidden="true" />
        {([0, 1] as const).map((i) => (
          <button
            key={i}
            type="button"
            aria-label={`${clipLabel} (${i ? 'R' : 'L'})`}
            data-meter-clip={clipped[i] ? '1' : '0'}
            onClick={() => setClipped([false, false])}
            className="absolute top-0 rounded-[1px]"
            style={{
              left: BARS_X + i * (BAR_W + BAR_GAP),
              width: BAR_W,
              height: CLIP_H,
              background: clipped[i] ? METER_CLIP : 'var(--tl-lane)',
            }}
          />
        ))}
      </div>
    </div>
  );
}
