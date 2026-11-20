import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml, readFilmFile } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

const card = (words) => `<!doctype html><body style="margin:0;background:#123">
  <h1 style="position:absolute;left:80px;top:200px;margin:0;font:700 90px sans-serif;color:#fff">${words}</h1>
<script>window.film={duration:4,frame(){}}</script></body>`;
const film = (src) => filmHtml({ stage: { w: 1920, h: 1080 }, tracks: [{ clips: [{ id: 'card', src, time: [0, 4] }] }] });

/** Studio on a throwaway home and library, a project in it, and a page on that project. */
async function open(t, name, setup) {
  const scratch = await mkdtemp(join(tmpdir(), 'of-film-missing-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS', 'TRASH_DIR', 'SKILLS_INDEX'];
  const saved = new Map(names.map((n) => [`OPENFILM_${n}`, process.env[`OPENFILM_${n}`]]));
  for (const n of names) process.env[`OPENFILM_${n}`] = join(scratch, n.toLowerCase());
  await writeFile(process.env.OPENFILM_SKILLS_INDEX, '{"version":1,"skills":[]}');
  await mkdir(process.env.OPENFILM_TRASH_DIR, { recursive: true });
  const root = join(process.env.OPENFILM_LIBRARY, name);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'card.html'), card('Before'));
  await writeFile(join(root, 'film.html'), film('card.html'));
  const project = await openProject(root);
  const studio = await startStudio({ port: 0, openBrowser: () => {}, editorDir: process.env.OPENFILM_TEST_EDITOR_DIR });
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
  t.after(async () => {
    await browser.close();
    await studio.close();
    for (const [n, v] of saved) { if (v === undefined) delete process.env[n]; else process.env[n] = v; }
    /* Windows lets go of a folder a moment after Studio stops watching it */
    await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-US', reducedMotion: 'reduce' });
  const address = `/projects/${project.id}`;
  await setup?.({ root, page, address });
  await page.goto(`${studio.origin}${address}?key=${studio.key}`);
  await page.locator('[data-viewer-picture] iframe').first().waitFor({ state: 'attached' });
  const api = (path, init = {}) => fetch(`${studio.origin}/api/projects/${project.id}${path}`, {
    ...init, headers: { 'x-studio-key': studio.key, ...(init.body ? { 'content-type': 'application/json' } : {}) },
  });
  return { root, page, address, api };
}

const notice = (page) => page.locator('[data-film-missing]');
const shown = (page, src = 'card.html') => page.frameLocator('[data-viewer-picture] iframe[title="film"]:not([data-loading]):not([data-leaving])').frameLocator(`iframe[src*="/${src}"]`);
const invalidFilm = film('card.html').replace('card.html#', 'card.html?scene=01#');
const broken = (page) => page.locator('[data-film-broken]');

function watchFilmNotices(page) {
  return page.locator('[data-viewer-pane]').evaluate((viewer) => {
    const notices = '[data-film-broken], [data-film-missing], [data-film-updating], [data-preview-updating], [role="alert"]';
    window.flashedFilmNotice = Boolean(viewer.querySelector(notices));
    new MutationObserver(() => {
      if (viewer.querySelector(notices)) window.flashedFilmNotice = true;
    }).observe(viewer, { childList: true, subtree: true });
  });
}

function readInvalidFilm(page, address) {
  return page.waitForResponse(async (res) => {
    if (new URL(res.url()).pathname !== `/api${address}` || res.request().method() !== 'GET' || !res.ok()) return false;
    const result = await res.json();
    return !result.doc && result.text === invalidFilm;
  }, { timeout: 6000 });
}

test('a short invalid write silently keeps the last picture and timeline until a valid film arrives', { timeout: 30_000 }, async (t) => {
  const { root, page, address } = await open(t, 'Film still being written');
  const before = shown(page).getByRole('heading', { name: 'Before' });
  await before.waitFor();
  await watchFilmNotices(page);
  const draft = readInvalidFilm(page, address);
  await writeFile(join(root, 'film.html'), invalidFilm);
  await draft;
  /* A changed scene also rechecks the film while the edit is still invalid. */
  const previewRead = readInvalidFilm(page, address);
  await writeFile(join(root, 'card.html'), card('Page saved during update'));
  await previewRead;
  assert.ok(await before.isVisible());
  assert.ok(await page.locator('[data-block-title="card"]').isVisible());
  await writeFile(join(root, 'card2.html'), card('After'));
  await writeFile(join(root, 'film.html'), film('card2.html'));
  await shown(page, 'card2.html').getByRole('heading', { name: 'After' }).waitFor({ timeout: 6000 });
  assert.equal(await page.evaluate(() => window.flashedFilmNotice), false);
});

test('successful revisions appear during an agent turn and the drafts between them stay quiet', { timeout: 30_000 }, async (t) => {
  const { root, page, address } = await open(t, 'Agent draft', async ({ page, address }) => {
    await page.addInitScript((projectId) => {
      const tab = { id: 'self', projectId, title: 'Agent draft', working: true, active: true };
      const listeners = new Set();
      window.openfilmHost = { version: 1, tabs: {
        list: async () => ({ self: tab.id, tabs: [tab] }),
        onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
        onPick: () => () => {},
        report: () => {},
      } };
      window.finishFilmTurn = () => { tab.working = false; for (const listener of listeners) listener([tab]); };
    }, address.split('/').pop());
  });
  const before = shown(page).getByRole('heading', { name: 'Before' });
  await before.waitFor();
  await watchFilmNotices(page);
  await writeFile(join(root, 'card2.html'), card('First live revision'));
  await writeFile(join(root, 'card3.html'), card('Second live revision'));
  const draft = readInvalidFilm(page, address);
  await writeFile(join(root, 'film.html'), invalidFilm);
  await draft;
  await page.waitForTimeout(2300);
  assert.ok(await before.isVisible());
  await writeFile(join(root, 'film.html'), film('card2.html'));
  const first = shown(page, 'card2.html').getByRole('heading', { name: 'First live revision' });
  await first.waitFor({ timeout: 6000 });
  await page.locator('[data-block-title="card2"]').waitFor({ timeout: 5000 });

  const nextDraft = readInvalidFilm(page, address);
  await writeFile(join(root, 'film.html'), invalidFilm);
  await nextDraft;
  assert.ok(await first.isVisible());
  await writeFile(join(root, 'film.html'), film('card3.html'));
  const second = shown(page, 'card3.html').getByRole('heading', { name: 'Second live revision' });
  await second.waitFor({ timeout: 6000 });
  await page.locator('[data-block-title="card3"]').waitFor({ timeout: 5000 });

  const finalDraft = readInvalidFilm(page, address);
  await writeFile(join(root, 'film.html'), invalidFilm);
  await finalDraft;
  assert.equal(await page.evaluate(() => window.flashedFilmNotice), false);
  await page.evaluate(() => window.finishFilmTurn());
  await broken(page).waitFor({ timeout: 5000 });
  assert.ok(await second.isVisible());
  const diagnostic = broken(page).getByText('card.html?scene=01', { exact: false });
  assert.equal(await diagnostic.isVisible(), false);
  await broken(page).getByText('Details', { exact: true }).click();
  assert.ok(await diagnostic.isVisible());
  /* A new valid revision recovers even if it is byte-for-byte the last valid film. */
  await writeFile(join(root, 'film.html'), film('card3.html'));
  await broken(page).waitFor({ state: 'detached', timeout: 5000 });
  assert.ok(await second.isVisible());

  /* Opening a project mid-turn can have no last good frame or timeline at all. */
  await writeFile(join(root, 'film.html'), invalidFilm);
  const opening = readInvalidFilm(page, address);
  await page.reload();
  await opening;
  await watchFilmNotices(page);
  assert.equal(await page.getByText('card.html?scene=01', { exact: false }).count(), 0);
  await writeFile(join(root, 'film.html'), film('card.html'));
  await before.waitFor({ timeout: 6000 });
  assert.equal(await page.evaluate(() => window.flashedFilmNotice), false);
});

test('an outside write refreshes the open timeline and preview even when its first read fails', { timeout: 30_000 }, async (t) => {
  const { root, page, address } = await open(t, 'Live refresh');
  await shown(page).getByRole('heading', { name: 'Before' }).waitFor();
  const original = page.url();
  let reads = 0;
  await page.route((url) => url.pathname === `/api${address}`, (route) => {
    if (route.request().method() === 'GET' && ++reads === 1) return route.fulfill({ status: 503, json: { error: 'Still saving' } });
    return route.continue();
  });
  await writeFile(join(root, 'card2.html'), card('After'));
  const replacement = join(root, 'film.html.0123456789ab.tmp');
  await writeFile(replacement, film('card2.html'));
  await rename(replacement, join(root, 'film.html'));
  await page.locator('[data-block-title="card2"]').waitFor({ timeout: 6000 });
  await shown(page, 'card2.html').getByRole('heading', { name: 'After' }).waitFor({ timeout: 6000 });
  assert.ok(reads >= 2, 'a failed read is retried without another change or reopening');
  assert.equal(page.url(), original);
});

test('the timeline keeps its displayed revision until the new preview draws', { timeout: 30_000 }, async (t) => {
  const { root, page, api } = await open(t, 'Match the timeline and picture');
  const before = shown(page).getByRole('heading', { name: 'Before' });
  await before.waitFor();
  const { rev } = await (await api('')).json();
  const arrived = Promise.withResolvers();
  const release = Promise.withResolvers();
  const releaseSettings = Promise.withResolvers();
  const isExportApi = (url) => url.pathname.endsWith('/exports');
  await page.route((url) => isExportApi(url) && url.searchParams.get('view') === 'settings', async (route) => {
    await releaseSettings.promise;
    await route.continue().catch(() => {});
  });
  await page.route((url) => url.pathname.endsWith('/card2.html'), async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    arrived.resolve();
    await release.promise;
    await route.continue();
  });
  try {
    await writeFile(join(root, 'card2.html'), card('Ready together'));
    const waiting = page.waitForRequest((req) => req.resourceType() === 'document' && new URL(req.url()).pathname.endsWith('/card2.html'), { timeout: 6000 });
    await writeFile(join(root, 'film.html'), film('card2.html'));
    await waiting;
    await arrived.promise;
    assert.ok(await before.isVisible());
    assert.ok(await page.locator('[data-block-title="card"]').isVisible());
    assert.equal(await page.locator('[data-block-title="card2"]').count(), 0);
    const settings = page.waitForRequest((req) => isExportApi(new URL(req.url())) && new URL(req.url()).searchParams.get('view') === 'settings');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await settings;
    const queued = page.waitForResponse((res) => isExportApi(new URL(res.url())) && res.request().method() === 'POST');
    await page.getByRole('dialog', { name: 'Export' }).getByRole('button', { name: 'Export', exact: true }).click({ timeout: 6000 });
    const exportResponse = await queued;
    assert.equal(exportResponse.status(), 200, 'the displayed timeline can queue without waiting for settings or the next preview');
    assert.equal(exportResponse.request().postDataJSON().filmRev, rev);
  } finally { release.resolve(); releaseSettings.resolve(); }
  await shown(page, 'card2.html').getByRole('heading', { name: 'Ready together' }).waitFor({ timeout: 6000 });
  assert.ok(await page.locator('[data-block-title="card2"]').isVisible());
  assert.equal(await page.locator('[data-block-title="card"]').count(), 0);
});

