import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOST_FLAG, folderFiles, launch } from '../../src/host.mjs';
import { filmHtml } from '../../src/film-doc.mjs';
import { cssEscape, pastedPage } from '../ui/src/lib/layer-paste.ts';

const STAGE = readFileSync(new URL('./stage.js', import.meta.url), 'utf8');

/**
 * The same place, to half a pixel: what the stage holds a layer to (stage.js holdSearch), since a page's own widths are
 * whole pixels while its words are laid out in fractions of one, as each system draws its fonts.
 */
const samePlace = (now, was, message) => assert.ok(now.every((v, i) => Math.abs(v - was[i]) < 0.5), `${message} (${JSON.stringify(now)}, was ${JSON.stringify(was)})`);

/** A film served with Studio's stage in it, the page itself standing in for the editor (its own origin). */
async function stageOf(dir, query = '') {
  let files = null;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!files(req, res, url.pathname, url.searchParams)) res.writeHead(403).end();
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const origin = `http://127.0.0.1:${server.address().port}`;
  files = folderFiles(dir, { timelineInject: `<script>${HOST_FLAG}</script><script>${STAGE.replaceAll('__EDITOR__', JSON.stringify(origin))}</script>` });
  const browser = await launch();
  const close = async () => { await browser.close(); server.closeAllConnections?.(); server.close(); };
  const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
  /* a setup that fails closes what it opened: a browser left open keeps the test file, and the run, from ending */
  try {
    await page.goto(`${origin}/film.html${query}`);
    /* window.film may not be there yet when the page has loaded */
    await page.waitForFunction(() => Boolean(window.film));
    await page.evaluate(async () => { await window.film.ready; await window.film.frame(0.5); });
  } catch (e) {
    await close();
    throw e;
  }
  let seq = 0;
  /** Ask the stage what the editor asks it. */
  const ask = (op, args) => page.evaluate(({ op, args, seq }) => new Promise((done) => {
    const hear = (e) => {
      if (e.data?.source !== 'openfilm-film' || e.data.type !== 'stage' || e.data.seq !== seq) return;
      window.removeEventListener('message', hear);
      done(e.data.error ? { error: e.data.error } : e.data.result);
    };
    window.addEventListener('message', hear);
    window.postMessage({ source: 'openfilm-studio', type: 'stage', seq, op, ...args }, '*');
  }), { op, args, seq: ++seq });
  return { ask, page, close, browser };
}

test('a click on a page\'s backdrop (a box filling the page) takes the clip, not the box; a smaller box is taken', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-stage-backdrop-'));
  writeFileSync(join(dir, 'logistics.html'), `<!doctype html><body style="margin:0">
<div id="root" style="position:absolute;inset:0;background:#f7f1e9">
  <h1 id="title" style="position:absolute;left:20px;top:20px;margin:0;font:700 24px sans-serif">Every parcel</h1>
  <div id="card" style="position:absolute;left:200px;top:100px;width:80px;height:50px;background:#f60"></div>
</div>
<script>window.film={duration:2,frame(){}}</script></body>`);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'logistics', src: 'logistics.html' }] }] }));
  const stage = await stageOf(dir);
  try {
    assert.equal(await stage.ask('hit', { x: 150, y: 160, detail: true }), null, 'the empty part: no layer, so the clip is taken');
    assert.equal((await stage.ask('hit', { x: 40, y: 30, detail: true }))?.label, 'Every parcel');
    const card = await stage.ask('hit', { x: 240, y: 125, detail: true });
    assert.equal(card?.kind, 'box', 'a box smaller than the page is a layer');
    /* with Alt, the layers under the point in turn: the backdrop is one of them, and once in hand a click keeps it */
    const root = await stage.ask('hit', { x: 240, y: 125, cycleFrom: card.handle, detail: true });
    assert.equal(root?.kind, 'box');
    assert.notEqual(root.handle, card.handle);
    assert.equal((await stage.ask('hit', { x: 150, y: 160, from: root.handle, detail: true }))?.handle, root.handle);
  } finally {
    await stage.close();
  }
});

test('handles are counted from the load of the film: one kept from an earlier load names nothing, and the layer is found by its selector', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-stage-handles-'));
  writeFileSync(join(dir, 'card.html'), `<!doctype html><body style="margin:0">
  <h1 id="title" style="position:absolute;left:20px;top:20px;margin:0;font:700 24px sans-serif">Every parcel</h1>
  <div id="card" style="position:absolute;left:200px;top:100px;width:80px;height:50px;background:#f60"></div>
<script>window.film={duration:2,frame(){}}</script></body>`);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'card', src: 'card.html' }] }] }));
  const stage = await stageOf(dir, '?load=3');
  try {
    const title = await stage.ask('hit', { x: 40, y: 30, detail: true });
    const card = await stage.ask('hit', { x: 240, y: 125, detail: true });
    assert.ok(title.handle > 3 * 2 ** 32 && card.handle > 3 * 2 ** 32, 'counted from the load');
    /* the card's handle in the first load of the film was a small number, maybe the title's here once: never now */
    const kept = await stage.ask('layer', { handle: card.handle - 3 * 2 ** 32, clip: card.clip, at: card.at, n: card.n });
    assert.equal(kept?.handle, card.handle, 'found by its selector: the card, not another layer');
    assert.equal(kept?.kind, 'box');
  } finally {
    await stage.close();
  }
});

