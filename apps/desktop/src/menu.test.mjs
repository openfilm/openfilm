import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, appLanguage } from './i18n/language.mjs';
import { MENU_WORDS } from './i18n/menu.mjs';
import { UPDATE_DIALOG_WORDS } from './i18n/update-dialogs.mjs';
import { applicationMenuTemplate, contextMenuTemplate } from './menu.mjs';
import { createManualUpdateCheck } from './update-menu.mjs';

function fixture(platform, packaged = true, updates = null) {
  let opened = 0;
  const noop = () => {};
  const menu = applicationMenuTemplate({
    productName: 'OpenFilm', packaged, toggleChat: noop, openProject: noop,
    reload: noop, devTools: noop, openSettings: () => { opened++; },
    tabs: { open: noop, close: noop, reopen: noop, step: noop, pick: noop },
    updates,
  }, platform);
  return { menu, opened: () => opened };
}
for (const platform of ['darwin', 'win32', 'linux']) {
  for (const packaged of [true, false]) {
    test(`Settings is discoverable and has its native accelerator on ${platform}, packaged=${packaged}`, () => {
      const f = fixture(platform, packaged);
      const parent = f.menu.find((item) => item.label === (platform === 'darwin' ? 'OpenFilm' : 'File'));
      const settings = parent.submenu.find((item) => item.label === 'Settings…');
      assert.equal(settings.accelerator, 'CmdOrCtrl+,');
      assert.notEqual(settings.enabled, false);
      settings.click();
      assert.equal(f.opened(), 1);
      assert.equal(f.menu.flatMap((item) => Array.isArray(item.submenu) ? item.submenu : []).filter((item) => item.label === 'Settings…').length, 1);
    });
  }
}

for (const updates of [null, { check: async () => {}, beta: false, setBeta: () => {} }]) {
  test(`macOS puts updates before Settings and Services after it, updates=${!!updates}`, () => {
    const { menu } = fixture('darwin', true, updates);
    const items = menu.find((item) => item.label === 'OpenFilm').submenu;
    const settings = items.findIndex((item) => item.label === 'Settings…');
    const services = items.findIndex((item) => item.role === 'services');
    assert.equal(items[0].role, 'about');
    assert.equal(items[settings - 1].type, 'separator');
    assert.equal(items[settings + 1].type, 'separator');
    assert.equal(services, settings + 2);
    if (updates) {
      const check = items.findIndex((item) => item.label === 'Check for Updates…');
      const channel = items.findIndex((item) => item.type === 'checkbox');
      assert.ok(check > 0 && check < settings);
      assert.ok(channel > check && channel < settings);
    } else {
      assert.equal(settings, 2);
    }
  });
}

const noop = () => {};
const build = (language, platform, { packaged = false, updates = true } = {}) => applicationMenuTemplate({
  productName: 'OpenFilm', packaged, language, toggleChat: noop, openProject: noop, reload: noop, devTools: noop, openSettings: noop,
  tabs: { open: noop, close: noop, reopen: noop, step: noop, pick: noop },
  updates: updates ? { check: async () => {}, beta: false, setBeta: noop } : null,
}, platform);
/** every item the menu bar shows, submenus included (separators and the hidden ⌘1–⌘9 left out) */
const shown = (items) => items.flatMap((item) => (item.type === 'separator' || item.visible === false ? []
  : [item, ...(Array.isArray(item.submenu) ? shown(item.submenu) : [])]));

test('the menu speaks the page\'s language, else the system\'s as Studio picks it', () => {
  assert.equal(appLanguage('zh-CN', ['en-US']), 'zh-CN');
  assert.equal(appLanguage(null, ['en-US', 'zh-Hans-US']), 'en');
  assert.equal(appLanguage(null, ['zh-Hans-CN', 'en-US']), 'zh-CN');
  assert.equal(appLanguage(null, ['zh-Hant-TW', 'ja-JP']), 'ja');
  assert.equal(appLanguage('fr', ['ko-KR']), 'ko');
  assert.equal(appLanguage(undefined, ['es-MX']), 'es');
  assert.equal(appLanguage(null, ['de-DE']), 'en');
  assert.equal(appLanguage(null), 'en');
  const [app, file] = build('zh-CN', 'darwin');
  assert.equal(app.label, 'OpenFilm');
  assert.equal(file.label, '文件');
  assert.deepEqual(shown(app.submenu).map((item) => item.label), ['关于 OpenFilm', '检查更新…', 'Beta 版更新', '设置…', '服务', '隐藏 OpenFilm', '隐藏其他', '全部显示', '退出 OpenFilm']);
  assert.equal(build('xx', 'darwin')[1].label, 'File');
});

test('every language names every item, Electron\'s role items too, on macOS and elsewhere', () => {
  const keys = Object.keys(MENU_WORDS.en).sort();
  assert.deepEqual(Object.keys(MENU_WORDS).sort(), [...LANGUAGES].sort());
  const used = new Set();
  for (const language of LANGUAGES) {
    const words = MENU_WORDS[language];
    assert.deepEqual(Object.keys(words).sort(), keys, language);
    for (const key of keys) assert.ok(words[key].trim(), `${language} ${key}`);
    const named = new Map(Object.entries(words).map(([key, text]) => [text.replaceAll('{name}', 'OpenFilm'), key]));
    for (const platform of ['darwin', 'win32']) {
      const template = build(language, platform);
      if (platform === 'darwin') assert.equal(template[0].label, 'OpenFilm');
      for (const item of shown(platform === 'darwin' ? template.slice(1) : template).concat(platform === 'darwin' ? shown(template[0].submenu) : [])) {
        assert.ok(named.has(item.label), `${language} ${platform}: "${item.label}" (${item.role ?? 'item'}) is not in its words`);
        used.add(named.get(item.label));
      }
    }
  }
  assert.deepEqual([...used].sort(), keys, 'every word is used');
});

