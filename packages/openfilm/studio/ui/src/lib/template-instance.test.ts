import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filledTemplate, fillFor, isSlotSrc, markedClips, templateMark, templateMarks, templateOf, templateSlots, TEMPLATE_ATTR } from './template-instance.ts';

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

test("a template's places in the order they play, and its clips with the person's own files in them before it is put in", () => {
  const slot = (at: number, len: number, n: string) => ({ track: 3, at, clip: { src: 'saved/openfilm/templates-trip/slot.html', time: [0, len], style: 'object-fit: cover', overrides: [{ at: ':root', style: { '--n': n } }, { fade: [0, 0.3] }] } });
  const clips = [
    { track: 0, at: 0.3, clip: { src: 'saved/openfilm/templates-trip/title.html', time: [0, 2.5] } },
    slot(3, 2.4, '2'),
    slot(0, 3, '1'),
    { track: 4, at: 0, clip: { src: 'saved/openfilm/music-x.mp3', time: [0, 11] } },
  ];
  assert.deepEqual(templateSlots(clips).map((s) => [s.clip.at, s.durMs]), [[0, 3000], [3, 2400]]);
  /* the library's own bundle names its place `slot.html` */
  assert.deepEqual(templateSlots([{ track: 0, at: 1, clip: { src: 'slot.html', time: [0, 2] } }]).map((s) => s.durMs), [2000]);
  const filled = filledTemplate(clips, [{ path: 'assets/beach.mp4', kind: 'video', durationMs: 10_000 }, { path: 'assets/sea.jpg', kind: 'image' }]);
  /* the first place (at 0) gets the first file, played from its start for the place's length; the page's own words gone, its fade kept */
  assert.deepEqual(filled[2]!.clip, { src: 'assets/beach.mp4', time: [0, 3], style: 'object-fit: cover', overrides: [{ fade: [0, 0.3] }] });
  assert.deepEqual(filled[1]!.clip, { src: 'assets/sea.jpg', time: [0, 2.4], style: 'object-fit: cover', overrides: [{ fade: [0, 0.3] }] });
  assert.equal(filled[0], clips[0], 'what is not a place stays');
  assert.equal(filled[3], clips[3]);
  /* a place with no file stays a place */
  assert.equal(filledTemplate(clips, [null, { path: 'assets/sea.jpg', kind: 'image' }])[2], clips[2]);
});
