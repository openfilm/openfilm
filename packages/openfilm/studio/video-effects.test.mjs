import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { filmHtml, readFilmFile } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

const modelFolder = fileURLToPath(new URL('../models/vision', import.meta.url));
const cached = existsSync(join(modelFolder, 'person.tflite')) && existsSync(join(modelFolder, 'face.task'));
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
test(
  'video effects inspector persists controls, recovers a failed model load, compares and undoes edits',
  { timeout: 120000, skip: !cached ? 'vision models not cached' : !hasFfmpeg ? 'no ffmpeg' : false },
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'of-vision-ui-'));
    const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
    const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
    for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
    let studio, browser;
    try {
      const local = join(process.env.OPENFILM_HOME, 'cache/vision/1');
      await mkdir(local, { recursive: true });
      for (const file of ['person.tflite', 'face.task']) await copyFile(join(modelFolder, file), join(local, file));
      const root = join(process.env.OPENFILM_LIBRARY, 'Effects');
      await mkdir(root, { recursive: true });
      const portrait = process.env.OPENFILM_VISION_TEST_PORTRAIT;
      const realFace = portrait && existsSync(portrait);
      if (realFace)
        execFileSync('ffmpeg', [
          '-v',
          'error',
          '-loop',
          '1',
          '-i',
          portrait,
          '-vf',
          'scale=410:512',
          '-t',
          '3',
          '-r',
          '10',
          '-c:v',
          'libvpx-vp9',
          '-pix_fmt',
          'yuv420p',
          join(root, 'v.webm'),
        ]);
      else
        execFileSync('ffmpeg', [
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'color=c=red:size=320x180:rate=10:duration=3',
          '-c:v',
          'libvpx-vp9',
          '-pix_fmt',
          'yuv420p',
          join(root, 'v.webm'),
        ]);
      const stage = realFace ? { w: 410, h: 512 } : { w: 320, h: 180 };
      await writeFile(
        join(root, 'back.svg'),
        `<svg xmlns="http://www.w3.org/2000/svg" width="${stage.w}" height="${stage.h}"><path fill="#253b42" d="M0 0h${stage.w}v${stage.h}H0z"/></svg>`,
      );
      await writeFile(
        join(root, 'film.html'),
        filmHtml({
          stage,
          tracks: [
            { clips: [{ id: 'v', src: 'v.webm', time: [0, 3] }] },
            { clips: [{ id: 'back', src: 'back.svg', time: [0, 3] }] },
          ],
        }),
      );
      const project = await openProject(root);
      studio = await startStudio({ port: 0, openBrowser: () => {} });
      browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        locale: 'en-US',
        reducedMotion: 'reduce',
      });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem('openfilm.language', 'en');
        localStorage.setItem('openfilm.project.timelineH', '400');
      });
      const until = async (check, what) => {
        for (let i = 0; i < 300; i++) {
          if (await check()) return;
          await page.waitForTimeout(100);
        }
        assert.fail(what);
      };
      const style = async () =>
        readFilmFile(await readFile(join(root, 'film.html'), 'utf8')).doc.tracks[0].clips[0].style ?? '';
      await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
      const video = page.locator('[data-block-kind="video"][data-block-title="v.webm"]');
      await video.waitFor();
      await video.click({ position: { x: 30, y: 10 } });
      await page.locator('[data-inspector-workspace]').getByRole('tab', { name: 'Effects', exact: true }).click();
      const failure = '**/__film/vision/ort-1.31.1/*.wasm';
      await page.context().route(failure, (route) => route.abort('failed'));
      await page.getByRole('switch', { name: 'Remove background', exact: true }).click();
      await until(async () => (await style()).includes('--of-cutout: 1'), 'cutout is saved in film.html');
      // A paused cutout runs a draft followed by a precise pass. Keep the outage in place
      // until both finish, or refinement can recover and remove Retry before it is clicked.
      const frame = page.frameLocator('iframe[title="film"]:not([data-loading]):not([data-leaving])');
      await until(() => frame.locator('body').evaluate(() => {
        const status = window.__filmEditor?.stage?.vision('v');
        return status?.phase === 'error' && !status.refining;
      }), 'the paused cutout finishes processing with the injected failure');
      await page.locator('[data-vision-status="error"]').waitFor();
      await page.context().unroute(failure);
      await Promise.all([
        page.waitForRequest(failure),
        page.getByRole('button', { name: 'Retry processing' }).click(),
      ]);
      await page.locator('[data-vision-status="ready"]').waitFor();
      let heldSubject;
      const blockedSubject = '**/__film/vision/subject.onnx';
      await page.context().route(blockedSubject, (route) => {
        heldSubject = route;
      });
      await page.getByRole('button', { name: 'Cutout method', exact: true }).click();
      await page.getByRole('option', { name: 'Detailed subject · download 99 MB', exact: true }).click();
      await until(async () => Boolean(heldSubject), 'the optional model starts only after it is selected');
      await page.locator('[data-vision-status="loading"]').waitFor();
      await page.getByRole('button', { name: 'Cutout method', exact: true }).click();
      await page.getByRole('option', { name: 'Portrait detail · built in', exact: true }).click();
      await page.locator('[data-vision-status="ready"]').waitFor();
      assert.ok(
        (await style()).includes('--of-cutout-mode: 1'),
        'switching back does not wait for the optional model download',
      );
      await heldSubject.abort().catch(() => {});
      await page.context().unroute(blockedSubject);
      await page.getByRole('switch', { name: 'Retouch faces', exact: true }).click();
      await until(async () => (await style()).includes('--of-beauty-smooth: 0.35'), 'face retouching is saved');
      assert.equal(await page.getByRole('slider', { name: 'Reduce blemishes', exact: true }).count(), 1);
      assert.equal(await page.getByRole('slider', { name: 'Reduce facial highlights', exact: true }).count(), 1);
      assert.equal(await page.getByRole('slider', { name: 'Retain skin texture', exact: true }).count(), 1);
      let heldParse;
      const blockedParse = '**/__film/vision/face-parse.onnx';
      await page.context().route(blockedParse, (route) => { heldParse = route; });
      await page.getByRole('button', { name: 'Face processing', exact: true }).click();
      await page.getByRole('option', { name: 'Semantic regions · Download 54 MB', exact: true }).click();
      if (realFace) {
        await until(async () => Boolean(heldParse), 'semantic face model starts only when chosen and a face is present');
        await page.getByRole('button', { name: 'Face processing', exact: true }).click();
        await page.getByRole('option', { name: 'Landmarks · Built in', exact: true }).click();
        await page.locator('[data-vision-status="ready"]').waitFor();
        await heldParse.abort().catch(() => {});
      }
      await page.context().unroute(blockedParse);
      assert.equal(await page.getByRole('slider', { name: 'Slim face', exact: true }).count(), 1);
      assert.equal(await page.getByRole('slider', { name: 'Whiten teeth', exact: true }).count(), 1);
      assert.equal(await page.getByRole('slider', { name: 'Lip tint', exact: true }).count(), 1);
      await page.getByRole('slider', { name: 'Slim face', exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Tab');
      await until(async () => (await style()).includes('--of-beauty-slim: 0.01'), 'landmark reshaping is saved');
      await page.getByRole('slider', { name: 'Brightening', exact: true }).focus();
      await page.keyboard.press('End');
      await page.keyboard.press('Tab');
      await until(async () => (await style()).includes('--of-beauty-light: 1'), 'the retouching slider commits');
      await page.locator('[data-vision-status="ready"]').waitFor();
      const compare = page.getByRole('button', { name: 'Hold to see original' });
      const bounds = await compare.boundingBox();
      assert.ok(bounds);
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.up();
      assert.ok(!(await style()).includes('--of-vision-bypass'), 'original comparison is not written to the project');
      await video.click({ position: { x: 30, y: 10 } });
      await page.keyboard.press('ControlOrMeta+z');
      await until(async () => (await style()).includes('--of-beauty-light: 0.15'), 'retouching is undoable');
      if (process.env.OPENFILM_VISION_TEST_SCREENSHOT) {
        await page.locator('[data-vision-status="ready"]').waitFor();
        await page.locator('[data-section="cutout"]').scrollIntoViewIfNeeded();
        await page.screenshot({ path: process.env.OPENFILM_VISION_TEST_SCREENSHOT });
      }
      await page.getByRole('button', { name: 'Reset retouching', exact: true }).click();
      await until(async () => !(await style()).includes('--of-beauty-'), 'retouching reset keeps cutout');
      assert.ok((await style()).includes('--of-cutout: 1'));
      await page.getByRole('switch', { name: 'Remove background', exact: true }).click();
      await until(async () => !(await style()).includes('--of-cutout: 1'), 'cutout can be disabled');
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
  },
);
