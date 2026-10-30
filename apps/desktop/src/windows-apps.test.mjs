import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterFirstReading, parseWindowsApps, windowsAppsReader } from './windows-apps.mjs';

test('Windows app registrations retain custom folders, quoted paths, spaces and non-ASCII names', () => {
  const apps = parseWindowsApps(String.raw`
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\deepseek
    DisplayName    REG_SZ    DeepSeek Harness 0.2.1-rc.3
    InstallLocation    REG_SZ    "D:\Apps\DeepSeek Harness"
    DisplayIcon    REG_SZ    "D:\Apps\DeepSeek Harness\DeepSeek Harness.exe",0

HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall\opencode
    DisplayName    REG_SZ    OpenCode 2.1.4
    DisplayIcon    REG_SZ    D:\Apps\视频工具\OpenCode.exe,0
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\minimax
    DisplayName    REG_SZ    MiniMax Code 3.1.4
    DisplayIcon    REG_SZ    D:\Apps\MiniMax Code\uninstallerIcon.ico
`);
  assert.deepEqual(apps, [
    { name: 'DeepSeek Harness 0.2.1-rc.3', directories: [String.raw`D:\Apps\DeepSeek Harness`] },
    { name: 'OpenCode 2.1.4', directories: [String.raw`D:\Apps\视频工具`] },
    { name: 'MiniMax Code 3.1.4', directories: [String.raw`D:\Apps\MiniMax Code`] },
  ]);
});

test('registrations expand environment paths without treating uninstall commands as locations', () => {
  const apps = parseWindowsApps(String.raw`
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\copilot
    DisplayName    REG_SZ    GitHub Copilot
    InstallLocation    REG_EXPAND_SZ    %LOCALAPPDATA%\Programs\GitHub Copilot
    UninstallString    REG_SZ    "D:\Other\uninstall.exe" --remove
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\incomplete
    DisplayName    REG_SZ    Cursor
    InstallLocation    REG_SZ    relative\folder
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\nameless
    DisplayIcon    REG_SZ    D:\Other\Other.exe,0
`, { LocalAppData: String.raw`D:\Local` });
  assert.deepEqual(apps, [{ name: 'GitHub Copilot', directories: [String.raw`D:\Local\Programs\GitHub Copilot`] }]);
});

const REGISTERED = (name, dir) => `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\${name}\n    DisplayName    REG_SZ    ${name}\n    InstallLocation    REG_SZ    ${dir}\n`;
/** A reg query whose answers the test gives: each key's call waits until `answer()` */
function slowRegistry(texts) {
  const calls = [];
  let release;
  let gate = new Promise((done) => { release = done; });
  const query = (key) => { calls.push(key); return gate.then(() => texts[calls.length % texts.length] ?? texts[0]); };
  return { calls, query, answer: () => { release(); gate = new Promise((done) => { release = done; }); } };
}

test('the registrations are read in the background: the look answers at once, with what was read last', async () => {
  const registry = slowRegistry([REGISTERED('DeepSeek Harness', String.raw`D:\Apps\DeepSeek Harness`)]);
  const reader = windowsAppsReader({ query: registry.query, platform: 'win32', env: {} });
  assert.deepEqual(reader.installed(), [], 'nothing read yet, and nothing waited for');
  assert.equal(registry.calls.length, 3, 'the three uninstall keys');
  assert.deepEqual(reader.installed(), [], 'still reading: not asked again');
  assert.equal(registry.calls.length, 3);
  registry.answer();
  const apps = await reader.refresh();
  assert.equal(apps.length, 3);
  assert.deepEqual(reader.installed()[0], { name: 'DeepSeek Harness', directories: [String.raw`D:\Apps\DeepSeek Harness`] });
});

