/**
 * The person's own keys for media services and who makes each kind of media, with which model ("fal.ai · Seedance 2.0"), as Settings → Services shows them.
 *
 * Studio's server keeps the keys (studio/server/keys.mjs): this page sends a key once, when it is added, and only ever
 * gets back where a key comes from and its last four characters.
 */
import React from 'react';
import { studioHost } from './host.ts';

export type ProviderVerb = 'voice' | 'tts' | 'sfx' | 'music' | 'asr' | 'cutout' | 'image-search' | 'video-search' | 'image' | 'video' | 'translate' | 'web-search' | 'web-fetch';


export interface OwnProvider {
  id: string;
  name: string;
  verbs: ProviderVerb[];
  /** the models it can make each kind of media with, its default first, each with the name people know it by */
  models: Partial<Record<ProviderVerb, { id: string; name: string; spec?: import('./canvas').ModelSpec }[]>>;
  /** the provider's page for making a key */
  keysUrl: string;
  /** the provider's own pricing page */
  pricingUrl: string;
  /** the environment variable a key is (or would be) read from */
  env: string;
  /** it works without a key: connected with one click, a key added for higher limits (then it has `last4`) */
  keyless?: boolean;
  /** where its key comes from: kept by Studio, the environment, or none (not connected) */
  source: 'file' | 'env' | null;
  /** the environment has a key for it, connected or not: connecting can use that one */
  envKey: boolean;
  last4: string | null;
  /** connected by signing in on its website instead of pasting a key (OpenFilm) */
  signIn: boolean;
  /** signed in: the account's email */
  account: string | null;
  /** The saved account credential was rejected by OpenFilm; reconnect in either Agents or Services. */
  connectionError?: string;
}

/**
 * One of the person's custom services (studio/server/custom-services.mjs): any service at an address, reached by their
 * agent with `openfilm get call`. `auth`: the header its key goes in when the agent does not place it ({key}).
 */
export interface OwnService {
  id: string;
  name: string;
  url: string;
  auth: string;
  note: string;
  last4: string | null;
}

/** What Settings sends for a service: no `key` keeps the one it has, '' takes it away; no `auth` keeps where it goes. */
export type OwnServiceFields = { name: string; url: string; auth?: string; note: string; key?: string };

export interface ProvidersState {
  providers: OwnProvider[];
  /** the person's own services */
  custom: OwnService[];
  /** the person's choice for each kind of media: a provider id, or null (none) */
  use: Record<string, string | null>;
  /** the model each kind of media is made with */
  model: Record<string, string | null>;
  /** a sign-in waiting for the person's browser (`provider`), and why the last one failed */
  signingIn: { provider: string | null; error: string | null; errorFor: string | null };
  /** who searches the library by meaning: OpenFilm's service ('openfilm', the default), or none (its words alone) */
  librarySearch: string | null;
}

/** The providers Settings › Services shows first, in this order: OpenFilm's own, then the large media services. */
export const RECOMMENDED_PROVIDERS = ['openfilm', 'openai', 'google', 'azure', 'elevenlabs', 'openrouter'];

/**
 * The providers in the order Services lists them: the connected ones first, then the others; within each, the
 * recommended ones in RECOMMENDED_PROVIDERS' order, then the rest by name. `more`: the others not recommended, which
 * wait behind "N more".
 */
export function providerOrder<P extends Pick<OwnProvider, 'id' | 'name' | 'source'>>(providers: readonly P[]) {
  const rank = (p: P) => { const at = RECOMMENDED_PROVIDERS.indexOf(p.id); return at === -1 ? RECOMMENDED_PROVIDERS.length : at; };
  const sorted = [...providers].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const connected = sorted.filter((p) => p.source);
  const others = sorted.filter((p) => !p.source);
  return {
    connected,
    recommended: others.filter((p) => RECOMMENDED_PROVIDERS.includes(p.id)),
    more: others.filter((p) => !RECOMMENDED_PROVIDERS.includes(p.id)),
  };
}