test('a click on a title under a full-frame overlay (letterbox, vignette) takes the title; on nothing but the overlay, the clip', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-stage-overlay-'));
  writeFileSync(join(dir, 'title.html'), `<!doctype html><body style="margin:0">
<h1 id="title" style="position:absolute;left:20px;top:60px;margin:0;font:700 24px sans-serif">On the road</h1>
<script>window.film={duration:2,frame(){}}</script></body>`);
  writeFileSync(join(dir, 'lens.html'), `<!doctype html><body style="margin:0">
<div id="vignette" style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 50%,transparent 55%,rgba(0,0,0,.45))"></div>
<div id="top" style="position:absolute;left:0;right:0;top:0;height:20px;background:#000"></div>
<script>window.film={duration:2,frame(){}}</script></body>`);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'lens', src: 'lens.html' }] }, { clips: [{ id: 'title', src: 'title.html' }] }] }));
  const stage = await stageOf(dir);
  try {
    const title = await stage.ask('hit', { x: 50, y: 72, detail: true });
    assert.equal(title?.text?.value, 'On the road', 'through the overlay, the words under it');
    assert.equal(title?.clip, 'title');
    assert.equal((await stage.ask('hit', { x: 50, y: 72, from: title.handle, detail: true }))?.handle, title.handle, 'in hand, a click on it keeps it');
    assert.equal((await stage.ask('hit', { x: 150, y: 10, detail: true }))?.clip, 'lens', 'the overlay\'s own bar is its layer');
    assert.equal(await stage.ask('hit', { x: 250, y: 150, detail: true }), null, 'nothing but the overlay there: the clip is taken');
  } finally {
    await stage.close();
  }
});

test('a line typed in place starts with all of its words selected; a click on them moves the caret, though something unseen lies over them', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-stage-select-'));
  writeFileSync(join(dir, 'title.html'), `<!doctype html><body style="margin:0">
<h1 id="title" style="position:absolute;left:20px;top:20px;margin:0;font:700 24px monospace">Every parcel</h1>
<div id="later" style="position:absolute;left:0;top:0;width:320px;height:90px;opacity:0">3800</div>
<script>window.film={duration:2,frame(){}}</script></body>`);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'title', src: 'title.html' }] }] }));
  const stage = await stageOf(dir);
  try {
    const title = await stage.ask('hit', { x: 40, y: 30, detail: true });
    assert.equal(await stage.ask('textStart', { handle: title.handle }), true);
    const page = stage.page.frames().find((f) => f.url().endsWith('title.html'));
    const state = () => page.evaluate(() => {
      const s = document.getSelection();
      return { typing: document.getElementById('title').isContentEditable, selected: s.toString(), collapsed: s.isCollapsed };
    });
    assert.deepEqual(await state(), { typing: true, selected: 'Every parcel', collapsed: false });
    /* on the words, under the unseen box: the caret moves there, the line is still typed in */
    await stage.page.mouse.click(80, 34);
    assert.deepEqual(await state(), { typing: true, selected: '', collapsed: true });
    /* elsewhere: let go */
    await stage.page.mouse.click(250, 150);
    assert.equal((await state()).typing, false);
  } finally {
    await stage.close();
  }
});

test('a line typed in place tells the editor its words as they are typed, and kept at Enter', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-stage-typing-'));
  writeFileSync(join(dir, 'title.html'), `<!doctype html><body style="margin:0">
<h1 id="title" style="position:absolute;left:20px;top:20px;margin:0;font:700 24px monospace">Every parcel</h1>
<script>window.film={duration:2,frame(){}}</script></body>`);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'title', src: 'title.html' }] }] }));
  const stage = await stageOf(dir);
  try {
    await stage.page.evaluate(() => {
      window.heard = [];
      window.addEventListener('message', (e) => { if (e.data?.source === 'openfilm-film' && e.data.type === 'stage-event') window.heard.push(e.data); });
    });
    const title = await stage.ask('hit', { x: 40, y: 30, detail: true });
    assert.equal(await stage.ask('textStart', { handle: title.handle }), true);
    /* all of its words selected: the first key replaces them */
    for (const ch of 'Box') await stage.page.keyboard.type(ch);
    await stage.page.keyboard.press('Enter');
    await stage.page.waitForFunction(() => window.heard.some((e) => e.event === 'text'));
    const heard = await stage.page.evaluate(() => window.heard.map(({ event, handle, value, commit }) => ({ event, handle, value, commit })));
    assert.deepEqual(heard.filter((e) => e.event === 'typing').map((e) => [e.handle, e.value]), [[title.handle, 'B'], [title.handle, 'Bo'], [title.handle, 'Box']]);
    assert.deepEqual(heard.at(-1), { event: 'text', handle: title.handle, value: 'Box', commit: true });
  } finally {
    await stage.close();
  }
});

test('a click on words takes them, though a line drawn behind runs across its own box there', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-stage-line-'));
  writeFileSync(join(dir, 'net.html'), `<!doctype html><body style="margin:0">
<svg style="position:absolute;left:0;top:0" width="320" height="180"><line x1="100" y1="40" x2="130" y2="70" stroke="#888" stroke-width="2"/></svg>
<div id="card" style="position:absolute;left:30px;top:40px;width:200px;height:60px;background:rgba(255,255,255,.07)">
  <h3 id="name" style="margin:0;font:600 30px sans-serif;width:200px">Cloud</h3>
</div>
<script>window.film={duration:2,frame(){}}</script></body>`);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'net', src: 'net.html' }] }] }));
  const stage = await stageOf(dir);
  try {
    /* (125, 45): inside the line's box (100…130 × 40…70, smaller than the words'), off its stroke, on the words */
    assert.equal((await stage.ask('hit', { x: 125, y: 45, detail: true }))?.text?.value, 'Cloud');
    /* on the stroke itself: the line, the smaller of what is there */
    assert.equal((await stage.ask('hit', { x: 115, y: 55, detail: true }))?.kind, 'shape');
  } finally {
    await stage.close();
  }
});

