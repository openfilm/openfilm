import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStudio } from './server.mjs';
import { filmHtml, readFilmFile } from '../../src/film-doc.mjs';
import { changeProjectFilm, editProjectFilm, settleProjectFilm } from './film.mjs';
import * as personEdits from './person-edits.mjs';

/** The note for `agent` (an agent in a terminal by default), passed on: it is told. The line, or null. */
const tell = (root, agent = 'pid:1') => {
  const note = personEdits.noteFor(root, agent);
  if (note) personEdits.noteSaid(note.id);
  return note?.line ?? null;
};

let studio, scratch;
before(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'of-person-edits-'));
  process.env.OPENFILM_HOME = join(scratch, 'home');
  process.env.OPENFILM_LIBRARY = join(scratch, 'library');
  process.env.OPENFILM_TRASH_DIR = join(scratch, 'trash');
  mkdirSync(process.env.OPENFILM_TRASH_DIR);
  studio = await startStudio({ port: 0, openBrowser: () => {} });
});
after(async () => { await studio.close(); rmSync(scratch, { recursive: true, force: true }); });

const api = (path, { method = 'GET', body } = {}) => fetch(`${studio.origin}${path}`, {
  method,
  headers: { 'x-studio-key': studio.key, ...(body ? { 'content-type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
/** A page showing the project (its watcher runs while one does), until closed. */
const watch = (id) => new WebSocket(`${studio.origin.replace(/^http/, 'ws')}/api/projects/${id}/events`, { headers: { 'x-studio-key': studio.key } });
const read = (root) => readFilmFile(readFileSync(join(root, 'film.html'), 'utf8')).value;
const clips = (root) => read(root)?.tracks.flatMap((t) => t.clips) ?? [];
const clip = (v, id) => v.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
const ids = (v) => v.tracks.map((t) => t.clips.map((c) => c.id));
const write = (root, v) => writeFileSync(join(root, 'film.html'), filmHtml(v));
const page = (id, extra = {}) => ({ id, src: `${id}.html`, box: { x: 0, y: 0, w: 640, h: 360 }, ...extra });
const F = (...tracks) => ({ stage: { w: 1920, h: 1080 }, tracks: tracks.map((c) => ({ clips: c })) });
/** A project folder with `start` as the agent wrote it, Studio having read it. */
async function project(start) {
  const root = mkdtempSync(join(scratch, 'p-'));
  write(root, start);
  await settleProjectFilm(root);
  return root;
}
/** Wait until `ok()` (the folder watcher settles a write in about a tenth of a second). */
async function until(ok, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (ok()) return;
  assert.fail('waited too long');
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test('in Studio: the person edits while the agent writes film.html whole from an older copy; both edits stay, and the agent is told once', { timeout: 30_000 }, async () => {
  const { project: made } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Turn') } })).json();
  const agentFilm = F([page('title'), page('card', { at: 4, box: { x: 0, y: 0, w: 960, h: 540 } })]);
  const copy = filmHtml(agentFilm);
  writeFileSync(join(made.path, 'film.html'), copy);
  const shown = watch(made.id);
  await new Promise((r) => { shown.onopen = r; });
  await pause(300);

  /* the agent's `openfilm look`, before it writes, as `pid:42` */
  const kept = async () => (await api(`/api/kept?folder=${encodeURIComponent(made.path)}&agent=pid:42`)).json();
  assert.equal((await kept()).line, null);
  const now = await (await api(`/api/projects/${made.id}`)).json();
  const edited = await api(`/api/projects/${made.id}/edit`, { method: 'POST', body: { base: now.rev, ops: [
    { op: 'props', edits: [{ clip: 'title', prop: 'box', value: { x: 300, y: 120, w: 640, h: 360 } }, { clip: 'title', prop: 'at', value: 2 }] },
  ] } });
  assert.equal(edited.status, 200);
  await pause(300);

  const theirs = structuredClone(agentFilm);
  theirs.tracks[0].clips[1].box.w = 1200;
  /* half a file first (it is writing): never written over */
  writeFileSync(join(made.path, 'film.html'), filmHtml(theirs).slice(0, 200));
  await pause(400);
  assert.equal(readFileSync(join(made.path, 'film.html'), 'utf8'), filmHtml(theirs).slice(0, 200));
  writeFileSync(join(made.path, 'film.html'), filmHtml(theirs));
  await until(() => clips(made.path).find((c) => c.id === 'title')?.at === 2);
  const [title, card] = clips(made.path);
  assert.deepEqual(title.box, { x: 300, y: 120, w: 640, h: 360 });
  assert.equal(card.box.w, 1200);

  const said = await kept();
  assert.match(said.line, /clip title at/);
  assert.match(said.line, /clip title box\.x/);
  /* not said passed on: given again; said: not again */
  assert.match((await kept()).line, /clip title at/);
  const again = await kept();
  assert.deepEqual(await (await api('/api/kept/said', { method: 'POST', body: { id: again.id } })).json(), { ok: true });
  assert.equal((await kept()).line, null);

  /* what the agent wrote and the merge are kept aside in the history, in no list of versions */
  const git = (...args) => execFileSync('git', ['--git-dir', join(made.path, '.film', 'history'), ...args], { encoding: 'utf8' });
  const ref = git('for-each-ref', '--format=%(refname)', 'refs/openfilm/merges/').trim();
  assert.equal(git('show', `${ref}:agent.html`), filmHtml(theirs));
  assert.equal(git('show', `${ref}:merged.html`), readFileSync(join(made.path, 'film.html'), 'utf8'));
  const history = await api(`/api/projects/${made.id}/history`);
  assert.equal(history.status, 200);
  const { versions } = await history.json();
  assert.ok(Array.isArray(versions) && !JSON.stringify(versions).includes(git('rev-parse', ref).trim()));
  shown.close();
});

test('A, B: a clip the agent renamed is not doubled; one the person changed and an older copy lacks stays, and the agent is told', async () => {
  const root = await project(F([page('c1', { at: 0 }), page('b', { at: 5 }), page('c', { at: 9 })]));
  write(root, F([{ ...page('title', { at: 0 }), src: 'c1.html' }, page('b', { at: 5 }), page('c', { at: 9 })]));
  await settleProjectFilm(root);
  assert.deepEqual(ids(read(root)), [['title', 'b', 'c']]);
  await editProjectFilm(root, null, [{ op: 'props', edits: [{ clip: 'b', prop: 'box', value: { x: 10, y: 0, w: 640, h: 360 } }, { clip: 'c', prop: 'at', value: 12 }] }]);
  /* a copy from before the person's edits, without b: c's old place says it is older, so b was the person's to keep */
  write(root, F([{ ...page('title', { at: 0 }), src: 'c1.html' }, page('c', { at: 9 })]));
  await settleProjectFilm(root);
  assert.deepEqual(ids(read(root)), [['title', 'b', 'c']]);
  assert.equal(clip(read(root), 'c').at, 12);
  assert.match(tell(root), /clip b/);
});
test('C, c.mjs: an edit that cannot fit (a fade longer than a clip the agent cut) is left out; an unrelated one is put back, and stays on later writes', async () => {
  const start = F([{ id: 'v', src: 'v.mp4', time: [0, 6] }, page('t', { at: 7 })]);
  const root = await project(start);
  await editProjectFilm(root, null, [{ op: 'fields', clip: 'v', fields: { overrides: [{ fade: [2, 2] }], box: { x: 50, y: 0 } } }, { op: 'set', clip: 't', field: 'at', value: 9 }]);
  const agent = structuredClone(start);
  agent.tracks[0].clips[0].time = [0, 3];
  write(root, agent);
  await settleProjectFilm(root);
  assert.equal(clip(read(root), 't').at, 9);
  assert.deepEqual(clip(read(root), 'v').box, { x: 50, y: 0 });
  agent.tracks[0].clips[1].class = 'x';
  write(root, agent);
  await settleProjectFilm(root);
  assert.equal(clip(read(root), 't').at, 9);
  assert.equal(clip(read(root), 't').class, 'x');
});

test('D: a file moved in Studio after an agent\'s stale write: the move waits for the merge, and the person\'s edit stays', async () => {
  const start = F([page('title', { at: 0 }), { id: 'pic', src: 'a.png', at: 5 }]);
  const root = await project(start);
  await editProjectFilm(root, null, [{ op: 'props', edits: [{ clip: 'title', prop: 'box', value: { x: 300, y: 0, w: 640, h: 360 } }] }]);
  write(root, start);
  /* repoint (files.mjs), as a file move does */
  await changeProjectFilm(root, (value) => { value.tracks[0].clips[1].src = 'pics/a.png'; return { value }; });
  assert.equal(clip(read(root), 'title').box.x, 300);
  assert.equal(clip(read(root), 'pic').src, 'pics/a.png');
});

test('E: a value the agent writes from the latest copy stands; from an older one it loses to the person\'s, and the agent is told', async () => {
  const root = await project(F([page('title', { at: 1 }), page('u', { at: 5 })]));
  await editProjectFilm(root, null, [{ op: 'set', clip: 'title', field: 'at', value: 4 }, { op: 'set', clip: 'u', field: 'at', value: 6 }]);
  /* older: it has u's old place too */
  write(root, F([page('title', { at: 7 }), page('u', { at: 5 })]));
  await settleProjectFilm(root);
  assert.equal(clip(read(root), 'title').at, 4);
  assert.match(tell(root), /stand over what you wrote.*a change you make then is yours/);
  /* from the latest */
  write(root, F([page('title', { at: 7 }), page('u', { at: 6 })]));
  await settleProjectFilm(root);
  assert.equal(clip(read(root), 'title').at, 7);
});
test('E1, readd.mjs: told, the agent\'s return to the values from before the person\'s edit is taken as meant; untold, it is put right', async () => {
  const root = await project(F([page('t', { at: 1 }), page('b', { at: 5 })]));
  await editProjectFilm(root, null, [{ op: 'set', clip: 't', field: 'at', value: 4 }, { op: 'remove', clip: 'b' }]);
  const back = F([page('t', { at: 1 }), page('b', { at: 5 })]);
  write(root, back);
  await settleProjectFilm(root);
  assert.equal(clip(read(root), 't').at, 4);
  assert.deepEqual(ids(read(root)), [['t']]);
  assert.match(tell(root), /(?=.*clip b)(?=.*clip t at)/);
  write(root, F([page('t', { at: 1 }), page('b', { at: 5, class: 'again' })]));
  await settleProjectFilm(root);
  assert.equal(clip(read(root), 't').at, 1);
  assert.deepEqual(ids(read(root)), [['t', 'b']]);
});
test('E2: an older copy is put right however often it comes, a write with the person\'s value changing nothing', async () => {
  const start = F([page('title', { at: 1 })]);
  const root = await project(start);
  await editProjectFilm(root, null, [{ op: 'set', clip: 'title', field: 'at', value: 4 }]);
  for (let i = 0; i < 3; i++) {
    write(root, F([page('title', { at: i % 2 ? 4 : 1, class: `n${i}` })]));
    await settleProjectFilm(root);
    assert.equal(clip(read(root), 'title').at, 4);
  }
});
test('F, attack 3: the person\'s own revert outside Studio is put right too, also after a save, until a version is put back', async () => {
  const start = F([page('title', { at: 1 })]);
  const root = await project(start);
  await editProjectFilm(root, null, [{ op: 'set', clip: 'title', field: 'at', value: 4 }]);
  write(root, start);
  await settleProjectFilm(root);
  assert.equal(clip(read(root), 'title').at, 4);
  /* a version put back (or the changes discarded) starts afresh */
  personEdits.filmReplaced(root);
  write(root, start);
  await settleProjectFilm(root);
  assert.equal(clip(read(root), 'title').at, 1);
});
test('attacks 1, 2: an agent in a terminal that never ran `openfilm` before its stale write, or not for 11 minutes, loses nothing of the person\'s', async () => {
  const start = F([page('t', { at: 1 }), page('u', { at: 5 })]);
  const root = await project(start);
  await editProjectFilm(root, null, [{ op: 'set', clip: 't', field: 'at', value: 4 }]);
  write(root, start);
  await settleProjectFilm(root);
  assert.equal(clip(read(root), 't').at, 4);
  const real = Date.now;
  Date.now = () => real() + 11 * 60_000;
  try {
    write(root, F([page('t', { at: 1 }), page('u', { at: 5, class: 'later' })]));
    await settleProjectFilm(root);
  } finally { Date.now = real; }
  assert.equal(clip(read(root), 't').at, 4);
});

test('attack 4, N1: told of some edits, the agent writing them back is taken; the person\'s edits made after the note stay', async () => {
  const start = F([page('t', { at: 1 }), page('u', { at: 5 }), page('v', { at: 8 })]);
  const root = await project(start);
  await editProjectFilm(root, null, [{ op: 'set', clip: 't', field: 'at', value: 4 }, { op: 'set', clip: 'u', field: 'at', value: 7 }]);
  write(root, F([page('t', { at: 9 }), page('u', { at: 5 }), page('v', { at: 8 })]));
  await settleProjectFilm(root);
  assert.deepEqual([clip(read(root), 't').at, clip(read(root), 'u').at], [4, 7]);
  assert.match(tell(root, 'app:c1'), /(?=.*clip t at)(?=.*clip u at)/);
  await editProjectFilm(root, null, [{ op: 'set', clip: 'v', field: 'at', value: 2 }]);
  write(root, start);
  await settleProjectFilm(root);
  assert.deepEqual([clip(read(root), 't').at, clip(read(root), 'u').at, clip(read(root), 'v').at], [1, 5, 2]);
  /* another agent is told of what still stands over that write: the person's v */
  assert.match(tell(root, 'pid:9'), /clip v at/);
});
test('attack 5: two agents in two terminals: one having the edit does not let the other\'s older copy through', async () => {
  const start = F([page('t', { at: 1 }), page('u', { at: 5 })]);
  const root = await project(start);
  await editProjectFilm(root, null, [{ op: 'set', clip: 't', field: 'at', value: 4 }]);
  write(root, F([page('t', { at: 4 }), page('u', { at: 5, class: 'a' })]));
  await settleProjectFilm(root);
  write(root, start);
  await settleProjectFilm(root);
  assert.equal(clip(read(root), 't').at, 4);
});

test('attack 6: an agent that read the person\'s value and then changes it: its change, made from the latest, stands', async () => {
  const start = F([page('t', { at: 1 }), page('u', { at: 5 })]);
  const root = await project(start);
  await editProjectFilm(root, null, [{ op: 'set', clip: 't', field: 'at', value: 4 }]);
  write(root, F([page('t', { at: 4, class: 'read' }), page('u', { at: 5 })]));
  await settleProjectFilm(root);
  write(root, F([page('t', { at: 6, class: 'read' }), page('u', { at: 5 })]));
  await settleProjectFilm(root);
  assert.equal(clip(read(root), 't').at, 6);
});
test('attack 7: a new edit after a note is kept anew over the told agent\'s write; the others it was told of are its', async () => {
  const start = F([page('t', { at: 1 }), page('u', { at: 5 })]);
  const root = await project(start);
  await editProjectFilm(root, null, [{ op: 'set', clip: 't', field: 'at', value: 4 }, { op: 'set', clip: 'u', field: 'at', value: 7 }]);
  write(root, start);
  await settleProjectFilm(root);
  assert.ok(tell(root));
  await editProjectFilm(root, null, [{ op: 'set', clip: 't', field: 'at', value: 8 }]);
  write(root, start);
  await settleProjectFilm(root);
  assert.deepEqual([clip(read(root), 't').at, clip(read(root), 'u').at], [8, 5]);
});
test('N3, N4: the told agent\'s value sticks, whatever names the commands go by (an old conversation, a new pid each time)', async () => {
  const start = F([page('t', { at: 1 }), page('u', { at: 5 })]);
  const root = await project(start);
  tell(root, 'app:yesterday');
  await editProjectFilm(root, null, [{ op: 'set', clip: 't', field: 'at', value: 4 }, { op: 'set', clip: 'u', field: 'at', value: 7 }]);
  const nine = F([page('t', { at: 9 }), page('u', { at: 5 })]);
  write(root, nine);
  await settleProjectFilm(root);
  assert.equal(clip(read(root), 't').at, 4);
  assert.ok(tell(root, 'pid:2'));
  write(root, nine);
  await settleProjectFilm(root);
  assert.equal(clip(read(root), 't').at, 9);
  /* the writer has what Studio keeps: nothing is left to tell */
  assert.equal(tell(root, 'pid:3'), null);
  write(root, F([page('t', { at: 9, class: 'x' }), page('u', { at: 5 })]));
  await settleProjectFilm(root);
  assert.equal(clip(read(root), 't').at, 9);
});
test('N5: a version the person saves does not end the keeping: an older copy after it is still put right', { timeout: 30_000 }, async () => {
  const { project: made } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Saved') } })).json();
  const start = F([page('t', { at: 1 }), page('u', { at: 5 })]);
  write(made.path, start);
  const now = await (await api(`/api/projects/${made.id}`)).json();
  await api(`/api/projects/${made.id}/edit`, { method: 'POST', body: { base: now.rev, ops: [{ op: 'set', clip: 't', field: 'at', value: 4 }] } });
  assert.equal((await api(`/api/projects/${made.id}/history/save`, { method: 'POST', body: { message: 'mine' } })).status, 200);
  write(made.path, start);
  await settleProjectFilm(made.path);
  assert.equal(clip(read(made.path), 't').at, 4);
});

test('N6: a note never passed on does not count: an older copy is put right, an hour on', async () => {
  const start = F([page('t', { at: 1 }), page('u', { at: 5 })]);
  const root = await project(start);
  await editProjectFilm(root, null, [{ op: 'set', clip: 't', field: 'at', value: 4 }]);
  write(root, F([page('t', { at: 1 }), page('u', { at: 5, class: 'x' })]));
  await settleProjectFilm(root);
  assert.ok(personEdits.noteFor(root, 'app:c1'));
  const real = Date.now;
  Date.now = () => real() + 60 * 60_000;
  try {
    write(root, start);
    await settleProjectFilm(root);
  } finally { Date.now = real; }
  assert.equal(clip(read(root), 't').at, 4);
});
test('timeout.mjs: a note is answered at once on a long film, and one the command gave up on is not counted told', { timeout: 60_000 }, async () => {
  const text = filmHtml({ stage: { w: 1920, h: 1080 }, tracks: Array.from({ length: 20 }, (_, t) => ({ clips: Array.from({ length: 100 }, (_, i) => page(`t${t}c${i}`, { at: i * 2 })) })) });
  const { project: made } = await (await api('/api/projects', { method: 'POST', body: { path: join(scratch, 'Long') } })).json();
  writeFileSync(join(made.path, 'film.html'), text);
  const kept = (o) => api(`/api/kept?folder=${encodeURIComponent(made.path)}&agent=pid:9`, o).then((r) => r.json());
  await kept();
  await settleProjectFilm(made.path);
  await editProjectFilm(made.path, null, [{ op: 'set', clip: 't0c0', field: 'at', value: 1 }]);
  writeFileSync(join(made.path, 'film.html'), text);
  await settleProjectFilm(made.path);
  writeFileSync(join(made.path, 'film.html'), text);
  const t0 = performance.now();
  const note = await kept();
  assert.ok(performance.now() - t0 < 500, `${Math.round(performance.now() - t0)} ms`);
  assert.match(note.line, /clip t0c0 at/);
  /* never said passed on: the agent's stale copy is still put right */
  await settleProjectFilm(made.path);
  assert.equal(clips(made.path).find((c) => c.id === 't0c0').at, 1);
});

test('two writers: one having the edit does not let the other\'s older copy through; between writes, the later stands', async () => {
  const start = F([page('t', { at: 1 }), page('u', { at: 5 })]);
  const root = await project(start);
  const stale = structuredClone(start);
  await editProjectFilm(root, null, [{ op: 'set', clip: 't', field: 'at', value: 4 }]);
  const fresh = structuredClone(read(root));
  fresh.tracks[0].clips[1].class = 'a';
  write(root, fresh);
  await settleProjectFilm(root);
  stale.tracks[0].clips[1].class = 'b';
  write(root, stale);
  await settleProjectFilm(root);
  assert.equal(clip(read(root), 't').at, 4);
  /* both writers set u's class from where they started: only the person's edits outrank a write, so the later */
  assert.equal(clip(read(root), 'u').class, 'b');
});

test('undo: 1 → 4 → 6, then undo to 4: an older copy with 1 gets 4', async () => {
  const root = await project(F([page('t', { at: 1 })]));
  const set = (v) => [{ op: 'set', clip: 't', field: 'at', value: v }];
  await editProjectFilm(root, null, set(4));
  await editProjectFilm(root, null, set(6));
  await editProjectFilm(root, null, set(4), { undo: true });
  write(root, F([page('t', { at: 1 })]));
  await settleProjectFilm(root);
  assert.equal(clip(read(root), 't').at, 4);
});

test('nohtml.mjs: a film.html without </html> reads and edits without waiting', async () => {
  const root = mkdtempSync(join(scratch, 'p-'));
  writeFileSync(join(root, 'film.html'), filmHtml(F([page('a')])).replace(/<\/body>\s*<\/html>\s*$/i, ''));
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    await editProjectFilm(root, null, [{ op: 'set', clip: 'a', field: 'at', value: i + 1 }]);
    assert.ok(performance.now() - t0 < 500, `${Math.round(performance.now() - t0)} ms`);
  }
  const t0 = performance.now();
  await settleProjectFilm(root);
  assert.ok(performance.now() - t0 < 500);
});

test('a page in Latin-1 the person pasted into: Studio\'s own write is no news, and an older copy gets the person\'s bytes back', async () => {
  const root = await project(F([page('a')]));
  const latin = (t) => Buffer.from(t, 'latin1');
  writeFileSync(join(root, 'p.html'), latin('<meta charset="iso-8859-1">\n<p>café</p>\n'));
  const had = readFileSync(join(root, 'p.html'));
  writeFileSync(join(root, 'p.html'), latin('<meta charset="iso-8859-1">\n<p>café</p>\n<p>new</p>\n'));
  personEdits.filesWritten(root, { 'p.html': had }, { 'p.html': readFileSync(join(root, 'p.html')) });
  await personEdits.settleFiles(root, ['p.html']);
  assert.deepEqual(readFileSync(join(root, 'p.html')), latin('<meta charset="iso-8859-1">\n<p>café</p>\n<p>new</p>\n'));
  assert.equal(tell(root), null);
  writeFileSync(join(root, 'p.html'), latin('<meta charset="iso-8859-1">\n<p>café</p>\n<p>agent é</p>\n'));
  await personEdits.settleFiles(root, ['p.html']);
  assert.deepEqual(readFileSync(join(root, 'p.html')), latin('<meta charset="iso-8859-1">\n<p>café</p>\n<p>new</p>\n<p>agent é</p>\n'));
});

test('G, g.mjs: a film.html cut short that still reads is waited on until its bytes settle, and the whole write that follows is the one merged', { timeout: 10_000 }, async () => {
  const start = F(Array.from({ length: 20 }, (_, i) => page(`p${i}`, { at: i })), Array.from({ length: 20 }, (_, i) => page(`q${i}`, { at: i })));
  const root = await project(start);
  await editProjectFilm(root, null, [{ op: 'set', clip: 'p0', field: 'at', value: 0.5 }]);
  const text = filmHtml(start);
  const cut = text.indexOf('</section>') + '</section>'.length;
  assert.ok(readFilmFile(text.slice(0, cut)).doc, 'a cut that reads as a film');
  writeFileSync(join(root, 'film.html'), text.slice(0, cut));
  /* as the folder watcher settles it: it waits for the same bytes twice */
  const settling = settleProjectFilm(root, { stable: true });
  await pause(100);
  writeFileSync(join(root, 'film.html'), text);
  await settling;
  await settleProjectFilm(root, { stable: true });
  assert.equal(clips(root).length, 40);
  assert.equal(clip(read(root), 'p0').at, 0.5);
});

test('H: the person\'s undo is their latest edit: the agent\'s width written again over it loses until it is told, then stands', async () => {
  const start = F([page('title', { at: 0 })]);
  const root = await project(start);
  await editProjectFilm(root, null, [{ op: 'props', edits: [{ clip: 'title', prop: 'box', value: { x: 300, y: 0, w: 640, h: 360 } }] }]);
  const agent = structuredClone(start);
  agent.tracks[0].clips[0].box.w = 1200;
  write(root, agent);
  await settleProjectFilm(root);
  assert.deepEqual(clip(read(root), 'title').box, { x: 300, y: 0, w: 1200, h: 360 });
  /* the editor's undo: the box as it was, whole */
  await editProjectFilm(root, null, [{ op: 'fields', clip: 'title', fields: { box: { x: 0, y: 0, w: 640, h: 360 } } }], { undo: true });
  const again = structuredClone(read(root));
  again.tracks[0].clips[0].box.w = 1200;
  write(root, again);
  await settleProjectFilm(root);
  assert.equal(clip(read(root), 'title').box.w, 640);
  assert.ok(tell(root));
  write(root, again);
  await settleProjectFilm(root);
  assert.equal(clip(read(root), 'title').box.w, 1200);
});

test('I: a page the person made is put back over a write without it; once the agent has written it, its edits stand', async () => {
  const root = await project(F([page('a')]));
  personEdits.filesWritten(root, { 'layer.html': null }, { 'layer.html': '<h1>Hi</h1>\n' });
  assert.deepEqual(personEdits.mergeFileWrite(root, 'layer.html', null), Buffer.from('<h1>Hi</h1>\n'));
  assert.equal(personEdits.mergeFileWrite(root, 'layer.html', Buffer.from('<h1>Hi</h1>\n<style>h1{color:red}</style>\n')), undefined);
});

test('a page the person made is put back over a write without it; told of it, the agent\'s deleting it stands', async () => {
  const root = await project(F([page('a')]));
  personEdits.filesWritten(root, { 'layer.html': null }, { 'layer.html': '<h1>Hi</h1>\n' });
  assert.deepEqual(personEdits.mergeFileWrite(root, 'layer.html', null), Buffer.from('<h1>Hi</h1>\n'));
  assert.ok(tell(root));
  assert.equal(personEdits.mergeFileWrite(root, 'layer.html', null), undefined);
});
test('race2.mjs: an agent write landing while a merge is made is merged in turn, never written over', { timeout: 20_000 }, async () => {
  const big = F(...Array.from({ length: 20 }, (_, t) => Array.from({ length: 50 }, (_, i) => page(`t${t}c${i}`, { at: i * 2 }))));
  const root = await project(big);
  await editProjectFilm(root, null, [{ op: 'set', clip: 't0c0', field: 'at', value: 1 }]);
  const v2 = structuredClone(big);
  v2.tracks[1].clips.push(page('agentnew', { at: 900 }));
  writeFileSync(join(root, 'v2.txt'), filmHtml(v2));
  write(root, big);
  let wrote = false;
  const other = spawn(process.execPath, ['-e', `require('fs').copyFileSync(${JSON.stringify(join(root, 'v2.txt'))}, ${JSON.stringify(join(root, 'film.html'))})`]);
  other.once('exit', () => { wrote = true; });
  await settleProjectFilm(root);
  await until(() => wrote);
  await settleProjectFilm(root);
  const all = clips(root);
  assert.ok(all.some((c) => c.id === 'agentnew'), 'the second write survived');
  assert.equal(all.find((c) => c.id === 't0c0').at, 1);
});

test('more.mjs: a clip added beside clips the agent removed comes back; a hidden track stays hidden over an older copy', async () => {
  const root = await project(F([page('a', { at: 0 }), page('b', { at: 5 })], [page('m', { at: 0 })]));
  await editProjectFilm(root, null, [{ op: 'insert', clip: { src: 'n.html', at: 2, box: { x: 0, y: 0 } }, after: 'a' }]);
  write(root, F([page('m', { at: 0 })], [page('z', { at: 1 })]));
  await settleProjectFilm(root);
  assert.ok(ids(read(root)).flat().includes('n'));

  const start = F([page('a')], [page('m')]);
  const other = await project(start);
  await editProjectFilm(other, null, [{ op: 'track', track: 1, field: 'hidden', value: true }]);
  write(other, start);
  await settleProjectFilm(other);
  assert.equal(read(other).tracks[1].hidden, true);
});

test('L: a long film merges in reasonable time', { timeout: 60_000 }, async () => {
  const big = F(...Array.from({ length: 20 }, (_, t) => Array.from({ length: 100 }, (_, i) => page(`t${t}c${i}`, { at: i * 2, overrides: [{ at: '#a', t: [1, 2] }] }))));
  const root = await project(big);
  await editProjectFilm(root, null, [{ op: 'props', edits: Array.from({ length: 100 }, (_, i) => ({ clip: `t0c${i}`, prop: 'box', value: { x: 9, y: 0, w: 640, h: 360 } })) }]);
  write(root, big);
  const t0 = performance.now();
  await settleProjectFilm(root);
  const ms = performance.now() - t0;
  assert.equal(clip(read(root), 't0c99').box.x, 9);
  assert.ok(ms < 15_000, `${Math.round(ms)} ms`);
});

test('the note names only what the person changed: a default Studio leaves out (at 0) is not a change of theirs', async () => {
  const root = mkdtempSync(join(scratch, 'p-'));
  const agent = (cls) => filmHtml(F([page('t1', { at: 0, overrides: [{ at: '#title', t: [0, 0] }], ...(cls ? { class: cls } : {}) }), page('u', { at: 5 })]));
  writeFileSync(join(root, 'film.html'), agent());
  assert.match(readFileSync(join(root, 'film.html'), 'utf8'), /at="0"|<iframe[^>]*id="t1"/);
  await settleProjectFilm(root);
  await editProjectFilm(root, null, [{ op: 'fields', clip: 't1', fields: { overrides: [{ at: '#title', t: [40, 12] }] } }]);
  for (const cls of ['a', 'b', 'c']) {
    writeFileSync(join(root, 'film.html'), agent(cls));
    await settleProjectFilm(root);
  }
  assert.deepEqual(clip(read(root), 't1').overrides, [{ at: '#title', t: [40, 12] }]);
  const line = tell(root);
  assert.match(line, /clip t1 overrides at #title t/);
  assert.doesNotMatch(line, /clip t1 at\b/);
});

/* ── a merge that fails ── */

/** A worker module that misbehaves as `how` says: throws, dies, hangs. */
function badWorker(how) {
  const file = join(scratch, `worker-${how}.mjs`);
  writeFileSync(file, `import { parentPort } from 'node:worker_threads';
parentPort.on('message', (m) => {
  ${how === 'throw' ? "parentPort.postMessage({ id: m.id, error: 'boom' });" : how === 'exit' ? 'process.exit(3);' : 'for (;;);'}
});
`);
  return new URL(`file://${file}`);
}
const long = (w) => ({ stage: { w, h: 1080 }, tracks: Array.from({ length: 11 }, (_, t) => ({ clips: Array.from({ length: 100 }, (_, i) => page(`t${t}c${i}`, { at: i * 2 })) })) });

for (const how of ['throw', 'exit', 'timeout']) {
  test(`a merge in the worker that ${how === 'timeout' ? 'takes too long' : how === 'exit' ? 'dies' : 'throws'}: the person's edit stays, nothing hangs, the agent is told`, { timeout: 30_000 }, async () => {
    personEdits.configure({ worker: badWorker(how), mergeMs: 1500 });
    try {
      const root = await project(long(1920));
      await editProjectFilm(root, null, [{ op: 'set', clip: 't0c0', field: 'at', value: 7 }]);
      /* an agent's stale write, with a change of its own */
      write(root, long(1234));
      await settleProjectFilm(root);
      const v = read(root);
      assert.equal(clip(v, 't0c0').at, 7);
      if (how === 'timeout') {
        /* not done again here: the person's film stands, the agent's is kept aside */
        assert.equal(v.stage.w, 1920);
        assert.match(tell(root), /film\.html as a whole/);
      } else {
        /* done again here: merged */
        assert.equal(v.stage.w, 1234);
      }
      /* the project goes on: the next edit and the next look */
      await editProjectFilm(root, null, [{ op: 'set', clip: 't1c1', field: 'at', value: 3 }]);
      assert.equal(clip(read(root), 't0c0').at, 7);
      assert.equal(clip(read(root), 't1c1').at, 3);
    } finally {
      personEdits.configure({ worker: new URL('./person-merge-worker.mjs', import.meta.url), mergeMs: 60_000 });
    }
  });
}

test('a merge that throws here: the person\'s film stands over the write, the write is merged no later as it is, the agent is told', async () => {
  const root = await project(F([page('t', { at: 1 }), page('u', { at: 5 })]));
  await editProjectFilm(root, null, [{ op: 'set', clip: 't', field: 'at', value: 7 }]);
  personEdits.configure({ merge: () => { throw new Error('boom'); } });
  try {
    write(root, F([page('t', { at: 1 }), page('u', { at: 5, class: 'agent' })]));
    await settleProjectFilm(root);
    assert.equal(clip(read(root), 't').at, 7);
    assert.equal(clip(read(root), 'u').class, undefined);
    await settleProjectFilm(root);
    assert.equal(clip(read(root), 't').at, 7);
    assert.match(tell(root), /film\.html as a whole \(your write could not be merged; it is kept aside/);
  } finally {
    personEdits.configure({ merge: (await import('./person-merge.mjs')).mergeWrite });
  }
});

test('two agents about: one that read the latest and was told changes what the note named; a stale copy of the other\'s does not', async () => {
  const root = await project(F([page('t', { at: 1 }), page('u', { at: 5 })]));
  await editProjectFilm(root, null, [{ op: 'set', clip: 't', field: 'at', value: 4 }]);
  tell(root, 'pid:77'); tell(root, 'app:conv');
  const set = async (at) => { const v = read(root); clip(v, 't').at = at; write(root, v); await settleProjectFilm(root); tell(root, 'pid:77'); tell(root, 'app:conv'); return clip(read(root), 't').at; };
  /* the first write is a tie (it changes what the person changed): the person's stands, both are told; then the
     change, sent again from the latest, stands; a change of its own value after is no edit of the person's */
  assert.equal(await set(7), 4);
  assert.equal(await set(7), 7);
  assert.equal(await set(8), 8);
  /* the person again; the other agent writes its copy from before, unchanged but for one clip of its own */
  await editProjectFilm(root, null, [{ op: 'set', clip: 't', field: 'at', value: 9 }]);
  tell(root, 'pid:77'); tell(root, 'app:conv');
  write(root, F([page('t', { at: 8 }), page('u', { at: 5, class: 'b' })]));
  await settleProjectFilm(root);
  assert.equal(clip(read(root), 't').at, 9);
  assert.equal(clip(read(root), 'u').class, 'b');
});

const mod = (v, f) => { const x = structuredClone(v); f(x); return x; };

test('two agents asked after the person\'s edit; one is told: the other\'s stale write, never told, does not move what the person changed (i3)', async () => {
  const start = F([page('title'), page('card', { at: 5 })]);
  const root = await project(start);
  tell(root, 'pid:77'); tell(root, 'app:conv');
  await editProjectFilm(root, null, [{ op: 'props', edits: [{ clip: 'title', prop: 'box', value: { x: 300, y: 0, w: 640, h: 360 } }] }]);
  tell(root, 'pid:77'); tell(root, 'app:conv');
  const a = mod(start, (f) => { clip(f, 'title').box.x = 640; });
  write(root, a); await settleProjectFilm(root);
  assert.equal(clip(read(root), 'title').box.x, 300);
  tell(root, 'pid:77');
  write(root, mod(start, (f) => { clip(f, 'title').box.x = 100; })); await settleProjectFilm(root);
  assert.equal(clip(read(root), 'title').box.x, 300);
  /* the told agent sends its write again, unchanged: meant */
  write(root, a); await settleProjectFilm(root);
  assert.equal(clip(read(root), 'title').box.x, 640);
});

test('a clip a write would leave unreadable: an earlier agent\'s fade gives way to a later one\'s trim, unnamed; the person\'s fade stands, named (unfit)', async () => {
  const start = F([{ id: 'v', src: 'v.mp4', time: [0, 6] }, { id: 't', src: 't.html', at: 7 }]);
  const trim = (copy) => mod(copy, (f) => { clip(f, 'v').time = [0, 3]; });
  /* the person edits something else; agent B reads; agent A adds a 2+2 s fade; B, from its copy, trims v to 3 s */
  const root = await project(start);
  await editProjectFilm(root, null, [{ op: 'set', clip: 't', field: 'at', value: 8 }]);
  const copy = read(root);
  write(root, mod(copy, (f) => { clip(f, 'v').overrides = [{ fade: [2, 2] }]; }));
  await settleProjectFilm(root);
  write(root, trim(copy));
  await settleProjectFilm(root);
  assert.deepEqual(clip(read(root), 'v'), { id: 'v', src: 'v.mp4', time: [0, 3] });
  assert.equal(clip(read(root), 't').at, 8);
  assert.equal(tell(root, 'pid:B'), null);
  /* the same, the fade the person's: it stands, the trim gives way, and B is told */
  const mine = await project(start);
  const before = read(mine);
  await editProjectFilm(mine, null, [{ op: 'set', clip: 'v', field: 'overrides', value: [{ fade: [2, 2] }] }]);
  write(mine, trim(before));
  await settleProjectFilm(mine);
  assert.deepEqual(clip(read(mine), 'v').time, [0, 6]);
  assert.deepEqual(clip(read(mine), 'v').overrides, [{ fade: [2, 2] }]);
  assert.match(tell(mine, 'pid:B'), /clip v time/);
});

test('a clip a write would leave unreadable: a box size the person removed stays removed, the earlier agent\'s fade gives way, and the note names only what stood (P2)', async () => {
  const v0 = { id: 'v', src: 'v.mp4', time: [0, 6], box: { x: 0, y: 0, w: 640, h: 360 } };
  const root = await project(F([v0, { id: 't', src: 't.html', at: 7 }]));
  const copy = read(root);
  write(root, mod(copy, (f) => { clip(f, 'v').overrides = [{ fade: [2, 2] }]; }));
  await settleProjectFilm(root);
  await editProjectFilm(root, null, [{ op: 'fields', clip: 'v', fields: { box: { x: 0, y: 0 } } }]);
  write(root, mod(copy, (f) => { clip(f, 'v').time = [0, 3]; }));
  await settleProjectFilm(root);
  assert.deepEqual(clip(read(root), 'v'), { id: 'v', src: 'v.mp4', time: [0, 3], box: { x: 0, y: 0 } });
  const line = tell(root, 'pid:B');
  assert.match(line, /clip v box\.w; clip v box\.h\./);
  assert.doesNotMatch(line, /time|fade/);
});

test('a clip a write would leave unreadable: the writer is told of a whole field of its that gave way (N1), and a field only writes set is no one\'s but theirs (N2)', async () => {
  /* N1: the person trims v; agent B, from its copy before, adds a 2+2 s fade that no longer fits */
  const one = await project(F([{ id: 'v', src: 'v.mp4', time: [0, 6] }, { id: 't', src: 't.html', at: 7 }]));
  const copy = read(one);
  await editProjectFilm(one, null, [{ op: 'set', clip: 'v', field: 'time', value: [0, 3] }]);
  write(one, mod(copy, (f) => { clip(f, 'v').overrides = [{ fade: [2, 2] }]; clip(f, 't').class = 'x'; }));
  await settleProjectFilm(one);
  assert.deepEqual(clip(read(one), 'v'), { id: 'v', src: 'v.mp4', time: [0, 3] });
  assert.match(tell(one, 'pid:B'), /clip v time; clip v overrides\./);
  /* N2: the person adds v; agent A adds a fade; agent B, from its copy before A's, sets speed 2 */
  const two = await project(F([{ id: 't', src: 't.html', at: 7 }]));
  await editProjectFilm(two, null, [{ op: 'insert', clip: { id: 'v', src: 'v.mp4', time: [0, 6], at: 10 } }]);
  const before = read(two);
  write(two, mod(before, (f) => { clip(f, 'v').overrides = [{ fade: [2, 2] }]; }));
  await settleProjectFilm(two);
  write(two, mod(before, (f) => { clip(f, 'v').speed = 2; }));
  await settleProjectFilm(two);
  assert.deepEqual(clip(read(two), 'v'), { id: 'v', src: 'v.mp4', time: [0, 6], at: 10, speed: 2 });
  assert.equal(tell(two, 'pid:B'), null);
});
