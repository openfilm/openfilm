/**
 * The caption tracks of the open project (SPEC §1 Captions): each one's WebVTT file read once and held here, so the
 * timeline's caption row and the inspector show the same cues; written back whole by every edit, in one undo step
 * that puts the file back as the edit found it. Which cues are selected is held here too (one track at a time).
 *
 * The editor tells it how to keep an undo step (`configureCaptionTracks`) and is told when a file was written, so
 * the picture reads it again. A file the agent wrote is read again when the folder says it changed (refreshCaptionTracks).
 */
import * as React from 'react';
import { readVtt, writeVtt } from '../../../../src/captions.mjs';
import type { OutsideStep } from '@/editor/use-film';
import { withIds, type Vtt } from './caption-edits.ts';

type Entry = { vtt: Vtt | null; text: string | null; error: string | null; loading: Promise<void> | null };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
const tell = () => { version += 1; for (const fn of listeners) fn(); };
const keyOf = (projectId: string, src: string) => `${projectId}\0${src}`;

let record: ((label: string, step: OutsideStep) => void) | null = null;
let written: (() => void) | null = null;
/** How an edit keeps its undo step (the editor's history), and who hears a file was written (the picture). */
export function configureCaptionTracks(opts: { record: (label: string, step: OutsideStep) => void; written: () => void }): void {
  record = opts.record;
  written = opts.written;
}

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/caption-tracks`;

async function load(projectId: string, src: string): Promise<void> {
  const key = keyOf(projectId, src);
  const entry = entries.get(key) ?? { vtt: null, text: null, error: null, loading: null };
  entries.set(key, entry);
  const res = await fetch(`${base(projectId)}/file?src=${encodeURIComponent(src)}`).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) as { text?: string; error?: string } : {};
  if (res?.ok && typeof body.text === 'string') {
    entry.text = body.text;
    entry.vtt = withIds(readVtt(body.text));
    entry.error = null;
  } else {
    /* not there yet (a new track's file on its way), or not readable: an empty track */
    entry.vtt = withIds(readVtt(''));
    entry.text = null;
    entry.error = res?.status === 404 ? null : body.error ?? 'could not read the captions';
  }
  entry.loading = null;
  tell();
}

/** The caption tracks' files read again (the folder changed: the agent may have written one). */
export function refreshCaptionTracks(projectId: string): void {
  for (const key of entries.keys()) {
    const [id, src] = key.split('\0') as [string, string];
    if (id === projectId) void load(id, src);
  }
}

async function put(projectId: string, src: string, text: string): Promise<string | null> {
  const res = await fetch(`${base(projectId)}/file`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ src, text }) }).catch(() => null);
  if (!res?.ok) return ((await res?.json().catch(() => ({})))?.error as string | undefined) ?? 'could not write the captions';
  const entry = entries.get(keyOf(projectId, src));
  if (entry) { entry.text = text; entry.vtt = withIds(readVtt(text)); entry.error = null; }
  tell();
  written?.();
  return null;
}

/**
 * A caption track's cues, read once; `write` sends a new version of them (one undo step, `label` naming it). Null
 * while the file is first read.
 */
export function useCaptionTrack(projectId: string, src: string): { vtt: Vtt | null; write: (next: Vtt, label: string) => Promise<string | null> } {
  React.useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => version, () => version);
  const key = keyOf(projectId, src);
  const entry = entries.get(key);
  React.useEffect(() => {
    const e = entries.get(key);
    if (!e) { const fresh: Entry = { vtt: null, text: null, error: null, loading: null }; entries.set(key, fresh); fresh.loading = load(projectId, src); }
  }, [key, projectId, src]);
  const write = React.useCallback(async (next: Vtt, label: string) => {
    const before = entries.get(key)?.text ?? null;
    const text = writeVtt(next);
    if (text === before) return null;
    const why = await put(projectId, src, text);
    if (!why) {
      record?.(label, {
        undo: () => put(projectId, src, before ?? 'WEBVTT\n'),
        redo: () => put(projectId, src, text),
      });
    }
    return why;
  }, [key, projectId, src]);
  return { vtt: entry?.vtt ?? null, write };
}

/** The cues of a caption track as held now (null when not read yet): what the inspector edits. */
export const captionTrackNow = (projectId: string, src: string): Vtt | null => entries.get(keyOf(projectId, src))?.vtt ?? null;

/* ── the selection: cues of one caption track ── */

export type CaptionSelection = { src: string; ids: ReadonlySet<string> } | null;
let selection: CaptionSelection = null;
const selectionListeners = new Set<() => void>();

export function setCaptionSelection(next: CaptionSelection): void {
  const empty = !next || !next.ids.size;
  if (empty && !selection) return;
  selection = empty ? null : next;
  for (const fn of selectionListeners) fn();
}
export const captionSelectionNow = (): CaptionSelection => selection;
export function useCaptionSelection(): CaptionSelection {
  return React.useSyncExternalStore((fn) => { selectionListeners.add(fn); return () => { selectionListeners.delete(fn); }; }, () => selection, () => null);
}
