import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml, readFilmFile } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('the timeline context menu organizes tracks in one undoable edit', { timeout: 60_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-track-tools-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Tracks');
    const part = join(root, 'parts', 'intro');
    const stage = { w: 320, h: 180 };
    await mkdir(part, { recursive: true });
    await writeFile(join(root, 'card.html'), '<!doctype html><script>window.film={duration:8,frame(){}}</script>');
    await writeFile(join(part, 'film.html'), filmHtml({ stage, tracks: [{ clips: [{ id: 'intro-card', src: '../../card.html', time: [0, 1] }] }] }));
    const clip = (id, at, src = 'card.html', end = 1) => ({ id, src, at, time: [0, end] });
    const initial = [
      { clips: [clip('intro', 0, 'parts/intro/film.html')] },
      { clips: [clip('overlap', 0.5)] },
      { clips: [clip('later', 2)] },
      { locked: true, clips: [clip('locked', 4)] },
      { clips: [clip('main', 0, 'card.html', 8)] },
    ];
    await writeFile(join(root, 'film.html'), filmHtml({ stage, tracks: initial }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    await page.addInitScript(() => { window.openfilmHost = { version: 1, refer() {} }; });
    const tracks = async () => readFilmFile(await readFile(join(root, 'film.html'), 'utf8')).doc.tracks;
    const history = async (name) => {
      const saved = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/edit'));
      await page.locator('[data-timeline]').getByRole('button', { name }).click();
      assert.ok((await saved).ok());
    };

    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const intro = page.locator('[data-block-id]').filter({ hasText: 'intro' }).first();
    await intro.click({ button: 'right', position: { x: 15, y: 10 } });
    assert.deepEqual(await page.getByRole('menuitem').evaluateAll((items) => items.slice(0, 2).map((el) => el.id)),
      ['ctxmenu-refer', 'ctxmenu-enter-compound']);
    await page.keyboard.press('Escape');

    const organize = page.getByRole('menuitem', { name: 'Organize tracks', exact: true });
    const timeline = page.locator('[data-timeline]');
    await timeline.locator('[data-lane-type="visual"]').first().click({ button: 'right' });
    await organize.waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('menuitem', { name: /^Add .* track$/ }).count(), 0);
    await page.keyboard.press('Escape');
    assert.equal(await timeline.getByRole('button', { name: 'Tracks', exact: true }).count(), 0);
    const before = await tracks();
    await timeline.locator('[data-zoom-layer="content"] > div').first().click({ button: 'right', position: { x: 200, y: 20 } });
    const savedEdit = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/edit'));
    await organize.click();
    assert.ok((await savedEdit).ok());
    const after = await tracks();
    assert.deepEqual(after.map((track) => track.clips.map((c) => c.id)), [['intro'], ['overlap', 'later'], ['locked'], ['main']]);
    assert.deepEqual(after.flatMap((track) => track.clips), before.flatMap((track) => track.clips), 'clip fields and timings are intact');
    assert.deepEqual(after.slice(-2), before.slice(-2), 'locked and main tracks are intact');
    await history(/^Undo/);
    assert.deepEqual(await tracks(), before);
    await history(/^Redo/);
    assert.deepEqual(await tracks(), after);

    await intro.click({ position: { x: 15, y: 10 } });
    const overwrite = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/edit'));
    await page.keyboard.press('Alt+ArrowDown');
    assert.ok((await overwrite).ok());
    const moved = await tracks();
    assert.deepEqual(moved[0].clips.map((c) => c.id), ['intro', 'overlap', 'later']);
    assert.deepEqual(moved[0].clips[0], after[0].clips[0]);
    assert.equal(moved[0].clips[1].at, 1);
    assert.deepEqual(moved[0].clips[1].time, [0.5, 1]);
    await history(/^Undo/);
    assert.deepEqual(await tracks(), after);
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
