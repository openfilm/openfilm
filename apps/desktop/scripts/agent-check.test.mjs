import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summary } from './agent-check.mjs';

test('the summary: a row per agent, how far it got, a failure\'s first line and what its program said', () => {
  const text = summary([
    { id: 'codex', found: 'C:\\npm\\codex.cmd', version: 'codex-cli 0.163.0', acp: 'opened', error: null },
    { id: 'copilot', found: '/usr/local/bin/copilot', version: '1.0.98', acp: 'answered', error: null, said: 'Authentication required | set a key' },
    { id: 'claude', found: '/usr/local/bin/claude', version: '2.1.302', acp: null, error: 'no session within 120 s\nTypeError: x is not a function' },
  ], { platform: 'win32' });
  assert.match(text, /^### Agents on win32/);
  assert.match(text, /\| Codex \| ✓ opened \| codex-cli 0\.163\.0 \| C:\\\\npm\\\\codex\.cmd \|  \|/, 'a backslash escaped, so Markdown shows it as it is');
  assert.match(text, /\| GitHub Copilot \| ✓ answered \| .* \| Authentication required \\\| set a key \|/);
  assert.match(text, /\| Claude Code \| ✗ no session within 120 s \| .* \| TypeError: x is not a function \|/);
});
