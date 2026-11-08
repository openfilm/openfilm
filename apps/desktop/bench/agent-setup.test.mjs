import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import shellConfig from '../shell/vite.config.ts';
import { AGENT_DOWNLOADS, installCommand } from '../src/agent-installation.mjs';

test('agent setup guides desktop-only installs, folder selection and model failures without losing a working program', { timeout: 90_000 }, async () => {
  const server = await createServer({
    ...shellConfig, configFile: false, root: fileURLToPath(new URL('..', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
    plugins: [...shellConfig.plugins, { name: 'agent-setup-fixture', configureServer(app) {
      app.middlewares.use('/agent-setup-ui', (_req, res, next) => {
        res.setHeader('content-type', 'text/html');
        void app.transformIndexHtml('/agent-setup-ui', '<!doctype html><html><body><div id="root"></div><script type="module" src="/bench/agent-sign-in.tsx"></script></body></html>')
          .then((html) => res.end(html), next);
      });
    } }],
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    for (const locale of ['en', 'zh-CN']) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const antigravityInstaller = installCommand('antigravity');
      assert.ok(antigravityInstaller, 'Antigravity uses the terminal installer registry');
      await page.addInitScript(({ locale, antigravityInstaller, antigravityPage }) => {
        localStorage.setItem('openfilm.language', locale);
        let agents = [
          { id: 'claude', name: 'Claude Code', shown: true, status: 'missing', setupRequired: 'code-tab' },
          { id: 'cursor', name: 'Cursor', shown: false, status: 'missing', app: 'Cursor', installer: 'official-install-command' },
          { id: 'antigravity', name: 'Google Antigravity', shown: false, status: 'missing', app: 'Antigravity', installer: antigravityInstaller, install: antigravityPage },
          { id: 'opencode', name: 'OpenCode', shown: true, status: 'ready', path: 'C:/Apps/OpenCode/resources/opencode-cli.exe', connectionIssue: { kind: 'quota', message: 'Free usage limit reached. Raw quota fixture.' } },
          { id: 'deepseek', name: 'DeepSeek Harness', shown: true, status: 'ready', path: 'D:/Apps/DeepSeek/resources/runtime/cli/bin/dsh.cmd', connectionIssue: { kind: 'credentials', message: 'no API key for provider route "deepseek-official"' } },
        ];
        const listeners = new Set();
        const calls = { setup: [], locate: [], connect: [], install: [], refresh: 0, parentEscape: 0, diagnose: 0 };
        window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !event.defaultPrevented) calls.parentEscape++; });
        const publish = (id, patch) => { agents = agents.map((a) => a.id === id ? { ...a, ...patch } : a); for (const listener of listeners) listener(agents); };
        window.openfilmHost = { version: 1, agents: {
          list: async () => agents,
          refresh: async () => { calls.refresh++; publish('opencode', { connectionIssue: undefined }); publish('deepseek', { connectionIssue: undefined }); return agents; },
          connect: async (id) => { calls.connect.push(id); return { ok: true }; },
          disconnect: async () => {}, setShown: async () => {},
          openSetup: async (id) => { calls.setup.push(id); return { ok: true }; },
          install: async (id) => { calls.install.push(id); publish(id, { installing: true }); return { ok: true }; },
          locate: async (id, words) => {
            calls.locate.push({ id, kind: words.kind });
            if (calls.locate.length === 1) return { ok: false, code: 'not-a-program', error: 'no component in folder' };
            publish(id, { status: 'off', path: 'D:/Custom Agent/bin/agent.cmd' });
            return { ok: true, path: 'D:/Custom Agent/bin/agent.cmd', version: '1.2.3' };
          },
          diagnose: async () => { calls.diagnose++; return { found: 'D:/Custom Agent/bin/agent.cmd', hint: null, text: 'Agent diagnostic fixture: custom folder discovered' }; },
          onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        } };
        window.agentSetupFixture = { calls, publish };
      }, { locale, antigravityInstaller, antigravityPage: AGENT_DOWNLOADS.antigravity });
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/agent-setup-ui`);
      const zh = locale === 'zh-CN';
      await page.evaluate((dark) => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, zh);
      const row = (name) => page.locator('div.py-4').filter({ has: page.getByText(name, { exact: true }) });
      const helpButton = (name) => row(name).getByRole('button', { name: zh ? `${name} 的连接帮助` : `Connection help for ${name}`, exact: true });
      const helpDialog = () => page.getByRole('dialog');
      const closeHelp = () => helpDialog().getByRole('button', { name: zh ? '知道了' : 'Got it', exact: true }).click();
      const manual = () => helpDialog().getByRole('button', { name: zh ? '手动选择安装文件夹…' : 'Choose installation folder…', exact: true });
      await helpButton('Cursor').waitFor();
      assert.equal(await page.getByRole('button', { name: zh ? '手动选择安装文件夹…' : 'Choose installation folder…', exact: true }).count(), 0, 'folder selection is only offered inside diagnosis details');
      assert.equal(await page.getByRole('button', { name: zh ? '手动选择…' : 'Locate…', exact: true }).count(), 0, 'manual selection is only available inside help');
      const description = row('Cursor').getByText(zh ? '已发现 Cursor 桌面应用，需要补充连接组件。' : 'Found the Cursor desktop app. A connection component is needed.', { exact: true });
      const descriptionBounds = await description.boundingBox();
      const helpBounds = await helpButton('Cursor').boundingBox();
      assert.ok(helpBounds.x >= descriptionBounds.x + descriptionBounds.width - 1, 'help icon follows the description text');
      assert.ok(helpBounds.y < descriptionBounds.y + descriptionBounds.height && helpBounds.y + helpBounds.height > descriptionBounds.y, 'help stays on the description line without an extra row');
      assert.equal(await page.getByRole('button', { name: zh ? '为什么检测不到？' : 'Why isn’t it found?', exact: true }).count(), 0);
      if (zh && process.env.OPENFILM_HELP_LIST_PREVIEW) await page.screenshot({ path: process.env.OPENFILM_HELP_LIST_PREVIEW, fullPage: true });
      await helpButton('Cursor').click();
      await helpDialog().getByRole('heading', { name: zh ? '如何连接' : 'How to connect', exact: true }).waitFor();
      assert.equal(await manual().count(), 1, 'manual location remains available in the help dialog');
      assert.equal(await helpDialog().getByRole('button', { name: zh ? '手动选择…' : 'Locate…', exact: true }).count(), 0, 'the separate program-file selector has been removed');
      assert.equal(await helpDialog().getByRole('heading', { name: zh ? '检测不到怎么办' : 'If the agent is not found', exact: true }).isVisible(), true);
      assert.equal(await page.evaluate(() => window.agentSetupFixture.calls.diagnose), 0, 'opening instructions does not start a diagnostic process');
      if (zh && process.env.OPENFILM_HELP_PREVIEW) await page.screenshot({ path: process.env.OPENFILM_HELP_PREVIEW, fullPage: true });
      await page.keyboard.press('Tab');
      assert.equal(await helpDialog().evaluate((dialog) => dialog.contains(document.activeElement)), true, 'keyboard focus stays inside connection help');
      await page.keyboard.press('Escape');
      await helpDialog().waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.agentSetupFixture.calls.parentEscape), 0, 'Escape closes only connection help, not the parent settings');
      assert.equal(await helpButton('Cursor').evaluate((button) => button === document.activeElement), true, 'focus returns to the help icon');
      await page.getByRole('button', { name: zh ? '打开 Claude' : 'Open Claude', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.agentSetupFixture.calls.setup), ['claude']);
      await row('Cursor').getByRole('button', { name: zh ? '安装连接组件' : 'Install connection component', exact: true }).click();
      assert.equal(await page.getByText('official-install-command', { exact: true }).isVisible(), true);
      assert.deepEqual(await page.evaluate(() => window.agentSetupFixture.calls.install), [], 'the install command still needs an explicit user action');
      await page.getByRole('button', { name: zh ? '取消' : 'Cancel', exact: true }).click();
      assert.equal(await page.getByRole('switch').count(), 5, 'visibility switches remain directly accessible');
      const antigravity = row('Google Antigravity');
      const installLabel = zh ? '安装连接组件' : 'Install connection component';
      assert.equal(await antigravity.getByRole('link', { name: installLabel, exact: true }).count(), 0, 'Antigravity installation does not open a download website');
      await antigravity.getByRole('button', { name: installLabel, exact: true }).click();
      await antigravity.getByText(antigravityInstaller, { exact: true }).waitFor();
      await antigravity.getByRole('button', { name: zh ? '运行安装' : 'Run installer', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.agentSetupFixture.calls.install), ['antigravity'], 'the same host terminal installation action is used');
      await antigravity.getByText(zh ? '正在安装连接组件…完成后会自动检测。' : 'Installing the connection component… It will be detected automatically.', { exact: true }).waitFor();
      await page.evaluate(() => window.agentSetupFixture.publish('antigravity', { status: 'off', installing: undefined, path: '/agents/agy' }));
      await antigravity.getByRole('button', { name: zh ? '连接' : 'Connect', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: /More actions for|的更多操作/ }).count(), 0);
      await helpButton('Cursor').click();
      await manual().click();
      await helpDialog().waitFor();
      await helpDialog().getByRole('status').filter({ hasText: zh ? '所选文件夹中未找到 Cursor 的连接组件' : 'No Cursor connection component was found in this folder' }).waitFor();
      await closeHelp();
      await page.getByRole('status').filter({ hasText: zh ? '所选文件夹中未找到 Cursor 的连接组件' : 'No Cursor connection component was found in this folder' }).waitFor();
      assert.equal(await page.getByRole('alert').count(), 0, 'a folder without a component gets setup guidance');
      await helpButton('Cursor').click();
      await manual().click();
      await helpDialog().waitFor({ state: 'hidden' });
      await page.getByRole('status').filter({ hasText: zh ? '连接程序已就绪' : 'Connection program is ready' }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.agentSetupFixture.calls.locate), [{ id: 'cursor', kind: 'folder' }, { id: 'cursor', kind: 'folder' }], 'the single location action always opens a folder picker');
      await helpButton('Cursor').click();
      await helpDialog().getByText('D:/Custom Agent/bin/agent.cmd', { exact: true }).waitFor();
      await helpDialog().getByRole('button', { name: zh ? '重新检测' : 'Check again', exact: true }).click();
      const summary = helpDialog().locator('summary').filter({ hasText: zh ? '技术详情' : 'Technical details' });
      await summary.waitFor();
      assert.equal(await page.getByText('Agent diagnostic fixture: custom folder discovered', { exact: true }).isVisible(), false);
      await summary.click();
      assert.equal(await page.getByText('Agent diagnostic fixture: custom folder discovered', { exact: true }).isVisible(), true);
      await closeHelp();
      await helpButton('OpenCode').click();
      await page.getByText('C:/Apps/OpenCode/resources/opencode-cli.exe', { exact: true }).waitFor();
      assert.equal(await page.getByText(/Raw quota fixture/).isVisible(), false, 'raw provider errors start collapsed');
      assert.equal(await page.getByRole('button', { name: zh ? '安装连接组件' : 'Install connection component', exact: true }).count(), 0, 'a model failure does not suggest reinstalling a found agent');
      await closeHelp();
      await helpButton('DeepSeek Harness').click();
      await page.getByText('D:/Apps/DeepSeek/resources/runtime/cli/bin/dsh.cmd', { exact: true }).waitFor();
      assert.equal(await helpDialog().getByText(zh ? '当前模型需要配置凭据' : 'The current model needs credentials', { exact: true }).isVisible(), true);
      assert.equal(await page.getByText(zh ? /在 DeepSeek Harness 的模型设置中/ : /Configure credentials for the current provider in DeepSeek Harness/).isVisible(), true);
      await closeHelp();
      await page.getByRole('button', { name: zh ? '刷新检查' : 'Refresh connections', exact: true }).click();
      assert.equal(await page.getByText(zh ? '当前模型额度已用完' : 'The current model has no quota left', { exact: true }).count(), 0);
      assert.equal(await page.getByText(zh ? '当前模型需要配置凭据' : 'The current model needs credentials', { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => window.agentSetupFixture.calls.refresh), 1);
      assert.deepEqual(await page.evaluate(() => window.agentSetupFixture.calls.connect), [], 'rendering and checking setup never submit model requests or reconnect automatically');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser?.close(); await server.close(); }
});
