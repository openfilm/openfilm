import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import shellConfig from '../shell/vite.config.ts';

test('agent update help checks versions, queues a busy update and shows newly discovered models; five locales', { timeout: 90_000 }, async () => {
  const server = await createServer({ ...shellConfig, configFile: false, root: fileURLToPath(new URL('..', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
    plugins: [...shellConfig.plugins, { name: 'updates-fixture', configureServer(app) {
      app.middlewares.use('/agent-updates-ui', (_req, res, next) => {
        res.setHeader('content-type', 'text/html');
        void app.transformIndexHtml('/agent-updates-ui', '<!doctype html><html><body><div id="root"></div><script type="module" src="/bench/agent-sign-in.tsx"></script></body></html>').then(html => res.end(html), next);
      });
    } }],
  });
  let browser;
  try {
    await server.listen(); browser = await chromium.launch({ headless: true });
    for (const locale of ['en', 'zh-CN', 'es', 'ja', 'ko']) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 740 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(locale => {
        localStorage.setItem('openfilm.language', locale);
        const listeners = new Set(), calls = [];
        let agents = [
          { id: 'claude', name: 'Claude Code', shown: true, status: 'ready', path: '/Users/test/.local/bin/claude',
            update: { status: 'available', version: '2.1.308', latestVersion: '2.1.311', checkedAt: Date.now(), action: { kind: 'command', command: "'/Users/test/.local/bin/claude' update" } },
            catalog: { models: [{ id: 'old', name: 'Previous model', shown: true }] } },
          { id: 'codex', name: 'Codex', shown: true, status: 'ready', path: '/Applications/Codex.app/Contents/Resources/codex',
            update: { status: 'unknown', version: '0.166.0', error: 'Version service answered 503.', action: { kind: 'link', url: 'https://chatgpt.com/download/' } } },
          { id: 'openfilm', name: 'OpenFilm', shown: true, status: 'ready', update: { status: 'managed', version: '0.3.2', action: { kind: 'desktop' } } },
        ];
        const publish = (id, status) => { agents = agents.map(a => a.id === id ? { ...a, update: { ...a.update, status } } : a); listeners.forEach(fn => fn(agents)); };
        window.agentUpdatesFixture = { calls, publish, finish: () => {
          agents = agents.map(a => a.id === 'claude' ? { ...a, update: { ...a.update, status: 'current', version: '2.1.311' },
            catalog: { models: [{ id: 'new', name: 'New model after update', shown: true }] } } : a); listeners.forEach(fn => fn(agents));
        } };
        window.openfilmHost = { version: 1, agents: {
          list: async () => agents, refresh: async () => agents, connect: async () => ({ ok: true }), disconnect: async () => {}, setShown: async () => {},
          onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
          checkUpdates: async id => { calls.push(['check', id ?? 'all']); listeners.forEach(fn => fn(agents)); return agents; },
          update: async id => { calls.push(['update', id]); if (id === 'claude') publish(id, 'queued'); return { ok: true }; },
          saveAgentModels: async () => ({ ok: true }), refreshModels: async () => {},
        } };
      }, locale);
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/agent-updates-ui`);
      const all = { en: 'Check all updates', 'zh-CN': '检查全部更新', es: 'Buscar todas las actualizaciones', ja: 'すべての更新を確認', ko: '모든 업데이트 확인' }[locale];
      await page.getByRole('button', { name: all, exact: true }).waitFor({ timeout: 10000 }).catch(async e => { throw new Error(JSON.stringify({ locale, errors, text: await page.locator('body').innerText(), original: e.message })); });
      await page.getByRole('button', { name: all, exact: true }).click();
      await page.getByRole('button', { name: /Claude Code/ }).click();
      const dialog = page.getByRole('dialog'), section = dialog.locator('section').first();
      await section.getByText("'/Users/test/.local/bin/claude' update", { exact: true }).waitFor();
      await section.getByText(/2\.1\.308/).waitFor();
      await section.getByRole('button').nth(0).click();
      assert.deepEqual(await page.evaluate(() => window.agentUpdatesFixture.calls), [['check', 'all'], ['check', 'claude']]);
      await section.getByRole('button').nth(1).click();
      assert.equal(await section.getByRole('button').first().isDisabled(), true, 'queued updates cannot be launched twice');
      await page.evaluate(() => window.agentUpdatesFixture.publish('claude', 'updating'));
      await page.evaluate(() => window.agentUpdatesFixture.finish());
      await dialog.getByText('New model after update', { exact: true }).waitFor();
      assert.equal(await section.getByText('2.1.311', { exact: true }).count(), 2);
      assert.equal(await section.getByRole('button').count(), 1, 'verified current version no longer offers an upgrade');
      if (process.env.OPENFILM_UPDATES_PREVIEW) await page.screenshot({ path: `${process.env.OPENFILM_UPDATES_PREVIEW}-${locale}.png`, fullPage: true });
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /Codex/ }).click();
      await dialog.getByRole('alert').filter({ hasText: 'Version service answered 503.' }).waitFor();
      assert.equal(await dialog.getByText('0.166.0', { exact: true }).isVisible(), true);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser?.close(); await server.close(); }
});
