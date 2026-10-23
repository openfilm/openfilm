import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentSession, CLIENT_CAPABILITIES, agentDefaults, closeEverySession, planProblem, probeFolder, CODEX_UTF8_CMD, agentShell, allowOption, codexDeveloperInstructions, codexLaunchEnv, distinctOptions, errorCause, legacyOptions, powerShellScript, powerShellLine, powerShellWindowLaunch, terminalScript, checkAgentProgram, readAgentStatus, setChosenPaths, signInScript, turnError, signInError, codexTooOld, AGENTS, ownSignIn, codexServiceError, codexRefusal, codexNotice, explainFailure, stderrReason, withToolKind } from './agents.mjs';

test('an agent that asks: yes for good where it offers that, else yes this once; nothing to say yes with is null', () => {
  const options = [
    { optionId: 'no', kind: 'reject_once' },
    { optionId: 'once', kind: 'allow_once' },
    { optionId: 'always', kind: 'allow_always' },
  ];
  assert.equal(allowOption({ options }), 'always');
  assert.equal(allowOption({ options: options.slice(0, 2) }), 'once');
  assert.equal(allowOption({ options: options.slice(0, 1) }), null);
  assert.equal(allowOption({}), null);
});

test("the protocol's older model and mode lists read as the config options the chat's menu has", () => {
  const options = legacyOptions({
    models: { currentModelId: 'auto', availableModels: [{ modelId: 'auto', name: 'Auto' }, { modelId: 'pro', name: 'Pro', description: 'slow' }] },
    modes: { currentModeId: 'yolo', availableModes: [{ id: 'default', name: 'Default' }, { id: 'yolo', name: 'YOLO' }] },
  });
  assert.deepEqual(options.map((o) => [o.id, o.category, o.currentValue]), [['model', 'model', 'auto'], ['mode', 'mode', 'yolo']]);
  assert.deepEqual(options[0].options[1], { value: 'pro', name: 'Pro', description: 'slow' });
  assert.deepEqual(legacyOptions({}), []);
});

test('a choice an agent lists twice shows once in the menu', () => {
  /* GitHub Copilot 1.0.98 lists its model "auto" twice */
  const [model, mode] = distinctOptions([
    { id: 'model', currentValue: 'auto', options: [{ value: 'auto', name: 'Auto' }, { value: 'auto', name: 'Auto', description: 'Auto' }, { value: 'gpt', name: 'GPT' }] },
    { id: 'mode', currentValue: 'agent', options: [{ value: 'agent', name: 'Agent' }, { value: 'plan', name: 'Plan' }] },
  ]);
  assert.deepEqual(model.options, [{ value: 'auto', name: 'Auto' }, { value: 'gpt', name: 'GPT' }]);
  assert.deepEqual(mode.options.map((o) => o.value), ['agent', 'plan']);
  assert.equal(distinctOptions(null), null);
});

test("choices an agent lists in groups show one after another, each with its group's name", () => {
  /* DeepSeek Harness 0.2.0 groups its models by where they run */
  const [model, effort] = distinctOptions([
    { id: 'model', currentValue: '["deepseek-official","deepseek-v4-flash"]', options: [
      { group: 'deepseek-official', name: 'DeepSeek', options: [{ value: '["deepseek-official","deepseek-v4-flash"]', name: 'deepseek-v4-flash' }] },
      { group: 'deepseek-account', name: 'DeepSeek Account', options: [{ value: '["deepseek-account","deepseek-flash"]', name: 'DeepSeek-V41-Flash', description: 'Fast' }] },
    ] },
    { id: 'reasoning_effort', currentValue: 'high', options: [{ value: 'high', name: 'High' }] },
  ]);
  assert.deepEqual(model.options, [
    { value: '["deepseek-official","deepseek-v4-flash"]', name: 'DeepSeek · deepseek-v4-flash' },
    { value: '["deepseek-account","deepseek-flash"]', name: 'DeepSeek Account · DeepSeek-V41-Flash', description: 'Fast' },
  ]);
  assert.deepEqual(effort.options, [{ value: 'high', name: 'High' }]);
});

