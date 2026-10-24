import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  childEnvironment, environmentCache, expandWindowsVars, lastPathSource, loginShellVariables, macProxy, noProxyList, parseRegQuery,
  parseScutilProxy, proxyVariables, regQuery, registryVariables, shellSubset, shellVariables, windowsFreshPath, windowsProxy, withSystemProxy,
} from './environment.mjs';

const PROFILE = ['C:', 'Users', 'someone'].join('\\');

const USER = `\r
HKEY_CURRENT_USER\\Environment\r
    Path    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;%NVM_HOME%;%NVM_SYMLINK%;C:\\Users\\someone\\AppData\\Roaming\\npm\r
    NVM_HOME    REG_SZ    C:\\Users\\someone\\AppData\\Local\\nvm\r
    NVM_SYMLINK    REG_SZ    C:\\nvm4w\\nodejs\r
    OneDrive Consumer    REG_SZ    C:\\Users\\someone\\OneDrive\r
    TEMP    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Local\\Temp\r
    Count    REG_DWORD    0x1\r
`;

test('reg query output is read: text values by name, other kinds left out', () => {
  const values = parseRegQuery(USER);
  assert.equal(values.NVM_SYMLINK, 'C:\\nvm4w\\nodejs');
  assert.equal(values['OneDrive Consumer'], 'C:\\Users\\someone\\OneDrive');
  assert.match(values.Path, /^%USERPROFILE%\\AppData/);
  assert.equal(values.Count, undefined);
  assert.deepEqual(parseRegQuery(''), {});
});

test('%VARIABLES% are expanded whatever their case; one not set stays as it is', () => {
  assert.equal(expandWindowsVars('%userprofile%\\bin;%NOPE%\\x', { USERPROFILE: PROFILE }), `${PROFILE}\\bin;%NOPE%\\x`);
});

test("the PATH a program started now gets: the system's, the person's (with their own variables), then the app's own", () => {
  const machine = { Path: '%SystemRoot%\\system32;C:\\Program Files\\nodejs\\', SystemRoot: 'C:\\Windows' };
  const user = parseRegQuery(USER);
  const source = { Path: 'C:\\Windows\\System32;C:\\Old\\stale', USERPROFILE: PROFILE };
  assert.equal(windowsFreshPath({ machine, user, source }), [
    'C:\\Windows\\system32', 'C:\\Program Files\\nodejs\\',
    'C:\\Users\\someone\\AppData\\Local\\Microsoft\\WindowsApps', 'C:\\Users\\someone\\AppData\\Local\\nvm', 'C:\\nvm4w\\nodejs', 'C:\\Users\\someone\\AppData\\Roaming\\npm',
    'C:\\Old\\stale',
  ].join(';'));
});

test("the registry's variables are handed on expanded, so an agent finds cmd.exe through ComSpec", () => {
  const machine = { ComSpec: '%SystemRoot%\\system32\\cmd.exe', SystemRoot: 'C:\\Windows', Path: '%SystemRoot%\\system32' };
  const user = parseRegQuery(USER);
  const env = registryVariables({ machine, user, source: { USERPROFILE: PROFILE } });
  assert.equal(env.ComSpec, 'C:\\Windows\\system32\\cmd.exe');
  assert.equal(env.TEMP, `${PROFILE}\\AppData\\Local\\Temp`);
  assert.equal(env.Path, undefined, 'one PATH only');
  assert.match(env.PATH, /^C:\\Windows\\system32;/);
});

test('only REG_EXPAND_SZ values are expanded, as Windows does: a REG_SZ one keeps its %VARIABLE% as it is', () => {
  const machine = new Set();
  const user = new Set();
  const env = registryVariables({
    machine: parseRegQuery([
      '    ComSpec    REG_EXPAND_SZ    %SystemRoot%\\system32\\cmd.exe',
      '    Literal    REG_SZ    %SystemRoot%\\kept',
      '    Path    REG_SZ    %SystemRoot%\\system32;C:\\Tools',
      '    SystemRoot    REG_SZ    C:\\Windows',
    ].join('\r\n'), machine),
    user: parseRegQuery(USER, user),
    source: { USERPROFILE: PROFILE },
    expand: { machine, user },
  });
  assert.deepEqual([...machine], ['ComSpec']);
  assert.equal(env.ComSpec, 'C:\\Windows\\system32\\cmd.exe');
  assert.equal(env.Literal, '%SystemRoot%\\kept');
  assert.equal(env.TEMP, `${PROFILE}\\AppData\\Local\\Temp`);
  assert.match(env.PATH, /^%SystemRoot%\\system32;C:\\Tools;C:\\Users\\someone\\AppData\\Local\\Microsoft\\WindowsApps;/);
});

