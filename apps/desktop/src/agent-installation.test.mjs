import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeAppCli, cmdTarget, detectAgentInstallation } from './agent-installation.mjs';

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
  assert.equal(claudeAppCli(home), null);
  const old = join(root, '2.1.9', 'claude.app/Contents/MacOS/claude');
  const recent = join(root, '2.1.10', 'f2326db61802', 'claude.app/Contents/MacOS/claude');
  for (const file of [old, recent]) { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, '', { mode: 0o755 }); }
  assert.equal(claudeAppCli(home), recent);
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
