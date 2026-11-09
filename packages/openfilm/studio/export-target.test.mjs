import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('video targets validate, persist and reach the export API, with estimates and responsive inputs', { timeout: 60_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-export-original-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS', 'TRASH_DIR'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Originals');
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'assets', 'card.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#486b8e"/></svg>');
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'card', src: 'assets/card.svg', time: [0, 4] }] }] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {}, editorDir: process.env.OPENFILM_TEST_EDITOR_DIR });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', reducedMotion: 'reduce' });
    page.setDefaultTimeout(8000);
    await page.addInitScript(() => {
      localStorage.setItem('openfilm.exportCenter.v1', JSON.stringify({ dest: 'video' }));
    });
    const queued = [];
    await page.route(`**/api/projects/${project.id}/exports`, async (route) => {
      if (route.request().method() !== 'POST') {
        const response = await route.fetch();
        return route.fulfill({ json: { ...await response.json(), drafts: { jianying: false, capcut: false } } });
      }
      queued.push(route.request().postDataJSON().jobs[0]);
      /* UI contract only: actual file generation is covered by server/nle-source.test.mjs. */
      await route.fulfill({ json: { exports: [] } });
    });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    await page.locator('[data-block-id]').first().waitFor({ state: 'visible' });
    const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
    const open = async () => { await page.getByRole('button', { name: 'Export', exact: true }).click(); await dialog.waitFor({ state: 'visible' }); };
    await open();
    assert.equal(await dialog.getByRole('button', { name: 'Automatic', exact: true }).getAttribute('aria-pressed'), 'true');
    await dialog.getByRole('button', { name: 'Video bitrate', exact: true }).click();
    const bitrate = dialog.getByRole('spinbutton', { name: 'Video bitrate', exact: true });
    await bitrate.fill('3');
    assert.match(await dialog.innerText(), /about 1.52 MB/);
    await bitrate.fill('');
    assert.equal(await dialog.getByRole('button', { name: 'Export', exact: true }).isDisabled(), true);
    await bitrate.fill('121');
    assert.equal(await dialog.getByRole('button', { name: 'Export', exact: true }).isDisabled(), true);
    await bitrate.fill('3');
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.deepEqual(queued.at(-1).target, { kind: 'bitrate', value: 3 });
    await open();
    assert.equal(await bitrate.inputValue(), '3');
    await dialog.getByRole('button', { name: 'File size', exact: true }).click();
    const size = dialog.getByRole('spinbutton', { name: 'Size per file', exact: true });
    await size.fill('.0001');
    assert.equal(await dialog.getByRole('button', { name: 'Export', exact: true }).isDisabled(), true);
    await size.fill('2');
    assert.match(await dialog.innerText(), /about 2 MB/);
    for (const width of [1280, 768, 375]) {
      await page.setViewportSize({ width, height: 950 });
      await size.scrollIntoViewIfNeeded();
      const modeBox = await dialog.getByRole('button', { name: 'File size', exact: true }).boundingBox();
      assert.ok(modeBox && modeBox.x >= 0 && modeBox.x + modeBox.width <= width, `target mode stays visible at ${width}px`);
      const box = await size.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width, `target input stays visible at ${width}px`);
      if (process.env.OPENFILM_TARGET_SCREENSHOTS) await page.screenshot({ path: `${process.env.OPENFILM_TARGET_SCREENSHOTS}/export-target-${width}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.deepEqual(queued.at(-1).target, { kind: 'size', value: 2 });
    await open();
    await dialog.getByRole('button', { name: /^ProRes 422 HQ/ }).click();
    assert.equal(await size.count(), 0);
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(queued.at(-1).target, undefined);
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
