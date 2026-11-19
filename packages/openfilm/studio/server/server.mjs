// @ts-check
/**
 * OpenFilm Studio's server: one process for the whole editor. Three origins, so a web page can never reach the editor:
 *
 *   http://127.0.0.1:<port>      the editor's pages and its API. The API needs the launch key: as a cookie, set by
 *                                any page's address with ?key=… (/open?key=… too), or as `x-studio-key` (the CLI).
 *                                The key stays in the pages' address, so a copied address opens Studio anywhere on
 *                                this machine (another browser, an agent's preview). Writes from a browser must come
 *                                from this origin.
 *   http://localhost:<port + 1>  the film itself: project files, read only, for the preview (see pages.mjs).
 *   http://localhost:<port + 2>  the plugins people made: their pages, and the project's files for them, written only
 *                                with the person's leave (see plugin-pages.mjs); any free port when that one is taken.
 *
 * Each answers only requests addressed to 127.0.0.1, localhost or [::1] at its own port (ownHost): another site
 * whose name is pointed at this machine (DNS rebinding) gets nothing, not even /api/health.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { pipeline } from 'node:stream';
import { mkdir, readFile, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { EditError, editProjectFilm, pageClipLook, readProjectFilm, settleProjectFilm } from './film.mjs';
import { compoundOuter, readPartFilm, writePartFilm } from './parts.mjs';
import { COVERS, PARTS, compoundFolder, srcInto } from './compound.mjs';
import { CoverFilmError, coverFolder, coverFrame, coverLook, coverLooks, coverPicture, discardCover, drawCovers, listCovers, mainCover, madeCoverPictures, makeCover, restoreCover, setMainCover } from './covers.mjs';
import { readPage, writePage } from './page-text.mjs';
import { FileError, bringIn, collect, extractAudio, freezeFrame, importFile, inside, listFiles, makeFolder, moveCheck, moveFile, readable, relink, trashFile } from './files.mjs';
import { mediaReferences } from '../../src/media-links.mjs';
import { ExportError, createExports, draftApps, exportCapabilities, exportsRoot, projectSizes, renderDefaults } from './exports.mjs';
import { MediaError, frame, loudness, mixLoudness, mixedWaveform, poster, probe, waveform } from './derived.mjs';
import { HistoryError, checkoutVersion, copyVersion, deleteVersions, discardChanges, keepAside, log, recoverVersions, restoreFilm, saveVersion, status as historyStatus, versionFilesChanged } from './history.mjs';
import * as personEdits from './person-edits.mjs';
import { createAutoVersions } from './auto-versions.mjs';
import { createHistoryPreviews } from './history-previews.mjs';
import { ownHost, servable, startPages } from './pages.mjs';
import { transferLibraryEntries } from './library-transfer.mjs';
import { HttpError, cookie, json, readJson } from './http.mjs';
import { acceptWebSocket } from './websocket.mjs';
import {
  ProjectError, createFolder, createProject, deleteFolder, deleteProject, duplicateProject, libraryRoot, listFolders, listProjects, locateProject, markOpened, moveFolder, moveLibrary,
  agentKeyOf, moveProjectToFolder, openProject, projectById, renameFolder, renameProject, studioHome, studioKey, TOOL_DIR,
} from './projects.mjs';
import { FetchError, createFetches, fetchFilm, parseRepoUrl } from './fetch-repo.mjs';
import { sealKeysWith, sealPlainKeys } from './keys.mjs';
/* the app's Studio seals the person's keys with it (startStudio `sealer`) */
export { vaultSealer } from './keys.mjs';
import { BrowseError, browseFolder, browsePlaces } from './browse.mjs';
import { exampleFile, exampleFolder, listExamples, listNews } from './examples.mjs';
import { pickFiles, pickFolder } from './folder-picker.mjs';
import { PROXY_HEIGHTS, readPrefs, writePrefs } from './prefs.mjs';
import { ensurePlayback, ensureProxies, playChecks, readyProxy } from './proxies.mjs';
import { ensurePreviews, knownLate, pausePreviews, cancelPreviews, clearPreviews, retryPreviews } from './preview-cache.mjs';
import { stopVisionDownloads } from '../../src/vision-assets.mjs';
import { npmOpenfilm, olderThanThis } from '../client.mjs';
import { createWatchers } from './watch.mjs';
import { projectMissing } from './project-presence.mjs';
import { installedFonts } from './fonts.mjs';
import { addTextFont, isFontFile, projectFonts, resolveIn } from './project-fonts.mjs';
import { FILM_PAGE, PageFrameError, closePageFrames, compoundSound, filmPoster, pageFacts, pageFrame, warmFilmPoster } from './pageframes.mjs';
import { COVER_FRAME_W, CoverError, clearCover, readCover, readCoverBody, setCover, setCoverFromFile } from './cover.mjs';
import { BUILT_IN, fetchItem, libraryAdded, libraryFavorites, libraryFileFetched, libraryIndex, libraryVoices, notHere, withPairs, refreshCommunity, setLibraryAdded, setLibraryFavorites, streamLibrary } from './library.mjs';
import { createMediaIndexer, mediaSummary } from './media-index.mjs';
import { carryMade, madeView } from './media-made.mjs';
import { pluginOfSkill, pluginStates, pluginsDir, removePlugin, setPluginOn, setWorkbenchOrder, workbenchOrder } from '../../src/plugins.mjs';
import { createReconnector, missingMedia, reconnect } from './media-reconnect.mjs';
import { clearProjectCache, storage } from './storage.mjs';
import { chooseStorage } from './saved-location.mjs';
import { moveToTrash } from './trash.mjs';
import { SavedError, TEXT_COMPONENT, TEXT_OWN_FONTS, bundlePoster, copyFromLibrary, libraryPath, savePack, libraryRel, libraryRoot as savedLibrary, bringClip, saveClip, saveFile, saveGroup, takeSaved } from './saved.mjs';
import { addLibraryAsset, assetCatalog, assetUsage, catalogListing, existingLibraryAsset, moveAssetCatalog, refreshLibraryReferences, registerLibraryLinks, registerLibraryFolder, repairLibraryReferences, forgetLibraryPath, savedStarKey, starredListing, starredPaths } from './asset-library.mjs';
import { defaultPlace, ensureShelf, readHidden, shelfMoved, shelfRemoved, writeShelf } from './library-places.mjs';
import { FILM_FILE, clipKind, isPage } from '../../src/film-doc.mjs';
import { listenLocal } from '../../src/host.mjs';
import { captionTrackRoutes } from './caption-tracks.mjs';
import { binDelete, binList, binRestore, recycle } from './recycle-bin.mjs';
import { allowProjectSkill, appIconIn, revocationOf, revokedNow, skillFiles, commandsIn, coreSkills, elementIn, keeps, listSkills, offeredSkills, ownSkills, pluginRuns, projectSkillAllowed, pluginWrites, removeSkill, setPluginRuns, setPluginWrites, setSkillCover, setSkillOn, skillOrigins, skillsOff, thisPlatform } from '../../src/skills.mjs';
import { startPluginPages } from './plugin-pages.mjs';
import { startPluginPrograms } from './plugin-programs.mjs';
import { createPluginServers } from './plugin-servers.mjs';
import { communityStats, countInstall } from './community-stats.mjs';
import { verifyPublished } from './community-publish.mjs';
import { publishCheck } from '../../src/publish-cli.mjs';
import { communitySources, entrySources, setCommunitySources, catalogSkills, installSkill, installedStanding, readCatalog, readDiscover, seedCatalog, uninstallSkill } from './skill-catalog.mjs';
import { freshProviders, providersRoute } from './providers/index.mjs';
import { voicesRoute } from './voices.mjs';
import { localModelsRoute } from './local-models.mjs';
import { captionRoutes, writeSubtitleStyle } from './captions.mjs';
import { projectSettingsRoute, readProjectSettings } from './project-settings.mjs';
import { markersRoute } from './markers.mjs';
import { CANVAS_FILE, agentCanvasRoute, canvasRoute, canvasWriteRoute, readCanvas } from './canvas.mjs';
import { clipToolsRoute } from './clip-tools.mjs';
import { copyBoardInto, projectTemplatesRoute, templatesRoute } from './canvas-templates.mjs';
import { canvasMadeRoute } from './canvas-history.mjs';
import { charactersRoute, projectCharactersRoute } from './canvas-characters.mjs';
import { transitionPageRoutes } from './transition-pages.mjs';
import { createAsks, getRoute, subtitleTranscriber, subtitleTranslator } from './get.mjs';
import { chosenFolder, locations, savedRoot } from '../../src/locations.mjs';
import { doctor } from '../../src/doctor.mjs';
import { recentProblems } from '../../src/problems.mjs';
import { exportDiagnostics } from './diagnostics.mjs';

/** @typedef {import('./http.mjs').Req} Req @typedef {import('./http.mjs').Res} Res */

/* the session cookie's name carries the port: cookies are per host, not per port, so two Studios on 127.0.0.1 (an
   installed one and a checkout, say) would otherwise sign each other's pages out */
const cookieName = (/** @type {number} */ port) => `openfilm_studio_${port}`;
/* and its twin for a page shown inside another site's frame (an agent's preview pane): a SameSite=Strict cookie is
   neither kept nor sent there, so Studio would say "open it from the address…" however it was opened. This one is
   Partitioned (CHIPS): kept for that frame's top-level site only, so a page elsewhere never has it unless it framed the
   address with the key itself; and a write still has to come from the editor's own origin (authorize) */
const framedCookieName = (/** @type {number} */ port) => `${cookieName(port)}_framed`;
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
 * Whether a request changes what is the person's own to say, which an agent may not: who makes the media and with
 * which keys (Settings → Services, the models run here), Studio's preferences, and which plugins and skills are on,
 * installed or let write. Reading them is anyone's.
 * @param {string[]} parts the path after /api/ @param {string} method
 */
export function personsSay(parts, method) {
  if (method === 'GET' || method === 'HEAD') return false;
  const [head] = parts;
  if (head === 'providers' || head === 'local-models' || head === 'prefs' || head === 'voices') return true;
  if (head === 'locations') return method === 'PUT';
  if (head === 'plugins') return parts.length === 2;
  if (head === 'skills') return !(parts.length === 2 && parts[1] === 'catalog');
  return false;
}

/**
 * Start Studio. `port` 0 picks a free one. `advertise`:
 * write where it listens to ~/.openfilm/run.json (removed on close), which is how the CLI finds this machine's Studio,
 * and open with the machine's key (see studioKey); otherwise the key is new each launch.
 * `onQuit`: what `POST /api/quit` does (by default, close); `stays`: it does nothing and says so (an app's Studio,
 * which its window needs). `editorDir`: the built editor to serve (by default studio/ui/dist); an app that builds
 * Studio's editor into a page of its own (its chat beside it) serves that one. `working`: the folders an app's agent
 * is working in right now (an app with a chat), which cannot be renamed or deleted meanwhile. `askAgent`: in an app with
 * a chat, one question answered by the person's agent's own model, for Studio's own work that needs a model
 * (translating subtitles); without it, that goes to a service connected for it. `sealer`: the person's service keys
 * are kept sealed with it (keys.mjs), those found plain sealed now. `keepKey`: Studio's own `key` is the app's, kept in
 * its memory only: run.json names the agents' key (projects.mjs agentKeyOf, `keyKind: 'agent'`), so no file holds a
 * key to the person's say. `release`: an app's own processes in a project folder (its agent between turns) let go of
 * it, before the folder is renamed. Resolves once both servers listen.
 * @param {{ port?: number, key?: string, openBrowser?: (url: string) => void, advertise?: boolean, onQuit?: () => void, stays?: boolean, editorDir?: string, working?: () => string[], askAgent?: import('./get.mjs').AskAgent, indexMedia?: boolean, sealer?: import('./keys.mjs').Sealer, keepKey?: boolean, release?: (path: string) => Promise<void> }} [options]
 */
