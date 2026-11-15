import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml, readFilmFile } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test(
  'dropping multiple files onto the empty import card and occupied media pane imports each once',
  { timeout: 90000 },
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'of-media-drop-'));
    const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
    const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
    for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
    let studio, browser;
    try {
      const root = join(process.env.OPENFILM_LIBRARY, 'Drop test');
      await mkdir(join(root, 'assets'), { recursive: true });
      await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 640, h: 360 }, tracks: [] }));
      const project = await openProject(root);
      studio = await startStudio({ port: 0, openBrowser: () => {} });
      browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'en-US' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(() => {
        localStorage.setItem('openfilm.language', 'en');
        localStorage.setItem('openfilm.project.assets', '1');
      });
      await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
      const pane = page.locator('[data-media-dropzone]:visible').first();
      await pane.waitFor();
      const drop = async (names, itemsOnly = false) => {
        const data = await page.evaluateHandle((names) => {
          const d = new DataTransfer();
          for (const name of names)
            d.items.add(
              new File(
                [
                  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>',
                ],
                name,
                { type: 'image/svg+xml' },
              ),
            );
          return d;
        }, names);
        await pane.dispatchEvent('dragenter', { dataTransfer: data });
        await pane.dispatchEvent('dragover', { dataTransfer: data });
        await pane.locator('[data-media-drop-overlay]').waitFor();
        if (itemsOnly) await data.evaluate((data) => Object.defineProperty(data, 'files', { value: [] }));
        const card = pane.getByRole('button', { name: 'Import media', exact: true }).last();
        await ((await card.count()) ? card : pane).dispatchEvent('drop', { dataTransfer: data });
        await data.dispose();
        for (let i = 0; i < 100; i++) {
          const files = await readdir(join(root, 'assets'));
          if (names.every((name) => files.includes(name))) return;
          await page.waitForTimeout(100);
        }
        assert.fail(`files not imported: ${names}`);
      };
      await drop(['one.svg', 'two.svg']);
      await page.locator('[data-media-path="assets/one.svg"]').waitFor();
      await drop(['three.svg'], true);
      assert.deepEqual((await readdir(join(root, 'assets'))).filter((name) => name.endsWith('.svg')).sort(), [
        'one.svg',
        'three.svg',
        'two.svg',
      ]);
      const doc = readFilmFile(await readFile(join(root, 'film.html'), 'utf8')).doc;
      assert.equal(doc.tracks.flatMap((t) => t.clips).length, 0, 'dropping onto media does not also insert clips');
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await studio?.close();
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await rm(scratch, { recursive: true, force: true });
    }
  },
);
