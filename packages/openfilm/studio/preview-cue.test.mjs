import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('a slow chapter starts playing when its first frame arrives', { timeout: 45_000 }, async () => {
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
    await writeFile(join(root, 'ready.json'), '{}');
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [
      { id: 'intro', src: 'intro.html', time: [0, 3] },
      { id: 'chapter', src: 'chapter.html', at: 3, time: [0, 15] },
    ] }] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
    await page.route('**/ready.json', async (route) => { await chapter.promise; await route.fulfill({ json: {} }); });
    await page.addInitScript(() => {
      localStorage.setItem('openfilm.preview.fitPages', '0');
      localStorage.setItem('openfilm.preview.renders', '0');
      window.openfilmHost = { version: 1, onCommand: (receive) => { window.studioCommand = receive; } };
      window.slowSeeks = 0;
      window.addEventListener('message', ({ data }) => {
        if (data?.source === 'openfilm-film' && data.type === 'seeked' && data.t === 5 && data.drawn === false) window.slowSeeks++;
      });
    });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const viewer = page.locator('[data-project-player]');
    await viewer.getByRole('button', { name: 'Play', exact: true }).waitFor();
    await page.waitForFunction(() => window.studioCommand && document.querySelector('iframe[title="film"]:not([data-loading])'));
    await page.evaluate(() => window.studioCommand({ type: 'seek', time: 5 }));
    await page.waitForFunction(() => window.slowSeeks === 1);
    await viewer.getByRole('button', { name: 'Play', exact: true }).click();
    /* A play after the bridge reports a slow seek keeps waiting for that seek. */
    await page.waitForTimeout(4_300);
    assert.equal(await page.locator('[data-preview-cue]').isVisible(), true);
    assert.equal(await page.evaluate(() => window.slowSeeks), 1);
    chapter.resolve();
    const ruler = page.locator('[data-timeline] [role="slider"][aria-valuemax]').first();
    await page.waitForFunction(() => Number(document.querySelector('[data-timeline] [role="slider"][aria-valuemax]')?.getAttribute('aria-valuenow')) > 5_200);
    assert.ok(Number(await ruler.getAttribute('aria-valuenow')) > 5_200);
    assert.equal(await page.locator('[data-preview-cue]').isVisible(), false);
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
