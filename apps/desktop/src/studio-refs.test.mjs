import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftRefs, pillCard, refFromPill, refPill, sameStudioThing, selectionRefs, studioReferencesText } from '../chat/src/studio-refs.ts';

const frame = (ms) => ({ src: `/api/projects/p1/media?what=frame&path=film.html&ms=${ms}&w=1280`, stage: { w: 1920, h: 1080 } });
const clip = { kind: 'clip', id: 's3', loc: 'film.html#0.2', label: 'Title', clipKind: 'mg', src: 's3.html', start: 13.6, end: 18.2, track: 0, in: 2, speed: 1 };
const region = { kind: 'region', time: 15.4, box: { x: 576, y: 216, w: 730.4, h: 594 }, clipIds: ['s3'], texts: ['OpenFilm'], image: { ...frame(15400), crop: { x: 576, y: 216, w: 730, h: 594 } } };
const moment = { kind: 'time', time: 15.4, image: frame(15400) };
const range = { kind: 'range', start: 12.6, end: 17.2, clipIds: ['s3', 's3-logo', 'l3'], image: frame(12600) };
const layer = { kind: 'layer', label: 'h1', loc: 'film.html#0.2', clipId: 's3', text: 'Open\n  Film', tag: 'h1', time: 15.4, box: { x: 600, y: 300, w: 700, h: 120 }, source: 's3.html:42' };
const track = { kind: 'track', track: 1, label: 'V1', clipIds: ['v1', 'v2'] };
const file = { kind: 'file', path: 'assets/image/logo.png', fileKind: 'image', w: 1200, h: 400 };

test('the block after the message says what each number is, with the film\'s stage and where each picture is', () => {
  const text = studioReferencesText([clip, region, moment, range, layer, track, file], {
    stage: { w: 1920, h: 1080 },
    pictures: [undefined, '.film/refs/local-abc-2.jpg', '.film/refs/local-abc-3.jpg', null, undefined, undefined, undefined],
  });
  assert.equal(text, `

<studio_references film="film.html" stage="1920x1080">
[1] clip \`s3\` (s3.html) · track 0 · 13.600–18.200 s of the film · in 2.000 s · speed 1 · film.html#0.2
[2] region of the picture at 15.400 s · x=576 y=216 w=730 h=594 · clips s3 · words: "OpenFilm" · picture: .film/refs/local-abc-2.jpg
[3] moment 15.400 s · picture: .film/refs/local-abc-3.jpg
[4] range 12.600–17.200 s · clips s3, s3-logo, l3
[5] layer <h1> "Open Film" in clip \`s3\` at 15.400 s · x=600 y=300 w=700 h=120 · source s3.html:42 · film.html#0.2
[6] track 1 "V1" · clips v1, v2
[7] file assets/image/logo.png (image, 1200×400)
</studio_references>`);
});

test('no references, no block; the stage comes from a picture when the selection has none; what is unknown is left out', () => {
  assert.equal(studioReferencesText([]), '');
  const text = studioReferencesText([moment, { kind: 'clip', id: null, loc: null, label: 'Intro "a"', clipKind: 'video', src: null, start: 0, end: 2 }]);
  assert.match(text, /<studio_references film="film.html" stage="1920x1080">/);
  assert.match(text, /\n\[2\] clip "Intro \\"a\\"" · 0\.000–2\.000 s of the film\n/);
});

test('a pill keeps its picture and what it points at, and the pill alone takes the person back there', () => {
  const pill = refPill(undefined, region);
  assert.equal(pill.kind, 'region');
  assert.equal(pill.label, 'OpenFilm');
  assert.equal(pill.detail, undefined);                     /* its moment is on the card, not the pill */
  assert.deepEqual(pill.image, region.image);
  assert.equal('image' in pill.target, false);
  assert.deepEqual(refFromPill(JSON.parse(JSON.stringify(pill))), { kind: 'region', time: 15.4, box: region.box, clipIds: ['s3'], texts: ['OpenFilm'] });
  assert.equal(refPill(undefined, range).label, '12.6–17.2 s');
  assert.equal(refPill(undefined, track).kind, 'track');
  assert.equal(refPill(undefined, file).detail, '1200×400');
  assert.equal(refPill('kept', moment).id, 'kept');
});

test('a pill sent before pills kept their reference is found again by its id', () => {
  assert.deepEqual(refFromPill({ id: 'studio:time:4.2', label: '0:04.2' }), { kind: 'time', time: 4.2 });
  assert.equal(refFromPill({ id: 'studio:clip:s3', label: 's3' })?.id, 's3');
  assert.equal(refFromPill({ id: 'studio:clip:film.html#0.2', label: 'x' })?.loc, 'film.html#0.2');
  assert.equal(refFromPill({ id: 'studio:layer:s3:film.html#0.2', label: 'h1' })?.clipId, 's3');
  assert.equal(refFromPill({ id: 'file:assets/a.png', label: 'a.png' }), null);
});

test('⌘L points at what is selected, else the range marked, else the moment at the playhead', () => {
  const base = { projectId: 'p1', time: 3, refs: [], stage: { w: 1920, h: 1080 } };
  assert.deepEqual(selectionRefs({ ...base, refs: [clip, layer] }), [clip, layer]);
  const [marked] = selectionRefs({ ...base, range: { start: 1, end: 2 } });
  assert.deepEqual(marked, { kind: 'range', start: 1, end: 2, clipIds: [] });
  /* the moment is shown by the viewer as it is: the app takes that picture, Studio draws no frame of the film */
  const [now] = selectionRefs(base);
  assert.deepEqual(now, { kind: 'time', time: 3, image: { viewer: true } });
  assert.equal(refPill(undefined, now).image, undefined);
});

