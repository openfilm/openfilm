import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipFade, clipKind, clipSpan, fadeGain, filmHtml, kindOf, parseFilm, pictureRect, readFilm, readFilmFile, sourceAt } from './film-doc.mjs';

const film = (clip) => ({ stage: { w: 1920, h: 1080 }, tracks: [{ clips: [clip] }] });
const problems = (value) => readFilm(value).problems.join('\n');
/** A film.html of these tracks (each a list of clip elements), with this head. */
const page = (tracks, head = '<meta name="viewport" content="width=1080, height=1920">') =>
  `<!doctype html>\n<html>\n<head>\n${head}\n</head>\n<body>\n${tracks.map((t) => `<section>\n${t.map((c) => `  ${c}\n`).join('')}</section>\n`).join('')}</body>\n</html>\n`;
const said = (text) => readFilmFile(text).problems.join('\n');

test('a film.html reads as its value: the viewport its stage, each section a track, each element a clip', () => {
  const { doc, problems: found } = readFilmFile(page([
    ['<iframe id="hook" src="01-hook.html#t=0,3.5"></iframe>'],
    [
      '<video id="talk" src="assets/source.mp4#t=412.3,428.8" at="75.019" speed="1.08" volume="1.5" class="card wide" style="left: 56px; top: 420px; width: 968px; rotate: -2deg; border-radius: 24px"></video>',
      '<img src="logo.png#t=0,4" at="2" alt="the logo">',
      '<audio src="assets/audio/music/bed.mp3#t=12" muted></audio>',
    ],
  ]));
  assert.deepEqual(found, []);
  assert.deepEqual(doc.stage, { w: 1080, h: 1920 });
  assert.deepEqual(doc.tracks[0].clips, [{ src: '01-hook.html', id: 'hook', time: [0, 3.5] }]);
  assert.deepEqual(doc.tracks[1].clips, [
    { src: 'assets/source.mp4', id: 'talk', at: 75.019, time: [412.3, 428.8], box: { x: 56, y: 420, w: 968, r: -2 }, volume: 1.5, speed: 1.08, class: 'card wide', style: 'border-radius: 24px' },
    { src: 'logo.png', id: 'logo', at: 2, time: [0, 4], attrs: { alt: 'the logo' } },
    { src: 'assets/audio/music/bed.mp3', id: 'bed', time: [12], volume: 0 },
  ]);
});

test('written back, an unchanged film is the same text; a change rewrites only its own element', () => {
  const text = page([
    ['<!-- the opening -->', '<iframe id="hook" src="01-hook.html#t=0,3.5"></iframe>'],
    ['<video id="talk"   src="a.mp4"  class="card"\n         style="left: 0px; top: 0px; width: 100px"></video>', '<audio id="bed" src="bed.mp3"></audio>'],
  ], '<meta name="viewport" content="width=1080, height=1920">\n<style>\n  .card { object-fit: cover; }\n</style>');
  const { value } = readFilmFile(text);
  assert.equal(filmHtml(value, text), text);
  value.tracks[1].clips[1].at = 4;
  const out = filmHtml(value, text);
  assert.ok(out.includes('<video id="talk"   src="a.mp4"  class="card"\n         style="left: 0px; top: 0px; width: 100px"></video>'), 'the clip that did not change keeps its text');
  assert.ok(out.includes('<audio id="bed" src="bed.mp3" at="4"></audio>'));
  assert.ok(out.includes('<!-- the opening -->\n  <iframe id="hook"'), 'a comment stays with the clip after it');
  assert.ok(out.includes('.card { object-fit: cover; }'), 'the head is the file\'s own');
});

