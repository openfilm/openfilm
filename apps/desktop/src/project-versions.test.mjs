import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveProjectTurns } from '../chat/src/lib/project-versions.ts';

const turn = (id, status, extra = {}) => ({
  id, prompt: id, status, createdAt: `2026-10-18T10:00:0${id.length}Z`, updatedAt: `2026-10-18T10:01:0${id.length}Z`, ...extra,
});

test("a failed turn keeps why it failed, for the chat to say after a restart; one that stopped or finished has none", () => {
  const [failed, stopped, done] = deriveProjectTurns([
    turn('a', 'error', { error: 'Kimi: 403 Your current subscription does not have access to Kimi Code right now.' }),
    turn('bb', 'cancelled', { error: 'stopped' }),
    turn('ccc', 'ready'),
  ], [], null);
  assert.equal(failed.outcome, 'failed');
  assert.equal(failed.error, 'Kimi: 403 Your current subscription does not have access to Kimi Code right now.');
  assert.equal(stopped.outcome, 'stopped');
  assert.equal(stopped.error, undefined);
  assert.equal(done.error, undefined);
});
