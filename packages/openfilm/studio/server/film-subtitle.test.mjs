import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FILM_SUBTITLE_DEFAULT, FILM_SUBTITLE_HOME_Y, FILM_SUBTITLE_LOOKS, FILM_SUBTITLE_PORTRAIT_Y, FILM_SUBTITLE_SIZE_PCT,
  filmSubtitleAt, filmSubtitleCss, filmSubtitleCssText, filmSubtitleFrameHtml, filmSubtitleLanguageOf,
  filmSubtitleShown, filmSubtitleSrt, filmSubtitleStyleFor, filmSubtitleVtt, filmSubtitleWords, matchFilmSubtitleLook,
  parseFilmSubtitleStyle, sameFilmSubtitleLanguage,
} from './film-subtitle.mjs';

const D = FILM_SUBTITLE_DEFAULT;

test('a stored style is read field by field; the earlier { look, size } shape still reads', () => {
  assert.deepEqual(parseFilmSubtitleStyle(null), D);
  const old = parseFilmSubtitleStyle({ on: false, look: 'bar', size: 'lg' });
  assert.equal(old.on, false);
  assert.deepEqual(old.box, FILM_SUBTITLE_LOOKS.bar.box);
  assert.equal(old.font.sizePct, FILM_SUBTITLE_SIZE_PCT.lg);
  /* null turns a layer off; a missing one keeps the default */
  assert.equal(parseFilmSubtitleStyle({ stroke: null }).stroke, null);
  assert.deepEqual(parseFilmSubtitleStyle({}).stroke, D.stroke);
  assert.equal(parseFilmSubtitleStyle({ karaoke: { mode: 'nope' } }).karaoke?.mode, 'box');
  assert.equal(parseFilmSubtitleStyle({ align: 'middle', maxWidthPct: 5 }).align, 'center');
  assert.equal(parseFilmSubtitleStyle({ maxWidthPct: 5 }).maxWidthPct, 10);
});

test('a look is picked while the style is exactly it, at any size', () => {
  assert.equal(matchFilmSubtitleLook(D), 'outline');
  const bar = { ...D, ...FILM_SUBTITLE_LOOKS.bar };
  assert.equal(matchFilmSubtitleLook({ ...bar, font: { ...bar.font, sizePct: 7 } }), 'bar');
  assert.equal(matchFilmSubtitleLook({ ...bar, fill: '#ff0000' }), null);
});

test('the CSS grows away from the nearest edge and keeps the stroke outside the letters', () => {
  const low = filmSubtitleCss(D, { fontSize: '20px' });
  assert.equal(low.box.transform, 'translate(-50%, -100%)');
  assert.equal(low.text.marginBottom, '-0.725em');
  assert.equal(low.text.paintOrder, 'stroke fill');
  const high = filmSubtitleCss({ ...D, pos: { x: 0.5, y: 0.1 } }, { fontSize: '20px' });
  assert.equal(high.box.transform, 'translate(-50%, 0)');
  assert.ok(high.text.marginTop);
  const mid = filmSubtitleCss({ ...D, pos: { x: 0.5, y: 0.5 }, ...FILM_SUBTITLE_LOOKS.bar }, { fontSize: '20px' });
  assert.equal(mid.box.transform, 'translate(-50%, -50%)');
  assert.equal(mid.text.background, 'rgba(0,0,0,0.62)');
  assert.equal(filmSubtitleCss({ ...D, font: { ...D.font, family: 'Press Start 2P' } }, { fontSize: '1px' }).text.fontFamily.split(',')[0], '"Press Start 2P"');
  assert.equal(filmSubtitleCssText({ WebkitTextStrokeWidth: '1px', paintOrder: 'stroke fill' }), '-webkit-text-stroke-width:1px;paint-order:stroke fill');
});

