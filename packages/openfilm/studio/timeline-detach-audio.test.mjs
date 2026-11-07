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

test('Detach audio on two selected videos takes the sound off both, each linked to its own video', { timeout: 120_000, skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-detach-audio-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Detach');
    await mkdir(join(root, 'assets'), { recursive: true });
    for (const name of ['one', 'two']) {
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=4', '-shortest', '-pix_fmt', 'yuv420p', join(root, 'assets', `${name}.mp4`)]);
    }
    /* two videos with sound, playing at once on two tracks */
    await writeFile(join(root, 'film.html'), filmHtml({
      stage: { w: 320, h: 180 },
      tracks: [
        { clips: [{ id: 'one', src: 'assets/one.mp4', time: [0, 4] }] },
        { clips: [{ id: 'two', src: 'assets/two.mp4', at: 0.5, time: [0, 3] }] },
      ],
    }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US', reducedMotion: 'reduce' });
    await page.addInitScript(() => { localStorage.setItem('openfilm.project.timelineH', '420'); });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const until = async (check, what) => {
      for (let i = 0; i < 80; i += 1) { if (await check()) return; await page.waitForTimeout(100); }
      assert.fail(what);
    };
    const clips = async () => readFilmFile(await readFile(join(root, 'film.html'), 'utf8')).doc.tracks.flatMap((tr) => tr.clips);

    /* both clips drawn, their sound known (probed after the clip is drawn) */
    const videos = page.locator('[data-block-id][data-block-kind="video"]');
    await until(async () => (await videos.count()) === 2, 'both videos are on the timeline');
    for (let i = 0; i < 2; i += 1) await videos.nth(i).locator('[data-audio-band="on"]').waitFor({ state: 'attached', timeout: 20_000 });

    /* the one, then the other added (Ctrl click), and the menu on the selection */
    await videos.nth(0).click({ position: { x: 20, y: 10 } });
    await videos.nth(1).click({ position: { x: 20, y: 10 }, modifiers: ['Control'] });
    await videos.nth(1).click({ button: 'right', position: { x: 20, y: 10 } });
    const detach = page.getByRole('menuitem', { name: /^Detach audio/ });
    await detach.waitFor({ state: 'visible', timeout: 5_000 });
    assert.notEqual(await detach.getAttribute('aria-disabled'), 'true', 'Detach audio can be chosen');
    await detach.click();

    /* film.html: both videos silent, each with a sound of its own file, at its seconds, linked to it */
    await until(async () => (await clips()).filter((c) => c.sound).length === 2, 'two sounds are written');
    const after = await clips();
    for (const id of ['one', 'two']) {
      const video = after.find((c) => c.id === id);
      const sound = after.find((c) => c.sound && c.src === video.src);
      assert.equal(video.volume, 0, `${id} is silent`);
      assert.ok(video.attrs?.['data-link'], `${id} is linked`);
      assert.equal(sound.attrs?.['data-link'], video.attrs['data-link'], `${id}'s sound is linked to it`);
      assert.equal(sound.at, video.at, `${id}'s sound starts with it`);
      assert.deepEqual(sound.time, video.time, `${id}'s sound plays the same seconds`);
    }
    const [linkOne, linkTwo] = ['one', 'two'].map((id) => after.find((c) => c.id === id).attrs['data-link']);
    assert.notEqual(linkOne, linkTwo, 'each video keeps its own link');
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
