import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pasteGoals, pasteOffset, whyNowhere, type LayerClipboard, type PageClip } from './layer-clipboard.ts';
import type { PasteLayer } from './layer-paste.ts';

const L = (at: string): PasteLayer => ({ at, tag: 'h1', id: null, classes: [], text: '', place: null, idRules: [], tweaks: [] });
const board = (over: Partial<LayerClipboard> = {}): LayerClipboard => ({ project: 'p1', atMs: 0, clips: [{ from: 'a', src: 'title.html', layers: [L('#t')] }], ...over });
const a: PageClip = { id: 'a', src: 'title.html' };
const b: PageClip = { id: 'b', src: 'title.html' };
const c: PageClip = { id: 'c', src: 'scene.html' };
const kinds = (goals: ReturnType<typeof pasteGoals>) => goals.map((g) => `${g.kind}:${g.clip}`);

test('a paste goes into the page in hand: its own page as itself, another as it looks', () => {
  assert.deepEqual(kinds(pasteGoals(board(), 'p1', b, [c], [a, b, c])), ['own:b']);
  assert.deepEqual(kinds(pasteGoals(board(), 'p1', c, [a], [a, b, c])), ['other:c']);
  const forked = board({ clips: [{ from: 'a', src: 'title 2.html', layers: [L('#t')] }] });
  assert.deepEqual(kinds(pasteGoals(forked, 'p1', { id: 'a', src: 'title 2.html' }, [], [a])), ['own:a'], 'its clip given a page of its own: still its own page');
});

test('nothing in hand: its own page under the playhead, else the top page there, else back into its own page', () => {
  assert.deepEqual(kinds(pasteGoals(board(), 'p1', null, [c, b, a], [a, b, c])), ['own:a'], 'the clip copied from first');
  assert.deepEqual(kinds(pasteGoals(board(), 'p1', null, [c, b], [a, b, c])), ['own:b'], 'another clip of its page');
  assert.deepEqual(kinds(pasteGoals(board(), 'p1', null, [c], [a, b, c])), ['other:c']);
  assert.deepEqual(kinds(pasteGoals(board(), 'p1', null, [], [a, b, c])), ['own:a'], 'no page under the playhead: its own, at its own place');
  assert.deepEqual(kinds(pasteGoals(board(), 'p1', null, [], [{ ...a, locked: true }])), [], 'a locked track: nowhere');
});

test('copied from several clips: each back into its own page; from another project: into the page there', () => {
  const two = board({ clips: [{ from: 'a', src: 'title.html', layers: [L('#t')] }, { from: 'c', src: 'scene.html', layers: [L('#s')] }] });
  assert.deepEqual(kinds(pasteGoals(two, 'p1', null, [], [a, c])), ['own:a', 'own:c']);
  const away = board({ project: 'p0' });
  assert.deepEqual(kinds(pasteGoals(away, 'p1', null, [c], [c])), ['other:c']);
  assert.deepEqual(pasteGoals(away, 'p1', null, [], [c]), [], 'no page under the playhead there');
});

test('each paste at the same spot goes further; into its own page it starts off the copied one', () => {
  const own = pasteGoals(board(), 'p1', a, [], [a]);
  const first = pasteOffset(board(), own);
  assert.equal(first.n, 1);
  assert.equal(pasteOffset(board({ pasted: first }), own).n, 2);
  assert.equal(pasteOffset(board({ pasted: first }), pasteGoals(board(), 'p1', c, [], [a, c])).n, 0, 'another spot, another page: where it was');
});

test('nowhere to paste: said as a locked track only when its own page is on one', () => {
  assert.equal(whyNowhere(board(), 'p1', [{ ...a, locked: true }]), 'locked');
  assert.equal(whyNowhere(board(), 'p1', [c]), 'no-page', 'the clip copied from removed, no page under the playhead');
  assert.equal(whyNowhere(board({ project: 'p0' }), 'p1', [{ ...a, locked: true }]), 'no-page');
});
