/**
 * A film's covers (studio/server/covers.mjs): each a film of one frame in `covers/<name>/`, its stage a platform's
 * size, opened in the editor as a compound clip's film is. The shapes a new one is made in, where the platforms put
 * their buttons over each, and Studio's calls for them, made on the project the covers are of.
 */
import { libraryUrl, type LibraryNames } from './library';

/** A cover of the project, as listed. */
export interface CoverInfo {
  folder: string;
  name: string;
  stage: { w: number; h: number };
  changed: number;
}

/** A look of the library a cover can take (library/covers/covers.json). */
export interface CoverLook {
  id: string;
  group: string;
  name: LibraryNames;
  src: string;
  poster: string;
  about: string;
}

export interface CoverLooks {
  groups: { id: string; name: LibraryNames }[];
  items: CoverLook[];
}

/** A shape a cover is made in: its size, and the platforms that show it. */
export interface CoverShape {
  id: 'landscape' | 'portrait' | 'vertical' | 'square';
  w: number;
  h: number;
  ratio: string;
}

export const COVER_SHAPES: CoverShape[] = [
  { id: 'landscape', w: 1920, h: 1080, ratio: '16:9' },
  { id: 'portrait', w: 1080, h: 1440, ratio: '3:4' },
  { id: 'vertical', w: 1080, h: 1920, ratio: '9:16' },
  { id: 'square', w: 1080, h: 1080, ratio: '1:1' },
];

/** The shape a stage is (the nearest by ratio), for its name. */
export function shapeOf(stage: { w: number; h: number }): CoverShape {
  const r = stage.w / stage.h;
  return COVER_SHAPES.reduce((best, s) => (Math.abs(Math.log(s.w / s.h / r)) < Math.abs(Math.log(best.w / best.h / r)) ? s : best));
}

/**
 * Where a platform's own buttons and words cover a cover of this shape, as parts of its width and height: kept clear of
 * what matters. `crop`: the part of it a profile's grid shows.
 */
export function safeAreas(shape: CoverShape['id']): { covered: { x: number; y: number; w: number; h: number; label: 'duration' | 'actions' | 'caption' | 'top' }[]; crop?: { x: number; y: number; w: number; h: number } } {
  if (shape === 'landscape') return { covered: [{ x: 0.855, y: 0.87, w: 0.125, h: 0.09, label: 'duration' }] };
  if (shape === 'vertical') {
    return {
      covered: [
        { x: 0, y: 0, w: 1, h: 0.07, label: 'top' },
        { x: 0.84, y: 0.36, w: 0.16, h: 0.46, label: 'actions' },
        { x: 0, y: 0.8, w: 0.84, h: 0.2, label: 'caption' },
      ],
      /* a profile's grid shows the middle 3:4 */
      crop: { x: 0, y: (1 - 9 / 16 * 4 / 3) / 2, w: 1, h: 9 / 16 * 4 / 3 },
    };
  }
  return { covered: [] };
}

/** The moment of the film a cover's picture was taken at (`frame-<ms>.jpg`), in seconds; null for none. */
export function frameMoment(src: string | undefined): number | null {
  const m = /(?:^|\/)frame-(\d+)\.jpg$/.exec(src ?? '');
  return m ? Number(m[1]) / 1000 : null;
}

/** A look's picture. */
export const lookPoster = (look: CoverLook): string => libraryUrl(`covers/${look.poster}`);

/** A cover drawn small, as its card shows it (drawn again when it changes). */
export const coverThumb = (projectId: string, cover: CoverInfo, w = 320): string =>
  `/api/projects/${encodeURIComponent(projectId)}/media?what=frame&path=${encodeURIComponent(`${cover.folder}/film.html`)}&ms=0&w=${w}&v=${Math.round(cover.changed)}`;

/** The film drawn at `ms`, small, for the strip a cover's moment is picked from. */
export const filmThumb = (projectId: string, ms: number, w = 160): string =>
  `/api/projects/${encodeURIComponent(projectId)}/media?what=frame&path=film.html&ms=${Math.round(ms)}&w=${w}`;

async function call<T>(projectId: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/${path}`, body === undefined
    ? { cache: 'no-store' }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await r.text();
  const json = text ? JSON.parse(text) as T & { error?: string } : null;
  if (!r.ok) throw new Error((json as { error?: string } | null)?.error ?? `${r.status}`);
  return json as T;
}

/** A clip a cover is made with, as the server writes it. */
export interface CoverClip { id: string; src: string; time: [number, number]; box?: { x: number; y: number; w: number; h: number }; attrs?: Record<string, string> }

export const coversApi = {
  list: (projectId: string) => call<{ covers: CoverInfo[]; looks: CoverLooks }>(projectId, 'covers'),
  /** a new cover: `at` the film's moment for its picture, `look` a look over it, `from` a cover copied to this shape */
  make: (projectId: string, ask: { name: string; stage: { w: number; h: number }; at?: number; look?: string; from?: string }) =>
    call<{ folder: string }>(projectId, 'covers', ask),
  open: (projectId: string, folder: string) => call<{ project: { id: string } }>(projectId, 'covers/open', { folder }),
  frame: (projectId: string, folder: string, at: number) => call<{ clip: CoverClip }>(projectId, 'covers/frame', { folder, at }),
  look: (projectId: string, folder: string, look: string) => call<{ clip: CoverClip }>(projectId, 'covers/look', { folder, look }),
  draw: (projectId: string, folders: string[], format: 'jpg' | 'png' = 'jpg') => call<{ files: string[] }>(projectId, 'covers/draw', { folders, format }),
  /** how long the film is, in seconds (null: it has no end) */
  length: async (projectId: string) => {
    const facts = await call<{ duration?: number }>(projectId, 'media?what=probe&path=film.html').catch(() => null);
    return facts?.duration ?? null;
  },
};
