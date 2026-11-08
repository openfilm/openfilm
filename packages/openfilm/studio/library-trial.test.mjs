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
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
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

const card = (page, name) => page.locator(`div.group[title="${name}"]`).first();

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
  });
});

/** A real, locally generated tone, so playback tests need no library download or third-party voice service. */
function sampleWav() {
  const rate = 8000, frames = rate * 3;
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write('RIFF'); wav.writeUInt32LE(36 + frames * 2, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(Math.sin(i * 440 * 2 * Math.PI / rate) * 8000), 44 + i * 2);
  return wav;
}

test('a pending audio preview shows only a loading bar, can be cancelled and never starts later', { timeout: 60_000 }, async () => {
  let finish;
  const waiting = new Promise((done) => { finish = done; });
  await withLibrary('Sounds', async ({ page }) => {
    const row = page.locator('[data-library-audio="audio/sfx/slow.wav"]');
    await row.click();
    const player = page.locator('[data-audio-player]');
    await page.locator('[data-audio-player="loading"]').waitFor({ timeout: 2000 });
    await player.getByRole('progressbar').waitFor();
    assert.equal(await player.getByRole('progressbar').innerText(), '');
    assert.equal((await player.innerText()).trim(), 'Slow preview');
    assert.equal(await row.getAttribute('aria-busy'), 'true');
    await player.getByRole('button', { name: 'Cancel', exact: true }).last().click();
    await page.locator('[data-audio-player="paused"]').waitFor();
    assert.equal(await page.evaluate(() => window.__libraryPreviews[0].getAttribute('src')), null);
    finish();
    await page.locator('[data-library-audio="audio/sfx/ready.wav"]').click();
    await page.locator('[data-audio-player="playing"]').waitFor({ timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__libraryPreviews[0].paused), true);
    await player.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await player.count(), 0);
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

test('a failed voice sample offers retry and plays from its sample URL on the next attempt', { timeout: 60_000 }, async () => {
  let asks = 0;
  await withLibrary('Voices', async ({ page }) => {
    await page.getByText('Test voice', { exact: true }).click();
    const player = page.locator('[data-audio-player]');
    await page.locator('[data-audio-player="error"]').waitFor({ timeout: 5000 });
    assert.match(await player.getByRole('status').textContent(), /Could not load. Retry to play/);
    await player.getByRole('button', { name: 'Try again', exact: true }).last().click();
    await page.locator('[data-audio-player="playing"]').waitFor({ timeout: 5000 });
    assert.equal(asks, 2);
    await page.getByRole('button', { name: 'Sounds', exact: true }).click();
    assert.equal(await player.count(), 0, 'leaving the voices panel closes its own preview');
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
  let fileReady, lookupReady, audioRequests = 0, downloadActions = 0;
  const file = new Promise((done) => { fileReady = done; });
  const lookup = new Promise((done) => { lookupReady = done; });
  try {
    await withLibrary('Music', async ({ page }) => {
      const card = page.locator('[data-library-audio="audio/music/automatic.wav"]');
      try {
        await card.locator('[data-library-download="missing"]').waitFor();
        assert.equal(await card.getByText('Click to download and play', { exact: true }).count(), 0);
        assert.equal(await card.getByRole('button', { name: 'Download', exact: true }).count(), 0);
        await card.click({ position: { x: 90, y: 30 } });
        const player = page.locator('[data-audio-player]');
        await page.locator('[data-audio-player="loading"]').waitFor();
        await card.locator('[data-library-download="fetching"]').waitFor();
        const bar = player.getByRole('progressbar');
        await bar.waitFor();
        assert.equal(await bar.innerText(), '');
        assert.equal(await bar.getAttribute('aria-valuenow'), null, 'an unknown download size has no invented percentage');
        assert.equal((await player.innerText()).trim(), 'Automatic music', 'loading adds no visible explanatory text');
        assert.equal(await card.getByRole('progressbar').count(), 1);
        if (process.env.OPENFILM_TEST_ARTIFACTS) {
          await player.screenshot({ path: join(process.env.OPENFILM_TEST_ARTIFACTS, 'automatic-download.png') });
          await page.evaluate(() => { localStorage.setItem('openfilm.language', 'zh-CN'); window.dispatchEvent(new StorageEvent('storage', { key: 'openfilm.language' })); });
          await player.getByRole('progressbar', { name: '正在下载，完成后自动播放', exact: true }).waitFor();
          await player.screenshot({ path: join(process.env.OPENFILM_TEST_ARTIFACTS, 'automatic-download-zh.png') });
          await page.evaluate(() => { localStorage.setItem('openfilm.language', 'en'); window.dispatchEvent(new StorageEvent('storage', { key: 'openfilm.language' })); });
          await player.getByRole('progressbar', { name: 'Downloading… Playback starts when ready.', exact: true }).waitFor();
        }
        fileReady();
        await page.locator('[data-audio-player="playing"]').waitFor({ timeout: 5000 });
        assert.equal(audioRequests, 1);
        assert.equal(downloadActions, 0);
        await card.getByRole('button', { name: 'Add at the playhead', exact: true }).waitFor();
        /* The older missing lookup arrives after the audio is ready: the add button must stay ready. */
        const answered = page.waitForResponse((r) => r.url().endsWith('/api/library/missing'));
        lookupReady();
        await (await answered).finished();
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        assert.equal(await card.locator('[data-library-download]').count(), 0);
        assert.equal(await card.getByRole('button', { name: 'Add at the playhead', exact: true }).count(), 1);
      } finally { fileReady(); lookupReady(); }
    }, async (page) => {
      await page.route('**/api/library', (route) => route.fulfill({ json: { version: 1, groups: {}, items: [
        { id: 'audio/music/automatic.wav', cat: 'music', kind: 'sound', group: 'calm', name: { en: 'Automatic music' }, durationMs: 3000 },
      ] } }));
      await page.route('**/api/library/missing', async (route) => {
        await lookup;
        await route.fulfill({ json: { ids: ['audio/music/automatic.wav'] } }).catch(() => {});
      });
      await page.route('**/api/library/fetch', (route) => { downloadActions += 1; return route.fulfill({ json: { ok: true } }); });
      await page.route('**/api/library/file?*', async (route) => {
        if (new URL(route.request().url()).searchParams.get('path') === 'audio/music/automatic.wav') {
          audioRequests += 1;
          await file;
          await route.fulfill({ body: sampleWav(), contentType: 'audio/wav' }).catch(() => {});
        } else await route.fulfill({ status: 404 });
      });
    });
  } finally { fileReady(); lookupReady(); }
});

test('one click on an uncached Emoji prepares its bundle and opens the preview without a download button', { timeout: 60_000 }, async () => {
  let release, downloads = 0, prepared = false;
  const waiting = new Promise((done) => { release = done; });
  try {
    await withLibrary('Stickers', async ({ page, trial }) => {
      try {
        await page.getByRole('button', { name: 'Still stickers', exact: true }).click();
        const card = page.locator('[data-library-card="stickers/emoji/automatic"]');
        await card.locator('[data-library-download="missing"]').waitFor();
        assert.equal(await card.getByRole('button', { name: 'Download', exact: true }).count(), 0);
        await card.click();
        await page.locator('[data-library-preparing="loading"]').waitFor();
        assert.equal(await card.getByRole('progressbar').count(), 1);
        assert.equal(await trial.getByRole('progressbar').innerText(), '');
        assert.equal(await trial.locator('iframe').count(), 0);
        release();
        await trial.frameLocator('iframe').locator('#automatic-preview').waitFor();
        assert.equal(downloads, 1);
        await card.hover();
        await card.getByRole('button', { name: 'Add at the playhead', exact: true }).waitFor();
      } finally { release(); }
    }, async (page) => {
      await page.route('**/api/library', (route) => route.fulfill({ json: { version: 1, groups: {}, items: [
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

test('a remote effect can retry preparation, cancel the wait, and never preview after cancellation', { timeout: 60_000 }, async () => {
  let release, downloads = 0, frames = 0;
  const waiting = new Promise((done) => { release = done; });
  try {
    await withLibrary('Effects', async ({ page, trial }) => {
      try {
        const card = page.locator('[data-library-card="community/v1/effect/automatic"]');
        await card.click();
        await page.locator('[data-library-preparing="error"]').waitFor();
        assert.equal((await trial.innerText()).trim(), '');
        await trial.getByRole('button', { name: 'Try again', exact: true }).click();
        await page.locator('[data-library-preparing="loading"]').waitFor();
        const finished = page.waitForResponse((r) => r.url().endsWith('/api/library/fetch'));
        await trial.getByRole('button', { name: 'Cancel', exact: true }).click();
        release();
        await (await finished).finished();
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        assert.equal(await trial.count(), 0);
        assert.equal(frames, 0, 'the cancelled asset never opens later');
        await card.click();
        await trial.frameLocator('iframe').locator('#effect-preview').waitFor();
        assert.equal(downloads, 3);
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

test('an uncached template prepares its assets and autoplays the video when its download finishes', {
  timeout: 60_000, skip: spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0,
}, async () => {
  const mp4 = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10:d=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1']);
  let prepared, downloaded, asks = 0;
  const assets = new Promise((done) => { prepared = done; });
  const video = new Promise((done) => { downloaded = done; });
  try {
    await withLibrary('Templates', async ({ page, trial }) => {
      try {
        const card = page.locator('[data-library-card="templates/automatic"]');
        await card.click();
        await page.locator('[data-library-preparing="loading"]').waitFor();
        assert.equal(await card.getByRole('button', { name: 'Download', exact: true }).count(), 0);
        prepared();
        const preview = page.locator('[data-template-trial="templates/automatic"]');
        await preview.getByRole('progressbar').waitFor();
        downloaded();
        await preview.locator('[data-template-trial-play="playing"]').waitFor({ timeout: 8000 });
        await page.waitForFunction(() => document.querySelector('[data-template-trial] video')?.currentTime > 0.05);
        assert.equal(asks, 1);
        const media = await preview.locator('video').evaluateHandle((v) => v);
        await preview.locator('[data-template-trial-close]').click();
        assert.equal(await trial.count(), 0);
        assert.equal(await media.evaluate((v) => v.paused && !v.getAttribute('src')), true);
        await media.dispose();
      } finally { prepared(); downloaded(); }
    }, async (page) => {
      await page.route('**/api/library', (route) => route.fulfill({ json: { version: 1, groups: {}, items: [
        { id: 'templates/automatic', cat: 'template', kind: 'group', group: 'automatic', music: 'audio/music/tune.mp3', durationMs: 2000, name: { en: 'Automatic template' } },
      ] } }));
      await page.route('**/api/library/missing', (route) => route.fulfill({ json: { ids: ['templates/automatic'] } }));
      await page.route('**/api/library/fetch', async (route) => { asks += 1; await assets; await route.fulfill({ json: { ok: true } }).catch(() => {}); });
      await page.route('**/api/library/file?*', async (route) => {
        if (new URL(route.request().url()).searchParams.get('path') === 'examples/templates/automatic.mp4') {
          await video; await route.fulfill({ body: mp4, contentType: 'video/mp4' }).catch(() => {});
        } else await route.fulfill({ status: 404 });
      });
    });
  } finally { prepared(); downloaded(); }
});
