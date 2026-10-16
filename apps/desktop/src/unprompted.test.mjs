import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEmptyBackgroundTurn, opensUnprompted } from '../chat/src/lib/unprompted.ts';

test('the agent writing, thinking, starting a tool or planning opens a turn of its own', () => {
  for (const sessionUpdate of ['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'plan']) {
    assert.equal(opensUnprompted({ sessionUpdate }), true, sessionUpdate);
  }
});

test('the late output and exit of a command from a turn already ended open no turn', () => {
  /* as Codex sent them 2.6 s after a stopped turn: `openfilm look` still running, then done */
  const late = [
    { sessionUpdate: 'tool_call_update', toolCallId: 'exec-1', _meta: { terminal_output_delta: { data: 'film  1920×1080\n' } } },
    { sessionUpdate: 'tool_call_update', toolCallId: 'exec-1', status: 'completed', _meta: { terminal_exit: { exit_code: 0 } } },
  ];
  for (const update of late) assert.equal(opensUnprompted(update), false);
});

test('lists, settings and usage open no turn', () => {
  for (const sessionUpdate of ['available_commands_update', 'session_info_update', 'usage_update', 'config_option_update', undefined]) {
    assert.equal(opensUnprompted({ sessionUpdate }), false, String(sessionUpdate));
  }
});

test('a background turn that ended with nothing in it is empty', () => {
  assert.equal(isEmptyBackgroundTurn({ origin: 'background', status: 'ready', error: null }, []), true);
  assert.equal(isEmptyBackgroundTurn({ origin: 'background', status: 'cancelled' }, []), true);
});

test('a background turn with something in it, still running, or failed is kept', () => {
  assert.equal(isEmptyBackgroundTurn({ origin: 'background', status: 'ready' }, [{ type: 'text' }]), false);
  assert.equal(isEmptyBackgroundTurn({ origin: 'background', status: 'generating' }, []), false);
  assert.equal(isEmptyBackgroundTurn({ origin: 'background', status: 'error', error: 'OpenFilm closed while the agent was working on this.' }, []), false);
});

test('a turn the person started is never dropped, even with nothing in it', () => {
  assert.equal(isEmptyBackgroundTurn({ status: 'cancelled' }, []), false);
  assert.equal(isEmptyBackgroundTurn({ status: 'ready' }, []), false);
});