test('the export tray shows muxing and elapsed time instead of a stalled percentage', { timeout: 30_000 }, async (t) => {
  const { page } = await open(t, 'Export muxing status', async ({ page, address }) => {
    await page.route((url) => url.pathname === `/api${address}/exports` && url.searchParams.get('view') === 'queue', (route) => {
      const now = Date.now();
      return route.fulfill({ json: { exports: [{ id: 'movie', project: address.split('/').at(-1), kind: 'video', label: 'H.264',
        status: 'running', phase: 'muxing', phaseAt: now - 7000, phaseProgress: null, progress: 0.99, at: now - 8000, encoder: 'h264_videotoolbox' }] } });
    });
  });
  const trigger = page.locator('[data-export-queue-trigger]');
  await trigger.getByText('Muxing media').waitFor();
  await trigger.click();
  const tray = page.locator('[data-export-queue]');
  assert.equal(await tray.getByRole('progressbar', { name: 'Muxing media' }).getAttribute('aria-valuenow'), null);
  assert.equal(await tray.getByText('99%').count(), 0);
  const elapsed = tray.getByText(/\d+:\d\d in this step/);
  const before = await elapsed.textContent();
  await page.waitForFunction((before) => [...document.querySelectorAll('[data-export-queue] span')]
    .some((node) => /\d+:\d\d in this step/.test(node.textContent) && node.textContent !== before), before);
});

