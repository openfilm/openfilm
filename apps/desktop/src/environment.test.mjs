import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environmentCache, expandWindowsVars, parseRegQuery, registryVariables, shellSubset, shellVariables, windowsFreshPath } from './environment.mjs';

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
