#!/usr/bin/env node
// @ts-check
/**
 * Does Studio's picture ever go black, or show a wrong frame, while a person edits? A Studio of its own (a scratch
 * OPENFILM_HOME, a free port) opens a scratch film of two videos under a page, in headless Chromium. For each step
 * below, from the same film each time: the editor is opened, the playhead put on the second video, the step done, and
 * the picture taken every 50 ms for 3 s. A picture is
 *
 *   black   mostly black, where the film before and after the step is not
 *   wrong   unlike both the picture before the step and the one it settles on (another moment, a look not kept)
 *
 *   node scripts/preview-probe.mjs [--delay ms] [--only step,step] [--shots dir] [--keep]
 *
 * `--delay`: every video request of the film answers this late (a slow disk or network; a big file's first frame).
 * `--shots`: where to write the pictures counted (and each step's last). Needs ffmpeg (for the videos). Exits 1 when
 * any picture was black or wrong. `loads` are the film's loads in the picture (1 → 1+2 → 2: loaded again behind it).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { values: opts } = parseArgs({ options: {
  delay: { type: 'string', default: '0' }, only: { type: 'string' }, shots: { type: 'string' }, keep: { type: 'boolean', default: false },
} });
const DELAY = Number(opts.delay);
/* a step is watched 3 s, and longer while the film loads again behind the picture (until it is shown, and 1 s on) */
const SAMPLE_MS = 3000, LOADING_MS = 30_000, EVERY_MS = 50;
/** the playhead: 1.4 s into the second video, under the page */
const AT = 7.4;

/* ── the film ── */
const scratch = mkdtempSync(join(tmpdir(), 'of-preview-probe-'));
const home = join(scratch, 'home');
const dir = join(scratch, 'film');
mkdirSync(join(dir, 'assets'), { recursive: true });
for (const [name, pattern, seconds] of [['a.mp4', 'testsrc', 6], ['b.mp4', 'testsrc2', 10], ['c.mp4', 'smptehdbars', 10]]) {
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `${pattern}=size=960x540:rate=30:duration=${seconds}`, '-pix_fmt', 'yuv420p', '-g', '30', join(dir, 'assets', name)]);
}
const TITLE = `<!doctype html><html><head><style>
  html, body { margin: 0; width: 1920px; height: 1080px; background: transparent; overflow: hidden }
  #headline { position: absolute; left: 160px; top: 120px; color: #fff; font: 700 120px system-ui; text-shadow: 0 4px 20px #000 }
</style></head><body><h1 id="headline">Hello there</h1>
<script>
const h = document.getElementById('headline');
window.film = { duration: 4, width: 1920, height: 1080, frame(t) { h.style.translate = (Math.min(1, t) * 40) + 'px 0'; } };
</script></body></html>`;
/** film.html, the second video's own attributes as given */
const filmOf = (b = '') => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920, height=1080">
</head>
<body>
<section>
  <iframe id="title" src="title.html#t=0,4" at="6.5"></iframe>
</section>
<section>
  <video id="a" src="assets/a.mp4#t=0,6" muted></video>
  <video id="b" src="assets/b.mp4#t=0,8" at="6" muted${b}></video>
  <video id="c" src="assets/c.mp4#t=0,8" at="20" muted></video>
