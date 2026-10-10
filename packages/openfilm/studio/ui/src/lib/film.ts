/**
 * film.html as the editor sees it: the format's own helpers (src/film-doc.mjs, shared with the CLI) and the few the
 * editor adds — Studio's track kinds and badges, clip locations, volume in dB.
 */
import { DEFAULT_STAGE, SPEED_MAX, SPEED_MIN, clipKind, isPage, isStill, kindOf, soundRole } from '../../../../src/film-doc.mjs';
import type { FilmBox, FilmClip, FilmClipKind as FilmSrcKind, FilmDoc, FilmOverride, FilmTrack } from '../../../../src/film-doc.d.mts';

export type { FilmBox, FilmClip, FilmDoc, FilmOverride, FilmSrcKind, FilmTrack };

export const FILM_DOC_FILE = 'film.html';
export const FILM_SPEED_MIN = SPEED_MIN;
export const FILM_SPEED_MAX = SPEED_MAX;
/** The stage of a film.html that says none. */
export const FILM_DEFAULT_STAGE = DEFAULT_STAGE;

export const filmSrcIsStill: (src: string) => boolean = isStill;
export const filmSrcIsPage: (src: string) => boolean = isPage;
/** What a clip is, as film.html says it (a page, a video, a still, a sound). */
export const filmSrcKind = clipKind;

/** Studio's three kinds of clip: a page (mg), a picture (video or still) and a sound. */
export type FilmClipKind = 'mg' | 'video' | 'audio';

/** What a clip is, from its file, or from the clip itself (a video's sound alone is a sound). */
export function filmClipKind(of: string | { src: string; sound?: boolean }): FilmClipKind {
  const kind = typeof of === 'string' ? clipKind(of) : kindOf(of);
  return kind === 'page' ? 'mg' : kind === 'sound' ? 'audio' : 'video';
}

/** How Studio shows a track, from what is on it: all sound → audio, all pages → mg, anything else → video. */
export function filmTrackKind(track: { clips: readonly { src: string; sound?: boolean }[] }): FilmClipKind {
  const kinds = new Set(track.clips.map((clip) => filmClipKind(clip)));
  if (kinds.size === 1) return [...kinds][0]!;
  return 'video';
}

/** A file's name without its folder or extension (`assets/intro.html` → `intro`). */
export function fileStem(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.[a-z0-9]{1,5}$/i, '') || base;
}

/** A track's badge letter, by what it holds: P pages, V pictures (video and stills), A sound. */
export function filmTrackPrefix(kind: string): string {
  return kind === 'mg' ? 'P' : kind === 'video' ? 'V' : 'A';
}

/**
 * Each track's name on the timeline (P1, V2, A1), worked out from position and kind, never stored, as Premiere and
 * Resolve name theirs: picture tracks (P, V) counted from the bottom up, so V1 is the lowest and V2 covers it, and
 * sound tracks (A) from the top down. Each prefix on its own. It names a track a person can point at; stacking is
 * the position itself.
 */
export function filmTrackBadges(tracks: readonly ({ kind: string } | { clips: readonly { src: string }[] })[]): string[] {
  const prefixes = tracks.map((track) => filmTrackPrefix('kind' in track ? track.kind : filmTrackKind(track)));
  const total = new Map<string, number>();
  for (const p of prefixes) total.set(p, (total.get(p) ?? 0) + 1);
  const seen = new Map<string, number>();
  return prefixes.map((prefix) => {
    const nth = (seen.get(prefix) ?? 0) + 1;
    seen.set(prefix, nth);
    return `${prefix}${prefix === 'A' ? nth : total.get(prefix)! - nth + 1}`;
  });
}

/** A sound's role in the mix, from where it lives (generated sounds are filed by kind; anything else is a voice). */
export type FilmAudioRole = 'voice' | 'sfx' | 'music';

export function filmAudioRoleOf(src: string): FilmAudioRole {
  return soundRole(src);
}

/** A clip's place in film.html, `film.html#<track>.<clip>`: what the timeline's blocks carry as `loc`. */
export function filmDocLoc(track: number, clip: number): string {
  return `${FILM_DOC_FILE}#${track}.${clip}`;
}

export function parseFilmDocLoc(loc: string): { track: number; clip: number } | null {
  const m = /^film\.html#(\d+)\.(\d+)$/.exec(loc);
  return m ? { track: Number(m[1]), clip: Number(m[2]) } : null;
}

/** Linear volume → dB for the mix. 1 or unset is as is; ≤ 0 is silence (no dB). */
export function filmVolumeToGainDb(volume: number | undefined): number | undefined {
  if (volume == null || volume <= 0) return undefined;
  if (volume === 1) return undefined;
  return Math.round(20 * Math.log10(volume) * 1000) / 1000;
}

export function filmGainDbToVolume(gainDb: number): number {
  return Math.round(10 ** (gainDb / 20) * 1000) / 1000;
}
