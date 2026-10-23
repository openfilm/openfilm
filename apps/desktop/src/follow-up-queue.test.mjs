import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FollowUpQueue, followUpIntent } from '../chat/src/lib/follow-up-queue.ts';

test('pending messages snapshot text, files, references and agent choices, then claim in FIFO order once', () => {
  const queue = new FollowUpQueue();
  const draft = { id: 'b', text: 'B', files: [{ path: 'b.png' }], refs: [{ id: 'clip1' }], agent: 'codex', prefs: { model: 'one' } };
  queue.add(draft);
  draft.text = 'D'; draft.files[0].path = 'd.png'; draft.refs[0].id = 'clip2'; draft.prefs.model = 'two';
  queue.add({ id: 'c', text: 'C' });
  assert.deepEqual(queue.claim(), { id: 'b', text: 'B', files: [{ path: 'b.png' }], refs: [{ id: 'clip1' }], agent: 'codex', prefs: { model: 'one' } });
  assert.equal(queue.claim(), null);
  queue.remove('b');
  assert.equal(queue.get().items[0].text, 'B');
  queue.complete('b');
  assert.equal(queue.claim().text, 'C');
});

test('a rejected steer keeps the message; an unknown outcome cannot be retried automatically or explicitly', () => {
  const queue = new FollowUpQueue();
  queue.add({ id: 'b', text: 'B' }); queue.add({ id: 'c', text: 'C' });
  assert.equal(queue.claim('c').id, 'c');
  queue.release('c', 'rejected');
  assert.equal(queue.claim(), null);
  assert.deepEqual(queue.get().items.map(i => i.id), ['b', 'c']);
  queue.resume();
  assert.equal(queue.claim('c').id, 'c');
  queue.release('c', 'unknown', true);
  queue.resume();
  assert.equal(queue.claim('c'), null);
  assert.equal(queue.claim().id, 'b');
  queue.complete('b');
  assert.equal(queue.claim(), null);
  queue.remove('c');
  assert.equal(queue.get().items.length, 0);
});

test('failure pauses subsequent messages and deletion keeps FIFO order', () => {
  const queue = new FollowUpQueue();
  queue.add({ id: 'b', text: 'B' }); queue.add({ id: 'c', text: 'C' });
  queue.pause('stopped');
  assert.equal(queue.claim(), null);
  queue.resume(); queue.remove('b');
  assert.equal(queue.claim().text, 'C');
});

test('an explicit steer does not resume other pending messages, and a pause during preparation is observable', () => {
  const queue = new FollowUpQueue();
  queue.add({ id: 'b', text: 'B' }); queue.add({ id: 'c', text: 'C' });
  queue.pause('paused');
  const version = queue.get().pauseVersion;
  assert.equal(queue.claim('c').id, 'c');
  queue.complete('c');
  assert.equal(queue.claim(), null);
  assert.equal(queue.get().paused, 'paused');
  queue.pause('paused');
  assert.ok(queue.get().pauseVersion > version);
});


test('queueing is explicit: off steers only when supported, otherwise input must be retained', () => {
  assert.equal(followUpIntent({ running: false, queueing: false, steering: false }), 'send');
  assert.equal(followUpIntent({ running: true, queueing: true, steering: true }), 'queue');
  assert.equal(followUpIntent({ running: true, queueing: true, steering: false }), 'queue');
  assert.equal(followUpIntent({ running: true, queueing: false, steering: true }), 'steer');
  assert.equal(followUpIntent({ running: true, queueing: false, steering: false }), 'blocked');
});

test('taking a pending message back removes it immediately and never dispatches it until resubmitted', () => {
  const queue = new FollowUpQueue();
  const original = { id: 'b', draft: { text: 'B', references: [{ id: 'file:b' }] }, files: [{ name: 'B.txt' }] };
  queue.add(original); queue.add({ id: 'c', draft: { text: 'C' } });
  queue.hold('b');
  assert.equal(queue.claim(), null);
  const draft = queue.takeBack('b');
  assert.deepEqual(draft, original);
  assert.deepEqual(queue.get().items.map(item => item.id), ['c']);
  assert.equal(queue.get().held, null);
  assert.equal(queue.claim().id, 'c');
  assert.equal(queue.takeBack('c'), null, 'a message already being sent cannot be taken back');
  queue.complete('c');
  assert.equal(queue.claim(), null);
  draft.draft.text = 'edited B';
  queue.add({ ...draft, id: 'b-again' });
  assert.equal(queue.claim().draft.text, 'edited B');
});

test('an uncertain steering result cannot be taken back and accidentally resent', () => {
  const queue = new FollowUpQueue();
  queue.add({ id: 'b', text: 'B' }); queue.claim('b'); queue.release('b', 'unknown', true);
  assert.equal(queue.takeBack('b'), null);
  assert.equal(queue.get().items.length, 1);
});

test('reordering changes dispatch order without replacing message content', () => {
  const queue = new FollowUpQueue();
  for (const id of ['a', 'b', 'c']) queue.add({ id, text: id, files: [{ path: `${id}.png` }] });
  queue.hold('c');
  queue.move('c', 'a');
  assert.equal(queue.claim(), null, 'finishing a turn during a drag must wait for the drop');
  queue.move('a', 'b');
  assert.deepEqual(queue.get().items.map(item => item.id), ['c', 'b', 'a']);
  queue.hold(null);
  for (const id of ['c', 'b', 'a']) {
    assert.deepEqual(queue.claim(), { id, text: id, files: [{ path: `${id}.png` }] });
    queue.complete(id);
  }
});

test('reordering ignores missing messages and cannot move a message already being dispatched', () => {
  const queue = new FollowUpQueue();
  queue.add({ id: 'a' }); queue.add({ id: 'b' });
  queue.move('gone', 'a'); queue.move('a', 'gone'); queue.move('a', 'a');
  assert.deepEqual(queue.get().items.map(item => item.id), ['a', 'b']);
  queue.claim(); queue.move('b', 'a');
  assert.deepEqual(queue.get().items.map(item => item.id), ['a', 'b']);
});
