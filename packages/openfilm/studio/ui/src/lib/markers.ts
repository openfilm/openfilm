/**
 * Markers: named, colored places on the film (M on the ruler), or on a clip (M with a clip selected under the
 * playhead), which then moves with the clip. Studio's own, kept in `.film/markers.json` (studio/server/markers.mjs),
 * never in film.html: a marker changes nothing in the film.
 *
 * A film marker is a film second. A clip marker is a second of its clip's file, so it stays on the same moment of the
 * footage when the clip is moved or trimmed; it is shown only while that moment is in the clip.
 */
import { snapToFrame } from './timecode.ts';
import type { TimelineBlock, TimelineTrack } from './timeline-layout';

export const MARKER_COLORS = ['blue', 'green', 'yellow', 'orange', 'red', 'purple'] as const;
export type MarkerColor = (typeof MARKER_COLORS)[number];

/** The colors as the timeline paints them. */
export const MARKER_PAINT: Record<MarkerColor, string> = {
  blue: '#4c8dff',
  green: '#3fbf6f',
  yellow: '#e8c547',
  orange: '#f08a3c',
  red: '#e5484d',
  purple: '#a57cf0',
};

export interface Marker {
  id: string;
  /** Film seconds; on a clip, seconds of the clip's file. */
  t: number;
  /** The clip it is on (film.html id); absent for a marker on the film. */
  clip?: string;
  name?: string;
  color: MarkerColor;
}

/** The most a project keeps, and the longest name. */
export const MARKERS_MAX = 1000;
export const MARKER_NAME_MAX = 80;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Markers as kept: what is not one is left out (the server keeps the same rule, see markers.mjs). */
export function parseMarkers(raw: unknown): Marker[] {
  if (!Array.isArray(raw)) return [];
  const out: Marker[] = [];
  const ids = new Set<string>();
  for (const m of raw) {
    if (!isRecord(m) || typeof m.id !== 'string' || !m.id || ids.has(m.id)) continue;
    if (typeof m.t !== 'number' || !Number.isFinite(m.t) || m.t < 0) continue;
    ids.add(m.id);
    const name = typeof m.name === 'string' ? m.name.trim().slice(0, MARKER_NAME_MAX) : '';
    out.push({
      id: m.id,
      t: Math.round(m.t * 1000) / 1000,
      ...(typeof m.clip === 'string' && m.clip ? { clip: m.clip } : {}),
      ...(name ? { name } : {}),
      color: (MARKER_COLORS as readonly string[]).includes(String(m.color)) ? (m.color as MarkerColor) : 'blue',
    });
    if (out.length >= MARKERS_MAX) break;
  }
  return out;
}

/** An id no marker has. */
export function markerId(list: readonly Marker[]): string {
  const taken = new Set(list.map((m) => m.id));
  let n = list.length + 1;
  while (taken.has(`m${n}`)) n++;
  return `m${n}`;
}

/** A clip as a marker on it needs it: where it is on the film and which part of its file it plays. */
type ClipPlace = Pick<TimelineBlock, 'clipId' | 'startMs' | 'endMs' | 'inMs' | 'speed'>;

/** Where a clip marker is on the film (ms), or null while that moment of the file is not in the clip. */
export function clipMarkerMs(m: Marker, clip: ClipPlace): number | null {
  const ms = clip.startMs + (m.t * 1000 - (clip.inMs ?? 0)) / (clip.speed ?? 1);
  return ms >= clip.startMs - 0.5 && ms <= clip.endMs + 0.5 ? ms : null;
}

/** A marker on the film as it is drawn: where (ms), and the clip it is on. */
export type PlacedMarker = { marker: Marker; ms: number; clip?: TimelineBlock };

/** Every marker that shows, with its film time, in time order. A clip marker shows while its clip and moment do. */
export function placeMarkers(list: readonly Marker[], tracks: readonly TimelineTrack[]): PlacedMarker[] {
  const clips = new Map<string, TimelineBlock>();
  for (const tr of tracks) for (const b of tr.blocks) if (b.clipId && b.loc) clips.set(b.clipId, b);
  const out: PlacedMarker[] = [];
  for (const marker of list) {
    if (!marker.clip) { out.push({ marker, ms: marker.t * 1000 }); continue; }
    const clip = clips.get(marker.clip);
    const ms = clip ? clipMarkerMs(marker, clip) : null;
    if (clip && ms != null) out.push({ marker, ms, clip });
  }
  return out.sort((a, b) => a.ms - b.ms);
}

/**
 * The markers once one is added at `atMs` (on a frame): on `clip` when given, else on the film. A marker already on
 * that frame is not added twice; `added` is the one there.
 */
export function addMarker(list: readonly Marker[], atMs: number, clip?: ClipPlace | null, color: MarkerColor = 'blue'): { list: Marker[]; added: Marker } {
  const ms = snapToFrame(Math.max(0, atMs));
  const t = clip?.clipId
    ? Math.round(((clip.inMs ?? 0) + (ms - clip.startMs) * (clip.speed ?? 1))) / 1000
    : Math.round(ms) / 1000;
  const same = list.find((m) => (m.clip ?? null) === (clip?.clipId ?? null) && Math.abs(m.t - t) < 0.0005);
  if (same) return { list: [...list], added: same };
  const added: Marker = { id: markerId(list), t: Math.max(0, t), ...(clip?.clipId ? { clip: clip.clipId } : {}), color };
  return { list: [...list, added], added };
}

/** One marker changed: its name (empty takes it away), color, or film time. */
export function changeMarker(list: readonly Marker[], id: string, change: { name?: string; color?: MarkerColor; t?: number }): Marker[] {
  return list.map((m) => {
    if (m.id !== id) return m;
    const next: Marker = { ...m };
    if (change.name !== undefined) {
      const name = change.name.trim().slice(0, MARKER_NAME_MAX);
      if (name) next.name = name;
      else delete next.name;
    }
    if (change.color) next.color = change.color;
    if (change.t !== undefined && Number.isFinite(change.t)) next.t = Math.max(0, Math.round(change.t * 1000) / 1000);
    return next;
  });
}

export function removeMarker(list: readonly Marker[], id: string): Marker[] {
  return list.filter((m) => m.id !== id);
}

/** The next marker after `nowMs` (`dir` 1), or the one before (-1); null when there is none that way. */
export function nextMarker(placed: readonly PlacedMarker[], nowMs: number, dir: 1 | -1): PlacedMarker | null {
  /* within a millisecond is where the playhead already is */
  if (dir > 0) return placed.find((p) => p.ms > nowMs + 1) ?? null;
  for (let i = placed.length - 1; i >= 0; i--) if (placed[i]!.ms < nowMs - 1) return placed[i]!;
  return null;
}

/**
 * What M marks: the selected clip under the playhead (the first), else nothing (a marker on the film). A locked
 * track's clips take markers too: a marker changes nothing in the film.
 */
export function markerClip(tracks: readonly TimelineTrack[], selectedClipIds: readonly string[], atMs: number): TimelineBlock | null {
  if (!selectedClipIds.length) return null;
  for (const tr of tracks) {
    for (const b of tr.blocks) {
      if (b.clipId && b.loc && selectedClipIds.includes(b.clipId) && atMs >= b.startMs && atMs < b.endMs) return b;
    }
  }
  return null;
}
