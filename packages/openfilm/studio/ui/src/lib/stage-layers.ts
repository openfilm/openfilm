/**
 * Layers inside a page as film.html names them: the override target of a selected layer, and the layers a person
 * hid or locked (the stage menu's Show… / Unlock…). Read from film.html, so they can be brought back after the
 * selection is gone or the project was opened again, even when nothing on the stage can be clicked to reach them.
 */
import { filmDocLoc, filmSrcIsPage, type FilmDoc } from './film.ts';
import { nextOverrides, type OverrideTarget } from './film-overrides.ts';
import type { StageElement } from './stage-types.ts';

/**
 * The override target of a layer: its selector, and which match when the selector finds several (`loc` is the
 * selector with `#n` then). `allCopies` targets every match.
 */
export function layerTarget(element: Pick<StageElement, 'loc' | 'instance'>, allCopies = false): OverrideTarget | null {
  if (!element.loc) return null;
  const n = element.instance;
  const at = n != null && element.loc.endsWith(`#${n}`) ? element.loc.slice(0, -`#${n}`.length) : element.loc;
  return { at, ...(!allCopies && n != null ? { n } : {}) };
}

/** The page clip a layer is in, and its place in film.html (by the clip's id, else its place). */
export function pageClipOf(doc: FilmDoc, element: Pick<StageElement, 'clipId' | 'clipLoc'>): { clip: FilmDoc['tracks'][number]['clips'][number]; loc: string } | null {
  for (const [ti, track] of doc.tracks.entries()) {
    for (const [ci, clip] of track.clips.entries()) {
      const loc = filmDocLoc(ti, ci);
      if (!filmSrcIsPage(clip.src)) continue;
      if (element.clipId ? clip.id === element.clipId : loc === element.clipLoc) return { clip, loc };
    }
  }
  return null;
}

export interface RecoverableLayer {
  clipId: string;
  target: OverrideTarget;
  label: string;
  hidden: boolean;
  locked: boolean;
}

/** Every hidden or locked layer in the film's pages. */
export function recoverableLayers(doc: FilmDoc | undefined | null): RecoverableLayer[] {
  if (!doc) return [];
  return doc.tracks.flatMap((track) => track.clips.flatMap((clip) => {
    if (!filmSrcIsPage(clip.src)) return [];
    return (clip.overrides ?? []).flatMap((o) => {
      if (o.at === undefined) return []; // the clip's own entry (its fades): no layer
      const hidden = o.style?.visibility === 'hidden';
      const locked = o.lock === true;
      if (!hidden && !locked) return [];
      return [{
        clipId: clip.id,
        target: { at: o.at, ...(o.n != null ? { n: o.n } : {}) },
        label: `${o.at}${o.n == null ? '' : ` (${o.n})`} · ${clip.id}`,
        hidden,
        locked,
      }];
    });
  }));
}

/** The edit that shows / unlocks one of them: its clip's next `overrides` (null removes the key). */
export function recoverLayer(doc: FilmDoc, layer: RecoverableLayer, action: 'show' | 'unlock'): { loc: string; prop: 'overrides'; value: ReturnType<typeof nextOverrides> } | null {
  const found = pageClipOf(doc, { clipId: layer.clipId });
  if (!found) return null;
  return {
    loc: found.loc,
    prop: 'overrides',
    value: nextOverrides(found.clip.overrides, layer.target, action === 'show' ? { style: { visibility: null } } : { lock: false }),
  };
}
