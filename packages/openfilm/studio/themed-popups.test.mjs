import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { filmHtml, readFilmFile } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

const languages = ['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'it', 'nl', 'el', 'pl', 'tr', 'hi', 'sv', 'vi', 'th', 'id', 'fi', 'da', 'no', 'uk'];
const services = ['elevenlabs', 'inworld'].map(id => ({ id, name: id === 'inworld' ? 'Inworld' : 'ElevenLabs', connected: true, clone: true, sync: true, minSeconds: 1, maxSeconds: 180, models: [], pricingUrl: '', consoleUrl: '' }));

/** These menus must follow Studio's theme even when the browser/OS prefers the opposite. */
async function menuAppearance(page, theme) {
  const list = page.getByRole('listbox');
  await list.waitFor();
  const view = await list.evaluate(el => {
    const option = el.querySelector('[role="option"]');
    const bg = getComputedStyle(el).backgroundColor;
    const fg = getComputedStyle(option).color;
    const r = el.getBoundingClientRect();
    const rgb = css => css.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = color => rgb(color).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const a = luminance(bg), b = luminance(fg);
    return { bg, fg, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), dark: a < .2,
      bounds: r.x >= 11 && r.y >= 11 && r.right <= innerWidth - 11 && r.bottom <= innerHeight - 11,
      height: r.height, scrolls: el.scrollHeight > el.clientHeight };
  });
  assert.equal(view.dark, theme === 'dark', JSON.stringify(view));
  assert.ok(view.contrast >= 4.5, JSON.stringify(view));
  assert.equal(view.bounds, true, JSON.stringify(view));
  assert.ok(view.height <= 321, JSON.stringify(view));
  return view;
}

