import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFilm } from '../../src/film-doc.mjs';
import { applyOps } from './ops.mjs';
import { alike, compare, distance, keepFilm, merge3, mergeLines, mergeWrite, renamesOf, unitsOf } from './person-merge.mjs';
import * as personEdits from './person-edits.mjs';

const film = (...tracks) => ({ stage: { w: 1920, h: 1080 }, tracks: tracks.map((clips) => ({ clips })) });
const page = (id, extra = {}) => ({ id, src: `${id}.html`, box: { x: 0, y: 0, w: 640, h: 360 }, ...extra });
const clone = (v) => structuredClone(v);
const ids = (f) => f.tracks.map((t) => t.clips.map((c) => c.id));
const clip = (f, id) => f.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
const mod = (v, f) => { const x = clone(v); f(x); return x; };
/** The note for `agent`, passed on: the line, or null. */
const tell = (root, agent = 'pid:1') => {
  const note = personEdits.noteFor(root, agent);
  if (note) personEdits.noteSaid(note.id);
  return note?.line ?? null;
};

/* ── the merge ── */

test('a write from an older copy: the person\'s edits since stay, the writer\'s own changes are taken', () => {
  const base = film([page('title', { at: 1 }), page('card', { at: 6 })]);
  const ours = mod(base, (f) => { clip(f, 'title').at = 2; clip(f, 'title').box.x = 200; });
  const theirs = mod(base, (f) => { clip(f, 'card').class = 'big'; clip(f, 'card').box.w = 800; });
  const { value, kept } = merge3(base, ours, theirs);
  assert.equal(clip(value, 'title').at, 2);
  assert.deepEqual(clip(value, 'title').box, { x: 200, y: 0, w: 640, h: 360 });
  assert.equal(clip(value, 'card').class, 'big');
  assert.equal(clip(value, 'card').box.w, 800);
  assert.deepEqual(kept.sort(), ['box\0title\0x', 'field\0title\0at']);
  assert.ok(readFilm(value).doc);
});

test('a unit only the writer changed is the writer\'s, a return to an older value too; both changed: the person\'s', () => {
  const base = film([page('t', { at: 4 })]);
  assert.equal(clip(merge3(base, base, film([page('t', { at: 1 })])).value, 't').at, 1);
  const ours = film([page('t', { at: 5 })]);
  const both = merge3(base, ours, film([page('t', { at: 9 })]));
  assert.equal(clip(both.value, 't').at, 5);
  assert.deepEqual(both.kept, ['field\0t\0at']);
  /* float noise is no change: the person's value stays, no conflict */
  assert.equal(clip(merge3(base, ours, film([page('t', { at: 4 + 1e-12 })])).value, 't').at, 5);
  assert.equal(clip(merge3(base, base, film([page('t', { at: 4 + 1e-12 })])).value, 't').at, 4 + 1e-12);
});

test('a field\'s default and its absence are alike: Studio writing at 0 as nothing is no change of the person\'s, and named none', () => {
  const base = film([page('t1', { at: 0, overrides: [{ at: '#title', t: [0, 0] }] })]);
  const ours = mod(base, (f) => { delete clip(f, 't1').at; clip(f, 't1').overrides[0].t = [40, 0]; });
  const theirs = mod(base, (f) => { clip(f, 't1').class = 'agent'; });
  const { value, kept } = merge3(base, ours, theirs);
  assert.deepEqual(kept, ['prop\0t1\0["#title",null,null]\0t']);
  assert.equal(clip(value, 't1').at, 0);
  assert.equal(clip(value, 't1').class, 'agent');
  assert.equal(distance(unitsOf(base), unitsOf(mod(base, (f) => { delete clip(f, 't1').at; }))), 0);
});

test('V2: an overrides entry is merged property by property, its style key by key', () => {
  const base = film([page('t', { overrides: [{ fade: [0.5, 0] }, { at: '#h', t: [0, 0], style: { color: 'blue' } }] })]);
  const ours = mod(base, (f) => { clip(f, 't').overrides[1].t = [40, 0]; });
  const theirs = mod(base, (f) => { clip(f, 't').overrides[1].style = { color: 'blue', opacity: 0.5 }; clip(f, 't').overrides.push({ at: '#n', text: 'Hi' }); });
  assert.deepEqual(clip(merge3(base, ours, theirs).value, 't').overrides,
    [{ fade: [0.5, 0] }, { at: '#h', t: [40, 0], style: { color: 'blue', opacity: 0.5 } }, { at: '#n', text: 'Hi' }]);
});

test('clips: the writer\'s removal stands; one the person changed stays; one added since the base stays (V6); the person\'s removal stands', () => {
  const base = film([page('a'), page('b', { at: 5 }), page('c', { at: 9 })]);
  const ours = mod(base, (f) => { clip(f, 'b').at = 6; f.tracks[0].clips = f.tracks[0].clips.filter((x) => x.id !== 'c'); f.tracks[0].clips.push(page('x', { at: 12 })); });
  const theirs = mod(base, (f) => { f.tracks[0].clips = f.tracks[0].clips.filter((x) => x.id === 'c'); f.tracks[0].clips.push(page('w', { at: 15 })); });
  const { value, kept } = merge3(base, ours, theirs);
  assert.deepEqual(ids(value).flat().sort(), ['b', 'w', 'x']);
  assert.equal(clip(value, 'b').at, 6);
  assert.ok(kept.includes('clip\0b') && kept.includes('clip\0x') && kept.includes('clip\0c'));
  /* a clip the writer renamed, untouched by the person: one clip, under the new name */
  const renamed = film([{ ...page('title'), src: 'a.html' }, page('b', { at: 5 }), page('c', { at: 9 })]);
  assert.deepEqual(ids(merge3(base, base, renamed).value), [['title', 'b', 'c']]);
});

test('tracks: the person\'s move and the writer\'s new clips both stay; the person\'s order and flag over the writer\'s new tracks', () => {
  const base = film([page('a'), page('b', { at: 5 })], [page('c')], [page('d')]);
  const ours = mod(base, (f) => {
    f.tracks[1].clips.push(f.tracks[0].clips.pop());
    f.tracks[2].hidden = true;
    f.tracks.unshift(f.tracks.pop());
  });
  assert.deepEqual(ids(ours), [['d'], ['a'], ['c', 'b']]);
  const theirs = mod(base, (f) => { f.tracks[0].clips.push(page('n', { at: 9 })); f.tracks.push({ clips: [page('e')] }); });
  const { value } = merge3(base, ours, theirs);
  assert.deepEqual(ids(value), [['d'], ['a', 'n'], ['c', 'b'], ['e']]);
  assert.equal(value.tracks[0].hidden, true);
});

test('a clip whose merge would not read: only the writer\'s fields that make it so go back to the person\'s; its others stay', () => {
  const base = film([{ id: 'v', src: 'v.mp4', time: [0, 6] }, page('t', { at: 7 })]);
  const ours = mod(base, (f) => { clip(f, 'v').overrides = [{ fade: [2, 2] }]; clip(f, 't').at = 9; });
  const theirs = mod(base, (f) => { clip(f, 'v').time = [0, 3]; clip(f, 'v').class = 'agent'; clip(f, 'v').volume = 0.5; });
  const { value, kept } = merge3(base, ours, theirs);
  assert.deepEqual(clip(value, 'v'), { ...clip(ours, 'v'), class: 'agent', volume: 0.5 });
  assert.equal(clip(value, 't').at, 9);
  /* the writer is told of its time, and of the fade its copy lacks */
  assert.deepEqual(kept.sort(), ['entry\0v\0', 'field\0t\0at', 'field\0v\0time']);
  assert.ok(readFilm(value).doc);
});

