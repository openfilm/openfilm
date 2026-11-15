// @ts-check
/**
 * What footage's code values mean: each input is how a clip's file was encoded (its transfer function and its gamut),
 * so the grade can take its picture back to light. `decode` takes a code value from 0 to 1, as ffmpeg and the
 * browser give it (full range of the file's own range), to linear light where 0.18 is mid grey and 1.0 a diffuse white.
 *
 * `display`: SDR video, already made to be seen (BT.1886's gamma 2.4, or sRGB's curve); graded on as it is, and given
 * back the same way, so a clip with nothing changed stays exactly as it was. `hdr`: HLG and PQ, mapped so their
 * reference white (75 % HLG, 203 cd/m² PQ, as BT.2408 places it) is 1.0. `log`: a camera's log, scene light as its
 * maker publishes the curve (camera-logs.mjs).
 */
import { bt1886, hlg, pq, srgb } from './math.mjs';
import { CAMERA_LOGS } from './camera-logs.mjs';

/**
 * @typedef {import('./math.mjs').Primaries} Primaries
 * @typedef {{
 *   id: string, name: string, kind: 'display' | 'hdr' | 'log', gamut: import('./math.mjs').SpaceName | Primaries,
 *   decode: (v: number) => number, encode?: (l: number) => number, codes?: 'signal' | 'cv',
 * }} Input
 */

/** HLG's reference white (75 % signal), in scene light from its inverse OETF. */
const HLG_WHITE = hlg.decode(0.75);
/** PQ's reference white, cd/m² (BT.2408). */
const PQ_WHITE = 203;

/** @type {Input[]} */
export const INPUTS = [
  { id: 'rec709', name: 'Rec.709 (gamma 2.4)', kind: 'display', gamut: 'bt709', decode: bt1886.decode, encode: bt1886.encode },
  { id: 'srgb', name: 'sRGB', kind: 'display', gamut: 'bt709', decode: srgb.decode, encode: srgb.encode },
  { id: 'hlg', name: 'HLG (Rec.2100)', kind: 'hdr', gamut: 'bt2020', decode: (v) => hlg.decode(v) / HLG_WHITE },
  { id: 'pq', name: 'PQ (Rec.2100, HDR10)', kind: 'hdr', gamut: 'bt2020', decode: (v) => pq.decode(v) / PQ_WHITE },
  ...CAMERA_LOGS,
];

/** An input by its id, or null. */
export const inputOf = (/** @type {string} */ id) => INPUTS.find((i) => i.id === id) ?? null;

/**
 * An input's decode of a code value as ffmpeg and the browser give it (0 at black's code, 1 at white's), in a file of
 * `range`: a curve its maker wrote on the stored 10-bit code (`codes: 'cv'`, camera-logs.mjs) is given that code.
 * @param {Input} input @param {'legal' | 'full'} range @returns {(v: number) => number}
 */
export function decoderOf(input, range) {
  if (input.codes !== 'cv' || range === 'full') return input.decode;
  return (v) => input.decode((64 + 876 * v) / 1023);
}

/**
 * The input a file's color tags say it is (ffprobe's `color_transfer`): HLG and PQ by their transfer, sRGB's curve,
 * else BT.709 video. A camera's log is tagged as BT.709 or BT.2020 by most cameras, so it is never guessed: it is chosen.
 * @param {string | undefined | null} transfer
 */
export function inputOfTags(transfer) {
  /* (the range a file is in is read from its tags too: rangeOfTags) */
  if (transfer === 'arib-std-b67') return 'hlg';
  if (transfer === 'smpte2084') return 'pq';
  if (transfer === 'iec61966-2-1') return 'srgb';
  return 'rec709';
}

/** The range a file's code values are in, by ffprobe's `color_range`: full (`pc`) or video (legal; also untagged). */
export const rangeOfTags = (/** @type {string | undefined | null} */ range) => /** @type {'legal' | 'full'} */ (range === 'pc' ? 'full' : 'legal');
