import { test as it } from 'node:test';
import assert from 'node:assert/strict';
import type { FilmDoc } from './film.ts';
import { droppedOverrides, undoneFields } from './dropped-overrides.ts';

const doc = (tracks: unknown): FilmDoc => ({ stage: { w: 1920, h: 1080 }, tracks } as unknown as FilmDoc);
const title = { at: '#title', text: 'Hello' };
const moved = { at: '.logo', n: 0, t: [10, 20] };

it('finds the person’s changes an outside write left out, on clips that are still there', () => {
  const before = doc([{ clips: [{ src: 'scenes/a.html', time: [0, 3], overrides: [title, moved] }] }]);
  const after = doc([{ clips: [{ src: 'scenes/a.html', time: [0, 4] }] }]);
  const [d] = droppedOverrides(before, after);
  assert.equal(d.loc, 'film.html#0.0');
  assert.deepEqual(d.dropped, [title, moved]);
  assert.deepEqual(d.restored, [title, moved]);
});

it('keeps what the writer kept or changed, and restores only what is gone', () => {
  const before = doc([{ clips: [{ src: 'scenes/a.html', overrides: [title, moved] }] }]);
  const changed = { at: '#title', text: 'Hi' };
  const after = doc([{ clips: [{ src: 'scenes/a.html', overrides: [changed] }] }]);
  const [d] = droppedOverrides(before, after);
  assert.deepEqual(d.dropped, [moved]);
  assert.deepEqual(d.restored, [changed, moved]);
});

it('follows a clip that moved, by id, and by src and occurrence without one', () => {
  const before = doc([
    { clips: [{ id: 'intro', src: 'scenes/a.html', overrides: [title] }, { src: 'scenes/b.html', overrides: [moved] }] },
  ]);
  const after = doc([
    { clips: [{ src: 'scenes/b.html' }] },
    { clips: [{ src: 'scenes/c.html' }, { id: 'intro', src: 'scenes/a.html' }] },
  ]);
  const found = droppedOverrides(before, after);
  assert.deepEqual(found.map((d) => [d.loc, d.dropped]), [
    ['film.html#1.1', [title]],
    ['film.html#0.0', [moved]],
  ]);
});

it('knows a clip by the name the format gives it: an id Studio wrote and its file name are the same clip', () => {
  /* Studio names a clip when the person edits it ("hook"); an agent rewriting film.html leaves the id out */
  const before = doc([{ clips: [{ id: 'hook', src: 'scenes/hook.html', overrides: [title] }, { src: 'scenes/end.html' }] }]);
  const after = doc([{ clips: [{ src: 'scenes/hook.html', volume: 0.5 }, { src: 'scenes/end.html' }] }]);
  const [d] = droppedOverrides(before, after);
  assert.equal(d.loc, 'film.html#0.0');
  assert.deepEqual(d.dropped, [title]);
});

it('says nothing when the clip itself was removed, or nothing was dropped', () => {
  const before = doc([{ clips: [{ src: 'scenes/a.html', overrides: [title] }, { src: 'scenes/b.html', overrides: [moved] }] }]);
  assert.deepEqual(droppedOverrides(before, doc([{ clips: [{ src: 'scenes/b.html', overrides: [moved] }] }])), []);
  assert.deepEqual(droppedOverrides(before, before), []);
  assert.deepEqual(droppedOverrides(null, before), []);
});

const bed = (extra = {}) => ({ src: 'assets/bed.mp3', id: 'bed', ...extra });
const one = (c: object) => ({ stage: { w: 1920, h: 1080 }, tracks: [{ clips: [c] }] }) as never;

it('a person\'s field edits that an outside write changed are found, to be made again', () => {
  const edits = [{ clip: 'bed', prop: 'volume', value: 0.6 }, { clip: 'bed', prop: 'volume', value: 0.45 }, { clip: 'bed', prop: 'speed', value: 1.5 }];
  /* the agent wrote back the volume it read before, and left the speed as the person set it */
  assert.deepEqual(undoneFields(one(bed({ volume: 0.45, speed: 1.5 })), one(bed({ volume: 0.8, speed: 1.5 })), edits).undone, [{ clip: 'bed', prop: 'volume', value: 0.45 }]);
  /* the clip removed on purpose: nothing to make again, and the edits there are not watched any more */
  const gone = undoneFields(one(bed({ volume: 0.45, speed: 1.5 })), { stage: { w: 1920, h: 1080 }, tracks: [] } as never, edits);
  assert.deepEqual(gone.undone, []);
  assert.deepEqual(gone.gone.map((e) => e.prop), ['volume', 'speed']);
  /* a track switch is not a clip field */
  assert.deepEqual(undoneFields(one(bed()), one(bed()), [{ clip: 'bed', prop: 'muted', value: true }]).undone, []);
});

it('an edit is watched across outside writes: a stale copy written after a fresh one is still caught', () => {
  const edits = [{ clip: 'bed', prop: 'volume', value: 0.45 }];
  const mine = one(bed({ volume: 0.45 }));
  /* the agent saves a fresh copy that keeps the person's volume: nothing to say */
  assert.deepEqual(undoneFields(mine, one(bed({ volume: 0.45, at: 2 })), edits).undone, []);
  /* then writes a copy it read before the person's edit: their volume is gone, and that is said */
  assert.deepEqual(undoneFields(one(bed({ volume: 0.45, at: 2 })), one(bed({ volume: 0.8, at: 2 })), edits).undone, edits);
});

it('a write that only reformats changes none of the person\'s edits', () => {
  const edits = [
    { clip: 'bed', prop: 'box', value: { x: 10, y: 20, w: 480 } },
    { clip: 'bed', prop: 'at', value: 1.9666666666 },
    { clip: 'bed', prop: 'start', value: null },
  ];
  const before = one(bed({ box: { x: 10, y: 20, w: 480 }, at: 1.967 }));
  /* keys in another order, a time written to the millisecond, a default written out */
  const after = one({ id: 'bed', at: 1.967, box: { w: 480, y: 20, x: 10 }, src: 'assets/bed.mp3', time: [0] });
  assert.deepEqual(undoneFields(before, after, edits).undone, []);
});

it('only the person\'s own values still in the film are watched: undone, changed again, or settled ones are not', () => {
  const first = { clip: 'bed', prop: 'volume', value: 0.45 };
  const again = { clip: 'bed', prop: 'volume', value: 0.3 };
  /* the person undid it (the film shown here no longer has it): the agent writing another value is no news */
  assert.deepEqual(undoneFields(one(bed({ volume: 0.8 })), one(bed({ volume: 0.7 })), [first]).undone, []);
  /* changed again: only the latest value counts */
  assert.deepEqual(undoneFields(one(bed({ volume: 0.3 })), one(bed({ volume: 0.45 })), [first, again]).undone, [again]);
  /* put back or left out once: not said again */
  assert.deepEqual(undoneFields(one(bed({ volume: 0.3 })), one(bed({ volume: 0.8 })), [first, again], new Set([again])).undone, []);
});
