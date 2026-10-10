import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUBTITLE_SEGMENT_RULES, alignTranslation, replacePiece, segmentLine, subtitleCells, subtitleEnd } from './subtitle-segments.mjs';

/** The subtitles of a line as printed. */
const texts = (pieces) => pieces.map((p) => subtitleEnd(p.text));
const cut = (text, endMs = 3000, marks, rules) => segmentLine({ text, startMs: 0, endMs, ...(marks ? { marks } : {}) }, rules);

/**
 * A line as a voice says it, timed word by word as TTS times it: a CJK character or a Latin word per mark, at a
 * speaking pace, a comma or full stop a short pause. `pauses`: extra silence before the word at that text index.
 */
function spoken(text, pauses = {}) {
  const marks = [];
  let at = 0;
  for (const m of text.matchAll(/[A-Za-z0-9.']+|[一-鿿]|[，。、！？,.!?]/g)) {
    if (/^[，。、！？,.!?]$/.test(m[0])) { at += 250; continue; }
    at += pauses[m.index] ?? 0;
    marks.push({ index: m.index, startMs: at });
    at += /^[一-鿿]$/.test(m[0]) ? 220 : 70 * m[0].length;
  }
  return { text, startMs: 0, endMs: at + 300, marks };
}

/** Every piece fits on one line, and the pieces are the line's text, in order, with only spaces between them. */
function wellFormed(line, pieces, cap = SUBTITLE_SEGMENT_RULES.maxCells) {
  let at = 0;
  for (const p of pieces) {
    assert.equal(p.text, line.text.slice(p.from, p.to));
    assert.match(line.text.slice(at, p.from), /^\s*$/);
    assert.ok(subtitleCells(subtitleEnd(p.text)) <= cap, `${p.text} fits on a line`);
    assert.ok(p.endMs > p.startMs);
    at = p.to;
  }
  assert.match(line.text.slice(at), /^\s*$/);
  pieces.slice(1).forEach((p, i) => assert.ok(p.startMs >= pieces[i].endMs, 'no overlap'));
}

test('the two lines that started it: a clause per subtitle, its comma gone', () => {
  assert.deepEqual(texts(cut('它叫 OpenFilm，免费开源，MIT 协议。', 3500)), ['它叫 OpenFilm', '免费开源', 'MIT 协议']);
  assert.deepEqual(texts(cut('为了不再剪视频，我做了一个通用的视频agent', 3500)), ['为了不再剪视频', '我做了一个通用的视频agent']);
  /* the same, timed by a voice: the same cuts, each starting with its first word */
  for (const text of ['它叫 OpenFilm，免费开源，MIT 协议。', '为了不再剪视频，我做了一个通用的视频agent']) {
    const line = spoken(text);
    const pieces = segmentLine(line);
    wellFormed(line, pieces);
    assert.deepEqual(texts(pieces), texts(cut(text, 3500)));
    for (const p of pieces.slice(1)) assert.equal(p.startMs, line.marks.find((m) => m.index === p.from).startMs);
  }
});

test('a clause mark makes no orphan: both sides need 4 CJK characters or 2 words', () => {
  assert.deepEqual(texts(cut('好，我们开始吧。', 2000)), ['好，我们开始吧']);
  /* a list is one phrase; too long, it is cut at its enumeration commas */
  assert.deepEqual(texts(cut('苹果、香蕉、橙子都很好吃。', 3000)), ['苹果、香蕉、橙子都很好吃']);
  assert.deepEqual(texts(cut('我们准备了剧本、分镜、配乐、字幕、调色和最后的成片导出', 6000)), ['我们准备了剧本、分镜、配乐', '字幕、调色和最后的成片导出']);
  assert.deepEqual(texts(cut('Well, I think so, yes.', 2500)), ['Well, I think so, yes.']);
  /* parentheses are clause edges; what is inside them stays whole */
  assert.deepEqual(texts(cut('我们先做一个原型（大概需要两周），然后再看效果。', 6000)), ['我们先做一个原型', '（大概需要两周）', '然后再看效果']);
});

test('a long clause with no punctuation is cut where it costs least: before a conjunction, never inside a word', () => {
  assert.deepEqual(texts(cut('我今天没有去公司上班因为外面一直在下很大的雨', 5000)), ['我今天没有去公司上班', '因为外面一直在下很大的雨']);
  const line = { text: '这是一个没有任何标点符号的很长的句子我们需要把它切成几段才能读', startMs: 0, endMs: 7000 };
  const pieces = segmentLine(line);
  assert.equal(pieces.length, 2);
  wellFormed(line, pieces);
  /* English: at most 42 characters, before "that" and "because" */
  assert.deepEqual(texts(cut('This is a really long sentence that goes on without any commas because we want to see where it breaks', 7000)),
    ['This is a really long sentence', 'that goes on without any commas', 'because we want to see where it breaks']);
});

test('mixed CJK and English: an English word or name is never cut, and a term like "MIT 协议" stays together', () => {
  const line = { text: '我们用 React 和 TypeScript 写了一个非常复杂的视频编辑器', startMs: 0, endMs: 5000 };
  const pieces = segmentLine(line);
  wellFormed(line, pieces);
  assert.ok(pieces.every((p) => !/[A-Za-z]$/.test(line.text.slice(0, p.to)) || !/^[A-Za-z]/.test(line.text.slice(p.to).trimStart()) || /\s/.test(line.text[p.to] ?? ' ')));
  assert.ok(texts(pieces).some((t) => t.includes('TypeScript')) && texts(pieces).some((t) => t.includes('React')));
  /* a line too long for one subtitle, with an English term in the middle */
  const term = segmentLine({ text: '这个项目使用的是 MIT 协议所以你可以随意修改和发布它', startMs: 0, endMs: 6000 });
  assert.ok(texts(term).some((t) => t.includes('MIT 协议')), texts(term).join(' | '));
});

test('English: sentences end at full stops, not at abbreviations, initials or decimals; commas start clauses and stay', () => {
  assert.deepEqual(texts(cut('Mr. Smith arrived at 3.5 s, e.g. right on time, and we started the demo.', 6000)),
    ['Mr. Smith arrived at 3.5 s,', 'e.g. right on time,', 'and we started the demo.']);
  assert.deepEqual(texts(cut('The U.S. economy grew 3.5% in Q1. Then it slowed.', 5000)), ['The U.S. economy grew 3.5% in Q1.', 'Then it slowed.']);
  assert.deepEqual(texts(cut('J. K. Rowling wrote it in 1997. It sold well.', 5000)), ['J. K. Rowling wrote it in 1997.', 'It sold well.']);
});

test('a number keeps its unit, however tight the line', () => {
  assert.deepEqual(texts(cut('渲染一帧只要 3.5 秒，比以前快了 10 倍。', 4000)), ['渲染一帧只要 3.5 秒', '比以前快了 10 倍']);
  const tight = { ...SUBTITLE_SEGMENT_RULES, maxChars: 12 };
  for (const p of cut('it took 3.5 s to render the whole thing', 5000, undefined, tight)) assert.ok(!/3\.5$/.test(p.text), p.text);
  for (const p of cut('it took 3.5 s to render the whole thing', 5000, undefined, tight)) assert.ok(!/^s\b/.test(p.text), p.text);
});

test('very short lines stay whole; a piece too short to read joins its neighbor', () => {
  assert.deepEqual(texts(cut('好。', 400)), ['好']);
  assert.deepEqual(cut('OK.', 500).map((p) => [p.text, p.startMs, p.endMs, p.part]), [['OK.', 0, 500, 0]]);
  /* "好。" alone would be up for a few hundred ms */
  assert.deepEqual(texts(cut('好。我们开始吧。', 2000)), ['好。我们开始吧']);
  assert.deepEqual(texts(cut('Yes. I know, right?', 2000)), ['Yes. I know, right?']);
  /* given time, a sentence is a subtitle of its own */
  assert.deepEqual(texts(cut('好的。我们现在开始吧。', 4000)), ['好的', '我们现在开始吧']);
});

test('a pause of half a second ends a subtitle; a short breath does not', () => {
  const long = spoken('我们先看一下这个画面然后再决定', { 10: 900 });
  assert.deepEqual(texts(segmentLine(long)), ['我们先看一下这个画面', '然后再决定']);
  const brief = spoken('我们先看一下这个画面然后再决定', { 10: 100 });
  assert.deepEqual(texts(segmentLine(brief)), ['我们先看一下这个画面然后再决定']);
  /* English words timed one by one */
  const text = 'one two three four five six';
  const marks = [0, 4, 8, 14, 19, 24].map((index, i) => ({ index, startMs: [0, 300, 600, 1700, 2000, 2300][i] }));
  assert.deepEqual(cut(text, 2800, marks).map((p) => [p.text, p.startMs, p.endMs]), [['one two three', 0, 1152], ['four five six', 1700, 2800]]);
});

test('times: a subtitle holds 200 ms after its last word, never into the next; small gaps close; at most 7 s', () => {
  /* "three" ends about 950 ms in: held to 1150, the next starts at 2000 */
  const text = 'one two three, four five six';
  const marks = [[0, 0], [4, 300], [8, 600], [15, 2000], [20, 2300], [25, 2600]].map(([index, startMs]) => ({ index, startMs }));
  assert.deepEqual(cut(text, 3200, marks).map((p) => [p.startMs, p.endMs]), [[0, 1152], [2000, 3200]]);
  /* untimed: the pieces share the line by length and a comma's pause, too short a gap to show: closed */
  const shared = cut('它叫 OpenFilm，免费开源，MIT 协议。', 3500);
  shared.slice(1).forEach((p, i) => assert.equal(p.startMs, shared[i].endMs));
  assert.equal(shared[0].startMs, 0);
  assert.equal(shared.at(-1).endMs, 3500, 'the last ends with the line');
  /* said slowly, one clause is too long to stay up */
  const slow = cut('这个非常慢的句子说了很久很久', 12000);
  assert.ok(slow.length >= 2 && slow.every((p) => p.endMs - p.startMs <= SUBTITLE_SEGMENT_RULES.maxMs), JSON.stringify(slow));
  /* each piece keeps its own timed words, from its start */
  const line = spoken('它叫 OpenFilm，免费开源，MIT 协议。');
  for (const p of segmentLine(line)) {
    assert.equal(p.marks[0].index, 0);
    assert.deepEqual(p.marks.map((m) => p.text.slice(m.index)[0]), line.marks.filter((m) => m.index >= p.from && m.index < p.to).map((m) => line.text[m.index]));
  }
});

test('the end of a subtitle: Chinese drops ，。、；：, keeps ？！… and quotes; Latin keeps its punctuation', () => {
  assert.equal(subtitleEnd('免费开源，'), '免费开源');
  assert.equal(subtitleEnd('它叫 OpenFilm，'), '它叫 OpenFilm');
  assert.equal(subtitleEnd('真的吗？'), '真的吗？');
  assert.equal(subtitleEnd('等一下……'), '等一下……');
  assert.equal(subtitleEnd('他说：“走吧。”'), '他说：“走吧。”');
  assert.equal(subtitleEnd('Hello, world,'), 'Hello, world,');
  assert.equal(subtitleEnd('It works.'), 'It works.');
});

test('a translation is cut to follow the original\'s pieces, at its own clause marks, or spans them when it cannot be', () => {
  const pieces = cut('它叫 OpenFilm，免费开源，MIT 协议。', 3500);
  assert.deepEqual(alignTranslation('It\'s called OpenFilm, free and open source, MIT licensed.', pieces).map((p) => p.text),
    ['It\'s called OpenFilm,', 'free and open source,', 'MIT licensed.']);
  assert.deepEqual(alignTranslation('It is called OpenFilm and it is free open source software under the MIT license', pieces).map((p) => p.text),
    ['It is called OpenFilm', 'and it is free open source software', 'under the MIT license']);
  /* too short to cut: the whole translation over every piece */
  const one = alignTranslation('It\'s OpenFilm.', pieces);
  assert.deepEqual(one.map((p) => p.text), ['It\'s OpenFilm.', 'It\'s OpenFilm.', 'It\'s OpenFilm.']);
  assert.deepEqual(one[0], { text: 'It\'s OpenFilm.', from: 0, to: 14 });
  /* the other way: Chinese for English */
  const en = cut('To stop editing videos, I built a general video agent.', 4000);
  assert.deepEqual(alignTranslation('为了不再剪视频，我做了一个通用的视频 agent。', en).map((p) => subtitleEnd(p.text)), ['为了不再剪视频', '我做了一个通用的视频 agent']);
});

test('a correction of one piece goes into its words in the line; the other pieces keep their times', () => {
  const line = spoken('它叫 OpenFilm，免费开源，MIT 协议。');
  const pieces = segmentLine(line);
  const fixed = replacePiece(line, pieces[1], '完全免费', pieces[1].startMs);
  assert.equal(fixed.text, '它叫 OpenFilm，完全免费，MIT 协议。', 'the comma the subtitle hid is put back');
  const after = line.marks.filter((m) => m.index >= pieces[2].from);
  assert.deepEqual(fixed.marks.filter((m) => m.index >= fixed.text.indexOf('MIT')).map((m) => m.startMs), after.map((m) => m.startMs));
  assert.ok(fixed.marks.some((m) => m.index === pieces[1].from && m.startMs === pieces[1].startMs), 'the corrected words start when the piece did');
  assert.deepEqual(texts(segmentLine({ ...line, ...fixed })), ['它叫 OpenFilm', '完全免费', 'MIT 协议']);
  /* new words with their own mark keep it; emptied, the piece goes */
  assert.equal(replacePiece(line, pieces[1], '免费？', 0).text, '它叫 OpenFilm，免费？MIT 协议。');
  assert.equal(replacePiece(line, pieces[2], '').text, '它叫 OpenFilm，免费开源，');
  assert.equal(replacePiece({ text: 'Hello there, how are you, my friend', startMs: 0, endMs: 3000 }, { from: 13, to: 25 }, '').text, 'Hello there, my friend');
});

test('the rules are one table', () => {
  assert.deepEqual(
    [SUBTITLE_SEGMENT_RULES.maxCells, SUBTITLE_SEGMENT_RULES.maxChars, SUBTITLE_SEGMENT_RULES.minUnits, SUBTITLE_SEGMENT_RULES.pauseMs,
      SUBTITLE_SEGMENT_RULES.minMs, SUBTITLE_SEGMENT_RULES.maxMs, SUBTITLE_SEGMENT_RULES.holdMs, SUBTITLE_SEGMENT_RULES.closeGapMs],
    [16, 42, 4, 500, 700, 7000, 200, 150]);
  assert.ok(Object.isFrozen(SUBTITLE_SEGMENT_RULES) && Object.isFrozen(SUBTITLE_SEGMENT_RULES.cost));
  /* a narrower cap cuts more */
  assert.ok(cut('我今天没有去公司上班因为外面一直在下很大的雨', 5000, undefined, { ...SUBTITLE_SEGMENT_RULES, maxCells: 8 }).length >= 3);
});
