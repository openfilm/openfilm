import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentRecordCalls, claudeCallsOf, claudeProjectName, codexCallsOf, compactCalls, copilotCallsOf, findClaudeRecord, findCodexRecord, findCopilotRecord, findKimiRecord, kimiCallsOf } from './agent-records.mjs';

const at = (s) => new Date(Date.UTC(2026, 9, 15, 10, 0, s)).toISOString();
const jsonl = (rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;

/** A Claude Code session: a message, its context, two requests (the first asking for a tool), a reply. */
function claudeSession() {
  return [
    { type: 'queue-operation', operation: 'enqueue', timestamp: at(0) },
    { type: 'user', uuid: 'u1', parentUuid: null, timestamp: at(1), message: { role: 'user', content: [{ type: 'text', text: 'Make a title' }] } },
    { type: 'attachment', uuid: 'a1', parentUuid: 'u1', timestamp: at(1), attachment: { type: 'instructions', files: [] }, rendered: [{ content: '<CLAUDE.md>be brief</CLAUDE.md>' }], renderedRole: 'user' },
    { type: 'attachment', uuid: 'a2', parentUuid: 'a1', timestamp: at(1), attachment: { type: 'credential_org', organizationUuid: 'x' } },
    { type: 'attachment', uuid: 's1', parentUuid: 'a2', timestamp: at(1), attachment: { type: 'prompt_snapshot', systemPrompt: ['You are an agent.', 'You are inside OpenFilm.'], tools: null } },
    { type: 'assistant', uuid: 'r1a', parentUuid: 's1', timestamp: at(3), requestId: 'req1', effort: 'high',
      message: { id: 'msg1', model: 'claude-x', role: 'assistant', content: [{ type: 'thinking', thinking: 'plan' }], stop_reason: null, usage: { input_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 10, output_tokens: 1 } } },
    { type: 'assistant', uuid: 'r1b', parentUuid: 'r1a', timestamp: at(4), requestId: 'req1',
      wireToolInputs: { tu1: { command: 'openfilm look', description: 'as written' } },
      message: { id: 'msg1', model: 'claude-x', role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'openfilm look' } }], stop_reason: 'tool_use', usage: { input_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 10, output_tokens: 40, output_tokens_details: { thinking_tokens: 12 } } } },
    { type: 'user', uuid: 'u2', parentUuid: 'r1b', timestamp: at(6), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'frames saved', is_error: false }] } },
    { type: 'attachment', uuid: 's2', parentUuid: 'u2', timestamp: at(6), attachment: { type: 'prompt_snapshot', systemPrompt: ['You are an agent.', 'You are inside OpenFilm.'], cliPrefix: 'You are Claude Code.', tools: [{ name: 'Bash', description: 'Run a command', schema: { type: 'object' } }] } },
    { type: 'assistant', uuid: 'r2', parentUuid: 's2', timestamp: at(9), requestId: 'req2',
      message: { id: 'msg2', model: 'claude-x', role: 'assistant', content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn', usage: { input_tokens: 2, cache_read_input_tokens: 150, output_tokens: 3 } } },
    { type: 'last-prompt', lastPrompt: 'Make a title' },
  ];
}

