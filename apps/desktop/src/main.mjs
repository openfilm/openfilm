/**
 * OpenFilm for desktop: one window of tabs, a project in each, a chat on the left and Studio on the right, one page
 * per tab (tabs.mjs). A project is picked in Studio's projects window (the tabs' `+`), and its tab opens; with no tab
 * open, the window's page is the projects (HOME).
 *
 * Studio is the open-source one (the `openfilm` package), run in a utility process (studio.mjs). It serves the
 * window's page: Studio's editor, built together with the chat beside it (shell/), on Studio's own origin, so the
 * editor works as it does in a browser and the chat is a column of the same page. What happens between them happens
 * in the page (shell/bridge.ts); this process does what only the app can: the window, the agents, files on the disk,
 * ffmpeg, updates (preload.cjs). The window opens straight into the last project.
 */
import { BaseWindow, Menu, Notification, WebContentsView, app, clipboard, dialog, ipcMain, nativeTheme, safeStorage, screen, shell } from 'electron';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { problemLine, problemsFile, recentProblems, recordProblem } from 'openfilm/problems';
import { FLAVOR, IDENTITY, PRODUCT_NAME } from './flavor.mjs';
import { folderDialogOptions, programDialogOptions } from './folder-dialog.mjs';
import { childEnvironment, lastPathSource, loginShellEnvironment } from './environment.mjs';
import { gatherAppReport } from './app-report.mjs';
import { startWindowStudio } from './studio.mjs';
import { studioSecrets } from './studio-secrets.mjs';
import { CHAT_MIN, STUDIO_MIN, WINDOW_MIN, placeOnDisplays, readWindowState, writeWindowState } from './window-state.mjs';
import { createPagePresentation, paintPage, preparePage, revealPage, syncPagePointer } from './page-presentation.mjs';
import { closeTabOrWindow, keepWindowOnClose, quitAfterStudio } from './window-lifecycle.mjs';
import { appLanguage } from './i18n/language.mjs';
import { PAGE_FAILURE_WORDS } from './i18n/page-failure.mjs';
import { applicationMenuTemplate } from './menu.mjs';
import { registerLocalAgentIpc } from './local-agents-ipc.mjs';
import { readPreferences, registerChatIpc } from './chat-ipc.mjs';
import { registerSkillsIpc } from './skills-ipc.mjs';
import { createConnectors, registerConnectorsIpc } from './connectors.mjs';
import { createRoster } from './agent-roster.mjs';
import { createOpenFilmAgent } from './openfilm-agent.mjs';
import { createAgentCatalogs } from './agent-catalogs.mjs';
import { createAgentUpdates } from './agent-updates.mjs';
import { AGENTS, checkAgentProgram, closeEverySession, diagnoseAgent, forgetAgentStatus, listAgents, localAgent, openAgentInstaller, openAgentUpdate, openAgentSignIn, setChosenPaths, signOutAgent } from './agents.mjs';
import { agentUsage, forgetAgentUsage } from './agent-usage.mjs';
import { installOpenfilmCommand } from './openfilm-command.mjs';
import { startUpdates } from './updates.mjs';
import { stepAside } from './update-launch.mjs';
import { ensureFfmpeg, ffmpegDir, ffmpegDownloadable, ffmpegIn, ffmpegOnPath } from './ffmpeg-runtime.mjs';
import { PATH_SEP } from './environment.mjs';
import { firstWindowsApps } from './windows-apps.mjs';
import { createTabs, projectGone } from './tabs.mjs';
import { turnNotice } from './turn-notices.mjs';
import { studioRestarts } from './studio-restart.mjs';
import { PROTOCOL, createLinks, linkFromArgv } from './deep-links.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const mac = process.platform === 'darwin';
const windows = process.platform === 'win32';
/** Windows' window buttons over the top bar: the board's color, and the text's */
const overlayColours = (t) => ({ color: t === 'dark' ? '#111114' : '#e9e9eb', symbolColor: t === 'dark' ? '#ebebed' : '#161619', height: 32 });

/* HTML-in-Canvas in Studio's viewer, as in the renderer (the `openfilm` package's src/host.mjs) */
app.commandLine.appendSwitch('enable-blink-features', 'CanvasDrawElement');
/* Some Windows networks/drivers fail Chromium's HTTP/3 requests in the main process. Use TCP for downloads
   and update checks as well as the window's requests, before any network session is created. */
app.commandLine.appendSwitch('disable-quic');
if (mac) {
  /* Flush small Canvas2D batches: blur on hundreds of strokes otherwise queues gigabytes of intermediate
     textures. Keep GPU canvas-to-WebGL uploads fast without changing the rest of Graphite's batching. */
  const features = app.commandLine.getSwitchValue('enable-features');
  app.commandLine.appendSwitch('enable-features', [
    features,
    'Canvas2DAutoFlushParams:max_recorded_op_graphite_kb/4',
  ].filter(Boolean).join(','));
} else {
  app.commandLine.appendSwitch('disable-skia-graphite');
}

/* each flavour its own name, data folder and single-instance lock (flavor.mjs) */
app.setName(PRODUCT_NAME);
/* Windows shows a notification only for the app ID the Start menu shortcut carries: the installer's appId (release.mjs) */
if (windows) app.setAppUserModelId(IDENTITY.bundleId);
app.setPath('userData', IDENTITY.userData ?? join(app.getPath('appData'), PRODUCT_NAME));
const DATA = app.getPath('userData');
const LOGS = join(DATA, 'logs');
const STUDIO_HOME = IDENTITY.studioHome ?? process.env.OPENFILM_HOME ?? join(app.getPath('home'), '.openfilm');
const STUDIO_PROBLEMS = problemsFile(STUDIO_HOME);
mkdirSync(LOGS, { recursive: true });
const log = (line) => { try { appendFileSync(join(LOGS, 'studio.log'), line); } catch { /* no log */ } };
const studioProblem = (step, what, code) => {
  recordProblem({ area: 'studio', step, what, code, version: app.getVersion() }, { file: STUDIO_PROBLEMS });
};

/* `openfilm://` links (deep-links.mjs): a page of openfilm.dev opens the app on what it names. Registered as the app
   that opens them (in development, this Electron with this app's folder); macOS sends one as `open-url`, even before
   the app is ready; Windows in the arguments, of this instance or of a second one */
const links = createLinks({
  send: (link) => {
    /* before the window and its page are made (the app opening on a link), it waits for the page to take it */
    try {
      const page = activeView();
      if (!page || page.webContents.isLoading()) return false;
      focusWindow();
      page.webContents.send('desktop:open-link', link);
      return true;
    } catch { return false; }
  },
});
if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [resolve(process.argv[1])]);
else app.setAsDefaultProtocolClient(PROTOCOL);
app.on('open-url', (event, url) => { event.preventDefault(); links.came(url); });
links.came(linkFromArgv(process.argv));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else if (mac && app.isPackaged && stepAside({ dir: DATA, version: app.getVersion(), bundleId: IDENTITY.bundleId, execPath: process.execPath, argv: process.argv })) {
  /* opened while the update quitting started is being installed: running now would stop it, so the new version opens
     when it is done (update-launch.mjs) */
  app.exit(0);
} else {
  app.on('second-instance', (_event, argv) => { focusWindow(); links.came(linkFromArgv(argv)); });
  app.whenReady().then(start).catch((error) => {
    console.error(error);
    app.exit(1);
  });
}

