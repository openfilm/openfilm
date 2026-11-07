import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_INSTALLERS, chosenProgram, claudeAppCli, claudeUpdate, codexAppCopies, claudeVersion, cmdTarget, codexVersion, consoleProgram, desktopApp, detectAgentInstallation, findExecutable, installCommand, laterVersion, notTheAgent, opencodeVersion, searchReport, windowsBinDirs } from './agent-installation.mjs';

test("an npm .cmd shim (Windows) runs its package's script: that is what gets started", () => {
  const npm = mkdtempSync(join(tmpdir(), 'of-npm-'));
  const script = join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  mkdirSync(join(script, '..'), { recursive: true });
  writeFileSync(script, '');
  writeFileSync(join(npm, 'claude.cmd'), '@ECHO off\r\nGOTO start\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n');
  assert.equal(cmdTarget(join(npm, 'claude.cmd')), script);
  writeFileSync(join(npm, 'other.cmd'), '@echo off\r\necho hi\r\n');
  assert.equal(cmdTarget(join(npm, 'other.cmd')), null);
});

test('Claude Code as the Claude app keeps it: straight in a version folder, or one build folder down; newest first', () => {
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  const root = join(home, 'Library/Application Support/Claude/claude-code');
  assert.equal(claudeAppCli(home, { win: false }), null);
  const old = join(root, '2.1.9', 'claude.app/Contents/MacOS/claude');
  const recent = join(root, '2.1.10', 'f2326db61802', 'claude.app/Contents/MacOS/claude');
  for (const file of [old, recent]) { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, '', { mode: 0o755 }); }
  assert.equal(claudeAppCli(home, { win: false }), recent);
});

test("an agent is found by any of its names, and in its own installer's folder off the PATH (Kimi Code's ~/.kimi-code/bin)", () => {
  if (process.platform === 'win32') return;
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  const none = { home, env: { PATH: '' }, pathDirs: [], applicationDirs: [] };
  assert.equal(detectAgentInstallation('kimi', none).cli, null);
  const kimi = join(home, '.kimi-code', 'bin', 'kimi');
  mkdirSync(join(kimi, '..'), { recursive: true });
  writeFileSync(kimi, '', { mode: 0o755 });
  assert.equal(detectAgentInstallation('kimi', none).cli, kimi);
  const bin = join(home, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'cbc'), '', { mode: 0o755 });
  assert.equal(detectAgentInstallation('codebuddy', { ...none, pathDirs: [bin] }).cli, join(bin, 'cbc'));
});

test("DeepSeek Harness is found inside its desktop app on a Mac, which carries the command, and from the app the person chooses", () => {
  if (process.platform === 'win32') return;
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  const apps = join(home, 'Applications');
  const none = { home, env: { PATH: '' }, pathDirs: [], applicationDirs: [apps] };
  assert.equal(detectAgentInstallation('deepseek', none).cli, null);
  const dsh = join(apps, 'DeepSeek Harness.app', 'Contents', 'Resources', 'runtime', 'cli', 'bin', 'dsh');
  mkdirSync(join(dsh, '..'), { recursive: true });
  writeFileSync(dsh, '#!/bin/sh', { mode: 0o755 });
  assert.equal(detectAgentInstallation('deepseek', none).cli, dsh);
  assert.equal(chosenProgram(join(apps, 'DeepSeek Harness.app'), { names: ['dsh'], win: false }), dsh);
  /* one linked into the PATH (its own setting, or npm's @deepseek-ai/dsh) comes first */
  const bin = join(home, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'dsh'), '', { mode: 0o755 });
  assert.equal(detectAgentInstallation('deepseek', { ...none, env: { PATH: bin } }).cli, join(bin, 'dsh'));
});

/** a file, its folders made */
const put = (file, text = '', mode = 0o644) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text, { mode }); return file; };

/* the shim npm writes today: it names node.exe first, which is not what it runs */
const npmShim = (rel) => `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${rel}" %*\r\n`;

test("npm's shim as it is written today: what it runs, never the node.exe it checks for first", () => {
  const npm = mkdtempSync(join(tmpdir(), 'of-npm-'));
  const script = put(join(npm, 'node_modules', '@qwen-code', 'qwen-code', 'cli.js'));
  put(join(npm, 'qwen.cmd'), npmShim('node_modules\\@qwen-code\\qwen-code\\cli.js'));
  assert.equal(cmdTarget(join(npm, 'qwen.cmd')), script);
});