test('Studio popups use the same themed controls on Windows and Mac browser profiles', { timeout: 120_000 }, async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-themed-popups-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map(n => [`OPENFILM_${n}`, process.env[`OPENFILM_${n}`]]));
  for (const n of names) process.env[`OPENFILM_${n}`] = join(scratch, n.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Popups');
    await mkdir(root, { recursive: true });
    await mkdir(process.env.OPENFILM_SAVED, { recursive: true });
    await writeFile(join(root, 'page.html'), '<!doctype html><body style="margin:0;background:#224"><script>window.film={duration:4,frame(){}}</script>');
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 1280, h: 720 }, tracks: [{ clips: [{ id: 'page', src: 'page.html', time: [0, 4] }] }] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {}, editorDir: process.env.OPENFILM_TEST_EDITOR_DIR });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const errors = [];
    const colors = {};
    const newPage = async (platform, theme, projectId = project.id) => {
      const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, locale: 'en-US', colorScheme: theme === 'dark' ? 'light' : 'dark',
        userAgent: `Mozilla/5.0 (${platform === 'Win32' ? 'Windows NT 10.0; Win64; x64' : 'Macintosh; Intel Mac OS X 10_15_7'}) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36` });
      page.setDefaultTimeout(10_000);
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(({ platform, theme }) => {
        Object.defineProperty(navigator, 'platform', { get: () => platform });
        localStorage.setItem('openfilm.language', 'en');
        localStorage.setItem('openfilm.theme', theme);
        window.openfilmHost = { version: 1, refer: () => {}, panel: { label: 'Chat', open: true, width: 480, assets: { open: true, bottom: 0 }, setOpen: () => {}, setAssetsOpen: () => {}, onChange: () => {} } };
      }, { platform, theme });
      await page.route('**/api/library', route => route.fulfill({ json: { version: 1, groups: {}, items: [] } }));
      await page.route('**/api/library/voices', route => route.fulfill({ json: { version: 1, providers: [{ id: 'elevenlabs', name: 'ElevenLabs', models: [] }], voices: languages.map(language => ({ provider: 'elevenlabs', id: language, name: `Voice ${language}`, gender: 'f', language, tags: [], sample: null })) } }));
      await page.route('**/api/voices', route => route.fulfill({ json: { voices: [], services } }));
      await page.goto(`${studio.origin}/projects/${projectId}?key=${studio.key}`);
      await page.locator('[data-block-id]').first().waitFor({ state: 'visible' });
      return page;
    };
    for (const platform of ['Win32', 'MacIntel']) for (const theme of ['dark', 'light']) {
      await t.test(`${platform} ${theme}: scrolling, keyboard selection, focus and screen edges`, async () => {
        const page = await newPage(platform, theme);
        try {
          await page.getByRole('button', { name: 'Voices', exact: true }).click();
          const language = page.getByRole('button', { name: 'Language', exact: true });
          await language.click();
          const appearance = await menuAppearance(page, theme);
          assert.equal(appearance.scrolls, true);
          colors[`${platform}-${theme}`] = [appearance.bg, appearance.fg];
          assert.equal(await page.locator('select').count(), 0);
          await page.keyboard.press('End');
          await page.keyboard.press('Enter');
          await page.getByRole('listbox').waitFor({ state: 'detached' });
          assert.equal(await language.evaluate(el => el === document.activeElement), true);
          await page.locator('div[aria-label="Voice vi"]').first().waitFor();
          assert.equal(await page.locator('div[aria-label="Voice en"]').count(), 0);
          await language.click();
          await page.keyboard.press('Home');
          await page.keyboard.press('Enter');
          assert.match(await language.innerText(), /Any language/);
          await language.click();
          await page.keyboard.press('Escape');
          await page.getByRole('listbox').waitFor({ state: 'detached' });
          await language.click();
          await page.locator('[data-titlebar]').click({ position: { x: 320, y: 16 } });
          await page.getByRole('listbox').waitFor({ state: 'detached' });
          await page.setViewportSize({ width: 900, height: 650 });
          await language.click();
          await menuAppearance(page, theme);
          if (process.env.OPENFILM_TEST_ARTIFACTS && platform === 'Win32') await page.screenshot({ path: join(process.env.OPENFILM_TEST_ARTIFACTS, `voices-windows-${theme}.png`) });
          await page.keyboard.press('Escape');
        } finally { await page.close(); }
      });
    }
    for (const theme of ['dark', 'light']) assert.deepEqual(colors[`Win32-${theme}`], colors[`MacIntel-${theme}`]);

    await t.test('voice dialog menus stay above the overlay and Escape closes only the menu first', async () => {
      const page = await newPage('Win32', 'dark');
      try {
        await page.route('**/api/projects/*/files', route => route.fulfill({ json: { files: [{ kind: 'audio', path: 'assets/reference.wav' }] } }));
        await page.getByRole('button', { name: 'Voices', exact: true }).click();
        await page.getByRole('button', { name: 'Mine', exact: true }).click();
        await page.getByRole('button', { name: 'Clone voice', exact: true }).first().click();
        const dialog = page.getByRole('dialog', { name: 'Clone voice', exact: true });
        await dialog.waitFor();
        /* the dialog's menus are the themed ones, over the dialog's overlay (its engine is OpenFilm's service's to offer) */
        await dialog.getByRole('button', { name: 'Recording language', exact: true }).click();
        await menuAppearance(page, 'dark');
        const japanese = page.getByRole('option', { name: '日本語', exact: true });
        assert.equal(await japanese.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true);
        await japanese.click();
        assert.match(await dialog.getByRole('button', { name: 'Recording language', exact: true }).innerText(), /日本語/);
        await dialog.getByRole('button', { name: 'Project audio', exact: true }).click();
        const audio = dialog.locator('button[aria-haspopup="listbox"][aria-label="Project audio"]');
        await audio.click();
        await page.getByRole('option', { name: 'assets/reference.wav', exact: true }).click();
        assert.match(await audio.innerText(), /assets\/reference.wav/);
        await audio.click();
        await page.keyboard.press('Escape');
        await page.getByRole('listbox').waitFor({ state: 'detached' });
        assert.equal(await dialog.isVisible(), true);
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
      } finally { await page.close(); }
    });

    const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
    const chromaSkip = !hasFfmpeg ? 'no ffmpeg' : false;
    await t.test('chroma key opens the themed RGB picker, commits a hex and can undo it', { skip: chromaSkip }, async () => {
      const videoRoot = join(process.env.OPENFILM_LIBRARY, 'Key color');
      await mkdir(videoRoot);
      /* VP9, which every platform's headless browser decodes: an H.264 clip waits there for a copy it can play */
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=160x90:r=10:d=1', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', join(videoRoot, 'key.webm')]);
      await writeFile(join(videoRoot, 'film.html'), filmHtml({ stage: { w: 1280, h: 720 }, tracks: [{ clips: [{ id: 'key', src: 'key.webm', time: [0, 1], style: '--of-cutout:1;--of-cutout-mode:3;--of-cutout-color:#00ff00' }] }] }));
      const videoProject = await openProject(videoRoot);
      const page = await newPage('Win32', 'dark', videoProject.id);
      try {
        await page.locator('[data-block-kind="video"]').first().click({ position: { x: 20, y: 10 } });
        await page.getByRole('tab', { name: 'Effects', exact: true }).click();
        const swatch = page.getByRole('button', { name: 'Background color', exact: true });
        await swatch.click();
        const picker = page.locator('[data-color-picker]');
        await picker.waitFor();
        const bounds = await picker.boundingBox();
        assert.ok(bounds.x >= 12 && bounds.x + bounds.width <= 1488 && bounds.y >= 12 && bounds.y + bounds.height <= 938);
        assert.equal(await page.locator('input[type="color"]').count(), 0);
        assert.equal(await picker.getByRole('textbox', { name: 'Background color opacity', exact: true }).count(), 0);
        await picker.getByRole('textbox', { name: 'Background color hex', exact: true }).fill('00AAFF');
        await page.keyboard.press('Enter');
        await page.waitForFunction(async id => /00aaff/i.test(await (await fetch(`/api/projects/${id}`)).text()), videoProject.id);
        if (process.env.OPENFILM_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.OPENFILM_TEST_ARTIFACTS, 'color-picker-windows.png') });
        await page.keyboard.press('Escape');
        await picker.waitFor({ state: 'detached' });
        await page.locator('[data-mg-handle]').first().waitFor();
        /* A popover can consume Escape and unmount before the stage's listener runs (#498). The event still
           belongs to the popover even though its DOM is gone; it must not clear the clip and its controls. */
        await page.evaluate(() => {
          const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
          event.preventDefault();
          document.body.dispatchEvent(event);
        });
        if (process.env.OPENFILM_TEST_ARTIFACTS) await page.screenshot({ path: join(process.env.OPENFILM_TEST_ARTIFACTS, 'color-picker-closed.png') });
        await swatch.click();
        await page.keyboard.press('Escape');
        await page.keyboard.press('Control+z');
        await page.waitForFunction(async id => /00ff00/i.test(await (await fetch(`/api/projects/${id}`)).text()), videoProject.id);
        /* An Escape nobody consumed still deselects the clip. */
        await page.keyboard.press('Escape');
        await swatch.waitFor({ state: 'hidden' });
      } finally { await page.close(); }
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
