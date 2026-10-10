/**
 * The project's media as the media pane, the source viewer and the inspector see it, and the few things they need
 * from the host: where a file's bytes, poster, waveform and page surface are (`MediaSources`), and what a change came
 * to (`MediaResult`).
 *
 * The host fills a `MediaListing` from Studio's API (`GET files`, plus `media?what=probe` for lengths and sizes) with
 * `mediaListingOf`, and turns the pane's callbacks into `PUT/PATCH/DELETE files` and `POST folders`.
 */
import { clipKind } from '../../../../src/film-doc.mjs';
import { mediaFetch } from './media-queue.ts';

export type WorkspaceResourceKind = 'video' | 'image' | 'audio' | 'mg' | 'other';

/** One file of the project: a media file under assets/, or a web page (`kind: 'mg'`, one of the film's scenes). */
export interface WorkspaceResource {
  /** Project-relative path (`assets/clips/a.mp4`, `scenes/intro.html`): what clips name in film.html. */
  path: string;
  /** What the pane calls it: the file name, or a scene's name (see `pageName`). */
  name: string;
  /** Its folder under the media root ('' at the top). */
  dir: string;
  size: number;
  kind: WorkspaceResourceKind;
  mtimeMs: number;
  /**
   * The probed length. Dragging a clip onto the timeline needs it (a clip cannot be pulled longer than its source);
   * missing when it could not be probed, and the timeline then uses a cautious default.
   */
  durationMs?: number;
  /** A web page without a duration: it has no end, so on the timeline it takes a length of its own, as a still. */
  endless?: boolean;
  w?: number;
  h?: number;
  /** Source frame rate: shown, because 25 and 30 fps footage mixed in one film repeats frames after export. */
  fps?: number;
}

export interface MediaListing {
  /** The media root's own name (`assets`), so folder paths relative to it can be made project paths. */
  dir: string;
  /** Every file under the media root (the pane shows the video, images and sound among them). */
  files: readonly WorkspaceResource[];
  /** Folders under the media root, relative to it, empty ones included. */
  dirs: readonly string[];
  /**
   * Folders a person made on purpose (relative to the media root): shown while empty. Any other folder shows only
   * with media in it. Missing: every listed folder counts as made.
   */
  made?: readonly string[];
  /** The film's pages, as `kind: 'mg'` resources. */
  pages: readonly WorkspaceResource[];
}

/** Where the pane's pictures, sounds and pages come from. Addresses should carry the file's version (its mtime). */
export interface MediaSources {
  /** The file's own bytes: what the viewer plays, and a still's picture. */
  file(file: WorkspaceResource): string;
  /** A small picture of a video (or still), when there is one; undefined: none (a still then shows itself). */
  poster?(file: WorkspaceResource): string | undefined;
  /** A sound's waveform, JSON `{ peaks: number[] }` with peaks 0..1 (a 503 is asked again: still being written). */
  wave(file: WorkspaceResource): string;
  /** A web page's own poster (its middle frame); undefined falls back to the timeline's frame, then an icon. */
  pagePoster?(file: WorkspaceResource): string | undefined;
  /**
   * A web page on its own, on the film's origin with Studio's bridge in it (`openfilm-studio` seek messages,
   * `openfilm-film` ready/error answers): the viewer plays a picked scene through it. Undefined: cannot be previewed.
   */
  pageSurface?(file: WorkspaceResource): string | undefined;
}

/** What a change to the files came to: done, refused because the name is taken, or failed. */
export type MediaResult = 'ok' | 'taken' | 'failed';

/** What a probe found out about a media file (`media?what=probe`, in ms and px). */
export interface MediaFacts {
  durationMs?: number;
  endless?: boolean;
  w?: number;
  h?: number;
  fps?: number;
}

/** Studio's `GET files` answer. */
export interface FilesListing {
  files: readonly { path: string; kind: string; size: number; mtime: number }[];
  folders: readonly string[];
  pages: readonly { path: string; size: number; mtime: number }[];
}

const MEDIA_KINDS: readonly string[] = ['video', 'image', 'audio'];

/** A scene in its own folder is called after the folder (`clips/orbit/index.html` is "orbit"), else by its file name. */
export function pageName(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return /^index\.html?$/i.test(name) && path.includes('/') ? path.split('/').slice(-2)[0]! : name.replace(/\.html?$/i, '');
}

