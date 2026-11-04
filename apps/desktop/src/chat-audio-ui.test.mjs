import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerChatIpc } from './chat-ipc.mjs';
import { chromium } from 'playwright-core';
import shellConfig from '../shell/vite.config.ts';

test('relative audio links preview in chat without navigating to the Studio HTML fallback', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-markdown-audio-'));
  const project = join(dir, 'film');
  mkdirSync(project);
  mkdirSync(join(dir, 'voice_auditions'));
  const bytes = Buffer.alloc(8044, 128);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(8036, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(8000, 28);
  bytes.writeUInt16LE(1, 32); bytes.writeUInt16LE(8, 34); bytes.write('data', 36); bytes.writeUInt32LE(8000, 40);
  writeFileSync(join(dir, 'voice_auditions', 'voice A.wav'), bytes);
  const handlers = new Map();
  registerChatIpc({ handle: (channel, fn) => handlers.set(channel, fn) }, {
    trusted: () => true, projects: async () => [project], dataDir: dir,
    reveal: () => {}, tell: () => {}, log: () => {},
  });
  const server = await createServer({
    ...shellConfig, configFile: false, root: fileURLToPath(new URL('..', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
    plugins: [...shellConfig.plugins, {
      name: 'markdown-audio-fixture',
      configureServer(app) {
        app.middlewares.use('/markdown-audio', (_req, res, next) => {
          res.setHeader('content-type', 'text/html');
          void app.transformIndexHtml('/markdown-audio', '<!doctype html><html><body><div id="root"></div><script type="module" src="/bench/markdown-audio.tsx"></script></body></html>')
            .then((html) => res.end(html), next);
        });
      },
    }],
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    await page.exposeFunction('readAudio', async (href) => {
      const audio = await handlers.get('desktop:chat:audio')({}, { project, href });
      return { ...audio, bytes: Array.from(audio.bytes) };
    });
    await page.addInitScript(() => {
      window.audioCalls = [];
      window.openfilmDesktop = {
        developer: { get: async () => ({ logs: false, changes: true }), onChange: () => () => {} },
        chat: { audio: async (project, href) => {
          window.audioCalls.push({ project, href });
          return window.readAudio(href);
        } },
      };
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let popups = 0;
    page.on('popup', () => { popups++; });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/markdown-audio`);
    await page.getByRole('link', { name: 'Voice A', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'voice A.wav' });
    await dialog.waitFor();
    assert.deepEqual(await page.evaluate(() => window.audioCalls), [{ project: '/example/film', href: '../voice_auditions/voice%20A.wav' }]);
    const audio = dialog.locator('audio');
    await audio.evaluate(async (el) => { await el.play(); });
    assert.equal(await audio.evaluate(el => el.paused), false, 'the audio can play');
    const url = await audio.getAttribute('src');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await page.evaluate(async (url) => { try { await fetch(url); return true; } catch { return false; } }, url), false, 'closing releases the audio blob');
    await page.getByRole('link', { name: 'Missing', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').innerText(), /Could not preview this audio/);
    assert.deepEqual(errors, []);
    assert.equal(popups, 0, 'local audio never opens the Studio origin in a new tab');
    assert.equal(await page.getByRole('link', { name: 'Website', exact: true }).getAttribute('href'), 'https://example.com/');
  } finally { await browser?.close(); await server.close(); rmSync(dir, { recursive: true, force: true }); }
});
