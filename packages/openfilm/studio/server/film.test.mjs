import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EditError, editProjectFilm, readProjectFilm, revOf, projectAudioStatus } from './film.mjs';
import { patchProjectSettings } from './project-settings.mjs';
import { filmHtml, readFilmFile } from '../../src/film-doc.mjs';

const folder = (film) => {
  const root = mkdtempSync(join(tmpdir(), 'of-film-'));
  if (film !== undefined) writeFileSync(join(root, 'film.html'), typeof film === 'string' ? film : filmHtml(film));
  return root;
};
const film = (...tracks) => ({ stage: { w: 1920, h: 1080 }, tracks: tracks.map((clips) => ({ clips })) });
const onDisk = (root) => readFilmFile(readFileSync(join(root, 'film.html'), 'utf8')).value;

test('server policy applies without a client asking, with exact replay and a read-only check for outside writes', async () => {
  const value = film([{ id: 'a', src: 'a.wav', time: [0, 1] }, { id: 'b', src: 'b.wav', at: 2, time: [0, 1] }]);
  const root = folder(value);
  const move = [{ op: 'move', clip: 'b', at: 1 }];
  let done = await editProjectFilm(root, null, move);
  assert.equal(done.automatic, undefined, 'off by default');
  await editProjectFilm(root, null, [{ op: 'move', clip: 'b', at: 2 }]);
  await patchProjectSettings(root, { audioSmoothingMs: 10 });
  done = await editProjectFilm(root, null, move);
  assert.deepEqual(done.effective.before, value);
  assert.equal(done.effective.ops.length, 2, 'original move plus the policy operation');
  assert.deepEqual(done.doc.tracks[0].clips.map((c) => c.overrides), [[{ fade: [0, 0.01] }], [{ fade: [0.01, 0] }]]);
  const restore = [{ op: 'move', clip: 'b', at: 2 }, { op: 'props', edits: ['a', 'b'].map((clip) => ({ clip, prop: 'fade', value: null })) }];
  const undone = await editProjectFilm(root, null, restore, { replay: true });
  assert.deepEqual(undone.doc, value);
  const redone = await editProjectFilm(root, null, done.effective.ops, { replay: true });
  assert.deepEqual(redone.doc, done.doc);
  assert.equal(redone.automatic, undefined);

  /* An agent writes a valid new seam directly. Reading/checking never alters it. */
  value.tracks[0].clips[1].at = 1;
  const external = filmHtml(value);
  writeFileSync(join(root, 'film.html'), external);
  const check = await readProjectFilm(root);
  assert.deepEqual(await projectAudioStatus(root, check.value), { ms: 10, pending: 2 });
  assert.equal(readFileSync(join(root, 'film.html'), 'utf8'), external);
  await assert.rejects(editProjectFilm(root, 'stale', [], { repairAudio: true }), (e) => e.kind === 'conflict');
  assert.equal(readFileSync(join(root, 'film.html'), 'utf8'), external);
  const fixed = await editProjectFilm(root, check.rev, [], { repairAudio: true });
  assert.equal(fixed.audioSmoothing.pending, 0);
  assert.equal(fixed.effective.ops.length, 1);
  const again = await editProjectFilm(root, fixed.rev, [], { repairAudio: true });
  assert.equal(again.rev, fixed.rev);
  assert.equal(again.automatic, undefined);
});

test('concurrent managed edits keep both writes, and direct fade removal is respected', async () => {
  const root = folder(film([{ id: 'a', src: 'a.wav', time: [0, 1] }, { id: 'b', src: 'b.wav', at: 2, time: [0, 1] }]));
  await patchProjectSettings(root, { audioSmoothingMs: 10 });
  await Promise.all([
    editProjectFilm(root, null, [{ op: 'move', clip: 'b', at: 1 }]),
    editProjectFilm(root, null, [{ op: 'set', clip: 'a', field: 'volume', value: 0.5 }]),
  ]);
  const value = onDisk(root);
  assert.equal(value.tracks[0].clips[0].volume, 0.5);
  assert.equal(value.tracks[0].clips[1].at, 1);
  assert.deepEqual(value.tracks[0].clips[0].overrides, [{ fade: [0, 0.01] }]);
  const removed = await editProjectFilm(root, null, [{ op: 'props', edits: [{ clip: 'a', prop: 'fade', value: null }] }]);
  assert.equal(removed.doc.tracks[0].clips[0].overrides, undefined);
  assert.equal(removed.automatic, undefined);
});

test('a folder without film.html reads as empty, and the first insert makes the film', async () => {
  const root = folder();
  const read = await readProjectFilm(root);
  assert.equal(read.value, null);
  const { doc } = await editProjectFilm(root, read.rev, [{ op: 'insert', clip: { src: 'scenes/title.html' } }]);
  assert.deepEqual(doc.tracks[0].clips[0], { src: 'scenes/title.html', id: 'title' });
  assert.deepEqual(onDisk(root).stage, { w: 1920, h: 1080 });
});

test('a clip is found by its id wherever the agent moved it', async () => {
  const root = folder(film([{ src: 'a.mp4', id: 'intro' }, { src: 'b.mp4', id: 'body', at: 5 }]));
  const base = (await readProjectFilm(root)).rev;
  /* the agent puts the clips on two tracks, in another order, after Studio read the file */
  writeFileSync(join(root, 'film.html'), filmHtml(film([{ src: 'b.mp4', id: 'body', at: 5 }], [{ src: 'a.mp4', id: 'intro' }])));
  const { doc, rebased } = await editProjectFilm(root, base, [{ op: 'set', clip: 'intro', field: 'volume', value: 0.5 }]);
  assert.equal(rebased, true);
  assert.equal(doc.tracks[1].clips[0].volume, 0.5);
  assert.equal(doc.tracks[0].clips[0].volume, undefined, 'the other clip is untouched');
});

