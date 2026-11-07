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

const card = (title) => `<!doctype html><body style="margin:0">
  <h1 id="title" style="position:absolute;left:80px;top:200px;margin:0;font:700 90px sans-serif;color:#fff">${title}</h1>
  <p id="sub" style="position:absolute;left:80px;top:400px;margin:0;font:60px sans-serif;color:#fff">Arrives on time</p>
<script>window.film={duration:6,frame(){}}</script></body>`;

test('a page clip edited, or written by an agent, keeps its thumbnails until the new ones are in', { timeout: 120_000, skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-timeline-thumbs-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Thumbs');
    await mkdir(join(root, 'assets'), { recursive: true });
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=540x960:rate=25:duration=6', '-pix_fmt', 'yuv420p', join(root, 'assets', 'clip.mp4')]);
    await writeFile(join(root, 'card.html'), card('Every parcel'));
    await writeFile(join(root, 'film.html'), filmHtml({
      stage: { w: 1080, h: 1920 },
      tracks: [{ clips: [{ id: 'card', src: 'card.html', time: [0, 6] }] }, { clips: [{ id: 'clip', src: 'assets/clip.mp4', time: [0, 6] }] }],
    }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-US', reducedMotion: 'reduce' });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const until = async (check, what, tries = 200) => {
      for (let i = 0; i < tries; i += 1) { if (await check()) return; await page.waitForTimeout(100); }
      assert.fail(what);
    };

    /* the page clip's row of pictures, all in */
    const clip = page.locator('[data-block-kind="mg"]');
    await clip.waitFor({ state: 'visible' });
    const drawn = () => clip.evaluate((el) => [...el.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth > 0).length);
    await until(async () => (await drawn()) >= 3, 'the page clip has its thumbnails');
    /* each version of the page drawn, by its address */
    const versions = () => clip.evaluate((el) => [...new Set([...el.querySelectorAll('img')].map((i) => new URL(i.src).searchParams.get('v')))]);
    const [first] = await versions();

    /* from now on a picture of the page takes a while to draw, as a big page's does: a gap would show */
    await page.route(/what=(frame|poster)/, async (route) => { await new Promise((go) => setTimeout(go, 300)); await route.continue(); });
    /* every frame of the screen: how many pictures the clip draws. A cell whose address changes goes on showing its
       picture until the new one has loaded (the browser keeps it), so a cell that has shown one counts */
    await page.evaluate(() => {
      window.thumbFrames = [];
      const showed = new WeakSet();
      const tick = () => {
        const el = document.querySelector('[data-block-kind="mg"]');
        const cells = el ? [...el.querySelectorAll('img')].filter((i) => i.style.visibility !== 'hidden') : [];
        for (const i of cells) if (i.complete && i.naturalWidth > 0) showed.add(i);
        window.thumbFrames.push(cells.filter((i) => showed.has(i)).length);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const gaps = () => page.evaluate(() => { const n = window.thumbFrames.filter((count) => count <= 0).length; window.thumbFrames = []; return n; });

    /* a layer moved in the picture: the clip's pictures are drawn again with the move; the old ones stay meanwhile */
    const film = await page.locator('[data-viewer-picture] iframe').first().boundingBox();
    const scale = film.width / 1080;
    await page.mouse.click(film.x + 200 * scale, film.y + 440 * scale);
    await page.waitForTimeout(400);
    await page.keyboard.press('Shift+ArrowRight');
    await until(async () => { const v = await versions(); return v.length === 1 && v[0] !== first; }, 'the moved layer\'s pictures take the old ones\' place', 300);
    assert.equal(await gaps(), 0, 'not one frame without a picture while the new ones were drawn');
    const [moved] = await versions();

    /* an agent writes the page: the same */
    await writeFile(join(root, 'card.html'), card('Every parcel, every day'));
    await until(async () => { const v = await versions(); return v.length === 1 && v[0] !== moved; }, 'the written page\'s pictures take the old ones\' place', 300);
    assert.equal(await gaps(), 0, 'not one frame without a picture while the agent\'s page was drawn');
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
