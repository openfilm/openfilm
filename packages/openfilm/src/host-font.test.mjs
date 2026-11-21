import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOST_FLAG, launch } from './host.mjs';

/* A label whose size follows a camera: one size a frame, a thousandth of a pixel apart, measured in the order given.
   Chromium finds a font by its size in hundredths of a pixel, and for some neighbouring hundredths (9.72 and 9.73)
   by the same key, so the one used first is the one both are set in: the order shows in the widths. */
const SIZES = Array.from({ length: 900 }, (_, i) => 9.6 + i * 0.001);
const TEXT = 'ROOF EDGE ABOVE · FIELD OF PLAY 105 × 68 · NATURAL GRASS · MOWN 5.25';

/** The text's width at each size and the font the context says it has, in a new browser (no font used before). */
async function widths(sizes, { hosted }) {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    if (hosted) await page.addInitScript(HOST_FLAG);
    await page.goto('data:text/html,<canvas></canvas>');
    return await page.evaluate(({ sizes, text }) => {
      const c = document.querySelector('canvas').getContext('2d');
      return sizes.map((px) => { c.font = `${px}px monospace`; return [px, c.measureText(text).width, c.font]; });
    }, { sizes, text: TEXT });
  } finally { await browser.close(); }
}
const byKey = (rows) => new Map(rows.map(([px, width]) => [px, width]));

test('canvas text measures the same at a size whatever sizes were used before it', { timeout: 120_000 }, async (t) => {
  const up = await widths(SIZES, { hosted: true });
  const down = await widths([...SIZES].reverse(), { hosted: true });
  assert.deepEqual([...byKey(down)].reverse(), [...byKey(up)], 'growing or shrinking, each size has one width');
  /* every size is on the grid, and the context says so: sizes that round to one step are one size */
  const grid = new Map();
  for (const [px, width, font] of up) {
    const snapped = Math.round(px * 32) / 32;
    /* as Chromium writes a size: six significant digits */
    assert.equal(font, `${Number(snapped.toPrecision(6))}px monospace`, `${px}px reads back as the size it is set in`);
    if (grid.has(snapped)) assert.equal(width, grid.get(snapped));
    grid.set(snapped, width);
  }
  const steps = [...grid].sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i][1] >= steps[i - 1][1], `${steps[i][0]}px is no narrower than ${steps[i - 1][0]}px`);

  /* the browser alone, to know the test still sees what it guards against */
  const plainUp = byKey(await widths(SIZES, { hosted: false })), plainDown = byKey(await widths([...SIZES].reverse(), { hosted: false }));
  const moved = SIZES.filter((px) => plainUp.get(px) !== plainDown.get(px)).length;
  t.diagnostic(moved ? `without the host's script ${moved} of ${SIZES.length} sizes measure differently by order`
    : 'this Chromium measures every size the same in either order: FONT_GRID may no longer be needed');
});

test('the font a page gives a 2D context: only a px size is changed', { timeout: 60_000 }, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(HOST_FLAG);
    await page.goto('data:text/html,<canvas style="font-size:20px"></canvas>');
    const seen = await page.evaluate(() => {
      const on = document.querySelector('canvas').getContext('2d'), off = new OffscreenCanvas(8, 8).getContext('2d');
      const read = (c, font) => { c.font = '10px serif'; c.font = font; return c.font; };
      return {
        camera: read(on, '9.725153065026827px monospace'),
        offscreen: read(off, '9.725153065026827px monospace'),
        whole: read(on, 'italic 700 20.385px/1.2 Georgia, serif'),
        readBack: (() => { on.font = '10.016px serif'; const first = on.font; on.font = first; return [first, on.font]; })(),
        asIs: read(on, '600 28px monospace'),
        em: read(on, '1.2345em serif'),
        quoted: read(on, '1.5em "Font 12.3px", serif'),
        notAFont: read(on, 'nonsense'),
        twice: Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font').set.__film === true,
      };
    });
    assert.deepEqual(seen, {
      camera: '9.71875px monospace',
      offscreen: '9.71875px monospace',
      whole: 'italic bold 20.375px Georgia, serif',
      /* 10.03125 px, read as 10.0313: given back to the context, it is the same size again */
      readBack: ['10.0313px serif', '10.0313px serif'],
      asIs: '600 28px monospace',
      em: '24.69px serif',
      quoted: '30px "Font 12.3px", serif',
      notAFont: '10px serif',
      twice: true,
    });
  } finally { await browser.close(); }
});
