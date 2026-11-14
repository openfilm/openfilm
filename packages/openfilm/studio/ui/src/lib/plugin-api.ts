/**
 * A plugin's own routes, for its element in the editor's page: what its `server.mjs` answers under
 * `/api/plugins/<id>/…` (studio/server/plugin-servers.mjs). Called as the editor calls Studio (api.ts): from the
 * editor's own origin, so the key travels as the cookie Studio set, and a refusal is an ApiError with its status.
 *
 *   const notes = pluginApi('notes');
 *   const { text } = await notes.get<{ text: string }>(`projects/${encodeURIComponent(projectId)}/note`);
 *   const stop = notes.events(projectId, (data) => { … });
 *
 * A path is the route's, without the leading `/`, each part a project's id included encoded by the caller.
 */
import { call, projectEvents } from '../api';

export interface PluginApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
  /** What the plugin's server code tells the pages of a project (its `studio.emit`); returns how to stop listening. */
  events(projectId: string, on: (data: unknown) => void): () => void;
}

/** The routes of the plugin `id`. */
export function pluginApi(id: string): PluginApi {
  const at = (path: string) => `plugins/${encodeURIComponent(id)}/${path.replace(/^\/+/, '')}`;
  return {
    get: <T>(path: string) => call<T>(at(path)),
    post: <T>(path: string, body: unknown = {}) => call<T>(at(path), { method: 'POST', json: body }),
    put: <T>(path: string, body: unknown = {}) => call<T>(at(path), { method: 'PUT', json: body }),
    patch: <T>(path: string, body: unknown = {}) => call<T>(at(path), { method: 'PATCH', json: body }),
    delete: <T>(path: string) => call<T>(at(path), { method: 'DELETE' }),
    events: (projectId, on) => projectEvents(projectId, (event) => { if (event.type === 'plugin' && event.plugin === id) on(event.data); }),
  };
}
