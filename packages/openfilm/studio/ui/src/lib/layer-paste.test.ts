import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elementAt, elementsOf, readSource, sourceBody } from './html-source.ts';
import { copyId, cssEscape, idsIn, pastedElsewhere, pastedPage, relativeTo, weighted, withoutPaste, withPaste, type PasteItem, type PasteLayer, type PasteTarget } from './layer-paste.ts';

const PAGE = `<!doctype html>
<html><head><style>#card{background:#c33} #title{color:#ff0}</style></head>
<body>
  <!-- a card <div> -->
  <div id="card" class="card">
    <h1 id="title">Hello</h1>
    <p class=sub>world<br>again</p>
    <svg><linearGradient id="g"/><rect fill="url(#g)"/><use href="#g"/><use xlink:href="#g"/></svg>
  </div>
  <p>Open paragraph
  <div id="dot"></div>
  <script>if (a < b && "</div>") go();</script>
</body></html>`;

test('a page\'s file read as it is written: comments, raw text, end tags left out, attributes quoted or not', () => {
  const body = sourceBody(readSource(PAGE));
  assert.deepEqual(elementsOf(body).map((e) => e.tag), ['div', 'p', 'div', 'script']);
  const card = elementAt(body, [0], ['div'])!;
  assert.equal(PAGE.slice(card.start, card.end).split('\n')[0], '<div id="card" class="card">');
  assert.ok(PAGE.slice(card.start, card.end).endsWith('</div>'));
  assert.deepEqual(elementsOf(card).map((e) => e.tag), ['h1', 'p', 'svg']);
  assert.equal(elementAt(body, [0, 1], ['div', 'p'])!.attrs[0]!.value, 'sub');
  assert.equal(elementAt(body, [1], ['p'])!.end, elementAt(body, [2], ['div'])!.start, 'a <p> left open ends at the next block');
  assert.equal(elementAt(body, [0, 0], ['div', 'div']), null, 'a step of another tag: not it');
});

test('as the browser reads it: rows in a <tbody>, <div/> left open, <noscript> and <template> as it has them', () => {
  const body = sourceBody(readSource('<body><table id="t"><tr><td><span id="cell">X</span></td></tr></table><div id="x"/></div><noscript><p>n</p></noscript><template><p>t</p></template><h1 class="t">Hi</h1></body>'));
  const tags = (e: ReturnType<typeof sourceBody>): unknown => [e.tag, elementsOf(e).map(tags)];
  assert.deepEqual(tags(body), ['body', [
    ['table', [['tbody', [['tr', [['td', [['span', []]]]]]]]]],
    ['div', []],
    ['noscript', [['p', []]]],
    ['template', []],
    ['h1', []],
  ]]);
  assert.ok(elementAt(body, [0, 0], ['table', 'tbody'])!.implied, 'the <tbody> is not in the file');
});

const layer = (over: Partial<PasteLayer> = {}): PasteLayer => ({
  at: '#card', tag: 'div', id: 'card', classes: ['card'], text: 'Hello worldagain',
  place: { position: 'static', left: 200, top: 100, width: 900, height: 500 },
  tweaks: [], ...over,
});
const CARD: PasteTarget = {
  path: [0], tags: ['div'],
  shape: { tag: 'div', children: [{ tag: 'h1', children: [] }, { tag: 'p', children: [{ tag: 'br', children: [] }] }, { tag: 'svg', children: [{ tag: 'linearGradient', children: [] }, { tag: 'rect', children: [] }, { tag: 'use', children: [] }, { tag: 'use', children: [] }] }] },
};

test('a copy written right after the layer: new ids and what names them, held in place and moved', () => {
  const out = pastedPage(PAGE, [{ layer: layer({ tweaks: [{ path: [0], tag: 'h1', text: 'Hi & bye', style: { fontSize: 48 } }, { path: [], tag: 'div', t: [10, 0] }] }), target: CARD }], 24)!;
  assert.deepEqual(out.ats, ['#card-copy']);
  const at = out.text.indexOf('<div id="card-copy"');
  const added = out.text.slice(at, out.text.indexOf('</div>', at) + 6);
  assert.ok(added.startsWith('<div id="card-copy" class="card" style="position: absolute; left: 200px; top: 100px; width: 900px; height: 500px; margin: 0; box-sizing: border-box; translate: 34px 24px">'), added);
  assert.ok(added.includes('<h1 id="title-copy" style="font-size: 48px">Hi &amp; bye</h1>'), added);
  assert.ok(added.includes('<linearGradient id="g-copy"/><rect fill="url(#g-copy)"/><use href="#g-copy"/><use xlink:href="#g-copy"/>'), added);
  assert.ok(added.includes('<p class=sub>world<br>again</p>'), 'what was not changed is written as it was');
  assert.equal(withoutPaste(out.text, out.inserted)?.text, PAGE, 'and taken out again, the page as it was');
});

