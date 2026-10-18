import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { agentHints, doctor, formatReport, logTrouble, softwareRenderer, tidy } from './doctor.mjs';

test('a path under the home folder reads ~', () => {
  assert.equal(tidy('/Volumes/Home/someone/.openfilm', '/Volumes/Home/someone'), '~/.openfilm');
  assert.equal(tidy('/opt/homebrew/bin/node', '/Volumes/Home/someone'), '/opt/homebrew/bin/node');
});

test('the agent that ran it is told by its variables\' names, never their values', () => {
  const { agents, names } = agentHints({ CLAUDECODE: '1', CLAUDE_CODE_OAUTH_TOKEN: 'secret', PATH: '/bin', CODEX_SANDBOX: 'seatbelt' });
  assert.deepEqual(agents, ['Claude Code', 'Codex']);
  assert.deepEqual(names, ['CLAUDECODE', 'CLAUDE_CODE_OAUTH_TOKEN', 'CODEX_SANDBOX']);
  assert.ok(!JSON.stringify({ agents, names }).includes('secret'));
  assert.deepEqual(agentHints({ PATH: '/bin', TERM_PROGRAM: 'vscode' }).agents, []);
});

test('the log\'s errors: the last few, a repeated one once with its count', () => {
  const log = ['started', 'Error: spawn EBADF', 'Error: spawn EBADF', 'Error: spawn EBADF', 'ok', 'uncaught: boom', 'x'.repeat(400) + ' failed'].join('\n');
  const lines = logTrouble(log);
  assert.deepEqual(lines.slice(0, 2), ['Error: spawn EBADF (×3)', 'uncaught: boom']);
  assert.ok(lines[2].length <= 300 && lines[2].endsWith('…'));
  assert.equal(logTrouble(log, 1).length, 1);
});

test('a WebGL drawn in software is told apart from a graphics chip', () => {
  assert.equal(softwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), true);
  assert.equal(softwareRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'), false);
  assert.equal(softwareRenderer(null), false);
});

test('the report lists each check, then what to fix', () => {
  const text = formatReport([{ label: 'Node', text: 'v22.18.0' }, { label: 'ffmpeg', text: 'not found on the PATH', problem: 'install ffmpeg' }]);
  assert.match(text, /✓ Node {4}v22\.18\.0/);
  assert.match(text, /✗ ffmpeg {2}not found on the PATH/);
  assert.match(text, /To fix:\n {2}ffmpeg: install ffmpeg/);
  assert.match(formatReport([{ label: 'Node', text: 'v22' }]), /Nothing to fix\./);
});

test('doctor: the folders and the log, paths under home as ~', async () => {
  const home = mkdtempSync(join(tmpdir(), 'openfilm-doctor-'));
  const data = join(home, '.openfilm');
  mkdirSync(join(data, 'logs'), { recursive: true });
  writeFileSync(join(data, 'logs', 'studio.log'), `2026-10-18T00:00:00Z Error: could not read ${join(home, 'film', 'film.html')}\n`);
  const before = { home: process.env.OPENFILM_HOME, library: process.env.OPENFILM_LIBRARY };
  process.env.OPENFILM_HOME = data;
  process.env.OPENFILM_LIBRARY = join(home, 'Projects');
  try {
    const report = await doctor({ env: { CODEX_SANDBOX: 'seatbelt' }, studio: { origin: 'http://127.0.0.1:4848', version: '0.1.7' }, browser: false, network: false, home });
    assert.match(report.text, /Run by +Codex \(CODEX_SANDBOX\)/);
    assert.match(report.text, /Studio +0\.1\.7 at http:\/\/127\.0\.0\.1:4848/);
    /* what ffmpeg does on the graphics chip here, or that it does it on the processor */
    if (/ffmpeg +\d/.test(report.text)) assert.match(report.text, /Hardware +ffmpeg encodes (with [^;]+|on the processor); decodes (with \S+|on the processor)\n/);
    assert.match(report.text, /Data +~[/\\]\.openfilm/);
    assert.match(report.text, /Projects +~[/\\]Projects \(not made yet\)/);
    assert.match(report.text, /Last errors in ~.*studio\.log:\n {2}.*could not read ~[/\\]film/);
    assert.ok(!report.text.includes(home), 'no full home path');
    assert.ok(!report.text.includes('seatbelt'), 'no variable values');
  } finally {
    for (const [name, value] of [['OPENFILM_HOME', before.home], ['OPENFILM_LIBRARY', before.library]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
});
