import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('a link shows what it names: the workbench of its file is shown, and the clip, the moment or the node in it', { timeout: 90_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-links-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS', 'TRASH_DIR', 'SKILLS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Links');
    await mkdir(join(root, 'assets'), { recursive: true });
    await mkdir(join(root, '.film'), { recursive: true });
    for (const [name, fill] of [['a', '#486b8e'], ['b', '#8e6b48']]) {
      await writeFile(join(root, 'assets', `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${fill}"/></svg>`);
    }
    await writeFile(join(root, 'film.html'), filmHtml({
      stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'a', src: 'assets/a.svg', time: [0, 2] }, { id: 'b', src: 'assets/b.svg', time: [0, 2], at: 2 }] }],
    }));
    await writeFile(join(root, '.film', 'canvas.json'), JSON.stringify({ nodes: [{ id: 'n1', x: 0, y: 0, text: 'First' }, { id: 'n2', x: 2400, y: 1600, text: 'Far' }], edges: [] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {}, editorDir: process.env.OPENFILM_TEST_EDITOR_DIR });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'en-US', reducedMotion: 'reduce' });
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    /* the app, as far as links go: its commands to Studio, and what Studio says is selected and where the playhead is */
    await page.addInitScript(() => {
      window.openfilmHost = {
        version: 1,
        onCommand: (receive) => { window.studioCommand = receive; },
        onSelection: (selection) => { window.selection = selection; },
      };
    });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    await page.locator('[data-block-id]').first().waitFor({ state: 'visible' });
    await page.waitForFunction(() => typeof window.studioCommand === 'function' && window.selection);

    /** The clips selected and the playhead, once they are `ids` and `time`. */
    const selected = (ids, time) => page.waitForFunction(([ids, time]) => {
      const s = window.selection;
      return s && Math.abs(s.time - time) < 0.002 && JSON.stringify(s.refs.filter((r) => r.kind === 'clip').map((r) => r.id)) === JSON.stringify(ids);
    }, [ids, time]);
    const canvasShown = (shown) => page.waitForFunction((shown) => {
      const box = document.querySelector('[data-workspace-canvas]');
      return shown ? box?.getAttribute('aria-hidden') === 'false' : !box || box.getAttribute('aria-hidden') === 'true';
    }, shown);
    const nodeSelected = (id) => page.locator(`[data-workspace-canvas] .react-flow__node[data-id="${id}"].selected`).waitFor({ state: 'visible' });
    /* the edit may not take a seek until its picture is there: a link is opened again until it does */
    const opened = async (send, check) => {
      for (let tries = 0; ; tries++) {
        await send();
        try { await check(); return; } catch (e) { if (tries >= 10) throw e; }
      }
    };

    /* the app's chat opens a link: the clip is selected and the playhead at its start */
    await opened(() => page.evaluate(() => window.studioCommand({ type: 'open', link: 'film.html#b' })), () => selected(['b'], 2));
    /* a plugin opens one (openfilm/studio open): the moment */
    await page.evaluate(() => import('openfilm/studio').then((studio) => studio.open('film.html#t=1.25')));
    await selected(['b'], 1.25);
    /* a stretch: the playhead at its start */
    await page.evaluate(() => window.studioCommand({ type: 'open', link: 'film.html#t=3,3.5' }));
    await selected(['b'], 3);

    /* a node of the canvas's board: the canvas is shown, the node selected and in view */
    await canvasShown(false);
    await page.evaluate(() => import('openfilm/studio').then((studio) => studio.open('.film/canvas.json#n2')));
    await canvasShown(true);
    await nodeSelected('n2');

    /* from the canvas, a clip: the edit is shown again, the clip selected (the app's select-clip, as it was) */
    await page.evaluate(() => window.studioCommand({ type: 'select-clip', id: 'a', loc: null, seek: true }));
    await canvasShown(false);
    await selected(['a'], 0);
    /* the app's show-node, as it was: the canvas, on the node */
    await page.evaluate(() => window.studioCommand({ type: 'show-node', id: 'n1' }));
    await canvasShown(true);
    await nodeSelected('n1');
    /* the app's seek from the canvas: the edit, at the moment */
    await page.evaluate(() => window.studioCommand({ type: 'seek', time: 0.5 }));
    await canvasShown(false);
    await selected(['a'], 0.5);
    /* what names nothing in the project is let be */
    await page.evaluate(() => window.studioCommand({ type: 'open', link: 'https://openfilm.dev/#t=3' }));
    await page.waitForTimeout(300);
    await selected(['a'], 0.5);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
