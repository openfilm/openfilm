import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('a canvas video uploads in place and keeps its frame while playing, renaming, and dragging', {
  timeout: 60_000, skip: spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0,
}, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-canvas-video-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS', 'TRASH_DIR'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser, releaseUpload;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Video');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 1280, h: 720 }, tracks: [] }));
    const input = join(scratch, 'clip.webm');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=160x90:r=10:d=0.5',
      '-f', 'lavfi', '-i', 'color=blue:s=160x90:r=10:d=3.5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[clip]', '-map', '[clip]', '-map', '2:a', '-c:v', 'libvpx', '-c:a', 'libopus', input]);
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {}, editorDir: process.env.OPENFILM_TEST_EDITOR_DIR });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'en-US', reducedMotion: 'reduce' });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const url = `${studio.origin}/projects/${project.id}?key=${studio.key}`;
    const hold = new Promise((done) => { releaseUpload = done; });
    await page.route('**/files?path=*clip.webm', async (route) => { await hold; await route.continue(); });
    const openCanvas = async () => {
      await page.goto(url);
      await page.locator('[data-work-mode="edit"]').click();
      await page.locator('[data-studio-canvas][data-canvas-ready="1"]').waitFor();
    };
    await openCanvas();
    await page.locator('.react-flow__pane').dblclick({ position: { x: 600, y: 360 } });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    await (await chooser).setFiles(input);
    const pending = page.locator('.react-flow__node').filter({ hasText: 'Uploading…' });
    await pending.waitFor();
    const id = await pending.getAttribute('data-id');
    const beforeUpload = await pending.boundingBox();
    releaseUpload();

    const node = page.getByTestId(`rf__node-${id}`);
    const video = node.locator('video');
    const sample = (png) => page.evaluate(async (data) => {
      const picture = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      context.drawImage(picture, 0, 0);
      picture.close();
      return [...context.getImageData(10, 10, 1, 1).data];
    }, png.toString('base64'));
    const checkFirstFrame = async () => {
      const [red, , blue] = await sample(await node.screenshot());
      assert.ok(red > 180 && blue < 30, `the card displays the red opening frame, received red=${red}, blue=${blue}`);
    };
    const sideButtons = node.locator('[data-handleid="in"], [data-handleid="out"]');
    const sideColors = () => node.locator('[data-canvas-side-plus]').evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button).borderColor));
    await video.waitFor();
    await video.evaluate((el) => { el.dataset.originalPlayer = 'true'; });
    await page.waitForFunction((nodeId) => document.querySelector(`[data-id="${nodeId}"] video`)?.readyState >= 2, id);
    assert.deepEqual(await node.boundingBox(), beforeUpload, 'the upload slot is the final video box');
    assert.equal(await pending.count(), 0);
    assert.equal(await video.evaluate((el) => el.muted), false, 'canvas videos start with sound enabled');
    await page.mouse.move(20, 220);
    assert.deepEqual(await sideButtons.evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button).opacity)), ['0', '0']);
    await checkFirstFrame();
    await node.hover();
    assert.deepEqual(await sideButtons.evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button).opacity)), ['1', '1']);
    const unselectedBorders = await sideColors();
    await node.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    await page.mouse.move(20, 220);
    assert.equal(await video.evaluate((el) => el.paused), true);
    await node.hover();
    await node.getByRole('button', { name: 'Pause', exact: true }).click();
    assert.equal(await video.evaluate((el) => el.paused), true, 'the pause button pauses hover playback');
    await node.getByRole('button', { name: 'Mute', exact: true }).click();
    assert.equal(await video.evaluate((el) => el.muted), true);
    assert.equal(await video.evaluate((el) => el.paused), true, 'volume controls leave playback paused');
    const slider = node.getByRole('slider', { name: 'Playback position' });
    await slider.fill('2.5');
    assert.ok(Math.abs(await video.evaluate((el) => el.currentTime) - 2.5) < 0.1);
    await page.mouse.move(20, 220);
    assert.equal(await video.getAttribute('data-original-player'), 'true');
    const playback = await video.evaluate((el) => ({ seconds: el.currentTime, paused: el.paused }));
    assert.deepEqual(playback, { seconds: 0, paused: true });
    await video.evaluate((el) => el.seeking ? new Promise((done) => el.addEventListener('seeked', done, { once: true })) : undefined);
    await checkFirstFrame();
    assert.deepEqual(await node.boundingBox(), beforeUpload);

    await node.getByText('clip.webm', { exact: true }).dblclick();
    const title = node.getByRole('textbox', { name: 'Rename video' });
    await title.fill('Final shot');
    await title.press('Enter');
    await node.getByText('Final shot', { exact: true }).waitFor();
    await page.mouse.move(20, 220);
    assert.deepEqual(await sideButtons.evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button).opacity)), ['1', '1']);
    assert.notDeepEqual(await sideColors(), unselectedBorders);
    const drag = async (handle, dx, dy, padding = false) => {
      const { x, y, width, height } = await handle.boundingBox();
      const startY = y + (padding ? 2 : height / 2);
      await page.mouse.move(x + width / 2, startY);
      await page.mouse.down();
      await page.mouse.move(x + width / 2 + dx, startY + dy, { steps: 8 });
      await page.mouse.up();
    };
    await drag(node.getByText('Final shot', { exact: true }), 80, 40);
    const afterHeader = await node.boundingBox();
    assert.ok(afterHeader.x >= beforeUpload.x + 65 && afterHeader.x <= beforeUpload.x + 80);
    await drag(node.locator('[data-canvas-video-toolbar]'), -40, 10, true);
    const afterToolbar = await node.boundingBox();
    assert.ok(afterToolbar.x >= afterHeader.x - 40 && afterToolbar.x <= afterHeader.x - 30);
    assert.equal(afterToolbar.width, beforeUpload.width);

    const near = (actual, expected) => assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 2);
    for (const [side, direction] of [['in', -1], ['out', 1]]) {
      const handle = node.locator(`[data-handleid="${side}"]`);
      const bounds = await handle.boundingBox();
      const pointer = { x: bounds.x + bounds.width / 2 + direction * 14, y: bounds.y + bounds.height / 2 + 26 };
      await page.mouse.move(pointer.x, pointer.y);
      const plus = await handle.locator('[data-canvas-side-plus]').boundingBox();
      near({ x: plus.x + plus.width / 2, y: plus.y + plus.height / 2 }, pointer);
    }
    const handle = node.locator('[data-handleid="out"]');
    const plus = await handle.locator('[data-canvas-side-plus]').boundingBox();
    const start = { x: plus.x + plus.width / 2, y: plus.y + plus.height / 2 };
    const drop = { x: start.x + 130, y: start.y + 70 };
    const dragWire = page.locator('[data-canvas-wire="drag"]');
    const menuWire = page.locator('[data-canvas-wire="menu"]');
    const endpoints = (wire) => wire.evaluate((path) => {
      const transform = path.getScreenCTM();
      const screen = (distance) => {
        const point = path.getPointAtLength(distance).matrixTransform(transform);
        return { x: point.x, y: point.y };
      };
      return [screen(0), screen(path.getTotalLength())];
    });
    const cardEdge = { x: afterToolbar.x + afterToolbar.width, y: afterToolbar.y + afterToolbar.height / 2 };
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (const pointer of [{ x: start.x + 65, y: start.y + 25 }, drop]) {
      await page.mouse.move(pointer.x, pointer.y, { steps: 4 });
      await dragWire.waitFor({ state: 'attached' });
      const [origin, tip] = await endpoints(dragWire);
      near(origin, cardEdge);
      near(tip, pointer);
      assert.equal(await handle.evaluate((el) => getComputedStyle(el).opacity), '0');
      assert.equal(await page.locator('.react-flow__connectionline .cv-wire-flow').evaluate((el) => getComputedStyle(el).animationName), 'cv-flow');
      assert.equal(await menuWire.count(), 0);
    }
    await page.mouse.up();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await menuWire.waitFor({ state: 'attached' });
    const [origin, tip] = await endpoints(menuWire);
    near(origin, cardEdge);
    const menu = await page.getByPlaceholder('Make from this node').boundingBox();
    assert.ok(menu && Math.abs(tip.x - menu.x) < 24);
    await page.keyboard.press('Escape');
    await menuWire.waitFor({ state: 'detached' });

    await node.hover();
    await node.getByRole('button', { name: 'Pause', exact: true }).click();
    await slider.fill('2.5');
    for (const [mode, channel] of [['current', 2], ['first', 0], ['last', 2]]) {
      const frame = `assets/clip-${mode}-frame.png`;
      const kept = page.waitForResponse((response) => {
        const request = response.request();
        return response.ok() && request.method() === 'PUT' && new URL(request.url()).pathname === `/api/projects/${project.id}/canvas`
          && request.postDataJSON().nodes.some((item) => item.path === frame);
      });
      const camera = node.getByRole('button', { name: 'Take frame' });
      await camera.click();
      const option = node.getByRole('button', { name: `Capture ${mode} frame` });
      const buttonBox = await camera.boundingBox();
      const menuBox = await node.locator(`[id="${await camera.getAttribute('aria-controls')}"]`).boundingBox();
      assert.ok(Math.abs(menuBox.x + menuBox.width - buttonBox.x - buttonBox.width) < 1);
      assert.ok(buttonBox.y - menuBox.y - menuBox.height <= 5);
      await option.click();
      await kept;
      const pixels = await sample(await readFile(join(root, frame)));
      assert.ok(pixels[channel] > 180 && pixels[2 - channel] < 30, `${mode} frame pixels: ${pixels}`);
    }
    const canvasFile = join(root, '.film', 'canvas.json');
    const doc = JSON.parse(await readFile(canvasFile, 'utf8'));
    const stored = doc.nodes.find((item) => item.id === id);
    assert.equal(stored.title, 'Final shot');
    assert.equal(stored.path, 'assets/clip.webm');
    // Existing boards can omit explicit file dimensions.
    delete stored.w;
    delete stored.h;
    doc.nodes.push({ ...stored, id: 'shared-audio', x: stored.x - 700, title: 'Another video' });
    await writeFile(canvasFile, JSON.stringify(doc));
    await page.reload();
    await page.locator('[data-work-mode]').first().waitFor();
    if (await page.locator('[data-work-mode="edit"]').count()) await page.locator('[data-work-mode="edit"]').click();
    await node.getByText('Final shot', { exact: true }).waitFor();
    const legacyBox = await node.boundingBox();
    assert.ok(legacyBox.width > 0 && legacyBox.height > 0);
    const other = page.getByTestId('rf__node-shared-audio');
    const otherVideo = other.locator('video');
    await otherVideo.waitFor();
    assert.equal(await otherVideo.evaluate((el) => el.muted), true, 'new and restored nodes use the saved sound preference');
    await other.hover();
    await other.getByRole('button', { name: 'Unmute' }).click();
    assert.equal(await otherVideo.evaluate((el) => el.muted), false);
    assert.equal(await video.evaluate((el) => el.muted), false, 'the sound control updates other videos too');
    await node.hover();
    assert.deepEqual(await node.boundingBox(), legacyBox);
    assert.deepEqual(errors, []);
  } finally {
    releaseUpload?.();
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