test('a title with its subtitle written inside it: its own words are a layer, typed over with the subtitle still shown', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-stage-own-words-'));
  writeFileSync(join(dir, 'title.html'), `<!doctype html><body style="margin:0">
<div id="title" style="position:absolute;left:20px;top:20px;font:700 40px sans-serif;line-height:1.15">Test video<div id="sub" style="font:400 14px sans-serif;margin-top:10px">picture · motion</div></div>
<script>window.film={duration:2,frame(){}}</script></body>`);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'title', src: 'title.html' }] }] }));
  const stage = await stageOf(dir);
  try {
    const title = await stage.ask('hit', { x: 40, y: 40, detail: true });
    assert.equal(title?.kind, 'text');
    assert.equal(title?.text?.value, 'Test video');
    assert.equal((await stage.ask('hit', { x: 40, y: 82, detail: true }))?.text?.value, 'picture · motion');
    assert.equal(await stage.ask('textStart', { handle: title.handle }), true);
    const page = stage.page.frames().find((f) => f.url().endsWith('title.html'));
    const sub = () => page.evaluate(() => { const el = document.getElementById('sub'); return { shown: getComputedStyle(el).visibility, style: el.getAttribute('style') }; });
    assert.equal((await sub()).shown, 'visible', 'the subtitle stays while the title is typed');
    await stage.page.mouse.click(250, 150);
    assert.deepEqual(await sub(), { shown: 'visible', style: 'font:400 14px sans-serif;margin-top:10px' });
  } finally {
    await stage.close();
  }
});

test('a title with its subtitle inside it: its box hugs its own words, and moved or restyled the subtitle stays as it was', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-stage-own-box-'));
  writeFileSync(join(dir, 'title.html'), `<!doctype html><body style="margin:0">
<div id="title" style="position:absolute;left:20px;top:20px;font:700 40px sans-serif;line-height:1.15;color:#fff">Test video<div id="sub" style="font-size:14px;margin-top:10px">picture · motion</div></div>
<script>window.film={duration:2,frame(){}}</script></body>`);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'title', src: 'title.html' }] }] }));
  const stage = await stageOf(dir);
  try {
    const page = stage.page.frames().find((f) => f.url().endsWith('title.html'));
    const subNow = () => page.evaluate(() => {
      const el = document.getElementById('sub');
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left * 10) / 10, y: Math.round(r.top * 10) / 10, w: Math.round(r.width * 10) / 10, color: getComputedStyle(el).color };
    });
    const title = await stage.ask('hit', { x: 40, y: 40, detail: true });
    /* the box is the words', not the subtitle's too */
    assert.ok(title.rect.height < 50, `the box hugs the words (${title.rect.height})`);
    /* beside the words, on the title's box but on no word: not the title */
    assert.notEqual((await stage.ask('hit', { x: 250, y: 40, detail: true }))?.text?.value, 'Test video');
    const was = await subNow();
    assert.equal(await stage.ask('tweak', { clip: 'title', at: '#title', patch: { t: [30, 12] } }), true);
    assert.deepEqual(await subNow(), was, 'moved, the subtitle stays');
    assert.equal(await stage.ask('tweak', { clip: 'title', at: '#title', patch: { style: { color: '#ff0000', fontSize: '60px' } } }), true);
    const after = await subNow();
    assert.equal(after.color, was.color, 'recolored, the subtitle keeps its color');
    /* its words start where they did (its block is as wide as the title, which grew) */
    assert.ok(Math.abs(after.x - was.x) < 0.2 && Math.abs(after.y - was.y) < 0.2, `restyled, the subtitle stays (${JSON.stringify(after)})`);
    /* scaled and turned: the subtitle neither grows nor turns */
    const flat = await subNow();
    assert.equal(await stage.ask('tweak', { clip: 'title', at: '#title', patch: { s: 1.5, r: 20 } }), true);
    const turned = await subNow();
    for (const k of ['x', 'y', 'w']) assert.ok(Math.abs(turned[k] - flat[k]) < 0.5, `scaled and turned, the subtitle stays (${k}: ${flat[k]} → ${turned[k]})`);
    /* what is written with the title's edit: the subtitle's override */
    const riders = await stage.ask('riders', { clip: 'title', at: '#title', patch: { t: [30, 12] } });
    assert.deepEqual(riders.map((r) => r.at), ['#sub']);
    assert.ok(riders[0].patch.t && riders[0].patch.style?.color);
  } finally {
    await stage.close();
  }
});

test('words drawn in a fill of their page\'s own (gold words) say so; recolored with it taken over, they are drawn in the new color and the block inside keeps its own', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-stage-text-fill-'));
  writeFileSync(join(dir, 'title.html'), `<!doctype html><head><style>.gold{color:#b39458!important;-webkit-text-fill-color:#b39458}</style></head><body style="margin:0">
<h1 id="head" class="gold" style="position:absolute;left:20px;top:20px;margin:0;font:700 40px sans-serif">Only you<div id="sub" style="font-size:14px">for yourself</div></h1>
<p id="plain" style="position:absolute;left:20px;top:120px;margin:0;font:20px sans-serif;color:#fff">Plain</p>
<script>window.film={duration:2,frame(){}}</script></body>`);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'title', src: 'title.html' }] }] }));
  const stage = await stageOf(dir);
  try {
    const page = stage.page.frames().find((f) => f.url().endsWith('title.html'));
    const drawn = (id) => page.evaluate((id) => getComputedStyle(document.getElementById(id)).webkitTextFillColor, id);
    const head = await stage.ask('hit', { x: 40, y: 40, detail: true });
    assert.equal(head.style.color, '#b39458');
    assert.equal(head.style.WebkitTextFillColor, '#b39458', 'its fill is told, though it is the color it has now');
    const plain = await stage.ask('hit', { x: 30, y: 130, detail: true });
    assert.equal(plain.style.WebkitTextFillColor, undefined, 'words drawn in their color have no fill of their own');
    assert.equal(await page.evaluate(() => document.getElementById('plain').getAttribute('style')), 'position:absolute;left:20px;top:120px;margin:0;font:20px sans-serif;color:#fff', 'looked at, its style is as it was');

    const subWas = await drawn('sub');
    const patch = { style: { color: '#ff0000', WebkitTextFillColor: 'currentcolor' } };
    const riders = await stage.ask('riders', { clip: 'title', at: '#head', patch });
    assert.deepEqual(riders.map((r) => r.at), ['#sub']);
    assert.equal(riders[0].patch.style?.WebkitTextFillColor, subWas, 'the block inside keeps the fill it was drawn in');
    assert.equal(await stage.ask('tweak', { clip: 'title', at: '#head', patch }), true);
    assert.equal(await drawn('head'), 'rgb(255, 0, 0)', 'drawn in the new color');
    assert.equal((await stage.ask('hit', { x: 40, y: 40, detail: true })).style.WebkitTextFillColor, undefined, 'taken over, its fill follows its color');
  } finally {
    await stage.close();
  }
});

