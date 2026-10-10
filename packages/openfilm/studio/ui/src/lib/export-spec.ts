/**
 * What an export makes, as the export dialog chooses it: platform presets, codecs, quality, sizes, the estimate of a
 * file's size. The server (studio/server/exports.mjs) draws the same frames with the same arithmetic.
 *
 * No watermark and no end card: the product doesn't make them, so a spec has no place for them.
 */
import { filmFrameBox, type FilmFrameFill, type FilmFrameId } from './film-frame.ts';

/**
 * Video codecs. `png` is a sequence of frames (one zip). The four with transparency each have their place:
 * prores4444 for editors and compositing, hevc_alpha for Apple's apps and Safari (a fraction of ProRes's size), vp9
 * for the web, png for anything (game engines, 3D, Nuke), the biggest.
 */
export type ExportVideoCodec = 'h264' | 'hevc' | 'vp9' | 'prores422hq' | 'prores4444' | 'hevc_alpha' | 'png';
export const EXPORT_ALPHA_CODECS: readonly ExportVideoCodec[] = ['prores4444', 'hevc_alpha', 'vp9', 'png'];

export type ExportQuality = 'standard' | 'high' | 'master';

export const CODEC_LABEL: Record<ExportVideoCodec, string> = {
  h264: 'H.264',
  hevc: 'HEVC',
  vp9: 'WebM VP9',
  prores422hq: 'ProRes 422 HQ',
  prores4444: 'ProRes 4444',
  hevc_alpha: 'HEVC + Alpha',
  png: 'PNG',
};

/* ── platform presets ──────────────────────────────────────────────────── */

export type ExportPresetGroup = 'landscape' | 'vertical' | 'feed';

/**
 * A platform preset. Names are not translated (a platform's name is its name). Only limits known for sure are
 * written (the longest video): a wrong limit is worse than none, since people cut their film to fit it.
 */
export interface ExportPreset {
  id: string;
  name: string;
  group: ExportPresetGroup;
  frame: Exclude<FilmFrameId, 'native'>;
  shortEdge: number;
  fps: number;
  /** Vertical feeds are mostly watched muted: subtitles burned in by default. */
  burnSubtitles: boolean;
  /** The platform's longest video, in seconds. */
  maxDurationSec?: number;
}

export const EXPORT_PRESETS: readonly ExportPreset[] = [
  { id: 'youtube', name: 'YouTube', group: 'landscape', frame: '16:9', shortEdge: 1080, fps: 60, burnSubtitles: false },
  { id: 'youtube-4k', name: 'YouTube 4K', group: 'landscape', frame: '16:9', shortEdge: 2160, fps: 60, burnSubtitles: false },
  { id: 'x', name: 'X', group: 'landscape', frame: '16:9', shortEdge: 1080, fps: 30, burnSubtitles: true, maxDurationSec: 140 },
  { id: 'shorts', name: 'YouTube Shorts', group: 'vertical', frame: '9:16', shortEdge: 1080, fps: 30, burnSubtitles: true, maxDurationSec: 180 },
  { id: 'tiktok', name: 'TikTok', group: 'vertical', frame: '9:16', shortEdge: 1080, fps: 30, burnSubtitles: true },
  { id: 'reels', name: 'Instagram Reels', group: 'vertical', frame: '9:16', shortEdge: 1080, fps: 30, burnSubtitles: true },
  { id: 'instagram', name: 'Instagram Feed', group: 'feed', frame: '4:5', shortEdge: 1080, fps: 30, burnSubtitles: true },
  { id: 'square', name: 'LinkedIn · Facebook', group: 'feed', frame: '1:1', shortEdge: 1080, fps: 30, burnSubtitles: true },
];

export function exportPreset(id: string | undefined): ExportPreset | null {
  return EXPORT_PRESETS.find((p) => p.id === id) ?? null;
}

/* ── sizes ─────────────────────────────────────────────────────────────── */

export const EXPORT_MAX_DIM = 4096;

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/** A picture's size with its short side at `shortEdge`, the box's shape kept; no side over 4096. */
export function exportDimsForShortEdge(box: { w: number; h: number }, shortEdge: number): { w: number; h: number } {
  const r = box.w / Math.max(1, box.h);
  let w: number;
  let h: number;
  if (r >= 1) {
    h = even(shortEdge);
    w = even(h * r);
  } else {
    w = even(shortEdge);
    h = even(w / r);
  }
  if (w > EXPORT_MAX_DIM || h > EXPORT_MAX_DIM) {
    const k = Math.min(EXPORT_MAX_DIM / w, EXPORT_MAX_DIM / h);
    w = even(w * k);
    h = even(h * k);
  }
  return { w, h };
}

