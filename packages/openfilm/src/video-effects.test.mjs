import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { FilmPage, serve, launch } from './host.mjs';
import { filmHtml } from './film-doc.mjs';
import { studioHomeDir } from './locations.mjs';

const cached = existsSync(fileURLToPath(new URL('../models/vision/person.tflite', import.meta.url)));
const optionalHome = join(studioHomeDir(), 'cache/vision/1');
const testHome = mkdtempSync(join(tmpdir(), 'of-effects-home-'));
process.env.OPENFILM_HOME = testHome;
process.on('exit', () => rmSync(testHome, { recursive: true, force: true }));
const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('real person segmentation is shared by exact frames, backward seeks, preview, compare and reset', {
  timeout: 180_000,
  skip: !cached ? 'bundled person model missing' : !hasFfmpeg && 'no ffmpeg',
}, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'of-video-effects-'));
  let site, browser;
  // The test runner also calls this hook when a page evaluation is stuck at the test deadline.
  t.after(async () => {
    try { await Promise.all([browser?.close(), site?.close()]); }
    finally { rmSync(root, { recursive: true, force: true }); }
  });

  // VP8 plays in the headless shell on every CI OS. The long blue tail leaves room for model startup during playback.
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=320x180:rate=10:duration=20', '-vf', "drawbox=x=0:y=0:w=iw:h=ih:color=blue:t=fill:enable='gte(t,1)'", '-c:v', 'libvpx', '-g', '10', '-pix_fmt', 'yuv420p', join(root, 'v.webm')]);
  writeFileSync(join(root, 'back.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><path fill="#00ff00" d="M0 0h320v180H0z"/></svg>');
  const value = { stage: { w: 320, h: 180 }, tracks: [
    { clips: [{ id: 'v', src: 'v.webm', time: [0, 20], style: '--of-cutout: 1; --of-cutout-mode: 0' }] },
    { clips: [{ id: 'back', src: 'back.svg', time: [0, 20] }] },
  ] };
  writeFileSync(join(root, 'film.html'), filmHtml(value));
  site = await serve(root);
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
  const film = await FilmPage.open(browser, site.url, 'film.html');
  const colour = async () => {
    const data = (await film.capture({ format: 'png' })).toString('base64');
    return film.page.evaluate(async (data) => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const canvas = Object.assign(document.createElement('canvas'), { width: 320, height: 180 }); const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return [...ctx.getImageData(160, 90, 1, 1).data];
    }, data);
  };
  // Chromium can composite the old video surface for a moment after the effect canvas is hidden.
  const expectRed = async (message) => {
    const deadline = performance.now() + 10_000;
    let pixel;
    do {
      pixel = await colour();
      if (pixel[0] > 230 && pixel[1] < 60) return;
    } while (performance.now() < deadline);
    assert.fail(`${message}: ${pixel}`);
  };
  const watchAt = async (time) => {
    await film.page.evaluate((time) => window.__filmEditor.watch(time), time);
    await film.page.waitForFunction((time) => {
      const state = window.__filmEditor.stage.vision('v');
      if (state.error) throw new Error(state.error);
      return state.sourceTime === time && document.querySelector('video').hasAttribute('data-film-vision-source');
    }, time, { timeout: 30_000 });
  };
  const playUntil = async ({ after, frames = 1, profile }) => {
    const before = await film.page.evaluate(() => window.__filmEditor.stage.vision('v').frames);
    // Quarter-speed playback leaves software inference time to meet the preview's frame-lag budget.
    // The page clock is frozen by exact seeks, so Playwright owns the deadline.
    await film.page.waitForFunction(({ before, after, frames, profile }) => {
      const editor = window.__filmEditor;
      const video = document.querySelector('video');
      const state = editor.stage.vision('v');
      if (state.error) throw new Error(state.error);
      if (state.frames >= before + frames && state.sourceTime > after &&
          state.preview === profile && video.hasAttribute('data-film-vision-source')) return true;
      const t = video.currentTime;
      void editor.watch(t, { now: t, t, rate: 0.25 });
      return false;
    }, { before, after, frames, profile }, { timeout: 30_000 });
  };
  for (const time of [1.5, 0.4, 2, 0.4]) {
    await film.seek(time, { timeoutMs: 60000 });
    const pixel = await colour();
    assert.ok(pixel[1] > 230 && pixel[0] < 30, `background visible after cutout at ${time}: ${pixel}`);
    assert.equal(await film.page.evaluate(() => window.__filmEditor.stage.vision('v').phase), 'ready');
  }
  await film.page.evaluate(() => window.__filmEditor.stage.look('v', '--of-cutout: 1; --of-cutout-mode: 0; --of-vision-bypass: 1'));
  await expectRed('compare shows the original video');
  await film.page.evaluate(() => window.__filmEditor.stage.look('v', '--of-cutout: 1; --of-cutout-mode: 0'));
  await film.page.waitForFunction(() => document.querySelector('video').hasAttribute('data-film-vision-source'));
  assert.ok((await colour())[1] > 230);
  await watchAt(1.2);
  assert.ok((await colour())[1] > 230, 'preview uses the same effects');
  await playUntil({ after: 1.3, frames: 2, profile: 'draft' });
  await film.page.evaluate(() => window.__filmEditor.stage.look('v', '--of-beauty-smooth: 0.35'));
  await watchAt(0.2);
  const unchanged = await colour();
  assert.ok(unchanged[0] > 230, `retouching without a face preserves the source picture: ${unchanged}`);
  await playUntil({ after: 1.1, profile: 'draft' });
  const moving = await colour();
  assert.ok(moving[2] > 230 && moving[0] < 60, `processed playback shows new decoded frames after the source turns blue: ${moving}`);
  await film.page.evaluate(() => window.__filmEditor.stage.visionPreview({ mode: 'quality' }));
  await playUntil({ after: 1.3, profile: 'quality' });
  await film.page.evaluate(() => window.__filmEditor.stage.visionPreview({ mode: 'auto' }));
  await watchAt(0.4);
  await film.page.evaluate(() => window.__filmEditor.stage.look('v', ''));
  assert.equal(await film.page.locator('[data-film-vision]').count(), 0);
  assert.equal(await film.page.locator('[data-film-vision-source]').count(), 0);
  await expectRed('disabling restores the original');

  const out = join(root, 'cutout.mp4');
  execFileSync(process.execPath, [fileURLToPath(new URL('../bin/openfilm.mjs', import.meta.url)), 'render', root, '0-0.6', '--fps', '5', '--workers', '2', '--out', out], { timeout: 60000, stdio: 'pipe' });
  const pixels = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const at = (90 * 320 + 160) * 3;
  assert.ok(pixels[at + 1] > 220 && pixels[at] < 40, 'the encoded parallel export includes the cutout and lower track');
});

