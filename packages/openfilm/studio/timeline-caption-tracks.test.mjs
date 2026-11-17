import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml, readFilmFile } from '../src/film-doc.mjs';
import { readVtt } from '../src/captions.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('caption tracks can be added, shown together, emptied by a drag, reused and undone', { timeout: 120_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-caption-tracks-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Captions');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'card.html'), '<!doctype html><body style="margin:0;background:#123"><script>window.film={duration:8,width:640,height:360,frame(){}}</script>');
    await writeFile(join(root, 'original.vtt'), 'WEBVTT\n\nfirst\n00:00:00.000 --> 00:00:02.000\nOriginal caption\n');
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 640, h: 360 }, tracks: [
      { clips: [], captions: { src: 'original.vtt', kind: 'captions', label: 'Original' } },
      { clips: [{ id: 'card', src: 'card.html', time: [0, 8] }] },
    ] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, locale: 'en-US', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('openfilm.project.timelineH', '440');
      localStorage.setItem('openfilm.project.assets', '1');
      localStorage.setItem('openfilm.language', 'en');
    });
    const film = async () => readFilmFile(await readFile(join(root, 'film.html'), 'utf8')).doc;
    const captions = async () => (await film()).tracks.filter((t) => t.captions);
    const vtt = async (src) => readVtt(await readFile(join(root, src), 'utf8'));
    const until = async (check, what) => {
      for (let i = 0; i < 100; i += 1) { if (await check()) return; await page.waitForTimeout(100); }
      assert.fail(what);
    };
    const block = (id) => page.locator('[data-block-kind="caption"]').and(page.locator(`[data-block-id=${JSON.stringify(id)}]`));
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    await block('cue:original.vtt#first').waitFor();
    await page.getByRole('button', { name: 'Captions', exact: true }).click();
    await page.getByRole('button', { name: 'By hand', exact: true }).click();
    const addTrack = page.locator('[data-captions-new-track]');
    await addTrack.click();
    await until(async () => (await captions()).length === 2, 'the second caption track was created');
    const second = (await captions())[0].captions.src;
    await block(`cue:${second}#c1`).waitFor();
    await addTrack.click();
    await until(async () => (await captions()).length === 3, 'the third caption track was created');
    const third = (await captions())[0].captions.src;
    await block(`cue:${third}#c1`).waitFor();
    const [one, two] = await Promise.all([vtt(second), vtt(third)]);
    assert.notEqual(one.cues[0].settings, two.cues[0].settings, 'new caption tracks start at distinct positions');
    await until(async () => (await page.locator('[data-caption-hit][role="presentation"]').count()) === 3, 'three captions are visible on the picture at once');

    const originalText = await readFile(join(root, 'original.vtt'), 'utf8');
    const pictureCue = page.locator('[data-caption-hit="first"][role="presentation"]');
    const pictureBox = await pictureCue.boundingBox();
    assert.ok(pictureBox);
    await page.mouse.move(pictureBox.x + pictureBox.width / 2, pictureBox.y + pictureBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(pictureBox.x + pictureBox.width / 2, pictureBox.y + pictureBox.height / 2 - 35, { steps: 8 });
    await page.mouse.up();
    await until(async () => (await readFile(join(root, 'original.vtt'), 'utf8')) !== originalText, 'a caption can be moved freely on the picture');
    assert.deepEqual(await vtt(second), one, 'moving a caption on the picture leaves other tracks in place');
    assert.deepEqual(await vtt(third), two);
    await page.keyboard.press('ControlOrMeta+z');
    await until(async () => (await readFile(join(root, 'original.vtt'), 'utf8')) === originalText, 'the picture move can be undone');

    /* Moving the only cue off the original track keeps an empty lane that can take it back. */
    const drag = async (from, to) => {
      const a = await from.boundingBox(), b = await to.boundingBox();
      assert.ok(a && b);
      const x = a.x + Math.min(a.width / 2, 40);
      await page.mouse.move(x, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, b.y + b.height / 2, { steps: 10 });
      await page.mouse.up();
    };
    const original = block('cue:original.vtt#first');
    await original.click({ position: { x: 35, y: 10 } });
    await drag(original, block(`cue:${second}#c1`));
    await until(async () => (await vtt('original.vtt')).cues.length === 0, 'the cue was moved onto the second track');
    assert.equal((await captions()).length, 3, 'the empty caption track remains');
    const moved = (await vtt(second)).cues.find((c) => c.text === 'Original caption');
    assert.ok(moved);
    assert.equal(moved.start, 0);
    assert.equal(moved.end, 2);
    await block(`cue:${second}#${moved.id}`).waitFor();

    await drag(block(`cue:${second}#${moved.id}`), page.locator('[data-lane-type]').nth(2));
    await until(async () => (await vtt('original.vtt')).cues.length === 1, 'the empty caption lane takes a cue dragged back onto it');
    assert.equal((await vtt(second)).cues.length, 1);
    await page.keyboard.press('ControlOrMeta+z');
    await until(async () => (await vtt('original.vtt')).cues.length === 0, 'undo restores the empty track');

    await page.keyboard.press('ControlOrMeta+z');
    await until(async () => (await vtt('original.vtt')).cues.length === 1, 'undo restores both caption files');
    assert.equal((await vtt(second)).cues.length, 1);
    assert.equal((await captions()).length, 3);
    await block('cue:original.vtt#first').click({ position: { x: 35, y: 10 } });
    const addOne = page.locator('[data-captions-add-one]');
    assert.match(await addOne.textContent(), /V2/, 'manual captions target the selected original track, rather than the top track');
    const originalBox = await block('cue:original.vtt#first').boundingBox();
    const ruler = await page.getByRole('slider', { name: 'Drag the playhead' }).boundingBox();
    assert.ok(originalBox && ruler);
    await page.mouse.click(originalBox.x + originalBox.width * 1.5, ruler.y + ruler.height / 2);
    await addOne.click();
    await until(async () => (await vtt('original.vtt')).cues.length === 2, 'a manual caption is added to the selected original track');
    assert.equal((await vtt(second)).cues.length, 1);
    assert.equal((await vtt(third)).cues.length, 1);
    assert.deepEqual(errors, []);
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
