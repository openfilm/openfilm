/**
 * The library's voices (studio/server/library.mjs, library/voices.json): the ready-made voices of the voice-over
 * services OpenFilm offers, each with its service's own sample, and whether the person can speak in one now: with the
 * service's own key, or through OpenFilm when the person signed in and OpenFilm offers that service's models
 * (Settings › Services, lib/providers). A voice chosen is a reference in the chat (lib/host StudioRef `voice`): the
 * agent makes the voice-over in it.
 */
import React from 'react';
import type { StudioRef } from './host';
import { libraryUrl } from './library.ts';
import type { OwnProvider, ProvidersState } from './providers';

export interface LibraryVoice {
  provider: string;
  /** its id at its service, as `openfilm get tts --voice` takes it */
  id: string;
  name: string;
  description: string | null;
  gender: 'm' | 'f' | 'n' | null;
  age: 'young' | 'middle' | 'old' | null;
  /** the language it speaks as its own (`en-US`, `zh-CN`; ElevenLabs says only `en`) */
  language: string | null;
  accent: string | null;
  tags: string[];
  /** its sample in the library, when there is one */
  sample: string | null;
}

export interface VoiceService { id: string; name: string; models: { id: string; name: string }[] }
export interface LibraryVoices { version: number; providers: VoiceService[]; voices: LibraryVoice[] }

/** How the person reaches a service now: `via` the provider `openfilm get` runs (its own, or OpenFilm), with these models. */
export interface VoiceAccess { via: string; models: string[] }

let voices: LibraryVoices | null = null;
let reading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** The voices, once read (null before). */
export function useLibraryVoices(): LibraryVoices | null {
  const seen = React.useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    () => voices,
    () => voices,
  );
  React.useEffect(() => {
    if (voices) return;
    reading ??= fetch('/api/library/voices', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null), () => null)
      .then((body: LibraryVoices | null) => {
        if (body && Array.isArray(body.voices)) { voices = body; for (const fn of listeners) fn(); }
        else reading = null;
      });
  }, []);
  return seen;
}

/** A voice's id among the library's starred things (the server's voiceKey). */
export const voiceKey = (v: Pick<LibraryVoice, 'provider' | 'id'>): string => `voice:${v.provider}/${v.id}`;

export const sampleUrl = (v: LibraryVoice): string | null => (v.sample ? libraryUrl(v.sample) : null);

/** A language tag's first part, the one the drawer sorts by: `en-US` → `en`. */
export const languageOf = (v: LibraryVoice): string | null => v.language?.split(/[-_]/)[0]?.toLowerCase() || null;

/**
 * How each of `services` is reached with what Settings › Services has: its own key first (the person's own account),
 * else OpenFilm signed in and offering its models (`<service>/<model>`); absent: not at all.
 */
export function voiceAccess(services: readonly VoiceService[], state: Pick<ProvidersState, 'providers'> | null): Record<string, VoiceAccess> {
  const out: Record<string, VoiceAccess> = {};
  if (!state) return out;
  const own = (id: string): OwnProvider | undefined => state.providers.find((p) => p.id === id && p.source);
  const openfilm = own('openfilm');
  for (const service of services) {
    const direct = own(service.id);
    const offered = direct?.models.tts?.map((m) => m.id).filter((id) => service.models.some((m) => m.id === id)) ?? [];
    if (direct && offered.length) { out[service.id] = { via: service.id, models: offered }; continue; }
    const through = openfilm?.models.tts?.map((m) => m.id).filter((id) => id.startsWith(`${service.id}/`)) ?? [];
    if (through.length) out[service.id] = { via: 'openfilm', models: through };
  }
  return out;
}

/** What Settings › Services has (lib/providers), read once while the voices are shown. */
export function useServices(): Pick<ProvidersState, 'providers'> | null {
  const [state, setState] = React.useState<Pick<ProvidersState, 'providers'> | null>(null);
  React.useEffect(() => {
    let live = true;
    void fetch('/api/providers', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null), () => null)
      .then((body: ProvidersState | null) => { if (live && body && Array.isArray(body.providers)) setState(body); });
    return () => { live = false; };
  }, []);
  return state;
}

/** The chat's reference to a voice: who it is, at which service, and how the agent speaks in it now. */
export function voiceRef(v: LibraryVoice, service: VoiceService, access: VoiceAccess | undefined): StudioRef {
  return {
    kind: 'voice', provider: v.provider, service: service.name, id: v.id, name: v.name,
    via: access?.via ?? null, models: access?.models ?? [], language: v.language, description: v.description,
  };
}
