/**
 * The library's voices (studio/server/library.mjs, library/voices.json): the ready-made voices of the voice-over
 * services OpenFilm offers, each with its service's own sample, and whether the person can speak in one now: through
 * OpenFilm, the default, when the person signed in and OpenFilm offers that service's models, else with the service's
 * own key (Settings › Services, lib/providers). A voice chosen is a reference in the chat (lib/host StudioRef `voice`): the
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
  /** its service picked it (ElevenLabs' own voices, and those its library features) */
  featured?: boolean;
  /** how much it is used, where its service says (characters spoken in a year) */
  uses?: number | null;
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
 * How each of `services` is reached with what Settings › Services has: through OpenFilm first, signed in and offering
 * its models (`<service>/<model>`), else its own key; absent: not at all.
 */
export function voiceAccess(services: readonly VoiceService[], state: Pick<ProvidersState, 'providers'> | null): Record<string, VoiceAccess> {
  const out: Record<string, VoiceAccess> = {};
  if (!state) return out;
  const own = (id: string): OwnProvider | undefined => state.providers.find((p) => p.id === id && p.source);
  const openfilm = own('openfilm');
  for (const service of services) {
    const through = openfilm?.models.tts?.map((m) => m.id).filter((id) => id.startsWith(`${service.id}/`)) ?? [];
    if (through.length) { out[service.id] = { via: 'openfilm', models: through }; continue; }
    const direct = own(service.id);
    const offered = direct?.models.tts?.map((m) => m.id).filter((id) => service.models.some((m) => m.id === id)) ?? [];
    if (direct && offered.length) out[service.id] = { via: service.id, models: offered };
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

/** A number from 0 to 1 that a string always gives (FNV-1a), the `n`th of a string's own. */
function seeded(text: string, n: number): number {
  let h = 2166136261 ^ n;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/* each kind of voice its own colors: a woman's warm (rose to coral and violet), a man's cool (teal to indigo), any
   other's green; an older voice deeper and quieter, a young one brighter */
const HUES: Record<'f' | 'm' | 'n', [number, number]> = { f: [300, 70], m: [180, 70], n: [85, 70] };
const TONE: Record<'young' | 'middle' | 'old', { s: number; l: number }> = { young: { s: 78, l: 66 }, middle: { s: 62, l: 56 }, old: { s: 42, l: 44 } };

/** The colors and light spots shared by a voice's avatar and its preview. */
export function voicePalette(v: Pick<LibraryVoice, 'provider' | 'id' | 'gender' | 'age'>) {
  const key = `${v.provider}/${v.id}`;
  const [from, span] = HUES[v.gender === 'f' || v.gender === 'm' ? v.gender : 'n'];
  const tone = TONE[v.age ?? 'middle'];
  const hue = (n: number) => Math.round((from + seeded(key, n) * span) % 360);
  const spot = (i: number) => {
    const x = Math.round(10 + seeded(key, 10 + i) * 80);
    const y = Math.round(10 + seeded(key, 20 + i) * 80);
    const radius = Math.round(26 + seeded(key, 30 + i) * 30);
    /* the last spot is the light catching it: paler and brighter */
    const l = i === 3 ? Math.min(tone.l + 22, 90) : tone.l + Math.round((seeded(key, 40 + i) - 0.5) * 34);
    const sat = i === 3 ? Math.round(tone.s * 0.5) : tone.s;
    return { x, y, radius, color: `hsl(${hue(i + 1)} ${sat}% ${l}%)` };
  };
  return { base: `hsl(${hue(0)} ${Math.round(tone.s * 0.6)}% ${tone.l - 26}%)`, spots: [spot(0), spot(1), spot(2), spot(3)] as const };
}

/** A voice's avatar, drawn from its stable palette. */
export function voiceLook(v: Parameters<typeof voicePalette>[0]): { background: string } {
  return voicePaletteLook(voicePalette(v));
}

export function voicePaletteLook({ base, spots }: ReturnType<typeof voicePalette>): { background: string } {
  return { background: `${spots.map(({ x, y, radius, color }) => `radial-gradient(circle at ${x}% ${y}%, ${color} 0%, transparent ${radius}%)`).join(', ')}, ${base}` };
}
