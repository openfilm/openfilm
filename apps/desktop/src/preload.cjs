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
  /* a folder the person picks (Studio's "Open…" on its Projects list): its path, or null */
  pickFolder: () => ipcRenderer.invoke('desktop:pick-folder'),
  /* part of the window as a JPEG (base64), for a reference's picture: null when it could not be taken */
  capture: (rect) => ipcRenderer.invoke('desktop:capture', rect),

  /* the roster (agent-roster.mjs): Settings → Agents and the chat's menu */
  agents: {
    list: () => ipcRenderer.invoke('desktop:agents:list'),
    connect: (id) => ipcRenderer.invoke('desktop:agents:connect', { id }),
    disconnect: (id) => ipcRenderer.invoke('desktop:agents:disconnect', { id }),
    setShown: (id, shown) => ipcRenderer.invoke('desktop:agents:shown', { id, shown: shown === true }),
    configureByok: (config) => ipcRenderer.invoke('desktop:agents:byok', { config }),
    onChange: on('desktop:agents'),
  },
  /* the agents' turns (local-agents-ipc.mjs) */
  localAgents: {
    list: () => ipcRenderer.invoke('desktop:local-agents:list'),
    signIn: (agent) => invoke('desktop:local-agents:sign-in')({ agent }),
    disconnect: (agent) => invoke('desktop:local-agents:disconnect')({ agent }),
    probe: (agent) => invoke('desktop:local-agents:probe')({ agent }),
    start: (agent, cwd) => invoke('desktop:local-agents:start')({ agent, cwd }),
    prompt: (key, text, meta, images) => invoke('desktop:local-agents:prompt')({ key, text, meta, images }),
    running: () => ipcRenderer.invoke('desktop:local-agents:running'),
    ack: (key, turnId) => invoke('desktop:local-agents:ack')({ key, turnId }),
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
    log: (project, turnId) => ipcRenderer.invoke('desktop:chat:log', { project, turnId }),
    reveal: (project, turnId) => ipcRenderer.invoke('desktop:chat:reveal', { project, turnId }),
    saveRefImage: (project, turnId, n, bytes) => ipcRenderer.invoke('desktop:chat:ref-image', { project, turnId, n, bytes }),
  },
  /* the app's own preferences (Settings → Developer) */
  prefs: {
    get: () => ipcRenderer.invoke('desktop:prefs'),
    set: (next) => ipcRenderer.invoke('desktop:prefs:set', next),
    onChange: on('desktop:prefs'),
  },
  /* a file on the disk brought into the project (the page has no way to read it) */
  importFile: (request) => ipcRenderer.invoke('desktop:import-file', request),
  /* the chat's column as the person left it, kept for the next launch */
  saveLayout: (layout) => ipcRenderer.send('desktop:layout', { chatOpen: layout?.chatOpen === true, chatWidth: Number(layout?.chatWidth) }),
  /* the page's theme, for the window behind it and the system's menus and dialogs */
  setTheme: (theme) => ipcRenderer.send('desktop:theme', theme === 'dark' ? 'dark' : 'light'),
  onFullScreen: on('desktop:full-screen'),
  /* View → Chat in the app's menu */
  onToggleChat: on('desktop:toggle-chat'),
  onStudioBrowser: on('desktop:studio-browser'),
  onFfmpeg: on('desktop:ffmpeg'),
  onUpdate: on('desktop:update'),
  /* → { ok } | { ok: false, error }: refused while an agent works or Studio exports (the update stays ready) */
  restartToUpdate: () => ipcRenderer.invoke('desktop:update-restart'),
});
