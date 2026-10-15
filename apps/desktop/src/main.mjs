/**
 * OpenFilm for desktop: one window, Studio on the left and a chat on the right, one page.
 *
 * Studio is the open-source one (the `openfilm` package), run in a utility process (studio.mjs). It serves the
 * window's page: Studio's editor, built together with the chat beside it (shell/), on Studio's own origin, so the
 * editor works as it does in a browser and the chat is a column of the same page. What happens between them happens
 * in the page (shell/bridge.ts); this process does what only the app can: the window, the agents, files on the disk,
 * ffmpeg, updates (preload.cjs). The window opens straight into the last project.
 */
import { BaseWindow, Menu, WebContentsView, app, dialog, ipcMain, nativeTheme, safeStorage, screen, shell } from 'electron';
import { appendFileSync, createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { FLAVOR, IDENTITY, PRODUCT_NAME } from './flavor.mjs';
import { folderDialogOptions, programDialogOptions } from './folder-dialog.mjs';
import { childEnvironment, loginShellEnvironment } from './environment.mjs';
import { startWindowStudio } from './studio.mjs';
import { CHAT_MIN, STUDIO_MIN, WINDOW_MIN, placeOnDisplays, readWindowState, writeWindowState } from './window-state.mjs';
import { applicationMenu } from './menu.mjs';
import { registerLocalAgentIpc } from './local-agents-ipc.mjs';
import { readPreferences, registerChatIpc } from './chat-ipc.mjs';
import { registerSkillsIpc } from './skills-ipc.mjs';
import { createRoster } from './agent-roster.mjs';
import { checkAgentProgram, diagnoseAgent, listAgents, openAgentSignIn, setChosenPaths } from './agents.mjs';
import { agentUsage, forgetAgentUsage } from './agent-usage.mjs';
import { installOpenfilmCommand } from './openfilm-command.mjs';
import { startUpdates } from './updates.mjs';
import { ensureFfmpeg, ffmpegDir, ffmpegDownloadable, ffmpegIn, ffmpegOnPath } from './ffmpeg-runtime.mjs';
import { PATH_SEP } from './environment.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const mac = process.platform === 'darwin';
const windows = process.platform === 'win32';
/** Windows' window buttons over the top bar: the board's color, and the text's */
const overlayColours = (t) => ({ color: t === 'dark' ? '#111111' : '#f2f2f2', symbolColor: t === 'dark' ? '#dadada' : '#1f1f1f', height: 32 });

/* HTML-in-Canvas in Studio's viewer, as in the renderer (the `openfilm` package's src/host.mjs) */
app.commandLine.appendSwitch('enable-blink-features', 'CanvasDrawElement');

/* each flavour its own name, data folder and single-instance lock (flavor.mjs) */
app.setName(PRODUCT_NAME);
app.setPath('userData', IDENTITY.userData ?? join(app.getPath('appData'), PRODUCT_NAME));
const DATA = app.getPath('userData');
const LOGS = join(DATA, 'logs');
mkdirSync(LOGS, { recursive: true });
const log = (line) => { try { appendFileSync(join(LOGS, 'studio.log'), line); } catch { /* no log */ } };

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => focusWindow());
  app.whenReady().then(start).catch((error) => {
    console.error(error);
    app.exit(1);
  });
}

/** @type {BaseWindow | null} */
let win = null;
/** @type {WebContentsView | null} */
let view = null;
/** @type {Awaited<ReturnType<typeof startWindowStudio>> | null} */
let studio = null;
let state = readWindowState(DATA);
let theme = 'dark';
/** whether Studio has ffmpeg: true, false, { state: 'downloading', progress } or { state: 'failed', message } (null: not known yet) */
let ffmpegFound = null;
/** ffmpeg is being downloaded (ffmpeg-runtime.mjs): Studio's "not found" at its start is not the last word */
let ffmpegFetching = false;
const tellFfmpeg = (state) => { ffmpegFound = state; view?.webContents.send('desktop:ffmpeg', state); };
/** @type {ReturnType<typeof startUpdates> | null} */
let updates = null;
let quitting = false;
/** @type {ReturnType<typeof registerLocalAgentIpc> | null} */
let localAgents = null;
/** @type {ReturnType<typeof createRoster> | null} */
let roster = null;

