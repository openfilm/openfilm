/**
 * A film's covers (studio/server/covers.mjs): each a film of one frame in `covers/<name>/`, its stage a platform's
 * size, opened in the cover studio as a compound clip's film is opened in the edit. The shapes a cover is made in,
 * where the platforms put their buttons over each, the film's shots to take a picture from, the colors a design starts
 * from, and Studio's calls for them, made on the project the covers are of.
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
  /** what kinds of film it suits (CoverLooks `categories`) */
  categories?: string[];
}

export interface CoverLooks {
  groups: { id: string; name: LibraryNames }[];
  /** the kinds of film the looks are listed by */
  categories?: { id: string; name: LibraryNames }[];
  items: CoverLook[];
}

/** The film's covers, the one it is shown by (its card, its start; null: none yet), the looks. */
export interface CoverList { covers: CoverInfo[]; main: string | null; looks: CoverLooks; made: string[] }

/** A shape a cover is made in: its size, and the platforms that show it. */
export interface CoverShape {
  id: 'landscape' | 'portrait' | 'vertical' | 'square';
  w: number;
  h: number;
  ratio: string;
}

export const COVER_SHAPES: CoverShape[] = [
  { id: 'portrait', w: 1080, h: 1440, ratio: '3:4' },
  { id: 'landscape', w: 1920, h: 1080, ratio: '16:9' },
  { id: 'vertical', w: 1080, h: 1920, ratio: '9:16' },
  { id: 'square', w: 1080, h: 1080, ratio: '1:1' },
];

/** The shape a stage is (the nearest by ratio), for its name. */
export function shapeOf(stage: { w: number; h: number }): CoverShape {
  const r = stage.w / stage.h;
  return COVER_SHAPES.reduce((best, s) => (Math.abs(Math.log(s.w / s.h / r)) < Math.abs(Math.log(best.w / best.h / r)) ? s : best));
}

/** The shapes offered first for a film of this stage: a tall film's tall ones, a wide film's wide one and the 3:4 feed's. */
export function suggestedShapes(stage: { w: number; h: number } | null | undefined): CoverShape['id'][] {
  return stage && stage.h > stage.w ? ['portrait', 'vertical'] : ['portrait', 'landscape'];
}

/** How wide a cover of this shape is seen in a feed, in px: what the small preview draws it at. */
export const FEED_WIDTH: Record<CoverShape['id'], number> = { landscape: 196, portrait: 132, vertical: 104, square: 132 };

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
      crop: { x: 0, y: (1 - (9 / 16) * (4 / 3)) / 2, w: 1, h: (9 / 16) * (4 / 3) },
    };
  }
  return { covered: [] };
}

/** Colors and gradients a design starts from: plain CSS (the server takes only these forms). */
export const COVER_COLORS: string[] = [
  '#111111', '#f4f1ea', '#ffffff', '#ff4d2e', '#ffd60a', '#2b59ff', '#00a86b', '#7a3cff',
  'linear-gradient(135deg, #111111 0%, #3a3a3a 100%)',
  'linear-gradient(135deg, #ff5a1f 0%, #ffd60a 100%)',
  'linear-gradient(135deg, #2b59ff 0%, #00c1cd 100%)',
  'linear-gradient(160deg, #1b1035 0%, #7a3cff 55%, #ff4d8d 100%)',
  'linear-gradient(180deg, #0b1d3a 0%, #1f6f8b 100%)',
  'radial-gradient(circle at 30% 30%, #ffe8c2 0%, #f29a6b 60%, #7a2e3a 100%)',
];

/** The moment of the film a cover's picture was taken at (`frame-<ms>.jpg`), in seconds; null for none. */
export function frameMoment(src: string | undefined): number | null {
  const m = /(?:^|\/)frame-(\d+)\.jpg$/.exec(src ?? '');
  return m ? Number(m[1]) / 1000 : null;
}

/** A clip that is a cover's picture (a moment of the film, a picture, a color), as the server names it. */
export const isCoverPicture = (c: { id?: string; src: string }): boolean =>
  c.id === 'frame' || /(?:^|\/)(frame-\d+\.jpg|color-[0-9a-f]+\.html)$/.test(c.src);