/**
 * Microsoft Azure's services, each set up with its own key and its resource's region (they are not one key, as
 * Google's are): Azure AI Speech makes the voice-over. More go here as OpenFilm uses them.
 */
export const AZURE_SERVICES = [{ id: 'speech', name: 'Azure AI Speech', verbs: ['tts'] as ProviderVerb[] }];

/** An Azure service's key as the server takes it: `<region>:<key>`; null while the region is not one (eastus, …). */
export function azureKey(region: string, key: string): string | null {
  const place = region.trim().toLowerCase();
  return /^[a-z0-9]+$/.test(place) && key.trim() ? `${place}:${key.trim()}` : null;
}

/** Whether any provider here, connected or not, can make `verb`. */
export const offered = (state: ProvidersState, verb: ProviderVerb) => state.providers.some((p) => p.verbs.includes(verb));

/** The kinds of media the person chooses a provider for, in the order they are listed. */
export const USE_VERBS: ProviderVerb[] = ['tts', 'music', 'sfx', 'asr', 'image', 'image-search', 'video', 'video-search', 'translate', 'web-search'];
/**
 * Every kind Settings › Services lets the person choose what makes: media, and web search for an agent that has none
 * of its own. Translating subtitles is the agent's model's work.
 */
export const SERVICE_VERBS: ProviderVerb[] = ['tts', 'music', 'sfx', 'asr', 'cutout', 'image', 'image-search', 'video', 'video-search', 'web-search'];

/** Each provider's website, as its card links it. */
export const PROVIDER_SITES: Readonly<Record<string, string>> = {
  openfilm: 'openfilm.dev', openai: 'openai.com', google: 'ai.google.dev', azure: 'azure.microsoft.com', elevenlabs: 'elevenlabs.io',
  inworld: 'inworld.ai', cartesia: 'cartesia.ai', openrouter: 'openrouter.ai', fal: 'fal.ai', groq: 'groq.com', mimo: 'platform.xiaomimimo.com',
  doubao: 'volcengine.com', pexels: 'pexels.com', pixabay: 'pixabay.com', brave: 'brave.com/search/api', tavily: 'tavily.com', keenable: 'keenable.ai',
};

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

/* Settings and the preloaded canvas live at the same time. They read one snapshot, even while a sign-in is waiting
   in the browser. Other tabs get an invalidation only; they read their own state from Studio. */
let snapshot: ProvidersState | null = null;
let revision = 0;
let reading: { revision: number; result: Promise<void> } | null = null;
let poll: number | undefined;
let channel: BroadcastChannel | undefined;
let stopAgents: (() => void) | undefined;
const subscribers = new Set<() => void>();
const current = () => snapshot;
const announce = () => channel?.postMessage('changed');
const refresh = () => { void readProviders().catch(() => {}); };
const invalidate = () => { revision++; refresh(); };
const refreshVisible = () => { if (document.visibilityState === 'visible') refresh(); };

function followSignIn() {
  if (subscribers.size && snapshot?.signingIn?.provider) {
    poll ??= window.setInterval(refresh, 2000);
  } else if (poll !== undefined) {
    window.clearInterval(poll);
    poll = undefined;
  }
}

function publish(next: ProvidersState) {
  const finished = snapshot?.signingIn?.provider && !next.signingIn?.provider;
  snapshot = next;
  followSignIn();
  for (const notify of subscribers) notify();
  if (finished) announce();
}

function readProviders() {
  if (reading?.revision === revision) return reading.result;
  const started = revision;
  const result = call('').then((next) => {
    // A read started before a successful change must not put its older state back.
    if (started === revision) publish(next);
  }).finally(() => { if (reading?.result === result) reading = null; });
  reading = { revision: started, result };
  return result;
}

