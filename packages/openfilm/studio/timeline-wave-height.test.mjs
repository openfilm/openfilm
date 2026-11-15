import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    const videoDefaults = [];
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
      if (kind === 'video') videoDefaults.push(defaultH);
      const audioBand = clip.locator('[data-audio-band="on"]');
      const grip = await head.locator('[data-track-resize]').boundingBox();
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 40, { steps: 8 });
      await page.mouse.up();
      await until(async () => (await canvas.boundingBox()).height > before * 1.2, `${kind} waveform grows with its track (was ${before}px)`);
      await until(async () => canvas.evaluate((el) => el.height === Math.round(el.getBoundingClientRect().height * window.devicePixelRatio)), `${kind} canvas redraws at the new height`);
      assert.ok((await peakHeight()) > peakBefore, 'the drawn peaks grow with the canvas');
      if (kind !== 'audio') {
        assert.equal((await audioBand.boundingBox()).height, Math.round(((await head.boundingBox()).height - 15) * 0.3), 'audio band keeps its share of the content area');
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
      const defaultGrip = await head.locator('[data-track-resize]').boundingBox();
      await page.mouse.move(defaultGrip.x + 3, defaultGrip.y + 3);
      await page.mouse.down();
      await page.mouse.move(defaultGrip.x + 3, defaultGrip.y + 200, { steps: 8 });
      await page.mouse.up();
      await until(async () => (await head.boundingBox()).height === 160, 'track reaches its maximum height');
      if (kind !== 'audio') {
        assert.equal((await audioBand.boundingBox()).height, 44, '30 percent of the maximum content height is 44px');
      }
      assert.ok((await canvas.boundingBox()).height > before, 'waveform grows at maximum height');
      await head.locator('[data-track-resize]').dblclick();
      await until(async () => (await canvas.boundingBox()).height === before, 'default height is restored after maximum');
      await head.click({ button: 'right', position: { x: 4, y: 8 } });
      const proportion = page.getByRole('menuitem', { name: 'Waveform proportion', exact: true });
      if (kind === 'audio') {
        assert.equal(await proportion.isDisabled(), true, 'a sound-only track has no video/waveform split to adjust');
        await page.keyboard.press('Escape');
      } else {
        assert.equal(await proportion.isDisabled(), false);
        const entries = await page.getByRole('menuitem').allTextContents();
        assert.equal(entries.findIndex((s) => s.includes('Waveform proportion')), entries.findIndex((s) => s.includes('Track height')) + 1, 'proportion is beside the height presets');
        const volume = await canvas.getAttribute('data-wave-volume');
        for (const [ratio, expected] of [[60, defaultH === 76 ? 37 : 29], [90, defaultH === 76 ? 55 : 43], [30, defaultH === 76 ? 18 : 15]]) {
          if (ratio !== 60) await head.click({ button: 'right', position: { x: 4, y: 8 } });
          await page.getByRole('menuitem', { name: 'Waveform proportion', exact: true }).hover();
          await page.getByRole('menuitem', { name: `${ratio}%`, exact: true }).click();
          await until(async () => (await audioBand.boundingBox()).height === expected, `${ratio}% changes the waveform's share`);
          assert.equal((await head.boundingBox()).height, defaultH, 'choosing a proportion preserves track height');
          assert.equal(await canvas.getAttribute('data-wave-volume'), volume, 'the display choice preserves volume');
          assert.ok((await clip.locator('img').count()) > 0, 'every waveform preset keeps the video picture visible');
        }
      }
    }
    assert.deepEqual(videoDefaults.sort((a, b) => a - b), [64, 76], 'both ordinary and main video tracks were checked');
    /* The first response is slow: a second track's choice must wait and preserve the first track's setting. */
    let release, firstResponse;
    const held = new Promise((resolve) => { release = resolve; });
    const received = new Promise((resolve) => { firstResponse = resolve; });
    let patches = 0;
    await page.route(/\/settings(?:\?|$)/, async (route) => {
      if (route.request().method() === 'PATCH' && route.request().postDataJSON()?.trackWaveforms) {
        patches += 1;
        if (patches === 1) {
          const response = await route.fetch();
          firstResponse();
          await held;
          await route.fulfill({ response });
          return;
        }
      }
      await route.continue();
    });
    const choose = async (index, ratio) => {
      await page.locator('[data-lane-type="visual"]').nth(index).click({ button: 'right', position: { x: 4, y: 8 } });
      await page.getByRole('menuitem', { name: 'Waveform proportion', exact: true }).hover();
      await page.getByRole('menuitem', { name: `${ratio}%`, exact: true }).click();
    };
    try {
      await choose(0, 90);
      await received;
      await choose(1, 60);
      assert.equal(patches, 1, 'the second write waits for the first response');
    } finally { release(); }
    await until(async () => {
      const settings = JSON.parse(await readFile(join(root, '.film/settings.json'), 'utf8'));
      return settings.trackWaveforms?.map((w) => w.ratio).sort().join(',') === '60,90';
    }, 'both tracks keep their proportions after a delayed response');
    await page.unrouteAll({ behavior: 'wait' });
    await page.reload();
    const firstVideo = page.locator('[data-block-kind="video"]').first();
    await until(async () => (await firstVideo.locator('[data-audio-band="on"]').boundingBox())?.height >= ((await firstVideo.boundingBox())?.height - 15) * 0.85, 'the largest waveform proportion is retained after reload');
    await firstVideo.click({ button: 'right', position: { x: 20, y: 10 } });
    await page.getByRole('menuitem', { name: /^Detach audio/ }).click();
    await until(async () => (await firstVideo.locator('[data-audio-band="on"]').count()) === 0 && (await firstVideo.locator('img').count()) > 0, 'detaching audio at the largest proportion keeps the video picture visible');
    await page.locator('[data-lane-type="visual"]').first().click({ button: 'right', position: { x: 4, y: 8 } });
    assert.equal(await page.getByRole('menuitem', { name: 'Waveform proportion', exact: true }).isDisabled(), true, 'a detached video disables the proportion menu');
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
