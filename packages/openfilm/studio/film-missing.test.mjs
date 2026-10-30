import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

const card = (words) => `<!doctype html><body style="margin:0;background:#123">
  <h1 style="position:absolute;left:80px;top:200px;margin:0;font:700 90px sans-serif;color:#fff">${words}</h1>
<script>window.film={duration:4,frame(){}}</script></body>`;
const film = (src) => filmHtml({ stage: { w: 1920, h: 1080 }, tracks: [{ clips: [{ id: 'card', src, time: [0, 4] }] }] });

/** Studio on a throwaway home and library, a project in it, and a page on that project. */
async function open(t, name) {
  const scratch = await mkdtemp(join(tmpdir(), 'of-film-missing-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS', 'TRASH_DIR'];
  const saved = new Map(names.map((n) => [`OPENFILM_${n}`, process.env[`OPENFILM_${n}`]]));
  for (const n of names) process.env[`OPENFILM_${n}`] = join(scratch, n.toLowerCase());
  await mkdir(process.env.OPENFILM_TRASH_DIR, { recursive: true });
  const root = join(process.env.OPENFILM_LIBRARY, name);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'card.html'), card('Before'));
  await writeFile(join(root, 'film.html'), film('card.html'));
  const project = await openProject(root);
  const studio = await startStudio({ port: 0, openBrowser: () => {} });
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
  t.after(async () => {
    await browser.close();
    await studio.close();
    for (const [n, v] of saved) { if (v === undefined) delete process.env[n]; else process.env[n] = v; }
    await rm(scratch, { recursive: true, force: true });
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-US', reducedMotion: 'reduce' });
  const address = `/projects/${project.id}`;
  await page.goto(`${studio.origin}${address}?key=${studio.key}`);
  await page.locator('[data-viewer-picture] iframe').first().waitFor({ state: 'attached' });
  const api = (path, init = {}) => fetch(`${studio.origin}/api/projects/${project.id}${path}`, {
    ...init, headers: { 'x-studio-key': studio.key, ...(init.body ? { 'content-type': 'application/json' } : {}) },
  });
  return { root, page, address, api };
}

const notice = (page) => page.locator('[data-film-missing]');

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
  /* its whole folder gone: the page leaves it, as before (with tabs, its tab closes) */
  await rm(root, { recursive: true, force: true });
  await page.waitForURL((url) => url.pathname !== address, { timeout: 10_000 });
});

test('film.html deleted for good: the notice stays, the history lists its versions, and restoring one brings film.html back (#304)', { timeout: 90_000 }, async (t) => {
  const { root, page, address, api } = await open(t, 'Lost');
  const saved = await api('/history/save', { method: 'POST', body: JSON.stringify({ message: 'Kept cut' }) });
  assert.equal(saved.status, 200);
  await unlink(join(root, 'film.html'));
  await notice(page).waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(3000);
  assert.ok(await notice(page).isVisible(), 'still said');
  assert.equal(new URL(page.url()).pathname, address, 'the project is still open');
  /* the history opens, with the version saved before */
  await page.getByRole('button', { name: 'Version history' }).first().click();
  await page.getByText('Kept cut', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Restore this version' }).click();
  /* nothing to save first: it says so, and restores */
  await page.getByText('film.html is missing, so there is nothing to save first.').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Restore this version' }).last().click();
  await page.getByText('Version restored.').waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal(existsSync(join(root, 'film.html')), true);
  assert.equal(await readFile(join(root, 'film.html'), 'utf8'), film('card.html'));
  await notice(page).waitFor({ state: 'detached', timeout: 5000 });
  assert.equal(new URL(page.url()).pathname, address);
});
