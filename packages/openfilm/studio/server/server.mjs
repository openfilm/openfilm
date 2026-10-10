// @ts-check
/**
 * OpenFilm Studio's server: one process for the whole editor. Two origins, so a web page can never reach the editor:
 *
 *   http://127.0.0.1:<port>      the editor's pages and its API. The API needs the launch key: as a cookie, set by
 *                                /open?key=…, or as `x-studio-key` (the CLI). Writes from a browser must come from
 *                                this origin.
 *   http://localhost:<port + 1>  the film itself: project files, read only, for the preview (see pages.mjs).
 *
 * Both answer only requests addressed to 127.0.0.1, localhost or [::1] at their own port (ownHost): another site
 * whose name is pointed at this machine (DNS rebinding) gets nothing, not even /api/health.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { EditError, editProjectFilm, readProjectFilm } from './film.mjs';
import { FileError, extractAudio, freezeFrame, importFile, inside, listFiles, makeFolder, moveFile, trashFile } from './files.mjs';
import { ExportError, createExports, exportCapabilities, exportsRoot, projectSizes } from './exports.mjs';
import { MediaError, frame, loudness, poster, probe, waveform } from './derived.mjs';
import { HistoryError, checkout, commitChanges, deleteBranch, discardChanges, historyFiles, log, mergeBranch, renameBranch, restoreCommit, status as historyStatus } from './history.mjs';
import { ownHost, startPages } from './pages.mjs';
import { HttpError, cookie, json, readJson } from './http.mjs';
import { acceptWebSocket } from './websocket.mjs';
import {
  ProjectError, createFolder, createProject, deleteFolder, deleteProject, libraryRoot, listFolders, listProjects, locateProject, markOpened,
  moveProjectToFolder, openProject, projectById, renameFolder, renameProject, studioHome, studioKey, TOOL_DIR,
} from './projects.mjs';
import { FetchError, createFetches } from './fetch-repo.mjs';
import { BrowseError, browseFolder, browsePlaces } from './browse.mjs';
import { listExamples } from './examples.mjs';
import { npmOpenfilm, olderThanThis } from '../client.mjs';
import { writeAtomic } from './atomic.mjs';
import { createWatchers } from './watch.mjs';
import { installedFonts } from './fonts.mjs';
import { projectFonts, resolveIn } from './project-fonts.mjs';
import { FILM_PAGE, PageFrameError, closePageFrames, filmPoster, pageFacts, pageFrame, warmFilmPoster } from './pageframes.mjs';
import { FILM_FILE, clipKind, isPage } from '../../src/film-doc.mjs';
import { providersRoute } from './providers/index.mjs';
import { captionRoutes } from './captions.mjs';
import { projectSettingsRoute } from './project-settings.mjs';
import { markersRoute } from './markers.mjs';
import { transitionPageRoutes } from './transition-pages.mjs';
import { createAsks, getRoute, subtitleTranscriber, subtitleTranslator } from './get.mjs';

/** @typedef {import('./http.mjs').Req} Req @typedef {import('./http.mjs').Res} Res */

/* the session cookie's name carries the port: cookies are per host, not per port, so two Studios on 127.0.0.1 (an
   installed one and a checkout, say) would otherwise sign each other's pages out */
const cookieName = (/** @type {number} */ port) => `openfilm_studio_${port}`;
/** How long `/open` waits, after a restart, for the pages of the Studio before to come back (they retry every second). */
const PAGES_BACK_MS = 3000;
/** The project's website (package.json `homepage`). */
const HOMEPAGE = (() => { try { return String(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).homepage ?? ''); } catch { return ''; } })();
/** Where the desktop app's installers are (product.json `desktop.updates`): empty in a build from source. */
const DESKTOP_FILES = (() => { try { return String(JSON.parse(readFileSync(new URL('../../product.json', import.meta.url), 'utf8')).desktop?.updates ?? '').replace(/\/+$/, ''); } catch { return ''; } })();

/**
 * The desktop app's installer for a system and chip, as the release publishes it, or null: an unknown system or chip,
 * or a build that names no place for installers.
 * @param {unknown} os @param {unknown} arch @param {string} [base]
 */
export function desktopInstaller(os, arch, base = DESKTOP_FILES) {
  if (!base || (arch !== 'arm64' && arch !== 'x64')) return null;
  if (os === 'mac') return `${base}/mac/${arch}/OpenFilm-${arch}.dmg`;
  if (os === 'win') return `${base}/win/${arch}/OpenFilm-Setup-${arch}.exe`;
  return null;
}

/**
 * Start Studio. `port` 0 picks a free one. `advertise`:
 * write where it listens to ~/.openfilm/run.json (removed on close), which is how the CLI finds this machine's Studio,
 * and open with the machine's key (see studioKey); otherwise the key is new each launch.
 * `onQuit`: what `POST /api/quit` does (by default, close); `stays`: it does nothing and says so (an app's Studio,
 * which its window needs). `editorDir`: the built editor to serve (by default studio/ui/dist); an app that builds
 * Studio's editor into a page of its own (its chat beside it) serves that one. `working`: the folders an app's agent
 * is working in right now (an app with a chat), which cannot be deleted meanwhile. Resolves once both servers listen.
 * @param {{ port?: number, key?: string, openBrowser?: (url: string) => void, advertise?: boolean, onQuit?: () => void, stays?: boolean, editorDir?: string, working?: () => string[] }} [options]
 */
