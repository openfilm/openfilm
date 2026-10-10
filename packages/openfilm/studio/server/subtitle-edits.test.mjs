import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { captionRoutes, filmCaptions } from './captions.mjs';
import { HttpError, json } from './http.mjs';
import { cleanCues, restoreSourceFiles, sourceSubtitles, writeSourceSubtitles } from './subtitle-edits.mjs';
import { CUT_NOTE, readTranscript, vttOf } from './transcripts.mjs';
import { filmHtml } from '../../src/film-doc.mjs';

/* two sentences said as one line, timed word by word: Studio cuts it into two subtitles */
const TEXT = 'One two three. Four five six.';
const MARKS = [[0, 0], [4, 300], [8, 600], [15, 1200], [20, 1500], [25, 1800]].map(([index, startMs]) => ({ index, startMs }));
const ONE_LINE = vttOf([{ text: TEXT, startMs: 0, endMs: 2500, marks: MARKS }]);
const noProbe = { duration: async () => undefined };

/** A project folder: film.html from `tracks`, and `files` (path → text). */
function project(tracks, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'of-subtitle-edits-'));
  writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 1920, h: 1080 }, tracks }));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

test('a source\'s subtitles are read as the film shows them, each named as its cue is', async () => {
  const root = project([{ clips: [{ id: 'vo', src: 'assets/vo.mp3', at: 10 }] }], {
    'assets/vo.mp3': 'x', 'assets/vo.vtt': ONE_LINE, 'assets/vo.fr.vtt': vttOf([{ text: 'Un deux trois. Quatre cinq six.', startMs: 0, endMs: 2500 }]),
  });
  const { cues } = await filmCaptions(root, noProbe);
  const source = await sourceSubtitles(root, 'assets/vo.mp3');
  assert.equal(source.cut, false);
  assert.deepEqual(source.cues.map((c) => [c.text, c.line, c.part]), [['One two three.', 0, 0], ['Four five six.', 0, 1]]);
  /* the same pieces the film shows, 10 s later */
  assert.deepEqual(cues.map((c) => [c.startMs - 10_000, c.line, c.part]), source.cues.map((c) => [c.startMs, c.line, c.part]));
  assert.deepEqual(source.cues.map((c) => c.alt?.fr), ['Un deux trois.', 'Quatre cinq six.']);
  assert.ok(source.cues[1].marks?.every((m) => m.index < source.cues[1].text.length));
  assert.deepEqual((await sourceSubtitles(root, 'assets/none.mp3')).cues, []);
});

test('written back, each subtitle is a cue of its own, cut by hand: Studio does not cut it again', async () => {
  const root = project([{ clips: [{ id: 'vo', src: 'assets/vo.mp3' }] }], { 'assets/vo.mp3': 'x', 'assets/vo.vtt': ONE_LINE });
  /* the two merged into one long line, which Studio would cut at the full stop */
  const { before, after } = await writeSourceSubtitles(root, 'assets/vo.mp3', [{ startMs: 0, endMs: 2500, text: TEXT }]);
  assert.equal(before.files['assets/vo.vtt'], ONE_LINE);
  const body = readFileSync(join(root, 'assets/vo.vtt'), 'utf8');
  assert.equal(after.files['assets/vo.vtt'], body);
  assert.ok(body.startsWith(`WEBVTT\n\n${CUT_NOTE}\n\n`));
  assert.equal((await readTranscript(root, 'assets/vo.mp3'))?.cut, true);
  const { cues } = await filmCaptions(root, noProbe);
  assert.deepEqual(cues.map(({ startMs, durMs, text, part }) => ({ startMs, durMs, text, part })), [{ startMs: 0, durMs: 2500, text: TEXT, part: undefined }]);
  assert.equal((await sourceSubtitles(root, 'assets/vo.mp3')).cut, true);
});

test('cues are written in order, never overlapping, none empty', () => {
  assert.deepEqual(cleanCues([
    { startMs: 2000, endMs: 3000, text: 'b' },
    { startMs: 0, endMs: 2500, text: ' a  one ', marks: [{ index: 0, startMs: 0 }, { index: 3, startMs: 9000 }, { index: 99, startMs: 10 }] },
    { startMs: 3000, endMs: 3000, text: 'no length' },
    { startMs: 3100, endMs: 3500, text: '   ' },
    { startMs: 4000, endMs: 5000, text: 'c', alt: { fr: ' ç ', xx: 'nope' } },
  ]), [
    { startMs: 0, endMs: 2000, text: 'a one', marks: [{ index: 0, startMs: 0 }, { index: 3, startMs: 2000 }] },
    { startMs: 2000, endMs: 3000, text: 'b' },
    { startMs: 4000, endMs: 5000, text: 'c', alt: { fr: 'ç' } },
  ]);
  assert.throws(() => cleanCues('x'), HttpError);
  assert.throws(() => cleanCues([{ startMs: 'a', endMs: 1, text: 'x' }]), HttpError);
});

