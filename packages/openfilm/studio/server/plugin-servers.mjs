// @ts-check
/**
 * The server code of OpenFilm's own plugins. A plugin in `plugins/<id>/` may bring a `server.mjs`; Studio answers its
 * routes under `/api/plugins/<id>/…`, so a new plugin brings what it needs of Studio's server in its own folder and
 * never changes server.mjs.
 *
 *   // plugins/<id>/server.mjs
 *   export default (studio) => ({
 *     'GET /projects/:project/note': async ({ params }) => {
 *       const { path } = await studio.project(params.project);
 *       return { text: await readFile(studio.readable(path, 'note.txt'), 'utf8') };   // answered as JSON, 200
 *     },
 *     'POST /projects/:project/note': async ({ req, res, params, url }) => { … },
 *   });
 *
 * The default export is called once, when one of the plugin's routes is first asked for, with `studio`
 * (PluginStudio below):
 *
 *   id, folder               the plugin's id, and its folder
 *   project(id)              a project by its id: { id, name, path }; 404 when there is none, 410 when its folder is gone
 *   inside(root, rel)        the absolute path of a project's file, to write it (files.mjs): refused (400) when it is
 *                            outside the project or in its `.film/`
 *   readable(root, rel)      the same, to read it: a linked file is followed to where it is kept
 *   emit(root, data)         told to the pages showing the project at `root`, as `{ type: 'plugin', plugin: id, data }`
 *                            on its stream of events (the editor's lib/plugin-api `events`)
 *   prefs()                  Studio's preferences (prefs.mjs), to read
 *   log.info|warn|error      Studio's log, the plugin's id first; an error is kept with Studio's problems too
 *   HttpError, json, readJson   http.mjs: a thrown HttpError(status, message) is answered as `{ error }` with its status
 *
 * It returns its routes: `'METHOD /path'` → a handler, the path's `:name` parts given as `params.name` (decoded). A
 * handler gets `{ req, res, params, url }`, and answers itself or returns what is answered as JSON. A route that is
 * not there is 404. The editor's page calls them with lib/plugin-api.
 *
 * Every route needs the key, as every `/api/` route does (server.mjs authorize), and is answered only while the
 * plugin is on: turned off, its routes are not there (404) at once, and turned on they answer again, without Studio
 * starting again.
 *
 * Only OpenFilm's own plugins (src/plugins.mjs pluginsDir) bring server code. It is loaded into Studio's own process,
 * where it can do all Studio can (its key, every project, the person's files) and can be neither held back nor
 * stopped: that is right for code that ships with OpenFilm and is read as OpenFilm is. A plugin someone made brings a
 * program instead (plugin-programs.mjs), which runs in a process of its own, only once the person has let it, and is
 * stopped when the plugin is turned off.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pluginStates, pluginsDir } from '../../src/plugins.mjs';
import { recordProblem } from '../../src/problems.mjs';
import { inside, readable } from './files.mjs';
import { HttpError, json, readJson } from './http.mjs';
import { readPrefs } from './prefs.mjs';
import { projectMissing } from './project-presence.mjs';
import { projectById } from './projects.mjs';

/** The file of a plugin that brings server code. */
export const PLUGIN_SERVER = 'server.mjs';

/** @typedef {import('./http.mjs').Req} Req @typedef {import('./http.mjs').Res} Res */
/**
 * @typedef {{
 *   id: string, folder: string,
 *   project: (id: string) => Promise<{ id: string, name: string, path: string }>,
 *   inside: typeof inside, readable: typeof readable,
 *   emit: (root: string, data: unknown) => void,
 *   prefs: typeof readPrefs,
 *   log: { info: (...said: unknown[]) => void, warn: (...said: unknown[]) => void, error: (...said: unknown[]) => void },
 *   HttpError: typeof HttpError, json: typeof json, readJson: typeof readJson,
 * }} PluginStudio
 */
/** @typedef {(asked: { req: Req, res: Res, params: Record<string, string>, url: URL }) => unknown} PluginHandler */
/** @typedef {{ method: string, path: string[], handler: PluginHandler }} PluginRoute */

/**
 * The routes a plugin's default export returned, as kept: what is not one is left out, and said in the log.
 * @param {string} id @param {unknown} routes @returns {PluginRoute[]}
 */
