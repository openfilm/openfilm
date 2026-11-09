import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import shellConfig from '../shell/vite.config.ts';

test('Settings allows cancelling sign-in and restores the login button on terminal-close updates', { timeout: 60_000 }, async () => {
  const server = await createServer({
    ...shellConfig, configFile: false, root: fileURLToPath(new URL('..', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
    plugins: [...shellConfig.plugins, {
      name: 'agent-sign-in-ui-fixture',
      configureServer(app) {
        app.middlewares.use('/agent-sign-in-ui', (_req, res, next) => {
          res.setHeader('content-type', 'text/html');
          void app.transformIndexHtml('/agent-sign-in-ui', '<!doctype html><html><body><div id="root"></div><script type="module" src="/bench/agent-sign-in.tsx"></script></body></html>')
            .then((html) => res.end(html), next);
        });
      },
    }],
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    for (const locale of ['en', 'zh-CN']) {
      const page = await browser.newPage({ viewport: { width: 960, height: 440 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript((locale) => {
        localStorage.setItem('openfilm.language', locale);
        let agents = [{ id: 'qwen', name: 'Qwen Code', shown: true, status: 'waiting' }];
        const listeners = new Set();
        const calls = { cancel: 0, connect: 0, disconnect: 0 };
        const publish = (status) => {
          agents = [{ ...agents[0], status }];
          for (const listener of listeners) listener(agents);
        };
        window.openfilmHost = { version: 1, agents: {
          list: async () => agents,
          connect: async () => { calls.connect++; publish('waiting'); return { ok: true }; },
          cancelSignIn: async () => { calls.cancel++; publish('sign-in'); return { ok: true }; },
          disconnect: async () => { calls.disconnect++; publish('off'); },
          setShown: async () => {},
          onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        } };
        window.agentSignInUiFixture = { closed: () => publish('sign-in'), calls };
      }, locale);
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/agent-sign-in-ui`);
      const cancel = page.getByRole('button', { name: locale === 'en' ? 'Cancel' : '取消', exact: true });
      const login = page.getByRole('button', { name: locale === 'en' ? 'Connect' : '连接', exact: true });
      await cancel.click();
      await login.waitFor();
      assert.equal(await login.isEnabled(), true);
      assert.deepEqual(await page.evaluate(() => window.agentSignInUiFixture.calls), { cancel: 1, connect: 0, disconnect: 0 });
      await login.click();
      await cancel.waitFor();
      await page.evaluate(() => window.agentSignInUiFixture.closed());
      await login.waitFor();
      assert.equal(await login.isEnabled(), true, 'terminal-close state updates restore an enabled login button');
      assert.equal(await cancel.count(), 0);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});