const versionsOf = (...films) => { let k = null; return films.map((f) => (k = keepFilm(f, k))); };

test('the version a write is nearest to: the fewest units apart, the oldest of those as near; a clip one lacks counts once', () => {
  const v0 = film([page('t', { at: 1 }), page('u', { at: 5 })]);
  const v1 = mod(v0, (f) => { clip(f, 't').at = 4; });
  const v2 = mod(v1, (f) => { clip(f, 'u').at = 7; });
  const versions = versionsOf(v0, v1, v2);
  const base = (write) => mergeWrite({ ours: v2, write, versions }).base;
  assert.equal(base(mod(v0, (f) => { clip(f, 'u').class = 'x'; })), 0);
  assert.equal(base(mod(v2, (f) => { clip(f, 'u').class = 'x'; })), 2);
  /* as near to the person's version as to the one before it: the older, so the person's at stands and is named */
  const tie = mergeWrite({ ours: v1, write: mod(v0, (f) => { clip(f, 't').at = 3; }), versions: versions.slice(0, 2) });
  assert.equal(tie.base, 0);
  assert.equal(clip(tie.value, 't').at, 4);
  assert.deepEqual(tie.kept, ['field\0t\0at']);
  /* a clip the write has and the version lacks counts once; one the write lacks, not at all (it may have removed it) */
  const more = mod(v0, (f) => { f.tracks[0].clips.push(page('n', { at: 9, class: 'k' })); });
  assert.equal(distance(unitsOf(more), unitsOf(v0)), 1);
  assert.equal(distance(unitsOf(v0), unitsOf(more)), 0);
  assert.ok(alike(0.1 + 0.2, 0.3));
  assert.ok(!alike(1, 1.001), 'a number only near is another');
});

test('ties go to the person: an undo back to an older value stands over a write as near to the versions before and after', () => {
  /* t: 1, the person makes it 4, the agent reads 4 and writes 9, the person undoes to 1 meanwhile */
  const v0 = film([page('t', { at: 1 }), page('u', { at: 5 })]);
  const v1 = mod(v0, (f) => { clip(f, 't').at = 4; });
  const out = mergeWrite({ ours: v0, write: mod(v1, (f) => { clip(f, 't').at = 9; }), versions: versionsOf(v0, v1, v0) });
  assert.equal(clip(out.value, 't').at, 1);
  assert.deepEqual(out.kept, ['field\0t\0at']);
});

test('notes the write agrees with: one naming a clip\'s unit, and one naming no clip (the stage), by the whole film', () => {
  const v0 = film([page('t', { at: 1 })]);
  const ours = mod(v0, (f) => { clip(f, 't').at = 4; f.stage = { w: 1080, h: 1920 }; });
  const write = mod(ours, (f) => { clip(f, 't').class = 'x'; });
  const out = mergeWrite({ ours, write, versions: versionsOf(v0, ours), notes: ['field\0t\0at', 'stage', 'field\0t\0class'] });
  assert.deepEqual(out.agreed, ['field\0t\0at', 'stage', 'field\0t\0class']);
  const stale = mergeWrite({ ours, write: mod(v0, (f) => { clip(f, 't').class = 'y'; }), versions: versionsOf(v0, ours), notes: ['field\0t\0at', 'stage'] });
  assert.deepEqual(stale.agreed, []);
});

test('ties go to the person in all a unit holds: an entry some of the versions as near lack, every property of it (seed 3649)', () => {
  /* the person added an entry to t; the agent's copy lacks it (its write, merged over); the agent adds the entry too */
  const entry = (color) => [{ at: '#a', t: [0, 0], style: { color } }];
  const v0 = film([page('t'), page('u', { class: 'agent' })]);
  const ours = mod(v0, (f) => { clip(f, 't').overrides = entry('person'); });
  const write = mod(v0, (f) => { clip(f, 't').overrides = entry('agent'); });
  /* as near to the person's version (the colour) as to the copy (the entry): the copy's own lacks the entry */
  const out = mergeWrite({ ours, write, versions: versionsOf(ours, v0, ours), over: [false, true, false] });
  assert.equal(out.base, 0);
  assert.equal(clip(out.value, 't').overrides[0].style.color, 'person');
  assert.ok(out.kept.some((k) => k.startsWith('style\0t\0')));
});

test('the quick comparison of kept versions counts as distance does, and names what differing does', () => {
  const r = random(7);
  for (let n = 0; n < 300; n++) {
    const a = film(...Array.from({ length: 1 + r.int(3) }, (_, t) => Array.from({ length: r.int(4) }, (_, i) => page(`c${t}${i}`, { at: r.int(3) }))));
    const b = mod(a, (f) => {
      for (let k = r.int(4); k > 0; k--) {
        const all = f.tracks.flatMap((t) => t.clips);
        const c = r.pick(all);
        const kind = r.int(7);
        if (!c) f.tracks.push({ clips: [page(`n${n}${k}`)] });
        else if (kind === 0) c.at = r.int(3);
        else if (kind === 1) c.box = { ...c.box, w: r.int(3) };
        else if (kind === 2) { for (const t of f.tracks) t.clips = t.clips.filter((x) => x !== c); }
        else if (kind === 3) r.pick(f.tracks).clips.push(page(`n${n}${k}`));
        else if (kind === 4) { for (const t of f.tracks) t.clips = t.clips.filter((x) => x !== c); r.pick(f.tracks).clips.push(c); }
        else if (kind === 5) r.pick(f.tracks).hidden = true;
        else f.tracks.reverse();
      }
    });
    const c = compare(keepFilm(b), keepFilm(a));
    assert.equal(c.distance, distance(unitsOf(b), unitsOf(a)), JSON.stringify([a, b]));
  }
});

test('renames: a clip the writer gave a new id is the person\'s clip, its edits kept under the new id; a new clip is not', () => {
  const v0 = film([{ id: 'v', src: 'v.mp4', time: [0, 6], at: 0 }, page('t', { at: 7 })]);
  const ours = mod(v0, (f) => { clip(f, 'v').volume = 0.4; clip(f, 't').at = 8; });
  const write = mod(v0, (f) => { clip(f, 'v').class = 'agent'; clip(f, 'v').id = 'intro'; });
  const out = mergeWrite({ ours, write, versions: versionsOf(v0, ours) });
  assert.deepEqual(ids(out.value), [['intro', 't']]);
  assert.deepEqual(clip(out.value, 'intro'), { id: 'intro', src: 'v.mp4', time: [0, 6], at: 0, volume: 0.4, class: 'agent' });
  assert.equal(clip(out.value, 't').at, 8);
  assert.deepEqual(renamesOf(v0, write), new Map([['intro', 'v']]));
  /* the writer removes a card the person moved and adds another of the same file, alike in nothing else: a removal
     and an addition, and the card the person moved comes back (R1) */
  const card = (id, extra) => ({ id, src: 'card.html', box: { x: 0, y: 0, w: 640, h: 360 }, ...extra });
  const c0 = film([card('p1', { at: 0 }), card('p2', { at: 10 })]);
  const moved = mod(c0, (f) => { clip(f, 'p1').box.x = 500; });
  const swap = mod(c0, (f) => { f.tracks[0].clips = [f.tracks[0].clips[1], card('n', { at: 20, box: { x: 900, y: 600, w: 320, h: 180 } })]; });
  const r1 = mergeWrite({ ours: moved, write: swap, versions: versionsOf(c0, moved) });
  assert.deepEqual(ids(r1.value).flat().sort(), ['n', 'p1', 'p2']);
  assert.equal(clip(r1.value, 'p1').box.x, 500);
  assert.equal(clip(r1.value, 'n').box.x, 900);
  /* renamed, moved and resized, its box's place alike: renamed (R2) */
  const r2 = mergeWrite({ ours: moved, write: mod(c0, (f) => { Object.assign(f.tracks[0].clips[0], { id: 'intro', at: 30, box: { x: 0, y: 0, w: 320, h: 180 } }); }), versions: versionsOf(c0, moved) });
  assert.deepEqual(ids(r2.value), [['intro', 'p2']]);
  /* a clip the person added, and one the writer added of the same file: two clips */
  const mine = mod(v0, (f) => { f.tracks[0].clips.push(page('p', { at: 20 })); });
  const theirs = mod(v0, (f) => { f.tracks[0].clips.push({ ...page('p', { at: 20 }), id: 'g' }); });
  assert.deepEqual(ids(mergeWrite({ ours: mine, write: theirs, versions: versionsOf(v0, mine), added: ['p'] }).value).flat().sort(), ['g', 'p', 't', 'v']);
});