test("Codex's npm shim: its own program for this machine's chip, not the script that starts it", () => {
  const triple = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  /* where the package puts the program: in the platform package it installs, beside its script or hoisted one folder
     up (`bin`, as the package's own script says), or in itself (`bin`, and `codex` in older ones) */
  const layouts = [
    ['node_modules', '@openai', 'codex', 'node_modules', '@openai', `codex-win32-${process.arch}`, 'vendor', triple, 'bin', 'codex.exe'],
    ['node_modules', '@openai', `codex-win32-${process.arch}`, 'vendor', triple, 'bin', 'codex.exe'],
    ['node_modules', '@openai', 'codex', 'vendor', triple, 'bin', 'codex.exe'],
    ['node_modules', '@openai', 'codex', 'vendor', triple, 'codex', 'codex.exe'],
    ['node_modules', '@openai', 'codex', 'node_modules', '@openai', `codex-win32-${process.arch}`, 'vendor', triple, 'codex', 'codex.exe'],
  ];
  for (const layout of layouts) {
    const npm = mkdtempSync(join(tmpdir(), 'of-npm-'));
    put(join(npm, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
    const exe = put(join(npm, ...layout));
    put(join(npm, 'codex.cmd'), npmShim('node_modules\\@openai\\codex\\bin\\codex.js'));
    assert.equal(cmdTarget(join(npm, 'codex.cmd')), exe, layout.join('/'));
  }
});

test("Codex's shim with no program of its own: the shim itself, never its script, which a shell command cannot start", () => {
  const npm = mkdtempSync(join(tmpdir(), 'of-npm-'));
  put(join(npm, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
  put(join(npm, 'codex.cmd'), npmShim('node_modules\\@openai\\codex\\bin\\codex.js'));
  assert.equal(cmdTarget(join(npm, 'codex.cmd')), null);
  assert.equal(findExecutable('codex', [], { PATH: npm }, { win: true }), join(npm, 'codex.cmd'));
});

test("pnpm's shim (%~dp0, node.exe beside it or not) and Yarn's, which runs another shim", () => {
  const pnpm = mkdtempSync(join(tmpdir(), 'of-pnpm-'));
  const script = put(join(pnpm, 'global', '5', 'node_modules', '@qwen-code', 'qwen-code', 'cli.js'));
  put(join(pnpm, 'qwen.CMD'), '@SETLOCAL\r\n@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe"  "%~dp0\\global\\5\\node_modules\\@qwen-code\\qwen-code\\cli.js" %*\r\n) ELSE (\r\n  @SET PATHEXT=%PATHEXT:;.JS;=;%\r\n  node  "%~dp0\\global\\5\\node_modules\\@qwen-code\\qwen-code\\cli.js" %*\r\n)\r\n');
  assert.equal(cmdTarget(join(pnpm, 'qwen.CMD')), script);

  const local = mkdtempSync(join(tmpdir(), 'of-yarn-'));
  const yarnScript = put(join(local, 'Data', 'global', 'node_modules', 'opencode-ai', 'bin', 'opencode.js'));
  put(join(local, 'Data', 'global', 'node_modules', '.bin', 'opencode.cmd'), npmShim('..\\opencode-ai\\bin\\opencode.js'));
  put(join(local, 'bin', 'opencode.cmd'), '@"%~dp0\\..\\Data\\global\\node_modules\\.bin\\opencode.cmd" %*\r\n');
  assert.equal(cmdTarget(join(local, 'bin', 'opencode.cmd')), yarnScript);
});

test('on Windows a program is a .exe, .cmd or .bat (never the extensionless script beside it), the PATH given first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-win-'));
  put(join(dir, 'kimi'), '#!/bin/sh');
  assert.equal(findExecutable('kimi', [], { PATH: dir }, { win: true }), null);
  const exe = put(join(dir, 'kimi.exe'));
  /* an environment spread from Windows' own has its Path too: the PATH set on purpose wins */
  assert.equal(findExecutable('kimi', [], { Path: '', PATH: dir }, { win: true }), exe);
  const other = mkdtempSync(join(tmpdir(), 'of-win-'));
  const bat = put(join(other, 'copilot.bat'), '@echo off\r\n');
  assert.equal(findExecutable('copilot', [other], { PATH: '' }, { win: true }), bat, 'a shim that says nothing is kept as it is: cmd.exe starts it');
});

test("the folders Windows installers use, the person's own variables first", () => {
  const home = join(tmpdir(), 'Users', 'ana');
  const env = { APPDATA: join(home, 'Roaming'), LOCALAPPDATA: join(home, 'Local'), pnpm_home: join(home, 'pn'), NVM_SYMLINK: join(home, 'nodejs'), ProgramData: join(tmpdir(), 'PD') };
  const dirs = windowsBinDirs(env, home);
  for (const dir of [join(home, '.local', 'bin'), join(home, 'Roaming', 'npm'), join(home, 'pn'), join(home, 'Local', 'pnpm'), join(home, 'Local', 'Volta', 'bin'),
    join(home, 'nodejs'), join(home, 'scoop', 'shims'), join(tmpdir(), 'PD', 'chocolatey', 'bin'), join(home, 'Local', 'Microsoft', 'WinGet', 'Links'), join(home, 'Local', 'Microsoft', 'WindowsApps')]) {
    assert.ok(dirs.includes(dir), dir);
  }
});

test('the program the person chose comes first; it can be a shim, the .cmd beside a .ps1, or a folder with it inside', () => {
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  const bin = join(home, 'bin');
  const onPath = put(join(bin, 'codex'), '', 0o755);
  const mine = put(join(home, 'mine', 'codex'), '', 0o755);
  const opts = { home, env: { PATH: bin }, pathDirs: [], applicationDirs: [] };
  if (process.platform !== 'win32') {
    assert.deepEqual(detectAgentInstallation('codex', opts), { installed: true, cli: onPath, source: 'path', install: 'https://chatgpt.com/download/' });
    assert.equal(detectAgentInstallation('codex', { ...opts, chosen: mine }).source, 'chosen');
    assert.equal(detectAgentInstallation('codex', { ...opts, chosen: mine }).cli, mine);
    assert.equal(detectAgentInstallation('codex', { ...opts, chosen: join(home, 'gone') }).cli, onPath, 'one chosen and gone: found as before');
    assert.equal(chosenProgram(join(home, 'mine'), { names: ['codex'] }), mine, 'a folder: the program in it');
    const app = put(join(home, 'Codex.app', 'Contents', 'Resources', 'codex'), '', 0o755);
    assert.equal(chosenProgram(join(home, 'Codex.app'), { names: ['codex'] }), app, 'an app: the Codex inside it');
    assert.equal(chosenProgram(put(join(home, 'notes.txt')), { names: ['codex'] }), null, 'not a program');
  }
  const npm = join(home, 'npm');
  const script = put(join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'));
  put(join(npm, 'claude.cmd'), npmShim('node_modules\\@anthropic-ai\\claude-code\\cli.js'));
  put(join(npm, 'claude.ps1'), '#!/usr/bin/env pwsh');
  assert.equal(chosenProgram(join(npm, 'claude.ps1'), { names: ['claude'], win: true }), script);
  assert.equal(chosenProgram(join(npm, 'claude.cmd'), { names: ['claude'], win: true }), script);
  assert.equal(chosenProgram('relative\\claude.exe', { names: ['claude'], win: true }), null);
});

/** A Windows program's header, enough to tell its subsystem: 3 the console, 2 a window. */
function peProgram(subsystem, { wide = true } = {}) {
  const bytes = Buffer.alloc(0x200);
  bytes.write('MZ', 0, 'latin1');
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.write('PE\0\0', 0x80, 'latin1');
  bytes.writeUInt16LE(wide ? 0x20b : 0x10b, 0x80 + 24);
  bytes.writeUInt16LE(subsystem, 0x80 + 0x5c);
  return bytes;
}

test('a console program is told from a window program by its header, without starting it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-pe-'));
  const at = (name, bytes) => { const file = join(dir, name); writeFileSync(file, bytes); return file; };
  assert.equal(consoleProgram(at('codex.exe', peProgram(3))), true);
  assert.equal(consoleProgram(at('codex32.exe', peProgram(3, { wide: false }))), true);
  /* the Codex Store app's own Codex.exe: its window, not the CLI */
  assert.equal(consoleProgram(at('Codex.exe', peProgram(2))), false);
  /* the Linux CLI the same app carries for WSL, a script, a cut-off file, nothing */
  assert.equal(consoleProgram(at('codex', Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(60)]))), false);
  assert.equal(consoleProgram(at('codex.cmd', '@echo off')), false);
  assert.equal(consoleProgram(at('short.exe', peProgram(3).subarray(0, 0x90))), false);
  assert.equal(consoleProgram(join(dir, 'missing.exe')), false);
});

