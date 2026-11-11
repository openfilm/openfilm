/**
 * Loudness normalization: a clip's `volume` set so the part of its file it plays measures a target loudness. Studio
 * measures the integrated loudness of that part (EBU R128, LUFS; studio/server/derived.mjs `loudness`); the gain is
 * the difference, within the volume a clip can have (0–500%, the inspector's range).
 */

/** The targets offered: web video, podcasts, broadcast (EBU R128). */
export const LOUDNESS_TARGETS = [
  { id: 'web', lufs: -14 },
  { id: 'podcast', lufs: -16 },
  { id: 'broadcast', lufs: -23 },
] as const;

/** The loudest a clip's volume goes (500%), as the inspector's slider. */
export const VOLUME_MAX = 5;

/** The volume slider's range in dB: its bottom is silence, its top the loudest a clip goes (500%, +14 dB). */
export const VOLUME_DB_MIN = -60;
export const VOLUME_DB_MAX = Math.round(20 * Math.log10(VOLUME_MAX) * 10) / 10;

/** A clip's volume as the slider shows it: dB to the tenth, silence at the bottom. */
export function volumeToDb(volume: number): number {
  if (!(volume > 0)) return VOLUME_DB_MIN;
  const db = Math.round(20 * Math.log10(volume) * 10) / 10;
  return Math.max(VOLUME_DB_MIN, Math.min(VOLUME_DB_MAX, db));
}

/** The volume a dB on the slider writes, to the thousandth: silent at its bottom, at most 500%. */
export function dbToVolume(db: number): number {
  if (!(db > VOLUME_DB_MIN)) return 0;
  return Math.round(Math.min(VOLUME_MAX, 10 ** (db / 20)) * 1000) / 1000;
}

/** Quieter than this is silence: EBU R128 gates out anything under −70 LUFS. */
const SILENT_LUFS = -70;

export type NormalizePlan =
  | { volume: number; reached: true }
  /** the volume it would need, past what a clip can have: it is set to the most it can, and that is said */
  | { volume: number; reached: false; wantedVolume: number; lufs: number }
  | { silent: true };

/** The volume that brings `measured` LUFS to `target` LUFS, kept to 0–500%, to the thousandth. */
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