test('several layers of one page: each found before any is written, so a selector counting them finds the right one', () => {
  const page = '<body>\n<div id="card">\n  <h1 class="line">One</h1>\n  <h1 class="line">Two</h1>\n</div>\n</body>';
  const line = (text: string, i: number): PasteItem => ({
    layer: layer({ at: `#card > h1.line:nth-of-type(${i + 1})`, tag: 'h1', id: null, classes: ['line'], text, place: { position: 'absolute', left: 0, top: 0, width: 10, height: 10 } }),
    target: { path: [0, i], tags: ['div', 'h1'], shape: { tag: 'h1', children: [] } },
  });
  const out = pastedPage(page, [line('One', 0), line('Two', 1)], 24)!;
  assert.deepEqual(out.ats, ['#line-copy', '#line-copy-2']);
  assert.equal(out.text, '<body>\n<div id="card">\n  <h1 class="line">One</h1>\n  <h1 id="line-copy" class="line" style="translate: 24px 24px">One</h1>'
    + '\n  <h1 class="line">Two</h1>\n  <h1 id="line-copy-2" class="line" style="translate: 24px 24px">Two</h1>\n</div>\n</body>');
  const card: PasteItem = { layer: layer(), target: { path: [0], tags: ['div'], shape: { tag: 'div', children: [{ tag: 'h1', children: [] }, { tag: 'h1', children: [] }] } } };
  assert.deepEqual(pastedPage(page, [card, line('One', 0)], 24)!.ats, ['#card-copy', ''], 'one inside another copied: with it');
  const over = pastedPage(out.text, [{ ...line('One', 0), over: { path: [0, 1], tags: ['div', 'h1'], shape: { tag: 'h1', children: [] } } }], 48)!;
  assert.ok(over.text.includes('<h1 id="line-copy" class="line" style="translate: 24px 24px">One</h1>\n  <h1 id="line-copy-3"'), 'pasted again: over the copy before');
  const last = pastedPage(page, [{ ...line('One', 0), place: { after: 1, siblings: ['h1', 'h1'] } }], 0)!;
  assert.ok(last.text.includes('<h1 class="line">Two</h1>\n  <h1 id="line-copy" class="line">One</h1>\n</div>'), 'at its place when asked');
  const first = pastedPage(page, [{ ...line('Two', 1), place: { after: -1, siblings: ['h1', 'h1'] } }], 0)!;
  assert.ok(first.text.startsWith('<body>\n<div id="card">\n  <h1 id="line-copy" class="line">Two</h1>'), first.text);
  const other = pastedPage(page, [{ ...line('One', 0), place: { after: 1, siblings: ['p', 'h1', 'h1'] } }], 0)!;
  assert.ok(other.text.includes('<h1 class="line">One</h1>\n  <h1 id="line-copy"'), 'the file has other elements beside it than the page as drawn: right after it');
});

test('a copy runs no code: its scripts and handlers go', () => {
  const page = '<head></head><body><div id="w" onclick="go()"><canvas id="c"></canvas><script>const ctx = 1;</script></div></body>';
  const out = pastedPage(page, [{
    layer: layer({ at: '#w', id: 'w', classes: [], place: { position: 'absolute', left: 0, top: 0, width: 1, height: 1 } }),
    target: { path: [0], tags: ['div'], shape: { tag: 'div', children: [{ tag: 'canvas', children: [] }, { tag: 'script', children: [] }] } },
  }], 0)!;
  assert.equal(out.text, '<head></head><body><div id="w" onclick="go()"><canvas id="c"></canvas><script>const ctx = 1;</script></div>\n<div id="w-copy"><canvas id="c-copy"></canvas></div></body>');
});

test('words written as the film writes them; a file\'s own line breaks; ids keep their numbers', () => {
  const page = '<body>\r\n<h1 id="h">Quiet<br><em>you</em> now</h1>\r\n</body>';
  const out = pastedPage(page, [{
    layer: layer({ at: '#h', tag: 'h1', id: 'h', classes: [], place: { position: 'absolute', left: 0, top: 0, width: 1, height: 1 }, tweaks: [{ path: [], tag: 'h1', text: 'Hello' }] }),
    target: { path: [0], tags: ['h1'], shape: { tag: 'h1', children: [{ tag: 'br', children: [] }, { tag: 'em', children: [] }] } },
  }], 0)!;
  assert.equal(out.text, '<body>\r\n<h1 id="h">Quiet<br><em>you</em> now</h1>\r\n<h1 id="h-copy">Hello<br><em>you</em></h1>\r\n</body>', 'its first run of words, the others taken away');
  assert.equal(copyId('step-1', new Set(['step-2'])), 'step-1-copy');
  assert.equal(copyId('step-1-copy', new Set(['step-1-copy'])), 'step-1-copy-2', 'a copy\'s copy named from the first');
});

