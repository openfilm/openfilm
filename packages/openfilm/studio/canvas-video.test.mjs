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
      const deadline = Date.now() + 1000;
      let pixel;
      do {
        pixel = await sample(await node.screenshot());
        if (pixel[0] > 180 && pixel[2] < 30) return;
      } while (Date.now() < deadline);
      assert.fail(`the card displays the red opening frame, received ${pixel}`);
    };
    const sideButtons = node.locator('[data-handleid="in"], [data-handleid="out"]');
    const sideColors = () => node.locator('[data-canvas-side-plus]').evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button).borderColor));
    const card = node.locator('[data-canvas-card]');
    await video.waitFor({ state: 'attached' });
    await video.evaluate((el) => { el.dataset.originalPlayer = 'true'; });
    await page.waitForFunction((nodeId) => document.querySelector(`[data-id="${nodeId}"] video`)?.readyState >= 2, id);
    assert.deepEqual(await node.boundingBox(), beforeUpload, 'the upload slot is the final video box');
    assert.equal(await pending.count(), 0);
    assert.equal(await video.evaluate((el) => el.muted), false, 'canvas videos start with sound enabled');
    await page.mouse.move(20, 220);
    assert.deepEqual(await sideButtons.evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button).opacity)), ['0', '0']);
    await checkFirstFrame();
    const border = await card.evaluate((el) => getComputedStyle(el).borderColor);
    await node.hover();
    assert.deepEqual(await sideButtons.evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button).opacity)), ['1', '1']);
    assert.equal(await card.evaluate((el) => getComputedStyle(el).borderColor), border, 'hovering does not highlight the card');
    const unselectedBorders = await sideColors();
    await node.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    await page.mouse.move(20, 220);
    assert.equal(await video.evaluate((el) => el.paused), true);
    await node.hover();
    await node.getByRole('button', { name: 'Pause', exact: true }).click();
    assert.equal(await video.evaluate((el) => el.paused), true, 'the pause button pauses hover playback');
    const volume = node.getByRole('slider', { name: 'Volume', exact: true });
    assert.equal(await volume.count(), 0);
    await node.getByRole('button', { name: 'Mute', exact: true }).hover();
    await volume.hover();
    await volume.fill('50');
    assert.equal(await video.evaluate((el) => el.volume), 0.5);
    await node.getByRole('button', { name: 'Mute', exact: true }).click();
    assert.equal(await video.evaluate((el) => el.muted), true);
    assert.equal(await video.evaluate((el) => el.paused), true, 'volume controls leave playback paused');
    const slider = node.getByRole('slider', { name: 'Playback position' });
    await slider.hover();
    assert.equal(await volume.count(), 0, 'leaving the speaker and slider closes the volume popup');
    await slider.fill('2.5');
    assert.ok(Math.abs(await video.evaluate((el) => el.currentTime) - 2.5) < 0.1);
    await page.mouse.move(20, 220);
    assert.equal(await video.getAttribute('data-original-player'), 'true');
    await page.waitForFunction((nodeId) => {
      const video = document.querySelector(`[data-id="${nodeId}"] video`);
      return video?.paused && video.currentTime === 0 && !video.seeking;
    }, id);
    await checkFirstFrame();
    assert.deepEqual(await node.boundingBox(), beforeUpload);

    await node.getByText('clip.webm', { exact: true }).dblclick();
    const title = node.getByRole('textbox', { name: 'Rename video' });
    await title.fill('Final shot');
    await title.press('Enter');
    await node.getByText('Final shot', { exact: true }).waitFor();
    await page.mouse.move(20, 220);
    assert.deepEqual(await sideButtons.evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button).opacity)), ['1', '1']);
    assert.deepEqual(await sideColors(), unselectedBorders, 'the side buttons keep the same color after selection');
    await page.waitForFunction(({ id, border }) => {
      const card = document.querySelector(`[data-id="${id}"] [data-canvas-card]`);
      return card && getComputedStyle(card).borderColor !== border;
    }, { id, border });
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

    const near = (actual, expected) => assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 2,
      `expected ${JSON.stringify(actual)} to be near ${JSON.stringify(expected)}`);
    for (const [side, direction] of [['in', -1], ['out', 1]]) {
      const handle = node.locator(`[data-handleid="${side}"]`);
      const bounds = await handle.boundingBox();
      const pointer = { x: bounds.x + bounds.width / 2 + direction * 14, y: bounds.y + bounds.height / 2 + 26 };
      await page.mouse.move(pointer.x, pointer.y);
      const plus = await handle.locator('[data-canvas-side-plus]').boundingBox();
      near({ x: plus.x + plus.width / 2, y: plus.y + plus.height / 2 }, pointer);
    }
    const handle = node.locator('[data-handleid="out"]');
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
    const stroke = (wire) => wire.evaluate((el) => {
      const style = getComputedStyle(el);
      return { color: style.stroke, width: style.strokeWidth, dashes: style.strokeDasharray };
    });
    const dragFlow = page.locator('.react-flow__connectionline .cv-wire-flow');
    await page.getByRole('button', { name: 'Snap to grid' }).click();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // Check the browser delivered the input before asserting on the connection rendered from it.
    await page.evaluate(() => {
      document.addEventListener('mousedown', (event) => {
        window.__wirePress = event.target.closest?.('[data-handleid]')?.dataset.handleid;
      }, true);
      document.addEventListener('mousemove', (event) => {
        if (event.buttons === 1) window.__wireMove = { x: event.clientX, y: event.clientY };
      }, true);
    });
    const moveWire = async (point, steps) => {
      await page.mouse.move(point.x, point.y, { steps });
      await page.waitForFunction(({ x, y }) => {
        const move = window.__wireMove;
        return move && Math.hypot(move.x - x, move.y - y) < 2;
      }, point);
    };
    // Moving to the toolbar reset the plus offset. Start from the live handle, not its earlier decoration.
    await handle.hover();
    const bounds = await handle.boundingBox();
    const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const drop = { x: 1209, y: start.y + 71 };
    await page.mouse.down();
    await page.waitForFunction(() => window.__wirePress === 'out');
    for (const pointer of [{ x: start.x + 65, y: start.y + 25 }, drop]) {
      await moveWire(pointer, 4);
      await dragWire.waitFor({ state: 'attached' });
      const [origin, tip] = await endpoints(dragWire);
      near(origin, cardEdge);
      near(tip, pointer);
      assert.equal(await handle.evaluate((el) => getComputedStyle(el).opacity), '0');
      assert.equal(await dragFlow.locator('animateMotion').getAttribute('path'), await dragWire.getAttribute('d'));
      assert.equal(await menuWire.count(), 0);
    }
    const activeStroke = await stroke(dragWire);
    assert.equal(activeStroke.dashes, 'none');
    await page.mouse.up();
    await menuWire.waitFor({ state: 'attached' });
    const [origin, tip] = await endpoints(menuWire);
    near(origin, cardEdge);
    near(tip, drop);
    assert.deepEqual(await stroke(menuWire), activeStroke);
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await menuWire.waitFor({ state: 'detached' });
    const made = page.locator('.react-flow__node-note').first();
    await made.waitFor();
    const madeBox = await made.boundingBox();
    near({ x: madeBox.x, y: madeBox.y + madeBox.height / 2 }, drop);
    assert.deepEqual(await node.boundingBox(), afterToolbar, 'creating the node keeps the viewport in place');
    const edge = page.locator('[data-canvas-wire="edge"]');
    assert.deepEqual(await stroke(edge), activeStroke);
    near((await endpoints(edge))[1], drop);
    const pulse = page.locator('.react-flow__edge .cv-wire-flow circle');
    const pulseX = await pulse.evaluate((circle) => circle.getCTM().e);
    await page.waitForFunction((x) => Math.abs(document.querySelector('.react-flow__edge .cv-wire-flow circle').getCTM().e - x) > 10, pulseX);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await pulse.isVisible(), false);
    assert.deepEqual(await stroke(edge), activeStroke);

    const incoming = node.locator('[data-handleid="in"]');
    await incoming.hover();
    const leftHandle = await incoming.boundingBox();
    const leftDrop = { x: 227, y: leftHandle.y + leftHandle.height / 2 + 31 };
    await page.mouse.down();
    await page.waitForFunction(() => window.__wirePress === 'in');
    await moveWire(leftDrop, 8);
    await page.mouse.up();
    await menuWire.waitFor({ state: 'attached' });
    near((await endpoints(menuWire))[1], leftDrop);
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    const reference = page.locator('.react-flow__node-note').nth(1);
    await reference.waitFor();
    const referenceBox = await reference.boundingBox();
    near({ x: referenceBox.x + referenceBox.width, y: referenceBox.y + referenceBox.height / 2 }, leftDrop);
    near((await endpoints(edge.nth(1)))[0], leftDrop);
    await page.getByRole('button', { name: 'Snap to grid' }).click();

    await node.hover();
    await node.getByRole('button', { name: 'Pause', exact: true }).click();
    await slider.fill('2.5');
    for (const [mode, channel] of [['current', 2], ['first', 0], ['last', 2]]) {
      const frame = `assets/clip-${mode}-frame.png`;
      const kept = page.waitForResponse((response) => {
        const request = response.request();
        return response.ok() && request.method() === 'PUT' && new URL(request.url()).pathname === `/api/projects/${project.id}/canvas`
          && request.postDataJSON().nodes.some((item) => item.path === frame);
      }, { timeout: 20_000 });
      const camera = node.getByRole('button', { name: 'Take frame' });
      await camera.hover();
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
    const titleBox = await node.getByText('Final shot', { exact: true }).boundingBox();
    const startDrag = { x: titleBox.x + titleBox.width / 2, y: titleBox.y + titleBox.height / 2 };
    const madeId = await made.getAttribute('data-id');
    const overlap = { x: madeBox.x + 20, y: madeBox.y + 60 };
    const frontAt = (at) => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.react-flow__node')?.dataset.id, at);
    const delta = madeBox.x + 80 - afterToolbar.x - afterToolbar.width;
    const savedOverlap = page.waitForResponse((response) => {
      const request = response.request();
      if (!response.ok() || request.method() !== 'PUT' || new URL(request.url()).pathname !== `/api/projects/${project.id}/canvas`) return false;
      const nodes = request.postDataJSON().nodes;
      const clip = nodes.find((item) => item.id === id);
      const text = nodes.find((item) => item.id === madeId);
      return clip.x + clip.w > text.x && clip.z > text.z;
    });
    await page.mouse.move(startDrag.x, startDrag.y);
    await page.mouse.down();
    await page.mouse.move(startDrag.x + delta, startDrag.y, { steps: 8 });
    assert.equal(await frontAt(overlap), id, 'dragging the older video puts it above the newer card');
    await page.mouse.up();
    await page.mouse.move(20, 220);
    assert.equal(await frontAt(overlap), id, 'the moved video remains in front after release and pointer leave');
    await savedOverlap;
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
    await page.locator('[data-studio-canvas][data-canvas-ready="1"]').waitFor();
    await node.getByText('Final shot', { exact: true }).waitFor();
    const legacyBox = await node.boundingBox();
    assert.ok(legacyBox.width > 0 && legacyBox.height > 0);
    const restored = await made.boundingBox();
    assert.ok(legacyBox.x + legacyBox.width > restored.x, 'saved cards keep their overlap after loading');
    assert.equal(await frontAt({
      x: (restored.x + legacyBox.x + legacyBox.width) / 2,
      y: Math.max(legacyBox.y, restored.y) + 20,
    }), id, 'the saved stacking order survives reload');
    const other = page.getByTestId('rf__node-shared-audio');
    const otherVideo = other.locator('video');
    await otherVideo.waitFor({ state: 'attached' });
    assert.equal(await otherVideo.evaluate((el) => el.muted), true, 'new and restored nodes use the saved sound preference');
    assert.equal(await otherVideo.evaluate((el) => el.volume), 0.5, 'restored videos use the shared volume');
    await other.hover();
    await other.getByRole('button', { name: 'Unmute' }).click();
    assert.equal(await otherVideo.evaluate((el) => el.muted), false);
    assert.equal(await video.evaluate((el) => el.muted), false, 'the sound control updates other videos too');
    await other.getByRole('slider', { name: 'Volume', exact: true }).fill('75');
    assert.equal(await video.evaluate((el) => el.volume), 0.75, 'volume changes update the other videos too');
    await node.hover();
    assert.deepEqual(await node.boundingBox(), legacyBox);

    await node.click({ position: { x: 60, y: 60 } });
    const reveal = node.getByRole('button', { name: 'Show in Assets', exact: true });
    const library = page.locator('[data-workspace-library]');
    const asset = library.locator('[data-media-path="assets/clip.webm"]');
    const highlighted = library.locator('[data-media-path="assets/clip.webm"][data-media-revealed]');
    await reveal.click();
    await asset.waitFor();
    await highlighted.waitFor();
    await highlighted.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('[data-work-mode="canvas"]').count(), 1);
    await library.getByRole('button', { name: 'Favorites', exact: true }).click();
    await library.getByRole('button', { name: 'Effects', exact: true }).click();
    await reveal.click();
    await highlighted.waitFor();
    assert.equal(await library.getByRole('button', { name: 'Media', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-work-mode="canvas"]').count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    releaseUpload?.();
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