test('a layer restyled leaves the others where they are, and takes its new size: the words beside a number stay put', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-stage-hold-'));
  writeFileSync(join(dir, 'row.html'), `<!doctype html><body style="margin:0">
<div id="row" style="position:absolute;left:10px;top:40px;display:flex;align-items:baseline;gap:10px">
  <b id="num" style="font:700 60px monospace;line-height:1">18</b><span id="words" style="font:600 20px sans-serif">founders</span>
</div>
<p id="below" style="position:absolute;left:10px;top:120px;margin:0">a dream</p>
<script>window.film={duration:2,frame(){}}</script></body>`);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'row', src: 'row.html' }] }] }));
  const stage = await stageOf(dir);
  try {
    const page = stage.page.frames().find((f) => f.url().endsWith('row.html'));
    const place = () => page.evaluate(() => {
      const w = document.getElementById('words').getBoundingClientRect();
      const n = document.getElementById('num');
      return { words: [Math.round(w.left * 10) / 10, Math.round(w.top * 10) / 10], num: [n.offsetWidth, n.offsetHeight] };
    });
    const was = await place();
    for (const style of [{ fontSize: '90px' }, { lineHeight: '2' }, { letterSpacing: '12px' }]) {
      assert.equal(await stage.ask('tweak', { clip: 'row', at: '#num', patch: { style } }), true);
      const now = await place();
      samePlace(now.words, was.words, `the words beside it did not move (${JSON.stringify(style)})`);
      assert.notDeepEqual(now.num, was.num, `the number took its new size (${JSON.stringify(style)})`);
      await stage.ask('release', { clip: 'row' });
    }
    /* a size the person sets is meant to move what is around it */
    assert.deepEqual(await stage.ask('hold', { clip: 'row', at: '#num', style: { width: '200px' } }), {});
  } finally {
    await stage.close();
  }
});

test('a hold kept before gives way: the number set back smaller takes its own size, and the words stay', { timeout: 60_000 }, async () => {
  const page = (overrides) => `<!doctype html><body style="margin:0">
<div id="row" style="position:absolute;left:10px;top:40px;display:flex;align-items:baseline;gap:10px">
  <b id="num" style="font:700 60px monospace;line-height:1">18</b><span id="words" style="font:600 20px sans-serif">founders</span>
</div>
<script>window.film={duration:2,frame(){}}</script></body>`;
  /* first, what holding the words in place takes at 90px */
  const dir = mkdtempSync(join(tmpdir(), 'of-stage-rehold-'));
  writeFileSync(join(dir, 'row.html'), page());
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'row', src: 'row.html' }] }] }));
  let stage = await stageOf(dir);
  const read = (st) => st.page.frames().find((f) => f.url().endsWith('row.html')).evaluate(() => {
    const w = document.getElementById('words').getBoundingClientRect();
    return { words: [Math.round(w.left * 10) / 10, Math.round(w.top * 10) / 10], num: document.getElementById('num').offsetWidth };
  });
  let held;
  let plain;
  try {
    plain = await read(stage);
    held = await stage.ask('hold', { clip: 'row', at: '#num', style: { fontSize: '90px' } });
    assert.ok(Object.keys(held).length);
  } finally {
    await stage.close();
  }
  /* kept so; then set back to 60px: the margins of 90px go, the number is as wide as its words again */
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'row', src: 'row.html', overrides: [{ at: '#num', style: { fontSize: '90px', ...held } }] }] }] }));
  stage = await stageOf(dir);
  try {
    const kept = await read(stage);
    samePlace(kept.words, plain.words, 'kept with its hold, the words are where they were');
    const back = await stage.ask('hold', { clip: 'row', at: '#num', style: { fontSize: '60px' } });
    for (const k of Object.keys(held).filter((key) => key.startsWith('margin'))) assert.equal(back[k], null, `${k} taken away`);
    assert.equal(await stage.ask('tweak', { clip: 'row', at: '#num', patch: { style: { fontSize: '60px', ...back } } }), true);
    const now = await read(stage);
    assert.deepEqual(now, plain, 'as it was before any change: the words in place, the number its own width');
  } finally {
    await stage.close();
  }
});

test('words in a block as wide as their box restyled: the box hugs them, they stay centered where they were', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-stage-fit-'));
  writeFileSync(join(dir, 'card.html'), `<!doctype html><body style="margin:0">
<div id="card" style="position:absolute;left:20px;top:20px;width:260px">
  <h3 id="title" style="margin:0;font:600 20px sans-serif;text-align:center">Cloud</h3>
  <p id="line" style="margin:6px 0 0;font:14px sans-serif">built on its own</p>
</div>
<script>window.film={duration:2,frame(){}}</script></body>`);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'card', src: 'card.html' }] }] }));
  const stage = await stageOf(dir);
  try {
    const page = stage.page.frames().find((f) => f.url().endsWith('card.html'));
    const read = () => page.evaluate(() => {
      const t = document.getElementById('title');
      const words = document.createRange();
      words.selectNodeContents(t);
      const w = words.getBoundingClientRect();
      const line = document.getElementById('line').getBoundingClientRect();
      return { box: t.offsetWidth, words: Math.round(w.width), center: Math.round(w.left + w.width / 2), line: [line.left, line.top] };
    });
    const was = await read();
    assert.equal(was.box, 260, 'as wide as the card');
    assert.equal(await stage.ask('tweak', { clip: 'card', at: '#title', patch: { style: { fontSize: '30px' } } }), true);
    const now = await read();
    assert.ok(Math.abs(now.box - now.words) <= 1, `the box hugs the words (${now.box} for ${now.words})`);
    assert.ok(Math.abs(now.center - was.center) <= 1, `still centered where they were (${now.center}, was ${was.center})`);
    samePlace(now.line, was.line, 'the line under them did not move');
  } finally {
    await stage.close();
  }
});