test('lines: each side\'s change is taken, next to each other too; where both changed the same lines, the side preferred', () => {
  const base = 'a\nb\nc\nd\ne\n';
  const ours = 'a\nB\nc\nd\ne\n';
  assert.equal(mergeLines(base, ours, 'a\nb\nc\nd\nE\n', 'ours'), 'a\nB\nc\nd\nE\n');
  assert.equal(mergeLines(base, ours, base, 'theirs'), ours);
  assert.equal(mergeLines(base, ours, 'a\nX\nc\nd\ne\nf\n', 'ours'), 'a\nB\nc\nd\ne\nf\n');
  assert.equal(mergeLines('a\nb\nc\n', 'a\nB\nc\n', 'a\nb\nX\nc\n', 'ours'), 'a\nB\nX\nc\n');
  assert.equal(mergeLines('a\nb\nc\n', 'a\nb\nc\nd\n', 'z\na\nb\nc\n', 'ours'), 'z\na\nb\nc\nd\n');
  assert.equal(mergeLines('a\nb\nc\nd\n', 'a\nB\nc\nd\n', 'a\nb\nC\nd\n', 'ours'), 'a\nB\nC\nd\n');
  const long = Array.from({ length: 3000 }, (_, i) => `line ${i}\n`).join('');
  const both = mergeLines(long, long.replace('line 10\n', 'PERSON 10\n'), long.replace('line 2990\n', 'AGENT 2990\n'), 'ours');
  assert.ok(both.includes('PERSON 10\n') && both.includes('AGENT 2990\n'));
});

/* ── the store: versions, the base inferred, notes ── */

/** A project's record driven as Studio drives it: `now` what Studio has; `edit` the person's; `write` someone else's. */
async function project(root, start) {
  personEdits.forget(root);
  let n = 0;
  let now = clone(start);
  await personEdits.mergeFilmWrite(root, { rev: `r${n++}`, value: now });
  return {
    get now() { return now; },
    edit(ops) { const after = applyOps(clone(now), ops); personEdits.filmWritten(root, now, after, `r${n++}`, { ops }); now = after; },
    /** someone else's write, merged: the film Studio has after (with the units the writer is told of, `full`) */
    async write(value, full = false) {
      const merge = await personEdits.mergeFilmWrite(root, { rev: `r${n++}`, value });
      if (!merge) now = clone(value);
      else {
        assert.ok(readFilm(merge.value).doc);
        personEdits.filmMerged(root, merge.value, `r${n++}`, merge.kept);
        now = merge.value;
      }
      return full ? { value: now, kept: (merge?.kept ?? []).map((k) => k.key) } : now;
    },
  };
}
const at = (f, id) => clip(f, id).at ?? 0;

test('the store, V1: a copy older than any edit of the person\'s, after a note too, keeps the person\'s value', async () => {
  const v1 = film([page('t', { at: 1 }), page('u', { at: 5 })]);
  const p = await project('/tmp/of-pe-v1', v1);
  const v2 = mod(v1, (f) => { clip(f, 't').at = 2; });
  await p.write(v2);
  p.edit([{ op: 'set', clip: 't', field: 'at', value: 4 }]);
  assert.equal(at(await p.write(v2), 't'), 4);
  assert.ok(tell('/tmp/of-pe-v1'));
  assert.equal(at(await p.write(mod(v1, (f) => { clip(f, 'u').class = 'b'; })), 't'), 4);
});

test('the store, V3: an older copy whose value was rounded keeps the person\'s value, before a note and after', async () => {
  const p = await project('/tmp/of-pe-v3', film([page('t', { at: 1.25 }), page('u', { at: 5 })]));
  p.edit([{ op: 'set', clip: 't', field: 'at', value: 4 }]);
  assert.equal(at(await p.write(film([page('t', { at: 1.3 }), page('u', { at: 5 })])), 't'), 4);
  tell('/tmp/of-pe-v3');
  assert.equal(at(await p.write(film([page('t', { at: 1.3 }), page('u', { at: 5, class: 'x' })])), 't'), 4);
});

test('the store: told of an edit, an agent writing back exactly the older values from the latest copy is taken as meant', async () => {
  const root = '/tmp/of-pe-told';
  const v0 = film([page('t', { at: 1 }), page('u', { at: 5 })]);
  const p = await project(root, v0);
  p.edit([{ op: 'set', clip: 't', field: 'at', value: 4 }]);
  /* untold: the older value is an older copy's */
  assert.equal(at(await p.write(v0), 't'), 4);
  assert.match(tell(root), /clip t at.*a change you make then is yours/);
  assert.equal(at(await p.write(v0), 't'), 1);
  assert.equal(tell(root), null);
});

test('the store: an undo is a write like any other: 1 → 4 → 6, undone to 4, an older copy with 1 gets 4', async () => {
  const p = await project('/tmp/of-pe-undo', film([page('t', { at: 1 }), page('u', { at: 5 })]));
  p.edit([{ op: 'set', clip: 't', field: 'at', value: 4 }]);
  p.edit([{ op: 'set', clip: 't', field: 'at', value: 6 }]);
  p.edit([{ op: 'set', clip: 't', field: 'at', value: 4 }]);
  assert.equal(at(await p.write(film([page('t', { at: 1 }), page('u', { at: 5, class: 'x' })])), 't'), 4);
});

test('the store: a note counts only once said passed on; each agent is given it once', async () => {
  const root = '/tmp/of-pe-notes';
  const v0 = film([page('t', { at: 1 })]);
  const p = await project(root, v0);
  p.edit([{ op: 'set', clip: 't', field: 'at', value: 4 }]);
  await p.write(v0);
  assert.ok(personEdits.noteFor(root, 'pid:7'));
  /* given out, never said passed on: the older value is still put right */
  assert.equal(at(await p.write(mod(v0, (f) => { f.tracks[0].clips[0].class = 'x'; })), 't'), 4);
  assert.match(tell(root, 'pid:7'), /clip t at/);
  assert.equal(tell(root, 'pid:7'), null);
  assert.match(tell(root, 'app:c1'), /clip t at/);
});

