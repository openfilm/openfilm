/**
 * A turn of the app's own agent that stopped because the service its model runs on has no balance left (the shell
 * says so: src/pi-config.mjs `outOfBalance`), the same for every service: which one, and its page to top it up (null
 * when the service is not one the app knows). Kept with the saved turn, so its footer still says it.
 */
export interface Balance { provider: string; url: string | null }

/** What a saved turn keeps of this (lib/chat-store's Turn, extended here: older turns have none). */
export interface TurnBalance { balance?: Balance }

/** A balance as the shell or a saved turn gives it, or null. */
export function readBalance(value: unknown): Balance | null {
  const v = value as Partial<Balance> | null | undefined;
  if (!v || typeof v.provider !== 'string' || !v.provider) return null;
  return { provider: v.provider, url: typeof v.url === 'string' && /^https:\/\//.test(v.url) ? v.url : null };
}