test('whose sign-in it is, as each program says it, never a key', () => {
  const claude = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'a@b.test', orgName: 'Studio', subscriptionType: 'max' });
  assert.deepEqual(readAgentStatus('claude', claude, claude), { signedIn: true, account: { method: 'claude.ai', email: 'a@b.test', org: 'Studio', plan: 'max' } });
  const out = JSON.stringify({ loggedIn: false, authMethod: 'none' });
  assert.deepEqual(readAgentStatus('claude', out, out), { signedIn: false, account: null });
  assert.deepEqual(readAgentStatus('codex', 'Logged in using ChatGPT\n', 'Logged in using ChatGPT\n'), { signedIn: true, account: { method: 'chatgpt' } });
  const key = 'Logged in using an API key - sk-proj-***ABCD\n';
  const read = readAgentStatus('codex', key, key);
  assert.deepEqual(read, { signedIn: true, account: { method: 'api-key' } });
  assert.ok(!JSON.stringify(read).includes('sk-'), 'no part of a key');
  assert.deepEqual(readAgentStatus('codex', 'Not logged in\n', 'Not logged in\n'), { signedIn: false, account: null });
});

test('settings Codex cannot read: it cannot say whether it is signed in, and says why', () => {
  const out = '\nError loading configuration: ~/.codex/config.toml:2:16: unknown variant `full`, expected one of `read-only`, `workspace-write`, `danger-full-access`\n';
  assert.deepEqual(readAgentStatus('codex', '', out), {
    signedIn: null, account: null,
    problem: 'Error loading configuration: ~/.codex/config.toml:2:16: unknown variant `full`, expected one of `read-only`, `workspace-write`, `danger-full-access`',
  });
});

test('an error the agent sends as "Internal error" carries its reason; a sign-in refused is said so', () => {
  const why = 'failed to load configuration: config.toml:1:26: unknown variant `ultra`';
  const e = signInError('Codex', Object.assign(new Error('Internal error'), { code: -32603, data: `${why}\n` }));
  assert.equal(e.message, why);
  assert.equal(e.code, -32603);
  assert.equal(signInError('Codex', Object.assign(new Error('Internal error'), { code: -32603, data: { message: why } })).message, why);
  assert.equal(signInError('Codex', Object.assign(new Error('Internal error'), { code: -32603, data: { details: 'connection got disposed' } })).message, 'connection got disposed');
  const plain = new Error('Codex process has exited with code 1');
  assert.equal(signInError('Codex', plain), plain);
  assert.equal(signInError('Codex', Object.assign(new Error('Authentication required'), { code: -32000 })).code, 'sign-in');
  const own = signInError('Codex', Object.assign(new Error('Authentication required'), { code: -32000 }), { own: true });
  assert.equal(own.code, 'sign-in');
  assert.equal(own.message, 'Codex is not signed in. Sign in in Codex, then try again.');
});

test('Codex is signed in in Codex: one found is never signed out here, and keeps whose account it is', () => {
  assert.equal(AGENTS.codex.login, null);
  assert.deepEqual(ownSignIn(AGENTS.codex, { signedIn: false, account: null }), { signedIn: null, account: null });
  const account = { method: 'chatgpt' };
  assert.deepEqual(ownSignIn(AGENTS.codex, { signedIn: true, account }), { signedIn: true, account });
  assert.deepEqual(ownSignIn(AGENTS.claude, { signedIn: false, account: null }), { signedIn: false, account: null });
});

