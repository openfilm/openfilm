// @ts-check
/** Studio delivery targets. Decimal Mbps; MB of 1024 × 1024 bytes, the units Studio shows sizes in.
 * Single-pass average rate, never a hard size or peak-rate limit.
 * Shared with the dialog so the estimate and the encoder reserve the same sound and container allowance. */
/** @typedef {{ kind: 'bitrate' | 'size', value: number }} VideoTarget */
export const TARGET_MIN_BPS = 50_000;
export const TARGET_MAX_BPS = 120_000_000;
const MUX = 1.01;
const MB = 1024 * 1024;
/** @param {string} codec */
export const targetCodec = (codec) => ['h264', 'hevc', 'vp9'].includes(codec);
/** Matches render's AAC / Opus sound settings. @param {string} codec */
export const targetAudioBps = (codec) => codec === 'vp9' ? 160_000 : 192_000;
/** @param {unknown} target @returns {target is VideoTarget} */
export function validTarget(target) {
  if (!target || typeof target !== 'object') return false;
  const { kind, value } = /** @type {VideoTarget} */ (target);
  return (kind === 'bitrate' || kind === 'size') && typeof value === 'number' && Number.isFinite(value) && value > 0
    && (kind !== 'bitrate' || (value * 1e6 >= TARGET_MIN_BPS && value * 1e6 <= TARGET_MAX_BPS));
}
/** Actual frame-snapped selected seconds; reserve sound only when it will be written.
 * @param {VideoTarget} target @param {number} seconds @param {number} audioBps */
export function targetBitrate(target, seconds, audioBps) {
  if (!validTarget(target)) throw new Error('target: a positive size in MB or video bitrate from 0.05 to 120 Mbps');
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('target: the export needs a finite positive duration');
  const bps = Math.round(target.kind === 'bitrate' ? target.value * 1e6 : target.value * MB * 8 / MUX / seconds - audioBps);
  if (bps < TARGET_MIN_BPS || bps > TARGET_MAX_BPS) throw new Error('target: choose a size that leaves 0.05 to 120 Mbps for the video after sound');
  return bps;
}
/** Approximate total file size, not an upper bound. @param {VideoTarget} target @param {number} seconds @param {number} audioBps */
export function targetBytes(target, seconds, audioBps) {
  const bps = targetBitrate(target, seconds, audioBps);
  return Math.round((bps + audioBps) * seconds / 8 * MUX);
}
