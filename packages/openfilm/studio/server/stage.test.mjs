import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOST_FLAG, folderFiles, launch } from '../../src/host.mjs';
import { filmHtml } from '../../src/film-doc.mjs';

const STAGE = readFileSync(new URL('./stage.js', import.meta.url), 'utf8');

/**
 * The same place, to half a pixel: what the stage holds a layer to (stage.js holdSearch), since a page's own widths are
 * whole pixels while its words are laid out in fractions of one, as each system draws its fonts.
 */
const samePlace = (now, was, message) => assert.ok(now.every((v, i) => Math.abs(v - was[i]) < 0.5), `${message} (${JSON.stringify(now)}, was ${JSON.stringify(was)})`);

/** A film served with Studio's stage in it, the page itself standing in for the editor (its own origin). */
async function stageOf(dir) {
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
    await page.goto(`${origin}/film.html`);
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
  return { ask, page, close };
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
