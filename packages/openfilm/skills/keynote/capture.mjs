#!/usr/bin/env node
// Screenshots of a real product page, sharp enough to fill a stage: the headless browser OpenFilm itself renders with.
//
//   node capture.mjs <url> <out.png> [--size 1440x900] [--scale 2] [--full] [--wait 1500] [--dark]
//                    [--click <css selector>]… [--hide <css selector>]… [--selector <css selector>]
//
// --full    the whole page, top to bottom (for a slow scroll in the film)
// --click   click these first, in order (a tab, a menu, "Try it")
// --hide    remove these first (cookie banners, chat bubbles)
// --selector  only this element (a panel, a card)
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const [url, out] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.match(/^--(size|scale|wait|click|hide|selector)$/));
if (!url || !out) {
  console.error('usage: node capture.mjs <url> <out.png> [--size 1440x900] [--scale 2] [--full] [--wait 1500] [--dark] [--click sel]… [--hide sel]… [--selector sel]');
  process.exit(2);
}
const one = (name, d) => { const i = args.indexOf(`--${name}`); return i < 0 ? d : args[i + 1]; };
const many = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const [width, height] = one('size', '1440x900').split('x').map(Number);

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('No headless browser here: run this from the skill folder inside the openfilm package, or take the screenshots yourself.');
  process.exit(1);
}
const browser = await chromium.launch({ headless: true, args: ['--hide-scrollbars'] });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: +one('scale', '2'), colorScheme: args.includes('--dark') ? 'dark' : 'light' });
  await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
  /* a page that keeps a connection open never goes idle: wait a while, not forever */
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  for (const sel of many('hide')) await page.locator(sel).evaluateAll((els) => els.forEach((el) => el.remove())).catch(() => {});
  for (const sel of many('click')) { await page.locator(sel).first().click({ timeout: 10_000 }); await page.waitForTimeout(600); }
  await page.waitForTimeout(+one('wait', '1500'));
  mkdirSync(dirname(out) || '.', { recursive: true });
  const selector = one('selector', null);
  if (selector) await page.locator(selector).first().screenshot({ path: out });
  else await page.screenshot({ path: out, fullPage: args.includes('--full') });
  console.log(out);
} finally {
  await browser.close();
}
