import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('back on the edit, nothing of the canvas shows over the panes, and it comes back as it was', { timeout: 90_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-canvas-hidden-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS', 'TRASH_DIR'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Board');
    await mkdir(join(root, '.film'), { recursive: true });
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 1280, h: 720 }, tracks: [] }));
    await writeFile(join(root, '.film', 'canvas.json'), JSON.stringify({ nodes: [{ id: 'n1', x: 0, y: 0, w: 350, h: 200, text: 'A note on the board' }], edges: [] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {}, editorDir: process.env.OPENFILM_TEST_EDITOR_DIR });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'en-US', reducedMotion: 'reduce' });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const mode = (name) => page.locator(`[data-work-mode="${name}"]`);
    const node = page.locator('.react-flow__node').filter({ hasText: 'A note on the board' });
    const shows = () => node.evaluate((el) => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
    /* Attached is earlier than measured and fitted: wait for the canvas to have actually painted its note. */
    const waitShown = () => page.waitForFunction(() => [...document.querySelectorAll('.react-flow__node')].some((el) =>
      el.textContent.includes('A note on the board') && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })));

    await mode('edit').click();
    await node.waitFor({ state: 'attached', timeout: 30_000 });
    await mode('canvas').waitFor();
    await waitShown();
    assert.equal(await shows(), true, 'on the canvas');

    await mode('canvas').click();
    await mode('edit').waitFor();
    assert.equal(await node.count(), 1, 'kept as it was left');
    assert.equal(await shows(), false, 'on the edit');

    await mode('edit').click();
    await mode('canvas').waitFor();
    await waitShown();
    assert.equal(await shows(), true, 'on the canvas again');
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