test('the store: versions share what is alike: hundreds of edits of a long film keep memory and time per edit small', async () => {
  const root = '/tmp/of-pe-grow';
  const big = film(...Array.from({ length: 20 }, (_, t) => Array.from({ length: 100 }, (_, i) => page(`t${t}c${i}`, { at: i * 2 }))));
  const p = await project(root, big);
  const t0 = performance.now();
  for (let k = 0; k < 400; k++) p.edit([{ op: 'props', edits: [{ clip: `t${k % 20}c${k % 100}`, prop: 'box', value: { x: k + 1, y: 0, w: 640, h: 360 } }] }]);
  const { count, anchors, bytes } = personEdits.keptVersions(root);
  assert.ok(count - anchors <= 200, `${count} versions`);
  assert.ok(bytes < 20 << 20, `${bytes} bytes`);
  assert.ok(performance.now() - t0 < 30_000);
  personEdits.forget(root);
});

test('the store: edits of one thing in a row are one version; anchors (writes of others, the version before the person\'s edits) are never let go', async () => {
  const root = '/tmp/of-pe-anchors';
  personEdits.configure({ versions: 4 });
  try {
    const v0 = film([page('t', { at: 1 }), page('u', { at: 5 }), page('w', { at: 9 })]);
    const p = await project(root, v0);
    /* a drag: one version */
    for (let x = 1; x <= 30; x++) p.edit([{ op: 'props', edits: [{ clip: 't', prop: 'box', value: { x, y: 0, w: 640, h: 360 } }] }]);
    assert.equal(personEdits.keptVersions(root).count, 2);
    const agent = mod(p.now, (f) => { clip(f, 'w').class = 'agent'; });
    await p.write(agent);
    /* many edits of different things: the person's oldest go, the two anchors stay */
    for (let k = 0; k < 12; k++) p.edit([{ op: 'set', clip: k % 2 ? 'u' : 'w', field: 'at', value: 20 + k }, { op: 'fields', clip: 't', fields: { class: `k${k}` } }].slice(0, 1 + (k % 2)));
    const kept = personEdits.keptVersions(root);
    assert.ok(kept.hashes.includes(personEdits.versionHash(v0)) && kept.hashes.includes(personEdits.versionHash(agent)));
    assert.ok(kept.count - kept.anchors <= 4);
    /* a copy from the first version, far older than any of the person's kept: their edits all stay */
    const old = await p.write(mod(v0, (f) => { clip(f, 'u').class = 'old copy'; }));
    assert.equal(clip(old, 'u').class, 'old copy');
    assert.equal(clip(old, 'w').class, 'agent');
    assert.equal(clip(old, 'u').at, 31);
    assert.equal(clip(old, 'w').at, 30);
    assert.equal(clip(old, 't').box.x, 30);
  } finally {
    personEdits.configure({ versions: 200 });
    personEdits.forget(root);
  }
});

test('the store: an agent writing again and again keeps the versions to the caps, and its merges as quick', async () => {
  const root = '/tmp/of-pe-writes';
  personEdits.configure({ versions: 20 });
  try {
    let now = film(...Array.from({ length: 10 }, (_, t) => Array.from({ length: 30 }, (_, i) => page(`t${t}c${i}`, { at: i * 2 }))));
    const p = await project(root, now);
    p.edit([{ op: 'set', clip: 't0c0', field: 'at', value: 7 }]);
    const times = [];
    for (let k = 0; k < 300; k++) {
      now = mod(p.now, (f) => { f.tracks[k % 10].clips[k % 30].class = `k${k}`; });
      const t0 = performance.now();
      await p.write(now);
      times.push(performance.now() - t0);
    }
    const { count, anchors } = personEdits.keptVersions(root);
    assert.ok(count - anchors <= 20 && anchors <= 3, JSON.stringify({ count, anchors }));
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    assert.ok(mean(times.slice(-50)) < 3 * mean(times.slice(20, 70)) + 5, `${mean(times.slice(20, 70))} ms, then ${mean(times.slice(-50))} ms`);
    assert.equal(clip(p.now, 't0c0').at, 7);
  } finally {
    personEdits.configure({ versions: 200 });
    personEdits.forget(root);
  }
});

test('the store: past the caps, the first version stays, and a copy older than all kept but it keeps the person\'s edits', async () => {
  const root = '/tmp/of-pe-evict';
  personEdits.configure({ versions: 4 });
  try {
    const v0 = film(Array.from({ length: 30 }, (_, i) => page(`c${i}`, { at: i * 2 })));
    const p = await project(root, v0);
    p.edit([{ op: 'props', edits: [{ clip: 'c0', prop: 'box', value: { x: 777, y: 0, w: 640, h: 360 } }] }]);
    for (let k = 0; k < 40; k++) {
      await p.write(mod(p.now, (f) => { clip(f, `c${1 + (k % 10)}`).class = `a${k}`; }));
      p.edit([{ op: 'set', clip: `c${11 + (k % 10)}`, field: 'at', value: 100 + k }]);
    }
    assert.ok(personEdits.keptVersions(root).hashes.includes(personEdits.versionHash(v0)));
    const out = await p.write(mod(v0, (f) => { clip(f, 'c29').class = 'B'; }));
    assert.equal(clip(out, 'c0').box.x, 777);
    assert.equal(clip(out, 'c29').class, 'B');
    assert.equal(clip(out, 'c11').at, 130);
  } finally {
    personEdits.configure({ versions: 200 });
    personEdits.forget(root);
  }
});

test('the store: an agent\'s own value is no edit of the person\'s: its next write changes it, and it is not named (E)', async () => {
  const root = '/tmp/of-pe-e';
  const stale = film([page('t1', { overrides: [{ at: '#title', t: [0, 0] }] })]);
  const p = await project(root, stale);
  const ask = (said = true) => { const x = personEdits.noteFor(root, 'pid:4242'); if (x && said) personEdits.noteSaid(x.id); return x?.line ?? null; };
  const t2 = (at) => mod(stale, (f) => { f.tracks[0].clips.push(page('t2', { at })); });
  ask();
  p.edit([{ op: 'props', edits: [{ clip: 't1', prop: 'overrides', value: [{ at: '#title', t: [300, 101.6] }] }] }]);
  await p.write(t2(5));
  assert.match(ask(false), /clip t1 overrides/);
  await p.write(t2(6));
  ask();
  /* told, its old copy again with t2 at 7: the person's move stands, its own t2 is 7, and t2 is never named */
  const out = await p.write(t2(7));
  assert.equal(clip(out, 't2').at, 7);
  assert.deepEqual(clip(out, 't1').overrides[0].t, [300, 101.6]);
  const line = ask();
  assert.ok(!line?.includes('t2'), line);
  personEdits.forget(root);
});

test('the store: the agent moves what it was told of, then an old copy comes again: its move stays, and the person is not named for it (r5)', async () => {
  const root = '/tmp/of-pe-r5';
  const stale = film([page('t1', { overrides: [{ at: '#title', t: [0, 0] }] })]);
  const p = await project(root, stale);
  const ask = (said = true) => { const x = personEdits.noteFor(root, 'pid:4242'); if (x && said) personEdits.noteSaid(x.id); return x?.line ?? null; };
  const t2 = (at) => mod(stale, (f) => { f.tracks[0].clips.push(page('t2', { at })); });
  ask();
  p.edit([{ op: 'props', edits: [{ clip: 't1', prop: 'overrides', value: [{ at: '#title', t: [300, 101.6] }] }] }]);
  await p.write(t2(5));
  await p.write(t2(6));
  ask();
  await p.write(mod(p.now, (f) => { clip(f, 't1').overrides = [{ at: '#title', t: [900, 50] }]; }));
  assert.deepEqual(clip(p.now, 't1').overrides[0].t, [900, 50]);
  const out = await p.write(t2(8));
  assert.deepEqual(clip(out, 't1').overrides[0].t, [900, 50]);
  assert.equal(clip(out, 't2').at, 8);
  assert.equal(ask(), null);
  personEdits.forget(root);
});