test('more words leave the others where they are: previewed, and typed in place', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-stage-words-'));
  writeFileSync(join(dir, 'row.html'), `<!doctype html><body style="margin:0">
<div id="row" style="position:absolute;left:10px;top:40px;display:flex;align-items:baseline;gap:10px">
  <b id="num" style="font:700 40px monospace;line-height:1">18</b><span id="words" style="font:600 20px sans-serif">founders</span>
</div>
<script>window.film={duration:2,frame(){}}</script></body>`);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'row', src: 'row.html' }] }] }));
  const stage = await stageOf(dir);
  try {
    const page = stage.page.frames().find((f) => f.url().endsWith('row.html'));
    const read = () => page.evaluate(() => {
      const w = document.getElementById('words').getBoundingClientRect();
      const n = document.getElementById('num');
      return { words: [Math.round(w.left * 10) / 10, Math.round(w.top * 10) / 10], num: n.textContent, width: n.offsetWidth };
    });
    const was = await read();
    assert.equal(await stage.ask('tweak', { clip: 'row', at: '#num', patch: { text: '1999' } }), true);
    const previewed = await read();
    assert.equal(previewed.num, '1999');
    assert.ok(previewed.width > was.width, 'its box took the longer words');
    samePlace(previewed.words, was.words, 'the words beside it did not move');
    await stage.ask('release', { clip: 'row' });
    /* typed in place: the same as each key goes */
    const num = await stage.ask('hit', { x: 20, y: 60, detail: true });
    assert.equal(await stage.ask('textStart', { handle: num.handle }), true);
    await stage.page.keyboard.type('2026');
    const typing = await read();
    assert.equal(typing.num, '2026');
    samePlace(typing.words, was.words, 'typing, the words beside it stay');
    await stage.ask('textFinish', { commit: true });
    samePlace((await read()).words, was.words, 'kept, they stay');
  } finally {
    await stage.close();
  }
});

test('a picture inside a page says what it draws: an <img>, a box painted with one, a frame holding one <img>, and a file put there', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-stage-picture-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
  for (const name of ['a.png', 'b.png', 'c.png']) writeFileSync(join(dir, name), png);
  writeFileSync(join(dir, 'p.html'), `<!doctype html><body style="margin:0">
<img id="solo" src="a.png" style="position:absolute;left:10px;top:10px;width:60px;height:40px">
<div id="painted" style="position:absolute;left:90px;top:10px;width:60px;height:40px;background:url(b.png) center/cover"></div>
<div id="frame" style="position:absolute;left:170px;top:10px;width:60px;height:40px;background:#222"><img src="a.png" style="width:100%;height:100%;object-fit:cover"></div>
<div id="pair" style="position:absolute;left:10px;top:100px;width:140px;height:60px;background:#222"><img src="a.png" style="width:70px;height:60px"><img src="b.png" style="width:70px;height:60px"></div>
<script>window.film={duration:2,frame(){}}</script></body>`);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'p', src: 'p.html', overrides: [{ at: '#frame > img', style: { content: 'url("c.png")' } }] }] }] }));
  const stage = await stageOf(dir);
  try {
    const solo = await stage.ask('hit', { x: 40, y: 30, detail: true });
    assert.equal(solo?.picture?.kind, 'img');
    assert.match(solo.picture.src, /\/a\.png$/);
    assert.equal(solo.picture.changed, false);
    assert.equal(solo.picture.at, undefined, 'its own picture: the file goes on it');
    const painted = await stage.ask('hit', { x: 120, y: 30, detail: true });
    assert.equal(painted?.picture?.kind, 'bg');
    assert.match(painted.picture.src, /\/b\.png$/);
    /* a frame around a photo (what a click takes first when something else is in it): its picture is the <img> in it,
       which the file was put on */
    const frame = await stage.ask('layer', { clip: 'p', loc: '#frame', any: true });
    assert.equal(frame?.kind, 'box');
    assert.equal(frame?.picture?.kind, 'img');
    assert.equal(frame.picture.at, '#frame > img');
    assert.match(frame.picture.src, /\/c\.png$/, 'the file put there, not its own');
    assert.equal(frame.picture.changed, true);
    const pair = await stage.ask('layer', { clip: 'p', loc: '#pair', any: true });
    assert.ok(pair && !pair.picture, 'a box of two pictures is no one picture');
  } finally {
    await stage.close();
  }
});

