import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import shellConfig from '../shell/vite.config.ts';

test('Advanced library categories reorder live, save once per gesture and keep Media pinned', { timeout: 60_000 }, async () => {
  const server = await createServer({ ...shellConfig, configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
    plugins: [...shellConfig.plugins, { name: 'settings-reorder-fixture', configureServer(app) {
      app.middlewares.use('/settings-reorder-ui', (_req, res, next) => {
        res.setHeader('content-type', 'text/html');
        void app.transformIndexHtml('/settings-reorder-ui', '<!doctype html><html><body><div id="root"></div><script type="module" src="/bench/settings-reorder.tsx"></script></body></html>')
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
      const page = await browser.newPage({ viewport: { width: 1100, height: 940 } });
      const errors = [];
      const saved = [];
      let prefs = { libraryCategories: null };
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript((lang) => { localStorage.setItem('openfilm.language', lang); }, locale);
      await page.route('**/api/prefs', async (route) => {
        if (route.request().method() === 'PATCH') {
          const patch = route.request().postDataJSON();
          saved.push(patch);
          prefs = { ...prefs, ...patch };
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(prefs) });
      });
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/settings-reorder-ui`);
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
      const list = page.getByRole('list', { name: zh ? '素材库类别' : 'Library categories' });
      const rows = list.locator('[data-library-category]');
      const order = () => rows.evaluateAll((items) => items.map((item) => item.dataset.libraryCategory));
      const patchResponse = () => page.waitForResponse((res) => res.url().endsWith('/api/prefs') && res.request().method() === 'PATCH');
      await rows.nth(11).waitFor({ timeout: 10_000 });
      const initial = await order();
      assert.equal(initial[0], 'media');
      assert.equal(await rows.first().locator('button').count(), 2, 'the same grip and switch layout as model settings');
      assert.equal(await rows.first().locator('button:disabled').count(), 2, 'Media cannot be moved or hidden');
      assert.equal(await list.getByRole('button', { name: /^(Move .* (up|down)|上移|下移)/ }).count(), 0);
      const beginDrag = async (id, to) => {
        await rows.evaluateAll((items) => Promise.all(items.flatMap((item) => item.getAnimations()).map((animation) => animation.finished.catch(() => {}))));
        const source = list.locator(`[data-library-category="${id}"] button[draggable="true"]`);
        const from = (await order()).indexOf(id);
        const start = await source.boundingBox();
        const target = await rows.nth(to).boundingBox();
        await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
        await page.mouse.down();
        await page.mouse.move(start.x + start.width / 2 + 6, start.y + start.height / 2 + 6);
        const x = target.x + 80, y = target.y + target.height * (from < to ? 0.8 : 0.2);
        await page.mouse.move(x, y, { steps: 16 });
        await page.mouse.move(x + 1, y);
        await page.waitForFunction(({ id, to }) => document.querySelectorAll('[data-library-category]')[to]?.getAttribute('data-library-category') === id, { id, to }, { timeout: 3000 });
      };
      await beginDrag('transition', 2);
      assert.equal((await order())[2], 'transition', 'the pointer is still held down while the rows change');
      assert.equal(saved.length, 0, 'drag previews do not race prefs writes');
      let response = patchResponse();
      await page.mouse.up();
      await response;
      assert.equal(saved.length, 1, 'a completed drag persists once');
      assert.deepEqual(saved[0].libraryCategories.order, (await order()).slice(1));
      assert.deepEqual(saved[0].libraryCategories.off, []);
      assert.equal((await order())[0], 'media');

      response = patchResponse();
      await list.locator('[data-library-category="transition"] button[draggable="true"]').press('ArrowDown');
      await response;
      assert.equal((await order())[3], 'transition', 'keyboard reordering uses the same control');
      const count = saved.length;
      const kept = await order();
      await list.locator(`[data-library-category="${kept[1]}"] button[draggable="true"]`).press('ArrowUp');
      assert.deepEqual(await order(), kept, 'keyboard movement cannot cross the pinned first row');
      assert.equal(saved.length, count);

      await beginDrag('transition', 5);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await page.waitForFunction((before) => JSON.stringify([...document.querySelectorAll('[data-library-category]')].map((item) => item.getAttribute('data-library-category'))) === JSON.stringify(before), kept);
      assert.equal(saved.length, count, 'cancelling a drag restores its preview without saving');

      response = patchResponse();
      await list.locator('[data-library-category="template"]').getByRole('switch').click();
      await response;
      assert.deepEqual(saved.at(-1).libraryCategories.off, ['template']);
      assert.deepEqual(saved.at(-1).libraryCategories.order, kept.slice(1));
      await page.reload();
      await rows.nth(11).waitFor();
      await page.waitForFunction((expected) => JSON.stringify([...document.querySelectorAll('[data-library-category]')].map((item) => item.getAttribute('data-library-category'))) === JSON.stringify(expected), kept);
      assert.equal(await list.locator('[data-library-category="template"]').getByRole('switch').getAttribute('aria-checked'), 'false');
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
      await rows.evaluateAll((items) => Promise.all(items.flatMap((item) => item.getAnimations()).map((animation) => animation.finished.catch(() => {}))));
      await page.screenshot({ path: `/tmp/openfilm-library-reorder-${locale}.png`, fullPage: true });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser?.close(); await server.close(); }
});