test('a pill\'s card lists its facts, labeled in the chat\'s words', () => {
  const card = pillCard(refPill(undefined, layer), (path) => path);
  assert.equal(card.title, 'refCard.title.layer');
  assert.deepEqual(card.rows, [
    ['refCard.tag', '<h1>'], ['refCard.words', '“Open Film”'], ['refCard.clip', 's3'], ['refCard.at', '0:15.4'],
    ['refCard.box', 'x=600 y=300 w=700 h=120'], ['refCard.source', 's3.html:42'],
  ]);
  assert.equal(pillCard({ id: 'file:a.png', label: 'a.png' }, (p) => p), null);
});

test('a subtitle line, or words picked in it, is its span, its words, its language and its number', () => {
  const line = { kind: 'subtitle', start: 12.4, end: 15.1, text: 'the quick brown fox', index: 7, image: frame(13750) };
  const words = { kind: 'subtitle', start: 12.7, end: 13.7, text: '敏捷的棕色', lang: 'zh', words: [{ text: 'quick', start: 12.7, end: 13.1 }] };
  assert.equal(studioReferencesText([line, words], { pictures: ['.film/refs/local-abc-1.jpg'] }), `

<studio_references film="film.html" stage="1920x1080">
[1] subtitle 12.400–15.100 s "the quick brown fox" · line 7 · picture: .film/refs/local-abc-1.jpg
[2] subtitle 12.700–13.700 s "敏捷的棕色" (zh)
</studio_references>`);
  const pill = refPill(undefined, { ...line, text: 'a line far longer than any pill has room for, said slowly' });
  assert.equal(pill.kind, 'subtitle');
  assert.equal(pill.label, 'a line far longer than any pill has roo…');
  assert.equal(pill.detail, '12.4–15.1 s');
  assert.notEqual(refPill(undefined, words).id, refPill(undefined, line).id);
  const card = pillCard(refPill(undefined, words), (path) => path);
  assert.equal(card.title, 'refCard.title.subtitle');
  assert.deepEqual(card.rows, [['refCard.words', '“敏捷的棕色”'], ['refCard.span', '12.70–13.70 s'], ['refCard.language', 'zh']]);
  assert.deepEqual(refFromPill(JSON.parse(JSON.stringify(refPill(undefined, line)))), { kind: 'subtitle', start: 12.4, end: 15.1, text: 'the quick brown fox', index: 7 });
});

test('what the pointer is over in Studio lights the pills that point at the same thing', () => {
  /* a clip by its id, whatever its place now; by its place when one side has no id */
  assert.equal(sameStudioThing(clip, { ...clip, loc: 'film.html#1.0', image: frame(0) }), true);
  assert.equal(sameStudioThing(clip, { ...clip, id: 's4' }), false);
  assert.equal(sameStudioThing({ ...clip, id: null }, clip), true);
  assert.equal(sameStudioThing({ ...clip, id: null, loc: null }, { ...clip, id: null, loc: null }), false);
  /* a pill sent before pills kept their target: what its id says */
  assert.equal(sameStudioThing(clip, refFromPill({ id: 'studio:clip:s3', label: 'Title' })), true);
  /* a layer by its clip and place, else its clip and words */
  assert.equal(sameStudioThing(layer, { ...layer, time: 16, box: undefined }), true);
  assert.equal(sameStudioThing(layer, { ...layer, loc: 'film.html#0.3' }), false);
  assert.equal(sameStudioThing(layer, { ...layer, clipId: 's4' }), false);
  assert.equal(sameStudioThing({ ...layer, loc: null }, { ...layer, loc: null }), true);
  assert.equal(sameStudioThing({ ...layer, loc: null, text: null }, { ...layer, loc: null, text: null }), false);
  /* the rest by their times, boxes, tracks and paths */
  assert.equal(sameStudioThing(region, { ...region, box: { x: 576.2, y: 216, w: 730.4, h: 594 } }), true);
  assert.equal(sameStudioThing(region, { ...region, time: 15.5 }), false);
  assert.equal(sameStudioThing(moment, { kind: 'time', time: 15.4 }), true);
  assert.equal(sameStudioThing(range, { ...range, end: 17.3 }), false);
  assert.equal(sameStudioThing(track, { ...track, label: 'other' }), true);
  assert.equal(sameStudioThing(file, { ...file, path: 'assets/image/other.png' }), false);
  const line = { kind: 'subtitle', start: 1, end: 2.5, text: 'Hello' };
  assert.equal(sameStudioThing(line, { ...line, text: 'Hel' }), true);
  assert.equal(sameStudioThing(line, { ...line, lang: 'ja' }), false);
  /* different kinds are different things, even about the same clip */
  assert.equal(sameStudioThing(clip, layer), false);
  assert.equal(sameStudioThing(layer, clip), false);
});

test('the message being written numbers its references as the agent will: each once, in order, files left out', () => {
  const known = new Map([['a', clip], ['b', layer], ['c', region]]);
  assert.deepEqual(draftRefs(['b', 'file:assets/x.png', 'a', 'b', 'c', 'gone'], known), [layer, clip, region]);
  assert.deepEqual(draftRefs([], known), []);
});
