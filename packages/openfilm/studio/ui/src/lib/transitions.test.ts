import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from '../../../server/ops.mjs';
import { clipFade, parseFilm } from '../../../../src/film-doc.mjs';
import type { Op } from '../api.ts';
import type { EditClip, EditModel, EditTrack } from './timeline-edit.ts';
import {
  cutForClick, cutNear, findTransitions, planRemoveTransition, planResizeTransition, planTransition,
  type ClipFacts, type FactsOf, type TransitionOpts,
} from './transitions.ts';
import { fadeEdits, fadeFromPointer, fadeHandleX } from './clip-fade.ts';

/*
 * Each plan is applied the way it will be written (ops.mjs on film.html's value), the film read back strictly
 * (film-doc), and the timeline built again from it: tracks of [id, start, end] in seconds, and each clip's fades.
 */

type Spec = [id: string, startS: number, endS: number, more?: Partial<EditClip> & { sound?: boolean; fade?: [number, number]; src?: string }];
type FilmClip = { id: string; src: string; at?: number; time?: number[]; attrs?: Record<string, string>; overrides?: unknown[]; sound?: true };
type FilmValue = { stage?: { w: number; h: number }; tracks: { clips: FilmClip[]; locked?: boolean }[] };

/** film.html's value: videos (or sounds) with their trim written, fades in seconds. */
function film(...tracks: (Spec[] | { locked?: boolean; clips: Spec[] })[]): FilmValue {
  return {
    stage: { w: 320, h: 180 },
    tracks: tracks.map((t) => {
      const list = Array.isArray(t) ? t : t.clips;
      return {
        ...(!Array.isArray(t) && t.locked ? { locked: true } : {}),
        clips: list.map(([id, s, e, more]) => ({
          id,
          src: more?.src ?? (more?.sound ? `${id}.wav` : `${id}.mp4`),
          ...(s ? { at: s } : {}),
          time: more?.src?.endsWith('.html') ? [0, e - s] : [10, 10 + (e - s)],
          ...(more?.link ? { attrs: { 'data-link': more.link } } : {}),
          ...(more?.fade ? { overrides: [{ fade: more.fade }] } : {}),
        })),
      };
    }),
  };
}