test("the model service's refusal Codex sends as its reply fails the turn; a model this Codex is too old for says to update it", () => {
  const chunk = (text) => ({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
  const said = `{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account."}}\n\n`;
  const refused = codexServiceError(chunk(said));
  assert.deepEqual(refused, { message: "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.", status: 400 });
  assert.equal(codexServiceError(chunk('Hi!')), null);
  assert.equal(codexServiceError(chunk('{"type":"error"')), null, 'not JSON');
  assert.equal(codexServiceError(chunk('{"type":"error","error":{}}')), null, 'no message');
  assert.equal(codexServiceError({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: said } }), null);

  const old = codexRefusal(refused, '/usr/local/bin/codex', () => '0.156.1');
  assert.equal(old.code, 'outdated');
  assert.equal(old.message, "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account. Update Codex (this one is 0.156.1), or choose another model.");
  assert.match(codexRefusal(refused, '/usr/local/bin/codex', () => null).message, / Update Codex, or choose another model\.$/);
  const other = codexRefusal({ message: 'Rate limit reached.', status: 429 }, '/usr/local/bin/codex', () => '0.163.0');
  assert.equal(other.message, 'Rate limit reached.');
  assert.equal(other.code, undefined);
});

test('a turn the agent ends with just "Internal error" says the reason in its data; the error as sent stays its cause', () => {
  /* the ACP SDK's own shape for a thrown Error: its text as data.details */
  const sent = Object.assign(new Error('Internal error'), { code: -32603, data: { details: 'Request timed out.' } });
  const e = errorCause(sent);
  assert.equal(e.message, 'Request timed out.');
  assert.equal(e.cause, sent);
  assert.equal(errorCause(Object.assign(new Error('Internal error'), { code: -32603, data: 'model not found' })).message, 'model not found');
  /* an error that says its reason itself, or has none in data, as it came */
  const said = Object.assign(new Error('The model service did not answer.'), { code: -32603, data: { details: 'Request timed out.' } });
  assert.equal(errorCause(said), said);
  const bare = Object.assign(new Error('Internal error'), { code: -32603, data: { errorKind: 'transport_lost' } });
  assert.equal(errorCause(bare), bare);
  const other = Object.assign(new Error('Invalid params'), { code: -32602, data: { message: 'x' } });
  assert.equal(errorCause(other), other);
});

test("the person's own developer_instructions in Codex's config, read as TOML writes them; a profile's is not theirs at the top", () => {
  assert.equal(codexDeveloperInstructions('model = "gpt"\ndeveloper_instructions = "Be brief.\\nSay \\"why\\"."\n'), 'Be brief.\nSay "why".');
  assert.equal(codexDeveloperInstructions("developer_instructions = 'C:\\no\\escapes'"), 'C:\\no\\escapes');
  assert.equal(codexDeveloperInstructions('developer_instructions = """\nLine one.\nLine two.\n"""\n[profiles.x]\n'), 'Line one.\nLine two.');
  assert.equal(codexDeveloperInstructions("developer_instructions = '''\nAs is: \\n\n'''"), 'As is: \\n');
  assert.equal(codexDeveloperInstructions('[profiles.work]\ndeveloper_instructions = "not at the top"\n'), null);
  assert.equal(codexDeveloperInstructions('model = "gpt"\n'), null);
  assert.equal(codexDeveloperInstructions(''), null);
});

test('the chat says it shows notices, so an agent sends its warnings as notices and not as words in its reply', async () => {
  /* the SDK's own parser, which drops a malformed capability without a word */
  const { zClientCapabilities } = await import(new URL('../node_modules/@agentclientprotocol/sdk/dist/schema/zod.gen.js', import.meta.url).href);
  const parsed = zClientCapabilities.parse(CLIENT_CAPABILITIES);
  /* the check Codex's adapter makes (codex-acp: clientSupportsNotices) */
  const notices = parsed.session?.notices;
  assert.ok(typeof notices === 'object' && notices !== null && !Array.isArray(notices));
  assert.deepEqual(parsed.elicitation, { form: {} });
});

test('Claude Code is given of the shell only its PATH and the like: a key or gateway there never stands in for the subscription', () => {
  const shell = { PATH: '/bin', HTTPS_PROXY: 'http://proxy', CLAUDE_CONFIG_DIR: '/c', LANG: 'zh_CN.UTF-8',
    ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', ANTHROPIC_BASE_URL: 'http://relay', OPENAI_API_KEY: 'o' };
  const given = agentShell('claude', shell);
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'OPENAI_API_KEY']) assert.equal(given[key], undefined, key);
  assert.equal(given.HTTPS_PROXY, 'http://proxy');
  assert.equal(given.CLAUDE_CONFIG_DIR, '/c', 'where its own sign-in is kept');
  assert.equal(given.LANG, 'zh_CN.UTF-8');
  assert.equal(agentShell('codex', shell), shell, 'the others have the shell as it is');
});

test('the chat says it signs in in Terminal, so Claude Code offers its subscription sign-in (ACP terminal auth)', async () => {
  const { zClientCapabilities } = await import(new URL('../node_modules/@agentclientprotocol/sdk/dist/schema/zod.gen.js', import.meta.url).href);
  /* the check Claude Code's adapter makes before it offers its terminal sign-ins */
  assert.equal(zClientCapabilities.parse(CLIENT_CAPABILITIES).auth?.terminal, true);
});

test("a sign-in in Terminal runs in a folder of the app's own, not the home folder a program warns about", () => {
  const script = signInScript('/opt/homebrew/bin/codebuddy', [], { cwd: "/tmp/it's here" });
  assert.match(script, /do script "cd '\/tmp\/it'\\\\''s here' && '\/opt\/homebrew\/bin\/codebuddy'"/);
  assert.match(signInScript('/bin/copilot', ['login']), /do script "'\/bin\/copilot' 'login'"/);
});

