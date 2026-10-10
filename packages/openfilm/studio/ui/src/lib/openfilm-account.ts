/**
 * The OpenFilm account as a service provider: Studio runs without it, and connecting it adds the hosted services
 * (voice, music, sound effects, images, video), like a key for any other service.
 *
 * Studio's server holds the account (studio/server/account.mjs): this page only ever sees who is connected, never a
 * token, and nothing of what the account has left or costs (that is on the website's account page). Sign-in happens in the person's browser; while it is waiting, the state is asked for again
 * every couple of seconds, and whenever this window comes back into focus.
 */
import React from 'react';

export interface OpenFilmAccount {
  connected: boolean;
  /** a sign-in started here is waiting for the browser */
  pending: boolean;
  email: string | null;
  name: string | null;
  /** the website's account page (usage, billing, the account itself) */
  manageUrl: string;
  /** the account service cannot be reached: what is shown is what was last known */
  unavailable: boolean;
  /** why the last sign-in did not complete */
  error: string | null;
  /** false: this build has no account service (product.json and OPENFILM_ACCOUNT_URL empty), nothing to connect */
  configured: boolean;
}

async function call(path: string, method: 'GET' | 'POST' = 'GET'): Promise<OpenFilmAccount> {
  const res = await fetch(`/api/account${path}`, { method, cache: 'no-store' });
  const body = (await res.json().catch(() => ({}))) as Partial<OpenFilmAccount> & { error?: string };
  if (!res.ok) throw Object.assign(new Error(body.error ?? `Studio answered ${res.status}`), { unavailable: res.status === 503 });
  return body as OpenFilmAccount;
}

export interface OpenFilmAccountState {
  account: OpenFilmAccount | null;
  loaded: boolean;
  /** what went wrong with the last request (the service unavailable, Studio not answering) */
  problem: string | null;
  busy: boolean;
  refresh: () => void;
  connect: () => Promise<void>;
  cancel: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** the website's account page, in the person's browser */
  manage: () => void;
}

/** The account while `active` (Settings is open). */
export function useOpenFilmAccount(active: boolean): OpenFilmAccountState {
  const [account, setAccount] = React.useState<OpenFilmAccount | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(() => {
    void call('').then((next) => { setAccount(next); setProblem(next.error); }, (e: Error) => setProblem(e.message))
      .finally(() => setLoaded(true));
  }, []);

  React.useEffect(() => {
    if (!active) return undefined;
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [active, refresh]);

  const pending = Boolean(account?.pending);
  React.useEffect(() => {
    if (!active || !pending) return undefined;
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, [active, pending, refresh]);

  const act = React.useCallback(async (path: string) => {
    setBusy(true);
    setProblem(null);
    try { setAccount(await call(path, 'POST')); }
    catch (e) { setProblem(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);

  const manage = React.useCallback(() => {
    void fetch('/api/account/manage', { method: 'POST' }).catch(() => { /* the link still has its address */ });
  }, []);

  return {
    account, loaded, problem, busy, refresh, manage,
    connect: () => act('/connect'),
    cancel: () => act('/cancel'),
    disconnect: () => act('/disconnect'),
  };
}