/** A GIF's size: its long side at `width`. */
export function exportGifDims(box: { w: number; h: number }, width: number): { w: number; h: number } {
  const r = box.w / Math.max(1, box.h);
  return r >= 1 ? { w: even(width), h: even(width / r) } : { w: even(width * r), h: even(width) };
}

/** The size of a framed picture. */
export function exportFramedDims(
  stage: { w: number; h: number },
  frame: FilmFrameId,
  fill: FilmFrameFill,
  shortEdge: number,
): { w: number; h: number } {
  return exportDimsForShortEdge(filmFrameBox(stage, frame, fill), shortEdge);
}

/* ── bitrate and size ──────────────────────────────────────────────────── */

/** Bits per pixel per frame by quality, for the encoders given a bitrate (exports.mjs BPP and `bitrate`). */
const BITS_PER_PIXEL: Record<ExportQuality, number> = { standard: 0.07, high: 0.11, master: 0.2 };

/** The bitrate an encoder is given (the server's arithmetic): size × fps × quality × `k`, 2 to 120 Mbps. */
function givenBitrate(size: { w: number; h: number }, fps: number, quality: ExportQuality, k: number): number {
  return Math.min(120_000_000, Math.max(2_000_000, size.w * size.h * Math.max(1, fps) * BITS_PER_PIXEL[quality] * k));
}

/**
 * A file's size depends mostly on what is in the picture, not on the settings: at the same 1080p30 H.264 settings
 * films measured run from about 0.6 Mbps (a slide of text) to 21 Mbps (a field of particles). So the dialog shows a
 * range, from a typical film's picture: 0.25× to 4× of it for the codecs given a quality (CRF), ±10% for those near a
 * fixed size a pixel. A rare busy film still falls above it.
 */
const TYPICAL_VIDEO = { w: 1920, h: 1080, fps: 30, bytes: 150_000 };
const VIDEO_SPREAD: readonly [number, number] = [0.25, 4];
const FIXED_SPREAD: readonly [number, number] = [0.9, 1.1];

/** How a CRF file's size follows the settings: the quality's CRF, the codec at its CRF. */
const QUALITY_SIZE: Record<ExportQuality, number> = { standard: 0.58, high: 1, master: 1.6 };
/* HEVC as libx265 encodes it, at its CRF (an ffmpeg without libx265 uses VideoToolbox, given a bitrate: larger) */
const CODEC_SIZE: Partial<Record<ExportVideoCodec, number>> = { h264: 1, hevc: 0.6, vp9: 0.7 };
/** The sound beside the picture, as render encodes it: AAC 192k in an MP4, Opus 160k in WebM, 48 kHz PCM in a MOV. */
const AUDIO_BYTES_PER_SECOND: Partial<Record<ExportVideoCodec, number>> = { vp9: 20_000, prores422hq: 192_000, prores4444: 192_000, hevc_alpha: 192_000 };

/**
 * How many of a picture's pixels are the film's: bars cost an encoder almost nothing. The rest of the frame, with
 * `contain`, is bars; with `cover` the film fills it.
 */
export function exportFilmPixels(stage: { w: number; h: number }, frame: FilmFrameId, fill: FilmFrameFill, size: { w: number; h: number }): number {
  const box = filmFrameBox(stage, frame, fill);
  const share = Math.min(1, (box.inner.w * box.inner.h) / Math.max(1, box.w * box.h));
  return size.w * size.h * share;
}

/**
 * A video file's likely size in bytes, `[low, high]`, for the dialog's "about 1 MB–10 MB": a typical film's picture
 * scaled to the pixels of film in it, the frame rate (more frames, each more like the last), the quality and the codec;
 * ProRes, PNG and HEVC with alpha by their own arithmetic. Plus the sound, at both ends.
 */
