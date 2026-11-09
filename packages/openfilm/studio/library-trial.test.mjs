import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

const PAGE = '<!doctype html><body style="margin:0;background:#224"><script>window.film={duration:4,frame(){}}</script></body>';

/** Studio on a project of one page clip, in English, the library's given category open. */
async function withLibrary(category, run, prepare = async (_page) => {}) {
  const scratch = await mkdtemp(join(tmpdir(), 'of-library-trial-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS'];
  const saved = new Map(names.map((n) => [`OPENFILM_${n}`, process.env[`OPENFILM_${n}`]]));
  for (const n of names) process.env[`OPENFILM_${n}`] = join(scratch, n.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Trial');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'page.html'), PAGE);
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 1280, h: 720 }, tracks: [{ clips: [{ id: 'page', src: 'page.html', time: [0, 4] }] }] }));
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, locale: 'en-US' });
    await prepare(page);
    /* the library's drawer is the app's: over its panel */
    await page.addInitScript(() => {
      window.openfilmHost = {
        version: 1,
        refer: () => {},
        panel: { label: 'Chat', open: true, width: 480, assets: { open: true, bottom: 0 }, setOpen: () => {}, setAssetsOpen: () => {}, onChange: () => {} },
      };
    });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    await page.locator('[data-viewer-picture] iframe').first().waitFor({ state: 'visible' });
    const tab = page.getByRole('button', { name: category, exact: true });
    await tab.waitFor({ state: 'visible' });
    await tab.click();
    const trial = page.locator('[data-library-trial]');
    /** What is drawn over the picture for this long: when it changed, and how many times it was drawn anew. */
    const watch = (ms) => page.evaluate((length) => new Promise((resolve) => {
      const start = performance.now();
      const host = document.querySelector('[data-library-trial]');
      let drawn = 0;
      const seen = new MutationObserver((changes) => { for (const c of changes) drawn += c.addedNodes.length; });
      seen.observe(host, { childList: true, subtree: true });
      const tick = () => {
        if (performance.now() - start < length) { setTimeout(tick, 50); return; }
        seen.disconnect();
        resolve({ drawn, showing: host.querySelector('img, iframe, span') !== null, clickable: getComputedStyle(host).pointerEvents !== 'none' });
      };
      tick();
    }), ms);
    await run({ page, trial, watch });
  } finally {
    await browser?.close();
    await studio?.close();
    for (const [n, v] of saved) { if (v === undefined) delete process.env[n]; else process.env[n] = v; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

const card = (page, name) => page.locator(`div.group[aria-label="${name}"]`).first();
const projectBar = (page) => page.locator('[data-project-player]');
const clickTimeline = (page) => page.locator('[data-timeline]').click({ position: { x: 250, y: 85 } });

test('a transition tried in the library plays once, leaves the film free, and plays again on another click', { timeout: 120_000 }, async () => {
  await withLibrary('Transitions', async ({ page, trial, watch }) => {
    for (const name of ['Blinds', 'Cross dissolve', 'Push left']) {
      const it = card(page, name);
      await it.scrollIntoViewIfNeeded();
      await it.click();
      await trial.waitFor({ state: 'attached' });
      const after = await watch(3000);
      assert.equal(after.drawn, 0, `${name} is not drawn again`);
      assert.equal(after.showing, false, `${name} has gone from the picture`);
      assert.equal(after.clickable, false, `the picture under ${name} takes clicks again`);
    }
    const again = card(page, 'Blinds');
    await again.scrollIntoViewIfNeeded();
    await again.click();
    await page.waitForTimeout(3000);
    assert.equal((await watch(100)).showing, false, 'the other one has ended');
    await again.click();
    await page.locator('[data-library-trial] iframe').waitFor({ state: 'attached', timeout: 2000 });
    assert.equal((await watch(3000)).showing, false, 'played again, once');
  });
});

test('an effect tried in the library stays on the picture until it is let go', { timeout: 120_000 }, async () => {
  await withLibrary('Effects', async ({ page, trial, watch }) => {
    await card(page, 'Film grain').click();
    await trial.waitFor({ state: 'attached' });
    const after = await watch(3000);
    assert.equal(after.showing, true);
    assert.equal(after.clickable, true);
    await page.locator('[data-library-preview-bar] [data-library-picture-bar]').waitFor();
    assert.equal(await projectBar(page).isVisible(), false);
    await page.locator('[data-titlebar]').click({ position: { x: 320, y: 16 } });
    await trial.waitFor({ state: 'detached' });
    await projectBar(page).waitFor();
  });
});

test('clicking beside an imported source closes its viewer preview', { timeout: 60_000 }, async () => {
  await withLibrary('Media', async ({ page }) => {
    await page.locator('[data-media-path="page.html"]').click();
    const source = page.locator('[data-viewer-pane] [data-asset-preview-control]');
    await source.waitFor({ state: 'visible' });
    await source.click();
    assert.equal(await source.isVisible(), true, 'the source picture still controls playback');
    await page.locator('[data-viewer-pane]').click({ position: { x: 5, y: 48 } });
    await source.waitFor({ state: 'detached' });
    await projectBar(page).waitFor();
  });
});

/** A real, locally generated tone, so playback tests need no library download or third-party voice service. */
function sampleWav({ seconds = 3, amplitude = () => 8000 } = {}) {
  const rate = 8000, frames = rate * seconds;
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write('RIFF'); wav.writeUInt32LE(36 + frames * 2, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(Math.sin(i * 440 * 2 * Math.PI / rate) * amplitude(i / rate)), 44 + i * 2);
  return wav;
}

test('a pending audio preview shows a loading ring, can be cancelled and never starts later', { timeout: 60_000 }, async () => {
  let finish;
  const waiting = new Promise((done) => { finish = done; });
  await withLibrary('Sounds', async ({ page }) => {
    const row = page.locator('[data-library-audio="audio/sfx/slow.wav"]');
    await row.click();
    const player = page.locator('[data-library-preview-bar] [data-audio-player]');
    await page.locator('[data-audio-player="loading"]').waitFor({ timeout: 2000 });
    await row.getByRole('progressbar').waitFor();
    assert.equal(await projectBar(page).isVisible(), false);
    assert.equal((await player.innerText()).trim(), 'Slow preview');
    const cover = page.locator('[data-viewer-picture] [data-library-audio-cover="sound"]');
    await cover.getByText('Slow preview', { exact: true }).waitFor();
    assert.equal(await cover.getAttribute('data-playing'), 'false');
    assert.equal(await row.getAttribute('aria-busy'), 'true');
    await player.getByRole('button', { name: 'Cancel', exact: true }).last().click();
    await page.locator('[data-audio-player="paused"]').waitFor();
    assert.equal(await page.evaluate(() => window.__libraryPreviews[0].getAttribute('src')), null);
    finish();
    await page.locator('[data-library-audio="audio/sfx/ready.wav"]').click();
    await page.locator('[data-audio-player="playing"]').waitFor({ timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__libraryPreviews[0].paused), true);
    await cover.click({ position: { x: 8, y: 8 } });
    await cover.waitFor({ state: 'detached' });
    await player.waitFor({ state: 'detached' });
    await projectBar(page).waitFor();
    assert.equal(await page.evaluate(() => window.__libraryPreviews.every((a) => a.paused)), true);
  }, async (page) => {
    await page.route('**/api/library/missing', (route) => route.fulfill({ json: { ids: ['audio/sfx/slow.wav', 'audio/sfx/ready.wav'] } }));
    await page.addInitScript(() => {
      const Audio = window.Audio;
      window.__libraryPreviews = [];
      window.Audio = function (src) { const a = new Audio(src); window.__libraryPreviews.push(a); return a; };
    });
    await page.route('**/api/library', (route) => route.fulfill({ json: { version: 1, groups: {}, items: [
      { id: 'audio/sfx/slow.wav', cat: 'sound', kind: 'sound', group: 'ui', name: { en: 'Slow preview' }, durationMs: 3000 },
      { id: 'audio/sfx/ready.wav', cat: 'sound', kind: 'sound', group: 'ui', name: { en: 'Ready preview' }, durationMs: 3000 },
    ] } }));
    await page.route('**/api/library/file?*', async (route) => {
      const path = new URL(route.request().url()).searchParams.get('path');
      if (path === 'audio/sfx/slow.wav') await waiting;
      await route.fulfill(path?.endsWith('.wav') ? { body: sampleWav(), contentType: 'audio/wav' } : { status: 404 }).catch(() => {});
    });
  });
});

test('cached audio keeps Add while opening and double-clicking the row only previews', { timeout: 60_000 }, async () => {
  let release, added = 0;
  const media = new Promise((done) => { release = done; });
  try {
    await withLibrary('Sounds', async ({ page }) => {
      try {
        const row = page.locator('[data-library-audio="audio/sfx/local.wav"]');
        await row.hover();
        const add = row.getByRole('button', { name: 'Add at the playhead', exact: true });
        await add.waitFor();
        await row.dblclick({ position: { x: 100, y: 22 } });
        await page.locator('[data-audio-player="loading"]').waitFor();
        assert.equal(await row.getAttribute('aria-busy'), 'false');
        assert.equal(await row.getByRole('progressbar').count(), 0);
        assert.equal(await add.isVisible(), true);
        await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
        release();
        await page.locator('[data-audio-player="playing"]').waitFor();
        assert.equal(added, 0);
      } finally { release(); }
    }, async (page) => {
      await page.route('**/api/library/missing', (route) => route.fulfill({ json: { ids: [] } }));
      await page.route('**/api/library', (route) => route.fulfill({ json: { version: 1, groups: {}, items: [
        { id: 'audio/sfx/local.wav', cat: 'sound', kind: 'sound', group: 'ui', name: { en: 'Cached sound' }, durationMs: 3000 },
      ] } }));
      await page.route('**/api/projects/*/saved/take', (route) => { added += 1; return route.fulfill({ status: 400 }); });
      await page.route('**/api/library/file?*', async (route) => {
        if (new URL(route.request().url()).searchParams.get('path') !== 'audio/sfx/local.wav') return route.fulfill({ status: 404 });
        await media;
        await route.fulfill({ body: sampleWav(), contentType: 'audio/wav' }).catch(() => {});
      });
    });
  } finally { release(); }
});

test('a failed voice sample offers retry and plays from its sample URL on the next attempt', { timeout: 60_000 }, async () => {
  let asks = 0;
  await withLibrary('Voices', async ({ page }) => {
    const row = page.locator('div[aria-label="Test voice"]').first();
    await row.click();
    const player = page.locator('[data-audio-player]');
    await page.locator('[data-audio-player="error"]').waitFor({ timeout: 5000 });
    await page.getByText('Network error. Please try again.', { exact: true }).waitFor();
    await row.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.locator('[data-audio-player="playing"]').waitFor({ timeout: 5000 });
    assert.equal(asks, 2);
    await clickTimeline(page);
    await player.waitFor({ state: 'detached' });
    await projectBar(page).waitFor();
  }, async (page) => {
    await page.route('**/api/library', (route) => route.fulfill({ json: { version: 1, groups: {}, items: [] } }));
    await page.route('**/api/library/voices', (route) => route.fulfill({ json: { version: 1, providers: [{ id: 'elevenlabs', name: 'ElevenLabs', models: [] }], voices: [
      { provider: 'elevenlabs', id: 'test', name: 'Test voice', gender: 'f', language: 'en', tags: [], sample: 'voices/elevenlabs/test.m4a' },
    ] } }));
    await page.route('**/api/library/file?*', (route) => {
      assert.equal(new URL(route.request().url()).searchParams.get('path'), 'voices/elevenlabs/test.m4a');
      asks += 1;
      return route.fulfill(asks === 1 ? { status: 503 } : { body: sampleWav(), contentType: 'audio/wav' });
    });
  });
});

test('an uncached voice downloads and plays only on click', { timeout: 60_000 }, async () => {
  let release, requests = 0;
  const sample = new Promise((done) => { release = done; });
  try {
    await withLibrary('Voices', async ({ page }) => {
      try {
        const row = page.locator('div[aria-label="Hover voice"]').first();
        const download = row.locator('button[data-library-download="missing"]');
        await download.waitFor();
        assert.equal(await row.locator('[title]').count(), 0);
        const use = row.getByRole('button', { name: /Use this voice/ });
        assert.equal(await use.count(), 0);
        await row.hover();
        await page.waitForTimeout(400);
        assert.equal(requests, 0);
        assert.equal(await row.getByRole('progressbar').count(), 0);
        await download.click();
        await row.getByRole('progressbar').waitFor();
        assert.equal(await download.count(), 0);
        await page.locator('[data-audio-player="loading"]').waitFor();
        release();
        await page.waitForFunction(() => window.__voiceAudio?.currentTime > 0);
        await row.getByRole('progressbar').waitFor({ state: 'detached' });
        assert.equal(await row.locator('[data-library-download]').count(), 0);
        await use.waitFor();
        const cover = page.locator('[data-viewer-picture] [data-library-audio-cover="voice"]');
        const orb = cover.locator('[data-voice-orb]');
        await orb.waitFor();
        const avatar = row.locator('[style*="radial-gradient"]').first();
        assert.equal(
          await cover.locator('[data-voice-avatar-base]').evaluate(el => el.style.background),
          await avatar.evaluate(el => el.style.background),
          'the idle orb starts with the same light spots as the avatar',
        );
        const color = await cover.evaluate((el) => el.style.getPropertyValue('--voice-glow').trim());
        assert.equal(await avatar.evaluate((el, color) => {
          const swatch = document.createElement('span');
          swatch.style.color = color;
          return el.style.background.includes(swatch.style.color);
        }, color), true, 'the orb uses a color from the avatar');
        await page.locator('[data-library-audio-cover="voice"][data-playing="true"]').waitFor();
        // Sample the pixels in the same frame that satisfies the energy condition.
        const readOrbFrame = async (quiet) => (await page.waitForFunction(quiet => {
          const canvas = document.querySelector('[data-voice-orb][data-ready]');
          if (!canvas) return null;
          const energy = Number(canvas.dataset.energy);
          if (quiet ? energy !== 0 || window.__voiceAudio.currentTime >= 8 : energy <= 55) return null;
          const { width, height } = canvas;
          const gl = canvas.getContext('webgl');
          const pixels = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let area = 0, color = 0, farthestPainted = 0, nearestClear = Infinity;
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const i = (y * width + x) * 4;
              const distance = Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2);
              if (pixels[i + 3] >= 128) {
                area++;
                color = (Math.imul(color, 31) + pixels[i] * 65536 + pixels[i + 1] * 256 + pixels[i + 2]) >>> 0;
                farthestPainted = Math.max(farthestPainted, distance);
              } else {
                nearestClear = Math.min(nearestClear, distance);
              }
            }
          }
          return { area, color, edgeSpread: farthestPainted - nearestClear };
        }, quiet)).jsonValue();
        const quiet = await readOrbFrame(true);
        await page.evaluate(() => { window.__voiceAudio.currentTime = 8; });
        const loud = await readOrbFrame(false);
        assert.ok(quiet.area > 0 && quiet.edgeSpread < 2 && loud.edgeSpread < 2, 'the painted outline is circular in both frames');
        assert.ok(loud.area > quiet.area * 1.07, 'the circle expands evenly with the voice');
        assert.notEqual(loud.color, quiet.color, 'the color inside the circle changes');
        if (process.env.OPENFILM_TEST_ARTIFACTS) await cover.screenshot({ path: join(process.env.OPENFILM_TEST_ARTIFACTS, 'voice-preview.png') });
        await page.evaluate(() => { window.__voiceAudio.currentTime = 16; });
        await page.waitForFunction(() => window.__voiceAudio.currentTime > 16
          && document.querySelector('[data-voice-orb]')?.getAttribute('data-energy') === '0');
        await page.locator('[data-library-preview-bar]').getByRole('button', { name: 'Pause', exact: true }).click();
        assert.equal(await cover.getAttribute('data-playing'), 'false');
        await page.locator('[data-titlebar]').click({ position: { x: 320, y: 16 } });
        await cover.waitFor({ state: 'detached' });
        await page.waitForFunction(() => window.__voiceAudio?.paused && !window.__voiceAudio.hasAttribute('src'));
        assert.equal(await projectBar(page).isVisible(), true);
        await page.locator('div[aria-label="Rose voice"]').click();
        await cover.getByText('Rose voice', { exact: true }).waitFor();
        const rose = await cover.evaluate((el) => el.style.getPropertyValue('--voice-glow').trim());
        assert.notEqual(rose, color, 'switching voices changes the orb palette');
        if (process.env.OPENFILM_TEST_ARTIFACTS) await cover.screenshot({ path: join(process.env.OPENFILM_TEST_ARTIFACTS, 'voice-preview-rose.png') });
      } finally { release(); }
    }, async (page) => {
      await page.addInitScript(() => {
        const Audio = window.Audio;
        window.Audio = function (src) { return (window.__voiceAudio = new Audio(src)); };
        // Keep the displayed pixels available for readPixels after the browser composites the frame.
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, options) {
          return getContext.call(this, type, type === 'webgl' && this.hasAttribute('data-voice-orb')
            ? { ...options, preserveDrawingBuffer: true } : options);
        };
      });
      await page.route('**/api/providers', (route) => route.fulfill({ json: { providers: [
        { id: 'openfilm', source: 'account', models: { tts: [{ id: 'elevenlabs/demo' }] } },
      ] } }));
      await page.route('**/api/library/voices', (route) => route.fulfill({ json: { version: 1, providers: [{ id: 'elevenlabs', name: 'ElevenLabs', models: [] }], voices: [
        { provider: 'elevenlabs', id: 'hover', name: 'Hover voice', gender: 'm', language: 'en', tags: [], sample: 'voices/elevenlabs/hover.m4a' },
        { provider: 'elevenlabs', id: 'rose', name: 'Rose voice', gender: 'f', language: 'en', tags: [], sample: 'voices/elevenlabs/rose.m4a' },
      ] } }));
      await page.route('**/api/library/missing', (route) => route.fulfill({ json: { ids: ['voices/elevenlabs/hover.m4a'] } }));
      await page.route('**/api/library/file?*', async (route) => {
        requests += 1;
        await sample;
        await route.fulfill({ body: sampleWav({ seconds: 24, amplitude: t => t >= 8 && t < 16 ? 12000 : 0 }), contentType: 'audio/wav' }).catch(() => {});
      });
    });
  } finally { release(); }
});