/** the board Studio's panes sit on (its --dock-shell), so the window never flashes another color */
const BACKGROUND = { light: '#f2f2f2', dark: '#111111' };

function focusWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** The page fills the window. */
function layout() {
  if (!win || !view) return;
  const { width, height } = win.getContentBounds();
  view.setBounds({ x: 0, y: 0, width, height });
}

function saveState() {
  if (!win) return;
  const maximized = win.isMaximized() || win.isFullScreen();
  state = { ...state, maximized, bounds: maximized ? state.bounds : win.getNormalBounds() };
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

/** IPC only from the page's own main frame. */
const fromPage = (event) => Boolean(view) && event.sender === view.webContents && event.senderFrame === view.webContents.mainFrame;

async function studioApi(path, method = 'GET', body = undefined) {
  const res = await fetch(`${studio.origin}${path}`, {
    method,
    headers: { 'x-studio-key': studio.key, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Studio answered ${res.status}`);
  return res.json();
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
  view?.setBackgroundColor(BACKGROUND[theme]);
  if (windows) win?.setTitleBarOverlay?.(overlayColours(theme));
}

/** Tell Studio which folders the chat's agents are working in now. */
function tellWorking(/** @type {string[]} */ folders) {
  studio?.child.postMessage({ type: 'working', folders });
}

async function runStudio(env) {
  studio = await startWindowStudio({
    home: env.OPENFILM_HOME,
    port: IDENTITY.studioPort,
    /* Studio serves the window's page as its editor (shell/: its editor with the chat beside it) */
    env: { ...env, OPENFILM_EDITOR_DIR: here('../shell/dist/') },
    log,
    onOpen: (url) => {
      /* Studio would open a browser for an address of its own: the window already shows Studio */
      if (studio && url.startsWith(studio.origin)) focusWindow();
      else if (/^https?:/i.test(url)) void shell.openExternal(url);
    },
    onBrowser: (message) => {
      if (message.type === 'ffmpeg') { if (!ffmpegFetching) tellFfmpeg(message.found); }
      else view?.webContents.send('desktop:studio-browser', message);
    },
    onExit: (code) => {
      if (quitting) return;
      log(`Studio stopped (${code}); starting it again\n`);
      setTimeout(() => void runStudio(env).catch((error) => log(`Studio did not start again: ${error.message}\n`)), 1000);
    },
  });
  /* a Studio started again hears where the agents are working */
  tellWorking(localAgents?.working() ?? []);
  /* the page Studio shows at `/` is the last project; a page already open (Studio restarted) stays where it was */
  const at = view.webContents.getURL();
  const to = at.startsWith('http') ? new URL(at).pathname : '/';
  await view.webContents.loadURL(`${studio.origin}/open?key=${studio.key}&to=${encodeURIComponent(to)}`);
}

async function start() {
  const shellEnv = await loginShellEnvironment();
  const env = childEnvironment({
    shell: shellEnv,
    extra: {
      OPENFILM_HOME: IDENTITY.studioHome ?? process.env.OPENFILM_HOME ?? join(app.getPath('home'), '.openfilm'),
      ...((IDENTITY.library ?? process.env.OPENFILM_LIBRARY) ? { OPENFILM_LIBRARY: IDENTITY.library ?? process.env.OPENFILM_LIBRARY } : {}),
      /* the app names Studio's home, which would put exports inside it (Studio's rule for a home kept apart): the
         Desktop, where `openfilm` puts them, unless this is a flavour with a home of its own */
      ...(IDENTITY.studioHome || process.env.OPENFILM_EXPORTS ? {} : { OPENFILM_EXPORTS: app.getPath('desktop') }),
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

  view = new WebContentsView({
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
  view.setBackgroundColor(BACKGROUND[theme]);
  win.contentView.addChildView(view);
  layout();

  guard(view.webContents, (url) => Boolean(studio) && url.startsWith(`${studio.origin}/`));
  /* what went wrong with the page, for the log (logs/studio.log) */
  view.webContents.on('render-process-gone', (_event, details) => log(`page: renderer gone (${details.reason}, ${details.exitCode})\n`));
  view.webContents.on('did-fail-load', (_event, code, description, url, mainFrame) => { if (mainFrame) log(`page: ${description} (${code}) loading ${url.replace(/key=[^&]+/, 'key=…')}\n`); });
  view.webContents.on('unresponsive', () => log('page: not responding\n'));
  /* the page gone (a crash): it comes back where it was; the agents' turns go on in this process meanwhile */
  view.webContents.on('render-process-gone', (_event, details) => { if (details.reason !== 'clean-exit' && !quitting) setTimeout(() => view?.webContents.reload(), 500); });

  win.on('resize', layout);
  win.on('resized', saveState);
  win.on('moved', saveState);
  win.on('enter-full-screen', () => view?.webContents.send('desktop:full-screen', true));
  win.on('leave-full-screen', () => view?.webContents.send('desktop:full-screen', false));
  win.on('close', saveState);
  win.on('closed', () => { win = null; view = null; app.quit(); });

  ipcMain.on('desktop:theme', (event, next) => { if (fromPage(event)) setTheme(next); });
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
    projects: async () => (await studioApi('/api/projects')).projects.filter((p) => !p.missing).map((p) => p.path),
    dataDir: DATA,
    reveal: (path) => shell.showItemInFolder(path),
    tell: (channel, value) => view?.webContents.send(channel, value),
    log,
  });
  /* the agents: Studio's home and library go with them, so the `openfilm` they run finds this window's Studio */
  /* the person's own skills: Skills/ beside this app's projects (~/Movies/OpenFilm/Skills), as its `openfilm` finds them */
  const mySkills = process.env.OPENFILM_SKILLS || (env.OPENFILM_LIBRARY ? join(dirname(env.OPENFILM_LIBRARY), 'Skills') : (await import('openfilm/skills')).mySkillsDir());
  localAgents = registerLocalAgentIpc(ipcMain, {
    trusted: fromPage,
    log,
    /* Studio refuses to delete a project an agent is working in */
    onWorking: tellWorking,
    /* the `openfilm` command first (with the app's ffmpeg and browser in it); the app's ffmpeg last, for a computer
       that has none of its own: the person's own ffmpeg and browsers are what the agent's commands use */
    binDir: installOpenfilmCommand(DATA, { ffmpeg: ffmpegHere, env: browsers }),
    fallbackDir: ffmpegHere,
    env: { OPENFILM_HOME: env.OPENFILM_HOME, ...(env.OPENFILM_LIBRARY ? { OPENFILM_LIBRARY: env.OPENFILM_LIBRARY } : {}) },
    harness: async (id) => roster?.harness(id) ?? null,
    /* Developer mode: an agent whose own record lacks what its model got logs it here (agent-logs.mjs) */
    logDir: () => (readPreferences(DATA).developer ? join(DATA, 'agent-logs') : null),
    /* each session's skills: its maker's, OpenFilm's, and of the person's own those let in (agent-skills.mjs) */
    skills: { dataDir: DATA, mine: mySkills },
  });
  /* the composer's Skills button */
  registerSkillsIpc(ipcMain, {
    trusted: fromPage,
    projects: async () => (await studioApi('/api/projects')).projects.filter((p) => !p.missing).map((p) => p.path),
    dataDir: DATA,
    mine: mySkills,
    oldMine: join(env.OPENFILM_HOME, 'skills'),
    reveal: (path) => { void shell.openPath(path); },
    refreshSkills: (agent) => localAgents?.refreshSkills(agent),
    log,
  });
  /* Settings → Agents (in Studio's page) and the chat's agent menu: one roster, both told of every change */
  roster = createRoster({
    dataDir: DATA,
    localAgents: listAgents,
    openSignIn: openAgentSignIn,
    /* sessions closed on connecting and disconnecting: the next look at its usage is for whichever account is used now */
    closeSessions: (id) => { forgetAgentUsage(id); localAgents?.closeAgent(id); },
    seal,
    unseal,
    onChange: (list) => view?.webContents.send('desktop:agents', list),
    /* the program the person points at, for an agent not found where it is looked for */
    usePaths: setChosenPaths,
    pickProgram: async (_id, words) => {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, programDialogOptions(words));
      return canceled || !filePaths[0] ? null : filePaths[0];
    },
    checkProgram: checkAgentProgram,
    diagnose: (id) => diagnoseAgent(id, { appVersion: app.getVersion() }),
  });
  const agentHandle = (channel, fn) => ipcMain.handle(channel, (event, opts) => {
    if (!fromPage(event)) throw new Error('not the window\'s page');
    return fn(opts ?? {});
  });
  agentHandle('desktop:agents:list', () => { void roster.refresh(); return roster.list(); });
  agentHandle('desktop:agents:connect', ({ id }) => roster.connect(String(id)));
  agentHandle('desktop:agents:disconnect', ({ id }) => { roster.disconnect(String(id)); return { ok: true }; });
  /* what is left of Claude Code's and Codex's plan, on OpenFilm's sign-in (agent-usage.mjs); null when it can't say */
  agentHandle('desktop:agents:usage', ({ id, fresh }) => agentUsage(String(id), { fresh: fresh === true }));
  agentHandle('desktop:agents:locate', ({ id, words }) => roster.locate(String(id), words));
  agentHandle('desktop:agents:automatic', ({ id }) => roster.useAutomatic(String(id)));
  agentHandle('desktop:agents:diagnose', ({ id }) => roster.diagnose(String(id)));
  agentHandle('desktop:agents:shown', ({ id, shown }) => { roster.setShown(String(id), shown === true); return { ok: true }; });
  agentHandle('desktop:agents:own-model', ({ config }) => roster.saveOwnModel(config));
  agentHandle('desktop:agents:own-model-remove', ({ id }) => { roster.removeOwnModel(String(id)); return { ok: true }; });
  /* a file on the disk brought into the chat goes into the project the page names, through Studio's own import (it
     shows in Studio's media at once, and the import is in the project's history); one without a path the page sends
     itself */
  ipcMain.handle('desktop:import-file', async (event, request) => {
    if (!fromPage(event) || !studio) return { ok: false, error: 'Studio is not running.' };
    const projectId = String(request?.projectId ?? '');
    if (!/^[\w-]+$/.test(projectId)) return { ok: false, error: 'No project is open.' };
    const name = basename(String(request?.name ?? '')).replace(/[\u0000-\u001f/\\]+/g, '').slice(0, 200) || 'file';
    const path = typeof request?.path === 'string' ? request.path : '';
    try { if (!path || !statSync(path).isFile()) return { ok: false, error: 'That is not a file.' }; } catch { return { ok: false, error: 'That file is not there any more.' }; }
    try {
      const res = await fetch(`${studio.origin}/api/projects/${encodeURIComponent(projectId)}/files?path=${encodeURIComponent(`assets/upload/${name}`)}`, {
        method: 'PUT', headers: { 'x-studio-key': studio.key }, body: Readable.toWeb(createReadStream(path)), duplex: 'half',
      });
      const answer = await res.json().catch(() => ({}));
      return res.ok ? { ok: true, path: answer.path } : { ok: false, error: answer.error ?? `Studio answered ${res.status}` };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('desktop:reveal', (event, path) => { if (fromPage(event) && typeof path === 'string' && path) shell.showItemInFolder(path); });
  ipcMain.handle('desktop:pick-folder', (event, options) => (fromPage(event) ? pickFolder(options) : null));
  /* a picture of part of the window (the viewer, for a reference in the chat): what the person sees, as JPEG */
  ipcMain.handle('desktop:capture', async (event, rect) => {
    if (!fromPage(event) || !rect || typeof rect !== 'object') return null;
    const box = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    if (!Object.values(box).every((n) => Number.isFinite(n)) || box.width < 2 || box.height < 2 || box.width > 8000 || box.height > 8000) return null;
    const image = await view.webContents.capturePage(box).catch(() => null);
    return image && !image.isEmpty() ? image.toJPEG(88).toString('base64') : null;
  });

  /* updates (updates.mjs): Restart waits while an agent's turn runs or Studio exports, either would be lost */
  updates = startUpdates({
    dataDir: DATA,
    productName: PRODUCT_NAME,
    getWindow: () => win,
    onState: (next) => view?.webContents.send('desktop:update', next),
    prepareRestart: async () => {
      if (localAgents?.isBusy()) return { ok: false, error: 'agent-busy' };
      /* Studio's quit-when-idle answers 409 while it exports; otherwise the window's Studio stays (studio-process.mjs
         `stays`, 423), and is stopped in beforeInstall. No answer: no Studio, no export to lose. */
      const res = studio && await fetch(`${studio.origin}/api/quit`, {
        method: 'POST', headers: { 'x-studio-key': studio.key, 'content-type': 'application/json' },
        body: JSON.stringify({ whenIdle: true }), signal: AbortSignal.timeout(3000),
      }).catch(() => null);
      return res?.status === 409 ? { ok: false, error: 'exporting' } : { ok: true };
    },
    /* what before-quit would do, done first (`quitting`), so the quit Squirrel starts is not held up or cancelled */
    beforeInstall: async () => {
      quitting = true;
      localAgents?.closeAll();
      view?.webContents.on('will-prevent-unload', (event) => event.preventDefault());
      await studio?.quit();
      updates?.close();
    },
  });
  ipcMain.handle('desktop:update-restart', (event) => (fromPage(event) ? updates?.restart() : { ok: false }));
  /* Settings → About: the state now, and a check that answers with the state it ends in (no dialog) */
  ipcMain.handle('desktop:update-state', (event) => (fromPage(event) ? updates?.snapshot() ?? null : null));
  ipcMain.handle('desktop:update-check', (event) => (fromPage(event) ? updates?.check() ?? null : null));

  Menu.setApplicationMenu(applicationMenu({
    productName: PRODUCT_NAME,
    packaged: app.isPackaged,
    toggleChat: () => view?.webContents.send('desktop:toggle-chat'),
    openProject: () => void openProjectFolder(),
    reload: () => view?.webContents.reload(),
    devTools: () => view?.webContents.toggleDevTools(),
    updates: updates.packaged ? {
      check: () => updates.manualCheck(),
      beta: updates.channel() === 'beta',
      setBeta: (on) => updates.setChannel(on ? 'beta' : 'stable'),
    } : null,
  }));

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
  try {
    await runStudio(env);
  } catch (error) {
    log(`Studio did not start: ${error.stack ?? error}\n`);
    void view.webContents.loadFile(here('./failed.html'), { query: { message: String(error.message ?? error) } });
  }
}

/* a terminal's Ctrl-C, or the launcher passing one on: quit the way the menu does, so Studio writes its history */
process.on('SIGINT', () => app.quit());
process.on('SIGTERM', () => app.quit());
app.on('activate', () => focusWindow());
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  localAgents?.closeAll();
  if (quitting || !studio) return;
  event.preventDefault();
  quitting = true;
  void studio.quit().finally(() => app.quit());
});
