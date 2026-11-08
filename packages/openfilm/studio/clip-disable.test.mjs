import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml, readFilmFile } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('Shift+E and the clip menu disable only the selection, with undo and redo', { timeout: 90_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-clip-disable-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Disable');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'card.html'), '<!doctype html><body style="margin:0;background:red"><script>window.film={duration:2,width:320,height:180,frame(){}}</script>');
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [
      { clips: [{ id: 'first', src: 'card.html', time: [0, 2] }, { id: 'second', src: 'card.html', at: 2, time: [0, 2] }] },
    ] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US', reducedMotion: 'reduce' });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const blocks = page.locator('[data-block-id][data-block-kind="mg"]');
    await blocks.nth(1).waitFor({ state: 'visible' });
    await blocks.nth(0).click({ position: { x: 20, y: 10 } });
    const doc = async () => readFilmFile(await readFile(join(root, 'film.html'), 'utf8')).doc;
    const until = async (check) => {
      for (let i = 0; i < 80; i++) { if (await check()) return; await page.waitForTimeout(100); }
      assert.fail('clip state did not update');
    };
    await page.keyboard.press('Shift+E');
    await until(async () => (await doc()).tracks[0].clips[0].disabled === true);
    assert.equal((await doc()).tracks[0].clips[1].disabled, undefined);
    assert.equal((await doc()).tracks[0].hidden, undefined);
    await until(async () => await page.locator('[data-block-disabled="1"]').count() === 1);
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+z`);
    await until(async () => !(await doc()).tracks[0].clips[0].disabled);
    await page.keyboard.press(`${mod}+Shift+z`);
    await until(async () => (await doc()).tracks[0].clips[0].disabled === true);
    await blocks.nth(0).click({ button: 'right', position: { x: 20, y: 10 } });
    await page.getByRole('menuitem', { name: /^Enable clip/ }).click();
    await until(async () => !(await doc()).tracks[0].clips[0].disabled);
    assert.equal((await doc()).tracks[0].clips.length, 2);
    assert.deepEqual((await doc()).tracks[0].clips.map((c) => [c.at ?? 0, c.time]), [[0, [0, 2]], [2, [0, 2]]]);
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
