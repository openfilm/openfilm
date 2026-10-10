/**
 * One benchmark run: two launches of the app in a throwaway folder.
 *
 *   1. The film is opened, and with it on screen, in turn:
 *        idle     the whole app's memory, settled
 *        play     the film playing, nothing else going on
 *        scrub    the playhead dragged along the ruler
 *        divider  the chat's width dragged wider and back
 *        stream   the film playing while the chat streams an agent's turn (the own-key agent, Codex, on fake-model.mjs)
 *   2. The app is quit and started again, as a person reopens it: `start` is the time to Studio and the chat being
 *      ready, the film drawn.
 *
 * During each, every page and frame counts its animation frames and long tasks (measure.mjs): Studio's page, the
 * chat's page and the film's frame (where the footage plays).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { launch, makeProject, prepare, quit, waitForCdp } from './app.mjs';
import { startFakeModel } from './fake-model.mjs';
import { probe, startFrame, stopFrame, summarizeFrames, treeMemory } from './measure.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const CDP_PORT = 9455;
const PLAY_SECONDS = 10;

async function until(what, test, ms = 60_000, every = 50) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await test().catch(() => null);
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(every);
  }
}

/** Studio's page and the chat's: two pages in the app with two views, one page in the app with one (shell/). */
async function connect(cdp) {
  const browser = await chromium.connectOverCDP(cdp);
  const context = browser.contexts()[0];
  const studio = await until('the Studio page', async () => context.pages().find((p) => p.url().startsWith('http://127.0.0.1:')));
  await until('the chat', async () => context.pages().some((p) => p.url().startsWith('file:'))
    || await studio.evaluate(() => Boolean(document.getElementById('of-chat'))), 30_000, 100);
  const chat = context.pages().find((p) => p.url().startsWith('file:')) ?? studio;
  return { browser, studio, chat };
}

/** The film's frame: the visible `iframe[title=film]`'s. */
async function filmFrame(studio) {
  return until('the film frame', async () => {
    const handle = await studio.$('iframe[title="film"]:not([style*="hidden"])');
    return handle ? await handle.contentFrame() : null;
  });
}

/** Studio shows the film, ready to play and drawn; the chat's composer is there. */
async function ready(studio, chat, dir = null) {
  try {
    await until('Studio ready', () => studio.evaluate(() => Boolean(document.querySelector('[data-timeline]')
      && document.querySelector('button[aria-label="Play"]:not([disabled])')
      && !document.querySelector('.stage .cover'))), 90_000);
  } catch (e) {
    /* what the page shows instead, kept with the run's folder */
    if (dir) await studio.screenshot({ path: join(dir, 'not-ready.png') }).catch(() => {});
    const shown = await studio.evaluate(() => ({ path: location.pathname, timeline: Boolean(document.querySelector('[data-timeline]')),
      play: document.querySelector('button[aria-label="Play"], button[aria-label="Pause"]')?.outerHTML.slice(0, 120) ?? null,
      cover: document.querySelector('.stage .cover')?.textContent ?? null })).catch((x) => String(x));
    throw new Error(`${e.message}: ${JSON.stringify(shown)}`);
  }
  await until('the chat ready', () => chat.evaluate(() => Boolean(document.querySelector('[data-prompt-editor]'))), 90_000);
}

/** Measure `act` in Studio's page, the chat's page and the film's frame. */
async function measured(pages, act) {
  const onePage = pages.chat === pages.studio;
  const frames = { studio: pages.studio.mainFrame(), ...(onePage ? {} : { chat: pages.chat.mainFrame() }), film: pages.film };
  for (const p of new Set([pages.studio, pages.chat])) await probe(p);
  await Promise.all(Object.values(frames).map(startFrame));
  const extra = await act();
  const raw = Object.fromEntries(await Promise.all(Object.entries(frames).map(async ([k, f]) => [k, await stopFrame(f)])));
  const figures = Object.fromEntries(Object.entries(raw).map(([k, r]) => [k, summarizeFrames(r)]));
  /* one page: the chat's frames are Studio's */
  if (onePage) figures.chat = figures.studio;
  return { ...figures, ...(extra ?? {}) };
}