test('uncached waveform pictures leave connections for the audio preview', { timeout: 60_000 }, async () => {
  let waveRequests = 0, release;
  const waiting = new Promise((done) => { release = done; });
  try {
    await withLibrary('Sounds', async ({ page }) => {
      try {
        await page.locator('[data-library-audio="audio/sfx/sound-0.wav"]').click();
        await page.locator('[data-audio-player="playing"]').waitFor({ timeout: 5000 });
        assert.ok(waveRequests > 0 && waveRequests <= 2, `${waveRequests} waveforms started while their downloads were blocked`);
        assert.equal(await page.locator('[data-audio-preview]').count(), 1);
      } finally { release(); }
    }, async (page) => {
      await page.route('**/api/library', (route) => route.fulfill({ json: { version: 1, groups: {}, items:
        Array.from({ length: 80 }, (_, i) => ({ id: `audio/sfx/sound-${i}.wav`, cat: 'sound', kind: 'sound', group: 'ui', name: { en: `Queued sound ${i}` }, durationMs: 3000 })),
      } }));
      await page.route('**/api/library/file?*', async (route) => {
        const path = new URL(route.request().url()).searchParams.get('path');
        if (path?.includes('/waves/')) { waveRequests += 1; await waiting; }
        await route.fulfill(path?.endsWith('.wav') ? { body: sampleWav(), contentType: 'audio/wav' } : { status: 404 }).catch(() => {});
      });
    });
  } finally { release(); }
});

