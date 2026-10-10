import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyCommandOf, letterOf, loopBack, playStart, SHORTCUTS, shuttleRate, type KeyPress } from './timeline-keys.ts';

const press = (key: string, mods: Partial<KeyPress> = {}): KeyPress => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });
const mac = (key: string, mods: Partial<KeyPress> = {}) => keyCommandOf(press(key, mods), true);
const win = (key: string, mods: Partial<KeyPress> = {}) => keyCommandOf(press(key, mods), false);

test('the keys, as Premiere and CapCut have them', () => {
  assert.equal(mac('j'), 'shuttle-back');
  assert.equal(mac('k'), 'shuttle-stop');
  assert.equal(mac('L'), 'shuttle-forward');
  assert.equal(mac('i'), 'mark-in');
  assert.equal(mac('o'), 'mark-out');
  assert.equal(mac('x'), 'clear-range');
  assert.equal(mac('I', { shiftKey: true }), 'go-in');
  assert.equal(mac('O', { shiftKey: true }), 'go-out');
  assert.equal(mac('L', { shiftKey: true }), 'loop');
  assert.equal(mac(' ', { shiftKey: true }), 'play-range');
  assert.equal(mac(' '), null, 'Space alone is play / pause, the editor\'s own');
  assert.equal(mac('b', { metaKey: true }), 'split');
  assert.equal(mac('b', { metaKey: true, shiftKey: true }), 'split-all');
  assert.equal(mac('k', { metaKey: true }), 'split-all');
  assert.equal(mac('x', { metaKey: true }), 'cut');
  assert.equal(mac('d', { metaKey: true }), 'duplicate');
  assert.equal(mac('ArrowUp'), 'prev-cut');
  assert.equal(mac('ArrowDown'), 'next-cut');
  assert.equal(mac('ArrowLeft'), 'frame-back');
  assert.equal(mac('ArrowRight', { shiftKey: true }), 'second-forward');
  assert.equal(mac('ArrowLeft', { altKey: true }), 'nudge-back');
  assert.equal(mac('ArrowRight', { altKey: true }), 'nudge-forward');
  assert.equal(mac('Z', { shiftKey: true }), 'zoom-fit');
  assert.equal(mac('n'), 'toggle-snap');
  assert.equal(mac('N', { shiftKey: true }), 'toggle-magnet');
  assert.equal(mac('q'), 'ripple-start');
  assert.equal(mac('w'), 'ripple-end');
  assert.equal(mac(','), 'insert-source');
  assert.equal(mac('.'), 'overwrite-source');
  assert.equal(mac('Home'), 'start');
  assert.equal(mac('End'), 'end');
});

test('M adds a marker, ⇧M and ⌥M go to the next and the one before (⌥M types µ on a Mac)', () => {
  assert.equal(mac('m'), 'add-marker');
  assert.equal(mac('M', { shiftKey: true }), 'next-marker');
  assert.equal(keyCommandOf({ ...press('µ', { altKey: true }), code: 'KeyM' }, true), 'prev-marker');
  assert.equal(win('m', { altKey: true }), 'prev-marker');
  assert.equal(mac('m', { metaKey: true }), null);
  assert.equal(mac('m', { altKey: true, shiftKey: true }), null);
});

test('keys that are not the editor\'s stay the browser\'s, and Ctrl is the modifier off a Mac', () => {
  assert.equal(mac('b', { ctrlKey: true }), null, 'Ctrl+B on a Mac is not ⌘B');
  assert.equal(win('b', { ctrlKey: true }), 'split');
  assert.equal(win('b', { metaKey: true }), null);
  assert.equal(mac('c', { metaKey: true }), null, 'copy is the timeline\'s own');
  assert.equal(mac('z', { metaKey: true }), null, 'undo is the editor\'s own');
  assert.equal(mac('j', { altKey: true }), null);
  assert.equal(mac('ArrowUp', { shiftKey: true }), null);
});

test('a letter is read by what it types, or where it sits when it types no Latin letter', () => {
  assert.equal(letterOf({ key: 'J', code: 'KeyJ' }), 'j');
  /* a French keyboard's A is where Q is on a US one: the letter it types counts */
  assert.equal(letterOf({ key: 'a', code: 'KeyQ' }), 'a');
  /* Korean: ㅓ is on J */
  assert.equal(letterOf({ key: 'ㅓ', code: 'KeyJ' }), 'j');
  assert.equal(keyCommandOf({ ...press('ㅓ'), code: 'KeyJ' }, true), 'shuttle-back');
});

test('every key in Settings\' list is one the editor takes', () => {
  const rows = SHORTCUTS.flatMap((g) => g.rows);
  assert.ok(rows.length > 30);
  assert.equal(new Set(rows.map((r) => r.label)).size, rows.length, 'no row twice');
});

test('J / K / L: L faster each time up to 4×, J the same backwards, K stops; the other way starts at 1×', () => {
  let rate = 0;
  const seen = [];
  for (const key of ['l', 'l', 'l', 'l'] as const) { rate = shuttleRate(rate, key); seen.push(rate); }
  assert.deepEqual(seen, [1, 2, 4, 4]);
  assert.equal(shuttleRate(4, 'j'), -1);
  assert.equal(shuttleRate(-1, 'j'), -2);
  assert.equal(shuttleRate(-4, 'j'), -4);
  assert.equal(shuttleRate(-2, 'l'), 1);
  assert.equal(shuttleRate(2, 'k'), 0);
});

test('a loop goes back to the range\'s start at its end, or the film\'s without a range', () => {
  const range = { startMs: 1000, endMs: 3000 };
  assert.equal(loopBack(2500, range, 10_000), null);
  assert.equal(loopBack(3000, range, 10_000), 1000);
  assert.equal(loopBack(3400, range, 10_000), 1000, 'a tick past the end still loops');
  assert.equal(loopBack(9999.5, null, 10_000), 0);
  assert.equal(loopBack(5000, null, 10_000), null);
  /* playing starts where the playhead is inside the range, else at its start */
  assert.equal(playStart(2000, range, 10_000), 2000);
  assert.equal(playStart(500, range, 10_000), 1000);
  assert.equal(playStart(3000, range, 10_000), 1000);
  assert.equal(playStart(4000, null, 10_000), 4000);
  assert.equal(playStart(10_000, null, 10_000), 0);
});
