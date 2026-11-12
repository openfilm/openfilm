import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandScript, commandScriptWindows, installOpenfilmCommand, openfilmCommand } from './openfilm-command.mjs';

test("the openfilm command alone has the app's ffmpeg first and its browser; the agent's PATH is left as it is", () => {
  const sh = commandScript('/app/node', '/app/openfilm.mjs', { ffmpeg: '/app/ffmpeg', env: { PLAYWRIGHT_BROWSERS_PATH: '/app/pw' } });
  assert.match(sh, /^#!\/bin\/sh\n/);
  assert.match(sh, /PLAYWRIGHT_BROWSERS_PATH='\/app\/pw' PATH='\/app\/ffmpeg':"\$PATH" ELECTRON_RUN_AS_NODE=1 OPENFILM_NO_UPDATE_CHECK=1 exec '\/app\/node' '\/app\/openfilm.mjs' "\$@"\n$/);
  assert.doesNotMatch(commandScript('/n', '/c'), /PATH=/);
  const cmd = commandScriptWindows('C:\\app\\node.exe', 'C:\\app\\openfilm.mjs', { ffmpeg: 'C:\\app\\ffmpeg', env: { PLAYWRIGHT_BROWSERS_PATH: 'C:\\pw' } });
  assert.match(cmd, /setlocal\r\nset "PLAYWRIGHT_BROWSERS_PATH=C:\\pw"\r\nset "PATH=C:\\app\\ffmpeg;%PATH%"\r\n/);
});

test('the installed command names itself by its whole path in all it prints (OPENFILM_RUN), a space in it too', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm app '));
  try {
    /* stands in for the app's Node: says what the CLI would be run with */
    const node = join(dir, 'node');
    writeFileSync(node, '#!/bin/sh\nprintf %s "$OPENFILM_RUN"\n');
    chmodSync(node, 0o755);
    const bin = installOpenfilmCommand(dir, { node });
    assert.equal(execFileSync(join(bin, 'openfilm'), { encoding: 'utf8' }), openfilmCommand(bin));
    assert.equal(execFileSync('/bin/sh', ['-c', `${openfilmCommand(bin)} --version`], { encoding: 'utf8' }), openfilmCommand(bin), 'runs as the agent types it');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a script run after as-node.mjs is the main module, with its arguments, and no ELECTRON_RUN_AS_NODE', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-as-node-'));
  try {
    const script = join(dir, 'show.mjs');
    writeFileSync(script, "console.log(JSON.stringify({ main: import.meta.main, argv: process.argv.slice(1), runAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null }));\n");
    const asNode = new URL('./as-node.mjs', import.meta.url).href;
    const out = JSON.parse(execFileSync(process.execPath, ['--import', asNode, script, '--flag', 'x'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' }));
    assert.deepEqual(out, { main: true, argv: [script, '--flag', 'x'], runAsNode: null });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a Windows command doubles % and leaves & alone in env, ffmpeg and the node and CLI paths', () => {
  const cmd = commandScriptWindows('C:\\R&D%\\node.exe', 'C:\\R&D%\\openfilm.mjs', {
    ffmpeg: 'C:\\R&D\\ffmpeg',
    env: { PLAYWRIGHT_BROWSERS_PATH: 'C:\\OpenFilm\\R&D%\\pw' },
  });
  assert.match(cmd, /set "PLAYWRIGHT_BROWSERS_PATH=C:\\OpenFilm\\R&D%%\\pw"\r\n/);
  assert.match(cmd, /set "PATH=C:\\R&D\\ffmpeg;%PATH%"\r\n/, 'the appended %PATH% stays one expansion');
  assert.match(cmd, /"C:\\R&D%%\\node\.exe" "C:\\R&D%%\\openfilm\.mjs" %\*\r\n$/, 'the node and CLI come from the same folder');
});

test('the generated .cmd keeps % and & literal when cmd.exe runs it', { skip: process.platform !== 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-cmd-'));
  try {
    /* stands in for the app's Node: prints back what the command set for it */
    const show = join(dir, 'show.cmd');
    writeFileSync(show, '@echo off\r\nset PLAYWRIGHT_BROWSERS_PATH\r\nset PATH\r\n');
    const script = join(dir, 'openfilm.cmd');
    writeFileSync(script, commandScriptWindows(show, join(dir, 'openfilm.mjs'), {
      ffmpeg: 'C:\\R&D\\ffmpeg',
      env: { PLAYWRIGHT_BROWSERS_PATH: 'C:\\OpenFilm\\R&D%\\pw' },
    }));
    const out = execFileSync('cmd', ['/c', script], { encoding: 'utf8' });
    assert.match(out, /PLAYWRIGHT_BROWSERS_PATH=C:\\OpenFilm\\R&D%\\pw/);
    assert.match(out, /^Path=C:\\R&D\\ffmpeg;/im, 'cmd prints the variable as Path');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
