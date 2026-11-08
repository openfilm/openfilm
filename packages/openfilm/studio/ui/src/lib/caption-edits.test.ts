import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readVtt, writeVtt } from '../../../../src/captions.mjs';
import {
  MIN_CUE_S, addCue, keepApart, resizeCues, setCueBlock, cueRule, cutIndex, joinText, mergeCues, moveCues, placeCues, removeCues, retimeCue, setCueRule, setCueText, splitCue, withIds,
} from './caption-edits.ts';

const FILE = `WEBVTT

STYLE
::cue { color: #fff; }
::cue(#b) { color: #ffd400; }

a
00:00:00.500 --> 00:00:02.000
First line

b
00:00:02.000 --> 00:00:03.500
<00:00:02.000>Second <00:00:02.800>line

00:00:03.500 --> 00:00:05.000 line:40%
Third
`;
const spans = (v: ReturnType<typeof readVtt>) => v.cues.map((c) => [c.id, c.start, c.end]);

test('a file read for editing: every cue named, in time order', () => {
  const v = withIds(readVtt(FILE));
  assert.deepEqual(spans(v), [['a', 0.5, 2], ['b', 2, 3.5], ['c1', 3.5, 5]]);
});

test('an edge dragged into a neighbor cuts it short, to a length; a cue never before 0', () => {
  const v = withIds(readVtt(FILE));
  assert.deepEqual(spans(retimeCue(v, 'a', 'end', 2.6)), [['a', 0.5, 2.6], ['b', 2.6, 3.5], ['c1', 3.5, 5]]);
  assert.deepEqual(spans(retimeCue(v, 'a', 'end', 9)), [['a', 0.5, 3.5 - MIN_CUE_S], ['b', 3.4, 3.5], ['c1', 3.5, 5]]);
  assert.deepEqual(spans(retimeCue(v, 'a', 'start', -3)), [['a', 0, 2], ['b', 2, 3.5], ['c1', 3.5, 5]]);
});

test('cues moved together: by as much as keeps the others a length, their words with them', () => {
  const v = withIds(readVtt(FILE));
  const moved = moveCues(v, new Set(['a', 'b']), 0.5);
  assert.deepEqual(spans(moved), [['a', 1, 2.5], ['b', 2.5, 4], ['c1', 4, 5]]);
  assert.equal(moved.cues[1]!.text, '<00:00:02.500>Second <00:00:03.300>line');
  assert.deepEqual(spans(moveCues(v, new Set(['a', 'b']), 9)), [['a', 1.9, 3.4], ['b', 3.4, 4.9], ['c1', 4.9, 5]], 'stops where c1 keeps 0.1 s');
  assert.deepEqual(spans(moveCues(v, new Set(['a']), -2)), [['a', 0, 1.5], ['b', 2, 3.5], ['c1', 3.5, 5]], 'never before 0');
});

test('split at its words, or by its text; merge; add where there is room; remove with its own style', () => {
  const v = withIds(readVtt(FILE));
  const byWords = splitCue(v, 'b', 2.8);
  assert.equal(byWords.id, 'c4');
  assert.deepEqual(byWords.vtt.cues.filter((c) => c.id === 'b' || c.id === 'c4').map((c) => [c.start, c.end, c.text]), [[2, 2.8, '<00:00:02.000>Second'], [2.8, 3.5, '<00:00:02.800>line']]);
  const byText = splitCue(v, 'a', 1.25);
  assert.deepEqual(byText.vtt.cues.slice(0, 2).map((c) => c.text), ['First', 'line']);
  assert.equal(splitCue(v, 'a', 0.55).id, null, 'too near its edge');
  const merged = mergeCues(v, 'a', 'b');
  assert.deepEqual(spans(merged), [['a', 0.5, 3.5], ['c1', 3.5, 5]]);
  assert.equal(merged.cues[0]!.text, 'First line <00:00:02.000>Second <00:00:02.800>line');
  const added = addCue(v, 6, 'New')!;
  assert.deepEqual(added.vtt.cues.at(-1), { id: added.id, start: 6, end: 8, settings: 'line:40%', text: 'New' });
  assert.equal(addCue(v, 1, 'x'), null, 'a cue is there');
  assert.deepEqual(addCue(v, 6, 'End', 7)!.vtt.cues.at(-1)!.end, 7, 'no further than the film');
  assert.equal(addCue(v, 6.95, 'x', 7), null, 'too little room before the film ends');
  const gone = removeCues(v, new Set(['b']));
  assert.deepEqual(spans(gone), [['a', 0.5, 2], ['c1', 3.5, 5]]);
  assert.deepEqual(cueRule(gone, '::cue(#b)'), {});
  assert.equal(setCueText(v, 'b', 'Second line').cues[1]!.text, '<00:00:02.000>Second <00:00:02.800>line', 'the same words: kept as they are');
  assert.equal(setCueText(v, 'b', 'Other <words> & more').cues[1]!.text, 'Other &lt;words&gt; &amp; more');
});