const portrait = process.env.OPENFILM_VISION_TEST_PORTRAIT;
test('real face retouching preserves the background and combines with person cutout', { timeout: 120000, skip: !portrait || !existsSync(portrait) ? 'set OPENFILM_VISION_TEST_PORTRAIT to a local portrait for the real-face test' : !hasFfmpeg && 'no ffmpeg' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-face-effects-'));
  let site, browser, film;
  try {
    copyFileSync(portrait, join(root, 'portrait.jpg'));
    execFileSync('ffmpeg', ['-v', 'error', '-loop', '1', '-i', join(root, 'portrait.jpg'), '-vf', 'scale=410:512', '-t', '2', '-r', '10', '-pix_fmt', 'yuv420p', join(root, 'v.mp4')]);
    const value = { stage: { w: 410, h: 512 }, tracks: [{ clips: [{ id: 'v', src: 'v.mp4', time: [0, 2], style: '--of-beauty-light: 0.8; --of-beauty-smooth: 0.5; --of-beauty-warm: 0.5' }] }] };
    writeFileSync(join(root, 'film.html'), filmHtml(value));
    site = await serve(root);
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    film = await FilmPage.open(browser, site.url, 'film.html');
    await film.seek(0.2, { timeoutMs: 60000 });
    const diff = await film.page.evaluate(() => {
      const video = document.querySelector('video'), output = document.querySelector('[data-film-vision]');
      const original = Object.assign(document.createElement('canvas'), { width: output.width, height: output.height });
      original.getContext('2d').drawImage(video, 0, 0);
      const a = original.getContext('2d').getImageData(0, 0, output.width, output.height).data;
      const b = output.getContext('2d').getImageData(0, 0, output.width, output.height).data;
      let changed = 0, outside = 0;
      for (let y = 0; y < output.height; y++) for (let x = 0; x < output.width; x++) {
        const i = (y * output.width + x) * 4, difference = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        if (difference > 8) changed++;
        if (x < output.width * 0.15 || x > output.width * 0.85 || y > output.height * 0.5) outside = Math.max(outside, difference);
      }
      return { changed, outside };
    });
    assert.ok(diff.changed > 100, `the detected face is retouched: ${JSON.stringify(diff)}`);
    assert.ok(diff.outside < 5, `the background and clothing are preserved: ${JSON.stringify(diff)}`);
    await film.page.evaluate(() => window.__filmEditor.stage.look('v', '--of-cutout: 1; --of-beauty-light: 0.8'));
    await film.seek(1, { timeoutMs: 60000 });
    const alpha = await film.page.evaluate(() => {
      const canvas = document.querySelector('[data-film-vision]'), ctx = canvas.getContext('2d');
      return [ctx.getImageData(5, 5, 1, 1).data[3], ctx.getImageData(205, 110, 1, 1).data[3]];
    });
    assert.ok(alpha[0] < 30 && alpha[1] > 230, `cutout and retouching compose: ${alpha}`);
    value.tracks[0].clips[0].style = '--of-cutout: 1; --of-beauty-smooth: 0.3; --of-beauty-lip: 0.4';
    writeFileSync(join(root, 'film.html'), filmHtml(value));
    const out = join(root, 'portrait.mp4');
    execFileSync(process.execPath, [fileURLToPath(new URL('../bin/openfilm.mjs', import.meta.url)), 'render', root, '0-0.4', '--fps', '5', '--workers', '2', '--out', out], { timeout: 60000, stdio: 'pipe' });
    const pixels = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const corner = (5 * 410 + 5) * 3, face = (110 * 410 + 205) * 3;
    assert.ok(pixels[corner] < 15 && pixels[corner + 1] < 15 && pixels[corner + 2] < 15, 'full-quality parallel export removes the original background');
    assert.ok(pixels[face] > 80, 'full-quality parallel export preserves the face');

  } finally { await film?.close(); await browser?.close(); await site?.close(); rmSync(root, { recursive: true, force: true }); }
});

