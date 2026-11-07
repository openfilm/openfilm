/**
 * film.html as the editor sees it: the format's own helpers (src/film-doc.mjs, shared with the CLI) and the few the
 * editor adds — Studio's track kinds and badges, clip locations, volume in dB.
 */
import { rowBadges, trackKind } from '../../../server/track-layout.mjs';
import { DEFAULT_STAGE, SPEED_MAX, SPEED_MIN, clipKind, isPage, isStill, kindOf, soundRole } from '../../../../src/film-doc.mjs';
import type { FilmBox, FilmClip, FilmClipKind as FilmSrcKind, FilmDoc, FilmOverride, FilmTrack } from '../../../../src/film-doc.d.mts';

export type { FilmBox, FilmClip, FilmDoc, FilmOverride, FilmSrcKind, FilmTrack };

export const FILM_DOC_FILE = 'film.html';
export const FILM_SPEED_MIN = SPEED_MIN;
export const FILM_SPEED_MAX = SPEED_MAX;
/** The stage of a film.html that says none. */
export const FILM_DEFAULT_STAGE = DEFAULT_STAGE;

export const filmSrcIsStill: (src: string) => boolean = isStill;
/**
 * A thing of OpenFilm's library taken into the project (`saved/openfilm/…`: a sticker, a text, an effect): a page with
 * no source of its own to trim into. As a still's, its left edge changes its length (its way in stays at its start).
 */
export const filmSrcIsLibrary = (src: string | undefined): boolean => Boolean(src?.split('#')[0]?.startsWith('saved/openfilm/'));
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
export const filmTrackKind = trackKind;

/**
 * A file's name without its folder or extension (`assets/intro.html` → `intro`); a film in a folder of its own (a
 * compound clip's) is called by its folder (`parts/intro/film.html` → `intro`).
 */
export function fileStem(path: string): string {
  const parts = path.replace(/[#?].*$/, '').split('/');
  if (parts.length > 1 && parts[parts.length - 1] === 'film.html') return parts[parts.length - 2]!;
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.[a-z0-9]{1,5}$/i, '') || base;
}

/** A track's badge letter, by what it holds: V pictures (footage, stills, pages), A sound. */
export function filmTrackPrefix(kind: string): string {
  return kind === 'audio' ? 'A' : 'V';
}

/**
 * Each track's name on the timeline (V2, V1, A1), worked out from position and kind, never stored: picture tracks
 * (V) counted from the bottom up, so V1 is the lowest and V2 covers it, and sound tracks (A) from the top down. It names a track a person can point at; stacking is the position itself.
 */
export function filmTrackBadges(tracks: readonly ({ kind: string } | { clips: readonly { src: string }[] })[]): string[] {
  return rowBadges(tracks.map((track) => 'kind' in track ? track.kind : filmTrackKind(track)));
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
