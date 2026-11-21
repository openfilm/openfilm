import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('a video clip\'s thumbnails come from its file\'s strip: there as the film opens, on every clip of the file, and through a zoom without a frame asked for each cell', { timeout: 120_000, skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-strips-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS', 'TRASH_DIR'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Strips');
    await mkdir(root, { recursive: true });
    /* twenty-four seconds, a key frame every 0.4 s: its key frames are its strip, made in a moment */
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=24', '-pix_fmt', 'yuv420p', '-g', '10', '-keyint_min', '10', '-sc_threshold', '0', join(root, 'clip.mp4')]);
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [
      { id: 'a', src: 'clip.mp4', time: [0, 8] },
      { id: 'b', src: 'clip.mp4', at: 8, time: [10, 18] },
      { id: 'c', src: 'clip.mp4', at: 16, time: [14, 22] },
    ] }] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {}, editorDir: process.env.OPENFILM_TEST_EDITOR_DIR });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'en-US', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.setDefaultTimeout(15_000);
    /* what is asked of Studio about the video's pictures */
    const asked = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith('/media') && url.searchParams.get('path') === 'clip.mp4') asked.push(url.searchParams.get('what'));
    });
    await page.addInitScript(() => { localStorage.setItem('openfilm.language', 'en'); });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const blocks = page.locator('[data-timeline] [data-block-id][data-block-kind="video"]');
    await blocks.nth(2).waitFor();
    /* every clip of the file shows pictures of the strip */
    await page.waitForFunction(() => {
      const list = [...document.querySelectorAll('[data-timeline] [data-block-id][data-block-kind="video"]')];
      return list.length === 3 && list.every((b) => b.querySelector('[data-thumb-cell]'));
    });
    const cells = await page.evaluate(() => [...document.querySelectorAll('[data-timeline] [data-block-id][data-block-kind="video"]')].map((b) => {
      const cell = b.querySelector('[data-thumb-cell]');
      const style = getComputedStyle(cell);
      return { n: b.querySelectorAll('[data-thumb-cell]').length, image: style.backgroundImage, position: style.backgroundPosition };
    }));
    assert.ok(cells.every((c) => c.n >= 1 && /what=strip-picture/.test(c.image)), JSON.stringify(cells));
    assert.equal(new Set(cells.map((c) => c.image)).size, 1, 'the three clips draw from the one image');
    assert.equal(new Set(cells.map((c) => c.position)).size, 3, 'each from its own part of the file');
    assert.equal(asked.filter((what) => what === 'strip').length, 1, 'asked for once, for all of them');
    assert.equal(asked.filter((what) => what === 'strip-picture').length, 1);
    /* a zoom in: more cells on each clip, drawn from the strip at once; a frame is asked for only where a cell stands
       between two of its pictures, never one for each cell */
    const before = asked.filter((what) => what === 'frame').length;
    await page.locator('[data-timeline]').hover();
    await page.keyboard.press('=');
    await page.keyboard.press('=');
    await page.waitForFunction((had) => {
      const list = [...document.querySelectorAll('[data-timeline] [data-block-id][data-block-kind="video"]')];
      return list.reduce((n, b) => n + b.querySelectorAll('[data-thumb-cell], img').length, 0) > had;
    }, cells.reduce((n, c) => n + c.n, 0));
    await new Promise((r) => setTimeout(r, 800));
    const shown = await page.evaluate(() => [...document.querySelectorAll('[data-timeline] [data-block-id][data-block-kind="video"]')]
      .filter((b) => b.getBoundingClientRect().width > 8)
      .map((b) => ({ strip: b.querySelectorAll('[data-thumb-cell]').length, own: b.querySelectorAll('img').length })));
    const all = shown.reduce((n, c) => n + c.strip + c.own, 0);
    assert.ok(shown.every((c) => c.strip + c.own >= 1), JSON.stringify(shown));
    assert.ok(asked.filter((what) => what === 'frame').length - before < all, `frames asked for after the zoom: ${asked.filter((what) => what === 'frame').length - before}, cells: ${all}`);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
