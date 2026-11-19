/** Pixel-level regression for tool completion and turn completion: no model requests or Electron required. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import shellConfig from '../shell/vite.config.ts';

test('activity rows and the hover toolbar stay aligned as the conversation changes', { timeout: 60_000 }, async () => {
  const server = await createServer({
    ...shellConfig, configFile: false, root: fileURLToPath(new URL('..', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
    plugins: [...shellConfig.plugins, {
      name: 'activity-layout-fixture',
      configureServer(app) {
        app.middlewares.use('/activity-layout', (_req, res, next) => {
          res.setHeader('content-type', 'text/html');
          void app.transformIndexHtml('/activity-layout', '<!doctype html><html><body><div id="root"></div><script type="module" src="/bench/activity-layout.tsx"></script></body></html>')
            .then((html) => res.end(html), next);
        });
      },
    }],
  });
  let browser;
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    browser = await chromium.launch({ headless: true });
    for (const config of [
      { locale: 'zh-CN', width: 440, height: 620, above: 0 },
      { locale: 'en', width: 320, height: 280, above: 600 },
    ]) {
      const page = await browser.newPage({ viewport: { width: 800, height: 800 }, reducedMotion: 'reduce' });
      await page.addInitScript(() => {
        window.openfilmDesktop = { developer: { get: async () => ({ logs: false, changes: false }), onChange: () => () => {} } };
      });
      await page.goto(`http://127.0.0.1:${port}/activity-layout?${new URLSearchParams({ scenario: 'working-command', ...config })}`);
      await page.waitForFunction(() => Boolean(window.activityFixture));
      const status = page.getByRole('status').filter({ hasText: config.locale === 'zh-CN' ? '正在处理' : 'Working' });
      const tool = page.locator('[data-activity-id="after"][aria-busy="true"]');
      const summary = page.locator('[data-activity-id="command-0"]');
      const geometry = async (row) => {
        await row.locator('.tabular-nums').waitFor({ timeout: 5_000 }).catch(async (error) => {
          throw new Error(`${error.message}\n${await page.locator('body').innerText()}`);
        });
        return row.evaluate((node) => {
          const label = node.querySelector('[data-activity-label]');
          const { x, y } = label.getBoundingClientRect();
          const { y: clockY, right } = node.querySelector('.tabular-nums').getBoundingClientRect();
          const { top, height } = node.getBoundingClientRect();
          const { fontSize, fontWeight, lineHeight } = getComputedStyle(label);
          return { top, height, x, y, clockY, right, fontSize, fontWeight, lineHeight };
        });
      };
      const { x: statusLeft, ...before } = await geometry(status);
      const summaryBox = await summary.boundingBox();
      assert.equal(statusLeft, (await summary.locator('svg').first().boundingBox()).x, 'processing starts at the summary icon edge');
      await page.evaluate(() => window.activityFixture.addTool());
      const { x: toolLabelLeft, ...during } = await geometry(tool);
      assert.equal((await tool.locator('svg').boundingBox()).x, statusLeft, 'the command icon starts at the same left edge');
      assert.equal(toolLabelLeft, (await summary.locator('[data-activity-label]').boundingBox()).x, 'command labels follow their icons');
      assert.deepEqual(during, before, 'running a command keeps the vertical position, timer and typography');
      assert.deepEqual(await summary.boundingBox(), summaryBox, 'the completed tool group remains above the active row');
      await page.evaluate(() => window.activityFixture.finishTool());
      assert.deepEqual(await geometry(status), { x: statusLeft, ...before }, 'processing returns to the same row after the command completes');
      assert.deepEqual(await summary.boundingBox(), summaryBox, 'updating the tool count leaves its position alone');
      await page.close();
    }
    const configs = ['en', 'zh-CN'].flatMap((locale) => ['single', 'group', 'counts'].flatMap((scenario) => [
      { width: 440, height: 620, above: 0, locale, scenario },
      { width: 320, height: 280, above: 600, locale, scenario },
    ]));
    for (const config of configs) {
      const page = await browser.newPage({ viewport: { width: 800, height: 800 }, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(() => {
        window.openfilmDesktop = { developer: { get: async () => ({ logs: false, changes: false }), onChange: () => () => {} } };
      });
      await page.goto(`http://127.0.0.1:${port}/activity-layout?${new URLSearchParams(config)}`);
      await page.waitForFunction(() => Boolean(window.activityFixture), null, { timeout: 10_000 }).catch((error) => {
        throw new Error(`${error.message}; page errors: ${JSON.stringify(errors)}`);
      });
      const answer = page.getByText('Final answer anchor.', { exact: true });
      await answer.waitFor({ state: 'visible' });
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const header = page.locator(`[data-activity-id="${config.scenario === 'single' ? 'command' : config.scenario === 'counts' ? 'edit-0' : 'check'}"]`);
      const pending = page.locator(`[data-activity-id="${{ single: 'command', group: 'search', counts: 'edit-8' }[config.scenario]}"]`);
      assert.equal(await pending.getAttribute('aria-busy'), 'true', 'the running tool is already in its conversation row');
      assert.equal(await page.getByRole('status', { includeHidden: true }).count(), 0, 'an inline tool does not leave a duplicate or empty status row');
      await header.evaluate((node) => { node.dataset.probe = 'preserved'; });
      const footer = page.locator('[data-turn-footer]').last();
      await answer.hover();
      await page.waitForFunction(() => getComputedStyle([...document.querySelectorAll('[data-turn-footer]')].at(-1)).opacity === '1');
      const footerGap = async () => {
        const reply = await answer.boundingBox();
        return (await footer.boundingBox()).y - reply.y - reply.height;
      };
      assert.ok(await footerGap() <= 10, 'the hover actions sit directly under a streaming reply, without an empty status row');
      const snapshot = () => header.evaluate((node) => {
        const box = (element, fixed = true) => {
          if (!element) return null;
          const { x, y, width, height } = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return { ...(fixed ? { x, y, width, height } : { y, height }), fontSize: style.fontSize, lineHeight: style.lineHeight,
            fontFamily: style.fontFamily, fontWeight: style.fontWeight, color: style.color,
            padding: style.padding, gap: style.gap };
        };
        return { row: box(node), label: box(node.querySelector('[data-activity-label]'), false),
          detail: box(node.querySelector('span[title]'), false),
          icon: box(node.querySelector('svg') ?? node.parentElement.previousElementSibling) };
      });
      const runningStyle = await snapshot();
      const runningLabel = await header.innerText();
      const beforeTool = await answer.boundingBox();
      const pendingHeight = (await pending.boundingBox()).height;
      await page.evaluate(() => window.activityFixture.finishTool());
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      if (config.scenario === 'single') assert.equal(await header.getAttribute('aria-busy'), 'false');
      else assert.equal(await pending.count(), 0, 'the finished tool joins the collapsed summary');
      assert.equal(await header.getAttribute('data-probe'), 'preserved', 'the tool keeps the same DOM node on completion');
      assert.notEqual(await header.innerText(), runningLabel, 'the label changes to completed without changing its style');
      assert.deepEqual(await snapshot(), runningStyle, `tool row position, height and typography stay identical: ${JSON.stringify(config)}`);
      if (config.scenario === 'counts') {
        assert.equal(await header.locator('[data-activity-label]').textContent(), config.locale === 'zh-CN'
          ? '已编辑文件 ×9 · 已运行命令 · 已读取文件'
          : 'Edited files ×9 · Ran a command · Read files', 'counts and separators follow visible labels with normal spaces');
        assert.equal(await header.locator('.invisible').count(), 0, 'no hidden label reserves extra spacing before the count');
      }
      const replyShift = (await answer.boundingBox()).y - beforeTool.y;
      if (config.scenario === 'single') assert.ok(Math.abs(replyShift) <= 1, 'finishing an isolated tool preserves the reply position');
      else assert.ok(replyShift <= 1, 'a tool joining the summary can only make the reply move up');
      assert.equal((await header.boundingBox()).height, pendingHeight, 'tool rows and summaries have the same header height');
      const before = await answer.boundingBox();
      await page.evaluate(() => window.activityFixture.finish());
      await page.getByRole('status').waitFor({ state: 'hidden' });
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const after = await answer.boundingBox();
      assert.ok(Math.abs(after.y - before.y) <= 1, `reply moved ${after.y - before.y}px at width ${config.width}`);
      assert.ok(await footerGap() <= 10, 'the finished reply keeps the same compact footer spacing');
      assert.equal(await page.getByText('I will check the project first.', { exact: true }).count(), 1, 'the turn just watched stays open when it finishes');
      await page.evaluate(() => window.activityFixture.next());
      await page.getByText('Continue.', { exact: true }).waitFor();
      assert.equal(await page.getByText('I will check the project first.', { exact: true }).count(), 0, 'earlier turns stay folded when a new turn starts');
      assert.equal(await page.locator('[data-activity-header]').count(), 0, 'earlier steps fold into the Worked line');
      assert.deepEqual(errors, []);
      await page.close();
    }
    for (const locale of ['en', 'zh-CN']) {
      const page = await browser.newPage({ viewport: { width: 800, height: 800 }, reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(() => {
        window.openfilmDesktop = { developer: { get: async () => ({ logs: false, changes: false }), onChange: () => () => {} } };
      });
      await page.goto(`http://127.0.0.1:${port}/activity-layout?${new URLSearchParams({ scenario: 'asset', width: 440, height: 620, locale })}`);
      await page.waitForFunction(() => Boolean(window.activityFixture));
      const row = page.locator('button[data-activity-id="image"]');
      await row.waitFor({ state: 'visible' });
      await row.click();
      await page.waitForFunction(() => [...document.querySelectorAll('img')].some((image) => image.getBoundingClientRect().height > 0));
      await row.evaluate((node) => { node.dataset.probe = 'preserved'; });
      const pictures = () => page.locator('img').evaluateAll((images) => images.filter((image) => image.getBoundingClientRect().height > 0).length);
      const shown = await pictures();
      await page.evaluate(() => window.activityFixture.addTool());
      await page.locator('[data-activity-id="after"][aria-busy="true"]').waitFor();
      assert.equal(await row.getAttribute('data-probe'), 'preserved', 'a lone act that made a picture keeps its row when another act joins it');
      assert.equal(await pictures(), shown, `a picture shown in a live turn never disappears when another act joins: ${locale}`);
      assert.equal(await row.getAttribute('aria-expanded'), 'true', 'the tool group stays open');
      assert.deepEqual(errors, []);
      await page.close();
    }
    for (const config of [
      { scenario: 'idle', width: 440, touch: false },
      { scenario: 'thinking', width: 320, touch: false },
      { scenario: 'thinking', width: 320, touch: true },
    ]) {
      const page = await browser.newPage({
        viewport: { width: 800, height: 800 }, reducedMotion: 'reduce', hasTouch: config.touch, isMobile: config.touch,
      });
      await page.addInitScript(() => {
        window.openfilmDesktop = { developer: { get: async () => ({ logs: false, changes: false }), onChange: () => () => {} } };
      });
      await page.goto(`http://127.0.0.1:${port}/activity-layout?${new URLSearchParams({ ...config, height: 620, locale: 'zh-CN' })}`);
      await page.waitForFunction(() => Boolean(window.activityFixture));
      const status = page.getByRole('status');
      const footer = page.locator('[data-turn-footer]');
      await status.waitFor({ state: 'visible' });
      const before = await status.boundingBox();
      const label = await status.locator('.text-sweep').innerText();
      await footer.hover();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-turn-footer]')).opacity === '1');
      assert.equal(await status.evaluate((node) => {
        for (let element = node; element; element = element.parentElement) {
          const style = getComputedStyle(element);
          if (style.opacity === '0' || style.display === 'none' || style.visibility === 'hidden') return false;
        }
        return true;
      }), true, 'hovering the complete toolbar does not hide the status');
      assert.equal(await status.locator('.text-sweep').innerText(), label);
      assert.equal(await status.locator('.tabular-nums').count(), 1, 'the status keeps its timer while hovering');
      assert.deepEqual(await status.boundingBox(), before, 'hovering never replaces or moves the status');
      const statusBox = await status.boundingBox();
      const footerBox = await footer.boundingBox();
      assert.ok(footerBox.y >= statusBox.y + statusBox.height, 'the toolbar has its own row below the status');
      assert.ok(footerBox.y - statusBox.y - statusBox.height <= 8, 'the two rows stay close together');
      assert.equal(await footer.getByText('Auto', { exact: true }).isVisible(), true, 'the full model label remains visible');
      const modelBox = await footer.getByText('Auto', { exact: true }).boundingBox();
      assert.ok(modelBox.x + modelBox.width <= footerBox.x + footerBox.width, 'the model label fits within the toolbar');
      if (config.scenario === 'thinking') {
        assert.equal(await footer.getByRole('button', { name: '复制回复', exact: true }).isVisible(), true, 'the copy button remains available below the status');
        const answer = page.getByText('Final answer anchor.', { exact: true });
        const replyBefore = await answer.boundingBox();
        await page.evaluate(() => window.activityFixture.finishTool());
        await page.getByRole('status', { includeHidden: true }).waitFor({ state: 'detached' });
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        const replyAfter = await answer.boundingBox();
        assert.ok(Math.abs(replyBefore.y - replyAfter.y) <= 1, 'removing an empty status does not move the reply');
        assert.ok((await footer.boundingBox()).y - replyAfter.y - replyAfter.height <= 10, 'an empty status leaves no spare line above the toolbar');
      }
      await page.close();
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});
