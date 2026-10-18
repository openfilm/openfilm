import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentLine, appReport, gatherAppReport } from './app-report.mjs';

const HOME = '/Volumes/Home/someone';

test('an agent\'s line: its state, version and program, paths in home as ~', () => {
  assert.equal(agentLine({ id: 'codex', name: 'Codex', status: 'ready', path: `${HOME}/.npm-global/bin/codex` }, { ok: true, version: 'codex-cli 0.163.0' }, HOME),
    '✓ Codex          ready · codex-cli 0.163.0 · ~/.npm-global/bin/codex');
  assert.equal(agentLine({ id: 'cursor', name: 'Cursor', status: 'missing', path: null }, null, HOME), '– Cursor         missing');
  assert.match(agentLine({ id: 'claude', name: 'Claude Code', status: 'sign-in', path: '/opt/homebrew/bin/claude' }, { ok: true, version: '2.1.302' }, HOME), /^✗ Claude Code +sign-in/);
});

test('a program that does not start, or an error the app saw, is something to fix, said on one line', () => {
  const line = agentLine({ id: 'codex', name: 'Codex', status: 'ready', path: 'D:\\Profiles\\someone\\AppData\\Roaming\\npm\\codex.cmd', chosen: 'x' },
    { ok: false, error: 'Error: spawn EINVAL\n    at ChildProcess.spawn' }, 'D:\\Profiles\\someone');
  assert.match(line, /^✗ Codex/);
  assert.match(line, /--version failed: Error: spawn EINVAL at ChildProcess\.spawn/);
  assert.match(line, /~\\AppData\\Roaming\\npm\\codex\.cmd \(chosen\)/);
  assert.match(agentLine({ id: 'kimi', name: 'Kimi', status: 'ready', path: '/bin/kimi', error: 'auth_required' }, null, HOME), /^✗ Kimi .* · auth_required$/);
});

test('the report: the app, then each agent, the own-key one without a program', () => {
  const text = appReport({
    version: '0.1.8', flavor: 'release', packaged: true, channel: 'beta', electron: '44.4.0', pathSource: 'login shell', home: HOME,
    agents: [{ id: 'codex', name: 'Codex', status: 'ready', path: `${HOME}/bin/codex` }, { id: 'byok', name: 'Own key', status: 'key' }],
    versions: { codex: { ok: true, version: '0.163.0' } },
  });
  assert.match(text, /App +0\.1\.8 \(release, beta updates; Electron 44\.4\.0\)/);
  assert.match(text, /PATH from +login shell/);
  assert.match(text, /✓ Codex +ready · 0\.163\.0 · ~\/bin\/codex/);
  assert.match(text, /– Own key +key$/);
});

test('gathering asks --version of the agents found, and only those', async () => {
  const asked = [];
  const text = await gatherAppReport({
    list: async () => [
      { id: 'codex', name: 'Codex', status: 'ready', path: '/bin/codex' },
      { id: 'cursor', name: 'Cursor', status: 'missing', path: null },
      { id: 'qwen', name: 'Qwen Code', status: 'ready', path: '/bin/qwen' },
    ],
    check: async (id) => { asked.push(id); if (id === 'qwen') throw new Error('boom'); return { ok: true, version: '1.0' }; },
  }, { version: '0.1.8', flavor: 'dev', packaged: false, electron: '44.4.0', pathSource: null });
  assert.deepEqual(asked.sort(), ['codex', 'qwen']);
  assert.match(text, /from source/);
  assert.match(text, /✗ Qwen Code +ready · --version failed: boom/);
});
