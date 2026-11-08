/**
 * OpenFilm's library as the assets drawer shows it (studio/server/library.mjs): its index, read once, and what each
 * thing of it is on the timeline. Pages and sounds go in as things of Saved go (a drag or "+": lib/saved, the server's
 * `saved/take` with an `openfilm/` path); a look is written into the picked clips' style; a fade is one of the
 * timeline's transitions (lib/transitions), put on a cut.
 */
import React from 'react';
import type { Language } from '../i18n';
import type { ResourceDragItem } from './resource-drag';
import type { TransitionKind } from './transitions';
import { declared, withDeclarations } from './clip-look.ts';
import { gradeFilter, gradeOf, withGrade, type Grade } from './grade.ts';

/** What a path names OpenFilm's library by, as `saved/` names Saved. */
export const BUILT_IN = 'openfilm';

export type LibraryCategory = 'transition' | 'effect' | 'filter' | 'text' | 'sticker' | 'sound' | 'music' | 'template';
export type LibraryNames = Partial<Record<Language, string>> & { en: string };

export interface LibraryItem {
  /** Its place in the library (`effects/snow`, `sounds/whoosh.m4a`). */
  id: string;
  cat: LibraryCategory;
  group: string;
  name: LibraryNames;
  kind: 'page' | 'sound' | 'look' | 'fade' | 'textstyle' | 'textmotion' | 'group' | 'motion';
  durationMs?: number;
  /** A page: its clip's page (in its bundle's files/, with the stretch it plays), and a size of its own. */
  src?: string;
  w?: number;
  h?: number;
  /** Of the picture's height its box takes when put in (libraryBox), and whether it goes low (a line below). */
  fit?: number;
  low?: boolean;
  /** A transition page: its middle goes on the cut. */
  place?: 'cut';
  /** A look: its color grade (lib/grade), and the CSS `filter` it writes at full strength (made from the grade as the index is read). */
  grade?: Grade;
  filter?: string;
  /** A look: the picture it is shown on in the drawer, by its place in the library (its group's). */
  sample?: string;
  /** Its picture in the drawer when not its bundle's poster.jpg (an emoji's own picture), by its place in the library. */
  poster?: string;
  /** Nothing moves in it to preview under the pointer. */
  still?: boolean;
  /** Words it is found by, besides its name. */
  tags?: string[];
  /** Who sent it to the library (their GitHub name): a community thing; none: OpenFilm's own. */
  by?: string;
  /** A piece of music's cover, by its place in the library (none: one drawn, coverLook). */
  cover?: string;
  /** A text style (word art) or a text motion: values of the text component's variables (library/text/text). */
  vars?: Record<string, string>;
  /** A template (a group of clips): how many of its clips are places for the person's own pictures, and its music (a piece of the library's, by its id). */
  slots?: number;
  music?: string;
  /** A motion preset (src/clip-motion.mjs withPreset): how a clip comes in, goes out, moves while shown; on a cut, the
   *  clip before it goes out and the one after comes in. */
  motion?: Partial<Record<'in' | 'out' | 'loop', { name: string; body: string; secs: number; ease: string }>>;
  /** A transition of two shots moving at once (a push, a wipe): the incoming clip overlaps the outgoing one by its
      length, coming in by `motion.in` while that one goes out by `motion.out` (lib/clip-presets withCutMove). */
  lap?: boolean;
  /** A fade: which of the timeline's transitions. */
  fade?: Extract<TransitionKind, 'dissolve' | 'dip-black' | 'dip-white'>;
}

export interface LibraryIndex {
  version: number;
  groups: Partial<Record<LibraryCategory, { id: string; name: LibraryNames }[]>>;
  items: LibraryItem[];
}

let index: LibraryIndex | null = null;
let reading: Promise<LibraryIndex | null> | null = null;
let readAt = 0;
const listeners = new Set<() => void>();

