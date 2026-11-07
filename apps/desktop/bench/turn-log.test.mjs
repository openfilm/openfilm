/** The turn log through the real component, with tens of thousands of events: only the lines in view are drawn, and a running turn's log is read on from where it stopped. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import shellConfig from '../shell/vite.config.ts';

test('a log of 50,000 events opens at once with only its lines in view drawn, scrolls to its end, opens a line in place, and a running turn is read on from where it stopped', { timeout: 90_000 }, async () => {
  const server = await createServer({
    ...shellConfig, configFile: false, root: fileURLToPath(new URL('..', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
    plugins: [...shellConfig.plugins, {
      name: 'turn-log-fixture',
      configureServer(app) {
        app.middlewares.use('/turn-log', (_req, res, next) => {
          res.setHeader('content-type', 'text/html');
          void app.transformIndexHtml('/turn-log', '<!doctype html><html><body><div id="root"></div><script type="module" src="/bench/turn-log.tsx"></script></body></html>')
            .then((html) => res.end(html), next);
        });
      },
    }],
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const base = `http://127.0.0.1:${server.httpServer.address().port}/turn-log`;
    const list = page.locator('[data-turn-log-events]');
    const lines = list.locator('button');

    await page.goto(`${base}?n=50000`);
    await page.getByRole('button', { name: 'Log' }).click();
    const dialog = page.getByRole('dialog');
    /* the picture a request carried, as the log keeps it */
    await dialog.getByRole('button', { name: /#2/ }).click();
    await dialog.getByText('Picture · image/png · 3400k bytes · .film/logs/images/0a1b.png').waitFor();

    await dialog.getByRole('button', { name: '50000 events' }).click();
    await dialog.getByLabel('Join text pieces').uncheck();
    await lines.first().waitFor();
    const drawn = await lines.count();
    assert.ok(drawn > 20 && drawn < 120, `only the lines in view and a few past it are drawn: ${drawn}`);
    assert.ok(await list.evaluate((el) => el.scrollHeight) >= 50_000 * 26, 'the list is as tall as every line');

    await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await list.getByText('thought 49999', { exact: false }).waitFor();
    assert.ok(await lines.count() < 120, 'scrolled, still only the lines in view');

    /* a line opened shows its event and pushes the ones after it down */
    const line = lines.filter({ hasText: 'thought 49990' });
    await line.click();
    const open = await line.locator('xpath=..').boundingBox();
    const next = await lines.filter({ hasText: 'thought 49991' }).boundingBox();
    assert.ok(open.height > 60, `opened: ${open.height}`);
    assert.ok(next.y >= open.y + open.height - 1, 'the next line is below the opened one');

    /* a running turn: each read adds 2,000 events; only what is new comes, and the end stays in view */
    await page.goto(`${base}?n=20000&grow=2000&live`);
    await page.getByRole('button', { name: 'Log' }).click();
    await dialog.getByRole('button', { name: '20000 events' }).click();
    await dialog.getByLabel('Join text pieces').uncheck();
    await lines.first().waitFor();
    await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await dialog.getByRole('button', { name: '24000 events' }).waitFor({ timeout: 15_000 });
    const reads = await page.evaluate(() => window.turnLogFixture.reads);
    assert.equal(reads[0].since, null, 'opened: the log, whole');
    assert.ok(reads.length >= 3 && reads.slice(1).every((r) => r.since && r.events === 2000), `then only what is new: ${JSON.stringify(reads.slice(0, 4))}`);
    await list.getByText(`thought ${await page.evaluate(() => window.turnLogFixture.count()) - 1}`, { exact: false }).waitFor();
    assert.ok(await lines.count() < 120);

    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});
