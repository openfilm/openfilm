import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml, readFilmFile } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('a film of hundreds of clips zoomed to fit draws each narrow clip as one element, which is still picked, trimmed and drawn whole once selected', { timeout: 120_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-narrow-clips-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS', 'TRASH_DIR'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Narrow clips');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'card.html'), '<!doctype html><body style="margin:0;background:#234"><script>window.film={frame(){}}</script></body>');
    /* two rows over two minutes: 240 clips of half a second, 150 of eight tenths (a little wider: wide enough to trim) */
    const short = Array.from({ length: 240 }, (_, i) => ({ id: `s${i}`, src: 'card.html', at: i * 0.5, time: [0, 0.5] }));
    const longer = Array.from({ length: 150 }, (_, i) => ({ id: `l${i}`, src: 'card.html', at: i * 0.8, time: [0, 0.8] }));
    const path = join(root, 'film.html');
    await writeFile(path, filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: short }, { clips: longer }] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {}, editorDir: process.env.OPENFILM_TEST_EDITOR_DIR });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'en-US', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.setDefaultTimeout(10_000);
    await page.addInitScript(() => {
      localStorage.setItem('openfilm.language', 'en');
      localStorage.setItem('openfilm.timeline.snap', '0');
      localStorage.setItem('openfilm.timeline.mainTrackMagnet', '0');
      localStorage.setItem('openfilm.timeline.mainTrackLinkage', '0');
    });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    await page.locator('[data-block-id]').first().waitFor();
    await page.waitForFunction(() => document.querySelectorAll('[data-timeline] [data-block-id]').length >= 390);

    /* every clip is drawn, and the narrow ones as a single element: nothing in them but the edges they are trimmed by */
    const drawn = await page.evaluate(() => {
      const blocks = [...document.querySelectorAll('[data-timeline] [data-block-id]')];
      const compact = blocks.filter((b) => b.hasAttribute('data-block-compact'));
      return {
        blocks: blocks.length, compact: compact.length,
        widest: Math.max(...compact.map((b) => b.offsetWidth)),
        inside: compact.reduce((n, b) => n + [...b.querySelectorAll('*')].filter((el) => !el.matches('[data-trim]')).length, 0),
        colored: compact.every((b) => getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)' || getComputedStyle(b).backgroundImage !== 'none'),
        nodes: document.querySelector('[data-timeline]').querySelectorAll('*').length,
      };
    });
    assert.equal(drawn.blocks, 390);
    assert.ok(drawn.compact >= 380, `the narrow clips are drawn as one element: ${JSON.stringify(drawn)}`);
    assert.ok(drawn.widest <= 8);
    assert.equal(drawn.inside, 0, 'nothing inside one but its trim edges');
    assert.equal(drawn.colored, true, 'each has its color');
    assert.ok(drawn.nodes < 1200, `the timeline of 390 clips is a few hundred elements, not six for each clip: ${drawn.nodes}`);

    /* a click picks it: selected, it is drawn whole (its frame, its name), and goes back to one element when another is picked */
    /* a block is named by its file, its track and its place on it */
    const first = page.locator('[data-block-id="card#0.20"]');
    const box = await first.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await first.locator('[data-block-frame]').waitFor();
    assert.equal(await first.getAttribute('data-block-compact'), null);
    assert.equal(await first.locator(':scope > div').count(), 1, 'drawn whole: its box, clipped to its corners, is in it again');
    assert.equal(await first.locator('[data-pin]').count(), 0, 'still without a name: there is no room for one');
    const other = await page.locator('[data-block-id="card#0.60"]').boundingBox();
    await page.mouse.click(other.x + other.width / 2, other.y + other.height / 2);
    await page.locator('[data-block-id="card#0.60"] [data-block-frame]').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-block-id="card#0.20"]')?.hasAttribute('data-block-compact'));

    /* its edge still trims it: a narrow clip wide enough to have edges, not selected, pulled in from its end */
    const target = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[data-timeline] [data-block-compact][data-block-id^="card#1."]')].find((b) => b.querySelector('[data-trim="end"]') && b.dataset.blockId !== 'card#1.0');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { index: Number(el.dataset.blockId.split('.').pop()), right: r.right, y: r.top + r.height / 2, width: r.width };
    });
    assert.ok(target, 'a narrow clip more than 6 px wide keeps its trim edges');
    const clipOf = async (index) => readFilmFile(await readFile(path, 'utf8')).value.tracks[1].clips.find((c) => c.id === `l${index}`);
    assert.deepEqual((await clipOf(target.index)).time, [0, 0.8]);
    await page.mouse.move(target.right - 1, target.y);
    await page.mouse.down();
    await page.mouse.move(target.right - 4, target.y, { steps: 4 });
    await page.mouse.up();
    let trimmed = null;
    for (let i = 0; i < 100 && !(trimmed?.time[1] < 0.75); i += 1) { await new Promise((r) => setTimeout(r, 50)); trimmed = await clipOf(target.index); }
    assert.ok(trimmed.time[1] < 0.75 && trimmed.time[1] > 0.1, `its end was pulled in: ${JSON.stringify(trimmed.time)}`);
    assert.equal(trimmed.time[0], 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
