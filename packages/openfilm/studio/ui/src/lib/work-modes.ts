/**
 * Which ways of working a project offers, kept on this machine (Settings → Advanced): the edit (cutting the film), the
 * canvas (making material) and motion (layers and keyframes). Edit and Canvas are on by default; at least one stays on. With one
 * on, the top bar has no switch between them.
 */
import { useSyncExternalStore } from 'react';

export type WorkMode = 'edit' | 'canvas' | 'motion';
export const WORK_MODES: readonly WorkMode[] = ['edit', 'canvas', 'motion'];

const DEFAULT_MODES: readonly WorkMode[] = ['edit', 'canvas'];
const KEY = 'openfilm.workModes';
const listeners = new Set<() => void>();
/** Without localStorage (a private window), the choice lasts this session. */
let memory: readonly WorkMode[] | null = null;
let current: readonly WorkMode[] | null = null;

/** The modes on, in their own order; missing or unreadable settings use the defaults. */
export function parseWorkModes(raw: string | null): readonly WorkMode[] {
  if (raw == null) return DEFAULT_MODES;
  const on = WORK_MODES.filter((m) => raw.split(',').includes(m));
  return on.length ? on : DEFAULT_MODES;
}

export function readWorkModes(): readonly WorkMode[] {
  if (current) return current;
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* no localStorage: this session's choice */ }
  current = raw == null && memory ? memory : parseWorkModes(raw);
  return current;
}

/** A mode turned on or off; the last one on stays on. */
export function setWorkMode(mode: WorkMode, on: boolean): void {
  const was = readWorkModes();
  const next = WORK_MODES.filter((m) => (m === mode ? on : was.includes(m)));
  if (!next.length) return;
  memory = next;
  current = next;
  try { localStorage.setItem(KEY, next.join(',')); } catch { /* not stored: `memory` has it */ }
  for (const fn of listeners) fn();
}

export function useWorkModes(): readonly WorkMode[] {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, readWorkModes, () => DEFAULT_MODES);
}
