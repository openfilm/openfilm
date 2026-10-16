// openfilm capture: a picture of a live web page (a product, a site), sharp enough to fill a stage, taken in the browser
// OpenFilm draws films in, so a film can show the real thing instead of a drawing of it.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { launch } from './host.mjs';
import { shown, UsageError } from './shared.mjs';

/** The window when none is asked: a laptop's. */
const SIZE = '1440x900';

/**
 * One picture: the page loads and settles (its network idle, or 10 s at most), loses the elements asked hidden, gets
 * the clicks asked, in order, waits, and is taken: the window, the whole page (`full`) or one element (`selector`).
 * @param {string[]} args the address and the PNG to write
 * @param {{ size?: string, scale?: number, full?: boolean, wait?: string, dark?: boolean, click?: string[],
 *   hide?: string[], selector?: string, launch?: Parameters<typeof launch>[0] }} [opts]
 */
export async function capture(args, opts = {}) {
  const [url, out, ...more] = args;
  if (!url || !out || more.length) throw new UsageError('give the address and the picture to write: capture <url> <file.png>');
  if (!/^(https?|file):\/\//i.test(url)) throw new UsageError(`${url} is not a web address: give it whole, with https://`);
  if (!/\.png$/i.test(out)) throw new UsageError(`${out}: the picture is a .png`);
  const size = /^(\d{2,5})x(\d{2,5})$/.exec(opts.size ?? SIZE);
  if (!size) throw new UsageError(`--size is width x height in px, such as ${SIZE}, not ${opts.size}`);
  const wait = opts.wait === undefined ? 1500 : Number(opts.wait);
  if (!Number.isInteger(wait) || wait < 0 || wait > 60_000) throw new UsageError(`--wait is milliseconds from 0 to 60000, not ${opts.wait}`);
  const file = resolve(out);
  const browser = await launch(opts.launch);
  try {
    const page = await browser.newPage({
      viewport: { width: Number(size[1]), height: Number(size[2]) },
      deviceScaleFactor: opts.scale ?? 2,
      colorScheme: opts.dark ? 'dark' : 'light',
    });
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    /* a page that keeps a connection open never goes idle: wait a while, not forever */
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    /* a banner that is not there has nothing to hide; a click that cannot happen is an error: the view would be wrong */
    for (const sel of opts.hide ?? []) await page.locator(sel).evaluateAll((els) => els.forEach((el) => el.remove())).catch(() => {});
    for (const sel of opts.click ?? []) { await page.locator(sel).first().click({ timeout: 10_000 }); await page.waitForTimeout(600); }
    await page.waitForTimeout(wait);
    mkdirSync(dirname(file), { recursive: true });
    const png = opts.selector
      ? await page.locator(opts.selector).first().screenshot({ path: file, timeout: 10_000 })
      : await page.screenshot({ path: file, fullPage: Boolean(opts.full) });
    /* a PNG's width and height are the first two numbers of its header */
    return { ok: true, lines: [`${shown(file)}  ${png.readUInt32BE(16)} × ${png.readUInt32BE(20)} px`] };
  } finally {
    await browser.close();
  }
}