test('a clip moved to another track takes its text along; a new track and a new stage are written', () => {
  const text = page([['<img id="a" src="a.png#t=0,2">'], ['<img id="b" src="b.png#t=0,2" at="2">']]);
  const { value } = readFilmFile(text);
  value.tracks[0].clips.push(value.tracks[1].clips.pop());
  value.tracks.push({ clips: [], hidden: true });
  value.stage = { w: 1920, h: 1080 };
  const out = filmHtml(value, text);
  assert.match(out, /<section>\n {2}<img id="a" src="a.png#t=0,2">\n {2}<img id="b" src="b.png#t=0,2" at="2">\n<\/section>\n<section>\n<\/section>\n<section hidden>\n<\/section>/);
  assert.match(out, /<meta name="viewport" content="width=1920, height=1080">/);
  assert.deepEqual(readFilmFile(out).doc.tracks.map((t) => t.clips.length), [2, 0, 0]);
});

test('a clip written without an id gets its name written, so it stays put', () => {
  const text = page([['<audio src="vo/line.m4a"></audio>', '<audio src="vo/line.m4a" at="3"></audio>']]);
  const { value, doc } = readFilmFile(text);
  assert.deepEqual(doc.tracks[0].clips.map((c) => c.id), ['line', 'line-2']);
  assert.match(filmHtml(value, text), /<audio id="line" src="vo\/line.m4a"><\/audio>\n {2}<audio id="line-2" src="vo\/line.m4a" at="3"><\/audio>/);
});

test('a new film is a whole page; a box at 0, 0 is written as one', () => {
  const out = filmHtml({ stage: { w: 1080, h: 1920 }, tracks: [{ clips: [{ src: 'a.mp4', id: 'a', box: { x: 0, y: 0 }, time: [0, 2] }] }] });
  assert.equal(out, '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=1080, height=1920">\n</head>\n<body>\n'
    + '<section>\n  <video id="a" src="a.mp4#t=0,2" style="left: 0px; top: 0px"></video>\n</section>\n</body>\n</html>\n');
  assert.deepEqual(readFilmFile(out).doc.tracks[0].clips[0].box, { x: 0, y: 0 });
});

test('the head, body and html tags may be left out, as in any page', () => {
  const { doc, problems: found } = readFilmFile('<meta name="viewport" content="width=640, height=360">\n<section><img src="a.png#t=0,1"></section>\n');
  assert.deepEqual(found, []);
  assert.deepEqual(doc.stage, { w: 640, h: 360 });
  assert.equal(doc.tracks[0].clips[0].src, 'a.png');
  assert.deepEqual(readFilmFile('<section></section>').doc.stage, { w: 1920, h: 1080 }, 'without a viewport, 1920 × 1080');
});

test('every problem is said at once, at its line, with what to write instead', () => {
  const text = page([[
    '<video src="a.mp4" autoplay data-start="2" time="1 4" style="transform: scale(2); left: 10%"></video>',
    '<div>hi</div>',
    '<img src="b.mp4">',
  ]]);
  const found = said(text);
  assert.match(found, /film\.html:8: <video src="a\.mp4">: autoplay is not an attribute of a clip → nothing: the film plays its clips itself/);
  assert.match(found, /data-start is not an attribute of a clip → at="…"/);
  assert.match(found, /time is not an attribute of a clip → the part of the file goes on src as a media fragment: src="a\.mp4#t=2,6"/);
  assert.match(found, /transform would move the clip — a picture is placed by left, top, width, height and rotate/);
  assert.match(found, /left is stage px, like left: 120px — "10%" is not/);
  assert.match(found, /film\.html:9: <div> in a track — a track holds clips/);
  assert.match(found, /film\.html:10: <img src="b\.mp4">: "b\.mp4" is a video, a clip of <video> — <img> is for a still/);
  assert.equal(found.split('\n').length, 7, 'the <div> is said once, not its text and end tag too');
});

test('what says nothing to the film is kept: a track\'s id, class or label, a sound\'s class', () => {
  const text = '<section id="voices" class="vo" aria-label="Voice-over"><audio id="v1" src="vo/1.wav" class="voice" lang="zh"></audio></section>';
  const { doc, value, problems: found } = readFilmFile(text);
  assert.deepEqual(found, []);
  assert.deepEqual(doc.tracks[0].attrs, { id: 'voices', class: 'vo', 'aria-label': 'Voice-over' });
  assert.deepEqual(doc.tracks[0].clips[0].attrs, { class: 'voice', lang: 'zh' });
  /* a flag changed: the section is written anew, and keeps them */
  value.tracks[0].muted = true;
  assert.match(filmHtml(value, text), /<section id="voices" class="vo" aria-label="Voice-over" muted>/);
  assert.match(said('<section role="list"></section>'), /role is not an attribute of a track/);
});

