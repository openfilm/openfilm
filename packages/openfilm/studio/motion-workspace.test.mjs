import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml, readFilmFile } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('animating a clip and adding a layer preserve the edit and its caption track', { timeout: 120_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-motion-workspace-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Motion');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'card.html'), `<!doctype html><body style="margin:0;background:#123">
<h1 style="color:white">Motion integration</h1>
<script>window.film={duration:4,width:320,height:180,frame(){}}</script></body>`);
    const captions = 'WEBVTT\n\nfirst\n00:00:00.000 --> 00:00:03.000\nIntegration caption\n';
    await writeFile(join(root, 'captions.vtt'), captions);
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [
      { clips: [], captions: { src: 'captions.vtt', kind: 'captions', srclang: 'en' } },
      { clips: [{ id: 'card', src: 'card.html', time: [0, 4] }] },
    ] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => { localStorage.setItem('openfilm.project.timelineH', '440'); });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    await page.locator('[data-block-kind="caption"]').first().waitFor({ state: 'visible' });
    await page.locator('[data-timeline-view-item="motion"]').click();
    const layer = page.locator('[data-motion-layer="card"]');
    await layer.waitFor({ state: 'visible' });
    await layer.click({ position: { x: 200, y: 10 } });
    await layer.locator('[data-twirl="card"]').click();
    const position = page.locator('[data-property-row="card:translate"]');
    await position.getByRole('button', { name: /^Animate this/ }).click();
    await position.getByRole('button', { name: /^Stop animating/ }).waitFor({ state: 'visible' });

    const film = async () => readFilmFile(await readFile(join(root, 'film.html'), 'utf8')).doc;
    const until = async (check) => {
      for (let i = 0; i < 80; i++) { if (await check()) return; await page.waitForTimeout(100); }
      assert.fail('the motion edit was not written');
    };
    await until(async () => Object.keys((await film()).keyframes ?? {}).length > 0);
    await page.getByRole('button', { name: 'New layer', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Rectangle', exact: true }).click();
    await until(async () => (await film()).tracks.flatMap((track) => track.clips).length === 2);
    await page.locator('[data-timeline-view-item="edit"]').click();
    await page.locator('[data-block-kind="caption"]').first().waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-motion-layer]').count(), 0);
    assert.equal(await readFile(join(root, 'captions.vtt'), 'utf8'), captions);
    assert.equal((await film()).tracks.filter((track) => track.captions?.src === 'captions.vtt').length, 1);
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
