import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('editing-project exports keep effects automatically and remember whether to link or copy media', { timeout: 60_000 }, async () => {
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
      localStorage.setItem('openfilm.exportCenter.v1', JSON.stringify({ dest: 'nle', nle: { app: 'premiere', footage: 'source', media: 'invalid' } }));
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
    for (const [app, format] of [['Premiere Pro', 'xml'], ['DaVinci Resolve', 'xml'], ['Final Cut Pro', 'fcpxml'], ['CapCut', 'capcut']]) {
      await open();
      await dialog.getByRole('button', { name: app, exact: true }).click();
      assert.equal(await dialog.getByRole('button', { name: /Keep original media|Keep effects automatically|Keep rendered effects/ }).count(), 0);
      if (queued.length === 0) assert.equal(await dialog.getByRole('button', { name: 'Copy complete media', exact: true }).getAttribute('aria-pressed'), 'true');
      await dialog.getByRole('button', { name: 'Link original files', exact: true }).click();
      assert.equal(await dialog.getByRole('button', { name: 'Link original files', exact: true }).getAttribute('aria-pressed'), 'true');
      await dialog.getByRole('button', { name: 'Export', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(queued.at(-1).format, format);
      assert.equal(Object.hasOwn(queued.at(-1), 'footage'), false);
      assert.equal(queued.at(-1).media, 'link');
    }
    await open();
    await dialog.getByRole('button', { name: 'Copy complete media', exact: true }).click();
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(Object.hasOwn(queued.at(-1), 'footage'), false);
    assert.equal(queued.at(-1).media, 'copy');
    await open();
    assert.equal(await dialog.getByRole('button', { name: 'Copy complete media', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => Object.hasOwn(JSON.parse(localStorage.getItem('openfilm.exportCenter.v1')).nle, 'footage')), false);
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
