import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import {
  CaptionError, SUBTITLE_STYLE_FILE, captionRoutes, captionText, filmCaptions, readSubtitleStyle, spokenLines,
  translateFilmSubtitles, writeSubtitleStyle,
} from './captions.mjs';
import { FILM_SUBTITLE_DEFAULT, filmSubtitleShown, filmSubtitleSrt, filmSubtitleVtt } from './film-subtitle.mjs';
import { HttpError, json } from './http.mjs';
import { vttOf } from './transcripts.mjs';
import { filmHtml } from '../../src/film-doc.mjs';

/* "One two three. Four five six.", said in 2.5 s of a 3 s file */
const TEXT = 'One two three. Four five six.';
const WORDS = [
  { token: 'One', startSec: 0, endSec: 0.3 }, { token: 'two', startSec: 0.3, endSec: 0.6 }, { token: 'three.', startSec: 0.6, endSec: 1 },
  { token: 'Four', startSec: 1.5, endSec: 1.8 }, { token: 'five', startSec: 1.8, endSec: 2.1 }, { token: 'six.', startSec: 2.1, endSec: 2.5 },
];
const noProbe = { duration: async () => undefined };
/** The transcript `openfilm get tts` writes for TEXT: its lines, timed word by word. */
const VTT = vttOf(spokenLines(TEXT, WORDS, 3000));

/** A project folder: film.html from `tracks`, and `files` (path → text). */
function project(tracks, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'of-captions-'));
  writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 1920, h: 1080 }, tracks }));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

const shown = (cues) => cues.map(({ startMs, durMs, text, clip }) => ({ startMs, durMs, text, clip }));

test('a transcript breaks into lines at sentence ends, timed by its words', () => {
  assert.deepEqual(spokenLines(TEXT, WORDS, 3000).map(({ text, startMs, endMs }) => ({ text, startMs, endMs })), [
    { text: 'One two three.', startMs: 0, endMs: 1500 },
    { text: 'Four five six.', startMs: 1500, endMs: 3000 },
  ]);
  /* performance tags for TTS are not words */
  assert.equal(spokenLines('[laughs] Hi there.', undefined, 1000)[0].text, 'Hi there.');
  assert.deepEqual(spokenLines('', WORDS, 3000), []);
});

test('subtitles leave out fillers and false starts', () => {
  assert.equal(captionText('uh, so we th- the plan'), 'so we the plan');
  assert.equal(captionText('um...'), '');
});

test('a voice clip says its transcript\'s lines where it sits on the film, each word timed, each line traced to its source', async () => {
  const root = project([{ clips: [{ id: 'vo', src: 'assets/vo.mp3', at: 10 }] }], { 'assets/vo.vtt': VTT });
  const { cues, untranscribed } = await filmCaptions(root, noProbe);
  assert.deepEqual(shown(cues), [
    { startMs: 10000, durMs: 1500, text: 'One two three.', clip: 'vo' },
    { startMs: 11500, durMs: 1500, text: 'Four five six.', clip: 'vo' },
  ]);
  assert.deepEqual(cues[1].words, [{ text: 'Four', startMs: 11500, durMs: 300 }, { text: 'five', startMs: 11800, durMs: 300 }, { text: 'six.', startMs: 12100, durMs: 900 }], 'the last word lasts until its line ends');
  assert.deepEqual([cues[1].src, cues[1].line], ['assets/vo.mp3', 1500]);
  assert.deepEqual(untranscribed, []);
});

test('a trim keeps only the words inside it, and speed scales the times', async () => {
  /* source 1.6 s → 3 s at double speed: 0.7 s on the film from 5 s; "Four" starts before the trim */
  const root = project([{ clips: [{ id: 'vo', src: 'assets/vo.mp3', at: 5, time: [1.6, 3], speed: 2 }] }], { 'assets/vo.vtt': VTT });
  assert.deepEqual(shown((await filmCaptions(root, noProbe)).cues), [{ startMs: 5000, durMs: 700, text: 'five six.', clip: 'vo' }]);
});

test('the same source cut in two places says each part once', async () => {
  const root = project([{ clips: [
    { id: 'a', src: 'assets/vo.mp3', at: 0, time: [0, 1.2] },
    { id: 'b', src: 'assets/vo.mp3', at: 4, time: [1.4, 3] },
  ] }], { 'assets/vo.vtt': VTT });
  assert.deepEqual((await filmCaptions(root, noProbe)).cues.map((c) => [c.clip, c.startMs, c.text]), [['a', 0, 'One two three.'], ['b', 4100, 'Four five six.']]);
});

