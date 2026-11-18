/** Private voices: recordings kept on this computer, spoken by OpenFilm's service (studio/server/voices.mjs). */
import React from 'react';
import type { LibraryVoice, VoiceAccess } from './library-voices';
import { useProviders } from './providers.ts';

export const MY_VOICES = 'my-voices';
export interface PrivateVoice extends LibraryVoice {
  uid: string;
  mine: true;
  available: boolean;
  status: 'creating' | 'training' | 'ready' | 'verification' | 'failed' | 'uncertain';
  models: string[];
  previewUrl: string | null;
  problem: string | null;
  kind: 'clone' | 'import';
  updated: number;
  /** a voice of OpenFilm's service: the maker it is cloned at there (inworld, elevenlabs) */
  engine?: string;
}
/** A maker OpenFilm's service clones voices at, with the models that speak them. */
export interface VoiceEngine { id: string; name: string; models: string[] }
export interface VoiceConnection {
  id: string;
  name: string;
  connected: boolean;
  clone: boolean;
  sync: boolean;
  /** a voice already in the person's own account can be added by its ID */
  import: boolean;
  minSeconds: number;
  maxSeconds: number;
  models: { id: string; name: string }[];
  /** OpenFilm's service: the makers it clones at, its default first */
  engines?: VoiceEngine[];
  pricingUrl?: string;
  consoleUrl: string;
}
interface Catalog { voices: PrivateVoice[]; services: VoiceConnection[] }
let snapshot: Catalog | null = null;
let inFlight: Promise<void> | null = null;
let revision = 0;
const subscribers = new Set<() => void>();
const emit = () => { for (const fn of subscribers) fn(); };
export const isPrivateVoice = (v: LibraryVoice): v is PrivateVoice => 'mine' in v && v.mine === true;
export const privateVoiceAccess = (v: PrivateVoice): VoiceAccess | undefined => v.available && v.status === 'ready' ? { via: v.provider, models: v.models } : undefined;

export function reloadPrivateVoices(): Promise<void> {
  if (inFlight) return inFlight;
  const current = revision;
  inFlight = fetch('/api/voices', { cache: 'no-store' }).then(async (res) => {
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `Studio answered ${res.status}`);
    if (current === revision && Array.isArray(body.voices) && Array.isArray(body.services)) { snapshot = body; emit(); }
  }).finally(() => { inFlight = null; });
  return inFlight;
}

export function usePrivateVoices() {
  const { state: providers } = useProviders();
  const seen = React.useSyncExternalStore((fn) => { subscribers.add(fn); return () => { subscribers.delete(fn); }; }, () => snapshot, () => snapshot);
  const [error, setError] = React.useState<string | null>(null);
  const refresh = React.useCallback(() => reloadPrivateVoices().then(() => setError(null), (e: Error) => setError(e.message)), []);
  React.useEffect(() => { void refresh(); }, [refresh, providers]);
  React.useEffect(() => {
    if (!seen?.voices.some((v) => v.status === 'creating' || v.status === 'training')) return;
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [seen, refresh]);
  return { voices: seen?.voices ?? [], services: seen?.services ?? [], loading: !seen && !error, error, reload: refresh };
}

async function action<T>(path: string, method: string, body?: unknown): Promise<T> {
  try {
    const res = await fetch(`/api/voices${path}`, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const value = await res.json();
    if (!res.ok) throw new Error(value.error ?? `Studio answered ${res.status}`);
    return value as T;
  } finally {
    revision++;
    if (inFlight) await inFlight.catch(() => {});
    await reloadPrivateVoices().catch(() => {});
  }
}

export interface CloneInput {
  provider: string; name: string; language: string; consent: boolean; engine?: string;
  audio?: { data: string }; project?: { id: string; path: string }; start?: number; end?: number;
}
export const createPrivateVoice = (body: CloneInput) => action<{ voice: PrivateVoice }>('', 'POST', body);
export const refreshPrivateVoice = (uid: string) => action<{ voice: PrivateVoice }>(`/${encodeURIComponent(uid)}/refresh`, 'POST');
export const renamePrivateVoice = (uid: string, name: string) => action<{ voice: PrivateVoice }>(`/${encodeURIComponent(uid)}`, 'PATCH', { name });
export const removePrivateVoice = (uid: string) => action<void>(`/${encodeURIComponent(uid)}`, 'DELETE');
export const previewPrivateVoice = (uid: string, text: string) => action<{ voice: PrivateVoice }>(`/${encodeURIComponent(uid)}/preview`, 'POST', { text });

/** FileReader keeps conversion off the JS argument stack, even for a large WAV. */
export function recordingBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('The recording could not be read.'));
    reader.readAsDataURL(file);
  });
}
