import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('the project title opens Projects immediately, keeps its hover card, and renames through its actions', { timeout: 60_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-project-title-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS', 'TRASH_DIR'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Title alignment');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'card.html'), '<!doctype html><body style="background:#123"><script>window.film={duration:4,frame(){}}</script></body>');
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 720, h: 1280 }, tracks: [{ clips: [{ id: 'card', src: 'card.html', time: [0, 4] }] }] }));
    const project = await openProject(root);
    const recentRoot = join(process.env.OPENFILM_LIBRARY, 'Recent only');
    await mkdir(recentRoot, { recursive: true });
    await writeFile(join(recentRoot, 'film.html'), filmHtml({ stage: { w: 1280, h: 720 }, tracks: [] }));
    await openProject(recentRoot);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'en-US', reducedMotion: 'reduce' });
    await page.addInitScript(({ id }) => {
      window.tabEvents = [];
      const tab = (id, projectId, title) => ({ id, projectId, title, active: id === 'self', working: false, asking: false, exporting: null });
      window.openfilmHost = {
        version: 1,
        tabs: {
          list: async () => ({ self: 'self', tabs: [tab('self', id, 'Title alignment'), tab('other', 'other-project', 'Other open film')] }),
          onChange: () => () => {}, report: () => {}, onPick: () => () => {},
          show: (id) => window.tabEvents.push(`show:${id}`),
          close: (id) => window.tabEvents.push(`close:${id}`),
          open: () => {}, move: () => {}, openRequest: () => {},
        },
      };
    }, { id: project.id });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const title = page.locator('[data-project-title]');
    const button = title.locator('[data-project-title-name]');
    const arrow = title.locator('[data-project-title-arrow]');
    const card = page.locator('[data-project-card]');
    const field = title.getByRole('textbox');
    const projects = page.getByRole('dialog', { name: 'Projects', exact: true });
    await button.waitFor({ state: 'visible' });
    assert.equal(await arrow.isVisible(), true, 'the project arrow remains available');
    await button.hover();
    await card.waitFor({ state: 'visible' });
    await card.hover();
    for (const name of ['Rename', 'Set current frame as cover', 'Show folder', 'All projects…']) {
      assert.equal(await card.getByRole('button', { name, exact: true }).isVisible(), true, `${name} remains in the hover card`);
    }
    assert.match(await card.innerText(), /1 clip/);
    assert.match(await card.innerText(), /Other open projects/);
    assert.equal(await card.getByRole('button', { name: 'Other open film', exact: true }).isVisible(), true);
    assert.equal(await card.getByRole('button', { name: 'Title alignment', exact: true }).count(), 0, 'the current project is outside the other open projects');
    assert.equal(await card.getByRole('button', { name: 'Recent only', exact: true }).count(), 0, 'recent projects stay in All projects');
    assert.equal(await card.getByText('Recent', { exact: true }).count(), 0, 'the hover card has no recent section');
    assert.equal(await card.locator('img').count(), 1, 'the cover remains in a film with content');
    await card.locator('img').evaluate((img) => img.decode());
    const cover = await card.locator('img').evaluate((img) => ({
      ratio: img.parentElement.clientWidth / img.parentElement.clientHeight,
      sourceRatio: img.naturalWidth / img.naturalHeight,
      fit: getComputedStyle(img).objectFit,
    }));
    assert.ok(Math.abs(cover.ratio - 720 / 1280) < 0.03, 'a portrait film has a portrait cover box');
    assert.ok(Math.abs(cover.sourceRatio - 720 / 1280) < 0.03, 'the poster retains the film proportions');
    assert.equal(cover.fit, 'contain', 'the cover is shown whole');
    const oldCover = await card.locator('img').getAttribute('src');
    const settingCover = page.waitForResponse((response) => response.url().endsWith(`/api/projects/${project.id}/cover`) && response.request().method() === 'POST');
    await card.getByRole('button', { name: 'Set current frame as cover', exact: true }).click();
    await arrow.click();
    const coverResponse = await settingCover;
    assert.equal(coverResponse.status(), 200);
    assert.equal(coverResponse.request().postDataJSON().ms, 0, 'the cover is taken from the current playhead');
    const { cover: coverAt } = await coverResponse.json();
    const updatedCover = card.locator(`img[src$="?cover=${coverAt}"]`);
    await updatedCover.waitFor({ state: 'visible' });
    await updatedCover.evaluate((img) => img.decode());
    assert.notEqual(await updatedCover.getAttribute('src'), oldCover, 'setting a cover refreshes the hover image without reloading');
    await card.getByRole('button', { name: 'Other open film', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.tabEvents), ['show:other'], 'switching an open project keeps its action');
    await arrow.click();
    await card.getByRole('button', { name: 'Other open film', exact: true }).hover();
    await card.getByRole('button', { name: 'Close', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.tabEvents), ['show:other', 'close:other'], 'closing another project keeps its action');
    await page.keyboard.press('Escape');
    await button.hover();
    await card.hover();
    await arrow.click();
    await page.mouse.move(20, 60);
    await page.waitForTimeout(300);
    assert.equal(await card.isVisible(), true, 'clicking the arrow keeps the hover card open');
    await arrow.click();
    await card.waitFor({ state: 'detached' });

    await button.click();
    assert.equal(await projects.isVisible(), true, 'the click opens Projects without waiting to distinguish a double click');
    assert.equal(await card.count(), 0, 'opening Projects dismisses the hover card');
    /* recent projects stay reachable in All projects: its Sort has Recently opened */
    await projects.getByRole('button', { name: 'Sort', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await projects.waitFor({ state: 'detached' });

    const before = await button.boundingBox();
    const typeBefore = await button.evaluate((el) => {
      const css = getComputedStyle(el);
      return [css.fontFamily, css.fontSize, css.fontWeight, css.lineHeight, css.paddingLeft, css.textAlign];
    });
    await arrow.click();
    await card.getByRole('button', { name: 'Rename', exact: true }).click();
    await field.waitFor({ state: 'visible' });
    const during = await field.boundingBox();
    for (const part of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(before[part] - during[part]) < 0.5, `${part} stays in place`);
    const typeDuring = await field.evaluate((el) => {
      const css = getComputedStyle(el);
      return [css.fontFamily, css.fontSize, css.fontWeight, css.lineHeight, css.paddingLeft, css.textAlign];
    });
    assert.deepEqual(typeDuring, typeBefore, 'editing keeps the same typography and alignment');
    await field.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    assert.equal(await field.isVisible(), true, 'confirming an IME candidate does not submit the rename');
    await field.fill('Renamed in place');
    const committed = page.waitForResponse((response) => response.url().endsWith(`/api/projects/${project.id}`) && response.request().method() === 'PATCH');
    await field.press('Enter');
    assert.equal((await committed).status(), 200);
    await page.waitForFunction(() => document.querySelector('[data-project-title] button')?.textContent === 'Renamed in place');
    const renamed = await (await fetch(`${studio.origin}/api/projects`, { headers: { 'x-studio-key': studio.key } })).json();
    assert.equal(renamed.projects.find((p) => p.id === project.id)?.name, 'Renamed in place');
    assert.equal(await projects.count(), 0, 'the rename action stays in the current project');

    await button.focus();
    await button.press('F2');
    await field.fill('Discard this');
    await field.press('Escape');
    assert.equal(await button.textContent(), 'Renamed in place', 'Esc cancels without blur saving');
    assert.equal(await arrow.isVisible(), true);
    await arrow.click();
    await card.waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await card.waitFor({ state: 'detached' });
    await button.focus();
    await button.press('Enter');
    await projects.waitFor({ state: 'visible' });
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