/** A clip that is a cover's look. */
export const isCoverLook = (c: { id?: string; src: string }): boolean => c.id === 'look' || /^look-[^/]+\.html$/.test(c.src);

const AUDIO = /\.(mp3|wav|m4a|aac|ogg|flac|opus|aiff?)(#|$)/i;

/** The film's shots, a moment in the middle of each picture clip (seconds), in time order: what a picture is taken from. */
export function filmShots(film: { tracks: readonly { clips: readonly { src: string; at?: number; time?: readonly number[] }[] }[] } | null | undefined): number[] {
  const at = new Set<number>();
  for (const track of film?.tracks ?? []) {
    for (const c of track.clips) {
      if (AUDIO.test(c.src) || c.time?.length !== 2) continue;
      at.add(Math.round(((c.at ?? 0) + (c.time[1]! - c.time[0]!) / 2) * 10) / 10);
    }
  }
  return [...at].sort((a, b) => a - b).slice(0, 60);
}

/** A look's picture. */
export const lookPoster = (look: CoverLook): string => libraryUrl(`covers/${look.poster}`);
/** A look's page, as the library serves it (tried on a cover before it is put on). */
export const libraryLookPage = (look: CoverLook): string => libraryUrl(`covers/${look.src}`);

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
export interface CoverClip { id: string; src: string; time: [number, number]; box?: { x: number; y: number; w: number; h: number }; style?: string; attrs?: Record<string, string> }

/** What a new cover's picture is: a moment of the film, a picture of the project, a color, or none. */
export type CoverOrigin = { at?: number; picture?: string; color?: string };

export const coversApi = {
  list: (projectId: string) => call<CoverList>(projectId, 'covers'),
  /** a new cover in `stage`: its picture from `origin`, `look` over it; or `from` a cover copied to this shape */
  make: (projectId: string, ask: { name: string; stage: { w: number; h: number }; look?: string; from?: string } & CoverOrigin) =>
    call<{ folder: string }>(projectId, 'covers', ask),
  open: (projectId: string, folder: string) => call<{ project: { id: string } }>(projectId, 'covers/open', { folder }),
  frame: (projectId: string, folder: string, at: number) => call<{ clip: CoverClip }>(projectId, 'covers/frame', { folder, at }),
  picture: (projectId: string, folder: string, ask: { picture: string } | { color: string }) => call<{ clip: CoverClip }>(projectId, 'covers/picture', { folder, ...ask }),
  look: (projectId: string, folder: string, look: string) => call<{ clip: CoverClip }>(projectId, 'covers/look', { folder, look }),
  main: (projectId: string, folder: string) => call<{ main: string }>(projectId, 'covers/main', { folder }),
  /** a cover put back as it was (its film.html then), or one made in a cancelled design taken away */
  restore: (projectId: string, folder: string, text: string) => call<object>(projectId, 'covers/restore', { folder, text }),
  discard: (projectId: string, folder: string) => call<object>(projectId, 'covers/discard', { folder }),
  /** covers drawn as pictures: into `folder` (none: the exports folder), shown there unless `reveal` is false */
  draw: (projectId: string, folders: string[], format: 'jpg' | 'png' = 'jpg', where: { folder?: string; reveal?: boolean } = {}) =>
    call<{ files: string[] }>(projectId, 'covers/draw', { folders, format, ...where }),
  /** how long the film is, in seconds (null: it has no end) */
  length: async (projectId: string) => {
    const facts = await call<{ duration?: number }>(projectId, 'media?what=probe&path=film.html').catch(() => null);
    return facts?.duration ?? null;
  },
  /** a picture of this computer put in the project's `assets/` (a taken name gets a number): where it landed */
  upload: async (projectId: string, file: File): Promise<string> => {
    const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files?path=${encodeURIComponent(`assets/${file.name}`)}`, { method: 'PUT', body: file });
    const body = await r.json().catch(() => ({})) as { path?: string; error?: string };
    if (!r.ok || !body.path) throw new Error(body.error ?? `${r.status}`);
    return body.path;
  },
};
