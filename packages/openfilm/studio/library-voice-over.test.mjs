import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml, readFilmFile } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('voice-over and captions are the library’s: recording is a line of voice-over and goes on while another category is shown', { timeout: 120_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-library-voice-over-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Record');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'card.html'), '<!doctype html><body style="margin:0;background:#123"><script>window.film={duration:8,width:640,height:360,frame(){}}</script>');
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 640, h: 360 }, tracks: [{ clips: [{ id: 'card', src: 'card.html', time: [0, 8] }] }] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    /* a microphone of Chromium's own (a tone), allowed without asking */
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'en-US', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('openfilm.project.timelineH', '360');
      localStorage.setItem('openfilm.project.assets', '1');
      localStorage.setItem('openfilm.language', 'en');
    });
    const film = async () => readFilmFile(await readFile(join(root, 'film.html'), 'utf8')).doc;
    const until = async (check, what) => {
      for (let i = 0; i < 100; i += 1) { if (await check()) return; await page.waitForTimeout(100); }
      assert.fail(what);
    };
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    await page.locator('[data-block-id]').first().waitFor();
    const drawer = page.locator('[data-studio-library]');
    /* none on the timeline's toolbar: they are categories of the library */
    assert.equal(await page.locator('[data-timeline]').getByRole('button', { name: /Record audio|Voice-over/ }).count(), 0);
    const voices = drawer.getByRole('button', { name: 'Voices', exact: true });
    await voices.click();
    /* recording is a tab of Mine, beside the voices and cloning */
    assert.deepEqual(await drawer.locator('nav[data-studio-host-panel] [data-rail-section] > button[aria-expanded], nav[data-studio-host-panel] button[aria-pressed]').evaluateAll((rows) => rows.slice(0, 3).map((r) => r.textContent?.trim())), ['Favorites', 'Mine', 'Services']);
    await drawer.getByRole('button', { name: 'Mine', exact: true }).click();
    /* Mine: recording at the top, then cloning a voice */
    assert.deepEqual(await drawer.locator('[data-voice-mine] h3').allInnerTexts(), ['Record', 'Voice cloning']);
    await drawer.getByRole('button', { name: 'Record audio', exact: true }).click();
    await drawer.locator('[data-record-pane="recording"]').waitFor();
    /* another category shown: it still records, and voice-over says so */
    await drawer.getByRole('button', { name: 'Captions', exact: true }).click();
    await drawer.locator('[data-record-pane]').waitFor({ state: 'detached' });
    assert.deepEqual(await drawer.locator('nav[data-studio-host-panel] button[aria-pressed]').allInnerTexts(), ['From speech', 'Subtitle file', 'By hand']);
    await drawer.getByRole('button', { name: 'By hand', exact: true }).click();
    await drawer.locator('[data-captions-new-track]').waitFor();
    await voices.locator('[data-recording]').waitFor();
    await page.waitForTimeout(1200);
    /* back on voice-over: on the recording */
    await voices.click();
    await drawer.getByRole('button', { name: 'Stop and add to the timeline', exact: true }).click();
    await until(async () => (await film()).tracks.some((t) => t.clips.some((c) => /Recording .*\.wav$/.test(c.src))), 'the recording is put on the film');
    await drawer.locator('[data-record-pane="idle"]').waitFor();
    await voices.locator('[data-recording]').waitFor({ state: 'detached' });
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

test('a line of the library’s side bar held and moved: the others make room as it goes, Esc puts it back, letting go keeps it', { timeout: 120_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-library-rail-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    for (const folder of ['Alpha', 'Beta', 'Gamma']) await mkdir(join(process.env.OPENFILM_SAVED, folder), { recursive: true });
    const root = join(process.env.OPENFILM_LIBRARY, 'Rail');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 640, h: 360 }, tracks: [] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'en-US', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('openfilm.project.assets', '1');
      localStorage.setItem('openfilm.language', 'en');
    });
    await page.route('**/api/examples', (route) => route.fulfill({ json: { examples: [] } }));
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const drawer = page.locator('[data-studio-library]');
    const line = (key) => drawer.locator(`[data-rail-line="${key}"]`);
    const lines = () => drawer.locator('[data-rail-line]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-rail-line')));
    await line('saved/Gamma').waitFor();
    /* the project's line is "Import", and "+ Add" says what it does */
    assert.equal((await line('project').innerText()).trim(), 'Import');
    assert.equal((await drawer.locator('[data-rail-add]').innerText()).trim(), 'Add');
    const start = await lines();
    const [first, second, third] = start.slice(1);
    const top = async (key) => (await line(key).boundingBox()).y;
    const a = await line(first).boundingBox();
    const yThird = await top(third);
    /* held and moved down past the others: it follows the pointer, they move up a line each, and nothing is written yet */
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 20, { steps: 4 });
    await page.mouse.move(a.x + a.width / 2, yThird + a.height / 2 + 6, { steps: 6 });
    await line(first).and(drawer.locator('[data-rail-held]')).waitFor();
    assert.ok(Math.abs((await top(first)) - (yThird + 6)) <= 2, 'the line held is under the pointer');
    assert.ok((await top(third)) < yThird - 20, 'the line passed has moved up to make room');
    /* Esc: back where it was */
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await drawer.locator('[data-rail-held]').waitFor({ state: 'detached' });
    assert.deepEqual(await lines(), start);
    /* again, let go: there at once, and kept */
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2, yThird + a.height / 2 + 6, { steps: 8 });
    await page.mouse.up();
    assert.deepEqual(await lines(), [start[0], second, third, first, ...start.slice(4)]);
    for (let i = 0; i < 50; i++) {
      const kept = JSON.parse(await readFile(join(process.env.OPENFILM_SAVED, '.openfilm-shelf.json'), 'utf8').catch(() => '{"shelf":[]}'));
      if (kept.shelf.indexOf(first) > kept.shelf.indexOf(third)) break;
      assert.ok(i < 49, 'the order is kept in the library folder');
      await page.waitForTimeout(100);
    }
    /* a line let go is not also clicked: the one shown stays */
    assert.equal(await line(first).getAttribute('aria-pressed'), 'false');
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
