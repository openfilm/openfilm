import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml, readFilmFile } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('editing feedback: nested video sound, overlapping group move, vertical selection and source range drag', { timeout: 120_000, skip: !hasFfmpeg && 'no ffmpeg' }, async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-edit-feedback-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    let root = join(process.env.OPENFILM_LIBRARY, 'Feedback');
    await mkdir(join(root, 'assets'), { recursive: true });
    await mkdir(join(root, 'opening/assets'), { recursive: true });
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25:duration=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(root, 'assets/source.mp4')]);
    await cp(join(root, 'assets/source.mp4'), join(root, 'opening/assets/nested.mp4'));
    let path = join(root, 'film.html');
    const initial = { stage: { w: 640, h: 360 }, tracks: [
      { clips: [{ id: 'footage', src: 'opening/assets/nested.mp4', at: 0.767, time: [0.767, 4.767] }] },
      { clips: [
        { id: 'voice-a', src: 'opening/assets/nested.mp4', sound: true, at: 0.767, time: [0, 2] },
        { id: 'voice-b', src: 'opening/assets/nested.mp4', sound: true, at: 2.5, time: [2, 4] },
      ] },
    ] };
    await writeFile(path, filmHtml(initial));
    let project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {}, editorDir: process.env.OPENFILM_TEST_EDITOR_DIR });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    let page;
    const errors = [];
    const makePage = async () => {
      page = await browser.newPage({ viewport: { width: 1800, height: 1100 }, locale: 'en-US' });
      page.setDefaultTimeout(10_000);
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(() => {
      localStorage.setItem('openfilm.language', 'en');
      localStorage.setItem('openfilm.project.assets', '1');
      localStorage.setItem('openfilm.timeline.snap', '0');
      localStorage.setItem('openfilm.timeline.mainTrackMagnet', '0');
      localStorage.setItem('openfilm.timeline.mainTrackLinkage', '0');
      });
    };
    const load = async () => { await makePage(); await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`); await page.locator('[data-block-id]').first().waitFor(); };
    const freshFilm = async (value) => {
      const next = join(process.env.OPENFILM_LIBRARY, `Feedback-${Date.now()}`);
      await cp(join(root, 'assets'), join(next, 'assets'), { recursive: true });
      await cp(join(root, 'saved'), join(next, 'saved'), { recursive: true }).catch((e) => { if (e.code !== 'ENOENT') throw e; });
      root = next;
      path = join(root, 'film.html');
      await writeFile(path, filmHtml(value));
      project = await openProject(root);
      await load();
    };
    const film = async () => readFilmFile(await readFile(path, 'utf8')).value;
    const until = async (check) => {
      for (let i = 0; i < 100; i++) { if (await check()) return; await page.waitForTimeout(50); }
      assert.fail('edit was not written');
    };
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await load();

    await t.test('nested footage gets its audio band and volume inspector automatically', async () => {
      const video = page.locator('[data-block-kind="video"]').first();
      await video.locator('[data-audio-band="on"]').waitFor();
      await video.click({ position: { x: 20, y: 10 } });
      await page.getByRole('tab', { name: 'Audio', exact: true }).click();
      assert.equal(await page.getByRole('textbox', { name: 'Volume', exact: true }).count(), 1);
    });

    await t.test('a horizontal group drag closes the initial gap despite existing overlapping audio', async () => {
      const video = page.locator('[data-block-kind="video"]').first();
      await video.click({ position: { x: 20, y: 10 } });
      await page.keyboard.press(`${mod}+a`);
      const b = await video.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + 10);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 - b.width / 4, b.y + 10, { steps: 10 });
      await page.mouse.up();
      await until(async () => (await film()).tracks[0].clips[0].at == null);
      const moved = await film();
      assert.deepEqual(moved.tracks[0].clips[0].time, [0.767, 4.767]);
      assert.ok(Math.abs(moved.tracks[1].clips[1].at - 1.733) < 0.001);
      await page.keyboard.press(`${mod}+z`);
      await until(async () => (await film()).tracks[0].clips[0].at === 0.767);
    });

    await t.test('I/O marks are carried by a native drag from the source viewer onto the timeline', async () => {
      await page.locator('[data-media-path="assets/source.mp4"]').dblclick();
      const source = page.locator('[data-source-drag]');
      await source.waitFor();
      const video = source.locator('video');
      const position = source.locator('xpath=..').getByRole('slider', { name: 'Position', exact: true });
      /* each mark is put once the source has come to its time and shows it: a seek can take a while on a slow machine */
      const mark = async (sec, key, marks) => {
        await video.evaluate(async (v, sec) => {
          v.pause();
          v.currentTime = sec;
          if (v.seeking) await new Promise((done) => { v.addEventListener('seeked', done, { once: true }); setTimeout(done, 5000); });
          v.dispatchEvent(new Event('timeupdate'));
        }, sec);
        await position.and(page.locator(`[aria-valuenow="${sec}"]`)).waitFor();
        await page.keyboard.press(key);
        await source.locator('xpath=..').locator(`[data-source-marks="${marks}"]`).waitFor({ state: 'attached' });
      };
      await mark(1.2, 'i', '1.2-');
      await mark(3.4, 'o', '1.2-3.4');
      const b = await page.locator('[data-block-kind="video"]').first().boundingBox();
      await page.evaluate(() => document.addEventListener('dragstart', (e) => { window.sourceDragPayload = e.dataTransfer.getData('application/x-openfilm-resource'); }, { once: true }));
      const drop = page.locator('[data-timeline]');
      const tl = await drop.boundingBox();
      await source.dragTo(drop, { targetPosition: { x: b.x + b.width + 100 - tl.x, y: b.y + b.height / 2 - tl.y } });
      assert.deepEqual(await page.evaluate(() => JSON.parse(window.sourceDragPayload).range), { inMs: 1200, outMs: 3400 });
      await until(async () => (await film()).tracks.some((tr) => tr.clips.some((c) => c.src === 'assets/source.mp4')));
      const added = (await film()).tracks.flatMap((tr) => tr.clips).find((c) => c.src === 'assets/source.mp4');
      assert.deepEqual(added.time, [1.2, 3.4]);
      assert.equal(added.volume, undefined, 'source insertion keeps the original audio level');
      await page.keyboard.press('Escape');
    });

    await t.test('Alt down/up moves multiple clips together and each move is one undo', async () => {
      const sound = (id, at) => ({ id, src: 'assets/source.mp4', sound: true, at, time: [0, 1] });
      const original = { stage: { w: 640, h: 360 }, tracks: [
        { clips: [sound('a', 1), sound('b', 3), sound('c', 5)] },
        { clips: [sound('other', 8)] },
      ] };
      await freshFilm(original);
      const blocks = page.locator('[data-block-id]');
      const first = blocks.nth(0);
      await first.click({ position: { x: 15, y: 10 } });
      await blocks.nth(1).click({ modifiers: [mod], position: { x: 15, y: 10 } });
      await blocks.nth(2).click({ modifiers: [mod], position: { x: 15, y: 10 } });
      await page.keyboard.press('Alt+ArrowDown');
      await until(async () => (await film()).tracks.length === 1);
      assert.deepEqual((await film()).tracks[0].clips.map((c) => [c.id, c.at]), [['a', 1], ['b', 3], ['c', 5], ['other', 8]]);
      await page.keyboard.press(`${mod}+z`);
      await until(async () => (await film()).tracks.length === 2);
      assert.deepEqual((await film()).tracks, original.tracks);
      // Put the selected row below the other row, then exercise the symmetric command.
      await freshFilm({ ...original, tracks: [...original.tracks].reverse() });
      const upBlocks = page.locator('[data-block-id]');
      await upBlocks.nth(1).click({ position: { x: 15, y: 10 } });
      await upBlocks.nth(2).click({ modifiers: [mod], position: { x: 15, y: 10 } });
      await upBlocks.nth(3).click({ modifiers: [mod], position: { x: 15, y: 10 } });
      await page.keyboard.press('Alt+ArrowUp');
      await until(async () => (await film()).tracks.length === 1);
      assert.deepEqual((await film()).tracks[0].clips.map((c) => [c.id, c.at]), [['a', 1], ['b', 3], ['c', 5], ['other', 8]]);
    });

    await t.test('slow font-size typing keeps 60px through preview, commit and subsequent edits', async () => {
      await cp(new URL('../library/text/text/files/', import.meta.url), join(root, 'saved/openfilm/text-text'), { recursive: true });
      await freshFilm({ stage: { w: 1920, h: 1080 }, tracks: [{ clips: [{
        id: 'words', src: 'saved/openfilm/text-text/text.html', time: [0, 5], size: { w: 622, h: 95 }, box: { x: 100, y: 100, w: 622, h: 95 },
        overrides: [{ at: ':root', style: { '--size': '52.63vh', '--font': 'Arial, sans-serif', '--weight': '300' } }, { at: '.t', text: "ARTDECO 1930’s STYLE" }],
      }] }] });
      await page.locator('[data-block-id]').first().click({ position: { x: 25, y: 10 } });
      const size = page.getByRole('textbox', { name: 'Size', exact: true });
      await size.waitFor();
      await until(async () => (await size.inputValue()) === '50');
      await size.click();
      await size.press(`${mod}+a`);
      await size.pressSequentially('60', { delay: 650 });
      await page.waitForTimeout(650);
      await size.press('Enter');
      await until(async () => (await size.inputValue()) === '60');
      await page.waitForTimeout(500);
      assert.equal(await size.inputValue(), '60');
      for (const value of ['80', '60']) {
        await size.fill(value);
        await size.press('Enter');
        /* the text refits after each commit: a slow machine takes longer than 400 ms to show the size kept */
        await until(async () => (await size.inputValue()) === value);
        await page.waitForTimeout(400);
        assert.equal(await size.inputValue(), value);
      }
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true });
  }
});
