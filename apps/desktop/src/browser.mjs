// @ts-check
/**
 * The app's browser: tabs of the web, each a page of its own in the window, shown where a project's page leaves room
 * for it (the Browser workbench, which draws the address field and the tabs and says where the page goes).
 *
 * A web page is never trusted (the rules are browser-policy.mjs), and is kept apart from everything else the app has:
 *
 *   · its own session (`PARTITION`): cookies, storage and cache of its own, on disk under the app's data, shared with
 *     neither Studio's page nor the person's own browser;
 *   · its own sandboxed process with no preload: no `openfilmNative`, no IPC, no Node. What the app's own pages may
 *     ask (main.mjs `fromPage`) a web page cannot, as it is none of the window's tabs;
 *   · no way to the app's own servers (Studio, the agents' doors), nor from a page of the web to this computer or its
 *     network;
 *   · permissions refused unless the person says so, in a dialog of the system's, site by site;
 *   · a certificate that does not check is an error, with no way round it; no client certificate is ever offered;
 *   · windows a page opens become tabs, a few at a time; links for other apps are the person's to open; a page
 *     cannot keep its tab from leaving or closing;
 *   · a download goes where the person picks, a file that can run is said to be one first, and every file kept is
 *     marked as come from the web, so the system checks it before it is first opened.
 *
 * Tabs belong to a project: each project's page shows its own, and an agent working in a project drives only those
 * (browser-door.mjs). A tab an agent drives says so (`drivenBy`), the person can take it over (`takeOver`), and a form
 * an agent's action sends by POST waits for the person's word (`askToSend`; the page's own way of sending one is held
 * here on the network, `holdPosts`). What a tab shows of itself (its address, its title, whether it loads) is read here
 * from the tab, never taken from its page.
 */
import { Menu, WebContentsView, app, clipboard, dialog, session, shell, systemPreferences } from 'electron';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFile, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { downloadName, navigation, permission, permissionKeys, plainUserAgent, popupGate, readAnswers, request, riskyDownload, shownAddress, siteOf, typedAddress } from './browser-policy.mjs';
import { BROWSER_WORDS } from './i18n/browser.mjs';

export const PARTITION = 'persist:openfilm-browser';
/** the most tabs a project has */
const MOST_TABS = 12;
/** the downloads a project's page is told of, the newest last */
const DOWNLOADS_KEPT = 6;
/** how long after an agent's last action its tab still says it drives it */
const DRIVEN_MS = 12_000;
/** the size a tab's page has until a workbench shows it somewhere (an agent may read and draw it before that) */
const FIRST_BOUNDS = { x: 0, y: 0, width: 1280, height: 800 };
const mac = process.platform === 'darwin';

/**
 * @typedef {{ id: string, view: WebContentsView, title: string, loading: boolean, typed: string | null,
 *   failed: { code: number | 'refused', text: string, address: string } | null, crashed: boolean, shown: boolean,
 *   refusedHere: Set<string>, driver: { name: string, timer: ReturnType<typeof setTimeout> } | null, held: boolean,
 *   posts: { heldUntil: number, by: string, allowed: number, allowedUntil: number } }} Tab
 * @typedef {{ tabs: Tab[], active: string | null, may: (tabsNow: number) => boolean,
 *   downloads: Array<{ id: string, name: string, state: string, received: number, total: number, path: string | null }> }} Project
 * @typedef {{ x: number, y: number, width: number, height: number }} Bounds
 */

/**
 * @param {{
 *   window: () => import('electron').BaseWindow | null,
 *   dataDir: string,
 *   ownOrigins: () => string[],
 *   language: () => string,
 *   productName: string,
 *   tell: (projectId: string, state: ReturnType<ReturnType<typeof createBrowser>['state']>) => void,
 *   focusAddress?: (projectId: string) => void,
 *   log?: (line: string) => void,
 * }} o
 */
