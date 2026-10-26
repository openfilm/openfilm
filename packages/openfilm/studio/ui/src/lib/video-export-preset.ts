/** Platform choices fill the same editable settings as the default video preset. */
import type { FilmFrameFill, FilmFrameId } from './film-frame.ts';
import { exportPreset, presetFps, type ExportQuality, type ExportVideoCodec } from './export-spec.ts';

export interface VideoExportSettings {
  /** 'default', 'custom', or a platform id. */
  preset: string;
  codec: ExportVideoCodec;
  shortEdge: number;
  fps: number | 'source';
  quality: ExportQuality;
  frame: FilmFrameId | 'current';
  fill: FilmFrameFill;
  audio: boolean;
  burn: boolean;
  sidecar: 'none' | 'srt' | 'vtt';
}

export const DEFAULT_VIDEO_EXPORT: VideoExportSettings = {
  preset: 'default',
  codec: 'h264',
  shortEdge: 1080,
  fps: 'source',
  quality: 'high',
  frame: 'current',
  fill: 'contain',
  audio: true,
  burn: true,
  sidecar: 'none',
};

export function videoExportPreset(id: string, projectFps: number): VideoExportSettings {
  const platform = exportPreset(id);
  return platform
    ? {
        ...DEFAULT_VIDEO_EXPORT,
        preset: platform.id,
        frame: platform.frame,
        shortEdge: platform.shortEdge,
        fps: presetFps(platform, projectFps),
        burn: platform.burnSubtitles,
      }
    : { ...DEFAULT_VIDEO_EXPORT };
}

/** Editing a preset makes a custom configuration; picking a preset explicitly replaces that label as well. */
export function patchVideoExport(
  current: VideoExportSettings,
  patch: Partial<VideoExportSettings>
): VideoExportSettings {
  if (Object.entries(patch).every(([key, value]) => current[key as keyof VideoExportSettings] === value))
    return current;
  return { ...current, ...patch, preset: patch.preset ?? 'custom' };
}

/** Keep older video settings. As before, opening Export starts with sound enabled. */
export function readVideoExport(raw?: Partial<VideoExportSettings>): VideoExportSettings {
  const video = { ...DEFAULT_VIDEO_EXPORT, ...raw, audio: true };
  if (raw?.preset === 'default' || raw?.preset === 'custom' || exportPreset(raw?.preset)) return video;
  const standard = Object.entries(DEFAULT_VIDEO_EXPORT).every(
    ([key, value]) => key === 'preset' || video[key as keyof VideoExportSettings] === value
  );
  return { ...video, preset: standard ? 'default' : 'custom' };
}

/** The old separate social page becomes one video preset, preserving its quality and subtitle choices. */
export function legacySocialVideo(
  id: string,
  quality: ExportQuality | undefined,
  subtitles: 'auto' | 'on' | 'off' | undefined,
  projectFps: number
): VideoExportSettings {
  const video = videoExportPreset(id, projectFps);
  return patchVideoExport(video, {
    quality: quality ?? video.quality,
    burn: subtitles === 'on' ? true : subtitles === 'off' ? false : video.burn,
  });
}