test('an <audio> of a video file is that video\'s sound alone, its picture a clip of its own', () => {
  const text = page([['<video id="v" src="talk.mp4#t=4,9" at="2" muted></video>'], ['<audio id="v-sound" src="talk.mp4#t=4,9" at="2" speed="1.5"></audio>']]);
  const { doc, value, problems: found } = readFilmFile(text);
  assert.deepEqual(found, []);
  const sound = doc.tracks[1].clips[0];
  assert.deepEqual(sound, { src: 'talk.mp4', id: 'v-sound', sound: true, at: 2, time: [4, 9], speed: 1.5 });
  assert.equal(kindOf(sound), 'sound');
  assert.equal(kindOf(doc.tracks[0].clips[0]), 'video');
  assert.equal(filmHtml(value, text), text);
  /* written new, it is an <audio> again */
  assert.match(filmHtml({ stage: { w: 10, h: 10 }, tracks: [{ clips: [sound] }] }), /<audio id="v-sound" src="talk.mp4#t=4,9" at="2" speed="1.5"><\/audio>/);
  assert.match(problems(film({ src: 'a.wav', sound: true })), /sound is true, on a clip of a video file's sound alone/);
});

test('a film runs no script, and holds nothing but tracks of clips', () => {
  assert.match(said(page([[]], '<script>go()</script>')), /film\.html:4: a film runs no script/);
  assert.match(said('<section><video src="a.mp4"><source src="a.webm"></video></section>'), /<video src="a\.mp4"> holds nothing: its file is its own src/);
  assert.match(said('<p>Title</p>'), /<p> — a film's body is its tracks/);
  assert.match(said('<section><video src="a.mp4"></section>'), /<video src="a\.mp4"> has no <\/video>/);
  assert.match(said('<section><video src="a.mp4#start=2"></video></section>'), /src's fragment says which seconds of the file it plays, like src="a\.mp4#t=2,6"/);
  assert.match(said(page([[]], '<style>.card { transition: opacity 1s }</style>')), /film\.html:4: a film's CSS holds still/);
  assert.match(said('<section><img src="a.png#t=0,1" style="animation: spin 2s"></section>'), /a film's CSS holds still/);
  assert.equal(said(page([[]], '<style>.card { border-radius: 8px }</style>')), '');
  assert.match(said('<section><iframe src="a.html" volume="0.5"></iframe><img src="b.png#t=0,1" speed="2"></section>'), /a page has no sound: a sound is a clip of its own[\s\S]*a still has no speed/);
});

test('what the value says wrong is said at the clip\'s line', () => {
  const found = said(page([['<img src="a.png#t=0,2">'], ['<video id="x" src="a.mp4#t=5,2"></video>', '<video id="x" src="b.mp4" speed="9"></video>']]));
  assert.match(found, /film\.html:11: its part of the file \(#t=5,2\) has to end after it starts/);
  assert.match(found, /film\.html:12: speed has to be a number from 0.25 to 4/);
});

test('media fragments: seconds, a start alone, clock times', () => {
  const clip = (src) => readFilmFile(`<section><video src="${src}"></video></section>`).doc.tracks[0].clips[0];
  assert.deepEqual(clip('a.mp4#t=2,6').time, [2, 6]);
  assert.deepEqual(clip('a.mp4#t=2').time, [2]);
  assert.deepEqual(clip('a.mp4#t=,6').time, [0, 6]);
  assert.deepEqual(clip('a.mp4#t=npt:1:02.5,1:10').time, [62.5, 70]);
  assert.equal(clip('a.mp4#t=0').time, undefined);
});

/* ── the value ── */

test('a valid edit comes back with its fields in their written order', () => {
  const doc = parseFilm(film({ overrides: [{ text: 'Hi', at: '#t' }], at: 1, src: 'scenes/a.html', box: { r: 5, w: 480, y: 2, x: 1 } }));
  const clip = doc.tracks[0].clips[0];
  assert.deepEqual(Object.keys(clip), ['src', 'id', 'at', 'box', 'overrides']);
  assert.deepEqual(Object.keys(clip.box), ['x', 'y', 'w', 'r']);
  assert.deepEqual(Object.keys(clip.overrides[0]), ['at', 'text']);
  assert.equal(clip.id, 'a');
});

test('a page has no sound and no speed: its clip takes neither, a video or a sound clip does', () => {
  assert.match(problems(film({ src: 'scenes/a.html', volume: 0.5 })), /"scenes\/a.html": unrecognised field: volume/);
  assert.match(problems(film({ src: 'scenes/a.html', speed: 2 })), /unrecognised field: speed/);
  assert.equal(problems(film({ src: 'a.mp4', volume: 0.5 })), '');
  assert.equal(problems(film({ src: 'c.mp3', volume: 0.5, speed: 2 })), '');
  assert.match(problems(film({ src: 'c.mp3', class: 'x' })), /unrecognised field: class/, 'a sound has no look');
});

test('a clip starts at 0 or later on the film', () => {
  assert.match(problems(film({ src: 'a.mp4', at: -3 })), /at has to be seconds from the film's start/);
  assert.equal(problems(film({ src: 'a.mp4', at: 0 })), '');
});

test('ids: missing ones are named after their source, duplicates refused', () => {
  const value = { stage: { w: 1, h: 1 }, tracks: [{ clips: [{ src: 'assets/audio/vo/line.m4a' }, { src: 'assets/audio/vo/line.m4a' }] }] };
  assert.deepEqual(parseFilm(value).tracks[0].clips.map((c) => c.id), ['line', 'line-2']);
  assert.match(problems({ stage: { w: 1, h: 1 }, tracks: [{ clips: [{ id: 'x', src: 'a.mp4' }, { id: 'x', src: 'b.mp4' }] }] }), /both have the id "x"/);
});

test('the value has only stage and tracks', () => {
  assert.match(readFilm({ tracks: [], subtitles: { language: 'en' } }).problems[0], /is a stage and its tracks; there is nothing else: subtitles/);
  assert.throws(() => parseFilm({ stage: { w: 0, h: 1 }, tracks: [] }), /^Error: film\.html wants a picture size of positive whole numbers: <meta name="viewport"/);
  assert.deepEqual(parseFilm({ tracks: [] }).stage, { w: 1920, h: 1080 });
});

test('a place (its box) is checked', () => {
  assert.match(problems(film({ src: 'a.mp4', box: { w: 100 } })), /its place needs left and top/);
  assert.match(problems(film({ src: 'a.mp4', box: { x: 0, y: 0, w: 0 } })), /width has to be px above 0/);
  assert.match(problems(film({ src: 'c.mp3', box: { x: 0, y: 0 } })), /unrecognised field: box/);
  assert.equal(problems(film({ src: 'a.mp4', box: { x: -20, y: 30.5, h: 200, r: -15 } })), '');
});

test('clipSpan: trims, speed, stills and pages', () => {
  assert.deepEqual(clipSpan({ src: 'a.mp4', time: [2, 8], speed: 2 }, 10), { from: 2, to: 8, speed: 2, length: 3 });
  assert.deepEqual(clipSpan({ src: 'a.mp4' }, 10), { from: 0, to: 10, speed: 1, length: 10 });
  assert.deepEqual(clipSpan({ src: 'a.png', time: [1, 5] }, undefined), { from: 1, to: 5, speed: 1, length: 4 });
  assert.throws(() => clipSpan({ src: 'a.png', time: [4] }, undefined, 'w'), /a still has no length of its own/);
  assert.throws(() => clipSpan({ src: 'a.mp4', time: [2, 12] }, 10, 'w'), /#t=2,12 ends past the file's length of 10 s/);
  /* a page without a duration has no end: its #t= is its length, and without one it is said */
  assert.deepEqual(clipSpan({ src: 'p.html', time: [1, 5] }, undefined), { from: 1, to: 5, speed: 1, length: 4 });
  assert.throws(() => clipSpan({ src: 'p.html', time: [1] }, undefined, 'clip "p" (p.html)'), /clip "p" \(p\.html\): this page has no duration, so it has no end of its own/);
  assert.deepEqual(clipSpan({ src: 'p.html' }, 6), { from: 0, to: 6, speed: 1, length: 6 });
  /* a page may run past its end (it holds its last frame), and ignores speed */
  assert.deepEqual(clipSpan({ src: 'p.html', time: [0, 9], speed: 2 }, 6), { from: 0, to: 9, speed: 1, length: 9 });
  assert.equal(sourceAt({ from: 0, to: 9, speed: 1, length: 9 }, 8, { src: 'p.html' }, 6), 6 - 1e-3);
  assert.equal(sourceAt({ from: 2, to: 8, speed: 2, length: 3 }, 1.5, { src: 'a.mp4' }), 5);
  assert.deepEqual(['s/a.html', 'a.mp4', 'b.png', 'c.mp3', 'x.txt'].map(clipKind), ['page', 'video', 'still', 'sound', null]);
});

test('pictureRect: a video or still is its box; a page is fitted whole inside its box, centered', () => {
  const stage = { w: 1920, h: 1080 };
  const portrait = { w: 1080, h: 1920 };
  /* no box: a video or still is the stage (its CSS fits the picture in it); a page is its own size, the stage's when
     it says none */
  assert.deepEqual(pictureRect('video', portrait, stage), { x: 0, y: 0, w: 1920, h: 1080, r: 0 });
  assert.deepEqual(pictureRect('page', { w: 480, h: 320 }, stage), { x: 720, y: 380, w: 480, h: 320, r: 0 });
  assert.deepEqual(pictureRect('page', null, stage), { x: 0, y: 0, w: 1920, h: 1080, r: 0 });
  /* x and y only: its own size there */
  assert.deepEqual(pictureRect('page', { w: 480, h: 320 }, stage, { x: 200, y: 300 }), { x: 200, y: 300, w: 480, h: 320, r: 0 });
  assert.deepEqual(pictureRect('video', portrait, stage, { x: 10, y: 20 }), { x: 10, y: 20, w: 1080, h: 1920, r: 0 });
  /* one of w and h: the other follows the picture's proportions */
  assert.deepEqual(pictureRect('page', { w: 480, h: 320 }, stage, { x: 200, y: 300, w: 960 }), { x: 200, y: 300, w: 960, h: 640, r: 0 });
  assert.deepEqual(pictureRect('video', portrait, stage, { x: 0, y: 0, h: 960 }), { x: 0, y: 0, w: 540, h: 960, r: 0 });
  /* a box of another shape: a video is that box; a page is fitted whole inside it */
  assert.deepEqual(pictureRect('video', portrait, stage, { x: 100, y: 100, w: 1000, h: 960 }), { x: 100, y: 100, w: 1000, h: 960, r: 0 });
  assert.deepEqual(pictureRect('page', { w: 480, h: 320 }, stage, { x: 0, y: 0, w: 480, h: 480 }), { x: 0, y: 80, w: 480, h: 320, r: 0 });
  assert.deepEqual(pictureRect('still', { w: 100, h: 100 }, stage, { x: 10, y: 10, w: 200, h: 100, r: 30 }), { x: 10, y: 10, w: 200, h: 100, r: 30 });
});

/* ── fades: the clip's own entry in overrides ── */

test('fades: any clip takes them, as the overrides entry without at, read to the millisecond and written back alike', () => {
  const text = page([[
    `<video id="v" src="a.mp4#t=0,4" overrides='[{"fade":[0.5,0.25]}]'></video>`,
    `<audio id="s" src="b.mp3#t=1,3" overrides='[{"fade":[0.12345,0]}]'></audio>`,
    `<img id="i" src="c.png#t=0,2" overrides='[{"fade":[0,1]}]'>`,
    `<iframe id="p" src="t.html#t=0,3" overrides='[{"at":"#t","text":"Hi"},{"fade":[0.3,0.3]}]'></iframe>`,
  ]]);
  const { doc, value, problems: found } = readFilmFile(text);
  assert.deepEqual(found, []);
  const [v, s, i, p] = doc.tracks[0].clips;
  assert.deepEqual(v.overrides, [{ fade: [0.5, 0.25] }]);
  assert.deepEqual(s.overrides, [{ fade: [0.123, 0] }]);
  assert.deepEqual(clipFade(i), [0, 1]);
  assert.deepEqual(clipFade(p), [0.3, 0.3]);
  assert.equal(clipFade({ src: 'a.mp4' }), null);
  /* unchanged, the same text; changed, minimal JSON */
  assert.equal(filmHtml(value, text), text);
  value.tracks[0].clips[0].overrides = [{ fade: [1, 0] }];
  assert.ok(filmHtml(value, text).includes(`<video id="v" src="a.mp4#t=0,4" overrides='[{"fade":[1,0]}]'></video>`));
});

test('fades are checked: seconds 0 or more, one entry of the clip\'s own, in + out within its length; element entries stay a page\'s', () => {
  const v = (overrides, more = {}) => problems(film({ src: 'a.mp4', time: [0, 2], overrides, ...more }));
  assert.equal(v([{ fade: [1, 1] }]), '');
  assert.equal(v([{ fade: [0, 0] }]), '');
  assert.match(v([{ fade: [-1, 0] }]), /fade has to be \[in, out\]: seconds, 0 or more/);
  assert.match(v([{ fade: [1] }]), /fade has to be \[in, out\]/);
  assert.match(v([{ fade: [1, 0], style: { opacity: 0.5 } }]), /holds fade only: unrecognised field: style/);
  assert.match(v([{ fade: [1.5, 1] }]), /fade \[1\.5, 1\] is longer than the clip \(2 s\)/);
  /* the length is on the film: at speed 2 a clip of 2 source seconds lasts 1 */
  assert.match(v([{ fade: [0.6, 0.6] }], { speed: 2 }), /longer than the clip \(1 s\)/);
  assert.match(v([{ fade: [0.1, 0] }, { fade: [0, 0.1] }]), /one entry of the clip's own/);
  assert.match(v([{ at: '#t', text: 'x' }]), /at names an element inside a web page; this clip is not one/);
  assert.match(problems(film({ src: 'p.html', time: [0, 3], overrides: [{ at: '#t', fade: [1, 0] }] })), /unrecognised field: fade/);
  /* a length the file does not say (a video to its end) is not checked here: the host fits the fades in */
  assert.equal(problems(film({ src: 'a.mp4', overrides: [{ fade: [30, 30] }] })), '');
  assert.match(said(page([[`<video src="a.mp4#t=0,1" overrides='[{"fade":[1,1]}]'></video>`]])), /^film\.html:8: fade \[1, 1\] is longer than the clip/);
});

test('fadeGain: a straight ramp in and out, fitted to the clip when longer than it', () => {
  assert.equal(fadeGain(0, 4, [1, 2]), 0);
  assert.equal(fadeGain(0.5, 4, [1, 2]), 0.5);
  assert.equal(fadeGain(1.5, 4, [1, 2]), 1);
  assert.equal(fadeGain(3, 4, [1, 2]), 0.5);
  assert.equal(fadeGain(4, 4, [1, 2]), 0);
  assert.equal(fadeGain(2, 4, null), 1);
  /* 3 + 3 in 2 s: each shortened to 1 s */
  assert.equal(fadeGain(0.5, 2, [3, 3]), 0.5);
  assert.equal(fadeGain(1, 2, [3, 3]), 1);
});
