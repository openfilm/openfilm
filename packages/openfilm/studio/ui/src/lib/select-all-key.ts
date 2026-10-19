/** A key that can be select-all: what a keydown, or a key passed on from the film, says of itself. */
export interface KeyLike { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }

/** ⌘A on a Mac, Ctrl+A elsewhere, without Shift or Alt: select all. */
export function isSelectAll(e: KeyLike, mac: boolean): boolean {
  return (mac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a';
}