test('the store: a note passed on lets its agent change what it named, only while no other agent has asked since the person\'s edit', async () => {
  const root = '/tmp/of-pe-two';
  const v0 = film([page('t', { at: 1 }), page('u', { at: 5 })]);
  const p = await project(root, v0);
  p.edit([{ op: 'set', clip: 't', field: 'at', value: 4 }]);
  await p.write(mod(v0, (f) => { clip(f, 't').at = 2; }));
  assert.equal(at(p.now, 't'), 4);
  assert.match(tell(root, 'pid:1'), /clip t at/);
  /* told, it sets t back to 1 from the latest: taken */
  assert.equal(at(await p.write(mod(p.now, (f) => { clip(f, 't').at = 1; })), 't'), 1);
  /* the same again, with a second agent about since the edit: the older value is an older copy's */
  p.edit([{ op: 'set', clip: 't', field: 'at', value: 6 }]);
  await p.write(mod(v0, (f) => { clip(f, 't').at = 2; }));
  personEdits.noteFor(root, 'pid:2');
  assert.match(tell(root, 'pid:1'), /clip t at/);
  assert.equal(at(await p.write(mod(p.now, (f) => { clip(f, 't').at = 1; })), 't'), 6);
  personEdits.forget(root);
});

test('the store: a 5,000-clip film: an edit is recorded in a few ms, and a merge runs in a worker while Studio answers', async () => {
  const root = '/tmp/of-pe-5k';
  const big = film(...Array.from({ length: 50 }, (_, t) => Array.from({ length: 100 }, (_, i) => page(`t${t}c${i}`, { at: i * 2, overrides: [{ at: '#a', t: [1, 2] }] }))));
  const p = await project(root, big);
  const times = [];
  for (let k = 0; k < 250; k++) {
    const t0 = performance.now();
    p.edit([{ op: 'props', edits: [{ clip: `t${k % 50}c${k % 100}`, prop: 'box', value: { x: k + 1, y: 0, w: 640, h: 360 } }] }]);
    times.push(performance.now() - t0);
  }
  /* the edit itself (applyOps, a clone) is most of it: the record adds little */
  const mean = times.slice(-100).reduce((a, b) => a + b) / 100;
  assert.ok(mean < 60, `${mean.toFixed(1)} ms per edit`);
  const stale = mod(big, (f) => { f.tracks[3].clips[3].class = 'agent'; });
  let ticks = 0, longest = 0, last = performance.now();
  const timer = setInterval(() => { const now = performance.now(); longest = Math.max(longest, now - last); last = now; ticks++; }, 5);
  const merged = await p.write(stale);
  clearInterval(timer);
  assert.equal(clip(merged, 't3c3').class, 'agent');
  assert.equal(clip(merged, 't49c49').box.x, 250);
  assert.equal(clip(merged, 't0c0').box.x, 201);
  assert.ok(ticks > 0 && longest < 150, `the event loop stopped for ${longest.toFixed(0)} ms`);
  console.log(`5,000 clips: ${mean.toFixed(1)} ms per edit (with applyOps); the event loop stopped at most ${longest.toFixed(0)} ms during a merge`);
  personEdits.forget(root);
});

test('the store: text files as bytes, Studio\'s own write no news, a page in any encoding kept as it is; a person\'s page comes back', async () => {
  const root = '/tmp/of-pe-files';
  personEdits.forget(root);
  const b = (t) => Buffer.from(t, 'utf8');
  personEdits.filesWritten(root, { 'a.vtt': 'WEBVTT\n\nhello\n' }, { 'a.vtt': 'WEBVTT\n\nHello there\n' });
  assert.equal(personEdits.mergeFileWrite(root, 'a.vtt', b('WEBVTT\n\nHello there\n')), undefined, 'its own write');
  assert.deepEqual(personEdits.mergeFileWrite(root, 'a.vtt', b('WEBVTT\n\nhello\n')), b('WEBVTT\n\nHello there\n'));
  assert.deepEqual(personEdits.mergeFileWrite(root, 'a.vtt', b('WEBVTT\nKind: captions\n\nhello\n')), b('WEBVTT\nKind: captions\n\nHello there\n'));
  assert.match(tell(root), /a\.vtt/);
  const latin = (t) => Buffer.from(t, 'latin1');
  personEdits.filesWritten(root, { 'p.html': latin('<p>café</p>\n') }, { 'p.html': latin('<p>café</p>\n<p>new</p>\n') });
  assert.equal(personEdits.mergeFileWrite(root, 'p.html', latin('<p>café</p>\n<p>new</p>\n')), undefined);
  assert.deepEqual(personEdits.mergeFileWrite(root, 'p.html', latin('<h1>é</h1>\n<p>café</p>\n')), latin('<h1>é</h1>\n<p>café</p>\n<p>new</p>\n'));
  personEdits.filesWritten(root, { 'layer.html': null }, { 'layer.html': '<h1>Hi</h1>\n' });
  assert.deepEqual(personEdits.mergeFileWrite(root, 'layer.html', null), b('<h1>Hi</h1>\n'));
  /* its edits of the person's page are the writer's */
  assert.equal(personEdits.mergeFileWrite(root, 'layer.html', b('<h1>Hi</h1>\n<style>h1{color:red}</style>\n')), undefined);
  personEdits.forget(root);
});

test('the store, V7: a pasted layer stays over an older copy of the page with a change of its own, after a note too', async () => {
  const root = '/tmp/of-pe-v7';
  personEdits.forget(root);
  const old = '<h1 id="t">Hi</h1>\n<p>x</p>\n<hr>\n<p>y</p>\n';
  const pasted = '<h1 id="t">Hi</h1>\n<h1 id="t-copy">Hi</h1>\n<p>x</p>\n<hr>\n<p>y</p>\n';
  personEdits.filesWritten(root, { 'p.html': old }, { 'p.html': pasted });
  const first = personEdits.mergeFileWrite(root, 'p.html', Buffer.from(old.replace('x', 'agent 1')));
  assert.ok(String(first).includes('t-copy') && String(first).includes('agent 1'));
  tell(root);
  /* the same older copy, another line changed: the pasted layer and both its changes */
  const second = personEdits.mergeFileWrite(root, 'p.html', Buffer.from(old.replace('y', 'agent 2')));
  assert.ok(String(second).includes('t-copy') && String(second).includes('agent 1') && String(second).includes('agent 2'));
  personEdits.forget(root);
});

test('the store: a layer pasted, and a block the agent adds from its copy before: both, each with its own closing tag (pagecount)', () => {
  const root = '/tmp/of-pe-pagecount';
  personEdits.forget(root);
  const old = '<body>\n<div id="a">\n  <h1>Title</h1>\n</div>\n<div id="b">\n  <p>Text</p>\n</div>\n</body>\n';
  const pasted = old.replace('</div>\n<div id="b">', '</div>\n<div id="a-copy">\n  <h1>Title</h1>\n</div>\n<div id="b">');
  personEdits.filesWritten(root, { 'p.html': old }, { 'p.html': pasted });
  const agent = old.replace('</body>', '<div id="c">\n  <p>More</p>\n</div>\n</body>');
  const out = String(personEdits.mergeFileWrite(root, 'p.html', Buffer.from(agent)));
  assert.equal(out, mergeLines(old, pasted, agent, 'ours'));
  assert.ok(out.includes('a-copy') && out.includes('id="c"'));
  assert.equal(out.split('</div>').length - 1, 4);
  personEdits.forget(root);
});