/** @type {BaseWindow | null} */
let win = null;
/** @type {ReturnType<typeof createTabs> | null} */
let tabs = null;
/** the page of each tab that has one (a tab left behind long enough has none until it is shown again) */
/** @type {Map<string, WebContentsView>} */
const views = new Map();
const unresponsivePages = new WeakSet();
let pagePresentation = null;
/** the page in front */
const activeView = () => views.get(pagePresentation?.currentId() ?? tabs?.activeId() ?? HOME) ?? null;
/** something every page is told (the theme, an update, the agents…) */
const broadcast = (channel, value) => { for (const v of views.values()) if (!v.webContents.isDestroyed()) v.webContents.send(channel, value); };
/** the tab whose page this is, or null */
const tabOf = (contents) => { for (const [id, v] of views) if (v.webContents === contents) return id; return null; };
/** a tab behind for this long lets its page go (it comes back when shown), unless an agent works in it or it exports */
const IDLE_PAGE_MS = 5 * 60_000;
/** How long the tabs of projects gone are gathered before they close together (several pages told at once). */
const GONE_TOGETHER_MS = 150;
/** @type {Awaited<ReturnType<typeof startWindowStudio>> | null} */
let studio = null;
let state = readWindowState(DATA);
let theme = 'dark';
/** whether Studio has ffmpeg: true, false, { state: 'downloading', progress } or { state: 'failed', message } (null: not known yet) */
let ffmpegFound = null;
/** ffmpeg is being downloaded (ffmpeg-runtime.mjs): Studio's "not found" at its start is not the last word */
let ffmpegFetching = false;
const tellFfmpeg = (state) => { ffmpegFound = state; broadcast('desktop:ffmpeg', state); };
/** @type {ReturnType<typeof startUpdates> | null} */
let updates = null;
let quitting = false;
let studioRestartsOnExit;
function markQuitting() {
  quitting = true;
  studioRestartsOnExit?.stop();
}
let cancelWindowClose = () => {};
/** @type {ReturnType<typeof registerLocalAgentIpc> | null} */
let localAgents = null;
/** @type {ReturnType<typeof createRoster> | null} */
let roster = null;
let agentCatalogs = null;
let agentUpdates = null;

/** the board Studio's panes sit on (its --bg-app), so the window never flashes another color */
const BACKGROUND = { light: '#e4e4e8', dark: '#141414' };

function focusWindow() {
  if (!win) return;
  cancelWindowClose();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Each page fills the window (only the one in front shows). */
function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  for (const v of views.values()) v.setBounds({ x: 0, y: 0, width, height });
}

function saveState() {
  if (!win) return;
  const maximized = win.isMaximized() || win.isFullScreen();
  state = { ...state, maximized, bounds: maximized ? state.bounds : win.getNormalBounds(), ...(tabs ? { tabs: tabs.saved() } : {}) };
  try { writeWindowState(DATA, state); } catch { /* kept until next time */ }
}

/** Links out of the page open in the person's browser; the page never navigates away from Studio. */
function guard(contents, allowed) {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (allowed(url)) return;
    event.preventDefault();
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

/** IPC only from a tab's page, its own main frame. */
const fromPage = (event) => tabOf(event.sender) != null && event.senderFrame === event.sender.mainFrame;

/** A page for a tab: Studio's editor at its project (or its launcher), on Studio's origin. */
function makeView(tabId) {
  const v = new WebContentsView({
    webPreferences: {
      preload: here('./preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      autoplayPolicy: 'no-user-gesture-required',
      devTools: !app.isPackaged,
    },
  });
  v.setBackgroundColor(BACKGROUND[theme]);
  // A newly attached view must not cover the current page with its initial blank frame.
  v.setVisible(false);
  views.set(tabId, v);
  win.contentView.addChildView(v);
  const { width, height } = win.getContentBounds();
  v.setBounds({ x: 0, y: 0, width, height });
  guard(v.webContents, (url) => Boolean(studio) && url.startsWith(`${studio.origin}/`));
  /* what went wrong with the page, for the log (logs/studio.log) */
  v.webContents.on('render-process-gone', (_event, { reason, exitCode }) => {
    if (reason === 'clean-exit' || quitting) return;
    const what = `Page renderer exited (${reason}, ${exitCode})`;
    log(`${new Date().toISOString()} ${what}\n`);
    studioProblem('page renderer', what, String(exitCode));
  });
  v.webContents.on('did-fail-load', (_event, code, description, url, mainFrame) => { if (mainFrame && code !== -3 && pagePresentation?.wantedId() === tabId) log(`page: ${description} (${code}) loading ${url.replace(/key=[^&]+/, 'key=…')}\n`); });
  v.webContents.on('unresponsive', () => { unresponsivePages.add(v); log('page: not responding\n'); });
  v.webContents.on('responsive', () => unresponsivePages.delete(v));
  /* the page gone (a crash): it comes back where it was; the agents' turns go on in this process meanwhile */
  v.webContents.on('render-process-gone', (_event, details) => { if (details.reason !== 'clean-exit' && !quitting) setTimeout(() => { if (!v.webContents.isDestroyed()) v.webContents.reload(); }, 500); });
  return v;
}

/** The page shown when no tab is open: Studio's projects (`/` with tabs). */
const HOME = 'home';
/** Where a tab's page opens: its project (no tab: the projects). */
const pageAddress = (tab, path = null) => `${studio.origin}/open?key=${studio.key}&to=${encodeURIComponent(path ?? (tab ? `/projects/${encodeURIComponent(tab.projectId)}` : '/'))}`;

/** Every page told of the tabs as they are now; kept for next time. */
function tellTabs() {
  if (!tabs) return;
  broadcast('desktop:tabs', tabs.list());
  saveState();
}

function presentation() {
  if (pagePresentation) return pagePresentation;
  const frameOptions = id => ({ readySelector: id === HOME ? '[data-titlebar]' : `[data-project-tab="${id}"], [data-page-ready="error"]` });
  const stage = (id, v, paint) => {
    // Restoring a hidden NSView invalidates its old surface. Refresh it underneath the outgoing page first.
    win.contentView.addChildView(v, 0);
    v.setVisible(true);
    v.webContents.setBackgroundThrottling(false);
    if (win.isFocused()) syncPagePointer(v.webContents, screen.getCursorScreenPoint(), win.getContentBounds());
    const settle = (failed = false) => {
      if (v.webContents.isDestroyed()) return;
      const current = pagePresentation?.currentId() === id;
      if (failed || current || pagePresentation?.wantedId() !== id) v.webContents.setBackgroundThrottling(true);
      if (!current && (failed || pagePresentation?.wantedId() !== id)) v.setVisible(false);
    };
    // Keep the destination painting until present() raises it; throttling it while still occluded can invalidate
    // the refreshed surface again. Obsolete/failed requests go back to sleep without ever being exposed.
    return paint().then(value => { settle(); return value; }, error => { settle(true); throw error; });
  };
  return pagePresentation ??= createPagePresentation({
    fallback: HOME,
    prepare(id) {
      const v = makeView(id);
      const url = pageAddress(id === HOME ? null : tabs?.get(id));
      // A covered Windows view can stop drawing. Load its document and let it paint after it is raised.
      const ready = windows
        ? preparePage(v.webContents, url, { waitForPaint: false })
        : stage(id, v, () => preparePage(v.webContents, url, frameOptions(id)));
      return { view: v, ready };
    },
    resume: windows ? undefined : (id, v) => stage(id, v, () => paintPage(v.webContents, frameOptions(id))),
    canKeep: v => !unresponsivePages.has(v) && !v.webContents.isDestroyed() && !v.webContents.isCrashed(),
    present(id, v) {
      if (!win) return;
      revealPage(win.contentView, v, views.values());
      if (!windows) v.webContents.setBackgroundThrottling(true);
      tabs?.activate(id === HOME ? null : id);
      tellTabs();
      /* the pages now behind it are told: one waiting to be covered (its projects window opening another tab) is done */
      for (const page of views.values()) if (page !== v && !page.webContents.isDestroyed()) page.webContents.send('desktop:tabs:covered');
    },
    discard: destroyView,
    onError: reportPageFailure,
  });
}

let pageFailureDialog = null;
function reportPageFailure(error, id, retained) {
  if (quitting || !win) return;
  log(`page: could not prepare replacement (${String(error.message).replace(/key=[^&\s)]+/g, 'key=…')})\n`);
  if (retained) {
    tabs?.activate(retained === HOME ? null : retained);
    tellTabs();
  }
  // A native message is visible even if the editor has stopped processing events.
  // If Projects also fails, expose a way to retry even when there is no usable page.
  if (id === HOME && !retained) {
    if (pageFailureDialog) pageFailureDialog.abort();
  } else if (pageFailureDialog) return;
  const controller = new AbortController();
  pageFailureDialog = controller;
  const retry = id === HOME && !retained;
  const language = appLanguage(state.language, app.getPreferredSystemLanguages());
  const [message, detail, tryAgain, dismiss] = PAGE_FAILURE_WORDS[language] ?? PAGE_FAILURE_WORDS.en;
  // A window-owned sheet lets the main process continue preparing the fallback.
  void dialog.showMessageBox(win, {
    type: 'warning', title: PRODUCT_NAME, message, detail, signal: controller.signal,
    buttons: retry ? [tryAgain, dismiss] : [dismiss], cancelId: retry ? 1 : 0,
  }).then(({ response }) => {
    if (retry && response === 0 && !quitting && pagePresentation?.wantedId() === HOME && pagePresentation.currentId() !== HOME) void showPage(HOME);
  }).catch(error => log(`page: could not show recovery dialog (${error.message})\n`)).finally(() => {
    if (pageFailureDialog === controller) pageFailureDialog = null;
  });
}

/** Keep only the lightweight projects page ready, without focusing it. */
function warmHome() {
  if (!tabs || !win || quitting) return;
  void presentation().warm(HOME);
}

/** A ready page replaces the old frame; a cold page is prepared before it covers it. */
function showPage(id) {
  if (!win || !studio) return Promise.resolve(false);
  return presentation().show(id).then((shown) => { if (shown && id !== HOME) warmHome(); return shown; });
}

/** Bring a tab to the front. */
function showTab(id) {
  if (!tabs || !tabs.activate(id)) return;
  showPage(id);
  tellTabs();
}

/** A project's tab (in front if it is open already). */
function newTab(projectId) {
  if (!tabs || typeof projectId !== 'string' || !projectId) return;
  showTab(tabs.open({ projectId }).id);
}

/** Let a tab's page go: closed, or behind too long (the tab stays). */
function destroyView(id) {
  const v = views.get(id);
  if (!v) return;
  views.delete(id);
  win?.contentView.removeChildView(v);
  if (!v.webContents.isDestroyed()) v.webContents.close();
}

function dropView(id) { if (pagePresentation) pagePresentation.drop(id); else destroyView(id); }

/** Close a tab; one whose agent is still at work, only once the person says so. */
async function closeTab(id) {
  if (!tabs || !win) return;
  const tab = tabs.get(id);
  if (!tab) return;
  if (tab.working) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Close Tab', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'An agent is still working in this project.', detail: 'Closing the tab stops it.',
    });
    if (response !== 0) return;
  }
  const next = tabs.close(id);
  presentation().retire(id);
  if (next) showTab(next.id);
  else { showPage(HOME); tellTabs(); }
}

