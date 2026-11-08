import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filledTemplate, fillFor, filmLength, filmTemplate, isSlotSrc, markedClips, placeFrame, retimedTemplate, schemeColor, templateFolderOf, templateMark, templateMarks, templateOf, templateOfFolder, templateSlots, TEMPLATE_ATTR, withPlaceFrame } from './template-instance.ts';

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

test("a template put in as one compound clip: what its film offers, places, words, looks, switches, pictures and sound", () => {
  assert.equal(templateFolderOf('parts/templates-travel-vlog-2/film.html'), 'parts/templates-travel-vlog-2');
  assert.equal(templateFolderOf('parts/compound/film.html'), null);
  assert.equal(templateOfFolder('parts/templates-new-year-3'), 'templates/new-year');
  assert.equal(templateOfFolder('parts/templates-new-year'), 'templates/new-year');
  const props = (list: unknown[]) => ({ 'data-props': JSON.stringify(list) });
  const film = [
    { clips: [
      { id: 'title', src: '../../saved/openfilm/templates-trip/title.html', at: 0.3, attrs: props([{ name: 'Title', type: 'text', at: '.t1' }, { name: 'Color', type: 'var', var: '--color' }, { name: 'Ribbon', type: 'boolean', at: '.ribbon' }]),
        overrides: [{ at: '.t1', text: 'Summer' }, { at: ':root', style: { '--color': '#ff0' } }, { at: '.ribbon', style: { visibility: 'hidden' } }] },
      { id: 'pin', src: '../../saved/openfilm/templates-trip/pin.html', at: 5, attrs: props([{ name: 'Color', type: 'var', var: '--color' }, { name: 'Logo', type: 'image', kind: 'img', at: 'img.logo' }]) },
    ] },
    { clips: [
      { id: 'one', src: '../../saved/openfilm/templates-trip/example-1.jpg', attrs: { 'data-slot': '1' } },
      { id: 'two', src: '../../saved/openfilm/templates-trip/slot.html', at: 3 },
      { id: 'mine', src: '../../assets/beach.mp4', at: 6 },
    ] },
    { clips: [{ id: 'tune', src: '../../saved/openfilm/music-x.mp3' }] },
  ];
  const t = filmTemplate(film);
  /* the template's own example picture waits for the person's own, as an empty place does */
  assert.deepEqual(t.places, [{ clip: 'one', empty: true }, { clip: 'two', empty: true }, { clip: 'mine', empty: false }]);
  assert.deepEqual(t.words, [{ clip: 'title', name: 'Title', at: '.t1', text: 'Summer' }]);
  assert.deepEqual(t.looks, [{ name: 'Color', var: '--color', clips: ['title', 'pin'], value: '#ff0' }], 'one control for every page offering it');
  assert.deepEqual(t.switches.map((s) => [s.clip, s.prop.name, s.on]), [['title', 'Ribbon', false]]);
  assert.deepEqual(t.pictures.map((p) => [p.clip, p.prop.name, p.value]), [['pin', 'Logo', null]]);
  assert.deepEqual(t.sounds, [{ clip: 'tune', src: '../../saved/openfilm/music-x.mp3' }]);
});

test("a place's picture framed: filling or whole, the point looked at, how near; read back as written", () => {
  assert.deepEqual(placeFrame('object-fit: cover'), { fit: 'cover', x: 0.5, y: 0.5, zoom: 1 });
  const style = withPlaceFrame('object-fit: cover; animation: kb 8s infinite', { fit: 'cover', x: 0.25, y: 0.5, zoom: 2 });
  assert.equal(style, 'object-fit: cover; object-position: 25% 50%; object-view-box: inset(25% 37.5% 25% 12.5%); animation: kb 8s infinite');
  assert.deepEqual(placeFrame(style), { fit: 'cover', x: 0.25, y: 0.5, zoom: 2 });
  assert.equal(withPlaceFrame(style, { fit: 'contain', x: 0.5, y: 0.5, zoom: 1 }), 'object-fit: contain; animation: kb 8s infinite');
});

test("a template's object-position is read as CSS reads it: one value, keywords, and other units", () => {
  assert.deepEqual(placeFrame('object-position: top'), { fit: 'cover', x: 0.5, y: 0, zoom: 1 });
  assert.deepEqual(placeFrame('object-position: 30%'), { fit: 'cover', x: 0.3, y: 0.5, zoom: 1 }, 'one value is across, not both axes');
  assert.deepEqual(placeFrame('object-position: right bottom'), { fit: 'cover', x: 1, y: 1, zoom: 1 });
  assert.deepEqual(placeFrame('object-position: 30% 80%'), { fit: 'cover', x: 0.3, y: 0.8, zoom: 1 });
  assert.deepEqual(placeFrame('object-position: 10px 20px'), { fit: 'cover', x: 0.5, y: 0.5, zoom: 1 }, 'px are not percentages');
});

test('a template stretched: its places in proportion, a transition on its cut, its opening held, its end with it', () => {
  const film = { tracks: [
    { clips: [
      { id: 'title', src: 't.html', at: 0.3, time: [0, 2.5] },
      { id: 'pin', src: 'p.html', at: 5.6, time: [0, 2.6] },
      { id: 'end', src: 'e.html', at: 8.6, time: [0, 2.4] },
    ] },
    { clips: [{ id: 'flash', src: 'f.html', at: 2.6, time: [0, 0.8] }] },
    { clips: [{ id: 'leak', src: 'l.html', time: [0, 11] }] },
    { clips: [
      { id: 'a', src: 'a.jpg', time: [0, 3], attrs: { 'data-slot': '1' } },
      { id: 'b', src: 'b.mp4', at: 3, time: [2, 4.4], attrs: { 'data-slot': '2' } },
      { id: 'c', src: 'c.jpg', at: 5.4, time: [0, 5.6], attrs: { 'data-slot': '3' } },
    ] },
    { clips: [{ id: 'tune', src: 'music.mp3', time: [0, 11] }] },
  ] };
  assert.equal(filmLength(film.tracks), 11);
  const long = retimedTemplate(film, 22);
  const of = (id: string) => long.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;
  assert.deepEqual([of('a').at, of('a').time], [undefined, [0, 6]]);
  assert.deepEqual([of('b').at, of('b').time], [6, [2, 6.8]], "a video's own start stays");
  assert.deepEqual([of('c').at, of('c').time], [10.8, [0, 11.2]]);
  assert.deepEqual([of('flash').at, of('flash').time], [5.6, [0, 0.8]], 'as long, its middle on the cut');
  assert.deepEqual([of('title').at, of('title').time], [0.3, [0, 2.5]], 'the opening held');
  assert.deepEqual([of('end').at, of('end').time], [19.6, [0, 2.4]], 'ending with it');
  assert.deepEqual([of('pin').at, of('pin').time], [11, [0, 2.6]], 'a moment into its place: as far into it');
  assert.deepEqual(of('leak').time, [0, 22]);
  assert.deepEqual(of('tune').time, [0, 22]);
  assert.equal(filmLength(long.tracks), 22);
  assert.equal(retimedTemplate(film, 11), film, 'as long: as it is');
});

test('a color in a scheme', () => {
  assert.equal(schemeColor('mono', '#ff0000'), '#808080');
  assert.equal(schemeColor('mono', '#ff000080'), '#80808080', 'its alpha kept');
  assert.equal(schemeColor('warm', 'not a color'), null);
  assert.match(schemeColor('cool', '#ff9a3c')!, /^#[0-9a-f]{6}$/);
});
