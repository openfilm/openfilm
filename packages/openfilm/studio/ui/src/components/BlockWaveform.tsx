/**
 * The waveform on a clip. Without it a sound track is plain bars: no telling where someone speaks, where they breathe,
 * where it is silent — and "did this cut land mid-word" can only be seen on the waveform.
 *
 * Drawn from the bottom, not mirrored: sound rows are short, and a mirrored waveform leaves half the height each way.
 * A skyline still reads when low (CapCut draws it this way). On a canvas, not hundreds of divs: dozens of clips with
 * hundreds of peaks each would be tens of thousands of nodes.
 *
 * Peaks come from the server: GET media?what=wave&path= → `{ duration (s), peaks }`, 40 peaks a second, 0..1;
 * 503 while the file is still being written.
 */
import * as React from 'react';
import { normalizeWavePeaks, waveformColumns } from '@/lib/waveform-columns';

/** A sound's envelope: the whole file's peaks and its length (to turn peak indexes into ms). */
interface Wave {
  peaks: number[];
  durationMs: number;
}

/** Peaks per second the server sends; the length when the answer has none. */
const PEAKS_PER_SECOND = 40;

/** At most this many device pixels per canvas: past the browser's limit a canvas goes blank. */
const MAX_CANVAS_PX = 4096;

/** Waveforms already fetched: the same sound is drawn again on every drag and zoom. */
const CACHE = new Map<string, Wave>();
const PENDING = new Map<string, Promise<Wave | null>>();

/**
 * The waveform, asked again while the server says it is not ready yet (503: a file an agent has just written).
 * About half a minute at most; after that the block stays plain until its address changes.
 */
async function fetchWhenReady(url: string, tries = 30): Promise<Response> {
  const res = await fetch(url);
  if (res.status !== 503 || tries <= 1) return res;
  const wait = Math.min(Math.max(Number(res.headers.get('retry-after')) || 1, 0.5), 5) * 1000;
  await new Promise((done) => setTimeout(done, wait));
  return fetchWhenReady(url, tries - 1);
}

async function loadWave(url: string): Promise<Wave | null> {
  if (CACHE.has(url)) return CACHE.get(url) ?? null;
  const already = PENDING.get(url);
  if (already) return already;
  const task = fetchWhenReady(url)
    .then(async (r) => {
      if (!r.ok) return null;
      const body = (await r.json()) as { peaks?: number[]; duration?: number; durationMs?: number };
      if (!body.peaks?.length) return null;
      const durationMs = typeof body.durationMs === 'number' ? body.durationMs
        : typeof body.duration === 'number' ? body.duration * 1000
          : (body.peaks.length / PEAKS_PER_SECOND) * 1000;
      return { peaks: normalizeWavePeaks(body.peaks), durationMs };
    })
    .catch(() => null)
    .then((wave) => {
      if (wave) {
        CACHE.set(url, wave);
        while (CACHE.size > 256) CACHE.delete(CACHE.keys().next().value!);
      }
      PENDING.delete(url);
      return wave;
    });
  PENDING.set(url, task);
  return task;
}

export function BlockWaveform({
  url, width, height, color, inMs = 0, durMs, visiblePx,
}: {
  url: string;
  width: number;
  height: number;
  /**
   * The waveform's color; may be a CSS variable (`var(--tl-wave)`): a canvas cannot read variables, so it is set as
   * the element's `color` and read back computed, following the theme.
   */
  color: string;
  /**
   * Draw only this stretch (px within the clip). Zoomed in, a clip can be tens of thousands of pixels wide and only a
   * slice is on screen: a canvas over the whole clip would be stretched past the limit (blurry) or burn memory on what
   * cannot be seen.
   */
  visiblePx?: { from: number; to: number };
  /**
   * Where in the source the clip starts and how much it plays. The envelope is the whole file's; without taking off
   * the in point the whole file is squeezed into the clip and the waveform lies about where the sound is.
   */
  inMs?: number;
  durMs: number;
}): React.ReactElement | null {
  const ref = React.useRef<HTMLCanvasElement | null>(null);
  const [loaded, setLoaded] = React.useState(() => ({ url, wave: CACHE.get(url) ?? null }));
  // A new edit must never display the previous arrangement while its request is in flight.
  const wave = loaded.url === url ? loaded.wave : CACHE.get(url) ?? null;

  React.useEffect(() => {
    let alive = true;
    void loadWave(url).then((wave) => { if (alive) setLoaded({ url, wave }); });
    return () => { alive = false; };
  }, [url]);

  const from = Math.max(0, Math.min(width, Math.floor(visiblePx?.from ?? 0)));
  const to = Math.max(from, Math.min(width, Math.ceil(visiblePx?.to ?? width)));
  const sliceW = to - from;

  React.useEffect(() => {
    const el = ref.current;
    if (!el || !wave?.peaks.length || sliceW <= 0 || height <= 0) return undefined;
    /* drawn on the next frame, so a burst of zoom steps draws once (the stretched old bitmap holds meanwhile) */
    const frame = requestAnimationFrame(() => {
      /* capped in device pixels, not CSS pixels: capping CSS pixels would also drop Retina's 2×, and this layer is
         thin enough that blur makes it useless. Full ratio while it fits, down to 1× at the cap. */
      const drawW = Math.min(Math.round(sliceW), MAX_CANVAS_PX);
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, MAX_CANVAS_PX / drawW));
      el.width = Math.max(1, Math.round(drawW * dpr));
      el.height = Math.max(1, Math.round(height * dpr));
      const ctx = el.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, drawW, height);
      ctx.fillStyle = getComputedStyle(el).color || color;

      /* one column per pixel: more peaks than pixels takes the maximum (sampling would miss a drum hit and draw
         silence); fewer peaks than pixels interpolates (nearest-peak steps are the sampling grid, not the sound) */
      const sliceIn = inMs + (width > 0 ? (from / width) * durMs : 0);
      const sliceDur = width > 0 ? (sliceW / width) * durMs : durMs;
      const columns = waveformColumns(wave, sliceIn, sliceDur, drawW);
      /* one path, one fill: thousands of fillRect calls would be thousands of draws */
      ctx.beginPath();
      for (let x = 0; x < drawW; x += 1) {
        const v = columns[x]!;
        const h = Math.max(1, v * height);
        ctx.rect(x, height - h, 1, h);
      }
      ctx.fill();
    });
    return () => cancelAnimationFrame(frame);
  }, [wave, width, height, color, inMs, durMs, from, sliceW]);

  if (!wave?.peaks.length || sliceW <= 0) return null;
  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute bottom-0"
      style={{ left: from, width: sliceW, height, color }}
    />
  );
}
