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

test('resizing video and sound tracks grows their waveforms and keeps the sound controls aligned', { timeout: 90_000, skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-wave-height-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Wave heights');
    await mkdir(join(root, 'assets'), { recursive: true });
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=320x180:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=4', '-af', 'volume=6', '-shortest', '-pix_fmt', 'yuv420p', join(root, 'assets', 'clip.mp4')]);
    await writeFile(join(root, 'film.html'), filmHtml({
      stage: { w: 320, h: 180 },
      tracks: [
        { clips: [{ id: 'video', src: 'assets/clip.mp4', time: [0, 4] }] },
        { clips: [{ id: 'sound', src: 'assets/clip.mp4', sound: true, time: [0, 4] }] },
      ],
    }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, locale: 'en-US', reducedMotion: 'reduce' });
    await page.addInitScript(() => { localStorage.setItem('openfilm.project.timelineH', '500'); });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const until = async (check, what) => {
      for (let i = 0; i < 100; i += 1) { if (await check()) return; await page.waitForTimeout(100); }
      assert.fail(what);
    };
    for (const kind of ['audio', 'video']) {
      const clip = page.locator(kind === 'audio' ? '[data-block-id]:not([data-block-kind="video"]):not([data-block-kind="mg"])' : '[data-block-id][data-block-kind="video"]');
      const canvas = clip.locator('canvas[data-wave-volume]');
      await canvas.waitFor({ state: 'attached' });
      const peakHeight = () => canvas.evaluate((el) => {
        const { data } = el.getContext('2d').getImageData(0, 0, el.width, el.height);
        for (let y = 0; y < el.height; y += 1) {
          for (let x = 0; x < el.width; x += 1) {
            if (data[(y * el.width + x) * 4 + 3] > 0) return el.height - y;
          }
        }
        return 0;
      });
      await until(async () => (await peakHeight()) > 0, 'waveform pixels are drawn');
      const before = (await canvas.boundingBox()).height;
      const peakBefore = await peakHeight();
      const head = page.locator(`[data-lane-type="${kind === 'audio' ? 'audio' : 'visual'}"]`).first();
      const grip = await head.locator('[data-track-resize]').boundingBox();
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 40, { steps: 8 });
      await page.mouse.up();
      await until(async () => (await canvas.boundingBox()).height > before * 1.2, `${kind} waveform grows with its track (was ${before}px)`);
      await until(async () => canvas.evaluate((el) => el.height === Math.round(el.getBoundingClientRect().height * window.devicePixelRatio)), `${kind} canvas redraws at the new height`);
      assert.ok((await peakHeight()) > peakBefore, 'the drawn peaks grow with the canvas');
      if (kind === 'video') {
        const box = await clip.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + 10);
        const band = await clip.locator('[data-audio-band="on"]').boundingBox();
        const dot = await clip.locator('[data-fade-handle="in"] > span').boundingBox();
        const line = await clip.locator('[data-volume-line]').boundingBox();
        assert.ok(Math.abs(dot.y + dot.height / 2 - band.y) <= 1, 'fade dot follows the top of the taller sound band');
        assert.ok(line.y >= band.y && line.y < band.y + band.height, 'volume line stays inside the sound band');
      }
      /* At the minimum height the picture, name and sound still fit. Double-click restores the default. */
      const tallerGrip = await head.locator('[data-track-resize]').boundingBox();
      await page.mouse.move(tallerGrip.x + 3, tallerGrip.y + 3);
      await page.mouse.down();
      await page.mouse.move(tallerGrip.x + 3, tallerGrip.y - 200, { steps: 8 });
      await page.mouse.up();
      await until(async () => (await head.boundingBox()).height === 28, 'track reaches its minimum height');
      assert.ok((await canvas.boundingBox()).height > 0, 'waveform remains visible at minimum height');
      await head.locator('[data-track-resize]').dblclick();
      await until(async () => (await canvas.boundingBox()).height === before, 'default waveform height is restored');
    }
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
