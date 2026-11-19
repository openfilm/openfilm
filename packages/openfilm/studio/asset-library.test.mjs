import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

test('the library drawer: the media are folders, the project and the person’s own in one list; other categories fold their groups; deletes go to the recycle bin', { timeout: (process.env.OPENFILM_BROWSER_TIMEOUT_MS ? 180_000 : 90_000) }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-library-folders-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const before = new Map([...names, 'TRASH_DIR'].map(name => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  /* deletes go to OpenFilm's own recycle bin, in the shared home above */
  delete process.env.OPENFILM_TRASH_DIR;
  let studio, browser;
  try {
    await mkdir(process.env.OPENFILM_SAVED, { recursive: true });
    const svg = (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="${color}"/></svg>`;
    await writeFile(join(process.env.OPENFILM_SAVED, 'Brand.svg'), svg('#cc7755'));
    await mkdir(join(process.env.OPENFILM_SAVED, 'Sounds'));
    await writeFile(join(process.env.OPENFILM_SAVED, 'Sounds', 'tick.wav'), Buffer.alloc(64));
    await writeFile(join(process.env.OPENFILM_SAVED, 'Sounds', 'cover.svg'), svg('#245954'));
    const root = join(process.env.OPENFILM_LIBRARY, 'Spring campaign');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 1280, h: 720 }, tracks: [] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'en-US', reducedMotion: 'reduce' });
    page.setDefaultTimeout(Number(process.env.OPENFILM_BROWSER_TIMEOUT_MS) || 8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      if (!localStorage.getItem('openfilm.language')) localStorage.setItem('openfilm.language', 'en');
      localStorage.setItem('openfilm.project.assets', '1');
    });
    await page.route('**/api/providers', route => route.fulfill({ json: {
      providers: [{ id: 'fixture', name: 'Fixture', source: 'file', verbs: ['image'],
        models: { image: [{ id: 'fast', name: 'Fast' }, { id: 'quality', name: 'Quality' }] } }],
      model: { image: 'fast' }, use: { image: 'fixture' }, custom: [],
    } }));
    await page.route('**/api/examples', route => route.fulfill({ json: { examples: [] } }));
    await page.route('**/api/library/added', route => route.fulfill({ json: { ids: ['fixture/city', 'fixture/parks'] } }));
    await page.route('**/api/library', async (route) => {
      const response = await route.fetch();
      const index = await response.json();
      const packs = [{ id: 'fixture/city', name: { en: 'City' }, by: 'fixture' }, { id: 'fixture/parks', name: { en: 'Parks' }, by: 'fixture' }];
      index.groups.sticker.push(...packs);
      index.items.push(...packs.map((pack) => ({ id: `test/${pack.id}`, group: pack.id, cat: 'sticker', kind: 'page', by: pack.by, name: pack.name })));
      await route.fulfill({ response, json: index });
    });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    const drawer = page.locator('[data-studio-library]');
    const line = key => drawer.locator(`[data-rail-line="${key}"]`);
    const lines = () => drawer.locator('[data-rail-line]').evaluateAll(rows => rows.map(r => r.getAttribute('data-rail-line')));
    const LIB = 'Asset library';

    /* the first time: what lay loose at the library's top moves into its first folder; the folders are lines */
    await line(`saved/${LIB}`).waitFor();
    assert.deepEqual(await lines(), ['project', `saved/${LIB}`, 'saved/Sounds']);
    assert.ok(await readFile(join(process.env.OPENFILM_SAVED, LIB, 'Brand.svg'), 'utf8'));
    await line('saved/Sounds').click();
    await drawer.locator('[data-media-path="saved/Sounds/cover.svg"]').waitFor();

    const generation = drawer.getByRole('button', { name: 'AI generation', exact: true });
    assert.equal(await generation.count(), 0, 'generation is hidden from the media library even with a model connected');
    for (const name of ['Voices', 'Captions', 'Music', 'Transitions']) {
      const category = drawer.getByRole('button', { name, exact: true });
      await category.click();
      assert.equal(await category.getAttribute('aria-pressed'), 'true');
      assert.equal(await generation.count(), 0, `generation is hidden from ${name}`);
    }
    await drawer.getByRole('button', { name: 'Media', exact: true }).click();

    /* the media's side bar is the folders; folders and packs keep one order the person drags */
    await line('saved/Sounds').dragTo(line(`saved/${LIB}`));
    for (let i = 0; i < 50 && (await lines()).indexOf('saved/Sounds') > (await lines()).indexOf(`saved/${LIB}`); i++) await page.waitForTimeout(100);
    assert.ok((await lines()).indexOf('saved/Sounds') < (await lines()).indexOf(`saved/${LIB}`), 'the folder moved up');
    const kept = JSON.parse(await readFile(join(process.env.OPENFILM_SAVED, '.openfilm-shelf.json'), 'utf8'));
    assert.ok(kept.shelf.indexOf('saved/Sounds') < kept.shelf.indexOf(`saved/${LIB}`), 'the order is kept in the library folder');

    /* any other category's side bar is namespaces: OpenFilm's opens to its packs; no folders */
    await drawer.getByRole('button', { name: 'Music', exact: true }).click();
    const section = drawer.locator('[data-rail-section="openfilm"] > button[aria-expanded]');
    await section.waitFor();
    assert.equal(await line('saved/Sounds').count(), 0, 'no folders outside the media');
    assert.equal(await line('project').count(), 0, 'no project line outside the media');
    const packs = await drawer.locator('[data-rail-kind="pack"]').evaluateAll(rows => rows.map(r => r.getAttribute('data-rail-line')));
    assert.ok(packs.length > 0, 'the music category has packs');
    /* the arrow folds a section, and clicking its heading opens and selects its first child */
    await section.locator('[data-rail-fold]').click();
    await line(packs[0]).waitFor({ state: 'detached' });
    await section.click();
    await drawer.locator(`[data-rail-line="${packs[0]}"][aria-pressed="true"]`).waitFor();
    await section.locator('[data-rail-fold]').click();
    await line(packs[0]).waitFor({ state: 'detached' });
    await section.locator('[data-rail-fold]').click();
    await line(packs[0]).waitFor();
    await drawer.getByRole('button', { name: 'Stickers', exact: true }).click();
    const community = drawer.locator('[data-rail-section="community"]');
    await community.getByRole('button', { name: 'Community', exact: true }).click();
    await community.getByRole('button', { name: 'City', exact: true, pressed: true }).waitFor();
    await community.getByRole('button', { name: 'Parks', exact: true }).click();
    await community.locator('[data-rail-fold]').click();
    await community.getByRole('button', { name: 'Community', exact: true }).click();
    await community.getByRole('button', { name: 'City', exact: true, pressed: true }).waitFor();
    await drawer.getByRole('button', { name: 'Music', exact: true }).click();
    /* a pack taken out of the library, then put back from "+ Add" */
    await line(packs[0]).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Remove from the library', exact: true }).click();
    await line(packs[0]).waitFor({ state: 'detached' });
    await drawer.locator('[data-rail-add]').click();
    assert.equal(await page.getByRole('menuitem', { name: 'Get from the Community', exact: true }).count(), 1, 'more from the Community, one of "+ Add"');
    await page.getByRole('menuitem', { name: 'Removed packs', exact: true }).hover();
    await page.getByRole('menuitem').filter({ hasText: /./ }).last().click();
    await line(packs[0]).waitFor();

    /* "+": a new folder, named in place */
    await drawer.getByRole('button', { name: 'Media', exact: true }).click();
    await drawer.locator('[data-rail-add]').click();
    await page.getByRole('menuitem', { name: 'New folder', exact: true }).click();
    await drawer.getByRole('textbox', { name: 'Rename', exact: true }).fill('Logos');
    await page.keyboard.press('Enter');
    await line('saved/Logos').waitFor();
    /* a file of a folder dropped on another folder's line moves there */
    await line(`saved/${LIB}`).click();
    await drawer.locator(`[data-media-path="saved/${LIB}/Brand.svg"]`).dragTo(line('saved/Logos'));
    await line('saved/Logos').click();
    await drawer.locator('[data-media-path="saved/Logos/Brand.svg"]').waitFor();

    /* a folder deleted goes to OpenFilm's recycle bin, and comes back from it */
    await line('saved/Logos').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await line('saved/Logos').waitFor({ state: 'detached' });
    assert.equal((await readdir(join(process.env.OPENFILM_SHARED_HOME, 'recycle'))).length, 1);
    await page.getByRole('button', { name: 'Switch project', exact: true }).click();
    await page.getByRole('button', { name: /All projects/ }).click();
    await page.locator('[data-open-recycle-bin]').click();
    const bin = page.locator('[data-recycle-bin]');
    await bin.locator('[data-recycled="Logos"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Restore', exact: true }).click();
    await bin.getByText('The Recycle Bin is empty', { exact: true }).waitFor();
    assert.ok(await readFile(join(process.env.OPENFILM_SAVED, 'Logos', 'Brand.svg'), 'utf8'), 'restored where it was');
    await bin.getByRole('button', { name: 'Back', exact: true }).click();
    await page.locator('[data-open-recycle-bin]').waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [key, value] of before) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
