import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { BrowserMemoryError, MEMORY_MAX_MB, footprints, guard, memoryError, memoryExceeded, processesOf } from './browser-memory.mjs';
import { launch } from './host.mjs';

/** A browser as the guard sees one: it closes, and disconnects. */
function fakeBrowser() {
  const b = Object.assign(new EventEmitter(), { closed: 0, async close() { this.closed += 1; this.emit('disconnected'); } });
  return b;
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

test('a browser one of whose processes holds more than the most is ended, and says so; one under it is left', async () => {
  const heavy = fakeBrowser();
  let reads = 0;
  guard(/** @type {any} */ (heavy), '--openfilm-browser=test-heavy', { max: 1000, every: 10, read: async () => { reads += 1; return reads < 3 ? [200, 300] : [200, 1500] } });
  for (let i = 0; i < 100 && !heavy.closed; i += 1) await sleep(10);
  assert.equal(heavy.closed, 1, 'closed once');
  assert.equal(memoryExceeded(heavy), 1500);
  const error = memoryError(heavy);
  assert.ok(error instanceof BrowserMemoryError);
  assert.match(error.message, /took more memory than this computer can spare \(1\.5 GB/);
  const after = reads;
  await sleep(60);
  assert.equal(reads, after, 'no longer read');

  const light = fakeBrowser();
  let lightReads = 0;
  guard(/** @type {any} */ (light), '--openfilm-browser=test-light', { max: 1000, every: 10, read: async () => { lightReads += 1; return [900]; } });
  await sleep(80);
  assert.equal(light.closed, 0);
  assert.equal(memoryExceeded(light), null);
  assert.equal(memoryError(light), null);
  /* disconnected by itself: no longer watched */
  light.emit('disconnected');
  const seen = lightReads;
  await sleep(60);
  assert.equal(lightReads, seen);
});

test('the most a browser may hold is a quarter of the machine\'s memory, between 2 and 8 GB', () => {
  assert.ok(MEMORY_MAX_MB >= 2048 && MEMORY_MAX_MB <= 8192);
});

const watched = process.platform === 'darwin' || process.platform === 'linux';

test('a canvas drawn stroke by stroke through a blur stays a few hundred MB in the host\'s browser, its processes found and their memory read', { skip: !watched && 'memory not read on this system', timeout: 60_000 }, async () => {
  const browser = await launch();
  try {
    /* the browser's own process: the one started with the host's marker, under this one */
    const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n');
    const marker = rows.filter((r) => Number(r.trim().split(/\s+/)[1]) === process.pid).map((r) => r.match(/--openfilm-browser=[\w-]+/)?.[0]).find(Boolean);
    assert.ok(marker, 'started with its marker');
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.setContent('<canvas id="c" width="1920" height="1080"></canvas>');
    let peak = 0;
    let reading = true;
    const watch = (async () => {
      while (reading) {
        const sizes = [...(await footprints(await processesOf(/** @type {string} */ (marker)))).values()];
        assert.ok(sizes.length >= 2, 'the browser and the processes it started');
        peak = Math.max(peak, ...sizes);
        await sleep(100);
      }
    })();
    /* each stroke through its own blur: with Skia Graphite, gigabytes a frame */
    for (let frame = 0; frame < 3; frame += 1) {
      await page.evaluate((n) => {
        const g = /** @type {HTMLCanvasElement} */ (document.getElementById('c')).getContext('2d');
        g.fillStyle = '#345';
        g.fillRect(0, 0, 1920, 1080);
        g.filter = 'blur(2px)';
        for (let i = 0; i < 300; i += 1) {
          g.strokeStyle = `rgba(20, 20, 30, ${0.2 + (i % 5) / 10})`;
          g.lineWidth = 2 + (i % 4);
          g.beginPath();
          g.moveTo((i * 37 + n * 11) % 1920, 1080);
          g.quadraticCurveTo((i * 53) % 1920, 900, (i * 71) % 1920, 700 + (i % 9) * 20);
          g.stroke();
        }
        g.filter = 'none';
      }, frame);
      await page.screenshot({ type: 'jpeg' });
    }
    reading = false;
    await watch;
    assert.ok(peak > 20 && peak < 1500, `bounded: ${Math.round(peak)} MB at most`);
    assert.equal(memoryExceeded(browser), null);
  } finally {
    await browser.close();
  }
});