test('one click on an uncached music card downloads and plays automatically, with no separate download action', { timeout: 60_000 }, async () => {
  let fileReady, audioRequests = 0, downloadActions = 0;
  const file = new Promise((done) => { fileReady = done; });
  try {
    await withLibrary('Music', async ({ page }) => {
      const card = page.locator('[data-library-audio="audio/music/automatic.wav"]');
      try {
        await card.locator('[data-library-download="missing"]').waitFor();
        assert.equal(await card.getByText('Click to download and play', { exact: true }).count(), 0);
        assert.equal(await card.getByRole('button', { name: 'Download', exact: true }).count(), 0);
        await card.hover();
        await page.waitForTimeout(400);
        assert.equal(audioRequests, 0, 'hovering music does not fetch audio');
        await card.click({ position: { x: 90, y: 30 } });
        const player = page.locator('[data-audio-player]');
        await page.locator('[data-audio-player="loading"]').waitFor();
        await card.locator('[data-library-download="fetching"]').waitFor();
        const progress = card.getByRole('progressbar');
        await progress.waitFor();
        assert.equal(await progress.innerText(), '');
        assert.equal(await progress.getAttribute('aria-valuenow'), null, 'an unknown download size has no invented percentage');
        assert.equal((await player.innerText()).trim(), 'Automatic music', 'loading adds no visible explanatory text');
        assert.equal(await card.getByRole('progressbar').count(), 1);
        if (process.env.OPENFILM_TEST_ARTIFACTS) {
          await player.screenshot({ path: join(process.env.OPENFILM_TEST_ARTIFACTS, 'automatic-download.png') });
          await page.evaluate(() => { localStorage.setItem('openfilm.language', 'zh-CN'); window.dispatchEvent(new StorageEvent('storage', { key: 'openfilm.language' })); });
          await card.getByRole('progressbar', { name: '正在下载…', exact: true }).waitFor();
          await player.screenshot({ path: join(process.env.OPENFILM_TEST_ARTIFACTS, 'automatic-download-zh.png') });
          await page.evaluate(() => { localStorage.setItem('openfilm.language', 'en'); window.dispatchEvent(new StorageEvent('storage', { key: 'openfilm.language' })); });
          await card.getByRole('progressbar', { name: 'Downloading…', exact: true }).waitFor();
        }
        fileReady();
        await page.locator('[data-audio-player="playing"]').waitFor({ timeout: 5000 });
        assert.equal(audioRequests, 1);
        assert.equal(downloadActions, 0);
        const cover = page.locator('[data-viewer-picture] [data-library-audio-cover="music"]');
        await cover.locator('img').waitFor({ state: 'visible' });
        assert.equal(await cover.locator('img').evaluate((img) => img.naturalWidth > 0), true);
        await card.getByRole('button', { name: 'Add at the playhead', exact: true }).waitFor();
        assert.equal(await card.locator('[data-library-download]').count(), 0);
        assert.equal(await card.getByRole('button', { name: 'Add at the playhead', exact: true }).count(), 1);
        const rail = page.locator('[data-studio-library] nav').nth(1);
        await rail.click({ position: { x: 6, y: (await rail.boundingBox()).height - 8 } });
        await cover.waitFor({ state: 'detached' });
        await projectBar(page).waitFor();
      } finally { fileReady(); }
    }, async (page) => {
      await page.route('**/api/library', (route) => route.fulfill({ json: { version: 1, groups: {}, items: [
        { id: 'audio/music/automatic.wav', cat: 'music', kind: 'sound', group: 'calm', name: { en: 'Automatic music' }, durationMs: 3000, cover: 'audio/music/cover.png' },
      ] } }));
      await page.route('**/api/library/missing', (route) => route.fulfill({ json: { ids: ['audio/music/automatic.wav'] } }));
      await page.route('**/api/library/fetch', (route) => { downloadActions += 1; return route.fulfill({ json: { ok: true } }); });
      await page.route('**/api/library/file?*', async (route) => {
        const path = new URL(route.request().url()).searchParams.get('path');
        if (path === 'audio/music/cover.png') {
          const cover = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kvE0AAAAASUVORK5CYII=', 'base64');
          await route.fulfill({ body: cover, contentType: 'image/png' });
        } else if (path === 'audio/music/automatic.wav') {
          audioRequests += 1;
          await file;
          await route.fulfill({ body: sampleWav(), contentType: 'audio/wav' }).catch(() => {});
        } else await route.fulfill({ status: 404 });
      });
    });
  } finally { fileReady(); }
});

