import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentRefPill, clipPillKind, parseAgentRefs, refOfLink } from '../chat/src/lib/agent-refs.ts';
import { linkOfRef } from '../chat/src/studio-refs.ts';

const refs = (text) => parseAgentRefs(text).filter((s) => s.kind === 'ref').map((s) => s.ref);

test('each kind of token becomes the reference it names, with the words around it kept', () => {
  const segments = parseAgentRefs('I moved [[clip:s3]] to [[t:13]] and trimmed [[range:12.6-17.2]] on [[track:1]] using [[file:assets/image/logo.png]].');
  assert.deepEqual(segments, [
    { kind: 'text', text: 'I moved ' },
    { kind: 'ref', raw: '[[clip:s3]]', ref: { kind: 'clip', id: 's3', loc: null, label: 's3', clipKind: 'mg', src: null, start: 0, end: 0 } },
    { kind: 'text', text: ' to ' },
    { kind: 'ref', raw: '[[t:13]]', ref: { kind: 'time', time: 13 } },
    { kind: 'text', text: ' and trimmed ' },
    { kind: 'ref', raw: '[[range:12.6-17.2]]', ref: { kind: 'range', start: 12.6, end: 17.2, clipIds: [] } },
    { kind: 'text', text: ' on ' },
    { kind: 'ref', raw: '[[track:1]]', ref: { kind: 'track', track: 1, label: '', clipIds: [] } },
    { kind: 'text', text: ' using ' },
    { kind: 'ref', raw: '[[file:assets/image/logo.png]]', ref: { kind: 'file', path: 'assets/image/logo.png', fileKind: '' } },
    { kind: 'text', text: '.' },
  ]);
});

test('a range may be written with an en dash, a clip id in any script, a path from ./', () => {
  assert.deepEqual(refs('[[range:1.5–3]] [[clip:标题-2]] [[file:./mg/title.html]]'), [
    { kind: 'range', start: 1.5, end: 3, clipIds: [] },
    { kind: 'clip', id: '标题-2', loc: null, label: '标题-2', clipKind: 'mg', src: null, start: 0, end: 0 },
    { kind: 'file', path: 'mg/title.html', fileKind: '' },
  ]);
});

test('unknown or malformed tokens stay as the agent wrote them', () => {
  const text = [
    '[[scene:s3]]', '[[t:abc]]', '[[t:-2]]', '[[range:5-2]]', '[[range:3]]', '[[track:x]]', '[[track:1.5]]',
    '[[file:/etc/passwd]]', '[[file:../other/film.html]]', '[[file:https://example.com/a.png]]', '[[clip:two words]]',
    '[[clip:]]', '[clip:s3]', '[[clip:s3]',
  ].join(' ');
  assert.deepEqual(parseAgentRefs(text), [{ kind: 'text', text }]);
  assert.deepEqual(parseAgentRefs(''), []);
});

test('a clip pill takes its icon from its file when the film has it, and keeps what it points at to reveal it', () => {
  const clip = refs('[[clip:intro]]')[0];
  const known = agentRefPill(clip, { clipSrc: 'assets/video/intro.mp4' });
  assert.equal(known.kind, 'clipVideo');
  assert.equal(known.label, 'intro');
  assert.deepEqual(known.target, { ...clip, src: 'assets/video/intro.mp4' });
  assert.equal(agentRefPill(clip, { clipSrc: 'mg/intro.html' }).kind, 'clipMg');
  assert.equal(agentRefPill(clip, { clipSrc: 'assets/audio/music/bed.mp3' }).kind, 'clipMusic');
  /* a clip the film does not have: the neutral icon */
  assert.equal(agentRefPill(clip).kind, 'clip');
});

test('the other pills are the person\'s own pills for the same thing; a track is named in the chat\'s words', () => {
  const [moment, range, track, file] = refs('[[t:75.25]] [[range:12.6-17.2]] [[track:2]] [[file:assets/image/logo.png]]');
  assert.deepEqual(agentRefPill(moment), { id: 'agent:studio:time:75.25', kind: 'time', label: '1:15.3', target: { kind: 'time', time: 75.25 } });
  assert.equal(agentRefPill(range).label, '12.6–17.2 s');
  assert.equal(agentRefPill(track, { trackLabel: (n) => `Track ${n}` }).label, 'Track 2');
  assert.equal(agentRefPill(file).label, 'logo.png');
  assert.equal(agentRefPill(file).kind, 'file');
});

test('a clip\'s pill kind follows its file, as the timeline colors it', () => {
  assert.equal(clipPillKind('mg/title.html'), 'clipMg');
  assert.equal(clipPillKind('assets/video/talk.mp4'), 'clipVideo');
  assert.equal(clipPillKind('assets/image/logo.png'), 'clipVideo');
  assert.equal(clipPillKind('assets/audio/vo/01.m4a'), 'clipVoice');
  assert.equal(clipPillKind('assets/audio/sfx/whoosh.mp3'), 'clipSfx');
  assert.equal(clipPillKind('assets/audio/music/bed.mp3'), 'clipMusic');
  assert.equal(clipPillKind('assets/video/talk.mp4', true), 'clipVoice');
});

test('a link to the project an agent writes is the reference it names, and the person\'s references are those links', () => {
  assert.deepEqual(refOfLink('film.html#t=12.5'), { kind: 'time', time: 12.5 });
  assert.deepEqual(refOfLink('./film.html#t=12,16'), { kind: 'range', start: 12, end: 16, clipIds: [] });
  assert.deepEqual(refOfLink('film.html#t=12.5&xywh=640,200,320,180'), { kind: 'region', time: 12.5, box: { x: 640, y: 200, w: 320, h: 180 }, clipIds: [], texts: [] });
  assert.equal(refOfLink('film.html#s3')?.kind, 'clip');
  assert.equal(refOfLink('film.html#s3')?.id, 's3');
  assert.deepEqual(refOfLink('assets/a%20b.mp3'), { kind: 'file', path: 'assets/a b.mp3', fileKind: '' });
  /* the film itself, a plugin's own file, an address, a way out of the project: a link, not a pill */
  for (const href of ['film.html', '.film/canvas.json#n1', 'https://openfilm.dev', '../x.mp4', 'film.html#t=6,3']) assert.equal(refOfLink(href), null, href);
  /* what the person points at reaches the agent as the link it would write back, and reads back as the same place */
  for (const ref of [
    { kind: 'time', time: 12.5 },
    { kind: 'range', start: 12, end: 16, clipIds: [] },
    { kind: 'region', time: 12.5, box: { x: 640, y: 200, w: 320, h: 180 }, clipIds: [], texts: [] },
    { kind: 'file', path: 'assets/a (1).mp3', fileKind: '' },
  ]) assert.deepEqual(refOfLink(linkOfRef(ref)), ref, JSON.stringify(ref));
  assert.equal(linkOfRef({ kind: 'file', path: 'assets/a (1).mp3', fileKind: '' }), 'assets/a%20%281%29.mp3', 'a Markdown link takes it whole');
  assert.equal(linkOfRef({ kind: 'track', track: 1, label: '', clipIds: [] }), null);
});