/**
 * Projects gone (deleted, here or elsewhere; their folders gone): their tabs close without asking, all those told within
 * a moment together, so the front never lands on a tab about to close, and none can be opened again (tabs.mjs
 * `closeProjects`). Each page of such a project says so, and the page that deleted them says which.
 */
const goneProjects = new Set();
let goneTimer = /** @type {NodeJS.Timeout | null} */ (null);
function projectsGone(/** @type {string[]} */ projectIds) {
  for (const id of projectIds) if (typeof id === 'string' && id) goneProjects.add(id);
  if (!goneTimer) goneTimer = setTimeout(closeGoneTabs, GONE_TOGETHER_MS);
}
function closeGoneTabs() {
  goneTimer = null;
  const ids = [...goneProjects];
  goneProjects.clear();
  if (!tabs || !win || !ids.length) return;
  const { closed, front } = tabs.closeProjects(ids);
  if (!closed.length) return;
  for (const id of closed) presentation().retire(id);
  if (front) showTab(front.id);
  else { showPage(HOME); tellTabs(); }
}

/**
 * Studio's "open this project" (`openfilm open`, File › Open Project…), heard by every page at once: once only. Its
 * tab comes to the front, opened if it is not.
 */
let lastOpen = { to: '', at: 0 };
function openInTabs(to) {
  if (!tabs || typeof to !== 'string') return;
  if (to === lastOpen.to && Date.now() - lastOpen.at < 2000) return;
  lastOpen = { to, at: Date.now() };
  const projectId = /^\/projects\/([\w-]+)/.exec(to)?.[1] ?? null;
  if (projectId) newTab(projectId);
}

/**
 * The tabs open when the window opens: those left last time (none, when the last were closed: the projects), else, the
 * first time, the last project's; none: the projects.
 */
async function openTabs() {
  const listed = (await studioApi('/api/projects').catch(() => null))?.projects;
  const projects = listed?.filter((p) => !projectGone(listed, p.id)) ?? [];
  tabs = createTabs({ saved: state.tabs ?? null });
  /* A failed project-list request leaves the saved tabs available for another try. */
  if (listed) {
    const known = new Set(projects.map((p) => p.id));
    tabs.closeProjects(tabs.list().map((t) => t.projectId).filter((id) => !known.has(id)));
  }
  if (!tabs.list().length && !state.tabs && projects[0]) tabs.open({ projectId: projects[0].id, title: projects[0].name });
  const front = tabs.activeId();
  if (front) showTab(front);
  else { showPage(HOME); tellTabs(); }
}

/** The projects the chat's agents work in, and wait for an answer in, by Studio's ids (from their folders), on each tab. */
let projectPaths = new Map();
const agentFolders = { working: /** @type {string[]} */ ([]), asking: /** @type {string[]} */ ([]) };
async function tellTabsWorking({ working = agentFolders.working, asking = agentFolders.asking } = {}) {
  Object.assign(agentFolders, { working, asking });
  if (!tabs) return;
  if ([...working, ...asking].some((f) => !projectPaths.has(f))) {
    projectPaths = new Map((await studioApi('/api/projects').catch(() => ({ projects: [] }))).projects.map((p) => [p.path, p.id]));
  }
  const ids = (folders) => folders.map((f) => projectPaths.get(f)).filter(Boolean);
  if (tabs.setAgents(ids(agentFolders.working), ids(agentFolders.asking))) tellTabs();
}

