/** The menu bar. Studio's own shortcuts live in its page; these are the window's. */
import { Menu } from 'electron';

const mac = process.platform === 'darwin';

/**
 * `updates`: the packaged app's (updates.mjs), for "Check for Updates…" (the app menu on macOS, Help on Windows) and
 * "Beta Updates" (builds before they go to everyone); null from source, which has none.
 * @param {{ productName: string, packaged: boolean, toggleChat: () => void, openProject: () => void, reload: () => void,
 *           devTools: () => void,
 *           updates?: { check: () => Promise<void>, beta: boolean, setBeta: (on: boolean) => void } | null }} actions
 */
export function applicationMenu({ productName, packaged, toggleChat, openProject, reload, devTools, updates = null }) {
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const updateItems = updates ? [
    {
      label: 'Check for Updates…',
      /* off while its dialog is up, so a second click does not queue another */
      click: async (item) => {
        item.enabled = false;
        try { await updates.check(); } finally { item.enabled = true; }
      },
    },
    { label: 'Beta Updates', type: 'checkbox', checked: updates.beta, click: (item) => updates.setBeta(item.checked) },
  ] : [];
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(mac ? [{
      label: productName,
      submenu: [
        { role: 'about' },
        ...updateItems,
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [{ label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: openProject }],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Show Chat', type: 'normal', accelerator: 'CmdOrCtrl+Shift+L', click: toggleChat },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(packaged ? [] : [
          { type: 'separator' },
          { label: 'Reload', accelerator: 'CmdOrCtrl+Shift+R', click: reload },
          { label: 'Developer Tools', accelerator: 'Alt+CmdOrCtrl+I', click: () => devTools() },
        ]),
      ],
    },
    { role: 'windowMenu' },
    ...(!mac && updateItems.length ? [{ role: 'help', submenu: updateItems }] : []),
  ];
  return Menu.buildFromTemplate(template);
}
