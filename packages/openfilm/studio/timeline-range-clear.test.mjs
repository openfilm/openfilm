import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { writeMarkers } from './server/markers.mjs';
import { patchProjectSettings } from './server/project-settings.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('timeline range selection, fixed markers and scrollable track padding', { timeout: 60_000 }, async () => {
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
    await page.mouse.click(clip.x + (clip.width + 1) / 4, viewport.y + 8, { button: 'right' });
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
    const sound = Buffer.alloc(44 + 64_000);
    sound.write('RIFF'); sound.writeUInt32LE(sound.length - 8, 4); sound.write('WAVEfmt ', 8);
    sound.writeUInt32LE(16, 16); sound.writeUInt16LE(1, 20); sound.writeUInt16LE(1, 22);
    sound.writeUInt32LE(8000, 24); sound.writeUInt32LE(16000, 28);
    sound.writeUInt16LE(2, 32); sound.writeUInt16LE(16, 34);
    sound.write('data', 36); sound.writeUInt32LE(sound.length - 44, 40);
    await writeFile(join(markersRoot, 'sound.wav'), sound);
    tracks.push({ clips: [{ id: 'sound', src: 'sound.wav', time: [0, 4] }] });
    await writeFile(join(markersRoot, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks }));
    await writeMarkers(markersRoot, [{ id: 'beat', t: 1, color: 'green', name: 'Beat' }]);
    await patchProjectSettings(markersRoot, { trackHeights: [{ height: 96, index: 7, clips: ['card-7'] }] });
    const markersProject = await openProject(markersRoot);
    await page.goto(`${studio.origin}/projects/${markersProject.id}?key=${studio.key}`);

    const marker = page.locator('[data-marker="beat"]');
    await marker.waitFor({ state: 'visible' });
    await block.waitFor({ state: 'visible' });
    const markerBefore = await marker.boundingBox();
    const clipBefore = await block.boundingBox();
    const trackView = await scroll.boundingBox();
    const topSpace = clipBefore.y - trackView.y;
    assert.ok(topSpace >= 36, 'the first track starts below the scrollable top padding');
    const readTop = () => scroll.evaluate((element) => element.scrollTop);
    const initialTop = await readTop();
    const wheelBy = async (pixels) => {
      const top = await readTop();
      await page.mouse.wheel(0, pixels);
      await page.waitForFunction((target) => document.querySelector('[data-timeline] .tl-scroll').scrollTop >= target, top + pixels);
      return (await readTop()) - initialTop;
    };
    await page.mouse.move(clipBefore.x + 20, trackView.y + 8);
    const firstStep = await wheelBy(12);
    const clipAfterStep = await block.boundingBox();
    assert.equal(clipAfterStep.y, clipBefore.y - firstStep, 'the first scroll reduces the top padding');
    assert.ok(clipAfterStep.y > trackView.y, 'the first clip is still below the scrollport edge');
    const clipHit = await page.evaluate(({ x, y }) => document.elementFromPoint(x + 12, y + 2)?.closest('[data-block-id]')?.dataset.blockId, clipAfterStep);
    assert.equal(clipHit, await block.getAttribute('data-block-id'), 'the top of the first clip remains visible while padding remains');
    assert.equal((await marker.boundingBox()).y, markerBefore.y, 'the marker is fixed during the first scroll step');

    const scrolledBy = await wheelBy(48);
    assert.ok(scrolledBy > topSpace, 'the space above the first track can scroll out of view');
    assert.equal((await block.boundingBox()).y, clipBefore.y - scrolledBy);
    assert.equal((await marker.boundingBox()).y, markerBefore.y, 'vertical scrolling leaves the marker in place');
    const markerHit = await page.evaluate(({ x, y }) => document.elementFromPoint(x + 4, y + 4)?.closest('[data-marker]')?.dataset.marker, markerBefore);
    assert.equal(markerHit, 'beat', 'scrolled clips cannot overlap the marker strip');

    await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const lastClip = scroll.locator('[data-block-kind]:not([data-block-kind="video"]):not([data-block-kind="mg"])');
    await lastClip.waitFor({ state: 'visible' });
    const audioBox = await lastClip.boundingBox();
    const bottomSpace = trackView.y + trackView.height - audioBox.y - audioBox.height;
    assert.ok(Math.abs(topSpace - bottomSpace) < 1, 'top and bottom scrollable padding have the same height');
    assert.equal((await marker.boundingBox()).y, markerBefore.y);

    await scroll.evaluate((element) => { element.scrollTop = 0; });
    await seek(1);
    await marker.click();
    await page.getByRole('dialog', { name: 'Beat', exact: true }).waitFor();
    await page.keyboard.press('Escape');

    const seam = page.getByRole('separator', { name: 'Resize timeline', exact: true });
    const resizeTimeline = async (dy) => {
      const divider = await seam.boundingBox();
      const x = divider.x + divider.width / 2;
      const y = divider.y + divider.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + dy, { steps: 8 });
      await page.mouse.up();
    };
    const beforeResize = await scroll.boundingBox();
    const atMainOnly = () => page.waitForFunction(() => {
      const { top, bottom, height } = document.querySelector('[data-timeline] .tl-scroll').getBoundingClientRect();
      const main = document.querySelector('[data-main-track]')?.getBoundingClientRect();
      return main && height === 96 && Math.abs(main.top - top) < 1 && Math.abs(main.bottom - bottom) < 1;
    });
    await resizeTimeline(220);
    await atMainOnly();
    const compactView = await scroll.boundingBox();
    const rulerBox = await ruler.boundingBox();
    const compactMarker = await marker.boundingBox();
    assert.ok(compactView.height < beforeResize.height);
    assert.equal(compactMarker.y, rulerBox.y + rulerBox.height, 'the markers stay immediately below the ruler while resizing');
    assert.ok(compactView.y - compactMarker.y - compactMarker.height <= 2, 'the top padding scrolls away at the main-track limit');
    const cover = await page.locator('[data-cover-tile]').boundingBox();
    assert.ok(cover.y >= compactView.y && cover.y + cover.height <= compactView.y + compactView.height);

    await resizeTimeline(-64);
    await page.waitForFunction(() => {
      const viewport = document.querySelector('[data-timeline] .tl-scroll').getBoundingClientRect();
      const main = document.querySelector('[data-main-track]')?.getBoundingClientRect();
      return main && main.top > viewport.top + 32 && Math.abs(main.bottom - viewport.bottom) < 1;
    });
    await resizeTimeline(100);
    await atMainOnly();

    const compactTop = await scroll.evaluate((element) => element.scrollTop);
    await page.mouse.move(clipBefore.x + 20, compactView.y + 8);
    await page.mouse.wheel(0, -120);
    await page.waitForFunction((top) => document.querySelector('[data-timeline] .tl-scroll').scrollTop < top, compactTop);
    assert.equal((await marker.boundingBox()).y, compactMarker.y, 'the markers stay fixed while scrolling at the minimum height');

    await resizeTimeline(-64);
    await scroll.evaluate((element) => element.scrollTo(0, 0));
    const tools = page.locator('[data-timeline] button');
    await tools.nth(1).click();
    const modeMenu = page.locator('[data-popover-panel]').filter({ hasText: 'Split' });
    await modeMenu.waitFor();
    assert.equal((await modeMenu.boundingBox()).x, (await tools.first().boundingBox()).x, 'the mode menu aligns to the left of the tool');
    await page.keyboard.press('Escape');

    const panView = await scroll.boundingBox();
    const panRuler = await ruler.boundingBox();
    const panX = panView.x + panView.width / 2;
    const pin = await marker.boundingBox();
    await page.mouse.click(pin.x + pin.width / 2 + 6, panRuler.y + 10);
    assert.ok(Number(await ruler.getAttribute('aria-valuenow')) > 1000, 'a ruler click uses its own frame near a marker');

    const dragFrom = async (x, y, dx) => {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y, { steps: 8 });
      await page.mouse.up();
    };
    const emptyY = panView.y + 12;
    const readTime = async () => Number(await ruler.getAttribute('aria-valuenow'));
    const clickAt = async (x) => { await page.mouse.click(x, emptyY); return readTime(); };
    /* Find two nearby pixels whose clicks land on different frames, then cross that boundary during one click. */
    let pressX = Math.round(panRuler.x + 42);
    let pressFrame = await clickAt(pressX);
    let releaseFrame = await clickAt(pressX + 2);
    for (let i = 0; i < 10 && pressFrame === releaseFrame; i++) {
      pressX += 2;
      pressFrame = releaseFrame;
      releaseFrame = await clickAt(pressX + 2);
    }
    assert.notEqual(pressFrame, releaseFrame);
    await seek(0);
    await dragFrom(pressX, emptyY, 2);
    assert.equal(await readTime(), releaseFrame, 'a click with slight pointer movement seeks to the release frame');

    for (const y of [panView.y - 8, panView.y + 12]) {
      await page.mouse.click(panX, panRuler.y + 10);
      const start = Number(await ruler.getAttribute('aria-valuenow'));
      const knob = await page.locator('[data-timeline] [data-zoom-bleed] [role="presentation"]').boundingBox();
      await dragFrom(knob.x + knob.width / 2, y, -70);
      assert.ok(Number(await ruler.getAttribute('aria-valuenow')) < start, 'dragging the line above the tracks scrubs at fit');
    }

    await page.getByRole('button', { name: /^Zoom in/ }).click();
    await scroll.evaluate((element) => element.scrollTo(0, 0));
    await page.mouse.click(panX, panRuler.y + 10);
    const playhead = await ruler.getAttribute('aria-valuenow');
    for (const [y, area] of [[panView.y - 8, 'the marker strip'], [panView.y + 12, 'the top padding']]) {
      await scroll.evaluate((element) => { element.scrollLeft = 0; });
      await dragFrom(panX + 40, y, -80);
      assert.equal(await scroll.evaluate((element) => element.scrollLeft), 80, `dragging ${area} pans the timeline`);
      assert.equal(await ruler.getAttribute('aria-valuenow'), playhead, `panning from ${area} keeps the playhead time`);
    }

    await seek(0);
    await scroll.evaluate((element) => element.scrollTo(0, 0));
    const secondClip = await scroll.locator('[data-block-id]').nth(1).boundingBox();
    for (const y of [panView.y + 8, panView.y - 8]) {
      await page.mouse.move(panX, y);
      await page.mouse.down();
      await page.mouse.move(panX, secondClip.y + 10, { steps: 8 });
      await page.mouse.up();
      await page.waitForFunction(() => window.lastSelection?.refs.filter((ref) => ref.kind === 'clip').length === 2);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !window.lastSelection?.refs.some((ref) => ref.kind === 'clip'));
    }
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
