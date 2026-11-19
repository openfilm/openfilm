import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('a timeline range can be marked, exported, or cleared without changing the film', { timeout: 60_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-range-clear-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS', 'TRASH_DIR'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Range');
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'assets', 'card.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#486b8e"/></svg>');
    const film = filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'card', src: 'assets/card.svg', time: [0, 4] }] }] });
    await writeFile(join(root, 'film.html'), film);
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-US', reducedMotion: 'reduce' });
    page.setDefaultTimeout(5000);
    await page.addInitScript(() => {
      window.openfilmHost = {
        version: 1,
        onSelection: (selection) => { window.lastSelection = selection; },
        onCommand: (receive) => { window.studioCommand = receive; },
      };
      localStorage.setItem('openfilm.exportCenter.v1', JSON.stringify({ dest: 'images' }));
    });
    const jobs = [];
    await page.route(`**/api/projects/${project.id}/exports`, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      jobs.push(...route.request().postDataJSON().jobs);
      await route.fulfill({ json: { exports: [] } });
    });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const block = page.locator('[data-block-id]').first();
    await block.waitFor({ state: 'visible' });
    const range = page.locator('[data-timeline-range]');
    await page.keyboard.press('i');
    await range.waitFor({ state: 'visible' });
    const ruler = page.locator('[data-timeline] [role="slider"]').first();
    await ruler.click({ button: 'right', position: { x: 40, y: 10 } });
    await page.getByRole('menu').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({ state: 'detached' });
    assert.equal(await range.count(), 1, 'the first Escape belongs to the open menu');
    await page.getByRole('button', { name: 'Clear range', exact: true }).click();
    await range.waitFor({ state: 'detached' });

    await block.click();
    await page.keyboard.press('i');
    await range.waitFor({ state: 'visible' });
    await page.waitForFunction(() => window.lastSelection?.refs.some((ref) => ref.kind === 'clip'));
    await page.keyboard.press('Escape');
    await range.waitFor({ state: 'detached' });
    await page.waitForFunction(() => window.lastSelection?.range === null && !window.lastSelection.refs.some((ref) => ref.kind === 'clip'));

    const seek = async (time) => {
      await page.evaluate((time) => window.studioCommand({ type: 'seek', time }), time);
      await page.waitForFunction((time) => window.lastSelection?.time === time, time);
    };
    await seek(1);
    await page.getByRole('button', { name: 'Time range', exact: true }).click();
    await page.getByRole('menuitem', { name: /Mark in/ }).click();
    await seek(3);
    await page.keyboard.press('o');
    await page.waitForFunction(() => window.lastSelection?.range?.start === 1 && window.lastSelection.range.end === 3);

    await page.getByRole('button', { name: 'Export range', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export', exact: true });
    const selection = dialog.getByRole('button', { name: 'Timeline selection', exact: true });
    const submit = dialog.getByRole('button', { name: 'Export', exact: true });
    await dialog.getByText('00:00:01:00 – 00:00:03:00', { exact: true }).waitFor();
    assert.equal(await selection.getAttribute('aria-pressed'), 'true');
    assert.equal(await dialog.getByRole('button', { name: /^Video file/ }).getAttribute('aria-pressed'), 'true');
    await dialog.getByRole('button', { name: /^Images\b/ }).click();
    assert.equal(await submit.isDisabled(), true, 'changing to a format without ranges cannot export the whole film');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await range.waitFor({ state: 'visible' });

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+m' : 'Control+m');
    await selection.waitFor();
    await submit.click();
    await dialog.waitFor({ state: 'detached' });
    assert.deepEqual(jobs[0]?.range, [1, 3]);

    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await dialog.getByRole('button', { name: /^Whole film/ }).click();
    await submit.click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(jobs.length, 2);
    assert.equal(jobs[1]?.range, undefined);
    assert.equal(await readFile(join(root, 'film.html'), 'utf8'), film);
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