test('on a vertical frame an unmoved subtitle rises above the feed\'s own buttons', () => {
  assert.equal(filmSubtitleStyleFor(D, { w: 1080, h: 1920 }).pos.y, FILM_SUBTITLE_PORTRAIT_Y);
  assert.equal(filmSubtitleStyleFor(D, { w: 1920, h: 1080 }).pos.y, FILM_SUBTITLE_HOME_Y);
  const moved = { ...D, pos: { x: 0.5, y: 0.5 } };
  assert.equal(filmSubtitleStyleFor(moved, { w: 1080, h: 1920 }), moved);
});

test('the shown line: the later one where two overlap; the picked language, or both', () => {
  const cues = [{ startMs: 0, durMs: 2000, text: 'a', alt: { fr: 'A' } }, { startMs: 1500, durMs: 1000, text: 'b' }];
  assert.equal(filmSubtitleAt(cues, 1600)?.text, 'b');
  assert.equal(filmSubtitleAt(cues, 2500), null);
  assert.deepEqual(filmSubtitleShown(cues, { language: 'fr', bilingual: false }).map((c) => c.text), ['A', 'b']);
  assert.deepEqual(filmSubtitleShown(cues, { language: 'fr', bilingual: true }).map((c) => c.text), ['a\nA', 'b']);
  assert.equal(filmSubtitleLanguageOf('今日はいい天気ですね'), 'ja');
  assert.equal(filmSubtitleLanguageOf('Hello there'), null);
  assert.ok(sameFilmSubtitleLanguage('pt', 'pt-BR'));
  assert.ok(!sameFilmSubtitleLanguage('zh', 'zh-TW'));
});

test('word highlight: the word being said, by its share of the line', () => {
  const cue = { startMs: 0, durMs: 1000, text: 'aa bb' };
  assert.deepEqual(filmSubtitleWords(cue, 100).filter((w) => w.active).map((w) => w.text), ['aa']);
  assert.deepEqual(filmSubtitleWords(cue, 700).filter((w) => w.active).map((w) => w.text), ['bb']);
  const timed = { ...cue, words: [{ text: 'aa', startMs: 0, durMs: 900 }, { text: 'bb', startMs: 900, durMs: 100 }] };
  assert.deepEqual(filmSubtitleWords(timed, 700).map((w) => w.text), ['aa', ' ', 'bb']);
  assert.equal(filmSubtitleWords(timed, 700)[0].active, true);
});

test('files: overlapping lines give way, speakers stay apart from the text', () => {
  const cues = [{ startMs: 1000, durMs: 2000, text: 'one', speaker: 'Ann' }, { startMs: 2500, durMs: 500, text: 'two' }, { startMs: 4000, durMs: 0, text: 'gone' }];
  assert.equal(filmSubtitleSrt(cues), '1\n00:00:01,000 --> 00:00:02,500\nAnn:one\n\n2\n00:00:02,500 --> 00:00:03,000\ntwo\n');
  assert.equal(filmSubtitleVtt(cues), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\n<v Ann>one\n\n00:00:02.500 --> 00:00:03.000\ntwo\n');
  assert.equal(filmSubtitleSrt([]), '');
});

test('a burned-in frame: the line in the frame\'s pixels, escaped, nothing when off or silent', () => {
  const cues = [{ startMs: 0, durMs: 1000, text: 'Tom & <Jerry>' }];
  const html = filmSubtitleFrameHtml(cues, D, { w: 1920, h: 1080 }, 500);
  assert.match(html, /^<div style="position:absolute;left:0;top:0;width:1920px;height:1080px;/);
  assert.match(html, /font-size:43px/);
  assert.match(html, /Tom &amp; &lt;Jerry&gt;/);
  assert.equal(filmSubtitleFrameHtml(cues, D, { w: 1920, h: 1080 }, 1500), '');
  assert.equal(filmSubtitleFrameHtml(cues, { ...D, on: false }, { w: 1920, h: 1080 }, 500), '');
  const karaoke = filmSubtitleFrameHtml([{ startMs: 0, durMs: 1000, text: 'aa bb' }], { ...D, karaoke: { mode: 'color', color: '#ff0000' } }, { w: 100, h: 100 }, 100);
  assert.match(karaoke, /<span style="color:#ff0000">aa<\/span> bb/);
});