test("Claude Code's record: each request whole, with its system prompt, the context it attached, its tools and its answer", () => {
  const calls = claudeCallsOf(claudeSession());
  assert.equal(calls.length, 2, 'one call per request, not per block');
  const [first, second] = calls;
  assert.equal(first.systemPrompt, 'You are an agent.\n\nYou are inside OpenFilm.');
  assert.equal(first.tools, null, 'no tools in the record yet');
  assert.deepEqual(first.messages, [
    { role: 'user', content: [{ type: 'text', text: 'Make a title' }] },
    { role: 'context', as: 'user', label: 'instructions', content: [{ type: 'text', text: '<CLAUDE.md>be brief</CLAUDE.md>' }] },
  ], 'the person\'s words and what Claude Code put in; nothing it did not send (credential_org, snapshots)');
  assert.deepEqual(first.answer.content, [
    { type: 'thinking', thinking: 'plan' },
    { type: 'toolCall', id: 'tu1', name: 'Bash', arguments: { command: 'openfilm look', description: 'as written' } },
  ], 'the request\'s blocks joined; the tool input as the model wrote it');
  assert.equal(first.answer.stopReason, 'tool_use');
  assert.deepEqual(first.answer.usage, { input: 5, cacheRead: 100, cacheWrite: 10, output: 40, reasoning: 12 });
  assert.equal(first.answer.thinkingLevel, 'high');
  assert.equal(first.startedAt, Date.parse(at(1)));
  assert.equal(first.ms, 3000, 'from what it was sent to its last block');

  assert.equal(second.systemPrompt, 'You are Claude Code.\n\nYou are an agent.\n\nYou are inside OpenFilm.', 'the CLI prefix first');
  assert.deepEqual(second.tools, [{ name: 'Bash', description: 'Run a command', parameters: { type: 'object' } }]);
  assert.equal(second.messages.length, 4);
  assert.equal(second.messages[2].role, 'assistant');
  assert.equal(second.messages[2].content.length, 2, 'the earlier answer, whole');
  assert.deepEqual(second.messages[3], { role: 'toolResult', toolCallId: 'tu1', toolName: 'Bash', content: [{ type: 'text', text: 'frames saved' }], isError: false });
  assert.deepEqual(second.answer.content, [{ type: 'text', text: 'Done.' }]);
});

test("Claude Code's record: only the requests whose answers began in the turn", () => {
  const calls = claudeCallsOf(claudeSession(), { from: Date.parse(at(5)), to: Date.parse(at(10)) });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].answer.content, [{ type: 'text', text: 'Done.' }]);
});

test("Codex's rollout: base instructions, what Codex put in, each request closed by its usage, tool calls and their output", () => {
  const rows = [
    { timestamp: at(0), type: 'session_meta', payload: { id: 'th1', base_instructions: { text: 'You are Codex.' } } },
    { timestamp: at(0), type: 'turn_context', payload: { model: 'gpt-x', effort: 'high', approval_policy: 'never' } },
    { timestamp: at(1), type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'You are inside OpenFilm.' }] } },
    { timestamp: at(1), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] } },
    { timestamp: at(1), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Make a title' }] } },
    { timestamp: at(3), type: 'response_item', payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'look first' }], encrypted_content: 'zzz' } },
    { timestamp: at(3), type: 'response_item', payload: { type: 'function_call', name: 'exec', arguments: '{"cmd":"openfilm look"}', call_id: 'c1' } },
    { timestamp: at(4), type: 'token_usage_record', payload: { usage: { input_tokens: 120, cached_input_tokens: 100, output_tokens: 9, reasoning_output_tokens: 4 } } },
    { timestamp: at(4), type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 999 } } } },
    { timestamp: at(6), type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: 'frames saved' } },
    { timestamp: at(8), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] } },
    { timestamp: at(9), type: 'token_usage_record', payload: { usage: { input_tokens: 150, cached_input_tokens: 120, output_tokens: 3 } } },
  ];
  const calls = codexCallsOf(rows);
  assert.equal(calls.length, 2, 'a token_count beside a usage record is not a request of its own');
  const [first, second] = calls;
  assert.equal(first.systemPrompt, 'You are Codex.');
  assert.equal(first.tools, null);
  assert.equal(first.toolsUnknown, true);
  assert.deepEqual(first.settings, { model: 'gpt-x', effort: 'high', approval_policy: 'never' });
  assert.deepEqual(first.messages.map((m) => [m.role, m.label ?? null]), [['context', 'developer'], ['context', 'environment_context'], ['user', null]]);
  assert.deepEqual(first.answer.content, [{ type: 'thinking', thinking: 'look first' }, { type: 'toolCall', id: 'c1', name: 'exec', arguments: { cmd: 'openfilm look' } }]);
  assert.deepEqual(first.answer.usage, { input: 20, cacheRead: 100, cacheWrite: 0, output: 9, reasoning: 4 }, 'input without the cached part');
  assert.equal(first.answer.responseModel, 'gpt-x');
  assert.deepEqual(second.messages.slice(3), [
    { role: 'assistant', content: first.answer.content },
    { role: 'toolResult', toolCallId: 'c1', toolName: 'exec', content: [{ type: 'text', text: 'frames saved' }], isError: false },
  ]);
  assert.deepEqual(second.answer.content, [{ type: 'text', text: 'Done.' }]);
  assert.equal(second.startedAt, Date.parse(at(6)), 'sent with the tool\'s output');
  assert.equal(second.ms, 3000);
});

