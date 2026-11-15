import React from 'react';
import { refreshSaved, useSavedRevision } from './saved';

export interface AssetMeta {
  id: string;
  path: string;
  starred: boolean;
  collections: string[];
}
export interface AssetCollection {
  id: string;
  name: string;
}
export interface AssetCatalog {
  items: Record<string, AssetMeta>;
  collections: AssetCollection[];
}
export interface AssetUse {
  id: string;
  name: string;
  uses: number;
  mode: 'copy' | 'link';
  present: boolean;
}

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Studio answered ${response.status}`);
  return result;
}

export const assetLibrary = {
  catalog: () => call<AssetCatalog>('/api/saved/catalog'),
  star: (paths: string[], starred: boolean) =>
    call('/api/saved/catalog', 'PATCH', { paths, starred }).then(refreshSaved),
  collect: (paths: string[], collectionId: string, add = true) =>
    call('/api/saved/catalog', 'PATCH', { paths, collectionId, add }).then(refreshSaved),
  createCollection: (name: string) =>
    call<{ collection: AssetCollection }>('/api/saved/collections', 'POST', { name }).then((result) => {
      refreshSaved();
      return result.collection;
    }),
  removeCollection: (id: string) =>
    call(`/api/saved/collections?id=${encodeURIComponent(id)}`, 'DELETE').then(refreshSaved),
  add: (projectId: string, path: string, mode: 'copy' | 'link') =>
    call(`/api/projects/${encodeURIComponent(projectId)}/library/add`, 'POST', { path, mode }),
  usage: (path: string) =>
    call<{ projects: AssetUse[] }>(`/api/saved/usage?path=${encodeURIComponent(path)}`).then(
      (result) => result.projects,
    ),
};

export function useAssetCatalog() {
  const revision = useSavedRevision();
  const [catalog, setCatalog] = React.useState<AssetCatalog>({ items: {}, collections: [] });
  const [error, setError] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    void assetLibrary.catalog().then(
      (value) => {
        if (alive) {
          setCatalog(value);
          setError(false);
        }
      },
      () => {
        if (alive) setError(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [revision]);
  return { catalog, error };
}

export const RESOURCE_CENTER_EVENT = 'openfilm:resource-center';
export function openResourceCenter() {
  window.dispatchEvent(new CustomEvent(RESOURCE_CENTER_EVENT));
}
