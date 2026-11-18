
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
  add: (projectId: string, path: string, mode: 'copy' | 'link') =>
    call(`/api/projects/${encodeURIComponent(projectId)}/library/add`, 'POST', { path, mode }),
  usage: (path: string) =>
    call<{ projects: AssetUse[] }>(`/api/saved/usage?path=${encodeURIComponent(path)}`).then(
      (result) => result.projects,
    ),
};
