import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { filmHtml } from '../../src/film-doc.mjs';
import { cueCss, readVtt } from '../../src/captions.mjs';
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
  assert.equal(vtt.regions.length, 1);
  assert.equal(vtt.styles.length, 1);
  assert.deepEqual(vtt.cues.map((c) => [c.id, c.start, c.end, c.settings]), [['c1', 0.5, 2, 'region:main align:center'], ['c2', 2, 4, 'region:main align:center']]);
  assert.equal(vtt.cues[0].text, 'Cut a film in three seconds');
  assert.equal(vtt.cues[1].text, '<v Ana><00:00:02.000>One <00:00:02.400>two</v>');
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

test('a project\'s subtitles from before become its caption track once, as they looked; the old way is off after', async () => {
  const root = project([{ clips: [{ id: 'vo', src: 'assets/vo.mp3' }] }], {
    'assets/vo.mp3': 'x',
    'assets/vo.vtt': 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello there\n',
    '.film/subtitles.json': JSON.stringify({ ...FILM_SUBTITLE_DEFAULT, ...FILM_SUBTITLE_LOOKS.yellow, pos: { x: 0.5, y: 0.8 } }),
  });
  const { base, close } = await serve(root);
  const retire = () => fetch(`${base}/caption-tracks/retire`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'Captions' }) }).then((r) => r.json());
  try {
    const { src } = await retire();
    assert.equal(src, 'captions/Captions.vtt');
    const film = readFileSync(join(root, 'film.html'), 'utf8');
    assert.match(film, /<section>\s*<track kind="captions" src="captions\/Captions\.vtt" label="Captions"/, 'on top of the film');
    const vtt = readVtt(readFileSync(join(root, src), 'utf8'));
    assert.equal(vtt.cues[0].text, 'Hello there');
    assert.match(vtt.styles[0], /color: #ffe14d/, 'the look it had');
    assert.match(vtt.regions[0], /viewportanchor:50%,80%/, 'where it sat');
    assert.equal(JSON.parse(readFileSync(join(root, '.film/subtitles.json'), 'utf8')).on, false);
    assert.deepEqual(await retire(), { src: null }, 'once');
  } finally { close(); }
  /* one that showed none: nothing made, the old way off all the same */
  const none = project([{ clips: [{ id: 'vo', src: 'assets/vo.mp3' }] }], { 'assets/vo.mp3': 'x' });
  const other = await serve(none);
  try {
    const got = await fetch(`${other.base}/caption-tracks/retire`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json());
    assert.deepEqual(got, { src: null });
    assert.equal(existsSync(join(none, 'captions')), false);
    assert.equal(JSON.parse(readFileSync(join(none, '.film/subtitles.json'), 'utf8')).on, false);
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
  } finally { close(); }
  const no = await serve(root);
  try {
    const res = await fetch(`${no.base}/caption-tracks/translate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ src: 'captions/Captions.vtt', language: 'zh' }) });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, 'no-translator');
  } finally { no.close(); }
});