test('the store, t7d: undoing a second paste keeps the page\'s bytes as bytes', async () => {
  const root = '/tmp/of-pe-t7d';
  personEdits.forget(root);
  const b = (t) => Buffer.from(t, 'utf8');
  const p0 = b('<h1 id="t">Hi</h1>\n<p>x</p>\n');
  const p1 = b('<h1 id="t">Hi</h1>\n<h1 id="t-copy">Hi</h1>\n<p>x</p>\n');
  const p2 = b('<h1 id="t">Hi</h1>\n<h1 id="t-copy">Hi</h1>\n<h2 id="t-copy-2">Hi</h2>\n<p>x</p>\n');
  personEdits.filesWritten(root, { 'p.html': p0 }, { 'p.html': p1 });
  personEdits.filesWritten(root, { 'p.html': p1 }, { 'p.html': p2 });
  personEdits.filesWritten(root, { 'p.html': p2 }, { 'p.html': p1 }, { undo: true });
  const out = personEdits.mergeFileWrite(root, 'p.html', b('<h1 id="t">Hi</h1>\n<p>agent</p>\n'));
  assert.ok(Buffer.isBuffer(out));
  assert.equal(out.toString(), '<h1 id="t">Hi</h1>\n<h1 id="t-copy">Hi</h1>\n<p>agent</p>\n');
  personEdits.forget(root);
});

/* ── random interleavings, checked against a merge of their own ── */

/** A small deterministic random source. */
function random(seed) {
  let s = seed >>> 0;
  const next = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; };
  return { next, int: (n) => Math.floor(next() * n), pick: (list) => list[Math.floor(next() * list.length)] };
}

/**
 * How many seeds the random runs try. For the long run, 5,000 of them:
 *   OPENFILM_MERGE_SEEDS=5000 node --test --test-name-pattern="random interleavings" studio/server/person-merge.test.mjs
 */
const SEEDS = Number(process.env.OPENFILM_MERGE_SEEDS) || 300;

/**
 * The film's facts as this test sees them, apart from Studio's code: each clip there, its at, box x and w, class, and
 * its `#a` overrides entry's t and style colour.
 */
function factsOf(f) {
  const out = new Map();
  for (const c of f.tracks.flatMap((t) => t.clips)) {
    out.set(`there ${c.id}`, true);
    out.set(`at ${c.id}`, c.at ?? 0);
    out.set(`x ${c.id}`, c.box?.x);
    out.set(`w ${c.id}`, c.box?.w);
    out.set(`class ${c.id}`, c.class);
    const e = (c.overrides ?? []).find((x) => x.at === '#a');
    out.set(`t ${c.id}`, e?.t);
    out.set(`color ${c.id}`, e?.style?.color);
  }
  return out;
}
const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : JSON.stringify(a) === JSON.stringify(b));
/** Whether the units an agent is told of (`kept`) name a fact (`exactly`: as itself, not by the entry or clip it is in). */
function told(kept, fact, exactly = false) {
  const [name, id] = fact.split(' ');
  const e = '["#a",null,null]';
  const names = { there: [], at: [`field\0${id}\0at`], x: [`box\0${id}\0x`, `field\0${id}\0box`], w: [`box\0${id}\0w`, `field\0${id}\0box`],
    class: [`field\0${id}\0class`], t: [`prop\0${id}\0${e}\0t`, `entry\0${id}\0${e}`, `field\0${id}\0overrides`],
    color: [`style\0${id}\0${e}\0color`, `prop\0${id}\0${e}\0style`, `entry\0${id}\0${e}`, `field\0${id}\0overrides`] }[name];
  if (exactly) return names.slice(0, 1).some((k) => kept.includes(k));
  return kept.includes(`clip\0${id}`) || names.some((k) => kept.includes(k));
}
/** `f` with each clip under the id it was first given (`first`: an id an agent renamed, the one it had before). */
const asFirst = (f, first, strict = true) => {
  const out = mod(f, (x) => { for (const c of x.tracks.flatMap((t) => t.clips)) c.id = first.get(c.id) ?? c.id; });
  const ids = out.tracks.flatMap((t) => t.clips.map((c) => c.id));
  if (strict) assert.equal(new Set(ids).size, ids.length, `one clip twice: ${JSON.stringify(f.tracks.map((t) => t.clips.map((c) => c.id)))}`);
  return out;
};

/**
 * One run: the person edits film.html in Studio; two agents write it whole, each from the copy it last read (the latest,
 * asking for notes first as `openfilm` does, sometimes without asking; or one of any age, kept since), with changes of
 * their own: of the same things the person changes, removals, new clips, clips renamed, float noise, every clip at
 * once. Few of the person's versions are kept (`cap`), so copies are older than any of them too. Each write is merged
 * as Studio merges it and checked, fact by fact, against the base the writer really had (no version "as near"):
 * - every change of the person's since that base stands (the person added, removed or changed it);
 * - a change of another write's since gives way to this writer's change of the same (only the person's edits outrank
 *   a write; on a tie, or past versions let go, either may stand), and is never named to the agent;
 * - every change of the writer's stands, unless the person changed the same since, or the agent is told of it and the
 *   write is as near to an older version than its own (ties go to the person); and nothing else changes.
 * A write of an agent's taken as made after another agent's note is the limit the store documents (writes are not
 * signed), and so are that agent's after, by its note, until it asks again: counted, not checked. So are writes from
 * a copy read without asking that is no longer kept.
 */
