import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

async function withBoard(nodes, run) {
  const scratch = await mkdtemp(join(tmpdir(), 'of-canvas-warm-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS', 'TRASH_DIR'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Board');
    await mkdir(join(root, '.film'), { recursive: true });
    await writeFile(join(root, 'page.html'), '<body style="background:#234"><script>window.film={duration:3,frame(){}}</script>');
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 1280, h: 720 }, tracks: [{ clips: [{ id: 'page', src: 'page.html', time: [0, 3] }] }] }));
    const board = JSON.stringify({ nodes, edges: [] });
    const file = join(root, '.film', 'canvas.json');
    await writeFile(file, board);
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {}, editorDir: process.env.OPENFILM_TEST_EDITOR_DIR });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US', reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await run({ page, url: `${studio.origin}/projects/${project.id}?key=${studio.key}`, path: `/api/projects/${project.id}/canvas`, file, board });
    } catch (error) {
      console.error(await page.evaluate(() => ({
        ready: document.querySelector('[data-studio-canvas]')?.getAttribute('data-canvas-ready'),
        mode: document.querySelector('[data-work-mode]')?.getAttribute('data-work-mode'),
        loading: document.querySelector('[data-canvas-loading]')?.textContent,
      })), errors);
      throw error;
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

test('an open video node picks up a service sign-in without reloading the canvas', { timeout: 45_000 }, async () => {
  await withBoard([{ id: 'video', x: 0, y: 0, make: 'video', prompt: 'A camera moves toward the sea.' }], async ({ page, url }) => {
    let status = 'disconnected';
    const model = 'seedance-fast';
    const name = 'Seedance 2.0 Fast';
    await page.context().route((requestUrl) => requestUrl.pathname.startsWith('/api/providers'), async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/providers/openfilm/sign-in' && route.request().method() === 'POST') status = 'waiting';
      const connected = status === 'connected';
      await route.fulfill({ json: {
        providers: [{ id: 'openfilm', name: 'OpenFilm', verbs: ['video'], models: { video: [{ id: model, name }] },
          source: connected ? 'file' : null, signIn: true, account: null, keysUrl: '', pricingUrl: '', env: '', envKey: false, last4: null }],
        use: { video: connected ? 'openfilm' : null }, model: { video: connected ? model : null }, custom: [],
        signingIn: { provider: status === 'waiting' ? 'openfilm' : null, error: null, errorFor: null }, librarySearch: null,
      } });
    });
    const openNode = async (tab) => {
      await tab.goto(url);
      await tab.locator('[data-work-mode]').waitFor();
      if (await tab.locator('[data-work-mode="edit"]').count()) await tab.locator('[data-work-mode="edit"]').click();
      await tab.locator('[data-studio-canvas][data-canvas-ready="1"]').waitFor();
      await tab.getByTestId('rf__node-video').click();
      await tab.getByRole('button', { name: 'Connect a service', exact: true }).waitFor();
    };
    await openNode(page);
    const other = await page.context().newPage();
    other.setDefaultTimeout(8000);
    try {
      await openNode(other);
      await page.getByRole('button', { name: 'Connect a service', exact: true }).click();
      await page.getByRole('button', { name: /Seedance 2\.0 Fast.*Connect/ }).click();
      const settings = page.getByRole('dialog', { name: 'Services', exact: true });
      await settings.getByRole('button', { name: 'OpenFilm', exact: true }).click();
      const provider = page.getByRole('dialog', { name: 'OpenFilm', exact: true });
      await provider.getByRole('button', { name: 'Connect', exact: true }).click();
      await provider.getByText('Finish signing in in your browser…').waitFor();
      await provider.getByRole('button', { name: 'Done', exact: true }).click();
      await settings.getByRole('button', { name: 'Done', exact: true }).click();
      status = 'connected';
      // The modal is gone before the external browser finishes. Both canvases are already open.
      for (const tab of [page, other]) {
        await tab.getByRole('button', { name, exact: true }).waitFor();
        assert.equal(await tab.getByRole('button', { name: 'Connect a service', exact: true }).count(), 0);
        assert.equal(await tab.getByPlaceholder(/^Describe how the camera moves/).inputValue(), 'A camera moves toward the sea.');
      }
    } finally {
      await other.close();
    }
  });
});