test('a layer the file does not hold as the browser reads it (made by the page\'s code): no copy', () => {
  assert.equal(pastedPage(PAGE, [{ layer: layer(), target: { ...CARD, path: [5] } }], 24), null);
  assert.equal(pastedPage(PAGE, [{ layer: layer(), target: { ...CARD, shape: { tag: 'div', children: [] } } }], 24), null);
});

test('an element placed by the page already keeps its place and its own move; one without an id gets one', () => {
  const page = '<body><span class="tag" style="position:absolute;left:5px;translate:10px 0px">New</span></body>';
  const out = pastedPage(page, [{
    layer: layer({ at: 'body > span', tag: 'span', id: null, classes: ['tag'], place: { position: 'absolute', left: 5, top: 0, width: 30, height: 10 } }),
    target: { path: [0], tags: ['span'], shape: { tag: 'span', children: [] } },
  }], 24)!;
  assert.equal(out.ats[0], '#tag-copy');
  assert.equal(out.text, '<body><span class="tag" style="position:absolute;left:5px;translate:10px 0px">New</span>\n<span id="tag-copy" class="tag" style="position:absolute;left:5px;translate:10px 0px; translate: 34px 24px">New</span></body>');
});

test('a path named from a page: up and down from its folder', () => {
  assert.equal(relativeTo('scene.html', 'assets/a.png'), 'assets/a.png');
  assert.equal(relativeTo('scenes/two/scene.html', 'assets/a.png'), '../../assets/a.png');
  assert.equal(relativeTo('scenes/scene.html', 'scenes/img/a.png'), 'img/a.png');
});

test('into another page: the layer as it looks, last in its body, with new ids, its move kept, what it loads named from there', () => {
  const page = '<html><head></head><body>\n<h2 id="g-copy">Two</h2>\n</body></html>';
  const base = 'http://127.0.0.1:1/p1/';
  const shot = {
    html: `<div id="card" style="position: absolute; left: 10px; top: 20px; translate: 100px 0px; background-image: url(&quot;${base}assets/a%20b.png&quot;)"><img src="${base}assets/logo.png"><svg><linearGradient id="g"></linearGradient><rect fill="url(&quot;#g&quot;)"></rect></svg><a href="https://openfilm.dev">x</a></div>`,
    fonts: [`@font-face { font-family: Brand; src: url("${base}fonts/b.woff2"); }`],
    base,
  };
  const out = pastedElsewhere(page, 'scenes/two.html', [layer({ snapshot: shot })], 24, (p) => `pasted/p1/${p}`)!;
  assert.deepEqual(out.ats, ['#card-copy']);
  assert.equal(out.text, '<html><head><style>@font-face { font-family: Brand; src: url("../pasted/p1/fonts/b.woff2"); }</style>\n</head><body>\n<h2 id="g-copy">Two</h2>\n'
    + '<div id="card-copy" style="position: absolute; left: 10px; top: 20px; translate: 100px 0px; background-image: url(&quot;../pasted/p1/assets/a b.png&quot;); translate: 124px 24px">'
    + '<img src="../pasted/p1/assets/logo.png"><svg><linearGradient id="g-copy-2"></linearGradient><rect fill="url(&quot;#g-copy-2&quot;)"></rect></svg><a href="https://openfilm.dev">x</a></div>\n</body></html>');
  assert.equal(pastedElsewhere(page, 'two.html', [layer()], 0), null, 'copied before its look was known');
});

test('an undo of a page written since: what the paste wrote taken out, where it is, once; and put back for a redo', () => {
  const pieces = ['<b>COPY</b>', '<style>x</style>'];
  const page = '<style>x</style><a>x</a><b>COPY</b><i>agent</i>';
  const out = withoutPaste(page, pieces)!;
  assert.equal(out.text, '<a>x</a><i>agent</i>');
  assert.equal(withPaste(out.text, pieces, out.at), page);
  assert.equal(withoutPaste('<b>COPY</b><b>COPY</b>', ['<b>COPY</b>']), null, 'twice: not known which');
  assert.equal(withoutPaste('<a>x</a>', ['<b>COPY</b>']), null, 'gone');
});

