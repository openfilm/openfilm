import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentSession, CLIENT_CAPABILITIES, agentDefaults, planProblem, CODEX_UTF8_CMD, agentShell, allowOption, codexDeveloperInstructions, codexLaunchEnv, distinctOptions, legacyOptions, powerShellScript, readAgentStatus, setChosenPaths, signInScript, turnError } from './agents.mjs';

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

test("the older model and mode lists (Gemini CLI's) read as the config options the chat's menu has", () => {
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
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'of-cursor-'));
  /* says it is signed out, and never answers over ACP (Cursor waits on its sign-in page there) */
  const program = join(dir, 'cursor-agent.mjs');
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
