import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('with the app\'s chat, a ruler click moves the playhead and an Alt-click refers the moment', { timeout: 60_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-ruler-refer-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Ruler');
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'assets', 'card.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#486b8e"/></svg>');
    await writeFile(join(root, 'film.html'), filmHtml({
      stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'card', src: 'assets/card.svg', time: [0, 4] }] }],
    }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-US', reducedMotion: 'reduce' });
    /* the app's chat, as far as the ruler sees it: what is referred to it */
    await page.addInitScript(() => {
      window.referred = [];
      window.openfilmHost = { version: 1, refer: (ref) => window.referred.push(ref) };
    });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    await page.locator('[data-block-id]').first().waitFor({ state: 'visible' });
    const slider = page.locator('[data-timeline] [role="slider"]').first();
    const ruler = await slider.boundingBox();
    assert.ok(ruler);
    const y = ruler.y + ruler.height / 2;
    const playhead = async () => Number(await slider.getAttribute('aria-valuenow'));
    const referred = () => page.evaluate(() => window.referred);
    assert.equal(await playhead(), 0);

    /* a plain click: the playhead goes there, nothing is referred */
    await page.mouse.click(ruler.x + 200, y);
    await page.waitForFunction(() => Number(document.querySelector('[data-timeline] [role="slider"]')?.getAttribute('aria-valuenow')) > 0);
    const clicked = await playhead();
    assert.deepEqual(await referred(), []);

    /* a plain drag scrubs */
    await page.mouse.move(ruler.x + 100, y);
    await page.mouse.down();
    await page.mouse.move(ruler.x + 300, y, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction((before) => Number(document.querySelector('[data-timeline] [role="slider"]')?.getAttribute('aria-valuenow')) > before, clicked);
    const dragged = await playhead();
    assert.deepEqual(await referred(), []);

    /* the moment a click would refer is drawn only while Alt is held */
    await page.mouse.move(ruler.x + 60, y);
    assert.equal(await slider.evaluate((el) => el.style.cursor), 'col-resize');
    await page.keyboard.down('Alt');
    await page.waitForFunction(() => document.querySelector('[data-timeline] [role="slider"]')?.style.cursor === 'pointer');
    await page.keyboard.up('Alt');
    await page.waitForFunction(() => document.querySelector('[data-timeline] [role="slider"]')?.style.cursor === 'col-resize');

    /* an Alt-click refers that moment, an Alt-drag that span; the playhead stays */
    await page.keyboard.down('Alt');
    await page.mouse.click(ruler.x + 60, y);
    await page.mouse.move(ruler.x + 40, y);
    await page.mouse.down();
    await page.mouse.move(ruler.x + 120, y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const refs = await referred();
    assert.deepEqual(refs.map((r) => r.kind), ['time', 'range']);
    assert.ok(refs[0].time > 0 && refs[0].time * 1000 < clicked);
    assert.ok(refs[1].start < refs[1].end);
    assert.equal(await playhead(), dragged);
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(scratch, { recursive: true, force: true });
  }
});