test('the look: a rule read, set, a property taken out, the rule gone when empty; the file written back', () => {
  const v = withIds(readVtt(FILE));
  assert.deepEqual(cueRule(v, '::cue'), { color: '#fff' });
  const set = setCueRule(v, '::cue(#a)', { 'font-weight': '800', color: '#2bf06a' });
  assert.deepEqual(cueRule(set, '::cue(#a)'), { 'font-weight': '800', color: '#2bf06a' });
  assert.deepEqual(cueRule(setCueRule(set, '::cue(#a)', { color: null }), '::cue(#a)'), { 'font-weight': '800' });
  const none = setCueRule(setCueRule(set, '::cue(#a)', null), '::cue(#b)', { color: null });
  assert.equal(none.styles[0], '::cue { color: #fff; }');
  const text = writeVtt(set);
  assert.match(text, /STYLE\n::cue \{ color: #fff; \}\n::cue\(#b\) \{ color: #ffd400; \}\n::cue\(#a\) \{ font-weight: 800; color: #2bf06a; \}/);
  assert.deepEqual(cueRule(readVtt(text), '::cue(#a)'), { 'font-weight': '800', color: '#2bf06a' }, 'read back as written');
});

test('moved on the picture: every cue of one region moves the region; a cue alone is placed by its bottom and middle', () => {
  const v = withIds(readVtt('WEBVTT\n\nREGION\nid:main\nwidth:100%\nlines:3\nregionanchor:50%,100%\nviewportanchor:50%,94%\n\na\n00:00:00.000 --> 00:00:01.000 region:main align:center\nOne\n\nb\n00:00:01.000 --> 00:00:02.000 region:main align:center\nTwo\n'));
  const all = placeCues(v, null, -30, -44);
  assert.deepEqual(all.cues.map((c) => c.settings), v.cues.map((c) => c.settings), 'the cues stay in their region');
  assert.equal(all.regions[0], 'id:main\nwidth:40%\nlines:3\nregionanchor:50%,100%\nviewportanchor:20%,50%', 'its middle at 20%, narrowed to stay on the frame');
  const one = placeCues(v, new Set(['b']), 0, -40, new Map([['b', { left: 30, top: 88, width: 40, height: 6 }]]));
  assert.equal(one.cues[0]!.settings, 'region:main align:center');
  assert.equal(one.cues[1]!.settings, 'line:54%,end position:50%,center size:40% align:center', 'where it was drawn, moved up');
  assert.equal(placeCues(one, new Set(['b']), 0, 70, new Map([['b', { left: 30, top: 48, width: 40, height: 6 }]])).cues[1]!.settings.split(' ')[0], 'line:100%,end', 'kept on the frame');
});

test('texts are cut at a word, or between characters, never before a closing mark', () => {
  assert.equal(cutIndex('one two three four', 0.5), 8);
  assert.equal(cutIndex('one two three four', 0), 4);
  assert.equal(cutIndex('word', 0.5), 0);
  assert.equal(cutIndex('ok你好', 0.5), 2);
  assert.equal(cutIndex('我们今天，去公园', 0.5), 5);
  assert.equal(cutIndex('你好', 0.9), 1);
  assert.equal(joinText('one two', 'three'), 'one two three');
  assert.equal(joinText('你好，', '世界'), '你好，世界');
  assert.equal(joinText('', 'x'), 'x');
});

test('a cue split at its middle keeps a character written with a surrogate pair whole', () => {
  for (const [text, halves] of [['a😀b', ['a', '😀b']], ['😀😀😀😀', ['😀😀', '😀😀']]]) {
    const v = withIds(readVtt(`WEBVTT\n\na\n00:00:00.000 --> 00:00:02.000\n${text}\n`));
    const got = splitCue(v, 'a', 1).vtt.cues.slice(0, 2).map((c) => c.text);
    assert.deepEqual(got, halves);
    for (const half of got) assert.doesNotThrow(() => encodeURI(half), `${half} has no half a character`);
    assert.equal(got.join(''), text, 'the words are all still there');
  }
});

test('cues apart after an edit: one that stayed cut short where a moved one reaches it, or left whole', () => {
  const v = withIds(readVtt(FILE));
  const moved = v.cues.map((c) => (c.id === 'a' ? { ...c, start: 3, end: 4.5 } : c));
  assert.deepEqual(keepApart(moved, new Set(['a'])).map((c) => [c.id, c.start, c.end]), [['b', 2, 3], ['a', 3, 4.5], ['c1', 4.5, 5]]);
  const over = v.cues.map((c) => (c.id === 'a' ? { ...c, start: 3.4, end: 5 } : c));
  assert.deepEqual(keepApart(over, new Set(['a'])).find((c) => c.id === 'c1')!.start, 3.5, 'too little would be left: it stays whole');
});

test('a whole rule of the STYLE (keyframes) set, put back where it was, taken away', () => {
  const v = withIds(readVtt(FILE));
  const a = setCueBlock(v, '@keyframes of-in-fade', 'from { opacity: 0; }');
  assert.equal(a.styles[0], '::cue { color: #fff; }\n::cue(#b) { color: #ffd400; }\n@keyframes of-in-fade { from { opacity: 0; } }');
  assert.equal(setCueBlock(a, '@keyframes of-in-fade', 'to { opacity: 1; }').styles[0]!.split('\n')[2], '@keyframes of-in-fade { to { opacity: 1; } }');
  assert.equal(setCueBlock(a, '@keyframes of-in-fade', null).styles[0], v.styles[0]);
});

test('cues made wider or narrower about their middle: the region of all of them, or each one alone', () => {
  const v = withIds(readVtt('WEBVTT\n\nREGION\nid:main\nwidth:100%\nlines:3\nregionanchor:50%,100%\nviewportanchor:50%,94%\n\na\n00:00:00.000 --> 00:00:01.000 region:main align:center\nOne\n'));
  assert.equal(resizeCues(v, null, 60).regions[0], 'id:main\nwidth:60%\nlines:3\nregionanchor:50%,100%\nviewportanchor:50%,94%');
  const one = resizeCues(v, new Set(['a']), 40, new Map([['a', { left: 10, top: 80, width: 60, height: 6 }]]));
  assert.equal(one.cues[0]!.settings, 'line:86%,end position:40%,center size:40% align:center');
});
