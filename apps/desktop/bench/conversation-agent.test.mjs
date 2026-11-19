/** Conversation options through the real menu and send path, with agent IPC kept inside an isolated fixture. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';
import { filmHtml } from 'openfilm/film-doc';
import { DESKTOP, buildShell, prepare } from './app.mjs';
import { loadChat, saveSessions } from '../src/chat-store.mjs';
import { launcherEnvironment, loginShellEnvironment } from '../src/environment.mjs';

buildShell();
const dir = join(DESKTOP, '.dev', `conversation-agent-${Date.now()}`);
prepare(dir);
const film = join(dir, 'projects', 'conversation');
mkdirSync(film);
writeFileSync(join(film, 'film.html'), filmHtml({ stage: { w: 1920, h: 1080 }, tracks: [] }));
const now = new Date().toISOString();
saveSessions(film, { last: 'saved', sessions: [{
  id: 'saved', title: 'Saved conversation', turns: 1, createdAt: now, updatedAt: now,
  agent: 'byok', agentPrefs: { byok: { model: 'model-x', effort: 'high' } },
}, {
  id: 'codex-chat', title: 'Codex conversation', turns: 1, createdAt: now, updatedAt: now,
  agent: 'codex', agentSessions: { codex: 'fixture-codex-chat' },
}, ...['old-blank-a', 'old-blank-b'].map((id) => ({ id, title: '', turns: 0, createdAt: now, updatedAt: now }))] });

const { PATH } = await loginShellEnvironment();
const app = await electron.launch({
  executablePath: createRequire(import.meta.url)('electron'), args: [DESKTOP], cwd: DESKTOP,
  env: { ...launcherEnvironment(process.env, PATH), OPENFILM_DESKTOP_FLAVOR: 'bench', OPENFILM_BENCH_DIR: dir },
});
let page;
try {
  const findPage = async (matches) => {
    for (let attempt = 0; attempt < 300; attempt++) {
      const found = app.context().pages().find((p) => matches(p.url()));
      if (found) return found;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error('The desktop page did not open.');
  };
  await findPage((url) => url.startsWith('http://127.0.0.1:'));
  // Only the agent boundary is replaced: the menu, conversation loading/saving and send path are real.
  await app.evaluate(({ app, ipcMain, webContents }) => {
    const models = [
      { id: 'model-x', name: 'Model X', model: 'x', levels: ['low', 'high'], effort: 'low' },
      { id: 'model-y', name: 'Model Y', model: 'y', levels: ['low', 'medium'], effort: 'medium' },
    ].map((m) => ({ ...m, format: 'responses', baseUrl: 'http://127.0.0.1:1/v1', last4: 'test' }));
    const options = [
      { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'model-x', options: models.map((m) => ({ value: m.id, name: m.name })) },
      { id: 'effort', name: 'Effort', category: 'thought_level', type: 'select', currentValue: 'low', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] },
    ];
    const info = () => ({ sessionId: 'fixture', configOptions: options, authMethods: [], mcp: false, steering: true });
    const handle = (channel, fn) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, fn); };
    const roster = [
      { id: 'byok', name: 'Own key', shown: true, status: 'ready', byok: { models } },
      { id: 'codex', name: 'Codex', shown: true, status: 'ready' },
    ];
    handle('desktop:agents:list', () => roster);
    const useFixtureRoster = (contents) => {
      const send = contents.send.bind(contents);
      contents.send = (channel, ...args) => send(channel, ...(channel === 'desktop:agents' ? [roster] : args));
    };
    webContents.getAllWebContents().forEach(useFixtureRoster);
    app.on('web-contents-created', (_event, contents) => useFixtureRoster(contents));
    handle('desktop:local-agents:probe', () => ({ ok: true, info: info() }));
    handle('desktop:local-agents:start', (_event, { resume, meta }) => {
      globalThis.conversationAgentResumed = resume;
      const key = meta?.sessionId === 'saved' || !meta?.sessionId ? 'fixture' : `fixture-${meta.sessionId}`;
      return { ok: true, key, info: { ...info(), sessionId: key, resumed: resume === key } };
    });
    handle('desktop:local-agents:set-option', (_event, { configId, value }) => {
      const option = options.find((o) => o.id === configId);
      assertOption(option, value);
      option.currentValue = value;
      return { ok: true, result: { configOptions: options } };
    });
    function assertOption(option, value) {
      if (!option?.options.some((o) => o.value === value)) throw new Error(`Invalid fixture option: ${value}`);
    }
    globalThis.conversationAgentMessages = [];
    globalThis.conversationAgentTurnIds = [];
    globalThis.conversationAgentMeta = [];
    globalThis.conversationAgentStops = 0;
    handle('desktop:local-agents:prompt', (event, { key, text, meta }) => {
      globalThis.conversationAgentSent = Object.fromEntries(options.map((o) => [o.id, o.currentValue]));
      globalThis.conversationAgentMessages.push(text);
      globalThis.conversationAgentTurnIds.push(meta?.turnId);
      globalThis.conversationAgentMeta.push({ agent: meta?.agent, recovery: meta?.recovery, handoff: meta?.handoff });
      const update = (value) => event.sender.send('desktop:local-agents:event', { key, kind: 'update', update: value });
      if (/^(Diagnose the interrupted model|Hand off the unfinished task)\./.test(text) || meta?.handoff) {
        const command = meta?.handoff ? 'echo continued' : 'echo existing';
        update({ sessionUpdate: 'tool_call', toolCallId: 'shared-tool', title: 'bash', kind: 'execute', status: 'in_progress', rawInput: { command } });
        update({ sessionUpdate: 'tool_call_update', toolCallId: 'shared-tool', status: 'completed' });
        update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: meta?.handoff ? 'The new agent finished the task.' : 'The original agent saved its work.' } });
        if (meta?.handoff) return { ok: true, stopReason: 'end_turn' };
        return new Promise((resolve) => { globalThis.finishConversationAgent = resolve; });
      }
      if (text === 'Keep this prompt in place.') {
        globalThis.streamConversationAgent = (update) => event.sender.send('desktop:local-agents:event', { key, kind: 'update', update });
        return new Promise((resolve) => { globalThis.finishConversationAgent = resolve; });
      }
      const reply = meta?.agent === 'codex'
        ? (meta.recovery ? 'Codex continued the answer.' : 'Codex sent part of the answer.')
        : 'Fixture answer.';
      event.sender.send('desktop:local-agents:event', { key, kind: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: reply } } });
      globalThis.sendLateReply = () => event.sender.send('desktop:local-agents:event', {
        key, kind: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Late reply after stop.' } },
      });
      globalThis.reportAgentExit = () => event.sender.send('desktop:local-agents:event', { key, kind: 'exit', code: 1, stderr: '' });
      if (/^Hold this task|^Break the connection/.test(text)) return new Promise((resolve) => { globalThis.finishConversationAgent = resolve; });
      return { ok: true, stopReason: 'end_turn' };
    });
    handle('desktop:local-agents:cancel', () => {
      globalThis.conversationAgentStops += 1;
      if (!globalThis.holdConversationStop) globalThis.finishConversationAgent?.({ ok: true, stopReason: 'cancelled' });
      return { ok: true };
    });
  });
  await app.context().addInitScript(() => {
    localStorage.setItem('openfilm.language', 'en');
    localStorage.setItem('openfilm.theme', 'dark');
    localStorage.setItem('openfilm.local-agents.v2', JSON.stringify({ picked: 'byok', prefs: { byok: { model: 'model-y', effort: 'medium' } }, options: {} }));
  });
  const run = JSON.parse(readFileSync(join(dir, 'home/run.json'), 'utf8'));
  const response = await fetch(`${run.origin}/api/open`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-key': run.key },
    body: JSON.stringify({ path: film, fallback: 0 }),
  });
  assert.equal(response.status, 200);
  page = await findPage((url) => url.includes('/projects/'));
  await page.waitForSelector('[data-prompt-editor]');
  // Reload after Playwright has attached so the stored global choice precedes the chat's hydration.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-prompt-editor]');
  const model = page.getByRole('button', { name: /^Model X/ });
  await model.waitFor();
  assert.equal(await page.locator('[data-prompt-shell]').evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(32, 32, 32)');
  const savedTitle = page.locator('[data-conversation-title="saved"] button');
  assert.deepEqual(await savedTitle.evaluate((node) => ({
    labelColor: getComputedStyle(node.querySelector('span')).color,
    titleHeight: getComputedStyle(node).height,
    barDivider: getComputedStyle(node.closest('[data-conversation-bar]')).borderBottomWidth,
  })), { labelColor: 'rgb(163, 163, 163)', titleHeight: '22px', barDivider: '0px' });
  assert.equal(await page.locator('[data-conversation-bar] [role="tab"]').count(), 0);
  assert.match(await model.innerText(), /High/, 'the menu keeps Model X\'s High effort when the global Model Y only offers Low and Medium');
  await page.locator('[data-prompt-editor]').fill('Check the saved effort.');
  await page.locator('[data-prompt-editor]').press('Enter');
  await page.getByText('Fixture answer.', { exact: true }).waitFor();
  const sentBubble = page.getByText('Check the saved effort.', { exact: true });
  assert.deepEqual(await sentBubble.evaluate((node) => [getComputedStyle(node.parentElement).backgroundColor, getComputedStyle(node).color]),
    ['rgb(37, 37, 37)', 'rgb(240, 240, 240)']);
  assert.deepEqual(await app.evaluate(() => globalThis.conversationAgentSent), { model: 'model-x', effort: 'high' }, 'the next message uses the conversation\'s model and effort');
  await page.waitForFunction(async (project) => {
    const { sessions } = await window.openfilmNative.chat.load(project);
    return sessions.find((s) => s.id === 'saved')?.turns === 2;
  }, film);
  assert.deepEqual(loadChat(film).sessions.find((s) => s.id === 'saved').agentPrefs.byok, { model: 'model-x', effort: 'high' }, 'sending preserves the saved effort');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^Model X.*High/ }).waitFor();

  const editor = page.locator('[data-prompt-editor]');
  const send = async (text) => { await editor.fill(text); await editor.press('Enter'); };
  const composerAction = page.locator('[data-composer-action]');
  const sendButton = page.getByRole('button', { name: 'Send edit instruction', exact: true });
  const stop = page.getByRole('button', { name: 'Stop task', exact: true });
  const resume = page.getByRole('button', { name: 'Continue task', exact: true });
  const sent = () => app.evaluate(() => globalThis.conversationAgentMessages);
  const waitForSent = async (count) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const items = await sent();
      if (items.length >= count) return items;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    assert.fail(`Expected ${count} sent messages`);
  };
  await send('Hold this task.');
  await waitForSent(2);
  await stop.waitFor();
  assert.equal(await savedTitle.locator(':scope > span').count(), 1, 'a running conversation has only its label and dropdown arrow');
  await editor.fill('Send while another reply is running.');
  assert.equal(await composerAction.count(), 1);
  assert.equal(await stop.count(), 0);
  assert.equal(await sendButton.isEnabled(), true);
  await app.evaluate(() => { globalThis.holdConversationStop = true; });
  await sendButton.click();
  await page.getByText('Send while another reply is running.', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-chat-queue]').count(), 0);
  assert.equal((await sent()).length, 2);
  await app.evaluate(() => {
    globalThis.holdConversationStop = false;
    globalThis.finishConversationAgent({ ok: true, stopReason: 'cancelled' });
  });
  assert.match((await waitForSent(3)).at(-1), /^Send while another reply is running\./);

  await send('Hold this task for resume.');
  await waitForSent(4);
  await stop.click();
  await resume.waitFor();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await resume.click();
  assert.equal((await waitForSent(5)).at(-1), '', 'native recovery adds no continuation message');
  assert.equal(await app.evaluate(() => globalThis.conversationAgentTurnIds[3] === globalThis.conversationAgentTurnIds[4]), true);
  assert.equal(await page.getByText('Hold this task for resume.', { exact: true }).count(), 1);
  assert.equal(await app.evaluate(() => globalThis.conversationAgentResumed), 'fixture');

  await send('Break the connection.');
  await waitForSent(6);
  await app.evaluate(() => globalThis.reportAgentExit());
  await resume.click();
  await app.evaluate(() => globalThis.finishConversationAgent({ ok: false, error: 'Fixture connection lost' }));
  assert.equal((await waitForSent(7)).at(-1), '');
  assert.equal(await app.evaluate(() => globalThis.conversationAgentTurnIds[5] === globalThis.conversationAgentTurnIds[6]), true);
  await sendButton.waitFor();

  const title = page.locator('[data-conversation-title] button');
  const dropdown = title.locator('svg.lucide-chevron-down');
  const history = page.getByRole('dialog', { name: 'Chat history' });
  const openMenu = async () => {
    await dropdown.click();
    await history.waitFor();
    assert.equal(await title.getAttribute('aria-expanded'), 'true');
    assert.equal(await history.getByRole('button', { name: 'New parallel chat', exact: true }).count(), 0);
    assert.equal(await history.locator('[aria-label="Working"]').count(), 0, 'history shows no running indicator');
  };
  const newChat = async () => {
    await openMenu();
    await history.getByRole('button', { name: 'New chat', exact: true }).click();
  };
  const selectChat = async (name) => {
    await openMenu();
    await history.getByRole('button', { name, exact: true }).click();
  };
  const mode = (workbench) => page.waitForFunction((id) => window.openfilmDesktop.workbench()?.current === id, workbench);
  await mode('edit');
  await send('Hold this task before switching conversations.');
  await waitForSent(8);
  await editor.fill('Draft belongs to the first conversation.');
  await newChat();
  assert.equal(await title.innerText(), 'New chat');
  assert.equal(await dropdown.count(), 1);
  assert.equal((await editor.innerText()).trim(), '');
  assert.equal(await title.locator(':scope > span').count(), 1, 'a different conversation does not inherit the running indicator');
  const blankId = await title.evaluate((button) => button.closest('[data-conversation-title]').dataset.conversationTitle);
  await editor.fill('Keep this draft here.');
  await newChat();
  await history.getByRole('status').getByText('Already a new chat').waitFor();
  assert.equal(await title.evaluate((button) => button.closest('[data-conversation-title]').dataset.conversationTitle), blankId);
  assert.equal(await editor.innerText(), 'Keep this draft here.');
  assert.equal(await editor.evaluate((node) => node === document.activeElement), true);
  await dropdown.click();
  await history.waitFor({ state: 'detached' });
  assert.equal((await sent()).length, 8, 'browsing or creating a blank conversation does not interrupt a request');
  await mode('edit');
  await page.evaluate(() => {
    const { projectId } = window.openfilmDesktop.workbench();
    window.openfilmDesktop.showWorkbench(projectId, 'canvas');
  });
  await mode('canvas');
  const canvas = page.locator('[data-workspace-canvas]');
  await canvas.waitFor();
  await canvas.evaluate((node) => { window.fixtureCanvas = node; });
  const beforeSwitch = await app.evaluate(() => {
    globalThis.holdConversationStop = true;
    return globalThis.conversationAgentStops;
  });
  await send('Start work in this conversation.');
  await page.getByText('Start work in this conversation.', { exact: true }).and(page.locator('p')).waitFor();
  assert.equal(await app.evaluate(() => globalThis.conversationAgentStops), beforeSwitch + 1);
  assert.equal((await sent()).length, 8, 'the next conversation waits for the old request to stop');
  await app.evaluate(() => {
    globalThis.holdConversationStop = false;
    globalThis.finishConversationAgent({ ok: true, stopReason: 'cancelled' });
  });
  await waitForSent(9);
  await selectChat('Saved conversation');
  await mode('edit');
  assert.equal(await editor.innerText(), 'Draft belongs to the first conversation.');
  assert.equal(await title.count(), 1);
  await selectChat('Start work in this conversation.');
  await mode('canvas');
  assert.equal(await canvas.evaluate((node) => node === window.fixtureCanvas), true);
  await page.evaluate(() => {
    const { projectId } = window.openfilmDesktop.workbench();
    localStorage.setItem(`openfilm.chat.tabs:${projectId}`, JSON.stringify(['saved', 'old-blank-a', 'old-blank-b', 'codex-chat']));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await title.waitFor();
  assert.equal(await title.innerText(), 'Start work in this conversation.');
  assert.equal(await title.count(), 1);
  assert.ok(loadChat(film).sessions.some((session) => session.id === 'old-blank-b'));
  await selectChat('Codex conversation');
  const beforeCodex = (await sent()).length;
  const interrupted = 'Hold this task in Codex.';
  await send(interrupted);
  await waitForSent(beforeCodex + 1);
  await page.getByText('Codex sent part of the answer.', { exact: true }).waitFor();
  assert.equal(await stop.locator('svg.lucide-square').count(), 1);
  await app.evaluate(() => { globalThis.holdConversationStop = true; });
  await stop.click();
  await resume.click();
  await stop.waitFor();
  await stop.click(); // Cancel the requested restart while the old stream still has not acknowledged the stop.
  await resume.click();
  await app.evaluate(() => globalThis.sendLateReply());
  assert.equal((await sent()).length, beforeCodex + 1);
  await app.evaluate(() => {
    globalThis.holdConversationStop = false;
    globalThis.finishConversationAgent({ ok: true, stopReason: 'cancelled' });
  });
  const afterCodex = await waitForSent(beforeCodex + 2);
  assert.deepEqual(JSON.parse(afterCodex.at(-1)), { originalRequest: interrupted, partialReply: 'Codex sent part of the answer.' });
  await page.getByText('Codex continued the answer.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Send edit instruction', exact: true }).waitFor();
  assert.equal(await resume.count(), 0, 'normal completion goes back to Send');
  assert.equal(await page.getByText('Late reply after stop.', { exact: false }).count(), 0);
  assert.equal(await page.getByText(interrupted, { exact: true }).count(), 1);
  assert.equal(await app.evaluate(() => globalThis.conversationAgentTurnIds.at(-1) === globalThis.conversationAgentTurnIds.at(-2)), true);
  assert.equal(await app.evaluate(() => globalThis.conversationAgentResumed), 'fixture-codex-chat');

  await selectChat('Saved conversation');
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('desktop:chat:snapshot');
    ipcMain.handle('desktop:chat:snapshot', () => {
      if (globalThis.releaseSnapshot) return true;
      return new Promise((resolve) => { globalThis.releaseSnapshot = () => resolve(true); });
    });
  });
  const preparing = 'Stop before sending this message.';
  const beforePreparing = (await sent()).length;
  await send(preparing);
  await stop.click();
  await resume.waitFor();
  assert.equal(await resume.isEnabled(), true);
  await app.evaluate(() => globalThis.releaseSnapshot());
  assert.equal((await sent()).length, beforePreparing);
  await page.waitForFunction(async ({ project, preparing }) => {
    const { turns } = await window.openfilmNative.chat.load(project);
    return turns.some(({ turn }) => turn.status === 'cancelled' && turn.unsent?.instruction === preparing);
  }, { project: film, preparing });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await resume.click();
  assert.match((await waitForSent(beforePreparing + 1)).at(-1), /^Stop before sending this message\./);
  assert.equal(await page.getByText(preparing, { exact: true }).count(), 1);

  await sendButton.waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const stablePrompt = 'Keep this prompt in place.';
  const beforeStreaming = (await sent()).length;
  await send(stablePrompt);
  await waitForSent(beforeStreaming + 1);
  const prompt = page.getByText(stablePrompt, { exact: true }).and(page.locator('p'));
  const promptTop = () => prompt.evaluate(async (node) => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return node.getBoundingClientRect().top;
  });
  const startTop = await promptTop();
  const staysPut = async (phase) => assert.ok(Math.abs(await promptTop() - startTop) <= 1, `the prompt stays in place ${phase}`);
  const stream = (update) => app.evaluate((_electron, value) => globalThis.streamConversationAgent(value), update);
  await stream({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Inspecting the clip.' } });
  await page.getByText('Thinking', { exact: true }).last().waitFor();
  await staysPut('while thinking');
  const tool = page.locator('[data-activity-id="act:check-clip"]');
  await stream({ sessionUpdate: 'tool_call', toolCallId: 'check-clip', title: 'bash', kind: 'execute', status: 'in_progress', rawInput: { command: 'echo clip' } });
  await tool.and(page.locator('[aria-busy="true"]')).waitFor();
  await staysPut('while the command runs');
  await stream({ sessionUpdate: 'tool_call_update', toolCallId: 'check-clip', status: 'completed', rawOutput: 'clip' });
  await tool.and(page.locator('[aria-busy="false"]')).waitFor();
  await staysPut('when the command finishes');
  await stream({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'The clip is ready.' } });
  await page.getByText('The clip is ready.', { exact: true }).waitFor();
  await staysPut('as the reply streams');
  await app.evaluate(() => globalThis.finishConversationAgent({ ok: true, stopReason: 'end_turn' }));
  await sendButton.waitFor();
  await staysPut('when the reply finishes');

  const beforeDiagnosis = (await sent()).length;
  await send('Diagnose the interrupted model.');
  await waitForSent(beforeDiagnosis + 1);
  await app.evaluate(() => globalThis.finishConversationAgent({
    ok: false, error: 'The connection to the model service was interrupted. Continue to pick up this task.',
    modelConnection: { host: 'fixture.example', phase: 'streaming', status: 200, elapsedMs: 3873,
      requestId: 'fixture-request-id', code: 'UND_ERR_SOCKET', retries: 0, partial: true },
  }));
  await page.getByText('Connection details', { exact: true }).click();
  await page.getByText('Receiving the model response', { exact: true }).waitFor();
  await page.getByText('UND_ERR_SOCKET', { exact: true }).waitFor();
  await page.getByText('fixture-request-id', { exact: true }).waitFor();
  await page.waitForFunction(async (project) => (await window.openfilmNative.chat.load(project)).turns
    .some(({ turn }) => turn.modelConnection?.requestId === 'fixture-request-id'), film);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Connection details', { exact: true }).click();
  await page.getByText('fixture.example', { exact: true }).waitFor();
  await page.getByRole('button', { name: /^Model X.*High/ }).click();
  await page.getByRole('button', { name: /^Model Model X$/ }).hover();
  await page.getByRole('button', { name: 'Model Y', exact: true }).click();
  await page.keyboard.press('Escape');
  await resume.click();
  assert.equal((await waitForSent(beforeDiagnosis + 2)).at(-1), '', 'native recovery keeps the original request in the same session');
  assert.equal(await app.evaluate(() => globalThis.conversationAgentSent.model), 'model-y');
  await page.getByText(/^Continued with .*Model X.*→.*Model Y/).waitFor();
  await sendButton.waitFor();

  const beforeHandoff = (await sent()).length;
  const handoffPrompt = 'Hand off the unfinished task.';
  await send(handoffPrompt);
  await waitForSent(beforeHandoff + 1);
  await stop.click();
  await page.getByRole('button', { name: /^Model Y/ }).click();
  await page.getByRole('button', { name: 'Codex', exact: true }).click();
  await page.keyboard.press('Escape');
  await resume.click();
  const handoffRequest = (await waitForSent(beforeHandoff + 2)).at(-1);
  assert.match(handoffRequest, /"originalRequest":"Hand off the unfinished task\."/);
  assert.match(handoffRequest, /The original agent saved its work/);
  assert.match(handoffRequest, /echo existing/);
  assert.deepEqual(await app.evaluate(() => globalThis.conversationAgentMeta.at(-1)), { agent: 'codex', recovery: true, handoff: true });
  assert.equal(await app.evaluate(() => globalThis.conversationAgentTurnIds.at(-1) === globalThis.conversationAgentTurnIds.at(-2)), true);
  await page.getByText('The new agent finished the task.', { exact: true }).waitFor();
  await page.getByText(/^Continued with .*Model Y.*→ Codex/).waitFor();
  assert.equal(await page.getByText(handoffPrompt, { exact: true }).count(), 1);
  const handedOffTurn = page.locator('div[class~="group/turn"]').filter({ has: page.getByText(handoffPrompt, { exact: true }) });
  assert.equal(await handedOffTurn.locator('[data-activity-id$=":shared-tool"]').count(), 2);

  console.log('Conversation agent passed: history, stable scrolling, connection details, selected-model recovery and agent handoff.');
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(dir, 'failed.png') }).catch(() => {});
  console.error(`Conversation agent artifacts: ${dir}`);
  throw error;
} finally {
  await app.close();
}
