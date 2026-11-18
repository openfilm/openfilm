/**
 * `openfilm://` links: a page on openfilm.dev (its community's "Open in OpenFilm") opens the app on what it names.
 * Only what is known is taken, strictly: `openfilm://community/<owner>/<name>` (a workbench, a skill, a connector of the
 * community, as its uid); anything else is let go, since any web page can send any link.
 *
 * A link comes as the app opens (Windows: in its arguments; macOS: `open-url` before it is ready) or while it runs
 * (Windows: a second instance's arguments; macOS: `open-url`). It waits until the window's page takes it (`take`), and
 * one that comes while the page is up is sent to it (`desktop:open-link`).
 */

export const PROTOCOL = 'openfilm';

/** @typedef {{ kind: 'community', uid: string }} AppLink */

const PART = /^[A-Za-z0-9][\w.-]{0,63}$/;

/** What a link names, or null when it is not one the app takes. @param {unknown} url @returns {AppLink | null} */
export function parseLink(url) {
  if (typeof url !== 'string' || url.length > 300) return null;
  let at;
  try { at = new URL(url); } catch { return null; }
  if (at.protocol !== `${PROTOCOL}:`) return null;
  /* openfilm://community/<owner>/<name>: the host is "community", the path the uid */
  const parts = at.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return ''; } });
  if (at.hostname === 'community' && parts.length === 2 && parts.every((p) => PART.test(p))) return { kind: 'community', uid: `${parts[0]}/${parts[1]}` };
  return null;
}

/** The first `openfilm://` link among a process's arguments, or null. @param {readonly string[]} argv */
export const linkFromArgv = (argv) => argv.find((a) => typeof a === 'string' && a.startsWith(`${PROTOCOL}://`)) ?? null;

/**
 * The links that come: kept until the page takes them, or sent to it when it is up. `send`: to the page in front,
 * false when there is none yet.
 * @param {{ send: (link: AppLink) => boolean }} page
 */
export function createLinks(page) {
  /** @type {AppLink | null} */
  let waiting = null;
  return {
    /** A link came (its address): sent now, or kept for the page. */
    came(/** @type {unknown} */ url) {
      const link = parseLink(url);
      if (!link) return;
      if (!page.send(link)) waiting = link;
    },
    /** The page is up and asks: the link kept for it, once. */
    take() { const link = waiting; waiting = null; return link; },
  };
}
