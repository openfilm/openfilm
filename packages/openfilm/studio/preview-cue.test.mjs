import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('seeking past a loading chapter responds at once, and playback can still wait for that chapter', { timeout: 45_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-preview-cue-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const previous = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  const chapter = Promise.withResolvers();
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Slow chapter');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'intro.html'), '<!doctype html><script>window.film={frame(){}}</script>');
    await writeFile(join(root, 'chapter.html'), '<!doctype html><script>window.film={ready:fetch("ready.json"),frame(){}}</script>');
    await writeFile(join(root, 'next.html'), '<!doctype html><script>window.film={frame(){}}</script>');
    await writeFile(join(root, 'ready.json'), '{}');
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [
      { id: 'intro', src: 'intro.html', time: [0, 12] },
      { id: 'chapter', src: 'chapter.html', at: 12, time: [0, 13] },
      { id: 'next', src: 'next.html', at: 25, time: [0, 10] },
    ] }] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
    await page.route('**/ready.json', async (route) => { await chapter.promise; await route.fulfill({ json: {} }).catch(() => {}); });
    await page.addInitScript(() => {
      localStorage.setItem('openfilm.preview.fitPages', '0');
      localStorage.setItem('openfilm.preview.renders', '0');
      window.openfilmHost = { version: 1, onCommand: (receive) => { window.studioCommand = receive; } };
      window.slowSeeks = 0;
      window.returned = false;
      window.addEventListener('message', ({ data }) => {
        if (data?.source !== 'openfilm-film' || data.type !== 'seeked') return;
        if (data.t === 14 && data.drawn === false) window.slowSeeks++;
        if (data.t === 1 && data.drawn === true) window.returned = true;
      });
    });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const viewer = page.locator('[data-project-player]');
    await viewer.getByRole('button', { name: 'Play', exact: true }).waitFor();
    await page.waitForFunction(() => window.studioCommand && document.querySelector('iframe[title="film"]:not([data-loading])'));
    await page.evaluate(async () => {
      window.studioCommand({ type: 'seek', time: 14 });
      await new Promise((resolve) => setTimeout(resolve, 100));
      window.studioCommand({ type: 'seek', time: 1 });
    });
    await page.waitForFunction(() => window.returned);
    assert.equal(await page.evaluate(() => window.slowSeeks), 0, 'the new frame did not have to wait out the cold chapter');
    const film = page.frameLocator('[data-viewer-picture] iframe[title="film"]:not([data-loading]):not([data-leaving])');
    assert.equal(await film.locator('iframe[data-film-src^="chapter.html"]').getAttribute('src'), 'about:blank', 'the unused page was closed');
    await page.evaluate(() => window.studioCommand({ type: 'seek', time: 14 }));
    await page.waitForFunction(() => window.slowSeeks === 1);
    await viewer.getByRole('button', { name: 'Play', exact: true }).click();
    const ruler = page.locator('[data-timeline] [role="slider"][aria-valuemax]').first();
    /* A play after the bridge reports a slow seek keeps waiting for that seek. */
    await page.waitForTimeout(4_300);
    assert.equal(await ruler.getAttribute('aria-valuenow'), '14000');
    assert.equal(await page.locator('[data-preview-cue]').count(), 0);
    assert.equal(await page.evaluate(() => window.slowSeeks), 1);
    const nextChapter = page.waitForRequest((request) => request.resourceType() === 'document' && new URL(request.url()).pathname.endsWith('/next.html'));
    chapter.resolve();
    await page.waitForFunction(() => Number(document.querySelector('[data-timeline] [role="slider"][aria-valuemax]')?.getAttribute('aria-valuenow')) > 14_200);
    await nextChapter;
    assert.ok(Number(await ruler.getAttribute('aria-valuenow')) < 16_000, 'the next page opens well ahead of its cut');
    await viewer.getByRole('button', { name: 'Pause', exact: true }).click();
    const box = await ruler.boundingBox();
    await ruler.dispatchEvent('pointerdown', { button: 0, pointerId: 41, clientX: box.x + 20, clientY: box.y + 5 });
    await page.waitForFunction(() => document.body.classList.contains('tl-scrubbing'));
    await ruler.dispatchEvent('pointercancel', { pointerId: 41 });
    await page.waitForFunction(() => !document.body.classList.contains('tl-scrubbing'));
    await page.evaluate(() => window.studioCommand({ type: 'seek', time: 15 }));
    await viewer.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => Number(document.querySelector('[data-timeline] [role="slider"][aria-valuemax]')?.getAttribute('aria-valuenow')) > 15_200, {}, { timeout: 3_000 });
    await viewer.getByRole('button', { name: 'Pause', exact: true }).click();
  } finally {
    chapter.resolve();
    await browser?.close();
    await studio?.close();
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(scratch, { recursive: true, force: true });
  }
});