export async function startStudio({ port = 4747, key, openBrowser = systemBrowser, advertise = false, onQuit, stays = false, editorDir = EDITOR_DIR, working = () => [] } = {}) {
  let COOKIE = cookieName(port);
  key ??= advertise ? studioKey() : randomBytes(24).toString('hex');
  const watchers = createWatchers();
  /** questions about spending for the person, in the pages showing a project (see get.mjs) */
  const asks = createAsks({ emit: (root, event) => watchers.emit(root, event), roots: watchers.roots });
  /** the editor pages open right now, and whether each is in sight: `/open` switches them to a project */
  /** @type {Map<(event: unknown) => void, { visible: boolean }>} */
  const editorPages = new Map();
  /** a page connected: what `/open` waits on after a restart, while the pages of the Studio before come back */
  let pageCame = () => {};
  /** media being made for an agent's `openfilm get` right now (it would be lost, and paid for, if Studio stopped) */
  let making = 0;
  /** whether an app's agent is working in the project at `path` now */
  const agentIn = (/** @type {string} */ path) => working().some((folder) => resolve(folder) === resolve(path));
  /** how many editor pages have connected since Studio started: whether one opened an address `/open` gave out */
  let pagesConnected = 0;
  /** @type {(event: unknown) => void} */
  const toPages = (event) => { for (const send of editorPages.keys()) send(event); };
  let origin = '';
  let filmOrigin = '';

  /** where each project's exports report their progress: the pages watching it */
  const exportRoots = new Map();
  const exports = createExports({ onChange: (job) => { const root = exportRoots.get(job.project); if (root) watchers.emit(root, { type: 'export', job }); } });
  /** films fetched from GitHub into the library (fetch-repo.mjs), each opened as a project when it lands */
  const fetches = createFetches({ library: libraryRoot, open: (folder) => openProject(folder) });

  const sameKey = (/** @type {string | null | undefined} */ given) => typeof given === 'string' && given.length === key.length
    && timingSafeEqual(Buffer.from(given), Buffer.from(key));

  /** The caller holds the key; a browser write must also come from the editor's own origin. */
  function authorize(/** @type {Req} */ req) {
    if (sameKey(/** @type {string | undefined} */ (req.headers['x-studio-key']))) return;
    if (!sameKey(cookie(req, COOKIE))) throw new HttpError(401, 'open Studio from the address `openfilm open` prints');
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin !== origin) throw new HttpError(403, 'not from Studio');
  }

  /*
   * The editor pages' streams of events, over WebSockets (websocket.mjs): `/api/events`, what the CLI's `open` sends
   * (and how many pages are open), and `/api/projects/:id/events`, a project's changes and the questions for the
   * person. Each returns how it stops.
   */
  /** @param {(event: unknown) => void} send @param {{ visible: boolean }} page */
  const editorStream = (send, page) => {
    editorPages.set(send, page);
    pagesConnected += 1;
    pageCame();
    return () => { editorPages.delete(send); };
  };
  /** @param {{ path: string }} project @param {(event: any) => void} send */
  const projectStream = (project, send) => {
    const stop = watchers.subscribe(project.path, send);
    for (const ask of asks.pending(project.path)) send(ask);
    return stop;
  };

  /** @param {Req} req @param {Res} res */
  async function route(req, res) {
    const url = new URL(req.url ?? '/', origin);
    const path = url.pathname;

    /* which Studio this is: the CLI replaces an older one, and finds its own home's when run.json is gone. Asked
       without the key, so it says nothing of the machine: its home only as a digest (homeTag), no process id */
    if (path === '/api/health') return json(res, 200, { product: 'openfilm-studio', version: VERSION, home: homeTag(), filmOrigin });
    if (path === '/open') {
      if (!sameKey(url.searchParams.get('key'))) throw new HttpError(403, 'this link is from another Studio launch; use the one `openfilm open` printed');
      const to = url.searchParams.get('to') ?? '/';
      res.writeHead(302, {
        location: /^\/(?!\/)[^\s\\]*$/.test(to) ? to : '/',
        'set-cookie': `${COOKIE}=${key}; Path=/; HttpOnly; SameSite=Strict`,
      });
      return res.end();
    }
    if (!path.startsWith('/api/')) return sendEditor(res, editorDir, path);

    authorize(req);
    const parts = path.slice('/api/'.length).split('/').map(decodeURIComponent);

    /* stop: another app is taking over this machine's Studio, or `openfilm open` starts it afresh (`whenIdle`: not
       while an export runs or media is made — it would be lost). `pages`: how many were open, to come back */
    if (parts[0] === 'quit' && parts.length === 1 && req.method === 'POST') {
      const { whenIdle = false } = /** @type {{ whenIdle?: boolean }} */ ((await readJson(req).catch(() => null)) ?? {});
      if (whenIdle && exports.busy()) return json(res, 409, { error: 'an export is running' });
      if (whenIdle && making) return json(res, 409, { error: 'media is being made' });
      /* not busy, but kept (423, not 409: the app asks its own Studio whether it is busy this way) */
      if (stays) return json(res, 423, { error: 'it is the OpenFilm app\'s, which keeps it' });
      json(res, 200, { pages: editorPages.size });
      setImmediate(() => (onQuit ?? (() => { void studio.close(); }))());
      return;
    }
    /* `openfilm open [folder]`: open it (no folder: the project opened last, else the Projects window) and show it.
       Every Studio page open already switches to it; when one is in sight (not a tab behind others, a window
       minimized, an agent's hidden browser), nothing more opens: one window is enough. Else in a browser: the
       agent's own when it opens the address within `fallback` seconds, else the person's (`now`: at once, for a
       person at a terminal, who has no other). `pages`: how many the Studio before this one had, waited for up to a
       few seconds while they come back (Studio was just started afresh) */
    if (parts[0] === 'open' && req.method === 'POST') {
      const { path: folder, fallback = 15, now = false, pages: before = 0 } = /** @type {{ path?: string, fallback?: number, now?: boolean, pages?: number }} */ (await readJson(req));
      if (folder != null && (typeof folder !== 'string' || !folder)) throw new HttpError(400, 'which folder?');
      /* a relative path would be read from Studio's own folder, not the caller's */
      if (folder != null && !isAbsolute(folder)) throw new HttpError(400, 'the folder\'s full path, please');
      /* the last one still there as a project: a folder whose film.html was taken away is not made one again */
      const last = folder == null ? (await listProjects()).find((p) => !p.missing && existsSync(join(p.path, FILM_FILE))) : null;
      const project = folder != null ? await openProject(folder) : last ? await openProject(last.path) : null;
      const to = project ? `/projects/${encodeURIComponent(project.id)}` : '/';
      const address = `${origin}/open?key=${key}&to=${encodeURIComponent(to)}`;
      for (const end = Date.now() + PAGES_BACK_MS; editorPages.size < before && Date.now() < end;) {
        await new Promise((done) => { pageCame = () => done(undefined); setTimeout(done, end - Date.now()).unref(); });
      }
      pageCame = () => {};
      const open = [...editorPages.values()].filter((page) => page.visible).length;
      toPages({ type: 'open', to });
      if (!open) {
        const before = pagesConnected;
        if (now) openBrowser(address);
        else if (fallback > 0) setTimeout(() => { if (pagesConnected === before) openBrowser(address); }, fallback * 1000).unref();
      }
      return json(res, 200, { project, url: address, pages: open });
    }

    /* this Studio's version, and the latest on npm (Settings → General; `?check=1` asks npm now) */
    if (parts[0] === 'version' && parts.length === 1 && req.method === 'GET') {
      const now = url.searchParams.get('check') === '1';
      const { latest, checkedAt } = await npmOpenfilm({ force: now, waitMs: 4000 });
      return json(res, 200, { version: VERSION, latest, newer: Boolean(latest && olderThanThis(VERSION, latest)), checkedAt, checking: !process.env.OPENFILM_NO_UPDATE_CHECK && !FROM_SOURCE, source: FROM_SOURCE });
    }
    /* the fonts installed here (what a web page can draw with, in the preview and the export alike) */
    if (parts[0] === 'fonts' && parts.length === 1 && req.method === 'GET') return json(res, 200, { fonts: await installedFonts() });

    /* the top bar's Desktop button: the installer for this computer ({ os, arch }) opened in the person's browser,
       else the website, where the download is */
    if (parts[0] === 'desktop' && parts.length === 1 && req.method === 'POST') {
      const { os, arch } = /** @type {{ os?: unknown, arch?: unknown }} */ (await readJson(req).catch(() => ({})) ?? {});
      const to = desktopInstaller(os, arch) ?? HOMEPAGE;
      if (to) openBrowser(to);
      return json(res, 200, {});
    }
    /* ── own keys and who makes each kind of media (Settings → Providers): never a key back; see providers/index.mjs ── */
    if (parts[0] === 'providers') return providersRoute(req, res, parts.slice(1), { openBrowser });
    /* ── `openfilm get`: media from a provider, landed in the project; spending is asked here first (see get.mjs) ── */
    if (parts[0] === 'get') {
      making += req.method === 'POST' ? 1 : 0;
      try { return await getRoute(req, res, parts.slice(1), asks); } finally { making -= req.method === 'POST' ? 1 : 0; }
    }

    /* the web editor's folder browser (browse.mjs): `path`'s folders, only under the home folder, and where to start */
    if (parts[0] === 'browse' && parts.length === 1 && req.method === 'GET') {
      const listing = await browseFolder(url.searchParams.get('path'));
      const places = await browsePlaces({ library: libraryRoot(), recent: (await listProjects()).filter((p) => !p.missing).map((p) => p.path) });
      return json(res, 200, { ...listing, ...places });
    }
    /* the example films (examples.mjs): none when the index cannot be read */
    if (parts[0] === 'examples' && parts.length === 1 && req.method === 'GET') return json(res, 200, { examples: await listExamples() });

    if (parts[0] !== 'projects') throw new HttpError(404, 'no such API');
    if (parts.length === 1) {
      if (req.method === 'GET') return json(res, 200, { projects: (await listProjects()).map((p) => (agentIn(p.path) ? { ...p, working: true } : p)) });
      /* `create` false: only a folder holding a film opens (the editor asks before starting one in a folder) */
      if (req.method === 'POST') {
        const body = /** @type {{ path?: string, name?: string, create?: boolean }} */ (await readJson(req));
        return json(res, 200, { project: body.path ? await openProject(body.path, { create: body.create !== false }) : await createProject(body.name) });
      }
    }
    /* a film from GitHub (fetch-repo.mjs): POST { url } `projects/fetch` starts it → { job }; GET `projects/fetch/:id`
       says how it goes (`project` once it is opened); DELETE stops it */
    if (parts[1] === 'fetch') {
      if (parts.length === 2 && req.method === 'POST') return json(res, 200, { job: fetches.start(/** @type {{ url?: string }} */ (await readJson(req)).url) });
      if (parts.length === 3 && req.method === 'GET') return json(res, 200, { job: fetches.get(parts[2]) });
      if (parts.length === 3 && req.method === 'DELETE') { fetches.cancel(parts[2]); return json(res, 200, {}); }
    }
    /* the Projects list's folders (projects.mjs): GET / POST { name } `projects/folders`, PATCH { name } / DELETE
       `projects/folders/:id` (DELETE answers the ids of the projects that were in it), PUT { folderId }
       `projects/:id/folder` (null: no folder) */
    if (parts[1] === 'folders' && parts.length <= 3) {
      if (parts.length === 2 && req.method === 'GET') return json(res, 200, { folders: await listFolders() });
      if (parts.length === 2 && req.method === 'POST') return json(res, 200, { folder: await createFolder(/** @type {{ name?: string }} */ (await readJson(req)).name) });
      if (parts.length === 3 && req.method === 'PATCH') return json(res, 200, { folder: await renameFolder(parts[2], /** @type {{ name?: string }} */ (await readJson(req)).name) });
      if (parts.length === 3 && req.method === 'DELETE') return json(res, 200, { projects: await deleteFolder(parts[2]) });
    }
    if (parts.length === 3 && parts[2] === 'folder' && req.method === 'PUT') {
      const { folderId = null } = /** @type {{ folderId?: string | null }} */ (await readJson(req));
      return json(res, 200, { project: await moveProjectToFolder(parts[1], folderId || null) });
    }
    /* a project whose folder was moved: the folder it is in now (projects.mjs locateProject) */
    if (parts.length === 3 && parts[2] === 'locate' && req.method === 'POST') {
      const { path: folder } = /** @type {{ path?: string }} */ (await readJson(req));
      if (typeof folder !== 'string' || !isAbsolute(folder)) throw new HttpError(400, 'the folder\'s full path, please');
      return json(res, 200, { project: await locateProject(parts[1], folder) });
    }
    const project = await projectById(parts[1]);
    const rest = parts.slice(2).join('/');
    /* a project whose folder is gone (moved, renamed or deleted outside Studio): taking it off the list is all there is */
    if (!existsSync(project.path) && !(!rest && req.method === 'DELETE')) {
      throw new HttpError(410, 'This project’s folder is not there any more: it was moved, renamed or deleted.', { code: 'missing' });
    }
    /* ── subtitles: the film's lines, the person's subtitle style, translation (see captions.mjs) ── */
    if (await captionRoutes(req, res, project.path, rest, { translate: subtitleTranslator, transcribe: await subtitleTranscriber() })) return;
    /* ── end subtitles ── */
    /* the editor's settings of the project: its frame rate, its tracks' names (see project-settings.mjs) */
    if (await projectSettingsRoute(req, res, project.path, rest)) return;
    /* its markers (markers.mjs): Studio's own, beside film.html */
    if (await markersRoute(req, res, project.path, rest)) return;
    /* the page under a dip to white, kept once (transition-pages.mjs) */
    if (await transitionPageRoutes(req, res, project.path, rest)) return;
    if (!rest) {
      /* `folder`: the project's files on the film's origin, where the preview loads them */
      if (req.method === 'GET') {
        const film = await readProjectFilm(project.path);
        /* opened: its card in the projects list gets a picture before the list first shows it */
        if (film.doc?.tracks.some((t) => t.clips.length)) warmFilmPoster(project.path, pages.folderUrl(project));
        return json(res, 200, { project, folder: pages.folderUrl(project), ...film });
      }
      if (req.method === 'PATCH') {
        const { name } = /** @type {{ name?: string }} */ (await readJson(req));
        const renamed = await renameProject(project.id, String(name ?? ''));
        /* its address stays: the preview open on it keeps loading from the folder by its new name */
        pages.folderUrl(renamed);
        return json(res, 200, { project: renamed });
      }
      /* the project is deleted: its folder goes to the Trash (pages showing it go back to the list) */
      if (req.method === 'DELETE') {
        /* its files are being written, and its chat is mid-turn: stopped first, by the person */
        if (agentIn(project.path)) throw new HttpError(409, 'An agent is running in this project: stop it first, then delete the project.', { code: 'agent-running' });
        await deleteProject(project.id);
        return json(res, 200, {});
      }
    }
    /* an editor page shows it: the person opened it, so it is the one `openfilm open` alone comes back to */
    if (rest === 'opened' && req.method === 'POST') return json(res, 200, { project: await markOpened(project.id) });
    /* the fonts its pages declare with @font-face, and with `page` (a project path) the families that page can draw with
       and names (project-fonts.mjs): the font menu's "In this project" */
    if (rest === 'fonts' && req.method === 'GET') {
      const page = url.searchParams.get('page');
      return json(res, 200, await projectFonts(project.path, page ? resolveIn('', page) : null));
    }
    /* ── version history: git, every change of it the person's (history.mjs) ──
         GET    history                          → { status, commits }: the branch checked out, the branches, the
                                                   uncommitted changes, the film's files against the folder's, and
                                                   the commits of the branch, newest first
         GET    history/files                    → { held, ignored }: the film's files, and the others (never kept)
         GET    history/poster/:commit           the film's picture when it was committed (404: none was taken)
         POST   history/commit    { message }    commit the uncommitted changes
         POST   history/discard                  put the film back as the last commit holds it
         POST   history/restore   { commit }     the film as a commit holds it, as uncommitted changes
         POST   history/checkout  { branch, create?, from?, carry? }   check out a branch (or make one)
         PATCH  history/branches/:name { name }  rename a branch
         DELETE history/branches/:name[?force=1] delete one
         POST   history/merge     { branch, message, prefer? }          merge a branch into the one checked out
       Every change tells the project's pages ({ type: 'history' }); one that changed the folder, the film too. While
       one runs, they hear how far it is ({ type: 'history-progress', op, phase, done, total }). */
    if (parts[2] === 'history') {
      const history = parts.slice(3);
      const changed = () => watchers.emit(project.path, { type: 'history' });
      /** @param {string} op */
      const onProgress = (op) => (/** @type {{ phase: string, done: number, total: number }} */ p) => watchers.emit(project.path, { type: 'history-progress', op, ...p });
      if (!history.length && req.method === 'GET') {
        const [state, commits] = await Promise.all([historyStatus(project.path, { onProgress: onProgress('load') }), log(project.path)]);
        return json(res, 200, { status: state, commits });
      }
      if (history[0] === 'files' && history.length === 1 && req.method === 'GET') return json(res, 200, await historyFiles(project.path));
      if (history[0] === 'poster' && history.length === 2 && req.method === 'GET') {
        if (!/^[0-9a-f]{40}$/.test(history[1])) throw new HttpError(400, 'which commit?');
        const jpeg = await readFile(join(project.path, TOOL_DIR, 'cache', 'commits', `${history[1]}.jpg`)).catch(() => null);
        if (!jpeg) throw new HttpError(404, 'no picture of that commit');
        res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable', 'content-length': jpeg.length });
        return res.end(jpeg);
      }
      if (history[0] === 'commit' && req.method === 'POST') {
        const { message } = /** @type {{ message?: string }} */ (await readJson(req));
        const sha = await commitChanges(project.path, String(message ?? ''), { onProgress: onProgress('commit') });
        changed();
        /* the film's picture as it was committed, for the commit's card: drawn after the answer (it takes a moment) */
        void pageFrame(project.path, pages.folderUrl(project), FILM_PAGE, -1, 480)
          .then(async (jpeg) => {
            const dir = join(project.path, TOOL_DIR, 'cache', 'commits');
            await mkdir(dir, { recursive: true });
            await writeAtomic(join(dir, `${sha}.jpg`), jpeg);
          })
          .then(changed, () => {});
        return json(res, 200, { commit: sha });
      }
      if (history[0] === 'discard' && req.method === 'POST') {
        await discardChanges(project.path, { onProgress: onProgress('discard') });
        changed();
        return json(res, 200, await readProjectFilm(project.path));
      }
      if (history[0] === 'restore' && req.method === 'POST') {
        const { commit: target } = /** @type {{ commit?: string }} */ (await readJson(req));
        const { missing } = await restoreCommit(project.path, String(target ?? ''), { onProgress: onProgress('restore') });
        changed();
        /* `missing`: media of that version history no longer has (left as it is in the folder) */
        return json(res, 200, { missing, ...(await readProjectFilm(project.path)) });
      }
      if (history[0] === 'checkout' && req.method === 'POST') {
        const { branch, create, from, carry } = /** @type {{ branch?: string, create?: boolean, from?: string, carry?: 'leave' | 'bring' }} */ (await readJson(req));
        const back = await checkout(project.path, { target: String(branch ?? ''), create: create === true, ...(from ? { from: String(from) } : {}), carry: carry === 'bring' ? 'bring' : 'leave', onProgress: onProgress('checkout') });
        changed();
        /* `parkedBack` false: the changes left on that branch collide with it now and stay put away */
        return json(res, 200, { parkedBack: back, ...(await readProjectFilm(project.path)) });
      }
      if (history[0] === 'branches' && history.length === 2) {
        if (req.method === 'PATCH') {
          const { name } = /** @type {{ name?: string }} */ (await readJson(req));
          const renamed = await renameBranch(project.path, history[1], String(name ?? ''));
          changed();
          return json(res, 200, { name: renamed });
        }
        if (req.method === 'DELETE') {
          await deleteBranch(project.path, history[1], { force: url.searchParams.get('force') === '1' });
          changed();
          return json(res, 200, {});
        }
      }
      if (history[0] === 'merge' && req.method === 'POST') {
        const { branch, message, prefer } = /** @type {{ branch?: string, message?: string, prefer?: string }} */ (await readJson(req));
        const merged = await mergeBranch(project.path, { branch: String(branch ?? ''), message: String(message ?? ''), ...(prefer === 'ours' || prefer === 'theirs' ? { prefer } : {}), onProgress: onProgress('merge') });
        changed();
        return json(res, 200, { merged, ...(await readProjectFilm(project.path)) });
      }
      throw new HttpError(404, 'no such history action');
    }
    if (rest === 'edit' && req.method === 'POST') {
      const { base = null, ops } = /** @type {{ base?: string | null, ops?: import('./film.mjs').Op[] }} */ (await readJson(req));
      try {
        return json(res, 200, await editProjectFilm(project.path, base, ops ?? []));
      } catch (e) {
        if (!(e instanceof EditError)) throw e;
        /* the person's view is out of date or the edit cannot be: send the film as it is now with the reason */
        const now = await readProjectFilm(project.path);
        throw new HttpError(e.kind === 'conflict' ? 409 : 422, e.message, { rev: now.rev, doc: now.doc });
      }
    }
    /* a video's sound, made a file of its own beside it (files.mjs extractAudio) */
    if (rest === 'files/audio' && req.method === 'POST') {
      const { path: from } = /** @type {{ path?: string }} */ (await readJson(req));
      return json(res, 200, { path: await extractAudio(project.path, String(from ?? '')) });
    }
    /* a video's frame made a still beside it (files.mjs freezeFrame): the timeline's freeze frame */
    if (rest === 'files/still' && req.method === 'POST') {
      const { path: from, ms } = /** @type {{ path?: string, ms?: number }} */ (await readJson(req));
      return json(res, 200, { path: await freezeFrame(project.path, String(from ?? ''), Number(ms)) });
    }
    if (rest === 'files') {
      const at = url.searchParams.get('path') ?? '';
      if (req.method === 'GET') return json(res, 200, await listFiles(project.path));
      /* the body is the file itself, streamed to disk: an import of any size */
      if (req.method === 'PUT') {
        const { path: landed } = await importFile(project.path, at, req);
        /* a picture, video or sound that cannot be read (a broken or mislabelled file) is kept, and said: it would
           only fail later, as a blank tile or a clip that never plays. Read as the kind its ending says: a picture
           or a video with no picture in it (a size of 0), a sound with no sound */
        const kind = isPage(landed) ? null : clipKind(landed);
        const unreadable = kind
          ? await probe(project.path, landed).then(
            (/** @type {{ width?: number, height?: number, audio?: boolean }} */ facts) => (kind === 'sound'
              ? (facts.audio ? null : 'there is no sound in it')
              : (Number(facts.width) > 0 && Number(facts.height) > 0 ? null : 'there is no picture in it')),
            (e) => (e instanceof MediaError && e.status !== 501 ? e.message : null))
          : null;
        return json(res, 200, { path: landed, ...(unreadable ? { unreadable } : {}) });
      }
      if (req.method === 'PATCH') {
        const { from, to } = /** @type {{ from?: string, to?: string }} */ (await readJson(req));
        return json(res, 200, await moveFile(project.path, String(from ?? ''), String(to ?? '')));
      }
      if (req.method === 'DELETE') {
        await trashFile(project.path, at);
        return json(res, 200, {});
      }
    }
    /* what Studio works out from a media file: its length and size, a poster, a frame, a waveform (see derived.mjs) */
    if (rest === 'media' && req.method === 'GET') {
      const at = url.searchParams.get('path') ?? '';
      const what = url.searchParams.get('what');
      /* a web page says its own length and size (none: it has no end) */
      if (what === 'probe' && isPage(at)) {
        return json(res, 200, await pageFacts(project.path, pages.folderUrl(project), at).catch((e) => {
          throw new HttpError(e instanceof PageFrameError ? 404 : 422, String(e?.message ?? e));
        }));
      }
      if (what === 'probe') return json(res, 200, await probe(project.path, at));
      if (what === 'wave') return json(res, 200, await waveform(project.path, at));
      /* the loudness of a part of its sound (`from`, `to`: its own seconds): what "Normalize loudness" sets volumes by */
      if (what === 'loudness') {
        const to = url.searchParams.get('to');
        return json(res, 200, await loudness(project.path, at, Number(url.searchParams.get('from') ?? 0), to == null ? undefined : Number(to)));
      }
      /* a web page has no file to cut a frame from: it is drawn, as an export draws it (pageframes.mjs) */
      const page = isPage(at) && (what === 'poster' || what === 'frame')
        ? () => pageFrame(project.path, pages.folderUrl(project), at, what === 'poster' ? -1 : Number(url.searchParams.get('ms')), what === 'poster' ? 480 : Number(url.searchParams.get('w'))).catch((e) => {
          throw new HttpError(e instanceof PageFrameError ? 404 : 422, String(e?.message ?? e));
        })
        : null;
      const jpeg = page ? await page()
        : what === 'poster' ? await poster(project.path, at)
        : what === 'frame' ? await frame(project.path, at, Number(url.searchParams.get('ms')), Number(url.searchParams.get('w')))
        : null;
      if (!jpeg) throw new HttpError(400, 'what: probe, poster, frame, wave or loudness');
      /* a media file's frame: the address names the file's version (the page adds its mtime), so the browser keeps
         it. A page's: it changes with any file the page loads, which the address cannot say, so it is asked again
         each time, an unchanged one answered in a word (304) */
      if (page) {
        const tag = `"${createHash('sha1').update(jpeg).digest('hex').slice(0, 16)}"`;
        if (req.headers['if-none-match'] === tag) { res.writeHead(304, { etag: tag, 'cache-control': 'private, no-cache' }); return res.end(); }
        res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, no-cache', etag: tag, 'content-length': jpeg.length });
        return res.end(jpeg);
      }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400', 'content-length': jpeg.length });
      return res.end(jpeg);
    }
    /* exports (what one asks: see exports.mjs). GET also says where they go by default, what this machine encodes and
       how many subtitle cues the film has (the subtitle choices need some), and how big the project and its parts are */
    if (rest === 'exports') {
      if (req.method === 'GET') {
        return json(res, 200, { exports: exports.list(project.id), folder: exportsRoot(), can: await exportCapabilities(), subtitles: await exports.subtitles(project.path), project: await projectSizes(project.path) });
      }
      if (req.method === 'POST') {
        exportRoots.set(project.id, project.path);
        const body = /** @type {any} */ (await readJson(req));
        /* several at once: `{ jobs: [ask…], folder? }` → `{ exports }`; one: the ask itself → `{ export }` */
        if (body && typeof body === 'object' && 'jobs' in body) return json(res, 200, { exports: exports.startAll(project, body) });
        return json(res, 200, { export: exports.start(project, body) });
      }
    }
    if (parts[2] === 'exports' && parts[3] && req.method === 'DELETE') {
      if (exports.list(project.id).some((j) => j.id === parts[3])) exports.cancel(parts[3]);
      return json(res, 200, {});
    }
    /* a finished export, shown where it is on the person's computer, or opened in its app */
    if (parts[2] === 'exports' && parts[3] && (parts[4] === 'reveal' || parts[4] === 'open') && req.method === 'POST') {
      const job = exports.list(project.id).find((j) => j.id === parts[3]);
      const file = job?.outputs[0];
      if (!file || !existsSync(file)) throw new HttpError(404, 'that export is not there any more');
      if (parts[4] === 'reveal') reveal(file);
      else openFile(file);
      return json(res, 200, {});
    }
    /* the film's middle frame: the project's card in the projects list */
    if (rest === 'poster' && req.method === 'GET') {
      /* a film with nothing in it yet has no picture to show (its card shows its own face, not a black frame) */
      const { doc } = await readProjectFilm(project.path);
      if (!doc?.tracks.some((t) => t.clips.length)) throw new HttpError(404, 'the film is empty');
      const jpeg = await filmPoster(project.path, pages.folderUrl(project)).catch((e) => {
        throw new HttpError(e instanceof PageFrameError ? 404 : 422, String(e?.message ?? e));
      });
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=60', 'content-length': jpeg.length });
      return res.end(jpeg);
    }
    /* a file or folder of the project, shown where it is on the person's computer */
    if (rest === 'reveal' && req.method === 'POST') {
      const { path: rel } = /** @type {{ path?: string }} */ (await readJson(req));
      /* no path: the project's own folder */
      const abs = rel ? inside(project.path, String(rel)) : project.path;
      if (!existsSync(abs)) throw new HttpError(404, 'that is not there any more');
      reveal(abs);
      return json(res, 200, {});
    }
    if (rest === 'folders' && req.method === 'POST') {
      const { path: folder } = /** @type {{ path?: string }} */ (await readJson(req));
      return json(res, 200, { path: await makeFolder(project.path, String(folder ?? '')) });
    }
    throw new HttpError(404, 'no such API');
  }

  const editor = createServer((req, res) => {
    if (!ownHost(req, /** @type {import('node:net').AddressInfo} */ (editor.address()).port)) { json(res, 403, { error: 'not this address' }); return; }
    route(req, res).catch((/** @type {unknown} */ e) => {
      const status = e instanceof HttpError || e instanceof ProjectError || e instanceof FileError || e instanceof HistoryError || e instanceof MediaError || e instanceof ExportError
        || e instanceof FetchError || e instanceof BrowseError ? e.status : 500;
      if (status === 500) console.error(e);
      if (res.headersSent) return res.end();
      json(res, status, { error: e instanceof Error ? e.message : String(e), ...(e instanceof HttpError ? e.extra : {}),
        ...((e instanceof ProjectError || e instanceof FetchError || e instanceof BrowseError) && e.code ? { code: e.code } : {}),
        ...(e instanceof HistoryError && e.code ? { code: e.code, ...('commits' in e ? { commits: e.commits } : {}) } : {}) });
    });
  });
  /* the streams: the key, as for the API, and only from the editor's own origin (another site's page could otherwise
     listen with the person's cookie) */
  /** the streams' sockets: not the server's connections once upgraded, so closing Studio ends them itself */
  /** @type {Set<import('node:stream').Duplex>} */
  const streamSockets = new Set();
  editor.on('upgrade', (req, socket) => {
    streamSockets.add(socket);
    socket.once('close', () => streamSockets.delete(socket));
    /* an upgraded socket is no longer the server's to watch: a page gone mid-request (a reset, a write after it left)
       would otherwise be an error no one hears, which ends Studio. That connection only is dropped */
    socket.on('error', () => socket.destroy());
    const refuse = (/** @type {string} */ status) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    if (!ownHost(req, /** @type {import('node:net').AddressInfo} */ (editor.address()).port)) return refuse('403 Forbidden');
    void (async () => {
      const path = new URL(req.url ?? '/', origin).pathname;
      const keyed = sameKey(/** @type {string | undefined} */ (req.headers['x-studio-key'])) || (sameKey(cookie(req, COOKIE)) && req.headers.origin === origin);
      if (!keyed) return refuse('401 Unauthorized');
      const parts = path.split('/').slice(1).map(decodeURIComponent);
      /** @type {() => void} */
      let stop = () => {};
      if (path === '/api/events') {
        /* in sight or not, as the page says when it connects and whenever that changes */
        const page = { visible: new URL(req.url ?? '/', origin).searchParams.get('visible') !== '0' };
        const send = acceptWebSocket(req, socket, () => stop(), (text) => {
          try { const said = JSON.parse(text); if (typeof said?.visible === 'boolean') page.visible = said.visible; } catch { /* not ours */ }
        });
        if (send) stop = editorStream(send, page);
        return;
      }
      if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'projects' && parts[3] === 'events') {
        const project = await projectById(parts[2]).catch(() => null);
        if (!project || !existsSync(project.path)) return refuse('404 Not Found');
        const send = acceptWebSocket(req, socket, () => stop());
        if (send) stop = projectStream(project, send);
        return;
      }
      refuse('404 Not Found');
    })().catch(() => refuse('500 Internal Server Error'));
  });
  await new Promise((done, fail) => { editor.once('error', fail); editor.listen(port, '127.0.0.1', () => done(undefined)); });
  const address = /** @type {import('node:net').AddressInfo} */ (editor.address());
  origin = `http://127.0.0.1:${address.port}`;
  COOKIE = cookieName(address.port);
  /* the film's port is the next one: when it is not free, the editor's is let go again, so a caller can try others */
  const pages = await startPages({ port: port ? address.port + 1 : 0, editorOrigin: () => origin, secret: key, projects: listProjects }).catch(async (e) => {
    watchers.closeAll();
    await new Promise((done) => editor.close(() => done(undefined)));
    throw e;
  });
  filmOrigin = pages.origin;
  if (advertise) {
    mkdirSync(studioHome(), { recursive: true });
    /* `supervisor`: the process that starts this one again if it ends unexpectedly (main.mjs), stopped with it */
    const supervisor = Number(process.env.OPENFILM_STUDIO_SUPERVISOR) || undefined;
    writeFileSync(runFile(), `${JSON.stringify({ pid: process.pid, ...(supervisor ? { supervisor } : {}), origin, filmOrigin: pages.origin, key })}\n`, { mode: 0o600 });
  }

  /** @type {Promise<void> | null} */
  let closing = null;
  const studio = {
    origin,
    filmOrigin: pages.origin,
    port: address.port,
    key,
    close() { return closing ??= shutDown(); },
  };
  async function shutDown() {
    /* the file is ours unless a later Studio has written its own (with the same key: it is the machine's) */
    if (advertise && advertised()?.pid === process.pid) rmSync(runFile(), { force: true });
    exports.stopAll();
    fetches.stopAll();
    await closePageFrames();
    watchers.closeAll();
    await pages.close();
    editor.closeAllConnections();
    for (const socket of streamSockets) socket.destroy();
    await new Promise((done) => editor.close(() => done(undefined)));
  }
  return studio;
}

