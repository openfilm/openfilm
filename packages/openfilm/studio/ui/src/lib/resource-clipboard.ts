import React from 'react';

type ResourceClipboard = { paths: readonly string[]; action: 'copy' | 'cut'; linkable: boolean };
let clipboard: ResourceClipboard | null = null;
const listeners = new Set<() => void>();
/** Shared between resource-center openings. Text fields retain the operating system's normal text clipboard. */
export function setResourceClipboard(next: ResourceClipboard | null) {
  clipboard = next;
  for (const notify of listeners) notify();
}
export function useResourceClipboard() {
  return React.useSyncExternalStore(notify => { listeners.add(notify); return () => { listeners.delete(notify); }; }, () => clipboard, () => null);
}