async function studioApi(path, method = 'GET', body = undefined, signal = undefined) {
  const res = await fetch(`${studio.origin}${path}`, {
    method,
    signal,
    headers: { 'x-studio-key': studio.key, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Studio answered ${res.status}`);
  return res.json();
}

/** A report the main process can copy without calling the Studio utility or an agent. */
function offlineStudioReport() {
  let recent;
  try {
    recent = recentProblems({ file: STUDIO_PROBLEMS, days: 7 }).filter((p) => p.area === 'studio').slice(-12).map(problemLine);
  } catch {
    recent = ['The local problem log could not be read.'];
  }
  return [
    `OpenFilm ${app.getVersion()} (${FLAVOR}) · ${process.platform} ${process.arch} · Electron ${process.versions.electron}`,
    `Report copied at ${new Date().toISOString()}`,
    `Studio utility process: ${studio?.child.pid == null ? 'not running' : 'present'}`,
    '',
    'Recent Studio problems:',
    ...(recent.length ? recent : ['No Studio problems recorded in the last 7 days.']),
  ].join('\n');
}

/**
 * A folder picked by the person (null: cancelled): with no options, one to open as a project (any folder: one not yet
 * a project becomes one); with Studio's own words and starting folder, any other (see folder-dialog.mjs).
 */
async function pickFolder(options) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, folderDialogOptions(options));
  return canceled || !filePaths[0] ? null : filePaths[0];
}

/** File › Open Project…: the folder picked, shown in the window (Studio switches its pages to it). */
async function openProjectFolder() {
  const folder = await pickFolder();
  if (!folder || !studio) return;
  try {
    await studioApi('/api/open', 'POST', { path: folder, fallback: 0 });
    focusWindow();
  } catch (error) {
    void dialog.showMessageBox(win, { type: 'warning', message: 'This folder can’t be opened as a project.', detail: error.message });
  }
}

/** What the app asks before an agent changes something in a connected service (connectors.mjs `confirm`). */
const CONNECTOR_ASK = {
  en: { message: 'Let the agent use “{tool}” in {name}?', detail: 'It may change what you have in {name}.', once: 'Allow once', always: 'Allow while OpenFilm is open', no: 'Don’t allow' },
  'zh-CN': { message: '允许智能体在 {name} 里使用「{tool}」吗？', detail: '这会改动你在 {name} 里的内容。', once: '允许一次', always: '本次打开期间都允许', no: '不允许' },
  ja: { message: 'エージェントに {name} の「{tool}」を使わせますか？', detail: '{name} の中身が変わることがあります。', once: '今回だけ許可', always: 'OpenFilm を開いている間は許可', no: '許可しない' },
  ko: { message: '에이전트가 {name}에서 「{tool}」을(를) 쓰도록 허용할까요?', detail: '{name}에 있는 내용이 바뀔 수 있습니다.', once: '이번만 허용', always: 'OpenFilm이 열려 있는 동안 허용', no: '허용 안 함' },
  es: { message: '¿Dejar que el agente use «{tool}» en {name}?', detail: 'Puede cambiar lo que tienes en {name}.', once: 'Permitir una vez', always: 'Permitir mientras OpenFilm esté abierto', no: 'No permitir' },
};

/* the own key, sealed with the system's keychain where there is one (macOS Keychain, Windows DPAPI) */
const seal = (text) => (safeStorage.isEncryptionAvailable() ? Buffer.concat([Buffer.from('enc:'), safeStorage.encryptString(text)]) : Buffer.from(`raw:${text}`));
const unseal = (data) => {
  const kind = data.subarray(0, 4).toString();
  return kind === 'enc:' ? safeStorage.decryptString(data.subarray(4)) : data.subarray(4).toString();
};

/** The page's theme (Studio's), for the window behind it and the system's menus and dialogs. */
function setTheme(next) {
  theme = next === 'dark' ? 'dark' : 'light';
  nativeTheme.themeSource = theme;
  win?.setBackgroundColor(BACKGROUND[theme]);
  for (const v of views.values()) v.setBackgroundColor(BACKGROUND[theme]);
  if (windows) win?.setTitleBarOverlay?.(overlayColours(theme));
}

/** the notifications shown and not yet clicked or closed: one let go is garbage collected, and its click lost (macOS) */
const notices = new Set();
/** how many of them a long session keeps: an older one is closed, in Notification Center and Action Center too */
const NOTICES_KEPT = 20;

/**
 * A turn of the chat's done, stopped by an error, or waiting for the person's answer: a notification of the system's,
 * while the window is not in front and Settings › Advanced has them on (turn-notices.mjs). Clicking it brings the
 * window back on that project's tab. The taskbar button flashes (Windows), the Dock icon bounces once (macOS).
 * @param {{ kind: 'done' | 'failed' | 'asking', agent: string, cwd: string, meta: any, error?: string }} turn
 */
async function noticeTurn({ kind, agent, cwd, meta, error }) {
  if (!win || quitting || !Notification.isSupported()) return;
  const project = typeof meta?.projectTitle === 'string' && meta.projectTitle ? meta.projectTitle : basename(cwd);
  const notice = turnNotice(kind, {
    project, agent: agent === 'byok' ? null : AGENTS[agent]?.label ?? agent, error, inFront: win.isFocused() && win.isVisible(),
    on: readPreferences(DATA).notify, language: appLanguage(state.language, app.getPreferredSystemLanguages()),
  });
  if (!notice) return;
  const shown = new Notification({ title: notice.title, body: notice.body });
  const done = () => notices.delete(shown);
  shown.on('click', () => {
    done();
    focusWindow();
    void (async () => {
      if (!projectPaths.has(cwd)) projectPaths = new Map((await studioApi('/api/projects').catch(() => ({ projects: [] }))).projects.map((p) => [p.path, p.id]));
      newTab(projectPaths.get(cwd));
    })();
  });
  shown.on('close', done);
  notices.add(shown);
  for (const old of notices) { if (notices.size <= NOTICES_KEPT) break; notices.delete(old); old.close(); }
  shown.show();
  if (windows) win.flashFrame(true);
  else app.dock?.bounce('informational');
}

/** Tell Studio which folders the chat's agents are working in now. */
function tellWorking(/** @type {string[]} */ folders) {
  if (studio?.child.pid != null) studio.child.postMessage({ type: 'working', folders });
  void tellTabsWorking({ working: folders });
}

/** Studio's questions for the person's agent that are being answered, by id: each stops with its controller. */
const asked = new Map();

/**
 * Studio asks an agent a question of its own. Canvas writing names its model; other requests use the chat's last
 * agent or the first one ready in Settings → Agents. None ready:
 * `code: 'no-agent'`, so Studio says to connect one.
 * @type {import('./studio.mjs').AskHandler}
 */
function answerStudio(message, reply) {
  if (message.type === 'ask-cancel') { asked.get(message.id)?.abort(); return; }
  const ready = (roster?.list() ?? []).filter((a) => a.status === 'ready').map((a) => a.id);
  const last = localAgents?.lastAgent();
  const agent = message.model?.agent ?? (last && ready.includes(last) ? last : ready[0]);
  if (!agent || !ready.includes(agent) || !localAgents) { reply({ type: 'answer', id: message.id, error: 'No agent is connected.', code: 'no-agent' }); return; }
  const stop = new AbortController();
  asked.set(message.id, stop);
  /* asked for as it comes (a note being written): each piece of the answer sent on its own */
  const onText = message.stream ? (delta) => reply({ type: 'answer-part', id: message.id, delta }) : undefined;
  localAgents.ask(agent, String(message.text ?? ''), stop.signal, message.model?.options, message.images, onText)
    .then((text) => reply({ type: 'answer', id: message.id, text }))
    .catch((error) => { if (!stop.signal.aborted) reply({ type: 'answer', id: message.id, error: error?.message ?? String(error), ...(error?.code ? { code: String(error.code) } : {}) }); })
    .finally(() => asked.delete(message.id));
}

/** Studio's own key and the vault of the person's service keys, opened from the keychain once (studio-secrets.mjs) */
let secrets;

async function runStudio(env) {
  if (quitting) return;
  if (secrets === undefined) secrets = studioSecrets({ dataDir: DATA, available: safeStorage.isEncryptionAvailable(), seal, unseal, log });
  let startedAt;
  const next = await startWindowStudio({
    secrets,
    onAsk: answerStudio,
    /* a project renamed: the chat's agents between turns in its folder stop (their next turn resumes them) */
    onRelease: (folder) => localAgents?.release(folder),
    home: env.OPENFILM_HOME,
    port: IDENTITY.studioPort,
    /* Studio serves the window's page as its editor (shell/: its editor with the chat beside it) */
    /* its diagnostic file takes the app's own logs too (Studio's diagnostics.mjs) */
    env: { ...env, OPENFILM_EDITOR_DIR: here('../shell/dist/'), OPENFILM_APP_LOGS: LOGS },
    log,
    onOpen: (url) => {
      /* Studio would open a browser for an address of its own: the window already shows Studio */
      if (studio && url.startsWith(studio.origin)) focusWindow();
      else if (/^https?:/i.test(url)) void shell.openExternal(url);
    },
    onBrowser: (message) => {
      if (message.type === 'ffmpeg') { if (!ffmpegFetching) tellFfmpeg(message.found); }
      else broadcast('desktop:studio-browser', message);
    },
    onExit: (code) => {
      if (quitting) return;
      const what = `Studio process exited (${code})`;
      log(`${new Date().toISOString()} ${what}\n`);
      studioProblem('utility process', what, String(code));
      studioRestartsOnExit.afterExit(startedAt ? Date.now() - startedAt : 0);
    },
  });
  if (quitting) { await next.quit(); return; }
  startedAt = Date.now();
  studio = next;
  /* a Studio started again hears where the agents are working */
  tellWorking(localAgents?.working() ?? []);
  /* the first time, the tabs; a Studio started again: each page stays where it was */
  if (!tabs) { await openTabs(); return; }
  for (const [id, v] of views) {
    const page = v.webContents;
    if (page.isDestroyed()) continue;
    const at = page.getURL();
    /* A tab may close or navigate during recovery. Each remaining tab still gets the new Studio address. */
    void page.loadURL(pageAddress(tabs.get(id), at.startsWith('http') ? new URL(at).pathname : null)).catch(() => {});
  }
}

/** The desktop owns Studio. Its quit-when-idle endpoint reports work without shutting it down. */
async function studioBusy() {
  if (!studio) return false;
  const res = await fetch(`${studio.origin}/api/quit`, {
    method: 'POST', headers: { 'x-studio-key': studio.key, 'content-type': 'application/json' },
    body: JSON.stringify({ whenIdle: true }), signal: AbortSignal.timeout(3000),
  });
  return res.status === 409;
}

async function start() {
  /* updates (updates.mjs): Restart waits while an agent's turn runs or Studio exports, either would be lost */
  updates = startUpdates({
    dataDir: DATA,
    productName: PRODUCT_NAME,
    getWindow: () => win,
    onState: (next) => broadcast('desktop:update', next),
    prepareRestart: async () => {
      if (localAgents?.isBusy()) return { ok: false, error: 'agent-busy' };
      return await studioBusy().catch(() => false) ? { ok: false, error: 'exporting' } : { ok: true };
    },
    /* what before-quit would do, done first (`quitting`), so the quit Squirrel starts is not held up or cancelled */
    beforeInstall: async () => {
      markQuitting();
      agentCatalogs?.close();
      localAgents?.closeAll();
      closeEverySession();
      for (const v of views.values()) v.webContents.on('will-prevent-unload', (event) => event.preventDefault());
      await studio?.quit();
      updates?.close();
    },
  });
  /* an update quitting did not install is installed now, before anything else opens (update-launch.mjs) */
  const launch = await updates.installAtLaunch({ language: state.language });
  if (launch.installing) return;
  /* Windows' registered apps, read from now on: the first look at the agents and a conversation reopened at once wait for them */
  if (windows) void firstWindowsApps();

  const shellEnv = await loginShellEnvironment();
  const env = childEnvironment({
    shell: shellEnv,
    extra: {
      OPENFILM_HOME: STUDIO_HOME,
      ...(app.isPackaged ? { OPENFILM_INSTALL_DIR: mac ? dirname(dirname(process.resourcesPath)) : dirname(process.execPath) } : {}),
      ...(FLAVOR !== 'release' ? { OPENFILM_ACCOUNT_DEVICE: PRODUCT_NAME } : {}),
      ...((IDENTITY.library ?? process.env.OPENFILM_LIBRARY) ? { OPENFILM_LIBRARY: IDENTITY.library ?? process.env.OPENFILM_LIBRARY } : {}),
      /* a flavour with a home of its own still shares the person's library (src/locations.mjs) */
      ...(IDENTITY.sharedHome ? { OPENFILM_SHARED_HOME: IDENTITY.sharedHome } : {}),
      /* the app names Studio's home, which would put exports inside it (Studio's rule for a home kept apart): the
         Desktop, where `openfilm` puts them, unless this is a flavour with a home of its own */
      ...(IDENTITY.studioHome || process.env.OPENFILM_EXPORTS ? {} : { OPENFILM_EXPORTS: app.getPath('desktop') }),
      /* another examples index (a file, to try one), passed through when run from source */
      ...(process.env.OPENFILM_EXAMPLES_INDEX ? { OPENFILM_EXAMPLES_INDEX: process.env.OPENFILM_EXAMPLES_INDEX } : {}),
      /* another Community library catalog (a local build or the preview channel, to try one), passed through when run from source */
      ...(process.env.OPENFILM_COMMUNITY_LIBRARY_URL ? { OPENFILM_COMMUNITY_LIBRARY_URL: process.env.OPENFILM_COMMUNITY_LIBRARY_URL } : {}),
      /* another OpenFilm service (a local one, to develop it), passed through when run from source */
      ...(process.env.OPENFILM_API_URL ? { OPENFILM_API_URL: process.env.OPENFILM_API_URL } : {}),
    },
  });


  /* what the installer brings (scripts/release.mjs): ffmpeg and ffprobe, first on the PATH of Studio and of the
     agents' `openfilm` command, and the headless browser Studio and `openfilm` draw pages in. A build without them
     (from source): no ffmpeg on this computer, the app's own goes first on the PATH and is downloaded once the window
     is up (they find it the moment it lands); the browser, Studio downloads the first time (studio-process.mjs) */
  const runtime = app.isPackaged ? join(process.resourcesPath, 'runtime') : null;
  const ownFfmpeg = runtime && ffmpegIn(join(runtime, 'ffmpeg')) ? join(runtime, 'ffmpeg') : null;
  const needFfmpeg = !ownFfmpeg && !ffmpegOnPath(env.PATH) && ffmpegDownloadable();
  const ffmpegHere = ownFfmpeg ?? (needFfmpeg ? ffmpegDir(DATA) : null);
  if (ffmpegHere) env.PATH = [ffmpegHere, env.PATH].join(PATH_SEP);
  const browsers = runtime && existsSync(join(runtime, 'ms-playwright')) ? { PLAYWRIGHT_BROWSERS_PATH: join(runtime, 'ms-playwright') } : {};
  Object.assign(env, browsers);

  const display = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1480, display.width);
  const height = Math.min(920, display.height);
  const fallback = { x: display.x + Math.round((display.width - width) / 2), y: display.y + Math.round((display.height - height) / 2), width, height };
  const bounds = placeOnDisplays(state.bounds, screen.getAllDisplays(), fallback);

  win = new BaseWindow({
    ...bounds,
    minWidth: WINDOW_MIN.width,
    minHeight: WINDOW_MIN.height,
    show: false,
    title: PRODUCT_NAME,
    backgroundColor: BACKGROUND[theme],
    ...(mac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 10 } } : {}),
    /* Windows: no title bar either; its own buttons drawn over Studio's top bar, at its right, in its colors */
    ...(windows ? { titleBarStyle: 'hidden', titleBarOverlay: overlayColours(theme), autoHideMenuBar: true, icon: here('../build/icon.png') } : {}),
  });
  if (state.maximized) win.maximize();
  launch.dismiss();

  win.on('resize', layout);
  /* the taskbar button a turn's notification set flashing (noticeTurn) stops once the window is in front */
  if (windows) win.on('focus', () => win?.flashFrame(false));
  win.on('resized', saveState);
  win.on('moved', saveState);
  win.on('enter-full-screen', () => broadcast('desktop:full-screen', true));
  win.on('leave-full-screen', () => broadcast('desktop:full-screen', false));
  cancelWindowClose = keepWindowOnClose(win, {
    mac, isQuitting: () => quitting, save: saveState,
    ...(windows ? { shouldMinimize: async () => Boolean(localAgents?.isBusy()) || await studioBusy() } : {}),
  });
  win.on('closed', () => { win = null; views.clear(); pagePresentation = null; app.quit(); });

  ipcMain.on('desktop:theme', (event, next) => { if (fromPage(event)) setTheme(next); });
  /* the page's language, kept for what the app shows before a page is up (the update installed at launch), and
     the menu bar's (showMenu) */
  let menuLanguage = null;
  ipcMain.on('desktop:language', (event, next) => {
    if (!fromPage(event) || typeof next !== 'string' || next === state.language) return;
    state = { ...state, language: next.slice(0, 20) };
    try { writeWindowState(DATA, state); } catch { /* kept until next time */ }
    showMenu();
  });
  /* the page is up and takes the link that opened the app, if one did (deep-links.mjs) */
  ipcMain.handle('desktop:take-link', (event) => (fromPage(event) ? links.take() : null));
  ipcMain.handle('desktop:hello', (event) => {
    if (!fromPage(event)) throw new Error('not the window\'s page');
    return { flavor: FLAVOR, version: app.getVersion(), ffmpeg: ffmpegFound, update: updates?.snapshot() ?? null, chatOpen: state.chatOpen, chatWidth: state.chatWidth, chatMin: CHAT_MIN, studioMin: STUDIO_MIN, fullScreen: Boolean(win?.isFullScreen()) };
  });
  /* the chat's column as the person left it (the page sizes it; the window keeps it for next time) */
  ipcMain.on('desktop:layout', (event, next) => {
    if (!fromPage(event) || !next || typeof next !== 'object') return;
    const width = Number(next.chatWidth);
    state = { ...state, chatOpen: next.chatOpen === true, ...(Number.isFinite(width) ? { chatWidth: Math.max(CHAT_MIN, Math.round(width)) } : {}) };
    saveState();
  });
  /* the chat's record of each project (in the project's .film/chat and .film/logs) and the app's own preferences */
  registerChatIpc(ipcMain, {
    trusted: fromPage,
    projects: async () => { const { projects } = await studioApi('/api/projects'); return projects.filter((p) => !projectGone(projects, p.id)).map((p) => p.path); },
    dataDir: DATA,
    reveal: (path) => shell.showItemInFolder(path),
    trash: (path) => shell.trashItem(path),
    tell: (channel, value) => broadcast(channel, value),
    log,
    filmPutBack: async (dir, done = false) => {
      const { projects } = await studioApi('/api/projects');
      const found = projects.find((p) => p.path === dir);
      if (found) await studioApi(`/api/projects/${encodeURIComponent(found.id)}/history/put-back${done ? '/done' : ''}`, 'POST');
    },
  });
  /* the tabs, drawn by each page in Studio's top bar: asked for, and told of every change (tellTabs) */
  const tabHandle = (channel, fn) => ipcMain.handle(channel, (event, opts) => {
    if (!fromPage(event)) throw new Error('not the window\'s page');
    return fn(tabOf(event.sender), opts ?? {});
  });
  tabHandle('desktop:tabs:list', (self) => ({ self, tabs: tabs?.list() ?? [] }));
  tabHandle('desktop:tabs:new', (_self, { projectId }) => { newTab(projectId); return { ok: true }; });
  tabHandle('desktop:tabs:show', (_self, { id }) => { showTab(String(id)); return { ok: true }; });
  tabHandle('desktop:tabs:close', (self, { id }) => { void closeTab(typeof id === 'string' ? id : self); return { ok: true }; });
  tabHandle('desktop:tabs:move', (_self, { id, index }) => { if (tabs?.move(String(id), Number(index))) tellTabs(); return { ok: true }; });
  /* what a page shows now: its project's title, an export's progress; or its project gone */
  tabHandle('desktop:tabs:report', (self, { title, exporting, exportStage, generating, gone }) => {
    if (!tabs) return { ok: false };
    /* its project gone (deleted, in this page or another; its folder gone): its tab closes, without asking. Asked of
       Studio first: a tab closed stops its agent, and a project missing only film.html is not gone (tabs.mjs projectGone) */
    if (gone === true) {
      const tab = tabs.get(self);
      if (tab) {
        void studioApi('/api/projects').then(({ projects }) => { if (projectGone(projects, tab.projectId)) projectsGone([tab.projectId]); }, () => {});
      }
      return { ok: true };
    }
    tabs.report(self, {
      ...(typeof title === 'string' ? { title: title.slice(0, 200) } : {}),
      ...(exporting !== undefined ? { exporting: Number.isFinite(exporting) ? exporting : null } : {}),
      ...(exportStage !== undefined ? { exportStage: typeof exportStage === 'string' ? exportStage.slice(0, 120) : null } : {}),
      ...(typeof generating === 'boolean' ? { generating } : {}),
    });
    tellTabs();
    return { ok: true };
  });
  /* projects this page deleted: their tabs close together (projectsGone) */
  tabHandle('desktop:tabs:gone', (_self, { projectIds }) => {
    if (Array.isArray(projectIds)) projectsGone(projectIds.filter((id) => typeof id === 'string'));
    return { ok: true };
  });
  /* another tab's project renamed from this page's tabs: its title, also while that tab has no page to say it */
  tabHandle('desktop:tabs:retitle', (_self, { id, title }) => {
    if (typeof title === 'string' && tabs?.report(String(id), { title: title.slice(0, 200) })) tellTabs();
    return { ok: true };
  });
  /* Studio's "open this project", heard by each page: settled once here */
  tabHandle('desktop:tabs:open', (_self, { to }) => { openInTabs(to); return { ok: true }; });
  /* a tab left behind long enough lets its page go; it comes back when shown */
  setInterval(() => { for (const id of tabs?.idle(IDLE_PAGE_MS) ?? []) dropView(id); }, 60_000).unref?.();

  /* the agents: Studio's home and library go with them, so the `openfilm` they run finds this window's Studio */
  /* the person's own skills: Skills/ beside this app's projects (~/Movies/OpenFilm/Skills), as its `openfilm` finds them */
  /* which official skills are installed and which skills are off: the prefs.json every OpenFilm here shares (openfilm/skills usableSkills) */
  const prefsHome = env.OPENFILM_SHARED_HOME || env.OPENFILM_HOME;
  const mySkills = process.env.OPENFILM_SKILLS || (env.OPENFILM_LIBRARY ? join(dirname(env.OPENFILM_LIBRARY), 'Skills') : (await import('openfilm/skills')).mySkillsDir());
  /* every connector there is (openfilm/plugins: a plugin with a .mcp.json), by its first remote server */
  const connectors = createConnectors({
    dataDir: DATA, seal, unseal, log: (line) => log(`${line}\n`),
    openExternal: (url) => shell.openExternal(url),
    defs: async () => (await import('openfilm/plugins')).pluginStates(prefsHome).flatMap((p) => {
      const remote = Object.values(p.mcpServers ?? {}).find((server) => server.type === 'http');
      return remote ? [{ id: p.id, title: p.title?.en ?? p.id, url: remote.url }] : [];
    }),
    onChange: () => { void connectors.states().then((states) => broadcast('desktop:connectors', states)); },
    /* a tool that may change something in the service: the person says first, whatever the agent */
    confirm: async ({ title, toolTitle, input }) => {
      const words = CONNECTOR_ASK[appLanguage(state.language, app.getPreferredSystemLanguages())] ?? CONNECTOR_ASK.en;
      const fill = (text) => text.replaceAll('{name}', title).replaceAll('{tool}', toolTitle);
      const shown = JSON.stringify(input, null, 1);
      const { response } = await dialog.showMessageBox(win, {
        type: 'question', title: PRODUCT_NAME, message: fill(words.message),
        detail: `${fill(words.detail)}${shown && shown !== '{}' ? `\n\n${shown.length > 700 ? `${shown.slice(0, 700)}…` : shown}` : ''}`,
        buttons: [words.once, words.always, words.no], defaultId: 0, cancelId: 2, noLink: true,
      });
      return response === 0 ? 'once' : response === 1 ? 'always' : 'no';
    },
  });
  app.on('will-quit', () => { void connectors.close(); });
  localAgents = registerLocalAgentIpc(ipcMain, {
    trusted: fromPage,
    log,
    /* Studio refuses to delete a project an agent is working in */
    onWorking: tellWorking,
    /* a tab says when its agent waits for the person's answer */
    onAsking: (folders) => void tellTabsWorking({ asking: folders }),
    /* a turn done, stopped or waiting, told by the system while the window is not in front */
    onTurn: (turn) => void noticeTurn(turn),
    onConnectionResult: (id, error) => roster?.recordConnectionResult(id, error),
    isAgentUpdating: (id) => agentUpdates?.state(id).status === 'updating',
    /* the `openfilm` command first (with the app's ffmpeg and browser in it); the app's ffmpeg last, for a computer
       that has none of its own: the person's own ffmpeg and browsers are what the agent's commands use */
    binDir: installOpenfilmCommand(DATA, { ffmpeg: ffmpegHere, env: {
      ...browsers,
      ...(env.OPENFILM_INSTALL_DIR ? { OPENFILM_INSTALL_DIR: env.OPENFILM_INSTALL_DIR } : {}),
    } }),
    fallbackDir: ffmpegHere,
    env: {
      OPENFILM_HOME: env.OPENFILM_HOME,
      ...(env.OPENFILM_INSTALL_DIR ? { OPENFILM_INSTALL_DIR: env.OPENFILM_INSTALL_DIR } : {}),
      ...(env.OPENFILM_API_URL ? { OPENFILM_API_URL: env.OPENFILM_API_URL } : {}),
      ...(env.OPENFILM_LIBRARY ? { OPENFILM_LIBRARY: env.OPENFILM_LIBRARY } : {}),
      ...(env.OPENFILM_SHARED_HOME ? { OPENFILM_SHARED_HOME: env.OPENFILM_SHARED_HOME } : {}),
    },
    harness: async (id) => roster?.harness(id) ?? null,
    /* Developer mode: an agent whose own record lacks what its model got logs it here (agent-logs.mjs) */
    logDir: () => (readPreferences(DATA).developer ? join(DATA, 'agent-logs') : null),
    /* each session's skills: its maker's, OpenFilm's, and of the person's own those let in (agent-skills.mjs) */
    skills: { dataDir: DATA, mine: mySkills, prefsHome, connectorsFor: (servers) => connectors.forSession(servers) },
  });
  /* the connectors: signed in here once, reached by every agent at their doors (connectors.mjs) */
  registerConnectorsIpc(ipcMain, connectors, { trusted: fromPage, log });
  /* the composer's Skills button */
  registerSkillsIpc(ipcMain, {
    trusted: fromPage,
    projects: async () => { const { projects } = await studioApi('/api/projects'); return projects.filter((p) => !projectGone(projects, p.id)).map((p) => p.path); },
    dataDir: DATA,
    mine: mySkills,
    prefsHome,
    oldMine: join(env.OPENFILM_HOME, 'skills'),
    reveal: (path) => { void shell.openPath(path); },
    pickFolder: (words) => pickFolder(words),
    refreshSkills: (agent) => localAgents?.refreshSkills(agent),
    log,
  });
  /* Settings → Agents (in Studio's page) and the chat's agent menu: one roster, both told of every change */
  const openfilmAgent = createOpenFilmAgent({
    dataDir: DATA,
    readAccount: (options) => studio.readAccount(options),
    signIn: () => studioApi('/api/providers/openfilm/sign-in', 'POST'),
    cancelSignIn: () => studioApi('/api/providers/openfilm/sign-in/cancel', 'POST'),
    signOut: () => studioApi('/api/providers/openfilm/key', 'DELETE'),
    closeSessions: () => localAgents?.closeAgent('openfilm'),
    refreshSessions: () => localAgents?.refreshSkills('openfilm'),
    onChange: () => { if (roster) broadcast('desktop:agents', roster.list()); },
  });
  // Services and Agents may both change the account. Read the shared state even when its settings page is closed.
  setInterval(() => { void openfilmAgent.refresh(); }, 2000).unref();
  agentCatalogs = createAgentCatalogs({
    dataDir: DATA,
    openSession: (id, onOptions) => localAgents.openProbeSession(id, onOptions),
    onUpdated: (id) => localAgents.refreshSkills(id),
    onChange: () => { if (roster) broadcast('desktop:agents', roster.list()); },
  });
  setInterval(() => agentCatalogs.refreshDue(), 30_000).unref();
  roster = createRoster({
    openfilm: openfilmAgent,
    dataDir: DATA,
    catalog: (id) => agentCatalogs.state(id),
    updateState: (id) => agentUpdates?.state(id),
    localAgents: listAgents,
    localAgent,
    openSignIn: (id) => openAgentSignIn(id, { track: true }),
    /* Switch account: its own sign-out, with no window, before its sign-in */
    signOut: signOutAgent,
    /* an agent's official installer, in a terminal window, once the person agreed to it in Settings → Agents */
    openInstaller: openAgentInstaller,
    /* sessions closed on connecting, disconnecting and switching account: the next look at its usage is for whichever
       account is used now */
    closeSessions: (id) => { forgetAgentUsage(id); localAgents?.closeAgent(id); },
    resetAgent: (id) => { forgetAgentStatus(id); forgetAgentUsage(id); localAgents?.refreshSkills(id); },
    seal,
    unseal,
    onChange: (list) => { agentCatalogs.sync(list); agentUpdates?.sync(list); broadcast('desktop:agents', roster?.list() ?? list); },
    /* the program the person points at, for an agent not found where it is looked for */
    usePaths: setChosenPaths,
    pickProgram: async (_id, words) => {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, programDialogOptions(words));
      return canceled || !filePaths[0] ? null : filePaths[0];
    },
    checkProgram: checkAgentProgram,
    diagnose: (id) => diagnoseAgent(id, { appVersion: app.getVersion() }),
  });
  agentUpdates = createAgentUpdates({
    dataDir: DATA, appVersion: app.getVersion(),
    getAgents: () => roster.list(), readVersion: checkAgentProgram,
    onChange: () => broadcast('desktop:agents', roster.list()),
    onUpdated: async (id) => { await roster.recheck(id); agentCatalogs.refresh(id, { fresh: true }); },
    isBusy: (id) => localAgents?.isAgentBusy(id) ?? false,
    openCommand: openAgentUpdate, openLink: (url) => shell.openExternal(url),
    openDesktop: () => updates?.manualCheck?.(menuLanguage),
  });
  agentUpdates.start();
  const agentHandle = (channel, fn) => ipcMain.handle(channel, (event, opts) => {
    if (!fromPage(event)) throw new Error('not the window\'s page');
    return fn(opts ?? {});
  });
  agentHandle('desktop:agents:list', () => { void roster.refresh(); return roster.list(); });
  agentHandle('desktop:agents:refresh', () => roster.recheck());
  agentHandle('desktop:agents:connect', ({ id }) => roster.connect(String(id)));
  agentHandle('desktop:agents:cancel-sign-in', async ({ id }) => (await roster.cancelSignIn(String(id))) ?? { ok: true });
  agentHandle('desktop:agents:disconnect', async ({ id }) => (await roster.disconnect(String(id))) ?? { ok: true });
  agentHandle('desktop:agents:switch-account', ({ id }) => roster.switchAccount(String(id)));
  /* what is left of Claude Code's and Codex's plan, on OpenFilm's sign-in (agent-usage.mjs); null when it can't say */
  agentHandle('desktop:agents:usage', ({ id, fresh }) => agentUsage(String(id), { fresh: fresh === true }));
  agentHandle('desktop:agents:locate', ({ id, words }) => roster.locate(String(id), words));
  agentHandle('desktop:agents:automatic', ({ id }) => roster.useAutomatic(String(id)));
  agentHandle('desktop:agents:install', ({ id }) => roster.install(String(id)));
  agentHandle('desktop:agents:diagnose', ({ id }) => roster.diagnose(String(id)));
  agentHandle('desktop:agents:update-check', async ({ id }) => {
    if (!id || id === 'openfilm' || id === 'byok') void updates?.check();
    if (id) await agentUpdates.check(String(id), { fresh: true });
    else await agentUpdates.checkAll({ fresh: true });
    return roster.list();
  });
  agentHandle('desktop:agents:update', ({ id }) => agentUpdates.update(String(id)));
  agentHandle('desktop:agents:setup', async ({ id }) => {
    if (id !== 'claude') return { ok: false, error: 'No desktop setup for this agent.' };
    try { await shell.openExternal('claude://'); return { ok: true }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  /* the app's part of Studio's diagnostic report (app-report.mjs): the agents as found now, each one's --version */
  const appReport = () => gatherAppReport({ list: () => roster.refresh(), check: checkAgentProgram }, {
    version: app.getVersion(), flavor: FLAVOR, packaged: app.isPackaged, channel: updates?.snapshot()?.channel ?? null,
    electron: process.versions.electron, pathSource: lastPathSource(),
  });
  agentHandle('desktop:agents:report', appReport);
  /* the chat's "Copy diagnostic report" by a turn that failed: what Studio's report has (`openfilm doctor`, with the
     last week's problems) and the app's agents, on the clipboard (the chat's page may not be let write it) */
  agentHandle('desktop:diagnostics:copy', async ({ offline }) => {
    const [computer, own] = offline === true ? ['', ''] : await Promise.all([
      studioApi('/api/doctor', 'GET', undefined, AbortSignal.timeout(3000)).then((r) => String(r.text ?? ''), () => ''),
      appReport().catch(() => ''),
    ]);
    const report = [computer || offlineStudioReport(), own].filter(Boolean).join('\n\n────────\n\n');
    clipboard.writeText(report);
    return { ok: true };
  });
  agentHandle('desktop:agents:shown', ({ id, shown }) => { roster.setShown(String(id), shown === true); return { ok: true }; });
  agentHandle('desktop:agents:openfilm-models', ({ config }) => openfilmAgent.saveModels(config));
  agentHandle('desktop:agents:model-menu', ({ id, config }) => agentCatalogs.saveModels(String(id), config));
  agentHandle('desktop:agents:model-refresh', ({ id, model, fresh }) => {
    if (id === 'openfilm') { void openfilmAgent.refresh({ fresh: fresh === true }); return { ok: true }; }
    agentCatalogs.refresh(String(id), { fresh: fresh === true, model });
    return { ok: true };
  });
  agentHandle('desktop:agents:own-model', ({ config }) => roster.saveOwnModel(config));
  agentHandle('desktop:agents:own-model-remove', ({ id }) => { roster.removeOwnModel(String(id)); return { ok: true }; });
  ipcMain.handle('desktop:reveal', (event, path) => { if (fromPage(event) && typeof path === 'string' && path) shell.showItemInFolder(path); });
  ipcMain.handle('desktop:pick-folder', (event, options) => (fromPage(event) ? pickFolder(options) : null));
  /* a picture of part of the window (the viewer, for a reference in the chat): what the person sees, as JPEG */
  ipcMain.handle('desktop:capture', async (event, rect) => {
    if (!fromPage(event) || !rect || typeof rect !== 'object') return null;
    const box = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    if (!Object.values(box).every((n) => Number.isFinite(n)) || box.width < 2 || box.height < 2 || box.width > 8000 || box.height > 8000) return null;
    const image = await event.sender.capturePage(box).catch(() => null);
    return image && !image.isEmpty() ? image.toJPEG(88).toString('base64') : null;
  });

  ipcMain.handle('desktop:update-restart', (event) => (fromPage(event) ? updates?.restart() : { ok: false }));
  /* Settings → About: the state now, and a check that answers with the state it ends in (no dialog) */
  ipcMain.handle('desktop:update-state', (event) => (fromPage(event) ? updates?.snapshot() ?? null : null));
  ipcMain.handle('desktop:update-check', (event) => (fromPage(event) ? updates?.check() ?? null : null));

  /* the menu bar speaks the page's language (the system's until the page says), built again when it changes */
  function showMenu() {
    const language = appLanguage(state.language, app.getPreferredSystemLanguages());
    if (language === menuLanguage) return;
    menuLanguage = language;
    Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate({
      language,
      productName: PRODUCT_NAME,
      packaged: app.isPackaged,
      toggleChat: () => activeView()?.webContents.send('desktop:toggle-chat'),
      openProject: () => void openProjectFolder(),
      openSettings: () => { focusWindow(); activeView()?.webContents.send('desktop:open-settings'); },
      reload: () => activeView()?.webContents.reload(),
      devTools: () => activeView()?.webContents.toggleDevTools(),
      tabs: {
        /* the projects window, in the page in front, to pick the project a new tab shows */
        open: () => activeView()?.webContents.send('desktop:tabs:pick') ?? views.get(HOME)?.webContents.focus(),
        close: () => closeTabOrWindow(win, { mac, activeId: tabs?.activeId(), closeTab }),
        reopen: () => { const tab = tabs?.reopen(); if (tab) showTab(tab.id); },
        step: (by) => {
          const list = tabs?.list() ?? [];
          const i = list.findIndex((t) => t.active);
          if (list.length > 1) showTab(list[(i + by + list.length) % list.length].id);
        },
        pick: (n) => { const list = tabs?.list() ?? []; const tab = n === 9 ? list.at(-1) : list[n - 1]; if (tab) showTab(tab.id); },
      },
      updates: updates.packaged ? {
        check: () => updates.manualCheck(menuLanguage),
        beta: updates.channel() === 'beta',
        setBeta: (on) => updates.setChannel(on ? 'beta' : 'stable'),
      } : null,
    })));
  }
  showMenu();

  win.show();
  if (needFfmpeg) {
    ffmpegFetching = true;
    let shownAt = 0;
    tellFfmpeg({ state: 'downloading', progress: 0 });
    void ensureFfmpeg(DATA, {
      onProgress: (progress) => { if (Date.now() - shownAt > 500) { shownAt = Date.now(); tellFfmpeg({ state: 'downloading', progress }); } },
    }).then(() => tellFfmpeg(true), (error) => { log(`ffmpeg did not download: ${error.message}\n`); tellFfmpeg({ state: 'failed', message: error.message }); })
      .finally(() => { ffmpegFetching = false; });
  }
  studioRestartsOnExit = studioRestarts({
    start: () => runStudio(env),
    onRetry: (wait) => log(`${new Date().toISOString()} Retrying Studio in ${wait / 1000} s\n`),
    onFailure: (error) => {
      const what = `Studio restart failed: ${error.message ?? error}`;
      log(`${new Date().toISOString()} ${what}\n`);
      studioProblem('restart', what, error.code);
    },
  });
  try {
    await runStudio(env);
  } catch (error) {
    if (quitting) return;
    log(`Studio did not start: ${error.stack ?? error}\n`);
    studioProblem('startup', `Studio could not start: ${error.message ?? error}`, error.code);
    const v = makeView('failed');
    v.setVisible(true);
    void v.webContents.loadFile(here('./failed.html'), { query: { message: String(error.message ?? error) } });
  }
}

/* a terminal's Ctrl-C, or the launcher passing one on: quit the way the menu does, so Studio writes its history */
process.on('SIGINT', () => app.quit());
process.on('SIGTERM', () => app.quit());
app.on('activate', () => focusWindow());
app.on('window-all-closed', () => app.quit());
app.on('child-process-gone', (_event, details) => {
  if (quitting || details.type !== 'Utility' || details.reason === 'clean-exit') return;
  if (details.name !== 'OpenFilm Studio' && details.serviceName !== 'OpenFilm Studio') return;
  const { reason, exitCode, systemErrorCode } = details;
  studioProblem('Electron utility process', `Studio process lost (${reason}, ${exitCode}${systemErrorCode == null ? '' : `, system error ${systemErrorCode}`})`, String(exitCode));
});
app.on('before-quit', (event) => {
  quitAfterStudio(event, {
    quitting, markQuitting, studio,
    /* and the ones opened only to ask (signed in? its options?), which belong to no chat */
    closeAgents: () => { agentUpdates?.stop(); agentCatalogs?.close(); localAgents?.closeAll(); closeEverySession(); }, quit: () => app.quit(),
  });
});
