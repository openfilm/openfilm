import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('with the app\'s chat, a ruler click moves the playhead and a ⌘-click (Ctrl-click) refers the moment', { timeout: 60_000 }, async () => {
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
      // A choice saved by an older version must not bring back hover preview.
      localStorage.setItem('openfilm.timeline.previewAxis', '1');
      window.referred = [];
      window.openfilmHost = {
        version: 1, refer: (ref) => window.referred.push(ref),
        onCommand: (receive) => { window.studioCommand = receive; },
      };
    });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    await page.locator('[data-block-id]').first().waitFor({ state: 'visible' });
    const slider = page.locator('[data-timeline] [role="slider"]').first();
    const ruler = await slider.boundingBox();
    assert.ok(ruler);
    const y = ruler.y + ruler.height / 2;
    const playhead = async () => Number(await slider.getAttribute('aria-valuenow'));
    const referred = () => page.evaluate(() => window.referred);
    /* the key a box is drawn with on the picture: ⌘ on a Mac, Ctrl elsewhere */
    const key = process.platform === 'darwin' ? 'Meta' : 'Control';
    assert.equal(await playhead(), 0);
    assert.equal(await page.locator('[data-timeline-preview-axis], [data-preview-axis]').count(), 0, 'the preview axis switch and line are removed');
    assert.equal(await page.getByRole('button', { name: 'Preview axis', exact: true }).count(), 0);
    await page.mouse.move(ruler.x + 200, y + 100);
    await page.keyboard.press('s');
    assert.equal(await playhead(), 0, 'hovering and the old shortcut do not seek');

    /* a plain click: the playhead goes there, nothing is referred. Just after the page opens, the preview may not take
       a seek yet (the playhead is where the preview is), so the click is made again until it does */
    for (let tries = 0; tries < 20 && await playhead() === 0; tries++) {
      await page.mouse.click(ruler.x + 200, y);
      await page.waitForTimeout(250);
    }
    const clicked = await playhead();
    assert.ok(clicked > 0);
    assert.deepEqual(await referred(), []);

    /* a plain drag scrubs */
    await page.mouse.move(ruler.x + 100, y);
    await page.mouse.down();
    await page.mouse.move(ruler.x + 300, y, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction((before) => Number(document.querySelector('[data-timeline] [role="slider"]')?.getAttribute('aria-valuenow')) > before, clicked);
    assert.deepEqual(await referred(), []);

    assert.equal(await page.getByRole('button', { name: 'Add to chat', exact: true }).count(), 0, 'the floating reference button is absent');
    const dragged = await playhead();

    /* the moment a click would refer is drawn only while the key is held, with a crosshair */
    await page.mouse.move(ruler.x + 60, y);
    assert.equal(await slider.evaluate((el) => el.style.cursor), 'default');
    await page.keyboard.down(key);
    await page.waitForFunction(() => document.querySelector('[data-timeline] [role="slider"]')?.style.cursor === 'crosshair');
    await page.keyboard.up(key);
    await page.waitForFunction(() => document.querySelector('[data-timeline] [role="slider"]')?.style.cursor === 'default');

    /* a ⌘-click refers that moment, a ⌘-drag that span; the playhead stays */
    await page.keyboard.down(key);
    await page.mouse.click(ruler.x + 60, y);
    await page.mouse.move(ruler.x + 40, y);
    await page.mouse.down();
    await page.mouse.move(ruler.x + 120, y, { steps: 5 });
    const draft = page.locator('[data-timeline-refer-range]');
    await draft.waitFor({ state: 'visible' });
    const band = await draft.boundingBox();
    assert.ok(band.height <= ruler.height, 'the chosen span stays within the top ruler while dragging');
    assert.ok(band.width > 20, 'the ruler shows the current span before release');
    assert.equal(await page.evaluate(() => document.body.classList.contains('tl-pinning')), true);
    await page.mouse.up();
    await page.keyboard.up(key);
    const refs = await referred();
    assert.deepEqual(refs.map((r) => r.kind), ['time', 'range']);
    assert.ok(refs[0].time > 0 && refs[0].time * 1000 < clicked);
    assert.ok(refs[1].start < refs[1].end);
    assert.equal(await playhead(), dragged);
    assert.equal(await draft.count(), 0, 'release removes the live preview');
    assert.equal(await page.evaluate(() => document.body.classList.contains('tl-pinning')), false);

    /* recalling that span seeks to its start and briefly tints only the ruler */
    const flash = page.locator('[data-timeline-range-flash]');
    await page.evaluate(() => window.studioCommand({ type: 'show-range', start: 0.1, end: 0.6 }));
    await flash.waitFor({ state: 'visible' });
    const flashed = await flash.boundingBox();
    const clipBounds = await page.locator('[data-block-id]').first().boundingBox();
    assert.ok(flashed.y + flashed.height <= clipBounds.y + 0.5, 'the highlight ends above the clip rows');
    assert.equal(await page.locator('[data-timeline-range]').count(), 0, 'no persistent range or its label is created');
    await page.waitForFunction(() => Math.abs(Number(document.querySelector('[data-timeline] [role="slider"]')?.getAttribute('aria-valuenow')) - 100) <= 40);
    assert.equal(await page.getByRole('button', { name: 'Add to chat', exact: true }).count(), 0);
    await flash.waitFor({ state: 'hidden', timeout: 3000 });
    assert.equal(await page.locator('[data-timeline-range]').count(), 0);

    /* cancelling a reference drag clears the preview and cursor without adding another pill */
    await page.keyboard.down(key);
    await page.mouse.move(ruler.x + 40, y);
    await page.mouse.down();
    await page.mouse.move(ruler.x + 140, y, { steps: 5 });
    await draft.waitFor({ state: 'visible' });
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await draft.waitFor({ state: 'hidden' });
    await page.mouse.up();
    await page.keyboard.up(key);
    assert.equal((await referred()).length, 2);
    assert.equal(await page.evaluate(() => document.body.classList.contains('tl-pinning')), false);
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