test('a failed edit and a failed recovery read cannot stall later disk changes or edits', { timeout: 30_000 }, async (t) => {
  const { root, page, address } = await open(t, 'Recover a failed edit');
  await shown(page).getByRole('heading', { name: 'Before' }).waitFor();
  let failedEdit = false, failedRead = false;
  await page.route((url) => url.pathname === `/api${address}/edit`, (route) => {
    if (failedEdit) return route.continue();
    failedEdit = true;
    return route.fulfill({ status: 503, json: { error: 'Save temporarily unavailable' } });
  });
  await page.route((url) => url.pathname === `/api${address}`, (route) => {
    if (!failedEdit || failedRead) return route.continue();
    failedRead = true;
    return route.fulfill({ status: 503, json: { error: 'Read temporarily unavailable' } });
  });
  const recovery = page.waitForResponse((res) => new URL(res.url()).pathname === `/api${address}` && res.status() === 503);
  const block = page.locator('[data-block-id]').first();
  await block.click({ position: { x: 18, y: 10 } });
  await page.keyboard.press('Shift+E');
  await recovery;
  await page.locator('[data-block-disabled="1"]').waitFor({ state: 'detached', timeout: 4000 });
  await writeFile(join(root, 'card2.html'), card('After failed save'));
  await writeFile(join(root, 'film.html'), film('card2.html'));
  await shown(page, 'card2.html').getByRole('heading', { name: 'After failed save' }).waitFor({ timeout: 6000 });
  await block.click({ position: { x: 18, y: 10 } });
  const saved = page.waitForResponse((res) => new URL(res.url()).pathname === `/api${address}/edit` && res.ok());
  await page.keyboard.press('Shift+E');
  await saved;
  const { doc } = readFilmFile(await readFile(join(root, 'film.html'), 'utf8'));
  assert.equal(doc.tracks[0].clips[0].disabled, true);
  assert.equal(doc.tracks[0].clips[0].src, 'card2.html');
});