test('translations are written at the same times; undo puts every file back, and only over what it left', async () => {
  const root = project([{ clips: [{ id: 'vo', src: 'assets/vo.mp3' }] }], {
    'assets/vo.mp3': 'x', 'assets/vo.vtt': ONE_LINE, 'assets/vo.fr.vtt': vttOf([{ text: 'Un deux trois. Quatre cinq six.', startMs: 0, endMs: 2500 }]),
  });
  const { before, after } = await writeSourceSubtitles(root, 'assets/vo.mp3', [
    { startMs: 0, endMs: 1100, text: 'One two three.', alt: { fr: 'Un deux trois.' } },
    { startMs: 1300, endMs: 2500, text: 'Four five six.', alt: { de: 'Vier fünf sechs.' } },
  ]);
  assert.deepEqual((await readTranscript(root, 'assets/vo.mp3', 'fr'))?.lines, [{ text: 'Un deux trois.', startMs: 0, endMs: 1100 }]);
  assert.deepEqual((await readTranscript(root, 'assets/vo.mp3', 'de'))?.lines, [{ text: 'Vier fünf sechs.', startMs: 1300, endMs: 2500 }]);
  assert.equal(before.files['assets/vo.de.vtt'], null, 'the German one is new');
  /* undo: as it was, the file this step made gone */
  await restoreSourceFiles(root, 'assets/vo.mp3', after, before);
  assert.equal(readFileSync(join(root, 'assets/vo.vtt'), 'utf8'), ONE_LINE);
  assert.ok(!existsSync(join(root, 'assets/vo.de.vtt')));
  /* redo, then a write from elsewhere: undo now refuses, and writes nothing */
  await restoreSourceFiles(root, 'assets/vo.mp3', before, after);
  writeFileSync(join(root, 'assets/vo.vtt'), vttOf([{ text: 'The agent wrote this.', startMs: 0, endMs: 900 }]));
  await assert.rejects(restoreSourceFiles(root, 'assets/vo.mp3', after, before), (e) => e instanceof HttpError && e.status === 409);
  assert.match(readFileSync(join(root, 'assets/vo.vtt'), 'utf8'), /The agent wrote this/);
  /* only a source's own transcripts are put back, inside the project */
  await assert.rejects(restoreSourceFiles(root, 'assets/vo.mp3', { files: {} }, { files: { 'film.html': 'x' } }), (e) => e instanceof HttpError && e.status === 400);
  await assert.rejects(restoreSourceFiles(root, 'assets/vo.mp3', { files: {} }, { files: { 'assets/other.vtt': 'x' } }), (e) => e instanceof HttpError && e.status === 400);
  await assert.rejects(writeSourceSubtitles(root, '../away.mp3', []), (e) => e instanceof HttpError && e.status === 400);
});

/** captionRoutes on a port of its own, for `root`. */
async function serve(root) {
  const server = createServer((req, res) => {
    const rest = new URL(req.url ?? '/', 'http://x').pathname.slice(1);
    captionRoutes(req, res, root, rest).then((done) => { if (!done) json(res, 404, {}); }, (e) => {
      json(res, e instanceof HttpError ? e.status : 500, { error: e.message, ...(e instanceof HttpError ? e.extra : {}) });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('the routes: a source\'s subtitles, written, and put back', async () => {
  const root = project([{ clips: [{ id: 'vo', src: 'assets/vo.mp3' }] }], { 'assets/vo.mp3': 'x', 'assets/vo.vtt': ONE_LINE });
  const { base, close } = await serve(root);
  const put = (path, body) => fetch(`${base}/${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const got = await (await fetch(`${base}/captions/source?src=${encodeURIComponent('assets/vo.mp3')}`)).json();
    assert.equal(got.cues.length, 2);
    assert.equal((await fetch(`${base}/captions/source?src=..%2Fx.mp3`)).status, 400);
    const res = await put('captions/source', { src: 'assets/vo.mp3', cues: [{ ...got.cues[0], endMs: 1400 }] });
    assert.equal(res.status, 200);
    const { before, after } = await res.json();
    assert.deepEqual((await readTranscript(root, 'assets/vo.mp3'))?.lines.map((l) => [l.text, l.startMs, l.endMs]), [['One two three.', 0, 1400]]);
    assert.equal((await put('captions/files', { src: 'assets/vo.mp3', from: after, to: before })).status, 200);
    assert.equal(readFileSync(join(root, 'assets/vo.vtt'), 'utf8'), ONE_LINE);
    const again = await put('captions/files', { src: 'assets/vo.mp3', from: after, to: before });
    assert.equal(again.status, 409);
    assert.equal((await again.json()).code, 'changed');
    assert.equal((await put('captions/source', { cues: [] })).status, 400);
  } finally { close(); }
});