test('the edit warms a fitted hidden canvas without writing it; the first switch reuses that board', { timeout: 60_000 }, async () => {
  /* Overlap forces the display layout to change, so warming cannot silently save that change. */
  const nodes = ['One', 'Two'].map((text, i) => ({ id: `n${i}`, x: 0, y: 0, w: 350, h: 200, text }));
  await withBoard(nodes, async ({ page, url, path, file, board }) => {
    await page.addInitScript(() => {
      localStorage.setItem('openfilm.project.assets', '1');
      localStorage.setItem('openfilm.project.assetsW', '380');
    });
    const requests = [];
    page.on('request', (r) => { if (new URL(r.url()).pathname === path) requests.push(r.method()); });
    await page.goto(url);
    await page.locator('[data-work-mode="edit"]').waitFor({ state: 'visible' });
    await page.locator('.react-flow__node').first().waitFor({ state: 'attached' });
    await page.waitForFunction(() => document.querySelector('[data-studio-canvas]')?.dataset.canvasReady === '1');
    await page.waitForTimeout(800); // past the normal autosave delay
    assert.deepEqual(requests, ['GET'], 'only reads the current board, with no warm-up writes');
    assert.equal(await readFile(file, 'utf8'), board);
    assert.equal(await page.locator('[data-work-mode="edit"]').count(), 1, 'still on the edit');
    assert.equal(await page.locator('.react-flow__node').evaluateAll((list) => list.some((el) => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))), false);
    const viewport = page.locator('[data-studio-canvas] .react-flow__viewport');
    const fitted = await viewport.getAttribute('style');
    const frame = page.locator('[data-viewer-picture] iframe').first();
    await frame.waitFor({ state: 'visible' });
    const size = await frame.evaluate((el) => el.getBoundingClientRect().width);
    await page.evaluate(() => {
      window.__editTimeline = document.querySelector('[data-workspace-timeline]');
      window.__editFrame = document.querySelector('[data-viewer-picture] iframe');
    });
    await page.locator('[data-work-mode="edit"]').click();
    assert.equal(await frame.evaluate((el) => el.getBoundingClientRect().width), size, 'the hidden editor keeps its own size');
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => window.__editTimeline === document.querySelector('[data-workspace-timeline]')
      && window.__editFrame === document.querySelector('[data-viewer-picture] iframe')), true, 'timeline and preview stay mounted');
    assert.equal(await page.locator('[data-canvas-loading]').count(), 0, 'the first switch is already prepared');
    assert.equal(await page.locator('.react-flow__node').count(), 2);
    assert.equal(await viewport.getAttribute('style'), fitted, 'no first-open refit');
    await page.locator('[data-work-mode="canvas"]').click();
    await page.locator('[data-work-mode="edit"]').click();
    assert.equal(await viewport.getAttribute('style'), fitted, 'switching back also preserves the view');
    await page.waitForTimeout(800); // opening or changing layouts must stay clean past the autosave window too
    assert.equal(await readFile(file, 'utf8'), board);
    assert.deepEqual(requests, ['GET'], 'no second load on switching');
  });
});

test('opening before warm-up shows a canvas loading surface until an empty board is ready', { timeout: 60_000 }, async () => {
  await withBoard([], async ({ page, url, path }) => {
    /* Do not run optional idle work: exercise the immediate first click, on a slow connection. */
    await page.addInitScript(() => {
      window.requestIdleCallback = () => 1;
      window.cancelIdleCallback = () => {};
    });
    let release;
    const hold = new Promise((done) => { release = done; });
    await page.route(`**${path}`, async (route) => { await hold; await route.continue(); });
    try {
      await page.goto(url);
      // Test the first click while the board request is held, independently of frame scheduling on the runner.
      await page.locator('[data-work-mode="edit"]').dispatchEvent('click');
      const loading = page.locator('[data-canvas-loading]');
      await loading.waitFor({ state: 'visible' });
      assert.equal(await loading.getAttribute('aria-busy'), 'true');
      assert.notEqual(await loading.evaluate((el) => getComputedStyle(el).backgroundImage), 'none');
      release();
      await page.waitForFunction(() => document.querySelector('[data-studio-canvas]')?.dataset.canvasReady === '1');
      await loading.waitFor({ state: 'detached' });
      assert.equal(await page.locator('[data-work-mode="canvas"]').count(), 1);
    } finally { release(); }
  });
});

test('a failed optional canvas preload leaves the edit usable', { timeout: 60_000 }, async () => {
  await withBoard([], async ({ page, url }) => {
    const warming = page.waitForRequest((request) => /\/assets\/CanvasView-[^/]+\.js$/.test(new URL(request.url()).pathname));
    await page.route('**/assets/CanvasView-*.js', (route) => route.abort());
    await page.goto(url);
    await page.locator('[data-work-mode="edit"]').waitFor({ state: 'visible' });
    await warming;
    await page.waitForTimeout(1800); // also cover the old delayed preload's unhandled rejection
    assert.equal(await page.locator('[data-work-mode="edit"]').isVisible(), true);
    assert.equal(await page.locator('[data-studio-canvas]').count(), 0);
  });
});
