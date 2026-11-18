/**
 * Going from one project to another: the address is the state (App.tsx), so anything in the page, a workbench of a
 * plugin's included, goes somewhere by changing the address and saying so (`popstate`, which the app listens for).
 * In an app with tabs (lib/host.ts `tabs`) a project is a tab of the app's, and the app is told instead.
 */
import { studioHost } from './host.ts';

/**
 * `to` with this page's key in its address (the server puts it there): the address bar is what a person copies, and
 * with the key a copied address opens Studio in any browser on this machine, or in an agent's preview.
 */
export const keepKey = (to: string): string => {
  const key = new URLSearchParams(location.search).get('key');
  if (!key) return to;
  const at = new URL(to, location.origin);
  at.searchParams.set('key', key);
  return at.pathname + at.search;
};

/** Go to an address of the app's: kept in the history (or in the place of the one shown), and told to the app. */
export function go(to: string, replace = false): void {
  if (to !== location.pathname) (replace ? history.replaceState : history.pushState).call(history, null, '', keepKey(to));
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Show a project: here, or (with tabs) in its own tab. */
export function openProject(projectId: string): void {
  const tabs = studioHost?.tabs ?? null;
  if (tabs) tabs.open(projectId); else go(`/projects/${projectId}`);
}

/** The project shown was deleted: its tab closes (with tabs), or back to the last project. */
export function leaveProject(): void {
  const tabs = studioHost?.tabs ?? null;
  if (tabs) tabs.report({ gone: true }); else go('/', true);
}
