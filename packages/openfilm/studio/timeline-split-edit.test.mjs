import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml, readFilmFile } from '../src/film-doc.mjs';
import { filmSound, mix, open } from '../src/shared.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('Alt-drag rolls a detached sound or picture cut independently, keeping links, sync and undo', { timeout: 120_000, skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-split-edit-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Split edit');
    await mkdir(join(root, 'assets'), { recursive: true });
    for (const [name, color, hz] of [['one', 'red', 220], ['two', 'blue', 440]]) {
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=${color}:size=320x180:rate=30:duration=8`, '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=8`, '-shortest', '-pix_fmt', 'yuv420p', join(root, 'assets', `${name}.mp4`)]);
    }
    await writeFile(join(root, 'film.html'), filmHtml({
      stage: { w: 320, h: 180 },
      tracks: [{ clips: [
        { id: 'one', src: 'assets/one.mp4', time: [1, 5] },
        { id: 'two', src: 'assets/two.mp4', at: 4, time: [2, 6] },
      ] }],
    }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', reducedMotion: 'reduce' });
    page.setDefaultTimeout(8000);
    await page.addInitScript(() => {
      localStorage.setItem('openfilm.project.timelineH', '440');
      localStorage.setItem('openfilm.timeline.snap', '0');
      localStorage.setItem('openfilm.timeline.mainTrackMagnet', '1');
      localStorage.setItem('openfilm.timeline.mainTrackLinkage', '1');
    });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const until = async (check, what) => {
      for (let i = 0; i < 100; i++) { if (await check()) return; await page.waitForTimeout(100); }
      assert.fail(what);
    };
    const clips = async () => readFilmFile(await readFile(join(root, 'film.html'), 'utf8')).doc.tracks.flatMap((t) => t.clips);
    const video = (name) => page.locator(`[data-block-kind="video"][data-block-title="${name}.mp4"]`);
    const sound = (name) => page.locator(`[data-block-id]:not([data-block-kind="video"])[data-block-title="${name}.mp4"]`);
    const videos = page.locator('[data-block-id][data-block-kind="video"]');
    await until(async () => (await videos.count()) === 2, 'both videos drawn');
    for (let i = 0; i < 2; i++) await videos.nth(i).locator('[data-audio-band="on"]').waitFor({ state: 'attached', timeout: 20_000 });
    await videos.nth(0).click({ position: { x: 20, y: 10 } });
    await videos.nth(1).click({ position: { x: 20, y: 10 }, modifiers: ['Control'] });
    await videos.nth(1).click({ button: 'right', position: { x: 20, y: 10 } });
    await page.getByRole('menuitem', { name: /^Detach audio/ }).click();
    await until(async () => (await clips()).filter((c) => c.sound).length === 2, 'both sounds detached');
    const detached = await clips();
    const by = (all, name, audio = false) => all.find((c) => c.src === `assets/${name}.mp4` && Boolean(c.sound) === audio);
    const at = (c) => c.at ?? 0;
    const end = (c) => at(c) + (c.time[1] - c.time[0]) / (c.speed ?? 1);
    const near = (a, b) => Math.abs(a - b) < 0.002;
    const dragEdge = async (block, edge, seconds, alt = true, tip = 'roll') => {
      const box = await block.boundingBox();
      assert.ok(box, 'the clip is visible');
      const pxPerSecond = box.width / 4;
      const handle = await block.locator(`[data-trim="${edge}"]`).boundingBox();
      const x = handle.x + handle.width / 2;
      const y = handle.y + handle.height / 2;
      if (alt) await page.keyboard.down('Alt');
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + seconds * pxPerSecond, y, { steps: 10 });
      await page.locator(`[data-gesture-tip="${tip}"]`).waitFor({ state: 'visible' });
      await page.mouse.up();
      if (alt) await page.keyboard.up('Alt');
    };

    /* Incoming sound a second before its picture (J cut), from the right clip's head. */
    await dragEdge(sound('two'), 'start', -1);
    await until(async () => near(at(by(await clips(), 'two', true)), 3), 'J cut written');
    let now = await clips();
    assert.ok(near(end(by(now, 'one', true)), 3));
    assert.deepEqual(by(now, 'two', true).time, [1, 6]);
    assert.deepEqual(now.filter((c) => !c.sound), detached.filter((c) => !c.sound), 'pictures stay put');
    for (const name of ['one', 'two']) {
      assert.equal(by(now, name, true).attrs['data-link'], by(now, name).attrs['data-link'], 'the pair stays linked');
      assert.ok(near(at(by(now, name, true)) - by(now, name, true).time[0], at(by(now, name)) - by(now, name).time[0]), 'source sync stays');
    }
    await page.locator('button[aria-label^="Undo"]').click();
    await until(async () => near(at(by(await clips(), 'two', true)), 4), 'one undo restores both sides');
    await page.locator('button[aria-label^="Redo"]').click();
    await until(async () => near(at(by(await clips(), 'two', true)), 3), 'one redo restores the J cut');
    await page.locator('button[aria-label^="Undo"]').click();
    await until(async () => near(at(by(await clips(), 'two', true)), 4), 'back to a straight cut');

    /* Outgoing sound a second beyond its picture (L cut), from the left clip's tail. */
    await dragEdge(sound('one'), 'end', 1);
    await until(async () => near(at(by(await clips(), 'two', true)), 5), 'L cut written');
    now = await clips();
    assert.ok(near(end(by(now, 'one', true)), 5));
    assert.deepEqual(now.filter((c) => !c.sound), detached.filter((c) => !c.sound));
    await page.locator('button[aria-label^="Undo"]').click();
    await until(async () => near(at(by(await clips(), 'two', true)), 4), 'L cut undone');

    /* The same gesture on V1 ignores its magnet: the sound and total length stay. */
    await dragEdge(video('two'), 'start', -1);
    await until(async () => near(at(by(await clips(), 'two')), 3), 'picture cut rolled with the magnet on');
    now = await clips();
    assert.ok(near(end(by(now, 'one')), 3));
    assert.ok(near(end(by(now, 'two')), 8));
    assert.deepEqual(now.filter((c) => c.sound), detached.filter((c) => c.sound), 'sounds stay put');
    await page.locator('button[aria-label^="Undo"]').click();
    await until(async () => near(at(by(await clips(), 'two')), 4), 'picture roll undone');

    /* A free edge trims independently too, rather than rippling V1 and its riders. */
    await dragEdge(video('one'), 'start', 0.5, true, 'trim');
    await until(async () => near(at(by(await clips(), 'one')), 0.5), 'free head trims in place');
    now = await clips();
    assert.ok(near(at(by(now, 'two')), 4));
    assert.deepEqual(now.filter((c) => c.sound), detached.filter((c) => c.sound));
    await page.locator('button[aria-label^="Undo"]').click();
    await until(async () => near(at(by(await clips(), 'one')), 0), 'free trim undone');

    /* A normal trim keeps the existing linked ripple behavior. */
    await dragEdge(video('one'), 'end', -1, false, 'ripple');
    await until(async () => near(at(by(await clips(), 'two')), 3), 'normal trim ripples');
    now = await clips();
    assert.ok(near(at(by(now, 'two', true)), 3));
    assert.ok(near(end(by(now, 'one', true)), 3));
    await page.locator('button[aria-label^="Undo"]').click();
    await until(async () => near(at(by(await clips(), 'two')), 4), 'normal trim undone');
    await dragEdge(sound('two'), 'start', -1);
    await until(async () => near(at(by(await clips(), 'two', true)), 3), 'J cut restored');
    await page.reload();
    await sound('two').waitFor({ state: 'visible' });
    assert.ok(near(at(by(await clips(), 'two', true)), 3), 'the split edit survives reload');

    /* The saved film plays the incoming sound before its picture, through the real sound-export path. */
    const film = await open(root, { browser });
    try {
      await film.film.seek(3.5);
      assert.equal(await film.film.page.locator('#one').evaluate((el) => el.style.visibility), 'visible');
      assert.equal(await film.film.page.locator('#two').evaluate((el) => el.style.visibility), 'hidden');
      const wav = join(scratch, 'mix.wav');
      await mix(await filmSound(film, 0), 8, wav, ['-c:a', 'pcm_s16le']);
      const frequencyAt = (second) => {
        const pcm = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(second), '-i', wav, '-t', '0.2', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
        let crossings = 0;
        for (let i = 4; i < pcm.length; i += 4) if (pcm.readFloatLE(i - 4) <= 0 && pcm.readFloatLE(i) > 0) crossings++;
        return crossings / (pcm.length / 4 / 48_000);
      };
      assert.ok(Math.abs(frequencyAt(2.5) - 220) < 10, 'outgoing sound before the audio cut');
      assert.ok(Math.abs(frequencyAt(3.5) - 440) < 10, 'incoming sound before the picture cut');
    } finally { await film.close(); }
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
