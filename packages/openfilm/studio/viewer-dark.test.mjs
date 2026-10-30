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

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('a click or a box in the dark around the picture selects no text: the picture is never tinted blue', { timeout: 90_000, skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-viewer-dark-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Dark');
    await mkdir(join(root, 'assets'), { recursive: true });
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=540x960:rate=25:duration=4', '-pix_fmt', 'yuv420p', join(root, 'assets', 'clip.mp4')]);
    await writeFile(join(root, 'card.html'), `<!doctype html><body style="margin:0">
  <h1 id="title" style="position:absolute;left:80px;top:200px;margin:0;font:700 90px sans-serif;color:#fff">Every parcel</h1>
  <p id="sub" style="position:absolute;left:80px;top:400px;margin:0;font:60px sans-serif;color:#fff">Arrives on time</p>
  <p id="tag" style="position:absolute;left:80px;top:520px;margin:0;font:60px sans-serif;color:#fff">Every day</p>
<script>window.film={duration:4,frame(){}}</script></body>`);
    await writeFile(join(root, 'film.html'), filmHtml({
      stage: { w: 1080, h: 1920 },
      tracks: [{ clips: [{ id: 'card', src: 'card.html', time: [0, 4] }] }, { clips: [{ id: 'clip', src: 'assets/clip.mp4', time: [0, 4] }] }],
    }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-US', reducedMotion: 'reduce' });
    await page.addInitScript(() => { localStorage.setItem('openfilm.project.layers', '1'); });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const until = async (check, what) => {
      for (let i = 0; i < 50; i += 1) { if (await check()) return; await page.waitForTimeout(100); }
      assert.fail(what);
    };
    /* the browser's own selection: a range over the picture is what tinted it blue */
    const selection = () => page.evaluate(() => getSelection().type);
    const pickedLayers = () => page.locator('[data-layers-panel] [role="treeitem"][aria-selected="true"]').allTextContents();
    const wholeClip = () => page.locator('[data-mg-kind]').count();

    /* a slow machine takes a while to open the project and fill its Layers */
    await page.locator('[data-layers-panel] [role="treeitem"]').filter({ hasText: 'Every day' }).waitFor({ state: 'visible', timeout: 120_000 });
    const film = await page.locator('[data-viewer-picture] iframe').first().boundingBox();
    const area = await page.locator('[data-viewer-picture]').boundingBox();
    const scale = film.width / 1080;
    const dark = { x: area.x + (film.x - area.x) / 2, y: film.y + film.height / 2 };
    assert.ok(film.x - area.x > 20, 'there is dark left of the picture');

    /* a layer selected, then a click in the dark as a hand makes it (a few px of drag): the selection goes, no text
       is selected, nothing is drawn */
    await page.mouse.click(film.x + 200 * scale, film.y + 440 * scale);
    await until(async () => (await pickedLayers()).length === 1, 'the layer is selected');
    await page.mouse.move(dark.x, dark.y);
    await page.mouse.down();
    await page.mouse.move(dark.x + 4, dark.y + 2, { steps: 2 });
    await page.mouse.up();
    await until(async () => (await pickedLayers()).length === 0, 'a click in the dark lets the layer go');
    assert.notEqual(await selection(), 'Range');
    assert.equal(await wholeClip(), 0, 'no clip is taken in hand');
    assert.equal(await page.locator('[data-layer-kind]').count(), 0, 'no frame is drawn');

    /* a double click there selects no words either */
    await page.mouse.dblclick(dark.x, dark.y);
    assert.notEqual(await selection(), 'Range');

    /* a box drawn from the dark around two of the three lines: those two layers, not the clip, and no text */
    await page.mouse.move(dark.x, film.y + 370 * scale);
    await page.mouse.down();
    await page.mouse.move(film.x + 700 * scale, film.y + 470 * scale, { steps: 4 });
    await page.mouse.move(film.x + 800 * scale, film.y + 640 * scale, { steps: 4 });
    assert.notEqual(await selection(), 'Range', 'drawing the box selects no text');
    await page.mouse.up();
    await page.getByText('2 layers selected').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-group-kind]').count() > 0, true, 'their box, each outlined inside it');
    assert.equal(await wholeClip(), 0, 'not the whole clip');
    assert.notEqual(await selection(), 'Range');
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