/** A key for Studio, as a person presses it with Studio in front: focus out of the chat first (its keys are its own). */
const press = async (page, code, key) => {
  await page.evaluate(() => { if (document.activeElement?.closest?.('.of-chat')) (document.activeElement).blur(); }).catch(() => {});
  await page.keyboard.press(code === 'Space' ? 'Space' : key);
};

/** The own-key agent on the fake model, the only one the chat offers. */
async function useFakeAgent(studio, chat, model) {
  const done = await studio.evaluate((baseUrl) => window.openfilmHost.agents.configureByok({ format: 'responses', baseUrl, model: 'bench', key: 'bench-key' }), model.baseUrl);
  if (!done?.ok) throw new Error(`setting up the agent: ${done?.error ?? 'no answer'}`);
  for (const id of ['codex', 'claude']) await studio.evaluate((x) => window.openfilmHost.agents.setShown(x, false), id);
  await until('the own-key agent ready', () => studio.evaluate(async () => (await window.openfilmHost.agents.list()).find((a) => a.id === 'byok')?.status === 'ready'), 120_000, 500);
  await chat.evaluate(() => localStorage.setItem('openfilm.local-agents.v2', JSON.stringify({ picked: 'byok', prefs: {}, options: {} })));
  await chat.reload();
  await until('the chat back', () => chat.evaluate(() => Boolean(document.querySelector('[data-prompt-editor]'))), 60_000);
}

/**
 * Send the chat a message and wait for the agent's answer to stream. A message that did not go (the editor not taking
 * keys yet) is sent again; a turn that never reaches the model leaves what the chat shows in the run's folder.
 */
async function send(chat, text, model, dir) {
  const bubbles = () => chat.evaluate((t) => [...document.querySelectorAll('p')].filter((p) => p.textContent?.includes(t)).length, text.slice(0, 30));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await chat.click('[data-prompt-editor]');
    if (attempt === 0) await chat.keyboard.insertText(text);
    await chat.keyboard.press('Enter');
    const went = await until('the message sent', async () => (await bubbles()) > 0, 5000, 100).catch(() => false);
    if (went) break;
  }
  try {
    await until('the agent streaming', async () => model.stats.steps >= 1, 120_000, 200);
  } catch (e) {
    await chat.screenshot({ path: join(dir, 'stream-timeout.png') }).catch(() => {});
    const shown = await chat.evaluate(() => document.body.innerText.slice(-600)).catch(() => '');
    throw new Error(`${e.message}; the model was asked ${model.stats.requests} time(s); the chat shows: ${shown.replace(/\s+/g, ' ')}`);
  }
}