test("on Windows, an agent given this machine's registry environment starts cmd.exe through ComSpec", { skip: process.platform !== 'win32' }, async () => {
  const env = childEnvironment({ shell: await loginShellVariables({ maxAgeMs: 0 }) });
  assert.equal(lastPathSource(), 'registry');
  const comspec = Object.entries(env).filter(([k]) => k.toLowerCase() === 'comspec');
  assert.equal(comspec.length, 1, 'one ComSpec');
  assert.doesNotMatch(comspec[0][1], /%/);
  assert.ok(existsSync(comspec[0][1]), comspec[0][1]);
  /* what an agent does with it: Node runs a shell command through its own ComSpec */
  const r = spawnSync(process.execPath, ['-e', "process.stdout.write(require('node:child_process').execSync('echo ok', { encoding: 'utf8' }))"], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'ok');
});

test("on Windows, a registry value naming folders in Chinese reads as it is, whatever the console's code page", { skip: process.platform !== 'win32' }, async () => {
  const key = `HKCU\\Software\\OpenFilm test ${process.pid}`;
  const path = 'E:\\软件安装;D:\\工具\\bin;C:\\plain';
  const reg = (...args) => spawnSync('reg.exe', args, { windowsHide: true });
  assert.equal(reg('add', key, '/v', 'Path', '/t', 'REG_EXPAND_SZ', '/d', path, '/f').status, 0);
  try {
    const read = await regQuery(key, 10_000);
    assert.equal(read?.values.Path, path);
    assert.ok(read?.expandable.has('Path'));
  } finally {
    reg('delete', key, '/f');
  }
});

test('the environment is read again once it is old, sooner when asked; a failed read keeps the last good one', async () => {
  let clock = 0;
  const reads = [];
  let next = { PATH: '/a' };
  const cache = environmentCache(async () => { reads.push(clock); return next; }, { forMs: 60_000, fallback: () => ({ PATH: '/fallback' }), now: () => clock });
  assert.deepEqual(await cache(), { PATH: '/a' });
  next = { PATH: '/a:/b' };
  clock = 30_000;
  assert.deepEqual(await cache(), { PATH: '/a' }, 'still fresh');
  assert.deepEqual(await cache({ maxAgeMs: 10_000 }), { PATH: '/a:/b' }, 'the agents\' list wants it newer');
  clock = 100_000;
  assert.deepEqual(await cache({ maxAgeMs: 120_000 }), { PATH: '/a:/b' }, 'a caller cannot make it older than its own limit');
  assert.equal(reads.length, 3);
  next = null;
  clock = 200_000;
  assert.deepEqual(await cache(), { PATH: '/a:/b' }, 'the shell failed: the last one read');
  const empty = environmentCache(async () => null, { forMs: 1000, fallback: () => ({ PATH: '/fallback' }), now: () => 0 });
  assert.deepEqual(await empty(), { PATH: '/fallback' });
});

test('reads going on at once are one read', async () => {
  let count = 0;
  let clock = 0;
  const cache = environmentCache(() => new Promise((done) => { count++; setTimeout(() => done({ PATH: '/x' }), 5); }), { forMs: 1000, fallback: () => ({}), now: () => clock });
  const first = cache();
  clock = 5000;
  const second = cache({ maxAgeMs: 0 });
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(count, 1);
});

test('an old one can be taken at once, the new one read for whoever asks next', async () => {
  let clock = 0;
  let next = { PATH: '/a' };
  const cache = environmentCache(async () => next, { forMs: 60_000, fallback: () => ({}), now: () => clock });
  await cache();
  next = { PATH: '/b' };
  clock = 100_000;
  assert.deepEqual(await cache({ staleOk: true }), { PATH: '/a' });
  assert.deepEqual(await cache(), { PATH: '/b' });
});

test("the agents get all the person's shell sets, but what the shell and its terminal set for themselves; Studio a part", () => {
  const dump = {
    PATH: '/opt/homebrew/bin:/usr/bin', ANTHROPIC_BASE_URL: 'https://gateway.example', GITHUB_TOKEN: 't', NODE_EXTRA_CA_CERTS: '/ca.pem',
    HTTPS_PROXY: 'http://proxy', PWD: '/x', SHLVL: '2', _: '/usr/bin/env', TERM_PROGRAM: 'iTerm.app', ELECTRON_RUN_AS_NODE: '1', OPENFILM_HOME: '/o',
  };
  const all = shellVariables(dump, '/home/me/');
  assert.deepEqual(Object.keys(all).sort(), ['ANTHROPIC_BASE_URL', 'GITHUB_TOKEN', 'HTTPS_PROXY', 'NODE_EXTRA_CA_CERTS', 'PATH']);
  assert.ok(all.PATH.startsWith('/opt/homebrew/bin:/usr/bin'));
  assert.deepEqual(Object.keys(shellSubset(all, '/home/me/')).sort(), ['HTTPS_PROXY', 'PATH']);
});

