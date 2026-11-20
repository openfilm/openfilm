/** Exercise the project manager against a real Studio with an isolated library. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

const screenshotDir = process.env.OPENFILM_PROJECT_SCREENSHOTS;

test(
  'project browser selects directly, navigates folders, and moves and deletes mixed selections',
  { timeout: (process.env.OPENFILM_BROWSER_TIMEOUT_MS ? 180_000 : 90_000) },
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'of-project-browser-'));
    const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS', 'TRASH_DIR'];
    const saved = new Map(names.map((name) => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
    for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
    let studio, browser;
    try {
      await mkdir(process.env.OPENFILM_TRASH_DIR, { recursive: true });
      const projects = [];
      for (const name of [
        'Alpine launch',
        'Brand story',
        'Coastal journal',
        'Design in motion',
        'Evening light',
        'Field notes',
      ]) {
        const root = join(process.env.OPENFILM_LIBRARY, name);
        await mkdir(root, { recursive: true });
        await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 1280, h: 720 }, tracks: [] }));
        projects.push(await openProject(root));
      }
      studio = await startStudio({ port: 0, openBrowser: () => {}, editorDir: process.env.OPENFILM_TEST_EDITOR_DIR });
      const api = async (path, method = 'GET', body) => {
        const response = await fetch(`${studio.origin}/api/${path}`, {
          method,
          headers: { 'x-studio-key': studio.key, ...(body ? { 'content-type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        assert.ok(response.ok, `${method} ${path}: ${response.status}`);
        return response.json();
      };
      const { folder: clients } = await api('projects/folders', 'POST', { name: 'Clients' });
      const { folder: archive } = await api('projects/folders', 'POST', { name: 'Archive' });
      const { folder: nested } = await api('projects/folders', 'POST', { name: 'Campaigns', parentId: clients.id });
      await api(`projects/${projects[5].id}/folder`, 'PUT', { folderId: nested.id });
      browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 960 },
        locale: 'en-US',
        reducedMotion: 'reduce',
      });
      page.setDefaultTimeout(Number(process.env.OPENFILM_BROWSER_TIMEOUT_MS) || 8000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => {
        if (!localStorage.getItem('openfilm.language')) localStorage.setItem('openfilm.language', 'en');
        window.openedProjects = [];
        window.openfilmHost = {
          version: 1,
          settings: { onOpen: (listener) => { window.openAccountSettings = listener; return () => {}; } },
          tabs: {
            list: async () => ({ self: null, tabs: [] }),
            onChange: () => () => {},
            onPick: () => () => {},
            report: () => {},
            open: (id) => window.openedProjects.push(id),
            openRequest: () => {},
            show: () => {},
            close: () => {},
            move: () => {},
          },
        };
      });
      if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
      page.on('console', (message) => {
        if (message.type() === 'error' && !message.text().includes('404')) console.error(message.text());
      });
      // Keep poster rendering out of these input tests.
      await page.route('**/api/projects/*/poster*', (route) => route.fulfill({ status: 404, body: '' }));
      const services = Promise.withResolvers();
      const identity = { source: 'file', env: 'OPENFILM_API_KEY', account: 'editor@example.com', keysUrl: 'https://openfilm.dev/account' };
      const signingIn = { provider: null, error: null, errorFor: null };
      await page.route((url) => url.pathname === '/api/providers/openfilm/account', (route) => route.fulfill({ json: { account: identity, signingIn } }));
      await page.route((url) => url.pathname === '/api/providers', async (route) => {
        await services.promise;
        await route.fulfill({ json: { providers: [{ id: 'openfilm', name: 'OpenFilm', ...identity, profile: { name: 'Studio editor', avatar: null } }], signingIn } });
      });
      await page.goto(`${studio.origin}/?key=${studio.key}`);
      const dialog = page.getByRole('dialog', { name: /^(Resource center|资源中心)$/ });
      try {
        await dialog.locator('[data-projects-account="signed-in"]').getByText(identity.account).waitFor();
        await page.evaluate(() => window.openAccountSettings());
        const account = page.getByRole('heading', { name: 'Account', exact: true }).locator('..');
        await account.getByText(identity.account).waitFor();
        services.resolve();
        await account.getByText('Studio editor', { exact: true }).waitFor();
        await page.getByRole('dialog', { name: 'General', exact: true }).getByRole('button', { name: 'Done', exact: true }).click();
      } finally { services.resolve(); }
      const item = (name) => dialog.getByRole('option', { name, exact: true });
      const chooseView = async (label, mode) => {
        await dialog.getByRole('button', { name: /^(View|查看)$/, exact: true }).click();
        await page.getByRole('menuitem', { name: label, exact: true }).click();
        await dialog.locator(`[data-resource-view="${mode}"]`).waitFor();
      };
      const selected = () => dialog.locator('[data-browser-item][aria-selected=true]');
      const surface = dialog.locator('[tabindex="0"][aria-label="Folder contents"]').first();
      await item('Alpine launch').waitFor();
      assert.equal(await dialog.getByRole('button', { name: 'Select', exact: true }).count(), 0);
      assert.equal(await dialog.locator('[data-start="new"]').count(), 1, 'new project is the first way to start, at the top');
      await item('Alpine launch').click();
      assert.equal(await selected().count(), 1);
      assert.deepEqual(await page.evaluate(() => window.openedProjects), [], 'a click selects without opening a tab');
      await item('Brand story').click({ modifiers: ['Meta'] });
      assert.equal(await selected().count(), 2);
      await page.keyboard.press('Escape');
      assert.equal(await selected().count(), 0, 'Escape clears selection first');
      assert.equal(await dialog.isVisible(), true);

      await chooseView('Details', 'list');
      await dialog.getByRole('button', { name: 'Name', exact: true }).click();
      assert.equal(await dialog.getByRole('option').first().getAttribute('aria-label'), 'Archive');
      await dialog.getByRole('button', { name: 'Name', exact: true }).click();
      assert.equal(
        await dialog.getByRole('option').first().getAttribute('aria-label'),
        'Clients',
        'clicking the column again reverses its sort',
      );
      await dialog.getByRole('button', { name: 'Name', exact: true }).click();
      await item('Alpine launch').click();
      await item('Design in motion').click({ modifiers: ['Shift'] });
      assert.equal(await selected().count(), 4, 'Shift selects the contiguous visible range');
      await page.keyboard.press('Control+a');
      assert.equal(await selected().count(), 7, 'select all includes folders and projects');
      await page.keyboard.press('Escape');
      await item('Brand story').click();
      await page.keyboard.press('F2');
      const rename = item('Brand story').getByRole('textbox');
      await rename.fill('Brand story final');
      await page.keyboard.press('Enter');
      await item('Brand story final').waitFor();
      assert.deepEqual(
        await page.evaluate(() => window.openedProjects),
        [],
        'committing a rename does not open the project',
      );
      await item('Brand story final').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Cut', exact: true }).waitFor();
      assert.equal(await page.getByRole('menuitem', { name: 'Select', exact: true }).count(), 0);
      await page.keyboard.press('Escape');
      await item('Brand story final').getByRole('button').focus();
      await page.keyboard.press('Space');
      await page.getByRole('menuitem', { name: 'Cut', exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.openedProjects), [], 'Space on the menu button opens its menu');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Shift+F10');
      await page.getByRole('menuitem', { name: 'Cut', exact: true }).waitFor();
      await page.keyboard.press('Escape');

      await item('Clients').dblclick();
      await item('Campaigns').waitFor();
      assert.equal(await item('Field notes').count(), 0, 'double click stops in the intended folder');
      await dialog.getByRole('button', { name: 'Back', exact: true }).click();
      await item('Clients').waitFor();
      await dialog.getByRole('button', { name: 'Forward', exact: true }).click();
      await item('Campaigns').dblclick();
      await item('Field notes').waitFor();
      /* one level up: the folder before it on the path */
      await dialog.getByRole('navigation', { name: 'Folder path', exact: true }).getByRole('button', { name: 'Clients', exact: true }).click();
      await item('Campaigns').waitFor();
      await dialog
        .getByRole('navigation', { name: 'Folder path', exact: true })
        .getByRole('button', { name: 'Projects', exact: true })
        .click();

      await item('Clients').click();
      await page.keyboard.press('Control+x');
      await item('Clients').dblclick();
      await item('Campaigns').dblclick();
      await page.keyboard.press('Control+v');
      assert.equal(
        (await api('projects/folders')).folders.find((f) => f.id === clients.id).parentId,
        undefined,
        'a folder cannot move into its own descendant',
      );
      await page.keyboard.press('Escape');
      await dialog
        .getByRole('navigation', { name: 'Folder path', exact: true })
        .getByRole('button', { name: 'Projects', exact: true })
        .click();

      // Cut survives folder navigation, and paste moves into the destination.
      await item('Brand story final').click();
      await page.keyboard.press('Control+x');
      await item('Archive').dblclick();
      await page.keyboard.press('Control+v');
      await item('Brand story final').waitFor();
      assert.equal((await api('projects')).projects.find((p) => p.id === projects[1].id).folderId, archive.id);
      await dialog
        .getByRole('navigation', { name: 'Folder path', exact: true })
        .getByRole('button', { name: 'Projects', exact: true })
        .click();

      // Real HTML drag/drop files a project into a folder, without opening it.
      await item('Alpine launch').dragTo(item('Clients'));
      await page.waitForFunction(
        (id) => !document.querySelector(`[data-browser-item="project:${id}"]`),
        projects[0].id,
      );
      assert.equal((await api('projects')).projects.find((p) => p.id === projects[0].id).folderId, clients.id);
      await dialog.getByRole('searchbox').fill('Field');
      await item('Field notes').waitFor();
      await dialog.getByRole('searchbox').fill('Campaign');
      await item('Campaigns').waitFor();
      await dialog.getByRole('searchbox').fill('');

      // Empty-space marquee selects intersecting rows, and clearing it keeps the window open.
      const first = await item('Archive').boundingBox();
      const third = await item('Coastal journal').boundingBox();
      const surfaceBox = await surface.boundingBox();
      await page.mouse.move(surfaceBox.x + 3, first.y + 2);
      await page.mouse.down();
      await page.mouse.move(third.x + third.width - 3, third.y + third.height - 2, { steps: 8 });
      await page.mouse.up();
      assert.ok((await selected().count()) >= 3, 'dragging empty space selects intersecting items');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+Shift+n');
      const newFolder = item('Untitled folder').getByRole('textbox');
      await newFolder.fill('Deliverables');
      await page.keyboard.press('Enter');
      await item('Deliverables').waitFor();

      await chooseView('Medium icons', 'medium');
      if (screenshotDir) {
        await mkdir(screenshotDir, { recursive: true });
        await page.screenshot({ path: join(screenshotDir, 'projects-grid.png') });
      }
      await page.mouse.move(10, 940);
      await chooseView('Details', 'list');
      if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'projects-list.png') });
      await page.reload();
      await item('Deliverables').waitFor();
      assert.equal(
        await dialog.locator('[data-resource-view]').getAttribute('data-resource-view'),
        'list',
        'view preference survives reopening',
      );

      if (screenshotDir) {
        await page.evaluate(() => localStorage.setItem('openfilm.language', 'zh-CN'));
        await page.reload();
        await item('Clients').waitFor();
        await page.mouse.move(10, 940);
        await page.screenshot({ path: join(screenshotDir, 'projects-list-zh.png') });
        await chooseView('中等图标', 'medium');
        await page.mouse.move(10, 940);
        await page.screenshot({ path: join(screenshotDir, 'projects-grid-zh.png') });
        await page.setViewportSize({ width: 600, height: 780 });
        assert.equal(
          await dialog.evaluate((el) => el.scrollWidth > el.clientWidth),
          false,
          'the dialog fits a narrow window',
        );
        await page.setViewportSize({ width: 1440, height: 960 });
        await page.evaluate(() => localStorage.setItem('openfilm.language', 'en'));
        await page.reload();
        await item('Clients').waitFor();
      }

      // A mixed selection asks once, includes nested projects, and can be cancelled.
      await item('Clients').click();
      await item('Coastal journal').click({ modifiers: ['Meta'] });
      await page.keyboard.press('Delete');
      const confirm = page.getByRole('dialog', { name: 'Delete selected items?', exact: true });
      await confirm.waitFor();
      await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal((await api('projects')).projects.length, 6);
      await surface.focus();
      await page.keyboard.press('Delete');
      await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
      await item('Clients').waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.querySelectorAll('[data-browser-item]').length === 4);
      await page.waitForFunction(async () => (await (await fetch('/api/projects')).json()).projects.length === 3);
      const remaining = (await api('projects')).projects.map((p) => p.id);
      assert.ok(
        !remaining.includes(projects[0].id) &&
          !remaining.includes(projects[2].id) &&
          !remaining.includes(projects[5].id),
        'folder descendants and individually selected projects are deleted',
      );
      assert.equal(
        (await api('projects/folders')).folders.some((f) => f.id === nested.id),
        false,
      );

      await item('Evening light').dblclick();
      await page.waitForFunction(() => window.openedProjects.length === 1);
      assert.deepEqual(
        await page.evaluate(() => window.openedProjects),
        [projects[4].id],
        'double click opens the project once',
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await studio?.close();
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  },
);