function readIndex(): Promise<LibraryIndex | null> {
  if (index && Date.now() - readAt < 60_000) return Promise.resolve(index);
  reading ??= fetch('/api/library', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((body: LibraryIndex | null) => {
      if (body && Array.isArray(body.items)) {
        for (const item of body.items) if (item.grade && !item.filter) item.filter = gradeFilter(item.id, item.grade);
        index = body;
        readAt = Date.now();
        for (const fn of listeners) fn();
      }
      return index;
    }).catch(() => index).finally(() => { reading = null; });
  return reading;
}

/** The library's index, once read (null before). */
export function useLibraryIndex(refresh = false): LibraryIndex | null {
  const seen = React.useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => index,
    () => index,
  );
  React.useEffect(() => {
    void readIndex();
    if (!refresh) return;
    const timer = window.setInterval(() => { if (!document.hidden) void readIndex(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return seen;
}

/* the library's things by the folder a project keeps each in (server takeSaved: its id as one name) */
let byFolder: { of: LibraryIndex; map: Map<string, LibraryItem> } | null = null;

/**
 * The thing of the library a clip is (its page under `saved/openfilm/<id as one name>/`, or a template put in as one
 * compound clip, its film under `parts/templates-<id>[-n]/`), when the index has been read: what the timeline and Layers
 * call it (every emoji's page is `emoji.html`; its name is its own).
 */
export function libraryItemOfClip(src: string | undefined): LibraryItem | null {
  const path = src?.split('#')[0] ?? '';
  const m = /^saved\/openfilm\/([^/]+)\//.exec(path) ?? /^parts\/(templates-[^/]+?)(?:-\d+)?\/film\.html$/.exec(path);
  if (!m || !index) return null;
  if (byFolder?.of !== index) byFolder = { of: index, map: new Map(index.items.map((item) => [item.id.replace(/\//g, '-'), item])) };
  return byFolder.map.get(m[1]!) ?? null;
}

/** A thing of the library by its `openfilm/` path, when the index has been read and has it. */
export function builtInItem(path: string | null | undefined): LibraryItem | null {
  if (!path || !index || !path.startsWith(`${BUILT_IN}/`)) return null;
  const id = path.slice(BUILT_IN.length + 1);
  return index.items.find((item) => item.id === id) ?? null;
}

/**
 * Whether a project file came from the library: a page taken from it (its bundle under `saved/openfilm/`, as the
 * server's takeSaved puts it), or one of its sounds or pieces of music, put in assets/ under its own name.
 */
export function fromLibrary(path: string, items: readonly LibraryItem[] | null = index?.items ?? null): boolean {
  if (path.startsWith(`saved/${BUILT_IN}/`)) return true;
  const sound = /^assets\/([^/]+)$/.exec(path)?.[1];
  return Boolean(sound && items?.some((item) => item.kind === 'sound' && item.id.endsWith(`/${sound}`)));
}

/** Its name in `lang`, else English. */
export const nameOf = (names: LibraryNames, lang: Language): string => names[lang] ?? names.en;

/**
 * What a new line of words says until it is typed in: "Default text", in English whatever the app's language, as every
 * thing of the library says its own words in English.
 */
export function defaultTextWords(): string {
  return builtInItem(`${BUILT_IN}/${TEXT_COMPONENT}`)?.name.en ?? 'Default text';
}

/** A file of the library by its place there. */
/* `v`: the pictures were drawn again in place (2026-10-31): a copy kept from before is not used */
export const libraryUrl = (rel: string): string => `/api/library/file?path=${encodeURIComponent(rel)}&v=2`;
/** A page of the library, served as a page (for a try over the viewer's picture). */
export const pageUrl = (item: LibraryItem): string => `/api/library/pages/${`${item.id}/files/${item.src ?? ''}`.split('/').map(encodeURIComponent).join('/')}`;
export const posterUrl = (item: LibraryItem): string => libraryUrl(item.poster ?? `${item.id}/poster.jpg`);
export const previewUrl = (item: LibraryItem): string => libraryUrl(`${item.id}/preview.mp4`);
/** A sound's waveform, beside it in waves/ (`sounds/whoosh.m4a` → `sounds/waves/whoosh.png`). */
export const waveUrl = (item: LibraryItem): string => libraryUrl(item.id.replace(/([^/]+)\.[^./]+$/, 'waves/$1.png'));

/**
 * What a drag carries to the timeline (lib/resource-drag): a page or a sound its own page or file for the kind and the
 * preview's length, and its `openfilm/` path to be taken into the project as it lands; a look or a fade what it goes
 * on (`apply`: a clip, a cut), being no clip itself.
 */
export function libraryDragItem(item: LibraryItem, name: string): ResourceDragItem | null {
  const saved = `${BUILT_IN}/${item.id}`;
  if (item.kind === 'look' || item.kind === 'fade') return { path: saved, name, kind: 'other', saved, apply: item.kind };
  /* a transition that moves the two shots: onto a cut, as a fade goes */
  if (item.kind === 'motion' && item.place === 'cut') return { path: saved, name, kind: 'other', saved, apply: 'fade' };
  if (item.kind === 'sound') return { path: saved, name, kind: 'audio', ...(item.durationMs ? { durationMs: item.durationMs } : {}), saved };
  if (item.kind === 'group') return { path: saved, name, kind: 'mg', ...(item.durationMs ? { durationMs: item.durationMs } : {}), saved };
  /* a text style: a new line of words in it (the drop takes the text component with its variables) */
  if (item.kind === 'textstyle') {
    const text = builtInItem(`${BUILT_IN}/${TEXT_COMPONENT}`);
    const drag = text ? libraryDragItem(text, name) : null;
    return drag ? { ...drag, ...(item.w && item.h ? { w: item.w, h: item.h } : {}), saved } : null;
  }
  if (item.kind !== 'page' || !item.src) return null;
  return {
    ...(item.id === TEXT_COMPONENT ? { words: defaultTextWords() } : {}),
    path: `${saved}/files/${item.src.split('#')[0]}`,
    name,
    kind: 'mg',
    ...(item.durationMs ? { durationMs: item.durationMs } : {}),
    ...(item.w && item.h ? { w: item.w, h: item.h } : { reflows: true }),
    saved,
  };
}

/** Where a template's clip goes on any picture (its `data-place`): its middle, and its height of the picture's. */
export const PLACE_ATTR = 'data-place';
type GroupClip = { track: number; at: number; clip: Record<string, unknown> & { attrs?: Record<string, string> } };

/**
 * A template's clips (a group of the library) made for this picture: one with a place of its own (`data-place`,
 * `{"x":0.5,"y":0.82,"fit":0.18}` with its page's own `size`) gets a box there at that share of the picture's
 * height, at most as wide as the picture, so one template fits wide and tall films alike; the attribute goes.
 */
export function placedGroup<C extends GroupClip>(clips: readonly C[], stage: { w: number; h: number }): C[] {
  return clips.map((c) => {
    const raw = c.clip.attrs?.[PLACE_ATTR];
    const size = c.clip.size as { w: number; h: number } | undefined;
    if (!raw) return c;
    const { [PLACE_ATTR]: _place, ...attrs } = c.clip.attrs!;
    const clip: C['clip'] = { ...c.clip };
    if (Object.keys(attrs).length) clip.attrs = attrs; else delete clip.attrs;
    let place: { x?: number; y?: number; fit?: number };
    try { place = JSON.parse(raw); } catch { return { ...c, clip }; }
    if (!size?.w || !size.h) return { ...c, clip };
    let h = Math.round(stage.h * (place.fit ?? 0.3));
    let w = Math.round(h * (size.w / size.h));
    const most = Math.round(stage.w * 0.92);
    if (w > most) { w = most; h = Math.round(w * (size.h / size.w)); }
    const x = Math.round(stage.w * (place.x ?? 0.5) - w / 2), y = Math.round(stage.h * (place.y ?? 0.5) - h / 2);
    return { ...c, clip: { ...clip, box: { x: Math.max(0, Math.min(stage.w - w, x)), y: Math.max(0, Math.min(stage.h - h, y)), w, h }, size: { w, h } } };
  });
}

/** A transition page put down near a cut: its start moved so its middle is on the cut, when one is that near. */
export function onCut(atSec: number, durationMs: number, cutsSec: readonly number[], nearSec = 0.5): number {
  const half = durationMs / 2000;
  let best: number | null = null;
  for (const cut of cutsSec) {
    /* dropped with its start on the cut (it snaps to edges), or its middle near it */
    const off = Math.min(Math.abs(atSec - cut), Math.abs(atSec + half - cut));
    if (off <= nearSec && (best == null || off < Math.abs(Math.min(Math.abs(atSec - best), Math.abs(atSec + half - best))))) best = cut;
  }
  return best == null ? atSec : Math.max(0, Math.round((best - half) * 1000) / 1000);
}

/**
 * A clip's style with a look's filter in place of the look it has (null `filter`: taken off), its own adjustments
 * kept (lib/grade). Null: no style left.
 */
export function withLook(style: string | undefined, filter: string | null): string | null {
  const next = withDeclarations(style ?? '', { filter: withGrade(declared(style ?? '', 'filter'), filter) });
  return next || null;
}

/** The look a clip's style has, when it is one of the library's, and how strong (0–1). */
export function lookOf(style: string | undefined, items: readonly LibraryItem[]): { item: LibraryItem; amount: number } | null {
  const now = gradeOf(declared(style ?? '', 'filter'));
  const item = now && items.find((i) => i.kind === 'look' && i.id === now.id);
  return item && now ? { item, amount: now.amount } : null;
}

type Spans = readonly { docIndex?: number | null; blocks: readonly { clipId?: string | null; startMs: number; endMs: number }[] }[];

/** Every cut and edge of the clips on the timeline, in seconds: where a transition page may go. */
export function cutsOf(tracks: Spans): number[] {
  return [...new Set(tracks.flatMap((tr) => tr.blocks.flatMap((b) => (b.clipId ? [b.startMs / 1000, b.endMs / 1000] : []))))];
}

/**
 * The track a transition page goes on, dropped on `track` from `atSec` for `durationMs`: that track when it has room
 * there, else a new one just above it, so it never pushes or cuts what is under it.
 */
export function cutTrack(tracks: Spans, track: number | { insert: number } | undefined, atSec: number, durationMs: number): number | { insert: number } {
  if (track == null) return { insert: 0 };
  if (typeof track === 'object') return track;
  const start = atSec * 1000, end = start + durationMs;
  const lane = tracks.find((tr) => tr.docIndex === track);
  return lane?.blocks.some((b) => b.clipId && b.startMs < end - 1 && b.endMs > start + 1) ? { insert: track } : track;
}

let favorites: readonly string[] | null = null;
const starred = new Set<() => void>();
const tellStarred = () => { for (const fn of starred) fn(); };

/** The things the person starred (their ids), kept for every OpenFilm on this computer; empty until read. */
export function useLibraryFavorites(): readonly string[] {
  const seen = React.useSyncExternalStore(
    (fn) => { starred.add(fn); return () => { starred.delete(fn); }; },
    () => favorites,
    () => favorites,
  );
  React.useEffect(() => {
    if (favorites) return;
    void fetch('/api/library/favorites', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null), () => null).then((body: { ids?: string[] } | null) => {
      if (body && Array.isArray(body.ids)) { favorites = body.ids; tellStarred(); }
    });
  }, []);
  return seen ?? [];
}

/* ── what of the library is here: a sound, a piece of music, a template's music are fetched before they go in ── */

/** Whether a thing may need fetching before it goes in (a published part of the library, or a template's music). */
export const mayNeedFetch = (item: Pick<LibraryItem, 'id' | 'music'>): boolean => item.id.startsWith('audio/') || item.id.startsWith('stickers/emoji/') || item.id.startsWith('community/') || Boolean(item.music);
const asked = new Set<string>();
/** asked, not answered yet: shown as to be fetched, never as one to put in that is not here */
const asking = new Set<string>();
const missing = new Set<string>();
const fetching = new Set<string>();
const failed = new Set<string>();
let hereTick = 0;
const hereSeen = new Set<() => void>();
const tellHere = () => { hereTick += 1; for (const fn of hereSeen) fn(); };

/** Ask, once each, which of these things need fetching before they go in (the server says). */
export function askHere(ids: readonly string[]): void {
  const fresh = ids.filter((id) => !asked.has(id));
  if (!fresh.length) return;
  for (const id of fresh) { asked.add(id); asking.add(id); }
  tellHere();
  void fetch('/api/library/missing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: fresh }) })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((body: { ids?: string[] } | null) => {
      const absent = new Set(body?.ids ?? []);
      for (const id of fresh) {
        /* A preview may already have fetched it while this older availability lookup was in flight. */
        if (!asking.delete(id)) continue;
        if (!body) asked.delete(id);
        else if (absent.has(id)) missing.add(id);
      }
      tellHere();
    });
}

const fetchJobs = new Map<string, Promise<boolean>>();

/** Preview and insertion share the same download, including a double click while the preview is being prepared. */
export function fetchLibraryItem(id: string): Promise<boolean> {
  const pending = fetchJobs.get(id);
  if (pending) return pending;
  const job = (async () => {
    fetching.add(id);
    failed.delete(id);
    tellHere();
    try {
      const r = await fetch('/api/library/fetch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
      const ok = r.ok && Boolean(((await r.json()) as { ok?: boolean }).ok);
      if (ok) heardHere(id); else failed.add(id);
      return ok;
    } catch {
      failed.add(id);
      return false;
    } finally {
      fetchJobs.delete(id);
      fetching.delete(id);
      tellHere();
    }
  })();
  fetchJobs.set(id, job);
  return job;
}

/** A thing heard in full (a sound played): here now. */
export function heardHere(id: string): void {
  const was = missing.delete(id), pending = asking.delete(id), hadFailed = failed.delete(id);
  asked.add(id);
  if (hadFailed || was || pending) tellHere();
}

/** Where a thing is: here, to be fetched, being fetched, or its fetch failed. */
export type HereState = 'here' | 'missing' | 'fetching' | 'failed';

/** What of the library is here, kept current as things are fetched. */
export function useLibraryHere(): (id: string) => HereState {
  React.useSyncExternalStore((fn) => { hereSeen.add(fn); return () => { hereSeen.delete(fn); }; }, () => hereTick, () => hereTick);
  return (id) => (fetching.has(id) ? 'fetching' : failed.has(id) ? 'failed' : missing.has(id) || asking.has(id) ? 'missing' : 'here');
}

/** Star a thing, or take its star away: shown at once, then kept. */
export function toggleFavorite(id: string): void {
  const had = favorites ?? [];
  favorites = had.includes(id) ? had.filter((x) => x !== id) : [...had, id];
  tellStarred();
  void fetch('/api/library/favorites', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: favorites }) })
    .then((r) => (r.ok ? r.json() : null))
    .then((body: { ids?: string[] } | null) => { if (body && Array.isArray(body.ids)) { favorites = body.ids; tellStarred(); } });
}

/** A number from 0 to 1 that a string always gives (FNV-1a), the `n`th of a string's own. */
export function seeded(text: string, n: number): number {
  let h = 2166136261 ^ n;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/* each group of sounds its own colors (a hue and how far it ranges), each mood of music its own */
const SOUND_HUES: Record<string, [number, number]> = {
  transition: [220, 50], ui: [180, 35], impact: [355, 35], ambience: [150, 40], foley: [28, 30], nature: [95, 45],
  animals: [48, 30], people: [320, 35], tech: [205, 40], cartoon: [290, 60], stings: [42, 25], vehicles: [210, 20],
};
const MUSIC_HUES: Record<string, [number, number, number]> = {
  /* hue, range, how bright */
  upbeat: [28, 40, 62], warm: [22, 30, 58], emotional: [235, 45, 46], calm: [185, 40, 52], cinematic: [38, 25, 40],
  tense: [355, 25, 32], electronic: [285, 80, 50], lofi: [265, 60, 48], playful: [320, 90, 64], corporate: [210, 25, 50],
  festive: [0, 120, 52],
};
const spot = (x: number, y: number, r: number, color: string) => `radial-gradient(circle at ${x}% ${y}%, ${color} 0%, transparent ${r}%)`;

/** A sound's tile: soft light in its group's colors, its own arrangement of them (from its id), the same each time. */
export function soundLook(item: Pick<LibraryItem, 'id' | 'group'>): { background: string } {
  const [from, span] = SOUND_HUES[item.group] ?? [200, 40];
  const hue = (n: number) => Math.round((from + seeded(item.id, n) * span + 360) % 360);
  const spots = [0, 1, 2].map((i) => spot(Math.round(10 + seeded(item.id, 10 + i) * 80), Math.round(10 + seeded(item.id, 20 + i) * 80),
    Math.round(40 + seeded(item.id, 30 + i) * 30), `hsl(${hue(i + 1)} 70% ${Math.round(52 + seeded(item.id, 40 + i) * 18)}%)`));
  return { background: `${spots.join(', ')}, hsl(${hue(0)} 45% 26%)` };
}

/**
 * A piece of music's cover: its mood's colors as soft light, and one motif of its own (rings, a sun, stripes or
 * waves, from its id), the same each time. Drawn, not a picture: free, small, and no rights to clear.
 */
export function coverLook(item: Pick<LibraryItem, 'id' | 'group'>): { background: string } {
  const [from, span, light] = MUSIC_HUES[item.group] ?? [210, 60, 50];
  const s = (n: number) => seeded(item.id, n);
  const hue = (n: number) => Math.round((from + s(n) * span + 360) % 360);
  /* the last light leans off its mood's colors, so covers of one mood still differ */
  const glow = [0, 1, 2].map((i) => spot(Math.round(s(10 + i) * 100), Math.round(s(20 + i) * 100), Math.round(40 + s(30 + i) * 35),
    `hsl(${i === 2 ? (hue(3) + 40 + Math.round(s(43) * 50)) % 360 : hue(i + 1)} 78% ${Math.round(light + (s(40 + i) - 0.5) * 26)}%)`));
  const line = `hsl(${hue(5)} 90% 94% / 0.32)`;
  const x = Math.round(25 + s(50) * 50);
  const y = Math.round(25 + s(51) * 50);
  const motifs = [
    `repeating-radial-gradient(circle at ${x}% ${y}%, transparent 0 9px, ${line} 9px 10px)`,
    `radial-gradient(circle at ${x}% ${y}%, hsl(${hue(6)} 95% 78% / 0.85) 0 14%, transparent 15%)`,
    `repeating-linear-gradient(${Math.round(s(52) * 180)}deg, transparent 0 7px, ${line} 7px 8px)`,
    `repeating-radial-gradient(ellipse 160% 60% at 50% ${y + 40}%, transparent 0 8px, ${line} 8px 9px)`,
  ];
  const motif = motifs[Math.floor(s(53) * motifs.length)]!;
  return { background: `${motif}, ${glow.join(', ')}, hsl(${hue(0)} 50% ${Math.round(light * 0.45)}%)` };
}

/** The library's text component: a line of words whose look and motion are its CSS variables. */
export const TEXT_COMPONENT = 'text/text';
/** Where a project keeps it once taken (server takeSaved: `saved/openfilm/<id as one name>/`). */
const TEXT_IN_PROJECT = `saved/${BUILT_IN}/${TEXT_COMPONENT.replace('/', '-')}/`;

/**
 * Whether a clip is a thing of the library (a sticker, an effect, a title, a line of words: taken into the project
 * under `saved/openfilm/`): one thing on the picture, picked and moved whole, never by the parts its page is made of.
 */
export const isLibraryClip = (src: string | undefined): boolean => Boolean(src?.split('#')[0]?.startsWith(`saved/${BUILT_IN}/`));
/** Whether a clip is one of the library's stickers: drawn on the timeline by its picture. */
export const isLibrarySticker = (src: string | undefined): boolean => Boolean(src?.split('#')[0]?.startsWith(`saved/${BUILT_IN}/stickers-`));

/**
 * A filter of the library on a track of its own: its see-through page, taken into the project under the filter's name
 * (`saved/openfilm/filters-warm-film/layer.html`, studio/server saved.mjs FILTER_LAYER), the clip's `backdrop-filter`
 * grading every layer under it while it is on.
 */
export const isFilterLayer = (src: string | undefined): boolean => /^saved\/openfilm\/filters-[^/]+\/layer\.html$/.test(src?.split('#')[0] ?? '');

/** An effect of the library (its page laid over the whole picture). */
export const isLibraryEffect = (src: string | undefined): boolean => Boolean(src?.split('#')[0]?.startsWith(`saved/${BUILT_IN}/effects-`));

/** Whether a clip is the text component, which a text style or motion goes on. */
export const isTextClip = (src: string | undefined): boolean => Boolean(src?.split('#')[0]?.startsWith(TEXT_IN_PROJECT));

/** A clip's overrides with `vars` set in its `:root` entry (the page's CSS variables), the rest as they were. */
export function withRootVars(overrides: readonly unknown[] | undefined, vars: Record<string, string>): Record<string, unknown>[] {
  const list = (overrides ?? []).map((o) => ({ ...(o as Record<string, unknown>) }));
  const root = list.find((o) => o.at === ':root' && o.n === undefined);
  const style = { ...((root?.style as Record<string, string> | undefined) ?? {}), ...vars };
  if (root) root.style = style;
  else list.push({ at: ':root', style });
  return list;
}

/**
 * Where a thing of the library with a shape of its own (a sticker, a line of words) goes on the picture when put in:
 * in its middle (a line below, `low`, near the bottom), `fit` of the picture's height (a third by default), as wide as
 * its shape says but no wider than nine tenths of the picture. Null for one without a shape: it covers the picture.
 */
export function libraryBox(item: Pick<LibraryItem, 'w' | 'h' | 'fit' | 'low'> | null | undefined, stage: { w: number; h: number }): { x: number; y: number; w: number; h: number } | null {
  if (!item?.w || !item.h) return null;
  let h = Math.round(stage.h * (item.fit ?? 0.3));
  let w = Math.round(h * (item.w / item.h));
  const most = Math.round(stage.w * 0.9);
  if (w > most) { w = most; h = Math.round(w * (item.h / item.w)); }
  const y = item.low ? Math.round(stage.h * 0.84 - h / 2) : Math.round((stage.h - h) / 2);
  return { x: Math.round((stage.w - w) / 2), y, w, h };
}
