import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillFor, isSlotSrc, markedClips, templateMark, templateMarks, templateOf, TEMPLATE_ATTR } from './template-instance.ts';

const mark = (m: string, extra: Record<string, string> = {}) => ({ [TEMPLATE_ATTR]: m, ...extra });
const tracks = [
  { clips: [
    { id: 'title', src: 'saved/openfilm/templates-travel-vlog/title-script.html', at: 0.3, attrs: mark('travel-vlog', { 'data-props': JSON.stringify([{ name: 'Title', type: 'text', at: '.t1' }, { name: 'Color', type: 'var', var: '--color' }]) }), overrides: [{ at: '.t1', text: 'Summer Days' }] },
    { id: 'leak', src: 'saved/openfilm/templates-travel-vlog/light-leak.html', at: 0, attrs: mark('travel-vlog') },
  ] },
  { clips: [
    { id: 'slot-2', src: 'saved/openfilm/templates-travel-vlog/slot.html', at: 3, attrs: mark('travel-vlog') },
    { id: 'beach', src: 'assets/beach.mp4', at: 0, attrs: mark('travel-vlog') },
    { id: 'other', src: 'assets/other.mp4', at: 0 },
  ] },
  { clips: [{ id: 'music', src: 'assets/plucky.mp3', at: 0, attrs: mark('travel-vlog') }] },
];

test('a template put in is one template: its places for pictures in the order they play, its words, all its clips', () => {
  const t = templateOf(tracks, 'leak')!;
  assert.equal(t.id, 'templates/travel-vlog');
  assert.deepEqual(t.clips, ['title', 'leak', 'slot-2', 'beach', 'music']);
  assert.deepEqual(t.slots, [{ clip: 'beach', empty: false }, { clip: 'slot-2', empty: true }]);
  assert.deepEqual(t.words, [{ clip: 'title', name: 'Title', at: '.t1', text: 'Summer Days' }]);
  assert.equal(templateOf(tracks, 'other'), null);
});

test('each time a template is put in it is marked apart; its clips carry the mark', () => {
  assert.equal(templateMark('templates/travel-vlog', []), 'travel-vlog');
  assert.equal(templateMark('templates/travel-vlog', templateMarks(tracks)), 'travel-vlog-2');
  assert.equal(templateOf([{ clips: [{ id: 'a', src: 'assets/a.mp4', attrs: mark('travel-vlog-2') }] }], 'a')!.id, 'templates/travel-vlog');
  const [one] = markedClips([{ track: 0, at: 0, clip: { src: 'x.html', attrs: { 'data-place': '{}' } } }], 'travel-vlog');
  assert.deepEqual(one!.clip.attrs, { 'data-place': '{}', [TEMPLATE_ATTR]: 'travel-vlog' });
  assert.equal(isSlotSrc('saved/openfilm/templates-beat-cut/slot.html#t=0,3'), true);
});

test('empty places are filled with the person\'s pictures the film does not use yet first', () => {
  const media = [{ path: 'assets/a.mp4' }, { path: 'assets/b.jpg' }, { path: 'assets/c.mp4' }];
  assert.deepEqual(fillFor(2, media, new Set(['assets/a.mp4'])).map((f) => f.path), ['assets/b.jpg', 'assets/c.mp4']);
  assert.deepEqual(fillFor(4, media, new Set(['assets/a.mp4'])).map((f) => f.path), ['assets/b.jpg', 'assets/c.mp4', 'assets/a.mp4']);
});
