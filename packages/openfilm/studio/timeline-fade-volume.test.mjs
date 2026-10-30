import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { clipFade, filmHtml, readFilmFile } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('a selected clip has a fade dot just inside each end where its sound starts, a hairline across its sound for its volume, and no bars on its edges', { timeout: 90_000, skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-fade-volume-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Levels');
    await mkdir(join(root, 'assets'), { recursive: true });
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=4', '-shortest', '-pix_fmt', 'yuv420p', join(root, 'assets', 'clip.mp4')]);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4', join(root, 'assets', 'tune.wav')]);
    await writeFile(join(root, 'film.html'), filmHtml({
      stage: { w: 320, h: 180 },
      tracks: [
        { clips: [{ id: 'clip', src: 'assets/clip.mp4', at: 0.5, time: [0, 4] }] },
        { clips: [{ id: 'tune', src: 'assets/tune.wav', at: 0.5, time: [0, 4] }] },
      ],
    }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US', reducedMotion: 'reduce' });
    /* a timeline tall enough for both rows */
    await page.addInitScript(() => { localStorage.setItem('openfilm.project.timelineH', '420'); });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const until = async (check, what) => {
      for (let i = 0; i < 50; i += 1) { if (await check()) return; await page.waitForTimeout(100); }
      assert.fail(what);
    };
    const clipOf = async (id) => readFilmFile(await readFile(join(root, 'film.html'), 'utf8')).doc.tracks.flatMap((tr) => tr.clips).find((c) => c.id === id);
    const middle = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
    const video = page.locator('[data-block-id][data-block-kind="video"]');
    const sound = page.locator('[data-block-id]:not([data-block-kind="video"])').first();
    await video.waitFor({ state: 'visible' });
    await sound.waitFor({ state: 'visible' });

    /* not selected: no dots, no line */
    assert.equal(await page.locator('[data-fade-handle], [data-volume-line]').count(), 0);

    /* the video selected: a dot just inside each end, all of it within the clip, on the top of its audio band */
    await video.click({ position: { x: 100, y: 8 } });
    const clip = await video.boundingBox();
    const band = await video.locator('[data-audio-band]').boundingBox();
    const dotBoxIn = await video.locator('[data-fade-handle="in"] > span').boundingBox();
    const dotBoxOut = await video.locator('[data-fade-handle="out"] > span').boundingBox();
    assert.ok(dotBoxIn.x >= clip.x - 0.5 && dotBoxIn.x <= clip.x + 2, 'the fade in dot is inside the clip, at its start');
    assert.ok(dotBoxOut.x + dotBoxOut.width <= clip.x + clip.width + 0.5 && dotBoxOut.x + dotBoxOut.width >= clip.x + clip.width - 2, 'the fade out dot is inside the clip, at its end');
    const dotIn = middle(dotBoxIn);
    const dotOut = middle(dotBoxOut);
    assert.ok(Math.abs(dotIn.y - band.y) <= 1 && Math.abs(dotOut.y - band.y) <= 1, 'where its sound starts');
    /* its edges draw nothing: the selection frame is the edge pulled, with the resize cursor, hovered or not */
    assert.equal(await video.locator('[data-trim]').count(), 2);
    assert.equal(await video.locator('[data-trim] *').count(), 0, 'no bars on its edges');
    await page.mouse.move(clip.x + 1, clip.y + 10);
    assert.equal(await page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)).cursor, [clip.x + 1, clip.y + 10]), 'ew-resize');
    /* its volume line across the band, as is a little above the middle: a hairline, faint */
    const line = video.locator('[data-volume-line]');
    assert.equal(await line.getAttribute('data-volume-line'), '1');
    const lineAt = middle(await line.boundingBox());
    assert.ok(lineAt.y > band.y && lineAt.y < band.y + band.height / 2, 'in the upper half of the band');
    const hair = await line.locator('> span').first().evaluate((el) => ({ h: el.getBoundingClientRect().height, opacity: Number(getComputedStyle(el).opacity) }));
    assert.ok(hair.h <= 1 && hair.opacity <= 0.35, `a faint hairline (${JSON.stringify(hair)})`);
    assert.ok((await line.boundingBox()).height >= 6, 'with a grab wider than it');

    /* a dot dragged inward: the clip fades in, its slope starting at the dot */
    await page.mouse.move(dotIn.x, dotIn.y);
    await page.mouse.down();
    await page.mouse.move(dotIn.x + 30, dotIn.y, { steps: 4 });
    await page.mouse.move(dotIn.x + 60, dotIn.y, { steps: 4 });
    await page.mouse.up();
    await until(async () => (clipFade(await clipOf('clip'))?.[0] ?? 0) > 0, 'the fade in is written');
    assert.equal(await video.locator('[data-fade-ramp]').count(), 1);
    const dotNow = middle(await video.locator('[data-fade-handle="in"]').boundingBox());
    const slopeTop = Number(await video.locator('[data-fade-ramp] line').first().getAttribute('x2'));
    assert.ok(Math.abs(clip.x + slopeTop - dotNow.x) <= 1, 'the slope starts at the dot');

    /* the line dragged down: quieter, one step undone by Undo */
    await page.mouse.move(clip.x + clip.width / 2, lineAt.y);
    await page.mouse.down();
    await page.mouse.move(clip.x + clip.width / 2, lineAt.y + 3, { steps: 3 });
    await page.mouse.move(clip.x + clip.width / 2, lineAt.y + 5, { steps: 3 });
    await page.mouse.up();
    await until(async () => (await clipOf('clip'))?.volume < 1, 'the volume is written');
    assert.equal(Number(await line.getAttribute('data-volume-line')), (await clipOf('clip')).volume);
    await page.locator('button[aria-label^="Undo"]').click();
    await until(async () => (await clipOf('clip'))?.volume == null || (await clipOf('clip')).volume === 1, 'Undo puts it back');
    assert.ok((clipFade(await clipOf('clip'))?.[0] ?? 0) > 0, 'the fade stays');

    /* a sound selected: the dots on the top of its waveform, under its name */
    await sound.click({ position: { x: 100, y: 6 } });
    const soundBox = await sound.boundingBox();
    const soundDotBox = await sound.locator('[data-fade-handle="out"] > span').boundingBox();
    assert.ok(soundDotBox.x + soundDotBox.width <= soundBox.x + soundBox.width + 0.5 && soundDotBox.x + soundDotBox.width >= soundBox.x + soundBox.width - 2, 'inside its end');
    const soundDot = middle(soundDotBox);
    assert.ok(Math.abs(soundDot.y - (soundBox.y + 15)) <= 1, 'under its name');
    assert.equal(await sound.locator('[data-volume-line]').count(), 1);
    assert.equal(await video.locator('[data-fade-handle], [data-volume-line]').count(), 0);
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
