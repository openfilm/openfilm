'use client';

/**
 * What a turn did to the film: the data for the changes card in the conversation.
 *
 * A coding agent's card says "3 files changed +12 −3"; people here look at the film, not files. So this compares
 * the film evaluated before and after the turn: scenes added, edited or removed, sounds added, captions touched,
 * the length before and after.
 *
 * It compares films, not tool calls, so it doesn't matter which agent ran, or whether the person dragged something
 * on the timeline meanwhile: if the film changed, it changed.
 *
 * When the picture changed without a change in scene structure, the card says only "picture updated" rather than
 * inventing a scene.
 *
 * Kept on this machine (localStorage): both ends are only visible at the time and can't be rebuilt later.
 *
 * Nothing computes these changes yet in the desktop app; the card stays empty until something does.
 */
import React from 'react';

export interface SceneChange {
  /** The scene's identity: its clipId, else the key the evaluation gave it. */
  id: string;
  label: string;
  change: 'added' | 'edited' | 'removed';
  /** Where it is in the film (after the change for added or edited, before it for removed). */
  startMs: number;
  kind: 'scene' | 'video';
}

export interface TurnChanges {
  scenes: SceneChange[];
  sounds: { added: number; removed: number; edited: number };
  captions: boolean;
  /** The picture changed, but not in any one scene that can be named. */
  picture: boolean;
  durationMs: { before: number; after: number };
}

const KEY = 'openfilm.turn-changes.v1';
const MAX = 300;
let cache: Map<string, TurnChanges> | null = null;
const listeners = new Set<() => void>();

function load(): Map<string, TurnChanges> {
  if (cache) return cache;
  cache = new Map();
  if (typeof window === 'undefined') return cache;
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as unknown;
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[1]) cache.set(entry[0], entry[1] as TurnChanges);
      }
    }
  } catch { /* unreadable: treat as empty */ }
  return cache;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function persist(): void {
  if (!cache || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...cache].slice(-MAX)));
  } catch { /* storage full: kept for this session only */ }
}

export function setTurnChanges(turnId: string, changes: TurnChanges | null): void {
  const map = load();
  const prev = map.get(turnId);
  if (!changes && !prev) return;
  if (changes && prev && sameJson(prev, changes)) return;
  /* Delete then set: a Map keeps insertion order, so the latest goes last and the oldest are dropped first */
  map.delete(turnId);
  if (changes) map.set(turnId, changes);
  persist();
  for (const fn of listeners) fn();
}

export function turnChanges(turnId: string): TurnChanges | null {
  return load().get(turnId) ?? null;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useTurnChanges(turnId: string): TurnChanges | null {
  return React.useSyncExternalStore(subscribe, () => turnChanges(turnId), () => null);
}