test('a deleted layer has no row in the Layers tree; what points only at it or inside it is found', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-stage-delete-'));
  writeFileSync(join(dir, 'card.html'), `<!doctype html><body style="margin:0">
<div id="card" style="position:absolute;left:20px;top:20px;width:200px;height:120px;background:#f60">
  <h1 id="title" style="margin:0;font:700 24px sans-serif">Every parcel</h1>
  <p class="note" style="margin:0;font:14px sans-serif">On time</p>
</div>
<p class="note" style="position:absolute;left:240px;top:20px;margin:0;font:14px sans-serif">Elsewhere</p>
<script>window.film={duration:2,frame(){}}</script></body>`);
  const overrides = [{ at: '#card', style: { display: 'none' } }, { at: '#title', t: [4, 0] }];
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'card', src: 'card.html', overrides }] }] }));
  const stage = await stageOf(dir);
  try {
    const labels = (rows) => rows.flatMap((r) => [r.label, ...labels(r.children)]);
    const tree = await stage.ask('tree');
    const shown = labels(tree[0].layers);
    assert.ok(shown.includes('Elsewhere'), 'the layer outside it keeps its row');
    assert.ok(!shown.includes('Every parcel') && !shown.includes('On time'), 'neither it nor what is inside it has a row');
    const within = await stage.ask('within', {
      clip: 'card',
      of: [{ at: '#card' }],
      targets: [{ at: '#card' }, { at: '#title' }, { at: '.note' }, { at: '.note', n: 1 }, { at: '.note', n: 2 }, { at: '#nothing' }, {}],
    });
    assert.deepEqual(within, [true, true, false, true, false, false, false]);
  } finally {
    await stage.close();
  }
});

test('a layer to be written into its page or another: where it is laid out, the changes in it, and how it looks', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-stage-source-'));
  writeFileSync(join(dir, 'card.html'), `<!doctype html><head><style>
#title, p { letter-spacing: 1px } @supports (display: grid) { @layer base { #title b { color: rgb(255, 0, 0) } } }
#col > p:nth-child(3) { color: rgb(0, 128, 0) }
</style></head><body style="margin:0">
<div id="col" style="position:absolute;left:10px;top:10px;width:200px">
  <h1 id="title" style="margin:0 0 4px;font:700 20px sans-serif" onclick="go()">Every <b>parcel</b></h1>
  <p class="note" style="margin:0">On time</p>
  <p class="note" style="margin:0">Late</p>
  <svg id="logo" width="20" height="10"><linearGradient id="g"/><rect fill="url(#g)" width="20" height="10"/></svg>
</div>
<script>window.film={duration:2,frame(){}}</script></body>`);
  const overrides = [{ at: '#title b', style: { color: 'blue' } }, { at: '#col > p:nth-of-type(2)', t: [4, 0] }, { at: '.note', n: 2, text: 'Very late' }];
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'card', src: 'card.html', overrides }] }] }));
  const stage = await stageOf(dir);
  try {
    const [title, late, logo] = await stage.ask('layerSource', { clip: 'card', of: [{ at: '#title' }, { at: '.note', n: 2 }, { at: '#logo' }] });
    assert.deepEqual([title.at, title.tag, title.id, title.text], ['#title', 'h1', 'title', 'Every parcel']);
    assert.deepEqual([title.place.position, title.place.left, title.place.top], ['static', 0, 0]);
    assert.deepEqual(title.tweaks, [{ path: [0], tag: 'b', style: { color: 'blue' } }]);
    assert.equal(late.text, 'Late', 'its words as the page has them, not as the clip changed them');
    assert.ok(logo.place && logo.place.width === 20 && logo.place.height === 10 && Number.isFinite(logo.place.left), `an <svg> is measured too (${JSON.stringify(logo.place)})`);
    assert.match(title.snapshot.html, /^<h1 id="title" style="[^"]*position: absolute; left: 10px; top: 10px;[^"]*">Every <b style="[^"]*color: rgb\(0, 0, 255\)/);
    assert.ok(!/ class=|onclick/.test(title.snapshot.html), 'no class (another page\'s CSS does not reach it), no handler');
    assert.match(logo.snapshot.html, /id="g"/, 'its ids kept, to be made new ones where it goes');
    /* copies of both notes: the first's goes after the second (right after it, the page's :nth-child(3) would color
       the other), and nothing the clip points at is another element then */
    const after = await stage.ask('afterCopy', { clip: 'card', of: [{ at: '#col > p:nth-of-type(1)' }, { at: '#col > p:nth-of-type(2)' }] });
    const kids = ['h1', 'p', 'p', 'svg'];
    assert.deepEqual([after.places, after.moved], [[{ after: 2, siblings: kids }, { after: 2, siblings: kids }], [null, null, null]]);
  } finally {
    await stage.close();
  }
});

test('a layer the page\'s code moved in it: known by its words as the page has them', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-stage-moved-'));
  writeFileSync(join(dir, 'card.html'), `<!doctype html><body style="margin:0"><div id="col"><p class="note">First in file</p><p class="note">Second in file</p></div>
<script>document.getElementById('col').prepend(Object.assign(document.createElement('p'), { className: 'note', textContent: 'made by script' }));
window.film={duration:2,frame(){}}</script></body>`);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'card', src: 'card.html' }] }] }));
  const stage = await stageOf(dir);
  try {
    const [layer] = await stage.ask('layerSource', { clip: 'card', of: [{ at: '#col > p.note:nth-of-type(2)' }] });
    assert.equal(layer.text, 'First in file');
  } finally {
    await stage.close();
  }
});

test('a copy written right after a layer: what the clip counted after it points at what it found', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-stage-after-'));
  writeFileSync(join(dir, 'card.html'), `<!doctype html><body style="margin:0"><div id="col"><p id="a">A</p><p id="b">B</p><p>C</p></div>
<script>window.film={duration:2,frame(){}}</script></body>`);
  const overrides = [{ at: '#col > p:nth-of-type(3)', style: { color: 'red' } }, { at: 'p', n: 2, t: [4, 0] }];
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'card', src: 'card.html', overrides }] }] }));
  const stage = await stageOf(dir);
  try {
    const after = await stage.ask('afterCopy', { clip: 'card', of: [{ at: '#a' }, { at: '#b' }] });
    assert.deepEqual([after.places, after.moved], [[{ after: 0, siblings: ['p', 'p', 'p'] }, { after: 1, siblings: ['p', 'p', 'p'] }], ['#col > p:nth-of-type(5)', '#b']], 'both copies counted at once');
  } finally {
    await stage.close();
  }
});

