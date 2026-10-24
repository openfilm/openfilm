import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESC_AGAIN_MS, escStopper } from '../chat/src/lib/esc-stop.ts';

const esc = (timeStamp, more = {}) => ({ key: 'Escape', repeat: false, defaultPrevented: false, timeStamp, ...more });

test('an Esc in the chat stops the turn; one in Studio, or another key, does not', () => {
  const stops = escStopper();
  assert.equal(stops(esc(5000), true), true);
  assert.equal(stops(esc(9000), false), false);
  assert.equal(stops({ ...esc(12000), key: 'Enter' }, true), false);
});

test('an Esc in the chat just after one that closed Settings does not stop the turn; one a while later does', () => {
  const stops = escStopper();
  /* Settings closes on the first and gives the focus back to the chat */
  assert.equal(stops(esc(1000), false), false);
  assert.equal(stops(esc(1300), true), false);
  assert.equal(stops(esc(1000 + ESC_AGAIN_MS - 1), true), false);
  assert.equal(stops(esc(1000 + ESC_AGAIN_MS), true), true);
});

test('an Esc held down, or one already handled in the chat, does not stop the turn', () => {
  const stops = escStopper();
  assert.equal(stops(esc(1000), false), false);
  /* the system repeats a held key, in the chat once Settings has closed */
  assert.equal(stops(esc(1500, { repeat: true }), true), false);
  assert.equal(stops(esc(4000, { repeat: true }), true), false);
  /* a dialog of the chat's closed on it, and the next comes just after */
  assert.equal(stops(esc(8000, { defaultPrevented: true }), true), false);
  assert.equal(stops(esc(8200), true), false);
  assert.equal(stops(esc(10000), true), true);
});