test('Check for Updates is in the app menu on macOS, in Help elsewhere, and only in a packaged app\'s menu', () => {
  const labels = (template) => shown(template).map((item) => item.label);
  assert.ok(labels(build('ja', 'darwin')[0].submenu).includes('アップデートを確認…'));
  assert.deepEqual(labels([build('ko', 'win32').at(-1)]), ['도움말', '업데이트 확인…', '베타 업데이트']);
  assert.ok(!labels(build('en', 'darwin', { updates: false })).includes('Check for Updates…'));
  assert.ok(!labels(build('en', 'win32', { updates: false })).includes('Help'));
  assert.ok(!labels(build('es', 'darwin', { packaged: true })).includes('Herramientas para desarrolladores'));
});

test('the update dialogs have every line in every language', async () => {
  const keys = Object.keys(UPDATE_DIALOG_WORDS.en).sort();
  const errors = Object.keys(UPDATE_DIALOG_WORDS.en.errors).sort();
  assert.deepEqual(Object.keys(UPDATE_DIALOG_WORDS).sort(), [...LANGUAGES].sort());
  for (const language of LANGUAGES) {
    const words = UPDATE_DIALOG_WORDS[language];
    assert.deepEqual(Object.keys(words).sort(), keys, language);
    assert.deepEqual(Object.keys(words.errors).sort(), errors, language);
  }
  const messages = [];
  const check = (state) => createManualUpdateCheck({
    controller: { check: async () => state, restart: async () => ({ ok: false, error: 'agent-busy' }) },
    showMessage: async (m) => { messages.push(m); return { response: 0 }; }, focusWindow: noop,
  });
  await check({ status: 'current', version: '0.2.3', channel: 'beta' })('zh-CN');
  await check({ status: 'downloading' })('ja');
  await check({ status: 'ready', availableVersion: '0.2.4' })('ko');
  await check({ status: 'error', error: 'offline' })('es');
  assert.deepEqual(messages.map((m) => [m.title, m.message, m.detail, m.buttons]), [
    ['检查更新', 'OpenFilm 已是最新版本', '版本 0.2.3（Beta）', ['好']],
    ['アップデートを確認', 'OpenFilm をダウンロードしています', UPDATE_DIALOG_WORDS.ja.downloadingDetail, ['OK']],
    ['업데이트 확인', 'OpenFilm 0.2.4 준비가 끝났습니다', UPDATE_DIALOG_WORDS.ko.readyDetail, ['재시작', '나중에']],
    ['업데이트 확인', '아직 재시작할 수 없습니다', UPDATE_DIALOG_WORDS.ko.errors['agent-busy'], ['확인']],
    ['Buscar actualizaciones', 'No se pudo buscar actualizaciones', `${UPDATE_DIALOG_WORDS.es.errors.offline} OpenFilm también lo volverá a intentar por sí solo.`, ['Aceptar']],
  ]);
});

test('contextMenuTemplate shows Copy for non-editable text selections across all languages', () => {
  for (const language of LANGUAGES) {
    const words = MENU_WORDS[language];
    assert.deepEqual(contextMenuTemplate({ selectionText: 'hello' }, language), [{ role: 'copy', label: words.copy }]);
  }
  assert.deepEqual(contextMenuTemplate({ selectionText: 'hello' }, 'xx'), [{ role: 'copy', label: MENU_WORDS.en.copy }]);
});

test('contextMenuTemplate shows Cut, Copy, Paste, and Select All for editable fields with matching enabled states', () => {
  for (const language of LANGUAGES) {
    const words = MENU_WORDS[language];
    assert.deepEqual(
      contextMenuTemplate(
        { isEditable: true, editFlags: { canCut: false, canCopy: true, canPaste: true, canSelectAll: true } },
        language,
      ),
      [
        { role: 'cut', label: words.cut, enabled: false },
        { role: 'copy', label: words.copy, enabled: true },
        { role: 'paste', label: words.paste, enabled: true },
        { type: 'separator' },
        { role: 'selectAll', label: words.selectAll, enabled: true },
      ],
    );
  }
  assert.deepEqual(
    contextMenuTemplate({ isEditable: true, selectionText: 'selected', editFlags: { canCut: true, canCopy: false, canPaste: false, canSelectAll: false } }),
    [
      { role: 'cut', label: MENU_WORDS.en.cut, enabled: true },
      { role: 'copy', label: MENU_WORDS.en.copy, enabled: true },
      { role: 'paste', label: MENU_WORDS.en.paste, enabled: false },
      { type: 'separator' },
      { role: 'selectAll', label: MENU_WORDS.en.selectAll, enabled: false },
    ],
  );
  assert.deepEqual(
    contextMenuTemplate({ isEditable: true }),
    [
      { role: 'cut', label: MENU_WORDS.en.cut, enabled: false },
      { role: 'copy', label: MENU_WORDS.en.copy, enabled: false },
      { role: 'paste', label: MENU_WORDS.en.paste, enabled: false },
      { type: 'separator' },
      { role: 'selectAll', label: MENU_WORDS.en.selectAll, enabled: true },
    ],
  );
});

test('contextMenuTemplate returns an empty array for empty or whitespace non-editable clicks', () => {
  assert.deepEqual(contextMenuTemplate(), []);
  assert.deepEqual(contextMenuTemplate({}), []);
  assert.deepEqual(contextMenuTemplate({ isEditable: false, selectionText: '' }), []);
  assert.deepEqual(contextMenuTemplate({ isEditable: false, selectionText: '   \n\t ' }), []);
});
