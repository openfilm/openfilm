import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml, readFilmFile } from '../src/film-doc.mjs';
import { readVtt, writeVtt } from '../src/captions.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('unlocked caption tracks move with a mixed selection, with one undo for media and captions', { timeout: 90_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-caption-group-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map(n => [`OPENFILM_${n}`, process.env[`OPENFILM_${n}`]]));
  for (const n of names) process.env[`OPENFILM_${n}`] = join(scratch, n.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Group captions');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'card.html'), '<!doctype html><body style="margin:0;background:#234"><script>window.film={duration:8,width:640,height:360,frame(){}}</script>');
    const original = writeVtt({ header: 'WEBVTT', notes: [], regions: [], styles: [], cues: Array.from({ length: 183 }, (_, i) => ({
      id: `c${i + 1}`, start: (1000 + i * 30) / 1000, end: (1020 + i * 30) / 1000, settings: '', text: `Caption ${i + 1}`,
    })) });
    await writeFile(join(root, 'captions.vtt'), original);
    const locked = 'WEBVTT\n\nlocked\n00:00:01.000 --> 00:00:02.000\nLocked caption stays here\n';
    await writeFile(join(root, 'locked.vtt'), locked);
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 640, h: 360 }, tracks: [
      { clips: [], locked: true, captions: { src: 'locked.vtt', kind: 'captions' } },
      { clips: [{ id: 'one', src: 'card.html', at: 1, time: [0, 4] }, { id: 'two', src: 'card.html', at: 5, time: [0, 3] }] },
      { clips: [], captions: { src: 'captions.vtt', kind: 'captions' } },
    ] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {}, editorDir: process.env.OPENFILM_TEST_EDITOR_DIR });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'en-US' });
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem('openfilm.language', 'en');
      localStorage.setItem('openfilm.timeline.snap', '0');
      localStorage.setItem('openfilm.timeline.mainTrackMagnet', '1');
      localStorage.setItem('openfilm.timeline.mainTrackLinkage', '1');
      localStorage.setItem('openfilm.project.timelineH', '400');
    });
    const film = async () => readFilmFile(await readFile(join(root, 'film.html'), 'utf8')).value;
    const shots = async () => (await film()).tracks.find(t => t.clips.some(c => c.id === 'one')).clips;
    const cues = async () => readVtt(await readFile(join(root, 'captions.vtt'), 'utf8')).cues;
    const until = async (check, why) => {
      /* a move of 183 cues and their media is saved in one write, which a slow machine takes seconds over */
      for (let i = 0; i < 300; i++) { if (await check()) return; await page.waitForTimeout(50); }
      assert.fail(why);
    };
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const clip = page.locator('[data-block-kind="mg"][data-can-move="1"]').first();
    const unlockedCues = page.locator('[data-block-id^="cue:captions.vtt#"]');
    const lockedCue = page.locator('[data-block-id="cue:locked.vtt#locked"]');
    /* The two VTT files load independently. Wait for the row that participates in the drag. */
    await lockedCue.waitFor();
    await until(async () => await unlockedCues.count() === 183, 'the unlocked caption cues are ready to select');
    const body = await clip.boundingBox();
    assert.ok(body, 'the movable clip is drawn');
    await clip.click({ position: { x: body.width / 4, y: 10 } });
    await clip.locator('[data-block-frame]').waitFor();
    /* Timeline focus is deferred; the selection frame can appear before its keyboard shortcuts own the press. */
    await page.waitForFunction(() => Boolean(document.activeElement?.closest('[data-timeline]')));
    await page.keyboard.press('ControlOrMeta+a');
    await until(async () => await unlockedCues.locator('[data-block-frame]').count() === 183
      && await page.locator('[data-block-kind="mg"] [data-block-frame]').count() === 2,
      'select all picks both media clips and all unlocked captions');
    assert.equal(await lockedCue.locator('[data-block-frame]').count(), 0, 'the locked cue is never selected');
    const b = await clip.boundingBox();
    assert.ok(b, 'the selected clip is drawn');
    const x = b.x + b.width / 4;
    const y = b.y + 10;
    await page.mouse.move(x, y);
    await page.mouse.down();
    /* The four-second clip is drawn one pixel short to leave a gap at its end. */
    await page.mouse.move(x + (b.width + 1) / 2, y, { steps: 10 });
    await page.mouse.up();
    await until(async () => (await shots())[0].at > 2.5, 'the mixed selection can move right with captions unlocked');
    const delta = (await shots())[0].at - 1;
    assert.ok(Math.abs(delta - 2) < .05);
    const movedCues = await cues();
    assert.equal(movedCues.length, 183);
    movedCues.forEach((cue, i) => assert.ok(Math.abs(cue.start - ((1000 + i * 30) / 1000 + delta)) < .002));
    assert.equal((await shots())[1].at, 5 + delta);
    assert.equal(await readFile(join(root, 'locked.vtt'), 'utf8'), locked, 'locked captions are left in place');
    await page.keyboard.press('ControlOrMeta+z');
    await until(async () => (await shots())[0].at === 1 && (await cues())[0].start === 1, 'one undo restores media and captions together');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await until(async () => (await cues())[0].start > 2.5, 'redo keeps captions with their media');
    assert.equal(await readFile(join(root, 'locked.vtt'), 'utf8'), locked);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
