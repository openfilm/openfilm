/**
 * The theme: light, dark or the system's, dark until the person chooses. The choice is kept in localStorage `openfilm.theme` and shown as
 * `<html data-theme>`; index.html applies it before the first paint, this keeps it current afterwards.
 */
import React from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const KEY = 'openfilm.theme';
const dark = () => window.matchMedia('(prefers-color-scheme: dark)');

function saved(): ThemeMode {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'system' ? value : 'dark';
  } catch { return 'dark'; }
}

function apply(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode === 'system' ? (dark().matches ? 'dark' : 'light') : mode;
}

const listeners = new Set<() => void>();

/* "System" follows the system while Studio is open, not only when it starts */
if (typeof window !== 'undefined') dark().addEventListener('change', () => { if (saved() === 'system') apply('system'); });

export function setThemeMode(mode: ThemeMode) {
  try { localStorage.setItem(KEY, mode); } catch { /* not kept past this page */ }
  apply(mode);
  for (const listener of listeners) listener();
}

/** The chosen theme and a way to change it; every user of it sees the change. */
export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
  const mode = React.useSyncExternalStore((on) => { listeners.add(on); return () => listeners.delete(on); }, saved, () => 'dark' as ThemeMode);
  return [mode, setThemeMode];
}
