import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml, readFilmFile } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

const at = (left, top, width, height, more) => `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;margin:0;${more}`;
/* a 9:16 page of words and boxes, each named by its id */
const CARD = `<!doctype html><body style="margin:0;background:#222">
  <h1 id="title" style="${at(100, 200, 400, 80, 'font:700 64px sans-serif;color:#fff')}">Parcel</h1>
  <p id="sub" style="${at(100, 400, 400, 50, 'font:40px sans-serif;color:#fff')}">On time</p>
  <div id="box1" style="${at(100, 600, 300, 200, 'background:#e33')}"></div>
  <div id="box2" style="${at(600, 600, 300, 200, 'background:#33e')}"></div>
  <div id="box3" style="${at(100, 1200, 400, 300, 'background:#3a3')}"></div>
<script>window.film={duration:4,frame(){}}</script></body>`;

/** Studio on a project of one page clip (CARD, 1080 × 1920), the Layers panel open; `run` gets the page and helpers. */
async function withCard(name, run) {
  const scratch = await mkdtemp(join(tmpdir(), 'of-layer-selection-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((n) => [`OPENFILM_${n}`, process.env[`OPENFILM_${n}`]]));
  for (const n of names) process.env[`OPENFILM_${n}`] = join(scratch, n.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, name);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'card.html'), CARD);
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 1080, h: 1920 }, tracks: [{ clips: [{ id: 'card', src: 'card.html', time: [0, 4] }] }] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, locale: 'en-US', reducedMotion: 'reduce' });
    await page.addInitScript(() => localStorage.setItem('openfilm.project.layers', '1'));
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const film = page.locator('[data-viewer-picture] iframe').first();
    await film.waitFor({ state: 'visible' });
    await page.locator('[data-layers-panel] [role="treeitem"]').filter({ hasText: 'On time' }).waitFor({ state: 'visible' });
    const box = await film.boundingBox();
    const scale = box.width / 1080;
    /** A point of the film (its px) on the screen. */
    const on = (x, y) => ({ x: box.x + x * scale, y: box.y + y * scale });
    const until = async (check, what) => {
      for (let i = 0; i < 60; i += 1) { if (await check()) return; await page.waitForTimeout(100); }
      assert.fail(what);
    };
    /** What is selected on the picture: how many layers together (null: not several), the Layers rows selected, and
        the blue boxes drawn over the picture (their left tops, film px). */
    const selection = () => page.evaluate(({ x, y, scale: k }) => {
      const many = /(\d+) layers selected/.exec(document.querySelector('[data-film-inspector]')?.textContent ?? '');
      const boxes = [...document.querySelectorAll('[data-film-select] div')].filter((d) => /solid/.test(d.style.border));
      return {
        many: many ? Number(many[1]) : null,
        rows: [...document.querySelectorAll('[data-layers-panel] [role="treeitem"][aria-selected="true"]')].map((r) => r.textContent),
        boxes: boxes.map((d) => { const r = d.getBoundingClientRect(); return [Math.round((r.left - x) / k), Math.round((r.top - y) / k)]; }),
      };
    }, { x: box.x, y: box.y, scale });
    /** The pointer off the picture (no outline under it), on the timeline's empty end. */
    const away = async () => {
      const timeline = await page.locator('[data-timeline]').boundingBox();
      await page.mouse.move(timeline.x + timeline.width - 30, timeline.y + timeline.height - 10);
    };
    const drag = async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i += 1) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
      await page.mouse.up();
    };
    const pageText = () => readFile(join(root, 'card.html'), 'utf8');
    const overrides = async () => {
      const { doc } = readFilmFile(await readFile(join(root, 'film.html'), 'utf8'));
      return doc.tracks[0].clips[0].overrides ?? [];
    };
    await run({ page, on, until, selection, away, drag, pageText, overrides });
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [n, value] of saved) {
      if (value === undefined) delete process.env[n];
      else process.env[n] = value;
    }
    await rm(scratch, { recursive: true, force: true });
  }
}

test('layers boxed, copied and pasted: every copy is selected, and one drag moves them all', { timeout: 120_000 }, async () => {
  await withCard('Paste', async ({ page, on, until, selection, away, drag, pageText, overrides }) => {
    /* a box around the title, the line under it and the red box */
    await drag(on(40, 150), on(560, 860));
    await until(async () => (await selection()).many === 3, 'the box selects the three');
    await page.keyboard.press('ControlOrMeta+c');
    await page.waitForTimeout(200);
    await page.keyboard.press('ControlOrMeta+v');
    await until(async () => (await pageText()).includes('id="box1-copy"'), 'the copies are written into the page');
    await away();
    /* the copies, 24 px lower and to the right: their boxes, the title's first */
    await until(async () => {
      const now = await selection();
      return now.many === 3 && now.boxes.some(([x, y]) => x === 124 && y === 224) && !now.boxes.some(([x, y]) => x === 100 && y === 200);
    }, 'the three copies are selected together');
    /* one drag from inside the title's copy (24 px lower and to the right of it) moves all three alike */
    await drag(on(300, 250), on(300, 400));
    await until(async () => (await overrides()).length === 3, 'the drag is written for all three');
    const moved = await overrides();
    assert.deepEqual(moved.map((o) => o.at).sort(), ['#box1-copy', '#sub-copy', '#title-copy']);
    for (const o of moved) assert.deepEqual(o.t, moved[0].t);
    assert.ok(moved[0].t[1] > 100, 'moved down');
  });
});
