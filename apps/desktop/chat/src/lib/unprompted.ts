/**
 * Turns the agent starts by itself: a background task of its own came back after its turn (a command it ran in the
 * background, a subagent), and it takes it up, as in its own chat (lib/local-agent-run onUnpromptedTurn).
 *
 * Pure: no React, no bridge, so `node --test` runs it (src/unprompted.test.mjs).
 */

/**
 * The updates that mean the agent has gone on working: it writes, thinks, starts a tool or plans. Not an update of a
 * call (`tool_call_update`): that is the rest of a call already shown, such as a command still running as its turn
 * ended (it was stopped, or ended without waiting), whose output and exit come after.
 */
const OPENS_A_TURN = new Set(['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'plan']);

/** Whether this update, with no turn open, is the agent working by itself. */
export function opensUnprompted(update: { sessionUpdate?: unknown }): boolean {
  return typeof update.sessionUpdate === 'string' && OPENS_A_TURN.has(update.sessionUpdate);
}

/** A turn the agent started by itself that ended with nothing in it: not shown, a line with nothing under it. */
export function isEmptyBackgroundTurn(
  turn: { origin?: unknown; status?: unknown; error?: unknown },
  items: readonly unknown[],
): boolean {
  const settled = turn.status === 'ready' || turn.status === 'cancelled';
  return turn.origin === 'background' && settled && !turn.error && items.length === 0;
}