test('a write between the first project read and the event subscription is picked up without reopening', { timeout: 30_000 }, async (t) => {
  const { page } = await open(t, 'Opening race', async ({ root, page, address }) => {
    await writeFile(join(root, 'card2.html'), card('Changed while opening'));
    await page.routeWebSocket((url) => url.pathname === `/api${address}/events`, async (ws) => {
      await page.locator('[data-block-title="card"]').waitFor({ timeout: 5000 });
      await writeFile(join(root, 'film.html'), film('card2.html'));
      ws.connectToServer();
    });
  });
  await page.locator('[data-block-title="card2"]').waitFor({ timeout: 6000 });
  await shown(page, 'card2.html').getByRole('heading', { name: 'Changed while opening' }).waitFor({ timeout: 6000 });
});

test('an older refresh response cannot undo a newer edit in the open timeline', { timeout: 30_000 }, async (t) => {
  const { root, page, address } = await open(t, 'Keep latest edit');
  await shown(page).getByRole('heading', { name: 'Before' }).waitFor();
  await writeFile(join(root, 'card2.html'), card('Extra'));
  const captured = Promise.withResolvers();
  const release = Promise.withResolvers();
  let held = false;
  await page.route((url) => url.pathname === `/api${address}`, async (route) => {
    if (held || route.request().method() !== 'GET') return route.continue();
    held = true;
    const response = await route.fetch();
    captured.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  try {
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 1920, h: 1080 }, tracks: [{ clips: [
      { id: 'card', src: 'card.html', time: [0, 4] }, { id: 'extra', src: 'card2.html', at: 4, time: [0, 4] },
    ] }] }));
    await captured.promise;
    const first = page.locator('[data-block-id^="card#"]');
    await first.click({ position: { x: 18, y: 10 } });
    const saved = page.waitForResponse((res) => new URL(res.url()).pathname === `/api${address}/edit` && res.ok());
    await page.keyboard.press('Shift+E');
    await saved;
    const extra = page.locator('[data-block-title="card2"]');
    await extra.waitFor({ timeout: 5000 });
    const older = page.waitForResponse((res) => new URL(res.url()).pathname === `/api${address}` && res.request().method() === 'GET');
    release.resolve();
    await older;
    await page.waitForTimeout(350);
    assert.equal(await first.getAttribute('data-block-disabled'), '1');
    assert.equal(await extra.count(), 1);
  } finally { release.resolve(); }
});

