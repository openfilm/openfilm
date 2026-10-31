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

/** What a path names OpenFilm's library by, as `saved/` names Saved. */
export const BUILT_IN = 'openfilm';

export type LibraryCategory = 'transition' | 'effect' | 'filter' | 'text' | 'sticker' | 'sound' | 'music';
export type LibraryNames = Partial<Record<Language, string>> & { en: string };

export interface LibraryItem {
  /** Its place in the library (`effects/snow`, `sounds/whoosh.m4a`). */
  id: string;
  cat: LibraryCategory;
  group: string;
  name: LibraryNames;
  kind: 'page' | 'sound' | 'look' | 'fade';
  durationMs?: number;
  /** A page: its clip's page (in its bundle's files/, with the stretch it plays), and a size of its own. */
  src?: string;
  w?: number;
  h?: number;
  /** A transition page: its middle goes on the cut. */
  place?: 'cut';
  /** A look: the CSS `filter` it writes. */
  filter?: string;
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
const listeners = new Set<() => void>();

function readIndex(): Promise<LibraryIndex | null> {
  reading ??= fetch('/api/library', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null), () => null)
    .then((body: LibraryIndex | null) => {
      if (body && Array.isArray(body.items)) { index = body; for (const fn of listeners) fn(); }
      else reading = null;
      return index;
    });
  return reading;
}

/** The library's index, once read (null before). */
export function useLibraryIndex(): LibraryIndex | null {
  const seen = React.useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => index,
    () => index,
  );
  React.useEffect(() => { if (!index) void readIndex(); }, []);
  return seen;
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

/** A file of the library by its place there. */
export const libraryUrl = (rel: string): string => `/api/library/file?path=${encodeURIComponent(rel)}`;
/** A page of the library, served as a page (for a try over the viewer's picture). */
export const pageUrl = (item: LibraryItem): string => `/api/library/page?path=${encodeURIComponent(`${item.id}/files/${item.src ?? ''}`)}`;
export const posterUrl = (item: LibraryItem): string => libraryUrl(`${item.id}/poster.jpg`);
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
  if (item.kind === 'sound') return { path: saved, name, kind: 'audio', ...(item.durationMs ? { durationMs: item.durationMs } : {}), saved };
  if (item.kind !== 'page' || !item.src) return null;
  return {
    path: `${saved}/files/${item.src.split('#')[0]}`,
    name,
    kind: 'mg',
    ...(item.durationMs ? { durationMs: item.durationMs } : {}),
    ...(item.w && item.h ? { w: item.w, h: item.h } : { reflows: true }),
    saved,
  };
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

/** A clip's style with a look's filter in place of its own (null: none of its own left). */
export function withLook(style: string | undefined, filter: string | null): string | null {
  const next = withDeclarations(style ?? '', { filter });
  return next || null;
}

/** The look a clip's style has, when it is one of the library's. */
export function lookOf(style: string | undefined, items: readonly LibraryItem[]): LibraryItem | null {
  const filter = declared(style ?? '', 'filter');
  return filter ? items.find((item) => item.kind === 'look' && item.filter === filter) ?? null : null;
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

/** Star a thing, or take its star away: shown at once, then kept. */
export function toggleFavorite(id: string): void {
  const had = favorites ?? [];
  favorites = had.includes(id) ? had.filter((x) => x !== id) : [...had, id];
  tellStarred();
  void fetch('/api/library/favorites', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: favorites }) })
    .then((r) => (r.ok ? r.json() : null), () => null)
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
