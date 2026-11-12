/**
 * The library page (components/LibraryPage.tsx): where the person tends what is theirs beyond any one project, with
 * room to do it: Mine (lib/saved) and the space projects take. In an app with tabs it is a tab of its own, beside the
 * projects' (`LIBRARY_TAB`, which no project id can be); in a browser it is Studio's page at `/library`.
 */
import { studioHost } from './host';

/** The library's tab, as the app's tabs name it in place of a project id. */
export const LIBRARY_TAB = '@library';
/** Its page's address. */
export const LIBRARY_PATH = '/library';

/** Show the library: its tab (opened when it is not), or this page goes there (the address keeps Studio's key). */
export function openLibraryPage(): void {
  if (studioHost?.tabs) { studioHost.tabs.open(LIBRARY_TAB); return; }
  history.pushState(null, '', LIBRARY_PATH + location.search);
  dispatchEvent(new PopStateEvent('popstate'));
}