test('one click on an uncached Emoji prepares its bundle and opens the preview without a download button', { timeout: 60_000 }, async () => {
  let release, downloads = 0, prepared = false;
  const waiting = new Promise((done) => { release = done; });
  try {
    await withLibrary('Stickers', async ({ page, trial }) => {
      try {
        const moving = page.locator('[data-library-card="stickers/animated"]');
        await moving.locator('img').waitFor();
        assert.equal(await moving.locator('iframe, video').count(), 0, 'the sticker grid does not mount a page or video before hover');
        await moving.hover();
        await moving.locator('video[data-library-hover-preview]').waitFor({ state: 'attached' });
        assert.equal(await moving.getAttribute('title'), null);
        assert.ok((await moving.boundingBox()).width >= 104);
        await page.mouse.move(0, 0);
        await moving.locator('video[data-library-hover-preview]').waitFor({ state: 'detached' });
        assert.equal(await trial.count(), 0);
        assert.equal(downloads, 0);
        await page.getByRole('button', { name: 'Still stickers', exact: true }).click();
        const card = page.locator('[data-library-card="stickers/emoji/automatic"]');
        await card.locator('[data-library-download="missing"]').waitFor();
        assert.equal(await card.getByRole('button', { name: 'Download', exact: true }).count(), 0);
        await card.click();
        await card.getByRole('progressbar').waitFor();
        assert.equal(await trial.count(), 0);
        release();
        await trial.frameLocator('iframe').locator('#automatic-preview').waitFor();
        assert.equal(downloads, 1);
        await page.mouse.move(0, 0);
        const add = card.getByRole('button', { name: 'Add at the playhead', exact: true });
        await add.waitFor();
        assert.notEqual(await add.evaluate((button) => getComputedStyle(button).backgroundColor), 'rgba(0, 0, 0, 0)');
      } finally { release(); }
    }, async (page) => {
      await page.route('**/api/library', (route) => route.fulfill({ json: { version: 1, groups: {}, items: [
        { id: 'stickers/animated', cat: 'sticker', group: 'animated', kind: 'page', src: 'animated.html', w: 240, h: 240, name: { en: 'Animated sticker' } },
        { id: 'stickers/emoji/automatic', cat: 'sticker', group: 'faces', kind: 'page', still: true, src: 'sticker.html', w: 320, h: 180, fit: 0.5, durationMs: 2000, name: { en: 'Automatic Emoji' } },
      ] } }));
      await page.route('**/api/library/missing', (route) => route.fulfill({ json: { ids: ['stickers/emoji/automatic'] } }));
      await page.route('**/api/library/fetch', async (route) => {
        assert.equal(route.request().postDataJSON().id, 'stickers/emoji/automatic');
        downloads += 1; await waiting; prepared = true;
        await route.fulfill({ json: { ok: true } }).catch(() => {});
      });
      await page.route('**/api/library/pages/**', (route) => {
        assert.equal(prepared, true);
        return route.fulfill({ contentType: 'text/html', body: '<body style="background:cyan"><h1 id="automatic-preview">Automatic Emoji</h1><script>window.previewStarted=true</script>' });
      });
      await page.route('**/api/library/file?*', (route) => route.fulfill({ status: 404 }));
    });
  } finally { release(); }
});

