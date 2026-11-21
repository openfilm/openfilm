import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { writeMarkers } from './server/markers.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('timeline range selection, marker scrolling and compact track layout', { timeout: 60_000 }, async () => {
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
    const scroll = page.locator('[data-timeline] .tl-scroll');

    const range = page.locator('[data-timeline-range]');
    await page.keyboard.press('i');
    await range.waitFor({ state: 'visible' });
    const ruler = page.locator('[data-timeline] [role="slider"]').first();
    await ruler.click({ button: 'right', position: { x: 40, y: 10 } });
    const timeRange = page.getByRole('menuitem', { name: 'Time range', exact: true });
    await timeRange.waitFor({ state: 'visible' });
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
    await seek(2);
    assert.equal(await page.getByRole('button', { name: 'Time range', exact: true }).count(), 0);
    const clip = await block.boundingBox();
    const viewport = await scroll.boundingBox();
    await page.mouse.click(clip.x + (clip.width + 1) / 4, viewport.y - 8, { button: 'right' });
    await timeRange.click();
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

    const markersRoot = join(process.env.OPENFILM_LIBRARY, 'Markers');
    await mkdir(markersRoot, { recursive: true });
    await writeFile(join(markersRoot, 'card.svg'), await readFile(join(root, 'assets', 'card.svg')));
    const tracks = Array.from({ length: 8 }, (_, index) => ({
      clips: [{ id: `card-${index}`, src: 'card.svg', time: [0, 4] }],
    }));
    await writeFile(join(markersRoot, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks }));
    await writeMarkers(markersRoot, [{ id: 'beat', t: 1, color: 'green', name: 'Beat' }]);
    const markersProject = await openProject(markersRoot);
    await page.goto(`${studio.origin}/projects/${markersProject.id}?key=${studio.key}`);

    const marker = page.locator('[data-marker="beat"]');
    await marker.waitFor({ state: 'visible' });
    await block.waitFor({ state: 'visible' });
    const markerBefore = await marker.boundingBox();
    const clipBefore = await block.boundingBox();
    assert.ok(markerBefore.y + markerBefore.height <= clipBefore.y, 'the marker has space above the tracks');
    const scrolledBy = await scroll.evaluate((element) => {
      const top = element.scrollTop;
      element.scrollTop += 24;
      return element.scrollTop - top;
    });
    assert.ok(scrolledBy >= markerBefore.height, 'the fixture can scroll the entire marker strip out of view');
    assert.equal((await marker.boundingBox()).y, markerBefore.y - scrolledBy);
    assert.equal((await block.boundingBox()).y, clipBefore.y - scrolledBy);
    const atOldMarker = await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x + 4, y + 4)?.closest('[data-marker]')), markerBefore);
    assert.equal(atOldMarker, false, 'the marker does not stay clickable over the tracks');

    await scroll.evaluate((element) => { element.scrollTop = 0; });
    await seek(1);
    await marker.click();
    await page.getByRole('dialog', { name: 'Beat', exact: true }).waitFor();
    await page.keyboard.press('Escape');

    const seam = page.getByRole('separator', { name: 'Resize timeline', exact: true });
    const divider = await seam.boundingBox();
    const beforeResize = await scroll.boundingBox();
    await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
    await page.mouse.down();
    await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2 + 220, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction((height) => {
      const viewport = document.querySelector('[data-timeline] .tl-scroll')?.getBoundingClientRect();
      const main = document.querySelector('[data-main-track]')?.getBoundingClientRect();
      return viewport && main && viewport.height < height && main.top >= viewport.top && main.bottom <= viewport.bottom;
    }, beforeResize.height);
    const compactView = await scroll.boundingBox();
    const rulerBox = await ruler.boundingBox();
    assert.ok(compactView.y - (rulerBox.y + rulerBox.height) >= 32, 'the compact timeline keeps space under its ruler');
    const compactTop = await scroll.evaluate((element) => element.scrollTop);
    assert.ok(compactTop > 0, 'shrinking brought the main track into view');
    const cover = await page.locator('[data-cover-tile]').boundingBox();
    assert.ok(cover.y >= compactView.y && cover.y + cover.height <= compactView.y + compactView.height);

    const gutter = { x: clipBefore.x + 20, y: compactView.y - 8 };
    await page.mouse.move(gutter.x, gutter.y);
    await page.mouse.wheel(0, -120);
    await page.waitForFunction((top) => document.querySelector('[data-timeline] .tl-scroll').scrollTop < top, compactTop);
    assert.equal(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('[data-block-id]')), gutter),
      false, 'clips stay below the reserved space when the timeline scrolls');
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