test('film.html deleted and written again 3 s later (an agent replacing it whole): the project stays open, says so, then goes on (#304)', { timeout: 90_000 }, async (t) => {
  const { root, page, address } = await open(t, 'Rewritten');
  await unlink(join(root, 'film.html'));
  await notice(page).waitFor({ state: 'visible', timeout: 5000 });
  assert.match(await notice(page).innerText(), /film\.html is missing — it may be being rewritten\. It comes back on its own/);
  await page.waitForTimeout(2500);
  assert.equal(new URL(page.url()).pathname, address, 'the project is still open');
  /* the agent's new film: the notice goes, and the picture shows it */
  await writeFile(join(root, 'card2.html'), card('After'));
  await writeFile(join(root, 'film.html'), film('card2.html'));
  await notice(page).waitFor({ state: 'detached', timeout: 5000 });
  await page.locator('[data-viewer-picture] iframe').first().waitFor({ state: 'attached' });
  assert.equal(new URL(page.url()).pathname, address);
  assert.equal(await page.getByText('film.html is empty').count(), 0, 'no empty film was shown');
  /* its whole folder gone: the page leaves it, as before (with tabs, its tab closes). Studio may still be drawing the
     new film into .film/cache as the folder goes: a folder that gains a file under the removal is removed again */
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  await page.waitForURL((url) => url.pathname !== address, { timeout: 10_000 });
});

test('film.html deleted for good: the notice stays, the history lists its versions, and restoring one brings back film.html alone (#304)', { timeout: 90_000 }, async (t) => {
  const { root, page, address, api } = await open(t, 'Lost');
  const saved = await api('/history/save', { method: 'POST', body: JSON.stringify({ message: 'Kept cut' }) });
  assert.equal(saved.status, 200);
  /* the agent's other work since that version, then film.html gone */
  await writeFile(join(root, 'card.html'), card('Changed by the agent'));
  await writeFile(join(root, 'notes.md'), 'the agent\'s notes');
  await unlink(join(root, 'film.html'));
  await notice(page).waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(3000);
  assert.ok(await notice(page).isVisible(), 'still said');
  assert.equal(new URL(page.url()).pathname, address, 'the project is still open');
  /* the history opens, with the version saved before */
  await page.getByRole('button', { name: 'Version history' }).first().click();
  await page.getByText('Kept cut', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Restore this version' }).click();
  /* only film.html comes back: it says so, and does so */
  await page.getByText('film.html is missing, so only film.html comes back').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Restore film.html' }).click();
  await page.getByText('film.html restored from this version.').waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal(existsSync(join(root, 'film.html')), true);
  assert.equal(await readFile(join(root, 'film.html'), 'utf8'), film('card.html'));
  assert.equal(await readFile(join(root, 'card.html'), 'utf8'), card('Changed by the agent'), 'the other changed file is untouched');
  assert.equal(await readFile(join(root, 'notes.md'), 'utf8'), 'the agent\'s notes', 'and the new one is still there');
  await notice(page).waitFor({ state: 'detached', timeout: 5000 });
  assert.equal(new URL(page.url()).pathname, address);
});