export function exportEstimateBytes(spec: {
  codec: ExportVideoCodec;
  size: { w: number; h: number };
  /** the pixels of film in the picture (exportFilmPixels); without it, all of them */
  filmPixels?: number;
  fps: number;
  quality: ExportQuality;
  durationMs: number;
  audio: boolean;
}): [number, number] {
  const sec = Math.max(0, spec.durationMs) / 1000;
  const px = spec.size.w * spec.size.h;
  let videoBps: number;
  let spread = FIXED_SPREAD;
  switch (spec.codec) {
    /* ProRes is a fixed-rate family: 422 HQ about 220 Mbps at 1080p30, 4444 about 330, scaled by pixels × fps */
    case 'prores422hq': videoBps = 220_000_000 * (px / (1920 * 1080)) * (spec.fps / 30); break;
    case 'prores4444': videoBps = 330_000_000 * (px / (1920 * 1080)) * (spec.fps / 30); break;
    /* HEVC with alpha (VideoToolbox) is given its bitrate */
    case 'hevc_alpha': videoBps = givenBitrate(spec.size, spec.fps, spec.quality, 0.8); break;
    /* a PNG sequence of motion graphics compresses well: about a byte per pixel */
    case 'png': videoBps = px * 8 * spec.fps; break;
    default: {
      const pixels = spec.filmPixels ?? px;
      videoBps = 8 * TYPICAL_VIDEO.bytes * (pixels / (TYPICAL_VIDEO.w * TYPICAL_VIDEO.h)) ** 0.75
        * (Math.max(1, spec.fps) / TYPICAL_VIDEO.fps) ** 0.35 * QUALITY_SIZE[spec.quality] * (CODEC_SIZE[spec.codec] ?? 1);
      spread = VIDEO_SPREAD;
    }
  }
  const audioBytes = spec.audio ? (AUDIO_BYTES_PER_SECOND[spec.codec] ?? 24_000) : 0;
  const at = (k: number) => Math.round((videoBps / 8 * k + audioBytes) * sec);
  return [at(spread[0]), at(spread[1])];
}

/** A typical film's GIF, 640 × 360 at 15 fps, and how far a film's strays from it. */
const TYPICAL_GIF = { w: 640, h: 360, fps: 15, bytes: 300_000 };
const GIF_SPREAD: readonly [number, number] = [0.4, 3];

/** A GIF's likely size in bytes, `[low, high]`: a typical film's GIF scaled to the pixels of film and the frame rate. */
export function exportGifEstimateBytes(spec: {
  size: { w: number; h: number };
  filmPixels?: number;
  fps: number;
  durationMs: number;
}): [number, number] {
  const pixels = spec.filmPixels ?? spec.size.w * spec.size.h;
  const bytes = TYPICAL_GIF.bytes * (pixels / (TYPICAL_GIF.w * TYPICAL_GIF.h)) ** 0.9 * (Math.max(1, spec.fps) / TYPICAL_GIF.fps) ** 0.6
    * Math.max(0, spec.durationMs) / 1000;
  return [Math.round(bytes * GIF_SPREAD[0]), Math.round(bytes * GIF_SPREAD[1])];
}

/** A place a part of the film can start or end, named by the clips that start (or end) there. */
export type RangeMark = { ms: number; title: string };

/** Clip edges this close together are one place to cut (a frame or two apart is the same cut to a person). */
const SAME_CUT_MS = 400;

/**
 * Where a part of the film can start and end: at its picture clips' edges ("scenes two to four" is what people mean).
 * A start is named by the clips that start there, an end by the clips that end there. Edges close together are one;
 * a start goes to the earliest of them and an end to the latest, so the part takes in every clip named. The film's
 * own start and end are always there (an edge close to one is it).
 */
export function rangeMarks(scenes: readonly { startMs: number; durMs: number; label: string }[], totalMs: number): { starts: RangeMark[]; ends: RangeMark[] } {
  const shown = scenes.filter((sc) => sc.durMs > 0 && sc.startMs < totalMs);
  const group = (edges: { ms: number; label: string }[], latest: boolean) => {
    const sorted = [...edges].sort((a, b) => a.ms - b.ms);
    const groups: { ms: number; last: number; labels: string[] }[] = [];
    for (const e of sorted) {
      const g = groups.at(-1);
      if (g && e.ms - g.last < SAME_CUT_MS) {
        g.last = e.ms;
        if (latest) g.ms = e.ms;
        if (!g.labels.includes(e.label)) g.labels.push(e.label);
      } else groups.push({ ms: e.ms, last: e.ms, labels: [e.label] });
    }
    return groups.map((g) => ({ ms: g.ms, title: g.labels.filter(Boolean).join(', ') }));
  };
  const starts = group(shown.map((sc) => ({ ms: Math.max(0, sc.startMs), label: sc.label })), false);
  const ends = group(shown.map((sc) => ({ ms: Math.min(totalMs, sc.startMs + sc.durMs), label: sc.label })), true);
  if (starts[0] && starts[0].ms < SAME_CUT_MS) starts[0].ms = 0;
  else starts.unshift({ ms: 0, title: '' });
  const last = ends.at(-1);
  if (last && totalMs - last.ms < SAME_CUT_MS) last.ms = totalMs;
  else if (totalMs > 0) ends.push({ ms: totalMs, title: '' });
  return { starts, ends: ends.filter((e) => e.ms > 0) };
}
