/** Preview choices never enter clip CSS or change export settings. */
import { hasBeauty } from './vision-config.mjs';
export const PREVIEW_MODES = Object.freeze(['auto', 'smooth', 'quality']);
export function previewPlan(settings, { playing = false, exact = false, mode = 'auto', side = 256 } = {}) {
  if (exact) return { settings, profile: 'export', side: Infinity, analysisSide: Infinity, preview: false };
  if (!playing || mode === 'quality')
    return { settings, profile: 'quality', side: 1280, analysisSide: 1280, preview: false };
  // A general object model cannot be replaced by a person model without changing the chosen subject.
  if (settings.cutout && settings.mode === 2)
    return { settings, profile: 'original', side: 960, analysisSide: 0, preview: true };
  return {
    settings: { ...settings, mode: settings.mode === 4 ? 1 : settings.mode, personPreview: settings.cutout && settings.mode === 4, quality: 0, analysisSize: side },
    profile: 'draft', side: 960, analysisSide: 640, preview: true,
  };
}
export const analysisVariant = (s) => `${s.cutout ? s.mode : '-'}:${s.quality >= .5 ? 1 : 0}:${hasBeauty(s) ? 1 : 0}:${s.personPreview ? 1 : 0}`;
export const analysisBytes = (value) => Object.values(value ?? {}).reduce((n, v) => n + (v?.data?.byteLength ?? v?.byteLength ?? 0), 0);

/** Keep an interactive inference inside its budget. Changes are bounded and include hysteresis. */
export function adaptiveSide(previous, ms) {
  if (!Number.isFinite(ms) || ms <= 0) return previous;
  if (ms > 34 && previous > 192) return previous - 32;
  if (ms < 14 && previous < 320) return previous + 32;
  return previous;
}
