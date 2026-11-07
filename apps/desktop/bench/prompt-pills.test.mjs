/** Pills in the real prompt editor: dragged between words with a caret showing where, one undo back, a click keeps the caret. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import shellConfig from '../shell/vite.config.ts';

test('a pill is dragged between two words, a caret shows where it lands, one undo puts it back, and a click on it keeps the caret', { timeout: 60_000 }, async () => {
  const server = await createServer({
    ...shellConfig, configFile: false, root: fileURLToPath(new URL('..', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
    plugins: [...shellConfig.plugins, {
      name: 'prompt-pills-fixture',
      configureServer(app) {
        app.middlewares.use('/prompt-pills', (_req, res, next) => {
          res.setHeader('content-type', 'text/html');
          void app.transformIndexHtml('/prompt-pills', '<!doctype html><html><body><div id="root"></div><script type="module" src="/bench/prompt-pills.tsx"></script></body></html>')
            .then((html) => res.end(html), next);
        });
      },
    }],
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 800, height: 400 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/prompt-pills`);
    const editor = page.locator('[data-prompt-editor]');
    await editor.waitFor();
    const text = () => page.evaluate(() => window.pillsFixture.text());
    const set = (value) => page.evaluate((v) => window.pillsFixture.set(v.replace(/\[([^\]]+)\]/g, (_, id) => window.pillsFixture.token(id))), value);
    const pill = (kind) => page.locator(`[data-prompt-editor] [data-pill-kind="${kind}"]`).first();
    /* the place just before a word in the editor's text */
    const before = (word) => editor.evaluate((el, w) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.parentElement?.closest('[data-lexical-decorator]')) continue;
        const i = n.textContent.indexOf(w);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        const box = r.getClientRects()[0] ?? r.getBoundingClientRect();
        return { x: box.left + 1, y: box.top + box.height / 2 };
      }
      return null;
    }, word);
    const caret = page.locator('body > div.fixed.w-\\[2px\\]');
    const drag = async (from, to, { drop = true } = {}) => {
      const box = await from.boundingBox();
      await page.mouse.move(box.x + 12, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 6, box.y + box.height / 2, { steps: 3 });
      await page.mouse.move(to.x, to.y, { steps: 12 });
      if (drop) await page.mouse.up();
    };

    await set('Put behind the title [file:assets/strip.jpg]');
    await editor.click();
    await drag(pill('file'), await before('behind'), { drop: false });
    assert.equal(await caret.count(), 1, 'a caret shows where it will land');
    await page.mouse.up();
    assert.equal(await caret.count(), 0, 'and goes once it is dropped');
    assert.equal(await text(), 'Put [file:assets/strip.jpg] behind the title ', 'between the words, one space each side');

    await page.keyboard.press('ControlOrMeta+z');
    assert.equal(await text(), 'Put behind the title [file:assets/strip.jpg]', 'one undo puts it back');

    /* against a word: a space is put in; the place it left keeps one space */
    await set('make [studio:time:4] blue now');
    await drag(pill('time'), await before('now'));
    assert.equal(await text(), 'make blue [studio:time:4] now');
    await set('把[studio:time:4]放到前面');
    await drag(pill('time'), await before('前面'));
    assert.equal(await text(), '把放到[studio:time:4]前面', 'no spaces between Chinese characters');

    /* a file let go between two words lands there, apart from both */
    await set('Put the title and as the end card');
    const at = await before('as the');
    await page.evaluate(([x, y]) => window.pillsFixture.dropAt('file:assets/strip.jpg', x - 4, y), [at.x, at.y]);
    assert.equal(await text(), 'Put the title and [file:assets/strip.jpg] as the end card');

    /* dropped right beside itself: nothing changes */
    await set('make [studio:time:4] blue');
    await drag(pill('time'), await before('blue'));
    assert.equal(await text(), 'make [studio:time:4] blue');

    /* a click leads where the pill points, and typing goes on where the caret was */
    await set('make [studio:time:4] blue');
    await editor.click();
    await page.keyboard.press('End');
    await pill('time').click();
    assert.deepEqual(await page.evaluate(() => window.pillsFixture.revealed()), ['studio:time:4']);
    await page.keyboard.type(' please');
    assert.equal(await text(), 'make [studio:time:4] blue please');
    /* the same for a pill that leads nowhere (a file) */
    await set('Put [file:assets/strip.jpg] behind the title');
    await editor.click();
    await page.keyboard.press('End');
    await pill('file').click();
    await page.keyboard.type(', and');
    assert.equal(await text(), 'Put [file:assets/strip.jpg] behind the title, and');

    /* not focused before: a click on a pill leaves the focus where it was */
    await page.locator('#elsewhere').focus();
    await pill('file').click();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'elsewhere', 'the click did not take the focus into the editor');
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.close(); }
});