/** Run from a checkout of the repository (the editor's source is beside its build), not from an installed package. */
const FROM_SOURCE = existsSync(new URL('../ui/src', import.meta.url));

/** This package's version: the CLI replaces a Studio older than itself. */
export const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

/**
 * Studio's home as /api/health says it: its SHA-256 (hex), so the CLI can tell its own home's Studio without anyone
 * asking learning where the home is (and with it the person's name).
 */
export const homeTag = () => createHash('sha256').update(studioHome()).digest('hex');

/** Where the Studio running on this machine says it listens (see `advertise`). */
export const runFile = () => join(studioHome(), 'run.json');

/** @returns {{ pid: number, origin: string, filmOrigin: string, key: string } | null} */
function advertised() {
  try { return JSON.parse(readFileSync(runFile(), 'utf8')); } catch { return null; }
}

/* the editor, built (`npm run build:ui`) into studio/ui/dist and shipped with the package */
const EDITOR_DIR = fileURLToPath(new URL('../ui/dist/', import.meta.url));
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

/** The editor's files: its assets as they are (named by their content, so kept for good), any other path its page. */
function sendEditor(/** @type {Res} */ res, /** @type {string} */ dir, /** @type {string} */ path) {
  const root = dir.endsWith(sep) ? dir : dir + sep;
  if (path.startsWith('/assets/')) {
    const file = normalize(join(root, path));
    if (file.startsWith(root + 'assets' + sep) && existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, { 'content-type': TYPES[/** @type {keyof typeof TYPES} */ (extname(file))] ?? 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable' });
      return res.end(readFileSync(file));
    }
    res.writeHead(404).end();
    return;
  }
  const page = join(root, 'index.html');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(existsSync(page) ? readFileSync(page) : '<!doctype html><meta charset="utf-8"><title>OpenFilm Studio</title><p>The editor is not built: run <code>npm run build:ui</code>.</p>');
}

/** A file in the system's file manager, selected. */
function reveal(/** @type {string} */ file) {
  /* Explorer takes `/select,"<path>"` as one argument, quoted inside: Node's own quoting of a path with spaces it
     does not read (export names always have spaces) */
  if (process.platform === 'win32') {
    try { spawn('explorer.exe', [`/select,"${file}"`], { stdio: 'ignore', detached: true, windowsVerbatimArguments: true }).on('error', () => {}).unref(); } catch { /* no file manager */ }
    return;
  }
  const [cmd, ...args] = process.platform === 'darwin' ? ['open', '-R', file] : ['xdg-open', join(file, '..')];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* no file manager */ }
}

/**
 * The command that opens a file in its app, or an address in the person's browser. Never through a shell: on Windows
 * `cmd /c start` would read `&`, `|` or `^` in a file's name, or in an address's query, as commands of its own.
 * @param {string} target @param {NodeJS.Platform} [platform]
 */
export function opener(target, platform = process.platform) {
  if (platform === 'win32') return /^https?:\/\//i.test(target) ? ['rundll32', 'url.dll,FileProtocolHandler', target] : ['explorer.exe', target];
  return platform === 'darwin' ? ['open', target] : ['xdg-open', target];
}

/** A file in the app the system opens it with. */
function openFile(/** @type {string} */ file) {
  const [cmd, ...args] = opener(file);
  try { spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref(); } catch { /* nothing opens it */ }
}

/** The person's browser, at `url`. */
function systemBrowser(/** @type {string} */ url) {
  const [cmd, ...args] = opener(url);
  try { spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref(); } catch { /* no browser to open */ }
}