test('an edit naming a clip the agent removed fails whole, and the file is left as it was', async () => {
  const root = folder(film([{ src: 'a.html', id: 'a' }, { src: 'b.html', id: 'b', at: 3 }]));
  const base = (await readProjectFilm(root)).rev;
  writeFileSync(join(root, 'film.html'), filmHtml(film([{ src: 'a.html', id: 'a' }])));
  const before = readFileSync(join(root, 'film.html'), 'utf8');
  await assert.rejects(
    editProjectFilm(root, base, [{ op: 'set', clip: 'a', field: 'at', value: 1 }, { op: 'remove', clip: 'b' }]),
    (e) => e instanceof EditError && e.kind === 'conflict' && /"b"/.test(e.message),
  );
  assert.equal(readFileSync(join(root, 'film.html'), 'utf8'), before);
});

test('a film.html that does not read is never written over', async () => {
  const root = folder('<section><video src="a.mp4"></section>');
  await assert.rejects(editProjectFilm(root, null, [{ op: 'insert', clip: { src: 'a.html' } }]), (e) => e.kind === 'invalid');
  assert.equal(readFileSync(join(root, 'film.html'), 'utf8'), '<section><video src="a.mp4"></section>');
});

test('an edit that would break the film is refused with the reason', async () => {
  const root = folder(film([{ src: 'clip.mp4', id: 'clip' }]));
  await assert.rejects(editProjectFilm(root, null, [{ op: 'set', clip: 'clip', field: 'speed', value: 9 }]), (e) => e.kind === 'invalid' && /speed/.test(e.message));
  await assert.rejects(editProjectFilm(root, null, [{ op: 'set', clip: 'clip', field: 'kind', value: 'x' }]), (e) => e.kind === 'invalid');
});

test('move: to another time, an existing track, or a new track; empty tracks go', async () => {
  const root = folder(film([{ src: 'a.html', id: 'a' }], [{ src: 'b.mp4', id: 'b', at: 2 }]));
  let { doc } = await editProjectFilm(root, null, [{ op: 'move', clip: 'a', at: 4.30000000001, track: 1 }]);
  assert.equal(doc.tracks.length, 1, 'the emptied track is gone');
  assert.deepEqual(doc.tracks[0].clips.map((c) => [c.id, c.at]), [['b', 2], ['a', 4.3]]);
  ({ doc } = await editProjectFilm(root, null, [{ op: 'move', clip: 'b', at: 0, newTrack: 0 }]));
  assert.deepEqual(doc.tracks.map((t) => t.clips.map((c) => c.id)), [['b'], ['a']]);
  assert.equal(onDisk(root).tracks[0].clips[0].at, undefined, 'at 0 is not written');
});

test('insert names the clip after its file, never reusing an id', async () => {
  const root = folder(film([{ src: 'assets/hit.wav', id: 'hit' }]));
  const { doc } = await editProjectFilm(root, null, [{ op: 'insert', clip: { src: 'sfx/hit.wav', at: 3, id: 'hit' }, track: 0 }]);
  assert.deepEqual(doc.tracks[0].clips.map((c) => c.id), ['hit', 'hit-2']);
});

test('split keeps the first half and adds the rest right after it, with a new id', async () => {
  const root = folder(film([{ src: 'a.mp4', id: 'shot', at: 1, time: [0, 6], volume: 0.5 }]));
  const { doc } = await editProjectFilm(root, null, [{ op: 'split', clip: 'shot', at: 3, time: [0, 2], restTime: [2, 6] }]);
  assert.deepEqual(doc.tracks[0].clips, [
    { src: 'a.mp4', id: 'shot', at: 1, time: [0, 2], volume: 0.5 },
    { src: 'a.mp4', id: 'a', at: 3, time: [2, 6], volume: 0.5 },
  ]);
});

test('track flags and order', async () => {
  const root = folder(film([{ src: 'a.html', id: 'a' }], [{ src: 'b.wav', id: 'b' }]));
  let { doc } = await editProjectFilm(root, null, [{ op: 'track', track: 1, field: 'muted', value: true }, { op: 'reorder', from: 1, to: 0 }]);
  assert.deepEqual(doc.tracks.map((t) => [t.clips[0].id, Boolean(t.muted)]), [['b', true], ['a', false]]);
  ({ doc } = await editProjectFilm(root, null, [{ op: 'track', track: 0, field: 'muted', value: false }]));
  assert.equal(onDisk(root).tracks[0].muted, undefined);
});

test('the revision follows the text, and Studio writes over the file, the rest of it as it was', async () => {
  const root = folder(filmHtml(film([{ src: 'a.html', id: 'a' }, { src: 'b.html', id: 'b', at: 4 }])).replace('<head>', '<head>\n<!-- mine -->'));
  const { text, rev } = await editProjectFilm(root, null, [{ op: 'set', clip: 'a', field: 'at', value: 2 }]);
  assert.equal(rev, revOf(readFileSync(join(root, 'film.html'), 'utf8')));
  assert.ok(text.includes('<!-- mine -->') && text.includes('<iframe id="a" src="a.html" at="2"></iframe>') && text.includes('<iframe id="b" src="b.html" at="4"></iframe>'));
});