test('registrations older than their age are read again while the old ones are still answered', async () => {
  let clock = 0;
  const texts = { now: REGISTERED('OpenCode', String.raw`D:\Old`) };
  const reader = windowsAppsReader({ query: async () => texts.now, platform: 'win32', env: {}, now: () => clock, maxAgeMs: 10_000 });
  await reader.refresh();
  texts.now = REGISTERED('OpenCode', String.raw`D:\New`);
  clock = 5_000;
  assert.equal(reader.installed()[0].directories[0], String.raw`D:\Old`, 'young enough: kept');
  clock = 11_000;
  assert.equal(reader.installed()[0].directories[0], String.raw`D:\Old`, 'too old: answered, and read again behind it');
  await reader.refresh({ maxAge: 10_000 });
  assert.equal(reader.installed()[0].directories[0], String.raw`D:\New`);
  clock = 12_000;
  await reader.refresh({ maxAge: 0 });
  assert.equal(reader.installed()[0].directories[0], String.raw`D:\New`, 'read at once when asked to');
});

test('a key that is missing, unreadable or too slow leaves out only its own apps', async () => {
  const reader = windowsAppsReader({
    platform: 'win32', env: {},
    query: async (key) => (key.startsWith('HKCU') ? REGISTERED('Kimi Code', String.raw`D:\Kimi`) : key.includes('WOW6432Node') ? null : Promise.reject(new Error('Access is denied'))),
  });
  assert.deepEqual(await reader.refresh(), [{ name: 'Kimi Code', directories: [String.raw`D:\Kimi`] }]);
});

test('only Windows has the registrations read', async () => {
  let asked = 0;
  const reader = windowsAppsReader({ query: async () => { asked += 1; return ''; }, platform: 'darwin' });
  assert.deepEqual(reader.installed(), []);
  assert.deepEqual(await reader.refresh(), []);
  assert.equal(asked, 0);
});

test('the first reading is waited for however long it takes, and only that one', async () => {
  let clock = 0;
  const registry = slowRegistry([REGISTERED('DeepSeek Harness', String.raw`D:\Apps\DeepSeek Harness`)]);
  const reader = windowsAppsReader({ query: registry.query, platform: 'win32', env: {}, now: () => clock });
  assert.equal(reader.wasRead(), false);
  let done = false;
  const first = reader.first().then((apps) => { done = true; return apps; });
  await new Promise((settle) => setTimeout(settle, 20));
  assert.equal(done, false, 'still reading: waited for, with no cap');
  registry.answer();
  assert.equal((await first).length, 3);
  assert.equal(reader.wasRead(), true);
  clock = 60_000;
  const calls = registry.calls.length;
  assert.equal((await reader.first()).length, 3, 'read a minute ago: answered at once');
  assert.equal(registry.calls.length, calls, 'and not read again');
});

test('a program not found before the first reading is looked for again once it is in', async () => {
  const registry = slowRegistry([REGISTERED('DeepSeek Harness', String.raw`D:\Apps\DeepSeek Harness`)]);
  const reader = windowsAppsReader({ query: registry.query, platform: 'win32', env: {} });
  let looks = 0;
  const find = () => { looks += 1; return reader.installed().find((app) => app.name === 'DeepSeek Harness') ?? null; };
  const found = afterFirstReading(find, { reader });
  registry.answer();
  assert.equal((await found)?.name, 'DeepSeek Harness');
  assert.equal(looks, 2, 'before the reading, and after it');
  looks = 0;
  assert.equal((await afterFirstReading(find, { reader }))?.name, 'DeepSeek Harness');
  assert.equal(looks, 1, 'found: looked once');
  looks = 0;
  assert.equal(await afterFirstReading(() => { looks += 1; return null; }, { reader }), null);
  assert.equal(looks, 1, 'read already: not found is not found');
});

test('off Windows a program is looked for once', async () => {
  const reader = windowsAppsReader({ query: async () => '', platform: 'darwin' });
  let looks = 0;
  assert.equal(await afterFirstReading(() => { looks += 1; return null; }, { reader }), null);
  assert.equal(looks, 1);
});