test('what the page\'s rules give the layer and not its copy, and the copy and not it: rules of the copy, weighed as those, after their stylesheet', () => {
  const page = '<head><style>#col p:first-child { color: var(--accent) }</style><link rel="stylesheet" href="b.css"></head><body><div id="col"><p>A<b>!</b></p><p>B</p></div></body>';
  const out = pastedPage(page, [{
    layer: layer({ at: '#col > p:nth-of-type(1)', tag: 'p', id: null, classes: [], place: { position: 'absolute', left: 0, top: 0, width: 1, height: 1 } }),
    target: { path: [0, 0], tags: ['div', 'p'], shape: { tag: 'p', children: [{ tag: 'b', children: [] }] } },
    look: [
      { path: [], rules: [
        { sheet: 0, within: [], weight: [1, 1, 1], decls: [['color', 'var(--accent)'], ['animation', '1s both in']] },
        { sheet: 1, within: ['@media (min-width: 800px)'], weight: [0, 0, 1], decls: [['border-top-color', 'unset']] },
      ] },
      { path: [0], rules: [{ sheet: 0, within: [], weight: [0, 1, 0], decls: [['font-weight', '700']] }] },
    ],
  }], 0)!;
  assert.equal(out.text, '<head><style>#col p:first-child { color: var(--accent) }</style>'
    + '\n<style>:where(#p-copy)#p-copy:not(.openfilm-none):not(openfilm-none) { color: var(--accent); animation: 1s both in; } :where(#b-copy):not(.openfilm-none) { font-weight: 700; }</style>'
    + '<link rel="stylesheet" href="b.css"><style>@media (min-width: 800px) { :where(#p-copy):not(openfilm-none) { border-top-color: unset; } }</style>\n</head>'
    + '<body><div id="col"><p>A<b>!</b></p>\n<p id="p-copy">A<b id="b-copy">!</b></p><p>B</p></div></body>', 'as the rules write it: live, and weighed as they are');
  assert.equal(weighted('a', [2, 0, 3]), ':where(#a)#a#a:not(openfilm-none):not(openfilm-none):not(openfilm-none)');
});

test('ids are written as CSS writes them: a leading digit, a - and a digit, other signs', () => {
  assert.deepEqual(['1st', '-2x', '-', 'a.b c', 'déjà', 'ok_-9'].map(cssEscape), ['\\31 st', '-\\32 x', '\\-', 'a\\.b\\ c', 'déjà', 'ok_-9']);
  assert.equal(weighted('1st-copy', [1, 0, 0]), ':where(#\\31 st-copy)#\\31 st-copy');
  const page = '<head></head><body><p id="1st">A</p></body>';
  const out = pastedPage(page, [{
    layer: layer({ at: '#\\31 st', tag: 'p', id: '1st', classes: [], place: { position: 'absolute', left: 0, top: 0, width: 1, height: 1 } }),
    target: { path: [0], tags: ['p'], shape: { tag: 'p', children: [] } },
    look: [{ path: [], rules: [{ sheet: -1, within: [], weight: [1, 0, 1], decls: [['font-weight', '700']] }] }],
  }], 0)!;
  assert.equal(out.ats[0], '#\\31 st-copy', 'and the copy named so, to be selected');
  assert.ok(out.text.startsWith('<head><style>:where(#\\31 st-copy)#\\31 st-copy:not(openfilm-none) { font-weight: 700; }</style>'), out.text);
});

test('the ids a selector names, read as CSS reads them: escapes ended by a space or not, whole names only', () => {
  const ids = (sel: string) => idsIn(sel).map((t) => t.id);
  assert.deepEqual(ids('#\\31 '), ['1']);
  assert.deepEqual(ids('#\\31'), ['1'], 'its ending space trimmed off');
  assert.deepEqual(ids('#\\31 st > #-\\32 x:hover'), ['1st', '-2x']);
  assert.deepEqual(ids('#a\\.b, #a.c'), ['a.b', 'a']);
  assert.deepEqual(ids('#déjà [href="#a"] #a\\:b'), ['déjà', 'a:b'], 'not in quotes');
  /* a one-digit id's copy, named so */
  const digit = pastedPage('<head></head><body><p id="1">B</p></body>', [{
    layer: layer({ at: '#\\31 ', tag: 'p', id: '1', classes: [], place: { position: 'absolute', left: 0, top: 0, width: 1, height: 1 } }),
    target: { path: [0], tags: ['p'], shape: { tag: 'p', children: [] } },
  }], 0)!;
  assert.deepEqual(digit.ats, ['#\\31 -copy']);
});