test("Codex's rollout: an older one closes requests by token_count; a compaction starts the history again", () => {
  const rows = [
    { timestamp: at(1), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'one' }] } },
    { timestamp: at(2), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'a' }] } },
    { timestamp: at(2), type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 10, output_tokens: 1 } } } },
    { timestamp: at(3), type: 'compacted', payload: { message: 'they asked for one' } },
    { timestamp: at(4), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'two' }] } },
    { timestamp: at(5), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'b' }] } },
    { timestamp: at(5), type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 4, output_tokens: 1 } } } },
  ];
  const calls = codexCallsOf(rows);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].answer.usage.input, 10);
  assert.deepEqual(calls[1].messages, [
    { role: 'context', as: 'user', label: 'compaction summary', content: [{ type: 'text', text: 'they asked for one' }] },
    { role: 'user', content: [{ type: 'text', text: 'two' }] },
  ]);
});

test('records are found where each agent keeps them, and a turn reads its own requests from them', () => {
  const home = mkdtempSync(join(tmpdir(), 'of-records-'));
  const cwd = '/Users/me/Movies/OpenFilm/My film';
  assert.equal(claudeProjectName(cwd), '-Users-me-Movies-OpenFilm-My-film');
  const claudeDir = join(home, 'claude', 'projects', claudeProjectName(cwd));
  mkdirSync(join(claudeDir, 'sess-1234', 'subagents'), { recursive: true });
  writeFileSync(join(claudeDir, 'sess-1234.jsonl'), jsonl(claudeSession()));
  /* a subagent's request, named by its meta */
  writeFileSync(join(claudeDir, 'sess-1234', 'subagents', 'agent-abc.jsonl'), jsonl([
    { type: 'user', uuid: 'x1', parentUuid: null, timestamp: at(7), isSidechain: true, message: { role: 'user', content: 'search' } },
    { type: 'assistant', uuid: 'x2', parentUuid: 'x1', timestamp: at(8), isSidechain: true, message: { id: 'm9', role: 'assistant', content: [{ type: 'text', text: 'found' }], usage: {} } },
  ]));
  writeFileSync(join(claudeDir, 'sess-1234', 'subagents', 'agent-abc.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Find files' }));
  const env = { CLAUDE_CONFIG_DIR: join(home, 'claude'), CODEX_HOME: join(home, 'codex') };
  assert.ok(findClaudeRecord({ sessionId: 'sess-1234', cwd, env }));
  assert.ok(findClaudeRecord({ sessionId: 'sess-1234', cwd: '/elsewhere', env }), 'found by its id when the folder is named differently');
  assert.equal(findClaudeRecord({ sessionId: '../../etc', cwd, env }), null);

  const read = agentRecordCalls({ agent: 'claude', sessionId: 'sess-1234', cwd, env, from: Date.parse(at(5)), to: Date.parse(at(10)) });
  assert.deepEqual(read.calls.map((c) => c.thread?.label ?? 'main'), ['main', 'Explore · Find files'], 'in time order, the subagent\'s named');
  assert.equal(read.calls[0].source.agent, 'claude');

  const day = join(home, 'codex', 'sessions', '2026', '10', '15');
  mkdirSync(day, { recursive: true });
  writeFileSync(join(day, 'rollout-2026-10-15T10-00-00-th-56789.jsonl'), jsonl([
    { timestamp: at(1), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] } },
    { timestamp: at(2), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] } },
    { timestamp: at(2), type: 'token_usage_record', payload: { usage: {} } },
  ]));
  assert.ok(findCodexRecord({ sessionId: 'th-56789', env }));
  assert.equal(agentRecordCalls({ agent: 'codex', sessionId: 'th-56789', env, from: 0, to: Infinity }).calls.length, 1);
  assert.equal(agentRecordCalls({ agent: 'cursor', sessionId: 'x', env }), null, 'an agent whose record is not read');
});