test('a Windows sign-in is a PowerShell script: each path whole however it is spelled, read as UTF-8', () => {
  const script = powerShellScript('Claude Code sign-in', 'C:\\Program Files\\OpenFilm\\OpenFilm.exe',
    ['C:\\Program Files\\OpenFilm\\app.asar\\src\\as-node.mjs', 'D:\\用户\\it\'s\\index.js', '--cli', 'auth', 'login', '--claudeai']);
  assert.ok(script.startsWith('\ufeff'), 'a BOM: Windows PowerShell reads it as UTF-8');
  const lines = script.slice(1).split('\r\n');
  assert.equal(lines[0], "$Host.UI.RawUI.WindowTitle = 'Claude Code sign-in'");
  assert.equal(lines[1], "& 'C:\\Program Files\\OpenFilm\\OpenFilm.exe' 'C:\\Program Files\\OpenFilm\\app.asar\\src\\as-node.mjs' "
    + "'D:\\用户\\it''s\\index.js' '--cli' 'auth' 'login' '--claudeai'");
});

test('on Windows, Codex is started through a script that turns the console to UTF-8, so a reason comes out readable', async () => {
  const { mkdtempSync, readFileSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const exe = 'C:\\Users\\李\\AppData\\Roaming\\npm\\codex.exe';
  assert.deepEqual(codexLaunchEnv('/usr/local/bin/codex', { win: false }), { CODEX_PATH: '/usr/local/bin/codex' });
  const dir = join(mkdtempSync(join(tmpdir(), 'of-codex-')), 'launch');
  const env = codexLaunchEnv(exe, { win: true, dir });
  assert.deepEqual(env, { CODEX_PATH: join(dir, 'codex-utf8.cmd'), OPENFILM_CODEX: exe });
  assert.equal(readFileSync(env.CODEX_PATH, 'utf8'), CODEX_UTF8_CMD);
  assert.match(CODEX_UTF8_CMD, /^@echo off\r\nchcp 65001 >nul\r\n"%OPENFILM_CODEX%" %\*\r\n$/, 'UTF-8 first, then Codex with what the adapter asks (app-server, login)');
  /* a script changed since: written again */
  writeFileSync(env.CODEX_PATH, 'echo old');
  codexLaunchEnv(exe, { win: true, dir });
  assert.equal(readFileSync(env.CODEX_PATH, 'utf8'), CODEX_UTF8_CMD);
  /* nowhere to write it: Codex as before */
  const blocked = join(mkdtempSync(join(tmpdir(), 'of-codex-')), 'file');
  writeFileSync(blocked, '');
  assert.deepEqual(codexLaunchEnv(exe, { win: true, dir: join(blocked, 'launch') }), { CODEX_PATH: exe });
});

test('a signed-out Cursor is said to need its sign-in at once, without the session that would open its sign-in page', async () => {
  const { mkdirSync, mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'of-cursor-'));
  /* says it is signed out, and never answers over ACP (Cursor waits on its sign-in page there); in Cursor's own folder */
  mkdirSync(join(dir, 'cursor-agent'));
  const program = join(dir, 'cursor-agent', 'cursor-agent.mjs');
  writeFileSync(program, "if (process.argv.includes('status')) console.log('Not logged in'); else setInterval(() => {}, 1000);\n");
  setChosenPaths({ cursor: program });
  const session = new AgentSession({ agent: 'cursor', cwd: dir });
  try {
    const failed = await Promise.race([
      session.start().then(() => null, (e) => e),
      new Promise((done) => setTimeout(() => done(new Error('still waiting')), 15_000).unref()),
    ]);
    assert.equal(failed?.code, 'sign-in', failed?.message);
  } finally {
    session.close();
    setChosenPaths({});
  }
});

test("a turn an agent gave up on is said in the agent's own words, not left as an empty reply", () => {
  /* CodeBuddy 2.168, its site out of reach: stopReason "refusal", the reason beside it */
  const message = 'Network error: 502 安全连接建立失败 (target: https://www.codebuddy.ai)';
  assert.equal(turnError({ stopReason: 'refusal', _meta: { 'codebuddy.ai/requestId': 'r1', 'codebuddy.ai/errorMessage': JSON.stringify({ code: -32001, message }) } }), message);
  assert.equal(turnError({ stopReason: 'refusal', _meta: { errorMessage: 'Rate limited' } }), 'Rate limited');
  assert.equal(turnError({ stopReason: 'refusal' }), null);
  assert.equal(turnError({ stopReason: 'refusal', _meta: { 'codebuddy.ai/requestId': 'r1' } }), null);
});

