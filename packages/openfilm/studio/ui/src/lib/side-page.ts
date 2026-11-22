/**
 * Where the desktop sidebar's pages (the projects, the Community) are drawn: the element right of the sidebar that
 * takes the place of the chat and the editor while one is shown (shell/top-bar `DesktopHeader` keeps it there, hidden
 * while none is). With none (Studio in a browser, a project that could not be read), those open in their own windows.
 */
import * as React from 'react';

let host: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function setSidePageHost(node: HTMLElement | null): void {
  if (node === host) return;
  host = node;
  for (const listener of listeners) listener();
}

export function useSidePageHost(): HTMLElement | null {
  return React.useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => host);
}
