import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { filmHtml } from '../../src/film-doc.mjs';
import { clipsNote, cueCss, madeOfSpeech, readVtt, speechClips, speechNote } from '../../src/captions.mjs';
import { captionTrackRoutes, subtitleStyleVtt, subtitlesVtt } from './caption-tracks.mjs';
import { FILM_SUBTITLE_DEFAULT, FILM_SUBTITLE_LOOKS } from './film-subtitle.mjs';
import { HttpError, json } from './http.mjs';

function project(tracks, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'of-caption-tracks-'));
  writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 1920, h: 1080 }, tracks }));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

async function serve(root, options) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    captionTrackRoutes(req, res, root, url.pathname.slice(1), url, options).then((done) => { if (!done) json(res, 404, {}); }, (e) => {
      json(res, e instanceof HttpError ? e.status : 500, { error: e.message, ...(e instanceof HttpError ? e.extra : {}) });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('a subtitle style says itself as WebVTT: a region where the lines sit, CSS for how they look, karaoke as :past', () => {
  const style = { ...FILM_SUBTITLE_DEFAULT, ...FILM_SUBTITLE_LOOKS['yellow-box'], pos: { x: 0.5, y: 0.9 }, maxWidthPct: 80, karaoke: { mode: 'color', color: '#ffd400' } };
  const { region, css, align } = subtitleStyleVtt(style);
  assert.match(region, /^id:main\nwidth:80%\nlines:3\nregionanchor:50%,100%\nviewportanchor:50%,90%$/);
  assert.match(css, /^::cue \{ font: \d+ [\d.]+cqmin\/[\d.]+ .+; color: #[0-9a-f]{6}; background: rgba\(/m);
  assert.match(css, /::cue\(:past\) \{ color: #ffd400; \}/);
  assert.equal(align, style.align);
  /* the page reads it as any caption track's CSS */
  assert.match(cueCss(css, '[x]'), /\[x\] \.cue-text \{ font:/);
});

test('subtitles become cues c1, c2… on the film\'s time, words timed, a speaker as a voice', () => {
  const text = subtitlesVtt([
    { startMs: 500, durMs: 1500, text: 'Cut a film in three seconds' },
    { startMs: 2000, durMs: 2000, text: 'One two', speaker: 'Ana', words: [{ text: 'One', startMs: 2000, durMs: 400 }, { text: 'two', startMs: 2400, durMs: 600 }] },
  ], FILM_SUBTITLE_DEFAULT);
  const vtt = readVtt(text);
  assert.equal(madeOfSpeech(vtt), true, 'noted as made of what is said');
  assert.equal(madeOfSpeech(readVtt('WEBVTT\n\nc1\n00:00:01.000 --> 00:00:02.000\nHi\n')), false);
  assert.equal(vtt.regions.length, 1);
  assert.equal(vtt.styles.length, 1);
  assert.deepEqual(vtt.cues.map((c) => [c.id, c.start, c.end, c.settings]), [['c1', 0.5, 2, 'region:main align:center'], ['c2', 2, 4, 'region:main align:center']]);
  assert.equal(vtt.cues[0].text, 'Cut a film in three seconds');
  assert.equal(vtt.cues[1].text, '<v Ana><00:00:02.000>One <00:00:02.400>two</v>');
  /* the line's own spaces and marks stay between its timed words */
  const marked = readVtt(subtitlesVtt([{ startMs: 0, durMs: 1000, text: 'Comfortable, right?', words: [{ text: 'Comfortable,', startMs: 0, durMs: 500 }, { text: 'right?', startMs: 500, durMs: 500 }] }], FILM_SUBTITLE_DEFAULT));
  assert.equal(marked.cues[0].text, '<00:00:00.000>Comfortable, <00:00:00.500>right?');
});

test('the routes: a caption track\'s file read and written whole, inside the project only; the subtitles made into one', async () => {
  const root = project([{ clips: [{ id: 'vo', src: 'assets/vo.mp3' }] }], {
    'assets/vo.mp3': 'x',
    'assets/vo.vtt': 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello there\n',
  });
  const { base, close } = await serve(root);
  const call = (method, path, body) => fetch(`${base}/${path}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  try {
    const made = await (await call('POST', 'caption-tracks/from-subtitles', { name: 'Subtitles' })).json();
    assert.equal(made.src, 'captions/Subtitles.vtt');
    assert.equal(readVtt(made.text).cues[0].text, 'Hello there');
    assert.equal((await (await call('POST', 'caption-tracks/from-subtitles', { name: 'Subtitles' })).json()).src, 'captions/Subtitles-2.vtt', 'a name taken gets a number');
    /* what is said, as a caption file's text, written nowhere */
    const said = await (await call('GET', 'caption-tracks/speech')).json();
    assert.equal(readVtt(said.text).cues[0].text, 'Hello there');
    assert.equal(existsSync(join(root, 'captions', 'Subtitles-3.vtt')), false);
    assert.equal((await call('PUT', 'caption-tracks/file', { src: 'captions/Subtitles.vtt', text: 'WEBVTT\n\nc1\n00:00:01.000 --> 00:00:02.000\nHi\n' })).status, 200);
    assert.equal(readFileSync(join(root, 'captions', 'Subtitles.vtt'), 'utf8'), 'WEBVTT\n\nc1\n00:00:01.000 --> 00:00:02.000\nHi\n');
    assert.equal((await (await call('GET', 'caption-tracks/file?src=captions%2FSubtitles.vtt')).json()).text.includes('Hi'), true);
    assert.equal((await call('GET', 'caption-tracks/file?src=captions%2Fnone.vtt')).status, 404);
    for (const src of ['../out.vtt', '.film/x.vtt', 'captions/a.txt']) assert.equal((await call('PUT', 'caption-tracks/file', { src, text: 'WEBVTT' })).status, 400, src);
  } finally { close(); }
});

test('a new caption track\'s file: none, a WebVTT file as it is, an SRT file\'s cues as WebVTT; text with no cue is refused', async () => {
  const root = project([]);
  const { base, close } = await serve(root);
  const call = (body) => fetch(`${base}/caption-tracks/new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const blank = await (await call({ name: 'Captions' })).json();
    assert.deepEqual(blank, { src: 'captions/Captions.vtt', text: 'WEBVTT\n' });
    const vtt = 'WEBVTT\n\nintro\n00:00:01.000 --> 00:00:02.000\nHi\n';
    assert.equal((await (await call({ name: 'Captions', text: vtt })).json()).text, vtt);
    const srt = await (await call({ name: 'film', text: '\uFEFF1\r\n00:00:01,000 --> 00:00:02,500\r\n{\\an8}Hello <i>there</i>\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nTwo\r\n' })).json();
    assert.equal(srt.src, 'captions/film.vtt');
    assert.deepEqual(readVtt(srt.text).cues.map((c) => [c.id, c.start, c.end, c.text]), [['c1', 1, 2.5, 'Hello <i>there</i>'], ['c2', 3, 4, 'Two']]);
    assert.equal(readFileSync(join(root, 'captions', 'film.vtt'), 'utf8'), srt.text);
    assert.equal((await call({ text: 'not captions' })).status, 400);
  } finally { close(); }
});

test('the captions of what is said: put on top once something is said, written again after a cut while no one changed them, then theirs', async () => {
  const transcript = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello there\n';
  const root = project([{ clips: [{ id: 'vo', src: 'assets/vo.mp3' }] }], {
    'assets/vo.mp3': 'x',
    'assets/vo.vtt': transcript,
    '.film/subtitles.json': JSON.stringify({ ...FILM_SUBTITLE_DEFAULT, ...FILM_SUBTITLE_LOOKS.yellow, pos: { x: 0.5, y: 0.8 } }),
  });
  const { base, close } = await serve(root);
  const sync = () => fetch(`${base}/caption-tracks/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'Captions' }) }).then((r) => r.json());
  const file = () => readVtt(readFileSync(join(root, 'captions', 'Captions.vtt'), 'utf8'));
  const cut = (at) => writeFileSync(join(root, 'film.html'), readFileSync(join(root, 'film.html'), 'utf8').replace(/<audio id="vo"[^>]*>/, `<audio id="vo" src="assets/vo.mp3" at="${at}">`));
  try {
    assert.deepEqual(await sync(), { made: 'captions/Captions.vtt' });
    assert.match(readFileSync(join(root, 'film.html'), 'utf8'), /<section>\s*<track kind="captions" src="captions\/Captions\.vtt" label="Captions"/, 'on top of the film');
    assert.equal(file().cues[0].text, 'Hello there');
    assert.match(file().styles[0], /color: #ffe14d/, 'in the look the subtitles had');
    assert.deepEqual(await sync(), {}, 'nothing changed: nothing written');
    /* the voice moved: its captions with it */
    cut(3);
    assert.deepEqual(await sync(), { updated: 'captions/Captions.vtt' });
    assert.deepEqual(file().cues.map((c) => [c.start, c.end]), [[3, 5]]);
    /* a caption changed by hand: the track is the person's, another cut leaves it */
    writeFileSync(join(root, 'captions', 'Captions.vtt'), readFileSync(join(root, 'captions', 'Captions.vtt'), 'utf8').replace('Hello there', 'Hello, there'));
    cut(4);
    assert.deepEqual(await sync(), {});
    assert.equal(file().cues[0].start, 3);
    /* the track taken out: not put back */
    writeFileSync(join(root, 'film.html'), readFileSync(join(root, 'film.html'), 'utf8').replace(/<section>\s*<track[^>]*>\s*<\/section>\s*/, ''));
    assert.deepEqual(await sync(), {});
  } finally { close(); }
  /* nothing said: nothing made */
  const none = project([{ clips: [{ id: 'vo', src: 'assets/vo.mp3' }] }], { 'assets/vo.mp3': 'x' });
  const other = await serve(none);
  try {
    const got = await fetch(`${other.base}/caption-tracks/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json());
    assert.deepEqual(got, {});
    assert.equal(existsSync(join(none, 'captions')), false);
  } finally { other.close(); }
});

test('a caption track translated: a new file, the same cues at the same times and places, the words the other language\'s', async () => {
  const root = project([], { 'captions/Captions.vtt': 'WEBVTT\n\nSTYLE\n::cue { color: #fff; }\n\nc1\n00:00:01.000 --> 00:00:02.000 line:80%\n<v Ana>Hello</v>\n\nc2\n00:00:02.000 --> 00:00:03.000\nBye & see you\n' });
  const asked = [];
  const { base, close } = await serve(root, { translate: async () => async (job) => { asked.push(job); return job.lines.map((l) => `[${l}]`); } });
  const call = (body) => fetch(`${base}/caption-tracks/translate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const made = await (await call({ src: 'captions/Captions.vtt', language: 'zh' })).json();
    assert.equal(made.src, 'captions/Captions.zh.vtt');
    assert.deepEqual(asked[0].lines, ['Hello', 'Bye & see you']);
    const vtt = readVtt(made.text);
    assert.deepEqual(vtt.cues.map((c) => [c.id, c.start, c.end, c.settings, c.text]), [['c1', 1, 2, 'line:80%', '[Hello]'], ['c2', 2, 3, '', '[Bye &amp; see you]']]);
    assert.equal(vtt.styles[0], '::cue { color: #fff; }');
    assert.equal((await call({ src: 'captions/Captions.vtt', language: 'xx' })).status, 400);
    /* captions given whole (what is said, kept nowhere): translated alone, no longer Studio's words of the speech */
    const said = `WEBVTT\n\n${speechNote([{ id: 'c1', start: 0, end: 1, settings: '', text: 'Hi' }])}\n\n${clipsNote(['assets/a.mp3'])}\n\nc1\n00:00:00.000 --> 00:00:01.000\nHi\n`;
    /* a line timed word by word: its translation's words timed across it */
    const words = await (await call({ text: 'WEBVTT\n\nc1\n00:00:00.000 --> 00:00:02.000\n<00:00:00.000>Hi <00:00:01.000>you\n', language: 'en', name: 'Timed.en' })).json();
    assert.match(readVtt(words.text).cues[0].text, /^<00:00:00\.000>\[Hi <00:00:\d{2}\.\d{3}>you\]$/);
    const alone = await (await call({ text: said, language: 'en', name: 'Captions.en' })).json();
    assert.equal(alone.src, 'captions/Captions.en.vtt');
    const out = readVtt(alone.text);
    assert.equal(out.cues[0].text, '[Hi]');
    assert.equal(madeOfSpeech(out), false);
    assert.equal(speechClips(out), null);
  } finally { close(); }
  const no = await serve(root);
  try {
    const res = await fetch(`${no.base}/caption-tracks/translate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ src: 'captions/Captions.vtt', language: 'zh' }) });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, 'no-translator');
  } finally { no.close(); }
});

test('captions of some media only: what they say alone, the file saying which, followed by them alone', async () => {
  const root = project([{ clips: [{ id: 'a', src: 'assets/a.mp3' }, { id: 'b', src: 'assets/b.mp3', at: 3 }] }], {
    'assets/a.mp3': 'x', 'assets/a.vtt': 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nFrom a\n',
    'assets/b.mp3': 'x', 'assets/b.vtt': 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nFrom b\n',
  });
  const { base, close } = await serve(root);
  try {
    const made = await (await fetch(`${base}/caption-tracks/from-subtitles`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'B', clips: ['assets/b.mp3'] }) })).json();
    const vtt = readVtt(made.text);
    assert.deepEqual(vtt.cues.map((c) => [c.start, c.text]), [[3, 'From b']]);
    assert.deepEqual(speechClips(vtt), ['assets/b.mp3']);
    const said = await (await fetch(`${base}/caption-tracks/speech?clips=${encodeURIComponent('assets/a.mp3')}`)).json();
    assert.deepEqual(readVtt(said.text).cues.map((c) => c.text), ['From a']);
  } finally { close(); }
});