test("Kimi's wire: each request from llm.request to step.end, with the system prompt and tools in effect and the model's own time", () => {
  const t = (s) => Date.parse(at(s));
  const rows = [
    { type: 'config.update', systemPrompt: 'You are Kimi.', time: t(0) },
    { type: 'turn.prompt', input: [{ type: 'text', text: 'Make a title' }], time: t(1) },
    { type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: 'Make a title' }] }, time: t(1) },
    { type: 'llm.tools_snapshot', tools: [{ name: 'Bash', description: 'Run', parameters: { type: 'object' } }], time: t(1) },
    { type: 'llm.request', model: 'k2', thinkingEffort: 'high', messageCount: 1, time: t(1) },
    { type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'think', think: 'plan' } }, time: t(2) },
    { type: 'context.append_loop_event', event: { type: 'tool.call', toolCallId: 'k1', name: 'Bash', args: { command: 'openfilm look' } }, time: t(3) },
    { type: 'context.append_loop_event', event: { type: 'tool.result', toolCallId: 'k1', result: { output: 'frames saved' } }, time: t(30) },
    { type: 'context.append_loop_event', event: { type: 'step.end', usage: { inputOther: 20, inputCacheRead: 100, output: 9 }, finishReason: 'tool_calls', llmFirstTokenLatencyMs: 500, llmStreamDurationMs: 1500 }, time: t(30) },
    { type: 'llm.request', model: 'k2', messageCount: 3, time: t(31) },
    { type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: 'Done.' } }, time: t(32) },
    { type: 'context.append_loop_event', event: { type: 'step.end', usage: { inputOther: 5, output: 2 } }, time: t(32) },
  ];
  const calls = kimiCallsOf(rows);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].systemPrompt, 'You are Kimi.');
  assert.deepEqual(calls[0].tools, [{ name: 'Bash', description: 'Run', parameters: { type: 'object' } }]);
  assert.equal(calls[0].ms, 2000, 'the model\'s own time, not the tool\'s');
  assert.deepEqual(calls[0].answer.content, [{ type: 'thinking', thinking: 'plan' }, { type: 'toolCall', id: 'k1', name: 'Bash', arguments: { command: 'openfilm look' } }]);
  assert.deepEqual(calls[0].answer.usage, { input: 20, cacheRead: 100, cacheWrite: 0, output: 9, reasoning: 0 });
  assert.equal(calls[1].messages.length, calls[1].settings.messageCount, 'as many messages as Kimi says it sent');
  assert.deepEqual(calls[1].messages[2], { role: 'toolResult', toolCallId: 'k1', toolName: 'Bash', content: [{ type: 'text', text: 'frames saved' }], isError: false });

  const home = mkdtempSync(join(tmpdir(), 'of-kimi-'));
  const dir = join(home, '.kimi-code', 'sessions', 'wd_film_1', 'session_abc-12345');
  mkdirSync(join(dir, 'agents', 'main'), { recursive: true });
  writeFileSync(join(dir, 'agents', 'main', 'wire.jsonl'), jsonl(rows));
  writeFileSync(join(home, '.kimi-code', 'session_index.jsonl'), jsonl([{ sessionId: 'session_abc-12345', sessionDir: dir, workDir: '/film' }]));
  assert.equal(findKimiRecord({ sessionId: 'session_abc-12345', home }), dir);
  assert.equal(findKimiRecord({ sessionId: 'abc-12345', home }), dir, 'its ACP id without the prefix too');
  assert.equal(agentRecordCalls({ agent: 'kimi', sessionId: 'abc-12345', home, from: t(20), to: t(40) }).calls.length, 1);
});

