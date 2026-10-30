/**
 * The window's page: Studio's editor with the chat beside it, one page (shell/). What happens between them happens in
 * the page (shell/bridge.ts); this is only what the app itself does for it: the agents (its own and the person's),
 * a file on the disk, the window, updates. Every call goes through the main process, which checks it comes from this
 * page's own frame.
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

/** A listener for one of the main process's messages; returns how to stop listening. */
const on = (channel) => (listener) => {
  if (typeof listener !== 'function') return () => {};
  const handler = (_event, value) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
const invoke = (channel) => (opts) => ipcRenderer.invoke(channel, opts);

contextBridge.exposeInMainWorld('openfilmNative', {
  platform: process.platform,
  /* the app: its flavour and version, the layout it kept, ffmpeg and updates as they are */
  hello: () => ipcRenderer.invoke('desktop:hello'),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  revealPath: (path) => ipcRenderer.invoke('desktop:reveal', String(path)),
  /* a folder the person picks (Studio's "Open…" on its Projects list, the export's "Save to"): its path, or null */
  pickFolder: (options) => ipcRenderer.invoke('desktop:pick-folder', options ?? null),
  /* part of the window as a JPEG (base64), for a reference's picture: null when it could not be taken */
  capture: (rect) => ipcRenderer.invoke('desktop:capture', rect),

  /* the window's tabs (tabs.mjs), drawn by the page in Studio's top bar */
  tabs: {
    list: () => ipcRenderer.invoke('desktop:tabs:list'),
    onChange: on('desktop:tabs'),
    show: (id) => ipcRenderer.invoke('desktop:tabs:show', { id }),
    close: (id) => ipcRenderer.invoke('desktop:tabs:close', { id }),
    open: (projectId) => ipcRenderer.invoke('desktop:tabs:new', { projectId }),
    move: (id, index) => ipcRenderer.invoke('desktop:tabs:move', { id, index }),
    report: (state) => ipcRenderer.invoke('desktop:tabs:report', state ?? {}),
    gone: (projectIds) => ipcRenderer.invoke('desktop:tabs:gone', { projectIds }),
    retitle: (id, title) => ipcRenderer.invoke('desktop:tabs:retitle', { id, title }),
    openRequest: (to) => ipcRenderer.invoke('desktop:tabs:open', { to }),
    onPick: on('desktop:tabs:pick'),
    onCovered: on('desktop:tabs:covered'),
  },

  /* the roster (agent-roster.mjs): Settings → Agents and the chat's menu */
  agents: {
    list: () => ipcRenderer.invoke('desktop:agents:list'),
    refresh: () => ipcRenderer.invoke('desktop:agents:refresh'),
    connect: (id) => ipcRenderer.invoke('desktop:agents:connect', { id }),
    cancelSignIn: (id) => ipcRenderer.invoke('desktop:agents:cancel-sign-in', { id }),
    disconnect: (id) => ipcRenderer.invoke('desktop:agents:disconnect', { id }),
    /* signed out with its own command, then its sign-in opened (agent-roster.mjs switchAccount) */
    switchAccount: (id) => ipcRenderer.invoke('desktop:agents:switch-account', { id }),
    usage: (id, fresh) => ipcRenderer.invoke('desktop:agents:usage', { id, fresh: fresh === true }),
    setShown: (id, shown) => ipcRenderer.invoke('desktop:agents:shown', { id, shown: shown === true }),
    locate: (id, words) => ipcRenderer.invoke('desktop:agents:locate', { id, words }),
    useAutomatic: (id) => ipcRenderer.invoke('desktop:agents:automatic', { id }),
    install: (id) => ipcRenderer.invoke('desktop:agents:install', { id }),
    diagnose: (id) => ipcRenderer.invoke('desktop:agents:diagnose', { id }),
    openSetup: (id) => ipcRenderer.invoke('desktop:agents:setup', { id }),
    report: () => ipcRenderer.invoke('desktop:agents:report'),
    /* the whole diagnostic report on the clipboard (main.mjs): the chat's, by a turn that failed */
    copyReport: () => ipcRenderer.invoke('desktop:diagnostics:copy'),
    saveOwnModel: (config) => ipcRenderer.invoke('desktop:agents:own-model', { config }),
    removeOwnModel: (id) => ipcRenderer.invoke('desktop:agents:own-model-remove', { id }),
    /* the MCP servers the person added to it themselves, each let into OpenFilm or not (skills-ipc.mjs) */
    mcp: (id) => ipcRenderer.invoke('desktop:agents:mcp', { id }),
    /* the skills the person installed in it themselves, each let into OpenFilm or not */
    skills: (id) => ipcRenderer.invoke('desktop:agents:skills', { id }),
    allowSkill: (id, name, allowed) => ipcRenderer.invoke('desktop:skills:allow', { agent: id, name, allowed: allowed === true }),
    allowMcp: (id, name, allowed) => ipcRenderer.invoke('desktop:agents:mcp-allow', { id, name, allowed: allowed === true }),
    onChange: on('desktop:agents'),
  },
  /* the agents' turns (local-agents-ipc.mjs) */
  localAgents: {
    list: () => ipcRenderer.invoke('desktop:local-agents:list'),
    signIn: (agent) => invoke('desktop:local-agents:sign-in')({ agent }),
    disconnect: (agent) => invoke('desktop:local-agents:disconnect')({ agent }),
    probe: (agent, model) => invoke('desktop:local-agents:probe')({ agent, model }),
    start: (agent, cwd, resume, meta) => invoke('desktop:local-agents:start')({ agent, cwd, resume, meta }),
    prompt: (key, text, meta, images) => invoke('desktop:local-agents:prompt')({ key, text, meta, images }),
    running: () => ipcRenderer.invoke('desktop:local-agents:running'),
    ack: (key, turnId) => invoke('desktop:local-agents:ack')({ key, turnId }),
    steer: (key, text, images) => invoke('desktop:local-agents:steer')({ key, text, images }),
    adopt: (key, turnId, meta) => invoke('desktop:local-agents:adopt')({ key, turnId, meta }),
    cancel: (key) => invoke('desktop:local-agents:cancel')({ key }),
    setOption: (key, configId, value) => invoke('desktop:local-agents:set-option')({ key, configId, value }),
    answerPermission: (key, requestId, optionId) => invoke('desktop:local-agents:permission')({ key, requestId, optionId }),
    answerQuestion: (key, requestId, answers) => invoke('desktop:local-agents:answer')({ key, requestId, answers }),
    close: (key) => invoke('desktop:local-agents:close')({ key }),
    onEvent: on('desktop:local-agents:event'),
  },

  /* the chat's record of a project (chat-store.mjs): conversations, finished turns (.film/chat), each turn's log (.film/logs) */
  chat: {
    load: (project) => ipcRenderer.invoke('desktop:chat:load', { project }),
    saveSessions: (project, sessions, last) => ipcRenderer.invoke('desktop:chat:sessions', { project, sessions, last }),
    saveTurn: (project, turn, items) => ipcRenderer.invoke('desktop:chat:turn', { project, turn, items }),
    log: (project, turnId, unless) => ipcRenderer.invoke('desktop:chat:log', { project, turnId, unless }),
    reveal: (project, turnId) => ipcRenderer.invoke('desktop:chat:reveal', { project, turnId }),
    saveRefImage: (project, turnId, n, bytes) => ipcRenderer.invoke('desktop:chat:ref-image', { project, turnId, n, bytes }),
    saveAttachment: (project, name, bytes) => ipcRenderer.invoke('desktop:chat:attachment', { project, name, bytes }),
    describePaths: (paths) => ipcRenderer.invoke('desktop:chat:paths', { paths }),
    unsaved: (project, except) => ipcRenderer.invoke('desktop:chat:unsaved', { project, except }),
    snapshot: (project, turnId) => ipcRenderer.invoke('desktop:chat:snapshot', { project, turnId }),
    changes: (project, turnId) => ipcRenderer.invoke('desktop:chat:changes', { project, turnId }),
    restoreFilm: (project, turnId) => ipcRenderer.invoke('desktop:chat:restore-film', { project, turnId }),
  },
  /* the composer's Skills button (skills-ipc.mjs) */
  skills: {
    list: (project, agent) => ipcRenderer.invoke('desktop:skills:list', { project, agent }),
    texts: (project, agent, names) => ipcRenderer.invoke('desktop:skills:texts', { project, agent, names }),
    allow: (agent, name, allowed) => ipcRenderer.invoke('desktop:skills:allow', { agent, name, allowed }),
    /* one of OpenFilm's skills turned on or off: the agents' sessions take it up */
    changed: () => ipcRenderer.invoke('desktop:skills:changed'),
    preview: (url) => ipcRenderer.invoke('desktop:skills:preview', { url }),
    /* a folder dropped (its path), or null: one picked in the system's dialog, with the page's words { title, button } */
    previewFolder: (path, words) => ipcRenderer.invoke('desktop:skills:preview', { folder: typeof path === 'string' ? path : null, words }),
    commit: (id, covers) => ipcRenderer.invoke('desktop:skills:commit', { id, covers }),
    discard: (id) => ipcRenderer.invoke('desktop:skills:discard', { id }),
    reveal: () => ipcRenderer.invoke('desktop:skills:reveal'),
  },
  /* the app's own preferences (Settings → Developer) */
  prefs: {
    get: () => ipcRenderer.invoke('desktop:prefs'),
    set: (next) => ipcRenderer.invoke('desktop:prefs:set', next),
    onChange: on('desktop:prefs'),
  },
  /* the chat's column as the person left it, kept for the next launch */
  saveLayout: (layout) => ipcRenderer.send('desktop:layout', { chatOpen: layout?.chatOpen === true, chatWidth: Number(layout?.chatWidth) }),
  /* the page's theme, for the window behind it and the system's menus and dialogs */
  setTheme: (theme) => ipcRenderer.send('desktop:theme', theme === 'dark' ? 'dark' : 'light'),
  /* the page's language, for what the app shows before a page is up */
  setLanguage: (language) => ipcRenderer.send('desktop:language', String(language)),
  onFullScreen: on('desktop:full-screen'),
  /* View → Chat in the app's menu */
  onToggleChat: on('desktop:toggle-chat'),
  /* Native Settings menu and Cmd/Ctrl+,; no renderer can invoke a privileged action here. */
  onOpenSettings: on('desktop:open-settings'),
  onStudioBrowser: on('desktop:studio-browser'),
  onFfmpeg: on('desktop:ffmpeg'),
  onUpdate: on('desktop:update'),
  /* → { ok } | { ok: false, error }: refused while an agent works or Studio exports (the update stays ready) */
  restartToUpdate: () => ipcRenderer.invoke('desktop:update-restart'),
  /* → the update's state (update-controller.mjs), now / after a check made now */
  updateState: () => ipcRenderer.invoke('desktop:update-state'),
  checkForUpdate: () => ipcRenderer.invoke('desktop:update-check'),
});
