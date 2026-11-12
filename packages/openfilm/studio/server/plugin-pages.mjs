// @ts-check
/**
 * The plugins' origin: where the surface of a plugin someone made runs (a skill with a page, src/skills.mjs
 * SKILL_PAGE), on a port of its own.
 *
 *   /s/<token>/…   the plugin's own folder, read only, as its author wrote it (nothing is put in its pages)
 *   /f/<grant>/…   the files of the project the page is shown for: read (GET, with an `etag`), and written (PUT) once
 *                  the person has said this plugin may change projects (`mayWrite`)
 *
 * A grant is one plugin in one project, signed with Studio's key like the film's tokens: the page is given its address
 * (`?project=`), and cannot work out another project's or another plugin's.
 *
 * Why another origin than the film's: the film's is read only, so that a film's pages (anything an agent wrote, a film
 * fetched from elsewhere) can never change a project. Those pages cannot use this one: to a browser it is another
 * origin, which answers no origin but itself, and a write is taken only from a page of this origin (its `Origin`), to
 * this machine by name (ownHost). Nor can a page here reach the editor: it has neither its key nor its cookie (another
 * site). Plugins are not kept apart from each other: they share this origin's storage, as projects share the film's.
 *
 * A write names a file that could be read (pages.mjs servable: no hidden file or folder such as `.film/` or `.env`, no
 * way out of the folder, not through a link), never a folder, at most MAX_BYTES. `If-Match` with the tag a GET gave
 * takes it only if the file is still that one (412 otherwise); `If-None-Match: *` only if there is none. It is written
 * whole, through a file beside it, and Studio then sees it as it sees an agent's write: merged with the person's edits
 * and shown (watch.mjs).
 */