test('optional edge refinement and semantic beauty survive backward seeking and encoded export offline', {
  timeout: 180000,
  skip: !portrait || !existsSync(portrait) || !hasFfmpeg || !['refine.onnx', 'face-parse.onnx'].every((name) => existsSync(join(optionalHome, name)))
    ? 'local portrait and optional model cache required' : false,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-refined-export-'));
  let site, browser, film;
  try {
    const cache = join(testHome, 'cache/vision/1'); mkdirSync(cache, { recursive: true });
    for (const name of ['refine.onnx', 'face-parse.onnx']) symlinkSync(join(optionalHome, name), join(cache, name));
    execFileSync('ffmpeg', ['-v', 'error', '-loop', '1', '-i', portrait, '-vf', 'scale=410:512', '-t', '1', '-r', '5', '-pix_fmt', 'yuv420p', join(root, 'v.mp4')]);
    const style = '--of-cutout: 1; --of-cutout-mode: 4; --of-beauty-quality: 1; --of-beauty-smooth: .4; --of-beauty-blemish: .3; --of-beauty-highlights: .4; --of-beauty-lip: .2';
    writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 410, h: 512 }, tracks: [{ clips: [{ id: 'v', src: 'v.mp4', time: [0, 1], style }] }] }));
    site = await serve(root); browser = await launch();
    film = await FilmPage.open(browser, site.url, 'film.html');
    const external = [];
    await film.page.route('**/*', (route) => { if (route.request().url().startsWith(site.url)) return route.continue(); external.push(route.request().url()); return route.abort(); });
    for (const time of [.6, .2, .6]) {
      await film.seek(time, { timeoutMs: 60000 });
      assert.equal(await film.page.evaluate(() => window.__filmEditor.stage.vision('v').phase), 'ready');
    }
    const preview = await film.page.evaluate(() => {
      const c = document.querySelector('[data-film-vision]'), x = c.getContext('2d');
      return { corner: Array.from(x.getImageData(5, 5, 1, 1).data), face: Array.from(x.getImageData(205, 110, 1, 1).data) };
    });
    assert.ok(preview.corner[3] < 20 && preview.face[3] > 230);
    const out = join(root, 'refined.mp4');
    execFileSync(process.execPath, [fileURLToPath(new URL('../bin/openfilm.mjs', import.meta.url)), 'render', root, '0-0.4', '--fps', '5', '--workers', '2', '--out', out], { timeout: 120000, stdio: 'pipe' });
    const pixels = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const corner = (5 * 410 + 5) * 3, face = (110 * 410 + 205) * 3;
    assert.ok(pixels[corner] < 15 && pixels[corner + 1] < 15 && pixels[corner + 2] < 15);
    for (let ch = 0; ch < 3; ch++) assert.ok(Math.abs(pixels[face + ch] - preview.face[ch]) < 20, 'encoded retouching agrees with the local preview within codec tolerance');
    assert.deepEqual(external, []);
  } finally { await film?.close(); await browser?.close(); await site?.close(); rmSync(root, { recursive: true, force: true }); }
});