test('a copy goes where the page\'s CSS draws nothing beside it otherwise: not where a :last-child or :nth-child would move', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-stage-place-'));
  writeFileSync(join(dir, 'card.html'), `<!doctype html><head><style>#col p:nth-child(2) { color: rgb(255, 0, 0) } #col p:last-child { color: rgb(0, 128, 0) }</style></head>
<body style="margin:0"><div id="col"><p id="a">A</p><p id="b">B</p><p id="c">C</p></div><script>window.film={duration:2,frame(){}}</script></body>`);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'card', src: 'card.html' }] }] }));
  const stage = await stageOf(dir);
  try {
    const siblings = ['p', 'p', 'p'];
    assert.deepEqual((await stage.ask('afterCopy', { clip: 'card', of: [{ at: '#a' }] })).places, [{ after: 1, siblings }], 'A: after B');
    assert.deepEqual((await stage.ask('afterCopy', { clip: 'card', of: [{ at: '#c' }] })).places, [{ after: 1, siblings }], 'C: before it');
    assert.deepEqual((await stage.ask('afterCopy', { clip: 'card', of: [{ at: '#b' }] })).places, [{ after: 1, siblings }], 'B: right after it');
    /* and so drawn: B red, C green, with a copy of A written there */
    const colors = await stage.page.evaluate(() => {
      const doc = document.querySelector('iframe').contentDocument;
      const copy = doc.getElementById('a').cloneNode(true);
      copy.id = 'a-copy';
      doc.getElementById('b').after(copy);
      const out = ['b', 'c'].map((id) => getComputedStyle(doc.getElementById(id)).color);
      copy.remove();
      return out;
    });
    assert.deepEqual(colors, ['rgb(255, 0, 0)', 'rgb(0, 128, 0)']);
  } finally {
    await stage.close();
  }
});

/**
 * A paste into its own page, as the editor makes it (layerSource, afterCopy, lib/layer-paste pastedPage), the page
 * then drawn as written: per element asked, `props` of it and of its copy, and the color of every other element.
 */
async function pastedLook(css, body, id, props, at = 0.5, pseudos = []) {
  const dir = mkdtempSync(join(tmpdir(), 'of-stage-look-'));
  const page = `<!doctype html><head><style>${css}</style></head><body style="margin:0">${body}<script>window.film={duration:2,frame(){}}</script></body>`;
  writeFileSync(join(dir, 'card.html'), page);
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'card', src: 'card.html' }] }] }));
  const stage = await stageOf(dir);
  try {
    const [layer] = await stage.ask('layerSource', { clip: 'card', of: [{ at: `#${cssEscape(id)}` }] });
    const after = await stage.ask('afterCopy', { clip: 'card', of: [{ at: `#${cssEscape(id)}` }] });
    const target = await stage.page.evaluate((id) => {
      const doc = document.querySelector('iframe').contentDocument;
      const shapeOf = (el) => ({ tag: el.localName, children: [...el.children].map(shapeOf) });
      const el = doc.getElementById(id);
      const path = [];
      const tags = [];
      for (let n = el; n !== doc.body; n = n.parentElement) { path.unshift([...n.parentElement.children].indexOf(n)); tags.unshift(n.localName); }
      return { path, tags, shape: shapeOf(el) };
    }, id);
    const out = pastedPage(page, [{ layer, target, place: after.places[0], look: after.looks[0] }], 0);
    const drawn = await stage.browser.newPage();
    try {
      await drawn.setContent(out.text);
      return await drawn.evaluate(({ id, props, at, pseudos }) => {
        for (const a of document.getAnimations()) { a.pause(); a.currentTime = at * 1000; }
        const look = (el) => [
          ...props.map((p) => getComputedStyle(el).getPropertyValue(p)),
          ...pseudos.map((pe) => { const cs = getComputedStyle(el, pe); return `${pe} ${cs.content} ${cs.color} ${cs.fontSize}`; }),
        ];
        const deep = (el) => [...el.querySelectorAll('*')].map((n) => look(n).join(' '));
        const copy = document.getElementById(`${id}-copy`);
        const others = [...document.querySelectorAll('body *:not(script)')].filter((e) => !e.closest('[id$="-copy"]')).map((e) => `${e.id || e.localName}:${getComputedStyle(e).color}`);
        return { el: look(document.getElementById(id)), copy: look(copy), inside: [deep(document.getElementById(id)), deep(copy)], others };
      }, { id, props, at, pseudos });
    } finally { await drawn.close(); }
  } finally {
    await stage.close();
  }
}

test('a copy looks as its original where the page\'s rules give it a look by its place, and the others stay as they were', { timeout: 120_000 }, async () => {
  const col = '<div id="col"><p id="a">A<b>!</b></p><p id="b">B</p><p id="c">C</p></div>';
  const cases = [
    ['first-child, last-child, p + p', '#col p:first-child{color:red} #col p:last-child{color:green} #col > p + p{border-top:2px solid blue}', ['a', 'c'], ['color', 'border-top-width']],
    ['a heavier rule still wins', '#col p:first-child{color:red} #col #a{color:blue}', ['a'], ['color']],
    ['a rule only the copy gets: what it would inherit', '#col{color:rgb(200, 100, 0)} #col p + p{color:blue}', ['a'], ['color']],
    ['a rule only the copy gets, against a shorthand', '#col p{border:2px solid red} #col p + p{border-top-color:blue}', ['a'], ['border-top-color', 'border-top-width']],
    ['in a @media, weighed as written', '@media (min-width: 1px){ #col p:first-child{color:red} } #col p{color:blue}', ['a'], ['color']],
    ['in a @layer', '@layer base { #col p:first-child{color:red} } #col p{color:blue}', ['a'], ['color']],
    ['nested', '#col { & p:first-child{color:red} }', ['a'], ['color']],
    ['nested id rule', '#col { & #a{color:red} }', ['a'], ['color']],
    ['!important', '#col p:first-child{color:red !important} #col #a{color:blue}', ['a'], ['color']],
    ['a rule of its id, a rule naming it in :not()', '#a{font-weight:700} #col p:not(#a){color:blue}', ['a'], ['color', 'font-weight']],
    ['an id rule of what is in it, in its at-rules', '@supports (display: grid) { @layer base { #a b{color:red} } } #col b{color:blue}', ['a'], ['color']],
  ];
  for (const [name, css, ids, props] of cases) {
    for (const id of ids) {
      const before = await pastedLook(css, col, 'b', ['color']).then((x) => x.others);
      const seen = await pastedLook(css, col, id, props);
      assert.deepEqual(seen.copy, seen.el, `${name}: the copy of ${id} looks as ${id}`);
      assert.deepEqual(seen.inside[1], seen.inside[0], `${name}: and what is in it`);
      assert.deepEqual(seen.others, before, `${name}: the others as they were`);
    }
  }
});

