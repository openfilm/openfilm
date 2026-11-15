import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('preview fullscreen and tooltips follow the active keys, including legacy schemes and unbound actions', { timeout: 120000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-fullscreen-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Keys');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'card.html'), '<!doctype html><body style="background:#123"><script>window.film={duration:8,width:640,height:360,frame(){}}</script>');
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 640, h: 360 }, tracks: [{ clips: [{ id: 'card', src: 'card.html', time: [0, 8] }] }] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'en-US' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { localStorage.setItem('openfilm.language', 'en'); localStorage.setItem('openfilm.project.assets', '1'); });
    let keys = { scheme: 'custom1', custom: { custom1: { base: 'openfilm', keys: { 'toggle-linkage': ['`', 'shift+`'] } } } };
    await page.route('**/api/prefs*', async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      await route.fulfill({ response, json: { ...json, keys } });
    });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const fullscreen = page.getByRole('button', { name: 'Full screen', exact: true });
    await fullscreen.waitFor();
    await fullscreen.hover();
    await page.getByRole('tooltip').filter({ hasText: 'Full screen' }).waitFor();
    assert.match(await page.getByRole('tooltip').textContent(), /~/);
    const linkage = page.getByRole('button', { name: /^Linkage/ });
    const before = await linkage.getAttribute('aria-pressed');
    await page.keyboard.press('Backquote');
    await page.waitForFunction(() => !!document.fullscreenElement);
    await page.mouse.move(800, 800);
    const exit = page.getByRole('button', { name: 'Exit full screen', exact: true });
    await exit.hover();
    await page.getByRole('tooltip').filter({ hasText: 'Exit full screen' }).waitFor();
    assert.match(await page.getByRole('tooltip').textContent(), /~/, 'fullscreen portal contains the active shortcut');
    await page.keyboard.press('Backquote');
    await page.waitForFunction(() => !document.fullscreenElement);
    assert.equal(await linkage.getAttribute('aria-pressed'), before, 'bare backquote does not toggle linkage');
    await page.keyboard.press('Shift+Backquote');
    assert.notEqual(await linkage.getAttribute('aria-pressed'), before, 'Shift backquote still toggles linkage');

    // Source pages use their own preview and must not toggle the underlying film fullscreen twice.
    await page.locator('[data-media-path="card.html"]').dblclick();
    await page.locator('[data-asset-preview-control]').first().waitFor();
    await page.keyboard.press('Backquote');
    await page.waitForFunction(() => !!document.fullscreenElement?.querySelector('[data-asset-preview-control]'));
    await page.keyboard.press('Backquote');
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.keyboard.press('Escape');

    keys = { scheme: 'custom1', custom: { custom1: { base: 'openfilm', keys: { 'preview-fullscreen': ['alt+f'], 'toggle-snap': [], 'play-pause': ['alt+Space'] } } } };
    await page.reload();
    await fullscreen.waitFor();
    await fullscreen.hover();
    await page.getByRole('tooltip').filter({ hasText: 'Full screen' }).waitFor();
    const hint = await fullscreen.getAttribute('data-shortcut');
    assert.match(hint, /F/); assert.doesNotMatch(hint, /~/);
    await page.keyboard.press('Backquote');
    assert.equal(await page.evaluate(() => !!document.fullscreenElement), false);
    await page.keyboard.press('Alt+f');
    await page.waitForFunction(() => !!document.fullscreenElement);
    await page.keyboard.press('Alt+f');
    await page.waitForFunction(() => !document.fullscreenElement);
    const snap = page.getByRole('button', { name: /^Snap/ });
    assert.equal(await snap.getAttribute('data-shortcut'), null, 'unbound tool never advertises an obsolete default');
    // Text editing keeps the remapped key as text input rather than triggering fullscreen.
    await page.evaluate(() => { const input = document.createElement('input'); input.id = 'typing-check'; document.body.append(input); input.focus(); });
    await page.keyboard.press('Alt+f');
    assert.equal(await page.evaluate(() => !!document.fullscreenElement), false);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); await studio?.close();
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(scratch, { recursive: true, force: true });
  }
});
