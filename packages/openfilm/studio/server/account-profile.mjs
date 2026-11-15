// @ts-check
/**
 * Who the OpenFilm account is, for Settings → General → Account: its name and picture as the website shows them,
 * read with the key this computer holds (GET <service>/api/desktop/profile). Kept ten minutes per key, a failure a
 * minute; Settings waits at most three seconds for it, and a service that cannot say leaves the email to show.
 * Changing them is the website's: Studio only shows them.
 */
import { serviceUrl } from './providers/common.mjs';

/** @typedef {{ name: string | null, avatar: string | null }} AccountProfile */

/** @type {{ key: string, until: number, profile: AccountProfile | null } | null} */
let kept = null;
/** @type {{ key: string, promise: Promise<AccountProfile | null> } | null} */
let asking = null;

/**
 * The name and picture in the service's answer: its own `name` and `avatarUrl`, else (an older service) the name from
 * its parts and the picture only when the person added one. A picture is only an https address.
 * @param {any} body
 * @returns {AccountProfile | null}
 */
export function shownProfile(body) {
  const user = body?.user;
  if (!user || typeof user !== 'object') return null;
  const text = (/** @type {unknown} */ v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const email = text(user.primaryEmailAddress?.emailAddress);
  const name = text(user.name) ?? text(user.fullName) ?? ([text(user.firstName), text(user.lastName)].filter(Boolean).join(' ') || null)
    ?? text(user.username) ?? (email ? email.split('@')[0] || null : null);
  const picture = text(user.avatarUrl) ?? (user.hasImage === true ? text(user.imageUrl) : null);
  return { name, avatar: picture && /^https:\/\//i.test(picture) ? picture : null };
}

/**
 * @param {string} key
 * @param {{ fetch?: typeof fetch, now?: number }} [options]
 * @returns {Promise<AccountProfile | null>}
 */
export async function accountProfile(key, { fetch: fetchImpl = fetch, now = Date.now() } = {}) {
  if (kept?.key === key && now < kept.until) return kept.profile;
  if (asking?.key === key) return asking.promise;
  const promise = (async () => {
    let profile = null;
    try {
      const response = await fetchImpl(`${serviceUrl('API', 'https://openfilm.dev')}/api/desktop/profile`, {
        headers: { authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(3000),
      });
      profile = response.ok ? shownProfile(await response.json().catch(() => null)) : null;
    } catch { /* not reachable now: asked again in a minute */ }
    kept = { key, profile, until: now + (profile ? 10 * 60_000 : 60_000) };
    return profile;
  })().finally(() => { if (asking?.promise === promise) asking = null; });
  asking = { key, promise };
  return promise;
}