test("Copilot's events: a request for each usage record, its answer by its API call, the system prompt it keeps; no tools", () => {
  const rows = [
    { type: 'session.start', data: { sessionId: 'cop-12345' }, timestamp: at(0) },
    { type: 'user.message', data: { content: 'Make a title', transformedContent: '<current_datetime>now</current_datetime>\n\nMake a title' }, timestamp: at(1) },
    { type: 'system.message', data: { role: 'system', content: 'You are GitHub Copilot.' }, timestamp: at(1) },
    { type: 'session.usage_record', data: { usage: { model: 'gpt-x', inputTokens: 120, cacheReadTokens: 100, outputTokens: 9, duration: 2000, apiCallId: 'a1', initiator: 'user', requestBodyBytes: 41569 } }, timestamp: at(4) },
    { type: 'assistant.message', data: { content: '', apiCallId: 'a1', toolRequests: [{ toolCallId: 'k1', name: 'bash', arguments: { command: 'openfilm look' } }] }, timestamp: at(4) },
    { type: 'tool.execution_complete', data: { toolCallId: 'k1', success: true, result: { content: 'frames saved' } }, timestamp: at(6) },
    { type: 'session.usage_record', data: { usage: { model: 'gpt-x', inputTokens: 10, outputTokens: 2, duration: 1000, apiCallId: 'a2', initiator: 'agent' } }, timestamp: at(8) },
    { type: 'assistant.message', data: { content: 'Done.', apiCallId: 'a2', toolRequests: [] }, timestamp: at(8) },
  ];
  const calls = copilotCallsOf(rows);
  assert.equal(calls.length, 2);
  const [first, second] = calls;
  assert.equal(first.systemPrompt, 'You are GitHub Copilot.');
  assert.equal(first.tools, null);
  assert.deepEqual(first.lacks, ['copilotRebuilt']);
  assert.deepEqual(first.messages, [{ role: 'user', content: [{ type: 'text', text: '<current_datetime>now</current_datetime>\n\nMake a title' }] }], 'as the model got it');
  assert.deepEqual(first.answer.content, [{ type: 'toolCall', id: 'k1', name: 'bash', arguments: { command: 'openfilm look' } }]);
  assert.deepEqual(first.answer.usage, { input: 20, cacheRead: 100, cacheWrite: 0, output: 9, reasoning: 0 });
  assert.equal(first.startedAt, Date.parse(at(2)));
  assert.equal(first.ms, 2000);
  assert.equal(first.settings.requestBodyBytes, 41569);
  assert.deepEqual(second.messages.slice(1), [
    { role: 'assistant', content: first.answer.content },
    { role: 'toolResult', toolCallId: 'k1', toolName: 'bash', content: [{ type: 'text', text: 'frames saved' }], isError: false },
  ]);
  assert.deepEqual(second.answer.content, [{ type: 'text', text: 'Done.' }]);

  const home = mkdtempSync(join(tmpdir(), 'of-copilot-'));
  mkdirSync(join(home, '.copilot', 'session-state', 'cop-12345'), { recursive: true });
  writeFileSync(join(home, '.copilot', 'session-state', 'cop-12345', 'events.jsonl'), jsonl(rows));
  assert.ok(findCopilotRecord({ sessionId: 'cop-12345', home }));
  assert.equal(findCopilotRecord({ sessionId: '../../x', home }), null);
  assert.equal(agentRecordCalls({ agent: 'copilot', sessionId: 'cop-12345', home, from: Date.parse(at(7)), to: Date.parse(at(9)) }).calls.length, 1);
});

test('compactCalls keeps each request only as far as it is new, and reads back whole', () => {
  const calls = claudeCallsOf(claudeSession());
  const lines = compactCalls(calls);
  assert.equal(lines[0].prefix, 0);
  assert.equal(lines[1].prefix, 2, 'the two messages carried over');
  assert.equal(lines[1].messages.length, 2);
  assert.ok('systemPrompt' in lines[1], 'the system prompt changed (the CLI prefix)');
  /* read back as the chat's lib/model-calls.ts does */
  let messages = [];
  for (const [i, line] of lines.entries()) {
    messages = [...messages.slice(0, line.prefix), ...line.messages];
    assert.deepEqual(messages, calls[i].messages);
  }
});