import { createHmac } from 'node:crypto';
import { createWriteStream, realpathSync, statSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, normalize, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { folderFiles, listenLocal } from '../../src/host.mjs';
import { replaceFile, tempPath } from './atomic.mjs';
import { ownHost, servable } from './pages.mjs';

/** The most a page may write to one file. */
export const MAX_BYTES = 256 * 1024 * 1024;

/** A file's tag: it changes whenever the file is written. */
const tagOf = (/** @type {import('node:fs').Stats} */ stat) => `"${stat.size.toString(36)}-${Math.round(stat.mtimeMs).toString(36)}"`;

/**
 * `port`: the one to listen on (0: any free one). `secret`: what tokens are signed with (Studio's key). `mayWrite`:
 * whether the person lets this plugin change this project, asked at every write.
 * @param {{ port: number, secret: string, mayWrite: (plugin: { uid: string, source: string }, project: { id: string }) => boolean }} options
 */
export async function startPluginPages({ port, secret, mayWrite }) {
  const headers = { 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' };
  const sign = (/** @type {string} */ what) => createHmac('sha256', secret).update(`plugin origin\0${what}`).digest().subarray(0, 18).toString('base64url');
  /** @type {Map<string, string>} a plugin's token → its folder */
  const folders = new Map();
  /** @type {Map<string, { plugin: { uid: string, source: string }, project: { id: string, path: string } }>} */
  const grants = new Map();
  let origin = '';

  /** Whether `plain` (an address inside `root`, decoded) names a file a page may write: inside the folder for real. */
  const writable = (/** @type {string} */ root, /** @type {string} */ plain) => {
    if (!plain || plain.endsWith('/') || plain.includes('\\') || plain.includes('\0') || !servable(root, plain)) return null;
    const file = normalize(join(root, plain));
    if (!file.startsWith(root + sep)) return null;
    /* the nearest folder there is, really inside the project: a link among its folders does not lead a write out */
    let home, at = dirname(file);
    try { home = realpathSync.native(root); } catch { return null; }
    for (;;) {
      try { const real = realpathSync.native(at); return real === home || real.startsWith(home + sep) ? file : null; } catch { /* not made yet: its parent */ }
      if (at === dirname(at)) return null;
      at = dirname(at);
    }
  };

  const server = createServer(async (req, res) => {
    const own = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
    if (!ownHost(req, own)) { res.writeHead(403, headers).end('not this address'); return; }
    const url = new URL(req.url ?? '/', 'http://plugins');
    const match = /^\/([sf])\/([\w-]+)(\/.*)?$/.exec(url.pathname);
    const reading = req.method === 'GET' || req.method === 'HEAD';
    if (!match) { res.writeHead(404, headers).end('not found'); return; }
    const path = match[3] ?? '/';
    let plain = path;
    try { plain = decodeURIComponent(path); } catch { res.writeHead(400, headers).end('bad address'); return; }

    if (match[1] === 's') {
      const folder = folders.get(match[2]);
      if (!folder || !servable(folder, plain)) { res.writeHead(404, headers).end('not found'); return; }
      if (!reading) { res.writeHead(405, { ...headers, allow: 'GET, HEAD' }).end(); return; }
      url.searchParams.set('film-host', '0');
      if (!folderFiles(folder, { inject: '', headers })(req, res, path, url.searchParams)) res.writeHead(403, headers).end();
      return;
    }

    const grant = grants.get(match[2]);
    if (!grant || !servable(grant.project.path, plain)) { res.writeHead(404, headers).end('not found'); return; }
    const root = grant.project.path;
    if (reading) {
      /* the file as it is on disk (a page of the film, and film.html itself, as written), with its tag */
      let stat = null;
      try { stat = statSync(join(root, plain)); } catch { /* not there: folderFiles answers */ }
      const tag = stat?.isFile() ? tagOf(stat) : null;
      if (tag && req.headers['if-none-match'] === tag) { res.writeHead(304, { ...headers, etag: tag }).end(); return; }
      url.searchParams.set('film-host', '0');
      if (!folderFiles(root, { inject: '', headers: { ...headers, ...(tag ? { etag: tag } : {}) } })(req, res, path, url.searchParams)) res.writeHead(403, headers).end();
      return;
    }
    if (req.method !== 'PUT') { res.writeHead(405, { ...headers, allow: 'GET, HEAD, PUT' }).end(); return; }
    /* only a page of this origin writes: a browser says where a request comes from, and another site cannot say this */
    if (req.headers.origin !== origin || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) { res.writeHead(403, headers).end('Only a plugin\'s own page writes here.'); return; }
    if (!mayWrite(grant.plugin, grant.project)) { res.writeHead(403, headers).end('This plugin is not allowed to change the project. The person allows it on the plugin\'s page in the library.'); return; }
    const file = writable(root, plain.replace(/^\/+/, ''));
    if (!file) { res.writeHead(403, headers).end('That file cannot be written.'); return; }
    let now = null;
    try { now = statSync(file); } catch { /* a new file */ }
    if (now?.isDirectory()) { res.writeHead(409, headers).end('That is a folder.'); return; }
    const match1 = req.headers['if-match'], none = req.headers['if-none-match'];
    if ((match1 && (!now || match1 !== tagOf(now))) || (none === '*' && now)) { res.writeHead(412, { ...headers, ...(now ? { etag: tagOf(now) } : {}) }).end('The file changed since it was read.'); return; }
    if (Number(req.headers['content-length'] ?? 0) > MAX_BYTES) { res.writeHead(413, headers).end('too big'); return; }
    const tmp = tempPath(file);
    try {
      await mkdir(dirname(file), { recursive: true });
      let size = 0;
      await pipeline(req, async function* limit(source) {
        for await (const chunk of source) { size += chunk.length; if (size > MAX_BYTES) throw Object.assign(new Error('too big'), { status: 413 }); yield chunk; }
      }, createWriteStream(tmp));
      await replaceFile(tmp, file);
      res.writeHead(now ? 204 : 201, { ...headers, etag: tagOf(statSync(file)) }).end();
    } catch (e) {
      await rm(tmp, { force: true });
      if (!res.headersSent) res.writeHead(/** @type {any} */ (e)?.status === 413 ? 413 : 500, headers).end(/** @type {any} */ (e)?.status === 413 ? 'too big' : 'not written');
    }
  });
  await listenLocal(server, port);
  /* named `localhost`, as the film's origin is: another site than the editor's (127.0.0.1) to a browser */
  origin = `http://localhost:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;

  return {
    origin,
    /**
     * Where a plugin's page is, and (shown for a project) where that project's files are for it.
     * @param {{ uid: string, source: string, folder: string, page: string }} plugin @param {{ id: string, path: string } | null} [project]
     */
    surface(plugin, project) {
      const token = sign(`folder\0${plugin.folder}`);
      folders.set(token, plugin.folder);
      const page = `${origin}/s/${token}/${plugin.page}`;
      if (!project) return { page };
      const grant = sign(`grant\0${plugin.folder}\0${project.id}`);
      grants.set(grant, { plugin: { uid: plugin.uid, source: plugin.source }, project: { id: project.id, path: project.path } });
      return { page, project: `${origin}/f/${grant}/` };
    },
    close: () => new Promise((done) => { server.closeAllConnections(); server.close(() => done(undefined)); }),
  };
}
