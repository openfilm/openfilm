import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { listenLocal } from '../src/host.mjs';
import { startPages } from './server/pages.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

const card = (title) => `<!doctype html><body style="margin:0">
  <h1 id="title" style="position:absolute;left:80px;top:200px;margin:0;font:700 90px sans-serif;color:#fff">${title}</h1>
  <p id="sub" style="position:absolute;left:80px;top:400px;margin:0;font:60px sans-serif;color:#fff">Arrives on time</p>
<script>window.film={duration:6,frame(){}}</script></body>`;

test('a page clip edited, or written by an agent, keeps its thumbnails until the new ones are in', { timeout: 120_000, skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-timeline-thumbs-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Thumbs');
    await mkdir(join(root, 'assets'), { recursive: true });
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=540x960:rate=25:duration=6', '-pix_fmt', 'yuv420p', join(root, 'assets', 'clip.mp4')]);
    await writeFile(join(root, 'card.html'), card('Every parcel'));
    await writeFile(join(root, 'film.html'), filmHtml({
      stage: { w: 1080, h: 1920 },
      tracks: [{ clips: [{ id: 'card', src: 'card.html', time: [0, 6] }] }, { clips: [{ id: 'clip', src: 'assets/clip.mp4', time: [0, 6] }] }],
    }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-US', reducedMotion: 'reduce' });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const until = async (check, what, tries = 200) => {
      for (let i = 0; i < tries; i += 1) { if (await check()) return; await page.waitForTimeout(100); }
      assert.fail(what);
    };

    /* the page clip's row of pictures, all in */
    const clip = page.locator('[data-block-kind="mg"]');
    await clip.waitFor({ state: 'visible' });
    const drawn = () => clip.evaluate((el) => [...el.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth > 0).length);
    await until(async () => (await drawn()) >= 3, 'the page clip has its thumbnails');
    /* each version of the page drawn, by its address */
    const versions = () => clip.evaluate((el) => [...new Set([...el.querySelectorAll('img')].map((i) => new URL(i.src).searchParams.get('v')))]);
    const [first] = await versions();

    /* from now on a picture of the page takes a while to draw, as a big page's does: a gap would show */
    await page.route(/what=(frame|poster)/, async (route) => { await new Promise((go) => setTimeout(go, 300)); await route.continue(); });
    /* every frame of the screen: how many pictures the clip draws. A cell whose address changes goes on showing its
       picture until the new one has loaded (the browser keeps it), so a cell that has shown one counts */
    await page.evaluate(() => {
      window.thumbFrames = [];
      const showed = new WeakSet();
      const tick = () => {
        const el = document.querySelector('[data-block-kind="mg"]');
        const cells = el ? [...el.querySelectorAll('img')].filter((i) => i.style.visibility !== 'hidden') : [];
        for (const i of cells) if (i.complete && i.naturalWidth > 0) showed.add(i);
        window.thumbFrames.push(cells.filter((i) => showed.has(i)).length);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const gaps = () => page.evaluate(() => { const n = window.thumbFrames.filter((count) => count <= 0).length; window.thumbFrames = []; return n; });

    /* a layer moved in the picture: the clip's pictures are drawn again with the move; the old ones stay meanwhile */
    const film = await page.locator('[data-viewer-picture] iframe').first().boundingBox();
    const scale = film.width / 1080;
    await page.mouse.click(film.x + 200 * scale, film.y + 440 * scale);
    await page.waitForTimeout(400);
    await page.keyboard.press('Shift+ArrowRight');
    await until(async () => { const v = await versions(); return v.length === 1 && v[0] !== first; }, 'the moved layer\'s pictures take the old ones\' place', 300);
    assert.equal(await gaps(), 0, 'not one frame without a picture while the new ones were drawn');
    const [moved] = await versions();

    /* an agent writes the page: the same */
    await writeFile(join(root, 'card.html'), card('Every parcel, every day'));
    await until(async () => { const v = await versions(); return v.length === 1 && v[0] !== moved; }, 'the written page\'s pictures take the old ones\' place', 300);
    assert.equal(await gaps(), 0, 'not one frame without a picture while the agent\'s page was drawn');
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

test('a compound clip shows its mixed audio and opens from its menu or a double-click', { timeout: 90_000, skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-compound-timeline-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Compound test');
    const part = join(root, 'parts', 'travel');
    await mkdir(join(root, 'assets'), { recursive: true });
    await mkdir(part, { recursive: true });
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1.5', join(root, 'assets', 'music.wav')]);
    await writeFile(join(root, 'card.html'), card('Travel diary'));
    const stage = { w: 320, h: 180 };
    const inner = {
      stage,
      tracks: [
        { clips: [{ id: 'title', src: '../../card.html', time: [0, 4] }] },
        { clips: [{ id: 'music', src: '../../assets/music.wav', at: 1, time: [0, 1.5] }] },
      ],
    };
    await writeFile(join(part, 'film.html'), filmHtml(inner));
    await writeFile(join(root, 'film.html'), filmHtml({
      stage,
      tracks: [{ clips: [
        { id: 'travel', src: 'parts/travel/film.html', time: [0.5, 3.5] },
        { id: 'card', src: 'card.html', at: 3, time: [0, 2] },
      ] }],
    }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 }, locale: 'en-US', reducedMotion: 'reduce' });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);

    const compound = page.locator('[data-block-id]').filter({ has: page.locator('[data-clip-compound]') });
    await compound.getByRole('img', { name: 'Compound clip' }).waitFor();
    assert.match(await compound.getAttribute('title'), /Double-click to open/);
    const band = compound.locator('[data-audio-band="on"]');
    const wave = band.locator('canvas');
    await wave.waitFor();
    assert.equal(await page.locator('[data-block-id][data-block-title="card"] [data-audio-band]').count(), 0);
    const response = await page.request.get(`${studio.origin}/api/projects/${project.id}/media?what=wave&path=parts%2Ftravel%2Ffilm.html`);
    assert.equal(response.status(), 200);
    const envelope = await response.json();
    assert.equal(envelope.duration, 4);
    assert.ok(envelope.peaks.slice(0, 39).every((peak) => peak === 0), 'the source mix keeps the lead-in');
    assert.ok(envelope.peaks.slice(41, 98).some((peak) => peak > 0), 'the compound includes its background music');
    assert.ok(envelope.peaks.slice(101).every((peak) => peak === 0), 'the source mix keeps the tail');

    const back = page.locator('[data-compound-back]');
    await compound.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open compound clip' }).click();
    await back.waitFor();
    await page.locator('[data-block-title="music.wav"]').waitFor();
    await back.click();
    await compound.waitFor();
    await compound.dblclick();
    await back.waitFor();
  } finally {
    await browser?.close(); await studio?.close();
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('a paused preview redraws a page when its pictures finish loading', { timeout: 45_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-late-preview-image-'));
  let editor, pages, browser, release;
  const holdImage = new Promise(resolve => { release = resolve; });
  try {
    await writeFile(join(scratch, 'cards.html'), `<!doctype html><body>
      <canvas id="cards" width="320" height="180"></canvas>
      <img id="photo" hidden>
      <script>
        const ctx = cards.getContext('2d');
        window.film = { duration: 3, width: 320, height: 180, frame(time) {
          ctx.clearRect(0, 0, 320, 180);
          if (photo.complete && photo.naturalWidth) ctx.drawImage(photo, 0, 0);
          cards.dataset.painted = String(ctx.getImageData(10, 10, 1, 1).data[0]);
          cards.dataset.time = String(time);
        } };
      </script>`);
    await writeFile(join(scratch, 'film.html'), filmHtml({
      stage: { w: 320, h: 180 },
      tracks: [{ clips: [{ id: 'cards', src: 'cards.html', time: [0, 3] }] }],
    }));
    const project = { id: 'late-picture', path: scratch };
    // Use the production preview bridge and one paused seek, without the editor's background preview swaps.
    editor = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html>
      <script>
        window.addEventListener('message', event => {
          if (event.origin !== ${JSON.stringify(preview.origin)} || event.data?.source !== 'openfilm-film') return;
          if (event.data.type === 'ready') event.source.postMessage({ source: 'openfilm-studio', type: 'seek', t: 1, seq: 1 }, event.origin);
        });
      </script>
      <iframe title="film" src="${preview.href}" width="320" height="180"></iframe>`));
    await listenLocal(editor);
    const editorOrigin = `http://127.0.0.1:${editor.address().port}`;
    pages = await startPages({ port: 0, editorOrigin: () => editorOrigin, secret: 'test', projects: async () => [project] });
    const preview = new URL('film.html?film-missing=skip', pages.folderUrl(project));
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.route('**/cards.svg', async route => {
      await holdImage;
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="red"/></svg>' }).catch(() => {});
    });
    await page.goto(editorOrigin);
    const frame = page.frameLocator('iframe[title="film"]').frameLocator('iframe');
    await frame.locator('#cards[data-painted="0"][data-time="1"]').waitFor();
    // Start the image request after the initial paint, so it cannot hold the document's own load event.
    const image = page.waitForRequest('**/cards.svg');
    await frame.locator('#photo').evaluate(element => { element.src = 'cards.svg'; });
    await image;
    release();
    await frame.locator('#cards[data-painted="255"][data-time="1"]').waitFor({ timeout: 6000 });
  } finally {
    release();
    await browser?.close(); await pages?.close();
    editor?.closeAllConnections();
    if (editor?.listening) await new Promise(resolve => editor.close(resolve));
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
