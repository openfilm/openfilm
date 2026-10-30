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

export type LibraryCategory = 'transition' | 'effect' | 'filter' | 'text' | 'sticker' | 'sound';
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

/** Its name in `lang`, else English. */
export const nameOf = (names: LibraryNames, lang: Language): string => names[lang] ?? names.en;

/** A file of the library by its place there. */
export const libraryUrl = (rel: string): string => `/api/library/file?path=${encodeURIComponent(rel)}`;
export const posterUrl = (item: LibraryItem): string => libraryUrl(`${item.id}/poster.jpg`);
export const previewUrl = (item: LibraryItem): string => libraryUrl(`${item.id}/preview.mp4`);
export const waveUrl = (item: LibraryItem): string => libraryUrl(`sounds/waves/${item.id.split('/').pop()!.replace(/\.[^.]+$/, '')}.png`);

/**
 * What a drag of a page or a sound carries to the timeline (lib/resource-drag): its own page or file for the kind and
 * the preview's length, and its `openfilm/` path to be taken into the project as it lands. Null for a look or a fade:
 * they are not clips.
 */
export function libraryDragItem(item: LibraryItem, name: string): ResourceDragItem | null {
  const saved = `${BUILT_IN}/${item.id}`;
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