test("CodeBuddy is started as its China edition, unless the person's shell says which edition themselves", () => {
  assert.deepEqual(agentDefaults('codebuddy', { PATH: '/bin' }), { CODEBUDDY_INTERNET_ENVIRONMENT: 'internal' });
  assert.deepEqual(agentDefaults('codebuddy', { CODEBUDDY_INTERNET_ENVIRONMENT: 'ioa' }), {});
  assert.deepEqual(agentDefaults('cursor', {}), {});
});

test('a refusal about the plan is the agent\'s own words; one about the sign-in is a sign-in', () => {
  /* Kimi 2.2 on an account without Kimi Code */
  assert.equal(planProblem('Authentication required: 403 Your current subscription does not have access to Kimi Code right now. Upgrade your plan to keep coding with Kimi Code: https://www.kimi.com/code/#pricing'),
    '403 Your current subscription does not have access to Kimi Code right now. Upgrade your plan to keep coding with Kimi Code: https://www.kimi.com/code/#pricing');
  assert.equal(planProblem('Authentication required: Use Qwen Code CLI to authenticate first.'), null);
  assert.equal(planProblem('Authentication required'), null);
  /* one signed in in its own program is told the same about its plan */
  const plan = signInError('Codex', Object.assign(new Error('Authentication required: 403 Your plan does not include this model.'), { code: -32000 }), { own: true });
  assert.equal(plan.code, 'agent-error');
  assert.equal(plan.message, 'Codex: 403 Your plan does not include this model.');
});

test('a turn that ends with nothing said is said so; a refusal for the plan does not sign the agent out', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'of-kimi-'));
  /* a Kimi that answers its first message with nothing and its second with Kimi 2.2's refusal for the plan */
  const program = join(dir, 'kimi.mjs');
  writeFileSync(program, `let turns = 0;
let buf = '';
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } });
    else if (m.method === 'session/new') send({ jsonrpc: '2.0', id: m.id, result: { sessionId: 's1' } });
    else if (m.method === 'session/prompt') send(++turns === 1 ? { jsonrpc: '2.0', id: m.id, result: { stopReason: 'end_turn' } }
      : { jsonrpc: '2.0', id: m.id, error: { code: -32000, message: 'Authentication required: 403 Your current subscription does not have access to Kimi Code right now.' } });
  }
});
`);
  setChosenPaths({ kimi: program });
  const session = new AgentSession({ agent: 'kimi', cwd: dir });
  try {
    await session.start();
    const empty = await session.prompt([{ type: 'text', text: 'hi' }]).then(() => null, (e) => e);
    assert.equal(empty?.code, 'empty-turn');
    const plan = await session.prompt([{ type: 'text', text: 'hi' }]).then(() => null, (e) => e);
    assert.equal(plan?.code, 'agent-error');
    assert.match(plan.message, /^Kimi: 403 Your current subscription/);
  } finally {
    session.close();
    setChosenPaths({});
  }
});

/** A fake agent over ACP (newline-delimited JSON-RPC), as a script: `onPrompt(m, send)` answers each message. */
async function fakeAcpAgent(name, onPrompt) {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'of-fake-'));
  const program = join(dir, `${name}.mjs`);
  writeFileSync(program, `let buf = '';
let asked = null;
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } });
    else if (m.method === 'session/new') send({ jsonrpc: '2.0', id: m.id, result: { sessionId: 's1' } });
    else (${onPrompt})(m, send);
  }
});
setInterval(() => {}, 1000);
`);
  return { dir, program };
}

test('a turn whose agent waits on its model with nothing coming is stopped, and says why', async () => {
  /* CodeBuddy with its connection hung: model_requesting, then nothing until it is cancelled */
  const { dir, program } = await fakeAcpAgent('codebuddy', (m, send) => {
    if (m.method === 'session/prompt') {
      globalThis.asked = m.id;
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'session_info_update', _meta: { 'codebuddy.ai/agentPhase': { phase: 'model_requesting' } } } } });
    } else if (m.method === 'session/cancel') {
      send({ jsonrpc: '2.0', id: globalThis.asked, result: { stopReason: 'cancelled' } });
    }
  });
  setChosenPaths({ codebuddy: program });
  const session = new AgentSession({ agent: 'codebuddy', cwd: dir, stallMs: 200 });
  try {
    await session.start();
    const failed = await session.prompt([{ type: 'text', text: 'hi' }]).then(() => null, (e) => e);
    assert.equal(failed?.code, 'agent-stalled');
    assert.match(failed.message, /^CodeBuddy heard nothing back from its model/);
  } finally {
    session.close();
    setChosenPaths({});
  }
});

