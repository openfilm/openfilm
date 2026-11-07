import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('a restored chat turn refreshes the canvas and clears steps that could bring its removed files back', { timeout: 90_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-canvas-turn-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS', 'TRASH_DIR'];
  const saved = new Map(names.map((n) => [`OPENFILM_${n}`, process.env[`OPENFILM_${n}`]]));
  for (const n of names) process.env[`OPENFILM_${n}`] = join(scratch, n.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Turn');
    await mkdir(join(root, '.film'), { recursive: true });
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 1280, h: 720 }, tracks: [] }));
    const before = { nodes: [{ id: 'note', x: 0, y: 0, w: 350, h: 200, text: 'Before the turn' }], edges: [] };
    await writeFile(join(root, '.film', 'canvas.json'), JSON.stringify(before));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    const post = async (path, body) => {
      const response = await fetch(`${studio.origin}${path}`, {
        method: 'POST', headers: { 'x-studio-key': studio.key, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    await page.locator('[data-work-mode="edit"]').click();
    const note = (text) => page.locator('.react-flow__node').filter({ hasText: text });
    await note('Before the turn').waitFor({ state: 'visible' });
    const applied = await post('/api/canvas', { folder: project.path, ops: [{ op: 'set', id: 'note', text: 'After the turn' }] });
    assert.equal(applied.ok, true);
    await page.waitForTimeout(500);
    await note('After the turn').waitFor({ state: 'visible' });
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    const focusBoard = () => page.locator('.react-flow__pane').click({ position: { x: 20, y: 150 } });
    await focusBoard();
    await page.keyboard.press(`${mod}+z`);
    await note('Before the turn').waitFor({ state: 'visible' });
    await page.keyboard.press(`${mod}+Shift+z`);
    await note('After the turn').waitFor({ state: 'visible' });
    /* Wait for the normal board edit to save before the desktop restores this turn's files. */
    await page.waitForTimeout(500);
    await post(`/api/projects/${project.id}/history/put-back`);
    await writeFile(join(root, '.film', 'canvas.json'), JSON.stringify(before));
    await post(`/api/projects/${project.id}/history/put-back/done`);
    await note('Before the turn').waitFor({ state: 'visible' });
    await focusBoard();
    await page.keyboard.press(`${mod}+z`);
    await page.keyboard.press(`${mod}+Shift+z`);
    await page.waitForTimeout(500);
    assert.equal(await note('After the turn').count(), 0);
    assert.equal(await note('Before the turn').count(), 1);
    assert.deepEqual(JSON.parse(await readFile(join(root, '.film', 'canvas.json'), 'utf8')), before);
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
