/**
 * A clip's attributes copied onto other clips (⌘⇧C / ⌘⇧V): the groups its paste dialog
 * offers, all ticked unless unticked —
 *   · `place`: where the picture sits and how big it is, turned (`box`);
 *   · `blend`: how it shows through (`opacity`, `mix-blend-mode` in its style; the rest of its style stays);
 *   · `volume`: how loud its sound is;
 *   · `fade`: its fade in and fade out, shortened to fit a shorter clip.
 * A picture's groups go onto pictures, the sound's onto clips with sound; what a clip cannot take is left out.
 *
 * Pure: the editor reads the copy from film.html and writes the edits it gives back (lib/film-clip-edits).
 */
import { declared, withDeclarations } from './clip-look.ts';
import { fadeMsOf } from './clip-fade.ts';
import { filmSrcKind } from './film.ts';
import type { ClipEdit } from './film-clip-edits';

export type AttrGroup = 'place' | 'blend' | 'volume' | 'fade';

type Box = { x: number; y: number; w?: number; h?: number; r?: number };
/** What a clip's attributes are read from: its row in film.html (lib/film's FilmClip, api's Clip). */
export interface AttrClip {
  id: string;
  src: string;
  sound?: boolean;
  box?: Box;
  style?: string;
  volume?: number;
  overrides?: readonly unknown[];
}
export const ATTR_GROUPS: readonly AttrGroup[] = ['place', 'blend', 'volume', 'fade'];

export interface CopiedAttrs {
  /** The clip copied from, for saying so. */
  from: string;
  picture: boolean;
  sound: boolean;
  place: Box | null;
  blend: { opacity: string | null; mode: string | null };
  volume: number;
  /** Seconds. */
  fade: [number, number];
}

/** What a clip shows and what it plays: a picture (a page, a video, a still), a sound (a video, a sound). */
function sides(clip: Pick<AttrClip, 'src' | 'sound'>): { picture: boolean; sound: boolean } {
  const kind = clip.sound ? 'sound' : filmSrcKind(clip.src);
  return { picture: kind !== 'sound', sound: kind === 'video' || kind === 'sound' };
}

/** The attributes of a clip, as film.html has them. */
export function attrsOf(clip: AttrClip): CopiedAttrs {
  const style = clip.style ?? '';
  const [fadeIn, fadeOut] = fadeMsOf(clip);
  return {
    from: clip.id,
    ...sides(clip),
    place: clip.box ? { ...clip.box } : null,
    blend: { opacity: declared(style, 'opacity') ?? null, mode: declared(style, 'mix-blend-mode') ?? null },
    volume: clip.volume ?? 1,
    fade: [fadeIn / 1000, fadeOut / 1000],
  };
}

/** The groups a copy has anything for: a picture's for a picture, the sound's for a sound. */
export function groupsOf(attrs: CopiedAttrs): AttrGroup[] {
  return ATTR_GROUPS.filter((g) => (g === 'place' || g === 'blend' ? attrs.picture : g === 'volume' ? attrs.sound : true));
}

export interface AttrTarget {
  loc: string;
  clip: AttrClip;
  /** Its length on the film, seconds: a fade longer than the clip is shortened. */
  lengthS: number;
}

/** The fade a clip `lengthS` long can take: the copy's, both ends shortened alike when together they are longer. */
function fitted([fadeIn, fadeOut]: [number, number], lengthS: number): [number, number] {
  const total = fadeIn + fadeOut;
  if (total <= lengthS || total <= 0) return [fadeIn, fadeOut];
  const k = lengthS / total;
  return [Math.floor(fadeIn * k * 1000) / 1000, Math.floor(fadeOut * k * 1000) / 1000];
}

/** The edits that put the ticked groups of a copy onto these clips (not onto the clip copied from). */
export function pasteAttrs(attrs: CopiedAttrs, groups: ReadonlySet<AttrGroup>, targets: readonly AttrTarget[]): ClipEdit[] {
  const out: ClipEdit[] = [];
  for (const { loc, clip, lengthS } of targets) {
    if (clip.id === attrs.from) continue;
    const can = sides(clip);
    if (can.picture && attrs.picture && groups.has('place')) out.push({ loc, prop: 'box', value: attrs.place ? { ...attrs.place } : null });
    if (can.picture && attrs.picture && groups.has('blend')) {
      const style = withDeclarations(clip.style ?? '', { opacity: attrs.blend.opacity, 'mix-blend-mode': attrs.blend.mode });
      if (style !== (clip.style ?? '')) out.push({ loc, prop: 'style', value: style || null });
    }
    if (can.sound && attrs.sound && groups.has('volume')) out.push({ loc, prop: 'volume', value: attrs.volume });
    if (groups.has('fade')) {
      const [fadeIn, fadeOut] = fitted(attrs.fade, lengthS);
      out.push({ loc, prop: 'fade', value: fadeIn > 0 || fadeOut > 0 ? [fadeIn, fadeOut] : null });
    }
  }
  return out;
}
