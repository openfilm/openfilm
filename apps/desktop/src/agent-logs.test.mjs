import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { agentLogCalls, codebuddyCalls, geminiCallsOf, logSwitches, opencodeCalls, ownLogging, qwenCalls, spanReceiver, splitRecords } from './agent-logs.mjs';
import { agentRecordCalls } from './agent-records.mjs';

const at = (s) => new Date(Date.UTC(2026, 9, 15, 10, 0, s)).toISOString();
const t = (s) => Date.parse(at(s));
const temp = (name) => mkdtempSync(join(tmpdir(), `of-${name}-`));
const jsonl = (rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;

test('each agent is started with its own logging switch into a folder of its process, never over a setting of the person\'s', async () => {
  const base = temp('logs');
  const home = temp('home');
  const gemini = await logSwitches('gemini', { base, home });
  assert.equal(gemini.log.agent, 'gemini');
  assert.ok(gemini.log.dir.startsWith(join(base, 'gemini')) && existsSync(gemini.log.dir));
  assert.deepEqual(gemini.env, { GEMINI_TELEMETRY_ENABLED: 'true', GEMINI_TELEMETRY_TARGET: 'local', GEMINI_TELEMETRY_OUTFILE: join(gemini.log.dir, 'telemetry.log'), GEMINI_TELEMETRY_TRACES_ENABLED: 'true' });
  assert.ok(!('GEMINI_TELEMETRY_LOG_PROMPTS' in gemini.env), 'prompt logging as the person has it (on by Gemini CLI\'s default)');
  const qwen = await logSwitches('qwen', { base, home });
  assert.deepEqual(qwen.args, ['--openai-logging', '--openai-logging-dir', qwen.log.dir], 'its folder given, never the project\'s logs/openai');
  const codebuddy = await logSwitches('codebuddy', { base, home, shell: { DISABLE_TELEMETRY: '1' } });
  assert.deepEqual(codebuddy.env, { OTEL_LOG_RAW_API_BODIES: `file:${codebuddy.log.dir}` });

  assert.deepEqual((await logSwitches('codebuddy', { base, home })).log, { agent: 'codebuddy', none: 'sendsMore' }, 'its traces go to its makers: they would name each file');
  assert.deepEqual((await logSwitches('codebuddy', { base, home, shell: { OTEL_TRACES_EXPORTER: 'none' } })).log.dir ? 'on' : 'off', 'on');
  assert.deepEqual((await logSwitches('gemini', { base, home, shell: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://x' } })).log, { agent: 'gemini', none: 'own' });
  assert.deepEqual((await logSwitches('opencode', { base, home, shell: { OPENCODE_CONFIG_CONTENT: '{}' } })).log, { agent: 'opencode', none: 'own' });
  mkdirSync(join(home, '.gemini'), { recursive: true });
  writeFileSync(join(home, '.gemini', 'settings.json'), '{ "telemetry": { "enabled": true, "target": "gcp" } }');
  assert.equal(ownLogging('gemini', { home }), true, 'their own telemetry settings are left as they are');
  mkdirSync(join(home, '.qwen'), { recursive: true });
  writeFileSync(join(home, '.qwen', 'settings.json'), '{ "model": { "enableOpenAILogging": true } }');
  assert.equal(ownLogging('qwen', { home }), true);
  assert.equal(await logSwitches('cursor', { base, home }), null, 'no switch: Cursor makes its prompt on its servers');
  assert.equal(await logSwitches('qwen', { base: null, home }), null, 'Developer mode off');

  /* a process's folder from long ago goes as another starts */
  const old = join(base, 'qwen', 'old-process');
  mkdirSync(old);
  const long = (Date.now() - 30 * 86_400_000) / 1000;
  utimesSync(old, long, long);
  await logSwitches('qwen', { base, home: temp('home') });
  assert.equal(existsSync(old), false);
  assert.ok(existsSync(qwen.log.dir), 'a recent one stays');
});

test("Qwen Code's log: one request a file, its system message as the system prompt, the session's own and its subagents'", () => {
  const dir = temp('qwen');
  const sid = 'aaaa-1111';
  const file = (name, s, context, request, response) => writeFileSync(join(dir, `openai-${name}.json`), JSON.stringify({ timestamp: at(s), request, response, error: null, context, system: {} }));
  const tools = [{ type: 'function', function: { name: 'run_shell_command', description: 'Run', parameters: { type: 'object' } } }];
  file('1', 2, { sessionId: sid, promptId: `${sid}########1` }, {
    model: 'qwen-x', stream: true, tools,
    messages: [{ role: 'system', content: 'You are Qwen Code.' }, { role: 'user', content: [{ type: 'text', text: '<system-reminder>today</system-reminder>' }, { type: 'text', text: 'Make a title' }] }],
  }, { model: 'qwen-x', choices: [{ message: { role: 'assistant', content: null, reasoning_content: 'plan', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'run_shell_command', arguments: '{"command":"openfilm look"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 120, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 100 } } });
  file('2', 5, { sessionId: sid, promptId: `${sid}########1` }, {
    model: 'qwen-x', tools,
    messages: [{ role: 'system', content: 'You are Qwen Code.' }, { role: 'user', content: 'Make a title' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'run_shell_command', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'frames saved' }],
  }, { choices: [{ message: { role: 'assistant', content: 'Done.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
  file('3', 6, { sessionId: sid, promptId: `${sid}#memory-extractor-1#0` }, { model: 'qwen-x', messages: [{ role: 'system', content: 'Extract.' }, { role: 'user', content: 'x' }] }, { choices: [{ message: { content: 'ok' } }] });
  file('4', 7, { promptId: 'forked_query' }, { model: 'qwen-x', messages: [{ role: 'user', content: 'y' }] }, null);
  file('5', 8, { sessionId: 'another', promptId: 'another########1' }, { model: 'qwen-x', messages: [] }, null);

  const calls = qwenCalls(dir, { sessionId: sid });
  assert.equal(calls.length, 4, 'not another session\'s');
  const [first, second, sub, own] = calls;
  assert.equal(first.systemPrompt, 'You are Qwen Code.');
  assert.deepEqual(first.tools, [{ name: 'run_shell_command', description: 'Run', parameters: { type: 'object' } }]);
  assert.deepEqual(first.messages, [
    { role: 'context', as: 'user', label: 'system-reminder', content: [{ type: 'text', text: '<system-reminder>today</system-reminder>' }] },
    { role: 'user', content: [{ type: 'text', text: 'Make a title' }] },
  ], 'what it put in the person\'s message by itself, apart');
  assert.deepEqual(first.answer.content, [{ type: 'thinking', thinking: 'plan' }, { type: 'toolCall', id: 'c1', name: 'run_shell_command', arguments: { command: 'openfilm look' } }]);
  assert.deepEqual(first.answer.usage, { input: 20, cacheRead: 100, cacheWrite: 0, output: 9, reasoning: 0 });
  assert.equal(first.ms, null, 'how long is not in the log');
  assert.deepEqual(first.settings, { model: 'qwen-x', stream: true });
  assert.deepEqual(second.messages[2], { role: 'toolResult', toolCallId: 'c1', toolName: 'run_shell_command', content: [{ type: 'text', text: 'frames saved' }], isError: false });
  assert.equal(sub.thread.label, 'memory-extractor-1');
  assert.equal(own.thread.label, 'forked_query');
  assert.equal(own.answer, null);
  assert.equal(qwenCalls(dir, { sessionId: sid, from: t(4), to: t(5) }).length, 1, 'only the turn\'s');
});

test("Gemini CLI's telemetry: records split, each request whole from its log record, its span and its response", () => {
  const sid = 'gem-1234';
  const span = (spanId, promptId, extra) => ({ _spanContext: { traceId: 'tr', spanId }, name: 'llm_call', startTime: [1, 0], endTime: [2, 0], attributes: {
    'gen_ai.prompt.name': promptId, 'gen_ai.conversation.id': sid,
    'gen_ai.system_instructions': JSON.stringify('You are Gemini CLI. Never "}" a brace.'),
    'gen_ai.tool.definitions': JSON.stringify([{ functionDeclarations: [{ name: 'run_shell_command', description: 'Run', parametersJsonSchema: { type: 'object' } }] }]),
    ...extra } });
  const log = (name, s, attributes, spanId) => ({ hrTime: [0, 0], ...(spanId ? { spanContext: { traceId: 'tr', spanId } } : {}), attributes: { 'session.id': sid, 'event.name': name, 'event.timestamp': at(s), ...attributes }, _body: name });
  const records = [
    log('gemini_cli.config', 0, { 'session.id': 'the-process' }),
    log('gemini_cli.api_request', 1, { role: 'utility_router', prompt_id: 'classifier-1', model: 'flash', request_text: JSON.stringify([{ role: 'user', parts: [{ text: 'route' }] }]) }, 's0'),
    log('gemini_cli.api_response', 1, { role: 'utility_router', prompt_id: 'classifier-1', model: 'flash', duration_ms: 5, response_text: '[]' }),
    log('gemini_cli.api_request', 2, { role: 'main', prompt_id: 'p1', model: 'pro', auth_type: 'oauth', request_text: JSON.stringify([{ role: 'user', parts: [{ text: '<session_context>\nToday is…</session_context>' }, { text: 'Make a title' }] }]) }, 's1'),
    log('gemini_cli.api_response', 4, { role: 'main', prompt_id: 'p1', model: 'pro', duration_ms: 1800, input_token_count: 120, cached_content_token_count: 100, output_token_count: 9, thoughts_token_count: 4,
      response_text: JSON.stringify([{ candidates: [{ content: { role: 'model', parts: [{ text: 'pl', thought: true }, { text: 'an', thought: true }] } }] },
        { candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'f1', name: 'run_shell_command', args: { command: 'openfilm look' } } }] }, finishReason: 'STOP' }] }]) }),
    log('gemini_cli.api_request', 6, { role: 'main', prompt_id: 'p1', model: 'pro', request_text: JSON.stringify([
      { role: 'user', parts: [{ text: 'Make a title' }] },
      { role: 'model', parts: [{ functionCall: { id: 'f1', name: 'run_shell_command', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: { id: 'f1', name: 'run_shell_command', response: { output: 'frames saved' } } }] }]) }, 's2'),
    log('gemini_cli.api_error', 7, { role: 'main', prompt_id: 'p1', error: 'quota' }),
    log('gemini_cli.api_request', 8, { 'session.id': 'other', role: 'main', prompt_id: 'p9', request_text: '[]' }, 's9'),
    span('s0', 'classifier-1'), span('s1', 'p1'), span('s2', 'p1'),
    { scopeMetrics: [{ metrics: [] }] },
  ];
  /* as Gemini CLI writes them: pretty JSON, one after the other */
  const raw = records.map((r) => JSON.stringify(r, null, 2)).join('\n');
  assert.equal(splitRecords(raw).length, records.length, 'split where each closes, a brace in a string kept');

  const calls = geminiCallsOf(splitRecords(raw), { sessionId: sid });
  assert.equal(calls.length, 3, 'not another session\'s');
  const [router, first, second] = calls;
  assert.equal(router.thread.label, 'utility_router', 'its own call, named');
  assert.equal(first.systemPrompt, 'You are Gemini CLI. Never "}" a brace.');
  assert.deepEqual(first.tools, [{ name: 'run_shell_command', description: 'Run', parameters: { type: 'object' } }]);
  assert.deepEqual(first.messages, [
    { role: 'context', as: 'user', label: 'session_context', content: [{ type: 'text', text: '<session_context>\nToday is…</session_context>' }] },
    { role: 'user', content: [{ type: 'text', text: 'Make a title' }] },
  ]);
  assert.deepEqual(first.answer.content, [{ type: 'thinking', thinking: 'plan' }, { type: 'toolCall', id: 'f1', name: 'run_shell_command', arguments: { command: 'openfilm look' } }], 'a stream\'s chunks joined');
  assert.deepEqual(first.answer.usage, { input: 20, cacheRead: 100, cacheWrite: 0, output: 13, reasoning: 4 });
  assert.equal(first.answer.stopReason, 'STOP');
  assert.equal(first.ms, 1800);
  assert.equal(first.startedAt, t(2));
  assert.deepEqual(first.settings, { model: 'pro', auth: 'oauth' });
  assert.deepEqual(second.messages[2], { role: 'toolResult', toolCallId: 'f1', toolName: 'run_shell_command', content: [{ type: 'text', text: 'frames saved' }], isError: false });
  assert.equal(second.answer.stopReason, 'error');
  assert.equal(second.answer.errorMessage, 'quota');
  assert.equal(geminiCallsOf(splitRecords(raw), { sessionId: sid, from: t(5), to: t(9) }).length, 1);
});

test("CodeBuddy's raw bodies: its index names each request's files and session; its helpers' named", () => {
  const dir = temp('codebuddy');
  const root = 'root-1234';
  const pair = (id, request, response) => {
    writeFileSync(join(dir, `${id}.request.json`), JSON.stringify(request));
    writeFileSync(join(dir, `${id}.response.json`), JSON.stringify(response));
  };
  pair('m1', { model: 'cb', messages: [{ role: 'system', content: 'Title it.' }, { role: 'user', content: 'hi' }] },
    { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Greeting' }] }], usage: { inputTokens: 5, outputTokens: 1 }, started_at: t(1), completed_at: t(1) + 30 });
  pair('m2', { model: 'cb', max_tokens: 100, tools: [{ type: 'function', function: { name: 'Read', description: 'Read a file', parameters: { type: 'object' } } }],
    messages: [{ role: 'system', content: 'You are CodeBuddy Code.' }, { role: 'user', content: [{ type: 'text', text: '<system-reminder data-role="memory">notes</system-reminder>' }, { type: 'text', text: 'hi' }], conversationRequestId: 'r1' }] },
  { output: [{ type: 'function_call', name: 'Read', arguments: '{"file_path":"film.html"}', callId: 'k1' }], usage: { inputTokens: 50, outputTokens: 7, inputTokensDetails: { cached_tokens: 40 } }, model: 'cb', started_at: t(2), completed_at: t(2) + 600 });
  writeFileSync(join(dir, 'index.jsonl'), jsonl([
    { timestamp: at(1), session_id: 'title-1', root_session_id: root, model: 'cb', message_id: 'm1', request_file: 'm1.request.json', response_file: 'm1.response.json' },
    { timestamp: at(2), session_id: root, root_session_id: root, query_source: 'conversation', model: 'cb', message_id: 'm2', request_file: 'm2.request.json', response_file: 'm2.response.json' },
    { timestamp: at(3), session_id: 'x', root_session_id: 'another', request_file: '../../etc/passwd', response_file: 'm2.response.json' },
  ]));
  const calls = codebuddyCalls(dir, { sessionId: root });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].thread.id, 'title-1', 'a call it made for itself');
  assert.equal(calls[1].thread, undefined);
  assert.equal(calls[1].systemPrompt, 'You are CodeBuddy Code.');
  assert.deepEqual(calls[1].messages.map((m) => [m.role, m.label ?? null]), [['context', 'system-reminder'], ['user', null]]);
  assert.deepEqual(calls[1].tools, [{ name: 'Read', description: 'Read a file', parameters: { type: 'object' } }]);
  assert.deepEqual(calls[1].answer.content, [{ type: 'toolCall', id: 'k1', name: 'Read', arguments: { file_path: 'film.html' } }]);
  assert.deepEqual(calls[1].answer.usage, { input: 10, cacheRead: 40, cacheWrite: 0, output: 7, reasoning: 0 });
  assert.equal(calls[1].ms, 600);
  assert.deepEqual(calls[1].settings, { model: 'cb', max_tokens: 100 });
});

/** OTLP's JSON export of spans, as OpenCode's exporter sends it */
const exportOf = (spans) => JSON.stringify({ resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ scope: { name: 'opencode' }, spans }] }] });
const otlpSpan = (name, s, attrs) => ({
  traceId: 't', spanId: name, name, kind: 1, startTimeUnixNano: String(BigInt(t(s)) * 1_000_000n), endTimeUnixNano: String(BigInt(t(s) + 2500) * 1_000_000n),
  attributes: Object.entries(attrs).map(([key, v]) => ({ key, value: Array.isArray(v) ? { arrayValue: { values: v.map((x) => ({ stringValue: x })) } } : typeof v === 'number' ? { intValue: v } : { stringValue: v } })),
});
const post = (url, body, headers) => new Promise((resolve, reject) => {
  const req = request(`${url}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', reject);
  req.end(body);
});

test("OpenCode's telemetry: the app's receiver on 127.0.0.1 keeps only its model requests, each read whole", async () => {
  const dir = temp('opencode');
  const file = join(dir, 'spans.jsonl');
  const receiver = await spanReceiver(file);
  try {
    assert.match(receiver.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const prompt = [
      { role: 'system', content: 'You are opencode.' },
      { role: 'system', content: 'Here is some useful information.' },
      { role: 'user', content: [{ type: 'text', text: 'Make a title' }] },
      { role: 'assistant', content: [{ type: 'reasoning', text: 'look' }, { type: 'tool-call', toolCallId: 'o1', toolName: 'bash', input: { command: 'openfilm look' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'o1', toolName: 'bash', output: { type: 'text', value: 'frames saved' } }] },
    ];
    assert.equal(await post(receiver.url, exportOf([
      otlpSpan('sql.execute', 1, { 'db.statement': 'select' }),
      otlpSpan('ai.streamText.doStream', 2, {
        'session.id': 'ses_1', 'ai.model.id': 'm1', 'ai.model.provider': 'fake.chat', 'ai.prompt.messages': JSON.stringify(prompt),
        'ai.prompt.tools': [JSON.stringify({ type: 'function', name: 'bash', description: 'Run', inputSchema: { type: 'object' } })],
        'ai.prompt.toolChoice': '{"type":"auto"}', 'ai.response.text': 'Done.', 'ai.response.finishReason': 'stop',
        'ai.usage.inputTokens': 120, 'ai.usage.inputTokenDetails.noCacheTokens': 20, 'ai.usage.inputTokenDetails.cacheReadTokens': 100, 'ai.usage.outputTokens': 3,
      }),
    ])), 200);
    assert.equal(await post(receiver.url, gzipSync(exportOf([otlpSpan('ai.streamText.doStream', 5, { 'session.id': 'ses_child', 'ai.prompt.messages': '[]', 'ai.response.toolCalls': JSON.stringify([{ toolCallId: 'o2', toolName: 'read', input: '{"path":"film.html"}' }]) })])), { 'content-encoding': 'gzip' }), 200);
    assert.equal(await post(receiver.url, 'not json'), 200, 'anything else answered, nothing kept');

    const calls = opencodeCalls(file, { sessionId: 'ses_1' });
    assert.equal(calls.length, 2, 'only the model requests\' spans');
    const [call, child] = calls;
    assert.equal(call.systemPrompt, 'You are opencode.\n\nHere is some useful information.');
    assert.deepEqual(call.messages, [
      { role: 'user', content: [{ type: 'text', text: 'Make a title' }] },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'look' }, { type: 'toolCall', id: 'o1', name: 'bash', arguments: { command: 'openfilm look' } }] },
      { role: 'toolResult', toolCallId: 'o1', toolName: 'bash', content: [{ type: 'text', text: 'frames saved' }], isError: false },
    ]);
    assert.deepEqual(call.tools, [{ name: 'bash', description: 'Run', parameters: { type: 'object' } }]);
    assert.deepEqual(call.answer.content, [{ type: 'text', text: 'Done.' }]);
    assert.deepEqual(call.answer.usage, { input: 20, cacheRead: 100, cacheWrite: 0, output: 3, reasoning: 0 });
    assert.equal(call.startedAt, t(2));
    assert.equal(call.ms, 2500);
    assert.deepEqual(call.settings, { toolChoice: { type: 'auto' } });
    assert.deepEqual(call.lacks, ['opencodeBeforeProvider']);
    assert.equal(child.thread.id, 'ses_child', 'a subagent\'s session, named');
    assert.deepEqual(child.answer.content, [{ type: 'toolCall', id: 'o2', name: 'read', arguments: { path: 'film.html' } }]);
  } finally {
    receiver.close();
  }
});

test('a turn reads its requests from the log its agent was started with, named by it', async () => {
  const base = temp('logs');
  const switches = await logSwitches('qwen', { base, home: temp('home') });
  writeFileSync(join(switches.log.dir, 'openai-1.json'), JSON.stringify({ timestamp: at(2), request: { messages: [{ role: 'user', content: 'hi' }] }, response: null, context: { sessionId: 's-12345678' } }));
  const read = agentRecordCalls({ agent: 'qwen', sessionId: 's-12345678', log: switches.log, from: t(1), to: t(3) });
  assert.equal(read.calls.length, 1);
  assert.deepEqual(read.calls[0].source, { agent: 'qwen', file: switches.log.dir });
  assert.equal(agentLogCalls({ agent: 'qwen', sessionId: 's-12345678', log: { agent: 'gemini', dir: switches.log.dir } }), null, 'another agent\'s log is not read');
  assert.equal(agentRecordCalls({ agent: 'qwen', sessionId: 's-12345678', log: { agent: 'qwen', none: 'own' } }), null);
  assert.deepEqual(readdirSync(join(base, 'qwen')).length, 1);
});
