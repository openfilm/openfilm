/**
 * A turn's model requests read from the agent's own record and written into its model log (local-agents-ipc.mjs
 * keepAgentRecord), in a worker thread: a record can run to hundreds of megabytes, and reading it, rebuilding each
 * request and writing them out is all synchronous, so on the app's main thread it would freeze the window. Posts
 * `{ ok: true }` once written (or when there is nothing to write), else `{ error }`.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { agentRecordCalls, compactCalls } from './agent-records.mjs';
import { writeModelLog } from './chat-store.mjs';

const { agent, sessionId, cwd, turnId, from, to, env, agentLog } = workerData;
try {
  const found = agentRecordCalls({ agent, sessionId, cwd, from, to, env, log: agentLog });
  if (found?.calls.length) writeModelLog(cwd, turnId, compactCalls(found.calls));
  parentPort?.postMessage({ ok: true });
} catch (e) {
  parentPort?.postMessage({ error: e instanceof Error ? e.message : String(e) });
}