const SCUTIL = `<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
  }
  FTPPassive : 1
  HTTPEnable : 1
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 0
  __SCOPED__ : <dictionary> {
    en0 : <dictionary> {
      HTTPSEnable : 1
      HTTPSPort : 9999
      HTTPSProxy : 10.0.0.9
    }
  }
}
`;

const INTERNET = `\r
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\r
    ProxyEnable    REG_DWORD    0x1\r
    ProxyServer    REG_SZ    127.0.0.1:7897\r
    ProxyOverride    REG_SZ    localhost;127.*;10.*;172.16.*;192.168.*;*.lan;<local>\r
`;

test("macOS's proxy is read from its top settings, not an interface's", () => {
  const found = macProxy(parseScutilProxy(SCUTIL));
  assert.deepEqual(found, { http: '127.0.0.1:7897', https: '127.0.0.1:7897', socks: null, bypass: ['*.local', '169.254/16'] });
  assert.equal(macProxy(parseScutilProxy('<dictionary> {\n  HTTPEnable : 0\n  HTTPSEnable : 0\n}\n')), null);
  assert.equal(macProxy(parseScutilProxy('')), null);
});

test("Windows's proxy is read from the Internet settings: one server for all, or one per kind; off is none", () => {
  const settings = parseRegQuery(INTERNET, undefined, ['REG_SZ', 'REG_DWORD']);
  assert.equal(settings.ProxyEnable, '0x1');
  assert.deepEqual(windowsProxy(settings), {
    http: '127.0.0.1:7897', https: '127.0.0.1:7897', socks: null,
    bypass: ['localhost', '127.*', '10.*', '172.16.*', '192.168.*', '*.lan', '<local>'],
  });
  assert.deepEqual(windowsProxy({ ProxyEnable: '0x1', ProxyServer: 'http=127.0.0.1:8080;https=127.0.0.1:8443;socks=127.0.0.1:1080' }),
    { http: '127.0.0.1:8080', https: '127.0.0.1:8443', socks: '127.0.0.1:1080', bypass: [''] });
  assert.equal(windowsProxy({ ProxyEnable: '0x0', ProxyServer: '127.0.0.1:7897' }), null);
  assert.equal(windowsProxy({ ProxyEnable: '0x1' }), null);
  assert.equal(windowsProxy(), null);
});

test('the exceptions become NO_PROXY: this computer always, wildcards as domains and address ranges', () => {
  assert.equal(noProxyList(['localhost', '127.*', '10.*', '172.16.*', '192.168.*', '*.lan', '<local>', 'intra*', 'example.com', '169.254/16']),
    'localhost,127.0.0.1,::1,127.0.0.0/8,10.0.0.0/8,172.16.0.0/16,192.168.0.0/16,.lan,example.com,169.254.0.0/16');
  assert.equal(noProxyList(), 'localhost,127.0.0.1,::1');
});

test("the system's proxy is given as the variables programs read, in both cases", () => {
  const env = proxyVariables({ http: '127.0.0.1:7897', https: null, socks: null, bypass: ['*.lan'] });
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7897');
  assert.equal(env.https_proxy, 'http://127.0.0.1:7897');
  assert.equal(env.HTTP_PROXY, 'http://127.0.0.1:7897');
  assert.equal(env.no_proxy, 'localhost,127.0.0.1,::1,.lan');
  assert.equal(env.ALL_PROXY, undefined);
  assert.deepEqual(proxyVariables({ http: null, https: null, socks: '127.0.0.1:1080', bypass: [] }).ALL_PROXY, 'socks5h://127.0.0.1:1080');
  assert.equal(proxyVariables({ http: 'socks5://127.0.0.1:1080', https: null, socks: null, bypass: [] }).HTTPS_PROXY, 'socks5://127.0.0.1:1080');
  assert.deepEqual(proxyVariables(null), {});
});

test("the person's own proxy wins over the system's; with none, the system's is added", () => {
  const proxy = proxyVariables({ http: '127.0.0.1:7897', https: '127.0.0.1:7897', socks: null, bypass: [] });
  const mine = { PATH: '/usr/bin', https_proxy: 'http://10.0.0.1:3128' };
  assert.equal(withSystemProxy(mine, proxy), mine);
  assert.deepEqual(withSystemProxy({ PATH: '/usr/bin', NO_PROXY: 'corp' }, proxy), { ...proxy, PATH: '/usr/bin', NO_PROXY: 'corp' });
  assert.deepEqual(withSystemProxy({ PATH: '/usr/bin' }, {}), { PATH: '/usr/bin' });
});