/** A probe's answer (`{ duration, width, height, fps }`, seconds) as `MediaFacts`. */
export function factsOfProbe(probe: { duration?: number; width?: number; height?: number; fps?: number } | null | undefined): MediaFacts {
  const out: MediaFacts = {};
  if (probe?.duration && probe.duration > 0) out.durationMs = Math.round(probe.duration * 1000);
  if (probe?.width) out.w = probe.width;
  if (probe?.height) out.h = probe.height;
  if (probe?.fps) out.fps = probe.fps;
  return out;
}

/** What a file is to the pane, from its name, as Studio's `GET files` says it (files.mjs kindOf). */
export function resourceKindOf(path: string): WorkspaceResourceKind {
  const kind = clipKind(path.slice(path.lastIndexOf('/') + 1));
  return kind === 'still' ? 'image' : kind === 'sound' ? 'audio' : kind === 'page' ? 'mg' : kind === 'video' ? 'video' : 'other';
}

/**
 * The pane's listing from Studio's `GET files`. `facts` adds what probes found (length, size, frame rate) per path;
 * `made` names the folders a person made (project-relative), when the host knows them.
 */
export function mediaListingOf(
  raw: FilesListing,
  facts?: (path: string) => MediaFacts | undefined,
  made?: readonly string[],
  root = 'assets',
): MediaListing {
  const rel = (path: string) => (path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path);
  const dirOf = (path: string) => { const r = rel(path); return r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : ''; };
  return {
    dir: root,
    files: raw.files.map((f) => ({
      path: f.path,
      name: f.path.slice(f.path.lastIndexOf('/') + 1),
      dir: dirOf(f.path),
      size: f.size,
      kind: (MEDIA_KINDS.includes(f.kind) ? f.kind : 'other') as WorkspaceResourceKind,
      mtimeMs: f.mtime,
      ...facts?.(f.path),
    })),
    dirs: raw.folders.filter((d) => d.startsWith(`${root}/`)).map(rel),
    ...(made ? { made: made.filter((d) => d.startsWith(`${root}/`)).map(rel) } : {}),
    pages: raw.pages.map((p) => ({
      path: p.path,
      name: pageName(p.path),
      dir: '',
      size: p.size,
      kind: 'mg' as const,
      mtimeMs: p.mtime,
      ...facts?.(p.path),
    })),
  };
}

/**
 * A file or folder name as the person typed it, less only what file systems refuse: `/ \ : * ? " < > |` and control
 * characters (a run of them, with the spaces around it, becomes one space). Spaces, `&` and every script stay; trimmed,
 * no leading dots (a hidden file the pane never lists), at most 120 characters with the extension kept. The server
 * cleans every import, rename, move and new folder by the same rule (files.mjs cleanName); this is it ahead of time,
 * so the pane knows the name a rename comes to. Empty when nothing is left.
 */