test('a remote effect shows a network notice and retries from the card; a timeline click dismisses a pending preview', { timeout: 60_000 }, async () => {
  let release, downloads = 0, frames = 0;
  const waiting = new Promise((done) => { release = done; });
  try {
    await withLibrary('Effects', async ({ page, trial }) => {
      try {
        const card = page.locator('[data-library-card="community/v1/effect/automatic"]');
        await page.evaluate(() => {
          localStorage.setItem('openfilm.language', 'zh-CN');
          window.dispatchEvent(new StorageEvent('storage', { key: 'openfilm.language' }));
        });
        await card.click();
        const retry = card.getByRole('button', { name: '重试', exact: true });
        await retry.waitFor();
        await page.getByText('网络异常，请重试', { exact: true }).waitFor();
        assert.equal(await trial.count(), 0);
        await retry.click();
        await card.getByRole('progressbar').waitFor();
        const finished = page.waitForResponse((r) => r.url().endsWith('/api/library/fetch'));
        await clickTimeline(page);
        release();
        await (await finished).finished();
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        assert.equal(await trial.count(), 0);
        assert.equal(frames, 0, 'the cancelled asset never opens later');
        await card.click();
        await trial.frameLocator('iframe').locator('#effect-preview').waitFor();
        assert.equal(downloads, 2, 'a later click reuses the download that completed after the preview was dismissed');
      } finally { release(); }
    }, async (page) => {
      await page.route('**/api/library', (route) => route.fulfill({ json: { version: 1, groups: {}, items: [
        { id: 'community/v1/effect/automatic', cat: 'effect', kind: 'page', group: 'automatic', src: 'effect.html', durationMs: 2000, name: { en: 'Automatic effect' } },
      ] } }));
      await page.route('**/api/library/missing', (route) => route.fulfill({ json: { ids: ['community/v1/effect/automatic'] } }));
      await page.route('**/api/library/fetch', async (route) => {
        downloads += 1;
        if (downloads === 1) return route.fulfill({ status: 503 });
        if (downloads === 2) await waiting;
        await route.fulfill({ json: { ok: true } }).catch(() => {});
      });
      await page.route('**/api/library/pages/**', (route) => {
        frames += 1;
        return route.fulfill({ contentType: 'text/html', body: '<body style="background:cyan"><h1 id="effect-preview">Automatic effect</h1>' });
      });
      await page.route('**/api/library/file?*', (route) => route.fulfill({ status: 404 }));
    });
  } finally { release(); }
});

