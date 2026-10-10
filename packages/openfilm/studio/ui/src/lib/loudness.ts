/**
 * Loudness normalization: a clip's `volume` set so the part of its file it plays measures a target loudness. Studio
 * measures the integrated loudness of that part (EBU R128, LUFS; studio/server/derived.mjs `loudness`); the gain is
 * the difference, within the volume a clip can have (0–200%, the inspector's range).
 */

/** The targets offered: web video, podcasts, broadcast (EBU R128). */
export const LOUDNESS_TARGETS = [
  { id: 'web', lufs: -14 },
  { id: 'podcast', lufs: -16 },
  { id: 'broadcast', lufs: -23 },
] as const;

/** The loudest a clip's volume goes (200%), as the inspector's slider. */
export const VOLUME_MAX = 2;

/** Quieter than this is silence: EBU R128 gates out anything under −70 LUFS. */
const SILENT_LUFS = -70;

export type NormalizePlan =
  | { volume: number; reached: true }
  /** the volume it would need, past what a clip can have: it is set to the most it can, and that is said */
  | { volume: number; reached: false; wantedVolume: number; lufs: number }
  | { silent: true };

/** The volume that brings `measured` LUFS to `target` LUFS, kept to 0–200%, to the thousandth. */
export function normalizeVolume(measured: number | null, target: number): NormalizePlan {
  if (measured == null || !Number.isFinite(measured) || measured <= SILENT_LUFS) return { silent: true };
  const wanted = 10 ** ((target - measured) / 20);
  const volume = Math.round(Math.min(VOLUME_MAX, wanted) * 1000) / 1000;
  if (wanted <= VOLUME_MAX + 0.0005) return { volume, reached: true };
  /* the loudness it gets at the most it can have */
  const lufs = Math.round((measured + 20 * Math.log10(VOLUME_MAX)) * 10) / 10;
  return { volume, reached: false, wantedVolume: Math.round(wanted * 1000) / 1000, lufs };
}

/** The part of a clip's file it plays, in the file's seconds: what is measured. */
export function measuredSpan(clip: { inMs?: number; speed?: number; startMs: number; endMs: number }): { from: number; to: number } {
  const from = (clip.inMs ?? 0) / 1000;
  return { from, to: from + ((clip.endMs - clip.startMs) * (clip.speed ?? 1)) / 1000 };
}