async function run(seed, { cap = 6, steps = 60 } = {}) {
  const r = random(seed);
  const root = `/tmp/of-person-edits-run-${seed}`;
  personEdits.configure({ versions: cap });
  const stats = { writes: 0, ties: 0, notes: 0, unkept: 0 };
  try {
    const p = await project(root, film(
      [page('p1', { at: 0, overrides: [{ at: '#a', t: [0, 0], style: { color: 'c0' } }] }), page('p2', { at: 5 })],
      [page('p3', { at: 1 }), page('p4', { at: 7 })],
      [page('p5', { at: 2 })],
    ));
    /** every film Studio has seen, by its hash as kept */
    const seen = new Map([[personEdits.versionHash(p.now), clone(p.now)]]);
    const agents = ['pid:1', 'pid:2'].map((name) => ({ name, copy: clone(p.now) }));
    /** each id an agent gave a clip, the id the clip was first given */
    const first = new Map();
    /** the person's last edit, as fields to put back */
    let undo = null;
    /** the facts Studio has as the person left them (by the id each clip was first given), and those a write changed */
    const person = new Set(), taken = new Set();
    /* (a write not checked may leave one clip under two ids: here, either) */
    const changes = (a, b) => { const [fa, fb] = [a, b].map((f) => factsOf(asFirst(f, first, false))); return [...new Set([...fa.keys(), ...fb.keys()])].filter((k) => !same(fa.get(k), fb.get(k))); };
    let made = 0, fresh = 0;
    const value = () => 1000 + fresh++;
    /* both edit these: same-unit conflicts */
    const change = (c, kind) => {
      if (kind === 0) c.at = value();
      else if (kind === 1) c.box = { ...c.box, w: value() };
      else if (kind === 2) c.box = { ...c.box, x: value() };
      else if (kind === 3) c.class = `k${value()}`;
      else if (kind === 4) c.overrides = [{ at: '#a', t: [value(), 0], style: { color: (c.overrides ?? [])[0]?.style?.color ?? 'c0' } }];
      else c.overrides = [{ at: '#a', t: (c.overrides ?? [])[0]?.t ?? [0, 0], style: { color: `c${value()}` } }];
    };
    for (let step = 0; step < steps; step++) {
      const here = p.now.tracks.flatMap((t) => t.clips);
      if (r.next() < 0.45) {
        /* the person, in Studio: the same things the agents change, a clip removed or added, an undo */
        const c = r.pick(here);
        if (!c) continue;
        const kind = r.int(11);
        let ops;
        if (kind >= 9 && undo && here.some((x) => x.id === undo.id)) {
          /* an undo of the person's last edit, after an agent may have read it and changed the same */
          ops = [{ op: 'fields', clip: undo.id, fields: undo.fields }];
          undo = null;
        } else if (kind < 6 || kind >= 9) {
          const after = clone(c);
          change(after, kind % 6);
          const { id: _id, ...fields } = after;
          ops = [{ op: 'fields', clip: c.id, fields }];
          const back = Object.fromEntries(Object.keys(fields).filter((k) => !same(fields[k], c[k]) && c[k] !== undefined).map((k) => [k, clone(c[k])]));
          undo = Object.keys(back).length ? { id: c.id, fields: back } : null;
        }
        else if (kind === 6 && here.length > 3) ops = [{ op: 'remove', clip: c.id }];
        else if (kind === 7) ops = [{ op: 'insert', clip: { id: `n${made++}`, src: 'n.html', at: value(), box: { x: 0, y: 0 } }, after: c.id }];
        else {
          /* back to a value the clip had a few versions ago */
          const old = [...seen.values()].slice(-1 - r.int(4))[0].tracks.flatMap((t) => t.clips).find((x) => x.id === c.id);
          if (!old) continue;
          ops = [{ op: 'fields', clip: c.id, fields: { at: old.at ?? 0 } }];
        }
        const was = clone(p.now);
        p.edit(ops);
        seen.set(personEdits.versionHash(p.now), clone(p.now));
        /* the facts the person set */
        for (const k of changes(was, p.now)) {
          person.add(k);
          taken.delete(k);
          if (k.startsWith('there ')) for (const x of [...taken]) if (x.endsWith(` ${k.slice(6)}`)) taken.delete(x);
        }
        continue;
      }
      /* an agent: it reads the latest (asking for notes first, or not), or keeps the copy it has, of any age */
      const a = r.pick(agents);
      const roll = r.next();
      if (roll < 0.4) { tell(root, a.name); a.copy = clone(p.now); a.asked = true; a.taken = false; }
      else if (roll < 0.5) { a.copy = clone(p.now); a.asked = false; }
      const base = clone(a.copy);
      const theirs = clone(base);
      /** old id → new id */
      const renames = new Map();
      for (let n = 1 + r.int(3); n > 0; n--) {
        const all = theirs.tracks.flatMap((t) => t.clips);
        /* often the clip the person last changed: same-unit conflicts, and ties an undo makes */
        const c = (undo && r.next() < 0.5 && all.find((x) => x.id === undo.id)) || r.pick(all);
        if (!c) continue;
        const kind = r.int(12);
        if (kind < 6) change(c, kind);
        else if (kind === 6 && all.length > 3) { for (const t of theirs.tracks) t.clips = t.clips.filter((x) => x !== c); }
        else if (kind === 7) r.pick(theirs.tracks).clips.push(page(`g${made++}`, { at: value() }));
        else if (kind === 8) c.at = (c.at ?? 0) + 1e-12;
        else if (kind === 9 && !renames.size && c.src !== 'n.html' && base.tracks.some((t) => t.clips.some((x) => x.id === c.id))) {
          renames.set(c.id, `r${made++}`);
          first.set(renames.get(c.id), first.get(c.id) ?? c.id);
          c.id = renames.get(c.id);
        }
        else if (kind === 10) { const k = r.int(6); for (const x of all) change(x, k); }
        else c.class = `k${value()}`;
      }
      theirs.tracks = theirs.tracks.filter((t) => t.clips.length);
      const ours = clone(p.now);
      const { value: got, kept } = await p.write(theirs, true);
      /* the person's facts the write changed in Studio's film are the writer's now; a clip there, all of it */
      const before = new Set(person), took = new Set(taken);
      /* a fact of a clip the person added or removed is the person's too, but where a write changed it since */
      const mine = { has: (k) => before.has(k) || (!k.startsWith('there ') && !took.has(k) && before.has(`there ${k.split(' ')[1]}`)) };
      for (const k of changes(ours, got)) {
        person.delete(k);
        if (!k.startsWith('there ')) taken.add(k);
        else for (const x of [...person]) if (x.endsWith(` ${k.slice(6)}`)) person.delete(x);
      }
      seen.set(personEdits.versionHash(theirs), clone(theirs));
      seen.set(personEdits.versionHash(p.now), clone(p.now));
      a.copy = clone(theirs);
      const asked = a.asked;
      /* its next copy is its own write, which Studio may let go */
      a.asked = false;
      stats.writes++;
      const { note, latest, far } = personEdits.lastMerge(root) ?? {};
      /* a write not checked may leave one clip under two ids: from then on they are two clips */
      const apart = () => { for (const c of got.tracks.flatMap((t) => t.clips)) if (first.has(c.id) && got.tracks.some((t) => t.clips.some((x) => x !== c && (first.get(x.id) ?? x.id) === first.get(c.id)))) first.delete(c.id); };
      /* taken after another agent's note: that agent's note now follows this write, until it asks again */
      if (note && note !== a.name && !latest) { stats.notes++; agents.find((x) => x.name === note).taken = true; apart(); continue; }
      if (note === a.name && a.taken) { stats.notes++; apart(); continue; }
      if (!asked && !personEdits.keptVersions(root).hashes.includes(personEdits.versionHash(base))) { stats.unkept++; apart(); continue; }
      const [T, O, W, R] = [base, ours, theirs, got].map((f) => asFirst(f, first));
      /* as near to an older version than its own: the write's distance from the versions kept, by the ids it had */
      /* the write with each clip under the id `v` has it by (the same clip, renamed) */
      const as = (v) => {
        const id = new Map(v.tracks.flatMap((t) => t.clips.map((c) => [first.get(c.id) ?? c.id, c.id])));
        return keepFilm(mod(theirs, (x) => { for (const c of x.tracks.flatMap((t) => t.clips)) c.id = id.get(first.get(c.id) ?? c.id) ?? c.id; }));
      };
      const own = compare(as(base), keepFilm(base)).distance;
      const tie = personEdits.keptVersions(root).hashes.some((h) => h !== personEdits.versionHash(base) && seen.has(h) && compare(as(seen.get(h)), keepFilm(seen.get(h))).distance <= own);
      const [FT, FO, FW, FR] = [T, O, W, R].map(factsOf);
      const where = `seed ${seed}, step ${step}`;
      /* what the writer is told names a clip by an id it wrote, or the one ours has */
      const ids = (id) => [...got.tracks.flatMap((t) => t.clips), ...theirs.tracks.flatMap((t) => t.clips)].map((c) => c.id).filter((x) => (first.get(x) ?? x) === id);
      const keptClip = (id) => [id, ...ids(id)].some((x) => told(kept, `there ${x}`));
      const toldOf = (k, exactly = false) => { const [name, id] = k.split(' '); return [id, ...ids(id)].some((x) => told(kept, `${name} ${x}`, exactly)); };
      for (const id of new Set([...[FT, FO, FW, FR].flatMap((m) => [...m.keys()].filter((k) => k.startsWith('there ')).map((k) => k.slice(6)))])) {
        const [t, o, w2, g] = [FT, FO, FW, FR].map((m) => m.has(`there ${id}`));
        const facts = [...FO.keys(), ...FW.keys(), ...FT.keys()].filter((k) => k.endsWith(` ${id}`) && !k.startsWith('there '));
        const changedByPerson = t && o && facts.some((k) => !same(FO.get(k), FT.get(k)) && mine.has(k));
        if (!t && o) { assert.ok(g, `${where}: ${id}, added by the person, is gone`); continue; }
        if (t && !o) {
          /* removed: by the person, it stays so; by a write, the writer's changes to it bring it back */
          const wrote = w2 && facts.some((k) => !same(FW.get(k), FT.get(k)));
          if (mine.has(`there ${id}`) || (!wrote && !tie)) assert.ok(!g, `${where}: ${id}, removed ${mine.has(`there ${id}`) ? 'by the person' : 'and unchanged by the writer'}, is back`);
          continue;
        }
        if (!t && w2) { assert.ok(g, `${where}: ${id}, added by the writer, is not there`); for (const k of facts) assert.ok(same(FR.get(k), FW.get(k)), `${where}: ${k}`); continue; }
        if (!t) continue;
        if (!w2) {
          if (!g) continue;
          /* kept over the writer's removal: the person changed it, told; or on a tie, told only of the person's */
          assert.ok((changedByPerson && keptClip(id)) || (tie && (keptClip(id) || !mine.has(`there ${id}`))), `${where}: ${id}, removed by the writer, is there${changedByPerson ? ' untold' : ', with no tie'}`);
          for (const k of facts) assert.ok(same(FR.get(k), FO.get(k)), `${where}: ${k} of ${id} kept is not the person's`);
          continue;
        }
        assert.ok(g, `${where}: ${id} is gone, removed by no one`);
        for (const k of facts) {
          const [ft, fo, fw, fr] = [FT, FO, FW, FR].map((m) => m.get(k));
          if (!same(fo, ft)) {
            /* changed since the base: the person's stands; another write's gives way to this one's, where it changed it */
            if (mine.has(k)) assert.ok(same(fr, fo), `${where}: the person's ${k} (${JSON.stringify(ft)} → ${JSON.stringify(fo)}) is ${JSON.stringify(fr)}`);
            else assert.ok(same(fr, same(fw, ft) ? fo : fw) || ((tie || far) && (same(fr, fo) || same(fr, fw))), `${where}: ${k}, a write's (${JSON.stringify(fo)}), against this one's ${JSON.stringify(fw)}, is ${JSON.stringify(fr)}`);
            if (!mine.has(k) && toldOf(k, true)) assert.fail(`${where}: ${k}, no edit of the person's, is named to the agent`);
          } else if (!same(fw, ft)) {
            if (same(fr, fw)) continue;
            assert.ok(same(fr, fo) && tie && toldOf(k) && mine.has(k), `${where}: the writer's ${k} (${JSON.stringify(ft)} → ${JSON.stringify(fw)}) is ${JSON.stringify(fr)}${tie ? '' : ', with no tie'}${toldOf(k) ? '' : ', untold'}${mine.has(k) ? '' : ', over no edit of the person\'s'}`);
            stats.ties++;
          } else assert.ok(same(fr, ft), `${where}: ${k}, changed by no one, is ${JSON.stringify(fr)}`);
        }
      }
    }
  } finally {
    personEdits.configure({ versions: 200 });
    personEdits.forget(root);
  }
  return stats;
}