export function safeName(raw: string): string {
  const clean = String(raw ?? '').replace(/\s*[/\\:*?"<>|\u0000-\u001f\u007f]+\s*/g, ' ').trim().replace(/^[.\s]+/, '');
  if (clean.length <= 120) return clean;
  const dot = clean.lastIndexOf('.');
  const ext = dot > 0 && clean.length - dot <= 13 ? clean.slice(dot) : '';
  return `${clean.slice(0, 120 - ext.length).trimEnd()}${ext}`;
}

/** The extension a name ends in (`.mp4`), or '' when it has none: letters and digits after the last dot, 12 at most. */
const extOf = (name: string) => /\.[\p{L}\p{N}]{1,12}$/u.exec(name)?.[0] ?? '';

/**
 * Where a rename puts a file or folder: the new name beside the old one. A file renamed without an extension keeps
 * its old one. Null when the name comes out empty or unchanged (nothing to do).
 */
export function renamedPath(path: string, rawName: string, folder: boolean): string | null {
  const cut = path.lastIndexOf('/');
  const parent = cut >= 0 ? path.slice(0, cut + 1) : '';
  const current = path.slice(cut + 1);
  const safe = safeName(rawName);
  if (!safe) return null;
  const named = folder || extOf(safe) ? safe : `${safe}${extOf(current)}`;
  if (named === current) return null;
  return `${parent}${named}`;
}

/**
 * Whether renaming a file to `to` changes what it is by its ending (a picture named .mp3 would be taken for a sound):
 * the server refuses such a rename (files.mjs moveFile), and the pane says why ahead of time. Another ending of the
 * same kind (.jpeg → .jpg) is fine.
 */
export function renameChangesKind(from: string, to: string): boolean {
  return clipKind(from.slice(from.lastIndexOf('/') + 1)) !== clipKind(to.slice(to.lastIndexOf('/') + 1));
}

/**
 * Whether a name matches what was typed in the media search: case and runs of spaces ignored, so "long tone" finds
 * "long  tone" (a name's double space is hard to see, and harder to type back).
 */
export function mediaNameMatches(name: string, query: string): boolean {
  const fold = (text: string) => text.toLowerCase().replace(/\s+/g, ' ');
  const needle = fold(query).trim();
  return !needle || fold(name).includes(needle);
}

/* Waveform peaks by address; null = asked and there is none (do not ask again). Capped, oldest out first. */
const WAVE_PEAKS_MAX = 256;
const WAVE_PEAKS = new Map<string, number[] | null>();
const WAVE_FLIGHT = new Map<string, Promise<number[] | null>>();

/** Peaks already in memory, synchronously (undefined = not asked yet). */
export function warmedWavePeaks(url: string): number[] | null | undefined {
  return WAVE_PEAKS.get(url);
}

/** The waveform, asked again while the server says it is not ready yet (503: a file an agent has just written). */
async function fetchWhenReady(url: string, tries = 30): Promise<Response> {
  const res = await mediaFetch(url);
  if (res.status !== 503 || tries <= 1) return res;
  const wait = Math.min(Math.max(Number(res.headers.get('retry-after')) || 1, 0.5), 5) * 1000;
  await new Promise((done) => setTimeout(done, wait));
  return fetchWhenReady(url, tries - 1);
}

/** Load a waveform once and remember it; one request in flight per address. */
export function loadWavePeaks(url: string): Promise<number[] | null> {
  const hit = WAVE_PEAKS.get(url);
  if (hit !== undefined) return Promise.resolve(hit);
  let flight = WAVE_FLIGHT.get(url);
  if (!flight) {
    flight = fetchWhenReady(url)
      .then((res) => (res.ok ? res.json() : res.status === 503 ? undefined : null))
      .then((body: { peaks?: number[] } | null | undefined) => {
        /* still not ready after the retries: not "no waveform", so the next look asks again */
        if (body === undefined) return null;
        const peaks = body?.peaks?.length ? body.peaks : null;
        WAVE_PEAKS.set(url, peaks);
        while (WAVE_PEAKS.size > WAVE_PEAKS_MAX) WAVE_PEAKS.delete(WAVE_PEAKS.keys().next().value as string);
        return peaks;
      })
      /* a network failure is not remembered: it means "not this time", not "no waveform" */
      .catch(() => null)
      .finally(() => WAVE_FLIGHT.delete(url));
    WAVE_FLIGHT.set(url, flight);
  }
  return flight;
}

const WARMED = new Set<string>();
const WARM_POSTER_MAX = 48;

/**
 * Warm a project's thumbnails once, when the pane first opens it, so tiles show at once instead of popping in one by
 * one. Posters first (the browser queues them; low priority so they never compete with what is on screen), at most
 * the first screenful; then waveforms one at a time (the first ask of each runs ffmpeg on the server). Best effort.
 */
export function warmProjectMedia(projectId: string, listing: MediaListing | null, sources: MediaSources): void {
  if (!projectId || !listing || WARMED.has(projectId)) return;
  /* an empty project has nothing to warm: try again once it has media */
  if (!listing.files.length) return;
  WARMED.add(projectId);
  let posters = 0;
  for (const file of listing.files) {
    if (posters >= WARM_POSTER_MAX) break;
    if (file.kind !== 'video' && file.kind !== 'image') continue;
    const src = sources.poster?.(file);
    if (!src) continue;
    posters += 1;
    const img = new Image();
    img.decoding = 'async';
    img.setAttribute('fetchpriority', 'low');
    img.src = src;
  }
  void (async () => {
    for (const file of listing.files) {
      if (file.kind === 'audio') await loadWavePeaks(sources.wave(file));
    }
  })().catch(() => {});
}

/**
 * Does a clip's `src` point at this file? Clips may name a file relative to the film or with a leading folder the
 * listing does not have, so either side may be the longer one.
 */
export function srcHitsAsset(src: string, path: string): boolean {
  if (!src) return false;
  return src === path || path.endsWith(`/${src}`) || src.endsWith(`/${path}`);
}

/**
 * A clip length as the pane shows it, one way for every length: minutes and seconds ("0:05", "1:25"), hours when
 * there are any ("1:02:03"), as the Projects window shows a film's. Rounded to the second, never "0:00" for a clip
 * that has a length. Empty for an unknown or zero length, so the caller shows no badge.
 */
export function formatClipDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const total = Math.max(1, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
