import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('mouse preview starts off, its empty-space menu shows the switch and shortcut, and Space plays from the enabled preview', { timeout: 60_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-skimming-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS', 'TRASH_DIR'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Skimming');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'card.html'), '<!doctype html><body style="margin:0;background:#123"><script>window.film={duration:12,width:320,height:180,frame(t){document.body.dataset.at=String(t);document.body.style.background=t<6?"#123":"#456"}}</script>');
    const film = filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'card', src: 'card.html', time: [0, 12] }] }] });
    await writeFile(join(root, 'film.html'), film);
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {}, editorDir: process.env.OPENFILM_TEST_EDITOR_DIR });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'en-US', reducedMotion: 'reduce' });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('openfilm.language', 'en'));
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const timeline = page.locator('[data-timeline]');
    const ruler = timeline.locator('[role="slider"]').first();
    const block = timeline.locator('[data-block-id]').first();
    const skimmer = timeline.locator('[data-timeline-skimmer]');
    const toggle = page.getByRole('menuitem', { name: /Mouse preview/ });
    const emptyMenu = async () => {
      const scroller = timeline.locator('.tl-scroll');
      const box = await scroller.boundingBox();
      await scroller.click({ button: 'right', position: { x: box.width - 20, y: box.height - 20 } });
      await toggle.waitFor();
    };
    await block.waitFor();
    const preview = () => page.frames().find(f => f.url().includes('/card.html'));
    // Starting playback can replace the paused viewer with one at its playback resolution.
    const pictureAt = async (check) => {
      for (let i = 0; i < 100; i += 1) {
        const at = await preview()?.evaluate(() => Number(document.body.dataset.at)).catch(() => NaN);
        if (Number.isFinite(at) && check(at)) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.fail('the viewer did not show the expected frame');
    };
    await pictureAt(at => at < 0.1);
    const box = await block.boundingBox();
    const hover = async () => {
      await page.mouse.move(box.x + (box.width + 1) / 2, box.y + 25);
      await skimmer.waitFor({ state: 'visible' });
    };
    assert.equal(await timeline.getAttribute('data-timeline-skimming'), '0', 'mouse preview is off by default');
    await page.mouse.move(box.x + (box.width + 1) / 2, box.y + 25);
    assert.equal(await skimmer.isVisible(), false);
    await pictureAt(at => at < 0.1);
    await emptyMenu();
    assert.match(await toggle.textContent(), /S/);
    assert.doesNotMatch(await toggle.textContent(), /✓/);
    await toggle.click();
    assert.equal(await timeline.getAttribute('data-timeline-skimming'), '1');
    await hover();
    const at = Number(await skimmer.getAttribute('data-ms'));
    assert.ok(Math.abs(at - 6000) < 50);
    assert.equal(await ruler.getAttribute('aria-valuenow'), '0', 'preview never seeks the playhead');
    await pictureAt(at => at > 5.9);
    await page.mouse.move(10, 10);
    await skimmer.waitFor({ state: 'hidden' });
    await pictureAt(at => at < 0.1);
    await hover();
    await page.keyboard.press('Space');
    await skimmer.waitFor({ state: 'hidden' });
    await pictureAt(at => at > 6.1);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => Number(document.querySelector('[data-timeline] [role="slider"]').getAttribute('aria-valuenow')) > 6000);
    const paused = Number(await ruler.getAttribute('aria-valuenow'));
    assert.ok(paused < 10_000, 'Space pauses at the new playback position');
    await page.keyboard.press('s');
    assert.equal(await timeline.getAttribute('data-timeline-skimming'), '0');
    await page.mouse.move(box.x + (box.width + 1) / 3, box.y + 25);
    assert.equal(await skimmer.isVisible(), false);
    await page.reload();
    await block.waitFor();
    assert.equal(await timeline.getAttribute('data-timeline-skimming'), '0', 'the preference survives a reload');
    await ruler.click({ button: 'right', position: { x: 100, y: 10 } });
    await page.getByRole('menuitem', { name: /Mouse preview/ }).click();
    assert.equal(await timeline.getAttribute('data-timeline-skimming'), '1');
    await page.evaluate(() => {
      const input = document.createElement('input'); input.id = 'skimming-typing'; document.body.append(input); input.focus();
    });
    await page.keyboard.press('s');
    assert.equal(await page.locator('#skimming-typing').inputValue(), 's');
    assert.equal(await timeline.getAttribute('data-timeline-skimming'), '1', 'typing does not toggle the preference');
    await emptyMenu();
    assert.match(await toggle.textContent(), /✓/);
    assert.match(await toggle.textContent(), /S/);
    await toggle.click();
    assert.equal(await timeline.getAttribute('data-timeline-skimming'), '0');
    assert.equal(await readFile(join(root, 'film.html'), 'utf8'), film);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