test('random interleavings of the person\'s edits and two agents\' writes, from copies of every age, merge as from the base each really had', async () => {
  const all = { writes: 0, ties: 0, notes: 0, unkept: 0 };
  for (let seed = 1; seed <= SEEDS; seed++) for (const [k, v] of Object.entries(await run(seed))) all[k] += v;
  console.log(`${SEEDS} runs: ${all.writes} writes; ${all.ties} changes of a writer's kept as ties, told; ${all.notes} taken after another agent's note and ${all.unkept} from an unkept copy read without asking, not checked`);
});

/**
 * The same on a page, line by line: the person changes lines in Studio; two agents write the page whole from the copy
 * each last read (the latest, sometimes told of the person's lines first; or the one it has, of any age). Checked
 * against the base each writer really had: every line the person added since stays and every one the person removed
 * stays gone; every line the writer added is there, and every one it removed is gone, unless the person changed it,
 * or the agent is told the page was kept over its write.
 */
test('random interleavings on a page: the person\'s lines and each agent\'s own stay, as from the base each really had', () => {
  let writes = 0, toldOf = 0, limited = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = random(seed);
    const root = `/tmp/of-person-edits-page-${seed}`;
    personEdits.forget(root);
    let fresh = 0;
    let now = Array.from({ length: 12 }, (_, i) => `<p>line ${i}</p>\n`).join('');
    personEdits.filesWritten(root, { 'p.html': now }, { 'p.html': now });
    const agents = ['pid:1', 'pid:2'].map((name) => ({ name, copy: now }));
    const change = (text) => {
      const lines = text.split(/(?<=\n)/);
      for (let n = 1 + r.int(2); n > 0; n--) {
        const at = r.int(lines.length);
        const roll = r.next();
        if (roll < 0.3) lines.splice(at, 0, `<p>new ${fresh++}</p>\n`);
        else if (roll < 0.45 && lines.length > 4) lines.splice(at, 1);
        else lines[at] = `<p>changed ${fresh++}</p>\n`;
      }
      return lines.join('');
    };
    const lines = (text) => new Set(text.split(/(?<=\n)/).filter(Boolean));
    for (let step = 0; step < 24; step++) {
      if (r.next() < 0.5) {
        const next = change(now);
        personEdits.filesWritten(root, { 'p.html': now }, { 'p.html': next });
        now = next;
        continue;
      }
      const a = r.pick(agents);
      if (r.next() < 0.4) { tell(root, a.name); a.copy = now; }
      const base = a.copy;
      const theirs = change(base);
      const ours = now;
      const out = personEdits.mergeFileWrite(root, 'p.html', Buffer.from(theirs));
      const got = out === undefined ? theirs : String(out);
      /* Studio wrote over the write: the agents are told of the page */
      const told = out !== undefined;
      writes++;
      /* taken as made after another agent's note, that agent the only one about: the limit the store documents */
      const by = personEdits.lastMerge(root, 'p.html');
      if (by?.note && by.note !== a.name && !by.latest) { limited++; a.copy = theirs; now = got; continue; }
      const [T, O, W, G] = [base, ours, theirs, got].map(lines);
      const where = `seed ${seed}, step ${step}`;
      for (const l of O) if (!T.has(l)) assert.ok(G.has(l), `${where}: the person's ${l.trim()} is gone`);
      for (const l of T) if (!O.has(l)) assert.ok(!G.has(l), `${where}: ${l.trim()}, removed by the person, is back`);
      for (const l of W) if (!T.has(l) && !G.has(l)) { assert.ok(told, `${where}: the writer's ${l.trim()} is gone untold`); toldOf++; }
      for (const l of T) if (!W.has(l) && O.has(l) && G.has(l)) { assert.ok(told, `${where}: ${l.trim()}, removed by the writer, is there untold`); toldOf++; }
      for (const l of G) assert.ok(O.has(l) || W.has(l), `${where}: ${l.trim()} is no one's`);
      const twice = (t) => t.split(/(?<=\n)/).filter((l, i, all) => all.indexOf(l) !== i);
      for (const l of twice(got)) assert.ok(twice(ours).includes(l) || twice(theirs).includes(l), `${where}: ${l.trim()} is there twice`);
      a.copy = theirs;
      now = got;
    }
    personEdits.forget(root);
  }
  console.log(`${SEEDS} runs on a page: ${writes} writes; ${toldOf} lines of a writer's kept out, told; ${limited} taken after another agent's note, not checked`);
});
