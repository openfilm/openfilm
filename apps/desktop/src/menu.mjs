/** The menu bar. Studio's own shortcuts live in its page; these are the window's, its tabs' among them. */
import { Menu } from 'electron';

const mac = process.platform === 'darwin';

/**
 * `updates`: the packaged app's (updates.mjs), for "Check for Updates…" (the app menu on macOS, Help on Windows) and
 * "Beta Updates" (builds before they go to everyone); null from source, which has none.
 * `tabs`: a new tab (its launcher), the one in front closed, the one closed last opened again, the next or previous,
 * the nth (9: the last).
 * @param {{ productName: string, packaged: boolean, toggleChat: () => void, openProject: () => void, reload: () => void,
 *           devTools: () => void,
 *           tabs: { open: () => void, close: () => void, reopen: () => void, step: (by: number) => void, pick: (n: number) => void },
 *           updates?: { check: () => Promise<void>, beta: boolean, setBeta: (on: boolean) => void } | null }} actions
 */
export function applicationMenu({ productName, packaged, toggleChat, openProject, reload, devTools, tabs, updates = null }) {
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
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => tabs.open() },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: openProject },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => tabs.close() },
        { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: () => tabs.reopen() },
      ],
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
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { label: 'Show Next Tab', accelerator: 'Control+Tab', click: () => tabs.step(1) },
        { label: 'Show Previous Tab', accelerator: 'Control+Shift+Tab', click: () => tabs.step(-1) },
        /* ⌘1–⌘9, as in a browser: each a tab, 9 the last */
        ...Array.from({ length: 9 }, (_, i) => ({ label: `Tab ${i + 1}`, accelerator: `CmdOrCtrl+${i + 1}`, visible: false, acceleratorWorksWhenHidden: true, click: () => tabs.pick(i + 1) })),
        ...(mac ? [{ type: 'separator' }, { role: 'front' }] : []),
      ],
    },
    ...(!mac && updateItems.length ? [{ role: 'help', submenu: updateItems }] : []),
  ];
  return Menu.buildFromTemplate(template);
}