test('a transcript names who speaks; the subtitles name them only when two do', async () => {
  const files = {
    'assets/a.vtt': vttOf(spokenLines(TEXT, WORDS, 3000), { speaker: 'Ann' }),
    'assets/b.vtt': vttOf(spokenLines(TEXT, WORDS, 3000), { speaker: 'Bo' }),
  };
  const one = project([{ clips: [{ id: 'a', src: 'assets/a.mp3' }] }], files);
  assert.deepEqual((await filmCaptions(one, noProbe)).cues.map((c) => c.speaker), [undefined, undefined]);
  const two = project([{ clips: [{ id: 'a', src: 'assets/a.mp3' }, { id: 'b', src: 'assets/b.mp3', at: 5 }] }], files);
  assert.deepEqual((await filmCaptions(two, noProbe)).cues.map((c) => c.speaker), ['Ann', 'Ann', 'Bo', 'Bo']);
});

test('a transcript written by hand, timed by line only, is its lines as they are', async () => {
  const root = project([{ clips: [{ id: 'vo', src: 'assets/vo/1.wav', at: 2 }] }], {
    'assets/vo/1.vtt': 'WEBVTT\n\n00:00:00.000 --> 00:00:01.200\n这是 OpenFilm，\n\n00:00:01.200 --> 00:00:03.000\n让网页成为电影。\n',
  });
  /* a Chinese subtitle ends without its comma or full stop */
  assert.deepEqual((await filmCaptions(root, noProbe)).cues.map((c) => [c.startMs, c.durMs, c.text, c.words]), [[2000, 1200, '这是 OpenFilm', undefined], [3200, 1800, '让网页成为电影', undefined]]);
});

test('what cannot be heard has no subtitles; speech with no transcript is listed, music and pages are not', async () => {
  const root = project([
    { muted: true, clips: [{ id: 'a', src: 'assets/vo.mp3' }] },
    { hidden: true, clips: [{ id: 'h', src: 'assets/vo.mp3', at: 20 }] },
    { clips: [{ id: 'b', src: 'assets/vo.mp3', at: 5, volume: 0 }, { id: 'c', src: 'assets/talk.m4a', at: 9 }] },
    { clips: [{ id: 'd', src: 'assets/audio/music/bed.mp3' }, { id: 'e', src: 'scenes/title.html', time: [0, 4] }] },
  ], { 'assets/vo.vtt': VTT });
  const out = await filmCaptions(root, noProbe);
  assert.deepEqual(out.cues, []);
  assert.deepEqual(out.untranscribed, ['assets/talk.m4a']);
  /* no film at all: nothing, cleanly */
  const bare = mkdtempSync(join(tmpdir(), 'of-captions-'));
  assert.deepEqual(await filmCaptions(bare, noProbe), { cues: [], sourceLanguage: null, languages: [], untranscribed: [] });
});

test('translations are transcripts beside it (name.<language>.vtt); Studio translates line by line and keeps them there', async () => {
  const fr = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nUn deux trois.\n';
  const root = project([{ clips: [{ id: 'vo', src: 'assets/vo.mp3' }] }], { 'assets/vo.vtt': VTT, 'assets/vo.fr.vtt': fr });
  let out = await filmCaptions(root, noProbe);
  assert.deepEqual(out.languages, ['fr']);
  assert.deepEqual(out.cues.map((c) => c.alt ?? null), [{ fr: 'Un deux trois.' }, null]);

  /* no service: a clear error, nothing written */
  await assert.rejects(translateFilmSubtitles(root, 'de', { translate: null }), (e) => e instanceof CaptionError && e.code === 'no-translator' && /Settings/.test(e.message));
  /* already there: nothing to do and no service needed */
  assert.deepEqual(await translateFilmSubtitles(root, 'fr', { translate: null }), { language: 'fr', translated: [], already: 1, same: 0, failed: [] });

  const asked = [];
  const translate = async (job) => { asked.push(job); return job.lines.map((l) => `de:${l}`); };
  assert.deepEqual(await translateFilmSubtitles(root, 'de', { translate }), { language: 'de', translated: ['assets/vo.mp3'], already: 0, same: 0, failed: [] });
  assert.deepEqual(asked[0].lines, ['One two three.', 'Four five six.']);
  assert.match(readFileSync(join(root, 'assets/vo.de.vtt'), 'utf8'), /^WEBVTT\n\n00:00:00\.000 --> 00:00:01\.500\nde:One two three\./);
  out = await filmCaptions(root, noProbe);
  assert.deepEqual(out.cues.map((c) => c.alt), [{ fr: 'Un deux trois.', de: 'de:One two three.' }, { de: 'de:Four five six.' }]);

  /* a translator that answers with the wrong number of lines keeps nothing */
  const bad = await translateFilmSubtitles(root, 'es', { translate: async () => ['uno'] });
  assert.equal(bad.failed.length, 1);
  assert.ok(!existsSync(join(root, 'assets/vo.es.vtt')));
});