function subscribe(notify: () => void) {
  subscribers.add(notify);
  if (subscribers.size === 1) {
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshVisible);
    try {
      channel = new BroadcastChannel('openfilm.providers');
      channel.onmessage = invalidate;
    } catch { /* The current tab still shares its snapshot. */ }
    let lastAccount: string | undefined;
    stopAgents = studioHost?.agents?.onChange((agents) => {
      const agent = agents.find(({ id }) => id === 'openfilm');
      const account = JSON.stringify([agent?.status, agent?.account?.email]);
      if (account !== lastAccount) {
        lastAccount = account;
        invalidate();
      }
    });
    followSignIn();
  }
  return () => {
    subscribers.delete(notify);
    if (subscribers.size) return;
    followSignIn();
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refreshVisible);
    channel?.close();
    channel = undefined;
    stopAgents?.();
    stopAgents = undefined;
  };
}

export interface ProvidersHook {
  state: ProvidersState | null;
  problem: string | null;
  /** the provider or kind of media the last change that failed was for (null: loading failed) */
  problemFor: string | null;
  /** the provider or kind of media a change is being saved for */
  busy: string | null;
  /** keep a key; resolves whether it was kept */
  saveKey: (id: string, key: string) => Promise<boolean>;
  removeKey: (id: string) => Promise<void>;
  useEnvKey: (id: string) => Promise<boolean>;
  /** a provider with `signIn`: its website opened in the person's browser to sign in; `cancelSignIn` drops it */
  signIn: (id: string) => Promise<void>;
  cancelSignIn: (id: string) => Promise<void>;
  /** who makes that kind of media: a provider id with its model, or '' (none) */
  choose: (verb: ProviderVerb, provider: string, pick?: { model?: string }) => Promise<void>;
  /** the library searched by meaning at OpenFilm's service, or by its words alone */
  setLibrarySearch: (on: boolean) => Promise<void>;
  /** the state asked again (what Local services makes changed) */
  reload: () => Promise<void>;
  /** one of the person's own services added (id null) or changed; resolves whether it was kept */
  saveService: (id: string | null, fields: OwnServiceFields) => Promise<boolean>;
  removeService: (id: string) => Promise<void>;
}

/** The shared providers, with errors and changes in progress local to the control using them. */
export function useProviders(): ProvidersHook {
  const state = React.useSyncExternalStore(subscribe, current, current);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [problemFor, setProblemFor] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    let timer = 0;
    /* asked again a few times when it fails: Studio restarting, or busy for a moment, must not leave Settings empty */
    const load = (attempt: number) => {
      readProviders().then(
        () => { if (live) { setProblem(null); setProblemFor(null); } },
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
    try {
      const next = await call(path, init);
      revision++;
      publish(next);
      announce();
      return true;
    }
    catch (e) { setProblem(e instanceof Error ? e.message : String(e)); setProblemFor(what); return false; }
    finally { setBusy(null); }
  }, []);

  return {
    state, problem, problemFor, busy,
    saveKey: (id, key) => change(id, `/${encodeURIComponent(id)}/key`, { method: 'PUT', json: { key } }),
    removeKey: async (id) => { await change(id, `/${encodeURIComponent(id)}/key`, { method: 'DELETE' }); },
    useEnvKey: (id) => change(id, `/${encodeURIComponent(id)}/key`, { method: 'PUT', json: { env: true } }),
    signIn: async (id) => { await change(id, `/${encodeURIComponent(id)}/sign-in`, { method: 'POST' }); },
    cancelSignIn: async (id) => { await change(id, `/${encodeURIComponent(id)}/sign-in/cancel`, { method: 'POST' }); },
    choose: async (verb, provider, pick) => { await change(verb, '/use', { method: 'PUT', json: { verb, provider: provider || null, ...pick } }); },
    setLibrarySearch: async (on) => { await change('library-search', '/library-search', { method: 'PUT', json: { on } }); },
    saveService: (id, fields) => change(id ?? 'custom', id ? `/custom/${encodeURIComponent(id)}` : '/custom', { method: id ? 'PUT' : 'POST', json: fields }),
    removeService: async (id) => { await change(id, `/custom/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
    /* asked again: what Local services makes changed (a model came, went, or was turned on or off) */
    reload: async () => {
      revision++;
      await readProviders().then(announce, () => {});
    },
  };
}
