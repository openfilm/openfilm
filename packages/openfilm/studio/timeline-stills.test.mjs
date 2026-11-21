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

test('a picture clip\'s thumbnail is a small copy of its file, which the editor itself never loads; a picture no copy is made of is drawn from its file', { timeout: 120_000, skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-stills-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS', 'TRASH_DIR'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Stills');
    await mkdir(root, { recursive: true });
    /* a photograph far larger than a cell, as a PNG and as a JPEG; a drawing; and a file that is no picture */
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=2400x1350', '-frames:v', '1', '-update', '1', join(root, 'photo.png')]);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=2400x1350', '-frames:v', '1', '-update', '1', join(root, 'photo.jpg')]);
    await writeFile(join(root, 'drawing.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="#284"/></svg>');
    await writeFile(join(root, 'broken.png'), 'not a picture');
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [
      { id: 'a', src: 'photo.png', time: [0, 4] },
      { id: 'b', src: 'photo.jpg', at: 4, time: [0, 4] },
      { id: 'c', src: 'photo.png', at: 8, time: [0, 4] },
      { id: 'd', src: 'drawing.svg', at: 12, time: [0, 4] },
      { id: 'e', src: 'broken.png', at: 16, time: [0, 4] },
    ] }] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {}, editorDir: process.env.OPENFILM_TEST_EDITOR_DIR });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'en-US', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.setDefaultTimeout(15_000);
    /* what the editor's own page loads (the preview, a frame inside it, plays the files themselves) */
    const loaded = [];
    page.on('request', (request) => { if (request.frame() === page.mainFrame() && request.resourceType() === 'image') loaded.push(decodeURIComponent(request.url())); });
    await page.addInitScript(() => { localStorage.setItem('openfilm.language', 'en'); });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const blocks = page.locator('[data-timeline] [data-block-id][data-block-kind="video"]');
    await blocks.nth(4).waitFor();
    /* the four that can be drawn show a picture */
    await page.waitForFunction(() => {
      const list = [...document.querySelectorAll('[data-timeline] [data-block-id][data-block-kind="video"]')];
      return list.filter((b) => [...b.querySelectorAll('img')].some((img) => img.complete && img.naturalWidth > 0)).length >= 4;
    });
    const shown = await page.evaluate(() => [...document.querySelectorAll('[data-timeline] [data-block-id][data-block-kind="video"]')].map((b) => {
      const img = [...b.querySelectorAll('img')].find((i) => i.complete && i.naturalWidth > 0);
      return img ? { src: decodeURIComponent(img.currentSrc || img.src), width: img.naturalWidth } : null;
    }));
    for (const i of [0, 1, 2]) {
      assert.match(shown[i].src, /what=poster&path=photo\.(png|jpg)/, 'drawn from the small copy');
      assert.equal(shown[i].width, 480);
    }
    assert.equal(shown[0].src, shown[2].src, 'two clips of a file, one picture');
    assert.match(shown[3].src, /\/drawing\.svg/, 'a drawing is drawn from its file');
    assert.equal(loaded.filter((url) => /\/photo\.(png|jpg)(\?|$)/.test(url)).length, 0, `the editor loads no photograph whole: ${loaded.filter((url) => /photo/.test(url)).join(' ')}`);
    /* the file no copy can be made of: asked of its file, as before (it is no picture either: nothing is shown) */
    await page.waitForFunction(() => performance.getEntriesByType('resource').some((r) => /\/broken\.png/.test(r.name)));
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
