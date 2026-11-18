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

test('default video audio stays at 0 dB; a muted video keeps its waveform and can be restored from the line or inspector', { timeout: 60_000, skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-video-volume-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Video volume');
    await mkdir(join(root, 'assets'), { recursive: true });
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(root, 'assets/clip.mp4')]);
    const path = join(root, 'film.html');
    await writeFile(path, filmHtml({ stage: { w: 640, h: 360 }, tracks: [{ clips: [0, 1, 2, 3].map((i) => ({ id: `clip-${i}`, src: 'assets/clip.mp4', at: i * 4, time: [0, 4] })) }] }));
    const film = async () => readFilmFile(await readFile(path, 'utf8')).value;
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {}, editorDir: process.env.OPENFILM_TEST_EDITOR_DIR });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'en-US' });
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { localStorage.setItem('openfilm.language', 'en'); });
    const until = async (check, why) => {
      for (let i = 0; i < 100; i++) { if (await check()) return; await page.waitForTimeout(50); }
      assert.fail(why);
    };
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const videos = page.locator('[data-block-kind="video"]');
    await until(async () => (await videos.locator('[data-audio-band="on"]').count()) === 4, 'all default video clips show their audio');
    for (let i = 0; i < 4; i++) {
      await videos.nth(i).click({ position: { x: 20, y: 10 } });
      await page.getByRole('tab', { name: 'Audio', exact: true }).click();
      assert.equal(await page.getByRole('textbox', { name: 'Volume', exact: true }).inputValue(), '0');
    }
    assert.ok((await film()).tracks[0].clips.every((c) => c.volume == null), 'selection never writes a mute or changes default volume');
    assert.ok(!(await film()).tracks[0].muted, 'the default track is audible');

    // Track mute is independent of the volume stored on each clip.
    await page.getByRole('button', { name: 'Turn off original sound', exact: true }).click();
    await until(async () => (await film()).tracks[0].muted === true, 'track muted');
    assert.ok((await film()).tracks[0].clips.every((c) => c.volume == null));
    await page.getByRole('button', { name: 'Turn on original sound', exact: true }).click();
    await until(async () => !(await film()).tracks[0].muted, 'track unmuted');

    const video = videos.first();
    await video.click({ position: { x: 20, y: 10 } });
    await page.getByRole('tab', { name: 'Audio', exact: true }).click();
    const level = page.getByRole('textbox', { name: 'Volume', exact: true });
    await level.fill('-60');
    await level.press('Enter');
    await until(async () => (await film()).tracks[0].clips[0].volume === 0, 'clip muted');
    await video.locator('[data-audio-band="on"]').waitFor();
    assert.equal(await video.locator('[data-audio-muted="1"]').count(), 1, 'silence is marked instead of hiding the audio');
    await video.locator('canvas[data-wave-volume="0"]').waitFor();
    const b = await video.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + 20);
    const line = video.locator('[data-volume-line="0"]');
    await line.waitFor();
    const edge = await line.boundingBox();
    assert.equal(await line.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('[data-volume-line]') === el;
    }), true, 'the volume line remains reachable inside the clipped video');
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
    await page.mouse.down();
    await page.mouse.move(edge.x + edge.width / 2, edge.y - 4, { steps: 5 });
    await page.mouse.up();
    await until(async () => ((await film()).tracks[0].clips[0].volume ?? 1) > 0, 'a muted video can be turned up from its own line');
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+z`);
    await until(async () => (await film()).tracks[0].clips[0].volume === 0, 'restore is undoable');
    await page.locator('[data-volume-restore]').click();
    await until(async () => ((await film()).tracks[0].clips[0].volume ?? 1) === 1, 'one click restores the original level');
    await until(async () => (await level.inputValue()) === '0', 'the inspector shows the restored level');
    assert.ok((await film()).tracks[0].clips.slice(1).every((c) => c.volume == null), 'other clips keep their original level');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true });
  }
});

for (const factorySettings of [false, true]) test(`video volume remains original through import, duplicate, group move, split, trim, clipboard, track mute and reopen (${factorySettings ? 'default switches' : 'free editing'})`, { timeout: 120_000, skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-video-volume-flows-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Volume workflows');
    await mkdir(root, { recursive: true });
    const source = join(scratch, 'IMG_0001.mp4');
    const mov = join(scratch, 'IMG_0002.MOV');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source]);
    execFileSync('ffmpeg', ['-v', 'error', '-i', source, '-c', 'copy', mov]);
    const path = join(root, 'film.html');
    await writeFile(path, filmHtml({ stage: { w: 640, h: 360 }, tracks: [] }));
    const film = async () => readFilmFile(await readFile(path, 'utf8')).value;
    const clips = async () => (await film()).tracks.flatMap((t) => t.clips);
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {}, editorDir: process.env.OPENFILM_TEST_EDITOR_DIR });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1800, height: 1100 }, locale: 'en-US' });
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript((factorySettings) => {
      localStorage.setItem('openfilm.language', 'en');
      localStorage.setItem('openfilm.project.assets', '1');
      if (!factorySettings) {
        localStorage.setItem('openfilm.timeline.snap', '0');
        localStorage.setItem('openfilm.timeline.mainTrackMagnet', '0');
        localStorage.setItem('openfilm.timeline.mainTrackLinkage', '0');
      }
    }, factorySettings);
    const until = async (check, why) => {
      for (let i = 0; i < 160; i++) { if (await check()) return; await page.waitForTimeout(50); }
      assert.fail(why);
    };
    const videos = page.locator('[data-block-kind="video"]');
    const timeline = page.locator('[data-timeline]');
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    const checkpoints = [];
    const original = async (operation) => {
      const state = await film();
      const all = state.tracks.flatMap((t) => t.clips);
      assert.ok(all.length > 0);
      assert.ok(all.every((c) => (c.volume ?? 1) === 1), `${operation}: clip volumes ${JSON.stringify(all.map(c => [c.id,c.volume]))}`);
      assert.ok(state.tracks.every((t) => !t.muted), `${operation}: original sound stays on`);
      await videos.first().click({ position: { x: 20, y: 10 } });
      await page.getByRole('tab', { name: 'Audio', exact: true }).click();
      assert.equal(await page.getByRole('textbox', { name: 'Volume', exact: true }).inputValue(), '0', operation);
      checkpoints.push({ operation, clips: all.length, dB: 0 });
      console.log('0 dB verified:', operation, all.length);
    };
    const landing = async () => {
      if (!await videos.count()) {
        const b = await page.locator('[data-timeline-empty]').boundingBox();
        return { x: b.x + 20, y: b.y + b.height / 2 };
      }
      const b = await videos.last().boundingBox();
      const tl = await timeline.boundingBox();
      return { x: Math.min(tl.x + tl.width - 40, b.x + b.width + 20), y: b.y + 20 };
    };
    const importDrop = async (file, name) => {
      const before = (await clips()).length;
      const data = await page.evaluateHandle(({ base64, name }) => {
        const dt = new DataTransfer();
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        dt.items.add(new File([bytes], name, { type: name.endsWith('.MOV') ? 'video/quicktime' : 'video/mp4' }));
        return dt;
      }, { base64: (await readFile(file)).toString('base64'), name });
      const at = await landing();
      const target = timeline.locator('.tl-scroll');
      await target.dispatchEvent('dragover', { dataTransfer: data, clientX: at.x, clientY: at.y });
      await target.dispatchEvent('drop', { dataTransfer: data, clientX: at.x, clientY: at.y });
      await data.dispose();
      await until(async () => (await clips()).length > before, `${name} imports onto timeline`);
      await until(async () => (await videos.locator('[data-audio-band="on"]').count()) === (await videos.count()), 'imported videos have sound');
    };
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    await page.locator('[data-timeline-empty]').waitFor();
    await importDrop(source, 'IMG_0001.mp4');
    await original('MP4 external drop onto empty timeline');
    await importDrop(mov, 'IMG_0002.MOV');
    await original('MOV external drop onto occupied timeline');

    const tile = page.locator('[data-media-path="assets/IMG_0001.mp4"]');
    await tile.click();
    let count = (await clips()).length;
    await page.keyboard.press('Enter');
    await until(async () => (await clips()).length > count, 'Enter adds the media file');
    await original('media pane Enter');
    const at = await landing();
    const tl = await timeline.boundingBox();
    count = (await clips()).length;
    await tile.dragTo(timeline, { targetPosition: { x: at.x - tl.x, y: at.y - tl.y } });
    await until(async () => (await clips()).length > count, 'native media drag inserts another clip');
    await original('native media drag');

    await videos.first().click({ position: { x: 20, y: 10 } });
    await page.keyboard.press(`${mod}+a`);
    const groupBefore = await readFile(path, 'utf8');
    let b = await videos.first().boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + 10);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + b.width / 8, b.y + 10, { steps: 8 });
    await page.mouse.up();
    // With the main-track magnet, moving the whole track can preserve its closed-up layout.
    if (!factorySettings) await until(async () => (await readFile(path, 'utf8')) !== groupBefore, 'the selected group moves');
    await original('select all and move group');

    b = await videos.first().boundingBox();
    const ruler = await page.getByRole('slider', { name: 'Drag the playhead', exact: true }).boundingBox();
    await page.mouse.click(b.x + b.width / 2, ruler.y + ruler.height / 2);
    count = (await clips()).length;
    await page.keyboard.press(`${mod}+b`);
    await until(async () => (await clips()).length > count, 'split creates a second half');
    await original('split a video');

    const trimBefore = await readFile(path, 'utf8');
    const trim = videos.first().locator('[data-trim="end"]');
    const edge = await trim.boundingBox();
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
    await page.mouse.down();
    await page.mouse.move(edge.x + edge.width / 2 - 15, edge.y + edge.height / 2, { steps: 5 });
    await page.mouse.up();
    await until(async () => (await readFile(path, 'utf8')) !== trimBefore, 'trim writes the source end');
    await original('trim the source end');

    count = (await clips()).length;
    await page.keyboard.press(`${mod}+c`);
    await page.keyboard.press(`${mod}+v`);
    await until(async () => (await clips()).length > count, 'paste duplicates the selected clip');
    await original('copy and paste');
    await page.keyboard.press(`${mod}+z`);
    await until(async () => (await clips()).length === count, 'undo paste');
    await original('undo');
    await page.keyboard.press(`${mod}+Shift+z`);
    await until(async () => (await clips()).length > count, 'redo paste');
    await original('redo');

    await page.getByRole('button', { name: 'Turn off original sound', exact: true }).first().click();
    await until(async () => (await film()).tracks.some(t => t.muted), 'track mute writes');
    assert.ok((await clips()).every(c => (c.volume ?? 1) === 1), 'track mute does not zero clip levels');
    await page.getByRole('button', { name: 'Turn on original sound', exact: true }).first().click();
    await until(async () => (await film()).tracks.every(t => !t.muted), 'track unmute writes');
    await original('original-sound track switch');
    await page.reload();
    await videos.first().waitFor();
    await original('save and reopen');

    await videos.first().click({ position: { x: 20, y: 10 } });
    await page.keyboard.press(`${mod}+a`);
    await page.getByRole('tab', { name: 'Audio', exact: true }).click();
    const level = page.getByRole('textbox', { name: 'Volume', exact: true });
    await level.fill('0');
    await level.press('Enter');
    assert.ok((await clips()).every(c => (c.volume ?? 1) === 1), '0 dB entered for a selection never means zero linear gain');
    await level.fill('-60');
    await level.press('Enter');
    await until(async () => (await clips()).every(c => c.volume === 0), 'explicit -60 dB mutes the selection');
    await page.locator('[data-volume-restore]').click();
    await until(async () => (await clips()).every(c => (c.volume ?? 1) === 1), 'Unmute restores the whole selection');
    await original('explicit batch mute and restore');
    console.log('Volume workflow checkpoints:', JSON.stringify(checkpoints));
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true });
  }
});
