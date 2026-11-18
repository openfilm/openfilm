// @ts-check
/**
 * How many people use each community item: openfilm.dev's anonymous counts (internal/community.md), read at most every
 * ten minutes, and one more counted when an item listed by OpenFilm's community is installed. What is sent is the item's
 * uid alone: nothing of the person, their computer or their projects. OPENFILM_NO_STATS turns both off; a count that
 * cannot be read or sent is let go (none shows).
 */
const STATS_URL = () => process.env.OPENFILM_COMMUNITY_STATS || 'https://openfilm.dev/v1/community/stats';
const INSTALLS_URL = () => process.env.OPENFILM_COMMUNITY_INSTALLS || 'https://openfilm.dev/v1/community/installs';
const FRESH_MS = 10 * 60 * 1000;
const UID = /^[A-Za-z0-9][\w.-]{0,63}\/[A-Za-z0-9][\w.-]{0,63}$/;

/** @type {{ at: number, stats: Record<string, { installs: number }> }} */
let seen = { at: 0, stats: {} };

/** The counts by uid (what was read last when it cannot be read now; none: nothing). @param {{ fetch?: typeof fetch }} [options] */
export async function communityStats({ fetch: get = fetch } = {}) {
  if (process.env.OPENFILM_NO_STATS) return {};
  if (Date.now() - seen.at < FRESH_MS) return seen.stats;
  seen = { ...seen, at: Date.now() };
  try {
    const res = await get(STATS_URL(), { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
    const body = res.ok ? await res.json() : null;
    const stats = body && typeof body.stats === 'object' && body.stats ? body.stats : null;
    if (stats) {
      seen.stats = Object.fromEntries(Object.entries(stats).filter(([uid, v]) => UID.test(uid) && Number.isSafeInteger(v?.installs) && v.installs >= 0)
        .map(([uid, v]) => [uid, { installs: v.installs }]));
    }
  } catch { /* not now: what was read before */ }
  return seen.stats;
}

/** One more install of an item counted, sent and not waited on. @param {string} uid @param {{ fetch?: typeof fetch }} [options] */
export function countInstall(uid, { fetch: get = fetch } = {}) {
  if (process.env.OPENFILM_NO_STATS || !UID.test(uid)) return;
  void get(INSTALLS_URL(), { method: 'POST', signal: AbortSignal.timeout(5000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid }) }).catch(() => {});
}