</section>
</body>
</html>
`;
/** the film as each step starts: its film.html, and nothing else beside it */
function reset(film = filmOf()) {
  for (const extra of ['transitions', 'notes.txt']) rmSync(join(dir, extra), { recursive: true, force: true });
  writeFileSync(join(dir, 'title.html'), TITLE);
  writeFileSync(join(dir, 'film.html'), film);
}
reset();

/* ── Studio ── */
const port = await new Promise((done) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port; s.close(() => done(p)); });
});
const env = { ...process.env, OPENFILM_HOME: home, OPENFILM_STUDIO_PORT: String(port), OPENFILM_NO_BROWSER: '1', OPENFILM_NO_UPDATE_CHECK: '1' };
const opened = spawnSync(process.execPath, [join(ROOT, 'bin/openfilm.mjs'), 'open', dir], { env, encoding: 'utf8' });
const url = /Studio\s+(http\S+)/.exec(opened.stdout)?.[1];
if (!url) throw new Error(`Studio did not open the film:\n${opened.stdout}${opened.stderr}`);
const stopStudio = () => {
  try { process.kill(JSON.parse(readFileSync(join(home, 'run.json'), 'utf8')).pid); } catch { /* gone */ }
};
/* stopped halfway: its Studio goes too */
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopStudio(); process.exit(130); });

/* ── the browser ── */
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const lab = await browser.newPage();
await lab.setContent('<canvas id="c"></canvas>');
/** A picture, as 64 × 36 grays: how much of it is black, and the grays to compare. */
const analyze = (/** @type {string} */ b64) => lab.evaluate(async (b64) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const c = /** @type {HTMLCanvasElement} */ (document.getElementById('c'));
  c.width = 64; c.height = 36;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d', { willReadFrequently: true }));
  g.drawImage(img, 0, 0, 64, 36);
  const d = g.getImageData(0, 0, 64, 36).data;
  const grays = [];
  let dark = 0;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    grays.push(y);
    if (y < 18) dark++;
  }
  return { dark: dark / grays.length, grays };
}, b64);
const unlike = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;

/**
 * @typedef {import('playwright-core').Page} Page
 * @typedef {{ name: string, film?: string, setup?: (p: Editor) => Promise<void>, act: (p: Editor) => Promise<void> }} Step
 * @typedef {{ page: Page, playheadX: number, clipAt: () => Promise<string>, block: (id: string) => import('playwright-core').Locator }} Editor
 */

/** The editor on the film, the playhead at AT, settled. */
async function openEditor() {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  if (DELAY > 0) {
    await page.route(/\/assets\/[^?#]*\.mp4/, async (route) => {
      await new Promise((r) => setTimeout(r, DELAY));
      await route.continue().catch(() => {});
    });
  }
  await page.goto(url);
  await page.waitForSelector('.stage iframe');
  await page.waitForFunction(() => document.querySelectorAll('[data-block-id]').length >= 3);
  /* the picture is up (the cover over it gone) */
  await page.waitForFunction(() => !document.querySelector('.stage .cover, [data-viewer-picture] .text-sweep'), null, { timeout: 60_000 });
  await page.waitForTimeout(1500 + DELAY);
  /* the whole film on the timeline, then the playhead put where AT is, on the ruler above the clips */
  await page.mouse.click(5, 990);
  await page.keyboard.press('Shift+Z');
  await page.waitForTimeout(400);
  const ruler = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('[data-block-id]')];
    const a = /** @type {Element} */ (blocks.find((e) => e.getAttribute('data-block-id')?.startsWith('a#'))).getBoundingClientRect();
    return { x0: a.left, pxs: a.width / 6, y: Math.min(...blocks.map((e) => e.getBoundingClientRect().top)) - 56 };
  });
  const playheadX = ruler.x0 + ruler.pxs * AT;
  await page.mouse.click(playheadX, ruler.y);
  /* the viewer's clock says the playhead is there (mm:ss:ff), and the picture had time to draw it */
  await page.waitForFunction((at) => [...document.querySelectorAll('span.tabular-nums')].some((el) => el.textContent?.startsWith(`00:0${at}:`)), Math.floor(AT), { timeout: 10_000 });
  await page.waitForTimeout(DELAY > 0 ? 2000 + 3 * DELAY : 1500);
  const block = (/** @type {string} */ id) => page.locator(`[data-block-id="${id}"]`).first();
  /** the video clip under the playhead (its timeline block) */
  const clipAt = async () => {
    const id = await page.evaluate((x) => [...document.querySelectorAll('[data-block-kind="video"]')]
      .find((e) => { const r = e.getBoundingClientRect(); return r.left <= x + 3 && r.right > x + 3; })?.getAttribute('data-block-id'), playheadX);
    if (!id) throw new Error('no video under the playhead');
    return id;
  };
  return { page, playheadX, clipAt, block };
}

/** The picture's box on the page, and the picture in it. */
async function picture(/** @type {Page} */ page) {
  const box = async () => /** @type {{ x: number, y: number, width: number, height: number }} */ (await page.locator('.stage').first().boundingBox());
  const b = await box();
  const png = await page.screenshot({ clip: { x: b.x + 2, y: b.y + 2, width: b.width - 4, height: b.height - 4 } });
  const b2 = await box();
  /* the box moved while it was taken (a pane opening): not a picture of the film */
  const moved = Math.abs(b2.x - b.x) + Math.abs(b2.y - b.y) + Math.abs(b2.width - b.width) > 1;
  return { ...(await analyze(png.toString('base64'))), png, moved };
}
const loads = (/** @type {Page} */ page) => page.evaluate(() => [...document.querySelectorAll('.stage iframe')].map((f) => /** @type {HTMLIFrameElement} */ (f).src.split('load=')[1]).join('+'));

/** A number typed in the inspector's field `label`. */
async function typeIn(/** @type {Page} */ page, /** @type {string | RegExp} */ label, /** @type {string} */ value) {
  const field = page.getByLabel(label).first();
  await field.click();
  await field.fill(value);
  await field.press('Enter');
}
async function drag(/** @type {Page} */ page, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ dx) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 6 });
  await page.mouse.up();
}
const middle = async (/** @type {Editor} */ e, /** @type {string} */ id) => /** @type {{ x: number, y: number, width: number, height: number }} */ (await e.block(id).boundingBox());
/** A clip's trim handle on the timeline (its start or end). */
const handle = async (/** @type {Editor} */ e, /** @type {string} */ id, /** @type {'start' | 'end'} */ edge) => /** @type {{ x: number, y: number, width: number, height: number }} */ (await e.block(id).locator(`[data-trim="${edge}"]`).first().boundingBox());
const inFolder = (/** @type {string} */ name, /** @type {(text: string) => string} */ change) => writeFileSync(join(dir, name), change(readFileSync(join(dir, name), 'utf8')));

/** @type {Step[]} */
const STEPS = [
  { name: 'nothing', act: async () => {} },
  { name: 'inspector opened', act: async ({ page }) => { await page.locator('button[aria-label="Show inspector"]').click(); } },
  { name: 'clip selected (the inspector opens)', act: async (e) => { await e.block(await e.clipAt()).click(); } },
  {
    name: 'move: ⌥→ a frame',
    setup: async (e) => { await e.block(await e.clipAt()).click(); },
    act: async ({ page }) => { await page.keyboard.press('Alt+ArrowRight'); },
  },
  { name: 'move: dragged', act: async (e) => { const b = await middle(e, await e.clipAt()); await drag(e.page, b.x + b.width / 2, b.y + b.height / 2, 25); } },
  { name: 'trim: end dragged', act: async (e) => { const b = await handle(e, await e.clipAt(), 'end'); await drag(e.page, b.x + b.width / 2, b.y + b.height / 2, -40); } },
  { name: 'trim: start dragged', act: async (e) => { const b = await handle(e, await e.clipAt(), 'start'); await drag(e.page, b.x + b.width / 2, b.y + b.height / 2, 40); } },
  {
    name: 'split at the playhead (⌘B)',
    setup: async (e) => { await e.block(await e.clipAt()).click(); },
    act: async ({ page }) => { await page.keyboard.press('Meta+B'); },
  },
  {
    name: 'split, then undone (⌘Z)',
    setup: async (e) => { await e.block(await e.clipAt()).click(); await e.page.keyboard.press('Meta+B'); await e.page.waitForTimeout(2500 + 3 * DELAY); },
    act: async ({ page }) => { await page.keyboard.press('Meta+Z'); },
  },
  {
    name: 'delete (a clip off screen)',
    setup: async (e) => { await e.block('a#1.0').click(); },
    act: async ({ page }) => { await page.keyboard.press('Backspace'); },
  },
  {
    name: 'fade in (inspector)',
    setup: async (e) => { await e.block(await e.clipAt()).click(); },
    act: async ({ page }) => { await typeIn(page, 'Fade in', '3'); },
  },
  {
    name: 'opacity under a fade (inspector)',
    film: filmOf(` overrides='[{"fade":[3,0]}]'`),
    setup: async (e) => { await e.block(await e.clipAt()).click(); },
    act: async ({ page }) => { await typeIn(page, /^Opacity/, '80'); },
  },
  {
    name: 'corner radius (inspector)',
    setup: async (e) => { await e.block(await e.clipAt()).click(); },
    act: async ({ page }) => { await typeIn(page, /radius/i, '60'); },
  },
  {
    name: 'text typed in the picture',
    act: async ({ page }) => {
      const b = /** @type {{ x: number, y: number, width: number, height: number }} */ (await page.locator('.stage').first().boundingBox());
      await page.mouse.dblclick(b.x + b.width * 0.2, b.y + b.height * 0.26);
      await page.waitForTimeout(500);
      await page.keyboard.press('End');
      await page.keyboard.type('!');
      await page.keyboard.press('Enter');
    },
  },
  {
    name: 'dip to white (timeline menu)',
    setup: async (e) => { await e.block(await e.clipAt()).click(); },
    act: async (e) => {
      await e.block(await e.clipAt()).click({ button: 'right' });
      await e.page.getByRole('menuitem', { name: /At its start/ }).first().hover();
      await e.page.getByRole('menuitem', { name: /Dip to white/ }).first().click();
    },
  },
  { name: 'film.html written outside: a clip\'s style', act: async () => { inFolder('film.html', (t) => t.replace('<video id="a"', '<video id="a" style="opacity: 0.9"')); } },
  { name: 'film.html written outside: its head', act: async () => { inFolder('film.html', (t) => t.replace('</head>', '<style>#a { border-radius: 8px }</style>\n</head>')); } },
  { name: 'film.html written outside: the clip shown, another file', act: async () => { inFolder('film.html', (t) => t.replace('assets/b.mp4#t=0,8', 'assets/c.mp4#t=0,8')); } },
  {
    name: 'film.html written outside: a clip far off moved over it',
    act: async () => { inFolder('film.html', (t) => t.replace('  <video id="c" src="assets/c.mp4#t=0,8" at="20" muted></video>\n', '').replace('<section>\n  <video id="a"', '<section>\n  <video id="c" src="assets/c.mp4#t=0,8" at="7" muted></video>\n</section>\n<section>\n  <video id="a"')); },
  },
  { name: 'a page shown changed on disk', act: async () => { inFolder('title.html', (t) => t.replace('color: #fff', 'color: #ffe')); } },
  { name: 'another file written', act: async () => { writeFileSync(join(dir, 'notes.txt'), 'notes'); } },
];

const only = opts.only?.split(',');
const results = [];
try {
  for (const step of STEPS) {
    if (only && !only.some((o) => step.name.startsWith(o))) continue;
    reset(step.film);
    /** @type {Editor | undefined} */
    let e;
    try {
      e = await openEditor();
      await run(step, e);
    } catch (err) {
      console.log(`${step.name.padEnd(44)} could not be done: ${String(/** @type {Error} */ (err).message).split('\n')[0]}`);
      results.push({ step: step.name, failed: true });
      if (opts.shots && e) { mkdirSync(opts.shots, { recursive: true }); await e.page.screenshot({ path: join(opts.shots, `${step.name.replace(/\W+/g, '-')}.failed.png`) }); }
    } finally {
      await e?.page.close();
    }
  }
} finally {
  await browser.close();
  stopStudio();
  if (!opts.keep) rmSync(scratch, { recursive: true, force: true });
  else console.log(`kept: ${scratch}`);
}
process.exitCode = results.some((r) => r.black || r.wrong || r.failed) ? 1 : 0;

/** Do `step` in the editor `e`, and say what the picture did. */
async function run(/** @type {Step} */ step, /** @type {Editor} */ e) {
  await step.setup?.(e);
  await e.page.waitForTimeout(1200 + DELAY);
  const filmBefore = readFileSync(join(dir, 'film.html'), 'utf8');
  const before = await picture(e.page);
  const loadsBefore = await loads(e.page);
  await step.act(e);
  const t0 = Date.now();
  const samples = [];
  const seenLoads = new Set();
  let settledAt = 0;
  for (;;) {
    const p = await picture(e.page);
    const now = await loads(e.page);
    const at = Date.now() - t0;
    samples.push({ ...p, at });
    seenLoads.add(now);
    if (now.includes('+')) settledAt = 0;
    else if (!settledAt) settledAt = at;
    if ((at >= SAMPLE_MS && settledAt && at - settledAt >= 1000) || at >= LOADING_MS) break;
    await e.page.waitForTimeout(EVERY_MS - ((Date.now() - t0) % EVERY_MS));
  }
  await e.page.waitForTimeout(1000 + DELAY);
  const after = await picture(e.page);
  let black = 0, wrong = 0, counted = 0;
  const bad = [];
  for (const s of samples) {
    if (s.moved) continue;
    counted++;
    const isBlack = s.dark > 0.6 && s.dark > before.dark + 0.3 && s.dark > after.dark + 0.3;
    const isWrong = !isBlack && unlike(s.grays, before.grays) > 20 && unlike(s.grays, after.grays) > 20;
    if (isBlack) black++;
    if (isWrong) wrong++;
    if (isBlack || isWrong) bad.push(s);
  }
  if (opts.shots) {
    mkdirSync(opts.shots, { recursive: true });
    const slug = step.name.replace(/\W+/g, '-').replace(/^-|-$/g, '');
    writeFileSync(join(opts.shots, `${slug}.after.png`), after.png);
    for (const s of bad.slice(0, 4)) writeFileSync(join(opts.shots, `${slug}.${s.at}ms.png`), s.png);
  }
  const edited = readFileSync(join(dir, 'film.html'), 'utf8') !== filmBefore;
  const r = { step: step.name, black, wrong, counted, edited, loads: `${loadsBefore} → ${[...seenLoads].join(' → ')}`, settled: unlike(before.grays, after.grays).toFixed(1) };
  results.push(r);
  console.log(`${r.step.padEnd(44)} black ${String(black).padStart(2)}  wrong ${String(wrong).padStart(2)}  of ${counted}   film.html ${edited ? 'changed' : 'same   '}   loads ${r.loads}`);
}
