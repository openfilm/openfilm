import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import shellConfig from '../shell/vite.config.ts';
import { OPENFILM_MODELS } from '../src/openfilm-models.mjs';

test('OpenFilm follows Claude under Your agents, shares account actions and never offers CLI setup', { timeout: 60_000 }, async () => {
  const server = await createServer({ ...shellConfig, configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
    plugins: [...shellConfig.plugins, { name: 'openfilm-agent-fixture', configureServer(app) {
      app.middlewares.use('/openfilm-agent-ui', (_req, res, next) => {
        res.setHeader('content-type', 'text/html');
        void app.transformIndexHtml('/openfilm-agent-ui', '<!doctype html><html><body><div id="root"></div><script type="module" src="/bench/openfilm-models.tsx"></script></body></html>')
          .then((html) => res.end(html), next);
      });
    } }],
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    for (const locale of ['en', 'zh-CN']) {
      const zh = locale === 'zh-CN';
      const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(({ locale, models }) => {
        localStorage.setItem('openfilm.language', locale);
        localStorage.setItem('openfilm.local-agents.v2', JSON.stringify({ picked: 'openfilm', prefs: {}, options: { openfilm: [{ id: 'model', category: 'model', name: 'Model', currentValue: 'xiaomi/mimo-v2.6-flash', options: [{ value: 'xiaomi/mimo-v2.6-flash', name: 'MiMo V2.6 Flash' }] }] } }));
        const modelSettings = { order: models.map((m) => m.id), defaultOrder: models.map((m) => m.id), hidden: [], model: models.at(-1).id,
          models: models.map((m) => ({ ...m, shown: true, available: true, levels: ['low', 'high'], effort: 'high' })) };
        let agents = [
          { id: 'codex', name: 'Codex', shown: true, status: 'ready' },
          { id: 'openfilm', name: 'OpenFilm', shown: true, status: 'sign-in', signOut: true, openfilm: modelSettings },
          { id: 'claude', name: 'Claude Code', shown: true, status: 'sign-in' },
          { id: 'byok', name: 'Own key', shown: false, status: 'key' },
        ];
        const listeners = new Set();
        const calls = [];
        const saved = [];
        const publish = (patch) => {
          agents = agents.map((a) => a.id === 'openfilm' ? { ...a, ...patch } : a);
          for (const listener of listeners) listener(agents);
        };
        window.openfilmHost = { version: 1, agents: {
          list: async () => agents,
          connect: async (id) => { calls.push(['connect', id]); publish({ status: 'waiting' }); return { ok: true }; },
          cancelSignIn: async (id) => { calls.push(['cancel', id]); publish({ status: 'sign-in' }); return { ok: true }; },
          disconnect: async (id) => { calls.push(['disconnect', id]); publish({ status: 'sign-in', account: null }); return { ok: true }; },
          switchAccount: async (id) => { calls.push(['switch', id]); publish({ status: 'waiting', account: null }); return { ok: true }; },
          setShown: async (id, shown) => { calls.push(['shown', id, shown]); publish({ shown }); },
          saveOpenFilmModels: async (config) => {
            saved.push(config);
            publish({ configurationRevision: saved.length, openfilm: { ...modelSettings, ...config,
              models: config.order.map((id) => ({ ...modelSettings.models.find((m) => m.id === id), shown: !config.hidden.includes(id) })) } });
            return { ok: true };
          },
          onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        } };
        window.openfilmDesktop = { agents: window.openfilmHost.agents, localAgents: { probe: async () => { throw new Error('the model catalog is already known'); } } };
        window.openfilmAgentFixture = { calls, publish, saved, available: (ids) => publish({ openfilm: { ...modelSettings,
          models: modelSettings.models.map((m) => ({ ...m, available: ids.includes(m.id) })) } }) };
      }, { locale, models: OPENFILM_MODELS });
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/openfilm-agent-ui`);
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
      const row = page.locator('div.py-4').filter({ has: page.getByText('OpenFilm', { exact: true }) });
      await row.waitFor({ timeout: 10_000 }).catch(async (e) => {
        throw new Error(`${e.message}\nPage errors: ${JSON.stringify(errors)}\n${await page.locator('body').innerText()}`);
      });
      assert.deepEqual(await page.locator('div.py-4').evaluateAll((rows) => rows.slice(0, 3).map((r) => r.querySelector('span[class~="text-[15px]"]')?.textContent)), ['Codex', 'Claude Code', 'OpenFilm']);
      assert.equal(await row.getByRole('button', { name: /Connection help|连接帮助/ }).count(), 0);
      assert.doesNotMatch(await row.innerText(), /与服务商共享账号和余额|Same account and balance as Services/);
      const login = row.getByRole('button', { name: zh ? '连接' : 'Connect', exact: true });
      const cancel = row.getByRole('button', { name: zh ? '取消' : 'Cancel', exact: true });
      await login.click();
      await cancel.click();
      await login.waitFor();
      await page.evaluate(() => window.openfilmAgentFixture.publish({ status: 'ready', account: { method: 'other', email: 'shared@example.com' } }));
      await row.getByText(/shared@example.com/).waitFor();
      const info = row.getByRole('button', { name: zh ? 'OpenFilm 信息与模型' : 'OpenFilm info and models', exact: true });
      await info.click();
      const dialog = page.getByRole('dialog', { name: 'OpenFilm', exact: true });
      const rows = dialog.locator('li[data-model-id]');
      assert.deepEqual(await rows.evaluateAll((items) => items.map((item) => item.dataset.modelId)), OPENFILM_MODELS.map((m) => m.id));
      assert.match(await dialog.innerText(), zh ? /与服务商共享账号和余额/ : /Same account and balance as Services/);
      await page.screenshot({ path: `/tmp/openfilm-models-default-${locale}.png`, fullPage: true });
      assert.equal(await dialog.getByRole('button', { name: /^(Move .* (up|down)|上移|下移)/ }).count(), 0, 'there are no redundant arrow buttons');
      const dragLive = async (name, index) => {
        await rows.evaluateAll((items) => Promise.all(items.flatMap((item) => item.getAnimations()).map((animation) => animation.finished.catch(() => {}))));
        const handle = dialog.getByRole('button', { name: zh ? `调整 ${name} 的顺序` : `Reorder ${name}`, exact: true });
        await handle.scrollIntoViewIfNeeded();
        const start = await handle.boundingBox();
        const id = OPENFILM_MODELS.find((m) => m.name === name).id;
        const before = await rows.evaluateAll((items) => items.map((item) => item.dataset.modelId));
        const from = before.indexOf(id);
        const end = await rows.nth(index).boundingBox();
        await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
        await page.mouse.down();
        await page.mouse.move(start.x + start.width / 2 + 6, start.y + start.height / 2 + 6);
        await page.mouse.move(end.x + 80, end.y + end.height * (from < index ? 0.8 : 0.2), { steps: 12 });
        await page.mouse.move(end.x + 81, end.y + end.height * (from < index ? 0.8 : 0.2));
        await page.waitForFunction(({ id, index }) => document.querySelectorAll('dialog li[data-model-id]')[index]?.getAttribute('data-model-id') === id, { id, index }, { timeout: 3000 });
        assert.equal((await rows.evaluateAll((items) => items.map((item) => item.dataset.modelId)))[index], id, 'rows move while the mouse is still held down');
        await page.mouse.up();
      };
      await dragLive('Claude Opus 5.5', 1);
      await dialog.getByRole('switch', { name: zh ? '在对话中显示 GPT-6 Luna' : 'Show GPT-6 Luna in chat', exact: true }).click();
      await dragLive('DeepSeek V4.1 Flash', 1);
      await rows.evaluateAll((items) => Promise.all(items.flatMap((item) => item.getAnimations()).map((animation) => animation.finished.catch(() => {}))));
      await page.screenshot({ path: `/tmp/openfilm-models-${locale}.png`, fullPage: true });
      const expectedOrder = await rows.evaluateAll((items) => items.map((item) => item.dataset.modelId));
      assert.equal(expectedOrder[0], 'anthropic/claude-sonnet-5.5');
      assert.equal(expectedOrder[1], 'deepseek/deepseek-v4.1-flash-1017');
      await dialog.getByRole('button', { name: zh ? '保存' : 'Save', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.deepEqual(await page.evaluate(() => window.openfilmAgentFixture.saved.at(-1)), { order: expectedOrder, hidden: ['openai/gpt-6-luna'] });
      await page.locator('[data-model-picker] button').first().click();
      await page.getByRole('button', { name: /^(Model|模型) DeepSeek V4\.1 Flash$/ }).hover();
      const menu = page.getByRole('button', { name: 'Claude Sonnet 5.5', exact: true }).locator('..');
      await menu.getByRole('button', { name: 'Claude Sonnet 5.5', exact: true }).waitFor();
      assert.deepEqual(await menu.getByRole('button').allTextContents(), expectedOrder.filter((id) => id !== 'openai/gpt-6-luna').map((id) => OPENFILM_MODELS.find((m) => m.id === id).name));
      assert.doesNotMatch(await page.locator('body').innerText(), /MiMo|Astra|Fable/);
      await page.mouse.click(1050, 740);
      await info.click();
      assert.deepEqual(await rows.evaluateAll((items) => items.map((item) => item.dataset.modelId)), expectedOrder, 'reopening keeps the saved order');
      await dialog.getByRole('button', { name: zh ? '恢复默认顺序' : 'Reset order', exact: true }).click();
      assert.deepEqual(await rows.evaluateAll((items) => items.map((item) => item.dataset.modelId)), OPENFILM_MODELS.map((m) => m.id));
      await page.keyboard.press('Escape');
      // A temporarily old cloud catalog must not silently hide enabled models.
      await page.evaluate(() => window.openfilmAgentFixture.available(['anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5.5', 'openai/gpt-6.1-sol']));
      await page.locator('[data-model-picker] button').first().click();
      await page.getByRole('button', { name: /^(Model|模型) / }).hover();
      const partial = page.getByRole('button', { name: 'Claude Opus 5.5', exact: true }).locator('..');
      assert.equal(await partial.getByRole('button').count(), 7, 'all enabled models are listed even if the service is older');
      assert.equal(await partial.locator('button:disabled').count(), 4, 'unavailable models are explicit and cannot send invalid requests');
      assert.match(await partial.innerText(), zh ? /服务待更新/ : /Awaiting update/);
      assert.doesNotMatch(await partial.innerText(), /暂不可用|Unavailable/);
      await page.mouse.click(1050, 740);
      await info.click();
      await dialog.waitFor();
      assert.match(await dialog.innerText(), zh ? /开关控制模型是否在对话菜单中显示/ : /Switches control which models appear in chat/);
      assert.equal(await dialog.getByText(zh ? '服务待更新' : 'Awaiting update', { exact: true }).count(), 4);
      assert.equal(await dialog.locator('[role="switch"][aria-checked="true"]').count(), 7, 'service support does not turn off the visibility switches');
      await page.screenshot({ path: `/tmp/openfilm-pending-service-${locale}.png`, fullPage: true });
      await page.keyboard.press('Escape');
      await row.getByRole('switch').click();
      assert.match(await row.innerText(), /shared@example.com/, 'hiding the agent preserves the shared account');
      await row.getByRole('switch').click();
      await row.getByRole('button', { name: zh ? '切换账号' : 'Switch account', exact: true }).click();
      assert.match(await row.innerText(), zh ? /也会更换服务商使用的账号和余额/ : /also changes the account and balance used in Services/);
      await cancel.click();
      await page.screenshot({ path: `/tmp/openfilm-agent-settings-${locale}.png`, fullPage: true });
      await info.click();
      const header = dialog.locator('header');
      const savedCount = await page.evaluate(() => window.openfilmAgentFixture.saved.length);
      const accountLink = header.getByRole('link', { name: zh ? '查看账户' : 'View account', exact: true });
      assert.equal(await accountLink.getAttribute('href'), 'https://openfilm.dev/account');
      assert.match(await header.innerText(), /shared@example.com/);
      await header.getByRole('button', { name: zh ? '断开连接' : 'Disconnect', exact: true }).click();
      await header.getByRole('button', { name: zh ? '连接' : 'Connect', exact: true }).click();
      await header.getByRole('button', { name: zh ? '取消' : 'Cancel', exact: true }).click();
      await header.getByRole('button', { name: zh ? '连接' : 'Connect', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.openfilmAgentFixture.saved.length), savedCount, 'account actions do not save model preference drafts');
      await dialog.getByRole('button', { name: zh ? '关闭' : 'Close', exact: true }).click();
      await login.waitFor();
      assert.deepEqual(await page.evaluate(() => window.openfilmAgentFixture.calls), [
        ['connect', 'openfilm'], ['cancel', 'openfilm'], ['shown', 'openfilm', false], ['shown', 'openfilm', true],
        ['disconnect', 'openfilm'], ['connect', 'openfilm'], ['cancel', 'openfilm'],
      ]);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser?.close(); await server.close(); }
});
