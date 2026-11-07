/**
 * The models that run on this computer, as Settings → Services → Local services shows them
 * (studio/server/local-models.mjs): each installed or not, an installed one on or off, and one coming with how much of
 * it is here.
 */
import React from 'react';

/** What a local model is for, wherever they are grouped. */
export type LocalKind = 'asr' | 'cutout';
export const LOCAL_KINDS: LocalKind[] = ['asr', 'cutout'];

export interface LocalModel {
  id: string;
  kind: LocalKind;
  name: string;
  /** who made it, and where they publish it */
  by: string;
  site: string;
  license: string;
  /** its files, and about how much memory it takes while it runs */
  bytes: number;
  memoryMb: number;
  installed: boolean;
  on: boolean;
  /** part of this checkout (a source checkout's): it cannot be removed */
  builtIn: boolean;
  /** coming: how much of it is here */
  installing?: { bytes: number };
  /** its last download failed (offline, or a file that did not check): Install tries again */
  failed?: boolean;
}

async function call(path: string, method = 'GET', body?: unknown): Promise<LocalModel[]> {
  const res = await fetch(`/api/local-models${path}`, {
    method, cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({})) as { models?: LocalModel[]; error?: string };
  if (!res.ok || !data.models) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data.models;
}

/** The models, kept current (asked again every second while one is coming), and what can be done with each. */
export function useLocalModels() {
  const [models, setModels] = React.useState<LocalModel[] | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  React.useEffect(() => { void call('').then(setModels, (e: Error) => setProblem(e.message)); }, []);
  const coming = models?.some((m) => m.installing) ?? false;
  React.useEffect(() => {
    if (!coming) return;
    const timer = window.setInterval(() => { void call('').then(setModels, () => {}); }, 1000);
    return () => window.clearInterval(timer);
  }, [coming]);
  const run = (job: Promise<LocalModel[]>) => job.then((next) => { setModels(next); setProblem(null); }, (e: Error) => setProblem(e.message));
  return {
    models,
    problem,
    install: (id: string) => run(call(`/${encodeURIComponent(id)}/install`, 'POST')),
    turn: (id: string, on: boolean) => run(call(`/${encodeURIComponent(id)}`, 'PUT', { on })),
    remove: (id: string) => run(call(`/${encodeURIComponent(id)}`, 'DELETE')),
  };
}

export type LocalModelsHook = ReturnType<typeof useLocalModels>;

/** A size as people read it: 139 MB, 1.2 GB. */
export function sizeText(bytes: number) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}