test('DeepSeek Harness: each step reaches the chat as it happens, with the kind its tool is, not as one "Working"', async () => {
  /* dsh's ACP profile, as 0.0.1 sends a turn: its words as each message is done, every tool as kind `other` titled
     by its name, and the turn's answer a while after */
  const { dir, program } = await fakeAcpAgent('dsh', (m, send) => {
    if (m.method !== 'session/prompt') return;
    const update = (u) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's1', update: u } });
    update({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'Reading the manual first.' } });
    const tools = [['bash', { command: 'openfilm' }], ['read', { file_path: 'film.html' }], ['write', { file_path: 'a.html', content: '' }],
      ['grep', { pattern: 'fill' }], ['web_search', { query: 'Alibaba 1999' }], ['todo_write', { todos: [] }]];
    tools.forEach(([title, rawInput], i) => {
      update({ sessionUpdate: 'tool_call', toolCallId: `c${i}`, title, kind: 'other', status: 'in_progress', rawInput });
      update({ sessionUpdate: 'tool_call_update', toolCallId: `c${i}`, status: 'completed', content: [] });
    });
    setTimeout(() => send({ jsonrpc: '2.0', id: m.id, result: { stopReason: 'end_turn' } }), 300);
  });
  setChosenPaths({ deepseek: program });
  let ended = false;
  const heard = [];
  const session = new AgentSession({ agent: 'deepseek', cwd: dir, onUpdate: (u) => heard.push({ ...u, ended }) });
  try {
    await session.start();
    await session.prompt([{ type: 'text', text: 'Make a video about Alibaba' }]);
    ended = true;
    assert.ok(heard.length > 0 && heard.every((u) => !u.ended), 'all heard while the turn ran');
    assert.equal(heard[0].content.text, 'Reading the manual first.');
    const kinds = heard.filter((u) => u.sessionUpdate === 'tool_call').map((u) => [u.title, u.kind]);
    assert.deepEqual(kinds, [['bash', 'execute'], ['read', 'read'], ['write', 'edit'], ['grep', 'search'], ['web_search', 'fetch'], ['todo_write', 'other']]);
    assert.deepEqual(heard.find((u) => u.toolCallId === 'c0' && u.sessionUpdate === 'tool_call').rawInput, { command: 'openfilm' }, 'otherwise as it came');
  } finally {
    session.close();
    setChosenPaths({});
  }
});

test('a tool call keeps its kind unless the agent names its tools (toolKinds) and said `other`', () => {
  const kinds = AGENTS.deepseek.toolKinds;
  const call = { sessionUpdate: 'tool_call', toolCallId: 'c', title: 'bash', kind: 'other' };
  assert.equal(withToolKind(call, kinds).kind, 'execute');
  assert.equal(withToolKind({ ...call, kind: undefined }, kinds).kind, 'execute');
  assert.equal(withToolKind({ ...call, kind: 'read' }, kinds).kind, 'read', 'a kind it gave is its own');
  assert.equal(withToolKind(call, undefined), call, 'other agents: untouched');
  assert.equal(withToolKind({ ...call, title: 'constructor' }, kinds).kind, 'other');
  const update = { sessionUpdate: 'tool_call_update', toolCallId: 'c', title: 'bash', status: 'completed' };
  assert.equal(withToolKind(update, kinds), update);
});

test('quitting closes every agent process, one opened only to ask included; asking runs in one empty folder of the app', async () => {
  assert.equal(probeFolder(), probeFolder());
  const { dir, program } = await fakeAcpAgent('opencode', () => {});
  setChosenPaths({ opencode: program });
  const session = new AgentSession({ agent: 'opencode', cwd: dir });
  try {
    await session.start();
    const gone = new Promise((done) => session.child.once('exit', done));
    closeEverySession();
    await gone;
    assert.notEqual(session.child.exitCode ?? session.child.signalCode, null);
  } finally {
    session.close();
    setChosenPaths({});
  }
});

