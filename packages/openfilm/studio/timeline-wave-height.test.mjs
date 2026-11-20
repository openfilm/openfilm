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
        { clips: [{ id: 'overlay', src: 'assets/clip.mp4', time: [0, 4] }] },
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
    const resize = async (head, height, reached = height) => {
      const box = await head.boundingBox();
      const grip = await head.locator('[data-track-resize]').boundingBox();
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + height - box.height, { steps: 8 });
      await page.mouse.up();
      await until(async () => (await head.boundingBox()).height === reached, `track reaches ${reached}px`);
    };
    for (const [kind, index] of [['audio', 0], ['video', 0], ['video', 1]]) {
      const clip = page.locator(kind === 'audio' ? '[data-block-id]:not([data-block-kind="video"]):not([data-block-kind="mg"])' : '[data-block-id][data-block-kind="video"]').nth(index);
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
      const head = page.locator(`[data-lane-type="${kind === 'audio' ? 'audio' : 'visual'}"]`).nth(index);
      const defaultH = (await head.boundingBox()).height;
      const volume = await canvas.getAttribute('data-wave-volume');
      const audioBand = clip.locator('[data-audio-band="on"]');
      await resize(head, defaultH + 40);
      await until(async () => (await canvas.boundingBox()).height > before * 1.2, `${kind} waveform grows with its track (was ${before}px)`);
      await until(async () => canvas.evaluate((el) => el.height === Math.round(el.getBoundingClientRect().height * window.devicePixelRatio)), `${kind} canvas redraws at the new height`);
      assert.ok((await peakHeight()) > peakBefore, 'the drawn peaks grow with the canvas');
      if (kind !== 'audio') {
        const box = await clip.boundingBox();
        assert.equal((await audioBand.boundingBox()).height, Math.round((box.height - 15) * 0.3), 'audio band keeps its share of the clip content area');
        await page.mouse.move(box.x + box.width / 2, box.y + 10);
        const band = await clip.locator('[data-audio-band="on"]').boundingBox();
        const dot = await clip.locator('[data-fade-handle="in"] > span').boundingBox();
        const line = await clip.locator('[data-volume-line]').boundingBox();
        assert.ok(Math.abs(dot.y + dot.height / 2 - band.y) <= 1, 'fade dot follows the top of the taller sound band');
        assert.ok(line.y >= band.y && line.y < band.y + band.height, 'volume line stays inside the sound band');
        /* the picture's room, between the info row and the sound band: measured, not waited for, since its
           thumbnails come from ffmpeg in their own time (often over 10 s on a CI machine) */
        assert.ok(band.y - (box.y + 15) > band.height, 'the taller sound band leaves the video picture more room than itself');
      }
      /* Small and minimum-height video tracks keep the original 15 px band (13 px canvas). The main track (the first
         picture track, marked so on its head) is never lower than 64 px, so its cover stands beside it: dragged lower, it stops there. */
      const main = (await head.getAttribute('data-main-track')) !== null;
      for (const height of main ? [] : [kind === 'audio' ? 30 : 36, 28]) {
        await resize(head, height);
        assert.equal((await canvas.boundingBox()).height, kind === 'audio' ? (await clip.boundingBox()).height - 17 : 13, 'small waveforms fit below the clip info row');
        if (kind !== 'audio') assert.equal((await audioBand.boundingBox()).height, 15, 'the video sound band never shrinks below 15px');
      }
      if (main) {
        await resize(head, 28, 64);
        assert.equal((await audioBand.boundingBox()).height, Math.max(15, Math.round(((await clip.boundingBox()).height - 15) * 0.3)), 'the main track at its lowest keeps its share');
      }
      await resize(head, 160);
      if (kind !== 'audio') {
        assert.equal((await audioBand.boundingBox()).height, Math.round(((await clip.boundingBox()).height - 15) * 0.3), 'audio band keeps its share at maximum height');
      }
      assert.ok((await canvas.boundingBox()).height > before, 'waveform grows at maximum height');
      assert.equal(await canvas.getAttribute('data-wave-volume'), volume, 'resizing preserves clip volume');
      await head.locator('[data-track-resize]').dblclick();
      await until(async () => (await canvas.boundingBox()).height === before, 'default height is restored after maximum');
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
