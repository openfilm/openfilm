import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

const PAGE = '<!doctype html><body style="margin:0;background:#224"><script>window.film={duration:4,frame(){}}</script></body>';

/** Studio on a project of one page clip, in English, the library's given category open. */
async function withLibrary(category, run) {
  const scratch = await mkdtemp(join(tmpdir(), 'of-library-trial-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((n) => [`OPENFILM_${n}`, process.env[`OPENFILM_${n}`]]));
  for (const n of names) process.env[`OPENFILM_${n}`] = join(scratch, n.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Trial');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'page.html'), PAGE);
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 1280, h: 720 }, tracks: [{ clips: [{ id: 'page', src: 'page.html', time: [0, 4] }] }] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, locale: 'en-US' });
    /* the library's drawer is the app's: over its panel */
    await page.addInitScript(() => {
      window.openfilmHost = {
        version: 1,
        refer: () => {},
        panel: { label: 'Chat', open: true, width: 480, assets: { open: true, bottom: 0 }, setOpen: () => {}, setAssetsOpen: () => {}, onChange: () => {} },
      };
    });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    await page.locator('[data-viewer-picture] iframe').first().waitFor({ state: 'visible' });
    const tab = page.getByRole('button', { name: category, exact: true });
    await tab.waitFor({ state: 'visible' });
    await tab.click();
    const trial = page.locator('[data-library-trial]');
    /** What is drawn over the picture for this long: when it changed, and how many times it was drawn anew. */
    const watch = (ms) => page.evaluate((length) => new Promise((resolve) => {
      const start = performance.now();
      const host = document.querySelector('[data-library-trial]');
      let drawn = 0;
      const seen = new MutationObserver((changes) => { for (const c of changes) drawn += c.addedNodes.length; });
      seen.observe(host, { childList: true, subtree: true });
      const tick = () => {
        if (performance.now() - start < length) { setTimeout(tick, 50); return; }
        seen.disconnect();
        resolve({ drawn, showing: host.querySelector('img, iframe, span') !== null, clickable: getComputedStyle(host).pointerEvents !== 'none' });
      };
      tick();
    }), ms);
    await run({ page, trial, watch });
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [n, v] of saved) { if (v === undefined) delete process.env[n]; else process.env[n] = v; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

const card = (page, name) => page.locator(`div.group[title="${name}"]`).first();

test('a transition tried in the library plays once, leaves the film free, and plays again on another click', { timeout: 120_000 }, async () => {
  await withLibrary('Transitions', async ({ page, trial, watch }) => {
    for (const name of ['Blinds', 'Cross dissolve', 'Push left']) {
      const it = card(page, name);
      await it.scrollIntoViewIfNeeded();
      await it.click();
      await trial.waitFor({ state: 'attached' });
      const after = await watch(3000);
      assert.equal(after.drawn, 0, `${name} is not drawn again`);
      assert.equal(after.showing, false, `${name} has gone from the picture`);
      assert.equal(after.clickable, false, `the picture under ${name} takes clicks again`);
    }
    const again = card(page, 'Blinds');
    await again.scrollIntoViewIfNeeded();
    await again.click();
    await page.waitForTimeout(3000);
    assert.equal((await watch(100)).showing, false, 'the other one has ended');
    await again.click();
    await page.locator('[data-library-trial] iframe').waitFor({ state: 'attached', timeout: 2000 });
    assert.equal((await watch(3000)).showing, false, 'played again, once');
  });
});

test('an effect tried in the library stays on the picture until it is let go', { timeout: 120_000 }, async () => {
  await withLibrary('Effects', async ({ page, trial, watch }) => {
    await card(page, 'Film grain').click();
    await trial.waitFor({ state: 'attached' });
    const after = await watch(3000);
    assert.equal(after.showing, true);
    assert.equal(after.clickable, true);
  });
});
