/**
 * The library's categories as arranged in Settings › Advanced (lib/library-categories), kept in Studio's prefs.
 */
import * as React from 'react';
import { api, PREFS_EVENT } from '@/api';
import { FIRST_CATEGORY, type LibraryArrangement } from '@/lib/library-categories';

/** The arrangement from Studio's prefs, read again when they change (null until read, or when there is none). */
export function useLibraryArrangement(): LibraryArrangement | null {
  const [arranged, setArranged] = React.useState<LibraryArrangement | null>(null);
  React.useEffect(() => {
    const read = () => { void api.prefs().then((p) => setArranged(p.libraryCategories ?? null)).catch(() => {}); };
    read();
    window.addEventListener(PREFS_EVENT, read);
    return () => window.removeEventListener(PREFS_EVENT, read);
  }, []);
  return arranged;
}

/** The arrangement kept: the order of all but the media, and the ones off. */
export function keepArrangement(list: readonly { id: string; on: boolean }[]): Promise<unknown> {
  const rest = list.filter((c) => c.id !== FIRST_CATEGORY);
  return api.setPrefs({ libraryCategories: { order: rest.map((c) => c.id), off: rest.filter((c) => !c.on).map((c) => c.id) } });
}
