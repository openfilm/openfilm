import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

/** Reference in chat's shortcut as the menu shows it on this computer */
const REFER_KEYS = process.platform === 'darwin' ? '⌘L' : 'Ctrl+L';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('a click only selects; a right click gives the whole menu, Reference first, the same in Layers and on the picture', { timeout: 90_000, skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-context-menus-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Menus');
    await mkdir(join(root, 'assets'), { recursive: true });
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=4', '-shortest', '-pix_fmt', 'yuv420p', join(root, 'assets', 'clip.mp4')]);
    await writeFile(join(root, 'card.html'), `<!doctype html><body style="margin:0">
  <h1 id="title" style="position:absolute;left:20px;top:15px;margin:0;font:700 24px sans-serif;color:#fff">Every parcel</h1>
  <p id="sub" style="position:absolute;left:20px;top:60px;margin:0;font:14px sans-serif;color:#fff">Arrives on time</p>
<script>window.film={duration:4,frame(){}}</script></body>`);
    await writeFile(join(root, 'film.html'), filmHtml({
      stage: { w: 320, h: 180 },
      tracks: [{ clips: [{ id: 'card', src: 'card.html', time: [0, 4] }] }, { clips: [{ id: 'clip', src: 'assets/clip.mp4', time: [0, 4] }] }],
    }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-US', reducedMotion: 'reduce' });
    /* the app's chat, so the menus have "Reference in chat"; the Layers panel open */
    await page.addInitScript(() => {
      localStorage.setItem('openfilm.project.layers', '1');
      window.referred = [];
      window.openfilmHost = { version: 1, refer: (ref) => window.referred.push(ref) };
    });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    /* the menu open now, as its rows read: `id|label` (`-` a line between groups), null for none */
    const menu = () => page.evaluate(() => {
      const el = document.querySelector('[role="menu"]');
      return el ? [...el.children].map((row) => (row.getAttribute('role') === 'menuitem' ? `${row.id.replace(/^ctxmenu-/, '')}|${row.textContent}` : '-')) : null;
    });
    const until = async (check, what) => {
      for (let i = 0; i < 50; i += 1) { if (await check()) return; await page.waitForTimeout(100); }
      assert.fail(what);
    };

    /* a clip on the timeline: Reference, a line, then the rest, with what its bar had (Duplicate, Speed, Mute) */
    const video = page.locator('[data-block-id]').nth(1);
    await video.waitFor({ state: 'visible' });
    await video.click({ position: { x: 20, y: 10 } });
    await video.click({ button: 'right', position: { x: 20, y: 10 } });
    await until(async () => (await menu())?.length, 'the clip menu opens');
    const clipMenu = await menu();
    assert.deepEqual(clipMenu.slice(0, 2), [`refer|Reference in chat${REFER_KEYS}`, '-']);
    for (const id of ['duplicate', 'speed', 'mute', 'copy-attrs']) assert.ok(clipMenu.some((row) => row.startsWith(`${id}|`)), id);
    /* Speed is checked while on, and the clip's edges say so; it is in the menu only, not in the timeline's toolbar */
    assert.equal(await page.locator('[data-timeline] button[aria-label^="Speed"]').count(), 0);
    await page.getByRole('menuitem', { name: /^Speed/ }).click();
    await until(() => page.locator('[data-timeline][data-speed-mode]').count(), 'Speed turns the edges into speed handles');
    assert.ok(await video.locator('[data-speed-handle]').count() > 0, 'the clip\'s edges change its speed');
    /* said by the frame's color alone: no bars or dots on its edges */
    assert.equal(await video.locator('[data-block-frame="speed"]').count(), 1);
    assert.equal(await video.locator('[data-speed-handle] *, [data-trim] *, [data-fade-handle]').count(), 0, 'nothing drawn on its edges');
    await video.click({ button: 'right', position: { x: 20, y: 10 } });
    await until(async () => (await menu())?.some((row) => row.startsWith('speed|✓')), 'Speed is checked in the menu');
    await page.getByRole('menuitem', { name: /^Copy attributes/ }).click();
    await page.getByText(/^Attributes copied:/).waitFor({ state: 'visible' });

    /* a layer's row in the Layers panel and the layer on the picture: one menu, the layer selected */
    const row = page.locator('[data-layers-panel] [role="treeitem"]').filter({ hasText: 'Arrives on time' });
    await row.waitFor({ state: 'visible' });
    await row.click({ button: 'right' });
    await until(async () => (await menu())?.length, 'the Layers menu opens');
    const layersMenu = await menu();
    assert.deepEqual(layersMenu.slice(0, 2), [`refer|Reference in chat${REFER_KEYS}`, '-']);
    for (const id of ['edit-text', 'front', 'hide', 'lock', 'reset', 'copy-layers', 'delete']) assert.ok(layersMenu.some((row) => row.startsWith(`${id}|`)), id);
    assert.equal(await row.getAttribute('aria-selected'), 'true');
    /* a press anywhere else closes it (the picture letting go re-rendered the panel under the press, 2026-10-29) */
    const timeline = await page.locator('[data-timeline]').boundingBox();
    await page.mouse.click(timeline.x + timeline.width - 40, timeline.y + timeline.height - 20);
    await until(async () => (await menu()) === null, 'a click outside closes the Layers menu');
    const film = await page.locator('[data-viewer-picture] iframe').first().boundingBox();
    const scale = film.width / 320;
    await page.mouse.click(film.x + 60 * scale, film.y + 68 * scale, { button: 'right' });
    await until(async () => (await menu())?.length, 'the picture menu opens');
    assert.deepEqual(await menu(), layersMenu, 'the Layers menu is the picture element\'s');
    await page.keyboard.press('Escape');
    await until(async () => (await menu()) === null, 'Esc closes the menu');

    /* a click only selects: no bar of buttons comes up beside what is selected */
    await row.click();
    await video.click({ position: { x: 20, y: 10 } });
    assert.equal(await page.locator('[role="toolbar"]').count(), 0);
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