/** @param {{ dir: string, log: (line: string) => void }} o */
export async function benchRun({ dir, log }) {
  prepare(dir);
  const project = join(dir, 'projects', 'bench-film');
  makeProject(project);
  const model = await startFakeModel({ log: (l) => log(`[model] ${l}\n`) });
  const figures = {};
  let app = await launch({ dir, cdpPort: CDP_PORT, log });
  try {
    await waitForCdp(app.cdp);
    let pages = await connect(app.cdp);
    /* the film opened as `openfilm open` opens it, without a browser */
    const run = await until('Studio advertised', async () => (existsSync(join(dir, 'home/run.json')) ? JSON.parse(readFileSync(join(dir, 'home/run.json'), 'utf8')) : null), 60_000, 200);
    const opened = await fetch(`${run.origin}/api/open`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-key': run.key }, body: JSON.stringify({ path: project, fallback: 0 }) });
    if (!opened.ok) throw new Error(`opening the film: ${opened.status}`);
    await ready(pages.studio, pages.chat, dir);
    pages = { ...pages, film: await filmFrame(pages.studio) };
    await sleep(3000);

    /* idle */
    await sleep(7000);
    figures.idle = { memory: treeMemory(app.child.pid) };

    /* play */
    figures.play = await measured(pages, async () => {
      await pages.studio.bringToFront().catch(() => {});
      await press(pages.studio, 'Space');
      await sleep(PLAY_SECONDS * 1000);
      await press(pages.studio, 'Space');
    });

    /* scrub: the playhead from the start to the end of the ruler and back, at a hand's pace */
    figures.scrub = await measured(pages, async () => {
      const box = await pages.studio.locator('[data-timeline] [role="slider"][aria-label="Drag the playhead"]').boundingBox();
      if (!box) throw new Error('no ruler');
      const seen = await pages.studio.evaluate(() => { window.__seeked = 0; window.addEventListener('message', (e) => { if (e.data?.source === 'openfilm-film' && e.data.type === 'seeked') window.__seeked += 1; }); return true; });
      const y = box.y + box.height / 2, x0 = box.x + 20, x1 = box.x + Math.min(box.width - 20, 900);
      await pages.studio.mouse.move(x0, y);
      await pages.studio.mouse.down();
      const steps = 120;
      for (let i = 0; i <= steps * 2; i += 1) {
        const k = i <= steps ? i / steps : 2 - i / steps;
        await pages.studio.mouse.move(x0 + (x1 - x0) * k, y);
        await sleep(16);
      }
      await pages.studio.mouse.up();
      await sleep(300);
      const shown = seen ? await pages.studio.evaluate(() => window.__seeked) : 0;
      return { scrub: { positions: steps * 2 + 1, framesShown: shown } };
    });

    /* divider: the chat 420 → 760 → 420 px wide, a width a frame, as the divider sets it while it is dragged */
    figures.divider = await measured(pages, async () => {
      const lag = await pages.chat.evaluate(async () => {
        const set = window.openfilmDesktop.setChatWidth;
        const frame = () => new Promise((done) => requestAnimationFrame(done));
        const out = [];
        const widths = [];
        for (let i = 0; i <= 60; i += 1) widths.push(Math.round(420 + 340 * Math.sin((Math.PI * i) / 60)));
        for (const w of widths) {
          /* a width a frame, as a hand drags it, however fast the window follows */
          await frame();
          const t0 = performance.now();
          set(w, false);
          let n = 0;
          const width = () => document.getElementById('of-chat')?.getBoundingClientRect().width ?? window.innerWidth;
          while (Math.abs(width() - w) > 1 && n < 30) { await frame(); n += 1; }
          out.push(performance.now() - t0);
        }
        set(420, true);
        return out;
      });
      const sorted = [...lag].sort((a, b) => a - b);
      return { resize: { steps: lag.length, lagMs: { p50: Math.round(sorted[sorted.length >> 1]), p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]), max: Math.round(sorted[sorted.length - 1]) } } };
    });

    /* stream: the agent's turn streaming in the chat while the film plays */
    await useFakeAgent(pages.studio, pages.chat, model);
    pages = { ...pages, ...(await connect(app.cdp)) };
    /* one page: the chat's reload was Studio's too, and the film's frame is a new one */
    if (pages.chat === pages.studio) { await ready(pages.studio, pages.chat, dir); pages.film = await filmFrame(pages.studio); }
    await send(pages.chat, 'Tighten every cut to the beat and keep the titles clear of the car.', model, dir);
    figures.stream = await measured(pages, async () => {
      await press(pages.studio, 'Space');
      await sleep(PLAY_SECONDS * 1000);
      await press(pages.studio, 'Space');
      return { model: { ...model.stats } };
    });
    figures.stream.memory = treeMemory(app.child.pid);
    await pages.browser.close().catch(() => {});
  } finally {
    await quit(app.child);
  }

  /* start: reopened, the film it had open comes back */
  const t0 = performance.now();
  app = await launch({ dir, cdpPort: CDP_PORT, log });
  try {
    await waitForCdp(app.cdp);
    const cdpAt = performance.now() - t0;
    const pages = await connect(app.cdp);
    const pagesAt = performance.now() - t0;
    await ready(pages.studio, pages.chat, dir);
    const readyAt = performance.now() - t0;
    figures.start = { readyMs: Math.round(readyAt), pagesMs: Math.round(pagesAt), processMs: Math.round(cdpAt) };
    await pages.browser.close().catch(() => {});
  } finally {
    await quit(app.child);
    await model.close();
  }
  return figures;
}
