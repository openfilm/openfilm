import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

/** A 3D LUT (.cube, 2 points) that swaps red and blue. */
const SWAP = `LUT_3D_SIZE 2\n${[0, 1].flatMap((b) => [0, 1].flatMap((g) => [0, 1].map((r) => `${b} ${g} ${r}`))).join('\n')}\n`;
const film = (style) => filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'v', src: 'flat.mp4', at: 0, time: [0, 2], ...(style ? { style } : {}) }] }] });

test('the preview plays a clip graded by a LUT from its graded copy, made while it plays the video as it is', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 90_000 }, async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'of-film-graded-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS', 'TRASH_DIR', 'SKILLS_INDEX'];
  const saved = new Map(names.map((n) => [`OPENFILM_${n}`, process.env[`OPENFILM_${n}`]]));
  for (const n of names) process.env[`OPENFILM_${n}`] = join(scratch, n.toLowerCase());
  await writeFile(process.env.OPENFILM_SKILLS_INDEX, '{"version":1,"skills":[]}');
  await mkdir(process.env.OPENFILM_TRASH_DIR, { recursive: true });
  const root = join(process.env.OPENFILM_LIBRARY, 'Graded');
  await mkdir(root, { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2060c0:size=320x180:rate=30', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(root, 'flat.mp4')]);
  await writeFile(join(root, 'swap.cube'), SWAP);
  await writeFile(join(root, 'film.html'), film('--of-lut: url(swap.cube)'));
  const project = await openProject(root);
  const studio = await startStudio({ port: 0, openBrowser: () => {}, editorDir: process.env.OPENFILM_TEST_EDITOR_DIR });
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
  t.after(async () => {
    await browser.close();
    await studio.close();
    for (const [n, v] of saved) { if (v === undefined) delete process.env[n]; else process.env[n] = v; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-US', reducedMotion: 'reduce' });
  await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
  await page.locator('[data-viewer-picture] iframe').first().waitFor({ state: 'attached' });
  /* the clip's video as the film's page shows it: where it plays from, and its middle pixel */
  const seen = async () => {
    const frame = page.frames().find((f) => /\/film\.html/.test(f.url()) && !/film-host=0/.test(f.url()));
    return frame?.evaluate(() => {
      const v = /** @type {HTMLVideoElement | null} */ (document.querySelector('video'));
      if (!v || v.readyState < 2) return null;
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
      g.drawImage(v, 0, 0);
      return { src: v.currentSrc, rgb: [...g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data.slice(0, 3)] };
    }).catch(() => null);
  };
  const until = async (/** @type {(s: { src: string, rgb: number[] }) => boolean} */ ok, what) => {
    const end = Date.now() + 30_000;
    let last = null;
    while (Date.now() < end) {
      last = await seen();
      if (last && ok(last)) return last;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.fail(`${what}: ${JSON.stringify(last)}`);
  };
  /* its graded copy, once made: red and blue swapped */
  const graded = await until((s) => s.src.includes('of-grade=') && s.rgb[0] > 150 && s.rgb[2] < 70, 'the graded copy');
  assert.match(graded.src, /flat\.mp4\?of-grade=[0-9a-f]{12}$/);
  /* the LUT taken off: the video as it is again */
  await writeFile(join(root, 'film.html'), film(''));
  await until((s) => !s.src.includes('of-grade') && s.rgb[2] > 150 && s.rgb[0] < 70, 'the video as it is');
});
