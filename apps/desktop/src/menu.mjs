/**
 * Pure native menu template, built by Electron in main.mjs, in Studio's language. Studio's editing shortcuts stay in
 * its page.
 */
import { MENU_WORDS } from './i18n/menu.mjs';

/**
 * `language`: one of Studio's (i18n/language.mjs `appLanguage`). Every item is named in it, Electron's role items too:
 * Electron names those in English whatever the system's language.
 * `updates`: the packaged app's (updates.mjs), for "Check for Updates…" (the app menu on macOS, Help on Windows) and
 * "Beta Updates" (builds before they go to everyone); null from source, which has none.
 * `tabs`: a new tab (its launcher), the one in front closed, the one closed last opened again, the next or previous,
 * the nth (9: the last).
 * @param {{ productName: string, packaged: boolean, language?: string, toggleChat: () => void, openProject: () => void,
 *           reload: () => void, devTools: () => void, openSettings: () => void,
 *           tabs: { open: () => void, close: () => void, reopen: () => void, step: (by: number) => void, pick: (n: number) => void },
 *           updates?: { check: () => Promise<void>, beta: boolean, setBeta: (on: boolean) => void } | null }} actions
 * @returns {Electron.MenuItemConstructorOptions[]}
 */
export function applicationMenuTemplate({ productName, packaged, language = 'en', toggleChat, openProject, reload, devTools, openSettings, tabs, updates = null }, platform = process.platform) {
  const mac = platform === 'darwin';
  const words = MENU_WORDS[language] ?? MENU_WORDS.en;
  /** @param {keyof typeof MENU_WORDS.en} key */
  const say = (key) => words[key].replaceAll('{name}', productName);
  /** @type {Electron.MenuItemConstructorOptions} */
  const settings = { label: say('settings'), accelerator: 'CmdOrCtrl+,', click: openSettings };
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const updateItems = updates ? [
    {
      label: say('checkForUpdates'),
      /* off while its dialog is up, so a second click does not queue another */
      click: async (item) => {
        item.enabled = false;
        try { await updates.check(); } finally { item.enabled = true; }
      },
    },
    { label: say('betaUpdates'), type: 'checkbox', checked: updates.beta, click: (item) => updates.setBeta(item.checked) },
  ] : [];
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const editItems = [
    { role: 'undo', label: say('undo') },
    { role: 'redo', label: say('redo') },
    { type: 'separator' },
    { role: 'cut', label: say('cut') },
    { role: 'copy', label: say('copy') },
    { role: 'paste', label: say('paste') },
    ...(mac ? /** @type {Electron.MenuItemConstructorOptions[]} */ ([
      { role: 'pasteAndMatchStyle', label: say('pasteAndMatchStyle') },
      { role: 'delete', label: say('delete') },
      { role: 'selectAll', label: say('selectAll') },
      { type: 'separator' },
      {
        label: say('substitutions'),
        submenu: [
          { role: 'showSubstitutions', label: say('showSubstitutions') },
          { type: 'separator' },
          { role: 'toggleSmartQuotes', label: say('smartQuotes') },
          { role: 'toggleSmartDashes', label: say('smartDashes') },
          { role: 'toggleTextReplacement', label: say('textReplacement') },
        ],
      },
      {
        label: say('speech'),
        submenu: [
          { role: 'startSpeaking', label: say('startSpeaking') },
          { role: 'stopSpeaking', label: say('stopSpeaking') },
        ],
      },
    ]) : [
      { role: 'delete', label: say('delete') },
      { type: 'separator' },
      { role: 'selectAll', label: say('selectAll') },
    ]),
  ];
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(mac ? [{
      label: productName,
      submenu: [
        { role: 'about', label: say('about') },
        ...updateItems,
        { type: 'separator' },
        settings,
        { type: 'separator' },
        { role: 'services', label: say('services') },
        { type: 'separator' },
        { role: 'hide', label: say('hide') },
        { role: 'hideOthers', label: say('hideOthers') },
        { role: 'unhide', label: say('showAll') },
        { type: 'separator' },
        { role: 'quit', label: say('quit') },
      ],
    }] : []),
    {
      label: say('file'),
      submenu: [
        { label: say('newTab'), accelerator: 'CmdOrCtrl+T', click: () => tabs.open() },
        { label: say('openProject'), accelerator: 'CmdOrCtrl+O', click: openProject },
        ...(!mac ? [{ type: 'separator' }, settings] : []),
        { type: 'separator' },
        { label: say('closeTab'), accelerator: 'CmdOrCtrl+W', click: () => tabs.close() },
        { label: say('reopenClosedTab'), accelerator: 'CmdOrCtrl+Shift+T', click: () => tabs.reopen() },
      ],
    },
    { label: say('edit'), submenu: editItems },
    {
      label: say('view'),
      submenu: [
        { label: say('showChat'), type: 'normal', accelerator: 'CmdOrCtrl+Shift+L', click: toggleChat },
        { type: 'separator' },
        { role: 'resetZoom', label: say('actualSize') },
        { role: 'zoomIn', label: say('zoomIn') },
        { role: 'zoomOut', label: say('zoomOut') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: say('toggleFullScreen') },
        ...(packaged ? [] : [
          { type: 'separator' },
          { label: say('reload'), accelerator: 'CmdOrCtrl+Shift+R', click: reload },
          { label: say('developerTools'), accelerator: 'Alt+CmdOrCtrl+I', click: () => devTools() },
        ]),
      ],
    },
    {
      label: say('window'),
      submenu: [
        /* Studio's export reads Cmd+M in the editor. */
        { role: 'minimize', label: say('minimize'), ...(mac ? { accelerator: 'Alt+Cmd+M' } : {}) },
        { role: 'zoom', label: say('zoom') },
        { type: 'separator' },
        { label: say('showNextTab'), accelerator: 'Control+Tab', click: () => tabs.step(1) },
        { label: say('showPreviousTab'), accelerator: 'Control+Shift+Tab', click: () => tabs.step(-1) },
        /* ⌘1–⌘9, as in a browser: each a tab, 9 the last (hidden, so never read) */
        ...Array.from({ length: 9 }, (_, i) => ({ label: `Tab ${i + 1}`, accelerator: `CmdOrCtrl+${i + 1}`, visible: false, acceleratorWorksWhenHidden: true, click: () => tabs.pick(i + 1) })),
        ...(mac ? [{ type: 'separator' }, { role: 'front', label: say('bringAllToFront') }] : []),
      ],
    },
    ...(!mac && updateItems.length ? [{ role: 'help', label: say('help'), submenu: updateItems }] : []),
  ];
  return template;
}