test('an id starting with a digit: the copy\'s rules find it, its id rules are said again of it', { timeout: 60_000 }, async () => {
  const seen = await pastedLook('#col p:first-child{color:red} #\\31 st{font-weight:700}', '<div id="col"><p id="1st">A</p><p id="b">B</p></div>', '1st', ['color', 'font-weight']);
  assert.deepEqual(seen.copy, seen.el);
  assert.deepEqual(seen.el, ['rgb(255, 0, 0)', '700']);
});

test('a one-digit id, and an id with a dot: the copy keeps its id rules, and only its own', { timeout: 60_000 }, async () => {
  const one = await pastedLook('#\\31 {font-weight:700} #col p:first-child{color:red}', '<div id="col"><p id="1">A</p><p id="b">B</p></div>', '1', ['color', 'font-weight']);
  assert.deepEqual(one.copy, one.el);
  assert.deepEqual(one.el, ['rgb(255, 0, 0)', '700']);
  const dot = await pastedLook('#a\\.b{color:blue} #a{font-weight:700}', '<div id="col"><p id="a">A</p><p id="a.b">B</p></div>', 'a', ['color', 'font-weight']);
  assert.deepEqual(dot.copy, dot.el);
  assert.ok(dot.others.includes('a.b:rgb(0, 0, 255)'), 'the other one as it was');
});

test('a copy keeps the rules of its pseudo-elements: ::before, ::after, ::first-letter, ::marker, ::placeholder, ::selection', { timeout: 120_000 }, async () => {
  const pseudos = ['::before', '::after', '::first-letter', '::marker', '::placeholder', '::selection'];
  const cases = [
    ['of its id', '#a::before{content:"\\2605";color:red} #a::after{content:"!"} #a::first-letter{font-size:30px} #a::selection{color:green}', '<div id="col"><p id="a">A</p><p id="b">B</p></div>', 'a'],
    ['by its place', '#col p:first-child::before{content:"1. "} #col p + p::after{content:" (more)"}', '<div id="col"><p id="a">A</p><p id="b">B</p></div>', 'a'],
    ['a list\'s marker', '#lst li:first-child::marker{color:red}', '<ul id="lst"><li id="a">A</li><li id="b">B</li></ul>', 'a'],
    ['a field\'s placeholder', '#in::placeholder{color:red}', '<div id="col"><input id="in" placeholder="Name"></div>', 'in'],
  ];
  for (const [name, css, body, id] of cases) {
    const seen = await pastedLook(css, body, id, ['color'], 0.5, pseudos);
    assert.deepEqual(seen.copy, seen.el, `${name}: the copy's pseudo-elements as its original's`);
  }
});

test('a rule of what names an id in the copy (a label\'s for) finds the copy\'s, renamed as it is', { timeout: 60_000 }, async () => {
  const seen = await pastedLook('label[for="x"]{color:purple} a[href="#x"]{font-weight:700}', '<div id="col"><div id="f"><label for="x">Name</label><a href="#x">go</a><input id="x"></div></div>', 'f', ['color', 'font-weight']);
  assert.deepEqual(seen.inside[1], seen.inside[0]);
  assert.ok(seen.inside[0][0].startsWith('rgb(128, 0, 128)'), seen.inside[0][0]);
});

test('what a copy keeps from its original\'s place stays live: var(), currentColor and an animation', { timeout: 60_000 }, async () => {
  const css = ':root{--accent: rgb(255, 0, 0)} @keyframes in { from { opacity: 0 } to { opacity: 1 } } #col p:first-child { color: var(--accent); border: 2px solid currentColor; animation: in 1s linear both }';
  const col = '<div id="col"><p id="a">A</p><p id="b">B</p></div>';
  for (const at of [0.25, 0.75]) {
    const seen = await pastedLook(css, col, 'a', ['color', 'border-top-color', 'opacity'], at);
    assert.deepEqual(seen.copy, seen.el, `at ${at}s`);
    assert.equal(seen.el[2], String(at));
  }
});

test('a copy whose id needs escaping is found by the selector a paste says (to be selected)', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-stage-select-'));
  writeFileSync(join(dir, 'card.html'), '<!doctype html><body style="margin:0"><p id="1st-copy">A</p><p id="a:b-copy">B</p><script>window.film={duration:2,frame(){}}</script></body>');
  writeFileSync(join(dir, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'card', src: 'card.html' }] }] }));
  const stage = await stageOf(dir);
  try {
    for (const id of ['1st-copy', 'a:b-copy']) {
      const layer = await stage.ask('layer', { clip: 'card', loc: `#${cssEscape(id)}`, any: true });
      assert.equal(layer?.label, id === '1st-copy' ? 'A' : 'B', id);
    }
  } finally {
    await stage.close();
  }
});