test('template downloads continue off hover and the viewer reuses the same cached example', {
  timeout: 60_000, skip: spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0,
}, async () => {
  const mp4 = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10:d=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1']);
  let release;
  const pending = new Promise((done) => { release = done; });
  const ids = ['templates/automatic', 'templates/second'];
  const examples = ids.map((id) => `examples/${id}.mp4`);
  const downloads = [];
  const cached = new Set();
  try {
    await withLibrary('Templates', async ({ page, trial }) => {
      try {
        const first = page.locator(`[data-library-card="${ids[0]}"]`);
        const second = page.locator(`[data-library-card="${ids[1]}"]`);
        await first.hover();
        await first.getByRole('progressbar').waitFor();
        await second.hover();
        await second.getByRole('progressbar').waitFor();
        assert.equal(await first.getByRole('progressbar').count(), 1, 'moving away leaves the first download running');
        assert.deepEqual(downloads, examples, 'two example downloads can be in progress at the same time');
        release();
        await first.getByRole('progressbar').waitFor({ state: 'detached' });
        assert.equal(await first.locator('video').count(), 0, 'only the card still hovered plays');
        await second.locator('video[data-library-hover-preview]').waitFor({ state: 'attached' });
        await first.hover();
        const hover = first.locator('video[data-library-hover-preview]');
        await hover.waitFor({ state: 'attached' });
        assert.equal(await hover.evaluate((v) => v.muted && v.loop), true);
        await page.waitForFunction(() => document.querySelector('[data-library-hover-preview]')?.currentTime > 0);
        const source = await hover.getAttribute('src');
        await first.click();
        await hover.waitFor({ state: 'detached' });
        const preview = page.locator(`[data-template-trial="${ids[0]}"]`);
        const bar = page.locator('[data-library-preview-bar] [data-template-trial-bar]');
        await bar.locator('[data-template-trial-play="playing"]').waitFor({ timeout: 8000 });
        assert.equal(await preview.locator('video').getAttribute('src'), source, 'the viewer uses the same file as hover');
        assert.equal(await preview.locator('video').evaluate((v) => v.muted), false);
        assert.equal(await projectBar(page).isVisible(), false);
        assert.deepEqual(downloads, examples, 'opening the viewer neither downloads again nor requests template music');
        const media = await preview.locator('video').evaluateHandle((v) => v);
        await bar.getByRole('button', { name: 'Pause', exact: true }).click();
        await bar.locator('[data-template-trial-play="paused"]').waitFor();
        const scrub = bar.getByRole('slider');
        const bounds = await scrub.boundingBox();
        await scrub.click({ position: { x: bounds.width * 0.75, y: bounds.height / 2 } });
        await page.waitForFunction((v) => v.currentTime > 1.2 && v.currentTime < 1.8, media, { timeout: 3000 });
        await page.locator('[data-viewer-picture]').click({ position: { x: 8, y: 8 } });
        await trial.waitFor({ state: 'detached' });
        await projectBar(page).waitFor();
        assert.equal(await media.evaluate((v) => v.paused && !v.getAttribute('src')), true);
        await media.dispose();
      } finally { release(); }
    }, async (page) => {
      await page.route('**/api/library', (route) => route.fulfill({ json: { version: 1, groups: {}, items: ids.map((id) =>
        ({ id, cat: 'template', kind: 'group', group: 'automatic', music: 'audio/music/tune.mp3', durationMs: 2000, name: { en: id } })),
      } }));
      await page.route('**/api/library/missing', (route) => route.fulfill({ json: { ids: [...ids, ...examples].filter((id) => !cached.has(id)) } }));
      await page.route('**/api/library/fetch', async (route) => {
        const { id } = route.request().postDataJSON();
        downloads.push(id);
        await pending;
        cached.add(id);
        await route.fulfill({ json: { ok: true } }).catch(() => {});
      });
      await page.route('**/api/library/file?*', async (route) => {
        const path = new URL(route.request().url()).searchParams.get('path');
        if (!cached.has(path)) return route.fulfill({ status: 404 });
        const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '');
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(Number(range[2]), mp4.length - 1) : mp4.length - 1;
        await route.fulfill({
          status: range ? 206 : 200, body: mp4.subarray(start, end + 1), contentType: 'video/mp4',
          headers: { 'accept-ranges': 'bytes', ...(range ? { 'content-range': `bytes ${start}-${end}/${mp4.length}` } : {}) },
        }).catch(() => {});
      });
    });
  } finally { release(); }
});