const WHITE = 'transitions/white.html';
/** The edit model of a film, and each clip's facts. */
function read(value: FilmValue): { model: EditModel; facts: FactsOf } {
  const facts = new Map<string, ClipFacts>();
  const model: EditTrack[] = value.tracks.map((t, index) => {
    const sounds = t.clips.every((c) => c.src.endsWith('.wav'));
    return {
      index, role: sounds ? 'audio' : 'video', ...(t.locked ? { locked: true } : {}),
      clips: t.clips.map((c) => {
        const at = c.at ?? 0;
        const [from = 0, to = 0] = c.time ?? [];
        const fade = clipFade(c) ?? [0, 0];
        facts.set(c.id, { picture: !c.src.endsWith('.wav'), fade: [fade[0] * 1000, fade[1] * 1000], ...(c.src === WHITE ? { white: true } : {}) });
        return { id: c.id, startMs: Math.round(at * 1000), endMs: Math.round((at + to - from) * 1000), inMs: from * 1000, speed: 1, sourceMs: 60_000, ...(c.attrs?.['data-link'] ? { link: c.attrs['data-link'] } : {}) };
      }).sort((x, y) => x.startMs - y.startMs),
    };
  });
  return { model, facts: (id) => facts.get(id) };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** A plan applied: the film's value, checked as film.html reads it. */
function apply(value: FilmValue, plan: { ops: Op[] } | { error: string }): FilmValue {
  assert.ok(!('error' in plan), `planned: ${'error' in plan ? plan.error : ''}`);
  const next = applyOps(structuredClone(value) as never, plan.ops as never) as unknown as FilmValue;
  parseFilm(structuredClone(next));
  return next;
}
const layout = (value: FilmValue) => value.tracks.map((t) => t.clips.map((c) => {
  const at = c.at ?? 0;
  const [from = 0, to = 0] = c.time ?? [];
  return [c.id, r3(at), r3(at + to - from)];
}).sort((a, b) => Number(a[1]) - Number(b[1])));
const fades = (value: FilmValue) => Object.fromEntries(value.tracks.flatMap((t) => t.clips).flatMap((c) => {
  const f = clipFade(c);
  return f ? [[c.id, f]] : [];
}));

const opts = (more: Partial<TransitionOpts> = {}): TransitionOpts => ({ ripple: true, linked: true, whiteSrc: WHITE, ...more });

test('cross dissolve: the incoming clip goes above, d earlier, and fades in over the outgoing one, which stays whole; what follows closes up', () => {
  const value = film([['a', 0, 4], ['b', 4, 8], ['c', 8, 10]]);
  const { model, facts } = read(value);
  const next = apply(value, planTransition(model, facts, 'dissolve', { a: 'a', b: 'b' }, 500, opts()));
  assert.deepEqual(layout(next), [[['b', 3.5, 7.5]], [['a', 0, 4], ['c', 7.5, 9.5]]]);
  assert.deepEqual(fades(next), { b: [0.5, 0] });
  /* found again on the timeline, drawn on the incoming clip, over the overlap */
  const found = read(next);
  const [tr] = findTransitions(found.model, found.facts);
  assert.deepEqual(tr && { kind: tr.kind, a: tr.a, b: tr.b, startMs: tr.startMs, endMs: tr.endMs, on: tr.on }, { kind: 'dissolve', a: 'a', b: 'b', startMs: 3500, endMs: 4000, on: 'b' });
  /* longer: the incoming clip and what follows go 250 ms further */
  const longer = apply(next, planResizeTransition(found.model, found.facts, tr!, 750, opts()));
  assert.deepEqual(layout(longer), [[['b', 3.25, 7.25]], [['a', 0, 4], ['c', 7.25, 9.25]]]);
  assert.deepEqual(fades(longer), { b: [0.75, 0] });
  /* removed: as it was cut, the track above gone with it */
  const again = read(longer);
  const back = apply(longer, planRemoveTransition(again.model, again.facts, findTransitions(again.model, again.facts)[0]!, opts()));
  assert.deepEqual(layout(back), layout(value));
  assert.deepEqual(fades(back), {});
});

test('a move: the incoming clip overlaps above with no fade on the pictures, their sounds cross-fade; found again by its way in, resized, removed', () => {
  const value = film(
    [['a', 0, 4, { link: 'la' }], ['b', 4, 8, { link: 'lb' }], ['c', 8, 10]],
    [['as', 0, 4, { sound: true, link: 'la' }], ['bs', 4, 8, { sound: true, link: 'lb' }]],
  );
  const { model, facts } = read(value);
  const plan = planTransition(model, facts, 'move', { a: 'a', b: 'b' }, 600, opts());
  assert.equal('lapMs' in plan ? plan.lapMs : null, 600, 'the overlap its two halves are as long as');
  const next = apply(value, plan);
  assert.deepEqual(layout(next), [[['b', 3.4, 7.4]], [['a', 0, 4], ['c', 7.4, 9.4]], [['as', 0, 4]], [['bs', 3.4, 7.4]]]);
  assert.deepEqual(fades(next), { as: [0, 0.6], bs: [0.6, 0] });
  /* found by the move the incoming clip comes in by (its style's, lib/clip-presets withCutMove), its sounds' part of it */
  const moving = (f: FactsOf, ms: number): FactsOf => (id) => (id === 'b' ? { ...f(id)!, moveIn: { slug: 'push-left', ms } } : f(id));
  const found = read(next);
  const all = findTransitions(found.model, moving(found.facts, 600));
  assert.deepEqual(all.map((x) => [x.kind, x.a, x.b, x.startMs, x.endMs, x.on, x.move]), [['move', 'a', 'b', 3400, 4000, 'b', 'push-left']]);
  /* its way in another length than the overlap: not this move */
  assert.deepEqual(findTransitions(found.model, moving(found.facts, 300)).map((x) => x.kind), ['crossfade']);
  /* longer: the incoming clips go 400 ms further, the sounds' fades with them */
  const resized = planResizeTransition(found.model, moving(found.facts, 600), all[0]!, 1000, opts());
  assert.equal('lapMs' in resized ? resized.lapMs : null, 1000);
  const longer = apply(next, resized);
  assert.deepEqual(layout(longer), [[['b', 3, 7]], [['a', 0, 4], ['c', 7, 9]], [['as', 0, 4]], [['bs', 3, 7]]]);
  assert.deepEqual(fades(longer), { as: [0, 1], bs: [1, 0] });
  /* removed: as it was cut */
  const again = read(longer);
  const tr = findTransitions(again.model, moving(again.facts, 1000))[0]!;
  const back = apply(longer, planRemoveTransition(again.model, moving(again.facts, 1000), tr, opts()));
  assert.deepEqual(layout(back), layout(value));
  assert.deepEqual(fades(back), {});
  /* a move wants two pictures on a cut */
  assert.deepEqual(planTransition(model, facts, 'move', { a: 'c', b: null }, 600, opts()), { error: 'none' });
  assert.deepEqual(planTransition(model, facts, 'move', { a: 'as', b: 'bs' }, 600, opts()), { error: 'none' });
});

test('a transition after another: the next cut is across two tracks, found there, and its incoming clip goes above', () => {
  const value = film([['a', 0, 4], ['b', 4, 8], ['c', 8, 12]]);
  const first = read(value);
  const once = apply(value, planTransition(first.model, first.facts, 'move', { a: 'a', b: 'b' }, 600, opts()));
  assert.deepEqual(layout(once), [[['b', 3.4, 7.4]], [['a', 0, 4], ['c', 7.4, 11.4]]]);
  const { model, facts } = read(once);
  /* b ends where c starts, a track above it: dropped on c's start, or on b's end, the cut is b's and c's */
  const c = model[1]!.clips.find((x) => x.id === 'c')!;
  assert.deepEqual(cutNear(model, 1, c.startMs + 5, 50), { a: 'b', b: 'c', atMs: 7400 });
  assert.deepEqual(cutNear(model, 0, 7400 - 5, 50), { a: 'b', b: 'c', atMs: 7400 });
  /* clicked with the playhead near it */
  assert.deepEqual(cutForClick(model, 'move', [], 7300, null), { a: 'b', b: 'c' });
  /* c comes in over b: on a new track above it, though its own (below b) had room */
  const twice = apply(once, planTransition(model, facts, 'move', { a: 'b', b: 'c' }, 600, opts()));
  assert.deepEqual(layout(twice), [[['c', 6.8, 10.8]], [['b', 3.4, 7.4]], [['a', 0, 4]]]);
  const moving: FactsOf = (id) => (id === 'b' || id === 'c' ? { ...read(twice).facts(id)!, moveIn: { slug: 'push-left', ms: 600 } } : read(twice).facts(id));
  assert.deepEqual(findTransitions(read(twice).model, moving).map((x) => [x.kind, x.a, x.b]).sort(), [['move', 'a', 'b'], ['move', 'b', 'c']]);
  /* the first one made longer, then taken away: c goes with b each time, the second one stays as it was */
  const chain = read(twice);
  const firstOf = (m: EditModel) => findTransitions(m, moving).find((x) => x.a === 'a')!;
  const longer = apply(twice, planResizeTransition(chain.model, moving, firstOf(chain.model), 1000, opts()));
  assert.deepEqual(layout(longer), [[['c', 6.4, 10.4]], [['b', 3, 7]], [['a', 0, 4]]]);
  const after = read(longer);
  const movingAfter: FactsOf = (id) => (id === 'b' || id === 'c' ? { ...after.facts(id)!, moveIn: { slug: 'push-left', ms: id === 'b' ? 1000 : 600 } } : after.facts(id));
  const gone = apply(longer, planRemoveTransition(after.model, movingAfter, findTransitions(after.model, movingAfter).find((x) => x.a === 'a')!, opts()));
  assert.deepEqual(layout(gone), [[['c', 7.4, 11.4]], [['a', 0, 4], ['b', 4, 8]]]);
  const left = read(gone);
  const movingLeft: FactsOf = (id) => (id === 'c' ? { ...left.facts(id)!, moveIn: { slug: 'push-left', ms: 600 } } : left.facts(id));
  assert.deepEqual(findTransitions(left.model, movingLeft).map((x) => [x.kind, x.a, x.b, x.startMs, x.endMs]), [['move', 'b', 'c', 7400, 8000]]);
});

test('cross dissolve without a ripple leaves what follows where it is; with one the cut\'s track closes up', () => {
  const value = film([['a', 0, 4], ['b', 4, 8], ['c', 8, 10]], [['m', 0, 3], ['n', 9, 10]]);
  const { model, facts } = read(value);
  const still = apply(value, planTransition(model, facts, 'dissolve', { a: 'a', b: 'b' }, 1000, opts({ ripple: false })));
  assert.deepEqual(layout(still), [[['b', 3, 7]], [['a', 0, 4], ['c', 8, 10]], [['m', 0, 3], ['n', 9, 10]]]);
  const closed = apply(value, planTransition(model, facts, 'dissolve', { a: 'a', b: 'b' }, 1000, opts()));
  assert.deepEqual(layout(closed), [[['b', 3, 7]], [['a', 0, 4], ['c', 7, 9]], [['m', 0, 3], ['n', 9, 10]]]);
});

test('cross dissolve takes the incoming clip\'s linked sound along: it overlaps on a sound track below, the sounds crossfade', () => {
  const value = film(
    [['a', 0, 4, { link: 'la' }], ['b', 4, 8, { link: 'lb' }]],
    [['as', 0, 4, { sound: true, link: 'la' }], ['bs', 4, 8, { sound: true, link: 'lb' }]],
  );
  const { model, facts } = read(value);
  const next = apply(value, planTransition(model, facts, 'dissolve', { a: 'a', b: 'b' }, 500, opts()));
  assert.deepEqual(layout(next), [[['b', 3.5, 7.5]], [['a', 0, 4]], [['as', 0, 4]], [['bs', 3.5, 7.5]]]);
  assert.deepEqual(fades(next), { b: [0.5, 0], as: [0, 0.5], bs: [0.5, 0] });
  const found = read(next);
  assert.deepEqual(findTransitions(found.model, found.facts).map((x) => x.kind), ['dissolve'], 'the sounds\' crossfade is the dissolve\'s');
  const back = apply(next, planRemoveTransition(found.model, found.facts, findTransitions(found.model, found.facts)[0]!, opts()));
  assert.deepEqual(layout(back), layout(value));
  assert.deepEqual(fades(back), {});
  /* ⌥ (linked off): the picture alone, its sound a hard cut where it was */
  const alone = apply(value, planTransition(model, facts, 'dissolve', { a: 'a', b: 'b' }, 500, opts({ linked: false, ripple: false })));
  assert.deepEqual(fades(alone), { b: [0.5, 0] });
  assert.deepEqual(layout(alone)[2], [['as', 0, 4], ['bs', 4, 8]]);
});

test('a dissolve made when both pictures faded is still found, and resized to the outgoing one staying whole', () => {
  const value = film([['b', 3.5, 7.5, { fade: [0.5, 0] }]], [['a', 0, 4, { fade: [0, 0.5] }]]);
  const { model, facts } = read(value);
  const [tr] = findTransitions(model, facts);
  assert.deepEqual(tr && [tr.kind, tr.startMs, tr.endMs], ['dissolve', 3500, 4000]);
  const longer = apply(value, planResizeTransition(model, facts, tr!, 1000, opts()));
  assert.deepEqual(fades(longer), { b: [1, 0] });
  /* a picture under one fading in over its end, but below it: not a dissolve (it would show nothing of it) */
  const under = read(film([['a', 0, 4]], [['b', 3.5, 7.5, { fade: [0.5, 0] }]]));
  assert.deepEqual(findTransitions(under.model, under.facts), []);
});

test('audio crossfade between two sounds: the incoming one on a track below, overlapping', () => {
  const value = film([['x', 0, 2, { sound: true }], ['y', 2, 5, { sound: true }]]);
  const { model, facts } = read(value);
  const next = apply(value, planTransition(model, facts, 'crossfade', { a: 'x', b: 'y' }, 400, opts({ ripple: false })));
  assert.deepEqual(layout(next), [[['x', 0, 2]], [['y', 1.6, 4.6]]]);
  assert.deepEqual(fades(next), { x: [0, 0.4], y: [0.4, 0] });
  const found = read(next);
  assert.deepEqual(findTransitions(found.model, found.facts).map((x) => [x.kind, x.on]), [['crossfade', 'y']]);
});

test('dips: half the length each side of the cut, nothing moves; to white over a white page cut in below', () => {
  const value = film([['a', 0, 4], ['b', 4, 8]], [['bg', 0, 2]]);
  const { model, facts } = read(value);
  const black = apply(value, planTransition(model, facts, 'dip-black', { a: 'a', b: 'b' }, 1000, opts()));
  assert.deepEqual(layout(black), layout(value));
  assert.deepEqual(fades(black), { a: [0, 0.5], b: [0.5, 0] });
  const found = read(black);
  assert.deepEqual(findTransitions(found.model, found.facts).map((x) => [x.kind, x.startMs, x.endMs, x.on]), [['dip-black', 3500, 4500, 'a']]);

  const white = apply(value, planTransition(model, facts, 'dip-white', { a: 'a', b: 'b' }, 1000, opts()));
  assert.deepEqual(layout(white), [[['a', 0, 4], ['b', 4, 8]], [['bg', 0, 2], ['white', 3.5, 4.5]]], 'below, where the track has room');
  const w = read(white);
  const [tr] = findTransitions(w.model, w.facts);
  assert.deepEqual([tr?.kind, tr?.white], ['dip-white', 'white']);
  const wider = apply(white, planResizeTransition(w.model, w.facts, tr!, 2000, opts()));
  assert.deepEqual(layout(wider)[1], [['bg', 0, 2], ['white', 3, 5]]);
  assert.deepEqual(fades(wider), { a: [0, 1], b: [1, 0] });
  const gone = read(wider);
  const back = apply(wider, planRemoveTransition(gone.model, gone.facts, findTransitions(gone.model, gone.facts)[0]!, opts()));
  assert.deepEqual(layout(back), layout(value));
  assert.deepEqual(fades(back), {});
});

test('a clip\'s edge with nothing against it: a fade; fade presets; locked tracks refuse', () => {
  const value = film([['a', 0, 4], ['b', 6, 8]], { locked: true, clips: [['k', 0, 4]] });
  const { model, facts } = read(value);
  assert.deepEqual(fades(apply(value, planTransition(model, facts, 'dissolve', { a: 'a', b: null }, 500, opts()))), { a: [0, 0.5] });
  assert.deepEqual(fades(apply(value, planTransition(model, facts, 'fade-in', { a: null, b: 'b' }, 300, opts()))), { b: [0.3, 0] });
  assert.deepEqual(fades(apply(value, planTransition(model, facts, 'fade-out', { a: 'a', b: 'b' }, 300, opts()))), { a: [0, 0.3] });
  /* longer than the clip: as long as the clip */
  assert.deepEqual(fades(apply(value, planTransition(model, facts, 'fade-in', { a: null, b: 'b' }, 5000, opts()))), { b: [2, 0] });
  assert.deepEqual(planTransition(model, facts, 'fade-in', { a: null, b: 'k' }, 300, opts()), { error: 'locked' });
});

test('cutNear: the cut under the pointer, or a clip\'s edge alone', () => {
  const { model } = read(film([['a', 0, 4], ['b', 4, 8], ['c', 9, 10]]));
  assert.deepEqual(cutNear(model, 0, 4100, 200), { a: 'a', b: 'b', atMs: 4000 });
  assert.deepEqual(cutNear(model, 0, 8100, 200), { a: 'b', b: null, atMs: 8000 });
  assert.deepEqual(cutNear(model, 0, 8950, 200), { a: null, b: 'c', atMs: 9000 });
  assert.equal(cutNear(model, 0, 6000, 200), null);
});

test('fade handles: dragged inward on the frame grid, never past the other fade; linked clips at the same edge too', () => {
  const clip = { startMs: 1000, endMs: 5000 };
  const frame = 1000 / 30;
  assert.equal(fadeFromPointer('in', 1510, clip, 0, frame), 500);
  assert.equal(fadeFromPointer('in', 900, clip, 0, frame), 0);
  assert.equal(fadeFromPointer('out', 4000, clip, 0, frame), 1000);
  /* the other fade takes 3.5 s: 0.5 s at most, on the grid */
  assert.ok(fadeFromPointer('in', 4900, clip, 3500, frame) <= 500);
  assert.equal(fadeHandleX('in', 500, 200, 0.1), 50);
  assert.equal(fadeHandleX('out', 500, 200, 0.1), 150);
  assert.equal(fadeHandleX('out', 5000, 200, 0.1), 0);
  /* kept inside the clip: no nearer an end than the inset, and a fade longer than that starts at the handle */
  assert.equal(fadeHandleX('in', 0, 200, 0.1, 5), 5);
  assert.equal(fadeHandleX('out', 0, 200, 0.1, 5), 195);
  assert.equal(fadeHandleX('in', 500, 200, 0.1, 5), 50);
  assert.equal(fadeHandleX('out', 5000, 200, 0.1, 5), 5);
  const edits = fadeEdits('out', 800, { id: 'v', startMs: 0, endMs: 4000, fade: [200, 0] }, [
    { id: 's', startMs: 0, endMs: 4000, fade: [0, 0] },
    { id: 'other', startMs: 0, endMs: 3000, fade: [0, 0] },
    { id: 'locked', startMs: 0, endMs: 4000, fade: [0, 0], locked: true },
  ]);
  assert.deepEqual(edits, [{ clip: 'v', prop: 'fade', value: [0.2, 0.8] }, { clip: 's', prop: 'fade', value: [0, 0.8] }]);
});

test('a tile clicked: the cut between two selected clips, else the nearest edge of the selection, else the nearest cut', () => {
  const { model } = read(film([['a', 0, 4], ['b', 4, 8], ['c', 8, 10]], [['m', 0, 10]]));
  assert.deepEqual(cutForClick(model, 'dissolve', ['b', 'c'], 1000, null), { a: 'b', b: 'c' });
  assert.deepEqual(cutForClick(model, 'dissolve', ['b'], 3000, null), { a: 'a', b: 'b' });
  assert.deepEqual(cutForClick(model, 'fade-out', ['b'], 3000, null), { a: 'b', b: 'c' });
  assert.deepEqual(cutForClick(model, 'dissolve', [], 7000, 0), { a: 'b', b: 'c' });
  assert.deepEqual(cutForClick(model, 'fade-in', [], 9500, 1), { a: null, b: 'm' });
  assert.equal(cutForClick(model, 'dissolve', [], 5000, 1), null, 'no cut on that track');
});
