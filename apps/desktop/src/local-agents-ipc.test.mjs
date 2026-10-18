import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { agentProblem } from './local-agents-ipc.mjs';

test('an agent that failed, as its problem is kept: its name, why, the step, the last of its stderr and its turn\'s log', () => {
  const session = { stderr: 'a\nb\nc\nd\ne\nError: write EPIPE\n' };
  const e = Object.assign(new Error('ACP connection closed'), { code: -32603 });
  assert.deepEqual(agentProblem({ agent: 'codex', cwd: '/p/Film', session }, 'prompt', e, 'local:abc'), {
    area: 'agent', agent: 'Codex', agentId: 'codex', what: 'ACP connection closed', step: 'prompt', code: '-32603',
    project: '/p/Film', log: join('/p/Film', '.film', 'logs', 'local-abc.jsonl'), stderr: 'b\nc\nd\ne\nError: write EPIPE',
  });
  /* a session that says how it failed (agents.mjs `failure()`): its step, program and own logs */
  const told = { failure: () => ({ step: 'session/new', program: '/x/codex', stderr: '', ownLogs: '/h/.codex' }) };
  assert.deepEqual(agentProblem({ agent: 'codex', cwd: '/p/Film', session: told }, 'start', new Error('Internal error')), {
    area: 'agent', agent: 'Codex', agentId: 'codex', what: 'Internal error', step: 'session/new', project: '/p/Film', program: '/x/codex', ownLogs: '/h/.codex',
  });
  assert.equal(agentProblem({ agent: 'byok', cwd: '/p' }, 'start', 'no models').agent, 'Own key');
});
