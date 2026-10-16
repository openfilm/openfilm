/**
 * What the person saved, as every part of Studio sees it: one list, read once and again after each change (a clip saved
 * from the timeline shows in the media pane's Saved view at once).
 */
import React from 'react';
import { api, type SavedItem } from '@/api';
import type { ResourceDragItem, ResourceKind } from './resource-drag';

let items: SavedItem[] | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const tell = () => { for (const fn of listeners) fn(); };

/** Read the list again (after a change made here, or to see one made by another Studio). */
export function refreshSaved(): Promise<void> {
  loading = api.saved().then((next) => { items = next; tell(); }, () => { items ??= []; tell(); }).finally(() => { loading = null; });
  return loading;
}

/** The list (null until read). */
export function useSaved(): SavedItem[] | null {
  const list = React.useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => items,
    () => null,
  );
  React.useEffect(() => { if (!items && !loading) void refreshSaved(); }, []);
  return list;
}

const KIND: Array<[RegExp, ResourceKind]> = [
  [/\.html?$/i, 'mg'],
  [/\.(mp4|m4v|mov|webm|mkv|avi|ogv)$/i, 'video'],
  [/\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i, 'image'],
  [/\.(mp3|m4a|wav|aac|ogg|oga|opus|flac|aiff?|weba)$/i, 'audio'],
];

/** What kind of media a saved thing is, by its file. */
export function savedKind(item: Pick<SavedItem, 'main'>): ResourceKind {
  return KIND.find(([re]) => re.test(item.main))?.[1] ?? 'other';
}

/**
 * A saved thing dragged onto the timeline: as a file of the media pane is, so the timeline draws it where it would go,
 * with `saved` saying what it is (its files are brought into the project as it lands).
 */
export function savedDragItem(item: SavedItem): ResourceDragItem {
  return {
    path: item.main,
    name: item.name,
    kind: savedKind(item),
    saved: item.id,
    ...(item.durationMs ? { durationMs: item.durationMs } : {}),
    ...(item.w ? { w: item.w } : {}),
    ...(item.h ? { h: item.h } : {}),
  };
}