test('a program found some other way (a Store app) is used last', () => {
  if (process.platform === 'win32') return;
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  const store = put(join(home, 'Store', 'OpenAI.Codex', 'codex.exe'), '', 0o755);
  const opts = { home, env: { PATH: '' }, pathDirs: [], applicationDirs: [] };
  assert.equal(detectAgentInstallation('codex', opts).cli, null);
  assert.deepEqual(detectAgentInstallation('codex', { ...opts, others: [store] }), { installed: true, cli: store, source: 'app', install: 'https://chatgpt.com/download/' });
});

test('the report: every folder searched, each file with the name, what a shim runs, and what cannot be started', () => {
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  const npm = join(home, 'npm');
  const script = put(join(npm, 'node_modules', '@qwen-code', 'qwen-code', 'cli.js'));
  put(join(npm, 'qwen'), '#!/bin/sh');
  put(join(npm, 'qwen.cmd'), npmShim('node_modules\\@qwen-code\\qwen-code\\cli.js'));
  put(join(npm, 'qwen.ps1'), '');
  const report = searchReport('qwen', { home, env: { PATH: `${npm};${npm.toUpperCase()}` }, pathDirs: [join(home, 'other')], win: true });
  const own = join(home, 'AppData', 'Local', 'qwen-code', 'bin');
  assert.deepEqual(report.searched, [npm, join(home, 'other'), own], 'each folder once, whatever its case, its own installer\'s last');
  assert.deepEqual(report.files, [
    { file: join(npm, 'qwen'), runs: join(npm, 'qwen'), usable: false },
    { file: join(npm, 'qwen.cmd'), runs: script, usable: true },
    { file: join(npm, 'qwen.ps1'), runs: null, usable: false },
  ]);
});

test('Claude Code is updated the way it was installed: npm, pnpm, bun, its Homebrew cask, its own installer; the Claude app updates its own', () => {
  if (process.platform === 'win32') return;
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  const exe = (file) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, '', { mode: 0o755 }); return file; };
  const pkg = (dir) => { exe(join(dir, 'cli.js')); writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@anthropic-ai/claude-code', version: '2.1.288' })); return join(dir, 'cli.js'); };
  assert.deepEqual(claudeUpdate(pkg(join(home, 'lib/node_modules/@anthropic-ai/claude-code'))), { command: 'npm i -g @anthropic-ai/claude-code@latest' });
  assert.deepEqual(claudeUpdate(pkg(join(home, 'Library/pnpm/global/5/node_modules/@anthropic-ai/claude-code'))), { command: 'pnpm add -g @anthropic-ai/claude-code@latest' });
  assert.deepEqual(claudeUpdate(pkg(join(home, '.bun/install/global/node_modules/@anthropic-ai/claude-code'))), { command: 'bun add -g @anthropic-ai/claude-code@latest' });
  assert.deepEqual(claudeUpdate(exe(join(home, 'homebrew/Caskroom/claude-code/2.1.288/claude'))), { command: 'brew upgrade --cask claude-code' });
  assert.deepEqual(claudeUpdate(exe(join(home, 'homebrew/Caskroom/claude-code@latest/2.1.288/claude'))), { command: 'brew upgrade --cask claude-code@latest' });
  assert.deepEqual(claudeUpdate(exe(join(home, '.local/share/claude/versions/2.1.288'))), { command: 'claude update' });
  assert.deepEqual(claudeUpdate(exe(join(home, 'Library/Application Support/Claude/claude-code/2.1.288/abc/claude'))), { app: true });
  assert.equal(claudeUpdate(exe(join(home, 'tools/2.1.288/claude'))), null, 'a way it can\'t tell');
  assert.equal(claudeUpdate(join(home, 'not-there')), null);
});

test('Claude Code on the PATH and in the Claude app: the later one is used, told from where each is installed', () => {
  if (process.platform === 'win32') return;
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  const exe = (file) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, '', { mode: 0o755 }); return file; };
  const inApp = exe(join(home, 'Library/Application Support/Claude/claude-code/2.1.295/abc/claude.app/Contents/MacOS/claude'));
  assert.equal(claudeVersion(inApp), '2.1.295');

  /* an npm install never updated, under a Node whose folder is named for its own version */
  const npm = join(home, 'Cellar/node/26.0.0/lib/node_modules/@anthropic-ai/claude-code');
  const cliJs = exe(join(npm, 'cli.js'));
  writeFileSync(join(npm, 'package.json'), JSON.stringify({ name: '@anthropic-ai/claude-code', version: '2.1.280' }));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  symlinkSync(cliJs, join(bin, 'claude'));
  assert.equal(claudeVersion(join(bin, 'claude')), '2.1.280', "npm's own version, not Node's");
  const found = detectAgentInstallation('claude', { home, env: { PATH: '' }, pathDirs: [bin] });
  assert.deepEqual([found.cli, found.source], [inApp, 'app']);

  /* the official installer's, later than the app's: the one on the PATH */
  const native = exe(join(home, '.local/share/claude/versions/2.1.300'));
  const local = join(home, 'local-bin');
  mkdirSync(local);
  symlinkSync(native, join(local, 'claude'));
  assert.equal(detectAgentInstallation('claude', { home, env: { PATH: '' }, pathDirs: [local] }).cli, join(local, 'claude'));

  /* one whose version can't be told stays as it is found */
  const plain = join(home, 'plain-bin');
  exe(join(plain, 'claude'));
  assert.equal(claudeVersion(join(plain, 'claude')), null);
  assert.equal(detectAgentInstallation('claude', { home, env: { PATH: '' }, pathDirs: [plain] }).source, 'path');
  assert.equal(laterVersion('2.1.10', '2.1.9'), true);
  assert.equal(laterVersion('2.1.9', '2.1.9'), false);
});