test('a Codex older than the ones tried, that did not start, is said to need an update; a later one, or a sign-in, as it was', () => {
  const failed = new Error('Pending response rejected since connection got disposed');
  const old = codexTooOld('codex', '/usr/local/bin/codex', failed, () => '0.104.0');
  assert.equal(old.code, 'outdated');
  assert.match(old.message, /^Codex 0\.104\.0 is older than OpenFilm needs \(0\.132\.0 or later\): update Codex, then try again\. Pending response/);
  assert.equal(codexTooOld('codex', '/usr/local/bin/codex', failed, () => '0.163.0'), failed);
  assert.equal(codexTooOld('codex', '/usr/local/bin/codex', failed, () => null), failed, 'a version it cannot tell');
  const signIn = Object.assign(new Error('Codex is not signed in.'), { code: 'sign-in' });
  assert.equal(codexTooOld('codex', '/usr/local/bin/codex', signIn, () => '0.104.0'), signIn);
  assert.equal(codexTooOld('claude', '/usr/local/bin/claude', failed, () => '0.104.0'), failed);
});

test("Codex's reconnects and retries, which it says where the chat does not look, are notices in its words", () => {
  const info = (error) => ({ sessionUpdate: 'session_info_update', _meta: { codex: { error } } });
  assert.deepEqual(codexNotice(info({ message: 'Reconnecting... 2/5', additionalDetails: 'stream disconnected before completion: Connection refused (os error 61)', willRetry: true })), {
    sessionUpdate: 'notice', severity: 'warning', title: 'Reconnecting... 2/5', description: 'stream disconnected before completion: Connection refused (os error 61)',
  });
  assert.deepEqual(codexNotice(info({ message: 'Quota exceeded.', additionalDetails: null, willRetry: false })), { sessionUpdate: 'notice', severity: 'error', title: 'Quota exceeded.' });
  assert.equal(codexNotice(info({ message: ' ' })), null);
  assert.equal(codexNotice({ sessionUpdate: 'session_info_update', _meta: { codex: { threadStatus: { type: 'idle' } } } }), null);
  assert.equal(codexNotice({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hi' } }), null);
});

test('a failure keeps what the agent said; one that says nothing says where it stopped, how its process ended and what it wrote', () => {
  const said = Object.assign(new Error('Codex process has exited with code 3:\nerror: failed to connect'), { code: 1001 });
  assert.equal(explainFailure(said, { label: 'Codex', step: 'session/new' }), said);

  const bare = explainFailure(Object.assign(new Error('Internal error'), { code: -32603 }), { label: 'Codex', step: 'session/prompt' });
  assert.equal(bare.message, 'Codex stopped while answering without saying why. If it cannot reach its service, check the network or proxy, then try again.');
  assert.equal(bare.code, -32603);
  assert.equal(bare.step, 'session/prompt');

  const crashed = explainFailure(new Error('ACP connection closed'), {
    label: 'Codex', step: 'initialize', exited: { code: 1 },
    stderr: "node:events:487\n      throw er; // Unhandled 'error' event\n      ^\n\nError: write EPIPE\n    at afterWriteDispatched (node:internal/stream_base_commons:159:15)\nEmitted 'error' event on Socket instance at:\n  errno: -32,\n  code: 'EPIPE',\n}\n\nNode.js v26.0.0\n",
  });
  assert.equal(crashed.message, 'Codex stopped as it started without saying why. Its process ended with code 1. It last wrote: Error: write EPIPE');

  const ended = explainFailure(new Error('Rate limit reached.'), { label: 'Kimi', exited: { code: null } });
  assert.equal(ended.message, 'Rate limit reached. Its process ended.');
});

test('"Internal error" with its reason in data: the reason is what the turn says, and the error as sent stays under it', () => {
  const sent = Object.assign(new Error('Internal error'), { code: -32603, data: { details: 'Request timed out.' } });
  const said = explainFailure(signInError('Codex', sent, { own: true }), { label: 'Codex', step: 'session/prompt' });
  assert.equal(said.message, 'Request timed out.', 'a reason given is not "without saying why"');
  let asSent = said;
  while (asSent.cause) asSent = asSent.cause;
  assert.equal(asSent, sent, 'the turn log reaches the error as the agent sent it');

  const bare = explainFailure(signInError('Codex', Object.assign(new Error('Internal error'), { code: -32603 }), { own: true }), { label: 'Codex', step: 'session/prompt', exited: { code: 1 } });
  assert.match(bare.message, /^Codex stopped while answering without saying why\. Its process ended with code 1\./);
});

test("what an agent's stderr says: the lines that name an error, else its last lines", () => {
  assert.equal(stderrReason('starting\nwarning: slow disk\nlistening'), 'starting | warning: slow disk | listening');
  assert.equal(stderrReason('ok\nError: cannot read config.toml\n    at load (x.js:1:1)\ndone'), 'Error: cannot read config.toml');
  assert.equal(stderrReason(''), '');
});

test('an installer runs as its maker wrote it: in Terminal on a Mac, in a PowerShell window of its own on Windows', () => {
  assert.equal(terminalScript('curl https://cursor.com/install -fsS | bash'),
    'tell application "Terminal"\nactivate\ndo script "curl https://cursor.com/install -fsS | bash"\nend tell');
  const lines = powerShellLine('Cursor install', "irm 'https://cursor.com/install?win32=true' | iex").slice(1).split('\r\n');
  assert.deepEqual(lines.slice(0, 2), ["$Host.UI.RawUI.WindowTitle = 'Cursor install'", "irm 'https://cursor.com/install?win32=true' | iex"]);
});

test("a Windows sign-in or installer window is opened through cmd.exe's start, each path whole", () => {
  const how = powerShellWindowLaunch('C:\\Users\\someone\\AppData\\Local\\Temp\\open film\\qwen.ps1',
    { comSpec: 'C:\\WINDOWS\\system32\\cmd.exe', systemRoot: 'C:\\WINDOWS' });
  assert.equal(how.cmd, 'C:\\WINDOWS\\system32\\cmd.exe');
  assert.deepEqual(how.args, ['/d', '/s', '/c', '"start "" C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoLogo -NoExit '
    + '-ExecutionPolicy Bypass -File "C:\\Users\\someone\\AppData\\Local\\Temp\\open film\\qwen.ps1""']);
  assert.deepEqual(how.options, { windowsVerbatimArguments: true, windowsHide: true });
});

test('on Windows, the window opened for a sign-in or an installer runs its script', async () => {
  if (process.platform !== 'win32') return;
  const { spawn } = await import('node:child_process');
  const { existsSync, mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'of-window '));
  const mark = join(dir, 'ran.txt');
  const file = join(dir, 'probe.ps1');
  /* leaves a mark, then closes its own window */
  writeFileSync(file, `\ufeffSet-Content -LiteralPath '${mark.replace(/'/g, "''")}' -Value ran\r\n[Environment]::Exit(0)\r\n`, 'utf8');
  const how = powerShellWindowLaunch(file);
  const child = spawn(how.cmd, how.args, { cwd: dir, detached: true, stdio: 'ignore', ...how.options });
  child.unref();
  for (let i = 0; i < 100 && !existsSync(mark); i += 1) await new Promise((r) => setTimeout(r, 100));
  assert.ok(existsSync(mark), 'the script ran');
});

test('a program chosen that is an editor, or not Cursor\'s own agent, is refused without being started', async () => {
  if (process.platform === 'win32') return;
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = mkdtempSync(join(tmpdir(), 'of-check-'));
  /* it would leave a mark if it were started */
  const exe = (file) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, `#!/bin/sh\ntouch "${file}.ran"\n`, { mode: 0o755 }); return file; };
  const code = exe(join(home, 'Visual Studio Code.app', 'Contents', 'Resources', 'app', 'bin', 'copilot'));
  assert.deepEqual(await checkAgentProgram('copilot', code), { ok: false, error: "This is an editor or a desktop app, not the agent's command-line program.", code: 'app' });
  const stray = exe(join(home, 'bin', 'agent'));
  assert.equal((await checkAgentProgram('cursor', stray)).code, 'not-cursor-agent');
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(`${code}.ran`) || existsSync(`${stray}.ran`), false);
});

test("a script the app's own Node starts runs as the main module, without ELECTRON_RUN_AS_NODE (an npm install on Windows)", async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  /* as DeepSeek Harness's bin.js does: it runs only when it is the main module, else it exits saying nothing */
  const bin = join(mkdtempSync(join(tmpdir(), 'of-main-')), 'bin.mjs');
  writeFileSync(bin, "if (import.meta.main) console.log(`0.2.1 ${process.env.ELECTRON_RUN_AS_NODE ?? 'clean'} ${process.argv.slice(2).join(' ')}`);\n");
  assert.deepEqual(await checkAgentProgram('deepseek', bin), { ok: true, path: bin, version: '0.2.1 clean --version' });
});