export async function startStudio({ port = 4747, key, openBrowser = systemBrowser, advertise = false, onQuit, stays = false, editorDir = EDITOR_DIR, working = () => [], askAgent, indexMedia = false, sealer, keepKey = false, release } = {}) {
  void refreshCommunity();
  let COOKIE = cookieName(port);
  let FRAMED = framedCookieName(port);
  /** The key a browser session holds, Studio's or the agents', from either session cookie (null: none). */
  const cookieKey = (/** @type {Req} */ req) => [cookie(req, COOKIE), cookie(req, FRAMED)].find((k) => sameKey(k) || matches(k, agentKey)) ?? null;
  key ??= advertise ? studioKey() : randomBytes(24).toString('hex');
  if (sealer) {
    sealKeysWith(sealer);
    await sealPlainKeys().catch((e) => console.warn(`service keys: not sealed yet (${e instanceof Error ? e.message : String(e)})`));
  }
  /* every change of an open project's folder: a version once it rests, when the person asked for that */
  const watchers = createWatchers({ onChange: (root, e) => {
    if (e.type === 'film' || e.type === 'files') autoVersions.changed(root);
    if (e.type === 'files') mediaIndex.soon(root);
  } });
  /* what is known of the person's media (media-index.mjs): a project's, a moment after its files changed or it was
     opened; `indexMedia` (the Studio the person runs, not one a test starts): every project's, once Studio is up */
  const mediaIndex = createMediaIndexer({
    onError: (root, e) => console.warn(`media index: ${root}: ${e instanceof Error ? e.message : String(e)}`),
    /* media that went missing is looked for unasked (media-reconnect.mjs): the pages hear how many came back */
    onProject: createReconnector({ onFound: (root, found) => watchers.emit(root, { type: 'files', reconnected: found.length }) }),
  });
  const sweepMedia = indexMedia ? setTimeout(() => { void mediaIndex.sweep().catch(() => {}); }, 20_000) : null;
  sweepMedia?.unref();
  /* the routes OpenFilm's own plugins bring (plugin-servers.mjs), each told to the pages of a project as it says */
  const pluginServers = createPluginServers({ emit: (root, event) => watchers.emit(root, event) });
  /** questions about spending for the person, in the pages showing a project (see get.mjs) */
  const asks = createAsks({ emit: (root, event) => watchers.emit(root, event), roots: watchers.roots });
  /** the editor pages open right now, and whether each is in sight: `/open` switches them to a project */
  /** @type {Map<(event: unknown) => void, { visible: boolean }>} */
  const editorPages = new Map();
  /** a page connected: what `/open` waits on after a restart, while the pages of the Studio before come back */
  let pageCame = () => {};
  /** media being made for an agent's `openfilm get` right now (it would be lost, and paid for, if Studio stopped) */
  let making = 0;
  /** the update run from the top bar: `{ status: 'updating' | 'failed', version, error? }` (see /api/update) */
  let updating = /** @type {{ status: 'updating' | 'failed', version: string, error?: string } | null} */ (null);
  /** whether an app's agent is working in the project at `path` now */
  const agentIn = (/** @type {string} */ path) => working().some((folder) => resolve(folder) === resolve(path));
  /* the person's edits kept over an agent's writes, the texts a merge read and wrote kept aside in the history */
  personEdits.configure({ keep: keepAside });
  /** The project at `root`'s history changed: its pages hear of it. `moved`: the folder's files changed with it. */
  const historyChanged = (/** @type {string} */ root, { moved = false } = {}) => watchers.emit(root, { type: 'history', ...(moved ? { moved: true } : {}) });
  /* versions saved on their own (auto-versions.mjs), while the person has Auto versions on */
  const autoVersions = createAutoVersions({
    on: () => readPrefs().autoVersions,
    working: agentIn,
    roots: () => watchers.roots(),
    save: async (root, kind) => { if (await saveVersion(root, { kind })) historyChanged(root); },
  });
  autoVersions.start();
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

  const matches = (/** @type {string | null | undefined} */ given, /** @type {string} */ want) => {
    if (typeof given !== 'string') return false;
    const a = Buffer.from(given), b = Buffer.from(want);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const sameKey = (/** @type {string | null | undefined} */ given) => matches(given, key);
  /* the key an agent the app runs comes with (projects.mjs agentKeyOf): Studio's all but the person's own say */
  const agentKey = agentKeyOf(key);

  /**
   * The caller holds the key; a browser write must also come from the editor's own origin. Says who it is: the
   * person (the pages, their CLI), or an agent the app runs (`x-studio-key` its key, or a browser it opened Studio
   * in with its key).
   * @returns {'person' | 'agent'}
   */
  function authorize(/** @type {Req} */ req) {
    const given = /** @type {string | undefined} */ (req.headers['x-studio-key']);
    if (sameKey(given)) return 'person';
    if (matches(given, agentKey)) return 'agent';
    const session = cookieKey(req);
    if (!session) throw new HttpError(401, 'open Studio from the address `openfilm open` prints');
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin !== origin) throw new HttpError(403, 'not from Studio');
    return sameKey(session) ? 'person' : 'agent';
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
  /** @param {Awaited<ReturnType<typeof projectById>>} project @param {(event: any) => void} send */
  const projectStream = (project, send) => {
    const stop = watchers.subscribe(project.path, send);
    /* A page reconnecting after a rename takes the current path even if it missed the live event. */
    send({ type: 'project', project });
    /* film.html missing as the page connects (or reconnects): said at once, not only when it goes */
    if (projectMissing(project.path) === 'film') send({ type: 'film-missing' });
    for (const ask of asks.pending(project.path)) send(ask);
    return stop;
  };

  /** @type {Set<Promise<unknown>>} */
  const savedRequests = new Set();
  /** @type {Promise<unknown> | null} */
  let movingStorage = null;

  /** @param {unknown} asked @param {boolean} [move] */
  async function changeStorage(asked, move = false) {
    if (asked != null && (typeof asked !== 'string' || !isAbsolute(asked))) throw new HttpError(400, 'Choose a folder by its full path.');
    if (movingStorage) throw new HttpError(409, 'The asset library is already moving.');
    const to = typeof asked === 'string' ? resolve(asked) : asked === null ? null : chosenFolder('projectsFolder');
    const change = (async () => {
      await Promise.allSettled(savedRequests);
      /** @type {string | null} */
      let oldSaved = null;
      const done = await moveLibrary(to, { move, choose: async (folder) => { oldSaved = await chooseStorage(folder); } });
      let savedMove = null;
      if (oldSaved) {
        pages.folderUrl({ id: SAVED_ORIGIN_ID, path: savedRoot() });
        let recycled = false;
        try {
          await refreshLibraryReferences('saved');
          await moveToTrash(oldSaved);
          recycled = true;
        } catch { /* Keep the previous copy when references or the trash could not be updated. */ }
        savedMove = { recycled, from: oldSaved };
      }
      return { ...done, savedMove, locations: locations() };
    })();
    movingStorage = change;
    try { return await change; }
    finally { movingStorage = null; }
  }

  /** @param {Req} req @param {Res} res */
  async function route(req, res) {
    const url = new URL(req.url ?? '/', origin);
    const path = url.pathname;

    /* which Studio this is: the CLI replaces an older one, and finds its own home's when run.json is gone. Asked
       without the key, so it says nothing of the machine: its home only as a digest (homeTag), no process id */
    /* `app`: the desktop app's Studio, which updates with the app (`openfilm update` says so instead) */
    if (path === '/api/health') return json(res, 200, { product: 'openfilm-studio', version: VERSION, home: homeTag(), filmOrigin, ...(stays ? { app: true } : {}) });
    /* a browser signs in with the key it was given: Studio's (the person's), or the agents' (a browser an agent opened
       Studio in, which has all but the person's say) */
    const signIn = (/** @type {string} */ k) => [`${COOKIE}=${k}; Path=/; HttpOnly; SameSite=Strict`, `${FRAMED}=${k}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned`];
    const given = url.searchParams.get('key');
    const signingIn = sameKey(given) || matches(given, agentKey) ? /** @type {string} */ (given) : null;
    /** A page's address with the key in it (the address bar is what a person copies). */
    const keyed = (/** @type {string} */ to, /** @type {string} */ k) => {
      const at = new URL(to, origin);
      at.searchParams.set('key', k);
      return at.pathname + at.search;
    };
    /* Opened as localhost or [::1] (ownHost lets both in): go to Studio's own address, which its cookie, its writes'
       Origin and its film origin's CORS are all of. A key the caller showed travels along; one it did not is not added. */
    const canonical = new URL(origin);
    if (!path.startsWith('/api/') && String(req.headers.host ?? '').toLowerCase() !== canonical.host.toLowerCase() && ownHost(req, Number(canonical.port || 80))) {
      const here = `${path}${url.search}`;
      const cookie = cookieKey(req);
      const shown = signingIn ?? (sameKey(cookie) || matches(cookie, agentKey) ? cookie : null);
      const to = shown ? `${origin}${keyed(here, shown)}` : `${origin}${here}`;
      res.writeHead(302, { location: to, 'referrer-policy': 'no-referrer' });
      return res.end();
    }
    if (path === '/open') {
      if (!signingIn) throw new HttpError(403, 'this link is from another Studio launch; use the one `openfilm open` printed');
      const to = url.searchParams.get('to') ?? '/';
      res.writeHead(302, { location: keyed(/^\/(?!\/)[^\s\\]*$/.test(to) ? to : '/', signingIn), 'set-cookie': signIn(signingIn), 'referrer-policy': 'no-referrer' });
      return res.end();
    }
    if (!path.startsWith('/api/')) {
      if (path.startsWith('/assets/')) return sendEditor(res, editorDir, path);
      /* a page with the key in its address signs this browser in; one signed in without it gets it in its address */
      if (signingIn) return sendEditor(res, editorDir, path, { 'set-cookie': signIn(signingIn) });
      const session = cookieKey(req);
      if (session) {
        res.writeHead(302, { location: keyed(path + url.search, session), 'referrer-policy': 'no-referrer' });
        return res.end();
      }
      return sendEditor(res, editorDir, path);
    }

    const caller = authorize(req);
    const parts = path.slice('/api/'.length).split('/').map(decodeURIComponent);
    /* the person's own say is theirs: an agent uses the services they connected, and does not change them */
    if (caller === 'agent' && personsSay(parts, req.method ?? 'GET')) {
      throw new HttpError(403, "only the person changes this, in Studio's Settings: tell them what to change and why");
    }
    const [head, group, action] = parts;
    const usesSaved = head === 'saved' || (head === 'locations' && group === 'saved' && req.method === 'POST')
      || (head === 'library' && group === 'packs' && action === 'save')
      || (head === 'projects' && (action === 'saved' || (action === 'library' && parts[3] === 'add')
        || (group && !action && req.method === 'GET' && (movingStorage || chosenFolder('savedFolder')))));
    if (!usesSaved) return apiRoute(req, res, url, parts, caller);
    while (movingStorage) await movingStorage.catch(() => {});
    const run = apiRoute(req, res, url, parts, caller);
    savedRequests.add(run);
    try { return await run; } finally { savedRequests.delete(run); }
  }

  /** @param {Req} req @param {Res} res @param {URL} url @param {string[]} parts @param {'person' | 'agent'} caller */
  async function apiRoute(req, res, url, parts, caller) {
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
      /* an agent is given an address with its own key; a browser Studio opens itself, Studio's */
      const addressWith = (/** @type {string} */ k) => `${origin}/open?key=${k}&to=${encodeURIComponent(to)}`;
      const address = addressWith(String(key));
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
      return json(res, 200, { project, url: caller === 'agent' ? addressWith(agentKey) : address, pages: open });
    }

    /* this Studio's version, and the latest on npm (Settings → General; `?check=1` asks npm now) */
    if (parts[0] === 'version' && parts.length === 1 && req.method === 'GET') {
      const now = url.searchParams.get('check') === '1';
      const { latest, checkedAt } = await npmOpenfilm({ force: now, waitMs: 4000 });
      return json(res, 200, { version: VERSION, latest, newer: Boolean(latest && olderThanThis(VERSION, latest)), checkedAt, checking: !process.env.OPENFILM_NO_UPDATE_CHECK && !FROM_SOURCE, source: FROM_SOURCE,
        ...(updating ? { update: updating } : {}) });
    }
    /* Settings → Developer's diagnostic report: `openfilm doctor` (src/doctor.mjs), as this Studio sees the computer */
    if (parts[0] === 'doctor' && parts.length === 1 && req.method === 'GET') {
      const report = await doctor({ studio: { origin, version: VERSION, ...(stays ? { app: true } : {}) } });
      return json(res, 200, { ok: report.ok, text: report.text });
    }
    /* Settings → Developer: the problems of the last two weeks (src/problems.mjs), newest first */
    if (parts[0] === 'diagnostics' && parts[1] === 'problems' && parts.length === 2 && req.method === 'GET') {
      return json(res, 200, { problems: recentProblems().reverse() });
    }
    /* Settings → Developer's diagnostic file (diagnostics.mjs): the report the page made, and the rest, as a zip in the
       exports folder, shown in the file manager */
    if (parts[0] === 'diagnostics' && parts[1] === 'export' && parts.length === 2 && req.method === 'POST') {
      const { report, conversations } = /** @type {{ report?: unknown, conversations?: unknown }} */ ((await readJson(req).catch(() => null)) ?? {});
      const text = typeof report === 'string' && report.trim() ? report
        : (await doctor({ studio: { origin, version: VERSION, ...(stays ? { app: true } : {}) } })).text;
      const made = await exportDiagnostics({ report: text, conversations: conversations === true });
      reveal(made.path);
      return json(res, 200, made);
    }
    /* the top bar's Update (Studio run with npm, not the app's nor a checkout): the newest openfilm run in the
       background as `openfilm update` (client.mjs updateOpenfilm), which starts Studio again on it; the pages come back
       on the new version and reload. Not while an export runs or media is made. `/api/version` says how it goes */
    if (parts[0] === 'update' && parts.length === 1 && req.method === 'POST') {
      if (stays || FROM_SOURCE) return json(res, 409, { error: 'this Studio does not update itself', code: stays ? 'app' : 'source' });
      if (exports.busy()) return json(res, 409, { error: 'an export is running', code: 'exporting' });
      if (making) return json(res, 409, { error: 'media is being made', code: 'making' });
      if (updating?.status === 'updating') return json(res, 202, { update: updating });
      const { latest } = await npmOpenfilm({ waitMs: 4000 });
      if (!latest || !olderThanThis(VERSION, latest)) return json(res, 409, { error: 'this is the newest openfilm', code: 'newest' });
      updating = runUpdate(latest, (next) => { updating = next; });
      return json(res, 202, { update: updating });
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
    /* ── own keys and who makes each kind of media (Settings → Services): never a key back; see providers/index.mjs ── */
    if (parts[0] === 'providers') return providersRoute(req, res, parts.slice(1), { openBrowser });
    if (parts[0] === 'voices') return voicesRoute(req, res, parts.slice(1));
    /* the models that run on this computer (Settings → Services → Local services; local-models.mjs) */
    if (parts[0] === 'local-models') return localModelsRoute(req, res, parts.slice(1));
    /* what the person changed in a project while an agent worked, kept over its writes: the note for the agent named
       `agent`, which its `openfilm` command prints, answered at once ({ id, line }, line null when nothing); it counts
       as told once the command says it printed it (POST kept/said { id }; person-edits.mjs) */
    if (parts[0] === 'kept' && parts.length === 1 && req.method === 'GET') {
      const folder = url.searchParams.get('folder');
      if (!folder || !isAbsolute(folder)) return json(res, 200, { line: null });
      /* as projects are named: by the folder's real path */
      let root = resolve(folder);
      try { root = realpathSync(root); } catch { /* as given */ }
      return json(res, 200, personEdits.noteFor(root, (url.searchParams.get('agent') || 'pid:unknown').slice(0, 200)) ?? { line: null });
    }
    if (parts[0] === 'kept' && parts[1] === 'said' && parts.length === 2 && req.method === 'POST') {
      const { id } = /** @type {{ id?: unknown }} */ (await readJson(req));
      return json(res, 200, { ok: typeof id === 'string' && personEdits.noteSaid(id) });
    }
    /* ── `openfilm get`: media from a provider, landed in the project; spending is asked here first (see get.mjs) ── */
    if (parts[0] === 'get') {
      making += req.method === 'POST' ? 1 : 0;
      try { return await getRoute(req, res, parts.slice(1), asks, (root) => watchers.emit(root, { type: 'files', made: true })); } finally { making -= req.method === 'POST' ? 1 : 0; }
    }

    /* ── `openfilm canvas`: an agent's steps on a project's canvas, shown on the board at once (canvas.mjs) ── */
    if (parts[0] === 'canvas' && parts.length === 1) return agentCanvasRoute(req, res, (root) => watchers.emit(root, { type: 'canvas' }));
    /* the person's canvas templates, the same for every project (canvas-templates.mjs) */
    if (parts[0] === 'canvas-templates') return templatesRoute(req, res, parts.slice(1));
    /* the person's characters, the same for every project (canvas-characters.mjs) */
    if (parts[0] === 'canvas-characters') return charactersRoute(req, res, parts.slice(1));

    /* the system's folder dialog, opened here for a page in a browser (folder-picker.mjs): { path } (null: cancelled);
       501 when this system has none Studio can open */
    if (parts[0] === 'pick-folder' && parts.length === 1 && req.method === 'POST') {
      const { title, at } = /** @type {{ title?: unknown, at?: unknown }} */ (await readJson(req).catch(() => ({})) ?? {});
      try {
        const path = await pickFolder({ title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : 'Choose a folder', at: typeof at === 'string' ? at : null });
        return json(res, 200, { path });
      } catch (e) {
        throw new HttpError(501, /** @type {Error} */ (e).message);
      }
    }
    /* Saved, the person's own library for every project (saved.mjs): its files and folders as a project's media are
       (files.mjs), by their `saved/` paths; a file's bytes, a bundle's picture, and what Studio works out from a file */
    /* OpenFilm's recycle bin (recycle-bin.mjs): what is in it, put back (a project is listed again), deleted for good,
       emptied */
    if (parts[0] === 'recycle') {
      if (parts.length === 1 && req.method === 'GET') return json(res, 200, { items: await binList() });
      const { ids } = /** @type {{ ids?: unknown }} */ (req.method === 'POST' ? await readJson(req) ?? {} : {});
      if (parts[1] === 'restore' && req.method === 'POST') {
        const back = await binRestore(ids);
        for (const item of back) if (item.kind === 'project') await openProject(item.path).catch(() => null);
        return json(res, 200, { restored: back });
      }
      if (parts[1] === 'delete' && req.method === 'POST') { await binDelete(ids); return json(res, 200, {}); }
      if (parts[1] === 'empty' && req.method === 'POST') { await binDelete(); return json(res, 200, {}); }
    }
    if (parts[0] === 'saved') {
      const sub = parts.slice(1).join('/');
      const lib = await savedLibrary();
      const rel = (/** @type {unknown} */ path) => { try { return libraryRel(path); } catch (e) { throw new HttpError(400, /** @type {Error} */ (e).message); } };
      const at = url.searchParams.get('path') ?? '';
      if (sub === 'catalog' && req.method === 'GET') return json(res, 200, await assetCatalog());
      /* the places at the library's top (folders made here, folders linked from elsewhere) and the person's shelf of
         them (library-places.mjs); `name`: the person's word for the first place, made the first time */
      if (sub === 'places' && req.method === 'GET') {
        const shelf = await ensureShelf(url.searchParams.get('name') ?? undefined, moveAssetCatalog);
        const top = await catalogListing('saved');
        const places = top.folders.filter((path) => path.split('/').length === 2).map((path) => ({ path, ...(top.links[path] ? { link: top.links[path] } : {}) }));
        return json(res, 200, { places, shelf, hidden: readHidden() });
      }
      if (sub === 'shelf' && req.method === 'PUT') {
        const { shelf, hidden } = /** @type {{ shelf?: unknown, hidden?: unknown }} */ (await readJson(req) ?? {});
        try { return json(res, 200, { shelf: writeShelf(shelf, hidden), hidden: readHidden() }); } catch (e) { throw new HttpError(400, /** @type {Error} */ (e).message); }
      }
      /* a thing of OpenFilm's library or a Community pack copied into one of the person's folders (dropped on it in
         the drawer): a file as itself, a page with what it loads as the folder it is kept in. { path } */
      if (sub === 'files/from-library' && req.method === 'POST') {
        const { from, into, name } = /** @type {{ from?: unknown, into?: unknown, name?: unknown }} */ (await readJson(req) ?? {});
        return json(res, 200, { path: libraryPath(await savedCall(() => copyFromLibrary(from, rel(into), name))) });
      }
      /* the person's own files starred: their places (GET); one starred or no longer, { path, on } (PUT), answered with
         the favorites and those places */
      if (sub === 'star' && req.method === 'GET') return json(res, 200, { paths: await starredPaths(libraryFavorites()) });
      if (sub === 'star' && req.method === 'PUT') {
        const { path: starred, on } = /** @type {{ path?: unknown, on?: unknown }} */ (await readJson(req) ?? {});
        const key = await savedStarKey(starred);
        /* the favorites as they are now (after the wait), the star put in or taken out */
        const now = libraryFavorites();
        const ids = setLibraryFavorites(on !== false ? [...new Set([...now, key])] : now.filter((id) => id !== key));
        return json(res, 200, { ids, paths: await starredPaths(ids) });
      }
      if (sub === 'usage' && req.method === 'GET') return json(res, 200, await assetUsage(at));
      if (sub === 'relink' && req.method === 'POST') {
        const { path: linked, to } = await readJson(req) ?? {};
        if (typeof to !== 'string') throw new HttpError(400, 'Choose the new source folder.');
        await relink(lib, rel(linked), to);
        await registerLibraryLinks([libraryPath(rel(linked))]);
        await refreshLibraryReferences(libraryPath(rel(linked)));
        return json(res, 200, {});
      }
      if (sub === 'files/transfer' && req.method === 'POST') return json(res, 200, await transferLibraryEntries(await readJson(req)));
      if (sub === 'files') {
        /* `folder`: the library as the film's origin serves it, so a saved page plays in the media pane's viewer as a
           project's does */
        /* `view=starred`: the person's own files starred, flat, wherever they are */
        if (req.method === 'GET' && url.searchParams.get('view') === 'starred') return json(res, 200, { ...await starredListing(libraryFavorites()), folder: pages.folderUrl({ id: SAVED_ORIGIN_ID, path: lib }) });
        if (req.method === 'GET') return json(res, 200, { ...await catalogListing(url.searchParams.get('at') ?? '', url.searchParams.get('view') ?? '', url.searchParams.get('q') ?? ''), folder: pages.folderUrl({ id: SAVED_ORIGIN_ID, path: lib }) });
        if (req.method === 'PUT') return json(res, 200, { path: libraryPath((await importFile(lib, rel(at), req)).path) });
        if (req.method === 'PATCH') {
          const { from, to } = /** @type {{ from?: unknown, to?: unknown }} */ (await readJson(req) ?? {});
          const path = libraryPath((await moveFile(lib, rel(from), rel(to))).path);
          await moveAssetCatalog(libraryPath(rel(from)), path);
          shelfMoved(libraryPath(rel(from)), path);
          return json(res, 200, { path });
        }
        if (req.method === 'DELETE') { if (!rel(at)) throw new HttpError(403, 'The asset-library root cannot be deleted.'); await trashFile(lib, rel(at)); await forgetLibraryPath(libraryPath(rel(at))); shelfRemoved(libraryPath(rel(at))); return json(res, 200, {}); }
      }
      if (sub === 'folders' && req.method === 'POST') {
        const { path: folder } = /** @type {{ path?: unknown }} */ (await readJson(req) ?? {});
        const path = libraryPath(await makeFolder(lib, rel(folder)));
        await registerLibraryFolder(path);
        return json(res, 200, { path });
      }
      /* files or folders of this computer copied in, or (`mode: link`) linked where they are kept: the paths given,
         else the person's pick. { landed } */
      if (sub === 'files/bring' && req.method === 'POST') {
        const { into, paths, folder, title, mode } = /** @type {{ into?: unknown, paths?: unknown, folder?: unknown, title?: unknown, mode?: unknown }} */ (await readJson(req) ?? {});
        const ask = { title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : 'Choose', at: null };
        const picked = Array.isArray(paths) ? paths.map(String)
          : await (folder === true ? pickFolder(ask).then((p) => (p ? [p] : [])) : pickFiles(ask)).catch((e) => { throw new HttpError(501, String(e?.message ?? e)); });
        const landed = (await bringIn(lib, rel(into ?? 'saved'), picked, mode === 'link' ? 'link' : mode === 'auto' ? 'auto' : 'copy', { anywhere: true,
          makeLink: (source, destination, kind) => symlink(source, destination, process.platform === 'win32' && kind === 'dir' ? 'junction' : kind),
        })).map(libraryPath);
        await registerLibraryLinks(landed);
        return json(res, 200, { landed });
      }
      if (sub === 'reveal' && req.method === 'POST') {
        const { path: shown, original } = /** @type {{ path?: unknown, original?: boolean }} */ (await readJson(req) ?? {});
        const where = rel(shown ?? 'saved');
        if (where) reveal(original ? realpathSync.native(readable(lib, where)) : inside(lib, where)); else openFile(lib);
        return json(res, 200, {});
      }
      if (sub === 'file' && req.method === 'GET') return sendMedia(req, res, readable(lib, rel(at)));
      if (sub === 'playback' && (req.method === 'GET' || req.method === 'POST')) return sendPlayback(req, res, lib, rel(at), url);
      if (sub === 'poster' && req.method === 'GET') return sendMedia(req, res, await savedCall(() => bundlePoster(at)));
      if (sub === 'media' && req.method === 'GET') {
        const what = url.searchParams.get('what');
        const file = rel(at);
        if (what === 'probe') return json(res, 200, isPage(file) ? {} : await probe(lib, file));
        if (what === 'wave') return json(res, 200, await waveform(lib, file));
        const jpeg = what === 'poster' && !isPage(file) ? await poster(lib, file)
          : what === 'frame' && !isPage(file) ? await frame(lib, file, Number(url.searchParams.get('ms')), Number(url.searchParams.get('w')))
          : null;
        if (!jpeg) throw new HttpError(400, 'what: probe, poster, frame or wave, of a media file');
        res.writeHead(200, { 'content-type': pictureType(jpeg), 'cache-control': 'private, max-age=86400', 'content-length': jpeg.length });
        return res.end(jpeg);
      }
    }
    /* OpenFilm's library (library.mjs): what is in it, its voices, its files (a poster, a preview, a page, a sound, a waveform, a voice's sample), and
       the things the person starred */
    if (parts[0] === 'library') {
      if (parts.length === 1 && req.method === 'GET') {
        await refreshCommunity();
        return json(res, 200, libraryIndex());
      }
      if (parts[1] === 'voices' && parts.length === 2 && req.method === 'GET') return json(res, 200, withPairs(libraryVoices()));
      if (parts[1] === 'file' && parts.length === 2 && req.method === 'GET') {
        /* a Community sound or piece of music heard before it is here: passed on as it arrives */
        if (await streamLibrary(url.searchParams.get('path'), res)) return undefined;
        return sendMedia(req, res, await libraryFileFetched(url.searchParams.get('path')), { check: true });
      }
      /* which of these things still need fetching before they go in (a sound, an emoji, a template's music): { ids } */
      if (parts[1] === 'missing' && parts.length === 2 && req.method === 'POST') return json(res, 200, { ids: notHere((/** @type {{ ids?: unknown }} */ (await readJson(req) ?? {})).ids) });
      /* an asset or a template example fetched now: { ok } */
      if (parts[1] === 'fetch' && parts.length === 2 && req.method === 'POST') return json(res, 200, { ok: await fetchItem((/** @type {{ id?: unknown }} */ (await readJson(req) ?? {})).id) });
      /* a page of it, as a page: what a click tries over the viewer's picture */
      if (parts[1] === 'pages' && parts.length > 2 && req.method === 'GET') {
        /* a page of it, as a page, and what it loads beside it by its own place (its fonts, its pictures): what a click
           tries over the viewer's picture */
        const file = await libraryFileFetched(parts.slice(2).join('/'));
        if (!file) throw new HttpError(404, 'no such file');
        const type = /** @type {Record<string, string>} */ ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf' })[extname(file).toLowerCase()];
        if (!type) return sendMedia(req, res, file, { check: true });
        res.writeHead(200, { 'content-type': type, 'cache-control': 'private, no-cache' });
        return res.end(readFileSync(file));
      }
      /* the community's packs and things the person added to the library (OpenFilm's own are always in it): { ids } */
      if (parts[1] === 'added' && parts.length === 2) {
        if (req.method === 'GET') { await refreshCommunity(); return json(res, 200, { ids: libraryAdded() }); }
        if (req.method === 'PUT') { await refreshCommunity(); return json(res, 200, { ids: setLibraryAdded((/** @type {{ ids?: unknown }} */ (await readJson(req) ?? {})).ids) }); }
      }
      /* a pack of the Community's media kept as a folder of the person's own, and it is added: { path } */
      if (parts[1] === 'packs' && parts[2] === 'save' && parts.length === 3 && req.method === 'POST') {
        const { pack, lang } = /** @type {{ pack?: unknown, lang?: unknown }} */ (await readJson(req) ?? {});
        await refreshCommunity();
        const path = libraryPath(await savedCall(() => savePack(pack, lang)));
        setLibraryAdded([...libraryAdded(), pack]);
        return json(res, 200, { path });
      }
      if (parts[1] === 'favorites' && parts.length === 2) {
        if (req.method === 'GET') return json(res, 200, { ids: libraryFavorites() });
        if (req.method === 'PUT') return json(res, 200, { ids: setLibraryFavorites((/** @type {{ ids?: unknown }} */ (await readJson(req) ?? {})).ids) });
      }
    }
    /* Studio's own preferences, the same for every project (prefs.mjs) */
    if (parts[0] === 'prefs' && parts.length === 1) {
      if (req.method === 'GET') return json(res, 200, readPrefs());
      if (req.method === 'PATCH') {
        const patch = /** @type {Record<string, unknown>} */ (await readJson(req) ?? {});
        if (Object.hasOwn(patch, 'projectsFolder')) {
          await changeStorage(patch.projectsFolder);
          delete patch.projectsFolder;
        }
        return json(res, 200, writePrefs(patch));
      }
    }
    /* where new projects go (src/locations.mjs): the folder, its default, and its disk's free space; a POST opens it
       in the system's file manager */
    if (parts[0] === 'locations' && parts.length === 1 && req.method === 'GET') return json(res, 200, locations());
    /* the room every project takes, and what of it can be cleared (storage.mjs); a POST clears one project's cache
       (`id`) or every project's, and says how much came back. What a render reads back is left in a project where
       an export or an agent is at work */
    if (parts[0] === 'storage' && parts.length === 1 && req.method === 'GET') return json(res, 200, await storage());
    if (parts[0] === 'storage' && parts[1] === 'clear' && parts.length === 2 && req.method === 'POST') {
      const { id } = /** @type {{ id?: unknown }} */ (await readJson(req));
      const listed = (await listProjects()).filter((p) => !p.missing && (id == null || p.id === id));
      let freed = 0;
      for (const p of listed) {
        const busy = agentIn(p.path) || exports.list(p.id).some((job) => job.status === 'waiting' || job.status === 'running');
        freed += await clearProjectCache(p.path, { busy });
      }
      return json(res, 200, { freed, ...await storage({ fresh: true }) });
    }
    /* OpenFilm's plugins (src/plugins.mjs): each with whether it is on; one turned on or off (PUT plugins/:id { on }),
       answered with them all. 409 for one not made yet */
    if (parts[0] === 'plugins' && parts.length === 1 && req.method === 'GET') return json(res, 200, { plugins: pluginsShown(), order: workbenchOrder() });
    /* one of OpenFilm's own plugins' app icon (icon.svg, .png or .webp in its folder: src/skills.mjs appIconIn) */
    if (parts[0] === 'plugin-icon' && parts.length === 2 && req.method === 'GET') {
      const id = decodeURIComponent(parts[1]);
      const folder = /^[a-z][a-z0-9-]{0,31}$/.test(id) ? join(pluginsDir(), id) : null;
      const file = folder ? appIconIn(folder) : undefined;
      return sendMedia(req, res, folder && file ? join(folder, file) : null, { keep: true });
    }
    /* one of OpenFilm's own plugins' recording at work, or its poster: only the files its showcase names (src/plugins.mjs) */
    if (parts[0] === 'plugin-preview' && parts.length === 3 && req.method === 'GET') {
      const id = decodeURIComponent(parts[1]), name = decodeURIComponent(parts[2]);
      const video = /^[a-z][a-z0-9-]{0,31}$/.test(id) ? pluginsShown().find((p) => p.id === id)?.showcase?.video : undefined;
      return sendMedia(req, res, video && (name === video.src || name === video.poster) ? join(pluginsDir(), id, name) : null, { keep: true });
    }
    /* the order the person put the workbenches in (PUT plugin-order { order: ids }), answered with it as kept */
    if (parts[0] === 'plugin-order' && parts.length === 1 && req.method === 'PUT') {
      const { order } = /** @type {{ order?: unknown }} */ (await readJson(req) ?? {});
      try { setWorkbenchOrder(order); } catch (e) { throw new HttpError(400, /** @type {Error} */ (e).message); }
      return json(res, 200, { order: workbenchOrder() });
    }
    /* an own plugin's routes, `plugins/<id>/…`, from its server.mjs, while it is on (plugin-servers.mjs) */
    if (parts[0] === 'plugins' && parts.length > 2) return pluginServers.route(req, res, parts[1], parts.slice(2), url);
    if (parts[0] === 'plugins' && parts.length === 2 && req.method === 'PUT') {
      const { on } = /** @type {{ on?: unknown }} */ (await readJson(req) ?? {});
      /* on: true or false; null: removed (one that comes with OpenFilm is only turned off) */
      if (typeof on !== 'boolean' && on !== null) throw new HttpError(400, 'on: true, false or null');
      try { if (on === null) removePlugin(parts[1]); else setPluginOn(parts[1], on); } catch (e) { throw new HttpError(/there is no plugin/i.test(/** @type {Error} */ (e).message) ? 404 : 409, /** @type {Error} */ (e).message); }
      return json(res, 200, { plugins: pluginsShown(), order: workbenchOrder() });
    }
    /* the person's media in numbers (media-index.mjs): places, files, the room they take and the room copies take */
    if (parts[0] === 'media-index' && parts.length === 1 && req.method === 'GET') return json(res, 200, { ...await mediaSummary(), scanning: mediaIndex.busy() });
    if (parts[0] === 'locations' && parts.length === 2 && (parts[1] === 'projects' || parts[1] === 'saved')) {
      if (req.method === 'PUT') {
        if (parts[1] === 'saved') return json(res, 200, await changeStorage(undefined));
        const { path: asked, move } = /** @type {{ path?: unknown, move?: unknown }} */ (await readJson(req) ?? {});
        return json(res, 200, await changeStorage(asked ?? null, move === true));
      }
      if (req.method === 'POST') {
        const folder = parts[1] === 'saved' ? await savedLibrary() : locations().projects.path;
        if (parts[1] === 'projects') mkdirSync(folder, { recursive: true });
        openFile(folder);
        return json(res, 200, { ok: true });
      }
    }
    /* the system's file dialog (folder-picker.mjs pickFiles), several at once: { paths } (none: cancelled); 501 when
       this system has none */
    if (parts[0] === 'pick-files' && parts.length === 1 && req.method === 'POST') {
      const { title } = /** @type {{ title?: unknown }} */ (await readJson(req).catch(() => ({})) ?? {});
      try {
        return json(res, 200, { paths: await pickFiles({ title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : 'Choose files', at: null }) });
      } catch (e) {
        throw new HttpError(501, /** @type {Error} */ (e).message);
      }
    }
    /* the web editor's folder browser (browse.mjs): `path`'s folders, only under the home folder, and where to start */
    if (parts[0] === 'browse' && parts.length === 1 && req.method === 'GET') {
      const listing = await browseFolder(url.searchParams.get('path'));
      const places = await browsePlaces({ library: libraryRoot(), recent: (await listProjects()).filter((p) => !p.missing).map((p) => p.path) });
      return json(res, 200, { ...listing, ...places });
    }
    /* the example films (examples.mjs): none when the index cannot be read */
    if (parts[0] === 'examples' && parts.length === 1 && req.method === 'GET') return json(res, 200, { examples: await listExamples() });
    /* the Community's news that is now (examples.mjs listNews): the projects window's card */
    if (parts[0] === 'news' && parts.length === 1 && req.method === 'GET') return json(res, 200, { news: await listNews() });
    /* a poster or preview beside an index read from this computer (examples.mjs exampleFile) */
    if (parts[0] === 'examples' && parts[1] === 'file' && parts.length > 2 && req.method === 'GET') {
      return sendMedia(req, res, exampleFile(parts.slice(2).map(decodeURIComponent).join('/')), { keep: true });
    }
    /* an example's folder on this computer, to point an agent at (examples.mjs exampleFolder) */
    if (parts[0] === 'examples' && parts.length === 3 && parts[2] === 'folder' && req.method === 'POST') {
      return json(res, 200, { folder: await exampleFolderHere(decodeURIComponent(parts[1])) });
    }
    /* an example's canvas, when it has one (null: none), and the files it shows: looked at, not changed */
    if (parts[0] === 'examples' && parts.length === 3 && parts[2] === 'canvas' && req.method === 'GET') {
      const folder = await exampleFolderHere(decodeURIComponent(parts[1]));
      return json(res, 200, { canvas: existsSync(join(folder, CANVAS_FILE)) ? await readCanvas(folder) : null });
    }
    if (parts[0] === 'examples' && parts[2] === 'files' && parts.length > 3 && req.method === 'GET') {
      const folder = await exampleFolderHere(decodeURIComponent(parts[1]));
      return sendMedia(req, res, inside(folder, parts.slice(3).map(decodeURIComponent).join('/')), { keep: true });
    }
    /* the skills a project can be made with (../../src/skills.mjs): OpenFilm's own first (`core`, which can only be
       turned off), then the project's, the person's, those installed, then Discover's not installed (skill-catalog.mjs,
       `installed: false`). Each is told by its uid (owner/name) here and in every route below, so two of the same name
       are both there; `as` is the name agents are given it by. An installed one says when Discover has a newer commit
       of it (`update`) or no longer has it (`retired`); `catalog`: when Discover's index was last read */
    if (parts[0] === 'skills' && parts.length === 1 && req.method === 'GET') {
      await seedCatalog().catch(() => null);
      const id = url.searchParams.get('project');
      const project = id ? (await listProjects()).find((p) => p.id === id && !p.missing) : null;
      const skills = listSkills({ project: project?.path ?? null });
      const catalog = readCatalog();
      const standing = installedStanding(catalog);
      /* listed by another community index the person added, not OpenFilm's: its address (skill-catalog.mjs communitySources) */
      const fromOther = entrySources(catalog);
      const had = new Set(skills.map((k) => k.uid));
      const offered = catalogSkills(catalog).filter((k) => !had.has(k.uid));
      const origins = skillOrigins();
      const off = new Set(skillsOff());
      const given = new Set(ownSkills().skills.map((k) => k.name));
      const agentsCall = new Map(offeredSkills({ project: project?.path ?? null }).named.map((k) => [k.uid, k.as]));
      const media = (/** @type {string} */ uid, /** @type {'cover' | 'preview' | 'icon'} */ which) => `/api/skills/${encodeURIComponent(uid)}/${which}${id ? `?project=${encodeURIComponent(id)}` : ''}`;
      /* a project's own the person has not allowed in it (src/skills.mjs projectSkillAllowed): listed, waiting, with
         nothing of it shown or run (no page, element, program, tab or commands) until it is allowed */
      const waits = (/** @type {typeof skills[number]} */ k) => k.source === 'project' && !projectSkillAllowed(k, project?.path ?? null);
      /* one OpenFilm withdrew (its index's `revoked`): nothing of it shown or run, its program stopped, and why said */
      const revoked = revokedNow();
      const withheld = (/** @type {typeof skills[number]} */ k) => {
        const withdrawn = revocationOf(k, revoked);
        if (withdrawn) pluginPrograms.stop(k.uid);
        return withdrawn || waits(k)
          ? { ...k, page: undefined, element: undefined, program: undefined, tab: undefined, blocks: undefined, commands: undefined,
            ...(withdrawn ? { revoked: { reason: withdrawn.reason, ...(withdrawn.note ? { note: withdrawn.note } : {}), ...(withdrawn.advisory ? { advisory: withdrawn.advisory } : {}) } } : { waits: true }) }
          : k;
      };
      const all = [...coreSkills().map((k) => ({ ...k, core: true, installed: true })), ...skills.map((k) => ({ ...withheld(k), core: false, installed: true })),
        ...offered.map((k) => ({ ...k, core: false, installed: false }))];
      return json(res, 200, {
        catalog: catalog ? { read: catalog.read } : null,
        skills: all.map((k) => ({
          ...(k.core ? { core: true } : {}), uid: k.uid, name: k.name, description: k.description, source: k.source, scripts: k.scripts.length,
          ...(agentsCall.has(k.uid) ? { as: agentsCall.get(k.uid) } : {}),
          ...(k.shown ? { shown: k.shown } : {}), ...(k.version ? { version: k.version } : {}), ...(k.kind ? { kind: k.kind } : {}),
          ...(k.order != null ? { order: k.order } : {}), ...(k.icon ? { icon: k.icon } : {}), ...(k.repository ? { repository: k.repository } : {}),
          /* how it is listed and rated for people (src/plugins.mjs profileOf) */
          ...(k.profile ? { profile: k.profile } : {}),
          ...(k.source === 'official' && fromOther.get(k.uid) ? { from: fromOther.get(k.uid) } : {}),
          /* the hosts its page may reach (src/skills.mjs networkOf), none but these */
          ...(k.network ? { network: k.network } : {}),
          /* what it needs beyond OpenFilm, the computers it runs on, and whether this one is not among them */
          ...(k.needs ? { needs: k.needs } : {}), ...(k.platforms ? { platforms: k.platforms, ...(k.platforms.includes(thisPlatform()) ? {} : { elsewhere: true }) } : {}),
          ...(k.cover ? { cover: `${media(k.uid, 'cover')}${id ? '&' : '?'}v=${encodeURIComponent(k.cover)}` } : {}), ...(k.preview ? { preview: media(k.uid, 'preview') } : {}),
          /* its app icon (src/skills.mjs appIconIn): none, the default for its kind */
          ...(k.appIcon ? { appIcon: `${media(k.uid, 'icon')}${id ? '&' : '?'}v=${encodeURIComponent(k.appIcon)}` } : {}),
          /* one with a surface (a page of its own, src/skills.mjs SKILL_PAGE) is a plugin: where its page is, on the
             plugins' origin (plugin-pages.mjs); listed for a project, where that project's files are for it; and
             whether the person lets it change them */
          /* a plugin's surface shown as a tab of the library instead of as a workbench (src/plugins.mjs tabOf) */
          ...(k.tab && k.installed && !k.core ? { tab: k.tab } : {}),
          /* the blocks its workbench is laid out in among the page's panels (src/plugin-blocks.mjs) */
          ...(k.blocks && k.installed && !k.core ? { blocks: k.blocks } : {}),
          /* the commands it brings (src/skills.mjs commandsIn), by name: `openfilm <its name> <command>` */
          ...(k.commands && k.installed && !k.core ? { commands: Object.keys(k.commands) } : {}),
          /* the program it brings (src/skills.mjs programIn) serves its surface itself, once started (`start` below),
             which the person lets it or not */
          ...(k.program && k.installed && !k.core ? { program: true, ...(pluginRuns(k, project ?? null) ? { runs: true } : {}) } : {}),
          /* the element it brings (src/skills.mjs elementIn) is put in the editor's own page: `inApp`, and once the
             person lets it run, where its module is (`element`, by the version of its file, so a changed one is
             loaded anew) and where the project's files are for it */
          ...(k.element && !k.program && k.installed && !k.core ? (() => {
            const runs = pluginRuns(k, project ?? null);
            if (!runs) return { inApp: true };
            const at = pluginPages.surface({ uid: k.uid, source: k.source, folder: k.folder, page: k.element, ...(k.network ? { network: k.network } : {}) }, project ?? null);
            let version = '';
            try { const stat = statSync(join(k.folder, k.element)); version = `${stat.size.toString(36)}-${Math.round(stat.mtimeMs).toString(36)}`; } catch { /* gone since it was listed */ }
            return { inApp: true, runs: true, element: `${at.page}?v=${version}`, ...(at.project ? { files: at.project } : {}) };
          })() : {}),
          ...(k.page && !k.program && !k.element && k.installed && !k.core ? (() => {
            const at = pluginPages.surface({ uid: k.uid, source: k.source, folder: k.folder, page: k.page, ...(k.network ? { network: k.network } : {}) }, project ?? null);
            return { surface: at.page, ...(at.project ? { files: at.project } : {}), ...(pluginWrites(k, project ?? null) ? { writes: true } : {}) };
          })() : {}),
          /* a project's own, not allowed in it yet; one OpenFilm withdrew, and why (`withheld` above) */
          ...('waits' in k && k.waits ? { waits: true } : {}),
          ...('revoked' in k && k.revoked ? { revoked: k.revoked } : {}),
          /* the person's own: where it came from (none kept: made where it is) */
          ...(k.source === 'mine' ? { origin: origins[basename(k.folder)] ?? { from: 'made' } } : {}),
          /* in Discover only, installed to be used; the person's own and a project's are theirs already */
          installed: k.installed,
          ...(k.installed && k.source === 'official' && !k.core ? standing.get(k.uid) ?? {} : {}),
          /* turned off: offered to no agent until it is turned on again */
          ...(k.installed && !k.core && keeps(off, k) ? { off: true } : {}),
          /* one of OpenFilm's own that goes with a plugin now off (src/plugins.mjs): off with it, and on again with it */
          /* one of OpenFilm's own that no plugin on brings or requires (src/skills.mjs ownSkills): given to no agent until
             one does; turning its plugin on (the plugin it goes with, when it has one) gives it again */
          ...(k.core && !given.has(k.name) ? { off: true, ...(pluginOfSkill(k.name) ? { plugin: pluginOfSkill(k.name) } : {}) } : {}),
        })),
      });
    }
    /* Discover's index read again (POST { fresh? }: unless read less than `fresh` ms ago), the skills it names fetched
       at their commits: → { catalog }, or 502 saying why, what was read before staying */
    if (parts[0] === 'skills' && parts.length === 2 && parts[1] === 'catalog' && req.method === 'POST') {
      const fresh = Number((await readJson(req).catch(() => ({})))?.fresh) || 0;
      try {
        const catalog = await readDiscover({ fresh });
        return json(res, 200, { catalog: { read: catalog.read, incomplete: catalog.incomplete?.length ?? 0 } });
      } catch (e) {
        throw new HttpError(502, `Discover could not be read now: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    /* a skill of the project shown (`?project=`), or the library's, by its uid; OpenFilm's own with `core` */
    const skillAt = async (/** @type {string} */ uid, { core = false } = {}) => {
      const id = url.searchParams.get('project');
      const project = id ? (await listProjects()).find((p) => p.id === id && !p.missing) : null;
      return [...(core ? coreSkills() : []), ...listSkills({ project: project?.path ?? null })].find((k) => k.uid === uid)
        ?? (core ? catalogSkills().find((k) => k.uid === uid) ?? null : null);
    };
    /* one of Discover's installed, at the commit it shows, or uninstalled to the trash (PUT { installed }); updated to
       Discover's commit (POST `update`), the old one to the trash */
    if (parts[0] === 'skills' && parts.length === 3 && parts[2] === 'installed' && req.method === 'PUT') {
      const installed = (await readJson(req))?.installed;
      if (typeof installed !== 'boolean') throw new HttpError(400, 'installed: true or false');
      const uid = decodeURIComponent(parts[1]);
      if (installed) {
        try { await installSkill(uid); } catch (e) { throw new HttpError(/** @type {any} */ (e).status ?? 500, e instanceof Error ? e.message : String(e)); }
        /* one more counted, for one OpenFilm's community lists (not another index's): its uid alone (community-stats.mjs) */
        if (!entrySources().has(uid)) countInstall(uid);
      } else if (!(await uninstallSkill(uid))) throw new HttpError(404, 'no such installed skill');
      return json(res, 200, { installed });
    }
    if (parts[0] === 'skills' && parts.length === 3 && parts[2] === 'update' && req.method === 'POST') {
      const uid = decodeURIComponent(parts[1]);
      if (!installedStanding().get(uid)?.update) throw new HttpError(404, 'no newer commit of that skill in Discover');
      const skill = await installSkill(uid);
      return json(res, 200, { version: skill.version ?? null });
    }
    /* one of the person's own skills, or a project's, moved to the trash (an official one is uninstalled instead) */
    if (parts[0] === 'skills' && parts.length === 2 && req.method === 'DELETE') {
      const skill = await skillAt(decodeURIComponent(parts[1]));
      if (!skill) throw new HttpError(404, 'no such skill');
      if (skill.source === 'official') throw new HttpError(400, 'An official skill is uninstalled, not removed.');
      if (skill.source === 'mine') await removeSkill(skill.uid);
      else await recycle(skill.folder, 'skill');
      return json(res, 200, {});
    }
    /* a plugin someone made (a skill with a surface) let change projects, or no longer (PUT { on }); one a project
       brings is let in that project (`?project=`) */
    if (parts[0] === 'skills' && parts.length === 3 && parts[2] === 'writes' && req.method === 'PUT') {
      const on = (await readJson(req))?.on;
      if (typeof on !== 'boolean') throw new HttpError(400, 'on: true or false');
      const skill = await skillAt(decodeURIComponent(parts[1]));
      if (!skill?.page) throw new HttpError(404, 'no such plugin');
      const id = url.searchParams.get('project');
      const project = id ? (await listProjects()).find((p) => p.id === id && !p.missing) ?? null : null;
      try { setPluginWrites(skill, project, on); } catch (e) { throw new HttpError(409, /** @type {Error} */ (e).message); }
      return json(res, 200, { writes: on });
    }
    /* a plugin with a program let run it on this computer, or no longer (PUT { on }), as `writes` is kept; no longer
       let, what runs of it is stopped */
    if (parts[0] === 'skills' && parts.length === 3 && parts[2] === 'runs' && req.method === 'PUT') {
      const on = (await readJson(req))?.on;
      if (typeof on !== 'boolean') throw new HttpError(400, 'on: true or false');
      const skill = await skillAt(decodeURIComponent(parts[1]));
      if (!skill?.program && !skill?.element) throw new HttpError(404, 'no such plugin');
      const id = url.searchParams.get('project');
      const project = id ? (await listProjects()).find((p) => p.id === id && !p.missing) ?? null : null;
      try { setPluginRuns(skill, project, on); } catch (e) { throw new HttpError(409, /** @type {Error} */ (e).message); }
      if (!on) pluginPrograms.stop(skill.uid);
      return json(res, 200, { runs: on });
    }
    /* a plugin's program for a project (POST, `?project=`): started when it is not running → { url }, what its surface
       shows. 403 until the person lets it run, 409 while the plugin is off, 502 (saying why) when it does not start */
    if (parts[0] === 'skills' && parts.length === 3 && parts[2] === 'start' && req.method === 'POST') {
      const skill = await skillAt(decodeURIComponent(parts[1]));
      const program = skill?.program;
      if (!skill || !program) throw new HttpError(404, 'no such plugin');
      const id = url.searchParams.get('project');
      const project = id ? (await listProjects()).find((p) => p.id === id && !p.missing) ?? null : null;
      if (!project) throw new HttpError(404, 'no such project');
      if (keeps(new Set(skillsOff()), skill)) throw new HttpError(409, 'This plugin is off.');
      if (revocationOf(skill)) throw new HttpError(409, 'OpenFilm withdrew this plugin: it does not run.');
      try {
        return json(res, 200, { url: await pluginPrograms.ensure({ uid: skill.uid, source: skill.source, folder: skill.folder, program }, { id: project.id, path: project.path }) });
      } catch (e) { throw new HttpError(/** @type {any} */ (e).status ?? 500, e instanceof Error ? e.message : String(e)); }
    }
    /* how many use each community item (community-stats.mjs): { stats: { uid: { installs } } }, none when unknown */
    if (parts[0] === 'community' && parts[1] === 'stats' && parts.length === 2 && req.method === 'GET') {
      return json(res, 200, { stats: await communityStats() });
    }
    /* the other community indexes the person added (GET: { sources }; PUT { sources }): read after OpenFilm's own, the
       next time Discover is read (skill-catalog.mjs communitySources) */
    if (parts[0] === 'community' && parts[1] === 'sources' && parts.length === 2 && (req.method === 'GET' || req.method === 'PUT')) {
      if (req.method === 'PUT') {
        const sources = (await readJson(req))?.sources;
        if (!Array.isArray(sources)) throw new HttpError(400, 'sources: a list of index addresses');
        try { setCommunitySources(sources); } catch (e) { throw new HttpError(400, /** @type {Error} */ (e).message); }
      }
      return json(res, 200, { sources: communitySources() });
    }
    /* one of the person's own, read as the community's review will (POST: src/publish-cli.mjs publishCheck); and, once it
       is in a repository of theirs, read there and compared, with its listing (POST `publish/verify` { repo }:
       community-publish.mjs) */
    if (parts[0] === 'skills' && (parts.length === 3 || (parts.length === 4 && parts[3] === 'verify')) && parts[2] === 'publish' && req.method === 'POST') {
      const skill = await skillAt(decodeURIComponent(parts[1]));
      if (!skill || skill.source !== 'mine') throw new HttpError(404, 'Only one of your own is published.');
      const check = publishCheck(skill.folder);
      if (!check) throw new HttpError(404, 'no such skill');
      if (parts.length === 3) return json(res, 200, check);
      const repo = (await readJson(req))?.repo;
      if (typeof repo !== 'string') throw new HttpError(400, 'repo: the address of your repository');
      try {
        return json(res, 200, await verifyPublished({ name: skill.name, folder: skill.folder, version: check.version, kind: check.kind }, repo));
      } catch (e) {
        /* its code, for the app's own words: the API not listing it is a repository missing or private here */
        const code = /** @type {any} */ (e).code === 'use-git' ? 'access' : /** @type {any} */ (e).code;
        throw new HttpError(/** @type {any} */ (e).status ?? 502, e instanceof Error ? e.message : String(e), typeof code === 'string' ? { code } : undefined);
      }
    }
    /* a skill as a person reviews it before letting it in: its SKILL.md whole and its files (GET ?project=) */
    if (parts[0] === 'skills' && parts.length === 3 && parts[2] === 'text' && req.method === 'GET') {
      const skill = await skillAt(decodeURIComponent(parts[1]));
      if (!skill) throw new HttpError(404, 'no such skill');
      let text = '';
      try { text = readFileSync(join(skill.folder, 'SKILL.md'), 'utf8').slice(0, 400_000); } catch { /* none */ }
      return json(res, 200, { text, ...skillFiles(skill.folder) });
    }
    /* a project's own skill allowed in that project, as its files are now, or no longer (PUT ?project= { on }):
       src/skills.mjs allowProjectSkill */
    if (parts[0] === 'skills' && parts.length === 3 && parts[2] === 'allow' && req.method === 'PUT') {
      const on = (await readJson(req))?.on;
      if (typeof on !== 'boolean') throw new HttpError(400, 'on: true or false');
      const id = url.searchParams.get('project');
      const project = id ? (await listProjects()).find((p) => p.id === id && !p.missing) ?? null : null;
      if (!project) throw new HttpError(404, 'no such project');
      const skill = listSkills({ project: project.path }).find((k) => k.uid === decodeURIComponent(parts[1]));
      if (!skill || skill.source !== 'project') throw new HttpError(404, 'no skill of this project by that name');
      allowProjectSkill(skill, project.path, on);
      if (!on) pluginPrograms.stop(skill.uid);
      return json(res, 200, { on });
    }
    /* a skill turned on or off, by uid, for every project (PUT { on }) */
    if (parts[0] === 'skills' && parts.length === 3 && parts[2] === 'on' && req.method === 'PUT') {
      const on = (await readJson(req))?.on;
      if (typeof on !== 'boolean') throw new HttpError(400, 'on: true or false');
      const skill = await skillAt(decodeURIComponent(parts[1]), { core: true });
      if (!skill) throw new HttpError(404, 'no such skill');
      /* one of OpenFilm's own has no switch of its own: it is on while its plugin is (src/plugins.mjs), so turning it
         turns the plugin; one that goes with no plugin (`film`, `media`) is given while a plugin on requires it */
      const core = coreSkills().some((k) => k.uid === skill.uid);
      const plugin = core ? pluginOfSkill(skill.name) : undefined;
      if (core && !plugin) throw new HttpError(409, 'This skill is given while a plugin that needs it is on: it has no switch of its own.');
      if (plugin) {
        try { setPluginOn(plugin, on); } catch (e) { throw new HttpError(409, /** @type {Error} */ (e).message); }
      } else {
        setSkillOn(skill.uid, on);
        if (!on) pluginPrograms.stop(skill.uid);
      }
      return json(res, 200, { on, ...(plugin ? { plugin } : {}) });
    }
    /* Only the person's own skill can be changed; a project override must not edit a hidden personal skill. */
    if (parts[0] === 'skills' && parts.length === 3 && parts[2] === 'cover' && (req.method === 'PUT' || req.method === 'DELETE')) {
      const skill = await skillAt(decodeURIComponent(parts[1]), { core: true });
      if (!skill) throw new HttpError(404, 'no such skill');
      if (skill.source !== 'mine') throw new HttpError(403, 'Only your own skills can have their cover changed.');
      const cover = req.method === 'DELETE' ? null : (await readJson(req, 7 << 20))?.cover;
      try {
        const updated = setSkillCover(skill.uid, cover);
        return json(res, 200, { cover: updated?.cover ? `/api/skills/${encodeURIComponent(skill.uid)}/cover?v=${encodeURIComponent(updated.cover)}` : null });
      } catch (e) { throw new HttpError(400, e instanceof Error ? e.message : String(e)); }
    }
    /* a skill's cover picture or preview video (its openfilm.json's `cover`, `preview`), or its app icon */
    if (parts[0] === 'skills' && parts.length === 3 && (parts[2] === 'cover' || parts[2] === 'preview' || parts[2] === 'icon') && req.method === 'GET') {
      const skill = await skillAt(decodeURIComponent(parts[1]), { core: true });
      const file = skill?.[parts[2] === 'icon' ? 'appIcon' : parts[2]];
      return sendMedia(req, res, skill && file ? join(skill.folder, file) : null, { keep: true });
    }

    if (parts[0] !== 'projects') throw new HttpError(404, 'no such API');
    if (parts.length === 1) {
      if (req.method === 'GET') return json(res, 200, { projects: (await listProjects()).map((p) => (agentIn(p.path) ? { ...p, working: true } : p)) });
      /* `create` false: only a folder holding a film opens (the editor asks before starting one in a folder) */
      if (req.method === 'POST') {
        const body = /** @type {{ path?: string, name?: string, create?: boolean, subtitleStyle?: unknown }} */ (await readJson(req));
        if (body.path) return json(res, 200, { project: await openProject(body.path, { create: body.create !== false }) });
        const project = await createProject(body.name);
        /* a new film starts in the subtitle look this person used last (Studio remembers it): written before its first
           version, so the project, its exports and Studio agree. An opened project keeps its own, or the default (#286). */
        if (body.subtitleStyle && typeof body.subtitleStyle === 'object') {
          await writeSubtitleStyle(project.path, body.subtitleStyle).catch(() => { /* the film still opens, in the default look */ });
        }
        return json(res, 200, { project });
      }
    }
    /* a film from GitHub (fetch-repo.mjs): POST { url } `projects/fetch` starts it → { job }; GET `projects/fetch/:id`
       says how it goes (`project` once it is opened); DELETE stops it */
    if (parts[1] === 'fetch') {
      if (parts.length === 2 && req.method === 'POST') return json(res, 200, { job: fetches.start(/** @type {{ url?: string }} */ (await readJson(req)).url) });
      if (parts.length === 3 && req.method === 'GET') return json(res, 200, { job: fetches.get(parts[2]) });
      if (parts.length === 3 && req.method === 'DELETE') { fetches.cancel(parts[2]); return json(res, 200, {}); }
    }
    /* the Projects list's folders (projects.mjs): GET / POST { name, parentId? } `projects/folders`, PATCH { name } /
       DELETE `projects/folders/:id` (with the folders inside it; answers the ids of the projects that were in them), PUT { folderId }
       `projects/:id/folder` (null: no folder) */
    if (parts[1] === 'folders' && parts.length <= 3) {
      if (parts.length === 2 && req.method === 'GET') return json(res, 200, { folders: await listFolders() });
      if (parts.length === 2 && req.method === 'POST') {
        const { name, parentId } = /** @type {{ name?: string, parentId?: string | null }} */ (await readJson(req));
        return json(res, 200, { folder: await createFolder(name, parentId) });
      }
      if (parts.length === 3 && req.method === 'PATCH') {
        const body = /** @type {{ name?: string, parentId?: string | null }} */ (await readJson(req));
        /* { parentId }: moved into another folder (null: the top level); else { name }: renamed */
        if (Object.hasOwn(body ?? {}, 'parentId')) return json(res, 200, { folder: await moveFolder(parts[2], body.parentId || null) });
        return json(res, 200, { folder: await renameFolder(parts[2], body.name) });
      }
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
    if (parts.length === 3 && parts[2] === 'duplicate' && req.method === 'POST') {
      const { name } = /** @type {{ name?: string }} */ (await readJson(req));
      return json(res, 200, { project: await duplicateProject(parts[1], name) });
    }
    const project = await projectById(parts[1]);
    const rest = parts.slice(2).join('/');
    /** A reference changes .film metadata, which the project file watcher skips. @template T @param {() => Promise<T>} work */
    const notifyReferences = async (work) => {
      const before = mediaReferences(project.path);
      try { return await work(); }
      finally { if (before !== mediaReferences(project.path)) watchers.emit(project.path, { type: 'files' }); }
    };
    /* Never enter or write into a project removed outside Studio, even if cache writers left its folder behind.
       `film`: false where film.html alone missing is no reason to refuse (the project itself, as its page opens) */
    const requireProject = ({ film = true } = {}) => {
      const missing = projectMissing(project.path);
      if (missing === 'folder' || (missing && film)) throw new HttpError(410, missing === 'film' ? 'This project’s film.html is missing.'
        : 'This project’s folder is not there any more: it was moved, renamed or deleted.', { code: missing === 'film' ? 'missing-film' : 'missing' });
    };
    /* film.html missing from a folder still there (an agent writing it again, or it lost): the project stays open, and
       says so; its version history is there to bring film.html back from; what writes the film waits for it */
    const filmOptional = (!rest && req.method === 'GET') || rest === 'opened' || parts[2] === 'history';
    if (!(!rest && req.method === 'DELETE')) {
      requireProject({ film: !filmOptional });
    }
    /* ── subtitles: the film's lines, the person's subtitle style, translation (see captions.mjs) ── */
    if (await captionRoutes(req, res, project.path, rest, { translate: (root) => subtitleTranslator(root, { askAgent }), transcribe: await subtitleTranscriber() })) return;
    /* caption tracks: a track's WebVTT file, read and written whole (caption-tracks.mjs) */
    if (await captionTrackRoutes(req, res, project.path, rest, url, { translate: (root) => subtitleTranslator(root, { askAgent }) })) return;
    /* ── end subtitles ── */
    /* the editor's settings of the project: its frame rate, its tracks' names (see project-settings.mjs) */
    if (await projectSettingsRoute(req, res, project.path, rest)) return;
    /* its markers (markers.mjs): Studio's own, beside film.html */
    if (await markersRoute(req, res, project.path, rest)) return;
    /* its canvas (canvas.mjs): Studio's own board beside the edit */
    if (await canvasRoute(req, res, project.path, rest)) return;
    if (await canvasWriteRoute(req, res, rest, askAgent, project.path)) return;
    /* a clip trimmed, its sound or its shots taken out, cropped: on this computer (clip-tools.mjs) */
    if (await clipToolsRoute(req, res, project.path, rest)) return;
    if (await canvasMadeRoute(req, res, project.path, rest, url)) return;
    if (await projectCharactersRoute(req, res, project.path, rest)) return;
    if (await projectTemplatesRoute(req, res, project.path, rest)) return;
    /* an example's canvas laid down on this one: its files copied into assets/examples/<id>/ (canvas-templates.mjs) */
    if (rest.startsWith('example-canvas/') && req.method === 'POST') {
      const id = decodeURIComponent(rest.slice('example-canvas/'.length));
      const folder = await exampleFolderHere(id);
      if (!existsSync(join(folder, CANVAS_FILE))) throw new HttpError(404, 'This example has no canvas.');
      return json(res, 200, await copyBoardInto(project.path, folder, await readCanvas(folder), `assets/examples/${id}`));
    }
    /* the page under a dip to white, kept once (transition-pages.mjs) */
    if (await transitionPageRoutes(req, res, project.path, rest)) return;
    if (!rest) {
      /* `folder`: the project's files on the film's origin, where the preview loads them */
      if (req.method === 'GET') {
        if (chosenFolder('savedFolder')) await notifyReferences(() => repairLibraryReferences(project.path));
        const film = await settleProjectFilm(project.path);
        requireProject({ film: false });
        /* opened: its card in the projects list gets a picture before the list first shows it */
        if (film.doc?.tracks.some((t) => t.clips.length)) warmFilmPoster(project.path, pages.folderUrl(project));
        /* `filmMissing`: read as an empty film, and said to be missing (see watch.mjs `film-missing`) */
        /* `outer`: a compound clip's film is in this project, which its editor goes back to (parts.mjs) */
        const outer = await outerProject(project.path);
        return json(res, 200, { project, folder: pages.folderUrl(project), ...film, ...(projectMissing(project.path) === 'film' ? { filmMissing: true } : {}), ...(outer ? { outer } : {}) });
      }
      if (req.method === 'PATCH') {
        const { name } = /** @type {{ name?: string }} */ (await readJson(req));
        if (agentIn(project.path)) throw new HttpError(409, 'An agent is running in this project: stop it first, then rename the project.', { code: 'agent-running' });
        if (exports.list(project.id).some((job) => job.status === 'waiting' || job.status === 'running')) {
          throw new HttpError(409, 'An export is queued or running in this project: wait for it to finish or stop it first, then rename the project.', { code: 'export-running' });
        }
        /* the app's agent between turns works in the folder, and Windows will not rename it under that: let go first */
        const renamed = await renameProject(project.id, String(name ?? ''), { release });
        if (renamed.path !== project.path || renamed.name !== project.name) {
          watchers.move(project.path, renamed.path);
          exportRoots.set(project.id, renamed.path);
          /* its address stays: the preview open on it keeps loading from the folder by its new name */
          pages.folderUrl(renamed);
          /* the pages showing it (renamed from another tab, or the projects list) take the new name */
          watchers.emit(renamed.path, { type: 'project', project: renamed });
          /* Reload changes waiting to settle when the old watcher closed. A blank revision also refreshes
             an unchanged film, but only for this project after an actual rename. */
          watchers.emit(renamed.path, { type: 'film', rev: '' });
          watchers.emit(renamed.path, { type: 'files' });
          watchers.emit(renamed.path, { type: 'history' });
        }
        return json(res, 200, { project: renamed });
      }
      /* the project is deleted: its folder goes to the Trash (pages showing it go back to the list) */
      if (req.method === 'DELETE') {
        /* its files are being written, and its chat is mid-turn: stopped first, by the person */
        if (agentIn(project.path)) throw new HttpError(409, 'An agent is running in this project: stop it first, then delete the project.', { code: 'agent-running' });
        await deleteProject(project.id);
        /* every page showing it leaves it (with tabs, its tab closes) */
        watchers.emit(project.path, { type: 'gone' });
        return json(res, 200, {});
      }
    }
    /* an editor page shows it: the person opened it, so it is the one `openfilm open` alone comes back to */
    if (rest === 'opened' && req.method === 'POST') {
      mediaIndex.soon(project.path);
      return json(res, 200, { project: await markOpened(project.id) });
    }
    /* the fonts its pages declare with @font-face, and with `page` (a project path) the families that page can draw with
       and names (project-fonts.mjs): the font menu's "In this project" */
    if (rest === 'fonts' && req.method === 'GET') {
      const page = url.searchParams.get('page');
      return json(res, 200, await projectFonts(project.path, page ? resolveIn('', page) : null));
    }
    /* a font file the person adds for the lines of words (`?name=` its file's name, the body the file): put in the text
       component's folder in the project (brought in first when it is not there), declared in its fonts/own.css, which
       its page loads; so it goes with the project. → { family, path } */
    if (rest === 'fonts' && req.method === 'POST') {
      const name = basename(url.searchParams.get('name') ?? '');
      if (!isFontFile(name)) throw new HttpError(400, 'a font file, please (.ttf, .otf, .woff or .woff2)');
      const taken = /** @type {{ path?: string, clip?: { src: string } }} */ (await takeSaved(project.path, `${BUILT_IN}/${TEXT_COMPONENT}`));
      const folder = dirname(taken.clip?.src ?? taken.path ?? '');
      const { path } = await importFile(project.path, `${folder}/fonts/${name}`, req);
      const family = await addTextFont(project.path, `${folder}/${TEXT_OWN_FONTS}`, path);
      return json(res, 200, { family, path });
    }
    /* ── version history (history.mjs) ──
         GET    history[?limit=n]                → { status, versions, more }: the version checked out and the changes
                                                   against it, and the versions, newest first, with their parents
         GET    history/versions/:commit         → { files }: what that version changed
         GET    history/versions/:commit/preview → { folder, doc, missing }: a read-only copy on the film origin
         POST   history/save      { message? }   commit the changes as a version
         POST   history/discard                  the folder as the version checked out holds it
         POST   history/checkout  { commit, discard? }   check out a version (no version is made)
         POST   history/film      { commit }     film.html missing: only film.html put back as that version has it
         POST   history/copy      { commit, name } a new project holding that version → { project, missing }
       Every change tells the project's pages ({ type: 'history' }; `moved`: the folder's files changed, so Studio's
       state of the film is read again). While one runs, they hear how far it is ({ type: 'history-progress', op,
       phase, done, total }). */
    if (parts[2] === 'history') {
      const history = parts.slice(3);
      /** @param {string} op */
      const onProgress = (op) => (/** @type {{ phase: string, done: number, total: number }} */ p) => watchers.emit(project.path, { type: 'history-progress', op, ...p });
      if (!history.length && req.method === 'GET') {
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 1000);
        const [state, { versions, more, deletedCount }] = await Promise.all([historyStatus(project.path, { onProgress: onProgress('load') }), log(project.path, { limit, deleted: url.searchParams.get('deleted') === '1', includeDeletedCount: true })]);
        return json(res, 200, { status: state, versions, more, deletedCount });
      }
      if (history[0] === 'versions' && history.length === 2 && req.method === 'GET') return json(res, 200, { files: await versionFilesChanged(project.path, history[1]) });
      if (history[0] === 'versions' && history.length === 3 && history[2] === 'preview' && req.method === 'GET') {
        const snapshot = await historyPreviews.get(project.path, history[1]);
        const film = await readProjectFilm(snapshot.path);
        return json(res, 200, {
          folder: pages.folderUrl({ id: `${project.id}/history/${history[1]}`, path: snapshot.path }),
          doc: film.doc, missing: snapshot.missing,
        });
      }
      if (history[0] === 'save' && req.method === 'POST') {
        const { message } = /** @type {{ message?: string }} */ (await readJson(req));
        /* a write of the agent's not merged yet is merged first, so the version has the person's edits */
        await settleProjectFilm(project.path);
        await personEdits.settleFiles(project.path);
        const sha = await saveVersion(project.path, { message: String(message ?? ''), onProgress: onProgress('save') });
        historyChanged(project.path);
        return json(res, 200, { commit: sha });
      }
      if ((history[0] === 'delete' || history[0] === 'recover') && history.length === 1 && req.method === 'POST') {
        const { commits } = /** @type {{ commits?: unknown }} */ (await readJson(req));
        const done = history[0] === 'delete' ? await deleteVersions(project.path, commits) : await recoverVersions(project.path, commits);
        if (history[0] === 'delete') await historyPreviews.invalidate(project.path, done.commits);
        historyChanged(project.path);
        return json(res, 200, done);
      }
      if (history[0] === 'discard' && req.method === 'POST') {
        /* the folder goes back as a version had it: the person's edits before are not kept over it */
        personEdits.filmReplaced(project.path);
        const done = await discardChanges(project.path, { onProgress: onProgress('discard') });
        historyChanged(project.path, { moved: true });
        return json(res, 200, { ...done, ...(await readProjectFilm(project.path)) });
      }
      if (history[0] === 'checkout' && req.method === 'POST') {
        const { commit: target, discard } = /** @type {{ commit?: string, discard?: boolean }} */ (await readJson(req));
        personEdits.filmReplaced(project.path);
        const done = await checkoutVersion(project.path, String(target ?? ''), { discard: discard === true, onProgress: onProgress('checkout') });
        historyChanged(project.path, { moved: true });
        /* `missing`: media of that version history no longer has (left as it is in the folder); `kept`: files the
           trash would not take (left where they are, the version checked out around them) */
        return json(res, 200, { ...done, ...(await readProjectFilm(project.path)) });
      }
      if (history[0] === 'film' && history.length === 1 && req.method === 'POST') {
        const { commit: target } = /** @type {{ commit?: string }} */ (await readJson(req));
        personEdits.filmReplaced(project.path);
        const done = await restoreFilm(project.path, String(target ?? ''), { onProgress: onProgress('restore') });
        historyChanged(project.path, { moved: true });
        return json(res, 200, { ...done, ...(await readProjectFilm(project.path)) });
      }
      if (history[0] === 'put-back' && req.method === 'POST' && (history.length === 1 || (history.length === 2 && history[1] === 'done'))) {
        /* The desktop app restores a turn's files: before, nothing of the person's is merged over them; after,
           every open board reads its restored document, including when the turn changed no film.html. */
        if (history.length === 1) personEdits.filmReplaced(project.path);
        else watchers.emit(project.path, { type: 'canvas', reset: true });
        return json(res, 200, {});
      }
      if (history[0] === 'copy' && req.method === 'POST') {
        const { commit: target, name } = /** @type {{ commit?: string, name?: string }} */ (await readJson(req));
        const copy = await createProject(String(name ?? '').trim() || `${project.name} copy`);
        const { missing } = await copyVersion(project.path, String(target ?? ''), copy.path, { onProgress: onProgress('copy') });
        return json(res, 200, { project: copy, missing });
      }
      throw new HttpError(404, 'no such history action');
    }
    /* the chat's next message: the note for its agent (`agent`: app:<conversation>), as `GET /api/kept` gives one */
    if (rest === 'kept' && req.method === 'GET') {
      return json(res, 200, personEdits.noteFor(project.path, (url.searchParams.get('agent') || 'app:unknown').slice(0, 200)) ?? { line: null });
    }
    if (rest === 'edit' && req.method === 'POST') {
      const { base = null, ops, undo } = /** @type {{ base?: string | null, ops?: import('./film.mjs').Op[], undo?: boolean }} */ (await readJson(req));
      try {
        return json(res, 200, await editProjectFilm(project.path, base, ops ?? [], { undo: undo === true }));
      } catch (e) {
        if (!(e instanceof EditError)) throw e;
        /* the person's view is out of date or the edit cannot be: send the film as it is now with the reason */
        const now = await readProjectFilm(project.path);
        throw new HttpError(e.kind === 'conflict' ? 409 : 422, e.message, { rev: now.rev, doc: now.doc });
      }
    }
    /* a compound clip's film: written in a folder of its own under parts/ as it is made, read as it is taken apart
       (parts.mjs, compound.mjs); the film itself changes by an edit, as any */
    if (rest === 'films' && req.method === 'POST') {
      const { name, film } = /** @type {{ name?: string, film?: import('./ops.mjs').FilmValue }} */ (await readJson(req));
      if (!film || !Array.isArray(film.tracks)) throw new HttpError(400, 'a film is needed');
      try {
        return json(res, 200, { folder: await writePartFilm(project.path, String(name ?? 'compound'), film) });
      } catch (e) {
        throw new HttpError(422, e instanceof Error ? e.message : String(e));
      }
    }
    /* a compound clip's film opened to edit: a project of its own, served from this one's folder (pages.mjs) */
    if (rest === 'films/open' && req.method === 'POST') {
      const { folder } = /** @type {{ folder?: string }} */ (await readJson(req));
      try { await readPartFilm(project.path, String(folder ?? '')); } catch (e) { throw new HttpError(404, e instanceof Error ? e.message : String(e)); }
      return json(res, 200, { project: await openProject(join(project.path, String(folder)), { create: false }) });
    }
    /* the film's covers (covers.mjs): listed (the one the film is shown by among them), made (from a moment of the film,
       a picture, a color, a look, or another cover), opened to edit as a compound clip's film is, given another
       picture or look, one made the film's own, and drawn as pictures */
    if (rest === 'covers' || rest.startsWith('covers/')) {
      try {
        if (rest === 'covers' && req.method === 'GET') {
          const covers = await listCovers(project.path);
          return json(res, 200, { covers, main: await mainCover(project.path, covers), looks: await coverLooks(), made: await madeCoverPictures(project.path) });
        }
        const ask = /** @type {{ folder?: unknown, folders?: unknown, at?: unknown, picture?: unknown, color?: unknown, look?: unknown, name?: unknown, stage?: unknown, from?: unknown, format?: unknown, reveal?: unknown, text?: unknown }} */ (await readJson(req));
        if (rest === 'covers' && req.method === 'POST') return json(res, 200, { folder: await makeCover(project.path, ask) });
        if (rest === 'covers/open' && req.method === 'POST') {
          const { abs } = coverFolder(project.path, ask.folder);
          return json(res, 200, { project: await openProject(abs, { create: false }) });
        }
        if (rest === 'covers/frame' && req.method === 'POST') return json(res, 200, { clip: await coverFrame(project.path, ask.folder, ask.at) });
        if (rest === 'covers/look' && req.method === 'POST') return json(res, 200, { clip: await coverLook(project.path, ask.folder, ask.look) });
        if (rest === 'covers/picture' && req.method === 'POST') return json(res, 200, { clip: await coverPicture(project.path, ask.folder, ask) });
        if (rest === 'covers/main' && req.method === 'POST') return json(res, 200, { main: await setMainCover(project.path, ask.folder) });
        /* a design cancelled: a cover put back as it was, one made in it taken away */
        if (rest === 'covers/restore' && req.method === 'POST') { await restoreCover(project.path, ask.folder, ask.text); return json(res, 200, {}); }
        if (rest === 'covers/discard' && req.method === 'POST') { await discardCover(project.path, ask.folder); return json(res, 200, {}); }
        if (rest === 'covers/draw' && req.method === 'POST') {
          const folders = Array.isArray(ask.folders) ? ask.folders : [];
          /* into the folder a video was exported to with them (`~` the home folder), else the exports folder */
          const wanted = typeof ask.folder === 'string' ? ask.folder.replace(/^~(?=$|[\\/])/, homedir()) : '';
          const files = await drawCovers(project.path, folders, wanted && isAbsolute(wanted) ? wanted : exportsRoot(), ask.format === 'png' ? 'png' : 'jpg');
          /* shown where they were put, as an export is, unless they went with a video (its tray shows that) */
          if (files[0] && ask.reveal !== false) reveal(files[0]);
          return json(res, 200, { files });
        }
      } catch (e) {
        if (e instanceof CoverFilmError) throw new HttpError(e.status, e.message);
        throw e;
      }
    }
    if (rest === 'films' && req.method === 'GET') {
      try {
        return json(res, 200, { film: await readPartFilm(project.path, url.searchParams.get('folder') ?? '') });
      } catch (e) {
        throw new HttpError(404, e instanceof Error ? e.message : String(e));
      }
    }
    /* a video's sound, made a file of its own beside it (files.mjs extractAudio) */
    if (rest === 'files/audio' && req.method === 'POST') {
      const { path: from } = /** @type {{ path?: string }} */ (await readJson(req));
      return json(res, 200, { path: await extractAudio(project.path, String(from ?? '')) });
    }
    /* files or folders of this computer copied in (cloned where the disk can) or linked (files.mjs bringIn): the paths
       given (the desktop app knows a dropped file's), else the person's pick in the system's dialog. { landed } */
    if (rest === 'files/bring' && req.method === 'POST') {
      const { into, mode, paths, folder, title } = /** @type {{ into?: unknown, mode?: unknown, paths?: unknown, folder?: unknown, title?: unknown }} */ (await readJson(req));
      /* `auto`: as it takes least room (files.mjs bringIn); `linked`: what was left where it is kept for that */
      const how = mode === 'link' ? 'link' : mode === 'auto' ? 'auto' : 'copy';
      /** @type {string[]} */
      const linked = [];
      const ask = { title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : 'Choose', at: null };
      const picked = Array.isArray(paths) ? paths.map(String)
        : await (folder === true ? pickFolder(ask).then((p) => (p ? [p] : [])) : pickFiles(ask)).catch((e) => { throw new HttpError(501, String(e?.message ?? e)); });
      return json(res, 200, { landed: await notifyReferences(() => bringIn(project.path, String(into ?? 'assets'), picked, how, { onLinked: (rel) => linked.push(rel) })), linked });
    }
    /* a link pointed somewhere else (files.mjs relink): the path given, else the person's pick. { path } (null: cancelled) */
    if (rest === 'files/relink' && req.method === 'POST') {
      const { path: rel, to, folder, title } = /** @type {{ path?: unknown, to?: unknown, folder?: unknown, title?: unknown }} */ (await readJson(req));
      const ask = { title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : 'Choose', at: null };
      const where = typeof to === 'string' ? to
        : await (folder === true ? pickFolder(ask) : pickFiles(ask).then((p) => p[0] ?? null)).catch((e) => { throw new HttpError(501, String(e?.message ?? e)); });
      return json(res, 200, { path: where ? await notifyReferences(() => relink(project.path, String(rel ?? ''), where)) : null });
    }
    /* the proxies the preview plays heavy footage from (proxies.mjs), asked for when not made yet: each heavy video's
       state (off: none), and each one's the editor's browser does not decode (`undecoded`, which it tells by `checks`)
       on or off */
    if (rest === 'proxies' && req.method === 'POST') {
      const { proxies } = readPrefs();
      const { undecoded } = /** @type {{ undecoded?: unknown }} */ (await readJson(req));
      const paths = new Set((await listFiles(project.path)).files.filter((f) => f.kind === 'video').map((f) => f.path));
      /* the footage most of the film's clips play first: its proxy is made first, the one a scrub needs most */
      const uses = new Map();
      for (const track of /** @type {{ clips: { src: string }[] }[]} */ ((await readProjectFilm(project.path).catch(() => null))?.doc?.tracks ?? [])) {
        for (const clip of track.clips) {
          let path = String(clip.src).split(/[?#]/)[0].replace(/^(?:\.\/)+/, '');
          if (!paths.has(path)) try { path = decodeURIComponent(path); } catch { /* as written */ }
          if (clipKind(path) !== 'video' || !servable(project.path, path)) continue;
          paths.add(path);
          uses.set(path, (uses.get(path) ?? 0) + 1);
        }
      }
      const videos = [...paths].sort((a, b) => (uses.get(b) ?? 0) - (uses.get(a) ?? 0));
      const told = Array.isArray(undecoded) ? undecoded.filter((rel) => typeof rel === 'string' && paths.has(rel)) : [];
      const states = await ensureProxies(project.path, videos, proxies.height, { on: proxies.on, undecoded: told });
      return json(res, 200, { on: proxies.on, height: proxies.height, states, checks: await playChecks(project.path, videos) });
    }
    if (rest === 'playback' && (req.method === 'GET' || req.method === 'POST')) {
      return sendPlayback(req, res, project.path, url.searchParams.get('path') ?? '', url);
    }
    /* renders of the stretches the preview played late (preview-cache.mjs), asked for when not made yet: each one's
       name and state, at the proxies' size */
    if (rest === 'preview-cache' && (req.method === 'POST' || req.method === 'GET')) {
      const body = req.method === 'GET' ? { ranges: knownLate(project.path), fps: url.searchParams.get('fps') } : await readJson(req);
      const { ranges, fps, action, playing: isPlaying } = /** @type {{ ranges?: unknown, fps?: unknown, action?: unknown, playing?: boolean }} */ (body);
      if (action === 'retry') { retryPreviews(project.path); return json(res, 200, { retried: true }); }
      if (action === 'clear') { clearPreviews(project.path); return json(res, 200, { late: [], ranges: [] }); }
      if (action === 'cancel') { cancelPreviews(project.path); return json(res, 200, { late: [], ranges: [] }); }
      if (action === 'pause') { pausePreviews(project.path, true); return json(res, 200, { paused: true }); }
      const rate = Number(fps);
      const list = Array.isArray(ranges) ? ranges.filter((r) => Array.isArray(r) && r.length === 2 && r.every(Number.isFinite) && r[1] > r[0] && r[0] >= 0).slice(0, 1000) : [];
      if (!(rate > 0 && rate <= 240)) throw new HttpError(400, 'fps: a frame rate');
      const { proxies } = readPrefs();
      if (req.method === 'POST' && isPlaying) pausePreviews(project.path, true);
      const result = list.length ? ensurePreviews(project.path, /** @type {[number, number][]} */ (list), rate, proxies.height, undefined, { schedule: req.method === 'POST' && !isPlaying }) : [];
      if (req.method === 'POST' && !isPlaying) pausePreviews(project.path, false);
      return json(res, 200, { late: list, ranges: result });
    }
    /* what the project is missing (media-reconnect.mjs): links that lead nowhere, files its clips name that are gone */
    /* how the project's media was made, by path (media-made.mjs): what each was asked with, by whom, from which
       files, its other versions, and the same asked again */
    if (rest === 'files/made' && req.method === 'GET') return json(res, 200, { made: await madeView(project.path) });
    if (rest === 'files/missing' && req.method === 'GET') {
      /* asked because something looks missing: it is looked for (the pages hear when it is back) */
      mediaIndex.soon(project.path);
      return json(res, 200, { missing: (await missingMedia(project.path)).map(({ path, name, folder, linked, was }) => ({ path, name, folder, linked, was })) });
    }
    /* what is missing looked for and connected again, in a folder the person points at too: the one given, else
       their pick (`folder: true`). { found, missing } (`cancelled`: no folder was picked) */
    if (rest === 'files/reconnect' && req.method === 'POST') {
      const { folder, title } = /** @type {{ folder?: unknown, title?: unknown }} */ (await readJson(req));
      const ask = { title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : 'Choose', at: null };
      const where = typeof folder === 'string' ? folder
        : folder === true ? await pickFolder(ask).catch((e) => { throw new HttpError(501, String(e?.message ?? e)); }) : undefined;
      if (folder === true && !where) return json(res, 200, { cancelled: true });
      const { found, missing } = await reconnect(project.path, { folders: where ? [where] : [] });
      if (found.length) watchers.emit(project.path, { type: 'files' });
      return json(res, 200, { found: found.length, missing: missing.map(({ path, name, folder: isFolder, linked, was }) => ({ path, name, folder: isFolder, linked, was })) });
    }
    /* what a link leads to copied into the project in its place (files.mjs collect) */
    if (rest === 'files/collect' && req.method === 'POST') {
      const { path: rel } = /** @type {{ path?: unknown }} */ (await readJson(req));
      return json(res, 200, { path: await notifyReferences(() => collect(project.path, String(rel ?? ''))) });
    }
    /* a video's frame made a still beside it (files.mjs freezeFrame): the timeline's freeze frame */
    if (rest === 'files/still' && req.method === 'POST') {
      const { path: from, ms } = /** @type {{ path?: string, ms?: number }} */ (await readJson(req));
      return json(res, 200, { path: await freezeFrame(project.path, String(from ?? ''), Number(ms)) });
    }
    if (rest === 'files') {
      const at = url.searchParams.get('path') ?? '';
      if (req.method === 'GET') {
        /* a compound clip's film uses the media of the project it is in: that one's, named from its folder */
        const outer = compoundOuter(project.path);
        if (outer === resolve(project.path)) return json(res, 200, await listFiles(project.path));
        return json(res, 200, filesFrom(await listFiles(outer), relative(outer, resolve(project.path)).split(sep).join('/')));
      }
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
        const { from, to, check } = /** @type {{ from?: string, to?: string, check?: boolean }} */ (await readJson(req));
        /* `check`: what the move could not keep true (paths a page makes while it runs), nothing moved */
        if (check === true) return json(res, 200, { unseen: await moveCheck(project.path, String(from ?? ''), String(to ?? '')) });
        return json(res, 200, await notifyReferences(() => moveFile(project.path, String(from ?? ''), String(to ?? ''))));
      }
      if (req.method === 'DELETE') {
        await notifyReferences(() => trashFile(project.path, at));
        return json(res, 200, {});
      }
    }
    /* clips, groups of clips and files of this project put in Saved (saved.mjs), each bundle with its picture; and a
       thing of Saved taken into this project (a file imported, a bundle's files copied in) */
    if (rest === 'saved' && req.method === 'POST') {
      const body = /** @type {{ clips?: unknown, groups?: unknown, files?: unknown, into?: unknown }} */ (await readJson(req) ?? {});
      const asked = (/** @type {unknown} */ list) => (Array.isArray(list) ? list.filter((x) => x && typeof x === 'object').slice(0, 50) : []);
      /* where it goes: the place asked for, else the first of the person's shelf (library-places.mjs) */
      const into = typeof body.into === 'string' ? body.into : await defaultPlace(moveAssetCatalog);
      const base = pages.folderUrl(project);
      const paths = await savedCall(async () => {
        const out = [];
        for (const c of /** @type {{ id?: unknown, name?: string, durationMs?: number, w?: number, h?: number }[]} */ (asked(body.clips))) {
          const ms = typeof c.durationMs === 'number' && c.durationMs > 0 ? c.durationMs : 0;
          out.push(await saveClip(project.path, String(c.id ?? ''), { ...c, into, poster: (clip) => clipPoster(project.path, base, clip, ms) }));
        }
        for (const g of /** @type {{ ids?: unknown, name?: string, durationMs?: number, w?: number, h?: number }[]} */ (asked(body.groups))) {
          const ids = Array.isArray(g.ids) ? g.ids.filter((id) => typeof id === 'string').slice(0, 200) : [];
          out.push(await saveGroup(project.path, ids, { ...g, into, poster: (clip) => clipPoster(project.path, base, clip, 0) }));
        }
        for (const f of /** @type {{ path?: unknown, name?: string, durationMs?: number, w?: number, h?: number }[]} */ (asked(body.files))) {
          const file = String(f.path ?? '');
          out.push(await saveFile(project.path, file, { ...f, into, poster: () => clipPoster(project.path, base, { src: file }, typeof f.durationMs === 'number' ? f.durationMs : 0) }));
        }
        return out;
      });
      return json(res, 200, { paths });
    }
    if (rest === 'saved/take' && req.method === 'POST') {
      const { path: from } = /** @type {{ path?: unknown }} */ (await readJson(req) ?? {});
      const taken = await savedCall(async () => await existingLibraryAsset(project.path, from) ?? await takeSaved(project.path, from));
      if ('path' in taken) await carryMade(project.path, taken.path);
      return json(res, 200, taken);
    }
    if (rest === 'library/add' && req.method === 'POST') {
      const { path: source, mode } = await readJson(req) ?? {};
      const binding = await savedCall(() => addLibraryAsset(project.path, source, mode));
      return json(res, 200, binding);
    }
    /* a page as text, read and written by what Studio writes into a page (layers pasted, page-text.mjs) */
    if (rest === 'page' && req.method === 'GET') return json(res, 200, await readPage(project.path, url.searchParams.get('path')));
    if (rest === 'page' && req.method === 'PUT') {
      const { path: at, text, expect, undo } = /** @type {{ path?: unknown, text?: unknown, expect?: unknown, undo?: unknown }} */ (await readJson(req) ?? {});
      if (text !== null && typeof text !== 'string') throw new HttpError(400, 'the page\'s text, please');
      return json(res, 200, await writePage(project.path, at, text, typeof expect === 'string' ? expect : null, { undo: undo === true }));
    }
    /* a clip of another project brought into this one, with the files it needs (layers pasted from there) */
    if (rest === 'bring' && req.method === 'POST') {
      const { from, clip } = /** @type {{ from?: unknown, clip?: any }} */ (await readJson(req) ?? {});
      const source = typeof from === 'string' ? await projectById(from).catch(() => null) : null;
      if (!source || source.missing) throw new HttpError(404, 'The project it was copied from is not there any more.');
      return json(res, 200, await savedCall(() => bringClip(project.path, source.path, clip, source.name)));
    }
    /* how loud the film's sound is as mixed (derived.mjs mixLoudness): the sounds the preview plays, and how long the
       film is; what the preview turns its sound by to be heard at the loudness it is delivered at */
    if (rest === 'mix-loudness' && req.method === 'POST') {
      const { sounds, duration } = /** @type {{ sounds?: unknown, duration?: unknown }} */ (await readJson(req) ?? {});
      if (!Array.isArray(sounds) || sounds.length > 5000 || typeof duration !== 'number' || !(duration > 0 && duration <= 24 * 3600)) throw new HttpError(400, 'sounds: a list of the film\'s sounds; duration: seconds');
      /* the preview names each sound on the address the film is served at: taken back to its path in the project,
         and only a file the project serves (any other is no sound of this film) */
      const base = new URL(pages.folderUrl(project));
      const local = /** @type {import('../../src/host.mjs').FilmSound[]} */ (sounds).flatMap((sound) => {
        if (!sound || typeof sound.src !== 'string') return [];
        const source = new URL(sound.src, base);
        if (source.origin !== base.origin || !source.pathname.startsWith(base.pathname)) return [];
        const path = decodeURIComponent(source.pathname.slice(base.pathname.length));
        return path && servable(project.path, path) ? [{ ...sound, src: path.split('/').map(encodeURIComponent).join('/') }] : [];
      });
      try {
        return json(res, 200, await mixLoudness(project.path, local, duration));
      } catch (e) {
        if (e instanceof MediaError) throw e;
        throw new HttpError(422, String(/** @type {Error} */ (e)?.message ?? e));
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
      if (what === 'wave' && compoundFolder(at)) {
        const base = pages.folderUrl(project);
        const root = compoundOuter(project.path);
        const outer = new URL(pages.folderUrl({ id: project.id, path: root }));
        const { duration, sounds } = await compoundSound(project.path, base, at, url.searchParams.get('v') ?? '').catch((e) => {
          throw new HttpError(e instanceof PageFrameError ? 404 : 422, String(e?.message ?? e));
        });
        if (duration == null) return json(res, 200, { duration: 0, peaks: [] });
        // The preview names sounds on its own origin. Resolve only files that origin serves for this project.
        const local = sounds.flatMap((sound) => {
          const source = new URL(sound.src, base);
          if (source.origin !== outer.origin || !source.pathname.startsWith(outer.pathname)) return [];
          const path = source.pathname.slice(outer.pathname.length);
          return path && servable(root, decodeURIComponent(path)) ? [{ ...sound, src: `/${path}` }] : [];
        });
        return json(res, 200, await mixedWaveform(root, local, duration));
      }
      if (what === 'wave') return json(res, 200, await waveform(project.path, at));
      /* the loudness of a part of its sound (`from`, `to`: its own seconds): what "Normalize loudness" sets volumes by */
      if (what === 'loudness') {
        const to = url.searchParams.get('to');
        return json(res, 200, await loudness(project.path, at, Number(url.searchParams.get('from') ?? 0), to == null ? undefined : Number(to)));
      }
      /* a web page has no file to cut a frame from: it is drawn, as an export draws it (pageframes.mjs); a page clip's
         frame (`clip`, its id) with the person's changes in it, as the film shows them */
      const clipId = what === 'frame' ? url.searchParams.get('clip') : null;
      const look = clipId && isPage(at) ? await pageClipLook(project.path, clipId) : null;
      /* a page's poster is drawn clear (what it leaves unpainted transparent), a frame on the timeline on black */
      const page = isPage(at) && (what === 'poster' || what === 'frame')
        ? () => pageFrame(project.path, pages.folderUrl(project), at, what === 'poster' ? -1 : Number(url.searchParams.get('ms')), what === 'poster' ? 480 : Number(url.searchParams.get('w')), look?.overrides ?? null, look?.size ?? null, what === 'poster').catch((e) => {
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
        res.writeHead(200, { 'content-type': pictureType(jpeg), 'cache-control': 'private, no-cache', etag: tag, 'content-length': jpeg.length });
        return res.end(jpeg);
      }
      res.writeHead(200, { 'content-type': pictureType(jpeg), 'cache-control': 'private, max-age=86400', 'content-length': jpeg.length });
      return res.end(jpeg);
    }
    /* exports (what one asks: see exports.mjs). GET also says where they go by default, what this machine encodes and
       how many subtitle cues the film has (the subtitle choices need some), and how big the project and its parts are */
    if (rest === 'exports') {
      if (req.method === 'GET') {
        const view = url.searchParams.get('view');
        if (view === 'queue') return json(res, 200, { exports: exports.list(project.id) });
        if (view === 'captions') return json(res, 200, await exports.captionInfo(project.path));
        if (view === 'project') return json(res, 200, await projectSizes(project.path));
        const settings = async () => ({ folder: exportsRoot(), can: await exportCapabilities(), render: renderDefaults(), drafts: draftApps() });
        if (view === 'settings') return json(res, 200, await settings());
        const [config, captions, sizes] = await Promise.all([settings(), exports.captionInfo(project.path), projectSizes(project.path)]);
        return json(res, 200, { exports: exports.list(project.id), ...config, ...captions, project: sizes });
      }
      if (req.method === 'POST') {
        exportRoots.set(project.id, project.path);
        const body = /** @type {any} */ (await readJson(req));
        const blur = (await readProjectSettings(project.path)).motionBlur;
        const withSampling = (/** @type {any} */ ask) => blur?.enabled && ask?.kind === 'video' && !ask.clip && ask.samples === undefined
          ? { ...ask, samples: blur.samples, shutter: ask.shutter ?? blur.shutter }
          : ask;
        /* several at once: `{ jobs: [ask…], folder? }` → `{ exports }`; one: the ask itself → `{ export }` */
        if (body && typeof body === 'object' && 'jobs' in body) {
          const request = Array.isArray(body.jobs) ? { ...body, jobs: body.jobs.map(withSampling) } : body;
          return json(res, 200, { exports: exports.startAll(project, request) });
        }
        return json(res, 200, { export: exports.start(project, withSampling(body)) });
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
    /* the project's own cover (cover.mjs): PUT a picture's bytes; POST `{ path }`, a picture of the project, or `{ ms }`,
       the film at that moment; DELETE, none of its own (the film's poster again). Answers when it was set (null: none) */
    if (rest === 'cover') {
      const set = (/** @type {{ at: number } | null} */ cover) => json(res, 200, { cover: cover?.at ?? null });
      try {
        if (req.method === 'PUT') return set(await setCover(project.path, await readCoverBody(req)));
        if (req.method === 'POST') {
          const { path: rel, ms } = /** @type {{ path?: unknown, ms?: unknown }} */ (await readJson(req));
          if (typeof rel === 'string' && rel) return set(await setCoverFromFile(project.path, readable(project.path, rel)));
          if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) {
            const jpeg = await pageFrame(project.path, pages.folderUrl(project), FILM_PAGE, ms, COVER_FRAME_W).catch((e) => {
              throw new HttpError(e instanceof PageFrameError ? 404 : 422, String(e?.message ?? e));
            });
            return set(await setCover(project.path, jpeg));
          }
          throw new HttpError(400, 'a picture of the project (path) or a moment of the film (ms)');
        }
        if (req.method === 'DELETE') {
          await clearCover(project.path);
          return set(null);
        }
      } catch (e) {
        if (e instanceof CoverError) throw new HttpError(e.status, e.message);
        throw e;
      }
    }
    /* the project's card in the projects list: its own cover, else the film's middle frame */
    if (rest === 'poster' && req.method === 'GET') {
      const cover = await readCover(project.path);
      if (cover) {
        const picture = await readFile(cover.path);
        res.writeHead(200, { 'content-type': cover.type, 'cache-control': 'private, max-age=60', 'content-length': picture.length });
        return res.end(picture);
      }
      /* a film with nothing in it yet has no picture to show (its card shows its own face, not a black frame) */
      const { doc } = await readProjectFilm(project.path);
      if (!doc?.tracks.some((t) => t.clips.length)) throw new HttpError(404, 'the film is empty');
      const jpeg = await filmPoster(project.path, pages.folderUrl(project)).catch((e) => {
        throw new HttpError(e instanceof PageFrameError ? 404 : 422, String(e?.message ?? e));
      });
      /* its first one is still being drawn: the card asks again in a while, rather than hold a connection meanwhile */
      if (!jpeg) {
        res.writeHead(503, { 'retry-after': '5', 'cache-control': 'no-store', 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'the film\'s poster is being drawn; ask again in a few seconds', code: 'drawing' }));
      }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=60', 'content-length': jpeg.length });
      return res.end(jpeg);
    }
    /* a file or folder of the project, shown where it is on the person's computer */
    if (rest === 'reveal' && req.method === 'POST') {
      const { path: rel, original } = /** @type {{ path?: string, original?: boolean }} */ (await readJson(req));
      /* no path: the project's own folder; `original`: where a linked file is kept */
      const abs = !rel ? project.path : original === true ? realpathSync(readable(project.path, String(rel))) : readable(project.path, String(rel));
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
        ...((e instanceof ProjectError || e instanceof FetchError || e instanceof BrowseError || e instanceof ExportError) && e.code ? { code: e.code } : {}),
        ...(e instanceof HistoryError && e.code ? { code: e.code } : {}) });
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
      const given = /** @type {string | undefined} */ (req.headers['x-studio-key']);
      const keyed = sameKey(given) || matches(given, agentKey) || (cookieKey(req) !== null && req.headers.origin === origin);
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
        if (!project || (project.missing && project.missingReason !== 'film')) return refuse('404 Not Found');
        const send = acceptWebSocket(req, socket, () => stop());
        if (send) stop = projectStream(project, send);
        return;
      }
      refuse('404 Not Found');
    })().catch(() => refuse('500 Internal Server Error'));
  });
  await listenLocal(editor, port);
  /* the examples index is asked for as Studio starts, so the Examples tab has GitHub's newest when it opens */
  void listExamples().catch(() => {});
  /* and what each service offers (OpenFilm's models are its service's to say), so Settings → Services opens with them */
  void freshProviders().catch(() => {});
  const address = /** @type {import('node:net').AddressInfo} */ (editor.address());
  origin = `http://127.0.0.1:${address.port}`;
  COOKIE = cookieName(address.port);
  FRAMED = framedCookieName(address.port);
  /* the film's port is the next one: when it is not free, the editor's is let go again, so a caller can try others */
  const historyPreviews = createHistoryPreviews();
  const pages = await startPages({ port: port ? address.port + 1 : 0, editorOrigin: () => origin, secret: key, projects: listProjects }).catch(async (e) => {
    watchers.closeAll();
    await new Promise((done) => editor.close(() => done(undefined)));
    throw e;
  });
  filmOrigin = pages.origin;
  /* the plugins' origin, on the port after the film's when that one is free (a page's own storage is kept by its
     origin), else on any */
  /* one let run (a program, or an element in the editor's own page) can do all the person's agent can: it writes too */
  const pluginOptions = { secret: key, editorOrigin: () => origin, mayWrite: (/** @type {{ uid: string, source: string }} */ plugin, /** @type {{ id: string }} */ project) => pluginWrites(plugin, project) || pluginRuns(plugin, project) };
  const pluginPages = await startPluginPages({ port: port ? address.port + 2 : 0, ...pluginOptions }).catch(() => startPluginPages({ port: 0, ...pluginOptions }));
  /**
   * OpenFilm's plugins as the editor is told them: each with whether it is on, where the module of its element is
   * (its package.json's `browser`, src/skills.mjs elementIn), on the plugins' origin as anyone's is, and the commands it
   * brings, by name (src/skills.mjs commandsIn). Its own ship with OpenFilm, so they are not asked leave to run.
   */
  const pluginsShown = () => pluginStates().map((p) => {
    const folder = join(pluginsDir(), p.id);
    const module = p.soon ? null : elementIn(folder), commands = p.soon ? null : commandsIn(folder, p.id);
    const icon = appIconIn(folder);
    /* the icon's address changes with its file, so a new one is not hidden by the copy the page keeps an hour */
    let drawn = '';
    if (icon) try { const stat = statSync(join(folder, icon)); drawn = `${stat.size.toString(36)}-${Math.round(stat.mtimeMs).toString(36)}`; } catch { /* gone since it was found */ }
    return { ...p, ...(module ? { element: pluginPages.surface({ uid: `openfilm/${p.id}`, source: 'own', folder, page: module }).page } : {}),
      ...(icon ? { appIcon: `/api/plugin-icon/${p.id}?v=${encodeURIComponent(`${icon}-${drawn}`)}` } : {}),
      ...(commands ? { commands: Object.keys(commands) } : {}) };
  });
  /* the programs of plugins that bring one, started as their workbenches are shown */
  const pluginPrograms = startPluginPrograms({ bin: join(studioHome(), 'plugin-bin'), mayRun: (plugin, project) => pluginRuns(plugin, project) });
  if (advertise) {
    /* Discover read as Studio starts, so its skills are there when it first opens (and on an empty conversation) */
    readDiscover({ fresh: 60_000 }).catch(() => { /* offline: what was read before, said so when Discover opens */ });
    mkdirSync(studioHome(), { recursive: true });
    /* `supervisor`: the process that starts this one again if it ends unexpectedly (main.mjs), stopped with it */
    const supervisor = Number(process.env.OPENFILM_STUDIO_SUPERVISOR) || undefined;
    /* `keepKey`: the agents' key only (anyone of this user reads the file), which the CLI sends as it is */
    const named = keepKey ? { key: agentKey, keyKind: 'agent' } : { key };
    writeFileSync(runFile(), `${JSON.stringify({ pid: process.pid, ...(supervisor ? { supervisor } : {}), origin, filmOrigin: pages.origin, ...named })}\n`, { mode: 0o600 });
  }

  /** @type {Promise<void> | null} */
  let closing = null;
  const studio = {
    origin,
    filmOrigin: pages.origin,
    pluginOrigin: pluginPages.origin,
    port: address.port,
    key,
    close() { return closing ??= shutDown(); },
  };
  async function shutDown() {
    /* the file is ours unless a later Studio has written its own (with the same key: it is the machine's) */
    if (advertise && advertised()?.pid === process.pid) rmSync(runFile(), { force: true });
    /* a running export stops, and cleans up after itself while the rest closes: its half-made files go before Studio */
    const exporting = exports.stopAll();
    stopVisionDownloads();
    for (const project of await listProjects().catch(() => [])) cancelPreviews(project.path);
    fetches.stopAll();
    autoVersions.stop();
    if (sweepMedia) clearTimeout(sweepMedia);
    mediaIndex.close();
    await closePageFrames();
    watchers.closeAll();
    await pages.close();
    await pluginPages.close();
    pluginPrograms.close();
    editor.closeAllConnections();
    for (const socket of streamSockets) socket.destroy();
    await new Promise((done) => editor.close(() => done(undefined)));
    await exporting;
    await historyPreviews.close();
  }
  return studio;
}

/** Run from a checkout of the repository (the editor's source is beside its build), not from an installed package. */
const FROM_SOURCE = existsSync(new URL('../ui/src', import.meta.url));

/**
 * A project's files as a compound clip's film or a cover in `folder` names them (`assets/a.mp4` → `../../assets/a.mp4`,
 * its own `look.html`), the films of compound clips and the other covers left out.
 * @param {Awaited<ReturnType<typeof listFiles>>} listing @param {string} folder
 */
function filesFrom(listing, folder) {
  /* a cover's own files (its picture, its look) are beside its film: named from there */
  const own = (/** @type {string} */ path) => path.startsWith(`${folder}/`);
  const keep = (/** @type {string} */ path) => own(path) || (!path.startsWith(`${PARTS}/`) && !path.startsWith(`${COVERS}/`));
  const named = (/** @type {string} */ path) => (own(path) ? path.slice(folder.length + 1) : srcInto(path, folder));
  return {
    ...listing,
    files: listing.files.filter((f) => keep(f.path)).map((f) => ({ ...f, path: named(f.path) })),
    pages: listing.pages.filter((p) => keep(p.path)).map((p) => ({ ...p, path: named(p.path) })),
    folders: listing.folders.filter(keep).map(named),
    made: listing.made.filter(keep).map(named),
    ...(listing.links ? { links: Object.fromEntries(Object.entries(listing.links).filter(([path]) => keep(path)).map(([path, link]) => [named(path), link])) } : {}),
  };
}

/**
 * The project a compound clip's film (its folder `path`) is in, the one right around it: what its editor goes back
 * to. Null for a project that is none's.
 * @param {string} path
 */
async function outerProject(path) {
  if (compoundOuter(path) === resolve(path)) return null;
  const around = dirname(dirname(resolve(path)));
  const found = await openProject(around, { create: false }).catch(() => null);
  const kind = basename(dirname(resolve(path))) === COVERS ? 'cover' : 'part';
  return found ? { id: found.id, name: found.name ?? basename(around), folder: basename(resolve(path)), kind } : null;
}

/**
 * `npx -y openfilm@<version> update` in the background (its words in logs/update.log), as the person would run it: the
 * newest stops this Studio and starts itself in its place. `then` hears it failed later, with its last words, if this
 * Studio is still here to hear it; one that cannot start is said at once.
 * @param {string} version @param {(state: { status: 'failed', version: string, error: string }) => void} then
 * @returns {{ status: 'updating' | 'failed', version: string, error?: string }}
 */
function runUpdate(version, then) {
  const logs = join(studioHome(), 'logs');
  mkdirSync(logs, { recursive: true });
  const file = join(logs, 'update.log');
  writeFileSync(file, '');
  const failed = (/** @type {string} */ error) => then({ status: 'failed', version, error });
  try {
    const out = openSync(file, 'a');
    const child = spawn('npx', ['-y', `openfilm@${version}`, 'update'], {
      detached: true, stdio: ['ignore', out, out], windowsHide: true, shell: process.platform === 'win32', env: { ...process.env, OPENFILM_NO_BROWSER: '1' },
    });
    child.once('error', (e) => failed(`npx did not start (it comes with Node.js): ${e.message}`));
    child.once('exit', (code) => {
      if (code === 0) return;
      const said = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).pop() ?? '';
      failed(said || `npx stopped (${code})`);
    });
    child.unref();
  } catch (e) { return { status: 'failed', version, error: e instanceof Error ? e.message : String(e) }; }
  return { status: 'updating', version };
}

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
function sendEditor(/** @type {Res} */ res, /** @type {string} */ dir, /** @type {string} */ path, /** @type {Record<string, string | string[]>} */ headers = {}) {
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
  /* no referrer: the page's address holds the key, and a link it opens must not carry it to another site */
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...headers });
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

/** What Saved is served by on the film's origin (pages.mjs): no project's id has a NUL in it. */
const SAVED_ORIGIN_ID = '\0saved';

/**
 * What saved.mjs answers, its refusals as the HTTP errors they are.
 * @template T @param {() => Promise<T>} fn @returns {Promise<T>}
 */
async function savedCall(fn) {
  try { return await fn(); } catch (e) {
    if (e instanceof SavedError) throw new HttpError(/** @type {number} */ (e.status), e.message);
    throw e;
  }
}

/**
 * A saved clip's picture, from the middle of what it shows: a page drawn with the changes made in it, a video's frame,
 * a still's own; a sound has none.
 * @param {string} root @param {string} base the project's folder as the pages are served (pageframes.mjs)
 * @param {{ src: string, time?: unknown, overrides?: unknown, size?: unknown }} clip @param {number} durationMs
 * @returns {Promise<Buffer | null>}
 */
async function clipPoster(root, base, clip, durationMs) {
  const kind = clipKind(clip.src);
  const from = Array.isArray(clip.time) && typeof clip.time[0] === 'number' ? clip.time[0] * 1000 : 0;
  const ms = durationMs > 0 ? from + durationMs / 2 : -1;
  /* laid out at the clip's size, as the film lays it out (a page without one of its own is the clip's `size`) */
  const size = /** @type {{ w?: number, h?: number } | undefined} */ (clip.size);
  if (kind === 'page') return pageFrame(root, base, clip.src, ms, 480, Array.isArray(clip.overrides) ? clip.overrides : null, size?.w && size?.h ? { w: size.w, h: size.h } : null);
  if (kind === 'video') return frame(root, clip.src, Math.max(0, ms), 480);
  if (kind === 'still') return poster(root, clip.src);
  return null;
}

/** A file in the app the system opens it with. */
function openFile(/** @type {string} */ file) {
  const [cmd, ...args] = opener(file);
  /* never `windowsHide`: Explorer opens the folder's window, or the file's app, hidden as it was asked to start */
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* nothing opens it */ }
}

/** The person's browser, at `url`. */
function systemBrowser(/** @type {string} */ url) {
  const [cmd, ...args] = opener(url);
  try { spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref(); } catch { /* no browser to open */ }
}


/**
 * An example's folder on this computer, fetched when it is not (examples.mjs exampleFolder); what went wrong, as an
 * HTTP error, when it cannot be. @param {string} id
 */
async function exampleFolderHere(id) {
  try {
    return await exampleFolder(id, { home: studioHome(), fetchFolder: (address, into) => fetchFilm(parseRepoUrl(address), { library: into }) });
  } catch (e) {
    throw new HttpError(e instanceof FetchError ? e.status : 404, e instanceof Error ? e.message : String(e));
  }
}

/** A poster's or frame's type by its first bytes: a page's poster drawn clear is a WebP, a clear picture's a PNG. */
function pictureType(/** @type {Buffer} */ bytes) {
  const head = bytes.subarray(0, 4).toString('latin1');
  return head === 'RIFF' ? 'image/webp' : head === '\x89PNG' ? 'image/png' : 'image/jpeg';
}

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {string} root @param {string} rel @param {URL} url */
async function sendPlayback(req, res, root, rel, url) {
  if (clipKind(rel) !== 'video') throw new HttpError(400, 'path: a video file');
  const asked = Number(url.searchParams.get('height'));
  const height = PROXY_HEIGHTS.includes(asked) ? asked : readPrefs().proxies.height;
  if (req.method === 'POST') return json(res, 200, { ...await ensurePlayback(root, rel, height), height });
  return sendMedia(req, res, readyProxy(root, rel, height), { check: true });
}

/**
 * A picture or a video from this computer, a range answered as one (a preview is seeked in); none: 404.
 * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {string | null | undefined} file
 */
function sendMedia(req, res, file, { keep = false, check = false } = {}) {
  if (res.destroyed) return;
  if (!file || !existsSync(file) || !statSync(file).isFile()) throw new HttpError(404, 'no such file');
  const { size, mtimeMs } = statSync(file);
  /* `keep`: a picture that changes only with its file (a skill's cover, an example's poster) is kept by the browser
     an hour, and then only asked whether it changed */
  const tag = `"${size.toString(36)}-${Math.round(mtimeMs).toString(36)}"`;
  /* `check`: one that may be drawn again in place (the library's pictures): kept, but asked about each time */
  const kept = keep ? { etag: tag, 'cache-control': 'private, max-age=3600' } : check ? { etag: tag, 'cache-control': 'private, no-cache' } : {};
  if ((keep || check) && req.headers['if-none-match'] === tag) { res.writeHead(304, kept); res.end(); return undefined; }
  const type = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.ogv': 'video/ogg',
    '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.weba': 'audio/webm',
  }[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  const [from, to] = range ? [range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2])), range[2] && range[1] ? Math.min(size - 1, Number(range[2])) : size - 1] : [0, size - 1];
  /* A file made shorter, or a proxy's old offset, asks past its end. The film host answers 416 to the same request:
     without it a 206 goes out with a negative content-length, and the stream's ERR_OUT_OF_RANGE leaves the request
     hanging. */
  if (range && (from > to || from >= size)) {
    res.writeHead(416, { 'content-range': `bytes */${size}`, 'accept-ranges': 'bytes' }).end();
    return undefined;
  }
  res.writeHead(range ? 206 : 200, { 'content-type': type, 'content-length': to - from + 1, 'accept-ranges': 'bytes', ...kept, ...(range ? { 'content-range': `bytes ${from}-${to}/${size}` } : {}) });
  /* A cancelled preview is normal: pipeline closes its file; its callback deliberately ignores the error. */
  pipeline(createReadStream(file, { start: from, end: to }), res, () => {});
  return undefined;
}