export function createBrowser(o) {
  const log = o.log ?? (() => {});
  const dir = join(o.dataDir, 'browser');
  const answersFile = join(dir, 'permissions.json');
  /** what the person answered, site by site */
  let answers = readAnswers((() => { try { return JSON.parse(readFileSync(answersFile, 'utf8')); } catch { return null; } })());
  const keepAnswers = () => {
    try { mkdirSync(dir, { recursive: true }); writeFileSync(answersFile, `${JSON.stringify(answers, null, 1)}\n`); } catch (error) { log(`browser: answers not kept (${error instanceof Error ? error.message : error})\n`); }
  };
  const words = () => BROWSER_WORDS[/** @type {keyof typeof BROWSER_WORDS} */ (o.language())] ?? BROWSER_WORDS.en;

  /** @type {Map<string, Project>} */
  const projects = new Map();
  /** a tab and its project, by its page's id */
  /** @type {Map<number, { projectId: string, tab: Tab }>} */
  const byContents = new Map();
  /** where the page in front shows its project's tab (no bounds: nowhere) */
  let placed = { projectId: /** @type {string | null} */ (null), bounds: /** @type {Bounds | null} */ (null) };
  /** the size a tab was last shown at: a new tab's page is laid out at it before it is first shown */
  let lastBounds = FIRST_BOUNDS;
  /** dialogs open now, by what they ask: a page asking again while one is up gets that one's answer */
  /** @type {Map<string, Promise<{ allow: boolean, remember: boolean }>>} */
  const asking = new Map();

  const projectOf = (/** @type {string} */ projectId) => {
    let p = projects.get(projectId);
    if (!p) projects.set(projectId, p = { tabs: [], active: null, may: popupGate({ most: MOST_TABS }), downloads: [] });
    return p;
  };
  const tabOf = (/** @type {string} */ projectId, /** @type {string | null | undefined} */ tabId) => {
    const p = projects.get(projectId);
    return p?.tabs.find((t) => t.id === (tabId ?? p.active)) ?? null;
  };
  /** the address a tab is at, or is being sent to by the person (a page's own navigation shows only once it lands) */
  const addressOf = (/** @type {Tab} */ tab) => tab.typed ?? tab.failed?.address ?? (tab.view.webContents.isDestroyed() ? '' : tab.view.webContents.getURL());

  /* ── telling the project's page, once for all that changed in a turn of the loop ── */
  const told = new Set();
  function tell(/** @type {string} */ projectId) {
    if (told.has(projectId)) return;
    told.add(projectId);
    setImmediate(() => { told.delete(projectId); try { o.tell(projectId, api.state(projectId)); } catch { /* its page is gone */ } });
  }

  /* ── the session: made once, with the first tab ── */
  /** @type {import('electron').Session | null} */
  let ses = null;
  function theSession() {
    if (ses) return ses;
    ses = session.fromPartition(PARTITION);
    ses.setUserAgent(plainUserAgent(ses.getUserAgent()));
    ses.setPermissionRequestHandler((contents, name, callback, details) => {
      decide(contents, name, details).then(callback, (error) => { log(`browser: ${name} not decided (${error instanceof Error ? error.message : error})\n`); callback(false); });
    });
    ses.setPermissionCheckHandler((contents, name, origin, details) => {
      const entry = contents ? byContents.get(contents.id) : null;
      if (!entry || contents?.isDestroyed()) return false;
      const page = pageOf(contents, origin || details.requestingUrl || '', details.isMainFrame);
      const verdict = permission(name, page);
      if (verdict !== 'ask') return verdict === 'allow';
      return permissionKeys(name, details).every((key) => answers[page.site ?? '']?.[key] === 'allow');
    });
    /* USB, HID and serial devices: none, to any page */
    ses.setDevicePermissionHandler(() => false);
    ses.webRequest.onBeforeRequest((details, callback) => {
      const page = details.webContents && !details.webContents.isDestroyed() ? details.webContents.getURL() : '';
      const verdict = request({ url: details.url, type: details.resourceType, top: page || details.referrer || null, own: o.ownOrigins() });
      if (verdict === 'block') { callback({ cancel: true }); return; }
      /* a form sent by POST while an agent acts on the tab, some other way than the page's form (which the door holds
         in the page): it waits here for the person */
      const entry = typeof details.webContentsId === 'number' ? byContents.get(details.webContentsId) : null;
      const posts = entry?.tab.posts;
      const now = Date.now();
      if (entry && posts && details.method === 'POST' && (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') && posts.heldUntil > now) {
        /* the one the person just allowed (the door sends it as it was held) */
        if (posts.allowed > 0 && posts.allowedUntil > now) { posts.allowed -= 1; callback({ cancel: false }); return; }
        api.askToSend({ projectId: entry.projectId, tabId: entry.tab.id, agent: posts.by, address: page, form: { action: details.url, button: null, fields: [] } })
          .then((yes) => callback({ cancel: !yes }), () => callback({ cancel: true }));
        return;
      }
      callback({ cancel: false });
    });
    ses.on('will-download', (event, item, contents) => download(event, item, contents));
    return ses;
  }

  /** Who asks: the site, whether it is the tab's own page (not a frame of another site inside it), and how it came. */
  function pageOf(/** @type {import('electron').WebContents} */ contents, /** @type {string} */ asker, /** @type {boolean | undefined} */ isMainFrame) {
    const top = contents.getURL();
    const site = siteOf(asker) ?? siteOf(top);
    const state = shownAddress(top).state;
    return { site, mainFrame: isMainFrame !== false && site === siteOf(top), secure: state === 'secure' || state === 'local' };
  }

  /** Whether a page gets what it asks for (browser-policy.mjs `permission`), asking the person when it is theirs to say. */
  async function decide(/** @type {import('electron').WebContents | null} */ contents, /** @type {string} */ name, /** @type {any} */ details) {
    const entry = contents ? byContents.get(contents.id) : null;
    if (!entry || !contents || contents.isDestroyed()) return false;
    /* a link for another app: Chromium never opens it; the person is asked, and the system opens it */
    if (name === 'openExternal') { void openOutside(String(details?.externalURL ?? ''), contents); return false; }
    const page = pageOf(contents, details?.requestingUrl ?? '', details?.isMainFrame);
    const verdict = permission(name, page);
    if (verdict !== 'ask' || !page.site) return verdict === 'allow';
    const site = page.site;
    const keys = permissionKeys(name, details ?? {});
    if (keys.some((key) => answers[site]?.[key] === 'deny' || entry.tab.refusedHere.has(key))) return false;
    const open = keys.filter((key) => answers[site]?.[key] !== 'allow');
    if (open.length) {
      const answer = await ask(site, open);
      if (answer.remember) { for (const key of open) (answers[site] ??= {})[key] = answer.allow ? 'allow' : 'deny'; keepAnswers(); }
      /* refused without "remember": this page is not asked again until it goes somewhere else */
      else if (!answer.allow) for (const key of open) entry.tab.refusedHere.add(key);
      if (!answer.allow) return false;
    }
    return systemAccess(keys);
  }

  /** The person asked, in the system's own dialog on the window; closing it is a no. */
  function ask(/** @type {string} */ site, /** @type {string[]} */ keys) {
    const what = keys.includes('camera') && keys.includes('microphone') ? 'camera+microphone' : keys[0];
    const id = `${site} ${what}`;
    const open = asking.get(id);
    if (open) return open;
    const w = words();
    const win = o.window();
    const host = shownAddress(site).host;
    const options = {
      type: /** @type {const} */ ('question'), title: o.productName, message: (w.ask[/** @type {keyof typeof w.ask} */ (what)] ?? w.ask.notifications).replaceAll('{host}', host), detail: site,
      buttons: [w.allow, w.deny], defaultId: 1, cancelId: 1, noLink: true, checkboxLabel: w.remember, checkboxChecked: false,
    };
    const answered = (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))
      .then(({ response, checkboxChecked }) => ({ allow: response === 0, remember: checkboxChecked }), () => ({ allow: false, remember: false }))
      .finally(() => asking.delete(id));
    asking.set(id, answered);
    return answered;
  }

  /** The camera and the microphone are the system's to give the app first (macOS asks the person once). */
  async function systemAccess(/** @type {string[]} */ keys) {
    if (!mac) return true;
    for (const key of keys) {
      if (key !== 'camera' && key !== 'microphone') continue;
      if (!await systemPreferences.askForMediaAccess(key).catch(() => false)) return false;
    }
    return true;
  }

  /** A link for another app (mail, a phone number): opened by the system once the person says so. */
  async function openOutside(/** @type {string} */ address, /** @type {import('electron').WebContents} */ contents) {
    if (navigation(address) !== 'outside' || contents.isDestroyed()) return;
    const id = `outside ${address}`;
    if (asking.has(id)) return;
    const w = words();
    const win = o.window();
    const options = { type: /** @type {const} */ ('question'), title: o.productName, message: w.outside, detail: address.length > 300 ? `${address.slice(0, 300)}…` : address, buttons: [w.open, w.cancel], defaultId: 1, cancelId: 1, noLink: true };
    const answered = (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)).then(({ response }) => ({ allow: response === 0, remember: false }), () => ({ allow: false, remember: false })).finally(() => asking.delete(id));
    asking.set(id, answered);
    if ((await answered).allow) void shell.openExternal(address).catch(() => {});
  }

  /** A download: where the person picks; a file that can run only once they said to keep it. */
  function download(/** @type {import('electron').Event} */ event, /** @type {import('electron').DownloadItem} */ item, /** @type {import('electron').WebContents | undefined} */ contents) {
    const entry = contents ? byContents.get(contents.id) : null;
    if (!entry) { event.preventDefault(); return; }
    const name = downloadName(item.getFilename());
    if (riskyDownload(name)) {
      const w = words();
      const host = shownAddress(item.getURL()).host || shownAddress(contents?.getURL() ?? '').host;
      const options = { type: /** @type {const} */ ('warning'), title: o.productName, message: w.risky.replaceAll('{name}', name), detail: w.riskyDetail.replaceAll('{host}', host), buttons: [w.keep, w.discard], defaultId: 1, cancelId: 1, noLink: true };
      const win = o.window();
      /* answered before the download goes on: it is decided here or not at all */
      if ((win ? dialog.showMessageBoxSync(win, options) : dialog.showMessageBoxSync(options)) !== 0) { event.preventDefault(); return; }
    }
    item.setSaveDialogOptions({ defaultPath: join(app.getPath('downloads'), name) });
    const p = projectOf(entry.projectId);
    const row = { id: randomUUID(), name, state: 'progressing', received: 0, total: item.getTotalBytes(), path: /** @type {string | null} */ (null) };
    p.downloads.push(row);
    if (p.downloads.length > DOWNLOADS_KEPT) p.downloads.shift();
    const update = (/** @type {string} */ state) => {
      Object.assign(row, { state, received: item.getReceivedBytes(), total: item.getTotalBytes(), path: item.getSavePath() || null, name: item.getSavePath() ? downloadName(item.getSavePath().split(/[\\/]/).pop() ?? name) : name });
      tell(entry.projectId);
    };
    item.on('updated', (_event, state) => update(state));
    item.once('done', (_event, state) => {
      const path = item.getSavePath();
      if (state === 'completed' && path) markFromWeb(path, item.getURL(), () => update(state));
      else update(state);
    });
    tell(entry.projectId);
  }

  /**
   * A file kept from the web is marked as one, as a browser marks it: macOS then checks it before it first runs
   * (Gatekeeper's quarantine), Windows warns before it is opened (the Internet zone). Electron's own downloads carry
   * no such mark (bench/browser.test.mjs looks). `then` is called once it is marked, or could not be.
   */
  function markFromWeb(/** @type {string} */ path, /** @type {string} */ address, /** @type {() => void} */ then) {
    if (mac) {
      const agent = o.productName.replace(/[;\n]/g, ' ');
      execFile('/usr/bin/xattr', ['-w', 'com.apple.quarantine', `0081;${Math.floor(Date.now() / 1000).toString(16)};${agent};`, path], (error) => {
        if (error) log(`browser: download not marked (${error.message})\n`);
        then();
      });
    } else if (process.platform === 'win32') {
      writeFile(`${path}:Zone.Identifier`, `[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=${siteOf(address) ?? 'about:internet'}\r\n`, (error) => {
        if (error) log(`browser: download not marked (${error.message})\n`);
        then();
      });
    } else then();
  }

  /* no certificate of the person's is ever offered to a site (Electron would send the first one it finds) */
  app.on('select-client-certificate', (event, contents, _url, _list, callback) => {
    if (!byContents.has(contents.id)) return;
    event.preventDefault();
    /** @type {(certificate?: import('electron').Certificate) => void} */ (callback)();
  });
  /* a certificate that does not check is refused, here said outright (it is also what Electron does unasked) */
  app.on('certificate-error', (event, contents, _url, _error, _certificate, callback) => {
    if (!byContents.has(contents.id)) return;
    event.preventDefault();
    callback(false);
  });

  /* ── a tab ── */
  function makeTab(/** @type {string} */ projectId) {
    const view = new WebContentsView({
      webPreferences: {
        session: theSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        plugins: false,
        navigateOnDragDrop: false,
        safeDialogs: true,
        spellcheck: false,
        enableWebSQL: false,
        autoplayPolicy: 'document-user-activation-required',
        devTools: !app.isPackaged,
      },
    });
    view.setVisible(false);
    view.setBackgroundColor('#ffffff');
    /* laid out at the size it will likely be shown at, so what an agent reads and draws of it before is as the person
       will see it; in the window from the start, out of sight */
    view.setBounds(lastBounds);
    try { o.window()?.contentView.addChildView(view); } catch { /* no window */ }
    /** @type {Tab} */
    const tab = { id: randomUUID(), view, title: '', loading: false, typed: null, failed: null, crashed: false, shown: false, refusedHere: new Set(), driver: null, held: false, posts: { heldUntil: 0, by: '', allowed: 0, allowedUntil: 0 } };
    const page = view.webContents;
    byContents.set(page.id, { projectId, tab });
    /* calls between people (WebRTC) show a site the address the computer reaches the web by, not those of its network */
    page.setWebRTCIPHandlingPolicy('default_public_interface_only');
    const changed = () => tell(projectId);

    /* a window a page opens is a tab of the same project, or nothing */
    page.setWindowOpenHandler(({ url, disposition }) => {
      const verdict = navigation(url);
      const p = projectOf(projectId);
      if (verdict === 'load' && p.may(p.tabs.length)) setImmediate(() => { api.open(projectId, url, { front: disposition !== 'background-tab' }); });
      else if (verdict === 'outside') void openOutside(url, page);
      return { action: 'deny' };
    });
    const guard = (/** @type {{ preventDefault: () => void }} */ event, /** @type {string} */ url) => {
      const verdict = navigation(url);
      if (verdict === 'load') return;
      event.preventDefault();
      if (verdict === 'outside') void openOutside(url, page);
    };
    page.on('will-navigate', (event, url) => guard(event, url));
    page.on('will-redirect', (event, url, _inPage, isMainFrame) => { if (isMainFrame) guard(event, url); });
    page.on('will-attach-webview', (event) => event.preventDefault());
    /* a page cannot hold its tab: one that asks to stay (beforeunload) is left all the same */
    page.on('will-prevent-unload', (event) => event.preventDefault());
    page.on('select-bluetooth-device', (event, _devices, callback) => { event.preventDefault(); callback(''); });
    page.on('did-start-loading', () => { tab.loading = true; changed(); });
    page.on('did-stop-loading', () => { tab.loading = false; changed(); });
    page.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      tab.failed = null;
      show();
      changed();
    });
    page.on('did-navigate', () => { tab.typed = null; tab.failed = null; tab.crashed = false; tab.refusedHere.clear(); show(); changed(); });
    page.on('did-navigate-in-page', (_event, _url, isMainFrame) => { if (isMainFrame) changed(); });
    page.on('page-title-updated', (_event, title) => { tab.title = String(title).slice(0, 300); changed(); });
    page.on('did-fail-load', (_event, code, text, address, isMainFrame) => {
      /* -3: given up for another navigation, or a download */
      if (!isMainFrame || code === -3) return;
      tab.typed = null;
      tab.failed = { code, text: String(text), address: String(address) };
      show();
      changed();
    });
    page.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return;
      tab.crashed = true;
      log(`browser: a tab's page is gone (${details.reason})\n`);
      show();
      changed();
    });
    page.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !(mac ? input.meta : input.control) || input.alt) return;
      const act = /** @type {Record<string, (() => void) | undefined>} */ ({
        l: () => o.focusAddress?.(projectId),
        r: () => api.reload(projectId, tab.id),
        w: () => api.close(projectId, tab.id),
        t: () => { api.open(projectId, null); o.focusAddress?.(projectId); },
        '[': () => api.back(projectId, tab.id),
        ']': () => api.forward(projectId, tab.id),
      })[input.key.toLowerCase()];
      if (!act || input.shift) return;
      event.preventDefault();
      act();
    });
    page.on('context-menu', (_event, params) => {
      /* an agent's right click is the page's to answer, not a menu of the app's popping up under the person */
      if (tab.posts.heldUntil > Date.now()) return;
      const w = words().menu;
      /** @type {import('electron').MenuItemConstructorOptions[]} */
      const items = [];
      const link = params.linkURL && navigation(params.linkURL) === 'load' ? params.linkURL : null;
      if (link) items.push({ label: w.openLink, click: () => { api.open(projectId, link, { front: false }); } }, { label: w.copyLink, click: () => clipboard.writeText(link) }, { type: 'separator' });
      if (params.mediaType === 'image' && params.srcURL && navigation(params.srcURL) === 'load') items.push({ label: w.copyImage, click: () => clipboard.writeText(params.srcURL) }, { type: 'separator' });
      if (params.isEditable) items.push({ label: w.cut, role: 'cut', enabled: params.editFlags.canCut }, { label: w.copy, role: 'copy', enabled: params.editFlags.canCopy }, { label: w.paste, role: 'paste', enabled: params.editFlags.canPaste }, { type: 'separator' });
      else if (params.selectionText) items.push({ label: w.copy, role: 'copy' }, { type: 'separator' });
      items.push(
        { label: w.back, enabled: page.navigationHistory.canGoBack(), click: () => api.back(projectId, tab.id) },
        { label: w.forward, enabled: page.navigationHistory.canGoForward(), click: () => api.forward(projectId, tab.id) },
        { label: w.reload, click: () => api.reload(projectId, tab.id) },
      );
      Menu.buildFromTemplate(items).popup();
    });
    page.once('destroyed', () => { byContents.delete(page.id); if (tab.driver) clearTimeout(tab.driver.timer); });
    return tab;
  }

  /** Each tab where it belongs: the one in front of the project in front, where its page says; the rest out of sight. */
  function show({ raise = false } = {}) {
    const win = o.window();
    if (!win) return;
    const front = placed.projectId ? projects.get(placed.projectId) : null;
    const inFront = front?.tabs.find((t) => t.id === front.active) ?? null;
    for (const p of projects.values()) for (const tab of p.tabs) {
      /* a tab with no page (a new one, one that failed or crashed) shows nothing: the workbench draws what to say */
      const on = tab === inFront && placed.bounds !== null && !tab.failed && !tab.crashed && !tab.view.webContents.isDestroyed() && tab.view.webContents.getURL() !== '';
      if (on && placed.bounds) {
        tab.view.setBounds(placed.bounds);
        lastBounds = placed.bounds;
        if (!tab.shown || raise) { win.contentView.addChildView(tab.view); tab.view.setVisible(true); tab.shown = true; }
      } else if (tab.shown) { tab.view.setVisible(false); tab.shown = false; }
    }
  }

  function destroy(/** @type {Tab} */ tab) {
    tab.shown = false;
    try { o.window()?.contentView.removeChildView(tab.view); } catch { /* the window is gone */ }
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close({ waitForBeforeUnload: false });
  }

  /** Send a tab to an address the person (or their agent) names; refused ones say so in the tab. */
  function load(/** @type {string} */ projectId, /** @type {Tab} */ tab, /** @type {string} */ address) {
    const page = tab.view.webContents;
    const verdict = navigation(address);
    if (verdict === 'outside') { void openOutside(address, page); return; }
    if (verdict === 'refuse' || request({ url: address, type: 'mainFrame', own: o.ownOrigins() }) === 'block') {
      tab.typed = null;
      tab.failed = { code: 'refused', text: 'refused', address };
      show();
      tell(projectId);
      return;
    }
    tab.typed = address;
    tab.failed = null;
    tab.crashed = false;
    void page.loadURL(address).catch(() => { /* said by did-fail-load */ });
    tell(projectId);
  }

  const api = {
    /** A project's tabs as its page draws them. Every word of it is the app's own reading of the tab. */
    state(/** @type {string} */ projectId) {
      const p = projects.get(projectId);
      return {
        projectId,
        active: p?.active ?? null,
        tabs: (p?.tabs ?? []).map((tab) => {
          const page = tab.view.webContents;
          const gone = page.isDestroyed();
          const address = addressOf(tab);
          return {
            id: tab.id, title: tab.title, loading: tab.loading, crashed: tab.crashed,
            address: shownAddress(address),
            /* an address refused has no host to show: what was asked for, as text */
            failed: tab.failed ? { code: tab.failed.code, text: tab.failed.text, address: shownAddress(tab.failed.address).text || tab.failed.address.slice(0, 300) } : null,
            back: !gone && page.navigationHistory.canGoBack(), forward: !gone && page.navigationHistory.canGoForward(),
            /* the agent driving it now (its name, as the person knows it), and whether the person took it over */
            driver: tab.driver?.name ?? null, held: tab.held,
          };
        }),
        downloads: (p?.downloads ?? []).map((d) => ({ ...d })),
      };
    },

    /**
     * A new tab of a project, at `text` (an address, or words to search for; none: an empty tab). → its id, or null
     * when the project has as many as it may.
     * @param {string} projectId @param {string | null} [text] @param {{ front?: boolean }} [opts]
     */
    open(projectId, text = null, { front = true } = {}) {
      const p = projectOf(projectId);
      if (p.tabs.length >= MOST_TABS || !o.window()) return null;
      const tab = makeTab(projectId);
      p.tabs.splice(p.active ? p.tabs.findIndex((t) => t.id === p.active) + 1 : p.tabs.length, 0, tab);
      if (front || !p.active) p.active = tab.id;
      const address = text ? typedAddress(text) : null;
      if (address) load(projectId, tab, address);
      show();
      tell(projectId);
      return tab.id;
    },
    close(/** @type {string} */ projectId, /** @type {string} */ tabId) {
      const p = projects.get(projectId);
      const at = p?.tabs.findIndex((t) => t.id === tabId) ?? -1;
      if (!p || at < 0) return;
      const [gone] = p.tabs.splice(at, 1);
      if (p.active === tabId) p.active = p.tabs[Math.min(at, p.tabs.length - 1)]?.id ?? null;
      destroy(gone);
      show();
      tell(projectId);
    },
    select(/** @type {string} */ projectId, /** @type {string} */ tabId) {
      const p = projects.get(projectId);
      if (!p?.tabs.some((t) => t.id === tabId)) return;
      p.active = tabId;
      show();
      tell(projectId);
    },
    /** What the person typed in the address field. */
    go(/** @type {string} */ projectId, /** @type {string | null} */ tabId, /** @type {string} */ text) {
      const tab = tabOf(projectId, tabId);
      const address = typedAddress(text);
      if (!tab) return address ? api.open(projectId, text) : null;
      if (!address) { tab.typed = null; tab.failed = { code: 'refused', text: 'refused', address: String(text).slice(0, 300) }; show(); tell(projectId); return tab.id; }
      load(projectId, tab, address);
      return tab.id;
    },
    back(/** @type {string} */ projectId, /** @type {string | null} */ tabId) { const page = tabOf(projectId, tabId)?.view.webContents; if (page && !page.isDestroyed() && page.navigationHistory.canGoBack()) page.navigationHistory.goBack(); },
    forward(/** @type {string} */ projectId, /** @type {string | null} */ tabId) { const page = tabOf(projectId, tabId)?.view.webContents; if (page && !page.isDestroyed() && page.navigationHistory.canGoForward()) page.navigationHistory.goForward(); },
    reload(/** @type {string} */ projectId, /** @type {string | null} */ tabId) {
      const tab = tabOf(projectId, tabId);
      if (!tab || tab.view.webContents.isDestroyed()) return;
      /* a page that failed or crashed is asked for again at the address it was sent to */
      if (tab.failed && tab.failed.code !== 'refused') load(projectId, tab, tab.failed.address);
      else { tab.crashed = false; tab.view.webContents.reload(); }
    },
    stop(/** @type {string} */ projectId, /** @type {string | null} */ tabId) { const page = tabOf(projectId, tabId)?.view.webContents; if (page && !page.isDestroyed()) page.stop(); },
    /** The keyboard to the tab in front (the address field hands it over once the person has gone somewhere). */
    focus(/** @type {string} */ projectId) { const tab = tabOf(projectId, null); if (tab?.shown) tab.view.webContents.focus(); },

    /**
     * Where the page in front shows its project's browser: `bounds` in the window (null: nowhere, its workbench is not
     * shown or something of the page's lies over it). `raise`: put it above the page again (a page just brought to the
     * front lies over everything).
     * @param {string | null} projectId @param {Bounds | null} bounds @param {{ raise?: boolean }} [opts]
     */
    place(projectId, bounds, { raise = false } = {}) {
      const win = o.window();
      const size = win?.getContentBounds();
      const ok = bounds && size && [bounds.x, bounds.y, bounds.width, bounds.height].every((n) => Number.isFinite(n)) && bounds.width >= 40 && bounds.height >= 40;
      placed = {
        projectId,
        bounds: ok && bounds && size ? (() => {
          const x = Math.max(0, Math.round(bounds.x)), y = Math.max(0, Math.round(bounds.y));
          return { x, y, width: Math.max(0, Math.min(Math.round(bounds.width), size.width - x)), height: Math.max(0, Math.min(Math.round(bounds.height), size.height - y)) };
        })() : null,
      };
      show({ raise });
    },
    placedProject: () => placed.projectId,

    /** A project's tabs let go (its tab of the window closed). */
    closeProject(/** @type {string} */ projectId) {
      const p = projects.get(projectId);
      if (!p) return;
      projects.delete(projectId);
      for (const tab of p.tabs) destroy(tab);
      if (placed.projectId === projectId) placed = { projectId: null, bounds: null };
    },
    closeAll() { for (const id of [...projects.keys()]) api.closeProject(id); },
    /** Whether a page is one of the browser's (a web page: nothing of the app's may be asked from it). */
    owns: (/** @type {import('electron').WebContents} */ contents) => byContents.has(contents.id),
    /** A tab's page, for what drives it (the agents' door). */
    pageOf: (/** @type {string} */ projectId, /** @type {string | null} */ tabId = null) => tabOf(projectId, tabId)?.view.webContents ?? null,
    /** Whether a tab is shown in the window now. */
    isShown: (/** @type {string} */ projectId, /** @type {string} */ tabId) => Boolean(tabOf(projectId, tabId)?.shown),
    /** An agent acted on a tab: it says so for a while (its workbench shows who). */
    drivenBy(/** @type {string} */ projectId, /** @type {string} */ tabId, /** @type {string} */ name) {
      const tab = tabOf(projectId, tabId);
      if (!tab) return;
      const was = tab.driver?.name;
      if (tab.driver) clearTimeout(tab.driver.timer);
      tab.driver = { name: String(name).slice(0, 60), timer: setTimeout(() => { tab.driver = null; tell(projectId); }, DRIVEN_MS) };
      tab.driver.timer.unref?.();
      if (was !== tab.driver.name) tell(projectId);
    },
    /** The person takes a tab over from the agent (`held`: the agent's actions on it refused), or hands it back. */
    takeOver(/** @type {string} */ projectId, /** @type {string} */ tabId, held = true) {
      const tab = tabOf(projectId, tabId);
      if (!tab) return;
      tab.held = held;
      if (held && tab.driver) { clearTimeout(tab.driver.timer); tab.driver = null; }
      tell(projectId);
    },
    /**
     * An agent is about to act on a tab: a form the page sends by POST in the next `ms` waits for the person, said to
     * come from `agent`.
     */
    holdPosts(/** @type {string} */ projectId, /** @type {string} */ tabId, /** @type {number} */ ms, /** @type {string} */ agent) {
      const tab = tabOf(projectId, tabId);
      /* each action starts afresh: a yes given to an earlier one lets nothing of this one through */
      if (tab) tab.posts = { heldUntil: Date.now() + ms, by: String(agent).slice(0, 60), allowed: 0, allowedUntil: 0 };
    },
    /** The person said yes to a form: that one is let through (within `ms`), and no other. */
    allowPosts(/** @type {string} */ projectId, /** @type {string} */ tabId, /** @type {number} */ ms) {
      const tab = tabOf(projectId, tabId);
      if (tab) tab.posts = { ...tab.posts, heldUntil: Math.max(tab.posts.heldUntil, Date.now() + ms), allowed: 1, allowedUntil: Date.now() + ms };
    },
    /**
     * The person asked, in the system's dialog, whether a form an agent's action sends goes (what it sends shown, a
     * password never). No is the default, and closing it is a no.
     * @param {{ projectId: string, tabId: string, agent: string, address: string, form: { action: string, button: string | null, fields: Array<{ name: string, value: string }> } }} ask
     * @returns {Promise<boolean>}
     */
    askToSend({ tabId, agent, address, form }) {
      const id = `send ${tabId}`;
      const open = asking.get(id);
      if (open) return open.then((a) => a.allow);
      const w = words();
      const win = o.window();
      const host = shownAddress(address).host || shownAddress(form.action).host || '';
      const to = shownAddress(form.action).text || String(form.action).slice(0, 300);
      const fields = form.fields.filter((f) => f.value).slice(0, 12).map((f) => `${f.name}: ${f.value}`);
      const detail = [w.sendTo.replace('{address}', to), ...(form.button ? [w.sendButton.replace('{button}', form.button)] : []), ...(fields.length ? ['', w.sendFields, ...fields] : [])].join('\n');
      const options = { type: /** @type {const} */ ('question'), title: o.productName, message: w.send.replaceAll('{agent}', agent || w.agent).replaceAll('{host}', host), detail, buttons: [w.sendYes, w.sendNo], defaultId: 1, cancelId: 1, noLink: true };
      const answered = (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))
        .then(({ response }) => ({ allow: response === 0, remember: false }), () => ({ allow: false, remember: false }))
        .finally(() => asking.delete(id));
      asking.set(id, answered);
      return answered.then((a) => a.allow);
    },
    /** Everything the sites kept (cookies, storage, cache) and every answer the person gave, forgotten. */
    async forget() {
      answers = {};
      keepAnswers();
      const s = theSession();
      await s.clearStorageData();
      await s.clearCache();
      await s.clearAuthCache();
    },
  };
  return api;
}
