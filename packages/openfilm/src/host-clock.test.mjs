import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOST_FLAG, launch } from './host.mjs';

test('a hosted page reads the frame\'s t from every clock once drawing starts', { timeout: 60_000 }, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(HOST_FLAG);
    await page.goto(`data:text/html,${encodeURIComponent('<style>i{display:block;animation:a 4s linear}@keyframes a{from{width:0}to{width:400px}}</style><i></i>')}`);
    const seen = await page.evaluate(async () => {
      const loading = [typeof Date(), new Date(2020, 0, 1).getFullYear(), new Date() instanceof Date, Date.now() > 1.7e12];
      const first = Math.random();
      window.filmHost.time(2.5); window.filmHost.settle(2.5);
      const at = { date: Date.now() - Date.UTC(2026, 0, 1), perf: performance.now(), iso: new Date().toISOString(), random: Math.random() };
      window.filmHost.time(0.5); window.filmHost.time(2.5);
      const again = Math.random();
      const raf = await new Promise((r) => requestAnimationFrame(r));
      const width = getComputedStyle(document.querySelector('i')).width;
      return { loading, first, at, again, raf, width, real: window.filmHost.now() > 0 };
    });
    assert.deepEqual(seen.loading, ['string', 2020, true, true]);
    await page.reload();
    assert.equal(await page.evaluate(() => Math.random()), seen.first, 'loading draws from a fixed seed');
    assert.deepEqual([seen.at.date, seen.at.perf, seen.at.iso], [2500, 2500, '2026-01-01T00:00:02.500Z']);
    assert.equal(seen.again, seen.at.random, 'the same t, the same random numbers');
    assert.equal(seen.raf, 2500);
    assert.equal(seen.width, '250px');
    assert.ok(seen.real);
  } finally { await browser.close(); }
});
