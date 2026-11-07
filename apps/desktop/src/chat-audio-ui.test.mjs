import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { mkdtempSync, mkdirSync, writeFileSync, truncateSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { startStudio } from 'openfilm/studio';
import shellConfig from '../shell/vite.config.ts';

function wav(size) {
  const bytes = Buffer.alloc(44, 0);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(size + 36, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(8000, 28);
  bytes.writeUInt16LE(1, 32); bytes.writeUInt16LE(8, 34); bytes.write('data', 36); bytes.writeUInt32LE(size, 40);
  return bytes;
}

test('chat audio uses Studio file URLs: playback, ranges, large files and project boundaries', { timeout: 60_000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-markdown-audio-'));
  const names = ['OPENFILM_HOME', 'OPENFILM_LIBRARY', 'OPENFILM_TRASH_DIR', 'OPENFILM_SHARED_HOME'];
  const env = new Map(names.map(name => [name, process.env[name]]));
  process.env.OPENFILM_HOME = join(dir, 'home');
  process.env.OPENFILM_LIBRARY = join(dir, 'library');
  process.env.OPENFILM_TRASH_DIR = join(dir, 'trash');
  delete process.env.OPENFILM_SHARED_HOME;
  let studio, server, browser;
  try {
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    const response = await fetch(`${studio.origin}/api/projects`, {
      method: 'POST', headers: { 'x-studio-key': studio.key, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Audio' }),
    });
    assert.equal(response.status, 200);
    const { project } = await response.json();
    const assets = join(project.path, 'assets'); mkdirSync(assets, { recursive: true });
    const voice = Buffer.concat([wav(8000), Buffer.alloc(8000, 128)]);
    writeFileSync(join(assets, '声音 A.wav'), voice);
    writeFileSync(join(dir, 'outside.wav'), voice);
    const largeSize = 36 * 1024 * 1024;
    writeFileSync(join(assets, 'large.wav'), wav(largeSize));
    truncateSync(join(assets, 'large.wav'), largeSize + 44);
    let linked = true;
    try { symlinkSync(join(dir, 'outside.wav'), join(assets, 'link.wav')); }
    catch (error) { if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) linked = false; else throw error; }
    const metadata = await (await fetch(`${studio.origin}/api/projects/${project.id}`, { headers: { 'x-studio-key': studio.key } })).json();
    const folder = metadata.folder;
    assert.ok(folder && new URL(folder).pathname.startsWith('/p/'));
    server = await createServer({
      ...shellConfig, configFile: false, root: fileURLToPath(new URL('..', import.meta.url)),
      server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: studio.origin, changeOrigin: true, headers: { 'x-studio-key': studio.key } } } },
      logLevel: 'error',
      plugins: [...shellConfig.plugins, {
        name: 'markdown-audio-fixture',
        configureServer(app) {
          app.middlewares.use('/markdown-audio', (_req, res, next) => {
            res.setHeader('content-type', 'text/html');
            void app.transformIndexHtml('/markdown-audio', '<!doctype html><html><body><div id="root"></div><script type="module" src="/bench/markdown-audio.tsx"></script></body></html>')
              .then(html => res.end(html), next);
          });
        },
      }],
    });
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage(); page.setDefaultTimeout(8000);
    await page.addInitScript(project => {
      window.audioProject = project; window.audioCalls = [];
      window.openfilmDesktop = { chat: { audio: async (_project, href) => { window.audioCalls.push(href); throw new Error('Audio must use Studio, never a native file-reading IPC'); } } };
    }, project);
    let popups = 0;
    const errors = [], mediaRequests = [];
    page.on('popup', () => { popups++; }); page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (new URL(req.url()).pathname.endsWith('.wav')) mediaRequests.push(req.url()); });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/markdown-audio`);
    await page.waitForFunction(() => window.audioFolder);
    assert.equal(await page.evaluate(() => window.audioFolder), folder, 'the real project API supplies the folder');
    await page.getByRole('button', { name: 'Voice A', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '声音 A.wav' });
    await dialog.waitFor();
    const audio = dialog.locator('audio');
    assert.equal(await audio.getAttribute('src'), new URL('assets/%E5%A3%B0%E9%9F%B3%20A.wav', folder).href, 'stream directly from the project folder, never native bytes or a blob');
    await audio.evaluate(async el => { await el.play(); });
    assert.equal(await audio.evaluate(el => el.paused), false);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await page.evaluate(() => document.querySelectorAll('audio').length), 0, 'closing unmounts the player');
    await t.test('range requests and files larger than the removed IPC limit', async () => {
      const response = await fetch(new URL('assets/large.wav', folder), { headers: { Range: 'bytes=0-43' } });
      assert.equal(response.status, 206); assert.equal((await response.arrayBuffer()).byteLength, 44);
      assert.equal(response.headers.get('content-range'), `bytes 0-43/${largeSize + 44}`);
      await page.getByRole('button', { name: 'Large', exact: true }).click();
      const large = page.getByRole('dialog', { name: 'large.wav' });
      await large.waitFor();
      await large.locator('audio').evaluate(el => new Promise((done, fail) => { if (el.readyState >= 1) return done(); el.addEventListener('loadedmetadata', done, { once: true }); el.addEventListener('error', fail, { once: true }); }));
      assert.equal(await large.locator('audio').evaluate(el => el.duration), largeSize / 8000);
      await large.getByRole('button', { name: 'Close', exact: true }).click();
    });
    await t.test('parent and encoded-parent links never request another project or the Studio shell', async () => {
      for (const name of ['Parent', 'Encoded parent']) {
        const before = mediaRequests.length;
        await page.getByRole('button', { name, exact: true }).click();
        await page.getByRole('alert').last().waitFor();
        assert.equal(mediaRequests.length, before);
        assert.equal(await page.getByRole('dialog').count(), 0);
      }
    });
    const failedPreview = async (label, name) => {
      await page.getByRole('button', { name: label, exact: true }).click();
      const dialog = page.getByRole('dialog', { name }); await dialog.waitFor();
      await dialog.getByText('This file could not be read', { exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    };
    await t.test('missing audio shows the existing player error', () => failedPreview('Missing', 'missing.wav'));
    await t.test('unapproved symlinks cannot disclose bytes outside the project', { skip: !linked && 'Windows requires symlink permission' }, async () => {
      const response = await fetch(new URL('assets/link.wav', folder)); assert.equal(response.status, 404);
      assert.notDeepEqual(Buffer.from(await response.arrayBuffer()), voice);
      await failedPreview('Link', 'link.wav');
    });
    assert.deepEqual(await page.evaluate(() => window.audioCalls), [], 'no audio-reading IPC is called');
    assert.equal(popups, 0); assert.deepEqual(errors, []);
    assert.ok(mediaRequests.every(url => url.startsWith(folder)), 'every audio request stays under this project token');
    assert.equal(await page.getByRole('link', { name: 'Website', exact: true }).getAttribute('href'), 'https://example.com/');
  } finally {
    await browser?.close(); await server?.close(); await studio?.close();
    for (const [name, value] of env) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    rmSync(dir, { recursive: true, force: true });
  }
});
