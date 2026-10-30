/**
 * A clip's volume on the timeline: a thin line across its sound, dragged up or down. The top of the sound's area is
 * the loudest a clip goes (500%, lib/loudness), the bottom silence; as is, it sits a little above the middle.
 *
 * The line goes by a fader's taper, the cube root of the volume: the levels people set most (−20 dB to 0) take most
 * of the height. It writes what the inspector's Volume writes (`volume` in film.html, `gainDb` otherwise), on its
 * 0.1 dB steps: one edit, one undo step.
 *
 * Pure: the timeline draws a drag's line from here while the hand is on it, and writes it on release.
 */
import { filmGainDbToVolume, filmVolumeToGainDb, parseFilmDocLoc } from './film.ts';
import type { ClipEdit } from './film-clip-edits.ts';
import { dbToVolume, VOLUME_MAX, volumeToDb } from './loudness.ts';

/** Within this many px of where the volume as is sits, the line lets go at it. */
const SNAP_PX = 2;

/** A clip as its volume line sees it. */
export interface VolumeClip {
  kind: string;
  loc?: string;
  volume?: number;
  gainDb?: number;
  ownAudio?: boolean;
}

/** Whether a clip has a volume: sounds always, a video when it carries its own sound (a page has none). */
export function hasVolume(clip: VolumeClip): boolean {
  return clip.kind === 'voice' || clip.kind === 'sfx' || clip.kind === 'music' || Boolean(clip.ownAudio);
}

/** A clip's linear volume (1 as is): film.html's `volume`, or a code-shaped film's `gainDb`. */
export function volumeOf(clip: VolumeClip): number {
  return clip.volume ?? filmGainDbToVolume(clip.gainDb ?? 0);
}

/** Where the line sits for `volume`: px down from the top of the sound's area, `areaPx` high. */
export function volumeLineY(volume: number, areaPx: number): number {
  return areaPx * (1 - Math.cbrt(Math.min(VOLUME_MAX, Math.max(0, volume)) / VOLUME_MAX));
}

/** The volume of the line at `y` (as volumeLineY), on the inspector's 0.1 dB steps; near as is, exactly as is. */
export function volumeAtLineY(y: number, areaPx: number): number {
  if (!(areaPx > 0)) return 1;
  const at = Math.max(0, Math.min(areaPx, y));
  if (Math.abs(at - volumeLineY(1, areaPx)) <= SNAP_PX) return 1;
  return dbToVolume(volumeToDb(VOLUME_MAX * (1 - at / areaPx) ** 3));
}

/** A volume as the line's label says it: `0.0 dB` as is, `−6.0 dB`, `+3.5 dB`, `−∞ dB` silent. */
export function volumeText(volume: number): string {
  if (!(volume > 0)) return '−∞ dB';
  const db = volumeToDb(volume);
  return `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`;
}

/** The edit that gives a clip `volume`, as the inspector's Volume writes it; null when it has it already. */
export function volumeEdit(clip: VolumeClip, volume: number): ClipEdit | null {
  if (!clip.loc || !hasVolume(clip)) return null;
  const v = Math.round(volume * 1000) / 1000;
  if (v === Math.round(volumeOf(clip) * 1000) / 1000) return null;
  if (parseFilmDocLoc(clip.loc) != null) return { loc: clip.loc, prop: 'volume', value: v };
  return { loc: clip.loc, prop: 'gainDb', value: filmVolumeToGainDb(v) ?? null };
}
