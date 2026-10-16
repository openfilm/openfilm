/**
 * How many times the theme (`<html data-theme>`) has changed since the page loaded, for what draws the theme's colors
 * on a canvas (the audio meters, the waveforms): a canvas keeps the colors it was drawn with, so it draws again when
 * this changes. One observer for the whole page, made when the first one asks.
 */
import React from 'react';

let changes = 0;
const listeners = new Set<() => void>();
let watching = false;

function watch(): void {
  if (watching || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  watching = true;
  let theme = document.documentElement.dataset.theme;
  new MutationObserver(() => {
    if (document.documentElement.dataset.theme === theme) return;
    theme = document.documentElement.dataset.theme;
    changes += 1;
    for (const fn of listeners) fn();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

/** A number that changes when the theme does: put it among an effect's dependencies to draw again. */
export function useThemeChanges(): number {
  return React.useSyncExternalStore(
    (fn) => { watch(); listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => changes,
    () => 0,
  );
}
