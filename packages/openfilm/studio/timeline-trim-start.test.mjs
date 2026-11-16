import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml, readFilmFile } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('a selected head trims under the hand at a shared cut, then magnetic following clips close up on release', { timeout: 90_000, skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-head-trim-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS', 'TRASH_DIR'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Head trim');
    await mkdir(root, { recursive: true });
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25:duration=12', '-pix_fmt', 'yuv420p', join(root, 'clip.mp4')]);
    const original = filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [
      { id: 'a', src: 'clip.mp4', time: [0, 4] },
      { id: 'b', src: 'clip.mp4', at: 4, time: [2, 6] },
      { id: 'c', src: 'clip.mp4', at: 8, time: [6, 10] },
    ] }] });
    const path = join(root, 'film.html');
    await writeFile(path, original);
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {}, editorDir: process.env.OPENFILM_TEST_EDITOR_DIR });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const clips = async () => readFilmFile(await readFile(path, 'utf8')).value.tracks[0].clips;
    const until = async (check) => {
      for (let i = 0; i < 100; i += 1) {
        if (await check()) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.fail('the trim was not written');
    };
    for (const magnet of [true, false]) {
      await writeFile(path, original);
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'en-US', reducedMotion: 'reduce' });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.setDefaultTimeout(8000);
      await page.addInitScript((magnet) => {
        localStorage.setItem('openfilm.language', 'en');
        localStorage.setItem('openfilm.timeline.snap', '0');
        localStorage.setItem('openfilm.timeline.mainTrackMagnet', magnet ? '1' : '0');
        localStorage.setItem('openfilm.timeline.mainTrackLinkage', '0');
      }, magnet);
      await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
      // All clips share one source name, so identify the ordered row's three blocks.
      const rowClips = page.locator('[data-block-id][data-block-kind="video"]');
      const a = rowClips.nth(0), middle = rowClips.nth(1), c = rowClips.nth(2);
      await middle.waitFor();
      await middle.click({ position: { x: 30, y: 8 } });
      await middle.locator('[data-block-frame]').waitFor();
      const before = await middle.boundingBox();
      const following = await c.boundingBox();
      const x = before.x - 2, y = before.y + before.height / 2;
      const owner = await page.evaluate(({ x, y }) => {
        const handle = document.elementFromPoint(x, y)?.closest('[data-trim]');
        return { edge: handle?.getAttribute('data-trim'), id: handle?.closest('[data-block-id]')?.getAttribute('data-block-id') };
      }, { x, y });
      assert.deepEqual(owner, { edge: 'start', id: await middle.getAttribute('data-block-id') }, 'the selected head owns the shared boundary');
      const pxPerSecond = (before.width + 1) / 4;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + pxPerSecond, y, { steps: 8 });
      await page.waitForFunction(({ id, left }) => {
        const el = document.querySelector(`[data-block-id="${id}"]`);
        return el.getBoundingClientRect().left > left + 10;
      }, { id: await middle.getAttribute('data-block-id'), left: before.x });
      const held = await middle.boundingBox();
      assert.ok(Math.abs(held.x - before.x - pxPerSecond) < 3, 'the left edge follows the hand');
      assert.ok(Math.abs(held.x + held.width - before.x - before.width) < 2, 'the tail stays still while held');
      assert.ok(Math.abs((await c.boundingBox()).x - following.x) < 2, 'following clips wait for release');
      assert.equal(await readFile(path, 'utf8'), original, 'dragging alone does not write the film');
      await page.mouse.up();
      await until(async () => (await clips())[1].time[0] > 2.5);
      const [first, trimmed, next] = await clips();
      assert.deepEqual(first.time, [0, 4], 'the previous clip is untouched');
      const amount = trimmed.time[0] - 2;
      assert.ok(Math.abs(amount - 1) < 0.05);
      assert.equal(trimmed.time[1], 6, 'only the source head was trimmed');
      assert.ok(Math.abs(trimmed.at - (magnet ? 4 : 4 + amount)) < 0.001);
      assert.ok(Math.abs(next.at - (magnet ? 8 - amount : 8)) < 0.001);
      assert.deepEqual(next.time, [6, 10]);
      await page.locator('button[aria-label^="Undo"]').click();
      await until(async () => JSON.stringify((await clips()).map(c => [c.id, c.at ?? 0, c.time])) === JSON.stringify([['a', 0, [0, 4]], ['b', 4, [2, 6]], ['c', 8, [6, 10]]]));
      await page.waitForFunction(({ id, width }) => Math.abs(document.querySelector(`[data-block-id="${id}"]`).getBoundingClientRect().width - width) < 2,
        { id: await middle.getAttribute('data-block-id'), width: before.width });
      // Cancelling a head trim restores both its edge and all following clips.
      const restored = await middle.boundingBox();
      const unchanged = await readFile(path, 'utf8');
      await page.mouse.move(restored.x + 1, y);
      await page.mouse.down();
      await page.mouse.move(restored.x + 1 + pxPerSecond, y, { steps: 6 });
      await page.keyboard.press('Escape');
      await page.mouse.up();
      assert.equal(await readFile(path, 'utf8'), unchanged);
      assert.ok(Math.abs((await middle.boundingBox()).width - restored.width) < 2);
      // Selecting the previous clip gives its tail the same priority at the cut.
      await a.click({ position: { x: 30, y: 8 } });
      const tail = await a.boundingBox();
      assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-trim]')?.getAttribute('data-trim'),
        { x: tail.x + tail.width + 2, y }), 'end');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
