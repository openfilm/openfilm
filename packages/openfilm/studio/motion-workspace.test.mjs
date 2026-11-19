import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml, readFilmFile } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';
import { showWorkbench } from './show-workbench.mjs';

test('the editor catalog shows upcoming editors, and Motion edits the same film from its own workspace', { timeout: 120_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-motion-workspace-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Motion');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'card.html'), `<!doctype html><body style="margin:0;background:#123">
<h1 style="color:white">Motion integration</h1>
<script>window.film={duration:4,width:320,height:180,frame(){}}</script></body>`);
    const captions = 'WEBVTT\n\nfirst\n00:00:00.000 --> 00:00:03.000\nIntegration caption\n';
    await writeFile(join(root, 'captions.vtt'), captions);
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [
      { clips: [], captions: { src: 'captions.vtt', kind: 'captions', srclang: 'en' } },
      { clips: [{ id: 'card', src: 'card.html', time: [0, 4] }] },
    ] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => { localStorage.setItem('openfilm.project.timelineH', '440'); });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    await page.locator('[data-block-kind="caption"]').first().waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-timeline-view-item="motion"]').count(), 0);
    /* Enable Motion from the editor catalog. Upcoming editors are visible without an install action. */
    await page.getByRole('button', { name: 'OpenFilm menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Community', exact: true }).click();
    const community = page.getByRole('dialog', { name: 'Community' });
    await community.getByRole('button', { name: 'Plugins', exact: true }).click();
    const editors = community.locator('[data-community-shelf="Editors"]');
    for (const title of ['Sound', '3D', 'Compositing']) {
      const card = editors.locator(`[data-store-card="${title}"]`);
      await card.getByText('Coming soon', { exact: true }).waitFor();
      assert.equal(await card.getByRole('button', { name: `Get ${title}`, exact: true }).count(), 0);
    }
    const getMotion = editors.getByRole('button', { name: 'Get Motion', exact: true });
    const installed = page.waitForResponse((response) => response.url().endsWith('/api/plugins/motion') && response.request().method() === 'PUT');
    await getMotion.click();
    assert.equal((await installed).ok(), true);
    await getMotion.waitFor({ state: 'detached' });
    await page.keyboard.press('Escape');
    await community.waitFor({ state: 'detached' });
    await showWorkbench(page, 'motion');
    await page.locator('[data-block="edit:timeline"]').waitFor();
    await page.reload();
    await page.locator('[data-work-mode="motion"]').waitFor();
    const layer = page.locator('[data-motion-layer="card"]');
    await layer.waitFor({ state: 'visible' });
    await layer.click({ position: { x: 200, y: 10 } });
    await layer.locator('[data-twirl="card"]').click();
    const position = page.locator('[data-property-row="card:translate"]');
    await position.getByRole('button', { name: /^Animate this/ }).click();
    await position.getByRole('button', { name: /^Stop animating/ }).waitFor({ state: 'visible' });

    const film = async () => readFilmFile(await readFile(join(root, 'film.html'), 'utf8')).doc;
    const until = async (check) => {
      for (let i = 0; i < 80; i++) { if (await check()) return; await page.waitForTimeout(100); }
      assert.fail('the motion edit was not written');
    };
    await until(async () => Object.keys((await film()).keyframes ?? {}).length > 0);

    const keys = page.locator('[data-motion-lane="translate"] [data-keyframe]');
    const key = keys.first();
    await key.waitFor();
    const original = await key.getAttribute('data-keyframe');
    /* the keyframe's row may be below what the timeline shows at its height */
    await key.scrollIntoViewIfNeeded();
    const bounds = await key.boundingBox();
    const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 32, y, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction((before) => {
      const key = document.querySelector('[data-motion-lane="translate"] [data-keyframe]');
      return key && key.getAttribute('data-keyframe') !== before;
    }, original, { timeout: 6000 });
    await key.click();
    await page.keyboard.press('ControlOrMeta+c');
    await page.keyboard.press('ControlOrMeta+v');
    await keys.nth(1).waitFor();

    await page.getByRole('button', { name: 'New layer', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Rectangle', exact: true }).click();
    await until(async () => (await film()).tracks.flatMap((track) => track.clips).length === 2);
    await showWorkbench(page, 'edit');
    await page.locator('[data-block="timeline"]').waitFor();
    await page.locator('[data-block-kind="caption"]').first().waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-motion-layer]').count(), 0);
    assert.equal(await page.locator('[data-timeline-view-item]').count(), 0);
    assert.equal(await readFile(join(root, 'captions.vtt'), 'utf8'), captions);
    assert.equal((await film()).tracks.filter((track) => track.captions?.src === 'captions.vtt').length, 1);

    await showWorkbench(page, 'motion');
    const editDisabled = await page.evaluate(async () => (await fetch('/api/plugins/edit', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ on: false }),
    })).ok);
    assert.equal(editDisabled, true);
    await page.reload();
    await page.locator('[data-work-mode="motion"]').waitFor();
    await layer.waitFor({ state: 'visible' });
    assert.deepEqual(errors, []);
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