test('a clip whose src leads out of the project (`../`) has no subtitles: its transcript is neither read, made, translated nor changed', async () => {
  const away = mkdtempSync(join(tmpdir(), 'of-away-'));
  writeFileSync(join(away, 'vo.vtt'), VTT);
  const root = project([]);
  const src = relative(root, join(away, 'vo.mp3')).split('\\').join('/');
  writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 1920, h: 1080 }, tracks: [{ clips: [{ id: 'out', src }] }] }));
  const out = await filmCaptions(root, noProbe);
  assert.deepEqual([out.cues, out.untranscribed], [[], []], 'not read, and not listed to be transcribed');
  const asked = [];
  const result = await translateFilmSubtitles(root, 'de', { translate: async (job) => { asked.push(job); return job.lines; } });
  assert.deepEqual([asked.length, result.translated], [0, []]);
  const { base, close } = await serve(root);
  try {
    const edit = (body) => fetch(`${base}/captions/line`, { method: 'PUT', body: JSON.stringify(body) });
    assert.equal((await edit({ src, line: 0, text: 'changed' })).status, 400);
    assert.equal((await edit({ src, line: 0, text: 'changed', language: 'de' })).status, 400);
  } finally {
    close();
  }
  assert.equal(readFileSync(join(away, 'vo.vtt'), 'utf8'), VTT, 'the file out there as it was');
  assert.ok(!existsSync(join(away, 'vo.de.vtt')));
});

test('the person\'s style is kept in the project folder, checked field by field', async () => {
  const root = project([]);
  assert.equal(await readSubtitleStyle(root), null);
  const kept = await writeSubtitleStyle(root, { ...FILM_SUBTITLE_DEFAULT, pos: { x: 0.3, y: 2 }, font: { sizePct: 99 }, stroke: null, language: 'xx' });
  assert.deepEqual(kept.pos, { x: 0.3, y: 1 });
  assert.equal(kept.font.sizePct, 10);
  assert.equal(kept.stroke, null);
  assert.equal(kept.language, null);
  assert.deepEqual(await readSubtitleStyle(root), kept);
  assert.ok(readFileSync(join(root, SUBTITLE_STYLE_FILE), 'utf8').endsWith('}\n'));
});

