import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';
import { sizeTargetBitrate } from './ui/src/lib/export-spec.ts';

test('a video export asks a bitrate or a file size in place of the quality, in each language', { timeout: 90_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-export-target-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS', 'TRASH_DIR'];
  const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Target');
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'assets', 'card.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#486b8e"/></svg>');
    /* twelve seconds and no sound: a file size is all the picture's */
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'card', src: 'assets/card.svg', time: [0, 12] }] }] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {}, editorDir: process.env.OPENFILM_TEST_EDITOR_DIR });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    for (const [locale, words] of /** @type {const} */ ([
      ['en-US', { dialog: 'Export', bitrate: 'Bitrate', size: 'File size', high: 'High', small: 'Too small for this length' }],
      ['zh-CN', { dialog: '导出', bitrate: '码率', size: '文件大小', high: '高', small: '这么长的片子装不下' }],
    ])) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale, reducedMotion: 'reduce' });
      page.setDefaultTimeout(8000);
      await page.addInitScript(() => { localStorage.setItem('openfilm.exportCenter.v1', JSON.stringify({ dest: 'video' })); });
      const queued = [];
      await page.route(`**/api/projects/${project.id}/exports`, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        queued.push(route.request().postDataJSON().jobs[0]);
        /* what is asked only: the encoding is exports.test.mjs's */
        await route.fulfill({ json: { exports: [] } });
      });
      await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
      await page.locator('[data-block-id]').first().waitFor({ state: 'visible' });
      const dialog = page.getByRole('dialog', { name: words.dialog, exact: true });
      const open = async () => { await page.getByRole('button', { name: words.dialog, exact: true }).click(); await dialog.waitFor({ state: 'visible' }); };
      const send = async () => { await dialog.getByRole('button', { name: words.dialog, exact: true }).click(); await dialog.waitFor({ state: 'detached' }); return queued.at(-1); };

      await open();
      /* a quality, as before */
      assert.equal(await dialog.getByRole('button', { name: words.high, exact: true }).getAttribute('aria-pressed'), 'true');
      let job = await send();
      assert.equal(job.quality, 'high');
      assert.equal(Object.hasOwn(job, 'bitrate'), false);

      await open();
      await dialog.getByRole('button', { name: words.bitrate, exact: true }).click();
      const rate = dialog.getByRole('textbox', { name: `${words.bitrate} (Mb/s)` });
      await rate.fill('2.5');
      job = await send();
      assert.deepEqual([job.bitrate, job.quality, job.maxrate], [2_500_000, undefined, undefined]);

      await open();
      assert.equal(await dialog.getByRole('button', { name: words.bitrate, exact: true }).getAttribute('aria-pressed'), 'true', 'kept for the next export');
      await dialog.getByRole('button', { name: words.size, exact: true }).click();
      const size = dialog.getByRole('textbox', { name: `${words.size} (MB)` });
      await size.fill('20');
      await dialog.getByText(/12\.6 Mb\/s/).waitFor();
      /* what the file stays under, in the words typed */
      await dialog.getByText('≤ 20 MB', { exact: true }).waitFor();
      job = await send();
      const bitrate = sizeTargetBitrate('h264', 20e6, 12_000, 0);
      assert.deepEqual([job.bitrate, job.maxrate, job.quality], [bitrate, bitrate, undefined]);

      /* a size the length cannot fit: said, and nothing to export */
      await open();
      await size.fill('0.1');
      await dialog.getByText(words.small).first().waitFor();
      assert.equal(await dialog.getByRole('button', { name: words.dialog, exact: true }).isDisabled(), true);
      await size.fill('20');

      /* ProRes has no quality, nor a target */
      await dialog.getByRole('button', { name: /ProRes 422/ }).first().click();
      assert.equal(await dialog.getByRole('button', { name: words.size, exact: true }).count(), 0);
      job = await send();
      assert.equal(job.codec, 'prores422hq');
      assert.equal(Object.hasOwn(job, 'bitrate'), false);
      await page.close();
    }
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
