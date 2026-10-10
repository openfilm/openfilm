/**
 * The person's own keys for media services and who makes each kind of media, with which model ("fal.ai · Seedance 2.0"), as Settings → Providers and Models show them.
 *
 * Studio's server keeps the keys (studio/server/keys.mjs): this page sends a key once, when it is added, and only ever
 * gets back where a key comes from and its last four characters.
 */
import React from 'react';

export type ProviderVerb = 'voice' | 'tts' | 'sfx' | 'music' | 'asr' | 'image-search' | 'image' | 'video' | 'translate' | 'web-search' | 'web-fetch';


export interface OwnProvider {
  id: string;
  name: string;
  verbs: ProviderVerb[];
  /** the models it can make each kind of media with, its default first, each with the name people know it by */
  models: Partial<Record<ProviderVerb, { id: string; name: string }[]>>;
  /** the provider's page for making a key */
  keysUrl: string;
  /** the environment variable a key is (or would be) read from */
  env: string;
  /** where its key comes from: kept by Studio, the environment, or none (not connected) */
  source: 'file' | 'env' | null;
  /** the environment has a key for it, connected or not: connecting can use that one */
  envKey: boolean;
  last4: string | null;
}

export interface ProvidersState {
  providers: OwnProvider[];
  /** the person's choice for each kind of media: a provider id, or null (none) */
  use: Record<string, string | null>;
  /** the model each kind of media is made with */
  model: Record<string, string | null>;
}

/** The providers, not connected, that would make `verb` once connected, by name (as every list of providers is). */
export function couldMake(state: ProvidersState, verb: ProviderVerb): string[] {
  return state.providers.filter((p) => !p.source && p.verbs.includes(verb)).map((p) => p.name).sort((a, b) => a.localeCompare(b));
}

/** Whether any provider here, connected or not, can make `verb`. */
export const offered = (state: ProvidersState, verb: ProviderVerb) => state.providers.some((p) => p.verbs.includes(verb));

/** The kinds of media the person chooses a provider for, in the order they are listed. */
export const USE_VERBS: ProviderVerb[] = ['tts', 'music', 'sfx', 'asr', 'image', 'image-search', 'video', 'translate', 'web-search'];

async function call<T = ProvidersState>(path: string, init?: { method: string; json?: unknown }): Promise<T> {
  const res = await fetch(`/api/providers${path}`, {
    method: init?.method ?? 'GET',
    cache: 'no-store',
    headers: init?.json === undefined ? undefined : { 'content-type': 'application/json' },
    body: init?.json === undefined ? undefined : JSON.stringify(init.json),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Studio answered ${res.status}`);
  return body as T;
}

export interface ProvidersHook {
  state: ProvidersState | null;
  problem: string | null;
  /** the provider or kind of media a change is being saved for */
  busy: string | null;
  /** keep a key; resolves whether it was kept */
  saveKey: (id: string, key: string) => Promise<boolean>;
  removeKey: (id: string) => Promise<void>;
  useEnvKey: (id: string) => Promise<boolean>;
  /** who makes that kind of media: a provider id with its model, or '' (none) */
  choose: (verb: ProviderVerb, provider: string, pick?: { model?: string }) => Promise<void>;
}

/** The providers while Settings → Providers or Models is shown. */
export function useProviders(): ProvidersHook {
  const [state, setState] = React.useState<ProvidersState | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    let timer = 0;
    /* asked again a few times when it fails: Studio restarting, or busy for a moment, must not leave Settings empty */
    const load = (attempt: number) => {
      call('').then(
        (next) => { if (live) { setState(next); setProblem(null); } },
        (e: Error) => {
          if (!live) return;
          if (attempt < 4) timer = window.setTimeout(() => load(attempt + 1), 1000 * 2 ** attempt);
          else setProblem(e.message);
        },
      );
    };
    load(0);
    return () => { live = false; window.clearTimeout(timer); };
  }, []);

  const change = React.useCallback(async (what: string, path: string, init: { method: string; json?: unknown }) => {
    setBusy(what);
    setProblem(null);
    try { setState(await call(path, init)); return true; }
    catch (e) { setProblem(e instanceof Error ? e.message : String(e)); return false; }
    finally { setBusy(null); }
  }, []);

  return {
    state, problem, busy,
    saveKey: (id, key) => change(id, `/${encodeURIComponent(id)}/key`, { method: 'PUT', json: { key } }),
    removeKey: async (id) => { await change(id, `/${encodeURIComponent(id)}/key`, { method: 'DELETE' }); },
    useEnvKey: (id) => change(id, `/${encodeURIComponent(id)}/key`, { method: 'PUT', json: { env: true } }),
    choose: async (verb, provider, pick) => { await change(verb, '/use', { method: 'PUT', json: { verb, provider: provider || null, ...pick } }); },
  };
}