test('which Codex a program is: npm\'s package, Homebrew\'s folder, else what it says when asked, once', () => {
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  const pkg = join(home, 'npm', 'node_modules', '@openai', 'codex');
  put(join(pkg, 'package.json'), JSON.stringify({ name: '@openai/codex', version: '0.42.0' }));
  const script = put(join(pkg, 'bin', 'codex.js'));
  assert.equal(codexVersion(script), '0.42.0');
  /* its program in the platform package npm puts beside it */
  const plat = join(home, 'npm', 'node_modules', '@openai', 'codex-win32-x64');
  put(join(plat, 'package.json'), JSON.stringify({ name: '@openai/codex-win32-x64', version: '0.150.0-win32-x64' }));
  assert.equal(codexVersion(put(join(plat, 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'))), '0.150.0');
  assert.equal(codexVersion(put(join(home, 'Caskroom', 'codex', '0.163.0', 'codex-aarch64-apple-darwin'))), '0.163.0');
  let asked = 0;
  const inApp = put(join(home, 'Codex.app', 'Contents', 'Resources', 'codex'));
  const ask = () => { asked += 1; return '0.170.1'; };
  assert.equal(codexVersion(inApp, { ask }), '0.170.1');
  assert.equal(codexVersion(inApp, { ask }), '0.170.1');
  assert.equal(asked, 1, 'asked once while the program is the same');
  assert.equal(codexVersion(join(home, 'gone')), null);
});

test("a Codex inside an app says its version when asked, not the old label the app keeps around it (issue #290)", () => {
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  /* the copy the Codex app runs, with an npm-style package.json left beside it naming an older build */
  const beside = join(home, 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex-cli');
  put(join(beside, 'package.json'), JSON.stringify({ name: '@openai/codex', version: '0.137.0' }));
  const inApp = put(join(beside, 'bin', 'codex'));
  assert.equal(codexVersion(inApp, { ask: () => '0.165.0' }), '0.165.0', "the program's own words, not the label");
  /* an app copy that cannot be asked falls back to the label rather than nothing */
  const quiet = put(join(beside, 'bin', 'codex-quiet'));
  utimesSync(quiet, new Date(0), new Date(0));
  assert.equal(codexVersion(quiet, { ask: () => null }), '0.137.0', 'the label when the program says nothing');
  /* outside an app, the label keeps saying it without asking: npm's own package */
  const npm = put(join(home, 'npm', 'codex.js'));
  put(join(home, 'npm', 'package.json'), JSON.stringify({ name: '@openai/codex', version: '0.42.0' }));
  let askedOutside = 0;
  assert.equal(codexVersion(npm, { ask: () => { askedOutside += 1; return '9.9.9'; } }), '0.42.0', 'the package.json, not asked');
  assert.equal(askedOutside, 0, 'never asked outside an app while the label answers');
});

test('Codex installed long ago beside the copy an app keeps up to date: the later one is used', () => {
  if (process.platform === 'win32') return;
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  const bin = join(home, 'bin');
  const onPath = put(join(bin, 'codex'), '', 0o755);
  const apps = join(home, 'Applications');
  const inApp = put(join(apps, 'ChatGPT.app', 'Contents', 'Resources', 'codex'), '', 0o755);
  const store = put(join(home, 'Store', 'codex.exe'), '', 0o755);
  const versions = (map) => (file) => map[file] ?? null;
  const opts = { home, env: { PATH: bin }, pathDirs: [], applicationDirs: [apps] };
  assert.deepEqual(detectAgentInstallation('codex', { ...opts, codexVersionOf: versions({ [onPath]: '0.42.0', [inApp]: '0.163.0' }) }),
    { installed: true, cli: inApp, source: 'app', install: 'https://chatgpt.com/download/' });
  assert.equal(detectAgentInstallation('codex', { ...opts, others: [store], codexVersionOf: versions({ [onPath]: '0.42.0', [inApp]: '0.163.0', [store]: '0.170.0' }) }).cli, store, 'the latest of them');
  assert.equal(detectAgentInstallation('codex', { ...opts, codexVersionOf: versions({ [onPath]: '0.170.0', [inApp]: '0.163.0' }) }).cli, onPath, 'the one on the PATH is the later');
  assert.equal(detectAgentInstallation('codex', { ...opts, codexVersionOf: versions({ [inApp]: '0.163.0' }) }).cli, onPath, 'one whose version can\'t be told stays');
  assert.equal(detectAgentInstallation('codex', { ...opts, chosen: onPath, codexVersionOf: versions({ [onPath]: '0.1.0', [inApp]: '0.163.0' }) }).cli, onPath, 'the one chosen, whatever its version');
});

test("Cursor installed as `agent` alone is found; another program called `agent` is not taken for it", () => {
  if (process.platform === 'win32') return;
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  const exe = (file) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, '', { mode: 0o755 }); return file; };
  /* some other tool's `agent` */
  const other = join(home, 'other-bin');
  exe(join(other, 'agent'));
  assert.equal(detectAgentInstallation('cursor', { home, env: { PATH: '' }, pathDirs: [other] }).cli, null);
  /* Cursor's installer: its own folder, linked as `agent` (the legacy `cursor-agent` link gone) */
  const real = exe(join(home, '.local/share/cursor-agent/versions/2026.10.16-e3cb207/cursor-agent'));
  const bin = join(home, '.local/bin');
  mkdirSync(bin, { recursive: true });
  symlinkSync(real, join(bin, 'agent'));
  assert.equal(detectAgentInstallation('cursor', { home, env: { PATH: '' }, pathDirs: [other, bin] }).cli, join(bin, 'agent'));
  /* both links, as the installer makes them now: `cursor-agent` first */
  symlinkSync(real, join(bin, 'cursor-agent'));
  assert.equal(detectAgentInstallation('cursor', { home, env: { PATH: '' }, pathDirs: [bin] }).cli, join(bin, 'cursor-agent'));
});

/* the .cmd an editor keeps in resources\app\bin (Windows): it runs the editor with Node, its arguments files to open */
const editorShim = (exe) => `@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0..\\..\\..\\${exe}" "%~dp0..\\out\\cli.js" %*\r\nendlocal\r\n`;

test("an editor's own launcher is never taken for an agent: a .cmd running its out/cli.js, or anything in its resources/app/bin", () => {
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  /* the Cursor editor on Windows, its launcher picked or found as Cursor's agent */
  const root = join(home, 'AppData', 'Local', 'Programs', 'cursor');
  const cli = put(join(root, 'resources', 'app', 'out', 'cli.js'));
  const bin = join(root, 'resources', 'app', 'bin');
  const cursorCmd = put(join(bin, 'cursor.cmd'), editorShim('Cursor.exe'));
  assert.equal(chosenProgram(cursorCmd, { names: ['cursor-agent', 'agent'], win: true }), cli, 'what the shim runs: the editor');
  assert.equal(notTheAgent('cursor', cli, { chosen: cursorCmd, win: true }), 'app');
  assert.equal(detectAgentInstallation('cursor', { home, env: { PATH: '' }, pathDirs: [], applicationDirs: [], chosen: cursorCmd, win: true }).cli, null,
    'a launcher chosen before is not used');
  /* one named like the agent in an editor's bin folder is not it either */
  put(join(bin, 'agent.cmd'), editorShim('Cursor.exe'));
  assert.equal(detectAgentInstallation('cursor', { home, env: { PATH: bin }, pathDirs: [], applicationDirs: [], win: true }).cli, null);
  /* VS Code's own `code` launcher on Windows, under Microsoft VS Code */
  const code = put(join(home, 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'bin', 'copilot.cmd'), '@echo off\r\n');
  assert.equal(notTheAgent('copilot', code, { win: true }), 'app');
  /* a program of the agent's own is never refused */
  const npm = join(home, 'npm');
  const script = put(join(npm, 'node_modules', '@github', 'copilot', 'npm-loader.js'));
  put(join(npm, 'copilot.cmd'), npmShim('node_modules\\@github\\copilot\\npm-loader.js'));
  assert.equal(notTheAgent('copilot', script, { chosen: join(npm, 'copilot.cmd'), win: true }), null);
});

test("on a Mac an editor's launcher in its app, or linked from a bin folder, is skipped for the agent's own further on", () => {
  if (process.platform === 'win32') return;
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  const inApp = put(join(home, 'Applications', 'Visual Studio Code.app', 'Contents', 'Resources', 'app', 'bin', 'copilot'), '', 0o755);
  const linked = join(home, 'linked');
  mkdirSync(linked);
  symlinkSync(inApp, join(linked, 'copilot'));
  const mine = put(join(home, '.local', 'bin', 'copilot'), '', 0o755);
  const opts = { home, env: { PATH: [join(inApp, '..'), linked].join(':') }, pathDirs: [join(home, '.local', 'bin')], applicationDirs: [] };
  assert.equal(notTheAgent('copilot', join(linked, 'copilot')), 'app', 'followed through its link');
  assert.equal(detectAgentInstallation('copilot', opts).cli, mine);
  assert.equal(detectAgentInstallation('copilot', { ...opts, chosen: join(linked, 'copilot') }).cli, mine, 'chosen, and refused');
});

test('on Windows a window program (a desktop app) is never an agent; one whose header cannot be read still is', () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-pe-'));
  const app = join(dir, 'app');
  mkdirSync(app);
  writeFileSync(join(app, 'kimi.exe'), peProgram(2));
  assert.equal(notTheAgent('kimi', join(app, 'kimi.exe'), { win: true }), 'app');
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  assert.equal(detectAgentInstallation('kimi', { home, env: { PATH: app }, pathDirs: [], applicationDirs: [], win: true }).cli, null);
  const cli = join(dir, 'cli');
  mkdirSync(cli);
  writeFileSync(join(cli, 'kimi.exe'), peProgram(3));
  assert.equal(detectAgentInstallation('kimi', { home, env: { PATH: `${app};${cli}` }, pathDirs: [], applicationDirs: [], win: true }).cli, join(cli, 'kimi.exe'));
  /* a Store app's command cannot be read as a file: it is not refused for that */
  writeFileSync(join(dir, 'codex.exe'), '');
  assert.equal(notTheAgent('codex', join(dir, 'codex.exe'), { win: true }), null);
});

test("Cursor's agent counts only in its own folder (or Homebrew's cursor-cli), whatever it is called", () => {
  if (process.platform === 'win32') return;
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  const stray = put(join(home, 'bin', 'cursor-agent'), '', 0o755);
  assert.equal(notTheAgent('cursor', stray), 'not-cursor-agent');
  assert.equal(detectAgentInstallation('cursor', { home, env: { PATH: '' }, pathDirs: [join(home, 'bin')], applicationDirs: [] }).cli, null);
  const brew = put(join(home, 'Caskroom', 'cursor-cli', '2026.10.16-e3cb207', 'dist-package', 'cursor-agent'), '', 0o755);
  const links = join(home, 'brew-bin');
  mkdirSync(links);
  symlinkSync(brew, join(links, 'cursor-agent'));
  assert.equal(detectAgentInstallation('cursor', { home, env: { PATH: '' }, pathDirs: [join(home, 'bin'), links], applicationDirs: [] }).cli, join(links, 'cursor-agent'));
});

test("DeepSeek Harness's Windows shim runs a script inside its app's archive on the app itself: the shim, never what it names (#190)", () => {
  const app = mkdtempSync(join(tmpdir(), 'of-dsh-'));
  put(join(app, 'DeepSeek Harness.exe'));
  put(join(app, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'));
  const bin = join(app, 'resources', 'runtime', 'cli', 'bin');
  const shim = put(join(bin, 'dsh.cmd'), '@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%~dp0..\\..\\..\\..\\DeepSeek Harness.exe" --expose-internals "%~dp0..\\..\\..\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js" %*\r\nexit /b %errorlevel%\r\n');
  assert.equal(cmdTarget(shim), null);
  assert.equal(findExecutable('dsh', [], { PATH: bin }, { win: true }), shim);
});

test("Cursor's agent on Windows: found in %LOCALAPPDATA%\\cursor-agent, started by its own shim, which runs its own Node", () => {
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  const root = join(home, 'AppData', 'Local', 'cursor-agent');
  put(join(root, 'versions', '2026.10.16-e3cb207', 'index.js'));
  put(join(root, 'versions', '2026.10.16-e3cb207', 'node.exe'));
  const shim = put(join(root, 'agent.cmd'), '@echo off\r\n"%~dp0versions\\2026.10.16-e3cb207\\node.exe" "%~dp0versions\\2026.10.16-e3cb207\\index.js" %*\r\n');
  assert.equal(cmdTarget(shim), null, 'never its script with another Node');
  assert.equal(detectAgentInstallation('cursor', { home, env: { PATH: '' }, pathDirs: [], applicationDirs: [], win: true }).cli, shim);
});

test('Claude Code in the Claude app on Windows: under %APPDATA%\\Claude, or the Store app\'s own copy of it; the newest', () => {
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  assert.equal(claudeAppCli(home, { win: true }), null);
  const roaming = put(join(home, 'AppData', 'Roaming', 'Claude', 'claude-code', '2.1.290', 'claude.exe'));
  assert.equal(claudeAppCli(home, { win: true }), roaming);
  const store = put(join(home, 'AppData', 'Local', 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude', 'claude-code', '2.1.300', 'b1', 'claude.exe'));
  assert.equal(claudeAppCli(home, { win: true }), store);
  assert.equal(claudeVersion(store), '2.1.300');
  assert.deepEqual(detectAgentInstallation('claude', { home, env: { PATH: '' }, pathDirs: [], applicationDirs: [], win: true }).cli, store);
});

test("OpenCode inside OpenCode.app: used when it is the only one, or the later than the one on the PATH", () => {
  if (process.platform === 'win32') return;
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  const apps = join(home, 'Applications');
  const inApp = put(join(apps, 'OpenCode.app', 'Contents', 'Resources', 'opencode-cli'), '', 0o755);
  writeFileSync(`${inApp}.version`, '2.0.24\n');
  assert.equal(opencodeVersion(inApp, { ask: () => assert.fail('read from the file beside it') }), '2.0.24');
  const opts = { home, env: { PATH: '' }, pathDirs: [], applicationDirs: [apps] };
  assert.deepEqual(detectAgentInstallation('opencode', opts), { installed: true, cli: inApp, source: 'app', install: 'https://opencode.ai/download' });
  const bin = join(home, 'bin');
  const onPath = put(join(bin, 'opencode'), '', 0o755);
  const versions = (map) => (file) => map[file] ?? null;
  assert.equal(detectAgentInstallation('opencode', { ...opts, pathDirs: [bin], opencodeVersionOf: versions({ [onPath]: '1.0.0', [inApp]: '2.0.24' }) }).cli, inApp);
  assert.equal(detectAgentInstallation('opencode', { ...opts, pathDirs: [bin], opencodeVersionOf: versions({ [onPath]: '2.1.0', [inApp]: '2.0.24' }) }).cli, onPath);
  assert.equal(chosenProgram(join(apps, 'OpenCode.app'), { names: ['opencode'] }), inApp, 'the app chosen: the OpenCode inside it');
  /* npm's says it in its package.json */
  const pkg = join(home, 'npm', 'node_modules', 'opencode-ai');
  put(join(pkg, 'package.json'), JSON.stringify({ name: 'opencode-ai', version: '1.4.2' }));
  assert.equal(opencodeVersion(put(join(pkg, 'bin', 'opencode'))), '1.4.2');
});

test("the maker's desktop app is told without its agent: by its bundle on a Mac, its folder on Windows; VS Code with Copilot only", () => {
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  const apps = join(home, 'Applications');
  const mac = { home, applicationDirs: [apps], win: false };
  assert.equal(desktopApp('cursor', mac), null);
  mkdirSync(join(apps, 'Cursor.app'), { recursive: true });
  mkdirSync(join(apps, 'CodeBuddy CN.app'));
  mkdirSync(join(apps, 'Visual Studio Code.app'));
  assert.equal(desktopApp('cursor', mac), 'Cursor');
  assert.equal(desktopApp('codebuddy', mac), 'CodeBuddy');
  assert.equal(desktopApp('kimi', mac), null);
  assert.equal(desktopApp('copilot', mac), null, 'VS Code without the Copilot extension');
  mkdirSync(join(home, '.vscode', 'extensions', 'github.copilot-chat-0.30.0'), { recursive: true });
  assert.equal(desktopApp('copilot', mac), 'VS Code');
  mkdirSync(join(apps, 'GitHub Copilot.app'));
  assert.equal(desktopApp('copilot', mac), 'GitHub Copilot');
  assert.equal(desktopApp('qwen', mac), null, 'no desktop app');
  const win = { home, applicationDirs: [], win: true };
  assert.equal(desktopApp('minimax', win), null);
  mkdirSync(join(home, 'AppData', 'Local', 'Programs', 'MiniMax Agent'), { recursive: true });
  assert.equal(desktopApp('minimax', win), 'MiniMax');
  mkdirSync(join(home, 'AppData', 'Local', 'AnthropicClaude'), { recursive: true });
  assert.equal(desktopApp('claude', win), 'Claude');
});

test("each official installer: the maker's command for this system, the others none", () => {
  assert.equal(installCommand('cursor', { win: false }), 'curl https://cursor.com/install -fsS | bash');
  assert.equal(installCommand('cursor', { win: true }), "irm 'https://cursor.com/install?win32=true' | iex");
  assert.equal(installCommand('copilot', { win: true }), 'winget install GitHub.Copilot');
  for (const id of ['codex', 'claude', 'opencode', 'byok']) assert.equal(installCommand(id, { win: false }), null, id);
  for (const [id, { sh, ps }] of Object.entries(AGENT_INSTALLERS)) {
    assert.match(sh, /^curl .*https:\/\/\S+.*\| bash$/, id);
    assert.match(ps, /^(?:irm '?https:\/\/\S+'? \| iex|winget install \S+)$/, id);
  }
});

test('the report says which file is not the agent, and why', () => {
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  const bin = join(home, 'Programs', 'cursor', 'resources', 'app', 'bin');
  put(join(home, 'Programs', 'cursor', 'resources', 'app', 'out', 'cli.js'));
  put(join(bin, 'agent.cmd'), editorShim('Cursor.exe'));
  const report = searchReport('cursor', { home, env: { PATH: bin }, pathDirs: [], win: true });
  assert.equal(report.files.length, 1);
  assert.equal(report.files[0].refused, 'app');
  assert.equal(report.files[0].usable, false);
});

test('choosing an installation folder finds standalone connection programs at its root or in bin', () => {
  const home = mkdtempSync(join(tmpdir(), 'of-install-folders-'));
  for (const name of ['codex', 'claude', 'qwen', 'kimi', 'mcode', 'codebuddy']) {
    for (const subdir of ['', 'bin']) {
      const folder = join(home, `${name}-${subdir || 'root'}`);
      const cli = put(join(folder, subdir, `${name}.exe`), peProgram(3));
      assert.equal(chosenProgram(folder, { home, names: [name], win: true }), cli);
    }
  }
  assert.equal(chosenProgram(home, { home, names: ['copilot'], win: true }), null, 'an unrelated folder does not silently choose another installation');
});

test('OpenCode Desktop on Windows: the packaged CLI and its newer running copy, without a PATH entry', () => {
  const home = mkdtempSync(join(tmpdir(), 'of-opencode-win-'));
  const root = join(home, 'apps', 'OpenCode');
  const gui = put(join(root, 'OpenCode.exe'), peProgram(2));
  const packaged = put(join(root, 'resources', 'opencode-cli.exe'), peProgram(3));
  put(join(root, 'resources', 'opencode-cli.version'), '2.1.4\n');
  assert.equal(opencodeVersion(packaged, { ask: () => assert.fail('read the packaged version') }), '2.1.4');
  const opts = { home, env: { PATH: '' }, pathDirs: [], applicationDirs: [], win: true,
    windowsApps: [{ name: 'OpenCode 2.1.4', directories: [root] }] };
  assert.equal(detectAgentInstallation('opencode', opts).cli, packaged);
  const report = searchReport('opencode', opts);
  assert.ok(report.searched.includes(join(root, 'resources')));
  assert.ok(report.files.some((entry) => entry.file === packaged && entry.usable), 'diagnostics include the same bundled runtime as discovery');
  assert.equal(chosenProgram(root, { names: ['opencode'], win: true }), packaged);
  assert.equal(chosenProgram(gui, { names: ['opencode'], win: true }), packaged);
  const running = put(join(home, 'AppData', 'Roaming', 'ai.opencode.desktop', 'cli', '2.1.5-x64', 'opencode-cli.exe'), peProgram(3));
  put(`${running}.version`, '2.1.5');
  assert.equal(detectAgentInstallation('opencode', opts).cli, running, 'the newer app-managed copy');
  assert.equal(detectAgentInstallation('opencode', { ...opts, chosen: gui }).cli, packaged, 'the explicit choice wins');
  const mine = put(join(home, 'bin', 'opencode.exe'), peProgram(3));
  put(`${mine}.version`, '2.1.6');
  assert.equal(detectAgentInstallation('opencode', { ...opts, env: { PATH: join(home, 'bin') } }).cli, mine, 'a newer independent CLI stays');
});

test('GitHub Copilot Desktop on Windows: its SDK CLI is found, but GUI programs and incomplete copies are not', () => {
  const home = mkdtempSync(join(tmpdir(), 'of-copilot-win-'));
  const root = join(home, 'AppData', 'Local', 'github-copilot-sdk');
  const opts = { home, env: { PATH: '' }, pathDirs: [], applicationDirs: [], windowsApps: [], win: true };
  mkdirSync(join(root, 'cli', 'copilot-sdk-runtime-1.0.100'), { recursive: true });
  assert.equal(detectAgentInstallation('copilot', opts).cli, null, 'a cache directory alone is not installed');
  const older = put(join(root, 'cli', 'copilot-sdk-runtime-1.0.100', 'copilot.exe'), peProgram(3));
  put(`${older}.version`, '1.0.100');
  const newer = put(join(root, 'runtime', 'copilot-sdk-runtime-1.0.102', 'copilot.exe'), peProgram(3));
  put(`${newer}.version`, '1.0.102');
  put(join(root, 'cli', 'copilot-sdk-runtime-9.0.0', 'copilot.exe'), peProgram(2));
  const found = detectAgentInstallation('copilot', opts);
  assert.equal(found.cli, newer);
  assert.equal(found.source, 'app');
  const app = join(home, 'custom apps', 'GitHub Copilot');
  const gui = put(join(app, 'github.exe'), peProgram(2));
  put(join(app, 'copilot-sdk', 'index.js'));
  assert.equal(chosenProgram(gui, { home, names: ['copilot'], win: true }), newer);
  assert.equal(chosenProgram(app, { home, names: ['copilot'], win: true }), newer);
  assert.equal(detectAgentInstallation('copilot', { ...opts, chosen: gui }).cli, newer);
  const chosen = put(join(home, 'bin', 'copilot.exe'), peProgram(3));
  put(`${chosen}.version`, '2.0.0');
  assert.equal(detectAgentInstallation('copilot', { ...opts, env: { PATH: join(home, 'bin') } }).cli, chosen);
});

test('custom Windows app registrations identify the desktop app without making its GUI an agent', () => {
  const home = mkdtempSync(join(tmpdir(), 'of-custom-apps-'));
  const opts = { home, applicationDirs: [], win: true, windowsApps: [] };
  for (const [id, name, label] of [
    ['cursor', 'Cursor (User)', 'Cursor'], ['codebuddy', 'CodeBuddy CN (User)', 'CodeBuddy'],
    ['copilot', 'GitHub Copilot', 'GitHub Copilot'], ['kimi', 'Kimi Code', 'Kimi'],
    ['minimax', 'MiniMax Code', 'MiniMax'], ['deepseek', 'DeepSeek Harness 0.2.1-rc.3', 'DeepSeek Harness'],
  ]) {
    const dir = join(home, 'custom apps', id);
    assert.equal(desktopApp(id, { ...opts, windowsApps: [{ name, directories: [dir] }] }), null, 'stale registration');
    mkdirSync(dir, { recursive: true });
    const windowsApps = [{ name, directories: [dir] }];
    assert.equal(desktopApp(id, { ...opts, windowsApps }), label);
    assert.equal(detectAgentInstallation(id, { ...opts, windowsApps, env: { PATH: '' }, pathDirs: [] }).cli, null);
  }
});

test('DeepSeek Harness in a custom Windows folder: automatic discovery and choosing the app both retain its own shim', () => {
  const home = mkdtempSync(join(tmpdir(), 'of-dsh-custom-'));
  const root = join(home, 'custom apps', 'DeepSeek Harness');
  const gui = put(join(root, 'DeepSeek Harness.exe'), peProgram(2));
  const shim = put(join(root, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'), '@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%~dp0..\\..\\..\\..\\DeepSeek Harness.exe" "%~dp0..\\..\\..\\app.asar\\dsh\\cli.js" %*\r\n');
  const opts = { home, env: { PATH: '' }, pathDirs: [], applicationDirs: [], win: true,
    windowsApps: [{ name: 'DeepSeek Harness 0.2.1-rc.3', directories: [root] }] };
  assert.equal(detectAgentInstallation('deepseek', opts).cli, shim);
  assert.equal(chosenProgram(root, { names: ['dsh'], win: true }), shim);
  assert.equal(chosenProgram(gui, { names: ['dsh'], win: true }), shim);
  assert.equal(detectAgentInstallation('deepseek', { ...opts, chosen: gui }).source, 'chosen');
  assert.equal(notTheAgent('deepseek', shim, { chosen: gui, win: true }), null);
});

test('the remaining Windows CLI installers are found outside PATH without counting desktop executables', () => {
  const home = mkdtempSync(join(tmpdir(), 'of-cli-installers-'));
  const local = join(home, 'AppData', 'Local');
  for (const [id, file] of [
    ['qwen', join(local, 'qwen-code', 'bin', 'qwen.exe')],
    ['kimi', join(home, '.kimi-code', 'bin', 'kimi.exe')],
    ['minimax', join(home, '.minimax-code', 'bin', 'mcode.exe')],
    ['codebuddy', join(local, 'codebuddy', 'bin', 'codebuddy.exe')],
    ['cursor', join(local, 'cursor-agent', 'agent.exe')],
  ]) {
    const opts = { home, env: { PATH: '' }, pathDirs: [], applicationDirs: [], windowsApps: [], win: true };
    put(file, peProgram(2));
    assert.equal(detectAgentInstallation(id, opts).cli, null, `${id}: a GUI does not count`);
    put(file, peProgram(3));
    assert.equal(detectAgentInstallation(id, opts).cli, file, `${id}: the installer's CLI does`);
  }
});

test('MiniMax official Windows installer keeps mcode.cmd at its install root, off PATH', () => {
  const home = mkdtempSync(join(tmpdir(), 'of-mcode-root-'));
  const root = join(home, '.minimax-code');
  put(join(root, 'runtime', 'node.exe'));
  put(join(root, 'node_modules', '@minimax-ai', 'code', 'cli.js'));
  const shim = put(join(root, 'mcode.cmd'), '@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0node_modules\\@minimax-ai\\code\\cli.js" %*\r\n');
  assert.equal(detectAgentInstallation('minimax', { home, env: { PATH: '' }, pathDirs: [], applicationDirs: [], windowsApps: [], win: true }).cli, shim);
});

test('MiniMax npm CLI keeps its launcher so native SQLite uses the installing Node, not Electron', () => {
  const root = mkdtempSync(join(tmpdir(), 'of-mcode-npm-'));
  put(join(root, 'node_modules', '@minimax-ai', 'code', 'cli.js'));
  const shim = put(join(root, 'mcode.cmd'), npmShim('node_modules\\@minimax-ai\\code\\cli.js'));
  assert.equal(cmdTarget(shim), null);
  assert.equal(findExecutable('mcode', [], { PATH: root }, { win: true }), shim);
  assert.equal(chosenProgram(shim, { names: ['mcode'], win: true }), shim);
});

test("Codex on Windows: never the copy in the Store app's own folder, which Windows won't start; the copy the Codex app starts", () => {
  const home = mkdtempSync(join(tmpdir(), 'of-home-'));
  const store = put(join(home, 'Program Files', 'WindowsApps', 'OpenAI.Codex_26.1002.7124.0_x64__2p2nqsd0c76g0', 'app', 'resources', 'codex.exe'));
  assert.equal(notTheAgent('codex', store, { win: true }), 'app');
  assert.equal(notTheAgent('codex', store, { chosen: store, win: true }), 'app');
  /* a Store app's command is not in its folder, and starts */
  assert.equal(notTheAgent('codex', join(home, 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'codex.exe'), { win: true }), null);
  const none = { home, env: { PATH: '' }, pathDirs: [], applicationDirs: [], win: true, codexVersionOf: () => null };
  assert.equal(detectAgentInstallation('codex', { ...none, others: [store] }).cli, null);
  const bin = join(home, 'AppData', 'Local', 'OpenAI', 'Codex', 'bin');
  const old = put(join(bin, '5d35d2790d1d3d7b', 'codex.exe'));
  const recent = put(join(bin, '247581e40ee272fb', 'codex.exe'));
  utimesSync(old, new Date(2026, 9, 1), new Date(2026, 9, 1));
  assert.deepEqual(codexAppCopies(home), [recent, old]);
  assert.deepEqual(detectAgentInstallation('codex', { ...none, others: [store] }), { installed: true, cli: recent, source: 'app', install: detectAgentInstallation('codex', none).install });
});
