import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps, EditError } from '../../../server/ops.mjs';
import type { Film, Op } from '../api';
import { dropStep, moveStep, nextStep, pushStep, type Steps } from './steps.ts';
import { inverse } from './undo.ts';

/* The edit history as the editor keeps it (use-film): ⌘Z pressed again and again goes back step by step and stops at
   the oldest, even when the agent removed what a step was about meanwhile. */

type Step = { undo: Op[]; redo: Op[]; label: string };
const empty = (): Steps<Step> => ({ done: [], undone: [] });
const film = (...tracks: object[][]): Film => ({ stage: { w: 1920, h: 1080 }, tracks: tracks.map((clips) => ({ clips })) as Film['tracks'] });
const ids = (f: Film) => f.tracks.map((t) => t.clips.map((c) => c.id));

/** An editor in short: edits and undos applied as use-film applies them, a refused one leaving the history. */
function editor(start: Film) {
  let value = start;
  let steps = empty();
  return {
    get film() { return value; },
    get steps() { return steps; },
    edit(ops: Op[], label: string) {
      const after = applyOps(structuredClone(value), ops) as Film;
      steps = pushStep(steps, { undo: inverse(value, after, ops), redo: ops, label });
      value = after;
    },
    /** what the agent wrote: the film is the folder's, the history stays */
    outside(next: Film) { value = next; },
    /** ⌘Z: null when it did something, else why not (nothing left, or the step could not be undone) */
    undo(): string | null {
      const one = nextStep(steps, 'undo');
      if (!one) return 'nothing to undo';
      try {
        value = applyOps(structuredClone(value), one.undo) as Film;
        steps = moveStep(steps, one, 'undo');
        return null;
      } catch (e) {
        assert.ok(e instanceof EditError, String(e));
        steps = dropStep(steps, one);
        return e.message;
      }
    },
  };
}

test('undo pressed past the start of the history stops at the oldest film and stays there', () => {
  const start = film([{ src: 'a.html', id: 'a' }, { src: 'b.html', id: 'b', at: 3 }], [{ src: 'c.html', id: 'c' }]);
  const ed = editor(start);
  ed.edit([{ op: 'remove', clip: 'a' }], 'remove a');
  ed.edit([{ op: 'props', edits: [{ clip: 'c', prop: 'at', value: 2 }] }], 'move c');
  for (let i = 0; i < 2; i++) assert.equal(ed.undo(), null);
  assert.deepEqual(ed.film, start);
  for (let i = 0; i < 6; i++) assert.equal(ed.undo(), 'nothing to undo');
  assert.deepEqual(ed.film, start);
  assert.deepEqual(ed.steps.done, []);
  assert.deepEqual(ed.steps.undone.map((s) => s.label), ['move c', 'remove a']);
});

test('a step whose clip the agent removed leaves the history, and the next undo takes the one before it', () => {
  const ed = editor(film([{ src: 'a.html', id: 'a' }], [{ src: 'b.html', id: 'b' }]));
  ed.edit([{ op: 'props', edits: [{ clip: 'a', prop: 'at', value: 1 }] }], 'move a');
  ed.edit([{ op: 'props', edits: [{ clip: 'b', prop: 'at', value: 2 }] }], 'move b');
  /* the agent writes the film again without b */
  ed.outside(film([{ src: 'a.html', id: 'a', at: 1 }]));
  const why = ed.undo();
  assert.match(why ?? '', /b/, 'says why it could not be undone');
  assert.deepEqual(ed.steps.done.map((s) => s.label), ['move a'], 'the refused step is gone, not tried again');
  assert.deepEqual(ed.steps.undone, []);
  assert.equal(ed.undo(), null);
  assert.deepEqual(ids(ed.film), [['a']]);
  assert.equal(ed.film.tracks[0].clips[0].at ?? 0, 0);
  /* and then it stops */
  for (let i = 0; i < 4; i++) assert.equal(ed.undo(), 'nothing to undo');
});

test('moving or dropping a step touches that step only', () => {
  const [a, b, c] = ['a', 'b', 'c'].map((label) => ({ undo: [], redo: [], label }));
  const s = pushStep(pushStep(pushStep(empty(), a), b), c);
  assert.equal(nextStep(s, 'undo'), c);
  assert.equal(nextStep(empty(), 'undo'), null);
  assert.equal(nextStep(empty(), 'redo'), null);
  /* one not on the list it would leave (dropped meanwhile) is not moved, and nothing else is in its place */
  const gone = dropStep(s, c);
  assert.equal(moveStep(gone, c, 'undo'), gone);
  assert.equal(moveStep(s, a, 'redo'), s);
  const undone = moveStep(s, c, 'undo');
  assert.deepEqual(undone, { done: [a, b], undone: [c] });
  assert.deepEqual(moveStep(undone, c, 'redo'), s);
  assert.deepEqual(dropStep(undone, c), { done: [a, b], undone: [] });
  /* a new edit ends what could be made again; the history keeps the last hundred */
  assert.deepEqual(pushStep(undone, a).undone, []);
  let long = empty();
  for (let i = 0; i < 120; i++) long = pushStep(long, { undo: [], redo: [], label: String(i) });
  assert.equal(long.done.length, 100);
  assert.equal(long.done[0].label, '20');
});