/** captionRoutes on a port of its own, for `root`. */
async function serve(root, options) {
  const server = createServer((req, res) => {
    const rest = new URL(req.url ?? '/', 'http://x').pathname.slice(1);
    captionRoutes(req, res, root, rest, options).then((done) => { if (!done) json(res, 404, {}); }, (e) => {
      json(res, e instanceof HttpError ? e.status : 500, { error: e.message, ...(e instanceof HttpError ? e.extra : {}) });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('the routes: captions, style, and translation without a service', async () => {
  const root = project([{ clips: [{ id: 'vo', src: 'assets/vo.mp3' }] }], { 'assets/vo.vtt': VTT });
  const { base, close } = await serve(root, { translate: async () => null });
  try {
    const captions = await (await fetch(`${base}/captions`)).json();
    assert.equal(captions.cues.length, 2);
    assert.deepEqual(await (await fetch(`${base}/subtitles`)).json(), { style: null });
    const put = await fetch(`${base}/subtitles`, { method: 'PUT', body: JSON.stringify({ style: { ...FILM_SUBTITLE_DEFAULT, on: false } }) });
    assert.equal((await put.json()).style.on, false);
    assert.equal((await (await fetch(`${base}/subtitles`)).json()).style.on, false);
    assert.equal((await fetch(`${base}/subtitles`, { method: 'PUT', body: '{}' })).status, 400);
    const translate = await fetch(`${base}/subtitles/translate`, { method: 'POST', body: JSON.stringify({ language: 'ja' }) });
    assert.equal(translate.status, 409);
    assert.equal((await translate.json()).code, 'no-translator');
    assert.equal((await fetch(`${base}/subtitles/translate`, { method: 'POST', body: JSON.stringify({ language: 'klingon' }) })).status, 400);
  } finally {
    close();
  }
});

test('the person corrects a line: it goes back into its transcript; emptied, the line goes', async () => {
  const root = project([{ clips: [{ id: 'vo', src: 'assets/vo.mp3', at: 10 }] }], { 'assets/vo.vtt': VTT });
  const { base, close } = await serve(root);
  const edit = (body) => fetch(`${base}/captions/line`, { method: 'PUT', body: JSON.stringify(body) });
  try {
    assert.equal((await edit({ src: 'assets/vo.mp3', line: 1500, text: 'Four, five, six!' })).status, 200);
    assert.match(readFileSync(join(root, 'assets/vo.vtt'), 'utf8'), /00:00:01\.500 --> 00:00:03\.000\nFour, five, six!\n/);
    assert.deepEqual((await filmCaptions(root, noProbe)).cues.map((c) => c.text), ['One two three.', 'Four, five, six!']);
    assert.equal((await edit({ src: 'assets/vo.mp3', line: 0, text: '  ' })).status, 200);
    assert.deepEqual((await filmCaptions(root, noProbe)).cues.map((c) => c.text), ['Four, five, six!']);
    assert.equal((await edit({ src: 'assets/vo.mp3', line: 777, text: 'x' })).status, 404);
    assert.equal((await edit({ src: 'assets/vo.mp3', text: 'x' })).status, 400);
  } finally {
    close();
  }
});

test('a translated line is corrected in its own language; a line with no translation yet gets one at its original\'s times', async () => {
  const root = project([{ clips: [{ id: 'vo', src: 'assets/vo.mp3' }] }], {
    'assets/vo.vtt': VTT,
    'assets/vo.ja.vtt': 'WEBVTT\n\n00:00:00.000 --> 00:00:01.500\n一二三。\n',
  });
  const { base, close } = await serve(root);
  const edit = (body) => fetch(`${base}/captions/line`, { method: 'PUT', body: JSON.stringify(body) });
  try {
    assert.equal((await edit({ src: 'assets/vo.mp3', line: 0, text: 'いち、に、さん。', language: 'ja' })).status, 200);
    assert.equal((await edit({ src: 'assets/vo.mp3', line: 1500, text: '四五六！', language: 'ja' })).status, 200);
    const cues = (await filmCaptions(root, noProbe)).cues;
    assert.deepEqual(cues.map((c) => c.text), ['One two three.', 'Four five six.'], 'the original as it was');
    assert.deepEqual(cues.map((c) => c.alt?.ja), ['いち、に、さん', '四五六！'], 'shown as subtitles end: no full stop, the exclamation kept');
    assert.match(readFileSync(join(root, 'assets/vo.ja.vtt'), 'utf8'), /00:00:01\.500 --> 00:00:03\.000\n四五六！/);
    assert.equal((await edit({ src: 'assets/vo.mp3', line: 0, text: 'x', language: 'klingon' })).status, 400);
  } finally {
    close();
  }
});

test('making subtitles transcribes the speech with no transcript; with no service, it says where to connect one', async () => {
  const root = project([{ clips: [{ id: 'vo', src: 'assets/vo.mp3' }, { id: 'bed', src: 'assets/audio/music/bed.mp3', at: 4 }] }], { 'assets/vo.mp3': 'x' });
  const none = await serve(root);
  try {
    const res = await fetch(`${none.base}/subtitles/transcribe`, { method: 'POST' });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, 'no-transcriber');
  } finally {
    none.close();
  }
  const heard = [];
  const transcribe = async (r, src) => { heard.push(src); writeFileSync(join(r, src.replace(/\.mp3$/, '.vtt')), VTT); };
  const { base, close } = await serve(root, { transcribe });
  try {
    assert.deepEqual(await (await fetch(`${base}/subtitles/transcribe`, { method: 'POST' })).json(), { transcribed: ['assets/vo.mp3'], failed: [] });
    assert.deepEqual(heard, ['assets/vo.mp3'], 'music is not transcribed');
    assert.equal((await filmCaptions(root, noProbe)).cues.length, 2);
    /* nothing left to do */
    assert.deepEqual(await (await fetch(`${base}/subtitles/transcribe`, { method: 'POST' })).json(), { transcribed: [], failed: [] });
  } finally {
    close();
  }
});

test('a transcript written a word (or a character) per cue is its words: they are joined into lines, each still timed', async () => {
  const chars = ['认', '识', 'O', 'p', 'e', 'n', 'F', 'i', 'l', 'm', '。'];
  const body = `WEBVTT\n\n${chars.map((c, i) => `00:00:00.${String(i * 90).padStart(3, '0')} --> 00:00:00.${String(i * 90 + 90).padStart(3, '0')}\n${c}`).join('\n\n')}\n\n00:00:01.000 --> 00:00:01.000\n \n`;
  const root = project([{ clips: [{ id: 'vo', src: 'assets/vo.wav' }] }], { 'assets/vo.vtt': body });
  const { cues } = await filmCaptions(root, noProbe);
  assert.deepEqual(cues.map((c) => c.text), ['认识OpenFilm']);
  assert.equal(cues[0].words.length, chars.length - 1, 'the full stop the subtitle drops is not a word to light up');
});

/* ── a spoken line cut into subtitles ───────────────────────────────────── */

/** Word times as a TTS service gives them for `text`: a CJK character or a Latin word each, a mark a short pause. */
function ttsWords(text) {
  const words = [];
  let at = 0;
  for (const [token] of text.matchAll(/[A-Za-z0-9.']+|[一-鿿]|[，。、！？,.!?]/g)) {
    if (/^[，。、！？,.!?]$/.test(token)) { at += 0.25; continue; }
    const dur = /^[一-鿿]$/.test(token) ? 0.22 : 0.07 * token.length;
    words.push({ token, startSec: at, endSec: at + dur });
    at += dur;
  }
  return words;
}
const SAID = '它叫 OpenFilm，免费开源，MIT 协议。';

test('a spoken line becomes a subtitle per clause, each with its own timed words, each traced to its piece of the line', async () => {
  const root = project([{ clips: [{ id: 'vo', src: 'assets/vo.wav', at: 1 }] }], { 'assets/vo.vtt': vttOf(spokenLines(SAID, ttsWords(SAID), 3500)) });
  const { cues } = await filmCaptions(root, noProbe);
  assert.deepEqual(cues.map((c) => c.text), ['它叫 OpenFilm', '免费开源', 'MIT 协议']);
  assert.deepEqual(cues.map((c) => [c.line, c.part]), [[0, 0], [0, 1], [0, 2]]);
  assert.deepEqual(cues.map((c) => c.words.map((w) => w.text).join('')), ['它叫OpenFilm', '免费开源', 'MIT协议'], 'karaoke lights the words shown, no hidden comma');
  cues.slice(1).forEach((c, i) => assert.ok(c.startMs >= cues[i].startMs + cues[i].durMs, 'one after the other'));
  assert.equal(cues[0].startMs, 1000);
  for (const c of cues) assert.equal(c.words[0].startMs, c.startMs);
  /* the files exported say the same */
  assert.equal(filmSubtitleSrt(cues).split('\n').filter((l) => /\p{Script=Han}|OpenFilm/u.test(l)).join(' | '), '它叫 OpenFilm | 免费开源 | MIT 协议');
  assert.equal((filmSubtitleVtt(cues).match(/-->/g) ?? []).length, 3);
});

test('a transcript of one word (or character) per cue is cut the same way', async () => {
  const text = '为了不再剪视频，我做了一个通用的视频agent';
  const words = ttsWords(text);
  const stamp = (s) => new Date(Math.round(s * 1000)).toISOString().slice(11, 23);
  const body = `WEBVTT\n\n${words.map((w) => `${stamp(w.startSec)} --> ${stamp(w.endSec)}\n${w.token}`).join('\n\n')}\n`;
  const root = project([{ clips: [{ id: 'vo', src: 'assets/vo.wav' }] }], { 'assets/vo.vtt': body });
  const { cues } = await filmCaptions(root, noProbe);
  assert.deepEqual(cues.map((c) => c.text), ['为了不再剪视频', '我做了一个通用的视频agent']);
  assert.deepEqual(cues.map((c) => c.words.length), [7, 11]);
});

test('the person corrects one subtitle of a line: those words change in the transcript, the rest keep their times', async () => {
  const root = project([{ clips: [{ id: 'vo', src: 'assets/vo.wav' }] }], { 'assets/vo.vtt': vttOf(spokenLines(SAID, ttsWords(SAID), 3500)) });
  const before = (await filmCaptions(root, noProbe)).cues;
  const { base, close } = await serve(root);
  const edit = (body) => fetch(`${base}/captions/line`, { method: 'PUT', body: JSON.stringify(body) });
  try {
    assert.equal((await edit({ src: 'assets/vo.wav', line: 0, part: 1, text: '完全免费' })).status, 200);
    assert.match(readFileSync(join(root, 'assets/vo.vtt'), 'utf8'), /它<[^>]+>叫 <[^>]+>OpenFilm，<[^>]+>完全免费，<[^>]+>MIT <[^>]+>协<[^>]+>议。/);
    const after = (await filmCaptions(root, noProbe)).cues;
    assert.deepEqual(after.map((c) => c.text), ['它叫 OpenFilm', '完全免费', 'MIT 协议']);
    assert.deepEqual([after[0].words, after[2].words], [before[0].words, before[2].words], 'the other subtitles as they were, word for word');
    assert.equal(after[1].startMs, before[1].startMs);
    /* emptied, that subtitle goes; a part the line does not have is not there */
    assert.equal((await edit({ src: 'assets/vo.wav', line: 0, part: 2, text: '' })).status, 200);
    assert.deepEqual((await filmCaptions(root, noProbe)).cues.map((c) => c.text), ['它叫 OpenFilm', '完全免费']);
    assert.equal((await edit({ src: 'assets/vo.wav', line: 0, part: 7, text: 'x' })).status, 404);
    assert.equal((await edit({ src: 'assets/vo.wav', line: 0, part: -1, text: 'x' })).status, 400);
  } finally {
    close();
  }
});

test('a translation follows the original\'s subtitles; one that cannot be cut spans them, shown as one', async () => {
  const lines = spokenLines(SAID, ttsWords(SAID), 3500);
  const root = project([{ clips: [{ id: 'vo', src: 'assets/vo.wav' }] }], {
    'assets/vo.vtt': vttOf(lines),
    'assets/vo.en.vtt': vttOf([{ text: 'It\'s called OpenFilm, free and open source, MIT licensed.', startMs: 0, endMs: 3500 }]),
    'assets/vo.fr.vtt': vttOf([{ text: 'C\'est OpenFilm.', startMs: 0, endMs: 3500 }]),
  });
  const { cues } = await filmCaptions(root, noProbe);
  assert.deepEqual(cues.map((c) => c.alt.en), ['It\'s called OpenFilm,', 'free and open source,', 'MIT licensed.']);
  assert.deepEqual(cues.map((c) => c.alt.fr), ['C\'est OpenFilm.', 'C\'est OpenFilm.', 'C\'est OpenFilm.']);
  const fr = filmSubtitleShown(cues, { language: 'fr', bilingual: false });
  assert.deepEqual(fr.map((c) => [c.text, c.startMs, c.startMs + c.durMs]), [['C\'est OpenFilm.', cues[0].startMs, cues[2].startMs + cues[2].durMs]]);
  assert.equal(filmSubtitleShown(cues, { language: 'fr', bilingual: true }).length, 3, 'with the original, each subtitle its own');
  assert.equal(filmSubtitleShown(cues, { language: 'en', bilingual: false }).length, 3);
  /* a correction of one translated subtitle changes those words of the translation */
  const { base, close } = await serve(root);
  try {
    const res = await fetch(`${base}/captions/line`, { method: 'PUT', body: JSON.stringify({ src: 'assets/vo.wav', line: 0, part: 1, text: 'free, open source,', language: 'en' }) });
    assert.equal(res.status, 200);
    assert.match(readFileSync(join(root, 'assets/vo.en.vtt'), 'utf8'), /It's called OpenFilm, free, open source, MIT licensed\./);
  } finally {
    close();
  }
});
