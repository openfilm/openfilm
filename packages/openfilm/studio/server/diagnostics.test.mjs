import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordProblem, problemsFile } from '../../src/problems.mjs';
import { diagnosticsName, exportDiagnostics, turnLogForFile } from './diagnostics.mjs';

const TURN = [
  { t: 1, kind: 'prompt', agent: 'codex', text: 'make my secret film', meta: { model: '6.1 Sol' }, session: { agentInfo: { name: 'codex-acp', version: '1.13.1' } }, opened: { program: '/x/codex', adapter: '@agentclientprotocol/codex-acp' } },
  { t: 2, kind: 'sent', prompt: [{ type: 'text', text: 'make my secret film' }] },
  { t: 3, kind: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'a reply about the secret' } } },
  { t: 4, kind: 'update', update: { sessionUpdate: 'notice', severity: 'warning', title: 'Reconnecting... 2/5' } },
  { t: 4.1, kind: 'update', update: { sessionUpdate: 'tool_call', toolCallId: 'c1', title: "List files in 'secret'", name: 'exec_command', kind: 'read', status: 'in_progress', rawInput: { command: 'ls secret' } } },
  { t: 4.2, kind: 'update', update: { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'failed', name: 'exec_command', rawOutput: { formatted_output: 'secret.txt', exit_code: 2 } } },
  { t: 4.3, kind: 'permission', params: { toolCall: { title: 'Delete secret' } } },
  { t: 4.4, kind: 'question', message: 'Which secret?' },
  { t: 5, kind: 'done', ok: false, error: 'Codex stopped while answering without saying why.' },
].map((e) => JSON.stringify(e)).join('\n');

test("a turn's log goes in as how it went, without what was said unless asked", () => {
  const kept = turnLogForFile(TURN, false);
  assert.doesNotMatch(kept, /secret/);
  assert.match(kept, /Reconnecting\.\.\. 2\/5/);
  assert.match(kept, /without saying why/);
  const prompt = JSON.parse(kept.split('\n')[0]);
  assert.deepEqual([prompt.kind, prompt.model, prompt.program, prompt.words], ['prompt', '6.1 Sol', '/x/codex', '(left out)']);
  const steps = kept.split('\n').map((l) => JSON.parse(l)).filter((e) => e.update?.toolCallId);
  assert.deepEqual(steps.map((e) => e.update), [
    { sessionUpdate: 'tool_call', toolCallId: 'c1', name: 'exec_command', kind: 'read', status: 'in_progress' },
    { sessionUpdate: 'tool_call_update', toolCallId: 'c1', name: 'exec_command', status: 'failed', exitCode: 2 },
  ]);
  assert.match(kept, /"kind":"permission","words":"\(left out\)"/);
  assert.equal(turnLogForFile(TURN, true), TURN);
});

test('the diagnostic file: the report, the problems, the logs, the failed turns, and Codex\'s own log around its problem', async () => {
  const root = mkdtempSync(join(tmpdir(), 'openfilm-diagnostics-'));
  const home = join(root, 'home');
  const appLogs = join(root, 'app-logs');
  const project = join(root, 'Film');
  const codexHome = join(root, 'codex');
  for (const dir of [join(home, 'logs'), appLogs, join(project, '.film', 'logs'), codexHome]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(home, 'logs', 'studio.log'), 'listening\nexport failed: no codec\n');
  writeFileSync(join(appLogs, 'updates.log'), '{"status":"current"}\n');
  const log = join(project, '.film', 'logs', 'local-abc.jsonl');
  writeFileSync(log, TURN);
  const at = new Date('2026-10-18T13:13:15Z');
  recordProblem({ area: 'agent', agent: 'Codex', agentId: 'codex', step: 'session/prompt', what: 'Codex stopped while answering without saying why.', project, log, ownLogs: codexHome }, { file: problemsFile(home), now: at });

  /* Codex's log database, as Codex keeps it */
  let sqlite = null;
  try { sqlite = await import('node:sqlite'); } catch { /* a Node without it: that part is left out */ }
  if (sqlite) {
    const db = new sqlite.DatabaseSync(join(codexHome, 'logs_2.sqlite'));
    db.exec('CREATE TABLE logs (id INTEGER PRIMARY KEY, ts INTEGER, ts_nanos INTEGER, level TEXT, target TEXT, feedback_log_body TEXT)');
    const add = db.prepare('INSERT INTO logs (ts, ts_nanos, level, target, feedback_log_body) VALUES (?, 0, ?, ?, ?)');
    const s = Math.floor(at.getTime() / 1000);
    add.run(s - 10, 'ERROR', 'codex_models_manager', 'failed to refresh available models: request timed out');
    add.run(s - 5, 'INFO', 'codex_http_client', 'using system root certificates');
    add.run(s - 3600, 'ERROR', 'codex_core', 'an hour before');
    db.close();
  }

  const made = await exportDiagnostics({ report: 'OpenFilm doctor\n✓ Node', folder: join(root, 'out'), home, appLogs, now: new Date('2026-10-18T14:00:00Z') });
  assert.equal(made.path, join(root, 'out', diagnosticsName(new Date('2026-10-18T14:00:00Z'))));
  assert.deepEqual(made.files.filter((f) => f !== 'agents/codex.txt'), ['report.txt', 'problems.jsonl', 'logs/studio/studio.log', 'logs/app/updates.log', 'turns/local-abc.jsonl']);
  const zip = readFileSync(made.path).toString('utf8');
  assert.match(zip, /OpenFilm doctor/);
  assert.match(zip, /export failed: no codec/);
  assert.match(zip, /Reconnecting\.\.\. 2\/5/);
  assert.doesNotMatch(zip, /secret/, 'no words of the turn');
  if (sqlite) {
    assert.ok(made.files.includes('agents/codex.txt'));
    assert.match(zip, /request timed out/);
    assert.doesNotMatch(zip, /system root certificates|an hour before/, 'only warnings and errors, around the problem');
  }
});