function routesOf(id, routes) {
  if (!routes || typeof routes !== 'object') {
    console.warn(`plugin ${id}: its ${PLUGIN_SERVER} gave no routes`);
    return [];
  }
  /** @type {PluginRoute[]} */
  const out = [];
  for (const [key, handler] of Object.entries(routes)) {
    const match = /^(GET|POST|PUT|PATCH|DELETE) \/(\S*)$/.exec(key);
    if (!match || typeof handler !== 'function') { console.warn(`plugin ${id}: "${key}" is not a route (GET /path → a function)`); continue; }
    out.push({ method: match[1], path: match[2].split('/'), handler: /** @type {PluginHandler} */ (handler) });
  }
  return out;
}

/**
 * Studio's side of its plugins' server code. `emit`: tell the pages showing a project (server.mjs, its watchers).
 * @param {{ emit: (root: string, event: import('./watch.mjs').FolderEvent) => void }} o
 */
export function createPluginServers({ emit }) {
  /** each plugin's routes, once its default export was called (null: it brings no server code) */
  /** @type {Map<string, Promise<PluginRoute[] | null>>} */
  const loaded = new Map();

  /** @param {string} id @returns {PluginStudio} */
  const studioFor = (id) => {
    const said = (/** @type {unknown[]} */ words) => [`plugin ${id}:`, ...words];
    return {
      id, folder: join(pluginsDir(), id),
      async project(projectId) {
        const { id: found, name, path } = await projectById(projectId);
        if (projectMissing(path) === 'folder') throw new HttpError(410, 'This project’s folder is not there any more: it was moved, renamed or deleted.', { code: 'missing' });
        return { id: found, name, path };
      },
      inside, readable,
      emit: (root, data) => emit(root, { type: 'plugin', plugin: id, data }),
      prefs: readPrefs,
      log: {
        info: (...words) => console.log(...said(words)),
        warn: (...words) => console.warn(...said(words)),
        error: (...words) => {
          console.error(...said(words));
          recordProblem({ area: 'plugin', step: id, what: words.map((w) => (w instanceof Error ? w.message : String(w))).join(' ') });
        },
      },
      HttpError, json, readJson,
    };
  };

  /** @param {string} id @returns {Promise<PluginRoute[] | null>} */
  const load = (id) => {
    let routes = loaded.get(id);
    if (!routes) {
      const file = join(pluginsDir(), id, PLUGIN_SERVER);
      routes = !existsSync(file) ? Promise.resolve(null) : import(pathToFileURL(file).href).then(async (module) => {
        if (typeof module.default !== 'function') throw new Error(`its ${PLUGIN_SERVER} has no default export to call`);
        return routesOf(id, await module.default(studioFor(id)));
      });
      /* one that did not load is tried again on the next request, saying why each time */
      routes.catch(() => loaded.delete(id));
      loaded.set(id, routes);
    }
    return routes;
  };

  return {
    /**
     * Answer `/api/plugins/<id>/<parts…>`: the route of a plugin that is on, else 404.
     * @param {Req} req @param {Res} res @param {string} id @param {string[]} parts @param {URL} url
     */
    async route(req, res, id, parts, url) {
      if (!pluginStates().some((p) => p.id === id && p.on)) throw new HttpError(404, 'no such API');
      let routes;
      /* a 500, which Studio's log keeps (server.mjs) */
      try { routes = await load(id); } catch (e) {
        throw new HttpError(500, `The ${id} plugin's server code did not load: ${e instanceof Error ? e.message : String(e)}`);
      }
      for (const { method, path, handler } of routes ?? []) {
        if (method !== req.method || path.length !== parts.length) continue;
        /** @type {Record<string, string>} */
        const params = {};
        const fits = path.every((p, i) => {
          if (!p.startsWith(':')) return p === parts[i];
          params[p.slice(1)] = parts[i];
          return parts[i] !== '';
        });
        if (!fits) continue;
        const out = await handler({ req, res, params, url });
        if (!res.headersSent && !res.writableEnded) json(res, 200, out ?? {});
        return;
      }
      throw new HttpError(404, 'no such API');
    },
  };
}
